/* RIDGE RUSH — RR.Terrain tests.
 * Drives every world × 5 seeds × 20 km with a moving ensure/trim window (like a real run) and audits
 * playability, determinism, sections, bosses, collision queries, performance and memory.
 *   node tests/terrain.test.js            (TERRAIN_DIST=5000 for a quicker pass)
 */
'use strict';
const H = require('./harness');
const RR = H.load(['js/core/utils.js', 'js/data/worlds.js', 'js/game/terrain.js']);
const T = RR.Terrain;
const DX = T.DX;
const F = T.FLAGS;
const WORLDS = RR.Worlds.list;
const SEEDS = [1, 42, 1337, 987654321, 20260924];
const DIST = Math.max(3500, +process.env.TERRAIN_DIST || 20000);
const I0 = Math.round(-60 / DX);
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 2 : d) : String(v));

// Tiny deterministic LCG for test-side randomness (independent of the game RNG).
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Brute-force closest point over every stored segment (plus the virtual wall/extension).
function bruteClosest(t, px, py, maxDist) {
  let best = Infinity, bx = 0, by = 0;
  for (let i = t._minIdx - 40; i < t._wEnd + 40; i++) {
    const xa = i * DX, ya = t.pointY(i), yb = t.pointY(i + 1);
    const ex = DX, ey = yb - ya;
    let u = ((px - xa) * ex + (py - ya) * ey) / (ex * ex + ey * ey);
    u = Math.max(0, Math.min(1, u));
    const qx = xa + ex * u, qy = ya + ey * u;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) { best = d; bx = qx; by = qy; }
  }
  return { found: best <= maxDist, dist: best, x: bx, y: by };
}

/**
 * Drive a terrain like Run does: ensure ahead, trim behind, small steps. Records every published sample
 * so the whole course can be analysed after the window has moved on.
 */
function drive(worldId, seed, opts) {
  opts = opts || {};
  const dist = opts.dist || DIST;
  const world = RR.Worlds.byId(worldId);
  const t = new T({ seed, world, modifiers: opts.modifiers || null });
  const N = Math.ceil((dist + 600) / DX) - I0;
  const rec = {
    worldId, seed, t, dist,
    hs: new Float64Array(N).fill(NaN), fl: new Uint16Array(N), sf: new Uint8Array(N),
    features: [], sections: new Map(), problems: [], chunkMs: [], chunks: 0,
    cp: { n: 0, fail: [] }, ceil: { n: 0, fail: [] }, jumps: { n: 0, maxV: 0, fail: [] },
    decos: [], orderFail: 0, mem: { cap: 0, span: 0, features: 0, decos: 0, sections: 0, log: 0, pend: 0 }
  };
  let lastFeatX = -Infinity;
  let cbMs = 0;   // time spent in this test callback (excluded from generation timing)
  t.onChunk = (x0, x1, feats) => {
    const cb0 = nowMs();
    rec.chunks++;
    const a = Math.round(x0 / DX), b = Math.round(x1 / DX);
    for (let i = a; i < b; i++) {
      const k = i - I0;
      if (k < 0 || k >= N) continue;
      rec.hs[k] = t.pointY(i); rec.fl[k] = t.flagsIdx(i); rec.sf[k] = t.surfaceIdx(i);
      // ceiling only inside caves, ≥ 9 m above the ground
      const x = i * DX + DX * 0.5;
      const c = t.ceilingAt(x);
      const cave = t.sectionAt(x);
      const inCave = cave && cave.id === 'cave' && x >= cave.start + DX && x <= cave.end - DX;
      rec.ceil.n++;
      if (c !== null && !(cave && cave.id === 'cave')) rec.ceil.fail.push('ceiling outside cave at ' + x);
      if (inCave && c === null) rec.ceil.fail.push('no ceiling inside cave at ' + x);
      if (c !== null && c - t.heightAt(x) < 9 - 1e-6) rec.ceil.fail.push('ceiling clearance ' + fmt(c - t.heightAt(x)) + ' at ' + x);
    }
    for (const f of feats) {
      if (f.x < lastFeatX - 1e-9 || f.x < x0 - 1e-9 || f.x >= x1) rec.orderFail++;
      lastFeatX = f.x;
      rec.features.push(f);
      if (f.type === 'gap' || f.type === 'lava') {
        const r = t.jumpCheck(f);
        rec.jumps.n++;
        if (r.skipped) rec.jumps.fail.push(f.type + ' check skipped (data missing) at ' + fmt(f.x));
        else {
          rec.jumps.maxV = Math.max(rec.jumps.maxV, r.vReq);
          if (!r.ok) rec.jumps.fail.push(f.type + ' at ' + fmt(f.x) + ' needs ' + fmt(r.vReq) + ' m/s');
        }
      }
    }
    cbMs += nowMs() - cb0;
  };
  const rnd = lcg(seed ^ 0x5bd1e995);
  let x = 0, validated = t.minX + 2 * DX, nextCp = 50, decoSeen = 0;
  const step = opts.step || 3;
  while (x < dist) {
    x += step * (opts.jitter === false ? 1 : 0.5 + rnd());
    const before = rec.chunks;
    cbMs = 0;
    const t0 = nowMs();
    t.ensure(x + 160);
    const dt = nowMs() - t0 - cbMs;
    if (rec.chunks > before) rec.chunkMs.push(dt / (rec.chunks - before));
    if (t.maxX > validated + 8) {
      const v = t.validate(validated - 2, t.maxX);
      if (!v.ok) for (const p of v.problems) if (rec.problems.length < 40) rec.problems.push(p);
      validated = t.maxX;
    }
    for (const s of t.sections) if (!rec.sections.has(s.start)) rec.sections.set(s.start, Object.assign({}, s));
    // new decorations since the last step
    const ds = t.decorations;
    for (let k = 0; k < ds.length; k++) if (ds[k].x > decoSeen) { rec.decos.push(ds[k]); }
    if (ds.length) decoSeen = Math.max(decoSeen, ds[ds.length - 1].x);
    // closestPoint vs brute force (points above, on and inside the ground, near the back wall too)
    if (opts.cp !== false && x > nextCp) {
      nextCp += 100;
      for (let q = 0; q < (opts.cpPerStep || 8); q++) {
        const px = t.minX - 3 + rnd() * (Math.min(t.maxX, x + 150) - t.minX + 3);
        const gy = t.heightAt(px);
        const py = gy + (rnd() * 10 - 6);
        const md = 0.3 + rnd() * 3;
        const out = {};
        const found = t.closestPoint(px, py, md, out);
        const bf = bruteClosest(t, px, py, md);
        rec.cp.n++;
        const bad = [];
        if (found !== bf.found) bad.push('found ' + found + ' vs brute ' + bf.found + ' (brute dist ' + fmt(bf.dist, 6) + ', max ' + fmt(md, 3) + ')');
        if (found && bf.found) {
          if (Math.abs(out.dist - bf.dist) > 1e-9) bad.push('dist ' + out.dist + ' vs ' + bf.dist);
          if (Math.abs(out.y - t.heightAt(out.x)) > 1e-6 && out.x >= t.minX) bad.push('point not on surface');
          if (Math.abs(Math.hypot(out.nx, out.ny) - 1) > 1e-9) bad.push('normal not unit');
          if (out.dist > 1e-6 && Math.abs((px - out.x) * out.nx + (py - out.y) * out.ny - out.dist) > 1e-6) bad.push('normal not toward p');
          if (!(out.sny > 0) || Math.abs(Math.hypot(out.snx, out.sny) - 1) > 1e-9) bad.push('bad surface normal');
          if (out.inside !== (py < t.heightAt(px))) bad.push('inside flag wrong');
        }
        if (bad.length && rec.cp.fail.length < 10) rec.cp.fail.push('(' + fmt(px, 3) + ',' + fmt(py, 3) + ') ' + bad.join('; '));
      }
    }
    t.trim(x - 250);
    const m = rec.mem;
    m.cap = Math.max(m.cap, t._h.length);
    m.span = Math.max(m.span, t._wEnd - t._minIdx);
    m.features = Math.max(m.features, t.features.length);
    m.decos = Math.max(m.decos, t.decorations.length);
    m.sections = Math.max(m.sections, t.sections.length);
    m.log = Math.max(m.log, t._chunkLog.length);
    m.pend = Math.max(m.pend, t._pend.length);
  }
  return rec;
}

