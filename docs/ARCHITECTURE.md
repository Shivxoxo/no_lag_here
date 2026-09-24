# RIDGE RUSH — Architecture & Module Contracts

> "Master the Mountains" — an original 2D physics hill-climbing driving game for the browser.
> This document is the **binding contract** between modules. Every file listed here is owned by
> exactly one author; cross-module calls MUST use only the APIs defined here. If you must deviate,
> keep the documented API working (add, never silently rename) and note it at the top of your file.

---

## 0. Ground rules (apply to every file)

- **Plain classic scripts** — NO ES modules, NO bundler, NO external libraries, NO CDN fonts, NO network
  requests. The game must run by double-clicking `index.html` (`file://`) as well as from any static server.
- Every JS file is an IIFE:
  ```js
  (function () {
    'use strict';
    const RR = (window.RR = window.RR || {});
    // ... define things ...
    RR.Thing = Thing;
  })();
  ```
  Files only *define* things at load time. `game.js` boots everything on `DOMContentLoaded`.
- **Units**: meters, seconds, radians, kilograms, Newtons. **World space is y-UP** (positive y = up).
  Angles are **counter-clockwise positive**. Chassis angle 0 = level, facing +x. Driving forward = +x.
  Distance shown to the player = meters travelled in +x from the start (x = 0).
- Fixed physics timestep `RR.CONST.PHYS_DT` (1/120 s), accumulator, max `RR.CONST.MAX_SUBSTEPS` per frame.
  Frame dt clamped to `RR.CONST.MAX_FRAME_DT` (0.05 s).
- Guard every simulation number: `Number.isFinite`, clamp speeds / angular velocity, never let NaN reach
  rendering or the save file.
- Performance: no per-frame DOM creation, no per-frame allocation of big arrays, reuse scratch objects,
  cull everything off-screen, pooled particles. Target 60 FPS on a normal laptop.
- Event listeners are attached **exactly once** (idempotent `init()` with a guard flag).
- `localStorage` access always inside try/catch.
- Shared helpers live in `js/core/utils.js` (`RR.CONST`, `RR.SURFACES`, `RR.Util`, `RR.Bus`) — use them,
  don't re-implement RNGs/noise/formatters.
- Code style: 2-space indent, semicolons, `const`/`let`, classes where natural, short comments for
  non-obvious math (especially physics).
- Originality: no names, art, sounds, logos or UI copied from any existing game. All art is procedural
  Canvas drawing / CSS / inline SVG; all audio is synthesized with Web Audio; all music is generated.

## 1. File layout, ownership & load order

`index.html` loads scripts in exactly this order (classic `<script src>` tags at the end of `<body>`):

| # | File | Exports | Owner |
|---|------|---------|-------|
| 1 | `js/core/utils.js` | `RR.CONST`, `RR.SURFACES`, `RR.Util`, `RR.Bus` | lead (done) |
| 2 | `js/core/save.js` | `RR.Save` | progression |
| 3 | `js/core/audio.js` | `RR.Audio` | audio |
| 4 | `js/core/input.js` | `RR.Input` | shell |
| 5 | `js/data/vehicles.js` | `RR.Vehicles` | physics |
| 6 | `js/data/worlds.js` | `RR.Worlds` | lead (done) |
| 7 | `js/data/missions.js` | `RR.MissionTemplates` | progression |
| 8 | `js/systems/progression.js` | `RR.Progression` | progression |
| 9 | `js/systems/missions.js` | `RR.Missions` | progression |
| 10 | `js/systems/daily.js` | `RR.Daily` | progression |
| 11 | `js/game/terrain.js` | `RR.Terrain` | terrain |
| 12 | `js/game/physics.js` | `RR.VehicleBody` | physics |
| 13 | `js/game/camera.js` | `RR.Camera` | physics |
| 14 | `js/game/particles.js` | `RR.Particles`, `RR.FloatText` | visuals |
| 15 | `js/game/vehicleArt.js` | `RR.VehicleArt` | visuals |
| 16 | `js/game/background.js` | `RR.Background` | visuals |
| 17 | `js/game/collectibles.js` | `RR.Collectibles` | gameplay |
| 18 | `js/game/powerups.js` | `RR.PowerUps` | gameplay |
| 19 | `js/game/tricks.js` | `RR.Tricks` | gameplay |
| 20 | `js/game/events.js` | `RR.EventSystem` | events |
| 21 | `js/game/renderer.js` | `RR.Renderer` | visuals |
| 22 | `js/game/run.js` | `RR.Run` | gameplay |
| 23 | `js/ui/hud.js` | `RR.HUD` | shell |
| 24 | `js/ui/screens.js` | `RR.UI` | shell |
| 25 | `game.js` | `RR.Game` (boots on DOMContentLoaded) | shell |

Other files: `index.html`, `style.css`, `assets/images/icon.svg` (shell); `assets/sounds/README.md`
(audio); `tests/harness.js` (lead, done); `tests/<module>.test.js` (each owner); `tests/smoke.js`
(integration). Run node tests with `node tests/<name>.test.js`. Browser smoke tests use Playwright:
`NODE_PATH=/opt/node22/lib/node_modules node tests/smoke.js` (Chromium lives in `/opt/pw-browsers`).

