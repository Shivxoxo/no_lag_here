/* RIDGE RUSH — tests for RR.VehicleBody (physics), RR.Vehicles (data/upgrades) and RR.Camera.
 * Run: node tests/physics.test.js
 * Uses mock heightfield terrains built here (same semantics as RR.Terrain: piecewise-linear samples
 * every DX m, heightAt/slopeAt/normalAt/surfaceAt/closestPoint/ceilingAt) and, when
 * js/game/terrain.js exists, a pass over the real procedural terrain for every world. */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const RR = H.load(['js/core/utils.js', 'js/data/vehicles.js', 'js/data/worlds.js', 'js/game/physics.js', 'js/game/camera.js']);
const V = RR.Vehicles;
const DT = RR.CONST.PHYS_DT;
const DEG = Math.PI / 180;
const G = RR.CONST.GRAVITY;
const IDS = V.list.map((v) => v.id);
const MAXED = { engine: 10, suspension: 10, tires: 10, fuel: 10, grip: 10, air: 10, brakes: 10 };
const CATS = ['engine', 'suspension', 'tires', 'fuel', 'grip', 'air', 'brakes'];

// ------------------------------------------------------------------ mock terrain
const MDX = 0.5;
class MockTerrain {
  constructor(fn, opts) {
    opts = opts || {};
    this.fn = fn;
    this.DX = MDX;
    this.minX = -1e6; this.maxX = 1e6;
    this.surface = opts.surface || RR.SURFACES.grass;
    this.surfaceFn = opts.surfaceFn || null;
    this.ceil = opts.ceiling || null;
    this._cache = new Map();
  }
  _s(i) {
    let v = this._cache.get(i);
    if (v === undefined) { v = this.fn(i * MDX); this._cache.set(i, v); }
    return v;
  }
  heightAt(x) {
    const f = x / MDX, i = Math.floor(f), t = f - i;
    const a = this._s(i), b = this._s(i + 1);
    return a + (b - a) * t;
  }
  slopeAt(x) { const i = Math.floor(x / MDX); return (this._s(i + 1) - this._s(i)) / MDX; }
  normalAt(x, out) {
    out = out || {};
    const s = this.slopeAt(x), l = Math.sqrt(1 + s * s);
    out.x = -s / l; out.y = 1 / l;
    return out;
  }
  surfaceAt(x) { return this.surfaceFn ? this.surfaceFn(x) : this.surface; }
  ceilingAt(x) { return this.ceil ? this.ceil(x) : null; }
  closestPoint(px, py, maxDist, out) {
    const i0 = Math.floor((px - maxDist) / MDX), i1 = Math.floor((px + maxDist) / MDX);
    let best = Infinity;
    for (let i = i0; i <= i1; i++) {
      const xa = i * MDX, ya = this._s(i), ex = MDX, ey = this._s(i + 1) - ya;
      let t = ((px - xa) * ex + (py - ya) * ey) / (ex * ex + ey * ey);
      t = Math.max(0, Math.min(1, t));
      const cx = xa + ex * t, cy = ya + ey * t, d = Math.hypot(px - cx, py - cy);
      if (d < best) { best = d; out.x = cx; out.y = cy; }
    }
    out.inside = py < this.heightAt(px);
    if (!(best <= maxDist)) { out.dist = Infinity; return false; }
    out.dist = best;
    if (best > 1e-9) { out.nx = (px - out.x) / best; out.ny = (py - out.y) / best; }
    else { const n = this.normalAt(out.x); out.nx = n.x; out.ny = n.y; }
    return true;
  }
}

const Terr = {
  flat: () => new MockTerrain(() => 0),
  // flat until x0, then a constant slope for `len` metres, then flat again
  slope: (deg, x0, len) => {
    const s = Math.tan(deg * DEG), L = len || 200;
    return new MockTerrain((x) => (x <= x0 ? 0 : (Math.min(x, x0 + L) - x0) * s));
  },
  // rolling hills with small bumps
  bumpy: () => new MockTerrain((x) => 4 * Math.sin(x / 13) + 1.2 * Math.sin(x / 4.1 + 1) +
    0.35 * Math.sin(x * 1.3) + 0.15 * Math.sin(x * 3.7 + 2) + (x > 300 ? 0.02 * (x - 300) : 0)),
  sineBumps: () => new MockTerrain((x) => 0.35 * Math.sin(x * 1.6)),
  // run-up, smooth transition into a 30° ramp (lip 3.44 m high at x≈68.5), trench, flat landing
  ramp: () => new MockTerrain((x) => {
    const x0 = 60, lc = 5, s = Math.tan(30 * DEG), arcH = s * lc / 2, lip = x0 + lc + 2 / s;
    if (x <= x0) return 0;
    if (x <= x0 + lc) return s * (x - x0) * (x - x0) / (2 * lc);
    if (x <= lip) return arcH + (x - x0 - lc) * s;
    if (x < 96) return -6;
    return 0;
  }),
  RAMP_LIP: 60 + 5 + 2 / Math.tan(30 * DEG),
  // flat until x0 then a wall of the given angle rising 250 m
  wall: (deg, x0) => {
    const s = Math.tan(deg * DEG);
    return new MockTerrain((x) => (x <= x0 ? 0 : Math.min((x - x0) * s, 250)));
  },
  // flat floor with a low cave ceiling
  cave: (ceilY) => new MockTerrain(() => 0, { ceiling: () => ceilY })
};

// ------------------------------------------------------------------ helpers
function makeBody(id, upgrades) {
  const t = V.getTuned(id, upgrades || {});
  return { t, b: new RR.VehicleBody(t, 0, 0) };
}
function envFor(terrain, extra) {
  return Object.assign({ terrain, gravity: G, wind: 0, frictionMul: 1, sensitivity: 1 }, extra || {});
}
// Simulate `seconds`; ctl(time, body) → controls; onStep(body, time, i) may return true to stop.
function sim(b, terrain, seconds, ctl, extraEnv, onStep) {
  const env = envFor(terrain, extraEnv);
  const n = Math.round(seconds / DT);
  const fixed = typeof ctl === 'function' ? null : (ctl || {});
  for (let i = 0; i < n; i++) {
    const time = i * DT;
    b.step(DT, fixed || ctl(time, b), env);
    if (onStep && onStep(b, time + DT, i)) return i + 1;
  }
  return n;
}
const speed = (b) => Math.hypot(b.vx, b.vy);
// Deepest penetration (m) of wheel centres below the ground and of hull points / head.
function penetration(b, terrain) {
  let wheel = -Infinity, hull = -Infinity;
  for (const w of b.wheels) wheel = Math.max(wheel, terrain.heightAt(w.x) - w.y);
  const P = b._P, tmp = { x: 0, y: 0 };
  for (const p of P.hull) {
    b.worldPoint(p.x, p.y, tmp);
    hull = Math.max(hull, terrain.heightAt(tmp.x) - tmp.y);
  }
  const hd = b.getHead();
  const n = terrain.normalAt(hd.x, {});
  hull = Math.max(hull, (terrain.heightAt(hd.x) - hd.y) * n.y - hd.r);
  return { wheel, hull, com: terrain.heightAt(b.x) - b.y };
}
function allFinite(b) {
  const vals = [b.x, b.y, b.angle, b.vx, b.vy, b.av, b.airTime];
  for (const w of b.wheels) vals.push(w.x, w.y, w.vx, w.vy, w.omega, w.spin, w.compression, w.load);
  return vals.every((v) => typeof v === 'number' && Number.isFinite(v));
}
// Full throttle on flat; `hold` = the driver leans forward to hold down a launch wheelie.
function topSpeedRun(id, upgrades, hold) {
  const { b, t } = makeBody(id, upgrades);
  const terrain = Terr.flat();
  b.placeOnTerrain(terrain, 0);
  let top = 0, t15 = null, maxPitch = 0;
  const drive = (time, body) => ({ throttle: 1, lean: hold && body.angle > 8 * DEG ? -1 : 0 });
  sim(b, terrain, 40, drive, null, (body, time) => {
    maxPitch = Math.max(maxPitch, Math.abs(body.angle));
    const s = speed(body);
    if (s > top) top = s;
    if (t15 === null && s >= 15) t15 = time;
  });
  return { top, t15, design: t.topSpeed, b, maxPitch };
}
const fmt = (v, d) => (v === null || v === undefined ? '  —  ' : v.toFixed(d === undefined ? 2 : d));

console.log('RR.Vehicles / RR.VehicleBody / RR.Camera');

