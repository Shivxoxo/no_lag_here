// Toasts + cinematic overlay + tiny DOM helpers
import { esc, wait } from './state.js';
import { motion } from './motion.js';

const gsap = window.gsap;

export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export const toast = {
  show({ title, body = '', icon = '', kind = '', duration = 3800 }) {
    const host = document.getElementById('toasts');
    const node = el(`<div class="toast ${kind}" role="status">${icon ? `<span class="toast-icon">${icon}</span>` : ''}<div class="toast-body">${kind === 'egg' ? '<span class="toast-kicker">EASTER EGG FOUND</span>' : ''}<strong>${esc(title)}</strong>${body ? `<span class="muted">${esc(body)}</span>` : ''}</div></div>`);
    host.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => { node.classList.remove('show'); setTimeout(() => node.remove(), 500); }, duration);
    return node;
  },
};

/**
 * Cinematic full-screen overlay. `lines` are shown one after another with
 * pauses. Returns a promise resolved when the sequence ends.
 */
export const cine = {
  el: null,
  async play(lines, { hold = 1400, sub = '', onDone, bars = true, freeze = true } = {}) {
    const host = this.el || (this.el = document.getElementById('cine'));
    host.innerHTML = `<div class="cine-inner"><div class="cine-text"></div><div class="cine-sub">${esc(sub)}</div></div>`;
    host.classList.toggle('cine-bars', bars);
    host.hidden = false;
    if (freeze) document.body.classList.add('is-frozen');
    gsap.fromTo(host, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    const text = host.querySelector('.cine-text'); const subEl = host.querySelector('.cine-sub');
    if (motion.reduced) {
      for (const l of lines) { text.textContent = l; text.style.opacity = 1; subEl.style.opacity = 1; await wait(Math.min(hold, 900)); }
    } else {
      for (const l of lines) {
        text.textContent = l;
        await gsap.fromTo(text, { opacity: 0, y: 20, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'power3.out' });
        await wait(hold);
        await gsap.to(text, { opacity: 0, y: -14, filter: 'blur(6px)', duration: 0.45, ease: 'power2.in' });
      }
      if (sub) { await gsap.to(subEl, { opacity: 1, duration: 0.6 }); await wait(900); }
    }
    await gsap.to(host, { opacity: 0, duration: 0.7 });
    host.hidden = true; host.classList.remove('cine-bars');
    if (freeze) document.body.classList.remove('is-frozen');
    onDone?.();
  },
};

/** Segmented █░ meter string */
export function blocks(filled, total = 10) {
  return `<span class="blocks">${'█'.repeat(filled)}<span class="off">${'░'.repeat(Math.max(0, total - filled))}</span></span>`;
}