Load-order rule: a file may reference another module **at call time** freely, but at *load time* only
files earlier in the table exist.

## 2. Shared foundation — `js/core/utils.js` (already written; read it)

`RR.CONST`: `PHYS_DT`, `MAX_FRAME_DT`, `MAX_SUBSTEPS`, `GRAVITY` (9.81), `TERRAIN_DX` (0.5),
`MAX_SPEED` (m/s hard clamp), `MAX_ANGULAR` (rad/s hard clamp), `COMBO_TIMEOUT`.

`RR.SURFACES[type]` → frozen `SurfaceInfo { type, friction, hazard, bounce, dust, name }` for types
`grass dirt rock sand snow ice ash lava regolith metal neon crystal mud`. `friction` multiplies tire
grip; `hazard` is `null` or `'lava'`; `dust` is a particle colour.

`RR.Util`: `clamp lerp invLerp smoothstep approach damp wrapAngle angleDiff sign isNum safeNum
makeRng(seed) hashString hash2 dateSeed makeNoise1D(seed) fbm1D formatInt formatDistance formatDuration
todayKey easeOutCubic easeOutBack easeInOutQuad easeOutElastic deepClone deepMerge hexToRgb rgba mixColor
shuffle weightedPick`.
`makeRng(seed)` → `{ next(), range(a,b), int(a,b) /*inclusive*/, chance(p), pick(arr), sign(), fork(label), seed }`.

`RR.Bus`: `on(evt, fn) → off()`, `off(evt, fn)`, `once(evt, fn)`, `emit(evt, payload)`.
Global events (payload in braces): `levelup {level, rewards}`, `coins {coins}`, `tokens {tokens}`,
`upgrade {vehicleId, catId, level}`, `unlock {kind:'vehicle'|'world'|'cosmetic', id}`,
`missionComplete {mission}`, `missionClaimed {mission}`, `settings {settings}`, `saveReset {}`.

## 3. Data modules

### 3.1 `RR.Worlds` — `js/data/worlds.js` (done; read it for exact fields)
`RR.Worlds.list` (8 `WorldDef`s in display order), `RR.Worlds.byId(id)`, `RR.Worlds.SECTION_INFO`.
World ids: `green_valley rocky_highlands desert_canyon snow_peaks volcanic_ridge moon_base neon_city storm_planet`.
Key fields: `name, subtitle, difficulty (1..5), difficultyLabel, unlock {level, coins}, gravity (multiplier),
airDrag, surface (RR.SURFACES key), altSurface, terrain {amplitude, hillLength, roughness, steepness,
maxSlope, difficultyDistance, features{...weights}}, palette {...}, celestial, ambient, decorations[],
events[], sectionPool[], bossName, wind {base, gust}, musicStyle, coinMul, fuelSpacing, dustColor, darkness`.

