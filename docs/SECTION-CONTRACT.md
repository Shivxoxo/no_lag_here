# Section contract — THE SIR ARCHIVES

Every big section of the site is an independent ES module + a CSS file. This
document is the contract each section follows. Read it fully before building.

## Files

- JS:  `public/js/sections/<id>.js`  (ES module, default export)
- CSS: `public/css/sections/<id>.css` (already linked from index.html; every selector MUST be scoped under `.sec-<id>` — e.g. `.sec-boss .boss-hp {}` — never style global tags)
- Mount point already exists in `public/index.html`: `<section id="<id>" class="sec sec-<id>" data-section="<id>">`
- Do NOT edit `index.html`, `main.js`, `base.css`, `hud.css` or anything in `js/core/`. If you need a core change, describe it in your final report.
- Do NOT run `npm install`. Dependencies are installed. Do not commit.

## Module shape

```js
export default {
  id: 'scouting',
  title: 'Scouting Report',   // shown in the HUD index drawer
  nav: true,                  // optional, default true
  mount(el, ctx) {            // may be async
    el.innerHTML = `...`;     // build your DOM (use ctx.esc() for any data strings)
    // wire up animations/interactions
  },
};
```

`mount` runs once at boot, BEFORE the visitor clicks "ENTER" on the intro. So:
- Don't autoplay sounds / heavy timelines in mount. Use `ctx.onEnter(fn)` (fires when the site is entered) and `ctx.onSectionEnter(el, fn)` (fires the first time your section scrolls into view; use this to start the section's main animation / counters / typewriters).
- Heavy Three.js scenes: create them inside `ctx.onSectionEnter` or `motion.onEnter(el, ...)` so the page boots fast. `createScene()` already pauses rendering when off-screen.

## `ctx` (everything you get)

| key | what |
|---|---|
| `profile` | `{ name, first_name, nickname, age, birthday, position, codename, known_weakness, primary_habit, secondary_habit, combat_class, favourite_food, games, hero_photo, made_by, friends[], tagline }` — always use these instead of hardcoding the name/age. |
| `settings` | public settings: `boss_max_hp, boss_click_damage, boss_regen_per_sec, boss_time_limit_sec, show_messages_wall, compliment_enabled, hero_photo, video_evidence, sound_default` |
| `photos` | `[{ id, src, url, thumb, title, caption, tags[], width, height }]` (16 photos currently; treat as any length ≥ 0) |
| `data` | full bootstrap payload: also `data.timeline[]`, `data.awards[]`, `data.easter_eggs[]`, `data.stats`, `data.roast_count` |
| `state` | shared store: `state.stats`, `state.eggsFound` (Set), `state.on('stats'|'egg'|'enter'|'section', fn)` |
| `api` | `api.roast(topic?)`, `api.roastHistory(n)`, `api.messages()`, `api.sendMessage(name,msg)`, `api.submitScore({game,score,won,duration_ms,player,meta})`, `api.scores(game,limit)`, `api.stats()`, `api.event(type, meta)` (fire-and-forget). Allowed event types: `pass_attempt, gaming_analyze, anime_recommend, compliment, cake_blown, cake_click, boss_start, boss_win, boss_lose, photo_open, random_evidence, ai_run, gym_load, food_scan, video_play`. |
| `sfx` | `sfx.play(name)` — names: `click hover tick type pop whoosh boom hit glitch error success fanfare egg kick whistle crowd laser blow confetti birthday power scan`. `sfx.freeze()/unfreeze()` (compliment). Never required for the section to work. |
| `eggs` | `eggs.unlock('key')` (handles toast + API + confetti), `eggs.onUnlock('key', fn)` to register your section's UNIQUE animation for that egg. |
| `fx` | global particle canvas: `fx.confetti({x,y,count,colors,power})`, `fx.burst({x,y,count,color,power})`, `fx.emoji({emoji:'⚽'|[...], count, rise})`, `fx.rain({emoji})` |
| `viewer` | fullscreen photo viewer: `viewer.open(index)`, `viewer.random()` |
| `motion` | `motion.reduced` (bool — ALWAYS respect it: skip particle storms, shakes, autoplay loops), `motion.splitChars(el)`, `motion.splitWords(el)`, `motion.typewriter(el, text, {speed})→Promise`, `motion.countUp(el, to, {duration, format})`, `motion.reveal(root)` (animates `[data-reveal]` children on scroll — just add `data-reveal` attributes to elements and main.js calls reveal for the whole app after mount; call `motion.reveal(el)` yourself only if you inject elements later), `motion.tilt(card, {max})`, `motion.magnetic(btn)`, `motion.shake(el, {intensity,duration})`, `motion.parallax(el, {speed})`, `motion.onEnter(el, cb)`, `motion.onVisible(el, cb)`, `motion.scrollTo(target)` |
| `toast` | `toast.show({ title, body, icon, duration })` |
| `cine` | `cine.play(['line 1','line 2'], { hold: 1400, sub: 'small text', freeze: true })→Promise` — full-screen black cinematic text sequence. |
| `gsap`, `ScrollTrigger` | GSAP 3.15 (globals, already registered with ScrollTrigger + ScrollToPlugin). Use `scrollTrigger: { trigger: el, start: 'top 75%' }` for scroll-driven timelines. Don't pin sections (pinning breaks the HUD progress + mobile); use scrub/parallax instead. |
| `esc(str)` | HTML-escape. Use for EVERY string that comes from profile/photos/timeline/awards/messages. |
| `blocks(filled, total=10)` | returns the `████░░░░░░` HTML meter string |
| `el(html)` | make an element from an HTML string |
| `wait(ms), pick(arr), rand(a,b), randInt(a,b), shuffle(arr), clamp(v,a,b)` | utils |
| `scrollTo('#id')` | smooth scroll to a section |
| `onEnter(fn)`, `onSectionEnter(el, fn)` | see above |

