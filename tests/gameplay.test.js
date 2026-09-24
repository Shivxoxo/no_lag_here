/* RIDGE RUSH — gameplay tests: RR.Run, RR.Collectibles, RR.PowerUps, RR.Tricks.
 *
 *  - Every world: a 90 s headless run (60 fps) with a scripted driver on RR.Input.getControls (full throttle,
 *    wheelie guard, in-air levelling lean): no exceptions, no NaN, distance / coins / fuel sanity, onEnd once.
 *  - A daily run for every RR.Daily challenge type (each modifier), plus modifier normalisation.
 *  - Attract mode (self-restart, never touches HUD / audio / missions), shield rescue, slow time, Ion Thruster,
 *    boost, out-of-fuel flow, records, missions tracking, summary shape, destroy/quit, rendering.
 *  - Tricks with a scripted fake body (flips, double/triple, perfect landing, long air, exploits, crash cancel,
 *    wheelie, combo rules) and collectibles placement / pickups.
 *
 *   node tests/gameplay.test.js            (GAMEPLAY_SECONDS=30 for a quicker pass)
 */
'use strict';
const H = require('./harness');

const SHELL = ['js/core/input.js', 'js/ui/hud.js', 'js/ui/screens.js', 'game.js'];
let RR;
try {
  RR = H.loadAll({ quiet: true });
  if (!RR.Run) throw new Error('RR.Run missing');
} catch (e) {
  console.log('[gameplay] full load failed (' + (e && e.message) + ') — retrying without shell files');
  RR = H.loadAll({ skip: SHELL, quiet: true });
}
const U = RR.Util;
const SECONDS = Math.max(10, +process.env.GAMEPLAY_SECONDS || 90);
const FPS = 60, DT = 1 / FPS;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ spies & stubs (installed in the sandbox)
const consoleErrors = [];
RR.__ctx.console = Object.assign({}, console, { error: (...a) => { consoleErrors.push(a.map(String).join(' ')); } });
if (RR.Save && RR.Save.load) RR.Save.load();

const hudLog = [];
RR.HUD = {
  update() {}, show() {}, reset() {}, init() {},
  popTrick: (...a) => hudLog.push(['popTrick', ...a]),
  banner: (...a) => hudLog.push(['banner', ...a]),
  toast: (...a) => hudLog.push(['toast', ...a]),
  warning: (...a) => hudLog.push(['warning', ...a]),
  flash: (...a) => hudLog.push(['flash', ...a])
};
const audioLog = [];
RR.Audio = {
  play: (n, o) => { audioLog.push(n); return true; },
  engineStart: (s) => audioLog.push('engineStart:' + s),
  engineUpdate: () => { audioLog.engineUpdates = (audioLog.engineUpdates || 0) + 1; },
  engineStop: () => audioLog.push('engineStop'),
  music: () => {}, duck() {}, init() {}, setSound() {}, setMusic() {}
};
const missionLog = [];
const realMissions = RR.Missions;
RR.Missions = Object.assign({}, realMissions, {
  track(stat, value, ctx) {
    missionLog.push({ stat, value, ctx: ctx ? Object.assign({}, ctx) : null });
    return realMissions.track(stat, value, ctx);
  }
});
let controls = { throttle: 0, lean: 0, handbrake: false };
const inputListeners = {};
RR.Input = {
  getControls: () => controls,
  on(evt, fn) { (inputListeners[evt] || (inputListeners[evt] = [])).push(fn); return () => {}; },
  reset() {}, init() {}
};
const RENDERER = { w: 1280, h: 720, drawRun() { this.frames = (this.frames || 0) + 1; } };
function clearLogs() { hudLog.length = 0; audioLog.length = 0; missionLog.length = 0; audioLog.engineUpdates = 0; }

// Scripted driver: full throttle with a wheelie guard, level to the landing slope in the air.
function drive(run) {
  const b = run.body, T = run.terrain;
  const rel = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x)));
  let thr = 1, lean = 0;
  if (b.grounded || b.bodyContact) {
    if (rel > 0.35) lean = -1;
    if (rel > 0.55) thr = 0.3;
  } else {
    const err = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x + b.vx * 0.4)));
    lean = U.clamp(-err * 2 - b.av * 0.4, -1, 1);
    thr = 0;
  }
  controls.throttle = thr;
  controls.lean = lean;
  controls.handbrake = false;
}

function newRun(o) {
  const ends = [];
  const run = new RR.Run(Object.assign({ worldId: 'green_valley', vehicleId: 'trail_buggy', mode: 'normal', daily: null,
    seed: 31337, renderer: RENDERER, onEnd: (s) => ends.push(s) }, o || {}));
  run.__ends = ends;
  return run;
}
function frames(run, seconds, fn) {
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i++) { if (fn) fn(run, i); run.update(DT); }
}
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
function assertRunFinite(run, where) {
  const b = run.body;
  for (const k of ['x', 'y', 'angle', 'vx', 'vy', 'av']) H.assert(fin(b[k]), where + ': body.' + k + ' = ' + b[k]);
  for (const k of ['fuel', 'distance', 'coins', 'bonusCoins', 'trickXp', 'time']) H.assert(fin(run[k]), where + ': run.' + k + ' = ' + run[k]);
  H.assert(run.fuel >= 0 && run.fuel <= run.fuelMax + 1e-9, where + ': fuel out of range ' + run.fuel);
}
function assertSummary(s, where) {
  H.assert(s && typeof s === 'object', where + ': summary missing');
  for (const k of ['worldId', 'vehicleId', 'mode', 'endReason']) H.assert(typeof s[k] === 'string' && s[k], where + ': summary.' + k);
  for (const k of ['distance', 'coins', 'bonusCoins', 'tokens', 'trickXp', 'bossXp', 'perfectLandings', 'fuelCollected',
    'powerups', 'airTime', 'longestAir', 'maxCombo', 'bossCleared', 'time']) {
    H.assert(fin(s[k]) && s[k] >= 0, where + ': summary.' + k + ' = ' + s[k]);
  }
  for (const k of ['backflip', 'frontflip', 'doubleFlip', 'tripleFlip', 'perfect', 'longAir', 'wheelie']) {
    H.assert(fin(s.tricks[k]), where + ': summary.tricks.' + k);
  }
  H.assert(['crash', 'fuel', 'quit'].indexOf(s.endReason) >= 0, where + ': endReason ' + s.endReason);
  H.assert(Array.isArray(s.missionsCompleted), where + ': missionsCompleted');
  H.assert(RR.Progression.computeRunRewards(s).xp.total >= 0, where + ': progression accepts the summary');
}

// ================================================================== RR.PowerUps
console.log('\nRR.PowerUps');
H.test('types match the contract', () => {
  const T = RR.PowerUps.TYPES;
  const want = { magnet: ['MAGNET', 10], shield: ['SHIELD', 45], boost: ['BOOST', 4], fuelboost: ['FUEL BOOST', 0],
    multiplier: ['2X COINS', 12], slowtime: ['SLOW TIME', 6] };
  for (const id of Object.keys(want)) {
    H.assert(T[id] && T[id].name === want[id][0] && T[id].duration === want[id][1], id);
    H.assert(/^#[0-9a-f]{6}$/i.test(T[id].color), id + ' color');
  }
  H.assert(T.shield.weight < Math.min(T.magnet.weight, T.boost.weight, T.multiplier.weight), 'shield is the rarest');
});
H.test('activate / remaining / fraction / refresh / expiry (real-time timers)', () => {
  const pu = new RR.PowerUps({});
  const expired = [];
  pu.onExpire = (t) => expired.push(t);
  H.assert(!pu.isActive('magnet') && pu.remaining('magnet') === 0 && pu.fraction('magnet') === 0, 'idle');
  H.assert(pu.activate('magnet') && pu.isActive('magnet'), 'active');
  pu.update(4);   // clamped to 0.25 per call
  H.assertClose(pu.remaining('magnet'), 9.75, 1e-9, 'dt clamp');
  for (let i = 0; i < 20; i++) pu.update(0.25);
  H.assertClose(pu.remaining('magnet'), 4.75, 1e-9);
  H.assertClose(pu.fraction('magnet'), 0.475, 1e-9);
  pu.activate('magnet');
  H.assertClose(pu.remaining('magnet'), 10, 1e-9, 're-activation refreshes to full');
  for (let i = 0; i < 50; i++) pu.update(0.25);
  H.assert(!pu.isActive('magnet') && expired.join() === 'magnet', 'expired once');
  H.assert(!pu.activate('nope') && pu.activate('fuelboost') && !pu.isActive('fuelboost'), 'fuelboost is instant');
  pu.update(NaN); pu.update(-1);
  H.assert(pu.activations === 3, 'activations counted');
});
H.test('shield absorbs exactly one crash; list() is reused and ordered', () => {
  const pu = new RR.PowerUps({});
  H.assert(!pu.consumeShield(), 'no shield');
  pu.activate('shield'); pu.activate('slowtime'); pu.activate('boost');
  const l1 = pu.list();
  H.assert(l1.map((e) => e.type).join() === 'shield,boost,slowtime', 'display order ' + l1.map((e) => e.type));
  H.assert(l1[0].duration === 45 && l1[0].fraction === 1 && l1[0].name === 'SHIELD', 'entry fields');
  const l2 = pu.list();
  H.assert(l1 === l2 && l1[0] === l2[0], 'reused array + entries');
  H.assert(pu.consumeShield() && !pu.isActive('shield') && !pu.consumeShield(), 'one use');
  H.assert(pu.list().length === 2 && pu.shieldsUsed === 1, 'list after use');
  pu.clear();
  H.assert(pu.list().length === 0 && !pu.anyActive(), 'clear');
});
H.test('pickType is weighted and honours noFuel', () => {
  const rng = U.makeRng(42), counts = {};
  for (let i = 0; i < 6000; i++) { const t = RR.PowerUps.pickType(rng); counts[t] = (counts[t] || 0) + 1; }
  H.assert(Object.keys(counts).length === 6, 'all types appear');
  H.assert(counts.shield < counts.magnet * 0.7, 'shield rarer ' + JSON.stringify(counts));
  for (let i = 0; i < 2000; i++) H.assert(RR.PowerUps.pickType(rng, { noFuel: true }) !== 'fuelboost', 'noFuel');
});

// ================================================================== RR.Tricks (scripted fake body)
console.log('\nRR.Tricks');
const TDT = 1 / 120;
function trickRig(opts) {
  opts = opts || {};
  const log = [], bonus = [];
  const run = { state: 'running', env: { gravity: 9.81 * (opts.g || 1), gravityMul: 1 },
    onTrick: (t) => log.push(t), addBonus: (c, l) => bonus.push([c, l]) };
  const tr = new RR.Tricks(run);
  const slope = opts.slope || 0;
  const terrain = { heightAt: (x) => x * slope, slopeAt: () => slope };
  const body = { x: 0, y: 0.8, angle: Math.atan(slope), vx: 0, vy: 0, av: 0, grounded: true, bothGrounded: true,
    bodyContact: false, wheels: [{ grounded: true }, { grounded: true }] };
  return { run, tr, terrain, body, log, bonus };
}
function tstep(rig, t) { const n = Math.round(t / TDT); for (let k = 0; k < n; k++) rig.tr.update(TDT, rig.body, rig.terrain); }
function setGround(b, rear, front, hull) {
  b.wheels[0].grounded = rear; b.wheels[1].grounded = front;
  b.grounded = rear || front; b.bothGrounded = rear && front; b.bodyContact = !!hull;
}
// Scripted jump: o {air, rot, vx, peak, landErr, frontDelay, hull, crashAfter}
function jump(rig, o) {
  const b = rig.body;
  setGround(b, true, true, false);
  tstep(rig, 0.2);
  const a0 = b.angle, x0 = b.x, y0 = b.y, vx = o.vx === undefined ? 12 : o.vx, peak = o.peak === undefined ? 2 : o.peak;
  setGround(b, false, false, false);
  const n = Math.round(o.air / TDT);
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    b.x = x0 + vx * o.air * u;
    b.y = y0 + b.x * 0 + 4 * peak * u * (1 - u) + (rig.terrain.heightAt(b.x) - rig.terrain.heightAt(x0));
    b.angle = a0 + (o.rot || 0) * u + (o.landErr || 0) * u;
    b.vx = vx;
    rig.tr.update(TDT, b, rig.terrain);
  }
  setGround(b, true, !(o.frontDelay > 0), o.hull);
  rig.tr.update(TDT, b, rig.terrain);
  if (o.frontDelay > 0) { tstep(rig, o.frontDelay); setGround(b, true, true, o.hull); }
  if (o.crashAfter !== undefined) { tstep(rig, o.crashAfter); rig.run.state = 'crashed'; }
  tstep(rig, 0.6);
  setGround(b, true, true, false);
}
const ids = (rig) => rig.log.map((t) => t.id).join(',');

