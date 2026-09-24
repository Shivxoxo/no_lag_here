# RIDGE RUSH — Product Requirements (from the product owner)

Build a complete, polished, highly replayable 2D physics-based hill-climbing driving game, INSPIRED BY the
hill-climbing genre but with its own original identity, mechanics, art direction, vehicles, environments,
UI, progression and features. Runs directly in a web browser.

**Important:** not a basic demo, not a static mockup, no buttons that do nothing, every visible feature must
work, playable immediately, must feel like a real small commercial-quality browser game. Do not copy
copyrighted characters, artwork, sounds, names, logos or exact UI from existing games. Original names and
visuals. Prioritize gameplay and responsiveness over unnecessary complexity.

## 1. Technology
HTML5, CSS3, vanilla JavaScript, HTML5 Canvas for the game, Web Audio API for sound. No React, no backend,
no external database, no login. Works by opening the HTML project in a modern browser. Structure:
`/index.html /style.css /game.js /assets/images/ /assets/sounds/` (+ more files if needed). Modular, readable.

## 2. Concept — "RIDGE RUSH", subtitle "Master the Mountains"
Drive different vehicles across dangerous procedurally generated mountain terrain. Goals: travel as far as
possible, collect coins, collect energy/fuel, perform flips and tricks, avoid crashing, complete missions,
unlock vehicles, upgrade vehicles, discover new environments, beat personal distance records. Satisfying
physics-based driving.

## 3. Core physics (extremely important)
Acceleration, braking/reverse, gravity, vehicle weight, wheel rotation, suspension, terrain collision,
vehicle rotation, air control, momentum, friction, different slopes, bouncing, landing physics, flip
detection, crash detection. The vehicle must NOT move along a predefined path — it interacts with the
terrain. Custom lightweight JS physics is fine. Vehicle has chassis, front wheel, rear wheel, suspension,
wheel grip, center of mass. Feels different depending on upgrades and vehicle type.

## 4. Controls
Desktop: A/← brake/reverse · D/→ accelerate · W optional front-wheel torque / air control · S optional
rear-wheel braking / air control · Space emergency brake / special action · R restart after crash · P pause
· M mute. Mobile: large touch controls LEFT/BRAKE, RIGHT/GAS, AIR ROTATE LEFT, AIR ROTATE RIGHT —
responsive, finger-sized, semi-transparent, not covering important gameplay. Keyboard and touch work
simultaneously.

## 5. Vehicles — at least 6 original
Trail Buggy (balanced starter), Dirt Runner (fast acceleration, lighter), Mountain Truck (heavy, powerful),
Rally Beast (high speed, good suspension), Rock Crawler (excellent climbing, slower), Storm Runner (advanced
futuristic, special handling). Each differs in weight, acceleration, max speed, grip, suspension, air
control, fuel efficiency, stability. Vehicle selection screen; locked vehicles show LOCKED and the
requirement to unlock.

## 6. Vehicle upgrades
Categories: ENGINE, SUSPENSION, TIRES, FUEL, GRIP, AIR CONTROL, BRAKES. Levels 1–10. Upgrades actually
affect gameplay (not cosmetic). Display current level, upgrade cost, next-level stats, upgrade button.
Coins are spent on upgrades.

## 7. Procedural terrain (one of the most important systems)
No tiny fixed map; generate dynamically: small hills, large hills, valleys, steep climbs, descents, jumps,
gaps, rocky sections, dangerous slopes, random variations. Progressively harder with distance.
Seeded/random generation so each run feels different. Avoid impossible terrain — always playable. Camera
smoothly follows the vehicle.

## 8. Biomes — at least 8
Green Valley, Rocky Highlands, Desert Canyon, Snow Peaks, Volcanic Ridge, Moon Base, Neon City, Storm Planet.
Each: unique background, terrain appearance, particles, obstacles, atmosphere, music/sound style,
increasing difficulty. E.g. snow = slippery; volcanic = lava hazards; moon = low gravity; neon city = ramps
and moving obstacles; storm planet = strong wind.

## 9. Fuel / energy
Fuel meter decreases while driving. Collect fuel cans, energy cells, large energy bonuses. At zero the
vehicle stops; the player can restart. FUEL upgrade increases capacity and efficiency.

## 10. Coins
On terrain, above jumps, in difficult locations, in trails, in bonus sections. Satisfying: coin animation,
small particle effect, sound, counter animation.

## 11. Tricks / stunts
Backflip, frontflip, double flip, long air time, wheelie, perfect landing. Bonus coins, e.g. BACKFLIP +100,
DOUBLE FLIP +300, PERFECT LANDING +150, LONG AIR +200. No exploits (e.g. spinning while stationary).

## 12. Missions (daily-style)
E.g. travel 5,000 m, collect 500 coins, 3 backflips, reach 2,000 m without crashing, collect 20 fuel cells,
5 perfect landings. Show progress. Rewards: coins, XP, vehicle unlock tokens.

## 13. Player progression
XP from distance, coins, missions, tricks, challenges, new records. Player levels unlock vehicles, worlds,
upgrade tiers, cosmetic items. Display player level prominently.

## 14. Daily challenge
Modifies the run: low gravity, no fuel pickups, maximum speed challenge, extreme hills, ice terrain, coin
rush. Deterministic daily seed from the current date (same date ⇒ same challenge).

