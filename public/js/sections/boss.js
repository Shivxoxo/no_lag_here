// 15 · BOSS — "SIR: FINAL BOSS". A retro fighting-game boss fight: click,
// throw footballs, slam roast cards, deny excuses, drain the EGO METER.
export default {
  id: 'boss',
  title: 'Final Boss',
  mount(el, ctx) {
    const { profile, settings, photos, esc, gsap, sfx, eggs, fx, motion, api, toast, pick, rand, clamp } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name?.split(' ')[0] || nick;
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
    const CFG = {
      maxHp: Math.round(num(settings.boss_max_hp, 100)),
      clickDmg: num(settings.boss_click_damage, 4),
      regen: num(settings.boss_regen_per_sec, 1.5),
      timeLimit: Math.round(num(settings.boss_time_limit_sec, 60)),
    };
    const heroPhoto = photos.find(p => p.src === settings.hero_photo) || photos[0];
    const TAUNTS = ['5 minutes!', 'I was busy.', 'The pass was bad, actually.', 'Anime > you.', 'One more episode.', 'Bro, lag.'];
    const PHASE_TAUNT = { 2: 'I was busy.', 3: 'The pass was bad, actually.' };
    const CARDS = ['PERFECT PASS', 'NATIONALS LIST', 'EXAM TIMETABLE', 'GYM AT 11PM', 'BIRYANI RECEIPT'];
    const EXCUSES = ['5 MINUTES!', 'MY WIFI!', 'I WAS BUSY!', 'LAG, BRO.'];
    let storedName = 'Anonymous';
    try { storedName = localStorage.getItem('sir.player') || 'Anonymous'; } catch { /* private mode */ }

    el.innerHTML = `
      <div class="boss-bg" aria-hidden="true"><span class="boss-bg-stage display">STAGE ${esc(String(profile.age ?? 16))}</span></div>
      <div class="container">
        <header class="sec-head boss-head">
          <span class="eyebrow">FINAL STAGE · ${esc(profile.combat_class || 'PROFESSIONAL PROCRASTINATOR')} · DIFFICULTY: LATE</span>
          <h2 class="display h1 boss-h1">${esc(nick)} <span class="boss-h1-dash">—</span> FINAL BOSS</h2>
          <p class="lead">Drain his EGO METER before the timer runs out. He regenerates when you stop hitting. He always regenerates.</p>
        </header>

        <div class="boss-frame" data-phase="1" data-state="idle">
          <div class="boss-corner tl" aria-hidden="true"></div><div class="boss-corner tr" aria-hidden="true"></div><div class="boss-corner bl" aria-hidden="true"></div><div class="boss-corner br" aria-hidden="true"></div>

          <div class="boss-hud">
            <div class="boss-hud-row">
              <div class="boss-p boss-p1"><span class="boss-p-lbl mono">P1</span><b class="display">YOU</b></div>
              <div class="boss-timer mono" aria-label="Time left"><span class="boss-time">${CFG.timeLimit}</span></div>
              <div class="boss-p boss-p2"><b class="display">${esc(nick)}</b><span class="boss-p-lbl mono">FINAL BOSS</span></div>
            </div>
            <div class="boss-ego">
              <div class="boss-ego-label mono"><span>EGO METER</span><span class="boss-hp-text" aria-live="polite" aria-atomic="true">${CFG.maxHp} / ${CFG.maxHp}</span></div>
              <div class="boss-ego-track" role="progressbar" aria-label="SIR ego meter" aria-valuemin="0" aria-valuemax="${CFG.maxHp}" aria-valuenow="${CFG.maxHp}">
                <div class="boss-ego-ghost"></div><div class="boss-ego-fill"></div><div class="boss-ego-seg" aria-hidden="true"></div>
              </div>
            </div>
            <div class="boss-stats mono">
              <span>DMG <b class="boss-dmg-total tabular">0</b></span>
              <span class="boss-combo-wrap"><b class="boss-combo tabular">0</b> COMBO <i class="boss-mult">×1.0</i></span>
              <span>PHASE <b class="boss-phase-n">1</b>/3</span>
            </div>
          </div>

          <div class="boss-stage">
            <div class="boss-screen boss-vs">
              <div class="boss-vs-grid">
                <div class="boss-vs-side boss-vs-you"><span class="display boss-vs-name">YOU</span><span class="mono boss-vs-sub">FUELLED BY SPITE</span></div>
                <span class="display boss-vs-vs" aria-hidden="true">VS</span>
                <div class="boss-vs-side boss-vs-sir"><span class="display boss-vs-name">${esc(nick)}</span><span class="mono boss-vs-sub">FUELLED BY BIRYANI</span></div>
              </div>
              <dl class="boss-vs-stats mono">
                <div><dt>EGO</dt><dd>${CFG.maxHp} HP</dd></div>
                <div><dt>REGEN</dt><dd>${CFG.regen}/s</dd></div>
                <div><dt>TIMER</dt><dd>${CFG.timeLimit}s</dd></div>
                <div><dt>WEAKNESS</dt><dd>${esc(profile.known_weakness || 'Perfect passes')}</dd></div>
              </dl>
              <button class="btn btn-danger btn-lg boss-start" type="button">START FIGHT</button>
              <p class="mono boss-vs-hint">Tap ${esc(nick)} · press SPACE · throw ⚽ (3×) · slam roast cards (5×) · click his excuses away</p>
            </div>

            <div class="boss-screen boss-count" hidden aria-live="assertive"><span class="display boss-count-num">3</span></div>

            <div class="boss-arena" hidden>
              <div class="boss-avatar-wrap">
                <div class="boss-aura" aria-hidden="true"></div>
                <button class="boss-avatar" type="button" aria-label="Hit ${esc(nick)}">
                  ${heroPhoto ? `<img src="${esc(heroPhoto.thumb || heroPhoto.url)}" alt="${esc(heroPhoto.title || nick)}" width="220" height="220" loading="lazy" draggable="false">` : `<span class="display boss-avatar-text">${esc(nick)}</span>`}
                  <span class="boss-avatar-glitch" aria-hidden="true"></span>
                </button>
                <div class="boss-taunt mono" role="status" aria-live="polite"></div>
              </div>
              <div class="boss-spawn"></div>
              <div class="boss-fx" aria-hidden="true"></div>
              <div class="boss-flash" aria-hidden="true"></div>
              <div class="boss-ko display" aria-hidden="true">K.O.</div>
              <div class="boss-paused mono" hidden><span class="display">PAUSED</span><span>tab away detected · click to resume</span></div>
            </div>

            <div class="boss-screen boss-result" hidden aria-live="polite">
              <span class="mono boss-result-kicker"></span>
              <h3 class="display boss-result-title"></h3>
              <p class="boss-result-sub"></p>
              <div class="boss-result-stamp display" aria-hidden="true">FLAWLESS</div>
              <dl class="boss-score mono">
                <div><dt>DAMAGE</dt><dd class="boss-sc-dmg tabular">0</dd></div>
                <div><dt>TIME ×10</dt><dd class="boss-sc-time tabular">0</dd></div>
                <div><dt>COMBO ×25</dt><dd class="boss-sc-combo tabular">0</dd></div>
                <div class="boss-score-total"><dt>SCORE</dt><dd class="boss-sc-total tabular display">0</dd></div>
              </dl>
              <form class="boss-form" hidden>
                <label class="mono boss-form-label" for="boss-player">ENTER YOUR NAME, CHAMPION</label>
                <div class="boss-form-row">
                  <input class="boss-input mono" id="boss-player" name="player" type="text" maxlength="30" autocomplete="nickname" placeholder="Anonymous" value="${esc(storedName)}">
                  <button class="btn boss-submit" type="submit">SUBMIT SCORE</button>
                </div>
              </form>
              <p class="mono boss-rank" hidden></p>
              <div class="boss-board" hidden>
                <span class="mono boss-board-title">HALL OF DEFEATERS · TOP 10</span>
                <ol class="boss-board-list mono"></ol>
              </div>
              <div class="boss-result-actions"><button class="btn btn-ghost boss-rematch" type="button">REMATCH <span class="mono boss-key">R</span></button></div>
            </div>
          </div>
          <div class="boss-foot mono" aria-hidden="true"><span>INSERT COIN ▸ NO COINS NEEDED</span><span class="boss-foot-mid">EGO METER™ · PATENT PENDING</span><span>CREDITS: ∞</span></div>
        </div>
        <p class="boss-disclaimer mono muted">Boss stats are 100% fabricated by his friends. Real ${esc(first)} regenerates faster.</p>
      </div>`;

    // ── refs ──────────────────────────────────────────────────
    const q = (s) => el.querySelector(s);
    const frame = q('.boss-frame'), stage = q('.boss-stage'), arena = q('.boss-arena');
    const vs = q('.boss-vs'), count = q('.boss-count'), countNum = q('.boss-count-num'), result = q('.boss-result');
    const avatar = q('.boss-avatar'), avatarWrap = q('.boss-avatar-wrap'), aura = q('.boss-aura'), taunt = q('.boss-taunt');
    const spawn = q('.boss-spawn'), fxLayer = q('.boss-fx'), flash = q('.boss-flash'), ko = q('.boss-ko'), pausedEl = q('.boss-paused');
    const hpText = q('.boss-hp-text'), egoTrack = q('.boss-ego-track'), egoFill = q('.boss-ego-fill'), egoGhost = q('.boss-ego-ghost');
    const timeEl = q('.boss-time'), dmgTotalEl = q('.boss-dmg-total'), comboEl = q('.boss-combo'), multEl = q('.boss-mult'), phaseEl = q('.boss-phase-n'), comboWrap = q('.boss-combo-wrap');
    const form = q('.boss-form'), input = q('.boss-input'), rankEl = q('.boss-rank'), board = q('.boss-board'), boardList = q('.boss-board-list');
    const resultKicker = q('.boss-result-kicker'), resultTitle = q('.boss-result-title'), resultSub = q('.boss-result-sub');

    // ── state ─────────────────────────────────────────────────
    const S = { running: false, paused: false, hp: CFG.maxHp, time: CFG.timeLimit, combo: 0, bestCombo: 0, lastHit: -1e9, damage: 0, phase: 1, regenTicked: false, excuseHealed: false, startedAt: 0, ballT: 1, cardT: 3, excuseT: 5, tauntT: 6, tweens: new Set(), excuses: [] };
    let raf = 0, lastFrame = 0, tauntTimer = 0;
    const reduced = () => motion.reduced;

    // ── HUD ───────────────────────────────────────────────────
    const setState = (s) => { frame.dataset.state = s; };
    const showScreen = (which) => { [vs, count, arena, result].forEach(x => { x.hidden = x !== which; }); };
    const renderHud = () => {
      const pct = clamp(S.hp / CFG.maxHp, 0, 1) * 100;
      egoFill.style.width = `${pct}%`;
      egoTrack.setAttribute('aria-valuenow', String(Math.ceil(S.hp)));
      hpText.textContent = `${Math.max(0, Math.ceil(S.hp))} / ${CFG.maxHp}`;
      timeEl.textContent = String(Math.ceil(S.time));
      timeEl.parentElement.classList.toggle('is-low', S.time <= 10);
      dmgTotalEl.textContent = String(Math.round(S.damage));
      phaseEl.textContent = String(S.phase);
    };
    const comboMult = () => 1 + Math.min(S.combo - 1, 8) * 0.25; // ×1 … ×3
    const renderCombo = () => {
      comboEl.textContent = String(S.combo);
      multEl.textContent = `×${(S.combo ? comboMult() : 1).toFixed(1)}`;
      comboWrap.classList.toggle('is-hot', S.combo >= 5);
      comboWrap.classList.toggle('is-max', S.combo >= 9);
    };
    let ghostTween = null;
    const ghostTo = (pct) => { if (ghostTween) ghostTween.kill(); ghostTween = gsap.to(egoGhost, { width: `${pct}%`, duration: 0.6, delay: 0.25, ease: 'power2.out' }); };

    // ── helpers ───────────────────────────────────────────────
    const arenaRect = () => arena.getBoundingClientRect();
    const avatarCenter = () => { const r = avatar.getBoundingClientRect(), a = arenaRect(); return { x: r.left + r.width / 2 - a.left, y: r.top + r.height / 2 - a.top }; };
    const pointInArena = (e) => { const a = arenaRect(); return { x: e.clientX - a.left, y: e.clientY - a.top }; };
    const track = (tw) => { S.tweens.add(tw); const prev = tw.eventCallback('onComplete'); tw.eventCallback('onComplete', () => { S.tweens.delete(tw); prev?.(); }); return tw; };
    const killTweens = () => { S.tweens.forEach(t => t.kill()); S.tweens.clear(); };
    /** Random point in the arena that avoids the boss in the middle. */
    const randomSpot = (w = 60, h = 60) => {
      const a = arenaRect(); const c = avatarCenter();
      for (let i = 0; i < 12; i++) {
        const x = rand(8, Math.max(8, a.width - w - 8)), y = rand(8, Math.max(8, a.height - h - 8));
        if (Math.hypot(x + w / 2 - c.x, y + h / 2 - c.y) > 130) return { x, y };
      }
      return { x: 8, y: 8 };
    };
    const floatText = (x, y, text, cls = '') => {
      const n = document.createElement('span'); n.className = `boss-dmg ${cls}`; n.textContent = text; n.style.left = `${x}px`; n.style.top = `${y}px`; fxLayer.appendChild(n);
      if (reduced()) { setTimeout(() => n.remove(), 700); return; }
      gsap.fromTo(n, { y: 0, scale: 0.6, opacity: 1, rotate: rand(-12, 12) }, { y: -90, scale: 1.25, opacity: 0, duration: 0.9, ease: 'power2.out', onComplete: () => n.remove() });
    };
    const say = (text, ms = 1800) => {
      taunt.textContent = text; taunt.classList.add('show');
      clearTimeout(tauntTimer); tauntTimer = setTimeout(() => taunt.classList.remove('show'), ms);
      if (!reduced()) gsap.fromTo(taunt, { scale: 0.6, y: 10 }, { scale: 1, y: 0, duration: 0.45, ease: 'back.out(2.5)' });
    };
    const hitFlash = (strength = 1) => {
      if (reduced()) { flash.style.opacity = 0.25; setTimeout(() => { flash.style.opacity = 0; }, 60); return; }
      gsap.fromTo(flash, { opacity: 0.35 * strength }, { opacity: 0, duration: 0.25, ease: 'power2.out' });
    };
    const angry = (strength = 1) => {
      if (reduced()) return;
      gsap.fromTo(avatarWrap, { x: rand(-8, 8) * strength, rotate: rand(-6, 6) * strength, scale: 0.94 }, { x: 0, rotate: 0, scale: 1, duration: 0.5, ease: 'elastic.out(1.2, 0.35)', overwrite: true });
      avatar.classList.add('is-hit'); setTimeout(() => avatar.classList.remove('is-hit'), 160);
    };

    // ── the hit ───────────────────────────────────────────────
    const hit = (mult, x, y, label = '') => {
      if (!S.running || S.paused) return;
      const now = performance.now();
      S.combo = now - S.lastHit <= 800 ? S.combo + 1 : 1;
      S.lastHit = now; S.bestCombo = Math.max(S.bestCombo, S.combo);
      const dmg = Math.max(1, Math.round(CFG.clickDmg * mult * comboMult()));
      S.hp = Math.max(0, S.hp - dmg); S.damage += dmg;
      const c = avatarCenter(); const px = x ?? c.x, py = y ?? c.y;
      floatText(px + rand(-14, 14), py - 20, `-${dmg}`, mult >= 5 ? 'is-huge' : mult >= 3 ? 'is-big' : S.combo >= 9 ? 'is-max' : '');
      if (label) floatText(px, py - 60, label, 'is-label');
      sfx.play(mult >= 3 ? 'boom' : 'hit');
      angry(Math.min(2, 0.6 + mult * 0.3)); hitFlash(Math.min(1.5, 0.6 + mult * 0.2));
      motion.shake(frame, { intensity: Math.min(14, 3 + mult * 2 + S.combo * 0.4), duration: 0.22 });
      if (!reduced()) { const a = arenaRect(); fx.burst({ x: a.left + px, y: a.top + py, count: mult >= 3 ? 22 : 9, color: mult >= 5 ? '#ffcc4d' : '#ff3b3b', power: 5 + mult * 1.5, size: 3, life: 600 }); }
      renderCombo(); renderHud(); ghostTo(clamp(S.hp / CFG.maxHp, 0, 1) * 100);
      checkPhase();
      if (S.hp <= 0) win();
    };
    const checkPhase = () => {
      const p = S.hp / CFG.maxHp;
      const next = p <= 0.33 ? 3 : p <= 0.66 ? 2 : 1;
      if (next > S.phase) {
        S.phase = next; frame.dataset.phase = String(next);
        say(PHASE_TAUNT[next] || pick(TAUNTS), 2200); sfx.play('glitch');
        floatText(avatarCenter().x, avatarCenter().y - 110, `PHASE ${next}`, 'is-phase');
        if (!reduced()) gsap.fromTo(aura, { scale: 1.6, opacity: 1 }, { scale: 1, opacity: 0.85, duration: 0.8, ease: 'power3.out' });
      }
    };

    // ── spawns ────────────────────────────────────────────────
    const ballInterval = () => (1.2 / (1 + (S.phase - 1) * 0.45)) * rand(0.85, 1.15);
    const cardInterval = () => (4.2 / (1 + (S.phase - 1) * 0.35)) * rand(0.8, 1.2);
    const excuseInterval = () => (6 / (1 + (S.phase - 1) * 0.3)) * rand(0.8, 1.2);
    const mk = (cls, html, aria) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = html; b.setAttribute('aria-label', aria); return b; };

    const spawnBall = () => {
      if (spawn.querySelectorAll('.boss-ball').length >= 5) return;
      const b = mk('boss-ball', '⚽', 'Throw a football at ' + nick);
      const p = randomSpot(56, 56); b.style.left = `${p.x}px`; b.style.top = `${p.y}px`; spawn.appendChild(b);
      let thrown = false;
      const drift = () => { if (thrown || !b.isConnected) return; const n = randomSpot(56, 56); track(gsap.to(b, { left: n.x, top: n.y, rotate: '+=180', duration: rand(2.2, 3.2), ease: 'sine.inOut', onComplete: drift })); };
      if (reduced()) { setTimeout(() => { if (!thrown) b.remove(); }, 4500); }
      else { gsap.fromTo(b, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }); drift(); track(gsap.delayedCall(rand(4, 6), () => { if (!thrown && b.isConnected) gsap.to(b, { scale: 0, opacity: 0, duration: 0.25, onComplete: () => b.remove() }); })); }
      const throwIt = (e) => {
        if (thrown || !S.running || S.paused) return; thrown = true; e.preventDefault();
        gsap.killTweensOf(b); const c = avatarCenter(); const r = b.getBoundingClientRect(), a = arenaRect();
        const sx = r.left - a.left, sy = r.top - a.top;
        sfx.play('kick'); b.classList.add('is-thrown');
        if (reduced()) { b.remove(); hit(3, c.x, c.y, 'HEADER!'); return; }
        let lastGhost = 0;
        gsap.to(b, { left: c.x - 28, top: c.y - 28, rotate: '+=720', scale: 0.8, duration: 0.38, ease: 'power2.in',
          onUpdate() { const now = performance.now(); if (now - lastGhost > 35) { lastGhost = now; const g = b.cloneNode(true); g.className = 'boss-ball boss-ball-ghost'; g.style.left = b.style.left; g.style.top = b.style.top; g.style.transform = b.style.transform; spawn.appendChild(g); gsap.to(g, { opacity: 0, scale: 0.3, duration: 0.35, onComplete: () => g.remove() }); } },
          onComplete: () => { b.remove(); hit(3, c.x, c.y, 'HEADER!'); } });
      };
      b.addEventListener('pointerdown', throwIt);
      b.addEventListener('click', (e) => { if (e.detail === 0) throwIt(e); });
    };

    const spawnCard = () => {
      if (spawn.querySelector('.boss-card')) return;
      const name = pick(CARDS);
      const c = mk('boss-card', `<span class="boss-card-k mono">ATTACK</span><span class="boss-card-n display">${esc(name)}</span><span class="boss-card-x mono">×5 DMG</span>`, `Attack: ${name}`);
      const p = randomSpot(150, 96); c.style.left = `${p.x}px`; c.style.top = `${p.y}px`; spawn.appendChild(c);
      let used = false;
      if (!reduced()) { gsap.fromTo(c, { scale: 0.4, opacity: 0, rotate: -12 }, { scale: 1, opacity: 1, rotate: rand(-6, 6), duration: 0.45, ease: 'back.out(2.2)' }); }
      sfx.play('pop');
      track(gsap.delayedCall(2.8, () => { if (!used && c.isConnected) { used = true; if (reduced()) c.remove(); else gsap.to(c, { opacity: 0, y: 20, duration: 0.3, onComplete: () => c.remove() }); } }));
      const slam = (e) => {
        if (used || !S.running || S.paused) return; used = true; e.preventDefault();
        gsap.killTweensOf(c); const t = avatarCenter(); const w = c.offsetWidth, h = c.offsetHeight;
        sfx.play('whoosh'); c.classList.add('is-slam');
        if (reduced()) { c.remove(); hit(5, t.x, t.y, name); return; }
        gsap.timeline({ onComplete: () => { c.remove(); hit(5, t.x, t.y, name); } })
          .to(c, { left: t.x - w / 2, top: t.y - h / 2 - 40, scale: 1.5, rotate: 0, duration: 0.3, ease: 'power2.in' })
          .to(c, { scale: 0.85, top: t.y - h / 2, duration: 0.12, ease: 'power4.in' })
          .to(c, { opacity: 0, scale: 1.4, duration: 0.2 });
      };
      c.addEventListener('pointerdown', slam);
      c.addEventListener('click', (e) => { if (e.detail === 0) slam(e); });
    };

    const spawnExcuse = () => {
      if (S.excuses.length) return;
      const text = pick(EXCUSES);
      const x = mk('boss-excuse', `<span class="boss-excuse-k mono">EXCUSE INCOMING</span><span class="boss-excuse-t display">${esc(text)}</span><span class="boss-excuse-bar"><i></i></span><span class="boss-excuse-hint mono">CLICK TO DENY</span>`, `Deny excuse: ${text}`);
      const c = avatarCenter(); const a = arenaRect(); const r = avatar.offsetWidth / 2;
      const narrow = a.width < 520; // phones: below the boss; desktop: beside him
      const left = narrow ? c.x - 85 : (c.x > a.width / 2 ? c.x - r - 190 : c.x + r + 20);
      x.style.left = `${clamp(left, 6, Math.max(6, a.width - 176))}px`; x.style.top = `${clamp(narrow ? c.y + r + 12 : c.y - 60, 6, Math.max(6, a.height - 120))}px`;
      spawn.appendChild(x); sfx.play('error'); say(text, 1400);
      const ex = { el: x, t: 2, done: false, bar: x.querySelector('.boss-excuse-bar i') };
      S.excuses.push(ex);
      if (!reduced()) gsap.fromTo(x, { scale: 0.5, opacity: 0, y: 20 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: 'back.out(2)' });
      const deny = (e) => {
        if (ex.done || !S.running || S.paused) return; ex.done = true; e.preventDefault();
        S.excuses = S.excuses.filter(z => z !== ex); sfx.play('success');
        const r = x.getBoundingClientRect(); const p = { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
        floatText(p.x, p.y, 'DENIED', 'is-denied');
        if (reduced()) { x.remove(); return; }
        gsap.to(x, { scale: 0.3, opacity: 0, rotate: 20, duration: 0.25, ease: 'power2.in', onComplete: () => x.remove() });
      };
      x.addEventListener('pointerdown', deny);
      x.addEventListener('click', (e) => { if (e.detail === 0) deny(e); });
    };
    const excuseHeal = (ex) => {
      ex.done = true; S.excuses = S.excuses.filter(z => z !== ex);
      const before = S.hp; S.hp = Math.min(CFG.maxHp, S.hp + 8);
      if (S.hp > before) { S.excuseHealed = true; }
      const c = avatarCenter(); floatText(c.x, c.y - 70, `+${Math.round(S.hp - before)}`, 'is-heal'); say('Anime > you.', 1600);
      sfx.play('power'); egoFill.classList.add('is-heal'); setTimeout(() => egoFill.classList.remove('is-heal'), 500);
      renderHud(); ghostTo(clamp(S.hp / CFG.maxHp, 0, 1) * 100);
      if (reduced()) ex.el.remove(); else gsap.to(ex.el, { scale: 1.2, opacity: 0, duration: 0.3, onComplete: () => ex.el.remove() });
    };

    // ── game loop ─────────────────────────────────────────────
    const tick = (now) => {
      if (!S.running) return;
      raf = requestAnimationFrame(tick);
      if (S.paused) { lastFrame = now; return; }
      const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
      S.time -= dt;
      if (S.time <= 0) { S.time = 0; renderHud(); lose(); return; }
      if (now - S.lastHit > 1500 && S.hp < CFG.maxHp) {
        const before = S.hp; S.hp = Math.min(CFG.maxHp, S.hp + CFG.regen * dt);
        if (S.hp > before && !S.regenTicked) { S.regenTicked = true; }
        egoFill.classList.add('is-regen');
      } else egoFill.classList.remove('is-regen');
      if (S.combo && now - S.lastHit > 800) { S.combo = 0; renderCombo(); }
      for (const ex of S.excuses.slice()) { ex.t -= dt; if (ex.bar) ex.bar.style.transform = `scaleX(${clamp(ex.t / 2, 0, 1)})`; if (ex.t <= 0 && !ex.done) excuseHeal(ex); }
      S.ballT -= dt; if (S.ballT <= 0) { spawnBall(); S.ballT = ballInterval(); }
      S.cardT -= dt; if (S.cardT <= 0) { spawnCard(); S.cardT = cardInterval(); }
      S.excuseT -= dt; if (S.excuseT <= 0) { spawnExcuse(); S.excuseT = excuseInterval(); }
      S.tauntT -= dt; if (S.tauntT <= 0) { say(pick(TAUNTS)); S.tauntT = rand(6, 9); }
      renderHud();
    };

    // ── flow: start → countdown → fight → win/lose → result ────
    const reset = () => {
      cancelAnimationFrame(raf); killTweens(); spawn.innerHTML = ''; fxLayer.innerHTML = '';
      Object.assign(S, { running: false, paused: false, hp: CFG.maxHp, time: CFG.timeLimit, combo: 0, bestCombo: 0, lastHit: -1e9, damage: 0, phase: 1, regenTicked: false, excuseHealed: false, startedAt: 0, ballT: 1, cardT: 3, excuseT: 5, tauntT: 6, excuses: [] });
      frame.dataset.phase = '1'; frame.classList.remove('is-win', 'is-lose');
      result.classList.remove('is-flawless'); form.hidden = true; rankEl.hidden = true; board.hidden = true; boardList.innerHTML = ''; pausedEl.hidden = true;
      gsap.set([avatarWrap, ko], { clearProps: 'all' }); gsap.set(avatar, { clearProps: 'all' }); egoGhost.style.width = '100%';
      taunt.classList.remove('show'); renderHud(); renderCombo();
    };
    let starting = false;
    const start = async () => {
      if (starting) return; starting = true;
      reset(); setState('countdown'); showScreen(count);
      api.event('boss_start');
      const steps = ['3', '2', '1', 'FIGHT!'];
      for (let i = 0; i < steps.length; i++) {
        countNum.textContent = steps[i]; countNum.classList.toggle('is-fight', i === 3);
        sfx.play(i === 3 ? 'boom' : 'tick');
        if (reduced()) { await ctx.wait(i === 3 ? 350 : 250); continue; }
        await gsap.fromTo(countNum, { scale: 2.4, opacity: 0, rotate: i === 3 ? -6 : 0 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.55, ease: 'power4.out' });
        await ctx.wait(i === 3 ? 380 : 260);
      }
      starting = false;
      showScreen(arena); setState('fight');
      S.running = true; S.startedAt = performance.now(); lastFrame = performance.now();
      say('5 minutes!', 1500);
      if (!reduced()) gsap.fromTo(avatarWrap, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' });
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      S.running = false; cancelAnimationFrame(raf); killTweens(); egoFill.classList.remove('is-regen');
      spawn.querySelectorAll('button').forEach(b => { b.disabled = true; });
      S.excuses = [];
    };
    const scoreOf = () => { const t = Math.round(S.time) * 10, c = S.bestCombo * 25, d = Math.round(S.damage); return { d, t, c, total: d + t + c }; };
    const renderScore = () => { const s = scoreOf(); q('.boss-sc-dmg').textContent = String(s.d); q('.boss-sc-time').textContent = String(s.t); q('.boss-sc-combo').textContent = String(s.c); const tot = q('.boss-sc-total'); if (reduced()) tot.textContent = String(s.total); else motion.countUp(tot, s.total, { duration: 1.2, format: (v) => String(Math.round(v)) }); return s; };

    const win = async () => {
      finish(); setState('win'); frame.classList.add('is-win');
      const flawless = !S.regenTicked && !S.excuseHealed;
      sfx.play('boom');
      // slow-mo K.O.
      if (reduced()) { await ctx.wait(400); }
      else {
        gsap.fromTo(flash, { opacity: 1 }, { opacity: 0, duration: 1.4, ease: 'power2.out' });
        gsap.to(avatarWrap, { scale: 1.25, rotate: 14, y: 30, filter: 'grayscale(1) contrast(1.2)', duration: 1.6, ease: 'power1.out' });
        gsap.fromTo(ko, { opacity: 0, scale: 3, rotate: -8 }, { opacity: 1, scale: 1, rotate: -4, duration: 1.2, ease: 'power4.out' });
        motion.shake(frame, { intensity: 10, duration: 0.6 });
        await ctx.wait(1500);
      }
      showScreen(result);
      const s = renderScore();
      api.event('boss_win', { score: s.total });
      resultKicker.textContent = flawless ? 'FLAWLESS · NO REGEN · NO EXCUSES ACCEPTED' : 'VICTORY';
      resultTitle.textContent = `YOU HAVE DEFEATED ${nick}.`;
      resultSub.textContent = '';
      sfx.play('fanfare');
      fx.confetti({ count: 160, colors: ['#ff3b3b', '#ffffff', '#ffcc4d', '#ff8a3d'], power: 16 });
      await ctx.wait(reduced() ? 100 : 900);
      resultSub.textContent = `Achievement unlocked: You survived ${first}.`;
      if (!reduced()) gsap.fromTo(resultSub, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 });
      form.hidden = false; input.value = storedName; setTimeout(() => { try { input.focus({ preventScroll: true }); } catch { /* ignore */ } }, 50);
      if (flawless) eggs.unlock('boss-flawless');
    };
    const lose = async () => {
      finish(); setState('lose'); frame.classList.add('is-lose');
      sfx.play('error');
      if (!reduced()) { say('5 minutes!', 2000); gsap.to(avatarWrap, { scale: 1.15, duration: 0.8, ease: 'power2.out' }); motion.shake(frame, { intensity: 6, duration: 0.4 }); await ctx.wait(1100); }
      showScreen(result);
      const s = renderScore();
      api.event('boss_lose', { score: s.total });
      resultKicker.textContent = 'DEFEAT';
      resultTitle.textContent = `${nick} WINS.`;
      resultSub.textContent = 'He said 5 minutes and meant it.';
      submit(storedName, false);
    };

    // ── score submit + leaderboard ────────────────────────────
    let submitting = false;
    const submit = async (player, won) => {
      if (submitting) return; submitting = true;
      const s = scoreOf(); const btn = q('.boss-submit'); btn.disabled = true;
      const name = (player || 'Anonymous').trim().slice(0, 30) || 'Anonymous';
      try {
        const res = await api.submitScore({ game: 'boss', score: s.total, won, duration_ms: Math.round(performance.now() - S.startedAt), player: name, meta: { bestCombo: S.bestCombo, damage: Math.round(S.damage), flawless: won && !S.regenTicked && !S.excuseHealed } });
        rankEl.textContent = won ? `RANK #${res?.rank ?? '?'} · ${name.toUpperCase()} · ${s.total} PTS` : `RANK #${res?.rank ?? '?'} · STILL COUNTS. BARELY.`;
      } catch (e) {
        rankEl.textContent = 'SCORE NOT SAVED (backend offline). The defeat still happened.';
      }
      rankEl.hidden = false; form.hidden = true;
      try {
        const rows = await api.scores('boss', 10);
        boardList.innerHTML = rows.length ? rows.map((r, i) => `<li class="${r.player === name && r.score === s.total ? 'is-me' : ''}"><span class="boss-board-rank">${i + 1}</span><span class="boss-board-name">${esc(r.player)}</span><span class="boss-board-won">${r.won ? 'W' : 'L'}</span><span class="boss-board-score tabular">${esc(String(r.score))}</span></li>`).join('') : '<li class="muted">No scores yet. Be the first to humble him.</li>';
        board.hidden = false;
        if (!reduced()) gsap.fromTo(boardList.children, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.05 });
      } catch { /* offline */ }
      submitting = false; btn.disabled = false;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim().slice(0, 30) || 'Anonymous';
      storedName = name; try { localStorage.setItem('sir.player', name); } catch { /* ignore */ }
      submit(name, true);
    });

    // ── flawless egg: golden victory variant ──────────────────
    eggs.onUnlock('boss-flawless', () => {
      result.classList.add('is-flawless'); frame.classList.add('is-flawless');
      resultKicker.textContent = 'FLAWLESS VICTORY · NOT A SINGLE EXCUSE ACCEPTED';
      sfx.play('power');
      fx.confetti({ count: 220, colors: ['#ffcc4d', '#ffe8a3', '#ffffff', '#ff8a3d'], power: 18 });
      const stamp = q('.boss-result-stamp');
      if (!reduced()) { gsap.fromTo(stamp, { scale: 4, opacity: 0, rotate: -20 }, { scale: 1, opacity: 1, rotate: -10, duration: 0.5, ease: 'power4.out', delay: 0.2 }); gsap.fromTo(frame, { boxShadow: '0 0 0 rgba(255,204,77,0)' }, { boxShadow: '0 0 120px rgba(255,204,77,.35)', duration: 1, yoyo: true, repeat: 3 }); }
      setTimeout(() => frame.classList.remove('is-flawless'), 6000);
    });

    // ── inputs ────────────────────────────────────────────────
    const onAvatarHit = (e) => { if (!S.running || S.paused) return; e.preventDefault(); const p = pointInArena(e); hit(1, p.x, p.y); };
    avatar.addEventListener('pointerdown', onAvatarHit);
    avatar.addEventListener('click', (e) => { if (e.detail === 0 && S.running && !S.paused) hit(1); });
    arena.addEventListener('touchmove', (e) => { if (S.running) e.preventDefault(); }, { passive: false });
    arena.addEventListener('contextmenu', (e) => { if (S.running) e.preventDefault(); });
    q('.boss-start').addEventListener('click', start);
    q('.boss-rematch').addEventListener('click', () => { sfx.play('whoosh'); start(); });
    motion.magnetic(q('.boss-start'));

    const inView = () => { const r = frame.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      if (e.code === 'Space' && S.running && inView()) { e.preventDefault(); if (!e.repeat) { if (S.paused) resume(); else hit(1); } return; }
      if ((e.key === 'r' || e.key === 'R') && !result.hidden && inView()) { e.preventDefault(); start(); }
    });

    // ── pause when the tab is hidden ──────────────────────────
    const pause = () => { if (!S.running || S.paused) return; S.paused = true; pausedEl.hidden = false; S.tweens.forEach(t => t.pause()); };
    const resume = () => { if (!S.paused) return; S.paused = false; pausedEl.hidden = true; lastFrame = performance.now(); S.lastHit = performance.now() - 200; S.tweens.forEach(t => t.resume()); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    pausedEl.addEventListener('click', resume);
    pausedEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    // ── idle: VS screen entrance ──────────────────────────────
    const vsNames = el.querySelectorAll('.boss-vs-name'), vsVs = q('.boss-vs-vs');
    if (!reduced()) {
      gsap.set(vsNames[0], { x: -80, opacity: 0 }); gsap.set(vsNames[1], { x: 80, opacity: 0 }); gsap.set(vsVs, { scale: 0, opacity: 0 });
      ctx.onSectionEnter(el, () => {
        gsap.timeline({ defaults: { ease: 'power4.out' } })
          .to(vsNames[0], { x: 0, opacity: 1, duration: 0.7 })
          .to(vsNames[1], { x: 0, opacity: 1, duration: 0.7 }, 0.15)
          .to(vsVs, { scale: 1, opacity: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', onStart: () => { sfx.play('boom'); motion.shake(frame, { intensity: 5, duration: 0.3 }); } }, 0.6);
      });
    }
    renderHud(); renderCombo();
  },
};