// ================================================================== 12. data & upgrades
H.test('12a vehicle catalogue matches the contract', () => {
  const expect = {
    trail_buggy: ['Trail Buggy', 1, 0, 0, 'buggy'], dirt_runner: ['Dirt Runner', 2, 2500, 1, 'dirt'],
    mountain_truck: ['Mountain Truck', 4, 7500, 2, 'truck'], rally_beast: ['Rally Beast', 7, 15000, 3, 'rally'],
    rock_crawler: ['Rock Crawler', 10, 25000, 4, 'crawler'], storm_runner: ['Storm Runner', 14, 45000, 6, 'storm']
  };
  H.assert(V.list.length === 6, 'six vehicles');
  H.assert(JSON.stringify(IDS) === JSON.stringify(Object.keys(expect)), 'display order ' + IDS);
  for (const v of V.list) {
    const e = expect[v.id];
    H.assert(v.name === e[0] && v.unlock.level === e[1] && v.unlock.coins === e[2] && v.unlock.tokens === e[3] && v.style === e[4], v.id);
    H.assert(typeof v.tagline === 'string' && v.tagline && typeof v.description === 'string' && v.description, v.id + ' texts');
    for (const k of ['body', 'accent', 'trim', 'wheel', 'rim']) H.assert(/^#[0-9a-f]{6}$/i.test(v.colors[k]), v.id + ' color ' + k);
    H.assert(v.upgradeBaseCost > 0 && v.base && typeof v.base === 'object', v.id + ' cost/base');
    H.assert(V.byId(v.id) === v, 'byId');
  }
  H.assert(V.byId('nope') === null, 'unknown id → null');
  const storm = V.byId('storm_runner').special;
  H.assert(storm && storm.id === 'thruster' && storm.name === 'Ion Thruster' && storm.cooldown > 5 && storm.duration > 0.8 && storm.force > 0, 'thruster');
  H.assert(V.list.filter((v) => v.special).length === 1, 'only Storm Runner has a special');
  H.assert(JSON.stringify(V.UPGRADE_CATEGORIES.map((c) => c.id)) === JSON.stringify(CATS), 'category ids');
  H.assert(JSON.stringify(V.UPGRADE_CATEGORIES.map((c) => c.name)) ===
    JSON.stringify(['ENGINE', 'SUSPENSION', 'TIRES', 'FUEL', 'GRIP', 'AIR CONTROL', 'BRAKES']), 'category names');
  H.assert(V.MAX_UPGRADE_LEVEL === 10, 'max level');
});

H.test('12b getTuned returns complete, finite TunedParams for every vehicle and level', () => {
  for (const id of IDS) {
    for (const up of [{}, MAXED, { engine: 5, grip: 3 }, { engine: 'x', air: 99, brakes: -4 }, null]) {
      const t = V.getTuned(id, up);
      H.assert(t.id === id && t.style === V.byId(id).style, 'id/style');
      H.assert(t.chassis.mass > 0 && t.chassis.inertia > 0 && t.chassis.hull.length >= 3, 'chassis');
      H.assert(t.chassis.head.r > 0, 'head');
      H.assert(t.wheels.length === 2, 'wheels');
      for (const w of t.wheels) {
        for (const k of ['radius', 'mass', 'inertia']) H.assert(w[k] > 0, 'wheel ' + k);
        H.assert(w.drive >= 0 && w.drive <= 1 && Number.isFinite(w.mount.x) && Number.isFinite(w.mount.y), 'wheel mount/drive');
      }
      H.assertClose(t.wheels[0].drive + t.wheels[1].drive, 1, 1e-9, 'drive shares sum to 1');
      H.assert(t.wheels[0].mount.x < 0 && t.wheels[1].mount.x > 0, 'rear then front');
      const s = t.suspension;
      H.assert(s.minLen > 0 && s.maxLen > s.minLen && s.rest > 0 && s.stiffness > 0 && s.damping > 0, 'suspension');
      const m = t.motor;
      H.assert(m.torque > 0 && m.maxOmega > 0 && m.reverseTorque > 0 && m.reverseMaxOmega > 0, 'motor');
      H.assert(t.brakeTorque > 0 && t.grip > 0 && t.surfaceAdapt >= 0 && t.surfaceAdapt <= 1 && t.rollingResistance > 0, 'grip/brake');
      H.assert(t.airTorque > 0 && t.groundLeanTorque > 0 && t.angularDampingAir >= 0, 'air');
      H.assert(t.fuel.capacity > 0 && t.fuel.burnRate > 0 && t.fuel.idleBurn >= 0, 'fuel');
      H.assert(t.maxSpeed > 0 && t.maxSpeed * 1.3 <= RR.CONST.MAX_SPEED, 'maxSpeed');
      H.assert((t.special === null) === (id !== 'storm_runner'), 'special');
      const flat = JSON.stringify(t);
      H.assert(!/null,"|NaN|Infinity/.test(flat.replace('"special":null', '')), 'finite fields ' + id);
      // head must be the highest point so an upside-down car always lands on it
      const topHull = Math.max(...t.chassis.hull.map((p) => p.y));
      H.assert(t.chassis.head.y + t.chassis.head.r > topHull + 0.05, id + ' head above hull');
    }
    H.assert(V.getTuned(id, {}) !== V.getTuned(id, {}), 'fresh object each call');
  }
  const t = V.getTuned('nope', {});
  H.assert(t.id === 'trail_buggy', 'unknown id falls back to the starter');
});

H.test('12c getTuned is monotonic and meaningful per category (level 10 vs 1)', () => {
  const primary = {
    engine: (t) => t.motor.torque, suspension: (t) => t.suspension.zeta, tires: (t) => t.surfaceAdapt,
    fuel: (t) => t.fuel.capacity, grip: (t) => t.grip, air: (t) => t.airTorque, brakes: (t) => t.brakeTorque
  };
  const also = {
    engine: [(t) => t.motor.maxOmega, (t) => t.topSpeed],
    suspension: [(t) => t.suspension.maxLen - t.suspension.minLen, (t) => t.suspension.damping],
    tires: [(t) => -t.rollingResistance, (t) => t.topSpeed],
    fuel: [(t) => -t.fuel.burnRate, (t) => t.fuel.capacity / t.fuel.burnRate],
    grip: [], air: [(t) => t.groundLeanTorque],
    brakes: [(t) => t.motor.reverseTorque, (t) => t.motor.reverseMaxOmega]
  };
  for (const id of IDS) {
    for (const cat of CATS) {
      let prev = null;
      const vals = [];
      for (let lv = 1; lv <= 10; lv++) {
        const t = V.getTuned(id, { [cat]: lv });
        const f = [primary[cat](t)].concat(also[cat].map((fn) => fn(t)));
        if (prev) f.forEach((v, k) => H.assert(v > prev[k] - 1e-12, id + ' ' + cat + ' monotonic @' + lv + ' #' + k));
        prev = f;
        vals.push(f[0]);
      }
      if (cat !== 'tires') {
        const gain = vals[9] / vals[0] - 1;
        H.assert(gain >= 0.55 && gain <= 0.8, id + ' ' + cat + ' primary gain ' + gain.toFixed(2));
      } else {
        H.assert(vals[9] - vals[0] >= 0.5, 'tires adapt gain');
      }
      // other categories untouched
      const base = V.getTuned(id, {}), up = V.getTuned(id, { [cat]: 10 });
      if (cat !== 'engine' && cat !== 'tires') H.assertClose(up.motor.torque, base.motor.torque, 1e-9, cat + ' leaves torque');
      if (cat !== 'grip') H.assertClose(up.grip, base.grip, 1e-9, cat + ' leaves grip');
    }
  }
});

H.test('12d upgradeCost follows the contract formula', () => {
  const MULT = { engine: 1.2, suspension: 0.9, tires: 0.8, fuel: 0.85, grip: 0.9, air: 0.7, brakes: 0.6 };
  // (integration economy pass: base costs ×1.5)
  const BASE = { trail_buggy: 180, dirt_runner: 225, mountain_truck: 300, rally_beast: 390, rock_crawler: 450, storm_runner: 630 };
  for (const id of IDS) {
    H.assert(V.byId(id).upgradeBaseCost === BASE[id], id + ' base cost');
    for (const cat of CATS) {
      let prev = 0;
      for (let lv = 1; lv < 10; lv++) {
        const c = V.upgradeCost(id, cat, lv);
        H.assert(c === Math.round(BASE[id] * MULT[cat] * Math.pow(1.55, lv - 1) / 10) * 10, id + ' ' + cat + ' ' + lv);
        H.assert(c > prev && c % 10 === 0, 'increasing, multiple of 10');
        prev = c;
      }
      H.assert(V.upgradeCost(id, cat, 10) === Infinity, 'max level → Infinity');
    }
  }
  H.assert(V.upgradeCost('nope', 'engine', 1) === Infinity && V.upgradeCost('trail_buggy', 'nope', 1) === Infinity, 'unknown');
  H.assert(V.upgradeCost('trail_buggy', 'engine', 1) === 220, 'buggy engine 1→2 = 220');
});

H.test('12e describeUpgrade and displayStats are readable and increase with upgrades', () => {
  const pattern = {
    engine: /^Torque$/, suspension: /^Damping$/, tires: /^Top speed$/, fuel: /^Tank$/, grip: /^Grip$/,
    air: /^Air torque$/, brakes: /^Brake$/
  };
  const d0 = V.describeUpgrade('trail_buggy', 'engine', 1);
  H.assert(/^\d{3,}(,\d{3})? Nm$/.test(d0.value) || /^\d{1,3}(,\d{3})+ Nm$/.test(d0.value), 'torque value ' + d0.value);
  H.assert(/^\d+ L · \d+\.\d L\/s$/.test(V.describeUpgrade('trail_buggy', 'fuel', 1).value), 'tank format');
  // (integration balance pass: full-throttle consumption = burnRate + idleBurn)
  H.assert(V.describeUpgrade('trail_buggy', 'fuel', 1).value === '100 L · 4.9 L/s', 'buggy tank ' + V.describeUpgrade('trail_buggy', 'fuel', 1).value);
  H.assert(/^μ \d\.\d\d$/.test(V.describeUpgrade('trail_buggy', 'grip', 1).value), 'grip format');
  H.assert(/km\/h$/.test(V.describeUpgrade('trail_buggy', 'tires', 4).value), 'tires km/h');
  for (const id of IDS) {
    for (const cat of CATS) {
      const lo = V.describeUpgrade(id, cat, 1), hi = V.describeUpgrade(id, cat, 10);
      H.assert(pattern[cat].test(lo.stat) && typeof lo.value === 'string' && lo.value.length > 2, id + ' ' + cat + ' ' + lo.stat);
      H.assert(!/NaN|undefined|Infinity/.test(lo.value + hi.value + lo.detail + hi.detail), 'no junk');
      H.assert(lo.value !== hi.value && hi.amount > lo.amount, id + ' ' + cat + ' changes: ' + lo.value + ' → ' + hi.value);
    }
    const s0 = V.displayStats(id, {});
    const keys = ['speed', 'accel', 'grip', 'suspension', 'air', 'fuel', 'stability'];
    for (const k of keys) H.assert(s0[k] >= 0 && s0[k] <= 10, id + ' ' + k + ' in 0..10: ' + s0[k]);
    for (const cat of CATS) {
      let prev = s0;
      for (let lv = 2; lv <= 10; lv++) {
        const s = V.displayStats(id, { [cat]: lv });
        for (const k of keys) H.assert(s[k] >= prev[k] - 1e-9, id + ' ' + cat + ' ' + k + ' non-decreasing');
        prev = s;
      }
    }
    const sMax = V.displayStats(id, MAXED);
    H.assert(keys.filter((k) => sMax[k] > s0[k]).length >= 6, id + ' maxed improves nearly every bar');
  }
  const d = V.describeUpgrade('nope', 'engine', 1);
  H.assert(d && typeof d.stat === 'string', 'unknown vehicle safe');
  // character: crawler grips most, dirt runner rotates fastest, storm is fastest, truck is most stable
  const st = (id) => V.displayStats(id, {});
  H.assert(st('rock_crawler').grip > st('trail_buggy').grip, 'crawler grip');
  H.assert(st('dirt_runner').air === Math.max(...IDS.map((i) => st(i).air)), 'dirt runner air');
  H.assert(st('storm_runner').speed === Math.max(...IDS.map((i) => st(i).speed)), 'storm speed');
  H.assert(st('mountain_truck').stability > st('dirt_runner').stability, 'truck stability');
});

// ================================================================== 1. rest
H.test('1 every vehicle settles at rest on flat ground (no jitter, level)', () => {
  const terrain = Terr.flat();
  for (const id of IDS) {
    for (const up of [{}, MAXED]) {
      const { b } = makeBody(id, up);
      b.placeOnTerrain(terrain, 3);
      b.y += 0.25; // small drop
      for (const w of b.wheels) w.y += 0.25;
      sim(b, terrain, 3, {});
      H.assert(speed(b) < 0.05, id + ' speed after 3 s ' + speed(b));
      const x0 = b.x, y0 = b.y;
      let maxV = 0, maxAv = 0;
      sim(b, terrain, 1, {}, null, (body) => { maxV = Math.max(maxV, speed(body)); maxAv = Math.max(maxAv, Math.abs(body.av)); });
      H.assert(maxV < 0.02 && maxAv < 0.02, id + ' jitter v ' + maxV + ' av ' + maxAv);
      H.assert(Math.hypot(b.x - x0, b.y - y0) < 0.003, id + ' drift');
      H.assert(Math.abs(b.angle) < 1.5 * DEG, id + ' level ' + (b.angle / DEG).toFixed(2) + '°');
      H.assert(b.bothGrounded && !b.bodyContact && !b.headHit, id + ' resting on both wheels');
      for (const w of b.wheels) H.assert(w.compression > 0.2 && w.compression < 0.75, id + ' sag ' + w.compression);
      const P = penetration(b, terrain);
      H.assert(P.wheel < -0.1, 'wheel centres above ground');
    }
  }
});

// ================================================================== 2. top speed
const speedTable = [];
H.test('2 every vehicle reaches its top speed on flat; balance anchors; upgrades faster', () => {
  const anchors = {
    trail_buggy: [[20, 24], [30, 34]], dirt_runner: [[21, 26], [30, 36]], mountain_truck: [[17, 22], [25, 31]],
    rally_beast: [[24, 29], [33, 39]], rock_crawler: [[13, 17], [18, 24]], storm_runner: [[26, 31], [37, 42]]
  };
  for (const id of IDS) {
    const s = topSpeedRun(id, {}, false), m = topSpeedRun(id, MAXED, true);
    speedTable.push({ id, s, m });
    H.assert(s.maxPitch < 25 * DEG, id + ' stock launch on flat with no lean stays controllable (pitch ' + (s.maxPitch / DEG).toFixed(1) + '°)');
    const [a, bnd] = anchors[id];
    H.assert(s.top >= a[0] && s.top <= a[1], id + ' stock top ' + s.top.toFixed(2));
    H.assert(m.top >= bnd[0] && m.top <= bnd[1], id + ' maxed top ' + m.top.toFixed(2));
    H.assert(m.top > s.top * 1.25, id + ' upgrades are much faster');
    H.assert(m.t15 < (s.t15 || 99), id + ' upgraded accelerates faster');
    H.assert(Math.abs(s.top - s.design) / s.design < 0.04, id + ' matches design top speed');
    H.assert(Math.abs(s.b.angle) < 5 * DEG && s.b.bothGrounded, id + ' stays planted at top speed');
  }
  H.assert(speedTable.find((r) => r.id === 'storm_runner').m.top <= 42, 'storm ≤ 42 m/s');
  // character ordering
  const top = (id) => speedTable.find((r) => r.id === id).s.top;
  const t15 = (id) => speedTable.find((r) => r.id === id).s.t15;
  H.assert(top('storm_runner') > top('rally_beast') && top('rally_beast') > top('trail_buggy') && top('trail_buggy') > top('mountain_truck') && top('mountain_truck') > top('rock_crawler'), 'top speed ordering');
  H.assert(t15('dirt_runner') < t15('trail_buggy'), 'dirt runner is snappier than the buggy');
});

// ================================================================== 3. climbing
// Standing start on the slope, full throttle. `hold`: a careful driver — leans forward when the
// nose rises more than 8° above the slope and feathers the throttle past 14° (what a player does).
function climb(id, deg, upgrades, hold) {
  const { b } = makeBody(id, upgrades);
  const terrain = Terr.slope(deg, 0, 400);
  const startX = 12;
  b.placeOnTerrain(terrain, startX);
  let maxTilt = 0, crashed = false;
  const slopeA = deg * DEG;
  const drive = (time, body) => {
    const up = body.angle - slopeA;
    return { throttle: hold && up > 14 * DEG ? 0.25 : 1, lean: hold && up > 8 * DEG ? -1 : 0 };
  };
  sim(b, terrain, 12, drive, null, (body) => {
    maxTilt = Math.max(maxTilt, Math.abs(body.angle - slopeA));
    if (body.headHit) crashed = true;
    return crashed;
  });
  const along = (b.x - startX) / Math.cos(slopeA);
  return { along, maxTilt, crashed, b };
}
H.test('3 climbing: buggy climbs 25° from a standstill, crawler climbs ≥ 38°', () => {
  const r1 = climb('trail_buggy', 25);
  H.assert(!r1.crashed && r1.along > 40, 'buggy 25°: travelled ' + r1.along.toFixed(1) + ' m, tilt ' + (r1.maxTilt / DEG).toFixed(1));
  const r2 = climb('rock_crawler', 38);
  H.assert(!r2.crashed && r2.along > 30, 'crawler 38°: ' + r2.along.toFixed(1) + ' m, tilt ' + (r2.maxTilt / DEG).toFixed(1));
  const r3 = climb('rock_crawler', 42);
  H.assert(!r3.crashed && r3.along > 20, 'crawler 42°: ' + r3.along.toFixed(1) + ' m');
  // the stock buggy cannot climb a 43° wall from a standstill, the fully upgraded one can (upgrades matter)
  const r4 = climb('trail_buggy', 43, {}, true);
  H.assert(r4.along < 10 || r4.crashed, 'stock buggy 43° should be too steep: ' + r4.along.toFixed(1));
  const r5 = climb('trail_buggy', 43, MAXED, true);
  H.assert(!r5.crashed && r5.along > 30, 'maxed buggy climbs 43° with a careful driver: ' + r5.along.toFixed(1));
  // stock climbing ability ordering on 36°: crawler > truck/rally/buggy
  const r6 = climb('trail_buggy', 36, {}, true), r7 = climb('rock_crawler', 36, {}, true);
  H.assert(r7.along >= r6.along, 'crawler climbs at least as well as the buggy on 36°');
});

// ================================================================== 4. brakes
H.test('4 brakes hold on 30° (brake facing downhill) and handbrake holds on 30°/40°', () => {
  for (const id of IDS) {
    // facing downhill (terrain descends to the right), rolling at 4 m/s, brake held: the car stops
    // within a couple of metres and never creeps further downhill (holding brake once stopped
    // becomes reverse, which may back it up the slope — never down it).
    const down = new MockTerrain((x) => -Math.max(0, x) * Math.tan(30 * DEG));
    const { b } = makeBody(id);
    b.placeOnTerrain(down, 20);
    b.setVelocity(4 * Math.cos(-30 * DEG), 4 * Math.sin(-30 * DEG));
    let maxX = b.x, stopX = null;
    sim(b, down, 6, { throttle: -1 }, null, (body) => {
      maxX = Math.max(maxX, body.x);
      if (stopX === null && body.forwardSpeed() < 0.05) stopX = body.x;
    });
    H.assert(stopX !== null && stopX - 20 < 3, id + ' stopped within 3 m (' + (stopX - 20).toFixed(2) + ')');
    H.assert(maxX - stopX < 0.05, id + ' never rolled further downhill after stopping (' + (maxX - stopX).toFixed(3) + ' m)');
    // brake released → it rolls again; brake re-applied → stops again
    sim(b, down, 1, {});
    H.assert(b.forwardSpeed() > 1, id + ' rolls when brake released');
    const x1 = b.x;
    let maxX2 = x1;
    sim(b, down, 3, { throttle: -1 }, null, (body) => { maxX2 = Math.max(maxX2, body.x); });
    H.assert(maxX2 - x1 < 3.5, id + ' stops again');
  }
  for (const deg of [30, 40]) {
    for (const dir of [1, -1]) {
      const terr = new MockTerrain((x) => dir * Math.max(0, x) * Math.tan(deg * DEG));
      for (const id of ['trail_buggy', 'mountain_truck', 'rock_crawler', 'dirt_runner']) {
        const { b } = makeBody(id);
        b.placeOnTerrain(terr, 20);
        sim(b, terr, 1.5, { handbrake: true });
        const x0 = b.x;
        sim(b, terr, 3, { handbrake: true });
        H.assert(Math.abs(b.x - x0) < 0.1 && speed(b) < 0.05, id + ' handbrake ' + deg + '° dir ' + dir + ': moved ' + (b.x - x0).toFixed(3));
      }
    }
  }
});

// ================================================================== 5. drop
H.test('5 a 10 m drop lands without tunnelling or NaN (every vehicle)', () => {
  const terrain = Terr.flat();
  for (const id of IDS) {
    const { b } = makeBody(id);
    b.setPose(5, 10 + 1.2, 0);
    let worst = { wheel: -Infinity, hull: -Infinity, com: -Infinity };
    let firstImpact = null;
    sim(b, terrain, 4, {}, null, (body) => {
      H.assert(allFinite(body), id + ' finite');
      if (firstImpact === null && body.lastImpact.count === 1 && body.time - body.lastImpact.time > 0.1) firstImpact = body.lastImpact.speed;
      const p = penetration(body, terrain);
      worst = { wheel: Math.max(worst.wheel, p.wheel), hull: Math.max(worst.hull, p.hull), com: Math.max(worst.com, p.com) };
    });
    H.assert(worst.wheel < -0.2, id + ' wheel centre never below ground (worst ' + worst.wheel.toFixed(3) + ')');
    H.assert(worst.hull < 0.12, id + ' hull penetration ' + worst.hull.toFixed(3));
    H.assert(worst.com < -0.3, id + ' chassis above ground');
    H.assert(firstImpact > 12.5 && firstImpact < 15, id + ' touchdown impact speed ' + firstImpact);
    H.assert(b.lastImpact.count >= 1, 'touchdown counted');
    H.assert(b.nanRecoveries === 0, 'no NaN recoveries');
    H.assert(b.bothGrounded && speed(b) < 0.1 && Math.abs(b.angle) < 3 * DEG, id + ' settles on its wheels after landing');
  }
});

// ================================================================== 6. walls
H.test('6 40 m/s into a 45° wall (and 25 m/s into a 75° wall) never passes through', () => {
  for (const [deg, v] of [[45, 40], [75, 25], [60, 40]]) {
    const terrain = Terr.wall(deg, 40);
    const { b } = makeBody('storm_runner', MAXED);
    b.placeOnTerrain(terrain, 12);
    b.setVelocity(v, 0);
    let worst = -Infinity, worstHull = -Infinity;
    sim(b, terrain, 5, { throttle: 1 }, null, (body) => {
      H.assert(allFinite(body), 'finite');
      const p = penetration(body, terrain);
      worst = Math.max(worst, p.wheel, p.com);
      worstHull = Math.max(worstHull, p.hull);
    });
    H.assert(worst < 0, deg + '° wall at ' + v + ' m/s: wheel/chassis penetration ' + worst.toFixed(3));
    H.assert(worstHull < 0.2, deg + '° hull penetration ' + worstHull.toFixed(3));
    H.assert(b.nanRecoveries === 0, 'no NaN');
  }
});

// ================================================================== 7. air control
function airSpin(id, upgrades, ctl, seconds) {
  const { b } = makeBody(id, upgrades);
  b.setPose(0, 200, 0);
  b.airTime = 1;
  const terrain = Terr.flat();
  const a0 = b.angle;
  sim(b, terrain, seconds || 0.8, ctl);
  return { dAngle: b.angle - a0, av: b.av, b };
}
H.test('7 air control: gas → CCW (backflip), brake → CW, lean works, AIR upgrade spins faster', () => {
  for (const id of IDS) {
    H.assert(airSpin(id, {}, { throttle: 1 }).dAngle > 0.8, id + ' gas rotates CCW');
    H.assert(airSpin(id, {}, { throttle: -1 }).dAngle < -0.8, id + ' brake rotates CW');
    H.assert(airSpin(id, {}, { lean: 1 }).dAngle > 0.8, id + ' lean back CCW');
    H.assert(airSpin(id, {}, { lean: -1 }).dAngle < -0.8, id + ' lean forward CW');
    const slow = airSpin(id, {}, { lean: 1 }).dAngle, fast = airSpin(id, { air: 10 }, { lean: 1 }).dAngle;
    H.assert(fast > slow * 1.4, id + ' AIR upgrade: ' + slow.toFixed(2) + ' → ' + fast.toFixed(2));
    const lowSens = airSpin(id, {}, { lean: 1 }, 0.8);
    H.assert(Math.abs(airSpin(id, {}, {}, 0.8).dAngle) < 0.02, id + ' no input → no spin');
    H.assert(lowSens.av <= RR.CONST.MAX_ANGULAR, 'angular clamp');
  }
  // sensitivity scales air torque
  const { b } = makeBody('trail_buggy');
  b.setPose(0, 200, 0);
  sim(b, Terr.flat(), 0.8, { lean: 1 }, { sensitivity: 0.5 });
  H.assert(b.angle < airSpin('trail_buggy', {}, { lean: 1 }).dAngle * 0.7, 'sensitivity 0.5 spins slower');
  // max spin rate stays bounded even with everything maxed
  const r = airSpin('dirt_runner', MAXED, { lean: 1, throttle: 1 }, 3);
  H.assert(Math.abs(r.av) <= RR.CONST.MAX_ANGULAR + 1e-9, 'bounded spin ' + r.av);
});

// ================================================================== 8. head crash
H.test('8 upside-down on flat ground → headHit (sticky), and a normal landing does not set it', () => {
  const terrain = Terr.flat();
  for (const id of IDS) {
    const { b } = makeBody(id);
    b.setPose(0, 2.2, Math.PI);
    sim(b, terrain, 2, {});
    H.assert(b.headHit, id + ' head hit');
    sim(b, terrain, 0.5, {});
    H.assert(b.headHit, 'sticky');
    b.headHit = false;
    const ok = makeBody(id).b;
    ok.setPose(0, 3, 0);
    sim(ok, terrain, 2, {});
    H.assert(!ok.headHit && !ok.hazard, id + ' upright landing is clean');
  }
  // low cave ceiling: jumping into it bonks the head
  const cave = Terr.cave(3.0);
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(cave, 0);
  b.vy = 9; for (const w of b.wheels) w.vy = 9;
  sim(b, cave, 1, {});
  H.assert(b.headHit, 'ceiling head hit');
  const p = b.getHead();
  H.assert(p.y + p.r < 3.0 + 0.05, 'head stays below the ceiling');
});

// ================================================================== 9. random stress
H.test('9 20k steps of random controls on bumpy terrain: no NaN, never below terrain, speeds clamped', () => {
  const rng = RR.Util.makeRng(1234);
  const terrain = Terr.bumpy();
  const lava = new MockTerrain((x) => 2 * Math.sin(x / 9) + 0.3 * Math.sin(x * 1.7),
    { surfaceFn: (x) => (Math.floor(x / 40) % 5 === 4 ? RR.SURFACES.ice : RR.SURFACES.dirt) });
  for (const id of IDS) {
    const up = rng.chance(0.5) ? MAXED : { engine: rng.int(1, 10), air: rng.int(1, 10), grip: rng.int(1, 10), suspension: rng.int(1, 10) };
    const { b, t } = makeBody(id, up);
    const terr = id === 'rally_beast' ? lava : terrain;
    b.placeOnTerrain(terr, 5);
    const env = envFor(terr, { wind: 0 });
    const vcap = Math.min(t.maxSpeed * 1.3, RR.CONST.MAX_SPEED);
    let ctl = { throttle: 0, lean: 0, handbrake: false, boost: 0 };
    let next = 0, rescues = 0, worst = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const time = i * DT;
      if (time >= next) {
        ctl = { throttle: rng.pick([-1, 0, 1, 1, 1, 0.5]), lean: rng.pick([-1, 0, 0, 1, 0.4]),
          handbrake: rng.chance(0.06), boost: rng.chance(0.08) ? 1 : 0, engineOn: !rng.chance(0.05) };
        env.wind = rng.chance(0.2) ? rng.range(-12, 12) : 0;
        env.gravity = rng.chance(0.1) ? G * 0.45 : G;
        env.frictionMul = rng.chance(0.1) ? 0.4 : 1;
        next = time + rng.range(0.15, 1.2);
      }
      b.step(DT, ctl, env);
      if (!allFinite(b)) throw new Error(id + ' non-finite at step ' + i);
      const p = penetration(b, terr);
      worst = Math.max(worst, p.wheel, p.com);
      H.assert(p.wheel < 0 && p.com < 0, id + ' below terrain at step ' + i + ' (' + p.wheel.toFixed(3) + ', ' + p.com.toFixed(3) + ')');
      H.assert(speed(b) <= vcap + 1e-6, id + ' speed clamp ' + speed(b));
      H.assert(Math.abs(b.av) <= RR.CONST.MAX_ANGULAR + 1e-9, id + ' angular clamp');
      for (const w of b.wheels) H.assert(w.compression >= 0 && w.compression <= 1 && w.load >= 0, 'wheel fields');
      if ((b.headHit || b.isUpsideDown()) && rng.chance(0.02)) { b.rescue(terr); rescues++; }
      if (b.hazard) b.hazard = null;
      if (i % 3000 === 2999 && b.x < 30) { b.rescue(terr); }
    }
    H.assert(b.nanRecoveries === 0, id + ' needed NaN recovery ' + b.nanRecoveries + 'x');
  }
});

// ================================================================== 10. anti-exploit
H.test('10 stationary lean-spam cannot flip any car (maxed AIR), nor lift a wheel much', () => {
  const terrain = Terr.flat();
  for (const id of IDS) {
    const { b } = makeBody(id, MAXED);
    b.placeOnTerrain(terrain, 0);
    let maxTilt = 0;
    // sweep spam frequencies from 0.3 Hz to 8 Hz, plus a random pattern
    const rng = RR.Util.makeRng(7);
    let rnd = 1, nextR = 0;
    sim(b, terrain, 24, (time) => {
      if (time < 20) {
        const f = 0.3 + (time / 20) * 7.7;
        return { lean: Math.sin(TAU(f, time)) >= 0 ? 1 : -1 };
      }
      if (time > nextR) { rnd = rng.pick([-1, 1]); nextR = time + rng.range(0.05, 0.6); }
      return { lean: rnd };
    }, null, (body) => { maxTilt = Math.max(maxTilt, Math.abs(body.angle)); });
    H.assert(maxTilt < 8 * DEG, id + ' tilt ' + (maxTilt / DEG).toFixed(2) + '°');
    H.assert(!b.headHit && Math.abs(b.x) < 0.5, id + ' stayed put');
  }
  function TAU(f, t) { return 2 * Math.PI * f * t; }
});

// ================================================================== 11. ramp jump
H.test('11 30° ramp at ~18 m/s: 1.5–2.5 s airtime and stock air control completes a backflip', () => {
  const terrain = Terr.ramp();
  const results = [];
  for (const id of ['trail_buggy', 'dirt_runner', 'mountain_truck', 'rally_beast', 'storm_runner']) {
    const { b } = makeBody(id);
    b.placeOnTerrain(terrain, 20);
    b.setVelocity(19.5, 0);
    let launched = false, landed = false, launchV = 0, air = 0, a0 = 0, rot = 0, launchX = 0;
    sim(b, terrain, 6, (time, body) => {
      if (!launched) return { throttle: body.x > 58 || body.forwardSpeed() < 19.5 ? 1 : 0 };
      return { throttle: 1, lean: 1 }; // W + D: full backflip input
    }, null, (body) => {
      if (!launched && body.x > Terr.RAMP_LIP - 3 && body.airTime > 0.05) {
        launched = true; launchV = speed(body); a0 = body.angle; launchX = body.x;
      }
      if (launched && !landed) {
        if (body.grounded || body.bodyContact) { landed = true; air = body.airTime || air; rot = body.angle - a0; return true; }
        air = body.airTime;
      }
      return false;
    });
    results.push({ id, launchV, air, rot });
    H.assert(launched && landed, id + ' jumped and landed');
    H.assert(launchV > 15 && launchV < 20.5, id + ' launch speed ' + launchV.toFixed(2));
    H.assert(air >= 1.5 && air <= 2.5, id + ' airtime ' + air.toFixed(2) + ' s');
    H.assert(rot >= 2 * Math.PI, id + ' completes a backflip: ' + (rot / (2 * Math.PI)).toFixed(2) + ' rotations');
  }
  console.log('      ramp:', results.map((r) => r.id + ' v' + r.launchV.toFixed(1) + ' air ' + r.air.toFixed(2) + 's rot ' + (r.rot / 6.2832).toFixed(2)).join(' | '));
});

// ================================================================== extra physics behaviour
H.test('wheelies: throttle lifts the front on a climb, and motor reaction rotates the chassis CCW', () => {
  // standing start on a 15° slope with lean back: the front wheel should lift for the light dirt runner
  const terrain = Terr.slope(15, 0, 300);
  const { b } = makeBody('dirt_runner', MAXED);
  b.placeOnTerrain(terrain, 10);
  let frontUp = 0;
  sim(b, terrain, 3, { throttle: 1, lean: 1 }, null, (body) => {
    if (body.wheels[0].grounded && !body.wheels[1].grounded) frontUp += DT;
    return body.angle > 1.2;
  });
  H.assert(frontUp > 0.15, 'wheelie time ' + frontUp.toFixed(2));
  // brake dive: braking hard compresses the front suspension more than the rear
  const flat = Terr.flat();
  const r = makeBody('trail_buggy').b;
  r.placeOnTerrain(flat, 0);
  r.setVelocity(18, 0);
  sim(r, flat, 0.4, { throttle: -1 });
  H.assert(r.wheels[1].compression > r.wheels[0].compression + 0.05, 'nose dives under braking');
  H.assert(r.angle < -0.5 * DEG, 'pitches forward under braking');
});

H.test('SUSPENSION upgrade: softer landings (lower peak deceleration, no rebound hop)', () => {
  const flat = Terr.flat();
  const land = (id, lv) => {
    const { b } = makeBody(id, { suspension: lv });
    b.placeOnTerrain(flat, 0);
    const y0 = b.y;
    b.setPose(0, y0 + 3, 0);
    let landed = false, peak = 0, pv = 0, hop = 0, minY = Infinity, minI = -1, rise = -Infinity;
    sim(b, flat, 4, {}, null, (body, time, i) => {
      const a = (body.vy - pv) / DT; pv = body.vy;
      if (!landed && body.grounded) landed = true;
      if (!landed) return;
      peak = Math.max(peak, a);
      if (!body.grounded) hop += DT;
      if (body.y < minY) { minY = body.y; minI = i; }
      if (minI >= 0 && i > minI) rise = Math.max(rise, body.y - y0);
    });
    return { peak, hop, rise, settled: Math.abs(b.y - y0) < 0.01 };
  };
  for (const id of IDS) {
    const lo = land(id, 1), hi = land(id, 10);
    H.assert(hi.peak < lo.peak * 0.8, id + ' peak decel ' + (lo.peak / G).toFixed(0) + 'g → ' + (hi.peak / G).toFixed(0) + 'g');
    H.assert(hi.hop === 0 && hi.rise < 0.01, id + ' upgraded suspension does not bounce back');
    H.assert(lo.hop < 0.05 && lo.rise < 0.06, id + ' even stock suspension barely rebounds (' + (lo.rise * 100).toFixed(1) + ' cm)');
    H.assert(lo.settled && hi.settled, id + ' settles back to ride height');
  }
});

H.test('reverse: brake at a standstill reverses, with capped reverse speed', () => {
  const flat = Terr.flat();
  const { b, t } = makeBody('trail_buggy');
  b.placeOnTerrain(flat, 0);
  sim(b, flat, 4, { throttle: -1 });
  H.assert(b.vx < -3, 'reversing ' + b.vx.toFixed(2));
  H.assert(-b.vx <= t.motor.reverseMaxOmega * t.wheels[0].radius * 1.05, 'reverse speed cap');
  sim(b, flat, 0.9, { throttle: 1 });
  H.assert(b.vx > -0.5, 'gas (with brake assist) quickly stops the reverse motion: ' + b.vx.toFixed(2));
});

H.test('surfaces: ice is slippery, TIRES upgrade helps on snow, lava sets hazard', () => {
  const ice = new MockTerrain((x) => (x < 0 ? 0 : x * Math.tan(12 * DEG)), { surface: RR.SURFACES.ice });
  const grass = new MockTerrain((x) => (x < 0 ? 0 : x * Math.tan(12 * DEG)));
  const go = (terr, up) => { const { b } = makeBody('trail_buggy', up); b.placeOnTerrain(terr, 5); sim(b, terr, 5, { throttle: 1 }); return b.x; };
  H.assert(go(ice) < go(grass) * 0.8, 'ice slower than grass on a 12° climb');
  const snow = new MockTerrain((x) => (x < 0 ? 0 : x * Math.tan(20 * DEG)), { surface: RR.SURFACES.snow });
  H.assert(go(snow, { tires: 10 }) > go(snow) + 2, 'tyres help on snow');
  const lava = new MockTerrain(() => 0, { surfaceFn: (x) => (x > 8 ? RR.SURFACES.lava : RR.SURFACES.ash) });
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(lava, 0);
  H.assert(!b.hazard, 'no hazard yet');
  sim(b, lava, 6, { throttle: 1 }, null, (body) => !!body.hazard);
  H.assert(b.hazard === 'lava', 'lava hazard');
  // frictionMul (daily ice challenge) reduces grip
  const lowMu = makeBody('trail_buggy').b;
  lowMu.placeOnTerrain(grass, 5);
  sim(lowMu, grass, 5, { throttle: 1 }, { frictionMul: 0.3 });
  H.assert(lowMu.x < go(grass) * 0.85, 'frictionMul reduces climbing');
});

H.test('boost thrust ≈ 0.9 g along the chassis; wind pushes; gravity env respected', () => {
  const { b } = makeBody('storm_runner');
  b.setPose(0, 500, 0);
  sim(b, Terr.flat(), 1, { boost: 1 }, { gravity: 0 });
  H.assertClose(b.vx, 0.9 * G * 0.99, 0.35, 'boost accel');
  const w = makeBody('trail_buggy').b;
  w.setPose(0, 500, 0);
  sim(w, Terr.flat(), 1, {}, { gravity: 0, wind: 5 });
  H.assert(w.vx > 4.5 && w.vx < 5.1, 'wind accel ' + w.vx);
  const m = makeBody('trail_buggy').b;
  m.setPose(0, 500, 0);
  sim(m, Terr.flat(), 1, {}, { gravity: 9.81 * 0.42 });
  H.assertClose(m.vy, -9.81 * 0.42, 0.15, 'moon gravity');
});

H.test('engineOn=false: no drive, coasting, brakes still work', () => {
  const flat = Terr.flat();
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(flat, 0);
  sim(b, flat, 2, { throttle: 1, engineOn: false });
  H.assert(speed(b) < 0.05, 'no drive without engine');
  b.setVelocity(10, 0);
  sim(b, flat, 2, { throttle: 0, engineOn: false });
  H.assert(b.vx > 8, 'coasts ' + b.vx.toFixed(2));
  sim(b, flat, 3, { throttle: -1, engineOn: false });
  H.assert(speed(b) < 0.1, 'brakes without engine');
  H.assert(b.vx > -0.1, 'no reverse without engine');
});

H.test('NaN guard: poisoned state and inputs are recovered; step never throws', () => {
  const flat = Terr.flat();
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(flat, 0);
  sim(b, flat, 0.5, {});
  const good = { x: b.x, y: b.y };
  b.vx = NaN;
  b.step(DT, { throttle: 1 }, envFor(flat));
  H.assert(allFinite(b) && b.nanRecoveries === 1, 'recovered');
  H.assert(Math.hypot(b.x - good.x, b.y - good.y) < 0.05, 'restored near last good state');
  for (const bad of [null, undefined, {}, { throttle: NaN, lean: Infinity, boost: -5 }, { throttle: 'x' }]) b.step(DT, bad, envFor(flat));
  for (const env of [null, {}, { terrain: null }, { terrain: {} }, { terrain: flat, gravity: NaN, wind: Infinity, frictionMul: -1 }]) b.step(DT, {}, env);
  b.step(NaN, {}, envFor(flat)); b.step(-1, {}, envFor(flat)); b.step(10, {}, envFor(flat));
  H.assert(allFinite(b), 'finite after junk');
  // terrain returning NaN heights
  const broken = new MockTerrain((x) => (x > 3 ? NaN : 0));
  const c = makeBody('trail_buggy').b;
  c.placeOnTerrain(broken, 0);
  sim(c, broken, 3, { throttle: 1 });
  H.assert(allFinite(c), 'finite on broken terrain');
  // applyImpulse / helpers
  c.applyImpulse(NaN, 1, 0, 0);
  c.applyImpulse(1e9, 0, c.x, c.y + 1);
  H.assert(allFinite(c) && speed(c) <= 60 && Math.abs(c.av) <= RR.CONST.MAX_ANGULAR, 'impulse clamped');
  H.assert(Number.isFinite(c.speedKmh()), 'speedKmh');
});

H.test('rescue(): upright, above ground, keeps ~60% forward speed, avoids lava', () => {
  const terr = Terr.slope(20, 0, 300);
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(terr, 30);
  b.setVelocity(10 * Math.cos(20 * DEG), 10 * Math.sin(20 * DEG));
  b.angle = Math.PI; b.av = 5; b.headHit = true; b.hazard = 'lava';
  b.rescue(terr);
  H.assertClose(b.angle, 20 * DEG, 0.03, 'upright on slope');
  H.assertClose(speed(b), 6, 0.3, 'kept 60%');
  H.assert(b.av === 0 && !b.headHit && !b.hazard, 'cleared');
  H.assert(penetration(b, terr).hull < -0.1, 'lifted clear');
  sim(b, terr, 1, {});
  H.assert(allFinite(b) && !b.headHit, 'drives on');
  // lava pool: rescue relocates to safe ground
  const lava = new MockTerrain(() => 0, { surfaceFn: (x) => (x > 10 && x < 20 ? RR.SURFACES.lava : RR.SURFACES.ash) });
  const c = makeBody('trail_buggy').b;
  c.setPose(15, 0.8, 0);
  c.rescue(lava);
  H.assert(c.x >= 20 + 1.4 || c.x <= 10 - 1.4, 'moved off lava: x=' + c.x.toFixed(2));
  // cave ceiling respected
  const cave = Terr.cave(3.2);
  const d = makeBody('mountain_truck').b;
  d.setPose(5, 1.5, 0);
  d.rescue(cave);
  const hd = d.getHead();
  H.assert(hd.y + hd.r < 3.2, 'below ceiling');
});

H.test('touchdown events: lastImpact updates on landing only', () => {
  const flat = Terr.flat();
  const { b } = makeBody('rally_beast');
  b.placeOnTerrain(flat, 0);
  sim(b, flat, 1, { throttle: 1 });
  H.assert(b.lastImpact.count === 0, 'driving is not a touchdown');
  b.setPose(b.x, 4, 0);
  sim(b, flat, 2, {});
  H.assert(b.lastImpact.count === 1 && b.lastImpact.speed > 5, 'landing recorded ' + JSON.stringify(b.lastImpact));
  H.assert(b.lastImpact.time > 0 && b.lastImpact.time <= b.time, 'time on body clock');
  H.assert(b.airTime === 0 && b.grounded, 'grounded after landing');
});

H.test('public helpers: worldPoint/getHead/getMount/speedKmh/placeOnTerrain on slopes', () => {
  const { b, t } = makeBody('trail_buggy');
  b.setPose(10, 5, Math.PI / 2);
  const p = b.worldPoint(1, 0);
  H.assertClose(p.x, 10, 1e-9); H.assertClose(p.y, 6, 1e-9);
  const hd = b.getHead();
  H.assertClose(hd.r, t.chassis.head.r, 1e-9);
  H.assertClose(hd.x, 10 - t.chassis.head.y, 1e-9);
  const m = b.getMount(1);
  H.assertClose(m.y, 5 + t.wheels[1].mount.x, 1e-9);
  b.setVelocity(10, 0);
  H.assertClose(b.speedKmh(), 36, 1e-6);
  for (const deg of [-30, -10, 0, 20, 35]) {
    const terr = new MockTerrain((x) => x * Math.tan(deg * DEG));
    const c = makeBody('mountain_truck').b;
    c.placeOnTerrain(terr, 7);
    H.assertClose(c.angle, deg * DEG, 0.01, 'angle follows slope ' + deg);
    const pen = penetration(c, terr);
    H.assert(pen.hull < 0, 'placed hull above ground');
    for (const w of c.wheels) {
      const gap = (w.y - terr.heightAt(w.x)) * Math.cos(deg * DEG) - w.radius;
      H.assert(gap > -0.005 && gap < 0.02, 'wheel touching ground ' + gap.toFixed(4));
    }
  }
});

H.test('concave corners: wheel at the foot of a steep wall does not sink or jitter', () => {
  const terr = Terr.wall(70, 20);
  const { b } = makeBody('trail_buggy');
  b.placeOnTerrain(terr, 17);
  let worst = -Infinity;
  sim(b, terr, 6, { throttle: 1 }, null, (body) => { worst = Math.max(worst, penetration(body, terr).wheel); });
  H.assert(worst < -0.25, 'wheel stays out of the corner ' + worst.toFixed(3));
  const x0 = b.x;
  let maxV = 0;
  sim(b, terr, 1, { handbrake: true }, null, (body) => { maxV = Math.max(maxV, Math.abs(body.vx)); });
  H.assert(Math.abs(b.x - x0) < 0.3, 'stable against the wall');
});

// ================================================================== camera
H.test('camera: base zoom, frame-rate independence, look-ahead, zoom-out, containment', () => {
  const C = RR.Camera;
  const cam = new C();
  cam.setViewport(1280, 720);
  H.assertClose(cam.baseZoom, Math.min(720 / 15, 1280 / 24), 1e-9, 'base zoom');
  // drive the same trajectory at 30 and 144 FPS
  const traj = (t) => ({ x: 20 * t + 2 * Math.sin(t), y: 3 * Math.sin(t * 0.7) + 0.03 * Math.sin(t * 40), vx: 20 + 2 * Math.cos(t), vy: 2.1 * Math.cos(t * 0.7), airTime: t > 3 && t < 4.5 ? t - 3 : 0 });
  const runAt = (fps) => {
    const c = new C(); c.setViewport(1280, 720); c.reset(0, 0);
    const dt = 1 / fps; let t = 0;
    while (t < 6 - 1e-9) { t += dt; c.update(dt, traj(t), {}); }
    return c;
  };
  const a = runAt(30), b = runAt(144);
  H.assert(Math.abs(a.x - b.x) < 0.15 && Math.abs(a.y - b.y) < 0.15 && Math.abs(a.zoom - b.zoom) < 0.5, 'frame-rate independent: ' +
    [a.x - b.x, a.y - b.y, a.zoom - b.zoom].map((v) => v.toFixed(3)).join(', '));
  // look-ahead: moving right fast → camera ahead of the car, zoomed out
  const c = new C(); c.setViewport(1280, 720); c.reset(0, 0);
  let x = 0;
  for (let i = 0; i < 600; i++) { x += 30 / 60; c.update(1 / 60, { x, y: 0, vx: 30, vy: 0, airTime: 0 }, {}); }
  H.assert(c.x - x > 3 && c.x - x < 0.3 * c.viewW / c.zoom, 'look-ahead ' + (c.x - x).toFixed(2));
  H.assert(c.zoom < c.baseZoom * 0.9 && c.zoom >= c.baseZoom * (1 - 0.18) - 1e-6, 'speed zoom-out ' + (c.zoom / c.baseZoom).toFixed(3));
  // big air zooms out further, but never more than 25 %
  for (let i = 0; i < 240; i++) { x += 30 / 60; c.update(1 / 60, { x, y: 10, vx: 30, vy: 0, airTime: 2 + i / 60, heightAboveGround: 12 }, {}); }
  H.assert(c.zoom >= c.baseZoom * 0.75 - 1e-6 && c.zoom < c.baseZoom * 0.8, 'air zoom ' + (c.zoom / c.baseZoom).toFixed(3));
  // suspension micro-bounce (±3 cm @ 3 Hz) barely moves the camera
  const s = new C(); s.setViewport(1280, 720); s.reset(0, 0);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 600; i++) {
    const t = i / 60, y = 0.03 * Math.sin(2 * Math.PI * 3 * t), vy = 0.03 * 2 * Math.PI * 3 * Math.cos(2 * Math.PI * 3 * t);
    s.update(1 / 60, { x: 0, y, vx: 0, vy, airTime: 0 }, {});
    if (t > 3) { lo = Math.min(lo, s.y); hi = Math.max(hi, s.y); }
  }
  H.assert(hi - lo < 0.012, 'micro-bounce filtered: ' + (hi - lo).toFixed(4) + ' m');
  // containment: a teleporting target stays on screen
  const k = new C(); k.setViewport(800, 600); k.reset(0, 0);
  k.update(1 / 60, { x: 100, y: -50, vx: 0, vy: 0 }, {});
  const sc = k.worldToScreen(100, -50);
  H.assert(sc.x > 0 && sc.x < 800 && sc.y > 0 && sc.y < 600, 'target kept on screen ' + sc.x.toFixed(0) + ',' + sc.y.toFixed(0));
  // falling fast: car stays in frame and the camera looks below it
  const f = new C(); f.setViewport(1280, 720); f.reset(0, 0);
  let y = 0;
  for (let i = 0; i < 120; i++) { y -= 20 / 60; f.update(1 / 60, { x: 0, y, vx: 0, vy: -20, airTime: i / 60 }, {}); }
  const fs2 = f.worldToScreen(0, y);
  H.assert(fs2.y > 0 && fs2.y < 720 && f.y < y + 1, 'fall: on screen, looking ahead ' + (f.y - y).toFixed(2));
  H.assert([a, b, c, s, k, f].every((q) => Number.isFinite(q.x + q.y + q.zoom)), 'finite');
  // hard landing (19 m/s): the camera shows the ground coming, then settles with only a short dip
  const l = new C(); l.setViewport(1280, 720); l.reset(0, 20);
  let ly = 20, lvy = 0, landT = null, worstDip = 0, settledBy = null;
  const rest = 0.06 * l.viewH / l.baseZoom;
  for (let i = 0; i < 240; i++) {
    const t = i / 60;
    if (ly > 0) { lvy -= G / 60; ly += lvy / 60; if (ly <= 0) { ly = 0; lvy = 0; landT = t; } }
    l.update(1 / 60, { x: 0, y: ly, vx: 0, vy: lvy, airTime: ly > 0 ? t : 0, heightAboveGround: ly }, {});
    const off = l.y - ly;
    if (landT === null && ly < 3) H.assert(off < rest, 'looking down before touchdown');
    if (landT !== null) {
      worstDip = Math.min(worstDip, off);
      if (settledBy === null && t - landT > 0.1 && Math.abs(off - rest) < 0.5) settledBy = t - landT;
    }
  }
  H.assert(worstDip > -1.2, 'landing dip ' + worstDip.toFixed(2) + ' m');
  H.assert(settledBy !== null && settledBy < 0.8, 'settles quickly after landing: ' + settledBy);
});

