/* RIDGE RUSH — parallax backgrounds & weather (RR.Background).
 *
 * Contract: docs/ARCHITECTURE.md §5.6. drawSky / drawWeather run in SCREEN space (CSS px, y-down) and
 * only use save/translate/scale/restore, so they compose with whatever transform the caller has set
 * (renderer DPR transform, UI canvas scaling).
 *
 * Art direction: "vector poster". Per-world sky gradient, a pre-rendered celestial body (sun, giant
 * desert sun, red moon, Earth, synthwave neon sun, veiled storm sun), stars in dark worlds, drifting
 * pre-rendered clouds, and 4 parallax silhouette layers (factors 0.05 / 0.15 / 0.3 / 0.5) whose shapes
 * differ per world: rolling hills + blue mountains, jagged crags, mesas & dunes, snow-capped peaks,
 * smoking volcano cones, crater rims, a lit skyline with neon, alien spires under churning clouds.
 * Far layers are mixed toward the horizon colour and hazed (atmospheric perspective).
 * Everything is deterministic in world x (seeded noise sampled at scrolled coordinates), so layers never
 * shimmer; vertical parallax follows a slowly re-centring reference so big climbs don't push layers away.
 *
 * Contract additions (callers may ignore):
 *  - bg.flash(intensity 0..1, bolt = true) triggers a lightning flash (+ sky bolt) now.
 *  - env.lightning (0..1 or bool) is read as the EventSystem's flash pulse (it jumps up on a strike /
 *    storm flash and decays): every rising edge triggers a sky flash + bolt. Independently, storm_planet
 *    has rare, soft, bolt-less "sheet lightning" in the clouds for atmosphere. env.rain 0..1 adds rain.
 *    env.fog 0..1 (optional) adds extra ground fog. env.wind (m/s²) drifts clouds / weather.
 *  - bg.world, bg.seed, bg.quality, bg.time are readable.
 *  - bg.floorY (screen px or null): set by the renderer before drawSky to the lowest on-screen point of the
 *    terrain surface; sky/layers/haze are not painted below it (the terrain covers it) — saves fill-rate.
 *  - RR.Background.LAYER_FACTORS = [0.05, 0.15, 0.3, 0.5].
 *  - RR.Background.drawThumbnail caches the rendered card per (world, w, h) and re-uses it.
 *  - bg.moonW (0..1, read-only): THE MOON section blend on non-moon worlds (env.sectionId === 'moon' or
 *    env.gravityMul < 0.95), eased ~1 s. Sky cross-fades to the moon_base vacuum, stars + a distant Earth fade
 *    in, the sun pales, clouds / haze / ambient weather / layer trees fade out, layers tint toward moon grey.
 *    The renderer reads it to hide plant decorations.
 *  - Fill-rate (review visuals-3): each parallax layer (and its haze) is painted only down to the next
 *    layer's baseline and the sky only down to the nearest layer's baseline (every silhouette is opaque below
 *    its baseline); gradient strips are blitted without smoothing and sprites at whole device pixels.
 *    LOW drops the farthest layer and the haze strips (a comparable fog tint is baked into the layer colours).
 *  - Wind (env.wind, m/s²): rain streak slant equals the simulated drop velocity (wind·60 + drift over the
 *    fall speed), sand blows with its sign, and faint screen-space wind streaks appear from |wind| ≈ 2.5
 *    (full at 10) when it isn't raining hard.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum;
  const clamp = U.clamp;

  const LAYER_FACTORS = Object.freeze([0.05, 0.15, 0.3, 0.5]);
  const QUALITY = {
    low: { step: 14, weather: 0.35, stars: 0.5, clouds: 0.6, windows: false, details: false },
    medium: { step: 9, weather: 0.65, stars: 0.8, clouds: 0.8, windows: true, details: true },
    high: { step: 6, weather: 1, stars: 1, clouds: 1, windows: true, details: true }
  };

  function makeCanvas(w, h) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
      return c.getContext ? c : null;
    } catch (e) { return null; }
  }
  // 'rgba(r,g,b,a)' or '#hex' → {r,g,b,a}
  function parseColor(str) {
    if (typeof str !== 'string') return { r: 255, g: 255, b: 255, a: 0.2 };
    const m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) {
      const p = m[1].split(',').map(Number);
      return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: isNum(p[3]) ? p[3] : 1 };
    }
    const c = U.hexToRgb(str);
    return { r: c.r, g: c.g, b: c.b, a: 1 };
  }
  const rgbaStr = (c, a) => 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  const luminance = (hex) => { const c = U.hexToRgb(hex); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; };
  // mixColor returns 'rgb(...)'; convert back to hex so results can be mixed again
  function mixHex(a, b, t) {
    const x = U.hexToRgb(a), y = U.hexToRgb(b);
    t = clamp(t, 0, 1);
    const h = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
    return '#' + h(U.lerp(x.r, y.r, t)) + h(U.lerp(x.g, y.g, t)) + h(U.lerp(x.b, y.b, t));
  }
  const rgbHex = (c) => '#' + [c.r, c.g, c.b].map((v) => ('0' + clamp(v | 0, 0, 255).toString(16)).slice(-2)).join('');
  // Four parallax layer colours for a palette. Atmospheric perspective: far layers pulled toward the
  // horizon colour (less in dark worlds, where silhouettes must stay darker than the glowing horizon).
  function layerPalette(P) {
    const horizon = P.horizon || '#eaf7ff';
    const far = P.far || '#9cc0d6', mid = P.mid || '#6fa45c', near = P.near || '#4d8a3b';
    const haze = luminance(P.skyTop || '#3d8fdc') < 0.16 ? 0.16 : 0.3;
    return [mixHex(far, horizon, haze), mixHex(far, mid, 0.35), mid, near];
  }
  const MOON_FALLBACK = Object.freeze({ skyTop: '#03040c', skyBottom: '#161b36', horizon: '#252c52', far: '#343a52', mid: '#50566b', near: '#666b7e' });
  function moonPalette() {
    const m = RR.Worlds && RR.Worlds.byId ? RR.Worlds.byId('moon_base') : null;
    return (m && m.palette) || MOON_FALLBACK;
  }
  let moonLayerCache = null;
  function moonLayers() { return moonLayerCache || (moonLayerCache = layerPalette(moonPalette())); }
  // Rain streak slant (dx per unit dy) = horizontal / vertical drop speed, as simulated in _updateWeather:
  // vx = wind·60 + drift, vy = fall·(0.6 + 0.4·depth). Clamped so a gale reads as ~55° rain, not sideways.
  function rainSlant(wind, drift, fall, depth) {
    return clamp((wind * 60 + drift) / (fall * (0.6 + 0.4 * depth)), -1.4, 1.4);
  }
  // fractional part in [0, 1), safe for negative inputs
  const frac = (v) => { const f = v - Math.floor(v); return f === f ? f : 0; };
  // cheap deterministic 0..1 hash for integer cells
  const cellRand = (seed, k, salt) => U.hash2(seed + (salt | 0) * 7919, k | 0) / 4294967296;

  // ------------------------------------------------------------------ per-world layer design
  // kind: silhouette generator · base: baseline (fraction of h) · amp: height (fraction of h) ·
  // scale: feature width in px at 720p · extra: decorative details
  const WORLD_CFG = {
    green_valley: {
      layers: [
        { kind: 'mountains', base: 0.5, amp: 0.3, scale: 420, snow: 0.92 },
        { kind: 'hills', base: 0.55, amp: 0.15, scale: 330 },
        { kind: 'hills', base: 0.61, amp: 0.14, scale: 260, trees: 'round' },
        { kind: 'hills', base: 0.68, amp: 0.13, scale: 210, trees: 'round' }
      ], clouds: 7, cloudAlpha: 0.95, stars: 0, lightning: 0
    },
    rocky_highlands: {
      layers: [
        { kind: 'crags', base: 0.5, amp: 0.34, scale: 360 },
        { kind: 'crags', base: 0.56, amp: 0.22, scale: 280 },
        { kind: 'crags', base: 0.62, amp: 0.16, scale: 220, trees: 'pine' },
        { kind: 'hills', base: 0.69, amp: 0.13, scale: 180, trees: 'pine' }
      ], clouds: 6, cloudAlpha: 0.85, stars: 0, lightning: 0, mist: true
    },
    desert_canyon: {
      layers: [
        { kind: 'mesas', base: 0.5, amp: 0.22, scale: 520, strata: true },
        { kind: 'mesas', base: 0.56, amp: 0.2, scale: 400, strata: true },
        { kind: 'dunes', base: 0.63, amp: 0.12, scale: 300 },
        { kind: 'mesas', base: 0.7, amp: 0.15, scale: 300, strata: true }
      ], clouds: 3, cloudAlpha: 0.6, stars: 0, lightning: 0
    },
    snow_peaks: {
      layers: [
        { kind: 'peaks', base: 0.5, amp: 0.36, scale: 300, snow: 0.45 },
        { kind: 'peaks', base: 0.56, amp: 0.24, scale: 240, snow: 0.5 },
        { kind: 'hills', base: 0.62, amp: 0.14, scale: 240, trees: 'snowpine' },
        { kind: 'hills', base: 0.69, amp: 0.12, scale: 200, trees: 'snowpine' }
      ], clouds: 6, cloudAlpha: 0.9, stars: 0, lightning: 0
    },
    volcanic_ridge: {
      layers: [
        { kind: 'volcanoes', base: 0.52, amp: 0.36, scale: 420, glow: true, smoke: true },
        { kind: 'crags', base: 0.58, amp: 0.2, scale: 260 },
        { kind: 'volcanoes', base: 0.64, amp: 0.18, scale: 300, glow: true },
        { kind: 'crags', base: 0.71, amp: 0.13, scale: 200, embers: true }
      ], clouds: 5, cloudAlpha: 0.7, stars: 0.35, lightning: 0
    },
    moon_base: {
      layers: [
        { kind: 'craters', base: 0.52, amp: 0.2, scale: 420 },
        { kind: 'craters', base: 0.58, amp: 0.16, scale: 320 },
        { kind: 'craters', base: 0.64, amp: 0.14, scale: 260 },
        { kind: 'craters', base: 0.71, amp: 0.12, scale: 200 }
      ], clouds: 0, cloudAlpha: 0, stars: 1, lightning: 0
    },
    neon_city: {
      layers: [
        { kind: 'skyline', base: 0.56, amp: 0.34, scale: 46, windows: 0.18 },
        { kind: 'skyline', base: 0.6, amp: 0.3, scale: 62, windows: 0.28, neon: 0.2 },
        { kind: 'skyline', base: 0.65, amp: 0.26, scale: 86, windows: 0.34, neon: 0.35 },
        { kind: 'skyline', base: 0.72, amp: 0.2, scale: 120, windows: 0.4, neon: 0.5 }
      ], clouds: 3, cloudAlpha: 0.5, stars: 0.4, lightning: 0
    },
    storm_planet: {
      layers: [
        { kind: 'spires', base: 0.52, amp: 0.38, scale: 300 },
        { kind: 'crags', base: 0.58, amp: 0.2, scale: 260 },
        { kind: 'spires', base: 0.64, amp: 0.26, scale: 220, glow: true },
        { kind: 'crags', base: 0.71, amp: 0.13, scale: 180 }
      ], clouds: 8, cloudAlpha: 0.95, stars: 0, lightning: 0.18, storm: true
    }
  };
  const DEFAULT_CFG = WORLD_CFG.green_valley;

  const AMBIENT = {
    pollen: { n: 45 }, mist: { n: 7 }, sand: { n: 130 }, snow: { n: 170 }, embers: { n: 70 },
    stars: { n: 0 }, neon_rain: { n: 170 }, storm_rain: { n: 230 }
  };

  // ------------------------------------------------------------------ Background
  class Background {
    constructor(world, seed) {
      this.quality = 'high';
      this._q = QUALITY.high;
      this.time = 0;
      this._flash = 0;
      this._envL = 0;
      this._bolt = new Float32Array(2 * 14);
      this._boltN = 0;
      this._boltBranch = new Float32Array(2 * 6);
      this._shoot = { t: -1, x: 0, y: 0, vx: 0, vy: 0, next: 4 };
      this._yRef = null;
      this.floorY = null;     // optional: screen y below which the caller paints opaque ground (overdraw saver)
      this._prevCamX = null; this._prevCamY = null;
      this._cloudDrift = 0;
      this._w = 0; this._h = 0;
      this._cols = new Float32Array(1024);      // silhouette column y (px)
      this._tops = new Float32Array(64);        // volcano/spire tip scratch (x, y pairs)
      this._baseY = new Float32Array(8);        // per-frame layer baselines (screen px)
      this._nTops = 0;
      // weather pool (screen px)
      const WC = 420;
      this._wcap = WC;
      this._wx = new Float32Array(WC); this._wy = new Float32Array(WC);
      this._wv = new Float32Array(WC); this._ws = new Float32Array(WC); this._wp = new Float32Array(WC);
      this._wn = 0; this._wInitFor = '';
      this._rainN = 0;
      this.setWorld(world, seed);
    }

    setWorld(world, seed) {
      const W = RR.Worlds;
      if (typeof world === 'string' && W) world = W.byId(world);
      this.world = world && world.palette ? world : (W && W.list ? W.list[0] : null);
      const wd = this.world || { id: 'none', palette: {}, ambient: 'pollen', celestial: 'sun', darkness: 0 };
      this.seed = isNum(seed) ? seed >>> 0 : U.hashString(String(wd.id));
      this.cfg = WORLD_CFG[wd.id] || DEFAULT_CFG;
      const P = wd.palette || {};
      const horizon = P.horizon || '#eaf7ff';
      this._layerBase = layerPalette(P);
      this.pal = {
        skyTop: P.skyTop || '#3d8fdc', skyBottom: P.skyBottom || '#bfe6ff', horizon,
        cloud: P.cloud || '#ffffff', accent: P.accent || '#ffd34d', fog: parseColor(P.fog || 'rgba(225,242,255,0.22)'),
        hazard: P.hazard || '#ff6a1f'
      };
      this.dark = luminance(this.pal.skyTop) < 0.16;
      // LOW skips the haze strips: bake a comparable amount of fog into the three far layers instead
      const fogHex = rgbHex(this.pal.fog);
      const fogK = Math.min(0.3, this.pal.fog.a * 1.2);
      this._layerLowBase = this._layerBase.map((c, i) => (i < 3 ? mixHex(c, fogHex, fogK * (i === 0 ? 1 : i === 1 ? 0.6 : 0.3)) : c));
      this.moonW = 0; this._moonTarget = 0; this._moonKey = -1;
      this._isMoonWorld = wd.id === 'moon_base';
      this._refreshLayers();
      this._noise = [];
      for (let k = 0; k < 4; k++) this._noise.push(U.makeNoise1D(U.hash2(this.seed, 101 + k)));
      // stars (normalized screen positions)
      const nStars = Math.round(220 * (this.cfg.stars || 0));
      this._stars = new Float32Array(nStars * 4);
      const rng = U.makeRng(U.hash2(this.seed, 77));
      for (let i = 0; i < nStars; i++) {
        this._stars[i * 4] = rng.next();
        this._stars[i * 4 + 1] = Math.pow(rng.next(), 1.4) * 0.72;
        this._stars[i * 4 + 2] = rng.range(0.6, 1.9);
        this._stars[i * 4 + 3] = rng.range(0, TAU);
      }
      // clouds
      const nClouds = this.cfg.clouds || 0;
      this._clouds = [];
      for (let i = 0; i < nClouds; i++) {
        this._clouds.push({
          u: rng.next(), y: this.cfg.storm ? rng.range(0.02, 0.3) : rng.range(0.06, 0.34),
          s: rng.range(0.7, 1.35) * (this.cfg.storm ? 1.6 : 1), v: rng.int(0, 2),
          speed: rng.range(0.6, 1.4), depth: rng.range(0.02, 0.06), phase: rng.range(0, TAU)
        });
      }
      this._celestial = null; this._celestialKey = '';
      this._cloudSprites = null; this._cloudKey = '';
      this._skyGrad = null; this._skyW = -1; this._skyStrip = null; this._hazeStrip = null;
      this._hazeGrad = null; this._fogGrad = null;
      this._moonStars = null; this._earth = null; this._earthKey = '';
      this._wInitFor = '';
      this._yRef = null;
    }

    setQuality(q) {
      this.quality = QUALITY[q] ? q : 'high';
      this._q = QUALITY[this.quality];
      this._wInitFor = '';
      this._moonKey = -1;
      this._refreshLayers();
    }

    // Layer fill / shade / rim colours for the current quality and MOON-section blend.
    _refreshLayers() {
      const base = this.quality === 'low' && this._layerLowBase ? this._layerLowBase : this._layerBase;
      if (!base) return;
      const mw = U.safeNum(this.moonW, 0);
      const key = Math.round(mw * 32) + (this.quality === 'low' ? 100 : 0);
      if (key === this._moonKey && this.layerColors) return;
      this._moonKey = key;
      const moon = mw > 0 ? moonLayers() : null;
      this.layerColors = base.map((c, i) => (moon ? mixHex(c, moon[i], (key % 100) / 32 * 0.85) : c));
      this.layerShade = this.layerColors.map((c) => mixHex(c, '#000000', 0.18));
      this.layerLight = this.layerColors.map((c) => mixHex(c, '#ffffff', 0.22));
    }

    flash(intensity, bolt) {
      const k = clamp(U.safeNum(intensity, 1), 0, 1);
      if (k <= 0) return;
      this._flash = Math.max(this._flash, k);
      if (bolt === false) { if (this._flash <= k) this._boltN = 0; }
      else this._makeBolt();
    }

    update(dt, camera, env) {
      dt = isNum(dt) ? clamp(dt, 0, 0.1) : 0;
      this.time += dt;
      const wind = env && isNum(env.wind) ? env.wind : (this.world && this.world.wind ? U.safeNum(this.world.wind.base, 0) : 0);
      this._cloudDrift += (4 + wind * 5) * dt;              // px/s at 720p, scaled at draw time
      this._wind = wind;
      // lightning: follow the EventSystem's flash pulse (rising edge → flash + bolt) …
      const envL = env && env.lightning ? (env.lightning === true ? 1 : clamp(U.safeNum(env.lightning, 0), 0, 1)) : 0;
      if (envL > this._envL + 0.15) this.flash(envL, true);
      this._envL = envL;
      // … plus rare, soft sheet lightning inside the clouds on storm worlds (visual only, no bolt)
      const act = this.cfg.lightning || 0;
      if (act > 0 && dt > 0 && Math.random() < act * 0.35 * dt) this.flash(0.22 + 0.2 * Math.random(), false);
      if (this._flash > 0) this._flash = Math.max(0, this._flash - dt * 3.2);
      // vertical parallax reference drifts toward the camera (re-centres over ~6 s)
      if (camera) {
        const cy = isNum(camera.cy) ? camera.cy : U.safeNum(camera.y, 0);
        if (this._yRef === null || !isNum(this._yRef)) this._yRef = cy;
        this._yRef = U.damp(this._yRef, cy, 0.18, dt);
        if (Math.abs(cy - this._yRef) > 60) this._yRef = cy - Math.sign(cy - this._yRef) * 60;
      }
      this._rainN = env && isNum(env.rain) ? clamp(env.rain, 0, 1) : 0;
      // THE MOON section outside moon_base: sky → dark starry vacuum, eased over ~1 s
      let mt = 0;
      if (!this._isMoonWorld && env) {
        const gm = isNum(env.gravityMul) ? env.gravityMul : 1;
        if (env.sectionId === 'moon' || gm < 0.95) mt = U.smoothstep(0, 1, (1 - gm) / 0.55);
      }
      this._moonTarget = mt;
      if (this.moonW !== mt) {
        this.moonW = dt > 0 ? U.approach(this.moonW, mt, dt * 1.5) : mt;
        if (Math.abs(this.moonW - mt) < 0.002) this.moonW = mt;
        this._refreshLayers();
      }
      this._updateWeather(dt, camera);
    }

    // ================================================================ sky
    drawSky(ctx, camera, w, h, env) {
      if (!ctx || !(w > 0) || !(h > 0)) return;
      if (w !== this._w || h !== this._h) this._resize(w, h);
      const cam = camera || { x: 0, y: 0, zoom: h / 15 };
      const camX = isNum(cam.cx) ? cam.cx : U.safeNum(cam.x, 0);
      const camY = isNum(cam.cy) ? cam.cy : U.safeNum(cam.y, 0);
      const zoom = cam.zoom > 0 ? cam.zoom : h / 15;
      const s = h / 720;
      const moonW = U.safeNum(this.moonW, 0);
      const low = this.quality === 'low';

      // 1. static backdrop: sky gradient + celestial body, pre-rendered once per size (gradients are the
      //    most expensive fills on software-rasterised canvases; a blit is cheap everywhere)
      if (this._skyW !== w || this._skyH !== h) this._buildBackdrop(ctx, w, h);
      // everything below `floor` is covered by the caller's terrain → don't paint it (fill-rate saver)
      const floor = isNum(this.floorY) ? clamp(this.floorY + 2, h * 0.3, h) : h;
      this._floor = floor;
      // layer baselines first: every silhouette is opaque below its own baseline, so each layer (and its
      // haze) only needs painting down to the NEXT layer's baseline, and the sky only down to the nearest
      // layer's baseline — cuts the sky pass overdraw roughly in half at no visual change
      const dy = this._yRef === null ? 0 : camY - this._yRef;
      const layers = this.cfg.layers;
      const nL = layers.length, BY = this._baseY;
      for (let li = 0; li < nL; li++) {
        const f = LAYER_FACTORS[li] || 0.5;
        BY[li] = layers[li].base * h + clamp(dy * zoom * f * 0.6, -0.18 * h, 0.22 * h);
      }
      const skyBottom = nL ? Math.min(floor, BY[nL - 1] + 2) : floor;
      // Gradient strips are blitted WITHOUT smoothing: a bilinear stretch of a 4×256 strip over the screen
      // costs ~6 ms at 1080p on a software rasteriser vs < 1 ms nearest-neighbour; the strips have ≥ 128
      // rows of a smooth gradient, so nearest sampling shows no banding beyond 8-bit quantisation.
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      if (this._skyStrip) {
        ctx.drawImage(this._skyStrip, 0, 0, 4, Math.max(1, 256 * skyBottom / h), 0, 0, w, skyBottom);
      } else {
        ctx.fillStyle = this._skyGrad;
        ctx.fillRect(0, 0, w, skyBottom);
      }
      if (moonW > 0.004) this._drawMoonSky(ctx, w, h, skyBottom, moonW);
      ctx.imageSmoothingEnabled = smooth;
      // 2. stars (twinkle per frame)
      if (this._stars.length) this._drawStars(ctx, w, h, camX * zoom, this._stars, 1);
      if (moonW > 0.004) this._drawStars(ctx, w, h, camX * zoom, this._moonStarSet(), moonW);
      // 3. celestial body (pre-rendered at device resolution); inside THE MOON the sun pales and Earth rises
      this._drawCelestial(ctx, w, h, 1 - 0.72 * moonW);
      if (moonW > 0.004) this._drawEarth(ctx, w, h, moonW);
      if (this._shoot.t >= 0) this._drawShootingStar(ctx, s);
      // 4. far clouds
      const cloudK = 1 - moonW;
      if (cloudK > 0.01) this._drawClouds(ctx, w, h, camX * zoom, 0, cloudK);
      // lightning illuminates the sky behind the layers
      if (this._flash > 0.05) {
        ctx.fillStyle = 'rgba(200,220,255,' + (this._flash * 0.28).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, skyBottom);
        if (this._boltN > 1) this._drawBolt(ctx, w, h);
      }
      // 5. parallax layers (LOW drops the farthest one and the haze strips; fog is baked into the colours)
      const hazeK = 1 - 0.7 * moonW;
      for (let li = low && nL > 3 ? 1 : 0; li < nL; li++) {
        const L = layers[li];
        const f = LAYER_FACTORS[li] || 0.5;
        const scroll = camX * zoom * f;
        const baseY = BY[li];
        const bottom = li < nL - 1 ? Math.min(floor, BY[li + 1] + 1) : floor;
        this._drawLayer(ctx, li, L, w, h, s, scroll, baseY, bottom);
        // haze band at the foot of the three farther layers (pre-rendered gradient strip, stretched)
        if (li < 3 && !low) {
          const bandH = h * (0.2 - li * 0.04);
          const hy = baseY - L.amp * h * 0.45, hh = bandH + L.amp * h * 0.45;
          const vh = Math.min(hh, bottom - hy);
          if (vh > 0.5) {
            ctx.globalAlpha = (li === 0 ? 1 : 0.6) * hazeK;
            if (this._hazeStrip) {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(this._hazeStrip, 0, 0, 4, Math.max(1, 128 * vh / hh), 0, hy, w, vh);
              ctx.imageSmoothingEnabled = smooth;
            } else {
              ctx.save();
              ctx.beginPath(); ctx.rect(0, hy, w, vh); ctx.clip();
              ctx.translate(0, hy);
              ctx.scale(1, hh);
              ctx.fillStyle = this._hazeGrad;
              ctx.fillRect(0, 0, w, 1);
              ctx.restore();
            }
            ctx.globalAlpha = 1;
          }
          const y0 = baseY + bandH - 1;
          if (y0 < bottom) {
            ctx.globalAlpha = hazeK;
            ctx.fillStyle = li === 0 ? this._fogSolid0 : this._fogSolid1;
            ctx.fillRect(0, y0, w, bottom - y0);
            ctx.globalAlpha = 1;
          }
        }
        if (li === 1 && this.cfg.storm && cloudK > 0.01) this._drawClouds(ctx, w, h, camX * zoom, 1, cloudK);
      }
    }

    // Dark vacuum sky of moon_base, cross-faded over the world's own sky (THE MOON section).
    _drawMoonSky(ctx, w, h, bottom, k) {
      if (this._moonStrip === undefined) {
        const P = moonPalette();
        const c = makeCanvas(4, 256);
        const g = c ? c.getContext('2d') : null;
        if (g) {
          const gr = g.createLinearGradient(0, 0, 0, 256);
          gr.addColorStop(0, P.skyTop); gr.addColorStop(0.5, P.skyBottom);
          gr.addColorStop(0.8, P.horizon); gr.addColorStop(1, P.horizon);
          g.fillStyle = gr;
          g.fillRect(0, 0, 4, 256);
          this._moonStrip = c;
        } else this._moonStrip = false;
      }
      ctx.globalAlpha = clamp(k, 0, 1);
      if (this._moonStrip) ctx.drawImage(this._moonStrip, 0, 0, 4, Math.max(1, 256 * bottom / h), 0, 0, w, bottom);
      else { ctx.fillStyle = moonPalette().skyTop; ctx.fillRect(0, 0, w, bottom); }
      ctx.globalAlpha = 1;
    }

    _moonStarSet() {
      if (this._moonStars) return this._moonStars;
      const n = 200, st = new Float32Array(n * 4);
      const rng = U.makeRng(U.hash2(this.seed, 7707));
      for (let i = 0; i < n; i++) {
        st[i * 4] = rng.next();
        st[i * 4 + 1] = Math.pow(rng.next(), 1.4) * 0.72;
        st[i * 4 + 2] = rng.range(0.6, 1.9);
        st[i * 4 + 3] = rng.range(0, TAU);
      }
      return (this._moonStars = st);
    }

    _drawEarth(ctx, w, h, k) {
      let dk = 1;
      try { const tr = ctx.getTransform ? ctx.getTransform() : null; if (tr) dk = clamp(Math.hypot(tr.a, tr.b), 0.5, 3); } catch (e) { dk = 1; }
      dk = Math.round(dk * 4) / 4;
      const key = h + '|' + dk;
      if (this._earthKey !== key) { this._earth = renderCelestial('earth', h * dk, this.pal); this._earthKey = key; }
      const spr = this._earth;
      if (!spr) return;
      // keep clear of the world's own sun / moon
      const own = CELESTIAL_POS[(this.world && this.world.celestial) || 'sun'] || CELESTIAL_POS.sun;
      const x = (own[0] > 0.5 ? 0.24 : 0.76) * w, y = 0.2 * h;
      ctx.globalAlpha = clamp(k, 0, 1);
      ctx.drawImage(spr.canvas, Math.round((x - spr.cx / dk) * dk) / dk, Math.round((y - spr.cy / dk) * dk) / dk, spr.canvas.width / dk, spr.canvas.height / dk);
      ctx.globalAlpha = 1;
    }

    _buildBackdrop(ctx, w, h) {
      const fog = this.pal.fog;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, this.pal.skyTop);
      g.addColorStop(0.5, this.pal.skyBottom);
      g.addColorStop(0.8, this.pal.horizon);
      g.addColorStop(1, this.pal.horizon);
      this._skyGrad = g;
      const hz = ctx.createLinearGradient(0, 0, 0, 1);
      hz.addColorStop(0, rgbaStr(fog, 0));
      hz.addColorStop(1, rgbaStr(fog, Math.min(0.85, fog.a * 2.2)));
      this._hazeGrad = hz;
      this._fogSolid0 = rgbaStr(fog, Math.min(0.85, fog.a * 2.2));
      this._fogSolid1 = rgbaStr(fog, Math.min(0.85, fog.a * 2.2) * 0.6);
      // sky as a tiny vertical gradient strip, stretched over the screen (smooth, cheap, tiny memory)
      const ss = makeCanvas(4, 256);
      const sctx = ss ? ss.getContext('2d') : null;
      if (sctx) {
        const g2 = sctx.createLinearGradient(0, 0, 0, 256);
        g2.addColorStop(0, this.pal.skyTop);
        g2.addColorStop(0.5, this.pal.skyBottom);
        g2.addColorStop(0.8, this.pal.horizon);
        g2.addColorStop(1, this.pal.horizon);
        sctx.fillStyle = g2;
        sctx.fillRect(0, 0, 4, 256);
        this._skyStrip = ss;
      } else this._skyStrip = null;
      const hs = makeCanvas(4, 128);
      const hctx = hs ? hs.getContext('2d') : null;
      if (hctx) {
        const g3 = hctx.createLinearGradient(0, 0, 0, 128);
        g3.addColorStop(0, rgbaStr(fog, 0));
        g3.addColorStop(1, rgbaStr(fog, Math.min(0.85, fog.a * 2.2)));
        hctx.fillStyle = g3;
        hctx.fillRect(0, 0, 4, 128);
        this._hazeStrip = hs;
      } else this._hazeStrip = null;
      this._skyW = w; this._skyH = h;
    }

    _resize(w, h) {
      this._w = w; this._h = h;
      this._skyW = -1;
      this._wInitFor = '';
      const need = Math.ceil(w / 4) + 8;
      if (this._cols.length < need) this._cols = new Float32Array(need);
    }

    _drawStars(ctx, w, h, scrollPx, st, k) {
      st = st || this._stars;
      k = isNum(k) ? k : 1;
      const n = Math.floor((st.length / 4) * this._q.stars);
      const off = scrollPx * 0.004;
      const t = this.time;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        let x = (st[j] * w - off) % w;
        if (x < 0) x += w;
        const y = st[j + 1] * h;
        const sz = st[j + 2];
        ctx.globalAlpha = clamp(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1.3 + sz) + st[j + 3])), 0, 1) * (this.dark || st !== this._stars ? 1 : 0.6) * k;
        ctx.fillRect(x, y, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    _drawCelestial(ctx, w, h, alpha) {
      const kind = (this.world && this.world.celestial) || 'sun';
      // render at the device pixel scale of the current transform so the disc stays crisp at DPR 2
      let k = 1;
      try { const tr = ctx.getTransform ? ctx.getTransform() : null; if (tr) k = clamp(Math.hypot(tr.a, tr.b), 0.5, 3); } catch (e) { k = 1; }
      k = Math.round(k * 4) / 4;
      const key = kind + '|' + h + '|' + k;
      if (this._celestialKey !== key) {
        this._celestial = renderCelestial(kind, h * k, this.pal);
        this._celestialKey = key;
      }
      const spr = this._celestial;
      if (!spr) return;
      const pos = CELESTIAL_POS[kind] || CELESTIAL_POS.sun;
      const x = pos[0] * w, y = pos[1] * h;   // at infinity: no parallax
      const a = isNum(alpha) ? clamp(alpha, 0, 1) : 1;
      if (a <= 0.005) return;
      ctx.globalAlpha = a;
      // snapped to whole device pixels → a 1:1 blit (a sub-pixel offset forces a filtered draw)
      ctx.drawImage(spr.canvas, Math.round((x - spr.cx / k) * k) / k, Math.round((y - spr.cy / k) * k) / k, spr.canvas.width / k, spr.canvas.height / k);
      ctx.globalAlpha = 1;
    }

    _drawShootingStar(ctx, s) {
      const sh = this._shoot;
      const a = clamp(1 - sh.t / 0.9, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(220,235,255,' + (a * 0.9).toFixed(3) + ')';
      ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * 0.12, sh.y - sh.vy * 0.12);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    _ensureCloudSprites(h) {
      const key = this.pal.cloud + '|' + Math.round(h / 40) + '|' + (this.cfg.storm ? 1 : 0);
      if (this._cloudKey === key) return this._cloudSprites;
      this._cloudKey = key;
      this._cloudSprites = [];
      const rng = U.makeRng(U.hash2(this.seed, 991));
      for (let v = 0; v < 3; v++) this._cloudSprites.push(renderCloud(h, this.pal.cloud, rng, !!this.cfg.storm));
      return this._cloudSprites;
    }

    // band 0: all clouds (normal) or the high storm deck; band 1: low churning storm deck
    _drawClouds(ctx, w, h, scrollPx, band, alphaK) {
      const ak = isNum(alphaK) ? alphaK : 1;
      const cl = this._clouds;
      if (!cl.length) return;
      const sprites = this._ensureCloudSprites(h);
      if (!sprites || !sprites.length || !sprites[0]) return;
      const s = h / 720;
      const n = Math.max(1, Math.round(cl.length * this._q.clouds));
      const span = w + 700 * s;
      for (let i = 0; i < n; i++) {
        const c = cl[i];
        if (this.cfg.storm && ((i & 1) !== band)) continue;
        const sp = sprites[c.v % sprites.length];
        const cw = sp.width * c.s, chh = sp.height * c.s;
        let x = (c.u * span - scrollPx * c.depth - this._cloudDrift * s * c.speed * (band ? 1.8 : 1)) % span;
        if (x < 0) x += span;
        x -= 350 * s;
        // churning: storm clouds breathe in scale and alpha
        const churn = this.cfg.storm ? 1 + 0.06 * Math.sin(this.time * 0.7 + c.phase) : 1;
        const y = c.y * h + (band ? h * 0.12 : 0);
        ctx.globalAlpha = ak * this.cfg.cloudAlpha * (this.cfg.storm ? 0.75 + 0.2 * Math.sin(this.time * 0.5 + c.phase) : 1);
        ctx.drawImage(sp, x, y, cw * churn, chh * churn);
      }
      ctx.globalAlpha = 1;
    }

    // ================================================================ silhouette layers
    _drawLayer(ctx, li, L, w, h, s, scroll, baseY, bottom) {
      if (L.kind === 'skyline') { this._drawSkyline(ctx, li, L, w, h, s, scroll, baseY, bottom); return; }
      const step = this._q.step;
      const n = Math.ceil(w / step) + 2;
      if (this._cols.length < n) this._cols = new Float32Array(n + 16);
      const cols = this._cols;
      const noise = this._noise[li];
      const scale = L.scale * s;
      const amp = L.amp * h;
      const gen = GEN[L.kind] || GEN.hills;
      const seed = this.seed + li * 131;
      this._nTops = 0;
      const tipCollect = L.glow || L.smoke;
      for (let i = 0; i < n; i++) {
        const sx = i * step;
        const u = (sx + scroll) / scale;
        const v = clamp(gen(noise, u, seed), 0, 1.2);
        cols[i] = baseY - v * amp;
      }
      // fill silhouette (down to `bottom`: the next layer covers everything below its baseline)
      const floor = isNum(bottom) ? bottom : (isNum(this._floor) ? this._floor : h);
      ctx.fillStyle = this.layerColors[li];
      ctx.beginPath();
      ctx.moveTo(-step, floor);
      for (let i = 0; i < n; i++) ctx.lineTo(i * step - step * 0.5, Math.min(cols[i], floor));
      ctx.lineTo(w + step, floor);
      ctx.closePath();
      ctx.fill();
      if (!this._q.details) return;
      // light rim along the top edge (poster-style highlight on the sun-facing side)
      if (li >= 1) {
        ctx.strokeStyle = this.layerLight[li];
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(1, 1.5 * s);
        ctx.beginPath();
        ctx.moveTo(-step * 0.5, cols[0]);
        for (let i = 1; i < n; i++) ctx.lineTo(i * step - step * 0.5, cols[i]);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const mw = U.safeNum(this.moonW, 0);
      if (L.snow) {
        if (mw > 0) ctx.globalAlpha = 1 - 0.6 * mw;
        this._drawSnowCaps(ctx, L, cols, n, step, baseY, amp, scroll);
        ctx.globalAlpha = 1;
      }
      if (L.strata) this._drawStrata(ctx, li, cols, n, step, baseY, amp);
      if (L.trees && mw < 0.99) {
        if (mw > 0) ctx.globalAlpha = 1 - mw;                 // no forests inside THE MOON
        this._drawTrees(ctx, li, L, cols, step, w, s, scroll, scale);
        ctx.globalAlpha = 1;
      }
      if (tipCollect) this._volcanoTips(ctx, li, L, w, h, s, scroll, scale, baseY, amp, seed, noise);
      if (L.kind === 'spires' && L.glow) this._spireTips(ctx, L, w, s, scroll, scale, baseY, amp, seed, noise);
      if (L.embers) this._layerEmbers(ctx, cols, n, step, s, scroll);
    }

    // Snow caps: the band between the silhouette and a jagged snow line, never thicker than ~22 % of the
    // layer height, so peaks get caps (not a flat white band). Built as one polygon: top edge forward,
    // lower edge backward (zero-height where the ridge is below the snow line).
    _drawSnowCaps(ctx, L, cols, n, step, baseY, amp, scroll) {
      const capY = baseY - amp * L.snow;
      const lower = this._capLow || (this._capLow = new Float32Array(1024));
      if (lower.length < n) this._capLow = new Float32Array(n + 16);
      const low = this._capLow;
      const noise = this._noise[3];
      for (let i = 0; i < n; i++) {
        const y = cols[i];
        // cap thickness grows with height above the (jagged) snow line → tapered caps on the high peaks only
        const jag = amp * 0.06 * noise((i * step + scroll) / (22 * (this._h / 720)));
        const above = capY + jag - y;
        low[i] = above > 0 ? y + Math.min(amp * 0.2, above * 0.9) : y;
      }
      ctx.fillStyle = 'rgba(250,252,255,0.94)';
      ctx.beginPath();
      ctx.moveTo(-step * 0.5, cols[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(i * step - step * 0.5, cols[i]);
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(i * step - step * 0.5, low[i]);
      ctx.closePath();
      ctx.fill();
      // blue shadow on the lee side of each cap (right-facing slopes)
      ctx.fillStyle = 'rgba(150,180,220,0.45)';
      ctx.beginPath();
      let open = false;
      for (let i = 1; i < n; i++) {
        const x = i * step - step * 0.5;
        const falling = cols[i] > cols[i - 1] && low[i] > cols[i] + 0.5;
        if (falling) {
          if (!open) { ctx.moveTo(x - step, cols[i - 1]); open = true; }
          ctx.lineTo(x, cols[i]);
        } else if (open) {
          for (let j = i - 1; j >= 0 && cols[j] > cols[j - 1 < 0 ? 0 : j - 1]; j--) {
            ctx.lineTo(j * step - step * 0.5, (cols[j] + low[j]) * 0.5);
          }
          ctx.closePath();
          open = false;
        }
      }
      ctx.fill();
    }

    _drawStrata(ctx, li, cols, n, step, baseY, amp) {
      ctx.strokeStyle = this.layerLight[li];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, amp * 0.03);
      ctx.beginPath();
      for (let k = 1; k <= 3; k++) {
        const ly = baseY - amp * (0.18 + k * 0.17);
        let open = false;
        for (let i = 0; i < n; i++) {
          const x = i * step - step * 0.5;
          if (cols[i] < ly - 2) { if (!open) { ctx.moveTo(x, ly); open = true; } else ctx.lineTo(x, ly); }
          else open = false;
        }
      }
      ctx.stroke();
      // darker shade band near the base (sun from above)
      ctx.globalAlpha = 1;
    }

    _drawTrees(ctx, li, L, cols, step, w, s, scroll, scale) {
      // trees sit on the silhouette at deterministic world positions (cells in layer space)
      const spacing = (li >= 3 ? 34 : 26) * s;
      const k0 = Math.floor(scroll / spacing) - 1, k1 = Math.ceil((scroll + w) / spacing) + 1;
      ctx.fillStyle = this.layerShade[li];
      ctx.beginPath();
      const size = (li >= 3 ? 16 : 11) * s;
      for (let k = k0; k <= k1; k++) {
        const r = cellRand(this.seed, k, li);
        if (r < 0.45) continue;
        const sx = k * spacing + r * spacing * 0.6 - scroll;
        const ci = Math.round((sx + step * 0.5) / step);
        if (ci < 0 || ci >= cols.length) continue;
        const y = cols[ci] + 2 * s;
        const sz = size * (0.7 + 0.6 * cellRand(this.seed, k, li + 9));
        if (L.trees === 'round') {
          ctx.moveTo(sx + sz * 0.55, y - sz * 0.9);
          ctx.arc(sx, y - sz * 0.9, sz * 0.55, 0, TAU);
          ctx.rect(sx - sz * 0.08, y - sz * 0.5, sz * 0.16, sz * 0.5);
        } else {
          ctx.moveTo(sx, y - sz * 1.8);
          ctx.lineTo(sx + sz * 0.5, y);
          ctx.lineTo(sx - sz * 0.5, y);
          ctx.closePath();
        }
      }
      ctx.fill();
      if (L.trees === 'snowpine') {
        ctx.fillStyle = 'rgba(248,251,255,0.9)';
        ctx.beginPath();
        for (let k = k0; k <= k1; k++) {
          const r = cellRand(this.seed, k, li);
          if (r < 0.45) continue;
          const sx = k * spacing + r * spacing * 0.6 - scroll;
          const ci = Math.round((sx + step * 0.5) / step);
          if (ci < 0 || ci >= cols.length) continue;
          const y = cols[ci] + 2 * s;
          const sz = size * (0.7 + 0.6 * cellRand(this.seed, k, li + 9));
          ctx.moveTo(sx, y - sz * 1.8);
          ctx.lineTo(sx + sz * 0.22, y - sz * 1.0);
          ctx.lineTo(sx - sz * 0.22, y - sz * 1.0);
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    // Volcano craters: glow, lava trickle and rising smoke plumes.
    _volcanoTips(ctx, li, L, w, h, s, scroll, scale, baseY, amp, seed, noise) {
      const u0 = Math.floor(scroll / scale) - 1, u1 = Math.ceil((scroll + w) / scale) + 1;
      const glow = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite(this.pal.hazard) : null;
      for (let k = u0; k <= u1; k++) {
        const c = volcanoCell(seed, k);
        if (!c) continue;
        const sx = (k + c.p) * scale - scroll;
        if (sx < -200 * s || sx > w + 200 * s) continue;
        const v = clamp(GEN.volcanoes(noise, k + c.p, seed), 0, 1.2);
        const y = baseY - v * amp;
        const r = amp * 0.35;
        if (L.glow) {
          ctx.globalCompositeOperation = 'lighter';
          const pulse = 0.75 + 0.25 * Math.sin(this.time * 1.7 + k);
          ctx.globalAlpha = 0.8 * pulse;
          if (glow) ctx.drawImage(glow, sx - r, y - r * 0.8, r * 2, r * 2);
          // lava trickle down the flank
          ctx.strokeStyle = this.pal.hazard;
          ctx.globalAlpha = 0.7 * pulse;
          ctx.lineWidth = Math.max(1, 2.2 * s * (li === 0 ? 1 : 0.8));
          ctx.beginPath();
          ctx.moveTo(sx - 2 * s, y + 2 * s);
          ctx.quadraticCurveTo(sx + c.w * scale * 0.1, y + amp * 0.2, sx + c.w * scale * 0.18, y + amp * 0.45);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        if (L.smoke) {
          // plume: puffs rise, grow and drift with the wind; phase-shifted per volcano
          ctx.fillStyle = this.pal.cloud;
          const puffs = this.quality === 'low' ? 6 : 12;
          for (let j = 0; j < puffs; j++) {
            const ph = frac(this.time * 0.08 + j / puffs + c.p);
            const py = y - ph * amp * 1.3;
            const px = sx + ph * ph * (50 + this._windPx() * 30) * s + Math.sin(ph * 9 + k) * 6 * s;
            const pr = (10 + ph * 42) * s;
            ctx.globalAlpha = 0.42 * (1 - ph) * Math.min(1, ph * 8);
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    _windPx() { return U.safeNum(this._wind, 0); }

    _spireTips(ctx, L, w, s, scroll, scale, baseY, amp, seed, noise) {
      const glow = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite(this.pal.accent) : null;
      if (!glow) return;
      const u0 = Math.floor(scroll / scale) - 1, u1 = Math.ceil((scroll + w) / scale) + 1;
      ctx.globalCompositeOperation = 'lighter';
      for (let k = u0; k <= u1; k++) {
        const r = cellRand(seed, k, 3);
        if (r < 0.35) continue;
        const p = 0.2 + 0.6 * cellRand(seed, k, 4);
        const sx = (k + p) * scale - scroll;
        const v = clamp(GEN.spires(noise, k + p, seed), 0, 1.2);
        const y = baseY - v * amp;
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 2.3 + k * 1.7);
        ctx.globalAlpha = 0.7 * pulse;
        const gr = 16 * s;
        ctx.drawImage(glow, sx - gr, y - gr, gr * 2, gr * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _layerEmbers(ctx, cols, n, step, s, scroll) {
      // sparse glowing fissures on the near volcanic ridge, anchored to world position (hashed cells)
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.pal.hazard;
      ctx.globalAlpha = 0.3 + 0.12 * Math.sin(this.time * 2);
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.beginPath();
      const cell = 90 * s;
      const k0 = Math.floor(scroll / cell), k1 = Math.ceil((scroll + n * step) / cell);
      for (let k = k0; k <= k1; k++) {
        const r = cellRand(this.seed, k, 61);
        if (r < 0.5) continue;
        const x = k * cell - scroll + cell * cellRand(this.seed, k, 62);
        const ci = Math.round((x + step * 0.5) / step);
        if (ci < 0 || ci >= n) continue;
        const y = cols[ci] + (10 + 16 * cellRand(this.seed, k, 63)) * s;
        const d = r > 0.75 ? 1 : -1, len = (10 + 14 * r) * s;
        ctx.moveTo(x, y);
        ctx.lineTo(x + d * len * 0.35, y + len * 0.45);
        ctx.lineTo(x + d * len * 0.1, y + len);
        ctx.moveTo(x + d * len * 0.35, y + len * 0.45);
        ctx.lineTo(x + d * len * 0.8, y + len * 0.6);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Blocky skyline with lit windows, rooftop antennas and neon strips.
    _drawSkyline(ctx, li, L, w, h, s, scroll, baseY, bottom) {
      const cellW = L.scale * s;
      const amp = L.amp * h;
      const k0 = Math.floor(scroll / cellW) - 1, k1 = Math.ceil((scroll + w) / cellW) + 1;
      const seed = this.seed + li * 131;
      const col = this.layerColors[li];
      const floor = isNum(bottom) ? bottom : (isNum(this._floor) ? this._floor : h);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-10, floor);
      for (let k = k0; k <= k1; k++) {
        const b = building(seed, k);
        const x0 = k * cellW - scroll + b.inset * cellW, x1 = x0 + b.width * cellW;
        const top = baseY - b.h * amp;
        const by = Math.min(baseY, floor);
        ctx.lineTo(x0, by);
        ctx.lineTo(x0, Math.min(top, floor));
        if (b.roof === 1 && top < floor) { ctx.lineTo((x0 + x1) / 2, top - cellW * 0.25); }
        ctx.lineTo(x1, Math.min(top, floor));
        ctx.lineTo(x1, by);
      }
      ctx.lineTo(w + 10, floor);
      ctx.closePath();
      ctx.fill();
      if (baseY < floor) ctx.fillRect(-10, baseY - 1, w + 20, floor - baseY + 1);
      // antennas
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const b = building(seed, k);
        if (b.antenna < 0.7) continue;
        const x = k * cellW - scroll + (b.inset + b.width * 0.5) * cellW;
        const top = baseY - b.h * amp;
        ctx.moveTo(x, top);
        ctx.lineTo(x, top - cellW * 0.5);
      }
      ctx.stroke();
      if (!this._q.windows) return;
      // lit windows: deterministic per building & window; two warm/cool colours, one path each
      const ww = Math.max(2, 3.2 * s * (0.7 + li * 0.2)), wh = Math.max(2, 4 * s * (0.7 + li * 0.2));
      const gx = ww * 2.2, gy = wh * 2;
      const lit = L.windows || 0.3;
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? '#ffd98a' : '#8ff4ff';
        ctx.globalAlpha = li === 0 ? 0.55 : 0.85;
        ctx.beginPath();
        for (let k = k0; k <= k1; k++) {
          const b = building(seed, k);
          const x0 = k * cellW - scroll + b.inset * cellW, bw = b.width * cellW;
          if (x0 > w || x0 + bw < 0) continue;
          const top = baseY - b.h * amp;
          const nc = Math.floor((bw - ww) / gx), nr = Math.min(40, Math.floor((Math.min(baseY, floor) - top - wh * 2) / gy));
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              const hsh = U.hash2(seed + k * 977, r * 64 + c);
              if ((hsh & 1023) / 1024 > lit) continue;
              if (((hsh >>> 10) & 3) === 0 ? pass !== 1 : pass !== 0) continue;
              ctx.rect(x0 + ww * 0.8 + c * gx, top + wh * 1.4 + r * gy, ww, wh);
            }
          }
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // neon strips + blinking roof beacons
      if (L.neon) {
        ctx.globalCompositeOperation = 'lighter';
        for (let k = k0; k <= k1; k++) {
          const b = building(seed, k);
          if (b.neon > L.neon) continue;
          const x0 = k * cellW - scroll + b.inset * cellW, bw = b.width * cellW;
          const top = baseY - b.h * amp;
          const c = b.neonHue < 0.5 ? '#ff2fd0' : '#1ff2ff';
          const flick = 0.75 + 0.25 * Math.sin(this.time * 3 + k * 2.1);
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.9 * flick;
          const vx = x0 + bw * (b.neonHue < 0.5 ? 0.12 : 0.78);
          ctx.fillRect(vx, top + amp * 0.08, Math.max(2, 3 * s), amp * 0.35 * b.h + 6 * s);
          ctx.globalAlpha = 0.25 * flick;
          ctx.fillRect(vx - 4 * s, top + amp * 0.06, Math.max(6, 11 * s), amp * 0.35 * b.h + 10 * s);
          // roofline edge light
          ctx.globalAlpha = 0.6 * flick;
          ctx.fillRect(x0, top, bw, Math.max(1, 1.5 * s));
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = '#ff3b5c';
      for (let k = k0; k <= k1; k++) {
        const b = building(seed, k);
        if (b.antenna < 0.7) continue;
        if (Math.sin(this.time * 2.5 + k) < 0.4) continue;
        const x = k * cellW - scroll + (b.inset + b.width * 0.5) * cellW;
        const top = baseY - b.h * amp - cellW * 0.5;
        ctx.fillRect(x - 1.5 * s, top - 1.5 * s, 3 * s, 3 * s);
      }
    }

    // ================================================================ weather
    _initWeather(w, h) {
      const amb = (this.world && this.world.ambient) || 'pollen';
      const A = AMBIENT[amb] || AMBIENT.pollen;
      const n = Math.min(this._wcap - 40, Math.round(A.n * this._q.weather * (amb === 'mist' ? 1 : Math.max(0.6, w / 1280))));
      this._wn = n;
      this._amb = amb;
      for (let i = 0; i < this._wcap; i++) this._spawnW(i, w, h, true);   // uses this._amb
      this._wInitFor = 'ok';
      this._wAmb = amb; this._wW = w; this._wH = h; this._wQ = this.quality;
    }

    _weatherStale(w, h) {
      return this._wInitFor !== 'ok' || this._wW !== w || this._wH !== h || this._wQ !== this.quality ||
        this._wAmb !== ((this.world && this.world.ambient) || 'pollen');
    }

    _spawnW(i, w, h, anywhere) {
      this._wx[i] = Math.random() * w;
      this._wy[i] = anywhere ? (this._amb === 'pollen' ? h * (0.3 + 0.7 * Math.random()) : Math.random() * h) : -10;
      this._ws[i] = Math.random();           // depth / size 0..1
      this._wp[i] = Math.random() * TAU;     // phase
      this._wv[i] = 0.6 + Math.random() * 0.8;
    }

    _updateWeather(dt, camera) {
      const w = this._w, h = this._h;
      if (!(w > 0) || !(h > 0)) return;
      if (this._weatherStale(w, h)) this._initWeather(w, h);
      // camera motion → particles move against it (depth-scaled), so weather feels in-world
      let dxp = 0, dyp = 0;
      if (camera) {
        const cx = isNum(camera.cx) ? camera.cx : U.safeNum(camera.x, 0);
        const cy = isNum(camera.cy) ? camera.cy : U.safeNum(camera.y, 0);
        const z = camera.zoom > 0 ? camera.zoom : h / 15;
        if (this._prevCamX !== null) {
          dxp = clamp((cx - this._prevCamX) * z, -200, 200);
          dyp = clamp((cy - this._prevCamY) * z, -200, 200);
        }
        this._prevCamX = cx; this._prevCamY = cy;
      }
      const s = h / 720;
      const wind = U.safeNum(this._wind, 0);
      const amb = this._amb;
      const total = Math.min(this._wcap, this._wn + Math.round(this._rainN * 200 * this._q.weather));
      if (amb === 'stars') {
        // occasional shooting star
        const sh = this._shoot;
        if (sh.t >= 0) {
          sh.t += dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt;
          if (sh.t > 0.9) { sh.t = -1; sh.next = 5 + Math.random() * 9; }
        } else if ((sh.next -= dt) <= 0) {
          sh.t = 0; sh.x = Math.random() * w * 0.8 + w * 0.1; sh.y = Math.random() * h * 0.25;
          sh.vx = (Math.random() < 0.5 ? -1 : 1) * 700 * s; sh.vy = 260 * s;
        }
      }
      for (let i = 0; i < total; i++) {
        const d = this._ws[i];
        const par = 0.3 + 0.7 * d;
        let x = this._wx[i] - dxp * par, y = this._wy[i] + dyp * par;
        const rain = i >= this._wn;
        const kind = rain ? 'storm_rain' : amb;
        switch (kind) {
          case 'pollen':
            x += (12 + wind * 10) * s * dt * this._wv[i] + Math.sin(this.time * 0.8 + this._wp[i]) * 8 * s * dt;
            y += Math.cos(this.time * 0.6 + this._wp[i]) * 10 * s * dt;
            if (y < h * 0.3) y += h * 0.02;          // drift back down: pollen hangs low over the meadows
            break;
          case 'mist':
            x += (6 + wind * 4) * s * dt * this._wv[i];
            break;
          case 'sand':
            x += (420 + wind * 60) * s * dt * (0.5 + d);
            y += 40 * s * dt * this._wv[i];
            break;
          case 'snow':
            x += (wind * 18 + Math.sin(this.time * 1.3 + this._wp[i]) * 22) * s * dt;
            y += (40 + 80 * d) * s * dt * this._wv[i];
            break;
          case 'embers':
            x += (wind * 14 + Math.sin(this.time * 2 + this._wp[i]) * 18) * s * dt;
            y -= (30 + 50 * d) * s * dt * this._wv[i];
            break;
          case 'neon_rain':
          case 'storm_rain': {
            const fall = (kind === 'neon_rain' ? 900 : 1150) * s * (0.6 + 0.4 * d);
            y += fall * dt;
            x += (wind * 60 + (kind === 'storm_rain' ? 160 : 40)) * s * dt;
            break;
          }
          default: break;
        }
        // wrap around the screen
        const m = kind === 'mist' ? w * 0.4 : 30;
        if (x > w + m) x -= w + 2 * m; else if (x < -m) x += w + 2 * m;
        if (y > h + 30) { y = -20; x = Math.random() * w; } else if (y < -30) { y = h + 20; x = Math.random() * w; }
        this._wx[i] = x; this._wy[i] = y;
      }
    }

    drawWeather(ctx, camera, w, h, env) {
      if (!ctx || !(w > 0) || !(h > 0)) return;
      if (w !== this._w || h !== this._h) this._resize(w, h);
      if (this._weatherStale(w, h)) this._initWeather(w, h);
      const s = h / 720;
      const amb = this._amb;
      const n = this._wn;
      const X = this._wx, Y = this._wy, S = this._ws, P = this._wp;
      const t = this.time;
      // ambient weather (pollen, snow, embers…) thins out inside a MOON section (no air up there)
      const am = 1 - U.safeNum(this.moonW, 0);
      if (am > 0.01) {
        switch (amb) {
          case 'pollen':
            ctx.fillStyle = '#fff1a8';
            for (let i = 0; i < n; i++) {
              ctx.globalAlpha = clamp(0.25 + 0.3 * Math.sin(t * 2 + P[i]), 0, 1) * am;
              const r = (1 + 2 * S[i]) * s;
              ctx.fillRect(X[i] - r / 2, Y[i] - r / 2, r, r);
            }
            break;
          case 'mist': {
            const spr = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite('#e8eef2') : null;
            if (spr) {
              for (let i = 0; i < n; i++) {
                ctx.globalAlpha = (0.1 + 0.08 * S[i]) * am;
                const mw = w * (0.35 + 0.35 * S[i]), mh = h * (0.12 + 0.1 * S[i]);
                ctx.drawImage(spr, X[i] - mw / 2, h * 0.55 + (Y[i] / h) * h * 0.4 - mh / 2, mw, mh);
              }
            }
            break;
          }
          case 'sand': {
            // streak direction follows the (signed) sand velocity, so a headwind reverses the blow
            const vx = 420 + this._windPx() * 60;
            const dirx = vx >= 0 ? 1 : -1;
            ctx.strokeStyle = '#f1d49a';
            ctx.lineWidth = Math.max(1, 1.2 * s);
            ctx.globalAlpha = 0.45 * am;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
              const len = (10 + 24 * S[i]) * s;
              ctx.moveTo(X[i], Y[i]);
              ctx.lineTo(X[i] - dirx * len, Y[i] - len * 0.08);
            }
            ctx.stroke();
            break;
          }
          case 'snow':
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < n; i++) {
              const r = (0.8 + 2.4 * S[i]) * s;
              ctx.globalAlpha = (0.55 + 0.4 * S[i]) * am;
              ctx.beginPath();
              ctx.arc(X[i], Y[i], r, 0, TAU);
              ctx.fill();
            }
            break;
          case 'embers': {
            ctx.globalCompositeOperation = 'lighter';
            const spr = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite('#ff7a1c') : null;
            ctx.fillStyle = '#ffb347';
            for (let i = 0; i < n; i++) {
              const r = (2 + 4 * S[i]) * s;
              ctx.globalAlpha = clamp(0.5 + 0.5 * Math.sin(t * 7 + P[i] * 3), 0, 1) * am;
              if (spr) ctx.drawImage(spr, X[i] - r * 2, Y[i] - r * 2, r * 4, r * 4);
              else ctx.fillRect(X[i], Y[i], r, r);
            }
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'neon_rain':
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineWidth = Math.max(1, 1.3 * s);
            for (let pass = 0; pass < 2; pass++) {
              ctx.strokeStyle = pass === 0 ? '#ff4fd8' : '#4ff6ff';
              ctx.globalAlpha = 0.3 * am;
              ctx.beginPath();
              for (let i = pass; i < n; i += 2) {
                const len = (14 + 20 * S[i]) * s;
                const sl = rainSlant(this._windPx(), 40, 900, S[i]);
                ctx.moveTo(X[i], Y[i]);
                ctx.lineTo(X[i] - len * sl, Y[i] - len);
              }
              ctx.stroke();
            }
            ctx.globalCompositeOperation = 'source-over';
            break;
          case 'storm_rain':
            ctx.globalAlpha = am;
            this._drawRain(ctx, 0, n, s, 'rgba(190,210,235,0.34)');
            break;
          default: break;
        }
        ctx.globalAlpha = 1;
      }
      // extra rain from env.rain (any world)
      const total = Math.min(this._wcap, n + Math.round(this._rainN * 200 * this._q.weather));
      if (total > n) this._drawRain(ctx, n, total, s, 'rgba(200,215,240,0.3)');
      // ambient wind: faint screen-space streaks once the wind is strong (storm sections show it in the rain)
      this._drawWindStreaks(ctx, w, h, s);
      // ground fog / heat haze
      const fogAmt = ((this.cfg.mist ? 0.6 : 0) + (amb === 'sand' ? 0.5 : 0)) * am + (env && isNum(env.fog) ? clamp(env.fog, 0, 1) : 0);
      if (fogAmt > 0.01) {
        if (!this._fogGrad || this._fogKey !== h) {
          const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
          g.addColorStop(0, rgbaStr(this.pal.fog, 0));
          g.addColorStop(1, rgbaStr(this.pal.fog, Math.min(0.7, this.pal.fog.a * 1.6)));
          this._fogGrad = g; this._fogKey = h;
        }
        ctx.globalAlpha = clamp(fogAmt, 0, 1);
        ctx.fillStyle = this._fogGrad;
        ctx.fillRect(0, h * 0.55, w, h * 0.45);
        ctx.globalAlpha = 1;
      }
      // lightning: bolt + full-screen flash
      if (this._flash > 0.02) {
        if (this._flash > 0.3 && this._boltN > 1) this._drawBolt(ctx, w, h);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(190,210,255,' + (this._flash * 0.35).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Wind streaks: thin white dashes blowing with env.wind (m/s²). Invisible below ~2.5, full at ~10.
    // Deterministic (hashed lanes × time), so nothing is allocated or stored.
    _drawWindStreaks(ctx, w, h, s) {
      const wind = this._windPx();
      const k = U.smoothstep(2.5, 10, Math.abs(wind)) * (1 - 0.8 * this._rainN) * (1 - U.safeNum(this.moonW, 0));
      if (k <= 0.02) return;
      const dir = wind < 0 ? -1 : 1;
      const lanes = Math.round((this.quality === 'low' ? 10 : 18) * Math.max(0.7, w / 1280));
      const speed = (500 + 60 * Math.abs(wind)) * s;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.lineCap = 'round';
      const span = w + 400 * s;
      for (let i = 0; i < lanes; i++) {
        const r1 = cellRand(this.seed, i, 81), r2 = cellRand(this.seed, i, 82), r3 = cellRand(this.seed, i, 83);
        const len = (60 + 110 * r2) * s * (0.6 + 0.4 * k);
        let x = (r3 * span + dir * this.time * speed * (0.7 + 0.6 * r1)) % span;
        if (x < 0) x += span;
        x -= 200 * s;
        const y = h * (0.12 + 0.72 * r1) + Math.sin(this.time * 1.7 + i * 2.3) * 10 * s;
        ctx.globalAlpha = k * (0.1 + 0.16 * r2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - dir * len * 0.5, y - 3 * s, x - dir * len, y + 2 * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }

    _drawRain(ctx, a, b, s, color) {
      const X = this._wx, Y = this._wy, S = this._ws;
      const wind = this._windPx();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.beginPath();
      for (let i = a; i < b; i++) {
        const len = (16 + 22 * S[i]) * s;
        const sl = rainSlant(wind, 160, 1150, S[i]);   // streak matches the drop's own velocity
        ctx.moveTo(X[i], Y[i]);
        ctx.lineTo(X[i] - len * sl, Y[i] - len);
      }
      ctx.stroke();
    }

    _makeBolt() {
      const n = 12;
      let x = 0.15 + Math.random() * 0.7, y = 0;
      const b = this._bolt;
      for (let i = 0; i < n; i++) {
        b[i * 2] = x; b[i * 2 + 1] = y;
        x += (Math.random() - 0.5) * 0.06;
        y += 0.03 + Math.random() * 0.03;
      }
      this._boltN = n;
      // a short side branch from a random joint
      const j = 3 + Math.floor(Math.random() * 5);
      const br = this._boltBranch;
      let bx = b[j * 2], by = b[j * 2 + 1];
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 6; i++) {
        br[i * 2] = bx; br[i * 2 + 1] = by;
        bx += dir * (0.012 + Math.random() * 0.02); by += 0.015 + Math.random() * 0.02;
      }
    }

    _drawBolt(ctx, w, h) {
      const b = this._bolt, br = this._boltBranch;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? 'rgba(150,180,255,' + (this._flash * 0.5).toFixed(3) + ')' : 'rgba(255,255,255,' + this._flash.toFixed(3) + ')';
        ctx.lineWidth = (pass === 0 ? 7 : 2) * (h / 720);
        ctx.beginPath();
        ctx.moveTo(b[0] * w, b[1] * h);
        for (let i = 1; i < this._boltN; i++) ctx.lineTo(b[i * 2] * w, b[i * 2 + 1] * h);
        ctx.moveTo(br[0] * w, br[1] * h);
        for (let i = 1; i < 6; i++) ctx.lineTo(br[i * 2] * w, br[i * 2 + 1] * h);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------------------ silhouette generators (0..1)
  function ridged(n, u) {
    const a = 1 - Math.abs(n(u));
    const b = 1 - Math.abs(n(u * 2.1 + 5.3));
    const c = 1 - Math.abs(n(u * 4.3 + 11.7));
    return (a * a * 0.62 + b * b * 0.27 + c * c * 0.11);
  }
  function volcanoCell(seed, k) {
    const r = cellRand(seed, k, 11);
    if (r < 0.38) return null;
    return { p: 0.3 + 0.4 * cellRand(seed, k, 12), h: 0.6 + 0.4 * cellRand(seed, k, 13), w: 0.55 + 0.25 * cellRand(seed, k, 14) };
  }
  const bCache = { k: NaN, seed: NaN, v: { width: 1, inset: 0, h: 0.5, roof: 0, antenna: 0, neon: 1, neonHue: 0 } };
  function building(seed, k) {
    if (bCache.k === k && bCache.seed === seed) return bCache.v;
    const v = bCache.v;
    v.width = 0.55 + 0.4 * cellRand(seed, k, 21);
    v.inset = (1 - v.width) * cellRand(seed, k, 22);
    const r = cellRand(seed, k, 23);
    v.h = 0.25 + 0.6 * r * r + (cellRand(seed, k, 24) > 0.88 ? 0.25 : 0);
    v.roof = cellRand(seed, k, 25) > 0.85 ? 1 : 0;
    v.antenna = cellRand(seed, k, 26);
    v.neon = cellRand(seed, k, 27);
    v.neonHue = cellRand(seed, k, 28);
    bCache.k = k; bCache.seed = seed;
    return v;
  }
  const GEN = {
    hills(n, u) { return 0.5 + 0.75 * U.fbm1D(n, u * 0.9, 3, 2, 0.5); },
    mountains(n, u) { return 0.1 + 1.05 * ridged(n, u * 0.8); },
    crags(n, u) {
      // ridged base + sawtooth teeth modulated by noise → broken, jagged crags
      const r = ridged(n, u);
      const saw = frac(u * 5.3 + n(u * 0.7) * 2);
      return 0.12 + 0.9 * r + 0.1 * saw * (0.5 + 0.5 * n(u * 1.9 + 3));
    },
    mesas(n, u) {
      const v = n(u * 0.9);
      const plateau = U.smoothstep(0.02, 0.1, v);
      const tier = U.smoothstep(0.28, 0.34, v) * 0.18;
      return 0.18 + plateau * (0.62 + 0.12 * n(u * 0.25 + 9)) + tier + 0.03 * n(u * 5);
    },
    dunes(n, u) {
      const t = frac(u * 0.8 + 0.4 * n(u * 0.35));
      const d = t < 0.72 ? t / 0.72 : (1 - t) / 0.28;       // long windward slope, steep lee face
      return 0.25 + 0.55 * d * d * (3 - 2 * d) * (0.75 + 0.25 * n(u * 0.2 + 4));
    },
    peaks(n, u, seed) {
      const k = Math.floor(u);
      let best = 0.08 + 0.1 * n(u * 3);
      for (let j = k - 1; j <= k + 1; j++) {
        const p = j + 0.25 + 0.5 * cellRand(seed, j, 31);
        const hgt = 0.55 + 0.45 * cellRand(seed, j, 32);
        const wd = 0.55 + 0.3 * cellRand(seed, j, 33);
        const d = Math.abs(u - p) / wd;
        if (d < 1) {
          const v = hgt * Math.pow(1 - d, 1.25) + 0.03 * n(u * 9 + j);
          if (v > best) best = v;
        }
      }
      return best;
    },
    volcanoes(n, u, seed) {
      const k = Math.floor(u);
      let best = 0.12 + 0.08 * n(u * 2.3);
      for (let j = k - 1; j <= k + 1; j++) {
        const c = volcanoCell(seed, j);
        if (!c) continue;
        const d = Math.abs(u - (j + c.p)) / c.w;
        if (d < 1) {
          let v = c.h * Math.pow(1 - d, 1.7);
          if (d < 0.07) v -= (0.07 - d) * 0.9;              // crater notch at the summit
          if (v > best) best = v;
        }
      }
      return best;
    },
    craters(n, u, seed) {
      const k = Math.floor(u);
      let v = 0.3 + 0.15 * U.fbm1D(n, u * 0.6, 2, 2, 0.5);
      for (let j = k - 1; j <= k + 1; j++) {
        if (cellRand(seed, j, 41) < 0.3) continue;
        const p = j + 0.5 * cellRand(seed, j, 42) + 0.25;
        const r = 0.18 + 0.22 * cellRand(seed, j, 43);
        const d = Math.abs(u - p) / r;
        if (d < 1) v -= 0.16 * (1 - d * d);                 // bowl
        const e = (d - 1) / 0.25;
        v += 0.14 * Math.exp(-e * e);                       // raised rim
      }
      return v;
    },
    spires(n, u, seed) {
      const base = 0.1 + 0.18 * ridged(n, u * 0.6);
      const k = Math.floor(u);
      let best = base;
      for (let j = k - 1; j <= k + 1; j++) {
        if (cellRand(seed, j, 3) < 0.35) continue;
        const p = j + 0.2 + 0.6 * cellRand(seed, j, 4);
        const hgt = 0.55 + 0.45 * cellRand(seed, j, 5);
        const wd = 0.1 + 0.08 * cellRand(seed, j, 6);
        const d = Math.abs(u - p) / wd;
        if (d < 1) {
          const v = base + (hgt - base) * Math.pow(1 - d, 0.65);   // concave needle
          if (v > best) best = v;
        }
      }
      return best;
    }
  };

  // ------------------------------------------------------------------ pre-rendered sprites
  const CELESTIAL_POS = {
    sun: [0.8, 0.18], big_sun: [0.64, 0.36], red_moon: [0.76, 0.2], earth: [0.74, 0.22],
    neon_moon: [0.5, 0.4], storm_sun: [0.3, 0.2]
  };

  function renderCelestial(kind, h, pal) {
    const R = { sun: 0.065, big_sun: 0.14, red_moon: 0.07, earth: 0.085, neon_moon: 0.16, storm_sun: 0.06 }[kind] * h || 0.065 * h;
    const halo = R * (kind === 'big_sun' ? 2.4 : kind === 'neon_moon' ? 1.8 : kind === 'earth' ? 1.35 : 3.2);
    const size = Math.ceil(halo * 2 + 4);
    const c = makeCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    if (!g) return null;
    const cx = size / 2, cy = size / 2;
    const radial = (r0, r1, stops) => {
      const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      for (const s of stops) gr.addColorStop(s[0], s[1]);
      return gr;
    };
    switch (kind) {
      case 'sun':
        g.fillStyle = radial(R * 0.8, halo, [[0, 'rgba(255,245,200,0.55)'], [0.35, 'rgba(255,236,170,0.18)'], [1, 'rgba(255,236,170,0)']]);
        g.fillRect(0, 0, size, size);
        g.fillStyle = radial(0, R, [[0, '#fffdf0'], [0.75, '#fff2b8'], [1, '#ffe38a']]);
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
        break;
      case 'big_sun': {
        g.fillStyle = radial(R * 0.9, halo, [[0, 'rgba(255,214,140,0.5)'], [0.5, 'rgba(255,190,120,0.15)'], [1, 'rgba(255,190,120,0)']]);
        g.fillRect(0, 0, size, size);
        g.fillStyle = radial(0, R, [[0, '#fff6d8'], [0.6, '#ffd98a'], [1, '#ffb15a']]);
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
        // heat-shimmer bands across the lower half
        g.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 4; k++) {
          const y = cy + R * (0.3 + k * 0.18);
          g.fillStyle = 'rgba(0,0,0,0.55)';
          g.fillRect(cx - R, y, R * 2, R * (0.035 + k * 0.012));
        }
        g.globalCompositeOperation = 'source-over';
        break;
      }
      case 'red_moon':
        g.fillStyle = radial(R * 0.9, halo, [[0, 'rgba(255,90,40,0.45)'], [0.4, 'rgba(200,40,20,0.14)'], [1, 'rgba(200,40,20,0)']]);
        g.fillRect(0, 0, size, size);
        g.fillStyle = radial(0, R, [[0, '#ff9a6a'], [0.7, '#e0482a'], [1, '#a82414']]);
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
        g.fillStyle = 'rgba(110,20,10,0.35)';
        for (const cr of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.35, -0.35, 0.1], [-0.1, 0.45, 0.12]]) {
          g.beginPath(); g.arc(cx + cr[0] * R, cy + cr[1] * R, cr[2] * R, 0, TAU); g.fill();
        }
        break;
      case 'earth': {
        g.fillStyle = radial(R * 0.95, halo, [[0, 'rgba(120,190,255,0.5)'], [0.35, 'rgba(90,160,255,0.12)'], [1, 'rgba(90,160,255,0)']]);
        g.fillRect(0, 0, size, size);
        g.save();
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
        g.fillStyle = radial(0, R, [[0, '#4aa3ff'], [1, '#1c4fb8']]);
        g.fillRect(cx - R, cy - R, R * 2, R * 2);
        g.fillStyle = '#4fae5b';
        for (const b of [[-0.35, -0.25, 0.42, 0.28, 0.4], [0.3, 0.15, 0.35, 0.5, -0.3], [-0.1, 0.55, 0.3, 0.16, 0.2], [0.45, -0.5, 0.2, 0.14, 0.8]]) {
          g.beginPath(); g.ellipse(cx + b[0] * R, cy + b[1] * R, b[2] * R, b[3] * R, b[4], 0, TAU); g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = R * 0.08;
        g.lineCap = 'round';
        for (const s of [[-0.7, -0.5, 0.1, -0.62], [-0.2, 0.1, 0.6, -0.05], [-0.6, 0.4, 0.2, 0.32]]) {
          g.beginPath(); g.moveTo(cx + s[0] * R, cy + s[1] * R); g.quadraticCurveTo(cx, cy + (s[1] - 0.1) * R, cx + s[2] * R, cy + s[3] * R); g.stroke();
        }
        // night side terminator
        g.fillStyle = 'rgba(2,6,20,0.62)';
        g.beginPath(); g.arc(cx + R * 0.55, cy + R * 0.2, R * 1.05, 0, TAU); g.fill();
        g.restore();
        g.strokeStyle = 'rgba(160,210,255,0.65)';
        g.lineWidth = Math.max(1, R * 0.05);
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
        break;
      }
      case 'neon_moon': {
        g.fillStyle = radial(R * 0.9, halo, [[0, 'rgba(255,60,200,0.45)'], [0.5, 'rgba(255,60,200,0.12)'], [1, 'rgba(255,60,200,0)']]);
        g.fillRect(0, 0, size, size);
        const lg = g.createLinearGradient(0, cy - R, 0, cy + R);
        lg.addColorStop(0, '#ffe45c'); lg.addColorStop(0.5, '#ff7a6b'); lg.addColorStop(1, '#ff2fd0');
        g.fillStyle = lg;
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
        // synthwave slats cut out of the lower half
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        for (let k = 0; k < 6; k++) {
          const y = cy + R * (0.05 + k * 0.16);
          g.fillRect(cx - R, y, R * 2, R * (0.03 + k * 0.022));
        }
        g.globalCompositeOperation = 'source-over';
        break;
      }
      case 'storm_sun':
      default:
        g.fillStyle = radial(R * 0.5, halo, [[0, 'rgba(210,230,255,0.35)'], [0.4, 'rgba(160,190,230,0.1)'], [1, 'rgba(160,190,230,0)']]);
        g.fillRect(0, 0, size, size);
        g.fillStyle = 'rgba(235,242,255,0.8)';
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
        break;
    }
    return { canvas: c, cx, cy };
  }

  // A soft vector cloud: overlapping discs with a flat, shaded base.
  function renderCloud(h, color, rng, storm) {
    const s = h / 720;
    const W = Math.ceil((storm ? 420 : 260) * s), H = Math.ceil((storm ? 170 : 110) * s);
    const c = makeCanvas(W, H);
    if (!c) return null;
    const g = c.getContext('2d');
    if (!g) return null;
    const base = H * 0.78;
    g.fillStyle = color;
    g.beginPath();
    const n = storm ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const r = (storm ? 46 : 30) * s * (0.7 + 0.6 * Math.sin(t * Math.PI)) * rng.range(0.8, 1.15);
      const x = W * (0.12 + 0.76 * t);
      const y = base - r * rng.range(0.5, 0.9);
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, TAU);
    }
    g.rect(W * 0.1, base - 12 * s, W * 0.8, 12 * s);
    g.fill();
    // shade the underside (source-atop keeps it inside the cloud)
    g.globalCompositeOperation = 'source-atop';
    const lg = g.createLinearGradient(0, H * 0.25, 0, base);
    lg.addColorStop(0, 'rgba(255,255,255,' + (storm ? 0.05 : 0.25) + ')');
    lg.addColorStop(1, storm ? 'rgba(0,0,10,0.45)' : 'rgba(80,110,150,0.28)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  // ------------------------------------------------------------------ world-card thumbnails
  const thumbCache = new Map();
  const THUMB_CAM = { x: 0, y: 0, cx: 0, cy: 0, zoom: 30 };
  Background.drawThumbnail = function (ctx, w, h, world) {
    if (!ctx || !(w > 0) || !(h > 0)) return;
    const W = RR.Worlds;
    if (typeof world === 'string' && W) world = W.byId(world);
    if (!world || !world.palette) world = W && W.list ? W.list[0] : null;
    if (!world) return;
    const key = world.id + '|' + Math.round(w) + 'x' + Math.round(h);
    let cached = thumbCache.get(key);
    if (cached === undefined) {
      const c = makeCanvas(w, h);
      cached = c;
      if (c) paintThumbnail(c.getContext('2d'), w, h, world);
      if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value);
      thumbCache.set(key, cached);
    }
    if (cached) ctx.drawImage(cached, 0, 0, w, h);
    else paintThumbnail(ctx, w, h, world);
  };

  function paintThumbnail(ctx, w, h, world) {
    if (!ctx) return;
    const bg = new Background(world, U.hashString(world.id + '|thumb'));
    bg.setQuality('high');
    const cam = THUMB_CAM;
    cam.zoom = h / 12;
    cam.x = cam.cx = 40; cam.y = cam.cy = 0;
    bg.update(0.016, cam, null);
    bg.time = 1.3;
    bg.drawSky(ctx, cam, w, h, null);
    // ground strip: gentle seeded hill with a bright top band
    const P = world.palette;
    const n = U.makeNoise1D(U.hashString(world.id + '|strip'));
    const gy = (x) => h * 0.8 - h * 0.07 * U.fbm1D(n, x / (w * 0.35), 2, 2, 0.5);
    const step = Math.max(4, w / 60);
    const trace = (off) => {
      ctx.beginPath();
      ctx.moveTo(-2, h + 2);
      for (let x = -2; x <= w + step; x += step) ctx.lineTo(x, gy(x) + off);
      ctx.lineTo(w + 2, h + 2);
      ctx.closePath();
    };
    ctx.fillStyle = P.groundTop; trace(0); ctx.fill();
    ctx.fillStyle = P.groundTopDark || P.groundTop; trace(h * 0.025); ctx.fill();
    ctx.fillStyle = P.ground; trace(h * 0.045); ctx.fill();
    ctx.fillStyle = P.groundDeep; trace(h * 0.12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, h / 160);
    ctx.beginPath();
    for (let x = -2; x <= w + step; x += step) { if (x === -2) ctx.moveTo(x, gy(x)); else ctx.lineTo(x, gy(x)); }
    ctx.stroke();
    // tiny accent: two world decorations standing on the strip (uses the renderer's painter if loaded)
    const R = RR.Renderer;
    const decos = world.decorations || [];
    if (R && typeof R.drawDecoration === 'function' && decos.length) {
      const scale = h / 9; // px per metre
      const spots = [0.18, 0.84];
      for (let i = 0; i < spots.length; i++) {
        const type = decos[i % decos.length];
        const x = w * spots[i];
        ctx.save();
        ctx.translate(x, gy(x) + 1);
        ctx.scale(scale, -scale);
        try { R.drawDecoration(ctx, { x: 0, y: 0, type, scale: 0.8, variant: i, layer: 'back' }, world, 1.5, scale); } catch (e) { /* decorative only */ }
        ctx.restore();
      }
    }
    // weather frame for character (snow, embers, rain…)
    bg.setQuality('low');
    bg._resize(w, h);
    bg._initWeather(w, h);
    bg.drawWeather(ctx, cam, w, h, null);
    // soft vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  Background.LAYER_FACTORS = LAYER_FACTORS;
  RR.Background = Background;
})();
