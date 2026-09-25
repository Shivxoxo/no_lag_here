'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, parseJSON, allSettings, setSetting } = require('../db');
const { rateLimit } = require('../lib/rateLimit');
const { adminEnabled, checkPassword, issueToken, requireAdmin } = require('../lib/auth');
const V = require('../lib/validate');
const { photoRows, profileRow, statsSnapshot } = require('./public');
const { PHOTO_DIR, syncPhotoDimensions } = require('../seed');

const router = express.Router();

// ── auth ─────────────────────────────────────────────────────
router.get('/status', (req, res) => res.json({ enabled: adminEnabled() }));
router.post('/login', rateLimit({ name: 'login', max: 8, windowMs: 15 * 60_000 }), (req, res) => {
  if (!adminEnabled()) return res.status(503).json({ error: 'Admin is disabled: set ADMIN_PASSWORD (8+ chars) in .env' });
  const password = V.str(req.body?.password, { min: 1, max: 200, name: 'password', trim: false });
  if (!checkPassword(password)) return res.status(401).json({ error: 'Wrong password. Nice try, SIR.' });
  res.json({ token: issueToken(), expires_in_hours: Number(process.env.ADMIN_SESSION_HOURS) || 12 });
});

router.use(requireAdmin);
router.get('/me', (req, res) => res.json({ ok: true }));

// ── overview / stats ─────────────────────────────────────────
router.get('/stats', (req, res) => {
  const snapshot = statsSnapshot();
  const eventsByType = db.prepare('SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY n DESC').all();
  const sections = {};
  for (const r of db.prepare("SELECT meta FROM events WHERE type = 'section_view'").all()) {
    const s = parseJSON(r.meta, {}).section; if (s) sections[s] = (sections[s] || 0) + 1;
  }
  const visitorsByDay = db.prepare("SELECT substr(first_seen,1,10) AS day, COUNT(*) AS n FROM visitors GROUP BY day ORDER BY day DESC LIMIT 30").all();
  const roastsByDay = db.prepare("SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM roast_history GROUP BY day ORDER BY day DESC LIMIT 30").all();
  const topRoastLines = db.prepare('SELECT id, kind, topic, text, times_used FROM roasts ORDER BY times_used DESC LIMIT 10').all();
  const eggs = db.prepare(`SELECT e.key, e.name, e.secret, COUNT(f.id) AS found_by FROM easter_eggs e LEFT JOIN easter_egg_finds f ON f.egg_key = e.key GROUP BY e.key ORDER BY e.sort_order`).all();
  const recentVisitors = db.prepare('SELECT id, first_seen, last_seen, visits, user_agent, screen, sections_seen, completed_intro, reached_end FROM visitors ORDER BY last_seen DESC LIMIT 25').all()
    .map(v => ({ ...v, sections_seen: parseJSON(v.sections_seen, []) }));
  const photoViews = db.prepare('SELECT id, src, title, views FROM photos ORDER BY views DESC LIMIT 10').all();
  res.json({ snapshot, eventsByType, sections, visitorsByDay, roastsByDay, topRoastLines, eggs, recentVisitors, photoViews });
});

router.post('/reset-stats', (req, res) => {
  const what = V.strArray(req.body?.tables, { max: 10 });
  const allowed = { visitors: 'DELETE FROM visitors', events: 'DELETE FROM events', roast_history: 'DELETE FROM roast_history',
    game_scores: 'DELETE FROM game_scores', easter_egg_finds: 'DELETE FROM easter_egg_finds', messages: 'DELETE FROM messages',
    photo_views: 'UPDATE photos SET views = 0', roast_usage: 'UPDATE roasts SET times_used = 0' };
  const targets = what.length ? what : Object.keys(allowed);
  const tx = db.transaction(() => { for (const t of targets) { if (!allowed[t]) throw Object.assign(new Error(`Unknown table: ${t}`), { status: 400 }); db.prepare(allowed[t]).run(); } });
  tx();
  res.json({ ok: true, reset: targets });
});

