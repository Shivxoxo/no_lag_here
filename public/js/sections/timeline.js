// 14 · TIMELINE — "THE HISTORY OF SIR": an archival documentary reel.
// Sepia film treatment, scroll-scrubbed progress line, chapter cards that
// focus in like old film, a sticky chapter index and one very small star.
export default {
  id: 'timeline',
  title: 'The History of SIR',
  mount(el, ctx) {
    const { esc, gsap, ScrollTrigger, sfx, eggs, fx, motion, toast, profile } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const entries = Array.isArray(ctx.data?.timeline) ? ctx.data.timeline.filter(Boolean) : [];
    const starIndex = entries.length > 1 ? 1 : entries.length ? 0 : -1;
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const timecode = (i) => `${pad(i + 1)}:${pad((i * 17) % 60)}:${pad((i * 7) % 24)}`;

    const chapter = (t, i) => {
      const side = i % 2 === 0 ? 'left' : 'right';
      const year = String(t.year ?? '');
      const numeric = /^\d{4}$/.test(year);
      return `
        <article class="tl-entry tl-${side}" id="tl-ch-${i}" data-i="${i}" aria-labelledby="tl-t-${i}">
          <div class="tl-marker" aria-hidden="true"><span class="tl-node"></span></div>
          <div class="tl-yearcol" aria-hidden="true">
            <span class="tl-year display" data-year="${esc(year)}" data-numeric="${numeric ? 1 : 0}">${esc(year)}</span>
            <span class="tl-yearcap mono">CHAPTER ${pad(i + 1)}</span>
          </div>
          <div class="tl-card">
            <div class="tl-bar tl-bar-top mono" aria-hidden="true"><span>● ARCHIVAL FOOTAGE</span><span>TC ${timecode(i)}</span></div>
            <div class="tl-card-in">
              <span class="tl-stamp mono" aria-hidden="true">${esc(year)}</span>
              <h3 class="tl-title display" id="tl-t-${i}">${esc(t.title || 'Untitled footage')}</h3>
              <p class="tl-body">${esc(t.body || '')}${i === starIndex ? ` <button class="tl-star" type="button" aria-label="a tiny star">★</button>` : ''}</p>
              <span class="tl-reel mono">REEL ${pad((i % 9) + 1)} · CH. ${pad(i + 1)} · ${esc(nick)} ARCHIVE</span>
            </div>
            <div class="tl-bar tl-bar-bot mono" aria-hidden="true"><span>${esc(year)}</span><span>16 fps · MONO</span></div>
          </div>
        </article>`;
    };

    el.innerHTML = `
      <div class="tl-vignette" aria-hidden="true"></div>
      <div class="tl-scratches" aria-hidden="true"></div>
      <div class="container">
        <header class="sec-head tl-head">
          <span class="eyebrow">ARCHIVAL FOOTAGE · REEL 14 · RESTORED IN 4K (LIES)</span>
          <h2 class="display h1 tl-h1">THE HISTORY <span class="tl-h1-of">OF</span> ${esc(nick)}</h2>
          <p class="lead">A documentary in ${entries.length} chapter${entries.length === 1 ? '' : 's'}. Every fact has been verified by absolutely nobody.</p>
          <div class="tl-headmeta mono" aria-hidden="true"><span class="tl-rec"><i class="dot"></i> REC</span><span>TC <b class="tl-tc-live">00:00:00:00</b></span><span>${esc(nick)} · ${esc(String(profile.age ?? ''))} YEARS OF FOOTAGE</span></div>
        </header>

        <div class="tl-layout">
          <nav class="tl-nav" aria-label="Chapters">
            <span class="tl-nav-label mono">CHAPTERS</span>
            <ul class="tl-nav-list">
              ${entries.map((t, i) => `<li><button class="tl-nav-btn mono" type="button" data-target="${i}"><span class="tl-nav-n">${pad(i + 1)}</span><span class="tl-nav-year">${esc(String(t.year ?? ''))}</span></button></li>`).join('')}
              ${entries.length ? '' : '<li class="tl-nav-empty mono muted">NO REELS</li>'}
            </ul>
          </nav>

          <div class="tl-track">
            <div class="tl-line" aria-hidden="true"><div class="tl-fill"></div><span class="tl-head-dot"></span></div>
            ${entries.length ? entries.map(chapter).join('') : `
              <article class="tl-entry tl-left tl-empty">
                <div class="tl-marker" aria-hidden="true"><span class="tl-node"></span></div>
                <div class="tl-yearcol" aria-hidden="true"><span class="tl-year display">????</span></div>
                <div class="tl-card"><div class="tl-bar tl-bar-top mono"><span>● ARCHIVAL FOOTAGE</span><span>TC 00:00:00</span></div>
                  <div class="tl-card-in"><h3 class="tl-title display">NO FOOTAGE FOUND</h3><p class="tl-body">The archive is empty. Much like his study timetable. Add chapters from the admin panel.</p></div>
                  <div class="tl-bar tl-bar-bot mono"><span>—</span><span>16 fps · MONO</span></div></div>
              </article>`}
            <div class="tl-end" data-reveal>
              <div class="tl-endcard">
                <div class="tl-bar tl-bar-top mono" aria-hidden="true"><span>● ARCHIVAL FOOTAGE</span><span>TC ${timecode(entries.length)}</span></div>
                <div class="tl-endcard-in">
                  <span class="display tl-end-title">TO BE CONTINUED…</span>
                  <span class="mono tl-end-sub">Next episode: ${esc(nick)} arrives on time. (Unconfirmed. Probably fiction.)</span>
                </div>
                <div class="tl-bar tl-bar-bot mono" aria-hidden="true"><span>END OF REEL</span><span>NO LAG HERE PICTURES</span></div>
              </div>
            </div>
          </div>
        </div>
        <p class="tl-disclaimer mono muted">Dates are approximate. Events are exaggerated. Feelings are real.</p>
      </div>`;

    const track = el.querySelector('.tl-track');
    const fill = el.querySelector('.tl-fill');
    const headDot = el.querySelector('.tl-head-dot');
    const cards = [...el.querySelectorAll('.tl-entry')];
    const navBtns = [...el.querySelectorAll('.tl-nav-btn')];
    const tcLive = el.querySelector('.tl-tc-live');

    // ── Scroll-scrubbed progress line ────────────────────────
    if (motion.reduced) {
      gsap.set(fill, { scaleY: 1 }); gsap.set(headDot, { top: '100%' });
    } else {
      gsap.set(fill, { scaleY: 0, transformOrigin: 'top center' });
      gsap.to(fill, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: track, start: 'top 60%', end: 'bottom 60%', scrub: 0.4, onUpdate: (st) => { headDot.style.top = `${st.progress * 100}%`; } } });
      // live timecode in the header, ticks with scroll progress through the section
      const total = Math.max(1, entries.length) * 60;
      ScrollTrigger.create({ trigger: el, start: 'top 80%', end: 'bottom 20%', onUpdate: (st) => { const s = Math.floor(st.progress * total); tcLive.textContent = `00:${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(Math.floor(st.progress * 24 * total) % 24)}`; } });
    }

    // ── Chapter cards: film-focus reveal + year counters ──────
    const setActive = (i) => { navBtns.forEach(b => b.classList.toggle('is-active', Number(b.dataset.target) === i)); };
    cards.forEach((card, i) => {
      const body = card.querySelector('.tl-card');
      const yearEl = card.querySelector('.tl-year');
      const node = card.querySelector('.tl-node');
      if (motion.reduced) { card.classList.add('is-focused'); return; }
      gsap.set(body, { opacity: 0, scale: 1.08, filter: 'blur(14px) sepia(1)' });
      gsap.set(yearEl, { opacity: 0, y: 30, rotateX: -70 });
      ScrollTrigger.create({
        trigger: card, start: 'top 78%', once: true,
        onEnter: () => {
          sfx.play('tick');
          card.classList.add('is-focused');
          gsap.to(body, { opacity: 1, scale: 1, filter: 'blur(0px) sepia(0)', duration: 1.1, ease: 'power3.out' });
          gsap.fromTo(node, { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
          gsap.to(yearEl, { opacity: 1, y: 0, rotateX: 0, duration: 0.9, ease: 'power3.out' });
          const target = Number(yearEl.dataset.year);
          if (yearEl.dataset.numeric === '1') motion.countUp(yearEl, target, { from: target - 37, duration: 1.2, format: (v) => String(Math.round(v)) });
        },
      });
      ScrollTrigger.create({ trigger: card, start: 'top 55%', end: 'bottom 45%', onToggle: (st) => { if (st.isActive) setActive(i); } });
      if (!card.classList.contains('tl-empty')) motion.tilt(body, { max: 3, scale: 1.005, glare: false });
    });
    if (motion.reduced) cards.forEach((c, i) => { motion.onVisible(c, (v) => { if (v) setActive(i); }); });

    // ── Chapter navigation ────────────────────────────────────
    navBtns.forEach(b => b.addEventListener('click', () => {
      const target = cards[Number(b.dataset.target)]; if (!target) return;
      sfx.play('whoosh');
      // native smooth scroll (html has scroll-behavior: smooth); .tl-entry carries scroll-margin-top for the HUD
      target.scrollIntoView({ block: 'start', behavior: motion.reduced ? 'auto' : 'smooth' });
    }));

    // ── Easter egg: the tiny star ─────────────────────────────
    const star = el.querySelector('.tl-star');
    star?.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = star.getBoundingClientRect();
      fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 18, color: '#ffcc4d', power: 7 });
      eggs.unlock('hidden-star');
    });
    eggs.onUnlock('hidden-star', () => {
      // Unique animation: a star shower, the whole reel turns gold for a moment
      fx.emoji({ emoji: ['⭐', '✨'], count: 40, rise: false, size: 26 });
      el.classList.add('is-gold');
      if (star) { star.classList.add('is-found'); gsap.fromTo(star, { scale: 1, rotate: 0 }, { scale: 3.2, rotate: 360, duration: 0.9, ease: 'back.out(2)', yoyo: true, repeat: 1 }); }
      if (!motion.reduced) gsap.fromTo(el.querySelectorAll('.tl-node'), { scale: 1 }, { scale: 1.8, duration: 0.35, stagger: 0.06, yoyo: true, repeat: 1, ease: 'power2.inOut' });
      sfx.play('success');
      setTimeout(() => toast.show({ icon: '★', title: 'You found the only star on his report card.', duration: 4600 }), 900);
      setTimeout(() => el.classList.remove('is-gold'), 4500);
    });
  },
};
