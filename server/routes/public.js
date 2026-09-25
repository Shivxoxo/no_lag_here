'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, parseJSON, allSettings } = require('../db');
const { rateLimit } = require('../lib/rateLimit');
const V = require('../lib/validate');
const roastEngine = require('../lib/roastEngine');
const { PHOTO_DIR } = require('../seed');

const router = express.Router();
const PUBLIC_SETTINGS = ['site_title', 'sound_default', 'boss_max_hp', 'boss_click_damage', 'boss_regen_per_sec', 'boss_time_limit_sec',
  'show_messages_wall', 'intro_skip_allowed', 'compliment_enabled', 'hero_photo', 'video_evidence', 'messages_require_approval'];

// ── helpers ──────────────────────────────────────────────────
const visitorId = (req) => {
  const v = req.get('x-visitor-id');
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
};
const touchVisitor = (id) => { if (id) db.prepare("UPDATE visitors SET last_seen = datetime('now') WHERE id = ?").run(id); };

function profileRow() {
  const p = db.prepare('SELECT * FROM profiles WHERE id = 1').get();
  if (!p) return null;
  return { ...p, friends: parseJSON(p.friends, []) };
}
function photoRows({ includeMissing = false } = {}) {
  const rows = db.prepare('SELECT id, src, title, caption, tags, sort_order, width, height, views, enabled FROM photos ORDER BY sort_order, id').all();
  return rows.map(r => {
    const exists = fs.existsSync(path.join(PHOTO_DIR, r.src));
    const thumb = fs.existsSync(path.join(PHOTO_DIR, 'thumbs', r.src)) ? `assets/photos/thumbs/${r.src}` : null;
    return { ...r, tags: parseJSON(r.tags, []), url: `assets/photos/${r.src}`, thumb, exists, enabled: !!r.enabled };
  }).filter(r => includeMissing || (r.exists && r.enabled));
}
function publicSettings() {
  const all = allSettings();
  const out = {};
  for (const k of PUBLIC_SETTINGS) if (k in all) out[k] = all[k];
  return out;
}
function statsSnapshot() {
  const one = (sql) => db.prepare(sql).get().n;
  return {
    visitors: one('SELECT COUNT(*) AS n FROM visitors'),
    visits: one('SELECT COALESCE(SUM(visits),0) AS n FROM visitors'),
    roasts_generated: one('SELECT COUNT(*) AS n FROM roast_history'),
    messages: one('SELECT COUNT(*) AS n FROM messages WHERE approved = 1'),
    boss_defeats: one("SELECT COUNT(*) AS n FROM game_scores WHERE game = 'boss' AND won = 1"),
    boss_attempts: one("SELECT COUNT(*) AS n FROM game_scores WHERE game = 'boss'"),
    best_boss_score: one("SELECT COALESCE(MAX(score),0) AS n FROM game_scores WHERE game = 'boss'"),
    eggs_found_total: one('SELECT COUNT(*) AS n FROM easter_egg_finds'),
    eggs_total: one('SELECT COUNT(*) AS n FROM easter_eggs WHERE enabled = 1'),
    candles_blown: one("SELECT COUNT(*) AS n FROM events WHERE type = 'cake_blown'"),
    compliments_given: one("SELECT COUNT(*) AS n FROM events WHERE type = 'compliment'"),
    passes_missed: one("SELECT COUNT(*) AS n FROM events WHERE type = 'pass_attempt'"),
  };
}
function eggsFor(vid) {
  const eggs = db.prepare('SELECT key, name, hint, sort_order FROM easter_eggs WHERE enabled = 1 ORDER BY sort_order').all();
  const counts = Object.fromEntries(db.prepare('SELECT egg_key, COUNT(*) AS n FROM easter_egg_finds GROUP BY egg_key').all().map(r => [r.egg_key, r.n]));
  const mine = new Set(vid ? db.prepare('SELECT egg_key FROM easter_egg_finds WHERE visitor_id = ?').all(vid).map(r => r.egg_key) : []);
  return eggs.map(e => ({ ...e, found_by: counts[e.key] || 0, found: mine.has(e.key) }));
}

// ── session / visitor ────────────────────────────────────────
router.post('/visit', rateLimit({ name: 'visit', max: 30 }), (req, res) => {
  let id = visitorId(req);
  const ua = V.str(req.get('user-agent') || '', { max: 300, required: false });
  const referrer = V.str(req.body?.referrer, { max: 300, required: false });
  const screen = V.str(req.body?.screen, { max: 40, required: false });
  const existing = id && db.prepare('SELECT id FROM visitors WHERE id = ?').get(id);
  if (existing) {
    db.prepare("UPDATE visitors SET last_seen = datetime('now'), visits = visits + 1, user_agent = ?, screen = ? WHERE id = ?").run(ua, screen, id);
  } else {
    id = crypto.randomUUID();
    db.prepare('INSERT INTO visitors (id, user_agent, referrer, screen) VALUES (?,?,?,?)').run(id, ua, referrer, screen);
  }
  res.json({ visitor_id: id, returning: !!existing });
});