H.test('backflip (CCW) and frontflip (CW), exact rewards, xp = coins/5', () => {
  let r = trickRig();
  jump(r, { air: 1.2, rot: TAU, peak: 0.6 });
  H.assert(ids(r) === 'backflip', 'got ' + ids(r));
  H.assert(r.log[0].coins === 100 && r.log[0].xp === 20 && r.log[0].combo === 1 && r.log[0].label === 'BACKFLIP', JSON.stringify(r.log[0]));
  H.assert(r.tr.stats.backflip === 1 && r.tr.stats.flips === 1, 'stats');
  r = trickRig();
  jump(r, { air: 1.2, rot: -TAU, peak: 0.6 });
  H.assert(ids(r) === 'frontflip' && r.log[0].coins === 120 && r.log[0].xp === 24, 'frontflip ' + ids(r));
});
H.test('double flip is one DOUBLE FLIP (+300), triple +600, quad +850', () => {
  let r = trickRig();
  jump(r, { air: 1.6, rot: 2 * TAU, peak: 0.6 });
  H.assert(ids(r) === 'doubleFlip' && r.log[0].coins === 300 && r.log[0].flips === 2 && r.log[0].label === 'DOUBLE FLIP', ids(r));
  H.assert(r.tr.stats.doubleFlip === 1 && r.tr.stats.backflip === 0, 'not two singles');
  r = trickRig();
  jump(r, { air: 1.9, rot: -3 * TAU, peak: 0.6 });
  H.assert(ids(r) === 'tripleFlip' && r.log[0].coins === 600 && r.log[0].dir === -1, ids(r));
  r = trickRig();
  jump(r, { air: 1.9, rot: 4 * TAU, peak: 0.6 });
  H.assert(r.log[0].coins === 850 && r.log[0].label === 'QUAD FLIP', JSON.stringify(r.log[0]));
});
H.test('rotation tolerance: 337° counts as a flip, 200° does not', () => {
  let r = trickRig();
  jump(r, { air: 1.2, rot: TAU - 0.4, landErr: 0.4, peak: 0.6 });
  H.assert(ids(r) === 'backflip', '337° ' + ids(r));
  r = trickRig();
  jump(r, { air: 1.2, rot: 3.5, landErr: -3.5, peak: 0.6 });
  H.assert(ids(r) === '', '200° gave ' + ids(r));
});
H.test('stationary spin and short hops are rejected (no exploits)', () => {
  let r = trickRig();
  jump(r, { air: 1.2, rot: TAU, vx: 0, peak: 0.6 });
  H.assert(ids(r) === '', 'stationary spin gave ' + ids(r));
  r = trickRig();
  jump(r, { air: 0.3, rot: TAU, vx: 20, peak: 0.3 });
  H.assert(ids(r) === '', 'short air gave ' + ids(r));
  r = trickRig();
  jump(r, { air: 1.0, rot: TAU, vx: 2, peak: 0.6 });       // 2 m of travel
  H.assert(ids(r) === '', '2 m travel gave ' + ids(r));
});
H.test('perfect landing: both wheels, level, real air, clearance, no hull', () => {
  let r = trickRig();
  jump(r, { air: 1.0, rot: 0, peak: 2 });
  H.assert(ids(r) === 'perfect' && r.log[0].coins === 150 && r.log[0].label === 'PERFECT LANDING', 'perfect ' + ids(r));
  H.assert(r.tr.stats.perfect === 1, 'stat');
  const cases = [
    ['front wheel late', { air: 1.0, peak: 2, frontDelay: 0.3 }],
    ['angle off', { air: 1.0, peak: 2, landErr: 0.35 }],
    ['hull contact', { air: 1.0, peak: 2, hull: true }],
    ['too short', { air: 0.5, peak: 2 }],
    ['crest skim (low clearance)', { air: 1.0, peak: 0.6 }]
  ];
  for (const [name, o] of cases) { r = trickRig(); jump(r, o); H.assert(ids(r) === '', name + ' gave ' + ids(r)); }
  r = trickRig({ slope: -0.3 });
  jump(r, { air: 1.1, peak: 2.2 });
  H.assert(ids(r) === 'perfect', 'on a downslope ' + ids(r));
  r = trickRig();
  jump(r, { air: 1.4, rot: TAU, peak: 2.5 });
  H.assert(ids(r) === 'backflip,perfect', 'flip + perfect ' + ids(r));
  H.assert(r.log[1].combo === 2 && r.log[1].coins === 188, 'second trick in the combo is x1.25: ' + r.log[1].coins);
});
H.test('long air threshold scales with gravity', () => {
  let r = trickRig();
  jump(r, { air: 2.2, peak: 0.6 });
  H.assert(ids(r) === 'longAir' && r.log[0].coins === 200, 'long air ' + ids(r));
  r = trickRig({ g: 0.42 });
  jump(r, { air: 2.2, peak: 0.6 });
  H.assert(ids(r) === '', 'moon 2.2 s is not long ' + ids(r));
  r = trickRig({ g: 0.42 });
  jump(r, { air: 3.3, peak: 0.6 });
  H.assert(ids(r) === 'longAir', 'moon 3.3 s ' + ids(r));
  H.assert(r.tr.stats.longestAir > 3.2 && r.tr.stats.airTime > 3.2, 'air stats');
});
H.test('a crash right after landing cancels the award', () => {
  const r = trickRig();
  jump(r, { air: 1.6, rot: 2 * TAU, peak: 2, crashAfter: 0.15 });
  H.assert(ids(r) === '' && r.tr.stats.doubleFlip === 0, 'crash cancelled ' + ids(r));
  const r2 = trickRig();
  jump(r2, { air: 1.2, rot: TAU, peak: 0.6, frontDelay: 0.05 });
  r2.tr.resetCombo();
  H.assert(r2.tr.combo.count === 0 && r2.tr.combo.multiplier === 1, 'resetCombo');
});
H.test('landing upside down is never a trick', () => {
  const r = trickRig();
  jump(r, { air: 1.4, rot: TAU + Math.PI, peak: 2 });
  H.assert(ids(r) === '', 'upside down gave ' + ids(r));
});
H.test('wheelie: ≥ 1.2 s and ≥ 8 m, paid at the end (+50 + 2/m)', () => {
  const r = trickRig();
  const b = r.body;
  setGround(b, true, false, false);
  b.vx = 5;
  for (let k = 0; k < 240; k++) { b.x += 5 * TDT; r.tr.update(TDT, b, r.terrain); }
  H.assert(r.tr.live.wheelie && r.tr.live.wheelieDist > 9, 'live wheelie read-out');
  H.assert(ids(r) === '', 'not paid while still up');
  setGround(b, true, true, false);
  tstep(r, 0.6);
  const wm = r.log[0] && r.log[0].meters;
  H.assert(ids(r) === 'wheelie' && Math.abs(wm - 10) < 0.2 && r.log[0].coins === 50 + 2 * Math.floor(wm) &&
    r.log[0].label === 'WHEELIE ' + Math.floor(wm) + ' M', JSON.stringify(r.log[0]));
  // too short, and hull contact
  const r2 = trickRig();
  setGround(r2.body, true, false, false); r2.body.vx = 5;
  for (let k = 0; k < 110; k++) { r2.body.x += 5 * TDT; r2.tr.update(TDT, r2.body, r2.terrain); }
  setGround(r2.body, true, true, false); tstep(r2, 0.6);
  H.assert(ids(r2) === '', 'short wheelie gave ' + ids(r2));
  const r3 = trickRig();
  setGround(r3.body, true, false, true); r3.body.vx = 5;
  for (let k = 0; k < 300; k++) { r3.body.x += 5 * TDT; r3.tr.update(TDT, r3.body, r3.terrain); }
  setGround(r3.body, true, true, false); tstep(r3, 0.6);
  H.assert(ids(r3) === '', 'tail-drag gave ' + ids(r3));
  // crash while the award is pending
  const r4 = trickRig();
  setGround(r4.body, true, false, false); r4.body.vx = 5;
  for (let k = 0; k < 240; k++) { r4.body.x += 5 * TDT; r4.tr.update(TDT, r4.body, r4.terrain); }
  setGround(r4.body, true, true, false); tstep(r4, 0.2); r4.run.state = 'crashed'; tstep(r4, 0.5);
  H.assert(ids(r4) === '', 'crashed wheelie gave ' + ids(r4));
});
H.test('combo: multiplier, coin throttle, coins never extend, expiry bonus, max', () => {
  const r = trickRig();
  const c = r.tr.combo;
  H.assert(r.tr.addComboAction('coin') && !r.tr.addComboAction('coin'), 'coin throttled');
  H.assert(c.count === 1 && c.timer === RR.CONST.COMBO_TIMEOUT, 'coin starts a combo');
  tstep(r, 1.0);
  r.tr.addComboAction('fuel');
  H.assert(c.count === 2 && c.multiplier === 1.25 && Math.abs(c.timer - RR.CONST.COMBO_TIMEOUT) < 1e-9, 'fuel refreshes');
  tstep(r, 1.6);
  const before = c.timer;
  r.tr.addComboAction('coin');
  H.assert(c.count === 3 && c.timer === before && c.multiplier === 1.5, 'coin does not extend the timer');
  tstep(r, 4.1);
  H.assert(c.count === 0 && r.bonus.length === 0, 'no bonus without a trick in the chain');
  // a real chain: coin + trick + perfect → COMBO x3 bonus of 45 on expiry
  r.tr.addComboAction('coin');
  jump(r, { air: 1.4, rot: TAU, peak: 2.5 });
  H.assert(c.count === 3 && c.max >= 3, 'coin + flip + perfect = x3 (' + c.count + ')');
  H.assert(r.log[r.log.length - 1].coins === 225, 'perfect at x1.5 = 225: ' + r.log[r.log.length - 1].coins);
  tstep(r, 4.2);
  H.assert(r.bonus.length === 1 && r.bonus[0][0] === 45 && r.bonus[0][1] === 'COMBO x3', JSON.stringify(r.bonus));
  for (let i = 0; i < 30; i++) r.tr.addComboAction('powerup');
  H.assert(c.multiplier === 3, 'multiplier capped at 3');
  H.assert(c.max === 30, 'max ' + c.max);
});

