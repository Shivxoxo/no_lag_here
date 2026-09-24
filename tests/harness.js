/* RIDGE RUSH — tiny node test harness.
 * Loads the browser's classic-script files into a sandbox with a fake `window`, `document`,
 * `localStorage` and a no-op 2D canvas context, so modules can be unit-tested headlessly.
 *
 *   const H = require('./harness');
 *   const RR = H.load(['js/core/utils.js', 'js/data/worlds.js']);
 *   H.test('name', () => { H.assert(cond, 'msg'); });
 *   H.done();   // prints summary, sets exit code
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Canonical load order (mirrors index.html). Use H.loadAll() to load everything that exists.
const LOAD_ORDER = [
  'js/core/utils.js', 'js/core/save.js', 'js/core/audio.js', 'js/core/input.js',
  'js/data/vehicles.js', 'js/data/worlds.js', 'js/data/missions.js',
  'js/systems/progression.js', 'js/systems/missions.js', 'js/systems/daily.js',
  'js/game/terrain.js', 'js/game/physics.js', 'js/game/camera.js', 'js/game/particles.js',
  'js/game/vehicleArt.js', 'js/game/background.js', 'js/game/collectibles.js', 'js/game/powerups.js',
  'js/game/tricks.js', 'js/game/events.js', 'js/game/renderer.js', 'js/game/run.js',
  'js/ui/hud.js', 'js/ui/screens.js', 'game.js'
];

// A 2D context whose every method is a no-op; gradients/patterns/measureText return usable stubs.
function createStubContext2D(canvas) {
  const gradient = { addColorStop() {} };
  const target = {
    canvas,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => ({ setTransform() {} }),
    measureText: (t) => ({ width: String(t).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    getLineDash: () => []
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function createStubElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    textContent: '',
    innerHTML: '',
    width: 300,
    height: 150,
    clientWidth: 800,
    clientHeight: 450,
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    insertBefore(c) { return c; },
    remove() {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    focus() {},
    blur() {},
    getContext(type) { return type === '2d' ? createStubContext2D(this) : null; }
  };
  return el;
}

function createContext() {
  const store = Object.create(null);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
    _store: store
  };
  const body = createStubElement('body');
  const document = {
    body,
    documentElement: createStubElement('html'),
    hidden: false,
    visibilityState: 'visible',
    readyState: 'complete',
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => createStubElement(tag),
    createElementNS: (ns, tag) => createStubElement(tag)
  };
  const ctx = {
    console, Math, Date, JSON, Map, Set, WeakMap, Promise, Symbol, Proxy, Reflect,
    Float32Array, Float64Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint32Array, Int16Array, ArrayBuffer,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    localStorage,
    document,
    navigator: { userAgent: 'node-harness', maxTouchPoints: 0, vibrate: () => false },
    location: { href: 'file:///index.html', search: '', hash: '' },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Image: function () { return createStubElement('img'); },
    AudioContext: undefined,
    webkitAudioContext: undefined
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

function load(files, existingCtx) {
  const ctx = existingCtx || createContext();
  for (const f of files) {
    const full = path.join(ROOT, f);
    const code = fs.readFileSync(full, 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return existingCtx ? ctx.RR : Object.assign(ctx.RR || {}, { __ctx: ctx });
}

// Load every file from LOAD_ORDER that currently exists (skips missing ones, reports them).
function loadAll(opts) {
  const skip = new Set((opts && opts.skip) || []);
  const files = LOAD_ORDER.filter((f) => !skip.has(f) && fs.existsSync(path.join(ROOT, f)));
  const missing = LOAD_ORDER.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length && !(opts && opts.quiet)) console.log('[harness] missing (skipped):', missing.join(', '));
  return load(files);
}

// ---------------------------------------------------------------- micro test runner
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, e });
    console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + (msg || ''));
}
function assertClose(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= (eps ?? 1e-6))) throw new Error('Expected ' + a + ' ≈ ' + b + ' (±' + eps + ') ' + (msg || ''));
}
function assertFinite(v, msg) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Expected finite number, got ' + v + ' ' + (msg || ''));
}
function done() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
  return failed === 0;
}

module.exports = {
  ROOT, LOAD_ORDER, createContext, createStubContext2D, createStubElement, load, loadAll,
  test, assert, assertClose, assertFinite, done
};
