// Procedural sound engine (Web Audio). No audio files needed. All sounds are
// synthesized so the site works offline and stays tiny. Toggle persists.
const PREF_KEY = 'sir.sound';
let ctx = null, master = null, ambient = null, enabled = false, unlocked = false;
const listeners = new Set();

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}
async function unlock() {
  const c = ensureCtx(); if (!c) return false;
  if (c.state === 'suspended') { try { await c.resume(); } catch { return false; } }
  unlocked = c.state === 'running';
  return unlocked;
}

function tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.25, attack = 0.005, release = 0.08, slide = 0, detune = 0, when = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + release + 0.05);
}
function noise({ dur = 0.3, gain = 0.2, filter = 1200, q = 0.7, type = 'lowpass', when = 0, slide = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + when;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(filter, t0); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, filter + slide), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.05);
}

const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880 };

const LIB = {
  click: () => tone({ freq: 1200, type: 'square', dur: 0.03, gain: 0.08, release: 0.03 }),
  hover: () => tone({ freq: 1800, type: 'sine', dur: 0.02, gain: 0.03, release: 0.02 }),
  tick: () => tone({ freq: 900, type: 'square', dur: 0.015, gain: 0.05, release: 0.02 }),
  type: () => tone({ freq: 500 + Math.random() * 600, type: 'square', dur: 0.01, gain: 0.03, release: 0.01 }),
  pop: () => tone({ freq: 500, type: 'sine', dur: 0.08, gain: 0.25, slide: 400, release: 0.06 }),
  whoosh: () => noise({ dur: 0.45, gain: 0.25, filter: 300, slide: 3000, type: 'bandpass', q: 1.2 }),
  boom: () => { tone({ freq: 90, type: 'sine', dur: 0.5, gain: 0.5, slide: -60, release: 0.3 }); noise({ dur: 0.4, gain: 0.3, filter: 400 }); },
  hit: () => { tone({ freq: 180, type: 'triangle', dur: 0.08, gain: 0.35, slide: -120 }); noise({ dur: 0.08, gain: 0.25, filter: 2500, type: 'highpass' }); },
  glitch: () => { for (let i = 0; i < 6; i++) tone({ freq: 200 + Math.random() * 2000, type: 'sawtooth', dur: 0.03, gain: 0.08, when: i * 0.035 }); },
  error: () => { tone({ freq: 220, type: 'sawtooth', dur: 0.18, gain: 0.2 }); tone({ freq: 160, type: 'sawtooth', dur: 0.25, gain: 0.2, when: 0.16 }); },
  success: () => { [N.C5, N.E5, N.G5].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.2, when: i * 0.09 })); },
  fanfare: () => { [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5, N.C5, N.G5].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.13, gain: 0.12, when: i * 0.11 })); noise({ dur: 0.9, gain: 0.08, filter: 5000, type: 'highpass', when: 0.85 }); },
  egg: () => { [N.E5, N.G5, N.A5, N.E5, N.A5].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.1, gain: 0.18, when: i * 0.07 })); },
  kick: () => { tone({ freq: 260, type: 'sine', dur: 0.06, gain: 0.35, slide: -200 }); noise({ dur: 0.12, gain: 0.2, filter: 1800 }); },
  whistle: () => { tone({ freq: 2200, type: 'square', dur: 0.35, gain: 0.08, detune: 20 }); tone({ freq: 2260, type: 'square', dur: 0.35, gain: 0.06 }); },
  crowd: () => noise({ dur: 2.2, gain: 0.18, filter: 900, q: 0.4, slide: 600 }),
  laser: () => tone({ freq: 1400, type: 'sawtooth', dur: 0.18, gain: 0.15, slide: -1200 }),
  blow: () => noise({ dur: 0.8, gain: 0.35, filter: 700, slide: -500, type: 'lowpass' }),
  confetti: () => { for (let i = 0; i < 10; i++) tone({ freq: 800 + Math.random() * 1600, type: 'sine', dur: 0.05, gain: 0.06, when: Math.random() * 0.5 }); },
  birthday: () => {
    const seq = [[N.C4, .25], [N.C4, .25], [N.D4, .5], [N.C4, .5], [N.F4, .5], [N.E4, 1], [N.C4, .25], [N.C4, .25], [N.D4, .5], [N.C4, .5], [N.G4, .5], [N.F4, 1],
      [N.C4, .25], [N.C4, .25], [N.C5, .5], [N.A4, .5], [N.F4, .5], [N.E4, .5], [N.D4, 1], [N.B4 * 0.9438, .25], [N.B4 * 0.9438, .25], [N.A4, .5], [N.F4, .5], [N.G4, .5], [N.F4, 1]];
    let t = 0; const beat = 0.42;
    for (const [f, d] of seq) { tone({ freq: f, type: 'triangle', dur: d * beat * 0.9, gain: 0.16, when: t }); tone({ freq: f / 2, type: 'sine', dur: d * beat * 0.9, gain: 0.08, when: t }); t += d * beat; }
    return t * 1000;
  },
  power: () => { tone({ freq: 80, type: 'sawtooth', dur: 1.2, gain: 0.15, slide: 300 }); noise({ dur: 1.2, gain: 0.12, filter: 200, slide: 4000 }); },
  scan: () => { for (let i = 0; i < 8; i++) tone({ freq: 600 + i * 120, type: 'sine', dur: 0.05, gain: 0.07, when: i * 0.06 }); },
};

function startAmbient() {
  if (!enabled || !ctx || ambient) return;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o1.type = 'sawtooth'; o1.frequency.value = 55; o2.type = 'sine'; o2.frequency.value = 55.6;
  f.type = 'lowpass'; f.frequency.value = 180; g.gain.value = 0;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  o1.start(); o2.start();
  g.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 2);
  ambient = { stop() { g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6); setTimeout(() => { o1.stop(); o2.stop(); }, 700); } };
}
function stopAmbient() { if (ambient) { ambient.stop(); ambient = null; } }

export const sfx = {
  get enabled() { return enabled; },
  init() {
    try { enabled = localStorage.getItem(PREF_KEY) === 'on'; } catch { enabled = false; }
    // Any first gesture unlocks the context so later sounds can play immediately
    const once = () => { unlock().then(() => { if (enabled) startAmbient(); }); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
    window.addEventListener('pointerdown', once, { passive: true }); window.addEventListener('keydown', once);
    document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend?.(); else if (enabled) ctx.resume?.(); });
  },
  async setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (enabled) { await unlock(); startAmbient(); LIB.power(); } else stopAmbient();
    listeners.forEach(fn => fn(enabled));
  },
  toggle() { return sfx.setEnabled(!enabled); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  play(name) { if (!enabled || !ctx || !unlocked) return 0; const f = LIB[name]; return f ? (f() || 0) : 0; },
  /** Freeze all audio (compliment moment). */
  freeze() { if (ctx && ctx.state === 'running') ctx.suspend(); },
  unfreeze() { if (ctx && enabled) ctx.resume(); },
  /** Attach click / hover sounds to any button inside root. */
  bind(root = document) {
    root.addEventListener('click', (e) => { if (e.target.closest('button, a.btn, [data-sfx]')) sfx.play('click'); });
    root.addEventListener('pointerenter', (e) => { if (e.target.closest?.('.btn')) sfx.play('hover'); }, true);
  },
};