Three.js: `import { createScene, glowTexture, pointerTracker, THREE } from '../core/three-utils.js'`. `createScene(canvas, {fov, maxDpr})` returns `{ THREE, scene, camera, renderer, onTick(fn(dt, elapsed)), pause(), resume(), dispose() }`. Three addons: `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'` (importmap is set up). Keep geometry counts modest (phones!).

## Design system (base.css) — use it, don't reinvent

- Fonts: `.display` (Bebas Neue, for huge titles), body Space Grotesk, `.mono` JetBrains Mono.
- Sizes: `.h-hero .h1 .h2 .h3`, `.lead`, `.eyebrow` (small mono label with a line — every section starts with an eyebrow + `.display.h1` title inside `.sec-head`).
- Layout: `.container` (1280 max) / `.container-narrow` (860), `.grid .grid-2 .grid-3 .grid-4`, `.stack`, `.row`, `.center`.
- Surfaces: `.glass` (+ `.panel` for padding, `.glass-strong`), `.glow-border`, `.card-3d`.
- Buttons: `.btn` (accent fill), `.btn-ghost`, `.btn-danger`, `.btn-gold`, `.btn-lg`, `.btn-sm`. Buttons get click/hover SFX automatically.
- Bits: `.tag` (`.tag-red .tag-gold .tag-pitch`), `.dot`, `.blink`, `.pulse`, `.meter` (label/track/fill/value), `.blocks`, `.kv` (dt/dd), `.term` (terminal box: `.dim .warn .bad .ok`, `.cursor`), `.stamp` (rotated red rubber stamp).
- Section accent: set `--accent` and `--accent-rgb` on `.sec-<id>` so buttons/eyebrows/meters pick up your section's colour. Palette tokens: `--acid #c6ff3d` (system/AI), `--cyan #38e8ff`, `--magenta #ff3d8f` (anime), `--gold #ffcc4d` (awards/cake), `--red #ff3b3b` (boss/warn), `--violet #8b5cff` (gaming), `--pitch #2ee56b` (football), `--orange #ff8a3d` (food/gym), `--ice #9fd8ff` (academics).
- Reveal on scroll: add `data-reveal` to blocks you want to fade/rise in.

## Rules every section must satisfy

