// 06 · AWARDS — THE SIR AWARDS: a black-tie gala where every envelope
// contains the same winner and every acceptance speech is missing.
const GOLD = ['#ffcc4d', '#ffe08a', '#b8860b', '#fff6d5', '#ffffff'];
const SPEECHES = [
  'not delivered — recipient was late.',
  'not delivered — recipient said "5 minutes". That was 3 hours ago.',
  'not delivered — recipient is still on his way (allegedly).',
  'not delivered — recipient was watching one more episode.',
  'not delivered — recipient arrived after the venue closed.',
  'not delivered — recipient overslept the ceremony.',
  'not delivered — recipient was at the gym. At 11:47 PM.',
  'not delivered — recipient got distracted by biryani.',
  'not delivered — recipient was late. Again.',
];

const trophySvg = (cls = '') => `
  <svg class="aw-trophy-svg ${cls}" viewBox="0 0 120 140" aria-hidden="true" focusable="false">
    <g fill="url(#aw-cup)" stroke="rgba(60,35,0,.45)" stroke-width="1">
      <path d="M28 14 h64 v34 a32 32 0 0 1 -64 0 z"/>
      <path d="M28 22 c-16 0 -24 8 -24 18 c0 13 11 22 26 24" fill="none" stroke="url(#aw-cup)" stroke-width="7" stroke-linecap="round"/>
      <path d="M92 22 c16 0 24 8 24 18 c0 13 -11 22 -26 24" fill="none" stroke="url(#aw-cup)" stroke-width="7" stroke-linecap="round"/>
      <rect x="51" y="78" width="18" height="16"/>
      <path d="M36 94 h48 l6 14 h-60 z"/>
      <rect x="26" y="108" width="68" height="14" rx="2"/>
    </g>
    <rect class="aw-shine" clip-path="url(#aw-cupclip)" x="-50" y="0" width="34" height="140" fill="url(#aw-shine)" transform="skewX(-18)"/>
    <rect x="32" y="112" width="56" height="6" rx="1" fill="rgba(0,0,0,.35)"/>
  </svg>`;

