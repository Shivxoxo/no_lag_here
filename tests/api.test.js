'use strict';
// Run with: npm test   (node --test). Uses a temporary database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = path.join(__dirname, '..', 'data', `test-${process.pid}.db`);
process.env.ADMIN_PASSWORD = 'unit-test-password';
process.env.NODE_ENV = 'test';

let server, base, vid, token;
const j = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(vid ? { 'x-visitor-id': vid } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

before(async () => {
  const app = require('../server/index.js');
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  await new Promise(r => server.close(r));
  for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + s, { force: true });
});

test('health + bootstrap', async () => {
  assert.equal((await j('GET', '/health')).data.ok, true);
  const v = await j('POST', '/visit', { screen: '1x1' });
  assert.equal(v.status, 200); vid = v.data.visitor_id; assert.match(vid, /^[0-9a-f-]{36}$/);
  const b = await j('GET', '/bootstrap');
  assert.equal(b.status, 200);
  assert.equal(b.data.profile.nickname, 'SIR');
  assert.ok(Array.isArray(b.data.photos));
  assert.ok(b.data.easter_eggs.length >= 8);
  assert.ok(b.data.timeline.length > 0 && b.data.awards.length > 0);
});

test('roast generator combines and records history', async () => {
  const seen = new Set();
  for (let i = 0; i < 12; i++) { const r = await j('POST', '/roast', {}); assert.equal(r.status, 200); assert.ok(r.data.text.length > 10); assert.ok(r.data.parts.length >= 1); seen.add(r.data.text); }
  assert.ok(seen.size >= 8, 'roasts should not repeat much');
  const food = await j('POST', '/roast', { topic: 'food' });
  assert.equal(food.data.topic, 'food');
  assert.equal((await j('POST', '/roast', { topic: 'nope' })).status, 400);
  const stats = await j('GET', '/stats');
  assert.equal(stats.data.roasts_generated, 13);
  assert.equal((await j('GET', '/roasts/history?limit=5')).data.length, 5);
});

test('messages validate input', async () => {
  assert.equal((await j('POST', '/message', { name: '', message: 'hi there' })).status, 400);
  assert.equal((await j('POST', '/message', { name: 'Shiv', message: 'visit http://spam.example' })).status, 400);
  const m = await j('POST', '/message', { name: 'Shiv', message: 'Happy birthday SIR' });
  assert.equal(m.status, 201);
  assert.equal((await j('GET', '/messages')).data[0].message, 'Happy birthday SIR');
});

test('game scores + leaderboard', async () => {
  assert.equal((await j('POST', '/game-score', { game: 'boss', score: 'x' })).status, 400);
  const s = await j('POST', '/game-score', { game: 'boss', score: 900, won: true, duration_ms: 12000, player: 'Alex', meta: { combo: 5 } });
  assert.equal(s.status, 201); assert.equal(s.data.rank, 1);
  await j('POST', '/game-score', { game: 'boss', score: 1200, won: true });
  const lb = await j('GET', '/game-scores?game=boss');
  assert.equal(lb.data[0].score, 1200);
});

test('easter eggs are tracked per visitor', async () => {
  const e = await j('POST', '/easter-egg', { key: 'konami' });
  assert.equal(e.status, 200); assert.equal(e.data.new, true); assert.equal(e.data.found, 1);
  assert.equal((await j('POST', '/easter-egg', { key: 'konami' })).data.new, false);
  assert.equal((await j('POST', '/easter-egg', { key: 'nope' })).status, 404);
  const list = await j('GET', '/easter-eggs');
  assert.equal(list.data.find(x => x.key === 'konami').found, true);
  assert.equal(list.data.find(x => x.key === 'konami').secret, undefined, 'secrets never leak publicly');
});

test('events validate type', async () => {
  assert.equal((await j('POST', '/event', { type: 'section_view', meta: { section: 'hero' } })).status, 200);
  assert.equal((await j('POST', '/event', { type: 'evil' })).status, 400);
});

test('admin auth + edits', async () => {
  assert.equal((await j('GET', '/admin/stats')).status, 401);
  assert.equal((await j('POST', '/admin/login', { password: 'wrong' })).status, 401);
  const l = await j('POST', '/admin/login', { password: 'unit-test-password' });
  assert.equal(l.status, 200); token = l.data.token;
  const auth = { authorization: `Bearer ${token}` };
  const st = await j('GET', '/admin/stats', null, auth);
  assert.equal(st.status, 200); assert.equal(st.data.snapshot.visitors, 1); assert.ok(st.data.sections.hero >= 1);
  const p = await j('GET', '/admin/profile', null, auth);
  const upd = await j('PUT', '/admin/profile', { ...p.data, age: 17 }, auth);
  assert.equal(upd.status, 200); assert.equal(upd.data.age, 17);
  assert.equal((await j('GET', '/profile')).data.age, 17);
  assert.equal((await j('PUT', '/admin/profile', { ...p.data, age: 'old' }, auth)).status, 400);
  const t = await j('POST', '/admin/timeline', { year: '2027', title: 'Still SIR', body: 'yes' }, auth);
  assert.equal(t.status, 201);
  assert.equal((await j('DELETE', `/admin/timeline/${t.data.id}`, null, auth)).data.ok, true);
  assert.equal((await j('PUT', '/admin/settings', { bogus: 1 }, auth)).status, 400);
  assert.equal((await j('PUT', '/admin/settings', { boss_max_hp: 120 }, auth)).data.boss_max_hp, 120);
  assert.equal((await j('GET', '/settings')).data.boss_max_hp, 120);
  const scan = await j('POST', '/admin/photos/scan', null, auth);
  assert.equal(scan.status, 200); assert.ok(Array.isArray(scan.data.added));
  const reset = await j('POST', '/admin/reset-stats', { tables: ['roast_history'] }, auth);
  assert.equal(reset.status, 200);
  assert.equal((await j('GET', '/stats')).data.roasts_generated, 0);
});

test('unknown api routes 404 as json; static index served', async () => {
  assert.equal((await j('GET', '/nope')).status, 404);
  const res = await fetch(base.replace('/api', '/'));
  assert.equal(res.status, 200); assert.match(await res.text(), /SIR ARCHIVES/);
});