1. **Distinct visual identity.** Each section must look like a different "app": stadium UI, game HUD, terminal, academic dashboard, documentary timeline, investigation board, etc. Background treatment (gradients, grid lines, SVG shapes, canvas) must differ from neighbouring sections. Not everything glows — use restraint; one accent per section.
2. **Responsive.** Works at 360px, 768px and 1440px. No horizontal scroll. Max 16px side gutter is handled by `.container`. Use `clamp()` sizes. Touch targets ≥ 40px.
3. **Reduced motion.** When `motion.reduced` is true: no continuous loops/particles/shake; show final states immediately. The `html.reduced` class is set — you can use it in CSS too.
4. **Accessibility basics.** Semantic headings (`h2` for section title), buttons are `<button>`, images have alt text, ARIA labels for icon-only buttons, `aria-live` on regions that update from clicks (roast output, game HP...). Keyboard-operable.
5. **No dead buttons.** Every button does something visible. Every promised interaction is implemented.
6. **Comedy is friendly.** Roast his habits (late, lazy, anime, exams-are-fictional-comedy, missing passes, unnational, gaming rage, biryani). Never race/religion/skin/body/sexuality/disability. Never real academic claims — values are clearly absurd (2%, ∞, "Loading...").
7. **Fictional disclaimers** on the scouting/academic/AI sections: a tiny mono line like "Statistics are 100% fabricated by his friends."
8. **Performance.** No layout thrash in scroll handlers; use GSAP/ScrollTrigger. Cap Three.js DPR (createScene does). Dispose nothing needed. Images: use `photo.thumb` for cards, `photo.url` in the viewer, `loading="lazy"` + `width/height` attributes.
9. **Log interactions** via `api.event(...)` for your section's key actions (see allowed list).
10. **Testing**: you can run the server on YOUR assigned port: `ADMIN_PASSWORD=testpass123 PORT=<port> node server/index.js &` then use Playwright from the global install (`require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')`) to load `http://localhost:<port>/`, click `.boot-skip` then `.boot-enter`, scroll to your section (`document.querySelector('#<id>').scrollIntoView()`), click your buttons, and assert no console errors / pageerrors. Take screenshots to `/tmp/claude-0/.../scratchpad/shots/<id>-desktop.png` and `-mobile.png` (viewport 390×844) and LOOK at them. Kill your server when done (`pkill -f "PORT=<port>"` won't work — use `kill` on the PID you started).

## Easter eggs (12 total, backend keys) — who implements which trigger

| key | trigger (section) | unique animation idea |
|---|---|---|
| `sir-spam` | hero (done) | SIR storm |
| `football` | scouting: click the floating football | ball explodes into 100 mini balls (`fx.emoji`) + whistle |
| `konami` | core (done) | — |
| `hidden-star` | timeline: a tiny ★ hidden in one entry | star shower + "You found the only star on his report card" |
| `nationals-btn` | nationals: a microscopic "SELECT FOR NATIONALS" button (like 9px, low contrast) | stadium erupts, scoreboard flips to SELECTED for 3 s then "just kidding" |
| `cake-spam` | cake: click cake 10× | cake wobbles, candles multiply, frosting everywhere |
| `secret-roast` | core (typing "unnational") — roast section registers `eggs.onUnlock('secret-roast', …)` to display a classified roast | red CLASSIFIED stamp + special roast |
| `dev-message` | core (console) — ending registers `eggs.onUnlock('dev-message', …)` + footer credit click ×3 triggers `eggs.unlock('dev-message')` | matrix-style text rain with a note from the devs |
| `biryani` | core (typing "biryani") — food section registers the animation | biryani rain 🍛 |
| `five-minutes` | core (timer) — no section work needed (default toast) | — |
| `boss-flawless` | boss: win without the ego meter ever regenerating | golden victory screen |
| `anime-9000` | anime: click the hours counter until it passes 9000 | "IT'S OVER 9000!" screen crack |

## The sections (ids in page order)

hero (done) · archives · scouting · pass · nationals · awards · gaming · anime · academics · gym · food · roast · evidence · timeline · boss · ai · compliment · cake · messages · ending

Detailed briefs are given to each builder. Study `public/js/sections/hero.js` + `public/css/sections/hero.css` as the reference for code style, quality bar and how `ctx` is used.
