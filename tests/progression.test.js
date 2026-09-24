/* RIDGE RUSH — tests for RR.Save, RR.MissionTemplates, RR.Progression, RR.Missions and RR.Daily.
 * Run: node tests/progression.test.js
 * Uses the real js/data/vehicles.js when present; otherwise a contract-accurate mock of RR.Vehicles
 * is injected into the sandbox (this file only). */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const KEY = 'ridgeRush.save.v1';
const BAK = 'ridgeRush.save.v1.bak';
const CATS = ['engine', 'suspension', 'tires', 'fuel', 'grip', 'air', 'brakes'];
const HAS_VEHICLES = fs.existsSync(path.join(H.ROOT, 'js/data/vehicles.js'));

// Contract-accurate RR.Vehicles mock (only used if the physics owner's file is absent).
const VEHICLE_MOCK = `
(function () {
  const RR = window.RR;
  const CAT_MULT = { engine: 1.2, suspension: 0.9, tires: 0.8, fuel: 0.85, grip: 0.9, air: 0.7, brakes: 0.6 };
  const mk = (id, name, level, coins, tokens, base) => ({ id, name, unlock: { level, coins, tokens },
    upgradeBaseCost: base, colors: { body: '#111111', accent: '#222222', trim: '#333333', wheel: '#444444', rim: '#555555' } });
  const list = [mk('trail_buggy', 'Trail Buggy', 1, 0, 0, 120), mk('dirt_runner', 'Dirt Runner', 2, 2500, 1, 150),
    mk('mountain_truck', 'Mountain Truck', 4, 7500, 2, 200), mk('rally_beast', 'Rally Beast', 7, 15000, 3, 260),
    mk('rock_crawler', 'Rock Crawler', 10, 25000, 4, 300), mk('storm_runner', 'Storm Runner', 14, 45000, 6, 420)];
  const byId = (id) => list.find((v) => v.id === id) || null;
  RR.Vehicles = { list, byId, CAT_MULT, MAX_UPGRADE_LEVEL: 10,
    UPGRADE_CATEGORIES: ['engine','suspension','tires','fuel','grip','air','brakes'].map((id) => ({ id, name: id.toUpperCase(), desc: '' })),
    upgradeCost(vid, cat, lv) { const d = byId(vid); if (!d || !(cat in CAT_MULT)) return Infinity; if (lv >= 10) return Infinity;
      return Math.round(d.upgradeBaseCost * CAT_MULT[cat] * Math.pow(1.55, lv - 1) / 10) * 10; } };
})();`;

const PRE = ['js/core/utils.js', 'js/core/save.js'];
const POST = ['js/data/worlds.js', 'js/data/missions.js', 'js/systems/progression.js', 'js/systems/missions.js', 'js/systems/daily.js'];

// Fresh sandbox. opts.store: initial localStorage contents; opts.setup(ctx): tweak before scripts load.
function fresh(opts) {
  opts = opts || {};
  const ctx = H.createContext();
  if (opts.store) for (const k of Object.keys(opts.store)) ctx.localStorage.setItem(k, opts.store[k]);
  if (opts.setup) opts.setup(ctx);
  H.load(PRE, ctx);
  if (HAS_VEHICLES) H.load(['js/data/vehicles.js'], ctx);
  else require('vm').runInContext(VEHICLE_MOCK, ctx);
  H.load(POST, ctx);
  const RR = ctx.RR;
  RR.__ctx = ctx;
  if (opts.load !== false) RR.Save.load();
  return RR;
}
const stored = (RR, k) => RR.__ctx.localStorage._store[k];
const events = (RR, names) => {
  const log = [];
  for (const n of names) RR.Bus.on(n, (p) => log.push({ n, p }));
  return log;
};
const date = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Give the player enough XP to be exactly at `level`.
const setLevel = (RR, level) => { RR.Progression.addXp(RR.Progression.xpToReachLevel(level) - RR.Save.data.xp); };

console.log('Save');

H.test('fresh defaults match the contract shape', () => {
  const RR = fresh();
  const d = RR.Save.data;
  H.assert(!RR.Save.recovered, 'not recovered');
  H.assert(d.version === 1 && d.coins === 0 && d.tokens === 0 && d.xp === 0 && d.level === 1, 'numbers');
  H.assert(d.selectedVehicle === 'trail_buggy' && d.selectedWorld === 'green_valley', 'selection');
  H.assert(deepEq(d.unlockedVehicles, ['trail_buggy']) && deepEq(d.unlockedWorlds, ['green_valley']), 'unlocks');
  H.assert(deepEq(d.upgrades, { trail_buggy: { engine: 1, suspension: 1, tires: 1, fuel: 1, grip: 1, air: 1, brakes: 1 } }), 'upgrades');
  H.assert(deepEq(d.bestDistances, {}) && d.bestDistance === 0, 'bests');
  const statKeys = ['runs', 'totalDistance', 'coinsCollected', 'backflips', 'frontflips', 'doubleFlips', 'perfectLandings',
    'fuelCollected', 'powerups', 'crashes', 'bossesCleared', 'maxCombo', 'longestAir', 'missionsCompleted', 'dailyCompleted', 'playTime'];
  H.assert(deepEq(Object.keys(d.stats).sort(), statKeys.slice().sort()), 'stat keys');
  H.assert(Object.values(d.stats).every((v) => v === 0), 'stats zero');
  H.assert(deepEq(d.missions, { day: '', active: [], bonusClaimed: false }), 'missions');
  H.assert(deepEq(d.daily, { day: '', best: 0, attempts: 0, completed: false }), 'daily');
  H.assert(deepEq(d.cosmetics, { unlocked: ['paint_factory'], selected: {} }), 'cosmetics');
  H.assert(deepEq(d.settings, { sound: true, music: true, quality: 'high', sensitivity: 1, reducedMotion: false, showFps: false, touchControls: 'auto' }), 'settings');
  H.assert(d.seenTutorial === false, 'tutorial');
  H.assert(deepEq(RR.Save.defaults(), JSON.parse(JSON.stringify(d))), 'defaults() equals loaded fresh data');
  H.assert(RR.Save.defaults() !== RR.Save.defaults(), 'defaults() returns fresh objects');
});

H.test('corrupted JSON → defaults + recovered flag', () => {
  for (const bad of ['{"coins": 50', 'not json at all', '42', '[]', 'null', '"str"']) {
    const RR = fresh({ store: { [KEY]: bad } });
    H.assert(RR.Save.recovered === true, 'recovered for ' + bad);
    H.assert(!RR.Save.restoredFromBackup, 'no backup');
    H.assert(RR.Save.data.coins === 0 && RR.Save.data.level === 1, 'defaults for ' + bad);
  }
});

