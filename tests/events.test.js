/* RIDGE RUSH — RR.EventSystem tests.
 *
 *  - 10 simulated minutes of driving in every world (real RR.Terrain when available): events trigger,
 *    every hazard hit is preceded by a ≥ 1.5 s telegraph, hazards never overlap, env never NaN, pools
 *    bounded, section env effects apply and reset cleanly, boss reward exactly once per summit.
 *  - Deterministic scenarios on a mock terrain: sections/boss, every hazard forced onto a parked car,
 *    pads, ramps, coin events, fuel zone, invulnerability, attract mode, robustness.
 *
 *   node tests/events.test.js            (EVENTS_MINUTES=2 for a quicker pass)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const FILES = ['js/core/utils.js', 'js/data/worlds.js'];
const HAVE_TERRAIN = fs.existsSync(path.join(H.ROOT, 'js/game/terrain.js'));
const HAVE_PARTICLES = fs.existsSync(path.join(H.ROOT, 'js/game/particles.js'));
if (HAVE_TERRAIN) FILES.push('js/game/terrain.js');
if (HAVE_PARTICLES) FILES.push('js/game/particles.js');
FILES.push('js/game/events.js');
const RR = H.load(FILES);
const SANDBOX = RR.__ctx;
const U = RR.Util;
const ES = RR.EventSystem;
const MINUTES = Math.max(1, +process.env.EVENTS_MINUTES || 10);
const DT = 1 / 60;

// ------------------------------------------------------------------ spies installed in the sandbox
const consoleErrors = [];
SANDBOX.console = Object.assign({}, console, { error: (...a) => { consoleErrors.push(a.map(String).join(' ')); } });
const audioLog = { play: [], music: [] };
RR.Audio = { play: (n, o) => audioLog.play.push(n), music: (s) => audioLog.music.push(s) };
const missionLog = [];
RR.Missions = { track: (stat, v) => missionLog.push([stat, v]) };

// ------------------------------------------------------------------ mocks
const HULL = [{ x: -1.5, y: -0.16 }, { x: -1.05, y: -0.4 }, { x: 0.95, y: -0.4 }, { x: 1.72, y: -0.12 }, { x: 1.66, y: 0.12 },
  { x: 0.72, y: 0.3 }, { x: 0.25, y: 0.76 }, { x: -0.72, y: 0.78 }, { x: -1.42, y: 0.28 }];
const HEAD = { x: -0.18, y: 1.0, r: 0.22 };

function makeBody(terrain) {
  const b = {
    x: 5, y: 1, vx: 0, vy: 0, angle: 0, av: 0, mass: 240,
    tuned: { chassis: { mass: 240, hull: HULL, head: HEAD } },
    wheels: [{ x: 0, y: 0, radius: 0.42, grounded: true }, { x: 0, y: 0, radius: 0.42, grounded: true }],
    impulses: [],
    getHead(out) {
      out = out || {};
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      out.x = this.x + HEAD.x * c - HEAD.y * s;
      out.y = this.y + HEAD.x * s + HEAD.y * c;
      out.r = HEAD.r;
      return out;
    },
    applyImpulse(ix, iy, px, py) {
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) throw new Error('non-finite impulse');
      this.impulses.push({ ix, iy, px, py, t: b._clock ? b._clock() : 0 });
    },
    // place the car resting on the terrain at x (the mock does not simulate physics)
    placeAt(x) {
      this.x = x;
      const s = (terrain.heightAt(x + 0.5) - terrain.heightAt(x - 0.5));
      this.angle = Math.atan(s);
      this.y = terrain.heightAt(x) + 0.9;
      const c = Math.cos(this.angle), sn = Math.sin(this.angle);
      for (let i = 0; i < 2; i++) {
        const lx = i === 0 ? -1.02 : 1.08, ly = -0.5;
        const w = this.wheels[i];
        w.x = this.x + lx * c - ly * sn;
        w.y = terrain.heightAt(w.x) + w.radius;
        w.grounded = true;
      }
    }
  };
  return b;
}

function makeCamera(body) {
  return {
    zoom: 40, viewW: 1280, viewH: 720, cx: 0, cy: 0, shakes: 0,
    follow() { this.cx = body.x + 6; this.cy = body.y + 2; },
    bounds(out) {
      out = out || {};
      const hw = this.viewW / 2 / this.zoom, hh = this.viewH / 2 / this.zoom;
      out.left = this.cx - hw; out.right = this.cx + hw; out.bottom = this.cy - hh; out.top = this.cy + hh;
      return out;
    },
    worldToScreen(wx, wy, out) {
      out = out || {};
      out.x = this.viewW / 2 + (wx - this.cx) * this.zoom;
      out.y = this.viewH / 2 - (wy - this.cy) * this.zoom;
      return out;
    },
    shake() { this.shakes++; }
  };
}

// Mock terrain with explicit sections/features (deterministic scenarios).
function makeMockTerrain(opts) {
  opts = opts || {};
  const sections = opts.sections || [];
  const features = (opts.features || []).slice().sort((a, b) => a.x - b.x);
  const flat = !!opts.flat;
  const t = {
    minX: -60, maxX: 1e9, sections, features,
    heightAt(x) { return flat ? 0 : 2 * Math.sin(x / 40) + 0.5 * Math.sin(x / 9); },
    slopeAt(x) { return (this.heightAt(x + 0.25) - this.heightAt(x - 0.25)) / 0.5; },
    normalAt(x, out) { const s = this.slopeAt(x), l = Math.sqrt(1 + s * s); out = out || {}; out.x = -s / l; out.y = 1 / l; return out; },
    surfaceAt() { return RR.SURFACES.grass; },
    ceilingAt(x) { const s = this.sectionAt(x); return s && s.id === 'cave' ? this.heightAt(x) + 10 : null; },
    sectionAt(x) { for (const s of sections) if (x >= s.start && x < s.end) return s; return null; },
    difficultyAt(x) { return Math.min(1, Math.max(0, x / 6000)); },
    closestPoint(px, py, md, out) { out = out || {}; const h = this.heightAt(px); out.x = px; out.y = h; out.dist = Math.abs(py - h); out.inside = py < h; out.nx = 0; out.ny = 1; return out.dist <= md; },
    ensure() {}, trim() {}
  };
  return t;
}

function makeRun(worldId, opts) {
  opts = opts || {};
  const world = RR.Worlds.byId(worldId);
  const seed = opts.seed || 20260924;
  const root = U.makeRng(seed);
  const terrain = opts.terrain || (HAVE_TERRAIN ? new RR.Terrain({ seed, world, modifiers: null }) : makeMockTerrain());
  const body = makeBody(terrain);
  const log = { warns: [], announces: [], crashes: [], bonuses: [], coins: [] };
  const run = {
    world, worldId, mode: opts.mode || 'normal', state: 'running', time: 0, distance: 0,
    fuel: 100, fuelMax: 100, coins: 0, bonusCoins: 0, bossXp: 0, tokensEarned: 0, trickXp: 0,
    stats: { bossCleared: 0 }, boss: null, invulnTime: 0, modifiers: opts.modifiers || null,
    env: { gravity: 9.81 * world.gravity, gravityMul: 1, wind: 0, frictionMul: 1, darkness: 0, rain: 0, lightning: 0, tint: null, sectionId: null, fuelZone: false, timeScale: 1 },
    terrain, body, log,
    particles: HAVE_PARTICLES ? new RR.Particles(500) : null,
    camera: makeCamera(body),
    collectibles: {
      addCoin(x, y, value, o) {
        if (![x, y, value].every(Number.isFinite)) throw new Error('bad coin');
        log.coins.push({ x, y, value, falling: !!(o && o.falling), vx: o && o.vx, vy: o && o.vy, t: run.time, bodyX: body.x });
      }
    },
    rng: (name) => root.fork(name),
    warn(text, kind) { log.warns.push({ t: run.time, text, kind }); },
    announce(title, sub, kind) { log.announces.push({ t: run.time, title, sub, kind }); },
    crash(reason) {
      log.crashes.push({ t: run.time, reason, x: body.x });
      // behave like a shield rescue so the long simulation keeps going
      run.invulnTime = opts.invulnOnCrash === undefined ? 3 : opts.invulnOnCrash;
    },
    addBonus(coins, label) { log.bonuses.push({ t: run.time, coins, label }); run.bonusCoins += coins; }
  };
  body._clock = () => run.time;
  body.placeAt(5);
  run.camera.follow();
  if (HAVE_TERRAIN && terrain.ensure) terrain.ensure(400);
  run.events = new ES(run);
  return run;
}

function stepRun(run, dt, vx) {
  const b = run.body;
  run.time += dt;
  if (vx !== undefined) b.vx = vx;
  b.placeAt(b.x + b.vx * dt);
  run.invulnTime = Math.max(0, run.invulnTime - dt);
  if (run.terrain.ensure) run.terrain.ensure(b.x + 400);
  if (run.terrain.trim && Math.floor(run.time * 2) !== Math.floor((run.time - dt) * 2)) run.terrain.trim(b.x - 250);
  run.camera.follow();
  run.events.update(dt);
  if (run.particles) run.particles.update(dt, run.env);
}

function envOk(env) {
  const nums = ['wind', 'gravityMul', 'darkness', 'rain', 'lightning'];
  for (const k of nums) if (typeof env[k] !== 'number' || !Number.isFinite(env[k])) return 'env.' + k + '=' + env[k];
  if (env.tint !== null && typeof env.tint !== 'string') return 'tint';
  if (env.sectionId !== null && typeof env.sectionId !== 'string') return 'sectionId';
  if (typeof env.fuelZone !== 'boolean') return 'fuelZone';
  if (env.darkness < 0 || env.darkness > 0.95 || env.rain < 0 || env.rain > 1 || env.lightning < 0 || env.lightning > 1) return 'range';
  if (env.gravityMul < 0.2 || env.gravityMul > 1.5 || Math.abs(env.wind) > 20) return 'range2';
  return null;
}

const HAZARD_WARN = { rock: 'FALLING ROCKS!', meteor: 'METEOR SHOWER!', lava: 'LAVA ERUPTION!', drone: /DRONES? AHEAD!/ };
const stub = H.createStubContext2D({ width: 1280, height: 720 });

// ================================================================== long simulations, every world
console.log('RR.EventSystem — ' + MINUTES + ' simulated minute(s) per world' + (HAVE_TERRAIN ? ' (real RR.Terrain)' : ' (mock terrain)'));
const summary = [];
for (const world of RR.Worlds.list) {
  H.test(world.id + ': ' + MINUTES + ' min drive — events, fairness, overlap, env, sections, boss', () => {
    const run = makeRun(world.id, { seed: 777 + world.difficulty * 13 + world.id.length });
    const ev = run.events;
    const damages = [];
    ev.onDamage = (id, kind, since) => damages.push({ id, kind, since, t: run.time });
    const steps = Math.round(MINUTES * 60 / DT);
    const secEnv = {};          // per section: extreme env values seen once fully blended
    let quietFor = 0;           // seconds with no section & no wind gust active
    let maxActive = 0, bossSeen = [];
    const base = { wind: (world.wind.base || 0), darkness: world.darkness || 0 };
    for (let i = 0; i < steps; i++) {
      const vx = 15 + 5 * Math.sin(run.time * 0.05);
      stepRun(run, DT, vx);
      const env = run.env;
      const bad = envOk(env);
      H.assert(!bad, 'env invalid at t=' + run.time.toFixed(2) + ': ' + bad);
      let hz = 0;
      for (const rec of ev.active) if (rec.hazard) hz++;
      H.assert(hz <= 1, 'overlapping hazards at t=' + run.time.toFixed(1) + ': ' + ev.active.map((r) => r.id).join(','));
      maxActive = Math.max(maxActive, ev.active.length);
      H.assert(ev.active.length <= 3, 'too many active events');
      if (env.sectionId === 'boss') H.assert(ev.active.length === 0, 'event active during boss section: ' + ev.active.map((r) => r.id));
      if (run.boss && run.boss.active) H.assert(!ev.hazardActive(), 'hazard during boss');
      if (run.boss && bossSeen.indexOf(run.boss.summitX) < 0) bossSeen.push(run.boss.summitX);
      // section effects once blended in (blend keys ramp within ≤ 2.3 s)
      const sid = env.sectionId;
      if (sid) {
        const s = secEnv[sid] || (secEnv[sid] = { rain: 0, dark: 0, wind: 0, grav: 1, tint: null, n: 0 });
        s.n++;
        s.rain = Math.max(s.rain, env.rain); s.dark = Math.max(s.dark, env.darkness);
        s.wind = Math.max(s.wind, Math.abs(env.wind - ev.ambientWind())); s.grav = Math.min(s.grav, env.gravityMul);
        if (env.tint === 'rgba(255,80,20,0.12)') s.tint = env.tint;
      }
      const gust = ev.active.some((r) => r.id === 'wind_gust');
      quietFor = !sid && !gust && !env.fuelZone ? quietFor + DT : 0;
      if (quietFor > 3) {
        H.assertClose(env.wind, ev.ambientWind(), 1e-9, 'wind back to the ambient/base wind');
        H.assertClose(env.gravityMul, 1, 1e-9, 'gravityMul back to 1');
        H.assertClose(env.darkness, base.darkness, 1e-9, 'darkness back to base');
        H.assert(env.rain === 0 && env.tint === null, 'rain/tint cleared');
      }
      if (i % 20 === 0) { ev.drawWorld(stub, run); ev.drawScreen(stub, run); }
      if (run.particles) H.assert(run.particles.count <= run.particles.capacity, 'particles bounded');
    }
    H.assert(ev.rocks.length === 14 && ev.meteors.length === 8 && ev.markers.length === 24, 'pools fixed');
    const started = Object.keys(ev.stats.started);
    const total = started.reduce((a, k) => a + ev.stats.started[k], 0);
    H.assert(total >= Math.floor(MINUTES * 1.2), 'too few events: ' + total);
    const pool = world.events.slice();
    if (secEnv.volcano) pool.push('lava_eruption');
    for (const id of started) H.assert(pool.indexOf(id) >= 0, 'event ' + id + ' not in world pool');
    if (MINUTES >= 10) H.assert(started.length >= 3, 'variety: only ' + started.join(','));
    // fairness: engine-reported time since warning, and independent check against the warn log
    for (const d of damages) H.assert(d.since >= 1.5 - 1e-9, d.id + ' ' + d.kind + ' after only ' + d.since.toFixed(2) + ' s');
    for (const c of run.log.crashes) {
      const pat = HAZARD_WARN[c.reason];
      H.assert(pat, 'unexpected crash reason ' + c.reason);
      const w = run.log.warns.filter((x) => x.kind === 'hazard' && x.t <= c.t && (pat instanceof RegExp ? pat.test(x.text) : x.text === pat)).pop();
      H.assert(w && c.t - w.t >= 1.5 - 1e-9, c.reason + ' crash without ≥1.5 s telegraph');
    }
    for (const w of run.log.warns) H.assert(typeof w.text === 'string' && w.text.length > 0, 'warn text');
    // sections: effects applied
    if (secEnv.storm && secEnv.storm.n > 300) {
      H.assert(secEnv.storm.rain >= 0.999 && secEnv.storm.dark >= 0.35 && secEnv.storm.wind >= 4, 'storm effects ' + JSON.stringify(secEnv.storm));
    }
    if (secEnv.cave && secEnv.cave.n > 300) H.assert(secEnv.cave.dark >= 0.84, 'cave darkness ' + secEnv.cave.dark);
    if (secEnv.moon && secEnv.moon.n > 120) H.assertClose(secEnv.moon.grav, world.id === 'moon_base' ? 0.6 : 0.45, 1e-6, 'moon gravity');
    if (secEnv.volcano && secEnv.volcano.n > 120) H.assert(secEnv.volcano.tint === 'rgba(255,80,20,0.12)', 'volcano tint ' + secEnv.volcano.tint);
    // section banners: exactly one entry banner per section entered
    const secNames = run.log.announces.filter((a) => a.kind === 'section' && !/CLEARED/.test(a.title)).map((a) => a.title);
    for (const n of secNames) H.assert(/^THE /.test(n), 'section banner name ' + n);
    // boss: reward exactly once per summit passed
    const summits = bossSeen.filter((sx) => run.body.x >= sx);
    const rewards = run.log.bonuses.filter((b) => b.label === 'SUMMIT!');
    H.assert(rewards.length === summits.length, 'boss rewards ' + rewards.length + ' vs summits ' + summits.length);
    let tierSum = 0;
    for (const r of rewards) { H.assert(r.coins % 1500 === 0 && r.coins >= 1500, 'boss coins ' + r.coins); tierSum += r.coins / 1500; }
    H.assert(run.bossXp === 400 * tierSum && run.tokensEarned === rewards.length && run.stats.bossCleared === rewards.length, 'boss xp/tokens/stats');
    if (MINUTES >= 10) H.assert(summits.length >= 1, 'expected to clear at least one boss in 10 min (x=' + run.body.x.toFixed(0) + ')');
    H.assert(run.log.announces.filter((a) => a.kind === 'boss').length === bossSeen.length, 'one boss banner per boss');
    summary.push(world.id.padEnd(15) + ' x=' + run.body.x.toFixed(0).padStart(5) + ' m  events=' + String(total).padStart(2) +
      '  hits=' + damages.length + ' crashes=' + run.log.crashes.length + ' bosses=' + summits.length +
      '  sections=' + Object.keys(secEnv).join('/') + '  [' + started.map((k) => k + ':' + ev.stats.started[k]).join(' ') + ']');
  });
}

// ================================================================== attract mode
H.test('attract mode: no hazards, no crash, no HUD/audio calls, every world', () => {
  const playsBefore = audioLog.play.length, musicBefore = audioLog.music.length;
  for (const world of RR.Worlds.list) {
    const run = makeRun(world.id, { mode: 'attract', seed: 99 });
    const ev = run.events;
    for (let i = 0; i < Math.round(Math.min(MINUTES, 5) * 60 / DT); i++) {
      stepRun(run, DT, 16);
      H.assert(!ev.hazardActive(), 'hazard active in attract mode (' + world.id + ')');
      H.assert(!envOk(run.env) || false, 'env invalid');
      if (i % 30 === 0) { ev.drawWorld(stub, run); ev.drawScreen(stub, run); }
    }
    H.assert(run.log.crashes.length === 0, 'attract crashed');
    H.assert(run.log.warns.length === 0 && run.log.announces.length === 0, 'attract emitted HUD calls');
    H.assert(run.log.bonuses.length === 0, 'attract granted a bonus');
    for (const id of Object.keys(ev.stats.started)) H.assert(ES.HAZARDS.indexOf(id) < 0, 'hazard started in attract: ' + id);
  }
  H.assert(audioLog.play.length === playsBefore && audioLog.music.length === musicBefore, 'attract played audio');
});

// ================================================================== deterministic scenarios (mock terrain)
function sectionTerrain() {
  return makeMockTerrain({
    sections: [
      { id: 'storm', name: 'THE STORM', start: 400, end: 700 },
      { id: 'cave', name: 'THE CAVE', start: 900, end: 1200 },
      { id: 'volcano', name: 'THE VOLCANO', start: 1400, end: 1700 },
      { id: 'moon', name: 'THE MOON', start: 1900, end: 2200 },
      { id: 'canyon', name: 'THE CANYON', start: 2400, end: 2600 },
      { id: 'boss', name: 'BOSS RUN', start: 3000, end: 3400, summitX: 3350, tier: 2, bossName: 'THE TEST GIANT' }
    ]
  });
}

H.test('sections: banners, env blends, clean reset; boss progress, music, reward exactly once', () => {
  const run = makeRun('green_valley', { terrain: sectionTerrain(), seed: 5 });
  const ev = run.events;
  const musicStart = audioLog.music.length, missionStart = missionLog.length;
  const probe = {};
  const at = (x) => { while (run.body.x < x) stepRun(run, DT, 15); };
  // storm
  at(400 + 15 * 3);
  probe.storm = { rain: run.env.rain, dark: run.env.darkness, sid: run.env.sectionId };
  let maxWind = 0;
  while (run.body.x < 690) { stepRun(run, DT, 15); maxWind = Math.max(maxWind, Math.abs(run.env.wind)); }
  H.assert(probe.storm.sid === 'storm' && probe.storm.rain === 1 && probe.storm.dark >= 0.35, 'storm env ' + JSON.stringify(probe.storm));
  H.assert(maxWind >= 5 && maxWind <= 9.5, 'storm wind amplitude ' + maxWind.toFixed(2));
  at(700 + 15 * 3);
  H.assert(run.env.sectionId === null && run.env.rain === 0 && run.env.darkness === 0, 'storm cleared');
  // cave
  at(900 + 15 * 3);
  H.assert(run.env.sectionId === 'cave' && run.env.darkness >= 0.84 && run.env.darkness <= 0.86, 'cave darkness ' + run.env.darkness);
  at(1200 + 15 * 3);
  H.assert(run.env.darkness === 0, 'cave reset');
  // volcano
  at(1400 + 15 * 2);
  H.assert(run.env.tint === 'rgba(255,80,20,0.12)', 'volcano tint');
  at(1700 + 15 * 2);
  H.assert(run.env.tint === null, 'tint reset');
  // moon: smooth ~1 s transition
  at(1900 + 7.5);   // 0.5 s in
  const mid = run.env.gravityMul;
  H.assert(mid < 1 && mid > 0.45, 'moon transition is gradual: ' + mid);
  at(1900 + 15 * 1.2);
  H.assertClose(run.env.gravityMul, 0.45, 1e-9, 'moon gravity');
  at(2200 + 15 * 1.2);
  H.assertClose(run.env.gravityMul, 1, 1e-9, 'gravity reset');
  // canyon: banner only
  at(2450);
  H.assert(run.env.sectionId === 'canyon' && run.env.darkness === 0 && run.env.rain === 0 && run.env.gravityMul === 1, 'canyon banner only');
  const names = run.log.announces.filter((a) => a.kind === 'section' && !/CLEARED/.test(a.title)).map((a) => a.title);
  H.assert(JSON.stringify(names) === JSON.stringify(['THE STORM', 'THE CAVE', 'THE VOLCANO', 'THE MOON', 'THE CANYON']), 'section banners ' + names);
  H.assert(run.log.announces.filter((a) => /CLEARED/.test(a.title)).length === 4, 'section cleared banners');
  // boss
  at(2990);
  H.assert(run.boss === null, 'no boss yet');
  at(3001);
  const bossBanner = run.log.announces.filter((a) => a.kind === 'boss');
  H.assert(bossBanner.length === 1 && bossBanner[0].title === 'BOSS RUN' && bossBanner[0].sub === 'THE TEST GIANT — reach the summit!', 'boss banner');
  H.assert(run.boss && run.boss.active && run.boss.name === 'THE TEST GIANT' && run.boss.summitX === 3350 && run.boss.start === 3000, 'run.boss set');
  H.assert(audioLog.music.slice(musicStart).indexOf('boss') >= 0, 'boss music');
  H.assert(ev.forceEvent('coin_storm') === true && ev.active.length === 1, 'forceEvent works (dev)');
  let lastP = 0;
  while (run.body.x < 3340) {
    stepRun(run, DT, 15);
    H.assert(run.boss.progress >= lastP && run.boss.progress <= 1, 'progress monotonic');
    lastP = run.boss.progress;
    // scheduler never starts anything during the boss
    if (run.body.x > 3005) H.assert(ev.active.every((r) => r.id === 'coin_storm'), 'event started during boss');
  }
  H.assert(run.log.bonuses.length === 0, 'no reward before summit');
  at(3351);
  // roll back below the summit and cross it again: still exactly one reward
  for (let i = 0; i < 120; i++) stepRun(run, DT, -8);
  at(3360);
  H.assert(run.log.bonuses.length === 1 && run.log.bonuses[0].coins === 3000 && run.log.bonuses[0].label === 'SUMMIT!', 'boss bonus ' + JSON.stringify(run.log.bonuses));
  H.assert(run.bossXp === 800 && run.tokensEarned === 1 && run.stats.bossCleared === 1, 'boss xp/tokens/stats');
  H.assert(missionLog.slice(missionStart).filter((m) => m[0] === 'bossCleared' && m[1] === 1).length === 1, 'missions bossCleared tracked once');
  H.assert(run.boss.cleared && !run.boss.active && run.boss.progress === 1, 'boss marked cleared');
  const mus = audioLog.music.slice(musicStart);
  H.assert(mus[mus.length - 1] === 'valley', 'music restored to world style: ' + mus);
  at(3410);
  H.assert(run.boss === null, 'boss cleared from run after the section');
});

H.test('scheduler: first event only after 350 m; shield grace blocks hazards for 5 s', () => {
  const run = makeRun('storm_planet', { terrain: makeMockTerrain(), seed: 11 });
  const ev = run.events;
  while (run.body.x < 349) { stepRun(run, DT, 12); H.assert(ev.active.length === 0, 'event before 350 m'); }
  let firstAt = null;
  for (let i = 0; i < 60 * 30 && firstAt === null; i++) { stepRun(run, DT, 12); if (ev.active.length) firstAt = run.body.x; }
  H.assert(firstAt !== null && firstAt >= 350, 'first event after 350 m (' + firstAt + ')');
  // shield grace: repeatedly "rescue" the car; no hazard may START within 5 s of the last rescue
  const run2 = makeRun('storm_planet', { terrain: makeMockTerrain(), seed: 12 });
  run2.body.placeAt(400);
  let hazardsSeen = 0;
  for (let k = 0; k < 60; k++) {
    run2.invulnTime = 0.2;                 // just rescued
    const rescueAt = run2.time;
    for (let i = 0; i < Math.round(12 / DT); i++) {
      stepRun(run2, DT, 12);
      for (const rec of run2.events.active) {
        if (!rec.hazard || rec.warnedAt <= rescueAt) continue;   // started before the rescue: legit
        hazardsSeen++;
        H.assert(rec.warnedAt - rescueAt >= 5, 'hazard within 5 s of rescue');
      }
    }
  }
  H.assert(hazardsSeen > 0, 'hazards still happen after the grace period');
});

function forcedRun(worldId, extra) {
  const run = makeRun(worldId, Object.assign({ terrain: makeMockTerrain({ flat: extra && extra.flat, features: extra && extra.features }), seed: 3, invulnOnCrash: 0 }, extra || {}));
  run.body.placeAt(600);
  run.body.vx = 0;
  run.events.nextAt = Infinity;     // scheduler off: only the forced event runs
  return run;
}

H.test('falling rocks: warning + markers first, rocks hurt only after ≥ 1.5 s, bounded, despawn', () => {
  const run = forcedRun('rocky_highlands');
  const ev = run.events;
  const hits = [];
  ev.onDamage = (id, kind, since) => hits.push({ id, kind, since });
  H.assert(ev.forceEvent('falling_rocks'), 'forced');
  const rec = ev.active[0];
  H.assert(run.log.warns[0].text === 'FALLING ROCKS!' && run.log.warns[0].kind === 'hazard', 'warned');
  H.assert(audioLog.play[audioLog.play.length - 1] === 'warning', 'warning sound');
  H.assert(rec.drops.length >= 3 && rec.drops.length <= 6 && rec.drops.every((d) => d.r >= 0.4 && d.r <= 0.9 && d.marker && d.marker.active), 'drops + markers');
  // park the car right under the first impact marker
  run.body.placeAt(rec.drops[0].x);
  const t0 = run.time;
  let firstRockAt = null;
  for (let i = 0; i < 60 * 14; i++) {
    stepRun(run, DT, 0);
    if (firstRockAt === null && ev.rocks.some((r) => r.active)) firstRockAt = run.time - t0;
    for (const r of ev.rocks) if (r.active) H.assert(Number.isFinite(r.x) && Number.isFinite(r.y), 'rock NaN');
  }
  H.assert(firstRockAt >= 1.8 - 1e-6, 'rocks drop after 1.8 s telegraph (' + firstRockAt + ')');
  H.assert(hits.length >= 1, 'parked car was hit');
  for (const h of hits) H.assert(h.since >= 1.8 - 1e-6, 'hit too early');
  H.assert(ev.active.length === 0 && ev.rocks.every((r) => !r.active) && ev.markers.every((m) => !m.active), 'cleaned up');
  const crash = run.log.crashes[0];
  if (crash) H.assert(crash.reason === 'rock', 'reason rock');
  else H.assert(run.body.impulses.length >= 1, 'knock impulse');
});

H.test('meteor shower (Moon): telegraph, knock/crash only after ≥ 1.5 s, scorch craters', () => {
  const run = forcedRun('moon_base');
  const ev = run.events;
  const hits = [];
  ev.onDamage = (id, kind, since) => hits.push({ id, kind, since });
  H.assert(ev.forceEvent('meteor_shower'), 'forced');
  const rec = ev.active[0];
  H.assert(run.log.warns[0].text === 'METEOR SHOWER!', 'warned');
  run.body.placeAt(rec.shots[0].x + 0.5);
  for (let i = 0; i < 60 * 8; i++) stepRun(run, DT, 0);
  H.assert(hits.length >= 1, 'meteor hit parked car');
  for (const h of hits) H.assert(h.since >= 1.5, 'early');
  H.assert(ev.scorches.some((s) => s.active && s.kind === 'crater'), 'crater scorch');
  for (const c of run.log.crashes) H.assert(c.reason === 'meteor', 'reason');
  H.assert(ev.active.length === 0 && ev.meteors.every((m) => !m.active), 'cleanup');
});

H.test('lava eruption: 2 s bubbling crack, then geyser crashes a car inside the column (not outside)', () => {
  const run = forcedRun('volcanic_ridge', { flat: true });
  const ev = run.events;
  H.assert(ev.forceEvent('lava_eruption'), 'forced');
  const rec = ev.active[0];
  H.assert(run.log.warns[0].text === 'LAVA ERUPTION!', 'warned');
  run.body.placeAt(rec.x);
  const t0 = run.time;
  for (let i = 0; i < 60 * 6; i++) stepRun(run, DT, 0);
  H.assert(run.log.crashes.length === 1 && run.log.crashes[0].reason === 'lava', 'lava crash ' + JSON.stringify(run.log.crashes));
  H.assert(run.log.crashes[0].t - t0 >= 2.0 - 1e-6, 'eruption waited for the telegraph');
  H.assert(rec.H >= 8 && rec.H <= 12, 'geyser height');
  // car parked 6 m away: safe
  const run2 = forcedRun('volcanic_ridge', { flat: true });
  H.assert(run2.events.forceEvent('lava_eruption'), 'forced 2');
  run2.body.placeAt(run2.events.active[0].x - 6);
  for (let i = 0; i < 60 * 6; i++) stepRun(run2, DT, 0);
  H.assert(run2.log.crashes.length === 0, 'no crash outside column');
});

H.test('lava eruption avoids jump landing zones and lava pools', () => {
  const feats = [];
  for (let x = 600; x < 1000; x += 40) feats.push({ type: 'jump', x: x, x2: x + 6, y: 0, meta: { takeoffX: x + 6, landingX: x + 20, landingZoneX2: x + 30 } });
  const run = forcedRun('volcanic_ridge', { flat: true, features: feats });
  for (let k = 0; k < 20; k++) {
    const x = run.events._findEruptionPoint(false);
    if (!Number.isFinite(x)) continue;
    for (const f of feats) H.assert(!(x >= f.x - 5 && x <= f.meta.landingZoneX2 + 6), 'eruption in jump zone at ' + x);
  }
});

H.test('drones (Neon City): harmless for 1.6 s, head/hull hits afterwards, safe window exists', () => {
  const run = forcedRun('neon_city', { flat: true });
  const ev = run.events;
  const hits = [];
  ev.onDamage = (id, kind, since) => hits.push({ id, kind, since });
  H.assert(ev.forceEvent('drones'), 'forced');
  const rec = ev.active[0];
  H.assert(rec.drones.length >= 1 && rec.drones.length <= 3, 'drone count');
  H.assert(rec.drones[0].ax - run.body.x >= 70, 'drones start far ahead (visible from afar)');
  run.body.placeAt(rec.drones[0].ax);   // teleport under the first drone (dev-only situation)
  // sample the safe window: fraction of a period with the drone well above the head
  const d = rec.drones[0];
  let safe = 0, n = 0;
  const period = 2 * Math.PI / d.omega;
  for (let t = 0; t < period; t += 0.01) {
    const y = 3.4 + 2.0 * Math.sin(d.omega * t + d.phase);
    n++; if (y > 3.3) safe++;
  }
  H.assert(safe / n > 0.45 && period * safe / n >= 1.1, 'safe window ' + (period * safe / n).toFixed(2) + ' s');
  for (let i = 0; i < 60 * 6; i++) stepRun(run, DT, 0);
  H.assert(hits.length >= 1, 'drone hit the parked car');
  for (const h of hits) H.assert(h.since >= 1.6 - 1e-6, 'drone hurt before arming');
  for (const c of run.log.crashes) H.assert(c.reason === 'drone', 'reason drone');
});

H.test('lightning (Storm): rings then strike — knock + lose 10% fuel, never a crash', () => {
  const run = forcedRun('storm_planet');
  const ev = run.events;
  H.assert(ev.forceEvent('lightning'), 'forced');
  const rec = ev.active[0];
  run.body.placeAt(rec.strikes[0].x + 1);
  const t0 = run.time;
  let flashSeen = 0;
  for (let i = 0; i < 60 * 4; i++) { stepRun(run, DT, 0); flashSeen = Math.max(flashSeen, run.env.lightning); if (run.time - t0 < 1.79) H.assert(run.fuel === 100, 'fuel lost early'); }
  H.assert(run.log.crashes.length === 0, 'lightning never crashes');
  H.assert(Math.abs(run.fuel - 90) < 1e-9, 'fuel -10%: ' + run.fuel);
  H.assert(flashSeen > 0.9, 'env.lightning flash');
  H.assert(run.body.impulses.length === 1, 'one knock');
  H.assert(ev.active.length === 0, 'done');
});

H.test('wind gust: env untouched during 1.5–2 s telegraph, smooth gust on top of base, back to base', () => {
  const run = forcedRun('storm_planet');
  const ev = run.events;
  const base = RR.Worlds.byId('storm_planet').wind.base;
  H.assert(ev.forceEvent('wind_gust'), 'forced');
  const rec = ev.active[0];
  H.assert(rec.tele >= 1.5 && rec.tele <= 2 && rec.dur >= 3 && rec.dur <= 5, 'timings');
  const gust = RR.Worlds.byId('storm_planet').wind.gust;
  H.assert(rec.mag >= gust * 0.8 - 1e-9 && rec.mag <= gust * 1.4 + 1e-9, 'magnitude');
  // Storm Planet also has the ambient gust field: the event rides on top of ev.ambientWind()
  const gustPart = () => run.env.wind - ev.ambientWind();
  let prev = gustPart(), maxStep = 0, peak = 0, ambStep = 0, prevAmb = ev.ambientWind();
  const t0 = run.time;
  while (ev.active.length) {
    stepRun(run, DT, 0);
    if (run.time - t0 < rec.tele - 1e-6) H.assertClose(gustPart(), 0, 1e-9, 'wind during telegraph');
    maxStep = Math.max(maxStep, Math.abs(gustPart() - prev));
    peak = Math.max(peak, Math.abs(gustPart()));
    prev = gustPart();
    ambStep = Math.max(ambStep, Math.abs(ev.ambientWind() - prevAmb));
    prevAmb = ev.ambientWind();
  }
  H.assert(peak > rec.mag * 0.95, 'gust reached full strength');
  H.assert(maxStep < rec.mag * 0.06, 'smooth ramps (max step ' + maxStep.toFixed(3) + ')');
  H.assert(ambStep < 0.1, 'ambient wind is smooth too (max step ' + ambStep.toFixed(3) + ' m/s² per frame)');
  H.assertClose(gustPart(), 0, 1e-9, 'back to the ambient wind');
  // daily windMul scales the steady base wind of a world without an ambient field (windMul ≤ 1)
  const run2 = forcedRun('desert_canyon', { modifiers: { windMul: 0.5 } });
  stepRun(run2, DT, 0);
  H.assert(run2.events.ambAmp === 0, 'no ambient field');
  H.assertClose(run2.env.wind, RR.Worlds.byId('desert_canyon').wind.base * 0.5, 1e-9, 'windMul applied to base');
});

// gameplay-3: Storm Planet / Gale Force / Chaos really are windy; ordinary worlds keep their steady wind.
H.test('ambient wind: Storm Planet strong & gusty, Gale Force / Chaos felt, normal worlds unchanged', () => {
  const sample = (worldId, mods, seed) => {
    const run = forcedRun(worldId, mods ? { modifiers: mods, seed } : { seed });
    const ev = run.events, W = [];
    for (let t = 0; t < 600; t += 0.05) W.push(ev.ambientWind(t));
    return { ev, W };
  };
  const frac = (W, k) => W.filter((w) => Math.abs(w) > k).length / W.length;
  const mean = (W) => W.reduce((a, b) => a + b, 0) / W.length;
  let big = 0, m = 0, n = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { ev, W } = sample('storm_planet', null, seed);
    H.assertClose(ev.ambAmp, 6, 1e-9, 'storm planet amplitude');
    big += frac(W, 4); m += mean(W); n++;
    // swings between head- and tailwind within ~10-15 s
    let flips = 0;
    for (let i = 1; i < W.length; i++) if (Math.sign(W[i]) !== Math.sign(W[i - 1])) flips++;
    H.assert(flips >= 40, 'storm wind flips direction (' + flips + ' sign changes in 600 s)');
  }
  H.assert(big / n >= 0.25, 'storm planet |wind| > 4 on ' + (100 * big / n).toFixed(1) + '% of the time');
  H.assert(m / n >= -1 && m / n <= 0.3, 'storm planet mean wind ' + (m / n).toFixed(2) + ' in [-1, 0.3] (no free tailwind)');
  // Gale Force (windMul 2.5 on a world with no base wind) and Chaos (1.8)
  const gale = sample('green_valley', { windMul: 2.5 }, 9);
  H.assertClose(gale.ev.ambAmp, 7.25, 1e-9, 'gale force amplitude');
  H.assert(frac(gale.W, 2) >= 0.5, 'gale force |wind| > 2 on ' + (100 * frac(gale.W, 2)).toFixed(0) + '%');
  const chaos = sample('desert_canyon', { windMul: 1.8 }, 9);
  H.assertClose(chaos.ev.ambAmp, 4.8, 1e-9, 'chaos amplitude');
  H.assert(frac(chaos.W, 2) >= 0.35, 'chaos |wind| > 2 on ' + (100 * frac(chaos.W, 2)).toFixed(0) + '%');
  // ordinary worlds: no ambient field, steady base wind
  for (const id of ['green_valley', 'rocky_highlands', 'desert_canyon', 'snow_peaks', 'volcanic_ridge', 'moon_base', 'neon_city']) {
    const { ev, W } = sample(id, null, 3);
    H.assert(ev.ambAmp === 0, id + ' has no ambient field');
    const base = RR.Worlds.byId(id).wind.base || 0;
    H.assert(W.every((w) => w === base), id + ' keeps its steady base wind');
  }
});

H.test('coin storm, bird pouch, steep surprise, fuel zone: rewards are real and bounded', () => {
  // coin storm
  let run = forcedRun('green_valley');
  H.assert(run.events.forceEvent('coin_storm'), 'coin storm');
  for (let i = 0; i < 60 * 9; i++) stepRun(run, DT, 12);
  const storm = run.log.coins;
  H.assert(storm.length >= 30 && storm.length <= 48 && storm.every((c) => c.falling), 'coin storm coins ' + storm.length);
  H.assert(storm.every((c) => [5, 25, 100].indexOf(c.value) >= 0), 'denominations');
  H.assert(run.log.warns[0].text === 'COIN STORM!', 'coin storm warn');
  // bird
  run = forcedRun('green_valley');
  H.assert(run.events.forceEvent('bird'), 'bird');
  H.assert(run.log.warns[0].text === 'EAGLE SPOTTED!', 'eagle warn');
  for (let i = 0; i < 60 * 20 && run.events.active.length; i++) stepRun(run, DT, 10);
  H.assert(run.log.coins.length >= 8 && run.log.coins.length <= 12 && run.log.coins.every((c) => c.falling && c.x > c.bodyX + 5), 'bird coins ahead: ' + run.log.coins.length);
  H.assert(run.events.active.length === 0, 'bird left');
  // steep surprise
  const feats = [{ type: 'steep', x: 760, x2: 800, y: 0, meta: { dir: 1, maxSlope: 0.9, rise: 30 } }];
  run = forcedRun('green_valley', { features: feats });
  H.assert(run.events.forceEvent('steep_surprise'), 'steep');
  H.assert(run.log.warns[0].text === 'STEEP CLIMB AHEAD!', 'steep warn');
  H.assert(run.log.coins.length === 7 && run.log.coins.every((c) => c.x > 797 && c.x < 812 && !c.falling), 'crest coin arc');
  const run3 = forcedRun('green_valley', { features: [{ type: 'steep', x: 1000, x2: 1040, y: 0, meta: { dir: 1 } }] });
  H.assert(run3.events.forceEvent('steep_surprise') === false, 'no steep feature 120–250 m ahead → not available');
  // fuel zone
  run = forcedRun('green_valley');
  H.assert(run.events.forceEvent('fuel_zone'), 'fuel zone');
  const z = run.events.active[0];
  H.assert(z.x1 - z.x0 === 160, 'zone length');
  let inside = 0, outsideTrue = 0;
  for (let i = 0; i < 60 * 40 && run.events.active.length; i++) {
    stepRun(run, DT, 12);
    const want = run.body.x >= z.x0 && run.body.x <= z.x1;
    if (want) inside += run.env.fuelZone ? 1 : 0;
    else if (run.env.fuelZone) outsideTrue++;
  }
  H.assert(inside > 60 * 10 && outsideTrue === 0, 'fuelZone flag only inside (' + inside + ',' + outsideTrue + ')');
  H.assert(run.env.fuelZone === false, 'zone ended');
});

H.test('moving ramp + bounce/boost pads push the car (upward / forward)', () => {
  // moving ramp on a flat stretch
  let run = forcedRun('neon_city', { flat: true });
  H.assert(run.events.forceEvent('moving_ramp'), 'ramp');
  const rec = run.events.active[0];
  H.assert(run.log.warns[0].text === 'MOVING RAMP AHEAD', 'ramp warn');
  let minRx = Infinity, maxRx = -Infinity;
  for (let i = 0; i < 60 * 8; i++) { stepRun(run, DT, 0); minRx = Math.min(minRx, rec.rx); maxRx = Math.max(maxRx, rec.rx); }
  H.assert(maxRx - minRx > 10 && minRx >= rec.a - 1e-9 && maxRx + rec.len <= rec.b + 1e-9, 'ramp slides within its rail');
  run.body.placeAt(rec.rx + rec.len * 0.5 + 1.02);   // rear wheel on the wedge
  run.body.wheels[0].x = rec.rx + rec.len * 0.5;
  run.body.wheels[0].y = 0.42;
  run.events._update(DT);
  const imp = run.body.impulses[run.body.impulses.length - 1];
  H.assert(imp && imp.iy > 240 * 5 && imp.ix > 0, 'springboard impulse ' + JSON.stringify(imp));
  H.assert(run.log.coins.length >= 1, 'ramp coin reward');
  // pads
  const pads = [{ type: 'bouncepad', x: 700, x2: 704, y: 0, meta: { power: 1.2, length: 4 } },
    { type: 'boostpad', x: 800, x2: 806, y: 0, meta: { power: 1.1, length: 6 } }];
  run = forcedRun('neon_city', { flat: true, features: pads });
  run.body.placeAt(690);
  let up = 0, fwd = 0;
  while (run.body.x < 830) {
    const n0 = run.body.impulses.length;
    stepRun(run, DT, 10);
    for (let k = n0; k < run.body.impulses.length; k++) {
      const im = run.body.impulses[k];
      if (im.iy > 240 * 5) up++;
      if (run.body.x > 795 && im.ix > 0) fwd++;
    }
  }
  H.assert(up >= 1 && up <= 3, 'bouncepad launch (' + up + ')');
  H.assert(fwd >= 30, 'boostpad push ~1 s (' + fwd + ' frames)');
});

H.test('invulnerability (shield rescue): hazards cannot damage while run.invulnTime > 0', () => {
  const run = forcedRun('volcanic_ridge', { flat: true });
  H.assert(run.events.forceEvent('lava_eruption'), 'forced');
  run.body.placeAt(run.events.active[0].x);
  for (let i = 0; i < 60 * 6; i++) { run.invulnTime = 1; stepRun(run, DT, 0); }
  H.assert(run.log.crashes.length === 0 && run.body.impulses.length === 0, 'no damage while invulnerable');
});

H.test('robustness: missing modules, NaN body, draw without camera, reset()', () => {
  const minimal = { world: RR.Worlds.byId('green_valley') };
  const ev = new ES(minimal);
  ev.update(0.016); ev.update(NaN); ev.update(-1); ev.update(1e9);
  ev.drawWorld(stub, minimal); ev.drawScreen(stub, minimal);
  H.assert(!envOk(minimal.env), 'env written for minimal run');
  const run = makeRun('neon_city', { terrain: makeMockTerrain({ flat: true }), seed: 8 });
  run.particles = null; run.collectibles = null; run.camera = null;
  run.body.placeAt(600);
  for (const id of ES.EVENT_IDS) run.events.forceEvent(id);
  for (let i = 0; i < 300; i++) { stepRun2(run); run.events.drawWorld(stub, run); run.events.drawScreen(stub, run); }
  run.body.x = NaN;
  run.events.update(DT);
  H.assert(!envOk(run.env), 'env valid after NaN body');
  run.body.placeAt(620);
  run.events.reset();
  H.assert(run.events.active.length === 0 && run.env.wind === 0 && run.env.fuelZone === false, 'reset');
  H.assert(consoleErrors.length === 0, 'no swallowed errors: ' + consoleErrors[0]);
  function stepRun2(r) { r.time += DT; r.body.placeAt(r.body.x + 5 * DT); r.events.update(DT); }
});

// gameplay-4: coasting over the summit with an empty tank still clears the boss; a crash does not.
H.test('boss summit pays out when coasting over it out of fuel (state nofuel), not when crashed', () => {
  for (const [state, pays] of [['nofuel', true], ['crashed', false], ['ended', false]]) {
    const run = makeRun('green_valley', { terrain: sectionTerrain(), seed: 5 });
    run.events.nextAt = Infinity;
    run.body.placeAt(2990);
    for (let i = 0; i < 120; i++) stepRun(run, DT, 10);
    H.assert(run.boss && run.boss.active, state + ': boss active');
    run.state = state;
    for (let i = 0; i < 60 * 40 && run.body.x < 3360; i++) stepRun(run, DT, 9);
    const paid = run.log.bonuses.filter((b) => b.label === 'SUMMIT!');
    if (pays) {
      H.assert(paid.length === 1 && paid[0].coins === 3000, state + ': summit bonus ' + JSON.stringify(paid));
      H.assert(run.tokensEarned === 1 && run.bossXp === 800 && run.stats.bossCleared === 1 && run.boss.cleared, state + ': token / xp / stats');
    } else {
      H.assert(paid.length === 0 && run.tokensEarned === 0 && run.bossXp === 0, state + ': nothing paid');
    }
  }
});

// verifier: Storm Planet's ambient gusts flipped upgraded cars over backwards on the boss headwall (a wind
// lottery, not a climb) — they are eased down to 40 % on an uncleared boss climb and come back after it.
H.test('ambient gusts are damped on an uncleared boss climb and restored after the summit', () => {
  const run = makeRun('storm_planet', { terrain: sectionTerrain(), seed: 5 });
  run.events.nextAt = Infinity;
  const ev = run.events;
  H.assert(ev.ambAmp > 0 && ev.ambBossMul === 1, 'full ambient field before the boss');
  run.body.placeAt(2990);
  for (let i = 0; i < 60 * 4; i++) stepRun(run, DT, 10);
  H.assert(run.boss && run.boss.active, 'boss climb active');
  H.assert(ev.ambBossMul < 0.42 && ev.ambBossMul >= 0.4, 'eased to 40 %: ' + ev.ambBossMul.toFixed(3));
  // the gust swing is k × the free field's (same seed → same phase in a run without a boss)
  const k = ev.ambBossMul, base = RR.Worlds.byId('storm_planet').wind.base * 0.3;
  const ref = makeRun('storm_planet', { terrain: sectionTerrain(), seed: 5 }).events;
  H.assert(ref.ambBossMul === 1 && ref.ambPhase === ev.ambPhase, 'reference field');
  let worst = 0, free = 0;
  for (let s = 0; s < 600; s += 0.25) {
    worst = Math.max(worst, Math.abs((ev.ambientWind(s) - base) - k * (ref.ambientWind(s) - base)));
    free = Math.max(free, Math.abs(ref.ambientWind(s) - base));
  }
  H.assert(worst < 1e-9 && free > 5, 'damped field = ' + k.toFixed(3) + ' × free field (free swing ' + free.toFixed(1) + ' m/s²)');
  H.assertClose(run.env.wind, ev.ambientWind(), 1e-9, 'env.wind follows the damped ambient wind');
  // over the summit: the field eases back to full strength
  for (let i = 0; i < 60 * 60 && !(run.boss && run.boss.cleared); i++) stepRun(run, DT, 10);
  H.assert(run.boss && run.boss.cleared, 'summit cleared');
  for (let i = 0; i < 60 * 5; i++) stepRun(run, DT, 10);
  H.assert(ev.ambBossMul > 0.99, 'restored after the summit: ' + ev.ambBossMul.toFixed(3));
  // worlds without an ambient field never touch it
  const calm = makeRun('green_valley', { terrain: sectionTerrain(), seed: 5 });
  calm.events.nextAt = Infinity;
  calm.body.placeAt(2990);
  for (let i = 0; i < 60 * 4; i++) stepRun(calm, DT, 10);
  H.assert(calm.events.ambBossMul === 1, 'no ambient field → untouched');
});

// gameplay-5: the 'Last Drop' daily has no fuel pickups — no refill zones either.
H.test('fuel bonus zone never appears under modifiers.noFuelPickups', () => {
  const run = forcedRun('green_valley', { modifiers: { noFuelPickups: true } });
  H.assert(run.events.forceEvent('fuel_zone') === false, 'forceEvent refused');
  run.fuel = 5;                                   // low fuel would otherwise boost its weight ×2.4
  for (let k = 0; k < 300; k++) H.assert(run.events._pick() !== 'fuel_zone', 'scheduler picked a fuel zone');
  const normal = forcedRun('green_valley');
  H.assert(normal.events.forceEvent('fuel_zone') === true, 'normal runs still get zones');
});

// gameplay-6: eruptions / meteor showers are aimed so a car that HOLDS its speed is never caught;
// braking into the eruption (or surging) still gets you burnt.
function steadyHazardTrials(hz, worldId, v, n, speedAfter) {
  const run = makeRun(worldId, { seed: 4242 + v * 7, invulnOnCrash: 0 });
  const ev = run.events;
  ev.nextAt = Infinity;
  let hit = null, events = 0, crashed = 0, knocked = 0, guard = 0;
  ev.onDamage = (id, kind) => { if (id === hz) hit = kind === 'crash' ? 'crash' : (hit || 'knock'); };
  run.body.placeAt(420);
  while (events < n && guard++ < n * 4) {
    for (let i = 0; i < 30; i++) stepRun(run, DT, v);
    if (!ev.forceEvent(hz)) continue;
    hit = null;
    const vv = speedAfter === undefined ? v : speedAfter;
    for (let i = 0; i < 60 * 7 && ev.active.length; i++) stepRun(run, DT, vv);
    ev._cancelAll && ev._cancelAll();
    ev.active.length = 0;
    events++;
    if (hit === 'crash') crashed++; else if (hit === 'knock') knocked++;
  }
  return { events, crashed, knocked };
}
H.test('lava eruption / meteor shower: steady-speed cars at 10/15/20 m/s survive ≥ 90% (50 each)', () => {
  for (const [hz, world] of [['lava_eruption', 'volcanic_ridge'], ['meteor_shower', 'moon_base']]) {
    for (const v of [10, 15, 20]) {
      const r = steadyHazardTrials(hz, world, v, 50);
      H.assert(r.events === 50, hz + ' forced ' + r.events + '/50');
      H.assert(r.crashed <= 5, hz + ' at ' + v + ' m/s crashed a steady car ' + r.crashed + '/50');
      summary.push('  ' + hz + ' @' + v + ' m/s steady: crash ' + r.crashed + ', knock ' + r.knocked + ' / 50');
    }
  }
  // still a hazard for a car that changes speed: halving speed at the warning, or surging 1.6×
  const slow = steadyHazardTrials('lava_eruption', 'volcanic_ridge', 20, 30, 10);
  const surge = steadyHazardTrials('lava_eruption', 'volcanic_ridge', 10, 30, 16);
  H.assert(slow.crashed >= 5 && surge.crashed >= 5, 'lava must still catch speed changes (slow ' + slow.crashed + ', surge ' + surge.crashed + ' of 30)');
});

H.test('lava marker: a vent inside 60 m is drawn pulled in from the edge at its ground height', () => {
  let tested = 0;
  for (let k = 0; k < 16 && !tested; k++) {
    const run = forcedRun('volcanic_ridge', { flat: true, seed: 3 + k });
    run.renderer = { w: 1280, h: 720 };
    run.body.vx = 18;
    H.assert(run.events.forceEvent('lava_eruption'), 'forced');
    const rec = run.events.active[0];
    const d = rec.x - run.body.x;
    H.assert(d >= 22, 'vent ≥ 22 m ahead (' + d.toFixed(1) + ')');
    if (d >= 60) continue;                       // an 'after' plan vent: far off, ordinary edge arrow
    const calls = [];
    const ctx = H.createStubContext2D({ width: 1280, height: 720 });
    const tr = ctx.translate;
    ctx.translate = (x, y) => { calls.push([x, y]); if (tr) tr.call(ctx, x, y); };
    run.camera.worldToScreen = (x, y, out) => { out.x = 450 + (x - run.body.x) * 50; out.y = 520 - (y - run.body.y) * 50; return out; };
    run.events.drawScreen(ctx, run);
    const at = calls.find((c) => Math.abs(c[0] - (1280 - 40)) < 1e-6);
    H.assert(at, 'edge arrow at W − 40: ' + JSON.stringify(calls));
    H.assertClose(at[1], Math.min(720 - 40, Math.max(60, 520 - (rec.y - run.body.y) * 50)), 1e-6, 'arrow at the vent ground height');
    tested++;
  }
  H.assert(tested === 1, 'found a near vent to test');
});

// gameplay-9: 'sudden steep terrain' scans the real ground ahead, not only 'steep' features.
H.test('steep surprise: finds a scanned climb window 60–250 m ahead, marks its base, uses requestFeature', () => {
  const terrain = makeMockTerrain({ flat: true });
  terrain.heightAt = (x) => (x < 740 ? 0 : x < 770 ? (x - 740) * 0.6 : 18);     // a 0.6 ramp 140 m ahead
  terrain.slopeAt = (x) => (x >= 740 && x < 770 ? 0.6 : 0);
  const run = makeRun('green_valley', { terrain, seed: 3 });
  run.body.placeAt(600);
  run.events.nextAt = Infinity;
  H.assert(run.events.forceEvent('steep_surprise'), 'available from the terrain scan');
  const rec = run.events.active[0];
  H.assert(Math.abs(rec.x - 740) <= 1 && rec.x2 >= 750, 'window base at the climb (' + rec.x + '..' + rec.x2 + ')');
  // nothing steep ahead, but the terrain offers the optional hook → a requested wall is announced
  const flatT = makeMockTerrain({ flat: true });
  let asked = null;
  flatT.requestFeature = (type, xMin) => { asked = [type, xMin]; return { type: 'steep', x: xMin + 30, x2: xMin + 45, y: 0, meta: { dir: 1 } }; };
  const run2 = makeRun('green_valley', { terrain: flatT, seed: 3 });
  run2.body.placeAt(600);
  run2.events.nextAt = Infinity;
  H.assert(run2.events.forceEvent('steep_surprise'), 'available through requestFeature');
  H.assert(asked && asked[0] === 'steep' && asked[1] >= 600 + 60, 'requested ' + JSON.stringify(asked));
  const run3 = makeRun('green_valley', { terrain: makeMockTerrain({ flat: true }), seed: 3 });
  run3.body.placeAt(600);
  H.assert(run3.events.forceEvent('steep_surprise') === false, 'flat ground and no hook → not available');
});

H.test('pad / ramp jump SFX are timestamped for the Run take-off cue', () => {
  const run = forcedRun('neon_city', { flat: true });
  const ev = run.events;
  H.assert(ev.jumpSfxAt === -Infinity, 'initially never');
  H.assert(ev.forceEvent('moving_ramp'), 'ramp');
  const rec = ev.active[0];
  run.body.placeAt(rec.rx + rec.len * 0.5 + 1.02);
  run.body.wheels[0].x = rec.rx + rec.len * 0.5;
  run.body.wheels[0].y = 0.42;
  stepRun(run, DT);
  ev._update(DT);
  H.assert(ev.jumpSfxAt > 0 && ev.time - ev.jumpSfxAt < 0.1, 'jumpSfxAt set on launch (' + ev.jumpSfxAt + ')');
});

H.test('performance: 10k updates with events active stay cheap', () => {
  const run = makeRun('volcanic_ridge', { terrain: makeMockTerrain(), seed: 21 });
  run.body.placeAt(600);
  const t0 = Date.now();
  for (let i = 0; i < 10000; i++) {
    if (i % 600 === 0) { run.events.nextAt = 0; }
    stepRun(run, DT, 14);
    if (i % 2 === 0) { run.events.drawWorld(stub, run); run.events.drawScreen(stub, run); }
  }
  const ms = Date.now() - t0;
  H.assert(ms < 4000, '10k frames took ' + ms + ' ms');
});

H.test('no errors were swallowed by the event system', () => {
  H.assert(consoleErrors.length === 0, 'console errors: ' + consoleErrors.slice(0, 3).join(' | '));
});
console.log('\n' + summary.join('\n'));
H.done();