// ------------------------------------------------------------------ course analysis helpers
const idx = (x) => Math.round(x / DX) - I0;
function slopeK(rec, k) { return (rec.hs[k] - rec.hs[k - 1]) / DX; }

function analyse(rec) {
  const t = rec.t;
  const out = { maxOrganic: 0, maxDesignUp: 0, maxBoss: 0, maxTrenchUp: 0, maxWall: 0, nanCount: 0, recorded: 0 };
  for (let k = 1; k < rec.hs.length; k++) {
    if (!Number.isFinite(rec.hs[k]) || !Number.isFinite(rec.hs[k - 1])) continue;
    out.recorded++;
    const s = slopeK(rec, k), fl = rec.fl[k];
    if (fl & F.DESIGN) {
      if (fl & F.TRENCH) { if (s > out.maxTrenchUp) out.maxTrenchUp = s; } else if (s > out.maxDesignUp) out.maxDesignUp = s;
    } else if (fl & F.BOSS) out.maxBoss = Math.max(out.maxBoss, Math.abs(s));
    else if (fl & F.WALL) out.maxWall = Math.max(out.maxWall, Math.abs(s));
    else out.maxOrganic = Math.max(out.maxOrganic, Math.abs(s) / t.maxSlopeAt((k + I0) * DX));
  }
  return out;
}

const runs = [];
const summary = {};
function countFeatures(rec, into) {
  for (const f of rec.features) into[f.type] = (into[f.type] || 0) + 1;
}

console.log('RR.Terrain — ' + WORLDS.length + ' worlds × ' + SEEDS.length + ' seeds × ' + DIST + ' m');

// ================================================================== unit-level API tests
H.test('API surface & statics', () => {
  H.assert(typeof T === 'function', 'RR.Terrain is a class');
  H.assert(T.DX === RR.CONST.TERRAIN_DX, 'Terrain.DX');
  const t = new T({ seed: 1, world: 'green_valley', modifiers: null });
  for (const m of ['ensure', 'trim', 'heightAt', 'slopeAt', 'normalAt', 'surfaceAt', 'closestPoint', 'ceilingAt',
    'sectionAt', 'getIndexRange', 'pointX', 'pointY', 'surfaceIdx', 'difficultyAt', 'validate']) {
    H.assert(typeof t[m] === 'function', 'method ' + m);
  }
  H.assert(Array.isArray(t.features) && Array.isArray(t.decorations) && Array.isArray(t.sections), 'lists');
  H.assert(t.minX === -60, 'minX starts at -60 (got ' + t.minX + ')');
  H.assert(t.onChunk === null, 'onChunk defaults to null');
});

H.test('start zone flat, back wall steep & continuous', () => {
  const t = new T({ seed: 99, world: RR.Worlds.byId('storm_planet') });
  for (let x = -60; x <= 40; x += 0.25) H.assertClose(t.heightAt(x), 0, 1e-9, 'flat start at ' + x);
  t.ensure(400);
  for (let x = -60; x <= 40; x += 0.25) H.assertClose(t.heightAt(x), 0, 1e-9, 'flat start after ensure at ' + x);
  const h0 = t.heightAt(t.minX);
  H.assertClose(t.heightAt(t.minX - 1e-7), h0, 1e-5, 'continuous at minX');
  H.assertClose(t.heightAt(t.minX - 2), h0 + 6, 1e-9, 'wall rises 3 m per metre');
  H.assert(t.slopeAt(t.minX - 1) <= -2.9, 'wall slope steep (facing +x)');
  t.ensure(1000); t.trim(700);
  H.assert(t.minX >= 699 && t.minX <= 700, 'trim moves minX');
  H.assertClose(t.heightAt(t.minX - 1), t.heightAt(t.minX) + 3, 1e-9, 'wall follows the trim');
});

H.test('robust against bad input (no throw, no NaN)', () => {
  const t = new T({ seed: 'text seed', world: 'nope' });
  t.ensure(NaN); t.ensure(Infinity); t.trim(NaN); t.trim(-Infinity);
  H.assert(t.maxX > 0 && t.maxX < 5000, 'ensure(Infinity) is capped (maxX ' + t.maxX + ')');
  for (const v of [NaN, Infinity, -Infinity, undefined, 1e12, -1e12]) {
    H.assertFinite(t.heightAt(v), 'heightAt ' + v);
    H.assertFinite(t.slopeAt(v), 'slopeAt ' + v);
    const n = t.normalAt(v, {});
    H.assertFinite(n.x); H.assertFinite(n.y);
    H.assert(t.surfaceAt(v) && typeof t.surfaceAt(v).friction === 'number', 'surfaceAt ' + v);
    H.assert(t.ceilingAt(v) === null, 'ceilingAt ' + v);
  }
  const o = {};
  H.assert(t.closestPoint(NaN, 0, 1, o) === false, 'closestPoint NaN');
  H.assert(new T({}).heightAt(0) === 0, 'no-arg constructor works');
});

H.test('generation errors never break a run (flat safety chunk, logged once)', () => {
  const t = new T({ seed: 4, world: 'moon_base' });
  t.ensure(300);
  const orig = t._generateNext;
  let calls = 0;
  t._generateNext = function () { calls++; throw new Error('boom (intentional test error)'); };
  const errs = [];
  const oe = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try { t.ensure(600); } finally { console.error = oe; }
  H.assert(t.maxX >= 600 && calls > 0 && errs.length === 1, 'kept generating (maxX ' + t.maxX + ', errors logged ' + errs.length + ')');
  for (let x = 300; x < 600; x += 0.5) H.assertFinite(t.heightAt(x), 'finite at ' + x);
  t._generateNext = orig;
  t.ensure(2000);
  const v = t.validate(t.minX, t.maxX);
  H.assert(v.ok, 'terrain valid after recovery: ' + v.problems.slice(0, 3).join(' | '));
});

H.test('surfaceAt returns the shared frozen RR.SURFACES objects', () => {
  const t = new T({ seed: 5, world: 'snow_peaks' });
  t.ensure(3000);
  const seen = new Set();
  for (let x = 0; x < 3000; x += 0.5) {
    const s = t.surfaceAt(x);
    H.assert(RR.SURFACES[s.type] === s && Object.isFrozen(s), 'shared frozen surface at ' + x);
    seen.add(s.type);
  }
  H.assert(seen.has('snow'), 'default surface present');
  H.assert(seen.has('ice'), 'alt-surface (ice) patches present in 3 km of Snow Peaks');
  H.assert(T.SURFACE_LIST.every((s, i) => s === RR.SURFACES[T.SURFACE_TYPES[i]]), 'index tables');
});

H.test('normals, slopes and index accessors agree with heightAt', () => {
  const t = new T({ seed: 8, world: 'rocky_highlands' });
  t.ensure(1500);
  const n = {};
  for (let x = -50; x < 1400; x += 1.37) {
    const s = t.slopeAt(x);
    t.normalAt(x, n);
    H.assertClose(Math.hypot(n.x, n.y), 1, 1e-12, 'unit normal');
    H.assertClose(n.x + s * n.y, 0, 1e-12, 'normal ⟂ slope');
    H.assert(n.y > 0, 'normal points up');
    const i = Math.floor(x / DX);
    H.assertClose(t.heightAt(i * DX), t.pointY(i), 1e-9, 'pointY');
    H.assertClose(t.pointX(i), i * DX, 1e-12, 'pointX');
  }
  const r = t.getIndexRange(-1000, 1e9);
  H.assert(r[0] === Math.round(t.minX / DX) && r[1] === Math.round(t.maxX / DX), 'getIndexRange clamps to stored data');
  const reuse = [0, 0];
  H.assert(t.getIndexRange(10, 20, reuse) === reuse && reuse[0] === 20 && reuse[1] === 40, 'getIndexRange out param');
  H.assert(t.difficultyAt(0) === 0 && t.difficultyAt(1e9) === 1 && t.difficultyAt(-5) === 0, 'difficultyAt clamps');
});

