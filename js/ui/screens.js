/* RIDGE RUSH — menus & screens (RR.UI).
 *
 * Contract §6.4. Screens: menu vehicles garage worlds missions daily settings pause results, plus the
 * confirm modal, level-up modal, first-run tutorial and toasts (via RR.HUD.toast).
 *
 * Structure
 *  - Every screen is built ONCE into #ui (markup + cached refs); show() only refreshes its contents.
 *  - One delegated click handler on #ui / #modal-root dispatches on [data-act] (+ [data-arg]).
 *  - Hidden screens are `inert` (no focus / clicks); transitions are CSS (fade + scale/slide).
 *  - RR.UI.update(dt) is called by the Game loop every frame: animated wallet counters, vehicle preview
 *    canvases (only on the visible screen, throttled to ~30 fps, canvases reused, off-screen cards skipped
 *    via IntersectionObserver), countdowns (text written once per second), results count-ups.
 *  - World thumbnails are rendered once per size (RR.Background.drawThumbnail caches them too).
 *
 * Contract additions (documented, never renames):
 *  - showResults(summary, rewards, dailyResult?, challenge?) — dailyResult from RR.Daily.recordAttempt for
 *    daily runs; challenge = the DailyChallenge the run was started for (the results panel describes that
 *    run's challenge, and says so when it expired at midnight).
 *  - Level-ups earned while leaving results early (or from runs banked by R) stay pending and are shown
 *    on the next menu screen / results screen — never turned into a mid-run toast.
 *  - Garage footer: START RUN (RIDE AGAIN when opened from results) · vehicle select card: UPGRADE
 *    (garage with {from:'vehicles'}); garage BACK returns where it came from. CONVERT TOKENS appears in
 *    the garage once RR.Progression.tokenSinkStatus().available.
 *  - Toasts for Bus 'saveError' (once) and 'missionAutoClaim'.
 *  - Settings → Graphics shows an AUTO choice when RR.Save accepts quality 'auto' (feature-detected).
 *  - back()               — Esc / back button behaviour (closes the open modal first).
 *  - update(dt), onResize(), refresh() — called by the Game.
 *  - showTutorial(onDone) — first-run controls overlay (sets save.seenTutorial).
 *  - modalOpen (getter), toast(text, kind) → RR.HUD.toast.
 *  The Game object passed to init() is expected to provide: startRun(params), resume(), restart(),
 *  quitRun() (pause → QUIT: ends the run through run.quit() so collected coins count),
 *  quitToMenu(screenId?, params?), refreshAttract(), state, lastParams.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  // ---------------------------------------------------------------- helpers
  const icon = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"></use></svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const fmt = (n) => U.formatInt(num(n, 0));
  const S = () => RR.Save.data;
  const play = (name, opts) => { if (RR.Audio) RR.Audio.play(name, opts); };
  const toast = (text, kind, ms) => { if (RR.HUD && RR.HUD.toast) RR.HUD.toast(text, kind, ms); };
  const raf = (f) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function collectRefs(root) {
    const o = {};
    const list = root.querySelectorAll('[data-ref]');
    for (let i = 0; i < list.length; i++) o[list[i].getAttribute('data-ref')] = list[i];
    return o;
  }
  function stars(n, max) {
    let h = '<span class="stars" aria-label="Difficulty ' + n + ' of ' + max + '">';
    for (let i = 1; i <= max; i++) h += icon('xp', i <= n ? 'on' : 'off');
    return h + '</span>';
  }
  function rewardChips(r) {
    if (!r) return '';
    let h = '';
    if (r.coins > 0) h += '<span class="rchip rc-coins">' + icon('coin') + fmt(r.coins) + '</span>';
    if (r.xp > 0) h += '<span class="rchip rc-xp">' + icon('xp') + fmt(r.xp) + ' XP</span>';
    if (r.tokens > 0) h += '<span class="rchip rc-token">' + icon('token') + r.tokens + '</span>';
    return h;
  }
  const dpr = () => Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);

  // Fit a canvas' backing store to its CSS box (layout read — only on show / resize).
  function fitCanvas(c) {
    if (!c) return false;
    // clientWidth/Height = layout size, unaffected by the screen's entrance transform (scale).
    let w = c.clientWidth, h = c.clientHeight;
    if (!(w > 0) || !(h > 0)) { const r = c.getBoundingClientRect(); w = r.width; h = r.height; }
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const d = dpr();
    const bw = Math.round(w * d), bh = Math.round(h * d);
    const changed = c.width !== bw || c.height !== bh || c._cssW !== w || c._cssH !== h;
    if (changed) { c.width = bw; c.height = bh; }
    c._cssW = w; c._cssH = h; c._dpr = d;
    return changed;
  }

  // Icon maps (mission / daily icons in the data are emoji — the UI uses its own SVG set).
  const MISSION_ICONS = {
    total_distance: 'road', run_distance: 'flag', world_distance: 'pin', coins: 'coin', backflips: 'rot-ccw',
    frontflips: 'rot-cw', double_flips: 'doubleflip', tricks: 'xp', perfect_landings: 'target', fuel: 'fuel',
    airtime: 'parachute', wheelie: 'wheelie', combo: 'boost', powerups: 'bolt', boss: 'mountain', daily: 'daily'
  };
  const DAILY_ICONS = {
    low_gravity: 'feather', no_fuel: 'fuel', max_speed: 'speed', extreme_hills: 'mountain', ice: 'snow',
    coin_rush: 'coins', storm_winds: 'wind', heavy_gravity: 'weight', chaos: 'dice'
  };
  const UPGRADE_ICONS = { engine: 'engine', suspension: 'suspension', tires: 'tires', fuel: 'fuel', grip: 'grip', air: 'air', brakes: 'brakes' };
  const REWARD_ICONS = { vehicle: 'car', world: 'worlds', upgradeTier: 'arrow-up', cosmetic: 'paint', coins: 'coin', tokens: 'token' };
  // Screens that may show a queued level-up modal on arrival (menu screens; results decides itself).
  const LEVELUP_SCREENS = { menu: 1, garage: 1, vehicles: 1, worlds: 1, missions: 1, daily: 1 };
  const RECORD_MIN_PREV = 50;            // same rule as the in-run banner (run.js) and record XP
  const MODAL_GUARD_MS = 350;            // a backdrop tap this soon after opening is the same double-tap
  const isTouchUi = () => !!(document.body && document.body.classList.contains('touch-device'));
  // 'auto' graphics needs RR.Save to accept it (otherwise sanitize would reset it to 'high').
  function saveAcceptsAutoQuality() {
    try { return RR.Save.sanitize({ settings: { quality: 'auto' } }).settings.quality === 'auto'; } catch (e) { return false; }
  }
  const STATS = [['speed', 'SPEED'], ['accel', 'ACCEL'], ['grip', 'GRIP'], ['suspension', 'SUSP'], ['air', 'AIR'], ['fuel', 'FUEL'], ['stability', 'STABLE']];
  const CRASH_TEXT = {
    head: 'Head over heels', headHit: 'Head over heels', head_hit: 'Head over heels', flip: 'Landed on the roof',
    flipped: 'Landed on the roof', upside: 'Stuck upside down', upsideDown: 'Stuck upside down', upside_down: 'Stuck upside down',
    stuck: 'Stuck upside down', lava: 'Melted in lava', rock: 'Flattened by a rock', rocks: 'Flattened by a rock',
    meteor: 'Hit by a meteor', drone: 'Zapped by a drone', lightning: 'Struck by lightning', ceiling: 'Hit the ceiling'
  };
  // One coaching line under a crash reason for new players (first 10 runs) — qa2-12.
  function coachLine(s) {
    let runs = 0;
    try { runs = num(S().stats.runs, 0); } catch (e) { runs = 0; }
    if (runs > 10) return '';
    const touch = isTouchUi();
    const rel = num(s.crashRel, 0);
    switch (s.crashReason) {
      case 'head': case 'headHit': case 'head_hit':
        return rel < 0
          ? (touch ? 'Nose-dived — hold ↺ TILT to lift the nose before landing' : 'Nose-dived — hold W / ↺ to lift the nose before landing')
          : (touch ? 'Over-rotated — ease off the gas / tap ↻ TILT in the air' : 'Over-rotated — ease off the gas / tap S in the air');
      case 'rock': case 'rocks':
        return 'Falling rocks: slow down and let them land first';
      case 'flipped':
        return s.crashPose === 'tail' ? (touch ? 'Ease off ↺ TILT on the ground' : 'Ease off W on the ground') : '';
      case 'lava':
        return 'Build speed before lava pools';
      default:
        return '';
    }
  }

  // pose-aware caption shared with the HUD stamp (qa2-11); own map as the fallback
  const crashText = (r, pose) => {
    if (r && RR.HUD && typeof RR.HUD.crashText === 'function') return RR.HUD.crashText(r, pose);
    return r ? CRASH_TEXT[r] || String(r).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Wipe out';
  };

  // ---------------------------------------------------------------- module state
  const SCREEN_DEFS = [];
  function define(def) { SCREEN_DEFS.push(def); }
  let game = null;
  let initialized = false;
  let uiRoot = null, modalRoot = null;
  const screens = Object.create(null);
  let current = null;
  let io = null;                         // IntersectionObserver for preview canvases
  let previewAcc = 0, previewClock = 0;
  let secondAcc = 1;                     // countdown refresh accumulator
  const wallet = { coins: 0, tokens: 0, snapped: false };
  const tweens = [];
  let tickAcc = 0;
  let pendingLevelUps = [];
  let reducedMq = null;

  function reduced() {
    const s = S() && S().settings;
    return !!(s && s.reducedMotion) || !!(reducedMq && reducedMq.matches);
  }

  // ---------------------------------------------------------------- shared markup
  function walletHtml() {
    return '<div class="wallet">' +
      '<span class="chip chip-coins" title="Coins">' + icon('coin') + '<b data-bind="coins">0</b></span>' +
      '<span class="chip chip-tokens" title="Unlock tokens">' + icon('token') + '<b data-bind="tokens">0</b></span>' +
    '</div>';
  }
  function header(title, iconId, opts) {
    opts = opts || {};
    return '<header class="scr-head">' +
      '<button type="button" class="btn-back" data-act="back" aria-label="Back">' + icon('back') + '<span>BACK</span></button>' +
      '<h2 class="scr-title">' + (iconId ? icon(iconId) : '') + '<span>' + title + '</span></h2>' +
      (opts.wallet === false ? '<span class="head-spacer"></span>' : walletHtml()) +
    '</header>';
  }
  function statBars(prefix) {
    let h = '<div class="stat-bars">';
    for (const [k, label] of STATS) {
      h += '<div class="stat"><span class="stat-name">' + label + '</span><span class="stat-track"><i data-ref="' + prefix + k + '"></i></span></div>';
    }
    return h + '</div>';
  }
  function fillStats(refs, prefix, stats) {
    for (const [k] of STATS) {
      const bar = refs[prefix + k];
      if (!bar) continue;
      const v = U.clamp(num(stats && stats[k], 0) / 10, 0.02, 1);
      bar.style.transform = 'scaleX(' + v.toFixed(3) + ')';
    }
  }
  function levelBadgeHtml() {
    return '<span class="lvl-hex"><b data-bind="level">1</b></span>' +
      '<span class="lvl-info"><small class="lvl-cap">LEVEL <b data-bind="level">1</b></small>' +
      '<span class="xpbar"><i data-bind="xpbar"></i></span>' +
      '<small class="lvl-xp" data-bind="xptext">0 / 200 XP</small></span>';
  }

  // ---------------------------------------------------------------- screen registry
  // Each screen: { id, build(el), show(params), hide(), update(dt), back(), canvases[] }
  function register(def) {
    const node = el('<section class="screen scr-' + def.id + '" data-screen="' + def.id + '" aria-hidden="true"></section>');
    uiRoot.appendChild(node);
    def.el = node;
    def.canvases = def.canvases || [];
    def.build(node);
    def.refs = Object.assign(collectRefs(node), def.refs || {});
    def.binds = collectBinds(node);
    setInert(node, true);
    screens[def.id] = def;
  }
  function collectBinds(root) {
    const b = { coins: [], tokens: [], level: [], xpbar: [], xptext: [] };
    const list = root.querySelectorAll('[data-bind]');
    for (let i = 0; i < list.length; i++) {
      const k = list[i].getAttribute('data-bind');
      if (b[k]) b[k].push(list[i]);
    }
    return b;
  }
  function setInert(node, on) {
    node.classList.toggle('active', !on);
    node.setAttribute('aria-hidden', on ? 'true' : 'false');
    try { node.inert = on; } catch (e) { /* older browsers: visibility handles it */ }
  }

  function show(id, params) {
    if (!initialized) return;
    params = params || {};
    const prev = current ? screens[current] : null;
    const next = id ? screens[id] : null;
    if (id && !next) { console.warn('[RR.UI] unknown screen', id); return; }
    if (prev && prev !== next) {
      try { if (prev.hide) prev.hide(); } catch (e) { console.error('[RR.UI] hide failed', e); }
      const active = document.activeElement;
      if (active && prev.el.contains(active) && active.blur) active.blur();
      setInert(prev.el, true);
    }
    current = id || null;
    document.body.classList.toggle('ui-open', !!current);
    if (document.body.dataset) document.body.dataset.screen = current || 'none';
    // gameplay (no screen): pending level-ups stay queued for the next results / menu screen
    if (!next) return;
    wallet.snapped = false;
    try { next.show(params); } catch (e) { console.error('[RR.UI] show ' + id + ' failed', e); }
    refreshBinds(next, true);
    setInert(next.el, false);
    secondAcc = 1;
    previewAcc = 1;
    // canvas sizes depend on layout: fit after the screen is laid out
    raf(() => { if (current === id) { fitScreenCanvases(next); drawPreviews(next, true); } });
    if (params.focus !== false) raf(() => focusPrimary(next));
    if (LEVELUP_SCREENS[id] && pendingLevelUps.length) {
      setTimeout(() => { if (current === id) flushLevelUps(); }, 350);
    }
  }

  function focusPrimary(scr) {
    if (!scr || current !== scr.id || document.querySelector('.modal.open')) return;
    const target = scr.el.querySelector('[data-autofocus]:not([aria-disabled="true"])');
    if (target && target.focus) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
  }

  // ---------------------------------------------------------------- bindings (wallet, level)
  function refreshBinds(scr, snap) {
    if (!scr) return;
    const d = S();
    if (snap || !wallet.snapped) { wallet.coins = d.coins; wallet.tokens = d.tokens; wallet.snapped = true; }
    writeWallet(scr);
    const info = RR.Progression.levelInfo();
    for (const n of scr.binds.level) n.textContent = String(info.level);
    for (const n of scr.binds.xpbar) n.style.transform = 'scaleX(' + U.clamp(info.progress, 0, 1).toFixed(3) + ')';
    const xpText = info.isMax ? 'MAX LEVEL' : fmt(info.xpInto) + ' / ' + fmt(info.xpNext) + ' XP';
    for (const n of scr.binds.xptext) n.textContent = xpText;
  }
  function writeWallet(scr) {
    const c = fmt(Math.round(wallet.coins)), t = fmt(Math.round(wallet.tokens));
    for (const n of scr.binds.coins) if (n.textContent !== c) n.textContent = c;
    for (const n of scr.binds.tokens) if (n.textContent !== t) n.textContent = t;
  }
  function animateWallet(dt, scr) {
    const d = S();
    let changed = false;
    for (const k of ['coins', 'tokens']) {
      const target = d[k];
      const cur = wallet[k];
      if (cur === target) continue;
      const diff = target - cur;
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * Math.min(1, dt * 7));
      wallet[k] = Math.abs(step) >= Math.abs(diff) ? target : cur + step;
      changed = true;
    }
    if (changed) writeWallet(scr);
  }
  function bumpWallet(scr) {
    if (!scr || reduced()) return;
    const chips = scr.el.querySelectorAll('.chip-coins, .coins-banner');
    for (let i = 0; i < chips.length; i++) {
      if (chips[i].animate) chips[i].animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    }
  }

  // ---------------------------------------------------------------- preview canvases
  function registerPreview(scr, canvas, kind, id) {
    const p = { canvas, ctx: null, kind, id, visible: true };
    try { p.ctx = canvas.getContext('2d'); } catch (e) { p.ctx = null; }
    canvas._preview = p;
    scr.canvases.push(p);
    if (io) io.observe(canvas);
    return p;
  }
  function fitScreenCanvases(scr) {
    if (!scr) return;
    for (const p of scr.canvases) {
      if (fitCanvas(p.canvas)) p.drawn = false;
    }
  }
  function drawPreviews(scr, force) {
    if (!scr) return;
    for (const p of scr.canvases) {
      if (!p.ctx || !p.canvas._cssW) continue;
      if (p.kind === 'thumb') {
        if (p.drawn && !force) continue;
        if (!p.visible && !force) continue;
        drawThumb(p);
      } else if (p.visible || force) {
        drawVehicle(p);
      }
    }
  }
  function drawThumb(p) {
    const c = p.canvas, ctx = p.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);          // thumbnails are painted at backing-store resolution
    try {
      if (RR.Background && RR.Background.drawThumbnail) RR.Background.drawThumbnail(ctx, c.width, c.height, p.id);
      else { ctx.fillStyle = '#22304f'; ctx.fillRect(0, 0, c.width, c.height); }
    } catch (e) { ctx.fillStyle = '#22304f'; ctx.fillRect(0, 0, c.width, c.height); }
    p.drawn = true;
  }
  function drawVehicle(p) {
    const c = p.canvas, ctx = p.ctx, d = c._dpr || 1;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, c._cssW, c._cssH);
    if (!RR.VehicleArt || !RR.VehicleArt.drawPreview) return;
    const vid = typeof p.id === 'function' ? p.id() : p.id;
    try {
      if (!p.paint || p.paintFor !== vid || p.paintStamp !== paintStamp) {
        p.paint = RR.Progression.getPaint(vid);
        p.paintFor = vid;
        p.paintStamp = paintStamp;
      }
      RR.VehicleArt.drawPreview(ctx, vid, p.paint, c._cssW, c._cssH, previewClock + (p.phase || 0));
    } catch (e) { /* preview is decorative */ }
  }
  let paintStamp = 0;

  // ---------------------------------------------------------------- confetti (built once per host)
  const CONFETTI_COLORS = ['#ff7a1a', '#ffcc33', '#19d3c5', '#ff4f6d', '#7c8cff', '#ffffff', '#5be36b'];
  function buildConfetti(host, count) {
    let h = '';
    for (let i = 0; i < count; i++) {
      const x = (i * 97) % 100;
      const delay = ((i * 37) % 60) / 100;
      const dur = 1.6 + ((i * 53) % 100) / 100;
      const rot = (i * 71) % 360;
      const drift = ((i * 29) % 40) - 20;
      h += '<i style="--x:' + x + '%;--d:' + delay + 's;--t:' + dur.toFixed(2) + 's;--r:' + rot + 'deg;--dx:' + drift + 'vw;--c:' + CONFETTI_COLORS[i % CONFETTI_COLORS.length] + '"></i>';
    }
    host.innerHTML = h;
  }
  function fireConfetti(host) {
    if (!host || reduced()) return;
    host.classList.remove('on');
    void host.offsetWidth;                // one-off restart of the CSS animation (event, not per frame)
    host.classList.add('on');
    clearTimeout(host._t);
    host._t = setTimeout(() => host.classList.remove('on'), 3400);
  }

  // ---------------------------------------------------------------- tweens (results count-ups)
  function tween(opts) {
    const t = Object.assign({ t: 0, delay: 0, dur: 0.8, from: 0, to: 0, ease: U.easeOutCubic, tick: true }, opts);
    tweens.push(t);
    return t;
  }
  function updateTweens(dt) {
    if (!tweens.length) return;
    let ticking = false;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = tw.t - tw.delay;
      if (k < 0) continue;
      const p = tw.dur > 0 ? U.clamp(k / tw.dur, 0, 1) : 1;
      const v = tw.from + (tw.to - tw.from) * tw.ease(p);
      if (tw.set) tw.set(v, p);
      if (tw.tick && p < 1 && tw.to !== tw.from) ticking = true;
      if (p >= 1) {
        tweens.splice(i, 1);
        if (tw.done) tw.done();
      }
    }
    if (ticking) {
      tickAcc += dt;
      if (tickAcc >= 0.07) { tickAcc = 0; play('tick', { volume: 0.5 }); }
    }
  }
  function finishTweens() {
    // jump every running tween to its end (tap-to-skip on the results screen)
    const list = tweens.splice(0, tweens.length);
    for (const tw of list) {
      if (tw.set) tw.set(tw.to, 1);
      if (tw.done) tw.done();
    }
  }

  // ================================================================= SCREENS
  // Definitions are queued at load time and built in init() (the DOM is needed).
  // ---------------------------------------------------------------- MENU
  define({
    id: 'menu',
    build(node) {
      node.innerHTML =
        '<div class="menu-top">' +
          '<button type="button" class="lvl-badge" data-act="missions" aria-label="Player level — open missions">' + levelBadgeHtml() + '</button>' +
          walletHtml() +
        '</div>' +
        '<div class="menu-main">' +
          '<div class="logo">' +
            '<svg class="logo-glyph" viewBox="0 0 120 64" aria-hidden="true"><use href="#logo-ridge"></use></svg>' +
            '<h1 class="logo-word" data-text="RIDGE RUSH">RIDGE RUSH</h1>' +
            '<div class="logo-sub"><span>Master the Mountains</span></div>' +
          '</div>' +
          '<nav class="menu-buttons" aria-label="Main menu">' +
            '<button type="button" class="btn btn-primary btn-xl btn-play" data-act="play" data-autofocus>' + icon('play') + '<span>PLAY</span></button>' +
            '<div class="menu-grid">' +
              '<button type="button" class="btn btn-tile" data-act="garage">' + icon('garage') + '<span>GARAGE</span></button>' +
              '<button type="button" class="btn btn-tile" data-act="worlds">' + icon('worlds') + '<span>WORLDS</span></button>' +
              '<button type="button" class="btn btn-tile" data-act="missions">' + icon('missions') + '<span>MISSIONS</span><i class="badge" data-ref="badgeMissions"></i></button>' +
              '<button type="button" class="btn btn-tile" data-act="daily">' + icon('daily') + '<span>DAILY<em> CHALLENGE</em></span><i class="badge" data-ref="badgeDaily"></i></button>' +
            '</div>' +
            '<button type="button" class="btn btn-ghost btn-settings" data-act="settings">' + icon('settings') + '<span>SETTINGS</span></button>' +
          '</nav>' +
        '</div>' +
        '<div class="menu-chips">' +
          '<button type="button" class="sel-chip" data-act="play">' + icon('car') + '<span><small>VEHICLE</small><b data-ref="vehName">Trail Buggy</b></span></button>' +
          '<button type="button" class="sel-chip" data-act="worlds">' + icon('pin') + '<span><small>WORLD</small><b data-ref="worldName">Green Valley</b></span></button>' +
        '</div>';
    },
    show() {
      const r = this.refs, d = S();
      const v = RR.Vehicles.byId(d.selectedVehicle), w = RR.Worlds.byId(d.selectedWorld);
      r.vehName.textContent = v ? v.name : '—';
      r.worldName.textContent = w ? w.name : '—';
      updateBadges();
      if (!this.shownOnce) { this.shownOnce = true; this.el.classList.add('intro'); setTimeout(() => this.el.classList.remove('intro'), 1600); }
    },
    back() { /* root screen */ }
  });

  function updateBadges() {
    const r = screens.menu && screens.menu.refs;
    if (!r) return;
    let n = 0;
    try { n = RR.Missions.claimableCount() + (RR.Missions.canClaimBonus() ? 1 : 0); } catch (e) { n = 0; }
    r.badgeMissions.textContent = n > 0 ? String(n) : '';
    r.badgeMissions.classList.toggle('on', n > 0);
    let dailyOpen = false;
    try { dailyOpen = !RR.Daily.status().completed; } catch (e) { dailyOpen = false; }
    r.badgeDaily.textContent = dailyOpen ? '!' : '';
    r.badgeDaily.classList.toggle('on', dailyOpen);
  }

  // ---------------------------------------------------------------- VEHICLE SELECT
  define({
    id: 'vehicles',
    build(node) {
      let cards = '';
      RR.Vehicles.list.forEach((v, i) => {
        cards +=
          '<article class="veh-card" data-vid="' + v.id + '" data-act="selectVehicle" data-arg="' + v.id + '" style="--i:' + i + '">' +
            '<div class="veh-preview"><canvas data-preview="' + v.id + '"></canvas>' +
              '<span class="veh-badge-sel">' + icon('check') + 'SELECTED</span>' +
              (v.special ? '<span class="veh-badge-special">' + icon('bolt') + esc(v.special.name) + '</span>' : '') +
            '</div>' +
            '<div class="veh-info">' +
              '<h3>' + esc(v.name) + '</h3>' +
              '<p class="veh-tag">' + esc(v.tagline || '') + '</p>' +
              statBars('s_' + v.id + '_') +
            '</div>' +
            '<div class="veh-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm veh-upgrade" data-act="upgradeVehicle" data-arg="' + v.id + '">' + icon('arrow-up') + '<span>UPGRADE</span></button>' +
              '<button type="button" class="btn btn-teal btn-sm veh-select" data-act="selectVehicle" data-arg="' + v.id + '">SELECT</button>' +
              '<span class="veh-selected-tag">' + icon('check') + 'READY</span>' +
            '</div>' +
            '<div class="veh-lock">' +
              '<span class="lock-ic">' + icon('lock') + '</span>' +
              '<b class="lock-title">LOCKED</b>' +
              '<p class="lock-req" data-ref="req_' + v.id + '"></p>' +
              '<div class="unlock-btns">' +
                '<button type="button" class="btn btn-gold btn-sm" data-act="unlockVehicle" data-arg="' + v.id + '|coins" data-ref="uc_' + v.id + '">' + icon('coin') + '<span>' + fmt(v.unlock.coins) + '</span></button>' +
                (v.unlock.tokens > 0 ? '<button type="button" class="btn btn-teal btn-sm" data-act="unlockVehicle" data-arg="' + v.id + '|tokens" data-ref="ut_' + v.id + '">' + icon('token') + '<span>' + v.unlock.tokens + '</span></button>' : '') +
              '</div>' +
            '</div>' +
          '</article>';
      });
      node.innerHTML =
        header('CHOOSE YOUR RIDE', 'car') +
        '<div class="scr-body"><div class="veh-grid">' + cards + '</div></div>' +
        '<footer class="scr-foot">' +
          '<div class="world-chip">' +
            '<canvas class="wc-thumb" data-ref="worldThumb"></canvas>' +
            '<div class="wc-text"><small>WORLD</small><b data-ref="worldName">Green Valley</b><span data-ref="worldStars"></span></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="worlds" data-arg="vehicles">CHANGE</button>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-lg btn-start" data-act="start" data-autofocus>' + icon('play') + '<span>START RUN</span></button>' +
        '</footer>';
      const cs = node.querySelectorAll('canvas[data-preview]');
      for (let i = 0; i < cs.length; i++) {
        const p = registerPreview(this, cs[i], 'vehicle', cs[i].getAttribute('data-preview'));
        p.phase = i * 0.7;
      }
      this.thumb = registerPreview(this, node.querySelector('[data-ref="worldThumb"]'), 'thumb', 'green_valley');
    },
    show() { this.refresh(); },
    refresh() {
      const d = S(), r = this.refs;
      for (const v of RR.Vehicles.list) {
        const card = this.el.querySelector('.veh-card[data-vid="' + v.id + '"]');
        const st = RR.Progression.vehicleStatus(v.id);
        card.classList.toggle('locked', !st.unlocked);
        card.classList.toggle('selected', d.selectedVehicle === v.id);
        card.classList.toggle('can-unlock', !st.unlocked && st.levelOk);
        r['req_' + v.id].textContent = st.requirementText;
        const uc = r['uc_' + v.id], ut = r['ut_' + v.id];
        setDisabled(uc, !st.canCoins);
        uc.hidden = !st.levelOk;
        if (ut) { setDisabled(ut, !st.canTokens); ut.hidden = !st.levelOk; }
        fillStats(r, 's_' + v.id + '_', RR.Vehicles.displayStats(v.id, d.upgrades[v.id] || null));
      }
      const w = RR.Worlds.byId(d.selectedWorld);
      r.worldName.textContent = w ? w.name : '—';
      r.worldStars.innerHTML = w ? stars(w.difficulty, 5) : '';
      if (this.thumb.id !== d.selectedWorld) { this.thumb.id = d.selectedWorld; this.thumb.drawn = false; }
    },
    back() { show('menu'); }
  });

  function setDisabled(btn, off) {
    if (!btn) return;
    btn.classList.toggle('disabled', !!off);
    btn.setAttribute('aria-disabled', off ? 'true' : 'false');
  }

  // ---------------------------------------------------------------- GARAGE
  define({
    id: 'garage',
    build(node) {
      let rows = '';
      for (const c of RR.Vehicles.UPGRADE_CATEGORIES) {
        let pips = '';
        for (let i = 1; i <= RR.Vehicles.MAX_UPGRADE_LEVEL; i++) pips += '<i data-pip="' + i + '"></i>';
        rows +=
          '<div class="upg-row" data-cat="' + c.id + '">' +
            '<span class="upg-ic">' + icon(UPGRADE_ICONS[c.id] || 'bolt') + '</span>' +
            '<div class="upg-main">' +
              '<div class="upg-head"><b>' + esc(c.name) + '</b><span class="upg-lv" data-ref="lv_' + c.id + '">LV 1</span></div>' +
              '<div class="pips" data-ref="pips_' + c.id + '">' + pips + '</div>' +
              '<div class="upg-stat"><span class="upg-eff" data-ref="eff_' + c.id + '"></span><span class="upg-cur" data-ref="cur_' + c.id + '"></span><span class="upg-arrow">' + icon('chev-right') + '</span><span class="upg-next" data-ref="next_' + c.id + '"></span></div>' +
              '<small class="upg-detail" data-ref="det_' + c.id + '"></small>' +
            '</div>' +
            '<button type="button" class="btn btn-upg" data-act="upgrade" data-arg="' + c.id + '" data-ref="btn_' + c.id + '">' +
              '<span class="upg-label" data-ref="lbl_' + c.id + '">UPGRADE</span>' +
              '<span class="upg-cost" data-ref="cost_' + c.id + '">' + icon('coin') + '<b>0</b></span>' +
            '</button>' +
            '<span class="upg-burst" aria-hidden="true"></span>' +
          '</div>';
      }
      let swatches = '';
      for (const p of RR.Progression.COSMETICS) {
        swatches += '<button type="button" class="swatch" data-act="paint" data-arg="' + p.id + '" data-paint="' + p.id + '" title="' + esc(p.name) + '">' +
          '<span class="sw-fill"></span><span class="sw-lock">' + icon('lock') + '<small>Lv ' + p.level + '</small></span></button>';
      }
      node.innerHTML =
        header('GARAGE', 'garage') +
        '<div class="scr-body garage-body">' +
          '<div class="garage-left panel">' +
            '<div class="garage-stage">' +
              '<button type="button" class="arrow-btn" data-act="garageCycle" data-arg="-1" aria-label="Previous vehicle">' + icon('chev-left') + '</button>' +
              '<canvas class="garage-canvas" data-ref="canvas"></canvas>' +
              '<button type="button" class="arrow-btn" data-act="garageCycle" data-arg="1" aria-label="Next vehicle">' + icon('chev-right') + '</button>' +
            '</div>' +
            '<div class="garage-name"><h3 data-ref="name">Trail Buggy</h3><p data-ref="tag"></p></div>' +
            '<div class="paint-block"><div class="block-title">' + icon('paint') + '<span>PAINT</span><em data-ref="paintName">Factory</em></div><div class="swatches" data-ref="swatches">' + swatches + '</div></div>' +
            '<div class="block-title">' + icon('speed') + '<span>PERFORMANCE</span></div>' +
            statBars('g_') +
          '</div>' +
          '<div class="garage-right">' +
            '<div class="coins-banner">' + icon('coin') + '<span>Coins:</span><b data-bind="coins">0</b></div>' +
            '<div class="token-sink panel" data-ref="sink" hidden>' +
              '<span class="ts-ic">' + icon('token') + '</span>' +
              '<span class="ts-text"><b data-ref="sinkTitle">SPARE TOKENS</b><small data-ref="sinkText"></small></span>' +
              '<button type="button" class="btn btn-teal btn-sm" data-act="convertTokens" data-ref="sinkBtn">' + icon('coin') + '<span>CONVERT</span></button>' +
            '</div>' +
            '<div class="upg-list">' + rows + '</div>' +
            '<p class="garage-tip" data-ref="tip"></p>' +
          '</div>' +
        '</div>' +
        '<footer class="scr-foot garage-foot">' +
          '<div class="world-chip">' +
            '<canvas class="wc-thumb" data-ref="worldThumb"></canvas>' +
            '<div class="wc-text"><small data-ref="footCap">WORLD</small><b data-ref="worldName">Green Valley</b></div>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-lg btn-start" data-act="garageStart" data-ref="startBtn">' + icon('play') + '<span data-ref="startLabel">START RUN</span></button>' +
        '</footer>';
      this.preview = registerPreview(this, node.querySelector('[data-ref="canvas"]'), 'vehicle', () => this.vid);
      this.thumb = registerPreview(this, node.querySelector('[data-ref="worldThumb"]'), 'thumb', 'green_valley');
      this.vid = 'trail_buggy';
    },
    show(params) {
      const d = S();
      this.from = params.from || null;
      this.vid = params.vehicleId && d.unlockedVehicles.indexOf(params.vehicleId) >= 0 ? params.vehicleId : d.selectedVehicle;
      // keep the selection (START RUN uses it) and rebuild the menu's attract car with it (qa2-9)
      if (this.vid !== d.selectedVehicle) {
        RR.Progression.selectVehicle(this.vid);
        if (game && game.refreshAttract) game.refreshAttract();
      }
      this.refresh();
    },
    // What START / RIDE AGAIN launches: the last run's world (and today's challenge for a daily) when
    // the garage was opened from results, otherwise the selected world.
    runTarget() {
      const d = S();
      const lp = this.from === 'results' && game ? game.lastParams : null;
      if (lp && lp.daily) {
        let ch = null;
        try { ch = RR.Daily.getChallenge(); } catch (e) { ch = null; }
        if (ch) return { worldId: ch.worldId, daily: ch };
      }
      const wid = lp && lp.worldId && d.unlockedWorlds.indexOf(lp.worldId) >= 0 ? lp.worldId : d.selectedWorld;
      return { worldId: wid, daily: null };
    },
    refresh(changedCat) {
      const d = S(), r = this.refs, vid = this.vid;
      const def = RR.Vehicles.byId(vid);
      r.name.textContent = def ? def.name : '—';
      r.tag.textContent = def ? def.tagline : '';
      const ups = RR.Save.ensureVehicle(vid);
      for (const c of RR.Vehicles.UPGRADE_CATEGORIES) {
        const cu = RR.Progression.canUpgrade(vid, c.id);
        const lv = cu.level;
        const max = RR.Vehicles.MAX_UPGRADE_LEVEL;
        r['lv_' + c.id].textContent = 'LV ' + lv + '/' + max;
        const pips = r['pips_' + c.id].children;
        for (let i = 0; i < pips.length; i++) {
          const on = i < lv;
          pips[i].classList.toggle('on', on);
          pips[i].classList.toggle('tier-lock', i >= RR.Progression.maxUpgradeLevel(d.level));
          if (changedCat === c.id && i === lv - 1 && !reduced() && pips[i].animate) {
            pips[i].animate([{ transform: 'scale(.3)', filter: 'brightness(3)' }, { transform: 'scale(1.5)', offset: 0.5 }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 480, easing: 'ease-out' });
          }
        }
        // main line: player-facing effect "label  current › next"; small line: the technical value (qa2-14)
        const cur = RR.Vehicles.describeUpgrade(vid, c.id, lv, ups);
        const hasEff = !!cur.effectLabel;
        r['eff_' + c.id].textContent = hasEff ? cur.effectLabel : '';
        r['cur_' + c.id].textContent = hasEff ? cur.effectValue : cur.value;
        const row = r['btn_' + c.id].parentNode;
        row.classList.toggle('maxed', cu.reason === 'max');
        if (cu.reason === 'max') {
          r['next_' + c.id].textContent = 'MAX';
          r['det_' + c.id].textContent = hasEff ? cur.value : cur.detail || '';
        } else {
          const nx = RR.Vehicles.describeUpgrade(vid, c.id, lv + 1, ups);
          r['next_' + c.id].textContent = hasEff ? nx.effectValue : nx.value;
          r['det_' + c.id].textContent = hasEff ? cur.value + '  →  ' + nx.value : nx.detail || '';
        }
        const btn = r['btn_' + c.id];
        const label = r['lbl_' + c.id];
        const cost = r['cost_' + c.id];
        cost.querySelector('b').textContent = fmt(cu.cost);
        cost.hidden = cu.reason === 'max' || cu.reason === 'tier';
        let text = 'UPGRADE';
        if (cu.reason === 'max') text = 'MAXED';
        else if (cu.reason === 'tier') text = 'NEED LV ' + cu.requiredLevel;
        else if (cu.reason === 'coins') text = 'NEED COINS';
        else if (cu.reason === 'locked') text = 'LOCKED';
        label.textContent = text;
        setDisabled(btn, !cu.ok);
        btn.dataset.reason = cu.reason || '';
      }
      fillStats(r, 'g_', RR.Vehicles.displayStats(vid, ups));
      // paints
      const selPaint = RR.Progression.selectedPaint(vid);
      const swatches = r.swatches.children;
      for (let i = 0; i < swatches.length; i++) {
        const sw = swatches[i];
        const pid = sw.getAttribute('data-paint');
        const meta = RR.Progression.COSMETICS.find((p) => p.id === pid);
        const colors = meta && meta.colors ? meta.colors : (def ? def.colors : null);
        if (colors) {
          sw.style.setProperty('--c1', colors.body);
          sw.style.setProperty('--c2', colors.accent);
          sw.style.setProperty('--c3', colors.trim);
        }
        const unlocked = RR.Progression.isPaintUnlocked(pid);
        sw.classList.toggle('locked', !unlocked);
        sw.classList.toggle('selected', pid === selPaint);
        sw.setAttribute('aria-pressed', pid === selPaint ? 'true' : 'false');
      }
      const pm = RR.Progression.COSMETICS.find((p) => p.id === selPaint);
      r.paintName.textContent = pm ? pm.name : 'Factory';
      // footer: where the next run goes
      const tgt = this.runTarget();
      const w = RR.Worlds.byId(tgt.worldId);
      r.footCap.textContent = tgt.daily ? 'DAILY CHALLENGE' : 'WORLD';
      r.worldName.textContent = tgt.daily ? tgt.daily.name + ' · ' + (w ? w.name : '') : (w ? w.name : '—');
      r.startLabel.textContent = this.from === 'results' ? 'RIDE AGAIN' : 'START RUN';
      if (this.thumb.id !== tgt.worldId) { this.thumb.id = tgt.worldId; this.thumb.drawn = false; }
      // token sink (only once every vehicle is owned)
      let sink = null;
      try { sink = RR.Progression.tokenSinkStatus ? RR.Progression.tokenSinkStatus() : null; } catch (e) { sink = null; }
      r.sink.hidden = !(sink && sink.available);
      if (sink && sink.available) {
        r.sinkTitle.textContent = fmt(sink.tokens) + ' SPARE TOKEN' + (sink.tokens === 1 ? '' : 'S');
        r.sinkText.textContent = 'Every vehicle is yours — trade tokens for ' + fmt(sink.value) + ' coins each';
      }
      const tier = RR.Progression.maxUpgradeLevel(d.level);
      r.tip.textContent = tier < RR.Vehicles.MAX_UPGRADE_LEVEL
        ? 'Upgrade tier: up to LV ' + tier + '. Reach player level ' + RR.Progression.requiredLevelForUpgrade(tier + 1) + ' to unlock LV ' + (tier + 1) + '+.'
        : 'All upgrade tiers unlocked.';
      paintStamp++;
    },
    back() { show(this.from === 'vehicles' ? 'vehicles' : 'menu'); }   // from results / menu → menu
  });

  // ---------------------------------------------------------------- WORLDS
  define({
    id: 'worlds',
    build(node) {
      let cards = '';
      RR.Worlds.list.forEach((w, i) => {
        cards +=
          '<article class="world-card" data-wid="' + w.id + '" style="--i:' + i + '">' +
            '<div class="wc-media"><canvas data-thumb="' + w.id + '"></canvas>' +
              '<span class="wc-lock">' + icon('lock') + '</span>' +
              '<span class="wc-badge-sel">' + icon('check') + 'SELECTED</span>' +
              '<span class="wc-num">' + (i + 1) + '</span>' +
            '</div>' +
            '<div class="wc-info">' +
              '<div class="wc-title"><h3>' + esc(w.name) + '</h3></div>' +
              '<div class="wc-diff">' + stars(w.difficulty, 5) + '<span class="diff-label diff-' + w.difficulty + '">' + esc(w.difficultyLabel) + '</span></div>' +
              '<p class="wc-sub">' + esc(w.subtitle) + '</p>' +
              '<div class="wc-best">' + icon('trophy') + '<span data-ref="best_' + w.id + '">No record yet</span></div>' +
              '<p class="wc-req" data-ref="req_' + w.id + '"></p>' +
              '<div class="wc-actions">' +
                '<button type="button" class="btn btn-teal btn-sm wc-select" data-act="selectWorld" data-arg="' + w.id + '">SELECT</button>' +
                '<button type="button" class="btn btn-primary btn-sm wc-play" data-act="playWorld" data-arg="' + w.id + '">' + icon('play') + '<span>PLAY</span></button>' +
                '<button type="button" class="btn btn-gold btn-sm wc-unlock" data-act="unlockWorld" data-arg="' + w.id + '" data-ref="un_' + w.id + '">' + icon('unlock') + '<span>UNLOCK</span><b>' + icon('coin') + fmt(w.unlock.coins) + '</b></button>' +
              '</div>' +
            '</div>' +
          '</article>';
      });
      node.innerHTML = header('WORLDS', 'worlds') + '<div class="scr-body"><div class="world-grid">' + cards + '</div></div>';
      const cs = node.querySelectorAll('canvas[data-thumb]');
      for (let i = 0; i < cs.length; i++) registerPreview(this, cs[i], 'thumb', cs[i].getAttribute('data-thumb'));
    },
    show(params) {
      this.from = params.from || null;
      this.refresh();
    },
    refresh() {
      const d = S(), r = this.refs;
      for (const w of RR.Worlds.list) {
        const card = this.el.querySelector('.world-card[data-wid="' + w.id + '"]');
        const st = RR.Progression.worldStatus(w.id);
        card.classList.toggle('locked', !st.unlocked);
        card.classList.toggle('selected', d.selectedWorld === w.id);
        card.classList.toggle('can-unlock', !st.unlocked && st.levelOk);
        const best = d.bestDistances[w.id] || 0;
        r['best_' + w.id].textContent = best > 0 ? 'Best: ' + fmt(best) + ' m' : 'No record yet';
        r['req_' + w.id].textContent = st.requirementText;
        setDisabled(r['un_' + w.id], !st.canBuy);
      }
    },
    back() { show(this.from === 'vehicles' ? 'vehicles' : 'menu'); }
  });

  // ---------------------------------------------------------------- MISSIONS
  define({
    id: 'missions',
    build(node) {
      node.innerHTML =
        header('MISSIONS', 'missions') +
        '<div class="scr-body missions-body">' +
          '<div class="mis-level panel">' +
            '<div class="mis-level-main">' + levelBadgeHtml() + '</div>' +
            '<div class="mis-next"><small data-ref="nextTitle">NEXT LEVEL</small><div class="mis-next-list" data-ref="nextList"></div></div>' +
          '</div>' +
          '<div class="section-head"><h3>DAILY MISSIONS</h3><span class="countdown">' + icon('clock') + '<span>New missions in</span><b data-ref="countdown">--:--:--</b></span></div>' +
          '<div class="mis-list" data-ref="list"></div>' +
          '<div class="mis-bonus panel" data-ref="bonus">' +
            '<span class="mis-bonus-ic">' + icon('trophy') + '</span>' +
            '<div class="mis-bonus-main"><b>ALL-CLEAR BONUS</b><small data-ref="bonusText">Claim all three missions to earn:</small><div class="rchips" data-ref="bonusChips"></div></div>' +
            '<button type="button" class="btn btn-gold" data-act="claimBonus" data-ref="bonusBtn">CLAIM</button>' +
          '</div>' +
          '<div class="section-head"><h3>LIFETIME STATS</h3></div>' +
          '<div class="stats-grid" data-ref="stats"></div>' +
        '</div>';
    },
    show() { this.refresh(); },
    refresh(claimedId) {
      const r = this.refs;
      let list = [];
      try { list = RR.Missions.getActive() || []; } catch (e) { list = []; }
      let h = '';
      for (const m of list) {
        const pct = U.clamp(m.progress / m.target, 0, 1);
        const state = m.claimed ? 'claimed' : m.completed ? 'done' : '';
        h += '<div class="mis-card ' + state + '" data-mid="' + esc(m.id) + '">' +
          '<span class="mis-ic">' + icon(MISSION_ICONS[m.templateId] || 'flag') + '</span>' +
          '<div class="mis-main"><p>' + esc(m.text) + '</p>' +
            '<div class="progress"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></div>' +
            '<small>' + fmt(Math.floor(m.progress)) + ' / ' + fmt(m.target) + '</small>' +
          '</div>' +
          '<div class="mis-side"><div class="rchips">' + rewardChips(m.reward) + '</div>' +
            (m.claimed ? '<span class="claimed-tag">' + icon('check') + 'CLAIMED</span>'
              : '<button type="button" class="btn btn-gold btn-sm' + (m.completed ? ' pulse' : ' disabled') + '" data-act="claim" data-arg="' + esc(m.id) + '" aria-disabled="' + (m.completed ? 'false' : 'true') + '">CLAIM</button>') +
          '</div>' +
          '<span class="upg-burst" aria-hidden="true"></span>' +
        '</div>';
      }
      r.list.innerHTML = h || '<p class="empty">No missions today.</p>';
      if (claimedId) {
        const card = r.list.querySelector('[data-mid="' + claimedId + '"]');
        if (card) burst(card);
      }
      // bonus
      const B = RR.Missions.BONUS;
      r.bonusChips.innerHTML = rewardChips(B);
      const ms = S().missions;
      const canBonus = RR.Missions.canClaimBonus();
      r.bonus.classList.toggle('claimed', !!ms.bonusClaimed);
      r.bonus.classList.toggle('ready', canBonus);
      r.bonusText.textContent = ms.bonusClaimed ? 'Bonus claimed — see you tomorrow!' : canBonus ? 'All missions claimed — collect your bonus!' : 'Claim all three missions to earn:';
      r.bonusBtn.textContent = ms.bonusClaimed ? 'CLAIMED' : 'CLAIM';
      setDisabled(r.bonusBtn, !canBonus);
      // next level rewards
      const info = RR.Progression.levelInfo();
      let lvl = info.level + 1, rewards = [];
      while (lvl <= RR.Progression.MAX_LEVEL && lvl <= info.level + 12) {
        rewards = RR.Progression.rewardsForLevel(lvl);
        if (rewards.length) break;
        lvl++;
      }
      if (info.isMax) {
        r.nextTitle.textContent = 'MAX LEVEL REACHED';
        r.nextList.innerHTML = '<span class="lvl-reward">' + icon('trophy') + 'You are a true mountain master.</span>';
      } else {
        r.nextTitle.textContent = lvl === info.level + 1 ? 'NEXT LEVEL (' + lvl + ') UNLOCKS' : 'LEVEL ' + lvl + ' UNLOCKS';
        r.nextList.innerHTML = rewards.length
          ? rewards.map((x) => '<span class="lvl-reward">' + icon(REWARD_ICONS[x.type] || 'xp') + esc(x.text) + '</span>').join('')
          : '<span class="lvl-reward">' + icon('xp') + 'More XP, bigger mission rewards</span>';
      }
      // stats
      const st = S().stats, d = S();
      const tiles = [
        ['flag', 'Runs', fmt(st.runs)],
        ['road', 'Total distance', fmt(st.totalDistance) + ' m'],
        ['trophy', 'Best distance', fmt(d.bestDistance) + ' m'],
        ['coin', 'Coins collected', fmt(st.coinsCollected)],
        ['rot-ccw', 'Backflips', fmt(st.backflips)],
        ['rot-cw', 'Frontflips', fmt(st.frontflips)],
        ['doubleflip', 'Double flips', fmt(st.doubleFlips)],
        ['target', 'Perfect landings', fmt(st.perfectLandings)],
        ['fuel', 'Fuel pickups', fmt(st.fuelCollected)],
        ['bolt', 'Power-ups', fmt(st.powerups)],
        ['boost', 'Best combo', '×' + fmt(st.maxCombo)],
        ['parachute', 'Longest air', (Math.round(num(st.longestAir, 0) * 10) / 10).toFixed(1) + ' s'],
        ['mountain', 'Bosses cleared', fmt(st.bossesCleared)],
        ['missions', 'Missions done', fmt(st.missionsCompleted)],
        ['daily', 'Dailies won', fmt(st.dailyCompleted)],
        ['clock', 'Play time', U.formatDuration(num(st.playTime, 0) * 1000)]
      ];
      r.stats.innerHTML = tiles.map((t) => '<div class="stat-tile">' + icon(t[0]) + '<b>' + esc(t[2]) + '</b><small>' + esc(t[1]) + '</small></div>').join('');
      this.tickSecond();
    },
    tickSecond() {
      let ms = 0;
      try { ms = RR.Missions.timeUntilReset(); } catch (e) { ms = 0; }
      this.refs.countdown.textContent = U.formatDuration(ms);
      // day rolled over while the screen is open → fresh missions (guarded against re-entry)
      const today = U.todayKey();
      if (S().missions.day && S().missions.day !== today && !this.rolling) {
        this.rolling = true;
        try { RR.Missions.ensureToday(); this.refresh(); } catch (e) { /* keep the old list */ } finally { this.rolling = false; }
      }
    },
    back() { show('menu'); }
  });

  // ---------------------------------------------------------------- DAILY
  define({
    id: 'daily',
    build(node) {
      node.innerHTML =
        header('DAILY CHALLENGE', 'daily') +
        '<div class="scr-body daily-body">' +
          '<div class="daily-card panel">' +
            '<div class="daily-hero"><canvas data-ref="thumb"></canvas><span class="daily-ic" data-ref="icon"></span><span class="daily-done" data-ref="doneBadge">' + icon('check') + 'COMPLETED</span></div>' +
            '<div class="daily-info">' +
              '<small class="daily-date" data-ref="date"></small>' +
              '<h3 data-ref="name"></h3>' +
              '<p class="daily-desc" data-ref="desc"></p>' +
              '<div class="daily-world">' + icon('pin') + '<span data-ref="world"></span><span data-ref="worldStars"></span><em data-ref="teaser"></em></div>' +
              '<div class="daily-mods" data-ref="mods"></div>' +
              '<div class="daily-goal">' +
                '<div class="goal-box">' + icon('flag') + '<span><small>TARGET</small><b data-ref="target"></b></span></div>' +
                '<div class="goal-box goal-reward"><small>REWARD</small><div class="rchips" data-ref="reward"></div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="daily-status">' +
            '<div class="stat-tile">' + icon('trophy') + '<b data-ref="best">0 m</b><small>Best today</small></div>' +
            '<div class="stat-tile">' + icon('restart') + '<b data-ref="attempts">0</b><small>Attempts</small></div>' +
            '<div class="stat-tile daily-progress"><div class="progress"><i data-ref="progress"></i></div><b data-ref="statusText">Not completed</b><small>Progress</small></div>' +
          '</div>' +
          '<div class="daily-countdown">' + icon('clock') + '<span>Next challenge in</span><b data-ref="countdown">--:--:--</b></div>' +
        '</div>' +
        '<footer class="scr-foot">' +
          '<div class="veh-cycler">' +
            '<button type="button" class="arrow-btn sm" data-act="dailyVehicle" data-arg="-1" aria-label="Previous vehicle">' + icon('chev-left') + '</button>' +
            '<span><small>DRIVING</small><b data-ref="veh">Trail Buggy</b></span>' +
            '<button type="button" class="arrow-btn sm" data-act="dailyVehicle" data-arg="1" aria-label="Next vehicle">' + icon('chev-right') + '</button>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-lg" data-act="playDaily" data-autofocus>' + icon('play') + '<span>PLAY DAILY</span></button>' +
        '</footer>';
      this.thumb = registerPreview(this, node.querySelector('[data-ref="thumb"]'), 'thumb', 'green_valley');
    },
    show() { this.refresh(); },
    refresh() {
      const r = this.refs;
      let ch = null, st = { best: 0, attempts: 0, completed: false };
      try { ch = RR.Daily.getChallenge(); st = RR.Daily.status(); } catch (e) { ch = null; }
      if (!ch) return;
      this.challenge = ch;
      const w = RR.Worlds.byId(ch.worldId);
      let dateText = ch.day;
      try { dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); } catch (e) { /* keep key */ }
      r.date.textContent = dateText.toUpperCase();
      r.name.textContent = ch.name;
      r.desc.textContent = ch.description;
      r.icon.innerHTML = icon(DAILY_ICONS[ch.id] || 'daily');
      r.world.textContent = ch.worldName || (w ? w.name : ch.worldId);
      r.worldStars.innerHTML = w ? stars(w.difficulty, 5) : '';
      const unlocked = S().unlockedWorlds.indexOf(ch.worldId) >= 0;
      r.teaser.textContent = unlocked ? '' : 'Locked world — playable today!';
      r.mods.innerHTML = (ch.modifiers && ch.modifiers.labels ? ch.modifiers.labels : []).map((l) => '<span class="mod-chip">' + esc(l) + '</span>').join('');
      r.target.textContent = fmt(ch.targetDistance) + ' m';
      r.reward.innerHTML = rewardChips(ch.reward);
      r.best.textContent = fmt(st.best) + ' m';
      r.attempts.textContent = fmt(st.attempts);
      const pct = U.clamp(st.best / Math.max(1, ch.targetDistance), 0, 1);
      r.progress.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
      r.statusText.textContent = st.completed ? 'Completed!' : Math.floor(pct * 100) + '%';
      this.el.classList.toggle('completed', !!st.completed);
      const v = RR.Vehicles.byId(S().selectedVehicle);
      r.veh.textContent = v ? v.name : '—';
      if (this.thumb.id !== ch.worldId) { this.thumb.id = ch.worldId; this.thumb.drawn = false; }
      this.tickSecond();
    },
    tickSecond() {
      let ms = 0;
      try { ms = RR.Daily.timeUntilNext(); } catch (e) { ms = 0; }
      this.refs.countdown.textContent = U.formatDuration(ms);
      if (this.challenge && this.challenge.day !== U.todayKey() && !this.rolling) {
        this.rolling = true;
        try { this.refresh(); } finally { this.rolling = false; }
      }
    },
    back() { show('menu'); }
  });

  // ---------------------------------------------------------------- SETTINGS
  function toggleHtml(key, iconId, label, desc) {
    return '<div class="set-row"><span class="set-ic">' + icon(iconId) + '</span><span class="set-label"><b>' + label + '</b>' + (desc ? '<small>' + desc + '</small>' : '') + '</span>' +
      '<button type="button" class="toggle" role="switch" aria-checked="false" aria-label="' + esc(label) + '" data-act="toggleSetting" data-arg="' + key + '" data-setting="' + key + '"><i></i></button></div>';
  }
  function segHtml(key, iconId, label, options, desc) {
    let h = '<div class="set-row"><span class="set-ic">' + icon(iconId) + '</span><span class="set-label"><b>' + label + '</b>' + (desc ? '<small>' + desc + '</small>' : '') + '</span><div class="seg" role="radiogroup" aria-label="' + esc(label) + '">';
    for (const [val, text] of options) h += '<button type="button" role="radio" aria-checked="false" data-act="setSetting" data-arg="' + key + '|' + val + '" data-seg="' + key + '" data-val="' + val + '">' + text + '</button>';
    return h + '</div></div>';
  }
  define({
    id: 'settings',
    build(node) {
      node.innerHTML =
        header('SETTINGS', 'settings', { wallet: false }) +
        '<div class="scr-body settings-body">' +
          '<div class="set-col">' +
            '<div class="set-group panel"><h4>AUDIO</h4>' +
              toggleHtml('music', 'music', 'Music', 'Procedural soundtrack for every world') +
              toggleHtml('sound', 'sound', 'Sound effects', 'Engine, coins, crashes and UI') +
            '</div>' +
            '<div class="set-group panel"><h4>DISPLAY</h4>' +
              segHtml('quality', 'graphics', 'Graphics', (saveAcceptsAutoQuality() ? [['auto', 'AUTO']] : []).concat([['low', 'LOW'], ['medium', 'MED'], ['high', 'HIGH']]),
                'Lower = faster on older devices' + (saveAcceptsAutoQuality() ? ' · AUTO adapts to your device' : '')) +
              toggleHtml('reducedMotion', 'motion', 'Reduced motion', 'Less shake, zoom and UI animation') +
              toggleHtml('showFps', 'fps', 'Show FPS', 'Frame-rate counter in the HUD') +
            '</div>' +
          '</div>' +
          '<div class="set-col">' +
            '<div class="set-group panel"><h4>CONTROLS</h4>' +
              '<div class="set-row"><span class="set-ic">' + icon('sliders') + '</span><span class="set-label"><b>Sensitivity</b><small>Air &amp; lean rotation strength</small></span>' +
                '<div class="range-wrap"><input type="range" min="0.5" max="1.5" step="0.05" data-range="sensitivity" aria-label="Control sensitivity"><output data-ref="sensOut">1.00×</output></div></div>' +
              segHtml('touchControls', 'touch', 'Touch controls', [['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']], 'On-screen buttons while driving') +
              '<div class="controls-ref">' +
                '<div class="cref-col"><div class="cref-title">' + icon('keyboard') + 'KEYBOARD</div>' +
                  '<ul><li><kbd>D</kbd><kbd>→</kbd><span>Gas · in air: tilt back</span></li>' +
                  '<li><kbd>A</kbd><kbd>←</kbd><span>Brake / reverse · in air: tilt forward</span></li>' +
                  '<li><kbd>W</kbd><kbd>↑</kbd><span>Lean back (nose up)</span></li>' +
                  '<li><kbd>S</kbd><kbd>↓</kbd><span>Lean forward (nose down)</span></li>' +
                  '<li><kbd>Space</kbd><span>Handbrake · Ion Thruster</span></li>' +
                  '<li><kbd>P</kbd><kbd>Esc</kbd><span>Pause</span></li>' +
                  '<li><kbd>R</kbd><span>Restart</span></li><li><kbd>M</kbd><span>Mute</span></li></ul></div>' +
                '<div class="cref-col"><div class="cref-title">' + icon('touch') + 'TOUCH</div>' +
                  '<ul><li><span class="tchip">' + icon('gas') + 'GAS</span><span>Bottom right</span></li>' +
                  '<li><span class="tchip">' + icon('brake') + 'BRAKE</span><span>Bottom left</span></li>' +
                  '<li><span class="tchip">' + icon('rot-ccw') + '</span><span>Rotate left (lean back)</span></li>' +
                  '<li><span class="tchip">' + icon('rot-cw') + '</span><span>Rotate right (lean forward)</span></li>' +
                  '<li><span class="tchip">' + icon('bolt') + '</span><span>Special (Storm Runner)</span></li></ul></div>' +
              '</div>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-act="howToPlay">' + icon('info') + '<span>HOW TO PLAY</span></button>' +
            '</div>' +
            '<div class="set-group panel danger-zone"><h4>DATA</h4>' +
              '<div class="set-row"><span class="set-ic">' + icon('trash') + '</span><span class="set-label"><b>Reset save data</b><small data-ref="saveInfo">Progress is saved in this browser</small></span>' +
                '<button type="button" class="btn btn-danger btn-sm" data-act="resetSave">RESET</button></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      const range = node.querySelector('[data-range="sensitivity"]');
      range.addEventListener('input', () => {
        const v = Math.round(U.clamp(parseFloat(range.value) || 1, 0.5, 1.5) * 100) / 100;
        this.refs.sensOut.textContent = v.toFixed(2) + '×';
        RR.Save.updateSettings({ sensitivity: v });
      });
      this.range = range;
    },
    show(params) {
      this.from = params.from || null;
      this.refresh();
    },
    refresh() {
      const s = S().settings;
      const toggles = this.el.querySelectorAll('[data-setting]');
      for (let i = 0; i < toggles.length; i++) {
        const k = toggles[i].getAttribute('data-setting');
        toggles[i].setAttribute('aria-checked', s[k] ? 'true' : 'false');
      }
      const segs = this.el.querySelectorAll('[data-seg]');
      for (let i = 0; i < segs.length; i++) {
        const on = s[segs[i].getAttribute('data-seg')] === segs[i].getAttribute('data-val');
        segs[i].setAttribute('aria-checked', on ? 'true' : 'false');
        segs[i].classList.toggle('on', on);
      }
      this.range.value = String(s.sensitivity);
      this.refs.sensOut.textContent = Number(s.sensitivity).toFixed(2) + '×';
      this.refs.saveInfo.textContent = RR.Save.persistent === false
        ? 'Storage unavailable — progress lasts this session only'
        : 'Progress is saved in this browser · v' + (RR.VERSION || '1.0.0');
    },
    back() { show(this.from === 'pause' ? 'pause' : 'menu'); }
  });

  // ---------------------------------------------------------------- PAUSE
  define({
    id: 'pause',
    build(node) {
      node.classList.add('overlay');
      node.innerHTML =
        '<div class="pause-panel panel">' +
          '<h2 class="pause-title">' + icon('pause') + '<span>PAUSED</span></h2>' +
          '<div class="pause-stats">' +
            '<div><small>DISTANCE</small><b data-ref="dist">0 m</b></div>' +
            '<div><small>COINS</small><b data-ref="coins">0</b></div>' +
            '<div><small>TIME</small><b data-ref="time">0:00</b></div>' +
            '<div><small>BEST</small><b data-ref="best">0 m</b></div>' +
          '</div>' +
          '<div class="pause-missions" data-ref="missions"></div>' +
          '<div class="pause-btns">' +
            '<button type="button" class="btn btn-primary btn-lg" data-act="resume" data-autofocus>' + icon('play') + '<span>RESUME</span></button>' +
            '<button type="button" class="btn" data-act="restart">' + icon('restart') + '<span>RESTART</span></button>' +
            '<button type="button" class="btn" data-act="settings" data-arg="pause">' + icon('settings') + '<span>SETTINGS</span></button>' +
            '<button type="button" class="btn btn-danger-ghost" data-act="quit">' + icon('quit') + '<span>QUIT</span></button>' +
          '</div>' +
          '<p class="pause-hint">' + icon('info') + '<span data-ref="hint">Restarting or quitting keeps the coins you collected.</span></p>' +
        '</div>';
    },
    show() {
      const r = this.refs;
      const run = game && game.run;
      if (run) {
        r.dist.textContent = fmt(Math.floor(num(run.distance, 0))) + ' m';
        r.coins.textContent = fmt(num(run.coins, 0) + num(run.bonusCoins, 0));
        r.time.textContent = U.formatDuration(num(run.time, 0) * 1000);
        r.best.textContent = fmt(Math.floor(num(run.bestDistance, 0))) + ' m';
      }
      let list = [];
      try { list = RR.Missions.getActive() || []; } catch (e) { list = []; }
      r.missions.innerHTML = list.map((m) => {
        const pct = U.clamp(m.progress / m.target, 0, 1);
        return '<div class="pm-row' + (m.completed ? ' done' : '') + '">' + icon(m.completed ? 'check' : (MISSION_ICONS[m.templateId] || 'flag')) +
          '<span class="pm-text">' + esc(m.text) + '</span><span class="progress sm"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></span>' +
          '<small>' + fmt(Math.floor(m.progress)) + '/' + fmt(m.target) + '</small></div>';
      }).join('');
    },
    back() { if (game) game.resume(); }
  });

  // ---------------------------------------------------------------- RESULTS
  define({
    id: 'results',
    build(node) {
      node.classList.add('overlay');
      node.innerHTML =
        '<div class="res-wrap">' +
          '<div class="res-head">' +
            '<div class="res-title" data-ref="title">RUN COMPLETE</div>' +
            '<div class="res-reason" data-ref="reason"></div>' +
            '<p class="res-coach" data-ref="coach" hidden></p>' +
            '<div class="res-record" data-ref="record">' + icon('trophy') + '<span>NEW RECORD!</span></div>' +
            '<div class="res-first" data-ref="first" hidden></div>' +
          '</div>' +
          '<div class="res-body">' +
            '<div class="res-main panel">' +
              '<div class="res-dist"><small>DISTANCE</small><div><b data-ref="dist">0</b><span>m</span></div></div>' +
              '<div class="res-best">' + icon('flag') + '<small data-ref="bestLabel">BEST</small><b data-ref="best">0 m</b></div>' +
              '<div class="res-rows">' +
                '<div class="res-row">' + icon('coin') + '<span>COINS</span><b data-ref="coins">+0</b></div>' +
                '<div class="res-row">' + icon('xp', 'gold') + '<span>BONUS COINS</span><b data-ref="bonus">+0</b></div>' +
                '<div class="res-row" data-ref="tokRow">' + icon('token') + '<span>TOKENS</span><b data-ref="tokens">+0</b></div>' +
                '<div class="res-row res-xp">' + icon('xp') + '<span>XP EARNED</span><b data-ref="xp">+0</b></div>' +
                '<small class="res-xp-break" data-ref="xpBreak"></small>' +
              '</div>' +
              '<div class="res-level">' +
                '<span class="lvl-hex"><b data-ref="lvl">1</b></span>' +
                '<div class="res-level-bar"><div class="xpbar big"><i data-ref="lvlFill"></i></div><small data-ref="lvlText"></small></div>' +
              '</div>' +
            '</div>' +
            '<div class="res-side">' +
              '<div class="res-tricks panel"><h4>' + icon('rot-ccw') + 'TRICKS</h4><div class="trick-chips" data-ref="tricks"></div></div>' +
              '<div class="res-daily panel" data-ref="daily"></div>' +
              '<div class="res-missions panel" data-ref="missionsBox"><h4>' + icon('missions') + 'MISSIONS COMPLETED</h4><ul data-ref="missions"></ul></div>' +
            '</div>' +
          '</div>' +
          '<div class="res-btns">' +
            '<button type="button" class="btn btn-primary btn-lg" data-act="retry" data-autofocus>' + icon('restart') + '<span>RETRY</span><kbd class="kbd-hint">R</kbd></button>' +
            '<button type="button" class="btn" data-act="toGarage">' + icon('garage') + '<span>GARAGE</span></button>' +
            '<button type="button" class="btn" data-act="toMenu">' + icon('home') + '<span>MENU</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="confetti" data-ref="confetti"></div>';
      buildConfetti(node.querySelector('[data-ref="confetti"]'), 44);
      // tap anywhere (not on a button) to skip the count-up
      node.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('button')) return;
        if (tweens.length) finishTweens();
      });
    },
    show() {
      const data = resultsData || { summary: {}, rewards: {} };
      const s = data.summary || {}, rw = data.rewards || {}, dr = data.dailyResult || null;
      const r = this.refs;
      this.animDone = false;
      tweens.length = 0;
      // header
      const reason = s.endReason === 'fuel' ? 'Out of fuel' : s.endReason === 'quit' ? 'Run ended' : 'Crashed — ' + crashText(s.crashReason, s.crashPose);
      r.reason.textContent = reason;
      const coach = s.endReason === 'crash' ? coachLine(s) : '';
      r.coach.textContent = coach;
      r.coach.hidden = !coach;
      r.title.textContent = s.mode === 'daily' ? 'DAILY RUN COMPLETE' : 'RUN COMPLETE';
      const isDaily = s.mode === 'daily';
      const dist = Math.floor(num(s.distance, 0));
      const w = RR.Worlds.byId(s.worldId);
      const prevBest = num(rw.previousBest, 0);
      // A record needs a real previous best (same ≥ 50 m rule as the in-run banner and record XP): a
      // world's first run (or a 5 m crash) is not a celebration. Dailies never set permanent records;
      // they celebrate beating today's best instead.
      const dailyExpired = !!(dr && dr.expired);
      const dailyPrev = num(rw.dailyBestPrev, 0);
      const newDailyBest = isDaily && !dailyExpired && !!(rw.newDailyBest || s.newDailyBest);
      const record = isDaily ? newDailyBest && dailyPrev >= RECORD_MIN_PREV
        : !!(rw.newRecord || rw.newWorldRecord) && prevBest >= RECORD_MIN_PREV;
      const firstRun = !isDaily && !!w && !!(rw.newWorldRecord || rw.newRecord) && prevBest <= 0 && dist > 0;
      r.record.classList.remove('on');
      r.record.querySelector('span').textContent = isDaily ? 'NEW DAILY BEST!' : rw.newRecord ? 'NEW RECORD!' : 'NEW WORLD RECORD!';
      r.first.hidden = !firstRun;
      r.first.textContent = firstRun ? 'First run on ' + w.name : '';
      // static values
      if (isDaily) {
        // today's best for this challenge (the permanent world best is untouched by dailies)
        const bestToday = dailyExpired ? dist : Math.max(dist, dailyPrev, dr ? num(dr.best, 0) : 0);
        r.bestLabel.textContent = record ? 'PREVIOUS BEST TODAY' : dailyExpired ? 'THIS RUN' : 'BEST TODAY';
        r.best.textContent = fmt(record ? dailyPrev : bestToday) + ' m';
      } else {
        const best = Math.max(dist, prevBest, w ? num(S().bestDistances[w.id], 0) : 0);
        r.bestLabel.textContent = record ? 'PREVIOUS BEST' : 'BEST' + (w ? ' · ' + w.name.toUpperCase() : '');
        r.best.textContent = fmt(record ? prevBest : best) + ' m';
      }
      const coins = num(rw.coins, num(s.coins, 0)), bonus = num(rw.bonusCoins, num(s.bonusCoins, 0));
      const tokens = num(rw.tokens, 0);
      const xp = rw.xp || { total: 0 };
      r.tokRow.hidden = tokens <= 0;
      const parts = [];
      if (xp.distance) parts.push('distance ' + fmt(xp.distance));
      if (xp.coins) parts.push('coins ' + fmt(xp.coins));
      if (xp.tricks) parts.push('tricks ' + fmt(xp.tricks));
      if (xp.boss) parts.push('boss ' + fmt(xp.boss));
      if (xp.record) parts.push('record ' + fmt(xp.record));
      if (dr && dr.reward && dr.reward.xp) parts.push('daily ' + fmt(dr.reward.xp));
      r.xpBreak.textContent = parts.join(' · ');
      // tricks
      const tr = s.tricks || {};
      const trickList = [
        ['backflip', 'Backflip', 'rot-ccw'], ['frontflip', 'Frontflip', 'rot-cw'], ['doubleFlip', 'Double flip', 'doubleflip'],
        ['tripleFlip', 'Triple flip', 'doubleflip'], ['perfect', 'Perfect landing', 'target'], ['longAir', 'Long air', 'parachute'], ['wheelie', 'Wheelie', 'wheelie']
      ];
      let th = '';
      for (const [k, label, ic] of trickList) {
        const n = Math.floor(num(k === 'perfect' && !tr.perfect ? s.perfectLandings : tr[k], 0));
        if (n > 0) th += '<span class="trick-chip">' + icon(ic) + '<span>' + label + '</span><b>×' + n + '</b></span>';
      }
      // the combo chip is separate: a ×2 coin combo alone must not hide the "no tricks" tip (qa2-12)
      const comboChip = num(s.maxCombo, 0) >= 2 ? '<span class="trick-chip combo">' + icon('boost') + '<span>Best combo</span><b>×' + Math.floor(s.maxCombo) + '</b></span>' : '';
      r.tricks.innerHTML = (th || '<p class="empty">' + (isTouchUi()
        ? 'No tricks this time — hold the ↺ TILT button with GAS in the air to backflip!'
        : 'No tricks this time — lean back (W / ↺) with the gas held in the air to backflip!') + '</p>') + comboChip;
      // daily
      if (isDaily || dr) {
        r.daily.hidden = false;
        // the challenge this run was played for (not "today's", which may have changed at midnight)
        let ch = data.challenge || null;
        if (!ch) { try { ch = RR.Daily.getChallenge(s.dailyDay || undefined); } catch (e) { ch = null; } }
        const target = dr ? num(dr.target, 0) : ch ? ch.targetDistance : num(s.targetDistance, 0);
        const done = dr && dr.completedNow;
        let already = false;
        if (!done && !dailyExpired && ch) {
          try { const st = RR.Daily.status(); already = !!st.completed && st.day === ch.day; } catch (e) { already = false; }
        }
        const bestToday = dr ? num(dr.best, dist) : dist;
        const pct = U.clamp(dist / Math.max(1, target), 0, 1);
        r.daily.className = 'res-daily panel' + (done ? ' won' : '') + (dailyExpired ? ' expired' : '');
        r.daily.innerHTML = '<h4>' + icon('daily') + 'DAILY CHALLENGE' + (ch ? ' · ' + esc(String(ch.name).toUpperCase()) : '') + '</h4>' +
          '<div class="progress"><i style="transform:scaleX(' + pct.toFixed(3) + ')"></i></div>' +
          '<p>' + (dailyExpired ? '<b class="warn">' + icon('clock') + 'Challenge expired at midnight</b> · ' + fmt(dist) + ' / ' + fmt(target) + ' m — a new challenge is up'
            : done ? '<b class="ok">' + icon('check') + 'TARGET REACHED!</b> ' + rewardChips(dr.reward)
              : already ? '<b class="ok">' + icon('check') + 'Already completed today</b> · best ' + fmt(bestToday) + ' m'
                : fmt(dist) + ' / ' + fmt(target) + ' m · best today ' + fmt(bestToday) + ' m') +
          (newDailyBest && dailyPrev > 0 && !done ? ' <b class="ok nb">' + icon('trophy') + 'NEW DAILY BEST</b>' : '') + '</p>';
      } else {
        r.daily.hidden = true;
      }
      // missions completed this run
      const mc = Array.isArray(s.missionsCompleted) ? s.missionsCompleted : [];
      r.missionsBox.hidden = mc.length === 0;
      r.missions.innerHTML = mc.map((t) => '<li>' + icon('check') + '<span>' + esc(typeof t === 'string' ? t : (t && t.text) || '') + '</span></li>').join('');
      // count-ups
      const R = reduced();
      const k = R ? 0.35 : 1;
      r.dist.textContent = '0';
      r.coins.textContent = '+0'; r.bonus.textContent = '+0'; r.tokens.textContent = '+0'; r.xp.textContent = '+0';
      const setNum = (node, prefix) => (v) => { const t = prefix + fmt(Math.round(v)); if (node.textContent !== t) node.textContent = t; };
      tween({ to: dist, dur: 1.1 * k, delay: 0.25 * k, set: setNum(r.dist, ''), done: () => { if (record) this.celebrate(); } });
      tween({ to: coins, dur: 0.6 * k, delay: 0.9 * k, set: setNum(r.coins, '+') });
      tween({ to: bonus, dur: 0.6 * k, delay: 1.15 * k, set: setNum(r.bonus, '+') });
      if (tokens > 0) tween({ to: tokens, dur: 0.3 * k, delay: 1.35 * k, set: setNum(r.tokens, '+') });
      const totalXp = num(xp.total, 0) + (dr && dr.reward ? num(dr.reward.xp, 0) : 0);
      tween({ to: totalXp, dur: 0.6 * k, delay: 1.4 * k, set: setNum(r.xp, '+') });
      // level bar: from XP before this run to now (handles multi-level wraps)
      const now = S().xp;
      const before = Math.max(0, now - totalXp);
      let lastLevel = RR.Progression.levelInfo(before).level;
      const setLevel = (x) => {
        const info = RR.Progression.levelInfo(Math.round(x));
        if (info.level !== lastLevel) {
          lastLevel = info.level;
          if (!R && r.lvl.parentNode.animate) r.lvl.parentNode.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400 });
          play('levelup', { volume: 0.6 });
        }
        r.lvl.textContent = String(info.level);
        r.lvlFill.style.transform = 'scaleX(' + U.clamp(info.progress, 0, 1).toFixed(3) + ')';
        r.lvlText.textContent = info.isMax ? 'MAX LEVEL' : 'LV ' + info.level + ' · ' + fmt(info.xpInto) + ' / ' + fmt(info.xpNext) + ' XP';
      };
      setLevel(before);
      tween({ from: before, to: now, dur: 1.2 * k, delay: 1.8 * k, set: setLevel, tick: false, ease: U.easeInOutQuad, done: () => { this.animDone = true; flushLevelUps(); } });
      if (!record) r.record.classList.remove('on');
    },
    celebrate() {
      const r = this.refs;
      r.record.classList.add('on');
      fireConfetti(r.confetti);
      play('record');
    },
    hide() { tweens.length = 0; },
    back() { if (game) game.quitToMenu('menu'); }
  });
  let resultsData = null;

  // ================================================================= MODALS
  let modalEl = null, modalRefs = null, modalState = null;
  let modalOpenedAt = 0;
  let screenConfetti = null;             // confetti over any screen (the modal's own host is hidden when closed)
  const modalQueue = [];

  function buildModal() {
    modalEl = el(
      '<div class="modal" role="dialog" aria-modal="true" aria-hidden="true">' +
        '<div class="modal-card panel">' +
          '<div class="modal-icon" data-ref="icon"></div>' +
          '<h3 class="modal-title" data-ref="title"></h3>' +
          '<div class="modal-body" data-ref="body"></div>' +
          '<div class="modal-btns" data-ref="btns"></div>' +
        '</div>' +
        '<div class="confetti" data-ref="confetti"></div>' +
      '</div>');
    modalRoot.appendChild(modalEl);
    modalRefs = collectRefs(modalEl);
    buildConfetti(modalRefs.confetti, 36);
    screenConfetti = el('<div class="confetti" aria-hidden="true"></div>');
    modalRoot.appendChild(screenConfetti);
    buildConfetti(screenConfetti, 36);
    try { modalEl.inert = true; } catch (e) { /* ignore */ }
    modalEl.addEventListener('pointerdown', (e) => {
      if (e.target !== modalEl || !modalState || !modalState.dismissable) return;
      // the second tap of a double-tap that opened the modal must not dismiss it
      if (nowMs() - modalOpenedAt < MODAL_GUARD_MS) return;
      closeModal(false);
    });
  }

  // spec {type, title, bodyHtml, icon, buttons:[{label, act:'ok'|'cancel', cls}], dismissable, onClose}
  function openModal(spec) {
    return new Promise((resolve) => {
      modalQueue.push({ spec, resolve });
      if (!modalState) nextModal();
    });
  }
  function nextModal() {
    const item = modalQueue.shift();
    if (!item) { modalState = null; return; }
    const spec = item.spec;
    modalState = { resolve: item.resolve, dismissable: spec.dismissable !== false, onClose: spec.onClose, type: spec.type };
    modalOpenedAt = nowMs();
    modalEl.className = 'modal open modal-' + (spec.type || 'confirm');
    modalRefs.icon.innerHTML = spec.iconHtml || (spec.icon ? icon(spec.icon) : '');
    modalRefs.icon.hidden = !(spec.iconHtml || spec.icon);
    modalRefs.title.textContent = spec.title || '';
    modalRefs.body.innerHTML = spec.bodyHtml || '';
    modalRefs.btns.innerHTML = (spec.buttons || []).map((b, i) =>
      '<button type="button" class="btn ' + (b.cls || '') + '" data-act="modal" data-arg="' + (b.act || 'ok') + '"' + (i === (spec.focus || 0) ? ' data-modal-focus' : '') + '>' + (b.icon ? icon(b.icon) : '') + '<span>' + esc(b.label) + '</span></button>').join('');
    modalEl.setAttribute('aria-hidden', 'false');
    try { modalEl.inert = false; } catch (e) { /* ignore */ }
    document.body.classList.add('modal-open');
    if (spec.confetti) fireConfetti(modalRefs.confetti);
    raf(() => {
      const f = modalEl.querySelector('[data-modal-focus]');
      if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
    });
  }
  function closeModal(result) {
    if (!modalState) return;
    const st = modalState;
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    try { modalEl.inert = true; } catch (e) { /* ignore */ }
    document.body.classList.remove('modal-open');
    modalState = null;
    try { if (st.onClose) st.onClose(result); } catch (e) { console.error('[RR.UI] modal onClose failed', e); }
    st.resolve(!!result);
    setTimeout(() => { if (!modalState) nextModal(); if (!modalState) focusPrimary(screens[current]); }, 180);
  }

  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  // A confirm is already open or queued: a second activation (double click, Enter auto-repeat) of the
  // same button must not queue another one.
  const modalBusy = () => !!modalState || modalQueue.length > 0;

  function confirm(title, msg, okLabel, opts) {
    opts = opts || {};
    return openModal({
      type: opts.danger ? 'danger' : 'confirm',
      title,
      icon: opts.icon || (opts.danger ? 'warning' : 'info'),
      bodyHtml: '<p>' + esc(msg) + '</p>',
      buttons: [
        { label: 'CANCEL', act: 'cancel', cls: 'btn-ghost' },
        { label: okLabel || 'OK', act: 'ok', cls: opts.danger ? 'btn-danger' : 'btn-primary' }
      ],
      focus: 1
    });
  }

  // ---------------------------------------------------------------- level-up
  function flushLevelUps() {
    if (!pendingLevelUps.length || !initialized) return;
    if (!current) return;                                     // playing: wait
    if (current === 'results' && screens.results && !screens.results.animDone) return;
    const ups = pendingLevelUps;
    pendingLevelUps = [];
    const top = ups[ups.length - 1].level;
    const rewards = [];
    for (const u of ups) for (const x of u.rewards || []) rewards.push(x);
    play('levelup');
    openModal({
      type: 'levelup',
      title: 'LEVEL UP!',
      iconHtml: '<span class="lvl-hex big"><b>' + top + '</b></span>',
      bodyHtml: '<p class="lu-sub">' + (ups.length > 1 ? 'You climbed ' + ups.length + ' levels!' : 'You reached level ' + top + '!') + '</p>' +
        (rewards.length ? '<ul class="lu-rewards">' + rewards.map((x) => '<li>' + icon(REWARD_ICONS[x.type] || 'xp') + '<span>' + esc(x.text) + '</span></li>').join('') + '</ul>'
          : '<p class="lu-none">Keep climbing — new rewards await at higher levels.</p>'),
      buttons: [{ label: 'AWESOME!', act: 'ok', cls: 'btn-primary' }],
      confetti: true
    }).then(() => { refreshCurrent(); });
  }

  // ---------------------------------------------------------------- tutorial
  function showTutorial(onDone) {
    const touch = RR.Input && RR.Input.isTouchDevice && RR.Input.isTouchDevice();
    const keys =
      '<div class="tut-col"><div class="tut-title">' + icon('keyboard') + 'KEYBOARD</div>' +
        '<div class="tut-row"><span class="tut-keys"><kbd>D</kbd><kbd>→</kbd></span><span><b>Gas.</b> In the air it tilts you back.</span></div>' +
        '<div class="tut-row"><span class="tut-keys"><kbd>A</kbd><kbd>←</kbd></span><span><b>Brake / reverse.</b> In the air it tilts you forward.</span></div>' +
        '<div class="tut-row"><span class="tut-keys"><kbd>W</kbd><kbd>S</kbd></span><span><b>Lean</b> back / forward for fine air control.</span></div>' +
        '<div class="tut-row"><span class="tut-keys"><kbd>P</kbd><kbd>R</kbd><kbd>M</kbd></span><span>Pause · restart · mute</span></div>' +
      '</div>';
    const touches =
      '<div class="tut-col"><div class="tut-title">' + icon('touch') + 'TOUCH</div>' +
        '<div class="tut-row"><span class="tchip">' + icon('gas') + 'GAS</span><span><b>Right thumb.</b> Hold to accelerate.</span></div>' +
        '<div class="tut-row"><span class="tchip">' + icon('brake') + 'BRAKE</span><span><b>Left thumb.</b> Brake, then reverse.</span></div>' +
        '<div class="tut-row"><span class="tchip">' + icon('rot-ccw') + '</span><span class="tut-and">+</span><span class="tchip">' + icon('rot-cw') + '</span><span>Rotate in the air.</span></div>' +
      '</div>';
    openModal({
      type: 'tutorial',
      title: 'HOW TO RIDE',
      icon: 'mountain',
      bodyHtml:
        '<div class="tut-grid">' + (touch ? touches + keys : keys + touches) + '</div>' +
        '<ul class="tut-tips">' +
          '<li>' + icon('fuel') + '<span>Grab <b>fuel cans</b> before the tank runs dry.</span></li>' +
          '<li>' + icon('rot-ccw') + '<span><b>Flip</b> and land on your wheels for bonus coins.</span></li>' +
          '<li>' + icon('warning') + '<span>Don\'t land on your head!</span></li>' +
        '</ul>',
      buttons: [{ label: "LET'S RIDE!", act: 'ok', cls: 'btn-primary btn-lg', icon: 'play' }],
      dismissable: false,
      onClose: () => {
        S().seenTutorial = true;
        RR.Save.save();
        if (typeof onDone === 'function') onDone();
      }
    });
  }

  // ================================================================= ACTIONS
  function currentScreen() { return current ? screens[current] : null; }
  function refreshCurrent() {
    const scr = currentScreen();
    if (!scr) return;
    try { if (scr.refresh) scr.refresh(); } catch (e) { console.error('[RR.UI] refresh failed', e); }
    refreshBinds(scr, false);
    if (current === 'menu') updateBadges();
  }

  function burst(node) {
    if (!node || reduced()) return;
    const b = node.querySelector('.upg-burst');
    if (!b) return;
    b.classList.remove('go');
    void b.offsetWidth;                   // event-driven restart (purchase), never per frame
    b.classList.add('go');
  }
  function shake(node) {
    if (!node || reduced() || !node.animate) return;
    node.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }

  function cycleVehicle(fromId, dir) {
    const d = S();
    const list = RR.Vehicles.list.filter((v) => d.unlockedVehicles.indexOf(v.id) >= 0);
    if (!list.length) return fromId;
    let i = list.findIndex((v) => v.id === fromId);
    if (i < 0) i = 0;
    i = (i + dir + list.length) % list.length;
    return list[i].id;
  }

  const ACTIONS = {
    back() { back(); },
    play() { show('vehicles'); },
    garage() { show('garage'); },
    worlds(arg) { show('worlds', { from: arg || null }); },
    missions() { show('missions'); },
    daily() { show('daily'); },
    settings(arg) { show('settings', { from: arg || null }); },

    selectVehicle(id) {
      const st = RR.Progression.vehicleStatus(id);
      if (!st.unlocked) { play('error'); shake(screens.vehicles.el.querySelector('.veh-card[data-vid="' + id + '"] .veh-lock')); return; }
      if (S().selectedVehicle === id) return;
      RR.Progression.selectVehicle(id);
      play('click');
      screens.vehicles.refresh();
      if (game && game.refreshAttract) game.refreshAttract();
    },
    unlockVehicle(arg, btn) {
      if (modalBusy()) return;
      const [id, method] = String(arg).split('|');
      const v = RR.Vehicles.byId(id);
      const st = RR.Progression.vehicleStatus(id);
      const can = method === 'tokens' ? st.canTokens : st.canCoins;
      if (!v || !can) {
        play('error');
        shake(btn);
        toast(!st.levelOk ? 'Reach level ' + st.requiredLevel + ' first' : method === 'tokens' ? 'Not enough tokens' : 'Not enough coins', 'error');
        return;
      }
      const price = method === 'tokens' ? st.tokens + ' token' + (st.tokens === 1 ? '' : 's') : fmt(st.coins) + ' coins';
      confirm('UNLOCK ' + v.name.toUpperCase() + '?', 'Spend ' + price + ' to unlock the ' + v.name + '?', 'UNLOCK', { icon: 'unlock' }).then((ok) => {
        if (!ok) return;
        // re-check: the status the dialog was built from may be stale by now
        if (RR.Progression.vehicleStatus(id).unlocked) { refreshCurrent(); return; }
        const res = RR.Progression.unlockVehicle(id, method);
        if (res.ok) {
          play('unlock');
          RR.Progression.selectVehicle(id);
          if (game && game.refreshAttract) game.refreshAttract();
          refreshCurrent();
          bumpWallet(currentScreen());
          const card = screens.vehicles.el.querySelector('.veh-card[data-vid="' + id + '"]');
          if (card && card.animate && !reduced()) card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 420 });
        } else {
          play('error');
          toast('Unlock failed (' + res.reason + ')', 'error');
        }
      });
    },
    start() {
      const d = S();
      if (game) game.startRun({ worldId: d.selectedWorld, vehicleId: d.selectedVehicle, daily: null });
    },
    upgradeVehicle(id) {
      if (!RR.Progression.vehicleStatus(id).unlocked) { play('error'); return; }
      show('garage', { from: 'vehicles', vehicleId: id });
    },
    garageStart() {
      const g = screens.garage;
      const t = g.runTarget();
      if (game) game.startRun({ worldId: t.worldId, vehicleId: g.vid, daily: t.daily });
    },
    convertTokens(arg, btn) {
      if (modalBusy()) return;
      const st = RR.Progression.tokenSinkStatus ? RR.Progression.tokenSinkStatus() : null;
      if (!st || !st.available) { play('error'); shake(btn); return; }
      const n = st.tokens;
      confirm('CONVERT ' + n + ' TOKEN' + (n === 1 ? '' : 'S') + '?', 'Trade ' + n + ' token' + (n === 1 ? '' : 's') + ' for ' + fmt(n * st.value) + ' coins to spend on upgrades?', 'CONVERT', { icon: 'token' }).then((ok) => {
        if (!ok) return;
        const res = RR.Progression.convertTokens();
        if (res && res.ok) {
          play('coinBig');
          toast('+' + fmt(res.coins) + ' coins for ' + res.tokens + ' token' + (res.tokens === 1 ? '' : 's'), 'reward');
          refreshCurrent();
          bumpWallet(currentScreen());
        } else { refreshCurrent(); }
      });
    },

    garageCycle(dir) {
      const g = screens.garage;
      const next = cycleVehicle(g.vid, parseInt(dir, 10) || 1);
      if (next === g.vid) { play('error'); toast('Unlock more vehicles in Vehicle Select', 'info'); return; }
      g.vid = next;
      RR.Progression.selectVehicle(next);
      play('whoosh', { volume: 0.5 });
      g.refresh();
      if (game && game.refreshAttract) game.refreshAttract();
    },
    upgrade(cat, btn) {
      const g = screens.garage;
      const res = RR.Progression.upgrade(g.vid, cat);
      const row = btn.parentNode;
      if (!res.ok) {
        play('error');
        shake(row);
        const msg = res.reason === 'max' ? 'Already maxed out' : res.reason === 'tier' ? 'Reach player level ' + res.requiredLevel + ' to upgrade further'
          : res.reason === 'coins' ? 'Need ' + fmt(res.cost - S().coins) + ' more coins' : 'Cannot upgrade';
        toast(msg, 'error', 2000);
        return;
      }
      play('upgrade');
      g.refresh(cat);
      burst(row);
      bumpWallet(g);
    },
    paint(pid, btn) {
      const g = screens.garage;
      const meta = RR.Progression.COSMETICS.find((p) => p.id === pid);
      if (!RR.Progression.isPaintUnlocked(pid)) {
        play('error');
        shake(btn);
        toast((meta ? meta.name : 'This paint') + ' unlocks at level ' + (meta ? meta.level : '?'), 'info', 2200);
        return;
      }
      if (RR.Progression.selectPaint(g.vid, pid)) {
        play('click');
        g.refresh();
        // repaint the menu's attract car in place (cheaper than rebuilding the run)
        const att = game && game.attract;
        if (att && att.vehicleId === g.vid) { att.colors = RR.Progression.getPaint(g.vid); if (game.requestRender) game.requestRender(); }
        else if (game && game.refreshAttract) game.refreshAttract();
      }
    },

    selectWorld(id) {
      if (!RR.Progression.selectWorld(id)) { play('error'); return; }
      play('click');
      if (game && game.refreshAttract) game.refreshAttract();
      const w = screens.worlds;
      if (w.from === 'vehicles') show('vehicles');
      else w.refresh();
    },
    playWorld(id) {
      if (!RR.Progression.selectWorld(id)) { play('error'); return; }
      const d = S();
      if (game) game.startRun({ worldId: id, vehicleId: d.selectedVehicle, daily: null });
    },
    unlockWorld(id, btn) {
      if (modalBusy()) return;
      const w = RR.Worlds.byId(id);
      const st = RR.Progression.worldStatus(id);
      if (!w || !st.canBuy) {
        play('error');
        shake(btn);
        toast(!st.levelOk ? 'Reach level ' + st.requiredLevel + ' first' : 'Need ' + fmt(st.coins - S().coins) + ' more coins', 'error');
        return;
      }
      confirm('UNLOCK ' + w.name.toUpperCase() + '?', 'Spend ' + fmt(st.coins) + ' coins to open ' + w.name + '?', 'UNLOCK', { icon: 'unlock' }).then((ok) => {
        if (!ok) return;
        if (RR.Progression.worldStatus(id).unlocked) { refreshCurrent(); return; }
        const res = RR.Progression.unlockWorld(id);
        if (res.ok) {
          play('unlock');
          RR.Progression.selectWorld(id);
          if (game && game.refreshAttract) game.refreshAttract();
          refreshCurrent();
          bumpWallet(currentScreen());
        } else { play('error'); toast('Unlock failed (' + res.reason + ')', 'error'); }
      });
    },

    claim(id, btn) {
      const res = RR.Missions.claim(id);
      if (!res.ok) { play('error'); shake(btn && btn.closest ? btn.closest('.mis-card') : btn); return; }
      play('coinBig');
      screens.missions.refresh(id);
      refreshBinds(screens.missions, false);
      bumpWallet(screens.missions);
      flushLevelUps();
    },
    claimBonus(arg, btn) {
      const res = RR.Missions.claimBonus();
      if (!res.ok) { play('error'); shake(btn); return; }
      play('unlock');
      screens.missions.refresh();
      refreshBinds(screens.missions, false);
      bumpWallet(screens.missions);
      fireConfetti(screenConfetti);
      toast('All-clear bonus claimed!', 'reward');
      flushLevelUps();
    },

    playDaily() {
      let ch = null;
      try { ch = RR.Daily.getChallenge(); } catch (e) { ch = null; }
      if (!ch) { play('error'); return; }
      if (game) game.startRun({ worldId: ch.worldId, vehicleId: S().selectedVehicle, daily: ch });
    },
    dailyVehicle(dir) {
      const next = cycleVehicle(S().selectedVehicle, parseInt(dir, 10) || 1);
      if (next === S().selectedVehicle) { play('error'); return; }
      RR.Progression.selectVehicle(next);
      play('click');
      screens.daily.refresh();
      if (game && game.refreshAttract) game.refreshAttract();
    },

    toggleSetting(key) {
      const s = S().settings;
      RR.Save.updateSettings({ [key]: !s[key] });
      play('click');
      screens.settings.refresh();
    },
    setSetting(arg) {
      const [key, val] = String(arg).split('|');
      RR.Save.updateSettings({ [key]: val });
      play('click');
      screens.settings.refresh();
    },
    howToPlay() { showTutorial(null); },
    resetSave() {
      if (modalBusy()) return;
      confirm('RESET ALL PROGRESS?', 'This permanently erases your coins, levels, unlocks, upgrades, records and missions. This cannot be undone.', 'RESET', { danger: true }).then((ok) => {
        if (!ok) return;
        RR.Save.reset();                                        // emits 'saveReset' → Game re-applies everything
        play('click');
        toast('Save data reset — a fresh start!', 'info');
        show('menu');
      });
    },

    resume() { if (game) game.resume(); },
    restart() { if (game) game.restart(); },
    quit() {
      if (modalBusy()) return;
      confirm('QUIT THIS RUN?', 'The run ends now. Coins and distance you already earned still count.', 'QUIT', { icon: 'quit' }).then((ok) => {
        if (ok && game && game.state === 'paused') game.quitRun();
      });
    },

    retry() { if (game) game.restart(); },
    toGarage() { if (game) game.quitToMenu('garage', { from: 'results' }); },
    toMenu() { if (game) game.quitToMenu('menu'); },

    modal(arg) { closeModal(arg === 'ok'); }
  };
  // Actions that play their own feedback sound.
  const SILENT = { convertTokens: 1, selectVehicle: 1, unlockVehicle: 1, garageCycle: 1, upgrade: 1, paint: 1, selectWorld: 1, unlockWorld: 1, claim: 1, claimBonus: 1, toggleSetting: 1, setSetting: 1, dailyVehicle: 1, resetSave: 1 };

  function onClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    const act = t.getAttribute('data-act');
    const fn = ACTIONS[act];
    if (!fn) return;
    // A card's own action only fires when the click wasn't on a nested control.
    if (t.tagName !== 'BUTTON' && e.target.closest('button') && e.target.closest('button') !== t) return;
    if (t.getAttribute('aria-disabled') === 'true' && act !== 'upgrade' && act !== 'unlockVehicle' && act !== 'unlockWorld' && act !== 'paint' && act !== 'claim' && act !== 'claimBonus') {
      play('error');
      shake(t);
      return;
    }
    if (!SILENT[act]) play('click');
    try { fn(t.getAttribute('data-arg'), t, e); } catch (err) { console.error('[RR.UI] action ' + act + ' failed', err); }
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    if (modalState) {
      if (e.key === 'Escape' && modalState.dismissable) { e.preventDefault(); closeModal(false); }
      return;
    }
    if (current === 'results' && e.key === 'Enter') {
      const a = document.activeElement;
      if (!a || a === document.body || a.getAttribute('data-act') === 'retry') {
        e.preventDefault();
        ACTIONS.retry();
      }
    }
  }

  // ---------------------------------------------------------------- public API
  function back() {
    if (modalState) { if (modalState.dismissable) closeModal(false); return; }
    const scr = currentScreen();
    if (scr && scr.back) { play('click'); scr.back(); }
  }

  function update(dt) {
    if (!initialized) return;
    dt = num(dt, 0);
    updateTweens(dt);
    const scr = currentScreen();
    if (!scr) return;
    animateWallet(dt, scr);
    previewClock += dt;
    previewAcc += dt;
    if (scr.canvases.length && previewAcc >= 1 / 30 && !(typeof document !== 'undefined' && document.hidden)) {
      previewAcc = 0;
      drawPreviews(scr, false);
    }
    secondAcc += dt;
    if (secondAcc >= 1) {
      secondAcc = 0;
      if (scr.tickSecond) { try { scr.tickSecond(); } catch (e) { /* ignore */ } }
    }
  }

  function onResize() {
    const scr = currentScreen();
    if (!scr) return;
    fitScreenCanvases(scr);
    drawPreviews(scr, true);
  }

  function showResults(summary, rewards, dailyResult, challenge) {
    resultsData = { summary: summary || {}, rewards: rewards || {}, dailyResult: dailyResult || null,
      challenge: challenge && typeof challenge === 'object' ? challenge : null };
    show('results');
  }

  function init(g) {
    if (initialized) return;
    game = g || null;
    uiRoot = document.getElementById('ui');
    modalRoot = document.getElementById('modal-root');
    if (!uiRoot || !modalRoot) { console.error('[RR.UI] missing #ui / #modal-root'); return; }
    initialized = true;
    try { reducedMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { reducedMq = null; }
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        for (const en of entries) { const p = en.target._preview; if (p) p.visible = en.isIntersecting; }
      }, { threshold: 0.01 });
    }
    for (const def of SCREEN_DEFS) register(def);
    buildModal();
    uiRoot.addEventListener('click', onClick);
    modalRoot.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown);
    if (RR.Bus) {
      RR.Bus.on('levelup', (p) => {
        if (!p) return;
        pendingLevelUps.push({ level: p.level, rewards: p.rewards || [] });
        // defer: the level-up may be one of several in a batch (and results decide when to show)
        setTimeout(flushLevelUps, 0);
      });
      RR.Bus.on('unlock', (p) => {
        if (!p) return;
        const item = p.kind === 'vehicle' ? RR.Vehicles.byId(p.id) : p.kind === 'world' ? RR.Worlds.byId(p.id) : null;
        if (item) toast(item.name + ' unlocked!', 'unlock', 3000);
      });
      RR.Bus.on('missionClaimed', () => updateBadges());
      // yesterday's completed-but-unclaimed missions were paid at midnight rollover
      RR.Bus.on('missionAutoClaim', (p) => {
        const rw = (p && p.reward) || {};
        const bits = [];
        if (rw.coins > 0) bits.push('+' + fmt(rw.coins) + ' coins');
        if (rw.xp > 0) bits.push('+' + fmt(rw.xp) + ' XP');
        if (rw.tokens > 0) bits.push('+' + rw.tokens + ' token' + (rw.tokens === 1 ? '' : 's'));
        if (bits.length) toast("Yesterday's missions paid: " + bits.join(' · '), 'mission', 4200);
        updateBadges();
        if (current === 'missions') refreshCurrent();
        else if (current) refreshBinds(screens[current], false);
      });
      // storage full / blocked: say it once instead of silently losing progress
      let saveErrorShown = false;
      RR.Bus.on('saveError', (p) => {
        if (saveErrorShown) return;
        saveErrorShown = true;
        const reason = p && p.reason;
        toast(reason === 'unavailable' ? 'Storage unavailable — progress lasts this session only'
          : "Progress can't be saved — browser storage is full or blocked", 'error', 6000);
        if (current === 'settings') screens.settings.refresh();
      });
      RR.Bus.on('wallet', () => { if (current === 'garage') refreshCurrent(); });
      RR.Bus.on('saveReset', () => {
        pendingLevelUps = [];
        for (const k of Object.keys(screens)) { const s = screens[k]; if (s.canvases) for (const p of s.canvases) p.drawn = false; }
        paintStamp++;
        refreshCurrent();
      });
      RR.Bus.on('settings', () => { if (current === 'settings') screens.settings.refresh(); });
    }
  }

  RR.UI = {
    init, show, back, update, onResize, confirm, showResults, showTutorial,
    toast: (text, kind, ms) => toast(text, kind, ms),
    refresh: refreshCurrent,
    updateBadges
  };
  Object.defineProperties(RR.UI, {
    current: { get: () => current, enumerable: true },
    modalOpen: { get: () => !!modalState, enumerable: true }
  });
})();
