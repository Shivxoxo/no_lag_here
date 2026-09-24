/* RIDGE RUSH — daily missions (RR.Missions).
 *
 * Three missions per local calendar day, generated deterministically from
 * RR.Util.dateSeed(date, 'missions') and the player's tier (RR.MissionTemplates.tierForLevel):
 * the date picks WHICH templates (3 distinct templates from 3 distinct groups) and whether the
 * hardest one carries a token; the tier scales targets and rewards. A world-specific mission only
 * ever targets a world the player has unlocked. The set is generated once per day and stored in
 * RR.Save.data.missions, so levelling up mid-day doesn't reshuffle it.
 *
 * track() is called from the run's hot path, so it allocates nothing when no mission completes
 * (returns a shared frozen empty array) and never saves (Run's end-of-run save persists progress).
 *
 * Contract additions (documented, never renames):
 *  - ensureToday(date?) / timeUntilReset(now?) accept an optional Date (tests, previews).
 *  - generate(date, level, unlockedWorlds) → fresh MissionInstance[3] (pure; used by ensureToday).
 *  - MissionInstance also carries {icon, tier, difficulty}.
 *  - claim(id) → {ok, reward, reason?, levelUp?}; claimBonus() → {ok, reward, reason?, levelUp?}.
 *  - Completing a mission increments stats.missionsCompleted.
 *  - 'missionComplete' / 'missionClaimed' payloads carry a copy of the instance.
 *  - Midnight rollover is automatic: getActive(), track(), claim(), claimableCount(), canClaimBonus()
 *    and claimBonus() first roll the set over when the stored day is not today (the day key is cached
 *    for 1 s, so the hot path stays cheap). When a set is replaced by a later day's, its completed but
 *    unclaimed missions — and the all-claimed bonus they earn — are paid automatically and Bus
 *    'missionAutoClaim' {missions:[copies], bonus:bool, reward:{coins,xp,tokens}, levelUp, day} is
 *    emitted so the UI can toast.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const COUNT = 3;
  const BONUS = Object.freeze({ coins: 750, xp: 300, tokens: 1 });
  const EMPTY = Object.freeze([]);
  const TOKEN_CHANCE = 0.5; // share of days on which the hardest mission awards a token

  const S = () => {
    if (!RR.Save.data) RR.Save.load();
    return RR.Save.data;
  };
  const emit = (evt, payload) => { if (RR.Bus) RR.Bus.emit(evt, payload); };
  const copy = (m) => JSON.parse(JSON.stringify(m));

  // World-specific distance targets shrink for harder worlds (difficulty 1..5).
  const WORLD_DIFF_SCALE = [1, 1, 0.85, 0.72, 0.62, 0.52];
  const roundTarget = (n) => (n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 50) * 50 : Math.max(1, Math.round(n)));

  function formatText(tpl, target, worldName) {
    return tpl.text
      .replace('{n}', U.formatInt(target))
      .replace('{s}', target === 1 ? '' : 's')
      .replace('{world}', worldName || '');
  }

  function tierFor(level) {
    const T = RR.MissionTemplates;
    return T && typeof T.tierForLevel === 'function' ? T.tierForLevel(level) : 0;
  }

  // Pure: the day's three missions for a given date, player level and unlocked-world list.
  function generate(date, level, unlockedWorlds) {
    const T = RR.MissionTemplates || [];
    const day = U.todayKey(date);
    const tier = tierFor(level);
    const rng = U.makeRng(U.dateSeed(date, 'missions'));
    const worlds = (RR.Worlds ? RR.Worlds.list : []).filter((w) => (unlockedWorlds || []).indexOf(w.id) >= 0);

    // Pick 3 templates from distinct groups (weighted, deterministic).
    const picked = [];
    const usedGroups = new Set();
    for (let i = 0; i < COUNT; i++) {
      const tpl = U.weightedPick(T, (t) => {
        if (usedGroups.has(t.group) || picked.indexOf(t) >= 0) return 0;
        if (tier < t.minTier) return 0;
        if (t.perWorld && !worlds.length) return 0;
        return t.weight;
      }, rng);
      if (!tpl) break;
      picked.push(tpl);
      usedGroups.add(tpl.group);
    }

    // The hardest mission (highest difficulty, first on ties) may award a token.
    let hardest = 0;
    for (let i = 1; i < picked.length; i++) if (picked[i].difficulty > picked[hardest].difficulty) hardest = i;
    const tokenToday = rng.chance(TOKEN_CHANCE);

    return picked.map((tpl, i) => {
      let target = tpl.targets[tier];
      let worldId, worldName;
      if (tpl.perWorld) {
        const w = rng.pick(worlds);
        worldId = w.id;
        worldName = w.name;
        target = roundTarget(target * WORLD_DIFF_SCALE[U.clamp(w.difficulty | 0, 1, 5)]);
      }
      const m = {
        id: 'm-' + day + '-' + i,
        templateId: tpl.id,
        text: formatText(tpl, target, worldName),
        stat: tpl.stat,
        mode: tpl.mode,
        target,
        progress: 0,
        reward: {
          coins: tpl.rewardCoins[tier],
          xp: tpl.rewardXp[tier],
          tokens: i === hardest && tokenToday && tpl.difficulty >= 2 ? 1 : 0
        },
        completed: false,
        claimed: false,
        icon: tpl.icon,
        tier,
        difficulty: tpl.difficulty
      };
      if (worldId) m.worldId = worldId;
      return m;
    });
  }

  // Today's key, recomputed at most once a second (track() runs every frame).
  let dayKey = null, dayKeyAt = 0;
  function today() {
    const n = Date.now();
    if (dayKey === null || Math.abs(n - dayKeyAt) > 1000) { dayKey = U.todayKey(); dayKeyAt = n; }
    return dayKey;
  }
  const isCurrent = (ms) => !!ms && ms.day === today() && Array.isArray(ms.active) && ms.active.length === COUNT;

  // Pays what a set that is being replaced still owes: completed-but-unclaimed missions and, when
  // that makes the whole set claimed, the daily bonus. Emits 'missionAutoClaim'.
  function settleOldSet(ms) {
    if (!ms || !ms.day || !Array.isArray(ms.active) || ms.active.length !== COUNT || !RR.Progression) return;
    const owed = ms.active.filter((m) => m.completed && !m.claimed);
    const bonus = !ms.bonusClaimed && ms.active.every((m) => m.claimed || m.completed);
    if (!owed.length && !bonus) return;
    const reward = { coins: 0, xp: 0, tokens: 0 };
    for (const m of owed) {
      m.claimed = true;
      reward.coins += m.reward.coins; reward.xp += m.reward.xp; reward.tokens += m.reward.tokens;
    }
    if (bonus) {
      ms.bonusClaimed = true;
      reward.coins += BONUS.coins; reward.xp += BONUS.xp; reward.tokens += BONUS.tokens;
    }
    const levelUp = grant(reward);
    emit('missionAutoClaim', { missions: owed.map(copy), bonus, reward, levelUp, day: ms.day });
  }

  function ensureToday(date) {
    const d = S();
    const day = U.todayKey(date);
    const ms = d.missions;
    if (ms.day === day && Array.isArray(ms.active) && ms.active.length === COUNT) return ms.active;
    const P = RR.Progression;
    const roll = () => {
      settleOldSet(ms);
      d.missions = { day, active: generate(date, d.level, d.unlockedWorlds), bonusClaimed: false };
      RR.Save.save();
    };
    if (P && P.batch) P.batch(roll); else roll();
    return d.missions.active;
  }

  function getActive() {
    const ms = S().missions;
    if (!isCurrent(ms)) return ensureToday();
    return ms.active;
  }

  // Hot path: update progress for `stat`. Returns missions completed by THIS call.
  function track(stat, value, ctx) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return EMPTY;
    const ms = S().missions;
    let active = ms.active;
    if (!isCurrent(ms)) active = ensureToday();
    let done = null;
    for (let i = 0; i < active.length; i++) {
      const m = active[i];
      if (m.completed || m.stat !== stat) continue;
      if (stat === 'worldDistance' && (!ctx || ctx.worldId !== m.worldId)) continue;
      const p = m.mode === 'max' ? Math.max(m.progress, value) : m.progress + value;
      m.progress = p > m.target ? m.target : p;
      if (m.progress >= m.target) {
        m.completed = true;
        S().stats.missionsCompleted += 1;
        (done || (done = [])).push(m);
        emit('missionComplete', { mission: copy(m) });
      }
    }
    return done || EMPTY;
  }

  function grant(reward) {
    const P = RR.Progression;
    P.addCoins(reward.coins);
    P.addTokens(reward.tokens);
    return P.addXp(reward.xp);
  }

  function claim(id) {
    const m = getActive().find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'unknown', reward: null };
    if (!m.completed) return { ok: false, reason: 'incomplete', reward: null };
    if (m.claimed) return { ok: false, reason: 'claimed', reward: null };
    const reward = { coins: m.reward.coins, xp: m.reward.xp, tokens: m.reward.tokens };
    return RR.Progression.batch(() => {
      m.claimed = true;
      const levelUp = grant(reward);
      RR.Save.save();
      emit('missionClaimed', { mission: copy(m) });
      return { ok: true, reward, levelUp };
    });
  }

  function claimableCount() {
    let n = 0;
    for (const m of getActive()) if (m.completed && !m.claimed) n++;
    return n;
  }

  function canClaimBonus() {
    getActive(); // rolls over (and settles yesterday's set, bonus included) after midnight
    const ms = S().missions;
    return !!ms.day && !ms.bonusClaimed &&
      ms.active.length === COUNT && ms.active.every((m) => m.claimed);
  }

  function claimBonus() {
    getActive();
    const ms = S().missions;
    if (ms.bonusClaimed) return { ok: false, reason: 'claimed', reward: null };
    if (!canClaimBonus()) return { ok: false, reason: 'incomplete', reward: null };
    const reward = { coins: BONUS.coins, xp: BONUS.xp, tokens: BONUS.tokens };
    return RR.Progression.batch(() => {
      ms.bonusClaimed = true;
      const levelUp = grant(reward);
      RR.Save.save();
      return { ok: true, reward, levelUp };
    });
  }

  function timeUntilReset(now) {
    const n = now instanceof Date ? now : new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, next.getTime() - n.getTime());
  }

  RR.Missions = {
    COUNT, BONUS,
    generate, ensureToday, getActive, track, claim, claimableCount, canClaimBonus, claimBonus, timeUntilReset
  };
})();