H.test('corrupted primary → restores the backup key and repairs the primary', () => {
  const good = fresh();
  good.Progression.addCoins(4321);
  const bak = stored(good, BAK);
  H.assert(typeof bak === 'string' && JSON.parse(bak).coins === 4321, 'backup written on save');
  const RR = fresh({ store: { [KEY]: '{"coins":', [BAK]: bak } });
  H.assert(RR.Save.recovered && RR.Save.restoredFromBackup, 'flags');
  H.assert(RR.Save.data.coins === 4321, 'backup data restored');
  H.assert(JSON.parse(stored(RR, KEY)).coins === 4321, 'primary repaired');
  // Both corrupt → defaults.
  const RR2 = fresh({ store: { [KEY]: '{', [BAK]: '}' } });
  H.assert(RR2.Save.recovered && !RR2.Save.restoredFromBackup && RR2.Save.data.coins === 0, 'both corrupt');
});

H.test('hostile values are sanitized', () => {
  const huge = new Array(50000).fill('storm_runner');
  const hostile = {
    version: 'x', coins: -500, tokens: 'lots', xp: NaN, level: 99,
    selectedVehicle: 'tank', selectedWorld: 'moon_base',
    unlockedVehicles: huge.concat(['hacker_car', 42, null, { id: 'x' }]),
    unlockedWorlds: 'all',
    upgrades: { trail_buggy: { engine: 99, suspension: -3, tires: '5', fuel: 3.7, grip: null, air: Infinity },
      ghost_car: { engine: 5 }, storm_runner: 'bad' },
    bestDistances: { green_valley: 1234.9, fake_world: 99999, moon_base: -5, neon_city: 'far' },
    bestDistance: -1,
    stats: { runs: -4, totalDistance: 'lots', backflips: 12.8, crashes: 1e300, playTime: 55.5, bogus: 1 },
    missions: { day: '2026-01-01', active: [{ id: 'a' }, 5, null], bonusClaimed: 'yes' },
    daily: { day: 'yesterday', best: 99, attempts: 1, completed: true },
    cosmetics: { unlocked: ['paint_gold', 'paint_nonexistent', 7], selected: { trail_buggy: 'paint_gold', ghost: 'paint_factory', dirt_runner: 'paint_cosmic' } },
    settings: { sound: 'yes', music: false, quality: 'ultra', sensitivity: 9, reducedMotion: 1, showFps: true, touchControls: 'maybe' },
    seenTutorial: 'true',
    evil: '<script>'
  };
  const RR = fresh({ store: { [KEY]: JSON.stringify(hostile).replace('"xp":null', '"xp":"NaN"') } });
  const d = RR.Save.data;
  H.assert(!RR.Save.recovered, 'parsable → sanitized, not recovered');
  H.assert(d.version === 1 && d.coins === 0 && d.tokens === 0 && d.xp === 0 && d.level === 1, 'numbers');
  H.assert(deepEq(d.unlockedVehicles, ['trail_buggy', 'storm_runner']), 'vehicles: known + starter ' + d.unlockedVehicles);
  H.assert(deepEq(d.unlockedWorlds, ['green_valley']), 'worlds');
  H.assert(d.selectedVehicle === 'trail_buggy' && d.selectedWorld === 'green_valley', 'selection reset');
  const tb = d.upgrades.trail_buggy;
  H.assert(tb.engine === 10 && tb.suspension === 1 && tb.tires === 1 && tb.fuel === 3 && tb.grip === 1 && tb.air === 1 && tb.brakes === 1, 'upgrade clamps ' + JSON.stringify(tb));
  H.assert(!('ghost_car' in d.upgrades), 'unknown vehicle upgrades dropped');
  H.assert(deepEq(d.upgrades.storm_runner, { engine: 1, suspension: 1, tires: 1, fuel: 1, grip: 1, air: 1, brakes: 1 }), 'unlocked vehicle gets full upgrade set');
  H.assert(deepEq(d.bestDistances, { green_valley: 1234 }), 'bests ' + JSON.stringify(d.bestDistances));
  H.assert(d.bestDistance === 1234, 'overall best recomputed');
  H.assert(d.stats.runs === 0 && d.stats.totalDistance === 0 && d.stats.backflips === 12 && d.stats.crashes === 1e12 && d.stats.playTime === 55.5, 'stats');
  H.assert(!('bogus' in d.stats), 'unknown stat dropped');
  H.assert(deepEq(d.missions, { day: '', active: [], bonusClaimed: false }), 'bad missions → regenerate');
  H.assert(deepEq(d.daily, { day: '', best: 0, attempts: 0, completed: false }), 'bad daily → reset');
  H.assert(deepEq(d.cosmetics.unlocked, ['paint_factory', 'paint_gold']), 'cosmetics ' + d.cosmetics.unlocked);
  H.assert(deepEq(d.cosmetics.selected, { trail_buggy: 'paint_gold' }), 'selected paints');
  H.assert(deepEq(d.settings, { sound: true, music: false, quality: 'high', sensitivity: 1.5, reducedMotion: false, showFps: true, touchControls: 'auto' }), 'settings ' + JSON.stringify(d.settings));
  H.assert(d.seenTutorial === false && !('evil' in d), 'misc');
  // Everything written back is finite / valid.
  RR.Save.save();
  const txt = stored(RR, KEY);
  H.assert(!/NaN|Infinity|null/.test(txt), 'no NaN/Infinity/null in the file');
});

H.test('xp on disk decides the level; hand-edited level ignored; level paints granted', () => {
  const RR = fresh({ store: { [KEY]: JSON.stringify({ xp: 5000, level: 1 }) } });
  const lv = RR.Progression.levelInfo(5000).level;
  H.assert(lv > 1 && RR.Save.data.level === lv, 'level from xp');
  const expected = RR.Progression.COSMETICS.filter((c) => c.level <= lv).map((c) => c.id);
  H.assert(deepEq(RR.Save.data.cosmetics.unlocked, expected), 'level paints granted on load');
  const capped = fresh({ store: { [KEY]: JSON.stringify({ xp: 1e20, coins: 1e20, tokens: 1e20 }) } });
  H.assert(capped.Save.data.level === 50 && capped.Save.data.coins === 999999999 && capped.Save.data.tokens === 9999, 'caps');
});

