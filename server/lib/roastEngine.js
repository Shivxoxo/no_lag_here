'use strict';
// Combines roast fragments into non-repetitive roasts:
//   - 45%: one-liner
//   - 55%: setup + punchline (same topic) [+ callback 60% of the time]
// Recently served roasts (per visitor) are avoided.
const { db } = require('../db');

const recent = new Map(); // visitorId -> [ids...]
const RECENT_MAX = 25;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function library(topic) {
  const rows = topic
    ? db.prepare("SELECT * FROM roasts WHERE enabled = 1 AND (topic = ? OR kind = 'callback')").all(topic)
    : db.prepare('SELECT * FROM roasts WHERE enabled = 1').all();
  const by = { oneliner: [], setup: [], punchline: [], callback: [] };
  for (const r of rows) by[r.kind].push(r);
  return by;
}

function generate({ visitorId = null, topic = null } = {}) {
  const lib = library(topic);
  const seen = new Set(recent.get(visitorId) || []);
  const fresh = (arr) => { const f = arr.filter(r => !seen.has(r.id)); return f.length ? f : arr; };

  let parts = [];
  const canCombo = lib.setup.length && lib.punchline.length;
  const useOneLiner = !canCombo || (lib.oneliner.length && Math.random() < 0.45);

  if (useOneLiner && lib.oneliner.length) {
    parts.push(pick(fresh(lib.oneliner)));
  } else {
    const setup = pick(fresh(lib.setup));
    const sameTopic = lib.punchline.filter(p => p.topic === setup.topic);
    const punch = pick(fresh(sameTopic.length ? sameTopic : lib.punchline));
    parts.push(setup, punch);
    if (lib.callback.length && Math.random() < 0.6) parts.push(pick(fresh(lib.callback)));
  }

  const text = parts.map(p => p.text).join(' ');
  const mainTopic = parts[0].topic;

  const tx = db.transaction(() => {
    const bump = db.prepare('UPDATE roasts SET times_used = times_used + 1 WHERE id = ?');
    parts.forEach(p => bump.run(p.id));
    return db.prepare('INSERT INTO roast_history (visitor_id, text, parts, topic) VALUES (?,?,?,?)')
      .run(visitorId, text, JSON.stringify(parts.map(p => p.id)), mainTopic).lastInsertRowid;
  });
  const id = tx();

  if (visitorId) {
    const list = recent.get(visitorId) || [];
    parts.forEach(p => list.push(p.id));
    while (list.length > RECENT_MAX) list.shift();
    recent.set(visitorId, list);
  }

  return { id, text, topic: mainTopic, parts: parts.map(p => ({ kind: p.kind, text: p.text })) };
}

module.exports = { generate };