// ================================================================== RR.Collectibles — placement
console.log('\nRR.Collectibles');
function placementRun(worldId, seed, mods) {
  const world = RR.Worlds.byId(worldId);
  const r = new Map();
  const run = { world, modifiers: mods || null, rng(n) { if (!r.has(n)) r.set(n, U.makeRng(seed).fork(n)); return r.get(n); } };
  run.terrain = new RR.Terrain({ seed, world, modifiers: mods || null });
  run.collectibles = new RR.Collectibles(run);
  run.terrain.onChunk = (a, b, f) => run.collectibles.spawnChunk(a, b, f);
  return run;
}
function grow(run, to) { for (let x = 200; x < to; x += 250) run.terrain.ensure(x); run.terrain.ensure(to); }
const live = (list, head) => list.slice(head);

H.test('fuel: never in trenches / lava / ramps, on the ground, first ≈ 150 m, gaps widen with distance', () => {
  const F = RR.Terrain.FLAGS, DX = RR.Terrain.DX;
  let totalFuel = 0, totalMega = 0, totalCells = 0;
  for (const [wid, seed] of [['volcanic_ridge', 11], ['volcanic_ridge', 99], ['desert_canyon', 5], ['green_valley', 3], ['storm_planet', 7], ['neon_city', 8]]) {
    const run = placementRun(wid, seed);
    grow(run, 9000);
    const T = run.terrain, C = run.collectibles, world = run.world;
    const cans = C.fuel.filter((it) => it.kind !== 'cell');
    H.assert(cans.length >= 8, wid + ' cans ' + cans.length);
    H.assert(cans[0].x >= 140 && cans[0].x <= 205, wid + ' first fuel at ' + cans[0].x);
    for (const it of C.fuel) {
      for (let i = Math.floor((it.x - 2) / DX); i <= Math.ceil((it.x + 2) / DX); i++) {
        const fl = T.flagsIdx(i);
        H.assert(!(fl & (F.TRENCH | F.LAVA | F.RAMP | F.PAD)), wid + ' fuel in trench/lava/ramp at ' + it.x);
      }
      H.assert(!T.surfaceAt(it.x).hazard, wid + ' fuel on lava ' + it.x);
      const lift = it.kind === 'mega' ? 1.1 : 0.8;
      H.assertClose(it.y, T.heightAt(it.x) + lift, 1e-6, wid + ' fuel height');
    }
    // guaranteed boss-climb cans (gameplay / terrain-1) are extras; a regular can that falls within 25 m of
    // one is dropped (the boss can stands in for it), so gaps next to them are not checked
    const bossCans = cans.filter((c) => c.boss);
    const regular = cans.filter((c) => !c.boss);
    const nearBoss = (a, b) => bossCans.some((c) => c.x >= a - 26 && c.x <= b + 26);
    for (let i = 1; i < regular.length; i++) {
      if (nearBoss(regular[i - 1].x, regular[i].x)) continue;
      // integration balance pass: min(1150, 230 + 0.5·x) × world.fuelSpacing, ±15 %
      const base = Math.min(1150, 230 + 0.5 * regular[i - 1].x) * world.fuelSpacing;
      const gap = regular[i].x - regular[i - 1].x;
      H.assert(gap >= base * 0.85 - 1e-6 && gap <= base * 1.15 + 75, wid + ' fuel gap ' + gap.toFixed(1) + ' vs ' + base.toFixed(1));
    }
    for (const cell of C.fuel.filter((it) => it.kind === 'cell')) {
      const prev = cans.filter((c) => c.x < cell.x).pop(), next = cans.find((c) => c.x > cell.x);
      H.assert(prev && (!next || next.x - cell.x >= 20), wid + ' cell between cans at ' + cell.x);
    }
    const megas = cans.filter((it) => it.kind === 'mega');
    H.assert(megas.length >= 2 && megas[0].x >= 1700 && megas[0].x <= 3500, wid + ' megas ' + megas.map((m) => m.x.toFixed(0)));
    totalFuel += cans.length; totalMega += megas.length; totalCells += C.fuel.length - cans.length;
    // power-ups every 300–500 m (+ search slack), never on top of a fuel can
    const P = C.powerups;
    H.assert(P.length >= 14 && P[0].x >= 260 && P[0].x <= 400, wid + ' first power-up ' + (P[0] && P[0].x));
    for (let i = 1; i < P.length; i++) {
      const gap = P[i].x - P[i - 1].x;
      H.assert(gap >= 300 - 1e-6 && gap <= 500 + 75, wid + ' power-up gap ' + gap);
    }
    for (const p of P) H.assert(!C.fuel.some((f) => Math.abs(f.x - p.x) < 8), wid + ' power-up next to a can at ' + p.x);
  }
  console.log('      (6 terrains × 9 km: ' + totalFuel + ' cans incl. ' + totalMega + ' mega, ' + totalCells + ' energy cells)');
});
H.test('coins: trails, arcs, clusters — above ground, sorted, tiered by difficulty, values × multipliers', () => {
  const run = placementRun('desert_canyon', 21);
  grow(run, 7000);
  const T = run.terrain, C = run.collectibles;
  H.assert(C.coins.length > 500, 'coins ' + C.coins.length);
  for (let i = 0; i < C.coins.length; i++) {
    const it = C.coins[i];
    if (i) H.assert(it.x >= C.coins[i - 1].x, 'sorted at ' + i);
    H.assert(it.y >= T.heightAt(it.x) + 0.5 - 1e-6, 'coin in the ground at ' + it.x);
    H.assert(it.value === Math.round(RR.Collectibles.COIN_BASE[it.tier] * run.world.coinMul), 'value × coinMul');
  }
  const tierShare = (a, b) => {
    const s = C.coins.filter((c) => c.x >= a && c.x < b);
    return s.filter((c) => c.tier > 0).length / Math.max(1, s.length);
  };
  const early = tierShare(0, 1500), late = tierShare(5000, 7000);
  H.assert(early < 0.35 && late > early * 1.3, 'more silver/gold later: early ' + early.toFixed(2) + ' late ' + late.toFixed(2));
  // arcs over gaps/jumps: coins inside the feature span, above the takeoff
  const gaps = T.features.filter((f) => f.type === 'gap' || f.type === 'jump');
  let arcs = 0;
  for (const f of gaps) {
    const m = f.meta;
    const over = C.coins.filter((c) => c.x > m.takeoffX + 1 && c.x < m.takeoffX + 12 && c.y > m.takeoffY + 0.5);
    if (over.length >= 3) arcs++;
  }
  H.assert(gaps.length > 5 && arcs >= gaps.length * 0.6, 'arcs over ' + arcs + '/' + gaps.length + ' launch features');
  const plateaus = T.features.filter((f) => f.type === 'plateau' && !f.meta.ledge && !f.meta.summit && f.x2 - f.x >= 14);
  const clusters = plateaus.filter((f) => C.coins.some((c) => c.tier === 2 && Math.abs(c.x - (f.x + f.x2) / 2) < 0.1));
  H.assert(plateaus.length === 0 || clusters.length >= 1, 'gold plateau clusters ' + clusters.length + '/' + plateaus.length);
});
H.test('deterministic per seed; noFuelPickups; coinMul / coinDensityMul', () => {
  const a = placementRun('green_valley', 77), b = placementRun('green_valley', 77);
  grow(a, 3000); grow(b, 3000);
  H.assert(a.collectibles.coins.length === b.collectibles.coins.length && a.collectibles.coins.every((c, i) => c.x === b.collectibles.coins[i].x && c.value === b.collectibles.coins[i].value), 'coins deterministic');
  H.assert(a.collectibles.fuel.map((f) => f.x + f.kind).join() === b.collectibles.fuel.map((f) => f.x + f.kind).join(), 'fuel deterministic');
  H.assert(a.collectibles.powerups.map((p) => p.type).join() === b.collectibles.powerups.map((p) => p.type).join(), 'power-ups deterministic');
  const nf = placementRun('green_valley', 77, { noFuelPickups: true });
  grow(nf, 6000);
  H.assert(nf.collectibles.fuel.length === 0 && nf.collectibles.stats.fuel === 0 && nf.collectibles.stats.cells === 0, 'no fuel pickups');
  H.assert(nf.collectibles.powerups.length > 8 && nf.collectibles.powerups.every((p) => p.type !== 'fuelboost'), 'no fuel boosts');
  H.assert(nf.collectibles.nextFuelDistance(0) === Infinity, 'nextFuelDistance Infinity');
  const rush = placementRun('green_valley', 77, { coinMul: 2, coinDensityMul: 2.5 });
  grow(rush, 3000);
  H.assert(rush.collectibles.coins.length > a.collectibles.coins.length * 1.4, 'density ×2.5: ' + rush.collectibles.coins.length + ' vs ' + a.collectibles.coins.length);
  H.assert(rush.collectibles.coins.every((c) => c.value === RR.Collectibles.COIN_BASE[c.tier] * 2), 'values ×2');
});
H.test('addCoin (events) applies world × modifier multipliers; falling coins settle; static coins stay sorted', () => {
  const run = placementRun('neon_city', 5, { coinMul: 2 });
  grow(run, 400);
  const C = run.collectibles, T = run.terrain;
  const it = C.addCoin(100, T.heightAt(100) + 6, 25, { falling: true, vx: 1, vy: 2 });
  H.assert(it.value === Math.round(25 * 2.3 * 2) && it.tier === 1, 'value ' + it.value);
  const s = C.addCoin(123.4, T.heightAt(123.4) + 2, 100, { falling: false });
  H.assert(s.tier === 2 && s.value === Math.round(100 * 4.6), 'gold value');
  for (let i = 1; i < C.coins.length; i++) H.assert(C.coins[i].x >= C.coins[i - 1].x, 'still sorted');
  run.body = { x: 60, y: T.heightAt(60) + 0.8, angle: 0, vx: 0, vy: 0, wheels: [] };
  run.state = 'running';
  for (let i = 0; i < 240; i++) C.update(1 / 60, run);
  H.assert(it.settled && Math.abs(it.y - (T.heightAt(it.x) + 0.5)) < 1e-6, 'falling coin settled on the ground');
  H.assert(C.addCoin(NaN, 1, 5) === null && C.addCoin(1, Infinity, 5) === null, 'junk rejected');
});