H.test('save → load round trip preserves everything', () => {
  const A = fresh();
  const P = A.Progression;
  P.addCoins(60000); P.addTokens(5); setLevel(A, 8);
  P.unlockVehicle('dirt_runner', 'tokens');
  P.unlockWorld('rocky_highlands');
  P.selectVehicle('dirt_runner'); P.selectWorld('rocky_highlands');
  P.upgrade('dirt_runner', 'engine'); P.upgrade('dirt_runner', 'engine');
  P.selectPaint('dirt_runner', 'paint_lava');
  A.Missions.ensureToday(date('2026-03-10'));
  A.Missions.track(A.Save.data.missions.active[0].stat, 1, { worldId: A.Save.data.missions.active[0].worldId });
  A.Daily.recordAttempt(123, date('2026-03-10'));
  A.Save.updateSettings({ quality: 'low', sensitivity: 0.75, touchControls: 'on' });
  A.Save.data.seenTutorial = true;
  P.applyRunResults({ worldId: 'rocky_highlands', vehicleId: 'dirt_runner', mode: 'normal', distance: 812.4, coins: 300,
    bonusCoins: 100, tokens: 0, trickXp: 50, bossXp: 0, tricks: { backflip: 2 }, perfectLandings: 1, endReason: 'crash', time: 60 });
  const snapshot = JSON.stringify(A.Save.data);
  const B = fresh({ store: { [KEY]: stored(A, KEY) } });
  H.assert(JSON.stringify(B.Save.data) === snapshot, 'identical after reload');
  H.assert(B.Save.data.missions.active.length === 3 && B.Save.data.daily.attempts === 1, 'missions/daily kept');
});

H.test('localStorage unavailable → silent in-memory mode', () => {
  const RR = fresh({ setup: (ctx) => Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); } }) });
  H.assert(RR.Save.persistent === false, 'memory mode');
  H.assert(RR.Save.data.coins === 0, 'defaults');
  RR.Progression.addCoins(100);
  H.assert(RR.Save.save() === true, 'save into memory');
  RR.Save.data.coins = 0;
  RR.Save.load();
  H.assert(RR.Save.data.coins === 100, 'memory store survives a reload in-session');
  // Storage present but every call throws (quota / disabled).
  const thrower = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  const RR2 = fresh({ setup: (ctx) => { ctx.localStorage = thrower; } });
  H.assert(RR2.Save.persistent === false, 'probe failed → memory');
  RR2.Progression.addCoins(5);
  H.assert(RR2.Save.data.coins === 5, 'keeps working');
  RR2.Save.reset();
  H.assert(RR2.Save.data.coins === 0, 'reset works');
});

H.test('reset → defaults, saved, emits saveReset, keeps object identity', () => {
  const RR = fresh();
  const ref = RR.Save.data;
  RR.Progression.addCoins(999);
  const log = events(RR, ['saveReset']);
  RR.Save.reset();
  H.assert(RR.Save.data === ref, 'same object');
  H.assert(RR.Save.data.coins === 0 && JSON.parse(stored(RR, KEY)).coins === 0 && JSON.parse(stored(RR, BAK)).coins === 0, 'saved');
  H.assert(log.length === 1, 'event');
});

H.test('save() heals bad values written by other modules; ensureVehicle', () => {
  const RR = fresh();
  RR.Save.data.coins = NaN;
  RR.Save.data.settings.sensitivity = 'fast';
  RR.Save.data.stats.runs = -3;
  H.assert(RR.Save.save() === true, 'saved');
  H.assert(RR.Save.data.coins === 0 && RR.Save.data.settings.sensitivity === 1 && RR.Save.data.stats.runs === 0, 'healed live data');
  const u = RR.Save.ensureVehicle('rally_beast');
  H.assert(deepEq(u, { engine: 1, suspension: 1, tires: 1, fuel: 1, grip: 1, air: 1, brakes: 1 }) && RR.Save.data.upgrades.rally_beast === u, 'created');
  const ghost = RR.Save.ensureVehicle('ghost');
  H.assert(ghost.engine === 1 && !('ghost' in RR.Save.data.upgrades), 'unknown not stored');
  const log = events(RR, ['settings']);
  const s = RR.Save.updateSettings({ quality: 'medium', sensitivity: 3, music: 'no' });
  H.assert(s.quality === 'medium' && s.sensitivity === 1.5 && s.music === true && log.length === 1, 'updateSettings');
});

console.log('\nProgression');

H.test('XP curve matches the contract; levelInfo', () => {
  const RR = fresh();
  const P = RR.Progression;
  H.assert(P.MAX_LEVEL === 50, 'max level');
  for (let l = 1; l < 50; l++) H.assert(P.xpForLevel(l) === Math.round(200 * Math.pow(l, 1.4) / 10) * 10, 'xpForLevel ' + l);
  H.assert(P.xpForLevel(1) === 200 && P.xpForLevel(2) === 530, 'anchors');
  let info = P.levelInfo(0);
  H.assert(info.level === 1 && info.xpInto === 0 && info.xpNext === 200 && info.progress === 0, 'lv1');
  info = P.levelInfo(300);
  H.assert(info.level === 2 && info.xpInto === 100 && info.xpNext === 530, 'lv2 ' + JSON.stringify(info));
  H.assertClose(info.progress, 100 / 530, 1e-9);
  info = P.levelInfo(1e9);
  H.assert(info.level === 50 && info.progress === 1 && info.isMax, 'max');
  info = P.levelInfo(NaN);
  H.assert(info.level === 1, 'NaN safe');
  H.assert(P.levelInfo().level === RR.Save.data.level, 'defaults to save');
});

H.test('addXp: multi-level-up in one call, events per level, rewards', () => {
  const RR = fresh();
  const P = RR.Progression;
  const log = events(RR, ['levelup']);
  const res = P.addXp(P.xpToReachLevel(5) + 10);
  H.assert(res.levelsGained === 4 && res.level === 5 && RR.Save.data.level === 5, 'levels ' + JSON.stringify(res.level));
  H.assert(log.length === 4 && log.map((e) => e.p.level).join() === '2,3,4,5', 'events');
  H.assert(res.rewards.some((r) => r.type === 'vehicle' && r.id === 'dirt_runner'), 'vehicle reward');
  H.assert(res.rewards.some((r) => r.type === 'upgradeTier'), 'tier reward at 5');
  H.assert(JSON.parse(stored(RR, KEY)).xp === RR.Save.data.xp, 'saved');
  const none = P.addXp(-50);
  H.assert(none.levelsGained === 0 && P.addXp(NaN).levelsGained === 0 && P.addXp('9').levelsGained === 0, 'invalid ignored');
});

