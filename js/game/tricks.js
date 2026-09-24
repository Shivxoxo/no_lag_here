/* RIDGE RUSH — stunt detection & combo system (RR.Tricks).
 *
 * Contract: docs/ARCHITECTURE.md §5.10.
 *   new RR.Tricks(run); tr.update(dt, body, terrain)
 *   tr.combo → {count, multiplier, timer, max}; tr.addComboAction(kind); tr.resetCombo()
 *   tr.stats → {backflip, frontflip, doubleFlip, tripleFlip, perfect, longAir, wheelie, airTime, wheelieDist}
 *   Calls run.onTrick({id, label, coins, xp, combo}) for every awarded trick.
 *
 * Detection (dt = simulated seconds, so slow-time never distorts air time):
 *  - AIRBORNE once the vehicle has had no wheel and no hull contact for > 0.12 s. Rotation is integrated
 *    from the frame-to-frame change of the continuous body.angle, starting at the moment of lift-off.
 *  - On touchdown a LANDING record is opened and watched for 0.35 s (the award delay). If the run crashes
 *    in that window (head hit, lava, …) nothing is awarded. Otherwise, provided the car ended up on its
 *    wheels (< ~70° from the slope):
 *      flips = floor((|rotation| + 0.5) / 2π), positive rotation (CCW) = BACKFLIP, negative = FRONTFLIP;
 *      flips only count with ≥ 0.45 s of air AND ≥ 3 m of horizontal travel (no stationary spin exploits);
 *      1 flip → BACKFLIP +100 / FRONTFLIP +120, 2 → DOUBLE FLIP +300, 3 → TRIPLE FLIP +600 (+250 per extra);
 *      LONG AIR +200 for ≥ 2.0 s of air at 1 g (threshold scales with 1/√(g/9.81));
 *      PERFECT LANDING +150: both wheels down within 0.12 s, chassis within 0.15 rad of the slope at first
 *      touch, ≥ 0.75 s of air, no hull contact during the landing — and (addition) the chassis rose at least
 *      1.5 m above its lift-off ride height. Without that, skimming over every hill crest at speed lands
 *      "perfectly" on its own (measured: most 0.6–1 s crest hops clear only 0.2–1.2 m), which turned the
 *      popup into spam and the economy upside down.
 *  - WHEELIE: rear wheel down, front up, no hull contact, > 3 m/s. Held ≥ 1.2 s and ≥ 8 m, it is awarded
 *    when it ends (after the same 0.35 s crash-cancel delay): +50 plus 2 per metre.
 *  - COMBO: every trick / perfect landing / fuel / power-up / coin pickup (coins throttled to one per
 *    1.5 s) adds 1; multiplier = min(3, 1 + 0.25·(count − 1)) applies to trick coins (integration economy
 *    pass; the contract's min(5, 1 + 0.5·(count − 1)) made bonus coins dwarf everything). Stunts (tricks, fuel,
 *    power-ups) refresh the RR.CONST.COMBO_TIMEOUT timer; a coin starts a combo but does NOT refresh a
 *    running timer (deliberate: with coin trails every few seconds a coin-refreshed combo never expires
 *    and sits at ×5 forever). When a combo of ≥ 3 containing at least one trick expires,
 *    run.addBonus(count × 15, 'COMBO xN'). A crash resets everything (Run calls resetCombo()).
 *    xp = round(coins / 5).
 *
 * Contract additions (callers may ignore):
 *  - combo.timeout (the full timer length, for HUD bars), combo.tricks (tricks in the current chain).
 *  - stats also has {longestAir, flips (total rotations), tricks (count)}.
 *  - trick objects also carry {base, multiplier, color, flips?, dir?, meters?, airTime?}.
 *  - tr.live → {air, airTime, rotation, wheelie, wheelieDist} for optional HUD read-outs.
 *  - tr.cancelAir() drops any in-progress air/landing/wheelie tracking without touching the combo
 *    (used after a shield rescue teleports the car).
 *  - Mission counting convention (Run): a double BACKflip counts 2 toward the 'backflips' mission stat,
 *    but stats.backflip counts single backflips only (doubles/triples go to doubleFlip/tripleFlip).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum;

  const AIR_MIN = 0.12;             // s without contact before the car counts as airborne
  const FLIP_MIN_AIR = 0.45;        // s
  const FLIP_MIN_DIST = 3;          // m of horizontal travel while airborne
  const AWARD_DELAY = 0.35;         // s after touchdown/end before anything is paid (crash cancels)
  const PERFECT_WINDOW = 0.12;      // s between first and second wheel touching down (integration: was 0.15)
  const PERFECT_ANGLE = 0.15;       // rad chassis-vs-slope at first touch (integration: was 0.2)
  const PERFECT_MIN_AIR = 0.75;     // s (integration: was 0.6 — PERFECT popped on nearly every hop)
  const PERFECT_CLEARANCE = 1.5;    // m the chassis must rise above its lift-off ride height
  const LONG_AIR_1G = 2.0;          // s of air at 9.81 m/s²
  const CLEAN_ANGLE = 1.2;          // rad: beyond this from the slope the car did not land on its wheels
  const WHEELIE_SPEED = 3;          // m/s
  const WHEELIE_TIME = 1.2;         // s
  const WHEELIE_DIST = 8;           // m
  const WHEELIE_GRACE = 0.12;       // s the front may tap the ground without ending the wheelie
  const COIN_COMBO_GAP = 1.5;       // s between coin pickups that count toward the combo
  const COMBO_MULT_STEP = 0.25;     // (integration economy pass: was 0.5, cap 5 — ×5 perfect landings
  const COMBO_MULT_MAX = 3;         //  paid 750 coins each and bonus coins dwarfed everything else)
  const COMBO_BONUS_MIN = 3;
  const COMBO_BONUS_PER = 15;
  const MAX_DT = 0.1;
  const COMBO_TIMEOUT = (RR.CONST && RR.CONST.COMBO_TIMEOUT) || 4;

  const REWARD = Object.freeze({
    backflip: 100, frontflip: 120, doubleFlip: 300, tripleFlip: 600, extraFlip: 250,
    longAir: 200, perfect: 150, wheelie: 50, wheeliePerMeter: 2
  });
  const COLOR = Object.freeze({
    flip: '#7cf3ff', multi: '#ff5fd2', longAir: '#ffd23f', perfect: '#7dff6b', wheelie: '#ffab40'
  });

  // Slope angle of the terrain under x (0 when no terrain).
  function slopeAngle(terrain, x) {
    if (!terrain || typeof terrain.slopeAt !== 'function') return 0;
    const s = terrain.slopeAt(x);
    return isNum(s) ? Math.atan(s) : 0;
  }

  class Tricks {
    constructor(run) {
      this.run = run || null;
      this.combo = { count: 0, multiplier: 1, timer: 0, max: 0, timeout: COMBO_TIMEOUT, tricks: 0 };
      this.stats = {
        backflip: 0, frontflip: 0, doubleFlip: 0, tripleFlip: 0, perfect: 0, longAir: 0, wheelie: 0,
        airTime: 0, wheelieDist: 0, longestAir: 0, flips: 0, tricks: 0
      };
      this.live = { air: false, airTime: 0, rotation: 0, wheelie: false, wheelieDist: 0 };
      this.lastTrick = null;
      this.time = 0;
      this._lastCoinAt = -Infinity;
      // air tracking
      this._touch = true;
      this._offT = 0;
      this._inAir = false;
      this._rot = 0;
      this._liftX = 0;
      this._liftH = 0;
      this._maxH = 0;
      this._prevAngle = null;
      // landing under evaluation
      this._land = { active: false, t: 0, air: 0, dist: 0, rot: 0, clear: 0, firstT: -1, bothT: -1, angleErr: Math.PI, hull: false };
      // wheelie
      this._wh = { active: false, t: 0, dist: 0, grace: 0, lastX: 0, lastY: 0 };
      // delayed awards (wheelies): [{t, meters}]
      this._pending = [];
    }

    // ================================================================ combo
    // Count an action toward the combo. Coin pickups are throttled and only START the timer (they never
    // extend a running combo); every other action refreshes it. Returns true when it counted.
    addComboAction(kind) {
      const c = this.combo;
      if (kind === 'coin') {
        if (this.time - this._lastCoinAt < COIN_COMBO_GAP) return false;
        this._lastCoinAt = this.time;
        if (c.count <= 0) c.timer = COMBO_TIMEOUT;
      } else {
        c.timer = COMBO_TIMEOUT;
        if (kind === 'trick') c.tricks++;
      }
      c.count++;
      c.multiplier = Math.min(COMBO_MULT_MAX, 1 + COMBO_MULT_STEP * (c.count - 1));
      if (c.count > c.max) c.max = c.count;
      return true;
    }

    // Crash: the combo, pending awards and any stunt in progress are lost (no expiry bonus).
    resetCombo() {
      const c = this.combo;
      c.count = 0;
      c.multiplier = 1;
      c.timer = 0;
      c.tricks = 0;
      this._pending.length = 0;
      this._land.active = false;
      this._wh.active = false;
      this.live.wheelie = false;
      this.live.wheelieDist = 0;
    }

    // Forget the stunt in progress (shield rescue teleport) but keep the combo.
    cancelAir() {
      this._land.active = false;
      this._inAir = false;
      this._offT = 0;
      this._rot = 0;
      this._touch = true;
      this._prevAngle = null;
      this._wh.active = false;
      this._pending.length = 0;
      this.live.air = false;
      this.live.airTime = 0;
      this.live.rotation = 0;
      this.live.wheelie = false;
      this.live.wheelieDist = 0;
    }

    _updateCombo(dt) {
      const c = this.combo;
      if (c.count <= 0) return;
      c.timer -= dt;
      if (c.timer > 0) return;
      const n = c.count, tricks = c.tricks;
      c.count = 0;
      c.multiplier = 1;
      c.timer = 0;
      c.tricks = 0;
      if (n >= COMBO_BONUS_MIN && tricks > 0 && !this._crashed()) this._runCall('addBonus', n * COMBO_BONUS_PER, 'COMBO x' + n);
    }

    // ================================================================ per-frame update
    update(dt, body, terrain) {
      dt = U.safeNum(dt, 0);
      if (dt <= 0 || !body) return;
      if (dt > MAX_DT) dt = MAX_DT;
      this.time += dt;

      const angle = U.safeNum(body.angle, 0);
      if (this._prevAngle === null) this._prevAngle = angle;
      let dA = angle - this._prevAngle;
      this._prevAngle = angle;
      if (!isNum(dA) || Math.abs(dA) > 2) dA = 0;      // teleport / garbage: never counts as rotation

      if (this._land.active) this._updateLanding(dt, body, terrain);

      const touching = !!(body.grounded || body.bodyContact);
      if (!touching) {
        const h = this._heightAbove(body, terrain);
        if (this._touch) {                                // lift-off
          this._offT = 0;
          this._rot = 0;
          this._liftX = U.safeNum(body.x, 0);
          this._liftH = h;
          this._maxH = h;
        }
        this._offT += dt;
        this._rot += dA;
        if (h > this._maxH) this._maxH = h;
        if (!this._inAir && this._offT > AIR_MIN) this._inAir = true;
      } else {
        if (!this._touch && this._inAir) this._startLanding(body, terrain);
        this._inAir = false;
        this._offT = 0;
        this._rot = 0;
      }
      this._touch = touching;
      const live = this.live;
      live.air = this._inAir;
      live.airTime = this._inAir ? this._offT : 0;
      live.rotation = this._inAir ? this._rot : 0;

      this._updateWheelie(dt, body);
      this._updatePending(dt, body, terrain);
      this._updateCombo(dt);
    }

    // ================================================================ landings
    _startLanding(body, terrain) {
      if (this._land.active) this._finishLanding(body, terrain);
      const L = this._land;
      L.active = true;
      L.t = 0;
      L.air = this._offT;
      L.dist = Math.abs(U.safeNum(body.x, 0) - this._liftX);
      L.rot = this._rot;
      L.clear = isNum(this._maxH) && isNum(this._liftH) ? this._maxH - this._liftH : Infinity;
      L.firstT = -1;
      L.bothT = -1;
      L.angleErr = Math.PI;
      L.hull = false;
      this._sampleLanding(body, terrain);
    }

    _updateLanding(dt, body, terrain) {
      const L = this._land;
      L.t += dt;
      this._sampleLanding(body, terrain);
      if (L.t >= AWARD_DELAY) this._finishLanding(body, terrain);
    }

    _sampleLanding(body, terrain) {
      const L = this._land;
      const w = body.wheels;
      const w0 = !!(w && w[0] && w[0].grounded), w1 = !!(w && w[1] && w[1].grounded);
      const any = w0 || w1 || (!w && !!body.grounded);
      const both = (w0 && w1) || (!w && !!body.bothGrounded);
      if (any && L.firstT < 0) {
        L.firstT = L.t;
        L.angleErr = Math.abs(U.wrapAngle(U.safeNum(body.angle, 0) - slopeAngle(terrain, U.safeNum(body.x, 0))));
      }
      if (both && L.bothT < 0) L.bothT = L.t;
      if (body.bodyContact) L.hull = true;
    }

    _finishLanding(body, terrain) {
      const L = this._land;
      L.active = false;
      if (this._crashed()) return;
      const st = this.stats;
      st.airTime += L.air;
      if (L.air > st.longestAir) st.longestAir = L.air;
      // clean landing: at least one wheel touched and the car is (still) on its wheels
      if (L.firstT < 0 || !this._upright(body, terrain)) return;

      const turns = Math.floor((Math.abs(L.rot) + 0.5) / TAU);
      if (turns >= 1 && L.air >= FLIP_MIN_AIR && L.dist >= FLIP_MIN_DIST) this._awardFlips(turns, L.rot > 0 ? 1 : -1, L.air);

      if (L.air >= this._longAirThreshold()) {
        st.longAir++;
        this._award('longAir', 'LONG AIR', REWARD.longAir, COLOR.longAir, 'airTime', L.air);
      }

      const perfect = L.bothT >= 0 && L.bothT - L.firstT <= PERFECT_WINDOW && L.angleErr <= PERFECT_ANGLE &&
        L.air >= PERFECT_MIN_AIR && !L.hull && L.clear >= PERFECT_CLEARANCE;
      if (perfect) {
        st.perfect++;
        this._award('perfect', 'PERFECT LANDING', REWARD.perfect, COLOR.perfect, 'airTime', L.air);
      }
    }

    _awardFlips(n, dir, air) {
      const st = this.stats;
      st.flips += n;
      if (n === 1) {
        if (dir > 0) { st.backflip++; this._award('backflip', 'BACKFLIP', REWARD.backflip, COLOR.flip, 'dir', dir, n); }
        else { st.frontflip++; this._award('frontflip', 'FRONTFLIP', REWARD.frontflip, COLOR.flip, 'dir', dir, n); }
        return;
      }
      if (n === 2) {
        st.doubleFlip++;
        this._award('doubleFlip', 'DOUBLE FLIP', REWARD.doubleFlip, COLOR.multi, 'dir', dir, n);
        return;
      }
      st.tripleFlip++;
      const label = n === 3 ? 'TRIPLE FLIP' : n === 4 ? 'QUAD FLIP' : n + 'X FLIP';
      this._award('tripleFlip', label, REWARD.tripleFlip + REWARD.extraFlip * (n - 3), COLOR.multi, 'dir', dir, n);
    }

    _longAirThreshold() {
      const env = this.run && this.run.env;
      let g = env ? U.safeNum(env.gravity, 9.81) * U.safeNum(env.gravityMul, 1) : 9.81;
      if (!(g > 0.5)) g = 9.81;
      return LONG_AIR_1G / Math.sqrt(g / 9.81);
    }

    // ================================================================ wheelies
    _updateWheelie(dt, body) {
      const wh = this._wh;
      const w = body.wheels;
      const speed = Math.hypot(U.safeNum(body.vx, 0), U.safeNum(body.vy, 0));
      const cond = !!(w && w.length >= 2 && w[0].grounded && !w[1].grounded && !body.bodyContact &&
        speed > WHEELIE_SPEED && !this._crashed());
      const x = U.safeNum(body.x, 0), y = U.safeNum(body.y, 0);
      if (cond) {
        if (!wh.active) { wh.active = true; wh.t = 0; wh.dist = 0; wh.lastX = x; wh.lastY = y; }
        wh.grace = 0;
        wh.t += dt;
        const d = Math.hypot(x - wh.lastX, y - wh.lastY);
        if (isNum(d) && d < 5) wh.dist += d;
        wh.lastX = x; wh.lastY = y;
      } else if (wh.active) {
        wh.grace += dt;
        wh.lastX = x; wh.lastY = y;
        if (wh.grace > WHEELIE_GRACE) {
          wh.active = false;
          if (wh.t >= WHEELIE_TIME && wh.dist >= WHEELIE_DIST) this._pending.push({ t: AWARD_DELAY, meters: wh.dist });
        }
      }
      this.live.wheelie = wh.active && wh.t >= WHEELIE_TIME * 0.5;
      this.live.wheelieDist = wh.active ? wh.dist : 0;
    }

    _updatePending(dt, body, terrain) {
      const p = this._pending;
      if (!p.length) return;
      for (let i = p.length - 1; i >= 0; i--) {
        const a = p[i];
        a.t -= dt;
        if (a.t > 0) continue;
        p.splice(i, 1);
        if (this._crashed() || !this._upright(body, terrain)) continue;
        const m = Math.floor(a.meters);
        this.stats.wheelie++;
        this.stats.wheelieDist += a.meters;
        this._award('wheelie', 'WHEELIE ' + m + ' M', REWARD.wheelie + REWARD.wheeliePerMeter * m, COLOR.wheelie,
          'meters', a.meters);
      }
    }

    // ================================================================ helpers
    // Chassis height above the ground (Infinity without a terrain: clearance can't be judged → allowed).
    _heightAbove(body, terrain) {
      if (!terrain || typeof terrain.heightAt !== 'function') return Infinity;
      const gy = terrain.heightAt(U.safeNum(body.x, 0));
      const h = U.safeNum(body.y, 0) - gy;
      return isNum(h) ? h : 0;
    }

    _upright(body, terrain) {
      const rel = U.wrapAngle(U.safeNum(body.angle, 0) - slopeAngle(terrain, U.safeNum(body.x, 0)));
      return Math.abs(rel) < CLEAN_ANGLE;
    }

    _crashed() {
      const s = this.run && this.run.state;
      return s === 'crashed' || s === 'ended';
    }

    _award(id, label, base, color, extraKey, extraVal, flips) {
      this.addComboAction('trick');
      const c = this.combo;
      const coins = Math.max(0, Math.round(base * c.multiplier));
      const trick = {
        id, label, coins, xp: Math.round(coins / 5), combo: c.count, base, multiplier: c.multiplier, color
      };
      if (extraKey) trick[extraKey] = extraVal;
      if (flips) trick.flips = flips;
      this.stats.tricks++;
      this.lastTrick = trick;
      this._runCall('onTrick', trick);
      return trick;
    }

    _runCall(name, a, b) {
      const run = this.run;
      if (!run || typeof run[name] !== 'function') return;
      try { run[name](a, b); } catch (e) {
        if (!this._errLogged) { this._errLogged = true; console.error('[RR.Tricks] run.' + name + ' failed', e); }
      }
    }
  }

  Tricks.REWARD = REWARD;
  Tricks.COLOR = COLOR;
  RR.Tricks = Tricks;
})();