// ================================================================== RR.Collectibles — pickups
function pickupRig() {
  const run = placementRun('green_valley', 1234);
  grow(run, 400);
  const T = run.terrain;
  const tuned = RR.Vehicles.getTuned('trail_buggy', null);
  run.tuned = tuned;
  run.body = new RR.VehicleBody(tuned, 0, 0);
  run.body.placeOnTerrain(T, 30);
  run.state = 'running';
  run.powerUps = new RR.PowerUps(run);
  run.got = [];
  run.onCoin = (v, x, y) => run.got.push(['coin', v]);
  run.onFuel = (k) => run.got.push(['fuel', k]);
  run.onPowerup = (t) => run.got.push(['powerup', t]);
  return run;
}
H.test('pickup: collect animation (0.2 s) then exactly one callback', () => {
  const run = pickupRig(), C = run.collectibles, b = run.body;
  C.coins.length = 0; C._heads.coins = 0;
  C.addCoin(b.x + 0.4, b.y + 0.3, 5, { falling: false });
  C.update(1 / 60, run);
  H.assert(run.got.length === 0, 'not instant');
  for (let i = 0; i < 11; i++) C.update(1 / 60, run);
  H.assert(run.got.length === 0, 'still flying at 0.2 s boundary');
  for (let i = 0; i < 30; i++) C.update(1 / 60, run);
  H.assert(run.got.length === 1 && run.got[0][0] === 'coin' && run.got[0][1] === 5, JSON.stringify(run.got));
  H.assert(C.collected.coin === 1, 'collected counter');
});
H.test('magnet pulls coins within 9 m; nothing is collected while crashed', () => {
  const run = pickupRig(), C = run.collectibles, b = run.body;
  C.coins.length = 0; C._heads.coins = 0;
  C.addCoin(b.x + 6, b.y + 2.5, 25, { falling: false });
  C.addCoin(b.x + 11, b.y + 2.5, 25, { falling: false });
  for (let i = 0; i < 60; i++) C.update(1 / 60, run);
  H.assert(run.got.length === 0, 'out of reach without magnet');
  run.powerUps.activate('magnet');
  for (let i = 0; i < 90; i++) C.update(1 / 60, run);
  H.assert(run.got.length === 1, 'magnet collected only the coin within 9 m: ' + run.got.length);
  const run2 = pickupRig();
  run2.collectibles.coins.length = 0; run2.collectibles._heads.coins = 0;
  run2.collectibles.addCoin(run2.body.x, run2.body.y, 5, { falling: false });
  run2.state = 'crashed';
  for (let i = 0; i < 60; i++) run2.collectibles.update(1 / 60, run2);
  H.assert(run2.got.length === 0, 'collected while crashed');
});
H.test('fuel / power-up pickups, nextFuelDistance, cleanup behind the car', () => {
  const run = pickupRig(), C = run.collectibles, b = run.body;
  const nf = C.nextFuel(b.x);
  H.assert(nf && Math.abs(C.nextFuelDistance(b.x) - (nf.x - b.x)) < 1e-9, 'next fuel distance');
  H.assert(C.nextFuelDistance(NaN) === Infinity, 'junk');
  b.placeOnTerrain(run.terrain, nf.x - 0.5);
  for (let i = 0; i < 30; i++) C.update(1 / 60, run);
  H.assert(run.got.some((g) => g[0] === 'fuel' && g[1] === nf.kind), 'fuel picked ' + JSON.stringify(run.got));
  H.assert(C.nextFuelDistance(b.x) > 5, 'next fuel moves on');
  const pu = C.powerups[C._heads.powerups];
  H.assert(pu, 'a power-up within 400 m');
  b.placeOnTerrain(run.terrain, pu.x - 0.3);
  for (let i = 0; i < 30; i++) C.update(1 / 60, run);
  H.assert(run.got.some((g) => g[0] === 'powerup' && g[1] === pu.type), 'power-up picked');
  const before = C.coins.length - C._heads.coins;
  b.placeOnTerrain(run.terrain, 380);
  C.update(1 / 60, run);
  H.assert(C.coins.length - C._heads.coins < before, 'coins behind the car recycled');
  H.assert(C._pool.length > 0, 'items pooled');
});

// ================================================================== RR.Run — full headless runs
console.log('\nRR.Run');
const results = [];
H.test('every world: ' + SECONDS + ' s headless runs — no NaN, progress, coins, fuel, onEnd once', () => {
  for (const w of RR.Worlds.list) {
    clearLogs();
    const run = newRun({ worldId: w.id, seed: 1000 + RR.Worlds.indexOf(w.id) });
    let lastDist = 0, minFuel = run.fuelMax, i = 0;
    const n = SECONDS * FPS;
    for (; i < n && !run._ended; i++) {
      drive(run);
      run.update(DT);
      if (i % 5 === 0) assertRunFinite(run, w.id + ' frame ' + i);
      H.assert(run.distance >= lastDist, 'distance never decreases');
      lastDist = run.distance;
      minFuel = Math.min(minFuel, run.fuel);
    }
    assertRunFinite(run, w.id + ' end');
    const r = { world: w.id, distance: Math.round(run.distance), coins: run.coins, bonus: run.bonusCoins, fuelMin: Math.round(minFuel),
      fuelCollected: run.stats.fuelCollected, powerups: run.stats.powerups, tricks: run.tricks.stats.tricks, state: run.state,
      crash: run.crashReason || '', t: Math.round(run.time) };
    results.push(r);
    H.assert(run.__ends.length <= 1, w.id + ' onEnd called ' + run.__ends.length + '×');
    if (run._ended) {
      H.assert(run.__ends.length === 1, w.id + ' ended without onEnd');
      assertSummary(run.__ends[0], w.id);
    }
    H.assert(run.coins > 0, w.id + ' collected no coins');
    H.assert(run.distance > 250, w.id + ' distance ' + run.distance);
    H.assert(minFuel < run.fuelMax - 5, w.id + ' fuel never consumed');
    H.assert(audioLog.engineUpdates > 0 && audioLog.indexOf('engineStart:' + run.tuned.style) === 0, 'engine audio');
    run.destroy();
  }
  console.log('      world            distance  coins  bonus fuelMin fuelCol pu tricks state');
  for (const r of results) {
    console.log('      ' + r.world.padEnd(16) + String(r.distance).padStart(8) + String(r.coins).padStart(7) + String(r.bonus).padStart(7) +
      String(r.fuelMin).padStart(8) + String(r.fuelCollected).padStart(8) + String(r.powerups).padStart(3) + String(r.tricks).padStart(7) + '  ' + r.state + (r.crash ? ' (' + r.crash + ')' : ''));
  }
  const gv = results.find((r) => r.world === 'green_valley');
  H.assert(gv.distance > Math.min(900, SECONDS * 9), 'Green Valley distance ' + gv.distance);
  H.assert(gv.fuelCollected >= 1, 'fuel collected in Green Valley');
});

