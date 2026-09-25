// HUD: scroll progress, brand, nav drawer, sound + motion toggles, egg counter.
import { state, esc } from './state.js';
import { sfx } from './sfx.js';
import { motion } from './motion.js';
import { el } from './ui.js';
import { api } from './api.js';

const gsap = window.gsap;

export function buildHud(sections) {
  const hud = document.getElementById('hud');
  hud.innerHTML = `
    <div class="hud-bar"><i></i></div>
    <div class="hud-inner">
      <a class="hud-brand" href="#hero"><span class="dot">●</span> SIR ARCHIVES</a>
      <div class="hud-right">
        <button class="hud-btn hud-eggs" type="button" title="Easter eggs found"><span class="ico">🥚</span><span class="lbl"><b>${state.eggsFound.size}</b>/${state.eggsTotal}</span></button>
        <button class="hud-btn hud-motion" type="button" aria-pressed="${motion.reduced}" title="Reduce motion"><span class="ico">${motion.reduced ? '🐢' : '⚡'}</span><span class="lbl">MOTION</span></button>
        <button class="hud-btn hud-sound" type="button" aria-pressed="${sfx.enabled}" title="Toggle sound"><span class="ico">${sfx.enabled ? '🔊' : '🔇'}</span><span class="lbl">SOUND</span></button>
        <button class="hud-btn hud-menu" type="button" aria-expanded="false" aria-controls="nav"><span class="ico">☰</span><span class="lbl">INDEX</span></button>
      </div>
    </div>`;
  // nav drawer
  const nav = el(`<div id="nav" class="nav" aria-hidden="true"><div class="nav-backdrop"></div><nav class="nav-panel" aria-label="Case file index">
      <div class="nav-head"><span>CASE FILE INDEX</span><button class="hud-btn nav-close" type="button">CLOSE ✕</button></div>
      <div class="nav-list">${sections.filter(s => s.nav !== false).map((s, i) => `<button class="nav-item" type="button" data-target="${s.id}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(s.title)}</span><span class="seen"></span></button>`).join('')}</div>
      <div class="nav-foot">Visitors: <b class="nav-visitors">${state.stats.visitors ?? 0}</b> · Roasts generated: <b class="nav-roasts">${state.stats.roasts_generated ?? 0}</b><br>Press <b>R</b> in the evidence viewer for random evidence. Type <b>?</b> for hints.</div></nav></div>`);
  document.body.appendChild(nav);
  const menuBtn = hud.querySelector('.hud-menu');
  const setOpen = (o) => { nav.classList.toggle('open', o); nav.setAttribute('aria-hidden', !o); menuBtn.setAttribute('aria-expanded', o); if (o) nav.querySelector('.nav-item')?.focus(); };
  menuBtn.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.querySelector('.nav-close').addEventListener('click', () => setOpen(false));
  nav.querySelector('.nav-backdrop').addEventListener('click', () => setOpen(false));
  nav.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => { setOpen(false); motion.scrollTo('#' + b.dataset.target); }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) setOpen(false); });
  hud.querySelector('.hud-brand').addEventListener('click', (e) => { e.preventDefault(); motion.scrollTo('#hero'); });

  // sound / motion
  const soundBtn = hud.querySelector('.hud-sound');
  const syncSound = () => { soundBtn.setAttribute('aria-pressed', sfx.enabled); soundBtn.querySelector('.ico').textContent = sfx.enabled ? '🔊' : '🔇'; };
  soundBtn.addEventListener('click', async () => { await sfx.toggle(); syncSound(); api.event('sound_toggle', { on: sfx.enabled }); });
  sfx.onChange(syncSound);
  const motionBtn = hud.querySelector('.hud-motion');
  motionBtn.addEventListener('click', () => { motion.setReduced(!motion.reduced); motionBtn.setAttribute('aria-pressed', motion.reduced); motionBtn.querySelector('.ico').textContent = motion.reduced ? '🐢' : '⚡'; });

  // eggs counter
  const eggsBtn = hud.querySelector('.hud-eggs');
  state.on('egg', ({ found, total }) => { eggsBtn.querySelector('.lbl').innerHTML = `<b>${found}</b>/${total}`; gsap.fromTo(eggsBtn, { scale: 1.25 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.4)' }); });
  eggsBtn.addEventListener('click', () => motion.scrollTo('#ending'));

  // progress bar + active section
  const bar = hud.querySelector('.hud-bar i');
  let ticking = false;
  const update = () => { ticking = false; const max = document.documentElement.scrollHeight - innerHeight; bar.style.width = `${Math.min(100, Math.max(0, (scrollY / Math.max(1, max)) * 100))}%`; };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true }); update();
  state.on('section', (id) => { nav.querySelectorAll('.nav-item').forEach(b => { b.classList.toggle('active', b.dataset.target === id); if (state.sectionsSeen.has(b.dataset.target)) b.classList.add('seen'); }); });
  state.on('stats', (s) => { const v = nav.querySelector('.nav-visitors'), r = nav.querySelector('.nav-roasts'); if (v) v.textContent = s.visitors ?? 0; if (r) r.textContent = s.roasts_generated ?? 0; });
}
