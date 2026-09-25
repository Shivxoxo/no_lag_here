// ══════════════════════════════════════════════════════════════
//  THE SIR ARCHIVES — application bootstrap
//  Order: core init → visitor session → bootstrap data → intro overlay
//  (plays while sections mount) → HUD → sections → observers.
// ══════════════════════════════════════════════════════════════
import { api } from './core/api.js';
import { state, esc, wait, pick, rand, randInt, shuffle, clamp } from './core/state.js';
import { sfx } from './core/sfx.js';
import { motion } from './core/motion.js';
import { eggs } from './core/eggs.js';
import { viewer } from './core/viewer.js';
import { fx } from './core/particles.js';
import { toast, cine, el, blocks } from './core/ui.js';
import { runIntro } from './core/intro.js';
import { buildHud } from './core/hud.js';
import { initExtras } from './core/extras.js';

import hero from './sections/hero.js';
import archives from './sections/archives.js';
import scouting from './sections/scouting.js';
import pass from './sections/pass.js';
import nationals from './sections/nationals.js';
import awards from './sections/awards.js';
import gaming from './sections/gaming.js';
import anime from './sections/anime.js';
import academics from './sections/academics.js';
import gym from './sections/gym.js';
import food from './sections/food.js';
import roast from './sections/roast.js';
import evidence from './sections/evidence.js';
import timeline from './sections/timeline.js';
import boss from './sections/boss.js';
import ai from './sections/ai.js';
import compliment from './sections/compliment.js';
import cake from './sections/cake.js';
import messages from './sections/messages.js';
import ending from './sections/ending.js';

const SECTIONS = [hero, archives, scouting, pass, nationals, awards, gaming, anime, academics, gym, food, roast, evidence, timeline, boss, ai, compliment, cake, messages, ending];

// Used only if the API is unreachable (static hosting demo) so the page still renders.
const FALLBACK = {
  profile: { name: 'Shreaysh Shenal Munda', first_name: 'Shreaysh', nickname: 'SIR', age: 16, birthday: '2026-09-26', position: 'Midfielder', codename: 'SIR', known_weakness: 'Perfect passes', primary_habit: 'Being late', secondary_habit: 'Watching anime', combat_class: 'Professional Procrastinator', favourite_food: 'Biryani', games: 'Free Fire, BGMI', hero_photo: 'photo14.jpg', made_by: 'Shiv', friends: ['Shiv', 'Alex', 'Jason'], tagline: 'Unfortunately, you survived another year.' },
  photos: [], timeline: [], awards: [], settings: {}, stats: {}, easter_eggs: [], roast_count: 0, offline: true,
};

async function boot() {
  motion.init(); sfx.init(); sfx.bind(document); viewer.init(); eggs.init();

  await api.visit();
  let data;
  try { data = await api.bootstrap(); } catch (e) { console.warn('[boot] API unreachable, using fallback content', e); data = FALLBACK; }
  state.setBootstrap(data);
  if (data.offline) toast.show({ icon: '⚠️', title: 'Backend offline', body: 'Roast stats, scores and messages will not be saved.', duration: 6000 });

  const ctx = {
    state, data, profile: state.profile, settings: state.settings, photos: state.photos,
    api, sfx, eggs, fx, viewer, motion, toast, cine, el, blocks, esc, wait, pick, rand, randInt, shuffle, clamp,
    gsap: window.gsap, ScrollTrigger: window.ScrollTrigger,
    scrollTo: (target) => motion.scrollTo(target),
    /** run fn once the visitor has entered the site (after the intro) */
    onEnter: (fn) => { if (state.entered) fn(); else state.on('enter', fn); },
    /** run fn the first time a section scrolls into view */
    onSectionEnter: (sectionEl, fn) => motion.onEnter(sectionEl, fn, { rootMargin: '0px 0px -20% 0px' }),
  };

  runIntro({ profile: state.profile, settings: state.settings, onEnter: () => { state.entered = true; state.emit('enter'); window.ScrollTrigger.refresh(); } });
  buildHud(SECTIONS);

  for (const s of SECTIONS) {
    const host = document.getElementById(s.id);
    if (!host) { console.warn('[boot] missing mount for', s.id); continue; }
    try { await s.mount(host, ctx); }
    catch (e) {
      console.error(`[section:${s.id}]`, e);
      host.innerHTML = `<div class="container"><div class="glass panel"><span class="eyebrow">SECTION ERROR</span><p class="mono muted" style="margin-top:10px">${esc(s.id)} failed to load: ${esc(e.message)}</p></div></div>`;
    }
  }
  motion.reveal(document.getElementById('app'));
  try { initExtras(); } catch (e) { console.error('[extras]', e); }

  // Section view tracking (analytics + HUD active state)
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const id = en.target.dataset.section;
      state.emit('section', id);
      if (!state.sectionsSeen.has(id)) { state.sectionsSeen.add(id); api.event('section_view', { section: id }); if (id === 'ending') api.event('reached_end'); }
    }
  }, { threshold: 0.35 });
  document.querySelectorAll('.sec').forEach(s => io.observe(s));

  // Keep ScrollTrigger measurements correct as fonts/images/videos load
  const refresh = () => window.ScrollTrigger.refresh();
  window.addEventListener('load', refresh);
  document.fonts?.ready.then(refresh);
  setTimeout(refresh, 1500);

  // Live stats every 60s (visitors, roasts...) for HUD + ending
  setInterval(async () => { try { const s = await api.stats(); state.stats = s; state.emit('stats', s); } catch { /* offline */ } }, 60_000);

  // "?" shows a random easter-egg hint
  window.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.target.closest('input, textarea')) return;
    const left = (state.data.easter_eggs || []).filter(x => !state.eggsFound.has(x.key));
    if (!left.length) return toast.show({ icon: '👑', title: 'Nothing left to find.' });
    toast.show({ icon: '💡', title: 'HINT', body: pick(left).hint, duration: 5000 });
  });
}

boot().catch(err => {
  console.error('[boot] fatal', err);
  document.getElementById('boot').innerHTML = `<div class="boot-inner"><div class="boot-title">BRAIN.EXE <span class="acc">CRASHED</span></div><p class="mono">${esc(err.message)}</p><p class="mono muted">Reload the page. If it keeps happening, blame SIR.</p></div>`;
});
