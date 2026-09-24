/* RIDGE RUSH — frame renderer (RR.Renderer).
 *
 * Contract: docs/ARCHITECTURE.md §5.7. Owns the game canvas and draws one full frame of a Run:
 *
 *   [screen] sky + parallax (RR.Background)
 *   [world]  back decorations → terrain (strata, pebbles, surface band + per-surface detail, lava pools,
 *            distance posts, BEST flag, cave ceiling) → collectibles → events (world) → particles →
 *            vehicle (contact shadow + RR.VehicleArt) → front decorations
 *   [screen] darkness / headlight overlay → env tint → weather → float text → events (screen) →
 *            slow-time vignette → low-fuel vignette → crash flash
 *
 * Deviation from the contract's screen-pass order (documented): darkness and tint are applied BEFORE
 * float text / events (screen) and weather, so score popups and hazard warnings stay readable inside dark
 * caves; the vignettes and crash flash still come last.
 *
 * Terrain: filled polygons over the visible sample range (decimated when zoomed out / on LOW), strata that
 * follow the ground contour (vertical offsets + seeded noise), pebbles hashed by world x (nothing shimmers),
 * and a thick top band per surface run (grass tufts, snow sparkle, sand ripples, rock strata, glowing ash
 * embers, regolith craters, metal plates, neon grid, crystal facets, mud gloss, ice sheen).
 * Glows use pre-rendered sprites (RR.Particles.glowSprite) with 'lighter' compositing — no shadowBlur.
 * Screen gradients (vignettes, darkness cut-outs) are cached as unit gradients and positioned via transforms.
 *
 * The renderer is defensive: any missing run field or module is skipped (partial mocks render fine), and
 * other modules' draw calls are wrapped so one faulty module can't blank the frame (logged once).
 *
 * Contract additions (callers may ignore):
 *  - r.quality, r.time (animation clock used for the last frame).
 *  - resize() returns true when the backing store changed; cheap no-op otherwise.
 *  - RR.Renderer.drawDecoration(ctx, deco, world, t, zoom) — static painter (WORLD transform, y-up metres,
 *    deco {x, y, type, scale, variant}) shared with RR.Background.drawThumbnail.
 *  - RR.Renderer.DECORATION_TYPES — every decoration type with a dedicated painter.
 *  - Reads (all optional): run.env.tint as a CSS colour string ('#rrggbb' → 18 % overlay, 'rgba(..)' used
 *    as-is) or {color, alpha}; run.specialActive / run.thrusterActive (bool) → ion thruster plume;
 *    run.boostActive or powerUps.isActive('boost') → boost flames; run.controls.throttle | run.throttle →
 *    engine shimmy; run.crashTime is not required (the flash is timed from the state change).
 *  - If run.camera has setViewport() and its viewport differs from the canvas size, drawRun() syncs it so
 *    worldToScreen() matches the world transform.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum;
  const clamp = U.clamp;
  const DX = (RR.CONST && RR.CONST.TERRAIN_DX) || 0.5;
  const DPR_CAP = { low: 1, medium: 1.5, high: 2 };
  const EMPTY = Object.freeze({});

  function makeCanvas(w, h) {
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
      return c.getContext ? c : null;
    } catch (e) { return null; }
  }
  function mixHex(a, b, t) {
    const x = U.hexToRgb(a), y = U.hexToRgb(b);
    t = clamp(t, 0, 1);
    const h = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
    return '#' + h(U.lerp(x.r, y.r, t)) + h(U.lerp(x.g, y.g, t)) + h(U.lerp(x.b, y.b, t));
  }
  const glow = (c) => (RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite(c) : null);
  // Safe power-up query (the PowerUps module may be absent or mocked).
  function puActive(pu, id) {
    try { return !!(pu && typeof pu.isActive === 'function' && pu.isActive(id)); } catch (e) { return false; }
  }
  // fractional part in [0, 1) — safe for negative inputs (unlike `% 1`), so derived radii never go negative
  const frac = (v) => { const f = v - Math.floor(v); return f === f ? f : 0; };
  // 0..1 hash of an integer cell (deterministic per world x → no shimmer while scrolling)
  const h01 = (a, b) => U.hash2(a | 0, b | 0) / 4294967296;

  // ------------------------------------------------------------------ surface styles
  // band: top-band thickness (m); top/dark/hi colours for surfaces that aren't the world's main surface
  const SURF = {
    grass: { top: '#63c33c', dark: '#3f9a2a', hi: '#a4ec74', band: 0.5 },
    dirt: { top: '#a07448', dark: '#7a5534', hi: '#c89a6c', band: 0.42 },
    rock: { top: '#9a958c', dark: '#6f6a62', hi: '#cdc8bf', band: 0.36 },
    sand: { top: '#eabd73', dark: '#d19b52', hi: '#fbe3ad', band: 0.5 },
    snow: { top: '#f6f9ff', dark: '#cfdcee', hi: '#ffffff', band: 0.62 },
    ice: { top: '#c4e8ff', dark: '#8cc4ec', hi: '#f4fcff', band: 0.45 },
    ash: { top: '#4a3634', dark: '#2a1c1c', hi: '#6e5652', band: 0.4 },
    lava: { top: '#ff8a2a', dark: '#c2300f', hi: '#ffd76a', band: 0.4 },
    regolith: { top: '#c1c5d1', dark: '#9296a4', hi: '#e6e9f1', band: 0.4 },
    metal: { top: '#6f7fa8', dark: '#4c5a80', hi: '#b3c2e6', band: 0.36 },
    neon: { top: '#1ff2ff', dark: '#0e9fc2', hi: '#d4ffff', band: 0.34 },
    crystal: { top: '#7fe0e8', dark: '#4aa9c0', hi: '#e2ffff', band: 0.42 },
    mud: { top: '#5c4331', dark: '#3f2d20', hi: '#86684f', band: 0.42 }
  };
  const SURF_KEYS_FALLBACK = Object.keys(RR.SURFACES || SURF);
  function surfKeys() {
    return (RR.Terrain && RR.Terrain.SURFACE_TYPES) || SURF_KEYS_FALLBACK;
  }

  // Per-world derived colours (cached by world object).
  const worldColorCache = new WeakMap();
  function worldColors(world) {
    let c = worldColorCache.get(world);
    if (c) return c;
    const P = (world && world.palette) || {};
    const ground = P.ground || '#7b5331', deep = P.groundDeep || '#4a301f';
    const foliage = mixHex(P.groundTopDark || '#3f9a2a', P.near || '#4d8a3b', 0.45);
    const rock = P.rock || '#8c8a82';
    const surf = {};
    for (const k of Object.keys(SURF)) surf[k] = SURF[k];
    const main = world && world.surface && SURF[world.surface] ? world.surface : 'dirt';
    surf[main] = {
      top: P.groundTop || SURF[main].top, dark: P.groundTopDark || SURF[main].dark,
      hi: mixHex(P.groundTop || SURF[main].top, '#ffffff', 0.35), band: SURF[main].band
    };
    c = {
      P, ground, deep, surf, main,
      strata: [mixHex(ground, deep, 0.35), mixHex(ground, deep, 0.68), mixHex(deep, '#000000', 0.2)],
      strataLine: mixHex(ground, '#ffffff', 0.18),
      pebble: [mixHex(ground, rock, 0.55), mixHex(deep, rock, 0.35)],
      pebbleHi: mixHex(rock, '#ffffff', 0.25),
      cave: mixHex(deep, '#000000', 0.45), caveRim: mixHex(deep, rock, 0.4), caveHi: mixHex(rock, '#ffffff', 0.1),
      caveBack: mixHex(deep, '#000000', 0.62), caveWall: mixHex(deep, '#000000', 0.48), caveWallNear: mixHex(deep, '#000000', 0.35),
      caveVein: mixHex(P.accent || '#ffd34d', deep, 0.45),
      foliage, foliageDark: mixHex(foliage, '#000000', 0.28), foliageLight: mixHex(foliage, '#ffffff', 0.22),
      pine: mixHex(P.near || '#2f5f3a', '#1d4a3a', 0.5), trunk: '#6b4a2f', trunkDark: '#4a3120',
      rock, rockDark: mixHex(rock, '#000000', 0.32), rockLight: mixHex(rock, '#ffffff', 0.28),
      accent: P.accent || '#ffd34d', hazard: P.hazard || '#ff6a1f',
      dark: mixHex(deep, '#05060c', 0.7),
      sky: P.skyTop || '#3d8fdc'
    };
    worldColorCache.set(world, c);
    return c;
  }

  // ------------------------------------------------------------------ decoration painters (WORLD, y-up)
  // Each: (ctx, x, y, s, v, t, C) — ground point (x, y), scale s, variant v (0..3), time t, world colours C.
  function additive(ctx, color, x, y, r, a) {
    const g = glow(color);
    if (!g || a <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(g, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function disc(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function tri(ctx, x0, y0, x1, y1, x2, y2) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); }

  function pineShape(ctx, x, y, s, v, C, snow) {
    const hgt = s * (3.2 + v * 0.35);
    ctx.fillStyle = C.trunkDark;
    ctx.fillRect(x - 0.1 * s, y - 0.1, 0.2 * s, hgt * 0.3 + 0.1);
    for (let k = 0; k < 3; k++) {
      const by = y + hgt * (0.18 + k * 0.24), w = s * (1.05 - k * 0.25), th = hgt * 0.42;
      ctx.fillStyle = C.pine;
      ctx.beginPath(); tri(ctx, x - w, by, x + w, by, x, by + th); ctx.fill();
      ctx.fillStyle = mixHexCached(C.pine, 0.18);
      ctx.beginPath(); tri(ctx, x - w, by, x - w * 0.1, by, x, by + th); ctx.fill();
      if (snow) {
        ctx.fillStyle = '#f7fbff';
        ctx.beginPath();
        tri(ctx, x - w * 0.42, by + th * 0.58, x + w * 0.42, by + th * 0.58, x, by + th);
        ctx.moveTo(x - w, by); ctx.lineTo(x - w * 0.55, by + th * 0.12); ctx.lineTo(x - w * 0.2, by + 0.02); ctx.closePath();
        ctx.fill();
      }
    }
  }
  const lightCache = new Map();
  function mixHexCached(c, t) {
    const k = c + t;
    let v = lightCache.get(k);
    if (!v) { v = mixHex(c, '#ffffff', t); if (lightCache.size < 256) lightCache.set(k, v); }
    return v;
  }
  function rockShape(ctx, x, y, s, v, C, big) {
    const w = s * (big ? 1.25 : 0.62) * (1 + v * 0.08), h = s * (big ? 1.2 : 0.5) * (1 + ((v * 3) % 4) * 0.07);
    ctx.fillStyle = C.rock;
    ctx.beginPath();
    ctx.moveTo(x - w, y - 0.05);
    ctx.lineTo(x - w * 0.85, y + h * 0.55);
    ctx.lineTo(x - w * 0.3, y + h);
    ctx.lineTo(x + w * 0.35, y + h * 0.92);
    ctx.lineTo(x + w * 0.9, y + h * 0.45);
    ctx.lineTo(x + w, y - 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.rockLight;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.85, y + h * 0.55);
    ctx.lineTo(x - w * 0.3, y + h);
    ctx.lineTo(x + w * 0.35, y + h * 0.92);
    ctx.lineTo(x - w * 0.1, y + h * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.rockDark;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.9, y + h * 0.45);
    ctx.lineTo(x + w, y - 0.05);
    ctx.lineTo(x + w * 0.2, y - 0.05);
    ctx.lineTo(x + w * 0.4, y + h * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  const DECOR = {
    tree(ctx, x, y, s, v, t, C) {
      const hg = s * (1 + v * 0.1);
      ctx.fillStyle = C.trunk;
      ctx.fillRect(x - 0.13 * s, y - 0.1, 0.26 * s, 1.5 * hg + 0.1);
      const sway = Math.sin(t * 0.9 + x * 0.37) * 0.04 * s;
      ctx.fillStyle = C.foliageDark;
      ctx.beginPath();
      disc(ctx, x - 0.62 * s + sway, y + 1.55 * hg, 0.68 * s);
      disc(ctx, x + 0.64 * s + sway, y + 1.6 * hg, 0.72 * s);
      ctx.fill();
      ctx.fillStyle = C.foliage;
      ctx.beginPath();
      disc(ctx, x + sway, y + 2.05 * hg, 0.92 * s);
      disc(ctx, x - 0.45 * s + sway, y + 1.75 * hg, 0.6 * s);
      ctx.fill();
      ctx.fillStyle = C.foliageLight;
      ctx.beginPath();
      disc(ctx, x - 0.25 * s + sway, y + 2.35 * hg, 0.42 * s);
      ctx.fill();
    },
    bush(ctx, x, y, s, v, t, C) {
      ctx.fillStyle = C.foliageDark;
      ctx.beginPath();
      disc(ctx, x - 0.4 * s, y + 0.3 * s, 0.42 * s);
      disc(ctx, x + 0.42 * s, y + 0.28 * s, 0.4 * s);
      ctx.fill();
      ctx.fillStyle = C.foliage;
      ctx.beginPath();
      disc(ctx, x, y + 0.45 * s, 0.5 * s);
      ctx.fill();
      if (v & 1) {
        ctx.fillStyle = v === 1 ? '#ff6fa8' : '#fff4a3';
        ctx.beginPath();
        disc(ctx, x - 0.2 * s, y + 0.7 * s, 0.07 * s);
        disc(ctx, x + 0.25 * s, y + 0.55 * s, 0.07 * s);
        disc(ctx, x + 0.5 * s, y + 0.35 * s, 0.06 * s);
        ctx.fill();
      }
    },
    rock(ctx, x, y, s, v, t, C) { rockShape(ctx, x, y, s, v, C, false); },
    boulder(ctx, x, y, s, v, t, C) {
      rockShape(ctx, x, y, s, v, C, true);
      ctx.strokeStyle = C.rockDark;
      ctx.lineWidth = 0.05 * s;
      ctx.beginPath();
      ctx.moveTo(x + 0.1 * s, y + 1.05 * s);
      ctx.lineTo(x + 0.25 * s, y + 0.6 * s);
      ctx.lineTo(x + 0.1 * s, y + 0.3 * s);
      ctx.stroke();
      ctx.fillStyle = C.foliage;
      ctx.beginPath();
      ctx.ellipse(x - 0.45 * s, y + 1.02 * s, 0.35 * s, 0.1 * s, 0.3, 0, TAU);
      ctx.fill();
    },
    flowers(ctx, x, y, s, v, t, C) {
      ctx.strokeStyle = C.foliageDark;
      ctx.lineWidth = 0.04 * s;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const fx = x + (k - 2) * 0.22 * s, fh = (0.35 + ((k * 7 + v) % 4) * 0.08) * s;
        ctx.moveTo(fx, y); ctx.lineTo(fx + Math.sin(t * 1.5 + k) * 0.03, y + fh);
      }
      ctx.stroke();
      const cols = FLOWER_COLS;
      for (let k = 0; k < 5; k++) {
        const fx = x + (k - 2) * 0.22 * s, fh = (0.35 + ((k * 7 + v) % 4) * 0.08) * s;
        ctx.fillStyle = cols[(k + v) % cols.length];
        ctx.beginPath(); disc(ctx, fx + Math.sin(t * 1.5 + k) * 0.03, y + fh, 0.085 * s); ctx.fill();
      }
    },
    fence(ctx, x, y, s, v, t, C) {
      const half = 1.4 * s;
      ctx.fillStyle = '#7a5534';
      ctx.fillRect(x - half, y - 0.1, 0.14 * s, 1.1 * s + 0.1);
      ctx.fillRect(x + half - 0.14 * s, y - 0.1, 0.14 * s, 1.1 * s + 0.1);
      ctx.fillRect(x - 0.07 * s, y - 0.1, 0.14 * s, 1.0 * s + 0.1);
      ctx.fillStyle = '#b3824f';
      ctx.fillRect(x - half - 0.1 * s, y + 0.75 * s, half * 2 + 0.2 * s, 0.13 * s);
      ctx.fillRect(x - half - 0.1 * s, y + 0.38 * s, half * 2 + 0.2 * s, 0.13 * s);
    },
    pine(ctx, x, y, s, v, t, C) { pineShape(ctx, x, y, s, v, C, false); },
    pine_snow(ctx, x, y, s, v, t, C) { pineShape(ctx, x, y, s, v, C, true); },
    cairn(ctx, x, y, s, v, t, C) {
      const sizes = CAIRN;
      let yy = y;
      for (let k = 0; k < 4; k++) {
        const w = sizes[k] * s, hh = w * 0.42;
        ctx.fillStyle = k & 1 ? C.rockLight : C.rock;
        ctx.beginPath();
        ctx.ellipse(x + ((k * 5 + v) % 3 - 1) * 0.04 * s, yy + hh, w, hh, 0, 0, TAU);
        ctx.fill();
        yy += hh * 1.7;
      }
    },
    cactus(ctx, x, y, s, v, t, C) {
      const hg = (2.2 + v * 0.25) * s;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3f8a45';
      ctx.lineWidth = 0.42 * s;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + hg);
      ctx.moveTo(x, y + hg * 0.45); ctx.lineTo(x - 0.55 * s, y + hg * 0.45); ctx.lineTo(x - 0.55 * s, y + hg * 0.75);
      if (v !== 2) { ctx.moveTo(x, y + hg * 0.6); ctx.lineTo(x + 0.5 * s, y + hg * 0.6); ctx.lineTo(x + 0.5 * s, y + hg * 0.88); }
      ctx.stroke();
      ctx.strokeStyle = '#6cc26a';
      ctx.lineWidth = 0.07 * s;
      ctx.beginPath();
      ctx.moveTo(x - 0.08 * s, y + 0.1); ctx.lineTo(x - 0.08 * s, y + hg);
      ctx.stroke();
    },
    mesa(ctx, x, y, s, v, t, C) {
      const w = 2.2 * s, hg = (2.4 + v * 0.3) * s;
      ctx.fillStyle = C.rock;
      ctx.beginPath();
      ctx.moveTo(x - w, y - 0.1); ctx.lineTo(x - w * 0.72, y + hg); ctx.lineTo(x + w * 0.66, y + hg); ctx.lineTo(x + w, y - 0.1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.rockLight;
      ctx.fillRect(x - w * 0.72, y + hg - 0.2 * s, w * 1.38, 0.2 * s);
      ctx.fillRect(x - w * 0.85, y + hg * 0.5, w * 1.66, 0.14 * s);
      ctx.fillStyle = C.rockDark;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.66, y + hg); ctx.lineTo(x + w, y - 0.1); ctx.lineTo(x + w * 0.6, y - 0.1); ctx.lineTo(x + w * 0.4, y + hg);
      ctx.closePath(); ctx.fill();
    },
    tumbleweed(ctx, x, y, s, v, t, C) {
      const r = 0.45 * s, cy = y + r;
      const rot = t * 0.6 + x;
      ctx.strokeStyle = '#b8925a';
      ctx.lineWidth = 0.045 * s;
      ctx.beginPath();
      disc(ctx, x, cy, r);
      for (let k = 0; k < 3; k++) ctx.ellipse(x, cy, r * 0.9, r * 0.35, rot + k * 1.05, 0, TAU);
      ctx.stroke();
    },
    bones(ctx, x, y, s, v, t, C) {
      ctx.fillStyle = '#efe6d2';
      ctx.strokeStyle = '#efe6d2';
      ctx.lineWidth = 0.07 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      disc(ctx, x - 0.5 * s, y + 0.22 * s, 0.22 * s);
      ctx.fill();
      ctx.fillStyle = '#5a4630';
      ctx.beginPath(); disc(ctx, x - 0.44 * s, y + 0.26 * s, 0.05 * s); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 0.25 * s, y + 0.1 * s); ctx.lineTo(x + 0.7 * s, y + 0.1 * s);
      for (let k = 0; k < 4; k++) { const rx = x + k * 0.2 * s; ctx.moveTo(rx, y + 0.1 * s); ctx.quadraticCurveTo(rx + 0.1 * s, y + 0.45 * s, rx + 0.18 * s, y + 0.05); }
      ctx.stroke();
    },
    ice_crystal(ctx, x, y, s, v, t, C) {
      additive(ctx, '#9ff3ff', x, y + 0.6 * s, 1.4 * s, 0.35 + 0.1 * Math.sin(t * 2 + x));
      const shards = ICE_SHARDS;
      for (let k = 0; k < shards.length; k += 3) {
        const a = shards[k] + v * 0.05, hg = shards[k + 1] * s, w = shards[k + 2] * s;
        const tx = x + Math.sin(a) * hg, ty = y + Math.cos(a) * hg;
        const px = Math.cos(a) * w, py = -Math.sin(a) * w;
        ctx.fillStyle = 'rgba(190,240,255,0.85)';
        ctx.beginPath(); tri(ctx, x - px, y - py, x + px, y + py, tx, ty); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); tri(ctx, x - px, y - py, x, y, tx, ty); ctx.fill();
      }
    },
    snow_mound(ctx, x, y, s, v, t, C) {
      ctx.fillStyle = '#f7fbff';
      ctx.beginPath(); ctx.ellipse(x, y, 1.2 * s, 0.55 * s, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = 'rgba(150,185,225,0.45)';
      ctx.beginPath(); ctx.ellipse(x + 0.35 * s, y, 0.8 * s, 0.35 * s, 0, 0, Math.PI * 0.5); ctx.lineTo(x + 0.35 * s, y); ctx.fill();
    },
    lava_rock(ctx, x, y, s, v, t, C) {
      rockShape(ctx, x, y, s * 1.1, v, LAVA_ROCK, false);
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.4 + x);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = C.hazard;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 0.05 * s;
      ctx.beginPath();
      ctx.moveTo(x - 0.4 * s, y + 0.1 * s); ctx.lineTo(x - 0.1 * s, y + 0.3 * s); ctx.lineTo(x + 0.25 * s, y + 0.2 * s);
      ctx.moveTo(x - 0.1 * s, y + 0.3 * s); ctx.lineTo(x - 0.05 * s, y + 0.5 * s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      additive(ctx, C.hazard, x - 0.05 * s, y + 0.3 * s, 0.6 * s, 0.35 * pulse);
    },
    dead_tree(ctx, x, y, s, v, t, C) {
      ctx.strokeStyle = '#3a2a26';
      ctx.lineCap = 'round';
      const hg = (2.4 + v * 0.3) * s;
      ctx.lineWidth = 0.22 * s;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1 * s, y + hg); ctx.stroke();
      ctx.lineWidth = 0.1 * s;
      ctx.beginPath();
      ctx.moveTo(x + 0.05 * s, y + hg * 0.55); ctx.lineTo(x - 0.7 * s, y + hg * 0.85); ctx.lineTo(x - 0.9 * s, y + hg * 0.8);
      ctx.moveTo(x + 0.08 * s, y + hg * 0.7); ctx.lineTo(x + 0.75 * s, y + hg * 1.0);
      ctx.moveTo(x + 0.45 * s, y + hg * 0.85); ctx.lineTo(x + 0.55 * s, y + hg * 1.1);
      ctx.stroke();
    },
    vent(ctx, x, y, s, v, t, C) {
      ctx.fillStyle = '#2a1c1c';
      ctx.beginPath();
      ctx.moveTo(x - 0.8 * s, y - 0.1); ctx.lineTo(x - 0.3 * s, y + 0.9 * s); ctx.lineTo(x + 0.3 * s, y + 0.9 * s); ctx.lineTo(x + 0.8 * s, y - 0.1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff9a3a';
      ctx.beginPath(); ctx.ellipse(x, y + 0.9 * s, 0.3 * s, 0.08 * s, 0, 0, TAU); ctx.fill();
      additive(ctx, C.hazard, x, y + 0.95 * s, 0.9 * s, 0.6 + 0.2 * Math.sin(t * 3 + x));
      ctx.fillStyle = '#6b5a58';
      for (let k = 0; k < 4; k++) {
        const ph = frac(t * 0.35 + k / 4 + x * 0.37);
        ctx.globalAlpha = 0.45 * (1 - ph);
        ctx.beginPath();
        disc(ctx, x + ph * ph * 0.8 * s, y + (1.1 + ph * 2.6) * s, (0.2 + ph * 0.55) * s);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    crater(ctx, x, y, s, v, t, C) {
      ctx.fillStyle = C.rockDark;
      ctx.beginPath(); ctx.ellipse(x, y + 0.02, 1.3 * s, 0.22 * s, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.rockLight;
      ctx.lineWidth = 0.09 * s;
      ctx.beginPath(); ctx.ellipse(x, y + 0.04, 1.35 * s, 0.26 * s, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = C.rock;
      ctx.beginPath();
      ctx.ellipse(x - 1.35 * s, y, 0.3 * s, 0.18 * s, 0, 0, Math.PI);
      ctx.ellipse(x + 1.35 * s, y, 0.3 * s, 0.18 * s, 0, 0, Math.PI);
      ctx.fill();
    },
    antenna(ctx, x, y, s, v, t, C) {
      const hg = 3.2 * s;
      ctx.strokeStyle = '#9aa3b5';
      ctx.lineWidth = 0.08 * s;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + hg);
      ctx.moveTo(x - 0.5 * s, y); ctx.lineTo(x, y + hg * 0.6); ctx.lineTo(x + 0.5 * s, y);
      ctx.stroke();
      ctx.fillStyle = '#c9d0de';
      ctx.beginPath();
      ctx.ellipse(x + 0.1 * s, y + hg * 0.78, 0.45 * s, 0.2 * s, -0.6, 0, Math.PI);
      ctx.fill();
      if (Math.sin(t * 3 + x) > 0) additive(ctx, '#ff3b3b', x, y + hg, 0.5 * s, 0.9);
      ctx.fillStyle = '#ff5050';
      ctx.beginPath(); disc(ctx, x, y + hg, 0.07 * s); ctx.fill();
    },
    dome(ctx, x, y, s, v, t, C) {
      const r = 1.5 * s;
      ctx.fillStyle = '#5d6478';
      ctx.fillRect(x - r * 1.1, y - 0.1, r * 2.2, 0.35 * s + 0.1);
      ctx.fillStyle = 'rgba(150,215,255,0.35)';
      ctx.beginPath(); ctx.arc(x, y + 0.3 * s, r, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#aeb7c9';
      ctx.lineWidth = 0.06 * s;
      ctx.beginPath();
      ctx.arc(x, y + 0.3 * s, r, 0, Math.PI);
      ctx.moveTo(x, y + 0.3 * s); ctx.lineTo(x, y + 0.3 * s + r);
      ctx.ellipse(x, y + 0.3 * s, r * 0.5, r, 0, 0, Math.PI);
      ctx.moveTo(x - r * 0.87, y + 0.3 * s + r * 0.5); ctx.lineTo(x + r * 0.87, y + 0.3 * s + r * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(x - 0.3 * s, y + 0.3 * s, 0.6 * s, 0.5 * s);
      additive(ctx, '#ffd98a', x, y + 0.6 * s, 1.1 * s, 0.5);
    },
    flag(ctx, x, y, s, v, t, C, world) {
      const hg = 2.4 * s;
      ctx.fillStyle = '#c9d0de';
      ctx.fillRect(x - 0.04 * s, y - 0.1, 0.08 * s, hg + 0.1);
      const stiff = world && world.id === 'moon_base';
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.moveTo(x, y + hg);
      for (let k = 0; k <= 6; k++) {
        const fx = x + k * 0.18 * s, wv = stiff ? 0 : Math.sin(t * 5 - k * 0.9) * 0.06 * s * k / 6;
        ctx.lineTo(fx, y + hg + wv);
      }
      for (let k = 6; k >= 0; k--) {
        const fx = x + k * 0.18 * s, wv = stiff ? 0 : Math.sin(t * 5 - k * 0.9) * 0.06 * s * k / 6;
        ctx.lineTo(fx, y + hg - 0.65 * s + wv);
      }
      ctx.closePath();
      ctx.fill();
      // emblem: white chevron + dot (original mark, no real-world flag)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x + 0.18 * s, y + hg - 0.52 * s); ctx.lineTo(x + 0.45 * s, y + hg - 0.33 * s); ctx.lineTo(x + 0.18 * s, y + hg - 0.14 * s);
      ctx.lineTo(x + 0.28 * s, y + hg - 0.33 * s); ctx.closePath();
      ctx.moveTo(x + 0.82 * s, y + hg - 0.33 * s); ctx.arc(x + 0.72 * s, y + hg - 0.33 * s, 0.1 * s, 0, TAU);
      ctx.fill();
      if (stiff) { ctx.fillStyle = '#c9d0de'; ctx.fillRect(x, y + hg - 0.02, 1.1 * s, 0.05 * s); }
    },
    neon_sign(ctx, x, y, s, v, t, C) {
      const c1 = v & 1 ? '#1ff2ff' : '#ff2fd0', c2 = v & 1 ? '#ff2fd0' : '#ffe45c';
      ctx.fillStyle = '#1b1233';
      ctx.fillRect(x - 0.06 * s, y - 0.1, 0.12 * s, 2.2 * s);
      ctx.fillRect(x - 0.9 * s, y + 2.1 * s, 1.8 * s, 1.1 * s);
      const flick = (Math.sin(t * 13 + x) > -0.92 ? 1 : 0.25) * (0.85 + 0.15 * Math.sin(t * 3));
      additive(ctx, c1, x, y + 2.65 * s, 1.6 * s, 0.5 * flick);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flick;
      ctx.strokeStyle = c1;
      ctx.lineWidth = 0.07 * s;
      ctx.strokeRect(x - 0.82 * s, y + 2.18 * s, 1.64 * s, 0.94 * s);
      ctx.strokeStyle = c2;
      ctx.lineWidth = 0.1 * s;
      ctx.beginPath();
      // abstract glyphs (no text): three bars and a chevron
      ctx.moveTo(x - 0.55 * s, y + 2.4 * s); ctx.lineTo(x - 0.55 * s, y + 2.9 * s);
      ctx.moveTo(x - 0.3 * s, y + 2.4 * s); ctx.lineTo(x - 0.05 * s, y + 2.9 * s); ctx.lineTo(x + 0.2 * s, y + 2.4 * s);
      ctx.moveTo(x + 0.45 * s, y + 2.4 * s); ctx.lineTo(x + 0.45 * s, y + 2.9 * s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    lamp(ctx, x, y, s, v, t, C) {
      const hg = 3.4 * s;
      ctx.strokeStyle = '#3b2b6b';
      ctx.lineWidth = 0.12 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + hg); ctx.quadraticCurveTo(x, y + hg + 0.3 * s, x + 0.6 * s, y + hg + 0.2 * s);
      ctx.stroke();
      ctx.fillStyle = '#fff0c2';
      ctx.fillRect(x + 0.45 * s, y + hg + 0.05 * s, 0.4 * s, 0.1 * s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,220,150,0.12)';
      ctx.beginPath(); tri(ctx, x + 0.5 * s, y + hg, x + 0.65 * s - 1.2 * s, y, x + 0.65 * s + 1.2 * s, y); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      additive(ctx, '#ffd98a', x + 0.65 * s, y + hg + 0.05 * s, 0.9 * s, 0.85);
    },
    billboard(ctx, x, y, s, v, t, C) {
      const w = 3.2 * s, hb = 1.6 * s, by = y + 2.2 * s;
      ctx.fillStyle = '#2f1864';
      ctx.fillRect(x - w * 0.35, y - 0.1, 0.14 * s, 2.3 * s);
      ctx.fillRect(x + w * 0.3, y - 0.1, 0.14 * s, 2.3 * s);
      ctx.fillStyle = v & 1 ? '#ff2fd0' : '#6a1a9a';
      ctx.fillRect(x - w / 2, by, w, hb);
      ctx.fillStyle = v & 1 ? '#ffe45c' : '#1ff2ff';
      ctx.beginPath();
      disc(ctx, x - w * 0.25, by + hb * 0.5, hb * 0.3);
      ctx.fill();
      ctx.fillRect(x, by + hb * 0.55, w * 0.35, hb * 0.12);
      ctx.fillRect(x, by + hb * 0.3, w * 0.25, hb * 0.1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#1ff2ff';
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 4 + x);
      ctx.lineWidth = 0.08 * s;
      ctx.strokeRect(x - w / 2, by, w, hb);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    tower(ctx, x, y, s, v, t, C) {
      const hg = 7 * s, w = 0.9 * s;
      ctx.strokeStyle = '#4a3a86';
      ctx.lineWidth = 0.1 * s;
      ctx.beginPath();
      ctx.moveTo(x - w, y); ctx.lineTo(x - 0.1 * s, y + hg);
      ctx.moveTo(x + w, y); ctx.lineTo(x + 0.1 * s, y + hg);
      for (let k = 0; k < 6; k++) {
        const a = k / 6, b = (k + 1) / 6;
        const wa = U.lerp(w, 0.1 * s, a), wb = U.lerp(w, 0.1 * s, b);
        ctx.moveTo(x - wa, y + hg * a); ctx.lineTo(x + wb, y + hg * b);
        ctx.moveTo(x + wa, y + hg * a); ctx.lineTo(x - wb, y + hg * b);
      }
      ctx.stroke();
      const on = Math.sin(t * 2.2 + x) > 0.2;
      if (on) additive(ctx, '#ff2f6d', x, y + hg + 0.1 * s, 0.9 * s, 0.9);
      ctx.fillStyle = on ? '#ff6b8e' : '#7a2a40';
      ctx.beginPath(); disc(ctx, x, y + hg + 0.1 * s, 0.1 * s); ctx.fill();
    },
    crystal(ctx, x, y, s, v, t, C) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.8 + x * 0.7);
      additive(ctx, C.accent, x, y + 0.9 * s, 1.8 * s, 0.35 * pulse);
      const spec = CRYSTALS;
      for (let k = 0; k < spec.length; k += 4) {
        const ox = spec[k] * s, hg = spec[k + 1] * s * (1 + v * 0.06), w = spec[k + 2] * s, lean = spec[k + 3];
        const bx = x + ox, tx = bx + lean * hg, ty = y + hg;
        ctx.fillStyle = k === 4 ? '#b44dff' : '#5fd8f0';
        ctx.beginPath();
        ctx.moveTo(bx - w, y - 0.05); ctx.lineTo(bx - w * 0.8 + lean * hg * 0.8, y + hg * 0.8); ctx.lineTo(tx, ty);
        ctx.lineTo(bx + w * 0.8 + lean * hg * 0.8, y + hg * 0.8); ctx.lineTo(bx + w, y - 0.05);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(bx - w, y - 0.05); ctx.lineTo(bx - w * 0.8 + lean * hg * 0.8, y + hg * 0.8); ctx.lineTo(tx, ty); ctx.lineTo(bx, y);
        ctx.closePath(); ctx.fill();
      }
    },
    alien_plant(ctx, x, y, s, v, t, C) {
      const sway = Math.sin(t * 1.3 + x) * 0.25 * s;
      const hg = (1.8 + v * 0.3) * s;
      ctx.strokeStyle = '#3f6b5a';
      ctx.lineWidth = 0.13 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 0.4 * s, y + hg * 0.4, x + 0.4 * s + sway, y + hg * 0.7, x + sway, y + hg);
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 0.5 * s, y + hg * 0.3, x + 0.7 * s + sway * 0.5, y + hg * 0.55);
      ctx.stroke();
      const pulse = 0.7 + 0.3 * Math.sin(t * 2.5 + x * 1.3);
      additive(ctx, '#b44dff', x + sway, y + hg, 0.9 * s, 0.6 * pulse);
      additive(ctx, C.accent, x + 0.7 * s + sway * 0.5, y + hg * 0.55, 0.6 * s, 0.5 * pulse);
      ctx.fillStyle = '#d6a4ff';
      ctx.beginPath();
      disc(ctx, x + sway, y + hg, 0.2 * s);
      ctx.fill();
      ctx.fillStyle = '#b7fbff';
      ctx.beginPath();
      disc(ctx, x + 0.7 * s + sway * 0.5, y + hg * 0.55, 0.13 * s);
      ctx.fill();
    },
    lightning_rod(ctx, x, y, s, v, t, C) {
      const hg = 3.6 * s;
      ctx.fillStyle = '#5b6474';
      ctx.fillRect(x - 0.35 * s, y - 0.1, 0.7 * s, 0.35 * s + 0.1);
      ctx.fillStyle = '#9aa6b8';
      ctx.fillRect(x - 0.06 * s, y, 0.12 * s, hg);
      ctx.strokeStyle = '#c47a3a';
      ctx.lineWidth = 0.07 * s;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) ctx.ellipse(x, y + hg * (0.5 + k * 0.13), 0.28 * s, 0.08 * s, 0, 0, TAU);
      ctx.stroke();
      const crackle = Math.sin(t * 17 + x * 3) > 0.7;
      additive(ctx, C.accent, x, y + hg, (crackle ? 1.1 : 0.55) * s, crackle ? 0.95 : 0.45);
      if (crackle) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#e8fbff';
        ctx.lineWidth = 0.04 * s;
        ctx.beginPath();
        ctx.moveTo(x, y + hg);
        ctx.lineTo(x + 0.25 * s, y + hg + 0.2 * s); ctx.lineTo(x + 0.15 * s, y + hg + 0.45 * s);
        ctx.moveTo(x, y + hg);
        ctx.lineTo(x - 0.3 * s, y + hg + 0.15 * s); ctx.lineTo(x - 0.35 * s, y + hg + 0.35 * s);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  };
  const FLOWER_COLS = ['#ffd34d', '#ff6fa8', '#ffffff', '#b28bff'];
  const LAVA_ROCK = Object.freeze({ rock: '#2e2020', rockLight: '#4a3432', rockDark: '#1a1010' });
  const CAIRN = [0.55, 0.42, 0.32, 0.22];
  const ICE_SHARDS = [-0.35, 1.1, 0.14, 0.05, 1.6, 0.18, 0.4, 1.0, 0.13, -0.1, 0.7, 0.1];
  const CRYSTALS = [-0.5, 1.4, 0.22, -0.12, 0.0, 2.2, 0.3, 0.03, 0.5, 1.2, 0.2, 0.15];
  const DECORATION_TYPES = Object.freeze(Object.keys(DECOR));

  function drawDecoration(ctx, d, world, t, zoom) {
    if (!ctx || !d) return;
    const fn = DECOR[d.type] || DECOR.rock;
    const s = clamp(U.safeNum(d.scale, 1), 0.2, 3);
    const x = U.safeNum(d.x, 0), y = U.safeNum(d.y, 0);
    fn(ctx, x, y, s, (d.variant | 0) & 3, U.safeNum(t, 0), worldColors(world || EMPTY), world);
  }

  // ------------------------------------------------------------------ Renderer
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas || null;
      let ctx = null;
      try { ctx = canvas && canvas.getContext ? (canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d')) : null; } catch (e) { ctx = null; }
      this.ctx = ctx;
      this.w = 0; this.h = 0; this.dpr = 1;
      this.quality = 'high';
      this.time = 0;
      this._clock = 0;
      this._lastNow = 0;
      // scratch buffers (grown on demand, never per frame)
      this._cap = 0;
      this._xs = null; this._ys = null; this._sf = null;
      this._ensureCap(1024);
      this._range = [0, 0];
      this._b = { left: 0, right: 0, bottom: 0, top: 0 };
      this._p = { x: 0, y: 0 };
      this._lamp = { x: 0, y: 0, angle: 0 };
      this._lava = new Float32Array(3 * 16);   // (x0, x1, y) per visible lava pool
      this._nLava = 0;
      this._labels = new Float32Array(3 * 8);  // (x, y, metres) of visible distance posts
      this._nLabels = 0;
      this._best = { on: false, x: 0, y: 0 };
      this._strNoise = U.makeNoise1D(0x51a7a);
      this._vopts = { boost: false, shield: false, thruster: false, crashed: false, headlights: false, throttle: 0, lean: 0 };
      this._dark = null; this._darkCtx = null; this._darkKey = '';
      this._unitRadial = null; this._coneGrad = null; this._gradCtx = null;
      this._vig = null; this._vigKey = '';
      this._fallbackBg = null; this._fallbackBgWorld = null;
      this._fallbackCam = null;
      this._lastRun = null; this._lastState = ''; this._crashAt = -10;
      this._errs = Object.create(null);
      this._labelCache = new Map();
      this.resize();
    }

    _ensureCap(n) {
      if (n <= this._cap) return;
      const cap = Math.max(n, this._cap * 2 || 1024);
      this._xs = new Float32Array(cap);
      this._ys = new Float32Array(cap);
      this._sf = new Uint8Array(cap);
      this._cap = cap;
    }

    setQuality(q) {
      this.quality = DPR_CAP[q] ? q : 'high';
      this.resize();
    }

    resize() {
      const c = this.canvas;
      if (!c) return false;
      let cw = c.clientWidth, ch = c.clientHeight;
      if (!(cw > 0) || !(ch > 0)) {
        const r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
        cw = r && r.width > 0 ? r.width : (typeof innerWidth === 'number' ? innerWidth : 960);
        ch = r && r.height > 0 ? r.height : (typeof innerHeight === 'number' ? innerHeight : 540);
      }
      cw = Math.max(1, Math.round(cw)); ch = Math.max(1, Math.round(ch));
      const raw = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      const dpr = Math.min(raw, DPR_CAP[this.quality] || 2);
      if (cw === this.w && ch === this.h && dpr === this.dpr && c.width === Math.round(cw * dpr)) return false;
      this.w = cw; this.h = ch; this.dpr = dpr;
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
      this._darkKey = ''; this._vigKey = '';
      return true;
    }

    worldTransform(camera) {
      const cam = camera || EMPTY;
      const z = cam.zoom > 0 ? cam.zoom : 40;
      const cx = isNum(cam.cx) ? cam.cx : U.safeNum(cam.x, 0) + U.safeNum(cam.shakeX, 0);
      const cy = isNum(cam.cy) ? cam.cy : U.safeNum(cam.y, 0) + U.safeNum(cam.shakeY, 0);
      const d = this.dpr;
      if (this.ctx) this.ctx.setTransform(d * z, 0, 0, -d * z, d * (this.w / 2 - cx * z), d * (this.h / 2 + cy * z));
    }

    screenTransform() {
      if (this.ctx) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // Call another module's draw without letting its errors break the frame (logged once per key).
    _safe(key, fn, self, a, b) {
      try { fn.call(self, a, b); } catch (e) {
        if (!this._errs[key]) { this._errs[key] = true; if (typeof console !== 'undefined') console.error('[RR.Renderer] ' + key + ' draw failed:', e); }
      }
      const ctx = this.ctx;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ================================================================ frame
    drawRun(run) {
      const ctx = this.ctx;
      if (!ctx || !run) return;
      if (!(this.w > 0)) this.resize();
      // clocks: animation follows run.time when present (freezes while paused)
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() / 1000 : Date.now() / 1000;
      const rdt = this._lastNow ? clamp(now - this._lastNow, 0, 0.1) : 1 / 60;
      this._lastNow = now;
      this._clock += rdt;
      const t = isNum(run.time) ? run.time : this._clock;
      this.time = t;
      const world = run.world || (RR.Worlds && RR.Worlds.list ? RR.Worlds.list[0] : null) || EMPTY;
      const C = worldColors(world);
      const env = run.env || EMPTY;
      const cam = this._cameraFor(run);
      if (typeof cam.setViewport === 'function' && (Math.abs((cam.viewW || 0) - this.w) > 0.5 || Math.abs((cam.viewH || 0) - this.h) > 0.5)) {
        cam.setViewport(this.w, this.h);
      }
      const b = this._bounds(cam);
      // crash flash timing (state edge)
      if (run !== this._lastRun) { this._lastRun = run; this._lastState = ''; this._crashAt = -10; }
      if (run.state === 'crashed' && this._lastState !== 'crashed') this._crashAt = this._clock;
      this._lastState = run.state;

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineJoin = 'round';

      // ---- sky
      this.screenTransform();
      const bg = this._backgroundFor(run, world, cam, env, rdt);
      const terrain = run.terrain;
      // sample terrain first: its lowest visible point tells the background where it can stop painting
      const minGround = terrain ? this._sampleTerrain(terrain, C, b, cam.zoom || 40) : NaN;
      if (bg) {
        const cy = isNum(cam.cy) ? cam.cy : U.safeNum(cam.y, 0);
        const fy = this.h / 2 - (minGround - cy) * (cam.zoom || 40);
        // only valid when the sampled ground spans the whole view width
        const N = this._nPts;
        const spans = N > 1 && this._xs[0] <= b.left && this._xs[N - 1] >= b.right;
        bg.floorY = spans && isNum(fy) ? fy : null;
      }
      // how much of the view is inside a cave (smoothed): drives the cave backdrop & hides sky/weather
      const caveT = terrain ? this._caveCoverage(terrain, b) : 0;
      this._caveFrac = U.damp(U.safeNum(this._caveFrac, caveT), caveT, 6, rdt);
      if (Math.abs(this._caveFrac - caveT) < 0.002) this._caveFrac = caveT;
      const cave = this._caveFrac;
      let skyOk = cave >= 0.999;
      if (!skyOk && bg && typeof bg.drawSky === 'function') {
        try { bg.drawSky(ctx, cam, this.w, this.h, env); skyOk = true; } catch (e) { this._logOnce('background', e); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        this.screenTransform();
      }
      if (!skyOk) { ctx.fillStyle = C.sky; ctx.fillRect(0, 0, this.w, this.h); }
      if (cave > 0.001) this._drawCaveBackdrop(ctx, cam, C, cave);

      // ---- world
      this.worldTransform(cam);
      if (terrain) {
        this._drawDecorations(ctx, terrain, world, t, 'back', b, cam.zoom);
        this._drawTerrain(ctx, terrain, world, C, t, b, cam.zoom || 40);
        this._drawPosts(ctx, terrain, C, b, run, t);
        this._drawCeiling(ctx, terrain, C, b, t);
        if (this._nLabels || this._best.on) {
          this.screenTransform();
          this._drawPostLabels(ctx, cam);
          this.worldTransform(cam);
        }
      }
      if (run.collectibles && typeof run.collectibles.draw === 'function') this._safe('collectibles', run.collectibles.draw, run.collectibles, ctx, run);
      if (run.events && typeof run.events.drawWorld === 'function') this._safe('events.world', run.events.drawWorld, run.events, ctx, run);
      if (run.particles && typeof run.particles.draw === 'function') this._safe('particles', run.particles.draw, run.particles, ctx, cam);
      if (run.body) this._drawVehicle(ctx, run, terrain, t);
      if (terrain) this._drawDecorations(ctx, terrain, world, t, 'front', b, cam.zoom);

      // ---- screen
      this.screenTransform();
      const darkness = clamp(U.safeNum(env.darkness, U.safeNum(world.darkness, 0)), 0, 0.96);
      if (darkness > 0.02) this._drawDarkness(ctx, run, cam, C, darkness);
      if (env.tint) this._drawTint(ctx, env.tint);
      if (bg && typeof bg.drawWeather === 'function' && cave < 0.6) {
        try { bg.drawWeather(ctx, cam, this.w, this.h, env); } catch (e) { this._logOnce('weather', e); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (run.floatText && typeof run.floatText.draw === 'function') this._safe('floatText', run.floatText.draw, run.floatText, ctx, cam);
      if (run.events && typeof run.events.drawScreen === 'function') this._safe('events.screen', run.events.drawScreen, run.events, ctx, run);
      this._drawVignettes(ctx, run, t);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Fraction (0..1) of the view that has a cave ceiling above it (9 probes).
    _caveCoverage(T, b) {
      if (typeof T.ceilingAt !== 'function') return 0;
      let n = 0;
      for (let k = 0; k < 9; k++) {
        const c = T.ceilingAt(U.lerp(b.left, b.right, k / 8));
        if (c !== null && c !== undefined && isNum(c)) n++;
      }
      return n / 9;
    }

    // Screen-space cave interior: dark back wall + two parallax layers of hanging rock teeth.
    _drawCaveBackdrop(ctx, cam, C, frac) {
      const w = this.w, h = this.h, s = h / 720;
      const camX = isNum(cam.cx) ? cam.cx : U.safeNum(cam.x, 0);
      const z = cam.zoom || 40;
      ctx.globalAlpha = clamp(frac, 0, 1);
      ctx.fillStyle = C.caveBack;
      ctx.fillRect(0, 0, w, h);
      const step = this.quality === 'low' ? 16 : 8;
      for (let L = 0; L < 2; L++) {
        const f = L === 0 ? 0.25 : 0.45;
        const cell = (L === 0 ? 70 : 110) * s;
        const base = (L === 0 ? 0.1 : 0.04) * h, amp = (L === 0 ? 0.2 : 0.3) * h;
        const scroll = camX * z * f;
        ctx.fillStyle = L === 0 ? C.caveWall : C.caveWallNear;
        ctx.beginPath();
        ctx.moveTo(-step, -2);
        for (let sx = -step; sx <= w + step; sx += step) {
          const u = (sx + scroll) / cell;
          const k = Math.floor(u), t = u - k;
          const hk = 0.35 + 0.65 * h01(k, 0xca7e + L);
          const tooth = Math.pow(1 - Math.abs(2 * t - 1), 1.6) * hk;      // stalactite-like teeth
          const lump = 0.25 * (0.5 + 0.5 * this._strNoise(u * 0.23 + L * 7));
          ctx.lineTo(sx, base + amp * (lump + tooth * 0.75));
        }
        ctx.lineTo(w + step, -2);
        ctx.closePath();
        ctx.fill();
        // faint mineral glints scattered over the near rock layer
        if (L === 1 && this.quality !== 'low') {
          ctx.fillStyle = C.caveVein;
          const k0 = Math.floor(scroll / cell) - 1, k1 = Math.ceil((scroll + w) / cell) + 1;
          for (let k = k0; k <= k1; k++) {
            for (let j = 0; j < 3; j++) {
              const hr = h01(k * 3 + j, 0xbe1a);
              if (hr < 0.45) continue;
              const x = k * cell - scroll + cell * h01(k * 3 + j, 0xbe1b);
              const y = base + amp * (0.05 + 0.3 * h01(k * 3 + j, 0xbe1c));
              const r = (1 + 1.5 * hr) * s;
              ctx.fillRect(x - r / 2, y - r / 2, r, r);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    _logOnce(key, e) {
      if (this._errs[key]) return;
      this._errs[key] = true;
      if (typeof console !== 'undefined') console.error('[RR.Renderer] ' + key + ' failed:', e);
    }

    _cameraFor(run) {
      const c = run.camera;
      if (c && isNum(c.zoom) && c.zoom > 0) return c;
      // minimal fallback camera centred on the vehicle (keeps partial mocks drawable)
      let fc = this._fallbackCam;
      if (!fc) {
        fc = this._fallbackCam = {
          x: 0, y: 0, cx: 0, cy: 0, zoom: 40, viewW: 960, viewH: 540, shakeX: 0, shakeY: 0,
          worldToScreen(wx, wy, out) { out = out || { x: 0, y: 0 }; out.x = this.viewW / 2 + (wx - this.cx) * this.zoom; out.y = this.viewH / 2 - (wy - this.cy) * this.zoom; return out; },
          bounds(out) {
            out = out || {}; const hw = this.viewW / (2 * this.zoom), hh = this.viewH / (2 * this.zoom);
            out.left = this.cx - hw; out.right = this.cx + hw; out.bottom = this.cy - hh; out.top = this.cy + hh; return out;
          }
        };
      }
      const bd = run.body;
      fc.viewW = this.w || 960; fc.viewH = this.h || 540;
      fc.zoom = Math.max(4, Math.min(fc.viewH / 15, fc.viewW / 24));
      fc.x = fc.cx = bd && isNum(bd.x) ? bd.x + 3 : (c && isNum(c.x) ? c.x : 0);
      fc.y = fc.cy = bd && isNum(bd.y) ? bd.y + 1 : (c && isNum(c.y) ? c.y : 0);
      return fc;
    }

    _bounds(cam) {
      const b = this._b;
      if (typeof cam.bounds === 'function') cam.bounds(b);
      else {
        const z = cam.zoom || 40, hw = this.w / (2 * z), hh = this.h / (2 * z);
        const cx = isNum(cam.cx) ? cam.cx : U.safeNum(cam.x, 0), cy = isNum(cam.cy) ? cam.cy : U.safeNum(cam.y, 0);
        b.left = cx - hw; b.right = cx + hw; b.bottom = cy - hh; b.top = cy + hh;
      }
      if (!isNum(b.left) || !isNum(b.right) || !isNum(b.bottom) || !isNum(b.top)) { b.left = -20; b.right = 20; b.bottom = -12; b.top = 12; }
      return b;
    }

    _backgroundFor(run, world, cam, env, dt) {
      if (run.background && typeof run.background.drawSky === 'function') return run.background;
      if (!RR.Background) return null;
      if (!this._fallbackBg || this._fallbackBgWorld !== world) {
        try {
          this._fallbackBg = new RR.Background(world, U.hashString(String(world.id || 'world')));
          this._fallbackBgWorld = world;
          this._fallbackBg.setQuality(this.quality);
        } catch (e) { this._fallbackBg = null; return null; }
      }
      // nobody else updates a fallback background: advance it here
      try { this._fallbackBg.update(dt, cam, env); } catch (e) { this._logOnce('background.update', e); }
      return this._fallbackBg;
    }

    // ================================================================ terrain
    // Sample the visible terrain into the scratch arrays (decimated). Returns the lowest ground y seen.
    _sampleTerrain(T, C, b, zoom) {
      this._nPts = 0;
      if (typeof T.getIndexRange !== 'function' || typeof T.pointY !== 'function') return NaN;
      const r = T.getIndexRange(b.left - 1.5, b.right + 1.5, this._range);
      let i0 = r[0] | 0, i1 = r[1] | 0;
      if (!(i1 > i0)) return NaN;
      // decimate: keep ≥ ~3 px between samples; LOW doubles the step
      const pxPer = zoom * DX;
      let step = Math.max(1, Math.ceil(3 / Math.max(0.1, pxPer)));
      if (this.quality === 'low') step *= 2;
      const n = Math.floor((i1 - i0) / step) + 2;
      this._ensureCap(n + 2);
      const xs = this._xs, ys = this._ys, sf = this._sf;
      const keys = surfKeys();
      const mainIdx = Math.max(0, keys.indexOf(C.main));
      const hasSurf = typeof T.surfaceIdx === 'function';
      const px = typeof T.pointX === 'function';
      let k = 0;
      for (let i = i0; ; i += step) {
        if (i > i1) i = i1;
        xs[k] = px ? T.pointX(i) : i * DX;
        const y = T.pointY(i);
        ys[k] = isNum(y) ? y : (k > 0 ? ys[k - 1] : 0);
        sf[k] = hasSurf ? T.surfaceIdx(i) : mainIdx;
        k++;
        if (i === i1) break;
      }
      this._nPts = k;
      let minY = Infinity;
      for (let j = 0; j < k; j++) if (ys[j] < minY) minY = ys[j];
      return minY;
    }

    _drawTerrain(ctx, T, world, C, t, b, zoom) {
      const N = this._nPts;
      if (N < 2) return;
      const xs = this._xs, ys = this._ys, sf = this._sf;
      const keys = surfKeys();
      const bottom = b.bottom - 2;

      // 1. ground body + contour-following strata
      ctx.fillStyle = C.ground;
      this._traceFill(ctx, 0, N, 0, bottom);
      const noise = this._strNoise;
      const depths = STRATA_DEPTH;
      for (let s = 0; s < 3; s++) {
        ctx.fillStyle = C.strata[s];
        ctx.beginPath();
        ctx.moveTo(xs[0], bottom);
        for (let j = 0; j < N; j++) ctx.lineTo(xs[j], ys[j] - depths[s] - (0.35 + s * 0.3) * (1 + noise(xs[j] * (0.06 + s * 0.02) + s * 17)));
        ctx.lineTo(xs[N - 1], bottom);
        ctx.closePath();
        ctx.fill();
      }
      // thin light seams along the top of each stratum
      if (this.quality !== 'low') {
        ctx.strokeStyle = C.strataLine;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(0.03, 1.5 / zoom);
        ctx.beginPath();
        for (let s = 0; s < 2; s++) {
          for (let j = 0; j < N; j++) {
            const yy = ys[j] - depths[s] - (0.35 + s * 0.3) * (1 + noise(xs[j] * (0.06 + s * 0.02) + s * 17));
            if (j === 0) ctx.moveTo(xs[j], yy); else ctx.lineTo(xs[j], yy);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 2. pebbles (hashed per 1.1 m cell of world x → stable while scrolling)
      if (this.quality !== 'low') this._drawPebbles(ctx, C, xs[0], xs[N - 1], bottom);

      // 3. surface band per run (lava handled separately)
      const lavaIdx = keys.indexOf('lava');
      this._nLava = 0;
      let a = 0;
      while (a < N - 1) {
        const si = sf[a];
        let e = a;
        while (e < N - 1 && sf[e + 1] === si) e++;
        const end = Math.min(N - 1, e + 1);            // include the next point so runs join seamlessly
        if (si === lavaIdx) {
          if (this._nLava < 16) {
            const L = this._lava, o = this._nLava * 3;
            L[o] = xs[a]; L[o + 1] = xs[end]; L[o + 2] = ys[a];
            this._nLava++;
          }
        } else {
          const key = keys[si] || C.main;
          const st = C.surf[key] || C.surf[C.main] || SURF.dirt;
          this._drawBand(ctx, a, end, st, key, C, t, zoom);
        }
        a = e + 1;
      }
      // 4. lava pools
      for (let q = 0; q < this._nLava; q++) this._drawLava(ctx, q, C, t);
    }

    _traceFill(ctx, a, e, off, bottom) {
      const xs = this._xs, ys = this._ys;
      ctx.beginPath();
      ctx.moveTo(xs[a], bottom);
      for (let j = a; j < e; j++) ctx.lineTo(xs[j], ys[j] - off);
      ctx.lineTo(xs[e - 1], bottom);
      ctx.closePath();
      ctx.fill();
    }

    // Interpolated ground height from the sampled arrays (x inside the visible range).
    _yAt(x) {
      const xs = this._xs, ys = this._ys, N = this._nPts;
      if (N < 2) return 0;
      const dx = xs[1] - xs[0];
      let j = dx > 0 ? Math.floor((x - xs[0]) / dx) : 0;
      if (j < 0) j = 0; else if (j > N - 2) j = N - 2;
      const span = xs[j + 1] - xs[j];
      const f = span > 0 ? clamp((x - xs[j]) / span, 0, 1) : 0;
      return ys[j] + (ys[j + 1] - ys[j]) * f;
    }

    _drawPebbles(ctx, C, x0, x1, bottom) {
      const cell = 1.1;
      const c0 = Math.floor(x0 / cell), c1 = Math.ceil(x1 / cell);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = C.pebble[pass];
        ctx.beginPath();
        for (let c = c0; c <= c1; c++) {
          const hsh = U.hash2(c, 0x9ebb1e);
          if ((hsh & 3) === 0 || ((hsh >>> 2) & 1) !== pass) continue;
          const px = (c + ((hsh >>> 3) & 255) / 256) * cell;
          const depth = 0.9 + ((hsh >>> 11) & 255) / 255 * 6.5;
          const py = this._yAt(px) - depth;
          if (py < bottom) continue;
          const sz = 0.07 + ((hsh >>> 19) & 31) / 31 * 0.16;
          ctx.moveTo(px + sz * 1.4, py);
          ctx.ellipse(px, py, sz * 1.4, sz, ((hsh >>> 24) & 7) * 0.2, 0, TAU);
        }
        ctx.fill();
      }
      // a highlight fleck on the bigger stones
      ctx.fillStyle = C.pebbleHi;
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        const hsh = U.hash2(c, 0x9ebb1e);
        if ((hsh & 3) === 0) continue;
        const sz = 0.07 + ((hsh >>> 19) & 31) / 31 * 0.16;
        if (sz < 0.14) continue;
        const px = (c + ((hsh >>> 3) & 255) / 256) * cell;
        const py = this._yAt(px) - (0.9 + ((hsh >>> 11) & 255) / 255 * 6.5);
        if (py < bottom) continue;
        ctx.moveTo(px - sz * 0.3 + sz * 0.35, py + sz * 0.35);
        ctx.arc(px - sz * 0.3, py + sz * 0.35, sz * 0.35, 0, TAU);
      }
      ctx.fill();
    }

    // Thick top band over samples [a, e] (inclusive) for one surface type, plus its detail pass.
    _drawBand(ctx, a, e, st, key, C, t, zoom) {
      const xs = this._xs, ys = this._ys;
      const band = st.band;
      // dark underlayer
      ctx.fillStyle = st.dark;
      ctx.beginPath();
      ctx.moveTo(xs[a], ys[a] + 0.01);
      for (let j = a + 1; j <= e; j++) ctx.lineTo(xs[j], ys[j] + 0.01);
      for (let j = e; j >= a; j--) ctx.lineTo(xs[j], ys[j] - band);
      ctx.closePath();
      ctx.fill();
      // bright top layer
      ctx.fillStyle = st.top;
      ctx.beginPath();
      ctx.moveTo(xs[a], ys[a] + 0.01);
      for (let j = a + 1; j <= e; j++) ctx.lineTo(xs[j], ys[j] + 0.01);
      for (let j = e; j >= a; j--) ctx.lineTo(xs[j], ys[j] - band * 0.55);
      ctx.closePath();
      ctx.fill();
      // crisp highlight edge
      ctx.strokeStyle = st.hi;
      ctx.lineWidth = Math.max(0.04, 2.2 / zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(xs[a], ys[a]);
      for (let j = a + 1; j <= e; j++) ctx.lineTo(xs[j], ys[j]);
      ctx.stroke();
      if (this.quality === 'low') return;
      const fn = DETAIL[key];
      if (fn) fn(this, ctx, xs[a], xs[e], st, C, t, zoom, band);
    }

    _drawLava(ctx, q, C, t) {
      const L = this._lava, o = q * 3;
      const x0 = L[o], x1 = L[o + 1], y = L[o + 2];
      if (!(x1 > x0)) return;
      const hot = '#ffd24a', mid = C.hazard, deep = '#8a1a08';
      // molten body with a rolling surface
      const g = ctx.createLinearGradient(0, y + 0.2, 0, y - 0.9);
      g.addColorStop(0, hot);
      g.addColorStop(0.3, mid);
      g.addColorStop(0.75, deep);
      g.addColorStop(1, C.deep);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y - 0.9);
      const stp = 0.25;
      for (let x = x0; x <= x1 + 1e-6; x += stp) ctx.lineTo(x, y + 0.08 + 0.07 * Math.sin(x * 2.1 + t * 2.2) + 0.04 * Math.sin(x * 5.3 - t * 3.1));
      ctx.lineTo(x1, y - 0.9);
      ctx.closePath();
      ctx.fill();
      // cooling crust plates drifting
      ctx.fillStyle = 'rgba(90,20,8,0.55)';
      ctx.beginPath();
      const c0 = Math.floor(x0 / 1.3), c1 = Math.floor(x1 / 1.3);
      for (let c = c0; c <= c1; c++) {
        const hsh = h01(c, 0x1a7a);
        if (hsh < 0.5) continue;
        const cx = (c + hsh) * 1.3 + Math.sin(t * 0.4 + c) * 0.2;
        if (cx < x0 + 0.3 || cx > x1 - 0.3) continue;
        ctx.moveTo(cx + 0.3, y - 0.05);
        ctx.ellipse(cx, y - 0.05, 0.3, 0.06, 0, 0, TAU);
      }
      ctx.fill();
      // glow above the pool
      const gl = glow(mid);
      if (gl) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 2.7 + x0);
        ctx.drawImage(gl, x0 - 1.2, y - 1.6, x1 - x0 + 2.4, 4.4);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // bubbles: grow, then pop (phase per cell)
      ctx.strokeStyle = '#fff1a8';
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      const b0 = Math.floor(x0 / 0.8), b1 = Math.floor(x1 / 0.8);
      for (let c = b0; c <= b1; c++) {
        const hsh = h01(c, 0xbb1e);
        const bx = (c + hsh) * 0.8;
        if (bx < x0 + 0.2 || bx > x1 - 0.2) continue;
        const ph = frac(t * (0.5 + hsh * 0.5) + hsh * 7);
        const r = 0.04 + ph * 0.16;
        ctx.moveTo(bx + r, y + 0.08 + r * 0.6);
        ctx.arc(bx, y + 0.08 + r * 0.6, r, 0, TAU);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff6c8';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(x0, y + 0.1 + 0.07 * Math.sin(x0 * 2.1 + t * 2.2));
      for (let x = x0 + stp; x <= x1 + 1e-6; x += stp) ctx.lineTo(x, y + 0.08 + 0.07 * Math.sin(x * 2.1 + t * 2.2) + 0.04 * Math.sin(x * 5.3 - t * 3.1));
      ctx.stroke();
    }

    // Distance posts every 100 m (+ the BEST flag); labels are collected and drawn in screen space.
    _drawPosts(ctx, T, C, b, run, t) {
      this._nLabels = 0;
      this._best.on = false;
      if (this._nPts < 2) return;
      const first = Math.max(100, Math.ceil((b.left - 1) / 100) * 100);
      for (let m = first; m <= b.right + 1 && this._nLabels < 8; m += 100) {
        const y = this._yAt(m);
        const major = m % 1000 === 0;
        const hgt = major ? 2.8 : 2.2;
        ctx.fillStyle = '#2b2f3a';
        ctx.fillRect(m - 0.06, y - 0.2, 0.12, hgt + 0.2);
        ctx.fillStyle = major ? '#ffcf3a' : '#ffffff';
        ctx.beginPath();
        const bw = major ? 1.9 : 1.5, bh = major ? 0.72 : 0.6;
        ctx.moveTo(m - bw / 2, y + hgt);
        ctx.lineTo(m + bw / 2, y + hgt);
        ctx.lineTo(m + bw / 2 + 0.18, y + hgt + bh / 2);
        ctx.lineTo(m + bw / 2, y + hgt + bh);
        ctx.lineTo(m - bw / 2, y + hgt + bh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = major ? '#b8860b' : C.accent;
        ctx.lineWidth = 0.07;
        ctx.stroke();
        const o = this._nLabels * 3;
        this._labels[o] = m; this._labels[o + 1] = y + hgt + bh / 2; this._labels[o + 2] = major ? 1 : 0;
        this._nLabels++;
      }
      const best = U.safeNum(run.bestDistance, 0);
      if (best > 0 && best >= b.left - 3 && best <= b.right + 3) {
        const y = this._yAt(best);
        const hgt = 3.4;
        ctx.fillStyle = '#e9edf5';
        ctx.fillRect(best - 0.07, y - 0.2, 0.14, hgt + 0.2);
        // waving checkered-edge banner
        const fw = 1.6, fh = 0.95;
        ctx.fillStyle = '#ff3b5c';
        ctx.beginPath();
        ctx.moveTo(best, y + hgt);
        for (let k = 1; k <= 8; k++) ctx.lineTo(best + fw * k / 8, y + hgt + Math.sin(t * 4.5 - k * 0.7) * 0.09 * k / 8);
        for (let k = 8; k >= 0; k--) ctx.lineTo(best + fw * k / 8, y + hgt - fh + Math.sin(t * 4.5 - k * 0.7) * 0.09 * k / 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const fx = best + fw * (k * 2 + 1) / 8, wv = Math.sin(t * 4.5 - (k * 2 + 1) * 0.7) * 0.09 * (k * 2 + 1) / 8;
          ctx.rect(fx, y + hgt - 0.2 + wv, fw / 8, 0.2);
        }
        ctx.fill();
        this._best.on = true; this._best.x = best; this._best.y = y + hgt + 0.35;
      }
    }

    _drawPostLabels(ctx, cam) {
      const p = this._p;
      const toScreen = typeof cam.worldToScreen === 'function';
      const z = cam.zoom || 40;
      const fs = clamp(Math.round(z * 0.36), 10, 22);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < this._nLabels; i++) {
        const o = i * 3;
        const m = this._labels[o];
        if (toScreen) cam.worldToScreen(m, this._labels[o + 1], p);
        else { p.x = this.w / 2 + (m - U.safeNum(cam.x, 0)) * z; p.y = this.h / 2 - (this._labels[o + 1] - U.safeNum(cam.y, 0)) * z; }
        ctx.font = FONT_CACHE(fs);
        ctx.fillStyle = '#1d2230';
        ctx.fillText(this._label(m), p.x, p.y + 1);
      }
      if (this._best.on) {
        if (toScreen) cam.worldToScreen(this._best.x, this._best.y, p);
        else { p.x = this.w / 2 + (this._best.x - U.safeNum(cam.x, 0)) * z; p.y = this.h / 2 - (this._best.y - U.safeNum(cam.y, 0)) * z; }
        ctx.font = FONT_CACHE(fs + 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,10,30,0.85)';
        ctx.strokeText('BEST', p.x, p.y - fs * 0.9);
        ctx.fillStyle = '#ffd34d';
        ctx.fillText('BEST', p.x, p.y - fs * 0.9);
      }
    }

    _label(m) {
      let s = this._labelCache.get(m);
      if (!s) {
        s = U.formatInt(m) + ' m';
        if (this._labelCache.size > 64) this._labelCache.clear();
        this._labelCache.set(m, s);
      }
      return s;
    }

    // Cave ceiling: dark rock mass above terrain.ceilingAt(x) with a lit rim and stalactites.
    _drawCeiling(ctx, T, C, b, t) {
      if (typeof T.ceilingAt !== 'function' || this._nPts < 2) return;
      const xs = this._xs, N = this._nPts;
      const top = b.top + 2;
      let j = 0;
      while (j < N) {
        const c = T.ceilingAt(xs[j]);
        if (c === null || c === undefined || !isNum(c)) { j++; continue; }
        let e = j;
        while (e + 1 < N) { const c2 = T.ceilingAt(xs[e + 1]); if (c2 === null || c2 === undefined || !isNum(c2)) break; e++; }
        if (e > j) this._ceilingRun(ctx, T, C, xs[j], xs[e], top);
        j = e + 1;
      }
    }

    _ceilingRun(ctx, T, C, x0, x1, top) {
      const xs = this._xs;
      const stp = xs[1] - xs[0] || DX;
      // rock mass
      ctx.fillStyle = C.cave;
      ctx.beginPath();
      ctx.moveTo(x0, top);
      for (let x = x0; x <= x1 + 1e-6; x += stp) ctx.lineTo(x, T.ceilingAt(x));
      ctx.lineTo(x1, top);
      ctx.closePath();
      ctx.fill();
      // lower rim band (slightly lighter) for depth
      ctx.fillStyle = C.caveRim;
      ctx.beginPath();
      ctx.moveTo(x0, T.ceilingAt(x0));
      for (let x = x0 + stp; x <= x1 + 1e-6; x += stp) ctx.lineTo(x, T.ceilingAt(x));
      for (let x = x1; x >= x0 - 1e-6; x -= stp) ctx.lineTo(x, T.ceilingAt(x) + 0.45);
      ctx.closePath();
      ctx.fill();
      // stalactites (hashed per cell)
      ctx.fillStyle = C.caveRim;
      ctx.beginPath();
      const cell = 1.2;
      const c0 = Math.ceil(x0 / cell), c1 = Math.floor(x1 / cell);
      for (let c = c0; c <= c1; c++) {
        const hsh = U.hash2(c, 0x57a1);
        if ((hsh & 3) === 0) continue;
        const cx = (c + ((hsh >>> 2) & 255) / 512) * cell;
        if (cx < x0 || cx > x1) continue;
        const cy = T.ceilingAt(cx);
        if (!isNum(cy)) continue;
        const len = 0.3 + ((hsh >>> 10) & 255) / 255 * 1.5, w = 0.18 + ((hsh >>> 18) & 63) / 63 * 0.3;
        ctx.moveTo(cx - w, cy + 0.1);
        ctx.lineTo(cx + w, cy + 0.1);
        ctx.lineTo(cx + w * 0.15, cy - len);
        ctx.closePath();
      }
      ctx.fill();
      ctx.strokeStyle = C.caveHi;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(x0, T.ceilingAt(x0));
      for (let x = x0 + stp; x <= x1 + 1e-6; x += stp) ctx.lineTo(x, T.ceilingAt(x));
      ctx.stroke();
    }

    _drawDecorations(ctx, T, world, t, layer, b, zoom) {
      const ds = T.decorations;
      if (!Array.isArray(ds) || !ds.length) return;
      // binary search for the first decoration that could be visible (sorted by x)
      const left = b.left - 9;
      let lo = 0, hi = ds.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ds[mid].x < left) lo = mid + 1; else hi = mid; }
      const right = b.right + 9;
      const C = worldColors(world);
      for (let i = lo; i < ds.length; i++) {
        const d = ds[i];
        if (!d || d.x > right) break;
        if ((d.layer || 'back') !== layer) continue;
        if (d.y > b.top + 1 || d.y < b.bottom - 12) continue;
        const fn = DECOR[d.type] || DECOR.rock;
        const s = clamp(U.safeNum(d.scale, 1), 0.2, 3);
        fn(ctx, d.x, d.y, s, (d.variant | 0) & 3, t, C, world);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ================================================================ vehicle
    _drawVehicle(ctx, run, T, t) {
      const body = run.body;
      if (!isNum(body.x) || !isNum(body.y)) return;
      // soft contact shadow on the ground, fading with height
      if (T && typeof T.heightAt === 'function') {
        const gy = T.heightAt(body.x);
        const hgt = body.y - gy;
        if (isNum(gy) && hgt < 8) {
          const a = clamp(0.32 - hgt * 0.045, 0, 0.32);
          const slope = typeof T.slopeAt === 'function' ? U.safeNum(T.slopeAt(body.x), 0) : 0;
          if (a > 0.01) {
            ctx.globalAlpha = a;
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(body.x, gy + 0.03, clamp(1.9 + hgt * 0.12, 0.6, 3), 0.16, Math.atan(slope), 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
      const art = RR.VehicleArt;
      if (!art || typeof art.draw !== 'function') return;
      const o = this._vopts;
      const pu = run.powerUps;
      o.crashed = run.state === 'crashed';
      o.boost = !!run.boostActive || puActive(pu, 'boost');
      o.shield = puActive(pu, 'shield');
      o.thruster = !!(run.specialActive || run.thrusterActive);
      const env = run.env || EMPTY;
      const world = run.world || EMPTY;
      o.headlights = clamp(U.safeNum(env.darkness, U.safeNum(world.darkness, 0)), 0, 1) > 0.22;
      const ctl = run.controls;
      o.throttle = run.state === 'running' || !run.state ? U.safeNum(ctl && ctl.throttle, U.safeNum(run.throttle, 0)) : 0;
      o.lean = U.safeNum(ctl && ctl.lean, 0);
      try {
        art.draw(ctx, body, run.tuned || body.tuned || {}, run.colors || (run.vehicleDef && run.vehicleDef.colors) || null, t, o);
      } catch (e) { this._logOnce('vehicle', e); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ================================================================ screen overlays
    _unitGradients(ctx) {
      if (this._unitRadial && this._gradCtx === ctx) return;
      // radial gradients centred at (0,0) with radius 1; positioned/scaled via transforms when used
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this._unitRadial = g;
      const c = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      c.addColorStop(0, 'rgba(0,0,0,1)');
      c.addColorStop(0.55, 'rgba(0,0,0,0.9)');
      c.addColorStop(1, 'rgba(0,0,0,0)');
      this._coneGrad = c;
      this._gradCtx = ctx;
    }

    _drawDarkness(ctx, run, cam, C, darkness) {
      if (darkness < 0.12) {
        // faint ambient dimming: a single fill, no light map needed
        ctx.globalAlpha = darkness;
        ctx.fillStyle = C.dark;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalAlpha = 1;
        return;
      }
      const scale = this.quality === 'high' ? 0.35 : 0.25; // low-res light map (soft by nature)
      const dw = Math.max(1, Math.ceil(this.w * scale)), dh = Math.max(1, Math.ceil(this.h * scale));
      const key = dw + 'x' + dh;
      if (this._darkKey !== key || !this._dark) {
        this._dark = makeCanvas(dw, dh);
        this._darkCtx = this._dark ? this._dark.getContext('2d') : null;
        this._darkKey = key;
        this._unitRadial = null;
      }
      const d = this._darkCtx;
      const p = this._p;
      const z = (cam.zoom || 40) * scale;
      if (!d) {
        // no offscreen canvas: plain dim overlay
        ctx.globalAlpha = darkness * 0.8;
        ctx.fillStyle = C.dark;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.globalAlpha = 1;
        return;
      }
      this._unitGradients(d);
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, dw, dh);
      d.globalAlpha = darkness;
      d.fillStyle = C.dark;
      d.fillRect(0, 0, dw, dh);
      d.globalAlpha = 1;
      d.globalCompositeOperation = 'destination-out';
      const body = run.body;
      if (body && isNum(body.x) && isNum(body.y)) {
        // ambient pool of light around the vehicle
        this._toScreen(cam, body.x, body.y + 0.4, scale);
        const R = 5.5 * z;
        d.fillStyle = this._unitRadial;
        d.setTransform(R, 0, 0, R, p.x, p.y);
        d.fillRect(-1, -1, 2, 2);
        // headlight cone along the chassis
        const art = RR.VehicleArt;
        const lp = art && art.lampPoint ? art.lampPoint(body, run.tuned || body.tuned || {}, this._lamp) : null;
        const lx = lp ? lp.x : body.x + 1.5 * Math.cos(body.angle || 0);
        const ly = lp ? lp.y : body.y + 1.5 * Math.sin(body.angle || 0);
        const ang = -(U.safeNum(body.angle, 0)) + 0.06;       // screen y is flipped; aim slightly down
        this._toScreen(cam, lx, ly, scale);
        const Lc = 17 * z, ca = Math.cos(ang) * Lc, sa = Math.sin(ang) * Lc;
        d.fillStyle = this._coneGrad;
        d.setTransform(ca, sa, -sa, ca, p.x, p.y);
        d.beginPath();
        d.moveTo(0, -0.02); d.lineTo(1, -0.42); d.lineTo(1, 0.42); d.lineTo(0, 0.02);
        d.closePath();
        d.fill();
        this._beam = true; this._beamX = p.x / scale; this._beamY = p.y / scale; this._beamA = ang; this._beamL = Lc / scale;
      } else this._beam = false;
      // lava pools glow through the dark
      d.fillStyle = this._unitRadial;
      for (let q = 0; q < this._nLava; q++) {
        const o = q * 3;
        const cx = (this._lava[o] + this._lava[o + 1]) / 2;
        this._toScreen(cam, cx, this._lava[o + 2], scale);
        const R = ((this._lava[o + 1] - this._lava[o]) / 2 + 3) * z;
        d.setTransform(R, 0, 0, R * 0.7, p.x, p.y);
        d.fillRect(-1, -1, 2, 2);
      }
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = 'source-over';
      ctx.drawImage(this._dark, 0, 0, this.w, this.h);
      // faint visible beam in the air (additive), sells the headlights in the dark
      if (this._beam) {
        this._unitGradients(ctx);
        const k = this.dpr, L = this._beamL, ca = Math.cos(this._beamA) * L, sa = Math.sin(this._beamA) * L;
        ctx.setTransform(k * ca, k * sa, -k * sa, k * ca, k * this._beamX, k * this._beamY);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.1 * darkness;
        ctx.fillStyle = '#fff0c0';
        ctx.beginPath();
        ctx.moveTo(0, -0.02); ctx.lineTo(1, -0.36); ctx.lineTo(1, 0.36); ctx.lineTo(0, 0.02);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        this.screenTransform();
      }
    }

    // world → screen (CSS px × k) into this._p
    _toScreen(cam, wx, wy, k) {
      const p = this._p;
      if (typeof cam.worldToScreen === 'function') cam.worldToScreen(wx, wy, p);
      else { const z = cam.zoom || 40; p.x = this.w / 2 + (wx - U.safeNum(cam.x, 0)) * z; p.y = this.h / 2 - (wy - U.safeNum(cam.y, 0)) * z; }
      p.x *= k; p.y *= k;
      return p;
    }

    _drawTint(ctx, tint) {
      let color = null, alpha = 0.18;
      if (typeof tint === 'string') {
        color = tint;
        if (tint.indexOf('rgba') === 0 || tint.indexOf('hsla') === 0) alpha = 1;
      } else if (tint && typeof tint === 'object' && typeof tint.color === 'string') {
        color = tint.color;
        alpha = clamp(U.safeNum(tint.alpha, U.safeNum(tint.strength, 0.18)), 0, 1);
      }
      if (!color || alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }

    _vignettes(ctx) {
      const key = this.w + 'x' + this.h;
      if (this._vigKey === key && this._vig) return this._vig;
      const w = this.w, h = this.h, cx = w / 2, cy = h / 2;
      const r0 = Math.min(w, h) * 0.35, r1 = Math.hypot(w, h) * 0.6;
      const mk = (col) => {
        const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
        g.addColorStop(0, 'rgba(' + col + ',0)');
        g.addColorStop(0.6, 'rgba(' + col + ',0.35)');
        g.addColorStop(1, 'rgba(' + col + ',0.85)');
        return g;
      };
      this._vig = { slow: mk('70,110,255'), fuel: mk('255,30,40'), crash: mk('255,40,30') };
      this._vigKey = key;
      return this._vig;
    }

    _drawVignettes(ctx, run, t) {
      const pu = run.powerUps;
      const slow = puActive(pu, 'slowtime');
      const fuelMax = U.safeNum(run.fuelMax, 0);
      const frac = fuelMax > 0 ? clamp(U.safeNum(run.fuel, fuelMax) / fuelMax, 0, 1) : 1;
      const lowFuel = frac < 0.2 && (run.state === 'running' || run.state === 'nofuel' || !run.state);
      const crashed = run.state === 'crashed';
      const since = this._clock - this._crashAt;
      if (!slow && !lowFuel && !crashed && since > 0.6) return;
      const V = this._vignettes(ctx);
      const w = this.w, h = this.h;
      if (slow) {
        ctx.fillStyle = 'rgba(120,150,255,0.07)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.55 + 0.12 * Math.sin(t * 3);
        ctx.fillStyle = V.slow;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (lowFuel) {
        const pulse = 0.5 + 0.5 * Math.sin(this._clock * 6.5);
        ctx.globalAlpha = clamp((0.25 + 0.75 * (1 - frac / 0.2)) * (0.35 + 0.45 * pulse), 0, 0.85);
        ctx.fillStyle = V.fuel;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (crashed) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = V.crash;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (since >= 0 && since < 0.6) {
        ctx.globalAlpha = clamp(0.6 - since * 1.1, 0, 0.6);
        ctx.fillStyle = '#fff5eb';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ------------------------------------------------------------------ per-surface detail painters
  // (renderer, ctx, x0, x1, style, worldColors, t, zoom, band) — WORLD transform; hashed by world x.
  const STRATA_DEPTH = [1.3, 3.1, 5.8];
  const fontCache = new Map();
  function FONT_CACHE(px) {
    let f = fontCache.get(px);
    if (!f) { f = '900 ' + px + 'px "Trebuchet MS", "Segoe UI", system-ui, sans-serif'; fontCache.set(px, f); }
    return f;
  }
  function eachCell(x0, x1, cell, salt, fn) {
    const c0 = Math.floor(x0 / cell), c1 = Math.floor(x1 / cell);
    for (let c = c0; c <= c1; c++) {
      const hsh = U.hash2(c, salt);
      const x = (c + (hsh & 1023) / 1024) * cell;
      if (x < x0 || x > x1) continue;
      fn(x, hsh);
    }
  }
  const DETAIL = {
    grass(R, ctx, x0, x1, st, C, t) {
      if (R.quality !== 'high') return;
      // tufts: three blades per cell, swaying slightly
      ctx.fillStyle = st.hi;
      ctx.beginPath();
      eachCell(x0, x1, 0.32, 0x6a55, (x, hsh) => {
        if ((hsh >>> 10) % 3 === 0) return;
        const y = R._yAt(x);
        const hgt = 0.1 + ((hsh >>> 12) & 15) / 15 * 0.16;
        const sw = Math.sin(t * 2 + x * 1.7) * 0.025;
        ctx.moveTo(x - 0.07, y); ctx.lineTo(x - 0.11 + sw, y + hgt * 0.8); ctx.lineTo(x - 0.02, y);
        ctx.moveTo(x - 0.03, y); ctx.lineTo(x + sw, y + hgt); ctx.lineTo(x + 0.04, y);
        ctx.moveTo(x + 0.02, y); ctx.lineTo(x + 0.1 + sw, y + hgt * 0.7); ctx.lineTo(x + 0.08, y);
      });
      ctx.fill();
      ctx.fillStyle = st.dark;
      ctx.beginPath();
      eachCell(x0, x1, 0.7, 0x6a56, (x, hsh) => {
        const y = R._yAt(x) - 0.12 - ((hsh >>> 10) & 7) * 0.03;
        ctx.moveTo(x + 0.05, y); ctx.arc(x, y, 0.05, 0, TAU);
      });
      ctx.fill();
    },
    snow(R, ctx, x0, x1, st, C, t) {
      ctx.strokeStyle = 'rgba(150,180,220,0.55)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      let first = true;
      for (let x = x0; x <= x1 + 1e-6; x += 0.5) {
        const y = R._yAt(x) - st.band + 0.03 + Math.sin(x * 3.1) * 0.04;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (R.quality !== 'high') return;
      // twinkling ice glints
      ctx.fillStyle = '#ffffff';
      eachCell(x0, x1, 0.6, 0x5a0f, (x, hsh) => {
        const tw = Math.sin(t * 3 + (hsh & 255));
        if (tw < 0.55) return;
        const y = R._yAt(x) - 0.06 - ((hsh >>> 10) & 7) * 0.03;
        const r = 0.05 * tw;
        ctx.beginPath();
        ctx.moveTo(x - r * 2, y); ctx.lineTo(x, y + r * 0.5); ctx.lineTo(x + r * 2, y); ctx.lineTo(x, y - r * 0.5); ctx.closePath();
        ctx.moveTo(x, y - r * 2); ctx.lineTo(x + r * 0.5, y); ctx.lineTo(x, y + r * 2); ctx.lineTo(x - r * 0.5, y); ctx.closePath();
        ctx.fill();
      });
    },
    ice(R, ctx, x0, x1, st) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      eachCell(x0, x1, 1.4, 0x1ce, (x) => {
        const y = R._yAt(x) - 0.08;
        ctx.moveTo(x - 0.3, y - 0.14); ctx.lineTo(x + 0.2, y);
        ctx.moveTo(x - 0.05, y - 0.2); ctx.lineTo(x + 0.25, y - 0.1);
      });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(80,140,200,0.35)';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      eachCell(x0, x1, 2.3, 0x1cf, (x, hsh) => {
        const y = R._yAt(x) - 0.12;
        ctx.moveTo(x, y); ctx.lineTo(x + 0.3, y - 0.2 - ((hsh >>> 10) & 3) * 0.04); ctx.lineTo(x + 0.2, y - st.band + 0.05);
      });
      ctx.stroke();
    },
    sand(R, ctx, x0, x1, st) {
      ctx.strokeStyle = st.dark;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      eachCell(x0, x1, 0.55, 0x5a4d, (x, hsh) => {
        const y = R._yAt(x) - 0.12 - ((hsh >>> 10) & 3) * 0.06;
        ctx.moveTo(x - 0.22, y); ctx.quadraticCurveTo(x, y + 0.06, x + 0.22, y);
      });
      ctx.stroke();
    },
    rock(R, ctx, x0, x1, st, C) {
      ctx.strokeStyle = st.dark;
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      eachCell(x0, x1, 0.9, 0x40c4, (x, hsh) => {
        const y = R._yAt(x) - 0.06;
        const l = 0.12 + ((hsh >>> 10) & 7) * 0.03;
        ctx.moveTo(x, y); ctx.lineTo(x + 0.06, y - l); ctx.lineTo(x + 0.02, y - l * 1.8);
      });
      // horizontal strata streak inside the band
      let first = true;
      for (let x = x0; x <= x1 + 1e-6; x += 0.5) {
        const y = R._yAt(x) - st.band * 0.72;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    },
    dirt(R, ctx, x0, x1, st) {
      ctx.fillStyle = st.dark;
      ctx.beginPath();
      eachCell(x0, x1, 0.45, 0xd127, (x, hsh) => {
        const y = R._yAt(x) - 0.1 - ((hsh >>> 10) & 7) * 0.035;
        ctx.moveTo(x + 0.04, y); ctx.arc(x, y, 0.035 + ((hsh >>> 14) & 3) * 0.012, 0, TAU);
      });
      ctx.fill();
    },
    mud(R, ctx, x0, x1, st) {
      ctx.strokeStyle = 'rgba(255,240,220,0.35)';
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      eachCell(x0, x1, 0.9, 0x3ad, (x, hsh) => {
        const y = R._yAt(x) - 0.06;
        const l = 0.15 + ((hsh >>> 10) & 7) * 0.03;
        ctx.moveTo(x - l, y); ctx.lineTo(x + l, y);
      });
      ctx.stroke();
      ctx.fillStyle = st.dark;
      ctx.beginPath();
      eachCell(x0, x1, 1.6, 0x3ae, (x) => {
        const y = R._yAt(x) - 0.2;
        ctx.moveTo(x + 0.25, y); ctx.ellipse(x, y, 0.25, 0.06, 0, 0, TAU);
      });
      ctx.fill();
    },
    ash(R, ctx, x0, x1, st, C, t) {
      // glowing cracks + flickering embers in the ash crust
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = C.hazard;
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 2.1);
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      eachCell(x0, x1, 2.6, 0xa5e, (x, hsh) => {
        if ((hsh >>> 13) & 1) return;
        const y = R._yAt(x) - 0.05;
        const d = st.band * (0.5 + ((hsh >>> 10) & 7) * 0.05);
        const sgn = (hsh >>> 14) & 1 ? 1 : -1;
        ctx.moveTo(x, y); ctx.lineTo(x + 0.12 * sgn, y - d * 0.45); ctx.lineTo(x + 0.02 * sgn, y - d);
        ctx.moveTo(x + 0.12 * sgn, y - d * 0.45); ctx.lineTo(x + 0.3 * sgn, y - d * 0.6);
      });
      ctx.stroke();
      ctx.fillStyle = '#ffb347';
      eachCell(x0, x1, 0.55, 0xa5f, (x, hsh) => {
        const fl = Math.sin(t * (4 + (hsh & 7)) + (hsh & 255));
        if (fl < 0.2) return;
        const y = R._yAt(x) - 0.08 - ((hsh >>> 10) & 7) * 0.035;
        ctx.globalAlpha = fl;
        ctx.fillRect(x - 0.03, y - 0.03, 0.06, 0.06);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    regolith(R, ctx, x0, x1, st) {
      eachCell(x0, x1, 1.3, 0x7e9, (x, hsh) => {
        if ((hsh >>> 10) % 3 === 0) return;
        const y = R._yAt(x) - 0.16;
        const r = 0.1 + ((hsh >>> 12) & 7) * 0.025;
        ctx.fillStyle = st.dark;
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = st.hi;
        ctx.lineWidth = 0.025;
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      });
    },
    metal(R, ctx, x0, x1, st) {
      // plate seams every 2 m + rivets
      ctx.strokeStyle = st.dark;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      const s0 = Math.ceil(x0 / 2), s1 = Math.floor(x1 / 2);
      for (let s = s0; s <= s1; s++) {
        const x = s * 2, y = R._yAt(x);
        ctx.moveTo(x, y); ctx.lineTo(x, y - st.band);
      }
      ctx.stroke();
      ctx.fillStyle = st.hi;
      ctx.beginPath();
      for (let s = s0 - 1; s <= s1; s++) {
        for (let k = 0; k < 2; k++) {
          const x = s * 2 + 0.25 + k * 1.5;
          if (x < x0 || x > x1) continue;
          const y = R._yAt(x) - st.band * 0.3;
          ctx.moveTo(x + 0.04, y); ctx.arc(x, y, 0.04, 0, TAU);
        }
      }
      ctx.fill();
    },
    neon(R, ctx, x0, x1, st, C, t) {
      // glowing grid: verticals every metre + a mid line, plus a soft glow along the top
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.7 + 0.3 * Math.sin(t * 3);
      ctx.strokeStyle = st.top;
      ctx.globalAlpha = 0.25 * pulse;
      ctx.lineWidth = 0.28;
      ctx.beginPath();
      let first = true;
      for (let x = x0; x <= x1 + 1e-6; x += 0.5) { const y = R._yAt(x); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha = 0.85 * pulse;
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      const s0 = Math.ceil(x0), s1 = Math.floor(x1);
      for (let s = s0; s <= s1; s++) { const y = R._yAt(s); ctx.moveTo(s, y); ctx.lineTo(s, y - st.band * 1.6); }
      first = true;
      for (let x = x0; x <= x1 + 1e-6; x += 0.5) { const y = R._yAt(x) - st.band * 0.8; if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
    crystal(R, ctx, x0, x1, st, C, t) {
      // alternating facets inside the band
      const cell = 0.8;
      const c0 = Math.floor(x0 / cell), c1 = Math.floor(x1 / cell);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? 'rgba(255,255,255,0.28)' : 'rgba(20,60,90,0.25)';
        ctx.beginPath();
        for (let c = c0; c <= c1; c++) {
          if (((c & 1) === 0) !== (pass === 0)) continue;
          const xa = Math.max(x0, c * cell), xb = Math.min(x1, (c + 1) * cell);
          if (xb <= xa) continue;
          const ya = R._yAt(xa), yb = R._yAt(xb);
          ctx.moveTo(xa, ya);
          ctx.lineTo(xb, yb);
          ctx.lineTo((xa + xb) / 2, (ya + yb) / 2 - st.band);
          ctx.closePath();
        }
        ctx.fill();
      }
      if (R.quality !== 'high') return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#e8ffff';
      eachCell(x0, x1, 1.1, 0xc7a, (x, hsh) => {
        const tw = Math.sin(t * 2.5 + (hsh & 255));
        if (tw < 0.6) return;
        const y = R._yAt(x) - 0.1;
        ctx.globalAlpha = tw;
        ctx.fillRect(x - 0.04, y - 0.04, 0.08, 0.08);
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  Renderer.drawDecoration = drawDecoration;
  Renderer.DECORATION_TYPES = DECORATION_TYPES;
  RR.Renderer = Renderer;
})();
