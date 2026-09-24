/* RIDGE RUSH — shared foundation: constants, surfaces, math/RNG/noise helpers, event bus.
 * Loaded first. Every other module relies on RR.CONST, RR.SURFACES, RR.Util and RR.Bus. */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});

  RR.VERSION = '1.0.0';

  RR.CONST = Object.freeze({
    PHYS_DT: 1 / 120,      // fixed physics step (s)
    MAX_FRAME_DT: 0.05,    // clamp for real frame dt (s) — avoids huge steps after tab switches
    MAX_SUBSTEPS: 10,      // max physics steps per frame (spiral-of-death guard)
    GRAVITY: 9.81,         // m/s²
    TERRAIN_DX: 0.5,       // terrain sample spacing (m)
    MAX_SPEED: 60,         // absolute linear speed clamp (m/s)
    MAX_ANGULAR: 16,       // absolute angular speed clamp (rad/s)
    COMBO_TIMEOUT: 4       // seconds of inactivity before a combo expires
  });

  // Surface catalogue. `friction` multiplies tire grip; `hazard` ends the run on contact (unless shielded).
  const S = (type, name, friction, dust, extra) =>
    Object.freeze(Object.assign({ type, name, friction, hazard: null, bounce: 0, dust }, extra || {}));
  RR.SURFACES = Object.freeze({
    grass: S('grass', 'Grass', 1.0, '#8d6b3f'),
    dirt: S('dirt', 'Dirt', 0.96, '#8a6440'),
    rock: S('rock', 'Rock', 1.05, '#8f8a84'),
    sand: S('sand', 'Sand', 0.8, '#e2bd7e'),
    snow: S('snow', 'Snow', 0.62, '#f2f7ff'),
    ice: S('ice', 'Ice', 0.3, '#cfe8ff', { bounce: 0.05 }),
    ash: S('ash', 'Ash', 0.9, '#5a4848'),
    lava: S('lava', 'Lava', 0.9, '#ff6a1f', { hazard: 'lava' }),
    regolith: S('regolith', 'Regolith', 0.85, '#c3c6d0'),
    metal: S('metal', 'Metal', 0.95, '#7d8cb4'),
    neon: S('neon', 'Neon Grid', 1.0, '#3ff3ff', { bounce: 0.08 }),
    crystal: S('crystal', 'Crystal', 0.88, '#9ff3ff'),
    mud: S('mud', 'Mud', 0.7, '#5c4331')
  });

  // ---------------------------------------------------------------- math
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
  const smoothstep = (a, b, v) => {
    const t = clamp(invLerp(a, b, v), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Move v toward target by at most delta.
  const approach = (v, target, delta) =>
    v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);
  // Frame-rate independent exponential smoothing. lambda ~ 1/response-time.
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
  const TAU = Math.PI * 2;
  const wrapAngle = (a) => {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  };
  const angleDiff = (a, b) => wrapAngle(b - a); // shortest signed difference a → b
  const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const safeNum = (v, fallback) => (isNum(v) ? v : fallback);

  // ---------------------------------------------------------------- hashing & RNG
  // FNV-1a 32-bit string hash.
  function hashString(str) {
    let h = 0x811c9dc5;
    str = String(str);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  // Mix two 32-bit integers into one (murmur-style finalizer).
  function hash2(a, b) {
    let h = (Math.imul(a >>> 0, 0x9e3779b1) ^ Math.imul((b >>> 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  // Mulberry32 seeded RNG with helpers.
  function makeRng(seed) {
    let s = seed >>> 0;
    const rng = {
      seed: seed >>> 0,
      next() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range(a, b) { return a + (b - a) * rng.next(); },
      int(a, b) { return a + Math.floor(rng.next() * (b - a + 1)); }, // inclusive
      chance(p) { return rng.next() < p; },
      pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
      sign() { return rng.next() < 0.5 ? -1 : 1; },
      // Independent, reproducible sub-stream derived from this RNG's seed and a label.
      fork(label) { return makeRng(hash2(rng.seed, hashString(label))); }
    };
    return rng;
  }
  // Deterministic uint32 seed for a date (local calendar day) + optional salt.
  function dateSeed(date, salt) {
    return hashString(todayKey(date) + '|' + (salt || ''));
  }

  // ---------------------------------------------------------------- noise
  // 1D gradient noise in [-1, 1] with quintic fade; smooth and seedable.
  function makeNoise1D(seed) {
    const rng = makeRng(seed);
    const perm = new Uint8Array(512);
    const grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      perm[i] = i;
      grad[i] = rng.next() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    return function noise(x) {
      const xi = Math.floor(x);
      const xf = x - xi;
      const i0 = xi & 255;
      const g0 = grad[perm[i0]];
      const g1 = grad[perm[i0 + 1]];
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
      return clamp(lerp(g0 * xf, g1 * (xf - 1), u) * 2, -1, 1);
    };
  }
  // Fractal sum of a noise function (normalized to ~[-1, 1]).
  function fbm1D(noise, x, octaves, lacunarity, gain) {
    octaves = octaves || 4; lacunarity = lacunarity || 2; gain = gain || 0.5;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq + o * 17.31) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // ---------------------------------------------------------------- formatting
  const formatInt = (n) => {
    n = Math.round(safeNum(n, 0));
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '-' + s : s;
  };
  const formatDistance = (m) => formatInt(Math.max(0, Math.floor(safeNum(m, 0)))) + ' m';
  const formatDuration = (ms) => {
    ms = Math.max(0, safeNum(ms, 0));
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = (v) => (v < 10 ? '0' : '') + v;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  };
  // Local calendar day as 'YYYY-MM-DD'.
  function todayKey(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = (v) => (v < 10 ? '0' : '') + v;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---------------------------------------------------------------- easing
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    t = clamp(t, 0, 1);
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const easeOutElastic = (t) => {
    t = clamp(t, 0, 1);
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  };

  // ---------------------------------------------------------------- objects
  const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  // Merge `src` into a clone of `base`; only keys present in base are taken when `strict`.
  function deepMerge(base, src, strict) {
    const out = deepClone(base);
    if (!isPlainObject(src)) return out;
    for (const k of Object.keys(src)) {
      if (strict && !(k in out)) continue;
      if (isPlainObject(out[k]) && isPlainObject(src[k])) out[k] = deepMerge(out[k], src[k], false);
      else out[k] = deepClone(src[k]);
    }
    return out;
  }
  function shuffle(arr, rng) {
    const next = rng ? rng.next : Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // items: array; weightFn(item) → weight ≥ 0. Returns null if all weights are 0.
  function weightedPick(items, weightFn, rng) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it) || 0);
    if (total <= 0) return null;
    let r = (rng ? rng.next() : Math.random()) * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it) || 0);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  // ---------------------------------------------------------------- colour
  const _rgbCache = new Map();
  function hexToRgb(hex) {
    let c = _rgbCache.get(hex);
    if (c) return c;
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    c = Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } : { r: 255, g: 0, b: 255 };
    _rgbCache.set(hex, c);
    return c;
  }
  const rgba = (hex, a) => {
    const c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(safeNum(a, 1), 0, 1) + ')';
  };
  const mixColor = (hexA, hexB, t) => {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    t = clamp(t, 0, 1);
    return 'rgb(' + Math.round(lerp(a.r, b.r, t)) + ',' + Math.round(lerp(a.g, b.g, t)) + ',' +
      Math.round(lerp(a.b, b.b, t)) + ')';
  };

  RR.Util = Object.freeze({
    TAU, clamp, lerp, invLerp, smoothstep, approach, damp, wrapAngle, angleDiff, sign, isNum, safeNum,
    hashString, hash2, makeRng, dateSeed, makeNoise1D, fbm1D,
    formatInt, formatDistance, formatDuration, todayKey,
    easeOutCubic, easeInOutQuad, easeOutBack, easeOutElastic,
    deepClone, deepMerge, isPlainObject, shuffle, weightedPick,
    hexToRgb, rgba, mixColor
  });

  // ---------------------------------------------------------------- event bus
  const listeners = new Map();
  RR.Bus = Object.freeze({
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => RR.Bus.off(evt, fn);
    },
    off(evt, fn) {
      const set = listeners.get(evt);
      if (set) set.delete(fn);
    },
    once(evt, fn) {
      const off = RR.Bus.on(evt, (p) => { off(); fn(p); });
      return off;
    },
    emit(evt, payload) {
      const set = listeners.get(evt);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(payload); } catch (e) { console.error('[RR.Bus] listener error for', evt, e); }
      }
    }
  });
})();
