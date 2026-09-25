// 10 · GYM — "THE GYM CHRONICLES": a late-night gym drawn in SVG, fake stats,
// a workout loading screen that never loads, and an excuse generator.
const EXCUSES = [
  'Leg day was yesterday. Also tomorrow.',
  'Gym was too far (it\'s 400 m).',
  'Anime episode was 24 minutes. Gym is also 24 minutes. Coincidence? No.',
  'Rest day. Day 47 of the rest week.',
  'Arrived at 23:59. Gym closed at 23:58. Unlucky.',
  'Muscles needed recovery from thinking about the gym.',
  'Couldn\'t find gym clothes. Found biryani instead.',
  'Free Fire ranked match went to overtime (3 hours).',
  'Was warming up (in bed, under a blanket).',
  'Pre-workout kicked in at 2 AM. Gym did not.',
  'Carrying the squad in BGMI counts as lifting.',
  'Walked to the fridge 40 times. That\'s cardio.',
  'The treadmill looked tired. Let it rest.',
  'Was about to go, then remembered he is SIR.',
  '"5 minutes." Said at 6 PM. It is now midnight.',
];

const LOAD_STEPS = [
  { t: 'Searching for motivation...', k: '' },
  { t: 'Motivation not found.', k: 'bad' },
  { t: 'Locating gym...', k: '' },
  { t: 'Gym found. Subject not found.', k: 'warn' },
  { t: 'Subject found. In bed.', k: 'bad' },
  { t: 'Retrying in 5 minutes...', k: '' },
  { t: '5 minutes later: still retrying...', k: 'warn' },
];

