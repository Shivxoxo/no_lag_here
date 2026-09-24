/* RIDGE RUSH — daily mission templates (RR.MissionTemplates).
 *
 * Pure data consumed by RR.Missions (js/systems/missions.js). Each template has five difficulty
 * tiers; RR.Missions picks the tier from the player's level, so targets and rewards grow with the
 * player.
 *
 * Template fields (contract): {id, text, stat, mode:'sum'|'max', targets[5], rewardCoins[5], rewardXp[5], worldId?}
 *   text     '{n}' → formatted target, '{s}' → plural 's' when target ≠ 1, '{world}' → world name.
 * Contract additions (documented, never renames):
 *   group      missions of the same group are never offered on the same day (variety)
 *   difficulty 1..3 relative effort; the hardest mission of a day may carry a token reward
 *   weight     relative pick weight · minTier lowest tier where the template may appear
 *   perWorld   true → RR.Missions assigns worldId from the player's unlocked worlds and scales the
 *              target by world difficulty (templates never hard-code a worldId)
 *   icon       short symbol shown next to the mission in the UI
 *   RR.MissionTemplates.byId(id), RR.MissionTemplates.STAT_KEYS (exact stat keys of the contract),
 *   RR.MissionTemplates.TIER_LEVELS (player level at which each tier starts), tierForLevel(level).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});

  const STAT_KEYS = Object.freeze(['distance', 'runDistance', 'coins', 'backflips', 'frontflips', 'doubleFlips',
    'perfectLandings', 'fuelCans', 'airTime', 'wheelie', 'combo', 'powerups', 'bossCleared', 'dailyComplete',
    'tricks', 'worldDistance']);

  // Tier 0..4 starts at these player levels.
  const TIER_LEVELS = Object.freeze([1, 3, 6, 10, 16]);
  function tierForLevel(level) {
    let t = 0;
    for (let i = 0; i < TIER_LEVELS.length; i++) if (level >= TIER_LEVELS[i]) t = i;
    return t;
  }

  // Base rewards per tier, scaled per template by `mul` (rounded to tidy numbers).
  const BASE_COINS = [300, 450, 650, 900, 1250];
  const BASE_XP = [120, 180, 260, 360, 500];
  const coinsFor = (mul) => Object.freeze(BASE_COINS.map((c) => Math.round((c * mul) / 50) * 50));
  const xpFor = (mul) => Object.freeze(BASE_XP.map((x) => Math.round((x * mul) / 10) * 10));

  function T(def) {
    const mul = def.rewardMul || 1;
    return Object.freeze({
      id: def.id,
      text: def.text,
      stat: def.stat,
      mode: def.mode || 'sum',
      targets: Object.freeze(def.targets.slice()),
      rewardCoins: coinsFor(mul),
      rewardXp: xpFor(mul),
      group: def.group,
      difficulty: def.difficulty || 1,
      weight: def.weight || 1,
      minTier: def.minTier || 0,
      perWorld: !!def.perWorld,
      icon: def.icon
    });
  }

  const list = [
    T({ id: 'total_distance', text: 'Travel {n} m in total', stat: 'distance', mode: 'sum',
      targets: [2000, 4000, 7000, 10000, 15000], group: 'distance', difficulty: 1, icon: '🛣' }),
    T({ id: 'run_distance', text: 'Reach {n} m in one run', stat: 'runDistance', mode: 'max',
      targets: [500, 900, 1500, 2200, 3000], group: 'distance', difficulty: 2, rewardMul: 1.2, icon: '🏁' }),
    T({ id: 'world_distance', text: 'Reach {n} m in {world}', stat: 'worldDistance', mode: 'max',
      targets: [400, 700, 1100, 1600, 2200], group: 'distance', difficulty: 2, rewardMul: 1.2, perWorld: true, icon: '🗺' }),
    T({ id: 'coins', text: 'Collect {n} coins', stat: 'coins', mode: 'sum',
      targets: [500, 1000, 2000, 3500, 6000], group: 'coins', difficulty: 1, icon: '🪙' }),
    T({ id: 'backflips', text: 'Perform {n} backflip{s}', stat: 'backflips', mode: 'sum',
      targets: [3, 5, 8, 12, 18], group: 'flips', difficulty: 2, rewardMul: 1.1, icon: '↺' }),
    T({ id: 'frontflips', text: 'Perform {n} frontflip{s}', stat: 'frontflips', mode: 'sum',
      targets: [2, 4, 6, 9, 14], group: 'flips', difficulty: 2, rewardMul: 1.2, icon: '↻' }),
    T({ id: 'double_flips', text: 'Land {n} double flip{s}', stat: 'doubleFlips', mode: 'sum',
      targets: [1, 2, 3, 5, 8], group: 'flips', difficulty: 3, rewardMul: 1.5, minTier: 1, weight: 0.8, icon: '⟲' }),
    T({ id: 'tricks', text: 'Perform {n} trick{s}', stat: 'tricks', mode: 'sum',
      targets: [5, 10, 16, 25, 40], group: 'flips', difficulty: 1, icon: '★' }),
    T({ id: 'perfect_landings', text: 'Nail {n} perfect landing{s}', stat: 'perfectLandings', mode: 'sum',
      targets: [3, 5, 8, 12, 18], group: 'landing', difficulty: 2, rewardMul: 1.1, icon: '✓' }),
    T({ id: 'fuel', text: 'Collect {n} fuel pickup{s}', stat: 'fuelCans', mode: 'sum',
      targets: [5, 10, 15, 20, 30], group: 'fuel', difficulty: 1, icon: '⛽' }),
    T({ id: 'airtime', text: 'Spend {n} second{s} in the air', stat: 'airTime', mode: 'sum',
      targets: [20, 40, 70, 100, 150], group: 'air', difficulty: 1, icon: '🪂' }),
    T({ id: 'wheelie', text: 'Wheelie for {n} m in total', stat: 'wheelie', mode: 'sum',
      targets: [30, 60, 100, 160, 250], group: 'wheelie', difficulty: 2, icon: '🏍' }),
    T({ id: 'combo', text: 'Reach a combo of ×{n}', stat: 'combo', mode: 'max',
      targets: [3, 4, 5, 7, 9], group: 'combo', difficulty: 2, rewardMul: 1.2, icon: '✖' }),
    T({ id: 'powerups', text: 'Grab {n} power-up{s}', stat: 'powerups', mode: 'sum',
      targets: [2, 4, 6, 9, 12], group: 'powerups', difficulty: 1, icon: '⚡' }),
    T({ id: 'boss', text: 'Clear {n} boss run{s}', stat: 'bossCleared', mode: 'sum',
      targets: [1, 1, 1, 2, 2], group: 'boss', difficulty: 3, rewardMul: 1.8, minTier: 2, weight: 0.6, icon: '⛰' }),
    T({ id: 'daily', text: 'Complete the daily challenge', stat: 'dailyComplete', mode: 'sum',
      targets: [1, 1, 1, 1, 1], group: 'daily', difficulty: 2, rewardMul: 1.3, weight: 0.6, icon: '📅' })
  ];

  const index = new Map(list.map((t) => [t.id, t]));
  list.byId = (id) => index.get(id) || null;
  list.STAT_KEYS = STAT_KEYS;
  list.TIER_LEVELS = TIER_LEVELS;
  list.tierForLevel = tierForLevel;

  RR.MissionTemplates = Object.freeze(list);
})();
