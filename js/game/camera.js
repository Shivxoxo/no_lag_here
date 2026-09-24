/* RIDGE RUSH — follow camera (RR.Camera).
 *
 * Smooth, frame-rate independent chase camera:
 *  - look-ahead in the direction of travel (horizontal ∝ speed, vertical ∝ climb/fall rate),
 *    computed from a low-passed velocity so suspension bounce never reaches the view;
 *  - critically damped spring follow (exact closed-form step ⇒ identical feel at 30 or 144 FPS)
 *    with velocity feed-forward, so there is no speed-dependent lag; the vertical axis is softer than
 *    the horizontal one to swallow suspension micro-bounce;
 *  - a containment band so the vehicle can never leave the screen, whatever happens;
 *  - zoom-out with speed (≤ 24 %) and on big air (≤ 18 %), combined ≤ 30 %;
 *  - trauma-style shake with smooth noise and quadratic decay (15 % strength when reducedMotion,
 *    which also halves the zoom effects).
 *
 * Contract additions: cam.cx / cam.cy = rendered view centre (x + shakeX, y + shakeY), used by
 * worldToScreen / screenToWorld / bounds; cam.baseZoom; cam.reducedMotion (last opts value).
 * (integration) Portrait viewports (h > 1.1 w) zoom in to show at most ~19 m across and allow 30 %
 * look-ahead, so the vehicle is not a speck on tall phone screens.
 * (review fixes) Framing: landscape shows ~12 m vertically / ~19 m across (short landscape phones
 * ~10.5 m), so the car is ~15 % of the screen width instead of ~12 %. Speed zoom (8–28 m/s, ≤ 24 %) and a
 * 0.45 s / ≤ 30 % look-ahead keep upcoming jumps on screen as early as before; the air zoom-out now shows
 * on ordinary 1–2 s jumps (0.3–1 s of air, height term 1.5–6 m instead of 2.5–10 m).
 * Portrait: the bottom `bottomInset` CSS px (default 130 = touch controls) count as hidden, so the car
 * sits at ~52 % of the visible height, and the view leans toward the slope ahead (target.slopeAhead
 * when the caller provides it, else the direction of travel while grounded), ±4 m.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const clamp = U.clamp;
  const isNum = U.isNum;

  const VIEW_METERS_H = 12;      // base zoom shows ~12 m vertically …
  const VIEW_METERS_W = 19;      // … or ~19 m horizontally, whichever is tighter
  const VIEW_METERS_H_SHORT = 10.5; // short landscape phones (view height ≤ SHORT_H_LO px) show a bit less
  const SHORT_H_LO = 420, SHORT_H_HI = 620;
  const VIEW_METERS_W_PORTRAIT = 19; // portrait screens: at most ~19 m across (integration: the 24 m rule
                                     // left a 55 px car in a sea of sky on a 390×844 phone)
  const OMEGA_X = 7.5;           // horizontal follow spring (rad/s)
  const OMEGA_Y = 4.5;           // vertical follow spring — softer to hide suspension bounce
  const VEL_SMOOTH_X = 3.0;      // low-pass on target velocity while it grows (1/s) …
  const VEL_SMOOTH_Y = 4.5;
  const VEL_RELEASE = 14;        // … and while it shrinks: landings/impacts are tracked at once
  const MAX_REL_VEL = 6;         // m/s: cap on camera-vs-target velocity (sudden stops → short dip)
  const FF_DEADZONE_Y = 0.8;     // m/s: vertical speeds below this (suspension bounce) are ignored
  const LOOK_X_PER_MS = 0.45;    // horizontal look-ahead (s of travel) …
  const LOOK_MAX = 0.3;          // … at most this fraction of the view width (landscape) …
  const LOOK_MAX_PORTRAIT = 0.28; // … and on portrait screens (car stays ≥ ~20 % from the left edge)
  const LOOK_Y_PER_MS = 0.22;    // vertical look-ahead (s of climb/fall)
  const LOOK_SMOOTH = 1.8;
  const LOOK_SMOOTH_Y = 2.6;     // vertical look-ahead builds up at this rate …
  const LOOK_RELEASE_Y = 7;      // … and relaxes quickly (no lingering dip after a landing)
  const VERTICAL_BIAS = 0.06;    // fraction of view height the vehicle sits below centre
  const MAX_SPEED_ZOOM = 0.24;   // (review fixes: with the closer base zoom, a stronger speed zoom keeps jumps
                                 // visible as early as before: take-offs appear ≈ 1 s ahead at 70 km/h)
  const SPEED_ZOOM_LO = 8, SPEED_ZOOM_HI = 28;    // m/s
  const MAX_AIR_ZOOM = 0.18;
  const AIR_ZOOM_T_LO = 0.3, AIR_ZOOM_T_HI = 1.0; // s of air
  const AIR_ZOOM_H_LO = 1.5, AIR_ZOOM_H_HI = 6;   // m above the ground
  const PORTRAIT_INSET = 130;    // CSS px at the bottom of a portrait screen hidden by the touch controls
  const PORTRAIT_ANCHOR = 0.52;  // car height as a fraction of the visible (un-occluded) height, from the top
  const SLOPE_LOOK_MAX = 4;      // m: portrait vertical look-ahead along the slope ahead
  const SLOPE_LOOK_SMOOTH = 2.2;
  const MAX_TOTAL_ZOOM = 0.3;
  const CONTAIN_X = 0.42;        // vehicle kept within ±42 % of the view width from centre
  const CONTAIN_Y = 0.36;        // … and ±36 % of the view height

  // Exact step of a critically damped spring chasing a target g(τ) that moves linearly at velocity v
  // during the frame and ends at g1. The spring aims 2v/ω ahead of the target (feed-forward), which
  // exactly cancels the steady-state lag of a critically damped follower: with y = x − g(τ),
  //   y'' + 2ω·y' + ω²·y = 0   ⇒   y(τ) = (y0 + (y0' + ω·y0)·τ)·e^(−ωτ).
  // Closed form ⇒ identical motion at any frame rate, and zero lag at constant speed.
  function springStep(s, g1, v, omega, dt) {
    const y0 = s.p - (g1 - v * dt);
    const yv = clamp(s.v - v, -MAX_REL_VEL, MAX_REL_VEL);
    const j = yv + omega * y0;
    const e = Math.exp(-omega * dt);
    s.p = g1 + (y0 + j * dt) * e;
    s.v = v + (yv - j * omega * dt) * e;
  }

  // Low-pass that follows a growing velocity gently but a shrinking (or reversing) one quickly:
  // suspension bounce averages out toward zero, while a landing or wall hit is tracked at once.
  function smoothVel(cur, target, rise, dt) {
    const shrinking = target * cur < 0 || Math.abs(target) < Math.abs(cur);
    return U.damp(cur, target, shrinking ? VEL_RELEASE : rise, dt);
  }

  class Camera {
    constructor() {
      this.x = 0; this.y = 0;
      this.cx = 0; this.cy = 0;
      this.zoom = 40; this.baseZoom = 40;
      this.viewW = 960; this.viewH = 540;
      this.shakeX = 0; this.shakeY = 0;
      this.reducedMotion = false;
      this._fx = { p: 0, v: 0 };
      this._fy = { p: 0, v: 0 };
      this._svx = 0; this._svy = 0;
      this._lookX = 0; this._lookY = 0; this._lookS = 0;
      this.bottomInset = null;       // portrait: CSS px hidden at the bottom (null ⇒ PORTRAIT_INSET)
      this._zoomMul = 1;
      this._shakeAmp = 0; this._shakeLeft = 0; this._shakeDur = 0; this._t = 0;
      this._noiseX = U.makeNoise1D(0x5eed01);
      this._noiseY = U.makeNoise1D(0x5eed02);
      this.setViewport(960, 540);
    }

    setViewport(w, h) {
      this.viewW = isNum(w) && w > 0 ? w : this.viewW;
      this.viewH = isNum(h) && h > 0 ? h : this.viewH;
      const vmH = U.lerp(VIEW_METERS_H_SHORT, VIEW_METERS_H, U.smoothstep(SHORT_H_LO, SHORT_H_HI, this.viewH));
      let z = Math.min(this.viewH / vmH, this.viewW / VIEW_METERS_W);
      this._portrait = this.viewH > this.viewW * 1.1;
      if (this._portrait) z = Math.max(z, this.viewW / VIEW_METERS_W_PORTRAIT);
      this.baseZoom = Math.max(4, z);
      this.zoom = this.baseZoom * this._zoomMul;
    }

    // Snap to a target without any easing (new run, restart, teleport).
    reset(x, y) {
      x = isNum(x) ? x : 0; y = isNum(y) ? y : 0;
      this._zoomMul = 1;
      this.zoom = this.baseZoom;
      this._svx = 0; this._svy = 0;
      this._lookX = 0;
      this._lookY = 0;
      this._lookS = 0;
      this._fx.p = x; this._fx.v = 0;
      this._fy.p = y; this._fy.v = 0;
      this._shakeAmp = 0; this._shakeLeft = 0;
      this.shakeX = 0; this.shakeY = 0;
      this.x = x;
      this.y = y + this._biasY(this.viewH / this.zoom);
      this.cx = this.x; this.cy = this.y;
    }

    update(dt, target, opts) {
      dt = isNum(dt) ? clamp(dt, 0, 0.1) : 0;
      const reduced = !!(opts && opts.reducedMotion);
      this.reducedMotion = reduced;
      if (target) {
        const tx = isNum(target.x) ? target.x : this._fx.p;
        const ty = isNum(target.y) ? target.y : this._fy.p;
        const tvx = isNum(target.vx) ? clamp(target.vx, -80, 80) : 0;
        const tvy = isNum(target.vy) ? clamp(target.vy, -80, 80) : 0;
        const air = isNum(target.airTime) ? Math.max(0, target.airTime) : 0;
        const hag = target.heightAboveGround;

        // Low-passed velocity drives look-ahead and zoom (suspension jitter filtered out).
        this._svx = smoothVel(this._svx, tvx, VEL_SMOOTH_X, dt);
        this._svy = smoothVel(this._svy, tvy, VEL_SMOOTH_Y, dt);

        // Zoom: out with speed and on big air.
        const speed = Math.hypot(this._svx, this._svy);
        let speedOut = MAX_SPEED_ZOOM * U.smoothstep(SPEED_ZOOM_LO, SPEED_ZOOM_HI, speed);
        let airOut = MAX_AIR_ZOOM * U.smoothstep(AIR_ZOOM_T_LO, AIR_ZOOM_T_HI, air) *
          (isNum(hag) ? U.smoothstep(AIR_ZOOM_H_LO, AIR_ZOOM_H_HI, hag) : U.smoothstep(0.6, 1.8, air));
        if (reduced) { speedOut *= 0.5; airOut *= 0.5; }
        const out = Math.min(MAX_TOTAL_ZOOM, 1 - (1 - speedOut) * (1 - airOut));
        const zt = 1 - out;
        // zoom out a little quicker than back in
        this._zoomMul = U.damp(this._zoomMul, zt, zt < this._zoomMul ? 1.5 : 0.9, dt);
        this.zoom = this.baseZoom * this._zoomMul;

        const viewWm = this.viewW / this.zoom, viewHm = this.viewH / this.zoom;
        // vertical speed with a soft dead zone: suspension bounce (< ~1 m/s) never moves the view
        const svy = this._svy;
        const vyd = svy > FF_DEADZONE_Y ? svy - FF_DEADZONE_Y : svy < -FF_DEADZONE_Y ? svy + FF_DEADZONE_Y : 0;
        const lookXt = clamp(this._svx * LOOK_X_PER_MS, -0.1 * viewWm, (this._portrait ? LOOK_MAX_PORTRAIT : LOOK_MAX) * viewWm);
        const lookYt = clamp(vyd * LOOK_Y_PER_MS, -0.22 * viewHm, 0.14 * viewHm);
        this._lookX = U.damp(this._lookX, lookXt, LOOK_SMOOTH, dt);
        const ly = this._lookY;
        const lyRate = lookYt * ly < 0 || Math.abs(lookYt) < Math.abs(ly) ? LOOK_RELEASE_Y : LOOK_SMOOTH_Y;
        this._lookY = U.damp(ly, lookYt, lyRate, dt);
        const biasY = this._biasY(viewHm);
        // Portrait: lean the view toward the slope ahead so climbs use the tall upper screen.
        let lookSt = 0;
        if (this._portrait) {
          let slope = isNum(target.slopeAhead) ? target.slopeAhead : null;
          if (slope === null) slope = air > 0.1 ? 0 : this._svy / Math.max(4, Math.abs(this._svx));
          lookSt = clamp(clamp(slope, -2, 2) * this._lookX, -SLOPE_LOOK_MAX, SLOPE_LOOK_MAX);
        }
        this._lookS = U.damp(this._lookS, lookSt, SLOPE_LOOK_SMOOTH, dt);

        // Spring follow with velocity feed-forward (no speed-dependent lag, frame-rate independent).
        if (dt > 0) {
          springStep(this._fx, tx, this._svx, OMEGA_X, dt);
          springStep(this._fy, ty, vyd, OMEGA_Y, dt);
        }

        let cx = this._fx.p + this._lookX;
        let cy = this._fy.p + this._lookY + this._lookS + biasY;
        // Containment: never let the vehicle leave the frame.
        const limX = CONTAIN_X * viewWm, limY = CONTAIN_Y * viewHm;
        if (tx - cx > limX) { this._fx.p += tx - cx - limX; cx = tx - limX; }
        else if (cx - tx > limX) { this._fx.p -= cx - tx - limX; cx = tx + limX; }
        if (ty - cy > limY) { this._fy.p += ty - cy - limY; cy = ty - limY; }
        else if (cy - ty > limY) { this._fy.p -= cy - ty - limY; cy = ty + limY; }
        if (!isNum(cx) || !isNum(cy)) { this.reset(tx, ty); cx = this.x; cy = this.y; }
        this.x = cx; this.y = cy;
      }

      // Shake: smooth noise, quadratic decay.
      this._t += dt;
      if (this._shakeLeft > 0) {
        this._shakeLeft = Math.max(0, this._shakeLeft - dt);
        const k = this._shakeDur > 0 ? this._shakeLeft / this._shakeDur : 0;
        const a = this._shakeAmp * k * k * (reduced ? 0.15 : 1);
        const f = 17;
        this.shakeX = a * this._noiseX(this._t * f);
        this.shakeY = a * this._noiseY(this._t * f + 31.7);
        if (this._shakeLeft === 0) { this._shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }
      } else {
        this.shakeX = 0; this.shakeY = 0;
      }
      this.cx = this.x + this.shakeX;
      this.cy = this.y + this.shakeY;
    }

    // Height (m) of the view centre above the vehicle: landscape puts the car a little below the middle;
    // portrait anchors it at PORTRAIT_ANCHOR of the part of the screen the touch controls leave visible.
    _biasY(viewHm) {
      if (!this._portrait) return VERTICAL_BIAS * viewHm;
      const inset = clamp(isNum(this.bottomInset) ? this.bottomInset : PORTRAIT_INSET, 0, this.viewH * 0.4);
      const carFromTop = PORTRAIT_ANCHOR * (this.viewH - inset);        // px
      return (carFromTop - this.viewH * 0.5) * viewHm / this.viewH;      // < 0: car above the middle
    }

    // Add screen shake (world metres). Stronger shakes override weaker ones; never accumulates wildly.
    shake(intensity, duration) {
      if (!isNum(intensity) || intensity <= 0) return;
      intensity = Math.min(intensity, 2.5);
      duration = isNum(duration) && duration > 0 ? Math.min(duration, 3) : 0.35;
      const k = this._shakeDur > 0 ? this._shakeLeft / this._shakeDur : 0;
      const current = this._shakeAmp * k * k;
      if (intensity >= current) {
        this._shakeAmp = intensity;
        this._shakeDur = duration;
        this._shakeLeft = duration;
      } else {
        this._shakeLeft = Math.max(this._shakeLeft, Math.min(duration, this._shakeDur));
      }
    }

    worldToScreen(wx, wy, out) {
      out = out || { x: 0, y: 0 };
      out.x = this.viewW * 0.5 + (wx - this.cx) * this.zoom;
      out.y = this.viewH * 0.5 - (wy - this.cy) * this.zoom;
      return out;
    }

    screenToWorld(sx, sy, out) {
      out = out || { x: 0, y: 0 };
      out.x = this.cx + (sx - this.viewW * 0.5) / this.zoom;
      out.y = this.cy - (sy - this.viewH * 0.5) / this.zoom;
      return out;
    }

    bounds(out) {
      out = out || { left: 0, right: 0, bottom: 0, top: 0 };
      const hw = this.viewW * 0.5 / this.zoom, hh = this.viewH * 0.5 / this.zoom;
      out.left = this.cx - hw;
      out.right = this.cx + hw;
      out.bottom = this.cy - hh;
      out.top = this.cy + hh;
      return out;
    }
  }

  RR.Camera = Camera;
})();
