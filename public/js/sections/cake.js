// 18 · CAKE — interactive Three.js birthday cake with blow-out ceremony.
import { createScene, glowTexture, pointerTracker, THREE } from '../core/three-utils.js';

const ord = (n) => { const v = Math.abs(Number(n)) % 100; if (v >= 11 && v <= 13) return 'TH'; return ['TH', 'ST', 'ND', 'RD'][v % 10] || 'TH'; };
const CANDLE_COLORS = ['#ff6b8a', '#38e8ff', '#ffcc4d', '#c6ff3d', '#8b5cff', '#ff8a3d'];
const FROSTING = ['#fff3e0', '#f2a7b3', '#ffcc4d', '#ffffff'];

export default {
  id: 'cake',
  title: 'The Cake',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, eggs, fx, motion, api, toast, wait } = ctx;
    const age = Math.max(1, Number(profile.age) || 16);
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name?.split(' ')[0] || 'him';

    // ── bokeh + string lights (pure decoration) ───────────────
    const warm = ['#ffcc4d', '#ff8a3d', '#ff3d8f', '#38e8ff', '#c6ff3d'];
    let bokeh = '';
    for (let i = 0; i < 14; i++) {
      const c = warm[i % warm.length], s = 70 + Math.random() * 190;
      bokeh += `<span style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;background:radial-gradient(circle, ${c} 0%, transparent 70%);--d:${14 + Math.random() * 16}s;--delay:-${Math.random() * 20}s;--o:${.16 + Math.random() * .2}"></span>`;
    }
    let bulbs = '';
    for (let seg = 0; seg < 4; seg++) {
      const x0 = seg * 300;
      for (const t of [0.14, 0.32, 0.5, 0.68, 0.86]) {
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * (x0 + 150) + t * t * (x0 + 300);
        const y = (1 - t) * (1 - t) * 12 + 2 * (1 - t) * t * 78 + t * t * 12;
        const c = warm[(seg * 5 + Math.round(t * 10)) % warm.length];
        bulbs += `<g class="bulb" style="color:${c};animation-delay:-${(Math.random() * 3).toFixed(2)}s"><rect x="${(x - 2.5).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="5" height="6" rx="1" fill="#3a3a44"/><circle cx="${x.toFixed(1)}" cy="${(y + 10).toFixed(1)}" r="6" fill="currentColor"/></g>`;
      }
    }

    el.innerHTML = `
      <div class="cake-bokeh" aria-hidden="true">${bokeh}</div>
      <svg class="cake-lights" viewBox="0 0 1200 90" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,12 Q150,78 300,12 T600,12 T900,12 T1200,12" fill="none" stroke="#2a2a34" stroke-width="2"/>
        ${bulbs}
      </svg>
      <div class="container cake-wrap">
        <div class="sec-head center cake-head">
          <span class="eyebrow">EXHIBIT ∞ · THE CEREMONY</span>
          <h2 class="display h1 cake-title" data-reveal>HAPPY <span class="cake-age">${esc(String(age))}<sup>${ord(age)}</sup></span>, ${esc(nick)}</h2>
          <p class="lead cake-lead" data-reveal>${esc(age)} candles. One wish. Statistically it will be about ${esc(profile.favourite_food?.split(' ')[0] || 'biryani')}.</p>
        </div>
        <div class="cake-stage" data-reveal>
          <button class="cake-canvas-wrap" type="button" aria-label="The birthday cake for ${esc(nick)}. Click to poke it. It does not like being poked."></button>
          <div class="cake-reveal display" aria-live="polite"></div>
          <div class="cake-plate-shadow" aria-hidden="true"></div>
        </div>
        <div class="cake-actions" data-reveal>
          <button class="btn btn-lg btn-gold cake-blow" type="button">BLOW OUT THE CANDLES</button>
          <p class="mono muted cake-hint"><span class="cake-clicks">0</span> POKES · ${esc(first)} would have eaten it by now.</p>
        </div>
      </div>`;

    const wrap = el.querySelector('.cake-canvas-wrap');
    const stage = el.querySelector('.cake-stage');
    const revealEl = el.querySelector('.cake-reveal');
    const blowBtn = el.querySelector('.cake-blow');
    const clicksEl = el.querySelector('.cake-clicks');

    // Shared state between the 3D and SVG implementations.
    let impl = null;           // { blow(), relight(), wobble(), rampage() }
    let blown = false, busy = false, clicks = 0, clickTimer = 0;

    // ── text reveal over the cake ─────────────────────────────
    async function reveal(text, { hold = 1400, boom = false, keep = false } = {}) {
      revealEl.textContent = text;
      revealEl.classList.toggle('is-boom', boom);
      if (boom) { sfx.play('boom'); motion.shake(stage, { intensity: 10, duration: 0.45 }); }
      await gsap.fromTo(revealEl, { opacity: 0, scale: boom ? 2.2 : 1.5, filter: 'blur(18px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: boom ? 0.45 : 0.7, ease: boom ? 'power4.out' : 'power3.out' });
      await wait(motion.reduced ? Math.min(hold, 900) : hold);
      if (!keep) await gsap.to(revealEl, { opacity: 0, scale: 0.92, filter: 'blur(8px)', duration: 0.4, ease: 'power2.in' });
    }
    function hideReveal() { gsap.to(revealEl, { opacity: 0, duration: 0.3 }); }

    async function blow() {
      if (!impl || busy) return;
      busy = true; blowBtn.disabled = true;
      if (blown) { // RELIGHT
        impl.relight(); hideReveal(); sfx.play('pop'); blown = false;
        blowBtn.textContent = 'BLOW OUT THE CANDLES';
        await wait(500); blowBtn.disabled = false; busy = false; return;
      }
      blown = true;
      sfx.play('blow');
      impl.blow();
      await wait(700);
      const r = stage.getBoundingClientRect();
      fx.confetti({ count: 260, x: r.left + r.width / 2, y: r.top + r.height * 0.4, colors: ['#ffcc4d', '#ff3d8f', '#38e8ff', '#fff3e0', '#c6ff3d', '#ffffff'], power: 16 });
      fx.emoji({ emoji: ['🎂', '🎉', '🍛'], count: 16 });
      sfx.play('birthday');
      api.event('cake_blown');
      await reveal('ANOTHER YEAR OLDER.', { hold: 1400 });
      await reveal(`STILL ${nick}.`, { hold: 2600, boom: true });
      blowBtn.textContent = 'RELIGHT';
      blowBtn.disabled = false; busy = false;
    }
    blowBtn.addEventListener('click', blow);

    // ── clicking / poking the cake ────────────────────────────
    wrap.addEventListener('click', () => {
      if (!impl) return;
      clicks++; clicksEl.textContent = clicks;
      clearTimeout(clickTimer); clickTimer = setTimeout(() => { clicks = 0; clicksEl.textContent = '0'; }, 4000);
      sfx.play('pop');
      impl.wobble();
      api.event('cake_click', { n: clicks });
      const r = wrap.getBoundingClientRect();
      fx.burst({ x: r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.3, y: r.top + r.height * 0.55, count: 10, color: FROSTING[clicks % FROSTING.length], power: 5, size: 3 });
      if (clicks === 10) { clicks = 0; clicksEl.textContent = '10';eggs.unlock('cake-spam'); }
    });
    eggs.onUnlock('cake-spam', () => {
      impl?.rampage();
      const r = stage.getBoundingClientRect();
      const n = motion.reduced ? 3 : 10;
      for (let i = 0; i < n; i++) setTimeout(() => fx.burst({ x: r.left + Math.random() * r.width, y: r.top + Math.random() * r.height, count: 34, color: FROSTING[i % FROSTING.length], power: 11, size: 5, life: 1100 }), i * 110);
      sfx.play('glitch');
      setTimeout(() => toast.show({ icon: '🎂', title: 'The cake has filed for protection.', body: 'Case #' + String(age).padStart(3, '0') + '-CAKE. Pending.', duration: 4500 }), 400);
    });

    // ── build lazily when the section scrolls in ─────────────
    ctx.onSectionEnter(el, () => {
      impl = (!motion.reduced && buildThree()) || buildSvg();
    });

    // ═════════════════════════════════════════════════════════
    //  3D implementation
    // ═════════════════════════════════════════════════════════
    function buildThree() {
      const canvas = document.createElement('canvas'); canvas.className = 'cake-canvas';
      wrap.appendChild(canvas);
      const three = createScene(canvas, { fov: 34, maxDpr: 1.6 });
      if (!three) { canvas.remove(); return null; }
      const { scene, camera } = three;
      const camBase = { y: 3.4, z: 9.6 };
      camera.position.set(0, camBase.y, camBase.z);

      // lights
      scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1030, 0.75));
      const sun = new THREE.DirectionalLight(0xffd9a8, 1.6); sun.position.set(4, 7, 5); scene.add(sun);
      const rim = new THREE.DirectionalLight(0x8b5cff, 0.5); rim.position.set(-5, 3, -4); scene.add(rim);

      const rig = new THREE.Group(); scene.add(rig);   // pointer tilt
      const cake = new THREE.Group(); rig.add(cake);   // wobble + auto-rotate
      cake.position.y = -0.9;

      const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...extra });
      const cream = std('#fff3e0', { roughness: 0.55 });

      // plate
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.2, 0.14, 56), std('#e9e4dc', { roughness: 0.35, metalness: 0.25 }));
      plate.position.y = 0.07; cake.add(plate);
      const plateRim = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.05, 8, 64), std('#ffcc4d', { metalness: 0.6, roughness: 0.3 }));
      plateRim.rotation.x = Math.PI / 2; plateRim.position.y = 0.14; cake.add(plateRim);

      // layers
      const layers = [
        { r: 2.35, h: 1.0, color: '#6b3a2a' },
        { r: 1.85, h: 0.85, color: '#f2a7b3' },
        { r: 1.35, h: 0.72, color: '#f6e3c9' },
      ];
      let y = 0.14;
      for (const L of layers) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r * 1.02, L.h, 48), std(L.color));
        m.position.y = y + L.h / 2; cake.add(m);
        y += L.h;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(L.r, 0.11, 10, 48), cream);
        ring.rotation.x = Math.PI / 2; ring.position.y = y; cake.add(ring);
        const drips = 14 + Math.floor(Math.random() * 4);
        for (let i = 0; i < drips; i++) {
          const a = (i / drips) * Math.PI * 2 + Math.random() * 0.2, len = 0.15 + Math.random() * 0.3;
          const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), cream);
          d.scale.set(1, len / 0.09 * 0.5, 1); d.position.set(Math.cos(a) * L.r, y - len * 0.5, Math.sin(a) * L.r); cake.add(d);
        }
        L.top = y;
      }
      const topY = y;
      const sprinkleGeo = new THREE.SphereGeometry(0.035, 6, 5);
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.2;
        const s = new THREE.Mesh(sprinkleGeo, std(CANDLE_COLORS[i % CANDLE_COLORS.length], { emissive: CANDLE_COLORS[i % CANDLE_COLORS.length], emissiveIntensity: 0.25 }));
        s.position.set(Math.cos(a) * rr, topY + 0.03, Math.sin(a) * rr); cake.add(s);
      }

      // candles
      const flameTex = glowTexture(64, '#ffb347');
      const candles = [], lights = [];
      const flameMat = () => new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0b0 });
      function addCandle(x, z, baseY, i, withLight) {
        const g = new THREE.Group(); g.position.set(x, baseY, z);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 10), std(CANDLE_COLORS[i % CANDLE_COLORS.length], { roughness: 0.5 }));
        body.position.y = 0.3; g.add(body);
        const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 5), std('#222'));
        wick.position.y = 0.63; g.add(wick);
        const flame = new THREE.Sprite(flameMat()); flame.position.y = 0.8; flame.scale.set(0.34, 0.52, 1); g.add(flame);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff7d6 })); core.position.y = 0.72; g.add(core);
        let light = null;
        if (withLight) { light = new THREE.PointLight(0xffa64d, 1.4, 6, 2); light.position.y = 0.85; g.add(light); lights.push(light); }
        cake.add(g);
        const c = { g, flame, core, light, lit: true, phase: Math.random() * 10 };
        candles.push(c); return c;
      }
      const n = Math.min(age, 24);
      const lightEvery = Math.max(1, Math.ceil(n / 4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, r = n > 1 ? 0.95 : 0;
        addCandle(Math.cos(a) * r, Math.sin(a) * r, topY, i, i % lightEvery === 0 && lights.length < 4);
      }

      // smoke
      let smoke = null;
      const smokeTex = glowTexture(32, '#b8b8c4');
      function startSmoke() {
        if (smoke) { cake.remove(smoke.points); smoke = null; }
        const N = 200, pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
        const lit = candles;
        for (let i = 0; i < N; i++) {
          const c = lit[i % lit.length];
          pos[i * 3] = c.g.position.x + (Math.random() - 0.5) * 0.05; pos[i * 3 + 1] = c.g.position.y + 0.75; pos[i * 3 + 2] = c.g.position.z + (Math.random() - 0.5) * 0.05;
          vel[i * 3] = (Math.random() - 0.5) * 0.25; vel[i * 3 + 1] = 0.6 + Math.random() * 0.9; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ size: 0.22, map: smokeTex, transparent: true, opacity: 0.6, depthWrite: false, color: 0x9a9aa8 });
        const points = new THREE.Points(geo, mat); cake.add(points);
        smoke = { points, geo, mat, vel, t: 0, delay: 0.25 };
      }

      // pointer + render loop
      const ptr = pointerTracker(el);
      const spin = { v: 0.22 };
      three.onTick((dt, t) => {
        const p = ptr.update();
        cake.rotation.y += dt * spin.v;
        rig.rotation.x += ((p.y * -0.12) - rig.rotation.x) * 0.05;
        rig.rotation.z += ((p.x * 0.05) - rig.rotation.z) * 0.05;
        camera.position.x += (p.x * 0.9 - camera.position.x) * 0.04;
        camera.position.y += ((camBase.y + p.y * 0.35) - camera.position.y) * 0.04;
        camera.position.z += (camBase.z - camera.position.z) * 0.08;
        camera.lookAt(0, 0.55, 0);
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i]; if (!c.lit) continue;
          const f = 1 + Math.sin(t * 17 + c.phase) * 0.07 + Math.sin(t * 29 + c.phase * 2) * 0.05;
          c.flame.scale.set(0.34 * f, 0.52 * (2 - f), 1);
          c.flame.position.x = Math.sin(t * 9 + c.phase) * 0.015;
          if (c.light) c.light.intensity = 1.2 + Math.sin(t * 13 + c.phase) * 0.35 + Math.random() * 0.1;
        }
        if (smoke) {
          smoke.t += dt;
          if (smoke.t > smoke.delay) {
            const a = smoke.geo.attributes.position.array, v = smoke.vel, life = (smoke.t - smoke.delay) / 2;
            for (let i = 0; i < a.length; i += 3) { a[i] += (v[i] + Math.sin(t * 3 + i) * 0.15) * dt; a[i + 1] += v[i + 1] * dt; a[i + 2] += v[i + 2] * dt; }
            smoke.geo.attributes.position.needsUpdate = true;
            smoke.mat.opacity = 0.6 * (1 - life); smoke.mat.size = 0.22 + life * 0.5;
            if (life >= 1) { cake.remove(smoke.points); smoke.geo.dispose(); smoke.mat.dispose(); smoke = null; }
          }
        }
      });

      const setLit = (c, lit, delay = 0) => {
        c.lit = lit;
        if (lit) {
          gsap.to(c.flame.scale, { x: 0.34, y: 0.52, duration: 0.5, delay, ease: 'elastic.out(1, 0.5)' });
          gsap.to(c.core.scale, { x: 1, y: 1, z: 1, duration: 0.3, delay });
          if (c.light) gsap.to(c.light, { intensity: 1.3, duration: 0.5, delay });
        } else {
          gsap.to(c.flame.scale, { x: 0.001, y: 0.001, duration: 0.3, delay, ease: 'power2.in' });
          gsap.to(c.core.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, delay });
          if (c.light) gsap.to(c.light, { intensity: 0, duration: 0.35, delay });
        }
      };
      let extras = 0;
      return {
        blow() {
          candles.forEach((c, i) => setLit(c, false, i * 0.045));
          startSmoke();
          gsap.to(spin, { v: 0.6, duration: 0.6, yoyo: true, repeat: 1 });
          gsap.to(camBase, { z: 6.9, y: 2.9, duration: 1.3, ease: 'power2.inOut', yoyo: true, repeat: 1, repeatDelay: 1.6 });
        },
        relight() { candles.forEach((c, i) => setLit(c, true, i * 0.05)); },
        wobble() {
          gsap.killTweensOf(cake.rotation); gsap.killTweensOf(cake.scale);
          gsap.fromTo(cake.rotation, { z: (Math.random() - 0.5) * 0.35, x: (Math.random() - 0.5) * 0.2 }, { z: 0, x: 0, duration: 0.9, ease: 'elastic.out(1, 0.3)' });
          gsap.fromTo(cake.scale, { x: 1.08, y: 0.9, z: 1.08 }, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)' });
        },
        rampage() {
          const tl = gsap.timeline();
          for (let i = 0; i < 12; i++) tl.to(cake.rotation, { z: (i % 2 ? 1 : -1) * 0.5 * (1 - i / 14), x: (Math.random() - 0.5) * 0.4, duration: 0.07 });
          tl.to(cake.rotation, { z: 0, x: 0, duration: 0.9, ease: 'elastic.out(1, 0.3)' });
          gsap.fromTo(cake.scale, { x: 1.25, y: 0.75, z: 1.25 }, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'elastic.out(1, 0.25)', delay: 0.6 });
          gsap.fromTo(spin, { v: 3 }, { v: 0.22, duration: 2, ease: 'power3.out' });
          if (!extras) {
            extras = 12;
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2, r = 2.85;
              const c = addCandle(Math.cos(a) * r, Math.sin(a) * r, 0.14, i + 3, false);
              c.g.scale.set(0.001, 0.001, 0.001);
              gsap.to(c.g.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.5 + i * 0.06, ease: 'back.out(3)' });
              if (blown) setLit(c, false, 0);
            }
          }
        },
      };
    }

    // ═════════════════════════════════════════════════════════
    //  SVG fallback (no WebGL / reduced motion)
    // ═════════════════════════════════════════════════════════
    function buildSvg() {
      const n = Math.min(age, 24);
      const topX = 170, topW = 260, topY = 110;
      const candle = (i, x, baseY, h = 46) => `<g class="svg-candle" data-i="${i}"><rect x="${x - 3}" y="${baseY - h}" width="6" height="${h}" rx="2" fill="${CANDLE_COLORS[i % CANDLE_COLORS.length]}"/><rect x="${x - 0.7}" y="${baseY - h - 6}" width="1.4" height="7" fill="#333"/><g class="svg-flame" style="transform-origin:${x}px ${baseY - h - 6}px"><ellipse cx="${x}" cy="${baseY - h - 15}" rx="5.5" ry="10" fill="url(#cakeFlame)"/><ellipse cx="${x}" cy="${baseY - h - 12}" rx="2.2" ry="4.5" fill="#fff7d6"/></g><path class="svg-smoke" d="M${x},${baseY - h - 14} c -4,-8 4,-14 0,-22 c -4,-8 4,-14 0,-22" fill="none" stroke="#9a9aa8" stroke-width="2" stroke-linecap="round"/></g>`;
      let candles = '';
      for (let i = 0; i < n; i++) candles += candle(i, topX + (topW / (n + 1)) * (i + 1), topY);
      const drips = (x, w, y, color) => { let s = ''; const k = Math.round(w / 26); for (let i = 0; i <= k; i++) { const dx = x + (w / k) * i, len = 8 + ((i * 7) % 14); s += `<ellipse cx="${dx}" cy="${y + len / 2}" rx="7" ry="${len}" fill="${color}"/>`; } return s; };
      wrap.innerHTML = `
        <svg class="cake-svg" viewBox="0 0 600 430" role="img" aria-label="A three-layer birthday cake with ${n} candles">
          <defs>
            <radialGradient id="cakeFlame" cx="50%" cy="65%" r="60%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".55" stop-color="#ffb347"/><stop offset="1" stop-color="#ff6a2a" stop-opacity=".2"/></radialGradient>
            <linearGradient id="cakePlate" x1="0" x2="1"><stop offset="0" stop-color="#d9d3c9"/><stop offset=".5" stop-color="#f4efe8"/><stop offset="1" stop-color="#cfc8bd"/></linearGradient>
          </defs>
          <ellipse cx="300" cy="392" rx="250" ry="26" fill="#000" opacity=".45"/>
          <ellipse cx="300" cy="380" rx="240" ry="28" fill="url(#cakePlate)"/>
          <ellipse cx="300" cy="376" rx="236" ry="24" fill="none" stroke="#ffcc4d" stroke-width="2" opacity=".8"/>
          <g class="svg-cake">
            <rect x="110" y="258" width="380" height="112" rx="14" fill="#6b3a2a"/>
            <rect x="106" y="248" width="388" height="28" rx="14" fill="#fff3e0"/>${drips(120, 360, 270, '#fff3e0')}
            <rect x="150" y="178" width="300" height="90" rx="12" fill="#f2a7b3"/>
            <rect x="146" y="170" width="308" height="26" rx="13" fill="#fff3e0"/>${drips(160, 280, 190, '#fff3e0')}
            <rect x="170" y="110" width="260" height="76" rx="12" fill="#f6e3c9"/>
            <rect x="166" y="102" width="268" height="24" rx="12" fill="#fff3e0"/>${drips(180, 240, 120, '#fff3e0')}
            <g class="svg-candles">${candles}</g>
            <g class="svg-extras"></g>
          </g>
        </svg>`;
      const svgCake = wrap.querySelector('.svg-cake');
      const flames = () => [...wrap.querySelectorAll('.svg-flame')];
      const smokes = () => [...wrap.querySelectorAll('.svg-smoke')];
      let extras = false;
      return {
        blow() {
          flames().forEach((f, i) => gsap.to(f, { opacity: 0, scale: 0.2, duration: 0.3, delay: i * 0.04, ease: 'power2.in' }));
          smokes().forEach((s, i) => gsap.fromTo(s, { opacity: 0, y: 6 }, { opacity: 0.8, y: -22, duration: 1.8, delay: 0.25 + i * 0.04, ease: 'power1.out', onComplete: () => gsap.to(s, { opacity: 0, duration: 0.5 }) }));
          gsap.fromTo(wrap, { scale: 1 }, { scale: 1.06, duration: 1.2, yoyo: true, repeat: 1, ease: 'power2.inOut' });
        },
        relight() { flames().forEach((f, i) => gsap.to(f, { opacity: 1, scale: 1, duration: 0.4, delay: i * 0.04, ease: 'back.out(2)' })); },
        wobble() {
          gsap.killTweensOf(svgCake);
          gsap.fromTo(svgCake, { rotate: (Math.random() - 0.5) * 10, scaleX: 1.05, scaleY: 0.95, transformOrigin: '50% 90%' }, { rotate: 0, scaleX: 1, scaleY: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)' });
        },
        rampage() {
          const tl = gsap.timeline();
          for (let i = 0; i < 10; i++) tl.to(svgCake, { rotate: (i % 2 ? 1 : -1) * 14 * (1 - i / 12), transformOrigin: '50% 90%', duration: 0.07 });
          tl.to(svgCake, { rotate: 0, duration: 0.8, ease: 'elastic.out(1, 0.3)' });
          if (!extras) {
            extras = true;
            let s = '';
            for (let i = 0; i < 12; i++) s += candle(i + 3, 80 + i * (440 / 11), 372, 34);
            wrap.querySelector('.svg-extras').innerHTML = s;
            if (blown) wrap.querySelectorAll('.svg-extras .svg-flame').forEach(f => gsap.set(f, { opacity: 0 }));
          }
        },
      };
    }
  },
};