H.test('rewardsForLevel / LEVEL_REWARDS derived from data', () => {
  const RR = fresh();
  const P = RR.Progression;
  const r2 = P.rewardsForLevel(2);
  H.assert(r2.some((r) => r.type === 'vehicle' && r.id === 'dirt_runner'), 'dirt runner at 2');
  H.assert(r2.some((r) => r.type === 'world' && r.id === 'rocky_highlands'), 'rocky at 2');
  H.assert(r2.some((r) => r.type === 'cosmetic' && r.id === 'paint_sunburst'), 'sunburst at 2');
  H.assert(P.rewardsForLevel(5).some((r) => r.type === 'upgradeTier' && /7/.test(r.text)), 'tier 2 at 5');
  H.assert(P.rewardsForLevel(12).some((r) => r.type === 'upgradeTier' && /10/.test(r.text)), 'tier 3 at 12');
  H.assert(P.rewardsForLevel(14).some((r) => r.id === 'storm_runner'), 'storm runner at 14');
  H.assert(P.rewardsForLevel(16).some((r) => r.id === 'storm_planet'), 'storm planet at 16');
  H.assert(P.rewardsForLevel(1).length === 0 && P.rewardsForLevel(99).length === 0, 'out of range');
  for (const r of P.rewardsForLevel(2)) H.assert(typeof r.text === 'string' && r.text.length > 5, 'text');
  H.assert(Array.isArray(P.LEVEL_REWARDS[7]) && P.LEVEL_REWARDS[7].some((r) => r.id === 'rally_beast'), 'LEVEL_REWARDS');
});

H.test('upgrade tiers', () => {
  const RR = fresh();
  const P = RR.Progression;
  H.assert(P.maxUpgradeLevel(1) === 4 && P.maxUpgradeLevel(4) === 4 && P.maxUpgradeLevel(5) === 7 && P.maxUpgradeLevel(11) === 7 && P.maxUpgradeLevel(12) === 10, 'max');
  H.assert(P.requiredLevelForUpgrade(2) === 1 && P.requiredLevelForUpgrade(4) === 1 && P.requiredLevelForUpgrade(5) === 5 &&
    P.requiredLevelForUpgrade(7) === 5 && P.requiredLevelForUpgrade(8) === 12 && P.requiredLevelForUpgrade(10) === 12, 'required');
});

H.test('upgrade flow: exact cost, tier gating, coins, max level, events', () => {
  const RR = fresh();
  const P = RR.Progression, V = RR.Vehicles;
  const log = events(RR, ['upgrade']);
  let c = P.canUpgrade('trail_buggy', 'engine');
  H.assert(!c.ok && c.reason === 'coins' && c.cost === V.upgradeCost('trail_buggy', 'engine', 1) && c.level === 1, 'no coins ' + JSON.stringify(c));
  P.addCoins(1000000);
  for (let lv = 1; lv < 4; lv++) {
    const before = RR.Save.data.coins;
    const cost = V.upgradeCost('trail_buggy', 'engine', lv);
    const r = P.upgrade('trail_buggy', 'engine');
    H.assert(r.ok && r.newLevel === lv + 1 && r.cost === cost, 'upgrade ' + lv);
    H.assert(RR.Save.data.coins === before - cost, 'exact deduction');
  }
  c = P.canUpgrade('trail_buggy', 'engine');
  H.assert(!c.ok && c.reason === 'tier' && c.requiredLevel === 5 && c.level === 4, 'tier gate ' + JSON.stringify(c));
  H.assert(!P.upgrade('trail_buggy', 'engine').ok && RR.Save.data.upgrades.trail_buggy.engine === 4, 'blocked');
  setLevel(RR, 5);
  for (let lv = 4; lv < 7; lv++) H.assert(P.upgrade('trail_buggy', 'engine').ok, 'tier 2 ' + lv);
  H.assert(P.canUpgrade('trail_buggy', 'engine').reason === 'tier', 'tier 3 gate');
  setLevel(RR, 12);
  for (let lv = 7; lv < 10; lv++) H.assert(P.upgrade('trail_buggy', 'engine').ok, 'tier 3 ' + lv);
  c = P.canUpgrade('trail_buggy', 'engine');
  H.assert(!c.ok && c.reason === 'max' && c.level === 10, 'max');
  H.assert(!P.upgrade('trail_buggy', 'engine').ok && RR.Save.data.upgrades.trail_buggy.engine === 10, 'stays 10');
  H.assert(log.length === 9 && log[8].p.level === 10 && log[0].p.vehicleId === 'trail_buggy' && log[0].p.catId === 'engine', 'events');
  H.assert(P.canUpgrade('dirt_runner', 'engine').reason === 'locked', 'locked vehicle');
  H.assert(P.canUpgrade('trail_buggy', 'nitro').reason === 'unknown' && P.canUpgrade('ufo', 'engine').reason === 'unknown', 'unknown');
  H.assert(JSON.parse(stored(RR, KEY)).upgrades.trail_buggy.engine === 10, 'persisted');
});

H.test('vehicle unlock by coins / tokens with level gating + requirement text', () => {
  const RR = fresh();
  const P = RR.Progression;
  const log = events(RR, ['unlock']);
  let st = P.vehicleStatus('mountain_truck');
  H.assert(!st.unlocked && !st.levelOk && st.requirementText === 'Reach Level 4 · then 7,500 coins or 2 tokens', st.requirementText);
  P.addCoins(100000); P.addTokens(10);
  H.assert(P.unlockVehicle('mountain_truck', 'coins').reason === 'level', 'level gate');
  setLevel(RR, 4);
  st = P.vehicleStatus('mountain_truck');
  H.assert(st.levelOk && st.canCoins && st.canTokens && st.requirementText === 'Level 4 reached — unlock for 7,500 coins or 2 tokens', st.requirementText);
  const coinsBefore = RR.Save.data.coins;
  H.assert(P.unlockVehicle('mountain_truck', 'coins').ok, 'coins unlock');
  H.assert(RR.Save.data.coins === coinsBefore - 7500 && RR.Save.data.unlockedVehicles.indexOf('mountain_truck') >= 0, 'paid');
  H.assert(RR.Save.data.upgrades.mountain_truck.engine === 1, 'upgrades created');
  H.assert(P.vehicleStatus('mountain_truck').requirementText === '' && P.unlockVehicle('mountain_truck', 'coins').reason === 'owned', 'owned');
  const tokBefore = RR.Save.data.tokens;
  H.assert(P.unlockVehicle('dirt_runner', 'tokens').ok && RR.Save.data.tokens === tokBefore - 1, 'token unlock');
  H.assert(P.vehicleStatus('dirt_runner').unlocked, 'unlocked');
  H.assert(P.unlockVehicle('rally_beast', 'coins').reason === 'level', 'rally gated');
  H.assert(P.unlockVehicle('nope', 'coins').reason === 'unknown' && P.unlockVehicle('trail_buggy', 'coins').reason === 'owned', 'misc');
  H.assert(log.length === 2 && log[0].p.kind === 'vehicle' && log[0].p.id === 'mountain_truck', 'events');
  // Not enough currency.
  const poor = fresh();
  setLevel(poor, 2);
  H.assert(poor.Progression.unlockVehicle('dirt_runner', 'coins').reason === 'coins', 'no coins');
  H.assert(poor.Progression.unlockVehicle('dirt_runner', 'tokens').reason === 'tokens', 'no tokens');
  H.assert(poor.Progression.unlockVehicle('dirt_runner', 'gems').reason === 'method', 'bad method');
  H.assert(poor.Progression.vehicleStatus('dirt_runner').requirementText === 'Level 2 reached — unlock for 2,500 coins or 1 token', 'singular token');
  H.assert(!poor.Progression.selectVehicle('dirt_runner') && poor.Save.data.selectedVehicle === 'trail_buggy', 'cannot select locked');
});

