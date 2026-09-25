'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data', 'sir-archives.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  age INTEGER NOT NULL,
  birthday TEXT NOT NULL,
  position TEXT NOT NULL,
  codename TEXT NOT NULL,
  known_weakness TEXT NOT NULL,
  primary_habit TEXT NOT NULL,
  secondary_habit TEXT NOT NULL,
  combat_class TEXT NOT NULL,
  favourite_food TEXT NOT NULL DEFAULT '',
  games TEXT NOT NULL DEFAULT '',
  hero_photo TEXT NOT NULL DEFAULT '',
  made_by TEXT NOT NULL DEFAULT '',
  friends TEXT NOT NULL DEFAULT '[]',
  tagline TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  width INTEGER,
  height INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('oneliner','setup','punchline','callback')),
  topic TEXT NOT NULL DEFAULT 'general',
  text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  times_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roast_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  text TEXT NOT NULL,
  parts TEXT NOT NULL DEFAULT '[]',
  topic TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icon TEXT NOT NULL DEFAULT '🏆',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  visits INTEGER NOT NULL DEFAULT 1,
  user_agent TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL DEFAULT '',
  sections_seen TEXT NOT NULL DEFAULT '[]',
  completed_intro INTEGER NOT NULL DEFAULT 0,
  reached_end INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  game TEXT NOT NULL,
  player TEXT NOT NULL DEFAULT 'Anonymous',
  score INTEGER NOT NULL,
  won INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS easter_eggs (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS easter_egg_finds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  egg_key TEXT NOT NULL REFERENCES easter_eggs(key) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (egg_key, visitor_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  type TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_scores_game ON game_scores(game, score DESC);
CREATE INDEX IF NOT EXISTS idx_roast_history_created ON roast_history(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

db.exec(SCHEMA);

// ── helpers ──────────────────────────────────────────────────
const parseJSON = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? parseJSON(row.value, fallback) : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = parseJSON(r.value, r.value);
  return out;
}

function isEmpty(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n === 0;
}

module.exports = { db, DB_PATH, parseJSON, getSetting, setSetting, allSettings, isEmpty };
