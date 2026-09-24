/* RIDGE RUSH — application shell & game loop (RR.Game).
 *
 * Contract §6.5. State machine:
 *
 *     boot → menu ⇄ playing ⇄ paused → results → (retry | garage | menu)
 *                      ↑ tutorial (first run only: frozen frame + controls overlay)
 *
 *  - Boots on DOMContentLoaded: Save.load → Missions.ensureToday → Input.init → Renderer → HUD.init →
 *    UI.init(game) → apply settings → attract-mode Run behind the menu → single guarded rAF loop.
 *  - Frame dt is clamped to RR.CONST.MAX_FRAME_DT; the loop body is wrapped in try/catch (errors are
 *    logged, one error toast is shown, the loop keeps running; a run that keeps throwing is abandoned).
 *  - Paused / results / tutorial: no run.update — the frozen frame is re-rendered only when needed
 *    (entering the state, resize, settings change).
 *  - Auto-pause on tab hide / window blur; Audio.suspend/resume follow visibility.
 *  - Resize / orientation change (debounced + ResizeObserver + visualViewport) → renderer.resize() →
 *    camera.setViewport for the active and attract runs.
 *  - Hotkeys via RR.Input: P/Esc pause toggle (Esc = back in menus / closes modals), R restart
 *    (playing / paused / results), M mute (sound + music, persisted, toast).
 *  - Audio: RR.Audio.init() on Input 'firstGesture', then settings + current music are applied.
 *
 * Contract additions (documented, never renames):
 *  - quitRun()          — pause-menu QUIT: run.quit() → results (collected coins still count).
 *  - quitToMenu(screen) — optional screen id to land on (results → GARAGE uses 'garage').
 *  - refreshAttract()   — rebuild the menu's attract run after a world/vehicle/paint change.
 *  - toggleMute(), applySettings(settings?), lastParams, run / attract / renderer (getters),
 *    frame (rAF frame counter) and state (getter) for tests; errors (count).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});

  const MAX_DT = (RR.CONST && RR.CONST.MAX_FRAME_DT) || 0.05;
  const RUN_ERROR_LIMIT = 45;          // consecutive failing run.update frames before the run is abandoned
  const ATTRACT_ERROR_LIMIT = 20;

  let booted = false;
  let state = 'boot';
  let frame = 0;
  let rafId = 0;
  let lastTs = 0;
  let canvas = null;
  let renderer = null;
  let run = null;
  let attract = null;
  let runEnded = false;
  let lastParams = null;
  let needsRender = true;
  let runErrorStreak = 0;
  let attractErrors = 0;
  let errorCount = 0;
  let errorToastShown = false;
  let currentMusic = null;
  let resizeTimer = 0;
  let attractTimer = 0;
  let fallback = null;                 // sky-only backdrop when no attract run is available
  // Menu framing: screen x (CSS px) where the attract car should drive (beside the menu), or null.
  let menuTargetX = null;
  let menuTargetFor = '';
  let menuOffsetPx = 0;

  const log = (where, e) => console.error('[RR.Game] ' + where + ':', e);
  const settings = () => (RR.Save && RR.Save.data && RR.Save.data.settings) || {};
  const toast = (text, kind, ms) => { if (RR.HUD && RR.HUD.toast) RR.HUD.toast(text, kind, ms); };
  const safe = (fn, where) => { try { return fn(); } catch (e) { log(where, e); return undefined; } };

  function setState(s) {
    state = s;
    if (document.body && document.body.dataset) document.body.dataset.state = s;
    updateTouchVisibility();
  }

  // Errors are counted every time but logged at most 3× per source (then every 300th) so a failure
  // that repeats each frame can't flood the console.
  const errorLogCounts = Object.create(null);
  function reportError(e, where) {
    errorCount++;
    const n = (errorLogCounts[where] = (errorLogCounts[where] || 0) + 1);
    if (n <= 3 || n % 300 === 0) log(where + (n > 3 ? ' (×' + n + ')' : ''), e);
    if (!errorToastShown) {
      errorToastShown = true;
      toast('Something went wrong — the game recovered and keeps running.', 'error', 4200);
    }
  }

  // ---------------------------------------------------------------- audio
  function setMusic(style) {
    currentMusic = style || null;
    if (RR.Audio) safe(() => RR.Audio.music(currentMusic), 'Audio.music');
  }
  function applyAudioSettings(s) {
    if (!RR.Audio) return;
    safe(() => { RR.Audio.setSound(!!s.sound); RR.Audio.setMusic(!!s.music); }, 'audio settings');
  }
  function initAudio() {
    if (!RR.Audio) return;
    safe(() => RR.Audio.init(), 'Audio.init');
    applyAudioSettings(settings());
    setMusic(currentMusic);
  }

  // ---------------------------------------------------------------- settings
  function applyRunQuality(r) {
    if (!r) return;
    const q = settings().quality || 'high';
    safe(() => { if (r.particles && typeof r.particles.setQuality === 'function') r.particles.setQuality(q); }, 'particles.setQuality');
    safe(() => { if (r.background && typeof r.background.setQuality === 'function') r.background.setQuality(q); }, 'background.setQuality');
  }

  function applySettings(s) {
    s = s || settings();
    applyAudioSettings(s);
    if (renderer) {
      safe(() => renderer.setQuality(s.quality || 'high'), 'renderer.setQuality');
      syncViewports();
    }
    applyRunQuality(run);
    applyRunQuality(attract);
    if (fallback && fallback.bg && fallback.bg.setQuality) safe(() => fallback.bg.setQuality(s.quality || 'high'), 'fallback quality');
    const cl = document.body.classList;
    cl.toggle('reduced-motion', !!s.reducedMotion);
    cl.remove('q-low', 'q-medium', 'q-high');
    cl.add('q-' + (s.quality || 'high'));
    updateTouchVisibility();
    needsRender = true;
  }

  function updateTouchVisibility() {
    if (!RR.Input) return;
    const mode = settings().touchControls || 'auto';
    const touch = RR.Input.isTouchDevice ? RR.Input.isTouchDevice() : false;
    if (document.body) document.body.classList.toggle('touch-device', touch);
    const want = mode === 'on' || (mode === 'auto' && touch);
    RR.Input.setTouchVisible(want && state === 'playing');
  }

  // ---------------------------------------------------------------- viewport
  function syncViewport(r) {
    if (r && r.camera && typeof r.camera.setViewport === 'function' && renderer) {
      safe(() => r.camera.setViewport(renderer.w, renderer.h), 'camera.setViewport');
    }
  }
  function syncViewports() {
    syncViewport(run);
    syncViewport(attract);
    if (fallback && renderer) { fallback.cam.viewW = renderer.w; fallback.cam.viewH = renderer.h; }
  }
  function doResize() {
    resizeTimer = 0;
    if (!renderer) return;
    safe(() => renderer.resize(), 'renderer.resize');
    syncViewports();
    menuTargetFor = '';
    needsRender = true;
    if (RR.UI && RR.UI.onResize) safe(() => RR.UI.onResize(), 'UI.onResize');
  }
  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(doResize, 90);
  }

  // ---------------------------------------------------------------- attract run (menu background)
  function destroyAttract() {
    if (attract) safe(() => attract.destroy && attract.destroy(), 'attract.destroy');
    attract = null;
  }
  function startAttract() {
    destroyAttract();
    attractErrors = 0;
    if (!RR.Run || !renderer) return;
    const d = RR.Save.data;
    try {
      attract = new RR.Run({ worldId: d.selectedWorld, vehicleId: d.selectedVehicle, mode: 'attract', daily: null, renderer, onEnd: () => {} });
      applyRunQuality(attract);
      syncViewport(attract);
    } catch (e) {
      log('attract run', e);
      attract = null;
    }
  }
  function refreshAttract() {
    if (attractTimer) clearTimeout(attractTimer);
    attractTimer = setTimeout(() => {
      attractTimer = 0;
      if (state === 'menu') startAttract();
    }, 60);
  }

  // Where should the attract car sit so the menu doesn't hide it? Landscape layouts put the menu in a
  // left column (desktop) or logo-left / buttons-right (short phones); portrait stacks it top/bottom.
  function computeMenuTarget() {
    menuTargetX = null;
    if (!renderer || !(renderer.w > renderer.h * 1.05)) return;
    const main = document.querySelector('.scr-menu .menu-main');
    if (!main) return;
    const w = renderer.w, h = renderer.h;
    const mr = main.getBoundingClientRect();
    if (!(mr.width > 0)) return;
    let target;
    const word = main.querySelector('.logo-word');
    const btns = main.querySelector('.menu-buttons');
    if (h <= 520 && word && btns) {
      let right = 0;
      try { const rg = document.createRange(); rg.selectNodeContents(word); right = rg.getBoundingClientRect().right; } catch (e) { right = mr.left + mr.width * 0.4; }
      target = (right + btns.getBoundingClientRect().left) / 2;
    } else {
      target = (Math.min(w * 0.6, mr.right) + w) / 2;
    }
    if (Number.isFinite(target)) menuTargetX = Math.max(w * 0.25, Math.min(w * 0.85, target));
  }

  // Shift the attract camera (after its update, before render) so the car drives in the open area.
  // The offset is damped, so layout changes and attract restarts glide instead of jumping.
  function frameMenuCamera(r, dt) {
    const cam = r && r.camera, b = r && r.body;
    if (!cam || !b || !(cam.zoom > 0) || !renderer) return;
    const screen = RR.UI ? RR.UI.current : null;
    if (screen !== menuTargetFor) { menuTargetFor = screen; if (screen === 'menu') computeMenuTarget(); else menuTargetX = null; }
    let desired = 0;
    if (menuTargetX !== null && screen === 'menu') {
      const natural = renderer.w / 2 + (b.x - cam.cx) * cam.zoom;
      desired = menuTargetX - natural;
    }
    menuOffsetPx = RR.Util.damp(menuOffsetPx, desired, 2.2, dt);
    if (!Number.isFinite(menuOffsetPx) || Math.abs(menuOffsetPx) > renderer.w) menuOffsetPx = 0;
    if (Math.abs(menuOffsetPx) > 0.01) cam.cx -= menuOffsetPx / cam.zoom;
  }

  // Sky + parallax only (used when RR.Run is unavailable or the attract run keeps failing).
  function drawFallback(dt) {
    if (!renderer || !renderer.ctx) return;
    const ctx = renderer.ctx;
    const worldId = RR.Save.data.selectedWorld;
    if (!fallback || fallback.worldId !== worldId) {
      const world = RR.Worlds && RR.Worlds.byId(worldId);
      let bg = null;
      try { bg = RR.Background && world ? new RR.Background(world, 1234) : null; } catch (e) { bg = null; }
      fallback = { worldId, bg, cam: { x: 0, y: 4, cx: 0, cy: 4, zoom: 36, viewW: renderer.w, viewH: renderer.h, shakeX: 0, shakeY: 0 } };
      if (bg && bg.setQuality) safe(() => bg.setQuality(settings().quality || 'high'), 'fallback quality');
    }
    const cam = fallback.cam;
    cam.x += dt * 5; cam.cx = cam.x;
    renderer.screenTransform();
    if (fallback.bg) {
      try {
        fallback.bg.update(dt, cam, null);
        fallback.bg.drawSky(ctx, cam, renderer.w, renderer.h, null);
        fallback.bg.drawWeather(ctx, cam, renderer.w, renderer.h, null);
        return;
      } catch (e) { log('fallback backdrop', e); fallback.bg = null; }
    }
    const g = ctx.createLinearGradient(0, 0, 0, renderer.h);
    g.addColorStop(0, '#1b2a55'); g.addColorStop(1, '#f08a4b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, renderer.w, renderer.h);
  }

  // ---------------------------------------------------------------- runs
  function destroyRun() {
    if (run) safe(() => run.destroy && run.destroy(), 'run.destroy');
    run = null;
    runEnded = false;
  }

  function normalizeParams(p) {
    p = p || {};
    const d = RR.Save.data;
    const daily = p.daily && typeof p.daily === 'object' ? p.daily : null;
    let worldId = p.worldId || (daily && daily.worldId) || d.selectedWorld;
    let vehicleId = p.vehicleId || d.selectedVehicle;
    if (!RR.Worlds.byId(worldId)) worldId = d.selectedWorld;
    // a daily world is playable even when locked (teaser); normal runs need an unlocked world
    if (!daily && d.unlockedWorlds.indexOf(worldId) < 0) worldId = d.selectedWorld;
    if (d.unlockedVehicles.indexOf(vehicleId) < 0) vehicleId = d.selectedVehicle;
    return { worldId, vehicleId, daily };
  }

  function startRun(params) {
    if (!booted) return false;
    const p = normalizeParams(params);
    if (!RR.Run || !renderer) {
      toast('The game engine failed to load. Please reload the page.', 'error', 5000);
      return false;
    }
    destroyRun();
    destroyAttract();
    let r = null;
    try {
      r = new RR.Run({
        worldId: p.worldId, vehicleId: p.vehicleId, mode: p.daily ? 'daily' : 'normal', daily: p.daily,
        renderer,
        onEnd: (summary) => { if (r && r === run) endRun(summary); }
      });
    } catch (e) {
      reportError(e, 'new Run');
      startAttract();
      setState('menu');
      if (RR.UI) RR.UI.show('menu');
      return false;
    }
    run = r;
    runEnded = false;
    runErrorStreak = 0;
    lastParams = p;
    applyRunQuality(run);
    syncViewport(run);
    if (RR.HUD) { RR.HUD.reset(run); RR.HUD.show(true); }
    if (RR.UI) RR.UI.show(null);
    if (RR.Input) {
      RR.Input.reset();
      const special = !!((run.vehicleDef && run.vehicleDef.special) || (run.tuned && run.tuned.special));
      RR.Input.setSpecialVisible(special);
    }
    blurActive();
    if (RR.Audio) safe(() => RR.Audio.duck(false), 'Audio.duck');
    const world = run.world || RR.Worlds.byId(p.worldId);
    setMusic(world && world.musicStyle ? world.musicStyle : 'valley');
    needsRender = true;
    if (!RR.Save.data.seenTutorial && RR.UI && RR.UI.showTutorial) {
      setState('tutorial');
      if (RR.Input) RR.Input.setActive(false);
      // (integration) Run starts its engine in the constructor; keep it silent behind the overlay
      if (RR.Audio) safe(() => RR.Audio.engineStop(), 'Audio.engineStop');
      RR.UI.showTutorial(() => {
        if (run === r && state === 'tutorial') {
          setState('playing');
          lastTs = 0;
          if (RR.Input) { RR.Input.reset(); RR.Input.setActive(true); }
          blurActive();
          const style = (r.tuned && r.tuned.style) || (r.vehicleDef && r.vehicleDef.style);
          if (RR.Audio && style && r.state === 'running') safe(() => RR.Audio.engineStart(style), 'Audio.engineStart');
        }
      });
    } else {
      setState('playing');
      if (RR.Input) RR.Input.setActive(true);
    }
    return true;
  }

  function endRun(summary) {
    if (runEnded || !run) return;                              // exactly once per run
    runEnded = true;
    const r = run;
    if (!summary && r && typeof r.getSummary === 'function') summary = safe(() => r.getSummary(), 'run.getSummary');
    summary = summary || { worldId: lastParams && lastParams.worldId, vehicleId: lastParams && lastParams.vehicleId, mode: lastParams && lastParams.daily ? 'daily' : 'normal', distance: 0, coins: 0, endReason: 'quit' };
    let rewards = null;
    let dailyResult = null;
    try { rewards = RR.Progression.applyRunResults(summary); } catch (e) { reportError(e, 'applyRunResults'); }
    if (summary.mode === 'daily' || (lastParams && lastParams.daily)) {
      try { dailyResult = RR.Daily.recordAttempt(summary.distance); } catch (e) { reportError(e, 'Daily.recordAttempt'); }
    }
    setState('results');
    needsRender = true;
    if (RR.Input) { RR.Input.setActive(false); RR.Input.reset(); }
    if (RR.HUD) RR.HUD.show(false);
    if (RR.Audio) safe(() => { RR.Audio.engineStop(); RR.Audio.duck(true); }, 'audio end');
    if (RR.UI) RR.UI.showResults(summary, rewards, dailyResult);
  }

  function pause() {
    if (state !== 'playing') return false;
    setState('paused');
    needsRender = true;
    if (RR.Input) { RR.Input.setActive(false); RR.Input.reset(); }
    if (RR.Audio) safe(() => { RR.Audio.duck(true); RR.Audio.engineStop(); }, 'audio pause');
    if (RR.HUD) RR.HUD.show(false);
    if (RR.UI) RR.UI.show('pause');
    return true;
  }

  function resume() {
    if (state !== 'paused' || !run) return false;
    if (RR.UI && RR.UI.modalOpen) return false;
    setState('playing');
    lastTs = 0;
    if (RR.UI) RR.UI.show(null);
    if (RR.HUD) RR.HUD.show(true);
    if (RR.Input) { RR.Input.reset(); RR.Input.setActive(true); }
    blurActive();
    if (RR.Audio) {
      safe(() => {
        RR.Audio.duck(false);
        const style = (run.tuned && run.tuned.style) || (run.vehicleDef && run.vehicleDef.style);
        if (run.state === 'running' && style) RR.Audio.engineStart(style);
      }, 'audio resume');
    }
    return true;
  }

  function restart() {
    if (!lastParams) return false;
    if (state !== 'playing' && state !== 'paused' && state !== 'results' && state !== 'tutorial') return false;
    const p = { worldId: lastParams.worldId, vehicleId: lastParams.vehicleId, daily: null };
    if (lastParams.daily) {
      // same day → same challenge; after midnight the retry plays the new day's challenge
      p.daily = safe(() => RR.Daily.getChallenge(), 'Daily.getChallenge') || lastParams.daily;
      p.worldId = p.daily.worldId;
    }
    return startRun(p);
  }

  function quitRun() {
    const r = run;
    if (!r || runEnded) return false;
    safe(() => { if (typeof r.quit === 'function') r.quit(); }, 'run.quit');
    if (!runEnded && run === r) {
      // Run may end on its next update; end right away with its summary (onEnd later is ignored).
      let summary = safe(() => (typeof r.getSummary === 'function' ? r.getSummary() : null), 'run.getSummary');
      if (summary && typeof summary === 'object') summary.endReason = 'quit';
      endRun(summary);
    }
    return true;
  }

  function quitToMenu(screenId) {
    destroyRun();
    setState('menu');
    if (RR.Input) { RR.Input.setActive(false); RR.Input.reset(); }
    if (RR.HUD) RR.HUD.show(false);
    if (RR.Audio) safe(() => { RR.Audio.engineStop(); RR.Audio.duck(false); }, 'audio menu');
    setMusic('menu');
    startAttract();
    lastTs = 0;
    if (RR.UI) RR.UI.show(screenId || 'menu');
  }

  function toggleMute() {
    const s = settings();
    const anyOn = !!(s.sound || s.music);
    RR.Save.updateSettings({ sound: !anyOn, music: !anyOn });     // → Bus 'settings' → applySettings
    toast(anyOn ? 'Sound muted — press M to unmute' : 'Sound on', anyOn ? 'mute' : 'unmute', 1800);
  }

  function blurActive() {
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
  }

  // ---------------------------------------------------------------- loop
  function renderFrozen() {
    const r = run || attract;
    if (r && typeof r.render === 'function') {
      try { r.render(); } catch (e) { reportError(e, 'render'); }
    } else {
      drawFallback(0);
    }
  }

  function step(dt) {
    switch (state) {
      case 'playing': {
        const r = run;
        if (!r) { quitToMenu('menu'); return; }
        try {
          r.update(dt);
          runErrorStreak = 0;
        } catch (e) {
          runErrorStreak++;
          reportError(e, 'run.update');
          if (runErrorStreak >= RUN_ERROR_LIMIT) {
            log('run', 'abandoned after repeated errors');
            quitToMenu('menu');
            return;
          }
        }
        if (run !== r) return;                                   // restarted / quit inside update
        try { r.render(); } catch (e) { reportError(e, 'run.render'); }
        if (state === 'playing' && RR.HUD) RR.HUD.update(r, dt);
        break;
      }
      case 'paused':
      case 'tutorial':
      case 'results':
        if (needsRender) { needsRender = false; renderFrozen(); }
        break;
      case 'menu':
        if (attract) {
          try {
            attract.update(dt);
            frameMenuCamera(attract, dt);
            attract.render();
          } catch (e) {
            attractErrors++;
            if (attractErrors === 1) log('attract', e);
            if (attractErrors >= ATTRACT_ERROR_LIMIT) destroyAttract();
          }
        } else {
          drawFallback(dt);
        }
        break;
      default:
        break;
    }
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);                       // schedule first: an exception can't stop the loop
    const now = typeof ts === 'number' && ts > 0 ? ts : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let dt = lastTs ? (now - lastTs) / 1000 : 1 / 60;
    lastTs = now;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    frame++;
    try { step(dt); } catch (e) { reportError(e, 'frame'); }
    if (RR.UI) { try { RR.UI.update(dt); } catch (e) { reportError(e, 'UI.update'); } }
  }

  // ---------------------------------------------------------------- wiring
  function wireInput() {
    const I = RR.Input;
    if (!I) return;
    I.on('pause', (p) => {
      const esc = p && p.key === 'Escape';
      if (RR.UI && RR.UI.modalOpen) { if (esc) RR.UI.back(); return; }
      if (state === 'playing') { pause(); return; }
      if (state === 'paused') {
        if (RR.UI && RR.UI.current === 'pause') resume();
        else if (esc && RR.UI) RR.UI.back();                  // e.g. Settings opened from the pause menu
        return;
      }
      if (esc && RR.UI && state !== 'tutorial') RR.UI.back();
    });
    I.on('restart', () => {
      if (RR.UI && RR.UI.modalOpen) return;
      if (state === 'playing' || state === 'paused' || state === 'results') restart();
    });
    I.on('mute', () => { if (booted) toggleMute(); });
    I.on('firstGesture', initAudio);
    I.on('touch', updateTouchVisibility);
  }

  function wireWindow() {
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', () => { scheduleResize(); setTimeout(doResize, 350); });
    if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', scheduleResize);
    if (typeof ResizeObserver === 'function' && canvas) {
      try { new ResizeObserver(scheduleResize).observe(canvas); } catch (e) { /* optional */ }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state === 'playing') pause();
        if (RR.Audio) safe(() => RR.Audio.suspend(), 'Audio.suspend');
      } else {
        lastTs = 0;
        if (RR.Audio) safe(() => RR.Audio.resume(), 'Audio.resume');
        needsRender = true;
      }
    });
    window.addEventListener('blur', () => { if (state === 'playing') pause(); });
    // Keep the page from scrolling/zooming under the game on touch devices.
    if (canvas) {
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    }
  }

  function wireBus() {
    if (!RR.Bus) return;
    RR.Bus.on('settings', (p) => applySettings((p && p.settings) || settings()));
    RR.Bus.on('saveReset', () => {
      safe(() => RR.Missions.ensureToday(), 'Missions.ensureToday');
      applySettings(settings());
      if (run) quitToMenu('menu');
      else if (state === 'menu') startAttract();
    });
  }

  function hideSplash() {
    document.body.classList.remove('booting');
    const sp = document.getElementById('boot-splash');
    if (sp) setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 700);
  }

  function boot() {
    if (booted) return;
    booted = true;
    canvas = document.getElementById('game-canvas');
    safe(() => RR.Save.load(), 'Save.load');
    safe(() => RR.Missions.ensureToday(), 'Missions.ensureToday');
    if (RR.Input) RR.Input.init();
    if (RR.Renderer && canvas) {
      try { renderer = new RR.Renderer(canvas); } catch (e) { log('Renderer', e); renderer = null; }
    }
    if (RR.HUD) safe(() => RR.HUD.init(), 'HUD.init');
    if (RR.UI) safe(() => RR.UI.init(Game), 'UI.init');
    wireInput();
    wireWindow();
    wireBus();
    applySettings(settings());
    startAttract();
    setState('menu');
    if (RR.HUD) RR.HUD.show(false);
    if (RR.UI) RR.UI.show('menu');
    setMusic('menu');
    if (RR.Save.recovered) toast(RR.Save.restoredFromBackup ? 'Your save was damaged and has been restored from a backup.' : 'Your save data was unreadable and has been reset.', 'error', 5000);
    if (!RR.Run) console.warn('[RR.Game] RR.Run is not loaded — menu shows a static backdrop and runs cannot start.');
    lastTs = 0;
    rafId = requestAnimationFrame(loop);
    hideSplash();
  }

  const Game = {
    boot,
    startRun,
    endRun,
    pause,
    resume,
    restart,
    quitRun,
    quitToMenu,
    refreshAttract,
    toggleMute,
    applySettings
  };
  Object.defineProperties(Game, {
    state: { get: () => state, enumerable: true },
    frame: { get: () => frame, enumerable: true },
    run: { get: () => run, enumerable: true },
    attract: { get: () => attract, enumerable: true },
    renderer: { get: () => renderer, enumerable: true },
    lastParams: { get: () => lastParams, enumerable: true },
    errors: { get: () => errorCount, enumerable: true },
    rafId: { get: () => rafId, enumerable: true }
  });
  RR.Game = Game;

  // Boot only on a real game page (the node test harness has no #game-canvas, so loading this file
  // there defines RR.Game without starting a loop).
  function autoBoot() {
    if (document.getElementById && document.getElementById('game-canvas')) boot();
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot, { once: true });
    else setTimeout(autoBoot, 0);
  }
})();
