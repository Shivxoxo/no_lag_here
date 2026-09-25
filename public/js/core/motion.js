// Motion helpers on top of GSAP + ScrollTrigger. Handles reduced-motion
// (system preference OR user toggle) so every section can stay accessible.
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const ScrollToPlugin = window.ScrollToPlugin;
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const PREF_KEY = 'sir.motion';
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let userPref = null; // null = follow system, 'reduced' | 'full'
try { userPref = localStorage.getItem(PREF_KEY); } catch { /* ignore */ }

function computeReduced() { return userPref ? userPref === 'reduced' : mq.matches; }
let reduced = computeReduced();
const listeners = new Set();
function apply() {
  reduced = computeReduced();
  document.documentElement.classList.toggle('reduced', reduced);
  document.documentElement.classList.toggle('motion-forced', userPref === 'full');
  gsap.globalTimeline.timeScale(reduced ? 1000 : 1);
  listeners.forEach(fn => fn(reduced));
  ScrollTrigger.refresh();
}
mq.addEventListener?.('change', apply);

export const motion = {
  gsap, ScrollTrigger,
  get reduced() { return reduced; },
  get userPref() { return userPref; },
  init() { document.documentElement.classList.toggle('reduced', reduced); if (reduced) gsap.globalTimeline.timeScale(1000); },
  setReduced(on) { userPref = on ? 'reduced' : 'full'; try { localStorage.setItem(PREF_KEY, userPref); } catch { /* ignore */ } apply(); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Scroll smoothly to a section/element (respects reduced motion). */
  scrollTo(target, { offset = -56, duration = 1.1 } = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    if (reduced) { el.scrollIntoView({ block: 'start' }); return; }
    gsap.to(window, { duration, scrollTo: { y: el, offsetY: -offset, autoKill: true }, ease: 'power3.inOut' });
  },

  /** Wrap each character in a span for kinetic typography. Returns the spans. */
  splitChars(el) {
    const text = el.textContent; el.textContent = ''; el.classList.add('kinetic');
    const spans = [];
    for (const ch of text) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; el.appendChild(s); spans.push(s); }
    return spans;
  },
  splitWords(el) {
    const words = el.textContent.split(/(\s+)/); el.textContent = ''; el.classList.add('kinetic');
    const spans = [];
    for (const w of words) { if (!w.trim()) { el.appendChild(document.createTextNode(w)); continue; } const s = document.createElement('span'); s.className = 'ch'; s.textContent = w; el.appendChild(s); spans.push(s); }
    return spans;
  },

  /** Typewriter effect. Resolves when done. */
  typewriter(el, text, { speed = 22, jitter = 18, onChar, html = false } = {}) {
    return new Promise(resolve => {
      if (reduced) { if (html) el.innerHTML = text; else el.textContent = text; resolve(); return; }
      let i = 0; if (html) el.innerHTML = ''; else el.textContent = '';
      const step = () => {
        if (i >= text.length) { resolve(); return; }
        if (html) el.innerHTML = text.slice(0, ++i); else el.textContent = text.slice(0, ++i);
        onChar?.(text[i - 1]);
        setTimeout(step, speed + Math.random() * jitter);
      };
      step();
    });
  },

  /** Animated number counter. */
  countUp(el, to, { from = 0, duration = 1.6, format = (v) => Math.round(v).toLocaleString(), ease = 'power2.out' } = {}) {
    const obj = { v: from };
    if (reduced) { el.textContent = format(to); return gsap.timeline(); }
    return gsap.to(obj, { v: to, duration, ease, onUpdate: () => { el.textContent = format(obj.v); } });
  },

  /** Reveal-on-scroll for elements with [data-reveal] inside root. */
  reveal(root, { stagger = 0.08, y = 28, once = true } = {}) {
    const els = root.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (reduced) { els.forEach(e => e.classList.add('is-revealed')); return; }
    gsap.set(els, { opacity: 0, y });
    ScrollTrigger.batch(els, {
      start: 'top 88%',
      once,
      onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger, overwrite: true, onComplete: () => batch.forEach(b => b.classList.add('is-revealed')) }),
    });
  },

  /** 3D hover tilt for cards. */
  tilt(el, { max = 10, scale = 1.02, glare = true } = {}) {
    if (reduced || !window.matchMedia('(hover: hover)').matches) return;
    let glareEl = null;
    if (glare) { glareEl = document.createElement('span'); glareEl.className = 'tilt-glare'; glareEl.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(circle at 50% 50%, rgba(255,255,255,.18), transparent 60%);opacity:0;transition:opacity .3s;mix-blend-mode:screen'; if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; el.appendChild(glareEl); }
    const move = (e) => {
      const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height;
      gsap.to(el, { rotateY: (px - 0.5) * max * 2, rotateX: (0.5 - py) * max * 2, scale, transformPerspective: 900, duration: 0.5, ease: 'power2.out' });
      if (glareEl) { glareEl.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,.2), transparent 60%)`; glareEl.style.opacity = 1; }
    };
    const leave = () => { gsap.to(el, { rotateX: 0, rotateY: 0, scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' }); if (glareEl) glareEl.style.opacity = 0; };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
  },

  /** Magnetic button: follows the cursor slightly. */
  magnetic(el, strength = 0.35) {
    if (reduced || !window.matchMedia('(hover: hover)').matches) return;
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength, duration: 0.4, ease: 'power2.out' }); });
    el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' }));
  },

  /** Screen shake (used by boss fight, boom moments). */
  shake(el = document.body, { intensity = 8, duration = 0.5 } = {}) {
    if (reduced) return;
    const tl = gsap.timeline();
    for (let i = 0; i < 8; i++) tl.to(el, { x: (Math.random() - 0.5) * intensity * 2, y: (Math.random() - 0.5) * intensity * 2, duration: duration / 8 });
    tl.to(el, { x: 0, y: 0, duration: 0.1 });
    return tl;
  },

  /** Parallax: move el by `speed` * scroll progress inside its section. */
  parallax(el, { speed = 0.2, trigger } = {}) {
    if (reduced) return;
    gsap.to(el, { yPercent: -speed * 100, ease: 'none', scrollTrigger: { trigger: trigger || el.closest('.sec') || el, start: 'top bottom', end: 'bottom top', scrub: true } });
  },

  /** Run cb once when el enters the viewport (for lazy heavy init). */
  onEnter(el, cb, { rootMargin = '200px' } = {}) {
    const io = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); cb(); } }, { rootMargin });
    io.observe(el);
  },
  /** Track visibility (start/stop render loops). */
  onVisible(el, cb, { rootMargin = '100px' } = {}) {
    const io = new IntersectionObserver((entries) => cb(entries[0].isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  },
};
