/* RIDGE RUSH — one gameplay session (RR.Run).
 *
 * Contract: docs/ARCHITECTURE.md §5.12 + docs/INTEGRATION_NOTES.md.
 *   new RR.Run({ worldId, vehicleId, mode:'normal'|'daily'|'attract', daily, renderer, onEnd })
 *   run.update(realDt) · run.render() · run.destroy() · run.quit() · run.rng(name) · run.getSummary()
 *   run.onCoin / onFuel / onPowerup / onTrick · run.addBonus / announce / warn · run.crash(reason)
 *
 * Frame (realDt, never called while paused):
 *   controls (RR.Input or the attract autopilot) → time scale (SLOW TIME ×0.55, crash slow-mo ×0.3) →
 *   semi-fixed physics steps (the scaled frame dt split into n ≤ MAX_SUBSTEPS equal steps h ≤ 1/120 s;
 *   no carried remainder, so every rendered frame shows the pose for exactly that frame) → fuel →
 *   distance & missions → tricks → collectibles → power-ups (real time) → events (time-scaled dt) →
 *   crash / hazard checks → particles & float text → camera → terrain ensure/trim → background → engine.
 *
 * Rules
 *  - Physics gets the FINAL gravity: 9.81 × world.gravity × modifiers.gravityMul × env.gravityMul.
 *    run.env.gravity holds the base value WITHOUT the section multiplier (EventSystem multiplies
 *    env.gravity × env.gravityMul itself); run.env.gravityMul is written by the EventSystem.
 *  - Fuel burns (idleBurn + burnRate·|throttle|) × fuelEfficiencyMul per simulated second; no drain while a
 *    mega orb is active (8 s) or inside a fuel zone (which refills 4.5 %/s; never in a no-fuel daily).
 *    At 0: engine off, OUT OF FUEL, state 'nofuel'; the run ends when the car has been nearly stopped for
 *    1.5 s (hard cap 12 s). Any refuel while coasting resumes 'running'.
 *  - Crashes: head contact, lava, standing on the roof / tail / nose (> ~75° from the local slope, hull on
 *    the ground) for 2.5 s below 2.5 m/s or for 1.5 s below 10 m/s, or falling far below the ground. An
 *    active SHIELD absorbs the crash (rescue + 1.5 s invulnerability). Otherwise 1.6 s of slow-mo, then
 *    onEnd(summary) exactly once. quit() during the slow-mo / the out-of-fuel coast ends with 'crash' /
 *    'fuel' (crashReason kept), otherwise 'quit'.
 *  - The Run never grants rewards: the Game calls RR.Progression.applyRunResults (+ RR.Daily.recordAttempt).
 *  - Attract mode: autopilot, no Save writes / missions / HUD / sound, silently restarts on a fresh seed
 *    after a crash, running dry or getting stuck.
 *
 * Contract notes / additions (callers may ignore):
 *  - The car spawns at x = 0 (not 5) so the HUD distance equals world x — the renderer's 100 m posts and
 *    the BEST flag are drawn at world x.
 *  - Optional constructor field `seed` (uint32) pins the terrain/pickup/event seed of a normal run
 *    (replays, tests); daily runs always use daily.seed, attract restarts always re-roll.
 *  - Extra fields: run.seed, run.worldId, run.vehicleId, run.upgrades, run.controls {throttle, lean,
 *    handbrake, boost, engineOn}, run.specialActive (Ion Thruster firing; the renderer draws the plume),
 *    run.boostActive, run.special (tuned.special | null), run.specialCooldownMax, run.megaTime,
 *    run.newRecord (bool, whole metres beat the previous best; never on daily runs), run.newDailyBest (daily:
 *    beat today's best), run.bestLabel ('BEST' | 'BEST TODAY'), run.jumps (take-off cues played),
 *    run.simTime, run.endReason. With 2X COINS active every coin pickup pops a gold '+N ×2' float text.
 *    run.stats {bossCleared, fuelCollected, powerups, coinsPicked, shieldSaves, maxSpeed (km/h)}.
 *  - run.bestDistance stays the PREVIOUS best for the whole run (the BEST flag must not move). Daily runs use
 *    TODAY's best for that challenge (Daily.status().best; 0 for a stale challenge) and announce
 *    'BEST TODAY!' with the 'mission' sting instead of 'NEW RECORD!' + fanfare.
 *  - Summary also carries {longestAir, tokens (= tokensEarned), seed, dailyId, dailyDay (the challenge's
 *    'YYYY-MM-DD' — pass it to Daily.recordAttempt), targetDistance, previousBest, newRecord (false on
 *    daily runs), newDailyBest, maxSpeed, shieldSaves}; missionsCompleted = texts of missions completed
 *    during this run (from RR.Missions.track results and the 'missionComplete' Bus event).
 *  - HUD banner kinds used: 'warning' (OUT OF FUEL — the HUD turns it into its stamp), 'record';
 *    toast kinds 'powerup', 'fuel', 'shield'; flash kinds 'crash', 'shield'. Mission-complete toasts and
 *    the low-fuel cue are the HUD's own (it listens to RR.Bus / reads run.fuel).
 *  - Space: vehicles with tuned.special fire it on RR.Input 'special' events or on a rising edge of
 *    controls.handbrake (their handbrake is disabled); others use the handbrake.
 *  - Take-off cue: 'jump' SFX + dust puff when the car leaves the ground after ≥ 0.2 s on it (see _takeoff);
 *    skipped right after an EventSystem pad / ramp 'jump'.
 *  - Camera: passes target.slopeAhead (ground rise/run 12 m ahead) and sets camera.bottomInset to 0 when
 *    the touch controls are hidden (RR.Input.touchVisible === false) or in attract mode, else null (default).
 *  - Terrain is trimmed 500 m behind the car (TRIM_BEHIND).
 *  - run.crashPose ('roof' | 'tail' | 'nose' for 'flipped', else null) and run.crashRel (rad, body angle vs
 *    the slope at the crash, + = nose up) are set on every crash and copied into the summary (qa2-11).
 *  - Wind (qa2-2): physics gets env.wind with the headwind soft-capped — linear to −3 m/s², then saturating
 *    toward −5 (HEADWIND_SOFT / HEADWIND_CAP), tailwind ≤ +20 — so a stock car at full throttle on flat
 *    ground never stalls or rolls back in Storm Planet / Gale Force / Chaos; both limits scale with the
 *    physics gravity below 1 g (MOON sections: traction shrinks, the wind does not). run.physWind = that value;
 *    env.wind stays uncapped for the storm visuals.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const CONST = RR.CONST;
  const isNum = U.isNum, clamp = U.clamp, safeNum = U.safeNum;
  const PI = Math.PI;

  // ------------------------------------------------------------------ tunables
  const PHYS_DT = CONST.PHYS_DT;
  const MAX_SUBSTEPS = CONST.MAX_SUBSTEPS;
  const MAX_FRAME_DT = CONST.MAX_FRAME_DT;
  const SPAWN_X = 0;
  const INITIAL_ENSURE = 220;
  const ENSURE_AHEAD = 160;
  const TRIM_BEHIND = 500;            // m of terrain kept behind the car (reversing down a failed climb rarely
                                       // reaches the virtual wall at minX; storage grows on demand)
  const CRASH_TIME = 1.6;              // s of slow-mo before the run ends
  const CRASH_SCALE = 0.3;
  const SLOWTIME_SCALE = 0.55;
  const SHIELD_INVULN = 1.5;
  const FLIP_ANGLE = 75 * PI / 180;    // roof (> 110°) and tail/nose stands (> 75°) both count
  const FLIP_TIME = 2.5;
  const FLIP_SPEED = 2.5;              // (integration: was 1 — a car could crawl on its tail at ~1.2 m/s for 100 m)
  const STAND_SPEED = 10;              // (physics-1 fallback) past 75° on the hull/tail below this speed …
  const STAND_TIME = 1.5;              // … for this long also counts as flipped (sliding on the roof / tail)
  const FALL_DEPTH = 8;
  const NOFUEL_STOP_SPEED = 0.4;
  const NOFUEL_STOP_TIME = 1.5;
  const NOFUEL_MAX_TIME = 12;
  const SPECIAL_FUEL = 3;
  const FUEL_ZONE_REFILL = 0.045;      // fraction of the tank per second (integration balance: was 0.06)
  const MEGA_TIME = 8;
  const CELL_REFILL = 0.35;
  const RECORD_MIN_PREV = 50;
  const JUMP_GROUND_MIN = 0.2;         // s on the ground before a take-off counts as a jump
  const JUMP_AIR_FAST = 0.08;          // take-off cue after this much air when rising ≥ JUMP_VY…
  const JUMP_VY = 2;
  const JUMP_AIR_SLOW = 0.15;          // …or after this much air regardless
  const JUMP_COOL = 0.45;
  const JUMP_PAD_WINDOW = 0.3;         // events already played a pad/ramp 'jump' this recently → stay quiet
  const ATTRACT_STUCK_TIME = 6;
  // Headwind the PHYSICS sees (qa2-2): linear to −3 m/s², then saturating softly toward −5 so a stock car at
  // full throttle on flat ground always keeps moving (−8 stalled it, −9.5 rolled it back). env.wind itself
  // stays uncapped for rain / streaks / particles / clouds; tailwinds pass up to +20.
  const HEADWIND_SOFT = 3, HEADWIND_CAP = 5;
  const SPECIAL_REQ_MS = 300;
  const PARTICLE_CAP = { low: 220, medium: 450, high: 800 };
  const QUALITY_RATE = { low: 0.4, medium: 0.7, high: 1 };
  const ATTRACT_UPGRADES = Object.freeze({ engine: 4, suspension: 5, tires: 4, fuel: 10, grip: 5, air: 3, brakes: 5 });
  const NEUTRAL_MODS = Object.freeze({
    gravityMul: 1, noFuelPickups: false, fuelEfficiencyMul: 1, speedMul: 1, terrainAmpMul: 1,
    frictionMul: 1, coinMul: 1, coinDensityMul: 1, windMul: 1
  });
  const HARD_SURFACES = { rock: 1, metal: 1, neon: 1, crystal: 1, regolith: 1, ice: 1 };

  // ------------------------------------------------------------------ helpers
  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const logged = Object.create(null);
  function logOnce(key, e) {
    if (logged[key]) return;
    logged[key] = true;
    if (typeof console !== 'undefined') console.error('[RR.Run] ' + key + ' failed:', e);
  }
  // Guarded cross-module call: never throws, returns undefined when the method is missing.
  function call(obj, name, a, b, c, d) {
    if (!obj || typeof obj[name] !== 'function') return undefined;
    try { return obj[name](a, b, c, d); } catch (e) { logOnce(name, e); return undefined; }
  }

  function randomSeed() {
    return ((Math.random() * 4294967296) ^ (Date.now() & 0xffffffff)) >>> 0;
  }

  // Missing / junk daily modifier fields → neutral values (clamped to sane ranges).
  function normalizeModifiers(m) {
    const out = Object.assign({}, NEUTRAL_MODS);
    out.labels = [];
    if (!m || typeof m !== 'object') return out;
    const num = (k, lo, hi) => { if (isNum(m[k])) out[k] = clamp(m[k], lo, hi); };
    num('gravityMul', 0.2, 3);
    num('fuelEfficiencyMul', 0.05, 5);
    num('speedMul', 0.5, 2);
    num('terrainAmpMul', 0.5, 2);
    num('frictionMul', 0.05, 3);
    num('coinMul', 0, 10);
    num('coinDensityMul', 0.2, 4);
    num('windMul', 0, 4);
    out.noFuelPickups = !!m.noFuelPickups;
    if (Array.isArray(m.labels)) out.labels = m.labels.filter((s) => typeof s === 'string').slice(0, 8);
    return out;
  }

  // Daily speedMul: scale the design top speed and re-solve the motor's max wheel speed exactly like
  // RR.Vehicles.getTuned does, so the car really reaches topSpeed × mul (torque rises by √mul too).
  function applySpeedMul(tuned, mul) {
    if (!tuned || !isNum(mul) || Math.abs(mul - 1) < 1e-6) return;
    const G = CONST.GRAVITY;
    const cap = CONST.MAX_SPEED / 1.3;
    const top = Math.min(safeNum(tuned.topSpeed, safeNum(tuned.maxSpeed, 22)) * mul, cap);
    const motor = tuned.motor || (tuned.motor = {});
    const torque = safeNum(motor.torque, 900) * Math.max(1, Math.sqrt(mul));
    const w0 = tuned.wheels && tuned.wheels[0];
    const r = w0 && isNum(w0.radius) ? w0.radius : 0.42;
    const ch = tuned.chassis || {};
    const mass = safeNum(ch.mass, 250) + (tuned.wheels || []).reduce((s, w) => s + safeNum(w && w.mass, 0), 0);
    const resist = mass * (safeNum(tuned.rollingResistance, 0.03) * G + 0.02 * top + safeNum(tuned.drag, 0.0015) * top * top);
    const need = clamp(resist * r / torque, 0, 0.95);
    const uTop = Math.cbrt(1 - need);
    motor.torque = torque;
    motor.maxOmega = top / (r * uTop);
    tuned.maxSpeed = top;
    tuned.topSpeed = top;
  }

  // One global RR.Input 'special' listener, forwarded to the active (non-attract) run.
  let activeRun = null;
  let inputHooked = false;
  function hookInput() {
    if (inputHooked) return;
    const I = RR.Input;
    if (!I || typeof I.on !== 'function') return;
    try {
      I.on('special', () => { if (activeRun && !activeRun._destroyed) activeRun._specialReqAt = nowMs(); });
      inputHooked = true;
    } catch (e) { logOnce('Input.on', e); }
  }

  // ================================================================== class
  class Run {
    constructor(opts) {
      opts = opts || {};
      const W = RR.Worlds, V = RR.Vehicles;
      this.mode = opts.mode === 'attract' ? 'attract' : opts.mode === 'daily' ? 'daily' : 'normal';
      this.attract = this.mode === 'attract';
      let daily = this.attract ? null : (opts.daily && typeof opts.daily === 'object' ? opts.daily : null);
      if (!daily && this.mode === 'daily' && RR.Daily) daily = call(RR.Daily, 'getChallenge') || null;
      this.daily = daily;
      if (daily) this.mode = 'daily';
      else if (this.mode === 'daily') this.mode = 'normal';
      this.renderer = opts.renderer || null;
      this.onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : null;

      // --- world & modifiers
      this.world = (W && W.byId(daily && daily.worldId ? daily.worldId : opts.worldId)) || (W && W.list[0]);
      this.worldId = this.world.id;
      this.modifiers = normalizeModifiers(daily ? daily.modifiers : null);
      this.seed = daily && isNum(daily.seed) ? daily.seed >>> 0 : isNum(opts.seed) ? opts.seed >>> 0 : randomSeed();
      this._rngs = new Map();

      // --- vehicle
      this.vehicleDef = (V && V.byId(opts.vehicleId)) || (V && V.list[0]);
      this.vehicleId = this.vehicleDef.id;
      let upg = null;
      if (this.attract) upg = ATTRACT_UPGRADES;
      else if (RR.Save && typeof RR.Save.ensureVehicle === 'function') upg = call(RR.Save, 'ensureVehicle', this.vehicleId);
      this.upgrades = upg || {};
      this.tuned = V.getTuned(this.vehicleId, this.upgrades);
      applySpeedMul(this.tuned, this.modifiers.speedMul);
      this.special = this.tuned.special || null;
      this.colors = (RR.Progression && call(RR.Progression, 'getPaint', this.vehicleId)) || this.vehicleDef.colors;

      // --- session state
      this.fuelMax = Math.max(1, safeNum(this.tuned.fuel && this.tuned.fuel.capacity, 100));
      this.env = {
        gravity: this._baseGravity(), gravityMul: 1,
        wind: safeNum(this.world.wind && this.world.wind.base, 0) * this.modifiers.windMul,
        frictionMul: this.modifiers.frictionMul, darkness: safeNum(this.world.darkness, 0), rain: 0,
        lightning: 0, tint: null, sectionId: null, fuelZone: false, timeScale: 1,
        airDrag: safeNum(this.world.airDrag, 0.02)
      };
      this.bestDistance = this._previousBest();
      this.bestLabel = this.daily ? 'BEST TODAY' : 'BEST';
      this.controls = { throttle: 0, lean: 0, handbrake: false, boost: 0, engineOn: true };
      this._gen = 0;
      this._apThr = 0;
      this._apLean = 0;
      this._engineOn = false;
      this._smokeAcc = 0;
      this._flameAcc = 0;
      this._scrapeAcc = 0;
      this._resetSessionState();

      // --- scratch objects (reused every frame; no per-frame allocation)
      this._physEnv = { terrain: null, gravity: 9.81, wind: 0, frictionMul: 1, airDrag: 0.02, sensitivity: 1 };
      this._pEnv = { gravity: 9.81, wind: 0 };
      this._camT = { x: 0, y: 0, vx: 0, vy: 0, airTime: 0, heightAboveGround: 0, slopeAhead: 0 };
      this._camO = { reducedMotion: false };
      this._bnd = { left: 0, right: 0, bottom: 0, top: 0 };
      this._po = { vx: 0, vy: 0, speed: 0, angle: 0, spread: 0, color: null, size: 0, life: 0, gravity: 1 };
      this._ex = { x: 0, y: 0, angle: 0 };
      this._wp = { x: 0, y: 0 };
      this._eng = { rpm: 0, throttle: 0, load: 0, airborne: false };
      this._worldCtx = { worldId: this.worldId };
      this._dustAcc = [0, 0];
      this._missionTexts = [];
      this._missionIds = Object.create(null);

      // --- settings & persistent visual systems
      this._quality = '';
      this._qRate = 1;
      this._sens = 1;
      this._reduced = false;
      const q = this._settings().quality;
      this.camera = new RR.Camera();
      this.particles = RR.Particles ? new RR.Particles(PARTICLE_CAP[q] || PARTICLE_CAP.high) : null;
      this.floatText = RR.FloatText ? new RR.FloatText(32) : null;
      this.powerUps = new RR.PowerUps(this);
      this.background = null;
      if (RR.Background) {
        try { this.background = new RR.Background(this.world, this.seed); } catch (e) { logOnce('Background', e); }
      }
      this._readSettings();

      this._buildSession();

      if (!this.attract) {
        call(RR.Audio, 'engineStart', this.tuned.style);
        this._engineOn = true;
        hookInput();
        activeRun = this;
        if (RR.Bus && typeof RR.Bus.on === 'function') {
          this._offMission = RR.Bus.on('missionComplete', (p) => this._noteMission(p && p.mission));
        }
      }
    }

    // ================================================================ setup
    _baseGravity() {
      return 9.81 * safeNum(this.world.gravity, 1) * this.modifiers.gravityMul;
    }

    _previousBest() {
      if (this.attract) return 0;
      if (this.daily) {
        // today's best for THIS challenge (a stale challenge object from before midnight has none)
        const st = RR.Daily ? call(RR.Daily, 'status') : null;
        if (st && this.daily.day && st.day && st.day !== this.daily.day) return 0;
        return Math.max(0, safeNum(st && st.best, 0));
      }
      const d = RR.Save && RR.Save.data;
      return Math.max(0, safeNum(d && d.bestDistances && d.bestDistances[this.worldId], 0));
    }

    _resetSessionState() {
      this.state = 'running';
      this.time = 0;
      this.simTime = 0;
      this.physWind = 0;                 // wind (m/s²) the physics got last frame (headwind soft-capped)
      this.distance = 0;
      this.fuel = this.fuelMax;
      this.coins = 0;
      this.bonusCoins = 0;
      this.tokensEarned = 0;
      this.bossXp = 0;
      this.trickXp = 0;
      this.stats = { bossCleared: 0, fuelCollected: 0, powerups: 0, coinsPicked: 0, shieldSaves: 0, maxSpeed: 0 };
      this.boss = null;
      this.invulnTime = 0;
      this.specialCooldown = 0;
      this.specialCooldownMax = this.special ? safeNum(this.special.cooldown, 7) : 0;
      this.specialActive = false;
      this.boostActive = false;
      this.megaTime = 0;
      this.crashReason = null;
      this.crashPose = null;             // 'roof' | 'tail' | 'nose' for a 'flipped' crash
      this.crashRel = 0;                 // body angle vs the slope at the crash (rad, + = nose up)
      this.endReason = null;
      this.newRecord = false;
      this.newDailyBest = false;
      this._specialTime = 0;
      this._specialReqAt = 0;
      this._hbPrev = false;
      this._crashTimer = 0;
      this._flipT = 0; this._standT = 0;
      this._noFuelT = 0;
      this._stopT = 0;
      this._stuckT = 0;
      this._recordAnnounced = false;
      this._groundT = 0;
      this._jumpArmed = false;
      this._jumpCool = 0;
      this.jumps = 0;
      this._missionDist = 0;
      this._trackedRunDist = 0;
      this._trackedAir = 0;
      this._lastCombo = 0;
      this._ended = false;
      this._summary = null;
      const c = this.controls;
      c.throttle = 0; c.lean = 0; c.handbrake = false; c.boost = 0; c.engineOn = true;
      this.env.fuelZone = false;
      this.env.timeScale = 1;
    }

    // Terrain, pickups, vehicle, tricks, events — everything that a fresh (attract) restart rebuilds.
    _buildSession() {
      this._rngs.clear();
      this.terrain = new RR.Terrain({ seed: this.seed, world: this.world, modifiers: this.modifiers });
      this.collectibles = new RR.Collectibles(this);
      this.terrain.onChunk = (x0, x1, f) => { if (this.collectibles) this.collectibles.spawnChunk(x0, x1, f); };
      this.terrain.ensure(INITIAL_ENSURE);

      this.body = new RR.VehicleBody(this.tuned, SPAWN_X, 0);
      this.body.placeOnTerrain(this.terrain, SPAWN_X);
      this.startX = this.body.x;
      this._lastImpactCount = safeNum(this.body.lastImpact && this.body.lastImpact.count, 0);
      this._physEnv.terrain = this.terrain;

      const r = this.renderer;
      const vw = r && isNum(r.w) && r.w > 0 ? r.w : 1280;
      const vh = r && isNum(r.h) && r.h > 0 ? r.h : 720;
      this.camera.setViewport(vw, vh);
      this.camera.reset(this.body.x, this.body.y);

      if (this.particles) this.particles.clear();
      if (this.floatText) this.floatText.clear();
      this.powerUps.clear();
      this.tricks = new RR.Tricks(this);
      if (this.events) call(this.events, 'destroy');
      this.events = null;
      if (RR.EventSystem) {
        try { this.events = new RR.EventSystem(this); } catch (e) { logOnce('EventSystem', e); }
      }
      if (this.background) call(this.background, 'setWorld', this.world, this.seed);
    }

    rng(name) {
      const key = String(name);
      let r = this._rngs.get(key);
      if (!r) {
        r = U.makeRng(this.seed).fork(key);
        this._rngs.set(key, r);
      }
      return r;
    }

    // ================================================================ frame
    update(dt) {
      if (this._destroyed || this._ended) return;
      dt = safeNum(dt, 0);
      if (dt <= 0) return;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      try {
        this._update(dt);
      } catch (e) {
        logOnce('update', e);
      }
    }

    _update(dt) {
      const b = this.body;
      const gen = this._gen;             // an attract restart mid-frame rebuilds body/terrain: stop there
      this.time += dt;
      this._readSettings();

      // 1. controls
      this._readControls();

      // 2. time scale
      let scale = 1;
      if (this.state === 'crashed') scale = CRASH_SCALE;
      else if (this.powerUps.isActive('slowtime')) scale = SLOWTIME_SCALE;
      this.env.timeScale = scale;
      const flowDt = dt * scale;

      // 3. fixed physics steps
      const pe = this._physEnv;
      pe.terrain = this.terrain;
      pe.gravity = this.env.gravity * clamp(safeNum(this.env.gravityMul, 1), 0.1, 3);
      // the cap scales with gravity below 1 g (MOON sections / low-gravity worlds): traction shrinks with g
      // while the wind does not, so −5 m/s² on the moon would still pin a car on a mild climb
      const gk = clamp(pe.gravity / CONST.GRAVITY, 0.3, 1);
      const soft = HEADWIND_SOFT * gk, cap = HEADWIND_CAP * gk;
      let w = clamp(safeNum(this.env.wind, 0), -30, 20);
      if (w < -soft) w = -soft - (cap - soft) * Math.tanh((-w - soft) / (cap - soft));
      pe.wind = w;
      this.physWind = w;
      pe.frictionMul = this.modifiers.frictionMul;
      pe.airDrag = this.env.airDrag;
      pe.sensitivity = this._sens;
      // Semi-fixed timestep: the whole (time-scaled) frame is simulated in n equal steps h ≤ PHYS_DT,
      // so the pose shown every frame is the pose at the end of that frame. The old carry-over
      // accumulator stepped the car in 1/120 s quanta (0 or 2 steps a frame at 75/90/144/165 Hz and in
      // slow-mo) and, without interpolation, the car juddered ~8 px against the smooth camera.
      // At 60/120 Hz this is exactly the old 2 × / 1 × PHYS_DT. Physics rescales warm starts for h.
      const fd = Math.min(flowDt, MAX_SUBSTEPS * PHYS_DT);
      const n = fd > 0 ? clamp(Math.ceil(fd / PHYS_DT - 1e-6), 1, MAX_SUBSTEPS) : 0;
      const h = n ? fd / n : 0;
      for (let i = 0; i < n; i++) b.step(h, this.controls, pe);
      const simDt = fd;
      this.simTime += simDt;
      if (this._specialTime > 0) this._specialTime = Math.max(0, this._specialTime - simDt);

      // 4. fuel
      this._updateFuel(dt, simDt);
      if (this._gen !== gen || this._ended || this._destroyed) return;

      // 5. distance & missions
      this._updateDistance();

      // 6. tricks
      if (this.tricks) {
        this.tricks.update(simDt, b, this.terrain);
        this._trackTrickStats();
      }

      // 7–9. collectibles, power-ups (real time), events (time-scaled)
      if (this.collectibles) this.collectibles.update(flowDt, this);
      this.powerUps.update(dt);
      if (this.events) call(this.events, 'update', flowDt);

      // 10. crashes & hazards
      this._checkCrash(dt);
      if (this.state === 'crashed') {
        this._crashTimer -= dt;
        if (this._crashTimer <= 0) this._end('crash');
      }
      if (this._gen !== gen || this._ended || this._destroyed) return;
      this._timers(dt);
      this._takeoff(simDt, dt);

      // 11. particles & float text
      this._effects(dt);
      const pEnv = this._pEnv;
      pEnv.gravity = pe.gravity;
      pEnv.wind = pe.wind;
      if (this.particles) this.particles.update(flowDt, pEnv);
      if (this.floatText) this.floatText.update(dt);

      // 12. camera
      const ct = this._camT;
      // The camera follows the APPARENT motion: in slow-mo (crash / SLOW TIME) the body keeps its sim
      // velocity but moves `scale`× slower on screen, so feeding raw vx made the look-ahead and
      // feed-forward race ahead and the car slid off the left edge during the crash slow-mo.
      ct.x = b.x; ct.y = b.y; ct.vx = b.vx * scale; ct.vy = b.vy * scale; ct.airTime = b.airTime;
      const gh = safeNum(this.terrain.heightAt(b.x), b.y);
      ct.heightAboveGround = b.y - gh;
      // portrait framing: rise/run of the ground 12 m ahead, and the real touch-control band (none when the
      // on-screen controls are hidden, e.g. a narrow desktop window)
      ct.slopeAhead = clamp((safeNum(this.terrain.heightAt(b.x + 12), gh) - gh) / 12, -3, 3);
      const I = RR.Input;
      this.camera.bottomInset = this.attract || (I && I.touchVisible === false) ? 0 : null;
      this._camO.reducedMotion = this._reduced;
      this.camera.update(dt, ct, this._camO);

      // 13. terrain window
      const bnd = this.camera.bounds(this._bnd);
      this.terrain.ensure(Math.max(bnd.right, b.x) + ENSURE_AHEAD);
      this.terrain.trim(b.x - TRIM_BEHIND);

      // 14. background
      if (this.background) call(this.background, 'update', dt, this.camera, this.env);

      // 15. engine audio
      this._engineAudio();

      // attract-mode housekeeping
      if (this.attract) this._attractWatchdog(dt);
    }

    render() {
      const r = this.renderer;
      if (!r || typeof r.drawRun !== 'function' || this._destroyed) return;
      try { r.drawRun(this); } catch (e) { logOnce('render', e); }
    }

    // ================================================================ controls
    _readControls() {
      const c = this.controls;
      const live = this.state === 'running' || this.state === 'nofuel';
      let thr = 0, lean = 0, hb = false;
      if (live) {
        if (this.attract) {
          this._autopilot();
          thr = this._apThr; lean = this._apLean;
        } else if (RR.Input && typeof RR.Input.getControls === 'function') {
          const ic = call(RR.Input, 'getControls');
          if (ic) { thr = safeNum(ic.throttle, 0); lean = safeNum(ic.lean, 0); hb = !!ic.handbrake; }
        }
      }
      thr = clamp(thr, -1, 1);
      lean = clamp(lean, -1, 1);

      // Space: special (Ion Thruster) for vehicles that have one, handbrake otherwise
      let fire = false;
      if (this.special) {
        if (hb && !this._hbPrev) fire = true;
        if (this._specialReqAt && nowMs() - this._specialReqAt < SPECIAL_REQ_MS) fire = true;
        this._specialReqAt = 0;
        this._hbPrev = hb;
        hb = false;
        if (fire && live) this._fireSpecial();
      }

      const engineOn = this.state === 'running' && this.fuel > 0;
      let boost = 0;
      if (this._specialTime > 0 && this.state === 'running') boost += safeNum(this.special && this.special.force, 1);
      this.boostActive = live && this.powerUps.isActive('boost');
      if (this.boostActive) boost += 1;
      this.specialActive = this._specialTime > 0 && this.state === 'running';
      c.throttle = thr;
      c.lean = lean;
      c.handbrake = hb;
      c.boost = clamp(boost, 0, 1.5);
      c.engineOn = engineOn;
    }

    _fireSpecial() {
      const sp = this.special;
      if (!sp || this.specialCooldown > 0 || this.state !== 'running' || !(this.fuel > 0)) return false;
      this._specialTime = Math.max(0.1, safeNum(sp.duration, 1.2));
      this.specialCooldownMax = Math.max(0.5, safeNum(sp.cooldown, 7));
      this.specialCooldown = this.specialCooldownMax;
      this.fuel = Math.max(0, this.fuel - SPECIAL_FUEL);
      this.specialActive = true;
      this._sfx('thruster');
      call(this.camera, 'shake', 0.12, 0.25);
      const P = this.particles;
      if (P && RR.VehicleArt && typeof RR.VehicleArt.exhaustPoint === 'function') {
        const ex = RR.VehicleArt.exhaustPoint(this.body, this.tuned, this._ex);
        const o = this._opts(this.body.vx * 0.3, this.body.vy * 0.3, 7, ex.angle, 0.6, '#62f6ff', 0.3, 0.35);
        P.emit('boost', ex.x, ex.y, 18, o);
        o.color = '#bff9ff'; o.speed = 4; o.spread = 1.4;
        P.emit('spark', ex.x, ex.y, 10, o);
      }
      return true;
    }

    // Attract-mode driver: throttle feathered by pitch relative to the slope (no wheelie-flips),
    // brake when the nose climbs too far, level the chassis in the air (brake/gas to stop over-rotation).
    _autopilot() {
      const b = this.body, T = this.terrain;
      const slope = Math.atan(safeNum(T.slopeAt(b.x), 0));
      const rel = U.wrapAngle(safeNum(b.angle, 0) - slope);
      const fwd = typeof b.forwardSpeed === 'function' ? safeNum(b.forwardSpeed(), 0) : safeNum(b.vx, 0);
      let thr = 1, lean = 0;
      if (b.grounded || b.bodyContact) {
        if (rel > 0.28) thr = clamp(1 - (rel - 0.28) * 3, 0, 1);
        if (rel > 0.62 && fwd > 1) thr = -0.4;
        if (rel > 0.18) lean = -1;
        else if (rel < -0.4) lean = 0.6;
        if (fwd > 17) thr = Math.min(thr, 0.35);
      } else {
        const lx = b.x + clamp(safeNum(b.vx, 0), 0, 30) * 0.45;
        const target = Math.atan(safeNum(T.slopeAt(lx), 0));
        const err = U.wrapAngle(safeNum(b.angle, 0) - target);
        lean = clamp(-err * 2.2 - safeNum(b.av, 0) * 0.45, -1, 1);
        thr = 0;
        if (err > 0.9 && b.av > 0.4) thr = -1;
        else if (err < -0.9 && b.av < -0.4) thr = 1;
      }
      this._apThr = thr;
      this._apLean = lean;
    }

    _attractWatchdog(dt) {
      if (this.state !== 'running' && this.state !== 'nofuel') { this._stuckT = 0; return; }
      const speed = Math.hypot(this.body.vx, this.body.vy);
      this._stuckT = speed < 0.3 ? this._stuckT + dt : 0;
      if (this._stuckT > ATTRACT_STUCK_TIME) this._restartAttract();
    }

    // ================================================================ fuel
    _updateFuel(dt, simDt) {
      const b = this.body;
      const speed = Math.hypot(b.vx, b.vy);
      const max = this.fuelMax;
      if (this.state === 'running') {
        if (this.megaTime > 0) {
          this.megaTime = Math.max(0, this.megaTime - simDt);
        } else if (this.env.fuelZone && !this.modifiers.noFuelPickups) {
          this.fuel += FUEL_ZONE_REFILL * max * simDt;
        } else if (simDt > 0) {
          const f = this.tuned.fuel || {};
          const thr = Math.abs(this.controls.throttle);
          const idle = safeNum(f.idleBurn, 0.25);
          let rate;
          if (thr > 0.02) rate = idle + safeNum(f.burnRate, 1.8) * thr;
          else rate = speed > 0.5 ? idle : idle * 0.5;
          this.fuel -= rate * simDt * this.modifiers.fuelEfficiencyMul;
        }
        this.fuel = clamp(safeNum(this.fuel, 0), 0, max);
        // (low fuel is signalled by the HUD gauge + sound; the HUD's single warning slot stays free for
        // hazard telegraphs)
        if (this.fuel <= 0) this._outOfFuel();
      } else if (this.state === 'nofuel') {
        this._noFuelT += dt;
        this._stopT = speed < NOFUEL_STOP_SPEED ? this._stopT + dt : 0;
        if (this.env.fuelZone && !this.modifiers.noFuelPickups) {
          this.fuel = clamp(this.fuel + FUEL_ZONE_REFILL * max * simDt, 0, max);
          if (this.fuel > 0.02 * max) this._resumeEngine();
        }
        if (this.state === 'nofuel' && (this._stopT >= NOFUEL_STOP_TIME || this._noFuelT >= NOFUEL_MAX_TIME)) this._end('fuel');
      }
    }

    _outOfFuel() {
      this.fuel = 0;
      this.state = 'nofuel';
      this._noFuelT = 0;
      this._stopT = 0;
      this._specialTime = 0;
      this.specialActive = false;
      this.announce('OUT OF FUEL', 'Coast as far as you can!', 'warning');
      this._sfx('warning');
      this._engineStop();
    }

    _resumeEngine() {
      if (this.state !== 'nofuel') return;
      this.state = 'running';
      this._noFuelT = 0;
      this._stopT = 0;
      if (!this.attract) {
        call(RR.Audio, 'engineStart', this.tuned.style);
        this._engineOn = true;
      }
    }

    // ================================================================ distance, records, missions
    _updateDistance() {
      const d = this.body.x - this.startX;
      if (!isNum(d) || d <= this.distance) return;
      const delta = d - this.distance;
      this.distance = d;
      const kmh = this.body.speedKmh();
      if (kmh > this.stats.maxSpeed) this.stats.maxSpeed = kmh;
      if (this.attract) return;
      this._missionDist += delta;
      if (this._missionDist >= 1) {
        const m = Math.floor(this._missionDist);
        this._missionDist -= m;
        this._track('distance', m);
      }
      const whole = Math.floor(d);
      if (whole > this._trackedRunDist) {
        this._trackedRunDist = whole;
        this._track('runDistance', whole);
        this._track('worldDistance', whole, this._worldCtx);
      }
      // Whole metres, like Progression and the results screen (150.2 m does not beat a 150 m best).
      // Daily runs chase TODAY's best for the challenge: 'BEST TODAY' + a softer sting, and never a
      // permanent record (Progression never writes records for daily runs).
      if (!this.newRecord && !this.newDailyBest && whole > this.bestDistance) {
        const daily = !!this.daily;
        if (daily) this.newDailyBest = true;
        else this.newRecord = true;
        if (this.bestDistance >= RECORD_MIN_PREV && !this._recordAnnounced) {
          this._recordAnnounced = true;
          const best = U.formatDistance(this.bestDistance);
          if (daily) {
            this.announce('BEST TODAY!', 'Past today\'s best of ' + best, 'record');
            this._sfx('mission');
          } else {
            this.announce('NEW RECORD!', 'Past your best of ' + best, 'record');
            this._sfx('record');
          }
          const P = this.particles;
          if (P) {
            const o = this._opts(this.body.vx * 0.4, 2, 9, PI / 2, 1.6, null, 0, 0);
            P.emit('confetti', this.body.x + 2, this.body.y + 2.5, daily ? 30 : 70, o);
          }
        }
      }
    }

    _trackTrickStats() {
      if (this.attract) return;
      const tr = this.tricks;
      const cc = tr.combo.count;
      if (cc > this._lastCombo) this._track('combo', cc);
      this._lastCombo = cc;
      const air = tr.stats.airTime;
      if (air > this._trackedAir + 0.01) {
        this._track('airTime', air - this._trackedAir);
        this._trackedAir = air;
      }
    }

    _track(stat, value, ctx) {
      if (this.attract || !RR.Missions || typeof RR.Missions.track !== 'function') return;
      if (!isNum(value) || value <= 0) return;
      const done = call(RR.Missions, 'track', stat, value, ctx);
      if (done && done.length) for (let i = 0; i < done.length; i++) this._noteMission(done[i]);
    }

    _noteMission(m) {
      if (!m || this._ended) return;
      const id = m.id || m.text;
      if (!id || this._missionIds[id]) return;
      this._missionIds[id] = true;
      if (typeof m.text === 'string') this._missionTexts.push(m.text);
    }

    // ================================================================ crashes
    _checkCrash(dt) {
      const b = this.body;
      const head = !!b.headHit, hazard = b.hazard;
      b.headHit = false;             // sticky flags: read once per frame, then cleared
      b.hazard = null;
      if (this.state !== 'running' && this.state !== 'nofuel') { this._flipT = 0; this._standT = 0; return; }
      if (this.invulnTime > 0) { this._flipT = 0; this._standT = 0; return; }
      if (head) { this.crash('head'); return; }
      if (hazard) { this.crash(hazard === 'lava' ? 'lava' : String(hazard)); return; }
      const T = this.terrain;
      const rel = U.wrapAngle(safeNum(b.angle, 0) - Math.atan(safeNum(T.slopeAt(b.x), 0)));
      const speed = Math.hypot(b.vx, b.vy);
      const stand = Math.abs(rel) > FLIP_ANGLE && b.bodyContact;
      if (stand && speed < FLIP_SPEED) this._flipT += dt;
      else this._flipT = Math.max(0, this._flipT - dt * 2);
      if (stand && speed < STAND_SPEED) this._standT += dt;
      else this._standT = Math.max(0, this._standT - dt * 2);
      if (this._flipT >= FLIP_TIME || this._standT >= STAND_TIME) { this.crash('flipped'); return; }
      const gy = safeNum(T.heightAt(b.x), b.y);
      if (b.y < gy - FALL_DEPTH) this.crash('fall');
    }

    crash(reason) {
      if (this._destroyed || this._ended) return false;
      if (this.state !== 'running' && this.state !== 'nofuel') return false;
      if (this.invulnTime > 0) return false;
      reason = typeof reason === 'string' && reason ? reason : 'crash';
      if (this.powerUps.consumeShield()) {
        this._shieldSave(reason);
        return false;
      }
      const b = this.body;
      this.state = 'crashed';
      this.crashReason = reason;
      // pose at the crash (qa2-11/12): body angle relative to the local slope (+ = nose up) and, for
      // 'flipped', which way up it ended — 'roof' (> 110°), 'tail' (nose up) or 'nose'
      const T = this.terrain;
      let rel = 0;
      try { rel = U.wrapAngle(safeNum(b.angle, 0) - Math.atan(safeNum(T && T.slopeAt ? T.slopeAt(b.x) : 0, 0))); } catch (e) { rel = 0; }
      this.crashRel = safeNum(rel, 0);
      this.crashPose = reason === 'flipped' ? (Math.abs(rel) > 110 * PI / 180 ? 'roof' : rel > 0 ? 'tail' : 'nose') : null;
      this._crashTimer = CRASH_TIME;
      this._flipT = 0; this._standT = 0;
      this._specialTime = 0;
      this.specialActive = false;
      this.boostActive = false;
      if (this.tricks) this.tricks.resetCombo();
      call(this.camera, 'shake', reason === 'flipped' ? 0.35 : 0.9, 0.9);
      const P = this.particles;
      if (P) {
        const cx = b.x, cy = b.y + 0.3;
        P.emit('explosion', cx, cy, reason === 'flipped' ? 16 : 30, this._explOpts(b));
        this._opts(b.vx * 0.4, Math.abs(b.vy) * 0.2 + 1, 8, PI / 2, 2.6, (this.colors && this.colors.body) || '#555555', 0, 0);
        P.emit('debris', cx, cy, 12, this._po);
        this._opts(b.vx * 0.3, 1, 9, PI / 2, 2.8, null, 0, 0);
        P.emit('spark', cx, cy - 0.3, 18, this._po);
        if (reason === 'lava') {
          this._opts(0, 2, 7, PI / 2, 1.4, null, 0, 0);
          P.emit('lava', cx, cy - 0.4, 22, this._po);
        }
      }
      this._sfx('crash');
      if (reason !== 'flipped') this._sfx('explosion', { volume: 0.7 });
      this._engineStop();
      this._hud('flash', 'crash');
      return true;
    }

    _explOpts(b) {
      const o = this._po;
      o.vx = safeNum(b.vx, 0) * 0.6; o.vy = safeNum(b.vy, 0) * 0.4;    // (the fireball travels with the wreck)
      o.speed = 0; o.angle = undefined; o.spread = undefined; o.color = null; o.size = 0; o.life = 0; o.gravity = 1;
      o.debrisColor = (this.colors && this.colors.body) || null;
      return o;
    }

    _shieldSave(reason) {
      const b = this.body;
      call(b, 'rescue', this.terrain);
      b.headHit = false;
      b.hazard = null;
      this.invulnTime = SHIELD_INVULN;
      this._flipT = 0; this._standT = 0;
      this.stats.shieldSaves++;
      if (this.tricks) this.tricks.cancelAir();
      call(this.floatText, 'add', 'SAVED!', b.x, b.y + 1.8, { color: '#6ff6ff', size: 34, life: 1.4 });
      const P = this.particles;
      if (P) {
        this._opts(b.vx * 0.3, b.vy * 0.3, 6, 0, 0, null, 0, 0);
        this._po.angle = undefined; this._po.spread = undefined;
        P.emit('shield', b.x, b.y + 0.4, 30, this._po);
      }
      call(this.camera, 'shake', 0.3, 0.35);
      this._sfx('shield');
      this._hud('flash', 'shield');
      this._hud('toast', 'SHIELD SAVED YOU!', 'shield');
      return reason;
    }

    // ================================================================ ending
    _end(reason) {
      if (this._ended || this._destroyed) return;
      if (this.attract && !this._quitting) { this._restartAttract(); return; }
      this._ended = true;
      this.endReason = reason;
      this.state = 'ended';
      this.specialActive = false;
      this.boostActive = false;
      if (!this.attract && this._missionDist >= 1) {
        const m = Math.floor(this._missionDist);
        this._missionDist -= m;
        this._track('distance', m);
      }
      this._engineStop();
      this._unhook();
      let summary = null;
      try { summary = this.getSummary(); } catch (e) { logOnce('getSummary', e); summary = { worldId: this.worldId, vehicleId: this.vehicleId, mode: this.mode, distance: 0, endReason: reason }; }
      this._summary = summary;
      if (this.onEnd) {
        try { this.onEnd(summary); } catch (e) { logOnce('onEnd', e); }
      }
    }

    // Quitting during the crash slow-mo / the out-of-fuel coast keeps the real end reason (and crashReason).
    quit() {
      if (this._ended || this._destroyed) return;
      this._quitting = true;
      this._end(this.state === 'crashed' ? 'crash' : this.state === 'nofuel' ? 'fuel' : 'quit');
    }

    destroy() {
      if (this._destroyed) return;
      this._engineStop();
      this._destroyed = true;
      this._unhook();
      if (this.events) call(this.events, 'destroy');
      if (this.collectibles) call(this.collectibles, 'clear');
      if (this.particles) this.particles.clear();
      if (this.floatText) this.floatText.clear();
      this.powerUps.clear();
      if (this.terrain) this.terrain.onChunk = null;
      this.onEnd = null;
    }

    _unhook() {
      if (activeRun === this) activeRun = null;
      if (typeof this._offMission === 'function') {
        try { this._offMission(); } catch (e) { /* ignore */ }
      }
      this._offMission = null;
    }

    _restartAttract() {
      this._gen = (this._gen | 0) + 1;
      this.seed = randomSeed();
      this._resetSessionState();
      this.bestDistance = 0;
      this._buildSession();
    }

    getSummary() {
      const tr = this.tricks;
      const ts = tr ? tr.stats : {};
      const fin = (v) => (isNum(v) ? v : 0);
      return {
        worldId: this.worldId,
        vehicleId: this.vehicleId,
        mode: this.mode,
        distance: Math.max(0, fin(this.distance)),
        coins: Math.max(0, Math.floor(fin(this.coins))),
        bonusCoins: Math.max(0, Math.floor(fin(this.bonusCoins))),
        tokens: Math.max(0, Math.floor(fin(this.tokensEarned))),
        trickXp: Math.max(0, Math.floor(fin(this.trickXp))),
        bossXp: Math.max(0, Math.floor(fin(this.bossXp))),
        tricks: {
          backflip: fin(ts.backflip), frontflip: fin(ts.frontflip), doubleFlip: fin(ts.doubleFlip),
          tripleFlip: fin(ts.tripleFlip), perfect: fin(ts.perfect), longAir: fin(ts.longAir), wheelie: fin(ts.wheelie)
        },
        perfectLandings: fin(ts.perfect),
        fuelCollected: fin(this.stats.fuelCollected),
        powerups: fin(this.stats.powerups),
        airTime: Math.round(fin(ts.airTime) * 100) / 100,
        longestAir: Math.round(fin(ts.longestAir) * 100) / 100,
        maxCombo: tr ? fin(tr.combo.max) : 0,
        bossCleared: fin(this.stats.bossCleared),
        endReason: this.endReason || (this.state === 'crashed' ? 'crash' : this.state === 'nofuel' ? 'fuel' : 'quit'),
        crashReason: this.crashReason || null,
        crashPose: this.crashPose || null,
        crashRel: this.crashReason ? Math.round(safeNum(this.crashRel, 0) * 1000) / 1000 : 0,
        time: Math.round(fin(this.time) * 100) / 100,
        missionsCompleted: this._missionTexts.slice(),
        seed: this.seed,
        dailyId: this.daily ? this.daily.id || null : null,
        dailyDay: this.daily ? this.daily.day || null : null,
        targetDistance: this.daily && isNum(this.daily.targetDistance) ? this.daily.targetDistance : null,
        previousBest: this.bestDistance,
        newRecord: !this.daily && this.newRecord,
        newDailyBest: !!this.daily && this.newDailyBest,
        maxSpeed: Math.round(fin(this.stats.maxSpeed)),
        shieldSaves: fin(this.stats.shieldSaves)
      };
    }

    // ================================================================ callbacks
    onCoin(value, x, y) {
      if (this._ended || this._destroyed) return;
      let v = Math.max(0, Math.round(safeNum(value, 0)));
      if (v <= 0) return;
      const doubled = this.powerUps.isActive('multiplier');
      if (doubled) v *= 2;
      this.coins += v;
      this.stats.coinsPicked++;
      x = safeNum(x, this.body.x); y = safeNum(y, this.body.y);
      const P = this.particles;
      if (P) {
        this._opts(this.body.vx * 0.3, this.body.vy * 0.3, 3, 0, 0, null, 0, 0);
        this._po.angle = undefined; this._po.spread = undefined;
        P.emit('coin', x, y, v >= 100 ? 10 : v >= 25 ? 6 : 3, this._po);
      }
      if (doubled && this.floatText) {
        // 2X COINS: every pickup pops a gold '+N ×2' so the power-up reads in the world, not only on the chip
        this.floatText.add('+' + v + ' ×2', x, y + 0.6, { color: '#ffd23f', size: v >= 100 ? 26 : 20, life: 0.8 });
      } else if (v >= 25 && this.floatText) {
        this.floatText.add('+' + v, x, y + 0.6, { color: v >= 100 ? '#ffd23f' : '#e8f0ff', size: v >= 100 ? 26 : 21, life: 0.9 });
      }
      this._sfx(v >= 25 ? 'coinBig' : 'coin');
      if (this.tricks) this.tricks.addComboAction('coin');
      this._track('coins', v);
    }

    onFuel(kind, x, y) {
      if (this._ended || this._destroyed) return;
      const max = this.fuelMax;
      const b = this.body;
      let label = 'FUEL!';
      if (kind === 'cell') {
        this.fuel = Math.min(max, this.fuel + CELL_REFILL * max);
        label = '+35% ENERGY';
      } else if (kind === 'mega') {
        this.fuel = max;
        this.megaTime = MEGA_TIME;
        label = 'MEGA ENERGY!';
        this._hud('toast', 'MEGA ENERGY — 8 s of free fuel', 'fuel');
      } else {
        this.fuel = max;
      }
      this.stats.fuelCollected++;
      if (this.fuel > 0) this._resumeEngine();
      x = safeNum(x, b.x); y = safeNum(y, b.y);
      if (this.floatText) this.floatText.add(label, x, y + 0.9, { color: kind === 'fuel' ? '#ff9a6b' : '#6dffab', size: kind === 'mega' ? 30 : 24, life: 1.1 });
      const P = this.particles;
      if (P) {
        this._opts(b.vx * 0.3, b.vy * 0.3, 4, 0, 0, kind === 'fuel' ? '#ffb070' : '#7dffb5', 0, 0);
        this._po.angle = undefined; this._po.spread = undefined;
        P.emit('star', x, y, kind === 'mega' ? 22 : 10, this._po);
      }
      this._sfx('fuel', kind === 'mega' ? { pitch: 1.2 } : undefined);
      if (this.tricks) this.tricks.addComboAction('fuel');
      this._track('fuelCans', 1);
    }

    onPowerup(type, x, y) {
      if (this._ended || this._destroyed) return;
      const T = RR.PowerUps && RR.PowerUps.TYPES;
      const def = T && T[type];
      if (!def) return;
      this.powerUps.activate(type);
      const b = this.body;
      if (type === 'fuelboost') {
        this.fuel = this.fuelMax;
        this._resumeEngine();
      }
      this.stats.powerups++;
      x = safeNum(x, b.x); y = safeNum(y, b.y);
      if (this.floatText) this.floatText.add(def.name, b.x, b.y + 1.9, { color: def.color, size: 28, life: 1.3 });
      this._hud('toast', def.name + ' — ' + def.desc, 'powerup');
      const P = this.particles;
      if (P) {
        this._opts(b.vx * 0.3, b.vy * 0.3, 5, 0, 0, def.color, 0, 0);
        this._po.angle = undefined; this._po.spread = undefined;
        P.emit('star', x, y, 16, this._po);
        if (type === 'shield') P.emit('shield', b.x, b.y + 0.4, 14, this._po);
      }
      this._sfx('powerup');
      if (type === 'shield') this._sfx('shield', { volume: 0.6 });
      else if (type === 'boost') this._sfx('boost');
      else if (type === 'slowtime') this._sfx('whoosh', { pitch: 0.7 });
      if (this.tricks) this.tricks.addComboAction('powerup');
      this._track('powerups', 1);
    }

    onTrick(trick) {
      if (!trick || this._ended || this._destroyed) return;
      const coins = Math.max(0, Math.round(safeNum(trick.coins, 0)));
      const xp = Math.max(0, Math.round(safeNum(trick.xp, 0)));
      this.bonusCoins += coins;
      this.trickXp += xp;
      if (this.attract) return;
      this._hud('popTrick', String(trick.label || 'TRICK'), coins, trick.color || '#7cf3ff');
      const id = trick.id;
      if (id === 'perfect') this._sfx('perfect');
      else if (id === 'backflip' || id === 'frontflip' || id === 'doubleFlip' || id === 'tripleFlip') this._sfx('flip', { pitch: 1 + 0.08 * Math.min(4, safeNum(trick.flips, 1) - 1) });
      else this._sfx('coinBig', { pitch: 1.1 });
      if (safeNum(trick.combo, 0) >= 3) this._sfx('combo', { pitch: 1 + 0.06 * Math.min(8, trick.combo - 3) });
      const P = this.particles, b = this.body;
      if (P && (id === 'perfect' || id === 'doubleFlip' || id === 'tripleFlip')) {
        this._opts(b.vx * 0.5, 2, 6, PI / 2, 2.2, id === 'perfect' ? '#8dff7a' : null, 0, 0);
        P.emit(id === 'perfect' ? 'star' : 'confetti', b.x, b.y + 1.2, id === 'perfect' ? 14 : 30, this._po);
      }
      switch (id) {
        case 'backflip': this._track('backflips', 1); break;
        case 'frontflip': this._track('frontflips', 1); break;
        case 'doubleFlip':
        case 'tripleFlip':
          this._track('doubleFlips', 1);
          this._track(safeNum(trick.dir, 1) > 0 ? 'backflips' : 'frontflips', safeNum(trick.flips, 2));
          break;
        case 'perfect': this._track('perfectLandings', 1); break;
        case 'wheelie': this._track('wheelie', safeNum(trick.meters, 0)); break;
        default:
      }
      this._track('tricks', 1);
    }

    addBonus(coins, label) {
      if (this._ended || this._destroyed) return;
      const c = Math.max(0, Math.round(safeNum(coins, 0)));
      if (c <= 0) return;
      this.bonusCoins += c;
      if (this.attract) return;
      this._hud('popTrick', String(label || 'BONUS'), c, '#ffd23f');
      this._sfx('coinBig', { pitch: 0.9 });
    }

    announce(title, sub, kind) {
      if (this.attract || this._destroyed) return;
      this._hud('banner', title, sub, kind);
    }

    warn(text, kind, sub) {
      if (this.attract || this._destroyed) return;
      this._hud('warning', text, kind, sub);
    }

    // ================================================================ per-frame helpers
    // Take-off cue ('jump' SFX + a dust puff) for ordinary jumps and crest hops: the body must have been
    // on the ground ≥ 0.2 s and be airborne for 0.08 s while rising ≥ 2 m/s, or for 0.15 s. Pads and the
    // moving ramp play their own 'jump' (EventSystem.jumpSfxAt), so those take-offs stay single.
    _takeoff(simDt, dt) {
      const b = this.body;
      if (this._jumpCool > 0) this._jumpCool = Math.max(0, this._jumpCool - dt);
      if (b.grounded || b.bodyContact) { this._groundT += simDt; return; }
      if (this._groundT > 0) { this._jumpArmed = this._groundT >= JUMP_GROUND_MIN; this._groundT = 0; }
      if (!this._jumpArmed) return;
      const air = safeNum(b.airTime, 0), vy = safeNum(b.vy, 0);
      if (!((air >= JUMP_AIR_FAST && vy >= JUMP_VY) || air >= JUMP_AIR_SLOW)) return;
      this._jumpArmed = false;
      if (this._jumpCool > 0 || this.attract || (this.state !== 'running' && this.state !== 'nofuel')) return;
      this._jumpCool = JUMP_COOL;
      const ev = this.events;
      if (ev && isNum(ev.time) && isNum(ev.jumpSfxAt) && ev.time - ev.jumpSfxAt < JUMP_PAD_WINDOW) return;
      this.jumps++;
      const speed = Math.hypot(b.vx, b.vy);
      this._sfx('jump', { volume: clamp(vy / 8, 0.35, 1), pitch: 0.95 + clamp(speed / 40, 0, 0.2) });
      const P = this.particles, w = b.wheels && b.wheels[0];
      if (P && w) {
        const surf = w.surface || null;
        const type = this._ptype(surf);
        const col = type === 'ice' ? '#e6f4ff' : (surf && surf.dust) || this.world.dustColor || '#9b7b4f';
        const gx = w.x, gy = safeNum(this.terrain.heightAt(w.x), w.y - w.radius);
        this._opts(b.vx * 0.15, 0.6, 2.2, PI / 2 + (b.vx >= 0 ? 0.5 : -0.5), 1.4, col, 0, 0);
        P.emit(type === 'snow' || type === 'ice' ? 'snow' : type === 'mud' ? 'splash' : 'dust', gx, gy + 0.05, Math.max(4, Math.round(8 * this._qRate)), this._po);
      }
    }

    _timers(dt) {
      if (this.invulnTime > 0) this.invulnTime = Math.max(0, this.invulnTime - dt);
      if (this.specialCooldown > 0) this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    }

    _settings() {
      const d = RR.Save && RR.Save.data;
      return (d && d.settings) || { quality: 'high', sensitivity: 1, reducedMotion: false };
    }

    _readSettings() {
      const s = this._settings();
      this._sens = clamp(safeNum(s.sensitivity, 1), 0.5, 1.5);
      this._reduced = !!s.reducedMotion;
      const q = QUALITY_RATE[s.quality] ? s.quality : 'high';
      if (q !== this._quality) {
        this._quality = q;
        this._qRate = QUALITY_RATE[q];
        if (this.particles) call(this.particles, 'setQuality', q);
        if (this.background) call(this.background, 'setQuality', q);
      }
    }

    _engineAudio() {
      if (this.attract || !this._engineOn) return;
      const b = this.body, e = this._eng;
      e.rpm = clamp(safeNum(b.rpm, 0), 0, 1);
      e.throttle = clamp(Math.abs(this.controls.throttle), 0, 1);
      e.load = clamp(safeNum(b.engineLoad, 0), 0, 1);
      e.airborne = !b.grounded;
      call(RR.Audio, 'engineUpdate', e);
    }

    _engineStop() {
      if (this.attract || !this._engineOn) return;
      this._engineOn = false;
      call(RR.Audio, 'engineStop');
    }

    _sfx(name, opts) {
      if (this.attract || this._destroyed) return;
      call(RR.Audio, 'play', name, opts);
    }

    _hud(name, a, b, c) {
      if (this.attract || this._destroyed) return;
      call(RR.HUD, name, a, b, c);
    }

    // Fill the shared particle-options scratch object.
    _opts(vx, vy, speed, angle, spread, color, size, life) {
      const o = this._po;
      o.vx = safeNum(vx, 0); o.vy = safeNum(vy, 0); o.speed = speed; o.angle = angle; o.spread = spread;
      o.color = color; o.size = size; o.life = life; o.gravity = 1; o.debrisColor = null;
      return o;
    }

    // ================================================================ game-feel particles
    _effects(dt) {
      const P = this.particles;
      const b = this.body;
      if (!P || !b) return;
      const bnd = this._bnd;
      if (!(b.x > bnd.left - 4 && b.x < bnd.right + 4 && b.y > bnd.bottom - 4 && b.y < bnd.top + 4)) return;
      const q = this._qRate;
      const speed = Math.hypot(b.vx, b.vy);
      const live = this.state === 'running' || this.state === 'nofuel';
      const wDust = this.world.dustColor || '#9b7b4f';
      const dirX = b.vx >= 0 ? 1 : -1;

      // --- wheel dust / snow / spray, and landing bursts
      const newLanding = b.lastImpact && b.lastImpact.count !== this._lastImpactCount;
      let impact = 0;
      if (newLanding) {
        this._lastImpactCount = b.lastImpact.count;
        impact = safeNum(b.lastImpact.speed, 0);
      }
      for (let i = 0; i < 2; i++) {
        const w = b.wheels[i];
        if (!w || !w.grounded) { this._dustAcc[i] = 0; continue; }
        const surf = w.surface || null;
        const type = this._ptype(surf);
        const col = type === 'ice' ? '#e6f4ff' : (surf && surf.dust) || wDust;
        const nx = safeNum(w.nx, 0), ny = safeNum(w.ny, 1);
        const px = w.x - nx * w.radius, py = w.y - ny * w.radius;
        const slip = safeNum(w.slip, 0);
        const intensity = Math.max(0, speed - 1.5) * 0.3 + slip * 1.1;
        if (intensity > 0.35) {
          this._dustAcc[i] += Math.min(60, intensity * 8) * q * dt;
          const n = Math.floor(this._dustAcc[i]);
          if (n > 0) {
            this._dustAcc[i] -= n;
            const ang = Math.atan2(ny, nx) + 0.65 * dirX;
            const spd = Math.min(5.5, 1.1 + slip * 0.25 + speed * 0.06);
            this._surfaceParticles(P, type, col, px, py, n, w.vx * 0.15, ang, spd, slip);
          }
        }
        if (impact > 2.5) {
          const burst = clamp(Math.round(impact * 1.5), 4, 24);
          this._opts(b.vx * 0.2, 0, Math.min(6.5, 1.2 + impact * 0.35), PI / 2, 2.8, col, 0, 0);
          P.emit(type === 'snow' || type === 'ice' ? 'snow' : type === 'mud' ? 'splash' : 'dust', px, py + 0.05, burst, this._po);
        }
      }
      if (impact > 2.5 && live) {
        call(this.camera, 'shake', clamp((impact - 3) * 0.035, 0.04, 0.45), 0.35);
        this._sfx(impact > 9 ? 'landHard' : 'land', { volume: clamp(impact / 10, 0.35, 1) });
      }

      // --- exhaust smoke at throttle (the ion-drive storm runner has no smoke)
      const art = RR.VehicleArt;
      const haveEx = art && typeof art.exhaustPoint === 'function';
      const thr = this.controls.throttle;
      if (haveEx && this.controls.engineOn && live && thr > 0.1 && this.tuned.style !== 'storm') {
        this._smokeAcc = safeNum(this._smokeAcc, 0) + (3 + 11 * thr) * q * dt;
        const n = Math.floor(this._smokeAcc);
        if (n > 0) {
          this._smokeAcc -= n;
          const ex = art.exhaustPoint(b, this.tuned, this._ex);
          this._opts(b.vx * 0.6, b.vy * 0.6, 1.3, ex.angle, 0.5, '#7b8089', 0.16, 0.8);
          P.emit('smoke', ex.x, ex.y, n, this._po);
        }
      }

      // --- boost / thruster flames
      if (haveEx && (this.boostActive || this.specialActive)) {
        this._flameAcc = safeNum(this._flameAcc, 0) + (this.specialActive ? 55 : 40) * q * dt;
        const n = Math.floor(this._flameAcc);
        if (n > 0) {
          this._flameAcc -= n;
          const ex = art.exhaustPoint(b, this.tuned, this._ex);
          this._opts(b.vx * 0.7, b.vy * 0.7, this.specialActive ? 6 : 4.5, ex.angle, 0.35, this.specialActive ? '#62f6ff' : null, 0, 0);
          P.emit('boost', ex.x, ex.y, n, this._po);
        }
      }

      // --- hull scraping: sparks on hard ground, dust on soft ground
      if (b.bodyContact && speed > 4 && (live || this.state === 'crashed')) {
        this._scrapeAcc = safeNum(this._scrapeAcc, 0) + speed * 3 * q * dt;
        const n = Math.floor(this._scrapeAcc);
        if (n > 0) {
          this._scrapeAcc -= n;
          const hull = this.tuned.chassis && this.tuned.chassis.hull;
          if (Array.isArray(hull) && hull.length) {
            let bx = b.x, by = b.y, best = Infinity;
            const T = this.terrain;
            for (let k = 0; k < hull.length; k++) {
              const p = b.worldPoint(hull[k].x, hull[k].y, this._wp);
              const gap = p.y - safeNum(T.heightAt(p.x), p.y);
              if (gap < best) { best = gap; bx = p.x; by = p.y; }
            }
            if (best < 0.2) {
              const su = T.surfaceAt(bx);
              const back = Math.atan2(-b.vy, -b.vx);
              if (su && HARD_SURFACES[su.type]) {
                this._opts(0, 0, 3 + speed * 0.25, back + 0.35, 0.9, null, 0, 0);
                P.emit('spark', bx, by, n, this._po);
              } else {
                this._opts(0, 0.5, 1.5, back + 0.8, 1.0, (su && su.dust) || wDust, 0, 0);
                P.emit('dust', bx, by, n, this._po);
              }
            }
          }
        }
      }
    }

    // Particle flavour of a wheel's surface: on a Black Ice daily (frictionMul < 0.8) everything but lava
    // sprays ice, matching the renderer's glazed look (qa2-13).
    _ptype(surf) {
      const type = surf ? surf.type : 'dirt';
      return type !== 'lava' && this.modifiers && this.modifiers.frictionMul < 0.8 ? 'ice' : type;
    }

    // Surface-flavoured wheel particles (called with a small count at a quality-scaled rate).
    _surfaceParticles(P, type, col, x, y, n, vx, ang, spd, slip) {
      const o = this._opts(vx, 0, spd, ang, 0.9, col, 0, 0);
      switch (type) {
        case 'snow':
          P.emit('snow', x, y, n + 1, o);
          if (slip > 1) P.emit('dust', x, y, 1, o);
          break;
        case 'ice':
          o.color = '#e6f4ff';
          P.emit('snow', x, y, n, o);
          break;
        case 'mud':
          o.color = '#5c4331';
          P.emit('splash', x, y, n, o);
          break;
        case 'ash':
          P.emit('dust', x, y, n, o);
          if (slip > 1.5 || Math.random() < 0.25) { o.color = null; P.emit('ember', x, y, 1, o); }
          break;
        case 'lava':
          o.color = null;
          P.emit('ember', x, y, n, o);
          break;
        case 'metal':
        case 'neon':
          if (slip > 1.5) {
            o.color = type === 'neon' ? '#3ff3ff' : '#ffd35a';
            o.speed = spd + 2;
            P.emit('spark', x, y, n, o);
          }
          break;
        case 'crystal':
          P.emit('dust', x, y, n, o);
          if (Math.random() < 0.3) { o.color = '#bff9ff'; P.emit('star', x, y, 1, o); }
          break;
        default:
          P.emit('dust', x, y, n, o);
      }
    }
  }

  Run.normalizeModifiers = normalizeModifiers;
  Run.applySpeedMul = applySpeedMul;
  Run.SPAWN_X = SPAWN_X;
  RR.Run = Run;
})();
