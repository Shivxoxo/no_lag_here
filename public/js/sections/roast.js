// 12 · ROAST — industrial roast-engine console. The backend combines the
// jokes; this module is the heavy machinery around it (heat, dials, LEDs,
// dramatic reveal, ticker, easter egg).
const TOPICS = [
  ['RANDOM', null], ['FOOTBALL', 'football'], ['LATE', 'late'], ['ANIME', 'anime'],
  ['STUDY', 'study'], ['GAMING', 'gaming'], ['GYM', 'gym'], ['FOOD', 'food'],
];
const LEVELS = [
  { name: 'MILD', speed: 26, shake: 0, flash: 0.35, rot: -62 },
  { name: 'SPICY', speed: 14, shake: 6, flash: 0.6, rot: 0 },
  { name: 'NUCLEAR', speed: 6, shake: 14, flash: 0.9, rot: 62 },
];
const BACKUP = [
  "Bro has never met a perfect pass he couldn't ignore.",
  'His study timetable has been under construction since birth.',
  "He says 'five minutes' like time is a rumour.",
  'His anime watchlist has more commitment than his homework.',
  'Nationals called. They said "wrong number".',
  'In BGMI he lands hot and leaves cold.',
  'Gym at 6 AM? No. 6 PM. He just woke up.',
  'He does not miss passes. He specialises in them.',
];
const KIND_LABEL = { oneliner: 'ONE-LINER', setup: 'SETUP', punchline: 'PUNCHLINE', callback: 'CALLBACK' };

