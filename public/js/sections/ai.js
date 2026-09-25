// 16 · SIR-AI ANALYSIS CORE — a futuristic terminal that "analyses" the subject.
// Matrix-rain canvas (visible only), neural-net SVG that pulses while running,
// rotating HUD rings, a typed analysis sequence and a local "ASK SIR-AI" chat.
export default {
  id: 'ai',
  title: 'SIR-AI Analysis Core',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, fx, motion, api, wait, pick, randInt } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name.split(' ')[0];
    const dev = (profile.friends && profile.friends[0]) || 'Shiv';
    const age = Number(profile.age) || 16;

    // ── Neural network layout (3 layers: 5 / 6 / 4 = 15 nodes) ────────────
    const layers = [5, 6, 4];
    const NW = 320, NH = 250;
    const nodes = [];
    layers.forEach((n, li) => {
      const x = 44 + li * ((NW - 88) / (layers.length - 1));
      for (let i = 0; i < n; i++) { const y = (NH / (n + 1)) * (i + 1); nodes.push({ x, y, layer: li, id: nodes.length }); }
    });
    const edges = [];
    for (let li = 0; li < layers.length - 1; li++) {
      const a = nodes.filter(n => n.layer === li), b = nodes.filter(n => n.layer === li + 1);
      a.forEach(n1 => b.forEach(n2 => edges.push({ from: n1, to: n2, layer: li })));
    }
    const netSvg = `
      <svg class="ai-net-svg" viewBox="0 0 ${NW} ${NH}" role="img" aria-label="Neural network diagram: three layers of nodes connected by edges">
        <g class="ai-edges">${edges.map(e => `<line class="ai-edge ai-edge-l${e.layer}" x1="${e.from.x}" y1="${e.from.y}" x2="${e.to.x}" y2="${e.to.y}"/>`).join('')}</g>
        <g class="ai-nodes">${nodes.map(n => `<circle class="ai-node ai-node-l${n.layer}" cx="${n.x}" cy="${n.y}" r="${n.layer === 1 ? 6 : 7}"/>`).join('')}</g>
        <text class="ai-net-label" x="44" y="${NH - 4}" text-anchor="middle">INPUT</text>
        <text class="ai-net-label" x="${NW / 2}" y="${NH - 4}" text-anchor="middle">HIDDEN</text>
        <text class="ai-net-label" x="${NW - 44}" y="${NH - 4}" text-anchor="middle">VERDICT</text>
      </svg>`;

    const ringsSvg = `
      <svg class="ai-rings" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="ai-ring ai-ring-1" cx="100" cy="100" r="92" />
        <circle class="ai-ring ai-ring-2" cx="100" cy="100" r="76" />
        <circle class="ai-ring ai-ring-3" cx="100" cy="100" r="60" />
        <circle class="ai-ring-static" cx="100" cy="100" r="46" />
        <line class="ai-ring-tick" x1="100" y1="8" x2="100" y2="20"/><line class="ai-ring-tick" x1="100" y1="180" x2="100" y2="192"/>
        <line class="ai-ring-tick" x1="8" y1="100" x2="20" y2="100"/><line class="ai-ring-tick" x1="180" y1="100" x2="192" y2="100"/>
      </svg>`;

    el.innerHTML = `
      <canvas class="ai-rain" aria-hidden="true"></canvas>
      <div class="ai-scanlines" aria-hidden="true"></div>
      <div class="container ai-wrap">
        <div class="sec-head ai-head">
          <span class="eyebrow" data-reveal>MODULE 16 · NEURAL ROAST ENGINE · v16.0</span>
          <h2 class="display h1 ai-title" data-reveal>SIR-AI <span class="ai-title-acc">ANALYSIS CORE</span></h2>
          <p class="lead" data-reveal>A state-of-the-art artificial intelligence trained on 16 years of ${esc(first)}'s behaviour. It has seen things. It needs therapy.</p>
        </div>

        <div class="ai-grid">
          <div class="ai-console" data-reveal>
            <div class="ai-bar mono">
              <span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="ai-bar-title">sir-ai@core:~$ ./analyse --subject="${esc(nick)}"</span>
              <span class="ai-status"><span class="dot"></span> <span class="ai-status-text">IDLE</span></span>
            </div>
            <div class="term ai-term" aria-live="polite" aria-label="SIR-AI console output">
              <div class="ai-log"><div class="ai-line dim">SIR-AI v16.0 ready. Neural weights loaded from: /home/${esc(dev.toLowerCase())}/roasts.bin</div><div class="ai-line dim">Press RUN ANALYSIS to begin. Subject cannot consent; subject is late.</div></div>
              <div class="ai-cursor-line"><span class="ai-prompt">&gt;</span><span class="ai-cursor cursor"></span></div>
            </div>
            <div class="ai-verdict" hidden>
              <span class="ai-verdict-label mono">${esc(nick)} PROBABILITY</span>
              <div class="display ai-percent tabular">0.000%</div>
            </div>
            <div class="ai-conclusion" hidden role="status">
              <span class="ai-conclusion-kicker mono">FINAL AI CONCLUSION</span>
              <p class="display ai-conclusion-text">Subject is, unfortunately, still ${esc(nick)}.</p>
              <span class="ai-conclusion-foot mono">confidence: 99.999% · margin of error: his excuses</span>
            </div>
            <div class="ai-actions">
              <button class="btn ai-run" type="button">RUN ANALYSIS</button>
              <span class="ai-meta mono muted">CORES: <b class="ai-cores">4</b> · TEMP: <b class="ai-temp">36.6°C</b> · TOKENS: <b class="ai-tokens">0</b></span>
            </div>
            <form class="ai-ask" autocomplete="off">
              <label class="sr-only" for="ai-ask-input">Ask SIR-AI a question</label>
              <span class="ai-ask-prefix mono" aria-hidden="true">ASK SIR-AI</span>
              <input id="ai-ask-input" class="ai-ask-input mono" type="text" maxlength="140" placeholder="Ask anything. Get roasted anyway." />
              <button class="btn btn-ghost btn-sm ai-ask-btn" type="submit">ASK</button>
            </form>
            <p class="ai-disclaimer mono muted">SIR-AI is not an AI. It is ${esc(dev)} with a keyboard. Statistics are 100% fabricated by his friends.</p>
          </div>

          <aside class="ai-side" data-reveal aria-label="SIR-AI system panels">
            <div class="ai-hud">
              ${ringsSvg}
              <div class="ai-hud-center">
                <span class="ai-hud-num display tabular">00</span>
                <span class="ai-hud-label mono">CORE LOAD</span>
              </div>
            </div>
            <div class="ai-netbox">
              <div class="ai-panel-title mono"><span>NEURAL NET</span><span class="ai-net-state">DORMANT</span></div>
              ${netSvg}
            </div>
            <dl class="ai-readouts mono">
              <div><dt>MODEL</dt><dd>${esc(nick)}-GPT 16B</dd></div>
              <div><dt>TRAINING DATA</dt><dd>Group chat (unfiltered)</dd></div>
              <div><dt>BIAS</dt><dd class="warn">Against him</dd></div>
              <div><dt>HALLUCINATION</dt><dd class="ok">Less than subject in exams</dd></div>
            </dl>
          </aside>
        </div>
      </div>`;

    // ── refs ──────────────────────────────────────────────────────────────
    const q = s => el.querySelector(s);
    const log = q('.ai-log'), term = q('.ai-term'), runBtn = q('.ai-run'), statusText = q('.ai-status-text'), status = q('.ai-status');
    const verdict = q('.ai-verdict'), percent = q('.ai-percent'), conclusion = q('.ai-conclusion');
    const hudNum = q('.ai-hud-num'), netState = q('.ai-net-state'), tokens = q('.ai-tokens'), temp = q('.ai-temp');
    const askForm = q('.ai-ask'), askInput = q('.ai-ask-input'), askBtn = q('.ai-ask-btn');
    const edgeEls = [0, 1].map(i => [...el.querySelectorAll(`.ai-edge-l${i}`)]);
    const nodeEls = [0, 1, 2].map(i => [...el.querySelectorAll(`.ai-node-l${i}`)]);

    let busy = false, hasRun = false, tokenCount = 0;
    const scrollLog = () => { term.scrollTop = term.scrollHeight; };
    const addLine = (html, cls = '') => { const d = document.createElement('div'); d.className = `ai-line ${cls}`; d.innerHTML = html; log.appendChild(d); scrollLog(); return d; };
    const bumpTokens = n => { tokenCount += n; tokens.textContent = tokenCount.toLocaleString(); };

    // Typed line (sparse 'type' sfx: every ~7 chars)
    async function typeLine(text, cls = '', speed = 16) {
      const d = addLine('', cls); let n = 0;
      await motion.typewriter(d, text, { speed, jitter: 14, onChar: () => { if (++n % 7 === 0) sfx.play('type'); scrollLog(); } });
      bumpTokens(Math.ceil(text.length / 4));
      return d;
    }
    // Fake progress bar
    async function progress(label, ms = 700) {
      const d = addLine('', 'dim');
      const render = k => { d.innerHTML = `${esc(label)} <span class="ai-pb">${ctx.blocks(k, 14)}</span> <span class="ai-pb-val">${Math.round((k / 14) * 100)}%</span>`; };
      if (motion.reduced) { render(14); return; }
      for (let k = 0; k <= 14; k++) { render(k); scrollLog(); await wait(ms / 14); }
    }
    // Fake hex dump with hidden ASCII jokes
    const HEXWORDS = ['SIR.IS.LATE', 'PASS.MISSED', 'BIRYANI.OK', 'GYM@23:58', 'ANIME.LOOP', 'SKIP.CLASS', 'UNNATIONAL', 'BGMI.RAGE', '5.MIN.AWAY', 'NO.HOMEWORK'];
    async function hexDump(rows = 2) {
      const base = randInt(0x0040, 0xffc0) & 0xfff0;
      for (let r = 0; r < rows; r++) {
        const bytes = Array.from({ length: 12 }, () => randInt(0, 255).toString(16).padStart(2, '0')).join(' ');
        const word = pick(HEXWORDS).padEnd(11, '.').slice(0, 11);
        addLine(`<span class="ai-hex-addr">0x${(base + r * 16).toString(16).padStart(4, '0').toUpperCase()}</span>  ${bytes}  <span class="ai-hex-ascii">${esc(word)}</span>`, 'dim ai-hex');
        if (!motion.reduced) await wait(55);
      }
    }

    // ── Neural net pulse (runs while analysing) ───────────────────────────
    let netTl = null;
    function netStart() {
      netState.textContent = 'FIRING';
      el.classList.add('is-analysing');
      if (motion.reduced) return;
      gsap.set([...edgeEls[0], ...edgeEls[1]], { opacity: 0.12, strokeDashoffset: 0 });
      netTl = gsap.timeline({ repeat: -1, repeatDelay: 0.15 });
      netTl.to(nodeEls[0], { fill: '#c6ff3d', duration: 0.15, stagger: 0.04 }, 0)
        .to(edgeEls[0], { opacity: 0.9, strokeDashoffset: -24, duration: 0.5, stagger: { each: 0.012, from: 'random' }, ease: 'power2.inOut' }, 0.1)
        .to(nodeEls[1], { fill: '#c6ff3d', duration: 0.15, stagger: 0.03 }, 0.55)
        .to(edgeEls[0], { opacity: 0.12, duration: 0.3 }, 0.7)
        .to(edgeEls[1], { opacity: 0.9, strokeDashoffset: -24, duration: 0.5, stagger: { each: 0.015, from: 'random' }, ease: 'power2.inOut' }, 0.7)
        .to(nodeEls[2], { fill: '#ff3b3b', duration: 0.15, stagger: 0.05 }, 1.1)
        .to(edgeEls[1], { opacity: 0.12, duration: 0.3 }, 1.3)
        .to([...nodeEls[0], ...nodeEls[1], ...nodeEls[2]], { fill: '#1d2a0a', duration: 0.35 }, 1.35);
    }
    function netStop(done) {
      netTl?.kill(); netTl = null;
      el.classList.remove('is-analysing');
      netState.textContent = done ? 'CONVERGED' : 'DORMANT';
      if (motion.reduced) return;
      gsap.to([...edgeEls[0], ...edgeEls[1]], { opacity: done ? 0.35 : 0.2, duration: 0.6 });
      gsap.to([...nodeEls[0], ...nodeEls[1]], { fill: done ? '#c6ff3d' : '#1d2a0a', duration: 0.6 });
      gsap.to(nodeEls[2], { fill: done ? '#ff3b3b' : '#1d2a0a', duration: 0.6 });
    }

    // HUD load counter + fake temp while busy
    let loadTimer = 0;
    function loadStart() {
      clearInterval(loadTimer);
      loadTimer = setInterval(() => { hudNum.textContent = String(randInt(64, 99)).padStart(2, '0'); temp.textContent = (36.6 + Math.random() * 60).toFixed(1) + '°C'; }, 220);
    }
    function loadStop(v = '00') { clearInterval(loadTimer); hudNum.textContent = v; temp.textContent = '36.6°C'; }

    const setStatus = (t, cls) => { statusText.textContent = t; status.className = `ai-status ${cls || ''}`; };

    // ── The analysis sequence ─────────────────────────────────────────────
    const SCRIPT = [
      { t: 'Initializing SIR-AI v16.0…', cls: 'ok', after: async () => { await progress('loading neural weights'); } },
      { t: 'Analyzing subject…', after: async () => { await hexDump(3); await progress('scanning subject', 900); } },
      { t: 'Football detected. Position: midfielder. Position on pitch: unknown.', cls: 'ok' },
      { t: 'Anime detected. Volume: unsafe.', cls: 'warn', after: async () => { await hexDump(2); } },
      { t: 'Gaming detected. Skill: buffering.', cls: 'warn', after: async () => { await progress('buffering skill', 1100); } },
      { t: 'Homework avoidance detected. Efficiency: 100%.', cls: 'ok' },
      { t: 'Biryani detected (multiple).', after: async () => { await hexDump(2); } },
      { t: 'Gym detected. Timestamp: 23:58.', cls: 'warn' },
      { t: 'Pass reception module… ', cls: '', tail: { t: 'ERROR 404: PASS NOT FOUND', cls: 'bad' }, after: async () => { sfx.play('error'); if (!motion.reduced) motion.shake(term, { intensity: 4, duration: 0.3 }); } },
      { t: 'Computing SIR probability…', after: async () => { await progress('crunching 16 years of evidence', 1200); } },
    ];

    async function runAnalysis() {
      if (busy) return;
      busy = true; runBtn.disabled = true; askBtn.disabled = true;
      api.event('ai_run', { rerun: hasRun });
      sfx.play('scan');
      // reset previous verdict
      verdict.hidden = true; conclusion.hidden = true;
      if (hasRun) { addLine('— re-running analysis. Results will not improve. —', 'dim'); }
      setStatus('ANALYZING', 'is-busy');
      netStart(); loadStart();

      for (const step of SCRIPT) {
        const line = await typeLine(step.t, step.cls);
        if (step.tail) {
          const span = document.createElement('span'); span.className = step.tail.cls; line.appendChild(span);
          await wait(motion.reduced ? 0 : 420);
          await motion.typewriter(span, step.tail.t, { speed: 22, jitter: 10, onChar: (c) => { if (c === ' ') sfx.play('type'); } });
        }
        if (step.after) await step.after();
        if (!motion.reduced) await wait(160);
      }

      // Giant percentage 0 → 99.999
      verdict.hidden = false; scrollLog();
      if (!motion.reduced) gsap.fromTo(verdict, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
      const tw = motion.countUp(percent, 99.999, { duration: 2.6, ease: 'power2.inOut', format: v => v.toFixed(3) + '%' });
      if (!motion.reduced) { const iv = setInterval(() => sfx.play('tick'), 170); await tw; clearInterval(iv); }
      percent.textContent = '99.999%';

      // FINAL AI CONCLUSION slams in
      conclusion.hidden = false;
      netStop(true); loadStop('99');
      setStatus('COMPLETE', 'is-done');
      sfx.play('boom');
      if (!motion.reduced) {
        gsap.fromTo(conclusion, { scale: 2.4, opacity: 0, rotate: -8 }, { scale: 1, opacity: 1, rotate: -1.5, duration: 0.55, ease: 'power4.out' });
        motion.shake(el, { intensity: 10, duration: 0.45 });
        const r = conclusion.getBoundingClientRect();
        fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 36, color: '#c6ff3d', power: 12 });
      }
      await wait(motion.reduced ? 0 : 500);
      addLine(`Analysis complete. Subject: still ${esc(nick)}. Recommendation: none. There is no cure.`, 'dim');

      hasRun = true; busy = false;
      runBtn.disabled = false; runBtn.textContent = 'RE-RUN';
      askBtn.disabled = false;
    }
    runBtn.addEventListener('click', runAnalysis);

    // ── ASK SIR-AI (fully local keyword map) ──────────────────────────────
    const ANSWERS = [
      [/football|pass|midfield|goal|pitch|ball|striker|match|fifa/i, ['The pass was perfect. The receiver was not.', 'Ball location: known. Subject location: unknown. Classic.', 'Midfielder status confirmed. Middle of the field, doing nothing.']],
      [/anime|naruto|one piece|episode|manga|jujutsu|demon slayer|waifu|weeb/i, ['Anime hours: unmeasurable. Sleep hours: also unmeasurable, for different reasons.', 'Currently on episode 4,012. Homework: episode 0.', 'His watch history has more arcs than his football career.']],
      [/gym|workout|muscle|bench|protein|abs|lift/i, ['Gym session logged at 23:58. Duration: one selfie.', 'Bench press: 0 reps. Bench: sat on it. Impressive posture.', 'Protein intake: biryani. Gains: pending since 2023.']],
      [/study|exam|homework|school|test|marks|grade|maths|physics|teacher|class/i, ['Exam results are classified. By him. From his parents.', 'Study session detected: 4 minutes. Break detected: 4 hours.', 'Homework status: "will do it tomorrow". Tomorrow status: fictional.']],
      [/food|biryani|eat|hungry|snack|pizza|burger|chicken|dinner|lunch/i, [`Biryani intake exceeds all recommended limits. Recommendation: more biryani.`, 'Subject can be located by following the smell of biryani.', 'Favourite food: biryani. Second favourite: more biryani.']],
      [/late|time|when|clock|minute|hour|punctual|arrive|waiting/i, ['He will be there in 5 minutes. This message was first sent in 2019.', 'Estimated arrival: soon. Actual arrival: after the event.', 'Time is a construct. So is his punctuality.']],
      [/game|gaming|free fire|bgmi|pubg|rank|clutch|noob|lag|ping/i, ['Skill rating: buffering. Rage rating: 5G.', 'Clutch attempt detected. Clutch result: "the lag".', 'Free Fire rank: high. Real fire: still can\'t cook.']],
      [/national|selected|selection|trials|team|india/i, ['Nationals selection status: pending. Since forever.', 'Unnational. The word was invented for him.', 'Scouts watched him for 90 minutes. They are still watching. In disbelief.']],
      [/birthday|old|age|year|born/i, [`He is ${age}. Mentally: buffering.`, `${age} years of evidence. Zero years of improvement.`, 'Another year older, exactly zero passes wiser.']],
      [/lazy|sleep|tired|bed|nap|energy/i, ['Energy levels: hibernating.', 'Sleep schedule: yes. Schedule: no.', 'Subject is resting. From resting.']],
      [/who are you|what are you|sir-ai|are you real|robot|ai\b/i, [`I am SIR-AI. I am also ${dev} with a keyboard. Don't tell anyone.`, 'I am a large language model. He is a large lag model.']],
      [/love|girlfriend|crush|date|single/i, ['Relationship status: in a committed relationship with his PS controller.', 'His only long-term relationship is with biryani.']],
      [/best|good|nice|great|talent|smart|strong/i, ['Compliment request detected. Please use the MERCY PROTOCOL below. Once.', 'Positive attributes found: 1. Details: classified.']],
    ];
    const DEFLECT = ['Insufficient data. Also, he\'s late.', 'Query rejected. Ask about biryani.', 'Processing… processing… he still hasn\'t received the pass.', 'Error: question too intelligent for subject.', '42. Also, he\'s late.', 'I have consulted the archives. The archives laughed.', 'Unclear. But whatever it is, he did not study for it.'];
    const answerFor = (text) => { for (const [re, list] of ANSWERS) if (re.test(text)) return pick(list); return pick(DEFLECT); };

    askForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const raw = askInput.value.trim().slice(0, 140);
      if (!raw) { askInput.focus(); return; }
      busy = true; askBtn.disabled = true; runBtn.disabled = true;
      askInput.value = '';
      addLine(`<span class="ai-you">you@guest:~$</span> ${esc(raw)}`, 'ai-q');
      const think = addLine('<span class="ai-think">thinking</span><span class="ai-think-dots">…</span>', 'dim');
      setStatus('THINKING', 'is-busy'); loadStart();
      if (!motion.reduced) { let n = 0; const iv = setInterval(() => { think.querySelector('.ai-think-dots').textContent = '.'.repeat(1 + (n++ % 3)); }, 220); await wait(700 + Math.random() * 700); clearInterval(iv); }
      think.remove();
      sfx.play('tick');
      // 20 chars per second = 50 ms per char, no jitter
      await typeLine(`${nick}-AI: ${answerFor(raw)}`, 'ai-a', 50);
      loadStop(hasRun ? '99' : '00'); setStatus(hasRun ? 'COMPLETE' : 'IDLE', hasRun ? 'is-done' : '');
      busy = false; askBtn.disabled = false; runBtn.disabled = false; askInput.focus({ preventScroll: true });
    });

    // ── Matrix rain (cheap; only while visible; off in reduced motion) ────
    const canvas = q('.ai-rain'); const c2 = canvas.getContext('2d');
    const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789SIRLATE<>/=+*';
    let cols = [], colW = 16, W = 0, H = 0, raf = 0, last = 0, rainOn = false;
    const FS = 15;
    function resizeRain() {
      W = el.clientWidth; H = el.clientHeight;
      canvas.width = W; canvas.height = H;
      const n = Math.min(60, Math.max(12, Math.floor(W / FS)));
      colW = W / n;
      cols = Array.from({ length: n }, () => ({ y: Math.random() * H, v: 0.6 + Math.random() * 1.2, bright: Math.random() < 0.1 }));
      c2.fillStyle = '#050508'; c2.fillRect(0, 0, W, H);
    }
    function rainFrame(ts) {
      if (!rainOn) return;
      raf = requestAnimationFrame(rainFrame);
      if (ts - last < 66) return; // ~15 fps is plenty for rain
      last = ts;
      c2.fillStyle = 'rgba(5,5,8,0.14)'; c2.fillRect(0, 0, W, H);
      c2.font = `${FS}px "JetBrains Mono", monospace`;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const ch = GLYPHS[randInt(0, GLYPHS.length - 1)];
        c2.fillStyle = c.bright ? 'rgba(220,255,160,0.95)' : 'rgba(198,255,61,0.75)';
        c2.fillText(ch, i * colW, c.y);
        c.y += FS * c.v;
        if (c.y > H + 40 && Math.random() < 0.03) { c.y = -20; c.v = 0.6 + Math.random() * 1.2; c.bright = Math.random() < 0.1; }
      }
    }
    function rainStart() { if (rainOn || motion.reduced) return; rainOn = true; resizeRain(); last = 0; raf = requestAnimationFrame(rainFrame); }
    function rainStop() { rainOn = false; cancelAnimationFrame(raf); }
    let visible = false, entered = false;
    motion.onVisible(el, (v) => { visible = v; if (v && entered) rainStart(); else rainStop(); });
    ctx.onEnter(() => { entered = true; if (visible) rainStart(); });
    motion.onChange((r) => { if (r) rainStop(); else if (visible && entered) rainStart(); });
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (rainOn) resizeRain(); }, 150); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) rainStop(); else if (visible && entered) rainStart(); });

    // ── Idle state visuals ────────────────────────────────────────────────
    gsap.set([...edgeEls[0], ...edgeEls[1]], { opacity: 0.2 });
    // Section entrance: tiny boot chatter + rings spin up
    ctx.onSectionEnter(el, () => {
      if (motion.reduced) return;
      gsap.from(q('.ai-hud'), { scale: 0.6, opacity: 0, duration: 1, ease: 'expo.out' });
      gsap.from([...nodeEls[0], ...nodeEls[1], ...nodeEls[2]], { attr: { r: 0 }, duration: 0.6, stagger: 0.03, ease: 'back.out(2)' });
      gsap.from([...edgeEls[0], ...edgeEls[1]], { opacity: 0, duration: 0.8, stagger: { each: 0.006, from: 'start' } });
    });
  },
};
