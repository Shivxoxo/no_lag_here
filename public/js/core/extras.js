// EXTRAS — the "more animation, use every photo" layer. Runs after all
// sections are mounted. Everything here is additive, reduced-motion aware
// and uses only DOM hooks that exist in the sections.
import { state, esc, pick, shuffle } from './state.js';
import { motion } from './motion.js';
import { viewer } from './viewer.js';
import { sfx } from './sfx.js';

const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
const THEME = {
  hero: ['🎂', '⚽', '🍛'], archives: ['🔍', '📁', '🕵️'], scouting: ['⚽', '📋', '🥅'], pass: ['⚽', '❌', '😭'], nationals: ['🏟️', '⚽', '📉'],
  awards: ['🏆', '✨', '🎖️'], gaming: ['🎮', '💥', '🔫'], anime: ['📺', '🌸', '⚔️'], academics: ['📚', '✏️', '😱'], gym: ['🏋️', '⏰', '📱'],
  food: ['🍛', '🍗', '🥘'], roast: ['🔥', '💀', '🌶️'], evidence: ['📸', '📌', '🧵'], timeline: ['🎞️', '📅', '⏳'], boss: ['👑', '⚔️', '💢'],
  ai: ['🤖', '🧠', '⚡'], compliment: ['🤍'], cake: ['🎂', '🕯️', '🎉'], messages: ['📡', '💬', '🎈'], ending: ['🎬', '🎉', '🫡'],
};

export function initExtras() {
  const photos = state.photos;
  if (!photos.length) return;
  heroCarousel(photos);
  photoStrips(photos);
  watermarks(photos);
  sectionWipes();
  kineticTitles();
  timelinePhotos(photos);
  awardPhotos(photos);
  bossAvatarCycle(photos);
  endingMosaic(photos);
  ambientEmoji();
  cursorTrail();
  ScrollTrigger.refresh();
}

// ── 1. Hero: cycle through every photo with a glitch wipe ─────────────
function heroCarousel(photos) {
  const frame = document.querySelector('.hero-frame'); const img = frame?.querySelector('.hero-photo');
  if (!frame || !img || photos.length < 2 || motion.reduced) return;
  const order = [photos.findIndex(p => p.url === img.getAttribute('src')), ...shuffle(photos.map((_, i) => i))].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  let i = 0; const ghost = img.cloneNode(); ghost.className = 'hero-photo hero-photo-ghost'; ghost.setAttribute('aria-hidden', 'true'); frame.insertBefore(ghost, img);
  const cap = frame.querySelector('.hero-cap'); const capText = document.createElement('span'); capText.className = 'hero-cap-title'; cap?.appendChild(capText);
  const dots = document.createElement('div'); dots.className = 'hero-dots'; order.forEach((_, k) => { const d = document.createElement('i'); if (!k) d.classList.add('on'); dots.appendChild(d); }); frame.appendChild(dots);
  const swap = () => {
    if (document.hidden || !state.entered) return;
    i = (i + 1) % order.length; const p = photos[order[i]];
    ghost.src = img.src; gsap.set(ghost, { opacity: 1, clipPath: 'inset(0 0 0 0)' });
    img.src = p.url; capText.textContent = ' · ' + p.title;
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
    const tl = gsap.timeline();
    tl.fromTo(img, { clipPath: 'inset(0 100% 0 0)', filter: 'saturate(3) contrast(1.4) hue-rotate(60deg)', x: 24 }, { clipPath: 'inset(0 0% 0 0)', filter: 'saturate(1.05) contrast(1.04) hue-rotate(0deg)', x: 0, duration: 0.7, ease: 'power4.inOut' })
      .to(ghost, { x: -30, opacity: 0, duration: 0.5 }, 0.1)
      .fromTo(frame, { x: 0 }, { x: 4, yoyo: true, repeat: 3, duration: 0.05 }, 0);
    sfx.play('tick');
  };
  setInterval(swap, 4200);
  frame.style.cursor = 'zoom-in';
  frame.addEventListener('click', () => viewer.open(order[i]));
}

