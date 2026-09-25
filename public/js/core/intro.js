// 00 · SYSTEM INITIALIZATION — full-screen boot sequence shown before the site.
import { esc, wait } from './state.js';
import { sfx } from './sfx.js';
import { motion } from './motion.js';
import { api } from './api.js';

const gsap = window.gsap;

export function runIntro({ profile, settings, onEnter }) {
  const host = document.getElementById('boot');
  const name = (profile?.name || 'SHREAYSH SHENAL MUNDA').toUpperCase();
  const skipAllowed = settings?.intro_skip_allowed !== false;
  host.innerHTML = `
    <div class="boot-grid"></div><div class="boot-scan"></div>
    ${skipAllowed ? '<button class="boot-skip" type="button">SKIP ▸</button>' : ''}
    <div class="boot-inner">
      <div class="boot-log" aria-live="polite"></div>
      <div class="boot-title" hidden></div>
      <div class="boot-warning" hidden><div class="w-title">⚠ WARNING</div><p>THIS WEBSITE CONTAINS EXTREME LEVELS OF FRIENDSHIP-BASED ROASTING.</p><p class="muted mono" style="font-size:.8rem;margin-top:8px">Side effects may include: laughing, denial, and saying "bro what the hell".</p></div>
      <div class="boot-actions" hidden>
        <button class="btn btn-lg boot-enter" type="button" style="--accent:var(--acid);--accent-rgb:198,255,61">ENTER THE SIR ARCHIVES</button>
        <button class="hud-btn boot-sound" type="button" aria-pressed="${sfx.enabled}"><span class="ico">${sfx.enabled ? '🔊' : '🔇'}</span><span class="lbl">SOUND ${sfx.enabled ? 'ON' : 'OFF'}</span></button>
      </div>
    </div>
    <div class="boot-wipe"></div>`;
  const log = host.querySelector('.boot-log'); const title = host.querySelector('.boot-title'); const warn = host.querySelector('.boot-warning'); const actions = host.querySelector('.boot-actions');
  const soundBtn = host.querySelector('.boot-sound');
  soundBtn.addEventListener('click', async () => { await sfx.toggle(); soundBtn.setAttribute('aria-pressed', sfx.enabled); soundBtn.querySelector('.ico').textContent = sfx.enabled ? '🔊' : '🔇'; soundBtn.querySelector('.lbl').textContent = `SOUND ${sfx.enabled ? 'ON' : 'OFF'}`; });

  let cancelled = false;
  const line = async (html, delay = 260) => { if (cancelled) return; const ln = document.createElement('div'); ln.className = 'ln'; ln.innerHTML = html; log.appendChild(ln); await wait(20); ln.classList.add('in'); sfx.play('tick'); await wait(motion.reduced ? 40 : delay); };
  const diag = (k, v, cls = '') => `<span class="k">${k}</span> <span class="v ${cls}">${v}</span>`;

  async function sequence() {
    await wait(400);
    await line('<span class="k">&gt;</span> SYSTEM INITIALIZATION', 700);
    await line(diag('&gt; loading modules ......', 'OK', 'ok'), 220);
    await line(diag('&gt; scanning area ........', 'SUBJECT DETECTED', 'warn'), 700);
    await line(diag('&gt; IDENTITY:', esc(name)), 800);
    await line(diag('&gt; COMMON SENSE:', 'ANALYZING...'), 500);
    await line(diag('&gt; DECISION MAKING:', 'UNSTABLE', 'warn'), 380);
    await line(diag('&gt; PASS ACCURACY:', 'QUESTIONABLE', 'warn'), 380);
    await line(diag('&gt; PROCRASTINATION:', 'CRITICAL', 'bad'), 380);
    await line(diag('&gt; ANIME CONSUMPTION:', 'EXTREME', 'bad'), 380);
    await line(diag('&gt; BIRYANI PROXIMITY:', 'ALWAYS WITHIN RANGE', 'ok'), 380);
    await line(diag('&gt; BRAIN.EXE:', 'RESPONDING...'), 900);
    if (cancelled) return;
    log.querySelectorAll('.v').forEach(v => { if (v.textContent === 'RESPONDING...') v.textContent = 'RESPONDING (SLOWLY)'; });
    await wait(300);
    title.hidden = false; title.innerHTML = `SUBJECT <span class="acc">ACQUIRED</span>`;
    gsap.fromTo(title, { opacity: 0, y: 16, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out' });
    sfx.play('glitch');
    await wait(motion.reduced ? 100 : 700);
    warn.hidden = false; gsap.fromTo(warn, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' }); sfx.play('error');
    await wait(motion.reduced ? 100 : 600);
    actions.hidden = false; gsap.fromTo(actions, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 });
    host.querySelector('.boot-enter').focus({ preventScroll: true });
  }
  function reveal() { cancelled = true; title.hidden = false; title.innerHTML = `SUBJECT <span class="acc">ACQUIRED</span>`; warn.hidden = false; actions.hidden = false; gsap.set([title, warn, actions], { opacity: 1, clearProps: 'transform' }); }
  host.querySelector('.boot-skip')?.addEventListener('click', reveal);
  sequence();

  host.querySelector('.boot-enter').addEventListener('click', async () => {
    const btn = host.querySelector('.boot-enter'); btn.disabled = true;
    sfx.play('power'); api.event('intro_complete');
    const wipe = host.querySelector('.boot-wipe');
    if (motion.reduced) { host.remove(); document.body.classList.remove('is-booting'); onEnter?.(); return; }
    const tl = gsap.timeline({ onComplete: () => { host.remove(); wipe.remove(); } });
    tl.to(host.querySelector('.boot-inner'), { opacity: 0, scale: 1.06, filter: 'blur(10px)', duration: 0.45, ease: 'power2.in' })
      .to(wipe, { scaleY: 1, duration: 0.5, ease: 'power4.inOut' }, '-=0.1')
      .add(() => { document.body.classList.remove('is-booting'); window.scrollTo(0, 0); onEnter?.(); })
      .set(wipe, { transformOrigin: 'top' })
      .to(wipe, { scaleY: 0, duration: 0.7, ease: 'power4.inOut', delay: 0.05 });
  });
}
