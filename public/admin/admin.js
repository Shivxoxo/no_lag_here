/* ══════════════════════════════════════════════════════════════
   SIR ARCHIVES — Admin console (plain script, no deps, offline)
   Talks to /api/admin/* with a Bearer token kept in sessionStorage.
   ══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const TOKEN_KEY = 'sir.admin.token';
  const API = '/api/admin';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ── tiny DOM helper ─────────────────────────────────────────
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v;
      else if (k in node && k !== 'style' && typeof v !== 'string' || k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  // ── toasts ─────────────────────────────────────────────────
  function toast(msg, type = 'info', ms = 3200) {
    const box = $('#toasts');
    const t = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
    box.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, ms);
  }

  // ── confirm dialog ─────────────────────────────────────────
  function confirmDialog({ title = 'Are you sure?', body = '', okLabel = 'Delete', danger = true } = {}) {
    const dlg = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const ok = dlg.querySelector('[data-act="ok"]');
    ok.textContent = okLabel;
    ok.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    return new Promise((resolve) => {
      const done = (v) => { cleanup(); resolve(v); };
      const onOk = () => { dlg.close(); done(true); };
      const onCancel = () => { dlg.close(); done(false); };
      const onClose = () => done(false);
      function cleanup() {
        ok.removeEventListener('click', onOk);
        dlg.querySelector('[data-act="cancel"]').removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
      }
      ok.addEventListener('click', onOk);
      dlg.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else { cleanup(); resolve(window.confirm(`${title}\n\n${body}`)); }
    });
  }

  // ── API client ─────────────────────────────────────────────
  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

  async function api(method, path, body, { auth = true } = {}) {
    const headers = {};
    const token = getToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) {
      throw new ApiError('Network error — is the server running?', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (auth && res.status === 401) { showLogin('Session expired — please sign in again.'); throw new ApiError('Unauthorized', 401); }
    if (auth && res.status === 503) { showLogin(DISABLED_MSG); throw new ApiError(DISABLED_MSG, 503); }
    if (!res.ok) throw new ApiError((data && data.error) || `${res.status} ${res.statusText}`, res.status);
    return data;
  }
  const GET = (p) => api('GET', p);
  const POST = (p, b) => api('POST', p, b ?? {});
  const PUT = (p, b) => api('PUT', p, b);
  const DEL = (p) => api('DELETE', p);

  const DISABLED_MSG = 'Admin is disabled — set ADMIN_PASSWORD in .env and restart';

  // ── formatting helpers ─────────────────────────────────────
  const fmtNum = (n) => Number(n || 0).toLocaleString();
  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(String(s).includes('T') ? s : s.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const fmtDur = (ms) => { if (ms == null) return '—'; const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
  const shortId = (id) => (id && id.length > 12 ? `${id.slice(0, 8)}…` : id || '—');
  const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
  const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const check = (v) => h('span', { class: v ? 'badge badge--ok' : 'badge badge--off', 'aria-label': v ? 'yes' : 'no' }, v ? '✓' : '—');
  const photoUrl = (p) => '/' + (p.thumb || p.url).replace(/^\/+/, '');

  // Toggle switch component
  function Switch({ checked, label = 'Enabled', onChange, name }) {
    const input = h('input', { type: 'checkbox', checked: !!checked, role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label, name });
    input.addEventListener('change', async () => {
      input.disabled = true;
      try { await onChange(input.checked); input.setAttribute('aria-checked', String(input.checked)); }
      catch (e) { input.checked = !input.checked; toast(e.message, 'error'); }
      finally { input.disabled = false; }
    });
    return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', null, label));
  }

  // Generic data table. columns: [{label, key|render, num, class}]
  function Table({ columns, rows, label, empty = 'Nothing here yet.', stack = true, rowClass }) {
    if (!rows.length) return h('div', { class: 'empty' }, empty);
    const thead = h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', class: [c.num ? 'num' : '', c.class || ''].join(' ').trim() || null }, c.label))));
    const tbody = h('tbody', null, rows.map((r) => h('tr', { class: rowClass ? rowClass(r) : null }, columns.map((c) => {
      const val = c.render ? c.render(r) : r[c.key];
      return h('td', { class: [c.num ? 'num' : '', c.class || '', c.actions ? 'row-actions-cell' : ''].join(' ').trim() || null, 'data-label': c.label, title: c.title ? c.title(r) : null }, val ?? '—');
    }))));
    return h('div', { class: 'table-wrap' }, h('table', { class: stack ? 'stack' : null, 'aria-label': label }, thead, tbody));
  }

  function inlineEditable({ value, onSave, multiline = false, ariaLabel = 'Edit value' }) {
    const span = h('span', { class: 'editable', tabindex: 0, role: 'button', 'aria-label': `${ariaLabel}: ${value}`, title: 'Click to edit' }, value);
    const start = () => {
      const input = h(multiline ? 'textarea' : 'input', { class: 'edit-input', value, 'aria-label': ariaLabel, type: multiline ? undefined : 'text', rows: multiline ? 2 : undefined });
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        const next = input.value.trim();
        if (save && next !== value) {
          try { await onSave(next); value = next; }
          catch (e) { toast(e.message, 'error'); }
        }
        span.textContent = value; span.setAttribute('aria-label', `${ariaLabel}: ${value}`);
        input.replaceWith(span); span.focus();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      span.replaceWith(input); input.focus(); input.select();
    };
    span.addEventListener('click', start);
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
    return span;
  }

  // ── layout: login / app ────────────────────────────────────
  const loginEl = $('#login'), appEl = $('#app');
  function showLogin(message) {
    setToken(null);
    stopAutoRefresh();
    if (typeof viewCleanup === 'function') viewCleanup();
    viewCleanup = null; currentTab = null;
    appEl.hidden = true; loginEl.hidden = false;
    const err = $('#login-error');
    if (message) { err.textContent = message; err.hidden = false; } else err.hidden = true;
    setTimeout(() => $('#login-password').focus(), 0);
  }
  function showApp() {
    loginEl.hidden = true; appEl.hidden = false;
    renderNav(); route();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-submit'), err = $('#login-error'), pw = $('#login-password');
    err.hidden = true; btn.disabled = true;
    try {
      const data = await api('POST', '/login', { password: pw.value }, { auth: false });
      setToken(data.token); pw.value = '';
      toast('Signed in. Welcome back, boss.', 'ok');
      showApp();
    } catch (ex) {
      err.textContent = ex.status === 503 ? DISABLED_MSG : ex.message;
      err.hidden = false; pw.select();
    } finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', () => { showLogin(); toast('Logged out.', 'info'); });
  $('#nav-toggle').addEventListener('click', (e) => {
    const sb = $('.sidebar'); const open = sb.classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // ── routing ────────────────────────────────────────────────
  const TABS = [
    { id: 'overview', label: 'Overview', ico: '◫', render: renderOverview },
    { id: 'profile', label: 'Profile', ico: '☺', render: renderProfile },
    { id: 'roasts', label: 'Roasts', ico: '🔥', render: renderRoasts },
    { id: 'timeline', label: 'Timeline', ico: '⏱', render: (v) => renderSortable(v, TIMELINE_CFG) },
    { id: 'awards', label: 'Awards', ico: '🏆', render: (v) => renderSortable(v, AWARDS_CFG) },
    { id: 'photos', label: 'Photos', ico: '▣', render: renderPhotos },
    { id: 'messages', label: 'Messages', ico: '✉', render: renderMessages },
    { id: 'scores', label: 'Scores', ico: '⚔', render: renderScores },
    { id: 'eggs', label: 'Easter Eggs', ico: '🥚', render: renderEggs },
    { id: 'settings', label: 'Settings', ico: '⚙', render: renderSettings },
    { id: 'danger', label: 'Danger Zone', ico: '⚠', render: renderDanger, danger: true },
  ];
  let currentTab = null;
  let viewCleanup = null;

  function renderNav() {
    const ul = clear($('#nav-list'));
    for (const t of TABS) {
      ul.append(h('li', { role: 'presentation' }, h('a', {
        href: `#${t.id}`, role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'view', 'aria-selected': 'false', class: t.danger ? 'nav--danger' : null, tabindex: '-1',
        onclick: () => { $('.sidebar').classList.remove('is-open'); $('#nav-toggle').setAttribute('aria-expanded', 'false'); },
      }, h('span', { class: 'nav-ico', 'aria-hidden': 'true' }, t.ico), t.label)));
    }
    ul.addEventListener('keydown', (e) => {
      const links = [...ul.querySelectorAll('a')]; const i = links.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % links.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + links.length) % links.length;
      if (e.key === 'Home') n = 0; if (e.key === 'End') n = links.length - 1;
      if (n !== null) { e.preventDefault(); links[n].focus(); links[n].click(); }
    });
  }

  async function route() {
    if (!getToken()) return showLogin();
    const id = (location.hash || '#overview').slice(1).split('?')[0];
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    if (currentTab === tab.id && viewCleanup !== null) return;
    if (typeof viewCleanup === 'function') viewCleanup();
    viewCleanup = null; currentTab = tab.id; stopAutoRefresh();
    for (const a of document.querySelectorAll('.nav a')) {
      const sel = a.getAttribute('href') === `#${tab.id}`;
      a.setAttribute('aria-selected', String(sel)); a.tabIndex = sel ? 0 : -1;
    }
    $('#page-title').textContent = tab.label;
    $('#view').setAttribute('aria-labelledby', `tab-${tab.id}`);
    const view = clear($('#view')); clear($('#page-actions'));
    view.append(h('div', { class: 'loading' }, 'Loading…'));
    try {
      const cleanup = await tab.render(view);
      viewCleanup = typeof cleanup === 'function' ? cleanup : () => {};
    } catch (e) {
      if (e.status === 401 || e.status === 503) return;
      clear(view).append(h('div', { class: 'note note--danger' }, `Failed to load: ${e.message}`));
      viewCleanup = () => {};
    }
  }
  window.addEventListener('hashchange', route);

  // ── auto refresh (overview) ────────────────────────────────
  let refreshTimer = null;
  function startAutoRefresh(fn, ms = 60_000) {
    stopAutoRefresh();
    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible' && currentTab === 'overview') fn(); }, ms);
  }
  function stopAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }

  // ══════════════════════════════════════════════════════════
  // OVERVIEW
  // ══════════════════════════════════════════════════════════
  function barChart(rows, { label, color }) {
    // rows: [{day, n}] newest first → chronological
    const data = [...rows].reverse();
    const W = 600, H = 130, padL = 30, padB = 22, padT = 8;
    const max = Math.max(1, ...data.map((d) => d.n));
    const n = Math.max(data.length, 1);
    const innerW = W - padL - 6, innerH = H - padB - padT;
    const bw = innerW / n;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${label}: ${data.map((d) => `${d.day} ${d.n}`).join(', ') || 'no data'}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const ns = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    svg.append(ns('line', { x1: padL, y1: H - padB, x2: W - 6, y2: H - padB, class: 'axis' }));
    const yt = ns('text', { x: padL - 4, y: padT + 8, 'text-anchor': 'end' }); yt.textContent = max; svg.append(yt);
    const y0 = ns('text', { x: padL - 4, y: H - padB, 'text-anchor': 'end' }); y0.textContent = '0'; svg.append(y0);
    data.forEach((d, i) => {
      const bh = Math.max(1, (d.n / max) * innerH);
      const rect = ns('rect', { x: padL + i * bw + bw * 0.15, y: H - padB - bh, width: bw * 0.7, height: bh, rx: 2, class: 'bar' });
      if (color) rect.style.fill = color;
      const t = ns('title', {}); t.textContent = `${d.day}: ${d.n}`; rect.append(t);
      svg.append(rect);
      if (data.length <= 12 || i % Math.ceil(data.length / 8) === 0) {
        const tx = ns('text', { x: padL + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }); tx.textContent = d.day.slice(5); svg.append(tx);
      }
    });
    if (!data.length) { const t = ns('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }); t.textContent = 'no data yet'; svg.append(t); }
    const total = data.reduce((a, d) => a + d.n, 0);
    return h('div', null, svg, h('div', { class: 'chart-meta' }, h('span', null, data.length ? `${data[0].day} → ${data[data.length - 1].day}` : '—'), h('span', null, `${data.length} days · total ${fmtNum(total)}`)));
  }

  function barList(obj) {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return h('div', { class: 'empty' }, 'No section views recorded yet.');
    const max = entries[0][1] || 1;
    return h('div', { class: 'barlist', role: 'list', 'aria-label': 'Sections viewed' }, entries.map(([k, v]) => h('div', { class: 'barlist-row', role: 'listitem' },
      h('span', { class: 'lbl', title: k }, k),
      h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(2, (v / max) * 100)}%` })),
      h('span', { class: 'val' }, fmtNum(v)))));
  }

  async function renderOverview(view) {
    let lastLoaded = null;
    const stamp = h('span', { class: 'muted small mono' });
    const refreshBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => load(true) }, '↻ Refresh');
    $('#page-actions').append(stamp, refreshBtn);

    async function load(manual) {
      refreshBtn.disabled = true;
      try {
        const d = await GET('/stats');
        lastLoaded = new Date(); stamp.textContent = `updated ${lastLoaded.toLocaleTimeString()}`;
        draw(d);
        if (manual) toast('Stats refreshed.', 'ok', 1500);
      } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
      finally { refreshBtn.disabled = false; }
    }

    function draw(d) {
      const s = d.snapshot || {};
      const tiles = [
        ['Visitors', s.visitors], ['Visits', s.visits], ['Roasts generated', s.roasts_generated], ['Messages (approved)', s.messages],
        ['Boss attempts', s.boss_attempts], ['Boss defeats', s.boss_defeats], ['Best boss score', s.best_boss_score],
        ['Eggs found', s.eggs_found_total, `${s.eggs_total ?? 0} eggs enabled`], ['Candles blown', s.candles_blown],
        ['Compliments given', s.compliments_given], ['Passes missed', s.passes_missed],
      ];
      clear(view).append(
        h('section', { class: 'tiles', 'aria-label': 'Key stats' }, tiles.map(([l, v, sub]) => h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, l), h('span', { class: 'tile-value' }, fmtNum(v)), sub ? h('span', { class: 'tile-sub' }, sub) : null))),
        h('div', { class: 'grid-2' },
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Visitors by day'), h('span', { class: 'muted small' }, 'last 30 days with activity')), barChart(d.visitorsByDay || [], { label: 'Visitors by day' })),
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Roasts by day'), h('span', { class: 'muted small' }, 'generated roasts')), barChart(d.roastsByDay || [], { label: 'Roasts by day', color: '#f2b93b' })),
        ),
        h('div', { class: 'grid-2' },
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Sections viewed')), barList(d.sections || {})),
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Events by type')),
            Table({ label: 'Events by type', stack: false, rows: d.eventsByType || [], columns: [{ label: 'Type', key: 'type', class: 'mono' }, { label: 'Count', num: true, render: (r) => fmtNum(r.n) }] })),
        ),
        h('div', { class: 'grid-2' },
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Top roast lines'), h('a', { href: '#roasts', class: 'small' }, 'manage →')),
            Table({ label: 'Top roast lines', stack: false, rows: d.topRoastLines || [], columns: [
              { label: 'Used', num: true, key: 'times_used' }, { label: 'Kind', render: (r) => h('span', { class: 'badge badge--info' }, r.kind) }, { label: 'Topic', key: 'topic' },
              { label: 'Text', render: (r) => h('span', { class: 'cell-wrap' }, r.text) }] })),
          h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Photo views'), h('a', { href: '#photos', class: 'small' }, 'manage →')),
            Table({ label: 'Photo views', stack: false, rows: d.photoViews || [], columns: [
              { label: 'Views', num: true, key: 'views' }, { label: 'Title', key: 'title' }, { label: 'File', key: 'src', class: 'mono' }] })),
        ),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Recent visitors'), h('span', { class: 'muted small' }, 'last 25 by last seen')),
          Table({ label: 'Recent visitors', stack: false, rows: d.recentVisitors || [], columns: [
            { label: 'ID', render: (r) => h('span', { class: 'mono', title: r.id }, shortId(r.id)) },
            { label: 'First seen', render: (r) => fmtDate(r.first_seen), class: 'nowrap' },
            { label: 'Last seen', render: (r) => fmtDate(r.last_seen), class: 'nowrap' },
            { label: 'Visits', num: true, key: 'visits' },
            { label: 'Screen', key: 'screen', class: 'mono' },
            { label: 'Sections', num: true, render: (r) => (r.sections_seen || []).length, title: (r) => (r.sections_seen || []).join(', ') },
            { label: 'Intro', render: (r) => check(r.completed_intro) },
            { label: 'End', render: (r) => check(r.reached_end) },
            { label: 'User agent', render: (r) => h('span', { class: 'muted' }, truncate(r.user_agent, 40)), title: (r) => r.user_agent },
          ] })),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Easter eggs found'), h('a', { href: '#eggs', class: 'small' }, 'manage →')),
          Table({ label: 'Easter eggs found', stack: false, rows: d.eggs || [], columns: [{ label: 'Key', key: 'key', class: 'mono' }, { label: 'Name', key: 'name' }, { label: 'Found by', num: true, key: 'found_by' }] })),
      );
    }

    await load(false);
    startAutoRefresh(() => load(false));
    return () => stopAutoRefresh();
  }

  // ══════════════════════════════════════════════════════════
  // PROFILE
  // ══════════════════════════════════════════════════════════
  function photoSelect({ photos, value, name, allowEmpty = true }) {
    const sel = h('select', { name, id: `sel-${name}` });
    if (allowEmpty) sel.append(h('option', { value: '' }, '— none —'));
    for (const p of photos) sel.append(h('option', { value: p.src, selected: p.src === value }, `${p.src}${p.exists ? '' : ' (missing)'} — ${p.title}`));
    if (value && !photos.some((p) => p.src === value)) sel.append(h('option', { value, selected: true }, `${value} (not in library)`));
    return sel;
  }
  function heroPicker({ photos, value, name, label }) {
    const img = h('img', { class: 'hero-preview', alt: 'Selected photo preview' });
    const sel = photoSelect({ photos, value, name });
    const update = () => {
      const p = photos.find((x) => x.src === sel.value);
      if (p && p.exists) { img.src = photoUrl(p); img.style.visibility = 'visible'; } else { img.removeAttribute('src'); img.style.visibility = p ? 'visible' : 'hidden'; }
    };
    sel.addEventListener('change', update); update();
    return h('div', { class: 'hero-row' }, h('label', { class: 'field', for: `sel-${name}` }, h('span', { class: 'field-label' }, label), sel), img);
  }

  async function renderProfile(view) {
    const [p, photos] = await Promise.all([GET('/profile'), GET('/photos')]);
    const F = (name, label, opts = {}) => h('label', { class: `field ${opts.span ? 'span-2' : ''}` }, h('span', { class: 'field-label' }, label),
      opts.textarea ? h('textarea', { name, rows: 2, maxlength: opts.max }, p[name] ?? '') : h('input', { type: opts.type || 'text', name, value: p[name] ?? '', required: opts.required, min: opts.min, max: opts.max, maxlength: opts.type ? undefined : opts.max }),
      opts.help ? h('span', { class: 'field-help' }, opts.help) : null);
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'panel', novalidate: true },
      h('div', { class: 'panel-head' }, h('h2', null, 'Target profile'), h('span', { class: 'muted small' }, `last updated ${fmtDate(p.updated_at)}`)),
      h('div', { class: 'form-grid' },
        F('name', 'Full name', { required: true, max: 80 }), F('first_name', 'First name', { required: true, max: 40 }), F('nickname', 'Nickname', { required: true, max: 30 }),
        F('age', 'Age', { type: 'number', min: 1, max: 150, required: true }), F('birthday', 'Birthday', { type: 'date', required: true }),
        F('position', 'Position', { required: true, max: 40 }), F('codename', 'Codename', { required: true, max: 30 }),
        F('known_weakness', 'Known weakness', { max: 80 }), F('primary_habit', 'Primary habit', { max: 80 }), F('secondary_habit', 'Secondary habit', { max: 80 }),
        F('combat_class', 'Combat class', { max: 80 }), F('favourite_food', 'Favourite food', { max: 80 }), F('games', 'Games', { max: 80 }),
        F('made_by', 'Made by', { max: 80 }),
        h('div', { class: 'span-2' }, heroPicker({ photos, value: p.hero_photo, name: 'hero_photo', label: 'Hero photo' })),
        h('label', { class: 'field span-2' }, h('span', { class: 'field-label' }, 'Friends'), h('input', { type: 'text', name: 'friends', value: (p.friends || []).join(', ') }), h('span', { class: 'field-help' }, 'Comma-separated, max 10, 30 chars each.')),
        F('tagline', 'Tagline', { textarea: true, max: 140, span: true }),
      ),
      err,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn--primary' }, 'Save profile'), h('button', { type: 'reset', class: 'btn btn--ghost' }, 'Revert')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const fd = new FormData(form); const body = {};
      for (const [k, v] of fd.entries()) body[k] = v;
      body.age = Number(body.age); body.friends = csv(body.friends);
      form.classList.add('is-busy');
      try {
        const saved = await PUT('/profile', body); Object.assign(p, saved);
        toast('Profile saved.', 'ok');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { form.classList.remove('is-busy'); }
    });
    clear(view).append(form);
  }

  // ══════════════════════════════════════════════════════════
  // ROASTS
  // ══════════════════════════════════════════════════════════
  const KINDS = ['oneliner', 'setup', 'punchline', 'callback'];
  const TOPICS = ['football', 'late', 'anime', 'study', 'gaming', 'gym', 'food', 'general'];
  const selectOf = (list, value, attrs = {}) => h('select', attrs, list.map((v) => h('option', { value: v, selected: v === value }, v)));

  async function renderRoasts(view) {
    let rows = await GET('/roasts');
    const filter = { kind: '', topic: '', q: '' };
    const listEl = h('div');
    const countEl = h('span', { class: 'count-pill' });

    const rerender = () => {
      const q = filter.q.toLowerCase();
      const shown = rows.filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.topic || r.topic === filter.topic) && (!q || r.text.toLowerCase().includes(q)));
      countEl.textContent = `${shown.length} / ${rows.length}`;
      clear(listEl).append(Table({ label: 'Roast lines', rows: shown, empty: 'No roasts match this filter.', rowClass: (r) => (r.enabled ? '' : 'is-off'), columns: [
        { label: 'ID', num: true, key: 'id', class: 'mono' },
        { label: 'Kind', render: (r) => selectOf(KINDS, r.kind, { 'aria-label': `Kind for roast ${r.id}`, onchange: (e) => update(r, { kind: e.target.value }, e.target) }) },
        { label: 'Topic', render: (r) => selectOf(TOPICS, r.topic, { 'aria-label': `Topic for roast ${r.id}`, onchange: (e) => update(r, { topic: e.target.value }, e.target) }) },
        { label: 'Text', render: (r) => h('div', { class: 'cell-wrap' }, inlineEditable({ value: r.text, ariaLabel: `Text of roast ${r.id}`, multiline: true, onSave: (text) => update(r, { text }) })) },
        { label: 'Used', num: true, key: 'times_used' },
        { label: 'Enabled', render: (r) => Switch({ checked: r.enabled, label: '', onChange: (v) => update(r, { enabled: v }) }) },
        { label: 'Actions', actions: true, render: (r) => h('div', { class: 'row-actions' }, h('button', { class: 'btn btn--icon danger', type: 'button', 'aria-label': `Delete roast ${r.id}`, title: 'Delete', onclick: () => remove(r) }, '✕')) },
      ] }));
    };
    async function update(r, patch, ctl) {
      if (ctl) ctl.disabled = true;
      try { const saved = await PUT(`/roasts/${r.id}`, patch); Object.assign(r, saved); toast('Roast saved.', 'ok', 1400); if (patch.kind || patch.topic) rerender(); }
      catch (e) { toast(e.message, 'error'); throw e; }
      finally { if (ctl) ctl.disabled = false; }
    }
    async function remove(r) {
      if (!(await confirmDialog({ title: 'Delete roast line?', body: `"${truncate(r.text, 120)}" will be gone forever.` }))) return;
      try { await DEL(`/roasts/${r.id}`); rows = rows.filter((x) => x.id !== r.id); rerender(); toast('Roast deleted.', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
    }

    const addErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = h('form', { class: 'inline-form', novalidate: true },
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Kind'), selectOf(KINDS, 'oneliner', { name: 'kind' })),
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Topic'), selectOf(TOPICS, 'general', { name: 'topic' })),
      h('label', { class: 'field field--grow' }, h('span', { class: 'field-label' }, 'Text'), h('input', { type: 'text', name: 'text', maxlength: 300, placeholder: 'A devastating roast line (2–300 chars)', required: true })),
      h('button', { type: 'submit', class: 'btn btn--primary' }, '+ Add roast line'));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault(); addErr.hidden = true;
      const fd = new FormData(addForm);
      try {
        const created = await POST('/roasts', { kind: fd.get('kind'), topic: fd.get('topic'), text: fd.get('text') });
        rows.push(created); addForm.text.value = ''; rerender(); toast('Roast added.', 'ok');
      } catch (ex) {
        addErr.textContent = ex.status === 500 ? `${ex.message} (Known backend issue: POST /api/admin/roasts inserts a sort_order column the roasts table does not have.)` : ex.message;
        addErr.hidden = false;
      }
    });

    const filterBar = h('div', { class: 'inline-form' },
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Kind'), h('select', { onchange: (e) => { filter.kind = e.target.value; rerender(); } }, h('option', { value: '' }, 'All kinds'), KINDS.map((k) => h('option', { value: k }, k)))),
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Topic'), h('select', { onchange: (e) => { filter.topic = e.target.value; rerender(); } }, h('option', { value: '' }, 'All topics'), TOPICS.map((k) => h('option', { value: k }, k)))),
      h('label', { class: 'field field--grow' }, h('span', { class: 'field-label' }, 'Search'), h('input', { type: 'search', placeholder: 'Search text…', oninput: (e) => { filter.q = e.target.value; rerender(); } })),
    );

    // history panel
    const histEl = h('div', null, h('div', { class: 'loading' }, 'Loading…'));
    const loadHistory = async () => {
      try {
        const hist = await GET('/roast-history?limit=100');
        clear(histEl).append(Table({ label: 'Roast history', stack: false, rows: hist, empty: 'No roasts generated yet.', columns: [
          { label: 'When', render: (r) => fmtDate(r.created_at), class: 'nowrap' }, { label: 'Topic', render: (r) => h('span', { class: 'badge badge--info' }, r.topic) },
          { label: 'Visitor', render: (r) => h('span', { class: 'mono', title: r.visitor_id || '' }, shortId(r.visitor_id)) },
          { label: 'Roast', render: (r) => h('span', { class: 'cell-wrap' }, r.text) }] }));
      } catch (e) { clear(histEl).append(h('div', { class: 'note note--danger' }, e.message)); }
    };

    clear(view).append(
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Roast lines ', countEl), h('span', { class: 'muted small' }, 'Click a line’s text to edit it; Enter or blur saves, Esc cancels.')), filterBar, listEl),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Add roast line')), addForm, addErr),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Roast history'), h('button', { class: 'btn btn--sm', type: 'button', onclick: loadHistory }, '↻ Refresh')), h('p', { class: 'muted small' }, 'Last 100 roasts generated for visitors.'), histEl),
    );
    rerender(); loadHistory();
  }

  // ══════════════════════════════════════════════════════════
  // TIMELINE & AWARDS (sortable cards)
  // ══════════════════════════════════════════════════════════
  const TIMELINE_CFG = {
    path: '/timeline', noun: 'timeline entry', title: 'Timeline entries',
    fields: [{ name: 'year', label: 'Year', max: 20, required: true }, { name: 'title', label: 'Title', max: 120, required: true, wide: true }, { name: 'body', label: 'Body', max: 400, textarea: true, wide: true }],
    blank: { year: '', title: '', body: '' },
    summary: (r) => `${r.year} — ${r.title}`,
  };
  const AWARDS_CFG = {
    path: '/awards', noun: 'award', title: 'Awards',
    fields: [{ name: 'icon', label: 'Icon', max: 8, help: 'Emoji, max 8 chars' }, { name: 'title', label: 'Title', max: 120, required: true, wide: true }, { name: 'body', label: 'Body', max: 400, textarea: true, wide: true }],
    blank: { icon: '🏆', title: '', body: '' },
    summary: (r) => `${r.icon} ${r.title}`,
  };

  async function renderSortable(view, cfg) {
    let rows = await GET(cfg.path);
    const list = h('div', { class: 'cards', role: 'list', 'aria-label': cfg.title });
    const countEl = h('span', { class: 'count-pill' });

    const fieldInput = (f, value) => {
      const attrs = { name: f.name, maxlength: f.max, required: f.required, 'aria-label': f.label };
      return f.textarea ? h('textarea', { ...attrs, rows: 2 }, value ?? '') : h('input', { ...attrs, type: 'text', value: value ?? '' });
    };

    const card = (r, i) => {
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = h('form', { class: `card ${r.enabled ? '' : 'is-off'}`, novalidate: true, role: 'listitem', 'aria-label': cfg.summary(r) },
        h('div', { class: 'card-head' },
          h('div', { class: 'meta' }, h('span', null, `#${r.id}`), h('span', null, `order ${i + 1}`), r.enabled ? h('span', { class: 'badge badge--ok' }, 'live') : h('span', { class: 'badge badge--off' }, 'hidden')),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Move down', title: 'Move down', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
            h('button', { type: 'button', class: 'btn btn--icon danger', 'aria-label': `Delete ${cfg.noun}`, title: 'Delete', onclick: () => remove(r) }, '✕'))),
        h('div', { class: 'card-fields' }, cfg.fields.map((f) => h('label', { class: `field ${f.wide ? 'wide' : ''}` }, h('span', { class: 'field-label' }, f.label), fieldInput(f, r[f.name]), f.help ? h('span', { class: 'field-help' }, f.help) : null))),
        err,
        h('div', { class: 'card-foot' },
          Switch({ checked: r.enabled, label: 'Enabled', onChange: async (v) => { const saved = await PUT(`${cfg.path}/${r.id}`, { enabled: v }); Object.assign(r, saved); form.classList.toggle('is-off', !v); toast(v ? 'Enabled.' : 'Hidden.', 'ok', 1400); rerender(); } }),
          h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Save'))),
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        const body = {}; for (const f of cfg.fields) body[f.name] = form.elements[f.name].value;
        try { const saved = await PUT(`${cfg.path}/${r.id}`, body); Object.assign(r, saved); toast(`${cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} saved.`, 'ok'); rerender(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
      return form;
    };
    const rerender = () => { countEl.textContent = rows.length; clear(list).append(...(rows.length ? rows.map(card) : [h('div', { class: 'empty' }, `No ${cfg.noun} yet. Add one below.`)])); };
    async function move(i, dir) {
      const j = i + dir; if (j < 0 || j >= rows.length) return;
      const next = [...rows]; [next[i], next[j]] = [next[j], next[i]];
      try { await POST(`${cfg.path}/reorder`, { ids: next.map((r) => r.id) }); rows = next.map((r, k) => ({ ...r, sort_order: k })); rerender(); list.children[j]?.querySelector(dir < 0 ? '[aria-label="Move up"]' : '[aria-label="Move down"]')?.focus(); }
      catch (e) { toast(e.message, 'error'); }
    }
    async function remove(r) {
      if (!(await confirmDialog({ title: `Delete ${cfg.noun}?`, body: `${cfg.summary(r)} will be removed permanently.` }))) return;
      try { await DEL(`${cfg.path}/${r.id}`); rows = rows.filter((x) => x.id !== r.id); rerender(); toast('Deleted.', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
    }

    const addErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = h('form', { class: 'card', novalidate: true },
      h('div', { class: 'card-fields' }, cfg.fields.map((f) => h('label', { class: `field ${f.wide ? 'wide' : ''}` }, h('span', { class: 'field-label' }, f.label), fieldInput(f, cfg.blank[f.name])))),
      addErr,
      h('div', { class: 'card-foot' }, h('span', { class: 'muted small' }, 'New entries are appended at the end.'), h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, `+ Add ${cfg.noun}`)));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault(); addErr.hidden = true;
      const body = {}; for (const f of cfg.fields) body[f.name] = addForm.elements[f.name].value;
      try { const created = await POST(cfg.path, body); rows.push(created); rerender(); for (const f of cfg.fields) addForm.elements[f.name].value = cfg.blank[f.name]; toast('Added.', 'ok'); }
      catch (ex) { addErr.textContent = ex.message; addErr.hidden = false; }
    });

    clear(view).append(
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, cfg.title, ' ', countEl), h('span', { class: 'muted small' }, 'Use ↑ ↓ to reorder; the full order is saved immediately.')), list),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, `Add ${cfg.noun}`)), addForm),
    );
    rerender();
  }

  // ══════════════════════════════════════════════════════════
  // PHOTOS
  // ══════════════════════════════════════════════════════════
  async function renderPhotos(view) {
    let rows = await GET('/photos');
    const grid = h('div', { class: 'photo-grid', role: 'list', 'aria-label': 'Photos' });
    const countEl = h('span', { class: 'count-pill' });

    const card = (p, i) => {
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const thumb = h('div', { class: 'photo-thumb' },
        p.exists ? h('img', { src: photoUrl(p), alt: p.title, loading: 'lazy' }) : h('div', { class: 'missing' }, 'No file on disk', h('br'), h('span', { class: 'mono' }, `public/assets/photos/${p.src}`)),
        !p.exists ? h('span', { class: 'badge badge--danger' }, 'FILE MISSING') : (!p.enabled ? h('span', { class: 'badge badge--off' }, 'hidden') : null),
        h('span', { class: 'views', title: 'Views' }, `👁 ${fmtNum(p.views)}`));
      const form = h('form', { class: `card photo-card ${p.enabled ? '' : 'is-off'}`, novalidate: true, role: 'listitem', 'aria-label': p.title },
        thumb,
        h('div', { class: 'photo-body' },
          h('div', { class: 'card-head' }, h('span', { class: 'photo-src', title: `public/assets/photos/${p.src}` }, `#${p.id} · ${p.src}`, p.width ? ` · ${p.width}×${p.height}` : ''),
            h('div', { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
              h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Move down', title: 'Move down', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓'),
              h('button', { type: 'button', class: 'btn btn--icon danger', 'aria-label': `Delete photo ${p.src}`, title: 'Delete', onclick: () => remove(p) }, '✕'))),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), h('input', { type: 'text', name: 'title', value: p.title, maxlength: 80, required: true })),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Caption'), h('textarea', { name: 'caption', rows: 2, maxlength: 300 }, p.caption || '')),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), h('input', { type: 'text', name: 'tags', value: (p.tags || []).join(', '), placeholder: 'comma, separated' })),
          err,
          h('div', { class: 'card-foot' },
            Switch({ checked: p.enabled, label: 'Enabled', onChange: async (v) => { const saved = await PUT(`/photos/${p.id}`, { enabled: v }); Object.assign(p, saved); toast(v ? 'Photo enabled.' : 'Photo hidden.', 'ok', 1400); rerender(); } }),
            h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Save'))));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        try {
          const saved = await PUT(`/photos/${p.id}`, { title: form.elements.title.value, caption: form.elements.caption.value, tags: csv(form.elements.tags.value) });
          Object.assign(p, saved); toast('Photo saved.', 'ok'); rerender();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
      return form;
    };
    const rerender = () => {
      const missing = rows.filter((p) => !p.exists).length;
      countEl.textContent = `${rows.length}${missing ? ` · ${missing} missing` : ''}`;
      clear(grid).append(...(rows.length ? rows.map(card) : [h('div', { class: 'empty' }, 'No photos yet. Drop files in the folder and scan.')]));
    };
    async function move(i, dir) {
      const j = i + dir; if (j < 0 || j >= rows.length) return;
      const next = [...rows]; [next[i], next[j]] = [next[j], next[i]];
      try { await POST('/photos/reorder', { ids: next.map((r) => r.id) }); rows = next.map((r, k) => ({ ...r, sort_order: k })); rerender(); grid.children[j]?.querySelector(dir < 0 ? '[aria-label="Move up"]' : '[aria-label="Move down"]')?.focus(); }
      catch (e) { toast(e.message, 'error'); }
    }
    async function remove(p) {
      if (!(await confirmDialog({ title: 'Delete photo record?', body: `${p.src} is removed from the archive database. The file on disk is NOT deleted.` }))) return;
      try { await DEL(`/photos/${p.id}`); rows = rows.filter((x) => x.id !== p.id); rerender(); toast('Photo removed.', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
    }

    const scanOut = h('div');
    const scanBtn = h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
      scanBtn.disabled = true;
      try {
        const r = await POST('/photos/scan');
        rows = await GET('/photos'); rerender();
        clear(scanOut).append(h('div', { class: `note ${r.added.length ? '' : 'note--warn'}` },
          r.added.length ? [h('strong', null, `Added ${r.added.length}: `), r.added.join(', ')] : 'No new files found.',
          r.missing.length ? [h('br'), h('strong', null, `Missing on disk (${r.missing.length}): `), r.missing.join(', ')] : null));
        toast(r.added.length ? `Scan complete — ${r.added.length} added.` : 'Scan complete — nothing new.', 'ok');
      } catch (e) { toast(e.message, 'error'); }
      finally { scanBtn.disabled = false; }
    } }, '⟳ Scan folder for new photos');
    $('#page-actions').append(scanBtn);

    const addErr = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = h('form', { class: 'inline-form', novalidate: true },
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Filename'), h('input', { type: 'text', name: 'src', placeholder: 'photo17.jpg', required: true, pattern: '[A-Za-z0-9._-]+' })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), h('input', { type: 'text', name: 'title', maxlength: 80, required: true })),
      h('label', { class: 'field field--grow' }, h('span', { class: 'field-label' }, 'Caption'), h('input', { type: 'text', name: 'caption', maxlength: 300 })),
      h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Tags'), h('input', { type: 'text', name: 'tags', placeholder: 'a, b' })),
      h('button', { type: 'submit', class: 'btn' }, '+ Add by filename'));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault(); addErr.hidden = true;
      const fd = new FormData(addForm);
      try {
        const created = await POST('/photos', { src: fd.get('src'), title: fd.get('title'), caption: fd.get('caption'), tags: csv(fd.get('tags')) });
        rows.push(created); rerender(); addForm.reset(); toast(created.exists ? 'Photo added.' : 'Photo record added — file is missing on disk.', created.exists ? 'ok' : 'warn');
      } catch (ex) { addErr.textContent = ex.message; addErr.hidden = false; }
    });

    clear(view).append(
      h('div', { class: 'note' }, h('strong', null, 'Drop images into '), h('code', null, 'public/assets/photos/'), h('strong', null, ' then click Scan.'), ' Thumbnails are read from ', h('code', null, 'public/assets/photos/thumbs/'), ' when present. Cards with a red badge point at a database row whose file is missing on disk.'),
      scanOut,
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Library ', countEl), h('span', { class: 'muted small' }, 'Order here is the order on the site.')), grid),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Add by filename')), h('p', { class: 'muted small' }, 'Registers a file that already exists (or will exist) in the photos folder.'), addForm, addErr),
    );
    rerender();
  }

  // ══════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════
  async function renderMessages(view) {
    let rows = await GET('/messages');
    const listEl = h('div'); const countEl = h('span', { class: 'count-pill' });
    const rerender = () => {
      const pending = rows.filter((m) => !m.approved).length;
      countEl.textContent = `${rows.length}${pending ? ` · ${pending} pending` : ''}`;
      clear(listEl).append(Table({ label: 'Messages', rows, empty: 'No messages yet.', rowClass: (m) => (m.approved ? '' : 'is-off'), columns: [
        { label: 'ID', num: true, key: 'id', class: 'mono' },
        { label: 'Name', key: 'name' },
        { label: 'Message', render: (m) => h('div', { class: 'cell-wrap' }, m.message) },
        { label: 'Approved', render: (m) => Switch({ checked: m.approved, label: '', onChange: async (v) => { await PUT(`/messages/${m.id}`, { approved: v }); m.approved = v ? 1 : 0; toast(v ? 'Approved.' : 'Unapproved.', 'ok', 1400); } }) },
        { label: 'Time', render: (m) => fmtDate(m.created_at), class: 'nowrap' },
        { label: 'Visitor', render: (m) => h('span', { class: 'mono', title: m.visitor_id || '' }, shortId(m.visitor_id)) },
        { label: 'Actions', actions: true, render: (m) => h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--icon danger', 'aria-label': `Delete message ${m.id}`, title: 'Delete', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete message?', body: `From ${m.name}: "${truncate(m.message, 120)}"` }))) return;
          try { await DEL(`/messages/${m.id}`); rows = rows.filter((x) => x.id !== m.id); rerender(); toast('Message deleted.', 'ok'); } catch (e) { toast(e.message, 'error'); }
        } }, '✕')) },
      ] }));
    };
    $('#page-actions').append(h('button', { class: 'btn btn--sm', type: 'button', onclick: async () => { rows = await GET('/messages'); rerender(); toast('Messages refreshed.', 'ok', 1400); } }, '↻ Refresh'));
    clear(view).append(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Guest messages ', countEl), h('span', { class: 'muted small' }, 'Unapproved messages are hidden from the wall when approval is required (Settings).')), listEl));
    rerender();
  }

  // ══════════════════════════════════════════════════════════
  // SCORES
  // ══════════════════════════════════════════════════════════
  async function renderScores(view) {
    let rows = await GET('/scores');
    let game = '';
    const listEl = h('div'); const countEl = h('span', { class: 'count-pill' });
    const gameSel = h('select', { 'aria-label': 'Filter by game', onchange: (e) => { game = e.target.value; rerender(); } });
    const rerender = () => {
      const games = [...new Set(rows.map((r) => r.game))].sort();
      const cur = gameSel.value; clear(gameSel).append(h('option', { value: '' }, 'All games'), ...games.map((g) => h('option', { value: g, selected: g === cur }, g)));
      const shown = rows.filter((r) => !game || r.game === game).sort((a, b) => b.score - a.score || a.id - b.id);
      countEl.textContent = `${shown.length} / ${rows.length}`;
      clear(listEl).append(Table({ label: 'Game scores', rows: shown, empty: 'No scores recorded yet.', columns: [
        { label: '#', num: true, render: (r, i) => null, class: 'rank' },
        { label: 'Score', num: true, render: (r) => h('strong', null, fmtNum(r.score)) },
        { label: 'Game', render: (r) => h('span', { class: 'badge badge--info' }, r.game) },
        { label: 'Player', key: 'player' },
        { label: 'Won', render: (r) => check(r.won) },
        { label: 'Duration', render: (r) => fmtDur(r.duration_ms), class: 'nowrap' },
        { label: 'Meta', render: (r) => h('span', { class: 'mono muted', title: JSON.stringify(r.meta) }, truncate(Object.entries(r.meta || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '), 60) || '—') },
        { label: 'When', render: (r) => fmtDate(r.created_at), class: 'nowrap' },
        { label: 'Actions', actions: true, render: (r) => h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--icon danger', 'aria-label': `Delete score ${r.id}`, title: 'Delete', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete score?', body: `${r.player} — ${fmtNum(r.score)} (${r.game})` }))) return;
          try { await DEL(`/scores/${r.id}`); rows = rows.filter((x) => x.id !== r.id); rerender(); toast('Score deleted.', 'ok'); } catch (e) { toast(e.message, 'error'); }
        } }, '✕')) },
      ] }));
      // fill rank column
      listEl.querySelectorAll('tbody tr').forEach((tr, i) => { const c = tr.querySelector('td.rank'); if (c) c.textContent = i + 1; });
    };
    $('#page-actions').append(gameSel, h('button', { class: 'btn btn--sm', type: 'button', onclick: async () => { rows = await GET('/scores'); rerender(); toast('Scores refreshed.', 'ok', 1400); } }, '↻ Refresh'));
    clear(view).append(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Leaderboard ', countEl), h('span', { class: 'muted small' }, 'Sorted by score, highest first.')), listEl));
    rerender();
  }

  // ══════════════════════════════════════════════════════════
  // EASTER EGGS
  // ══════════════════════════════════════════════════════════
  async function renderEggs(view) {
    const rows = await GET('/easter-eggs');
    const card = (e) => {
      const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = h('form', { class: `card ${e.enabled ? '' : 'is-off'}`, novalidate: true, role: 'listitem', 'aria-label': e.name },
        h('div', { class: 'card-head' },
          h('div', { class: 'meta' }, h('span', null, e.key), h('span', { class: 'badge badge--info' }, `found by ${fmtNum(e.found_by)}`), e.enabled ? h('span', { class: 'badge badge--ok' }, 'live') : h('span', { class: 'badge badge--off' }, 'disabled'))),
        h('div', { class: 'card-fields card-fields--wide' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), h('input', { type: 'text', name: 'name', value: e.name, maxlength: 60, required: true })),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Hint (public)'), h('input', { type: 'text', name: 'hint', value: e.hint || '', maxlength: 160 })),
          h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, h('span', { class: 'badge badge--warn' }, 'SECRET · admin only'), ' Secret / trigger'), h('input', { type: 'text', name: 'secret', value: e.secret || '', maxlength: 200, class: 'mono' }), h('span', { class: 'field-help' }, 'Shown only here. Never rendered on the public site.'))),
        err,
        h('div', { class: 'card-foot' },
          Switch({ checked: e.enabled, label: 'Enabled', onChange: async (v) => { await PUT(`/easter-eggs/${encodeURIComponent(e.key)}`, { enabled: v }); e.enabled = v ? 1 : 0; form.classList.toggle('is-off', !v); toast(v ? 'Egg enabled.' : 'Egg disabled.', 'ok', 1400); } }),
          h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Save')));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault(); err.hidden = true;
        try {
          await PUT(`/easter-eggs/${encodeURIComponent(e.key)}`, { name: form.elements.name.value, hint: form.elements.hint.value, secret: form.elements.secret.value });
          e.name = form.elements.name.value; form.setAttribute('aria-label', e.name); toast('Egg saved.', 'ok');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
      return form;
    };
    clear(view).append(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Easter eggs ', h('span', { class: 'count-pill' }, rows.length)), h('span', { class: 'muted small' }, 'Eggs are defined in config; only their text and state are editable here.')),
      h('div', { class: 'cards', role: 'list' }, rows.length ? rows.map(card) : h('div', { class: 'empty' }, 'No easter eggs defined.'))));
  }

  // ══════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════
  const SETTINGS_FIELDS = [
    { key: 'site_title', label: 'Site title', type: 'text', max: 60, group: 'Site' },
    { key: 'sound_default', label: 'Sound default', type: 'select', options: ['on', 'off'], group: 'Site', help: 'Browsers still require a click before audio plays.' },
    { key: 'intro_skip_allowed', label: 'Allow skipping the intro', type: 'checkbox', group: 'Site' },
    { key: 'compliment_enabled', label: 'Compliment button enabled', type: 'checkbox', group: 'Site' },
    { key: 'hero_photo', label: 'Hero photo', type: 'photo', group: 'Media' },
    { key: 'video_evidence', label: 'Video evidence filename', type: 'text', group: 'Media', help: 'File in public/assets/photos/, e.g. evidence-video.mp4. Leave blank to hide.' },
    { key: 'boss_max_hp', label: 'Boss max HP', type: 'number', min: 10, max: 10000, group: 'Boss fight' },
    { key: 'boss_click_damage', label: 'Boss click damage', type: 'number', min: 1, max: 1000, group: 'Boss fight' },
    { key: 'boss_regen_per_sec', label: 'Boss regen / sec', type: 'number', min: 0, max: 100, step: 0.1, group: 'Boss fight' },
    { key: 'boss_time_limit_sec', label: 'Boss time limit (sec)', type: 'number', min: 10, max: 600, group: 'Boss fight' },
    { key: 'messages_require_approval', label: 'Messages require approval', type: 'checkbox', group: 'Messages' },
    { key: 'show_messages_wall', label: 'Show messages wall', type: 'checkbox', group: 'Messages' },
  ];

  async function renderSettings(view) {
    const [settings, photos] = await Promise.all([GET('/settings'), GET('/photos')]);
    const initial = { ...settings };
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const dirtyEl = h('span', { class: 'muted small' }, 'No unsaved changes');
    const inputs = {};

    const control = (f) => {
      const v = settings[f.key];
      if (f.type === 'checkbox') { const i = h('input', { type: 'checkbox', name: f.key, checked: !!v }); inputs[f.key] = i; return h('label', { class: 'check' }, i, h('span', null, f.label)); }
      if (f.type === 'select') { const i = selectOf(f.options, v, { name: f.key, id: `set-${f.key}` }); inputs[f.key] = i; return h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), i, f.help ? h('span', { class: 'field-help' }, f.help) : null); }
      if (f.type === 'photo') { const picker = heroPicker({ photos, value: v, name: f.key, label: f.label }); inputs[f.key] = picker.querySelector('select'); return picker; }
      const i = h('input', { type: f.type, name: f.key, value: v ?? '', min: f.min, max: f.max, step: f.step, maxlength: f.type === 'text' ? f.max : undefined });
      inputs[f.key] = i;
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), i, f.help ? h('span', { class: 'field-help' }, f.help) : null);
    };
    const read = (f) => {
      const i = inputs[f.key];
      if (f.type === 'checkbox') return i.checked;
      if (f.type === 'number') return i.value === '' ? '' : Number(i.value);
      return i.value;
    };
    const changed = () => {
      const out = {};
      for (const f of SETTINGS_FIELDS) { const v = read(f); if (String(v) !== String(initial[f.key] ?? '')) out[f.key] = v; }
      return out;
    };
    const updateDirty = () => { const n = Object.keys(changed()).length; dirtyEl.textContent = n ? `${n} unsaved change${n > 1 ? 's' : ''}` : 'No unsaved changes'; };

    const groups = [...new Set(SETTINGS_FIELDS.map((f) => f.group))];
    const form = h('form', { class: 'panel', novalidate: true, oninput: updateDirty, onchange: updateDirty },
      h('div', { class: 'panel-head' }, h('h2', null, 'Site settings'), dirtyEl),
      groups.map((g) => h('fieldset', { class: 'panel', style: 'border-style:solid' }, h('legend', { class: 'small muted', style: 'padding:0 6px' }, g),
        h('div', { class: 'form-grid' }, SETTINGS_FIELDS.filter((f) => f.group === g).map((f) => h('div', { class: f.type === 'photo' ? 'span-2' : null }, control(f)))))),
      err,
      h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn--primary' }, 'Save changes'), h('button', { type: 'reset', class: 'btn btn--ghost', onclick: () => setTimeout(updateDirty, 0) }, 'Revert'), h('span', { class: 'muted small' }, 'Only changed keys are sent.')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const body = changed();
      if (!Object.keys(body).length) return toast('Nothing to save.', 'info', 1400);
      form.classList.add('is-busy');
      try {
        const saved = await PUT('/settings', body);
        Object.assign(initial, saved); Object.assign(settings, saved); updateDirty();
        toast(`Saved ${Object.keys(body).length} setting${Object.keys(body).length > 1 ? 's' : ''}.`, 'ok');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { form.classList.remove('is-busy'); }
    });
    clear(view).append(form);
  }

  // ══════════════════════════════════════════════════════════
  // DANGER ZONE
  // ══════════════════════════════════════════════════════════
  const RESET_TABLES = [
    ['visitors', 'Visitors', 'All visitor records and their section history'], ['events', 'Events', 'Section views, cake, compliments, pass attempts…'],
    ['roast_history', 'Roast history', 'Generated roasts log'], ['game_scores', 'Game scores', 'Boss fight leaderboard'],
    ['easter_egg_finds', 'Easter egg finds', 'Who found which egg'], ['messages', 'Messages', 'All guest messages'],
    ['photo_views', 'Photo views', 'Resets view counters to 0 (keeps photos)'], ['roast_usage', 'Roast usage', 'Resets times_used to 0 (keeps lines)'],
  ];
  async function renderDanger(view) {
    const boxes = {};
    const confirmIn = h('input', { type: 'text', autocomplete: 'off', placeholder: 'RESET', 'aria-label': 'Type RESET to confirm' });
    const btn = h('button', { type: 'submit', class: 'btn btn--danger', disabled: true }, 'Reset selected');
    const out = h('div');
    const refresh = () => { btn.disabled = !(confirmIn.value === 'RESET' && Object.values(boxes).some((b) => b.checked)); };
    const form = h('form', { class: 'panel panel--danger', novalidate: true, oninput: refresh, onchange: refresh },
      h('div', { class: 'panel-head' }, h('h2', null, 'Reset statistics'), h('span', { class: 'badge badge--danger' }, 'irreversible')),
      h('p', { class: 'muted small' }, 'Deletes the selected data permanently. Content (profile, roast lines, photos, timeline, awards, settings) is never touched by this.'),
      h('div', { class: 'danger-list', role: 'group', 'aria-label': 'Tables to reset' }, RESET_TABLES.map(([k, l, d]) => { boxes[k] = h('input', { type: 'checkbox', name: 'tables', value: k }); return h('label', { class: 'check' }, boxes[k], h('span', null, h('strong', null, l), h('br'), h('span', { class: 'muted small' }, d))); })),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--sm', onclick: () => { Object.values(boxes).forEach((b) => (b.checked = true)); refresh(); } }, 'Select all'), h('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => { Object.values(boxes).forEach((b) => (b.checked = false)); refresh(); } }, 'Clear')),
      h('div', { class: 'inline-form' }, h('label', { class: 'field field--sm' }, h('span', { class: 'field-label' }, 'Type RESET to confirm'), confirmIn), btn),
      out);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tables = Object.entries(boxes).filter(([, b]) => b.checked).map(([k]) => k);
      if (!tables.length || confirmIn.value !== 'RESET') return;
      if (!(await confirmDialog({ title: 'Really reset?', body: `This wipes: ${tables.join(', ')}. There is no undo.`, okLabel: 'Yes, reset' }))) return;
      btn.disabled = true;
      try {
        const r = await POST('/reset-stats', { tables });
        clear(out).append(h('div', { class: 'note' }, `Reset: ${r.reset.join(', ')}`));
        Object.values(boxes).forEach((b) => (b.checked = false)); confirmIn.value = ''; toast('Stats reset.', 'ok');
      } catch (ex) { toast(ex.message, 'error'); }
      finally { refresh(); }
    });
    clear(view).append(
      form,
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Full content reset (CLI)')),
        h('p', { class: 'small' }, 'To wipe ', h('em', null, 'everything'), ' — including profile, roast lines, photos, timeline and awards — and re-seed from ', h('code', null, 'config/'), ', stop the server and run:'),
        h('pre', { class: 'note mono', style: 'margin:0;white-space:pre-wrap' }, 'npm run seed:reset'),
        h('p', { class: 'muted small' }, 'This cannot be done from the browser on purpose.')),
    );
  }

  // ── boot ───────────────────────────────────────────────────
  (async function boot() {
    if (!getToken()) {
      // Show a friendly message when admin is disabled server-side.
      try { const s = await api('GET', '/status', undefined, { auth: false }); if (s && s.enabled === false) return showLogin(DISABLED_MSG); } catch { /* ignore */ }
      return showLogin();
    }
    try { await api('GET', '/me'); showApp(); }
    catch (e) { if (e.status !== 401 && e.status !== 503) { showLogin(e.message); } }
  })();
})();
