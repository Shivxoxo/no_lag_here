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
- (review pass) Wheelie/launch limiter: without W the drive is capped so the front wheel stays down and the rear
  brake drops a nose heading over backwards; on a tail stand the drive fades out even with W. Maxed cars no
  longer wheelie-flip at full throttle; W wheelies and gas launches still work (see “Review / fix pass”).
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
- Daily: `getChallenge()` adds `{worldName, difficulty}`; `recordAttempt(d, day?, now?)` → `{completedNow, expired,
  best, reward, attempts, target, levelUp}` — pass the run's own challenge day (see “Review / fix pass”); `RR.Daily.TYPES`.
- Mission/daily `icon` fields are emoji — the UI may map `templateId` / daily `id` to its own SVG icons.

## Audio
- Call `RR.Audio.init()` only from a user gesture (`RR.Input` `'firstGesture'`). `engineStart/music`
  requested before init are remembered. Engine routes through the SFX bus. `RR.Audio.stats()` for debugging.

## Integration pass (feel / balance / fairness) — changes to the documented numbers
Measured with a headless bot (hold gas, feather when the nose rises, level in the air) on the real modules;
see the report for the numbers. All changes are also noted in each file's header.
- **Fuel** (`vehicles.js`): a running engine burns `idleBurn` all the time plus `burnRate × |throttle|`; rates
  roughly 2–2.5× the original so a stock tank covers ≈ 450–650 m of typical driving (the old 45–60 s
  full-throttle tank lasted 1.6–3 km and fuel never mattered). Garage shows full-throttle L/s (burn + idle).
- **Fuel pickups** (`collectibles.js`): gaps `min(1150, 230 + 0.5·x) × world.fuelSpacing` (±15 %) instead of
  `lerp(170, 360, difficulty)`; first mega orb ≈ 1.9 km then every 1.9–2.6 km; energy-cell chance 35→15 %.
  Fuel pickups also collect when the car passes ≤ 3.6 m above them (crest hops no longer skip the only can).
  `FUEL BOOST` power-up weight 0.8 → 0.5; fuel-zone refill 6 → 4.5 %/s (`run.js`); daily `no_fuel` 45 → 35 %.
- **Economy**: coin trails 4–10 coins every 34–70 m (was 5–12 every 16–38 m), risky jump arcs bronze with a
  silver apex + one high gold, rock-garden lines mostly bronze; combo multiplier `min(3, 1 + 0.25·(n−1))`
  (was ×5 cap); PERFECT LANDING needs ≤ 0.15 rad, both wheels within 0.12 s, ≥ 0.75 s air; vehicle
  `upgradeBaseCost` × 1.5 (formula unchanged).
- **Feel**: gas-in-air rotation `THROTTLE_AIR_LEAN` 0.85 → 0.5 (W + gas still gives full air torque for
  deliberate flips); tail-stand crash rule speed 1 → 2.5 m/s; camera gets the time-scaled velocity in
  slow-mo; portrait viewports zoom to ≤ 19 m across; a falling rock is fatal only while still falling.

## Review / fix pass (six-lens review → fixes → independent verification)
Behaviour and API changes from the fix waves; each file header documents its part.

**Game / UI shell** (`game.js`, `js/ui/screens.js`, `js/core/input.js`, `js/ui/hud.js`, `style.css`)
- Runs are banked exactly once: `endRun` = internal `bankRun(summary)` (applyRunResults + `Daily.recordAttempt(distance,
  summary.dailyDay || lastParams.daily.day)`) + results UI. `restart()` (R, pause RESTART — also on the CRASHED stamp
  and while coasting out of fuel) banks the live run first via `run.quit()` (toast “+N coins banked · new best N m”);
  an empty run (0 m, 0 coins) is not banked. `quitRun` keeps the run's own `endReason` (crash / fuel / quit).
- `quitToMenu(screenId, params?)` forwards params to `RR.UI.show` (results → `('garage', {from:'results'})`);
  new `Game.requestRender()`. `startRun` calls `RR.Missions.ensureToday()`.
