'use strict';
// Seeds the database from /config. Safe to run repeatedly:
//  - default mode only fills EMPTY tables (keeps admin edits)
//  - `--reset` wipes content tables and reloads them from config
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { db, isEmpty, setSetting } = require('./db');

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'assets', 'photos');

function seed({ reset = false, log = console.log } = {}) {
  const profile = require('../config/profile');
  const photos = require('../config/photos');
  const roasts = require('../config/roasts');
  const timeline = require('../config/timeline');
  const awards = require('../config/awards');
  const eggs = require('../config/easterEggs');
  const settings = require('../config/settings');

  const tx = db.transaction(() => {
    if (reset) {
      for (const t of ['profiles', 'photos', 'roasts', 'timeline', 'awards', 'easter_eggs', 'settings']) db.prepare(`DELETE FROM ${t}`).run();
      log('reset: content tables cleared');
    }
    if (isEmpty('profiles')) {
      db.prepare(`INSERT INTO profiles (id,name,first_name,nickname,age,birthday,position,codename,known_weakness,primary_habit,secondary_habit,combat_class,favourite_food,games,hero_photo,made_by,friends,tagline)
        VALUES (1,@name,@first_name,@nickname,@age,@birthday,@position,@codename,@known_weakness,@primary_habit,@secondary_habit,@combat_class,@favourite_food,@games,@hero_photo,@made_by,@friends,@tagline)`)
        .run({ ...profile, friends: JSON.stringify(profile.friends || []) });
      log('seeded profile');
    }
    if (isEmpty('photos')) {
      const ins = db.prepare('INSERT INTO photos (src,title,caption,tags,sort_order) VALUES (?,?,?,?,?)');
      photos.forEach((p, i) => ins.run(p.src, p.title || `Evidence #${String(i + 1).padStart(3, '0')}`, p.caption || '', JSON.stringify(p.tags || []), i));
      log(`seeded ${photos.length} photos`);
    }
    if (isEmpty('roasts')) {
      const ins = db.prepare('INSERT INTO roasts (kind,topic,text) VALUES (?,?,?)');
      roasts.forEach(r => ins.run(r.kind, r.topic || 'general', r.text));
      log(`seeded ${roasts.length} roast lines`);
    }
    if (isEmpty('timeline')) {
      const ins = db.prepare('INSERT INTO timeline (year,title,body,sort_order) VALUES (?,?,?,?)');
      timeline.forEach((t, i) => ins.run(t.year, t.title, t.body || '', i));
      log(`seeded ${timeline.length} timeline entries`);
    }
    if (isEmpty('awards')) {
      const ins = db.prepare('INSERT INTO awards (icon,title,body,sort_order) VALUES (?,?,?,?)');
      awards.forEach((a, i) => ins.run(a.icon || '🏆', a.title, a.body || '', i));
      log(`seeded ${awards.length} awards`);
    }
    // easter eggs: upsert definitions (finds are preserved)
    const up = db.prepare(`INSERT INTO easter_eggs (key,name,hint,secret,sort_order) VALUES (?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET name=excluded.name, hint=excluded.hint, secret=excluded.secret, sort_order=excluded.sort_order`);
    eggs.forEach((e, i) => up.run(e.key, e.name, e.hint || '', e.secret || '', i));
    log(`synced ${eggs.length} easter eggs`);
    // settings: only add missing keys
    const has = db.prepare('SELECT 1 FROM settings WHERE key = ?');
    let added = 0;
    for (const [k, v] of Object.entries(settings)) if (!has.get(k)) { setSetting(k, v); added++; }
    if (added) log(`seeded ${added} settings`);
  });
  tx();
  syncPhotoDimensions(log);
}

// Fill width/height for photos that are on disk (used for layout + preloading).
function syncPhotoDimensions(log = () => {}) {
  let sharp = null;
  try { sharp = require('sharp'); } catch { /* optional */ }
  const rows = db.prepare('SELECT id, src FROM photos WHERE width IS NULL').all();
  if (!rows.length) return;
  const upd = db.prepare('UPDATE photos SET width=?, height=? WHERE id=?');
  for (const r of rows) {
    const file = path.join(PHOTO_DIR, r.src);
    if (!fs.existsSync(file)) continue;
    const dim = sharp ? null : readJpegSize(file);
    if (sharp) {
      sharp(file).metadata().then(m => upd.run(m.width, m.height, r.id)).catch(() => {});
    } else if (dim) upd.run(dim.w, dim.h, r.id);
  }
  log(`checked dimensions for ${rows.length} photos`);
}

// Minimal JPEG/PNG size reader (used when sharp is not installed)
function readJpegSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch { /* ignore */ }
  return null;
}

module.exports = { seed, syncPhotoDimensions, PHOTO_DIR };

if (require.main === module) {
  seed({ reset: process.argv.includes('--reset') });
  console.log('done');
}
