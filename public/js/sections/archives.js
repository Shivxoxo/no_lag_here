// 02 · ARCHIVES — classified case-file wall: redacted dossier that decrypts,
// rotating 3D ID card, mugshot strip, threat gauge, fingerprint, barcode.
const GLYPHS = '█▓▒░ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@*<>/\\';

export default {
  id: 'archives',
  title: 'The SIR Archives',
  mount(el, ctx) {
    const { profile: P, photos, esc, gsap, sfx, motion, api, viewer, fx } = ctx;
    const val = (v, fb) => (v == null || String(v).trim() === '') ? fb : String(v);
    const nick = val(P.nickname, 'SIR');
    const friends = Array.isArray(P.friends) ? P.friends.filter(Boolean) : [];
    const friend0 = friends[0] || 'his friends';
    const caseNo = String(P.age ?? 0).padStart(4, '0');
    const bday = (() => { const d = new Date(P.birthday); return isNaN(d) ? String(P.birthday || 'UNKNOWN') : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase(); })();
    const birthYear = (() => { const d = new Date(P.birthday); return isNaN(d) ? '????' : d.getUTCFullYear(); })();

    // ── data (values come from the profile; notes are the roast) ──
    const FIELDS = [
      ['NAME', val(P.name, 'REDACTED'), `Responds only to "${nick}". Nobody knows why. Everybody agrees.`],
      ['AGE', val(P.age, '??'), 'Confirmed by birth certificate. Behaviour suggests otherwise.'],
      ['DATE OF BIRTH', bday, 'The one day per year he arrives on time.'],
      ['POSITION', val(P.position, 'Bench'), 'Officially. Unofficially: somewhere near the water bottles.'],
      ['CODENAME', val(P.codename, nick), 'Self-assigned. Never earned.'],
      ['KNOWN WEAKNESS', val(P.known_weakness, 'Perfect passes'), `Especially the ones from ${friend0}. Also the ones from everyone else.`],
      ['PRIMARY HABIT', val(P.primary_habit, 'Being late'), 'Quoted arrival: "5 minutes". Measured arrival: 55 minutes.'],
      ['SECONDARY HABIT', val(P.secondary_habit, 'Watching anime'), 'Ongoing. Currently on episode ∞.'],
      ['COMBAT CLASS', val(P.combat_class, 'Professional Procrastinator'), 'Level 99. Will level up tomorrow. Definitely tomorrow.'],
      ['FAVOURITE FOOD', val(P.favourite_food, 'Everything. Biryani first.'), 'The only target he has never missed.'],
      ['GAMES', val(P.games, 'Free Fire, BGMI'), 'Rank: Heroic. Homework rank: Unranked.'],
      ['KNOWN ASSOCIATES', friends.length ? friends.join(', ') : 'NONE (they all left after the pass)', 'All of them have delivered perfect passes. None were received.'],
      ['ALIASES', [nick, 'Unnational', '5 Minutes'].join(' · '), '"5 Minutes" is the most frequently used alias. Also the most frequently false.'],
    ];
    const food = val(P.favourite_food, 'Biryani').split(/[(,]/)[0].trim().toUpperCase();

    const READINGS = [
      { label: 'THREAT TO OPPONENTS', v: 4, verdict: 'NEGLIGIBLE' },
      { label: `THREAT TO ${friend0.toUpperCase()}'S PASSES`, v: 100, verdict: 'CRITICAL' },
      { label: `THREAT TO ${food}`, v: 98, verdict: 'SEVERE' },
      { label: 'THREAT TO PUNCTUALITY', v: 91, verdict: 'CHRONIC' },
    ];

    const SIGHTINGS = [
      ['06:00', 'GYM', 'NOT SIGHTED', 'bad'],
      ['09:00', 'TRAINING', '"5 MINUTES AWAY" (ARRIVED 09:55)', 'warn'],
      ['13:00', 'CANTEEN', `SIGHTED IMMEDIATELY · ${food}`, 'ok'],
      ['17:30', 'PITCH', `${val(P.known_weakness, 'PERFECT PASS').toUpperCase()} MISSED · ×3`, 'bad'],
      ['22:30', 'BEDROOM', `${val(P.secondary_habit, 'WATCHING ANIME').toUpperCase()} · EP. 847`, 'warn'],
      ['23:59', 'BEDROOM', '"ONE MORE EPISODE"', 'bad'],
    ];

    // Mugshots: prefer hero/football tags, take up to 3, keep the index for the viewer
    const ranked = photos.map((p, i) => ({ p, i, s: (p.tags || []).reduce((n, t) => n + (t === 'hero' ? 2 : t === 'football' ? 1 : 0), 0) })).sort((a, b) => b.s - a.s);
    const mugs = ranked.slice(0, 3);
    const MUG_LABELS = ['FRONT', 'PROFILE', 'CAUGHT LATE'];
    const idPhoto = mugs[0]?.p;

    // ── helpers ────────────────────────────────────────────────
    const gaugePt = (f, r = 90) => { const a = Math.PI * (1 - f); return [110 + r * Math.cos(a), 110 - r * Math.sin(a)]; };
    const gaugeSegs = ['#2ee56b', '#c6ff3d', '#ffcc4d', '#ff8a3d', '#ff3b3b'].map((c, k) => { const [sx, sy] = gaugePt(k / 5), [ex, ey] = gaugePt((k + 1) / 5); return `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} A90 90 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${c}" class="ar-gseg"/>`; }).join('');
    const fingerprint = () => { let out = ''; for (let i = 0; i < 14; i++) { const r = 6 + i * 5.4, ry = r * 1.22, ox = Math.sin(i * 0.9) * 3, oy = -i * 1.1; const dash = `${8 + (i * 7) % 15} ${2 + (i * 3) % 6} ${5 + (i * 5) % 12} ${3 + (i * 2) % 4}`; out += `<path class="ar-ring" d="M${(80 + ox - r).toFixed(1)},${(104 + oy).toFixed(1)} a${r.toFixed(1)},${ry.toFixed(1)} 0 1,0 ${(2 * r).toFixed(1)},0 a${r.toFixed(1)},${ry.toFixed(1)} 0 1,0 ${(-2 * r).toFixed(1)},0" stroke-dasharray="${dash}" stroke-dashoffset="${(i * 13) % 40}"/>`; } return out; };
    const barcode = (str, n = 72) => { let h = 2166136261, x = 0, out = ''; for (let i = 0; i < n; i++) { h ^= str.charCodeAt(i % str.length); h = Math.imul(h, 16777619) >>> 0; const w = 1 + (h % 3); const on = ((h >> 5) % 4) !== 0; if (on) out += `<rect class="ar-bar" x="${x}" y="0" width="${w}" height="40"/>`; x += w + 1; } return { svg: out, w: x }; };
    const bc = barcode(`${val(P.name, 'x')}|${nick}|${caseNo}`);

    el.innerHTML = `
      <div class="ar-bg" aria-hidden="true"><span class="ar-watermark display">CLASSIFIED</span><span class="ar-grid"></span></div>
      <div class="container">
        <div class="sec-head ar-head">
          <div class="ar-head-row">
            <span class="eyebrow">FILE #${esc(caseNo)} · CLEARANCE: FRIEND · EYES ONLY</span>
            <span class="ar-live mono" aria-hidden="true"><span class="dot"></span> SURVEILLANCE ACTIVE</span>
          </div>
          <h2 class="display h1 ar-title">THE <span class="accent">${esc(nick.toUpperCase())}</span> ARCHIVES</h2>
          <p class="lead">Everything the authorities know about the subject. Compiled by ${esc(val(P.made_by, 'his friends'))}, cross-referenced with zero witnesses who would defend him.</p>
        </div>

        <div class="ar-toolbar glass" data-reveal>
          <div class="ar-prog" role="progressbar" aria-label="Decryption progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="ar-prog-label mono">DECRYPTION <b class="ar-prog-val">0%</b></span>
            <span class="ar-prog-track"><i class="ar-prog-fill"></i></span>
          </div>
          <div class="ar-actions">
            <button class="btn ar-declassify" type="button">DECLASSIFY ALL</button>
            <button class="btn btn-ghost ar-encrypt" type="button" aria-pressed="false">RE-ENCRYPT</button>
          </div>
        </div>

        <div class="ar-wall">
          <!-- ID CARD -->
          <div class="ar-col ar-col-id" data-reveal>
            <div class="ar-id" aria-label="Subject ID card">
              <div class="ar-id-spin"><div class="ar-id-inner">
                <div class="ar-id-face ar-id-front">
                  <div class="ar-id-top mono"><span>INTERNATIONAL SUBJECT ID</span><span class="ar-id-no">№ ${esc(caseNo)}</span></div>
                  <div class="ar-id-body">
                    <div class="ar-id-photo">${idPhoto ? `<img src="${esc(idPhoto.thumb || idPhoto.url)}" alt="ID photo of ${esc(val(P.name, nick))}" width="${idPhoto.width || 300}" height="${idPhoto.height || 400}" loading="lazy">` : `<span class="display">${esc(nick.slice(0, 3).toUpperCase())}</span>`}<span class="ar-id-holo" aria-hidden="true"></span></div>
                    <dl class="ar-id-data mono">
                      <div><dt>NAME</dt><dd>${esc(val(P.name, 'REDACTED'))}</dd></div>
                      <div><dt>CODENAME</dt><dd class="accent">${esc(val(P.codename, nick))}</dd></div>
                      <div><dt>AGE</dt><dd class="display ar-id-age">${esc(val(P.age, '??'))}</dd></div>
                      <div><dt>POSITION</dt><dd>${esc(val(P.position, 'Bench'))}</dd></div>
                    </dl>
                  </div>
                  <div class="ar-id-foot mono"><span class="ar-chip" aria-hidden="true"></span><span>STATUS: <b class="bad">UNNATIONAL</b></span><span>EXP: NEVER</span></div>
                </div>
                <div class="ar-id-face ar-id-back">
                  <div class="ar-id-strip" aria-hidden="true"></div>
                  <div class="ar-id-backbody mono">
                    <p>IF FOUND, RETURN TO: <b>THE BENCH</b></p>
                    <p>EMERGENCY CONTACT: <b>${esc(friends.join(' / ') || 'NONE')}</b></p>
                    <p>ALLERGIES: <b>PUNCTUALITY, HOMEWORK</b></p>
                    <p>BLOOD TYPE: <b>${esc(food)}</b></p>
                  </div>
                  <svg class="ar-id-barcode" viewBox="0 0 ${bc.w} 40" preserveAspectRatio="none" aria-hidden="true">${bc.svg}</svg>
                  <span class="ar-id-sig display" aria-hidden="true">${esc(nick)}</span>
                </div>
              </div></div>
            </div>
            <div class="ar-id-ctl">
              <button class="btn btn-ghost btn-sm ar-flip" type="button" aria-pressed="false">FLIP CARD</button>
              <span class="mono muted ar-id-hint">hover to inspect · click to flip</span>
            </div>
          </div>

          <!-- DOSSIER -->
          <div class="ar-col ar-col-dossier" data-reveal>
            <div class="ar-paper ar-dossier">
              <span class="ar-tape ar-tape-l" aria-hidden="true"></span><span class="ar-tape ar-tape-r" aria-hidden="true"></span>
              <div class="ar-paper-head ar-dossier-head mono">
                <span>SUBJECT DOSSIER · ${FIELDS.length} FIELDS</span><span class="ar-scan-label">STATUS: <span class="ar-scan-txt">STANDBY</span></span>
              </div>
              <span class="stamp ar-stamp ar-stamp-cls" aria-hidden="true">CLASSIFIED</span>
              <span class="stamp ar-stamp ar-stamp-dec" aria-hidden="true">DECLASSIFIED</span>
              <dl class="ar-fields">
                ${FIELDS.map(([label, value, note], i) => `
                <div class="ar-field is-enc" style="--i:${i}">
                  <dt class="ar-label mono"><span class="ar-idx">${String(i + 1).padStart(2, '0')}</span>${esc(label)}</dt>
                  <dd class="ar-value">
                    <button class="ar-red" type="button" aria-label="Decrypt ${esc(label)}">
                      <span class="ar-state mono" aria-hidden="true">ENCRYPTED</span>
                      <span class="ar-txt" aria-hidden="true" data-value="${esc(value)}"></span>
                      <span class="ar-bar" aria-hidden="true"></span>
                    </button>
                    <span class="sr-only">${esc(value)}</span>
                    <span class="ar-note mono">${esc(note)}</span>
                  </dd>
                </div>`).join('')}
              </dl>
              <div class="ar-scanline" aria-hidden="true"></div>
              <div class="term ar-term" aria-live="polite"></div>
            </div>
          </div>

          <!-- MUGSHOTS + GAUGE + FINGERPRINT -->
          <div class="ar-col ar-col-side">
            <div class="ar-paper ar-mugs" data-reveal>
              <div class="ar-paper-head mono"><span>MUGSHOT STRIP</span><span>${esc(nick)} PD</span></div>
              ${mugs.length ? `<div class="ar-mug-row">${mugs.map(({ p, i }, k) => `
                <button class="ar-mug" type="button" data-index="${i}" data-id="${p.id}" aria-label="Open ${esc(p.title)} in the evidence viewer">
                  <span class="ar-mug-lines" aria-hidden="true"></span>
                  <img src="${esc(p.thumb || p.url)}" alt="${esc(p.title)}" width="${p.width || 300}" height="${p.height || 400}" loading="lazy">
                  <span class="ar-mug-plate mono">${esc(nick)} PD · ${esc(caseNo)}<br>${MUG_LABELS[k]}</span>
                </button>`).join('')}</div>` : `<div class="ar-mug-empty mono">NO PHOTOS ON FILE<br><span class="muted">subject arrived 5 minutes late to the photo shoot</span></div>`}
            </div>

            <div class="ar-paper ar-threat" data-reveal>
              <div class="ar-paper-head mono"><span>THREAT ASSESSMENT</span><span class="ar-threat-idx">1/${READINGS.length}</span></div>
              <svg class="ar-gauge" viewBox="0 0 220 128" aria-hidden="true">
                <path d="M20 110 A90 90 0 0 1 200 110" class="ar-gtrack"/>
                ${gaugeSegs}
                <g class="ar-needle"><line x1="110" y1="110" x2="110" y2="34"/><circle cx="110" cy="110" r="6"/></g>
              </svg>
              <div class="ar-threat-read" aria-live="polite">
                <span class="ar-threat-label mono">${esc(READINGS[0].label)}</span>
                <span class="ar-threat-val display"><b class="ar-threat-num">0</b>%</span>
                <span class="tag tag-red ar-threat-verdict">${esc(READINGS[0].verdict)}</span>
              </div>
              <button class="btn btn-ghost btn-sm ar-threat-next" type="button">NEXT TARGET →</button>
            </div>

            <div class="ar-paper ar-fp" data-reveal>
              <div class="ar-paper-head mono"><span>BIOMETRICS</span><span>PRINT #01</span></div>
              <div class="ar-fp-box">
                <svg class="ar-fp-svg" viewBox="0 0 160 200" aria-hidden="true">${fingerprint()}</svg>
                <span class="ar-fp-scan" aria-hidden="true"></span>
              </div>
              <p class="ar-fp-read mono"><span class="ar-fp-txt">AWAITING SCAN…</span></p>
            </div>

            <div class="ar-paper ar-sight" data-reveal>
              <div class="ar-paper-head mono"><span>LAST KNOWN SIGHTINGS</span><span>24H</span></div>
              <ol class="ar-sight-list mono">
                ${SIGHTINGS.map(([t, where, what, cls]) => `<li class="${cls}"><span class="ar-sight-t">${esc(t)}</span><span class="ar-sight-w">${esc(where)}</span><span class="ar-sight-x">${esc(what)}</span></li>`).join('')}
              </ol>
            </div>
          </div>
        </div>

        <!-- BARCODE STRIP -->
        <div class="ar-strip" data-reveal aria-hidden="true">
          <svg class="ar-strip-code" viewBox="0 0 ${bc.w} 40" preserveAspectRatio="none">${bc.svg}</svg>
          <div class="ar-strip-txt mono"><span>CASE-${esc(caseNo)}</span><span>SUBJECT: ${esc(val(P.name, 'REDACTED').toUpperCase())}</span><span>DOB: ${esc(bday)}</span><span>STATUS: AT LARGE (PROBABLY ASLEEP)</span><span>FILED: ${esc(String(birthYear))}—PRESENT</span></div>
        </div>
      </div>`;

    // ── refs ───────────────────────────────────────────────────
    const q = (s) => el.querySelector(s), qa = (s) => [...el.querySelectorAll(s)];
    const fields = qa('.ar-field');
    const progFill = q('.ar-prog-fill'), progVal = q('.ar-prog-val'), prog = q('.ar-prog');
    const stampCls = q('.ar-stamp-cls'), stampDec = q('.ar-stamp-dec');
    const scanLabel = q('.ar-scan-txt'), scanline = q('.ar-scanline');
    const term = q('.ar-term');
    const btnDeclassify = q('.ar-declassify'), btnEncrypt = q('.ar-encrypt');
    gsap.set(stampDec, { opacity: 0, scale: 3 });

    // ── decrypt engine ─────────────────────────────────────────
    let seq = 0; // cancels in-flight scrambles
    const scramble = (node, text, duration = 900) => new Promise(resolve => {
      node._seq = (node._seq || 0) + 1; const my = node._seq;
      if (motion.reduced || duration <= 0) { node.textContent = text; return resolve(); }
      const start = performance.now(), len = text.length;
      const step = () => {
        if (node._seq !== my) return resolve();
        const t = Math.min(1, (performance.now() - start) / duration); const done = Math.floor(t * len);
        let out = ''; for (let i = 0; i < len; i++) { const c = text[i]; out += (i < done || c === ' ') ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }
        node.textContent = out;
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      step();
    });
    const updateProgress = () => {
      const n = fields.filter(f => f.classList.contains('is-clear')).length; const pct = Math.round((n / fields.length) * 100);
      progFill.style.width = pct + '%'; progVal.textContent = pct + '%'; prog.setAttribute('aria-valuenow', pct);
      el.classList.toggle('is-clear-all', pct === 100);
    };
    const decryptField = async (f, { duration = 900 } = {}) => {
      if (f.classList.contains('is-clear') || f.classList.contains('is-dec')) return;
      f.classList.remove('is-enc'); f.classList.add('is-dec');
      const txt = f.querySelector('.ar-txt'), st = f.querySelector('.ar-state');
      st.textContent = 'DECRYPTING…'; sfx.play('tick');
      await scramble(txt, txt.dataset.value, duration);
      if (!f.classList.contains('is-dec')) return; // re-encrypted mid-way
      f.classList.remove('is-dec'); f.classList.add('is-clear'); st.textContent = 'CLEAR';
      updateProgress();
    };
    const encryptField = (f) => { const txt = f.querySelector('.ar-txt'); txt._seq = (txt._seq || 0) + 1; txt.textContent = ''; f.classList.remove('is-clear', 'is-dec'); f.classList.add('is-enc'); f.querySelector('.ar-state').textContent = 'ENCRYPTED'; };

    const log = async (line, cls = '') => { const ln = document.createElement('div'); if (cls) ln.className = cls; term.appendChild(ln); while (term.children.length > 4) term.firstChild.remove(); await motion.typewriter(ln, line, { speed: 10, jitter: 8 }); };

    let entered = false, encrypted = false;
    const runDecrypt = async ({ instant = false } = {}) => {
      const mySeq = ++seq; encrypted = false;
      btnEncrypt.setAttribute('aria-pressed', 'false'); btnEncrypt.textContent = 'RE-ENCRYPT';
      scanLabel.textContent = 'DECRYPTING'; scanLabel.parentElement.classList.add('blink');
      if (!instant && !motion.reduced) { sfx.play('scan'); gsap.fromTo(scanline, { top: '0%', opacity: 1 }, { top: '100%', opacity: 0, duration: 2.6, ease: 'none' }); }
      const stagger = instant ? 40 : 170, dur = instant ? 350 : 900;
      const pending = [];
      for (let i = 0; i < fields.length; i++) {
        if (seq !== mySeq) return;
        pending.push(decryptField(fields[i], { duration: dur }));
        if (!motion.reduced) await ctx.wait(stagger);
      }
      await Promise.all(pending);
      if (seq !== mySeq) return;
      scanLabel.parentElement.classList.remove('blink'); scanLabel.textContent = 'ALL FIELDS CLEAR';
    };
    const runEncrypt = () => {
      ++seq; encrypted = true;
      fields.forEach(encryptField); updateProgress();
      btnEncrypt.setAttribute('aria-pressed', 'true'); btnEncrypt.textContent = 'DECRYPT AGAIN';
      scanLabel.parentElement.classList.remove('blink'); scanLabel.textContent = 'ENCRYPTED · HOVER TO PEEK';
      gsap.to(stampDec, { opacity: 0, scale: 1.4, duration: 0.3 }); gsap.to(stampCls, { opacity: 0.92, duration: 0.3 });
      sfx.play('glitch'); log('> re-encryption complete. subject is safe. (he is not.)', 'warn');
    };

    // per-field hover / click / focus reveals
    fields.forEach(f => {
      const btn = f.querySelector('.ar-red');
      const peek = () => { if (f.classList.contains('is-enc')) decryptField(f, { duration: 600 }).then(updateProgress); };
      btn.addEventListener('pointerenter', peek); btn.addEventListener('focus', peek); btn.addEventListener('click', peek);
    });

    // ── buttons ────────────────────────────────────────────────
    btnDeclassify.addEventListener('click', async () => {
      const wasAllClear = el.classList.contains('is-clear-all');
      runDecrypt({ instant: true });
      gsap.to(stampCls, { opacity: 0.35, duration: 0.3 });
      gsap.killTweensOf(stampDec);
      gsap.fromTo(stampDec, { opacity: 0, scale: 3.2, rotate: -2 }, { opacity: 0.95, scale: 1, rotate: -12, duration: 0.32, ease: 'power4.in', onComplete: () => {
        sfx.play('boom'); motion.shake(q('.ar-dossier'), { intensity: 9, duration: 0.45 });
        const r = stampDec.getBoundingClientRect(); fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 26, color: '#ff3b3b', power: 9 });
      } });
      log(wasAllClear ? '> already declassified. stamping again out of spite.' : '> DECLASSIFY ALL authorised by: a friend. no lawyer consulted.', 'bad');
    });
    btnEncrypt.addEventListener('click', () => { if (encrypted) { log('> decrypting again…'); runDecrypt(); } else runEncrypt(); });

    // ── ID card: tilt + flip ───────────────────────────────────
    const card = q('.ar-id'), inner = q('.ar-id-inner'), flipBtn = q('.ar-flip');
    motion.tilt(card, { max: 9, scale: 1.03 });
    let flipped = false;
    const flip = () => { flipped = !flipped; inner.classList.toggle('is-flipped', flipped); flipBtn.setAttribute('aria-pressed', String(flipped)); flipBtn.textContent = flipped ? 'FLIP BACK' : 'FLIP CARD'; sfx.play('whoosh'); };
    card.addEventListener('click', flip); flipBtn.addEventListener('click', (e) => { e.stopPropagation(); flip(); });

    // ── mugshots ───────────────────────────────────────────────
    qa('.ar-mug').forEach(b => b.addEventListener('click', () => { const idx = Number(b.dataset.index); viewer.open(idx); api.event('photo_open', { id: Number(b.dataset.id), from: 'archives' }); }));

    // ── threat gauge ───────────────────────────────────────────
    const needle = q('.ar-needle'), tNum = q('.ar-threat-num'), tLabel = q('.ar-threat-label'), tVerdict = q('.ar-threat-verdict'), tIdx = q('.ar-threat-idx');
    const gauge = { v: 0 }; let reading = 0;
    const setNeedle = () => needle.setAttribute('transform', `rotate(${-90 + gauge.v * 1.8} 110 110)`);
    setNeedle();
    const showReading = (k, { duration = 1.6 } = {}) => {
      const r = READINGS[k]; tLabel.textContent = r.label; tVerdict.textContent = r.verdict; tIdx.textContent = `${k + 1}/${READINGS.length}`;
      tVerdict.className = `tag ar-threat-verdict ${r.v < 30 ? 'tag-pitch' : r.v < 80 ? 'tag-gold' : 'tag-red'}`;
      gsap.killTweensOf(gauge);
      if (motion.reduced) { gauge.v = r.v; setNeedle(); tNum.textContent = r.v; return; }
      gsap.to(gauge, { v: r.v, duration, ease: 'elastic.out(1, 0.55)', onUpdate: () => { setNeedle(); tNum.textContent = Math.round(gauge.v); } });
    };
    q('.ar-threat-next').addEventListener('click', () => { reading = (reading + 1) % READINGS.length; sfx.play('scan'); showReading(reading, { duration: 1.3 }); });

    // ── fingerprint ────────────────────────────────────────────
    const rings = qa('.ar-ring'), fpTxt = q('.ar-fp-txt');
    gsap.set(rings, { opacity: 0 });
    const runFingerprint = async () => {
      gsap.to(rings, { opacity: 1, duration: 0.5, stagger: 0.09, ease: 'power2.out' });
      el.classList.add('is-scanning');
      await log('> biometric scan started…');
      if (!motion.reduced) await ctx.wait(1400);
      fpTxt.textContent = ''; await motion.typewriter(fpTxt, `MATCH 100% · IDENTITY: ${nick.toUpperCase()} · STILL LATE`, { speed: 18 });
      sfx.play('success');
    };

    // ── section entrance ───────────────────────────────────────
    const enter = async () => {
      if (entered) return; entered = true;
      if (motion.reduced) { fields.forEach(f => { const t = f.querySelector('.ar-txt'); t.textContent = t.dataset.value; f.classList.remove('is-enc'); f.classList.add('is-clear'); f.querySelector('.ar-state').textContent = 'CLEAR'; }); updateProgress(); scanLabel.textContent = 'ALL FIELDS CLEAR'; gsap.set(rings, { opacity: 1 }); showReading(0); fpTxt.textContent = `MATCH 100% · IDENTITY: ${nick.toUpperCase()} · STILL LATE`; log('> case file loaded. reduced motion: on. mercy: still off.'); return; }
      log('> accessing subject file… clearance verified: FRIEND.');
      await ctx.wait(400);
      runDecrypt();
      await ctx.wait(900); showReading(0);
      await ctx.wait(700); runFingerprint();
      await ctx.wait(2600); log(`> WARNING: subject last seen "5 minutes ago". that was ${ctx.randInt(40, 90)} minutes ago.`, 'warn');
    };
    ctx.onSectionEnter(el, () => ctx.onEnter(enter));

    // parallax the watermark a touch
    motion.parallax(q('.ar-watermark'), { speed: 0.25 });
  },
};