H.test('onChunk: called per 64 m chunk, replayed when assigned late', () => {
  const t = new T({ seed: 3, world: 'desert_canyon' });
  const calls = [];
  t.onChunk = (x0, x1, f) => calls.push([x0, x1, f.length]);
  t.ensure(700);
  H.assert(calls.length >= 11, 'chunks emitted');
  for (let k = 0; k < calls.length; k++) {
    H.assertClose(calls[k][1] - calls[k][0], 64, 1e-9, 'chunk width');
    if (k) H.assertClose(calls[k][0], calls[k - 1][1], 1e-9, 'contiguous');
  }
  const late = new T({ seed: 3, world: 'desert_canyon' });
  late.ensure(700);
  const got = [];
  const fn = (x0, x1, f) => got.push([x0, x1, f.length]);
  late.onChunk = fn;
  H.assert(JSON.stringify(got) === JSON.stringify(calls), 'late assignment replays the same chunks');
  late.onChunk = fn;
  H.assert(got.length === calls.length, 're-assigning the same callback does not replay twice');
});

H.test('upcomingSection teaser & SectionInfo shape', () => {
  const t = new T({ seed: 11, world: 'green_valley' });
  const s = t.upcomingSection(0);
  H.assert(s && s.start >= 1200 && s.start <= 1800, 'first major section at 1200–1800 m (got ' + (s && s.start) + ')');
  const b = t.upcomingSection(2900);
  H.assert(b && b.id === 'boss' && b.start === 3000 && b.tier === 1 && b.name === 'BOSS RUN' &&
    b.bossName === 'THE MOUNTAIN GIANT' && b.summitX > b.start, 'boss teaser');
  H.assert(Array.isArray(b.ledges) && b.ledges.length === 3 && b.ledges.every((L, i) => L.x > b.start && L.x2 > L.x &&
    L.x2 < b.summitX && (i === 0 || L.x >= b.ledges[i - 1].x2)), 'boss teaser publishes sorted rest ledges {x, x2}');
  t.ensure(1200);
  const before = t.upcomingSection(0);
  H.assert(before.start === s.start, 'plan is stable');
});

// ================================================================== the big drive
H.test('drive 8 worlds × 5 seeds (moving ensure/trim window)', () => {
  const t0 = nowMs();
  for (const w of WORLDS) {
    summary[w.id] = { counts: {}, maxOrganic: 0, maxDesignUp: 0, maxTrenchUp: 0, maxBoss: 0, maxWall: 0, maxV: 0, sections: '', decoGap: [] };
    for (const seed of SEEDS) {
      const rec = drive(w.id, seed, { cpPerStep: seed === SEEDS[0] ? 12 : 4 });
      rec.an = analyse(rec);
      runs.push(rec);
      const S = summary[w.id];
      countFeatures(rec, S.counts);
      S.maxOrganic = Math.max(S.maxOrganic, rec.an.maxOrganic);
      S.maxDesignUp = Math.max(S.maxDesignUp, rec.an.maxDesignUp);
      S.maxTrenchUp = Math.max(S.maxTrenchUp, rec.an.maxTrenchUp);
      S.maxBoss = Math.max(S.maxBoss, rec.an.maxBoss);
      S.maxWall = Math.max(S.maxWall, rec.an.maxWall);
      S.maxV = Math.max(S.maxV, rec.jumps.maxV);
      if (seed === SEEDS[0]) {
        S.sections = Array.from(rec.sections.values()).map((s) => s.id + (s.tier ? s.tier : '') + '@' + Math.round(s.start)).join(' ');
      }
    }
  }
  console.log('      (' + runs.length + ' runs, ' + ((nowMs() - t0) / 1000).toFixed(1) + ' s)');
});

H.test('no NaN anywhere on the recorded courses', () => {
  for (const rec of runs) {
    const upto = idx(rec.dist);
    for (let k = 0; k < upto; k++) H.assert(Number.isFinite(rec.hs[k]), rec.worldId + '/' + rec.seed + ' NaN/missing at x=' + ((k + I0) * DX));
    for (const f of rec.features) {
      H.assert(Number.isFinite(f.x) && Number.isFinite(f.x2) && Number.isFinite(f.y) && f.x2 >= f.x, 'feature coords ' + f.type);
      for (const [key, v] of Object.entries(f.meta)) if (typeof v === 'number') H.assert(Number.isFinite(v), f.type + '.meta.' + key + ' finite');
    }
    for (const d of rec.decos) H.assert(Number.isFinite(d.x) && Number.isFinite(d.y) && d.scale > 0, 'decoration numbers');
  }
});

H.test('validate(): slope limits, ramp spans, concave kinks, lava ramps, ceilings — all clean', () => {
  for (const rec of runs) H.assert(rec.problems.length === 0, rec.worldId + '/' + rec.seed + ': ' + rec.problems.slice(0, 5).join(' | '));
});

// Boss / wall slope caps: 1.25 (rock-equivalent) × the low-gravity factor, + tolerance.
const gravF = (rec) => 1 + 0.18 * Math.max(0, 1 - RR.Worlds.byId(rec.worldId).gravity);
const BOSS_MAX = (rec) => 1.25 * gravF(rec) + 0.06 + 1e-9;
const WALL_MAX = (rec) => 1.25 * gravF(rec) + 0.04 + 1e-9;

H.test('slopes ≤ maxSlope (+tol) outside flagged ramp spans; designed climbs ≤ 0.7; trench exits ≤ 0.62', () => {
  for (const rec of runs) {
    const a = rec.an;
    H.assert(a.maxOrganic <= 1 + 0.02 / 0.5, rec.worldId + '/' + rec.seed + ' organic slope ratio ' + fmt(a.maxOrganic, 3));
    H.assert(a.maxDesignUp <= 0.705, rec.worldId + '/' + rec.seed + ' designed climb ' + fmt(a.maxDesignUp, 3));
    H.assert(a.maxTrenchUp <= 0.62, rec.worldId + '/' + rec.seed + ' trench exit ' + fmt(a.maxTrenchUp, 3));
    H.assert(a.maxBoss <= BOSS_MAX(rec), rec.worldId + '/' + rec.seed + ' boss slope ' + fmt(a.maxBoss, 3));
    H.assert(a.maxWall <= WALL_MAX(rec), rec.worldId + '/' + rec.seed + ' wall slope ' + fmt(a.maxWall, 3));
  }
});

H.test('no wheel-trapping concave kinks (R ≥ 0.45 m everywhere, ≥ ~2.2 m on organic ground)', () => {
  for (const rec of runs) {
    for (let k = 2; k < idx(rec.dist); k++) {
      const a1 = Math.atan((rec.hs[k] - rec.hs[k - 2]) / (2 * DX));
      const a2 = Math.atan((rec.hs[k + 2] - rec.hs[k]) / (2 * DX));
      const turn = a2 - a1;   // concave > 0; ~1 m of arc between chord midpoints
      if (turn <= 0) continue;
      let special = false;
      for (let j = -2; j <= 2; j++) if (rec.fl[k + j] & (F.DESIGN | F.ROCKS | F.WALL)) special = true;
      H.assert(1 / turn >= 0.45, rec.worldId + '/' + rec.seed + ' concave radius ' + fmt(1 / turn, 3) + ' m at x=' + ((k + I0) * DX));
      if (!special) H.assert(turn <= 0.45, rec.worldId + '/' + rec.seed + ' organic concave kink ' + fmt(turn, 3) + ' at x=' + ((k + I0) * DX));
    }
  }
});