- Menu attract runs at full rate only behind the title screen; behind other menu screens it is frozen and redrawn on
  screen change / resize / settings. Canvas `ResizeObserver` resizes synchronously and redraws (no stretched frames);
  window resize / visualViewport / orientationchange stay debounced (90 ms).
- The loop feeds `renderer.reportFrameTime(rawMs)` for continuously drawn frames; `renderer.onQualityHint` keeps
  `body.q-low|medium|high` on the rendered quality (`q-auto` when the setting is 'auto'); one toast when
  `renderer.suggestedQuality` becomes non-null. Settings → Graphics shows **AUTO** (save.js now accepts `'auto'`;
  default stays `'high'`, whose dynamic resolution already degrades on slow devices).
- `UI.showResults(summary, rewards, dailyResult?, challenge?)`: a record needs `previousBest ≥ 50` (first run on a
  world → quiet “First run on <World>” caption); dailies show BEST TODAY / NEW DAILY BEST / “Challenge expired at
  midnight”. Pending level-ups are never turned into toasts: they flush 350 ms after arriving on menu / garage /
  vehicles / worlds / missions / daily, or after the results count-up.
- Garage footer START RUN / RIDE AGAIN (`garageStart`), vehicle-card UPGRADE (`upgradeVehicle`,
  `{from:'vehicles', vehicleId}`), BACK returns where it came from; CONVERT TOKENS panel when
  `Progression.tokenSinkStatus().available`; garage passes the vehicle's upgrades to `describeUpgrade`.
- Confirms de-duplicated while a modal is open/queued; backdrop taps within 350 ms of opening are ignored.
- Bus subscriptions: `saveError` (one toast per session), `missionAutoClaim` (toast + badge refresh), `wallet`.
- Input: Tab is swallowed during a run; touch pedals follow a sliding thumb (capture moves; SPECIAL never entered
  by sliding). Touch UI hides `<kbd>` hints and uses the TILT-button trick tip. HUD FPS text appends render scale
  (< 100 %) and the rendered quality in auto mode.

**Run** (`js/game/run.js`)
- Semi-fixed timestep: per frame `n = ceil(fd / PHYS_DT)` equal steps of `h = fd / n ≤ PHYS_DT` (fd = scaled frame
  dt, capped at `MAX_SUBSTEPS·PHYS_DT`); no accumulator; `simTime` advances by exactly the scaled frame dt.
- Take-off cue: `'jump'` SFX + surface puff when airborne after ≥ 0.2 s grounded (air ≥ 0.08 s with vy ≥ 2 m/s,
  or ≥ 0.15 s), 0.45 s cooldown, skipped within 0.3 s of a pad/ramp jump (`ev.jumpSfxAt`); `run.jumps` counts them.
- Records in whole metres; dailies chase today's best (`run.bestLabel` 'BEST TODAY', 'BEST TODAY!' banner with the
  softer sting, `summary.newRecord` always false, `summary.newDailyBest`). `summary.dailyDay` ('YYYY-MM-DD' | null).
- `quit()` ends with 'crash' / 'fuel' during the crash slow-mo / out-of-fuel coast.
- New crash rule: > 75° relative to the slope with hull contact below 10 m/s for 1.5 s → 'flipped'.
- `TRIM_BEHIND` 500 m. Fuel zones never refill under `modifiers.noFuelPickups`.
- Camera wiring: `ct.slopeAhead = (h(x+12) − h(x)) / 12` (±3); `camera.bottomInset = 0` when touch controls are
  hidden or in attract mode, else `null` (camera default 130 CSS px).
- With 2X COINS every coin pickup pops a gold `+N ×2` float text.