H.test('world unlock with level gating + requirement text', () => {
  const RR = fresh();
  const P = RR.Progression;
  let st = P.worldStatus('snow_peaks');
  H.assert(st.requirementText === 'Reach Level 6 · then 8,000 coins' && !st.canBuy, st.requirementText);
  setLevel(RR, 6);
  st = P.worldStatus('snow_peaks');
  H.assert(st.requirementText === 'Level 6 reached — unlock for 8,000 coins' && !st.canBuy, st.requirementText);
  H.assert(P.unlockWorld('snow_peaks').reason === 'coins', 'coins');
  P.addCoins(8000);
  H.assert(P.unlockWorld('snow_peaks').ok && RR.Save.data.coins === 0, 'bought');
  H.assert(P.worldStatus('snow_peaks').unlocked && P.worldStatus('snow_peaks').requirementText === '', 'unlocked');
  H.assert(P.selectWorld('snow_peaks') && RR.Save.data.selectedWorld === 'snow_peaks', 'select');
  H.assert(!P.selectWorld('storm_planet'), 'locked select');
  H.assert(P.unlockWorld('storm_planet').reason === 'level' && P.unlockWorld('x').reason === 'unknown' && P.unlockWorld('green_valley').reason === 'owned', 'misc');
});

H.test('coins / tokens spend + events', () => {
  const RR = fresh();
  const P = RR.Progression;
  const log = events(RR, ['coins', 'tokens']);
  P.addCoins(100); P.addTokens(2);
  H.assert(!P.spendCoins(101) && P.spendCoins(40) && RR.Save.data.coins === 60, 'coins');
  H.assert(!P.spendTokens(3) && P.spendTokens(2) && RR.Save.data.tokens === 0, 'tokens');
  H.assert(!P.spendCoins(NaN) && !P.spendCoins(-5) && RR.Save.data.coins === 60, 'invalid spend');
  P.addCoins(-50); P.addCoins(NaN);
  H.assert(RR.Save.data.coins === 60, 'invalid add');
  H.assert(log.filter((e) => e.n === 'coins').length === 2 && log.filter((e) => e.n === 'tokens').length === 2, 'events');
  H.assert(log[0].p.coins === 100, 'payload');
});

