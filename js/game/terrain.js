/* RIDGE RUSH — procedural terrain (RR.Terrain).
 *
 * Contract: docs/ARCHITECTURE.md §5.1. World space is y-up, metres. The ground is a heightfield sampled
 * every RR.CONST.TERRAIN_DX metres (global sample index i ⇔ x = i·DX).
 *
 * Pipeline
 *  1. PATTERNS — a cursor walks forward and writes whole patterns (rolling hills, big hills, valleys,
 *     climbs, descents, jumps, gaps, rock gardens, plateaus, lava pools, neon pads, boss climbs) into the
 *     heightfield. Patterns are authored either as closed-form cosine shapes or with a tiny "turtle" that
 *     integrates piecewise-linear slope keyframes exactly on the sample grid (so ramp lips, trench floors
 *     and rims land exactly where the design math expects them). Joins are C1 (slope-blended).
 *  2. COMMIT — each written sample gets seeded fbm detail (scaled by world roughness), then passes a
 *     slope-limited follower (max slope grows with difficulty; designed ramps/walls are exempt), and
 *     concave kinks are relaxed so a wheel can never be trapped. Jump/gap/lava patterns are re-verified
 *     against the *actual* committed heights (ballistic check) and rolled back if they fail.
 *  3. FINALIZE — the heightfield is published in 64 m chunks: alt-surface patches, cave ceilings and
 *     decorations are added, features are published and onChunk() fires.
 *  4. SCHEDULE — major sections and boss climbs come from a deterministic plan (see _planNextMajor).
 *
 * Contract notes / additions (callers may ignore all of these):
 *  - closestPoint(): exactly as specified — out.nx/ny points from the surface point TOWARD p, so when
 *    p is inside the ground (out.inside) it points INTO the ground. Extra fields: out.snx/out.sny =
 *    outward (up-facing) unit surface normal at the closest point, out.index = segment start index.
 *    When nothing is within maxDist it returns false and only sets out.dist = Infinity, out.inside.
 *  - Feature.meta for 'jump' | 'gap' | 'lava' also carries takeoffY, landingY, apexX, rampX, rampHeight,
 *    landingZoneX2; gap/lava add depth, floorY, trenchX, trenchX2, vReq (required launch speed, m/s);
 *    lava adds poolX, poolX2, poolY. 'steep' meta: {maxSlope, dir (+1 up / −1 down), rise}.
 *    'plateau' meta: {length, ledge?, summit?, tier?}. 'valley' meta: {bottomX, bottomY, depth}.
 *    'rocks' meta: {bumpHeight, length}. 'bouncepad'/'boostpad' meta: {power, length}.
 *    'summit'/'checkpoint' meta: {tier, bossName}.
 *  - Extra methods: maxSlopeAt(x), upcomingSection(x), jumpCheck(feature), flagsIdx(i), surfaceInfoIdx(i).
 *  - Instance getter t.DX (same as the static). Statics: RR.Terrain.DX, RR.Terrain.FLAGS,
 *    RR.Terrain.SURFACE_TYPES (index → surface key), RR.Terrain.SURFACE_LIST (index → frozen
 *    SurfaceInfo), RR.Terrain.V_LIMIT (16 m/s cap on any gap/lava required launch speed).
 *  - ensure() generates at most ~4 km per call (guards against ensure(Infinity)); if generation ever
 *    throws, it logs once and publishes a flat safety chunk instead of breaking the run.
 *  - getIndexRange(x0, x1, out?) accepts an optional reusable 2-element array.
 *  - Assigning t.onChunk replays the chunks already finalized (and not yet trimmed) to the new callback,
 *    so no coins are lost if Run calls ensure() before wiring onChunk.
 *  - The constructor writes (but does not publish) the flat start area, so heightAt() works immediately;
 *    maxX < minX until the first ensure().
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const CONST = RR.CONST || {};
  const DX = CONST.TERRAIN_DX || 0.5;
  const G0 = CONST.GRAVITY || 9.81;
  const clamp = U.clamp, lerp = U.lerp, isNum = U.isNum, safeNum = U.safeNum;
  const PI = Math.PI;

  // ------------------------------------------------------------------ tunables
  const CHUNK_N = Math.round(64 / DX);        // samples per published chunk (64 m)
  const LOOKAHEAD_N = Math.round(24 / DX);    // heights written ahead of a chunk before it is finalized
  const START_X = -60;                        // initial minX (back wall)
  const START_FLAT_END = 40;                  // flat safe zone [-60, 40]
  const WALL_SLOPE = 3;                       // rise/run of the virtual wall left of minX
  const MAX_PATTERN_N = Math.round(2000 / DX);
  const V_LIMIT = 16;                         // required launch speed never exceeds this (m/s)
  const V_EST = 18;                           // launch speed used for landingX / apex estimates
  const RAMP_MAX = 0.7;                       // max designed ramp slope (rise/run)
  const RAMP_EXCESS = 4;                      // max metres of ramp steeper than the normal slope limit
  const TRENCH_EXIT = 0.6;                    // gap exit wall slope (≈31°, climbable from rest on rock)
  const LAVA_EXIT = 0.5;
  const NEAR_WALL = -2.2;                     // gap takeoff-side wall
  const LAVA_WALL = -1.4;
  const BOSS_FIRST = 3000;
  const BOSS_EVERY = 5000;
  const BOSS_PEAK_CAP = 0.8;
  const BOSS_SLOPE_TOL = 0.06;
  const BOSS_SLOPE_MAX = BOSS_PEAK_CAP + BOSS_SLOPE_TOL;
  const CONCAVE_RELAX = 0.12;                 // max concave turn per vertex (rad) on organic ground
  const CAVE_MIN_CLEAR = 9;

  // Per-sample flags (Uint16).
  const F_DESIGN = 1;   // designed ramp / lip / wall — exempt from the normal slope limit
  const F_TRENCH = 2;   // inside a gap trench or lava basin
  const F_BOSS = 4;     // boss climb (own slope limit)
  const F_LOCK = 8;     // surface locked (no alt-surface patches)
  const F_NODECO = 16;  // no decorations
  const F_PAD = 32;     // bounce/boost pad
  const F_LAVA = 64;    // lava pool surface
  const F_RAMP = 128;   // kicker ramp
  const F_ROCKS = 256;  // rock garden bumps (intentionally tight curvature, R ≥ ~1.2 m)
  const FLAGS = Object.freeze({
    DESIGN: F_DESIGN, TRENCH: F_TRENCH, BOSS: F_BOSS, LOCK: F_LOCK, NODECO: F_NODECO,
    PAD: F_PAD, LAVA: F_LAVA, RAMP: F_RAMP, ROCKS: F_ROCKS
  });

  // Surface index tables (Uint8 per sample).
  const SURFACE_TYPES = Object.freeze(Object.keys(RR.SURFACES));
  const SURFACE_LIST = Object.freeze(SURFACE_TYPES.map((k) => RR.SURFACES[k]));
  const SURF_IDX = Object.create(null);
  SURFACE_TYPES.forEach((k, i) => { SURF_IDX[k] = i; });
  const KEEP = 255; // "use the world default surface"
  const surfIndex = (key, fallback) => (key && key in SURF_IDX ? SURF_IDX[key] : fallback);

  const SECTION_IDS = ['canyon', 'storm', 'cave', 'volcano', 'moon'];
  const TYPES = ['rolling', 'hills', 'valley', 'climb', 'descent', 'jump', 'gap', 'rocks', 'plateau',
    'lava', 'bouncepad', 'boostpad'];
  const FRONT_OK = ['rock', 'bush', 'flowers', 'tumbleweed', 'snow_mound', 'crystal', 'alien_plant', 'bones',
    'lava_rock', 'ice_crystal', 'cairn'];
  const CAVE_OK = ['rock', 'boulder', 'crystal', 'lava_rock', 'ice_crystal', 'cairn'];

  // Terrain "styles": normal ground and per-section shaping.
  const STYLE_NORMAL = Object.freeze({
    amp: 1, len: 1, detail: 1, surf: null, slopeCap: 9, vMin: 0, runup: 1, kick: 1, dBoost: 0
  });
  const mkStyle = (o) => Object.freeze(Object.assign({}, STYLE_NORMAL, o));
  const SECTION_STYLE = Object.freeze({
    canyon: mkStyle({ detail: 0.8, surf: 'rock', vMin: 13.5, runup: 1.8, kick: 1.05, dBoost: 0.25 }),
    storm: mkStyle({ amp: 1.2, detail: 2.6 }),
    cave: mkStyle({ amp: 0.45, detail: 0.6, surf: 'rock', slopeCap: 0.42 }),
    volcano: mkStyle({ amp: 0.8, detail: 1.2, surf: 'ash', dBoost: 0.1 }),
    moon: mkStyle({ amp: 1.6, len: 1.4, detail: 0.7, surf: 'regolith', vMin: 13, runup: 1.4, kick: 1.2, dBoost: 0.2 })
  });

  const DEFAULT_WORLD = Object.freeze({
    id: 'default', surface: 'dirt', altSurface: null, altChance: 0, gravity: 1,
    terrain: { amplitude: 6, hillLength: 70, roughness: 0.2, steepness: 0.3, maxSlope: 0.8, difficultyDistance: 6000,
      features: { rolling: 3, hills: 3, valley: 2, climb: 1.5, descent: 1.5, jump: 2, gap: 1, rocks: 1, plateau: 2 } },
    decorations: ['rock'], sectionPool: ['canyon', 'storm'], bossName: 'THE MOUNTAIN GIANT'
  });

  // ------------------------------------------------------------------ pattern scratch + turtle
  // Patterns are written into these module-level scratch arrays (generation is synchronous), then
  // committed into the terrain's ring of typed arrays. Index 0 is the cursor (u = 0, y = 0).
  const SY = new Float64Array(MAX_PATTERN_N + 2);  // relative height
  const SF = new Uint16Array(MAX_PATTERN_N + 2);   // flags
  const SS = new Uint8Array(MAX_PATTERN_N + 2);    // surface index or KEEP
  const SD = new Float32Array(MAX_PATTERN_N + 2);  // detail target (0..~2)
  const tt = { n: 0, y: 0, s: 0, f: 0, surf: KEEP, det: 1, full: false };

  function tReset() {
    tt.n = 0; tt.y = 0; tt.s = 0; tt.f = 0; tt.surf = KEEP; tt.det = 1; tt.full = false;
    SY[0] = 0; SF[0] = 0; SS[0] = KEEP; SD[0] = 1;
  }
  function tStyle(f, surf, det) { tt.f = f; tt.surf = surf; tt.det = det; }
  function tPush(y) {
    if (tt.n >= MAX_PATTERN_N) { tt.full = true; return false; }
    const n = ++tt.n;
    SY[n] = y; SF[n] = tt.f; SS[n] = tt.surf; SD[n] = tt.det;
    return true;
  }
  // Slope changes linearly from the current slope to sT over `len` metres (trapezoid-integrated, exact).
  function tSlope(sT, len) {
    const k = Math.max(1, Math.round(len / DX));
    const s0 = tt.s;
    for (let q = 1; q <= k; q++) {
      const sn = s0 + (sT - s0) * q / k;
      tt.y += DX * (tt.s + sn) * 0.5;
      tt.s = sn;
      if (!tPush(tt.y)) return;
    }
  }
  function tHold(len) { if (len >= DX * 0.5) tSlope(tt.s, len); }
  // Continue at the current slope while the next sample would not pass yT.
  function tHoldToY(yT, maxLen) {
    const s = tt.s;
    if (s === 0) return;
    let k = Math.round(maxLen / DX);
    while (k-- > 0) {
      const yn = tt.y + s * DX;
      if (s > 0 ? yn > yT : yn < yT) break;
      tt.y = yn;
      if (!tPush(yn)) return;
    }
  }
  // Cosine step of height h over len (zero slope at both ends).
  function tCos(h, len) {
    const k = Math.max(1, Math.round(len / DX));
    const y0 = tt.y;
    for (let q = 1; q <= k; q++) {
      tt.y = y0 + h * 0.5 * (1 - Math.cos(PI * q / k));
      if (!tPush(tt.y)) return;
    }
    tt.s = 0;
  }
  // Cosine bump of height h over len, returning to the start height.
  function tBump(h, len) {
    const k = Math.max(1, Math.round(len / DX));
    const y0 = tt.y;
    for (let q = 1; q <= k; q++) {
      tt.y = y0 + h * 0.5 * (1 - Math.cos(2 * PI * q / k));
      if (!tPush(tt.y)) return;
    }
    tt.s = 0;
  }
  // Truncate an organic pattern so it fits the room left before the next section boundary.
  function tFit(room) {
    const maxN = Math.floor(room / DX + 1e-9);
    if (maxN < 1) return false;
    if (tt.n > maxN) {
      tt.n = maxN;
      tt.y = SY[maxN];
      tt.s = (SY[maxN] - SY[maxN - 1]) / DX;
    }
    return tt.n >= 1;
  }
  // Linear interpolation of the scratch profile at relative x (metres from the cursor).
  function scratchY(x) {
    const q = x / DX;
    const i = Math.floor(q);
    if (i < 0) return SY[0];
    if (i >= tt.n) return SY[tt.n];
    const t = q - i;
    return SY[i] + (SY[i + 1] - SY[i]) * t;
  }

  // Scratch for cave-ceiling max filter.
  const CEIL_R1 = Math.round(7 / DX);  // max-filter radius (samples)
  const CEIL_R2 = Math.round(4 / DX);  // smoothing radius (samples)
  const CM = new Float64Array(CHUNK_N + 2 * CEIL_R2 + 4);

  const snapX = (x) => Math.round(x / DX) * DX;

  function resolveWorld(w) {
    if (w && typeof w === 'object' && w.terrain) return w;
    if (typeof w === 'string' && RR.Worlds && RR.Worlds.byId) {
      const f = RR.Worlds.byId(w);
      if (f) return f;
    }
    if (RR.Worlds && RR.Worlds.list && RR.Worlds.list.length) return RR.Worlds.list[0];
    return DEFAULT_WORLD;
  }
  function sectionName(id) {
    const info = RR.Worlds && RR.Worlds.SECTION_INFO && RR.Worlds.SECTION_INFO[id];
    return info ? info.name : 'THE ' + String(id).toUpperCase();
  }
  function seedToInt(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(Math.abs(seed)) % 4294967296) >>> 0;
    if (seed === undefined || seed === null) return 12345;
    return U.hashString(String(seed));
  }

  // ================================================================== class
  class Terrain {
    constructor(opts) {
      opts = opts || {};
      const world = resolveWorld(opts.world);
      const T = world.terrain || DEFAULT_WORLD.terrain;
      const mods = opts.modifiers || null;
      this.world = world;
      this.modifiers = mods;
      this.seed = seedToInt(opts.seed);

      // --- world parameters
      const ampMul = clamp(safeNum(mods && mods.terrainAmpMul, 1), 0.5, 2);
      this._A = clamp(safeNum(T.amplitude, 6), 1, 40) * ampMul;
      // 'extreme hills' also spends more of the world's slope budget early (never beyond world maxSlope)
      this._slopeBoost = clamp((ampMul - 1) * 0.5, 0, 0.4);
      this._L = clamp(safeNum(T.hillLength, 70), 20, 200);
      this._R = clamp(safeNum(T.roughness, 0.2), 0, 1);
      this._steep = clamp(safeNum(T.steepness, 0.3), 0, 1);
      this._maxS = clamp(safeNum(T.maxSlope, 0.8), 0.4, 1.0);
      this._dd = Math.max(500, safeNum(T.difficultyDistance, 6000));
      const fw = T.features || {};
      this._fw = TYPES.map((k) => Math.max(0, safeNum(fw[k], 0)));
      this._lavaOK = Math.max(0, safeNum(fw.lava, 0)) > 0;
      const gMul = mods && isNum(mods.gravityMul) ? Math.max(1, mods.gravityMul) : 1;
      this._g = G0 * clamp(safeNum(world.gravity, 1), 0.1, 3) * gMul;

      // --- surfaces
      const defaultKey = RR.SURFACES[world.surface] ? world.surface : 'dirt';
      this._surfDefault = surfIndex(defaultKey, 0);
      const defFric = RR.SURFACES[defaultKey].friction;
      this._climbFric = clamp(0.55 + 0.45 * defFric, 0.8, 1);   // gentler sustained climbs on slippery worlds
      this._altIdx = world.altSurface && RR.SURFACES[world.altSurface] ? surfIndex(world.altSurface, -1) : -1;
      this._altChance = clamp(safeNum(world.altChance, 0.15), 0, 1);
      this._rockSurf = surfIndex('rock', this._surfDefault);
      this._trenchSurf = defaultKey === 'metal' ? surfIndex('metal', this._rockSurf) : this._rockSurf;
      this._bankSurf = this._rockSurf;
      this._lavaSurf = surfIndex('lava', this._rockSurf);
      this._neonSurf = surfIndex('neon', this._surfDefault);
      this._bossSurf = defFric >= 0.88 ? this._surfDefault : this._rockSurf;
      this._bossFricF = Math.min(1, SURFACE_LIST[this._bossSurf].friction / 0.95);

      // --- decorations
      const decos = Array.isArray(world.decorations) && world.decorations.length ? world.decorations.slice() : ['rock'];
      this._decos = decos;
      this._frontDecos = decos.filter((d) => FRONT_OK.indexOf(d) >= 0);
      this._caveDecos = decos.filter((d) => CAVE_OK.indexOf(d) >= 0);

      // --- sections
      const pool = (Array.isArray(world.sectionPool) ? world.sectionPool : []).filter((id) => SECTION_IDS.indexOf(id) >= 0);
      this._pool = pool.length ? pool : ['canyon', 'storm'];

      // --- RNG streams (independent so each subsystem stays deterministic on its own)
      const root = U.makeRng(U.hash2(this.seed, U.hashString(String(world.id || 'world'))));
      this._root = root;
      this._rp = root.fork('patterns');
      this._rs = root.fork('sections');
      this._rsu = root.fork('surface');
      this._rd = root.fork('decorations');
      this._nA = U.makeNoise1D(root.fork('detailA').seed);
      this._nB = U.makeNoise1D(root.fork('detailB').seed);
      this._nCave = U.makeNoise1D(root.fork('cave').seed);
      this._dAmp = 0.08 + 0.45 * this._R;
      this._dAmp2 = 0.2 + 0.03 * this._A;

      // --- storage (global index i lives at element i - _base)
      const cap = 4096;
      this._h = new Float64Array(cap);
      this._s = new Uint8Array(cap);
      this._f = new Uint16Array(cap);
      this._c = new Float32Array(cap).fill(NaN);
      const i0 = Math.round(START_X / DX);
      this._base = i0;
      this._minIdx = i0;
      this._wEnd = i0;   // exclusive end of written samples
      this._fEnd = i0;   // exclusive end of finalized (published) samples
      this.minX = i0 * DX;
      this.maxX = this.minX - DX;

      this.features = [];
      this.decorations = [];
      this.sections = [];
      this._pend = [];      // features written but not yet published
      this._pf = [];        // features of the pattern being built
      this._chunkLog = [];  // finalized chunks (for onChunk replay), trimmed with the data
      this._onChunk = null;
      this._caves = [];

      // --- generator state
      this._cy = 0; this._cs = 0; this._ds = 0;   // cursor base height/slope, current detail scale
      this._snap = { w: 0, cy: 0, cs: 0, ds: 0 };
      this._lastType = '';
      this._active = null;     // active section plan
      this._secState = { count: 0, spacer: false };
      this._forceNext = null;
      this._lastBossRise = 0;
      this._bossLim = BOSS_SLOPE_MAX;
      this._plans = [];
      this._majorPrev = null;
      this._lastSectionId = null;
      this._nextBossTier = 1;
      this._bossMemo = new Map();
      this._patchLeft = 0; this._patchAt = 0;
      this._decoX = START_X + 4;
      this._wScratch = new Float64Array(TYPES.length);
      this._heightFn = (x) => this.heightAt(x);
      this._errLogged = false;

      // --- the flat start area [-60, 40]
      this._ensureCap(i0 + 1);
      this._h[0] = 0; this._s[0] = this._surfDefault; this._f[0] = F_LOCK; this._c[0] = NaN;
      this._wEnd = i0 + 1;
      tReset();
      tStyle(F_LOCK, KEEP, 0);
      tHold(START_FLAT_END - START_X);
      this._commit();
      this._finishPattern();
    }

    // ================================================================ public API
    static get DX() { return DX; }
    get DX() { return DX; }

    get onChunk() { return this._onChunk; }
    set onChunk(fn) {
      const prev = this._onChunk;
      this._onChunk = typeof fn === 'function' ? fn : null;
      if (this._onChunk && this._onChunk !== prev) {
        for (const c of this._chunkLog) this._emitChunk(c.x0, c.x1, c.features);
      }
    }

    difficultyAt(x) {
      if (!isNum(x)) return 0;
      return clamp(x / this._dd, 0, 1);
    }

    // Normal-ground slope limit (rise/run) at x: grows with difficulty up to world.terrain.maxSlope.
    maxSlopeAt(x) {
      const ms = this._maxS;
      return lerp(Math.min(0.5, ms), ms, Math.min(1, this.difficultyAt(x) + this._slopeBoost));
    }

    ensure(xMax) {
      if (typeof xMax !== 'number' || xMax !== xMax) return;   // NaN / junk; +Infinity is capped below
      const target = Math.min(xMax, this.maxX + 4096);
      let guard = 0;
      while (this.maxX < target && guard++ < 128) {
        try {
          this._finalizeChunk();
        } catch (e) {
          this._emergencyChunk(e);
        }
      }
    }

    trim(xMin) {
      if (!isNum(xMin)) return;
      let idx = Math.floor(xMin / DX);
      if (idx > this._fEnd - 2) idx = this._fEnd - 2;
      if (idx > this._minIdx) {
        this._minIdx = idx;
        this.minX = idx * DX;
      }
      const cut = this.minX;
      // features: in-place compaction (list is small; no allocation)
      const fs = this.features;
      let w = 0;
      for (let r = 0; r < fs.length; r++) if (fs[r].x2 >= cut) fs[w++] = fs[r];
      fs.length = w;
      let k = 0;
      const ds = this.decorations;
      while (k < ds.length && ds[k].x < cut) k++;
      if (k > 0) ds.splice(0, k);
      k = 0;
      while (k < this.sections.length && this.sections[k].end < cut) k++;
      if (k > 0) this.sections.splice(0, k);
      k = 0;
      while (k < this._chunkLog.length && this._chunkLog[k].x1 < cut) k++;
      if (k > 0) this._chunkLog.splice(0, k);
      k = 0;
      while (k < this._caves.length && this._caves[k].end < cut) k++;
      if (k > 0) this._caves.splice(0, k);
    }

    heightAt(x) {
      if (!isNum(x)) return this._py(this._minIdx);
      const f = x / DX;
      const i = Math.floor(f);
      const t = f - i;
      if (i >= this._minIdx && i + 1 < this._wEnd) {
        const k = i - this._base;
        const h = this._h;
        return h[k] + (h[k + 1] - h[k]) * t;
      }
      return this._py(i) * (1 - t) + this._py(i + 1) * t;
    }

    slopeAt(x) {
      if (!isNum(x)) return 0;
      const i = Math.floor(x / DX);
      return (this._py(i + 1) - this._py(i)) / DX;
    }

    normalAt(x, out) {
      out = out || { x: 0, y: 1 };
      const s = this.slopeAt(x);
      const inv = 1 / Math.sqrt(1 + s * s);
      out.x = -s * inv;
      out.y = inv;
      return out;
    }

    surfaceAt(x) {
      let i = isNum(x) ? Math.round(x / DX) : this._minIdx;
      if (i < this._minIdx) i = this._minIdx;
      if (i >= this._wEnd) i = this._wEnd - 1;
      return SURFACE_LIST[this._s[i - this._base]] || SURFACE_LIST[this._surfDefault];
    }

    // Nearest point on the ground polyline within maxDist of p. See header for the out fields.
    closestPoint(px, py, maxDist, out) {
      out = out || {};
      if (!isNum(px) || !isNum(py)) { out.dist = Infinity; out.inside = false; return false; }
      const md = isNum(maxDist) && maxDist > 0 ? Math.min(maxDist, 64) : 1;
      const i0 = Math.floor((px - md) / DX);
      const i1 = Math.ceil((px + md) / DX);
      let best = md * md, bx = 0, by = 0, bi = 0, bt = 0, found = false;
      let ya = this._py(i0);
      for (let i = i0; i < i1; i++) {
        const yb = this._py(i + 1);
        const lo = ya < yb ? ya : yb, hi = ya < yb ? yb : ya;
        if (py - hi <= md && lo - py <= md) {
          const xa = i * DX;
          const ey = yb - ya;
          let t = ((px - xa) * DX + (py - ya) * ey) / (DX * DX + ey * ey);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = xa + DX * t, qy = ya + ey * t;
          const dx = px - qx, dy = py - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= best) { best = d2; bx = qx; by = qy; bi = i; bt = t; found = true; }
        }
        ya = yb;
      }
      const inside = py < this.heightAt(px);
      if (!found) { out.dist = Infinity; out.inside = inside; return false; }
      const dist = Math.sqrt(best);
      // Outward surface normal (average of both segments when the closest point is a vertex).
      let s = (this._py(bi + 1) - this._py(bi)) / DX;
      let snx = -s, sny = 1;
      let l = Math.sqrt(snx * snx + 1);
      snx /= l; sny /= l;
      if (bt <= 0 || bt >= 1) {
        const j = bt <= 0 ? bi - 1 : bi + 1;
        s = (this._py(j + 1) - this._py(j)) / DX;
        l = Math.sqrt(s * s + 1);
        snx += -s / l; sny += 1 / l;
        l = Math.sqrt(snx * snx + sny * sny);
        snx /= l; sny /= l;
      }
      let nx, ny;
      if (dist > 1e-9) { nx = (px - bx) / dist; ny = (py - by) / dist; } else { nx = snx; ny = sny; }
      out.x = bx; out.y = by; out.nx = nx; out.ny = ny; out.dist = dist; out.inside = inside;
      out.snx = snx; out.sny = sny; out.index = bi;
      return true;
    }

    ceilingAt(x) {
      if (!isNum(x)) return null;
      const f = x / DX;
      const i = Math.floor(f);
      if (i < this._minIdx || i + 1 > this._fEnd) return null;
      const k = i - this._base;
      const c0 = this._c[k], c1 = this._c[k + 1];
      if (c0 !== c0 || c1 !== c1) return null;
      return c0 + (c1 - c0) * (f - i);
    }

    sectionAt(x) {
      if (!isNum(x)) return null;
      const ss = this.sections;
      for (let k = 0; k < ss.length; k++) if (x >= ss[k].start && x < ss[k].end) return ss[k];
      return null;
    }

    // Next section (generated or merely planned) whose start is after x — for HUD teasers.
    upcomingSection(x) {
      if (!isNum(x)) return null;
      for (const s of this.sections) if (s.start > x) return s;
      if (this._active && this._active.info.start > x) return this._active.info;
      this._planAhead(x);
      for (const p of this._plans) if (p.info.start > x) return p.info;
      return null;
    }

    getIndexRange(x0, x1, out) {
      let i0 = Math.floor(safeNum(x0, this.minX) / DX);
      let i1 = Math.ceil(safeNum(x1, this.maxX) / DX);
      if (i0 < this._minIdx) i0 = this._minIdx;
      if (i1 > this._fEnd - 1) i1 = this._fEnd - 1;
      out = out || [0, 0];
      out[0] = i0; out[1] = i1;
      return out;
    }
    pointX(i) { return i * DX; }
    pointY(i) { return this._py(Math.floor(i)); }
    surfaceIdx(i) {
      i = Math.floor(i);
      if (i < this._minIdx || i >= this._wEnd) return this._surfDefault;
      return this._s[i - this._base];
    }
    surfaceInfoIdx(i) { return SURFACE_LIST[this.surfaceIdx(i)] || SURFACE_LIST[this._surfDefault]; }
    flagsIdx(i) {
      i = Math.floor(i);
      if (i < this._minIdx || i >= this._wEnd) return 0;
      return this._f[i - this._base];
    }

    // Ballistic check of a gap/lava feature against the stored heights.
    jumpCheck(f) {
      if (!f || !f.meta || !isNum(f.meta.takeoffX)) return { ok: false, vReq: Infinity, skipped: false };
      const m = f.meta;
      const i = Math.round(m.takeoffX / DX);
      const endX = (isNum(m.trenchX2) ? m.trenchX2 : m.takeoffX + safeNum(m.width, 0)) + 1.5;
      if (i - 1 < this._minIdx || Math.ceil(endX / DX) + 1 >= this._wEnd) return { ok: true, vReq: NaN, skipped: true };
      const tY = this._py(i);
      const theta = Math.atan((tY - this._py(i - 1)) / DX);
      const vReq = this._requiredSpeed(this._heightFn, i * DX, tY, theta, endX);
      return { ok: vReq <= V_LIMIT + 1e-6, vReq, skipped: false };
    }

    // Playability audit of the stored range (used by tests; cheap enough for debug overlays).
    validate(x0, x1) {
      const problems = [];
      const add = (m) => { if (problems.length < 60) problems.push(m); };
      const lo = Math.max(this._minIdx + 2, Math.floor(safeNum(x0, this.minX) / DX));
      const hi = Math.min(this._fEnd - 3, Math.ceil(safeNum(x1, this.maxX) / DX));
      const h = this._h, f = this._f, c = this._c, base = this._base;
      let rampRun = 0;
      let lavaStart = -1;
      const lavaRuns = [];
      for (let i = lo; i <= hi; i++) {
        const k = i - base;
        const y = h[k], x = i * DX;
        if (!isNum(y)) { add('non-finite height at x=' + x); continue; }
        const s = (y - h[k - 1]) / DX;
        const fl = f[k];
        const lim = this.maxSlopeAt(x);
        if (fl & F_DESIGN) {
          if (fl & F_TRENCH) {
            if (s > TRENCH_EXIT + 0.08) add('trench exit too steep (' + s.toFixed(2) + ') at x=' + x);
          } else if (s > RAMP_MAX + 0.08) add('designed climb too steep (' + s.toFixed(2) + ') at x=' + x);
          if ((fl & F_RAMP) && s > lim + 1e-9) {
            rampRun += DX;
            if (rampRun > RAMP_EXCESS + DX + 1e-9) add('ramp steeper than limit for > ' + RAMP_EXCESS + ' m at x=' + x);
          } else rampRun = 0;
        } else {
          rampRun = 0;
          const L = (fl & F_BOSS) ? BOSS_SLOPE_MAX : lim;
          if (Math.abs(s) > L + 0.02) add('slope ' + s.toFixed(3) + ' > ' + L.toFixed(3) + ' at x=' + x);
        }
        // Concave kinks: turning angle between the 1 m chords either side of the vertex.
        if (i - 2 >= lo - 2 && i + 2 < this._wEnd) {
          const a1 = Math.atan((y - h[k - 2]) / (2 * DX));
          const a2 = Math.atan((h[k + 2] - y) / (2 * DX));
          const turn = a2 - a1;
          if (turn > 0) {
            let special = false;
            for (let j = -2; j <= 2; j++) if (f[k + j] & (F_DESIGN | F_ROCKS)) special = true;
            if (turn > 1.0 / 0.45) add('concave kink tighter than a wheel at x=' + x);
            else if (!special && turn > 0.45) add('sharp concave kink (' + turn.toFixed(2) + ' rad) at x=' + x);
          }
        }
        if (fl & F_LAVA) { if (lavaStart < 0) lavaStart = x; } else if (lavaStart >= 0) { lavaRuns.push([lavaStart, x - DX]); lavaStart = -1; }
        const cy = c[k];
        if (cy === cy) {
          if (cy - y < CAVE_MIN_CLEAR - 1e-6) add('cave ceiling only ' + (cy - y).toFixed(2) + ' m above ground at x=' + x);
          if (!this._inCave(x)) add('ceiling outside a cave at x=' + x);
        }
      }
      if (lavaStart >= 0) lavaRuns.push([lavaStart, hi * DX]);
      const feats = this.features.concat(this._pend);
      for (const run of lavaRuns) {
        const ok = feats.some((ft) => ft.type === 'lava' && ft.meta.poolX <= run[0] + 1e-6 &&
          ft.meta.poolX2 >= run[1] - 1e-6 && ft.meta.takeoffX < run[0] && ft.meta.takeoffAngle > 0.3);
        if (!ok) add('lava at x=' + run[0] + '..' + run[1] + ' without a jump ramp');
      }
      for (const ft of feats) {
        if ((ft.type === 'gap' || ft.type === 'lava') && ft.meta.takeoffX >= lo * DX && ft.meta.trenchX2 <= hi * DX) {
          const r = this.jumpCheck(ft);
          if (!r.skipped && !r.ok) add(ft.type + ' at x=' + ft.x.toFixed(1) + ' needs ' + r.vReq.toFixed(2) + ' m/s');
        }
      }
      return { ok: problems.length === 0, problems };
    }

    // ================================================================ storage helpers
    _py(i) {
      if (i < this._minIdx) return this._h[this._minIdx - this._base] + (this._minIdx - i) * DX * WALL_SLOPE;
      if (i >= this._wEnd) return this._h[this._wEnd - 1 - this._base];
      return this._h[i - this._base];
    }
    _hAt(i) { return this._h[i - this._base]; }

    // Make room for global indices < endIdx: compact (drop trimmed samples) or grow.
    _ensureCap(endIdx) {
      if (endIdx - this._base <= this._h.length) return;
      const keep = this._minIdx;
      const used = this._wEnd - keep;
      const off = keep - this._base;
      let cap = this._h.length;
      while (cap < endIdx - keep + 256) cap *= 2;
      if (cap === this._h.length) {
        this._h.copyWithin(0, off, off + used);
        this._s.copyWithin(0, off, off + used);
        this._f.copyWithin(0, off, off + used);
        this._c.copyWithin(0, off, off + used);
      } else {
        const h = new Float64Array(cap), s = new Uint8Array(cap), f = new Uint16Array(cap);
        const c = new Float32Array(cap).fill(NaN);
        h.set(this._h.subarray(off, off + used));
        s.set(this._s.subarray(off, off + used));
        f.set(this._f.subarray(off, off + used));
        c.set(this._c.subarray(off, off + used));
        this._h = h; this._s = s; this._f = f; this._c = c;
      }
      this._base = keep;
    }

    _inCave(x) {
      for (const cv of this._caves) if (x >= cv.start && x <= cv.end) return true;
      return false;
    }

    _emitChunk(x0, x1, feats) {
      const fn = this._onChunk;
      if (!fn) return;
      try { fn(x0, x1, feats); } catch (e) { console.error('[RR.Terrain] onChunk handler error', e); }
    }

    // ================================================================ finalize (publish) chunks
    _finalizeChunk() {
      const s = this._fEnd, e = s + CHUNK_N;
      let guard = 0;
      while (this._wEnd < e + LOOKAHEAD_N) {
        this._generateNext();
        if (++guard > 400) throw new Error('terrain generator stalled');
      }
      this._applySurfacePatches(s, e);
      this._computeCeiling(s, e);
      this._placeDecorations(s, e);
      this._publish(s, e);
    }

    _publish(s, e) {
      this._fEnd = e;
      this.maxX = (e - 1) * DX;
      const x0 = s * DX, x1 = e * DX;
      const feats = [];
      while (this._pend.length && this._pend[0].x < x1) {
        const ft = this._pend.shift();
        this.features.push(ft);
        feats.push(ft);
      }
      this._chunkLog.push({ x0, x1, features: feats });
      this._emitChunk(x0, x1, feats);
    }

    // Last-resort: if generation ever throws, keep the game running on flat ground.
    _emergencyChunk(err) {
      if (!this._errLogged) {
        this._errLogged = true;
        console.error('[RR.Terrain] generation error — emitting a flat safety chunk', err);
      }
      const s = this._fEnd, e = s + CHUNK_N;
      const need = e + LOOKAHEAD_N;
      if (this._wEnd < need) {
        this._ensureCap(need);
        const y = this._h[this._wEnd - 1 - this._base];
        for (let i = this._wEnd; i < need; i++) {
          const k = i - this._base;
          this._h[k] = y; this._f[k] = F_LOCK; this._s[k] = this._surfDefault; this._c[k] = NaN;
        }
        this._wEnd = need;
        this._cy = y; this._cs = 0;
        this._active = null;
      }
      for (let i = s; i < e; i++) this._c[i - this._base] = NaN;
      this._publish(s, e);
    }

    _applySurfacePatches(s, e) {
      if (this._altIdx < 0 || this._altChance <= 0) return;
      const r = this._rsu;
      if (this._patchLeft <= 0 && r.chance(this._altChance)) {
        this._patchAt = s + r.int(0, CHUNK_N - 1);
        this._patchLeft = Math.round(r.range(15, 60) / DX);
      }
      if (this._patchLeft <= 0) return;
      const base = this._base;
      for (let i = Math.max(s, this._patchAt); i < e && this._patchLeft > 0; i++, this._patchLeft--) {
        const k = i - base;
        if (this._f[k] & F_LOCK) continue;
        // keep slippery patches off steep ground so they never make a climb impossible
        if (Math.abs(this._h[k] - this._h[k - 1]) > 0.45 * DX || Math.abs(this._h[k + 1] - this._h[k]) > 0.45 * DX) continue;
        this._s[k] = this._altIdx;
      }
    }

    // Cave ceiling = smoothed max-filter of the ground + 9..12 m clearance, higher at the mouths.
    _computeCeiling(s, e) {
      const base = this._base;
      let any = false;
      const x0 = s * DX, x1 = e * DX;
      for (const cv of this._caves) if (cv.start < x1 && cv.end > x0) any = true;
      // one sample past the chunk too, so ceilingAt() works on the last published segment (the value is
      // recomputed identically when the next chunk is finalized)
      e += 1;
      if (!any) { for (let i = s; i < e; i++) this._c[i - base] = NaN; return; }
      const a = s - CEIL_R2, b = e + CEIL_R2;
      for (let i = a; i < b; i++) {
        let m = -Infinity;
        for (let j = i - CEIL_R1; j <= i + CEIL_R1; j++) { const y = this._py(j); if (y > m) m = y; }
        CM[i - a] = m;
      }
      const norm = 1 / (2 * CEIL_R2 + 1);
      for (let i = s; i < e; i++) {
        const k = i - base;
        const x = i * DX;
        let cave = null;
        for (const cv of this._caves) if (x >= cv.start && x <= cv.end) { cave = cv; break; }
        if (!cave) { this._c[k] = NaN; continue; }
        let sum = 0;
        for (let j = i - CEIL_R2; j <= i + CEIL_R2; j++) sum += CM[j - a];
        const clear = 10.5 + 1.5 * this._nCave(x / 23);
        const mouth = 16 * ((1 - U.smoothstep(0, 30, x - cave.start)) + (1 - U.smoothstep(0, 30, cave.end - x)));
        let y = sum * norm + clear + mouth;
        const g = this._h[k];
        if (y < g + CAVE_MIN_CLEAR) y = g + CAVE_MIN_CLEAR;
        this._c[k] = y;
      }
    }

    _decoOk(i) {
      const base = this._base;
      for (let j = i - 3; j <= i + 3; j++) {
        if (j - 1 < this._minIdx || j >= this._wEnd) return false;
        if (this._f[j - base] & (F_DESIGN | F_TRENCH | F_PAD | F_NODECO | F_LAVA | F_ROCKS)) return false;
        if (Math.abs(this._h[j - base] - this._h[j - 1 - base]) > 0.45 * DX) return false;
      }
      return Math.abs(this._h[i + 3 - base] - this._h[i - 3 - base]) <= 0.3 * 6 * DX;
    }

    _placeDecorations(s, e) {
      const r = this._rd;
      const x1 = e * DX;
      if (this._decoX < s * DX) this._decoX = s * DX;
      while (this._decoX < x1) {
        const x = this._decoX;
        this._decoX += r.chance(0.22) ? r.range(1.8, 3.5) : r.range(5, 10.5);
        // fixed number of draws per candidate keeps the stream stable
        const roll = r.next(), pick = r.next(), sc = r.next(), variant = r.int(0, 3);
        let i = Math.round(x / DX);
        // on busy ground, nudge forward (up to 2 × 1.5 m) to find a flat spot
        if (!this._decoOk(i) && !this._decoOk(i += 3) && !this._decoOk(i += 3)) continue;
        if (i >= e) continue;                                            // stay inside this chunk's data
        if (this._decoX < i * DX + 1) this._decoX = i * DX + 1;           // keep the list sorted
        const inCave = this._c[i - this._base] === this._c[i - this._base];
        let list, layer, scale;
        if (inCave) {
          if (!this._caveDecos.length) continue;
          list = this._caveDecos; layer = 'back'; scale = 0.6 + 0.5 * sc;
        } else if (roll < 0.13 && this._frontDecos.length && x > 12) {
          list = this._frontDecos; layer = 'front'; scale = 0.45 + 0.3 * sc;
        } else {
          list = this._decos; layer = 'back'; scale = 0.75 + 0.55 * sc;
        }
        const type = list[Math.min(list.length - 1, Math.floor(pick * list.length))];
        const dx = i * DX;
        this.decorations.push({ x: dx, y: this.heightAt(dx), type, scale, layer, variant });
      }
    }

    // ================================================================ generator core
    _cursorX() { return (this._wEnd - 1) * DX; }

    _detail(x) {
      // two octaves of small bumps + one broad undulation (3 noise lookups per sample)
      const nA = this._nA, u = x / 9;
      return this._dAmp * (nA(u) + 0.5 * nA(u * 2 + 17.31)) * (1 / 1.5) + this._dAmp2 * this._nB(x / 31);
    }

    _snapshot() {
      const s = this._snap;
      s.w = this._wEnd; s.cy = this._cy; s.cs = this._cs; s.ds = this._ds;
    }
    _restore() {
      const s = this._snap;
      this._wEnd = s.w; this._cy = s.cy; this._cs = s.cs; this._ds = s.ds;
      this._pf.length = 0;
    }

    // Write the scratch pattern into the heightfield. Returns the cursor index c0 (pattern u = 0 sits at
    // global index c0; scratch sample j lands at c0 + j) or -1.
    _commit() {
      const n = tt.n;
      if (n < 1) return -1;
      const w0 = this._wEnd;
      const c0 = w0 - 1;
      this._ensureCap(w0 + n);
      const h = this._h, sA = this._s, fA = this._f, cA = this._c, base = this._base;
      const y0 = this._cy;
      // C1 blend: correct the cursor-slope mismatch with k·u·(1−u/Lb)², which has value 0 and slope k
      // at u = 0 and value/slope 0 at u = Lb.
      const k = this._cs - (SY[1] - SY[0]) / DX;
      const len = n * DX;
      const Lb = len >= 4 ? Math.min(10, 0.3 * len) : 0;
      let prev = h[c0 - base];
      let ds = this._ds;
      // slope limit = lerp(lo, maxS, clamp(x / dd)) inlined (hot loop)
      const ms = this._maxS, lo = Math.min(0.5, ms), invDD = 1 / this._dd;
      for (let j = 1; j <= n; j++) {
        const gi = c0 + j;
        const x = gi * DX;
        const u = j * DX;
        let y = y0 + SY[j];
        if (u < Lb) { const q = 1 - u / Lb; y += k * u * q * q; }
        const tgt = SD[j];
        ds = ds < tgt ? Math.min(tgt, ds + 0.1) : Math.max(tgt, ds - 0.1);
        if (ds > 0) y += ds * this._detail(x);
        const fl = SF[j];
        if (!(fl & F_DESIGN)) {
          // slope-limited follower: keeps organic ground within the difficulty's slope limit
          const dq = Math.min(1, (x <= 0 ? 0 : x >= this._dd ? 1 : x * invDD) + this._slopeBoost);
          let lim = lo + (ms - lo) * dq;
          if ((fl & F_BOSS) && this._bossLim > lim) lim = this._bossLim;
          lim *= DX;
          if (y > prev + lim) y = prev + lim;
          else if (y < prev - lim) y = prev - lim;
        }
        if (y !== y) y = prev;
        const kk = gi - base;
        h[kk] = y; fA[kk] = fl; sA[kk] = SS[j] === KEEP ? this._surfDefault : SS[j]; cA[kk] = NaN;
        prev = y;
      }
      this._wEnd = w0 + n;
      this._ds = ds;
      this._relaxConcave(w0, this._wEnd);
      this._cy = y0 + SY[n];
      this._cs = tt.s;
      return c0;
    }

    // Raise organic vertices in tight concave kinks. Raising a concave vertex moves both adjacent
    // slopes toward each other, so it can never push a segment past the slope limit.
    _relaxConcave(a, b) {
      const h = this._h, f = this._f, base = this._base;
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (let i = a; i < b - 1; i++) {
          const k = i - base;
          if (f[k] & (F_DESIGN | F_ROCKS | F_PAD)) continue;   // pads must stay perfectly flat
          const s1 = (h[k] - h[k - 1]) / DX, s2 = (h[k + 1] - h[k]) / DX;
          if (s2 - s1 > CONCAVE_RELAX && Math.atan(s2) - Math.atan(s1) > CONCAVE_RELAX) {
            h[k] += 0.6 * (0.5 * (h[k - 1] + h[k + 1]) - h[k]);
            changed = true;
          }
        }
        if (!changed) break;
      }
    }

    _feat(type, x, x2, y, meta) {
      this._pf.push({ type, x, x2: Math.max(x, x2), y, meta: meta || {} });
    }

    // Detect sustained steep stretches of the pattern just committed, then publish its features.
    _finishPattern() {
      const a = this._wEnd - tt.n, b = this._wEnd;
      const h = this._h, f = this._f, base = this._base;
      let runStart = -1, runDir = 0, runMax = 0;
      const flush = (end) => {
        if (runStart >= 0 && (end - runStart) * DX >= 6) {
          const y0 = h[runStart - base], y1 = h[end - base];
          this._feat('steep', runStart * DX, end * DX, y0, { maxSlope: runMax, dir: runDir, rise: y1 - y0 });
        }
        runStart = -1; runDir = 0; runMax = 0;
      };
      const thr = Math.max(0.45, 0.7 * this.maxSlopeAt(a * DX));   // limit barely changes within a pattern
      for (let i = Math.max(a, this._minIdx + 1); i < b; i++) {
        const k = i - base;
        const s = (h[k] - h[k - 1]) / DX;
        const dir = (f[k] & F_DESIGN) ? 0 : s > thr ? 1 : s < -thr ? -1 : 0;
        if (dir !== runDir) { flush(i - 1); if (dir !== 0) { runStart = i - 1; runDir = dir; } }
        if (dir !== 0 && Math.abs(s) > runMax) runMax = Math.abs(s);
      }
      flush(b - 1);
      const pf = this._pf;
      if (pf.length) {
        pf.sort((p, q) => p.x - q.x);
        // merge with a contiguous steep feature from the previous pattern (still pending)
        const last = this._pend.length ? this._pend[this._pend.length - 1] : null;
        for (const ft of pf) {
          if (last && ft.type === 'steep' && last.type === 'steep' && last.meta.dir === ft.meta.dir &&
            Math.abs(last.x2 - ft.x) <= DX + 1e-9 && ft === pf[0]) {
            last.x2 = ft.x2;
            last.meta.maxSlope = Math.max(last.meta.maxSlope, ft.meta.maxSlope);
            last.meta.rise += ft.meta.rise;
            continue;
          }
          this._pend.push(ft);
        }
        pf.length = 0;
      }
    }

    // ---------------------------------------------------------------- section schedule
    _tierAt(x) { return Math.max(1, Math.floor((x - BOSS_FIRST) / BOSS_EVERY) + 1); }

    _bossPlan(tier) {
      let p = this._bossMemo.get(tier);
      if (p) return p;
      const r = this._root.fork('boss' + tier);
      const start = snapX(BOSS_FIRST + BOSS_EVERY * (tier - 1));
      const peak = Math.min(BOSS_PEAK_CAP, 0.74 + 0.03 * tier) * this._bossFricF;
      const climbLen = clamp(250 + 45 * (tier - 1) + r.range(0, 70), 250, 450);
      const nL = r.int(3, 5);
      const ledges = [];
      let ledgeSum = 0;
      for (let k = 0; k < nL; k++) { const n = Math.round(r.range(9, 14) / DX); ledges.push(n); ledgeSum += n * DX; }
      const segCount = nL + 1;
      const climbTotal = climbLen - ledgeSum;
      const raw = [];
      let rawSum = 0;
      for (let k = 0; k < segCount; k++) { const v = r.range(0.8, 1.2); raw.push(v); rawSum += v; }
      const segs = [];
      let total = 0;
      for (let k = 0; k < segCount; k++) {
        const pr = (k + 1) / segCount;
        const s = lerp(0.4, peak, Math.pow(pr, 0.8));       // slope rises toward the peak near the top
        const segN = Math.round(climbTotal * raw[k] / rawSum / DX);
        const nT = Math.max(2, Math.ceil(s / 0.07));         // concave entry: ≤ 0.07 slope change / sample
        const nE = Math.max(4, Math.ceil(s / 0.1));          // convex round-over into the ledge
        const nH = Math.max(10, segN - nT - nE);
        segs.push({ s, nT, nH, nE });
        total += nT + nH + nE + (k < nL ? ledges[k] : 0);
      }
      const nP = Math.round(r.range(45, 60) / DX);
      total += nP;
      const end = start + total * DX;
      const plateauStart = end - nP * DX;
      const summitX = plateauStart + 10;
      const info = {
        id: 'boss', name: sectionName('boss'), bossName: this.world.bossName || 'THE MOUNTAIN GIANT',
        start, end, summitX, tier
      };
      p = { kind: 'boss', id: 'boss', tier, start, end, peak, segs, ledges, nP, summitX, info };
      this._bossMemo.set(tier, p);
      return p;
    }

    _planAhead(x) {
      let guard = 0;
      while ((!this._plans.length || this._plans[this._plans.length - 1].start < x + 6000) && guard++ < 16) this._planNextMajor();
    }

    // Majors: first at 1200–1800 m, then every 2000–3000 m, 350–600 m long, no immediate repeats.
    // Bosses (3000 m, then every 5000 m) have priority: a clashing major is pushed past the boss.
    _planNextMajor() {
      const r = this._rs;
      let s = this._majorPrev === null ? r.range(1200, 1800) : this._majorPrev + r.range(2000, 3000);
      const len = r.range(350, 600);
      const choices = this._pool.length > 1 ? this._pool.filter((id) => id !== this._lastSectionId) : this._pool;
      const id = choices[Math.min(choices.length - 1, Math.floor(r.next() * choices.length))];
      s = snapX(s);
      let e = snapX(s + len);
      for (let tier = Math.max(1, this._tierAt(s) - 1); tier < 100000; tier++) {
        const bp = this._bossPlan(tier);
        if (bp.start - 150 > e) break;
        if (s < bp.end + 150 && e > bp.start - 150) {
          // clash: finish before the boss if that keeps the 2 km rhythm, otherwise start after it
          const before = snapX(bp.start - 170 - len);
          const minStart = this._majorPrev === null ? 1200 : this._majorPrev + 2000;
          s = before >= minStart ? before : snapX(bp.end + 220);
          e = snapX(s + len);
        }
      }
      while (this._bossPlan(this._nextBossTier).start < s) {
        this._plans.push(this._bossPlan(this._nextBossTier));
        this._bossMemo.delete(this._nextBossTier - 3);
        this._nextBossTier++;
      }
      this._plans.push({ kind: 'major', id, start: s, end: e, info: { id, name: sectionName(id), start: s, end: e } });
      this._majorPrev = s;
      this._lastSectionId = id;
    }

    _enterSection(plan) {
      this._active = plan;
      this._secState.count = 0;
      this._secState.spacer = false;
      this.sections.push(plan.info);
      if (plan.id === 'cave') this._caves.push({ start: plan.start, end: plan.end });
    }

    _generateNext() {
      const cx = this._cursorX();
      if (this._active) { this._sectionStep(cx); return; }
      this._planAhead(cx);
      const next = this._plans[0];
      const room = next.start - cx;
      if (room <= DX * 0.5) { this._enterSection(this._plans.shift()); return; }
      this._normalStep(cx, room);
    }

    // ---------------------------------------------------------------- normal ground
    _normalStep(cx, room) {
      const d = this.difficultyAt(cx);
      const S = STYLE_NORMAL;
      const r = this._rp;
      if (this._forceNext === 'postboss') {
        this._forceNext = null;
        if (room >= 40 && this._postBoss(room, d)) { this._lastType = 'descent'; return; }
      }
      if (room < 30) { this._filler(room, d, S); return; }
      const W = this._wScratch;
      const bias = clamp((this._cy - 0.01 * cx) / 200, -1, 1);   // gentle homeostasis around a slow upward trend
      for (let t = 0; t < TYPES.length; t++) {
        const type = TYPES[t];
        let w = this._fw[t];
        switch (type) {
          case 'rolling': w *= lerp(1.5, 0.7, d); break;
          case 'climb': w *= lerp(0.8, 1.35, d) * (1 - 0.5 * bias); break;
          case 'descent': w *= lerp(0.9, 1.1, d) * (1 + 0.5 * bias); break;
          case 'jump': w *= lerp(1.0, 1.15, d); break;
          case 'gap': w *= lerp(0.3, 1.8, d); break;
          case 'rocks': w *= lerp(0.4, 1.7, d); break;
          case 'plateau': w *= lerp(1.3, 0.8, d); break;
          case 'lava': w *= lerp(0.5, 1.4, d); break;
          default: break;
        }
        if (cx < 100 && !(type === 'rolling' || type === 'hills' || type === 'plateau' || type === 'valley')) w = 0;
        if (cx < 160 && (type === 'rocks' || type === 'jump' || type === 'bouncepad' || type === 'boostpad')) w = 0;
        if (cx < 320 && (type === 'gap' || type === 'lava')) w = 0;
        if (type === this._lastType) w *= 0.3;
        if ((type === 'gap' || type === 'lava') && (this._lastType === 'gap' || this._lastType === 'lava')) w = 0;
        W[t] = w > 0 ? w : 0;
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        let total = 0;
        for (let t = 0; t < W.length; t++) total += W[t];
        if (total <= 0) break;
        let pick = r.next() * total, idx = 0;
        for (; idx < W.length - 1; idx++) { pick -= W[idx]; if (pick <= 0) break; }
        if (this._build(TYPES[idx], room, d, S)) { this._lastType = TYPES[idx]; return; }
        W[idx] = 0;
      }
      this._filler(Math.min(room, 50), d, S);
      this._lastType = 'filler';
    }

    _build(type, room, d, S) {
      switch (type) {
        case 'rolling': return this._rolling(room, d, S);
        case 'hills': return this._hills(room, d, S);
        case 'valley': return this._valley(room, d, S);
        case 'climb': return this._climb(room, d, S, 1);
        case 'descent': return this._climb(room, d, S, -1);
        case 'jump': return this._jump(room, d, S);
        case 'gap': return this._gap(room, d, S, false);
        case 'rocks': return this._rocks(room, d, S);
        case 'plateau': return this._plateau(room, d, S);
        case 'lava': return this._lavaOK ? this._gap(room, d, S, true) : false;
        case 'bouncepad': return this._pad(room, d, S, 'bouncepad');
        case 'boostpad': return this._pad(room, d, S, 'boostpad');
        default: return false;
      }
    }

    // ---------------------------------------------------------------- sections
    _sectionStep(cx) {
      const plan = this._active;
      const room = plan.end - cx;
      if (room < DX * 0.5) { this._active = null; return; }
      if (plan.kind === 'boss') {
        if (!this._boss(plan)) this._filler(room, 0, STYLE_NORMAL);
        this._active = null;
        return;
      }
      const S = SECTION_STYLE[plan.id] || STYLE_NORMAL;
      const d = this.difficultyAt(cx);
      if (room < 30) { this._filler(room, d, S); return; }
      const r = this._rp;
      const st = this._secState;
      let ok = false;
      switch (plan.id) {
        case 'canyon': {
          // 3–5 big gaps/jumps with long run-ups; budget keeps room for at least three
          if (st.count < 5 && room >= 60) {
            const budget = st.count < 3 ? room / (3 - st.count) : room;
            ok = r.chance(0.75) && this._gap(budget, d, S, false);
            if (!ok) ok = this._jump(budget, d, S);
            if (ok) st.count++;
          }
          if (!ok) ok = this._rolling(room, d * 0.5, S);
          break;
        }
        case 'volcano': {
          // lava pools (always behind a kicker) separated by short recovery stretches
          if (st.spacer) {
            st.spacer = false;
            ok = this._rolling(Math.min(room, r.range(18, 34)), d * 0.6, S);
          } else if (st.count < 5 && room >= 50) {
            const budget = st.count < 3 ? room / (3 - st.count) : room;
            ok = this._gap(budget, d, S, true);
            if (!ok) ok = this._jump(budget, d, S);
            if (ok) { st.count++; st.spacer = true; }
          }
          if (!ok) ok = this._rolling(room, d * 0.6, S);
          break;
        }
        case 'moon': {
          const p = r.next();
          if (p < 0.35) ok = this._hills(room, d, S);
          else if (p < 0.65) ok = this._jump(room, d, S);
          else if (p < 0.85) ok = this._gap(room, d, S, false);
          if (!ok) ok = this._rolling(room, d, S);
          break;
        }
        case 'storm': {
          const p = r.next();
          if (p < 0.35) ok = this._rolling(room, d, S);
          else if (p < 0.6) ok = this._hills(room, d, S);
          else if (p < 0.75) ok = this._climb(room, d, S, 1);
          else if (p < 0.85) ok = this._climb(room, d, S, -1);
          else ok = this._rocks(room, d, S);
          if (!ok) ok = this._rolling(room, d, S);
          break;
        }
        case 'cave': {
          const p = r.next();
          if (p < 0.45) ok = this._rolling(room, d, S);
          else if (p < 0.7) ok = this._hills(room, d, S);
          else if (p < 0.85) ok = this._valley(room, d, S);
          else ok = this._climb(room, d, S, p < 0.93 ? 1 : -1);
          if (!ok) ok = this._rolling(room, d, S);
          break;
        }
        default:
          ok = this._rolling(room, d, S);
      }
      if (!ok) this._filler(Math.min(room, 40), d, S);
    }

    // ---------------------------------------------------------------- pattern helpers
    _amp(d, S) { return this._A * lerp(0.9, 1.4, d) * S.amp; }
    _len(S) { return this._L * S.len; }
    _sDesign(cx, S) { return Math.min(this.maxSlopeAt(cx), S.slopeCap) * 0.85; }
    _surfOf(S) { return S.surf ? surfIndex(S.surf, KEEP) : KEEP; }
    _baseFlags(sIdx) { return sIdx !== KEEP ? F_LOCK : 0; }
    _commitOrganic(room) {
      if (!tFit(room)) return -1;
      const c0 = this._commit();
      if (c0 >= 0) this._finishPattern();
      return c0;
    }

    // Always succeeds; writes exactly round(room/DX) samples (used to land on section boundaries).
    _filler(room, d, S) {
      const cx = this._cursorX();
      const A = this._amp(d, S), sMax = this._sDesign(cx, S);
      const len = Math.max(DX, room);
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(this._baseFlags(sIdx), sIdx, S.detail);
      if (len >= 16) {
        const maxH = sMax * len / PI;
        tBump(clamp(this._rp.range(-0.15, 0.15) * A, -maxH, maxH), len);
      } else {
        tHold(len);
      }
      this._commit();
      this._finishPattern();
      return true;
    }

    _rolling(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const A = this._amp(d, S), L = this._len(S), sMax = this._sDesign(cx, S);
      if (room < 10) return false;
      const nb = r.int(2, 4);
      const ws = [], hs = [];
      let sign = r.sign(), total = 0;
      for (let b = 0; b < nb; b++) {
        let h = r.range(0.3, 0.65) * A * sign;
        sign = -sign;
        let w = Math.max(r.range(0.3, 0.65) * L, PI * Math.abs(h) / (0.7 * sMax));
        if (total + w > room) {
          if (b > 0) break;
          w = room;
          const hm = 0.7 * sMax * w / PI;
          h = clamp(h, -hm, hm);
        }
        ws.push(w); hs.push(h); total += w;
      }
      const maxH = 0.3 * sMax * 2 * total / PI;   // trend slope π|H|/(2·total) ≤ 0.3·sMax
      const bias = clamp((this._cy - 0.01 * cx) / 200, -1, 1);
      const H = clamp((r.range(-0.35, 0.35) - 0.15 * bias) * A, -maxH, maxH);
      const n = Math.round(total / DX);
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(this._baseFlags(sIdx), sIdx, S.detail);
      let bi = 0, bStart = 0, bN = Math.max(1, Math.round(ws[0] / DX));
      for (let q = 1; q <= n; q++) {
        while (bi < ws.length - 1 && q > bStart + bN) { bStart += bN; bi++; bN = Math.max(1, Math.round(ws[bi] / DX)); }
        const tb = Math.min(1, (q - bStart) / bN);
        const y = H * 0.5 * (1 - Math.cos(PI * q / n)) + hs[bi] * 0.5 * (1 - Math.cos(2 * PI * tb));
        tt.y = y;
        if (!tPush(y)) break;
      }
      tt.s = 0;
      return this._commitOrganic(room) >= 0;
    }

    _hills(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const A = this._amp(d, S), L = this._len(S), sMax = this._sDesign(cx, S) * this._climbFric;
      const minW = (hh) => PI * Math.abs(hh) / (2 * sMax);
      let h = r.range(0.8, 1.4) * A;
      let hd = h * r.range(0.6, 1.3);
      let top = r.range(0, 8);
      let wu = Math.max(r.range(0.35, 0.7) * L, minW(h));
      let wd = Math.max(r.range(0.35, 0.75) * L, minW(hd));
      const total = wu + top + wd;
      if (total > room) {
        const f = room / total;
        if (f < 0.35) return false;
        h *= f; hd *= f; wu *= f; wd *= f; top *= f;
      }
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(this._baseFlags(sIdx), sIdx, S.detail);
      tCos(h, wu); tHold(top); tCos(-hd, wd);
      return this._commitOrganic(room) >= 0;
    }

    _valley(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const A = this._amp(d, S), L = this._len(S), sMax = this._sDesign(cx, S) * this._climbFric;
      const minW = (hh) => PI * Math.abs(hh) / (2 * sMax);
      let dp = r.range(0.6, 1.2) * A;
      let up = dp * r.range(0.7, 1.3);
      let wdn = Math.max(r.range(0.3, 0.6) * L, minW(dp));
      let wup = Math.max(r.range(0.3, 0.6) * L, minW(up));
      let floor = r.range(6, 20);
      const total = wdn + floor + wup;
      if (total > room) {
        const f = room / total;
        if (f < 0.4) return false;
        dp *= f; up *= f; wdn *= f; wup *= f; floor *= f;
      }
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(this._baseFlags(sIdx), sIdx, S.detail);
      tCos(-dp, wdn);
      const j0 = tt.n;
      tHold(floor);
      const j1 = tt.n;
      tCos(up, wup);
      if (tt.n * DX > room + 1e-9) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      let bj = c0 + j0, by = this._hAt(bj);
      for (let j = c0 + j0; j <= c0 + j1; j++) if (this._hAt(j) < by) { by = this._hAt(j); bj = j; }
      this._feat('valley', (c0 + 1) * DX, (c0 + tt.n) * DX, by, { bottomX: bj * DX, bottomY: by, depth: dp });
      this._finishPattern();
      return true;
    }

    _climb(room, d, S, dir) {
      const r = this._rp, cx = this._cursorX();
      const A = this._amp(d, S), sMax = this._sDesign(cx, S) * this._climbFric;
      let H = r.range(0.8, 2.0) * A * (1 + 0.4 * d);
      const steps = r.int(1, 3);
      const hs = [], ws = [], fl = [];
      let total = 0;
      for (let k = 0; k < steps; k++) {
        const h = H / steps * r.range(0.8, 1.2);
        const sf = clamp(r.range(lerp(0.5, 0.8, d) + 0.15 * this._steep, 1.0), 0.3, 1);
        const w = PI * h / (2 * sMax * sf);
        const flat = k < steps - 1 ? r.range(5, 14) : 0;
        hs.push(h); ws.push(w); fl.push(flat);
        total += w + flat;
      }
      let f = 1;
      if (total > room) { f = room / total; if (f < 0.3) return false; }
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(this._baseFlags(sIdx), sIdx, S.detail);
      for (let k = 0; k < steps; k++) { tCos(dir * hs[k] * f, ws[k] * f); tHold(fl[k] * f); }
      return this._commitOrganic(room) >= 0;
    }

    _postBoss(room, d) {
      const r = this._rp, cx = this._cursorX();
      const sMax = Math.min(0.42, this._sDesign(cx, STYLE_NORMAL));
      const H = Math.max(4, this._lastBossRise * r.range(0.3, 0.5));
      const h1 = H * r.range(0.45, 0.6), h2 = H - h1;
      let w1 = PI * h1 / (2 * sMax), w2 = PI * h2 / (2 * sMax), flat = r.range(10, 20);
      let f = 1;
      const total = w1 + w2 + flat;
      if (total > room) { f = room / total; if (f < 0.2) return false; }
      tReset();
      tStyle(0, KEEP, 1);
      tCos(-h1 * f, w1 * f); tHold(flat * f); tCos(-h2 * f, w2 * f);
      return this._commitOrganic(room) >= 0;
    }

    _plateau(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const A = this._amp(d, S), L = this._len(S), sMax = this._sDesign(cx, S) * this._climbFric;
      const h = r.range(0.4, 0.9) * A;
      const wUp = Math.max(r.range(0.25, 0.5) * L, PI * h / (2 * sMax));
      let top = r.range(20, 50);
      let down = r.chance(0.5);
      const hd = h * r.range(0.5, 1.0);
      const wD = Math.max(r.range(0.25, 0.5) * L, PI * hd / (2 * sMax));
      if (wUp + top + (down ? wD : 0) > room) down = false;
      if (wUp + top > room) top = room - wUp;
      if (top < 12) return false;
      const sIdx = this._surfOf(S);
      const bf = this._baseFlags(sIdx);
      tReset();
      tStyle(bf, sIdx, S.detail);
      tCos(h, wUp);
      const j0 = tt.n;
      tStyle(bf, sIdx, 0.3 * S.detail);
      tHold(top);
      const j1 = tt.n;
      tStyle(bf, sIdx, S.detail);
      if (down) tCos(-hd, wD);
      if (tt.n * DX > room + 1e-9) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      this._feat('plateau', (c0 + j0) * DX, (c0 + j1) * DX, this._hAt(c0 + j0), { length: (j1 - j0) * DX });
      this._finishPattern();
      return true;
    }

    // Rock garden: cosine bumps with bounded curvature (radius ≥ ~1.2 m) and slope, on rock.
    _rocks(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const sMax = this._sDesign(cx, S);
      const len = Math.min(room, r.range(25, 60) * (0.8 + 0.6 * d));
      if (len < 15) return false;
      const hmax = lerp(0.18, 0.5, d) * (0.7 + this._R);
      const trend = clamp(r.range(-0.1, 0.12), -0.5 * sMax, 0.5 * sMax);
      const sCap = Math.max(0.2, Math.min(0.6, sMax) - Math.abs(trend));
      tReset();
      tStyle(F_ROCKS | F_LOCK | F_NODECO, this._rockSurf, 0);
      tSlope(trend, 2);
      let yb = tt.y, maxBump = 0;
      while ((tt.n + 12) * DX < len && !tt.full) {
        const w = r.range(2.5, 5);
        // curvature 2π²h/w² ≤ 1/1.2 m  and  slope πh/w ≤ sCap
        const hb = Math.min(hmax * r.range(0.5, 1), w * w / 23.7, sCap * w / PI);
        const gapLen = r.chance(0.3) ? r.range(0.5, 2) : 0;
        const k = Math.max(4, Math.round(w / DX));
        for (let q = 1; q <= k; q++) {
          yb += trend * DX;
          tt.y = yb + hb * 0.5 * (1 - Math.cos(2 * PI * q / k));
          tPush(tt.y);
        }
        const g = Math.round(gapLen / DX);
        for (let q = 0; q < g; q++) { yb += trend * DX; tt.y = yb; tPush(yb); }
        if (hb > maxBump) maxBump = hb;
      }
      tt.y = yb; tt.s = trend;
      tSlope(0, 3);
      if (tt.n * DX > room + 1e-9) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      this._feat('rocks', (c0 + 1) * DX, (c0 + tt.n) * DX, this._hAt(c0 + 1), { bumpHeight: maxBump, length: tt.n * DX });
      this._finishPattern();
      return true;
    }

    // Kicker ramp shared by jump / gap / lava: slope rises linearly to the lip slope `sl` (concave radius
    // kl/sl ≫ wheel), height ≈ hk, and never more than RAMP_EXCESS metres steeper than the normal limit.
    _kicker(sl, hk, m0, bf, sIdx) {
      let kl = 2 * hk / sl;
      if (sl > m0) kl = Math.min(kl, RAMP_EXCESS * 0.95 * sl / (sl - m0));
      kl = Math.max(3, kl);
      tStyle(bf | F_DESIGN | F_RAMP | F_LOCK | F_NODECO, sIdx, 0);
      tSlope(sl, kl);
    }

    // Metres needed for the detail layer to fade to zero (0.1 per sample) before exact geometry starts.
    _fadeLen() { return Math.ceil(this._ds / 0.1) * DX + 1; }

    _runup(ru, sr, bf, sIdx) {
      ru = Math.max(ru, this._fadeLen());
      // detail fades out so the ramp geometry is exact; surface locked so no ice/mud patch can steal the
      // speed the player needs for the launch
      tStyle(bf | F_LOCK, sIdx, 0);
      tSlope(-sr, 5); tHold(Math.max(0, ru - 10)); tSlope(0, 5);
    }

    // Common post-commit metadata for launch features, read from the actual committed heights.
    _launchMeta(c0, rampJ, lipJ) {
      const tX = (c0 + lipJ) * DX, tY = this._hAt(c0 + lipJ);
      const theta = Math.atan((tY - this._hAt(c0 + lipJ - 1)) / DX);
      const g = this._g, v = V_EST;
      const vx = v * Math.cos(theta), vy = v * Math.sin(theta);
      const landingX = this._simLanding(tX, tY, theta, v, 90);
      return {
        takeoffX: tX, takeoffY: tY, takeoffAngle: theta,
        landingX, landingY: this.heightAt(landingX),
        apexX: tX + vx * vy / g, apexY: tY + vy * vy / (2 * g),
        rampX: (c0 + rampJ) * DX, rampHeight: tY - this._hAt(c0 + rampJ)
      };
    }

    _simLanding(xT, yT, theta, v, range) {
      const g = this._g, vx = v * Math.cos(theta), vy = v * Math.sin(theta);
      for (let x = xT + 0.5; x <= xT + range; x += 0.25) {
        const t = (x - xT) / vx;
        if (yT + vy * t - 0.5 * g * t * t <= this.heightAt(x)) return x;
      }
      return xT + range;
    }

    // Minimum launch speed (m/s) from (xT, yT) at angle theta whose trajectory stays above the ground
    // getY for every x in (xT, xEnd]. Closed form per point: y(x) = yT + dx·tanθ − g·dx²/(2v²cos²θ) ≥ y_k
    // ⇔ v² ≥ g·dx² / (2cos²θ·(dx·tanθ − (y_k − yT))). The ground is linear between samples and the
    // trajectory is concave, so checking the sample points (plus xEnd) is exact.
    _requiredSpeed(getY, xT, yT, theta, xEnd) {
      const g = this._g, c = Math.cos(theta), tn = Math.tan(theta);
      if (!(c > 0) || !(xEnd > xT)) return Infinity;
      let v2 = 0;
      let x = (Math.floor(xT / DX + 1e-9) + 1) * DX;
      for (let guard = 0; guard < 4000; guard++) {
        if (x > xEnd) x = xEnd;
        const dx = x - xT;
        if (dx > 1e-9) {
          const room = dx * tn - (getY(x) - 0.02 - yT);
          if (room <= 0) return Infinity;
          const need = g * dx * dx / (2 * c * c * room);
          if (need > v2) v2 = need;
        }
        if (x >= xEnd) break;
        x += DX;
      }
      return Math.sqrt(v2);
    }

    // Jump: run-up → kicker → lip → steep backside → downslope landing. Always passable at any speed.
    _jump(room, d, S) {
      const r = this._rp, cx = this._cursorX();
      const m0 = this.maxSlopeAt(cx);
      const dE = clamp(d + S.dBoost, 0, 1);
      let ru = r.range(14, 26) * S.runup;
      const sr = r.range(0, 0.08);
      const sl = clamp(r.range(0.4, 0.58) * S.kick + 0.05 * dE, 0.35, RAMP_MAX);
      const hk = r.range(1.0, 2.0) * (1 + 0.3 * dE) * S.kick;
      const hb = hk + r.range(0, 1.2);
      const sb = -r.range(0.9, 1.1);
      const sLand = -r.range(0.2, 0.34);
      let landLen = r.range(12, 22);
      const sIdx = this._surfOf(S), bf = this._baseFlags(sIdx);
      let rampJ = 0, lipJ = 0, backJ = 0, landJ = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        tReset();
        this._runup(ru, sr, bf, sIdx);
        rampJ = tt.n;
        this._kicker(sl, hk, m0, bf, sIdx);
        lipJ = tt.n;
        const yLip = tt.y;
        tStyle(bf | F_DESIGN | F_LOCK | F_NODECO, sIdx, 0);
        tt.s = sb;
        const fillLen = 2;
        tHoldToY(yLip - hb - fillLen * (sb + sLand) * 0.5, 30);
        tSlope(sLand, fillLen);
        backJ = tt.n;
        tStyle(bf | F_NODECO, sIdx, 0);
        tHold(landLen);
        landJ = tt.n;
        tStyle(bf, sIdx, S.detail);
        tSlope(0, 8); tHold(4);
        const over = tt.n * DX - room;
        if (over <= 1e-9 && !tt.full) break;
        if (attempt === 2) return false;
        if (ru > 12) ru = Math.max(12, ru - over - DX);
        else landLen = Math.max(10, landLen - over - DX);
      }
      if (tt.n * DX > room + 1e-9 || tt.full) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      const meta = this._launchMeta(c0, rampJ, lipJ);
      meta.width = (c0 + backJ) * DX - meta.takeoffX;
      meta.landingZoneX2 = (c0 + landJ) * DX;
      this._feat('jump', meta.rampX, meta.landingZoneX2, meta.takeoffY, meta);
      this._finishPattern();
      return true;
    }

    // Gap (trench) or lava pool behind a kicker. Geometry is relaxed until the ballistic check passes.
    _buildGap(p, S, m0, lava) {
      tReset();
      const sIdx = this._surfOf(S), bf = this._baseFlags(sIdx);
      this._runup(p.ru, p.sr, bf, sIdx);
      const rampJ = tt.n;
      this._kicker(p.sl, p.hk, m0, bf, sIdx);
      const lipJ = tt.n, yLip = tt.y;
      const yRim = yLip - p.drop, yFloor = yRim - p.D;
      const wallF = F_DESIGN | F_TRENCH | F_LOCK | F_NODECO;
      const wallSurf = lava ? (sIdx !== KEEP ? sIdx : this._bankSurf) : this._trenchSurf;
      tStyle(wallF, wallSurf, 0);
      const sw = lava ? LAVA_WALL : NEAR_WALL;
      tt.s = sw;
      tHoldToY(yFloor + 1.5 * -sw * 0.5, 60);
      // fillet sw→0 over kF samples drops kF·DX·|sw|/2 — pick kF to land on the floor height
      const kF = Math.max(2, Math.round(2 * (tt.y - yFloor) / (DX * -sw)));
      tSlope(0, kF * DX);
      const floorJ0 = tt.n;
      if (lava) tStyle(wallF | F_LAVA, this._lavaSurf, 0);
      tHold(p.fw);
      const floorJ1 = tt.n;
      tStyle(wallF, wallSurf, 0);
      const se = lava ? LAVA_EXIT : TRENCH_EXIT;
      tSlope(se, 2);
      tHoldToY(yRim - (se + p.sLand), 60);       // top fillet se→sLand over 2 m rises (se + sLand)
      tSlope(p.sLand, 2);
      let crestJ = floorJ1;
      for (let j = floorJ1; j <= tt.n; j++) if (SY[j] >= SY[crestJ]) crestJ = j;
      tStyle(bf | F_NODECO, sIdx, 0);
      tHold(p.landLen);
      const landJ = tt.n;
      tStyle(bf, sIdx, S.detail);
      tSlope(0, 8); tHold(4);
      if (tt.full) return null;
      const theta = Math.atan((SY[lipJ] - SY[lipJ - 1]) / DX);
      const vReq = this._requiredSpeed(scratchY, lipJ * DX, SY[lipJ], theta, crestJ * DX + 1.5);
      return { rampJ, lipJ, floorJ0, floorJ1, crestJ, landJ, vReq, n: tt.n };
    }

    _gap(room, d, S, lava) {
      const r = this._rp, cx = this._cursorX();
      const m0 = this.maxSlopeAt(cx);
      const dE = clamp(d + S.dBoost, 0, 1);
      const vMax = Math.min(V_LIMIT - 0.1, Math.max(S.vMin, lerp(12, 15.9, dE)));
      const p = {
        ru: r.range(18, 30) * S.runup,
        sr: r.range(0.03, 0.09) * (S.runup > 1 ? 1.4 : 1),
        sl: clamp(r.range(0.42, 0.58) * S.kick, 0.35, 0.62),
        hk: r.range(1.0, 1.8),
        drop: r.range(0.5, 1.8),
        // trench depth below the landing rim; the grid snaps the floor by ±0.3 m and the rim by −0.3 m, so the
        // design range 3.6–5.7 m yields an actual 3–6 m trench
        D: lava ? r.range(1.1, 2.0) : clamp(lerp(3.6, 5.6, d) * r.range(0.9, 1.1), 3.6, 5.7),
        fw: lava ? clamp(lerp(3.5, 8, dE) * r.range(0.8, 1.15), 3, 10) : clamp(lerp(3, 7.5, dE) * r.range(0.8, 1.2), 3, 9),
        sLand: -r.range(0.18, 0.32),
        landLen: r.range(14, 24) + 10 * dE
      };
      let geo = null;
      for (let it = 0; it < 16; it++) {
        geo = this._buildGap(p, S, m0, lava);
        if (!geo) return false;
        const over = geo.n * DX - room;
        if (over > 1e-9) {
          if (p.ru > 16) { p.ru = Math.max(16, p.ru - over - DX); continue; }
          if (p.landLen > 10) { p.landLen = Math.max(10, p.landLen - over - DX); continue; }
          if (p.fw > 3) { p.fw = Math.max(3, p.fw - over - DX); continue; }
          return false;
        }
        if (geo.vReq <= vMax) break;
        if (p.fw > 3.01) p.fw = Math.max(3, p.fw * 0.75);
        else if (!lava && p.D > 3.61) p.D = Math.max(3.6, p.D - 0.7);
        else if (p.drop < 2.49) p.drop = Math.min(2.5, p.drop + 0.5);
        else if (p.sl < 0.6) p.sl = Math.min(0.6, p.sl + 0.06);
        else return false;
      }
      if (!geo || geo.vReq > vMax || geo.n * DX > room + 1e-9) return false;
      this._snapshot();
      const c0 = this._commit();
      if (c0 < 0) return false;
      const meta = this._launchMeta(c0, geo.rampJ, geo.lipJ);
      const crestX = (c0 + geo.crestJ) * DX;
      const vReq = this._requiredSpeed(this._heightFn, meta.takeoffX, meta.takeoffY, meta.takeoffAngle, crestX + 1.5);
      if (!(vReq <= V_LIMIT)) { this._restore(); return false; }
      const floorY = this._hAt(c0 + geo.floorJ0);
      meta.width = crestX - meta.takeoffX;
      meta.depth = this._hAt(c0 + geo.crestJ) - floorY;
      meta.floorY = floorY;
      meta.trenchX = meta.takeoffX;
      meta.trenchX2 = crestX;
      meta.vReq = vReq;
      meta.landingZoneX2 = (c0 + geo.landJ) * DX;
      if (lava) {
        meta.poolX = (c0 + geo.floorJ0 + 1) * DX;
        meta.poolX2 = (c0 + geo.floorJ1) * DX;
        meta.poolY = floorY;
      }
      this._feat(lava ? 'lava' : 'gap', meta.rampX, meta.landingZoneX2, meta.takeoffY, meta);
      this._finishPattern();
      return true;
    }

    // Neon City pads on a flat stretch; the EventSystem applies the bounce/boost.
    _pad(room, d, S, type) {
      const r = this._rp;
      const padLen = type === 'bouncepad' ? 4 : 6;
      const pre = Math.max(r.range(10, 14), this._fadeLen());
      const post = type === 'bouncepad' ? r.range(24, 32) : r.range(16, 22);
      if (pre + padLen + post > room) return false;
      const sIdx = this._surfOf(S);
      tReset();
      tStyle(F_LOCK, sIdx, 0);
      tHold(pre);
      const j0 = tt.n;
      tStyle(F_LOCK | F_PAD | F_NODECO, this._neonSurf, 0);
      tHold(padLen);
      const j1 = tt.n;
      tStyle(F_LOCK, sIdx, 0);
      tHold(post * 0.6);
      tStyle(F_LOCK, sIdx, S.detail);
      tHold(post * 0.4);
      if (tt.n * DX > room + 1e-9) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      this._feat(type, (c0 + j0) * DX, (c0 + j1) * DX, this._hAt(c0 + j0),
        { power: lerp(1, 1.35, d), length: (j1 - j0) * DX });
      this._finishPattern();
      return true;
    }

    // Boss climb: slope rises toward the peak, flat rest ledges between pitches, flat summit plateau.
    _boss(plan) {
      const bs = this._bossSurf;
      this._bossLim = plan.peak + BOSS_SLOPE_TOL;
      tReset();
      const ledgeJ = [];
      for (let k = 0; k < plan.segs.length; k++) {
        const sg = plan.segs[k];
        tStyle(F_BOSS | F_LOCK, bs, 0.25);
        tSlope(sg.s, sg.nT * DX);
        tHold(sg.nH * DX);
        tStyle(F_BOSS | F_LOCK, bs, 0);   // detail fades out over the round-over so ledges are truly flat
        tSlope(0, sg.nE * DX);
        if (k < plan.ledges.length) {
          tStyle(F_BOSS | F_LOCK, bs, 0);
          const a = tt.n;
          tHold(plan.ledges[k] * DX);
          ledgeJ.push([a, tt.n]);
        }
      }
      tStyle(F_BOSS | F_LOCK, bs, 0);
      const pj = tt.n;
      tHold(plan.nP * DX);
      if (tt.full) return false;
      const c0 = this._commit();
      if (c0 < 0) return false;
      const tier = plan.tier, bossName = plan.info.bossName;
      for (const [a, b] of ledgeJ) {
        this._feat('plateau', (c0 + a) * DX, (c0 + b) * DX, this._hAt(c0 + a), { length: (b - a) * DX, ledge: true, tier });
      }
      const px = (c0 + pj) * DX, py = this._hAt(c0 + pj), pEnd = (c0 + tt.n) * DX;
      this._feat('plateau', px, pEnd, py, { length: pEnd - px, summit: true, tier });
      this._feat('summit', plan.summitX, pEnd, this.heightAt(plan.summitX), { tier, bossName });
      this._feat('checkpoint', plan.summitX, plan.summitX, this.heightAt(plan.summitX), { tier, bossName });
      this._lastBossRise = this._hAt(c0 + tt.n) - this._hAt(c0);
      this._forceNext = 'postboss';
      this._lastType = 'boss';
      this._finishPattern();
      return true;
    }
  }

  Terrain.FLAGS = FLAGS;
  Terrain.SURFACE_TYPES = SURFACE_TYPES;
  Terrain.SURFACE_LIST = SURFACE_LIST;
  Terrain.V_LIMIT = V_LIMIT;

  RR.Terrain = Terrain;
})();
