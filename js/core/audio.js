/* RIDGE RUSH — RR.Audio: every sound in the game, synthesized at runtime with the Web Audio API.
 * No audio files are used: SFX are small oscillator/noise recipes, the engine is a continuous synth
 * voice and the music is generated live by a lookahead step sequencer (original material).
 *
 * Contract (docs/ARCHITECTURE.md §6.2) — all implemented:
 *   init() · setSound(on) · setMusic(on) · soundOn · musicOn · play(name, {pitch, volume})
 *   engineStart(style) · engineUpdate({rpm, throttle, load, airborne}) · engineStop()
 *   music(style|null) · duck(on) · suspend() · resume()
 * Additions (never required by other modules):
 *   init() returns true when a context exists (false = Web Audio unavailable).
 *   available (bool, Web Audio constructor present) · context (live AudioContext or null)
 *   musicStyle (current target style or null) · engineStyle (running engine style or null)
 *   SFX_NAMES · MUSIC_STYLES · ENGINE_STYLES (arrays of accepted names)
 *   stats() → {state, voices, songs, musicStyle, engine, errors, lastError}
 *   renderOffline({seconds, sfx, music, engine, sampleRate}) → Promise<{rms, peak, ...}|null>
 *   _pump() runs one scheduler tick synchronously (tests only).
 * Behaviour notes:
 *   - Before init() every call is a cheap no-op; engine/music requests are remembered and start on init.
 *   - Unknown SFX names and unknown music styles are ignored (music(null/''/undefined) fades out).
 *   - The context also auto-suspends while the tab is hidden and resumes when visible, unless the game
 *     called suspend() itself (then only resume() restarts it).
 *   - Every public method is wrapped in try/catch and never throws.
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util || {};

  // ------------------------------------------------------------------ constants & small helpers
  const MAX_VOICES = 24;       // concurrent SFX voices (music has its own, naturally bounded, voices)
  const SFX_LEVEL = 0.85;      // sfx bus gain when sound is on
  const MUSIC_LEVEL = 0.34;    // music bus gain when music is on
  const ENGINE_LEVEL = 0.17;   // engine sub-bus (feeds the sfx bus, so setSound mutes it too)
  const DUCK_LEVEL = 0.35;     // music level while ducked (pause menu)
  const LOOKAHEAD = 0.12;      // s of audio scheduled ahead of the audio clock
  const TICK_MS = 25;          // scheduler wake-up interval
  const XFADE = 1.2;           // music crossfade (s)
  const EPS = 0.0001;          // exponential ramps can't reach 0

  const clamp = U.clamp || ((v, a, b) => (v < a ? a : v > b ? b : v));
  const lerp = U.lerp || ((a, b, t) => a + (b - a) * t);
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // Clamp a frequency into (lo, 0.45·sampleRate) so no automation value ever exceeds Nyquist.
  const fq = (g, f, lo) => clamp(f, lo || 1, g.nyq);
  const makeRng = U.makeRng || function (seed) { // fallback only; utils.js is always loaded first
    let s = seed >>> 0;
    const r = {
      next() { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
      int(a, b) { return a + Math.floor(r.next() * (b - a + 1)); },
      chance(p) { return r.next() < p; },
      pick(arr) { return arr[Math.floor(r.next() * arr.length)]; }
    };
    return r;
  };
  const hashString = U.hashString || ((str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; });
  const hash2 = U.hash2 || ((a, b) => (Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ b) >>> 0);

  // Hold an AudioParam at its current value from time t (so a new ramp starts from where it is).
  function hold(param, t) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(t);
    } else {
      const v = param.value;
      param.cancelScheduledValues(t);
      param.setValueAtTime(num(v, 0), t);
    }
  }
  // Classic percussive envelope: 0 → peak (linear, a s) → ~0 (exponential, d s).
  function env(param, t, a, peak, d) {
    peak = Math.max(peak, EPS * 2);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(EPS, t + a + d);
    return t + a + d;
  }
  // ADSR for held notes. Returns the time the note is fully silent.
  function adsr(param, t, dur, a, d, s, r, peak) {
    peak = Math.max(peak, EPS * 2);
    s = clamp(s, 0.001, 1);
    const tA = t + a;
    const tEnd = Math.max(tA + 0.01, t + dur);
    const tD = Math.min(tA + d, tEnd);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, tA);
    param.exponentialRampToValueAtTime(peak * s, tD);
    param.setValueAtTime(peak * s, tEnd);
    param.exponentialRampToValueAtTime(EPS, tEnd + r);
    return tEnd + r;
  }

  // ------------------------------------------------------------------ module state
  let live = null;              // live graph (see createGraph) — null until init() succeeds
  let soundOn = true;
  let musicOn = true;
  let ducked = false;
  let userSuspended = false;    // suspend() called by the game
  let hiddenSuspended = false;  // tab hidden
  let musicTarget = null;       // style the game asked for (kept while music is off / before init)
  let curSong = null;
  let songCounter = 0;
  let engine = null;
  let pendingEngine = null;     // style requested before init
  const lastEngineParams = { rpm: 0, throttle: 0, load: 0, airborne: false };
  let timer = null;
  let listenersAttached = false;
  let errors = 0;
  let lastError = '';
  let warned = 0;

  function report(e) {
    errors++;
    lastError = String((e && e.message) || e);
    if (warned < 3 && typeof console !== 'undefined') {
      warned++;
      console.warn('[RR.Audio] ' + lastError);
    }
  }

  // ------------------------------------------------------------------ graph
  // Master chain: sfxBus + musicBus → DynamicsCompressor → master gain → destination.
  // Music: songs → musicMix → duck → musicBus. One shared feedback delay feeds musicMix.
  function createGraph(ctx) {
    const g = {
      ctx, offline: false, nyq: ctx.sampleRate * 0.45, voices: [], last: Object.create(null), coinT: -10, coinStreak: 0,
      noise: Object.create(null), curves: new Map(), songs: [], rng: makeRng(0x5eed)
    };
    const gain = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };

    g.master = gain(0.9, ctx.destination);
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -16;
    g.comp.knee.value = 12;
    g.comp.ratio.value = 4;
    g.comp.attack.value = 0.004;
    g.comp.release.value = 0.22;
    g.comp.connect(g.master);

    g.sfxBus = gain(soundOn ? SFX_LEVEL : 0, g.comp);
    g.engineBus = gain(ENGINE_LEVEL, g.sfxBus);
    g.musicBus = gain(musicOn ? MUSIC_LEVEL : 0, g.comp);
    g.duck = gain(ducked ? DUCK_LEVEL : 1, g.musicBus);
    g.musicMix = gain(1, g.duck);

    // Shared tempo-synced feedback delay (echo) for the music: in → delay → tone → (fb → delay, out).
    g.delayIn = gain(1);
    g.delay = ctx.createDelay(2);
    g.delay.delayTime.value = 0.4;
    g.delayTone = ctx.createBiquadFilter();
    g.delayTone.type = 'lowpass';
    g.delayTone.frequency.value = 2600;
    g.delayTone.Q.value = 0.5;
    g.delayFb = gain(0.3);
    g.delayOut = gain(0.55, g.musicMix);
    g.delayIn.connect(g.delay);
    g.delay.connect(g.delayTone);
    g.delayTone.connect(g.delayFb);
    g.delayFb.connect(g.delay);
    g.delayTone.connect(g.delayOut);
    return g;
  }

  // Cached looping noise buffers (1.5 s): white, pink (Paul Kellet filter), brown (leaky integrator).
  function getNoise(g, kind) {
    let b = g.noise[kind];
    if (b) return b;
    const ctx = g.ctx;
    const len = Math.floor(ctx.sampleRate * 1.5);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = makeRng(hashString('noise-' + kind));
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = r.next() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w;
      }
    }
    g.noise[kind] = b;
    return b;
  }

  // Soft-clip transfer curve tanh(kx)/tanh(k), cached per drive amount (k = 0 → linear).
  function getCurve(g, k) {
    const key = Math.round(k * 10);
    let c = g.curves.get(key);
    if (c) return c;
    const n = 1024;
    c = new Float32Array(n);
    const kk = key / 10;
    const norm = kk > 0 ? Math.tanh(kk) : 1;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      c[i] = kk > 0 ? Math.tanh(kk * x) / norm : x;
    }
    g.curves.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------ Voice: a disposable node group
  // Tracks every node it creates; when its last source ends, everything is disconnected.
  class Voice {
    constructor(g, level, dest, registry) {
      this.g = g;
      this.ctx = g.ctx;
      this.nodes = [];
      this.srcs = [];
      this.pending = 0;
      this.end = g.ctx.currentTime;
      this.dead = false;
      this.registry = registry;
      this.out = this.ctx.createGain();
      this.out.gain.value = level;
      this.out.connect(dest);
      this.nodes.push(this.out);
      if (registry) registry.push(this);
    }
    gain(v, dest) {
      const n = this.ctx.createGain();
      n.gain.value = v;
      n.connect(dest || this.out);
      this.nodes.push(n);
      return n;
    }
    filt(type, f, q, dest) {
      const n = this.ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = fq(this.g, f, 10);
      n.Q.value = q;
      n.connect(dest || this.out);
      this.nodes.push(n);
      return n;
    }
    shaper(k, dest) {
      const n = this.ctx.createWaveShaper();
      n.curve = getCurve(this.g, k);
      n.connect(dest || this.out);
      this.nodes.push(n);
      return n;
    }
    osc(type, f, t0, t1, dest) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(fq(this.g, f), t0);
      o.connect(dest || this.out);
      this._src(o, t0, t1, 0);
      return o;
    }
    noise(kind, t0, t1, dest, rate) {
      const s = this.ctx.createBufferSource();
      s.buffer = getNoise(this.g, kind);
      s.loop = true;
      if (rate) s.playbackRate.value = rate;
      s.connect(dest || this.out);
      this._src(s, t0, t1, this.g.rng.next() * 1.2);
      return s;
    }
    _src(s, t0, t1, offset) {
      this.nodes.push(s);
      this.srcs.push(s);
      this.pending++;
      if (t1 > this.end) this.end = t1;
      s.onended = () => { if (--this.pending <= 0) this.dispose(); };
      if (offset) s.start(t0, offset); else s.start(t0);
      s.stop(Math.max(t1, t0 + 0.005));
    }
    // Called after a recipe: a voice that created no sources is released immediately.
    seal() { if (this.pending <= 0) this.dispose(); }
    // Voice stealing: fast fade, stop everything shortly after.
    kill(t) {
      if (this.dead) return;
      try {
        hold(this.out.gain, t);
        this.out.gain.linearRampToValueAtTime(0, t + 0.03);
        for (const s of this.srcs) s.stop(t + 0.04);
      } catch (e) { this.dispose(); }
      this._unregister();
    }
    _unregister() {
      const reg = this.registry;
      if (!reg) return;
      const i = reg.indexOf(this);
      if (i >= 0) reg.splice(i, 1);
      this.registry = null;
    }
    dispose() {
      if (this.dead) return;
      this.dead = true;
      for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
      for (const s of this.srcs) s.onended = null;
      this.nodes.length = 0;
      this.srcs.length = 0;
      this._unregister();
    }
  }

  // ------------------------------------------------------------------ synthesis building blocks
  // Oscillator with pitch sweep f0 → f1 and a percussive envelope. Returns the oscillator.
  function blip(v, type, f0, f1, t, a, d, peak, dest) {
    const gn = v.gain(0, dest);
    const tEnd = env(gn.gain, t, a, peak, d);
    const o = v.osc(type, f0, t, tEnd + 0.02, gn);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(fq(v.g, f1), tEnd);
    return o;
  }
  // Filtered noise burst with filter sweep fq0 → fq1. Returns the filter.
  function hiss(v, kind, t, a, d, peak, ftype, fq0, fq1, q, dest) {
    const gn = v.gain(0, dest);
    const tEnd = env(gn.gain, t, a, peak, d);
    const f = v.filt(ftype, fq0, q, gn);
    if (fq1 && fq1 !== fq0) {
      f.frequency.setValueAtTime(fq(v.g, fq0, 10), t);
      f.frequency.exponentialRampToValueAtTime(fq(v.g, fq1, 10), tEnd);
    }
    v.noise(kind, t, tEnd + 0.02, f);
    return f;
  }
  // Bell: fundamental + inharmonic partials (2.76×, 5.4×) with shorter decays.
  function bell(v, f, t, d, peak, dest) {
    blip(v, 'sine', f, 0, t, 0.002, d, peak, dest);
    blip(v, 'sine', f * 2.76, 0, t, 0.002, d * 0.5, peak * 0.3, dest);
    blip(v, 'sine', f * 5.4, 0, t, 0.001, d * 0.25, peak * 0.12, dest);
  }
  // Brass-like stab: sawtooth through a lowpass whose cutoff opens then settles.
  function brass(v, f, t, holdT, d, peak, dest) {
    const gn = v.gain(0, dest);
    const tEnd = adsr(gn.gain, t, holdT, 0.02, 0.08, 0.7, d, peak);
    const lp = v.filt('lowpass', f * 1.5, 2, gn);
    lp.frequency.setValueAtTime(fq(v.g, f * 1.5, 10), t);
    lp.frequency.exponentialRampToValueAtTime(fq(v.g, f * 7, 10), t + 0.04);
    lp.frequency.exponentialRampToValueAtTime(fq(v.g, f * 3, 10), t + 0.2);
    v.osc('sawtooth', f, t, tEnd + 0.02, lp);
    const o2 = v.osc('sawtooth', f, t, tEnd + 0.02, lp);
    o2.detune.value = 9;
  }
  // Filter frequency path through several points (exponential segments).
  function sweep(v, param, t, pts) {
    param.setValueAtTime(fq(v.g, pts[0][1], 10), t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(fq(v.g, pts[i][1], 10), t + pts[i][0]);
  }

  // ------------------------------------------------------------------ SFX recipes
  // Each recipe: (voice, startTime, pitchMultiplier, opts). Output level is set on voice.out.
  const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, Gs6: 1661.22, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02, G4: 392 };

  const SFX = {
    click(v, t, p) {
      blip(v, 'triangle', 1900 * p, 1150 * p, t, 0.001, 0.035, 0.55);
      hiss(v, 'white', t, 0.001, 0.014, 0.18, 'highpass', 5200, 0, 0.7);
    },
    coin(v, t, p) {
      // Bright two-tone "ding": E6 then B6, each with a soft octave overtone.
      blip(v, 'triangle', N.E6 * p, 0, t, 0.002, 0.09, 0.4);
      blip(v, 'sine', N.E6 * 2 * p, 0, t, 0.002, 0.05, 0.08);
      blip(v, 'triangle', N.B6 * p, 0, t + 0.06, 0.002, 0.28, 0.42);
      blip(v, 'sine', N.B6 * 2 * p, 0, t + 0.06, 0.002, 0.12, 0.1);
    },
    coinBig(v, t, p) {
      const notes = [N.E6, N.Gs6, N.B6, N.E7]; // E major arpeggio
      for (let i = 0; i < notes.length; i++) {
        blip(v, 'triangle', notes[i] * p, 0, t + i * 0.05, 0.002, i === 3 ? 0.6 : 0.22, 0.32);
      }
      bell(v, N.E7 * p, t + 0.15, 0.7, 0.14);
      hiss(v, 'white', t + 0.1, 0.02, 0.45, 0.05, 'highpass', 9000, 0, 0.7);
    },
    fuel(v, t, p) {
      // Gurgle: resonant lowpass noise whose cutoff is wobbled by a fast square LFO…
      const f = hiss(v, 'brown', t, 0.01, 0.32, 0.9, 'lowpass', 650 * p, 0, 7);
      const lfo = v.osc('square', 21, t, t + 0.36, v.gain(380 * p, f.frequency));
      lfo.frequency.linearRampToValueAtTime(34, t + 0.34);
      // …then a filling up-sweep and a confirmation ding.
      blip(v, 'sine', 260 * p, 980 * p, t + 0.12, 0.02, 0.3, 0.32);
      blip(v, 'triangle', 520 * p, 1960 * p, t + 0.12, 0.02, 0.3, 0.08);
      bell(v, N.G6 * p, t + 0.4, 0.35, 0.2);
    },
    powerup(v, t, p) {
      const semis = [0, 4, 7, 12, 16, 19, 24];
      for (let i = 0; i < semis.length; i++) {
        const f = N.C6 * Math.pow(2, semis[i] / 12) * p;
        blip(v, 'triangle', f, 0, t + i * 0.04, 0.002, 0.2, 0.26 - i * 0.02);
        blip(v, 'square', f * 0.5, 0, t + i * 0.04, 0.002, 0.06, 0.035);
      }
      hiss(v, 'white', t + 0.05, 0.05, 0.45, 0.06, 'highpass', 7500, 0, 0.7);
    },
    crash(v, t, p) {
      hiss(v, 'white', t, 0.002, 0.55, 0.85, 'lowpass', 7000 * p, 250, 0.7);   // impact burst
      blip(v, 'sine', 120 * p, 38, t, 0.002, 0.35, 1.0);                        // low thud
      const hp = v.filt('highpass', 700, 0.7);                                    // metallic clank
      blip(v, 'square', 523 * p, 0, t + 0.01, 0.001, 0.22, 0.07, hp);
      blip(v, 'square', 1307 * p, 0, t + 0.01, 0.001, 0.18, 0.05, hp);
      blip(v, 'square', 2213 * p, 0, t + 0.01, 0.001, 0.12, 0.04, hp);
      bell(v, 830 * p, t + 0.02, 0.5, 0.12);
      const debris = [0.08, 0.15, 0.23, 0.32];                                    // rattling debris
      for (let i = 0; i < debris.length; i++) {
        hiss(v, 'white', t + debris[i], 0.001, 0.05, 0.3 - i * 0.06, 'bandpass', 2500 * p, 0, 1.5);
      }
    },
    jump(v, t, p) {
      blip(v, 'sine', 240 * p, 620 * p, t, 0.004, 0.14, 0.4);
      hiss(v, 'white', t, 0.01, 0.14, 0.12, 'bandpass', 800 * p, 2400 * p, 1.2);
    },
    land(v, t, p) {
      blip(v, 'sine', 95 * p, 42 * p, t, 0.002, 0.14, 0.85);
      hiss(v, 'brown', t, 0.002, 0.1, 0.55, 'lowpass', 520 * p, 200, 0.8);
    },
    landHard(v, t, p) {
      blip(v, 'sine', 75 * p, 30, t, 0.002, 0.32, 1.0);
      hiss(v, 'white', t, 0.002, 0.28, 0.65, 'lowpass', 1400 * p, 150, 0.8);
      const bp = v.filt('bandpass', 900 * p, 3);                                  // suspension creak
      blip(v, 'sawtooth', 190 * p, 120 * p, t + 0.03, 0.005, 0.12, 0.12, bp);
      hiss(v, 'white', t + 0.06, 0.001, 0.05, 0.2, 'bandpass', 2200, 0, 1.4);
      hiss(v, 'white', t + 0.13, 0.001, 0.04, 0.12, 'bandpass', 2600, 0, 1.4);
    },
    flip(v, t, p) {
      const f = hiss(v, 'pink', t, 0.08, 0.32, 0.55, 'bandpass', 500 * p, 0, 1.2);
      sweep(v, f.frequency, t, [[0, 500 * p], [0.18, 3200 * p], [0.4, 900 * p]]);
      blip(v, 'sine', N.G6 * p, 0, t + 0.28, 0.003, 0.3, 0.3);
      blip(v, 'sine', N.D6 * 2 * p, 0, t + 0.33, 0.003, 0.35, 0.25);
    },
    perfect(v, t, p) {
      const chord = [N.C6, N.E6, N.G6, N.C7];
      for (let i = 0; i < chord.length; i++) {
        blip(v, 'triangle', chord[i] * p, 0, t + i * 0.012, 0.004, 0.7, 0.18);
      }
      bell(v, N.C7 * 2 * p, t + 0.05, 0.4, 0.06);
      hiss(v, 'white', t, 0.04, 0.4, 0.05, 'highpass', 8000, 0, 0.7);
    },
    combo(v, t, p) {
      const base = 587.33 * p;
      const lp = v.filt('lowpass', 3200, 1);
      blip(v, 'square', base, base * 1.5, t, 0.003, 0.1, 0.2, lp);
      blip(v, 'sine', base * 2, base * 3, t, 0.003, 0.09, 0.12);
    },
    upgrade(v, t, p) {
      for (let i = 0; i < 6; i++) {                                               // ratchet
        const ti = t + i * 0.028;
        hiss(v, 'white', ti, 0.001, 0.02, 0.35, 'bandpass', 3200 * p, 0, 4);
        blip(v, 'square', 180 * p, 0, ti, 0.001, 0.015, 0.08);
      }
      bell(v, N.E6 * p, t + 0.19, 0.6, 0.22);                                     // chime
      bell(v, N.B6 * p, t + 0.25, 0.7, 0.2);
    },
    unlock(v, t, p) {
      brass(v, N.G4 * p, t, 0.07, 0.06, 0.16);
      brass(v, N.C5 * p, t + 0.09, 0.07, 0.06, 0.16);
      brass(v, N.E5 * p, t + 0.18, 0.07, 0.06, 0.16);
      const chord = [N.C5, N.E5, N.G5, N.C6];
      for (let i = 0; i < chord.length; i++) brass(v, chord[i] * p, t + 0.27, 0.35, 0.5, 0.11);
      bell(v, N.C7 * p, t + 0.27, 0.9, 0.1);
      hiss(v, 'white', t + 0.27, 0.05, 0.6, 0.04, 'highpass', 8000, 0, 0.7);
    },
    mission(v, t, p) {
      const seq = [[0, N.C6], [0.08, N.E6], [0.16, N.G6], [0.24, N.E6], [0.32, N.C7]];
      for (let i = 0; i < seq.length; i++) {
        const last = i === seq.length - 1;
        blip(v, 'triangle', seq[i][1] * p, 0, t + seq[i][0], 0.003, last ? 0.55 : 0.12, 0.26);
        blip(v, 'sine', seq[i][1] * 2 * p, 0, t + seq[i][0], 0.002, 0.06, 0.06);
      }
      bell(v, N.G6 * p, t + 0.32, 0.6, 0.12);
    },
    record(v, t, p) {
      const arp = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6, N.C7];
      for (let i = 0; i < arp.length; i++) brass(v, arp[i] * p, t + i * 0.055, 0.04, 0.08, 0.12);
      const chord = [N.C5, N.G5, N.C6, N.E6];
      for (let i = 0; i < chord.length; i++) brass(v, chord[i] * p, t + 0.42, 0.5, 0.6, 0.1);
      bell(v, N.C7 * p, t + 0.42, 1.0, 0.12);
      hiss(v, 'white', t + 0.4, 0.05, 0.8, 0.05, 'highpass', 8000, 0, 0.7);
    },
    levelup(v, t, p) {
      const semis = [0, 2, 4, 5, 7, 9, 11, 12];
      const lp = v.filt('lowpass', 4000, 1);
      for (let i = 0; i < semis.length; i++) {
        blip(v, 'square', N.G5 * Math.pow(2, semis[i] / 12) * p, 0, t + i * 0.035, 0.002, 0.05, 0.12, lp);
      }
      const chord = [N.C6, N.E6, N.G6, N.B6];
      for (let i = 0; i < chord.length; i++) blip(v, 'triangle', chord[i] * p, 0, t + 0.3, 0.005, 0.8, 0.15);
      const f = hiss(v, 'pink', t, 0.3, 0.3, 0.2, 'bandpass', 400, 0, 1.4);
      sweep(v, f.frequency, t, [[0, 400], [0.35, 5000]]);
    },
    warning(v, t, p) {
      const lp = v.filt('lowpass', 2500, 0.8);
      for (let i = 0; i < 4; i++) {
        const gn = v.gain(0, lp);
        const ti = t + i * 0.13;
        adsr(gn.gain, ti, 0.1, 0.005, 0.02, 0.9, 0.03, 0.22);
        v.osc('square', (i % 2 ? 660 : 880) * p, ti, ti + 0.15, gn);
      }
    },
    whoosh(v, t, p) {
      const gn = v.gain(0);
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.6, t + 0.15);
      gn.gain.exponentialRampToValueAtTime(EPS, t + 0.45);
      const f = v.filt('bandpass', 350 * p, 1.4, gn);
      sweep(v, f.frequency, t, [[0, 350 * p], [0.18, 2400 * p], [0.45, 500 * p]]);
      v.noise('pink', t, t + 0.47, f);
    },
    boost(v, t, p) {
      // Rising roar: sawtooth sweep through an opening lowpass + noise swell + sub.
      const amp = v.gain(0);
      env(amp.gain, t, 0.05, 0.35, 0.75);
      const lp = v.filt('lowpass', 300, 1.5, amp);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(2800, t + 0.6);
      const o = v.osc('sawtooth', 70 * p, t, t + 0.82, lp);
      o.frequency.exponentialRampToValueAtTime(210 * p, t + 0.7);
      hiss(v, 'brown', t, 0.1, 0.7, 0.5, 'lowpass', 400, 2500, 0.8);
      blip(v, 'sine', 45 * p, 90 * p, t, 0.05, 0.6, 0.4);
    },
    shield(v, t, p) {
      // Glassy FM tone: a sine carrier modulated by a 1.5× sine whose index decays.
      const gn = v.gain(0);
      const tEnd = env(gn.gain, t, 0.005, 0.25, 0.8);
      const car = v.osc('sine', 1480 * p, t, tEnd + 0.02, gn);
      car.frequency.linearRampToValueAtTime(1560 * p, tEnd);
      const idx = v.gain(0, car.frequency);
      idx.gain.setValueAtTime(600 * p, t);
      idx.gain.exponentialRampToValueAtTime(5, tEnd);
      v.osc('sine', 2220 * p, t, tEnd + 0.02, idx);
      blip(v, 'sine', 2960 * 1.003 * p, 0, t, 0.005, 0.6, 0.08);
      hiss(v, 'white', t, 0.02, 0.3, 0.05, 'highpass', 6000, 0, 0.7);
    },
    error(v, t, p) {
      const lp = v.filt('lowpass', 800, 1);
      for (let i = 0; i < 2; i++) {
        const ti = t + i * 0.14;
        const gn = v.gain(0, lp);
        adsr(gn.gain, ti, 0.09, 0.005, 0.02, 0.9, 0.04, 0.24);
        v.osc('sawtooth', 110 * p, ti, ti + 0.15, gn);
        v.osc('sawtooth', 113 * p, ti, ti + 0.15, gn);
      }
    },
    tick(v, t, p) {
      blip(v, 'triangle', 2800 * p, 2400 * p, t, 0.0005, 0.018, 0.45);
    },
    thruster(v, t, p) {
      const bp = v.filt('bandpass', 1200, 2);
      const o = blip(v, 'sawtooth', 180 * p, 0, t, 0.01, 0.55, 0.22, bp);
      o.frequency.exponentialRampToValueAtTime(760 * p, t + 0.5);
      // Ion crackle: bandpassed noise chopped by a 30 Hz square tremolo.
      const trem = v.gain(0.5);
      hiss(v, 'white', t, 0.01, 0.6, 0.25, 'bandpass', 2500 * p, 0, 1, trem);
      v.osc('square', 30, t, t + 0.63, v.gain(0.5, trem.gain));
      blip(v, 'sine', 90 * p, 50 * p, t, 0.002, 0.2, 0.5);
    },
    explosion(v, t, p) {
      hiss(v, 'white', t, 0.002, 0.4, 0.5, 'lowpass', 6000 * p, 500, 0.7);        // initial blast
      hiss(v, 'brown', t, 0.003, 1.3, 1.0, 'lowpass', 2400 * p, 90, 0.7);          // rolling rumble
      blip(v, 'sine', 70 * p, 24, t, 0.003, 0.8, 1.0);                            // sub punch
      for (let i = 0; i < 7; i++) {                                                // crackle
        const ti = t + 0.05 + v.g.rng.next() * 0.85;
        hiss(v, 'white', ti, 0.001, 0.03, 0.25, 'highpass', 3000, 0, 0.7);
      }
    },
    lava(v, t, p) {
      hiss(v, 'brown', t, 0.15, 0.8, 0.4, 'lowpass', 220, 0, 0.7);                 // rumble
      for (let i = 0; i < 7; i++) {                                                // bubbles
        const ti = t + v.g.rng.next() * 0.7;
        const f0 = (140 + v.g.rng.next() * 120) * p;
        blip(v, 'sine', f0, f0 * 2.4, ti, 0.003, 0.06, 0.3);
      }
    },
    wind(v, t, p) {
      const gn = v.gain(0);
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.5, t + 0.6);
      gn.gain.exponentialRampToValueAtTime(EPS, t + 1.8);
      const f = v.filt('bandpass', 500 * p, 0.9, gn);
      sweep(v, f.frequency, t, [[0, 500 * p], [0.7, 1300 * p], [1.8, 450 * p]]);
      v.noise('pink', t, t + 1.82, f);
    },
    // Internal: rally turbo blow-off valve "pssh-tu-tu" (triggered by the engine on throttle release).
    blowoff(v, t, p) {
      const trem = v.gain(0.6);
      hiss(v, 'white', t, 0.005, 0.35, 0.4, 'bandpass', 3500 * p, 1400 * p, 1.2, trem);
      v.osc('square', 38, t, t + 0.38, v.gain(0.4, trem.gain));
    }
  };
  const SFX_NAMES = ['click', 'coin', 'coinBig', 'fuel', 'powerup', 'crash', 'jump', 'land', 'landHard', 'flip',
    'perfect', 'combo', 'upgrade', 'unlock', 'mission', 'record', 'levelup', 'warning', 'whoosh', 'boost',
    'shield', 'error', 'tick', 'thruster', 'explosion', 'lava', 'wind'];

  // Per-name output level (voice gain before opts.volume).
  const LEVEL = { click: 0.6, coin: 0.6, coinBig: 0.7, tick: 0.7, combo: 0.8, whoosh: 1.0, wind: 0.6, lava: 0.7,
    crash: 0.9, explosion: 0.95, land: 0.8, landHard: 0.9, warning: 0.7, blowoff: 0.45 };
  // Minimum interval between two plays of the same name (s).
  const RATE = { coin: 0.035, coinBig: 0.06, tick: 0.04, click: 0.03, combo: 0.05, land: 0.08, landHard: 0.12,
    jump: 0.08, flip: 0.15, whoosh: 0.08, warning: 0.25, crash: 0.2, explosion: 0.08, lava: 0.15, wind: 0.4,
    boost: 0.25, fuel: 0.08, error: 0.12, shield: 0.2, thruster: 0.2, powerup: 0.1, perfect: 0.15,
    upgrade: 0.08, unlock: 0.3, mission: 0.3, record: 0.5, levelup: 0.5, blowoff: 0.6 };

  // Play an SFX on graph g at time `when` (0 = now). Returns true when a voice was started.
  function playOn(g, name, opts, when, dest) {
    const recipe = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
    if (!recipe) return false;
    const ctx = g.ctx;
    // Don't queue sounds on a stalled clock (they would all fire at once on resume).
    if (!g.offline && ctx.state !== 'running') return false;
    const t = Math.max(ctx.currentTime, num(when, 0)) + 0.005;
    const last = g.last[name];
    if (last !== undefined && t - last < (RATE[name] || 0.02) && t >= last) return false;
    let pitch = clamp(num(opts && opts.pitch, 1), 0.25, 4);
    const vol = clamp(num(opts && opts.volume, 1), 0, 2);
    if (vol < 0.001) return false;
    g.last[name] = t;

    if (name === 'coin') {
      // Rapid successive pickups climb in half-semitone steps (max +6 semitones), reset after a pause.
      g.coinStreak = t - g.coinT < 0.45 ? Math.min(g.coinStreak + 1, 12) : 0;
      g.coinT = t;
      pitch *= Math.pow(2, (g.coinStreak * 0.5) / 12);
    }

    // Voice limiting: drop finished voices, then steal the oldest if we're at the cap.
    // (Compare with the audio clock, not t: offline renders schedule voices far in the future.)
    const vs = g.voices;
    const now = ctx.currentTime;
    for (let i = vs.length - 1; i >= 0; i--) if (vs[i].end < now - 0.25) vs[i].dispose();
    while (vs.length >= MAX_VOICES) vs[0].kill(Math.max(now, Math.min(t, vs[0].end)));

    const v = new Voice(g, (LEVEL[name] || 0.8) * vol, dest || g.sfxBus, vs);
    try {
      recipe(v, t, pitch, opts || {});
    } catch (e) {
      v.kill(t);
      throw e;
    }
    v.seal();
    return true;
  }

  // ------------------------------------------------------------------ engine
  // Styles: fundamental range (Hz) idle→max, two oscillators (+ ratio/detune), sub, noise rasp,
  // drive (waveshaper), lowpass range, burble LFO (idle lope) and an optional whine (turbo/turbine).
  const ENGINE = {
    buggy: { idle: 42, max: 165, w1: 'sawtooth', w2: 'square', m1: 0.5, m2: 0.28, r2: 1.0, det: 9, sub: 0.45,
      noise: 0.1, nf: 1300, nq: 0.9, drive: 2.5, cutLo: 480, cutHi: 3000, q: 1.2, burble: 0.5, bRate: 7, bTrack: 1.5, vol: 0.5 },
    dirt: { idle: 68, max: 300, w1: 'square', w2: 'square', m1: 0.55, m2: 0.12, r2: 2.0, det: 4, sub: 0.12,
      noise: 0.16, nf: 2600, nq: 1.2, drive: 4, cutLo: 900, cutHi: 5200, q: 2.5, burble: 0.35, bRate: 11, bTrack: 2, vol: 0.33 },
    truck: { idle: 30, max: 104, w1: 'sawtooth', w2: 'sawtooth', m1: 0.5, m2: 0.45, r2: 1.0, det: 14, sub: 0.8,
      noise: 0.07, nf: 650, nq: 0.8, drive: 3, cutLo: 300, cutHi: 1900, q: 1.5, burble: 0.75, bRate: 4.5, bTrack: 2.5, vol: 0.45 },
    rally: { idle: 48, max: 215, w1: 'sawtooth', w2: 'square', m1: 0.5, m2: 0.3, r2: 1.0, det: -8, sub: 0.35,
      noise: 0.28, nf: 2200, nq: 1.4, drive: 5, cutLo: 650, cutHi: 4600, q: 1.8, burble: 0.45, bRate: 8, bTrack: 1.8, vol: 0.38,
      whine: [1800, 5400], whineGain: 0.035, whineThrottle: true, blowoff: true },
    crawler: { idle: 24, max: 78, w1: 'square', w2: 'sawtooth', m1: 0.45, m2: 0.35, r2: 2.0, det: 6, sub: 0.75,
      noise: 0.2, nf: 700, nq: 1.5, drive: 3.5, cutLo: 240, cutHi: 1250, q: 2, burble: 0.8, bRate: 3.4, bTrack: 2.2, vol: 0.4, lfoW: 'square' },
    storm: { idle: 150, max: 720, w1: 'sine', w2: 'triangle', m1: 0.6, m2: 0.3, r2: 2.005, det: 0, sub: 0.35, subW: 'triangle',
      noise: 0, nf: 1000, nq: 1, drive: 0, cutLo: 1500, cutHi: 6500, q: 0.7, burble: 0, bRate: 1, bTrack: 0, vol: 0.75,
      whine: [900, 4200], whineGain: 0.07, whineThrottle: false }
  };

  class Engine {
    constructor(g, style) {
      this.g = g;
      this.style = Object.prototype.hasOwnProperty.call(ENGINE, style) ? style : 'buggy';
      const S = (this.S = ENGINE[this.style]);
      const ctx = g.ctx;
      const t = ctx.currentTime;
      this.nodes = [];
      this.srcs = [];
      this.dead = false;
      const mk = (n, dest) => { this.nodes.push(n); if (dest) n.connect(dest); return n; };
      const gain = (v, dest) => { const n = mk(ctx.createGain(), dest); n.gain.value = v; return n; };
      const osc = (type, f, dest) => {
        const o = mk(ctx.createOscillator(), dest);
        o.type = type;
        o.frequency.value = f;
        this.srcs.push(o);
        return o;
      };

      this.out = gain(0, g.engineBus);
      this.out.gain.setValueAtTime(0, t);
      this.out.gain.linearRampToValueAtTime(1, t + 0.25);
      this.amp = gain(S.vol * 0.45, this.out);
      this.lp = mk(ctx.createBiquadFilter(), this.amp);
      this.lp.type = 'lowpass';
      this.lp.frequency.value = S.cutLo;
      this.lp.Q.value = S.q;
      this.shaper = mk(ctx.createWaveShaper(), this.lp);
      this.shaper.curve = getCurve(g, S.drive);
      this.pre = gain(0.7, this.shaper);

      this.o1 = osc(S.w1, S.idle, gain(S.m1, this.pre));
      this.o2 = osc(S.w2, S.idle * S.r2, gain(S.m2, this.pre));
      this.o2.detune.value = S.det;
      this.sub = osc(S.subW || 'sine', S.idle * 0.5, gain(S.sub, this.lp)); // clean sub, bypasses the shaper
      if (S.noise > 0) {
        this.nGain = gain(S.noise * 0.3, this.pre);
        const bp = mk(ctx.createBiquadFilter(), this.nGain);
        bp.type = 'bandpass';
        bp.frequency.value = S.nf;
        bp.Q.value = S.nq;
        const ns = mk(ctx.createBufferSource(), bp);
        ns.buffer = getNoise(g, 'white');
        ns.loop = true;
        this.srcs.push(ns);
      }
      if (S.burble > 0) {
        // Idle lope: an LFO added onto the amp gain (depth shrinks as revs rise).
        this.lfoGain = gain(0, this.amp.gain);
        this.lfo = osc(S.lfoW || 'sine', S.bRate, this.lfoGain);
      }
      if (S.whine) {
        this.wGain = gain(0, this.amp);
        this.whine = osc('sine', S.whine[0], this.wGain);
      }
      for (const s of this.srcs) s.start(t);

      this.rpm = 0;
      this.thr = 0;
      this.lastUpdate = -1;
      this.lastCall = t;
      this.thrPeak = 0;
      this.update(0, 0, 0, false, true);
    }

    update(rpm, thr, load, air, force) {
      if (this.dead) return;
      const S = this.S;
      const g = this.g;
      const t = g.ctx.currentTime;
      rpm = clamp(num(rpm, 0), 0, 1);
      thr = clamp(num(thr, 0), 0, 1);
      load = clamp(num(load, 0), 0, 1);
      if (air) {
        // Airborne: wheels spin free, so revs chase the throttle and the engine is unloaded.
        rpm = Math.max(rpm, 0.12 + 0.88 * thr);
        load = 0;
      }

      // Rally blow-off: a sharp lift off the throttle at high revs vents the turbo.
      const dt = Math.max(0, t - this.lastCall);
      this.lastCall = t;
      this.thrPeak = Math.max(thr, this.thrPeak * Math.exp(-dt / 0.2));
      if (S.blowoff && !air && this.thrPeak > 0.6 && thr < 0.2 && this.rpm > 0.45 && g.ctx.state === 'running') {
        this.thrPeak = 0;
        playOn(g, 'blowoff', { volume: 0.5 + 0.5 * this.rpm, pitch: 0.9 + 0.3 * this.rpm }, 0, g.engineBus);
      }

      // Throttle AudioParam automation to ~33 Hz unless something moved a lot.
      if (!force && t - this.lastUpdate < 0.03 && Math.abs(rpm - this.rpm) < 0.05 && Math.abs(thr - this.thr) < 0.1) return;
      this.lastUpdate = t;
      this.rpm = rpm;
      this.thr = thr;

      const tc = air ? 0.12 : 0.06; // smoothing time constant (free revs in the air feel looser)
      const f = S.idle + (S.max - S.idle) * Math.pow(rpm, 0.85);
      this.o1.frequency.setTargetAtTime(f, t, tc);
      this.o2.frequency.setTargetAtTime(f * S.r2, t, tc);
      this.sub.frequency.setTargetAtTime(f * 0.5, t, tc);
      const open = clamp(0.3 * rpm + 0.5 * thr + 0.2 * load, 0, 1);
      this.lp.frequency.setTargetAtTime(fq(g, S.cutLo + (S.cutHi - S.cutLo) * open, 10), t, 0.05);
      this.amp.gain.setTargetAtTime(S.vol * (0.42 + 0.38 * thr + 0.2 * load), t, 0.05);
      this.pre.gain.setTargetAtTime(0.6 + S.drive * 0.18 * (0.3 + thr + 0.5 * load), t, 0.05);
      if (this.nGain) this.nGain.gain.setTargetAtTime(S.noise * (0.3 + 0.7 * thr) * (0.5 + 0.5 * rpm), t, 0.05);
      if (this.lfo) {
        const depth = S.vol * S.burble * 0.4 * Math.pow(1 - rpm, 1.5) * (1 - 0.6 * thr);
        this.lfoGain.gain.setTargetAtTime(depth, t, 0.08);
        this.lfo.frequency.setTargetAtTime(S.bRate * (1 + S.bTrack * rpm), t, 0.08);
      }
      if (this.whine) {
        this.whine.frequency.setTargetAtTime(fq(g, lerp(S.whine[0], S.whine[1], rpm)), t, air ? 0.15 : 0.1);
        const wg = S.whineGain * rpm * (S.whineThrottle ? thr : 0.4 + 0.6 * thr);
        this.wGain.gain.setTargetAtTime(wg, t, 0.1);
      }
    }

    stop(fade) {
      if (this.dead) return;
      this.dead = true;
      const t = this.g.ctx.currentTime;
      fade = Math.max(0.02, num(fade, 0.35));
      try {
        hold(this.out.gain, t);
        this.out.gain.linearRampToValueAtTime(0, t + fade);
        let pending = this.srcs.length;
        const done = () => { if (--pending <= 0) this.dispose(); };
        for (const s of this.srcs) { s.onended = done; s.stop(t + fade + 0.05); }
      } catch (e) {
        this.dispose();
        throw e;
      }
    }

    dispose() {
      for (const s of this.srcs) s.onended = null;
      for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
      this.nodes.length = 0;
      this.srcs.length = 0;
    }
  }

  // ------------------------------------------------------------------ music: data
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygianDom: [0, 1, 4, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    harmMinor: [0, 2, 3, 5, 7, 8, 11]
  };

  // Instrument patches. kind: bass | pluck | lead | pad | bell. gain is the per-note peak.
  const PATCHES = {
    bassRound: { kind: 'bass', type: 'triangle', sub: 0.6, cut: 900, env: 1200, q: 1, a: 0.005, d: 0.3, s: 0.5, gain: 0.34 },
    bassPluck: { kind: 'bass', type: 'sawtooth', sub: 0.45, cut: 450, env: 1600, q: 4, a: 0.004, d: 0.2, s: 0.35, gain: 0.24 },
    bassSoft: { kind: 'bass', type: 'sine', sub: 0, cut: 700, env: 200, q: 0.7, a: 0.02, d: 0.6, s: 0.7, gain: 0.4 },
    bassDist: { kind: 'bass', type: 'sawtooth', sub: 0.7, cut: 360, env: 800, q: 6, a: 0.004, d: 0.15, s: 0.4, gain: 0.26, drive: 3 },
    bassSaw: { kind: 'bass', type: 'sawtooth', sub: 0.5, cut: 650, env: 1900, q: 5, a: 0.003, d: 0.14, s: 0.3, gain: 0.23 },
    bassOud: { kind: 'bass', type: 'triangle', sub: 0.3, cut: 1500, env: 2000, q: 2, a: 0.003, d: 0.22, s: 0.2, gain: 0.32 },
    padWarm: { kind: 'pad', type: 'triangle', type2: 'sawtooth', detune: 8, mix2: 0.35, cut: 1400, q: 0.6, a: 0.35, r: 0.6, gain: 0.05, send: 0.25 },
    padAir: { kind: 'pad', type: 'triangle', type2: 'triangle', detune: 10, mix2: 0.8, cut: 2600, q: 0.5, a: 0.25, r: 0.5, gain: 0.05, send: 0.2 },
    padDrone: { kind: 'pad', type: 'sawtooth', type2: 'sawtooth', detune: 6, mix2: 0.8, cut: 900, q: 1, a: 0.6, r: 0.8, gain: 0.035, send: 0.15 },
    padGlass: { kind: 'pad', type: 'sine', type2: 'triangle', detune: 7, mix2: 0.6, cut: 4000, q: 0.5, a: 0.9, r: 1.2, gain: 0.06, send: 0.5 },
    padDark: { kind: 'pad', type: 'sawtooth', type2: 'sawtooth', detune: 12, mix2: 0.8, cut: 550, q: 2, a: 0.5, r: 0.8, gain: 0.045, send: 0.2 },
    padSpace: { kind: 'pad', type: 'triangle', type2: 'sine', detune: 9, mix2: 0.8, cut: 1800, q: 0.5, a: 1.6, r: 2.0, gain: 0.06, send: 0.55 },
    padSaw: { kind: 'pad', type: 'sawtooth', type2: 'sawtooth', detune: 14, mix2: 0.9, cut: 1600, q: 1.2, a: 0.08, r: 0.4, gain: 0.035, send: 0.3 },
    padTense: { kind: 'pad', type: 'sawtooth', type2: 'square', detune: 16, mix2: 0.4, cut: 1000, q: 3, a: 0.2, r: 0.5, gain: 0.035, send: 0.2 },
    padReedy: { kind: 'pad', type: 'sawtooth', type2: 'triangle', detune: 5, mix2: 0.8, cut: 1100, q: 1.5, a: 0.3, r: 0.5, gain: 0.035, send: 0.25 },
    leadBright: { kind: 'lead', type: 'square', cut: 2600, q: 1, a: 0.01, d: 0.12, s: 0.6, r: 0.08, gain: 0.065, send: 0.3 },
    leadWhistle: { kind: 'lead', type: 'sine', type2: 'triangle', mix2: 0.35, cut: 6000, q: 0.5, a: 0.02, d: 0.1, s: 0.8, r: 0.1, gain: 0.13, vib: 14, send: 0.25 },
    leadReed: { kind: 'lead', type: 'sawtooth', cut: 1800, q: 3, a: 0.03, d: 0.1, s: 0.8, r: 0.1, gain: 0.07, vib: 10, send: 0.15 },
    leadSnake: { kind: 'lead', type: 'sawtooth', cut: 2200, q: 5, a: 0.01, d: 0.1, s: 0.7, r: 0.06, gain: 0.06, glide: 0.06, vib: 18, send: 0.2 },
    leadDark: { kind: 'lead', type: 'square', cut: 1200, q: 2, a: 0.01, d: 0.15, s: 0.6, r: 0.1, gain: 0.07, send: 0.25 },
    leadSaw: { kind: 'lead', type: 'sawtooth', type2: 'sawtooth', detune: 10, mix2: 0.7, cut: 3000, q: 1.5, a: 0.01, d: 0.1, s: 0.7, r: 0.08, gain: 0.05, send: 0.3 },
    leadStab: { kind: 'pluck', type: 'square', cut: 2200, env: 2500, q: 2, d: 0.14, gain: 0.075, send: 0.2 },
    pluckSoft: { kind: 'pluck', type: 'triangle', cut: 2500, env: 1500, q: 1, d: 0.25, gain: 0.11, send: 0.3 },
    pluckBright: { kind: 'pluck', type: 'square', cut: 1700, env: 3500, q: 2, d: 0.15, gain: 0.055, send: 0.25 },
    pluckOud: { kind: 'pluck', type: 'sawtooth', cut: 1500, env: 2500, q: 3, d: 0.18, gain: 0.06, send: 0.15 },
    pluckSpace: { kind: 'pluck', type: 'triangle', cut: 2000, env: 800, q: 1, d: 0.6, gain: 0.1, send: 0.65 },
    pluckDark: { kind: 'pluck', type: 'sawtooth', cut: 700, env: 900, q: 4, d: 0.2, gain: 0.07, send: 0.2 },
    arpSquare: { kind: 'pluck', type: 'square', cut: 1300, env: 2800, q: 3, d: 0.12, gain: 0.05, send: 0.3 },
    bell: { kind: 'bell', d: 1.2, gain: 0.08, send: 0.45 },
    bellArp: { kind: 'bell', d: 0.7, gain: 0.055, send: 0.5 }
  };

  // Drum lanes: 16-step strings. X = accent, x = normal, o = optional ghost (probability = density).
  // Bass: R root, O octave, F fifth, A approach (scale step below next chord); lowercase = staccato.
  // Rhythm templates for motifs: [step, lengthInSteps].
  const RH = {
    a: [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
    b: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 6], [14, 2]],
    c: [[0, 4], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
    d: [[0, 6], [6, 2], [8, 8]],
    e: [[0, 1], [2, 1], [3, 1], [4, 2], [6, 2], [8, 1], [10, 1], [11, 1], [12, 4]],
    f: [[2, 2], [4, 2], [6, 4], [10, 2], [12, 4]],
    g: [[0, 8], [8, 8]],
    h: [[0, 2], [3, 1], [4, 2], [6, 1], [7, 1], [8, 4], [12, 2], [14, 2]]
  };

  const MUSIC = {
    menu: {
      bpm: 104, level: 0.72, root: 50, scale: 'major', bpc: 1, swing: 0,
      progs: [[0, 4, 5, 3], [3, 4, 0, 5], [0, 5, 3, 4], [5, 3, 0, 4]],
      bassP: 'bassRound', padP: 'padWarm', leadP: 'leadBright', arpP: 'pluckSoft',
      bassOct: -12, padOct: 0, arpOct: 12, leadOct: 12, arpRate: 2,
      bass: ['R...R.R.R...F.O.', 'R.....R.O...R..A'],
      grooves: [
        { kick: 'X.......X.x.....', snare: '....X.......X...', hat: '..x...x...x...x.', shaker: 'x.o.x.o.x.o.x.o.' },
        { kick: 'X.....x.X.......', snare: '....X.......X..o', hat: 'x.x.x.x.x.x.x.x.' }
      ],
      rhythms: ['a', 'c', 'f', 'h'], leadChance: 0.7, arpChance: 0.8, density: 0.6,
      fill: 'snare', crash: true, delay: 0.18, fb: 0.3, lift: 0.12
    },
    valley: {
      bpm: 112, level: 1.35, root: 55, scale: 'major', bpc: 1, swing: 0.08,
      progs: [[0, 3, 4, 0], [0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 5, 4]],
      bassP: 'bassPluck', padP: 'padAir', leadP: 'leadWhistle', arpP: 'pluckBright',
      bassOct: -24, padOct: -12, arpOct: 0, leadOct: 12, arpRate: 2,
      bass: ['R..R..R.R...F...', 'R.r.F.r.R.r.O.r.', 'R...F...R..AR...'],
      grooves: [
        { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', shaker: '.o.x.o.x.o.x.o.x' },
        { kick: 'X.......X..x....', snare: '....X.......X.o.', hat: 'x.xox.x.x.xox.x.', rim: '......x.......x.' }
      ],
      rhythms: ['a', 'b', 'c', 'h'], leadChance: 0.75, arpChance: 0.75, density: 0.65,
      fill: 'tom', crash: true, delay: 0.2, fb: 0.28, lift: 0.1
    },
    highland: {
      bpm: 96, level: 0.85, root: 50, scale: 'dorian', bpc: 1, swing: 0,
      progs: [[0, 6, 0, 6], [0, 3, 6, 0], [0, 6, 3, 4], [0, 0, 6, 3]],
      bassP: 'bassRound', padP: 'padDrone', padMode: 'drone', leadP: 'leadReed', arpP: 'pluckSoft',
      bassOct: -24, padOct: -12, arpOct: 12, leadOct: 12, arpRate: 2,
      bass: ['R.......F.......', 'R...R...F...R...'],
      grooves: [
        { kick: 'X.......X.......', snare: 'x..o..x.xox.x..o', tom: 'X...x...X.x.x...' },
        { kick: 'X.......X.......', snare: 'x.o.x.o.xxx.x.o.', tom: 'X..x..x.X...x.x.' }
      ],
      rhythms: ['a', 'd', 'c', 'e'], leadChance: 0.8, arpChance: 0.35, density: 0.6,
      fill: 'snare', crash: false, delay: 0.12, fb: 0.25
    },
    desert: {
      bpm: 100, level: 1.55, root: 52, scale: 'phrygianDom', bpc: 1, swing: 0.1,
      progs: [[0, 1, 0, 1], [0, 1, 6, 0], [0, 3, 1, 0], [0, 0, 1, 6]],
      bassP: 'bassOud', padP: 'padReedy', leadP: 'leadSnake', arpP: 'pluckOud',
      bassOct: -24, padOct: -12, arpOct: 0, leadOct: 12, arpRate: 2,
      bass: ['R..r..R.r.R.r...', 'R.....r.R...F.r.'],
      grooves: [
        { dum: 'X.......X.......', tek: '..x...x.....x.oo', shaker: 'x.o.x.o.x.o.x.o.' },
        { dum: 'X..o..x.X.......', tek: '..x.x.x...x.x.x.', shaker: 'x.x.x.x.x.x.x.x.' }
      ],
      rhythms: ['e', 'h', 'b', 'a'], leadChance: 0.8, arpChance: 0.5, density: 0.65,
      fill: 'tek', crash: false, delay: 0.2, fb: 0.3
    },
    ice: {
      bpm: 84, level: 0.85, root: 53, scale: 'lydian', bpc: 2, swing: 0,
      progs: [[0, 1, 0, 1], [0, 1, 5, 4], [0, 5, 1, 0], [0, 2, 1, 0]],
      bassP: 'bassSoft', padP: 'padGlass', leadP: 'bell', arpP: 'bellArp',
      bassOct: -24, padOct: 0, arpOct: 12, leadOct: 12, arpRate: 2,
      bass: ['R.......F.......', 'R...........O...'],
      grooves: [
        { kick: 'X.........x.....', rim: '....x.......x...', shaker: '..o...x...o...x.' },
        { kick: 'X...............', rim: '........x.......', shaker: 'o.x.o.x.o.x.o.x.' }
      ],
      rhythms: ['d', 'g', 'a', 'f'], leadChance: 0.55, arpChance: 0.85, density: 0.5,
      fill: null, crash: true, crashSoft: true, delay: 0.38, fb: 0.45
    },
    volcanic: {
      bpm: 86, level: 0.92, root: 45, scale: 'aeolian', bpc: 1, swing: 0,
      progs: [[0, 5, 6, 0], [0, 3, 5, 4], [0, 0, 5, 6], [0, 5, 3, 4]],
      bassP: 'bassDist', padP: 'padDark', leadP: 'leadDark', arpP: 'pluckDark',
      bassOct: -12, padOct: 0, arpOct: 12, leadOct: 12, arpRate: 2,
      bass: ['R.r.R.r.R.r.R.r.', 'R.rrR.r.R.rrR.F.'],
      grooves: [
        { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', boom: '........x.....x.' },
        { kick: 'X..x..x.X.......', snare: '....X.......X..o', hat: 'x.o.x.o.x.o.x.o.', boom: 'x...............' }
      ],
      rhythms: ['d', 'a', 'g', 'c'], leadChance: 0.5, arpChance: 0.4, density: 0.55,
      fill: 'tom', crash: true, delay: 0.18, fb: 0.3
    },
    space: {
      bpm: 70, level: 0.78, root: 50, scale: 'aeolian', bpc: 2, swing: 0,
      progs: [[0, 5, 2, 6], [0, 3, 5, 6], [5, 6, 0, 0], [0, 2, 5, 3]],
      bassP: 'bassSoft', padP: 'padSpace', leadP: 'bell', arpP: 'pluckSpace',
      bassOct: -24, padOct: 0, arpOct: 12, leadOct: 12, arpRate: 2,
      bass: ['R...............', 'R.......F.......'],
      grooves: [
        { kick: 'X...............', shaker: '....o.......o...' },
        { kick: 'x.......o.......', hat: '..o...o...o...o.' }
      ],
      rhythms: ['g', 'd', 'f'], leadChance: 0.35, arpChance: 0.95, density: 0.5,
      fill: null, crash: false, delay: 0.5, fb: 0.55
    },
    synthwave: {
      bpm: 100, level: 1.45, root: 57, scale: 'aeolian', bpc: 1, swing: 0,
      progs: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4], [5, 6, 0, 0]],
      bassP: 'bassSaw', padP: 'padSaw', leadP: 'leadSaw', arpP: 'arpSquare',
      bassOct: -24, padOct: -12, arpOct: 0, leadOct: 0, arpRate: 1,
      bass: ['R.O.R.O.R.O.R.O.', 'r.o.r.o.r.o.F.O.'],
      grooves: [
        { kick: 'X...X...X...X...', gated: '....X.......X...', hat: '..x...x...x...x.' },
        { kick: 'X...X...X...X...', gated: '....X.......X...', hat: 'o.x.o.x.o.x.o.xx', clap: '............x...' }
      ],
      rhythms: ['a', 'c', 'd', 'h'], leadChance: 0.65, arpChance: 0.8, density: 0.6,
      fill: 'tom', crash: true, delay: 0.3, fb: 0.35, lift: 0.1
    },
    storm: {
      bpm: 128, level: 1.3, root: 50, scale: 'harmMinor', bpc: 1, swing: 0,
      progs: [[0, 5, 3, 4], [0, 3, 4, 0], [0, 5, 1, 4], [0, 0, 5, 4]],
      bassP: 'bassPluck', padP: 'padTense', leadP: 'leadStab', arpP: 'arpSquare',
      bassOct: -24, padOct: -12, arpOct: 0, leadOct: 12, arpRate: 1,
      bass: ['RrrrRrrrRrrrRrrr', 'RrrrRrrrFfffRrOr'],
      grooves: [
        { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'xoxoxoxoxoxoxoxo' },
        { kick: 'X...X...X..xX...', snare: '....X.......X.o.', hat: 'x.x.x.x.x.x.x.x.', tom: '..............x.' }
      ],
      rhythms: ['b', 'e', 'h', 'c'], leadChance: 0.6, arpChance: 0.6, density: 0.6,
      fill: 'tom', crash: true, delay: 0.15, fb: 0.25
    },
    boss: {
      bpm: 146, level: 0.8, root: 52, scale: 'harmMinor', bpc: 1, swing: 0,
      progs: [[0, 5, 4, 0], [0, 5, 3, 4], [0, 0, 5, 4], [0, 1, 4, 4]],
      bassP: 'bassDist', padP: 'padTense', leadP: 'leadSaw', arpP: 'arpSquare',
      bassOct: -24, padOct: -12, arpOct: 0, leadOct: 12, arpRate: 1,
      bass: ['RrRrRrRrRrRrRrRr', 'RrrRrrRrRrrRrrOr'],
      grooves: [
        { kick: 'X.x.X.x.X.x.X.xx', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
        { kick: 'X.xxX.x.X.xxX.x.', snare: '....X.......X..o', hat: 'xxxxxxxxxxxxxxxx', clap: '....x.......x...' }
      ],
      rhythms: ['b', 'e', 'h'], leadChance: 0.75, arpChance: 0.65, density: 0.7,
      fill: 'tom', crash: true, delay: 0.12, fb: 0.22
    }
  };
  const MUSIC_STYLES = Object.keys(MUSIC);

  // Pre-parse pattern strings once at load (no per-step string work).
  function parseLane(inst, str) {
    const v = new Float32Array(16), p = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      const c = str.charAt(i);
      if (c === 'X') v[i] = 1;
      else if (c === 'x') v[i] = 0.7;
      else if (c === 'o') { v[i] = 0.45; p[i] = 1; }
    }
    return { inst, v, p };
  }
  function parseBass(str) {
    const c = [], l = new Uint8Array(16);
    for (let i = 0; i < 16; i++) c.push(str.charAt(i) === '.' ? '' : str.charAt(i));
    for (let i = 0; i < 16; i++) {
      if (!c[i]) continue;
      let j = i + 1;
      while (j < 16 && !c[j]) j++;
      l[i] = Math.min(8, j - i);
    }
    return { c, l };
  }
  for (const k of MUSIC_STYLES) {
    const d = MUSIC[k];
    d.scaleArr = SCALES[d.scale];
    d.grooves = d.grooves.map((gr) => Object.keys(gr).map((inst) => parseLane(inst, gr[inst])));
    d.bass = d.bass.map(parseBass);
    d.rhythms = d.rhythms.map((r) => RH[r]);
  }

  const degMidi = (deg, base, scale) => {
    const o = Math.floor(deg / 7);
    return base + scale[deg - o * 7] + 12 * o;
  };
  const CHORD_REL = [-3, 0, 2, 4, 7, 9];
  const snapChord = (rel) => {
    let best = 0, bd = 99;
    for (let i = 0; i < CHORD_REL.length; i++) {
      const d = Math.abs(CHORD_REL[i] - rel);
      if (d < bd) { bd = d; best = CHORD_REL[i]; }
    }
    return best;
  };
  const MOTIF_STEPS = [-2, -1, -1, 1, 1, 2, -3, 3, 0];
  const ARP_SHAPES = {
    up: [0, 1, 2, 3, 4, 5],
    down: [5, 4, 3, 2, 1, 0],
    updown: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1],
    broken: [0, 2, 1, 3, 2, 4, 3, 5],
    pinky: [0, 3, 1, 4, 2, 5, 1, 4]
  };

  // ------------------------------------------------------------------ music: instruments
  function noteVoice(song, P, vel) {
    const v = new Voice(song.g, P.gain * vel, song.out, null);
    if (P.send) v.out.connect(song.sendNode(P.send));
    return v;
  }

  function playNote(song, patchName, midi, t, dur, vel) {
    const P = PATCHES[patchName];
    if (!P) return;
    const f = mtof(midi);
    const v = noteVoice(song, P, vel);
    if (P.kind === 'bass') {
      const gn = v.gain(0);
      const tEnd = adsr(gn.gain, t, dur, P.a, P.d, P.s, 0.06, 1);
      const lp = v.filt('lowpass', P.cut, P.q, gn);
      lp.frequency.setValueAtTime(fq(song.g, P.cut + P.env, 10), t);
      lp.frequency.exponentialRampToValueAtTime(fq(song.g, P.cut, 10), t + Math.max(0.03, P.d));
      const into = P.drive ? v.shaper(P.drive, lp) : lp;
      v.osc(P.type, f, t, tEnd + 0.02, into);
      if (P.sub) v.osc('sine', f, t, tEnd + 0.02, v.gain(P.sub, gn));
    } else if (P.kind === 'pluck') {
      const gn = v.gain(0);
      const tEnd = env(gn.gain, t, 0.003, 1, P.d);
      const lp = v.filt('lowpass', P.cut, P.q, gn);
      lp.frequency.setValueAtTime(fq(song.g, P.cut + P.env, 10), t);
      lp.frequency.exponentialRampToValueAtTime(P.cut * 0.5, tEnd);
      v.osc(P.type, f, t, tEnd + 0.02, lp);
    } else if (P.kind === 'lead') {
      const gn = v.gain(0);
      const tEnd = adsr(gn.gain, t, dur, P.a, P.d, P.s, P.r, 1);
      const lp = v.filt('lowpass', P.cut, P.q, gn);
      const o = v.osc(P.type, f, t, tEnd + 0.02, lp);
      if (P.glide && song.prevLead > 0) {
        o.frequency.setValueAtTime(song.prevLead, t);
        o.frequency.exponentialRampToValueAtTime(f, t + P.glide);
      }
      let o2 = null;
      if (P.type2) {
        o2 = v.osc(P.type2, f, t, tEnd + 0.02, v.gain(P.mix2 || 0.5, lp));
        o2.detune.value = P.detune || 0;
      }
      if (P.vib && dur >= 0.3) {
        // Delayed vibrato: a 5.5 Hz LFO into detune (cents), faded in after the attack.
        const depth = v.gain(0, o.detune);
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(P.vib, t + Math.min(0.25, dur * 0.6));
        if (o2) depth.connect(o2.detune);
        v.osc('sine', 5.5, t, tEnd + 0.02, depth);
      }
      song.prevLead = f;
    } else if (P.kind === 'bell') {
      bell(v, f, t, P.d, 1);
    }
    v.seal();
  }

  // Pad: one voice for the whole chord (2 detuned oscillators per tone into a shared filter).
  function playPad(song, patchName, tones, n, t, dur) {
    const P = PATCHES[patchName];
    if (!P) return;
    const v = noteVoice(song, P, 1);
    const gn = v.gain(0);
    const tEnd = adsr(gn.gain, t, dur, P.a, 0.3, 0.8, P.r, 1);
    const lp = v.filt('lowpass', P.cut, P.q, gn);
    const g2 = v.gain(P.mix2, lp);
    for (let i = 0; i < n; i++) {
      const f = mtof(tones[i]);
      const a = v.osc(P.type, f, t, tEnd + 0.02, lp);
      a.detune.value = -P.detune;
      const b = v.osc(P.type2, f, t, tEnd + 0.02, g2);
      b.detune.value = P.detune;
    }
    v.seal();
  }

  const DRUM_LEVEL = { kick: 0.55, snare: 0.3, gated: 0.3, hat: 0.07, shaker: 0.06, tom: 0.34, rim: 0.12, clap: 0.22,
    dum: 0.4, tek: 0.2, boom: 0.45, crash: 0.06 };
  const DRUMS = {
    kick(v, t) {
      blip(v, 'sine', 150, 42, t, 0.002, 0.32, 1);
      hiss(v, 'white', t, 0.001, 0.012, 0.25, 'highpass', 2500, 0, 0.7);
    },
    snare(v, t) {
      blip(v, 'triangle', 200, 160, t, 0.001, 0.1, 0.6);
      hiss(v, 'white', t, 0.001, 0.16, 0.7, 'highpass', 1800, 0, 0.7);
    },
    gated(v, t, vel, song) {
      // "Gated" snare: noisy body held flat then chopped abruptly, fed hard into the echo.
      v.out.connect(song.sendNode(0.45));
      blip(v, 'triangle', 190, 150, t, 0.001, 0.12, 0.6);
      const gn = v.gain(0);
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.7, t + 0.002);
      gn.gain.setValueAtTime(0.5, t + 0.16);
      gn.gain.linearRampToValueAtTime(0, t + 0.175);
      v.noise('white', t, t + 0.19, v.filt('bandpass', 2200, 0.6, gn));
    },
    hat(v, t) { hiss(v, 'white', t, 0.001, 0.035, 1, 'highpass', 7500, 0, 0.7); },
    shaker(v, t) { hiss(v, 'white', t, 0.012, 0.05, 1, 'bandpass', 6000, 0, 1); },
    tom(v, t, vel, song, s) {
      const f = song.fillVar >= 0 ? 110 * (1 + song.fillVar * 0.18) : (s % 8 === 0 ? 105 : 150);
      blip(v, 'sine', f, f * 0.6, t, 0.002, 0.3, 1);
      hiss(v, 'white', t, 0.001, 0.05, 0.2, 'lowpass', 900, 0, 0.7);
    },
    rim(v, t) {
      blip(v, 'square', 1700, 0, t, 0.001, 0.012, 0.6);
      blip(v, 'triangle', 800, 0, t, 0.001, 0.025, 0.6);
    },
    clap(v, t, vel, song) {
      v.out.connect(song.sendNode(0.25));
      for (let i = 0; i < 3; i++) hiss(v, 'white', t + i * 0.01, 0.001, 0.012, 0.8, 'bandpass', 1200, 0, 1.5);
      hiss(v, 'white', t + 0.03, 0.001, 0.12, 0.6, 'bandpass', 1200, 0, 1.5);
    },
    dum(v, t) {
      blip(v, 'sine', 180, 120, t, 0.002, 0.22, 1);
      hiss(v, 'white', t, 0.001, 0.03, 0.2, 'lowpass', 600, 0, 0.7);
    },
    tek(v, t, vel, song) {
      const f = song.fillVar >= 0 ? 3200 + song.fillVar * 300 : 3200;
      hiss(v, 'white', t, 0.001, 0.04, 0.8, 'bandpass', f, 0, 2);
      blip(v, 'sine', 700, 600, t, 0.001, 0.05, 0.3);
    },
    boom(v, t) {
      blip(v, 'sine', 70, 40, t, 0.003, 0.6, 1);
      hiss(v, 'brown', t, 0.003, 0.3, 0.6, 'lowpass', 300, 0, 0.7);
    },
    crash(v, t) { hiss(v, 'white', t, 0.002, 1.2, 1, 'highpass', 5000, 0, 0.5); }
  };
  function playDrum(song, inst, t, vel, s) {
    const fn = DRUMS[inst];
    if (!fn) return;
    const v = new Voice(song.g, (DRUM_LEVEL[inst] || 0.2) * vel, song.out, null);
    fn(v, t, vel, song, s);
    v.seal();
  }

  // ------------------------------------------------------------------ music: sequencer
  class Song {
    constructor(g, style, seed, t0) {
      this.g = g;
      this.style = style;
      this.def = MUSIC[style];
      this.rng = makeRng(seed);
      this.spb = 60 / this.def.bpm / 4; // seconds per 16th step
      this.out = g.ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(g.musicMix);
      this.fx = g.ctx.createGain(); // post-fader echo send (follows the song's fades)
      this.fx.gain.value = 0;
      this.fx.connect(g.delayIn);
      this.sends = new Map();
      this.nextTime = t0;
      this.step = 0;
      this.barIn = 0;
      this.phraseNo = -1;
      this.stepCount = 0;
      this.arpI = 0;
      this.stopAt = Infinity;
      this.disposeAt = Infinity;
      this.prevLead = 0;
      this.fillVar = -1;
      this.lead = new Int16Array(16);
      this.leadLen = new Uint8Array(16);
      this.tones = new Int16Array(8);   // arp tones (2 octaves of the chord)
      this.padTones = new Int16Array(4);
      this.chord = 0;
      this.nextChord = 0;
      this.newPhrase();
      this.prepareBar();
    }

    sendNode(level) {
      const key = Math.round(level * 100);
      let n = this.sends.get(key);
      if (!n) {
        n = this.g.ctx.createGain();
        n.gain.value = key / 100;
        n.connect(this.fx);
        this.sends.set(key, n);
      }
      return n;
    }

    fadeTo(level, t, dur) {
      hold(this.out.gain, t);
      this.out.gain.linearRampToValueAtTime(level, t + dur);
      hold(this.fx.gain, t);
      this.fx.gain.linearRampToValueAtTime(level, t + dur);
    }

    fadeOut(t, dur) {
      if (this.stopAt !== Infinity) return;
      this.fadeTo(0, t, dur);
      this.stopAt = t + dur;
      // Out and sends are silent at stopAt; a short grace lets already-scheduled notes finish.
      this.disposeAt = this.stopAt + 0.5;
    }

    dispose() {
      try { this.out.disconnect(); this.fx.disconnect(); } catch (e) { /* ignore */ }
      for (const n of this.sends.values()) { try { n.disconnect(); } catch (e) { /* ignore */ } }
      this.sends.clear();
    }

    newPhrase() {
      const d = this.def, r = this.rng;
      this.phraseNo++;
      const first = this.phraseNo === 0;
      const motif = [];
      const tpl = r.pick(d.rhythms);
      let rel = r.pick([0, 2, 4]);
      for (let i = 0; i < tpl.length; i++) {
        if (i > 0) rel = clamp(rel + r.pick(MOTIF_STEPS), -3, 9);
        if (i > 0 && i < tpl.length - 1 && r.chance(0.15)) continue; // breathing rest
        motif.push({ st: tpl[i][0], len: tpl[i][1], rel });
      }
      const shapeName = r.pick(['up', 'down', 'updown', 'broken', 'pinky', 'random']);
      let arpSeq = ARP_SHAPES[shapeName];
      if (!arpSeq) { arpSeq = []; for (let i = 0; i < 8; i++) arpSeq.push(r.int(0, 5)); }
      const P = {
        len: d.bpc === 2 ? 8 : r.pick([4, 8, 8]),
        prog: r.pick(d.progs),
        groove: r.pick(d.grooves),
        bass: r.pick(d.bass),
        arpSeq,
        motif,
        var1: [r.pick([-2, -1, 1, 2]), r.pick([-1, 1, 2])],
        seqShift: r.pick([1, 2, -1, 2, 3]),
        lead: !first && r.chance(d.leadChance),
        arp: r.chance(d.arpChance),
        drums: true,
        breakdown: !first && this.phraseNo % 3 === 2 && r.chance(0.35),
        key: d.root + (d.lift && !first && r.chance(d.lift) ? 2 : 0)
      };
      if (!P.lead && !P.arp) P.arp = true;
      if (P.breakdown) { P.arp = true; P.lead = false; }
      this.P = P;
      this.arpI = 0;
    }

    prepareBar() {
      const d = this.def, P = this.P, sc = d.scaleArr;
      const ci = Math.floor(this.barIn / d.bpc) % P.prog.length;
      this.chord = P.prog[ci];
      const lastOfChord = (this.barIn % d.bpc) === d.bpc - 1;
      this.nextChord = lastOfChord ? P.prog[(ci + 1) % P.prog.length] : this.chord;
      // Arp tones: triad over two octaves.
      const aBase = P.key + d.arpOct;
      for (let i = 0; i < 6; i++) this.tones[i] = degMidi(this.chord + (i % 3) * 2 + Math.floor(i / 3) * 7, aBase, sc);
      // Melody for this bar from the phrase motif (motif degrees are relative to the chord root).
      this.lead.fill(-1);
      if (P.lead) {
        const k = this.barIn % 4;
        const isLast = this.barIn === P.len - 1;
        const M = P.motif;
        const lBase = P.key + d.leadOct;
        for (let i = 0; i < M.length; i++) {
          const n = M[i];
          if (k === 3 && n.st >= 8) continue;
          let rel = n.rel;
          if (k === 1 && i >= M.length - 2) rel += P.var1[i - (M.length - 2)];
          else if (k === 2) rel += P.seqShift;
          if (n.st % 8 === 0) rel = snapChord(rel);
          rel = clamp(rel, -3, 9);
          this.lead[n.st] = degMidi(this.chord + rel, lBase, sc);
          this.leadLen[n.st] = n.len;
        }
        if (k === 3) { // cadence: a long note on the root (phrase end) or the fifth (half cadence)
          this.lead[8] = degMidi(this.chord + (isLast ? 0 : 4), lBase, sc);
          this.leadLen[8] = 8;
        }
      }
    }

    // Schedule every step that starts before tEnd.
    scheduleUntil(tEnd) {
      let guard = 0;
      while (this.nextTime < tEnd && this.nextTime < this.stopAt && guard++ < 64) {
        this.playStep(this.nextTime);
        this.advance();
      }
    }

    // Skip ahead (without playing) when the clock ran past us (e.g. throttled timers).
    resync(t) {
      let guard = 0;
      while (this.nextTime < t && guard++ < 4096) this.advance();
    }

    advance() {
      this.nextTime += this.spb;
      this.stepCount++;
      if (++this.step >= 16) {
        this.step = 0;
        if (++this.barIn >= this.P.len) {
          this.barIn = 0;
          this.newPhrase();
        }
        this.prepareBar();
      }
    }

    playStep(time) {
      const d = this.def, P = this.P, r = this.rng, s = this.step, spb = this.spb, sc = d.scaleArr;
      const t = time + (s % 2 === 1 ? d.swing * spb : 0);
      const lastBar = this.barIn === P.len - 1;
      const inFill = !!d.fill && lastBar && s >= 12 && !P.breakdown;

      // Drums
      if (P.drums) {
        const lanes = P.groove;
        for (let i = 0; i < lanes.length; i++) {
          const lane = lanes[i];
          const vel = lane.v[s];
          if (!vel) continue;
          if (lane.p[s] && r.next() > d.density) continue;
          if (P.breakdown && lane.inst !== 'hat' && lane.inst !== 'shaker' && lane.inst !== 'rim') continue;
          if (inFill && lane.inst !== 'kick' && lane.inst !== 'hat') continue;
          playDrum(this, lane.inst, t, vel, s);
        }
        if (inFill) {
          this.fillVar = s - 12;
          playDrum(this, d.fill, t, 0.55 + 0.15 * (s - 12), s);
          this.fillVar = -1;
        }
        if (s === 0 && this.barIn === 0 && this.phraseNo > 0 && d.crash && !P.breakdown) {
          playDrum(this, 'crash', t, d.crashSoft ? 0.5 : 1, s);
        }
      }

      // Pad (or drone) on chord changes
      if (s === 0 && this.barIn % d.bpc === 0 && d.padP) {
        const base = P.key + d.padOct;
        let n;
        if (d.padMode === 'drone') {
          this.padTones[0] = base - 12; this.padTones[1] = base - 5; this.padTones[2] = base;
          n = 3;
        } else {
          n = 3;
          for (let i = 0; i < 3; i++) {
            let m = degMidi(this.chord + i * 2, base, sc);
            while (m > base + 14) m -= 12; // keep voicings in a narrow window (smooth voice leading)
            this.padTones[i] = m;
          }
        }
        playPad(this, d.padP, this.padTones, n, t, d.bpc * 16 * spb);
      }

      // Bass
      const bc = P.bass.c[s];
      if (bc) {
        const bBase = P.key + d.bassOct;
        let m = degMidi(this.chord, bBase, sc);
        while (m > bBase + 7) m -= 12;
        const up = bc.toUpperCase();
        if (up === 'O') m += 12;
        else if (up === 'F') m = m + (degMidi(this.chord + 4, bBase, sc) - degMidi(this.chord, bBase, sc));
        else if (up === 'A') { m = degMidi(this.nextChord - 1, bBase, sc); while (m > bBase + 7) m -= 12; }
        const len = P.bass.l[s] * spb * (bc === up ? 0.9 : 0.45);
        playNote(this, d.bassP, m, t, len, P.breakdown ? 0.7 : 1);
      }

      // Arp
      if (P.arp && d.arpP && s % d.arpRate === 0) {
        const idx = P.arpSeq[this.arpI++ % P.arpSeq.length];
        if (r.next() < 0.92) playNote(this, d.arpP, this.tones[idx], t, d.arpRate * spb * 0.9, s % 4 === 0 ? 1 : 0.75);
      }

      // Lead melody
      const lm = this.lead[s];
      if (lm >= 0) playNote(this, d.leadP, lm, t, this.leadLen[s] * spb * 0.9, s % 4 === 0 ? 1 : 0.85);
    }
  }

  // ------------------------------------------------------------------ scheduler
  function tick() {
    const g = live;
    if (!g) return;
    const now = g.ctx.currentTime;
    const songs = g.songs;
    for (let i = songs.length - 1; i >= 0; i--) {
      const song = songs[i];
      if (now >= song.disposeAt) {
        song.dispose();
        songs.splice(i, 1);
        continue;
      }
      if (song.nextTime < now - 0.2) song.resync(now + 0.05);
      song.scheduleUntil(now + LOOKAHEAD);
    }
    if (!songs.length) stopScheduler();
  }
  function startScheduler() {
    if (timer || !live || !live.songs.length || userSuspended || hiddenSuspended) return;
    timer = setInterval(() => { try { tick(); } catch (e) { report(e); } }, TICK_MS);
  }
  function stopScheduler() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function configureDelay(g, def, t) {
    const beat = 60 / def.bpm;
    g.delay.delayTime.setTargetAtTime(clamp(beat * 0.75, 0.05, 1.9), t, 0.25); // dotted eighth
    g.delayFb.gain.setTargetAtTime(clamp(def.fb, 0, 0.7), t, 0.25);
  }

  function startSong(style) {
    const g = live;
    const t = g.ctx.currentTime;
    if (curSong && curSong.style === style && curSong.stopAt === Infinity) return;
    const crossfading = !!curSong;
    if (curSong) curSong.fadeOut(t, XFADE);
    const seed = hash2(hashString(style), ++songCounter);
    curSong = new Song(g, style, seed, t + 0.06);
    curSong.fadeTo(curSong.def.level, t, crossfading ? XFADE : 0.8);
    g.songs.push(curSong);
    configureDelay(g, curSong.def, t);
    startScheduler();
    tick();
  }
  function stopSongs(dur) {
    const g = live;
    if (!g) return;
    const t = g.ctx.currentTime;
    for (const s of g.songs) s.fadeOut(t, dur);
    curSong = null;
  }

  // ------------------------------------------------------------------ context lifecycle
  function applyRunState() {
    const g = live;
    if (!g) return;
    const ctx = g.ctx;
    if (!userSuspended && !hiddenSuspended) {
      resumeCtx();
      startScheduler();
    } else {
      stopScheduler();
      if (ctx.state === 'running') {
        const p = ctx.suspend();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    }
  }
  function resumeCtx() {
    const ctx = live && live.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    const p = ctx.resume();
    if (p && typeof p.then === 'function') {
      p.then(() => { try { if (live && !userSuspended && !hiddenSuspended) { startScheduler(); tick(); } } catch (e) { report(e); } })
        .catch(() => {});
    }
  }
  function attachListeners() {
    if (listenersAttached || typeof window.addEventListener !== 'function') return;
    listenersAttached = true;
    // Browsers keep a context suspended until a user gesture: retry resume on any gesture.
    const unlock = () => {
      try { if (live && !userSuspended && !hiddenSuspended) resumeCtx(); } catch (e) { report(e); }
    };
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('touchend', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        try {
          hiddenSuspended = !!document.hidden;
          applyRunState();
        } catch (e) { report(e); }
      });
    }
  }

  function getAudioCtor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  // ------------------------------------------------------------------ public API
  function init() {
    try {
      if (!live) {
        const AC = getAudioCtor();
        if (!AC) return false;
        let ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        live = createGraph(ctx);
        attachListeners();
        if (typeof document !== 'undefined' && document && document.hidden) hiddenSuspended = true;
        if (pendingEngine) {
          const st = pendingEngine;
          pendingEngine = null;
          engine = new Engine(live, st);
          engine.update(lastEngineParams.rpm, lastEngineParams.throttle, lastEngineParams.load, lastEngineParams.airborne, true);
        }
        if (musicTarget && musicOn) startSong(musicTarget);
      }
      if (!userSuspended && !hiddenSuspended) resumeCtx();
      return true;
    } catch (e) {
      report(e);
      return !!live;
    }
  }

  function setBus(param, level) {
    const t = live.ctx.currentTime;
    hold(param, t);
    param.setTargetAtTime(level, t, 0.08);
  }

  function setSound(on) {
    try {
      soundOn = !!on;
      if (live) setBus(live.sfxBus.gain, soundOn ? SFX_LEVEL : 0);
    } catch (e) { report(e); }
  }

  function setMusic(on) {
    try {
      musicOn = !!on;
      if (!live) return;
      setBus(live.musicBus.gain, musicOn ? MUSIC_LEVEL : 0);
      if (musicOn) { if (musicTarget) startSong(musicTarget); } else stopSongs(0.5); // off: stop the sequencer too (CPU)
    } catch (e) { report(e); }
  }

  function play(name, opts) {
    if (!soundOn || !live) return false;
    try { return playOn(live, name, opts, 0); } catch (e) { report(e); return false; }
  }

  function engineStart(style) {
    try {
      const st = Object.prototype.hasOwnProperty.call(ENGINE, style) ? style : 'buggy';
      if (!live) { pendingEngine = st; return; }
      if (engine && !engine.dead && engine.style === st) return;
      if (engine) engine.stop(0.15);
      engine = new Engine(live, st);
    } catch (e) { report(e); }
  }

  function engineUpdate(p) {
    try {
      const rpm = num(p && p.rpm, 0), thr = num(p && p.throttle, 0), load = num(p && p.load, 0), air = !!(p && p.airborne);
      lastEngineParams.rpm = rpm;
      lastEngineParams.throttle = thr;
      lastEngineParams.load = load;
      lastEngineParams.airborne = air;
      if (engine) engine.update(rpm, thr, load, air, false);
    } catch (e) { report(e); }
  }

  function engineStop() {
    try {
      pendingEngine = null;
      if (engine) { engine.stop(0.35); engine = null; }
    } catch (e) { engine = null; report(e); }
  }

  function music(style) {
    try {
      let st;
      if (style === null || style === undefined || style === '') st = null;
      else if (typeof style === 'string' && Object.prototype.hasOwnProperty.call(MUSIC, style)) st = style;
      else return; // unknown style: ignore
      musicTarget = st;
      if (!live) return;
      if (st && musicOn) startSong(st);
      else if (!st && curSong) { curSong.fadeOut(live.ctx.currentTime, XFADE); curSong = null; }
    } catch (e) { report(e); }
  }

  function duck(on) {
    try {
      ducked = !!on;
      if (!live) return;
      const t = live.ctx.currentTime;
      hold(live.duck.gain, t);
      live.duck.gain.setTargetAtTime(ducked ? DUCK_LEVEL : 1, t, 0.12);
    } catch (e) { report(e); }
  }

  function suspend() {
    try { userSuspended = true; applyRunState(); } catch (e) { report(e); }
  }

  function resume() {
    try { userSuspended = false; applyRunState(); } catch (e) { report(e); }
  }

  // Render sounds through an OfflineAudioContext and measure the result (QA / tests).
  // spec: { seconds=2, sampleRate=22050, sfx: name|[names], gap=0.45, opts, music: style,
  //         engine: {style, rpm, throttle, load, airborne}, returnData: bool }
  function renderOffline(spec) {
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return Promise.resolve(null);
      spec = spec || {};
      const sr = clamp(num(spec.sampleRate, 22050), 8000, 96000);
      const secs = clamp(num(spec.seconds, 2), 0.1, 60);
      const octx = new OAC(2, Math.ceil(sr * secs), sr);
      const saved = [soundOn, musicOn, ducked];
      soundOn = musicOn = true; ducked = false; // graph levels are read at creation
      const g = createGraph(octx);
      soundOn = saved[0]; musicOn = saved[1]; ducked = saved[2];
      g.offline = true;
      if (spec.sfx) {
        const names = Array.isArray(spec.sfx) ? spec.sfx : [spec.sfx];
        const gap = num(spec.gap, 0.45);
        for (let i = 0; i < names.length; i++) playOn(g, names[i], spec.opts, 0.02 + i * gap);
      }
      if (spec.music && MUSIC[spec.music]) {
        const song = new Song(g, spec.music, hash2(hashString(spec.music), 1), 0.02);
        song.out.gain.value = song.def.level;
        song.fx.gain.value = song.def.level;
        configureDelay(g, song.def, 0);
        let guard = 0; // scheduleUntil handles ≤ 64 steps per call
        while (song.nextTime < secs && guard++ < 200) song.scheduleUntil(secs);
      }
      if (spec.engine) {
        const e = new Engine(g, spec.engine.style);
        e.update(spec.engine.rpm, spec.engine.throttle, spec.engine.load, !!spec.engine.airborne, true);
      }
      return octx.startRendering().then((buf) => {
        let sum = 0, peak = 0, clipped = 0, n = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < d.length; i++) {
            const a = Math.abs(d[i]);
            sum += d[i] * d[i];
            if (a > peak) peak = a;
            if (a >= 0.999) clipped++;
            n++;
          }
        }
        const out = { rms: Math.sqrt(sum / Math.max(1, n)), peak, clipped, seconds: secs, sampleRate: sr };
        if (spec.returnData) out.data = buf.getChannelData(0);
        return out;
      }).catch((e) => { report(e); return null; });
    } catch (e) {
      report(e);
      return Promise.resolve(null);
    }
  }

  function stats() {
    return {
      state: live ? live.ctx.state : 'none',
      voices: live ? live.voices.length : 0,
      songs: live ? live.songs.length : 0,
      musicStyle: musicTarget,
      engine: engine && !engine.dead ? engine.style : null,
      errors,
      lastError
    };
  }

  const Audio = {
    init, setSound, setMusic, play, engineStart, engineUpdate, engineStop, music, duck, suspend, resume,
    renderOffline, stats,
    _pump() { try { tick(); } catch (e) { report(e); } },
    SFX_NAMES: Object.freeze(SFX_NAMES.slice()),
    MUSIC_STYLES: Object.freeze(MUSIC_STYLES.slice()),
    ENGINE_STYLES: Object.freeze(Object.keys(ENGINE))
  };
  Object.defineProperties(Audio, {
    soundOn: { get: () => soundOn, enumerable: true },
    musicOn: { get: () => musicOn, enumerable: true },
    available: { get: () => !!getAudioCtor(), enumerable: true },
    context: { get: () => (live ? live.ctx : null), enumerable: true },
    musicStyle: { get: () => musicTarget, enumerable: true },
    engineStyle: { get: () => (engine && !engine.dead ? engine.style : null), enumerable: true }
  });
  RR.Audio = Audio;
})();