H.test('cosmetics: ≥ 10 paints, unlock on level-up, getPaint/selectPaint', () => {
  const RR = fresh();
  const P = RR.Progression;
  const C = P.COSMETICS;
  H.assert(C.length >= 11 && C[0].id === 'paint_factory' && C[0].colors === null && C[0].level === 1, 'catalogue');
  const ids = new Set();
  for (const c of C.slice(1)) {
    H.assert(c.level >= 2 && c.level <= 30 && typeof c.name === 'string', 'paint ' + c.id);
    for (const k of ['body', 'accent', 'trim', 'wheel', 'rim']) H.assert(/^#[0-9a-f]{6}$/i.test(c.colors[k]), c.id + '.' + k);
    ids.add(c.id);
  }
  H.assert(ids.size === C.length - 1, 'unique ids');
  H.assert(!P.selectPaint('trail_buggy', 'paint_sunburst'), 'locked paint');
  const def = RR.Vehicles.byId('trail_buggy').colors;
  H.assert(deepEq(P.getPaint('trail_buggy'), { body: def.body, accent: def.accent, trim: def.trim, wheel: def.wheel, rim: def.rim }), 'factory = defaults');
  setLevel(RR, 3);
  H.assert(RR.Save.data.cosmetics.unlocked.indexOf('paint_sunburst') >= 0 && RR.Save.data.cosmetics.unlocked.indexOf('paint_glacier') >= 0, 'unlocked by level');
  H.assert(RR.Save.data.cosmetics.unlocked.indexOf('paint_jungle') < 0, 'not yet');
  H.assert(P.selectPaint('trail_buggy', 'paint_glacier'), 'select');
  H.assert(P.getPaint('trail_buggy').body === C.find((c) => c.id === 'paint_glacier').colors.body, 'applied');
  H.assert(P.getPaint('dirt_runner').body === RR.Vehicles.byId('dirt_runner').colors.body, 'per vehicle');
  H.assert(!P.selectPaint('ufo', 'paint_glacier') && !P.selectPaint('trail_buggy', 'paint_fake'), 'invalid');
  H.assert(P.selectPaint('trail_buggy', 'paint_factory') && P.getPaint('trail_buggy').body === def.body, 'back to factory');
});

H.test('computeRunRewards / applyRunResults: xp rules, bests, stats, record flags', () => {
  const RR = fresh();
  const P = RR.Progression;
  const summary = {
    worldId: 'green_valley', vehicleId: 'trail_buggy', mode: 'normal', distance: 1234.7, coins: 480, bonusCoins: 270,
    tokens: 1, trickXp: 90, bossXp: 400, tricks: { backflip: 3, frontflip: 2, doubleFlip: 1, tripleFlip: 1, perfect: 4, longAir: 1, wheelie: 2 },
    perfectLandings: 4, fuelCollected: 6, powerups: 3, airTime: 7.5, maxCombo: 6, bossCleared: true, endReason: 'crash',
    crashReason: 'head', time: 95.5, missionsCompleted: []
  };
  const r = P.computeRunRewards(summary);
  H.assert(r.coins === 480 && r.bonusCoins === 270 && r.totalCoins === 750 && r.tokens === 1, 'coins');
  H.assert(r.xp.distance === 123 && r.xp.coins === 30 && r.xp.tricks === 90 && r.xp.boss === 400 && r.xp.record === 250, 'xp ' + JSON.stringify(r.xp));
  H.assert(r.xp.total === 123 + 30 + 90 + 400 + 250, 'total');
  H.assert(r.newRecord && r.newWorldRecord && r.previousBest === 0, 'records');
  H.assert(RR.Save.data.coins === 0, 'compute is pure');

  const res = P.applyRunResults(summary);
  const d = RR.Save.data;
  H.assert(d.coins === 750 && d.tokens === 1 && d.xp === r.xp.total, 'granted');
  H.assert(res.levelUp && res.levelUp.level === d.level && res.levelUp.levelsGained === d.level - 1, 'levelUp');
  H.assert(d.bestDistances.green_valley === 1234 && d.bestDistance === 1234, 'bests');
  const s = d.stats;
  H.assert(s.runs === 1 && s.totalDistance === 1234.7 && s.coinsCollected === 480 && s.backflips === 3 && s.frontflips === 2 &&
    s.doubleFlips === 2 && s.perfectLandings === 4 && s.fuelCollected === 6 && s.powerups === 3 && s.crashes === 1 &&
    s.bossesCleared === 1 && s.maxCombo === 6 && s.longestAir === 7.5 && s.playTime === 95.5, 'stats ' + JSON.stringify(s));
  H.assert(JSON.parse(stored(RR, KEY)).coins === 750, 'saved');

  // Shorter run: no records, crashes unchanged for fuel end, maxima kept.
  const r2 = P.applyRunResults(Object.assign({}, summary, { distance: 500, endReason: 'fuel', maxCombo: 2, airTime: 1, bossCleared: false, tokens: 0, bossXp: 0 }));
  H.assert(!r2.newRecord && !r2.newWorldRecord && r2.previousBest === 1234 && r2.xp.record === 0, 'no record');
  H.assert(s.crashes === 1 && s.runs === 2 && s.maxCombo === 6 && s.longestAir === 7.5 && s.bossesCleared === 1, 'maxima');
  // New world best elsewhere, lower than overall best.
  const r3 = P.applyRunResults(Object.assign({}, summary, { distance: 150, worldId: 'moon_base', mode: 'daily' }));
  H.assert(r3.newWorldRecord && !r3.newRecord && r3.xp.record === 250 && d.bestDistances.moon_base === 150 && d.bestDistance === 1234, 'world record (daily counts)');
  // World record below 100 m → flag but no bonus xp.
  const r4 = P.applyRunResults(Object.assign({}, summary, { distance: 60, worldId: 'desert_canyon' }));
  H.assert(r4.newWorldRecord && r4.xp.record === 0, 'short world record');
  // Garbage summary numbers never produce NaN.
  const r5 = P.applyRunResults({ worldId: 'green_valley', mode: 'normal', distance: NaN, coins: 'x', bonusCoins: -9, tricks: null });
  H.assert(r5.totalCoins === 0 && r5.xp.total === 0 && Number.isFinite(d.stats.totalDistance) && Number.isFinite(d.coins), 'garbage safe');
});

H.test('attract runs grant nothing and change nothing', () => {
  const RR = fresh();
  const before = JSON.stringify(RR.Save.data);
  const log = events(RR, ['coins', 'tokens', 'levelup']);
  const res = RR.Progression.applyRunResults({ worldId: 'green_valley', mode: 'attract', distance: 5000, coins: 999, bonusCoins: 999, tokens: 3, trickXp: 999, bossXp: 999 });
  H.assert(res.totalCoins === 0 && res.xp.total === 0 && res.tokens === 0 && !res.newRecord && res.levelUp.levelsGained === 0 && res.ignored, 'zero');
  H.assert(JSON.stringify(RR.Save.data) === before && log.length === 0, 'unchanged');
  H.assert(RR.Progression.applyRunResults(null).xp.total === 0, 'null summary');
});

console.log('\nMissions');

H.test('templates: ≥ 14, valid, contract stat keys, natural text', () => {
  const RR = fresh();
  const T = RR.MissionTemplates;
  H.assert(T.length >= 14, 'count');
  const keys = ['distance', 'runDistance', 'coins', 'backflips', 'frontflips', 'doubleFlips', 'perfectLandings', 'fuelCans',
    'airTime', 'wheelie', 'combo', 'powerups', 'bossCleared', 'dailyComplete', 'tricks', 'worldDistance'];
  const covered = new Set(T.map((t) => t.stat));
  for (const k of keys) H.assert(covered.has(k), 'stat covered ' + k);
  for (const t of T) {
    H.assert(t.mode === 'sum' || t.mode === 'max', 'mode ' + t.id);
    H.assert(t.targets.length === 5 && t.rewardCoins.length === 5 && t.rewardXp.length === 5, 'tiers ' + t.id);
    for (let i = 1; i < 5; i++) H.assert(t.targets[i] >= t.targets[i - 1] && t.rewardCoins[i] > t.rewardCoins[i - 1], 'scaling ' + t.id);
    H.assert(T.byId(t.id) === t, 'byId');
  }
});

H.test('ensureToday: deterministic per date, 3 distinct, differs across dates', () => {
  const A = fresh(), B = fresh();
  const d1 = date('2026-05-01');
  const a = A.Missions.ensureToday(d1), b = B.Missions.ensureToday(d1);
  H.assert(a.length === 3 && deepEq(a, b), 'same date → same missions');
  H.assert(new Set(a.map((m) => m.templateId)).size === 3, 'distinct templates');
  H.assert(A.Save.data.missions.day === '2026-05-01', 'day stored');
  H.assert(A.Missions.ensureToday(d1) === a, 'idempotent same day');
  const sets = new Set();
  for (let i = 0; i < 30; i++) sets.add(A.Missions.generate(addDays(d1, i), 1, ['green_valley']).map((m) => m.templateId).join());
  H.assert(sets.size >= 15, 'varies across dates: ' + sets.size);
  const next = A.Missions.ensureToday(addDays(d1, 1));
  H.assert(A.Save.data.missions.day === '2026-05-02' && next[0].id !== a[0].id, 'rolls over');
  for (const m of a) {
    H.assert(!/[{}]/.test(m.text) && m.target > 0 && m.progress === 0 && !m.completed && !m.claimed, 'instance ' + m.text);
    H.assert(m.reward.coins > 0 && m.reward.xp > 0 && (m.reward.tokens === 0 || m.reward.tokens === 1), 'reward');
  }
});

H.test('missions: tier scaling, tokens only on the hardest, world missions only for unlocked worlds', () => {
  const RR = fresh();
  const M = RR.Missions;
  const all = RR.Worlds.list.map((w) => w.id);
  let worldMissions = 0, tokenDays = 0;
  for (let i = 0; i < 200; i++) {
    const dt = addDays(date('2026-01-01'), i);
    const low = M.generate(dt, 1, ['green_valley']);
    const high = M.generate(dt, 20, all);
    const lowById = {};
    for (const m of low) lowById[m.templateId] = m;
    for (const m of high) {
      const l = lowById[m.templateId];
      if (l && m.stat !== 'worldDistance') H.assert(m.target >= l.target && m.reward.coins > l.reward.coins, 'tier scales ' + m.templateId);
    }
    for (const m of low) {
      if (m.stat === 'worldDistance') { worldMissions++; H.assert(m.worldId === 'green_valley' && /Green Valley/.test(m.text), 'unlocked world only'); }
      H.assert(m.templateId !== 'boss' && m.templateId !== 'double_flips', 'minTier respected');
    }
    const tok = high.filter((m) => m.reward.tokens > 0);
    H.assert(tok.length <= 1, 'at most one token mission');
    if (tok.length) {
      tokenDays++;
      H.assert(tok[0].difficulty === Math.max.apply(null, high.map((m) => m.difficulty)), 'token on hardest');
    }
  }
  H.assert(worldMissions > 5 && tokenDays > 30 && tokenDays < 170, 'coverage world=' + worldMissions + ' tokens=' + tokenDays);
  const txt = M.generate(date('2026-01-01'), 1, ['green_valley']).map((m) => m.text);
  H.assert(txt.every((t) => /^[A-Z]/.test(t)), 'capitalised');
});

H.test('mission text reads naturally', () => {
  const RR = fresh();
  const T = RR.MissionTemplates;
  const fmt = (id, n) => T.byId(id).text.replace('{n}', RR.Util.formatInt(n)).replace('{s}', n === 1 ? '' : 's');
  H.assert(fmt('backflips', 3) === 'Perform 3 backflips', fmt('backflips', 3));
  H.assert(fmt('run_distance', 2000) === 'Reach 2,000 m in one run', fmt('run_distance', 2000));
  H.assert(fmt('fuel', 20) === 'Collect 20 fuel pickups', fmt('fuel', 20));
  H.assert(fmt('double_flips', 1) === 'Land 1 double flip', fmt('double_flips', 1));
});

// Builds a known mission set for tracking tests.
function withMissions(RR, specs) {
  RR.Missions.ensureToday(date('2026-06-01'));
  const active = RR.Save.data.missions.active;
  specs.forEach((s, i) => Object.assign(active[i], { stat: s.stat, mode: s.mode, target: s.target, progress: 0, completed: false, claimed: false, worldId: s.worldId }));
  return active;
}

H.test('track: sum / max / world-specific, completion events, no-alloc empty result', () => {
  const RR = fresh();
  const M = RR.Missions;
  const active = withMissions(RR, [
    { stat: 'distance', mode: 'sum', target: 100 },
    { stat: 'runDistance', mode: 'max', target: 500 },
    { stat: 'worldDistance', mode: 'max', target: 300, worldId: 'green_valley' }
  ]);
  const log = events(RR, ['missionComplete']);
  const e1 = M.track('distance', 40);
  const e2 = M.track('distance', 1);
  H.assert(e1.length === 0 && e1 === e2, 'shared empty result');
  M.track('runDistance', 200); M.track('runDistance', 150);
  H.assert(active[0].progress === 41 && active[1].progress === 200, 'sum vs max');
  M.track('worldDistance', 400, { worldId: 'moon_base' });
  M.track('worldDistance', 400);
  H.assert(active[2].progress === 0, 'wrong/missing world ignored');
  const done = M.track('worldDistance', 350, { worldId: 'green_valley' });
  H.assert(done.length === 1 && done[0] === active[2] && active[2].completed && active[2].progress === 300, 'world mission done');
  M.track('distance', 1000);
  H.assert(active[0].progress === 100 && active[0].completed, 'clamped at target');
  H.assert(M.track('distance', 5).length === 0, 'no double completion');
  M.track('distance', NaN); M.track('runDistance', -5); M.track('runDistance', Infinity);
  H.assert(active[1].progress === 200, 'invalid ignored');
  H.assert(log.length === 2 && RR.Save.data.stats.missionsCompleted === 2, 'events + stat');
  H.assert(M.claimableCount() === 2, 'claimable');
});

H.test('claim once; bonus only when all 3 claimed, once per day', () => {
  const RR = fresh();
  const M = RR.Missions;
  const active = withMissions(RR, [
    { stat: 'coins', mode: 'sum', target: 10 },
    { stat: 'backflips', mode: 'sum', target: 1 },
    { stat: 'combo', mode: 'max', target: 3 }
  ]);
  const log = events(RR, ['missionClaimed']);
  H.assert(!M.claim(active[0].id).ok && M.claim(active[0].id).reason === 'incomplete', 'incomplete');
  M.track('coins', 10); M.track('backflips', 1); M.track('combo', 4);
  const coins0 = RR.Save.data.coins, xp0 = RR.Save.data.xp, tok0 = RR.Save.data.tokens;
  const c = M.claim(active[0].id);
  H.assert(c.ok && RR.Save.data.coins === coins0 + active[0].reward.coins && RR.Save.data.xp === xp0 + active[0].reward.xp, 'granted');
  H.assert(RR.Save.data.tokens === tok0 + active[0].reward.tokens, 'tokens');
  H.assert(!M.claim(active[0].id).ok && M.claim(active[0].id).reason === 'claimed', 'claim once');
  H.assert(!M.canClaimBonus() && !M.claimBonus().ok, 'bonus needs all');
  M.claim(active[1].id); M.claim(active[2].id);
  H.assert(log.length === 3, 'events');
  H.assert(M.canClaimBonus(), 'bonus ready');
  const t0 = RR.Save.data.tokens, cn0 = RR.Save.data.coins;
  const b = M.claimBonus();
  H.assert(b.ok && deepEq(b.reward, { coins: 750, xp: 300, tokens: 1 }) && RR.Save.data.tokens === t0 + 1 && RR.Save.data.coins === cn0 + 750, 'bonus');
  H.assert(deepEq(M.BONUS, { coins: 750, xp: 300, tokens: 1 }), 'BONUS constant');
  H.assert(!M.canClaimBonus() && !M.claimBonus().ok, 'bonus once');
  H.assert(JSON.parse(stored(RR, KEY)).missions.bonusClaimed === true, 'saved');
  H.assert(M.claim('nope').reason === 'unknown', 'unknown id');
  // Reload keeps claimed state.
  const B = fresh({ store: { [KEY]: stored(RR, KEY) } });
  H.assert(B.Save.data.missions.active.every((m) => m.claimed) && B.Save.data.missions.bonusClaimed, 'persisted state');
});

H.test('timeUntilReset / timeUntilNext', () => {
  const RR = fresh();
  const t = new Date(2026, 4, 1, 23, 0, 0);
  H.assert(RR.Missions.timeUntilReset(t) === 3600000 && RR.Daily.timeUntilNext(t) === 3600000, 'one hour');
  const now = RR.Missions.timeUntilReset();
  H.assert(now > 0 && now <= 86400000 + 3600000, 'range');
});

console.log('\nDaily');

H.test('getChallenge: deterministic, complete, in range', () => {
  const RR = fresh();
  const D = RR.Daily;
  const a = D.getChallenge('2026-07-04'), b = D.getChallenge(date('2026-07-04'));
  H.assert(deepEq(a, b) && a.day === '2026-07-04', 'same date (string or Date)');
  const other = fresh().Daily.getChallenge('2026-07-04');
  H.assert(deepEq(a, other), 'same across sandboxes');
  H.assert(D.getChallenge() .day === D.todayKey() && D.todayKey() === RR.Util.todayKey(), 'today');
  a.modifiers.gravityMul = 99;
  H.assert(D.getChallenge('2026-07-04').modifiers.gravityMul !== 99, 'returns copies');
});

H.test('daily varies across 60 days, all types reachable, sane values', () => {
  const RR = fresh();
  const D = RR.Daily;
  const types = new Set(), worlds = new Set(), sigs = new Set();
  const worldCount = {};
  const need = ['low_gravity', 'no_fuel', 'max_speed', 'extreme_hills', 'ice', 'coin_rush', 'storm_winds'];
  const modKeys = ['gravityMul', 'noFuelPickups', 'fuelEfficiencyMul', 'speedMul', 'terrainAmpMul', 'frictionMul', 'coinMul', 'coinDensityMul', 'windMul', 'labels'];
  let tokenDays = 0, prev = null;
  for (let i = 0; i < 60; i++) {
    const c = D.getChallenge(addDays(date('2026-09-01'), i));
    types.add(c.id); worlds.add(c.worldId); sigs.add(c.id + c.worldId + c.targetDistance);
    worldCount[c.worldId] = (worldCount[c.worldId] || 0) + 1;
    H.assert(c.id !== prev, 'no same type two days in a row');
    prev = c.id;
    H.assert(typeof c.name === 'string' && c.name && typeof c.description === 'string' && c.description.length > 10, 'text');
    H.assert(typeof c.icon === 'string' && c.icon.length >= 1 && c.icon.length <= 4, 'icon');
    H.assert(RR.Worlds.byId(c.worldId), 'world');
    H.assert(c.targetDistance >= 600 && c.targetDistance <= 1500 && c.targetDistance % 50 === 0, 'target ' + c.targetDistance);
    H.assert(c.reward.coins >= 1500 && c.reward.coins <= 3000 && c.reward.xp >= 400 && c.reward.xp <= 800, 'reward');
    H.assert(c.reward.tokens === 0 || c.reward.tokens === 1, 'tokens');
    if (c.reward.tokens) tokenDays++;
    H.assert(deepEq(Object.keys(c.modifiers).sort(), modKeys.slice().sort()), 'modifier keys');
    H.assert(Array.isArray(c.modifiers.labels) && c.modifiers.labels.length >= 1, 'labels');
    H.assert(Number.isInteger(c.seed) && c.seed >= 0, 'seed');
    if (c.id === 'no_fuel') {
      H.assert(c.modifiers.noFuelPickups === true && c.modifiers.fuelEfficiencyMul <= 0.5 && c.targetDistance <= 1000, 'no_fuel beatable');
    }
    if (c.id === 'low_gravity') H.assert(c.modifiers.gravityMul < 1, 'low g');
    if (c.id === 'ice') H.assert(c.modifiers.frictionMul < 1, 'ice');
    if (c.id === 'storm_winds') H.assert(c.modifiers.windMul > 1 && c.worldId !== 'moon_base', 'wind');
  }
  for (const t of need) H.assert(types.has(t), 'type reachable: ' + t);
  H.assert(types.size >= 7 && worlds.size >= 5 && sigs.size >= 40, 'variety types=' + types.size + ' worlds=' + worlds.size);
  H.assert(tokenDays > 0 && tokenDays < 60, 'some token days ' + tokenDays);
  const easy = (worldCount.green_valley || 0) + (worldCount.rocky_highlands || 0) + (worldCount.desert_canyon || 0);
  H.assert(easy > (worldCount.storm_planet || 0) * 2, 'weighted toward easier worlds ' + JSON.stringify(worldCount));
});

H.test('status + recordAttempt: rollover, attempts, best, reward once per day', () => {
  const RR = fresh();
  const D = RR.Daily;
  const day = date('2026-08-15');
  const ch = D.getChallenge(day);
  RR.Missions.ensureToday(day);
  const act = RR.Save.data.missions.active;
  Object.assign(act[0], { stat: 'dailyComplete', mode: 'sum', target: 1, progress: 0, completed: false });
  let st = D.status(day);
  H.assert(deepEq(st, { day: '2026-08-15', best: 0, attempts: 0, completed: false }), 'fresh status');
  let r = D.recordAttempt(ch.targetDistance - 1, day);
  H.assert(!r.completedNow && r.reward === null && r.best === ch.targetDistance - 1 && r.attempts === 1, 'short attempt');
  const coins0 = RR.Save.data.coins, xp0 = RR.Save.data.xp;
  r = D.recordAttempt(ch.targetDistance + 25.6, day);
  H.assert(r.completedNow && deepEq(r.reward, ch.reward) && r.best === ch.targetDistance + 25, 'completed');
  H.assert(RR.Save.data.coins === coins0 + ch.reward.coins && RR.Save.data.xp === xp0 + ch.reward.xp, 'granted');
  H.assert(RR.Save.data.stats.dailyCompleted === 1 && act[0].completed, 'stat + mission');
  r = D.recordAttempt(ch.targetDistance + 500, day);
  H.assert(!r.completedNow && r.reward === null && r.attempts === 3 && RR.Save.data.coins === coins0 + ch.reward.coins, 'reward once');
  st = D.status(day);
  H.assert(st.completed && st.attempts === 3 && st.best === ch.targetDistance + 500, 'status');
  H.assert(JSON.parse(stored(RR, KEY)).daily.completed === true, 'saved');
  // Next day resets.
  const tomorrow = addDays(day, 1);
  H.assert(deepEq(D.status(tomorrow), { day: '2026-08-16', best: 0, attempts: 0, completed: false }), 'rollover');
  r = D.recordAttempt(NaN, tomorrow);
  H.assert(r.best === 0 && r.attempts === 1 && !r.completedNow, 'NaN distance safe');
});

H.test('Bus events: levelup/coins/tokens/upgrade/unlock/missionComplete/missionClaimed/settings/saveReset', () => {
  const RR = fresh();
  const names = ['levelup', 'coins', 'tokens', 'upgrade', 'unlock', 'missionComplete', 'missionClaimed', 'settings', 'saveReset'];
  const log = events(RR, names);
  const P = RR.Progression;
  P.addCoins(100000); P.addTokens(3); setLevel(RR, 2);
  P.upgrade('trail_buggy', 'grip');
  P.unlockVehicle('dirt_runner', 'tokens');
  withMissions(RR, [{ stat: 'coins', mode: 'sum', target: 1 }, { stat: 'coins', mode: 'sum', target: 2 }, { stat: 'coins', mode: 'sum', target: 3 }]);
  RR.Missions.track('coins', 5);
  RR.Missions.claim(RR.Save.data.missions.active[0].id);
  RR.Save.updateSettings({ sound: false });
  RR.Save.reset();
  for (const n of names) H.assert(log.some((e) => e.n === n), 'emitted ' + n);
});

H.done();
