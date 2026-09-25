'use strict';
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
  ? process.env.SESSION_SECRET
  : crypto.randomBytes(32).toString('hex');
const SESSION_MS = (Number(process.env.ADMIN_SESSION_HOURS) || 12) * 3600 * 1000;

function adminEnabled() {
  return typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD.length >= 8;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

// Stateless HMAC token: <expiry>.<nonce>.<sig>
function issueToken() {
  const exp = Date.now() + SESSION_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sign(`${exp}.${nonce}`), sig);
}

function checkPassword(candidate) {
  if (!adminEnabled()) return false;
  return safeEqual(candidate, process.env.ADMIN_PASSWORD);
}

function requireAdmin(req, res, next) {
  if (!adminEnabled()) return res.status(503).json({ error: 'Admin is disabled: set ADMIN_PASSWORD (8+ chars) in .env' });
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = { adminEnabled, checkPassword, issueToken, verifyToken, requireAdmin };
