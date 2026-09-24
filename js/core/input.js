/* RIDGE RUSH — input (RR.Input).
 *
 * Keyboard + on-screen touch controls, merged into one control state (contract §6.1).
 *
 *   Keys: D/→ gas · A/← brake/reverse · W/↑ lean back · S/↓ lean forward · Space emergency brake +
 *         'special' · R restart · P/Esc pause · M mute   (matched on e.code, so WASD is positional on
 *         any keyboard layout; e.key is the fallback).
 *   Touch: bottom-left BRAKE (large) + AIR ROTATE LEFT (lean back ↺); bottom-right GAS (large) +
 *          AIR ROTATE RIGHT (lean forward ↻); SPECIAL above GAS for vehicles that have one.
 *          Pointer events with per-pointer tracking + setPointerCapture; every press is released on
 *          pointerup / pointercancel / lostpointercapture, and everything on window blur / tab hide.
 *          A thumb that slides from one pedal onto another hands the press over (GAS → TILT releases GAS
 *          and holds TILT; the capture moves with it); sliding onto empty space keeps the current press.
 *
 * Keyboard and touch work at the same time: each source keeps its own state and they are OR-ed.
 * preventDefault is applied only to game keys and only while the game is active (setActive(true)),
 * so menus keep normal keyboard behaviour (Tab, Enter, arrows on sliders…). While active, Tab is
 * swallowed too: nothing in the run is focusable, so it would only move focus out of the page (→ window
 * blur → auto-pause).
 *
 * Contract additions (documented, never renames):
 *  - Event payloads: 'pause' / 'restart' / 'mute' / 'special' receive {key, source:'keyboard'|'touch'}
 *    ('pause' from Escape carries key 'Escape' so the Game can treat it as "back" in menus).
 *    Extra event 'touch' fires once, the first time a touch pointer is seen (auto touch-controls mode).
 *  - setActive(bool)   — Game marks gameplay active (enables preventDefault on game keys).
 *  - isTouchDevice()   — maxTouchPoints / ontouchstart / a touch pointer seen so far.
 *  - off(evt, fn); on() returns an unsubscribe function.
 *  - touchVisible / specialVisible (read-only getters).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});

  // ---------------------------------------------------------------- key map
  // action ids: gas brake leanBack leanForward handbrake
  const CODE_ACTIONS = {
    KeyD: 'gas', ArrowRight: 'gas',
    KeyA: 'brake', ArrowLeft: 'brake',
    KeyW: 'leanBack', ArrowUp: 'leanBack',
    KeyS: 'leanForward', ArrowDown: 'leanForward',
    Space: 'handbrake'
  };
  // Fallback when e.code is missing (old browsers / some virtual keyboards).
  const KEY_ACTIONS = {
    d: 'gas', D: 'gas', ArrowRight: 'gas', Right: 'gas',
    a: 'brake', A: 'brake', ArrowLeft: 'brake', Left: 'brake',
    w: 'leanBack', W: 'leanBack', ArrowUp: 'leanBack', Up: 'leanBack',
    s: 'leanForward', S: 'leanForward', ArrowDown: 'leanForward', Down: 'leanForward',
    ' ': 'handbrake', Spacebar: 'handbrake'
  };
  const CODE_COMMANDS = { KeyR: 'restart', KeyP: 'pause', Escape: 'pause', KeyM: 'mute' };
  const KEY_COMMANDS = { r: 'restart', R: 'restart', p: 'pause', P: 'pause', Escape: 'pause', Esc: 'pause', m: 'mute', M: 'mute' };

  const ACTIONS = ['gas', 'brake', 'leanBack', 'leanForward', 'handbrake'];

  // ---------------------------------------------------------------- state
  const state = { gas: false, brake: false, leanBack: false, leanForward: false, handbrake: false };
  const keyState = { gas: false, brake: false, leanBack: false, leanForward: false, handbrake: false };
  const touchCount = { gas: 0, brake: 0, leanBack: 0, leanForward: 0, handbrake: 0 };
  const heldKeys = new Map();          // key id → action (keys currently held down)
  const pointers = new Map();          // pointerId → { action, el }
  const controls = { throttle: 0, lean: 0, handbrake: false }; // reused by getControls()
  const listeners = new Map();         // evt → Set<fn>

  let initialized = false;
  let active = false;
  let touchSeen = false;
  let touchVisible = false;
  let specialVisible = false;
  let firstGestureDone = false;
  let root = null;                     // #touch-controls
  const buttons = {};                  // action → element
  let specialBtn = null;

  // ---------------------------------------------------------------- events
  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) {
    const set = listeners.get(evt);
    if (set) set.delete(fn);
  }
  function emit(evt, payload) {
    const set = listeners.get(evt);
    if (!set || !set.size) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (e) { console.error('[RR.Input] listener error for', evt, e); }
    }
  }

  // ---------------------------------------------------------------- merge
  function recompute() {
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      state[a] = keyState[a] || touchCount[a] > 0;
    }
  }

  function getControls() {
    controls.throttle = (state.gas ? 1 : 0) - (state.brake ? 1 : 0);
    controls.lean = (state.leanBack ? 1 : 0) - (state.leanForward ? 1 : 0);
    controls.handbrake = !!state.handbrake;
    return controls;
  }

  // ---------------------------------------------------------------- first gesture (audio unlock)
  // Only activation-granting events (keydown, mousedown, pointerup, touchend, click) count, so the
  // AudioContext created in the handler is allowed to start.
  function gesture() {
    if (firstGestureDone) return;
    firstGestureDone = true;
    emit('firstGesture', {});
  }

  // ---------------------------------------------------------------- keyboard
  function isEditable(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (t.type || '').toLowerCase();
      // Range sliders and text fields use arrows/space themselves; checkboxes/buttons don't matter.
      return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
    }
    return !!t.isContentEditable;
  }

  function keyId(e) { return e.code || e.key || ''; }
  function actionFor(e) {
    return (e.code && CODE_ACTIONS[e.code]) || KEY_ACTIONS[e.key] || null;
  }
  function commandFor(e) {
    return (e.code && CODE_COMMANDS[e.code]) || KEY_COMMANDS[e.key] || null;
  }

  function onKeyDown(e) {
    // Escape is not an activation event; everything else is fine for the audio unlock.
    if (e.key !== 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) gesture();
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // never hijack browser shortcuts
    const editable = isEditable(e.target);
    if (active && !editable && (e.key === 'Tab' || e.code === 'Tab')) { e.preventDefault(); return; }
    const action = actionFor(e);
    const command = commandFor(e);

    if (action && !(editable && !active)) {
      if (active) e.preventDefault();
      const id = keyId(e);
      if (!heldKeys.has(id)) {
        heldKeys.set(id, action);
        keyState[action] = true;
        recompute();
        if (action === 'handbrake') emit('special', { key: e.key, source: 'keyboard' });
      }
      return;
    }
    if (command) {
      if (editable && command !== 'pause') return;           // typing an 'r' in a field is not a restart
      if (active) e.preventDefault();
      if (e.repeat) return;
      emit(command, { key: e.key === 'Esc' ? 'Escape' : e.key, source: 'keyboard' });
    }
  }

  function onKeyUp(e) {
    const id = keyId(e);
    const action = heldKeys.get(id);
    if (action) {
      heldKeys.delete(id);
      // another held key may still map to the same action (e.g. D and → together)
      let still = false;
      for (const a of heldKeys.values()) if (a === action) { still = true; break; }
      keyState[action] = still;
      recompute();
      if (active) e.preventDefault();
    }
  }

  // ---------------------------------------------------------------- touch controls
  function vibrate(ms) {
    try {
      if (typeof navigator !== 'undefined' && navigator && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    } catch (e) { /* not allowed / unsupported */ }
  }

  function noteTouch(e) {
    if (touchSeen) return;
    if (e && e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    touchSeen = true;
    emit('touch', {});
  }

  function pressPointer(el, action, e) {
    if (e.button !== undefined && e.button > 0) return;      // right/middle mouse buttons
    e.preventDefault();
    try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
    if (pointers.has(e.pointerId)) releasePointer(e.pointerId);
    pointers.set(e.pointerId, { action, el });
    if (action === 'special') {
      emit('special', { key: 'special', source: 'touch' });
    } else {
      touchCount[action] += 1;
      recompute();
    }
    el.classList.add('pressed');
    vibrate(action === 'gas' || action === 'brake' ? 8 : 12);
  }

  function releasePointer(pointerId) {
    const p = pointers.get(pointerId);
    if (!p) return;
    pointers.delete(pointerId);
    if (p.action !== 'special') {
      touchCount[p.action] = Math.max(0, touchCount[p.action] - 1);
      recompute();
    }
    // keep the pressed look while another finger still holds the same button
    let held = false;
    for (const q of pointers.values()) if (q.el === p.el) { held = true; break; }
    if (!held) p.el.classList.remove('pressed');
  }

  // Pointer moved while holding a pedal (events arrive on the capturing button): hand the press over
  // to the pedal now under the finger. Empty space keeps the current press; SPECIAL (a one-shot boost)
  // is never entered by sliding.
  function slidePointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !root) return;
    let hit = null;
    try {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      hit = t && t.closest ? t.closest('.tc-btn') : null;
    } catch (err) { hit = null; }
    if (!hit || hit === p.el || !root.contains(hit)) return;
    const action = hit.getAttribute('data-tc');
    if (!action || action === 'special' || !(action in touchCount)) return;
    releasePointer(e.pointerId);
    pointers.set(e.pointerId, { action, el: hit });
    touchCount[action] += 1;
    recompute();
    hit.classList.add('pressed');
    vibrate(8);
    // move the capture along (the old button's lostpointercapture is ignored: it no longer owns it)
    try { if (hit.setPointerCapture) hit.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
  }

  function releaseAllTouch() {
    for (const id of Array.from(pointers.keys())) releasePointer(id);
    for (const a of ACTIONS) touchCount[a] = 0;
    for (const k of Object.keys(buttons)) buttons[k].classList.remove('pressed');
    if (specialBtn) specialBtn.classList.remove('pressed');
    recompute();
  }

  // Inline icons (duplicated from the page sprite so the controls work even if the sprite is missing).
  const SVG = {
    gas: '<path d="M5.5 5.5L12 12l-6.5 6.5M12 5.5l6.5 6.5-6.5 6.5"/>',
    brake: '<path d="M18.5 5.5L12 12l6.5 6.5M12 5.5L5.5 12l6.5 6.5"/>',
    leanBack: '<path d="M16 18.9A8 8 0 1 0 5.1 8"/><path d="M8.7 6.3L5.1 8l-.4-4"/>',
    leanForward: '<path d="M8 18.9A8 8 0 1 1 18.9 8"/><path d="M15.3 6.3l3.6 1.7.4-4"/>',
    special: '<path d="M13.2 2.5L5 13.6h6.2l-1.2 7.9 8.3-11.2h-6.3z"/>'
  };
  const svg = (k) => '<svg class="tc-ic" viewBox="0 0 24 24" aria-hidden="true">' + SVG[k] + '</svg>';

  function buildTouch() {
    root = document.getElementById('touch-controls');
    if (!root) return;
    root.innerHTML =
      '<div class="tc-cluster tc-left">' +
        '<button type="button" class="tc-btn tc-big tc-brake" data-tc="brake" aria-label="Brake / reverse">' + svg('brake') + '<span>BRAKE</span></button>' +
        '<button type="button" class="tc-btn tc-small tc-rot" data-tc="leanBack" aria-label="Rotate left (lean back)">' + svg('leanBack') + '<span>TILT</span></button>' +
      '</div>' +
      '<div class="tc-cluster tc-right">' +
        '<button type="button" class="tc-btn tc-small tc-special" data-tc="special" aria-label="Special: Ion Thruster">' + svg('special') + '<span>BOOST</span></button>' +
        '<button type="button" class="tc-btn tc-small tc-rot" data-tc="leanForward" aria-label="Rotate right (lean forward)">' + svg('leanForward') + '<span>TILT</span></button>' +
        '<button type="button" class="tc-btn tc-big tc-gas" data-tc="gas" aria-label="Gas">' + svg('gas') + '<span>GAS</span></button>' +
      '</div>';
    const els = root.querySelectorAll('[data-tc]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const action = el.getAttribute('data-tc');
      if (action === 'special') specialBtn = el; else buttons[action] = el;
      el.tabIndex = -1;                                     // not a keyboard target
      el.addEventListener('pointerdown', (e) => { noteTouch(e); pressPointer(el, action, e); });
      const up = (e) => releasePointer(e.pointerId);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      // only release when this button still owns the pointer (a slide moved the capture elsewhere)
      el.addEventListener('lostpointercapture', (e) => {
        const p = pointers.get(e.pointerId);
        if (p && p.el === el) releasePointer(e.pointerId);
      });
      el.addEventListener('pointermove', slidePointer);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // Stop long-press callouts / double-tap zoom anywhere on the control layer.
    root.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    root.addEventListener('touchend', (e) => { gesture(); if (e.cancelable) e.preventDefault(); }, { passive: false });
    applyVisibility();
  }

  function applyVisibility() {
    if (!root) return;
    root.classList.toggle('visible', touchVisible);
    root.setAttribute('aria-hidden', touchVisible ? 'false' : 'true');
    if (specialBtn) specialBtn.classList.toggle('available', specialVisible);
    if (document.body && document.body.classList) document.body.classList.toggle('touch-ui', touchVisible);
  }

  // ---------------------------------------------------------------- public API
  function reset() {
    heldKeys.clear();
    for (const a of ACTIONS) keyState[a] = false;
    releaseAllTouch();
    recompute();
  }

  function setTouchVisible(v) {
    const next = !!v;
    if (next === touchVisible) return;
    touchVisible = next;
    if (!touchVisible) releaseAllTouch();
    applyVisibility();
  }

  function setSpecialVisible(v) {
    specialVisible = !!v;
    applyVisibility();
  }

  function setActive(v) {
    active = !!v;
    if (!active) reset();
  }

  function isTouchDevice() {
    if (touchSeen) return true;
    try {
      if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
      if (typeof window !== 'undefined' && 'ontouchstart' in window) return true;
      if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', reset);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
    }
    // First user gesture (audio unlock) — capture phase so nothing can swallow it.
    window.addEventListener('mousedown', gesture, true);
    window.addEventListener('pointerup', gesture, true);
    window.addEventListener('touchend', gesture, true);
    window.addEventListener('click', gesture, true);
    // Any touch pointer anywhere marks the device as touch-capable (auto touch-controls mode).
    window.addEventListener('pointerdown', noteTouch, true);
    if (typeof document !== 'undefined' && document.getElementById) buildTouch();
  }

  RR.Input = {
    init,
    state,
    getControls,
    on,
    off,
    reset,
    setTouchVisible,
    setSpecialVisible,
    setActive,
    isTouchDevice
  };
  Object.defineProperties(RR.Input, {
    touchVisible: { get: () => touchVisible, enumerable: true },
    specialVisible: { get: () => specialVisible, enumerable: true },
    active: { get: () => active, enumerable: true }
  });
})();
