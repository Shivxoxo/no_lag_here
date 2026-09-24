/* RIDGE RUSH — vehicle physics (RR.VehicleBody).
 *
 * A small custom rigid-body solver specialised for "chassis + two sprung wheels on a heightfield":
 *
 *  Bodies   chassis: rigid body at its centre of mass (x, y, angle, vx, vy, av)
 *           wheels : point masses with spin (x, y, vx, vy, omega, spin); omega is CCW-positive, so
 *                    rolling forward (+x) means omega < 0.
 *  Joints   each wheel slides on the chassis-down axis through its mount (a "wheel joint"):
 *             · perpendicular constraint (rigid)             — keeps the wheel on its strut axis
 *             · spring-damper along the axis (implicit soft constraint, unconditionally stable)
 *             · hard stops at minLen / maxLen (unilateral, speculative)
 *             · motor + brake/rolling-resistance as angular constraints between wheel spin and
 *               chassis rotation, so every drive/brake torque has an equal and opposite reaction on
 *               the chassis (that is what makes wheelies, brake dives and throttle-in-air feel real)
 *  Contacts wheel circles, hull points and the driver's head circle vs the terrain polyline and the
 *           optional cave ceiling: normal (non-penetration, restitution, speculative margin) and
 *           Coulomb friction. Wheel friction couples linear velocity with wheel spin (v + ω×r).
 *  Solver   sequential impulses with warm starting (velocity level), then a non-linear Gauss-Seidel
 *           position pass that removes penetration / joint drift WITHOUT adding velocity (no energy
 *           gain from position correction).
 *  Safety   sub-stepping when anything would move more than ~0.3 wheel radii per step, deep
 *           penetration recovery, velocity / spin clamps, NaN guard with last-good-state restore.
 *
 * Terrain access: the local polyline is rebuilt from terrain.heightAt() sampled on the terrain grid
 * (terrain.DX / RR.Terrain.DX / RR.CONST.TERRAIN_DX). For the piecewise-linear heightfield this is
 * exact, and unlike a single closest point it gives up to two contacts per wheel in concave corners
 * (foot of a wall, V-shaped trenches) so wheels never jitter or sink there. terrain.closestPoint is
 * therefore not required; normalAt / surfaceAt / ceilingAt are used when present.
 *
 * Contract additions (all read-only for other modules unless stated):
 *   b.time          simulated seconds (lastImpact.time uses this clock)
 *   b.lastImpact    also has `count` (increments on every touchdown from the air)
 *   b.rpm           0..1 driven-wheel speed relative to motor maxOmega (engine audio)
 *   b.engineLoad    0..1 fraction of available motor torque used in the last step
 *   b.forwardSpeed()  m/s along the chassis +x axis;  b.isUpsideDown() → bool
 *   wheel.slip      m/s sliding speed at the contact patch (0 when airborne)
 *   b.nanRecoveries count of NaN-guard restores (diagnostics)
 *   controls.boost  accepted up to 1.5 (power-up + thruster may stack); 1 ⇒ 0.9 g thrust
 *   env.airDrag     optional linear drag (1/s), default 0.02
 *   b.placeOnTerrain(terrain, x, lift?)  optional extra lift in metres
 *   b.setPose(x, y, angle) / b.setVelocity(vx, vy)  teleport helpers (tests, tools, attract mode)
 *   Brake input: brakes while rolling forward; once nearly stopped it becomes reverse, and the
 *   brakes keep holding against forward rolling (so braking facing downhill holds the car).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const CONST = RR.CONST;
  const clamp = U.clamp;
  const isNum = U.isNum;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ solver tuning
  const VEL_ITERS = 10;              // velocity iterations per sub-step
  const POS_ITERS = 3;               // position (NGS) iterations per sub-step
  const LINEAR_SLOP = 0.004;         // allowed penetration before position correction (m)
  const CONTACT_BAUMGARTE = 0.3;     // fraction of penetration removed per position iteration
  const JOINT_BAUMGARTE = 0.5;       // fraction of joint drift removed per position iteration
  const MAX_CORRECTION = 0.12;       // max position correction per constraint per iteration (m)
  const RESTITUTION_THRESHOLD = 1.2; // m/s approach speed below which contacts don't bounce
  const WHEEL_RESTITUTION = 0.06;
  const BODY_RESTITUTION = 0.04;
  const HULL_FRICTION = 0.45;        // scraping chassis on the ground (× surface friction)
  const HEAD_FRICTION = 0.5;
  const TOUCH_TOL = 0.012;           // separation below which a contact counts as "touching" (m)
  const DEEP_HULL = 0.2;             // hull penetration that triggers whole-vehicle projection (m)
  const MAX_SUBSTEPS = 12;
  const SUBSTEP_DISP = 0.3;          // max displacement per sub-step, in wheel radii
  const QUICK_REJECT = 2.2;          // chassis points higher than this above the ground skip queries (m)
  const MAX_SEGMENTS = 16;           // terrain segments examined per query

  // ------------------------------------------------------------------ handling tuning
  const AIR_RAMP = 0.08;             // s: air control fades in after leaving the ground
  const LEAN_FADE_LO = 0.8;          // m/s: ground lean is zero below this speed (anti self-flip)
  const LEAN_FADE_HI = 4.0;          // m/s: ground lean reaches full strength here
  const THROTTLE_AIR_LEAN = 0.85;    // gas in the air → backflip torque, brake → frontflip
  const REVERSE_ENTER = 0.6;         // m/s: below this forward speed, brake input becomes reverse
  const REVERSE_EXIT = 1.6;          // m/s: hysteresis
  const BOOST_ACCEL = 0.9 * CONST.GRAVITY;
  const DEFAULT_AIR_DRAG = 0.02;
  const BEARING_TORQUE = 1.5;        // N·m of hub friction so free wheels eventually stop spinning
  const DAMP_BUMP = 0.75;            // damper multiplier while compressing …
  const DAMP_REBOUND = 1.5;          // … and while extending (rebound-heavy, like real dampers)

  const torqueCurve = (u) => (u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * u);
  const pos = (v, d) => (isNum(v) && v > 0 ? v : d);
  const num = (v, d) => (isNum(v) ? v : d);

  // ------------------------------------------------------------------ contact record
  function Contact() {
    this.active = false;
    this.wheel = null;                 // wheel for wheel contacts, null for chassis points
    this.lx = 0; this.ly = 0;          // chassis-local point (chassis contacts)
    this.cr = 0;                       // circle radius (wheel r, head r, 0 for hull points)
    this.nx = 0; this.ny = 1;          // contact normal (from surface into free space)
    this.qx = 0; this.qy = 0;          // point on the surface (contact plane)
    this.sep = 0;                      // signed separation at detection time
    this.rx = 0; this.ry = 0;          // lever arm COM → contact point (chassis contacts)
    this.rn = 0; this.rt = 0;          // cross(r, n), cross(r, t)
    this.mn = 0; this.mt = 0;          // effective masses (normal, tangent)
    this.ln = 0; this.lt = 0;          // accumulated impulses (warm started)
    this.mu = 1;
    this.target = 0;                   // min normal velocity (speculative allowance / bounce)
    this.vn0 = 0;                      // approach velocity before solving (impact speed)
    this.surface = null;
    this.ceiling = false;
    this.head = false;
  }

  // ------------------------------------------------------------------ tuned-params normalisation
  const DEFAULT_HULL = [
    { x: -1.4, y: -0.3 }, { x: 1.4, y: -0.3 }, { x: 1.4, y: 0.3 }, { x: 0, y: 0.7 }, { x: -1.4, y: 0.3 }
  ];

  function normalizeTuned(t) {
    t = t || {};
    const ch = t.chassis || {};
    const susp = t.suspension || {};
    const motor = t.motor || {};
    const g = CONST.GRAVITY;
    const P = {};
    P.mass = pos(ch.mass, 250);
    P.inertia = pos(ch.inertia, P.mass * 0.8);
    const hullSrc = Array.isArray(ch.hull) && ch.hull.length >= 3 ? ch.hull : DEFAULT_HULL;
    P.hull = hullSrc.map((p) => ({ x: num(p && p.x, 0), y: num(p && p.y, 0) }));
    const hd = ch.head || {};
    P.head = { x: num(hd.x, 0), y: num(hd.y, 0.9), r: pos(hd.r, 0.2) };

    const srcW = Array.isArray(t.wheels) && t.wheels.length >= 2 ? t.wheels : [
      { mount: { x: -1.1, y: -0.2 } }, { mount: { x: 1.2, y: -0.2 } }
    ];
    const xr = num(srcW[0].mount && srcW[0].mount.x, -1.1);
    const xf = num(srcW[1].mount && srcW[1].mount.x, 1.2);
    const wb = Math.max(0.3, xf - xr);
    const share = [clamp(xf / wb, 0.1, 0.9), clamp(-xr / wb, 0.1, 0.9)];
    P.minLen = pos(susp.minLen, 0.1);
    P.maxLen = Math.max(P.minLen + 0.05, pos(susp.maxLen, 0.45));
    P.wheels = [];
    for (let i = 0; i < 2; i++) {
      const w = srcW[i] || {};
      const r = clamp(pos(w.radius, 0.4), 0.1, 2);
      const m = pos(w.mass, 20);
      const k = pos(w.stiffness, pos(susp.stiffness, 15000));
      const c = pos(w.damping, pos(susp.damping, 1200));
      const rest = pos(w.rest, pos(susp.rest, (P.minLen + P.maxLen) / 2 + 0.1));
      const sLen = pos(w.staticLen, pos(susp.staticLen, rest - share[i] * P.mass * g / k));
      P.wheels.push({
        mx: num(w.mount && w.mount.x, i ? 1.2 : -1.1),
        my: num(w.mount && w.mount.y, -0.2),
        r, m, I: pos(w.inertia, 0.6 * m * r * r),
        drive: clamp(num(w.drive, 0.5), 0, 1),
        k, c, rest,
        staticLen: clamp(sLen, P.minLen, P.maxLen)
      });
    }
    P.torque = pos(motor.torque, 900);
    P.maxOmega = pos(motor.maxOmega, 50);
    P.reverseTorque = pos(motor.reverseTorque, P.torque * 0.6);
    P.reverseMaxOmega = pos(motor.reverseMaxOmega, 15);
    // Limited-slip coupling between the two driven wheels (0 = open diff, 1 = locked). Without it an
    // unloaded front wheel spins uselessly on steep climbs while the loaded rear stalls.
    const bothDriven = P.wheels[0].drive > 0 && P.wheels[1].drive > 0;
    P.lsdTorque = bothDriven ? clamp(num(t.diffLock, 0.5), 0, 1) * P.torque * 1.5 : 0;
    P.brakeTorque = pos(t.brakeTorque, 1500);
    P.handbrakeTorque = pos(t.handbrakeTorque, P.brakeTorque * 2.5);
    P.grip = pos(t.grip, 1);
    P.surfaceAdapt = clamp(num(t.surfaceAdapt, 0.2), 0, 1);
    P.rollingResistance = clamp(num(t.rollingResistance, 0.03), 0, 1);
    P.airTorque = Math.max(0, num(t.airTorque, P.inertia * 8));
    P.groundLeanTorque = Math.max(0, num(t.groundLeanTorque, P.airTorque * 0.4));
    P.angularDampingAir = clamp(num(t.angularDampingAir, 1), 0, 20);
    P.drag = clamp(num(t.drag, 0.0015), 0, 0.1);
    const maxSpeed = pos(t.maxSpeed, 30);
    P.vClamp = Math.min(maxSpeed * 1.3, CONST.MAX_SPEED);
    P.omegaCap = P.vClamp * 1.35 / Math.min(P.wheels[0].r, P.wheels[1].r) + 10;
    return P;
  }

  // ------------------------------------------------------------------ the body
  class VehicleBody {
    constructor(tuned, x, y) {
      const P = (this._P = normalizeTuned(tuned));
      this.tuned = tuned;

      // chassis state (public)
      this.x = num(x, 0);
      this.y = num(y, 0);
      this.angle = 0;
      this.vx = 0; this.vy = 0; this.av = 0;
      this.mass = P.mass; this.inertia = P.inertia;
      this._im = 1 / P.mass;
      this._iI = 1 / P.inertia;
      this._ca = 1; this._sa = 0;

      // wheels (public fields + underscore internals)
      this.wheels = [];
      for (let i = 0; i < 2; i++) {
        const wp = P.wheels[i];
        const w = {
          x: 0, y: 0, vx: 0, vy: 0, radius: wp.r, spin: 0, omega: 0,
          grounded: false, nx: 0, ny: 1, surface: (RR.SURFACES && RR.SURFACES.grass) || null,
          compression: 0, load: 0, slip: 0,
          _p: wp, _im: 1 / wp.m, _iI: 1 / wp.I, _len: wp.staticLen,
          _ux: 0, _uy: -1, _px: 1, _py: 0, _rwx: 0, _rwy: 0, _crp: 0, _cru: 0,
          _pMass: 0, _pAcc: 0, _sMass: 0, _sGamma: 0, _sBias: 0, _sAcc: 0,
          _lim: 0, _limPrev: 0, _lC: 0, _lMass: 0, _lAcc: 0,
          _mMass: 0, _mAcc: 0, _mLo: 0, _mHi: 0, _mTarget: 0, _mMax: 0,
          _bAcc: 0, _bMax: 0, _bFwd: 0, _bBack: 0,
          _gc: [new Contact(), new Contact()], _cc: new Contact()
        };
        for (const c of w._gc) c.wheel = w;
        w._cc.wheel = w; w._cc.ceiling = true;
        this.wheels.push(w);
      }

      // chassis contact points: hull vertices + midpoints of long edges, plus the head circle
      const pts = [];
      const hull = P.hull;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        pts.push(a);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const extra = Math.floor(len / 0.8);
        for (let k = 1; k <= extra; k++) {
          const t = k / (extra + 1);
          pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      this._hullPts = pts;
      this._hullC = [];
      this._hullCeil = [];
      for (const p of pts) {
        const c = new Contact(); c.lx = p.x; c.ly = p.y; this._hullC.push(c);
        const d = new Contact(); d.lx = p.x; d.ly = p.y; d.ceiling = true; this._hullCeil.push(d);
      }
      this._headC = new Contact();
      this._headC.lx = P.head.x; this._headC.ly = P.head.y; this._headC.cr = P.head.r; this._headC.head = true;
      this._headCeil = new Contact();
      this._headCeil.lx = P.head.x; this._headCeil.ly = P.head.y; this._headCeil.cr = P.head.r;
      this._headCeil.head = true; this._headCeil.ceiling = true;

      // bounding radius of the chassis (for sub-step sizing)
      let br = Math.hypot(P.head.x, P.head.y) + P.head.r;
      for (const p of pts) br = Math.max(br, Math.hypot(p.x, p.y));
      this._radius = br;
      this._rMin = Math.min(P.wheels[0].r, P.wheels[1].r);

      // active contact list (reused)
      this._act = [];
      this._nAct = 0;

      // gameplay-facing state
      this.grounded = false;
      this.bothGrounded = false;
      this.bodyContact = false;
      this.headHit = false;
      this.hazard = null;
      this.airTime = 0;
      this.lastImpact = { speed: 0, time: 0, count: 0 };
      this.time = 0;
      this.rpm = 0;
      this.engineLoad = 0;
      this.nanRecoveries = 0;

      // internals
      this._terrain = null;
      this._dx = CONST.TERRAIN_DX;
      this._reverse = false;
      this._touching = false;
      this._hPrev = 0;
      this._margin = 0.05;
      this._landWindow = 0;
      this._lsdMass = 0; this._lsdMax = 0; this._lsdAcc = 0;
      this._ctl = { throttle: 0, lean: 0, handbrake: false, boost: 0, engineOn: true };
      this._env = { terrain: null, g: CONST.GRAVITY, wind: 0, frictionMul: 1, airDrag: DEFAULT_AIR_DRAG, sensitivity: 1 };
      this._snap = new Float64Array(6 + 2 * 6);
      this._q = [{ x: 0, y: 0, nx: 0, ny: 1, d: 0 }, { x: 0, y: 0, nx: 0, ny: 1, d: 0 }];
      this._cand = new Float64Array(MAX_SEGMENTS * 6);
      this._n = { x: 0, y: 1 };
      this._tmp = { x: 0, y: 0 };

      this._resetWheelsToStatic();
      this._snapshot();
    }

    // ================================================================ public helpers
    worldPoint(lx, ly, out) {
      out = out || { x: 0, y: 0 };
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      out.x = this.x + lx * c - ly * s;
      out.y = this.y + lx * s + ly * c;
      return out;
    }

    getHead(out) {
      const h = this._P.head;
      out = this.worldPoint(h.x, h.y, out || { x: 0, y: 0, r: 0 });
      out.r = h.r;
      return out;
    }

    getMount(i, out) {
      const w = this.wheels[i] || this.wheels[0];
      return this.worldPoint(w._p.mx, w._p.my, out);
    }

    // World impulse (N·s) at a world point, applied to the chassis.
    applyImpulse(ix, iy, px, py) {
      if (!isNum(ix) || !isNum(iy)) return;
      if (!isNum(px) || !isNum(py)) { px = this.x; py = this.y; }
      this.vx += ix * this._im;
      this.vy += iy * this._im;
      this.av += ((px - this.x) * iy - (py - this.y) * ix) * this._iI;
      this._clampVelocities();
    }

    speedKmh() {
      const s = Math.hypot(this.vx, this.vy) * 3.6;
      return isNum(s) ? s : 0;
    }

    forwardSpeed() {
      return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
    }

    isUpsideDown() {
      return Math.cos(this.angle) < -0.2;
    }

    // Pose the vehicle resting on the terrain at x: angle follows the local slope, wheels at their
    // static suspension length touching the ground, zero velocity.
    placeOnTerrain(terrain, x, lift) {
      const P = this._P;
      x = num(x, this.x);
      lift = num(lift, 0);
      this._terrain = terrain || this._terrain;
      const T = this._terrain;
      this._setTerrainDx(T);
      let a = 0, y = this.y;
      if (T && typeof T.heightAt === 'function') {
        const w0 = P.wheels[0], w1 = P.wheels[1];
        for (let it = 0; it < 3; it++) {
          const c = Math.cos(a), s = Math.sin(a);
          const xr = x + w0.mx * c - (w0.my - w0.staticLen) * s;
          const xf = x + w1.mx * c - (w1.my - w1.staticLen) * s;
          const hr = num(T.heightAt(xr), 0), hf = num(T.heightAt(xf), 0);
          a = clamp(Math.atan2(hf - hr, Math.max(0.1, xf - xr)), -1.25, 1.25);
        }
        const c = Math.cos(a), s = Math.sin(a);
        let yReq = -Infinity;
        for (const wp of P.wheels) {
          const lx = wp.mx, ly = wp.my - wp.staticLen;
          const ox = lx * c - ly * s, oy = lx * s + ly * c;
          yReq = Math.max(yReq, this._circleRestHeight(T, x + ox, wp.r) - oy);
        }
        const hullPts = this._hullPts;
        for (let i = 0; i < hullPts.length; i++) {
          const p = hullPts[i];
          const ox = p.x * c - p.y * s, oy = p.x * s + p.y * c;
          yReq = Math.max(yReq, num(T.heightAt(x + ox), -Infinity) + 0.03 - oy);
        }
        const hd = P.head;
        const hx = hd.x * c - hd.y * s, hy = hd.x * s + hd.y * c;
        yReq = Math.max(yReq, this._circleRestHeight(T, x + hx, hd.r) + 0.02 - hy);
        if (isNum(yReq)) y = yReq + lift + 0.002;
      }
      this.x = x; this.y = y; this.angle = a;
      this.vx = 0; this.vy = 0; this.av = 0;
      this._resetWheelsToStatic();
      this._resetSolverState();
      this.headHit = false;
      this.hazard = null;
      this.airTime = 0;
      this.grounded = false; this.bothGrounded = false; this.bodyContact = false;
      this._touching = true; // resting pose: no air-control ramp on the first step
      this._reverse = false;
      this._snapshot();
      return this;
    }

    // Teleport the chassis to a pose (wheels re-seated at static suspension length), zero velocity.
    // Used by tests, tools and attract-mode resets; does not touch the terrain.
    setPose(x, y, angle) {
      this.x = num(x, this.x);
      this.y = num(y, this.y);
      this.angle = num(angle, 0);
      this.vx = 0; this.vy = 0; this.av = 0;
      this._resetWheelsToStatic();
      this._resetSolverState();
      this.headHit = false;
      this.hazard = null;
      this.airTime = 0;
      this._touching = false;
      this._reverse = false;
      this._snapshot();
      return this;
    }

    // Set a velocity for the whole vehicle (chassis + wheels, wheels rolling to match).
    setVelocity(vx, vy) {
      this.vx = num(vx, 0); this.vy = num(vy, 0); this.av = 0;
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const vf = this.vx * ca + this.vy * sa;
      for (const w of this.wheels) { w.vx = this.vx; w.vy = this.vy; w.omega = -vf / w.radius; }
      this._clampVelocities();
      return this;
    }

    // Shield save: upright on the local slope, lifted clear of the ground (and below any ceiling),
    // keeping ~60 % of the forward speed. Moves forward/back off hazard surfaces if needed.
    rescue(terrain) {
      const T = terrain || this._terrain;
      const P = this._P;
      let keepSlopeX = 1, keepSlopeY = 0;
      if (T && typeof T.heightAt === 'function') {
        const s = this._slopeAt(T, this.x);
        const inv = 1 / Math.sqrt(1 + s * s);
        keepSlopeX = inv; keepSlopeY = s * inv;
      }
      const keep = 0.6 * Math.max(0, num(this.vx * keepSlopeX + this.vy * keepSlopeY, 0));
      const prevAngle = num(this.angle, 0);
      let x = this.x;
      if (T && typeof T.surfaceAt === 'function') x = this._findSafeX(T, x);
      this.placeOnTerrain(T, x, 0.35);
      // keep b.angle continuous: same pose, but on the revolution the car was already on
      const turns = Math.round((prevAngle - this.angle) / TAU);
      if (turns !== 0 && Math.abs(turns) < 1e6) this.angle += turns * TAU;
      // Stay clear of a cave ceiling.
      if (T && typeof T.ceilingAt === 'function') {
        const c = T.ceilingAt(this.x);
        if (isNum(c)) {
          const hd = this.getHead(this._tmp);
          let top = hd.y + hd.r;
          for (const p of this._hullPts) top = Math.max(top, this.worldPoint(p.x, p.y, this._tmp).y);
          const over = top - (c - 0.15);
          if (over > 0) {
            const dy = Math.min(over, 0.34);
            this.y -= dy;
            for (const w of this.wheels) w.y -= dy;
          }
        }
      }
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      this.vx = keep * ca; this.vy = keep * sa; this.av = 0;
      for (const w of this.wheels) {
        w.vx = this.vx; w.vy = this.vy; w.omega = -keep / w.radius;
      }
      this.headHit = false;
      this.hazard = null;
      this.airTime = 0;
      this._snapshot();
      return this;
    }

    // ================================================================ stepping
    step(dt, controls, env) {
      dt = isNum(dt) ? clamp(dt, 0, CONST.MAX_FRAME_DT) : 0;
      if (dt <= 0) return;
      const ctl = this._readControls(controls);
      const E = this._readEnv(env);
      // Remember the last good state (the current one, unless something outside poisoned it).
      if (this._stateFinite()) this._snapshot();
      let ok = true;
      try {
        const n = this._substepCount(dt);
        const h = dt / n;
        for (let i = 0; i < n; i++) this._substep(h, ctl, E);
      } catch (err) {
        ok = false;
      }
      if (!ok || !this._stateFinite()) {
        this._restore();
        this.nanRecoveries++;
      }
    }

    _readControls(c) {
      const o = this._ctl;
      c = c || {};
      o.throttle = isNum(c.throttle) ? clamp(c.throttle, -1, 1) : 0;
      o.lean = isNum(c.lean) ? clamp(c.lean, -1, 1) : 0;
      o.handbrake = !!c.handbrake;
      o.boost = isNum(c.boost) ? clamp(c.boost, 0, 1.5) : 0;
      o.engineOn = c.engineOn !== false;
      return o;
    }

    _readEnv(e) {
      const o = this._env;
      e = e || {};
      const T = e.terrain && typeof e.terrain.heightAt === 'function' ? e.terrain : null;
      if (T !== o.terrain) this._setTerrainDx(T);
      o.terrain = T;
      if (T) this._terrain = T;
      o.g = isNum(e.gravity) ? clamp(e.gravity, 0, 50) : CONST.GRAVITY;
      o.wind = isNum(e.wind) ? clamp(e.wind, -40, 40) : 0;
      o.frictionMul = isNum(e.frictionMul) ? clamp(e.frictionMul, 0.02, 4) : 1;
      o.airDrag = isNum(e.airDrag) ? clamp(e.airDrag, 0, 2) : DEFAULT_AIR_DRAG;
      o.sensitivity = isNum(e.sensitivity) ? clamp(e.sensitivity, 0.2, 2) : 1;
      return o;
    }

    _setTerrainDx(T) {
      let dx = 0;
      if (T) dx = num(T.DX, 0) || (T.constructor && num(T.constructor.DX, 0)) || 0;
      if (!(dx > 0) && RR.Terrain) dx = num(RR.Terrain.DX, 0);
      this._dx = dx > 0.05 && dx < 5 ? dx : CONST.TERRAIN_DX;
    }

    _substepCount(dt) {
      let v = Math.hypot(this.vx, this.vy) + Math.abs(this.av) * this._radius;
      for (const w of this.wheels) v = Math.max(v, Math.hypot(w.vx, w.vy));
      const byDt = Math.ceil(dt / CONST.PHYS_DT - 1e-6);
      const byDisp = Math.ceil((v * dt) / (SUBSTEP_DISP * this._rMin));
      return clamp(Math.max(byDt, byDisp, 1) | 0, 1, MAX_SUBSTEPS);
    }

    _substep(h, ctl, E) {
      this._updateRot();
      const T = E.terrain;
      // Speculative margin: anything that could be reached this sub-step is a contact candidate.
      let v = Math.hypot(this.vx, this.vy) + Math.abs(this.av) * this._radius;
      for (const w of this.wheels) v = Math.max(v, Math.hypot(w.vx, w.vy));
      this._margin = Math.min(0.6, v * h * 1.2 + 0.02);

      if (T) this._recoverDeep(T);
      this._detect(T);
      this._applyForces(h, ctl, E);
      this._prepare(h, ctl, E);
      for (let i = 0; i < VEL_ITERS; i++) this._solveVelocities(h);
      this._clampVelocities();
      this._integrate(h);
      for (let i = 0; i < POS_ITERS; i++) this._solvePositions();
      this._post(h);
      this._hPrev = h;
    }

    _updateRot() {
      this._ca = Math.cos(this.angle);
      this._sa = Math.sin(this.angle);
    }

    // ================================================================ terrain queries
    _slopeAt(T, x) {
      if (typeof T.slopeAt === 'function') {
        const s = T.slopeAt(x);
        if (isNum(s)) return clamp(s, -50, 50);
      }
      const e = this._dx * 0.5;
      const s = (num(T.heightAt(x + e), 0) - num(T.heightAt(x - e), 0)) / (2 * e);
      return isNum(s) ? clamp(s, -50, 50) : 0;
    }

    _normalAt(T, x) {
      const n = this._n;
      if (typeof T.normalAt === 'function') {
        const r = T.normalAt(x, n);
        const o = r && typeof r === 'object' ? r : n;
        if (isNum(o.x) && isNum(o.y) && o.y > 1e-3) {
          const l = Math.hypot(o.x, o.y);
          n.x = o.x / l; n.y = o.y / l;
          return n;
        }
      }
      const s = this._slopeAt(T, x);
      const l = Math.sqrt(1 + s * s);
      n.x = -s / l; n.y = 1 / l;
      return n;
    }

    _surfaceAt(T, x) {
      const S = RR.SURFACES || {};
      if (typeof T.surfaceAt === 'function') {
        const s = T.surfaceAt(x);
        if (s && typeof s === 'object') return s;
        if (typeof s === 'string' && S[s]) return S[s];
      }
      return S.grass || { type: 'grass', friction: 1, hazard: null, bounce: 0 };
    }

    // Lowest centre height at which a circle of radius r centred at x clears the polyline.
    _circleRestHeight(T, x, r) {
      const dx = this._dx;
      const i0 = Math.floor((x - r) / dx) - 1, i1 = Math.floor((x + r) / dx) + 1;
      let best = -Infinity;
      let xa = i0 * dx, ya = num(T.heightAt(xa), -Infinity);
      for (let i = i0; i <= i1; i++) {
        const xb = xa + dx, yb = num(T.heightAt(xb), -Infinity);
        // vertex a
        const ddx = xa - x;
        if (Math.abs(ddx) <= r) best = Math.max(best, ya + Math.sqrt(r * r - ddx * ddx));
        // segment interior: the circle rests tangent to the line if the foot of the normal lies
        // inside the segment
        const s = (yb - ya) / dx;
        const k = Math.sqrt(1 + s * s);
        const footX = x + r * s / k;
        if (footX >= xa && footX <= xb) best = Math.max(best, ya + s * (x - xa) + r * k);
        xa = xb; ya = yb;
      }
      return best;
    }

    // Closest points on the terrain polyline to p within `reach`. Fills this._q[0] (closest) and,
    // when `want2`, this._q[1] with a second contact on a differently-oriented segment (concave
    // corners). Returns the number of results. `inside` = p is below the surface; normals always
    // point from the surface into free space.
    _queryGround(T, px, py, reach, inside, want2) {
      const dx = this._dx;
      let i0 = Math.floor((px - reach) / dx);
      let i1 = Math.floor((px + reach) / dx);
      if (i1 - i0 >= MAX_SEGMENTS) { i0 = Math.floor(px / dx) - (MAX_SEGMENTS >> 1); i1 = i0 + MAX_SEGMENTS - 1; }
      const cand = this._cand;
      let m = 0, best = -1, bestD = Infinity;
      let xa = i0 * dx;
      let ya = T.heightAt(xa);
      if (!isNum(ya)) return 0;
      for (let i = i0; i <= i1; i++) {
        const xb = xa + dx;
        const yb = T.heightAt(xb);
        if (!isNum(yb)) return 0;
        // closest point on segment a→b
        const ex = xb - xa, ey = yb - ya;
        const ll = ex * ex + ey * ey;
        let t = ll > 1e-12 ? ((px - xa) * ex + (py - ya) * ey) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = xa + ex * t, cy = ya + ey * t;
        const ddx = px - cx, ddy = py - cy;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        let nx, ny;
        if (d > 1e-6) {
          nx = ddx / d; ny = ddy / d;
          if (inside) { nx = -nx; ny = -ny; }   // p below the surface: normal points back out
        } else {
          const l = Math.sqrt(ll) || 1;
          nx = -ey / l; ny = ex / l;
        }
        const o = m * 6;
        cand[o] = cx; cand[o + 1] = cy; cand[o + 2] = nx; cand[o + 3] = ny; cand[o + 4] = d;
        cand[o + 5] = t > 1e-4 && t < 1 - 1e-4 ? 1 : 0; // interior of the segment (not a vertex)
        if (d < bestD) { bestD = d; best = m; }
        m++;
        xa = xb; ya = yb;
      }
      if (best < 0 || (!inside && bestD > reach)) return 0;
      const q0 = this._q[0];
      let o = best * 6;
      q0.x = cand[o]; q0.y = cand[o + 1]; q0.nx = cand[o + 2]; q0.ny = cand[o + 3]; q0.d = cand[o + 4];
      if (!want2 || inside) return 1;
      // Second contact (concave corners only): nearest candidate lying in the INTERIOR of a
      // differently oriented segment. Vertex hits of neighbouring segments on a straight or convex
      // stretch are the same surface seen through a shared vertex and must not become contacts.
      let second = -1, secD = reach;
      for (let k = 0; k < m; k++) {
        if (k === best) continue;
        o = k * 6;
        if (cand[o + 5] && cand[o + 4] < secD && cand[o + 2] * q0.nx + cand[o + 3] * q0.ny < 0.94) {
          secD = cand[o + 4]; second = k;
        }
      }
      if (second < 0) return 1;
      const q1 = this._q[1];
      o = second * 6;
      q1.x = cand[o]; q1.y = cand[o + 1]; q1.nx = cand[o + 2]; q1.ny = cand[o + 3]; q1.d = cand[o + 4];
      return 2;
    }

    // Fill a ground contact from a query result.
    _setGroundContact(c, q, inside, radius, T) {
      const wasActive = c.active;
      const dot = c.nx * q.nx + c.ny * q.ny;
      c.nx = q.nx; c.ny = q.ny; c.qx = q.x; c.qy = q.y;
      c.sep = (inside ? -q.d : q.d) - radius;
      c.active = true;
      c.surface = this._surfaceAt(T, q.x);
      if (!wasActive || dot < 0.9) { c.ln = 0; c.lt = 0; }
    }

    _deactivate(c) {
      c.active = false; c.ln = 0; c.lt = 0;
    }

    // Ceiling contact (cave sections). Returns true when active.
    _ceilingContact(T, c, px, py, radius) {
      if (typeof T.ceilingAt !== 'function') { if (c.active) this._deactivate(c); return false; }
      const cy = T.ceilingAt(px);
      if (!isNum(cy) || py + radius + this._margin + 0.5 < cy - 0.5) {
        if (c.active) this._deactivate(c);
        return false;
      }
      const e = 0.25;
      let c1 = T.ceilingAt(px + e), c2 = T.ceilingAt(px - e);
      if (!isNum(c1)) c1 = cy;
      if (!isNum(c2)) c2 = cy;
      const s = clamp((c1 - c2) / (2 * e), -20, 20);
      const l = Math.sqrt(1 + s * s);
      const nx = s / l, ny = -1 / l;
      const sep = (py - cy) * ny - radius;
      if (sep > this._margin) { if (c.active) this._deactivate(c); return false; }
      const wasActive = c.active;
      c.nx = nx; c.ny = ny; c.qx = px; c.qy = cy; c.sep = sep; c.active = true;
      c.surface = (RR.SURFACES && RR.SURFACES.rock) || this._surfaceAt(T, px);
      if (!wasActive) { c.ln = 0; c.lt = 0; }
      return true;
    }

    // Anything deep inside the terrain is projected straight out (tunnelling safety net).
    _recoverDeep(T) {
      for (const w of this.wheels) {
        const h = T.heightAt(w.x);
        if (isNum(h) && w.y < h) {
          const n = this._normalAt(T, w.x);
          w.y = h + w.radius / Math.max(0.2, n.y);
          const vn = w.vx * n.x + w.vy * n.y;
          if (vn < 0) { w.vx -= n.x * vn; w.vy -= n.y * vn; }
        }
        if (typeof T.ceilingAt === 'function') {
          const c = T.ceilingAt(w.x);
          if (isNum(c) && w.y > c && isNum(h) && c - h > 2 * w.radius) {
            w.y = c - w.radius;
            if (w.vy > 0) w.vy = 0;
          }
        }
      }
      // Hull: if the deepest point is far below the surface, lift the whole vehicle out.
      const ca = this._ca, sa = this._sa;
      let deepest = 0, dnx = 0, dny = 1;
      const pts = this._hullPts;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const wx = this.x + p.x * ca - p.y * sa, wy = this.y + p.x * sa + p.y * ca;
        const h = T.heightAt(wx);
        if (!isNum(h) || wy >= h - DEEP_HULL) continue;
        const n = this._normalAt(T, wx);
        const depth = (h - wy) * n.y;
        if (depth > deepest) { deepest = depth; dnx = n.x; dny = n.y; }
      }
      const cy = this.y, cx = this.x;
      const hc = T.heightAt(cx);
      if (isNum(hc) && cy < hc && hc - cy > deepest) { deepest = hc - cy + 0.3; dnx = 0; dny = 1; }
      if (deepest > DEEP_HULL) {
        const d = deepest - LINEAR_SLOP;
        this.x += dnx * d; this.y += dny * d;
        const vn = this.vx * dnx + this.vy * dny;
        if (vn < 0) { this.vx -= dnx * vn; this.vy -= dny * vn; }
        for (const w of this.wheels) {
          w.x += dnx * d; w.y += dny * d;
          const wn = w.vx * dnx + w.vy * dny;
          if (wn < 0) { w.vx -= dnx * wn; w.vy -= dny * wn; }
        }
      }
    }

    _detect(T) {
      const act = this._act;
      let n = 0;
      if (!T) {
        for (const w of this.wheels) { this._deactivate(w._gc[0]); this._deactivate(w._gc[1]); this._deactivate(w._cc); }
        for (const c of this._hullC) this._deactivate(c);
        for (const c of this._hullCeil) this._deactivate(c);
        this._deactivate(this._headC); this._deactivate(this._headCeil);
        this._nAct = 0;
        return;
      }
      const margin = this._margin;
      // ---- wheels (up to two ground contacts + one ceiling contact each)
      for (const w of this.wheels) {
        const r = w.radius;
        const h = T.heightAt(w.x);
        const inside = isNum(h) && w.y < h;
        const cnt = isNum(h) ? this._queryGround(T, w.x, w.y, r + margin, inside, true) : 0;
        if (cnt >= 1) { this._setGroundContact(w._gc[0], this._q[0], inside, r, T); act[n++] = w._gc[0]; }
        else this._deactivate(w._gc[0]);
        if (cnt >= 2) { this._setGroundContact(w._gc[1], this._q[1], false, r, T); act[n++] = w._gc[1]; }
        else this._deactivate(w._gc[1]);
        if (this._ceilingContact(T, w._cc, w.x, w.y, r)) act[n++] = w._cc;
      }
      // ---- hull points
      const ca = this._ca, sa = this._sa;
      const hullC = this._hullC, hullCeil = this._hullCeil;
      for (let i = 0; i < hullC.length; i++) {
        const c = hullC[i];
        const wx = this.x + c.lx * ca - c.ly * sa, wy = this.y + c.lx * sa + c.ly * ca;
        if (this._detectPoint(T, c, wx, wy, 0, margin)) act[n++] = c;
        if (this._ceilingContact(T, hullCeil[i], wx, wy, 0)) act[n++] = hullCeil[i];
      }
      // ---- head
      const hd = this._headC;
      const hx = this.x + hd.lx * ca - hd.ly * sa, hy = this.y + hd.lx * sa + hd.ly * ca;
      if (this._detectPoint(T, hd, hx, hy, hd.cr, margin)) act[n++] = hd;
      if (this._ceilingContact(T, this._headCeil, hx, hy, hd.cr)) act[n++] = this._headCeil;
      this._nAct = n;
    }

    _detectPoint(T, c, px, py, radius, margin) {
      const h = T.heightAt(px);
      if (!isNum(h) || py - h > QUICK_REJECT + radius + margin * 10) { if (c.active) this._deactivate(c); return false; }
      const inside = py < h;
      const cnt = this._queryGround(T, px, py, radius + margin, inside, false);
      if (!cnt) { if (c.active) this._deactivate(c); return false; }
      this._setGroundContact(c, this._q[0], inside, radius, T);
      return true;
    }

    // ================================================================ forces & constraint setup
    _applyForces(h, ctl, E) {
      const P = this._P;
      // Shared accelerations (applied to every body so they create no internal stress).
      const sp = Math.hypot(this.vx, this.vy);
      const damp = 1 / (1 + (E.airDrag + P.drag * sp) * h);   // implicit linear + quadratic drag
      const b = ctl.boost > 0 ? BOOST_ACCEL * ctl.boost : 0;
      const ax = E.wind + b * this._ca;
      const ay = -E.g + b * this._sa;
      this.vx = (this.vx + ax * h) * damp;
      this.vy = (this.vy + ay * h) * damp;
      for (const w of this.wheels) {
        w.vx = (w.vx + ax * h) * damp;
        w.vy = (w.vy + ay * h) * damp;
      }

      // Rotation control. Air: explicit lean plus throttle (gas → backflip, brake → frontflip),
      // ramped in so a one-frame hop gives nothing. Ground: gentler lean that fades out at low
      // speed so a parked car cannot rock itself over.
      const airborne = !this._touching;
      let torque = 0;
      if (airborne) {
        const airF = clamp(this.airTime / AIR_RAMP, 0, 1);
        const lean = clamp(ctl.lean + (ctl.engineOn ? ctl.throttle * THROTTLE_AIR_LEAN : 0), -1, 1);
        torque = P.airTorque * lean * E.sensitivity * airF;
        // Air angular damping, expressed as a torque on the whole assembly's inertia.
        const ieffRatio = this._ieffRatio || 1;
        const k = Math.min(1, P.angularDampingAir * h * ieffRatio);
        this.av -= this.av * k;
      } else if (this.grounded && ctl.lean !== 0) {
        // Fades out when parked (a stationary car must not rock itself over), but stays available
        // under throttle so the driver can hold down a launch wheelie.
        const drive = ctl.engineOn ? Math.abs(ctl.throttle) * 0.7 : 0;
        const fade = Math.max(U.smoothstep(LEAN_FADE_LO, LEAN_FADE_HI, Math.abs(this._vf())), drive);
        torque = P.groundLeanTorque * ctl.lean * E.sensitivity * fade;
      } else if (this.bodyContact && ctl.lean !== 0) {
        // Only the chassis touches (tail-stand after a big wheelie, lying on its side): let the
        // driver rock it back onto the wheels. Head contact is already a crash, so this cannot be
        // used to right an upside-down car.
        torque = P.groundLeanTorque * 0.6 * ctl.lean * E.sensitivity;
      }
      this.av += torque * this._iI * h;
    }

    _vf() {
      return this.vx * this._ca + this.vy * this._sa;
    }

    _prepare(h, ctl, E) {
      const P = this._P;
      const im = this._im, iI = this._iI;
      const ca = this._ca, sa = this._sa;
      const ux = sa, uy = -ca;      // chassis "down" (strut axis)
      const px = ca, py = sa;       // chassis +x
      const ratio = this._hPrev > 0 ? h / this._hPrev : 0;

      // ---- approach velocities of all contacts, sampled BEFORE any warm starting (impact speeds)
      {
        const act = this._act;
        for (let i = 0; i < this._nAct; i++) {
          const c = act[i];
          if (c.wheel) c.vn0 = c.wheel.vx * c.nx + c.wheel.vy * c.ny;
          else {
            const rx = this.x + c.lx * ca - c.ly * sa - c.nx * c.cr - this.x;
            const ry = this.y + c.lx * sa + c.ly * ca - c.ny * c.cr - this.y;
            c.vn0 = (this.vx - this.av * ry) * c.nx + (this.vy + this.av * rx) * c.ny;
          }
        }
      }

      // ---- throttle / brake / reverse logic
      const vf = this.vx * ca + this.vy * sa;
      const thr = ctl.throttle;
      if (thr < -0.02) {
        if (vf < REVERSE_ENTER) this._reverse = true;
        else if (vf > REVERSE_EXIT) this._reverse = false;
      } else {
        this._reverse = false;
      }

      let ieff = P.inertia;
      let motorUsedMax = 0;
      for (const w of this.wheels) {
        const wp = w._p;
        // strut geometry
        const mx = this.x + wp.mx * ca - wp.my * sa;
        const my = this.y + wp.mx * sa + wp.my * ca;
        const dxw = w.x - mx, dyw = w.y - my;
        const len = dxw * ux + dyw * uy;
        w._len = len;
        w._ux = ux; w._uy = uy; w._px = px; w._py = py;
        const rwx = w.x - this.x, rwy = w.y - this.y;
        w._rwx = rwx; w._rwy = rwy;
        ieff += wp.m * (rwx * rwx + rwy * rwy);
        const crp = rwx * py - rwy * px;
        const cru = rwx * uy - rwy * ux;
        w._crp = crp; w._cru = cru;
        w._pMass = 1 / (w._im + im + iI * crp * crp);
        const effU = w._im + im + iI * cru * cru;
        // Relative axial velocity (>0: extending, <0: compressing).
        const cdotU = ux * (w.vx - this.vx + this.av * rwy) + uy * (w.vy - this.vy - this.av * rwx);
        // Implicit spring-damper as a soft constraint (Box2D-style): stable for any k, c, h.
        // Like a real damper it is softer in bump than in rebound, so landings squash and soak up
        // the hit instead of pogoing the car back into the air.
        const c = wp.c * (cdotU < 0 ? DAMP_BUMP : DAMP_REBOUND);
        let gamma = h * (c + h * wp.k);
        gamma = gamma > 0 ? 1 / gamma : 0;
        w._sGamma = gamma;
        w._sBias = (len - wp.rest) * h * wp.k * gamma;
        w._sMass = 1 / (effU + gamma);
        w._lMass = 1 / effU;
        // Hard stops (speculative: activate if the stop could be reached this step).
        const predicted = len + cdotU * h;
        w._limPrev = w._lim;
        if (predicted < P.minLen + 0.01) { w._lim = 1; w._lC = len - P.minLen; }
        else if (predicted > P.maxLen - 0.01) { w._lim = -1; w._lC = P.maxLen - len; }
        else w._lim = 0;
        if (w._lim !== w._limPrev) w._lAcc = 0;

        // ---- motor / brake (angular constraints between wheel spin and chassis rotation)
        w._mMass = 1 / (w._iI + iI);
        w._mAcc = 0; w._mLo = 0; w._mHi = 0; w._mTarget = 0; w._mMax = 0;
        w._bAcc = 0;
        let brake = BEARING_TORQUE + P.rollingResistance * w.load * w.radius;
        let holdFwd = 0;  // one-sided brake resisting FORWARD rolling (while reversing)
        let holdBack = 0; // one-sided brake resisting BACKWARD rolling (gas while rolling back)
        const rel = w.omega - this.av;
        if (thr > 0.02) {
          if (ctl.engineOn && wp.drive > 0) {
            const u = -rel / P.maxOmega;
            const tq = P.torque * torqueCurve(u) * thr * wp.drive;
            w._mTarget = -P.maxOmega; w._mLo = -tq * h; w._mHi = 0;
            w._mMax = P.torque * thr * wp.drive * h;
          }
          // Rolling backwards (e.g. slid back down a hill) and pressing gas: brakes help stop it.
          if (vf < -REVERSE_ENTER) holdBack = P.brakeTorque * 0.5 * thr;
        } else if (thr < -0.02) {
          if (this._reverse) {
            // Reverse motor, while the brakes keep holding against rolling forward — so holding
            // "brake" facing downhill stops the car and never lets it creep down the slope.
            holdFwd = P.brakeTorque * 0.5 * -thr;
            if (ctl.engineOn && wp.drive > 0) {
              const u = rel / P.reverseMaxOmega;
              const tq = P.reverseTorque * torqueCurve(u) * -thr * wp.drive;
              w._mTarget = P.reverseMaxOmega; w._mLo = 0; w._mHi = tq * h;
              w._mMax = P.reverseTorque * -thr * wp.drive * h;
            }
          } else {
            brake += P.brakeTorque * 0.5 * -thr;
          }
        }
        if (ctl.handbrake) brake += P.handbrakeTorque * 0.5;
        w._bMax = brake * h;
        w._bFwd = holdFwd * h;
        w._bBack = holdBack * h;
        motorUsedMax += w._mMax;

        // warm start joint impulses
        if (ratio > 0) {
          w._pAcc *= ratio; w._sAcc *= ratio; w._lAcc = w._lim ? w._lAcc * ratio : 0;
          const imp = w._sAcc + (w._lim ? w._lim * w._lAcc : 0);
          this._applyStrut(w, px, py, crp, w._pAcc);
          this._applyStrut(w, ux, uy, cru, imp);
        } else {
          w._pAcc = 0; w._sAcc = 0; w._lAcc = 0;
        }
      }
      this._ieffRatio = ieff / P.inertia;
      this._motorUsedMax = motorUsedMax;

      // ---- limited-slip coupling of the two wheels' surface speeds (internal: no chassis reaction)
      if (P.lsdTorque > 0) {
        const w0 = this.wheels[0], w1 = this.wheels[1];
        const r0 = w0.radius, r1 = w1.radius;
        this._lsdMass = 1 / (r0 * r0 * w0._iI + r1 * r1 * w1._iI);
        this._lsdMax = (P.lsdTorque / (0.5 * (r0 + r1))) * h;
        this._lsdAcc = 0;
      } else {
        this._lsdMax = 0;
      }

      // ---- contacts
      const act = this._act;
      const n = this._nAct;
      const fm = E.frictionMul;
      const wheelMuBase = P.grip * fm;
      for (let i = 0; i < n; i++) {
        const c = act[i];
        const nx = c.nx, ny = c.ny, tx = ny, ty = -nx;
        const surf = c.surface;
        const sf = surf && isNum(surf.friction) ? surf.friction : 1;
        const sb = surf && isNum(surf.bounce) ? surf.bounce : 0;
        if (c.wheel) {
          const w = c.wheel;
          c.mn = 1 / w._im;
          c.mt = 1 / (w._im + w.radius * w.radius * w._iI);
          c.mu = c.ceiling ? 0.6 * sf * fm : wheelMuBase * U.lerp(sf, 1, P.surfaceAdapt * 0.5);
          if (ratio > 0 && (c.ln !== 0 || c.lt !== 0)) {
            c.ln *= ratio; c.lt *= ratio;
            const ix = nx * c.ln + tx * c.lt, iy = ny * c.ln + ty * c.lt;
            w.vx += ix * w._im; w.vy += iy * w._im;
            w.omega += w.radius * c.lt * w._iI;
          }
          c.target = this._contactTarget(c, h, WHEEL_RESTITUTION + sb);
        } else {
          // chassis point; for the head circle the contact point sits on the circle surface
          const wx = this.x + c.lx * ca - c.ly * sa - nx * c.cr;
          const wy = this.y + c.lx * sa + c.ly * ca - ny * c.cr;
          const rx = wx - this.x, ry = wy - this.y;
          c.rx = rx; c.ry = ry;
          c.rn = rx * ny - ry * nx;
          c.rt = rx * ty - ry * tx;
          c.mn = 1 / (im + iI * c.rn * c.rn);
          c.mt = 1 / (im + iI * c.rt * c.rt);
          c.mu = (c.head ? HEAD_FRICTION : HULL_FRICTION) * sf * fm;
          if (ratio > 0 && (c.ln !== 0 || c.lt !== 0)) {
            c.ln *= ratio; c.lt *= ratio;
            const ix = nx * c.ln + tx * c.lt, iy = ny * c.ln + ty * c.lt;
            this.vx += ix * im; this.vy += iy * im;
            this.av += (rx * iy - ry * ix) * iI;
          }
          c.target = this._contactTarget(c, h, BODY_RESTITUTION + sb);
        }
      }
    }

    // Minimum allowed normal velocity: speculative (may close the gap this step) or restitution
    // (from the approach speed sampled before warm starting).
    _contactTarget(c, h, e) {
      if (c.sep > 0) return -c.sep / h;
      if (c.vn0 < -RESTITUTION_THRESHOLD) return -e * c.vn0;
      return 0;
    }

    // Apply an impulse `lam` along axis d at the wheel centre: +wheel, −chassis.
    _applyStrut(w, dx, dy, crd, lam) {
      if (lam === 0) return;
      w.vx += dx * lam * w._im; w.vy += dy * lam * w._im;
      this.vx -= dx * lam * this._im; this.vy -= dy * lam * this._im;
      this.av -= crd * lam * this._iI;
    }

    // ================================================================ velocity solver
    _solveVelocities(h) {
      const iI = this._iI, im = this._im;
      // ---- wheel joints
      for (const w of this.wheels) {
        const rwx = w._rwx, rwy = w._rwy;
        const rvx = w.vx - this.vx + this.av * rwy;
        const rvy = w.vy - this.vy - this.av * rwx;
        // perpendicular (rigid)
        let lam = -w._pMass * (rvx * w._px + rvy * w._py);
        w._pAcc += lam;
        this._applyStrut(w, w._px, w._py, w._crp, lam);
        // spring-damper (soft)
        let cd = (w.vx - this.vx + this.av * rwy) * w._ux + (w.vy - this.vy - this.av * rwx) * w._uy;
        lam = -w._sMass * (cd + w._sBias + w._sGamma * w._sAcc);
        w._sAcc += lam;
        this._applyStrut(w, w._ux, w._uy, w._cru, lam);
        // hard stop
        if (w._lim) {
          const s = w._lim;
          cd = (w.vx - this.vx + this.av * rwy) * w._ux + (w.vy - this.vy - this.av * rwx) * w._uy;
          const cs = s * cd;
          lam = -w._lMass * (cs + (w._lC > 0 ? w._lC / h : 0));
          const old = w._lAcc;
          w._lAcc = Math.max(0, old + lam);
          lam = w._lAcc - old;
          this._applyStrut(w, w._ux, w._uy, w._cru, s * lam);
        }
        // motor
        if (w._mLo !== 0 || w._mHi !== 0) {
          const rel = w.omega - this.av;
          lam = -w._mMass * (rel - w._mTarget);
          const old = w._mAcc;
          w._mAcc = clamp(old + lam, w._mLo, w._mHi);
          lam = w._mAcc - old;
          w.omega += lam * w._iI; this.av -= lam * iI;
        }
        // brake / rolling resistance / hub friction (+ one-sided hold while reversing: a positive
        // impulse raises omega, i.e. opposes forward rolling)
        if (w._bMax > 0 || w._bFwd > 0 || w._bBack > 0) {
          const rel = w.omega - this.av;
          lam = -w._mMass * rel;
          const old = w._bAcc;
          w._bAcc = clamp(old + lam, -w._bMax - w._bBack, w._bMax + w._bFwd);
          lam = w._bAcc - old;
          w.omega += lam * w._iI; this.av -= lam * iI;
        }
      }
      // ---- limited-slip drivetrain coupling
      if (this._lsdMax > 0) {
        const w0 = this.wheels[0], w1 = this.wheels[1];
        const cd = w0.omega * w0.radius - w1.omega * w1.radius;
        let lam = -this._lsdMass * cd;
        const old = this._lsdAcc;
        this._lsdAcc = clamp(old + lam, -this._lsdMax, this._lsdMax);
        lam = this._lsdAcc - old;
        w0.omega += w0.radius * lam * w0._iI;
        w1.omega -= w1.radius * lam * w1._iI;
      }
      // ---- contacts: friction first, then normal (normal gets the last word)
      const act = this._act, n = this._nAct;
      for (let i = 0; i < n; i++) {
        const c = act[i];
        const maxF = c.mu * c.ln;
        const tx = c.ny, ty = -c.nx;
        if (c.wheel) {
          const w = c.wheel;
          const vt = w.vx * tx + w.vy * ty + w.omega * w.radius;
          let lam = -c.mt * vt;
          const old = c.lt;
          c.lt = clamp(old + lam, -maxF, maxF);
          lam = c.lt - old;
          w.vx += tx * lam * w._im; w.vy += ty * lam * w._im;
          w.omega += w.radius * lam * w._iI;
        } else {
          const vt = (this.vx - this.av * c.ry) * tx + (this.vy + this.av * c.rx) * ty;
          let lam = -c.mt * vt;
          const old = c.lt;
          c.lt = clamp(old + lam, -maxF, maxF);
          lam = c.lt - old;
          this.vx += tx * lam * im; this.vy += ty * lam * im;
          this.av += c.rt * lam * iI;
        }
      }
      for (let i = 0; i < n; i++) {
        const c = act[i];
        if (c.wheel) {
          const w = c.wheel;
          const vn = w.vx * c.nx + w.vy * c.ny;
          let lam = c.mn * (c.target - vn);
          const old = c.ln;
          c.ln = Math.max(0, old + lam);
          lam = c.ln - old;
          w.vx += c.nx * lam * w._im; w.vy += c.ny * lam * w._im;
        } else {
          const vn = (this.vx - this.av * c.ry) * c.nx + (this.vy + this.av * c.rx) * c.ny;
          let lam = c.mn * (c.target - vn);
          const old = c.ln;
          c.ln = Math.max(0, old + lam);
          lam = c.ln - old;
          this.vx += c.nx * lam * im; this.vy += c.ny * lam * im;
          this.av += c.rn * lam * iI;
        }
      }
    }

    _clampVelocities() {
      const P = this._P;
      const cap = P.vClamp;
      const s = Math.hypot(this.vx, this.vy);
      if (s > cap) {
        const k = cap / s;
        this.vx *= k; this.vy *= k;
        for (const w of this.wheels) { w.vx *= k; w.vy *= k; }
      }
      const wcap = cap * 1.25;
      for (const w of this.wheels) {
        const ws = Math.hypot(w.vx, w.vy);
        if (ws > wcap) { const k = wcap / ws; w.vx *= k; w.vy *= k; }
        w.omega = clamp(w.omega, -P.omegaCap, P.omegaCap);
      }
      this.av = clamp(this.av, -CONST.MAX_ANGULAR, CONST.MAX_ANGULAR);
    }

    _integrate(h) {
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.angle += this.av * h;
      for (const w of this.wheels) {
        w.x += w.vx * h;
        w.y += w.vy * h;
        let s = w.spin + w.omega * h;
        if (s > Math.PI || s < -Math.PI) s -= TAU * Math.floor((s + Math.PI) / TAU);
        w.spin = s;
      }
      this._updateRot();
    }

    // ================================================================ position solver (NGS)
    _solvePositions() {
      const P = this._P;
      const im = this._im, iI = this._iI;
      for (const w of this.wheels) {
        const wp = w._p;
        let ca = this._ca, sa = this._sa;
        let mx = this.x + wp.mx * ca - wp.my * sa;
        let my = this.y + wp.mx * sa + wp.my * ca;
        // perpendicular drift
        const lat = (w.x - mx) * ca + (w.y - my) * sa;
        if (lat > 1e-5 || lat < -1e-5) {
          const rwx = w.x - this.x, rwy = w.y - this.y;
          const cr = rwx * sa - rwy * ca;
          const imp = -JOINT_BAUMGARTE * clamp(lat, -MAX_CORRECTION, MAX_CORRECTION) / (w._im + im + iI * cr * cr);
          this._moveStrut(w, ca, sa, cr, imp);
          ca = this._ca; sa = this._sa;
          mx = this.x + wp.mx * ca - wp.my * sa;
          my = this.y + wp.mx * sa + wp.my * ca;
        }
        // travel limits
        const ux = sa, uy = -ca;
        const len = (w.x - mx) * ux + (w.y - my) * uy;
        let C = 0;
        if (len < P.minLen - LINEAR_SLOP) C = len - P.minLen + LINEAR_SLOP;
        else if (len > P.maxLen + LINEAR_SLOP) C = len - P.maxLen - LINEAR_SLOP;
        if (C !== 0) {
          const rwx = w.x - this.x, rwy = w.y - this.y;
          const cr = rwx * uy - rwy * ux;
          const imp = -JOINT_BAUMGARTE * clamp(C, -MAX_CORRECTION, MAX_CORRECTION) / (w._im + im + iI * cr * cr);
          this._moveStrut(w, ux, uy, cr, imp);
        }
      }
      const act = this._act, n = this._nAct;
      for (let i = 0; i < n; i++) {
        const c = act[i];
        if (c.wheel) {
          const w = c.wheel;
          const sep = (w.x - c.qx) * c.nx + (w.y - c.qy) * c.ny - w.radius;
          if (sep < -LINEAR_SLOP) {
            const C = clamp(CONTACT_BAUMGARTE * (sep + LINEAR_SLOP), -MAX_CORRECTION, 0);
            w.x -= c.nx * C; w.y -= c.ny * C;
          }
        } else {
          const ca = this._ca, sa = this._sa;
          const px = this.x + c.lx * ca - c.ly * sa - c.nx * c.cr;
          const py = this.y + c.lx * sa + c.ly * ca - c.ny * c.cr;
          const sep = (px - c.qx) * c.nx + (py - c.qy) * c.ny;
          if (sep < -LINEAR_SLOP) {
            const C = clamp(CONTACT_BAUMGARTE * (sep + LINEAR_SLOP), -MAX_CORRECTION, 0);
            const rx = px - this.x, ry = py - this.y;
            const rn = rx * c.ny - ry * c.nx;
            const imp = -C / (im + iI * rn * rn);
            this.x += c.nx * imp * im; this.y += c.ny * imp * im;
            this.angle += rn * imp * iI;
            this._updateRot();
          }
        }
      }
    }

    // Position-level impulse along d at the wheel centre (+wheel, −chassis).
    _moveStrut(w, dx, dy, cr, imp) {
      w.x += dx * imp * w._im; w.y += dy * imp * w._im;
      this.x -= dx * imp * this._im; this.y -= dy * imp * this._im;
      this.angle -= cr * imp * this._iI;
      this._updateRot();
    }

    // ================================================================ post-step bookkeeping
    _post(h) {
      const P = this._P;
      const ca = this._ca, sa = this._sa;
      let anyWheel = false, allWheels = true, body = false, impact = 0, rpm = 0, motorUsed = 0;
      for (const w of this.wheels) {
        const wp = w._p;
        const mx = this.x + wp.mx * ca - wp.my * sa;
        const my = this.y + wp.mx * sa + wp.my * ca;
        const len = (w.x - mx) * sa - (w.y - my) * ca;
        w._len = len;
        w.compression = clamp((P.maxLen - len) / (P.maxLen - P.minLen), 0, 1);
        let ln = 0, best = null, bestL = -1, touch = false;
        for (let k = 0; k < 2; k++) {
          const c = w._gc[k];
          if (!c.active) continue;
          const sepNow = (w.x - c.qx) * c.nx + (w.y - c.qy) * c.ny - w.radius;
          if (c.ln > 0 || sepNow < TOUCH_TOL) {
            touch = true;
            ln += c.ln;
            if (c.ln > bestL) { bestL = c.ln; best = c; }
            if (-c.vn0 > impact) impact = -c.vn0;
          }
        }
        w.grounded = touch;
        w.load = ln / h;
        if (best) {
          w.nx = best.nx; w.ny = best.ny;
          if (best.surface) w.surface = best.surface;
          if (best.surface && best.surface.hazard) this.hazard = best.surface.hazard;
          const tx = best.ny, ty = -best.nx;
          w.slip = Math.abs(w.vx * tx + w.vy * ty + w.omega * w.radius);
        } else {
          w.slip = 0;
        }
        anyWheel = anyWheel || touch;
        allWheels = allWheels && touch;
        if (w._cc.active && w._cc.ln > 0) body = true; // scraping a cave ceiling still counts as contact
        if (wp.drive > 0) rpm = Math.max(rpm, Math.abs(w.omega - this.av) / P.maxOmega);
        motorUsed += Math.abs(w._mAcc);
      }
      // chassis points
      const pts = this._hullC;
      for (let i = 0; i < pts.length; i++) {
        if (this._touchingChassis(pts[i]) || this._touchingChassis(this._hullCeil[i])) body = true;
      }
      const headTouch = this._touchingChassis(this._headC) || this._touchingChassis(this._headCeil);
      if (headTouch) { body = true; this.headHit = true; }
      for (let i = 0; i < this._nAct; i++) {
        const c = this._act[i];
        if (!c.wheel && c.ln > 0 && -c.vn0 > impact) impact = -c.vn0;
      }
      if (!isNum(impact)) impact = 0;

      this.grounded = anyWheel;
      this.bothGrounded = allWheels;
      this.bodyContact = body;
      const touching = anyWheel || body;
      if (touching) {
        if (!this._touching && this.airTime > 0.12) {
          // touchdown from the air: open a short window in which later contacts of the same landing
          // (second wheel, chassis) can still raise the recorded impact speed
          this.lastImpact.speed = impact;
          this.lastImpact.time = this.time + h;
          this.lastImpact.count++;
          this._landWindow = 0.08;
        } else if (this._landWindow > 0 && impact > this.lastImpact.speed) {
          this.lastImpact.speed = impact;
        }
        this.airTime = 0;
      } else {
        this.airTime += h;
      }
      if (this._landWindow > 0) this._landWindow -= h;
      this._touching = touching;
      this.time += h;
      this.rpm = clamp(rpm, 0, 1);
      this.engineLoad = this._motorUsedMax > 0 ? clamp(motorUsed / this._motorUsedMax, 0, 1) : 0;
    }

    _touchingChassis(c) {
      if (!c.active) return false;
      if (c.ln > 0) {
        if (c.surface && c.surface.hazard && !c.ceiling) this.hazard = c.surface.hazard;
        return true;
      }
      const ca = this._ca, sa = this._sa;
      const px = this.x + c.lx * ca - c.ly * sa - c.nx * c.cr;
      const py = this.y + c.lx * sa + c.ly * ca - c.ny * c.cr;
      const sep = (px - c.qx) * c.nx + (py - c.qy) * c.ny;
      if (sep < TOUCH_TOL) {
        if (c.surface && c.surface.hazard && !c.ceiling) this.hazard = c.surface.hazard;
        return true;
      }
      return false;
    }

    // ================================================================ state management
    _resetWheelsToStatic() {
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      this._ca = ca; this._sa = sa;
      for (const w of this.wheels) {
        const wp = w._p;
        const lx = wp.mx, ly = wp.my - wp.staticLen;
        w.x = this.x + lx * ca - ly * sa;
        w.y = this.y + lx * sa + ly * ca;
        w.vx = this.vx; w.vy = this.vy;
        w.omega = 0;
        w._len = wp.staticLen;
        w.compression = clamp((this._P.maxLen - wp.staticLen) / (this._P.maxLen - this._P.minLen), 0, 1);
        w.load = 0; w.slip = 0; w.grounded = false;
      }
    }

    _resetSolverState() {
      for (const w of this.wheels) {
        w._pAcc = 0; w._sAcc = 0; w._lAcc = 0; w._lim = 0; w._mAcc = 0; w._bAcc = 0;
        this._deactivate(w._gc[0]); this._deactivate(w._gc[1]); this._deactivate(w._cc);
      }
      for (const c of this._hullC) this._deactivate(c);
      for (const c of this._hullCeil) this._deactivate(c);
      this._deactivate(this._headC); this._deactivate(this._headCeil);
      this._nAct = 0;
      this._hPrev = 0;
    }

    _snapshot() {
      const s = this._snap;
      s[0] = this.x; s[1] = this.y; s[2] = this.angle; s[3] = this.vx; s[4] = this.vy; s[5] = this.av;
      let k = 6;
      for (const w of this.wheels) {
        s[k++] = w.x; s[k++] = w.y; s[k++] = w.vx; s[k++] = w.vy; s[k++] = w.spin; s[k++] = w.omega;
      }
    }

    _stateFinite() {
      if (!(isNum(this.x) && isNum(this.y) && isNum(this.angle) && isNum(this.vx) && isNum(this.vy) && isNum(this.av))) return false;
      if (Math.abs(this.angle) > 1e7) return false;
      for (const w of this.wheels) {
        if (!(isNum(w.x) && isNum(w.y) && isNum(w.vx) && isNum(w.vy) && isNum(w.spin) && isNum(w.omega))) return false;
        // a wheel torn far off its strut means the solver blew up
        const dx = w.x - this.x, dy = w.y - this.y;
        if (dx * dx + dy * dy > 100) return false;
      }
      return true;
    }

    // Restore the last good state with zero velocity (NaN guard).
    _restore() {
      const s = this._snap;
      let ok = true;
      for (let i = 0; i < s.length; i++) if (!isNum(s[i])) { ok = false; break; }
      if (ok) {
        this.x = s[0]; this.y = s[1]; this.angle = s[2];
        let k = 6;
        for (const w of this.wheels) { w.x = s[k]; w.y = s[k + 1]; w.spin = s[k + 4]; k += 6; }
      } else {
        this.x = 0; this.y = 5; this.angle = 0;
        this._resetWheelsToStatic();
      }
      this.vx = 0; this.vy = 0; this.av = 0;
      for (const w of this.wheels) {
        w.vx = 0; w.vy = 0; w.omega = 0;
        w.load = 0; w.slip = 0;
        if (!isNum(w.compression)) w.compression = 0.5;
        if (!isNum(w.nx) || !isNum(w.ny)) { w.nx = 0; w.ny = 1; }
      }
      if (!isNum(this.airTime)) this.airTime = 0;
      if (!isNum(this.time)) this.time = 0;
      if (!isNum(this.lastImpact.speed)) this.lastImpact.speed = 0;
      this.rpm = 0; this.engineLoad = 0;
      this._lsdAcc = 0;
      // Re-seat wheels on their struts if the snapshot itself was torn.
      for (const w of this.wheels) {
        const dx = w.x - this.x, dy = w.y - this.y;
        if (dx * dx + dy * dy > 25) { this._resetWheelsToStatic(); break; }
      }
      this._resetSolverState();
      this._updateRot();
      this._snapshot();
    }

    // First x at or after `x` (then before) where the vehicle's footprint is free of hazards.
    _findSafeX(T, x) {
      const P = this._P;
      let minX = Infinity, maxX = -Infinity;
      for (const p of this._hullPts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
      for (const wp of P.wheels) { minX = Math.min(minX, wp.mx - wp.r); maxX = Math.max(maxX, wp.mx + wp.r); }
      const safe = (cx) => {
        for (let sx = cx + minX - 0.5; sx <= cx + maxX + 0.5; sx += 0.5) {
          const s = this._surfaceAt(T, sx);
          if (s && s.hazard) return false;
        }
        return true;
      };
      if (safe(x)) return x;
      for (let d = 0.5; d <= 30; d += 0.5) if (safe(x + d)) return x + d;
      const minT = isNum(T.minX) ? T.minX + 5 : -Infinity;
      for (let d = 0.5; d <= 30; d += 0.5) if (x - d > minT && safe(x - d)) return x - d;
      return x;
    }
  }

  VehicleBody.torqueCurve = torqueCurve;
  RR.VehicleBody = VehicleBody;
})();