function scene(esc, nick) {
  // viewBox 1200×520 — wall on top, rubber floor from y=380
  return `
  <svg class="gym-svg" viewBox="0 0 1200 520" role="img" aria-label="A late-night gym: dumbbell rack, a treadmill with a very slow runner, a wall clock at 11:47 PM, a flickering neon sign, a water bottle and a mirror with a selfie flash." preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="gym-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c120b"/><stop offset="1" stop-color="#120c08"/></linearGradient>
      <linearGradient id="gym-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1410"/><stop offset="1" stop-color="#0d0a08"/></linearGradient>
      <pattern id="gym-rubber" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.4" fill="rgba(255,255,255,.05)"/></pattern>
      <linearGradient id="gym-mirror" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2a1e"/><stop offset=".5" stop-color="#241a12"/><stop offset="1" stop-color="#1a120c"/></linearGradient>
      <linearGradient id="gym-belt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a221c"/><stop offset="1" stop-color="#1c1612"/></linearGradient>
      <linearGradient id="gym-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b6b74"/><stop offset="1" stop-color="#2b2b31"/></linearGradient>
      <radialGradient id="gym-lamp" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="rgba(255,170,90,.28)"/><stop offset="1" stop-color="rgba(255,170,90,0)"/></radialGradient>
      <filter id="gym-neon" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="gym-flashblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>

    <!-- wall + floor -->
    <rect x="0" y="0" width="1200" height="380" fill="url(#gym-wall)"/>
    <rect x="0" y="0" width="1200" height="380" fill="url(#gym-lamp)"/>
    <rect x="0" y="380" width="1200" height="140" fill="url(#gym-floor)"/>
    <rect x="0" y="380" width="1200" height="140" fill="url(#gym-rubber)"/>
    <line x1="0" y1="380" x2="1200" y2="380" stroke="rgba(255,138,61,.25)" stroke-width="2"/>
    <line x1="0" y1="440" x2="1200" y2="440" stroke="rgba(255,255,255,.04)"/>
    <text x="24" y="508" class="gym-svg-mono" fill="rgba(255,255,255,.22)">FIG. 1 — TYPICAL 23:59 ARRIVAL · NOBODY ELSE IS HERE</text>

    <!-- neon sign -->
    <g class="gym-neon" transform="translate(70,48)">
      <rect x="0" y="0" width="420" height="120" rx="14" fill="none" stroke="#ff8a3d" stroke-width="3" filter="url(#gym-neon)"/>
      <text x="210" y="50" text-anchor="middle" class="gym-svg-neon gym-svg-neon-1" filter="url(#gym-neon)">OPEN 24/7</text>
      <text x="210" y="98" text-anchor="middle" class="gym-svg-neon gym-svg-neon-2" filter="url(#gym-neon)">${esc(nick)} ARRIVES AT 23:59</text>
    </g>

    <!-- wall clock: 11:47 PM -->
    <g transform="translate(760,120)">
      <circle r="62" fill="#0d0a08" stroke="#55453a" stroke-width="6"/>
      <circle r="54" fill="none" stroke="rgba(255,255,255,.08)"/>
      ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-50" x2="0" y2="${i % 3 === 0 ? -42 : -46}" stroke="${i % 3 === 0 ? '#ffe8c2' : '#8a7a6a'}" stroke-width="${i % 3 === 0 ? 3 : 2}" transform="rotate(${i * 30})"/>`).join('')}
      <line class="gym-hand-h" x1="0" y1="4" x2="0" y2="-28" stroke="#ffe8c2" stroke-width="5" stroke-linecap="round" transform="rotate(353.5)"/>
      <line class="gym-hand-m" x1="0" y1="6" x2="0" y2="-44" stroke="#ffe8c2" stroke-width="3.5" stroke-linecap="round" transform="rotate(282)"/>
      <g class="gym-hand-s"><line x1="0" y1="10" x2="0" y2="-48" stroke="#ff8a3d" stroke-width="1.6" stroke-linecap="round"/></g>
      <circle r="4" fill="#ff8a3d"/>
      <text x="0" y="96" text-anchor="middle" class="gym-svg-mono" fill="#ff8a3d">23:47 · STILL NOT HERE</text>
    </g>

    <!-- dumbbell rack -->
    <g transform="translate(70,240)">
      <rect x="0" y="0" width="24" height="140" fill="url(#gym-metal)"/>
      <rect x="326" y="0" width="24" height="140" fill="url(#gym-metal)"/>
      <rect x="0" y="52" width="350" height="12" rx="3" fill="#3a3a42"/>
      <rect x="0" y="122" width="350" height="12" rx="3" fill="#3a3a42"/>
      ${[0, 1, 2].map(i => `<g class="gym-db" transform="translate(${52 + i * 100},42)"><rect x="0" y="0" width="70" height="8" rx="4" fill="#8a8a94"/><rect x="-20" y="-12" width="22" height="32" rx="4" fill="#2a2a30" stroke="#5a5a64"/><rect x="68" y="-12" width="22" height="32" rx="4" fill="#2a2a30" stroke="#5a5a64"/></g>`).join('')}
      ${[0, 1, 2].map(i => `<g class="gym-db" transform="translate(${52 + i * 100},110)"><rect x="0" y="0" width="70" height="10" rx="5" fill="#8a8a94"/><rect x="-24" y="-16" width="26" height="42" rx="5" fill="#2a2a30" stroke="#5a5a64"/><rect x="68" y="-16" width="26" height="42" rx="5" fill="#2a2a30" stroke="#5a5a64"/></g>`).join('')}
      <text x="175" y="160" text-anchor="middle" class="gym-svg-mono" fill="rgba(255,255,255,.28)">DUST LEVEL: HISTORIC</text>
    </g>

    <!-- treadmill -->
    <g transform="translate(560,240)">
      <rect x="230" y="-30" width="14" height="150" rx="4" fill="url(#gym-metal)"/>
      <rect x="196" y="-52" width="80" height="34" rx="8" fill="#0a0806" stroke="#55453a" stroke-width="3"/>
      <text x="236" y="-30" text-anchor="middle" class="gym-svg-mono gym-svg-tiny" fill="#ff8a3d">0.1 km/h</text>
      <path d="M0 128 L250 128 L262 148 L-12 148 Z" fill="#2a2420" stroke="#4a3e34"/>
      <rect x="10" y="118" width="230" height="12" rx="6" fill="url(#gym-belt)"/>
      <line class="gym-belt" x1="12" y1="124" x2="238" y2="124" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="10 12"/>
      <!-- the runner (extremely slow) -->
      <g class="gym-runner" transform="translate(120,118)">
        <g class="gym-runner-body">
          <circle cx="0" cy="-92" r="12" fill="#ffe8c2"/>
          <line x1="0" y1="-80" x2="0" y2="-40" stroke="#ff8a3d" stroke-width="8" stroke-linecap="round"/>
          <g class="gym-arm gym-arm-l" transform="translate(0,-74)"><line x1="0" y1="0" x2="-4" y2="30" stroke="#ffe8c2" stroke-width="6" stroke-linecap="round"/></g>
          <g class="gym-arm gym-arm-r" transform="translate(0,-74)"><line x1="0" y1="0" x2="4" y2="30" stroke="#ffe8c2" stroke-width="6" stroke-linecap="round"/></g>
          <g class="gym-leg gym-leg-l" transform="translate(0,-40)"><line x1="0" y1="0" x2="-6" y2="40" stroke="#c9c9d6" stroke-width="7" stroke-linecap="round"/></g>
          <g class="gym-leg gym-leg-r" transform="translate(0,-40)"><line x1="0" y1="0" x2="6" y2="40" stroke="#c9c9d6" stroke-width="7" stroke-linecap="round"/></g>
        </g>
        <g class="gym-phone" transform="translate(-30,-60)"><rect x="0" y="0" width="12" height="20" rx="2" fill="#0a0806" stroke="#ffe8c2" stroke-width="1.5"/><rect x="2" y="3" width="8" height="12" fill="rgba(56,232,255,.65)"/></g>
      </g>
      <text x="125" y="172" text-anchor="middle" class="gym-svg-mono" fill="rgba(255,255,255,.28)">PACE: SLOWER THAN HIS REPLIES</text>
    </g>

    <!-- water bottle -->
    <g transform="translate(880,330)">
      <rect x="0" y="0" width="22" height="48" rx="6" fill="rgba(56,232,255,.28)" stroke="rgba(56,232,255,.75)" stroke-width="2"/>
      <rect x="3" y="26" width="16" height="20" rx="3" fill="rgba(56,232,255,.6)"/>
      <rect x="4" y="-9" width="14" height="10" rx="2" fill="#ff8a3d"/>
      <text x="11" y="66" text-anchor="middle" class="gym-svg-mono gym-svg-tiny" fill="rgba(255,255,255,.3)">UNOPENED</text>
    </g>

    <!-- mirror with the selfie -->
    <g transform="translate(990,60)">
      <rect x="0" y="0" width="160" height="290" rx="12" fill="url(#gym-mirror)" stroke="#5a4a3c" stroke-width="4"/>
      <line x1="20" y1="270" x2="140" y2="20" stroke="rgba(255,255,255,.07)" stroke-width="18"/>
      <line x1="50" y1="280" x2="150" y2="60" stroke="rgba(255,255,255,.04)" stroke-width="8"/>
      <g class="gym-selfie" transform="translate(80,150)">
        <circle cx="0" cy="-58" r="18" fill="#2a1e14"/>
        <path d="M-34 60 Q-34 -22 0 -26 Q34 -22 34 60 Z" fill="#2a1e14"/>
        <rect x="-40" y="-52" width="18" height="30" rx="3" fill="#0a0806" stroke="#ffe8c2" stroke-width="1.5"/>
        <circle class="gym-flash" cx="-31" cy="-46" r="6" fill="#fff"/>
      </g>
      <rect class="gym-flash-wash" x="0" y="0" width="160" height="290" rx="12" fill="#fff"/>
      <text x="80" y="318" text-anchor="middle" class="gym-svg-mono" fill="rgba(255,255,255,.28)">SETS: 0 · SELFIES: 14</text>
    </g>
  </svg>`;
}

export default {
  id: 'gym',
  title: 'The Gym Chronicles',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, motion, api, toast, blocks, wait, rand, pick, randInt } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name.split(' ')[0];

    el.innerHTML = `
      <div class="gym-floor" aria-hidden="true"></div>
      <div class="gym-lamp" aria-hidden="true"></div>
      <div class="container">
        <header class="sec-head gym-head">
          <span class="eyebrow">CASE FILE · FITNESS DIVISION · NIGHT SHIFT</span>
          <h2 class="display h1 gym-title">THE GYM <span class="gym-title-accent">CHRONICLES</span></h2>
          <p class="lead">${esc(first)} does go to the gym. Technically. At 23:59. For one selfie. This is the surveillance footage.</p>
        </header>

        <figure class="gym-scene glass" data-reveal>
          ${scene(esc, nick)}
          <figcaption class="gym-scene-cap mono"><span class="tag tag-red"><span class="dot"></span> LIVE</span> CAM 03 · MEMBERS PRESENT: <b>0</b> · MEMBERS "ON THE WAY": <b>1</b></figcaption>
        </figure>

        <div class="gym-grid">
          <section class="gym-stats glass panel" aria-label="Gym statistics" data-reveal>
            <h3 class="display h2 gym-h">PERFORMANCE <span class="gym-title-accent">DATA</span></h3>
            <div class="meter gym-meter">
              <span class="meter-label">Gym motivation</span>
              <span class="meter-value"><span class="gym-motivation">0</span>%</span>
              <div class="meter-track"><div class="meter-fill gym-fill-motivation"></div></div>
            </div>
            <div class="meter gym-meter">
              <span class="meter-label">Gym consistency</span>
              <span class="meter-value" aria-live="off"><span class="gym-consistency">???</span>%</span>
              <div class="meter-track"><div class="meter-fill gym-fill-consistency"></div></div>
            </div>
            <div class="meter gym-meter">
              <span class="meter-label">Arrival time</span>
              <span class="meter-value gym-late"><span class="gym-clock-icon" aria-hidden="true"></span> LATE</span>
              <div class="meter-track"><div class="meter-fill gym-fill-late"></div></div>
            </div>
            <div class="meter gym-meter">
              <span class="meter-label">Excuses</span>
              <span class="meter-value">${blocks(10)} <span class="gym-full">FULL</span></span>
              <div class="meter-track"><div class="meter-fill gym-fill-excuses"></div></div>
            </div>
            <dl class="kv gym-kv">
              <dt>Membership</dt><dd>Active (unused)</dd>
              <dt>Personal best</dt><dd>1 rep (lifting the phone)</dd>
              <dt>Sets completed</dt><dd>0 — "warming up" since March</dd>
            </dl>
            <p class="gym-disclaimer mono muted">Statistics are 100% fabricated by his friends. The lateness is real.</p>
          </section>

          <div class="gym-side">
            <section class="gym-loader-wrap glass panel" aria-label="Workout loading screen" data-reveal>
              <h3 class="display h2 gym-h">WORKOUT <span class="gym-title-accent">LOADER</span></h3>
              <p class="muted gym-sub">Initialise the full ${esc(nick)} training protocol. Estimated time: 5 minutes.*</p>
              <div class="gym-loader-actions">
                <button class="btn btn-lg gym-start" type="button">START WORKOUT</button>
                <span class="mono muted gym-tiny">*5 minutes in ${esc(nick)} time</span>
              </div>
              <div class="gym-loader" hidden aria-live="polite">
                <div class="gym-loader-top mono"><span class="gym-loader-label">LOADING WORKOUT.EXE</span><span class="gym-loader-pct">0%</span></div>
                <div class="gym-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="gym-bar-fill"></div></div>
                <div class="term gym-term"></div>
              </div>
              <div class="gym-result" hidden aria-live="polite">
                <div class="gym-result-card glow-border">
                  <span class="eyebrow">SESSION REPORT</span>
                  <div class="display gym-result-title">WORKOUT <span class="gym-title-accent">COMPLETE</span></div>
                  <ul class="gym-result-stats mono">
                    <li><b>1</b><span>selfie</span></li>
                    <li><b>0</b><span>reps</span></li>
                    <li><b>40</b><span>min on phone</span></li>
                  </ul>
                  <div class="row">
                    <button class="btn gym-retry" type="button">TRY AGAIN TOMORROW</button>
                    <button class="btn btn-ghost btn-sm gym-reset" type="button">RESET</button>
                  </div>
                </div>
              </div>
            </section>

            <section class="gym-excuse glass panel" aria-label="Excuse generator" data-reveal>
              <h3 class="display h2 gym-h">EXCUSE <span class="gym-title-accent">GENERATOR</span></h3>
              <p class="muted gym-sub">Certified reasons ${esc(nick)} did not go today. Fresh from the source.</p>
              <blockquote class="gym-excuse-out" aria-live="polite"><span class="gym-excuse-text">Press the button. He already has one ready.</span></blockquote>
              <div class="row">
                <button class="btn btn-ghost gym-gen" type="button">GENERATE EXCUSE</button>
                <span class="mono muted gym-tiny">excuses served: <b class="gym-excuse-count">0</b> / ∞</span>
              </div>
            </section>
          </div>
        </div>
      </div>`;

    const q = (s) => el.querySelector(s);

    // ── Stats: animate on section enter ───────────────────────
    let consistencyTimer = 0;
    ctx.onSectionEnter(el, () => {
      motion.countUp(q('.gym-motivation'), 87, { duration: 1.6 });
      q('.gym-fill-motivation').style.width = '87%';
      q('.gym-fill-late').style.width = '100%';
      q('.gym-fill-excuses').style.width = '100%';
      const cons = q('.gym-consistency'), consFill = q('.gym-fill-consistency');
      const glyphs = ['???', '??', '4', '0.5', 'NaN', '99', '-3', '12', 'idk', '∞', '0', '7', '3.14', '??', '1'];
      if (motion.reduced) { cons.textContent = '???'; consFill.style.width = '13%'; return; }
      const tick = () => { cons.textContent = pick(glyphs); consFill.style.width = randInt(3, 60) + '%'; };
      tick();
      consistencyTimer = setInterval(tick, 1000);
    });
    motion.onVisible(el, (vis) => { if (!vis && consistencyTimer) { clearInterval(consistencyTimer); consistencyTimer = 0; } else if (vis && !consistencyTimer && !motion.reduced && q('.gym-consistency').textContent !== '???') { consistencyTimer = setInterval(() => { q('.gym-consistency').textContent = pick(['???', '4', '0.5', 'NaN', '99', '-3', '12', 'idk', '∞', '0', '7']); q('.gym-fill-consistency').style.width = randInt(3, 60) + '%'; }, 1000); } });

    // Scene entrance: pieces of the gym drop in when the section is reached
    if (!motion.reduced) {
      const parts = el.querySelectorAll('.gym-svg > g');
      gsap.set(parts, { opacity: 0, y: 24 });
      ctx.onSectionEnter(el, () => { gsap.to(parts, { opacity: 1, y: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out' }); });
    }

    // ── Workout loader ────────────────────────────────────────
    const startBtn = q('.gym-start'), loader = q('.gym-loader'), result = q('.gym-result');
    const term = q('.gym-term'), fill = q('.gym-bar-fill'), pct = q('.gym-loader-pct'), bar = q('.gym-bar');
    let running = false;
    const setProgress = (v) => { fill.style.width = v + '%'; pct.textContent = Math.round(v) + '%'; bar.setAttribute('aria-valuenow', Math.round(v)); };
    const resetLoader = () => { loader.hidden = true; result.hidden = true; term.innerHTML = ''; setProgress(0); startBtn.disabled = false; startBtn.textContent = 'START WORKOUT'; };

    startBtn.addEventListener('click', async () => {
      if (running) return; running = true;
      startBtn.disabled = true; startBtn.textContent = 'LOADING…';
      result.hidden = true; term.innerHTML = ''; setProgress(0); loader.hidden = false;
      api.event('gym_load');
      if (!motion.reduced) gsap.fromTo(loader, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
      for (let i = 0; i < LOAD_STEPS.length; i++) {
        const s = LOAD_STEPS[i];
        const line = document.createElement('div'); line.className = 'gym-term-line ' + s.k; line.innerHTML = `<span class="dim">[${String(i + 1).padStart(2, '0')}]</span> ${esc(s.t)}`;
        term.appendChild(line);
        if (!motion.reduced) gsap.fromTo(line, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3 });
        sfx.play(s.k === 'bad' ? 'error' : 'tick');
        // progress goes up, then loses confidence, then climbs again — like him
        const target = i === 1 ? 12 : i === 4 ? 38 : Math.min(96, (i + 1) * 15);
        setProgress(target);
        await wait(motion.reduced ? 250 : rand(700, 900));
      }
      setProgress(100);
      await wait(motion.reduced ? 100 : 450);
      loader.hidden = true; result.hidden = false;
      sfx.play('success');
      if (!motion.reduced) {
        gsap.fromTo(result, { opacity: 0, scale: 0.92, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.6)' });
        const r = result.getBoundingClientRect(); ctx.fx.confetti({ x: r.left + r.width / 2, y: r.top + 40, count: 40, colors: ['#ff8a3d', '#ffe8c2', '#ffffff'], power: 9 });
      }
      startBtn.disabled = false; startBtn.textContent = 'START WORKOUT (AGAIN?)';
      running = false;
    });
    q('.gym-retry').addEventListener('click', () => {
      toast.show({ icon: '🛏️', title: 'Tomorrow never comes.', body: 'It has been tomorrow for 3 years.' });
      if (!motion.reduced) motion.shake(q('.gym-result-card'), { intensity: 4, duration: 0.35 });
    });
    q('.gym-reset').addEventListener('click', resetLoader);

    // ── Excuse generator ──────────────────────────────────────
    const out = q('.gym-excuse-text'), count = q('.gym-excuse-count');
    let last = -1, served = 0;
    q('.gym-gen').addEventListener('click', () => {
      let i; do { i = Math.floor(Math.random() * EXCUSES.length); } while (i === last && EXCUSES.length > 1);
      last = i; served++; count.textContent = String(served);
      sfx.play('pop');
      if (motion.reduced) { out.textContent = EXCUSES[i]; return; }
      gsap.to(out, { opacity: 0, y: -8, duration: 0.15, onComplete: () => {
        out.textContent = EXCUSES[i];
        gsap.fromTo(out, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' });
      } });
      const btn = q('.gym-gen'); const r = btn.getBoundingClientRect();
      ctx.fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 10, color: '#ff8a3d', power: 5 });
    });
    motion.magnetic(startBtn);
  },
};