H.test('deterministic: same seed ⇒ identical terrain regardless of ensure/trim pattern', () => {
  for (const w of WORLDS) {
    const a = runs.find((r) => r.worldId === w.id && r.seed === 42);
    const dd = Math.min(9000, DIST);
    const b = drive(w.id, 42, { step: 71, jitter: false, cp: false, dist: dd });
    const upto = idx(dd);
    for (let k = 0; k < upto; k++) if (a.hs[k] !== b.hs[k] || a.fl[k] !== b.fl[k] || a.sf[k] !== b.sf[k]) {
      throw new Error(w.id + ' differs at x=' + ((k + I0) * DX) + ': ' + a.hs[k] + ' vs ' + b.hs[k]);
    }
    const fa = JSON.stringify(a.features.filter((f) => f.x < dd - 200));
    const fb = JSON.stringify(b.features.filter((f) => f.x < dd - 200));
    H.assert(fa === fb, w.id + ' features differ between call patterns');
    const da = JSON.stringify(a.decos.filter((d) => d.x < dd - 200));
    const db = JSON.stringify(b.decos.filter((d) => d.x < dd - 200));
    H.assert(da === db, w.id + ' decorations differ between call patterns');
  }
});

H.test('different seeds give different terrain', () => {
  for (const w of WORLDS) {
    const rs = runs.filter((r) => r.worldId === w.id);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      let diff = 0;
      for (let k = idx(60); k < idx(3000); k++) diff += Math.abs(rs[i].hs[k] - rs[j].hs[k]);
      H.assert(diff / (idx(3000) - idx(60)) > 0.5, w.id + ' seeds ' + rs[i].seed + '/' + rs[j].seed + ' too similar');
    }
  }
});

H.test('every gap / lava pool passes the ballistic check (≤ 16 m/s) with climbable, landing-below geometry', () => {
  for (const rec of runs) {
    H.assert(rec.jumps.fail.length === 0, rec.worldId + '/' + rec.seed + ': ' + rec.jumps.fail.slice(0, 4).join(' | '));
    for (const f of rec.features) {
      if (f.type !== 'gap' && f.type !== 'lava' && f.type !== 'jump') continue;
      const m = f.meta;
      if (m.landingZoneX2 > rec.dist) continue;   // not fully recorded
      for (const key of ['takeoffX', 'takeoffY', 'takeoffAngle', 'landingX', 'apexY', 'width']) H.assert(Number.isFinite(m[key]), f.type + ' meta.' + key);
      H.assert(m.takeoffAngle > 0.3 && m.takeoffAngle < Math.atan(0.72), f.type + ' ramp angle ' + fmt(m.takeoffAngle, 3));
      H.assert(m.landingX > m.takeoffX && m.apexY > m.takeoffY && m.width > 0, f.type + ' arc meta');
      H.assert(f.x <= m.takeoffX && m.takeoffX < f.x2, f.type + ' span covers takeoff');
      if (f.type === 'jump') continue;
      const k = idx(m.trenchX2);
      H.assert(rec.hs[k] <= m.takeoffY + 1e-9, f.type + ' landing rim above takeoff at ' + fmt(f.x));
      H.assert(m.vReq <= 16, f.type + ' vReq ' + fmt(m.vReq));
      if (f.type === 'gap' && m.boss) {
        // the boss's small kicker gap (tier ≥ 2): shallow, short, clearable from its run-up ledge
        H.assert(m.depth >= 0.9 && m.depth <= 2.6 && m.width <= 10 && m.vReq <= 10.5, 'boss gap ' + fmt(m.depth) + ' m deep, ' + fmt(m.width) + ' m wide, vReq ' + fmt(m.vReq) + ' at ' + fmt(f.x));
      } else if (f.type === 'gap') H.assert(m.depth >= 2.95 && m.depth <= 6.05, 'gap depth ' + fmt(m.depth) + ' at ' + fmt(f.x));
      // exit wall of the trench is climbable (≤ ~31°): check the recorded samples between floor and rim
      for (let q = idx(m.takeoffX) + 1; q <= k; q++) if (rec.fl[q] & F.TRENCH) H.assert(slopeK(rec, q) <= 0.62, 'trench exit slope');
    }
  }
});

H.test('lava only where allowed (world lava weight > 0 or volcano sections), always behind a ramp', () => {
  for (const rec of runs) {
    const w = RR.Worlds.byId(rec.worldId);
    const secs = Array.from(rec.sections.values());
    for (const f of rec.features) {
      if (f.type !== 'lava') continue;
      const inVolcano = secs.some((s) => s.id === 'volcano' && f.x >= s.start && f.x < s.end);
      H.assert(w.terrain.features.lava > 0 || inVolcano, rec.worldId + ' lava outside volcano at ' + fmt(f.x));
      H.assert(f.meta.poolX > f.meta.takeoffX && f.meta.poolX2 > f.meta.poolX, 'pool after takeoff');
    }
    for (let k = 0; k < idx(rec.dist); k++) {
      const isLava = T.SURFACE_TYPES[rec.sf[k]] === 'lava';
      H.assert(isLava === !!(rec.fl[k] & F.LAVA), 'lava surface ⇔ lava flag at ' + ((k + I0) * DX));
    }
  }
});

