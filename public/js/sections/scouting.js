// 03 · SCOUTING — broadcast-style scouting report: SIR FC crest, lower third,
// segmented attribute meters, radar chart, pitch heat map, floating football egg.
export default {
  id: 'scouting',
  title: 'Scouting Report',
  mount(el, ctx) {
    const { profile: P, photos, esc, gsap, sfx, motion, eggs, fx, toast, blocks } = ctx;
    const val = (v, fb) => (v == null || String(v).trim() === '') ? fb : String(v);
    const nick = val(P.nickname, 'SIR');
    const name = val(P.name, nick), position = val(P.position, 'Midfielder'), madeBy = val(P.made_by, 'his friends');
    const friends = Array.isArray(P.friends) ? P.friends.filter(Boolean) : [];
    const friend0 = friends[0] || 'Shiv';
    const number = val(P.age, '16');
    const birthYear = (() => { const d = new Date(P.birthday); return isNaN(d) ? '20XX' : String(d.getUTCFullYear()); })();
    const club = `${nick.toUpperCase()} FC`;
    const photo = photos.find(p => (p.tags || []).includes('football')) || photos.find(p => (p.tags || []).includes('hero')) || photos[0];

    const STATS = [
      { key: 'pas', label: 'PASSING', v: 4, short: 'PAS' },
      { key: 'ctl', label: 'BALL CONTROL', v: 5, short: 'CTL' },
      { key: 'pos', label: 'POSITIONING', v: 4, short: 'POS' },
      { key: 'dec', label: 'DECISION MAKING', v: 3, short: 'DEC' },
      { key: 'mis', label: `ABILITY TO MISS ${friend0.toUpperCase()}'S PERFECT PASS`, v: 10, short: 'MISS', max: true },
    ];
    const NOTES = [
      'Excellent midfielder whenever the ball is approximately 3 meters away from him.',
      `Has never once missed a ${friend0} pass on purpose. Has also never once received one.`,
      'Work rate: outstanding during the walk from the bench to the water bottles.',
      'Recommended role: false 9. False as in he said he would be there at 9.',
    ];
    const PHASES = [
      { id: 'h1', label: '1ST HALF', x: 127, y: 38, r: 13, cameo: true, read: 'BENCH · 94% OF MINUTES PLAYED (SEATED)' },
      { id: 'h2', label: '2ND HALF', x: 127, y: 66, r: 11, cameo: false, read: 'WATER BOTTLES · 100% HYDRATED · 0% INVOLVED' },
      { id: 'et', label: 'EXTRA TIME', x: 129, y: 12, r: 8, cameo: false, read: 'EXIT · LEFT EARLY. THE ANIME EPISODE WAS STARTING.' },
    ];
    const TICKER = [
      `BREAKING: ${nick} misses another perfect pass from ${friend0}`,
      `TRANSFER NEWS: the bench extends ${nick}'s contract until 2099`,
      `INJURY UPDATE: ${nick} pulled a muscle reaching for the remote`,
      `SELECTION: nationals squad announced. ${nick} not included. Again.`,
      `DISTANCE COVERED: 0.4 km (bench → water bottles × 12)`,
      `KICK-OFF DELAYED: ${nick} said he was "5 minutes away"`,
    ];

    // ── SVG builders ───────────────────────────────────────────
    const R = 108, CX = 150, CY = 150, N = STATS.length;
    const radarPt = (i, f) => { const a = -Math.PI / 2 + (i / N) * Math.PI * 2; return [CX + Math.cos(a) * R * f, CY + Math.sin(a) * R * f]; };
    const ring = (f) => STATS.map((_, i) => radarPt(i, f).map(n => n.toFixed(1)).join(',')).join(' ');
    const radarSvg = `
      <svg class="sc-radar-svg" viewBox="0 0 300 300" role="img" aria-label="Radar chart: ${STATS.map(s => `${s.label} ${s.v} out of 10`).join(', ')}">
        ${[0.2, 0.4, 0.6, 0.8, 1].map(f => `<polygon class="sc-rring" points="${ring(f)}"/>`).join('')}
        ${STATS.map((_, i) => { const [x, y] = radarPt(i, 1); return `<line class="sc-raxis" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
        <polygon class="sc-rpoly" points="${ring(0)}"/>
        ${STATS.map((s, i) => { const [x, y] = radarPt(i, 0); return `<circle class="sc-rdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`; }).join('')}
        ${STATS.map((s, i) => { const [x, y] = radarPt(i, 1.22); return `<text class="sc-rlbl${s.max ? ' is-max' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(s.short)}</text>`; }).join('')}
      </svg>`;
    const pitchSvg = `
      <svg class="sc-pitch" viewBox="0 0 140 90" role="img" aria-label="Pitch heat map: the subject's heat signature sits on the bench and the water bottles, not on the pitch.">
        <defs>
          <radialGradient id="sc-heat-g"><stop offset="0" stop-color="#ff3b3b" stop-opacity=".95"/><stop offset=".45" stop-color="#ff8a3d" stop-opacity=".6"/><stop offset="1" stop-color="#ffcc4d" stop-opacity="0"/></radialGradient>
          <radialGradient id="sc-heat-c"><stop offset="0" stop-color="#ffcc4d" stop-opacity=".55"/><stop offset="1" stop-color="#ffcc4d" stop-opacity="0"/></radialGradient>
          <pattern id="sc-stripes" width="10.5" height="68" patternUnits="userSpaceOnUse" x="10" y="11"><rect width="10.5" height="68" fill="rgba(255,255,255,.025)"/><rect width="5.25" height="68" fill="rgba(0,0,0,.08)"/></pattern>
        </defs>
        <rect class="sc-grass" x="10" y="11" width="105" height="68"/>
        <rect x="10" y="11" width="105" height="68" fill="url(#sc-stripes)"/>
        <g class="sc-lines">
          <rect x="10" y="11" width="105" height="68"/><line x1="62.5" y1="11" x2="62.5" y2="79"/><circle cx="62.5" cy="45" r="9.15"/>
          <rect x="10" y="24.85" width="16.5" height="40.3"/><rect x="98.5" y="24.85" width="16.5" height="40.3"/>
          <rect x="10" y="35.85" width="5.5" height="18.3"/><rect x="109.5" y="35.85" width="5.5" height="18.3"/>
          <circle cx="21" cy="45" r=".6" fill="currentColor"/><circle cx="104" cy="45" r=".6" fill="currentColor"/><circle cx="62.5" cy="45" r=".6" fill="currentColor"/>
        </g>
        <g class="sc-bench-area"><rect x="119" y="22" width="16" height="30" rx="1.5"/></g>
        <g class="sc-heat-cameo"><circle cx="62.5" cy="45" r="9" fill="url(#sc-heat-c)"/><text x="62.5" y="58" text-anchor="middle" class="sc-ptxt sc-ptxt-dim">3 min cameo</text></g>
        <g class="sc-heat-blob"><circle class="sc-heat-core" r="13" fill="url(#sc-heat-g)"/><circle class="sc-heat-pulse" r="4" fill="none" stroke="#ff3b3b" stroke-width=".5"/></g>
        <g class="sc-bench-area">
          <text x="127" y="36" text-anchor="middle" class="sc-ptxt">BENCH</text><text x="127" y="41" text-anchor="middle" class="sc-ptxt sc-ptxt-dim">(home)</text>
          ${[0, 1, 2].map(i => `<rect class="sc-bottle" x="${122 + i * 4}" y="62" width="2.2" height="6" rx=".6"/>`).join('')}
          <text x="127" y="75" text-anchor="middle" class="sc-ptxt">WATER</text>
          <text x="127" y="16" text-anchor="middle" class="sc-ptxt sc-ptxt-dim">EXIT ↗</text>
        </g>
        <g class="sc-heat-label"><line class="sc-heat-lead" x1="0" y1="0" x2="-14" y2="-10"/><text class="sc-ptxt sc-ptxt-hot" x="-15" y="-11.5" text-anchor="end">SUBJECT DETECTED</text></g>
      </svg>`;
    const crestSvg = `
      <svg class="sc-crest-svg" viewBox="0 0 120 140" aria-hidden="true">
        <path class="sc-crest-shield" d="M60 4 L110 20 V70 C110 104 84 126 60 136 C36 126 10 104 10 70 V20 Z"/>
        <path class="sc-crest-inner" d="M60 14 L100 27 V70 C100 98 78 116 60 125 C42 116 20 98 20 70 V27 Z"/>
        <text x="60" y="48" text-anchor="middle" class="sc-crest-txt">${esc(club)}</text>
        <g transform="translate(60 84)"><circle r="20" fill="#f4f4f8"/><path d="M0 -8 L7.6 -2.5 L4.7 6.5 L-4.7 6.5 L-7.6 -2.5 Z" fill="#111"/><path d="M0 -20 L0 -8 M7.6 -2.5 L19 -6 M4.7 6.5 L12 16 M-4.7 6.5 L-12 16 M-7.6 -2.5 L-19 -6" stroke="#111" stroke-width="2.2" fill="none"/></g>
        <text x="60" y="118" text-anchor="middle" class="sc-crest-est">EST. ${esc(birthYear)} · 0 TITLES</text>
        ${[-14, 0, 14].map(x => `<path class="sc-crest-star" d="M${60 + x} 26 l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z"/>`).join('')}
      </svg>`;
    const ballSvg = `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="#f6f6fa"/>
        <g fill="#15151c">
          <path d="M50 30 L66 42 L60 61 L40 61 L34 42 Z"/>
          <path d="M50 2 L58 12 L50 20 L42 12 Z" opacity=".9"/><path d="M4 42 L16 40 L22 52 L12 60 Z" opacity=".9"/><path d="M96 42 L84 40 L78 52 L88 60 Z" opacity=".9"/>
          <path d="M28 92 L36 80 L48 84 L44 96 Z" opacity=".9"/><path d="M72 92 L64 80 L52 84 L56 96 Z" opacity=".9"/>
        </g>
        <g stroke="#15151c" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M50 30 L50 20 M66 42 L78 52 M60 61 L64 80 M40 61 L36 80 M34 42 L22 52"/></g>
      </svg>`;

    el.innerHTML = `
      <div class="sc-bg" aria-hidden="true"><span class="sc-light sc-light-l"></span><span class="sc-light sc-light-r"></span><span class="sc-bglines"></span></div>
      <div class="container">
        <div class="sec-head sc-head">
          <span class="eyebrow">${esc(club)} · SCOUTING DEPARTMENT · MATCHDAY ${esc(number)}</span>
          <h2 class="display h1 sc-title">PROFESSIONAL <span class="accent">SCOUTING</span> REPORT</h2>
          <p class="lead">Full technical analysis of ${esc(name)}, ${esc(position)}. Filmed from the bench, because that is where the subject was.</p>
        </div>

        <!-- broadcast lower third -->
        <div class="sc-lower" data-reveal>
          <div class="sc-crest">${crestSvg}</div>
          <div class="sc-lower-main">
            <span class="sc-lower-kicker mono"><span class="tag tag-red"><span class="dot"></span> LIVE</span> PLAYER PROFILE</span>
            <span class="sc-lower-name display">${esc(name)}</span>
            <span class="sc-lower-sub mono">${esc(position.toUpperCase())} · #${esc(number)} · ${esc(club)} · <span class="bad">UNNATIONAL</span></span>
          </div>
          <div class="sc-scorebug mono" aria-label="Scoreboard">
            <span class="sc-team">${esc(club)}</span><b class="sc-score"><span class="sc-score-a">0</span> – <span class="sc-score-b">7</span></b><span class="sc-team">REALITY</span>
            <span class="sc-clock"><span class="sc-clock-min">90</span>+<span class="sc-clock-add">5</span>′ · <span class="blink">STILL ON BENCH</span></span>
          </div>
          <button class="sc-ball" type="button" aria-label="A floating football. Kick it.">
            <span class="sc-ball-bob"><span class="sc-ball-sphere">${ballSvg}<span class="sc-ball-shade"></span></span><span class="sc-ball-shadow"></span></span>
          </button>
        </div>

        <div class="sc-grid">
          <!-- attributes -->
          <div class="sc-card sc-stats" data-reveal>
            <div class="sc-card-head mono"><span>ATTRIBUTES</span><span class="muted">SCALE 0–10</span></div>
            <div class="sc-meters">
              ${STATS.map(s => `
              <div class="meter sc-meter${s.max ? ' is-max' : ''}" data-key="${s.key}" data-v="${s.v}">
                <span class="meter-label">${esc(s.label)}</span>
                <span class="meter-value"><span class="sc-blocks">${blocks(0)}</span><span class="sc-numwrap"><b class="sc-num">0</b>/10</span></span>
                <span class="meter-track"><i class="meter-fill"></i></span>
              </div>`).join('')}
              <div class="meter sc-meter sc-lockrow">
                <span class="meter-label">NATIONALS SELECTION</span>
                <button class="sc-lock mono" type="button" aria-label="Nationals selection is locked. Click to try anyway.">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path class="sc-lock-shackle" d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="12" rx="2"/><circle cx="12" cy="16" r="1.6"/></svg>
                  [LOCKED]
                </button>
                <span class="meter-track sc-locktrack"><i class="meter-fill"></i></span>
              </div>
            </div>
            <p class="sc-stats-foot mono muted">OVERALL: <b class="sc-overall">0</b> · POTENTIAL: <b>“5 MINUTES”</b> · ${photo ? `<button class="sc-photo-link" type="button">VIEW MATCH FOOTAGE ↗</button>` : 'FOOTAGE: LOST'}</p>
          </div>

          <!-- radar -->
          <div class="sc-card sc-radar" data-reveal>
            <div class="sc-card-head mono"><span>ATTRIBUTE RADAR</span><span class="muted">${esc(nick.toUpperCase())} vs. A NORMAL MIDFIELDER</span></div>
            ${radarSvg}
            <div class="sc-radar-legend mono"><span><i class="sc-leg sc-leg-sir"></i> ${esc(nick.toUpperCase())}</span><span><i class="sc-leg sc-leg-avg"></i> ANYONE ELSE</span></div>
          </div>

          <!-- heat map -->
          <div class="sc-card sc-heat" data-reveal>
            <div class="sc-card-head mono"><span>PITCH HEAT MAP</span><span class="muted">GPS TRACKER · BATTERY: BARELY USED</span></div>
            ${pitchSvg}
            <div class="sc-phases" role="group" aria-label="Match phase">
              ${PHASES.map((p, i) => `<button class="btn btn-ghost btn-sm sc-phase${i === 0 ? ' is-on' : ''}" type="button" data-phase="${i}" aria-pressed="${i === 0}">${esc(p.label)}</button>`).join('')}
            </div>
            <p class="sc-heat-read mono" aria-live="polite">${esc(PHASES[0].read)}</p>
          </div>

          <!-- scout notes -->
          <div class="sc-card sc-notes" data-reveal>
            <div class="sc-card-head mono"><span>SCOUT'S NOTES</span><span class="muted">CONFIDENTIAL · UNFORTUNATELY</span></div>
            <ul class="sc-note-list">
              ${NOTES.map((n, i) => `<li class="sc-note" style="--i:${i}"><span class="sc-note-n mono">NOTE ${String(i + 1).padStart(2, '0')}</span><p>${esc(n)}</p></li>`).join('')}
            </ul>
            <p class="sc-sign mono">— HEAD SCOUT, ${esc(madeBy.toUpperCase())}</p>
          </div>
        </div>

        <div class="sc-ticker" aria-hidden="true"><div class="sc-ticker-track">${[0, 1].map(() => `<span>${TICKER.map(t => `<i>${esc(t)}</i>`).join('')}</span>`).join('')}</div></div>
        <p class="sc-disclaimer mono muted">Statistics 100% fabricated by his friends. Scouts were not consulted.</p>
      </div>`;

    // ── refs ───────────────────────────────────────────────────
    const q = (s) => el.querySelector(s), qa = (s) => [...el.querySelectorAll(s)];
    const meters = qa('.sc-meter[data-v]'), overall = q('.sc-overall');
    const poly = q('.sc-rpoly'), dots = qa('.sc-rdot');

    // ── meters ─────────────────────────────────────────────────
    const setMeter = (m, k) => { m.querySelector('.sc-blocks').innerHTML = blocks(k); m.querySelector('.sc-num').textContent = k; m.querySelector('.meter-fill').style.width = `${k * 10}%`; };
    let meterTl = null;
    const animateMeters = ({ fast = false } = {}) => {
      meterTl?.kill(); meterTl = gsap.timeline();
      if (motion.reduced) { meters.forEach(m => setMeter(m, Number(m.dataset.v))); overall.textContent = avg(); return meterTl; }
      meters.forEach((m, i) => { const v = Number(m.dataset.v); for (let k = 1; k <= v; k++) meterTl.add(() => { setMeter(m, k); sfx.play('tick'); }, i * (fast ? 0.12 : 0.28) + k * (fast ? 0.04 : 0.07)); });
      meterTl.add(() => motion.countUp(overall, avg(), { duration: 0.8, format: v => v.toFixed(1) }), '>-0.2');
      return meterTl;
    };
    const avg = () => Number((STATS.reduce((s, x) => s + x.v, 0) / STATS.length).toFixed(1));

    // ── radar ──────────────────────────────────────────────────
    const radar = { k: 0 };
    const drawRadar = () => { const pts = STATS.map((s, i) => radarPt(i, (s.v / 10) * radar.k)); poly.setAttribute('points', pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')); pts.forEach(([x, y], i) => { dots[i].setAttribute('cx', x.toFixed(1)); dots[i].setAttribute('cy', y.toFixed(1)); }); };
    const animateRadar = (to = 1, { duration = 1.6 } = {}) => { gsap.killTweensOf(radar); if (motion.reduced) { radar.k = to; drawRadar(); return; } gsap.to(radar, { k: to, duration, ease: to ? 'elastic.out(1, 0.6)' : 'power3.in', onUpdate: drawRadar }); };

    // ── heat map phases ────────────────────────────────────────
    const blob = q('.sc-heat-blob'), core = q('.sc-heat-core'), label = q('.sc-heat-label'), cameo = q('.sc-heat-cameo'), heatRead = q('.sc-heat-read');
    const pos = { x: PHASES[0].x, y: PHASES[0].y, r: PHASES[0].r };
    const drawBlob = () => { blob.setAttribute('transform', `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`); label.setAttribute('transform', `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`); core.setAttribute('r', pos.r.toFixed(2)); };
    drawBlob();
    const setPhase = (i) => {
      const p = PHASES[i];
      qa('.sc-phase').forEach((b, k) => { b.classList.toggle('is-on', k === i); b.setAttribute('aria-pressed', String(k === i)); });
      heatRead.textContent = p.read; cameo.style.opacity = p.cameo ? 1 : 0;
      gsap.killTweensOf(pos);
      if (motion.reduced) { Object.assign(pos, { x: p.x, y: p.y, r: p.r }); drawBlob(); return; }
      gsap.to(pos, { x: p.x, y: p.y, r: p.r, duration: 1.1, ease: 'power3.inOut', onUpdate: drawBlob });
    };
    qa('.sc-phase').forEach(b => b.addEventListener('click', () => { sfx.play('whistle'); setPhase(Number(b.dataset.phase)); }));

    // ── padlock ────────────────────────────────────────────────
    const lock = q('.sc-lock'); let lockTries = 0;
    lock.addEventListener('click', () => {
      lockTries++; sfx.play('error');
      motion.shake(lock, { intensity: 6, duration: 0.45 });
      lock.classList.add('is-denied'); setTimeout(() => lock.classList.remove('is-denied'), 600);
      toast.show({ icon: '🔒', title: 'Access denied.', body: lockTries >= 3 ? 'Seriously. The selectors have left the building.' : 'Try again next season.', duration: 3200 });
    });

    // ── footage link ───────────────────────────────────────────
    q('.sc-photo-link')?.addEventListener('click', () => { const idx = photos.indexOf(photo); ctx.viewer.open(Math.max(0, idx)); ctx.api.event('photo_open', { id: photo.id, from: 'scouting' }); });

    // ── floating football + easter egg ─────────────────────────
    const ball = q('.sc-ball'), sphere = q('.sc-ball-bob');
    ball.addEventListener('click', () => { sfx.play('kick'); eggs.unlock('football'); });
    eggs.onUnlock('football', () => {
      const r = ball.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      sfx.play('whistle'); setTimeout(() => sfx.play('crowd'), 250);
      fx.burst({ x, y, count: 40, color: '#ffffff', power: 14, size: 5 });
      fx.emoji({ emoji: '⚽', count: 70, x, y, size: 16, rise: true });
      fx.emoji({ emoji: ['⚽', '🥅', '🟨'], count: 30, size: 22, rise: true });
      gsap.killTweensOf(sphere);
      if (motion.reduced) { gsap.set(sphere, { scale: 1, opacity: 1 }); }
      else gsap.timeline().to(sphere, { scale: 1.6, duration: 0.12, ease: 'power2.in' }).to(sphere, { scale: 0, opacity: 0, duration: 0.15 }).to(sphere, { scale: 1, opacity: 1, duration: 0.9, ease: 'elastic.out(1, 0.4)', delay: 1.6 });
      // every stat collapses to 0, then recovers
      meterTl?.kill(); animateRadar(0, { duration: 0.5 });
      const drop = gsap.timeline();
      meters.forEach((m, i) => drop.add(() => { setMeter(m, 0); sfx.play('hit'); }, i * 0.08));
      drop.add(() => { overall.textContent = '0.0'; el.classList.add('is-collapsed'); }, 0.4);
      drop.add(() => { el.classList.remove('is-collapsed'); animateMeters({ fast: true }); animateRadar(1); }, motion.reduced ? 0.5 : 1.4);
    });

    // ── entrance ───────────────────────────────────────────────
    let entered = false;
    ctx.onSectionEnter(el, () => ctx.onEnter(async () => {
      if (entered) return; entered = true;
      if (!motion.reduced) { sfx.play('whistle'); await ctx.wait(350); }
      animateMeters(); animateRadar(1);
      motion.countUp(q('.sc-score-b'), 7, { from: 0, duration: 2.2, format: v => Math.round(v) });
      gsap.fromTo(qa('.sc-note'), { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.7, stagger: 0.18, ease: 'power3.out', delay: 0.6 });
    }));
    if (!motion.reduced) gsap.set(qa('.sc-note'), { opacity: 0 });
  },
};