// ── bootstrap: everything the frontend needs in one call ─────
router.get('/bootstrap', (req, res) => {
  const vid = visitorId(req);
  touchVisitor(vid);
  res.json({
    profile: profileRow(),
    photos: photoRows(),
    timeline: db.prepare('SELECT id, year, title, body FROM timeline WHERE enabled = 1 ORDER BY sort_order, id').all(),
    awards: db.prepare('SELECT id, icon, title, body FROM awards WHERE enabled = 1 ORDER BY sort_order, id').all(),
    settings: publicSettings(),
    stats: statsSnapshot(),
    easter_eggs: eggsFor(vid),
    roast_count: db.prepare('SELECT COUNT(*) AS n FROM roasts WHERE enabled = 1').get().n,
    server_time: new Date().toISOString(),
  });
});

router.get('/profile', (req, res) => res.json(profileRow()));
router.get('/photos', (req, res) => res.json(photoRows()));
router.get('/timeline', (req, res) => res.json(db.prepare('SELECT id, year, title, body FROM timeline WHERE enabled = 1 ORDER BY sort_order, id').all()));
router.get('/awards', (req, res) => res.json(db.prepare('SELECT id, icon, title, body FROM awards WHERE enabled = 1 ORDER BY sort_order, id').all()));
router.get('/settings', (req, res) => res.json(publicSettings()));
router.get('/stats', (req, res) => res.json(statsSnapshot()));