H.test('boss climbs at 3000/8000/13000…: rest ledges, rock garden, headwall crux, kicker gap from tier 2, flat summit', () => {
  const heads = {};   // world → steepest 40 m average per tier (seed-aggregated max)
  for (const rec of runs) {
    const w = RR.Worlds.byId(rec.worldId);
    const bosses = Array.from(rec.sections.values()).filter((s) => s.id === 'boss');
    const expected = [];
    for (let b = 3000; b + 600 < rec.dist; b += 5000) expected.push(b);
    H.assert(bosses.length >= expected.length, rec.worldId + '/' + rec.seed + ' boss count ' + bosses.length);
    expected.forEach((bx, n) => {
      const b = bosses[n], tier = n + 1, tag = rec.worldId + '/' + rec.seed + ' t' + tier;
      H.assert(b.start === bx && b.tier === tier, 'boss ' + tier + ' at ' + b.start + ' tier ' + b.tier);
      H.assert(b.name === 'BOSS RUN' && b.bossName === w.bossName, 'boss names');
      const climbEnd = b.summitX - 10;
      const len = climbEnd - b.start;
      H.assert(len >= 280 && len <= 470, tag + ' boss climb length ' + fmt(len));
      H.assert(b.end - climbEnd >= 40, 'summit plateau ≥ 40 m');
      for (let k = idx(climbEnd) + 1; k <= idx(b.end); k++) H.assert(Math.abs(slopeK(rec, k)) < 0.03, 'summit flat at ' + ((k + I0) * DX));
      // section.ledges: sorted rest/run-up ledges inside the climb, flat and 15–34 m long
      const L = b.ledges;
      H.assert(Array.isArray(L) && L.length === (tier >= 2 ? 4 : 3), tag + ' ledges ' + (L && L.length));
      L.forEach((ld, i) => {
        H.assert(ld.x > b.start + 30 && ld.x2 < climbEnd && ld.x2 - ld.x >= 14.9 && ld.x2 - ld.x <= 34, tag + ' ledge ' + i + ' ' + fmt(ld.x) + '–' + fmt(ld.x2));
        if (i) H.assert(ld.x >= L[i - 1].x2, tag + ' ledges sorted / disjoint');
        for (let k = idx(ld.x) + 1; k <= idx(ld.x2); k++) H.assert(Math.abs(slopeK(rec, k)) < 0.03, tag + ' ledge flat at ' + ((k + I0) * DX));
        H.assert(rec.features.some((f) => f.type === 'plateau' && f.meta.ledge && f.x === ld.x && f.x2 === ld.x2), tag + ' ledge plateau feature');
      });
      // flags: boss everywhere; designed (kicker/trench) samples only inside the tier ≥ 2 gap; a rock garden
      const gap = rec.features.find((f) => f.type === 'gap' && f.meta.boss && f.x >= b.start && f.x < climbEnd);
      H.assert(tier >= 2 ? !!gap : !gap, tag + ' boss gap ' + !!gap);
      let rocks = 0, maxS = 0;
      for (let k = idx(b.start) + 1; k <= idx(climbEnd); k++) {
        const x = (k + I0) * DX;
        H.assert(rec.fl[k] & F.BOSS, 'boss flag');
        if (rec.fl[k] & F.DESIGN) H.assert(gap && x >= gap.x && x <= gap.meta.trenchX2 + DX, tag + ' designed sample outside the boss gap at ' + x);
        if (rec.fl[k] & F.ROCKS) rocks++;
        if (!(rec.fl[k] & F.DESIGN)) maxS = Math.max(maxS, Math.abs(slopeK(rec, k)));
      }
      H.assert(rocks * DX >= 14, tag + ' rock garden ' + rocks * DX + ' m');
      H.assert(maxS <= BOSS_MAX(rec), tag + ' boss max slope ' + fmt(maxS, 3));
      if (gap) {
        const lNext = L.find((ld) => ld.x >= gap.meta.trenchX2 - 1e-6);
        H.assert(gap.meta.vReq <= 10.5 && lNext && lNext.x - gap.meta.trenchX2 < 1.5 && lNext.x2 - lNext.x >= 25, tag + ' gap lands on a long ledge (vReq ' + fmt(gap.meta.vReq) + ')');
      }
      // the crux: a sustained headwall — steepest 40 m average ≥ 0.9 (× surface factor ≥ 0.868) and far
      // steeper than the old 0.8-capped boss; the 30 m average never exceeds the cap
      let head = 0;
      for (let k = idx(b.start); k + 80 <= idx(climbEnd); k++) head = Math.max(head, (rec.hs[k + 80] - rec.hs[k]) / 40);
      H.assert(head >= 0.9 && head <= BOSS_MAX(rec), tag + ' headwall 40 m average ' + fmt(head, 3));
      const hk = rec.worldId;
      heads[hk] = heads[hk] || [];
      heads[hk][tier] = heads[hk][tier] || [];
      heads[hk][tier].push(head);
      const feats = rec.features.filter((f) => f.x >= b.start && f.x <= b.end);
      const summit = feats.find((f) => f.type === 'summit');
      const cp = feats.find((f) => f.type === 'checkpoint');
      H.assert(summit && cp && summit.x === b.summitX && cp.x === b.summitX, 'summit + checkpoint features at summitX');
    });
  }
  // later tiers are steeper (mean over seeds): tier 3 ≥ tier 1 + 0.02
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  for (const [wid, hs] of Object.entries(heads)) if (hs[1] && hs[3]) H.assert(mean(hs[3]) >= mean(hs[1]) + 0.02, wid + ' headwall t1 ' + fmt(mean(hs[1])) + ' → t3 ' + fmt(mean(hs[3])));
});

H.test('major sections: first 1200–1800 m, then every 2–3 km, 350–600 m, pool ids, no repeats, no overlap', () => {
  for (const rec of runs) {
    const w = RR.Worlds.byId(rec.worldId);
    const secs = Array.from(rec.sections.values()).sort((a, b) => a.start - b.start);
    const majors = secs.filter((s) => s.id !== 'boss');
    H.assert(majors.length >= Math.floor((rec.dist - 1800) / 3000), rec.worldId + '/' + rec.seed + ' too few sections');
    H.assert(majors[0].start >= 1200 && majors[0].start <= 1800, 'first section ' + majors[0].start);
    for (let k = 0; k < majors.length; k++) {
      const s = majors[k];
      if (s.end > rec.dist) continue;
      H.assert(w.sectionPool.indexOf(s.id) >= 0, 'id from pool');
      H.assert(s.name === RR.Worlds.SECTION_INFO[s.id].name, 'section name');
      H.assert(s.end - s.start >= 349 && s.end - s.start <= 601, 'section length ' + (s.end - s.start));
      if (k) {
        const gap = s.start - majors[k - 1].start;
        // 2–3 km, or pushed past a boss (boss priority) by at most the boss length + margin
        const bossBetween = secs.some((b) => b.id === 'boss' && b.start > majors[k - 1].start && b.start < s.start + 700);
        H.assert(gap >= 1999 && (gap <= 3001 || (bossBetween && gap <= 3500)), rec.worldId + '/' + rec.seed + ' spacing ' + gap);
        if (w.sectionPool.length > 1) H.assert(s.id !== majors[k - 1].id, 'no immediate repeat');
      }
    }
    for (let k = 1; k < secs.length; k++) H.assert(secs[k].start >= secs[k - 1].end, 'sections do not overlap');
  }
});

H.test('section shaping: canyon 3–5 big jumps, volcano lava pools, caves have ceilings, storm rougher', () => {
  let canyons = 0, volcanoes = 0, caves = 0;
  for (const rec of runs) {
    for (const s of rec.sections.values()) {
      if (s.end > rec.dist) continue;   // not fully recorded
      const inside = rec.features.filter((f) => f.x >= s.start && f.x < s.end);
      if (s.id === 'canyon') {
        canyons++;
        const n = inside.filter((f) => f.type === 'gap' || f.type === 'jump').length;
        H.assert(n >= 3 && n <= 5, rec.worldId + ' canyon big-air count ' + n);
      }
      if (s.id === 'volcano') {
        volcanoes++;
        const n = inside.filter((f) => f.type === 'lava').length;
        H.assert(n >= 2, rec.worldId + ' volcano lava pools ' + n);
      }
      if (s.id === 'cave') {
        caves++;
        H.assert(!inside.some((f) => f.type === 'jump' || f.type === 'gap' || f.type === 'lava'), 'no jumps in caves');
      }
    }
    H.assert(rec.ceil.fail.length === 0, rec.worldId + '/' + rec.seed + ': ' + rec.ceil.fail.slice(0, 3).join(' | '));
  }
  H.assert(canyons > 5 && volcanoes > 3 && caves > 5, 'sections exercised (' + canyons + '/' + volcanoes + '/' + caves + ')');
});

H.test('features sorted by x, published in their chunk; neon pads only in Neon City and flat', () => {
  for (const rec of runs) {
    H.assert(rec.orderFail === 0, rec.worldId + ' feature order');
    for (const f of rec.features) {
      if (f.type !== 'bouncepad' && f.type !== 'boostpad') continue;
      H.assert(rec.worldId === 'neon_city', 'pads only in neon city');
      for (let k = idx(f.x) + 1; k <= idx(f.x2); k++) H.assert(Math.abs(slopeK(rec, k)) < 1e-9, 'pad flat');
    }
  }
  const neon = summary.neon_city.counts;
  H.assert(neon.bouncepad > 20 && neon.boostpad > 20, 'neon pads present');
});

