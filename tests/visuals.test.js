/* RIDGE RUSH — visuals tests: RR.Particles / RR.FloatText / RR.VehicleArt / RR.Background / RR.Renderer.
 *
 * Headless (tests/harness.js stub canvas). Every draw goes through a "checking" 2D context that records any
 * non-finite number passed to a canvas method or assigned to a canvas property, so NaN leaks fail loudly.
 * Real Terrain / VehicleBody / Camera are used when present on disk; a plausible mock terrain, body and camera
 * are always exercised too, so the renderer is verified against partial / fake runs.
 *
 *   node tests/visuals.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const has = (f) => fs.existsSync(path.join(H.ROOT, f));
const OPTIONAL = ['js/data/vehicles.js', 'js/game/terrain.js', 'js/game/physics.js', 'js/game/camera.js'];
const MINE = ['js/game/particles.js', 'js/game/vehicleArt.js', 'js/game/background.js', 'js/game/renderer.js'];
const files = ['js/core/utils.js', 'js/data/worlds.js'].concat(OPTIONAL.filter(has)).concat(MINE);
// keep canonical load order
files.sort((a, b) => H.LOAD_ORDER.indexOf(a) - H.LOAD_ORDER.indexOf(b));
const RR = H.load(files);
const CTX = RR.__ctx;

// ------------------------------------------------------------------ helpers
function checkingContext(canvas) {
  const base = H.createStubContext2D(canvas);
  const rec = { calls: 0, bad: [], transforms: [], ops: Object.create(null) };
  const fnCache = new Map();
  const ctx = new Proxy(base, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function' || k === 'canvas') return v;
      let w = fnCache.get(k);
      if (!w) {
        w = function (...args) {
          rec.calls++;
          rec.ops[k] = (rec.ops[k] || 0) + 1;
          for (const a of args) {
            if (typeof a === 'number' && !Number.isFinite(a)) { rec.bad.push(String(k) + '(' + args.map(String).join(', ') + ')'); break; }
          }
          if (k === 'setTransform') rec.transforms.push(args.slice());
          // a real canvas throws IndexSizeError on negative radii — treat them as failures here too
          if ((k === 'arc' && args[2] < 0) || (k === 'ellipse' && (args[2] < 0 || args[3] < 0)) || (k === 'arcTo' && args[4] < 0)) {
            rec.bad.push('negative radius: ' + String(k) + '(' + args.map(String).join(', ') + ')');
          }
          return v.apply(t, args);
        };
        fnCache.set(k, w);
      }
      return w;
    },
    set(t, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) rec.bad.push('set ' + String(k) + ' = ' + v);
      if ((k === 'fillStyle' || k === 'strokeStyle') && (v === undefined || v === null || (typeof v === 'string' && /NaN|undefined/.test(v)))) {
        rec.bad.push('set ' + String(k) + ' = ' + v);
      }
      t[k] = v;
      return true;
    }
  });
  return { ctx, rec };
}
function stubCanvas(w, h) {
  const el = H.createStubElement('canvas');
  el.clientWidth = w || 960;
  el.clientHeight = h || 540;
  const chk = checkingContext(el);
  el.getContext = () => chk.ctx;
  return { el, ctx: chk.ctx, rec: chk.rec };
}
function assertClean(rec, label) {
  H.assert(rec.bad.length === 0, (label || '') + ' non-finite values reached the canvas: ' + rec.bad.slice(0, 5).join(' | '));
}

const SURF_KEYS = (RR.Terrain && RR.Terrain.SURFACE_TYPES) || Object.keys(RR.SURFACES);
const sIdx = (k) => Math.max(0, SURF_KEYS.indexOf(k));

// Plausible fake terrain: rolling hills, alt-surface patches, one lava pool, optional cave ceiling.
function mockTerrain(world, opts) {
  opts = opts || {};
  const DX = 0.5;
  const ground = (x) => 3 * Math.sin(x * 0.05) + 1.2 * Math.sin(x * 0.17) + (x > 150 && x < 158 ? -1.5 : 0);
  const main = sIdx(world.surface), alt = sIdx(world.altSurface || world.surface), lava = sIdx('lava');
  const decorations = [];
  let x = 4;
  (world.decorations || ['rock']).forEach((type, k) => {
    for (let r = 0; r < 3; r++) {
      decorations.push({ x, y: ground(x), type, scale: 0.8 + 0.1 * r, layer: r === 2 ? 'front' : 'back', variant: (k + r) & 3 });
      x += 3.5;
    }
  });
  decorations.push({ x: x + 2, y: ground(x + 2), type: 'unknown_type', scale: 1, layer: 'back', variant: 9 });
  return {
    DX, minX: -60, maxX: 3000, decorations, features: [], sections: opts.cave ? [{ id: 'cave', start: 0, end: 400 }] : [],
    heightAt: ground,
    slopeAt: (xx) => (ground(xx + 0.01) - ground(xx)) / 0.01,
    getIndexRange(x0, x1, out) {
      out = out || [0, 0];
      out[0] = Math.max(Math.floor(x0 / DX), -120);
      out[1] = Math.min(Math.ceil(x1 / DX), 6000);
      return out;
    },
    pointX: (i) => i * DX,
    pointY: (i) => ground(i * DX),
    surfaceIdx: (i) => {
      const xx = i * DX;
      if (xx > 151 && xx < 157) return lava;
      return Math.floor(xx / 20) % 3 === 2 ? alt : main;
    },
    ceilingAt: (xx) => (opts.cave && xx > -100 && xx < 400 ? ground(xx) + 10.5 : null),
    sectionAt: (xx) => (opts.cave && xx >= 0 && xx < 400 ? { id: 'cave', start: 0, end: 400 } : null)
  };
}

function tunedFor(vehicleId, style) {
  if (RR.Vehicles) return RR.Vehicles.getTuned(vehicleId, {});
  // contract-shaped fallback
  return {
    id: vehicleId, style,
    chassis: { mass: 250, inertia: 200, hull: [{ x: -1.5, y: -0.4 }, { x: 1.6, y: -0.4 }, { x: 1.7, y: 0.1 }, { x: 0.3, y: 0.7 }, { x: -1.4, y: 0.3 }], head: { x: -0.2, y: 1.0, r: 0.22 } },
    wheels: [{ mount: { x: -1.0, y: -0.2 }, radius: 0.42 }, { mount: { x: 1.3, y: -0.2 }, radius: 0.42 }],
    suspension: { rest: 0.4, minLen: 0.12, maxLen: 0.46, staticLen: 0.32 }
  };
}
function mockBody(tuned, x, y, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const wheels = tuned.wheels.map((w, i) => {
    const lx = w.mount.x, ly = w.mount.y - (tuned.suspension.staticLen || 0.3);
    return { x: x + lx * c - ly * s, y: y + lx * s + ly * c, radius: w.radius, spin: i * 1.3, omega: -5, compression: 0.4, grounded: true };
  });
  return { x, y, angle, vx: 8, vy: 0, av: 0, wheels, tuned };
}
function mockCamera(x, y, w, h) {
  return {
    x, y, cx: x, cy: y, zoom: Math.min(h / 15, w / 24), viewW: w, viewH: h, shakeX: 0, shakeY: 0,
    worldToScreen(wx, wy, out) { out = out || {}; out.x = this.viewW / 2 + (wx - this.cx) * this.zoom; out.y = this.viewH / 2 - (wy - this.cy) * this.zoom; return out; },
    bounds(out) { out = out || {}; const hw = this.viewW / 2 / this.zoom, hh = this.viewH / 2 / this.zoom; out.left = this.cx - hw; out.right = this.cx + hw; out.bottom = this.cy - hh; out.top = this.cy + hh; return out; }
  };
}
function makeCamera(x, y, w, h) {
  if (RR.Camera) {
    const cam = new RR.Camera();
    cam.setViewport(w, h);
    cam.reset(x, y);
    return cam;
  }
  return mockCamera(x, y, w, h);
}
function mockPowerUps(active) {
  return { isActive: (t) => active.indexOf(t) >= 0, fraction: () => 0.5, remaining: () => 3 };
}
const VEHICLES = RR.Vehicles ? RR.Vehicles.list.map((v) => ({ id: v.id, style: v.style, colors: v.colors }))
  : ['buggy', 'dirt', 'truck', 'rally', 'crawler', 'storm'].map((s) => ({ id: s, style: s, colors: null }));

function makeRun(world, veh, opts) {
  opts = opts || {};
  const terrain = opts.terrain || mockTerrain(world, opts);
  const tuned = tunedFor(veh.id, veh.style);
  const x = opts.x || 40;
  const body = opts.body || mockBody(tuned, x, terrain.heightAt(x) + 1.1, 0.1);
  const w = opts.w || 960, h = opts.h || 540;
  const camera = opts.noCamera ? undefined : makeCamera(body.x, body.y, w, h);
  const particles = new RR.Particles(300);
  particles.emit('dust', body.x, body.y, 10, { color: world.dustColor });
  particles.emit('explosion', body.x, body.y, 20);
  particles.update(0.05, { gravity: 9.81, wind: 1 });
  const floatText = new RR.FloatText(8);
  floatText.add('+100', body.x, body.y + 2, { color: '#ffd34d' });
  const env = Object.assign({ gravity: 9.81, gravityMul: 1, wind: 0, frictionMul: 1, darkness: world.darkness, rain: 0, lightning: 0, tint: null, sectionId: null, fuelZone: false, timeScale: 1 }, opts.env || {});
  const background = opts.noBackground ? undefined : new RR.Background(world, 42);
  return Object.assign({
    world, vehicleDef: RR.Vehicles ? RR.Vehicles.byId(veh.id) : null, tuned, colors: veh.colors, terrain, body, camera,
    particles, floatText, background, state: 'running', mode: 'normal', time: 3.5, distance: x, bestDistance: x + 3,
    fuel: 70, fuelMax: 100, coins: 0, env, powerUps: mockPowerUps(opts.powerUps || []),
    collectibles: { draw() {} }, events: { drawWorld() {}, drawScreen() {} }
  }, opts.run || {});
}

// ================================================================ particles
H.test('Particles: every type emits, updates and draws without growing the pool', () => {
  const p = new RR.Particles(200);
  const arrays = [p.x, p.y, p.vx, p.vy, p.life, p.type, p.color];
  const cap = p.capacity;
  for (const t of RR.Particles.TYPES) H.assert(p.emit(t, 1, 2, 5, { speed: 3, color: '#ff0000' }) > 0, 'emit ' + t);
  for (let k = 0; k < 400; k++) p.emit(RR.Particles.TYPES[k % RR.Particles.TYPES.length], k * 0.1, 0, 12);
  H.assert(p.capacity === cap, 'capacity changed');
  H.assert(p.count <= cap, 'count exceeded capacity: ' + p.count);
  H.assert(arrays.every((a, i) => a === [p.x, p.y, p.vx, p.vy, p.life, p.type, p.color][i]), 'pool arrays were reallocated');
  let sum = 0;
  for (const t of RR.Particles.TYPES) sum += p.countOf(t);
  H.assert(sum === p.count, 'per-type counts out of sync: ' + sum + ' vs ' + p.count);
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  const cam = mockCamera(10, 0, 960, 540);
  for (let f = 0; f < 60; f++) { p.update(1 / 60, { gravity: 9.81, wind: 2 }); p.draw(ctx, cam); }
  assertClean(rec, 'particles');
  for (let i = 0; i < p.count; i++) { H.assertFinite(p.x[i]); H.assertFinite(p.y[i]); }
});

H.test('Particles: expire, clear, bad input and quality scaling', () => {
  const p = new RR.Particles(500);
  H.assert(p.emit('spark', NaN, 0, 10) === 0, 'NaN position must not emit');
  H.assert(p.emit('spark', 0, 0, -3) === 0, 'negative count must not emit');
  p.emit('nonexistent_type', 0, 0, 3);              // falls back to dust
  H.assert(p.count === 3, 'fallback type should emit');
  p.update(NaN, null); p.update(-1, null);          // ignored
  for (let f = 0; f < 400; f++) p.update(1 / 60, { gravity: 9.81, wind: 0 });
  H.assert(p.count === 0, 'particles should expire, left: ' + p.count);
  p.setQuality('high');
  const hi = p.emit('dust', 0, 0, 20);
  p.clear();
  p.setQuality('low');
  const lo = p.emit('dust', 0, 0, 20);
  H.assert(lo < hi && lo > 0, 'low quality should emit fewer (' + lo + ' vs ' + hi + ')');
  p.setQuality('bogus');
  H.assert(p.quality === 'high', 'unknown quality falls back to high');
  p.clear();
  H.assert(p.count === 0 && p.countOf('dust') === 0, 'clear');
});

H.test('Particles: saturated pool recycles slots (fresh effects still appear)', () => {
  const p = new RR.Particles(32);
  for (let k = 0; k < 20; k++) p.emit('smoke', 0, 0, 10);
  H.assert(p.count === 32, 'pool should be full');
  p.emit('coin', 50, 50, 5);
  H.assert(p.countOf('coin') > 0, 'new coin sparkles should replace old slots');
});

H.test('FloatText: add / update / draw, bounded and recycled', () => {
  const f = new RR.FloatText(4);
  for (let k = 0; k < 10; k++) f.add('+' + k, k, 0, { size: 20 + k, color: '#fff' });
  H.assert(f.count === 4, 'count bounded by capacity');
  f.add('bad', NaN, 0);
  H.assert(f.count === 4, 'NaN anchor ignored');
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  const cam = mockCamera(0, 0, 800, 450);
  for (let t = 0; t < 30; t++) { f.update(1 / 30); f.draw(ctx, cam); }
  assertClean(rec, 'floatText');
  f.update(10);
  H.assert(f.count === 0, 'all popups expire');
  f.draw(ctx, null);
});

// ================================================================ vehicle art
H.test('VehicleArt: all six styles draw (plus crashed / boost / thruster / shield / headlights)', () => {
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  H.assert(RR.VehicleArt.STYLES.length === 6, 'six styles');
  for (const v of VEHICLES) {
    const tuned = tunedFor(v.id, v.style);
    const body = mockBody(tuned, 5, 2, 0.3);
    RR.VehicleArt.draw(ctx, body, tuned, v.colors, 1.2, {});
    RR.VehicleArt.draw(ctx, body, tuned, v.colors, 1.2, { crashed: true, boost: true, thruster: true, shield: true, headlights: true, throttle: 1, lean: -1 });
    // wheels flung far away / NaN wheel positions are clamped, never propagated
    const bad = mockBody(tuned, 5, 2, 0.3);
    bad.wheels[0].x = NaN; bad.wheels[1].x = 1e6;
    RR.VehicleArt.draw(ctx, bad, tuned, null, NaN, null);
    const lp = RR.VehicleArt.lampPoint(body, tuned);
    const ep = RR.VehicleArt.exhaustPoint(body, tuned);
    [lp.x, lp.y, lp.angle, ep.x, ep.y, ep.angle].forEach((n) => H.assertFinite(n, v.style + ' lamp/exhaust'));
    H.assert(lp.x > body.x - 0.5, v.style + ' lamp should be at the front');
  }
  RR.VehicleArt.draw(ctx, { x: NaN, y: 0 }, tunedFor('x', 'buggy'), null, 0, {});   // ignored
  RR.VehicleArt.draw(ctx, { x: 0, y: 0, angle: 0 }, {}, {}, 0, {});                    // no wheels, empty tuned
  assertClean(rec, 'vehicleArt');
});

H.test('VehicleArt: helmet is drawn exactly at tuned.chassis.head', () => {
  const tuned = tunedFor(VEHICLES[0].id, VEHICLES[0].style);
  const head = tuned.chassis.head;
  const base = H.createStubContext2D(H.createStubElement('canvas'));
  const arcs = [];
  const ctx = new Proxy(base, { get(t, k) { if (k === 'arc') return (...a) => arcs.push(a); return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
  RR.VehicleArt.draw(ctx, mockBody(tuned, 0, 0, 0), tuned, null, 0, {});
  const hit = arcs.find((a) => Math.abs(a[0] - head.x) < 1e-9 && Math.abs(a[1] - head.y) < 1e-9 && Math.abs(a[2] - head.r) < 1e-9);
  H.assert(hit, 'expected an arc at the head circle (' + head.x + ', ' + head.y + ', r ' + head.r + ')');
});

H.test('VehicleArt: drawPreview for every vehicle, unknown ids and odd sizes', () => {
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  for (const v of VEHICLES) for (let t = 0; t < 3; t += 0.7) RR.VehicleArt.drawPreview(ctx, v.id, v.colors, 320, 180, t);
  RR.VehicleArt.drawPreview(ctx, 'does_not_exist', null, 200, 120, 0);
  RR.VehicleArt.drawPreview(ctx, VEHICLES[0].id, { body: '#123456' }, 64, 400, 1);   // partial paint
  RR.VehicleArt.drawPreview(ctx, VEHICLES[0].id, null, 0, 0, 0);                     // no-op
  assertClean(rec, 'drawPreview');
});

// ================================================================ background
H.test('Background: every world draws sky + weather over many frames (incl. rain, lightning, fog)', () => {
  for (const world of RR.Worlds.list) {
    const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
    const bg = new RR.Background(world, 7);
    const cam = mockCamera(0, 0, 1280, 720);
    const env = { wind: 3, rain: 0.8, lightning: 1, fog: 0.5 };
    for (let f = 0; f < 90; f++) {
      cam.cx = cam.x = f * 0.4; cam.cy = cam.y = Math.sin(f * 0.1) * 30;
      bg.update(1 / 60, cam, env);
      bg.drawSky(ctx, cam, 1280, 720, env);
      bg.drawWeather(ctx, cam, 1280, 720, env);
    }
    bg.flash(1);
    bg.floorY = 400;
    bg.drawSky(ctx, cam, 1280, 720, env);
    bg.floorY = NaN;
    bg.drawSky(ctx, cam, 1280, 720, null);
    assertClean(rec, world.id + ' background');
    H.assert(rec.calls > 100, world.id + ' background should actually draw');
  }
});

H.test('Background: env.lightning pulses (EventSystem semantics) trigger a flash on the rising edge', () => {
  const bg = new RR.Background('green_valley', 1);   // no ambient lightning in this world
  const cam = mockCamera(0, 0, 800, 450);
  const env = { lightning: 0 };
  for (let f = 0; f < 30; f++) bg.update(1 / 60, cam, env);
  H.assert(bg._flash === 0, 'no flash without a pulse');
  env.lightning = 1;
  bg.update(1 / 60, cam, env);
  H.assert(bg._flash > 0.9 && bg._boltN > 1, 'rising edge flashes with a bolt');
  for (let f = 0; f < 60; f++) { env.lightning = Math.max(0, env.lightning - 0.04); bg.update(1 / 60, cam, env); }
  H.assert(bg._flash === 0, 'flash decays while the pulse decays (no re-trigger)');
});

H.test('Background: quality, world switching, resize and garbage input', () => {
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  const bg = new RR.Background(null, undefined);        // falls back to the first world
  H.assert(bg.world && bg.world.id === RR.Worlds.list[0].id, 'fallback world');
  for (const q of ['low', 'medium', 'high', 'nope']) {
    bg.setQuality(q);
    bg.update(0.016, null, null);
    bg.drawSky(ctx, null, 640, 360, null);
    bg.drawWeather(ctx, null, 640, 360, null);
  }
  bg.setWorld('snow_peaks', 99);
  H.assert(bg.world.id === 'snow_peaks', 'setWorld by id');
  bg.update(NaN, { x: NaN, y: NaN, zoom: NaN }, { wind: NaN, rain: NaN, lightning: NaN });
  bg.drawSky(ctx, { x: NaN, y: Infinity, zoom: -1 }, 300, 200, {});
  bg.drawSky(ctx, null, 0, 0, null);                     // no-op
  bg.drawWeather(ctx, null, 1920, 1080, null);           // resize path
  assertClean(rec, 'background garbage');
});

H.test('Background.drawThumbnail: every world (cached re-draw)', () => {
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  for (const world of RR.Worlds.list) {
    RR.Background.drawThumbnail(ctx, 240, 140, world);
    RR.Background.drawThumbnail(ctx, 240, 140, world.id);
  }
  RR.Background.drawThumbnail(ctx, 240, 140, null);
  RR.Background.drawThumbnail(ctx, 0, 0, RR.Worlds.list[0]);
  assertClean(rec, 'thumbnails');
  H.assert(rec.ops.drawImage >= RR.Worlds.list.length * 2, 'thumbnails are blitted from the cache');
});

// ================================================================ renderer
H.test('Renderer: resize is cheap/idempotent and DPR caps follow quality', () => {
  const { el } = stubCanvas(1000, 600);
  CTX.devicePixelRatio = 3;
  const r = new RR.Renderer(el);
  H.assert(r.w === 1000 && r.h === 600, 'css size');
  H.assert(r.dpr === 2 && el.width === 2000 && el.height === 1200, 'high caps dpr at 2 (got ' + r.dpr + ')');
  H.assert(r.resize() === false, 'second resize is a no-op');
  r.setQuality('medium');
  H.assert(r.dpr === 1.5 && el.width === 1500, 'medium caps dpr at 1.5');
  r.setQuality('low');
  H.assert(r.dpr === 1 && el.width === 1000, 'low caps dpr at 1');
  el.clientWidth = 1200;
  H.assert(r.resize() === true && r.w === 1200, 'resize picks up a new size');
  CTX.devicePixelRatio = 1;
  r.setQuality('high');
  H.assert(r.dpr === 1, 'dpr never above the device ratio');
});

H.test('Renderer: worldTransform / screenTransform follow the contract formula', () => {
  const { el, rec } = stubCanvas(800, 450);
  CTX.devicePixelRatio = 2;
  const r = new RR.Renderer(el);
  CTX.devicePixelRatio = 1;
  const cam = mockCamera(12, -3, 800, 450);
  cam.zoom = 30; cam.cx = 12.5; cam.cy = -2.5;
  r.worldTransform(cam);
  const t = rec.transforms[rec.transforms.length - 1];
  const d = 2, z = 30;
  const want = [d * z, 0, 0, -d * z, d * (800 / 2 - 12.5 * z), d * (450 / 2 + -2.5 * z)];
  want.forEach((v, i) => H.assertClose(t[i], v, 1e-9, 'worldTransform[' + i + ']'));
  // camera without cx/cy: x + shake
  r.worldTransform({ x: 1, y: 2, zoom: 10, shakeX: 0.5, shakeY: -0.5 });
  const t2 = rec.transforms[rec.transforms.length - 1];
  H.assertClose(t2[4], d * (400 - 1.5 * 10), 1e-9, 'shake x');
  H.assertClose(t2[5], d * (225 + 1.5 * 10), 1e-9, 'shake y');
  r.screenTransform();
  const s = rec.transforms[rec.transforms.length - 1];
  H.assert(s[0] === 2 && s[3] === 2 && s[4] === 0 && s[5] === 0, 'screenTransform');
});

H.test('Renderer: drawRun for every world × every vehicle style (mock terrain)', () => {
  const { el, rec } = stubCanvas(960, 540);
  const r = new RR.Renderer(el);
  for (const world of RR.Worlds.list) {
    VEHICLES.forEach((veh, i) => {
      const run = makeRun(world, veh, { x: 30 + i * 25 });
      r.drawRun(run);
      run.time += 0.5;
      r.drawRun(run);
    });
  }
  assertClean(rec, 'drawRun all worlds');
  H.assert(rec.calls > 10000, 'expected real drawing work, got ' + rec.calls + ' calls');
});

H.test('Renderer: variants — darkness/cave/headlights, tint, crash flash, slow-time, low fuel, boost/shield/thruster', () => {
  const { el, rec } = stubCanvas(1280, 720);
  const r = new RR.Renderer(el);
  const world = RR.Worlds.byId('volcanic_ridge');
  const variants = [
    { env: { darkness: 0.9 }, cave: true },
    { env: { darkness: 0.05 } },
    { env: { tint: 'rgba(255,60,20,0.2)' } },
    { env: { tint: '#ff2200' } },
    { env: { tint: { color: '#3366ff', alpha: 0.3 } } },
    { env: { tint: 42 } },
    { run: { state: 'crashed' } },
    { powerUps: ['slowtime'] },
    { run: { fuel: 5 } },
    { run: { fuel: 0, state: 'nofuel' } },
    { powerUps: ['boost', 'shield'], run: { specialActive: true } },
    { env: { rain: 1, lightning: 1 } },
    { run: { bestDistance: 0 } },
    { x: 150 },                                         // lava pool in view
    { x: -40, run: { time: -2 } },                      // start area (negative x) and negative clock
    { run: { body: undefined } }
  ];
  for (const v of variants) {
    for (const veh of VEHICLES) {
      const run = makeRun(world, veh, v);
      for (let f = 0; f < 3; f++) { r.drawRun(run); run.time += 0.2; }
    }
  }
  assertClean(rec, 'variants');
  H.assert((rec.ops.drawImage || 0) > 0, 'darkness / glow sprites should blit');
});

H.test('Renderer: real Terrain + VehicleBody + Camera when available', () => {
  if (!RR.Terrain || !RR.VehicleBody || !RR.Camera || !RR.Vehicles) { console.log('    (skipped: real modules not all present)'); return; }
  const { el, rec } = stubCanvas(1280, 720);
  const r = new RR.Renderer(el);
  for (const world of RR.Worlds.list) {
    const terrain = new RR.Terrain({ seed: 1234, world, modifiers: null });
    terrain.ensure(600);
    const veh = VEHICLES[RR.Worlds.list.indexOf(world) % VEHICLES.length];
    const tuned = RR.Vehicles.getTuned(veh.id, {});
    const body = new RR.VehicleBody(tuned, 120, 5);
    body.placeOnTerrain(terrain, 120);
    const run = makeRun(world, veh, { terrain, body });
    for (let f = 0; f < 30; f++) {
      body.step(1 / 60, { throttle: 1, lean: 0, handbrake: false, boost: 0, engineOn: true }, { terrain, gravity: 9.81 * world.gravity, wind: 0, frictionMul: 1, sensitivity: 1 });
      run.camera.update(1 / 60, { x: body.x, y: body.y, vx: body.vx, vy: body.vy, airTime: body.airTime }, {});
      run.background.update(1 / 60, run.camera, run.env);
      run.time += 1 / 60;
      r.drawRun(run);
    }
  }
  assertClean(rec, 'real modules');
});

H.test('Renderer: degrades gracefully with partial runs and faulty modules', () => {
  const { el, rec } = stubCanvas(800, 450);
  const r = new RR.Renderer(el);
  const world = RR.Worlds.list[0];
  const veh = VEHICLES[0];
  r.drawRun(null);
  r.drawRun({});
  r.drawRun({ world });
  r.drawRun({ world, body: mockBody(tunedFor(veh.id, veh.style), 0, 1, 0) });           // no camera, no terrain
  r.drawRun(makeRun(world, veh, { noCamera: true, noBackground: true }));
  r.drawRun(makeRun(world, veh, { run: { env: undefined, powerUps: { isActive() { throw new Error('boom'); } } } }));
  const origErr = console.error;
  let logged = 0;
  console.error = () => { logged++; };
  try {
    const run = makeRun(world, veh, {
      run: {
        collectibles: { draw() { throw new Error('collectibles bug'); } },
        events: { drawWorld() { throw new Error('events bug'); }, drawScreen() { throw new Error('events bug'); } },
        floatText: { draw() { throw new Error('ft bug'); } }
      }
    });
    for (let f = 0; f < 5; f++) r.drawRun(run);
  } finally {
    console.error = origErr;
  }
  H.assert(logged === 4, 'each faulty module logged exactly once (got ' + logged + ')');
  // NaN body / camera never reach the canvas
  const bad = makeRun(world, veh, {});
  bad.body.x = NaN;
  r.drawRun(bad);
  assertClean(rec, 'partial runs');
});

H.test('Renderer: scratch buffers are reused across frames (no per-frame big allocations)', () => {
  const { el } = stubCanvas(960, 540);
  const r = new RR.Renderer(el);
  const run = makeRun(RR.Worlds.list[0], VEHICLES[0], {});
  r.drawRun(run);
  const xs = r._xs, ys = r._ys, lava = r._lava;
  for (let f = 0; f < 50; f++) { run.body.x += 0.3; run.camera.cx = run.camera.x = run.body.x; r.drawRun(run); }
  H.assert(r._xs === xs && r._ys === ys && r._lava === lava, 'terrain scratch arrays were reallocated');
});

H.test('Renderer: every decoration type used by any world has a dedicated painter', () => {
  const types = new Set();
  for (const w of RR.Worlds.list) for (const d of w.decorations) types.add(d);
  const missing = [...types].filter((t) => RR.Renderer.DECORATION_TYPES.indexOf(t) < 0);
  H.assert(missing.length === 0, 'missing painters: ' + missing.join(', '));
  const { ctx, rec } = checkingContext(H.createStubElement('canvas'));
  for (const w of RR.Worlds.list) {
    for (const t of RR.Renderer.DECORATION_TYPES) {
      for (let v = 0; v < 4; v++) {
        RR.Renderer.drawDecoration(ctx, { x: 3, y: 1, type: t, scale: 1, variant: v }, w, v * 0.7, 40);
        // negative world x (start area) and negative / huge times must never produce negative radii
        RR.Renderer.drawDecoration(ctx, { x: -37.3 - v, y: -2, type: t, scale: 0.2 + v, variant: v }, w, -3.3 * v, 40);
        RR.Renderer.drawDecoration(ctx, { x: 1e5 + v * 0.13, y: 0, type: t, scale: 1, variant: v }, w, 1e4 + v * 0.31, 40);
      }
    }
  }
  RR.Renderer.drawDecoration(ctx, { x: NaN, y: undefined, type: 'tree', scale: NaN }, null, NaN, 40);
  assertClean(rec, 'decorations');
});

H.done();