// ── profile ──────────────────────────────────────────────────
router.get('/profile', (req, res) => res.json(profileRow()));
router.put('/profile', (req, res) => {
  const b = req.body || {};
  const p = {
    name: V.str(b.name, { min: 1, max: 80, name: 'name' }),
    first_name: V.str(b.first_name, { min: 1, max: 40, name: 'first_name' }),
    nickname: V.str(b.nickname, { min: 1, max: 30, name: 'nickname' }),
    age: V.int(b.age, { min: 1, max: 150, name: 'age' }),
    birthday: V.str(b.birthday, { min: 4, max: 20, name: 'birthday' }),
    position: V.str(b.position, { min: 1, max: 40, name: 'position' }),
    codename: V.str(b.codename, { min: 1, max: 30, name: 'codename' }),
    known_weakness: V.str(b.known_weakness, { max: 80, name: 'known_weakness' }),
    primary_habit: V.str(b.primary_habit, { max: 80, name: 'primary_habit' }),
    secondary_habit: V.str(b.secondary_habit, { max: 80, name: 'secondary_habit' }),
    combat_class: V.str(b.combat_class, { max: 80, name: 'combat_class' }),
    favourite_food: V.str(b.favourite_food, { max: 80, required: false }),
    games: V.str(b.games, { max: 80, required: false }),
    hero_photo: b.hero_photo ? V.filename(b.hero_photo, 'hero_photo') : '',
    made_by: V.str(b.made_by, { max: 80, required: false }),
    friends: JSON.stringify(V.strArray(b.friends, { max: 10, itemMax: 30, name: 'friends' })),
    tagline: V.str(b.tagline, { max: 140, required: false }),
  };
  db.prepare(`UPDATE profiles SET name=@name, first_name=@first_name, nickname=@nickname, age=@age, birthday=@birthday, position=@position, codename=@codename,
    known_weakness=@known_weakness, primary_habit=@primary_habit, secondary_habit=@secondary_habit, combat_class=@combat_class, favourite_food=@favourite_food,
    games=@games, hero_photo=@hero_photo, made_by=@made_by, friends=@friends, tagline=@tagline, updated_at=datetime('now') WHERE id = 1`).run(p);
  res.json(profileRow());
});