H.test('decorations: world types, ~1 per 6–12 m, only on moderately flat, non-hazard ground', () => {
  for (const rec of runs) {
    const w = RR.Worlds.byId(rec.worldId);
    let front = 0;
    for (const d of rec.decos) {
      if (d.x > rec.dist) continue;   // beyond the recorded course
      H.assert(w.decorations.indexOf(d.type) >= 0, 'deco type ' + d.type);
      H.assert(d.layer === 'back' || d.layer === 'front', 'layer');
      H.assert(Number.isInteger(d.variant) && d.variant >= 0 && d.variant <= 3, 'variant');
      const k = idx(d.x);
      H.assert(!(rec.fl[k] & (F.DESIGN | F.TRENCH | F.LAVA | F.PAD | F.NODECO)), 'deco on hazard/ramp at ' + d.x);
      H.assert(Math.abs(slopeK(rec, k)) <= 0.45 && Math.abs(slopeK(rec, k + 1)) <= 0.45, rec.worldId + '/' + rec.seed + ' deco on steep ground at ' + d.x + ' slopes ' + slopeK(rec, k) + ', ' + slopeK(rec, k + 1));
      const k0 = Math.floor(d.x / DX) - I0, fr = d.x / DX - Math.floor(d.x / DX);
      H.assertClose(d.y, rec.hs[k0] + (rec.hs[k0 + 1] - rec.hs[k0]) * fr, 1e-9, 'deco sits on the ground');
      if (d.layer === 'front') { front++; H.assert(d.scale <= 0.76, 'front decorations are small'); }
    }
    const spacing = rec.dist / rec.decos.length;
    H.assert(spacing >= 5 && spacing <= 16, rec.worldId + ' deco spacing ' + fmt(spacing));
    const hasSmall = w.decorations.some((d) => ['rock', 'bush', 'flowers', 'tumbleweed', 'snow_mound', 'crystal', 'alien_plant', 'bones', 'lava_rock', 'ice_crystal', 'cairn'].indexOf(d) >= 0);
    H.assert((front > 0 || !hasSmall) && front < rec.decos.length * 0.2, rec.worldId + ' front layer rare (' + front + ')');
  }
});

H.test('closestPoint matches brute force (incl. points inside the ground and at the back wall)', () => {
  let n = 0;
  for (const rec of runs) {
    n += rec.cp.n;
    H.assert(rec.cp.fail.length === 0, rec.worldId + '/' + rec.seed + ': ' + rec.cp.fail.slice(0, 3).join(' | '));
  }
  H.assert(n > 5000, 'checked ' + n + ' points');
  console.log('      (' + n + ' random points checked)');
});

H.test('chunk generation timing (64 m chunk < 1 ms)', () => {
  const all = [];
  for (const rec of runs) all.push(...rec.chunkMs.slice(4));
  all.sort((a, b) => a - b);
  const q = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  console.log('      chunks ' + all.length + ': avg ' + fmt(avg, 3) + ' ms, median ' + fmt(q(0.5), 3) + ', p95 ' + fmt(q(0.95), 3) +
    ', p99 ' + fmt(q(0.99), 3) + ', max ' + fmt(all[all.length - 1], 3));
  H.assert(avg < 0.5 && q(0.95) < 1, 'chunk generation too slow');
});

H.test('memory bounded with trim (20 km and a 50 km drive)', () => {
  for (const rec of runs) {
    const m = rec.mem;
    H.assert(m.cap <= 8192 && m.span <= 4200, rec.worldId + ' typed arrays cap ' + m.cap + ' span ' + m.span);
    H.assert(m.features <= 200 && m.decos <= 150 && m.sections <= 3 && m.log <= 12 && m.pend <= 60,
      rec.worldId + ' lists ' + JSON.stringify(m));
  }
  const long = drive('storm_planet', 777, { dist: 50000, step: 6, cp: false });
  const m = long.mem;
  H.assert(long.problems.length === 0, '50 km validate: ' + long.problems.slice(0, 3).join(' | '));
  H.assert(m.cap <= 8192 && m.span <= 4200 && m.features <= 200 && m.decos <= 150 && m.log <= 12, '50 km memory ' + JSON.stringify(m));
  const bosses = Array.from(long.sections.values()).filter((s) => s.id === 'boss');
  H.assert(bosses.length === 10 && bosses[9].start === 48000 && bosses[9].tier === 10, '10 bosses in 50 km');
});

H.test('terrainAmpMul 1.6 (daily "extreme hills") stays playable and is bigger', () => {
  const spread = (rec) => { // mean height range inside 100 m windows of normal ground over the first 2.6 km
    let s = 0, n = 0;
    const skip = Array.from(rec.sections.values()).map((q) => [q.start, q.end])
      .concat(rec.features.filter((f) => f.type === 'steep' && f.meta.wall).map((f) => [f.x - 60, f.x2]));
    for (let k = idx(200); k < idx(2800); k += 200) {
      const x0 = (k + I0) * DX;
      if (skip.some((q) => x0 < q[1] && x0 + 100 > q[0])) continue;
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < 200; j++) { lo = Math.min(lo, rec.hs[k + j]); hi = Math.max(hi, rec.hs[k + j]); }
      s += hi - lo; n++;
    }
    return s / n;
  };
  for (const w of WORLDS) {
    let sBig = 0, sBase = 0;   // aggregated over seeds: pattern placement shifts when sizes change
    // playability over 9 km on two seeds; the size comparison over 10 seeds (pattern placement shifts when
    // sizes change, so a handful of seeds is noisy)
    const seeds = SEEDS.concat([7, 8, 9, 10, 11]);
    for (let q = 0; q < seeds.length; q++) {
      const seed = seeds[q], full = q < 2;
      const big = drive(w.id, seed, { modifiers: { terrainAmpMul: 1.6 }, cp: false, step: 5, dist: full ? Math.min(DIST, 9000) : 3500 });
      H.assert(big.problems.length === 0, w.id + ' amp 1.6: ' + big.problems.slice(0, 3).join(' | '));
      H.assert(big.jumps.fail.length === 0, w.id + ' amp 1.6 jumps: ' + big.jumps.fail.slice(0, 3).join(' | '));
      const an = analyse(big);
      H.assert(an.maxOrganic <= 1.04 && an.maxDesignUp <= 0.705 && an.maxBoss <= BOSS_MAX(big) && an.maxWall <= WALL_MAX(big), w.id + ' amp 1.6 slopes');
      const base = runs.find((r) => r.worldId === w.id && r.seed === seed) || drive(w.id, seed, { cp: false, step: 5, dist: 3500 });
      sBig += spread(big); sBase += spread(base);
    }
    H.assert(sBig > sBase * 1.2, w.id + ' amp 1.6 not larger (' + fmt(sBig / seeds.length) + ' vs ' + fmt(sBase / seeds.length) + ' m per 100 m window)');
  }
});

H.test('difficulty ramps: later terrain has more gaps/rocks and steeper slopes', () => {
  if (DIST < 9000) { console.log('      (skipped: needs TERRAIN_DIST ≥ 9000 so the late window is at full difficulty)'); return; }
  let early = 0, late = 0, earlySteep = 0, lateSteep = 0;
  const E0 = 320, E1 = 2500, L0 = DIST - 3000, L1 = DIST;   // rates per metre are compared
  for (const rec of runs) {
    for (const f of rec.features) {
      // normal ground only (sections have their own shaping)
      const inSection = Array.from(rec.sections.values()).some((s) => f.x >= s.start - 50 && f.x <= s.end + 400);
      if (inSection) continue;
      const hard = f.type === 'gap' || f.type === 'rocks' || f.type === 'lava' || (f.type === 'steep' && f.meta.wall);
      if (f.x >= E0 && f.x < E1) { if (hard) early++; if (f.type === 'steep') earlySteep++; } else if (f.x >= L0 && f.x < L1) { if (hard) late++; if (f.type === 'steep') lateSteep++; }
    }
  }
  const rE = (E1 - E0), rL = (L1 - L0);
  H.assert(late / rL > 1.3 * early / rE, 'hard features early ' + early + '/' + rE + ' m vs late ' + late + '/' + rL + ' m');
  H.assert(lateSteep / rL > earlySteep / rE, 'steep stretches early ' + earlySteep + ' vs late ' + lateSteep);
});

