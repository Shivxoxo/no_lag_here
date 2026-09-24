# RIDGE RUSH — Integration notes (actual APIs vs. the contract)

The core modules follow `docs/ARCHITECTURE.md`; this file records the extra fields, behaviours and
wiring rules the implementations added. **Code that wires modules together must follow these.**

## Physics (`RR.VehicleBody`) & vehicles
- `env.gravity` passed to `body.step` must be the FINAL value:
  `9.81 × world.gravity × (modifiers?.gravityMul ?? 1) × (run.env.gravityMul ?? 1)`.
  Physics never reads `gravityMul`. Also pass `env.airDrag = world.airDrag`, `env.wind = run.env.wind`,
  `env.frictionMul = modifiers?.frictionMul ?? 1`, `env.sensitivity = settings.sensitivity`.
- `controls.boost` accepts 0..1.5 (power-up BOOST 1 + Ion Thruster `tuned.special.force` (=1) may stack;
  clamp to 1.5). 1 ⇒ ~0.9 g forward thrust along the chassis.
- Only the **head** circle sets `headHit`. A car on its side / standing on its tail is NOT a crash in
  physics — Run's "upside-down & stuck > 2.5 s" rule must catch it (`body.isUpsideDown()` helper exists).
- Extra state: `b.time`, `b.lastImpact {speed, time, count}` (count++ per touchdown from the air),
  `b.rpm` 0..1, `b.engineLoad` 0..1, `wheel.slip` (m/s), `b.nanRecoveries`, `b.tuned`.
  Extra methods: `b.forwardSpeed()`, `b.isUpsideDown()`, `b.setPose(x,y,angle)`, `b.setVelocity(vx,vy)`,
  `b.placeOnTerrain(terrain, x, lift?)`. `rescue()` clears headHit/hazard, moves off lava, keeps angle continuous.
- Brake input brakes when rolling forward, reverses below ~0.6 m/s; brakes hold on hills.
- Maxed high-torque cars can wheelie-flip at full throttle on steep slopes — autopilots must feather throttle.
- `RR.Vehicles.describeUpgrade` → `{stat, value, detail, amount}`; extras: `CAT_MULT`, `indexOf`, `torqueCurve`.
  `tuned.maxSpeed` = design top speed (m/s); `tuned.topSpeed` too.

## Camera
- `cam.cx / cam.cy` = rendered centre (x + shake). `cam.update(dt, {x,y,vx,vy,airTime,heightAboveGround}, {reducedMotion})`.

## Terrain (`RR.Terrain`)
- `onChunk` is a setter; assigning replays already-published chunks. Constructor accepts world object or id.
- Feature `x` is the ramp START for jump/gap/lava; `x2` = end of landing zone. Meta: `takeoffX, takeoffY,
  takeoffAngle, landingX, landingY, apexX, apexY, rampX, rampHeight, landingZoneX2`; gap/lava also
  `depth, floorY, trenchX, trenchX2, vReq`; lava `poolX, poolX2, poolY`. `steep {maxSlope, dir, rise}`,
  `plateau {length, ledge?, summit?}`, `valley {bottomX, bottomY, depth}`, pads `{power, length}`.
- Placement helpers: `RR.Terrain.FLAGS` (DESIGN TRENCH BOSS LOCK NODECO PAD LAVA RAMP ROCKS), `t.flagsIdx(i)`,
  `t.maxSlopeAt(x)`, `t.upcomingSection(x)`, `RR.Terrain.SURFACE_LIST`. Never place fuel/items inside
  trenches or lava pools (coin arcs above them are fine).
- `closestPoint` normal points toward p (into the ground when `inside`); `out.snx/sny` = outward normal.

## Events (`RR.EventSystem`)
- `ev.update(simDt)` — pass the TIME-SCALED dt.
- Writes `run.env.{wind, gravityMul, darkness, rain, lightning, tint, sectionId, fuelZone}` and `run.boss`
  (`{name, start, summitX, progress, active, tier, end, cleared}`), recomputed every update.
- Calls `run.warn(text, kind)` with kind `'hazard'|'bonus'|'info'`, `run.announce(title, sub, kind)` with
  `'section'|'boss'`, `run.crash(reason)`, `run.addBonus(coins, label)`, `run.collectibles.addCoin(x, y,
  BASE_VALUE 5|25|100, {falling, vx, vy})` — **Collectibles applies world.coinMul × modifiers.coinMul**.
- Reads `run.renderer.w/h`, `run.tuned`, `run.floatText`, `run.invulnTime`, `run.fuel/fuelMax`, `run.mode`,
  `run.state`, `run.particles`. In attract mode it never warns/announces/damages.
- Handles bounce/boost pads itself. Extras: `forceEvent(id)`, `reset()`, `destroy()`, `hazardActive()`.

## Visuals
- Renderer reads optional run fields: `run.specialActive` (Ion Thruster plume — **Run must set it while
  the thruster fires**), `run.boostActive`, `run.controls {throttle, lean}`, `run.time` (animation clock),
  `run.state`, `run.fuel/fuelMax`, `run.bestDistance`, `run.env.*`.
- Renderer creates its own Background if `run.background` is missing; uses `{alpha:false}` context;
  `resize()` returns true when the backing store changed.
- `RR.Particles.glowSprite(color)`, `p.count`, `emit(...)` returns count; `RR.VehicleArt.lampPoint/exhaustPoint(body, tuned, out)`.

## Progression / Save / Missions / Daily
- `RR.Save.updateSettings(patch)` validates + saves + emits `'settings'` — use it for all settings changes.
- `applyRunResults(summary)` → rewards + `levelUp`; attract/null → zeroed `{ignored:true}`. It does NOT call
  `RR.Daily.recordAttempt` — the Game must call both for daily runs. It reads `summary.longestAir` if present.
- `vehicleStatus` → `{unlocked, levelOk, canCoins, canTokens, requirementText, requiredLevel, coins, tokens}`;
  `worldStatus` → `{unlocked, levelOk, canBuy, requirementText, requiredLevel, coins}`;
  unlock reasons `'unknown'|'owned'|'level'|'coins'|'tokens'|'method'` (unlocking does not auto-select).
- `canUpgrade/upgrade` reasons `''|'max'|'coins'|'tier'|'locked'|'unknown'`.
- `levelInfo()` → `{level, xpInto, xpNext, progress, totalXp, isMax}`; `rewardsForLevel(l)` → `[{type, id, text}]`;
  `COSMETICS[{id, name, level, colors, desc}]`, `isPaintUnlocked`, `selectedPaint`, `getPaint`, `selectPaint`.
- Missions: instances `{id, templateId, text, stat, mode, target, progress, worldId, reward{coins,xp,tokens},
  completed, claimed, icon, tier, difficulty}`; `claim(id)` → `{ok, reward, reason, levelUp}`; `claimBonus()`;
  `track()` emits Bus `'missionComplete'` on completion (HUD can listen to the Bus).
- Daily: `getChallenge()` adds `{worldName, difficulty}`; `recordAttempt(d)` → `{completedNow, best, reward,
  attempts, target, levelUp}`; `RR.Daily.TYPES`.
- Mission/daily `icon` fields are emoji — the UI may map `templateId` / daily `id` to its own SVG icons.

## Audio
- Call `RR.Audio.init()` only from a user gesture (`RR.Input` `'firstGesture'`). `engineStart/music`
  requested before init are remembered. Engine routes through the SFX bus. `RR.Audio.stats()` for debugging.