**Physics / vehicles / camera** (`physics.js`, `vehicles.js`, `camera.js`)
- Limiter (driver aid on the drive torque only): launch control while W is not held caps the drive so the pitch
  moment about the rear contact stays ≤ the gravity restoring moment (blends in as front-wheel load → 0, 0.12 s
  pitch look-ahead), fades the drive out between ~46° and ~63° so a D-only wheelie is not held, and applies the
  rear brake once the pitch heads past the balance point; tail-stand fade (always, even with W) past ~63° with the
  tail touching or the front wheel up > 0.3 s; rear “tail” hull points have friction 0.9. `b.driveLimit` (0..1)
  = share of drive removed last step.
- Gas/brake air rotation = `THROTTLE_AIR_LEAN × smoothstep(0.25, 0.8, airTime)`; explicit W/S lean keeps `AIR_RAMP`.
- `describeUpgrade(vehicleId, catId, level, upgrades?)`: other categories from the 4th argument, else
  `Save.data.upgrades[vehicleId]`, else stock. TIRES row = `{stat:'Snow grip', value:'NN% of dry',
  detail:'Rolling resistance −N% · top speed X km/h'}`; ENGINE detail top speed uses the full upgrade set.
- Camera: 12 m vertical / 19 m across (10.5 m on short landscape), speed zoom ≤ 24 % over 8–28 m/s, air zoom
  ≤ 18 % (`smoothstep(0.3,1,air) × smoothstep(1.5,6,height)`), combined ≤ 30 %, look-ahead 0.45 s capped at 30 %
  of the view (28 % portrait). Portrait: `cam.bottomInset` (CSS px hidden at the bottom, `null` → 130) and
  optional `target.slopeAhead` (vertical look along the slope, ±4 m).

**Terrain / collectibles** (`terrain.js`, `collectibles.js`)
- Boss rebuilt as ledged pitches: warm-up, rock garden (`FLAGS.ROCKS|BOSS`), steps, a 52–62 m headwall
  (1.07–1.19 by tier) and final wall, slopes ≤ 1.25 × low-gravity factor, × friction factor; from tier 2 a small
  boss `gap` (1.3–1.9 m, vReq ≤ 10.5, exit ≤ 0.6). Boss `SectionInfo.ledges = [{x, x2}]` (sorted; also 'plateau'
  features with `meta.ledge`).
- `maxSlopeAt(x)` is the UPHILL budget and rises × up to 1.3 past `difficultyDistance` (cap 1.25); new
  `maxDownSlopeAt(x)` (base limit for descents). Scheduled wall climbs (`FLAGS.WALL` = 512; ≥ 1.5 km, Green
  Valley ≥ 1.75 km) published as `'steep'` features `{maxSlope, dir:1, rise, wall:true, faceX, faceX2}`.
- `terrain.requestFeature('steep', xMin)` → next wall whose ramp starts in `[xMin, xMin+280]` (generates ground
  through it), else null; content-neutral. First major section = the world's signature set piece at 1.2–1.6 km
  (storm_planet → storm, volcanic_ridge → volcano, moon_base → moon, or `world.signatureSection`).
- Guaranteed boss fuel cans (`item.boss = true`): ≈ 30 m before `boss.start`, on the middle ledge and on the last
  ledge; a boss can that replaces a scheduled mega orb becomes the mega. None under `noFuelPickups`.

**Events** (`events.js`)
- Ambient gust field: `ev.ambAmp` (Storm Planet 6; daily windMul > 1 adds `3.5·(m−1)+2`; cap 11; 0 elsewhere),
  `ev.ambientWind(t?)`; `env.wind = ambientWind + wind_gust events + THE STORM term` (±20). wind_gust weight ×2 when
  `ambAmp > 0`. On an uncleared boss climb the ambient gusts ease to 40 % (`ev.ambBossMul`) so the headwall is a
  climb, not a wind lottery.
- Boss summit also clears in state 'nofuel'. `fuel_zone` unavailable under `noFuelPickups`.
- Lava vents / meteor impacts are aimed so a steady-speed car passes before or arrives after the danger window
  (first vent ≥ 22 m ahead); an off-screen lava vent within 60 m gets a marker at W − 40 px at its ground height.
