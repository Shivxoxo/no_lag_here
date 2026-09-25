// 20 · ENDING — cinematic case-file closing + live case summary.
export default {
  id: 'ending',
  title: 'Case File Closing',
  mount(el, ctx) {
    const { profile, esc, gsap, ScrollTrigger, sfx, eggs, fx, motion, state, data } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = (profile.first_name || profile.name?.split(' ')[0] || 'SIR').toUpperCase();
    const age = Number(profile.age) || 16;
    const madeBy = profile.made_by || 'Shiv';
    const year = new Date().getFullYear();
    const eggDefs = data.easter_eggs || [];

    const STATS = [
      ['visitors', 'VISITORS', 'people who saw this'],
      ['roasts_generated', 'ROASTS', 'generated with love'],
      ['candles_blown', 'CANDLES BLOWN', 'across all visitors'],
      ['boss_defeats', 'BOSS DEFEATS', 'his ego, destroyed'],
    ];

    el.innerHTML = `
      <div class="end-film">
        <div class="end-beat end-beat-open"><div class="end-inner">
          <p class="mono end-tiny">CASE FILE CLOSING<span class="end-dots">...</span></p>
          <div class="end-progress" aria-hidden="true"><i></i></div>
          <p class="mono end-tiny end-tiny-sub">ARCHIVING ${esc(String(age))} YEARS OF EVIDENCE</p>
        </div></div>
        <div class="end-beat end-beat-sir"><div class="end-inner">
          <h2 class="display end-sir" aria-label="Case file closing: ${esc(nick)}">${esc(nick)}</h2>
          <p class="mono end-tiny">SUBJECT · ${esc(profile.name || nick)}</p>
        </div></div>
        <div class="end-beat"><div class="end-inner"><p class="display end-line">${esc(String(age))} YEARS<br>OF EXISTENCE.</p></div></div>
        <div class="end-beat"><div class="end-inner"><p class="display end-line">0 YEARS<br>OF LEARNING<br>FROM HIS MISTAKES.</p></div></div>
        <div class="end-beat end-beat-hb"><div class="end-inner"><p class="display end-line end-gold">HAPPY BIRTHDAY,<br>${esc(first)}.</p></div></div>
        <div class="end-beat end-beat-credits"><div class="end-inner">
          <p class="end-made display">Made by ${esc(madeBy)}</p>
          <p class="end-sub">With friendship, chaos, and absolutely zero mercy.</p>
          <p class="end-warm">Seriously though — happy birthday, ${esc(profile.first_name || nick)}. We roast you because you're worth the effort. Now go receive a pass.</p>
        </div></div>
      </div>

      <div class="end-summary">
        <div class="container-narrow">
          <div class="glass glass-strong panel end-panel" data-reveal>
            <span class="eyebrow">CASE SUMMARY · LIVE</span>
            <h3 class="display h2 end-panel-title">THE DAMAGE REPORT</h3>
            <dl class="end-stats">
              ${STATS.map(([k, label, sub]) => `<div class="end-stat"><dt class="mono">${label}</dt><dd><b class="end-num tabular" data-key="${k}">0</b><span class="mono muted">${sub}</span></dd></div>`).join('')}
              <div class="end-stat end-stat-eggs"><dt class="mono">EGGS FOUND</dt><dd><b class="end-num tabular end-eggs-num">0/0</b><span class="mono muted">by you, this visit</span></dd></div>
            </dl>
            <div class="end-eggs">
              <h4 class="mono end-eggs-title">EASTER EGG CHECKLIST <span class="end-eggs-count muted"></span></h4>
              <ul class="end-egg-list">
                ${eggDefs.map(e => `<li class="end-egg" data-key="${esc(e.key)}"><span class="end-egg-tick" aria-hidden="true"></span><span class="end-egg-body"><b>${esc(e.name)}</b><span class="muted">${esc(e.hint)}</span></span><span class="sr-only end-egg-state">not found</span></li>`).join('')}
              </ul>
            </div>
            <div class="end-actions">
              <button class="btn btn-gold end-top" type="button">▲ BACK TO THE TOP</button>
              <button class="btn btn-ghost end-roast" type="button">ROAST HIM AGAIN</button>
              <button class="btn btn-ghost end-wall" type="button">SIGN THE WALL</button>
            </div>
          </div>
          <footer class="end-footer mono">
            <button class="end-credit" type="button" aria-label="Credits. Made by ${esc(madeBy)}, ${year}. The SIR Archives.">Made by ${esc(madeBy)} · ${year} · THE ${esc(nick)} ARCHIVES</button>
            <span class="end-footer-sub">Statistics are 100% fabricated by his friends. The stats above, however, are real.</span>
          </footer>
        </div>
      </div>`;

    // ── cinematic beats (scrubbed) ────────────────────────────
    const beats = [...el.querySelectorAll('.end-beat')];
    const bar = el.querySelector('.end-progress i');
    if (!motion.reduced) {
      beats.forEach((beat, i) => {
        const inner = beat.querySelector('.end-inner');
        gsap.fromTo(inner, { opacity: 0, scale: 0.86, filter: 'blur(16px)', y: 40 }, { opacity: 1, scale: 1, filter: 'blur(0px)', y: 0, ease: 'none', scrollTrigger: { trigger: beat, start: 'top 70%', end: 'center center', scrub: true } });
        if (i < beats.length - 1) gsap.fromTo(inner, { opacity: 1, y: 0 }, { opacity: 0, y: -60, filter: 'blur(10px)', ease: 'none', immediateRender: false, scrollTrigger: { trigger: beat, start: 'center 35%', end: 'bottom 5%', scrub: true } });
      });
      gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: beats[0], start: 'top 70%', end: 'bottom 60%', scrub: true } });
      const sir = el.querySelector('.end-sir');
      const chars = motion.splitChars(sir);
      gsap.fromTo(chars, { letterSpacing: '.6em', opacity: 0.4 }, { letterSpacing: '.08em', opacity: 1, ease: 'none', stagger: 0.02, scrollTrigger: { trigger: beats[1], start: 'top 70%', end: 'center center', scrub: true } });
      const hb = el.querySelector('.end-beat-hb');
      ScrollTrigger.create({ trigger: hb, start: 'top 55%', once: true, onEnter: () => {
        const r = hb.getBoundingClientRect();
        fx.confetti({ count: 180, x: innerWidth / 2, y: Math.max(80, r.top + r.height * 0.35), colors: ['#ffcc4d', '#ffffff', '#ff8a3d', '#fff3e0'], power: 12 });
        sfx.play('confetti');
      } });
    } else {
      gsap.set(bar, { scaleX: 1 });
    }

    // ── live stats ────────────────────────────────────────────
    const nums = {}; el.querySelectorAll('.end-num[data-key]').forEach(n => { nums[n.dataset.key] = n; });
    const eggsNum = el.querySelector('.end-eggs-num'), eggsCount = el.querySelector('.end-eggs-count');
    const shown = {};
    let statsLive = false;
    function renderStats(stats = state.stats || {}) {
      for (const k in nums) {
        const to = Number(stats[k]) || 0;
        if (!statsLive) { nums[k].textContent = to.toLocaleString(); shown[k] = to; continue; }
        if (shown[k] === to) continue;
        motion.countUp(nums[k], to, { from: shown[k] || 0, duration: 1.4 }); shown[k] = to;
      }
      eggsNum.textContent = `${state.eggsFound.size}/${state.eggsTotal}`;
      eggsCount.textContent = `${state.eggsFound.size} / ${state.eggsTotal}`;
    }
    function renderEggs(justFound) {
      el.querySelectorAll('.end-egg').forEach(li => {
        const found = state.eggsFound.has(li.dataset.key);
        li.classList.toggle('is-found', found);
        li.querySelector('.end-egg-state').textContent = found ? 'found' : 'not found';
        if (found && li.dataset.key === justFound) { li.classList.add('is-fresh'); gsap.fromTo(li, { scale: 1.04, backgroundColor: 'rgba(255,204,77,.25)' }, { scale: 1, backgroundColor: 'rgba(255,204,77,.06)', duration: 1.2, ease: 'power3.out', clearProps: 'backgroundColor' }); setTimeout(() => li.classList.remove('is-fresh'), 2000); }
      });
    }
    renderStats(); renderEggs();
    ctx.onSectionEnter(el, () => {
      statsLive = true;
      for (const k in nums) { const to = shown[k] || 0; if (to) { shown[k] = 0; motion.countUp(nums[k], to, { duration: 1.8 }); shown[k] = to; } }
      ctx.api.stats().then(s => { state.stats = s; renderStats(s); }).catch(() => {});
    });
    state.on('stats', (s) => renderStats(s));
    state.on('egg', (e) => { renderStats(); renderEggs(e?.key); });

    // ── buttons ───────────────────────────────────────────────
    el.querySelector('.end-top').addEventListener('click', () => { sfx.play('whoosh'); ctx.scrollTo('#hero'); });
    el.querySelector('.end-roast').addEventListener('click', () => ctx.scrollTo('#roast'));
    el.querySelector('.end-wall').addEventListener('click', () => ctx.scrollTo('#messages'));

    // ── dev-message egg: credit ×3 + matrix rain ─────────────
    const credit = el.querySelector('.end-credit');
    let cc = 0, ct = 0;
    credit.addEventListener('click', () => {
      cc++; clearTimeout(ct); ct = setTimeout(() => { cc = 0; }, 2000);
      gsap.fromTo(credit, { scale: 1.06 }, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)' });
      if (cc === 3) { cc = 0; eggs.unlock('dev-message'); }
    });
    eggs.onUnlock('dev-message', () => {
      if (document.querySelector('.end-matrix')) return;
      const overlay = document.createElement('div'); overlay.className = 'end-matrix'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Developer message');
      overlay.innerHTML = `<canvas class="end-matrix-canvas" aria-hidden="true"></canvas>
        <div class="end-matrix-note glass glass-strong">
          <span class="mono end-matrix-kicker">// DEVELOPER CHANNEL · UNENCRYPTED</span>
          <p>If you're reading this, you're either a developer or ${esc(nick)} trying to find a way to delete this website. Both are welcome.</p>
          <p class="end-matrix-sign mono">— ${esc(madeBy)}</p>
          <button class="btn btn-sm end-matrix-close" type="button">CLOSE CHANNEL</button>
        </div>`;
      document.body.appendChild(overlay);
      const note = overlay.querySelector('.end-matrix-note'), canvas = overlay.querySelector('canvas');
      const close = () => { gsap.to(overlay, { opacity: 0, duration: 0.4, onComplete: () => { stop = true; overlay.remove(); } }); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      overlay.querySelector('.end-matrix-close').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      let stop = false;
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      const showNote = () => { gsap.fromTo(note, { opacity: 0, scale: 0.92, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.7, ease: 'power4.out' }); note.classList.add('is-in'); note.querySelector('.end-matrix-close').focus({ preventScroll: true }); };
      if (motion.reduced) { canvas.style.opacity = 0.25; showNote(); return; }
      // matrix rain
      const g = canvas.getContext('2d');
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; g.scale(dpr, dpr);
      const fs = innerWidth < 640 ? 14 : 18, cols = Math.ceil(innerWidth / fs);
      const drops = Array.from({ length: cols }, () => Math.random() * -40);
      const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789SIRSIRSIRPASS<>/{}=;'.split('');
      const start = performance.now();
      let last = 0;
      sfx.play('glitch');
      function frame(now) {
        if (stop) return;
        const t = now - start;
        if (now - last > 40) {
          last = now;
          g.fillStyle = 'rgba(0,0,0,.09)'; g.fillRect(0, 0, innerWidth, innerHeight);
          g.font = `${fs}px "JetBrains Mono", monospace`;
          for (let i = 0; i < cols; i++) {
            const ch = glyphs[(Math.random() * glyphs.length) | 0];
            const y = drops[i] * fs;
            g.fillStyle = Math.random() < 0.08 ? '#ffffff' : '#c6ff3d';
            g.fillText(ch, i * fs, y);
            if (y > innerHeight && Math.random() > 0.975) drops[i] = 0;
            drops[i] += 1;
          }
        }
        if (t > 2500 && !note.classList.contains('is-in')) { showNote(); gsap.to(canvas, { opacity: 0.18, duration: 1.2 }); }
        if (t > 9000) { stop = true; return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  },
};