H.test('daily challenges: every modifier type runs clean and takes effect', () => {
  const base = RR.Daily.getChallenge();
  for (const type of RR.Daily.TYPES) {
    const world = RR.Worlds.byId(type.exclude.indexOf('green_valley') >= 0 ? 'rocky_highlands' : 'green_valley');
    const built = type.build(world);
    const daily = Object.assign({}, base, { id: type.id, worldId: world.id, seed: 4242, targetDistance: 800,
      modifiers: Object.assign({ gravityMul: 1, noFuelPickups: false, fuelEfficiencyMul: 1, speedMul: 1, terrainAmpMul: 1,
        frictionMul: 1, coinMul: 1, coinDensityMul: 1, windMul: 1 }, built) });
    const run = newRun({ worldId: 'storm_planet', mode: 'daily', daily });
    H.assert(run.mode === 'daily' && run.worldId === world.id && run.seed === 4242, type.id + ' uses the daily world & seed');
    const M = run.modifiers;
    const stock = RR.Vehicles.getTuned('trail_buggy', run.upgrades);
    if (built.gravityMul) H.assertClose(run.env.gravity, 9.81 * world.gravity * built.gravityMul, 1e-9, type.id + ' gravity');
    if (built.speedMul) H.assertClose(run.tuned.maxSpeed, stock.maxSpeed * built.speedMul, 1e-6, type.id + ' speedMul');
    if (built.frictionMul) H.assert(M.frictionMul === built.frictionMul, type.id + ' friction');
    if (built.noFuelPickups) H.assert(run.collectibles.fuel.length === 0, type.id + ' fuel pickups exist');
    frames(run, 30, drive);
    assertRunFinite(run, type.id);
    if (built.frictionMul) H.assert(run._physEnv.frictionMul === built.frictionMul, type.id + ' physics friction');
    if (built.gravityMul) H.assert(Math.abs(run._physEnv.gravity - run.env.gravity * run.env.gravityMul) < 1e-9, type.id + ' physics gravity');
    if (built.noFuelPickups) {
      H.assert(run.stats.fuelCollected === 0, 'no_fuel collected fuel');
      // same seed & driver with full-rate fuel: the reduced burn must use ≈ fuelEfficiencyMul × the fuel
      const base = newRun({ worldId: 'storm_planet', mode: 'daily', daily: Object.assign({}, daily, { modifiers: { noFuelPickups: true } }) });
      frames(base, 30, drive);
      const used = run.fuelMax - run.fuel, usedBase = base.fuelMax - base.fuel;
      const eff = M.fuelEfficiencyMul;
      H.assert(usedBase > 0 && Math.abs(used / usedBase - eff) < 0.15, 'no_fuel burns at ' + Math.round(eff * 100) + '% (' + used.toFixed(1) + ' vs ' + usedBase.toFixed(1) + ' used)');
      base.destroy();
    }
    if (built.coinMul) H.assert(live(run.collectibles.coins, run.collectibles._heads.coins).every((c) => c.value === Math.round(RR.Collectibles.COIN_BASE[c.tier] * world.coinMul * built.coinMul)), type.id + ' coin values');
    H.assert(run.__ends.length <= 1, type.id + ' onEnd');
    run.destroy();
  }
  // speedMul really raises the top speed on flat ground
  const fast = RR.Run.applySpeedMul;
  const t1 = RR.Vehicles.getTuned('trail_buggy', null), t2 = RR.Vehicles.getTuned('trail_buggy', null);
  fast(t2, 1.35);
  const flat = { heightAt: () => 0, slopeAt: () => 0, normalAt: (x, o) => { o = o || {}; o.x = 0; o.y = 1; return o; }, surfaceAt: () => RR.SURFACES.grass, minX: -1e9, maxX: 1e9, DX: 0.5 };
  const top = (t) => { const b = new RR.VehicleBody(t, 0, 0); b.placeOnTerrain(flat, 0); for (let i = 0; i < 120 * 25; i++) b.step(1 / 120, { throttle: 1, engineOn: true }, { terrain: flat, gravity: 9.81 }); return b.vx; };
  const v1 = top(t1), v2 = top(t2);
  H.assert(v2 > v1 * 1.25, 'Redline top speed ' + v2.toFixed(1) + ' vs ' + v1.toFixed(1));
  // normalisation of missing / junk fields
  const n = RR.Run.normalizeModifiers({ gravityMul: NaN, speedMul: 99, coinMul: 'x', labels: ['a', 3] });
  H.assert(n.gravityMul === 1 && n.speedMul === 2 && n.coinMul === 1 && n.noFuelPickups === false && n.labels.join() === 'a', JSON.stringify(n));
  const d2 = newRun({ mode: 'daily', daily: { worldId: 'green_valley', seed: 9 } });
  H.assert(d2.modifiers.fuelEfficiencyMul === 1 && d2.modifiers.windMul === 1, 'missing modifiers → neutral');
  frames(d2, 2, drive);
  assertRunFinite(d2, 'daily without modifiers');
  d2.destroy();
});

H.test('attract mode: autopilot drives, self-restarts, never touches HUD / audio / missions / onEnd', () => {
  clearLogs();
  let ended = 0;
  const run = new RR.Run({ worldId: 'green_valley', vehicleId: 'trail_buggy', mode: 'attract', seed: 2024, renderer: RENDERER, onEnd: () => ended++ });
  H.assert(run.seed === 2024, 'first attract session honours the seed');
  controls.throttle = -1;   // must be ignored
  frames(run, 20);
  assertRunFinite(run, 'attract');
  H.assert(run.distance > 80, 'autopilot distance ' + run.distance.toFixed(1));
  const seed0 = run.seed;
  run.invulnTime = 0;
  run.powerUps.clear();          // the autopilot may have picked up a shield
  H.assert(run.crash('head') && run.state === 'crashed', 'attract crash');
  frames(run, 1.8);
  H.assert(run.state === 'running' && run.seed !== seed0 && run.distance < 40 && run.fuel > 0.95 * run.fuelMax, 'restarted after crash');
  // running dry also restarts (coasting to a stop at the start)
  const seed1 = run.seed;
  run.fuel = 0;
  frames(run, 14);
  H.assert(run.seed !== seed1 && run.state === 'running', 'restarted after fuel ran out');
  // stuck watchdog
  const seed2 = run.seed;
  frames(run, 8, (r) => { r.body.setVelocity(0, 0); });
  H.assert(run.seed !== seed2, 'restarted when stuck');
  H.assert(ended === 0, 'onEnd called in attract');
  H.assert(hudLog.length === 0 && audioLog.length === 0 && !audioLog.engineUpdates && missionLog.length === 0,
    'attract touched HUD/audio/missions: ' + JSON.stringify([hudLog.slice(0, 3), audioLog.slice(0, 3), missionLog.slice(0, 3)]));
  H.assert(run.bestDistance === 0 && run.upgrades.fuel === 10, 'attract uses a showcase build and no best');
  run.quit();
  H.assert(ended === 1 && run.state === 'ended', 'quit ends an attract run');
  run.destroy();
});

H.test('shield rescue: consumed, rescued, invulnerable; the next crash ends the run once', () => {
  clearLogs();
  const run = newRun();
  frames(run, 3, drive);
  run.powerUps.activate('shield');
  H.assert(run.crash('head') === false, 'shield absorbs');
  H.assert(run.state === 'running' && run.invulnTime === 1.5 && !run.powerUps.isActive('shield') && run.stats.shieldSaves === 1, 'rescued');
  H.assert(hudLog.some((h) => h[0] === 'flash' && h[1] === 'shield') && audioLog.indexOf('shield') >= 0, 'shield feedback');
  H.assert(run.crash('lava') === false && run.state === 'running', 'invulnerable');
  frames(run, 1.6, drive);
  H.assert(run.invulnTime === 0, 'invulnerability expires');
  H.assert(run.crash('rock') === true && run.state === 'crashed' && run.crashReason === 'rock', 'crashes now');
  H.assert(audioLog.indexOf('crash') >= 0 && audioLog.indexOf('engineStop') >= 0 && hudLog.some((h) => h[0] === 'flash' && h[1] === 'crash'), 'crash feedback');
  H.assert(run.env.timeScale === 1 || run.state === 'crashed', 'slow-mo');
  frames(run, 0.5);
  H.assert(run.env.timeScale === 0.3 && run.__ends.length === 0, 'slow-mo before the end');
  frames(run, 1.3);
  H.assert(run.__ends.length === 1 && run.state === 'ended', 'ended after 1.6 s');
  const s = run.__ends[0];
  assertSummary(s, 'crash summary');
  H.assert(s.endReason === 'crash' && s.crashReason === 'rock', 'reasons');
  frames(run, 2);
  run.quit();
  run.crash('head');
  H.assert(run.__ends.length === 1, 'onEnd exactly once');
  run.destroy();
});

H.test('crash detection: head hit, lava, flipped on the roof, stuck on its tail', () => {
  let run = newRun();
  frames(run, 1, drive);
  run.body.headHit = true;
  frames(run, DT);
  H.assert(run.state === 'crashed' && run.crashReason === 'head' && !run.body.headHit, 'head');
  run.destroy();
  run = newRun();
  frames(run, 1, drive);
  run.body.hazard = 'lava';
  frames(run, DT);
  H.assert(run.crashReason === 'lava', 'lava');
  run.destroy();
  // upside down on the flat start zone (roof on the ground)
  run = newRun();
  frames(run, 0.5);
  const b = run.body;
  b.setPose(b.x, b.y + 0.2, Math.PI);
  let flippedAt = -1;
  frames(run, 4, (r, i) => { r.body.headHit = false; if (flippedAt < 0 && r.state === 'crashed') flippedAt = i; });
  H.assert(run.state !== 'running', 'upside-down car must crash');
  run.destroy();
  // tail-stand: 80° nose-up resting on the tail
  run = newRun();
  frames(run, 0.5);
  run.body.setPose(run.body.x, run.body.y + 1.2, 1.4);
  let crashed = false;
  frames(run, 4, (r) => { r.body.headHit = false; crashed = crashed || r.state === 'crashed'; });
  H.assert(crashed ? run.crashReason === 'flipped' || run.crashReason === 'head' : run.state === 'running', 'tail stand handled (' + run.state + ' ' + run.crashReason + ')');
  run.destroy();
});

H.test('slow time: physics ×0.55, power-up timer on real time', () => {
  const run = newRun();
  frames(run, 1, drive);
  run.onPowerup('slowtime', run.body.x, run.body.y);
  const t0 = run.body.time, r0 = run.powerUps.remaining('slowtime');
  frames(run, 2, drive);
  const simRate = (run.body.time - t0) / 2;
  H.assert(Math.abs(simRate - 0.55) < 0.02, 'sim rate ' + simRate);
  H.assert(run.env.timeScale === 0.55, 'env.timeScale');
  H.assertClose(r0 - run.powerUps.remaining('slowtime'), 2, 0.02, 'real-time timer');
  frames(run, 4.2, drive);
  H.assert(!run.powerUps.isActive('slowtime') && run.env.timeScale === 1, 'back to normal');
  run.destroy();
});

