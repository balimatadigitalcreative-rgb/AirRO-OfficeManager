'use strict';
/*
 * RUTE RIT — one trip (rit) of one armada, planned the way the owner described it:
 * start at the warehouse, go to the NEAREST customer, then the nearest from there, … while the
 * gallons loaded for this rit still cover the next customer, then drive back to the warehouse.
 * Whatever did not fit waits for the next rit, which starts from the warehouse again.
 */
const { planRit } = require('../src/lib/rit-plan');

const DEPOT = { lat: -8.65, lng: 115.2 };
const KM = 0.009;   // ≈ 1 km of latitude
const at = (id, km, qty, extra) => Object.assign({ id, lat: DEPOT.lat + km * KM, lng: DEPOT.lng, qty }, extra || {});

describe('planRit', () => {
  it('nearest first from the warehouse, while the load covers the next customer', () => {
    // A 1 km, B 2 km, C 3 km (10 each), D 8 km (5). Load 25: A, B → 5 left → C does not fit, D does.
    const r = planRit({ depot: DEPOT, capacity: 25, stops: [at('C', 3, 10), at('A', 1, 10), at('D', 8, 5), at('B', 2, 10)] });
    expect(r.rit.map((s) => s.id)).toEqual(['A', 'B', 'D']);
    expect(r.rit.map((s) => s.loadAfter)).toEqual([15, 5, 0]);
    expect(r.used).toBe(25);
    expect(r.leftover).toEqual([{ id: 'C', qty: 10 }]);
    expect(r.leftoverGallons).toBe(10);
    expect(r.estRits).toBe(1);
  });

  it('measures each leg, and the drive back to the warehouse', () => {
    const r = planRit({ depot: DEPOT, capacity: 100, stops: [at('A', 1, 1), at('B', 3, 1)] });
    expect(r.rit[0].legKm).toBeCloseTo(1, 0);
    expect(r.rit[1].legKm).toBeCloseTo(2, 0);
    expect(r.rit[1].cumKm).toBeCloseTo(3, 0);
    expect(r.returnKm).toBeCloseTo(3, 0);
    expect(r.totalKm).toBeCloseTo(6, 0);
  });

  it('never carries more than the load, whatever the stops', () => {
    let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let t = 0; t < 200; t++) {
      const stops = Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, lat: DEPOT.lat + (rnd() - 0.5) * 0.1, lng: DEPOT.lng + (rnd() - 0.5) * 0.1, qty: 1 + Math.floor(rnd() * 8), pinned: rnd() < 0.1 }));
      const cap = 5 + Math.floor(rnd() * 60);
      const r = planRit({ depot: DEPOT, capacity: cap, stops });
      expect(r.used).toBeLessThanOrEqual(cap);
      expect(r.rit.reduce((s, x) => s + x.qty, 0)).toBe(r.used);
      const seen = [...r.rit.map((x) => x.id), ...r.leftover.map((x) => x.id), ...r.tooBig.map((x) => x.id), ...r.unlocated];
      expect(seen.sort()).toEqual(stops.map((s) => s.id).sort());     // every stop in exactly one list
    }
  });

  it('a customer needing more than the whole load is flagged, not silently dropped', () => {
    const r = planRit({ depot: DEPOT, capacity: 40, stops: [at('HOTEL', 1, 60), at('A', 2, 10)] });
    expect(r.tooBig).toEqual([{ id: 'HOTEL', qty: 60 }]);
    expect(r.rit.map((s) => s.id)).toEqual(['A']);
  });

  it('customers without a location are listed, never planned', () => {
    const r = planRit({ depot: DEPOT, capacity: 40, stops: [{ id: 'X', lat: null, lng: null, qty: 2 }, at('A', 1, 2)] });
    expect(r.unlocated).toEqual(['X']);
    expect(r.rit.map((s) => s.id)).toEqual(['A']);
  });

  it('a pinned stop (fixed hour) is reserved into this rit first; the rest fill around it', () => {
    // Load 20: pinned P (9 km, 10) is reserved → only 10 left for A/B → A (nearest) goes, B waits.
    const r = planRit({ depot: DEPOT, capacity: 20, stops: [at('A', 1, 10), at('B', 2, 10), at('P', 9, 10, { pinned: true })] });
    expect(r.rit.map((s) => s.id)).toEqual(['A', 'P']);
    expect(r.leftover.map((s) => s.id)).toEqual(['B']);
  });

  it('estimates how many more rits the leftover needs with the same load', () => {
    const r = planRit({ depot: DEPOT, capacity: 10, stops: [at('A', 1, 10), at('B', 2, 9), at('C', 3, 9), at('D', 4, 7)] });
    expect(r.leftoverGallons).toBe(25);
    expect(r.estRits).toBe(3);
  });

  it('nothing to deliver → an empty rit, no distance', () => {
    expect(planRit({ depot: DEPOT, capacity: 10, stops: [] })).toMatchObject({ rit: [], used: 0, returnKm: 0, totalKm: 0, estRits: 0 });
  });
});
