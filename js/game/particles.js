/* RIDGE RUSH — pooled particles (RR.Particles) and floating score text (RR.FloatText).
 *
 * Contract: docs/ARCHITECTURE.md §5.4. Particles live in WORLD space (metres, y-up) and are drawn with
 * the renderer's world transform already set; FloatText is anchored in world space but drawn in SCREEN
 * space (never draw text in the flipped world transform).
 *
 * Design
 *  - Structure-of-arrays pool (typed arrays) allocated once in the constructor. emit() writes into free
 *    slots, dead particles are swap-removed so the live set is always the dense prefix [0, n). No object
 *    is allocated per emit/update/draw. When the pool is full, the oldest-ish slot is recycled
 *    (round-robin cursor) so fresh effects always win over fading ones.
 *  - Every type has a small descriptor (life, speed, size, gravity/wind response, drag, look). Glowing
 *    types are drawn additively ('lighter') with pre-rendered, colour-tinted glow sprites — no shadowBlur.
 *  - setQuality('low'|'medium'|'high') scales emitted counts (and the effective pool size).
 *
 * Contract additions (callers may ignore):
 *  - p.count (live particles), p.capacity, p.quality, p.countOf(type).
 *  - emit() returns the number of particles actually spawned; unknown types fall back to 'dust'.
 *  - emit opts also accept {gravity, drag} multipliers and `colors` (array, confetti palette).
 *  - update(dt, env) env also accepts {timeScale}.
 *  - Static helpers shared by the other visuals modules:
 *      RR.Particles.glowSprite(color) → offscreen canvas (64×64, soft radial glow of `color`, cached) or
 *        null when no canvas is available (e.g. headless tests). Draw it with 'lighter' compositing.
 *      RR.Particles.TYPES → frozen list of type ids.
 *  - FloatText: f.count, f.clear(); add() opts also accept {rise, outline}.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum;

  // ------------------------------------------------------------------ glow sprite cache
  // Soft radial "light blob" sprites, one per colour. Drawn with 'lighter' they replace shadowBlur glows.
  const GLOW_SIZE = 64;
  const glowCache = new Map();
  let canvasOK = null;
  function makeCanvas(w, h) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    } catch (e) {
      return null;
    }
  }
  function glowSprite(color) {
    color = color || '#ffffff';
    let c = glowCache.get(color);
    if (c !== undefined) return c;
    if (canvasOK === false) return null;
    c = makeCanvas(GLOW_SIZE, GLOW_SIZE);
    const g = c && c.getContext ? c.getContext('2d') : null;
    if (!g) { canvasOK = false; glowCache.set(color, null); return null; }
    canvasOK = true;
    const r = GLOW_SIZE / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.12, U.rgba(color, 0.9));
    grad.addColorStop(0.4, U.rgba(color, 0.35));
    grad.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
    if (glowCache.size > 48) glowCache.delete(glowCache.keys().next().value); // bounded
    glowCache.set(color, c);
    return c;
  }

  // ------------------------------------------------------------------ type table
  // look: 'puff' soft disc that grows · 'glow' additive sprite · 'streak' additive velocity line ·
  //       'chunk' tumbling polygon · 'confetti' flipping ribbon · 'flake' small disc with sway ·
  //       'sparkle' 4-point star glint · 'shard' additive tumbling triangle · 'drop' small disc
  // gravity/wind: response factors (gravity 1 = full env gravity; negative = buoyant)
  const T = {
    dust: { look: 'puff', life: [0.55, 1.1], speed: [0.4, 2.2], size: [0.18, 0.42], grow: 2.4, gravity: -0.04,
      wind: 0.45, drag: 2.4, alpha: 0.5, angle: Math.PI / 2, spread: 2.2, color: '#9b7b4f' },
    smoke: { look: 'puff', life: [0.9, 1.9], speed: [0.3, 1.4], size: [0.25, 0.5], grow: 2.2, gravity: -0.12,
      wind: 0.7, drag: 1.4, alpha: 0.42, angle: Math.PI / 2, spread: 1.1, color: '#6b6e75' },
    spark: { look: 'streak', life: [0.25, 0.6], speed: [4, 10], size: [0.03, 0.06], grow: 0, gravity: 0.7,
      wind: 0, drag: 0.8, alpha: 1, angle: null, spread: TAU, color: '#ffd35a' },
    coin: { look: 'sparkle', life: [0.35, 0.75], speed: [1.2, 3.8], size: [0.12, 0.26], grow: -0.6, gravity: 0.25,
      wind: 0, drag: 2.2, alpha: 1, angle: null, spread: TAU, color: '#ffd84a' },
    snow: { look: 'flake', life: [0.8, 1.6], speed: [0.6, 2.4], size: [0.05, 0.11], grow: 0, gravity: 0.25,
      wind: 0.8, drag: 1.8, alpha: 0.95, angle: Math.PI / 2, spread: 1.6, color: '#f4f8ff' },
    lava: { look: 'glow', life: [0.6, 1.3], speed: [3, 7.5], size: [0.12, 0.26], grow: -0.3, gravity: 1,
      wind: 0, drag: 0.2, alpha: 1, angle: Math.PI / 2, spread: 1.2, color: '#ff7a1c', cool: '#b3220a' },
    explosion: { look: 'glow', life: [0.35, 0.8], speed: [1.5, 6], size: [0.35, 0.75], grow: 1.5, gravity: -0.3,
      wind: 0.2, drag: 3, alpha: 1, angle: null, spread: TAU, color: '#ffb03a', cool: '#d8361a' },
    boost: { look: 'glow', life: [0.16, 0.34], speed: [3, 6], size: [0.16, 0.3], grow: -1.2, gravity: 0,
      wind: 0, drag: 3, alpha: 1, angle: Math.PI, spread: 0.35, color: '#ffc443', cool: '#ff4a1c' },
    ember: { look: 'glow', life: [0.9, 2.2], speed: [0.4, 1.8], size: [0.05, 0.11], grow: -0.2, gravity: -0.18,
      wind: 0.6, drag: 0.9, alpha: 1, angle: Math.PI / 2, spread: 1.4, color: '#ff8a2a', cool: '#c2300f' },
    debris: { look: 'chunk', life: [0.9, 1.8], speed: [2.5, 7], size: [0.08, 0.2], grow: 0, gravity: 1,
      wind: 0, drag: 0.3, alpha: 1, angle: Math.PI / 2, spread: 2.6, color: '#4a4a52' },
    star: { look: 'sparkle', life: [0.5, 1.0], speed: [1.5, 4.5], size: [0.16, 0.34], grow: -0.4, gravity: 0.15,
      wind: 0, drag: 1.8, alpha: 1, angle: null, spread: TAU, color: '#fff3a0' },
    confetti: { look: 'confetti', life: [1.4, 2.6], speed: [3, 8], size: [0.1, 0.18], grow: 0, gravity: 0.35,
      wind: 0.3, drag: 1.6, alpha: 1, angle: Math.PI / 2, spread: 1.5, color: '#ff4f9a' },
    splash: { look: 'drop', life: [0.4, 0.9], speed: [2, 5], size: [0.05, 0.12], grow: -0.3, gravity: 1,
      wind: 0, drag: 0.6, alpha: 0.85, angle: Math.PI / 2, spread: 1.6, color: '#8fd3ff' },
    shield: { look: 'shard', life: [0.5, 1.0], speed: [2.5, 6], size: [0.12, 0.28], grow: -0.4, gravity: 0.3,
      wind: 0, drag: 1.2, alpha: 1, angle: null, spread: TAU, color: '#5ff4ff' }
  };
  const TYPE_IDS = Object.freeze(Object.keys(T));
  const TYPE_INDEX = Object.create(null);
  TYPE_IDS.forEach((k, i) => { TYPE_INDEX[k] = i; T[k].index = i; });
  const DESC = TYPE_IDS.map((k) => T[k]);
  // Draw order: soft/opaque first, additive glows on top.
  const DRAW_ORDER = ['smoke', 'dust', 'splash', 'snow', 'debris', 'confetti', 'explosion', 'lava', 'boost',
    'ember', 'spark', 'coin', 'star', 'shield'].map((k) => TYPE_INDEX[k]);
  const CONFETTI_COLORS = Object.freeze(['#ff4f9a', '#ffd23f', '#3ff3ff', '#7cff6b', '#9b6bff', '#ff8a2a']);
  const QUALITY_SCALE = { low: 0.4, medium: 0.7, high: 1 };

  // Tiny local RNG (xorshift) — particles only need cheap, non-reproducible variety.
  let rs = 0x9e3779b9;
  function rnd() {
    rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
    return (rs >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * rnd();

  // ------------------------------------------------------------------ particles
  class Particles {
    constructor(maxCount) {
      const cap = Math.max(16, Math.min(8192, Math.floor(U.safeNum(maxCount, 600))));
      this.capacity = cap;
      this.count = 0;
      this.quality = 'high';
      this._scale = 1;
      this._limit = cap;
      this.x = new Float32Array(cap);
      this.y = new Float32Array(cap);
      this.vx = new Float32Array(cap);
      this.vy = new Float32Array(cap);
      this.life = new Float32Array(cap);    // remaining seconds
      this.maxLife = new Float32Array(cap);
      this.size = new Float32Array(cap);
      this.rot = new Float32Array(cap);
      this.vrot = new Float32Array(cap);
      this.grav = new Float32Array(cap);    // gravity multiplier (type × opts)
      this.drag = new Float32Array(cap);
      this.seed = new Float32Array(cap);    // per-particle phase for sway/flicker
      this.type = new Uint8Array(cap);
      this.color = new Array(cap).fill('#ffffff');
      this._typeCount = new Int32Array(TYPE_IDS.length);
      this._cursor = 0;
      this._b = { left: 0, right: 0, bottom: 0, top: 0 };
      this._time = 0;
    }

    setQuality(q) {
      this.quality = q in QUALITY_SCALE ? q : 'high';
      this._scale = QUALITY_SCALE[this.quality];
      this._limit = Math.max(16, Math.floor(this.capacity * (this.quality === 'low' ? 0.5 : this.quality === 'medium' ? 0.75 : 1)));
      while (this.count > this._limit) this._kill(this.count - 1);
    }

    countOf(type) {
      const i = TYPE_INDEX[type];
      return i === undefined ? 0 : this._typeCount[i];
    }

    clear() {
      this.count = 0;
      this._typeCount.fill(0);
    }

    // Spawn `count` particles of `type` at (x, y). Returns the number spawned.
    emit(type, x, y, count, opts) {
      if (!isNum(x) || !isNum(y)) return 0;
      let d = T[type];
      if (!d) d = T.dust;
      let n = isNum(count) ? count : 1;
      if (n <= 0) return 0;
      n = Math.max(1, Math.round(n * this._scale));
      if (n > 256) n = 256;
      const o = opts || null;
      if (d === T.explosion) {
        // An explosion is a fireball plus smoke and tumbling debris; split the budget.
        const fire = Math.max(1, Math.round(n * 0.55));
        const spawned = this._spawn(d, x, y, fire, o);
        const s = this._scaleFree(n * 0.25), c = this._scaleFree(n * 0.3);
        const sub = this._subOpts || (this._subOpts = { vx: 0, vy: 0, speed: 0, size: 0, color: null, spread: TAU, angle: null, life: 0 });
        sub.vx = o && isNum(o.vx) ? o.vx * 0.5 : 0;
        sub.vy = o && isNum(o.vy) ? o.vy * 0.5 : 0;
        sub.speed = 0; sub.size = 0; sub.life = 0; sub.color = null; sub.spread = TAU; sub.angle = null;
        const s1 = this._spawn(T.smoke, x, y, s, sub);
        sub.color = o && o.debrisColor ? o.debrisColor : null;
        sub.angle = Math.PI / 2; sub.spread = 2.8;
        const s2 = this._spawn(T.debris, x, y, c, sub);
        return spawned + s1 + s2;
      }
      return this._spawn(d, x, y, n, o);
    }

    _scaleFree(v) { return Math.max(1, Math.round(v)); }

    _spawn(d, x, y, n, o) {
      const ti = d.index;
      const bvx = o && isNum(o.vx) ? o.vx : 0;
      const bvy = o && isNum(o.vy) ? o.vy : 0;
      const spd = o && isNum(o.speed) && o.speed > 0 ? o.speed : 0;
      const ang = o && isNum(o.angle) ? o.angle : d.angle;
      const spread = o && isNum(o.spread) ? Math.max(0, o.spread) : (ang === null ? TAU : d.spread);
      const sizeMul = o && isNum(o.size) && o.size > 0 ? o.size : 0;
      const lifeMul = o && isNum(o.life) && o.life > 0 ? o.life : 0;
      const gMul = o && isNum(o.gravity) ? o.gravity : 1;
      const dMul = o && isNum(o.drag) ? Math.max(0, o.drag) : 1;
      const col = o && typeof o.color === 'string' ? o.color : null;
      const palette = o && Array.isArray(o.colors) && o.colors.length ? o.colors : CONFETTI_COLORS;
      for (let k = 0; k < n; k++) {
        let i;
        if (this.count < this._limit) {
          i = this.count++;
        } else {
          // recycle a live slot (round robin) — keeps effects responsive when the pool is saturated
          i = this._cursor % this.count;
          this._cursor = (this._cursor + 7) % this.count;
          this._typeCount[this.type[i]]--;
        }
        const a = ang === null ? rnd() * TAU : ang + (rnd() - 0.5) * spread;
        // speed: explicit opts.speed is the max, randomised down to 45 % for a natural burst
        const s = spd > 0 ? spd * rr(0.45, 1) : rr(d.speed[0], d.speed[1]);
        this.x[i] = x + (rnd() - 0.5) * 0.12;
        this.y[i] = y + (rnd() - 0.5) * 0.12;
        this.vx[i] = bvx + Math.cos(a) * s;
        this.vy[i] = bvy + Math.sin(a) * s;
        const life = lifeMul > 0 ? lifeMul * rr(0.7, 1.1) : rr(d.life[0], d.life[1]);
        this.life[i] = life;
        this.maxLife[i] = life;
        this.size[i] = sizeMul > 0 ? sizeMul * rr(0.7, 1.2) : rr(d.size[0], d.size[1]);
        this.rot[i] = rnd() * TAU;
        this.vrot[i] = (rnd() - 0.5) * (d.look === 'confetti' ? 16 : d.look === 'chunk' || d.look === 'shard' ? 12 : 2);
        this.grav[i] = d.gravity * gMul;
        this.drag[i] = d.drag * dMul;
        this.seed[i] = rnd() * 100;
        this.type[i] = ti;
        this.color[i] = d.look === 'confetti' && !col ? palette[(rnd() * palette.length) | 0] : (col || d.color);
        this._typeCount[ti]++;
      }
      return n;
    }

    _kill(i) {
      const last = --this.count;
      this._typeCount[this.type[i]]--;
      if (i !== last) {
        this.x[i] = this.x[last]; this.y[i] = this.y[last];
        this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
        this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
        this.size[i] = this.size[last]; this.rot[i] = this.rot[last]; this.vrot[i] = this.vrot[last];
        this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last]; this.seed[i] = this.seed[last];
        this.type[i] = this.type[last]; this.color[i] = this.color[last];
      }
    }

    update(dt, env) {
      if (!isNum(dt) || dt <= 0) return;
      if (dt > 0.1) dt = 0.1;
      const g = env && isNum(env.gravity) ? env.gravity : 9.81;
      const wind = env && isNum(env.wind) ? env.wind : 0;
      this._time += dt;
      let i = 0;
      while (i < this.count) {
        const l = this.life[i] - dt;
        if (l <= 0 || !(l === l)) { this._kill(i); continue; }
        this.life[i] = l;
        const d = DESC[this.type[i]];
        const k = Math.exp(-this.drag[i] * dt);           // exponential drag (frame-rate independent)
        let vx = this.vx[i] * k + wind * d.wind * dt;
        let vy = this.vy[i] * k - g * this.grav[i] * dt;
        if (d.look === 'flake' || d.look === 'confetti') {
          // flutter: lateral sway, terminal velocity
          vx += Math.sin(this._time * 5 + this.seed[i]) * 1.6 * dt;
          if (vy < -2.2) vy = -2.2;
        }
        if (vx > 80) vx = 80; else if (vx < -80) vx = -80;
        if (vy > 80) vy = 80; else if (vy < -80) vy = -80;
        this.vx[i] = vx; this.vy[i] = vy;
        this.x[i] += vx * dt;
        this.y[i] += vy * dt;
        this.rot[i] += this.vrot[i] * dt;
        if (d.grow) {
          const s = this.size[i] * (1 + d.grow * dt);
          this.size[i] = s < 0.005 ? 0.005 : s > 6 ? 6 : s;
        }
        i++;
      }
    }

    // WORLD transform must be set by the caller (renderer.worldTransform).
    draw(ctx, camera) {
      if (!ctx || this.count === 0) return;
      const b = this._b;
      if (camera && typeof camera.bounds === 'function') camera.bounds(b);
      else if (camera) {
        const z = camera.zoom || 40, cx = isNum(camera.cx) ? camera.cx : camera.x || 0;
        const cy = isNum(camera.cy) ? camera.cy : camera.y || 0;
        const hw = (camera.viewW || 960) / (2 * z), hh = (camera.viewH || 540) / (2 * z);
        b.left = cx - hw; b.right = cx + hw; b.bottom = cy - hh; b.top = cy + hh;
      } else { b.left = -1e9; b.right = 1e9; b.bottom = -1e9; b.top = 1e9; }
      const zoom = camera && camera.zoom > 0 ? camera.zoom : 40;
      const px = 1 / zoom; // one screen pixel in metres
      const tc = this._typeCount;
      for (let o = 0; o < DRAW_ORDER.length; o++) {
        const ti = DRAW_ORDER[o];
        if (tc[ti] <= 0) continue;
        const d = DESC[ti];
        switch (d.look) {
          case 'puff': this._drawPuffs(ctx, ti, d, b); break;
          case 'glow': this._drawGlows(ctx, ti, d, b); break;
          case 'streak': this._drawStreaks(ctx, ti, d, b, px); break;
          case 'chunk': this._drawChunks(ctx, ti, d, b); break;
          case 'confetti': this._drawConfetti(ctx, ti, d, b); break;
          case 'flake': case 'drop': this._drawDots(ctx, ti, d, b); break;
          case 'sparkle': this._drawSparkles(ctx, ti, d, b); break;
          case 'shard': this._drawShards(ctx, ti, d, b); break;
          default: break;
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _visible(i, b, m) {
      const x = this.x[i], y = this.y[i];
      return x > b.left - m && x < b.right + m && y > b.bottom - m && y < b.top + m;
    }

    _drawPuffs(ctx, ti, d, b) {
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s)) continue;
        const t = this.life[i] / this.maxLife[i];           // 1 → 0
        // fade in quickly, out slowly
        const a = d.alpha * Math.min(1, (1 - t) * 6) * t;
        if (a <= 0.01) continue;
        const c = this.color[i];
        if (c !== lastCol) { ctx.fillStyle = c; lastCol = c; }
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], s, 0, TAU);
        ctx.fill();
      }
    }

    _drawGlows(ctx, ti, d, b) {
      ctx.globalCompositeOperation = 'lighter';
      let lastCol = null, sprite = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s * 3)) continue;
        const t = this.life[i] / this.maxLife[i];
        // hot → cool colour shift over the particle's life (two cached sprites, no per-frame strings)
        const c = d.cool && t < 0.45 ? d.cool : this.color[i];
        if (c !== lastCol) { sprite = glowSprite(c); lastCol = c; ctx.fillStyle = c; }
        let a = d.alpha * Math.min(1, t * 2.2);
        if (ti === T.ember.index) a *= 0.65 + 0.35 * Math.sin(this._time * 18 + this.seed[i]);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        const r = s * 2.6;
        if (sprite) ctx.drawImage(sprite, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
        else { ctx.beginPath(); ctx.arc(this.x[i], this.y[i], s, 0, TAU); ctx.fill(); }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawStreaks(ctx, ti, d, b, px) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        if (!this._visible(i, b, 1)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { ctx.strokeStyle = c; lastCol = c; }
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.lineWidth = Math.max(px * 1.5, this.size[i]);
        const k = 0.035; // streak length = 35 ms of travel
        ctx.beginPath();
        ctx.moveTo(this.x[i], this.y[i]);
        ctx.lineTo(this.x[i] - this.vx[i] * k, this.y[i] - this.vy[i] * k);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawChunks(ctx, ti, d, b) {
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { ctx.fillStyle = c; lastCol = c; }
        ctx.globalAlpha = Math.min(1, t * 3);
        // irregular quad rotated by rot (manual rotation: no save/restore)
        const cr = Math.cos(this.rot[i]) * s, sr = Math.sin(this.rot[i]) * s;
        const x = this.x[i], y = this.y[i];
        ctx.beginPath();
        ctx.moveTo(x + cr, y + sr);
        ctx.lineTo(x - sr * 0.7, y + cr * 0.7);
        ctx.lineTo(x - cr * 0.9, y - sr * 0.9);
        ctx.lineTo(x + sr * 0.6, y - cr * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }

    _drawConfetti(ctx, ti, d, b) {
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { ctx.fillStyle = c; lastCol = c; }
        ctx.globalAlpha = Math.min(1, t * 3);
        // ribbon flips: its width follows |cos| of a second spin phase
        const flip = Math.cos(this.rot[i] * 1.7 + this.seed[i]);
        const hw = s * 0.5, hh = s * 0.28 * (0.25 + 0.75 * Math.abs(flip));
        const cr = Math.cos(this.rot[i]), sr = Math.sin(this.rot[i]);
        const x = this.x[i], y = this.y[i];
        ctx.beginPath();
        ctx.moveTo(x + cr * hw - sr * hh, y + sr * hw + cr * hh);
        ctx.lineTo(x - cr * hw - sr * hh, y - sr * hw + cr * hh);
        ctx.lineTo(x - cr * hw + sr * hh, y - sr * hw - cr * hh);
        ctx.lineTo(x + cr * hw + sr * hh, y + sr * hw - cr * hh);
        ctx.closePath();
        ctx.fill();
      }
    }

    _drawDots(ctx, ti, d, b) {
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { ctx.fillStyle = c; lastCol = c; }
        ctx.globalAlpha = d.alpha * Math.min(1, t * 2.5);
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], s, 0, TAU);
        ctx.fill();
      }
    }

    _drawSparkles(ctx, ti, d, b) {
      ctx.globalCompositeOperation = 'lighter';
      let lastCol = null, sprite = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s * 2)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { sprite = glowSprite(c); ctx.fillStyle = c; lastCol = c; }
        const tw = 0.6 + 0.4 * Math.sin(this._time * 22 + this.seed[i]);   // twinkle
        ctx.globalAlpha = Math.min(1, t * 2) * tw;
        const x = this.x[i], y = this.y[i];
        if (sprite) ctx.drawImage(sprite, x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
        // 4-point star: two thin diamonds
        const r = s * (0.8 + 0.4 * tw), w = s * 0.16;
        const cr = Math.cos(this.rot[i] * 0.3), sr = Math.sin(this.rot[i] * 0.3);
        ctx.beginPath();
        ctx.moveTo(x + cr * r, y + sr * r);
        ctx.lineTo(x - sr * w, y + cr * w);
        ctx.lineTo(x - cr * r, y - sr * r);
        ctx.lineTo(x + sr * w, y - cr * w);
        ctx.closePath();
        ctx.moveTo(x - sr * r, y + cr * r);
        ctx.lineTo(x - cr * w, y - sr * w);
        ctx.lineTo(x + sr * r, y - cr * r);
        ctx.lineTo(x + cr * w, y + sr * w);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawShards(ctx, ti, d, b) {
      ctx.globalCompositeOperation = 'lighter';
      let lastCol = null;
      for (let i = 0; i < this.count; i++) {
        if (this.type[i] !== ti) continue;
        const s = this.size[i];
        if (!this._visible(i, b, s)) continue;
        const t = this.life[i] / this.maxLife[i];
        const c = this.color[i];
        if (c !== lastCol) { ctx.fillStyle = c; ctx.strokeStyle = c; lastCol = c; }
        ctx.globalAlpha = Math.min(1, t * 1.8) * 0.8;
        const cr = Math.cos(this.rot[i]) * s, sr = Math.sin(this.rot[i]) * s;
        const x = this.x[i], y = this.y[i];
        ctx.beginPath();
        ctx.moveTo(x + cr, y + sr);
        ctx.lineTo(x - cr * 0.5 - sr * 0.8, y - sr * 0.5 + cr * 0.8);
        ctx.lineTo(x - cr * 0.5 + sr * 0.5, y - sr * 0.5 - cr * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  Particles.glowSprite = glowSprite;
  Particles.TYPES = TYPE_IDS;

  // ------------------------------------------------------------------ floating text
  // Screen-space score popups anchored at a world point: pop in (easeOutBack), rise, fade.
  class FloatText {
    constructor(max) {
      const cap = Math.max(4, Math.min(128, Math.floor(U.safeNum(max, 24))));
      this.capacity = cap;
      this.count = 0;
      this._items = [];
      for (let i = 0; i < cap; i++) {
        this._items.push({ text: '', x: 0, y: 0, color: '#ffffff', size: 22, life: 1, age: 0, rise: 1.6,
          font: '', outline: true });
      }
      this._p = { x: 0, y: 0 };
    }

    clear() { this.count = 0; }

    add(text, wx, wy, opts) {
      if (!isNum(wx) || !isNum(wy)) return;
      let it;
      if (this.count < this.capacity) it = this._items[this.count++];
      else {
        // recycle the oldest
        let oi = 0;
        for (let i = 1; i < this.count; i++) if (this._items[i].age > this._items[oi].age) oi = i;
        it = this._items[oi];
      }
      const size = opts && isNum(opts.size) ? U.clamp(opts.size, 8, 96) : 22;
      it.text = String(text == null ? '' : text);
      it.x = wx; it.y = wy;
      it.color = (opts && opts.color) || '#ffffff';
      it.size = size;
      it.life = opts && isNum(opts.life) && opts.life > 0 ? Math.min(opts.life, 6) : 1.1;
      it.rise = opts && isNum(opts.rise) ? opts.rise : 1.6;
      it.outline = !(opts && opts.outline === false);
      it.age = 0;
      // font string built once per popup (not per frame)
      it.font = '900 ' + Math.round(size) + 'px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
    }

    update(dt) {
      if (!isNum(dt) || dt <= 0) return;
      let i = 0;
      while (i < this.count) {
        const it = this._items[i];
        it.age += dt;
        if (it.age >= it.life) {
          // swap-remove, keeping object identity inside the pool
          const last = this._items[--this.count];
          this._items[this.count] = it;
          this._items[i] = last;
          continue;
        }
        // rise decelerates over the popup's life (metres)
        it.y += it.rise * dt * (1 - it.age / it.life);
        i++;
      }
    }

    // SCREEN transform must be set by the caller (renderer.screenTransform).
    draw(ctx, camera) {
      if (!ctx || this.count === 0 || !camera) return;
      const p = this._p;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < this.count; i++) {
        const it = this._items[i];
        if (typeof camera.worldToScreen === 'function') camera.worldToScreen(it.x, it.y, p);
        else {
          const z = camera.zoom || 40;
          p.x = (camera.viewW || 960) / 2 + (it.x - (camera.x || 0)) * z;
          p.y = (camera.viewH || 540) / 2 - (it.y - (camera.y || 0)) * z;
        }
        if (!isNum(p.x) || !isNum(p.y)) continue;
        const k = it.age / it.life;
        const pop = it.age < 0.28 ? U.easeOutBack(it.age / 0.28) : 1;
        const scale = Math.max(0.05, pop * (1 - 0.1 * k));
        const alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(scale, scale);
        ctx.globalAlpha = U.clamp(alpha, 0, 1);
        ctx.font = it.font;
        if (it.outline) {
          ctx.lineWidth = Math.max(3, it.size * 0.2);
          ctx.strokeStyle = 'rgba(12,10,24,0.85)';
          ctx.strokeText(it.text, 0, 1.5);
        }
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  RR.Particles = Particles;
  RR.FloatText = FloatText;
})();
