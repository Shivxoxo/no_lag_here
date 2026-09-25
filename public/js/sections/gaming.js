// 07 · GAMING — SIR GAMING DIVISION: a battle-royale HUD for a player whose
// K/D is undefined and whose rage level is not.
const RANKS = [
  'Heroic (in stories only)', 'Grandmaster of Rage Quits', 'Diamond… a very cheap one', 'Bronze… of his own mind',
  'Platinum (screenshot was edited)', 'Legendary Camper, Tier IV', 'Conqueror of the Lobby Screen', 'Elite (self-declared)',
  'Ace of Alt+F4', 'Silver Surfer (loading screen division)', 'Master of "lag, bro"', 'Crown (from a birthday hat)',
];
const MOVES = [
  'Landing in the hot drop and immediately regretting it', 'Looting for 10 minutes, dying in 2 seconds',
  'Reviving a teammate directly into a grenade', 'Sprinting into the zone with zero ammo and full confidence',
  'Blaming ping at 24 ms', 'Throwing a gloo wall on his own head', 'Driving the squad off a cliff "as a strategy"',
  'Healing in the open while narrating his comeback', 'Spectating the whole match from the lobby (still late)',
  'Emote-dancing while the zone closes on him', 'Aiming at the sky, hitting a teammate',
];
const FEED = [
  '{N} was eliminated by a bot', '{N} knocked himself with his own grenade', 'Bot_7724 has been told about the pass',
  '{N} was eliminated by fall damage (from a 1 m ledge)', '{N} left the match (rage detected)', '{N} was eliminated by the zone while looting a bandage',
  '{N} shot 47 bullets. 0 hits. New record', '{N} was eliminated by his own vehicle', 'Teammate_Shiv revived {N} for the 6th time',
  '{N} used an emote. It was his last move', '{N} was eliminated by a player who was AFK', '{N} reported the bot for "hacking"',
  '{N} landed at Pochinok. Alone. Again', '{N} was eliminated 4 seconds after landing', 'Bot_1102 has taken {N}\'s loot and his dignity',
  '{N} tried to heal. The medkit was a screenshot', 'Squad wiped. {N} is still in the lobby saying "5 minutes"', '{N} threw a smoke on himself',
  '{N} was eliminated by Shiv (friendly fire, allegedly)', '{N} got a kill! (assist, from 200 m away, by Alex)',
];
const VERDICTS = [
  'Verdict: unplayable. Not the game — him.', 'Verdict: the bots have started a support group.', 'Verdict: talent detected. Lag detected too. Only one of them is real.',
  'Verdict: rank up requires attendance. Session missed.', 'Verdict: Booyah confirmed. Source: him.', 'Verdict: mechanically gifted at opening the settings menu.',
  'Verdict: classify as "support" — he supports the enemy team.', 'Verdict: reaction time exceeds the match duration.',
];
const HEX = () => '0x' + Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');