H.test('boost power-up and the Ion Thruster (special): boost clamp, cooldown, fuel cost, no handbrake', () => {
  let run = newRun();
  frames(run, 0.5, drive);
  run.onPowerup('boost');
  frames(run, 0.1, drive);
  H.assert(run.boostActive && run.controls.boost === 1, 'boost power-up');
  controls.handbrake = true;
  frames(run, 0.1);
  H.assert(run.controls.handbrake === true, 'buggy uses the handbrake');
  controls.handbrake = false;
  run.destroy();
  clearLogs();
  run = newRun({ vehicleId: 'storm_runner' });
  H.assert(run.special && run.special.id === 'thruster', 'storm runner has a special');
  frames(run, 0.5, drive);
  const f0 = run.fuel;
  frames(run, DT, (r) => { drive(r); controls.handbrake = true; });
  H.assert(run.specialActive && run.controls.boost === 1 && run.controls.handbrake === false, 'thruster fires on Space');
  H.assert(f0 - run.fuel >= 3 && run.specialCooldown > 6.9 && audioLog.indexOf('thruster') >= 0, 'fuel cost + cooldown + sound');
  run.onPowerup('boost');
  frames(run, DT, (r) => { drive(r); controls.handbrake = true; });
  H.assert(run.controls.boost === 1.5, 'boost + thruster clamp to 1.5: ' + run.controls.boost);
  frames(run, 1.4, (r) => { drive(r); controls.handbrake = false; });
  H.assert(!run.specialActive, 'thruster duration over');
  frames(run, DT, (r) => { drive(r); controls.handbrake = true; });
  H.assert(!run.specialActive, 'cooldown blocks re-fire');
  controls.handbrake = false;
  frames(run, 6, drive);
  // RR.Input 'special' event path
  H.assert((inputListeners.special || []).length === 1, 'one global special listener');
  inputListeners.special[0]();
  frames(run, DT, drive);
  H.assert(run.specialActive, 'special event fires the thruster');
  run.destroy();
});

H.test('out of fuel: engine off, banner, ends with "fuel" once stopped; refuel while coasting resumes', () => {
  clearLogs();
  let run = newRun();
  frames(run, 0.2);
  run.fuel = 0.0001;
  frames(run, 0.1, () => { controls.throttle = 1; controls.lean = 0; });
  H.assert(run.state === 'nofuel' && run.controls.engineOn === false, 'nofuel state');
  H.assert(hudLog.some((h) => h[0] === 'banner' && h[1] === 'OUT OF FUEL') && audioLog.indexOf('engineStop') >= 0, 'banner + engine stop');
  frames(run, 3, () => { controls.throttle = -1; });
  H.assert(run.__ends.length === 1 && run.__ends[0].endReason === 'fuel', 'ended with fuel');
  assertSummary(run.__ends[0], 'fuel summary');
  run.destroy();
  run = newRun();
  frames(run, 4, drive);
  run.fuel = 0;
  frames(run, 0.1, drive);
  H.assert(run.state === 'nofuel', 'coasting');
  clearLogs();
  run.onFuel('cell', run.body.x, run.body.y);
  H.assert(run.state === 'running' && Math.abs(run.fuel - 0.35 * run.fuelMax) < 1e-6, 'resumed with +35%');
  H.assert(audioLog.indexOf('engineStart:buggy') >= 0 && audioLog.indexOf('fuel') >= 0, 'engine restarts');
  run.onFuel('mega');
  H.assert(run.fuel === run.fuelMax && run.megaTime === 8, 'mega');
  const f = run.fuel;
  frames(run, 2, drive);
  H.assert(run.fuel === f, 'no drain during mega');
  run.megaTime = 0;
  run.env.fuelZone = true;
  run.fuel = 50;
  frames(run, DT, drive);
  H.assert(run.fuel > 50, 'fuel zone refills');
  run.destroy();
  // hard cap: coasting forever still ends after 12 s
  run = newRun();
  frames(run, 1, drive);
  run.fuel = 0;
  let t = 0;
  frames(run, 13.5, (r) => { if (!r._ended) { r.body.vx = Math.max(r.body.vx, 6); t += DT; } });
  H.assert(run.__ends.length === 1 && run.__ends[0].endReason === 'fuel', 'hard cap');
  run.destroy();
});

H.test('callbacks: coins (×2 multiplier), fuel, power-ups, tricks, bonus; missions tracked', () => {
  clearLogs();
  const run = newRun();
  frames(run, 20, drive);
  // distance chunks, runDistance, worldDistance
  const dist = missionLog.filter((m) => m.stat === 'distance');
  const sum = dist.reduce((s, m) => s + m.value, 0);
  H.assert(dist.every((m) => Number.isInteger(m.value) && m.value >= 1), 'distance tracked in whole metres');
  H.assert(Math.abs(sum - Math.floor(run.distance)) <= 1, 'distance sum ' + sum + ' vs ' + run.distance.toFixed(1));
  const rd = missionLog.filter((m) => m.stat === 'runDistance');
  H.assert(rd.length && rd[rd.length - 1].value === Math.floor(run.distance), 'runDistance');
  const wd = missionLog.filter((m) => m.stat === 'worldDistance');
  H.assert(wd.length === rd.length && wd.every((m) => m.ctx && m.ctx.worldId === 'green_valley'), 'worldDistance ctx');
  clearLogs();
  run.powerUps.clear();          // the driver may have collected a 2X COINS power-up
  const c0 = run.coins;
  run.onCoin(25, run.body.x, run.body.y);
  const texts = () => run.floatText ? run.floatText._items.slice(0, run.floatText.count).map((it) => it.text + '|' + it.color) : [];
  const t0 = texts().length;
  run.onPowerup('multiplier');
  run.onCoin(5, run.body.x, run.body.y);
  H.assert(run.coins - c0 === 35, 'multiplier doubles: ' + (run.coins - c0));
  // visuals-2 (verifier): with 2X COINS every pickup pops a gold '+N ×2' float text
  if (run.floatText) H.assert(texts().slice(t0).indexOf('+10 ×2|#ffd23f') >= 0, 'gold ×2 float text: ' + JSON.stringify(texts().slice(t0)));
  H.assert(missionLog.filter((m) => m.stat === 'coins').map((m) => m.value).join() === '25,10', 'coins tracked with value');
  H.assert(audioLog.indexOf('coinBig') >= 0 && audioLog.indexOf('coin') >= 0 && audioLog.indexOf('powerup') >= 0, 'sounds');
  run.onFuel('fuel');
  run.onPowerup('fuelboost');
  H.assert(run.fuel === run.fuelMax && run.stats.fuelCollected >= 1 && run.stats.powerups >= 2, 'fuel & power-up stats');
  H.assert(missionLog.some((m) => m.stat === 'fuelCans') && missionLog.filter((m) => m.stat === 'powerups').length === 2, 'fuel/power-up missions');
  H.assert(hudLog.some((h) => h[0] === 'toast' && /2X COINS/.test(h[1])), 'power-up toast');
  const b0 = run.bonusCoins, x0 = run.trickXp;
  run.onTrick({ id: 'doubleFlip', label: 'DOUBLE FLIP', coins: 300, xp: 60, combo: 4, flips: 2, dir: 1 });
  run.onTrick({ id: 'wheelie', label: 'WHEELIE 12 M', coins: 74, xp: 15, combo: 5, meters: 12.3 });
  run.onTrick({ id: 'perfect', label: 'PERFECT LANDING', coins: 150, xp: 30, combo: 1 });
  H.assert(run.bonusCoins - b0 === 524 && run.trickXp - x0 === 105, 'bonus coins & trick xp');
  const st = (s) => missionLog.filter((m) => m.stat === s).map((m) => m.value).join();
  H.assert(st('doubleFlips') === '1' && st('backflips') === '2' && st('wheelie') === '12.3' && st('perfectLandings') === '1' && st('tricks') === '1,1,1', 'trick missions ' + JSON.stringify(missionLog.slice(-10)));
  H.assert(hudLog.filter((h) => h[0] === 'popTrick').length === 3 && audioLog.indexOf('flip') >= 0 && audioLog.indexOf('perfect') >= 0 && audioLog.indexOf('combo') >= 0, 'trick feedback');
  run.addBonus(1500, 'SUMMIT!');
  H.assert(run.bonusCoins - b0 === 2024 && hudLog.some((h) => h[0] === 'popTrick' && h[1] === 'SUMMIT!'), 'addBonus');
  run.addBonus(NaN, 'x'); run.addBonus(-5, 'y');
  H.assert(run.bonusCoins - b0 === 2024, 'junk bonus ignored');
  run.onCoin(NaN); run.onFuel('???'); run.onPowerup('nope'); run.onTrick(null);
  assertRunFinite(run, 'after junk callbacks');
  run.announce('THE CAVE', 'Lights on', 'section');
  run.warn('FALLING ROCKS!', 'hazard');
  H.assert(hudLog.some((h) => h[0] === 'banner' && h[1] === 'THE CAVE') && hudLog.some((h) => h[0] === 'warning' && h[1] === 'FALLING ROCKS!'), 'announce / warn');
  // combo max is tracked as a mission stat
  run.tricks.addComboAction('fuel'); run.tricks.addComboAction('fuel'); run.tricks.addComboAction('fuel');
  frames(run, DT, drive);
  H.assert(missionLog.some((m) => m.stat === 'combo' && m.value >= 3), 'combo tracked');
  run.quit();
  H.assert(run.__ends.length === 1 && run.__ends[0].endReason === 'quit', 'quit');
  assertSummary(run.__ends[0], 'quit summary');
  run.destroy();
});

