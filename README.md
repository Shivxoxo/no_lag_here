# RIDGE RUSH — *Master the Mountains*

An original 2D physics hill-climbing driving game for the browser, built with vanilla JavaScript,
HTML5 Canvas, CSS and the Web Audio API. No frameworks, no build step, no backend, and no bitmap
or audio assets (only a small SVG favicon): all art is drawn procedurally and all sound and music is
synthesized at runtime.

Drive six original vehicles across endless, seeded, procedurally generated terrain in eight worlds.
Collect coins and fuel, land flips, chain combos, survive telegraphed hazards, conquer boss climbs,
complete daily missions and challenges, spend your earnings on upgrades, vehicles and worlds, and unlock
paint jobs by levelling up.

---

## How to run

**Option A: just open it.** Double-click `index.html`. Everything uses classic `<script>` tags,
so it works straight from `file://` in any modern browser (Chrome, Edge, Firefox, Safari).

**Option B: serve it locally.** Recommended for mobile testing on your LAN:

```bash
npx http-server -c-1 -p 8080 .      # or: npm run serve
# then open http://localhost:8080
```

Sound starts after your first click or key press, which is the browser autoplay policy.

### Tests

```bash
npm test                 # node unit tests for every module (tests/*.test.js)
npm run smoke            # Playwright end-to-end suite, run against both file:// and http
```

The smoke suite needs Playwright and a Chromium build installed for it. `npm run smoke` looks for
Playwright in `$NODE_PATH`, or in the global `node_modules` (`npm root -g`) when `NODE_PATH` is unset;
to use another install, run `NODE_PATH=/path/to/node_modules node tests/smoke.js`.

---

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Accelerate | **D** / **→** | **GAS** (bottom-right) |
| Brake / reverse | **A** / **←** | **BRAKE** (bottom-left) |
| Lean back: nose up, rotate counter-clockwise | **W** / **↑** | **TILT ↺** |
| Lean forward: nose down, rotate clockwise | **S** / **↓** | **TILT ↻** |
| Emergency brake, or the Storm Runner's **Ion Thruster** | **Space** | **SPECIAL** (Storm Runner only) |
| Restart (any time; a live run is banked first) | **R** | pause menu → RESTART |
| Pause / back | **P** / **Esc** | ❚❚ button (top-right) |
| Mute / unmute | **M** | Settings |

In the air, **gas also rotates the car backwards and brake rotates it forwards**, just as the wheels'
reaction torque would. Use W/S (or the tilt buttons) for full air control. Keyboard and touch work
at the same time. Touch controls appear automatically on touch devices and can be forced on or off
in Settings.

---

## Project structure

```
index.html              DOM: game canvas, menus, HUD, touch controls, modals; loads scripts in order
style.css               All UI styling (glass panels, buttons, HUD, responsive layout, animations)
game.js                 RR.Game: boot, state machine, the single requestAnimationFrame loop, hotkeys
assets/images/icon.svg  Procedural SVG favicon/logo glyph
assets/sounds/README.md Audio is synthesized at runtime (no sound files)
js/core/
  utils.js              Constants, surface table, seeded RNG, noise, formatting, easing, event bus
  save.js               RR.Save: structured localStorage save, sanitizing, backup, corruption recovery
  audio.js              RR.Audio: Web Audio SFX, engine synth, procedural music per world
  input.js              RR.Input: keyboard + multi-touch pointer controls
js/data/
  vehicles.js           RR.Vehicles: 6 vehicles, 7 upgrade categories × 10 levels, tuning math
  worlds.js             RR.Worlds: 8 biomes (palettes, terrain params, events, sections, music)
  missions.js           RR.MissionTemplates: daily mission templates
js/systems/
  progression.js        RR.Progression: XP/levels, coins/tokens, unlocks, upgrades, paints, run rewards
  missions.js           RR.Missions: deterministic daily missions, tracking, claiming, bonus
  daily.js              RR.Daily: date-seeded daily challenge with run modifiers
js/game/
  terrain.js            RR.Terrain: seeded chunked heightfield generator, sections, boss climbs
  physics.js            RR.VehicleBody: rigid chassis + sprung wheels, impulse contacts, air control
  camera.js             RR.Camera: smooth follow, look-ahead, speed/air zoom, shake
  particles.js          RR.Particles / RR.FloatText: pooled particles and floating score text
  vehicleArt.js         RR.VehicleArt: procedural drawing of the six vehicles and the driver
  background.js         RR.Background: sky, celestial bodies, parallax layers, weather
  collectibles.js       RR.Collectibles: coins, fuel cans, energy cells, mega orbs, power-up pickups
  powerups.js           RR.PowerUps: timed power-up effects
  tricks.js             RR.Tricks: flip / air / wheelie / perfect-landing detection, combos
  events.js             RR.EventSystem: random events, hazards, world sections, boss rewards
  renderer.js           RR.Renderer: frame composition, terrain art, decorations, lighting, overlays
  run.js                RR.Run: one gameplay session (semi-fixed-step simulation, fuel, crashes, rewards)
js/ui/
  hud.js                RR.HUD: in-run heads-up display
  screens.js            RR.UI: menu, vehicle select, garage, worlds, missions, daily, settings,
                        pause, results, modals, toasts, tutorial
docs/                   ARCHITECTURE.md (module contracts), INTEGRATION_NOTES.md, REQUIREMENTS.md
tests/                  harness.js (runs browser scripts in node), *.test.js, smoke.js (Playwright)
```

