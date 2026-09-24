/* RIDGE RUSH — vehicle catalogue & upgrade model (RR.Vehicles).
 *
 * Pure data + pure functions. `getTuned(vehicleId, upgrades)` turns a VehicleDef plus the player's
 * upgrade levels into the TunedParams object consumed by RR.VehicleBody (js/game/physics.js),
 * RR.VehicleArt, Run (fuel) and the garage UI.
 *
 * Contract additions (documented, never renames):
 *  - TunedParams also carries: name, topSpeed (design flat-ground top speed, m/s), drag (quadratic aero
 *    drag, 1/m), handbrakeTorque (N·m), diffLock (0..1 limited-slip coupling between the driven
 *    wheels), levels {engine..brakes}, inertiaEff (chassis + wheel
 *    parallel-axis inertia, kg·m²), suspension.{staticLen, freq, zeta} and per-wheel
 *    wheels[i].{rest, staticLen, stiffness, damping} (per-wheel spring so both axles sag equally and the
 *    car sits level; `suspension.stiffness/damping` are the axle averages).
 *  - maxSpeed is the nominal flat-ground top speed; physics clamps |v| at min(1.3 × maxSpeed,
 *    RR.CONST.MAX_SPEED) to leave headroom for downhill runs and boosts.
 *  - special.force is the `controls.boost` value Run should apply while the special is active
 *    (1 ⇒ ≈ 0.9 g of forward thrust along the chassis).
 *  - describeUpgrade() also returns {detail, amount}; displayStats() values are floats in 0..10.
 *  - RR.Vehicles.CAT_MULT and RR.Vehicles.indexOf(id) are exported for convenience.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const G = (RR.CONST && RR.CONST.GRAVITY) || 9.81;
  const MAX_SPEED = (RR.CONST && RR.CONST.MAX_SPEED) || 60;

  const MAX_UPGRADE_LEVEL = 10;

  const UPGRADE_CATEGORIES = Object.freeze([
    { id: 'engine', name: 'ENGINE', desc: 'More torque and a higher top speed.' },
    { id: 'suspension', name: 'SUSPENSION', desc: 'Better dampers and longer travel for softer landings.' },
    { id: 'tires', name: 'TIRES', desc: 'Less rolling resistance, better bite on snow, sand and ice.' },
    { id: 'fuel', name: 'FUEL', desc: 'Bigger tank and a more efficient engine.' },
    { id: 'grip', name: 'GRIP', desc: 'Stickier compound for steeper climbs.' },
    { id: 'air', name: 'AIR CONTROL', desc: 'Faster rotation while airborne.' },
    { id: 'brakes', name: 'BRAKES', desc: 'Stronger brakes and reverse for downhill control.' }
  ].map(Object.freeze));
  const CAT_IDS = UPGRADE_CATEGORIES.map((c) => c.id);

  // Cost multipliers per category (upgradeCost formula is part of the contract).
  const CAT_MULT = Object.freeze({
    engine: 1.2, suspension: 0.9, tires: 0.8, fuel: 0.85, grip: 0.9, air: 0.7, brakes: 0.6
  });

  // Upgrade effect sizes at level 10 relative to stock (level 1). t = (level-1)/9 scales linearly.
  const UPG = Object.freeze({
    torque: 0.65,          // ENGINE: +65 % torque
    topSpeed: 0.35,        // ENGINE: +35 % top speed
    tireTopSpeed: 0.04,    // TIRES: +4 % top speed
    rolling: 0.6,          // TIRES: −60 % rolling resistance
    adapt: 0.55,           // TIRES: +0.55 surface adaptation (clamped to 1)
    zeta: 0.7,             // SUSPENSION: +70 % damping ratio
    bumpStop: 0.4,         // SUSPENSION: bump stop 40 % closer to the mount (more compression travel)
    droop: 0.06,           // SUSPENSION: +6 cm extension travel
    capacity: 0.7,         // FUEL: +70 % tank
    burn: 0.3,             // FUEL: −30 % consumption
    grip: 0.58,            // GRIP: +58 % μ
    air: 0.75,             // AIR CONTROL: +75 % air torque
    groundLean: 0.25,      // AIR CONTROL: +25 % ground lean torque (kept modest: anti-flip exploit)
    brake: 0.7,            // BRAKES: +70 % brake torque
    reverse: 0.5,          // BRAKES: +50 % reverse torque
    reverseSpeed: 0.3      // BRAKES: +30 % reverse speed
  });

  // Reference world drag used to derive the motor's max wheel speed from the design top speed.
  const REF_AIR_DRAG = 0.02;

  /*
   * base (owner-defined physics design, all coordinates relative to the chassis centre of mass,
   * y-up, facing +x):
   *   mass kg · inertiaK multiplier on box inertia of the hull bounds
   *   hull [[x,y],...] CCW · head [x, y, r]
   *   mounts [[rx, ry], [fx, fy]] · wheelRadius · wheelMass · drive [rear, front] torque share
   *   diffLock 0..1 limited-slip coupling between driven wheels (1 = locked diffs)
   *   susp { minLen, maxLen, staticLen, freq Hz (body bounce), zeta (damping ratio) }
   *   torque N·m (total at the wheels) · topSpeed m/s (design flat-ground top speed, stock)
   *   reverseTorque N·m · reverseSpeed m/s · brakeTorque N·m (total)
   *   grip μ · surfaceAdapt 0..1 · rollingResistance (Crr) · drag (quadratic, 1/m)
   *   airAccel rad/s² (angular acceleration from full air input) · groundLean (fraction of air torque)
   *   airDamping 1/s · fuel { capacity, burnRate, idleBurn }
   */
  const list = [
    {
      id: 'trail_buggy',
      name: 'Trail Buggy',
      tagline: 'The honest all-rounder.',
      description: 'A tube-frame buggy with forgiving suspension and a willing little engine. ' +
        'Balanced in every way — the perfect machine to learn the mountains with.',
      unlock: { level: 1, coins: 0, tokens: 0 },
      upgradeBaseCost: 120,
      style: 'buggy',
      colors: { body: '#f2a007', accent: '#e8412c', trim: '#2b2f36', wheel: '#1d1f24', rim: '#d9dde3' },
      special: null,
      base: {
        mass: 240, inertiaK: 1.0,
        hull: [[-1.50, -0.16], [-1.05, -0.40], [0.95, -0.40], [1.72, -0.12], [1.66, 0.12],
          [0.72, 0.30], [0.25, 0.76], [-0.72, 0.78], [-1.42, 0.28]],
        head: [-0.18, 1.00, 0.22],
        mounts: [[-1.02, -0.18], [1.28, -0.18]],
        wheelRadius: 0.42, wheelMass: 20, drive: [0.6, 0.4], diffLock: 0.5,
        susp: { minLen: 0.12, maxLen: 0.46, staticLen: 0.32, freq: 1.7, zeta: 0.34 },
        torque: 920, topSpeed: 22, reverseTorque: 560, reverseSpeed: 7, brakeTorque: 1600,
        grip: 0.9, surfaceAdapt: 0.25, rollingResistance: 0.03, drag: 0.0016,
        airAccel: 9.0, groundLean: 0.45, airDamping: 1.1,
        fuel: { capacity: 100, burnRate: 1.8, idleBurn: 0.25 }
      }
    },
    {
      id: 'dirt_runner',
      name: 'Dirt Runner',
      tagline: 'Light, loud and a little bit wild.',
      description: 'A featherweight desert racer with a screaming engine and a short wheelbase. ' +
        'Explosive off the line and flips on a whim — pure air-time joy if you can tame it.',
      unlock: { level: 2, coins: 2500, tokens: 1 },
      upgradeBaseCost: 150,
      style: 'dirt',
      colors: { body: '#2fbf71', accent: '#f5f5f5', trim: '#1b2a24', wheel: '#1b1c20', rim: '#ffcc33' },
      special: null,
      base: {
        mass: 150, inertiaK: 0.95,
        hull: [[-1.37, -0.10], [-0.92, -0.32], [0.63, -0.32], [1.30, -0.06], [1.24, 0.10],
          [0.43, 0.24], [0.03, 0.60], [-0.74, 0.62], [-1.30, 0.22]],
        head: [-0.24, 0.84, 0.21],
        mounts: [[-0.95, -0.08], [0.92, -0.08]],
        wheelRadius: 0.40, wheelMass: 14, drive: [0.7, 0.3], diffLock: 0.4,
        susp: { minLen: 0.10, maxLen: 0.50, staticLen: 0.32, freq: 1.9, zeta: 0.30 },
        torque: 640, topSpeed: 23.5, reverseTorque: 380, reverseSpeed: 7, brakeTorque: 950,
        grip: 0.92, surfaceAdapt: 0.35, rollingResistance: 0.028, drag: 0.0014,
        airAccel: 13.0, groundLean: 0.45, airDamping: 1.4,
        fuel: { capacity: 80, burnRate: 1.35, idleBurn: 0.2 }
      }
    },
    {
      id: 'mountain_truck',
      name: 'Mountain Truck',
      tagline: 'Heavy metal. Heavier boots.',
      description: 'A lifted pickup with a massive torque figure and a planted, heavy stance. ' +
        'Shrugs off rough ground and rarely flips — but it drinks fuel like there is no tomorrow.',
      unlock: { level: 4, coins: 7500, tokens: 2 },
      upgradeBaseCost: 200,
      style: 'truck',
      colors: { body: '#3d6fd8', accent: '#e9eef7', trim: '#20242c', wheel: '#17181c', rim: '#aeb6c2' },
      special: null,
      base: {
        mass: 480, inertiaK: 1.05,
        hull: [[-1.95, -0.22], [-1.40, -0.46], [1.30, -0.46], [2.05, -0.20], [2.02, 0.22],
          [1.12, 0.38], [0.72, 0.84], [-0.40, 0.86], [-0.58, 0.42], [-1.92, 0.40]],
        head: [0.12, 0.90, 0.24],
        mounts: [[-1.35, -0.22], [1.50, -0.22]],
        wheelRadius: 0.52, wheelMass: 40, drive: [0.55, 0.45], diffLock: 0.6,
        susp: { minLen: 0.13, maxLen: 0.46, staticLen: 0.30, freq: 1.5, zeta: 0.40 },
        torque: 2350, topSpeed: 19.5, reverseTorque: 1400, reverseSpeed: 6.5, brakeTorque: 3800,
        grip: 0.9, surfaceAdapt: 0.3, rollingResistance: 0.035, drag: 0.0022,
        airAccel: 6.5, groundLean: 0.45, airDamping: 1.0,
        fuel: { capacity: 140, burnRate: 2.9, idleBurn: 0.35 }
      }
    },
    {
      id: 'rally_beast',
      name: 'Rally Beast',
      tagline: 'Flat out, all the time.',
      description: 'A stage-bred rally car with long-travel dampers that swallow jumps whole. ' +
        'Highest top speed on dirt and the smoothest landings in the garage.',
      unlock: { level: 7, coins: 15000, tokens: 3 },
      upgradeBaseCost: 260,
      style: 'rally',
      colors: { body: '#e63946', accent: '#ffffff', trim: '#1d3557', wheel: '#15161a', rim: '#f1faee' },
      special: null,
      base: {
        mass: 300, inertiaK: 1.0,
        hull: [[-1.70, -0.14], [-1.15, -0.38], [1.10, -0.38], [1.90, -0.14], [1.85, 0.08],
          [0.80, 0.26], [0.30, 0.64], [-0.80, 0.64], [-1.62, 0.28]],
        head: [-0.10, 0.84, 0.22],
        mounts: [[-1.12, -0.18], [1.40, -0.18]],
        wheelRadius: 0.44, wheelMass: 22, drive: [0.5, 0.5], diffLock: 0.5,
        susp: { minLen: 0.10, maxLen: 0.54, staticLen: 0.34, freq: 1.6, zeta: 0.46 },
        torque: 1280, topSpeed: 26, reverseTorque: 760, reverseSpeed: 7.5, brakeTorque: 2000,
        grip: 0.95, surfaceAdapt: 0.35, rollingResistance: 0.025, drag: 0.0012,
        airAccel: 9.5, groundLean: 0.45, airDamping: 1.15,
        fuel: { capacity: 110, burnRate: 2.0, idleBurn: 0.28 }
      }
    },
    {
      id: 'rock_crawler',
      name: 'Rock Crawler',
      tagline: 'If it has a surface, it can climb it.',
      description: 'Giant tyres, locked diffs and a mountain of low-down torque. ' +
        'Slow on the flat, unstoppable on the steep — this is the one for the walls nobody else can climb.',
      unlock: { level: 10, coins: 25000, tokens: 4 },
      upgradeBaseCost: 300,
      style: 'crawler',
      colors: { body: '#8a9a3b', accent: '#f4d35e', trim: '#2f3325', wheel: '#1a1b17', rim: '#5d6b2e' },
      special: null,
      base: {
        mass: 420, inertiaK: 1.05,
        hull: [[-1.68, -0.06], [-1.05, -0.36], [1.05, -0.36], [1.72, -0.06], [1.60, 0.22],
          [0.62, 0.38], [0.30, 0.80], [-0.78, 0.80], [-1.58, 0.30]],
        head: [-0.15, 0.96, 0.22],
        mounts: [[-1.35, 0.04], [1.35, 0.04]],
        wheelRadius: 0.60, wheelMass: 42, drive: [0.5, 0.5], diffLock: 1.0,
        susp: { minLen: 0.10, maxLen: 0.58, staticLen: 0.36, freq: 1.3, zeta: 0.40 },
        torque: 2700, topSpeed: 15, reverseTorque: 1800, reverseSpeed: 6, brakeTorque: 4200,
        grip: 1.2, surfaceAdapt: 0.5, rollingResistance: 0.045, drag: 0.0025,
        airAccel: 6.5, groundLean: 0.45, airDamping: 1.0,
        fuel: { capacity: 130, burnRate: 2.4, idleBurn: 0.3 }
      }
    },
    {
      id: 'storm_runner',
      name: 'Storm Runner',
      tagline: 'Built for weather that eats cars.',
      description: 'An experimental low-drag racer with magnetic dampers and an Ion Thruster for bursts of ' +
        'raw forward thrust. Fast, precise and very, very expensive.',
      unlock: { level: 14, coins: 45000, tokens: 6 },
      upgradeBaseCost: 420,
      style: 'storm',
      colors: { body: '#2b2d42', accent: '#3ff3ff', trim: '#8d99ae', wheel: '#111217', rim: '#3ff3ff' },
      // Run applies the thruster by passing controls.boost = special.force for `duration` seconds.
      special: { id: 'thruster', name: 'Ion Thruster', cooldown: 7, duration: 1.2, force: 1 },
      base: {
        mass: 280, inertiaK: 0.95,
        hull: [[-1.75, -0.04], [-1.20, -0.28], [1.00, -0.28], [1.95, -0.08], [1.90, 0.06],
          [0.70, 0.22], [0.20, 0.54], [-0.90, 0.54], [-1.70, 0.24]],
        head: [-0.18, 0.74, 0.21],
        mounts: [[-1.15, -0.12], [1.35, -0.12]],
        wheelRadius: 0.44, wheelMass: 22, drive: [0.65, 0.35], diffLock: 0.35,
        susp: { minLen: 0.10, maxLen: 0.40, staticLen: 0.26, freq: 2.0, zeta: 0.42 },
        torque: 1320, topSpeed: 28.5, reverseTorque: 800, reverseSpeed: 7.5, brakeTorque: 2100,
        grip: 0.95, surfaceAdapt: 0.3, rollingResistance: 0.02, drag: 0.0007,
        airAccel: 10.5, groundLean: 0.45, airDamping: 1.3,
        fuel: { capacity: 120, burnRate: 2.1, idleBurn: 0.28 }
      }
    }
  ];

  // Deep-freeze the definitions: they are shared, read-only data.
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }
  list.forEach(deepFreeze);
  const index = new Map(list.map((v) => [v.id, v]));

  const byId = (id) => index.get(id) || null;
  const indexOf = (id) => list.findIndex((v) => v.id === id);

  // ---------------------------------------------------------------- upgrade levels
  function levelOf(upgrades, catId) {
    const v = upgrades && typeof upgrades === 'object' ? upgrades[catId] : 1;
    const n = Math.round(U.safeNum(Number(v), 1));
    return U.clamp(n, 1, MAX_UPGRADE_LEVEL);
  }
  const frac = (level) => (level - 1) / (MAX_UPGRADE_LEVEL - 1);

  function upgradeCost(vehicleId, catId, currentLevel) {
    const def = byId(vehicleId);
    if (!def || !(catId in CAT_MULT)) return Infinity;
    let lv = Math.floor(U.safeNum(Number(currentLevel), 1));
    if (lv < 1) lv = 1;
    if (lv >= MAX_UPGRADE_LEVEL) return Infinity;
    return Math.round(def.upgradeBaseCost * CAT_MULT[catId] * Math.pow(1.55, lv - 1) / 10) * 10;
  }

  // Torque-curve shape shared with physics: fraction of peak torque at u = wheelSpeed / maxOmega.
  // Flat (electric-like punch) at low speed, rolling off smoothly to zero at maxOmega.
  const torqueCurve = (u) => (u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * u);

  // ---------------------------------------------------------------- tuning
  function getTuned(vehicleId, upgrades) {
    const def = byId(vehicleId) || list[0];
    const B = def.base;
    const L = {};
    for (const id of CAT_IDS) L[id] = levelOf(upgrades, id);
    const tE = frac(L.engine), tS = frac(L.suspension), tT = frac(L.tires), tF = frac(L.fuel);
    const tG = frac(L.grip), tA = frac(L.air), tB = frac(L.brakes);

    // --- chassis
    const mass = B.mass;
    const hull = B.hull.map((p) => ({ x: p[0], y: p[1] }));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const lenX = maxX - minX, lenY = maxY - minY;
    const inertia = B.inertiaK * mass * (lenX * lenX + lenY * lenY) / 12;
    const head = { x: B.head[0], y: B.head[1], r: B.head[2] };

    // --- suspension: per-wheel spring from the sprung mass on that axle so both axles sag equally.
    const zeta = B.susp.zeta * (1 + UPG.zeta * tS);
    const minLen = Math.max(0.04, B.susp.minLen * (1 - UPG.bumpStop * tS));
    const maxLen = B.susp.maxLen + UPG.droop * tS;
    const staticLen = U.clamp(B.susp.staticLen, minLen + 0.05, maxLen - 0.05);
    const wn = 2 * Math.PI * B.susp.freq;          // body-bounce natural frequency (rad/s)
    const sag = G / (wn * wn);                      // static compression under 1 g
    const rest = staticLen + sag;                   // spring free length (preloaded past maxLen is fine)
    const xr = B.mounts[0][0], xf = B.mounts[1][0];
    const wheelbase = xf - xr;
    const share = [xf / wheelbase, -xr / wheelbase]; // static load fraction on rear / front axle

    const r = B.wheelRadius;
    const wheelInertia = 0.65 * B.wheelMass * r * r; // tyre-heavy wheel (between ring and disc)
    const wheels = [];
    let kSum = 0, cSum = 0, inertiaEff = inertia;
    for (let i = 0; i < 2; i++) {
      const m = mass * share[i];
      const k = m * wn * wn;
      const c = 2 * zeta * Math.sqrt(k * m);
      kSum += k; cSum += c;
      const mx = B.mounts[i][0], my = B.mounts[i][1];
      const wy = my - staticLen;
      inertiaEff += B.wheelMass * (mx * mx + wy * wy);
      wheels.push({
        mount: { x: mx, y: my },
        radius: r,
        mass: B.wheelMass,
        inertia: wheelInertia,
        drive: B.drive[i],
        rest, staticLen, stiffness: k, damping: c
      });
    }
    const suspension = {
      rest, minLen, maxLen, stiffness: kSum / 2, damping: cSum / 2,
      staticLen, freq: B.susp.freq, zeta
    };
    const totalMass = mass + 2 * B.wheelMass;

    // --- motor
    const torque = B.torque * (1 + UPG.torque * tE);
    const topSpeed = Math.min(B.topSpeed * (1 + UPG.topSpeed * tE) * (1 + UPG.tireTopSpeed * tT), MAX_SPEED / 1.3);
    const rollingResistance = B.rollingResistance * (1 - UPG.rolling * tT);
    // Pick maxOmega so the motor's torque at `topSpeed` exactly balances the reference resistances:
    // T·curve(u) = r·M·(Crr·g + airDrag·v + drag·v²), u = v / (r·maxOmega).
    const resist = totalMass * (rollingResistance * G + REF_AIR_DRAG * topSpeed + B.drag * topSpeed * topSpeed);
    const need = U.clamp(resist * r / torque, 0, 0.95);
    const uTop = Math.cbrt(1 - need);
    const maxOmega = topSpeed / (r * uTop);
    const reverseTorque = B.reverseTorque * (1 + UPG.reverse * tB);
    const reverseMaxOmega = (B.reverseSpeed * (1 + UPG.reverseSpeed * tB)) / r;

    // --- rotation control
    const airAccel = B.airAccel * (1 + UPG.air * tA);
    const airTorque = airAccel * inertiaEff;
    const groundLeanTorque = B.airAccel * inertiaEff * B.groundLean * (1 + UPG.groundLean * tA);

    const brakeTorque = B.brakeTorque * (1 + UPG.brake * tB);

    return {
      id: def.id,
      name: def.name,
      style: def.style,
      chassis: { mass, inertia, hull, head },
      wheels,
      suspension,
      motor: { torque, maxOmega, reverseTorque, reverseMaxOmega },
      brakeTorque,
      handbrakeTorque: brakeTorque * 2.5,
      diffLock: B.diffLock,
      grip: B.grip * (1 + UPG.grip * tG),
      surfaceAdapt: U.clamp(B.surfaceAdapt + UPG.adapt * tT, 0, 1),
      rollingResistance,
      airTorque,
      groundLeanTorque,
      angularDampingAir: B.airDamping,
      fuel: {
        capacity: B.fuel.capacity * (1 + UPG.capacity * tF),
        burnRate: B.fuel.burnRate * (1 - UPG.burn * tF),
        idleBurn: B.fuel.idleBurn * (1 - UPG.burn * tF)
      },
      maxSpeed: topSpeed,
      topSpeed,
      drag: B.drag,
      inertiaEff,
      levels: L,
      special: def.special ? Object.assign({}, def.special) : null
    };
  }

  // ---------------------------------------------------------------- UI helpers
  const kmh = (ms) => Math.round(ms * 3.6);
  const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const fmt2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

  // Human-readable value of one category at `level` (other categories stock).
  function describeUpgrade(vehicleId, catId, level) {
    if (!byId(vehicleId) || CAT_IDS.indexOf(catId) < 0) return { stat: '—', value: '—', detail: '', amount: 0 };
    const lv = levelOf({ [catId]: level }, catId);
    const t = getTuned(vehicleId, { [catId]: lv });
    const stock = lv === 1 ? t : getTuned(vehicleId, null);
    switch (catId) {
      case 'engine':
        return { stat: 'Torque', value: U.formatInt(t.motor.torque) + ' Nm',
          detail: 'Top speed ' + kmh(t.topSpeed) + ' km/h', amount: t.motor.torque };
      case 'suspension':
        return { stat: 'Damping', value: 'ζ ' + fmt2(t.suspension.zeta) + ' · ' +
          Math.round((t.suspension.maxLen - t.suspension.minLen) * 100) + ' cm travel',
          detail: 'Softer, less bouncy landings', amount: t.suspension.zeta };
      case 'tires': {
        // effective grip on snow as a fraction of dry grip (the TIRES surface-penalty reduction)
        const snow = (RR.SURFACES && RR.SURFACES.snow && RR.SURFACES.snow.friction) || 0.62;
        const snowPct = Math.round(U.lerp(snow, 1, t.surfaceAdapt * 0.5) * 100);
        const roll = Math.round((1 - t.rollingResistance / stock.rollingResistance) * 100);
        return { stat: 'Top speed', value: kmh(t.topSpeed) + ' km/h',
          detail: 'Snow grip ' + snowPct + '% of dry' + (roll > 0 ? ' · rolling resistance −' + roll + '%' : ''),
          amount: t.topSpeed };
      }
      case 'fuel':
        return { stat: 'Tank', value: Math.round(t.fuel.capacity) + ' L · ' + fmt1(t.fuel.burnRate) + ' L/s',
          detail: Math.round(t.fuel.capacity / t.fuel.burnRate) + ' s at full throttle', amount: t.fuel.capacity };
      case 'grip':
        return { stat: 'Grip', value: 'μ ' + fmt2(t.grip),
          detail: 'Traction for ' + Math.round(Math.atan(t.grip) * 180 / Math.PI) + '° slopes on dry ground', amount: t.grip };
      case 'air':
        return { stat: 'Air torque', value: U.formatInt(t.airTorque) + ' Nm',
          detail: fmt1(t.airTorque / t.inertiaEff) + ' rad/s² spin', amount: t.airTorque };
      case 'brakes':
      default:
        return { stat: 'Brake', value: U.formatInt(t.brakeTorque) + ' Nm',
          detail: 'Reverse ' + U.formatInt(t.motor.reverseTorque) + ' Nm', amount: t.brakeTorque };
    }
  }

  // 0..10 bars for the UI. Every stat is non-decreasing in every upgrade level.
  const bar = (v, a, b) => Math.round(U.clamp(U.invLerp(a, b, v), 0, 1) * 100) / 10;
  function displayStats(vehicleId, upgrades) {
    const t = getTuned(vehicleId, upgrades);
    const r = t.wheels[0].radius;
    const totalMass = t.chassis.mass + t.wheels[0].mass + t.wheels[1].mass;
    const accel = t.motor.torque / (r * totalMass);
    const slippery = t.grip * U.lerp(0.62, 1, t.surfaceAdapt * 0.5); // effective μ on snow
    const travel = t.suspension.maxLen - t.suspension.minLen;
    const comHeight = -(t.wheels[0].mount.y - t.suspension.staticLen) + r;
    const wheelbase = t.wheels[1].mount.x - t.wheels[0].mount.x;
    const levels = t.levels;
    const stability = 0.55 * U.clamp(U.invLerp(1.6, 3.2, wheelbase / comHeight), 0, 1) +
      0.2 * U.clamp(U.invLerp(150, 550, t.chassis.mass), 0, 1) +
      0.1 * frac(levels.suspension) + 0.08 * frac(levels.grip) + 0.07 * frac(levels.brakes);
    return {
      speed: bar(t.topSpeed, 10, 44),
      accel: bar(accel, 3, 16),
      grip: bar(0.65 * t.grip + 0.35 * slippery, 0.5, 1.9),
      suspension: bar(0.5 * U.clamp(U.invLerp(0.2, 0.75, travel), 0, 1) + 0.5 * U.clamp(U.invLerp(0.2, 0.85, t.suspension.zeta), 0, 1), 0, 1),
      air: bar(t.airTorque / t.inertiaEff, 4, 24),
      fuel: bar(t.fuel.capacity / t.fuel.burnRate, 30, 150),
      stability: bar(stability, 0, 1)
    };
  }

  RR.Vehicles = Object.freeze({
    list: Object.freeze(list),
    byId,
    indexOf,
    UPGRADE_CATEGORIES,
    CAT_MULT,
    MAX_UPGRADE_LEVEL,
    upgradeCost,
    getTuned,
    describeUpgrade,
    displayStats,
    torqueCurve
  });
})();