// ── generic CRUD factory for simple content tables ───────────
function crud(table, fields, { orderBy = 'sort_order, id' } = {}) {
  const r = express.Router();
  const cols = Object.keys(fields);
  const hasOrder = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'sort_order');
  if (!hasOrder && orderBy.includes('sort_order')) orderBy = 'id';
  r.get('/', (req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all()));
  r.post('/', (req, res) => {
    const vals = {}; for (const c of cols) vals[c] = fields[c](req.body?.[c]);
    const info = hasOrder
      ? db.prepare(`INSERT INTO ${table} (${cols.join(',')}, sort_order) VALUES (${cols.map(c => '@' + c).join(',')}, @sort_order)`).run({ ...vals, sort_order: db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ${table}`).get().n })
      : db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(vals);
    res.status(201).json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
  });
  r.put('/:id', (req, res) => {
    const id = V.int(req.params.id, { min: 1, name: 'id' });
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const vals = {}; for (const c of cols) if (req.body?.[c] !== undefined) vals[c] = fields[c](req.body[c]);
    if ('enabled' in (req.body || {})) vals.enabled = V.bool(req.body.enabled) ? 1 : 0;
    if (hasOrder && 'sort_order' in (req.body || {})) vals.sort_order = V.int(req.body.sort_order, { min: 0, max: 10000 });
    const keys = Object.keys(vals);
    if (keys.length) db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k}=@${k}`).join(', ')} WHERE id = @id`).run({ ...vals, id });
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });
  r.delete('/:id', (req, res) => {
    const id = V.int(req.params.id, { min: 1, name: 'id' });
    const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    res.json({ ok: info.changes > 0 });
  });
  r.post('/reorder', (req, res) => {
    if (!hasOrder) return res.status(400).json({ error: `${table} cannot be reordered` });
    const ids = (req.body?.ids || []).map(x => V.int(x, { min: 1 }));
    const tx = db.transaction(() => ids.forEach((id, i) => db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).run(i, id)));
    tx();
    res.json({ ok: true });
  });
  return r;
}

router.use('/timeline', crud('timeline', {
  year: v => V.str(v, { min: 1, max: 20, name: 'year' }),
  title: v => V.str(v, { min: 1, max: 120, name: 'title' }),
  body: v => V.str(v, { max: 400, required: false }),
}));
router.use('/awards', crud('awards', {
  icon: v => V.str(v, { max: 8, required: false }) || '🏆',
  title: v => V.str(v, { min: 1, max: 120, name: 'title' }),
  body: v => V.str(v, { max: 400, required: false }),
}));
router.use('/roasts', crud('roasts', {
  kind: v => V.oneOf(v || 'oneliner', ['oneliner', 'setup', 'punchline', 'callback'], 'kind'),
  topic: v => V.oneOf(v || 'general', ['football', 'late', 'anime', 'study', 'gaming', 'gym', 'food', 'general'], 'topic'),
  text: v => V.str(v, { min: 2, max: 300, name: 'text' }),
}, { orderBy: 'kind, topic, id' }));

// roast history (generated roasts)
router.get('/roast-history', (req, res) => {
  const limit = V.int(req.query.limit, { min: 1, max: 500, required: false, fallback: 100 });
  res.json(db.prepare('SELECT id, visitor_id, text, topic, created_at FROM roast_history ORDER BY id DESC LIMIT ?').all(limit));
});

// ── photos ───────────────────────────────────────────────────
router.get('/photos', (req, res) => res.json(photoRows({ includeMissing: true })));
router.post('/photos', (req, res) => {
  const src = V.filename(req.body?.src, 'src');
  const title = V.str(req.body?.title, { min: 1, max: 80, name: 'title' });
  const caption = V.str(req.body?.caption, { max: 300, required: false });
  const tags = V.strArray(req.body?.tags, { max: 10, itemMax: 20 });
  if (db.prepare('SELECT 1 FROM photos WHERE src = ?').get(src)) return res.status(409).json({ error: 'A photo with that filename already exists' });
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM photos').get().n;
  db.prepare('INSERT INTO photos (src, title, caption, tags, sort_order) VALUES (?,?,?,?,?)').run(src, title, caption, JSON.stringify(tags), order);
  syncPhotoDimensions();
  res.status(201).json(photoRows({ includeMissing: true }).find(p => p.src === src));
});
router.put('/photos/:id', (req, res) => {
  const id = V.int(req.params.id, { min: 1, name: 'id' });
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const vals = {
    title: b.title !== undefined ? V.str(b.title, { min: 1, max: 80, name: 'title' }) : row.title,
    caption: b.caption !== undefined ? V.str(b.caption, { max: 300, required: false }) : row.caption,
    tags: b.tags !== undefined ? JSON.stringify(V.strArray(b.tags, { max: 10, itemMax: 20 })) : row.tags,
    enabled: b.enabled !== undefined ? (V.bool(b.enabled) ? 1 : 0) : row.enabled,
    sort_order: b.sort_order !== undefined ? V.int(b.sort_order, { min: 0, max: 10000 }) : row.sort_order,
  };
  db.prepare('UPDATE photos SET title=@title, caption=@caption, tags=@tags, enabled=@enabled, sort_order=@sort_order WHERE id=@id').run({ ...vals, id });
  res.json(photoRows({ includeMissing: true }).find(p => p.id === id));
});
router.delete('/photos/:id', (req, res) => {
  const id = V.int(req.params.id, { min: 1, name: 'id' });
  res.json({ ok: db.prepare('DELETE FROM photos WHERE id = ?').run(id).changes > 0 });
});
router.post('/photos/reorder', (req, res) => {
  const ids = (req.body?.ids || []).map(x => V.int(x, { min: 1 }));
  db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(i, id)))();
  res.json({ ok: true });
});
// Scan public/assets/photos for files not yet in the DB and add them
router.post('/photos/scan', (req, res) => {
  const files = fs.existsSync(PHOTO_DIR) ? fs.readdirSync(PHOTO_DIR).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f)) : [];
  const known = new Set(db.prepare('SELECT src FROM photos').all().map(r => r.src));
  let order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM photos').get().n;
  const added = [];
  const ins = db.prepare('INSERT INTO photos (src, title, caption, tags, sort_order) VALUES (?,?,?,?,?)');
  for (const f of files.sort()) {
    if (known.has(f)) continue;
    const n = db.prepare('SELECT COUNT(*) AS n FROM photos').get().n + 1;
    ins.run(f, `Evidence #${String(n).padStart(3, '0')}`, 'Caption pending. The investigation is ongoing.', '[]', order++);
    added.push(f);
  }
  syncPhotoDimensions();
  res.json({ added, missing: photoRows({ includeMissing: true }).filter(p => !p.exists).map(p => p.src) });
});