// ================================================================== review fixes (terrain-1/2/3)
H.test('signature set piece first: THE STORM / THE VOLCANO / THE MOON open at 1.2–1.6 km on 20/20 seeds; others vary', () => {
  const SIG = { storm_planet: 'storm', volcanic_ridge: 'volcano', moon_base: 'moon' };
  for (const w of WORLDS) {
    const firsts = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const t = new T({ seed: seed * 7919, world: w });
      const s = t.upcomingSection(0);
      H.assert(s && s.id !== 'boss' && s.start >= 1200 && s.end <= 2850, w.id + ' first section ' + (s && s.id) + '@' + (s && s.start));
      if (SIG[w.id]) H.assert(s.id === SIG[w.id] && s.start <= 1600, w.id + '/' + seed + ' opens with ' + s.id + '@' + s.start);
      firsts.add(s.id);
      // the second major is from the random pool and never repeats the first
      const s2 = t.upcomingSection(3200);
      const nxt = s2 && s2.id === 'boss' ? t.upcomingSection(s2.start + 1) : s2;
      if (w.sectionPool.length > 1) H.assert(nxt && nxt.id !== s.id, w.id + ' second section repeats the first');
    }
    if (!SIG[w.id]) H.assert(firsts.size >= 2, w.id + ' first sections should vary (' + Array.from(firsts).join(',') + ')');
  }
  // world.signatureSection overrides the mapping (must be in the pool)
  const custom = Object.assign({}, RR.Worlds.byId('green_valley'), { signatureSection: 'cave' });
  for (let seed = 1; seed <= 5; seed++) H.assert(new T({ seed, world: custom }).upcomingSection(0).id === 'cave', 'signatureSection override');
});

H.test('late slope budget: uphill limit × lerp(1, 1.3, smoothstep(D, 2.5·D)) capped at 1.25; downhill and early limits unchanged', () => {
  for (const w of WORLDS) {
    const t = new T({ seed: 3, world: w });
    const ms = w.terrain.maxSlope, D = w.terrain.difficultyDistance;
    H.assertClose(t.maxSlopeAt(0), Math.min(0.5, ms), 1e-12, w.id + ' start limit');
    H.assertClose(t.maxSlopeAt(D), ms, 1e-12, w.id + ' limit at D');
    H.assertClose(t.maxSlopeAt(1.75 * D), ms * 1.15 > 1.25 ? Math.max(ms, 1.25) : ms * 1.15, 1e-9, w.id + ' limit at 1.75·D');
    H.assertClose(t.maxSlopeAt(2.5 * D), Math.min(1.25, ms * 1.3), 1e-12, w.id + ' limit at 2.5·D');
    H.assertClose(t.maxSlopeAt(9 * D), Math.min(1.25, ms * 1.3), 1e-12, w.id + ' limit far out');
    H.assertClose(t.maxDownSlopeAt(9 * D), ms, 1e-12, w.id + ' downhill limit stays at maxSlope');
    for (let x = 0; x < 3 * D; x += 250) H.assert(t.maxSlopeAt(x + 250) >= t.maxSlopeAt(x) - 1e-12, 'monotonic');
  }
  // the recorded courses reach steeper organic climbs late than at D (every world, 20 km)
  if (DIST >= 16000) {
    for (const w of WORLDS) {
      let atD = 0, late = 0;
      const D = w.terrain.difficultyDistance;
      for (const rec of runs.filter((r) => r.worldId === w.id)) {
        for (let k = idx(0.6 * D); k < idx(Math.min(rec.dist, 3 * D)); k++) {
          if (rec.fl[k] & (F.DESIGN | F.BOSS | F.WALL)) continue;
          const s = slopeK(rec, k), x = (k + I0) * DX;
          if (x < D) atD = Math.max(atD, s); else if (x > 2 * D) late = Math.max(late, s);
        }
      }
      if (late > 0) H.assert(late > atD + 0.05, w.id + ' late organic climbs ' + fmt(late) + ' vs ' + fmt(atD) + ' before D');
    }
  }
});

H.test('wall climbs: scheduled after ≥ 1.5 km, ≥ 40 m flat run-up, 8–15 m face, steeper with distance, clear of sections', () => {
  const byWorld = {};
  for (const rec of runs) {
    const w = RR.Worlds.byId(rec.worldId);
    const walls = rec.features.filter((f) => f.type === 'steep' && f.meta.wall && f.x2 < rec.dist);
    const secs = Array.from(rec.sections.values());
    H.assert(walls.length >= Math.floor((rec.dist - 3000) / 1400), rec.worldId + '/' + rec.seed + ' only ' + walls.length + ' walls');
    let prev = -Infinity;
    for (const f of walls) {
      const m = f.meta, tag = rec.worldId + '/' + rec.seed + ' wall@' + fmt(f.x);
      H.assert(f.x >= 1500 && (w.id !== 'green_valley' || f.x >= 1750), tag + ' too early');
      H.assert(f.x - prev >= 250, tag + ' spacing ' + fmt(f.x - prev));
      prev = f.x;
      H.assert(m.dir === 1 && m.faceX > f.x && m.faceX2 > m.faceX && m.faceX2 - m.faceX >= 7.9 && m.faceX2 - m.faceX <= 15.1, tag + ' face ' + fmt(m.faceX2 - m.faceX));
      H.assert(m.maxSlope >= 0.7 && m.maxSlope <= WALL_MAX(rec) && m.rise > 5, tag + ' slope ' + fmt(m.maxSlope) + ' rise ' + fmt(m.rise));
      // the face really is that steep; the run-up before the ramp is ≤ 0.2 for ≥ 40 m
      let face = Infinity;
      for (let k = idx(m.faceX) + 1; k <= idx(m.faceX2); k++) face = Math.min(face, slopeK(rec, k));
      H.assert(Math.abs(face - m.maxSlope) < 1e-6, tag + ' face slope ' + fmt(face, 3));
      for (let k = idx(f.x - 40) + 1; k <= idx(f.x); k++) H.assert(Math.abs(slopeK(rec, k)) <= 0.2, tag + ' run-up slope ' + fmt(slopeK(rec, k)) + ' at ' + ((k + I0) * DX));
      for (let k = idx(f.x) + 1; k <= idx(f.x2); k++) H.assert(rec.fl[k] & F.WALL, tag + ' wall flag');
      for (const s of secs) H.assert(f.x2 < s.start - 50 || f.x - 60 > s.end + (s.id === 'boss' ? 200 : 20), tag + ' overlaps section ' + s.id + '@' + s.start);
      // never right after a landing zone
      for (const j of rec.features) if (j.type === 'jump' || j.type === 'gap' || j.type === 'lava') {
        H.assert(!(j.meta.landingZoneX2 > f.x - 40 && j.x < f.x), tag + ' right after a ' + j.type + ' landing');
      }
      const S = byWorld[rec.worldId] = byWorld[rec.worldId] || { k46: 0, k5: 0, late: 0 };
      const eq = m.maxSlope / (rec.t._wallFricF * rec.t._gravF);   // rock-at-1-g equivalent (ability ∝ friction^0.8)
      if (f.x >= 4000 && f.x <= 6000) S.k46 = Math.max(S.k46, m.maxSlope);
      if (f.x <= 5000) S.k5 = Math.max(S.k5, eq);
    }
  }
  // the review's slope-scan targets: GV walls 40–42° (±1°) by 4–6 km; harder worlds 45–50° by 5 km
  const deg = (s) => Math.atan(s) * 180 / Math.PI;
  const gv = byWorld.green_valley;
  H.assert(gv && deg(gv.k46) >= 39 && deg(gv.k46) <= 43.5, 'green_valley walls at 4–6 km ' + fmt(deg(gv.k46), 1) + '°');
  for (const id of ['rocky_highlands', 'storm_planet', 'neon_city', 'volcanic_ridge']) {
    const S = byWorld[id];
    H.assert(S && deg(S.k5) >= 44.5 && deg(S.k5) <= 50.5, id + ' walls by 5 km ' + fmt(deg(S.k5), 1) + '° (rock equivalent)');
  }
});