Everything hangs off one global namespace, `window.RR`. Each file is an IIFE that registers its
module, and `game.js` boots on `DOMContentLoaded`. See `docs/ARCHITECTURE.md` for every module's
API contract.

---

## Major systems

### Physics (`js/game/physics.js`)
A custom lightweight rigid-body solver built for a chassis on two sprung wheels running over a heightfield.
- The **chassis** is a rigid body at its centre of mass with mass and inertia. Each **wheel** is a
  point mass with its own spin and rotational inertia.
- **Suspension:** each wheel slides on a strut along the chassis-down axis. An implicit
  spring-damper (with asymmetric bump/rebound) and hard bump stops keep it stable at any stiffness.
- **Motor and brakes** are angular constraints between wheel spin and the chassis, so every drive
  or brake torque reacts on the body. This is what produces wheelies, brake dive and throttle-driven
  rotation in the air. A traction and launch limiter keeps full-throttle starts from flipping the
  car, while deliberate W-wheelies still work.
- **Contacts:** wheel circles, hull points and the driver's head all collide with the terrain
  polyline and cave ceilings. Friction couples wheel spin to ground speed, scaled by the surface's
  grip (snow, ice, sand and so on). A warm-started iterative impulse solver runs first, then a
  position-correction pass.
- **Safety:** adaptive sub-stepping (anti-tunnelling), deep-penetration recovery, speed and spin
  clamps, and a NaN guard that restores the last good state.
- **Crash detection:** the driver's head touching ground, a ceiling or lava, or the car being stuck
  on its roof or tail.

Physics uses a semi-fixed timestep: each frame's (time-scaled) dt is split into n equal sub-steps of at
most 1/120 s (capped at MAX_SUBSTEPS), so every rendered frame shows the exact simulated pose at any
refresh rate. There is no accumulator and no interpolation.

### Procedural terrain (`js/game/terrain.js`)
- **Generation:** a seeded pattern generator writes 64 m chunks ahead of the camera and trims behind
  it. Patterns: rolling hills, big hills, valleys, climbs, descents, ramps, clearable gap trenches,
  rock gardens, plateaus, lava pools, and bounce/boost pads in Neon City.
- **Difficulty:** it ramps with distance, bringing more gaps and steeper climbs later.
- **Always playable:** every gap and lava jump passes a ballistic check against reachable speed.
  Slopes are clamped, tight dips are smoothed out, and trench exits are always climbable.
- **Major sections:** the first arrives at 1.2–1.8 km, then every 2–3 km: **THE CANYON**, **THE STORM**, **THE CAVE**
  (with a ceiling and darkness), **THE VOLCANO** and **THE MOON** (low gravity).
- **Boss runs** come at 3 km and then every 5 km: an extreme climb (*THE MOUNTAIN GIANT* and one
  per world) with a summit reward of coins, XP and a vehicle-unlock token.

### Vehicles and upgrades (`js/data/vehicles.js`)
There are six original vehicles, each with its own mass, geometry, torque, top speed, grip,
suspension, air control, fuel use and stability:

| Vehicle | Character |
|---|---|
| **Trail Buggy** | balanced starter |
| **Dirt Runner** | light, snappy, huge air control |
| **Mountain Truck** | heavy, stable, powerful, thirsty |
| **Rally Beast** | fast, best suspension |
| **Rock Crawler** | slow, enormous grip, climbs anything |
| **Storm Runner** | futuristic, fastest; **Ion Thruster** special |

Seven upgrade categories (**ENGINE, SUSPENSION, TIRES, FUEL, GRIP, AIR CONTROL, BRAKES**) each have
10 levels. Every level changes the real physics parameters. The garage headlines each upgrade in
player terms (top speed, landing softness, snow grip, seconds of fuel, climbable slope, flip speed,
stopping power) with the current and next-level values, and the technical numbers in small print.

### Worlds (`js/data/worlds.js`)
**Green Valley, Rocky Highlands, Desert Canyon, Snow Peaks, Volcanic Ridge, Moon Base, Neon City,
Storm Planet.** Each world has its own:
- palette and parallax skyline
- terrain surface: grip, look and particles
- decorations and weather
- event pool and section pool
- music style
- difficulty and coin multiplier

Examples: snow and ice are slippery, volcanic ground has lava, the Moon has 0.42 g, Neon City has
launch pads, moving ramps and drones, and Storm Planet has hurricane gusts and lightning. Gusts are
capped (and a strong headwind is announced with a HEADWIND! warning) so a car can always push through.

