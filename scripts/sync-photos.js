#!/usr/bin/env node
'use strict';
// Adds any image found in public/assets/photos/ that is not yet in the
// database (same as the admin "Scan folder" button) and reports missing files.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');
const { seed, syncPhotoDimensions, PHOTO_DIR } = require('../server/seed');

seed({ log: () => {} });
const files = fs.readdirSync(PHOTO_DIR).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
const known = new Set(db.prepare('SELECT src FROM photos').all().map(r => r.src));
let order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM photos').get().n;
const ins = db.prepare('INSERT INTO photos (src, title, caption, tags, sort_order) VALUES (?,?,?,?,?)');
let added = 0;
for (const f of files) {
  if (known.has(f)) continue;
  const n = db.prepare('SELECT COUNT(*) AS n FROM photos').get().n + 1;
  ins.run(f, `Evidence #${String(n).padStart(3, '0')}`, 'Caption pending. The investigation is ongoing.', '[]', order++);
  console.log(`+ added ${f}`); added++;
}
syncPhotoDimensions();
const missing = db.prepare('SELECT src FROM photos').all().map(r => r.src).filter(s => !fs.existsSync(path.join(PHOTO_DIR, s)));
for (const m of missing) console.log(`! missing file for DB entry: public/assets/photos/${m}`);
console.log(`done: ${added} added, ${missing.length} missing, ${files.length} files on disk`);