H.test('requestFeature("steep", x): returns the next wall within 280 m, generating ahead without changing the course', () => {
  const t = new T({ seed: 42, world: 'rocky_highlands' });
  const ref = drive('rocky_highlands', 42, { dist: 9000, cp: false, step: 7 });
  const refWalls = ref.features.filter((f) => f.type === 'steep' && f.meta.wall);
  H.assert(refWalls.length >= 4, 'reference walls');
  H.assert(t.requestFeature('jump', 100) === null && t.requestFeature('steep', NaN) === null, 'unknown type / bad x → null');
  let x = 0, hits = 0, asks = 0;
  const rnd = lcg(99);
  while (x < 8500) {
    x += 40 + rnd() * 80;
    t.ensure(x + 160);
    if (rnd() < 0.5) {
      asks++;
      const f = t.requestFeature('steep', x + 120);
      const exp = refWalls.find((w) => w.x >= x + 120 && w.x <= x + 400);
      if (f) {
        hits++;
        H.assert(f.type === 'steep' && f.meta.wall && f.x >= x + 120 && f.x <= x + 400 && f.meta.dir === 1, 'feature in range');
        H.assert(exp && Math.abs(exp.x - f.x) < 1e-9 && exp.x2 === f.x2, 'returns the scheduled wall');
        H.assert(t._wEnd * DX > f.x2, 'ground written through the wall (coins can be placed on it)');
        H.assert(Math.abs(t.heightAt(f.meta.faceX2) - t.heightAt(f.meta.faceX) - f.meta.maxSlope * (f.meta.faceX2 - f.meta.faceX)) < 1e-6, 'heights are final');
      } else {
        H.assert(!exp || exp.x > x + 120 + 280, 'missed a wall at ' + (exp && exp.x) + ' (asked at ' + fmt(x + 120) + ')');
      }
    }
    t.trim(x - 250);
  }
  H.assert(hits >= 3 && asks > 20, 'hook hits ' + hits + '/' + asks);
  // content-neutral: the course matches a drive that never called the hook
  const probe = new T({ seed: 42, world: 'rocky_highlands' });
  probe.ensure(200);
  for (let q = 0; q < 40; q++) probe.requestFeature('steep', q * 200);
  for (let xx = 0; xx < 8500; xx += 100) probe.ensure(xx + 160);
  for (let k = idx(0); k < idx(8400); k += 3) {
    const i = k + I0;
    if (i < probe._minIdx) continue;
    H.assert(probe.pointY(i) === ref.hs[k], 'course changed at x=' + i * DX);
  }
});

H.test('boss ledges feed the collectibles contract: section.ledges on the live section and the teaser', () => {
  const t = new T({ seed: 5, world: 'green_valley' });
  const teaser = t.upcomingSection(2500);
  for (let g = 0; g < 4 && t.maxX < 3500; g++) t.ensure(3500);
  const live = t.sectionAt(3100);
  H.assert(live && live.id === 'boss' && live === teaser, 'teaser is the live section object');
  const mid = live.ledges[Math.floor(live.ledges.length / 2)];
  H.assert(mid.x > live.start + 100 && mid.x2 < live.summitX - 100, 'middle ledge in the middle of the climb');
  // the crux headwall follows the middle ledge, after ≥ 15 m of base grade
  let firstSteep = null;
  for (let x = mid.x2; x < live.summitX; x += 0.5) if (t.slopeAt(x) > 0.95) { firstSteep = x; break; }
  H.assert(firstSteep !== null && firstSteep - mid.x2 >= 15, 'headwall ' + fmt(firstSteep - mid.x2) + ' m after the middle ledge');
});

// Real physics on the real boss (no Run): an upgraded car must always be able to clear it — the
// terrain is never a soft-lock for a sufficiently upgraded vehicle — and the tier-1 crux is still a crux.
H.test('boss is passable by upgraded cars and a real test for the stock Trail Buggy (real physics)', () => {
  const RRp = H.load(['js/core/utils.js', 'js/data/vehicles.js', 'js/data/worlds.js', 'js/game/physics.js', 'js/game/terrain.js']);
  const U = RRp.Util;
  const ALL = (l) => ({ engine: l, suspension: l, tires: l, fuel: l, grip: l, air: l, brakes: l });
  function climb(world, seed, tier, vid, up) {
    const t = new RRp.Terrain({ seed, world });
    const bx = 3000 + 5000 * (tier - 1);
    for (let g = 0; g < 12 && t.maxX < bx + 600; g++) t.ensure(bx + 600);
    const boss = t.sections.find((s) => s.id === 'boss' && s.tier === tier);
    const b = new RRp.VehicleBody(RRp.Vehicles.getTuned(vid, up), 0, 0);
    b.placeOnTerrain(t, boss.start - 40); b.setVelocity(12, 0);
    const env = { terrain: t, gravity: 9.81 * RRp.Worlds.byId(world).gravity };
    let stuck = 0;
    for (let i = 0; i < 120 * 100; i++) {
      const rel = U.wrapAngle(b.angle - Math.atan(t.slopeAt(b.x)));
      let thr = 1, lean = 0;
      if (b.grounded || b.bodyContact) { if (rel > 0.5) { thr = 0.2; lean = -1; } else if (rel > 0.25) { lean = -1; thr = 0.8; } else if (rel < -0.3) lean = 1; }
      else { const err = U.wrapAngle(b.angle - Math.atan(t.slopeAt(b.x + b.vx * 0.4))); lean = U.clamp(-err * 2.5 - b.av * 0.5, -1, 1); thr = 0; }
      b.step(1 / 120, { throttle: thr, lean }, env);
      if (b.x > boss.summitX + 2) return 'clear';
      if (Math.abs(rel) > 2.2) return 'flip@' + Math.round(b.x - boss.start);
      stuck = Math.hypot(b.vx, b.vy) < 0.4 ? stuck + 1 / 120 : 0;
      if (stuck > 5) return 'stuck@' + Math.round(b.x - boss.start);
    }
    return 'timeout';
  }
  const res = [];
  for (const [world, seed] of [['green_valley', 777], ['rocky_highlands', 808]]) {
    const r1 = climb(world, seed, 1, 'rock_crawler', {});
    const r2 = climb(world, seed, 1, 'trail_buggy', { engine: 5, grip: 5 });
    const r3 = climb(world, seed, 3, 'trail_buggy', ALL(10));
    const r4 = climb(world, seed, 1, 'trail_buggy', {});
    res.push(world + ': crawler ' + r1 + ', buggy eg5 ' + r2 + ', buggy all10 t3 ' + r3 + ', stock buggy ' + r4);
    H.assert(r1 === 'clear' && r2 === 'clear' && r3 === 'clear', 'upgraded cars clear: ' + res[res.length - 1]);
    H.assert(r4 !== 'clear', 'the stock Trail Buggy should not simply cruise up: ' + res[res.length - 1]);
  }
  console.log('      ' + res.join('\n      '));
});

// ------------------------------------------------------------------ readable summary
H.test('summary', () => {
  const types = ['jump', 'gap', 'lava', 'rocks', 'steep', 'plateau', 'valley', 'bouncepad', 'boostpad', 'summit'];
  console.log('\n      feature counts (sum over ' + SEEDS.length + ' seeds × ' + DIST / 1000 + ' km) and slope maxima');
  console.log('      ' + 'world'.padEnd(16) + types.map((t) => t.slice(0, 7).padStart(8)).join('') +
    '  org/lim  ramp  trench  boss  wall  maxV');
  for (const w of WORLDS) {
    const S = summary[w.id];
    console.log('      ' + w.id.padEnd(16) + types.map((t) => String(S.counts[t] || 0).padStart(8)).join('') +
      '   ' + fmt(S.maxOrganic).padStart(5) + '  ' + fmt(S.maxDesignUp) + '   ' + fmt(S.maxTrenchUp) + '  ' + fmt(S.maxBoss) + '  ' + fmt(S.maxWall) + '  ' + fmt(S.maxV, 1));
  }
  console.log('\n      sections (seed ' + SEEDS[0] + ')');
  for (const w of WORLDS) console.log('      ' + w.id.padEnd(16) + summary[w.id].sections);
});

H.done();
