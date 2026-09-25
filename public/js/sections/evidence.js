// 13 · EVIDENCE — detective investigation board. Cork, polaroids, pins,
// red string, sticky notes. Every photo is a piece of evidence.
const NOTES = [
  { text: 'He was RIGHT THERE.', sub: 'witness statement · Shiv', hue: 'yellow' },
  { text: '"5 minutes" = 3 hours', sub: 'confirmed · every single time', hue: 'pink' },
  { text: 'ball still rolling', sub: 'as of this morning', hue: 'green' },
  { text: 'NOT SELECTED', sub: 'nationals · file closed', hue: 'yellow' },
];
const NOTE_SLOTS = [2, 6, 11, 15]; // grid positions where sticky notes are inserted

export default {
  id: 'evidence',
  title: 'The Evidence Room',
  mount(el, ctx) {
    const { photos, settings, profile, esc, gsap, ScrollTrigger, sfx, motion, api, viewer, toast } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();
    const seeded = (i) => { const x = Math.sin((i + 1) * 9301 + 49297) * 233280; return x - Math.floor(x); }; // stable per-index pseudo-random
    const rot = (i) => (seeded(i) * 8 - 4).toFixed(2);
    const touch = window.matchMedia('(hover: none)').matches;
    const tags = [...new Set(photos.flatMap(p => p.tags || []))].sort();
    if (settings.video_evidence) tags.push('video');

    // ── build items (photos + video + sticky notes) ───────────
    const items = [];
    photos.forEach((p, i) => items.push({ kind: 'photo', index: i, photo: p }));
    if (settings.video_evidence) items.splice(Math.min(1, items.length), 0, { kind: 'video', file: settings.video_evidence });
    let noteN = 0;
    for (const slot of NOTE_SLOTS) { if (slot <= items.length && noteN < NOTES.length) items.splice(slot, 0, { kind: 'note', note: NOTES[noteN++] }); }
    if (!photos.length) items.push({ kind: 'note', note: NOTES[0] });

    const itemHtml = (it, i) => {
      const style = `style="--rot:${rot(i)}deg;--lift:${(seeded(i + 40) * 26).toFixed(0)}px"`;
      if (it.kind === 'photo') {
        const p = it.photo, tagStr = (p.tags || []).join(' ');
        return `<div class="ev-item" data-kind="photo" data-tags="${esc(tagStr)}" ${style}>
          <button class="ev-card ev-polaroid" type="button" data-index="${it.index}" aria-label="Open ${esc(p.title)}: ${esc(p.caption || '')}">
            <span class="ev-pin" aria-hidden="true"></span>
            <span class="ev-tape" aria-hidden="true"></span>
            <span class="ev-photo">
              <img loading="lazy" decoding="async" src="${esc(p.thumb || p.url)}" width="${p.width || 800}" height="${p.height || 1000}" alt="${esc(p.title)}">
              <span class="ev-cap"><span class="ev-cap-kicker mono">CASE NOTE</span><span class="ev-cap-text">${esc(p.caption || 'No comment. Which is suspicious.')}</span><span class="ev-cap-hint mono">${touch ? 'TAP AGAIN TO ENLARGE' : 'CLICK TO ENLARGE'}</span></span>
            </span>
            <span class="ev-label"><span class="ev-label-title mono">${esc(p.title)}</span><span class="ev-label-tags mono">${esc((p.tags || []).map(t => '#' + t).join(' ') || '#unfiled')}</span></span>
          </button></div>`;
      }
      if (it.kind === 'video') {
        return `<div class="ev-item ev-item-video" data-kind="video" data-tags="video" ${style}>
          <div class="ev-polaroid ev-video-card">
            <span class="ev-pin" aria-hidden="true"></span>
            <span class="ev-tape ev-tape-alt" aria-hidden="true"></span>
            <span class="ev-photo ev-photo-video">
              <video src="assets/photos/${esc(it.file)}" controls muted playsinline preload="metadata" aria-label="Exhibit V, video evidence"></video>
              <span class="ev-broken" aria-hidden="true"><span class="display">TAPE DAMAGED</span><span class="mono">Footage corrupted. Like his positioning.</span></span>
            </span>
            <span class="ev-label"><span class="ev-label-title mono">EXHIBIT V — VIDEO EVIDENCE</span><span class="ev-label-tags mono">#video #motion-detected</span></span>
          </div></div>`;
      }
      return `<div class="ev-item ev-item-note" data-kind="note" data-tags="" ${style}>
        <div class="ev-note ev-note-${it.note.hue}"><span class="ev-pin ev-pin-blue" aria-hidden="true"></span><span class="ev-note-text">${esc(it.note.text)}</span><span class="ev-note-sub mono">${esc(it.note.sub)}</span></div></div>`;
    };

    el.innerHTML = `
      <div class="ev-board">
        <div class="ev-frame" aria-hidden="true"></div>
        <div class="container ev-inner">
          <div class="ev-top">
            <div class="ev-case" data-reveal>
              <span class="ev-pin ev-pin-blue" aria-hidden="true"></span>
              <span class="eyebrow">CASE FILE #${esc(String(profile.age).padStart(3, '0'))} · INVESTIGATION BOARD</span>
              <h2 class="display h1 ev-title">THE EVIDENCE ROOM</h2>
              <p class="ev-lead">Every photograph of ${esc(nick)} has been examined by two unpaid detectives (${esc(profile.made_by || 'Shiv + Alex')}). Findings: guilty of being late, guilty of anime, guilty of that pass.</p>
              <span class="stamp ev-stamp" aria-hidden="true">CONFIDENTIAL</span>
              <span class="ev-disclaimer mono">Captions are 100% fabricated by his friends. Photos are 100% real. Unfortunately.</span>
            </div>
            <div class="ev-note ev-note-yellow ev-counter-note" data-reveal>
              <span class="ev-pin" aria-hidden="true"></span>
              <span class="ev-counter display"><b class="ev-count">${photos.length}</b> pieces of evidence</span>
              <span class="ev-counter-sub">· <b>0</b> alibis</span>
            </div>
          </div>

          <div class="ev-toolbar" data-reveal>
            <div class="ev-filters" role="group" aria-label="Filter evidence by tag">
              <button class="ev-filter mono" type="button" data-tag="" aria-pressed="true">ALL</button>
              ${tags.map(t => `<button class="ev-filter mono" type="button" data-tag="${esc(t)}" aria-pressed="false">${esc(t.toUpperCase())}</button>`).join('')}
            </div>
            <div class="ev-actions">
              <button class="btn btn-sm ev-next" type="button" ${photos.length ? '' : 'disabled'}>NEXT EVIDENCE →</button>
              <button class="btn btn-ghost btn-sm ev-random" type="button" ${photos.length > 1 ? '' : 'disabled'}>🎲 SHOW RANDOM EVIDENCE</button>
              <button class="btn btn-ghost btn-sm ev-slideshow" type="button" aria-pressed="false" ${photos.length > 1 ? '' : 'disabled'}>▶ SLIDESHOW</button>
            </div>
          </div>

          <div class="ev-wall">
            <svg class="ev-string" aria-hidden="true" preserveAspectRatio="none"><path class="ev-string-path" d=""/></svg>
            ${photos.length ? `<div class="ev-grid">${items.map(itemHtml).join('')}</div>` : `
              <div class="ev-empty">
                <div class="ev-polaroid ev-empty-card"><span class="ev-pin" aria-hidden="true"></span>
                  <span class="ev-photo ev-photo-empty display">NO EVIDENCE</span>
                  <span class="ev-label"><span class="ev-label-title mono">No evidence on file. Suspiciously clean.</span></span>
                </div>
                <div class="ev-grid">${items.map(itemHtml).join('')}</div>
              </div>`}
          </div>
          <p class="ev-foot mono">${esc(String(photos.length))} exhibits · ${esc(String(tags.length))} categories · 0 alibis · case remains open</p>
        </div>
      </div>`;

    // ── refs ──────────────────────────────────────────────────
    const q = (s) => el.querySelector(s);
    const wall = q('.ev-wall'), grid = q('.ev-grid'), svg = q('.ev-string'), path = q('.ev-string-path');
    const cards = [...el.querySelectorAll('.ev-card')], gridItems = [...el.querySelectorAll('.ev-grid .ev-item')];
    const filters = [...el.querySelectorAll('.ev-filter')];
    const slideBtn = q('.ev-slideshow');
    let lastIdx = -1, slideTimer = 0, stringTween = null, peek = null;

    // ── polaroid interactions ─────────────────────────────────
    cards.forEach(card => {
      motion.tilt(card, { max: 7, scale: 1.03 });
      card.addEventListener('click', () => {
        const idx = Number(card.dataset.index);
        if (touch && peek !== card) { // first tap on touch: reveal the case note
          peek?.classList.remove('is-peek'); peek = card; card.classList.add('is-peek'); sfx.play('tick'); return;
        }
        lastIdx = idx; viewer.open(idx);
      });
      card.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); card.click(); } });
    });
    document.addEventListener('pointerdown', (e) => { if (peek && !peek.contains(e.target)) { peek.classList.remove('is-peek'); peek = null; } }, { passive: true });

    // video evidence
    const video = q('.ev-video-card video');
    if (video) { let logged = false; video.addEventListener('play', () => { if (!logged) { logged = true; api.event('video_play', { file: settings.video_evidence }); } }); video.addEventListener('error', () => { video.closest('.ev-video-card')?.classList.add('is-broken'); }, { once: true }); }

    // ── toolbar ───────────────────────────────────────────────
    q('.ev-next').addEventListener('click', () => { if (!photos.length) return; lastIdx = (lastIdx + 1) % photos.length; viewer.open(lastIdx); });
    q('.ev-random').addEventListener('click', () => { sfx.play('glitch'); viewer.random(); });
    function stopSlideshow() { clearInterval(slideTimer); slideTimer = 0; slideBtn.setAttribute('aria-pressed', 'false'); slideBtn.textContent = '▶ SLIDESHOW'; }
    slideBtn.addEventListener('click', () => {
      if (slideTimer) { stopSlideshow(); if (viewer.isOpen) viewer.close(); return; }
      if (!photos.length) return;
      lastIdx = (lastIdx + 1) % photos.length; viewer.open(lastIdx);
      slideBtn.setAttribute('aria-pressed', 'true'); slideBtn.textContent = '■ STOP SLIDESHOW';
      toast.show({ icon: '🎞️', title: 'Slideshow running.', body: 'Esc closes it. He cannot escape it.' });
      let ticks = 0;
      slideTimer = setInterval(() => { if (!viewer.isOpen) { stopSlideshow(); return; } if (++ticks % 12 === 0) { lastIdx = (lastIdx + 1) % photos.length; viewer.next(); } }, 250);
    });

    // ── red string ────────────────────────────────────────────
    function redrawString() {
      if (!grid) return;
      const pins = [...grid.querySelectorAll('.ev-item:not([hidden]) .ev-pin')];
      const wb = wall.getBoundingClientRect();
      if (pins.length < 2 || wb.width === 0) { path.setAttribute('d', ''); return; }
      svg.setAttribute('viewBox', `0 0 ${wb.width} ${wb.height}`);
      const pts = pins.map(p => { const r = p.getBoundingClientRect(); return [r.left + r.width / 2 - wb.left, r.top + r.height / 2 - wb.top]; });
      let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + Math.min(60, Math.hypot(x1 - x0, y1 - y0) * 0.12); d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
      path.setAttribute('d', d);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      stringTween?.scrollTrigger?.kill(); stringTween?.kill();
      if (motion.reduced) { path.style.strokeDashoffset = '0'; return; }
      stringTween = gsap.fromTo(path, { strokeDashoffset: len }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: wall, start: 'top 85%', end: 'bottom 70%', scrub: 0.8 } });
    }
    let rsT = 0;
    const scheduleRedraw = () => { clearTimeout(rsT); rsT = setTimeout(() => { redrawString(); ScrollTrigger.refresh(); }, 120); };
    window.addEventListener('resize', scheduleRedraw, { passive: true });
    if (grid) { el.querySelectorAll('.ev-grid img').forEach(im => { if (!im.complete) im.addEventListener('load', scheduleRedraw, { once: true }); }); }

    // ── filters ───────────────────────────────────────────────
    let filtering = false;
    async function applyFilter(tag) {
      if (!grid || filtering) return;
      filtering = true;
      const match = (it) => !tag ? true : (it.dataset.tags || '').split(' ').includes(tag);
      const toHide = gridItems.filter(it => !match(it) && !it.hidden), toShow = gridItems.filter(it => match(it));
      if (motion.reduced) { toHide.forEach(it => { it.hidden = true; }); toShow.forEach(it => { it.hidden = false; }); redrawString(); ScrollTrigger.refresh(); filtering = false; return; }
      if (toHide.length) await gsap.to(toHide, { opacity: 0, scale: 0.8, duration: 0.25, stagger: 0.015, ease: 'power2.in' });
      toHide.forEach(it => { it.hidden = true; });
      const entering = toShow.filter(it => it.hidden);
      entering.forEach(it => { it.hidden = false; });
      gsap.set(entering, { opacity: 0, scale: 0.85, y: 20 });
      redrawString(); ScrollTrigger.refresh();
      await gsap.to(toShow, { opacity: 1, scale: 1, y: 0, duration: 0.55, stagger: 0.035, ease: 'back.out(1.6)', clearProps: 'scale,y', overwrite: true });
      redrawString(); filtering = false;
    }
    filters.forEach(f => f.addEventListener('click', () => {
      if (f.getAttribute('aria-pressed') === 'true') return;
      filters.forEach(x => x.setAttribute('aria-pressed', String(x === f)));
      sfx.play('tick'); applyFilter(f.dataset.tag);
      const visible = gridItems.filter(it => (f.dataset.tag ? (it.dataset.tags || '').split(' ').includes(f.dataset.tag) : true) && it.dataset.kind !== 'note').length;
      if (f.dataset.tag) toast.show({ icon: '🔍', title: `${visible} exhibit${visible === 1 ? '' : 's'} tagged #${f.dataset.tag}`, duration: 1800 });
    }));

    // ── section enter: preload, counters, entrance ────────────
    ctx.onSectionEnter(el, () => {
      photos.slice(0, 4).forEach(p => { const im = new Image(); im.src = p.url; });
      motion.countUp(q('.ev-count'), photos.length, { duration: 1.2 });
      if (motion.reduced || !gridItems.length) { redrawString(); return; }
      gsap.fromTo(gridItems, { opacity: 0, y: 50, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, stagger: { each: 0.05, from: 'start' }, ease: 'back.out(1.4)', clearProps: 'scale,y', onStart: () => sfx.play('whoosh'), onComplete: () => { redrawString(); ScrollTrigger.refresh(); } });
    });
    if (gridItems.length && !motion.reduced) gsap.set(gridItems, { opacity: 0 });
    requestAnimationFrame(redrawString);
  },
};