export default {
  id: 'awards',
  title: 'The SIR Awards',
  mount(el, ctx) {
    const { profile, esc, gsap, sfx, fx, motion, wait } = ctx;
    const awards = Array.isArray(ctx.data?.awards) ? ctx.data.awards.filter(Boolean) : [];
    const total = awards.length;
    const winner = profile.name || 'SIR';
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const madeBy = profile.made_by || 'his friends';

    el.innerHTML = `
      <svg class="aw-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="aw-cup" x1="0" x2="1" y1="0" y2="0.3">
            <stop offset="0" stop-color="#8a5a00"/><stop offset=".3" stop-color="#ffe08a"/><stop offset=".55" stop-color="#ffcc4d"/><stop offset=".8" stop-color="#b8860b"/><stop offset="1" stop-color="#6b4300"/>
          </linearGradient>
          <linearGradient id="aw-shine" x1="0" x2="1">
            <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
          <clipPath id="aw-cupclip">
            <path d="M28 14 h64 v34 a32 32 0 0 1 -64 0 z"/><rect x="51" y="78" width="18" height="16"/><path d="M36 94 h48 l6 14 h-60 z"/><rect x="26" y="108" width="68" height="14" rx="2"/>
          </clipPath>
        </defs>
      </svg>
      <div class="aw-bg" aria-hidden="true">
        <div class="aw-curtain"></div>
        <div class="aw-valance"></div>
        <div class="aw-floor"></div>
        <div class="aw-spot aw-spot-l"><div class="aw-beam"></div></div>
        <div class="aw-spot aw-spot-r"><div class="aw-beam"></div></div>
        <div class="aw-dust"></div>
      </div>
      <div class="container">
        <header class="sec-head center aw-head">
          <span class="eyebrow aw-eyebrow" data-reveal>THE ACADEMY OF ${esc(madeBy.toUpperCase())} PRESENTS</span>
          <h2 class="display h1 aw-title-main" data-reveal><span class="aw-foil">THE ${esc(nick)} AWARDS</span></h2>
          <p class="lead aw-lead" data-reveal>Black tie. Red carpet. One nominee in every category. ${total ? `${total} envelopes` : 'No envelopes'}, zero surprises, zero acceptance speeches.</p>
        </header>

        <div class="aw-stage" tabindex="0" role="region" aria-label="Award stage. Use the left and right arrow keys to move between awards.">
          <div class="aw-bulbs aw-bulbs-a" aria-hidden="true"></div>
          <div class="aw-bulbs aw-bulbs-b" aria-hidden="true"></div>
          <div class="aw-podium">
            <p class="aw-announce mono" aria-live="polite"><span class="aw-announce-text">${total ? '' : 'THE COMMITTEE IS STILL DELIBERATING.'}</span><span class="aw-caret" aria-hidden="true"></span></p>
            <div class="aw-envwrap">
              <article class="aw-card" aria-live="polite" aria-atomic="true">
                <div class="aw-trophy">${trophySvg('aw-trophy-stage')}<span class="aw-icon" aria-hidden="true">🏆</span></div>
                <span class="aw-cat mono">CATEGORY</span>
                <h3 class="aw-award-title display"><span class="aw-foil">—</span></h3>
                <div class="aw-plate"><span class="aw-plate-k mono">WINNER</span><span class="aw-plate-name display">${esc(winner)}</span></div>
                <p class="aw-body"></p>
                <p class="aw-speech mono"><span class="aw-speech-k">ACCEPTANCE SPEECH:</span> <span class="aw-speech-text"></span></p>
              </article>
              <div class="aw-env" aria-hidden="true">
                <div class="aw-env-back"></div>
                <div class="aw-env-front"></div>
                <div class="aw-env-flap"></div>
                <div class="aw-env-seal display">${esc(nick)}</div>
                <span class="aw-env-label mono">STRICTLY CONFIDENTIAL · FOR ${esc(nick)} ONLY</span>
              </div>
            </div>
            <div class="aw-progress mono" aria-label="Award progress"><span class="aw-progress-n">0</span> / ${total}</div>
          </div>
          <div class="aw-controls">
            <button class="btn btn-ghost aw-prev" type="button" ${total ? '' : 'disabled'}>◂ PREV</button>
            <button class="btn btn-gold aw-next" type="button" ${total ? '' : 'disabled'}>NEXT AWARD ▸</button>
            <button class="btn btn-ghost btn-sm aw-replay" type="button" ${total ? '' : 'disabled'}>↻ REPLAY CEREMONY</button>
          </div>
        </div>

        <div class="aw-shelf-head" data-reveal>
          <span class="eyebrow">TROPHY SHELF · ${total} ${total === 1 ? 'AWARD' : 'AWARDS'} · 1 WINNER</span>
          <span class="mono muted aw-shelf-hint">click a trophy to replay its reveal</span>
        </div>
        ${total ? `<ul class="aw-shelf">${awards.map((a, i) => `
          <li data-reveal>
            <button class="aw-shelf-card card-3d" type="button" data-i="${i}" aria-label="Replay award ${i + 1}: ${esc(a.title)}">
              <span class="aw-shelf-num mono">#${String(i + 1).padStart(2, '0')}</span>
              <span class="aw-shelf-trophy">${trophySvg()}<span class="aw-icon aw-icon-sm" aria-hidden="true">${esc(a.icon || '🏆')}</span></span>
              <span class="aw-shelf-title display">${esc(a.title)}</span>
              <span class="aw-shelf-body">${esc(a.body || '')}</span>
              <span class="aw-shelf-plate mono">${esc(winner)}</span>
              <span class="aw-shelf-plank" aria-hidden="true"></span>
            </button>
          </li>`).join('')}</ul>`
        : `<div class="aw-empty glass panel mono" data-reveal>0 AWARDS ON FILE. Either the archive was wiped, or ${esc(nick)} deleted the evidence. The committee suspects the latter.</div>`}
        <p class="aw-disclaimer mono muted" data-reveal>All categories are real. All statistics are fabricated by ${esc(madeBy)}. The trophies are, tragically, also fictional.</p>
      </div>`;

    // ── refs ─────────────────────────────────────────────────
    const q = (s) => el.querySelector(s);
    const stage = q('.aw-stage'), card = q('.aw-card'), env = q('.aw-env'), flap = q('.aw-env-flap'), seal = q('.aw-env-seal');
    const announce = q('.aw-announce-text'), caret = q('.aw-caret');
    const iconEl = q('.aw-trophy .aw-icon'), catEl = q('.aw-cat'), titleEl = q('.aw-award-title .aw-foil'), bodyEl = q('.aw-body'), speechEl = q('.aw-speech-text');
    const plateName = q('.aw-plate-name'), trophy = q('.aw-trophy'), shine = q('.aw-trophy-stage .aw-shine'), progressN = q('.aw-progress-n');
    const prevBtn = q('.aw-prev'), nextBtn = q('.aw-next'), replayBtn = q('.aw-replay');
    const spots = el.querySelectorAll('.aw-spot');
    const shelfCards = el.querySelectorAll('.aw-shelf-card');

    let current = -1, runId = 0;
    const closedState = () => {
      gsap.set(env, { opacity: 1, yPercent: 0, scale: 1, visibility: 'visible' });
      gsap.set(flap, { rotateX: 0, zIndex: 4 });
      gsap.set(seal, { opacity: 1, scale: 1 });
      gsap.set(card, { opacity: 0, scale: 0.92, y: 24 });
      gsap.set(trophy, { rotate: 0 });
    };
    closedState();
    if (!total) { gsap.set(env, { opacity: 0.55 }); }

    const setContent = (a, i) => {
      iconEl.textContent = a.icon || '🏆';
      catEl.textContent = `CATEGORY ${String(i + 1).padStart(2, '0')} OF ${String(total).padStart(2, '0')}`;
      titleEl.textContent = a.title || 'UNTITLED ACHIEVEMENT';
      bodyEl.textContent = a.body || '';
      speechEl.textContent = '';
      progressN.textContent = String(i + 1);
      shelfCards.forEach((c, k) => c.classList.toggle('is-current', k === i));
    };

    const drumroll = async (id) => {
      if (motion.reduced) return;
      const ticks = 16;
      for (let t = 0; t < ticks; t++) {
        if (id !== runId) return;
        sfx.play('tick');
        gsap.fromTo(env, { x: (t % 2 ? 1 : -1) * (1 + t * 0.35) }, { x: 0, duration: 0.09, ease: 'power2.out' });
        await wait(170 - t * 7);
      }
    };

    const swingSpotlights = () => {
      if (motion.reduced) return;
      spots.forEach((s, k) => {
        gsap.fromTo(s, { rotate: k ? 26 : -26 }, { rotate: 0, duration: 1.1, ease: 'elastic.out(1, 0.5)' });
      });
    };

    const playShine = () => {
      if (!shine || motion.reduced) return;
      gsap.fromTo(shine, { x: 0 }, { x: 190, duration: 0.9, ease: 'power2.inOut', delay: 0.15, repeat: 1, repeatDelay: 1.2 });
    };

    /** Reveal award i with the full envelope ceremony. */
    async function reveal(i, { quick = false } = {}) {
      if (!total) return;
      i = ((i % total) + total) % total;
      const id = ++runId;
      current = i;
      gsap.killTweensOf([env, flap, seal, card, trophy, ...spots]);
      closedState();
      const a = awards[i];
      announce.textContent = '';
      caret.classList.add('on');
      stage.classList.add('is-busy');
      prevBtn.setAttribute('aria-disabled', 'true'); nextBtn.setAttribute('aria-disabled', 'true');
      progressN.textContent = String(i + 1);

      if (motion.reduced || quick) {
        announce.textContent = 'AND THE AWARD GOES TO…';
      } else {
        await motion.typewriter(announce, 'AND THE AWARD GOES TO…', { speed: 34, jitter: 20, onChar: () => sfx.play('type') });
      }
      if (id !== runId) return;
      if (!quick) await drumroll(id);
      if (id !== runId) return;
      caret.classList.remove('on');
      setContent(a, i);

      // ── the opening ──
      sfx.play('fanfare');
      swingSpotlights();
      const r = trophy.getBoundingClientRect();
      const cx = r.left + r.width / 2 || innerWidth / 2, cy = (r.top + r.height / 2) || innerHeight / 2;
      fx.confetti({ x: cx, y: cy, count: motion.reduced ? 20 : 140, colors: GOLD, power: 15 });
      fx.burst({ x: cx, y: cy, count: 24, color: '#ffe08a', power: 9 });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.to(seal, { scale: 1.4, opacity: 0, duration: 0.35, ease: 'back.in(2)' })
        .to(flap, { rotateX: -170, duration: 0.7, ease: 'power2.inOut', onComplete: () => gsap.set(flap, { zIndex: 0 }) }, 0.1)
        .to(card, { opacity: 1, scale: 1, y: 0, duration: 0.9, ease: 'back.out(1.6)', onStart: () => sfx.play('whoosh') }, 0.55)
        .to(env, { yPercent: 40, opacity: 0, scale: 0.94, duration: 0.7, ease: 'power2.in', onComplete: () => gsap.set(env, { visibility: 'hidden' }) }, 0.6)
        .fromTo(trophy, { rotate: -14, scale: 0.6 }, { rotate: 0, scale: 1, duration: 1, ease: 'elastic.out(1, 0.45)', onStart: () => { sfx.play('pop'); playShine(); } }, 0.8)
        .fromTo(plateName, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(3)', onStart: () => { sfx.play('boom'); motion.shake(card, { intensity: 4, duration: 0.35 }); } }, 1.15)
        .add(async () => {
          if (id !== runId) return;
          const speech = SPEECHES[i % SPEECHES.length];
          if (motion.reduced) speechEl.textContent = speech;
          else await motion.typewriter(speechEl, speech, { speed: 18, jitter: 12 });
        }, 1.5);
      if (motion.reduced) tl.progress(1);
      await tl;
      if (id !== runId) return;
      stage.classList.remove('is-busy');
      prevBtn.removeAttribute('aria-disabled'); nextBtn.removeAttribute('aria-disabled');
    }

    const step = (d) => { if (!total) return; reveal((current < 0 ? 0 : current) + d); };
    nextBtn.addEventListener('click', () => step(1));
    prevBtn.addEventListener('click', () => step(-1));
    replayBtn.addEventListener('click', () => {
      if (!total) return;
      sfx.play('whoosh');
      motion.scrollTo(stage, { offset: -80 });
      reveal(0);
    });
    shelfCards.forEach(c => {
      motion.tilt(c, { max: 8 });
      c.addEventListener('click', () => {
        const i = Number(c.dataset.i);
        const rr = c.getBoundingClientRect();
        fx.burst({ x: rr.left + rr.width / 2, y: rr.top + 40, count: 14, color: '#ffcc4d', power: 6 });
        motion.scrollTo(stage, { offset: -80 });
        reveal(i);
      });
    });
    stage.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); reveal(0); }
      else if (e.key === 'End') { e.preventDefault(); reveal(total - 1); }
    });

    // Tapping the sealed envelope also opens it (touch users love envelopes).
    env.addEventListener('click', () => { if (total && current < 0) reveal(0); });

    motion.tilt(card, { max: 5, glare: false });
    if (!motion.reduced) {
      motion.parallax(el.querySelector('.aw-curtain'), { speed: 0.08 });
    }

    // Auto-reveal the first award when the section scrolls into view.
    ctx.onSectionEnter(el, () => { if (total && current < 0) reveal(0); });
  },
};
