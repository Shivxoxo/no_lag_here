'use strict';
// Simple in-memory sliding-window limiter (per IP + bucket). Good enough for a
// birthday website; swap for a store-backed limiter if you scale to millions.
const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 60, name = 'default' } = {}) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let hits = buckets.get(key);
    if (!hits) { hits = []; buckets.set(key, hits); }
    while (hits.length && hits[0] <= now - windowMs) hits.shift();
    if (hits.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many requests. Even SIR is faster than this.' });
    }
    hits.push(now);
    next();
  };
}

// Periodic cleanup so the map does not grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) { if (!hits.length || hits[hits.length - 1] < now - 10 * 60_000) buckets.delete(k); }
}, 5 * 60_000).unref();

module.exports = { rateLimit };