### Gameplay loop (`js/game/run.js`, `collectibles.js`, `powerups.js`, `tricks.js`, `events.js`)
- **Fuel** drains while you drive. Pick up **fuel cans** (full), **energy cells** (+35 %) and rare
  **mega orbs** (full tank plus 8 s of free fuel). When the tank runs dry the engine dies and the
  run ends once the car rolls to a stop.
- **Coins** come in bronze, silver and gold and appear in trails, in arcs over jumps and gaps, in
  risky spots and in bonus clusters. They are animated, with particles, sound and an animated counter.
- **Tricks:** BACKFLIP +100, FRONTFLIP +120, DOUBLE FLIP +300, TRIPLE FLIP +600, LONG AIR +200,
  PERFECT LANDING +150 and WHEELIE. Tricks are paid only on a clean landing, and they require real
  airtime and horizontal travel, so spinning in place earns nothing.
- **Combos** chain tricks, landings and pickups into a coin multiplier. A combo breaks on a crash
  or after inactivity.
- **Power-ups:** MAGNET, SHIELD (survives one crash), BOOST, FUEL BOOST, 2X COINS, SLOW TIME.
- **Random events** are always telegraphed at least 1.5 s ahead with a HUD warning and a world
  marker: falling rocks, eagle coin drops, coin storms, fuel bonus zones, wind gusts, steep-climb
  alerts, meteor showers (Moon), lava eruptions (Volcanic), moving ramps and drones (Neon City),
  and lightning (Storm Planet). Hazards are aimed so a car holding its speed is safe: falling rocks
  land before it arrives (only a rock still falling is lethal; a landed one is an obstacle), and
  lava vents and meteors miss it.

### Progression (`js/systems/*`, `js/core/save.js`)
- **XP and levels:** XP comes from distance, coins, tricks, bosses, records, missions and daily
  challenges. Levels unlock vehicles, worlds, upgrade tiers (up to level 4, then 7, then 10) and
  paint jobs.
- **Daily missions:** three per day, chosen deterministically from the date, with coin, XP and
  token rewards plus an all-complete bonus.
- **Daily Challenge:** seeded by the date, so everyone gets the same challenge on the same day.
  Modifiers include low gravity, no fuel pickups, max speed, extreme hills, ice, coin rush, gale
  winds, heavy gravity and chaos. The HUD shows the day's modifiers under the GOAL, a gold GOAL flag
  marks the target in the world, and the Black Ice challenge glazes the ground with ice.
- **Save:** everything persists in one structured `localStorage` object. It is sanitized on load,
  backed up, recovered gracefully if corrupted, and can be wiped with **RESET SAVE DATA** (with a
  confirmation step).

### Presentation
- **Renderer:** procedural "vector poster" art, per-surface terrain styling, decorations for every
  world, cave darkness with headlights, lava glow, distance posts and a BEST flag, weather, and
  full-screen effects for slow-time, low fuel and crashes.
- **Camera:** look-ahead, speed and air zoom, and a frame-rate-independent spring with crash shake.
  Reduced-motion mode tones the motion down.
- **Audio:** a synthesized engine per vehicle style, around 27 sound effects, and procedural
  generative music for the menu, all eight worlds and boss runs, with separate Sound and Music
  toggles.
- **UI:** glass-panel arcade UI with animated counters, screen transitions, level-up celebrations,
  toasts and a first-run tutorial. It is responsive from small phones (portrait and landscape) to 4K.

---

## Settings
Music, sound effects, graphics quality (AUTO / LOW / MEDIUM / HIGH; AUTO and every fixed level also use
dynamic resolution, which lowers the render scale when frames are slow and steps back up when they recover;
AUTO may also lower the quality level), control sensitivity, reduced motion, FPS counter (it also shows the
render scale when below 100 %, and the rendered quality in AUTO), touch controls (Auto / On / Off), and
RESET SAVE DATA.

---

## Known limitations
- The balance (fuel spacing, coin economy, XP pacing, boss difficulty) was tuned with automated
  driving bots and measurements rather than large-scale human playtesting.
- Performance was verified in headless Chromium, which renders in software: JS frame time is about
  1–2 ms. Real GPU and device timings, iOS Safari and physical touch hardware were not measured.
- Hazards such as rocks, meteors and drones interact with the car through impulses and crash checks.
  They are not full rigid bodies, so the car cannot push them around.
- The moving ramp in Neon City works as a launch trigger rather than solid moving geometry.
- Progress is stored only in this browser's `localStorage`. Clearing site data or using a private
  window loses it, and there is no cloud sync.
- Emoji are used for a few mission and daily icons, so their look depends on the system font.

## Ideas for future upgrades
- Ghost replays of your best run per world, and shareable daily-challenge result cards.
- More vehicles (a hover bike, a monster truck), plus decals, wheels and driver cosmetics.
- A course editor, or hand-built "stage" levels alongside the endless mode.
- Gamepad support (the Gamepad API) and remappable keys.
- An optional online leaderboard for the daily seed (this would need a small backend).
- An installable PWA with offline caching and cloud-save export/import.
- Weather cycles and day/night transitions within a run; more boss types per world.
