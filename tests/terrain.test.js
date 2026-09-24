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
  const out = { maxOrganic: 0, maxDesignUp: 0, maxBoss: 0, maxTrenchUp: 0, nanCount: 0, recorded: 0 };
  for (let k = 1; k < rec.hs.length; k++) {
    if (!Number.isFinite(rec.hs[k]) || !Number.isFinite(rec.hs[k - 1])) continue;
    out.recorded++;
    const s = slopeK(rec, k), fl = rec.fl[k];
    if (fl & F.DESIGN) {
      if (fl & F.TRENCH) { if (s > out.maxTrenchUp) out.maxTrenchUp = s; } else if (s > out.maxDesignUp) out.maxDesignUp = s;
    } else if (fl & F.BOSS) out.maxBoss = Math.max(out.maxBoss, Math.abs(s));
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
  t.ensure(1200);
  const before = t.upcomingSection(0);
  H.assert(before.start === s.start, 'plan is stable');
});

// ================================================================== the big drive
H.test('drive 8 worlds × 5 seeds (moving ensure/trim window)', () => {
  const t0 = nowMs();
  for (const w of WORLDS) {
    summary[w.id] = { counts: {}, maxOrganic: 0, maxDesignUp: 0, maxTrenchUp: 0, maxBoss: 0, maxV: 0, sections: '', decoGap: [] };
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

H.test('slopes ≤ maxSlope (+tol) outside flagged ramp spans; designed climbs ≤ 0.7; trench exits ≤ 0.62', () => {
  for (const rec of runs) {
    const a = rec.an;
    H.assert(a.maxOrganic <= 1 + 0.02 / 0.5, rec.worldId + '/' + rec.seed + ' organic slope ratio ' + fmt(a.maxOrganic, 3));
    H.assert(a.maxDesignUp <= 0.705, rec.worldId + '/' + rec.seed + ' designed climb ' + fmt(a.maxDesignUp, 3));
    H.assert(a.maxTrenchUp <= 0.62, rec.worldId + '/' + rec.seed + ' trench exit ' + fmt(a.maxTrenchUp, 3));
    H.assert(a.maxBoss <= 0.87, rec.worldId + '/' + rec.seed + ' boss slope ' + fmt(a.maxBoss, 3));
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
      for (let j = -2; j <= 2; j++) if (rec.fl[k + j] & (F.DESIGN | F.ROCKS)) special = true;
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
      if (f.type === 'gap') H.assert(m.depth >= 2.95 && m.depth <= 6.05, 'gap depth ' + fmt(m.depth) + ' at ' + fmt(f.x));
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

H.test('boss sections at 3000/8000/13000… with rising, climbable slope, 3–5 rest ledges and a flat summit', () => {
  for (const rec of runs) {
    const bosses = Array.from(rec.sections.values()).filter((s) => s.id === 'boss');
    const expected = [];
    for (let b = 3000; b + 600 < rec.dist; b += 5000) expected.push(b);
    H.assert(bosses.length >= expected.length, rec.worldId + '/' + rec.seed + ' boss count ' + bosses.length);
    expected.forEach((bx, n) => {
      const b = bosses[n];
      H.assert(b.start === bx && b.tier === n + 1, 'boss ' + (n + 1) + ' at ' + b.start + ' tier ' + b.tier);
      H.assert(b.name === 'BOSS RUN' && b.bossName === RR.Worlds.byId(rec.worldId).bossName, 'boss names');
      const climbEnd = b.summitX - 10;
      const len = climbEnd - b.start;
      H.assert(len >= 250 && len <= 470, 'boss climb length ' + fmt(len));
      H.assert(b.end - climbEnd >= 40, 'summit plateau ≥ 40 m');
      // summit plateau flat
      for (let k = idx(climbEnd) + 1; k <= idx(b.end); k++) H.assert(Math.abs(slopeK(rec, k)) < 0.03, 'summit flat at ' + ((k + I0) * DX));
      // ledges: flat runs 8–15 m inside the climb; pitches = the climbing runs between them
      let ledges = 0, run = 0, maxS = 0;
      const pitches = [];
      let pitch = null;
      for (let k = idx(b.start) + 1; k <= idx(climbEnd); k++) {
        const s = slopeK(rec, k);
        maxS = Math.max(maxS, Math.abs(s));
        H.assert(!(rec.fl[k] & F.DESIGN), 'no designed jumps inside the boss climb');
        H.assert(rec.fl[k] & F.BOSS, 'boss flag');
        if (Math.abs(s) < 0.03) {
          run++;
          if (pitch) { pitches.push(pitch); pitch = null; }
        } else {
          if (run * DX >= 8 && run * DX <= 16) ledges++;
          run = 0;
          if (!pitch) pitch = { a: k, b: k };
          pitch.b = k;
        }
      }
      if (pitch) pitches.push(pitch);
      H.assert(ledges >= 3 && ledges <= 5, 'rest ledges ' + ledges);
      H.assert(maxS <= 0.87, 'boss max slope ' + fmt(maxS, 3));
      // each pitch's steepest 10 m average rises toward ~0.7–0.8 by the top
      const avg = (a, bb) => (rec.hs[idx(bb)] - rec.hs[idx(a)]) / (bb - a);
      const pitchMax = pitches.filter((p) => (p.b - p.a) * DX >= 20).map((p) => {
        let m = 0;
        for (let k = p.a; k + 20 <= p.b; k++) m = Math.max(m, (rec.hs[k + 20] - rec.hs[k]) / 10);
        return m;
      });
      H.assert(pitchMax.length >= 4, 'boss pitches ' + pitchMax.length);
      const top = pitchMax[pitchMax.length - 1], bottom = pitchMax[0];
      H.assert(top >= 0.66 && top >= bottom + 0.1, 'boss steepens: pitches ' + pitchMax.map((v) => fmt(v)).join(' → '));
      for (let q = 1; q < pitchMax.length; q++) H.assert(pitchMax[q] >= pitchMax[q - 1] - 0.03, 'pitches rise monotonically: ' + pitchMax.map((v) => fmt(v)).join(' → '));
      // sustained 30 m average never exceeds 0.82
      for (let x = b.start; x + 30 <= climbEnd; x += 5) H.assert(avg(x, x + 30) <= 0.82, 'boss 30 m average ' + fmt(avg(x, x + 30)));
      const feats = rec.features.filter((f) => f.x >= b.start && f.x <= b.end);
      const summit = feats.find((f) => f.type === 'summit');
      const cp = feats.find((f) => f.type === 'checkpoint');
      H.assert(summit && cp && summit.x === b.summitX && cp.x === b.summitX, 'summit + checkpoint features at summitX');
    });
  }
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
  const spread = (rec) => { // mean height range inside 100 m windows over the first 2.6 km
    let s = 0, n = 0;
    for (let k = idx(200); k < idx(2800); k += 200) {
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < 200; j++) { lo = Math.min(lo, rec.hs[k + j]); hi = Math.max(hi, rec.hs[k + j]); }
      s += hi - lo; n++;
    }
    return s / n;
  };
  for (const w of WORLDS) {
    let sBig = 0, sBase = 0;   // aggregated over seeds: pattern placement shifts when sizes change
    for (const seed of [SEEDS[0], SEEDS[2]]) {
      const big = drive(w.id, seed, { modifiers: { terrainAmpMul: 1.6 }, cp: false, step: 5, dist: Math.min(DIST, 14000) });
      H.assert(big.problems.length === 0, w.id + ' amp 1.6: ' + big.problems.slice(0, 3).join(' | '));
      H.assert(big.jumps.fail.length === 0, w.id + ' amp 1.6 jumps: ' + big.jumps.fail.slice(0, 3).join(' | '));
      const an = analyse(big);
      H.assert(an.maxOrganic <= 1.04 && an.maxDesignUp <= 0.705 && an.maxBoss <= 0.87, w.id + ' amp 1.6 slopes');
      const base = runs.find((r) => r.worldId === w.id && r.seed === seed);
      sBig += spread(big); sBase += spread(base);
    }
    H.assert(sBig > sBase * 1.2, w.id + ' amp 1.6 not larger (' + fmt(sBig / 2) + ' vs ' + fmt(sBase / 2) + ' m per 100 m window)');
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
      const hard = f.type === 'gap' || f.type === 'rocks' || f.type === 'lava';
      if (f.x >= E0 && f.x < E1) { if (hard) early++; if (f.type === 'steep') earlySteep++; } else if (f.x >= L0 && f.x < L1) { if (hard) late++; if (f.type === 'steep') lateSteep++; }
    }
  }
  const rE = (E1 - E0), rL = (L1 - L0);
  H.assert(late / rL > 1.3 * early / rE, 'hard features early ' + early + '/' + rE + ' m vs late ' + late + '/' + rL + ' m');
  H.assert(lateSteep / rL > earlySteep / rE, 'steep stretches early ' + earlySteep + ' vs late ' + lateSteep);
});

// ------------------------------------------------------------------ readable summary
H.test('summary', () => {
  const types = ['jump', 'gap', 'lava', 'rocks', 'steep', 'plateau', 'valley', 'bouncepad', 'boostpad', 'summit'];
  console.log('\n      feature counts (sum over ' + SEEDS.length + ' seeds × ' + DIST / 1000 + ' km) and slope maxima');
  console.log('      ' + 'world'.padEnd(16) + types.map((t) => t.slice(0, 7).padStart(8)).join('') +
    '  org/lim  ramp  trench  boss  maxV');
  for (const w of WORLDS) {
    const S = summary[w.id];
    console.log('      ' + w.id.padEnd(16) + types.map((t) => String(S.counts[t] || 0).padStart(8)).join('') +
      '   ' + fmt(S.maxOrganic).padStart(5) + '  ' + fmt(S.maxDesignUp) + '   ' + fmt(S.maxTrenchUp) + '  ' + fmt(S.maxBoss) + '  ' + fmt(S.maxV, 1));
  }
  console.log('\n      sections (seed ' + SEEDS[0] + ')');
  for (const w of WORLDS) console.log('      ' + w.id.padEnd(16) + summary[w.id].sections);
});

H.done();
