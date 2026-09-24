/* RIDGE RUSH — economy & meta-progression (RR.Progression).
 *
 * Owns XP / levels, coins & tokens, the upgrade flow (with level-gated upgrade tiers), vehicle and
 * world unlocks, paint jobs (cosmetics) and turning a finished run into rewards.
 * All state lives in RR.Save.data; every mutating call saves (batched where several happen at once).
 *
 * Decisions (documented):
 *  - Daily-challenge runs (mode 'daily') count toward the world's best distance and the overall best
 *    like normal runs (the in-run BEST flag uses the world best, so they stay consistent). The daily
 *    challenge keeps its own best in RR.Save.data.daily (RR.Daily.recordAttempt, called by the shell).
 *  - Best distances are stored as whole meters; a run is a record when floor(distance) > best.
 *  - stats.doubleFlips counts double + triple flips; stats.longestAir uses summary.longestAir when
 *    provided, else summary.airTime (the RunSummary field of the contract).
 *  - Progression plays no sounds; the UI reacts to the Bus events (levelup, coins, upgrade, unlock…).
 *
 * Contract additions (documented, never renames):
 *  - levelInfo() also returns {totalXp, isMax}; xpToReachLevel(level) → cumulative XP for a level.
 *  - LEVEL_REWARDS (getter) → {level: rewards[]} for levels 2..MAX_LEVEL.
 *  - canUpgrade()/upgrade(): reason also 'unknown' (bad vehicle/category id); cost is 0 at 'max'.
 *  - vehicleStatus() also returns {requiredLevel, coins, tokens}; worldStatus() {requiredLevel, coins}.
 *    requirementText is '' for unlocked items.
 *  - unlockVehicle()/unlockWorld() reasons: 'unknown' | 'owned' | 'level' | 'coins' | 'tokens' | 'method'.
 *  - COSMETICS entries also carry {desc}; isPaintUnlocked(paintId); selectedPaint(vehicleId) → paintId.
 *  - batch(fn): runs fn with saving deferred to a single write at the end (used by Missions/Daily).
 *  - applyRunResults() on an ignored run (attract / invalid) returns zeroed rewards with ignored:true.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const MAX_LEVEL = 50;
  const MAX_COINS = 999999999;
  const MAX_TOKENS = 9999;
  const MAX_XP = 999999999;
  const RECORD_XP = 250;
  const RECORD_MIN_DISTANCE = 100;

  const S = () => {
    if (!RR.Save.data) RR.Save.load();
    return RR.Save.data;
  };
  const emit = (evt, payload) => { if (RR.Bus) RR.Bus.emit(evt, payload); };
  const nonNeg = (v, max) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    return U.clamp(n, 0, max);
  };

  // ---------------------------------------------------------------- save batching
  let batchDepth = 0;
  let dirty = false;
  function persist() {
    if (batchDepth > 0) dirty = true;
    else RR.Save.save();
  }
  function batch(fn) {
    batchDepth++;
    try {
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0 && dirty) {
        dirty = false;
        RR.Save.save();
      }
    }
  }

  // ---------------------------------------------------------------- XP curve
  // XP needed to go from `level` to `level + 1` (contract formula).
  function xpForLevel(level) {
    const l = U.clamp(Math.floor(U.safeNum(level, 1)), 1, MAX_LEVEL);
    return Math.round(200 * Math.pow(l, 1.4) / 10) * 10;
  }
  // CUM[l] = total XP required to reach level l (CUM[1] = 0).
  const CUM = new Array(MAX_LEVEL + 1).fill(0);
  for (let l = 2; l <= MAX_LEVEL; l++) CUM[l] = CUM[l - 1] + xpForLevel(l - 1);
  const xpToReachLevel = (level) => CUM[U.clamp(Math.floor(U.safeNum(level, 1)), 1, MAX_LEVEL)];

  function levelInfo(totalXp) {
    let xp = totalXp === undefined ? S().xp : totalXp;
    xp = nonNeg(xp, MAX_XP);
    let level = 1;
    while (level < MAX_LEVEL && xp >= CUM[level + 1]) level++;
    const isMax = level >= MAX_LEVEL;
    const xpNext = xpForLevel(level);
    const xpInto = isMax ? xpNext : xp - CUM[level];
    return { level, xpInto, xpNext, progress: isMax ? 1 : U.clamp(xpInto / xpNext, 0, 1), totalXp: xp, isMax };
  }

  // ---------------------------------------------------------------- upgrade tiers
  const maxUpgradeLevel = (playerLevel) => (playerLevel < 5 ? 4 : playerLevel < 12 ? 7 : 10);
  const requiredLevelForUpgrade = (targetLevel) => (targetLevel <= 4 ? 1 : targetLevel <= 7 ? 5 : 12);
  const TIERS = [
    { level: 5, id: 'tier2', text: 'Upgrade Tier II — upgrades up to level 7' },
    { level: 12, id: 'tier3', text: 'Upgrade Tier III — upgrades up to level 10' }
  ];

  // ---------------------------------------------------------------- cosmetics
  const paint = (id, name, level, desc, colors) => Object.freeze({
    id, name, level, desc, colors: colors ? Object.freeze(colors) : null
  });
  const COSMETICS = Object.freeze([
    paint('paint_factory', 'Factory', 1, 'The original livery each machine left the workshop with.', null),
    paint('paint_sunburst', 'Sunburst', 2, 'Warm orange fading into sunrise yellow.',
      { body: '#ff8a1f', accent: '#ffd23f', trim: '#5a2a0c', wheel: '#221a14', rim: '#ffe7a3' }),
    paint('paint_glacier', 'Glacier', 3, 'Ice-white panels with frosty blue edges.',
      { body: '#e8f4ff', accent: '#6ec6ff', trim: '#2f5673', wheel: '#1c2530', rim: '#bfe3ff' }),
    paint('paint_jungle', 'Jungle Camo', 5, 'Leafy greens for the back-country explorer.',
      { body: '#4f6b2f', accent: '#a3b86c', trim: '#2c3a1b', wheel: '#1b1f16', rim: '#c9b27a' }),
    paint('paint_midnight', 'Midnight', 6, 'Deep navy with a silver pinstripe.',
      { body: '#141c3a', accent: '#c0c8dc', trim: '#0a0f22', wheel: '#0d0f16', rim: '#8e9ab8' }),
    paint('paint_lava', 'Lava Flow', 8, 'Molten red with glowing ember highlights.',
      { body: '#a3140c', accent: '#ff7a1a', trim: '#2a0906', wheel: '#170908', rim: '#ffb347' }),
    paint('paint_bubblegum', 'Bubblegum', 9, 'Candy pink with minty accents. Loud and proud.',
      { body: '#ff6fb5', accent: '#7fffd4', trim: '#5c1f45', wheel: '#221520', rim: '#fff0f8' }),
    paint('paint_aurora', 'Aurora', 11, 'Teal and violet, like northern lights.',
      { body: '#1fb5a3', accent: '#9b5cff', trim: '#0d3a3a', wheel: '#101a1e', rim: '#c7fff4' }),
    paint('paint_carbon', 'Carbon', 13, 'Matte carbon weave with race-red details.',
      { body: '#2a2c30', accent: '#ff3b3b', trim: '#121316', wheel: '#0c0c0e', rim: '#5d6168' }),
    paint('paint_neon', 'Neon Pulse', 15, 'Electric magenta and cyan straight from the city grid.',
      { body: '#1a0b2e', accent: '#ff2bd6', trim: '#3ff3ff', wheel: '#0b0714', rim: '#3ff3ff' }),
    paint('paint_chrome', 'Chrome', 18, 'Mirror-polished steel. Blinding in the sun.',
      { body: '#c9d1d9', accent: '#f5f7fa', trim: '#6b7580', wheel: '#1f2328', rim: '#ffffff' }),
    paint('paint_storm', 'Thunderhead', 22, 'Storm grey split by a lightning-yellow stripe.',
      { body: '#4a5566', accent: '#ffe23a', trim: '#232a33', wheel: '#15181d', rim: '#aab6c6' }),
    paint('paint_gold', 'Gold Rush', 26, 'Solid gold for the true mountain master.',
      { body: '#d4a017', accent: '#fff1a8', trim: '#6b4f08', wheel: '#241c08', rim: '#ffe066' }),
    paint('paint_cosmic', 'Cosmic', 30, 'A starfield of deep purple and nebula blue.',
      { body: '#2d1b69', accent: '#5ee7ff', trim: '#f7c8ff', wheel: '#120b24', rim: '#b8a7ff' })
  ]);
  const cosmeticById = new Map(COSMETICS.map((c) => [c.id, c]));
  const FALLBACK_COLORS = Object.freeze({ body: '#f2a007', accent: '#e8412c', trim: '#2b2f36', wheel: '#1d1f24', rim: '#d9dde3' });

  function isPaintUnlocked(paintId) {
    const c = S().cosmetics;
    return !!c && Array.isArray(c.unlocked) && c.unlocked.indexOf(paintId) >= 0;
  }
  function selectedPaint(vehicleId) {
    const sel = S().cosmetics.selected || {};
    const id = sel[vehicleId];
    return id && cosmeticById.has(id) && isPaintUnlocked(id) ? id : 'paint_factory';
  }
  function getPaint(vehicleId) {
    const def = RR.Vehicles && RR.Vehicles.byId(vehicleId);
    const base = (def && def.colors) || FALLBACK_COLORS;
    const out = { body: base.body, accent: base.accent, trim: base.trim, wheel: base.wheel, rim: base.rim };
    const p = cosmeticById.get(selectedPaint(vehicleId));
    if (p && p.colors) Object.assign(out, p.colors);
    return out;
  }
  function selectPaint(vehicleId, paintId) {
    if (!RR.Vehicles || !RR.Vehicles.byId(vehicleId)) return false;
    if (!cosmeticById.has(paintId) || !isPaintUnlocked(paintId)) return false;
    S().cosmetics.selected[vehicleId] = paintId;
    persist();
    return true;
  }
  // Grants every paint whose level ≤ `level`; returns the ids newly unlocked.
  function unlockLevelCosmetics(level) {
    const c = S().cosmetics;
    const fresh = [];
    for (const p of COSMETICS) {
      if (p.level <= level && c.unlocked.indexOf(p.id) < 0) {
        c.unlocked.push(p.id);
        fresh.push(p.id);
      }
    }
    return fresh;
  }

  // ---------------------------------------------------------------- level rewards
  let levelRewardsCache = null;
  function buildLevelRewards() {
    const map = {};
    for (let l = 2; l <= MAX_LEVEL; l++) map[l] = [];
    const vehicles = RR.Vehicles ? RR.Vehicles.list : [];
    for (const v of vehicles) {
      const l = v.unlock && v.unlock.level;
      if (l > 1 && l <= MAX_LEVEL) map[l].push({ type: 'vehicle', id: v.id, text: 'New vehicle available: ' + v.name });
    }
    const worlds = RR.Worlds ? RR.Worlds.list : [];
    for (const w of worlds) {
      const l = w.unlock && w.unlock.level;
      if (l > 1 && l <= MAX_LEVEL) map[l].push({ type: 'world', id: w.id, text: 'New world available: ' + w.name });
    }
    for (const t of TIERS) map[t.level].push({ type: 'upgradeTier', id: t.id, text: t.text });
    for (const p of COSMETICS) {
      if (p.level > 1 && p.level <= MAX_LEVEL) map[p.level].push({ type: 'cosmetic', id: p.id, text: 'New paint job: ' + p.name });
    }
    return map;
  }
  function levelRewards() {
    // Rebuilt until both catalogues are present (they load after this file in some test setups).
    if (!levelRewardsCache || !levelRewardsCache.complete) {
      levelRewardsCache = { map: buildLevelRewards(), complete: !!(RR.Vehicles && RR.Worlds) };
    }
    return levelRewardsCache.map;
  }
  function rewardsForLevel(level) {
    const list = levelRewards()[Math.floor(U.safeNum(level, 0))];
    return list ? list.map((r) => Object.assign({}, r)) : [];
  }

  // ---------------------------------------------------------------- currencies & XP
  function addCoins(n) {
    const d = S();
    const add = nonNeg(n, MAX_COINS);
    if (add <= 0) return d.coins;
    d.coins = Math.min(MAX_COINS, d.coins + add);
    emit('coins', { coins: d.coins });
    persist();
    return d.coins;
  }
  function spendCoins(n) {
    const d = S();
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false;
    const cost = Math.ceil(n);
    if (cost > d.coins) return false;
    d.coins -= cost;
    emit('coins', { coins: d.coins });
    persist();
    return true;
  }
  function addTokens(n) {
    const d = S();
    const add = nonNeg(n, MAX_TOKENS);
    if (add <= 0) return d.tokens;
    d.tokens = Math.min(MAX_TOKENS, d.tokens + add);
    emit('tokens', { tokens: d.tokens });
    persist();
    return d.tokens;
  }
  function spendTokens(n) {
    const d = S();
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false;
    const cost = Math.ceil(n);
    if (cost > d.tokens) return false;
    d.tokens -= cost;
    emit('tokens', { tokens: d.tokens });
    persist();
    return true;
  }

  function addXp(n) {
    const d = S();
    const add = nonNeg(n, MAX_XP);
    const before = levelInfo(d.xp).level;
    d.xp = Math.min(MAX_XP, d.xp + add);
    const after = levelInfo(d.xp).level;
    d.level = after;
    const all = [];
    for (let l = before + 1; l <= after; l++) {
      unlockLevelCosmetics(l);
      const rewards = rewardsForLevel(l);
      for (const r of rewards) all.push(r);
      emit('levelup', { level: l, rewards });
    }
    if (add > 0) persist();
    return { levelsGained: after - before, level: after, rewards: all };
  }

  // ---------------------------------------------------------------- upgrades
  function categoryIds() {
    return RR.Vehicles && RR.Vehicles.UPGRADE_CATEGORIES
      ? RR.Vehicles.UPGRADE_CATEGORIES.map((c) => c.id)
      : RR.Save.upgradeCategories();
  }
  function canUpgrade(vehicleId, catId) {
    const d = S();
    const V = RR.Vehicles;
    const maxLv = (V && V.MAX_UPGRADE_LEVEL) || 10;
    const out = { ok: false, reason: '', cost: 0, level: 1, requiredLevel: 1 };
    if (!V || !V.byId(vehicleId) || categoryIds().indexOf(catId) < 0) { out.reason = 'unknown'; return out; }
    if (d.unlockedVehicles.indexOf(vehicleId) < 0) {
      out.reason = 'locked';
      const ups = d.upgrades[vehicleId];
      out.level = ups && U.isNum(ups[catId]) ? ups[catId] : 1;
      out.cost = out.level >= maxLv ? 0 : V.upgradeCost(vehicleId, catId, out.level);
      out.requiredLevel = requiredLevelForUpgrade(out.level + 1);
      return out;
    }
    const level = RR.Save.ensureVehicle(vehicleId)[catId];
    out.level = level;
    if (level >= maxLv) { out.reason = 'max'; out.requiredLevel = requiredLevelForUpgrade(maxLv); return out; }
    out.cost = V.upgradeCost(vehicleId, catId, level);
    if (!Number.isFinite(out.cost)) { out.reason = 'max'; out.cost = 0; return out; }
    out.requiredLevel = requiredLevelForUpgrade(level + 1);
    if (d.level < out.requiredLevel) { out.reason = 'tier'; return out; }
    if (d.coins < out.cost) { out.reason = 'coins'; return out; }
    out.ok = true;
    return out;
  }
  function upgrade(vehicleId, catId) {
    const res = canUpgrade(vehicleId, catId);
    res.newLevel = res.level;
    if (!res.ok) return res;
    return batch(() => {
      if (!spendCoins(res.cost)) { res.ok = false; res.reason = 'coins'; return res; }
      const ups = RR.Save.ensureVehicle(vehicleId);
      ups[catId] = res.level + 1;
      res.newLevel = ups[catId];
      emit('upgrade', { vehicleId, catId, level: res.newLevel });
      persist();
      return res;
    });
  }

  // ---------------------------------------------------------------- unlocks
  const fmt = (n) => U.formatInt(n);
  const plural = (n, word) => fmt(n) + ' ' + word + (n === 1 ? '' : 's');

  function vehicleStatus(vehicleId) {
    const d = S();
    const def = RR.Vehicles && RR.Vehicles.byId(vehicleId);
    if (!def) return { unlocked: false, levelOk: false, canCoins: false, canTokens: false, requirementText: 'Unknown vehicle', requiredLevel: 0, coins: 0, tokens: 0 };
    const u = def.unlock || { level: 1, coins: 0, tokens: 0 };
    const unlocked = d.unlockedVehicles.indexOf(vehicleId) >= 0;
    const levelOk = d.level >= u.level;
    const coins = u.coins || 0, tokens = u.tokens || 0;
    const price = tokens > 0 ? fmt(coins) + ' coins or ' + plural(tokens, 'token') : fmt(coins) + ' coins';
    let requirementText = '';
    if (!unlocked) {
      requirementText = levelOk
        ? 'Level ' + u.level + ' reached — unlock for ' + price
        : 'Reach Level ' + u.level + ' · then ' + price;
    }
    return {
      unlocked, levelOk,
      canCoins: !unlocked && levelOk && d.coins >= coins,
      canTokens: !unlocked && levelOk && tokens > 0 && d.tokens >= tokens,
      requirementText, requiredLevel: u.level, coins, tokens
    };
  }
  function unlockVehicle(vehicleId, method) {
    const def = RR.Vehicles && RR.Vehicles.byId(vehicleId);
    if (!def) return { ok: false, reason: 'unknown' };
    const st = vehicleStatus(vehicleId);
    if (st.unlocked) return { ok: false, reason: 'owned' };
    if (!st.levelOk) return { ok: false, reason: 'level' };
    if (method !== 'coins' && method !== 'tokens') return { ok: false, reason: 'method' };
    if (method === 'coins' && !st.canCoins) return { ok: false, reason: 'coins' };
    if (method === 'tokens' && !st.canTokens) return { ok: false, reason: 'tokens' };
    return batch(() => {
      const paid = method === 'coins' ? spendCoins(st.coins) : spendTokens(st.tokens);
      if (!paid) return { ok: false, reason: method };
      S().unlockedVehicles.push(vehicleId);
      RR.Save.ensureVehicle(vehicleId);
      emit('unlock', { kind: 'vehicle', id: vehicleId });
      persist();
      return { ok: true, reason: '' };
    });
  }

  function worldStatus(worldId) {
    const d = S();
    const w = RR.Worlds && RR.Worlds.byId(worldId);
    if (!w) return { unlocked: false, levelOk: false, canBuy: false, requirementText: 'Unknown world', requiredLevel: 0, coins: 0 };
    const u = w.unlock || { level: 1, coins: 0 };
    const unlocked = d.unlockedWorlds.indexOf(worldId) >= 0;
    const levelOk = d.level >= u.level;
    const coins = u.coins || 0;
    let requirementText = '';
    if (!unlocked) {
      requirementText = levelOk
        ? 'Level ' + u.level + ' reached — unlock for ' + fmt(coins) + ' coins'
        : 'Reach Level ' + u.level + ' · then ' + fmt(coins) + ' coins';
    }
    return { unlocked, levelOk, canBuy: !unlocked && levelOk && d.coins >= coins, requirementText, requiredLevel: u.level, coins };
  }
  function unlockWorld(worldId) {
    const st = worldStatus(worldId);
    if (!RR.Worlds || !RR.Worlds.byId(worldId)) return { ok: false, reason: 'unknown' };
    if (st.unlocked) return { ok: false, reason: 'owned' };
    if (!st.levelOk) return { ok: false, reason: 'level' };
    if (!st.canBuy) return { ok: false, reason: 'coins' };
    return batch(() => {
      if (!spendCoins(st.coins)) return { ok: false, reason: 'coins' };
      S().unlockedWorlds.push(worldId);
      emit('unlock', { kind: 'world', id: worldId });
      persist();
      return { ok: true, reason: '' };
    });
  }

  function selectVehicle(id) {
    const d = S();
    if (d.unlockedVehicles.indexOf(id) < 0) return false;
    d.selectedVehicle = id;
    persist();
    return true;
  }
  function selectWorld(id) {
    const d = S();
    if (d.unlockedWorlds.indexOf(id) < 0) return false;
    d.selectedWorld = id;
    persist();
    return true;
  }

  // ---------------------------------------------------------------- run results
  const num0 = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? U.clamp(v, 0, max) : 0);

  function zeroRewards(previousBest) {
    return {
      coins: 0, bonusCoins: 0, totalCoins: 0, tokens: 0,
      xp: { distance: 0, coins: 0, tricks: 0, boss: 0, record: 0, total: 0 },
      newRecord: false, newWorldRecord: false, previousBest: previousBest || 0
    };
  }
  const isRewardable = (s) => s !== null && typeof s === 'object' && s.mode !== 'attract';

  function computeRunRewards(summary) {
    const d = S();
    const worldId = summary && RR.Worlds && RR.Worlds.byId(summary.worldId) ? summary.worldId : null;
    const previousBest = worldId ? (d.bestDistances[worldId] || 0) : 0;
    if (!isRewardable(summary)) return zeroRewards(previousBest);

    const distance = Math.floor(num0(summary.distance, 1e7));
    const coins = Math.floor(num0(summary.coins, 1e7));
    const bonusCoins = Math.floor(num0(summary.bonusCoins, 1e7));
    const totalCoins = coins + bonusCoins;
    const tokens = Math.floor(num0(summary.tokens, 10));
    const newWorldRecord = !!worldId && distance > previousBest;
    const newRecord = distance > d.bestDistance;
    const xp = {
      distance: Math.floor(distance / 10),
      coins: Math.floor(totalCoins / 25),
      tricks: Math.floor(num0(summary.trickXp, 1e6)),
      boss: Math.floor(num0(summary.bossXp, 1e6)),
      record: newWorldRecord && distance >= RECORD_MIN_DISTANCE ? RECORD_XP : 0,
      total: 0
    };
    xp.total = xp.distance + xp.coins + xp.tricks + xp.boss + xp.record;
    return { coins, bonusCoins, totalCoins, tokens, xp, newRecord, newWorldRecord, previousBest };
  }

  function applyRunResults(summary) {
    const rewards = computeRunRewards(summary);
    if (!isRewardable(summary)) {
      rewards.ignored = true;
      rewards.levelUp = { levelsGained: 0, level: S().level, rewards: [] };
      return rewards;
    }
    return batch(() => {
      const d = S();
      const distance = Math.floor(num0(summary.distance, 1e7));
      addCoins(rewards.totalCoins);
      addTokens(rewards.tokens);

      if (rewards.newWorldRecord) d.bestDistances[summary.worldId] = distance;
      if (distance > d.bestDistance) d.bestDistance = distance;

      const st = d.stats;
      const tr = summary.tricks && typeof summary.tricks === 'object' ? summary.tricks : {};
      const cnt = (v) => Math.floor(num0(typeof v === 'boolean' ? (v ? 1 : 0) : v, 1e6));
      st.runs += 1;
      st.totalDistance += num0(summary.distance, 1e7);
      st.coinsCollected += rewards.coins;
      st.backflips += cnt(tr.backflip);
      st.frontflips += cnt(tr.frontflip);
      st.doubleFlips += cnt(tr.doubleFlip) + cnt(tr.tripleFlip);
      st.perfectLandings += cnt(U.isNum(summary.perfectLandings) ? summary.perfectLandings : tr.perfect);
      st.fuelCollected += cnt(summary.fuelCollected);
      st.powerups += cnt(summary.powerups);
      if (summary.endReason === 'crash') st.crashes += 1;
      st.bossesCleared += cnt(summary.bossCleared);
      st.maxCombo = Math.max(st.maxCombo, cnt(summary.maxCombo));
      const air = U.isNum(summary.longestAir) ? summary.longestAir : summary.airTime;
      st.longestAir = Math.max(st.longestAir, num0(air, 600));
      st.playTime += num0(summary.time, 86400);

      rewards.levelUp = addXp(rewards.xp.total);
      persist();
      return rewards;
    });
  }

  // ---------------------------------------------------------------- export
  const Progression = {
    MAX_LEVEL,
    COSMETICS,
    xpForLevel, xpToReachLevel, levelInfo, addXp,
    addCoins, spendCoins, addTokens, spendTokens,
    maxUpgradeLevel, requiredLevelForUpgrade, canUpgrade, upgrade,
    vehicleStatus, unlockVehicle, worldStatus, unlockWorld, selectVehicle, selectWorld,
    getPaint, selectPaint, isPaintUnlocked, selectedPaint,
    rewardsForLevel, computeRunRewards, applyRunResults,
    batch
  };
  Object.defineProperty(Progression, 'LEVEL_REWARDS', { enumerable: true, get: levelRewards });
  RR.Progression = Progression;
})();