H.test('new record: banner + sound + confetti once (only when the previous best ≥ 50 m)', () => {
  clearLogs();
  let run = newRun();
  run.bestDistance = 60;
  frames(run, 12, drive);
  H.assert(run.distance > 60 && run.newRecord, 'beat the record');
  H.assert(hudLog.filter((h) => h[0] === 'banner' && h[1] === 'NEW RECORD!').length === 1 && audioLog.filter((a) => a === 'record').length === 1, 'announced once');
  H.assert(run.bestDistance === 60, 'BEST flag stays put');
  run.destroy();
  clearLogs();
  run = newRun();
  run.bestDistance = 30;
  frames(run, 8, drive);
  H.assert(run.newRecord && !hudLog.some((h) => h[1] === 'NEW RECORD!'), 'no fanfare for tiny bests');
  H.assert(run.getSummary().newRecord === true && run.getSummary().previousBest === 30, 'summary record fields');
  run.destroy();
});

H.test('missions completed during the run are listed in the summary', () => {
  const run = newRun();
  const m = RR.Missions.getActive()[0];
  RR.Bus.emit('missionComplete', { mission: { id: 'test-mission', text: 'Test mission done' } });
  RR.Bus.emit('missionComplete', { mission: { id: 'test-mission', text: 'Test mission done' } });
  frames(run, 1, drive);
  run.quit();
  H.assert(run.__ends[0].missionsCompleted.join('|') === 'Test mission done', JSON.stringify(run.__ends[0].missionsCompleted));
  RR.Bus.emit('missionComplete', { mission: { id: 'late', text: 'late' } });
  H.assert(run.getSummary().missionsCompleted.length === 1, 'unsubscribed after end');
  run.destroy();
  H.assert(m && typeof m.text === 'string', 'real missions exist');
});

H.test('rng: stable per seed + name, cached', () => {
  const run = newRun({ mode: 'daily', daily: { worldId: 'green_valley', seed: 555, modifiers: {} } });
  const a = run.rng('x');
  H.assert(run.rng('x') === a, 'cached');
  const ref = U.makeRng(555).fork('x');
  H.assert(a.next() === ref.next(), 'makeRng(seed).fork(name)');
  run.destroy();
});

H.test('destroy / update-after-end / NaN input are safe; render goes through the renderer', () => {
  clearLogs();
  const run = newRun();
  frames(run, 1, drive);
  const f0 = RENDERER.frames || 0;
  run.render();
  H.assert(RENDERER.frames === f0 + 1, 'render → drawRun');
  run.update(NaN); run.update(-1); run.update(Infinity);
  assertRunFinite(run, 'junk dt');
  run.destroy();
  H.assert(audioLog.indexOf('engineStop') >= 0, 'engine stopped on destroy');
  const x = run.body.x;
  run.update(DT); run.render();
  H.assert(run.body.x === x, 'no updates after destroy');
  run.destroy();
});

H.test('real renderer + NaN-checking canvas: full frames draw collectibles, vehicle and effects', () => {
  let bad = 0, calls = 0;
  const base = H.createStubContext2D(null);
  const check = (v) => { if (typeof v === 'number' && !Number.isFinite(v)) bad++; };
  const ctx = new Proxy(base, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return (...a) => { calls++; a.forEach(check); if ((k === 'arc' || k === 'ellipse') && (a[2] < 0 || (k === 'ellipse' && a[3] < 0))) bad++; return v.apply(t, a); };
      return v;
    },
    set(t, k, v) { check(v); t[k] = v; return true; }
  });
  const canvas = H.createStubElement('canvas');
  canvas.getContext = () => ctx;
  const renderer = new RR.Renderer(canvas);
  renderer.resize();
  for (const w of ['green_valley', 'volcanic_ridge', 'neon_city']) {
    const run = newRun({ worldId: w, renderer });
    const C = run.collectibles, b = run.body;
    C.addCoin(b.x + 3, b.y + 1, 100, { falling: false });
    C.addCoin(b.x + 4, b.y + 3, 25, { falling: true, vx: 1, vy: 1 });
    C._placePickup(C.fuel, 'fuel', 'fuel', b.x + 5, b.y + 1);
    C._placePickup(C.fuel, 'fuel', 'cell', b.x + 7, b.y + 1);
    C._placePickup(C.fuel, 'fuel', 'mega', b.x + 9, b.y + 1);
    for (const type of RR.PowerUps.ORDER) C._placePickup(C.powerups, 'powerups', 'powerup', b.x + 11 + RR.PowerUps.ORDER.indexOf(type) * 1.5, b.y + 2, type);
    run.powerUps.activate('shield'); run.powerUps.activate('boost');
    for (let i = 0; i < 90; i++) { drive(run); run.update(DT); run.render(); }
    run.crash('head');
    for (let i = 0; i < 30; i++) { run.update(DT); run.render(); }
    run.destroy();
  }
  H.assert(calls > 5000, 'canvas calls ' + calls);
  H.assert(bad === 0, bad + ' non-finite / negative-radius canvas arguments');
});

// ================================================================== fix wave (gameplay cluster)
// gameplay-1: semi-fixed timestep — every frame simulates exactly its (time-scaled) dt in equal steps ≤ 1/120 s.
H.test('semi-fixed timestep: no carried remainder, h ≤ PHYS_DT, 60/120 Hz unchanged, smooth car at 75–165 Hz', () => {
  const PHYS = RR.CONST.PHYS_DT;
  const proto = RR.VehicleBody.prototype, orig = proto.step;
  let hs = [];
  proto.step = function (h, c, e) { hs.push(h); return orig.call(this, h, c, e); };
  try {
    for (const [hz, n] of [[60, 2], [120, 1], [75, 2], [90, 2], [144, 1], [165, 1]]) {
      const run = newRun({ seed: 99 });
      for (let f = 0; f < hz; f++) {
        hs = [];
        const sim0 = run.simTime;
        drive(run); run.fuel = run.fuelMax; run.update(1 / hz);
        H.assert(hs.length === n, hz + ' Hz: ' + hs.length + ' steps (want ' + n + ')');
        for (const h of hs) H.assert(h <= PHYS + 1e-12 && Math.abs(h - 1 / hz / n) < 1e-12, hz + ' Hz: step ' + h);
        H.assertClose(run.simTime - sim0, 1 / hz, 1e-12, hz + ' Hz: simTime advances by dt');
      }
      run.destroy();
    }
    // crash slow-mo at 60 Hz: one 0.005 s step every frame (the old accumulator alternated 0 / 1 steps)
    const run = newRun({ seed: 99 });
    frames(run, 2, drive);
    run.crash('head');
    for (let f = 0; f < 30; f++) { hs = []; run.update(DT); H.assert(hs.length === 1 && Math.abs(hs[0] - DT * 0.3) < 1e-12, 'slow-mo step ' + hs); }
    run.destroy();
  } finally {
    proto.step = orig;
  }
  // car screen x has no step judder at 144 Hz (p95 second difference < 1 px; was ~8 px)
  const run = newRun({ seed: 99 });
  const sx = [];
  for (let f = 0; f < 144 * 6; f++) {
    drive(run); run.fuel = run.fuelMax; run.update(1 / 144);
    if (f > 144 * 3) sx.push((run.body.x - run.camera.cx) * run.camera.zoom);
  }
  const d2 = [];
  for (let i = 2; i < sx.length; i++) d2.push(Math.abs(sx[i] - 2 * sx[i - 1] + sx[i - 2]));
  d2.sort((a, b) => a - b);
  const p95 = d2[Math.floor(d2.length * 0.95)];
  H.assert(p95 < 1, '144 Hz car screen-x p95 2nd difference ' + p95.toFixed(2) + ' px');
  run.destroy();
});

// gameplay-2: take-off cue for ordinary jumps / crest hops.
H.test('take-off cue: jump SFX + dust on ≥ 80% of real take-offs, ≤ 1 per 0.45 s, none from pads twice', () => {
  clearLogs();
  const plays = [];
  const play = RR.Audio.play;
  let run = null;
  RR.Audio.play = (n, o) => { if (n === 'jump' && run) plays.push({ t: run.simTime, o }); return play(n, o); };
  try {
    run = newRun({ seed: 11 });
    let air = false, groundT = 0, armed = false, p0 = 0, big = 0, covered = 0, lastAir = 0;
    for (let f = 0; f < 60 * 60 && !run.__ends.length; f++) {
      run._autopilot(); controls.throttle = run._apThr; controls.lean = run._apLean;
      run.fuel = run.fuelMax; run.invulnTime = 1;
      run.update(DT);
      const b = run.body, touch = b.grounded || b.bodyContact;
      if (touch) {
        if (air && armed && lastAir > 0.3) { big++; if (plays.length > p0) covered++; }
        air = false; groundT += DT;
      } else {
        if (!air) { armed = groundT >= 0.2; groundT = 0; p0 = plays.length; }
        air = true; lastAir = b.airTime;
      }
    }
    H.assert(big >= 10, 'enough take-offs (' + big + ')');
    H.assert(covered >= 0.8 * big, 'jump cue on ' + covered + '/' + big + ' take-offs with > 0.3 s air');
    for (let i = 1; i < plays.length; i++) H.assert(plays[i].t - plays[i - 1].t >= 0.45 - 1e-9, 'cue spacing ' + (plays[i].t - plays[i - 1].t).toFixed(3));
    for (const p of plays) H.assert(p.o && p.o.volume >= 0.35 && p.o.volume <= 1 && p.o.pitch >= 0.95 && p.o.pitch <= 1.15 + 1e-9, 'volume / pitch ' + JSON.stringify(p.o));
    H.assert(run.jumps === plays.length, 'run.jumps counts the cues');
    run.destroy();
    // a take-off right after a pad / ramp 'jump' (EventSystem.jumpSfxAt) stays single
    plays.length = 0;
    run = newRun({ seed: 11 });
    frames(run, 3, drive);
    run.body.setVelocity(run.body.vx, 7);
    run.body.setPose(run.body.x, run.body.y + 0.6, run.body.angle);
    run.events.jumpSfxAt = run.events.time;
    frames(run, 0.4, drive);
    H.assert(plays.length === 0, 'no second jump cue after a pad launch');
    run.destroy();
    // attract mode never plays it
    run = newRun({ mode: 'attract', seed: 11 });
    frames(run, 20);
    H.assert(plays.length === 0, 'attract mode is silent');
    run.destroy();
  } finally {
    RR.Audio.play = play;
  }
});

