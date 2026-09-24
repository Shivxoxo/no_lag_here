/* RIDGE RUSH — end-to-end browser smoke test (Playwright + Chromium).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/smoke.js        (npm run smoke)
 *   SMOKE_ONLY=file|http   run a single transport     SMOKE_QUICK=1   shorter real-time driving
 *
 * Runs the whole suite twice: against file://…/index.html (primary) and against a static HTTP server
 * started in-process (node http). Every page fails the suite on ANY console error or page error.
 *
 * Scenarios: boot + animated menu canvas · every screen and back · settings persist across reload ·
 * PLAY → vehicle select → START RUN · hold D (distance, speed, fuel) · scripted driving collects coins ·
 * pause freezes the run · single rAF loop (also after restarts) and P toggles exactly once · forced crash →
 * results with count-up → coins saved · RETRY · garage upgrade (exact cost, persists, torque rises) ·
 * vehicle unlock with tokens · world unlock with coins · mission force-complete + CLAIM · daily run uses
 * the daily world/seed/modifiers · mobile touch (GAS hold drives, TILT rotates in the air) · resize keeps
 * the backing store = CSS size × dpr · corrupted save → defaults · long simulated run without NaN ·
 * integration rules (audio init on gesture, final gravity, event coin multipliers, Ion Thruster) ·
 * shell rules: R / pause RESTART bank the run (crash slow-mo, out-of-fuel coast), a daily that ends after
 * midnight is expired (not credited to the new day), level-ups survive leaving results early, garage
 * RIDE AGAIN / vehicle UPGRADE / BACK routes, frozen attract behind menu screens, Tab keeps the run
 * playing, one confirm per double activation, sliding thumb hands GAS over to TILT, no keycaps on touch.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const FILE_URL = 'file://' + path.join(ROOT, 'index.html');
const QUICK = !!process.env.SMOKE_QUICK;
const ONLY = process.env.SMOKE_ONLY || '';
const SAVE_KEY = 'ridgeRush.save.v1';

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log('    ✓ ' + msg); } else { failed++; failures.push(msg); console.log('    ✗ ' + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ static server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const full = path.normalize(path.join(ROOT, p));
      if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ------------------------------------------------------------------ page helpers
async function openPage(browser, url, ctxOpts, label) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 } }, ctxOpts || {}));
  const page = await ctx.newPage();
  const errors = [];
  const failedReq = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e && e.message)));
  page.on('requestfailed', (r) => failedReq.push(r.url()));
  await gotoGame(page, url);
  return { ctx, page, errors, failedReq, label };
}
async function gotoGame(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.RR && RR.Game && RR.Game.state === 'menu' && RR.Game.frame > 5, null, { timeout: 20000 });
}
async function reloadGame(page) {
  await page.reload();
  await page.waitForFunction(() => window.RR && RR.Game && RR.Game.state === 'menu' && RR.Game.frame > 5, null, { timeout: 20000 });
}
async function closePage(p) {
  ok(p.errors.length === 0, p.label + ': no console errors / page errors' + (p.errors.length ? ' → ' + p.errors.slice(0, 5).join(' | ') : ''));
  ok(p.failedReq.length === 0, p.label + ': no failed requests' + (p.failedReq.length ? ' → ' + p.failedReq.slice(0, 3).join(' ') : ''));
  await p.ctx.close();
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => ev(page, () => RR.Game.state);
const screen = (page) => ev(page, () => RR.UI.current);
async function waitState(page, s, timeout) {
  await page.waitForFunction((s) => RR.Game.state === s, s, { timeout: timeout || 8000 });
}
async function waitScreen(page, id, timeout) {
  await page.waitForFunction((id) => RR.UI.current === id, id, { timeout: timeout || 8000 });
}
async function clickAct(page, act, arg) {
  const sel = '.screen.active [data-act="' + act + '"]' + (arg !== undefined ? '[data-arg="' + arg + '"]' : '');
  await page.click(sel);
}
async function modalOk(page) {
  await page.waitForSelector('.modal.open [data-act="modal"][data-arg="ok"]', { timeout: 5000 });
  await page.click('.modal.open [data-act="modal"][data-arg="ok"]');
  await page.waitForFunction(() => !RR.UI.modalOpen, null, { timeout: 5000 });
}
// If the first-run tutorial is up, dismiss it and wait for 'playing'.
async function passTutorial(page) {
  await page.waitForFunction(() => RR.Game.state === 'tutorial' || RR.Game.state === 'playing', null, { timeout: 8000 });
  if ((await state(page)) === 'tutorial') await modalOk(page);
  await waitState(page, 'playing');
}
async function startRunUI(page) {
  await clickAct(page, 'play');
  await waitScreen(page, 'vehicles');
  await clickAct(page, 'start');
  await passTutorial(page);
}
const runInfo = (page) => ev(page, () => {
  const r = RR.Game.run;
  if (!r) return null;
  return { distance: r.distance, fuel: r.fuel, fuelMax: r.fuelMax, coins: r.coins, bonus: r.bonusCoins, state: r.state, time: r.time,
    speed: r.body.speedKmh(), mode: r.mode, worldId: r.worldId, vehicleId: r.vehicleId };
});
async function frameRate(page, ms) {
  const f0 = await ev(page, () => RR.Game.frame);
  await sleep(ms);
  const f1 = await ev(page, () => RR.Game.frame);
  return (f1 - f0) / (ms / 1000);
}
// Install an in-page driver that presses real (synthetic) keyboard events through RR.Input:
// gas on the ground, feathered when the nose climbs, auto-level with W/S in the air.
async function startDriver(page) {
  await ev(page, () => {
    if (window.__drv) return;
    const held = {};
    const key = (code, down) => {
      if (!!held[code] === down) return;
      held[code] = down;
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
    };
    const tick = () => {
      window.__drv = requestAnimationFrame(tick);
      const run = RR.Game.run;
      if (!run || RR.Game.state !== 'playing') { key('KeyD', false); key('KeyW', false); key('KeyS', false); key('KeyA', false); return; }
      const b = run.body, T = run.terrain, U = RR.Util;
      const onGround = b.grounded || b.bodyContact;
      let gas = true, back = false, fwd = false, brake = false;
      if (onGround) {
        const rel = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x)));
        if (rel > 0.2) fwd = true;
        if (rel > 0.45) gas = false;
        if (rel > 0.8) brake = true;
        if (rel < -0.4) back = true;
      } else {
        const err = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x + Math.max(0, b.vx) * 0.5)));
        const u = -err * 2.2 - b.av * 0.45;
        gas = false;
        if (u > 0.25) back = true; else if (u < -0.25) fwd = true;
      }
      key('KeyD', gas); key('KeyA', brake && !gas); key('KeyW', back); key('KeyS', fwd && !back);
    };
    window.__drv = requestAnimationFrame(tick);
  });
}
async function stopDriver(page) {
  await ev(page, () => {
    if (window.__drv) cancelAnimationFrame(window.__drv);
    window.__drv = 0;
    for (const code of ['KeyD', 'KeyW', 'KeyS', 'KeyA']) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
  });
}
// Canvas pixel sample (the renderer's context is opaque and never tainted).
const samplePixels = (page) => ev(page, () => {
  const c = document.getElementById('game-canvas');
  const ctx = c.getContext('2d');
  const out = [];
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(c.width * ((i % 6) + 0.5) / 6), y = Math.floor(c.height * (Math.floor(i / 6) + 0.5) / 4);
    const d = ctx.getImageData(x, y, 1, 1).data;
    out.push(d[0], d[1], d[2]);
  }
  return out;
});
// CDP touch helpers (real touch input → the browser's own pointer events).
async function touchCenter(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}
async function touchHold(page, cdp, points, ms) {
  const tp = points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 8, radiusY: 8, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ================================================================== scenarios
async function scenarioMenuAndScreens(browser, url, T) {
  console.log('  [' + T + '] boot, animated menu, every screen, settings persistence');
  const p = await openPage(browser, url, null, T + ' menu/screens');
  const { page } = p;
  ok((await screen(page)) === 'menu', 'boots to the main menu');
  ok(await ev(page, () => !!RR.Game.attract), 'attract run drives behind the menu');
  const a = await samplePixels(page);
  await sleep(900);
  const b = await samplePixels(page);
  const distinct = new Set();
  for (let i = 0; i < a.length; i += 3) distinct.add(a[i] + ',' + a[i + 1] + ',' + a[i + 2]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  ok(distinct.size >= 4, 'menu canvas is not blank (' + distinct.size + ' distinct colours in 24 samples)');
  ok(diff > 30, 'menu canvas animates over time (Σ|Δ| = ' + diff + ')');
  const fps = await frameRate(page, 1000);
  ok(fps > 25 && fps < 90, 'single rAF loop in the menu (~' + fps.toFixed(0) + ' frames/s)');
  // every screen and back
  for (const [act, id] of [['play', 'vehicles'], ['garage', 'garage'], ['worlds', 'worlds'], ['missions', 'missions'], ['daily', 'daily'], ['settings', 'settings']]) {
    await clickAct(page, act);
    await waitScreen(page, id);
    ok(await ev(page, (id) => !!document.querySelector('.scr-' + id + '.active'), id), 'menu → ' + id + ' opens');
    await clickAct(page, 'back');
    await waitScreen(page, 'menu');
  }
  ok((await screen(page)) === 'menu', 'BACK returns to the menu from every screen');
  await clickAct(page, 'garage');
  await waitScreen(page, 'garage');
  await page.keyboard.press('Escape');
  await waitScreen(page, 'menu');
  ok(true, 'Esc goes back from a screen');
  // settings persist across reload
  await clickAct(page, 'settings');
  await waitScreen(page, 'settings');
  await clickAct(page, 'toggleSetting', 'music');
  await clickAct(page, 'setSetting', 'quality|medium');
  await clickAct(page, 'toggleSetting', 'showFps');
  await clickAct(page, 'setSetting', 'touchControls|off');
  const s1 = await ev(page, () => Object.assign({}, RR.Save.data.settings));
  ok(s1.music === false && s1.quality === 'medium' && s1.showFps === true && s1.touchControls === 'off', 'settings change immediately');
  ok(await ev(page, () => RR.Game.renderer.quality === 'medium' && document.body.classList.contains('q-medium')), 'quality applied to the renderer');
  await reloadGame(page);
  const s2 = await ev(page, () => Object.assign({}, RR.Save.data.settings));
  ok(s2.music === false && s2.quality === 'medium' && s2.showFps === true && s2.touchControls === 'off', 'settings persist across reload');
  ok(await ev(page, () => RR.Game.renderer.quality === 'medium'), 'reloaded quality re-applied');
  await closePage(p);
}

async function scenarioDriving(browser, url, T) {
  console.log('  [' + T + '] PLAY → START RUN, driving, coins, pause, rAF, crash → results, RETRY');
  const p = await openPage(browser, url, null, T + ' driving');
  const { page } = p;
  await startRunUI(page);
  ok((await state(page)) === 'playing' && (await ev(page, () => document.getElementById('hud').classList.contains('visible'))), 'PLAY → vehicle select → START RUN → playing with HUD');
  const r0 = await runInfo(page);
  await page.keyboard.down('KeyD');
  await sleep(QUICK ? 5000 : 8000);
  const r1 = await runInfo(page);
  await page.keyboard.up('KeyD');
  ok(r1.distance > 30, 'holding D drives forward (' + r1.distance.toFixed(1) + ' m)');
  ok(r1.speed > 0, 'speed > 0 (' + r1.speed.toFixed(1) + ' km/h)');
  ok(r1.fuel < r0.fuel, 'fuel decreased (' + r0.fuel.toFixed(1) + ' → ' + r1.fuel.toFixed(1) + ')');
  const hud = await ev(page, () => parseInt(document.querySelector('[data-h="dist"]').textContent.replace(/[^0-9]/g, ''), 10));
  ok(Math.abs(hud - Math.floor((await runInfo(page)).distance)) <= 2, 'HUD distance follows the run (' + hud + ' m)');
  // scripted driving (~40 s of driving in total, including the D hold); a run that ends is retried
  let driven = 0, coinsSeen = r1.coins, runs = 1, best = r1.distance;
  const drive = async (ms) => {
    await startDriver(page);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(400);
      const r = await runInfo(page);
      if (r) { coinsSeen = Math.max(coinsSeen, r.coins); best = Math.max(best, r.distance); }
      if ((await state(page)) !== 'playing') break;
    }
    await stopDriver(page);
    driven += Date.now() - t0;
  };
  while (driven < (QUICK ? 18000 : 32000)) {
    const st = await state(page);
    if (st === 'results') { await clickAct(page, 'retry'); await waitState(page, 'playing'); runs++; }
    else if (st !== 'playing') await waitState(page, 'results', 6000);
    else await drive((QUICK ? 18000 : 32000) - driven);
  }
  ok(coinsSeen > 0, 'scripted driving collects coins (' + coinsSeen + ' coins, best ' + best.toFixed(0) + ' m, ' + runs + ' run(s))');
  if ((await state(page)) !== 'playing') {
    if ((await state(page)) !== 'results') await waitState(page, 'results', 6000);
    await clickAct(page, 'retry');
    await waitState(page, 'playing');
  }
  // make sure the run being crashed has collected coins (drive on if needed)
  for (let k = 0; k < 3 && (await runInfo(page)).coins <= 0; k++) await drive(6000);
  // forced crash → results (count-up) → coins saved exactly once
  const pre = await ev(page, () => {
    window.__rewards = null;
    const orig = RR.Progression.applyRunResults;
    RR.Progression.applyRunResults = function (s) { const r = orig.apply(this, arguments); window.__rewards = r; window.__summary = s; RR.Progression.applyRunResults = orig; return r; };
    const run = RR.Game.run;
    return { coins: RR.Save.data.coins, runs: RR.Save.data.stats.runs, runCoins: run.coins + run.bonusCoins };
  });
  // (drop any SHIELD power-up / post-rescue invulnerability so the head hit really crashes)
  await ev(page, () => { const r = RR.Game.run; r.powerUps.clear(); r.invulnTime = 0; r.body.headHit = true; });
  await page.waitForFunction(() => RR.Game.run && RR.Game.run.state === 'crashed', null, { timeout: 3000 });
  ok(await ev(page, () => document.querySelector('[data-h="stamp"]').classList.contains('on')), 'crash stamp shows during the slow-mo');
  await waitScreen(page, 'results', 6000);
  const early = await ev(page, () => parseInt(document.querySelector('.scr-results [data-ref="dist"]').textContent.replace(/[^0-9]/g, ''), 10) || 0);
  await sleep(2600);
  const fin = await ev(page, () => ({
    dist: parseInt(document.querySelector('.scr-results [data-ref="dist"]').textContent.replace(/[^0-9]/g, ''), 10),
    coinsText: document.querySelector('.scr-results [data-ref="coins"]').textContent,
    summary: window.__summary, rewards: window.__rewards, save: RR.Save.data.coins, runs: RR.Save.data.stats.runs
  }));
  ok(fin.summary && fin.summary.endReason === 'crash', 'crash ends the run (endReason crash, ' + (fin.summary && fin.summary.crashReason) + ')');
  ok(early < fin.dist && fin.dist === Math.floor(fin.summary.distance), 'results count up (' + early + ' → ' + fin.dist + ' m)');
  ok(fin.rewards && fin.save === pre.coins + fin.rewards.totalCoins && fin.rewards.totalCoins >= pre.runCoins, 'coins added to the save (' + pre.coins + ' + ' + (fin.rewards && fin.rewards.totalCoins) + ' = ' + fin.save + ')');
  ok(fin.runs === pre.runs + 1, 'rewards applied exactly once (runs ' + pre.runs + ' → ' + fin.runs + ')');
  const stored = await ev(page, (k) => JSON.parse(localStorage.getItem(k)).coins, SAVE_KEY);
  ok(stored === fin.save, 'coins persisted to localStorage');
  // RETRY
  const oldRun = await ev(page, () => { window.__oldRun = RR.Game.run; return true; });
  await clickAct(page, 'retry');
  await waitState(page, 'playing');
  ok(await ev(page, () => RR.Game.run !== window.__oldRun && RR.Game.run.distance < 5 && RR.Game.run.state === 'running'), 'RETRY starts a fresh run' + (oldRun ? '' : ''));
  // pause: P toggles exactly once and freezes the run
  await page.keyboard.press('KeyP');
  await sleep(150);
  ok((await state(page)) === 'paused' && (await screen(page)) === 'pause', 'P pauses (pause screen shown)');
  const d1 = await runInfo(page);
  await sleep(1000);
  const d2 = await runInfo(page);
  ok(d1.distance === d2.distance && d1.time === d2.time && (await state(page)) === 'paused', 'run frozen while paused for 1 s (P toggled exactly once)');
  await page.keyboard.press('KeyP');
  await sleep(150);
  ok((await state(page)) === 'playing', 'P resumes');
  // single loop, also after several restarts
  const base = await frameRate(page, 1000);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyR'); await sleep(250); }
  await waitState(page, 'playing');
  const after = await frameRate(page, 1000);
  ok(base > 25 && after < base * 1.4 + 5, 'one rAF loop: ' + base.toFixed(0) + ' → ' + after.toFixed(0) + ' frames/s after 3 restarts');
  ok(await ev(page, () => RR.Game.run && RR.Game.run.distance < 60), 'R restarts a fresh run');
  // resize mid-run → backing store = CSS size × dpr
  await page.setViewportSize({ width: 1000, height: 640 });
  await sleep(500);
  const rs = await ev(page, () => {
    const c = document.getElementById('game-canvas'), r = RR.Game.renderer;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, dpr: r.dpr, vw: RR.Game.run.camera.viewW };
  });
  ok(rs.w === Math.round(rs.cw * rs.dpr) && rs.h === Math.round(rs.ch * rs.dpr) && rs.cw === 1000 && rs.vw === 1000,
    'resize mid-run: backing store ' + rs.w + '×' + rs.h + ' = CSS ' + rs.cw + '×' + rs.ch + ' × dpr ' + rs.dpr);
  await closePage(p);
}

async function scenarioMeta(browser, url, T) {
  console.log('  [' + T + '] garage upgrade, unlocks, missions, daily');
  const p = await openPage(browser, url, null, T + ' meta');
  const { page } = p;
  const stockTorque = await ev(page, () => RR.Vehicles.getTuned('trail_buggy', RR.Save.ensureVehicle('trail_buggy')).motor.torque);
  await ev(page, () => RR.Progression.addCoins(20000));
  await clickAct(page, 'garage');
  await waitScreen(page, 'garage');
  await sleep(200);
  const before = await ev(page, () => ({ coins: RR.Save.data.coins, lv: RR.Save.data.upgrades.trail_buggy.engine,
    cost: parseInt(document.querySelector('.scr-garage [data-ref="cost_engine"] b').textContent.replace(/[^0-9]/g, ''), 10) }));
  await clickAct(page, 'upgrade', 'engine');
  await sleep(200);
  const after = await ev(page, () => ({ coins: RR.Save.data.coins, lv: RR.Save.data.upgrades.trail_buggy.engine,
    lvText: document.querySelector('.scr-garage [data-ref="lv_engine"]').textContent }));
  ok(before.cost > 0 && before.coins - after.coins === before.cost, 'UPGRADE ENGINE costs exactly the displayed ' + before.cost + ' coins');
  ok(after.lv === before.lv + 1 && /LV 2/.test(after.lvText), 'engine level +1 (' + before.lv + ' → ' + after.lv + ', "' + after.lvText + '")');
  await reloadGame(page);
  ok(await ev(page, () => RR.Save.data.upgrades.trail_buggy.engine === 2), 'upgrade persists after reload');
  await ev(page, () => { RR.Save.data.seenTutorial = true; RR.Save.save(); });
  await startRunUI(page);
  const torque = await ev(page, () => RR.Game.run.tuned.motor.torque);
  ok(torque > stockTorque, 'next run uses the upgrade (torque ' + stockTorque.toFixed(0) + ' → ' + torque.toFixed(0) + ' Nm)');
  await ev(page, () => RR.Game.quitToMenu('menu'));
  await waitScreen(page, 'menu');
  // vehicle unlock with tokens (Dirt Runner: level 2, 1 token)
  await ev(page, () => { RR.Progression.addXp(400); RR.Progression.addTokens(3); });
  await sleep(300);
  if (await ev(page, () => RR.UI.modalOpen)) await modalOk(page);     // level-up modal
  await clickAct(page, 'play');
  await waitScreen(page, 'vehicles');
  const tok0 = await ev(page, () => RR.Save.data.tokens);
  await clickAct(page, 'unlockVehicle', 'dirt_runner|tokens');
  await modalOk(page);
  await sleep(200);
  const vu = await ev(page, () => ({ un: RR.Save.data.unlockedVehicles.indexOf('dirt_runner') >= 0, tok: RR.Save.data.tokens, sel: RR.Save.data.selectedVehicle,
    card: !document.querySelector('.veh-card[data-vid="dirt_runner"]').classList.contains('locked') }));
  ok(vu.un && vu.tok === tok0 - 1 && vu.card, 'Dirt Runner unlocked with 1 token (tokens ' + tok0 + ' → ' + vu.tok + ')');
  await clickAct(page, 'back');
  await waitScreen(page, 'menu');
  // world unlock with coins (Rocky Highlands: level 2, 1,500 coins)
  await clickAct(page, 'worlds');
  await waitScreen(page, 'worlds');
  const c0 = await ev(page, () => RR.Save.data.coins);
  await clickAct(page, 'unlockWorld', 'rocky_highlands');
  await modalOk(page);
  await sleep(200);
  const wu = await ev(page, () => ({ un: RR.Save.data.unlockedWorlds.indexOf('rocky_highlands') >= 0, coins: RR.Save.data.coins }));
  ok(wu.un && c0 - wu.coins === 1500, 'Rocky Highlands unlocked for 1,500 coins (' + c0 + ' → ' + wu.coins + ')');
  await clickAct(page, 'back');
  await waitScreen(page, 'menu');
  // missions: force-complete → CLAIM → reward
  const m = await ev(page, () => {
    const list = RR.Missions.getActive();
    const mm = list.find((x) => !x.completed) || list[0];
    RR.Missions.track(mm.stat, mm.target, { worldId: mm.worldId || RR.Save.data.selectedWorld });
    return { id: mm.id, reward: mm.reward, completed: RR.Missions.getActive().find((x) => x.id === mm.id).completed };
  });
  ok(m.completed, 'RR.Missions.track force-completes a mission');
  await clickAct(page, 'missions');
  await waitScreen(page, 'missions');
  const w0 = await ev(page, () => ({ coins: RR.Save.data.coins, xp: RR.Save.data.xp, tokens: RR.Save.data.tokens }));
  await page.click('.screen.active [data-act="claim"][data-arg="' + m.id + '"]');
  await sleep(300);
  const w1 = await ev(page, (id) => ({ coins: RR.Save.data.coins, xp: RR.Save.data.xp, tokens: RR.Save.data.tokens,
    claimed: RR.Missions.getActive().find((x) => x.id === id).claimed }), m.id);
  ok(w1.claimed && w1.coins - w0.coins === (m.reward.coins || 0) && w1.xp - w0.xp === (m.reward.xp || 0) && w1.tokens - w0.tokens === (m.reward.tokens || 0),
    'CLAIM pays the reward (+' + m.reward.coins + ' coins, +' + m.reward.xp + ' XP, +' + (m.reward.tokens || 0) + ' tokens)');
  if (await ev(page, () => RR.UI.modalOpen)) await modalOk(page);
  await clickAct(page, 'back');
  await waitScreen(page, 'menu');
  // daily challenge run
  await clickAct(page, 'daily');
  await waitScreen(page, 'daily');
  await clickAct(page, 'playDaily');
  await passTutorial(page);
  const d = await ev(page, () => {
    const ch = RR.Daily.getChallenge(), r = RR.Game.run, M = ch.modifiers;
    const mods = ['gravityMul', 'fuelEfficiencyMul', 'speedMul', 'terrainAmpMul', 'frictionMul', 'coinMul', 'coinDensityMul', 'windMul']
      .every((k) => Math.abs((M[k] == null ? 1 : M[k]) - r.modifiers[k]) < 1e-9) && !!M.noFuelPickups === r.modifiers.noFuelPickups;
    return { mode: r.mode, world: r.worldId === ch.worldId, seed: r.seed === (ch.seed >>> 0), mods, id: ch.id,
      goal: document.querySelector('[data-h="bestLabel"]').textContent, grav: Math.abs(r.env.gravity - 9.81 * r.world.gravity * r.modifiers.gravityMul) < 1e-9 };
  });
  ok(d.mode === 'daily' && d.world && d.seed, 'daily run uses the daily world and seed (' + d.id + ')');
  ok(d.mods && d.grav, 'daily modifiers applied to the run');
  ok(d.goal === 'GOAL', 'HUD shows the daily GOAL');
  await ev(page, () => RR.Game.quitRun());
  await waitScreen(page, 'results');
  ok(await ev(page, () => RR.Daily.status().attempts >= 1), 'daily attempt recorded');
  await closePage(p);
}

async function scenarioMobile(browser, url, T) {
  console.log('  [' + T + '] mobile touch emulation (740×360)');
  const p = await openPage(browser, url, { viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, T + ' mobile');
  const { page } = p;
  await ev(page, () => { RR.Save.data.seenTutorial = true; RR.Save.save(); });
  await page.tap('.screen.active [data-act="play"]');
  await waitScreen(page, 'vehicles');
  await page.tap('.screen.active [data-act="start"]');
  await waitState(page, 'playing');
  const tc = await ev(page, () => {
    const root = document.getElementById('touch-controls');
    const gas = root.querySelector('[data-tc="gas"]').getBoundingClientRect();
    return { visible: root.classList.contains('visible') && getComputedStyle(root).display !== 'none', w: gas.width, h: gas.height };
  });
  ok(tc.visible, 'touch controls visible on a touch device');
  ok(tc.w >= 60 && tc.h >= 60, 'GAS button is finger-sized (' + Math.round(tc.w) + '×' + Math.round(tc.h) + ' px)');
  const cdp = await p.ctx.newCDPSession(page);
  const gas = await touchCenter(page, '#touch-controls [data-tc="gas"]');
  const x0 = await ev(page, () => RR.Game.run.distance);
  await touchHold(page, cdp, [gas], 3000);
  const x1 = await ev(page, () => ({ d: RR.Game.run.distance, gas: RR.Input.state.gas }));
  ok(x1.d - x0 > 8, 'press-and-hold GAS (real touch events) drives the car (' + (x1.d - x0).toFixed(1) + ' m)');
  ok(x1.gas === false, 'lifting the finger releases GAS');
  // rotate buttons in the air: launch the car high, compare lean-back vs lean-forward rotation
  const spin = async (sel) => {
    await ev(page, () => {
      const r = RR.Game.run, b = r.body;
      b.setPose(b.x, r.terrain.heightAt(b.x) + 14, 0);
      b.setVelocity(6, 7);
      b.av = 0;
    });
    const a0 = await ev(page, () => RR.Game.run.body.angle);
    const pt = await touchCenter(page, sel);
    await touchHold(page, cdp, [pt], 450);
    const a1 = await ev(page, () => RR.Game.run.body.angle);
    return a1 - a0;
  };
  const back = await spin('#touch-controls [data-tc="leanBack"]');
  const fwd = await spin('#touch-controls [data-tc="leanForward"]');
  ok(back > 0.15 && fwd < -0.15, 'TILT buttons rotate the car in the air (↺ ' + back.toFixed(2) + ' rad, ↻ ' + fwd.toFixed(2) + ' rad)');
  // (the renderer's dynamic resolution may scale r.dpr below the device ratio on a slow machine)
  const rs = await ev(page, () => { const c = document.getElementById('game-canvas'), r = RR.Game.renderer; return { w: c.width, cw: c.clientWidth, dpr: r.dpr, dev: r.deviceRatio }; });
  ok(rs.w === Math.round(rs.cw * rs.dpr) && rs.dev === 2, 'high-DPI backing store (' + rs.w + ' = ' + rs.cw + ' × ' + rs.dpr + ', device ratio ' + rs.dev + ')');
  // a thumb sliding from GAS onto TILT hands the press over; sliding into empty space keeps GAS
  const lf = await touchCenter(page, '#touch-controls [data-tc="leanForward"]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gas.x, y: gas.y, id: 7 }] });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 370, y: 150, id: 7 }] });
  await sleep(80);
  const midSlide = await ev(page, () => Object.assign({}, RR.Input.getControls()));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lf.x, y: lf.y, id: 7 }] });
  await sleep(80);
  const onTilt = await ev(page, () => Object.assign({ pressed: [...document.querySelectorAll('.tc-btn.pressed')].map((e) => e.dataset.tc).join() }, RR.Input.getControls()));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(80);
  const lifted = await ev(page, () => ({ c: Object.assign({}, RR.Input.getControls()), pressed: document.querySelectorAll('.tc-btn.pressed').length }));
  ok(midSlide.throttle === 1 && onTilt.throttle === 0 && onTilt.lean === -1 && onTilt.pressed === 'leanForward' && lifted.c.throttle === 0 && lifted.c.lean === 0 && lifted.pressed === 0,
    'sliding thumb: empty space keeps GAS, GAS → TILT hands the press over, lifting releases all (' + JSON.stringify(onTilt) + ')');
  // results on a touch device: no keyboard keycaps, touch wording in the no-tricks tip
  await ev(page, () => { const r = RR.Game.run; r.distance = 12; RR.Game.quitRun(); });
  await waitScreen(page, 'results');
  const kb = await ev(page, () => { const k = document.querySelector('.scr-results [data-act="retry"] kbd'); const tip = document.querySelector('.scr-results .res-tricks .empty'); return { kbd: !!k && getComputedStyle(k).display !== 'none', tip: tip ? tip.textContent : '' }; });
  ok(!kb.kbd && /TILT button/.test(kb.tip), 'touch results: no R keycap, touch trick tip');
  await closePage(p);
}

async function scenarioRobustness(browser, url, T) {
  console.log('  [' + T + '] corrupted save, long simulated run');
  const p = await openPage(browser, url, null, T + ' robustness');
  const { page } = p;
  await ev(page, (k) => { localStorage.setItem(k, '{"coins": 99999, "level": 7, broken json'); localStorage.removeItem(k + '.bak'); }, SAVE_KEY);
  await reloadGame(page);
  const s = await ev(page, () => ({ rec: RR.Save.recovered, coins: RR.Save.data.coins, level: RR.Save.data.level, veh: RR.Save.data.unlockedVehicles.join(), state: RR.Game.state }));
  ok(s.rec && s.coins === 0 && s.level === 1 && s.veh === 'trail_buggy' && s.state === 'menu', 'corrupted save JSON → boots with defaults (' + JSON.stringify(s) + ')');
  // long simulated run: 6 minutes of game time through the real Run with a bot on RR.Input.getControls
  const sim = await ev(page, () => {
    const I = RR.Input, orig = I.getControls, ctl = { throttle: 0, lean: 0, handbrake: false }, U = RR.Util;
    let ended = null, nan = 0, frames = 0, maxX = 0, ends = 0;
    I.getControls = () => ctl;
    const worlds = ['green_valley', 'volcanic_ridge', 'neon_city'];
    try {
      for (const w of worlds) {
        const run = new RR.Run({ worldId: w, vehicleId: 'trail_buggy', mode: 'normal', daily: null, seed: 777, renderer: RR.Game.renderer, onEnd: (sm) => { ended = sm; ends++; } });
        for (let f = 0; f < 60 * 120 && !run._ended; f++) {
          const b = run.body, T = run.terrain;
          if (b.grounded || b.bodyContact) {
            const rel = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x)));
            ctl.throttle = rel > 0.5 ? 0.2 : 1; ctl.lean = rel > 0.2 ? -1 : 0;
          } else {
            const err = U.wrapAngle(b.angle - Math.atan(T.slopeAt(b.x + Math.max(0, b.vx) * 0.5)));
            ctl.throttle = 0; ctl.lean = U.clamp(-err * 2.2 - b.av * 0.45, -1, 1);
          }
          run.fuel = run.fuelMax;                       // keep driving: this checks stability, not balance
          run.update(1 / 60);
          frames++;
          for (const k of ['x', 'y', 'vx', 'vy', 'angle', 'av']) if (!Number.isFinite(b[k])) nan++;
          if (!Number.isFinite(run.distance) || !Number.isFinite(run.coins)) nan++;
          if (b.x > maxX) maxX = b.x;
          if (f % 30 === 0) run.render();
        }
        run.destroy();
      }
    } finally { I.getControls = orig; }
    return { frames, nan, maxX: Math.round(maxX), ends, endReason: ended && ended.endReason };
  });
  ok(sim.frames >= 3600 && sim.nan === 0, 'long simulated runs: ' + sim.frames + ' frames (' + (sim.frames / 60).toFixed(0) + ' s game time) with no NaN in body/run state');
  await ev(page, () => RR.Game.renderer && RR.Game.attract && RR.Game.attract.render());
  await closePage(p);
}

async function scenarioRules(browser, url, T) {
  console.log('  [' + T + '] integration rules: audio on gesture, gravity, thruster, coin multipliers');
  const p = await openPage(browser, url, null, T + ' rules');
  const { page } = p;
  ok(await ev(page, () => !RR.Audio.context), 'no AudioContext before the first user gesture');
  await page.mouse.click(5, 5);
  await sleep(100);
  ok(await ev(page, () => !!RR.Audio.context), 'RR.Audio.init() runs on the first gesture');
  const g = await ev(page, () => {
    RR.Save.data.seenTutorial = true;
    const d = Object.assign({}, RR.Daily.getChallenge(), { worldId: 'green_valley', modifiers: { gravityMul: 0.5, coinMul: 2, labels: [] } });
    RR.Game.startRun({ daily: d });
    const r = RR.Game.run;
    r.update(1 / 60);
    const want = 9.81 * r.world.gravity * 0.5 * (r.env.gravityMul || 1);
    const c = r.collectibles;
    const n0 = c.falling.length;
    c.addCoin(r.body.x + 30, r.body.y + 5, 25, { falling: true });
    const coin = c.falling[n0];
    return { phys: r._physEnv.gravity, want, coin: coin && coin.value, coinWant: Math.round(25 * r.world.coinMul * 2) };
  });
  ok(Math.abs(g.phys - g.want) < 1e-9, 'physics gets the final gravity (world × daily × section): ' + g.phys.toFixed(3));
  ok(g.coin === g.coinWant, 'event coins apply world × modifier multipliers (' + g.coin + ')');
  await ev(page, () => RR.Game.quitToMenu('menu'));
  await waitScreen(page, 'menu');
  const th = await ev(page, () => {
    const d = RR.Save.data;
    if (d.unlockedVehicles.indexOf('storm_runner') < 0) d.unlockedVehicles.push('storm_runner');
    RR.Game.startRun({ vehicleId: 'storm_runner', worldId: 'green_valley' });
    return { special: !!RR.Game.run.special, btn: RR.Input.specialVisible };
  });
  await sleep(300);
  await page.keyboard.press('Space');
  await sleep(120);
  const th2 = await ev(page, () => ({ active: RR.Game.run.specialActive, cd: RR.Game.run.specialCooldown, boost: RR.Game.run.controls.boost }));
  ok(th.special && th2.active && th2.cd > 0 && th2.boost > 0, 'Space fires the Storm Runner Ion Thruster (specialActive, boost ' + th2.boost + ')');
  await closePage(p);
}

async function scenarioShell(browser, url, T) {
  console.log('  [' + T + '] shell: banked restarts, daily expiry, level-ups, garage routes, menu attract, Tab, confirms');
  const p = await openPage(browser, url, null, T + ' shell');
  const { page } = p;
  await ev(page, () => { RR.Save.data.seenTutorial = true; RR.Save.save(); });
  const dismissModals = async () => { await sleep(600); while (await ev(page, () => RR.UI.modalOpen)) { await modalOk(page); await sleep(300); } };
  const snap = () => ev(page, () => { const r = RR.Game.run; return { runCoins: r ? r.coins + r.bonusCoins : 0, dist: r ? Math.floor(r.distance) : 0,
    save: RR.Save.data.coins, runs: RR.Save.data.stats.runs, best: RR.Save.data.bestDistances.green_valley || 0, state: RR.Game.state }; });
  // drive a run forward through the real Run (physics + coins) without real-time waiting
  const advance = (m) => ev(page, (m) => {
    const r = RR.Game.run; r.fuel = r.fuelMax;
    for (let i = 0; i < 1500 && r.distance < m && r.state === 'running'; i++) { r.body.setVelocity(Math.max(r.body.vx, 14), r.body.vy); r.update(1 / 60); }
    r.onCoin(25, r.body.x, r.body.y);
  }, m);
  await ev(page, () => RR.Game.startRun({ worldId: 'green_valley', vehicleId: 'trail_buggy' }));
  await waitState(page, 'playing');
  // R on the CRASHED stamp banks the run
  await advance(160);
  const hookBank = () => ev(page, () => {
    window.__sum = null; window.__rw = null; const orig = RR.Progression.applyRunResults;
    RR.Progression.applyRunResults = function (sm) { const rw = orig.apply(this, arguments); window.__sum = sm; window.__rw = rw; RR.Progression.applyRunResults = orig; return rw; };
  });
  await ev(page, () => { const r = RR.Game.run; r.powerUps.clear(); r.invulnTime = 0; r.crash('head'); window.__oldRun = r; });
  await hookBank();
  await sleep(250);
  let a = await snap();
  await page.keyboard.press('KeyR');
  await sleep(300);
  let b = await snap();
  const cs = await ev(page, () => window.__sum && { coins: window.__sum.coins + window.__sum.bonusCoins, dist: Math.floor(window.__sum.distance), reason: window.__sum.endReason, total: window.__rw.totalCoins });
  ok(b.state === 'playing' && await ev(page, () => RR.Game.run !== window.__oldRun && RR.Game.run.state === 'running'), 'R during the crash slow-mo starts a fresh run');
  ok(cs && cs.reason === 'crash' && cs.coins >= a.runCoins && b.save - a.save === cs.total && cs.total === cs.coins && b.runs === a.runs + 1 && b.best === cs.dist,
    'R during the crash slow-mo banks the run (coins +' + (b.save - a.save) + '/' + (cs && cs.coins) + ', runs ' + a.runs + '→' + b.runs + ', best ' + b.best + ' m, endReason ' + (cs && cs.reason) + ')');
  // pause → RESTART banks too (no confirm)
  await advance(90);
  await page.keyboard.press('KeyP');
  await waitScreen(page, 'pause');
  a = await snap();                                   // paused: the run can't collect more meanwhile
  await clickAct(page, 'restart');
  await waitState(page, 'playing');
  b = await snap();
  ok(b.save - a.save === a.runCoins && b.runs === a.runs + 1 && !(await ev(page, () => RR.UI.modalOpen)), 'pause → RESTART banks the run (coins +' + (b.save - a.save) + ')');
  // out-of-fuel coast → R banks with endReason 'fuel'
  await advance(70);
  await ev(page, () => {
    const r = RR.Game.run; r.fuel = 0; for (let i = 0; i < 6; i++) r.update(1 / 60);
    window.__sum = null; const orig = RR.Progression.applyRunResults;
    RR.Progression.applyRunResults = function (sm) { window.__sum = sm; RR.Progression.applyRunResults = orig; return orig.apply(this, arguments); };
  });
  a = await snap();
  await page.keyboard.press('KeyR');
  await sleep(300);
  b = await snap();
  const fsum = await ev(page, () => window.__sum && window.__sum.endReason);
  ok(b.runs === a.runs + 1 && b.save >= a.save + a.runCoins && fsum === 'fuel', 'R while coasting out of fuel banks the run (endReason ' + fsum + ')');
  // results → R does not bank twice
  await advance(40);
  await ev(page, () => RR.Game.quitRun());
  await waitScreen(page, 'results');
  a = await snap();
  await page.keyboard.press('KeyR');
  await waitState(page, 'playing');
  b = await snap();
  ok(b.save === a.save && b.runs === a.runs, 'R on the results screen does not bank the run again');
  // quitRun keeps the crash end reason
  await advance(30);
  await ev(page, () => { const r = RR.Game.run; r.powerUps.clear(); r.invulnTime = 0; r.crash('head');
    window.__sum = null; const orig = RR.Progression.applyRunResults;
    RR.Progression.applyRunResults = function (sm) { window.__sum = sm; RR.Progression.applyRunResults = orig; return orig.apply(this, arguments); };
    RR.Game.quitRun(); });
  await waitScreen(page, 'results');
  ok(await ev(page, () => window.__sum && window.__sum.endReason === 'crash' && /Crashed/.test(document.querySelector('.scr-results [data-ref="reason"]').textContent)), 'QUIT during the crash slow-mo keeps endReason crash');
  // daily started before midnight, ended after: expired, never credited to the new day's challenge
  await ev(page, () => RR.Game.quitToMenu('menu'));
  await waitScreen(page, 'menu');
  await dismissModals();                               // level-ups from the banked runs show here
  const dm = await ev(page, () => {
    const U = RR.Util, d = new Date(); d.setDate(d.getDate() - 1);
    const yesterday = RR.Daily.getChallenge(d);
    const before = JSON.stringify(RR.Save.data.daily), coins0 = RR.Save.data.coins;
    RR.Game.startRun({ daily: yesterday });
    const r = RR.Game.run; r.distance = Math.max(yesterday.targetDistance, RR.Daily.getChallenge().targetDistance) + 50;
    window.__dr = null; const orig = RR.Daily.recordAttempt;
    RR.Daily.recordAttempt = function () { const res = orig.apply(this, arguments); window.__dr = res; RR.Daily.recordAttempt = orig; return res; };
    RR.Game.quitRun();
    return { dr: window.__dr, before, after: JSON.stringify(RR.Save.data.daily), today: U.todayKey(), day: yesterday.day, dailyCoins: RR.Save.data.coins - coins0 };
  });
  await waitScreen(page, 'results');
  const panel = await ev(page, () => document.querySelector('.scr-results [data-ref="daily"]').textContent);
  ok(dm.dr && dm.dr.expired === true && !dm.dr.completedNow && dm.before === dm.after, 'daily that ends after midnight is expired and leaves today\'s daily untouched (' + dm.day + ' vs ' + dm.today + ')');
  ok(/expired at midnight/.test(panel), 'results daily panel shows the run\'s own challenge as expired');
  // level-up earned on a run left early (MENU) → modal on the menu, never a mid-run toast
  await ev(page, () => RR.Game.quitToMenu('menu'));
  await dismissModals();
  await ev(page, () => { RR.Save.data.xp = RR.Progression.xpToReachLevel(RR.Save.data.level + 1) - 5; RR.Save.save(); RR.Game.startRun({}); });
  await waitState(page, 'playing');
  await ev(page, () => { RR.Game.run.distance = 400; RR.Game.quitRun(); });
  await waitScreen(page, 'results');
  await sleep(500);
  await clickAct(page, 'toMenu');
  await page.waitForFunction(() => RR.UI.modalOpen, null, { timeout: 3000 }).catch(() => {});
  ok(await ev(page, () => RR.UI.current === 'menu' && RR.UI.modalOpen && /LEVEL UP/.test(document.querySelector('.modal.open .modal-title').textContent)), 'level-up modal shows on the menu after leaving results early');
  await modalOk(page);
  // attract frozen behind menu screens, live behind the title
  await clickAct(page, 'garage');
  await waitScreen(page, 'garage');
  await sleep(400);
  const t0 = await ev(page, () => RR.Game.attract ? RR.Game.attract.time : -1);
  await sleep(500);
  const t1 = await ev(page, () => RR.Game.attract ? RR.Game.attract.time : -1);
  ok(t0 >= 0 && t1 === t0, 'attract run is frozen behind the garage (' + t0.toFixed(2) + ' → ' + t1.toFixed(2) + ')');
  // garage routes: BACK from menu-garage → menu; vehicles → UPGRADE → BACK → vehicles; START RUN
  await clickAct(page, 'back');
  await waitScreen(page, 'menu');
  const t2 = await ev(page, () => RR.Game.attract.time);
  await sleep(400);
  ok(await ev(page, (t) => RR.Game.attract.time > t, t2), 'attract drives again behind the title screen');
  await clickAct(page, 'play');
  await waitScreen(page, 'vehicles');
  await page.click('.veh-card.selected [data-act="upgradeVehicle"]');
  await waitScreen(page, 'garage');
  const lbl = await ev(page, () => document.querySelector('.scr-garage [data-ref="startLabel"]').textContent);
  await clickAct(page, 'back');
  await waitScreen(page, 'vehicles');
  ok(lbl === 'START RUN', 'vehicle select UPGRADE → garage (START RUN) → BACK returns to vehicle select');
  await clickAct(page, 'start');
  await waitState(page, 'playing');
  // Tab during a run is swallowed (no focus loss → no auto-pause)
  await page.keyboard.press('Tab');
  await sleep(200);
  ok((await state(page)) === 'playing', 'Tab during a run keeps playing');
  // results → GARAGE → RIDE AGAIN in one tap
  await ev(page, () => { RR.Game.run.distance = 60; RR.Game.quitRun(); });
  await waitScreen(page, 'results');
  await clickAct(page, 'toGarage');
  await waitScreen(page, 'garage');
  await dismissModals();
  const ra = await ev(page, () => document.querySelector('.scr-garage [data-ref="startLabel"]').textContent);
  await clickAct(page, 'garageStart');
  await waitState(page, 'playing');
  ok(ra === 'RIDE AGAIN' && await ev(page, () => RR.Game.run.worldId === RR.Game.lastParams.worldId), 'results → GARAGE → RIDE AGAIN starts the next run');
  await ev(page, () => RR.Game.quitToMenu('menu'));
  await waitScreen(page, 'menu');
  await dismissModals();
  // double activation of UNLOCK queues one confirm; the double-tap's second tap does not dismiss it
  await ev(page, () => { RR.Progression.addCoins(30000); if (RR.Save.data.level < 2) RR.Progression.addXp(RR.Progression.xpToReachLevel(2)); });
  await dismissModals();
  await ev(page, () => RR.UI.show('vehicles'));
  await waitScreen(page, 'vehicles');
  await sleep(300);
  await ev(page, () => { const b = document.querySelector('[data-ref="uc_dirt_runner"]'); b.click(); b.click(); });
  await sleep(250);
  const box = await ev(page, () => { const m = document.querySelector('.modal.open'); const r = m.getBoundingClientRect(); return { x: r.left + 8, y: r.top + 8 }; });
  await page.mouse.click(box.x, box.y);                 // backdrop tap right after opening
  await sleep(100);
  ok(await ev(page, () => RR.UI.modalOpen), 'a backdrop tap right after the confirm opened does not dismiss it');
  await modalOk(page);
  await sleep(400);
  const dbl = await ev(page, () => ({ modal: RR.UI.modalOpen, owned: RR.Save.data.unlockedVehicles.indexOf('dirt_runner') >= 0,
    err: [...document.querySelectorAll('#toasts .toast-txt')].some((t) => /failed/i.test(t.textContent)) }));
  ok(dbl.owned && !dbl.modal && !dbl.err, 'double-clicked UNLOCK: one confirm, one unlock, no error toast');
  await closePage(p);
}

// ================================================================== main
async function suite(browser, url, T) {
  console.log('\n=== ' + T + ': ' + url + ' ===');
  const scenarios = [scenarioMenuAndScreens, scenarioDriving, scenarioMeta, scenarioMobile, scenarioRobustness, scenarioRules, scenarioShell];
  for (const sc of scenarios) {
    try { await sc(browser, url, T); } catch (e) { ok(false, T + ' ' + sc.name + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  }
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let server = null;
  try {
    if (ONLY !== 'http') await suite(browser, FILE_URL, 'file');
    if (ONLY !== 'file') {
      server = await startServer();
      await suite(browser, 'http://127.0.0.1:' + server.address().port + '/index.html', 'http');
    }
  } finally {
    await browser.close();
    if (server) server.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  if (failed) { console.log('Failures:\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
})();