### 3.2 `RR.Vehicles` — `js/data/vehicles.js` (physics owner)
```
RR.Vehicles.list                 // VehicleDef[6], display order
RR.Vehicles.byId(id)             // VehicleDef | null
RR.Vehicles.UPGRADE_CATEGORIES   // [{id, name, desc}] ids EXACTLY: engine suspension tires fuel grip air brakes
                                 // names: ENGINE SUSPENSION TIRES FUEL GRIP 'AIR CONTROL' BRAKES
RR.Vehicles.MAX_UPGRADE_LEVEL    // 10 (levels are 1..10; 1 = stock)
RR.Vehicles.upgradeCost(vehicleId, catId, currentLevel) // coins for currentLevel→currentLevel+1; Infinity at max
RR.Vehicles.getTuned(vehicleId, upgrades)   // → TunedParams (fresh object). upgrades {engine:1..10,...}; missing = 1
RR.Vehicles.describeUpgrade(vehicleId, catId, level) // → { stat:'Torque', value:'1,240 Nm' } human readable
RR.Vehicles.displayStats(vehicleId, upgrades)        // → {speed, accel, grip, suspension, air, fuel, stability} each 0..10
```
Vehicles (ids, names, unlock requirements are fixed by this contract; physics numbers are the owner's call):

| id | name | unlock {level, coins, tokens} | style | character |
|----|------|------------------------------|-------|-----------|
| `trail_buggy` | Trail Buggy | {1, 0, 0} (starter) | `buggy` | balanced |
| `dirt_runner` | Dirt Runner | {2, 2500, 1} | `dirt` | light, snappy acceleration, twitchy, great air control |
| `mountain_truck` | Mountain Truck | {4, 7500, 2} | `truck` | heavy, powerful, stable, thirsty |
| `rally_beast` | Rally Beast | {7, 15000, 3} | `rally` | high top speed, excellent suspension |
| `rock_crawler` | Rock Crawler | {10, 25000, 4} | `crawler` | huge grip & torque, slow, climbs anything, AWD |
| `storm_runner` | Storm Runner | {14, 45000, 6} | `storm` | futuristic, fast, low drag, special **Ion Thruster** |

A locked vehicle is purchasable when player level ≥ `unlock.level`, paying **either** `coins` **or** `tokens`.

`VehicleDef`: `{ id, name, tagline, description, unlock:{level,coins,tokens}, upgradeBaseCost, style,
colors:{body, accent, trim, wheel, rim}, special: null | {id:'thruster', name:'Ion Thruster', cooldown, duration, force}, base:{...owner-defined} }`.

`upgradeCost` formula (other modules rely on it being deterministic):
`Math.round(def.upgradeBaseCost * CAT_MULT[catId] * Math.pow(1.55, currentLevel - 1) / 10) * 10`.

Upgrade effects (must be real, noticeable, monotonic):
ENGINE → motor torque & max wheel speed; SUSPENSION → spring/damper quality & travel (less bounce, better
absorption); TIRES → rolling resistance ↓, surface penalty ↓ (snow/sand/ice) & slight top speed;
FUEL → capacity ↑ & burn ↓; GRIP → base friction μ ↑; AIR CONTROL → air rotation torque ↑;
BRAKES → brake torque & reverse power ↑, better downhill control.

`TunedParams` (all local coordinates are relative to the chassis **center of mass**, y-up, facing +x):
```
{
  id, style,
  chassis: { mass, inertia,
             hull: [{x,y},...],         // CCW polygon; body–terrain contact points + render bounds
             head: {x, y, r} },         // driver head circle — touching ground/ceiling/hazard = crash
  wheels: [ rear, front ],              // each { mount:{x,y}, radius, mass, inertia, drive (0..1 torque share) }
  suspension: { rest, minLen, maxLen, stiffness, damping }, // wheel center = mount + chassisDown * len
  motor: { torque, maxOmega, reverseTorque, reverseMaxOmega },
  brakeTorque, grip, surfaceAdapt /*0..1*/, rollingResistance,
  airTorque, groundLeanTorque, angularDampingAir,
  fuel: { capacity, burnRate /*units/s at full throttle*/, idleBurn /*units/s*/ },
  maxSpeed,                             // m/s clamp for this vehicle (≤ RR.CONST.MAX_SPEED)
  special                               // copy of def.special or null
}
```
Balance anchors (others depend on these): stock `trail_buggy` top speed ≈ 20–24 m/s, fully upgraded
≈ 30–34 m/s; `storm_runner` fully upgraded ≤ 42 m/s. Fuel capacity 100 units for the buggy; a full
tank must last ≈ 45–60 s of full throttle (≥ 550 m of typical driving) at stock level.

## 4. Persistence & progression

### 4.1 `RR.Save` — `js/core/save.js`
```
RR.Save.KEY = 'ridgeRush.save.v1'
RR.Save.data          // live save object (always valid after load())
RR.Save.load()        // → data. JSON.parse in try/catch; deep-merge into defaults; sanitize EVERY field
                      //   (finite numbers, clamped ranges, known ids only, unlocked lists always contain
                      //   the starter vehicle/world). Corrupt → defaults and RR.Save.recovered = true.
RR.Save.save()        // write (never throws); returns bool
RR.Save.reset()       // defaults, save, emit 'saveReset'
RR.Save.defaults()    // fresh default object
RR.Save.ensureVehicle(vehicleId) // → upgrades object for vehicle, creating {engine:1,...,brakes:1} if missing
```
Save shape (exact field names):
```
{
  version: 1,
  coins: 0, tokens: 0, xp: 0, level: 1,
  selectedVehicle: 'trail_buggy', selectedWorld: 'green_valley',
  unlockedVehicles: ['trail_buggy'], unlockedWorlds: ['green_valley'],
  upgrades: { trail_buggy: { engine:1, suspension:1, tires:1, fuel:1, grip:1, air:1, brakes:1 } },
  bestDistances: { /* worldId: meters */ }, bestDistance: 0,
  stats: { runs, totalDistance, coinsCollected, backflips, frontflips, doubleFlips, perfectLandings,
           fuelCollected, powerups, crashes, bossesCleared, maxCombo, longestAir, missionsCompleted,
           dailyCompleted, playTime },                                   // all numbers, default 0
  missions: { day: '', active: [], bonusClaimed: false },
  daily: { day: '', best: 0, attempts: 0, completed: false },
  cosmetics: { unlocked: ['paint_factory'], selected: { /* vehicleId: paintId */ } },
  settings: { sound: true, music: true, quality: 'high', sensitivity: 1, reducedMotion: false,
              showFps: false, touchControls: 'auto' },                  // touchControls: auto|on|off
  seenTutorial: false
}
```

### 4.2 `RR.Progression` — `js/systems/progression.js`
```
MAX_LEVEL = 50
xpForLevel(level)        // XP to go level→level+1 = Math.round(200 * Math.pow(level, 1.4) / 10) * 10
levelInfo(totalXp?)      // → {level, xpInto, xpNext, progress 0..1} (defaults to save.xp)
addXp(n)                 // → {levelsGained, level, rewards[]}; updates save.xp/level; unlocks level cosmetics;
                         //   emits 'levelup' per level gained; saves
addCoins(n) / spendCoins(n)→bool / addTokens(n) / spendTokens(n)→bool   (save + emit)
maxUpgradeLevel(playerLevel)   // 4 if <5, 7 if <12, else 10  ("upgrade tiers")
requiredLevelForUpgrade(targetLevel) // 1 for ≤4, 5 for 5..7, 12 for 8..10
canUpgrade(vehicleId, catId)   // → {ok, reason:''|'max'|'coins'|'tier'|'locked', cost, level, requiredLevel}
upgrade(vehicleId, catId)      // → same + {newLevel}; spends coins; saves; emits 'upgrade'
vehicleStatus(vehicleId)       // → {unlocked, levelOk, canCoins, canTokens, requirementText}
unlockVehicle(vehicleId, method:'coins'|'tokens') // → {ok, reason}
worldStatus(worldId)           // → {unlocked, levelOk, canBuy, requirementText}
unlockWorld(worldId)           // → {ok, reason}
selectVehicle(id) / selectWorld(id)  // only if unlocked; saves
COSMETICS                      // [{id, name, level, colors|null}] ≥ 10 paints, 'paint_factory' (level 1, colors null)
getPaint(vehicleId)            // → colors {body, accent, trim, wheel, rim} (vehicle defaults merged with paint)
selectPaint(vehicleId, paintId)// → bool (must be unlocked)
rewardsForLevel(level)         // → [{type:'vehicle'|'world'|'upgradeTier'|'cosmetic', id?, text}]
computeRunRewards(summary)     // → { coins, bonusCoins, totalCoins, tokens,
                               //     xp:{distance, coins, tricks, boss, record, total},
                               //     newRecord /*overall best*/, newWorldRecord, previousBest }
applyRunResults(summary)       // computes rewards, adds coins/tokens/xp, updates bests & stats, saves.
                               //   → rewards + { levelUp: {levelsGained, level, rewards[]} }
```
XP rules: distance `floor(m/10)`, coins `floor(totalCoins/25)`, tricks `summary.trickXp`, boss
`summary.bossXp`, record `+250` for a new world best ≥ 100 m. Attract/menu runs never grant anything.

### 4.3 `RR.MissionTemplates` + `RR.Missions`
Stat keys (exact) passed to `RR.Missions.track(stat, value, ctx)`:
`distance` (sum, delta m) · `runDistance` (max, current run distance) · `coins` (sum, coin value) ·
`backflips` · `frontflips` · `doubleFlips` · `perfectLandings` · `fuelCans` · `airTime` (sum s) ·
`wheelie` (sum m) · `combo` (max) · `powerups` · `bossCleared` · `dailyComplete` · `tricks` (sum of any trick)
· `worldDistance` (max; `ctx.worldId` must equal mission's worldId).
```
RR.MissionTemplates   // ≥ 12 templates {id, text:'Travel {n} m in total', stat, mode:'sum'|'max', targets[tiers], rewardCoins[], rewardXp[], worldId?}
RR.Missions.ensureToday()       // new deterministic set of 3 missions when save.missions.day != today
RR.Missions.getActive()         // → MissionInstance[3]
  MissionInstance {id, templateId, text, stat, mode, target, progress, worldId?, reward:{coins,xp,tokens},
                   completed, claimed}
RR.Missions.track(stat, value, ctx) // → newly completed MissionInstance[] (emits 'missionComplete'); no save
RR.Missions.claim(id)           // → {ok, reward}; grants via Progression; saves; emits 'missionClaimed'
RR.Missions.claimableCount()
RR.Missions.BONUS = {coins, xp, tokens:1}; canClaimBonus(); claimBonus()  // all 3 claimed → bonus
RR.Missions.timeUntilReset()    // ms until local midnight
```

### 4.4 `RR.Daily` — `js/systems/daily.js`
```
RR.Daily.todayKey()          // 'YYYY-MM-DD' local
RR.Daily.getChallenge(day?)  // deterministic from the date → DailyChallenge
  DailyChallenge { day, seed, id, name, description, icon, worldId, modifiers, targetDistance,
                   reward:{coins, xp, tokens} }
  modifiers { gravityMul:1, noFuelPickups:false, fuelEfficiencyMul:1, speedMul:1, terrainAmpMul:1,
              frictionMul:1, coinMul:1, coinDensityMul:1, windMul:1, labels:[...] }
  Challenge ids (≥ 7): low_gravity, no_fuel, max_speed, extreme_hills, ice, coin_rush, storm_winds.
  no_fuel must stay beatable (e.g. fuelEfficiencyMul 0.45 + moderate target).
RR.Daily.status()            // → {day, best, attempts, completed} (resets when the day changed)
RR.Daily.recordAttempt(distance) // → {completedNow, best, reward|null}; first completion grants reward
                                 //   via Progression and tracks mission 'dailyComplete'; saves
RR.Daily.timeUntilNext()     // ms
```
The daily world is playable even if the player hasn't unlocked it (it's a teaser).

## 5. Simulation modules

### 5.1 `RR.Terrain` — `js/game/terrain.js`
Heightfield sampled every `RR.CONST.TERRAIN_DX` m, generated in chunks ahead of the camera, trimmed behind.
```
new RR.Terrain({ seed, world, modifiers })   // modifiers = DailyModifiers | null
RR.Terrain.DX
t.minX, t.maxX                   // stored range; x < minX is a steep rising wall (vehicle can't escape back)
t.ensure(xMax)                   // generate until maxX ≥ xMax; calls t.onChunk(x0, x1, featuresInChunk)
t.trim(xMin)                     // drop data left of xMin (keep ≥ 40 m behind the vehicle — Run uses x-250)
t.heightAt(x) / t.slopeAt(x) / t.normalAt(x, out) // out {x,y} unit normal
t.surfaceAt(x)                   // → RR.SURFACES entry (shared frozen object)
t.closestPoint(px, py, maxDist, out) // → bool; out {x, y, nx, ny, dist, inside}: nearest point on the
                                     //   polyline within maxDist, normal points from surface toward p,
                                     //   inside = p is below the surface
t.ceilingAt(x)                   // → y | null (only inside cave sections)
t.sectionAt(x)                   // → SectionInfo | null
t.sections                       // SectionInfo[] generated so far
  SectionInfo { id:'canyon'|'storm'|'cave'|'volcano'|'moon'|'boss', name:'THE CANYON', start, end,
                bossName?, summitX?, tier? }
t.features                       // Feature[] sorted by x
  Feature { type:'jump'|'gap'|'lava'|'steep'|'rocks'|'plateau'|'valley'|'summit'|'bouncepad'|'boostpad'|
            'checkpoint', x, x2, y, meta:{ takeoffX, takeoffAngle, landingX, apexY, width, ... } }
t.decorations                    // {x, y, type, scale, layer:'back'|'front', variant}[] sorted by x
t.getIndexRange(x0, x1)          // → [i0, i1] global indices (clamped to stored data)
t.pointX(i), t.pointY(i), t.surfaceIdx(i)   // fast accessors for the renderer
t.difficultyAt(x)                // 0..1
t.validate(x0, x1)               // → {ok, problems[]} (used by tests)
```
Generation requirements: seeded (same seed+world+modifiers ⇒ identical terrain); flat safe start zone
(first ~40 m) plus a back wall; patterns (rolling hills, big hills, valleys, steep climbs, descents,
jumps with ramps, gaps as clearable trenches with a launch ramp, rocky bumpy sections, plateaus, lava pools
in volcanic worlds / volcano sections, bounce & boost pads in neon city); difficulty ramps with distance
(`world.terrain.difficultyDistance`); **always playable**: slope clamp (except short designed ramps),
smoothing, gap widths derived from reachable speed, no wheel-trapping spikes, lava only with a jump ramp
before it. Major sections every ~2000–3000 m (first ≈ 1200–1800 m) from `world.sectionPool`. Boss section
("mountain giant" climb, `world.bossName`) first at 3000 m, then every 5000 m; long steep climb with
short rest ledges and a flat **summit** plateau (`summitX`). Boss has priority over other sections.
`world.altSurface` patches (ice in snow, mud in valley, etc.). Cave sections define a ceiling ≥ 9 m
above the ground.

### 5.2 `RR.VehicleBody` — `js/game/physics.js`
Custom lightweight rigid-body physics: chassis rigid body + 2 wheels (mass, radius, spin), spring-damper
suspension along the chassis-down axis, circle-vs-polyline wheel contact with friction & motor torque,
hull-point contact for the chassis, driver head crash detection.
```
new RR.VehicleBody(tuned, x, y)      // spawn chassis COM at (x,y), level, at rest
b.placeOnTerrain(terrain, x)         // pose resting on terrain at x (angle = slope), zero velocity
b.x, b.y, b.angle (continuous, NOT wrapped), b.vx, b.vy, b.av
b.wheels[0 rear, 1 front] = { x, y, vx, vy, radius, spin, omega, grounded, nx, ny, surface,
                              compression 0..1, load }
b.grounded, b.bothGrounded, b.bodyContact
b.headHit        // sticky: set when head circle touches terrain/ceiling; Run reads & clears
b.hazard         // null | 'lava' — sticky: a wheel/hull/head touched a hazard surface; Run reads & clears
b.airTime        // s since last wheel/hull contact
b.lastImpact     // {speed, time} normal speed of the latest touchdown (Run/Tricks read)
b.step(dt, controls, env)
   controls { throttle:-1..1 (+gas, −brake/reverse), lean:-1..1 (+ = CCW / lean back / nose up),
              handbrake:bool, boost:0..1 (extra forward thrust), engineOn:bool }
   env { terrain, gravity (m/s², positive), wind (m/s², +x), frictionMul (1), sensitivity (0.5..1.5) }
   While airborne, throttle also rotates the chassis (gas → CCW/backflip, brake → CW/frontflip);
   lean adds explicit air control (airTorque) and a smaller ground lean (groundLeanTorque).
b.worldPoint(lx, ly, out) / b.getHead(out) → {x,y,r} / b.getMount(i, out)
b.applyImpulse(ix, iy, px, py)       // world impulse at world point
b.rescue(terrain)                    // shield save: upright on slope, above terrain, keep ~60% forward speed
b.speedKmh()                         // |vx,vy| * 3.6
```
Hard requirements: no tunneling through terrain at max speed, deep-penetration recovery (wheel center
below ground ⇒ pushed out), NaN guard (restore last good state), clamp linear/angular speed,
stable at rest on 40° slopes with brakes, a stationary car cannot spin itself into flips.

### 5.3 `RR.Camera` — `js/game/camera.js`
```
new RR.Camera(); cam.x, cam.y (world center), cam.zoom (CSS px per meter), cam.viewW, cam.viewH,
cam.shakeX, cam.shakeY (world m offsets)
cam.setViewport(w, h); cam.reset(x, y)
cam.update(dt, target {x, y, vx, vy, airTime, heightAboveGround}, opts {reducedMotion})
cam.shake(intensity_m, duration_s)   // no-op-ish when reducedMotion
cam.worldToScreen(wx, wy, out) / cam.screenToWorld(sx, sy, out)
cam.bounds(out) → {left, right, bottom, top} (world, includes margin-free view)
```
Base zoom ≈ `min(viewH/15, viewW/24)`; look-ahead ∝ vx; smooth exponential follow (frame-rate independent);
zoom out ≤ 18 % with speed and ≤ 15 % on big air; subtle, never jittery.

### 5.4 `RR.Particles`, `RR.FloatText` — `js/game/particles.js`
```
new RR.Particles(maxCount)  p.emit(type, x, y, count, opts{vx, vy, spread, speed, angle, color, size, life})
  types: dust smoke spark coin snow lava explosion boost ember debris star confetti splash shield
p.update(dt, env{gravity, wind}); p.draw(ctx, camera) /* WORLD transform */; p.clear(); p.setQuality(q)
new RR.FloatText(max) f.add(text, wx, wy, opts{color, size, life}); f.update(dt); f.draw(ctx, camera) /* SCREEN transform */
```

### 5.5 `RR.VehicleArt` — `js/game/vehicleArt.js`
```
RR.VehicleArt.draw(ctx, body, tuned, colors, t, opts)   // WORLD transform (y-up meters)
   opts { boost, shield, thruster, crashed, headlights, throttle }
RR.VehicleArt.drawPreview(ctx, vehicleId, colors, w, h, t) // UI canvas (screen px), idle bob; builds its own pose
```
Six visually distinct original designs keyed by `tuned.style`; wheels with rotating spokes (use
`wheel.spin`), suspension struts from mount to wheel (they visibly compress), original helmeted driver
whose head matches `tuned.chassis.head`.

### 5.6 `RR.Background` — `js/game/background.js`
```
new RR.Background(world, seed); bg.setWorld(world, seed); bg.setQuality(q)
bg.update(dt, camera, env)
bg.drawSky(ctx, camera, w, h, env)      // SCREEN transform: sky gradient, celestial, stars, clouds,
                                        //   ≥ 3 parallax silhouette layers (per-world shapes)
bg.drawWeather(ctx, camera, w, h, env)  // SCREEN transform: ambient weather, rain, lightning flash, fog
RR.Background.drawThumbnail(ctx, w, h, world)  // static; world-card preview
```

### 5.7 `RR.Renderer` — `js/game/renderer.js`
```
new RR.Renderer(canvas); r.ctx, r.w, r.h (CSS px), r.dpr
r.resize()           // backing store = CSS size × dpr (dpr cap: low 1, medium 1.5, high 2)
r.setQuality(q)
r.worldTransform(camera)   // ctx.setTransform(dpr*z, 0, 0, -dpr*z, dpr*(w/2 - (cx)*z), dpr*(h/2 + (cy)*z))
r.screenTransform()        // ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
r.drawRun(run)             // full frame (order below)
```
Frame order: sky → back decorations → terrain (filled polygon of visible range, textured top band per
surface, lava glow, distance posts every 100 m, "BEST" flag at the best distance, cave ceiling) →
collectibles → events (world) → particles → vehicle → front decorations → [screen] float text,
events (screen), darkness/headlight overlay (cave/storm), slow-time tint, low-fuel vignette, crash flash,
weather. Never draw text in the flipped world transform.

### 5.8 `RR.Collectibles` — `js/game/collectibles.js`
```
new RR.Collectibles(run)
c.spawnChunk(x0, x1, features)   // called from terrain.onChunk: coin trails on terrain, arcs above jumps,
                                 // coins in hard spots, bonus clusters; fuel; power-ups
c.addCoin(x, y, value, opts{vx, vy, falling})  // used by events (coin storm, bird drop)
c.update(dt, run)                // pickups vs chassis circle (~1.3 m) + wheels, magnet, animations, cleanup
c.draw(ctx, run)                 // WORLD transform
c.nextFuelDistance(x)            // m to next uncollected fuel pickup ahead (or Infinity)
```
Coins: value 5 (bronze) / 25 (silver) / 100 (gold) × `world.coinMul` × modifiers. Fuel kinds: `fuel`
(can: refill to 100 %), `cell` (+35 %), `mega` (full refill + 8 s no drain). First fuel ≈ 150 m, then
spacing `lerp(170, 360, difficulty) × world.fuelSpacing` (none when `modifiers.noFuelPickups`).
Power-ups every ≈ 300–500 m. Callbacks: `run.onCoin(value, x, y)`, `run.onFuel(kind, x, y)`,
`run.onPowerup(type, x, y)`.

### 5.9 `RR.PowerUps` — `js/game/powerups.js`
```
RR.PowerUps.TYPES = { magnet{name:'MAGNET',duration:10,color}, shield{name:'SHIELD',duration:45},
  boost{name:'BOOST',duration:4}, fuelboost{name:'FUEL BOOST',duration:0 /*instant*/},
  multiplier{name:'2X COINS',duration:12}, slowtime{name:'SLOW TIME',duration:6} }
new RR.PowerUps(run); pu.activate(type); pu.isActive(type); pu.remaining(type); pu.fraction(type)
pu.consumeShield() → bool; pu.update(dt); pu.list() → [{type, remaining, duration, fraction}]
```

### 5.10 `RR.Tricks` — `js/game/tricks.js`
```
new RR.Tricks(run); tr.update(dt, body, terrain)
tr.combo → {count, multiplier, timer, max}; tr.addComboAction(kind); tr.resetCombo()
tr.stats → {backflip, frontflip, doubleFlip, tripleFlip, perfect, longAir, wheelie, airTime, wheelieDist}
```
Detect backflip (CCW), frontflip (CW), double/triple flip (in one jump), long air, wheelie, perfect landing.
Rewards (before combo multiplier): BACKFLIP +100, FRONTFLIP +120, DOUBLE FLIP +300, TRIPLE FLIP +600,
LONG AIR +200, PERFECT LANDING +150, WHEELIE +50 (+ per meter). Awarded only on a **clean landing**; flips
need real airtime and horizontal travel (no stationary exploits). Combo: every trick / perfect landing /
fuel / power-up / coin pickup (throttled ≤ 1 per 1.5 s) increments; timeout `RR.CONST.COMBO_TIMEOUT` s;
multiplier `min(5, 1 + 0.5·(count−1))`; reset on crash. Calls `run.onTrick({id, label, coins, xp, combo})`.

### 5.11 `RR.EventSystem` — `js/game/events.js`
```
new RR.EventSystem(run); ev.update(dt); ev.drawWorld(ctx, run); ev.drawScreen(ctx, run)
```
Random events from `world.events` (ids: `falling_rocks bird coin_storm fuel_zone wind_gust steep_surprise
meteor_shower lava_eruption moving_ramp drones lightning`), seeded by `run.rng('events')`, every ~20–40 s
after 350 m, always telegraphed ≥ 1.5 s (HUD warning + world marker + `RR.Audio.play('warning')`), never
two hazards at once, none during boss climbs. Sections: on entering/leaving `terrain.sectionAt(x)` show a
banner and apply env effects (storm: wind + rain + lightning + some darkness; cave: darkness + headlights;
volcano: more eruptions + red tint; moon: gravity ×0.45; canyon: banner only — terrain does the work).
Boss: HUD progress, reward at `summitX` (coins 1500×tier, xp 400×tier, 1 token) via
`run.addBonus(coins, label)`, `run.bossXp`, `run.tokensEarned`, `run.stats.bossCleared`.
Hazard hits call `run.crash(reason)` (Run handles shield); knocks use `body.applyImpulse`.
Writes `run.env.wind`, `run.env.gravityMul`, `run.env.darkness`, `run.env.rain`, `run.env.lightning`,
`run.env.tint`, `run.env.sectionId`, `run.env.fuelZone` (bool: no drain + slow refill), `run.boss`.

### 5.12 `RR.Run` — `js/game/run.js`
One gameplay session (also used for the menu's attract-mode background with `mode:'attract'`).
```
new RR.Run({ worldId, vehicleId, mode:'normal'|'daily'|'attract', daily:DailyChallenge|null,
             renderer, onEnd(summary) })
run.update(dt)     // real dt (Game clamps). Never runs while Game is paused.
run.render()       // renderer.drawRun(run)
run.destroy()
Fields read by others: world, vehicleDef, tuned, colors, terrain, body, camera, particles, floatText,
  collectibles, powerUps, tricks, events, background, state ('running'|'crashed'|'nofuel'|'ended'),
  mode, time, distance, bestDistance, fuel, fuelMax, coins, bonusCoins, tokensEarned, bossXp, trickXp,
  stats, env {gravity, gravityMul, wind, frictionMul, darkness, rain, lightning, tint, sectionId,
  fuelZone, timeScale}, boss {name, start, summitX, progress, active} | null, invulnTime,
  specialCooldown, crashReason, modifiers
run.rng(name)      // seeded sub-RNG (stable per run seed + name)
run.onCoin(value,x,y) / run.onFuel(kind,x,y) / run.onPowerup(type,x,y) / run.onTrick(trick)
run.addBonus(coins, label) / run.announce(title, sub, kind) / run.warn(text, kind)
run.crash(reason)  // shield → consume + body.rescue + short invulnerability; else crash sequence
run.quit()         // end with reason 'quit'
run.getSummary()   // RunSummary
  RunSummary { worldId, vehicleId, mode, distance, coins, bonusCoins, tokens, trickXp, bossXp,
               tricks:{backflip, frontflip, doubleFlip, tripleFlip, perfect, longAir, wheelie},
               perfectLandings, fuelCollected, powerups, airTime, maxCombo, bossCleared, endReason
               ('crash'|'fuel'|'quit'), crashReason, time, missionsCompleted:[text] }
```
Per-frame order: controls → time scale (slow-time power-up, crash slow-mo) → fixed physics substeps →
fuel → distance & missions → tricks → collectibles → power-ups → events → crash/hazard checks →
particles & float text → camera → terrain ensure/trim → background → engine audio.
Crash rules: head hit, lava, or upside-down & stuck > 2.5 s. Out of fuel: engine off, run ends when
nearly stopped for ~1.5 s. Crash shows ~1.6 s slow-mo + shake, then `onEnd(summary)` exactly once.
Space = special (vehicles with `special`) else handbrake. Attract mode: simple autopilot, no rewards,
no missions, no HUD, no SFX, silently restarts on crash/fuel.

## 6. Shell modules

### 6.1 `RR.Input` — `js/core/input.js`
```
RR.Input.init()        // idempotent; keyboard + pointer/touch listeners
RR.Input.state         // {gas, brake, leanBack, leanForward, handbrake} merged keyboard+touch
RR.Input.getControls() // → {throttle, lean, handbrake}
RR.Input.on(evt, fn)   // 'pause' (P/Esc), 'restart' (R), 'mute' (M), 'special' (Space press),
                       // 'firstGesture' (once: unlock audio)
RR.Input.reset()       // release all (blur / pause / state change)
RR.Input.setTouchVisible(bool); RR.Input.setSpecialVisible(bool)
```
Keys: D/→ gas · A/← brake/reverse · W/↑ lean back · S/↓ lean forward · Space emergency brake / special ·
R restart · P/Esc pause · M mute. `preventDefault` on game keys. Touch: pointer events with per-pointer
tracking and `setPointerCapture`, multi-touch, `touch-action:none`, release on pointercancel/lostcapture/blur.

### 6.2 `RR.Audio` — `js/core/audio.js`
```
RR.Audio.init()                  // create AudioContext on first gesture (idempotent, never throws)
RR.Audio.setSound(on) / setMusic(on) / soundOn / musicOn
RR.Audio.play(name, opts{pitch, volume})
  names: click coin coinBig fuel powerup crash jump land landHard flip perfect combo upgrade unlock
         mission record levelup warning whoosh boost shield error tick thruster explosion lava wind
RR.Audio.engineStart(style) / engineUpdate({rpm 0..1, throttle 0..1, load 0..1, airborne}) / engineStop()
RR.Audio.music(style|null)       // menu valley highland desert ice volcanic space synthwave storm boss
RR.Audio.duck(on); RR.Audio.suspend(); RR.Audio.resume()
```

### 6.3 `RR.HUD` — `js/ui/hud.js`
```
RR.HUD.init(); RR.HUD.show(bool); RR.HUD.reset(run); RR.HUD.update(run, dt)
RR.HUD.popTrick(label, coins, color); RR.HUD.banner(title, sub, kind); RR.HUD.toast(text, kind)
RR.HUD.warning(text, kind); RR.HUD.flash(kind)
```
Shows: distance + best, coins (animated counter), fuel bar (low-fuel pulse) + next-fuel hint, speed,
combo ×N with timer, active power-ups with timers, boss progress, pause button, optional FPS.
Updates DOM only when values change.

### 6.4 `RR.UI` — `js/ui/screens.js`
Screens: `menu vehicles garage worlds missions daily settings pause results` (+ confirm modal, toasts,
level-up modal, first-run tutorial). `RR.UI.init(game)`, `RR.UI.show(id, params)`, `RR.UI.current`,
`RR.UI.confirm(title, msg, okLabel) → Promise<bool>`, `RR.UI.showResults(summary, rewards)`.
Every visible button works. Delegated click handling, built once, contents refreshed on show.

### 6.5 `RR.Game` — `game.js`
State machine `boot → menu ⇄ playing ⇄ paused → results → (retry | garage | menu)`. Single rAF loop
(guarded). Menu shows an attract-mode `Run` behind the UI. `startRun({worldId, vehicleId, daily})`,
`pause()`, `resume()`, `restart()`, `quitToMenu()`, `endRun(summary)`. Auto-pause on `visibilitychange`
/ blur. Resize/orientation → `renderer.resize()` + camera viewport. Applies settings (quality, audio,
reduced motion, FPS). Hotkeys R/P/M/Esc.