// gameplay-5: fuel zones never refill in the no-fuel daily (even if env.fuelZone were set).
H.test('no-fuel daily: fuel zone flag never refills (running or coasting)', () => {
  const ch = { id: 'no_fuel', day: '2026-09-24', worldId: 'green_valley', seed: 5,
    modifiers: { noFuelPickups: true, fuelEfficiencyMul: 0.35 }, targetDistance: 850 };
  const run = newRun({ mode: 'daily', daily: ch });
  frames(run, 1, drive);
  run.fuel = 50;
  run.env.fuelZone = true;
  run._updateFuel(DT, DT);
  H.assert(run.fuel < 50, 'no refill while running (' + run.fuel + ')');
  run.fuel = 0; run._outOfFuel();
  run.env.fuelZone = true;
  run._updateFuel(DT, DT);
  H.assert(run.fuel === 0 && run.state === 'nofuel', 'no refill while coasting');
  H.assert(run.events.forceEvent('fuel_zone') === false, 'EventSystem refuses the zone');
  run.destroy();
});

// gameplay-7: quitting during the crash slow-mo / out-of-fuel coast keeps the real reason.
H.test('quit: keeps the crash / fuel end reason; a live quit is "quit"', () => {
  let run = newRun();
  frames(run, 1, drive);
  run.crash('head');
  run.quit();
  H.assert(run.__ends.length === 1 && run.__ends[0].endReason === 'crash' && run.__ends[0].crashReason === 'head', 'crash kept: ' + JSON.stringify(run.__ends[0] && run.__ends[0].endReason));
  run.destroy();
  run = newRun();
  frames(run, 1, drive);
  run.fuel = 0;
  frames(run, DT, drive);
  H.assert(run.state === 'nofuel', 'coasting');
  H.assert(run.getSummary().endReason === 'fuel', 'live summary says fuel');
  run.quit();
  H.assert(run.__ends[0].endReason === 'fuel', 'fuel kept');
  run.destroy();
  run = newRun();
  frames(run, 1, drive);
  run.quit();
  H.assert(run.__ends[0].endReason === 'quit', 'plain quit');
  run.destroy();
});

// gameplay-8 / progression-1/2: the in-run banner agrees with Progression and the results screen.
H.test('records: whole metres; daily runs chase BEST TODAY (no permanent record); summary.dailyDay', () => {
  // fractional metres do not beat a whole-metre best
  clearLogs();
  let run = newRun();
  run.bestDistance = 150;
  frames(run, 1, drive);
  run.body.setPose(run.startX + 150.6, run.body.y, run.body.angle);
  run._updateDistance();
  H.assert(!run.newRecord && !hudLog.some((h) => h[1] === 'NEW RECORD!'), '150.6 m does not beat 150 m');
  run.body.setPose(run.startX + 151.02, run.body.y, run.body.angle);
  run._updateDistance();
  H.assert(run.newRecord && hudLog.filter((h) => h[1] === 'NEW RECORD!').length === 1, '151 m does');
  const s0 = run.getSummary();
  H.assert(s0.newRecord === true && s0.newDailyBest === false && s0.dailyDay === null, 'normal summary fields');
  H.assert(RR.Progression.computeRunRewards(Object.assign({}, s0, { distance: 151.02 })).newRecord ===
    (Math.floor(151.02) > Math.max(0, (RR.Save.data.bestDistances || {}).green_valley || 0)), 'progression agrees on whole metres');
  run.destroy();
  // daily: today's best is the reference, 'BEST TODAY!' + the mission sting, never summary.newRecord
  clearLogs();
  const ch = RR.Daily.getChallenge();
  const saveDaily = RR.Save.data.daily;
  const saveBest = Object.assign({}, RR.Save.data.bestDistances);
  RR.Save.data.bestDistances[ch.worldId] = 2000;
  RR.Save.data.daily = { day: ch.day, best: 120, attempts: 1, completed: false };
  try {
    run = newRun({ mode: 'daily', daily: ch });
    H.assert(run.bestDistance === 120 && run.bestLabel === 'BEST TODAY', 'daily reference = today\'s best (' + run.bestDistance + ')');
    for (let f = 0; f < 60 * 30 && run.distance < 200 && !run.__ends.length; f++) { drive(run); run.invulnTime = 1; run.fuel = run.fuelMax; run.update(DT); }
    H.assert(run.distance > 121, 'passed today\'s best');
    const banners = hudLog.filter((h) => h[0] === 'banner').map((h) => h[1]);
    H.assert(banners.indexOf('BEST TODAY!') >= 0 && banners.indexOf('NEW RECORD!') < 0, 'banners ' + JSON.stringify(banners));
    H.assert(audioLog.indexOf('mission') >= 0 && audioLog.indexOf('record') < 0, 'soft sting, no record fanfare');
    run.quit();
    const s = run.__ends[0];
    H.assert(s.newRecord === false && s.newDailyBest === true && s.dailyDay === ch.day && s.dailyId === ch.id, 'daily summary ' + JSON.stringify({ r: s.newRecord, d: s.newDailyBest, day: s.dailyDay }));
    const rw = RR.Progression.computeRunRewards(s);
    H.assert(!rw.newRecord && !rw.newWorldRecord, 'results show no world record either');
    run.destroy();
    // a stale challenge object (from before midnight) has no 'today' best to chase
    run = newRun({ mode: 'daily', daily: Object.assign({}, ch, { day: '1999-01-01' }) });
    H.assert(run.bestDistance === 0, 'stale challenge → no reference');
    run.destroy();
  } finally {
    RR.Save.data.daily = saveDaily;
    RR.Save.data.bestDistances = saveBest;
  }
});

// physics-1 fallback: sliding / standing on the hull past 75° below 10 m/s ends the run after 1.5 s.
H.test('tail / roof slide past 75° below 10 m/s counts as flipped after 1.5 s', () => {
  const run = newRun();
  frames(run, 1, drive);
  const T = run.terrain;
  let t = 0;
  // hold the body in a synthetic 80° nose-up, hull-contact, 6 m/s state (the physics limiter normally
  // prevents it; this is the safety net)
  const hold = () => {
    const b = run.body;
    b.bodyContact = true;
    b.angle = Math.atan(T.slopeAt(b.x)) + 1.4;
    b.vx = 6; b.vy = 0;
  };
  const step = RR.VehicleBody.prototype.step;
  run.body.step = function (h) { this.x += 6 * h; this.time = (this.time || 0) + h; };
  while (run.state === 'running' && t < 3) { hold(); run.update(DT); t += DT; }
  run.body.step = step;
  H.assert(run.state === 'crashed' && run.crashReason === 'flipped', 'flipped (' + run.state + ')');
  H.assert(t >= 1.45 && t <= 1.7, 'after ~1.5 s (' + t.toFixed(2) + ')');
  run.destroy();
});

// visuals-1 cross: 500 m of terrain kept behind the car.
H.test('terrain window keeps ~500 m behind the car', () => {
  const run = newRun({ seed: 5 });
  run.body.step = function (h) { this.x += 40 * h; this.y = run.terrain.heightAt(this.x) + 0.9; this.vx = 40; this.vy = 0; };
  for (let f = 0; f < 60 * 22; f++) { run.fuel = run.fuelMax; run.invulnTime = 1; run.update(DT); }
  const behind = run.body.x - run.terrain.minX;
  H.assert(run.body.x > 800 && behind >= 499 && behind <= 510, 'kept ' + behind.toFixed(1) + ' m behind at x=' + run.body.x.toFixed(0));
  run.destroy();
});

// terrain-1 cross: THE MOUNTAIN GIANT is a driving test, not a fuel check.
H.test('boss climbs: guaranteed full cans ≈ 30 m before the start and on the middle ledge', () => {
  for (const [wid, seed] of [['green_valley', 1], ['rocky_highlands', 2], ['snow_peaks', 3], ['storm_planet', 7]]) {
    const run = placementRun(wid, seed);
    grow(run, 3800);
    const T = run.terrain, C = run.collectibles;
    const sec = T.sections.find((s) => s.id === 'boss');
    H.assert(sec, wid + ' boss section');
    const B = sec.start;
    const approach = C.fuel.filter((f) => f.kind !== 'cell' && f.x >= B - 90 && f.x < B);
    H.assert(approach.length >= 1, wid + ' a can covers the last 90 m before the climb');
    H.assert(approach.some((f) => f.x >= B - 45 && f.x <= B - 12) || approach.some((f) => !f.boss), wid + ' approach can ≈ 30 m before');
    const ledges = Array.isArray(sec.ledges) && sec.ledges.length ? sec.ledges
      : T.features.filter((f) => f.type === 'plateau' && f.meta && f.meta.ledge && f.x >= B && f.x < sec.end);
    H.assert(ledges.length >= 2, wid + ' ledges');
    const mid = (B + sec.summitX) / 2;
    const climbCans = C.fuel.filter((f) => f.kind !== 'cell' && f.x > B && f.x < sec.summitX);
    H.assert(climbCans.length >= 1, wid + ' a can on the climb');
    H.assert(climbCans.some((f) => Math.abs(f.x - mid) < (sec.summitX - B) * 0.4), wid + ' can near the middle of the climb');
  }
  // none in the no-fuel daily
  const nf = placementRun('green_valley', 1, RR.Run.normalizeModifiers({ noFuelPickups: true }));
  grow(nf, 3800);
  H.assert(nf.collectibles.fuel.length === 0, 'no fuel at all under noFuelPickups');
});

H.test('performance: Run.update cost (node vm harness, informational bound)', () => {
  const run = newRun({ worldId: 'rocky_highlands' });
  frames(run, 2, drive);
  const t0 = process.hrtime.bigint();
  const n = 600;
  for (let i = 0; i < n && !run._ended; i++) { drive(run); run.update(DT); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  console.log('      Run.update ≈ ' + ms.toFixed(3) + ' ms/frame in the node harness (vm sandbox overhead included)');
  H.assert(ms < 6, 'update too slow: ' + ms);
  run.destroy();
});

H.test('no console errors from any module during the suite', () => {
  H.assert(consoleErrors.length === 0, consoleErrors.slice(0, 5).join('\n'));
});

H.done();
