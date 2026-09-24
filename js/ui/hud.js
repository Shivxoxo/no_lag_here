/* RIDGE RUSH — in-run heads-up display (RR.HUD).
 *
 * Contract §6.3. Builds its markup once into #hud (and toasts into #toasts), caches every element and
 * writes to the DOM only when a displayed value actually changes (bars use transforms, rings use
 * stroke-dashoffset, all quantised). No DOM nodes are created per frame: trick pops come from a fixed
 * pool, power-up chips are created once per power-up type, toasts are created on (rare) events only.
 *
 *   top-left    distance (big) + best + progress toward the best
 *   top-centre  fuel gauge (fixed-gradient bar masked from the right, low-fuel pulse + "LOW FUEL"),
 *               speed km/h, distance to the next fuel pickup, boss progress, pulsing warnings
 *   top-right   coins (animated count-up + bump) and a big pause button
 *   right       combo meter ×N with a draining ring        left: power-up chips with circular timers
 *   centre      banners (section / boss / record), stacked trick pops, crash stamp, screen flash
 *
 * Reads (all optional, guarded): run.distance, bestDistance, fuel, fuelMax, coins, bonusCoins, state,
 * crashReason, body.speedKmh()/vx/vy/x, collectibles.nextFuelDistance(x), tricks.combo {count,
 * multiplier, timer}, powerUps.list() [{type, remaining, duration, fraction}], boss {name, progress,
 * active}, env.fuelZone. Listens to RR.Bus 'missionComplete' for toasts.
 *
 * Contract additions (documented, never renames):
 *  - toast(text, kind, ms) — kinds: info mission unlock levelup reward mute unmute error record daily.
 *    Toasts live in #toasts and are visible in menus too (RR.UI uses them).
 *  - HUD raises the 'NEW RECORD!' banner itself (once per run, when distance passes a previous best
 *    ≥ 50 m) and plays RR.Audio 'record'; plays 'warning' once when fuel drops below 20 %.
 *  - The FPS counter follows RR.Save.data.settings.showFps (read each frame, no extra API); it also shows
 *    the renderer's dynamic render scale when below 100% (and the rendered quality in 'auto' mode).
 *  - visible (getter).
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const COMBO_TIMEOUT = (RR.CONST && RR.CONST.COMBO_TIMEOUT) || 4;
  const RING_R = 15;
  const RING_C = 2 * Math.PI * RING_R;          // power-up chip ring circumference
  const COMBO_R = 21;
  const COMBO_C = 2 * Math.PI * COMBO_R;
  const TRICK_POOL = 4;
  const TRICK_VISIBLE = 3;                     // older pops beyond this slot fade out early
  const TRICK_LIFE = 1.35;
  const WARNING_LIFE = 2.6;
  const BANNER_LIFE = 2.5;
  const MAX_TOASTS = 4;

  const PU_ICONS = { magnet: 'magnet', shield: 'shield', boost: 'boost', fuelboost: 'fuelboost', multiplier: 'multiplier', slowtime: 'slowtime' };
  const PU_COLORS = { magnet: '#ff5d8f', shield: '#4fd8ff', boost: '#ff8a2a', fuelboost: '#5be36b', multiplier: '#ffcc33', slowtime: '#b388ff' };
  const PU_NAMES = { magnet: 'MAGNET', shield: 'SHIELD', boost: 'BOOST', fuelboost: 'FUEL', multiplier: '2X COINS', slowtime: 'SLOW-MO' };

  const CRASH_TEXT = {
    head: 'Head over heels', headHit: 'Head over heels', head_hit: 'Head over heels', flip: 'Landed on the roof',
    flipped: 'Landed on the roof', upside: 'Stuck upside down', upsideDown: 'Stuck upside down', upside_down: 'Stuck upside down',
    stuck: 'Stuck upside down', lava: 'Melted in lava', rock: 'Flattened by a rock', rocks: 'Flattened by a rock',
    meteor: 'Hit by a meteor', drone: 'Zapped by a drone', lightning: 'Struck by lightning', ceiling: 'Hit the ceiling',
    fall: 'Fell into the abyss', hazard: 'Hazard hit'
  };
  const TOAST_ICONS = {
    info: 'info', mission: 'check', unlock: 'unlock', levelup: 'xp', reward: 'coin', mute: 'sound-off',
    unmute: 'sound', error: 'warning', record: 'trophy', daily: 'daily', upgrade: 'arrow-up',
    powerup: 'bolt', fuel: 'fuel', shield: 'shield'
  };
  const WARNING_ICONS = { bonus: 'coin', info: 'info', fuel: 'fuel', hazard: 'warning' };

  const icon = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"></use></svg>';
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const fmt = (n) => (U && U.formatInt ? U.formatInt(n) : String(Math.round(n)));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- state
  let initialized = false;
  let visible = false;
  let root = null;
  let toastRoot = null;
  const E = {};                       // cached elements
  const last = {};                    // last written values (change detection)
  let reducedMotion = false;
  let mq = null;
  const loggedErrors = Object.create(null);

  // animated coin counter
  let coinShown = 0, coinTarget = 0, lastBump = -1;
  // clocks (HUD time advances only while update() runs, i.e. while playing)
  let clock = 0;
  let speedTimer = 0, fuelHintTimer = 0;
  let recordShown = false, lowFuelArmed = true;
  let noFuelSub = '';
  let goalShown = false;
  // fps
  let fpsFrames = 0, fpsTime = 0;
  // warnings / banners / tricks
  let warnT = 0;
  const bannerQueue = [];
  let bannerT = 0, bannerOn = false;
  const pops = [];                    // {el, main, coins, t, on, slot}
  const chips = new Map();            // type → {el, ring, stamp, q, low}
  let chipStamp = 0;
  let comboLastCount = 0;

  function logOnce(key, e) {
    if (loggedErrors[key]) return;
    loggedErrors[key] = true;
    console.error('[RR.HUD] ' + key + ':', e);
  }

  function refreshReduced() {
    const s = RR.Save && RR.Save.data && RR.Save.data.settings;
    reducedMotion = !!(s && s.reducedMotion) || !!(mq && mq.matches);
  }

  // Web Animations helper (no forced reflow to restart CSS animations).
  function animate(el, frames, opts) {
    if (!el || typeof el.animate !== 'function') return null;
    try { return el.animate(frames, opts); } catch (e) { return null; }
  }

  function setText(key, el, value) {
    if (last[key] === value || !el) return;
    last[key] = value;
    el.textContent = value;
  }
  function setClass(key, el, cls, on) {
    if (last[key] === on || !el) return;
    last[key] = on;
    el.classList.toggle(cls, on);
  }

  // ---------------------------------------------------------------- build
  function build() {
    root = document.getElementById('hud');
    toastRoot = document.getElementById('toasts');
    if (!root) return false;
    let trickHtml = '';
    for (let i = 0; i < TRICK_POOL; i++) {
      trickHtml += '<div class="hud-pop"><div class="hud-pop-in"><span class="hud-pop-label"></span><span class="hud-pop-coins"></span></div></div>';
    }
    root.innerHTML =
      '<div class="hud-top">' +
        '<div class="hud-panel hud-dist" data-h="distPanel">' +
          '<div class="hud-dist-row"><span class="hud-dist-val" data-h="dist">0</span><span class="hud-unit">m</span></div>' +
          '<div class="hud-best-row">' + icon('flag') + '<span class="hud-best-label" data-h="bestLabel">BEST</span><span data-h="best">—</span></div>' +
          '<div class="hud-best-track"><i data-h="bestFill"></i></div>' +
        '</div>' +
        '<div class="hud-mid">' +
          '<div class="hud-panel hud-fuel" data-h="fuel">' +
            '<span class="hud-fuel-ic">' + icon('fuel') + '</span>' +
            '<div class="hud-fuel-bar"><div class="hud-fuel-grad"></div><div class="hud-fuel-empty" data-h="fuelEmpty"></div><div class="hud-fuel-ticks"></div></div>' +
            '<span class="hud-fuel-pct" data-h="fuelPct">100%</span>' +
          '</div>' +
          '<div class="hud-meta">' +
            '<span class="hud-speed">' + icon('speed') + '<b data-h="speed">0</b><small>km/h</small></span>' +
            '<span class="hud-nextfuel" data-h="nextFuel">' + icon('fuel') + '<b data-h="nextFuelVal">—</b><small>m</small></span>' +
            '<span class="hud-lowfuel">LOW FUEL</span>' +
          '</div>' +
          '<div class="hud-boss" data-h="boss">' +
            '<div class="hud-boss-name">' + icon('mountain') + '<span data-h="bossName">BOSS RUN</span><b data-h="bossPct">0%</b></div>' +
            '<div class="hud-boss-track"><i data-h="bossFill"></i><span class="hud-boss-flag">' + icon('flag') + '</span></div>' +
          '</div>' +
          '<div class="hud-warning" data-h="warning">' + icon('warning') + '<span data-h="warningText"></span></div>' +
        '</div>' +
        '<div class="hud-right">' +
          '<div class="hud-panel hud-coins" data-h="coinsPanel">' + icon('coin', 'hud-coin-ic') + '<span data-h="coins">0</span></div>' +
          '<button type="button" class="hud-pause" data-h="pause" aria-label="Pause">' + icon('pause') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="hud-powerups" data-h="powerups"></div>' +
      '<div class="hud-combo" data-h="combo">' +
        '<svg class="hud-combo-ring" viewBox="0 0 50 50" aria-hidden="true">' +
          '<circle class="bg" cx="25" cy="25" r="' + COMBO_R + '"></circle>' +
          '<circle class="fg" data-h="comboRing" cx="25" cy="25" r="' + COMBO_R + '" stroke-dasharray="' + COMBO_C.toFixed(2) + '" stroke-dashoffset="0"></circle>' +
        '</svg>' +
        '<div class="hud-combo-txt"><small>COMBO</small><b data-h="comboN">×2</b><em data-h="comboMult">+50%</em></div>' +
      '</div>' +
      '<div class="hud-banner" data-h="banner"><div class="hud-banner-title" data-h="bannerTitle"></div><div class="hud-banner-sub" data-h="bannerSub"></div></div>' +
      '<div class="hud-tricks" data-h="tricks">' + trickHtml + '</div>' +
      '<div class="hud-stamp" data-h="stamp"><div class="hud-stamp-main" data-h="stampMain"></div><div class="hud-stamp-sub" data-h="stampSub"></div></div>' +
      '<div class="hud-fps" data-h="fps"></div>' +
      '<div class="hud-flash" data-h="flash"></div>';

    const found = root.querySelectorAll('[data-h]');
    for (let i = 0; i < found.length; i++) E[found[i].getAttribute('data-h')] = found[i];
    const popEls = root.querySelectorAll('.hud-pop');
    for (let i = 0; i < popEls.length; i++) {
      pops.push({
        el: popEls[i],
        inner: popEls[i].firstChild,
        label: popEls[i].querySelector('.hud-pop-label'),
        coins: popEls[i].querySelector('.hud-pop-coins'),
        t: 0, on: false, slot: 0
      });
    }
    if (E.pause) {
      E.pause.addEventListener('click', (e) => {
        e.preventDefault();
        if (RR.Audio) RR.Audio.play('click');
        if (RR.Game && typeof RR.Game.pause === 'function') RR.Game.pause();
      });
    }
    return true;
  }

  // ---------------------------------------------------------------- public: lifecycle
  function init() {
    if (initialized) return;
    if (typeof document === 'undefined' || !document.getElementById) return;
    if (!build()) return;
    initialized = true;
    try { mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mq = null; }
    refreshReduced();
    if (RR.Bus) {
      RR.Bus.on('missionComplete', (p) => {
        const m = p && p.mission;
        if (!m) return;
        toast('Mission complete: ' + m.text, 'mission', 3600);
        if (RR.Audio) RR.Audio.play('mission');
      });
    }
  }

  function show(on) {
    visible = !!on;
    if (!root) return;
    root.classList.toggle('visible', visible);
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function reset(run) {
    if (!initialized) return;
    for (const k of Object.keys(last)) delete last[k];
    coinShown = 0; coinTarget = 0; lastBump = -1;
    clock = 0; speedTimer = 0; fuelHintTimer = 0;
    recordShown = false; lowFuelArmed = true; noFuelSub = ''; goalShown = false;
    fpsFrames = 0; fpsTime = 0;
    warnT = 0; bannerT = 0; bannerOn = false; bannerQueue.length = 0;
    comboLastCount = 0;
    E.warning.classList.remove('on');
    E.banner.classList.remove('on');
    E.stamp.classList.remove('on', 'nofuel');
    E.combo.classList.remove('on');
    E.boss.classList.remove('on');
    E.distPanel.classList.remove('record');
    E.fuel.classList.remove('low', 'critical', 'refuel');
    E.coins.textContent = '0';
    for (const p of pops) { p.on = false; p.t = 0; p.el.classList.remove('on'); }
    for (const c of chips.values()) { c.el.classList.remove('on', 'low'); c.q = -1; }
    refreshReduced();
    if (run) update(run, 0);
  }

  // ---------------------------------------------------------------- per-frame update
  function update(run, dt) {
    if (!initialized || !run) return;
    dt = num(dt, 0);
    if (dt < 0) dt = 0;
    clock += dt;
    try {
      if ((fpsFrames & 31) === 0) refreshReduced();
      updateDistance(run);
      updateFuel(run, dt);
      updateSpeed(run, dt);
      updateCoins(run, dt);
      updateCombo(run);
      updatePowerups(run);
      updateBoss(run);
      updateState(run);
      updateTransient(dt);
      updateFps(dt);
    } catch (e) {
      logOnce('update', e);
    }
  }

  function updateDistance(run) {
    const d = Math.max(0, Math.floor(num(run.distance, 0)));
    if (last.dist !== d) {
      last.dist = d;
      E.dist.textContent = fmt(d);
    }
    // Daily runs chase the challenge target instead of the personal best.
    const goal = run.mode === 'daily' && run.daily ? Math.floor(num(run.daily.targetDistance, 0)) : 0;
    if (goal > 0) {
      setText('bestLabel', E.bestLabel, 'GOAL');
      setText('best', E.best, fmt(goal) + ' m');
      const reached = d >= goal;
      const q = reached ? 1 : Math.round(U.clamp(d / goal, 0, 1) * 200) / 200;
      if (last.bestQ !== q) { last.bestQ = q; E.bestFill.style.transform = 'scaleX(' + q + ')'; }
      setClass('record', E.distPanel, 'record', reached);
      if (reached && !goalShown) {
        goalShown = true;
        banner('TARGET REACHED!', 'Daily challenge complete — keep going!', 'record');
        recordShown = true;
        if (RR.Audio) RR.Audio.play('record');
      }
      return;
    }
    setText('bestLabel', E.bestLabel, 'BEST');
    const best = Math.max(0, Math.floor(num(run.bestDistance, 0)));
    setText('best', E.best, best > 0 ? fmt(best) + ' m' : '—');
    const record = best >= 50 && d > best;
    let frac = best > 0 ? U.clamp(d / best, 0, 1) : 0;
    if (record) frac = 1;
    const q = Math.round(frac * 200) / 200;
    if (last.bestQ !== q) {
      last.bestQ = q;
      E.bestFill.style.transform = 'scaleX(' + q + ')';
    }
    setClass('record', E.distPanel, 'record', record);
    // Run announces the record itself; this is only a fallback if no 'record' banner arrived.
    if (record && !recordShown && run.mode !== 'attract') {
      recordShown = true;
      banner('NEW RECORD!', 'Past your best of ' + fmt(best) + ' m', 'record');
      if (RR.Audio) RR.Audio.play('record');
    }
  }

  function updateFuel(run, dt) {
    const max = num(run.fuelMax, 100) > 0 ? num(run.fuelMax, 100) : 100;
    const f = U.clamp(num(run.fuel, max) / max, 0, 1);
    const q = Math.round(f * 400) / 400;
    if (last.fuelQ !== q) {
      last.fuelQ = q;
      E.fuelEmpty.style.transform = 'scaleX(' + (1 - q).toFixed(4) + ')';
    }
    setText('fuelPct', E.fuelPct, Math.ceil(f * 100) + '%');
    const lvl = f < 0.1 ? 2 : f < 0.25 ? 1 : 0;
    if (last.fuelLvl !== lvl) {
      last.fuelLvl = lvl;
      E.fuel.classList.toggle('low', lvl >= 1);
      E.fuel.classList.toggle('critical', lvl === 2);
      root.classList.toggle('fuel-low', lvl >= 1);
    }
    if (f < 0.2 && lowFuelArmed && run.state === 'running') {
      lowFuelArmed = false;
      if (RR.Audio) RR.Audio.play('warning', { volume: 0.7 });
    } else if (f > 0.35) {
      lowFuelArmed = true;
    }
    setClass('refuel', E.fuel, 'refuel', !!(run.env && run.env.fuelZone));

    fuelHintTimer -= dt;
    if (fuelHintTimer <= 0) {
      fuelHintTimer = 0.25;
      let nf = Infinity;
      const c = run.collectibles;
      const bx = run.body && num(run.body.x, NaN);
      if (c && typeof c.nextFuelDistance === 'function' && Number.isFinite(bx)) {
        try { nf = num(c.nextFuelDistance(bx), Infinity); } catch (e) { nf = Infinity; logOnce('nextFuelDistance', e); }
      }
      const showHint = Number.isFinite(nf) && nf >= 0 && nf < 100000;
      setClass('nfOn', E.nextFuel, 'on', showHint);
      if (showHint) setText('nf', E.nextFuelVal, fmt(Math.max(0, Math.round(nf))));
    }
  }

  function updateSpeed(run, dt) {
    speedTimer -= dt;
    if (speedTimer > 0 && dt > 0) return;
    speedTimer = 0.1;
    const b = run.body;
    let kmh = 0;
    if (b) {
      if (typeof b.speedKmh === 'function') kmh = num(b.speedKmh(), 0);
      else kmh = Math.hypot(num(b.vx, 0), num(b.vy, 0)) * 3.6;
    }
    setText('speed', E.speed, String(Math.round(Math.max(0, kmh))));
  }

  function updateCoins(run, dt) {
    const target = Math.max(0, Math.floor(num(run.coins, 0) + num(run.bonusCoins, 0)));
    coinTarget = target;
    if (coinShown > target || dt === 0) coinShown = target;
    else if (coinShown < target) {
      const step = Math.max(1, (target - coinShown) * Math.min(1, dt * 9));
      coinShown = Math.min(target, coinShown + step);
      if (clock - lastBump > 0.12 && !reducedMotion) {
        lastBump = clock;
        animate(E.coinsPanel, [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
      }
    }
    const shown = Math.floor(coinShown);
    if (last.coins !== shown) {
      last.coins = shown;
      E.coins.textContent = fmt(shown);
    }
  }

  function updateCombo(run) {
    const c = run.tricks && run.tricks.combo;
    const count = c ? Math.floor(num(c.count, 0)) : 0;
    const on = count >= 2;
    setClass('comboOn', E.combo, 'on', on);
    if (!on) { comboLastCount = count; return; }
    if (count !== last.comboN) {
      last.comboN = count;
      E.comboN.textContent = '×' + count;
      const mult = num(c.multiplier, Math.min(3, 1 + 0.25 * (count - 1)));
      E.comboMult.textContent = '+' + Math.round((mult - 1) * 100) + '% COINS';
      if (count > comboLastCount && !reducedMotion) {
        animate(E.combo, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      }
    }
    comboLastCount = count;
    const full = num(c.timeout, COMBO_TIMEOUT) > 0 ? num(c.timeout, COMBO_TIMEOUT) : COMBO_TIMEOUT;
    const frac = U.clamp(num(c.timer, 0) / full, 0, 1);
    const q = Math.round(frac * 100);
    if (last.comboQ !== q) {
      last.comboQ = q;
      E.comboRing.setAttribute('stroke-dashoffset', (COMBO_C * (1 - q / 100)).toFixed(2));
      E.combo.classList.toggle('ending', q < 30);
    }
  }

  function chipFor(type) {
    let c = chips.get(type);
    if (c) return c;
    const T = RR.PowerUps && RR.PowerUps.TYPES && RR.PowerUps.TYPES[type];
    const color = (T && T.color) || PU_COLORS[type] || '#ffffff';
    const name = PU_NAMES[type] || (T && T.name) || String(type).toUpperCase();
    const el = document.createElement('div');
    el.className = 'hud-chip';
    el.style.setProperty('--chip', color);
    el.innerHTML =
      '<span class="hud-chip-dial">' +
        '<svg class="hud-chip-ring" viewBox="0 0 36 36" aria-hidden="true">' +
          '<circle class="bg" cx="18" cy="18" r="' + RING_R + '"></circle>' +
          '<circle class="fg" cx="18" cy="18" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="0"></circle>' +
        '</svg>' + icon(PU_ICONS[type] || 'bolt', 'hud-chip-ic') +
      '</span><span class="hud-chip-name">' + esc(name) + '</span>';
    E.powerups.appendChild(el);
    c = { el, ring: el.querySelector('.fg'), stamp: 0, q: -1, low: false, on: false };
    chips.set(type, c);
    return c;
  }

  function updatePowerups(run) {
    const pu = run.powerUps;
    chipStamp++;
    if (pu && typeof pu.list === 'function') {
      let list = null;
      try { list = pu.list(); } catch (e) { logOnce('powerUps.list', e); }
      if (list && list.length) {
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!it || !it.type) continue;
          const dur = num(it.duration, 0);
          if (dur <= 0) continue;                           // instant power-ups (fuel boost) have no chip
          const c = chipFor(it.type);
          c.stamp = chipStamp;
          let frac = num(it.fraction, NaN);
          if (!Number.isFinite(frac)) frac = num(it.remaining, 0) / dur;
          frac = U.clamp(frac, 0, 1);
          const q = Math.round(frac * 120);
          if (c.q !== q) {
            c.q = q;
            c.ring.setAttribute('stroke-dashoffset', (RING_C * (1 - q / 120)).toFixed(2));
          }
          const low = num(it.remaining, 99) < 2;
          if (c.low !== low) { c.low = low; c.el.classList.toggle('low', low); }
          if (!c.on) { c.on = true; c.el.classList.add('on'); }
        }
      }
    }
    for (const c of chips.values()) {
      if (c.on && c.stamp !== chipStamp) { c.on = false; c.el.classList.remove('on', 'low'); c.low = false; }
    }
  }

  function updateBoss(run) {
    const b = run.boss;
    const on = !!(b && b.active);
    setClass('bossOn', E.boss, 'on', on);
    if (!on) return;
    setText('bossName', E.bossName, String(b.name || 'BOSS RUN'));
    const p = U.clamp(num(b.progress, 0), 0, 1);
    const q = Math.round(p * 200) / 200;
    if (last.bossQ !== q) {
      last.bossQ = q;
      E.bossFill.style.transform = 'scaleX(' + q + ')';
      E.bossPct.textContent = Math.floor(q * 100) + '%';
    }
  }

  function crashText(reason) {
    if (!reason) return 'Wipe out!';
    const key = String(reason);
    if (CRASH_TEXT[key]) return CRASH_TEXT[key];
    return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  function updateState(run) {
    const st = run.state || 'running';
    if (last.state === st) return;
    last.state = st;
    if (st === 'crashed') {
      stamp('CRASHED!', crashText(run.crashReason), false);   // (Run fires the crash flash itself)
    } else if (st === 'nofuel') {
      stamp('OUT OF FUEL', noFuelSub || 'Coast as far as you can!', true);
    } else if (st === 'running') {
      E.stamp.classList.remove('on', 'nofuel');
    }
  }

  // The stamp owns the centre of the screen: any banner showing (or queued) yields to it.
  function stamp(main, sub, nofuel) {
    bannerQueue.length = 0;
    if (bannerOn) { bannerOn = false; E.banner.classList.remove('on'); }
    bannerT = 0;
    E.stampMain.textContent = main;
    E.stampSub.textContent = sub || '';
    E.stamp.classList.toggle('nofuel', !!nofuel);
    E.stamp.classList.add('on');
  }

  function updateTransient(dt) {
    if (warnT > 0) {
      warnT -= dt;
      if (warnT <= 0) E.warning.classList.remove('on');
    }
    if (bannerOn) {
      bannerT -= dt;
      if (bannerT <= 0) {
        bannerOn = false;
        E.banner.classList.remove('on');
        bannerT = -0.35;                                      // gap before the next queued banner
      }
    } else if (bannerQueue.length) {
      bannerT += dt;
      if (bannerT >= 0) showBanner(bannerQueue.shift());
    }
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= TRICK_LIFE || p.slot >= TRICK_VISIBLE) { p.on = false; p.el.classList.remove('on'); }
    }
  }

  function updateFps(dt) {
    fpsFrames++;
    const s = RR.Save && RR.Save.data && RR.Save.data.settings;
    const show = !!(s && s.showFps);
    setClass('fpsOn', E.fps, 'on', show);
    if (!show || dt <= 0) return;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const fps = Math.round((fpsFrames & 0xffff) / fpsTime);
      fpsFrames = 0; fpsTime = 0;
      // dynamic resolution readout: render scale (and the stepped-down quality in 'auto')
      let extra = '';
      const r = RR.Game && RR.Game.renderer;
      if (r && typeof r.renderScale === 'number' && r.renderScale < 0.999) extra += ' · ' + Math.round(r.renderScale * 100) + '%';
      if (r && r.qualitySetting === 'auto' && r.quality) extra += ' · ' + String(r.quality).toUpperCase();
      setText('fps', E.fps, fps + ' FPS' + extra);
    }
  }

  // ---------------------------------------------------------------- public: one-shots
  function popTrick(label, coins, color) {
    if (!initialized || !pops.length) return;
    // oldest active (or first free) pop gets recycled; everything else moves up one slot
    let slotEl = null;
    for (const p of pops) if (!p.on) { slotEl = p; break; }
    if (!slotEl) {
      slotEl = pops[0];
      for (const p of pops) if (p.t > slotEl.t) slotEl = p;
    }
    for (const p of pops) {
      if (p.on && p !== slotEl) {
        p.slot = Math.min(p.slot + 1, TRICK_POOL);
        p.el.style.setProperty('--slot', p.slot);
      }
    }
    const pop = slotEl;
    pop.slot = 0;
    pop.t = 0;
    pop.on = true;
    pop.el.style.setProperty('--slot', 0);
    pop.el.style.setProperty('--pop', color || '#ffcc33');
    pop.label.textContent = String(label || '');
    const c = Math.round(num(coins, 0));
    pop.coins.textContent = c > 0 ? '+' + fmt(c) : '';
    pop.el.classList.add('on');
    if (!reducedMotion) {
      animate(pop.inner, [
        { transform: 'scale(.4)', opacity: 0 },
        { transform: 'scale(1.18)', opacity: 1, offset: 0.55 },
        { transform: 'scale(1)', opacity: 1 }
      ], { duration: 320, easing: 'ease-out' });
    }
  }

  function banner(title, sub, kind) {
    if (!initialized) return;
    if (kind === 'record' && String(title).toUpperCase() !== 'TARGET REACHED!') {
      if (recordShown) return;
      recordShown = true;
    }
    // The OUT OF FUEL announcement is shown by the HUD's own (persistent) stamp instead.
    if (String(title).toUpperCase() === 'OUT OF FUEL') { noFuelSub = String(sub || ''); if (last.state === 'nofuel') E.stampSub.textContent = noFuelSub; return; }
    if (E.stamp.classList.contains('on')) return;          // crash / out-of-fuel stamp is showing
    if (bannerQueue.length >= 3) bannerQueue.shift();
    bannerQueue.push({ title: String(title || ''), sub: String(sub || ''), kind: kind || 'section' });
    if (!bannerOn && bannerT >= 0) bannerT = 0;
  }

  function showBanner(b) {
    let color = '';
    if (b.kind === 'section' && RR.Worlds && RR.Worlds.SECTION_INFO) {
      const info = RR.Worlds.SECTION_INFO;
      for (const k of Object.keys(info)) if (info[k].name === b.title) { color = info[k].color; break; }
    }
    E.banner.className = 'hud-banner kind-' + b.kind;
    E.banner.style.setProperty('--banner', color || '');
    E.bannerTitle.textContent = b.title;
    E.bannerSub.textContent = b.sub;
    // restart the entrance transition: the element was off, so toggling on animates
    E.banner.classList.add('on');
    bannerOn = true;
    bannerT = b.kind === 'boss' ? BANNER_LIFE + 0.6 : BANNER_LIFE;
  }

  function warning(text, kind) {
    if (!initialized) return;
    E.warning.className = 'hud-warning on kind-' + (kind || 'hazard');
    const ic = E.warning.querySelector('use');
    if (ic) ic.setAttribute('href', '#i-' + (WARNING_ICONS[kind] || 'warning'));
    E.warningText.textContent = String(text || '');
    warnT = WARNING_LIFE;
    if (!reducedMotion) {
      animate(E.warning, [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 280, easing: 'ease-out' });
    }
  }

  const FLASH = { crash: 'rgba(255,79,109,0.55)', damage: 'rgba(255,79,109,0.45)', white: 'rgba(255,255,255,0.6)', gold: 'rgba(255,204,51,0.45)', shield: 'rgba(79,216,255,0.5)', fuel: 'rgba(91,227,107,0.4)', boost: 'rgba(255,138,42,0.4)' };
  function flash(kind) {
    if (!initialized) return;
    const color = FLASH[kind] || FLASH.white;
    E.flash.style.background = color;
    const peak = reducedMotion ? 0.35 : 1;
    if (!animate(E.flash, [{ opacity: peak }, { opacity: 0 }], { duration: reducedMotion ? 220 : 420, easing: 'ease-out' })) {
      E.flash.style.opacity = '0';
    }
  }

  // Toasts are rare events (not per frame): creating nodes here is fine.
  function toast(text, kind, ms) {
    if (!toastRoot) toastRoot = typeof document !== 'undefined' && document.getElementById ? document.getElementById('toasts') : null;
    if (!toastRoot) return;
    kind = kind || 'info';
    while (toastRoot.children.length >= MAX_TOASTS) toastRoot.removeChild(toastRoot.lastChild);
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.innerHTML = '<span class="toast-ic">' + icon(TOAST_ICONS[kind] || 'info') + '</span><span class="toast-txt">' + esc(text) + '</span>';
    toastRoot.insertBefore(el, toastRoot.firstChild);
    // next frame: slide in
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
    raf(() => el.classList.add('in'));
    const life = num(ms, 2800);
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, Math.max(800, life));
    return el;
  }

  RR.HUD = { init, show, reset, update, popTrick, banner, toast, warning, flash };
  Object.defineProperty(RR.HUD, 'visible', { get: () => visible, enumerable: true });
})();
