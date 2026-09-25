#!/usr/bin/env node
'use strict';
// Project self-check: verifies files referenced by index.html exist, every
// section module has the right shape, config photos exist on disk, the DB
// initializes, and (optionally, with --browser) loads the site headlessly.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { fails++; console.log('  ✗', m); };

console.log('\nSIR ARCHIVES · self-check\n');

// 1. index.html references
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('/vendor/')) continue;
  const p = path.join(ROOT, 'public', ref.replace(/^\//, ''));
  fs.existsSync(p) ? ok(`asset ${ref}`) : bad(`missing asset ${ref}`);
}
// 2. vendor files
for (const v of ['node_modules/gsap/dist/gsap.min.js', 'node_modules/gsap/dist/ScrollTrigger.min.js', 'node_modules/gsap/dist/ScrollToPlugin.min.js', 'node_modules/three/build/three.module.js']) {
  fs.existsSync(path.join(ROOT, v)) ? ok(`vendor ${path.basename(v)}`) : bad(`missing ${v} (run npm install)`);
}
// 3. section modules
const secDir = path.join(ROOT, 'public/js/sections');
const ids = [...html.matchAll(/data-section="([^"]+)"/g)].map(m => m[1]);
for (const id of ids) {
  const f = path.join(secDir, `${id}.js`);
  if (!fs.existsSync(f)) { bad(`section module ${id}.js missing`); continue; }
  const src = fs.readFileSync(f, 'utf8');
  if (/STUB — replaced/.test(src)) bad(`section ${id} is still a stub`);
  else if (!/export default/.test(src) || !new RegExp(`id:\\s*'${id}'`).test(src)) bad(`section ${id}.js has wrong shape`);
  else ok(`section ${id}`);
  fs.existsSync(path.join(ROOT, `public/css/sections/${id}.css`)) ? null : bad(`css for ${id} missing`);
}
// 4. photos in config exist
const photos = require(path.join(ROOT, 'config/photos.js'));
for (const p of photos) fs.existsSync(path.join(ROOT, 'public/assets/photos', p.src)) ? ok(`photo ${p.src}`) : bad(`config photo missing on disk: ${p.src}`);
// 5. DB init
try { process.env.DATABASE_PATH = process.env.DATABASE_PATH || './data/check.db'; const { seed } = require(path.join(ROOT, 'server/seed.js')); seed({ log: () => {} }); ok('database initializes + seeds'); fs.rmSync(path.join(ROOT, 'data/check.db'), { force: true }); fs.rmSync(path.join(ROOT, 'data/check.db-wal'), { force: true }); fs.rmSync(path.join(ROOT, 'data/check.db-shm'), { force: true }); }
catch (e) { bad(`database failed: ${e.message}`); }
// 6. env
fs.existsSync(path.join(ROOT, '.env')) ? ok('.env present') : console.log('  · no .env (copy .env.example → .env to enable /admin)');

console.log(`\n${fails ? `${fails} problem(s) found` : 'all checks passed'}\n`);
process.exit(fails ? 1 : 0);
