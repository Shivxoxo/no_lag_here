/* RIDGE RUSH — persistence (RR.Save).
 *
 * One JSON document in localStorage under RR.Save.KEY. Every load() and every save() runs the data
 * through sanitize(), so no NaN, negative balance, unknown id or wrong type can survive a round trip.
 *
 * Robustness:
 *  - localStorage missing / throwing (private mode, sandboxed iframe, file:// quirks) → an in-memory
 *    store is used silently for the rest of the session (RR.Save.persistent === false).
 *  - Corrupted JSON (or a non-object) in the primary key → the backup key (written after every
 *    successful save) is tried; if it is also unusable the defaults are used. Either way
 *    RR.Save.recovered = true (RR.Save.restoredFromBackup tells which case happened).
 *
 * Load order: this file loads before RR.Vehicles / RR.Worlds / RR.Progression / RR.MissionTemplates,
 * so those are only consulted at call time; fallbacks mirror the ids fixed by docs/ARCHITECTURE.md.
 *
 * Contract additions (documented, never renames):
 *  - RR.Save.BACKUP_KEY ('ridgeRush.save.v1.bak'), RR.Save.recovered, RR.Save.restoredFromBackup,
 *    RR.Save.persistent (false when running on the in-memory fallback).
 *  - RR.Save.sanitize(raw) → a fresh, fully valid save object built from any input (pure).
 *  - RR.Save.updateSettings(patch) → validated settings; saves and emits 'settings' {settings}.
 *  - RR.Save.upgradeCategories() → ['engine', ..., 'brakes'] (live from RR.Vehicles when present).
 *  - save() returns true when the data was stored (localStorage, or the in-memory fallback when
 *    localStorage is unavailable); false only when a real localStorage write failed (e.g. quota).
 *  - Write failures are not silent: when a localStorage write throws, the backup key is dropped (it
 *    doubles the footprint) and the write retried once; if it still fails the data is kept in memory,
 *    RR.Save.persistent = false, RR.Save.lastError = 'quota' | 'blocked', and Bus 'saveError' {reason}
 *    is emitted (once per session). The next successful write restores persistent = true (lastError
 *    null). When load() finds no usable localStorage at all, 'saveError' {reason:'unavailable'} is
 *    emitted once on the next tick (after the UI has subscribed).
 *  - load() and save() update RR.Save.data IN PLACE (same object identity, nested objects/arrays
 *    patched where possible), so references held by other modules never go stale.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const KEY = 'ridgeRush.save.v1';
  const BACKUP_KEY = 'ridgeRush.save.v1.bak';
  const VERSION = 1;

  // Sane maxima — far above anything reachable legitimately, low enough to stay exact in doubles.
  const MAX_COINS = 999999999;
  const MAX_TOKENS = 9999;
  const MAX_XP = 999999999;
  const MAX_DISTANCE = 10000000;     // 10,000 km
  const MAX_STAT = 1e12;
  const MAX_RAW_LENGTH = 2000000;    // chars; anything larger is treated as corrupt

  // Fallbacks mirroring the contract (used only if the data modules are absent at call time).
  const FALLBACK_VEHICLES = ['trail_buggy', 'dirt_runner', 'mountain_truck', 'rally_beast', 'rock_crawler', 'storm_runner'];
  const FALLBACK_WORLDS = ['green_valley', 'rocky_highlands', 'desert_canyon', 'snow_peaks', 'volcanic_ridge',
    'moon_base', 'neon_city', 'storm_planet'];
  const FALLBACK_CATS = ['engine', 'suspension', 'tires', 'fuel', 'grip', 'air', 'brakes'];
  const STARTER_VEHICLE = 'trail_buggy';
  const STARTER_WORLD = 'green_valley';
  const FACTORY_PAINT = 'paint_factory';
  const MISSION_STATS = ['distance', 'runDistance', 'coins', 'backflips', 'frontflips', 'doubleFlips',
    'perfectLandings', 'fuelCans', 'airTime', 'wheelie', 'combo', 'powerups', 'bossCleared', 'dailyComplete',
    'tricks', 'worldDistance'];

  const STAT_KEYS = ['runs', 'totalDistance', 'coinsCollected', 'backflips', 'frontflips', 'doubleFlips',
    'perfectLandings', 'fuelCollected', 'powerups', 'crashes', 'bossesCleared', 'maxCombo', 'longestAir',
    'missionsCompleted', 'dailyCompleted', 'playTime'];
  // Stats that are counts (integers); the rest (distance, air, time) may be fractional.
  const INT_STATS = new Set(['runs', 'coinsCollected', 'backflips', 'frontflips', 'doubleFlips', 'perfectLandings',
    'fuelCollected', 'powerups', 'crashes', 'bossesCleared', 'maxCombo', 'missionsCompleted', 'dailyCompleted']);

  const QUALITIES = ['low', 'medium', 'high', 'auto']; // 'auto' = HIGH + renderer steps quality down on slow devices
  const TOUCH_MODES = ['auto', 'on', 'off'];
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---------------------------------------------------------------- id catalogues (call time)
  function vehicleIds() {
    const V = RR.Vehicles;
    if (V && Array.isArray(V.list) && V.list.length) return V.list.map((v) => v.id);
    return FALLBACK_VEHICLES;
  }
  function worldIds() {
    const W = RR.Worlds;
    if (W && Array.isArray(W.list) && W.list.length) return W.list.map((w) => w.id);
    return FALLBACK_WORLDS;
  }
  function upgradeCategories() {
    const V = RR.Vehicles;
    if (V && Array.isArray(V.UPGRADE_CATEGORIES) && V.UPGRADE_CATEGORIES.length) {
      return V.UPGRADE_CATEGORIES.map((c) => c.id);
    }
    return FALLBACK_CATS.slice();
  }
  function maxUpgradeLevel() {
    const V = RR.Vehicles;
    return V && U.isNum(V.MAX_UPGRADE_LEVEL) ? V.MAX_UPGRADE_LEVEL : 10;
  }

  // ---------------------------------------------------------------- value sanitizers
  // Finite number in [min, max]; strings holding numbers are NOT accepted (type confusion = invalid).
  function num(v, fallback, min, max) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return U.clamp(v, min, max);
  }
  function int(v, fallback, min, max) {
    const n = num(v, fallback, min, max);
    return Math.floor(n);
  }
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const str = (v, fallback, maxLen) =>
    (typeof v === 'string' && v.length <= (maxLen || 64) ? v : fallback);
  const dayKey = (v) => (typeof v === 'string' && DAY_RE.test(v) ? v : '');

  // Unique known ids from an arbitrary value, in catalogue order (bounded work even for giant arrays).
  function idList(v, known) {
    const out = [];
    if (!Array.isArray(v)) return out;
    const want = new Set();
    const n = Math.min(v.length, 1000);
    for (let i = 0; i < n; i++) if (typeof v[i] === 'string') want.add(v[i]);
    for (const id of known) if (want.has(id)) out.push(id);
    return out;
  }

  // ---------------------------------------------------------------- level from XP
  // Delegates to RR.Progression when loaded; the fallback uses the identical contract curve.
  function levelFromXp(xp) {
    const P = RR.Progression;
    if (P && typeof P.levelInfo === 'function') {
      const info = P.levelInfo(xp);
      if (info && U.isNum(info.level)) return info.level;
    }
    let level = 1, rest = xp;
    while (level < 50) {
      const need = Math.round(150 * Math.pow(level, 1.55) / 10) * 10; // = RR.Progression.xpForLevel
      if (rest < need) break;
      rest -= need;
      level++;
    }
    return level;
  }

  // ---------------------------------------------------------------- defaults
  function defaultUpgrades() {
    const o = {};
    for (const c of upgradeCategories()) o[c] = 1;
    return o;
  }
  function defaultStats() {
    const o = {};
    for (const k of STAT_KEYS) o[k] = 0;
    return o;
  }
  function defaultSettings() {
    return { sound: true, music: true, quality: 'high', sensitivity: 1, reducedMotion: false,
      showFps: false, touchControls: 'auto' };
  }
  function defaults() {
    return {
      version: VERSION,
      coins: 0, tokens: 0, xp: 0, level: 1,
      selectedVehicle: STARTER_VEHICLE, selectedWorld: STARTER_WORLD,
      unlockedVehicles: [STARTER_VEHICLE], unlockedWorlds: [STARTER_WORLD],
      upgrades: { [STARTER_VEHICLE]: defaultUpgrades() },
      bestDistances: {}, bestDistance: 0,
      stats: defaultStats(),
      missions: { day: '', active: [], bonusClaimed: false },
      daily: { day: '', best: 0, attempts: 0, completed: false },
      cosmetics: { unlocked: [FACTORY_PAINT], selected: {} },
      settings: defaultSettings(),
      seenTutorial: false
    };
  }

  // ---------------------------------------------------------------- structural sanitizers
  function sanitizeUpgradeSet(v) {
    const out = defaultUpgrades();
    const maxLv = maxUpgradeLevel();
    if (!isObj(v)) return out;
    for (const c of Object.keys(out)) out[c] = int(v[c], 1, 1, maxLv);
    return out;
  }

  function sanitizeSettings(v) {
    const d = defaultSettings();
    if (!isObj(v)) return d;
    return {
      sound: bool(v.sound, d.sound),
      music: bool(v.music, d.music),
      quality: QUALITIES.indexOf(v.quality) >= 0 ? v.quality : d.quality,
      sensitivity: Math.round(num(v.sensitivity, d.sensitivity, 0.5, 1.5) * 100) / 100,
      reducedMotion: bool(v.reducedMotion, d.reducedMotion),
      showFps: bool(v.showFps, d.showFps),
      touchControls: TOUCH_MODES.indexOf(v.touchControls) >= 0 ? v.touchControls : d.touchControls
    };
  }

  // A MissionInstance is kept only if it is structurally sound; returns null otherwise.
  function sanitizeMission(m, worlds) {
    if (!isObj(m)) return null;
    const T = RR.MissionTemplates;
    const id = str(m.id, null, 64);
    const templateId = str(m.templateId, null, 64);
    if (!id || !templateId) return null;
    if (T && typeof T.byId === 'function' && !T.byId(templateId)) return null;
    const stats = (T && Array.isArray(T.STAT_KEYS)) ? T.STAT_KEYS : MISSION_STATS;
    if (stats.indexOf(m.stat) < 0) return null;
    if (m.mode !== 'sum' && m.mode !== 'max') return null;
    const target = num(m.target, NaN, 0, 1e7);
    if (!(target > 0)) return null;
    const text = str(m.text, null, 200);
    if (!text) return null;
    const out = {
      id, templateId, text, stat: m.stat, mode: m.mode, target,
      progress: num(m.progress, 0, 0, target),
      reward: {
        coins: int(isObj(m.reward) ? m.reward.coins : 0, 0, 0, 100000),
        xp: int(isObj(m.reward) ? m.reward.xp : 0, 0, 0, 100000),
        tokens: int(isObj(m.reward) ? m.reward.tokens : 0, 0, 0, 5)
      },
      completed: false,
      claimed: false
    };
    out.completed = out.progress >= target;
    out.claimed = bool(m.claimed, false) && out.completed;
    if (m.stat === 'worldDistance') {
      if (worlds.indexOf(m.worldId) < 0) return null;
      out.worldId = m.worldId;
    }
    // Optional presentation fields added by RR.Missions.
    if (typeof m.icon === 'string' && m.icon.length <= 8) out.icon = m.icon;
    if (U.isNum(m.tier)) out.tier = int(m.tier, 0, 0, 10);
    if (U.isNum(m.difficulty)) out.difficulty = int(m.difficulty, 1, 1, 5);
    return out;
  }

  function sanitizeMissions(v, worlds) {
    const empty = { day: '', active: [], bonusClaimed: false };
    if (!isObj(v)) return empty;
    const day = dayKey(v.day);
    if (!day || !Array.isArray(v.active) || v.active.length !== 3) return empty;
    const active = [];
    const ids = new Set();
    for (const m of v.active) {
      const clean = sanitizeMission(m, worlds);
      if (!clean || ids.has(clean.id)) return empty; // any bad entry → regenerate the whole set
      ids.add(clean.id);
      active.push(clean);
    }
    const allClaimed = active.every((m) => m.claimed);
    return { day, active, bonusClaimed: bool(v.bonusClaimed, false) && allClaimed };
  }

  function sanitizeDaily(v) {
    const empty = { day: '', best: 0, attempts: 0, completed: false };
    if (!isObj(v)) return empty;
    const day = dayKey(v.day);
    if (!day) return empty;
    return {
      day,
      best: Math.floor(num(v.best, 0, 0, MAX_DISTANCE)),
      attempts: int(v.attempts, 0, 0, 1e6),
      completed: bool(v.completed, false)
    };
  }

  function sanitizeCosmetics(v, level, vehicles) {
    const P = RR.Progression;
    const list = P && Array.isArray(P.COSMETICS) && P.COSMETICS.length ? P.COSMETICS : null;
    let unlocked;
    const raw = isObj(v) ? v.unlocked : null;
    if (list) {
      unlocked = idList(raw, list.map((c) => c.id));
      // Level-based paints are always granted (repairs saves edited by hand or older builds).
      for (const c of list) if (c.level <= level && unlocked.indexOf(c.id) < 0) unlocked.push(c.id);
      // Keep catalogue order for a stable UI.
      const order = list.map((c) => c.id);
      unlocked.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    } else {
      unlocked = [];
      if (Array.isArray(raw)) {
        const n = Math.min(raw.length, 1000);
        for (let i = 0; i < n && unlocked.length < 64; i++) {
          const id = raw[i];
          if (typeof id === 'string' && /^paint_[a-z0-9_]{1,32}$/.test(id) && unlocked.indexOf(id) < 0) unlocked.push(id);
        }
      }
    }
    if (unlocked.indexOf(FACTORY_PAINT) < 0) unlocked.unshift(FACTORY_PAINT);
    const selected = {};
    const rawSel = isObj(v) && isObj(v.selected) ? v.selected : {};
    for (const vid of vehicles) {
      if (hasOwn(rawSel, vid) && typeof rawSel[vid] === 'string' && unlocked.indexOf(rawSel[vid]) >= 0) {
        selected[vid] = rawSel[vid];
      }
    }
    return { unlocked, selected };
  }

  // Build a complete, valid save object from anything (pure; never throws for JSON-like input).
  function sanitize(raw) {
    const src = isObj(raw) ? raw : {};
    const vehicles = vehicleIds();
    const worlds = worldIds();
    const out = defaults();

    out.coins = int(src.coins, 0, 0, MAX_COINS);
    out.tokens = int(src.tokens, 0, 0, MAX_TOKENS);
    out.xp = int(src.xp, 0, 0, MAX_XP);
    out.level = levelFromXp(out.xp); // never trusted from disk

    out.unlockedVehicles = idList(src.unlockedVehicles, vehicles);
    if (out.unlockedVehicles.indexOf(STARTER_VEHICLE) < 0) out.unlockedVehicles.unshift(STARTER_VEHICLE);
    out.unlockedWorlds = idList(src.unlockedWorlds, worlds);
    if (out.unlockedWorlds.indexOf(STARTER_WORLD) < 0) out.unlockedWorlds.unshift(STARTER_WORLD);

    out.selectedVehicle = out.unlockedVehicles.indexOf(src.selectedVehicle) >= 0 ? src.selectedVehicle : STARTER_VEHICLE;
    out.selectedWorld = out.unlockedWorlds.indexOf(src.selectedWorld) >= 0 ? src.selectedWorld : STARTER_WORLD;

    // Upgrades: known vehicles only; every unlocked vehicle gets a full set.
    out.upgrades = {};
    const rawUp = isObj(src.upgrades) ? src.upgrades : {};
    for (const vid of vehicles) {
      if (hasOwn(rawUp, vid) || out.unlockedVehicles.indexOf(vid) >= 0) out.upgrades[vid] = sanitizeUpgradeSet(rawUp[vid]);
    }

    out.bestDistances = {};
    const rawBest = isObj(src.bestDistances) ? src.bestDistances : {};
    let best = Math.floor(num(src.bestDistance, 0, 0, MAX_DISTANCE));
    for (const wid of worlds) {
      if (!hasOwn(rawBest, wid)) continue;
      const d = Math.floor(num(rawBest[wid], 0, 0, MAX_DISTANCE));
      if (d > 0) out.bestDistances[wid] = d;
      if (d > best) best = d;
    }
    out.bestDistance = best;

    const rawStats = isObj(src.stats) ? src.stats : {};
    for (const k of STAT_KEYS) {
      const n = num(rawStats[k], 0, 0, MAX_STAT);
      out.stats[k] = INT_STATS.has(k) ? Math.floor(n) : n;
    }

    out.missions = sanitizeMissions(src.missions, worlds);
    out.daily = sanitizeDaily(src.daily);
    out.cosmetics = sanitizeCosmetics(src.cosmetics, out.level, vehicles);
    out.settings = sanitizeSettings(src.settings);
    out.seenTutorial = bool(src.seenTutorial, false);
    return out;
  }

  // ---------------------------------------------------------------- in-place update
  // Copies `src` into `target` keeping object identities where the shape allows it.
  function syncInPlace(target, src) {
    for (const k of Object.keys(target)) if (!hasOwn(src, k)) delete target[k];
    for (const k of Object.keys(src)) {
      const a = target[k], b = src[k];
      if (isObj(a) && isObj(b)) syncInPlace(a, b);
      else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
               b.every((x, i) => isObj(x) && isObj(a[i]))) {
        for (let i = 0; i < b.length; i++) syncInPlace(a[i], b[i]);
      } else target[k] = b;
    }
    return target;
  }

  // ---------------------------------------------------------------- storage
  const memoryStore = new Map();
  const memory = {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => { memoryStore.set(k, String(v)); },
    removeItem: (k) => { memoryStore.delete(k); }
  };
  let store = null;

  // Probe localStorage (accessing it can itself throw a SecurityError). Falls back to memory.
  function probeStorage() {
    try {
      const ls = window.localStorage;
      if (!ls) throw new Error('no localStorage');
      const probe = '__rr_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      store = ls;
      Save.persistent = true;
    } catch (e) {
      store = memory;
      Save.persistent = false;
    }
    return store;
  }
  const getStore = () => store || probeStorage();

  // 'saveError' is announced at most once per session (the UI shows one toast).
  let errorAnnounced = false;
  function announceError(reason) {
    if (errorAnnounced) return;
    errorAnnounced = true;
    if (RR.Bus) RR.Bus.emit('saveError', { reason });
  }

  function readRaw(key) {
    try {
      return getStore().getItem(key);
    } catch (e) {
      store = memory;
      Save.persistent = false;
      return memory.getItem(key);
    }
  }

  // → parsed plain object, or null when missing/corrupt.
  function parseRaw(raw) {
    if (typeof raw !== 'string' || !raw.length || raw.length > MAX_RAW_LENGTH) return null;
    try {
      const obj = JSON.parse(raw);
      return isObj(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- public API
  const Save = {
    KEY,
    BACKUP_KEY,
    data: defaults(),
    recovered: false,
    restoredFromBackup: false,
    persistent: true,
    lastError: null,

    defaults,
    sanitize,
    upgradeCategories,

    load() {
      probeStorage();
      Save.recovered = false;
      Save.restoredFromBackup = false;
      const raw = readRaw(KEY);
      let obj = null;
      if (raw !== null && raw !== undefined) {
        obj = parseRaw(raw);
        if (!obj) {
          Save.recovered = true;
          obj = parseRaw(readRaw(BACKUP_KEY));
          if (obj) Save.restoredFromBackup = true;
        }
      }
      let clean;
      try {
        clean = sanitize(obj);
      } catch (e) {
        clean = defaults();
        Save.recovered = true;
        Save.restoredFromBackup = false;
      }
      syncInPlace(Save.data, clean);
      if (Save.restoredFromBackup) Save.save(); // repair the primary key
      if (!Save.persistent && store === memory) {
        Save.lastError = 'unavailable';
        setTimeout(() => announceError('unavailable'), 0); // after UI init has subscribed
      }
      return Save.data;
    },

    save() {
      let json;
      try {
        const clean = sanitize(Save.data);
        syncInPlace(Save.data, clean); // heal any bad value another module may have written
        json = JSON.stringify(clean);
      } catch (e) {
        return false;
      }
      const s = getStore();
      if (s === memory) { memory.setItem(KEY, json); return true; }
      try {
        s.setItem(KEY, json);
      } catch (e) {
        // Quota: the backup copy doubles our footprint — drop it and retry once.
        let err = e;
        try {
          s.removeItem(BACKUP_KEY);
          s.setItem(KEY, json);
          err = null;
        } catch (e2) { err = e2; }
        if (err) {
          memory.setItem(KEY, json); // the session keeps working on the in-memory copy
          Save.persistent = false;
          Save.lastError = err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014) ? 'quota' : 'blocked';
          announceError(Save.lastError);
          return false;
        }
        Save.persistent = true;
        Save.lastError = null;
        return true; // primary stored; no room for a backup this time
      }
      Save.persistent = true;
      Save.lastError = null;
      try { s.setItem(BACKUP_KEY, json); } catch (e) { /* primary is fine; backup is best-effort */ }
      return true;
    },

    reset() {
      syncInPlace(Save.data, defaults());
      Save.recovered = false;
      Save.restoredFromBackup = false;
      Save.save();
      RR.Bus.emit('saveReset', {});
      return Save.data;
    },

    ensureVehicle(vehicleId) {
      if (vehicleIds().indexOf(vehicleId) < 0) return defaultUpgrades(); // unknown: detached, not stored
      const d = Save.data;
      if (!isObj(d.upgrades)) d.upgrades = {};
      d.upgrades[vehicleId] = isObj(d.upgrades[vehicleId])
        ? syncInPlace(d.upgrades[vehicleId], sanitizeUpgradeSet(d.upgrades[vehicleId]))
        : defaultUpgrades();
      return d.upgrades[vehicleId];
    },

    updateSettings(patch) {
      const merged = Object.assign({}, Save.data.settings, isObj(patch) ? patch : {});
      Save.data.settings = sanitizeSettings(merged);
      Save.save();
      RR.Bus.emit('settings', { settings: Save.data.settings });
      return Save.data.settings;
    }
  };

  RR.Save = Save;
})();
