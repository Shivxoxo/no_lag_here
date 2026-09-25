// 08 · ANIME — manga-panel interface: ∞ hours counter, OVER 9000 egg, fake recommendation engine.
export default {
  id: 'anime',
  title: 'Anime Consumption',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, eggs, fx, motion, api, pick, randInt, shuffle } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || (profile.name || 'Sir').split(' ')[0];

    const STATS = [
      { label: '"JUST ONE MORE EPISODE" SAID', value: '∞', note: 'times · still counting', big: true },
      { label: 'TRAINING ARCS WATCHED', value: '412', note: 'each one very inspiring', to: 412 },
      { label: 'TRAINING ARCS APPLIED', value: '0', note: 'motivation lasted 4 minutes', to: 0 },
      { label: 'HOMEWORK EPISODES', value: '0', note: 'series never got a season 1', to: 0 },
    ];

    el.innerHTML = `
      <div class="an-bg" aria-hidden="true">
        <div class="an-speed"></div>
        <div class="an-halftone"></div>
        <div class="an-kana">サー</div>
        <div class="an-petals">${Array.from({ length: 16 }, (_, i) => `<span class="an-petal" style="--x:${(i * 6.3 + Math.random() * 6).toFixed(1)}%;--d:${(9 + Math.random() * 9).toFixed(1)}s;--dl:${(-Math.random() * 18).toFixed(1)}s;--s:${(0.6 + Math.random() * 0.8).toFixed(2)};--sw:${(20 + Math.random() * 60).toFixed(0)}px"></span>`).join('')}</div>
      </div>

      <div class="container an-wrap">
        <div class="sec-head an-head">
          <span class="eyebrow">CHAPTER 07 · SUBJECT: ${esc(nick)} · STREAMING FORENSICS</span>
          <h2 class="display h1 an-title"><span class="an-title-a">ANIME</span> <span class="an-title-b">CONSUMPTION ANALYSIS</span></h2>
          <p class="lead">We pulled the watch history of ${esc(first)}. The server asked us to stop. We did not stop.</p>
        </div>

        <div class="an-hero" data-reveal>
          <div class="an-panel an-panel-main">
            <span class="an-panel-tag mono">PANEL 01 · HOURS LOGGED</span>
            <div class="an-hours-label display">ANIME HOURS:</div>
            <button class="an-counter display tabular" type="button" aria-label="Anime hours counter. Click to add more hours.">0</button>
            <div class="an-session mono" aria-live="polite">
              <span class="an-session-label">POWER LEVEL</span>
              <span class="an-session-val tabular">0</span><span class="an-session-max"> / 9,000</span>
              <span class="an-session-track" aria-hidden="true"><span class="an-session-fill"></span></span>
              <span class="an-session-hint muted">tap the number · it gets worse</span>
            </div>
          </div>
          <div class="an-panel an-panel-quote">
            <span class="an-panel-tag mono">PANEL 02 · VERDICT</span>
            <p class="an-line an-line-1 display">At this point, anime is not a hobby.</p>
            <p class="an-line an-line-2 display">Anime is a full-time occupation. <span class="an-overtime mono" aria-label="with overtime">+ OVERTIME</span></p>
            <span class="an-sfx display" aria-hidden="true">ドドド</span>
          </div>
        </div>

        <ul class="an-stats" aria-label="Secondary statistics">
          ${STATS.map((s, i) => `<li class="an-stat an-panel" data-reveal style="--i:${i}">
            <span class="an-stat-label mono">${esc(s.label)}</span>
            <span class="an-stat-value display tabular ${s.big ? 'is-inf' : ''}" data-to="${s.to ?? ''}">${esc(s.value)}</span>
            <span class="an-stat-note mono muted">${esc(s.note)}</span>
          </li>`).join('')}
        </ul>

        <div class="an-engine">
          <div class="an-engine-copy" data-reveal>
            <span class="eyebrow">PANEL 07 · RECOMMENDATION ENGINE v9000</span>
            <h3 class="display h2">WHAT SHOULD ${esc(nick)} WATCH NEXT?</h3>
            <p class="an-engine-lead">Trained on his watch history, his football career, and the biryani receipts. Every title is fictional. Every title is exactly his life.</p>
            <div class="row">
              <button class="btn btn-lg an-rec-btn" type="button">RECOMMEND AN ANIME</button>
              <span class="an-rec-count mono muted" aria-live="polite">0 recommendations</span>
            </div>
            <div class="an-overheat mono" role="status" hidden>
              <span class="an-overheat-icon" aria-hidden="true">🔥</span>
              <span class="an-overheat-text">RECOMMENDATION ENGINE OVERHEATED</span>
              <span class="an-overheat-sub">cooling with a fan · continuing anyway</span>
            </div>
            <div class="an-history">
              <span class="an-history-label mono">WATCH HISTORY · LAST 5</span>
              <ol class="an-history-list mono" aria-live="polite"><li class="an-history-empty muted">nothing yet (suspicious)</li></ol>
            </div>
          </div>
          <div class="an-stage" aria-live="polite" aria-atomic="true">
            <div class="an-stage-empty">
              <span class="an-stage-kana" aria-hidden="true">次</span>
              <span class="mono muted">press the button · a card will slam in</span>
            </div>
          </div>
        </div>

        <p class="an-disclaimer mono muted">Hours verified by nobody. Titles are 100% fictional parodies invented by his friends. Any resemblance to a real anime is because he watched all of them.</p>
      </div>`;

    const counter = el.querySelector('.an-counter');
    const panelMain = el.querySelector('.an-panel-main');
    const sessionVal = el.querySelector('.an-session-val');
    const sessionFill = el.querySelector('.an-session-fill');
    const stage = el.querySelector('.an-stage');
    const recBtn = el.querySelector('.an-rec-btn');
    const recCount = el.querySelector('.an-rec-count');
    const overheat = el.querySelector('.an-overheat');
    const historyList = el.querySelector('.an-history-list');

    // ── Hero counter: 0 → 999,999 → glitch → ∞ ────────────────
    let infinite = false;
    const goInfinite = () => {
      infinite = true;
      counter.textContent = '∞';
      counter.classList.add('is-inf');
      counter.setAttribute('aria-label', 'Anime hours: infinite. Click to add more hours.');
    };
    ctx.onSectionEnter(el, () => {
      if (motion.reduced) { goInfinite(); el.querySelectorAll('.an-stat-value[data-to]').forEach(n => { if (n.dataset.to !== '') n.textContent = Number(n.dataset.to).toLocaleString(); }); return; }
      const tl = gsap.timeline();
      tl.add(motion.countUp(counter, 999999, { duration: 2.8, ease: 'power3.in' }))
        .add(() => { counter.classList.add('is-glitch'); sfx.play('glitch'); })
        .to(counter, { x: -6, duration: 0.05, repeat: 9, yoyo: true, ease: 'none' })
        .add(() => { counter.classList.remove('is-glitch'); goInfinite(); sfx.play('boom'); motion.shake(panelMain, { intensity: 5, duration: 0.35 }); })
        .fromTo(counter, { scale: 1.6, filter: 'blur(6px)' }, { scale: 1, filter: 'blur(0px)', duration: 0.7, ease: 'elastic.out(1, 0.4)' })
        .add(() => { el.querySelector('.an-overtime').classList.add('is-on'); }, '-=0.4');
      el.querySelectorAll('.an-stat-value[data-to]').forEach((n, i) => { if (n.dataset.to !== '') gsap.delayedCall(0.4 + i * 0.15, () => motion.countUp(n, Number(n.dataset.to), { duration: 1.4 })); });
    });

    // ── Clickable counter → power level → OVER 9000 egg ──────
    let session = 0;
    counter.addEventListener('click', (e) => {
      const add = randInt(500, 1500);
      session += add;
      sfx.play('pop');
      sessionVal.textContent = session.toLocaleString();
      sessionFill.style.width = Math.min(100, (session / 9000) * 100) + '%';
      panelMain.classList.toggle('is-hot', session >= 6000);
      // punchy number pop
      const r = panelMain.getBoundingClientRect();
      const px = e.clientX ? e.clientX - r.left : r.width / 2, py = e.clientY ? e.clientY - r.top : r.height / 2;
      const pop = document.createElement('span'); pop.className = 'an-pop display'; pop.textContent = `+${add.toLocaleString()}`;
      pop.style.left = px + 'px'; pop.style.top = py + 'px'; pop.style.setProperty('--r', ((Math.random() - 0.5) * 30).toFixed(1) + 'deg');
      panelMain.appendChild(pop);
      if (motion.reduced) { setTimeout(() => pop.remove(), 700); }
      else {
        gsap.fromTo(pop, { scale: 0.4, opacity: 0, y: 0 }, { scale: 1.2, opacity: 1, y: -30, duration: 0.25, ease: 'back.out(3)' });
        gsap.to(pop, { y: -110, opacity: 0, scale: 0.9, duration: 0.6, delay: 0.25, ease: 'power2.in', onComplete: () => pop.remove() });
        gsap.fromTo(counter, { scale: 1.12, rotate: (Math.random() - 0.5) * 6 }, { scale: 1, rotate: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
        fx.burst({ x: e.clientX || r.left + r.width / 2, y: e.clientY || r.top + r.height / 2, count: 10, color: '#ff3d8f', power: 6, size: 3 });
      }
      if (!infinite && !motion.reduced) { /* still counting up: let the timeline finish, the pop is enough */ }
      if (session >= 9000) { session = 0; setTimeout(() => { sessionVal.textContent = '0'; sessionFill.style.width = '0%'; panelMain.classList.remove('is-hot'); }, 2400); eggs.unlock('anime-9000'); }
    });

    eggs.onUnlock('anime-9000', () => {
      // Unique animation: IT'S OVER 9000! — text slam, screen-crack, shake, aura.
      const layer = document.createElement('div'); layer.className = 'an-over9000'; layer.setAttribute('aria-hidden', 'true');
      const cracks = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4; let x = 50, y = 50, d = `M50 50`;
        for (let s = 0; s < 5; s++) { x += Math.cos(a + (Math.random() - 0.5) * 0.9) * (6 + Math.random() * 9); y += Math.sin(a + (Math.random() - 0.5) * 0.9) * (6 + Math.random() * 9); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
        return `<path d="${d}" />`;
      }).join('');
      layer.innerHTML = `
        <div class="an-aura"></div>
        <svg class="an-crack" viewBox="0 0 100 100" preserveAspectRatio="none">${cracks}<circle cx="50" cy="50" r="2.5" /></svg>
        <div class="an-over-text display"><span class="an-over-l1">IT'S OVER</span><span class="an-over-l2">9000!</span></div>
        <div class="an-over-sub mono">POWER LEVEL: ANIME HOURS · SCOUTER DESTROYED</div>`;
      document.body.appendChild(layer);
      sfx.play('power');
      if (motion.reduced) { layer.classList.add('is-static'); setTimeout(() => layer.remove(), 2600); return; }
      const paths = layer.querySelectorAll('.an-crack path');
      paths.forEach(p => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
      const tl = gsap.timeline({ onComplete: () => layer.remove() });
      tl.fromTo(layer.querySelector('.an-aura'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' })
        .fromTo(layer.querySelector('.an-over-l1'), { scale: 4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'power4.in' }, 0.1)
        .fromTo(layer.querySelector('.an-over-l2'), { scale: 5, opacity: 0, rotate: -8 }, { scale: 1, opacity: 1, rotate: -4, duration: 0.4, ease: 'power4.in', onComplete: () => { sfx.play('boom'); motion.shake(el, { intensity: 14, duration: 0.7 }); motion.shake(layer.querySelector('.an-over-text'), { intensity: 10, duration: 0.6 }); fx.burst({ x: innerWidth / 2, y: innerHeight / 2, count: 90, color: '#ff3d8f', power: 18, size: 5, life: 1400 }); fx.confetti({ count: 120, colors: ['#ff3d8f', '#ffcc4d', '#ffffff'], power: 18 }); } }, 0.45)
        .to(paths, { strokeDashoffset: 0, duration: 0.5, stagger: 0.02, ease: 'power2.out' }, 0.85)
        .fromTo(layer.querySelector('.an-over-sub'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 }, 1.1)
        .to(layer.querySelector('.an-aura'), { scale: 1.25, opacity: 0.8, duration: 0.9, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 1)
        .to(layer, { opacity: 0, duration: 0.6, ease: 'power2.in' }, 3.2);
    });

    // ── Recommendation engine (combinatorial, escalating) ────
    const FRANCHISE = ['Attack on', 'Demon Slayer:', 'Jujutsu Kaisen:', 'Naruto Shippuden:', 'Death Note:', 'Dragon Ball:', 'One Piece:', 'Hunter × Hunter:', 'Bleach:', 'Fullmetal Procrastinator:'];
    const SUBJECT = ['Homework', 'Biryani', 'the Midfield', 'the Snooze Button', 'Chemistry Notes', 'the Study Timetable', 'the Perfect Pass', 'the 11PM Gym', 'the Offside Rule', 'the Exam Hall', 'Nationals Selection', 'the Free Fire Lobby', 'the BGMI Rank', 'Tomorrow', 'the Late Bus'];
    const ARC = ['Study Timetable Arc', 'Missed Pass Arc', 'Overtime Arc', 'Snooze Button Arc', 'Biryani Tournament Arc', 'Final Exam Arc', 'Unnational Arc', 'Gym Membership Arc', 'Homework Deadline Arc', 'One Last Episode Arc', 'Late To Training Arc', 'Five More Minutes Arc'];
    const ROLE = ['Midfielder', 'Study Buddy', 'Alarm Clock', 'Chemistry Teacher', 'Goalkeeper', 'Squad Leader', 'Biryani Delivery Guy', 'Gym Trainer', 'Group Project Partner'];
    const ADJ = ['Unnational', 'Late', 'Offside', 'Unprepared', 'Sleepy', 'Hungry', 'Distracted', 'Unselected', 'Confused', 'Lazy'];
    const THING = ['a Biryani', 'a Snooze Button', 'a Missed Pass', 'a Blank Answer Sheet', 'a Gym Membership Nobody Uses', 'a Bench (Substitute Edition)', 'a Buffering Icon', 'the Word "Tomorrow"', 'an Unopened Textbook', 'a Loading Screen'];
    const EDITION = ['Exam Edition', 'Homework Edition', 'Biryani Edition', 'Gym at 11PM', 'Nationals Rejection Edition', 'Snooze Edition', '5 Minutes Edition', 'Substitute Bench Edition', 'Study Timetable Edition', 'Late Again Edition'];
    const ONE = ['Pass', 'Page', 'Push-Up', 'Episode', 'Biryani', 'Alarm', 'Homework', 'Rep', 'Lap', 'Chapter'];
    const NUM = ['5', '500', '9000', '0', '1', '999', '404', '11', '2'];
    const CURSE = ['Minutes Curse', 'Episodes Curse', 'Missed Passes Curse', 'Unread Pages Curse', 'Alarms Curse', 'Biryanis Curse'];
    const PLACE = ['Gym', 'Exam Hall', 'Midfield', 'Training Ground', 'Biryani Counter', 'Bed', 'Library (Never)', 'Lobby'];
    const TIME = ['11PM', '3AM', '5 Minutes Later', 'Tomorrow', 'The Day Before the Exam', 'Halftime', 'After One More Episode', 'Never'];
    const GENRES = ['Shonen', 'Slice of Lazy', 'Isekai', 'Sports (Bench)', 'Psychological', 'Romance (with Biryani)', 'Mecha', 'Horror (Exams)', 'Comedy', 'Tragedy', 'Cooking', 'Battle Royale', 'Supernatural', 'Coming of Age (Late)', 'Survival', 'Educational (Ironically)', 'Mystery: Where Is The Homework', 'Time Loop', 'Action', 'Shonen Sports Isekai Tragedy'];
    const SYN = [
      t => `${first} must pass the ball before the episode ends. He does neither.`,
      t => `A young midfielder discovers the true power of friendship, then falls asleep during the exam.`,
      t => `In a world where homework is real, one boy chooses to watch ${t} instead.`,
      t => `Betrayed by his alarm clock, ${nick} trains at 11PM to become the strongest sleeper alive.`,
      t => `A biryani so powerful it deletes the entire study timetable. Nobody is surprised.`,
      t => `He was not selected for nationals. So he rewatched ${t} 14 times. It didn't help.`,
      t => `Season ${randInt(2, 9)}: the exam paper is revealed and confidence goes from 100 to 0 in one frame.`,
      t => `A ${randInt(600, 2400)}-episode journey to find the one pass ${nick} actually received. Spoiler: filler.`,
      t => `Every training arc ever made, watched back to back, applied zero times. A masterpiece of intent.`,
      t => `"Just one more episode," he whispers, at 3:47 AM, on a school night, for the ${randInt(200, 900)}th time.`,
      t => `The final boss is a chemistry paper. Our hero brings a highlighter and hope. Only the highlighter survives.`,
      t => `${nick} is reincarnated as the Snooze Button. Honestly, it's less of a change than you'd think.`,
    ];
    const TEMPLATES = [
      () => `${pick(FRANCHISE)} ${pick(ARC)}`,
      () => `Attack on ${pick(SUBJECT).replace(/^the /, '')}`,
      () => `My ${pick(ROLE)} Can't Be This ${pick(ADJ)}`,
      () => `That Time I Got Reincarnated as ${pick(THING)}`,
      () => `${pick(FRANCHISE)} ${pick(EDITION)}`,
      () => `One ${pick(ONE)}`,
      () => `${pick(FRANCHISE)} The ${pick(NUM)} ${pick(CURSE)}`,
      () => `${pick(FRANCHISE)} ${pick(PLACE)} at ${pick(TIME)}`,
      () => `Is It Wrong to Try to Pick Up ${pick(SUBJECT).replace(/^the /, 'a ')} at ${pick(TIME)}?`,
      () => `${nick} and the ${pick(ARC).replace(' Arc', '')}: The Movie`,
    ];
    const SUFFIX = [() => ` — Season ${randInt(2, 12)}`, () => ` (Director's Cut)`, () => `: The Movie`, () => ` — Part ${randInt(2, 7)}: ${pick(ARC)}`, () => ` (${pick(EDITION)})`, () => ` ~ Rebuild ~`, () => `: Final Season (Part ${randInt(3, 9)})`, () => ` OVA: ${pick(TIME)}`];
    const BADGES = ['NEW SEASON', 'TRENDING', 'STAFF PICK', 'ALGORITHM CERTIFIED', 'BINGE READY', 'BANNED BY TEACHERS', 'SIR-APPROVED', 'AIRING FOREVER'];

    const generate = (n) => {
      let title = pick(TEMPLATES)();
      const extra = Math.min(3, Math.floor((n - 1) / 2)); // absurdity escalates: more suffixes
      const used = new Set();
      for (let i = 0; i < extra; i++) { let s; do { s = randInt(0, SUFFIX.length - 1); } while (used.has(s)); used.add(s); title += SUFFIX[s](); }
      if (n > 8) title = title.toUpperCase() + '!'.repeat(Math.min(3, n - 8));
      const tags = shuffle(GENRES).slice(0, Math.min(6, 2 + Math.floor(n / 2)));
      const ep = n < 3 ? '∞' : n < 6 ? '∞ + 1' : n < 9 ? '∞ (filler: 94%)' : '∞ⁿ';
      const status = n < 4 ? 'Watching instead of studying' : n < 7 ? 'Rewatching instead of studying' : n < 10 ? 'Watching during the exam' : 'Became the anime';
      return { title, tags, ep, status, syn: pick(SYN)(title), badge: pick(BADGES) };
    };

    let recN = 0; const history = [];
    const renderHistory = () => { historyList.innerHTML = history.map((t, i) => `<li><span class="an-history-n">${String(history.length - i).padStart(2, '0')}</span><span class="an-history-t">${esc(t)}</span></li>`).join(''); };
    let busy = false;
    recBtn.addEventListener('click', () => {
      if (busy) return; busy = true; setTimeout(() => { busy = false; }, motion.reduced ? 150 : 650);
      recN++;
      const rec = generate(recN);
      history.unshift(rec.title); if (history.length > 5) history.pop(); renderHistory();
      recCount.textContent = `${recN} recommendation${recN === 1 ? '' : 's'}${recN >= 6 ? ' · engine at ' + Math.min(999, 100 + recN * 37) + '°C' : ''}`;
      api.event('anime_recommend', { n: recN });
      if (recN === 5) { overheat.hidden = false; sfx.play('error'); if (!motion.reduced) { gsap.fromTo(overheat, { scale: 0.7, opacity: 0, rotate: -3 }, { scale: 1, opacity: 1, rotate: -1.5, duration: 0.5, ease: 'back.out(2)' }); motion.shake(recBtn, { intensity: 6, duration: 0.5 }); } fx.emoji({ emoji: ['🔥', '💨'], count: 14 }); }
      if (recN > 5) { overheat.querySelector('.an-overheat-sub').textContent = pick(['cooling with a fan · continuing anyway', 'temperature: ' + (300 + recN * 40) + '°C · still recommending', 'engine is now a toaster · continuing', 'smoke detected · titles unaffected', 'engine has left the chat · titles still arriving']); }

      const old = stage.querySelector('.an-card'); stage.querySelector('.an-stage-empty')?.remove();
      const card = ctx.el(`<article class="an-card ${recN > 5 ? 'is-overheated' : ''}" style="--tilt:${((Math.random() - 0.5) * 4).toFixed(1)}deg">
        <div class="an-card-speed" aria-hidden="true"></div>
        <header class="an-card-top mono"><span class="an-card-n">REC #${String(recN).padStart(3, '0')}</span><span class="an-card-badge">${esc(rec.badge)}</span></header>
        <h4 class="display an-card-title">${esc(rec.title)}</h4>
        <div class="an-card-tags">${rec.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <dl class="an-card-meta mono">
          <div><dt>RATING</dt><dd class="an-card-stars"><span aria-label="5 stars">★★★★★</span> <small>(rated by ${esc(nick)})</small></dd></div>
          <div><dt>EPISODES</dt><dd>${esc(rec.ep)}</dd></div>
          <div><dt>STATUS</dt><dd class="an-card-status"><span class="dot"></span>${esc(rec.status)}</dd></div>
        </dl>
        <p class="an-card-syn">${esc(rec.syn)}</p>
        <span class="an-card-sfx display" aria-hidden="true">${pick(['ドン!', 'バン!', 'ゴゴゴ', 'ズドン', 'キラ☆'])}</span>
      </article>`);
      stage.appendChild(card);
      if (motion.reduced) { old?.remove(); return; }
      sfx.play('whoosh');
      if (old) gsap.to(old, { x: -60, opacity: 0, rotate: 6, duration: 0.25, ease: 'power2.in', onComplete: () => old.remove() });
      const tl = gsap.timeline();
      tl.fromTo(card, { scale: 1.7, opacity: 0, rotate: -7 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.42, ease: 'power4.out', onComplete: () => { sfx.play('hit'); motion.shake(stage, { intensity: 5, duration: 0.3 }); } }, 0.12)
        .fromTo(card.querySelector('.an-card-speed'), { opacity: 1, scale: 1.3 }, { opacity: 0, scale: 1, duration: 0.7, ease: 'power2.out' }, 0.3)
        .fromTo(card.querySelector('.an-card-sfx'), { scale: 0, rotate: 20 }, { scale: 1, rotate: 12, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, 0.45)
        .fromTo(card.querySelectorAll('.an-card-tags .tag'), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.05 }, 0.5);
    });
    motion.magnetic(recBtn);
  },
};