H.test('camera: shake decays, respects reducedMotion; transforms round-trip; bounds', () => {
  const cam = new RR.Camera();
  cam.setViewport(1000, 500);
  cam.reset(5, 2);
  cam.shake(0.5, 0.4);
  let maxS = 0;
  for (let i = 0; i < 12; i++) { cam.update(1 / 60, { x: 5, y: 2, vx: 0, vy: 0 }, {}); maxS = Math.max(maxS, Math.hypot(cam.shakeX, cam.shakeY)); }
  H.assert(maxS > 0.05 && maxS <= 0.5 * 1.5, 'shakes ' + maxS);
  for (let i = 0; i < 30; i++) cam.update(1 / 60, { x: 5, y: 2, vx: 0, vy: 0 }, {});
  H.assert(cam.shakeX === 0 && cam.shakeY === 0, 'decayed to zero');
  const rm = new RR.Camera(); rm.setViewport(1000, 500); rm.reset(0, 0); rm.shake(0.5, 0.4);
  let maxR = 0;
  for (let i = 0; i < 12; i++) { rm.update(1 / 60, { x: 0, y: 0, vx: 0, vy: 0 }, { reducedMotion: true }); maxR = Math.max(maxR, Math.hypot(rm.shakeX, rm.shakeY)); }
  H.assert(maxR < maxS * 0.3, 'reduced motion shake ' + maxR.toFixed(3));
  cam.shake(NaN, 1); cam.shake(-1, 1); cam.shake(100, 100);
  cam.update(1 / 60, { x: 5, y: 2 }, {});
  H.assert(Math.hypot(cam.shakeX, cam.shakeY) <= 2.5 * 1.5, 'shake clamped');
  const w = cam.screenToWorld(123, 456);
  const s = cam.worldToScreen(w.x, w.y);
  H.assertClose(s.x, 123, 1e-9); H.assertClose(s.y, 456, 1e-9);
  const c = cam.worldToScreen(cam.cx, cam.cy);
  H.assertClose(c.x, 500, 1e-9); H.assertClose(c.y, 250, 1e-9);
  const up = cam.worldToScreen(cam.cx, cam.cy + 1);
  H.assert(up.y < 250, 'y-up world → screen y down');
  const bb = cam.bounds();
  H.assertClose(bb.right - bb.left, 1000 / cam.zoom, 1e-9);
  H.assertClose(bb.top - bb.bottom, 500 / cam.zoom, 1e-9);
  H.assert(bb.left < cam.cx && bb.right > cam.cx && bb.bottom < cam.cy && bb.top > cam.cy, 'bounds centred');
  cam.update(NaN, null, null); cam.update(1 / 60, { x: NaN, y: undefined }, undefined);
  cam.setViewport(0, -5);
  H.assert(Number.isFinite(cam.x + cam.y + cam.zoom) && cam.zoom > 0, 'robust to junk');
});

