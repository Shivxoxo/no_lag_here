/* RIDGE RUSH — procedural vehicle art (RR.VehicleArt).
 *
 * Contract: docs/ARCHITECTURE.md §5.5. Everything is drawn with Canvas paths in the vehicle's local
 * frame (metres, y-up, facing +x, origin = chassis centre of mass), so the art always matches physics:
 * every silhouette is derived from TunedParams — hull bounds, wheel mounts, wheel radius, suspension
 * static length and the driver's head circle (the helmet is drawn exactly at tuned.chassis.head).
 *
 * Six original designs keyed by tuned.style: buggy · dirt · truck · rally · crawler · storm.
 * Per-tuned geometry (all polygons) is computed once and cached in a WeakMap; per-paint shades are
 * cached too, so a frame only traces pre-built point lists (no allocation in the hot path).
 *
 * Contract additions (callers may ignore):
 *  - RR.VehicleArt.lampPoint(body, tuned, out) → out {x, y, angle}: world position of the headlight
 *    and the beam direction (renderer uses it for the headlight cone in dark sections).
 *  - RR.VehicleArt.exhaustPoint(body, tuned, out) → out {x, y, angle}: world position of the exhaust /
 *    thruster nozzle and the direction exhaust leaves (for smoke / boost particles).
 *  - RR.VehicleArt.STYLES → frozen list of style ids.
 *  - opts.lean (−1..1) tilts the dirt-bike rider; opts.throttle also adds a subtle engine shimmy.
 *  - opts.multiplier (0..1 or bool): 2X COINS gold aura + gold rim around the body outline with running
 *    glints (the renderer passes the power-up's fade, so it dims over the last 2 s). opts.quality 'low'
 *    drops the soft aura/wide glow pass. (MAGNET rings are drawn by the renderer, not here.)
 *  - draw() accepts a body with no wheel positions (wheels are then posed at rest), so it can be used for
 *    UI poses; drawPreview(..) also accepts vehicleId values that are unknown (falls back to the buggy).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum;

  const STYLES = Object.freeze(['buggy', 'dirt', 'truck', 'rally', 'crawler', 'storm']);
  const PIPE = '#8e949f';   // brushed-metal exhaust
  const DEFAULT_COLORS = Object.freeze({ body: '#f2a007', accent: '#e8412c', trim: '#2b2f36', wheel: '#1d1f24', rim: '#d9dde3' });

  // ------------------------------------------------------------------ helpers
  // Trace a flat [x0, y0, x1, y1, ...] list as a closed polygon (no beginPath: callers batch).
  function poly(ctx, a) {
    ctx.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1]);
    ctx.closePath();
  }
  function fillPoly(ctx, a, style) {
    ctx.fillStyle = style;
    ctx.beginPath();
    poly(ctx, a);
    ctx.fill();
  }
  function line(ctx, x0, y0, x1, y1) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
  function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Per-paint derived shades (cached by colors object).
  const shadeCache = new WeakMap();
  function shades(colors) {
    let s = shadeCache.get(colors);
    if (s) return s;
    const c = Object.assign({}, DEFAULT_COLORS);
    for (const k of Object.keys(DEFAULT_COLORS)) if (typeof colors[k] === 'string' && colors[k][0] === '#') c[k] = colors[k];
    const mix = U.mixColor;
    s = {
      body: c.body, accent: c.accent, trim: c.trim, wheel: c.wheel, rim: c.rim,
      bodyDark: mix(c.body, '#000000', 0.32), bodyDeep: mix(c.body, '#000000', 0.5),
      bodyLight: mix(c.body, '#ffffff', 0.35), accentDark: mix(c.accent, '#000000', 0.3),
      trimLight: mix(c.trim, '#ffffff', 0.25), rimDark: mix(c.rim, '#000000', 0.35),
      tireSide: mix(c.wheel, '#ffffff', 0.12), tireTread: mix(c.wheel, '#000000', 0.45),
      suit: mix(c.trim, '#3a4150', 0.5), suitLight: mix(c.trim, '#8792a8', 0.45),
      helmet: c.accent, helmetStripe: c.body, glass: 'rgba(150,215,255,0.34)', glassHi: 'rgba(255,255,255,0.55)',
      accentGlow: c.accent
    };
    shadeCache.set(colors, s);
    return s;
  }

  // ------------------------------------------------------------------ geometry
  const geoCache = new WeakMap();
  function geometry(tuned) {
    let g = geoCache.get(tuned);
    if (g) return g;
    g = buildGeometry(tuned);
    geoCache.set(tuned, g);
    return g;
  }

  function buildGeometry(tuned) {
    const ch = (tuned && tuned.chassis) || {};
    const hull = Array.isArray(ch.hull) && ch.hull.length >= 3 ? ch.hull : [{ x: -1.5, y: -0.4 }, { x: 1.6, y: -0.4 }, { x: 1.4, y: 0.6 }, { x: -1.4, y: 0.6 }];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of hull) {
      const px = U.safeNum(p.x, 0), py = U.safeNum(p.y, 0);
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    const head = ch.head && isNum(ch.head.x) ? { x: ch.head.x, y: ch.head.y, r: U.safeNum(ch.head.r, 0.22) } : { x: -0.2, y: 0.95, r: 0.22 };
    const ws = Array.isArray(tuned && tuned.wheels) && tuned.wheels.length >= 2 ? tuned.wheels : null;
    const susp = (tuned && tuned.suspension) || {};
    const staticLen = U.safeNum(susp.staticLen, U.safeNum(susp.rest, 0.3) * 0.8);
    const wheel = (i, fx) => {
      const w = ws ? ws[i] : null;
      return {
        mx: w && w.mount ? U.safeNum(w.mount.x, fx) : fx,
        my: w && w.mount ? U.safeNum(w.mount.y, -0.2) : -0.2,
        r: w ? U.clamp(U.safeNum(w.radius, 0.42), 0.15, 1.5) : 0.42,
        staticLen: w && isNum(w.staticLen) ? w.staticLen : staticLen,
        maxLen: U.safeNum(susp.maxLen, staticLen + 0.2)
      };
    };
    // gold-rim outline for the 2X COINS aura: hull pushed ~0.07 m outward from its centroid (flat list)
    let hcx = 0, hcy = 0;
    for (const p of hull) { hcx += U.safeNum(p.x, 0); hcy += U.safeNum(p.y, 0); }
    hcx /= hull.length; hcy /= hull.length;
    const rim = [];
    for (const p of hull) {
      const dx = U.safeNum(p.x, 0) - hcx, dy = U.safeNum(p.y, 0) - hcy, d = Math.hypot(dx, dy) || 1;
      rim.push(hcx + dx * (1 + 0.07 / d), hcy + dy * (1 + 0.07 / d));
    }
    const style = STYLES.indexOf(tuned && tuned.style) >= 0 ? tuned.style : 'buggy';
    const g = {
      style, x0, x1, y0, y1, L: x1 - x0, H: y1 - y0, head,
      w: [wheel(0, x0 + 0.5), wheel(1, x1 - 0.5)],
      roof: Math.max(y1, head.y + head.r + 0.07),
      lamp: { x: x1 - 0.08, y: 0.05 }, exhaust: { x: x0, y: 0.1, a: Math.PI },
      rim, rimC: { x: hcx, y: hcy }
    };
    BUILD[style](g);
    return g;
  }

  // Each builder fills g with flat point lists (local metres) for its silhouette.
  const BUILD = {
    buggy(g) {
      const { x0, x1, y0, head } = g;
      const hx = head.x;
      g.roof = head.y + head.r + 0.09;
      g.tub = [x0 + 0.04, 0.02, x0 + 0.32, y0 + 0.07, x1 - 0.78, y0 + 0.07, x1 - 0.06, -0.1, x1, 0.05,
        x1 - 0.5, 0.16, hx + 0.52, 0.24, hx - 0.3, 0.26, x0 + 0.34, 0.3, x0, 0.2];
      g.nose = [x1 - 0.06, -0.1, x1, 0.05, x1 - 0.5, 0.16, hx + 0.9, 0.2, hx + 0.8, -0.02];
      g.stripe = [x0 + 0.3, -0.12, x1 - 0.5, -0.12];
      g.engine = [x0 + 0.1, 0.18, x0 + 0.62, 0.22, x0 + 0.62, 0.52, x0 + 0.14, 0.5];
      g.seat = [hx - 0.46, 0.18, hx - 0.2, 0.2, hx - 0.28, 0.78, hx - 0.52, 0.74];
      // tubular roll cage: rear hoop, roof, A-pillar, diagonal brace, front bumper, nerf bar
      const top = g.roof;
      g.cage = [
        x0 + 0.34, 0.28, hx - 0.52, top - 0.04,
        hx - 0.52, top - 0.04, hx + 0.46, top,
        hx + 0.46, top, x1 - 0.62, 0.16,
        x0 + 0.34, 0.28, hx + 0.46, top,
        x0 + 0.1, 0.46, hx - 0.52, top - 0.04,
        x1 - 0.12, -0.14, x1 + 0.08, 0.1,
        g.w[0].mx + 0.2, -0.28, g.w[1].mx - 0.3, -0.28
      ];
      g.wheelStyle = { knobs: 12, knobH: 0.07, spokes: 5, rim: 0.56, hub: 0.16, fender: false };
      g.lamp = { x: x1 - 0.18, y: 0.14 };
      g.exhaust = { x: x0 - 0.1, y: 0.3, a: Math.PI * 0.92 };
      g.pipe = [x0 + 0.3, 0.2, x0 + 0.02, 0.18, x0 - 0.1, 0.3];
      g.steer = { x: hx + 0.42, y: 0.52 };
      g.hip = { x: hx - 0.22, y: 0.26 };
      g.open = true;
    },
    dirt(g) {
      const { x0, x1, head } = g;
      const hx = head.x;
      const sh = { x: g.w[1].mx - 0.32, y: 0.42 };               // steering head
      const piv = { x: hx + 0.02, y: -0.08 };                    // swingarm pivot
      g.roof = head.y + head.r;
      g.steerHead = sh;
      g.pivot = piv;
      g.frame = [piv.x, piv.y, sh.x, sh.y, sh.x, sh.y, sh.x - 0.28, -0.12, sh.x - 0.28, -0.12, piv.x, piv.y,
        piv.x - 0.1, 0.24, x0 + 0.45, 0.34];
      g.engine = [piv.x + 0.02, -0.02, sh.x - 0.26, -0.02, sh.x - 0.3, -0.3, piv.x + 0.12, -0.32];
      g.tank = [hx + 0.14, 0.3, sh.x - 0.06, 0.46, sh.x + 0.02, 0.34, sh.x - 0.3, 0.14, hx + 0.12, 0.14];
      g.tail = [hx + 0.02, 0.2, x0 + 0.02, 0.44, x0 - 0.02, 0.36, hx - 0.08, 0.1];
      g.seat = [x0 + 0.34, 0.38, hx + 0.2, 0.34, hx + 0.22, 0.28, x0 + 0.36, 0.3];
      g.plate = [sh.x + 0.06, 0.22, sh.x + 0.26, 0.28, sh.x + 0.2, 0.6, sh.x + 0.02, 0.52];
      g.bar = { x: sh.x - 0.06, y: sh.y + 0.14 };
      g.wheelStyle = { knobs: 18, knobH: 0.05, spokes: 12, rim: 0.8, hub: 0.1, wire: true, fender: false };
      g.lamp = { x: sh.x + 0.22, y: 0.4 };
      g.exhaust = { x: x0 + 0.12, y: 0.3, a: Math.PI * 0.95 };
      g.pipe = [sh.x - 0.28, -0.16, piv.x - 0.2, 0.06, x0 + 0.5, 0.2, x0 + 0.12, 0.3];
      g.hip = { x: hx - 0.3, y: 0.42 };
      g.peg = { x: piv.x - 0.08, y: -0.14 };
      g.open = true;
      g.bike = true;
    },
    truck(g) {
      const { x0, x1, y0, head } = g;
      const hx = head.x, top = g.roof;
      const cabBack = hx - 0.6, hoodX = hx + 0.78;
      g.body = [x0, -0.28, x0 + 0.1, y0 + 0.06, x1 - 0.1, y0 + 0.06, x1 + 0.02, -0.24, x1 + 0.02, 0.3,
        hoodX, 0.44, hx + 0.44, top, cabBack + 0.06, top, cabBack, 0.4, x0 + 0.02, 0.4];
      g.window = [cabBack + 0.14, 0.52, cabBack + 0.16, top - 0.09, hx + 0.38, top - 0.09, hoodX - 0.1, 0.52];
      g.bedLine = [cabBack, 0.4, cabBack, -0.1];
      g.rail = [x0 + 0.02, 0.4, cabBack, 0.4];
      g.stripe = [x0 + 0.1, 0.05, x1 - 0.1, 0.05];
      g.grille = [x1 - 0.1, 0.24, x1 + 0.02, 0.24, x1 + 0.02, -0.12, x1 - 0.1, -0.12];
      g.bumpers = [x1 - 0.06, -0.14, x1 + 0.12, -0.14, x1 + 0.12, -0.34, x1 - 0.06, -0.34,
        x0 - 0.08, -0.16, x0 + 0.1, -0.16, x0 + 0.1, -0.32, x0 - 0.08, -0.32];
      g.lightBar = { x0: cabBack + 0.14, x1: hx + 0.4, y: top + 0.06 };
      g.wheelStyle = { knobs: 14, knobH: 0.08, spokes: 6, rim: 0.54, hub: 0.18, fender: true, fenderR: 1.2 };
      g.lamp = { x: x1 - 0.02, y: 0.16 };
      g.exhaust = { x: x0 + 0.1, y: -0.34, a: Math.PI * 1.05 };
      g.steer = { x: hx + 0.4, y: 0.5 };
      g.hip = { x: hx - 0.2, y: 0.35 };
      g.closed = true;
    },
    rally(g) {
      const { x0, x1, y0, head } = g;
      const hx = head.x;
      const top = (g.roof = head.y + head.r + 0.05);
      g.body = [x0 + 0.08, y0 + 0.08, x1 - 0.12, y0 + 0.08, x1 + 0.02, -0.12, x1, 0.1, hx + 1.02, 0.36,
        hx + 0.36, top, hx - 0.56, top, x0 + 0.16, 0.54, x0, 0.12];
      g.window = [hx - 0.5, 0.5, hx - 0.46, top - 0.07, hx + 0.32, top - 0.07, hx + 0.86, 0.46];
      g.pillar = [hx + 0.26, 0.48, hx + 0.12, top - 0.07];
      g.stripes = [x0 + 0.1, 0.02, x1 - 0.05, 0.02, x0 + 0.1, -0.08, x1 - 0.05, -0.08];
      g.roundel = { x: (g.w[0].mx + g.w[1].mx) / 2 - 0.1, y: 0.18, r: 0.16 };
      // roof spoiler extending the roofline back over the hatch, on two short stands
      g.spoiler = [hx - 1.02, top + 0.05, hx - 0.46, top + 0.03, hx - 0.46, top - 0.03, hx - 0.98, top - 0.04];
      g.spoilerStruts = [hx - 0.86, top - 0.03, hx - 0.8, top - 0.16, hx - 0.62, top - 0.02, hx - 0.6, top - 0.06];
      g.skirt = [x0 + 0.2, y0 + 0.06, x1 - 0.2, y0 + 0.06];
      g.flaps = [g.w[0].mx - g.w[0].r - 0.08, g.w[1].mx - g.w[1].r - 0.08];
      g.wheelStyle = { knobs: 20, knobH: 0.035, spokes: 5, rim: 0.66, hub: 0.14, alloy: true, fender: true, fenderR: 1.12 };
      g.lamp = { x: x1 - 0.08, y: 0.04 };
      g.rallyLamps = [{ x: x1 - 0.2, y: 0.22 }, { x: x1 - 0.42, y: 0.28 }];
      g.exhaust = { x: x0 - 0.02, y: -0.2, a: Math.PI };
      g.steer = { x: hx + 0.42, y: 0.46 };
      g.hip = { x: hx - 0.2, y: 0.24 };
      g.closed = true;
    },
    crawler(g) {
      const { x0, x1, head } = g;
      const hx = head.x, top = (g.roof = head.y + head.r + 0.1);
      g.rails = [x0 + 0.1, -0.14, x1 - 0.06, -0.14];
      g.tub = [x0 + 0.28, -0.08, x1 - 0.28, -0.08, x1 - 0.2, 0.2, x1 - 0.48, 0.38, hx + 0.52, 0.42, hx - 0.46, 0.4,
        x0 + 0.36, 0.44, x0 + 0.24, 0.12];
      g.hoodVents = [x1 - 0.7, 0.3, x1 - 0.55, 0.32];
      g.cage = [
        x0 + 0.36, 0.42, hx - 0.52, top,
        hx - 0.52, top, hx + 0.5, top,
        hx + 0.5, top, x1 - 0.48, 0.38,
        hx - 0.52, top, hx - 0.52, 0.4,
        x0 + 0.36, 0.42, hx + 0.5, top
      ];
      g.rack = { x0: hx - 0.6, x1: hx + 0.56, y: top + 0.05 };
      g.bumper = [x1 - 0.22, 0.06, x1 + 0.1, 0.06, x1 + 0.1, -0.24, x1 - 0.22, -0.24];
      g.rearBumper = [x0 - 0.06, 0.04, x0 + 0.24, 0.04, x0 + 0.24, -0.22, x0 - 0.06, -0.22];
      g.winch = { x: x1 - 0.04, y: -0.08 };
      g.spare = { x: x0 + 0.02, y: 0.48, r: 0.3 };
      g.snorkel = [x1 - 0.5, 0.3, hx + 0.62, 0.54, hx + 0.56, top - 0.1];
      g.wheelStyle = { knobs: 11, knobH: 0.12, spokes: 8, rim: 0.5, hub: 0.14, beadlock: true, fender: false };
      g.lamp = { x: x1 - 0.1, y: 0.22 };
      g.exhaust = { x: x0 + 0.3, y: -0.14, a: Math.PI };
      g.steer = { x: hx + 0.42, y: 0.56 };
      g.hip = { x: hx - 0.2, y: 0.4 };
      g.open = true;
    },
    storm(g) {
      const { x0, x1, y0, head } = g;
      const hx = head.x;
      const top = (g.roof = head.y + head.r + 0.05);
      g.body = [x1 + 0.06, -0.02, x1 - 0.34, y0 + 0.04, x0 + 0.24, y0 + 0.05, x0 - 0.04, 0.08, x0 + 0.04, 0.3,
        x0 + 0.24, 0.66, x0 + 0.46, 0.66, x0 + 0.62, 0.42, hx - 0.56, 0.42, hx + 0.8, 0.34, x1 - 0.4, 0.14];
      g.canopy = { x0: hx - 0.58, y0: 0.42, x1: hx + 0.82, y1: 0.34, top };
      g.fin = [x0 + 0.18, 0.4, x0 + 0.26, 0.66, x0 + 0.46, 0.66, x0 + 0.54, 0.42];
      g.pod = [x0 + 0.5, 0.06, x1 - 0.7, -0.02, x1 - 0.9, -0.14, x0 + 0.6, -0.1];
      g.energy = [x0 + 0.2, 0.18, hx - 0.3, 0.26, hx + 0.9, 0.2, x1 - 0.2, 0.02];
      g.energy2 = [x0 + 0.5, -0.06, x1 - 0.72, -0.1];
      g.nozzle = [x0 + 0.08, 0.34, x0 - 0.22, 0.4, x0 - 0.22, 0.0, x0 + 0.08, 0.04];
      g.wheelStyle = { knobs: 0, knobH: 0, spokes: 3, rim: 0.72, hub: 0.12, disc: true, fender: true, fenderR: 1.1 };
      g.lamp = { x: x1 - 0.04, y: 0.04 };
      g.exhaust = { x: x0 - 0.24, y: 0.2, a: Math.PI };
      g.steer = { x: hx + 0.4, y: 0.44 };
      g.hip = { x: hx - 0.2, y: 0.22 };
      g.closed = true;
    }
  };

  // ------------------------------------------------------------------ scratch state (no per-frame allocation)
  const WL = [{ x: 0, y: 0, rot: 0, comp: 0 }, { x: 0, y: 0, rot: 0, comp: 0 }];
  const DEF_OPTS = Object.freeze({});

  // Wheel positions in the chassis frame (clamped to the strut's plausible travel).
  function localWheels(body, g) {
    const ang = U.safeNum(body.angle, 0);
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i < 2; i++) {
      const wg = g.w[i], out = WL[i];
      const w = body.wheels && body.wheels[i];
      let lx = wg.mx, ly = wg.my - wg.staticLen;
      if (w && isNum(w.x) && isNum(w.y) && isNum(body.x) && isNum(body.y)) {
        const dx = w.x - body.x, dy = w.y - body.y;
        lx = dx * c + dy * s;
        ly = -dx * s + dy * c;
        // sanity clamp: keep the wheel near its strut (never draw a wheel flung across the screen)
        const ddx = lx - wg.mx, ddy = ly - wg.my;
        const d = Math.hypot(ddx, ddy), lim = wg.maxLen + 0.5;
        if (!(d <= lim)) { const k = d > 0 ? lim / d : 0; lx = wg.mx + ddx * k; ly = wg.my + ddy * k; }
      }
      out.x = lx; out.y = ly;
      out.rot = (w && isNum(w.spin) ? w.spin : 0) - ang;
      out.comp = w && isNum(w.compression) ? U.clamp(w.compression, 0, 1) : 0.4;
    }
    return WL;
  }

  // ------------------------------------------------------------------ parts
  function drawStrut(ctx, mx, my, wx, wy, sh, r, style) {
    const dx = wx - mx, dy = wy - my;
    const len = Math.hypot(dx, dy);
    if (len < 0.02) return;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    // damper body (upper) + chromed shaft (lower)
    ctx.lineCap = 'round';
    ctx.strokeStyle = sh.trim;
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    line(ctx, mx, my, mx + ux * len * 0.55, my + uy * len * 0.55);
    ctx.stroke();
    ctx.strokeStyle = sh.rim;
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    line(ctx, mx + ux * len * 0.5, my + uy * len * 0.5, wx, wy);
    ctx.stroke();
    // coil spring: fixed coil count, so it visibly bunches up as the strut compresses
    const coils = style === 'crawler' ? 8 : 7;
    const amp = r * 0.2;
    const a = len * 0.06, b = len * 0.78;
    ctx.strokeStyle = sh.accent;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(mx + ux * a, my + uy * a);
    const n = coils * 2;
    for (let k = 1; k <= n; k++) {
      const t = a + (b - a) * (k / n);
      const side = (k & 1) ? amp : -amp;
      ctx.lineTo(mx + ux * t + px * side, my + uy * t + py * side);
    }
    ctx.stroke();
  }

  function drawWheel(ctx, x, y, r, rot, sh, ws, t, glow) {
    // tyre (knobby outline for off-road styles)
    ctx.fillStyle = sh.wheel;
    ctx.beginPath();
    if (ws.knobs > 0 && ws.knobH > 0.06) {
      const n = ws.knobs, rin = r - r * ws.knobH;
      for (let k = 0; k < n; k++) {
        const a0 = rot + (k / n) * TAU, a1 = a0 + (0.5 / n) * TAU, a2 = a0 + (0.62 / n) * TAU, a3 = a0 + (0.95 / n) * TAU;
        const m = k === 0 ? 'moveTo' : 'lineTo';
        ctx[m](x + Math.cos(a0) * r, y + Math.sin(a0) * r);
        ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
        ctx.lineTo(x + Math.cos(a2) * rin, y + Math.sin(a2) * rin);
        ctx.lineTo(x + Math.cos(a3) * rin, y + Math.sin(a3) * rin);
      }
      ctx.closePath();
    } else {
      circle(ctx, x, y, r);
    }
    ctx.fill();
    // sidewall ring
    ctx.strokeStyle = sh.tireSide;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    circle(ctx, x, y, r * 0.8);
    ctx.stroke();
    // tread notches on smooth tyres
    if (ws.knobs > 0 && ws.knobH <= 0.06) {
      ctx.strokeStyle = sh.tireTread;
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      const n = ws.knobs;
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * TAU, c = Math.cos(a), s = Math.sin(a);
        line(ctx, x + c * r * 0.86, y + s * r * 0.86, x + c * r * 0.99, y + s * r * 0.99);
      }
      ctx.stroke();
    }
    const rr = r * ws.rim;
    if (ws.wire) {
      // thin rim + wire spokes (dirt bike)
      ctx.strokeStyle = sh.rim;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      circle(ctx, x, y, rr);
      ctx.stroke();
      ctx.strokeStyle = sh.rimDark;
      ctx.lineWidth = r * 0.025;
      ctx.beginPath();
      for (let k = 0; k < ws.spokes; k++) {
        const a = rot + (k / ws.spokes) * TAU;
        const b = a + 0.5;
        line(ctx, x + Math.cos(a) * r * ws.hub, y + Math.sin(a) * r * ws.hub, x + Math.cos(b) * rr, y + Math.sin(b) * rr);
      }
      ctx.stroke();
    } else if (ws.disc) {
      // aero disc with glowing energy arcs (storm)
      ctx.fillStyle = sh.trim;
      ctx.beginPath();
      circle(ctx, x, y, rr);
      ctx.fill();
      ctx.strokeStyle = sh.accent;
      ctx.lineWidth = r * 0.07;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot + (k / 3) * TAU;
        ctx.moveTo(x + Math.cos(a) * rr * 0.78, y + Math.sin(a) * rr * 0.78);
        ctx.arc(x, y, rr * 0.78, a, a + 1.25);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = sh.accent;
      ctx.lineWidth = r * 0.035;
      ctx.beginPath();
      circle(ctx, x, y, rr);
      ctx.stroke();
      if (glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(glow, x - rr * 1.3, y - rr * 1.3, rr * 2.6, rr * 2.6);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      // rim disc + spokes
      ctx.fillStyle = sh.rim;
      ctx.beginPath();
      circle(ctx, x, y, rr);
      ctx.fill();
      ctx.fillStyle = sh.rimDark;
      ctx.beginPath();
      circle(ctx, x, y, rr * 0.82);
      ctx.fill();
      ctx.strokeStyle = sh.rim;
      ctx.lineWidth = r * (ws.alloy ? 0.13 : 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < ws.spokes; k++) {
        const a = rot + (k / ws.spokes) * TAU;
        line(ctx, x + Math.cos(a) * r * ws.hub, y + Math.sin(a) * r * ws.hub, x + Math.cos(a) * rr * 0.86, y + Math.sin(a) * rr * 0.86);
      }
      ctx.stroke();
      if (ws.beadlock) {
        // beadlock ring bolts
        ctx.fillStyle = sh.rimDark;
        ctx.beginPath();
        for (let k = 0; k < 12; k++) {
          const a = rot + (k / 12) * TAU;
          circle(ctx, x + Math.cos(a) * rr * 0.93, y + Math.sin(a) * rr * 0.93, r * 0.03);
        }
        ctx.fill();
      }
    }
    // hub cap
    ctx.fillStyle = sh.trim;
    ctx.beginPath();
    circle(ctx, x, y, r * ws.hub);
    ctx.fill();
    ctx.fillStyle = sh.rim;
    ctx.beginPath();
    circle(ctx, x, y, r * ws.hub * 0.45);
    ctx.fill();
  }

  // Original helmeted driver: rounded helmet coloured by the paint accent, dark visor stripe facing +x,
  // stripe over the crown, suit torso + arm to the wheel. `slump` 0..1 when crashed.
  function drawDriver(ctx, g, sh, slump, lean) {
    const h = g.head;
    const hx = h.x + 0.05 * h.r * slump, hy = h.y - 0.18 * h.r * slump;
    const hip = g.hip || { x: hx - 0.05, y: hy - 0.8 };
    const r = h.r;
    const tilt = -0.9 * slump + 0.25 * U.clamp(lean || 0, -1, 1);   // visor angle offset
    // torso
    const shx = hx - r * 0.25 + r * 0.6 * slump, shy = hy - r * 1.05 - r * 0.3 * slump;
    ctx.strokeStyle = sh.suit;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 1.15;
    ctx.beginPath();
    line(ctx, hip.x, hip.y + r * 0.3, shx, shy);
    ctx.stroke();
    ctx.strokeStyle = sh.suitLight;
    ctx.lineWidth = r * 0.28;
    ctx.beginPath();
    line(ctx, hip.x + r * 0.28, hip.y + r * 0.35, shx + r * 0.3, shy);
    ctx.stroke();
    // arm to the wheel / handlebar (dangles when slumped)
    const st = g.bar || g.steer || { x: hx + 0.4, y: hy - 0.4 };
    const hxh = slump > 0.5 ? shx + r * 0.6 : st.x, hyh = slump > 0.5 ? shy - r * 1.6 : st.y;
    const ex = (shx + hxh) / 2 + r * 0.1, ey = Math.min(shy, hyh) - r * 0.45;
    ctx.strokeStyle = sh.suit;
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(shx, shy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hxh, hyh);
    ctx.stroke();
    ctx.fillStyle = sh.trim;                   // glove
    ctx.beginPath();
    circle(ctx, hxh, hyh, r * 0.26);
    ctx.fill();
    // neck
    ctx.fillStyle = sh.trim;
    ctx.beginPath();
    circle(ctx, hx - r * 0.1, hy - r * 0.85, r * 0.42);
    ctx.fill();
    // helmet shell
    ctx.fillStyle = sh.helmet;
    ctx.beginPath();
    circle(ctx, hx, hy, r);
    ctx.fill();
    // crown stripe
    ctx.strokeStyle = sh.helmetStripe;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.74, 1.0 + tilt, 2.7 + tilt);
    ctx.stroke();
    // visor: circle segment facing forward
    const a1 = 0.42 + tilt, a2 = -0.5 + tilt;
    ctx.fillStyle = '#131722';
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.98, a1, a2, true);
    ctx.lineTo(hx + Math.cos(a2) * r * 0.2, hy + Math.sin(a2) * r * 0.55);
    ctx.lineTo(hx + Math.cos(a1) * r * 0.2, hy + Math.sin(a1) * r * 0.5);
    ctx.closePath();
    ctx.fill();
    // visor glint + shell highlight
    ctx.strokeStyle = 'rgba(160,230,255,0.75)';
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.8, a1 - 0.12, a1 - 0.5, true);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(hx - r * 0.3, hy + r * 0.45, r * 0.32, r * 0.16, 0.5, 0, TAU);
    ctx.fill();
  }

  // Additive light blob (glow sprite from particles.js, or a plain disc fallback).
  function glowAt(ctx, color, x, y, r, a) {
    const sp = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite(color) : null;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    if (sp) ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    else { ctx.fillStyle = color; ctx.beginPath(); circle(ctx, x, y, r * 0.4); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 2X COINS: warm gold aura behind the car (not on LOW) …
  function drawGoldAura(ctx, g, t, k) {
    const pulse = 0.8 + 0.2 * Math.sin(t * 5);
    const sp = RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite('#ffc933') : null;
    if (!sp) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42 * k * pulse;
    const w = g.L * 0.85 + 1.2, h = (g.roof - g.y0) * 0.9 + 1.0;
    ctx.drawImage(sp, g.rimC.x - w, g.rimC.y - h, w * 2, h * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // … and a gold rim traced around the body outline with twinkling glints running along it.
  function drawGoldRim(ctx, g, t, k, low) {
    const r = g.rim;
    if (!r || r.length < 6) return;
    const pulse = 0.75 + 0.25 * Math.sin(t * 6);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffd23f';
    for (let pass = low ? 1 : 0; pass < 2; pass++) {
      ctx.globalAlpha = (pass === 0 ? 0.28 : 0.85) * k * pulse;
      ctx.lineWidth = pass === 0 ? 0.2 : 0.05;
      ctx.beginPath();
      poly(ctx, r);
      ctx.stroke();
    }
    // two glints travelling around the rim
    const n = r.length / 2;
    ctx.fillStyle = '#fff6c8';
    for (let j = 0; j < 2; j++) {
      const u = ((t * 0.9 + j * 0.5) % 1) * n;
      const i = Math.floor(u), f = u - i, a = i % n, b = (i + 1) % n;
      const x = r[a * 2] + (r[b * 2] - r[a * 2]) * f, y = r[a * 2 + 1] + (r[b * 2 + 1] - r[a * 2 + 1]) * f;
      const s = 0.13;
      ctx.globalAlpha = 0.95 * k;
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x, y + s * 0.3); ctx.lineTo(x + s, y); ctx.lineTo(x, y - s * 0.3); ctx.closePath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.3, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.3, y); ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  const FLAME_LAYERS = [['#ff4a1c', 1, 0.22], ['#ffb03a', 0.72, 0.15], ['#fff4c2', 0.42, 0.08]];
  const ION_COLS = ['#2b6dff', '#44c8ff', '#dff8ff'], ION_LEN = [2.6, 1.8, 1.0], ION_WID = [0.2, 0.13, 0.06];
  function drawFlame(ctx, g, t, strength) {
    // layered flickering flame jets from the exhaust, pointing along exhaust.a (local frame)
    const e = g.exhaust;
    const c = Math.cos(e.a), s = Math.sin(e.a);
    const flick = 0.8 + 0.2 * Math.sin(t * 47) + 0.12 * Math.sin(t * 83 + 1.3);
    const L = (0.9 + 0.4 * strength) * flick;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const l = FLAME_LAYERS[k];
      const len = L * l[1], w = l[2];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = l[0];
      ctx.beginPath();
      ctx.moveTo(e.x - s * w, e.y + c * w);
      ctx.quadraticCurveTo(e.x + c * len * 0.5 - s * w * 1.1, e.y + s * len * 0.5 + c * w * 1.1, e.x + c * len, e.y + s * len);
      ctx.quadraticCurveTo(e.x + c * len * 0.5 + s * w * 1.1, e.y + s * len * 0.5 - c * w * 1.1, e.x + s * w, e.y - c * w);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    glowAt(ctx, '#ff9a2a', e.x + c * 0.3, e.y + s * 0.3, 0.9, 0.7);
  }

  function drawIonPlume(ctx, g, sh, t) {
    // blue ion plume: long soft cone + bright core + shock diamonds
    const e = g.exhaust;
    const c = Math.cos(e.a), s = Math.sin(e.a);
    const flick = 0.9 + 0.1 * Math.sin(t * 61);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const len = ION_LEN[k] * flick, w = ION_WID[k];
      ctx.globalAlpha = k === 0 ? 0.55 : 0.8;
      ctx.fillStyle = ION_COLS[k];
      ctx.beginPath();
      ctx.moveTo(e.x - s * w, e.y + c * w);
      ctx.lineTo(e.x + c * len, e.y + s * len);
      ctx.lineTo(e.x + s * w, e.y - c * w);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#e8fbff';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let k = 1; k <= 3; k++) {
      const d = k * 0.42 + (t * 3 - Math.floor(t * 3)) * 0.05, w = 0.07 * (1 - k * 0.2);
      const px = e.x + c * d, py = e.y + s * d;
      ctx.moveTo(px - c * 0.08, py - s * 0.08);
      ctx.lineTo(px - s * w, py + c * w);
      ctx.lineTo(px + c * 0.08, py + s * 0.08);
      ctx.lineTo(px + s * w, py - c * w);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    glowAt(ctx, '#3fb8ff', e.x + c * 0.5, e.y + s * 0.5, 1.4, 0.8);
  }

  function drawShield(ctx, g, t) {
    // translucent hex bubble around the whole vehicle (local frame)
    const cx = (g.x0 + g.x1) / 2, cy = (g.y0 - g.w[0].r - g.w[0].staticLen + g.roof) / 2 + 0.05;
    const rx = g.L / 2 + 0.7, ry = (g.roof - (g.y0 - g.w[0].r - 0.4)) / 2 + 0.45;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.fillStyle = 'rgba(80,230,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#6ef0ff';
    ctx.globalAlpha = 0.45 + 0.3 * pulse;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // ring of hex cells slowly orbiting the rim
    ctx.strokeStyle = 'rgba(140,250,255,0.35)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    const n = 16, hr = 0.2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + t * 0.25;
      const px = cx + Math.cos(a) * rx * 0.88, py = cy + Math.sin(a) * ry * 0.86;
      for (let j = 0; j <= 6; j++) {
        const b = (j / 6) * TAU + Math.PI / 6;
        const qx = px + Math.cos(b) * hr, qy = py + Math.sin(b) * hr;
        if (j === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
      }
    }
    ctx.stroke();
    // specular highlight arc
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.92, ry * 0.9, 0, 1.9, 2.6);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Dark wheel-well arch behind a wheel (closed bodies), drawn over the body before the wheel.
  function wheelWell(ctx, g, i, color) {
    const w = g.w[i], wy = w.my - w.staticLen;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(w.mx - w.r * 1.18, g.y0 + 0.02);
    ctx.arc(w.mx, wy, w.r * 1.14, Math.PI - 0.05, 0.05, true);
    ctx.lineTo(w.mx + w.r * 1.18, g.y0 + 0.02);
    ctx.closePath();
    ctx.fill();
  }
  // Fender flare arc over the top of the wheel (drawn after the wheel).
  function fender(ctx, g, i, color, k) {
    const w = g.w[i], wy = w.my - w.staticLen;
    ctx.strokeStyle = color;
    ctx.lineWidth = w.r * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(w.mx, wy, w.r * k, Math.PI * 0.92, Math.PI * 0.08, true);
    ctx.stroke();
  }

  function glassPoly(ctx, a, sh) {
    fillPoly(ctx, a, sh.glass);
    // diagonal highlight streak
    ctx.strokeStyle = sh.glassHi;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    const mx = (a[0] + a[4]) / 2, my = (a[1] + a[5]) / 2;
    line(ctx, mx - 0.05, a[1] + 0.05, mx + 0.18, a[3] - 0.05);
    ctx.stroke();
  }

  // ------------------------------------------------------------------ per-style body painters
  // Each gets (ctx, g, sh, wl, st) and draws the chassis + driver in the local frame. Wheels are drawn
  // by the caller afterwards, then `over` (fenders, cage tubes etc.) if defined.
  const PAINT = {
    buggy: {
      body(ctx, g, sh, st) {
        // engine + exhaust pipe
        fillPoly(ctx, g.engine, sh.trim);
        ctx.strokeStyle = sh.trimLight;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        for (let k = 1; k <= 3; k++) { const y = 0.22 + k * 0.075; line(ctx, g.x0 + 0.16, y, g.x0 + 0.58, y + 0.01); }
        ctx.stroke();
        ctx.strokeStyle = PIPE;
        ctx.lineWidth = 0.07;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(g.pipe[0], g.pipe[1]);
        ctx.quadraticCurveTo(g.pipe[2], g.pipe[3], g.pipe[4], g.pipe[5]);
        ctx.stroke();
        fillPoly(ctx, g.seat, sh.trim);
        drawDriver(ctx, g, sh, st.slump, 0);
        fillPoly(ctx, g.tub, sh.body);
        fillPoly(ctx, g.nose, sh.bodyLight);
        // side stripe + number panel
        ctx.strokeStyle = sh.accent;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        line(ctx, g.stripe[0], g.stripe[1], g.stripe[2], g.stripe[3]);
        ctx.stroke();
        ctx.fillStyle = sh.bodyDark;
        ctx.beginPath();
        line(ctx, g.x0 + 0.34, g.y0 + 0.07, g.x1 - 0.78, g.y0 + 0.07);
        ctx.lineTo(g.x1 - 0.7, g.y0 + 0.16);
        ctx.lineTo(g.x0 + 0.3, g.y0 + 0.16);
        ctx.closePath();
        ctx.fill();
      },
      over(ctx, g, sh) {
        // roll cage tubes over everything (dark tube + light highlight)
        ctx.lineCap = 'round';
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.085;
        ctx.beginPath();
        for (let i = 0; i < g.cage.length; i += 4) line(ctx, g.cage[i], g.cage[i + 1], g.cage[i + 2], g.cage[i + 3]);
        ctx.stroke();
        ctx.strokeStyle = sh.trimLight;
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        for (let i = 0; i < 12; i += 4) line(ctx, g.cage[i], g.cage[i + 1] + 0.02, g.cage[i + 2], g.cage[i + 3] + 0.02);
        ctx.stroke();
      }
    },
    dirt: {
      body(ctx, g, sh, st) {
        // rear swingarm + shock are drawn as the suspension (see drawSuspension); here: frame & bodywork
        ctx.lineCap = 'round';
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        for (let i = 0; i < g.frame.length; i += 4) line(ctx, g.frame[i], g.frame[i + 1], g.frame[i + 2], g.frame[i + 3]);
        ctx.stroke();
        fillPoly(ctx, g.engine, '#3a3e48');
        ctx.strokeStyle = '#5b606c';
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) { const y = -0.07 - k * 0.06; line(ctx, g.engine[0] + 0.04, y, g.engine[2] - 0.02, y); }
        ctx.stroke();
        // exhaust pipe
        ctx.strokeStyle = PIPE;
        ctx.lineWidth = 0.065;
        ctx.beginPath();
        ctx.moveTo(g.pipe[0], g.pipe[1]);
        ctx.bezierCurveTo(g.pipe[2], g.pipe[3], g.pipe[4], g.pipe[5], g.pipe[6], g.pipe[7]);
        ctx.stroke();
        fillPoly(ctx, g.tail, sh.body);
        fillPoly(ctx, g.seat, sh.trim);
        fillPoly(ctx, g.tank, sh.body);
        ctx.fillStyle = sh.accent;
        ctx.beginPath();
        ctx.moveTo(g.tank[0] + 0.1, g.tank[1] - 0.04);
        ctx.lineTo(g.tank[2] - 0.08, g.tank[3] - 0.05);
        ctx.lineTo(g.tank[2] - 0.12, g.tank[3] - 0.12);
        ctx.lineTo(g.tank[0] + 0.08, g.tank[1] - 0.1);
        ctx.closePath();
        ctx.fill();
        // leg (hip → knee → peg), behind the rider's torso
        const hip = g.hip, peg = g.peg, lean = U.clamp(st.lean, -1, 1) * 0.06;
        const kx = g.tank[0] + 0.05 + lean, ky = 0.18;
        ctx.strokeStyle = sh.suit;
        ctx.lineWidth = 0.17;
        ctx.beginPath();
        ctx.moveTo(hip.x, hip.y);
        ctx.lineTo(kx, ky);
        ctx.lineTo(peg.x, peg.y + 0.06);
        ctx.stroke();
        ctx.fillStyle = '#20232b';
        ctx.beginPath();
        roundRect(ctx, peg.x - 0.06, peg.y - 0.02, 0.22, 0.1, 0.03);
        ctx.fill();
        drawDriver(ctx, g, sh, st.slump, st.lean);
        // handlebar
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        line(ctx, g.steerHead.x, g.steerHead.y, g.bar.x, g.bar.y);
        ctx.stroke();
      },
      over(ctx, g, sh, wl) {
        // front fender follows the fork (hovers over the front wheel), number plate on the fork
        const w = wl[1], r = g.w[1].r;
        ctx.fillStyle = sh.body;
        ctx.beginPath();
        ctx.moveTo(w.x - r * 0.9, w.y + r * 1.02);
        ctx.quadraticCurveTo(w.x, w.y + r * 1.45, w.x + r * 1.05, w.y + r * 0.95);
        ctx.lineTo(w.x + r * 0.95, w.y + r * 0.85);
        ctx.quadraticCurveTo(w.x, w.y + r * 1.25, w.x - r * 0.85, w.y + r * 0.9);
        ctx.closePath();
        ctx.fill();
        fillPoly(ctx, g.plate, sh.accent);
        ctx.fillStyle = sh.trim;
        ctx.beginPath();
        roundRect(ctx, g.plate[0] + 0.06, g.plate[1] + 0.1, 0.08, 0.2, 0.03);
        ctx.fill();
      }
    },
    truck: {
      body(ctx, g, sh, st) {
        drawDriver(ctx, g, sh, st.slump, 0);
        // body with the cab window cut out (even-odd) so the driver shows through
        ctx.fillStyle = sh.body;
        ctx.beginPath();
        poly(ctx, g.body);
        poly(ctx, g.window);
        ctx.fill('evenodd');
        // lower rocker shade
        ctx.fillStyle = sh.bodyDark;
        ctx.beginPath();
        line(ctx, g.x0 + 0.1, g.y0 + 0.06, g.x1 - 0.1, g.y0 + 0.06);
        ctx.lineTo(g.x1 + 0.02, -0.24);
        ctx.lineTo(g.x1 + 0.02, -0.18);
        ctx.lineTo(g.x0, -0.2);
        ctx.lineTo(g.x0, -0.28);
        ctx.closePath();
        ctx.fill();
        wheelWell(ctx, g, 0, '#15161a');
        wheelWell(ctx, g, 1, '#15161a');
        glassPoly(ctx, g.window, sh);
        // stripe, bed, rails, grille, bumpers
        ctx.strokeStyle = sh.accent;
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        line(ctx, g.stripe[0], g.stripe[1], g.w[0].mx - g.w[0].r * 1.2, g.stripe[3]);
        line(ctx, g.w[0].mx + g.w[0].r * 1.2, g.stripe[1], g.w[1].mx - g.w[1].r * 1.2, g.stripe[3]);
        ctx.stroke();
        ctx.strokeStyle = sh.bodyDeep;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        line(ctx, g.bedLine[0], g.bedLine[1], g.bedLine[2], g.bedLine[3]);
        line(ctx, g.head.x + 0.45, 0.42, g.head.x + 0.45, -0.1);          // door seam
        ctx.stroke();
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        line(ctx, g.rail[0], g.rail[1], g.rail[2], g.rail[3]);
        ctx.stroke();
        fillPoly(ctx, g.grille, sh.trim);
        ctx.strokeStyle = sh.trimLight;
        ctx.lineWidth = 0.02;
        ctx.beginPath();
        for (let k = 1; k < 4; k++) { const y = -0.12 + k * 0.09; line(ctx, g.x1 - 0.09, y, g.x1 + 0.01, y); }
        ctx.stroke();
        fillPoly(ctx, g.bumpers, sh.trim);
        // door handle + mirror
        ctx.fillStyle = sh.trim;
        ctx.beginPath();
        roundRect(ctx, g.head.x + 0.18, 0.24, 0.16, 0.05, 0.02);
        roundRect(ctx, g.head.x + 0.66, 0.5, 0.1, 0.14, 0.03);
        ctx.fill();
        // roof light bar
        const lb = g.lightBar;
        ctx.fillStyle = sh.trim;
        ctx.beginPath();
        roundRect(ctx, lb.x0, lb.y - 0.06, lb.x1 - lb.x0, 0.12, 0.04);
        ctx.fill();
        ctx.fillStyle = st.headlights ? '#fff6c8' : '#f3d27a';
        ctx.beginPath();
        for (let k = 0; k < 4; k++) circle(ctx, lb.x0 + 0.1 + k * (lb.x1 - lb.x0 - 0.2) / 3, lb.y, 0.045);
        ctx.fill();
        if (st.headlights) for (let k = 0; k < 4; k++) glowAt(ctx, '#ffe9a8', lb.x0 + 0.1 + k * (lb.x1 - lb.x0 - 0.2) / 3, lb.y, 0.35, 0.8);
        // headlight + tail light
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        roundRect(ctx, g.x1 - 0.06, 0.1, 0.09, 0.12, 0.03);
        ctx.fill();
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath();
        roundRect(ctx, g.x0 - 0.02, 0.12, 0.07, 0.16, 0.02);
        ctx.fill();
      },
      over(ctx, g, sh) {
        fender(ctx, g, 0, sh.trim, g.wheelStyle.fenderR);
        fender(ctx, g, 1, sh.trim, g.wheelStyle.fenderR);
      }
    },
    rally: {
      body(ctx, g, sh, st) {
        drawDriver(ctx, g, sh, st.slump, 0);
        ctx.fillStyle = sh.body;
        ctx.beginPath();
        poly(ctx, g.body);
        poly(ctx, g.window);
        ctx.fill('evenodd');
        wheelWell(ctx, g, 0, '#121317');
        wheelWell(ctx, g, 1, '#121317');
        glassPoly(ctx, g.window, sh);
        ctx.strokeStyle = sh.body;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        line(ctx, g.pillar[0], g.pillar[1], g.pillar[2], g.pillar[3]);
        ctx.stroke();
        // livery: twin stripes broken by the wheel arches, bonnet stripe, door roundel
        ctx.strokeStyle = sh.accent;
        ctx.lineWidth = 0.065;
        ctx.beginPath();
        for (let k = 0; k < 8; k += 4) {
          const y = g.stripes[k + 1];
          line(ctx, g.stripes[k], y, g.w[0].mx - g.w[0].r * 1.16, y);
          line(ctx, g.w[0].mx + g.w[0].r * 1.16, y, g.w[1].mx - g.w[1].r * 1.16, y);
          line(ctx, g.w[1].mx + g.w[1].r * 1.16, y, g.stripes[k + 2], y);
        }
        ctx.stroke();
        const rd = g.roundel;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        circle(ctx, rd.x, rd.y, rd.r);
        ctx.fill();
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        circle(ctx, rd.x, rd.y, rd.r * 0.78);
        // stylised racing number: two strokes
        line(ctx, rd.x - rd.r * 0.35, rd.y + rd.r * 0.4, rd.x + rd.r * 0.35, rd.y + rd.r * 0.4);
        ctx.lineTo(rd.x - rd.r * 0.1, rd.y - rd.r * 0.45);
        ctx.stroke();
        // side skirt, spoiler, rally lamps, light
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        line(ctx, g.w[0].mx + g.w[0].r * 1.14, g.y0 + 0.1, g.w[1].mx - g.w[1].r * 1.14, g.y0 + 0.1);
        ctx.stroke();
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (let i = 0; i < g.spoilerStruts.length; i += 4) line(ctx, g.spoilerStruts[i], g.spoilerStruts[i + 1], g.spoilerStruts[i + 2], g.spoilerStruts[i + 3]);
        ctx.stroke();
        fillPoly(ctx, g.spoiler, sh.trim);
        ctx.fillStyle = sh.accent;
        ctx.beginPath();
        roundRect(ctx, g.spoiler[0] + 0.02, g.spoiler[1] - 0.03, 0.08, 0.05, 0.01);
        ctx.fill();
        for (const l of g.rallyLamps) {
          ctx.fillStyle = sh.trim;
          ctx.beginPath(); circle(ctx, l.x, l.y, 0.09); ctx.fill();
          ctx.fillStyle = st.headlights ? '#fffbe0' : '#ffe79a';
          ctx.beginPath(); circle(ctx, l.x, l.y, 0.06); ctx.fill();
          if (st.headlights) glowAt(ctx, '#fff0b0', l.x, l.y, 0.35, 0.7);
        }
        ctx.fillStyle = '#fff6cf';
        ctx.beginPath();
        roundRect(ctx, g.x1 - 0.14, 0.0, 0.14, 0.08, 0.03);
        ctx.fill();
        ctx.fillStyle = '#ff3848';
        ctx.beginPath();
        roundRect(ctx, g.x0 - 0.01, 0.2, 0.08, 0.1, 0.02);
        ctx.fill();
      },
      over(ctx, g, sh) {
        fender(ctx, g, 0, sh.bodyDark, g.wheelStyle.fenderR);
        fender(ctx, g, 1, sh.bodyDark, g.wheelStyle.fenderR);
        // mud flaps behind each wheel
        ctx.fillStyle = sh.trim;
        ctx.beginPath();
        for (let i = 0; i < 2; i++) {
          const x = g.flaps[i], wy = g.w[i].my - g.w[i].staticLen;
          roundRect(ctx, x - 0.05, wy - g.w[i].r * 0.85, 0.1, g.w[i].r * 0.85, 0.02);
        }
        ctx.fill();
      }
    },
    crawler: {
      body(ctx, g, sh, st) {
        // spare tyre strapped on the back
        const sp = g.spare;
        ctx.fillStyle = sh.wheel;
        ctx.beginPath(); ctx.ellipse(sp.x, sp.y, sp.r * 0.45, sp.r, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = sh.rimDark;
        ctx.beginPath(); ctx.ellipse(sp.x, sp.y, sp.r * 0.22, sp.r * 0.5, 0, 0, TAU); ctx.fill();
        // ladder frame rails
        ctx.lineCap = 'round';
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        line(ctx, g.rails[0], g.rails[1], g.rails[2], g.rails[3]);
        ctx.stroke();
        ctx.strokeStyle = sh.trimLight;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        line(ctx, g.rails[0], g.rails[1] + 0.03, g.rails[2], g.rails[3] + 0.03);
        for (let k = 0; k < 5; k++) {
          const x = U.lerp(g.rails[0] + 0.3, g.rails[2] - 0.3, k / 4);
          circle(ctx, x, g.rails[1], 0.025);
        }
        ctx.stroke();
        drawDriver(ctx, g, sh, st.slump, 0);
        fillPoly(ctx, g.tub, sh.body);
        ctx.fillStyle = sh.bodyDark;
        ctx.beginPath();
        line(ctx, g.tub[0], g.tub[1], g.tub[2], g.tub[3]);
        ctx.lineTo(g.tub[2] + 0.03, 0.02);
        ctx.lineTo(g.tub[0] - 0.02, 0.02);
        ctx.closePath();
        ctx.fill();
        // hood vents + snorkel
        ctx.strokeStyle = sh.bodyDeep;
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) line(ctx, g.hoodVents[0] + k * 0.1, 0.24, g.hoodVents[0] + k * 0.1 + 0.08, 0.3);
        ctx.stroke();
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(g.snorkel[0], g.snorkel[1]);
        ctx.lineTo(g.snorkel[2], g.snorkel[3]);
        ctx.lineTo(g.snorkel[4], g.snorkel[5]);
        ctx.stroke();
        // bumpers + winch (drum, cable, hook)
        fillPoly(ctx, g.bumper, sh.trim);
        fillPoly(ctx, g.rearBumper, sh.trim);
        const wn = g.winch;
        ctx.fillStyle = sh.accent;
        ctx.beginPath(); roundRect(ctx, wn.x - 0.16, wn.y - 0.07, 0.2, 0.14, 0.04); ctx.fill();
        ctx.strokeStyle = sh.accentDark;
        ctx.lineWidth = 0.02;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) line(ctx, wn.x - 0.12 + k * 0.05, wn.y - 0.06, wn.x - 0.12 + k * 0.05, wn.y + 0.06);
        ctx.stroke();
        ctx.strokeStyle = '#c9ccd2';
        ctx.lineWidth = 0.018;
        ctx.beginPath();
        ctx.moveTo(wn.x + 0.04, wn.y);
        ctx.quadraticCurveTo(wn.x + 0.16, wn.y - 0.04, wn.x + 0.2, wn.y - 0.14);
        ctx.stroke();
        ctx.strokeStyle = '#9aa0aa';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.arc(wn.x + 0.2, wn.y - 0.2, 0.05, Math.PI * 0.5, Math.PI * 2.1);
        ctx.stroke();
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath(); roundRect(ctx, g.x0 + 0.24, 0.26, 0.07, 0.1, 0.02); ctx.fill();
      },
      over(ctx, g, sh, wl, st) {
        // tube cage + roof rack + light bar
        ctx.lineCap = 'round';
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.09;
        ctx.beginPath();
        for (let i = 0; i < g.cage.length; i += 4) line(ctx, g.cage[i], g.cage[i + 1], g.cage[i + 2], g.cage[i + 3]);
        const rk = g.rack;
        line(ctx, rk.x0, rk.y, rk.x1, rk.y);
        ctx.stroke();
        ctx.strokeStyle = sh.accent;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        for (let i = 0; i < 12; i += 4) line(ctx, g.cage[i], g.cage[i + 1] + 0.025, g.cage[i + 2], g.cage[i + 3] + 0.025);
        ctx.stroke();
        ctx.fillStyle = sh.trim;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) circle(ctx, rk.x0 + 0.14 + k * (rk.x1 - rk.x0 - 0.28) / 3, rk.y + 0.1, 0.075);
        ctx.fill();
        ctx.fillStyle = st.headlights ? '#fffbe0' : '#e9e2b8';
        ctx.beginPath();
        for (let k = 0; k < 4; k++) circle(ctx, rk.x0 + 0.14 + k * (rk.x1 - rk.x0 - 0.28) / 3, rk.y + 0.1, 0.05);
        ctx.fill();
        if (st.headlights) for (let k = 0; k < 4; k++) glowAt(ctx, '#fff0b0', rk.x0 + 0.14 + k * (rk.x1 - rk.x0 - 0.28) / 3, rk.y + 0.1, 0.35, 0.7);
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath(); circle(ctx, g.lamp.x, g.lamp.y, 0.08); ctx.fill();
      }
    },
    storm: {
      body(ctx, g, sh, st, t) {
        drawDriver(ctx, g, sh, st.slump, 0);
        // nozzle + fin behind the hull
        fillPoly(ctx, g.nozzle, sh.trim);
        fillPoly(ctx, g.body, sh.body);
        fillPoly(ctx, g.fin, sh.bodyDark);
        fillPoly(ctx, g.pod, sh.bodyDeep);
        // panel facets (lighter upper hull plane)
        ctx.fillStyle = sh.bodyLight;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.moveTo(g.x1 + 0.06, -0.02);
        ctx.lineTo(g.x1 - 0.4, 0.14);
        ctx.lineTo(g.head.x + 0.8, 0.34);
        ctx.lineTo(g.head.x + 0.9, 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        wheelWell(ctx, g, 0, '#0c0d12');
        wheelWell(ctx, g, 1, '#0c0d12');
        // canopy bubble
        const cp = g.canopy;
        ctx.fillStyle = 'rgba(90,240,255,0.26)';
        ctx.beginPath();
        ctx.moveTo(cp.x0, cp.y0);
        ctx.bezierCurveTo(cp.x0 + 0.1, cp.top + 0.02, cp.x1 - 0.7, cp.top + 0.05, cp.x1, cp.y1);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = sh.trim;
        ctx.lineWidth = 0.035;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(cp.x0 + 0.2, cp.y0 + 0.2);
        ctx.quadraticCurveTo(cp.x0 + 0.35, cp.top - 0.04, cp.x0 + 0.7, cp.top - 0.06);
        ctx.stroke();
        // glowing energy lines (pulse travels along the body)
        const pulse = 0.6 + 0.4 * Math.sin(t * 5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = sh.accent;
        for (let pass = 0; pass < 2; pass++) {
          ctx.globalAlpha = pass === 0 ? 0.3 * pulse : 0.95;
          ctx.lineWidth = pass === 0 ? 0.14 : 0.035;
          ctx.beginPath();
          ctx.moveTo(g.energy[0], g.energy[1]);
          for (let i = 2; i < g.energy.length; i += 2) ctx.lineTo(g.energy[i], g.energy[i + 1]);
          line(ctx, g.energy2[0], g.energy2[1], g.energy2[2], g.energy2[3]);
          ctx.stroke();
        }
        // nozzle ring glows
        ctx.globalAlpha = 0.6 + 0.4 * pulse;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.ellipse(g.x0 - 0.2, 0.2, 0.05, 0.16, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        // LED headlight strip
        ctx.strokeStyle = st.headlights ? '#ffffff' : sh.accent;
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        line(ctx, g.x1 - 0.34, 0.12, g.x1 + 0.02, 0.0);
        ctx.stroke();
      },
      over(ctx, g, sh) {
        fender(ctx, g, 0, sh.bodyDark, g.wheelStyle.fenderR);
        fender(ctx, g, 1, sh.bodyDark, g.wheelStyle.fenderR);
      }
    }
  };

  // Suspension: coilover struts (cars) or swingarm + fork (dirt bike).
  function drawSuspension(ctx, g, sh, wl) {
    if (g.bike) {
      const rw = wl[0], fw = wl[1], r = g.w[0].r;
      // swingarm pivot → rear axle, plus a mono-shock from the frame to the arm
      ctx.lineCap = 'round';
      ctx.strokeStyle = sh.trim;
      ctx.lineWidth = r * 0.2;
      ctx.beginPath();
      line(ctx, g.pivot.x, g.pivot.y, rw.x, rw.y);
      ctx.stroke();
      const mx = U.lerp(g.pivot.x, rw.x, 0.45), my = U.lerp(g.pivot.y, rw.y, 0.45);
      drawStrut(ctx, g.pivot.x - 0.12, 0.26, mx, my + 0.04, sh, r * 0.8, 'dirt');
      // telescopic fork from the steering head to the front axle: compresses with the wheel
      const sh0 = g.steerHead;
      ctx.strokeStyle = sh.rim;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      line(ctx, sh0.x, sh0.y, fw.x, fw.y);
      ctx.stroke();
      ctx.strokeStyle = sh.accent;
      ctx.lineWidth = r * 0.2;
      ctx.beginPath();
      line(ctx, U.lerp(sh0.x, fw.x, 0.5), U.lerp(sh0.y, fw.y, 0.5), fw.x, fw.y);
      ctx.stroke();
      return;
    }
    for (let i = 0; i < 2; i++) drawStrut(ctx, g.w[i].mx, g.w[i].my, wl[i].x, wl[i].y, sh, g.w[i].r, g.style);
  }

  // ------------------------------------------------------------------ public API
  const ST = { slump: 0, lean: 0, headlights: false };

  // WORLD transform (y-up metres) must be set by the caller.
  function draw(ctx, body, tuned, colors, t, opts) {
    if (!ctx || !body) return;
    const bx = body.x, by = body.y, ang = U.safeNum(body.angle, 0);
    if (!isNum(bx) || !isNum(by)) return;
    t = U.safeNum(t, 0);
    opts = opts || DEF_OPTS;
    const g = geometry(tuned || {});
    const sh = shades(colors || DEFAULT_COLORS);
    const wl = localWheels(body, g);
    ST.slump = opts.crashed ? 1 : 0;
    ST.lean = U.safeNum(opts.lean, 0);
    ST.headlights = !!opts.headlights;
    const painter = PAINT[g.style];
    // subtle engine shimmy with throttle (never while crashed)
    const thr = opts.crashed ? 0 : U.clamp(Math.abs(U.safeNum(opts.throttle, 0)), 0, 1);
    const shim = thr > 0 ? Math.sin(t * 70) * 0.006 * thr : 0;

    ctx.save();
    ctx.translate(bx, by + shim);
    ctx.rotate(ang);
    ctx.lineJoin = 'round';
    if (opts.thruster) drawIonPlume(ctx, g, sh, t);
    if (opts.boost) drawFlame(ctx, g, t, opts.boost === true ? 1 : U.clamp(U.safeNum(opts.boost, 1), 0, 1.5));
    const mult = opts.multiplier === true ? 1 : U.clamp(U.safeNum(opts.multiplier, 0), 0, 1);
    const low = opts.quality === 'low';
    if (mult > 0.01 && !low) drawGoldAura(ctx, g, t, mult);
    drawSuspension(ctx, g, sh, wl);
    painter.body(ctx, g, sh, ST, t);
    const glow = g.wheelStyle.disc && RR.Particles && RR.Particles.glowSprite ? RR.Particles.glowSprite(sh.accent) : null;
    for (let i = 0; i < 2; i++) drawWheel(ctx, wl[i].x, wl[i].y - shim, g.w[i].r, wl[i].rot, sh, g.wheelStyle, t, glow);
    if (painter.over) painter.over(ctx, g, sh, wl, ST);
    if (opts.headlights) {
      glowAt(ctx, '#fff2c0', g.lamp.x + 0.08, g.lamp.y, 0.5, 0.8);
      glowAt(ctx, '#ffffff', g.lamp.x, g.lamp.y, 0.16, 0.8);
    }
    if (mult > 0.01) drawGoldRim(ctx, g, t, mult, low);
    if (opts.shield) drawShield(ctx, g, t);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function toWorld(body, lx, ly, out) {
    const a = U.safeNum(body.angle, 0), c = Math.cos(a), s = Math.sin(a);
    out.x = U.safeNum(body.x, 0) + lx * c - ly * s;
    out.y = U.safeNum(body.y, 0) + lx * s + ly * c;
    return a;
  }
  function lampPoint(body, tuned, out) {
    out = out || { x: 0, y: 0, angle: 0 };
    const g = geometry(tuned || {});
    out.angle = toWorld(body || {}, g.lamp.x, g.lamp.y, out);
    return out;
  }
  function exhaustPoint(body, tuned, out) {
    out = out || { x: 0, y: 0, angle: 0 };
    const g = geometry(tuned || {});
    out.angle = toWorld(body || {}, g.exhaust.x, g.exhaust.y, out) + g.exhaust.a;
    return out;
  }

  // UI preview (screen px, y-down): idle pose built from stock tuning, fitted & centred in w×h,
  // with a soft ground shadow and a gentle suspension bob animated by t.
  const previewTuned = new Map();
  const previewBody = {
    x: 0, y: 0, angle: 0,
    wheels: [{ x: 0, y: 0, spin: 0, compression: 0.4 }, { x: 0, y: 0, spin: 0, compression: 0.4 }]
  };
  function drawPreview(ctx, vehicleId, colors, w, h, t) {
    if (!ctx) return;
    w = U.safeNum(w, 300); h = U.safeNum(h, 160); t = U.safeNum(t, 0);
    if (w <= 0 || h <= 0) return;
    let tuned = previewTuned.get(vehicleId);
    if (!tuned) {
      const V = RR.Vehicles;
      try { tuned = V && V.getTuned ? V.getTuned(vehicleId, {}) : null; } catch (e) { tuned = null; }
      if (!tuned) tuned = { style: 'buggy' };
      previewTuned.set(vehicleId, tuned);
    }
    let pal = colors;
    if (!pal || typeof pal !== 'object') {
      const def = RR.Vehicles && RR.Vehicles.byId ? RR.Vehicles.byId(vehicleId) : null;
      pal = (def && def.colors) || DEFAULT_COLORS;
    }
    const g = geometry(tuned);
    const r = Math.max(g.w[0].r, g.w[1].r);
    // rest pose: wheels on the ground (y = r), chassis at the static suspension length above them
    const rideH = r + (g.w[0].staticLen + g.w[1].staticLen) / 2 - (g.w[0].my + g.w[1].my) / 2;
    const bob = 0.03 * Math.sin(t * 2.3) + 0.012 * Math.sin(t * 5.1);
    const minX = Math.min(g.x0 - 0.3, g.w[0].mx - g.w[0].r) - 0.3;
    const maxX = Math.max(g.x1 + 0.15, g.w[1].mx + g.w[1].r) + 0.2;
    const top = rideH + g.roof + 0.25;
    const s = Math.max(1, Math.min((w * 0.9) / (maxX - minX), (h * 0.82) / top));
    const b = previewBody;
    b.x = 0; b.y = rideH + bob; b.angle = 0;
    for (let i = 0; i < 2; i++) {
      b.wheels[i].x = g.w[i].mx;
      b.wheels[i].y = g.w[i].r;
      b.wheels[i].spin = 0;
      b.wheels[i].compression = U.clamp(0.4 - bob * 4, 0, 1);
    }
    ctx.save();
    ctx.translate(w / 2 - ((minX + maxX) / 2) * s, h * 0.5 + (top * s) / 2);
    ctx.scale(s, -s);
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse((minX + maxX) / 2, 0.02, (maxX - minX) * 0.46, 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(g.w[0].mx, 0.02, g.w[0].r * 0.9, 0.07, 0, 0, TAU);
    ctx.ellipse(g.w[1].mx, 0.02, g.w[1].r * 0.9, 0.07, 0, 0, TAU);
    ctx.fill();
    draw(ctx, b, tuned, pal, t, DEF_OPTS);
    ctx.restore();
  }

  RR.VehicleArt = Object.freeze({ draw, drawPreview, lampPoint, exhaustPoint, STYLES });
})();
