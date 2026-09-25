// Easter egg system. Sections call eggs.unlock('key'). Global triggers
// (typed words, Konami, 5-minute timer, console message) live here.
import { api } from './api.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { sfx } from './sfx.js';
import { fx } from './particles.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const WORDS = { unnational: 'secret-roast', biryani: 'biryani' };
const handlers = new Map(); // key -> fn(): unique animation

export const eggs = {
  get found() { return state.eggsFound; },
  get total() { return state.eggsTotal; },
  /** Register a unique animation for an egg key. */
  onUnlock(key, fn) { handlers.set(key, fn); },

  async unlock(key, { silent = false } = {}) {
    const already = state.eggsFound.has(key);
    state.eggsFound.add(key);
    let res = null;
    try { res = await api.unlockEgg(key); } catch (e) { console.warn('[eggs] unlock failed', e); }
    const def = (state.data?.easter_eggs || []).find(e => e.key === key);
    const name = res?.egg?.name || def?.name || key.toUpperCase();
    if (!already) {
      state.emit('egg', { key, name, found: state.eggsFound.size, total: state.eggsTotal });
      if (!silent) {
        sfx.play('egg');
        toast.show({ kind: 'egg', icon: '🥚', title: name, body: `${state.eggsFound.size} / ${state.eggsTotal} discovered`, duration: 4200 });
        fx.confetti({ count: 60, colors: ['#c6ff3d', '#ffffff', '#38e8ff'] });
      }
      handlers.get(key)?.();
      if (state.eggsFound.size >= state.eggsTotal && state.eggsTotal > 0) {
        setTimeout(() => { toast.show({ icon: '👑', title: 'ALL EASTER EGGS FOUND', body: 'You know this website better than SIR knows the offside rule.', duration: 6000 }); fx.confetti({ count: 250 }); sfx.play('fanfare'); }, 1200);
      }
    } else {
      handlers.get(key)?.(); // replay the animation, no toast
    }
    return !already;
  },

  init() {
    // Konami + typed words (ignore inputs/textareas)
    let kbuf = [], wbuf = '';
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      kbuf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key); kbuf = kbuf.slice(-KONAMI.length);
      if (kbuf.join() === KONAMI.join()) { kbuf = []; eggs.unlock('konami'); }
      if (e.key.length === 1) { wbuf = (wbuf + e.key.toLowerCase()).slice(-12); for (const [w, key] of Object.entries(WORDS)) if (wbuf.endsWith(w)) { wbuf = ''; eggs.unlock(key); } }
    });
    // 5 real minutes on the page
    let ms = 0, last = performance.now();
    setInterval(() => { const now = performance.now(); if (!document.hidden) ms += now - last; last = now; if (ms >= 5 * 60_000 && !state.eggsFound.has('five-minutes')) eggs.unlock('five-minutes'); }, 5000);
    // Developer message in the console
    const css = 'color:#c6ff3d;background:#050508;font-family:monospace;font-size:12px;padding:6px 10px;border:1px solid #c6ff3d;border-radius:6px';
    console.log('%c▌THE SIR ARCHIVES ▌ developer channel', css);
    console.log('%cYou opened the console. Respect. Type  SIR.dev()  to claim your reward.\nBuilt with friendship, chaos, and absolutely zero mercy by Shiv + Alex.', 'color:#8a8a9c;font-family:monospace');
    window.SIR = Object.assign(window.SIR || {}, {
      dev() { eggs.unlock('dev-message'); return '🫡 Developer message acknowledged. He still missed the pass.'; },
      eggs: () => ({ found: [...state.eggsFound], total: state.eggsTotal }),
    });
  },
};