// ================================================================== performance
H.test('performance: one 120 Hz step is cheap', () => {
  const terr = Terr.bumpy();
  const { b } = makeBody('rally_beast', MAXED);
  b.placeOnTerrain(terr, 5);
  const env = envFor(terr);
  for (let i = 0; i < 2000; i++) b.step(DT, { throttle: 1 }, env);
  const N = 12000;
  let sumV = 0, ns = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    b.step(DT, { throttle: 1, lean: b.angle > 0.5 ? -1 : b.angle < -0.5 ? 1 : 0 }, env);
    if (b.headHit) b.rescue(terr);
    sumV += speed(b); ns++;
  }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
  console.log('      ' + us.toFixed(1) + ' µs per 1/120 s step (mean speed ' + (sumV / ns).toFixed(1) + ' m/s, bumpy hills)');
  H.assert(us < 200, 'step cost ' + us.toFixed(1) + ' µs');
});

// ================================================================== real terrain
const terrainFile = path.join(H.ROOT, 'js/game/terrain.js');
if (fs.existsSync(terrainFile)) {
  H.test('real RR.Terrain: every world, maxed & stock cars drive 60 s with no NaN or tunnelling', () => {
    try { H.load(['js/game/terrain.js'], RR.__ctx); } catch (e) { throw new Error('terrain.js failed to load: ' + e.message); }
    H.assert(typeof RR.Terrain === 'function', 'RR.Terrain present');
    const rows = [];
    for (const world of RR.Worlds.list) {
      for (const [id, up] of [['trail_buggy', {}], ['storm_runner', MAXED], ['rock_crawler', { grip: 6, engine: 6 }]]) {
        const terrain = new RR.Terrain({ seed: RR.Util.hashString(world.id + id), world, modifiers: null });
        terrain.ensure(400);
        const { b } = makeBody(id, up);
        b.placeOnTerrain(terrain, 5);
        const env = envFor(terrain, { gravity: G * world.gravity, airDrag: world.airDrag });
        let crashes = 0, lava = 0, worst = -Infinity, maxX = 0;
        const steps = Math.round(60 / DT);
        for (let i = 0; i < steps; i++) {
          if (i % 120 === 0) { terrain.ensure(b.x + 300); terrain.trim(b.x - 250); }
          // simple autopilot: full gas; in the air keep the chassis parallel to the ground below
          let lean = 0;
          if (!b.grounded) {
            const target = Math.atan(terrain.slopeAt(b.x + b.vx * 0.3));
            const err = RR.Util.wrapAngle(b.angle - target);
            lean = RR.Util.clamp(-err * 2 - b.av * 0.4, -1, 1);
          } else {
            const err = RR.Util.wrapAngle(b.angle - Math.atan(terrain.slopeAt(b.x)));
            lean = err > 0.35 ? -1 : 0;
          }
          b.step(DT, { throttle: 1, lean }, env);
          if (!allFinite(b)) throw new Error(world.id + ' ' + id + ' non-finite');
          const p = penetration(b, terrain);
          worst = Math.max(worst, p.wheel, p.com);
          if (p.wheel >= 0 || p.com >= 0) throw new Error(world.id + ' ' + id + ' below terrain at x=' + b.x.toFixed(1) + ' (' + p.wheel.toFixed(3) + ')');
          if (b.headHit || b.hazard) { if (b.headHit) crashes++; else lava++; b.rescue(terrain); }
          maxX = Math.max(maxX, b.x);
        }
        H.assert(b.nanRecoveries === 0, 'no NaN recoveries');
        rows.push(world.id.padEnd(15) + ' ' + id.padEnd(13) + ' ' + (maxX.toFixed(0) + ' m').padStart(7) + '  crashes ' + crashes + '  lava ' + lava + '  min wheel-centre height ' + (-worst).toFixed(2) + ' m');
      }
    }
    console.log('      real terrain, 60 s full throttle with a naive autopilot:\n        ' + rows.join('\n        '));
  });
}

const ok = H.done();

// ------------------------------------------------------------------ report
if (speedTable.length) {
  console.log('\nTop speed / 0→15 m/s on flat grass (stock → fully upgraded):');
  console.log('  vehicle          top m/s (km/h)        0→15 s        design top');
  for (const r of speedTable) {
    console.log('  ' + r.id.padEnd(15) + '  ' + fmt(r.s.top, 1).padStart(5) + ' → ' + fmt(r.m.top, 1).padStart(5) +
      ' (' + String(Math.round(r.s.top * 3.6)).padStart(3) + '→' + String(Math.round(r.m.top * 3.6)).padStart(3) + ')' +
      '   ' + fmt(r.s.t15).padStart(5) + ' → ' + fmt(r.m.t15).padStart(5) + '    ' + r.s.design.toFixed(1) + ' → ' + r.m.design.toFixed(1));
  }
}
if (!ok) process.exitCode = 1;
