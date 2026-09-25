// 11 · FOOD — "SIR FOOD DIVISION": a food-delivery app about the only thing he
// never misses. Evidence cards, a food radar, his usual order, biryani rain.
const FOODS = [
  { name: 'Biryani', emoji: '🍛' },
  { name: 'Momos', emoji: '🥟' },
  { name: 'Chowmein', emoji: '🍜' },
  { name: 'Samosa', emoji: '🥟' },
  { name: 'Chicken roll', emoji: '🌯' },
  { name: 'Cake', emoji: '🎂' },
];
const DETECT = [
  (f, d) => `${f} detected: ${d} m away · Subject en route · ETA: instant (for once)`,
  (f) => `${f} detected · Subject already there. Nobody saw him move.`,
  (f, d) => `${f} located ${d} m away · Subject covered it faster than any sprint this season.`,
  (f) => `${f} detected · Second plate pre-ordered · Excuses: none found.`,
  (f) => `${f} spotted · Subject said "5 minutes". Arrived in 4 seconds.`,
  (f) => `${f} confirmed · Positioning: perfect. Finally.`,
  (f, d) => `${f} at ${d} m · Pass completion still 4% · Plate completion 100%.`,
];
const MENU = [
  { n: 'Biryani (family size, for one)', d: 'Extra raita. Extra everything. No sharing.', p: '₹ all of it' },
  { n: 'Momos ×12', d: 'Listed as "shared". Never shared.', p: '₹ don\'t ask' },
  { n: 'Chowmein (extra, extra)', d: 'Ordered before checking the price. Or the menu.', p: '₹ ???' },
  { n: 'Samosa ×6 ("a snack")', d: 'A warm-up. The real order comes after.', p: '₹ pocket money' },
  { n: 'Chicken roll', d: 'The pre-biryani starter. Standard procedure.', p: '₹ 5 minutes' },
  { n: 'Birthday cake', d: 'Today only. Candles not included in reps.', p: '₹ priceless' },
];

