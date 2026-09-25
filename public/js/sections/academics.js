// 09 · ACADEMICS — a fake learning-management-system dashboard. Every value is fictional comedy.
export default {
  id: 'academics',
  title: 'Academic Performance',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, motion, pick, randInt, shuffle } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || (profile.name || 'Sir').split(' ')[0];
    const initials = (profile.name || 'S M').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

    const SUBJECTS = [
      { name: 'MATHEMATICS', attn: '4 min', hw: 'tomorrow', pages: '0.5', notes: 'a doodle', pens: '3', vibe: 12 },
      { name: 'PHYSICS', attn: '2 min', hw: 'tomorrow (the other tomorrow)', pages: '1 (the cover)', notes: 'a football sketch', pens: '2', vibe: 8 },
      { name: 'CHEMISTRY', attn: '90 sec', hw: 'what homework', pages: '0', notes: '"study periodic table" written 6×', pens: '5', vibe: 5 },
      { name: 'ENGLISH', attn: '6 min', hw: 'summary of an anime', pages: '0.25', notes: 'subtitles count', pens: '1', vibe: 26 },
      { name: 'BIOLOGY', attn: '3 min', hw: 'tomorrow', pages: '0.5', notes: 'drew a cell (it looks like biryani)', pens: '4', vibe: 14 },
      { name: 'HISTORY', attn: '5 min', hw: 'in the past', pages: '0.75', notes: 'timeline of missed passes', pens: '0 (borrowed)', vibe: 18 },
      { name: 'PHYSICAL EDUCATION', attn: '40 min', hw: 'gym at 11PM', pages: 'n/a', notes: 'rep count: 1', pens: '0', vibe: 61 },
    ];
    const TILES = [
      { key: 'prep', label: 'EXAM PREPARATION', to: 2, from: 0, trend: '▼ down from 3%', kind: 'bad', bars: [3, 2, 4, 2, 1, 2] },
      { key: 'lastmin', label: 'LAST-MINUTE STUDY', to: 98, from: 0, trend: '▲ up, obviously', kind: 'warn', bars: [40, 55, 70, 88, 96, 98] },
      { key: 'before', label: 'CONFIDENCE BEFORE EXAM', to: 100, from: 0, trend: '● stable delusion', kind: 'ok', bars: [100, 100, 100, 100, 100, 100] },
      { key: 'after', label: 'CONFIDENCE AFTER SEEING PAPER', to: 0, from: 100, trend: '▼ instant', kind: 'bad', bars: [100, 60, 20, 5, 0, 0] },
    ];
    const SLOT_TIMES = ['07:00', '10:00', '14:00', '19:00', '23:00'];
    const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const ACTIVITIES = ['Anime', '5 more minutes', 'Gym (late)', 'BGMI', 'Biryani break', 'Stare at book'];

    el.innerHTML = `
      <div class="ac-bg" aria-hidden="true"></div>
      <div class="container ac-wrap">
        <div class="sec-head ac-head">
          <span class="eyebrow">MODULE 08 · LEARNING MANAGEMENT SYSTEM · READ-ONLY EXPORT</span>
          <h2 class="display h1 ac-title">ACADEMIC PERFORMANCE ANALYSIS</h2>
          <p class="lead">Exported from a learning-management system that does not exist, for a student who is only sometimes present.</p>
        </div>

        <div class="ac-app" data-reveal>
          <header class="ac-topbar">
            <span class="ac-logo mono"><span class="ac-logo-mark" aria-hidden="true">◈</span>LMS<span class="ac-logo-dim">.exe</span></span>
            <nav class="ac-crumb mono" aria-label="Breadcrumb"><span>Dashboard</span><span class="ac-crumb-sep" aria-hidden="true">/</span><span>Students</span><span class="ac-crumb-sep" aria-hidden="true">/</span><span class="ac-crumb-cur">${esc(nick)}</span></nav>
            <span class="ac-sem mono">Semester: <b>ongoing (allegedly)</b></span>
            <button class="ac-panic mono" type="button" aria-pressed="false"><span class="ac-panic-dot" aria-hidden="true"></span><span class="ac-panic-text">PANIC MODE</span></button>
          </header>

          <div class="ac-body">
            <aside class="ac-side">
              <div class="ac-student">
                <span class="ac-avatar display" aria-hidden="true">${esc(initials)}</span>
                <div class="ac-student-info">
                  <strong>${esc(profile.name || 'Student')}</strong>
                  <span class="mono">ID: ${esc(String(profile.age || 16).padStart(2, '0'))}-UNNTL-${esc(String(randInt(1000, 9999)))}</span>
                  <span class="mono ac-student-status"><span class="dot"></span> Enrolled (physically)</span>
                </div>
              </div>
              <nav class="ac-subjects" aria-label="Subjects">
                <span class="ac-side-label mono">SUBJECTS · ${SUBJECTS.length}</span>
                <ul>${SUBJECTS.map((s, i) => `<li class="ac-subject ${i === 0 ? 'is-active' : ''}" data-i="${i}"><button type="button" class="ac-subject-btn" aria-pressed="${i === 0}"><span class="ac-subject-name">${esc(s.name)}</span><span class="ac-subject-bar" aria-hidden="true"><span style="--w:${s.vibe}%"></span></span><span class="ac-subject-pct mono">${s.vibe}%</span></button></li>`).join('')}</ul>
                <span class="ac-side-note mono">bar = "attendance (spiritual)"</span>
              </nav>
              <dl class="ac-side-kv mono">
                <div><dt>LAST LOGIN</dt><dd>2 min before exam</dd></div>
                <div><dt>STREAK</dt><dd>0 days</dd></div>
                <div><dt>PENDING</dt><dd>everything</dd></div>
              </dl>
            </aside>

            <div class="ac-main">
              <div class="ac-tiles">
                ${TILES.map(t => `<div class="ac-tile ac-tile-${t.kind}">
                  <span class="ac-tile-label mono">${esc(t.label)}</span>
                  <span class="ac-tile-value display tabular" data-from="${t.from}" data-to="${t.to}">${t.from}%</span>
                  <span class="ac-tile-trend mono">${esc(t.trend)}</span>
                  <span class="ac-tile-bars" aria-hidden="true">${t.bars.map(b => `<i style="--h:${Math.max(4, b)}%"></i>`).join('')}</span>
                </div>`).join('')}
              </div>

              <div class="ac-two">
                <section class="ac-card ac-chart-card" aria-label="Confidence during the exam">
                  <header class="ac-card-head"><h3 class="ac-card-title">Confidence during the exam</h3><span class="ac-card-meta mono">live · 180 min paper</span></header>
                  <div class="ac-chart"></div>
                  <p class="ac-card-foot mono">Peak at 0:00. Paper turned over at 0:30. Everything after that is a flat line and a prayer.</p>
                </section>
                <section class="ac-card ac-flow-card" aria-label="Study strategy detected">
                  <header class="ac-card-head"><h3 class="ac-card-title">Study strategy detected</h3><span class="ac-card-meta mono">pattern match: 100%</span></header>
                  <div class="ac-flow"></div>
                  <p class="ac-card-foot mono">Open book → stare at book → panic → submit. Repeats every exam. Efficiency: none.</p>
                </section>
              </div>

              <section class="ac-card ac-table-card" aria-label="Subject metrics">
                <header class="ac-card-head"><h3 class="ac-card-title">Subject metrics</h3><span class="ac-card-meta mono">not grades · never grades</span></header>
                <div class="ac-scroll">
                  <table class="ac-table">
                    <thead><tr><th scope="col">Subject</th><th scope="col">Attention span</th><th scope="col">Homework status</th><th scope="col">Pages read</th><th scope="col">Notes taken</th><th scope="col">Pens lost</th></tr></thead>
                    <tbody>${SUBJECTS.map((s, i) => `<tr data-i="${i}">
                      <th scope="row" data-label="Subject"><span class="ac-td-sub">${esc(s.name)}</span></th>
                      <td data-label="Attention span"><span class="ac-pill ac-pill-warn">${esc(s.attn)}</span></td>
                      <td data-label="Homework status">${esc(s.hw)}</td>
                      <td data-label="Pages read" class="tabular">${esc(s.pages)}</td>
                      <td data-label="Notes taken">${esc(s.notes)}</td>
                      <td data-label="Pens lost" class="tabular">${esc(s.pens)}</td>
                    </tr>`).join('')}</tbody>
                  </table>
                </div>
              </section>

              <section class="ac-card ac-tt-card" aria-label="Study timetable generator">
                <header class="ac-card-head">
                  <div><h3 class="ac-card-title">Study timetable</h3><span class="ac-card-meta mono">generator v0.2 · optimised for ${esc(first)}</span></div>
                  <button class="btn ac-tt-btn" type="button">GENERATE STUDY TIMETABLE</button>
                </header>
                <div class="ac-tt-stage" aria-live="polite">
                  <div class="ac-tt-empty mono">No timetable yet. Which, to be fair, is accurate.</div>
                </div>
              </section>

              <p class="ac-disclaimer mono">All values are fictional comedy. His real grades are between him and his teachers.</p>
            </div>
          </div>
          <div class="ac-panic-flash" aria-hidden="true"></div>
        </div>
      </div>`;

    const app = el.querySelector('.ac-app');

    // ── Sidebar subject buttons → highlight matching row ─────
    const rows = [...el.querySelectorAll('.ac-table tbody tr')];
    el.querySelectorAll('.ac-subject-btn').forEach((btn, i) => btn.addEventListener('click', () => {
      el.querySelectorAll('.ac-subject').forEach((li, j) => { li.classList.toggle('is-active', j === i); li.querySelector('button').setAttribute('aria-pressed', String(j === i)); });
      rows.forEach((r, j) => r.classList.toggle('is-hl', j === i));
      sfx.play('tick');
      const row = rows[i]; if (row && !motion.reduced) gsap.fromTo(row, { backgroundColor: 'rgba(159,216,255,.35)' }, { backgroundColor: 'rgba(159,216,255,.12)', duration: 0.8 });
      if (innerWidth < 1000) row?.scrollIntoView({ block: 'nearest', behavior: motion.reduced ? 'auto' : 'smooth' });
    }));

    // ── Chart: confidence during the exam (SVG line) ─────────
    // Rebuilt on resize: a compact viewBox on phones keeps axis text legible.
    const chartHost = el.querySelector('.ac-chart');
    let chartDrawn = false, chartTl = null, lastChartW = 0;
    const chartParts = () => ({ line: chartHost.querySelector('.ac-line'), area: chartHost.querySelector('.ac-area'), markers: [...chartHost.querySelectorAll('.ac-marker')], dotEnd: chartHost.querySelector('.ac-dot-end') });
    const buildChart = () => {
      const compact = chartHost.clientWidth < 520;
      const W = compact ? 400 : 720, H = compact ? 300 : 260, L = compact ? 42 : 50, R = 16, T = 24, B = 46, fs = compact ? 13 : 12;
      const X = m => L + (m / 180) * (W - L - R), Y = v => T + (1 - v / 100) * (H - T - B);
      const pts = [[0, 100], [0.4, 100], [0.8, 96], [1.2, 78], [1.6, 41], [2.2, 12], [3, 0], [166, 0], [168, 11], [170.5, 0], [180, 0]];
      const d = pts.map(([m, v], i) => `${i ? 'L' : 'M'}${X(m).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
      const area = `${d} L${X(180).toFixed(1)} ${Y(0).toFixed(1)} L${X(0).toFixed(1)} ${Y(0).toFixed(1)} Z`;
      const xt = compact ? [0, 60, 120, 180] : [0, 30, 60, 90, 120, 150, 180];
      chartHost.innerHTML = `
      <svg class="ac-chart-svg" viewBox="0 0 ${W} ${H}" style="--cfs:${fs}px" role="img" aria-label="Line chart: confidence starts at 100 percent and falls to 0 percent within the first 3 minutes of the exam, then stays at 0 for the remaining 177 minutes, with one tiny bump at minute 168.">
        <defs><linearGradient id="ac-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b7fc4" stop-opacity=".35"/><stop offset="1" stop-color="#2b7fc4" stop-opacity="0"/></linearGradient></defs>
        <g class="ac-grid">${[0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}%</text>`).join('')}</g>
        <g class="ac-axis">${xt.map(m => `<line x1="${X(m).toFixed(1)}" x2="${X(m).toFixed(1)}" y1="${Y(0)}" y2="${Y(0) + 5}"/><text x="${X(m).toFixed(1)}" y="${Y(0) + 20}" text-anchor="middle">${m}</text>`).join('')}<text class="ac-axis-title" x="${((L + W - R) / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">minutes into exam</text><text class="ac-axis-title" transform="rotate(-90)" x="${-(T + (H - T - B) / 2).toFixed(1)}" y="12" text-anchor="middle">confidence</text></g>
        <path class="ac-area" d="${area}"/>
        <path class="ac-line" d="${d}"/>
        <g class="ac-marker"><line x1="${X(3).toFixed(1)}" x2="${X(3).toFixed(1)}" y1="${T}" y2="${Y(0)}"/><text x="${(X(3) + 7).toFixed(1)}" y="${T + 12}">3:00 — sees the paper</text></g>
        <g class="ac-marker ac-marker-2"><text x="${(X(168) - 4).toFixed(1)}" y="${(Y(11) - 8).toFixed(1)}" text-anchor="end">remembers one formula</text></g>
        <circle class="ac-dot-start" cx="${X(0).toFixed(1)}" cy="${Y(100).toFixed(1)}" r="4"/>
        <circle class="ac-dot-end" cx="${X(180).toFixed(1)}" cy="${Y(0).toFixed(1)}" r="5"/>
      </svg>`;
      const { line, area: areaEl, markers, dotEnd } = chartParts();
      const len = line.getTotalLength();
      if (chartDrawn) { gsap.set(line, { strokeDasharray: len, strokeDashoffset: 0 }); gsap.set([areaEl, ...markers, dotEnd], { opacity: 1 }); dotEnd.classList.add('is-pulse'); }
      else { gsap.set(line, { strokeDasharray: len, strokeDashoffset: len }); gsap.set([areaEl, ...markers, dotEnd], { opacity: 0 }); }
    };
    const drawChart = () => {
      chartTl?.kill(); chartDrawn = true;
      const { line, area: areaEl, markers, dotEnd } = chartParts();
      if (motion.reduced) { gsap.set(line, { strokeDashoffset: 0 }); gsap.set([areaEl, ...markers, dotEnd], { opacity: 1 }); dotEnd.classList.add('is-pulse'); return; }
      chartTl = gsap.timeline({ delay: 0.5 })
        .to(line, { strokeDashoffset: 0, duration: 2.6, ease: 'power2.inOut' })
        .to(areaEl, { opacity: 1, duration: 0.8 }, 0.6)
        .to(markers[0], { opacity: 1, duration: 0.4 }, 0.9)
        .to(markers[1], { opacity: 1, duration: 0.4 }, 2.6)
        .to(dotEnd, { opacity: 1, duration: 0.3 }, 3.0)
        .add(() => dotEnd.classList.add('is-pulse'));
    };
    buildChart();
    new ResizeObserver(() => { const w = chartHost.clientWidth; if (w > 0 && Math.abs(w - lastChartW) > 40) { const crossed = (w < 520) !== (lastChartW < 520); lastChartW = w; if (crossed) buildChart(); } }).observe(chartHost);

    // ── Flow diagram: Open book → stare → panic → submit ─────
    const flowHost = el.querySelector('.ac-flow');
    const NODES = [{ t: 'Open book', i: '📖' }, { t: 'Stare at book', i: '👀' }, { t: 'Panic', i: '😱' }, { t: 'Submit', i: '📤' }];
    let flowTl = null;
    const buildFlow = () => {
      const vertical = flowHost.clientWidth < 520;
      const nw = 132, nh = 58;
      let vw, vh, pos;
      if (!vertical) { vw = 640; vh = 170; const gap = (vw - 24 - nw * 4) / 3; pos = NODES.map((_, i) => ({ x: 12 + i * (nw + gap), y: 22 })); }
      else { vw = 300; vh = 4 * nh + 3 * 34 + 30; pos = NODES.map((_, i) => ({ x: (vw - nw) / 2 + (i % 2 ? 40 : -40), y: 12 + i * (nh + 34) })); }
      const nodes = NODES.map((n, i) => `<g class="ac-node" data-i="${i}" transform="translate(${pos[i].x},${pos[i].y})"><rect width="${nw}" height="${nh}" rx="10"/><text class="ac-node-icon" x="18" y="${nh / 2 + 6}">${n.i}</text><text class="ac-node-text" x="44" y="${nh / 2 + 5}">${esc(n.t)}</text><text class="ac-node-step" x="${nw - 10}" y="14" text-anchor="end">0${i + 1}</text></g>`).join('');
      const arrows = [];
      for (let i = 0; i < 3; i++) {
        const a = pos[i], b = pos[i + 1];
        const d2 = vertical ? `M${a.x + nw / 2} ${a.y + nh} C${a.x + nw / 2} ${a.y + nh + 20}, ${b.x + nw / 2} ${b.y - 20}, ${b.x + nw / 2} ${b.y - 3}` : `M${a.x + nw} ${a.y + nh / 2} L${b.x - 3} ${b.y + nh / 2}`;
        arrows.push(`<path class="ac-arrow" data-i="${i}" d="${d2}" marker-end="url(#ac-arrowhead)"/>`);
      }
      const last = pos[3], firstN = pos[0];
      const loop = vertical
        ? `M${last.x + nw} ${last.y + nh / 2} L${vw - 8} ${last.y + nh / 2} L${vw - 8} ${firstN.y + nh / 2} L${firstN.x + nw + 3} ${firstN.y + nh / 2}`
        : `M${last.x + nw / 2} ${last.y + nh} L${last.x + nw / 2} ${vh - 26} L${firstN.x + nw / 2} ${vh - 26} L${firstN.x + nw / 2} ${firstN.y + nh + 3}`;
      arrows.push(`<path class="ac-arrow ac-arrow-loop" data-i="3" d="${loop}" marker-end="url(#ac-arrowhead)"/>`);
      const loopLabel = vertical ? `<text class="ac-loop-label" x="${vw - 12}" y="${(firstN.y + last.y) / 2 + nh / 2}" text-anchor="middle" transform="rotate(-90 ${vw - 12} ${(firstN.y + last.y) / 2 + nh / 2})">next exam · repeat</text>` : `<text class="ac-loop-label" x="${vw / 2}" y="${vh - 31}" text-anchor="middle">next exam · repeat</text>`;
      flowHost.innerHTML = `<svg class="ac-flow-svg ${vertical ? 'is-vertical' : ''}" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Flow diagram: open book, stare at book, panic, submit, then loop back to open book."><defs><marker id="ac-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>${arrows.join('')}${loopLabel}${nodes}</svg>`;
      const svg = flowHost.querySelector('svg');
      const nodeEls = [...svg.querySelectorAll('.ac-node')], arrowEls = [...svg.querySelectorAll('.ac-arrow')];
      arrowEls.forEach(p => { const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = motion.reduced ? 0 : len; });
      if (motion.reduced) { nodeEls.forEach(n => n.classList.add('is-lit')); return; }
      flowTl?.kill();
      flowTl = gsap.timeline({ repeat: -1, repeatDelay: 0.9, paused: true });
      nodeEls.forEach((n, i) => {
        flowTl.add(() => { n.classList.add('is-lit'); if (i === 2) sfx.play('tick'); }, i * 1.05)
          .fromTo(n.querySelector('rect'), { scale: 0.94, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.45, ease: 'back.out(3)' }, i * 1.05);
        if (i < 3) flowTl.to(arrowEls[i], { strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut' }, i * 1.05 + 0.4);
      });
      flowTl.to(arrowEls[3], { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, 3.55)
        .add(() => { nodeEls.forEach(n => n.classList.remove('is-lit')); }, 4.9)
        .to(arrowEls, { strokeDashoffset: (i, p) => p.getTotalLength(), duration: 0.4, ease: 'power2.in' }, 4.9);
      if (flowVisible) flowTl.play(0);
    };
    let flowVisible = false;
    let lastFlowW = 0;
    const ro = new ResizeObserver(() => { const w = flowHost.clientWidth; if (Math.abs(w - lastFlowW) > 40 && w > 0) { lastFlowW = w; buildFlow(); } });
    ro.observe(flowHost);

    // ── Enter: counters, chart draw, flow start ──────────────
    ctx.onSectionEnter(el, () => {
      el.querySelectorAll('.ac-tile-value').forEach((n, i) => {
        const from = Number(n.dataset.from), to = Number(n.dataset.to);
        gsap.delayedCall(motion.reduced ? 0 : 0.2 + i * 0.18, () => motion.countUp(n, to, { from, duration: 1.6, ease: from > to ? 'power4.in' : 'power2.out', format: v => Math.round(v) + '%' }));
      });
      el.querySelectorAll('.ac-tile-bars i').forEach(b => b.classList.add('is-in'));
      el.querySelectorAll('.ac-subject-bar span').forEach(b => b.classList.add('is-in'));
      drawChart();
    });
    motion.onVisible(flowHost, (vis) => { flowVisible = vis; if (!flowTl) return; if (vis) flowTl.play(); else flowTl.pause(); });

    // ── Timetable generator ──────────────────────────────────
    const ttBtn = el.querySelector('.ac-tt-btn'), ttStage = el.querySelector('.ac-tt-stage');
    let ttBusy = false;
    ttBtn.addEventListener('click', () => {
      if (ttBusy) return; ttBusy = true;
      const studyDay = randInt(0, 6), studySlot = randInt(0, 4);
      const cells = SLOT_TIMES.map((time, s) => DAYS.map((_, dI) => (dI === studyDay && s === studySlot) ? 'Actual studying' : pick(ACTIVITIES)));
      const cls = a => ({ 'Anime': 'anime', '5 more minutes': 'five', 'Gym (late)': 'gym', 'BGMI': 'bgmi', 'Biryani break': 'food', 'Stare at book': 'stare', 'Actual studying': 'study' })[a];
      ttStage.innerHTML = `<div class="ac-scroll"><table class="ac-tt-table"><thead><tr><th scope="col" class="ac-tt-time">Slot</th>${DAYS.map(dd => `<th scope="col">${dd}</th>`).join('')}</tr></thead><tbody>${cells.map((row, s) => `<tr><th scope="row" class="ac-tt-time mono">${SLOT_TIMES[s]}</th>${row.map(a => `<td><span class="ac-tt-cell ac-tt-${cls(a)}">${esc(a)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="ac-tt-legend mono"><span>study cells found: <b class="ac-tt-found">1</b></span><span>anime cells: <b>${cells.flat().filter(a => a === 'Anime').length}</b></span><span>status: <b class="ac-tt-status">optimising…</b></span></div>`;
      const study = ttStage.querySelector('.ac-tt-study');
      const allCells = ttStage.querySelectorAll('.ac-tt-cell');
      ttBtn.textContent = 'REGENERATE TIMETABLE';
      const strike = () => {
        study.classList.add('is-struck');
        study.insertAdjacentHTML('beforeend', '<span class="ac-tt-strike" aria-hidden="true"></span><span class="ac-tt-cancel mono" aria-hidden="true">CANCELLED</span>');
        study.setAttribute('aria-label', 'Actual studying — cancelled');
        sfx.play('error');
        ttStage.querySelector('.ac-tt-found').textContent = '0';
        ttStage.querySelector('.ac-tt-status').textContent = 'study slot removed (conflict: anime)';
        if (!motion.reduced) { motion.shake(study.closest('td'), { intensity: 4, duration: 0.35 }); gsap.fromTo(study.querySelector('.ac-tt-strike'), { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power3.out', transformOrigin: 'left center' }); }
        ttBusy = false;
      };
      if (motion.reduced) { study.classList.add('is-found'); setTimeout(strike, 1000); return; }
      sfx.play('scan');
      gsap.fromTo(allCells, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: { each: 0.012, from: 'start' }, onComplete: () => { study.classList.add('is-found'); sfx.play('success'); gsap.fromTo(study, { scale: 1.25 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }); setTimeout(strike, 1000); } });
    });

    // ── PANIC MODE toggle ────────────────────────────────────
    const panic = el.querySelector('.ac-panic'), flash = el.querySelector('.ac-panic-flash');
    let panicOn = false;
    panic.addEventListener('click', () => {
      panicOn = !panicOn;
      panic.setAttribute('aria-pressed', String(panicOn));
      app.classList.toggle('is-panic', panicOn);
      panic.querySelector('.ac-panic-text').textContent = panicOn ? 'PANIC MODE: ON' : 'PANIC MODE';
      if (!panicOn) { sfx.play('success'); gsap.killTweensOf(flash); gsap.set(flash, { opacity: 0 }); return; }
      sfx.play('error');
      if (motion.reduced) { gsap.set(flash, { opacity: 0.35 }); setTimeout(() => gsap.set(flash, { opacity: 0 }), 500); return; }
      gsap.timeline().fromTo(flash, { opacity: 0 }, { opacity: 0.75, duration: 0.08, repeat: 5, yoyo: true, ease: 'none' }).to(flash, { opacity: 0, duration: 0.4 });
      motion.shake(app, { intensity: 5, duration: 0.6 });
      el.querySelectorAll('.ac-tile-value').forEach(n => gsap.fromTo(n, { scale: 1.15 }, { scale: 1, duration: 0.4, ease: 'power2.out' }));
    });
  },
};