// ── messages ─────────────────────────────────────────────────
router.get('/messages', (req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 500').all()));
router.put('/messages/:id', (req, res) => {
  const id = V.int(req.params.id, { min: 1 });
  db.prepare('UPDATE messages SET approved = ? WHERE id = ?').run(V.bool(req.body?.approved) ? 1 : 0, id);
  res.json({ ok: true });
});
router.delete('/messages/:id', (req, res) => {
  const id = V.int(req.params.id, { min: 1 });
  res.json({ ok: db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes > 0 });
});

// ── scores ───────────────────────────────────────────────────
router.get('/scores', (req, res) => {
  const rows = db.prepare('SELECT * FROM game_scores ORDER BY id DESC LIMIT 500').all();
  res.json(rows.map(r => ({ ...r, won: !!r.won, meta: parseJSON(r.meta, {}) })));
});
router.delete('/scores/:id', (req, res) => {
  const id = V.int(req.params.id, { min: 1 });
  res.json({ ok: db.prepare('DELETE FROM game_scores WHERE id = ?').run(id).changes > 0 });
});

// ── easter eggs ──────────────────────────────────────────────
router.get('/easter-eggs', (req, res) => {
  res.json(db.prepare(`SELECT e.*, COUNT(f.id) AS found_by FROM easter_eggs e LEFT JOIN easter_egg_finds f ON f.egg_key = e.key GROUP BY e.key ORDER BY e.sort_order`).all());
});
router.put('/easter-eggs/:key', (req, res) => {
  const key = V.str(req.params.key, { min: 1, max: 40 });
  const row = db.prepare('SELECT * FROM easter_eggs WHERE key = ?').get(key);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE easter_eggs SET name=?, hint=?, secret=?, enabled=? WHERE key=?').run(
    b.name !== undefined ? V.str(b.name, { min: 1, max: 60 }) : row.name,
    b.hint !== undefined ? V.str(b.hint, { max: 160, required: false }) : row.hint,
    b.secret !== undefined ? V.str(b.secret, { max: 200, required: false }) : row.secret,
    b.enabled !== undefined ? (V.bool(b.enabled) ? 1 : 0) : row.enabled, key);
  res.json({ ok: true });
});

// ── settings ─────────────────────────────────────────────────
const SETTING_SCHEMA = {
  site_title: v => V.str(v, { min: 1, max: 60 }),
  sound_default: v => V.oneOf(v, ['on', 'off']),
  boss_max_hp: v => V.int(v, { min: 10, max: 10000 }),
  boss_click_damage: v => V.int(v, { min: 1, max: 1000 }),
  boss_regen_per_sec: v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new V.ValidationError('boss_regen_per_sec must be 0–100'); return n; },
  boss_time_limit_sec: v => V.int(v, { min: 10, max: 600 }),
  messages_require_approval: v => V.bool(v),
  show_messages_wall: v => V.bool(v),
  intro_skip_allowed: v => V.bool(v),
  compliment_enabled: v => V.bool(v),
  hero_photo: v => V.filename(v, 'hero_photo'),
  video_evidence: v => v ? V.filename(v, 'video_evidence') : '',
};
router.get('/settings', (req, res) => res.json(allSettings()));
router.put('/settings', (req, res) => {
  const b = req.body || {};
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(b)) {
      if (!SETTING_SCHEMA[k]) throw new V.ValidationError(`Unknown setting: ${k}`);
      setSetting(k, SETTING_SCHEMA[k](v));
    }
  });
  tx();
  res.json(allSettings());
});

module.exports = { router };