export default {
  id: 'food',
  title: 'SIR Food Division',
  mount(el, ctx) {
    const { profile, photos, esc, gsap, sfx, motion, api, eggs, fx, viewer, pick, randInt, wait } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const first = profile.first_name || profile.name.split(' ')[0];
    const fav = profile.favourite_food || 'Biryani';

    // evidence: photos tagged food (fall back to the first ones)
    let evidence = photos.map((p, i) => ({ p, i })).filter(x => (x.p.tags || []).includes('food')).slice(0, 3);
    if (!evidence.length) evidence = photos.slice(0, 3).map((p, i) => ({ p, i }));

    const evidenceHtml = evidence.length ? evidence.map(({ p, i }, k) => `
      <button class="food-card card-3d" type="button" data-index="${i}" aria-label="Open ${esc(p.title)} in the viewer" data-reveal>
        <span class="food-card-num mono">EVIDENCE ${String(k + 1).padStart(2, '0')}</span>
        <img src="${esc(p.thumb || p.url)}" alt="${esc(p.title)}: ${esc(p.caption)}" width="${p.width || 600}" height="${p.height || 800}" loading="lazy">
        <span class="food-card-body">
          <span class="food-card-title">${esc(p.title)}</span>
          <span class="food-card-cap">${esc(p.caption)}</span>
          <span class="food-card-badge mono">${esc(nick)}-APPROVED ★★★★★</span>
        </span>
      </button>`).join('') : `<div class="food-card food-card-empty glass panel" data-reveal><span class="display">NO EVIDENCE</span><p class="muted mono">He ate it before we could take a photo.</p></div>`;

    const steam = `<svg class="food-steam" viewBox="0 0 60 50" aria-hidden="true"><path d="M14 46 C6 36 22 30 14 18 C8 10 18 6 14 2" /><path d="M30 46 C22 36 38 30 30 18 C24 10 34 6 30 2" /><path d="M46 46 C38 36 54 30 46 18 C40 10 50 6 46 2" /></svg>`;

    el.innerHTML = `
      <div class="food-bg" aria-hidden="true"></div>
      <div class="food-plate-ring" aria-hidden="true"></div>
      <div class="container">
        <header class="sec-head food-head">
          <div class="food-appbar mono" data-reveal>
            <span class="food-appbar-dot"></span> DELIVERING TO: <b>WHEREVER ${esc(nick)} IS</b> <span class="food-appbar-sep">·</span> ETA: <b>INSTANT</b>
          </div>
          <span class="eyebrow">ORDER #0001 · THE ONLY DIVISION WITH A PERFECT RECORD</span>
          <h2 class="display h1 food-title"><span class="food-title-text">${esc(nick)} FOOD <span class="food-cream">DIVISION</span></span></h2>
          <p class="lead">${esc(first)} eats like the ball is chasing him. ${esc(fav)} above everything. Misses passes, misses nationals, misses deadlines — has never, ever missed a plate.</p>
          <p class="food-hint mono muted">psst: type his favourite food</p>
        </header>

        <section class="food-evidence" aria-label="Food evidence">
          <div class="food-row-head">
            <h3 class="display h2">FOOD <span class="food-cream">EVIDENCE</span></h3>
            <span class="mono muted food-tiny">tap to open in the viewer</span>
          </div>
          <div class="food-cards">${evidenceHtml}</div>
        </section>

        <section class="food-stats" aria-label="Food statistics">
          <div class="food-tile food-tile-hero" data-reveal>
            <div class="food-plate" aria-hidden="true">${steam}<span class="food-plate-emoji">🍛</span></div>
            <div>
              <span class="food-tile-label mono">${esc(fav)} plates missed</span>
              <b class="display food-tile-big"><span class="food-count-missed">0</span></b>
              <span class="food-tile-sub mono">the only perfect record</span>
            </div>
          </div>
          <div class="food-tile" data-reveal>
            <span class="food-tile-label mono">Appetite</span>
            <b class="display food-tile-big food-inf">∞</b>
            <span class="food-tile-sub mono">measured in plates/hour. Overflowed.</span>
          </div>
          <div class="food-tile" data-reveal>
            <span class="food-tile-label mono">Second servings</span>
            <b class="display food-tile-big">ALWAYS</b>
            <span class="food-tile-sub mono">third servings: "just tasting"</span>
          </div>
          <div class="food-tile food-vs" data-reveal>
            <span class="food-tile-label mono">Head to head</span>
            <div class="food-vs-row">
              <span class="food-vs-label mono">Pass completion</span>
              <span class="food-vs-val mono food-vs-val-pass"><span class="food-vs-num" data-to="4">0</span>%</span>
              <div class="food-vs-track"><div class="food-vs-fill food-vs-fill-pass" data-w="4"></div></div>
            </div>
            <div class="food-vs-mid mono">VS</div>
            <div class="food-vs-row">
              <span class="food-vs-label mono">Plate completion</span>
              <span class="food-vs-val mono"><span class="food-vs-num" data-to="100">0</span>%</span>
              <div class="food-vs-track"><div class="food-vs-fill food-vs-fill-plate" data-w="100"></div></div>
            </div>
          </div>
        </section>

        <div class="food-grid">
          <section class="food-radar-wrap" aria-label="Food radar" data-reveal>
            <div class="food-row-head">
              <h3 class="display h2">FOOD <span class="food-cream">RADAR</span></h3>
              <span class="mono muted food-tiny">range: 3 km · accuracy: unfortunately perfect</span>
            </div>
            <div class="food-radar">
              <svg class="food-radar-svg" viewBox="0 0 300 300" aria-hidden="true">
                <defs>
                  <linearGradient id="food-sweep-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(255,138,61,0)"/><stop offset="1" stop-color="rgba(255,138,61,.75)"/></linearGradient>
                  <radialGradient id="food-radar-bg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2a170c"/><stop offset="1" stop-color="#120a06"/></radialGradient>
                </defs>
                <circle cx="150" cy="150" r="144" fill="url(#food-radar-bg)" stroke="rgba(255,232,194,.25)" stroke-width="2"/>
                <circle cx="150" cy="150" r="108" fill="none" stroke="rgba(255,232,194,.14)"/>
                <circle cx="150" cy="150" r="72" fill="none" stroke="rgba(255,232,194,.14)"/>
                <circle cx="150" cy="150" r="36" fill="none" stroke="rgba(255,232,194,.14)"/>
                <line x1="150" y1="6" x2="150" y2="294" stroke="rgba(255,232,194,.12)"/>
                <line x1="6" y1="150" x2="294" y2="150" stroke="rgba(255,232,194,.12)"/>
                <g transform="translate(150,150)"><g class="food-sweep"><path d="M0 0 L0 -144 A144 144 0 0 1 144 0 Z" fill="url(#food-sweep-grad)"/><line x1="0" y1="0" x2="144" y2="0" stroke="#ffb27a" stroke-width="2"/></g></g>
                <g class="food-blips"></g>
                <circle cx="150" cy="150" r="5" fill="#ffe8c2"/>
                <text x="150" y="172" text-anchor="middle" class="food-radar-you">${esc(nick)}</text>
              </svg>
              <div class="food-radar-status mono" aria-live="polite"><span class="food-radar-line">IDLE · NO FOOD IN RANGE (SUSPICIOUS)</span></div>
            </div>
            <div class="row food-radar-actions">
              <button class="btn btn-lg food-scan" type="button">SCAN FOR FOOD</button>
              <span class="mono muted food-tiny">scans: <b class="food-scan-count">0</b></span>
            </div>
          </section>

          <section class="food-menu" aria-label="SIR's usual order" data-reveal>
            <div class="food-menu-top">
              <span class="eyebrow">RECEIPT</span>
              <h3 class="display h2">${esc(nick)}'S USUAL <span class="food-cream">ORDER</span></h3>
              <span class="mono muted food-tiny">table for 1 · chairs used: 1 · plates used: all</span>
            </div>
            <ul class="food-menu-list">
              ${MENU.map((m, i) => `<li class="food-dish" style="--i:${i}"><div class="food-dish-main"><span class="food-dish-name">${esc(m.n)}</span><span class="food-dish-desc">${esc(m.d)}</span><span class="food-dish-rating mono">${esc(nick)}-approved ★★★★★</span></div><span class="food-dish-price mono">${esc(m.p)}</span></li>`).join('')}
            </ul>
            <div class="food-menu-total">
              <div class="food-total-row mono"><span>SUBTOTAL</span><span>₹ yes</span></div>
              <div class="food-total-row mono"><span>DELIVERY</span><span>₹ 0 (he ran)</span></div>
              <div class="food-total-row food-total-big"><span class="display">SPLIT THE BILL?</span><span class="mono">He said 5 minutes and left.</span></div>
            </div>
          </section>
        </div>
      </div>`;

    const q = (s) => el.querySelector(s);

    // ── Evidence → viewer ─────────────────────────────────────
    el.querySelectorAll('.food-card[data-index]').forEach(card => {
      motion.tilt(card, { max: 7 });
      card.addEventListener('click', () => { api.event('photo_open', { from: 'food', index: Number(card.dataset.index) }); viewer.open(Number(card.dataset.index)); });
    });

    // ── Stats animate on enter ────────────────────────────────
    ctx.onSectionEnter(el, () => {
      el.querySelectorAll('.food-vs-num').forEach(n => motion.countUp(n, Number(n.dataset.to), { duration: 1.6 }));
      el.querySelectorAll('.food-vs-fill').forEach(f => { f.style.width = f.dataset.w + '%'; });
      const missed = q('.food-count-missed');
      if (!motion.reduced) { const o = { v: 9 }; gsap.to(o, { v: 0, duration: 1.4, ease: 'power3.out', onUpdate: () => { missed.textContent = String(Math.round(o.v)); } }); }
      if (!motion.reduced) gsap.fromTo(el.querySelectorAll('.food-dish'), { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: q('.food-menu'), start: 'top 80%' } });
    });

    // ── Food radar ────────────────────────────────────────────
    const radar = q('.food-radar'), scanBtn = q('.food-scan'), line = q('.food-radar-line'), blips = q('.food-blips'), scanCount = q('.food-scan-count');
    let scanning = false, scans = 0;
    scanBtn.addEventListener('click', async () => {
      if (scanning) return; scanning = true; scanBtn.disabled = true;
      scans++; scanCount.textContent = String(scans);
      const food = pick(FOODS), d = randInt(1, 9);
      sfx.play('scan');
      api.event('food_scan', { food: food.name.toLowerCase() });
      radar.classList.add('is-scanning');
      line.textContent = 'SCANNING… SNIFFING…';
      blips.innerHTML = '';
      const steps = motion.reduced ? 1 : 6;
      for (let i = 0; i < steps; i++) {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 105;
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', (150 + Math.cos(a) * r).toFixed(1)); c.setAttribute('cy', (150 + Math.sin(a) * r).toFixed(1)); c.setAttribute('r', '0'); c.setAttribute('class', 'food-blip');
        blips.appendChild(c);
        if (motion.reduced) c.setAttribute('r', '6');
        else { gsap.fromTo(c, { attr: { r: 0 }, opacity: 1 }, { attr: { r: 7 }, duration: 0.35, ease: 'back.out(2)' }); gsap.to(c, { opacity: 0.35, duration: 0.6, delay: 0.4, yoyo: true, repeat: -1 }); sfx.play('tick'); }
        await wait(motion.reduced ? 100 : 280);
      }
      await wait(motion.reduced ? 100 : 500);
      // the big one: food, dead centre-ish, pulsing
      const target = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      target.setAttribute('x', String(150 + randInt(-60, 60))); target.setAttribute('y', String(150 + randInt(-70, -20))); target.setAttribute('text-anchor', 'middle'); target.setAttribute('class', 'food-blip-food'); target.textContent = food.emoji;
      blips.appendChild(target);
      if (!motion.reduced) gsap.fromTo(target, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
      line.textContent = pick(DETECT)(food.name, d).toUpperCase();
      radar.classList.remove('is-scanning'); radar.classList.add('is-found');
      sfx.play('success');
      if (!motion.reduced) {
        const rr = radar.getBoundingClientRect();
        fx.emoji({ emoji: food.emoji, count: 12, x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 });
        gsap.fromTo(q('.food-radar-status'), { scale: 0.96, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' });
      }
      scanning = false; scanBtn.disabled = false; scanBtn.textContent = 'SCAN AGAIN';
      setTimeout(() => radar.classList.remove('is-found'), 2500);
    });

    // ── Easter egg: type "biryani" anywhere ───────────────────
    const titleText = q('.food-title-text'), originalTitle = titleText.innerHTML;
    let eggTimer = 0;
    eggs.onUnlock('biryani', () => {
      sfx.play('fanfare');
      if (!motion.reduced) fx.rain({ emoji: ['🍛', '🍗', '🥘'], count: 40 });
      titleText.innerHTML = `<span class="food-cream">BIRYANI PROTOCOL</span> ACTIVATED`;
      el.classList.add('is-biryani');
      if (!motion.reduced) {
        gsap.fromTo(titleText, { scale: 0.8, rotate: -2, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' });
        gsap.fromTo(q('.food-plate-emoji'), { scale: 1 }, { scale: 1.5, duration: 0.3, yoyo: true, repeat: 5 });
      }
      clearTimeout(eggTimer);
      eggTimer = setTimeout(() => { titleText.innerHTML = originalTitle; el.classList.remove('is-biryani'); if (!motion.reduced) gsap.fromTo(titleText, { opacity: 0 }, { opacity: 1, duration: 0.5 }); }, 4200);
    });
    motion.magnetic(scanBtn);
  },
};
