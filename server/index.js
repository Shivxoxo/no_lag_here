'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const { seed } = require('./seed');
const { DB_PATH } = require('./db');
const { adminEnabled } = require('./lib/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Seed empty tables from /config on boot (idempotent)
seed({ log: (m) => console.log(`[seed] ${m}`) });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Security headers (no CSP nonce dance: scripts are same-origin + vendored)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Optional CORS (only when frontend is hosted elsewhere)
const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (origins.length) {
  app.use('/api', (req, res, next) => {
    const o = req.get('origin');
    if (o && origins.includes(o)) {
      res.set('Access-Control-Allow-Origin', o);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Visitor-Id');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

// Vendored libraries served straight from node_modules (no build step)
const vendor = (route, dir) => app.use(route, express.static(dir, { maxAge: PROD ? '30d' : 0, immutable: PROD, index: false }));
vendor('/vendor/gsap', path.join(ROOT, 'node_modules/gsap/dist'));
vendor('/vendor/three', path.join(ROOT, 'node_modules/three/build'));
vendor('/vendor/three/jsm', path.join(ROOT, 'node_modules/three/examples/jsm'));

// API
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/admin', adminRoutes.router);
app.use('/api', publicRoutes.router);
app.get('/api/health', (req, res) => res.json({ ok: true, admin: adminEnabled(), uptime: process.uptime() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'No such endpoint. Like nationals selection, it does not exist.' }));

// Static frontend
app.use(express.static(PUBLIC_DIR, {
  maxAge: PROD ? '7d' : 0,
  setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache'); },
}));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/assets/') || req.path.startsWith('/vendor/')) return res.status(404).end();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal error. BRAIN.EXE stopped responding.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  THE SIR ARCHIVES  →  http://localhost:${PORT}`);
    console.log(`  admin panel       →  http://localhost:${PORT}/admin  (${adminEnabled() ? 'enabled' : 'DISABLED: set ADMIN_PASSWORD in .env'})`);
    console.log(`  database          →  ${DB_PATH}\n`);
  });
}

module.exports = app;
