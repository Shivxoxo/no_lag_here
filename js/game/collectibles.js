/* RIDGE RUSH — coins, fuel and power-up pickups (RR.Collectibles).
 *
 * Contract: docs/ARCHITECTURE.md §5.8 + docs/INTEGRATION_NOTES.md.
 *   new RR.Collectibles(run)
 *   c.spawnChunk(x0, x1, features)   // from terrain.onChunk
 *   c.addCoin(x, y, baseValue, opts{vx, vy, falling})   // events (coin storm, bird drop, ramp arcs)
 *   c.update(dt, run); c.draw(ctx, run) (WORLD transform); c.nextFuelDistance(x)
 *   Callbacks: run.onCoin(value, x, y) · run.onFuel(kind, x, y) · run.onPowerup(type, x, y)
 *
 * PLACEMENT (deterministic per run seed: independent streams run.rng('coins' | 'fuel' | 'powerups'))
 *  - Coin trails: 4–10 coins (× density), 1.6 m apart, 34–70 m between trails (integration economy pass:
 *    was 5–12 coins every 16–38 m, ≈ 2.2 coins/m), following the ground at +0.9–1.2 m (some gently
 *    arched). Mostly bronze early; more silver trails / gold finishers as difficulty rises.
 *  - Coin arcs above jumps, gaps and lava pools: the ballistic path of the chassis from the feature's
 *    take-off point (meta.takeoffX/Y/Angle) at a reachable launch speed (gaps: meta.vReq + 1.8 m/s),
 *    sampled every 1.6 m of arc length until it meets the landing. Gaps and lava are "risky": silver arc,
 *    gold apex and two gold coins high above the apex for players who launch with extra speed.
 *  - Hard spots: silver coins on the crest of sustained steep climbs, bronze lines (every 4th silver) over
 *    rock gardens.
 *  - Bonus clusters: a silver/gold arch on plateaus, a gold arch on boss summits, silver coins on ledges,
 *    a coin column over bounce pads, a trail after boost pads.
 *  - Values: 5 / 25 / 100 × world.coinMul × modifiers.coinMul; trail density × modifiers.coinDensityMul.
 *    addCoin() from events applies the SAME multipliers to its base value.
 *  - Fuel: first can ≈ 150 m, then every min(1150, 230 + 0.5·x) × world.fuelSpacing m (integration
 *    balance pass; the contract's lerp(170, 360, difficulty) never let a tank run dry). Never inside a
 *    trench or lava basin, on a kicker ramp, a pad or a designed wall (terrain flags) or on a hazard
 *    surface; sits on the ground at +0.8 m. An energy cell (+35 %) sometimes sits between two cans; a
 *    mega orb (full + 8 s without drain) replaces a can roughly every 1.9–2.6 km (first ≈ 1.9 km).
 *    None at all when modifiers.noFuelPickups.
 *  - Power-ups every 300–500 m (first ≈ 300 m), weighted (shield rarest), never on top of a fuel can.
 *
 * RUNTIME
 *  - Three x-sorted arrays (coins / fuel / power-ups) with a head pointer: update scans only ±12 m around
 *    the car, draw only the visible window (binary search); items behind the car are recycled into a pool.
 *    Falling coins from events live in a small separate list until the car passes them.
 *  - Pickup test against the chassis (three circles along the hull), both wheels and the head. Fuel
 *    pickups also collect when the car passes within ±1.4 m horizontally and ≤ 3.6 m above them (crest hops).
 *  - MAGNET: coins within 9 m fly to the car. Collect animation: the item flies into the car and shrinks
 *    for 0.2 s, then the callback fires. Nothing new is collected while the run is crashed/ended.
 *
 * Contract additions (callers may ignore): c.coins / c.fuel / c.powerups (read-only x-sorted item arrays,
 * entries before their `head` index are stale), c.falling, c.stats {coins, fuel, cells, megas, powerups,
 * coinValue} (spawned), c.collected {coin, fuel, cell, mega, powerup}, c.clear(), c.nextFuel(x) → item|null,
 * RR.Collectibles.COIN_BASE [5, 25, 100].
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;
  const TAU = Math.PI * 2;
  const isNum = U.isNum, clamp = U.clamp, lerp = U.lerp;

  // ------------------------------------------------------------------ tunables
  const COIN_BASE = Object.freeze([5, 25, 100]);   // bronze / silver / gold
  const COIN_R = [0.3, 0.34, 0.4];                   // drawn radius (m)
  const PICK_R = { coin: 0.36, fuel: 0.6, cell: 0.5, mega: 0.8, powerup: 0.62 };
  const CAN_SCALE = 1.2;                             // the jerrycan is drawn a little larger: it matters most
  const TRAIL_SPACING = 1.6;
  const MAGNET_R = 9;
  const FUEL_REACH_X = 1.4;          // fuel pickups: car centre within ±1.4 m horizontally …
  const FUEL_REACH_Y = 3.6;          // … and up to 3.6 m above the pickup collects it
  const COLLECT_T = 0.2;
  const SCAN_BEHIND = 12, SCAN_AHEAD = 12;
  const CLEAN_BEHIND = 30;
  const FIRST_TRAIL = 26;
  const FIRST_FUEL = 150;
  const FUEL_GAP_0 = 230;            // m between fuel pickups at the start of a run …
  const FUEL_GAP_GROWTH = 0.5;       // … growing by this many metres per metre travelled …
  const FUEL_GAP_MAX = 1150;         // … up to this cap
  const FIRST_MEGA = 1900;
  const MAX_FALLING = 96;
  const SEARCH_AHEAD = 45;          // m searched for a safe fuel / power-up spot
  const PICKUP_GAP = 8;             // m kept between a fuel pickup and a power-up
  const WRITTEN_AHEAD = 18;         // m past a published chunk whose heights/flags are final

  // item kinds / states
  const COIN = 'coin', POWER = 'powerup';
  const IDLE = 0, MAGNET = 1, COLLECTING = 2, DEAD = 3;

  const COIN_COL = [
    { rim: '#7d4219', face: '#e39443', back: '#c7772c', emboss: '#b3612a', light: '#ffd6a0' },
    { rim: '#6f7b8b', face: '#e2e8f0', back: '#c3ccd8', emboss: '#9aa6b6', light: '#ffffff' },
    { rim: '#a26800', face: '#ffd02e', back: '#f0b41c', emboss: '#d99500', light: '#fff7c2' }
  ];
  const FUEL_GLOW = '#ff6a3d', CELL_GLOW = '#3ee07a', MEGA_GLOW = '#5dffb0', GOLD_GLOW = '#ffd84a';

  // ------------------------------------------------------------------ helpers
  function Item() {
    this.kind = COIN; this.type = ''; this.x = 0; this.y = 0; this.value = 0; this.tier = 0;
    this.state = IDLE; this.t = 0; this.sx = 0; this.sy = 0; this.vx = 0; this.vy = 0;
    this.falling = false; this.settled = true; this.phase = 0; this.r = PICK_R.coin; this.scale = 1;
  }

  // First index ≥ from whose x ≥ x (items between `from` and the end are non-null, ~sorted by x).
  function lowerBound(items, from, x) {
    let lo = from, hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].x < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function frac(v) { return v - Math.floor(v); }

  let errLogged = false;
  function logOnce(where, e) {
    if (errLogged) return;
    errLogged = true;
    if (typeof console !== 'undefined') console.error('[RR.Collectibles] ' + where + ' failed:', e);
  }

  // ================================================================== class
  class Collectibles {
    constructor(run) {
      this.run = run || null;
      const world = (run && run.world) || (RR.Worlds && RR.Worlds.list && RR.Worlds.list[0]) || {};
      const mods = (run && run.modifiers) || null;
      this.world = world;
      this._coinMul = Math.max(0.01, U.safeNum(world.coinMul, 1) * U.safeNum(mods && mods.coinMul, 1));
      this._density = clamp(U.safeNum(mods && mods.coinDensityMul, 1), 0.2, 4);
      this._fuelSpacing = clamp(U.safeNum(world.fuelSpacing, 1), 0.3, 4);
      this._noFuel = !!(mods && mods.noFuelPickups);
      this._g = 9.81 * clamp(U.safeNum(world.gravity, 1), 0.1, 3) * clamp(U.safeNum(mods && mods.gravityMul, 1), 0.2, 3);

      const rng = (name) => {
        try { if (run && typeof run.rng === 'function') { const r = run.rng(name); if (r && typeof r.next === 'function') return r; } } catch (e) { /* fall through */ }
        return U.makeRng(U.hashString('collectibles|' + name + '|' + (world.id || '')));
      };
      this._rc = rng('coins');
      this._rf = rng('fuel');
      this._rp = rng('powerups');

      this.coins = [];
      this.fuel = [];
      this.powerups = [];
      this.falling = [];
      this._heads = { coins: 0, fuel: 0, powerups: 0 };
      this._pool = [];
      this._buf = [];
      this._reserved = [];          // [a0, b0, a1, b1, …] x-intervals already used by designed coin sets
      this.time = 0;

      this._nextTrailX = FIRST_TRAIL;
      this._nextFuelX = FIRST_FUEL + this._rf.range(-8, 8);
      this._nextCellX = NaN;
      this._nextMegaX = FIRST_MEGA + this._rf.range(-150, 150);
      this._nextPowerX = this._rp.range(270, 340);

      this.stats = { coins: 0, fuel: 0, cells: 0, megas: 0, powerups: 0, coinValue: 0 };
      this.collected = { coin: 0, fuel: 0, cell: 0, mega: 0, powerup: 0 };

      // pickup circles (x, y, r) × up to 6, refreshed each update
      this._circ = new Float64Array(18);
      this._nCirc = 0;
      this._head = { x: 0, y: 0, r: 0 };
      this._b = { left: 0, right: 0, bottom: 0, top: 0 };
      this._hullTuned = null;
      this._hullLocal = [0, 0.1, 1.3, 1.2, 0, 0.55, -1.2, 0.1, 0.55];
    }

    // ================================================================ spawning
    spawnChunk(x0, x1, features) {
      if (!isNum(x0) || !isNum(x1) || !(x1 > x0)) return;
      const T = this.run && this.run.terrain;
      if (!T || typeof T.heightAt !== 'function') return;
      try {
        this._pruneReserved(x0);
        const buf = this._buf;
        buf.length = 0;
        if (Array.isArray(features)) {
          for (let i = 0; i < features.length; i++) {
            const f = features[i];
            if (f && isNum(f.x)) this._featureCoins(f, T);
          }
        }
        this._trails(x0, x1, T);
        this._commitCoins(buf);
        buf.length = 0;
        this._fuelChunk(x0, x1, T);
        this._powerChunk(x0, x1, T);
      } catch (e) {
        logOnce('spawnChunk', e);
      }
    }

    // Coins dropped by events. Applies world.coinMul × modifiers.coinMul to the base value.
    addCoin(x, y, value, opts) {
      if (!isNum(x) || !isNum(y)) return null;
      const base = Math.max(1, U.safeNum(value, 5));
      const tier = base >= 100 ? 2 : base >= 25 ? 1 : 0;
      const it = this._item(COIN, x, y);
      it.tier = tier;
      it.value = Math.max(1, Math.round(base * this._coinMul));
      it.r = PICK_R.coin;
      this.stats.coins++;
      this.stats.coinValue += it.value;
      if (opts && opts.falling) {
        it.falling = true;
        it.settled = false;
        it.vx = clamp(U.safeNum(opts.vx, 0), -30, 30);
        it.vy = clamp(U.safeNum(opts.vy, 0), -30, 30);
        const fl = this.falling;
        if (fl.length >= MAX_FALLING) this._recycle(fl.shift());
        fl.push(it);
      } else {
        this._insertSorted(this.coins, 'coins', it);
      }
      return it;
    }

    _item(kind, x, y) {
      const it = this._pool.length ? this._pool.pop() : new Item();
      it.kind = kind; it.type = ''; it.x = x; it.y = y; it.value = 0; it.tier = 0;
      it.state = IDLE; it.t = 0; it.sx = x; it.sy = y; it.vx = 0; it.vy = 0;
      it.falling = false; it.settled = true; it.scale = 1;
      it.phase = U.hash2(Math.floor(x * 8) | 0, 0x51ab) / 4294967296 * TAU;
      it.r = PICK_R[kind] || PICK_R.coin;
      return it;
    }

    _recycle(it) {
      if (it && this._pool.length < 512) this._pool.push(it);
    }

    _insertSorted(list, key, it) {
      const head = this._heads[key];
      const i = lowerBound(list, head, it.x);
      if (i >= list.length) list.push(it); else list.splice(i, 0, it);
    }

    // Append a batch (sorted in place) keeping the list sorted; the batch may overlap the list's tail.
    _commitCoins(buf) {
      if (!buf.length) return;
      buf.sort((a, b) => a.x - b.x);
      const list = this.coins;
      const head = this._heads.coins;
      for (let k = 0; k < buf.length; k++) {
        const it = buf[k];
        list.push(it);
        let i = list.length - 1;
        while (i > head && list[i - 1].x > it.x) { list[i] = list[i - 1]; i--; }
        list[i] = it;
      }
    }

    _coin(x, y, tier, T) {
      if (!isNum(x) || !isNum(y)) return;
      const gy = T.heightAt(x);
      if (isNum(gy) && y < gy + 0.55) y = gy + 0.55;          // never inside the ground
      if (typeof T.ceilingAt === 'function') {
        const c = T.ceilingAt(x);
        if (isNum(c) && y > c - 0.9) y = Math.max(isNum(gy) ? gy + 0.55 : y - 1, c - 0.9);
      }
      const it = this._item(COIN, x, y);
      it.tier = tier;
      it.value = Math.max(1, Math.round(COIN_BASE[tier] * this._coinMul));
      this._buf.push(it);
      this.stats.coins++;
      this.stats.coinValue += it.value;
    }

    _reserve(a, b) { this._reserved.push(a, b); }
    _blocked(a, b) {
      const r = this._reserved;
      for (let i = 0; i < r.length; i += 2) if (a < r[i + 1] && b > r[i]) return r[i + 1];
      return NaN;
    }
    _pruneReserved(x0) {
      const r = this._reserved;
      let w = 0;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i + 1] >= x0 - 20) { r[w++] = r[i]; r[w++] = r[i + 1]; }
      }
      r.length = w;
    }

    _inTrench(T, x) {
      const F = RR.Terrain && RR.Terrain.FLAGS;
      if (!F || typeof T.flagsIdx !== 'function') return false;
      const DX = U.safeNum(T.DX, 0.5) || 0.5;
      return (T.flagsIdx(Math.floor(x / DX)) & (F.TRENCH | F.LAVA)) !== 0;
    }

    // ---------------------------------------------------------------- designed coin sets
    _featureCoins(f, T) {
      const m = f.meta || {};
      switch (f.type) {
        case 'jump':
        case 'gap':
        case 'lava': {
          if (isNum(this._blocked(f.x - 1, f.x + 1))) return;
          const end = this._arc(f, T);
          this._leadIn(f, T);
          this._reserve(f.x - 10, Math.max(U.safeNum(f.x2, f.x), end) + 2);
          return;
        }
        case 'steep':
          if (m.dir > 0 && f.x2 - f.x >= 8 && this._rc.chance(0.7)) this._crest(f, T);
          return;
        case 'plateau':
          this._plateau(f, T);
          return;
        case 'bouncepad':
          this._bounceColumn(f, T);
          return;
        case 'boostpad':
          this._boostTrail(f, T);
          return;
        case 'rocks':
          if (this._rc.chance(0.6)) this._rockLine(f, T);
          return;
        default:
      }
    }

    // Ballistic coin arc from the take-off lip. Returns the x where the arc ends.
    _arc(f, T) {
      const m = f.meta || {};
      const tx = m.takeoffX, ty = m.takeoffY, th = m.takeoffAngle;
      if (!isNum(tx) || !isNum(ty) || !isNum(th) || Math.abs(th) > 1.3) return f.x;
      const d = clamp(U.safeNum(T.difficultyAt ? T.difficultyAt(tx) : 0, 0), 0, 1);
      const risky = f.type !== 'jump';
      const v = risky ? clamp(U.safeNum(m.vReq, 13) + 1.8, 12.5, 18.5) : lerp(14, 16.5, d);
      const vx = v * Math.cos(th), tn = Math.tan(th), g = this._g;
      const k = g / (2 * vx * vx);
      const off = 0.9;                       // chassis centre above the lip at take-off
      const xEnd = isNum(m.landingZoneX2) ? m.landingZoneX2 : tx + 60;
      const px = this._ax || (this._ax = new Float64Array(24));
      const py = this._ay || (this._ay = new Float64Array(24));
      let n = 0, x = tx + 1.2;
      while (n < 20 && x < xEnd) {
        const dx = x - tx;
        const y = ty + off + dx * tn - k * dx * dx;
        const gy = T.heightAt(x);
        if (!isNum(y) || !isNum(gy) || y < gy + 0.75) break;
        px[n] = x; py[n] = y; n++;
        const s = tn - 2 * k * dx;           // trajectory slope → constant spacing along the arc
        x += TRAIL_SPACING / Math.sqrt(1 + s * s);
      }
      if (n < 3) return f.x;
      let apex = 0;
      for (let i = 1; i < n; i++) if (py[i] > py[apex]) apex = i;
      for (let i = 0; i < n; i++) {
        const tier = i === apex ? 1 : 0;
        this._coin(px[i], py[i], tier, T);
      }
      if (risky) {
        // high-line gold for launches with speed to spare
        const hx = px[apex], hy = py[apex] + 2.4;
        this._coin(hx, hy - 0.15, 2, T);
      }
      return px[n - 1];
    }

    // A few coins on the run-up leading into the kicker.
    _leadIn(f, T) {
      const rx = U.safeNum(f.meta && f.meta.rampX, f.x);
      for (let i = 0; i < 4; i++) {
        const x = rx - 7 + i * TRAIL_SPACING;
        if (this._inTrench(T, x)) continue;
        this._coin(x, T.heightAt(x) + 1.0, 0, T);
      }
    }

    // Risky coins on the crest of a sustained climb.
    _crest(f, T) {
      const cx = f.x2;
      if (isNum(this._blocked(cx - 3.5, cx + 2.5))) return;
      const gold = U.safeNum(f.meta.maxSlope, 0) > 0.7;
      for (let i = -1; i <= 1; i++) {
        const x = cx - 0.8 + i * TRAIL_SPACING;
        this._coin(x, T.heightAt(x) + 1.0, gold && i === 0 ? 2 : 1, T);
      }
      this._reserve(cx - 3.5, cx + 2.5);
    }

    _plateau(f, T) {
      const m = f.meta || {};
      const len = f.x2 - f.x;
      if (m.summit) {
        // boss summit: arch of gold
        const x0 = U.safeNum(f.x, 0) + 6;
        if (isNum(this._blocked(x0 - 1, x0 + 11))) return;
        for (let i = 0; i < 7; i++) {
          const x = x0 + i * 1.6;
          this._coin(x, T.heightAt(x) + 1.0 + 0.9 * Math.sin(Math.PI * i / 6), 2, T);
        }
        this._reserve(x0 - 1, x0 + 11);
        return;
      }
      if (m.ledge) {
        const cx = (f.x + f.x2) / 2;
        if (len < 6 || isNum(this._blocked(cx - 2.5, cx + 2.5))) return;
        for (let i = -1; i <= 1; i++) this._coin(cx + i * 1.6, T.heightAt(cx + i * 1.6) + 1.0, 1, T);
        this._reserve(cx - 2.5, cx + 2.5);
        return;
      }
      if (len < 14 || !this._rc.chance(0.45)) return;
      const cx = (f.x + f.x2) / 2;
      if (isNum(this._blocked(cx - 3.5, cx + 3.5))) return;
      const d = clamp(U.safeNum(T.difficultyAt ? T.difficultyAt(cx) : 0, 0), 0, 1);
      const side = this._rc.chance(lerp(0.35, 0.8, d)) ? 1 : 0;   // silver sides later, bronze early
      const gy = T.heightAt(cx);
      const P = [[-2.5, 0.95, side], [-1.25, 1.15, 1], [0, 1.3, 2], [1.25, 1.15, 1], [2.5, 0.95, side],
        [-0.8, 2.15, side], [0.8, 2.15, side]];
      for (let i = 0; i < P.length; i++) {
        const x = cx + P[i][0];
        this._coin(x, Math.max(T.heightAt(x), gy) + P[i][1], P[i][2], T);
      }
      this._reserve(cx - 3.5, cx + 3.5);
    }

    // Coins along the launch path over a neon bounce pad (EventSystem gives ≈ 9.5·power m/s upward).
    _bounceColumn(f, T) {
      const cx = (f.x + f.x2) / 2;
      if (isNum(this._blocked(cx - 3, cx + 20))) return;
      const power = clamp(U.safeNum(f.meta && f.meta.power, 1), 0.5, 2);
      const vx = 11, vy = 9.5 * power, g = this._g;
      const gy = T.heightAt(cx);
      let last = cx;
      for (let i = 0; i < 7; i++) {
        const t = 0.28 + i * 0.2;
        const x = cx + vx * t, y = gy + 1.0 + vy * t - 0.5 * g * t * t;
        if (y < T.heightAt(x) + 1.2) break;
        this._coin(x, y, i === 3 ? 2 : 1, T);
        last = x;
      }
      this._reserve(cx - 3, Math.max(cx + 20, last + 2));
    }

    _boostTrail(f, T) {
      const x0 = f.x2 + 3;
      if (isNum(this._blocked(x0 - 1, x0 + 14))) return;
      for (let i = 0; i < 8; i++) {
        const x = x0 + i * 1.8;
        this._coin(x, T.heightAt(x) + 1.05, i === 7 ? 1 : 0, T);
      }
      this._reserve(f.x - 2, x0 + 15);
    }

    _rockLine(f, T) {
      const a = f.x + 2, b = f.x2 - 2;
      if (b - a < 6 || isNum(this._blocked(a, b))) return;
      let k = 0;
      for (let x = a; x <= b; x += 2.6) this._coin(x, T.heightAt(x) + 1.25, (k++ % 4) === 2 ? 1 : 0, T);
      this._reserve(a - 1, b + 1);
    }

    // ---------------------------------------------------------------- generic trails
    _trails(x0, x1, T) {
      const r = this._rc;
      const dens = this._density;
      let x = Math.max(x0, this._nextTrailX);
      let guard = 0;
      while (x < x1 && guard++ < 60) {
        const n = clamp(Math.round(r.range(4, 10) * Math.min(1.5, Math.sqrt(dens))), 4, 16);
        const len = (n - 1) * TRAIL_SPACING;
        const blockEnd = this._blocked(x - 1, x + len + 1);
        if (isNum(blockEnd)) { x = blockEnd + 3; continue; }
        if (this._inTrench(T, x)) { x += 4; continue; }
        const d = clamp(U.safeNum(T.difficultyAt ? T.difficultyAt(x) : 0, 0), 0, 1);
        const silver = r.chance(lerp(0.05, 0.25, d));
        const goldEnd = n >= 6 && r.chance(lerp(0.03, 0.12, d));
        const midSilver = !silver && r.chance(0.15);
        const h = r.range(0.9, 1.2);
        const arch = r.chance(0.3) ? r.range(0.4, 0.9) : 0;
        let placed = 0;
        for (let k = 0; k < n; k++) {
          const cx = x + k * TRAIL_SPACING;
          if (this._inTrench(T, cx)) break;
          let tier = silver ? 1 : 0;
          if (midSilver && k === (n >> 1)) tier = 1;
          if (goldEnd && k === n - 1) tier = 2;
          const y = T.heightAt(cx) + h + arch * Math.sin(Math.PI * k / (n - 1));
          this._coin(cx, y, tier, T);
          placed++;
        }
        const end = x + Math.max(0, placed - 1) * TRAIL_SPACING;
        this._reserve(x - 1, end + 1);
        x = end + r.range(34, 70) / dens;          // (integration economy pass: was 16–38 m)
      }
      this._nextTrailX = x;
    }

    // ---------------------------------------------------------------- fuel & power-ups
    _spotOk(T, s) {
      const F = RR.Terrain && RR.Terrain.FLAGS;
      if (F && typeof T.flagsIdx === 'function') {
        const DX = U.safeNum(T.DX, 0.5) || 0.5;
        const bad = F.TRENCH | F.LAVA | F.RAMP | F.PAD;
        const i0 = Math.floor((s - 2.5) / DX), i1 = Math.ceil((s + 2.5) / DX);
        for (let i = i0; i <= i1; i++) {
          const fl = T.flagsIdx(i);
          if (fl & bad) return false;
          if ((fl & F.DESIGN) && !(fl & F.BOSS)) return false;
        }
      }
      if (typeof T.surfaceAt === 'function') {
        for (let dx = -2.5; dx <= 2.5; dx += 1.25) {
          const su = T.surfaceAt(s + dx);
          if (su && su.hazard) return false;
        }
      }
      if (typeof T.slopeAt === 'function' && Math.abs(U.safeNum(T.slopeAt(s), 0)) > 1.0) return false;
      return true;
    }

    // number = safe spot; NaN = none within the search window; null = window runs past final terrain.
    _safeSpot(T, x, limit) {
      for (let s = x; s <= x + SEARCH_AHEAD; s += 1) {
        if (s > limit) return null;
        if (this._spotOk(T, s)) return s;
      }
      return NaN;
    }

    // x of an item of `list` within r of x, or NaN.
    _conflict(list, key, x, r) {
      const head = this._heads[key];
      const i = lowerBound(list, head, x - r);
      return i < list.length && list[i].x <= x + r ? list[i].x : NaN;
    }

    // Safe spot at/after `want` that also keeps ≥ `gap` m from every item of the other pickup lists.
    _spotAwayFrom(T, want, limit, gap, a, aKey, b, bKey) {
      for (let k = 0; k < 6; k++) {
        const s = this._safeSpot(T, want, limit);
        if (!isNum(s)) return s;                       // null (wait) or NaN (none)
        let c = this._conflict(a, aKey, s, gap);
        if (!isNum(c) && b) c = this._conflict(b, bKey, s, gap);
        if (!isNum(c)) return s;
        want = c + gap + 0.5;
      }
      return NaN;
    }

    _placePickup(list, key, kind, x, y, type) {
      const it = this._item(kind, x, y);
      if (type) it.type = type;
      this._insertSorted(list, key, it);
      return it;
    }

    _fuelChunk(x0, x1, T) {
      if (this._noFuel) return;
      const r = this._rf;
      const limit = x1 + WRITTEN_AHEAD;
      let guard = 0;
      while (this._nextFuelX < x1 && guard++ < 12) {
        const want = this._nextFuelX;
        const s = this._spotAwayFrom(T, want, limit, PICKUP_GAP, this.powerups, 'powerups');
        if (s === null) break;                                    // wait for more terrain
        if (!isNum(s)) { this._nextFuelX = want + SEARCH_AHEAD; continue; }
        let kind = 'fuel';
        if (s >= this._nextMegaX) { kind = 'mega'; this._nextMegaX = s + r.range(1900, 2600); }
        this._placePickup(this.fuel, 'fuel', kind, s, T.heightAt(s) + (kind === 'mega' ? 1.1 : 0.8));
        if (kind === 'mega') this.stats.megas++; else this.stats.fuel++;
        const d = clamp(U.safeNum(T.difficultyAt ? T.difficultyAt(s) : 0, 0), 0, 1);
        // Gaps widen steadily with distance (not with the world's difficulty ramp, which takes 5–7 km):
        // ~230 m at the start, ~730 m at 1 km, ~980 m at 1.5 km, capped at 1.15 km. With a stock tank
        // covering ≈ 700 m this makes fuel the thing that ends most early runs, and FUEL upgrades matter.
        const spacing = Math.min(FUEL_GAP_MAX, FUEL_GAP_0 + FUEL_GAP_GROWTH * Math.max(0, s)) *
          this._fuelSpacing * r.range(0.85, 1.15);
        if (!isNum(this._nextCellX) && r.chance(lerp(0.35, 0.15, d))) this._nextCellX = s + spacing * r.range(0.42, 0.58);
        this._nextFuelX = s + spacing;
      }
      guard = 0;
      while (isNum(this._nextCellX) && this._nextCellX < x1 && guard++ < 4) {
        const s = this._spotAwayFrom(T, this._nextCellX, limit, PICKUP_GAP, this.powerups, 'powerups', this.fuel, 'fuel');
        if (s === null) break;
        if (isNum(s) && s < this._nextFuelX - 20) {
          this._placePickup(this.fuel, 'fuel', 'cell', s, T.heightAt(s) + 0.8);
          this.stats.cells++;
        }
        this._nextCellX = NaN;
      }
    }

    _powerChunk(x0, x1, T) {
      const r = this._rp;
      const limit = x1 + WRITTEN_AHEAD;
      let guard = 0;
      while (this._nextPowerX < x1 && guard++ < 8) {
        const want = this._nextPowerX;
        const s = this._spotAwayFrom(T, want, limit, PICKUP_GAP, this.fuel, 'fuel');
        if (s === null) break;
        if (!isNum(s)) { this._nextPowerX = want + SEARCH_AHEAD; continue; }
        const type = RR.PowerUps && RR.PowerUps.pickType ? RR.PowerUps.pickType(r, { noFuel: this._noFuel }) : 'magnet';
        this._placePickup(this.powerups, 'powerups', POWER, s, T.heightAt(s) + 1.25, type);
        this.stats.powerups++;
        this._nextPowerX = s + r.range(300, 500);
      }
    }

    // ================================================================ runtime
    nextFuel(x) {
      if (!isNum(x)) return null;
      const list = this.fuel;
      for (let i = this._heads.fuel; i < list.length; i++) {
        const it = list[i];
        if (it.state === IDLE && it.x >= x - 0.5) return it;
      }
      return null;
    }

    nextFuelDistance(x) {
      const it = this.nextFuel(x);
      return it ? Math.max(0, it.x - x) : Infinity;
    }

    clear() {
      for (const key of ['coins', 'fuel', 'powerups']) {
        const list = this[key];
        for (let i = this._heads[key]; i < list.length; i++) this._recycle(list[i]);
        list.length = 0;
        this._heads[key] = 0;
      }
      for (const it of this.falling) this._recycle(it);
      this.falling.length = 0;
    }

    update(dt, run) {
      run = run || this.run;
      const b = run && run.body;
      if (!b || !isNum(b.x) || !isNum(b.y)) return;
      dt = clamp(U.safeNum(dt, 0), 0, 0.1);
      this.time += dt;
      try {
        const st = run.state;
        const can = !st || st === 'running' || st === 'nofuel';
        this._prepCollector(b, run);
        const pu = run.powerUps;
        const magnet = can && !!pu && typeof pu.isActive === 'function' && pu.isActive('magnet');
        this._updateList(this.coins, 'coins', dt, can, magnet, run, b);
        this._updateList(this.fuel, 'fuel', dt, can, false, run, b);
        this._updateList(this.powerups, 'powerups', dt, can, false, run, b);
        this._updateFalling(dt, can, magnet, run, b);
      } catch (e) {
        logOnce('update', e);
      }
    }

    // World-space pickup circles: three along the hull, both wheels, the head.
    _prepCollector(b, run) {
      const tuned = (run && run.tuned) || b.tuned;
      if (tuned !== this._hullTuned) {
        this._hullTuned = tuned;
        const hull = tuned && tuned.chassis && Array.isArray(tuned.chassis.hull) ? tuned.chassis.hull : null;
        let minX = -1.6, maxX = 1.6;
        if (hull && hull.length >= 3) {
          minX = Infinity; maxX = -Infinity;
          for (const p of hull) {
            const px = p && isNum(p.x) ? p.x : (Array.isArray(p) ? p[0] : 0);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
          }
          if (!isNum(minX) || !isNum(maxX)) { minX = -1.6; maxX = 1.6; }
        }
        const H = this._hullLocal;
        H[3] = Math.max(0.3, maxX - 0.5); H[6] = Math.min(-0.3, minX + 0.5);
      }
      const c = this._circ;
      const ca = Math.cos(U.safeNum(b.angle, 0)), sa = Math.sin(U.safeNum(b.angle, 0));
      const H = this._hullLocal;
      let n = 0;
      for (let k = 0; k < 9; k += 3) {
        c[n * 3] = b.x + H[k] * ca - H[k + 1] * sa;
        c[n * 3 + 1] = b.y + H[k] * sa + H[k + 1] * ca;
        c[n * 3 + 2] = H[k + 2];
        n++;
      }
      const ws = b.wheels;
      if (ws) {
        for (let i = 0; i < ws.length && i < 2; i++) {
          const w = ws[i];
          if (!w || !isNum(w.x) || !isNum(w.y)) continue;
          c[n * 3] = w.x; c[n * 3 + 1] = w.y; c[n * 3 + 2] = U.safeNum(w.radius, 0.4) + 0.05;
          n++;
        }
      }
      if (typeof b.getHead === 'function') {
        const h = b.getHead(this._head);
        if (h && isNum(h.x) && isNum(h.y)) {
          c[n * 3] = h.x; c[n * 3 + 1] = h.y; c[n * 3 + 2] = U.safeNum(h.r, 0.2) + 0.1;
          n++;
        }
      }
      this._nCirc = n;
    }

    _touches(it) {
      const c = this._circ, r = it.r * (it.scale || 1);
      for (let i = 0; i < this._nCirc; i++) {
        const dx = it.x - c[i * 3], dy = it.y - c[i * 3 + 1], rr = c[i * 3 + 2] + r;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
      return false;
    }

    _updateList(list, key, dt, can, magnet, run, b) {
      const bx = b.x;
      let head = this._heads[key];
      // recycle collected items and items the car left behind
      while (head < list.length) {
        const it = list[head];
        if (it.state === DEAD || (it.state === IDLE && it.x < bx - CLEAN_BEHIND)) {
          this._recycle(it);
          list[head] = null;
          head++;
        } else break;
      }
      if (head > 48 && head * 2 > list.length) { list.splice(0, head); head = 0; }
      this._heads[key] = head;
      const lo = bx - SCAN_BEHIND, hi = bx + SCAN_AHEAD;
      for (let i = head; i < list.length; i++) {
        const it = list[i];
        if (it.state === IDLE) {
          if (it.x > hi) break;
          if (it.x < lo) continue;
        } else if (it.state === DEAD) continue;
        this._step(it, dt, can, magnet, run, b);
      }
    }

    _updateFalling(dt, can, magnet, run, b) {
      const fl = this.falling;
      if (!fl.length) return;
      const T = run.terrain;
      const g = this._g;
      for (let i = fl.length - 1; i >= 0; i--) {
        const it = fl[i];
        if (it.state === DEAD || (it.state === IDLE && it.x < b.x - CLEAN_BEHIND)) {
          fl[i] = fl[fl.length - 1];
          fl.pop();
          this._recycle(it);
          continue;
        }
        if (it.state === IDLE && !it.settled && dt > 0) {
          it.vy -= g * dt;
          if (it.vy < -30) it.vy = -30;
          it.x += it.vx * dt;
          it.y += it.vy * dt;
          const gy = T && typeof T.heightAt === 'function' ? T.heightAt(it.x) : -Infinity;
          const rest = gy + 0.5;
          if (isNum(gy) && it.y < rest) {
            it.y = rest;
            if (it.vy < -2.5) { it.vy = -it.vy * 0.35; it.vx *= 0.6; }
            else { it.vx = 0; it.vy = 0; it.settled = true; }
          }
          if (!isNum(it.x) || !isNum(it.y)) { it.state = DEAD; continue; }
        }
        this._step(it, dt, can, magnet, run, b);
      }
    }

    _step(it, dt, can, magnet, run, b) {
      if (it.state === IDLE) {
        if (!can) return;
        if (this._touches(it)) { this._beginCollect(it); return; }
        // Fuel is forgiving (integration): a car skimming over a can on a crest hop still grabs it —
        // missing the only can in 500 m because a bump launched you 2 m high just feels unfair.
        if (it.kind !== COIN && it.kind !== POWER) {
          const dy = U.safeNum(b.y, 0) - it.y;
          if (Math.abs(it.x - U.safeNum(b.x, 0)) < FUEL_REACH_X && dy > -1 && dy < FUEL_REACH_Y) { this._beginCollect(it); return; }
        }
        if (magnet && it.kind === COIN) {
          const dx = it.x - b.x, dy = it.y - b.y;
          if (dx * dx + dy * dy < MAGNET_R * MAGNET_R) { it.state = MAGNET; it.t = 0; it.settled = true; }
        }
        return;
      }
      if (it.state === MAGNET) {
        if (!can) { it.state = IDLE; return; }
        it.t += dt;
        const tx = b.x, ty = b.y + 0.2;
        const dx = tx - it.x, dy = ty - it.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = (9 + 36 * it.t + Math.hypot(U.safeNum(b.vx, 0), U.safeNum(b.vy, 0))) * dt;
        if (dist > 1e-6) {
          const k = Math.min(1, step / dist);
          it.x += dx * k;
          it.y += dy * k;
        }
        if (this._touches(it) || dist < 0.3) this._beginCollect(it);
        return;
      }
      if (it.state === COLLECTING) {
        it.t += dt;
        const k = Math.min(1, it.t / COLLECT_T);
        const e = k * k;
        it.x = lerp(it.sx, b.x, e);
        it.y = lerp(it.sy, b.y + 0.25, e);
        it.scale = 1 - 0.75 * k;
        if (k >= 1) {
          it.state = DEAD;
          this._deliver(it, run);
        }
      }
    }

    _beginCollect(it) {
      it.state = COLLECTING;
      it.t = 0;
      it.sx = it.x;
      it.sy = it.y;
    }

    _deliver(it, run) {
      try {
        if (it.kind === COIN) {
          this.collected.coin++;
          if (typeof run.onCoin === 'function') run.onCoin(it.value, it.x, it.y);
        } else if (it.kind === POWER) {
          this.collected.powerup++;
          if (typeof run.onPowerup === 'function') run.onPowerup(it.type, it.x, it.y);
        } else {
          this.collected[it.kind] = (this.collected[it.kind] || 0) + 1;
          if (typeof run.onFuel === 'function') run.onFuel(it.kind, it.x, it.y);
        }
      } catch (e) {
        logOnce('pickup callback', e);
      }
    }

    // ================================================================ drawing (WORLD transform)
    draw(ctx, run) {
      if (!ctx) return;
      run = run || this.run;
      const cam = run && run.camera;
      const b = this._b;
      if (cam && typeof cam.bounds === 'function') cam.bounds(b);
      else {
        const bd = run && run.body;
        const cx = bd && isNum(bd.x) ? bd.x : 0, cy = bd && isNum(bd.y) ? bd.y : 0;
        b.left = cx - 20; b.right = cx + 25; b.bottom = cy - 12; b.top = cy + 12;
      }
      const t = run && isNum(run.time) ? run.time : this.time;
      const L = b.left - 1.5, R = b.right + 1.5, B = b.bottom - 1.5, Tp = b.top + 1.5;
      const cHead = this._heads.coins, fHead = this._heads.fuel, pHead = this._heads.powerups;
      const c0 = Math.max(cHead, lowerBound(this.coins, cHead, L) - 6);
      const f0 = Math.max(fHead, lowerBound(this.fuel, fHead, L) - 2);
      const p0 = Math.max(pHead, lowerBound(this.powerups, pHead, L) - 2);
      const sprite = RR.Particles && typeof RR.Particles.glowSprite === 'function' ? RR.Particles.glowSprite : null;

      // --- glow pass (additive)
      if (sprite) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = f0; i < this.fuel.length; i++) {
          const it = this.fuel[i];
          if (it.x > R) break;
          if (!this._visible(it, L, R, B, Tp)) continue;
          const pulse = 0.85 + 0.15 * Math.sin(t * 4 + it.phase);
          const col = it.kind === 'mega' ? MEGA_GLOW : it.kind === 'cell' ? CELL_GLOW : FUEL_GLOW;
          const s = (it.kind === 'mega' ? 4.2 : it.kind === 'cell' ? 2.4 : 2.2) * pulse * it.scale;
          this._glow(ctx, sprite(col), it.x, it.y + this._bob(it, t), s, it.kind === 'fuel' ? 0.45 : 0.75);
        }
        for (let i = p0; i < this.powerups.length; i++) {
          const it = this.powerups[i];
          if (it.x > R) break;
          if (!this._visible(it, L, R, B, Tp)) continue;
          const def = RR.PowerUps && RR.PowerUps.TYPES[it.type];
          const s = 2.9 * (0.9 + 0.1 * Math.sin(t * 3 + it.phase)) * it.scale;
          this._glow(ctx, sprite(def ? def.color : '#ffffff'), it.x, it.y + this._bob(it, t), s, 0.7);
        }
        const gs = sprite(GOLD_GLOW);
        for (let i = c0; i < this.coins.length; i++) {
          const it = this.coins[i];
          if (it.x > R && it.state === IDLE) break;
          if (it.tier === 2 && this._visible(it, L, R, B, Tp)) this._glow(ctx, gs, it.x, it.y, 1.5 * it.scale, 0.5);
        }
        for (let i = 0; i < this.falling.length; i++) {
          const it = this.falling[i];
          if (it.tier === 2 && this._visible(it, L, R, B, Tp)) this._glow(ctx, gs, it.x, it.y, 1.5 * it.scale, 0.5);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      // --- bodies
      for (let i = c0; i < this.coins.length; i++) {
        const it = this.coins[i];
        if (it.x > R && it.state === IDLE) break;
        if (this._visible(it, L, R, B, Tp)) this._drawCoin(ctx, it, t);
      }
      for (let i = 0; i < this.falling.length; i++) {
        const it = this.falling[i];
        if (this._visible(it, L, R, B, Tp)) this._drawCoin(ctx, it, t);
      }
      for (let i = f0; i < this.fuel.length; i++) {
        const it = this.fuel[i];
        if (it.x > R && it.state === IDLE) break;
        if (!this._visible(it, L, R, B, Tp)) continue;
        if (it.kind === 'mega') this._drawMega(ctx, it, t);
        else if (it.kind === 'cell') this._drawCell(ctx, it, t);
        else this._drawCan(ctx, it, t);
      }
      for (let i = p0; i < this.powerups.length; i++) {
        const it = this.powerups[i];
        if (it.x > R && it.state === IDLE) break;
        if (this._visible(it, L, R, B, Tp)) this._drawPowerup(ctx, it, t);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _visible(it, L, R, B, Tp) {
      return it.state !== DEAD && it.x >= L && it.x <= R && it.y >= B && it.y <= Tp && isNum(it.y);
    }

    _bob(it, t) {
      return it.state === IDLE ? Math.sin(t * 2.3 + it.phase) * 0.1 : 0;
    }

    _glow(ctx, img, x, y, size, alpha) {
      if (!img || !(size > 0)) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }

    // Spinning coin: rim, face, embossed star, glint. Edge-on it becomes a thin bar.
    _drawCoin(ctx, it, t) {
      const C = COIN_COL[it.tier] || COIN_COL[0];
      const r = COIN_R[it.tier] * Math.max(0.05, it.scale);
      const spin = Math.cos(t * 3.4 + it.phase);
      const sx = Math.abs(spin);
      const x = it.x, y = it.y;
      if (it.state === COLLECTING) ctx.globalAlpha = Math.max(0.2, it.scale);
      if (sx < 0.16) {
        ctx.fillStyle = C.rim;
        ctx.fillRect(x - r * 0.12, y - r, r * 0.24, r * 2);
        ctx.fillStyle = C.light;
        ctx.fillRect(x - r * 0.04, y - r * 0.8, r * 0.08, r * 1.2);
        ctx.globalAlpha = 1;
        return;
      }
      const rx = r * sx;
      const side = spin > 0 ? 1 : -1;
      // coin thickness: rim offset opposite to the facing side
      ctx.fillStyle = C.rim;
      ctx.beginPath();
      ctx.ellipse(x - side * r * 0.1 * (1 - sx), y, rx, r, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, rx, r, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = spin > 0 ? C.face : C.back;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * 0.8, r * 0.8, 0, 0, TAU);
      ctx.fill();
      // embossed 4-point star
      const e = r * 0.46, ei = r * 0.14;
      ctx.fillStyle = C.emboss;
      ctx.beginPath();
      ctx.moveTo(x, y + e);
      ctx.lineTo(x + ei * sx, y + ei);
      ctx.lineTo(x + e * sx, y);
      ctx.lineTo(x + ei * sx, y - ei);
      ctx.lineTo(x, y - e);
      ctx.lineTo(x - ei * sx, y - ei);
      ctx.lineTo(x - e * sx, y);
      ctx.lineTo(x - ei * sx, y + ei);
      ctx.closePath();
      ctx.fill();
      // glint (upper-left highlight, strongest when facing the camera)
      if (sx > 0.45) {
        ctx.globalAlpha = (it.state === COLLECTING ? it.scale : 1) * (0.35 + 0.55 * (sx - 0.45) / 0.55);
        ctx.fillStyle = C.light;
        ctx.beginPath();
        ctx.ellipse(x - rx * 0.38, y + r * 0.4, rx * 0.2, r * 0.13, -0.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawCan(ctx, it, t) {
      const s = Math.max(0.05, it.scale);
      ctx.save();
      ctx.translate(it.x, it.y + this._bob(it, t));
      ctx.rotate(Math.sin(t * 1.7 + it.phase) * 0.08);
      ctx.scale(s * CAN_SCALE, s * CAN_SCALE);
      if (it.state === COLLECTING) ctx.globalAlpha = Math.max(0.25, s);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = '#5c120b';
      // handle frame (top-left) with its hole
      ctx.fillStyle = '#c42a1e';
      roundRect(ctx, -0.28, 0.26, 0.32, 0.17, 0.05);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a0d08';
      ctx.fillRect(-0.21, 0.31, 0.18, 0.07);
      // spout cap (top-right)
      ctx.fillStyle = '#ffd23f';
      roundRect(ctx, 0.09, 0.27, 0.15, 0.15, 0.04);
      ctx.fill(); ctx.stroke();
      // body
      ctx.fillStyle = '#e8392b';
      roundRect(ctx, -0.31, -0.42, 0.62, 0.72, 0.09);
      ctx.fill(); ctx.stroke();
      // embossed X
      ctx.strokeStyle = '#a92317';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(-0.2, -0.32); ctx.lineTo(0.2, 0.2);
      ctx.moveTo(0.2, -0.32); ctx.lineTo(-0.2, 0.2);
      ctx.stroke();
      // label band with a fuel drop
      ctx.fillStyle = '#fff4e6';
      roundRect(ctx, -0.17, -0.14, 0.34, 0.2, 0.04);
      ctx.fill();
      ctx.fillStyle = '#e8392b';
      ctx.beginPath();
      ctx.moveTo(0, 0.03);
      ctx.quadraticCurveTo(0.07, -0.05, 0.05, -0.08);
      ctx.arc(0, -0.08, 0.05, 0, Math.PI, true);
      ctx.quadraticCurveTo(-0.07, -0.05, 0, 0.03);
      ctx.fill();
      // highlight strip
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-0.25, -0.34, 0.06, 0.58);
      ctx.restore();
    }

    _drawCell(ctx, it, t) {
      const s = Math.max(0.05, it.scale);
      ctx.save();
      ctx.translate(it.x, it.y + this._bob(it, t));
      ctx.rotate(Math.sin(t * 1.9 + it.phase) * 0.1);
      ctx.scale(s, s);
      if (it.state === COLLECTING) ctx.globalAlpha = Math.max(0.25, s);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = '#0b2a18';
      // terminal
      ctx.fillStyle = '#cfd8dc';
      ctx.fillRect(-0.08, 0.3, 0.16, 0.08);
      // casing
      ctx.fillStyle = '#17482c';
      roundRect(ctx, -0.21, -0.37, 0.42, 0.69, 0.1);
      ctx.fill(); ctx.stroke();
      // charge level (animated)
      const lvl = 0.55 + 0.45 * frac(t * 0.8 + it.phase);
      ctx.fillStyle = '#3ee07a';
      roundRect(ctx, -0.15, -0.31, 0.3, 0.57 * lvl, 0.06);
      ctx.fill();
      // bolt
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0.05, 0.22); ctx.lineTo(-0.1, -0.03); ctx.lineTo(-0.01, -0.03);
      ctx.lineTo(-0.05, -0.25); ctx.lineTo(0.1, 0.01); ctx.lineTo(0.01, 0.01);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(-0.17, -0.3, 0.05, 0.54);
      ctx.restore();
    }

    _drawMega(ctx, it, t) {
      const s = Math.max(0.05, it.scale);
      const x = it.x, y = it.y + this._bob(it, t);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      if (it.state === COLLECTING) ctx.globalAlpha = Math.max(0.25, s);
      const pulse = 1 + 0.05 * Math.sin(t * 5 + it.phase);
      // outer ring
      ctx.strokeStyle = '#c8ffe6';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, 0.74 * pulse, 0, TAU);
      ctx.stroke();
      // body layers
      ctx.fillStyle = '#12995a';
      ctx.beginPath(); ctx.arc(0, 0, 0.64, 0, TAU); ctx.fill();
      ctx.fillStyle = '#35e38f';
      ctx.beginPath(); ctx.arc(0, 0.04, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9dffd0';
      ctx.beginPath(); ctx.arc(-0.12, 0.16, 0.2, 0, TAU); ctx.fill();
      // bolt
      ctx.fillStyle = '#0d5a35';
      ctx.beginPath();
      ctx.moveTo(0.08, 0.36); ctx.lineTo(-0.18, -0.04); ctx.lineTo(-0.02, -0.04);
      ctx.lineTo(-0.08, -0.38); ctx.lineTo(0.18, 0.02); ctx.lineTo(0.02, 0.02);
      ctx.closePath();
      ctx.fill();
      // orbiting sparks
      ctx.fillStyle = '#eafff5';
      for (let k = 0; k < 3; k++) {
        const a = t * 2.4 + k * TAU / 3 + it.phase;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 0.95, Math.sin(a) * 0.5, 0.07, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawPowerup(ctx, it, t) {
      const def = RR.PowerUps && RR.PowerUps.TYPES[it.type];
      const color = def ? def.color : '#ffffff';
      const s = Math.max(0.05, it.scale);
      ctx.save();
      ctx.translate(it.x, it.y + this._bob(it, t));
      ctx.scale(s, s);
      if (it.state === COLLECTING) ctx.globalAlpha = Math.max(0.25, s);
      // pulse ring
      if (it.state === IDLE) {
        const k = frac(t * 0.9 + it.phase);
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(0, 0, 0.62 + 0.6 * k, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // bubble
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, 0, 0.58, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.arc(0.05, -0.07, 0.48, 0, TAU); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(-0.03, 0.03, 0.44, 0, TAU); ctx.fill();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = 'rgba(20,12,40,0.55)';
      ctx.beginPath(); ctx.arc(0, 0, 0.58, 0, TAU); ctx.stroke();
      // glyph
      this._glyph(ctx, def ? def.glyph : 'magnet', t, color);
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(-0.22, 0.28, 0.16, 0.08, 0.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    _glyph(ctx, g, t, color) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      switch (g) {
        case 'magnet':
          ctx.arc(0, 0.02, 0.17, Math.PI, TAU, false);
          ctx.moveTo(-0.17, 0.02); ctx.lineTo(-0.17, 0.2);
          ctx.moveTo(0.17, 0.02); ctx.lineTo(0.17, 0.2);
          ctx.stroke();
          ctx.fillStyle = '#dfe6f0';
          ctx.fillRect(-0.225, 0.17, 0.11, 0.09);
          ctx.fillRect(0.115, 0.17, 0.11, 0.09);
          break;
        case 'shield':
          ctx.moveTo(0, 0.25);
          ctx.lineTo(0.2, 0.17);
          ctx.lineTo(0.19, -0.03);
          ctx.quadraticCurveTo(0.14, -0.18, 0, -0.26);
          ctx.quadraticCurveTo(-0.14, -0.18, -0.19, -0.03);
          ctx.lineTo(-0.2, 0.17);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(0, 0.16); ctx.lineTo(0, -0.16);
          ctx.moveTo(-0.11, 0.05); ctx.lineTo(0.11, 0.05);
          ctx.stroke();
          break;
        case 'boost':
          ctx.moveTo(-0.2, 0.17); ctx.lineTo(-0.04, 0); ctx.lineTo(-0.2, -0.17);
          ctx.moveTo(0.02, 0.17); ctx.lineTo(0.18, 0); ctx.lineTo(0.02, -0.17);
          ctx.stroke();
          break;
        case 'fuel':
          ctx.moveTo(0, 0.27);
          ctx.bezierCurveTo(0.07, 0.14, 0.19, 0.03, 0.19, -0.08);
          ctx.arc(0, -0.08, 0.19, 0, Math.PI, true);
          ctx.bezierCurveTo(-0.19, 0.03, -0.07, 0.14, 0, 0.27);
          ctx.fill();
          break;
        case 'x2':
          ctx.lineWidth = 0.085;
          ctx.arc(-0.13, 0.12, 0.11, Math.PI, -0.55, true);
          ctx.lineTo(-0.25, -0.2);
          ctx.lineTo(-0.01, -0.2);
          ctx.moveTo(0.06, 0.02); ctx.lineTo(0.24, -0.2);
          ctx.moveTo(0.24, 0.02); ctx.lineTo(0.06, -0.2);
          ctx.stroke();
          break;
        case 'clock':
        default: {
          ctx.lineWidth = 0.07;
          ctx.arc(0, 0, 0.23, 0, TAU);
          ctx.stroke();
          const a = -t * 1.3;
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(0, 0.14);
          ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * 0.17, Math.cos(a) * 0.17);
          ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 0.04, 0, TAU); ctx.fill();
        }
      }
    }
  }

  Collectibles.COIN_BASE = COIN_BASE;
  RR.Collectibles = Collectibles;
})();