// ── 2. Film-strip marquees between sections (every photo, twice) ─────
function photoStrips(photos) {
  const after = ['hero', 'awards', 'gym', 'roast', 'timeline', 'ai'];
  after.forEach((id, n) => {
    const sec = document.getElementById(id); if (!sec) return;
    const strip = document.createElement('div'); strip.className = 'xstrip' + (n % 2 ? ' xstrip-rev' : ''); strip.setAttribute('aria-label', 'Evidence film strip');
    const list = shuffle(photos.map((p, i) => ({ p, i })));
    const track = document.createElement('div'); track.className = 'xstrip-track';
    for (let r = 0; r < 2; r++) for (const { p, i } of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'xstrip-item'; b.setAttribute('aria-label', `Open ${p.title}`); b.dataset.i = i;
      b.innerHTML = `<img src="${esc(p.thumb || p.url)}" alt="" loading="lazy" width="${p.width || 400}" height="${p.height || 300}"><span class="mono">${esc(p.title)}</span>`;
      b.addEventListener('click', () => viewer.open(i));
      track.appendChild(b);
    }
    strip.appendChild(track); sec.insertAdjacentElement('afterend', strip);
    // speed up marquee while scrolling
    if (!motion.reduced) {
      let t; addEventListener('scroll', () => { strip.classList.add('fast'); clearTimeout(t); t = setTimeout(() => strip.classList.remove('fast'), 300); }, { passive: true });
      ScrollTrigger.create({ trigger: strip, start: 'top bottom', end: 'bottom top', onToggle: s => strip.classList.toggle('paused', !s.isActive) });
    }
  });
}