export default {
  id: 'gaming',
  title: 'Gaming Division',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, fx, motion, api, pick, shuffle, wait } = ctx;
    const N = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name || 'SIR';

    const GAMES = {
      ff: {
        name: 'FREE FIRE', code: 'FF', map: 'Bermuda', tag: 'BOOYAH: PENDING SINCE 2021', ammo: '30 / 0',
        loadout: [['PRIMARY', 'M1887 (never hits)'], ['PET', 'A cat that plays better'], ['CHARACTER', 'Whoever runs fastest away']],
        stats: [
          { label: 'AIM', kind: 'flicker', value: '???%', fill: 11 },
          { label: 'TACTICAL THINKING', kind: 'spinner', value: 'Loading…', fill: 0 },
          { label: 'REACTION TIME', kind: 'dots', value: 'Buffering', fill: 7 },
          { label: 'RAGE LEVEL', kind: 'rage', value: '██████████', fill: 100 },
          { label: 'K/D', kind: 'text', value: 'undefined', fill: 0 },
          { label: 'SURVIVAL TIME', kind: 'text', value: 'until first contact', fill: 4 },
          { label: 'HEADSHOTS', kind: 'text', value: 'in his dreams', fill: 2 },
          { label: 'RANK', kind: 'text', value: 'Bronze… of his own mind', fill: 9 },
        ],
      },
      bgmi: {
        name: 'BGMI', code: 'BG', map: 'Erangel', tag: 'CHICKEN DINNERS: 0 (BUT HE WAS THERE)', ammo: '40 / 0',
        loadout: [['PRIMARY', 'M416 + 6× scope, 0 reasons'], ['VEHICLE', 'Whatever he crashes first'], ['DROP', 'Pochinki. Alone. Again']],
        stats: [
          { label: 'AIM', kind: 'flicker', value: 'NaN%', fill: 9 },
          { label: 'TACTICAL THINKING', kind: 'spinner', value: 'Loading… 99%', fill: 0 },
          { label: 'REACTION TIME', kind: 'dots', value: 'Buffering', fill: 5 },
          { label: 'RAGE LEVEL', kind: 'rage', value: '██████████', fill: 100 },
          { label: 'K/D', kind: 'text', value: 'undefined', fill: 0 },
          { label: 'SURVIVAL TIME', kind: 'text', value: 'until the first footsteps', fill: 6 },
          { label: 'HEADSHOTS', kind: 'text', value: 'in his dreams (HD)', fill: 2 },
          { label: 'RANK', kind: 'text', value: 'Bronze… of his own mind', fill: 9 },
        ],
      },
    };
    const gameIds = Object.keys(GAMES);
    let game = 'ff';

    el.innerHTML = `
      <div class="gm-bg" aria-hidden="true"><div class="gm-grid"></div><div class="gm-scanlines"></div><div class="gm-vignette"></div></div>
      <div class="gm-xhair" aria-hidden="true">
        <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="14 7"/><path d="M32 4v14M32 46v14M4 32h14M46 32h14" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="2" fill="currentColor"/></svg>
      </div>
      <div class="container">
        <header class="sec-head gm-head">
          <span class="eyebrow" data-reveal>PLAYER FILE · ${esc(N)}_OFFICIAL · SERVER: ASIA (LAG BLAMED ANYWAY)</span>
          <h2 class="display h1 gm-title" data-reveal>${esc(N)} GAMING <span class="gm-title-acc">DIVISION</span></h2>
          <p class="lead" data-reveal>Two games. One player. Zero verified wins. The HUD below is live, biased and legally fictional.</p>
        </header>

        <div class="gm-hud" data-reveal>
          <div class="gm-topbar gm-panel">
            <div class="gm-bars">
              <div class="gm-bar" aria-label="Health 23 of 100"><span class="gm-bar-k mono">HP</span><span class="gm-bar-track"><span class="gm-bar-fill gm-hp" style="--w:23%"></span></span><span class="gm-bar-v mono">23 <small>/ 100 · regen: waiting for biryani</small></span></div>
              <div class="gm-bar" aria-label="Armor 0 of 100"><span class="gm-bar-k mono">ARMOR</span><span class="gm-bar-track"><span class="gm-bar-fill gm-armor" style="--w:0%"></span></span><span class="gm-bar-v mono">0 <small>/ 100 · plot armor only</small></span></div>
            </div>
            <div class="gm-ammo" aria-live="polite" aria-label="Ammo counter">
              <span class="gm-ammo-k mono">AMMO</span>
              <span class="gm-ammo-v display"><span class="gm-ammo-n">30</span><span class="gm-ammo-sep">/</span><span class="gm-ammo-r">0</span></span>
              <span class="gm-ammo-s mono">reserve: he forgot to loot</span>
            </div>
            <div class="gm-compass" aria-hidden="true"><div class="gm-compass-strip mono"><span>N</span><span>NE</span><span>E</span><span>SE</span><span>S</span><span>SW</span><span>W</span><span>NW</span><span>N</span><span>NE</span><span>E</span><span>SE</span><span>S</span><span>SW</span><span>W</span><span>NW</span></div><span class="gm-compass-pin"></span></div>
          </div>

          <div class="gm-main">
            <div class="gm-tabs" role="tablist" aria-label="Game">
              ${gameIds.map((id, i) => `<button class="gm-tab${i === 0 ? ' is-active' : ''}" role="tab" type="button" id="gm-tab-${id}" aria-selected="${i === 0}" aria-controls="gm-panel-${id}" tabindex="${i === 0 ? 0 : -1}"><span class="gm-tab-code mono">${GAMES[id].code}</span><span class="gm-tab-name display">${GAMES[id].name}</span><span class="gm-tab-tag mono">${esc(GAMES[id].tag)}</span></button>`).join('')}
            </div>
            <div class="gm-panel gm-stats" role="tabpanel" id="gm-panel-${game}" aria-labelledby="gm-tab-${game}">
              <div class="gm-stats-head"><span class="mono gm-stats-title">COMBAT PROFILE — <b class="gm-game-name">${GAMES[game].name}</b></span><span class="tag"><span class="dot blink"></span> LIVE</span></div>
              <ul class="gm-meters"></ul>
              <dl class="kv gm-loadout"></dl>
            </div>
          </div>

          <aside class="gm-side">
            <div class="gm-panel gm-minimap-panel">
              <div class="gm-panel-head mono"><span>MINIMAP</span><span class="gm-map-name">${esc(GAMES[game].map)}</span></div>
              <svg class="gm-minimap" viewBox="0 0 200 200" role="img" aria-label="Minimap. ${esc(N)} last seen in the hot drop.">
                <defs><radialGradient id="gm-mm-glow" r=".5"><stop offset="0" stop-color="#8b5cff" stop-opacity=".35"/><stop offset="1" stop-color="#8b5cff" stop-opacity="0"/></radialGradient><linearGradient id="gm-sweep" x1="0" x2="1"><stop offset="0" stop-color="#8b5cff" stop-opacity="0"/><stop offset="1" stop-color="#8b5cff" stop-opacity=".55"/></linearGradient></defs>
                <circle cx="100" cy="100" r="96" fill="#0b0716" stroke="rgba(139,92,255,.5)"/>
                <circle cx="100" cy="100" r="96" fill="url(#gm-mm-glow)"/>
                <g stroke="rgba(139,92,255,.22)" fill="none"><circle cx="100" cy="100" r="64"/><circle cx="100" cy="100" r="32"/><path d="M100 4v192M4 100h192"/></g>
                <g fill="rgba(139,92,255,.16)"><rect x="40" y="52" width="28" height="18" transform="rotate(-12 54 61)"/><rect x="120" y="120" width="34" height="22"/><rect x="60" y="130" width="18" height="30"/><rect x="128" y="44" width="22" height="22"/></g>
                <circle class="gm-zone" cx="100" cy="100" r="70" fill="none" stroke="#38e8ff" stroke-opacity=".7" stroke-dasharray="4 4"/>
                <circle class="gm-zone-next" cx="130" cy="86" r="30" fill="rgba(56,232,255,.06)" stroke="#38e8ff" stroke-opacity=".5"/>
                <g class="gm-sweep"><path d="M100 100 L100 4 A96 96 0 0 1 168 32 Z" fill="url(#gm-sweep)"/></g>
                <g class="gm-blip"><circle cx="138" cy="70" r="12" class="gm-blip-ring"/><circle cx="138" cy="70" r="4" fill="#ff3b3b"/></g>
                <g class="gm-mm-hot"><text x="138" y="52" text-anchor="middle" font-size="9" fill="#ffcc4d" font-family="JetBrains Mono, monospace">HOT DROP</text></g>
                <text x="100" y="16" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.6)" font-family="JetBrains Mono, monospace">N</text>
              </svg>
              <div class="gm-mm-foot mono"><span class="dot gm-mm-dot"></span> Last seen: hot drop <span class="muted">(unmoved for 3 matches)</span></div>
            </div>

            <div class="gm-panel gm-feed-panel">
              <div class="gm-panel-head mono"><span>KILL FEED</span><span class="gm-feed-count">4 events</span></div>
              <ul class="gm-feed" aria-live="polite" aria-relevant="additions"></ul>
            </div>
          </aside>

          <div class="gm-panel gm-analyzer">
            <div class="gm-an-left">
              <span class="eyebrow">SKILL ANALYZER v0.${esc(String(profile.age || 16))}</span>
              <p class="gm-an-copy">Feed ${esc(first)}'s last 100 matches into a neural network trained exclusively on group-chat screenshots.</p>
              <button class="btn btn-lg gm-analyze" type="button">ANALYZE GAMING SKILLS</button>
            </div>
            <div class="gm-scan" aria-hidden="true">
              <div class="gm-scan-read mono"><span class="gm-scan-hex">0x0000</span><span class="gm-scan-pct">0%</span></div>
              <div class="gm-scan-track"><div class="gm-scan-fill"></div></div>
              <div class="gm-scan-log mono"></div>
            </div>
            <div class="gm-result" aria-live="polite" hidden>
              <div class="gm-rank"><span class="gm-k mono">ASSIGNED RANK</span><span class="gm-rank-v display"></span></div>
              <div class="gm-sig"><span class="gm-k mono">SIGNATURE MOVE</span><p class="gm-sig-v"></p></div>
              <div class="gm-verdict"><span class="gm-k mono">VERDICT</span><p class="gm-verdict-v"></p></div>
            </div>
          </div>
        </div>
        <p class="gm-disclaimer mono muted" data-reveal>Stats generated by a very biased algorithm (Shiv). Skill levels are fictional. The rage is not.</p>
      </div>`;

    const q = (s) => el.querySelector(s);
    const tabs = [...el.querySelectorAll('.gm-tab')];
    const panel = q('.gm-stats'), meters = q('.gm-meters'), loadout = q('.gm-loadout'), gameName = q('.gm-game-name'), mapName = q('.gm-map-name');
    const feed = q('.gm-feed'), feedCount = q('.gm-feed-count');
    const ammoN = q('.gm-ammo-n'), ammoR = q('.gm-ammo-r'), ammoS = q('.gm-ammo-s'), ammoBox = q('.gm-ammo');
    const analyzeBtn = q('.gm-analyze'), scan = q('.gm-scan'), scanHex = q('.gm-scan-hex'), scanPct = q('.gm-scan-pct'), scanFill = q('.gm-scan-fill'), scanLog = q('.gm-scan-log');
    const result = q('.gm-result'), rankV = q('.gm-rank-v'), sigV = q('.gm-sig-v'), verdictV = q('.gm-verdict-v');
    const xhair = q('.gm-xhair');
    const line = (s) => s.replace(/\{N\}/g, N);

    // ── stats rendering ──────────────────────────────────────
    const valueHtml = (s) => {
      switch (s.kind) {
        case 'spinner': return `<span class="gm-spin" aria-hidden="true"></span><span>${esc(s.value)}</span>`;
        case 'dots': return `<span>${esc(s.value)}</span><span class="gm-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
        case 'rage': return `<span class="gm-rage">${esc(s.value)}</span>`;
        case 'flicker': return `<span class="gm-flick" data-v="${esc(s.value)}">${esc(s.value)}</span>`;
        default: return `<span>${esc(s.value)}</span>`;
      }
    };
    function renderStats(id, animate = true) {
      const g = GAMES[id];
      gameName.textContent = g.name; mapName.textContent = g.map;
      panel.id = `gm-panel-${id}`; panel.setAttribute('aria-labelledby', `gm-tab-${id}`);
      meters.innerHTML = g.stats.map(s => `
        <li class="meter gm-meter gm-meter-${s.kind}">
          <span class="meter-label">${esc(s.label)}</span>
          <span class="meter-value">${valueHtml(s)}</span>
          <span class="meter-track"><span class="meter-fill" style="--w:${s.fill}%"></span></span>
        </li>`).join('');
      loadout.innerHTML = g.loadout.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      ammoN.textContent = g.ammo.split('/')[0].trim(); ammoR.textContent = g.ammo.split('/')[1].trim(); ammo = Number(ammoN.textContent);
      const rows = meters.querySelectorAll('.gm-meter');
      if (animate && !motion.reduced) {
        gsap.fromTo(rows, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' });
        rows.forEach(r => { const f = r.querySelector('.meter-fill'); gsap.fromTo(f, { width: '0%' }, { width: f.style.getPropertyValue('--w'), duration: 1.1, ease: 'power3.out', delay: 0.2 }); });
      } else rows.forEach(r => { const f = r.querySelector('.meter-fill'); f.style.width = f.style.getPropertyValue('--w'); });
    }
    function selectTab(id, { focus = false } = {}) {
      if (!GAMES[id]) return;
      const changed = id !== game; game = id;
      tabs.forEach(t => { const on = t.id === `gm-tab-${id}`; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      if (changed) { sfx.play('whoosh'); renderStats(id, true); }
    }
    tabs.forEach(t => {
      t.addEventListener('click', () => selectTab(t.id.replace('gm-tab-', '')));
      t.addEventListener('keydown', (e) => {
        const i = tabs.indexOf(t); let n = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = tabs.length - 1;
        if (n < 0) return; e.preventDefault(); selectTab(tabs[n].id.replace('gm-tab-', ''), { focus: true });
      });
    });

    // ── kill feed ────────────────────────────────────────────
    const addFeed = (text, { kind = '', animate = true } = {}) => {
      const li = document.createElement('li'); li.className = `gm-feed-line ${kind}`; li.textContent = line(text);
      feed.prepend(li);
      while (feed.children.length > 7) feed.lastElementChild.remove();
      feedCount.textContent = `${feed.children.length} events`;
      if (animate && !motion.reduced) gsap.fromTo(li, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' });
    };
    ['{N} joined the match (late)', '{N} landed in the hot drop', '{N} picked up a bandage. Only a bandage', '{N} was eliminated by a bot'].forEach(t => addFeed(t, { animate: false }));

    // ── ammo / firing on the HUD background ──────────────────
    let ammo = 30, reloading = false;
    const hud = q('.gm-hud');
    hud.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, a, [role=tab], input, textarea, .gm-result, .gm-feed')) return;
      if (reloading) return;
      if (ammo <= 0) {
        reloading = true; ammoS.textContent = 'RELOADING… (he forgot the keybind)'; ammoBox.classList.add('is-reloading'); sfx.play('error');
        setTimeout(() => { ammo = Number(GAMES[game].ammo.split('/')[0]); ammoN.textContent = String(ammo); ammoS.textContent = 'reserve: he forgot to loot'; ammoBox.classList.remove('is-reloading'); reloading = false; sfx.play('success'); }, motion.reduced ? 300 : 1400);
        return;
      }
      ammo--; ammoN.textContent = String(ammo);
      sfx.play('laser');
      if (!motion.reduced) {
        fx.burst({ x: e.clientX, y: e.clientY, count: 10, color: '#c9b3ff', power: 6, size: 3, life: 500 });
        gsap.fromTo(xhair, { scale: 1.35 }, { scale: 1, duration: 0.25, ease: 'power2.out' });
        gsap.fromTo(ammoN, { scale: 1.2, color: '#fff' }, { scale: 1, color: '', duration: 0.3, ease: 'power2.out' });
      }
      if (ammo === 0) { ammoS.textContent = 'EMPTY — click to reload'; addFeed('{N} emptied a full mag. Hits: 0', { kind: 'bad' }); }
      else if (Math.random() < 0.18) addFeed(pick(['{N} fired. Nothing happened', '{N} hit a wall. The wall is fine', '{N} shot at a bush. It was a bush', '{N} missed a stationary target']), { kind: 'dim' });
    });

    // ── crosshair cursor ─────────────────────────────────────
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const xTo = gsap.quickTo(xhair, 'x', { duration: 0.12, ease: 'power2.out' }), yTo = gsap.quickTo(xhair, 'y', { duration: 0.12, ease: 'power2.out' });
    let aim = false;
    const setAim = (on) => { aim = on; el.classList.toggle('gm-aim', on); xhair.classList.toggle('on', on); };
    const aimAllowed = () => fine.matches && !motion.reduced;
    el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse' || !aimAllowed()) return; xTo(e.clientX); yTo(e.clientY); setAim(true); });
    el.addEventListener('pointermove', (e) => { if (!aim) { if (e.pointerType === 'mouse' && aimAllowed()) setAim(true); else return; } xTo(e.clientX); yTo(e.clientY); });
    el.addEventListener('pointerleave', () => setAim(false));
    motion.onChange((r) => { if (r) setAim(false); });

    // ── analyzer ─────────────────────────────────────────────
    let busy = false;
    analyzeBtn.addEventListener('click', async () => {
      if (busy) return; busy = true;
      analyzeBtn.disabled = true; analyzeBtn.textContent = 'ANALYZING…';
      result.hidden = true; scan.classList.add('on'); scanLog.textContent = '';
      api.event('gaming_analyze', { game });
      sfx.play('scan');
      const dur = motion.reduced ? 250 : 2500;
      const logs = ['> loading match history…', '> 100 matches found. 100 defeats found.', '> calculating K/D… division by zero', '> scanning for headshots… none', '> cross-referencing with group chat…', '> rage samples: ALL OF THEM', '> compiling verdict…'];
      const t0 = performance.now(); let li = 0, secondScan = false;
      await new Promise(res => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / dur);
          scanFill.style.width = (p * 100) + '%';
          scanPct.textContent = Math.round(p * 100 + (p < 1 ? (Math.random() - 0.5) * 6 : 0)).toString().padStart(2, '0') + '%';
          scanHex.textContent = HEX();
          const want = Math.floor(p * logs.length);
          while (li < want && li < logs.length) { scanLog.textContent += (li ? '\n' : '') + logs[li++]; sfx.play('tick'); }
          if (p > 0.5 && !secondScan) { secondScan = true; sfx.play('scan'); }
          if (p >= 1) res(); else requestAnimationFrame(tick);
        };
        tick();
      });
      scanLog.textContent += (li ? '\n' : '') + logs[logs.length - 1];
      scanPct.textContent = '100%'; scanHex.textContent = '0xDEAD';
      await wait(motion.reduced ? 50 : 250);
      scan.classList.remove('on');

      // results
      const rank = pick(RANKS), move = pick(MOVES), verdict = pick(VERDICTS), lines = shuffle(FEED).slice(0, 5);
      rankV.textContent = rank; sigV.textContent = move; verdictV.textContent = verdict;
      result.hidden = false;
      sfx.play('glitch');
      const r = analyzeBtn.getBoundingClientRect();
      if (!motion.reduced) {
        fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 30, color: '#8b5cff', power: 9 });
        motion.shake(hud, { intensity: 4, duration: 0.3 });
        gsap.fromTo(result.children, { opacity: 0, y: 18, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.14, ease: 'back.out(1.8)' });
        gsap.fromTo(rankV, { rotate: -6, scale: 0.6 }, { rotate: -2, scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.45)', delay: 0.1, onStart: () => sfx.play('boom') });
      }
      for (let i = 0; i < lines.length; i++) { addFeed(lines[i], { kind: i === lines.length - 1 ? 'bad' : '' }); if (!motion.reduced) { sfx.play('pop'); await wait(220); } }
      if (!motion.reduced) motion.shake(q('.gm-feed-panel'), { intensity: 2, duration: 0.25 });
      analyzeBtn.disabled = false; analyzeBtn.textContent = 'ANALYZE AGAIN (IT WON\'T HELP)';
      busy = false;
    });
    motion.magnetic(analyzeBtn);

    // ── boot ─────────────────────────────────────────────────
    renderStats(game, false);
    ctx.onSectionEnter(el, () => {
      renderStats(game, true);
      if (motion.reduced) return;
      const flick = () => { el.querySelectorAll('.gm-flick').forEach(f => { f.textContent = Math.random() < 0.5 ? f.dataset.v : pick(['??%', '?!?%', '0x??', 'null%', f.dataset.v]); }); };
      setInterval(flick, 900);
      setInterval(() => { if (Math.random() < 0.5) addFeed(pick(FEED), { kind: 'dim' }); }, 9000);
    });
  },
};
