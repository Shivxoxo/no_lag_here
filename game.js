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
 *  - Resize: the canvas ResizeObserver resizes synchronously (it fires once per frame, before paint) and
 *    redraws the current frame, so the canvas is never shown stretched during a drag / rotation; window
 *    resize / visualViewport / orientationchange remain as debounced fallbacks → renderer.resize() →
 *    camera.setViewport for the active and attract runs.
 *  - Menu attract: full-rate drive only behind the title screen; behind the other (opaque, blurred)
 *    menu screens the attract is frozen and re-rendered only on screen change / resize / settings.
 *  - Hotkeys via RR.Input: P/Esc pause toggle (Esc = back in menus / closes modals), R restart
 *    (playing / paused / results), M mute (sound + music, persisted, toast).
 *  - Runs are banked exactly once: endRun = bankRun (Progression.applyRunResults + Daily.recordAttempt
 *    with the run's own challenge day) + the results UI. R / pause RESTART mid-run (also on the CRASHED
 *    stamp or while coasting out of fuel) banks the run first, then starts the next one (toasting the
 *    banked coins / record and a daily challenge completed by that run).
 *  - Audio: RR.Audio.init() on Input 'firstGesture', then settings + current music are applied.
 *
 * Contract additions (documented, never renames):
 *  - quitRun()          — pause-menu QUIT: run.quit() → results (collected coins still count; the run's
 *                         own end reason — crash / fuel / quit — is kept).
 *  - quitToMenu(screen, params) — optional screen id (+ params for RR.UI.show) to land on
 *                         (results → GARAGE uses 'garage', {from:'results'}).
 *  - requestRender()    — redraw the frozen frame / menu backdrop on the next frame.
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
  let menuScreenSeen = null;           // RR.UI.current last seen by the menu branch of step()
  let fullFrame = false;               // this frame drew a continuously animated scene (run / title attract)
  let qualityHintShown = false;

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
    cl.toggle('q-auto', s.quality === 'auto');
    applyQualityClass(renderer && renderer.quality ? renderer.quality : (s.quality === 'auto' ? 'high' : s.quality || 'high'));
    updateTouchVisibility();
    needsRender = true;
  }

  // body.q-* follows the quality actually rendered ('auto' may step it down), so the CSS drops the
  // backdrop blur together with the canvas quality.
  function applyQualityClass(q) {
    const cl = document.body.classList;
    const want = 'q-' + (q === 'low' || q === 'medium' ? q : 'high');
    if (cl.contains(want)) return;
    cl.remove('q-low', 'q-medium', 'q-high');
    cl.add(want);
  }

  // A fixed quality that is still slow at the lowest render scale: suggest a lower setting (once).
  function checkQualityHint() {
    if (qualityHintShown || !renderer || !renderer.suggestedQuality) return;
    qualityHintShown = true;
    const q = renderer.suggestedQuality === 'low' ? 'LOW' : 'MED';
    toast('Running slowly on this device — try Graphics: ' + q + ' in Settings', 'info', 4200);
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
    if (!renderer) return false;
    const changed = !!safe(() => renderer.resize(), 'renderer.resize');
    syncViewports();
    menuTargetFor = '';
    needsRender = true;
    if (RR.UI && RR.UI.onResize) safe(() => RR.UI.onResize(), 'UI.onResize');
    return changed;
  }
  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = 0; doResize(); }, 90);
  }
  // ResizeObserver path: runs after this frame's rAF callback and before paint. Resizing the backing
  // store clears the canvas, so the current frame is redrawn right away at the new size.
  function onCanvasResize() {
    if (!doResize()) return;
    renderNow();
  }
  function renderNow() {
    if (state === 'playing' && run) {
      try { run.render(); } catch (e) { reportError(e, 'run.render'); }
    } else if (state === 'menu') {
      needsRender = false;
      if (attract) { try { attract.render(); } catch (e) { attractErrors++; } } else drawFallback(0);
    } else if (state !== 'boot') {
      needsRender = false;
      renderFrozen();
    }
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
      needsRender = true;
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
    if (typeof renderer.flushResize === 'function') renderer.flushResize();   // pending step change (qa2-3)
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
    // missions roll over at midnight on their own; this just makes the first track() of the run cheap
    if (RR.Missions && RR.Missions.ensureToday) safe(() => RR.Missions.ensureToday(), 'Missions.ensureToday');
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
    // dynamic resolution: every run re-tries one step higher, so a hitch never lowers it for good (qa2-1)
    if (typeof renderer.nudgeUp === 'function') safe(() => renderer.nudgeUp(), 'renderer.nudgeUp');
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

  // Apply a finished run's rewards (coins, XP, records, stats) and, for a daily run, record the attempt
  // against the challenge the run was STARTED for (a run that ends after midnight is expired, never
  // credited to the new day's challenge). Callers guarantee once-per-run through runEnded.
  function bankRun(summary) {
    let rewards = null;
    let dailyResult = null;
    if (!summary) return { rewards, dailyResult };
    try { rewards = RR.Progression.applyRunResults(summary); } catch (e) { reportError(e, 'applyRunResults'); }
    const daily = lastParams && lastParams.daily;
    if (summary.mode === 'daily' || daily) {
      const day = summary.dailyDay || (daily && daily.day) || undefined;
      try { dailyResult = RR.Daily.recordAttempt(summary.distance, day); } catch (e) { reportError(e, 'Daily.recordAttempt'); }
    }
    return { rewards, dailyResult };
  }

  function fallbackSummary() {
    return { worldId: lastParams && lastParams.worldId, vehicleId: lastParams && lastParams.vehicleId, mode: lastParams && lastParams.daily ? 'daily' : 'normal',
      distance: 0, coins: 0, endReason: 'quit', dailyDay: lastParams && lastParams.daily ? lastParams.daily.day || null : null };
  }

  function endRun(summary) {
    if (runEnded || !run) return;                              // exactly once per run
    runEnded = true;
    const r = run;
    if (!summary && r && typeof r.getSummary === 'function') summary = safe(() => r.getSummary(), 'run.getSummary');
    summary = summary || fallbackSummary();
    const { rewards, dailyResult } = bankRun(summary);
    setState('results');
    needsRender = true;
    if (RR.Input) { RR.Input.setActive(false); RR.Input.reset(); }
    if (RR.HUD) RR.HUD.show(false);
    if (RR.Audio) safe(() => { RR.Audio.engineStop(); RR.Audio.duck(true); }, 'audio end');
    if (RR.UI) RR.UI.showResults(summary, rewards, dailyResult, lastParams && lastParams.daily);
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

  // Bank the live run (R / pause RESTART mid-run, also on the CRASHED stamp and while coasting out of
  // fuel): the run ends through run.quit() (keeps crash / fuel as the end reason and flushes its mission
  // distance) with runEnded already set, so its onEnd → endRun is ignored and no results screen shows.
  function bankLiveRun() {
    const r = run;
    if (!r || runEnded || (state !== 'playing' && state !== 'paused')) return null;
    runEnded = true;
    safe(() => { if (typeof r.quit === 'function') r.quit(); }, 'run.quit');
    let s = safe(() => (typeof r.getSummary === 'function' ? r.getSummary() : null), 'run.getSummary');
    if (!s || typeof s !== 'object') s = fallbackSummary();
    if (!s.endReason) s.endReason = r.state === 'crashed' ? 'crash' : r.state === 'nofuel' ? 'fuel' : 'quit';
    // an empty run (restarted before it went anywhere) has nothing to keep — don't count it as a run
    const empty = Math.floor(Number(s.distance) || 0) <= 0 && !((s.coins | 0) + (s.bonusCoins | 0) + (s.tokens | 0));
    if (empty) return null;
    const res = bankRun(s);
    const rw = res.rewards;
    if (rw && !rw.ignored) {
      const U = RR.Util;
      const parts = [];
      if (rw.totalCoins > 0) parts.push('+' + U.formatInt(rw.totalCoins) + ' coins banked');
      const dist = Math.floor(Number(s.distance) || 0);
      if (rw.newWorldRecord && (rw.previousBest || 0) >= 50) parts.push('new best ' + U.formatInt(dist) + ' m');
      else if (rw.newDailyBest) parts.push('best today ' + U.formatInt(dist) + ' m');
      if (parts.length) toast(parts.join(' · '), 'reward', 2600);
    }
    // the results screen (skipped on R) normally announces a completed daily; its level-up (if any) is
    // already queued through RR.Bus 'levelup' like every other level-up (qa2-8)
    const dr = res.dailyResult;
    if (dr && dr.completedNow && dr.reward) {
      const U = RR.Util, rw = dr.reward;
      let msg = 'Daily challenge complete! +' + U.formatInt(rw.coins || 0) + ' coins';
      if (rw.xp) msg += ' · +' + U.formatInt(rw.xp) + ' XP';
      if (rw.tokens) msg += ' · +' + U.formatInt(rw.tokens) + (rw.tokens === 1 ? ' token' : ' tokens');
      toast(msg, 'daily', 3200);
    }
    return res;
  }

  function restart() {
    if (!lastParams) return false;
    if (state !== 'playing' && state !== 'paused' && state !== 'results' && state !== 'tutorial') return false;
    bankLiveRun();
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
      if (summary && typeof summary === 'object' && !summary.endReason) summary.endReason = 'quit';
      endRun(summary);
    }
    return true;
  }

  function quitToMenu(screenId, params) {
    destroyRun();
    setState('menu');
    if (RR.Input) { RR.Input.setActive(false); RR.Input.reset(); }
    if (RR.HUD) RR.HUD.show(false);
    if (RR.Audio) safe(() => { RR.Audio.engineStop(); RR.Audio.duck(false); }, 'audio menu');
    setMusic('menu');
    startAttract();
    lastTs = 0;
    if (RR.UI) RR.UI.show(screenId || 'menu', params);
  }

  function requestRender() { needsRender = true; }

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
        try { r.render(); fullFrame = true; } catch (e) { reportError(e, 'run.render'); }
        checkQualityHint();
        if (state === 'playing' && RR.HUD) RR.HUD.update(r, dt);
        break;
      }
      case 'paused':
      case 'tutorial':
      case 'results':
        if (needsRender) { needsRender = false; renderFrozen(); }
        break;
      case 'menu': {
        // Full-rate attract drive only behind the title screen. The other menu screens are opaque,
        // blurred panels: the attract freezes there and is redrawn only when something changed
        // (screen switch, resize, settings, new attract run) — no per-frame sim, draw or blur recompute.
        const scr = RR.UI ? RR.UI.current : 'menu';
        if (scr !== menuScreenSeen) { menuScreenSeen = scr; needsRender = true; }
        const live = scr === 'menu' || !scr;
        if (!live && !needsRender) break;
        needsRender = false;
        if (attract) {
          try {
            if (live) { attract.update(dt); frameMenuCamera(attract, dt); }
            attract.render();
            if (live) fullFrame = true;
          } catch (e) {
            attractErrors++;
            if (attractErrors === 1) log('attract', e);
            if (attractErrors >= ATTRACT_ERROR_LIMIT) destroyAttract();
          }
        } else {
          drawFallback(live ? dt : 0);
        }
        break;
      }
      default:
        break;
    }
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);                       // schedule first: an exception can't stop the loop
    const now = typeof ts === 'number' && ts > 0 ? ts : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const rawMs = lastTs ? now - lastTs : 0;
    let dt = lastTs ? (now - lastTs) / 1000 : 1 / 60;
    lastTs = now;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;
    frame++;
    fullFrame = false;
    try { step(dt); } catch (e) { reportError(e, 'frame'); }
    // Dynamic resolution: feed the real presented-frame interval of continuously drawn frames only
    // (frozen / on-demand frames would read as fast and make the ladder step back up).
    if (fullFrame && rawMs > 0 && renderer && typeof renderer.reportFrameTime === 'function') {
      safe(() => renderer.reportFrameTime(rawMs), 'renderer.reportFrameTime');
    }
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
      try { new ResizeObserver(onCanvasResize).observe(canvas); } catch (e) { /* optional */ }
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
      if (renderer) renderer.onQualityHint = (q) => { applyQualityClass(q); };
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
    applySettings,
    requestRender
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