// ── 3. Faded parallax photo watermarks behind sections ────────────────
function watermarks(photos) {
  const secs = [...document.querySelectorAll('.sec')].filter(s => !['hero', 'nationals', 'cake', 'compliment', 'ending', 'evidence'].includes(s.id));
  const order = shuffle(photos);
  secs.forEach((sec, n) => {
    const p = order[n % order.length]; const side = n % 2 ? 'right' : 'left';
    const wm = document.createElement('div'); wm.className = `xwm xwm-${side}`; wm.setAttribute('aria-hidden', 'true');
    wm.innerHTML = `<img src="${esc(p.thumb || p.url)}" alt="" loading="lazy"><span class="mono">EXHIBIT · ${esc(p.title.replace(/evidence\s*/i, ''))}</span>`;
    sec.insertBefore(wm, sec.firstChild);
    if (!motion.reduced) gsap.fromTo(wm, { yPercent: 18, rotate: side === 'left' ? -6 : 6 }, { yPercent: -18, rotate: side === 'left' ? -2 : 2, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
}

// ── 4. Diagonal wipe + flash on every section entry ───────────────────
function sectionWipes() {
  if (motion.reduced) return;
  document.querySelectorAll('.sec').forEach((sec, n) => {
    if (sec.id === 'hero') return;
    const wipe = document.createElement('div'); wipe.className = 'xwipe'; wipe.setAttribute('aria-hidden', 'true'); sec.appendChild(wipe);
    ScrollTrigger.create({ trigger: sec, start: 'top 80%', once: true, onEnter: () => {
      gsap.timeline().set(wipe, { display: 'block' })
        .fromTo(wipe, { clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', xPercent: -100, skewX: -12 }, { xPercent: 130, duration: 0.9, ease: 'power3.inOut' })
        .set(wipe, { display: 'none' });
      const head = sec.querySelector('.sec-head, h2'); if (head) gsap.fromTo(head, { filter: 'brightness(2.2) blur(2px)' }, { filter: 'brightness(1) blur(0px)', duration: 0.9, ease: 'power2.out', delay: 0.25 });
      if (n % 3 === 0) sfx.play('whoosh');
    } });
  });
}

// ── 5. Kinetic per-letter section titles ──────────────────────────────
function kineticTitles() {
  document.querySelectorAll('.sec h2.display, .sec .sec-head .display').forEach(h => {
    if (h.closest('#hero') || h.dataset.kinetic || h.querySelector('img, svg')) return;
    h.dataset.kinetic = '1';
    const spans = []; const walk = (node) => { for (const c of [...node.childNodes]) { if (c.nodeType === 3 && c.textContent.trim()) { const frag = document.createDocumentFragment(); for (const part of c.textContent.split(/(\s+)/)) { if (!part) continue; if (!part.trim()) { frag.appendChild(document.createTextNode(part)); continue; } const w = document.createElement('span'); w.className = 'word'; for (const ch of part) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; w.appendChild(s); spans.push(s); } frag.appendChild(w); } c.replaceWith(frag); } else if (c.nodeType === 1 && !c.classList.contains('ch') && !c.classList.contains('word')) walk(c); } };
    walk(h);
    if (motion.reduced || !spans.length) return;
    gsap.set(spans, { yPercent: 100, opacity: 0, rotateX: -70, transformOrigin: '50% 100%' });
    ScrollTrigger.create({ trigger: h, start: 'top 85%', once: true, onEnter: () => gsap.to(spans, { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.8, ease: 'back.out(1.6)', stagger: { each: 0.025, from: 'random' } }) });
    h.addEventListener('pointerenter', () => gsap.to(spans, { y: -6, duration: 0.25, stagger: 0.01, yoyo: true, repeat: 1, ease: 'sine.inOut' }));
  });
}

// ── 6. Timeline: every chapter gets an archival photo ─────────────────
function timelinePhotos(photos) {
  const cards = document.querySelectorAll('#timeline .tl-entry:not(.tl-empty) .tl-card');
  if (!cards.length) return;
  const order = shuffle(photos);
  cards.forEach((card, n) => {
    const p = order[n % order.length]; const fig = document.createElement('button'); fig.type = 'button'; fig.className = 'xtl-photo'; fig.setAttribute('aria-label', `Archival photo: ${p.title}`);
    fig.innerHTML = `<img src="${esc(p.thumb || p.url)}" alt="" loading="lazy"><span class="mono">ARCHIVE · ${esc(p.title)}</span>`;
    fig.addEventListener('click', () => viewer.open(photos.indexOf(p)));
    card.appendChild(fig); motion.tilt(fig, { max: 8 });
    if (!motion.reduced) gsap.fromTo(fig, { rotate: n % 2 ? 6 : -6, scale: 0.6, opacity: 0, y: 40 }, { rotate: n % 2 ? 3 : -3, scale: 1, opacity: 1, y: 0, duration: 0.9, ease: 'back.out(1.5)', scrollTrigger: { trigger: card, start: 'top 80%', once: true } });
  });
}

// ── 7. Awards: each trophy card gets a "winner" photo ─────────────────
function awardPhotos(photos) {
  const shelf = document.querySelectorAll('#awards .aw-shelf-item, #awards .aw-shelf article, #awards .aw-shelf button, #awards [class*="aw-shelf-card"]');
  if (!shelf.length) return;
  const order = shuffle(photos);
  shelf.forEach((card, n) => { const p = order[n % order.length]; const im = document.createElement('img'); im.className = 'xaw-photo'; im.src = p.thumb || p.url; im.alt = ''; im.loading = 'lazy'; card.style.position = card.style.position || 'relative'; card.appendChild(im); });
}

// ── 8. Boss: avatar photo changes each phase / on big hits ────────────
function bossAvatarCycle(photos) {
  const av = document.querySelector('#boss .boss-avatar img'); if (!av) return;
  let k = 0; const order = shuffle(photos);
  const obs = new MutationObserver(() => {}); obs.disconnect();
  document.getElementById('boss').addEventListener('click', (e) => {
    if (!e.target.closest('.boss-avatar') || motion.reduced) return;
    if (Math.random() < 0.18) { k = (k + 1) % order.length; av.src = order[k].url; gsap.fromTo(av, { filter: 'invert(1) hue-rotate(180deg)', scale: 1.2 }, { filter: 'invert(0) hue-rotate(0deg)', scale: 1, duration: 0.35 }); }
  });
}

// ── 9. Ending: all photos fly into a mosaic before the credits ────────
function endingMosaic(photos) {
  const hb = document.querySelector('#ending .end-beat-hb'); if (!hb) return;
  const beat = document.createElement('div'); beat.className = 'end-beat xmosaic-beat'; beat.innerHTML = `<div class="xmosaic-head mono">16 YEARS · ${photos.length} PIECES OF EVIDENCE · 0 REGRETS</div><div class="xmosaic"></div>`;
  const grid = beat.querySelector('.xmosaic');
  photos.forEach((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'xmosaic-item'; b.setAttribute('aria-label', p.title); b.innerHTML = `<img src="${esc(p.thumb || p.url)}" alt="" loading="lazy">`; b.addEventListener('click', () => viewer.open(i)); grid.appendChild(b); motion.tilt(b, { max: 12 }); });
  hb.insertAdjacentElement('beforebegin', beat);
  if (motion.reduced) return;
  const items = grid.querySelectorAll('.xmosaic-item');
  gsap.set(items, { opacity: 0, scale: 0.2, x: () => gsap.utils.random(-600, 600), y: () => gsap.utils.random(-400, 400), rotate: () => gsap.utils.random(-90, 90) });
  ScrollTrigger.create({ trigger: beat, start: 'top 70%', once: true, onEnter: () => { gsap.to(items, { opacity: 1, scale: 1, x: 0, y: 0, rotate: () => gsap.utils.random(-4, 4), duration: 1.2, ease: 'expo.out', stagger: { each: 0.06, from: 'random' } }); sfx.play('confetti'); } });
  gsap.to(grid, { yPercent: -6, ease: 'none', scrollTrigger: { trigger: beat, start: 'top bottom', end: 'bottom top', scrub: true } });
}

// ── 10. Ambient floating emoji per section theme ──────────────────────
function ambientEmoji() {
  if (motion.reduced || innerWidth < 600) return;
  document.querySelectorAll('.sec').forEach(sec => {
    const set = THEME[sec.id] || ['✨']; const layer = document.createElement('div'); layer.className = 'xambient'; layer.setAttribute('aria-hidden', 'true'); sec.appendChild(layer);
    const N = 7; for (let i = 0; i < N; i++) { const s = document.createElement('span'); s.textContent = pick(set); s.style.left = `${(i / N) * 100 + Math.random() * 8}%`; s.style.animationDuration = `${14 + Math.random() * 16}s`; s.style.animationDelay = `${-Math.random() * 20}s`; s.style.fontSize = `${18 + Math.random() * 26}px`; layer.appendChild(s); }
    ScrollTrigger.create({ trigger: sec, start: 'top bottom', end: 'bottom top', onToggle: s => layer.classList.toggle('on', s.isActive) });
  });
}

// ── 11. Cursor sparkle trail (desktop, fine pointer only) ─────────────
function cursorTrail() {
  if (motion.reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const layer = document.createElement('div'); layer.className = 'xtrail'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer);
  const pool = Array.from({ length: 18 }, () => { const d = document.createElement('i'); layer.appendChild(d); return d; }); let n = 0, last = 0;
  addEventListener('pointermove', (e) => {
    const now = performance.now(); if (now - last < 28) return; last = now;
    const d = pool[n++ % pool.length]; const accent = getComputedStyle(e.target.closest('.sec') || document.body).getPropertyValue('--accent') || '#c6ff3d';
    d.style.background = accent; gsap.killTweensOf(d);
    gsap.fromTo(d, { x: e.clientX, y: e.clientY, scale: 1, opacity: 0.9 }, { x: e.clientX + (Math.random() - 0.5) * 40, y: e.clientY + 30 + Math.random() * 30, scale: 0, opacity: 0, duration: 0.7, ease: 'power2.out' });
  }, { passive: true });
}