- `steep_surprise`: published steep feature 60–250 m ahead → ground scan (slope ≥ 0.35 over ≥ 12 m, rise ≥ 4 m) →
  `t.requestFeature('steep', …)`; edge marker at the window base. `ev.jumpSfxAt` stamps pad/ramp jump SFX.

**Visuals** (`renderer.js`, `background.js`, `vehicleArt.js`, `particles.js`)
- `r.dpr` = effective backing ratio `min(devicePixelRatio, cap) × renderScale` (caps low 1 / medium 1.25 / high 2;
  LOW base scale 0.75); `r.deviceRatio`, `r.renderScale`, `r.quality` (rendered) vs `r.qualitySetting`
  (`'low'|'medium'|'high'|'auto'`). Dynamic resolution on by default (EMA > 19 ms for 2 s → step down 1 → 0.85 →
  0.7 [→ 0.6 → 0.5 on hi-DPI]; < 15 ms for 5 s → up); 'auto' also steps quality high → medium → low.
  `setAutoQuality(bool)`, `reportFrameTime(ms)`, `frameStats()`, `suggestedQuality`, `onQualityHint`.
- LOW darkness draws gradients directly (no light map); background layers stop at the next layer's baseline; LOW
  drops the far layer and haze. Trimmed terrain left of `T.minX` renders as a rock cliff matching the collision wall.
- MAGNET rings + pulled-coin streaks; 2X COINS gold aura/rim (`VehicleArt.draw` opts `multiplier`, `quality`);
  both fade over the last 2 s. THE MOON section in other worlds blends to a starry vacuum sky (`bg.moonW`) and
  fades plant decorations. Neon billboards draw four neon motifs. Rain slant / sand / wind streaks follow `env.wind`.

**Progression / save / missions / daily** (`progression.js`, `save.js`, `missions.js`, `daily.js`)
- Daily runs never write `bestDistances` / `bestDistance` and pay no record XP; rewards add `dailyBestPrev`,
  `newDailyBest` (reads optional `summary.dailyDay`).
- `Daily.recordAttempt(distance, day?, now?)`: `day` = the run's challenge (object / 'YYYY-MM-DD' / Date); a run whose
  day is not today returns `{completedNow:false, expired:true, best:0, reward:null, attempts:0, target, levelUp:null}`
  and changes nothing. Giant Steps `terrainAmpMul` 1.8 ('Hills +60%'), Chaos 1.4 ('Hills +30%') — measured over the
  first 2 km.
- Missions roll over at midnight inside `getActive / track / claim / claimableCount / canClaimBonus / claimBonus`;
  yesterday's completed-but-unclaimed missions (and a completed set's bonus) are auto-paid → Bus `missionAutoClaim`
  `{missions, bonus, reward, levelUp, day}`.
- XP: `xpForLevel = round(150·l^1.55/10)·10`; run XP = distance/10 + pickup coins/25 + min(50 % trickXp,
  1.5 × distance XP) + boss XP + record XP `min(250, 0.5 × gain)` (previous best ≥ 50 m, distance ≥ 100 m).
  Level rewards to 50: paints at 20/24/28/32/36/40 (20 paints), coin chests `1500 + 100·l` from 17, +1 token at
  20, 25, …, 50 (`rewardsForLevel` entries `{type:'coins'|'tokens', amount, text}`).
- Token sink: `tokenSinkStatus()`, `tokenValue()` (= 1500 + 50·level), `convertTokens(n?)` (only once every vehicle
  is owned) → Bus `wallet {coins, tokens}`.
- Save: write failures drop the backup key and retry once; still failing → in-memory, `Save.persistent = false`,
  `Save.lastError = 'quota'|'blocked'`, Bus `saveError {reason}` once per session (boot without storage:
  `'unavailable'` on the next tick); a later successful write restores `persistent`. Settings `quality` accepts
  `'auto'`.
- New Bus events: `saveError`, `missionAutoClaim`, `wallet`.