router.post('/photos/:id/view', rateLimit({ name: 'pview', max: 200 }), (req, res) => {
  const id = V.int(req.params.id, { min: 1, name: 'id' });
  db.prepare('UPDATE photos SET views = views + 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── roasts ───────────────────────────────────────────────────
router.get('/roasts', (req, res) => {
  // Public view of the library: counts + a sample. Full text lives behind POST /roast.
  const counts = db.prepare('SELECT kind, COUNT(*) AS n FROM roasts WHERE enabled = 1 GROUP BY kind').all();
  const sample = db.prepare("SELECT text FROM roasts WHERE enabled = 1 AND kind = 'oneliner' ORDER BY RANDOM() LIMIT 5").all().map(r => r.text);
  const recent = db.prepare('SELECT text, created_at FROM roast_history ORDER BY id DESC LIMIT 10').all();
  res.json({ counts: Object.fromEntries(counts.map(c => [c.kind, c.n])), sample, recent, total_generated: db.prepare('SELECT COUNT(*) AS n FROM roast_history').get().n });
});
router.post('/roast', rateLimit({ name: 'roast', max: 120 }), (req, res) => {
  const vid = visitorId(req);
  touchVisitor(vid);
  const topic = req.body?.topic ? V.oneOf(req.body.topic, ['football', 'late', 'anime', 'study', 'gaming', 'gym', 'food', 'general'], 'topic') : null;
  const roast = roastEngine.generate({ visitorId: vid, topic });
  res.json({ ...roast, total_generated: db.prepare('SELECT COUNT(*) AS n FROM roast_history').get().n });
});
router.get('/roasts/history', (req, res) => {
  const limit = V.int(req.query.limit, { min: 1, max: 50, required: false, fallback: 10 });
  res.json(db.prepare('SELECT id, text, topic, created_at FROM roast_history ORDER BY id DESC LIMIT ?').all(limit));
});

// ── birthday messages ────────────────────────────────────────
router.get('/messages', (req, res) => {
  const limit = V.int(req.query.limit, { min: 1, max: 200, required: false, fallback: 100 });
  res.json(db.prepare('SELECT id, name, message, created_at FROM messages WHERE approved = 1 ORDER BY id DESC LIMIT ?').all(limit));
});
router.post('/message', rateLimit({ name: 'msg', max: 10, windowMs: 10 * 60_000 }), (req, res) => {
  const vid = visitorId(req);
  const name = V.str(req.body?.name, { min: 1, max: 40, name: 'name' });
  const message = V.str(req.body?.message, { min: 2, max: 500, name: 'message' });
  if (/https?:\/\//i.test(message)) throw Object.assign(new Error('Links are not allowed in messages'), { status: 400 });
  const approved = allSettings().messages_require_approval ? 0 : 1;
  const r = db.prepare('INSERT INTO messages (visitor_id, name, message, approved) VALUES (?,?,?,?)').run(vid, name, message, approved);
  res.status(201).json({ id: r.lastInsertRowid, name, message, approved: !!approved, created_at: new Date().toISOString() });
});

// ── game scores ──────────────────────────────────────────────
router.post('/game-score', rateLimit({ name: 'score', max: 60 }), (req, res) => {
  const vid = visitorId(req);
  const game = V.oneOf(req.body?.game, ['boss', 'pass', 'gaming'], 'game');
  const player = V.str(req.body?.player, { max: 30, required: false }) || 'Anonymous';
  const score = V.int(req.body?.score, { min: 0, max: 1_000_000, name: 'score' });
  const won = V.bool(req.body?.won);
  const duration_ms = V.int(req.body?.duration_ms, { min: 0, max: 3_600_000, required: false, fallback: null });
  const meta = V.smallObject(req.body?.meta);
  const r = db.prepare('INSERT INTO game_scores (visitor_id, game, player, score, won, duration_ms, meta) VALUES (?,?,?,?,?,?,?)')
    .run(vid, game, player, score, won ? 1 : 0, duration_ms, JSON.stringify(meta));
  const rank = db.prepare('SELECT COUNT(*) + 1 AS n FROM game_scores WHERE game = ? AND score > ?').get(game, score).n;
  res.status(201).json({ id: r.lastInsertRowid, rank, score, won });
});
router.get('/game-scores', (req, res) => {
  const game = req.query.game ? V.oneOf(req.query.game, ['boss', 'pass', 'gaming'], 'game') : 'boss';
  const limit = V.int(req.query.limit, { min: 1, max: 50, required: false, fallback: 10 });
  const rows = db.prepare('SELECT player, score, won, duration_ms, created_at FROM game_scores WHERE game = ? ORDER BY score DESC, duration_ms ASC LIMIT ?').all(game, limit);
  res.json(rows.map(r => ({ ...r, won: !!r.won })));
});

// ── easter eggs ──────────────────────────────────────────────
router.get('/easter-eggs', (req, res) => res.json(eggsFor(visitorId(req))));
router.post('/easter-egg', rateLimit({ name: 'egg', max: 60 }), (req, res) => {
  const vid = visitorId(req);
  const key = V.str(req.body?.key, { min: 1, max: 40, name: 'key' });
  const egg = db.prepare('SELECT key, name FROM easter_eggs WHERE key = ? AND enabled = 1').get(key);
  if (!egg) return res.status(404).json({ error: 'Unknown easter egg' });
  let isNew = false;
  if (vid) {
    const r = db.prepare('INSERT OR IGNORE INTO easter_egg_finds (egg_key, visitor_id) VALUES (?,?)').run(key, vid);
    isNew = r.changes > 0;
  }
  const eggs = eggsFor(vid);
  res.json({ ok: true, egg, new: isNew, found: eggs.filter(e => e.found).length, total: eggs.length, eggs });
});

// ── interaction events ───────────────────────────────────────
const EVENT_TYPES = ['section_view', 'intro_complete', 'reached_end', 'pass_attempt', 'gaming_analyze', 'anime_recommend', 'compliment',
  'cake_blown', 'cake_click', 'boss_start', 'boss_win', 'boss_lose', 'photo_open', 'random_evidence', 'sound_toggle', 'ai_run', 'gym_load', 'food_scan', 'video_play'];
router.post('/event', rateLimit({ name: 'event', max: 300 }), (req, res) => {
  const vid = visitorId(req);
  const type = V.oneOf(req.body?.type, EVENT_TYPES, 'type');
  const meta = V.smallObject(req.body?.meta, { maxLen: 500 });
  db.prepare('INSERT INTO events (visitor_id, type, meta) VALUES (?,?,?)').run(vid, type, JSON.stringify(meta));
  if (vid) {
    if (type === 'intro_complete') db.prepare('UPDATE visitors SET completed_intro = 1 WHERE id = ?').run(vid);
    if (type === 'reached_end') db.prepare('UPDATE visitors SET reached_end = 1 WHERE id = ?').run(vid);
    if (type === 'section_view' && typeof meta.section === 'string') {
      const row = db.prepare('SELECT sections_seen FROM visitors WHERE id = ?').get(vid);
      if (row) {
        const seen = new Set(parseJSON(row.sections_seen, []));
        seen.add(meta.section.slice(0, 40));
        db.prepare('UPDATE visitors SET sections_seen = ? WHERE id = ?').run(JSON.stringify([...seen]), vid);
      }
    }
  }
  res.json({ ok: true });
});

module.exports = { router, photoRows, profileRow, statsSnapshot, publicSettings, PUBLIC_SETTINGS };
