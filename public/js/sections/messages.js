// 19 · MESSAGES — intercepted-comms console: a real birthday message wall.
const PLAYER_KEY = 'sir.player';
const PAGE = 12;
const pad = (n) => String(n).padStart(2, '0');

/** SQLite gives "YYYY-MM-DD HH:MM:SS" (UTC, no zone); the POST reply gives ISO. Render local. */
function fmtTime(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(raw);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default {
  id: 'messages',
  title: 'Transmissions',
  mount(el, ctx) {
    const { settings, esc, gsap, sfx, fx, motion, api, profile } = ctx;
    const nick = (profile.nickname || 'SIR').toUpperCase();

    if (settings.show_messages_wall === false) {
      el.innerHTML = `<div class="container msg-wrap"><div class="sec-head"><span class="eyebrow">INTERCEPTED COMMS</span><h2 class="display h1">TRANSMISSIONS</h2></div><p class="mono muted msg-disabled">▌ Transmissions disabled. The channel has gone dark.</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="msg-grid-bg" aria-hidden="true"></div>
      <div class="container msg-wrap">
        <div class="sec-head msg-head">
          <span class="eyebrow">INTERCEPTED COMMS · FREQ 16.0 MHz</span>
          <h2 class="display h1 msg-title" data-reveal>TRANSMISSIONS</h2>
          <div class="msg-wave-box" data-reveal>
            <svg class="msg-wave" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
              <polyline class="msg-wave-line" points=""/>
              <polyline class="msg-wave-line msg-wave-line-2" points=""/>
            </svg>
            <div class="msg-meta mono">
              <span><b>CHANNEL:</b> ${esc(nick)}-BDAY</span>
              <span><b>ENCRYPTION:</b> none (he'll never find it)</span>
              <span><b>STATUS:</b> <span class="msg-status"><span class="dot"></span> LISTENING</span></span>
            </div>
          </div>
          <p class="lead" data-reveal>Leave ${esc(nick)} a birthday transmission. Roast, wish, threaten to pass him the ball — it all goes on the record.</p>
        </div>

        <div class="msg-layout">
          <form class="msg-form glass panel" data-reveal novalidate>
            <div class="msg-form-head mono"><span class="dot pulse"></span> NEW TRANSMISSION</div>
            <label class="msg-field">
              <span class="mono">CALLSIGN</span>
              <input class="msg-name" name="name" type="text" maxlength="40" required autocomplete="nickname" placeholder="Your name (or alias)">
            </label>
            <label class="msg-field">
              <span class="mono">MESSAGE <span class="msg-counter tabular" aria-live="polite">0/500</span></span>
              <textarea class="msg-text" name="message" maxlength="500" required rows="5" placeholder="Happy birthday ${esc(nick)}. Now pass the ball."></textarea>
            </label>
            <p class="msg-error mono" role="alert" hidden></p>
            <p class="msg-notice mono" role="status" hidden></p>
            <div class="msg-form-foot">
              <button class="btn msg-send" type="submit"><span class="msg-send-label">TRANSMIT ▸</span></button>
              <span class="mono muted msg-rules">no links · 500 chars · zero mercy</span>
            </div>
          </form>

          <div class="msg-wall" data-reveal>
            <div class="msg-wall-head mono">
              <span class="msg-wall-title"><span class="msg-rec">●</span> INCOMING · <b class="msg-n tabular">0</b> RECEIVED</span>
              <button class="btn btn-ghost btn-sm msg-refresh" type="button">↻ REFRESH</button>
            </div>
            <ul class="msg-list" aria-live="polite" aria-label="Birthday transmissions"></ul>
            <p class="msg-empty mono" hidden>▌ No transmissions yet. Be the first to roast him.</p>
            <p class="msg-loading mono" hidden><span class="blink">▌</span> scanning frequencies…</p>
            <div class="msg-more-wrap"><button class="btn btn-ghost msg-more" type="button" hidden>LOAD ALL</button></div>
          </div>
        </div>
      </div>`;

    const form = el.querySelector('.msg-form');
    const nameIn = el.querySelector('.msg-name'), textIn = el.querySelector('.msg-text');
    const counter = el.querySelector('.msg-counter'), errEl = el.querySelector('.msg-error'), noteEl = el.querySelector('.msg-notice');
    const sendBtn = el.querySelector('.msg-send'), sendLabel = el.querySelector('.msg-send-label');
    const list = el.querySelector('.msg-list'), empty = el.querySelector('.msg-empty'), loading = el.querySelector('.msg-loading');
    const more = el.querySelector('.msg-more'), nEl = el.querySelector('.msg-n'), status = el.querySelector('.msg-status');

    try { const saved = localStorage.getItem(PLAYER_KEY); if (saved) nameIn.value = saved.slice(0, 40); } catch { /* ignore */ }

    // ── waveform header ───────────────────────────────────────
    const lines = [el.querySelector('.msg-wave-line'), el.querySelector('.msg-wave-line-2')];
    let waveAmp = 1, waveT = 0, waveRunning = false, waveRaf = 0;
    function drawWave(t) {
      for (let k = 0; k < 2; k++) {
        const pts = [];
        for (let x = 0; x <= 1200; x += 12) {
          const env = Math.sin((x / 1200) * Math.PI);
          const y = 60 + env * waveAmp * (Math.sin(x * 0.02 + t * (1.6 + k * 0.7) + k) * 22 + Math.sin(x * 0.051 - t * 2.3 + k * 2) * 12 + Math.sin(x * 0.11 + t * 4.1) * 6);
          pts.push(`${x},${y.toFixed(1)}`);
        }
        lines[k].setAttribute('points', pts.join(' '));
      }
    }
    function waveLoop() { waveRaf = 0; if (!waveRunning) return; waveT += 0.016; drawWave(waveT); waveRaf = requestAnimationFrame(waveLoop); }
    drawWave(1.3);
    if (!motion.reduced) motion.onVisible(el, (vis) => { waveRunning = vis; if (vis && !waveRaf) waveRaf = requestAnimationFrame(waveLoop); });
    const spike = () => { if (motion.reduced) return; const o = { a: 2.4 }; gsap.to(o, { a: 1, duration: 1.2, ease: 'power2.out', onUpdate: () => { waveAmp = o.a; } }); };

    // ── wall ──────────────────────────────────────────────────
    let all = [], expanded = false;
    const card = (m, newest) => `
      <li class="msg-card ${newest ? 'is-newest' : ''}" data-id="${esc(m.id ?? '')}">
        <div class="msg-avatar" aria-hidden="true">${esc((String(m.name || '?').trim()[0] || '?').toUpperCase())}</div>
        <div class="msg-body">
          <div class="msg-card-head mono"><span class="msg-from">${esc(m.name)}</span><time datetime="${esc(m.created_at || '')}">RECEIVED ${esc(fmtTime(m.created_at))}</time></div>
          <p class="msg-content">${esc(m.message)}${newest ? '<span class="msg-cursor" aria-hidden="true"></span>' : ''}</p>
        </div>
      </li>`;
    function render({ animate = true } = {}) {
      const shown = expanded ? all : all.slice(0, PAGE);
      list.innerHTML = shown.map((m, i) => card(m, i === 0)).join('');
      empty.hidden = all.length > 0;
      more.hidden = expanded || all.length <= PAGE;
      more.textContent = `LOAD ALL (${all.length})`;
      nEl.textContent = all.length;
      if (animate && shown.length) gsap.fromTo(list.children, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.55, stagger: 0.05, ease: 'power3.out', clearProps: 'transform' });
    }
    async function load() {
      loading.hidden = false; empty.hidden = true; status.innerHTML = '<span class="dot"></span> SCANNING';
      try {
        const res = await api.messages();
        all = Array.isArray(res) ? res : [];
        render();
        status.innerHTML = '<span class="dot"></span> LISTENING';
      } catch (e) {
        status.innerHTML = '<span class="dot"></span> OFFLINE';
        empty.hidden = false; empty.textContent = '▌ Channel unreachable. The backend is asleep — like SIR at 2pm.';
      } finally { loading.hidden = true; }
    }
    let loaded = false;
    ctx.onSectionEnter(el, () => { if (!loaded) { loaded = true; load(); } });
    el.querySelector('.msg-refresh').addEventListener('click', () => { spike(); load(); });
    more.addEventListener('click', () => { expanded = true; render({ animate: false }); const extra = [...list.children].slice(PAGE); if (extra.length) gsap.fromTo(extra, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.04, ease: 'power3.out', clearProps: 'transform' }); });

    // ── form ──────────────────────────────────────────────────
    const updateCounter = () => { const n = textIn.value.length; counter.textContent = `${n}/500`; counter.classList.toggle('is-hot', n >= 450); };
    textIn.addEventListener('input', updateCounter);
    const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; noteEl.hidden = true; sfx.play('error'); motion.shake(form, { intensity: 5, duration: 0.35 }); };
    const clearErr = () => { errEl.hidden = true; };
    nameIn.addEventListener('input', clearErr); textIn.addEventListener('input', clearErr);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim(), message = textIn.value.trim();
      if (!name) { showErr('Callsign required. Anonymous roasts are for cowards.'); nameIn.focus(); return; }
      if (message.length < 2) { showErr('Message required. Even "happy birthday" would do.'); textIn.focus(); return; }
      if (/https?:\/\//i.test(message)) { showErr('Links are not allowed in messages'); textIn.focus(); return; }
      sendBtn.disabled = true; sendLabel.textContent = 'TRANSMITTING'; sendBtn.classList.add('is-sending'); clearErr(); noteEl.hidden = true;
      status.innerHTML = '<span class="dot"></span> TRANSMITTING'; spike();
      try {
        const res = await api.sendMessage(name, message);
        try { localStorage.setItem(PLAYER_KEY, name); } catch { /* ignore */ }
        textIn.value = ''; updateCounter();
        sfx.play('success');
        const r = sendBtn.getBoundingClientRect();
        fx.confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 50, colors: ['#38e8ff', '#ffffff', '#2ee56b', '#c6ff3d'], power: 9 });
        if (res && res.approved === false) {
          noteEl.textContent = '▌ Transmission received. Awaiting clearance.'; noteEl.hidden = false;
        } else {
          const m = { id: res?.id, name: res?.name ?? name, message: res?.message ?? message, created_at: res?.created_at || new Date().toISOString() };
          all.unshift(m);
          list.querySelector('.is-newest')?.classList.remove('is-newest');
          list.querySelector('.msg-cursor')?.remove();
          list.insertAdjacentHTML('afterbegin', card(m, true));
          const node = list.firstElementChild;
          empty.hidden = true; nEl.textContent = all.length;
          if (!expanded && list.children.length > PAGE) { list.lastElementChild.remove(); more.hidden = false; more.textContent = `LOAD ALL (${all.length})`; }
          gsap.fromTo(node, { opacity: 0, x: -40, scale: 0.97 }, { opacity: 1, x: 0, scale: 1, duration: 0.7, ease: 'power4.out', clearProps: 'transform' });
          node.classList.add('is-glow'); setTimeout(() => node.classList.remove('is-glow'), 2600);
          noteEl.textContent = '▌ Transmission logged. He can never delete it.'; noteEl.hidden = false;
        }
      } catch (err) {
        if (err.status === 429) showErr('Slow down, transmitter. Even SIR is faster than this.');
        else showErr(err.message || 'Transmission failed. The channel is haunted.');
      } finally {
        sendBtn.disabled = false; sendLabel.textContent = 'TRANSMIT ▸'; sendBtn.classList.remove('is-sending');
        status.innerHTML = '<span class="dot"></span> LISTENING';
      }
    });
  },
};
