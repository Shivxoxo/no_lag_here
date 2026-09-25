// Fullscreen evidence viewer: keyboard + swipe navigation, random mode,
// neighbour preloading, cinematic transitions, roast captions.
import { state, esc } from './state.js';
import { api } from './api.js';
import { sfx } from './sfx.js';
import { motion } from './motion.js';

const gsap = window.gsap;
let host, img, frame, titleEl, capEl, countEl, index = 0, open = false, lastFocus = null, animating = false;
const preloaded = new Set();
function preload(i) { const p = state.photos[i]; if (!p || preloaded.has(p.url)) return; preloaded.add(p.url); const im = new Image(); im.src = p.url; }
function photoAt(i) { const n = state.photos.length; return state.photos[((i % n) + n) % n]; }

function build() {
  host = document.getElementById('viewer');
  host.innerHTML = `
    <div class="viewer-top"><span class="viewer-count"></span><span class="mono muted">CLASSIFIED · EVIDENCE ROOM</span><button class="viewer-close" aria-label="Close viewer">✕</button></div>
    <div class="viewer-stage">
      <button class="viewer-nav prev" aria-label="Previous evidence">‹</button>
      <div class="viewer-frame"><span class="viewer-corner tl"></span><span class="viewer-corner tr"></span><span class="viewer-corner bl"></span><span class="viewer-corner br"></span><img class="viewer-img" alt=""></div>
      <button class="viewer-nav next" aria-label="Next evidence">›</button>
    </div>
    <div class="viewer-bottom"><div class="viewer-title"></div><p class="viewer-caption"></p>
      <div class="viewer-actions"><button class="btn btn-ghost btn-sm" data-act="random">🎲 Random evidence</button><button class="btn btn-sm" data-act="next">Next evidence →</button></div></div>`;
  img = host.querySelector('.viewer-img'); frame = host.querySelector('.viewer-frame'); titleEl = host.querySelector('.viewer-title'); capEl = host.querySelector('.viewer-caption'); countEl = host.querySelector('.viewer-count');
  host.querySelector('.viewer-close').addEventListener('click', close);
  host.querySelector('.prev').addEventListener('click', () => go(-1));
  host.querySelector('.next').addEventListener('click', () => go(1));
  host.querySelector('[data-act="next"]').addEventListener('click', () => go(1));
  host.querySelector('[data-act="random"]').addEventListener('click', random);
  host.addEventListener('click', (e) => { if (e.target === host.querySelector('.viewer-stage')) close(); });
  // swipe
  let sx = 0, sy = 0, swiping = false;
  host.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiping = true; }, { passive: true });
  host.addEventListener('pointerup', (e) => { if (!swiping) return; swiping = false; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1); else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close(); }, { passive: true });
  window.addEventListener('keydown', (e) => { if (!open) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') go(-1); else if (e.key.toLowerCase() === 'r') random(); });
}

function render(dir = 0) {
  const p = photoAt(index); if (!p) return;
  const swap = () => {
    img.src = p.url; img.alt = p.title;
    titleEl.textContent = p.title; capEl.textContent = p.caption || ''; countEl.textContent = `${((index % state.photos.length) + state.photos.length) % state.photos.length + 1} / ${state.photos.length}`;
    preload(index + 1); preload(index - 1);
    api.photoView(p.id); api.event('photo_open', { id: p.id });
  };
  if (motion.reduced || dir === 0) { swap(); if (dir === 0 && !motion.reduced) gsap.fromTo(frame, { scale: 0.92, opacity: 0, filter: 'blur(10px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out' }); animating = false; return; }
  gsap.timeline({ onComplete: () => { animating = false; } })
    .to(frame, { x: -60 * dir, opacity: 0, rotateY: -12 * dir, duration: 0.25, ease: 'power2.in' })
    .add(swap)
    .fromTo(frame, { x: 60 * dir, opacity: 0, rotateY: 12 * dir, filter: 'blur(6px)' }, { x: 0, opacity: 1, rotateY: 0, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' });
  sfx.play('whoosh');
}
function go(dir) { if (animating || !state.photos.length) return; animating = true; index += dir; render(dir); }
function random() { if (state.photos.length < 2) return; let n; do { n = Math.floor(Math.random() * state.photos.length); } while (n === ((index % state.photos.length) + state.photos.length) % state.photos.length); index = n; api.event('random_evidence'); sfx.play('glitch'); render(1); }
function close() { if (!open) return; open = false; gsap.to(host, { opacity: 0, duration: 0.3, onComplete: () => { host.hidden = true; document.body.classList.remove('is-frozen'); lastFocus?.focus?.(); } }); }

export const viewer = {
  init() { build(); },
  open(i = 0) {
    if (!state.photos.length) return;
    lastFocus = document.activeElement; index = i; open = true;
    host.hidden = false; document.body.classList.add('is-frozen');
    gsap.fromTo(host, { opacity: 0 }, { opacity: 1, duration: 0.35 });
    render(0); sfx.play('pop');
    host.querySelector('.viewer-close').focus({ preventScroll: true });
  },
  random() { this.open(Math.floor(Math.random() * state.photos.length)); api.event('random_evidence'); },
  close, next: () => go(1), prev: () => go(-1),
  get isOpen() { return open; },
};
