/* RIDGE RUSH — world (biome) definitions.
 * Pure data consumed by terrain generation, rendering, events, audio and UI. */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});

  // Major-section catalogue (shared by terrain generation, events and HUD banners).
  const SECTION_INFO = Object.freeze({
    canyon: { id: 'canyon', name: 'THE CANYON', sub: 'Big air ahead — keep your speed up!', color: '#ffb347' },
    storm: { id: 'storm', name: 'THE STORM', sub: 'Brace for violent winds!', color: '#8fd4ff' },
    cave: { id: 'cave', name: 'THE CAVE', sub: 'Lights on. Mind the ceiling.', color: '#c9b37a' },
    volcano: { id: 'volcano', name: 'THE VOLCANO', sub: 'Lava everywhere — jump the pools!', color: '#ff6a1f' },
    moon: { id: 'moon', name: 'THE MOON', sub: 'Gravity is taking a break.', color: '#d8dcff' },
    boss: { id: 'boss', name: 'BOSS RUN', sub: 'Reach the summit!', color: '#ff4f6d' }
  });

  /*
   * Field reference
   *  difficulty 1..5 (stars) · unlock {level, coins} (bought once in World Select)
   *  gravity  multiplier on 9.81 · airDrag linear drag coefficient (1/s) applied to the chassis
   *  surface / altSurface: RR.SURFACES keys (altSurface appears as patches, altChance per chunk)
   *  terrain.amplitude  typical hill height (m) · hillLength typical hill wavelength (m)
   *  terrain.roughness  0..1 small bump strength · steepness 0..1 base steepness
   *  terrain.maxSlope   max rise/run for normal terrain (designed ramps may exceed briefly)
   *  terrain.difficultyDistance  distance (m) at which difficulty reaches 1
   *  terrain.features   relative pattern weights
   *  palette: sky/ground/silhouette colours · celestial: sun|big_sun|red_moon|earth|neon_moon|storm_sun
   *  ambient: pollen|mist|sand|snow|embers|stars|neon_rain|storm_rain
   *  decorations: renderer decoration types for this world
   *  events: random event pool · sectionPool: major sections that can appear
   *  wind {base, gust} m/s² · darkness 0..1 base ambient darkness · coinMul coin value multiplier
   *  fuelSpacing multiplier on fuel pickup spacing (>1 = rarer)
   */
  const list = [
    {
      id: 'green_valley',
      name: 'Green Valley',
      subtitle: 'Rolling meadows and gentle hills. Perfect for learning the ropes.',
      difficulty: 1, difficultyLabel: 'Easy',
      unlock: { level: 1, coins: 0 },
      gravity: 1, airDrag: 0.02,
      surface: 'grass', altSurface: 'mud', altChance: 0.12,
      terrain: {
        amplitude: 5.5, hillLength: 70, roughness: 0.18, steepness: 0.28, maxSlope: 0.8,
        difficultyDistance: 7000,
        features: { rolling: 4, hills: 3, valley: 2, climb: 1.5, descent: 1.5, jump: 2.5, gap: 1, rocks: 1, plateau: 2, lava: 0, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#3d8fdc', skyBottom: '#bfe6ff', horizon: '#eaf7ff',
        far: '#9cc0d6', mid: '#6fa45c', near: '#4d8a3b',
        groundTop: '#63c33c', groundTopDark: '#3f9a2a', ground: '#7b5331', groundDeep: '#4a301f',
        rock: '#8c8a82', accent: '#ffd34d', fog: 'rgba(225,242,255,0.22)', hazard: '#ff6a1f', cloud: '#ffffff'
      },
      celestial: 'sun', ambient: 'pollen',
      decorations: ['tree', 'bush', 'rock', 'flowers', 'fence'],
      events: ['bird', 'coin_storm', 'fuel_zone', 'falling_rocks', 'wind_gust', 'steep_surprise'],
      sectionPool: ['canyon', 'cave', 'storm', 'moon'],
      bossName: 'THE MOUNTAIN GIANT',
      wind: { base: 0, gust: 4 }, darkness: 0,
      musicStyle: 'valley', coinMul: 1, fuelSpacing: 1, dustColor: '#9b7b4f'
    },
    {
      id: 'rocky_highlands',
      name: 'Rocky Highlands',
      subtitle: 'Boulder fields and misty ridges. Bumpy, grippy and unforgiving.',
      difficulty: 2, difficultyLabel: 'Medium',
      unlock: { level: 2, coins: 1500 },
      gravity: 1, airDrag: 0.02,
      surface: 'rock', altSurface: 'grass', altChance: 0.2,
      terrain: {
        amplitude: 8.5, hillLength: 60, roughness: 0.42, steepness: 0.42, maxSlope: 0.9,
        difficultyDistance: 6500,
        features: { rolling: 2, hills: 3, valley: 2, climb: 2.5, descent: 2, jump: 2, gap: 1.2, rocks: 3.5, plateau: 1.5, lava: 0, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#5f86ad', skyBottom: '#d5e1ea', horizon: '#eef3f6',
        far: '#8793a2', mid: '#6d7b6b', near: '#56624d',
        groundTop: '#7f9456', groundTopDark: '#5f7140', ground: '#6f675d', groundDeep: '#433e38',
        rock: '#a09a90', accent: '#ffcf5a', fog: 'rgba(214,224,232,0.35)', hazard: '#ff6a1f', cloud: '#eef2f6'
      },
      celestial: 'sun', ambient: 'mist',
      decorations: ['pine', 'boulder', 'rock', 'cairn'],
      events: ['falling_rocks', 'bird', 'coin_storm', 'fuel_zone', 'wind_gust', 'steep_surprise'],
      sectionPool: ['canyon', 'cave', 'storm', 'volcano'],
      bossName: 'THE STONE COLOSSUS',
      wind: { base: 0, gust: 5 }, darkness: 0.05,
      musicStyle: 'highland', coinMul: 1.15, fuelSpacing: 1.05, dustColor: '#9d968b'
    },
    {
      id: 'desert_canyon',
      name: 'Desert Canyon',
      subtitle: 'Scorching dunes, deep gorges and huge jumps across the canyon floor.',
      difficulty: 2, difficultyLabel: 'Medium',
      unlock: { level: 4, coins: 4000 },
      gravity: 1, airDrag: 0.018,
      surface: 'sand', altSurface: 'rock', altChance: 0.25,
      terrain: {
        amplitude: 8, hillLength: 85, roughness: 0.22, steepness: 0.38, maxSlope: 0.85,
        difficultyDistance: 6500,
        features: { rolling: 3, hills: 2.5, valley: 2, climb: 1.5, descent: 1.5, jump: 3.5, gap: 2.5, rocks: 1, plateau: 2.5, lava: 0, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#e98b4a', skyBottom: '#ffe2b0', horizon: '#fff1d6',
        far: '#dca473', mid: '#c9834b', near: '#ad6538',
        groundTop: '#eabd73', groundTopDark: '#d19b52', ground: '#c07a45', groundDeep: '#8a4f2a',
        rock: '#b76e3f', accent: '#ffe066', fog: 'rgba(255,224,180,0.28)', hazard: '#ff6a1f', cloud: '#fff4e0'
      },
      celestial: 'big_sun', ambient: 'sand',
      decorations: ['cactus', 'mesa', 'rock', 'tumbleweed', 'bones'],
      events: ['coin_storm', 'fuel_zone', 'wind_gust', 'falling_rocks', 'bird', 'steep_surprise'],
      sectionPool: ['canyon', 'storm', 'cave', 'volcano'],
      bossName: 'THE SUN MESA',
      wind: { base: 0.4, gust: 5 }, darkness: 0,
      musicStyle: 'desert', coinMul: 1.3, fuelSpacing: 1.1, dustColor: '#e2bd7e'
    },
    {
      id: 'snow_peaks',
      name: 'Snow Peaks',
      subtitle: 'Frozen summits with slippery snow and treacherous ice sheets.',
      difficulty: 3, difficultyLabel: 'Hard',
      unlock: { level: 6, coins: 8000 },
      gravity: 1, airDrag: 0.02,
      surface: 'snow', altSurface: 'ice', altChance: 0.3,
      terrain: {
        amplitude: 10, hillLength: 75, roughness: 0.25, steepness: 0.45, maxSlope: 0.85,
        difficultyDistance: 6000,
        features: { rolling: 2.5, hills: 3, valley: 2, climb: 2.5, descent: 2.5, jump: 2.5, gap: 1.5, rocks: 1.5, plateau: 1.5, lava: 0, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#7aa3d4', skyBottom: '#e8f2ff', horizon: '#f6faff',
        far: '#cad9ea', mid: '#a9c0d8', near: '#8aa5c0',
        groundTop: '#f6f9ff', groundTopDark: '#d3deed', ground: '#9aa9ba', groundDeep: '#65738a',
        rock: '#7c8a99', accent: '#7fe0ff', fog: 'rgba(240,246,255,0.4)', hazard: '#ff6a1f', cloud: '#ffffff'
      },
      celestial: 'sun', ambient: 'snow',
      decorations: ['pine_snow', 'rock', 'ice_crystal', 'snow_mound'],
      events: ['falling_rocks', 'bird', 'coin_storm', 'fuel_zone', 'wind_gust', 'steep_surprise'],
      sectionPool: ['cave', 'storm', 'canyon', 'moon'],
      bossName: 'THE FROZEN GIANT',
      wind: { base: -0.4, gust: 6 }, darkness: 0,
      musicStyle: 'ice', coinMul: 1.5, fuelSpacing: 1.1, dustColor: '#f2f7ff'
    },
    {
      id: 'volcanic_ridge',
      name: 'Volcanic Ridge',
      subtitle: 'Ash-covered slopes, rivers of lava and erupting vents.',
      difficulty: 4, difficultyLabel: 'Very Hard',
      unlock: { level: 8, coins: 14000 },
      gravity: 1, airDrag: 0.02,
      surface: 'ash', altSurface: 'rock', altChance: 0.25,
      terrain: {
        amplitude: 10, hillLength: 65, roughness: 0.35, steepness: 0.5, maxSlope: 0.9,
        difficultyDistance: 5500,
        features: { rolling: 2, hills: 3, valley: 2, climb: 2.5, descent: 2, jump: 3, gap: 1.5, rocks: 2, plateau: 1.5, lava: 3, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#1c0a10', skyBottom: '#7a2c1b', horizon: '#c2481f',
        far: '#3b1a1c', mid: '#2b1516', near: '#1f1010',
        groundTop: '#4a3634', groundTopDark: '#2a1c1c', ground: '#2c1d1d', groundDeep: '#140c0c',
        rock: '#4d3636', accent: '#ff8a2a', fog: 'rgba(120,40,20,0.25)', hazard: '#ff5a14', cloud: '#5a3a36'
      },
      celestial: 'red_moon', ambient: 'embers',
      decorations: ['lava_rock', 'dead_tree', 'vent', 'rock'],
      events: ['lava_eruption', 'falling_rocks', 'coin_storm', 'fuel_zone', 'steep_surprise', 'wind_gust'],
      sectionPool: ['volcano', 'cave', 'canyon', 'storm'],
      bossName: 'THE MOLTEN TITAN',
      wind: { base: 0, gust: 4 }, darkness: 0.15,
      musicStyle: 'volcanic', coinMul: 1.8, fuelSpacing: 1.15, dustColor: '#5a4848'
    },
    {
      id: 'moon_base',
      name: 'Moon Base',
      subtitle: 'Low gravity, giant craters and endless floaty jumps.',
      difficulty: 4, difficultyLabel: 'Very Hard',
      unlock: { level: 10, coins: 20000 },
      gravity: 0.42, airDrag: 0.004,
      surface: 'regolith', altSurface: 'rock', altChance: 0.15,
      terrain: {
        amplitude: 12, hillLength: 90, roughness: 0.3, steepness: 0.45, maxSlope: 0.95,
        difficultyDistance: 6000,
        features: { rolling: 2, hills: 3, valley: 3, climb: 2, descent: 2, jump: 3.5, gap: 2.5, rocks: 1.5, plateau: 1.5, lava: 0, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#03040c', skyBottom: '#161b36', horizon: '#252c52',
        far: '#343a52', mid: '#50566b', near: '#666b7e',
        groundTop: '#c1c5d1', groundTopDark: '#9296a4', ground: '#6f7382', groundDeep: '#3d404e',
        rock: '#8a8e9a', accent: '#8fd8ff', fog: 'rgba(40,50,90,0.15)', hazard: '#ff6a1f', cloud: '#3a4060'
      },
      celestial: 'earth', ambient: 'stars',
      decorations: ['crater', 'antenna', 'dome', 'rock', 'flag'],
      events: ['meteor_shower', 'coin_storm', 'fuel_zone', 'steep_surprise'],
      sectionPool: ['moon', 'canyon', 'cave', 'volcano'],
      bossName: 'THE CRATER KING',
      wind: { base: 0, gust: 0 }, darkness: 0.05,
      musicStyle: 'space', coinMul: 2.0, fuelSpacing: 1.15, dustColor: '#c3c6d0'
    },
    {
      id: 'neon_city',
      name: 'Neon City',
      subtitle: 'A glowing megacity of ramps, launch pads and patrolling drones.',
      difficulty: 4, difficultyLabel: 'Very Hard',
      unlock: { level: 13, coins: 30000 },
      gravity: 1, airDrag: 0.015,
      surface: 'metal', altSurface: 'neon', altChance: 0.35,
      terrain: {
        amplitude: 9, hillLength: 55, roughness: 0.12, steepness: 0.5, maxSlope: 0.95,
        difficultyDistance: 5500,
        features: { rolling: 1.5, hills: 2, valley: 1.5, climb: 2, descent: 2, jump: 3.5, gap: 2.5, rocks: 0.5, plateau: 3, lava: 0, bouncepad: 2.5, boostpad: 2.5 }
      },
      palette: {
        skyTop: '#090320', skyBottom: '#2c0b4d', horizon: '#6a1a7a',
        far: '#1b1040', mid: '#251352', near: '#2f1864',
        groundTop: '#1ff2ff', groundTopDark: '#0e9fc2', ground: '#1b1233', groundDeep: '#0b0818',
        rock: '#3b2b6b', accent: '#ff2fd0', fog: 'rgba(120,20,160,0.18)', hazard: '#ff2f6d', cloud: '#3a1a6a'
      },
      celestial: 'neon_moon', ambient: 'neon_rain',
      decorations: ['neon_sign', 'lamp', 'antenna', 'billboard', 'tower'],
      events: ['drones', 'moving_ramp', 'coin_storm', 'fuel_zone', 'steep_surprise', 'wind_gust'],
      sectionPool: ['canyon', 'storm', 'cave', 'moon'],
      bossName: 'THE MEGA TOWER',
      wind: { base: 0, gust: 4 }, darkness: 0.2,
      musicStyle: 'synthwave', coinMul: 2.3, fuelSpacing: 1.2, dustColor: '#3ff3ff'
    },
    {
      id: 'storm_planet',
      name: 'Storm Planet',
      subtitle: 'An alien world of crystal spires, lightning and hurricane winds.',
      difficulty: 5, difficultyLabel: 'Extreme',
      unlock: { level: 16, coins: 45000 },
      gravity: 1.08, airDrag: 0.025,
      surface: 'crystal', altSurface: 'rock', altChance: 0.3,
      terrain: {
        amplitude: 11, hillLength: 60, roughness: 0.38, steepness: 0.55, maxSlope: 0.95,
        difficultyDistance: 5000,
        features: { rolling: 2, hills: 3, valley: 2, climb: 2.5, descent: 2.5, jump: 3, gap: 2, rocks: 2.5, plateau: 1.5, lava: 0.8, bouncepad: 0, boostpad: 0 }
      },
      palette: {
        skyTop: '#141925', skyBottom: '#3a4658', horizon: '#56657a',
        far: '#2a3140', mid: '#222834', near: '#1a1f28',
        groundTop: '#4b7263', groundTopDark: '#335045', ground: '#2e3440', groundDeep: '#181c25',
        rock: '#4b5362', accent: '#8ff0ff', fog: 'rgba(70,90,110,0.3)', hazard: '#b44dff', cloud: '#3b4556'
      },
      celestial: 'storm_sun', ambient: 'storm_rain',
      decorations: ['crystal', 'alien_plant', 'rock', 'lightning_rod'],
      events: ['lightning', 'wind_gust', 'falling_rocks', 'coin_storm', 'fuel_zone', 'steep_surprise'],
      sectionPool: ['storm', 'canyon', 'cave', 'volcano', 'moon'],
      bossName: 'THE STORM TITAN',
      wind: { base: 1.6, gust: 8 }, darkness: 0.25,
      musicStyle: 'storm', coinMul: 2.6, fuelSpacing: 1.2, dustColor: '#9ff3ff'
    }
  ];

  for (const w of list) {
    Object.freeze(w.terrain.features);
    Object.freeze(w.terrain);
    Object.freeze(w.palette);
    Object.freeze(w.unlock);
    Object.freeze(w.wind);
    Object.freeze(w.decorations);
    Object.freeze(w.events);
    Object.freeze(w.sectionPool);
    Object.freeze(w);
  }

  const index = new Map(list.map((w) => [w.id, w]));
  RR.Worlds = Object.freeze({
    list: Object.freeze(list),
    SECTION_INFO,
    byId: (id) => index.get(id) || null,
    indexOf: (id) => list.findIndex((w) => w.id === id)
  });
})();
