/* RIDGE RUSH — RR.Audio tests.
 *
 *   node tests/audio.test.js
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/audio.test.js   (adds the Chromium checks)
 *
 * 1. No Web Audio (plain harness): every public API is a safe no-op in any order.
 * 2. A strict fake Web Audio implementation (validates every AudioParam call the way browsers do:
 *    non-finite → TypeError, exponential ramp to 0 → RangeError, start twice → InvalidStateError…)
 *    drives init / SFX / voice limiting / rate limits / engine / music sequencer / crossfades /
 *    duck / suspend, and checks that nodes are released after use.
 * 3. Chromium (Playwright, optional): real AudioContext, every SFX, engine styles, every music style,
 *    toggles; no console errors; context running; OfflineAudioContext renders are non-silent.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./harness');

// ====================================================================== strict fake Web Audio
function makeFakeWebAudio() {
  const anomalies = [];
  const fin = (v, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('non-finite ' + what + ': ' + v);
  };
  class FakeParam {
    constructor(ctx, v, kind) { this.ctx = ctx; this._v = v; this.kind = kind; this.nEvents = 0; this.lastTarget = v; }
    get value() { return this._v; }
    set value(v) { fin(v, 'value'); this._v = v; this._check(v); }
    _time(t) { fin(t, 'time'); if (t < 0) throw new RangeError('negative time'); }
    _check(v) {
      if (this.kind === 'oscfreq' && (v <= 0 || v > 24000)) anomalies.push('osc frequency out of range: ' + v);
      // (gain nodes that feed frequency params carry Hz-scale modulation depths, so only flag absurd values)
      if (this.kind === 'gain' && Math.abs(v) > 10000) anomalies.push('huge gain: ' + v);
    }
    _ev(v) { this.nEvents++; this.lastTarget = v; this._v = v; this._check(v); return this; }
    setValueAtTime(v, t) { fin(v, 'setValueAtTime'); this._time(t); return this._ev(v); }
    linearRampToValueAtTime(v, t) { fin(v, 'linearRamp'); this._time(t); return this._ev(v); }
    exponentialRampToValueAtTime(v, t) {
      fin(v, 'expRamp'); this._time(t);
      if (v === 0) throw new RangeError('exponentialRamp to 0');
      return this._ev(v);
    }
    setTargetAtTime(v, t, tc) {
      fin(v, 'setTarget'); this._time(t); fin(tc, 'timeConstant');
      if (tc < 0) throw new RangeError('negative time constant');
      return this._ev(v);
    }
    cancelScheduledValues(t) { this._time(t); return this; }
    cancelAndHoldAtTime(t) { this._time(t); return this; }
  }
  class FakeNode {
    constructor(ctx) { this.ctx = ctx; this.outputs = new Set(); ctx.stats.nodes++; ctx.allNodes.push(this); }
    connect(d) {
      if (!(d instanceof FakeNode) && !(d instanceof FakeParam)) throw new TypeError('connect: bad destination');
      if (d.ctx !== this.ctx) throw new Error('connect across contexts');
      this.outputs.add(d);
      return d;
    }
    disconnect() { this.outputs.clear(); this.disconnected = true; }
  }
  class FakeSource extends FakeNode {
    constructor(ctx) { super(ctx); this.started = false; this.stopTime = Infinity; this.ended = false; this.onended = null; }
    start(t, offset) {
      if (this.started) throw new Error('InvalidStateError: start twice');
      t = t === undefined ? 0 : t;
      fin(t, 'start'); if (offset !== undefined) fin(offset, 'offset');
      this.started = true;
      this.startTime = t;
      if (t < this.ctx.currentTime - 1e-9) anomalies.push('start in the past by ' + (this.ctx.currentTime - t));
      this.ctx.liveSources.add(this);
      this.ctx.onStart(this, t);
    }
    stop(t) {
      if (!this.started) throw new Error('InvalidStateError: stop before start');
      t = t === undefined ? 0 : t;
      fin(t, 'stop');
      this.stopTime = t;
    }
  }
  const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
  class FakeOsc extends FakeSource {
    constructor(ctx) {
      super(ctx);
      this._type = 'sine';
      this.frequency = new FakeParam(ctx, 440, 'oscfreq');
      this.detune = new FakeParam(ctx, 0, 'detune');
    }
    get type() { return this._type; }
    set type(v) { if (!OSC_TYPES.includes(v)) throw new Error('bad osc type ' + v); this._type = v; }
  }
  class FakeBufferSource extends FakeSource {
    constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.playbackRate = new FakeParam(ctx, 1, 'rate'); }
  }
  const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];
  class FakeBiquad extends FakeNode {
    constructor(ctx) {
      super(ctx);
      this._type = 'lowpass';
      this.frequency = new FakeParam(ctx, 350, 'freq');
      this.Q = new FakeParam(ctx, 1, 'q');
      this.gain = new FakeParam(ctx, 0, 'fgain');
      this.detune = new FakeParam(ctx, 0, 'detune');
    }
    get type() { return this._type; }
    set type(v) { if (!FILTER_TYPES.includes(v)) throw new Error('bad filter type ' + v); this._type = v; }
  }
  class FakeShaper extends FakeNode {
    constructor(ctx) { super(ctx); this._curve = null; this.oversample = 'none'; }
    get curve() { return this._curve; }
    set curve(c) {
      if (c !== null && !(c instanceof Float32Array)) throw new TypeError('curve must be Float32Array');
      if (c && c.length < 2) throw new Error('curve too short');
      for (let i = 0; c && i < c.length; i++) fin(c[i], 'curve sample');
      this._curve = c;
    }
  }
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'suspended';
      this.stats = { nodes: 0 };
      this.allNodes = [];
      this.liveSources = new Set();
      this.starts = [];
      this.recordStarts = false;
      this.destination = new FakeNode(this);
      FakeAudioContext.instances.push(this);
    }
    onStart(src, t) {
      if (this.recordStarts && src instanceof FakeOsc) {
        this.starts.push({ t, f: Math.round(src.frequency.value), type: src.type, ahead: t - this.currentTime });
      }
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { const n = new FakeNode(this); n.gain = new FakeParam(this, 1, 'gain'); return n; }
    createOscillator() { return new FakeOsc(this); }
    createBufferSource() { return new FakeBufferSource(this); }
    createBiquadFilter() { return new FakeBiquad(this); }
    createWaveShaper() { return new FakeShaper(this); }
    createDelay(max) {
      fin(max, 'maxDelay');
      const n = new FakeNode(this); n.delayTime = new FakeParam(this, 0, 'delay'); return n;
    }
    createDynamicsCompressor() {
      const n = new FakeNode(this);
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(this, 0, k);
      return n;
    }
    createBuffer(ch, len, sr) {
      if (!(len > 0) || !(ch > 0)) throw new Error('bad buffer');
      const data = [];
      for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    }
    // Advance the audio clock; sources whose stop time passed fire onended (like the real thing).
    advance(dt) {
      if (this.state !== 'running') return;
      this.currentTime += dt;
      const ended = [];
      for (const s of this.liveSources) {
        if (s.stopTime <= this.currentTime) { s.ended = true; ended.push(s); }
      }
      for (const s of ended) {
        this.liveSources.delete(s);
        if (typeof s.onended === 'function') s.onended();
      }
    }
  }
  FakeAudioContext.instances = [];
  // Offline flavour: graph is built synchronously, startRendering() snapshots how many nodes were
  // already disconnected (a voice released before it even played would show up here).
  class FakeOfflineAudioContext extends FakeAudioContext {
    constructor(ch, len, sr) {
      super();
      FakeAudioContext.instances.pop();
      this.sampleRate = sr;
      this.length = len;
      FakeOfflineAudioContext.last = this;
    }
    startRendering() {
      this.disconnectedAtRender = this.allNodes.filter((n) => n.disconnected).length;
      this.sourcesAtRender = this.liveSources.size;
      const buf = this.createBuffer(2, this.length, this.sampleRate);
      return Promise.resolve(buf);
    }
  }
  return { FakeAudioContext, FakeOfflineAudioContext, anomalies };
}

// ====================================================================== 1. no Web Audio
console.log('RR.Audio — no Web Audio available');
{
  const RR = H.load(['js/core/utils.js', 'js/core/audio.js']);
  const A = RR.Audio;
  H.test('module loads and exposes the contract API', () => {
    H.assert(A, 'RR.Audio exists');
    for (const k of ['init', 'setSound', 'setMusic', 'play', 'engineStart', 'engineUpdate', 'engineStop', 'music', 'duck', 'suspend', 'resume']) {
      H.assert(typeof A[k] === 'function', k + ' is a function');
    }
    H.assert(A.soundOn === true && A.musicOn === true, 'defaults on');
    H.assert(A.available === false, 'available false without AudioContext');
    H.assert(A.SFX_NAMES.length === 27, 'all 27 contract SFX names listed');
    H.assert(A.MUSIC_STYLES.join() === 'menu,valley,highland,desert,ice,volcanic,space,synthwave,storm,boss', 'music styles');
    H.assert(A.ENGINE_STYLES.join() === 'buggy,dirt,truck,rally,crawler,storm', 'engine styles');
  });
  H.test('every API is a safe no-op before and after init() (random order, junk args)', () => {
    const junk = [undefined, null, NaN, Infinity, -1, 0, 1, 'x', {}, [], { pitch: NaN, volume: Infinity }, { rpm: NaN }];
    const calls = [
      () => A.init(), () => A.setSound(junk[0]), () => A.setMusic(true), () => A.setSound(false), () => A.setSound(true),
      () => A.play('coin'), () => A.play('nope'), () => A.play(undefined, { pitch: -5 }), () => A.engineStart('truck'),
      () => A.engineStart(42), () => A.engineUpdate({ rpm: NaN, throttle: 2, load: -1, airborne: 'yes' }), () => A.engineUpdate(),
      () => A.engineStop(), () => A.music('valley'), () => A.music('bogus'), () => A.music(null), () => A.duck(true),
      () => A.duck(false), () => A.suspend(), () => A.resume(), () => A.stats(), () => A._pump(),
      () => A.renderOffline({ sfx: 'coin' })
    ];
    const rng = RR.Util.makeRng(7);
    for (let i = 0; i < 600; i++) {
      const fn = calls[rng.int(0, calls.length - 1)];
      fn();
      const name = rng.pick(A.SFX_NAMES);
      A.play(name, rng.pick(junk));
    }
    H.assert(A.init() === false, 'init() reports no context');
    H.assert(A.context === null, 'no context');
    H.assert(A.stats().errors === 0, 'no internal errors: ' + A.stats().lastError);
    A.setSound(false); H.assert(A.soundOn === false, 'soundOn false');
    A.setMusic(false); H.assert(A.musicOn === false, 'musicOn false');
    A.setSound(1); A.setMusic('on');
    H.assert(A.soundOn === true && A.musicOn === true, 'truthy values coerced');
    H.assert(A.play('coin') === false, 'play without context returns false');
  });
  H.test('renderOffline resolves null without Web Audio', () => {
    const p = A.renderOffline({ music: 'menu' });
    H.assert(p && typeof p.then === 'function', 'returns a promise');
  });
}

// ====================================================================== 2. strict fake Web Audio
console.log('\nRR.Audio — strict fake Web Audio');
{
  const { FakeAudioContext, FakeOfflineAudioContext, anomalies } = makeFakeWebAudio();
  const sandbox = H.createContext();
  sandbox.AudioContext = FakeAudioContext;
  sandbox.OfflineAudioContext = FakeOfflineAudioContext;
  const RR = H.load(['js/core/utils.js', 'js/core/audio.js'], sandbox);
  const A = RR.Audio;
  let ctx = null;
  const run = (seconds, dt) => { // advance the fake audio clock and pump the scheduler
    dt = dt || 0.025;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) { ctx.advance(dt); A._pump(); }
  };
  const noErrors = (label) => H.assert(A.stats().errors === 0, (label || '') + ' internal error: ' + A.stats().lastError);

  H.test('requests before init() are remembered and start on init()', () => {
    A.engineStart('truck');
    A.music('valley');
    H.assert(A.play('coin') === false, 'no sound before init');
    H.assert(A.init() === true, 'init true');
    ctx = A.context;
    H.assert(ctx instanceof FakeAudioContext, 'context created');
    H.assert(FakeAudioContext.instances.length === 1, 'one context');
    H.assert(ctx.state === 'running', 'resumed');
    H.assert(A.init() === true && FakeAudioContext.instances.length === 1, 'init idempotent');
    H.assert(A.stats().engine === 'truck', 'pending engine started');
    H.assert(A.stats().songs === 1 && A.musicStyle === 'valley', 'pending music started');
    noErrors();
  });

  H.test('every SFX plays (default + extreme opts) without errors', () => {
    A.music(null);
    A.engineStop();
    run(5);
    for (const name of A.SFX_NAMES) {
      H.assert(A.play(name) === true, name + ' played');
      run(0.3);
    }
    const optsList = [{ pitch: 0.45, volume: 0.25 }, { pitch: 1.5, volume: 0.6 }, { pitch: NaN, volume: NaN },
      { pitch: 100, volume: 100 }, { pitch: -1 }, { volume: 0.05 }];
    for (const o of optsList) {
      for (const name of A.SFX_NAMES) { A.play(name, o); run(0.26); }
    }
    H.assert(A.play('coin', { volume: 0 }) === false, 'zero volume skipped');
    H.assert(A.play('definitelyNot') === false, 'unknown name ignored');
    H.assert(anomalies.length === 0, 'anomalies: ' + anomalies.slice(0, 5).join('; '));
    noErrors();
  });

  H.test('per-name rate limits (coin ≥ 35 ms, tick ≥ 40 ms)', () => {
    run(1);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (A.play('coin')) ok++;
    H.assert(ok === 1, 'only one coin in the same instant, got ' + ok);
    ctx.advance(0.02);
    H.assert(A.play('coin') === false, 'coin 20 ms later is limited');
    ctx.advance(0.02);
    H.assert(A.play('coin') === true, 'coin 40 ms later plays');
    H.assert(A.play('tick') === true, 'tick plays');
    ctx.advance(0.03);
    H.assert(A.play('tick') === false, 'tick 30 ms later limited');
    ctx.advance(0.015);
    H.assert(A.play('tick') === true, 'tick 45 ms later plays');
  });

  H.test('voice limit: never more than 24 concurrent SFX voices; voices are released', () => {
    run(3);
    let maxV = 0;
    for (let i = 0; i < 400; i++) {
      A.play(A.SFX_NAMES[i % A.SFX_NAMES.length], { pitch: 1 + (i % 5) * 0.1 });
      ctx.advance(0.004);
      maxV = Math.max(maxV, A.stats().voices);
    }
    H.assert(maxV <= 24, 'max voices ' + maxV);
    H.assert(maxV >= 20, 'the pool actually filled up (' + maxV + ')');
    run(4);
    H.assert(A.play('click') === true, 'plays after the storm');
    run(1);
    H.assert(A.stats().voices === 0, 'all voices released, left ' + A.stats().voices);
    H.assert(ctx.liveSources.size === 0, 'no sources left running: ' + ctx.liveSources.size);
    noErrors();
  });

  H.test('finished voices disconnect every node they created', () => {
    run(2);
    const before = ctx.allNodes.length;
    for (const name of A.SFX_NAMES) { A.play(name); run(0.1); }
    run(4);
    const created = ctx.allNodes.slice(before);
    const stillWired = created.filter((n) => n.outputs.size > 0);
    H.assert(created.length > 100, 'created nodes: ' + created.length);
    H.assert(stillWired.length === 0, stillWired.length + ' nodes still connected');
  });

  H.test('coin pitch climbs with rapid pickups and resets after a pause', () => {
    run(1);
    ctx.recordStarts = true;
    ctx.starts.length = 0;
    const firstFreq = () => { const s = ctx.starts[0]; ctx.starts.length = 0; return s.f; };
    A.play('coin'); const f0 = firstFreq();
    ctx.advance(0.1); A.play('coin'); const f1 = firstFreq();
    ctx.advance(0.1); A.play('coin'); const f2 = firstFreq();
    ctx.advance(1.0); A.play('coin'); const f3 = firstFreq();
    ctx.recordStarts = false;
    H.assert(f1 > f0 && f2 > f1, 'rising: ' + [f0, f1, f2].join(' < '));
    H.assert(Math.abs(f3 - f0) <= 1, 'reset after a pause: ' + f3 + ' vs ' + f0);
  });

  H.test('engine: every style starts, tracks junk/extreme updates, airborne, stops and releases', () => {
    const rng = RR.Util.makeRng(99);
    for (const style of A.ENGINE_STYLES) {
      A.engineStart(style);
      H.assert(A.engineStyle === style, 'running ' + style);
      for (let i = 0; i < 240; i++) {
        const u = i % 40 === 0
          ? { rpm: NaN, throttle: Infinity, load: -3, airborne: 1 }
          : { rpm: rng.next(), throttle: i % 30 < 15 ? 1 : 0, load: rng.next(), airborne: i % 60 > 50 };
        A.engineUpdate(u);
        ctx.advance(1 / 60);
        A._pump();
      }
    }
    A.engineStart('rally'); // same style again = no restart
    A.engineStart('rally');
    A.engineStop();
    H.assert(A.engineStyle === null, 'stopped');
    run(1);
    H.assert(A.stats().voices === 0, 'blow-off voices released');
    H.assert(ctx.liveSources.size === 0, 'engine sources stopped: ' + ctx.liveSources.size);
    A.engineStart('bogus');
    H.assert(A.engineStyle === 'buggy', 'unknown style falls back to buggy');
    A.engineStop();
    run(1);
    H.assert(anomalies.length === 0, 'anomalies: ' + anomalies.slice(0, 5).join('; '));
    noErrors();
  });

  H.test('rally blow-off fires on a sharp throttle lift at high revs', () => {
    A.engineStart('rally');
    for (let i = 0; i < 30; i++) { A.engineUpdate({ rpm: 0.9, throttle: 1, load: 0.5 }); ctx.advance(1 / 60); }
    const v0 = A.stats().voices;
    A.engineUpdate({ rpm: 0.9, throttle: 0, load: 0 });
    H.assert(A.stats().voices === v0 + 1, 'blow-off voice started');
    A.engineStop();
    run(1);
  });

  // Music: every style schedules plenty of notes, ahead of the clock, and varies phrase to phrase.
  for (const style of A.MUSIC_STYLES) {
    H.test('music "' + style + '": schedules ahead, dense enough, and not a tiny loop', () => {
      A.music(style);
      run(3); // past the crossfade
      ctx.recordStarts = true;
      ctx.starts.length = 0;
      const t0 = ctx.currentTime;
      const secs = 32;
      run(secs);
      ctx.recordStarts = false;
      const starts = ctx.starts.slice();
      H.assert(starts.length > secs * 4, 'notes scheduled: ' + starts.length);
      const maxAhead = Math.max.apply(null, starts.map((s) => s.ahead));
      H.assert(maxAhead <= 0.2, 'scheduled too far ahead: ' + maxAhead);
      // Split into bars and fingerprint each bar's pitch content (drums excluded: pitched notes only).
      const bpm = { menu: 104, valley: 112, highland: 96, desert: 100, ice: 84, volcanic: 86, space: 70, synthwave: 100, storm: 128, boss: 146 }[style];
      const barLen = (60 / bpm) * 4;
      const bars = new Map();
      for (const s of starts) {
        if (s.type === 'sine' && s.f < 200) continue; // kicks/toms/sub
        const b = Math.floor((s.t - t0) / barLen);
        if (!bars.has(b)) bars.set(b, []);
        bars.get(b).push(s.f);
      }
      const prints = new Set();
      for (const arr of bars.values()) prints.add(arr.slice().sort((a, b) => a - b).join(','));
      H.assert(prints.size >= Math.min(6, bars.size - 1), 'distinct bars ' + prints.size + ' / ' + bars.size);
      H.assert(A.stats().songs === 1, 'one song after the crossfade, got ' + A.stats().songs);
      noErrors(style);
    });
  }

  H.test('crossfade: two songs overlap ~1.2 s, then the old one is disposed', () => {
    A.music('menu');
    run(5); // lets the previous style's fade + tail finish
    H.assert(A.stats().songs === 1, 'settled on one song');
    A.music('boss');
    run(0.5);
    H.assert(A.stats().songs === 2, 'overlapping during crossfade');
    run(4);
    H.assert(A.stats().songs === 1, 'old song disposed');
    A.music('boss');
    H.assert(A.stats().songs === 1, 'same style again does not restart');
  });

  H.test('music(null) fades out and stops the sequencer; unknown styles are ignored', () => {
    A.music('bogus');
    H.assert(A.musicStyle === 'boss', 'unknown ignored');
    A.music(null);
    run(5);
    H.assert(A.stats().songs === 0 && A.musicStyle === null, 'silent');
    const n = ctx.liveSources.size;
    H.assert(n === 0, 'no music sources left: ' + n);
  });

  H.test('setMusic(false) stops music but keeps the target; setMusic(true) restarts it', () => {
    A.music('synthwave');
    run(2);
    A.setMusic(false);
    run(4);
    H.assert(A.stats().songs === 0, 'sequencer stopped while music is off');
    A.music('ice');
    run(1);
    H.assert(A.stats().songs === 0 && A.musicStyle === 'ice', 'target stored while off');
    A.setMusic(true);
    run(1);
    H.assert(A.stats().songs === 1 && A.musicStyle === 'ice', 'restarted with stored target');
  });

  H.test('setSound(false) silences SFX; duck / suspend / resume', () => {
    A.setSound(false);
    H.assert(A.play('coin') === false, 'no SFX while sound is off');
    A.setSound(true);
    run(0.1);
    H.assert(A.play('coin') === true, 'SFX back on');
    A.duck(true); run(0.5); A.duck(false);
    A.suspend();
    H.assert(ctx.state === 'suspended', 'suspended');
    H.assert(A.play('crash') === false, 'no SFX queued on a suspended clock');
    A.init(); // a gesture-driven init must not undo the game's suspend()
    H.assert(ctx.state === 'suspended', 'still suspended after init()');
    A.resume();
    H.assert(ctx.state === 'running', 'running again');
    run(1);
    H.assert(A.play('crash') === true, 'SFX after resume');
    run(2);
    noErrors();
  });

  H.test('renderOffline: a chain of future-scheduled SFX keeps every voice alive until it plays', () => {
    const p = A.renderOffline({ sfx: A.SFX_NAMES, gap: 0.6, seconds: A.SFX_NAMES.length * 0.6 + 1 });
    H.assert(p && typeof p.then === 'function', 'promise');
    const oc = FakeOfflineAudioContext.last;
    H.assert(oc, 'offline context built');
    H.assert(oc.disconnectedAtRender === 0, oc.disconnectedAtRender + ' nodes released before rendering');
    H.assert(oc.sourcesAtRender > A.SFX_NAMES.length * 2, 'sources scheduled: ' + oc.sourcesAtRender);
    const pm = A.renderOffline({ music: 'storm', seconds: 6, engine: { style: 'rally', rpm: 0.7, throttle: 1 } });
    H.assert(pm && FakeOfflineAudioContext.last.sourcesAtRender > 100, 'music+engine offline scheduled');
    noErrors();
  });

  H.test('no anomalies and no internal errors overall; scheduler stops when idle', () => {
    A.music(null);
    A.engineStop();
    run(5);
    H.assert(A.stats().songs === 0, 'no songs left');
    H.assert(anomalies.length === 0, 'anomalies: ' + anomalies.slice(0, 5).join('; '));
    noErrors();
  });
  // Safety net so a failed assertion can never leave the scheduler interval keeping node alive.
  A.music(null);
  run(5);
}

// ====================================================================== 3. Chromium (optional)
async function browserSuite() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.log('\nRR.Audio — Chromium checks skipped (playwright not resolvable; set NODE_PATH=/opt/node22/lib/node_modules)');
    return;
  }
  console.log('\nRR.Audio — Chromium (real Web Audio)');
  const html = '<!doctype html><meta charset="utf-8"><title>RR.Audio test</title><body>' +
    ['js/core/utils.js', 'js/core/audio.js'].map((f) => '<script src="' + 'file://' + path.join(H.ROOT, f) + '"></script>').join('') +
    '</body>';
  const file = path.join(os.tmpdir(), 'rr-audio-test-' + process.pid + '.html');
  fs.writeFileSync(file, html);
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await page.goto('file://' + file);

    const live = await page.evaluate(async () => {
      const A = window.RR.Audio;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = { initOk: A.init(), states: [] };
      for (let i = 0; i < 50 && A.context.state !== 'running'; i++) await sleep(20);
      out.states.push(A.context.state);
      A.music('menu');
      for (const n of A.SFX_NAMES) { out[n] = A.play(n); await sleep(110); }
      for (const st of A.ENGINE_STYLES) {
        A.engineStart(st);
        for (let i = 0; i < 40; i++) {
          const k = i / 39;
          A.engineUpdate({ rpm: k, throttle: i < 30 ? 1 : 0, load: 0.5, airborne: i > 20 && i < 26 });
          await sleep(16);
        }
      }
      A.engineStop();
      out.maxSongs = 0;
      for (const st of A.MUSIC_STYLES) {
        A.music(st);
        for (let i = 0; i < 10; i++) { await sleep(200); out.maxSongs = Math.max(out.maxSongs, A.stats().songs); }
      }
      A.setSound(false); A.setMusic(false); await sleep(150);
      A.setSound(true); A.setMusic(true); await sleep(150);
      A.duck(true); await sleep(200); A.duck(false);
      A.suspend(); await sleep(150); out.states.push(A.context.state);
      A.resume(); await sleep(250); out.states.push(A.context.state);
      A.music(null);
      await sleep(300);
      out.stats = A.stats();
      return out;
    });
    results.push(['init() and context running', live.initOk === true && live.states[0] === 'running', JSON.stringify(live.states)]);
    const failedSfx = (await page.evaluate(() => window.RR.Audio.SFX_NAMES)).filter((n) => live[n] !== true);
    results.push(['every SFX started', failedSfx.length === 0, failedSfx.join(',')]);
    results.push(['crossfades overlap at most 2 songs', live.maxSongs <= 2 && live.maxSongs >= 1, 'max ' + live.maxSongs]);
    results.push(['suspend()/resume() drive the context state', live.states[1] === 'suspended' && live.states[2] === 'running', JSON.stringify(live.states)]);
    results.push(['no internal errors', live.stats.errors === 0, live.stats.lastError]);
    results.push(['no console errors or warnings', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | ')]);

    // Offline renders: every sound must produce real signal without clipping the master bus.
    const offline = await page.evaluate(async () => {
      const A = window.RR.Audio;
      const res = { sfx: {}, music: {}, engine: {} };
      for (const n of A.SFX_NAMES) res.sfx[n] = await A.renderOffline({ sfx: n, seconds: 2 });
      for (const m of A.MUSIC_STYLES) res.music[m] = await A.renderOffline({ music: m, seconds: 8 });
      for (const e of A.ENGINE_STYLES) res.engine[e] = await A.renderOffline({ engine: { style: e, rpm: 0.5, throttle: 0.7, load: 0.5 }, seconds: 1.5 });
      res.engineIdle = await A.renderOffline({ engine: { style: 'buggy', rpm: 0, throttle: 0, load: 0 }, seconds: 1.5 });
      // All SFX chained 0.6 s apart in one render: every slot must contain signal.
      const gap = 0.6, sr = 22050;
      const chain = await A.renderOffline({ sfx: A.SFX_NAMES, gap, seconds: A.SFX_NAMES.length * gap + 1, sampleRate: sr, returnData: true });
      res.silentSlots = [];
      A.SFX_NAMES.forEach((n, i) => {
        const a = Math.floor((0.02 + i * gap) * sr), b = Math.floor((0.02 + i * gap + 0.25) * sr);
        let pk = 0;
        for (let k = a; k < b; k++) pk = Math.max(pk, Math.abs(chain.data[k]));
        if (pk < 0.03) res.silentSlots.push(n + ':' + pk.toFixed(3));
      });
      return res;
    });
    const table = [];
    const bad = [];
    for (const group of ['sfx', 'music', 'engine']) {
      for (const [k, r] of Object.entries(offline[group])) {
        if (!r) { bad.push(group + ':' + k + ' null'); continue; }
        table.push(group.padEnd(6) + k.padEnd(10) + ' rms ' + r.rms.toFixed(4) + '  peak ' + r.peak.toFixed(3));
        // Short blips (tick, click) have a tiny RMS over the window, so require a real peak too.
        if (!(r.peak > 0.05 && r.rms > 0.0008)) bad.push(group + ':' + k + ' too quiet rms=' + r.rms.toFixed(5) + ' peak=' + r.peak.toFixed(3));
        if (r.clipped > 0 || r.peak > 1) bad.push(group + ':' + k + ' clips peak=' + r.peak.toFixed(3));
      }
    }
    console.log('    offline loudness:\n      ' + table.join('\n      '));
    results.push(['offline renders are non-silent and never clip', bad.length === 0, bad.join('; ')]);
    results.push(['chained SFX render: every sound audible in its slot', offline.silentSlots.length === 0, offline.silentSlots.join(', ')]);
    const mRms = Object.values(offline.music).map((r) => r.rms);
    const eRms = Object.values(offline.engine).map((r) => r.rms);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    results.push(['engine sits under the music (avg rms)', avg(eRms) < avg(mRms), 'engine ' + avg(eRms).toFixed(4) + ' music ' + avg(mRms).toFixed(4)]);
    results.push(['idle engine is audible but quieter than revving', offline.engineIdle.rms > 0.002 && offline.engineIdle.rms < offline.engine.buggy.rms, offline.engineIdle.rms.toFixed(4)]);
  } catch (e) {
    results.push(['browser suite ran', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e)]);
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
  for (const [name, ok, info] of results) H.test('browser: ' + name, () => H.assert(ok, info));
}

browserSuite().then(() => H.done(), (e) => { console.error(e); process.exitCode = 1; H.done(); });
