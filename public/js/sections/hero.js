// 01 · HERO — cinematic birthday reveal with a Three.js particle field.
import { createScene, glowTexture, pointerTracker } from '../core/three-utils.js';

export default {
  id: 'hero',
  title: 'Happy Birthday',
  mount(el, ctx) {
    const { profile, settings, photos, esc, gsap, sfx, eggs, fx, motion, api } = ctx;
    const heroFile = settings.hero_photo || profile.hero_photo;
    const heroPhoto = photos.find(p => p.src === heroFile) || photos[0];
    const first = (profile.first_name || profile.name.split(' ')[0]).toUpperCase();
    const nick = (profile.nickname || 'SIR').toUpperCase();

    el.classList.add('sec-full');
    el.innerHTML = `
      <canvas class="hero-canvas" aria-hidden="true"></canvas>
      <div class="hero-vignette" aria-hidden="true"></div>
      <div class="container hero-grid">
        <div class="hero-copy">
          <span class="eyebrow hero-eyebrow">CASE FILE #${esc(String(profile.age).padStart(3, '0'))} · SUBJECT: ${esc(profile.name.toUpperCase())}</span>
          <h1 class="display hero-title" aria-label="Happy Birthday ${esc(first)}">
            <span class="hero-line hero-line-1">HAPPY BIRTHDAY</span>
            <span class="hero-line hero-line-2">${esc(first)}</span>
          </h1>
          <button class="display hero-sir" type="button" aria-label="${esc(nick)}. Click for a surprise.">${esc(nick)}<span class="hero-dot">.</span></button>
          <p class="hero-tagline lead">${esc(profile.tagline || 'Unfortunately, you survived another year.')}</p>
          <dl class="hero-status mono" aria-label="System status">
            <div><dt>ROAST ENGINE</dt><dd class="ok"><span class="dot"></span> ONLINE</dd></div>
            <div><dt>MERCY</dt><dd class="bad"><span class="hero-num" data-to="0">0</span>%</dd></div>
            <div><dt>FRIENDSHIP</dt><dd class="ok"><span class="hero-num" data-to="100">0</span>%</dd></div>
          </dl>
          <div class="hero-actions">
            <button class="btn btn-lg hero-cta" type="button">BEGIN THE INVESTIGATION</button>
            <span class="hero-hint mono muted">scroll ↓</span>
          </div>
        </div>
        <figure class="hero-figure">
          <div class="hero-frame glow-border">
            ${heroPhoto ? `<img class="hero-photo" src="${esc(heroPhoto.url)}" alt="${esc(heroPhoto.title)}" width="${heroPhoto.width || 900}" height="${heroPhoto.height || 1200}" fetchpriority="high">` : '<div class="hero-photo hero-photo-missing">NO PHOTO</div>'}
            <span class="hero-scan" aria-hidden="true"></span>
            <figcaption class="hero-cap mono"><span class="tag tag-red">● REC</span> SUBJECT UNDER SURVEILLANCE</figcaption>
          </div>
          <div class="hero-badge mono"><b>${esc(String(profile.age))}</b><span>YEARS<br>OLD</span></div>
        </figure>
      </div>`;

    // ── Three.js particle field ──────────────────────────────
    const canvas = el.querySelector('.hero-canvas');
    const three = motion.reduced ? null : createScene(canvas, { fov: 60, maxDpr: 1.5 });
    if (three) {
      const { THREE, scene, camera } = three;
      camera.position.z = 28;
      const count = Math.min(1400, Math.floor((innerWidth * innerHeight) / 900));
      const pos = new Float32Array(count * 3), speed = new Float32Array(count);
      for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * 90; pos[i * 3 + 1] = (Math.random() - 0.5) * 60; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; speed[i] = 0.2 + Math.random() * 0.8; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size: 0.55, map: glowTexture(64, '#38e8ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, color: 0xffffff });
      const points = new THREE.Points(geo, mat); scene.add(points);
      const mat2 = new THREE.PointsMaterial({ size: 1.6, map: glowTexture(64, '#c6ff3d'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 });
      const pos2 = new Float32Array(60 * 3); for (let i = 0; i < 60; i++) { pos2[i * 3] = (Math.random() - 0.5) * 80; pos2[i * 3 + 1] = (Math.random() - 0.5) * 50; pos2[i * 3 + 2] = (Math.random() - 0.5) * 30; }
      const geo2 = new THREE.BufferGeometry(); geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
      const orbs = new THREE.Points(geo2, mat2); scene.add(orbs);
      const ptr = pointerTracker(el);
      three.onTick((dt, t) => {
        const p = ptr.update();
        const arr = geo.attributes.position.array;
        for (let i = 0; i < count; i++) { arr[i * 3 + 1] += speed[i] * dt * 1.2; if (arr[i * 3 + 1] > 30) arr[i * 3 + 1] = -30; }
        geo.attributes.position.needsUpdate = true;
        points.rotation.y = t * 0.02 + p.x * 0.15; points.rotation.x = p.y * 0.1;
        orbs.rotation.y = -t * 0.03; orbs.position.x = p.x * 2; orbs.position.y = p.y * 1.5;
        camera.position.x += (p.x * 2 - camera.position.x) * 0.03; camera.position.y += (p.y * 1.2 - camera.position.y) * 0.03; camera.lookAt(0, 0, 0);
      });
      motion.parallax(el.querySelector('.hero-figure'), { speed: 0.12 });
    }

    // ── Entrance timeline (plays after the intro) ─────────────
    const line1 = el.querySelector('.hero-line-1'), line2 = el.querySelector('.hero-line-2'), sir = el.querySelector('.hero-sir');
    const chars1 = motion.splitChars(line1), chars2 = motion.splitChars(line2);
    const rest = [el.querySelector('.hero-tagline'), el.querySelector('.hero-status'), el.querySelector('.hero-actions')];
    gsap.set([...chars1, ...chars2], { yPercent: 110, opacity: 0, rotateX: -60 });
    gsap.set(sir, { scale: 0.3, opacity: 0, rotate: -12 });
    gsap.set(rest, { opacity: 0, y: 20 });
    gsap.set(el.querySelector('.hero-figure'), { opacity: 0, x: 60, rotateY: -12 });
    gsap.set(el.querySelector('.hero-eyebrow'), { opacity: 0 });

    ctx.onEnter(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
      tl.to(el.querySelector('.hero-eyebrow'), { opacity: 1, duration: 0.6 })
        .to(chars1, { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.9, stagger: 0.035 }, 0.1)
        .to(chars2, { yPercent: 0, opacity: 1, rotateX: 0, duration: 1, stagger: 0.05, onStart: () => sfx.play('whoosh') }, 0.5)
        .to(el.querySelector('.hero-figure'), { opacity: 1, x: 0, rotateY: 0, duration: 1.2 }, 0.6)
        .to(sir, { scale: 1, opacity: 1, rotate: -3, duration: 0.7, ease: 'elastic.out(1, 0.45)', onStart: () => { sfx.play('boom'); motion.shake(el, { intensity: 6, duration: 0.4 }); } }, 1.35)
        .to(rest, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15 }, 1.8)
        .add(() => { el.querySelectorAll('.hero-num').forEach(n => motion.countUp(n, Number(n.dataset.to), { duration: 1.4 })); }, 2.0);
      if (motion.reduced) tl.progress(1);
    });

    // ── CTA ───────────────────────────────────────────────────
    const cta = el.querySelector('.hero-cta');
    motion.magnetic(cta);
    cta.addEventListener('click', () => { sfx.play('whoosh'); ctx.scrollTo('#archives'); });
    if (el.querySelector('.hero-frame')) motion.tilt(el.querySelector('.hero-frame'), { max: 6 });

    // ── Easter egg: click "SIR." 7 times ──────────────────────
    let clicks = 0, resetTimer = 0;
    sir.addEventListener('click', () => {
      clicks++; clearTimeout(resetTimer); resetTimer = setTimeout(() => { clicks = 0; }, 2500);
      sfx.play('pop');
      gsap.fromTo(sir, { scale: 1.15, rotate: -3 + (Math.random() - 0.5) * 16 }, { scale: 1, rotate: -3, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      const r = sir.getBoundingClientRect(); fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 12, color: '#c6ff3d', power: 6 });
      if (clicks === 7) { clicks = 0; eggs.unlock('sir-spam'); }
    });
    eggs.onUnlock('sir-spam', () => {
      // Unique animation: SIR multiplies across the screen
      const layer = document.createElement('div'); layer.className = 'sir-storm'; layer.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 40; i++) { const s = document.createElement('span'); s.textContent = nick + '.'; s.style.left = Math.random() * 100 + '%'; s.style.top = Math.random() * 100 + '%'; s.style.fontSize = (2 + Math.random() * 6) + 'rem'; s.style.setProperty('--r', (Math.random() - 0.5) * 60 + 'deg'); layer.appendChild(s); }
      document.body.appendChild(layer);
      gsap.fromTo(layer.children, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, stagger: 0.03, ease: 'back.out(2)' });
      gsap.to(layer.children, { opacity: 0, y: -80, duration: 0.8, delay: 2.2, stagger: 0.02, onComplete: () => layer.remove() });
      sfx.play('glitch');
    });
  },
};
