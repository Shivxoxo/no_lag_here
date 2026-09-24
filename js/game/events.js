/* RIDGE RUSH — random events, major sections, boss runs, hazards & dynamic obstacles (RR.EventSystem).
 *
 * Contract: docs/ARCHITECTURE.md §5.11.
 *   new RR.EventSystem(run); ev.update(dt); ev.drawWorld(ctx, run); ev.drawScreen(ctx, run)
 *
 * Overview
 *  - SCHEDULER: seeded by run.rng('events'). First event once the vehicle passes 350 m, then every
 *    20–40 s of simulated time (shorter on harder worlds, deeper into a run, in storm worlds and in
 *    volcano sections). Weighted pick from world.events, no immediate repeats. Hazards never overlap,
 *    never start within 5 s of a shield rescue (run.invulnTime), never during (or right before) a boss
 *    climb. Attract mode only runs harmless events.
 *  - FAIRNESS: every hazard calls run.warn(text, 'hazard') + RR.Audio.play('warning') and shows a world
 *    marker the moment it is scheduled; nothing can hurt the player until ≥ 1.5 s later (a hard guard in
 *    _damageOk() enforces it even if a design constant changes). No damage while run.invulnTime > 0.
 *  - SECTIONS: terrain.sectionAt(x) drives banners and smooth env blends (storm / cave / volcano / moon),
 *    each blend weight is a bounded 0..1 state that eases toward its target; env is RECOMPUTED every
 *    update from base world values + blends + active events, so nothing accumulates or drifts.
 *  - BOSS: run.boss progress, one-time summit reward, boss music.
 *  - PADS: terrain 'bouncepad' / 'boostpad' features are applied (and drawn) here.
 *  - All physics objects (rocks, meteors, markers, scorch marks, bolts) live in fixed pools; per-frame
 *    work allocates nothing. Event records themselves are allocated once per event (every ~30 s).
 *
 * Contract notes / additions (callers may ignore all of these):
 *  - ev.forceEvent(id) → bool     start an event now (dev tools / tests); still respects feasibility,
 *                                 but ignores the timer, hazard-overlap and boss rules.
 *  - ev.reset()                   drop every event/object, restore boss music, recompute env from base.
 *  - ev.destroy()                 reset() + detach from the run.
 *  - ev.active                    read-only list of active event records {id, hazard, t, warnedAt, ...}.
 *  - ev.hazardActive() → bool; ev.stats {started{id:n}, knocks, crashes, fuelZaps, launches, bossCleared}
 *  - ev.onDamage = fn(id, kind, sinceWarning)  optional hook called on every hazard hit (tests, analytics).
 *  - RR.EventSystem.EVENT_IDS, RR.EventSystem.HAZARDS (ids that count as hazards), RR.EventSystem.MIN_TELEGRAPH.
 *  - 'wind_gust' is treated as a hazard for scheduling (never overlaps a hazard, not in attract mode),
 *    although it never damages the vehicle directly.
 *  - Env ownership: env.gravityMul is the EVENT/SECTION multiplier only (1 outside moon sections); daily
 *    modifier gravity is expected to be folded into env.gravity by Run. env.rain is 0 outside storm
 *    sections (world ambient weather is the Background's job). env.tint is null or an rgba() string.
 *  - run.boss also carries {tier, end, cleared}. It is set to null once the vehicle passes the section end.
 *  - Coin values passed to collectibles.addCoin are base denominations (5 / 25 / 100); Collectibles applies
 *    world / modifier multipliers.
 *  - Lava eruptions can also occur inside volcano sections of worlds whose pool lacks 'lava_eruption'.
 *  - In attract mode no warnings/banners/audio are emitted and nothing can damage the vehicle.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const clamp = U.clamp, lerp = U.lerp, isNum = U.isNum, safeNum = U.safeNum;
  const smoothstep = U.smoothstep, approach = U.approach;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ tunables
  const FIRST_EVENT_X = 350;        // m — no random events before this distance
  const MIN_TELEGRAPH = 1.5;        // s — minimum warning before anything can hurt
  const SHIELD_GRACE = 5;           // s after a shield rescue during which no hazard starts
  const BOSS_LOOKAHEAD = 300;       // m — no new events this close before a boss section
  const MAX_ACTIVE = 3;             // concurrent events (only one of them may be a hazard)
  const ROCK_TELEGRAPH = 1.8;       // s between the warning and the first rock drop
  const METEOR_TELEGRAPH = 1.8;
  const LIGHTNING_TELEGRAPH = 1.8;
  const LAVA_TELEGRAPH = 2.0;
  const DRONE_ARM = 1.6;            // drones are harmless for this long after spawning
  const DRONE_LOW = 1.4, DRONE_HIGH = 5.4; // drone centre height band above the ground (m)

  const EVENT_IDS = Object.freeze(['falling_rocks', 'bird', 'coin_storm', 'fuel_zone', 'wind_gust',
    'steep_surprise', 'meteor_shower', 'lava_eruption', 'moving_ramp', 'drones', 'lightning']);
  const HAZARDS = Object.freeze(['falling_rocks', 'meteor_shower', 'lava_eruption', 'drones', 'lightning', 'wind_gust']);
  const IS_HAZARD = Object.create(null);
  for (const id of HAZARDS) IS_HAZARD[id] = true;

  const SECTION_FALLBACK = {
    canyon: { name: 'THE CANYON', sub: 'Big air ahead — keep your speed up!' },
    storm: { name: 'THE STORM', sub: 'Brace for violent winds!' },
    cave: { name: 'THE CAVE', sub: 'Lights on. Mind the ceiling.' },
    volcano: { name: 'THE VOLCANO', sub: 'Lava everywhere — jump the pools!' },
    moon: { name: 'THE MOON', sub: 'Gravity is taking a break.' },
    boss: { name: 'BOSS RUN', sub: 'Reach the summit!' }
  };
  const BLEND_KEYS = ['storm', 'cave', 'volcano', 'moon'];
  const BLEND_RATE = { storm: 0.5, cave: 0.45, volcano: 0.8, moon: 1 };   // per second (1/ramp time)

  // Volcano tint strings, pre-built so env.tint never allocates per frame.
  const TINT_STEPS = 12;
  const TINTS = [];
  for (let i = 0; i <= TINT_STEPS; i++) TINTS.push(i === 0 ? null : 'rgba(255,80,20,' + +(0.12 * i / TINT_STEPS).toFixed(3) + ')');

  const COLORS = {
    warn: '#ff3b30', meteor: '#ff7a1c', lava: '#ff5a14', lightning: '#9fe6ff', drone: '#ff2f4d',
    fuel: '#46ff7a', bounce: '#ff3fd0', boost: '#3ff3ff', gold: '#ffd84a'
  };

  // Meteor tail passes [length m, width m, colour] and bolt passes [width m, colour] (static: no per-frame arrays).
  const METEOR_TAILS = [[5.5, 0.9, 'rgba(255,90,20,0.25)'], [3.8, 0.55, 'rgba(255,150,40,0.55)'], [2.2, 0.28, 'rgba(255,240,180,0.9)']];
  const BOLT_PASSES = [[0.9, 'rgba(120,190,255,0.35)'], [0.35, 'rgba(190,230,255,0.85)'], [0.12, '#ffffff']];

  let errLogged = false;
  function logOnce(where, e) {
    if (errLogged) return;
    errLogged = true;
    try { console.error('[RR.EventSystem] ' + where + ' failed (further errors suppressed):', e); } catch (_) { /* ignore */ }
  }

  function sectionInfo(id) {
    const S = RR.Worlds && RR.Worlds.SECTION_INFO;
    return (S && S[id]) || SECTION_FALLBACK[id] || { name: 'THE ' + String(id).toUpperCase(), sub: '' };
  }

  // Tiny deterministic hash → [0,1) for per-index visual variety without RNG state.
  function hashf(i) {
    let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ================================================================== event catalogue
  // Each definition: hazard, weight, available(sys) → bool, start(sys, rec) → bool, update(sys, rec, dt),
  // optional cancel(sys, rec), drawWorld(sys, rec, ctx), drawScreen(sys, rec, ctx, cam, w, h).
  const DEFS = Object.create(null);

  // ---------------------------------------------------------------- falling rocks
  DEFS.falling_rocks = {
    weight: 1.2,
    available() { return true; },
    start(sys, rec) {
      const b = sys.run.body, rng = sys.rng;
      const v = clamp(safeNum(b.vx, 0), 3, 28);
      const n = rng.int(3, 6);
      const lead = rng.range(2.5, 3.5);                 // impact points ≈ where the car will be in 2.5–3.5 s
      const cx = Math.max(b.x + v * lead, b.x + 14);
      const spacing = rng.range(3.2, 5.2);
      rec.drops = [];
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * spacing + rng.range(-0.7, 0.7);
        const at = ROCK_TELEGRAPH + rng.range(0, 0.6);
        rec.drops.push({ x, at, r: rng.range(0.4, 0.9), spawned: false, marker: sys._addMarker('rock', x, at + 1.4, rec) });
      }
      sys._warn('FALLING ROCKS!', 'hazard');
      return true;
    },
    update(sys, rec) {
      let pending = 0;
      for (const d of rec.drops) {
        if (d.spawned) continue;
        if (rec.t >= d.at) { d.spawned = true; sys._spawnRock(d, rec); } else pending++;
      }
      if ((pending === 0 && !sys._ownsLive(sys.rocks, rec)) || rec.t > 16) rec.done = true;
    },
    cancel(sys, rec) { for (const d of rec.drops) d.spawned = true; }
  };

  // ---------------------------------------------------------------- bird (eagle) with coin pouch
  DEFS.bird = {
    weight: 0.9,
    available(sys) { return !sys._inCaveAhead(40); },
    start(sys, rec) {
      const b = sys.run.body, vb = sys._view(), rng = sys.rng;
      rec.x = Math.max(vb.right + 8, b.x + 30);
      rec.y = sys._birdAltitude(rec.x);
      rec.vx = -rng.range(7, 10);                         // glides toward the player
      rec.phase = rng.range(0, TAU);
      rec.dropped = false;
      rec.pouch = null;
      rec.coins = rng.int(8, 12);
      sys._warn('EAGLE SPOTTED!', 'bonus');
      sys._sfx('whoosh');
      return true;
    },
    update(sys, rec, dt) {
      const b = sys.run.body;
      rec.x += rec.vx * dt;
      // glide near the top of the view (always visible, well above the ground), slow bob, climb after the drop
      const alt = sys._birdAltitude(rec.x) + Math.sin(rec.t * 1.3) * 0.5 + (rec.dropped ? Math.min(3, (rec.t - rec.dropT) * 1.5) : 0);
      rec.y = U.damp(rec.y, alt, 2.5, dt);
      rec.phase += dt * (rec.dropped ? 7 : 5);
      const dropX = b.x + Math.max(18, safeNum(b.vx, 0) * 1.6 + 12);
      if (!rec.dropped && rec.x <= dropX) {
        rec.dropped = true;
        rec.dropT = rec.t;
        rec.pouch = { x: rec.x, y: rec.y - 0.6, vx: rec.vx * 0.25 + 2, vy: 0, t: 0 };
        sys._sfx('whoosh', { pitch: 1.3, volume: 0.6 });
      }
      const p = rec.pouch;
      if (p && !p.burst) {
        const g = sys._g();
        p.t += dt;
        p.vy -= g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.t > 0.55 || p.y < sys._ground(p.x) + 4) {
          p.burst = true;
          sys._burstPouch(p, rec.coins);
        }
      }
      const vb = sys._view();
      if ((rec.dropped && (!p || p.burst) && rec.x < vb.left - 8) || rec.t > 25) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- coin storm
  DEFS.coin_storm = {
    weight: 0.8,
    available(sys) { return !!(sys.run.collectibles && typeof sys.run.collectibles.addCoin === 'function'); },
    start(sys, rec) {
      rec.dur = sys.rng.range(6, 8);
      rec.acc = 0;
      rec.spawned = 0;
      rec.cap = 48;
      sys._warn('COIN STORM!', 'bonus');
      sys._sfx('coinBig');
      return true;
    },
    update(sys, rec, dt) {
      const b = sys.run.body, rng = sys.rng;
      if (rec.t < rec.dur && rec.spawned < rec.cap) {
        rec.acc += dt * 6.5;                              // ~6.5 coins per second
        const vb = sys._view();
        while (rec.acc >= 1 && rec.spawned < rec.cap) {
          rec.acc -= 1;
          const x = b.x + rng.range(-2, 26) + clamp(safeNum(b.vx, 0), 0, 30) * 1.2;
          const gy = sys._ground(x);
          let y = Math.max(vb.top, gy + 10) + rng.range(0, 4);
          const ceil = sys._ceiling(x);
          if (ceil !== null) y = Math.max(gy + 1.5, ceil - 0.8);
          const r = rng.next();
          const value = r < 0.03 ? 100 : r < 0.18 ? 25 : 5;
          sys._addCoin(x, y, value, rng.range(-1.5, 1.5), rng.range(-3, -1), true);
          sys._emit('coin', x, y, 2);
          rec.spawned++;
        }
      }
      if (rec.t >= rec.dur || rec.spawned >= rec.cap) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- fuel bonus zone
  DEFS.fuel_zone = {
    weight: 0.7,
    available() { return true; },
    start(sys, rec) {
      const b = sys.run.body;
      const v = clamp(safeNum(b.vx, 0), 0, 30);
      rec.x0 = b.x + Math.max(50, v * 3.5);
      rec.x1 = rec.x0 + 160;
      const bossX = sys._bossStartAhead(rec.x1 + 50);
      if (isNum(bossX)) rec.x1 = Math.min(rec.x1, bossX - 20);
      if (rec.x1 - rec.x0 < 60) return false;
      rec.inside = false;
      rec.acc = 0;
      sys._warn('FUEL BONUS ZONE', 'bonus');
      return true;
    },
    update(sys, rec, dt) {
      const b = sys.run.body;
      const inside = b.x >= rec.x0 && b.x <= rec.x1;
      if (inside && !rec.inside) {
        sys._sfx('fuel');
        sys._emit('star', rec.x0, sys._ground(rec.x0) + 2, 14, 0, 2, 4, Math.PI / 2, 1.6, COLORS.fuel);
      }
      rec.inside = inside;
      // ambient gate sparkles while a gate is near the view
      rec.acc += dt;
      if (rec.acc > 0.12) {
        rec.acc = 0;
        const vb = sys._view();
        for (let k = 0; k < 2; k++) {
          const gx = k === 0 ? rec.x0 : rec.x1;
          if (gx > vb.left - 2 && gx < vb.right + 2) {
            sys._emit('star', gx + sys.vrng.range(-0.5, 0.5), sys._ground(gx) + sys.vrng.range(0.3, 6), 1, 0, 1.2, 1, Math.PI / 2, 1, COLORS.fuel, 0.18);
          }
        }
      }
      if (b.x > rec.x1 + 30 || rec.t > 60) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- wind gust
  DEFS.wind_gust = {
    weight: 1.0,
    available(sys) { return safeNum(sys.world.wind && sys.world.wind.gust, 0) > 0.2; },
    start(sys, rec) {
      const rng = sys.rng;
      const gust = safeNum(sys.world.wind && sys.world.wind.gust, 0) * sys._windMul();
      rec.dir = rng.sign();
      rec.mag = gust * rng.range(0.8, 1.4);
      if (!(rec.mag > 0.5)) return false;
      rec.tele = rng.range(1.5, 2.0);
      rec.dur = rng.range(3, 5);
      rec.value = 0;
      rec.intensity = 0;
      rec.blown = false;
      sys._warn(rec.dir < 0 ? 'HEADWIND GUST!' : 'TAILWIND GUST!', 'hazard');
      return true;
    },
    update(sys, rec) {
      const u = rec.t - rec.tele;
      let k = 0;
      if (u > 0) {
        if (!rec.blown) { rec.blown = true; sys._sfx('wind'); }
        // smooth ramps: 0.7 s in, 0.9 s out
        k = smoothstep(0, 0.7, u) * (1 - smoothstep(rec.dur - 0.9, rec.dur, u));
      }
      rec.value = rec.dir * rec.mag * k;
      rec.intensity = u > 0 ? k : 0.25 * smoothstep(0, rec.tele, rec.t);  // faint streaks during telegraph
      if (u >= rec.dur) { rec.value = 0; rec.done = true; }
    }
  };

  // ---------------------------------------------------------------- steep surprise
  DEFS.steep_surprise = {
    weight: 0.8,
    available(sys) { return !!sys._findSteep(); },
    start(sys, rec) {
      const f = sys._findSteep();
      if (!f) return false;
      rec.x = f.x;
      rec.x2 = f.x2;
      sys._warn('STEEP CLIMB AHEAD!', 'info');
      // reward arc over the crest
      const n = 7;
      for (let i = 0; i < n; i++) {
        const cx = rec.x2 + (i - 1) * 1.7;
        const cy = sys._ground(cx) + 1.3 + 1.6 * Math.sin(Math.PI * i / (n - 1));
        sys._addCoin(cx, cy, i === 3 ? 100 : 25, 0, 0, false);
      }
      return true;
    },
    update(sys, rec) {
      if (sys.run.body.x > rec.x2 + 15 || rec.t > 45) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- meteor shower
  DEFS.meteor_shower = {
    weight: 1.4,
    available(sys) { return !sys._inCaveAhead(80); },
    start(sys, rec) {
      const b = sys.run.body, rng = sys.rng;
      const v = clamp(safeNum(b.vx, 0), 3, 28);
      const n = rng.int(3, 5);
      const cx = Math.max(b.x + v * rng.range(2.8, 4.2), b.x + 18);
      const spacing = rng.range(6, 10);
      rec.shots = [];
      let at = METEOR_TELEGRAPH;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * spacing + rng.range(-1, 1);
        const flight = rng.range(0.9, 1.2);
        rec.shots.push({ x, at, flight, spawned: false, marker: sys._addMarker('meteor', x, at + flight, rec) });
        at += rng.range(0.25, 0.5);
      }
      sys._warn('METEOR SHOWER!', 'hazard');
      return true;
    },
    update(sys, rec) {
      let pending = 0;
      for (const s of rec.shots) {
        if (s.spawned) continue;
        if (rec.t >= s.at) { s.spawned = true; sys._spawnMeteor(s, rec); } else pending++;
      }
      if ((pending === 0 && !sys._ownsLive(sys.meteors, rec)) || rec.t > 14) rec.done = true;
    },
    cancel(sys, rec) { for (const s of rec.shots) s.spawned = true; }
  };

  // ---------------------------------------------------------------- lava eruption (geyser)
  DEFS.lava_eruption = {
    weight: 1.4,
    available(sys) { return isNum(sys._findEruptionPoint(true)); },
    start(sys, rec) {
      const x = sys._findEruptionPoint(false);
      if (!isNum(x)) return false;
      rec.x = x;
      rec.y = sys._ground(x);
      rec.H = sys.rng.range(8, 12);
      const ceil = sys._ceiling(x);
      if (ceil !== null) rec.H = Math.max(3, Math.min(rec.H, ceil - rec.y - 0.3));
      rec.hw = 0.85;                 // half width of the column (m)
      rec.eruptDur = 2.2;
      rec.h = 0;
      rec.hit = false;
      rec.erupted = false;
      rec.acc = 0;
      rec.crack = new Float32Array(9);
      for (let i = 0; i < 9; i++) rec.crack[i] = sys.rng.range(-0.12, 0.12);
      rec.marker = sys._addMarker('lava', x, LAVA_TELEGRAPH, rec);
      sys._warn('LAVA ERUPTION!', 'hazard');
      return true;
    },
    update(sys, rec, dt) {
      const u = rec.t - LAVA_TELEGRAPH;
      rec.acc += dt;
      if (u < 0) {
        // bubbling crack
        rec.h = 0;
        if (rec.acc > 0.08) { rec.acc = 0; sys._emit('ember', rec.x + sys.vrng.range(-0.6, 0.6), rec.y + 0.1, 1, 0, 0.5); }
        return;
      }
      if (!rec.erupted) {
        rec.erupted = true;
        if (rec.marker) { rec.marker.active = false; rec.marker = null; }
        sys._sfx('lava');
        sys._shake(0.25, 0.4);
        sys._emit('lava', rec.x, rec.y + 0.3, 18, 0, 0, 9, Math.PI / 2, 0.6);
        sys._addScorch(rec.x, rec.y, 1.4, 'lava');
      }
      if (u < rec.eruptDur) {
        // column height: fast rise, wobbling hold, collapse in the last 0.5 s
        const rise = U.easeOutCubic(u / 0.35);
        const fall = 1 - smoothstep(rec.eruptDur - 0.5, rec.eruptDur, u);
        rec.h = Math.max(0, rec.H * rise * fall + Math.sin(u * 9) * 0.35 * fall);
        if (rec.acc > 0.05) {
          rec.acc = 0;
          sys._emit('lava', rec.x, rec.y + rec.h * 0.9, 3, 0, 0, 6, Math.PI / 2, 1.3);
          if (sys.vrng.next() < 0.3) sys._emit('smoke', rec.x, rec.y + rec.h, 1, 0, 1);
        }
        if (!rec.hit && rec.h > 0.8 && sys._vehicleHitsRect(rec.x - rec.hw, rec.y - 1, rec.x + rec.hw, rec.y + rec.h)) {
          if (sys._crash(rec.id, rec.warnedAt, 'lava')) rec.hit = true;
        }
      } else {
        rec.h = 0;
        if (u > rec.eruptDur + 0.6) rec.done = true;
      }
    }
  };

  // ---------------------------------------------------------------- moving ramp (kinematic springboard)
  DEFS.moving_ramp = {
    weight: 1.2,
    available(sys) { return isNum(sys._findFlat(30)); },
    start(sys, rec) {
      const sx = sys._findFlat(30);
      if (!isNum(sx)) return false;
      rec.a = sx + 3;                    // rail start
      rec.b = sx + 25;                   // rail end
      rec.len = 4.2;
      rec.hgt = 1.15;
      rec.amp = (rec.b - rec.a - rec.len) / 2;
      rec.omega = TAU / sys.rng.range(5, 6.5);
      rec.phase = sys.rng.range(0, TAU);
      rec.rx = rec.a + rec.amp * (1 + Math.sin(rec.phase)); rec.rv = 0;
      rec.cool = 0;
      rec.launches = 0;
      rec.endX = sx + 30;
      sys._warn('MOVING RAMP AHEAD', 'info');
      return true;
    },
    update(sys, rec, dt) {
      const b = sys.run.body;
      const ph = rec.omega * rec.t + rec.phase;
      // left edge of the wedge slides sinusoidally over [a, b − len]; rv is its velocity
      rec.rx = rec.a + rec.amp * (1 + Math.sin(ph));
      rec.rv = rec.amp * rec.omega * Math.cos(ph);
      rec.cool = Math.max(0, rec.cool - dt);
      if (rec.cool <= 0 && b.wheels && rec.launches < 4) {
        for (let i = 0; i < b.wheels.length; i++) {
          const w = b.wheels[i];
          if (!w || !isNum(w.x) || !isNum(w.y)) continue;
          const u = (w.x - rec.rx) / rec.len;
          if (u < 0 || u > 1) continue;
          const g0 = sys._ground(w.x);
          const top = g0 + rec.hgt * u;
          const bottom = w.y - safeNum(w.radius, 0.4);
          if (bottom <= top + 0.35 && bottom >= g0 - 0.3) { sys._launchFromRamp(rec, u); break; }
        }
      }
      if (b.x > rec.endX + 20 || rec.t > 60) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- patrolling drones
  DEFS.drones = {
    weight: 1.3,
    available() { return true; },
    start(sys, rec) {
      const b = sys.run.body, rng = sys.rng;
      const v = clamp(safeNum(b.vx, 0), 0, 30);
      const x0 = b.x + Math.max(70, v * 5.5);
      const d = sys.run.terrain && sys.run.terrain.difficultyAt ? clamp(safeNum(sys.run.terrain.difficultyAt(b.x), 0), 0, 1) : 0.3;
      const n = clamp(1 + (rng.chance(0.35 + 0.4 * d) ? 1 : 0) + (rng.chance(0.25 * d + 0.1) ? 1 : 0), 1, 3);
      rec.drones = [];
      let ax = x0;
      for (let i = 0; i < n; i++) {
        rec.drones.push({
          ax, x: ax, y: sys._ground(ax) + DRONE_HIGH, alive: true,
          omega: TAU / rng.range(2.6, 3.4), phase: rng.range(0, TAU), sway: rng.range(0, TAU), blink: rng.range(0, 1)
        });
        ax += rng.range(13, 17);
      }
      rec.endX = ax;
      sys._warn(n > 1 ? 'DRONES AHEAD!' : 'DRONE AHEAD!', 'hazard');
      return true;
    },
    update(sys, rec) {
      const b = sys.run.body;
      const mid = (DRONE_LOW + DRONE_HIGH) / 2, amp = (DRONE_HIGH - DRONE_LOW) / 2;
      let alive = 0;
      for (const d of rec.drones) {
        if (!d.alive) continue;
        alive++;
        d.x = d.ax + 1.2 * Math.sin(0.7 * rec.t + d.sway);
        let gy = sys._ground(d.x);
        // vertical sine patrol: centre sweeps DRONE_LOW..DRONE_HIGH above the ground. It spends ≈ half of
        // every 2.6–3.4 s period above ~3.3 m — the guaranteed safe window to pass underneath.
        let y = gy + mid + amp * Math.sin(d.omega * rec.t + d.phase);
        const ceil = sys._ceiling(d.x);
        if (ceil !== null) y = Math.min(y, ceil - 0.7);
        d.y = y;
        if (rec.t >= DRONE_ARM) {
          const hit = sys._vehicleHit(d.x, d.y, 0.5);
          if (hit === 2) {
            if (sys._crash(rec.id, rec.warnedAt, 'drone')) sys._destroyDrone(d);
          } else if (hit === 1) {
            const m = sys._mass();
            const dir = b.x < d.x ? -1 : 1;
            if (sys._knock(rec.id, rec.warnedAt, dir * m * 3, m * 1.2, d.x, d.y, 0.45)) sys._destroyDrone(d);
          }
        }
      }
      if (alive === 0 || b.x > rec.endX + 25 || rec.t > 60) rec.done = true;
    }
  };

  // ---------------------------------------------------------------- lightning strikes
  DEFS.lightning = {
    weight: 1.4,
    available(sys) { return !sys._inCaveAhead(80); },
    start(sys, rec) {
      const b = sys.run.body, rng = sys.rng;
      const v = clamp(safeNum(b.vx, 0), 3, 28);
      const n = rng.int(1, 3);
      const cx = Math.max(b.x + v * rng.range(2.0, 3.2), b.x + 12);
      const spacing = rng.range(5, 9);
      rec.strikes = [];
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * spacing + rng.range(-0.8, 0.8);
        const at = LIGHTNING_TELEGRAPH + i * 0.3;
        rec.strikes.push({ x, at, done: false, marker: sys._addMarker('lightning', x, at, rec) });
      }
      sys._warn('LIGHTNING!', 'hazard');
      return true;
    },
    update(sys, rec) {
      let last = 0, pending = 0;
      for (const s of rec.strikes) {
        last = Math.max(last, s.at);
        if (s.done) continue;
        if (rec.t >= s.at) { s.done = true; sys._strike(s, rec); } else pending++;
      }
      if (pending === 0 && rec.t > last + 0.6) rec.done = true;
    },
    cancel(sys, rec) { for (const s of rec.strikes) s.done = true; }
  };

  // ================================================================== the system
  class EventSystem {
    constructor(run) {
      this.run = run || {};
      const r = this.run;
      this.world = r.world || (RR.Worlds && RR.Worlds.byId && RR.Worlds.byId(r.worldId)) ||
        (RR.Worlds && RR.Worlds.list && RR.Worlds.list[0]) || { id: 'unknown', events: [], wind: { base: 0, gust: 0 }, darkness: 0, difficulty: 1 };
      let rng = null;
      try { rng = typeof r.rng === 'function' ? r.rng('events') : null; } catch (e) { rng = null; }
      if (!rng || typeof rng.next !== 'function') rng = U.makeRng(U.hashString('events|' + (this.world.id || '')));
      this.rng = rng;                                  // gameplay stream (scheduling & event layout)
      this.vrng = U.makeRng(U.hash2(rng.seed >>> 0, U.hashString('visual')));   // cosmetic stream

      const wid = this.world.id || '';
      this._stormWorld = wid === 'storm_planet' || safeNum(this.world.wind && this.world.wind.base, 0) >= 1.5;
      this._snowy = this.world.surface === 'snow' || this.world.ambient === 'snow';

      // pools ----------------------------------------------------------
      this.rocks = [];
      for (let i = 0; i < 14; i++) {
        const shape = new Float32Array(7);
        for (let k = 0; k < 7; k++) shape[k] = 0.8 + 0.3 * hashf(i * 13 + k);
        this.rocks.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0.5, rot: 0, av: 0, life: 0, landed: false,
          hitDone: false, owner: null, marker: null, warnedAt: 0, id: 'falling_rocks', shape });
      }
      this.meteors = [];
      for (let i = 0; i < 8; i++) {
        this.meteors.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0.45, life: 0, owner: null, marker: null, warnedAt: 0, id: 'meteor_shower' });
      }
      this.markers = [];
      for (let i = 0; i < 24; i++) this.markers.push({ active: false, kind: 'rock', x: 0, y: 0, t: 0, dur: 1, owner: null });
      this.scorches = [];
      for (let i = 0; i < 12; i++) this.scorches.push({ active: false, x: 0, y: 0, r: 1, age: 0, kind: 'crater' });
      this.bolts = [];
      for (let i = 0; i < 4; i++) this.bolts.push({ active: false, x: 0, t: 0, n: 0, pts: new Float32Array(28), br: new Float32Array(12) });

      // scratch --------------------------------------------------------
      this._vb = { left: 0, right: 0, bottom: 0, top: 0 };
      this._head = { x: 0, y: 0, r: 0 };
      this._n = { x: 0, y: 1 };
      this._sp = { x: 0, y: 0 };
      this._po = { vx: 0, vy: 0, speed: 0, angle: 0, spread: 0, color: null, size: 0, life: 0 };
      this._hullBody = null;
      this._hull = null;
      this._hullR = 2.5;

      this.stats = { started: Object.create(null), knocks: 0, crashes: 0, fuelZaps: 0, launches: 0, bossCleared: 0 };
      this.onDamage = null;
      this.active = [];
      this.reset();
    }

    // ================================================================ public API
    reset() {
      this.time = 0;
      this.nextAt = null;
      this.lastId = null;
      this.active.length = 0;
      for (const p of this.rocks) p.active = false;
      for (const p of this.meteors) p.active = false;
      for (const p of this.markers) p.active = false;
      for (const p of this.scorches) p.active = false;
      for (const p of this.bolts) p.active = false;
      this.section = null;
      this.sectionKey = '';
      this.blend = { storm: 0, cave: 0, volcano: 0, moon: 0 };
      this.stormAmp = 7;
      this.stormPhase = 0;
      this.flash = 0;
      this.nextFlashAt = 0;
      this._seenSections = new Set();
      this._clearedSummits = [];
      if (this._bossMusic) this._restoreMusic();
      this._bossMusic = false;
      this.padCool = 0;
      this.boostTime = 0;
      this.boostPower = 1;
      this.boostSfxCool = 0;
      this.lastInvulnAt = -Infinity;
      this._computeEnv();
    }

    destroy() {
      this.reset();
      this.run = {};
    }

    hazardActive() {
      for (const rec of this.active) if (rec.hazard && !rec.done) return true;
      return false;
    }

    forceEvent(id) {
      try {
        const def = DEFS[id];
        if (!def || !this.run.body) return false;
        if (!def.available(this)) return false;
        return this._start(id);
      } catch (e) {
        logOnce('forceEvent', e);
        return false;
      }
    }

    update(dt) {
      dt = safeNum(dt, 0);
      if (dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;
      try {
        if (dt > 0) this._update(dt);
      } catch (e) {
        logOnce('update', e);
      }
      try { this._computeEnv(); } catch (e) { logOnce('env', e); }
    }

    drawWorld(ctx, run) {
      if (!ctx) return;
      if (run && run !== this.run && run.body) this.run = run;
      try {
        ctx.save();
        this._drawWorld(ctx);
      } catch (e) {
        logOnce('drawWorld', e);
      } finally {
        try { ctx.restore(); } catch (_) { /* ignore */ }
      }
    }

    drawScreen(ctx, run) {
      if (!ctx) return;
      if (run && run !== this.run && run.body) this.run = run;
      try {
        ctx.save();
        this._drawScreen(ctx);
      } catch (e) {
        logOnce('drawScreen', e);
      } finally {
        try { ctx.restore(); } catch (_) { /* ignore */ }
      }
    }

    // ================================================================ simulation
    _update(dt) {
      const run = this.run;
      this.time += dt;
      if (safeNum(run.invulnTime, 0) > 0) this.lastInvulnAt = this.time;
      const body = run.body;
      if (!body || !isNum(body.x) || !isNum(body.y)) return;

      this._updateSection(dt);
      this._updateBoss();
      this._schedule();

      // active events
      const list = this.active;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        if (rec.done) continue;
        rec.t += dt;
        try {
          rec.def.update(this, rec, dt);
        } catch (e) {
          // a faulty event ends itself instead of stalling the whole system
          logOnce('event ' + rec.id, e);
          if (rec.def.cancel) { try { rec.def.cancel(this, rec); } catch (_) { /* ignore */ } }
          rec.done = true;
        }
      }
      // compact finished records (rare; list has ≤ MAX_ACTIVE entries)
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        if (!list[i].done) list[w++] = list[i];
        else this._releaseMarkers(list[i]);
      }
      list.length = w;

      this._updatePads(dt);
      this._updateRocks(dt);
      this._updateMeteors(dt);
      this._updateMarkers(dt);
      this._updateScorches(dt);
      this.flash = Math.max(0, this.flash - dt * 2.4);
    }

    // ---------------------------------------------------------------- scheduling
    _schedule() {
      const run = this.run, b = run.body;
      if (run.state && run.state !== 'running') return;
      if (b.x < FIRST_EVENT_X) return;
      if (this.nextAt === null) this.nextAt = this.time + this.rng.range(2, 6);
      if (this.time < this.nextAt) return;
      if (this._bossBlocked()) { this.nextAt = this.time + 2; return; }
      const id = this._pick();
      if (id && this._start(id)) this.nextAt = this.time + this._interval();
      else this.nextAt = this.time + 3;
    }

    _interval() {
      const w = this.world, b = this.run.body, t = this.run.terrain;
      const diff = clamp(safeNum(w.difficulty, 1), 1, 5);
      const td = t && typeof t.difficultyAt === 'function' ? clamp(safeNum(t.difficultyAt(b.x), 0), 0, 1) : clamp(b.x / 6000, 0, 1);
      let s = this.rng.range(20, 40);
      s *= 1 - 0.05 * (diff - 1);        // up to −20 % on 5-star worlds
      s *= 1 - 0.2 * td;                 // up to −20 % deep into a run
      if (this._stormWorld) s *= 0.8;
      const sid = this.section ? this.section.id : null;
      if (sid === 'volcano') s *= 0.75;  // together with the ×3 weight ≈ 3× the eruptions
      else if (sid === 'storm') s *= 0.85;
      return Math.max(12, s);
    }

    _candidates() {
      const out = this._cand || (this._cand = []);
      out.length = 0;
      const ev = Array.isArray(this.world.events) ? this.world.events : [];
      for (const id of ev) if (DEFS[id] && out.indexOf(id) < 0) out.push(id);
      if (this.section && this.section.id === 'volcano' && out.indexOf('lava_eruption') < 0) out.push('lava_eruption');
      return out;
    }

    _pick() {
      const run = this.run;
      const cands = this._candidates();
      const attract = run.mode === 'attract';
      const hazardBusy = this.hazardActive();
      const recentRescue = this.time - this.lastInvulnAt < SHIELD_GRACE || safeNum(run.invulnTime, 0) > 0;
      if (this.active.length >= MAX_ACTIVE) return null;
      const ok = this._ok || (this._ok = []);
      ok.length = 0;
      for (const id of cands) {
        if (IS_HAZARD[id] && (attract || hazardBusy || recentRescue)) continue;
        let dup = false;
        for (const rec of this.active) if (rec.id === id) dup = true;
        if (dup) continue;
        ok.push(id);
      }
      if (ok.length > 1 && this.lastId) {
        const i = ok.indexOf(this.lastId);
        if (i >= 0) ok.splice(i, 1);
      }
      // weighted pick among feasible candidates (feasibility checks are cheap scans)
      const fuelFrac = clamp(safeNum(run.fuel, 50) / Math.max(1, safeNum(run.fuelMax, 100)), 0, 1);
      const sid = this.section ? this.section.id : null;
      const self = this;
      const pickd = U.weightedPick(ok, (id) => {
        const def = DEFS[id];
        let wgt = def.weight;
        if (id === 'lava_eruption' && sid === 'volcano') wgt *= 3;
        if (id === 'fuel_zone') wgt *= 1 + (1 - fuelFrac) * 1.5;
        if (wgt <= 0) return 0;
        return def.available(self) ? wgt : 0;
      }, this.rng);
      return pickd;
    }

    _start(id) {
      const def = DEFS[id];
      const rec = { id, def, hazard: !!IS_HAZARD[id], t: 0, warnedAt: this.time, done: false };
      this.active.push(rec);
      let ok = false;
      try { ok = def.start(this, rec); } catch (e) { logOnce('start ' + id, e); ok = false; }
      if (!ok) {
        this.active.pop();
        this._releaseMarkers(rec);
        return false;
      }
      this.stats.started[id] = (this.stats.started[id] || 0) + 1;
      this.lastId = id;
      return true;
    }

    _cancelAll() {
      for (const rec of this.active) {
        if (rec.def.cancel) rec.def.cancel(this, rec);
        rec.done = true;
        this._releaseMarkers(rec);
      }
      this.active.length = 0;
    }

    _bossBlocked() {
      const b = this.run.body;
      if (this.section && this.section.id === 'boss') return true;
      if (this.run.boss && this.run.boss.active) return true;
      return isNum(this._bossStartAhead(b.x + BOSS_LOOKAHEAD));
    }

    // x of the next boss section start in (body.x, limit], or NaN.
    _bossStartAhead(limit) {
      const t = this.run.terrain, bx = this.run.body.x;
      if (!t) return NaN;
      const ss = t.sections;
      if (Array.isArray(ss)) {
        for (let i = 0; i < ss.length; i++) {
          const s = ss[i];
          if (s && s.id === 'boss' && s.end > bx && s.start <= limit) return Math.max(bx, s.start);
        }
      }
      if (typeof t.upcomingSection === 'function') {
        try {
          const s = t.upcomingSection(bx);
          if (s && s.id === 'boss' && s.start <= limit) return s.start;
        } catch (e) { /* optional API */ }
      }
      return NaN;
    }

    // ---------------------------------------------------------------- sections
    _updateSection(dt) {
      const run = this.run, t = run.terrain, bx = run.body.x;
      let sec = null;
      if (t && typeof t.sectionAt === 'function') {
        try { sec = t.sectionAt(bx) || null; } catch (e) { sec = null; }
      }
      const key = sec ? sec.id + ':' + safeNum(sec.start, 0) : '';
      if (key !== this.sectionKey) {
        const prev = this.section;
        this.section = sec;
        this.sectionKey = key;
        if (prev) this._exitSection(prev);
        if (sec) this._enterSection(sec, key);
      }
      const sid = sec ? sec.id : null;
      for (let i = 0; i < BLEND_KEYS.length; i++) {
        const k = BLEND_KEYS[i];
        this.blend[k] = approach(this.blend[k], sid === k ? 1 : 0, BLEND_RATE[k] * dt);
      }
      // storm: visual lightning flashes (no damage) + thunder
      if (this.blend.storm > 0.5 && sid === 'storm') {
        if (this.time >= this.nextFlashAt) {
          if (this.nextFlashAt > 0) {
            this.flash = Math.max(this.flash, this.vrng.range(0.55, 1));
            this._sfx('explosion', { volume: 0.25, pitch: 0.45 });
          }
          this.nextFlashAt = this.time + this.vrng.range(2.5, 6.5);
        }
      }
    }

    _enterSection(sec, key) {
      const id = sec.id;
      const first = !this._seenSections.has(key);
      this._seenSections.add(key);
      if (id === 'boss') { this._enterBoss(sec, first); return; }
      if (!first) return;
      const info = sectionInfo(id);
      this._announce(info.name, info.sub, 'section');
      if (id === 'storm') {
        this.stormAmp = this.rng.range(6, 9);
        this.stormPhase = this.rng.range(0, TAU);
        this.nextFlashAt = this.time + 1.5;
        this._sfx('wind');
      } else if (id === 'volcano') {
        this._sfx('lava', { volume: 0.5 });
      }
    }

    _exitSection(sec) {
      const b = this.run.body;
      if (sec.id === 'boss') {
        // vehicle rolled back out of the boss start: keep the boss state, it will re-enter
        if (b.x < safeNum(sec.end, Infinity)) return;
        const boss = this.run.boss;
        if (boss && boss.start === sec.start) this.run.boss = null;
        if (this._bossMusic) this._restoreMusic();
        return;
      }
      if (b.x >= safeNum(sec.end, Infinity) - 1) {
        const info = sectionInfo(sec.id);
        this._announce(info.name + ' CLEARED', 'Well driven!', 'section');
      }
    }

    // ---------------------------------------------------------------- boss run
    _enterBoss(sec, first) {
      const run = this.run;
      const tier = Math.max(1, Math.floor(safeNum(sec.tier, 1)));
      const name = sec.bossName || this.world.bossName || 'THE MOUNTAIN GIANT';
      const start = safeNum(sec.start, run.body.x);
      const end = safeNum(sec.end, start + 400);
      let summitX = safeNum(sec.summitX, end - 40);
      if (summitX <= start) summitX = Math.max(start + 1, end - 1);
      const cleared = this._clearedSummits.indexOf(summitX) >= 0;
      if (!run.boss || run.boss.start !== start) {
        run.boss = { name, start, summitX, end, tier, progress: cleared ? 1 : 0, active: !cleared, cleared };
      }
      this._cancelAll();
      if (first && !cleared) {
        this._announce('BOSS RUN', name + ' — reach the summit!', 'boss');
        this._sfx('warning');
        if (run.mode !== 'attract' && RR.Audio && typeof RR.Audio.music === 'function') {
          try { RR.Audio.music('boss'); this._bossMusic = true; } catch (e) { /* audio optional */ }
        }
      }
    }

    _updateBoss() {
      const run = this.run, boss = run.boss, b = run.body;
      if (!boss || !boss.active) return;
      const span = Math.max(1, boss.summitX - boss.start);
      const p = clamp((b.x - boss.start) / span, 0, 1);
      if (p > safeNum(boss.progress, 0)) boss.progress = p;
      if (b.x >= boss.summitX && (!run.state || run.state === 'running')) this._clearBoss(boss);
    }

    _clearBoss(boss) {
      if (this._clearedSummits.indexOf(boss.summitX) >= 0) { boss.active = false; return; }
      this._clearedSummits.push(boss.summitX);
      const run = this.run, tier = Math.max(1, boss.tier || 1);
      boss.active = false;
      boss.cleared = true;
      boss.progress = 1;
      this.stats.bossCleared++;
      const b = run.body;
      this._emit('confetti', b.x, b.y + 2, 70, 0, 4, 9, Math.PI / 2, 1.8);
      this._emit('star', b.x, b.y + 1.5, 24, 0, 3, 6, Math.PI / 2, 2.4, COLORS.gold);
      if (run.mode === 'attract') return;         // attract/menu runs never grant anything
      try { if (typeof run.addBonus === 'function') run.addBonus(1500 * tier, 'SUMMIT!'); } catch (e) { logOnce('addBonus', e); }
      run.bossXp = safeNum(run.bossXp, 0) + 400 * tier;
      run.tokensEarned = safeNum(run.tokensEarned, 0) + 1;
      if (!run.stats || typeof run.stats !== 'object') run.stats = {};
      run.stats.bossCleared = safeNum(run.stats.bossCleared, 0) + 1;
      this._sfx('record');
      this._shake(0.3, 0.5);
      try { if (RR.Missions && typeof RR.Missions.track === 'function') RR.Missions.track('bossCleared', 1); } catch (e) { logOnce('missions', e); }
      if (this._bossMusic) this._restoreMusic();
    }

    _restoreMusic() {
      this._bossMusic = false;
      if (this.run && this.run.mode === 'attract') return;
      try { if (RR.Audio && typeof RR.Audio.music === 'function') RR.Audio.music(this.world.musicStyle || null); } catch (e) { /* ignore */ }
    }

    // ---------------------------------------------------------------- env
    _computeEnv() {
      const run = this.run;
      if (!run) return;
      if (!run.env || typeof run.env !== 'object') run.env = {};
      const env = run.env, w = this.world, bl = this.blend;
      const base = safeNum(w.wind && w.wind.base, 0) * this._windMul();
      let wind = base;
      let fuelZone = false;
      for (let i = 0; i < this.active.length; i++) {
        const rec = this.active[i];
        if (rec.id === 'wind_gust') wind += safeNum(rec.value, 0);
        else if (rec.id === 'fuel_zone' && rec.inside) fuelZone = true;
      }
      if (bl.storm > 0) {
        // two incommensurate sines → strong gusty wind that swings between head- and tailwind
        const t = this.time;
        const osc = 0.72 * Math.sin(t * 0.85 + this.stormPhase) + 0.28 * Math.sin(t * 2.7 + this.stormPhase * 1.7);
        wind += bl.storm * this.stormAmp * osc;
      }
      env.wind = clamp(safeNum(wind, 0), -20, 20);
      const moonT = w.id === 'moon_base' ? 0.6 : 0.45;
      env.gravityMul = clamp(safeNum(lerp(1, moonT, smoothstep(0, 1, bl.moon)), 1), 0.2, 1.5);
      const d0 = clamp(safeNum(w.darkness, 0), 0, 0.9);
      let dark = d0;
      if (bl.storm > 0) dark = Math.max(dark, lerp(d0, Math.max(d0, 0.38), bl.storm));
      if (bl.cave > 0) dark = Math.max(dark, lerp(d0, 0.85, smoothstep(0, 1, bl.cave)));
      env.darkness = clamp(safeNum(dark, 0), 0, 0.95);
      env.rain = clamp(safeNum(bl.storm, 0), 0, 1);
      env.lightning = clamp(safeNum(this.flash, 0), 0, 1);
      env.tint = TINTS[clamp(Math.round(safeNum(bl.volcano, 0) * TINT_STEPS), 0, TINT_STEPS)];
      env.sectionId = this.section ? this.section.id : null;
      env.fuelZone = fuelZone;
    }

    _windMul() {
      const m = this.run.modifiers;
      return m && isNum(m.windMul) ? clamp(m.windMul, 0, 4) : 1;
    }

    // ---------------------------------------------------------------- pads (terrain features)
    _updatePads(dt) {
      const run = this.run, b = run.body, t = run.terrain;
      this.padCool = Math.max(0, this.padCool - dt);
      this.boostSfxCool = Math.max(0, this.boostSfxCool - dt);
      const fs = t && Array.isArray(t.features) ? t.features : null;
      if (fs && fs.length && b.wheels) {
        let i = lowerBound(fs, b.x - 10);
        for (; i < fs.length; i++) {
          const f = fs[i];
          if (f.x > b.x + 10) break;
          if (f.type !== 'bouncepad' && f.type !== 'boostpad') continue;
          const power = clamp(safeNum(f.meta && f.meta.power, 1), 0.5, 2);
          for (let k = 0; k < b.wheels.length; k++) {
            const wh = b.wheels[k];
            if (!wh || wh.x < f.x - 0.2 || wh.x > f.x2 + 0.2 || !this._wheelGrounded(wh)) continue;
            if (f.type === 'bouncepad') {
              if (this.padCool <= 0) this._bounce(power, f);
            } else {
              if (this.boostTime < 0.5 && this.boostSfxCool <= 0) { this._sfx('boost'); this.boostSfxCool = 1; }
              this.boostTime = 1.0;
              this.boostPower = power;
            }
            break;
          }
        }
      }
      if (this.boostTime > 0) {
        this.boostTime = Math.max(0, this.boostTime - dt);
        if (typeof b.applyImpulse === 'function' && safeNum(b.vx, 0) < 38) {
          // forward push along the chassis axis (≈ 1.1 g), fading over the last 0.3 s
          const k = Math.min(1, this.boostTime / 0.3);
          const a = 11 * this.boostPower * k;
          const m = this._mass(), c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
          b.applyImpulse(m * a * dt * c, m * a * dt * s, b.x, b.y);
        }
        const c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
        this._emit('boost', b.x - c * 1.6, b.y - s * 1.6 - 0.1, 2, safeNum(b.vx, 0) * 0.5, safeNum(b.vy, 0) * 0.5, 5, (b.angle || 0) + Math.PI, 0.4);
      }
    }

    _bounce(power, f) {
      const b = this.run.body;
      if (typeof b.applyImpulse !== 'function') return;
      const m = this._mass();
      const target = 9.5 * power * Math.sqrt(this._gScale());
      const vy = safeNum(b.vy, 0);
      if (vy < target) b.applyImpulse(m * 1.0, m * (target - vy), b.x, b.y);
      this.padCool = 0.8;
      this.stats.launches++;
      const cx = (f.x + f.x2) / 2, gy = this._ground(cx);
      this._emit('star', cx, gy + 0.3, 16, 0, 3, 6, Math.PI / 2, 1.2, COLORS.bounce);
      this._emit('spark', cx, gy + 0.2, 10, 0, 2, 7, Math.PI / 2, 1.6, COLORS.bounce);
      this._sfx('jump', { pitch: 1.2 });
      this._shake(0.12, 0.2);
    }

    _launchFromRamp(rec, u) {
      const b = this.run.body;
      if (typeof b.applyImpulse !== 'function') return;
      const m = this._mass(), gs = this._gScale();
      const vyT = 7.5 * Math.sqrt(gs) * (0.9 + 0.1 * u);
      const vy = safeNum(b.vy, 0);
      const dvx = 2.5 + Math.max(0, rec.rv) * 0.25;
      b.applyImpulse(m * dvx, m * Math.max(0, vyT - vy), b.x, b.y);
      rec.cool = 1.2;
      const first = rec.launches === 0;
      rec.launches++;
      this.stats.launches++;
      this._emit('boost', b.x, b.y - 0.6, 12, 0, 0, 6, -Math.PI / 2, 1.2, COLORS.bounce);
      this._emit('spark', rec.rx + rec.len, this._ground(rec.rx + rec.len) + rec.hgt, 12, 0, 2, 7, Math.PI / 2, 1.4, COLORS.bounce);
      this._sfx('jump');
      if (first) {
        // small reward: coins along the predicted ballistic arc
        const g = this._g(), vx = clamp(safeNum(b.vx, 0), 0, 40);
        for (let i = 0; i < 4; i++) {
          const tt = 0.35 + i * 0.28;
          const cx = b.x + vx * tt, cy = b.y + Math.max(vy, vyT) * tt - 0.5 * g * tt * tt + 0.6;
          if (cy > this._ground(cx) + 0.8) this._addCoin(cx, cy, 25, 0, 0, false);
        }
      }
    }

    _wheelGrounded(w) {
      if (w.grounded === true) return true;
      if (w.grounded === false) return false;
      return w.y - safeNum(w.radius, 0.4) - this._ground(w.x) <= 0.15;
    }

    // ---------------------------------------------------------------- rocks
    _spawnRock(d, rec) {
      const p = this._free(this.rocks);
      if (!p) return;
      const g = this._g(), vb = this._view();
      const gx = this._ground(d.x);
      let y = Math.max(vb.top + d.r + 1.5, gx + 11);
      const ceil = this._ceiling(d.x);
      if (ceil !== null) y = Math.max(gx + d.r + 2, Math.min(y, ceil - d.r - 0.3));   // drops from the cave roof
      const fallT = Math.sqrt(2 * Math.max(0.5, y - gx - d.r) / g);
      const vx = this.rng.range(-1.0, 0.5);
      p.active = true;
      p.x = d.x - vx * fallT;     // aim so it lands on its marker
      p.y = y;
      p.vx = vx; p.vy = 0;
      p.r = d.r;
      p.rot = this.vrng.range(0, TAU);
      p.av = this.vrng.range(-2, 2);
      p.life = 0;
      p.landed = false;
      p.hitDone = false;
      p.owner = rec;
      p.marker = d.marker;
      p.warnedAt = rec.warnedAt;
      p.id = rec.id;
      if (d.marker) d.marker.dur = Math.max(d.marker.dur, d.marker.t + fallT + 0.1);
    }

    _updateRocks(dt) {
      const t = this.run.terrain, b = this.run.body;
      const g = this._g(), n = this._n;
      for (let i = 0; i < this.rocks.length; i++) {
        const p = this.rocks[i];
        if (!p.active) continue;
        p.life += dt;
        p.vy -= g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.av * dt;
        const h = this._ground(p.x);
        this._normal(p.x, n);
        // perpendicular distance to the (locally straight) ground ≈ vertical gap × normal.y
        const dist = (p.y - h) * n.y;
        if (dist < p.r) {
          const pen = p.r - dist;
          p.x += n.x * pen;
          p.y += n.y * pen;
          const vn = p.vx * n.x + p.vy * n.y;
          if (vn < 0) {
            const e = vn < -3 ? (this._snowy ? 0.15 : 0.35) : 0;   // bounce only on real impacts
            p.vx -= (1 + e) * vn * n.x;
            p.vy -= (1 + e) * vn * n.y;
            if (!p.landed || vn < -4) this._rockImpact(p, -vn);
            p.landed = true;
            if (p.marker) { p.marker.active = false; p.marker = null; }
          }
          // rolling: tangent speed with rolling resistance, spin matches the roll
          const vt = p.vx * n.y - p.vy * n.x;
          const vt2 = vt * Math.exp(-0.45 * dt);
          p.vx += (vt2 - vt) * n.y;
          p.vy -= (vt2 - vt) * n.x;
          p.av = -vt2 / p.r;
        }
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 40) { p.vx *= 40 / sp; p.vy *= 40 / sp; }
        if (!isNum(p.x) || !isNum(p.y) || p.life > 10 || p.x < b.x - 60 || p.y < h - 6 ||
          (t && isNum(t.minX) && p.x < t.minX)) {
          this._killRock(p);
          continue;
        }
        if (!p.hitDone) this._rockVsVehicle(p);
      }
    }

    _rockImpact(p, speed) {
      const gy = p.y - p.r;
      const vb = this._vb;
      if (p.x < vb.left - 6 || p.x > vb.right + 6) return;
      if (this._snowy) this._emit('snow', p.x, gy, Math.round(6 + p.r * 10), 0, 0, 3, Math.PI / 2, 2);
      else {
        this._emit('dust', p.x, gy, Math.round(4 + p.r * 6), 0, 0, 2.2);
        if (speed > 5) this._emit('debris', p.x, gy + 0.1, 4, 0, 0, 4);
      }
      if (speed > 5) {
        const d = Math.abs(p.x - this.run.body.x);
        if (d < 25) this._shake(0.12 * p.r * (1 - d / 25) + 0.03, 0.25);
        this._sfx('landHard', { volume: clamp(0.5 - d / 60, 0.1, 0.5), pitch: 0.7 });
      }
    }

    _rockVsVehicle(p) {
      if (!this._damageOk(p.warnedAt)) return;
      const hit = this._vehicleHit(p.x, p.y, p.r);
      if (!hit) return;
      const b = this.run.body;
      p.hitDone = true;
      if (hit === 2) {
        this._crash(p.id, p.warnedAt, 'rock');
      } else {
        // knock: push from the rock toward the chassis, stronger for big/fast rocks
        let dx = b.x - p.x, dy = b.y - p.y;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const rel = Math.hypot(p.vx - safeNum(b.vx, 0), p.vy - safeNum(b.vy, 0));
        const dv = clamp(0.8 + rel * 0.25 * (p.r / 0.65), 1, 4.5);
        const m = this._mass();
        this._knock(p.id, p.warnedAt, dx * m * dv, (dy - 0.3) * m * dv, p.x + dx * p.r, p.y + dy * p.r, 0.35);
      }
      // rock rebounds off the car
      p.vx = -p.vx * 0.4 + (p.x < b.x ? -2 : 2);
      p.vy = Math.abs(p.vy) * 0.3 + 2;
    }

    _killRock(p) {
      p.active = false;
      if (p.marker) { p.marker.active = false; p.marker = null; }
      p.owner = null;
    }

    // ---------------------------------------------------------------- meteors
    _spawnMeteor(s, rec) {
      const p = this._free(this.meteors);
      if (!p) return;
      const gx = this._ground(s.x);
      const dx = this.rng.range(10, 18), dy = this.rng.range(20, 26);
      p.active = true;
      p.x = s.x + dx;
      p.y = gx + dy;
      p.vx = -dx / s.flight;
      p.vy = -dy / s.flight;
      p.r = this.rng.range(0.4, 0.6);
      p.life = 0;
      p.owner = rec;
      p.marker = s.marker;
      p.warnedAt = rec.warnedAt;
      p.id = rec.id;
      this._sfx('whoosh', { pitch: 0.6, volume: 0.5 });
    }

    _updateMeteors(dt) {
      for (let i = 0; i < this.meteors.length; i++) {
        const p = this.meteors[i];
        if (!p.active) continue;
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // fiery trail
        this._emit('ember', p.x, p.y, 2, p.vx * 0.15, p.vy * 0.15, 1.2);
        if (this.vrng.next() < 0.35) this._emit('smoke', p.x, p.y, 1, p.vx * 0.05, p.vy * 0.05, 0.6);
        if (!isNum(p.x) || !isNum(p.y) || p.life > 5) { this._killMeteor(p); continue; }
        const gy = this._ground(p.x);
        if (p.y - p.r <= gy) { this._explodeMeteor(p, gy); continue; }
        if (this._damageOk(p.warnedAt)) {
          const hit = this._vehicleHit(p.x, p.y, p.r);
          if (hit === 2) {
            this._crash(p.id, p.warnedAt, 'meteor');
            this._explodeMeteor(p, gy, true);
          } else if (hit === 1) {
            this._explodeMeteor(p, gy);
          }
        }
      }
    }

    _explodeMeteor(p, gy, noKnock) {
      const run = this.run, b = run.body;
      const ex = p.x, ey = Math.max(p.y - p.r * 0.5, gy);
      this._emit('explosion', ex, ey + 0.2, 26, 0, 0, 0, 0, 0, null);
      this._emit('lava', ex, ey + 0.2, 8, 0, 0, 6, Math.PI / 2, 1.4);
      this._addScorch(ex, gy, 1.7, 'crater');
      const d = Math.hypot(b.x - ex, b.y - ey);
      this._shake(clamp(0.55 * (1 - d / 30), 0.08, 0.55), 0.4);
      this._sfx('explosion', { volume: clamp(1 - d / 50, 0.2, 1) });
      const R = 4;
      if (!noKnock && d < R) {
        // blast knock: away from the impact with an upward bias; applied off-centre so it also spins the car
        let nx = (b.x - ex) / (d || 1), ny = (b.y - ey) / (d || 1) + 0.6;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const m = this._mass(), mag = m * 5.5 * (1 - d / R);
        this._knock(p.id, p.warnedAt, nx * mag, ny * mag, b.x - nx * 0.5, b.y - ny * 0.3, 0.5);
      }
      this._killMeteor(p);
    }

    _killMeteor(p) {
      p.active = false;
      if (p.marker) { p.marker.active = false; p.marker = null; }
      p.owner = null;
    }

    // ---------------------------------------------------------------- lightning
    _strike(s, rec) {
      const run = this.run, b = run.body;
      const x = s.x, gy = this._ground(x);
      if (s.marker) { s.marker.active = false; s.marker = null; }
      this.flash = 1;
      this._addBolt(x, gy);
      this._addScorch(x, gy, 1.2, 'bolt');
      this._emit('spark', x, gy + 0.2, 18, 0, 0, 9, Math.PI / 2, 2.4, '#bfefff');
      this._emit('smoke', x, gy + 0.3, 4, 0, 1);
      const dist = Math.abs(b.x - x);
      this._shake(clamp(0.35 * (1 - dist / 25), 0.05, 0.35), 0.3);
      this._sfx('explosion', { pitch: 1.5, volume: clamp(1 - dist / 40, 0.25, 0.9) });
      // proximity: nearest of chassis, head and wheels, horizontally, while not high in the air
      let near = Math.abs(b.x - x);
      const hd = this._getHead();
      if (hd) near = Math.min(near, Math.abs(hd.x - x));
      if (b.wheels) for (const w of b.wheels) if (w && isNum(w.x)) near = Math.min(near, Math.abs(w.x - x));
      if (near < 2.2 && b.y - gy < 8 && this._damageOk(rec.warnedAt)) {
        const m = this._mass();
        if (this._knock(rec.id, rec.warnedAt, (b.x < x ? -1 : 1) * m * 0.8, m * 2.2, b.x, b.y + 0.3, 0.3)) {
          const fm = Math.max(1, safeNum(run.fuelMax, 100));
          if (isNum(run.fuel)) run.fuel = clamp(run.fuel - 0.1 * fm, 0, fm);
          this.stats.fuelZaps++;
          this._emit('spark', b.x, b.y + 0.5, 22, 0, 0, 8, 0, TAU, '#9fe6ff');
          if (run.floatText && typeof run.floatText.add === 'function' && run.mode !== 'attract') {
            try { run.floatText.add('-10% FUEL', b.x, b.y + 2, { color: '#9fe6ff', size: 22 }); } catch (e) { /* optional */ }
          }
        }
      }
    }

    _addBolt(x, gy) {
      const p = this._free(this.bolts) || this.bolts[0];
      const vb = this._view();
      const top = Math.max(vb.top + 2, gy + 14);
      p.active = true;
      p.x = x;
      p.t = 0;
      const n = 14;
      p.n = n;
      let px = x + this.vrng.range(-3, 3);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const y = lerp(top, gy, k);
        // converge onto the strike point near the ground
        px = lerp(px + this.vrng.range(-1.1, 1.1), x, k * k);
        if (i === n - 1) px = x;
        p.pts[i * 2] = px;
        p.pts[i * 2 + 1] = y;
      }
      // one short branch from the upper third
      const bi = 4;
      let bx = p.pts[bi * 2], by = p.pts[bi * 2 + 1];
      const dir = this.vrng.sign();
      for (let i = 0; i < 6; i++) {
        p.br[i * 2] = bx;
        p.br[i * 2 + 1] = by;
        bx += dir * this.vrng.range(0.4, 1.1);
        by -= this.vrng.range(0.6, 1.3);
      }
    }

    // ---------------------------------------------------------------- drones
    _destroyDrone(d) {
      d.alive = false;
      this._emit('explosion', d.x, d.y, 16, 0, 0);
      this._emit('spark', d.x, d.y, 14, 0, 0, 8, 0, TAU, COLORS.drone);
      this._sfx('explosion', { pitch: 1.3, volume: 0.7 });
    }

    // ---------------------------------------------------------------- bird pouch
    _burstPouch(p, count) {
      this._emit('coin', p.x, p.y, 12);
      this._emit('debris', p.x, p.y, 5, 0, 0, 3, Math.PI / 2, 2.4, '#8a5a2b');
      this._sfx('coinBig');
      const b = this.run.body;
      const fwd = clamp(safeNum(b.vx, 0) * 0.35, 0, 6);
      for (let i = 0; i < count; i++) {
        const value = i === Math.floor(count / 2) ? 100 : (i % 3 === 0 ? 25 : 5);
        // fan out forward so the coins trail ahead of the player
        this._addCoin(p.x + i * 0.35, p.y, value, fwd + this.rng.range(-1, 4.5), this.rng.range(1.5, 5), true);
      }
    }

    // ---------------------------------------------------------------- markers & scorches
    _addMarker(kind, x, dur, owner) {
      const m = this._free(this.markers);
      if (!m) return null;
      m.active = true;
      m.kind = kind;
      m.x = x;
      m.y = this._ground(x);
      m.t = 0;
      m.dur = Math.max(0.5, dur);
      m.owner = owner;
      return m;
    }

    _updateMarkers(dt) {
      for (let i = 0; i < this.markers.length; i++) {
        const m = this.markers[i];
        if (!m.active) continue;
        m.t += dt;
        m.y = this._ground(m.x);
        if (m.t > m.dur + 3) m.active = false;   // safety net (normally released by its hazard)
      }
    }

    _releaseMarkers(rec) {
      for (let i = 0; i < this.markers.length; i++) {
        const m = this.markers[i];
        if (m.active && m.owner === rec) {
          // keep markers whose rock / meteor is still in flight
          let inFlight = false;
          for (const p of this.rocks) if (p.active && p.marker === m) inFlight = true;
          for (const p of this.meteors) if (p.active && p.marker === m) inFlight = true;
          if (!inFlight) m.active = false;
        }
      }
    }

    _addScorch(x, y, r, kind) {
      let s = this._free(this.scorches);
      if (!s) {       // recycle the oldest
        s = this.scorches[0];
        for (const q of this.scorches) if (q.age > s.age) s = q;
      }
      s.active = true; s.x = x; s.y = y; s.r = r; s.age = 0; s.kind = kind;
    }

    _updateScorches(dt) {
      const bx = this.run.body.x;
      for (const s of this.scorches) {
        if (!s.active) continue;
        s.age += dt;
        if (s.age > 25 || s.x < bx - 80) s.active = false;
      }
      for (const p of this.bolts) {
        if (!p.active) continue;
        p.t += dt;
        if (p.t > 0.45) p.active = false;
      }
    }

    // ---------------------------------------------------------------- damage
    _damageOk(warnedAt) {
      const run = this.run;
      if (run.mode === 'attract') return false;
      if (run.state && run.state !== 'running') return false;
      if (safeNum(run.invulnTime, 0) > 0) return false;
      // hard fairness guarantee: nothing hurts before it has been telegraphed for MIN_TELEGRAPH seconds
      return isNum(warnedAt) && this.time - warnedAt >= MIN_TELEGRAPH - 1e-9;
    }

    _report(id, kind, warnedAt) {
      if (typeof this.onDamage === 'function') {
        try { this.onDamage(id, kind, this.time - warnedAt); } catch (e) { /* hook errors never break the game */ }
      }
    }

    _crash(id, warnedAt, reason) {
      if (!this._damageOk(warnedAt)) return false;
      this.stats.crashes++;
      this._report(id, 'crash', warnedAt);
      this._shake(0.5, 0.5);
      try { if (typeof this.run.crash === 'function') this.run.crash(reason); } catch (e) { logOnce('crash', e); }
      return true;
    }

    _knock(id, warnedAt, ix, iy, px, py, shake) {
      if (!this._damageOk(warnedAt)) return false;
      const b = this.run.body;
      if (!b || typeof b.applyImpulse !== 'function' || !isNum(ix) || !isNum(iy)) return false;
      b.applyImpulse(ix, iy, px, py);
      this.stats.knocks++;
      this._report(id, 'knock', warnedAt);
      this._shake(shake || 0.3, 0.3);
      this._emit('spark', px, py, 14, 0, 0, 8, 0, TAU);
      this._sfx('landHard');
      return true;
    }

    // ---------------------------------------------------------------- vehicle geometry
    _getHead() {
      const b = this.run.body, h = this._head;
      if (!b) return null;
      if (typeof b.getHead === 'function') {
        const r = b.getHead(h);
        if (r && isNum(r.x) && isNum(r.y)) { h.r = safeNum(r.r, 0.25); if (r !== h) { h.x = r.x; h.y = r.y; } return h; }
      }
      // fallback: 1 m above the chassis along its up axis
      const a = safeNum(b.angle, 0);
      h.x = b.x - Math.sin(a) * 1.0; h.y = b.y + Math.cos(a) * 1.0; h.r = 0.25;
      return h;
    }

    _ensureHull() {
      const b = this.run.body;
      if (b === this._hullBody && this._hull) return this._hull;
      this._hullBody = b;
      const tuned = (b && b.tuned) || this.run.tuned;
      const src = tuned && tuned.chassis && Array.isArray(tuned.chassis.hull) ? tuned.chassis.hull : null;
      let pts = [];
      if (src && src.length >= 3) {
        for (const p of src) {
          const x = Array.isArray(p) ? p[0] : p && p.x, y = Array.isArray(p) ? p[1] : p && p.y;
          if (isNum(x) && isNum(y)) pts.push(x, y);
        }
      }
      if (pts.length < 6) pts = [-1.3, -0.35, 1.3, -0.35, 1.3, 0.4, -1.3, 0.4];
      this._hull = new Float64Array(pts);
      let r = 0;
      for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i], pts[i + 1]));
      this._hullR = Math.max(r, 2.2);
      return this._hull;
    }

    // Circle vs vehicle: 0 = miss, 1 = hull or wheel, 2 = driver's head.
    _vehicleHit(cx, cy, r) {
      const b = this.run.body;
      if (!b || !isNum(cx) || !isNum(cy)) return 0;
      const hull = this._ensureHull();
      const dx = cx - b.x, dy = cy - b.y;
      const reach = this._hullR + r + 1.2;
      if (dx * dx + dy * dy > reach * reach) return 0;
      const h = this._getHead();
      if (h) {
        const hx = cx - h.x, hy = cy - h.y, rr = r + h.r;
        if (hx * hx + hy * hy < rr * rr) return 2;
      }
      if (b.wheels) {
        for (let i = 0; i < b.wheels.length; i++) {
          const w = b.wheels[i];
          if (!w || !isNum(w.x)) continue;
          const wx = cx - w.x, wy = cy - w.y, rr = r + safeNum(w.radius, 0.4);
          if (wx * wx + wy * wy < rr * rr) return 1;
        }
      }
      // hull polygon in chassis-local coordinates
      const a = safeNum(b.angle, 0), c = Math.cos(a), s = Math.sin(a);
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if (pointInPoly(hull, lx, ly) || distToPoly(hull, lx, ly) < r) return 1;
      return 0;
    }

    // Axis-aligned world rect vs head circle + hull polygon (edges sampled).
    _vehicleHitsRect(x0, y0, x1, y1) {
      const b = this.run.body;
      if (!b) return false;
      const h = this._getHead();
      if (h) {
        const qx = clamp(h.x, x0, x1), qy = clamp(h.y, y0, y1);
        const ddx = h.x - qx, ddy = h.y - qy;
        if (ddx * ddx + ddy * ddy < h.r * h.r) return true;
      }
      const hull = this._ensureHull();
      const a = safeNum(b.angle, 0), c = Math.cos(a), s = Math.sin(a);
      const n = hull.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = hull[i * 2], ay = hull[i * 2 + 1];
        const j = (i + 1) % n;
        const bx = hull[j * 2], by = hull[j * 2 + 1];
        for (let k = 0; k < 3; k++) {       // vertex + two points along the edge
          const t = k / 3;
          const lx = ax + (bx - ax) * t, ly = ay + (by - ay) * t;
          const wx = b.x + lx * c - ly * s, wy = b.y + lx * s + ly * c;
          if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) return true;
        }
      }
      return false;
    }

    // ---------------------------------------------------------------- terrain queries
    _ground(x) {
      const t = this.run.terrain;
      if (!t || typeof t.heightAt !== 'function') return 0;
      const h = t.heightAt(x);
      return isNum(h) ? h : 0;
    }

    _normal(x, out) {
      const t = this.run.terrain;
      if (t && typeof t.normalAt === 'function') {
        t.normalAt(x, out);
        if (isNum(out.x) && isNum(out.y) && out.y > 0) return out;
      }
      const s = (this._ground(x + 0.25) - this._ground(x - 0.25)) / 0.5;
      const inv = 1 / Math.sqrt(1 + s * s);
      out.x = -s * inv; out.y = inv;
      return out;
    }

    _ceiling(x) {
      const t = this.run.terrain;
      if (!t || typeof t.ceilingAt !== 'function') return null;
      const c = t.ceilingAt(x);
      return isNum(c) ? c : null;
    }

    _inCaveAhead(dist) {
      const b = this.run.body;
      if (this.section && this.section.id === 'cave') return true;
      for (let x = b.x; x <= b.x + dist; x += 10) if (this._ceiling(x) !== null) return true;
      return false;
    }

    // Bird flight height at x: ~3 m below the top of the view, but 5–14 m above the ground under it.
    _birdAltitude(x) {
      const vb = this._view(), gy = this._ground(x);
      return Math.max(gy + 5, Math.min(vb.top - 3, gy + 14));
    }

    _sectionIdAt(x) {
      const t = this.run.terrain;
      if (!t || typeof t.sectionAt !== 'function') return null;
      const s = t.sectionAt(x);
      return s ? s.id : null;
    }

    // A climb 120–250 m ahead: a terrain 'steep' feature (dir +1) if there is one, otherwise a sustained
    // climb found directly in the heightfield (≥ 12 m long, slope ≥ 0.32, ≥ 5 m rise) — gentle worlds rarely
    // tag 'steep' features. Returns {x, x2} (feature object or a reused scratch object) or null.
    _findSteep() {
      const t = this.run.terrain, b = this.run.body;
      const fs = t && Array.isArray(t.features) ? t.features : null;
      if (fs) {
        for (let i = lowerBound(fs, b.x + 120); i < fs.length; i++) {
          const f = fs[i];
          if (f.x > b.x + 250) break;
          if (f.type !== 'steep') continue;
          if (f.meta && isNum(f.meta.dir) && f.meta.dir < 0) continue;   // climbs only
          if (this._sectionIdAt(f.x) === 'boss') continue;
          return f;
        }
      }
      let runStart = NaN;
      for (let x = b.x + 120; x <= b.x + 262; x += 1) {
        const s = this._ground(x + 1) - this._ground(x);
        if (s >= 0.32) {
          if (!isNum(runStart)) runStart = x;
          continue;
        }
        if (isNum(runStart) && x - runStart >= 12 && this._ground(x) - this._ground(runStart) >= 5 &&
          runStart <= b.x + 250 && this._sectionIdAt(runStart) !== 'boss' && !this._inJumpZone(runStart)) {
          const out = this._steepOut || (this._steepOut = { type: 'steep', x: 0, x2: 0 });
          out.x = runStart; out.x2 = x;
          return out;
        }
        runStart = NaN;
      }
      return null;
    }

    // Is x inside a jump / gap / lava feature's takeoff→landing zone (with margins)?
    _inJumpZone(x) {
      const t = this.run.terrain;
      const fs = t && Array.isArray(t.features) ? t.features : null;
      if (!fs) return false;
      for (let i = lowerBound(fs, x - 120); i < fs.length; i++) {
        const f = fs[i];
        if (f.x > x + 10) break;
        if (f.type !== 'jump' && f.type !== 'gap' && f.type !== 'lava' && f.type !== 'bouncepad' && f.type !== 'boostpad') continue;
        const m = f.meta || {};
        const lo = Math.min(f.x, safeNum(m.takeoffX, f.x), safeNum(m.rampX, f.x)) - 5;
        const hi = Math.max(f.x2, safeNum(m.landingZoneX2, f.x2), safeNum(m.landingX, f.x2)) + 6;
        if (x >= lo && x <= hi) return true;
      }
      return false;
    }

    _findEruptionPoint(probeOnly) {
      const b = this.run.body, t = this.run.terrain;
      const v = clamp(safeNum(b.vx, 0), 4, 25);
      const x0 = Math.max(b.x + v * (probeOnly ? 3.1 : this.rng.range(2.6, 3.6)) + 6, b.x + 22);
      for (let k = 0; k < 8; k++) {
        const x = x0 + k * 9;
        if (this._sectionIdAt(x) === 'boss' || this._inJumpZone(x)) continue;
        let bad = false;
        for (let dx = -3; dx <= 3; dx += 1.5) {
          const s = t && typeof t.surfaceAt === 'function' ? t.surfaceAt(x + dx) : null;
          if (s && s.hazard) { bad = true; break; }
          if (Math.abs(this._ground(x + dx + 0.5) - this._ground(x + dx - 0.5)) > 0.9) { bad = true; break; }
        }
        if (!bad) return x;
      }
      return NaN;
    }

    // Start of a gentle window of `len` metres ahead (for the moving ramp), or NaN. Mild slopes are fine
    // (the wedge follows the ground); jumps, gaps, pads, caves and boss climbs are excluded.
    _findFlat(len) {
      const b = this.run.body;
      const v = clamp(safeNum(b.vx, 0), 0, 30);
      const from = b.x + Math.max(55, v * 3.5);
      for (let sx = from; sx < b.x + 300; sx += 3) {
        const h0 = this._ground(sx);
        let ok = true;
        for (let x = sx; x <= sx + len; x += 2) {
          const h = this._ground(x);
          const s = (this._ground(x + 0.5) - h) / 0.5;
          if (Math.abs(s) > 0.2 || Math.abs(h - h0) > 2.5) { ok = false; break; }
        }
        if (!ok) continue;
        for (let x = sx; x <= sx + len && ok; x += 4) if (this._inJumpZone(x) || this._ceiling(x) !== null) ok = false;
        if (ok && this._sectionIdAt(sx) !== 'boss' && this._sectionIdAt(sx + len) !== 'boss') return sx;
      }
      return NaN;
    }

    // ---------------------------------------------------------------- misc helpers
    _g() {
      const env = this.run.env || {};
      let g = safeNum(env.gravity, 0);
      if (!(g > 0)) g = 9.81 * safeNum(this.world.gravity, 1);
      return clamp(g * safeNum(env.gravityMul, 1), 1, 40);
    }

    _gScale() { return clamp(this._g() / 9.81, 0.1, 3); }

    _mass() {
      const b = this.run.body;
      const m = b && (isNum(b.mass) ? b.mass : (b.tuned && b.tuned.chassis && b.tuned.chassis.mass));
      return isNum(m) && m > 0 ? m : 250;
    }

    _view() {
      const cam = this.run.camera, vb = this._vb;
      if (cam && typeof cam.bounds === 'function') {
        cam.bounds(vb);
        if (isNum(vb.left) && isNum(vb.right) && isNum(vb.top) && isNum(vb.bottom) && vb.right > vb.left) return vb;
      }
      const b = this.run.body;
      const x = b ? safeNum(b.x, 0) : 0, y = b ? safeNum(b.y, 0) : 0;
      vb.left = x - 16; vb.right = x + 26; vb.bottom = y - 9; vb.top = y + 10;
      return vb;
    }

    _free(pool) {
      for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
      return null;
    }

    _ownsLive(pool, rec) {
      for (let i = 0; i < pool.length; i++) if (pool[i].active && pool[i].owner === rec) return true;
      return false;
    }

    _emit(type, x, y, n, vx, vy, speed, angle, spread, color, size) {
      const ps = this.run.particles;
      if (!ps || typeof ps.emit !== 'function' || !isNum(x) || !isNum(y)) return;
      const o = this._po;
      o.vx = vx || 0; o.vy = vy || 0;
      o.speed = speed || 0;
      o.angle = isNum(angle) && (speed || spread) ? angle : undefined;
      o.spread = isNum(spread) && spread > 0 ? spread : undefined;
      o.color = typeof color === 'string' ? color : undefined;
      o.size = size || 0;
      o.life = 0;
      try { ps.emit(type, x, y, n, o); } catch (e) { logOnce('particles', e); }
    }

    _addCoin(x, y, value, vx, vy, falling) {
      const c = this.run.collectibles;
      if (!c || typeof c.addCoin !== 'function' || !isNum(x) || !isNum(y)) return false;
      try {
        c.addCoin(x, y, value, falling ? { falling: true, vx: safeNum(vx, 0), vy: safeNum(vy, 0) } : { vx: 0, vy: 0, falling: false });
        return true;
      } catch (e) { logOnce('addCoin', e); return false; }
    }

    _shake(i, d) {
      const cam = this.run.camera;
      if (cam && typeof cam.shake === 'function') { try { cam.shake(i, d); } catch (e) { /* ignore */ } }
    }

    _sfx(name, opts) {
      if (this.run.mode === 'attract') return;
      try { if (RR.Audio && typeof RR.Audio.play === 'function') RR.Audio.play(name, opts); } catch (e) { /* audio optional */ }
    }

    _warn(text, kind) {
      if (this.run.mode === 'attract') return;
      try { if (typeof this.run.warn === 'function') this.run.warn(text, kind); } catch (e) { logOnce('warn', e); }
      if (kind === 'hazard') this._sfx('warning');
    }

    _announce(title, sub, kind) {
      if (this.run.mode === 'attract') return;
      try { if (typeof this.run.announce === 'function') this.run.announce(title, sub, kind); } catch (e) { logOnce('announce', e); }
    }

    // ================================================================ rendering (WORLD transform, y-up m)
    _drawWorld(ctx) {
      const run = this.run;
      if (!run.body) return;
      const vb = this._view();
      const L = vb.left - 4, R = vb.right + 4;
      const time = this.time;

      // scorch marks / craters (on the ground, drawn first)
      for (const s of this.scorches) {
        if (!s.active || s.x < L - s.r || s.x > R + s.r) continue;
        const fade = 1 - clamp((s.age - 15) / 10, 0, 1);
        const gy = this._ground(s.x);
        ctx.globalAlpha = 0.55 * fade;
        ctx.fillStyle = s.kind === 'bolt' ? '#1d2230' : '#140d0b';
        ctx.beginPath();
        ctx.ellipse(s.x, gy + 0.02, s.r, s.r * 0.22, 0, 0, TAU);
        ctx.fill();
        if (s.kind !== 'bolt' && s.age < 6) {
          ctx.globalAlpha = 0.8 * (1 - s.age / 6);
          ctx.fillStyle = s.kind === 'lava' ? '#ff6a1f' : '#ff9a3a';
          ctx.beginPath();
          ctx.ellipse(s.x, gy + 0.03, s.r * 0.55, s.r * 0.1, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      this._drawPads(ctx, L, R, time);

      // active events (zones, ramps, geysers, signs, drones, bird)
      for (const rec of this.active) {
        switch (rec.id) {
          case 'fuel_zone': this._drawZone(ctx, rec, L, R, time); break;
          case 'moving_ramp': this._drawRamp(ctx, rec, L, R, time); break;
          case 'lava_eruption': this._drawGeyser(ctx, rec, L, R, time); break;
          case 'steep_surprise': this._drawSteepSign(ctx, rec, L, R, time); break;
          case 'drones': this._drawDrones(ctx, rec, L, R, time); break;
          case 'bird': this._drawBird(ctx, rec, L, R, time); break;
          default: break;
        }
      }

      // ground warnings
      for (const m of this.markers) if (m.active && m.x > L - 3 && m.x < R + 3) this._drawMarker(ctx, m, time);

      this._drawRocks(ctx, L, R);
      this._drawMeteors(ctx, L, R);
      this._drawBolts(ctx);
      this._drawWindStreaks(ctx, vb, time);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _glow(ctx, color, x, y, size, alpha) {
      const spr = RR.Particles && typeof RR.Particles.glowSprite === 'function' ? RR.Particles.glowSprite(color) : null;
      if (!spr) return;
      const prevOp = ctx.globalCompositeOperation, prevA = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.drawImage(spr, x - size / 2, y - size / 2, size, size);
      ctx.globalCompositeOperation = prevOp;
      ctx.globalAlpha = prevA;
    }

    _drawMarker(ctx, m, time) {
      const col = markerColor(m.kind);
      const prog = clamp(m.t / m.dur, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(time * (8 + prog * 10));
      const x = m.x, y = m.y;
      this._glow(ctx, col, x, y + 0.2, 3 + pulse * 1.2, 0.55 + 0.3 * pulse);
      ctx.lineWidth = 0.09;
      ctx.strokeStyle = col;
      if (m.kind === 'lightning') {
        // growing crackling rings
        for (let k = 0; k < 2; k++) {
          const rr = 0.3 + 2.0 * ((prog + k * 0.5) % 1);
          ctx.globalAlpha = 0.9 * (1 - ((prog + k * 0.5) % 1)) + 0.1;
          ctx.beginPath();
          ctx.ellipse(x, y + 0.05, rr, rr * 0.28, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#e8fbff';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = this.vrng.range(0, Math.PI);
          const rr = this.vrng.range(0.4, 1.6);
          let px = x + Math.cos(a) * 0.3, py = y + Math.sin(a) * 0.2;
          ctx.moveTo(px, py);
          for (let s = 0; s < 3; s++) {
            px += Math.cos(a) * rr / 3 + this.vrng.range(-0.15, 0.15);
            py += Math.sin(a) * rr / 3 + this.vrng.range(-0.15, 0.15);
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      } else {
        // countdown ring shrinking onto the impact point + fixed inner ring
        const rr = lerp(2.4, 0.9, prog);
        ctx.globalAlpha = 0.5 + 0.5 * pulse;
        ctx.beginPath();
        ctx.ellipse(x, y + 0.05, rr, rr * 0.28, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.ellipse(x, y + 0.05, 0.8, 0.22, 0, 0, TAU);
        ctx.stroke();
      }
      // bobbing down-chevrons
      ctx.globalAlpha = 0.65 + 0.35 * pulse;
      ctx.fillStyle = col;
      for (let k = 0; k < 2; k++) {
        const cy = y + 1.2 + k * 0.7 + Math.sin(time * 6) * 0.15;
        ctx.beginPath();
        ctx.moveTo(x - 0.45, cy + 0.35);
        ctx.lineTo(x, cy);
        ctx.lineTo(x + 0.45, cy + 0.35);
        ctx.lineTo(x + 0.45, cy + 0.55);
        ctx.lineTo(x, cy + 0.2);
        ctx.lineTo(x - 0.45, cy + 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawRocks(ctx, L, R) {
      const pal = this.world.palette || {};
      const rockCol = pal.rock || '#8c8a82';
      for (const p of this.rocks) {
        if (!p.active || p.x < L - 2 || p.x > R + 2) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (this._snowy) {
          ctx.fillStyle = '#f4f8ff';
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(150,180,220,0.45)';
          ctx.beginPath(); ctx.arc(p.r * 0.2, -p.r * 0.25, p.r * 0.8, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(-p.r * 0.3, p.r * 0.35, p.r * 0.35, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(120,150,190,0.6)';
          ctx.lineWidth = 0.05;
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.stroke();
        } else {
          ctx.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = k / 7 * TAU, rr = p.r * p.shape[k];
            if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fillStyle = rockCol;
          ctx.fill();
          ctx.lineWidth = 0.06;
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.arc(p.r * 0.15, -p.r * 0.2, p.r * 0.55, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath();
          ctx.arc(-p.r * 0.3, p.r * 0.3, p.r * 0.3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    _drawMeteors(ctx, L, R) {
      for (const p of this.meteors) {
        if (!p.active || p.x < L - 20 || p.x > R + 20) continue;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const ux = p.vx / sp, uy = p.vy / sp;
        // tail: three tapered strokes, widest/faintest first
        ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const tl = METEOR_TAILS[k];
          ctx.strokeStyle = tl[2];
          ctx.lineWidth = tl[1];
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - ux * tl[0], p.y - uy * tl[0]);
          ctx.stroke();
        }
        this._glow(ctx, '#ff8a2a', p.x, p.y, 3.2, 0.95);
        ctx.fillStyle = '#3a2a24';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffcf6a';
        ctx.beginPath(); ctx.arc(p.x + ux * p.r * 0.35, p.y + uy * p.r * 0.35, p.r * 0.55, 0, TAU); ctx.fill();
      }
      ctx.lineCap = 'butt';
    }

    _drawBolts(ctx) {
      for (const p of this.bolts) {
        if (!p.active) continue;
        const a = 1 - p.t / 0.45;
        const passes = BOLT_PASSES;
        ctx.lineJoin = 'round';
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = a;
          ctx.strokeStyle = passes[k][1];
          ctx.lineWidth = passes[k][0];
          ctx.beginPath();
          for (let i = 0; i < p.n; i++) {
            if (i === 0) ctx.moveTo(p.pts[0], p.pts[1]); else ctx.lineTo(p.pts[i * 2], p.pts[i * 2 + 1]);
          }
          ctx.stroke();
          ctx.lineWidth = passes[k][0] * 0.6;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            if (i === 0) ctx.moveTo(p.br[0], p.br[1]); else ctx.lineTo(p.br[i * 2], p.br[i * 2 + 1]);
          }
          ctx.stroke();
        }
        this._glow(ctx, '#bfe6ff', p.x, p.pts[(p.n - 1) * 2 + 1], 5, a);
        ctx.globalAlpha = 1;
        ctx.lineJoin = 'miter';
      }
    }

    _drawPads(ctx, L, R, time) {
      const t = this.run.terrain;
      const fs = t && Array.isArray(t.features) ? t.features : null;
      if (!fs) return;
      for (let i = lowerBound(fs, L - 8); i < fs.length; i++) {
        const f = fs[i];
        if (f.x > R) break;
        if (f.type !== 'bouncepad' && f.type !== 'boostpad') continue;
        const bounce = f.type === 'bouncepad';
        const col = bounce ? COLORS.bounce : COLORS.boost;
        const x0 = f.x, x1 = f.x2, y0 = this._ground(x0), y1 = this._ground(x1);
        const len = x1 - x0;
        // base plate
        ctx.fillStyle = '#1a1030';
        ctx.beginPath();
        ctx.moveTo(x0 - 0.2, y0 - 0.02);
        ctx.lineTo(x1 + 0.2, y1 - 0.02);
        ctx.lineTo(x1, y1 + 0.18);
        ctx.lineTo(x0, y0 + 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 0.18);
        ctx.lineTo(x1, y1 + 0.18);
        ctx.stroke();
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 0.2;
        this._glow(ctx, col, cx, cy, len * 1.1 + 1, 0.45 + 0.2 * Math.sin(time * 5));
        ctx.fillStyle = col;
        if (bounce) {
          // rising up-chevrons
          for (let k = 0; k < 3; k++) {
            const ph = (time * 1.2 + k / 3) % 1;
            const yy = cy + 0.3 + ph * 2.2;
            ctx.globalAlpha = (1 - ph) * 0.9;
            ctx.beginPath();
            ctx.moveTo(cx - 0.8, yy);
            ctx.lineTo(cx, yy + 0.5);
            ctx.lineTo(cx + 0.8, yy);
            ctx.lineTo(cx + 0.8, yy - 0.22);
            ctx.lineTo(cx, yy + 0.28);
            ctx.lineTo(cx - 0.8, yy - 0.22);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          // scrolling forward chevrons on the plate
          const n = Math.max(2, Math.floor(len / 1.2));
          for (let k = 0; k < n; k++) {
            const ph = (k / n + time * 0.9) % 1;
            const xx = x0 + 0.3 + ph * (len - 0.6);
            const yy = lerp(y0, y1, (xx - x0) / (len || 1)) + 0.45;
            ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.95;
            ctx.beginPath();
            ctx.moveTo(xx - 0.25, yy + 0.3);
            ctx.lineTo(xx + 0.15, yy);
            ctx.lineTo(xx - 0.25, yy - 0.3);
            ctx.lineTo(xx - 0.05, yy);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    _drawZone(ctx, rec, L, R, time) {
      if (rec.x1 < L || rec.x0 > R) return;
      // glowing ground band inside the zone
      const a = Math.max(rec.x0, L), b = Math.min(rec.x1, R);
      ctx.strokeStyle = 'rgba(70,255,122,0.35)';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (let x = a; x <= b + 0.01; x += 2) {
        const y = this._ground(Math.min(x, b)) + 0.2;
        if (x === a) ctx.moveTo(x, y); else ctx.lineTo(Math.min(x, b), y);
      }
      ctx.stroke();
      for (let k = 0; k < 2; k++) {
        const gx = k === 0 ? rec.x0 : rec.x1;
        if (gx < L - 3 || gx > R + 3) continue;
        const gy = this._ground(gx);
        const H = 7;
        const pulse = 0.5 + 0.5 * Math.sin(time * 4 + k);
        // energy beam
        ctx.globalAlpha = 0.16 + 0.1 * pulse;
        ctx.fillStyle = COLORS.fuel;
        ctx.fillRect(gx - 0.6, gy, 1.2, H);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#c8ffd7';
        ctx.fillRect(gx - 0.12, gy, 0.24, H);
        ctx.globalAlpha = 1;
        // posts
        ctx.fillStyle = '#1f3b2a';
        ctx.fillRect(gx - 0.75, gy, 0.16, H + 0.4);
        ctx.fillRect(gx + 0.59, gy, 0.16, H + 0.4);
        ctx.fillStyle = COLORS.fuel;
        ctx.fillRect(gx - 0.75, gy + H + 0.2, 1.5, 0.2);
        // fuel-drop emblem on top
        const ey = gy + H + 1.2;
        ctx.beginPath();
        ctx.moveTo(gx, ey + 0.55);
        ctx.quadraticCurveTo(gx + 0.45, ey - 0.05, gx, ey - 0.35);
        ctx.quadraticCurveTo(gx - 0.45, ey - 0.05, gx, ey + 0.55);
        ctx.fill();
        this._glow(ctx, COLORS.fuel, gx, gy + H * 0.5, 5 + pulse, 0.4);
        this._glow(ctx, COLORS.fuel, gx, ey, 2.5, 0.8);
      }
    }

    _drawRamp(ctx, rec, L, R, time) {
      if (rec.b < L || rec.a > R) return;
      // rail
      const ya = this._ground(rec.a), yb = this._ground(rec.b);
      ctx.strokeStyle = 'rgba(255,63,208,0.55)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(rec.a, ya + 0.05);
      ctx.lineTo(rec.b, yb + 0.05);
      ctx.stroke();
      ctx.fillStyle = '#2a1850';
      ctx.fillRect(rec.a - 0.1, ya, 0.2, 0.5);
      ctx.fillRect(rec.b - 0.1, yb, 0.2, 0.5);
      // wedge
      const x0 = rec.rx, x1 = rec.rx + rec.len;
      const g0 = this._ground(x0), g1 = this._ground(x1);
      ctx.fillStyle = '#231646';
      ctx.beginPath();
      ctx.moveTo(x0, g0);
      ctx.lineTo(x1, g1);
      ctx.lineTo(x1, g1 + rec.hgt);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLORS.bounce;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(x0, g0);
      ctx.lineTo(x1, g1 + rec.hgt);
      ctx.lineTo(x1, g1);
      ctx.stroke();
      this._glow(ctx, COLORS.bounce, (x0 + x1) / 2, (g0 + g1) / 2 + rec.hgt * 0.5, 4, 0.5 + 0.2 * Math.sin(time * 6));
      // chevrons on the face
      ctx.fillStyle = '#ffd6f4';
      for (let k = 0; k < 2; k++) {
        const u = 0.35 + k * 0.3;
        const xx = x0 + rec.len * u, yy = lerp(g0, g1, u) + rec.hgt * u * 0.5;
        ctx.beginPath();
        ctx.moveTo(xx - 0.2, yy + 0.2);
        ctx.lineTo(xx + 0.15, yy);
        ctx.lineTo(xx - 0.2, yy - 0.2);
        ctx.closePath();
        ctx.fill();
      }
      // wheels of the sled
      ctx.fillStyle = '#0b0818';
      ctx.beginPath(); ctx.arc(x0 + 0.6, g0 + 0.12, 0.14, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x1 - 0.5, g1 + 0.12, 0.14, 0, TAU); ctx.fill();
    }

    _drawGeyser(ctx, rec, L, R, time) {
      if (rec.x < L - 3 || rec.x > R + 3) return;
      const x = rec.x, y = rec.y;
      const u = rec.t - LAVA_TELEGRAPH;
      if (u < 0) {
        // glowing crack that brightens toward the eruption
        const k = clamp(rec.t / LAVA_TELEGRAPH, 0, 1);
        const flick = 0.7 + 0.3 * Math.sin(time * 23);
        this._glow(ctx, COLORS.lava, x, y + 0.1, 2 + 2.5 * k, (0.4 + 0.5 * k) * flick);
        ctx.strokeStyle = k > 0.6 ? '#ffe28a' : '#ff8a2a';
        ctx.lineWidth = 0.06 + 0.1 * k;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const xx = x - 1.2 + i * 0.3;
          const yy = this._ground(xx) + 0.03 + rec.crack[i] * 0.4;
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        // bubbles
        ctx.fillStyle = '#ff9a3a';
        for (let i = 0; i < 4; i++) {
          const ph = (time * (0.9 + i * 0.2) + i * 0.37) % 1;
          ctx.globalAlpha = (1 - ph) * k;
          ctx.beginPath();
          ctx.arc(x - 0.6 + i * 0.4, y + 0.05 + ph * 0.5, 0.06 + 0.08 * (1 - ph), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return;
      }
      if (rec.h <= 0.05) {
        this._glow(ctx, COLORS.lava, x, y + 0.1, 2.5, clamp(1 - (u - rec.eruptDur) / 0.6, 0, 1) * 0.6);
        return;
      }
      const h = rec.h, hw = rec.hw;
      const grad = ctx.createLinearGradient(x - hw * 1.3, 0, x + hw * 1.3, 0);
      grad.addColorStop(0, 'rgba(200,40,10,0.85)');
      grad.addColorStop(0.35, '#ff7a1c');
      grad.addColorStop(0.5, '#ffe9a0');
      grad.addColorStop(0.65, '#ff7a1c');
      grad.addColorStop(1, 'rgba(200,40,10,0.85)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      const segs = 8;
      for (let i = 0; i <= segs; i++) {
        const k = i / segs, yy = y + h * k;
        const w = hw * (1.25 - 0.35 * k) * (1 + 0.14 * Math.sin(time * 14 + i * 1.7));
        if (i === 0) ctx.moveTo(x - w, yy); else ctx.lineTo(x - w, yy);
      }
      // rounded splashing top
      ctx.quadraticCurveTo(x, y + h + 0.9 + 0.3 * Math.sin(time * 11), x + hw * 0.9, y + h);
      for (let i = segs; i >= 0; i--) {
        const k = i / segs, yy = y + h * k;
        const w = hw * (1.25 - 0.35 * k) * (1 + 0.14 * Math.sin(time * 13 + i * 2.1 + 1));
        ctx.lineTo(x + w, yy);
      }
      ctx.closePath();
      ctx.fill();
      this._glow(ctx, '#ff7a1c', x, y + 0.3, 5, 0.9);
      this._glow(ctx, '#ffb03a', x, y + h, 4, 0.8);
      this._glow(ctx, '#ff5a14', x, y + h * 0.5, h * 0.9, 0.35);
    }

    _drawSteepSign(ctx, rec, L, R) {
      const sx = rec.x - 8;
      if (sx < L - 2 || sx > R + 2 || this.run.body.x > rec.x + 5) return;
      const gy = this._ground(sx);
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(sx - 0.07, gy, 0.14, 2.2);
      const cy = gy + 2.6;
      ctx.save();
      ctx.translate(sx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffcf33';
      ctx.fillRect(-0.45, -0.45, 0.9, 0.9);
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 0.07;
      ctx.strokeRect(-0.4, -0.4, 0.8, 0.8);
      ctx.restore();
      // slope glyph (a rising wedge)
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.moveTo(sx - 0.35, cy - 0.22);
      ctx.lineTo(sx + 0.35, cy - 0.22);
      ctx.lineTo(sx + 0.35, cy + 0.25);
      ctx.closePath();
      ctx.fill();
    }

    _drawDrones(ctx, rec, L, R, time) {
      const armed = rec.t >= DRONE_ARM;
      for (let i = 0; i < rec.drones.length; i++) {
        const d = rec.drones[i];
        if (!d.alive || d.x < L - 3 || d.x > R + 3) continue;
        const x = d.x, y = d.y;
        // scan beam
        if (armed) {
          const gy = this._ground(x);
          ctx.fillStyle = 'rgba(255,47,77,0.12)';
          ctx.beginPath();
          ctx.moveTo(x - 0.15, y - 0.2);
          ctx.lineTo(x + 0.15, y - 0.2);
          ctx.lineTo(x + 0.9, gy);
          ctx.lineTo(x - 0.9, gy);
          ctx.closePath();
          ctx.fill();
        }
        // arms + rotors
        ctx.strokeStyle = '#3a3f55';
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        ctx.moveTo(x - 0.75, y + 0.2); ctx.lineTo(x + 0.75, y + 0.2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,220,255,0.35)';
        for (let k = -1; k <= 1; k += 2) {
          const w = 0.45 * (0.6 + 0.4 * Math.abs(Math.sin(time * 40 + k)));
          ctx.beginPath();
          ctx.ellipse(x + k * 0.75, y + 0.3, w, 0.06, 0, 0, TAU);
          ctx.fill();
        }
        // body
        ctx.fillStyle = '#1b1f2b';
        ctx.beginPath();
        ctx.ellipse(x, y, 0.55, 0.26, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#5ff4ff';
        ctx.lineWidth = 0.05;
        ctx.stroke();
        ctx.fillStyle = '#2d344a';
        ctx.beginPath();
        ctx.ellipse(x, y + 0.14, 0.28, 0.12, 0, 0, TAU);
        ctx.fill();
        // blinking red eye (faster once armed)
        const on = Math.sin((time + d.blink) * (armed ? 16 : 6)) > 0;
        ctx.fillStyle = on ? '#ff2f4d' : '#5a1020';
        ctx.beginPath();
        ctx.arc(x, y - 0.12, 0.09, 0, TAU);
        ctx.fill();
        if (on) this._glow(ctx, COLORS.drone, x, y - 0.12, 1.6, 0.9);
      }
    }

    _drawBird(ctx, rec, L, R) {
      const p = rec.pouch;
      if (p && !p.burst && p.x > L - 2 && p.x < R + 2) {
        ctx.fillStyle = '#8a5a2b';
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.32, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5c3a1a';
        ctx.fillRect(p.x - 0.12, p.y + 0.24, 0.24, 0.14);
        ctx.fillStyle = COLORS.gold;
        ctx.beginPath(); ctx.arc(p.x + 0.1, p.y - 0.05, 0.08, 0, TAU); ctx.fill();
        this._glow(ctx, COLORS.gold, p.x, p.y, 1.4, 0.5);
      }
      if (rec.x < L - 4 || rec.x > R + 4) return;
      const dark = safeNum(this.world.darkness, 0) > 0.12 || this.world.id === 'neon_city';
      ctx.save();
      ctx.translate(rec.x, rec.y);
      ctx.scale(rec.vx < 0 ? -1 : 1, 1);      // silhouette is authored facing +x
      // side-view flap: both wings sweep up/down together (vertical scale = foreshortening);
      // every third beat is a short glide with the wings held slightly raised
      const glide = (Math.floor(rec.phase / TAU) % 3) === 2;
      let k = glide ? 0.3 : Math.cos(rec.phase);
      if (Math.abs(k) < 0.12) k = k < 0 ? -0.12 : 0.12;
      const light = dark;
      // far wing (behind the body)
      ctx.fillStyle = light ? '#b9b2a6' : '#4a423b';
      this._wing(ctx, k * 0.85, -0.12);
      ctx.fillStyle = light ? '#d9d2c6' : '#2b2622';
      // body
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.75, 0.22, 0, 0, TAU);
      ctx.fill();
      // tail fan
      ctx.beginPath();
      ctx.moveTo(-0.6, 0.02);
      ctx.lineTo(-1.15, 0.18);
      ctx.lineTo(-1.2, -0.12);
      ctx.closePath();
      ctx.fill();
      // head + hooked beak
      ctx.beginPath();
      ctx.arc(0.78, 0.08, 0.17, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8b53a';
      ctx.beginPath();
      ctx.moveTo(0.9, 0.12);
      ctx.lineTo(1.12, 0.04);
      ctx.lineTo(0.95, -0.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = dark ? '#2b2622' : '#f1efe8';
      ctx.beginPath();
      ctx.arc(0.82, 0.13, 0.035, 0, TAU);
      ctx.fill();
      // near wing
      ctx.fillStyle = dark ? '#efe8dc' : '#1f1b18';
      this._wing(ctx, k, 0);
      ctx.restore();
    }

    // Swept wing with fingered tip, authored pointing up from the shoulder. `k` (−1..1) is the vertical
    // scale: +1 fully raised, −1 fully lowered (mirrored), small values = seen edge-on mid-stroke.
    _wing(ctx, k, dx) {
      ctx.save();
      ctx.translate(0.1 + dx, 0.08);
      ctx.scale(1, k);
      ctx.beginPath();
      ctx.moveTo(0.25, 0);
      ctx.quadraticCurveTo(0.2, 0.9, -0.3, 1.6);
      ctx.lineTo(-0.45, 1.55);
      ctx.lineTo(-0.5, 1.35);
      ctx.lineTo(-0.62, 1.3);
      ctx.lineTo(-0.62, 1.1);
      ctx.quadraticCurveTo(-0.5, 0.5, -0.3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _drawWindStreaks(ctx, vb, time) {
      let k = 0, dir = 1;
      for (const rec of this.active) {
        if (rec.id === 'wind_gust' && rec.intensity > k) { k = rec.intensity; dir = rec.dir; }
      }
      const bs = this.blend.storm;
      if (bs > 0 && bs * 0.8 > k) {
        const w = safeNum(this.run.env && this.run.env.wind, 0);
        k = Math.max(k, bs * clamp(Math.abs(w) / 9, 0.2, 0.8));
        dir = w < 0 ? -1 : 1;
      }
      if (k <= 0.02) return;
      const W = vb.right - vb.left, Hh = vb.top - vb.bottom;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.05;
      ctx.lineCap = 'round';
      const n = 22;
      for (let i = 0; i < n; i++) {
        const r1 = hashf(i * 3 + 1), r2 = hashf(i * 3 + 2), r3 = hashf(i * 3 + 3);
        const speed = 18 + 14 * r1;
        const len = 1.5 + 2.5 * r2;
        let x = (r3 * W + dir * time * speed) % W;
        if (x < 0) x += W;
        x += vb.left;
        const y = vb.bottom + (0.1 + 0.85 * r1) * Hh + Math.sin(time * 2 + i) * 0.3;
        ctx.globalAlpha = k * (0.25 + 0.35 * r2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dir * len, y + 0.05);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }

    // ================================================================ rendering (SCREEN transform, CSS px)
    _drawScreen(ctx) {
      const run = this.run, cam = run.camera;
      if (!run.body || !cam || typeof cam.worldToScreen !== 'function') return;
      const r = run.renderer;
      const W = (r && r.w) || cam.viewW || (ctx.canvas && ctx.canvas.width) || 0;
      const H = (r && r.h) || cam.viewH || (ctx.canvas && ctx.canvas.height) || 0;
      if (!(W > 0 && H > 0)) return;
      const time = this.time, sp = this._sp;
      const pulse = 0.55 + 0.45 * Math.sin(time * 10);
      const small = Math.min(W, H) < 500;
      const size = small ? 11 : 14;

      // marker indicators: down-arrows at the top edge where things will fall from the sky; a single
      // right-edge arrow (with distance) for the nearest warning that is still off-screen ahead
      let near = null, nearY = 0;
      for (const m of this.markers) {
        if (!m.active) continue;
        cam.worldToScreen(m.x, m.y, sp);
        if (sp.x > W - 8) {
          if (!near || m.x < near.x) { near = m; nearY = sp.y; }
        } else if (sp.x >= 8 && m.kind !== 'lava') {
          this._edgeArrow(ctx, sp.x, 18 + size, Math.PI / 2, markerColor(m.kind), size, pulse, NaN);
        }
      }
      if (near) this._edgeArrow(ctx, W - 18, clamp(nearY, 60, H - 40), 0, markerColor(near.kind), size, pulse, near.x - run.body.x);
      for (const rec of this.active) {
        if (rec.id === 'drones') {
          for (const d of rec.drones) {
            if (!d.alive) continue;
            cam.worldToScreen(d.x, d.y, sp);
            if (sp.x > W - 8) this._edgeArrow(ctx, W - 18, clamp(sp.y, 60, H - 40), 0, COLORS.drone, size, pulse, d.x - run.body.x);
          }
        } else if (rec.id === 'wind_gust' && rec.intensity > 0.02) {
          this._windArrow(ctx, W / 2, small ? 70 : 88, rec, time, small);
        } else if ((rec.id === 'fuel_zone' || rec.id === 'moving_ramp' || (rec.id === 'lava_eruption' && !(rec.marker && rec.marker.active))) && !rec.done) {
          const x = rec.id === 'fuel_zone' ? rec.x0 : rec.id === 'moving_ramp' ? rec.a : rec.x;
          if (run.body.x < x) {
            cam.worldToScreen(x, this._ground(x) + 1, sp);
            const col = rec.id === 'fuel_zone' ? COLORS.fuel : rec.id === 'moving_ramp' ? COLORS.bounce : COLORS.lava;
            if (sp.x > W - 8) this._edgeArrow(ctx, W - 18, clamp(sp.y, 60, H - 40), 0, col, size, rec.hazard ? pulse : 0.85, x - run.body.x);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Triangle arrow pointing along `ang` (0 = right, π/2 = down in screen space) with optional distance.
    _edgeArrow(ctx, x, y, ang, col, size, alpha, dist) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.rotate(ang);
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(size * 0.9, 0);
      ctx.lineTo(-size * 0.6, -size * 0.75);
      ctx.lineTo(-size * 0.25, 0);
      ctx.lineTo(-size * 0.6, size * 0.75);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      if (isNum(dist) && dist > 0) {
        ctx.globalAlpha = 0.9;
        ctx.font = '700 ' + Math.round(size * 0.85) + 'px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const s = Math.round(dist) + ' m';
        ctx.strokeText(s, x - size, y);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(s, x - size, y);
      }
      ctx.globalAlpha = 1;
    }

    _windArrow(ctx, cx, cy, rec, time, small) {
      const tele = rec.t < rec.tele;
      const a = tele ? (Math.sin(time * 14) > 0 ? 0.95 : 0.35) : 0.35 + 0.6 * rec.intensity;
      const len = (small ? 60 : 90) * (tele ? 0.8 : 0.6 + 0.6 * rec.intensity);
      const dir = rec.dir;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);
      ctx.fillStyle = '#e8f6ff';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      const hh = small ? 7 : 9;
      ctx.beginPath();
      ctx.moveTo(-len / 2, -hh * 0.45);
      ctx.lineTo(len / 2 - hh * 1.6, -hh * 0.45);
      ctx.lineTo(len / 2 - hh * 1.6, -hh * 1.3);
      ctx.lineTo(len / 2, 0);
      ctx.lineTo(len / 2 - hh * 1.6, hh * 1.3);
      ctx.lineTo(len / 2 - hh * 1.6, hh * 0.45);
      ctx.lineTo(-len / 2, hh * 0.45);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      // trailing speed lines
      ctx.strokeStyle = '#e8f6ff';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const off = ((time * 2 + k / 3) % 1) * 18;
        ctx.beginPath();
        ctx.moveTo(-len / 2 - 8 - off, (k - 1) * hh * 1.1);
        ctx.lineTo(-len / 2 - 20 - off, (k - 1) * hh * 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function markerColor(kind) {
    return kind === 'meteor' ? COLORS.meteor : kind === 'lightning' ? COLORS.lightning : kind === 'lava' ? COLORS.lava : COLORS.warn;
  }

  // ------------------------------------------------------------------ geometry helpers
  function lowerBound(fs, x) {
    let lo = 0, hi = fs.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (fs[m].x < x) lo = m + 1; else hi = m;
    }
    return lo;
  }

  // Even-odd point in polygon (flat [x0,y0,x1,y1,...]).
  function pointInPoly(p, x, y) {
    let inside = false;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distToPoly(p, x, y) {
    let best = Infinity;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = p[j * 2], ay = p[j * 2 + 1], bx = p[i * 2], by = p[i * 2 + 1];
      const ex = bx - ax, ey = by - ay;
      const l2 = ex * ex + ey * ey;
      let t = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + ex * t), dy = y - (ay + ey * t);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return best;
  }

  EventSystem.EVENT_IDS = EVENT_IDS;
  EventSystem.HAZARDS = HAZARDS;
  EventSystem.MIN_TELEGRAPH = MIN_TELEGRAPH;
  RR.EventSystem = EventSystem;
})();
