// Tiny shared store. Sections read `state.data` (bootstrap payload) and can
// subscribe to changes (eggs found, stats updated, sound toggled...).
const listeners = new Map();

export const state = {
  data: null,           // bootstrap payload
  profile: null,
  settings: {},
  photos: [],
  eggsFound: new Set(),
  eggsTotal: 0,
  stats: {},
  sectionsSeen: new Set(),
  frozen: false,        // compliment freeze
  entered: false,       // intro completed

  setBootstrap(data) {
    this.data = data;
    this.profile = data.profile || {};
    this.settings = data.settings || {};
    this.photos = data.photos || [];
    this.stats = data.stats || {};
    this.eggsTotal = (data.easter_eggs || []).length;
    this.eggsFound = new Set((data.easter_eggs || []).filter(e => e.found).map(e => e.key));
    this.emit('bootstrap', data);
  },

  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt)?.delete(fn); },
  emit(evt, payload) { listeners.get(evt)?.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); },
};

/** HTML-escape user/content strings before injecting into templates. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rand = (min, max) => Math.random() * (max - min) + min;
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const wait = (ms) => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
