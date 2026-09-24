/* RIDGE RUSH — daily challenge (RR.Daily).
 *
 * One challenge per local calendar day, identical for every player on that date:
 *  - challenge TYPE: the days are grouped into cycles of TYPES.length days; each cycle plays every
 *    type exactly once in a shuffled order (seeded by the cycle number), so all types come around
 *    regularly and the same type is never offered two days in a row.
 *  - everything else (world, target distance, reward, terrain seed) comes from
 *    RR.Util.dateSeed(date, 'daily').
 * The world is picked from all 8 worlds, weighted toward the easier ones; it is playable even when
 * the player hasn't unlocked it (a teaser). Targets are ≈ 600–1500 m, scaled by challenge and world.
 *
 * Contract additions (documented, never renames):
 *  - getChallenge(day?) accepts a Date, a 'YYYY-MM-DD' string or nothing (today); returns a fresh
 *    object each call. DailyChallenge also carries {worldName, difficulty 1..3}.
 *  - status(date?) / recordAttempt(distance, date?) / timeUntilNext(now?) accept an optional Date.
 *  - recordAttempt() also returns {attempts, target, levelUp|null}.
 *  - RR.Daily.TYPES — the challenge catalogue (read-only).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MIN_TARGET = 600, MAX_TARGET = 1500;

  const BASE_MODIFIERS = Object.freeze({
    gravityMul: 1, noFuelPickups: false, fuelEfficiencyMul: 1, speedMul: 1, terrainAmpMul: 1,
    frictionMul: 1, coinMul: 1, coinDensityMul: 1, windMul: 1
  });

  // Worlds without meaningful wind (Moon Base) or with already-low gravity are excluded where the
  // modifier would do nothing or turn silly.
  const pct = (m) => Math.round(m * 100) + '%';
  const TYPES = Object.freeze([
    {
      id: 'low_gravity', name: 'Feather Fall', icon: '🪶', difficulty: 1, baseTarget: 1300,
      description: 'Gravity drops to 60%. Float over the ridges and chain massive flips.',
      exclude: ['moon_base'],
      build: () => ({ gravityMul: 0.6, labels: ['Gravity 60%'] })
    },
    {
      id: 'no_fuel', name: 'Last Drop', icon: '⛽', difficulty: 3, baseTarget: 850,
      description: 'No fuel pickups anywhere — but your engine sips at 35%. Make every drop count.',
      exclude: [],
      // (integration balance pass: 0.45 → 0.35 to match the retuned, thirstier engines)
      build: () => ({ noFuelPickups: true, fuelEfficiencyMul: 0.35, labels: ['No fuel pickups', 'Fuel use 35%'] })
    },
    {
      id: 'max_speed', name: 'Redline', icon: '💨', difficulty: 2, baseTarget: 1400,
      description: 'Engines tuned way past the limit: 35% more top speed. Hold on tight.',
      exclude: [],
      build: () => ({ speedMul: 1.35, labels: ['Top speed +35%'] })
    },
    {
      id: 'extreme_hills', name: 'Giant Steps', icon: '⛰', difficulty: 3, baseTarget: 950,
      description: 'The mountains grew overnight — every hill is 60% taller.',
      exclude: [],
      build: () => ({ terrainAmpMul: 1.6, labels: ['Hills +60%'] })
    },
    {
      id: 'ice', name: 'Black Ice', icon: '❄', difficulty: 3, baseTarget: 900,
      description: 'Every surface is glazed with ice. Feather the throttle and keep it smooth.',
      exclude: [],
      build: () => ({ frictionMul: 0.55, labels: ['Grip 55%'] })
    },
    {
      id: 'coin_rush', name: 'Coin Rush', icon: '🪙', difficulty: 1, baseTarget: 1200,
      description: 'Coins everywhere, and every one of them is worth double.',
      exclude: [],
      build: () => ({ coinMul: 2, coinDensityMul: 2.5, labels: ['Coin value ×2', 'Coins ×2.5'] })
    },
    {
      id: 'storm_winds', name: 'Gale Force', icon: '🌪', difficulty: 2, baseTarget: 1000,
      description: 'Howling crosswinds shove you around. Lean into the gusts.',
      exclude: ['moon_base'],
      // Aim for ≈ 11 m/s² peak gusts whatever the world's own wind is.
      build: (w) => {
        const gust = w && w.wind && w.wind.gust > 0 ? w.wind.gust : 4;
        const m = Math.round(U.clamp(11 / gust, 1.4, 2.5) * 10) / 10;
        return { windMul: m, labels: ['Wind ×' + m] };
      }
    },
    {
      id: 'heavy_gravity', name: 'Heavy Metal', icon: '🧲', difficulty: 3, baseTarget: 850,
      description: 'Gravity cranked to 135%. Climbs are brutal, but landings stick.',
      exclude: [],
      build: () => ({ gravityMul: 1.35, speedMul: 1.1, labels: ['Gravity ' + pct(1.35), 'Top speed +10%'] })
    },
    {
      id: 'chaos', name: 'Chaos Run', icon: '🎲', difficulty: 2, baseTarget: 1000,
      description: 'Floaty gravity, wild winds, taller hills and double coins — all at once.',
      exclude: ['moon_base'],
      build: () => ({ gravityMul: 0.8, windMul: 1.8, terrainAmpMul: 1.25, coinMul: 2,
        labels: ['Gravity 80%', 'Wind ×1.8', 'Hills +25%', 'Coin value ×2'] })
    }
  ].map((t) => Object.freeze(Object.assign(t, { exclude: Object.freeze(t.exclude) }))));

  // Target multiplier per world difficulty (1..5): harder worlds get shorter targets.
  const WORLD_TARGET_SCALE = [1, 1, 0.92, 0.85, 0.78, 0.7];

  // ---------------------------------------------------------------- dates
  function todayKey() { return U.todayKey(); }

  // Date | 'YYYY-MM-DD' | undefined → local Date at noon of that day (noon avoids DST edge cases).
  function toDate(day) {
    if (day instanceof Date && Number.isFinite(day.getTime())) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    if (typeof day === 'string') {
      const m = DAY_RE.exec(day);
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
        if (U.todayKey(d) === day) return d; // rejects '2026-02-31' etc.
      }
    }
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12);
  }
  // Whole days since 1970-01-01 for the local calendar date.
  const dayNumber = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

  // Shuffled order of type indices for a cycle (deterministic).
  function cycleOrder(cycle) {
    const idx = TYPES.map((_, i) => i);
    return U.shuffle(idx, U.makeRng(U.hash2(U.hashString('ridgeRush.daily.cycle'), cycle >>> 0)));
  }
  function typeForDay(n) {
    const len = TYPES.length;
    const cycle = Math.floor(n / len);
    const pos = n - cycle * len;
    const order = cycleOrder(cycle);
    // Avoid a repeat across the cycle boundary by swapping the first two entries if needed.
    if (order[0] === cycleOrder(cycle - 1)[len - 1]) { const t = order[0]; order[0] = order[1]; order[1] = t; }
    return TYPES[order[pos]];
  }

  // ---------------------------------------------------------------- challenge generation
  let cacheDay = '';
  let cacheValue = null;

  function build(date) {
    const day = U.todayKey(date);
    const seed = U.dateSeed(date, 'daily');
    const rng = U.makeRng(seed);
    const type = typeForDay(dayNumber(date));
    const worlds = RR.Worlds ? RR.Worlds.list : [];

    // World: weighted toward easier worlds (difficulty 1 → weight 5 … difficulty 5 → weight 1).
    const world = U.weightedPick(worlds, (w) => (type.exclude.indexOf(w.id) >= 0 ? 0 : 6 - U.clamp(w.difficulty | 0, 1, 5)), rng) ||
      worlds[0] || { id: 'green_valley', name: 'Green Valley', difficulty: 1, wind: { base: 0, gust: 4 } };
    const wDiff = U.clamp(world.difficulty | 0, 1, 5);

    const built = type.build(world);
    const modifiers = Object.assign({}, BASE_MODIFIERS, built, { labels: built.labels.slice() });

    const jitter = rng.range(0.9, 1.1);
    const targetDistance = U.clamp(Math.round((type.baseTarget * WORLD_TARGET_SCALE[wDiff] * jitter) / 50) * 50,
      MIN_TARGET, MAX_TARGET);

    // Reward scales with challenge + world difficulty (score 2..8 → t 0..1).
    const t = U.clamp((type.difficulty + wDiff - 2) / 6, 0, 1);
    const coins = U.clamp(Math.round((1500 + 1500 * t) * rng.range(0.95, 1.05) / 50) * 50, 1500, 3000);
    const xp = U.clamp(Math.round((400 + 400 * t) / 10) * 10, 400, 800);
    const tokens = rng.chance(0.2 + 0.4 * t) ? 1 : 0;

    return {
      day,
      seed: U.hash2(seed, 0x5eed),
      id: type.id,
      name: type.name,
      description: type.description,
      icon: type.icon,
      difficulty: type.difficulty,
      worldId: world.id,
      worldName: world.name,
      modifiers,
      targetDistance,
      reward: { coins, xp, tokens }
    };
  }

  function getChallenge(day) {
    const date = toDate(day);
    const key = U.todayKey(date);
    if (key !== cacheDay || !cacheValue) {
      cacheValue = build(date);
      cacheDay = key;
    }
    return U.deepClone(cacheValue);
  }

  // ---------------------------------------------------------------- status & attempts
  const S = () => {
    if (!RR.Save.data) RR.Save.load();
    return RR.Save.data;
  };

  // Rolls the stored daily state over to `day` if needed; returns the live state object.
  function rollover(day) {
    const d = S();
    if (!d.daily || d.daily.day !== day) d.daily = { day, best: 0, attempts: 0, completed: false };
    return d.daily;
  }

  function status(date) {
    const st = rollover(U.todayKey(toDate(date)));
    return { day: st.day, best: st.best, attempts: st.attempts, completed: st.completed };
  }

  function recordAttempt(distance, date) {
    const dt = toDate(date);
    const ch = getChallenge(dt);
    const dist = typeof distance === 'number' && Number.isFinite(distance) ? U.clamp(Math.floor(distance), 0, 1e7) : 0;
    const P = RR.Progression;
    const run = () => {
      const st = rollover(ch.day);
      st.attempts += 1;
      if (dist > st.best) st.best = dist;
      let reward = null, levelUp = null, completedNow = false;
      if (!st.completed && dist >= ch.targetDistance) {
        st.completed = true;
        completedNow = true;
        reward = { coins: ch.reward.coins, xp: ch.reward.xp, tokens: ch.reward.tokens };
        S().stats.dailyCompleted += 1;
        if (P) {
          P.addCoins(reward.coins);
          P.addTokens(reward.tokens);
          levelUp = P.addXp(reward.xp);
        }
        if (RR.Missions) RR.Missions.track('dailyComplete', 1);
      }
      RR.Save.save();
      return { completedNow, best: st.best, reward, attempts: st.attempts, target: ch.targetDistance, levelUp };
    };
    return P && P.batch ? P.batch(run) : run();
  }

  function timeUntilNext(now) {
    const n = now instanceof Date ? now : new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, next.getTime() - n.getTime());
  }

  RR.Daily = { TYPES, todayKey, getChallenge, status, recordAttempt, timeUntilNext };
})();
