/* RIDGE RUSH — timed power-ups (RR.PowerUps).
 *
 * Contract: docs/ARCHITECTURE.md §5.9.
 *   RR.PowerUps.TYPES = { magnet, shield, boost, fuelboost, multiplier, slowtime }  ({name, duration, color})
 *   new RR.PowerUps(run); pu.activate(type); pu.isActive(type); pu.remaining(type); pu.fraction(type)
 *   pu.consumeShield() → bool; pu.update(dt); pu.list() → [{type, remaining, duration, fraction}]
 *
 * Timers run on REAL time (Run passes the unscaled frame dt), so SLOW TIME does not stretch itself or the
 * other power-ups. SHIELD lasts until it absorbs one crash or 45 s pass. Re-activating an active power-up
 * refreshes it to its full duration (it never stacks beyond one full duration). FUEL BOOST is instant
 * (duration 0): activate() accepts it and returns true, the Run performs the refill.
 *
 * Contract additions (callers may ignore):
 *  - TYPES[type] also has {id, desc, weight, glyph}; `weight` is the relative spawn weight used by
 *    Collectibles (shield is the rarest).
 *  - RR.PowerUps.ORDER (display order) and RR.PowerUps.pickType(rng, {noFuel}) → weighted random type.
 *  - list() entries also carry {name, color}. The returned array and its entry objects are REUSED every
 *    call (no per-frame allocation) — read them immediately, don't keep references across frames.
 *  - pu.onExpire = fn(type) optional hook fired when a timed power-up runs out.
 *  - pu.activations (count), pu.shieldsUsed (count), pu.anyActive(), pu.clear().
 */
(function () {
  'use strict';
  const RR = (window.RR = window.RR || {});
  const U = RR.Util;

  const TYPES = Object.freeze({
    magnet: Object.freeze({ id: 'magnet', name: 'MAGNET', duration: 10, color: '#ff4f6d', weight: 1.0,
      glyph: 'magnet', desc: 'Pulls in every coin nearby' }),
    shield: Object.freeze({ id: 'shield', name: 'SHIELD', duration: 45, color: '#3fd8ff', weight: 0.45,
      glyph: 'shield', desc: 'Survive one crash' }),
    boost: Object.freeze({ id: 'boost', name: 'BOOST', duration: 4, color: '#ff9a1f', weight: 0.9,
      glyph: 'boost', desc: 'Rocket-powered acceleration' }),
    fuelboost: Object.freeze({ id: 'fuelboost', name: 'FUEL BOOST', duration: 0, color: '#3ee07a', weight: 0.5,
      glyph: 'fuel', desc: 'Instantly refills the tank' }),
    multiplier: Object.freeze({ id: 'multiplier', name: '2X COINS', duration: 12, color: '#ffd23f', weight: 0.9,
      glyph: 'x2', desc: 'Every coin counts double' }),
    slowtime: Object.freeze({ id: 'slowtime', name: 'SLOW TIME', duration: 6, color: '#a77bff', weight: 0.7,
      glyph: 'clock', desc: 'Bullet-time physics' })
  });
  const ORDER = Object.freeze(Object.keys(TYPES));
  const MAX_DT = 0.25;

  // Weighted random power-up type. opts.noFuel removes FUEL BOOST (no-fuel daily challenge).
  function pickType(rng, opts) {
    const noFuel = !!(opts && opts.noFuel);
    let total = 0;
    for (const id of ORDER) if (!(noFuel && id === 'fuelboost')) total += TYPES[id].weight;
    let r = (rng && typeof rng.next === 'function' ? rng.next() : Math.random()) * total;
    for (const id of ORDER) {
      if (noFuel && id === 'fuelboost') continue;
      r -= TYPES[id].weight;
      if (r <= 0) return id;
    }
    return 'magnet';
  }

  class PowerUps {
    constructor(run) {
      this.run = run || null;
      this.onExpire = null;
      this.activations = 0;
      this.shieldsUsed = 0;
      this._rem = Object.create(null);
      this._entries = Object.create(null);
      for (const id of ORDER) {
        this._rem[id] = 0;
        this._entries[id] = { type: id, remaining: 0, duration: TYPES[id].duration, fraction: 0,
          name: TYPES[id].name, color: TYPES[id].color };
      }
      this._list = [];
    }

    // Start (or refresh) a power-up. Returns false for unknown types.
    activate(type) {
      const def = TYPES[type];
      if (!def) return false;
      if (def.duration > 0) this._rem[type] = def.duration;
      this.activations++;
      return true;
    }

    isActive(type) {
      return (this._rem[type] || 0) > 0;
    }

    remaining(type) {
      const r = this._rem[type];
      return r > 0 ? r : 0;
    }

    fraction(type) {
      const def = TYPES[type];
      if (!def || !(def.duration > 0)) return 0;
      return U.clamp(this.remaining(type) / def.duration, 0, 1);
    }

    anyActive() {
      for (const id of ORDER) if (this._rem[id] > 0) return true;
      return false;
    }

    // Absorb one crash with an active shield. Returns true when the shield was used up.
    consumeShield() {
      if (!(this._rem.shield > 0)) return false;
      this._rem.shield = 0;
      this.shieldsUsed++;
      return true;
    }

    update(dt) {
      dt = U.safeNum(dt, 0);
      if (dt <= 0) return;
      if (dt > MAX_DT) dt = MAX_DT;
      for (let i = 0; i < ORDER.length; i++) {
        const id = ORDER[i];
        const r = this._rem[id];
        if (!(r > 0)) continue;
        const next = r - dt;
        if (next > 0) { this._rem[id] = next; continue; }
        this._rem[id] = 0;
        if (typeof this.onExpire === 'function') {
          try { this.onExpire(id); } catch (e) { /* hook errors never break the frame */ }
        }
      }
    }

    // Active timed power-ups in display order. Reused array + entries (see header).
    list() {
      const out = this._list;
      out.length = 0;
      for (let i = 0; i < ORDER.length; i++) {
        const id = ORDER[i];
        const r = this._rem[id];
        if (!(r > 0)) continue;
        const e = this._entries[id];
        e.remaining = r;
        e.fraction = e.duration > 0 ? U.clamp(r / e.duration, 0, 1) : 0;
        out.push(e);
      }
      return out;
    }

    clear() {
      for (const id of ORDER) this._rem[id] = 0;
      this._list.length = 0;
    }
  }

  PowerUps.TYPES = TYPES;
  PowerUps.ORDER = ORDER;
  PowerUps.pickType = pickType;
  RR.PowerUps = PowerUps;
})();