## 15. Random events (fair and telegraphed)
Falling rocks, eagle/bird silhouette, sudden steep terrain, coin storm, fuel bonus zone, moving ramp, wind
gust, meteor shower in space, lava eruption in volcanic biome.

## 16. Power-ups (visually obvious)
MAGNET (attracts coins), SHIELD (protects from one crash), BOOST (temporary acceleration), FUEL BOOST
(restores fuel), COIN MULTIPLIER (2× coins), SLOW TIME (slows obstacles and physics).

## 17. Combo system
Collect coin + trick + perfect landing ⇒ COMBO ×3. Higher combos ⇒ larger rewards. Resets on crash or
inactivity.

## 18. Distance record / HUD
Current distance, best distance, coins, fuel, speed, combo. Distance increases smoothly. localStorage for
best distance, coins, vehicle unlocks, upgrades, player level, settings, missions. No sensitive data.

## 19. Game states
Main menu, vehicle select, garage, world select, gameplay, pause, crash, results, missions, settings.
Smooth transitions.

## 20. Main menu
Animated, polished. "RIDGE RUSH" / "Master the Mountains". Buttons: PLAY, GARAGE, WORLDS, MISSIONS, DAILY
CHALLENGE, SETTINGS. Animated background terrain.

## 21. Garage
Selected vehicle shown; ENGINE, SUSPENSION, TIRES, FUEL, GRIP, AIR CONTROL with visual stat bars;
upgrade buttons; "Coins: XXXX".

## 22. World select
Each world: name, difficulty, best distance, unlock requirement; locked worlds clearly say why.

## 23. Result screen
RUN COMPLETE, distance, best distance, coins earned, bonus coins, tricks, XP earned, NEW RECORD if
applicable. Buttons RETRY, GARAGE, MENU. Animate numbers increasing.

## 24. Graphics
Canvas, polished 2D: parallax backgrounds, mountains, clouds, trees, rocks, dust, snow particles, sparks,
smoke, coin particles, vehicle suspension animation, wheel rotation. Procedural drawing, no huge images.

## 25. Camera
Follows vehicle, looks slightly ahead, smooth, slight shake on crashes, slight zoom on major jumps,
adjusts for speed, no constant jitter.

## 26. Audio
Engine, coin pickup, fuel pickup, crash, jump, landing, upgrade, button click, mission completed, new
record. Sound ON/OFF, Music ON/OFF. No copyrighted music.

## 27. Particles
Lightweight: dust, smoke, sparks, coins, snow, lava, explosion/crash, boost. Optimized counts.

## 28. UI design
Modern and game-like: glass/transparent panels, rounded buttons, clear typography, animated counters,
progress bars, icons, smooth transitions. Must look like a polished arcade game, NOT an admin dashboard.

## 29. Responsive
Desktop, laptop, tablet, mobile. Canvas resizes correctly, correct aspect handling, important UI never
inaccessible.

## 30. Performance
60 FPS on normal laptops. Optimize rendering, particle count, terrain generation, object count, collision.
requestAnimationFrame. No unnecessary DOM elements per frame. No huge array allocation. Clean up old
terrain and particles.

## 31. Settings
Music, sound effects, graphics quality LOW/MEDIUM/HIGH, control sensitivity, reduced motion.

## 32. Save system
localStorage, structured save object {coins, xp, level, selectedVehicle, unlockedVehicles,
unlockedWorlds, upgrades, bestDistances, missions, settings}. Gracefully recover from corrupted data.
RESET SAVE DATA with confirmation.

## 33. Anti-bug checklist
Vehicle stuck in terrain, vehicle flying away, infinite fuel, NaN values, infinite speed, broken
collision, impossible terrain, duplicate event listeners, game continuing while paused, multiple animation
loops, broken restart, save corruption, mobile controls not responding, resize breaking the canvas,
upgrade buttons giving incorrect values. Clamp physics values.

## 34. Game feel (extremely important)
Fast, responsive, satisfying, physical, polished, replayable. Screen shake, camera zoom, particle bursts,
UI animations, floating score text, squash/stretch where appropriate, suspension movement, wheel spin,
landing impact. Don't overdo effects.

## 35. World events (major sections every few thousand meters)
"THE CANYON" big jump sequence; "THE STORM" strong wind; "THE CAVE" dark underground; "THE VOLCANO" lava
hazard; "THE MOON" low gravity.

## 36. Boss run
After a major distance milestone: "THE MOUNTAIN GIANT" — an extremely difficult climb (driving
challenge, not a fight). Reward: large coin bonus, XP, vehicle unlock token.

## 37. Originality
No Hill Climb Racing name/logos/vehicle designs/characters/music/textures/copied UI. Own identity.

## 38. Code quality
Logical systems: Game, Physics, Vehicle, Terrain, Camera, Particles, Audio, UI, Input, Collision,
Progression, SaveSystem, Missions, PowerUps. Classes/modules, commented physics, no needless complexity.

## 39–40. Process
Build in stages, keep previous systems working, never replace a requested system with a placeholder. If a
feature can't be done exactly, implement the closest functional browser version and explain. The player
must be able to: open the site, press PLAY, drive over terrain, collect coins, use fuel, perform flips,
crash, earn rewards, upgrade the vehicle, unlock content, start another run.
