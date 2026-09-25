// API client — every request carries the visitor id so the backend can track
// sessions, roast stats, easter eggs and scores per visitor.
const VID_KEY = 'sir.visitor';
const BASE = (window.SIR_API_BASE || '') + '/api';

let visitorId = null;
try { visitorId = localStorage.getItem(VID_KEY); } catch { /* private mode */ }

async function request(method, path, body, { keepalive = false } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (visitorId) headers['X-Visitor-Id'] = visitorId;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) { const err = new Error(data?.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

export const api = {
  get visitorId() { return visitorId; },

  /** Register / refresh the visitor session. Must run before bootstrap. */
  async visit() {
    try {
      const data = await request('POST', '/visit', { referrer: document.referrer.slice(0, 300), screen: `${screen.width}x${screen.height}` });
      visitorId = data.visitor_id;
      try { localStorage.setItem(VID_KEY, visitorId); } catch { /* ignore */ }
      return data;
    } catch (e) { console.warn('[api] visit failed', e); return null; }
  },

  bootstrap: () => request('GET', '/bootstrap'),
  profile: () => request('GET', '/profile'),
  photos: () => request('GET', '/photos'),
  stats: () => request('GET', '/stats'),
  roast: (topic) => request('POST', '/roast', topic ? { topic } : {}),
  roastHistory: (limit = 10) => request('GET', `/roasts/history?limit=${limit}`),
  messages: () => request('GET', '/messages'),
  sendMessage: (name, message) => request('POST', '/message', { name, message }),
  submitScore: (payload) => request('POST', '/game-score', payload),
  scores: (game = 'boss', limit = 10) => request('GET', `/game-scores?game=${game}&limit=${limit}`),
  eggs: () => request('GET', '/easter-eggs'),
  unlockEgg: (key) => request('POST', '/easter-egg', { key }),
  photoView: (id) => request('POST', `/photos/${id}/view`).catch(() => {}),

  /** Fire-and-forget interaction event (never throws). */
  event(type, meta = {}) {
    request('POST', '/event', { type, meta }, { keepalive: true }).catch(() => {});
  },
};