export default {
  id: 'roast',
  title: 'Roast Generator',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, eggs, fx, motion, api, toast, state } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name.split(' ')[0];
    const worldwideStart = Number(state.stats?.roasts_generated || 0);

    el.innerHTML = `
      <div class="roast-stripes roast-stripes-top" aria-hidden="true"></div>
      <div class="roast-glow" aria-hidden="true"></div>
      <div class="container">
        <div class="sec-head roast-head">
          <span class="eyebrow">MODULE 12 · INDUSTRIAL ROAST ENGINE v4.0 · SERIAL RE-${esc(String(profile.age))}-${esc(nick)}</span>
          <h2 class="display h1 roast-title">${esc(nick)} ROAST<br><span class="roast-title-sub">GENERATOR</span></h2>
          <p class="lead">Heavy machinery. Zero mercy. Every roast is assembled live from certified ${esc(first)} facts by the ${esc(profile.made_by || 'Shiv')} Roast Foundry.</p>
        </div>

        <div class="roast-console">
          <!-- ── CONTROL PANEL ─────────────────────────────── -->
          <div class="roast-panel roast-controls" data-reveal>
            <span class="roast-screw tl" aria-hidden="true"></span><span class="roast-screw tr" aria-hidden="true"></span><span class="roast-screw bl" aria-hidden="true"></span><span class="roast-screw br" aria-hidden="true"></span>
            <div class="roast-plate mono">CONTROL PANEL · UNIT 01</div>

            <dl class="roast-leds mono" aria-label="Engine status">
              <div><dt>ROAST ENGINE</dt><dd class="led-ok"><span class="led blink"></span><span class="roast-engine-state">ONLINE</span></dd></div>
              <div><dt>MERCY</dt><dd class="led-bad"><span class="led"></span>0%</dd></div>
              <div><dt>TARGET</dt><dd class="led-warn"><span class="led"></span>${esc(nick)} · LOCKED</dd></div>
              <div><dt>COOLANT</dt><dd class="led-bad"><span class="led"></span>NOT FOUND</dd></div>
            </dl>

            <div class="roast-gauge-wrap">
              <svg class="roast-gauge" viewBox="0 0 200 130" role="img" aria-label="Engine heat gauge">
                <defs>
                  <linearGradient id="roast-heat-grad" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stop-color="#ffcc4d"/><stop offset=".55" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ff3b3b"/>
                  </linearGradient>
                </defs>
                <path class="roast-gauge-track" d="M 20 110 A 80 80 0 0 1 180 110" pathLength="100"/>
                <path class="roast-gauge-fill" d="M 20 110 A 80 80 0 0 1 180 110" pathLength="100"/>
                <g class="roast-gauge-ticks" aria-hidden="true">
                  ${Array.from({ length: 11 }, (_, i) => { const a = Math.PI - (i / 10) * Math.PI; const x1 = 100 + Math.cos(a) * 66, y1 = 110 - Math.sin(a) * 66, x2 = 100 + Math.cos(a) * 60, y2 = 110 - Math.sin(a) * 60; return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join('')}
                </g>
                <line class="roast-gauge-needle" x1="100" y1="110" x2="100" y2="40" transform="rotate(-90 100 110)"/>
                <circle class="roast-gauge-hub" cx="100" cy="110" r="7"/>
                <text class="roast-gauge-text" x="100" y="100" text-anchor="middle"><tspan class="roast-heat-num">0</tspan>%</text>
              </svg>
              <div class="roast-gauge-label mono"><span>HEAT</span><span class="roast-heat-msg">NOMINAL</span></div>
            </div>

            <div class="roast-dials">
              <button class="roast-dial" type="button" data-dial="intensity" aria-label="Intensity dial. Current: SPICY. Click to change.">
                <span class="roast-dial-ring" aria-hidden="true"></span>
                <span class="roast-knob" aria-hidden="true"><span class="roast-knob-mark"></span></span>
                <span class="roast-dial-name mono">INTENSITY</span>
                <span class="roast-dial-val mono">SPICY</span>
              </button>
              <button class="roast-dial roast-dial-locked" type="button" data-dial="mercy" aria-label="Mercy dial. Welded shut at zero.">
                <span class="roast-dial-ring" aria-hidden="true"></span>
                <span class="roast-knob" aria-hidden="true"><span class="roast-knob-mark"></span></span>
                <span class="roast-dial-name mono">MERCY</span>
                <span class="roast-dial-val mono">WELDED</span>
              </button>
            </div>

            <div class="roast-topics" role="group" aria-label="Roast topic">
              <span class="roast-topics-label mono">TARGET WEAKNESS</span>
              <div class="roast-chips">
                ${TOPICS.map(([label, val], i) => `<button class="roast-chip mono" type="button" data-topic="${val ?? ''}" aria-pressed="${i === 0}">${label}</button>`).join('')}
              </div>
            </div>

            <div class="roast-fire-housing">
              <button class="btn btn-danger btn-lg roast-fire" type="button" aria-describedby="roast-fire-hint">
                <span class="roast-fire-label">ROAST HIM</span>
                <span class="roast-fire-loading mono" aria-hidden="true">IGNITING<span class="roast-dots"></span></span>
              </button>
              <span id="roast-fire-hint" class="roast-fire-hint mono">or press <kbd>R</kbd></span>
            </div>
          </div>

          <!-- ── DISPLAY ───────────────────────────────────── -->
          <div class="roast-panel roast-display" data-reveal>
            <span class="roast-screw tl" aria-hidden="true"></span><span class="roast-screw tr" aria-hidden="true"></span><span class="roast-screw bl" aria-hidden="true"></span><span class="roast-screw br" aria-hidden="true"></span>
            <div class="roast-plate mono"><span>OUTPUT MONITOR</span><span class="roast-plate-right"><span class="dot roast-rec"></span> LIVE</span></div>
            <div class="roast-screen" aria-live="polite" aria-atomic="true">
              <div class="roast-flash" aria-hidden="true"></div>
              <div class="roast-scanlines" aria-hidden="true"></div>
              <div class="roast-watermark display" aria-hidden="true">${esc(nick)}</div>
              <div class="roast-screen-foot mono" aria-hidden="true">SIGNAL STABLE · TARGET ${esc(nick)} · MERCY 0% · AWAITING OUTPUT</div>
              <div class="roast-idle mono">
                <span class="roast-idle-line">&gt; TARGET ACQUIRED: ${esc(profile.name.toUpperCase())}</span>
                <span class="roast-idle-line">&gt; KNOWN WEAKNESS: ${esc(String(profile.known_weakness || 'perfect passes').toUpperCase())}</span>
                <span class="roast-idle-line">&gt; AWAITING IGNITION<span class="cursor"></span></span>
              </div>
              <div class="roast-output" hidden>
                <p class="roast-text display"></p>
                <ul class="roast-parts" aria-label="Roast components"></ul>
                <span class="stamp roast-stamp" aria-hidden="true">ROASTED</span>
              </div>
              <div class="roast-overheat display" hidden>ENGINE OVERHEATED<span class="mono">— cooling down —</span></div>
              <div class="roast-classified" hidden>
                <span class="stamp roast-classified-stamp">CLASSIFIED</span>
                <span class="roast-classified-kicker mono">LEAKED FROM THE NATIONALS SELECTION FOLDER</span>
                <p class="roast-classified-text display"></p>
              </div>
            </div>
            <div class="roast-actions">
              <button class="btn btn-ghost btn-sm roast-copy" type="button" disabled>⧉ COPY</button>
              <button class="btn btn-ghost btn-sm roast-share" type="button" disabled>➦ SHARE</button>
              <span class="roast-topic-readout mono">TOPIC: <b>—</b></span>
            </div>
            <div class="roast-counters">
              <div class="roast-counter">
                <span class="roast-counter-label mono">ROASTS GENERATED WORLDWIDE</span>
                <span class="roast-counter-num display roast-num-world tabular">0</span>
              </div>
              <div class="roast-counter">
                <span class="roast-counter-label mono">THIS SESSION</span>
                <span class="roast-counter-num display roast-num-session tabular">0</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="roast-ticker" aria-label="Recent roasts">
        <span class="roast-ticker-tag mono">RECENT OUTPUT</span>
        <div class="roast-ticker-viewport"><div class="roast-ticker-track mono"><span class="roast-ticker-item">Loading recent roasts…</span></div></div>
      </div>
      <div class="roast-stripes roast-stripes-bottom" aria-hidden="true"></div>`;

    // ── refs ───────────────────────────────────────────────────
    const q = (s) => el.querySelector(s);
    const fireBtn = q('.roast-fire'), screen = q('.roast-screen'), idle = q('.roast-idle'), output = q('.roast-output');
    const textEl = q('.roast-text'), partsEl = q('.roast-parts'), stampEl = q('.roast-stamp'), flash = q('.roast-flash');
    const overheatEl = q('.roast-overheat'), classifiedEl = q('.roast-classified'), classifiedText = q('.roast-classified-text');
    const copyBtn = q('.roast-copy'), shareBtn = q('.roast-share'), topicReadout = q('.roast-topic-readout b');
    const numWorld = q('.roast-num-world'), numSession = q('.roast-num-session');
    const gaugeFill = q('.roast-gauge-fill'), needle = q('.roast-gauge-needle'), heatNum = q('.roast-heat-num'), heatMsg = q('.roast-heat-msg');
    const engineState = q('.roast-engine-state'), engineLed = engineState.closest('dd');
    const tickerTrack = q('.roast-ticker-track'), screenFoot = q('.roast-screen-foot');

    let topic = null, level = 1, heat = 0, busy = false, overheated = false, session = 0, world = worldwideStart, current = null, inView = false, lastLetterAt = 0;
    motion.magnetic(fireBtn);
    numWorld.textContent = world.toLocaleString();

    // ── heat gauge ────────────────────────────────────────────
    function setHeat(v, { animate = true } = {}) {
      heat = ctx.clamp(v, 0, 100);
      const rot = -90 + heat * 1.8;
      const msg = heat >= 100 ? 'CRITICAL' : heat >= 80 ? 'DANGER' : heat >= 50 ? 'HOT' : heat > 0 ? 'WARMING' : 'NOMINAL';
      heatMsg.textContent = msg; heatMsg.dataset.state = msg.toLowerCase();
      el.classList.toggle('is-hot', heat >= 80);
      if (motion.reduced || !animate) { gaugeFill.style.strokeDashoffset = 100 - heat; needle.setAttribute('transform', `rotate(${rot} 100 110)`); heatNum.textContent = Math.round(heat); return; }
      gsap.to(gaugeFill, { strokeDashoffset: 100 - heat, duration: 0.9, ease: 'power3.out' });
      const o = { r: parseFloat(needle.dataset.rot ?? -90), n: parseFloat(heatNum.textContent) || 0 };
      gsap.to(o, { r: rot, duration: 0.9, ease: 'elastic.out(1, 0.5)', onUpdate: () => needle.setAttribute('transform', `rotate(${o.r} 100 110)`) });
      gsap.to(o, { n: heat, duration: 0.7, ease: 'power3.out', onUpdate: () => { heatNum.textContent = Math.round(o.n); } });
      needle.dataset.rot = rot;
    }
    setHeat(0, { animate: false });

    async function overheat() {
      overheated = true; fireBtn.disabled = true;
      engineState.textContent = 'OVERHEATED'; engineLed.className = 'led-bad'; el.classList.add('is-overheated');
      output.hidden = true; idle.hidden = true; classifiedEl.hidden = true; overheatEl.hidden = false;
      sfx.play('error'); motion.shake(screen, { intensity: 10, duration: 0.6 });
      if (!motion.reduced) gsap.fromTo(overheatEl, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' });
      await ctx.wait(3000);
      overheatEl.hidden = true; if (current) output.hidden = false; else idle.hidden = false;
      engineState.textContent = 'ONLINE'; engineLed.className = 'led-ok'; el.classList.remove('is-overheated');
      setHeat(60); overheated = false; fireBtn.disabled = false; sfx.play('success');
      toast.show({ icon: '🧯', title: 'Engine cooled to 60%.', body: 'Coolant still not found. Continue.' });
    }

    // ── dials ─────────────────────────────────────────────────
    const intensityDial = q('[data-dial="intensity"]'), mercyDial = q('[data-dial="mercy"]');
    function applyLevel(animate = true) {
      const L = LEVELS[level];
      intensityDial.querySelector('.roast-dial-val').textContent = L.name;
      intensityDial.setAttribute('aria-label', `Intensity dial. Current: ${L.name}. Click to change.`);
      intensityDial.dataset.level = L.name.toLowerCase();
      const knob = intensityDial.querySelector('.roast-knob');
      if (motion.reduced || !animate) knob.style.transform = `rotate(${L.rot}deg)`; else gsap.to(knob, { rotate: L.rot, duration: 0.5, ease: 'back.out(2)' });
    }
    applyLevel(false);
    intensityDial.addEventListener('click', () => { level = (level + 1) % LEVELS.length; applyLevel(); sfx.play('tick'); if (level === 2) toast.show({ icon: '☢️', title: 'NUCLEAR intensity engaged.', body: 'His feelings have been notified.' }); });
    mercyDial.addEventListener('click', () => { sfx.play('error'); motion.shake(mercyDial, { intensity: 4, duration: 0.35 }); toast.show({ icon: '🔩', title: 'Mercy dial is welded shut.', body: 'Factory setting: 0%. Non-negotiable.' }); });
    mercyDial.querySelector('.roast-knob').style.transform = 'rotate(-62deg)';

    // ── topic chips ───────────────────────────────────────────
    const chips = [...el.querySelectorAll('.roast-chip')];
    chips.forEach(c => c.addEventListener('click', () => {
      chips.forEach(x => x.setAttribute('aria-pressed', String(x === c)));
      topic = c.dataset.topic || null; sfx.play('tick');
      if (!motion.reduced) gsap.fromTo(c, { scale: 0.9 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
    }));

    // ── ticker ────────────────────────────────────────────────
    async function loadHistory() {
      let rows = [];
      try { rows = await api.roastHistory(8); } catch { rows = []; }
      const items = (rows || []).map(r => r.text).filter(Boolean);
      const list = items.length ? items : ['No roasts on record yet. Be the first. He deserves it.'];
      const html = list.map(t => `<span class="roast-ticker-item">${esc(t)}</span><span class="roast-ticker-sep" aria-hidden="true">◆</span>`).join('');
      tickerTrack.innerHTML = html + html; // duplicated for a seamless loop
      tickerTrack.style.setProperty('--ticker-dur', `${Math.max(24, list.join(' ').length * 0.28)}s`);
    }

    // ── reveal helpers ────────────────────────────────────────
    function screenFlash() {
      if (motion.reduced) return;
      gsap.fromTo(flash, { opacity: LEVELS[level].flash }, { opacity: 0, duration: 0.7, ease: 'power2.out' });
    }
    function renderParts(parts) {
      partsEl.innerHTML = (parts || []).map(p => `<li class="roast-part"><span class="roast-part-kind mono">${esc(KIND_LABEL[p.kind] || String(p.kind).toUpperCase())}</span><span class="roast-part-text">${esc(p.text)}</span></li>`).join('');
      if (!motion.reduced) gsap.fromTo(partsEl.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.12, ease: 'power3.out' });
    }
    async function reveal(r) {
      current = r;
      idle.hidden = true; classifiedEl.hidden = true; overheatEl.hidden = true; output.hidden = false;
      partsEl.innerHTML = ''; textEl.textContent = '';
      gsap.set(stampEl, { opacity: 0 });
      topicReadout.textContent = String(r.topic || 'general').toUpperCase();
      sfx.play('boom'); screenFlash();
      const L = LEVELS[level];
      if (L.shake) motion.shake(screen, { intensity: L.shake, duration: 0.45 });
      const r0 = screen.getBoundingClientRect();
      fx.burst({ x: r0.left + r0.width / 2, y: r0.top + r0.height / 2, count: 24, color: '#ff3b3b', power: 9 });
      const speed = Math.min(L.speed, Math.max(4, 3000 / Math.max(1, r.text.length))); // long roasts type faster (≈3 s cap)
      await motion.typewriter(textEl, r.text, { speed, jitter: speed, onChar: (ch) => { if (ch !== ' ') sfx.play('type'); } });
      screenFoot.textContent = `OUTPUT #${session} · TOPIC ${String(r.topic || 'general').toUpperCase()} · ${r.parts?.length || 1} PART${(r.parts?.length || 1) === 1 ? '' : 'S'} · ${r.text.length} CHARS · MERCY 0%`;
      renderParts(r.parts);
      // stamp slam
      sfx.play('hit');
      if (motion.reduced) { gsap.set(stampEl, { opacity: 0.92, scale: 1, rotate: -12 }); }
      else {
        gsap.fromTo(stampEl, { opacity: 0, scale: 3.2, rotate: 8 }, { opacity: 0.92, scale: 1, rotate: -12, duration: 0.45, ease: 'power4.in', onComplete: () => motion.shake(screen, { intensity: 4, duration: 0.25 }) });
      }
      copyBtn.disabled = false; shareBtn.disabled = false;
    }

    // ── the button ────────────────────────────────────────────
    async function fire() {
      if (busy || overheated) return;
      busy = true; fireBtn.classList.add('is-loading'); fireBtn.setAttribute('aria-busy', 'true'); fireBtn.disabled = true;
      sfx.play('power');
      let r = null, fallback = false;
      try { r = await api.roast(topic); }
      catch (e) {
        fallback = true;
        const text = ctx.pick(BACKUP);
        r = { id: null, text, topic: topic || 'backup', parts: [{ kind: 'oneliner', text }], total_generated: world };
        toast.show({ icon: '📼', title: 'Roast engine offline — running on backup jokes', duration: 4200 });
      }
      fireBtn.classList.remove('is-loading'); fireBtn.removeAttribute('aria-busy'); fireBtn.disabled = false;
      session += 1; numSession.textContent = String(session);
      if (!motion.reduced) gsap.fromTo(numSession, { scale: 1.5, color: '#ff3b3b' }, { scale: 1, color: '#f2f2f6', duration: 0.6, ease: 'back.out(2)' });
      if (typeof r.total_generated === 'number' && r.total_generated !== world) { const from = world; world = r.total_generated; motion.countUp(numWorld, world, { from, duration: 1.2 }); }
      api.event('ai_run', { kind: 'roast', topic: r.topic, fallback });
      await reveal(r);
      if (!fallback) loadHistory();
      busy = false;
      setHeat(heat + 8);
      if (heat >= 100) overheat();
    }
    fireBtn.addEventListener('click', fire);

    // Keyboard: R fires a roast while the section is in view / focused
    // (ignored while the viewer is open, inside inputs, or mid-word typing).
    motion.onVisible(el, (v) => { inView = v; }, { rootMargin: '-15% 0px -15% 0px' });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const now = performance.now();
      if (e.key.toLowerCase() !== 'r') { if (e.key.length === 1) lastLetterAt = now; return; }
      if (e.repeat || ctx.viewer.isOpen || now - lastLetterAt < 450) return;
      if (!inView && !el.contains(document.activeElement)) return;
      e.preventDefault();
      if (!motion.reduced) gsap.fromTo(fireBtn, { scale: 0.94 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
      fire();
    });

    // ── copy / share ──────────────────────────────────────────
    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;left:-9999px'; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
      }
      toast.show({ icon: '📋', title: 'Copied. Send it to him.' }); sfx.play('success');
    }
    copyBtn.addEventListener('click', () => { if (current) copyText(current.text); });
    shareBtn.addEventListener('click', async () => {
      if (!current) return;
      const payload = { title: `${nick} ROAST GENERATOR`, text: `${current.text} — THE ${nick} ARCHIVES`, url: location.href.split('#')[0] + '#roast' };
      if (navigator.share) { try { await navigator.share(payload); api.event('ai_run', { kind: 'roast_share' }); return; } catch { /* cancelled → fall through */ } }
      copyText(payload.text);
    });

    // ── easter egg: "unnational" ──────────────────────────────
    eggs.onUnlock('secret-roast', () => {
      const lines = [
        `CLASSIFIED: The nationals selectors have a folder named '${nick}'. It is empty. Like his positioning.`,
        `CLASSIFIED: Nationals scouts reviewed ${first}'s footage for 4 minutes. 3 of those were the ball rolling past him.`,
      ];
      ctx.scrollTo('#roast');
      idle.hidden = true; output.hidden = true; overheatEl.hidden = true; classifiedEl.hidden = false;
      classifiedText.textContent = ctx.pick(lines);
      sfx.play('glitch'); screenFlash(); el.classList.add('is-classified');
      const stamp = classifiedEl.querySelector('.roast-classified-stamp');
      if (!motion.reduced) {
        gsap.fromTo(classifiedEl, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5 });
        gsap.fromTo(stamp, { opacity: 0, scale: 3, rotate: 6 }, { opacity: 0.95, scale: 1, rotate: -10, duration: 0.5, delay: 0.5, ease: 'power4.in', onComplete: () => { motion.shake(screen, { intensity: 8, duration: 0.4 }); sfx.play('hit'); } });
      }
      current = { text: classifiedText.textContent, topic: 'classified', parts: [] };
      topicReadout.textContent = 'CLASSIFIED'; copyBtn.disabled = false; shareBtn.disabled = false;
      setTimeout(() => el.classList.remove('is-classified'), 2500);
    });

    // ── section enter: counters + history ─────────────────────
    ctx.onSectionEnter(el, () => {
      motion.countUp(numWorld, world, { from: Math.max(0, world - 40), duration: 1.6 });
      loadHistory();
      if (!motion.reduced) {
        gsap.fromTo(el.querySelectorAll('.roast-leds > div'), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.12, delay: 0.3, onStart: () => sfx.play('tick') });
        gsap.fromTo(el.querySelectorAll('.roast-idle-line'), { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.35, delay: 0.5 });
      }
    });
    state.on('stats', (s) => { if (typeof s?.roasts_generated === 'number' && s.roasts_generated > world) { const from = world; world = s.roasts_generated; motion.countUp(numWorld, world, { from, duration: 1 }); } });
  },
};
