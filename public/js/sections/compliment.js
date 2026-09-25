// 17 · MERCY PROTOCOL — exactly one compliment. Everything freezes for it.
export default {
  id: 'compliment',
  title: 'One Compliment',
  mount(el, ctx) {
    const { settings, esc, gsap, ScrollTrigger, sfx, fx, motion, api, wait, toast, cine } = ctx;

    if (settings.compliment_enabled === false) {
      el.innerHTML = `
        <div class="container-narrow center compliment-wrap">
          <h2 class="sr-only">One Compliment</h2>
          <p class="compliment-disabled mono muted">Compliment module disabled by the administration.</p>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="compliment-line" aria-hidden="true"><svg viewBox="0 0 1200 60" preserveAspectRatio="none"><path class="compliment-ecg" d="M0 30 H180 L200 30 L212 6 L226 54 L238 30 H1200"/></svg></div>
      <div class="container-narrow center compliment-wrap">
        <h2 class="sr-only">One Compliment</h2>
        <span class="eyebrow compliment-eyebrow" data-reveal>MERCY PROTOCOL · USE ONCE</span>
        <p class="lead compliment-lead" data-reveal>The system has been begging us for this. We are not proud.</p>
        <div class="compliment-stage" data-reveal>
          <button class="btn btn-lg compliment-btn" type="button" aria-live="polite">FINE. GIVE HIM ONE COMPLIMENT.</button>
        </div>
        <p class="compliment-quota mono muted" data-reveal>QUOTA REMAINING: <b class="compliment-quota-n">1</b> / 1 · SIDE EFFECTS MAY INCLUDE HIM KNOWING</p>
      </div>`;

    const btn = el.querySelector('.compliment-btn');
    const quotaN = el.querySelector('.compliment-quota-n');
    const ORIGINAL = btn.textContent;
    let armed = false, armTimer = 0, used = false, running = false;

    const disarm = () => { armed = false; clearTimeout(armTimer); btn.classList.remove('is-armed'); btn.textContent = ORIGINAL; };

    btn.addEventListener('click', async () => {
      if (used || running) return;
      if (!armed) {
        armed = true; btn.classList.add('is-armed'); btn.textContent = 'ARE YOU SURE? THIS CANNOT BE UNDONE.';
        sfx.play('error');
        if (!motion.reduced) gsap.fromTo(btn, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
        armTimer = setTimeout(disarm, 4000);
        return;
      }
      // second click: proceed
      clearTimeout(armTimer); running = true; used = true;
      btn.classList.remove('is-armed'); btn.classList.add('is-running'); btn.textContent = 'EXECUTING MERCY…';
      api.event('compliment');

      // 1) freeze: audio + cinematic starts (cine fades itself in with gsap, so we must not
      //    pause the global timeline). We pause every other running gsap animation + CSS
      //    animations ~700 ms later, once cine's own fade tween is done.
      sfx.freeze();
      const cinePromise = cine.play(
        ['After extensive analysis...', "...he's actually a pretty good friend.", "Don't tell him I said that."],
        { hold: 1900, sub: 'THIS MOMENT WILL BE DENIED IN COURT' },
      );
      await wait(700);
      const cineHost = document.getElementById('cine');
      const isCineTween = (tw) => { const t = tw.targets ? tw.targets() : []; return t.some(x => x && x.nodeType === 1 && cineHost && cineHost.contains(x)); };
      // pause ScrollTrigger-driven animations that are actively playing
      const pausedST = ScrollTrigger.getAll().map(t => t.animation).filter(a => a && !a.paused() && a.isActive());
      pausedST.forEach(a => a.pause());
      // pause every other active tween/timeline (except cine's) — hero/idle loops etc.
      const pausedTw = gsap.globalTimeline.getChildren(true, true, true).filter(a => a.isActive() && !a.paused() && !isCineTween(a) && !pausedST.includes(a));
      pausedTw.forEach(a => a.pause());
      document.body.classList.add('is-compliment');

      await Promise.race([cinePromise, wait(25000)]); // safety: never leave the page frozen

      // 2) IMMEDIATELY back to chaos
      document.body.classList.remove('is-compliment');
      pausedST.forEach(a => a.play());
      pausedTw.forEach(a => a.play());
      sfx.unfreeze();
      sfx.play('glitch');
      fx.confetti({ count: 160 });
      motion.shake(document.body);
      toast.show({ icon: '🔥', title: 'Back to roasting.', body: 'That never happened.' });

      btn.disabled = true; btn.classList.remove('is-running'); btn.classList.add('is-spent');
      btn.textContent = 'COMPLIMENT QUOTA EXCEEDED (1/1)';
      quotaN.textContent = '0';
      el.classList.add('is-spent');
      if (!motion.reduced) gsap.fromTo(el.querySelector('.compliment-quota'), { color: '#ff3b3b' }, { color: '', duration: 1.5 });
      running = false;
    });

    // escape disarms
    btn.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) disarm(); });
    btn.addEventListener('blur', () => { if (armed) disarm(); });
  },
};
