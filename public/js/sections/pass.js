// 04 · THE PERFECT PASS — VAR replay + interactive recreation of the miss.
export default {
  id: 'pass',
  title: 'The Perfect Pass',
  mount(el, ctx) {
    const { profile, esc, gsap, ScrollTrigger, sfx, motion, api, toast } = ctx;
    const first = (profile.first_name || profile.name.split(' ')[0]).toUpperCase();
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const friends = (Array.isArray(profile.friends) && profile.friends.length ? profile.friends : ['Shiv', 'Alex', 'Jason']).map(String);
    const passer0 = friends[0].toUpperCase();

    // Geometry of the recreation (SVG viewBox units)
    const P = { x: 230, y: 400 };          // passer
    const S = { x: 720, y: 230 };          // SIR
    const BALL0 = { x: 258, y: 412 };      // ball at passer's feet
    const TARGET = { x: 690, y: 258 };     // exactly at SIR's feet (the pass IS perfect)
    const CTRL = { x: 430, y: 120 };       // curve control point

    el.innerHTML = `
      <div class="pass-bar pass-bar-top" aria-hidden="true"></div>
      <div class="pass-bar pass-bar-bot" aria-hidden="true"></div>
      <div class="pass-scan" aria-hidden="true"></div>
      <div class="pass-vignette" aria-hidden="true"></div>
      <div class="container pass-wrap">
        <div class="pass-hud mono" aria-hidden="true">
          <span class="pass-badge"><i class="pass-rec"></i> REPLAY</span>
          <span class="pass-tc tabular">00:00:00:00</span>
          <span class="pass-cam">CAM 04 · VAR · SLOW-MO ×0.25</span>
        </div>
        <div class="sec-head">
          <span class="eyebrow">EXHIBIT B · VIDEO ASSISTANT REFEREE</span>
          <h2 class="display h1 pass-title">THE PERFECT PASS</h2>
          <p class="lead">Reconstructed frame by frame from witness testimony. The witnesses were ${esc(friends.join(', '))}. They are still not over it.</p>
        </div>

        <div class="pass-seq" role="list" aria-label="Sequence of events">
          <div class="pass-seq-item display" role="listitem">${esc(passer0)}</div>
          <div class="pass-seq-arrow" aria-hidden="true">↓</div>
          <div class="pass-seq-item pass-seq-pass display" role="listitem">PERFECT PASS</div>
          <div class="pass-seq-arrow" aria-hidden="true">↓</div>
          <div class="pass-seq-item display" role="listitem">${esc(first)}</div>
          <div class="pass-seq-arrow" aria-hidden="true">↓</div>
          <div class="pass-seq-item pass-seq-x display" role="listitem" aria-label="Missed">❌</div>
        </div>

        <div class="pass-lines">
          <p class="display pass-line pass-line-1">A PASS SO PERFECT...</p>
          <p class="display pass-line pass-line-2">...AND HE STILL MISSED IT.</p>
        </div>

        <div class="pass-stage" data-reveal>
          <div class="pass-pitch-wrap">
            <div class="pass-pitch-hud mono" aria-hidden="true"><span>◉ REC</span><span class="pass-pitch-frame">FRAME 0000</span><span>TOP VIEW</span></div>
            <svg class="pass-pitch" viewBox="0 0 1000 600" role="img" aria-label="Top-down football pitch. ${esc(passer0)} passes to ${esc(nick)}.">
              <defs>
                <linearGradient id="pass-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c3b1d"/><stop offset="1" stop-color="#062314"/></linearGradient>
                <pattern id="pass-stripes" width="100" height="600" patternUnits="userSpaceOnUse"><rect width="50" height="600" fill="rgba(255,255,255,.025)"/></pattern>
                <radialGradient id="pass-spot" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="rgba(46,229,107,.25)"/><stop offset="1" stop-color="rgba(46,229,107,0)"/></radialGradient>
                <filter id="pass-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <rect width="1000" height="600" fill="url(#pass-grass)"/>
              <rect width="1000" height="600" fill="url(#pass-stripes)"/>
              <g class="pass-lines-svg" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="3">
                <rect x="40" y="40" width="920" height="520" rx="2"/>
                <line x1="500" y1="40" x2="500" y2="560"/>
                <circle cx="500" cy="300" r="80"/>
                <circle cx="500" cy="300" r="4" fill="rgba(255,255,255,.28)"/>
                <rect x="40" y="150" width="150" height="300"/>
                <rect x="40" y="220" width="60" height="160"/>
                <rect x="810" y="150" width="150" height="300"/>
                <rect x="900" y="220" width="60" height="160"/>
                <circle cx="150" cy="300" r="4" fill="rgba(255,255,255,.28)"/>
                <circle cx="850" cy="300" r="4" fill="rgba(255,255,255,.28)"/>
                <rect x="20" y="230" width="20" height="140" stroke="rgba(255,255,255,.45)"/>
                <rect x="960" y="230" width="20" height="140" stroke="rgba(255,255,255,.45)"/>
              </g>
              <ellipse class="pass-spotlight" cx="${S.x}" cy="${S.y + 30}" rx="150" ry="110" fill="url(#pass-spot)"/>
              <path class="pass-lane" d="M ${TARGET.x} ${TARGET.y - 26} L 900 ${TARGET.y - 40} L 900 ${TARGET.y + 40} L ${TARGET.x} ${TARGET.y + 26} Z" fill="rgba(46,229,107,.18)" stroke="rgba(46,229,107,.6)" stroke-width="2" opacity="0"/>
              <path class="pass-trail" d="M ${BALL0.x} ${BALL0.y} Q ${CTRL.x} ${CTRL.y} ${TARGET.x} ${TARGET.y}" fill="none" stroke="#2ee56b" stroke-width="5" stroke-linecap="round" opacity="0" filter="url(#pass-glow)"/>
              <g class="pass-ghosts"></g>
              <g class="pass-fig pass-fig-passer">
                <ellipse class="fig-shadow" cx="0" cy="36" rx="28" ry="8"/>
                <rect class="fig-body fig-body-passer" x="-18" y="-8" width="36" height="46" rx="13"/>
                <circle class="fig-head" cx="0" cy="-22" r="13"/>
                <text class="fig-num display" y="24" text-anchor="middle">10</text>
                <text class="fig-name mono pass-passer-name" y="62" text-anchor="middle">${esc(passer0)}</text>
              </g>
              <g class="pass-fig pass-fig-sir">
                <ellipse class="fig-shadow" cx="0" cy="36" rx="28" ry="8"/>
                <g class="fig-torso">
                  <rect class="fig-body fig-body-sir" x="-18" y="-8" width="36" height="46" rx="13"/>
                  <text class="fig-num display" y="24" text-anchor="middle">7</text>
                </g>
                <g class="fig-headgrp">
                  <circle class="fig-head" cx="0" cy="-22" r="13"/>
                  <circle class="fig-gaze" cx="-7" cy="-24" r="3"/>
                </g>
                <g class="fig-phone" opacity="0">
                  <rect x="-40" y="-12" width="18" height="30" rx="4" fill="#111" stroke="#9fd8ff" stroke-width="1.5"/>
                  <rect x="-37" y="-8" width="12" height="20" rx="2" fill="#9fd8ff" opacity=".85" class="fig-phone-screen"/>
                </g>
                <text class="fig-name mono" y="62" text-anchor="middle">${esc(nick)}</text>
                <text class="fig-bubble display" x="26" y="-34" text-anchor="middle" opacity="0"></text>
              </g>
              <g class="pass-ball-shadow"><ellipse cx="0" cy="0" rx="12" ry="5" fill="rgba(0,0,0,.45)"/></g>
              <g class="pass-ball">
                <circle r="12" fill="#f4f4f8" stroke="#111" stroke-width="1.5"/>
                <circle r="3" cx="0" cy="-5" fill="#111"/><circle r="3" cx="5" cy="3" fill="#111"/><circle r="3" cx="-5" cy="3" fill="#111"/>
              </g>
              <g class="pass-complaint" opacity="0">
                <rect x="-22" y="-30" width="44" height="56" rx="4" fill="#f4f4f8"/>
                <line x1="-14" y1="-18" x2="14" y2="-18" stroke="#111" stroke-width="3"/>
                <line x1="-14" y1="-8" x2="14" y2="-8" stroke="#888" stroke-width="2"/>
                <line x1="-14" y1="0" x2="10" y2="0" stroke="#888" stroke-width="2"/>
                <line x1="-14" y1="8" x2="14" y2="8" stroke="#888" stroke-width="2"/>
                <text class="mono" y="22" text-anchor="middle" font-size="9" fill="#ff3b3b" font-weight="700">COMPLAINT</text>
              </g>
            </svg>
            <div class="pass-glitch" hidden aria-live="assertive">
              <div class="pass-glitch-inner">
                <div class="display pass-glitch-title" data-text="ERROR: THIS WAS NOT EXPECTED.">ERROR: THIS WAS NOT EXPECTED.</div>
                <div class="mono pass-glitch-sub">SYSTEM REBOOTING<span class="pass-dots"></span></div>
                <div class="mono pass-glitch-log"></div>
              </div>
            </div>
          </div>

          <aside class="pass-panel glass glass-strong">
            <div class="pass-panel-head mono"><span class="tag tag-pitch">VAR DECISION</span><span class="pass-passer-label">PASSER: <b>${esc(passer0)}</b></span></div>
            <div class="pass-result" aria-live="polite">
              <div class="pass-result-n mono">AWAITING REVIEW</div>
              <div class="pass-result-text display">Press play to recreate the incident.</div>
              <div class="pass-result-stamp"><span class="stamp pass-stamp" hidden>MISSED</span></div>
            </div>
            <div class="pass-counter mono" aria-live="polite">ATTEMPTS: <b class="pass-n tabular">0</b> · COMPLETIONS: <b class="tabular">0</b><span class="pass-well"></span></div>
            <button class="btn btn-lg pass-play" type="button">PLAY THE PASS</button>
            <p class="pass-note mono muted">Reconstruction accuracy: 100%. Emotional damage: ongoing.</p>
          </aside>
        </div>
      </div>`;

    // ── refs ─────────────────────────────────────────────────
    const $ = (s) => el.querySelector(s);
    const svg = $('.pass-pitch'), ball = $('.pass-ball'), ballShadow = $('.pass-ball-shadow'), trail = $('.pass-trail'), ghosts = $('.pass-ghosts');
    const passerFig = $('.pass-fig-passer'), sirFig = $('.pass-fig-sir'), torso = $('.fig-torso'), headGrp = $('.fig-headgrp'), gaze = $('.fig-gaze'), phone = $('.fig-phone'), bubble = $('.fig-bubble');
    const lane = $('.pass-lane'), complaint = $('.pass-complaint'), spotlight = $('.pass-spotlight');
    const playBtn = $('.pass-play'), resultN = $('.pass-result-n'), resultText = $('.pass-result-text'), stamp = $('.pass-stamp'), nEl = $('.pass-n'), wellEl = $('.pass-well');
    const passerName = $('.pass-passer-name'), passerLabel = $('.pass-passer-label b'), glitch = $('.pass-glitch'), glitchLog = $('.pass-glitch-log'), frameEl = $('.pass-pitch-frame'), tcEl = $('.pass-tc');

    gsap.set(passerFig, { x: P.x, y: P.y });
    gsap.set(sirFig, { x: S.x, y: S.y });
    gsap.set(ball, { x: BALL0.x, y: BALL0.y });
    gsap.set(ballShadow, { x: BALL0.x, y: BALL0.y + 10 });
    gsap.set(complaint, { x: TARGET.x + 40, y: TARGET.y - 40 });
    const trailLen = trail.getTotalLength();
    trail.style.strokeDasharray = `${trailLen}`;
    trail.style.strokeDashoffset = `${trailLen}`;

    // ── VAR timecode + frame counter ──────────────────────────
    let tcStart = 0, tcTimer = 0, frame = 0;
    const pad = (n) => String(n).padStart(2, '0');
    const tickTc = () => {
      const ms = performance.now() - tcStart; const s = ms / 1000;
      tcEl.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}:${pad(Math.floor((ms % 1000) / 40))}`;
      frameEl.textContent = `FRAME ${String(++frame % 10000).padStart(4, '0')}`;
    };
    if (!motion.reduced) {
      motion.onVisible(el, (vis) => {
        clearInterval(tcTimer);
        if (vis) { if (!tcStart) tcStart = performance.now(); tcTimer = setInterval(tickTc, 40); }
      });
    } else { tcEl.textContent = '00:00:00:00'; }

    // ── Scroll-driven sequence + display lines ───────────────
    const seqItems = el.querySelectorAll('.pass-seq-item'), arrows = el.querySelectorAll('.pass-seq-arrow');
    const line1 = $('.pass-line-1'), line2 = $('.pass-line-2');
    gsap.set(seqItems, { opacity: 0, y: 40 });
    gsap.set(arrows, { opacity: 0, scaleY: 0, transformOrigin: 'top center' });
    gsap.set(line1, { opacity: 0, y: 30 });
    gsap.set(line2, { opacity: 0, scale: 1.35, filter: 'blur(14px)' });
    const seqTl = gsap.timeline({ scrollTrigger: { trigger: $('.pass-seq'), start: 'top 78%', toggleActions: 'play none none none' }, defaults: { ease: 'power4.out' } });
    seqItems.forEach((item, i) => {
      const at = i * 0.55;
      if (i > 0) seqTl.to(arrows[i - 1], { opacity: 1, scaleY: 1, duration: 0.35, ease: 'power2.out' }, at - 0.25);
      const isX = item.classList.contains('pass-seq-x');
      seqTl.to(item, isX ? { opacity: 1, y: 0, duration: 0.6, ease: 'back.out(3)', onStart: () => { sfx.play('error'); motion.shake(el.querySelector('.pass-seq'), { intensity: 5, duration: 0.35 }); } } : { opacity: 1, y: 0, duration: 0.7, onStart: () => sfx.play('tick') }, at);
    });
    gsap.timeline({ scrollTrigger: { trigger: $('.pass-lines'), start: 'top 80%', toggleActions: 'play none none none' } })
      .to(line1, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', onStart: () => sfx.play('whoosh') })
      .to(line2, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.55, ease: 'power4.out', onStart: () => { sfx.play('boom'); motion.shake($('.pass-lines'), { intensity: 7, duration: 0.4 }); } }, '+=1.0');

    // ── Outcomes ──────────────────────────────────────────────
    // Each outcome: label, stamp, and a fn(tl) that appends the post-arrival choreography to the attempt timeline.
    const OUT = {
      miss1: { text: 'Missed.', stamp: 'MISSED', bubble: '!', play(tl) {
        tl.to(ball, { x: 930, y: 130, duration: 0.8, ease: 'power1.out' }, 'arrive')
          .to(ballShadow, { x: 930, y: 140, duration: 0.8, ease: 'power1.out' }, 'arrive')
          .to(sirFig, { x: S.x + 34, y: S.y - 16, rotation: 22, duration: 0.35, ease: 'power2.out' }, 'arrive+=0.45')
          .to(sirFig, { x: S.x, y: S.y, rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' }, '+=0.2');
      } },
      miss2: { text: 'Still missed.', stamp: 'STILL MISSED', bubble: '...', play(tl) {
        tl.to(sirFig, { y: S.y - 70, duration: 0.35, ease: 'power2.inOut' }, 'arrive-=0.35')
          .to(ball, { x: 870, y: 330, duration: 0.7, ease: 'power1.out' }, 'arrive')
          .to(ballShadow, { x: 870, y: 340, duration: 0.7, ease: 'power1.out' }, 'arrive')
          .to(sirFig, { y: S.y, duration: 0.5, ease: 'bounce.out' }, 'arrive+=0.5');
      } },
      miss3: { text: "Bro wasn't even looking.", stamp: 'NOT LOOKING', bubble: '?', pre(tl) {
        tl.to(gaze, { attr: { cx: 9, cy: -28 }, duration: 0.3 }, 0.1).to(headGrp, { rotation: 35, transformOrigin: '50% 60%', duration: 0.3 }, 0.1);
      }, play(tl) {
        tl.to(ball, { x: 600, y: 330, duration: 0.6, ease: 'power2.out' }, 'arrive')
          .to(ballShadow, { x: 600, y: 340, duration: 0.6, ease: 'power2.out' }, 'arrive')
          .to(torso, { rotation: -8, duration: 0.15, yoyo: true, repeat: 1 }, 'arrive')
          .to(headGrp, { rotation: -35, duration: 0.4, ease: 'power2.inOut' }, 'arrive+=0.8')
          .to(gaze, { attr: { cx: -7, cy: -24 }, duration: 0.3 }, 'arrive+=1.2')
          .to(headGrp, { rotation: 0, duration: 0.3 }, 'arrive+=1.3');
      } },
      miss4: { text: 'He was checking his phone.', stamp: 'ON THE PHONE', bubble: 'lol', pre(tl) {
        tl.to(phone, { opacity: 1, duration: 0.3 }, 0).to(headGrp, { rotation: -28, transformOrigin: '50% 60%', duration: 0.3 }, 0)
          .to($('.fig-phone-screen'), { opacity: 0.4, duration: 0.25, yoyo: true, repeat: 7 }, 0.2);
      }, play(tl) {
        tl.to(ball, { x: 880, y: 205, duration: 0.7, ease: 'power1.out' }, 'arrive')
          .to(ballShadow, { x: 880, y: 215, duration: 0.7, ease: 'power1.out' }, 'arrive')
          .to(headGrp, { rotation: 0, duration: 0.3 }, 'arrive+=1.0')
          .to(phone, { opacity: 0, duration: 0.3 }, 'arrive+=1.1');
      } },
      miss5: { text: 'The ball filed a complaint.', stamp: 'COMPLAINT FILED', bubble: '', play(tl) {
        tl.to(ball, { y: TARGET.y - 26, duration: 0.14, yoyo: true, repeat: 3, ease: 'power1.out' }, 'arrive')
          .to(complaint, { opacity: 1, y: TARGET.y - 70, duration: 0.4, ease: 'back.out(2)', onStart: () => sfx.play('pop') }, 'arrive+=0.5')
          .to(ball, { x: 330, y: 380, duration: 1.1, ease: 'power1.inOut' }, 'arrive+=0.9')
          .to(ballShadow, { x: 330, y: 390, duration: 1.1, ease: 'power1.inOut' }, 'arrive+=0.9')
          .to(complaint, { opacity: 0, duration: 0.3 }, 'arrive+=1.9');
      } },
      complete: { text: 'Pass completed successfully.', stamp: 'COMPLETED', bubble: '✓', ok: true, play(tl) {
        tl.to(spotlight, { attr: { rx: 220, ry: 160 }, duration: 0.5, ease: 'power2.out' }, 'arrive')
          .to(sirFig, { scale: 1.12, transformOrigin: '50% 50%', duration: 0.3, yoyo: true, repeat: 1, onStart: () => sfx.play('success') }, 'arrive');
      } },
      physics: { text: 'Physics has given up.', stamp: 'PHYSICS: OFFLINE', bubble: '??', play(tl) {
        tl.to(ball, { y: -60, duration: 0.9, ease: 'power2.in' }, 'arrive')
          .to(ballShadow, { scale: 0.2, opacity: 0, transformOrigin: '50% 50%', duration: 0.9 }, 'arrive')
          .to(headGrp, { rotation: -40, transformOrigin: '50% 60%', duration: 0.4 }, 'arrive+=0.3')
          .to(headGrp, { rotation: 0, duration: 0.3 }, 'arrive+=1.3');
      } },
      grass: { text: 'Even the grass moved out of the way.', stamp: 'GRASS: 1 · SIR: 0', bubble: '', play(tl) {
        tl.to(lane, { opacity: 1, duration: 0.3 }, 'arrive-=0.2')
          .to(ball, { x: 905, y: TARGET.y, duration: 0.8, ease: 'power1.out' }, 'arrive')
          .to(ballShadow, { x: 905, y: TARGET.y + 10, duration: 0.8, ease: 'power1.out' }, 'arrive')
          .to(lane, { opacity: 0, duration: 0.4 }, 'arrive+=1.1');
      } },
      postcode: { text: 'The ball is now in a different postcode.', stamp: 'OUT OF RANGE', bubble: '', play(tl) {
        tl.to(ball, { x: 1120, y: 90, duration: 0.7, ease: 'power2.in' }, 'arrive')
          .to(ballShadow, { x: 1120, y: 100, duration: 0.7, ease: 'power2.in' }, 'arrive')
          .to(sirFig, { rotation: -6, duration: 0.2, yoyo: true, repeat: 3 }, 'arrive+=0.3');
      } },
    };
    const FIRST_RUN = ['miss1', 'miss2', 'miss3', 'miss4', 'miss5', 'complete'];
    const LOOP = ['physics', 'grass', 'postcode', 'miss1', 'miss2', 'miss3', 'miss4', 'miss5', 'complete'];

    let attempts = 0, rebooted = false, busy = false, activeTl = null;
    const bez = (t) => { const u = 1 - t; return { x: u * u * BALL0.x + 2 * u * t * CTRL.x + t * t * TARGET.x, y: u * u * BALL0.y + 2 * u * t * CTRL.y + t * t * TARGET.y }; };

    const setCounter = () => { nEl.textContent = attempts; wellEl.textContent = rebooted ? " (well, 1, but we don't talk about it)" : ''; };
    const setPasser = () => { const name = friends[attempts % friends.length].toUpperCase(); passerName.textContent = name; passerLabel.textContent = name; };

    function resetFigures() {
      gsap.killTweensOf([ball, ballShadow, sirFig, torso, headGrp, gaze, phone, bubble, lane, complaint, spotlight, passerFig]);
      gsap.set(ball, { x: BALL0.x, y: BALL0.y, scale: 1, opacity: 1 });
      gsap.set(ballShadow, { x: BALL0.x, y: BALL0.y + 10, scale: 1, opacity: 1 });
      gsap.set(sirFig, { x: S.x, y: S.y, rotation: 0, scale: 1 });
      gsap.set([torso, headGrp], { rotation: 0 });
      gsap.set(gaze, { attr: { cx: -7, cy: -24 } });
      gsap.set([phone, bubble, lane, complaint], { opacity: 0 });
      gsap.set(complaint, { x: TARGET.x + 40, y: TARGET.y - 40 });
      gsap.set(spotlight, { attr: { rx: 150, ry: 110 } });
      gsap.set(passerFig, { rotation: 0, x: P.x, y: P.y });
      trail.style.strokeDashoffset = `${trailLen}`; trail.setAttribute('opacity', '0');
      ghosts.innerHTML = '';
    }

    function showResult(n, o) {
      resultN.textContent = `ATTEMPT ${String(n).padStart(2, '0')} · REVIEW COMPLETE`;
      resultText.textContent = o.text;
      stamp.textContent = o.stamp; stamp.hidden = false; stamp.classList.toggle('pass-stamp-ok', !!o.ok);
      $('.pass-result').classList.toggle('is-ok', !!o.ok);
      gsap.fromTo(resultText, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
      gsap.fromTo(stamp, { scale: 2.2, opacity: 0, rotate: -8 }, { scale: 1, opacity: 0.92, rotate: -8, duration: 0.35, ease: 'power4.out', onStart: () => sfx.play(o.ok ? 'success' : 'error') });
    }

    function playAttempt() {
      if (busy) return;
      busy = true; playBtn.disabled = true;
      resetFigures();
      attempts++;
      const key = rebooted ? LOOP[(attempts - 1) % LOOP.length] : FIRST_RUN[Math.min(attempts - 1, FIRST_RUN.length - 1)];
      const o = OUT[key];
      setCounter();
      api.event('pass_attempt', { n: attempts, outcome: key, passer: friends[attempts % friends.length] });

      resultN.textContent = `ATTEMPT ${String(attempts).padStart(2, '0')} · REVIEWING…`;
      resultText.textContent = 'Ball in motion.'; stamp.hidden = true; $('.pass-result').classList.remove('is-ok');

      const prog = { t: 0 }; let lastGhost = 0;
      const tl = gsap.timeline({ onComplete: () => finishAttempt(key, o) });
      activeTl = tl;
      o.pre?.(tl);
      // wind-up + kick
      tl.to(passerFig, { rotation: -14, x: P.x - 10, duration: 0.35, ease: 'power2.in' }, 0.2)
        .to(passerFig, { rotation: 10, x: P.x + 8, duration: 0.12, ease: 'power4.out', onStart: () => sfx.play('kick') }, 'kick')
        .to(passerFig, { rotation: 0, x: P.x, duration: 0.5, ease: 'elastic.out(1, 0.5)' })
        .set(trail, { attr: { opacity: 0.9 } }, 'kick')
        .to(prog, { t: 1, duration: 1.35, ease: 'power1.inOut', onUpdate() {
          const p = bez(prog.t), lift = Math.sin(prog.t * Math.PI) * 34;
          gsap.set(ball, { x: p.x, y: p.y - lift, rotation: prog.t * 720, scale: 1 + Math.sin(prog.t * Math.PI) * 0.35 });
          gsap.set(ballShadow, { x: p.x, y: p.y + 10, scale: 1 - Math.sin(prog.t * Math.PI) * 0.4, opacity: 1 - Math.sin(prog.t * Math.PI) * 0.5 });
          trail.style.strokeDashoffset = `${trailLen * (1 - prog.t)}`;
          if (!motion.reduced && prog.t - lastGhost > 0.07) {
            lastGhost = prog.t;
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            g.setAttribute('r', '7'); g.setAttribute('cx', p.x); g.setAttribute('cy', p.y - lift); g.setAttribute('fill', 'rgba(46,229,107,.55)'); ghosts.appendChild(g);
            gsap.to(g, { attr: { r: 1 }, opacity: 0, duration: 0.9, onComplete: () => g.remove() });
          }
        } }, 'kick')
        .addLabel('arrive')
        .to(trail, { attr: { opacity: 0 }, duration: 0.8 }, 'arrive+=0.2');
      if (o.bubble) tl.call(() => { bubble.textContent = o.bubble; }, null, 'arrive').fromTo(bubble, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25 }, 'arrive+=0.15');
      o.play(tl);
      tl.to({}, { duration: 0.35 });
    }

    function finishAttempt(key, o) {
      showResult(attempts, o);
      if (o.ok) { setTimeout(reboot, motion.reduced ? 200 : 900); return; }
      busy = false; playBtn.disabled = false; playBtn.textContent = 'TRY AGAIN';
      setPasser();
    }

    function reboot() {
      sfx.play('glitch');
      glitch.hidden = false; glitch.classList.add('is-on');
      motion.shake($('.pass-stage'), { intensity: 10, duration: 0.6 });
      const lines = ['> completion detected', '> checking source… ' + nick, '> result: impossible', '> purging attempt log', '> restoring canon'];
      glitchLog.innerHTML = '';
      lines.forEach((l, i) => setTimeout(() => { const d = document.createElement('div'); d.textContent = l; glitchLog.appendChild(d); sfx.play('tick'); }, motion.reduced ? 0 : 350 + i * 320));
      setTimeout(() => {
        glitch.classList.remove('is-on'); glitch.hidden = true;
        attempts = 0; rebooted = true; setCounter();
        resetFigures();
        resultN.textContent = 'LOG CLEARED';
        resultText.textContent = 'That never happened. Try again.';
        stamp.hidden = true; $('.pass-result').classList.remove('is-ok');
        setPasser();
        busy = false; playBtn.disabled = false; playBtn.textContent = 'TRY AGAIN';
        toast.show({ icon: '🔁', title: 'System rebooted.', body: 'The completion has been removed from the record.' });
      }, motion.reduced ? 600 : 2600);
    }

    playBtn.addEventListener('click', playAttempt);
    motion.magnetic(playBtn);

    ctx.onSectionEnter(el, () => { if (!motion.reduced) sfx.play('whistle'); });
  },
};
