'use strict';
/*
 * CUSTOMER ZONES — the pure geometry shared by the server (membership, schedule) and the browser
 * (map preview). The server's decisions must be reproducible in the preview, so both run THIS code.
 *
 *   - pointInPolygon / zoneFor : which zone a customer's point belongs to (first zone in sort order
 *                                wins where zones overlap — deterministic, never "both");
 *   - validatePolygon          : what a stored zone boundary may look like;
 *   - autoZones                : k-means grouping of points into zones, DETERMINISTIC (same input →
 *                                same zones), every point lands inside its own zone's polygon.
 */
const DZ = require('../../dist-zones.js');

// A small square near Denpasar, as [lat, lng] vertices.
const SQ = [[-8.60, 115.20], [-8.60, 115.22], [-8.62, 115.22], [-8.62, 115.20]];

describe('pointInPolygon', () => {
  it('inside and outside', () => {
    expect(DZ.pointInPolygon(-8.61, 115.21, SQ)).toBe(true);
    expect(DZ.pointInPolygon(-8.63, 115.21, SQ)).toBe(false);
    expect(DZ.pointInPolygon(-8.61, 115.25, SQ)).toBe(false);
  });

  it('works for a concave polygon', () => {
    // A "U": the notch in the middle is outside.
    const U = [[0, 0], [0, 3], [3, 3], [3, 2], [1, 2], [1, 1], [3, 1], [3, 0]];
    expect(DZ.pointInPolygon(0.5, 1.5, U)).toBe(true);
    expect(DZ.pointInPolygon(2, 1.5, U)).toBe(false);
  });

  it('a missing point is never inside anything', () => {
    expect(DZ.pointInPolygon(null, 115.21, SQ)).toBe(false);
    expect(DZ.pointInPolygon(-8.61, undefined, SQ)).toBe(false);
  });
});

describe('zoneFor', () => {
  const zones = [
    { id: 'b', sortOrder: 2, polygon: SQ },
    { id: 'a', sortOrder: 1, polygon: SQ },   // same area, earlier in order
    { id: 'c', sortOrder: 3, polygon: [[-8.70, 115.30], [-8.70, 115.32], [-8.72, 115.32]] },
  ];
  it('the first zone in sort order wins an overlap', () => {
    expect(DZ.zoneFor(-8.61, 115.21, zones)).toBe('a');
  });
  it('outside every zone → null', () => {
    expect(DZ.zoneFor(-9, 116, zones)).toBeNull();
  });
  it('no coordinates → null', () => {
    expect(DZ.zoneFor(null, null, zones)).toBeNull();
  });
});

describe('validatePolygon', () => {
  it('accepts a sane polygon and normalises numbers', () => {
    expect(DZ.validatePolygon([['-8.6', '115.2'], [-8.6, 115.22], [-8.62, 115.22]])).toEqual({ ok: true, polygon: [[-8.6, 115.2], [-8.6, 115.22], [-8.62, 115.22]] });
  });
  it('rejects fewer than 3 points, out-of-range and non-numeric vertices', () => {
    expect(DZ.validatePolygon([[-8.6, 115.2], [-8.6, 115.22]]).ok).toBe(false);
    expect(DZ.validatePolygon([[-91, 115.2], [-8.6, 115.22], [-8.62, 115.22]]).ok).toBe(false);
    expect(DZ.validatePolygon([[-8.6, 'x'], [-8.6, 115.22], [-8.62, 115.22]]).ok).toBe(false);
    expect(DZ.validatePolygon('nope').ok).toBe(false);
  });
  it('rejects a zero-area polygon (all points on a line)', () => {
    expect(DZ.validatePolygon([[-8.6, 115.2], [-8.61, 115.21], [-8.62, 115.22]]).ok).toBe(false);
  });
  it('caps the vertex count', () => {
    const many = Array.from({ length: DZ.MAX_VERTICES + 1 }, (_, i) => [-8.6 + Math.sin(i) * 0.01, 115.2 + Math.cos(i) * 0.01]);
    expect(DZ.validatePolygon(many).ok).toBe(false);
  });
});

describe('autoZones', () => {
  // Three clear clusters of points, ~5 km apart.
  const cluster = (lat, lng, n, seed) => Array.from({ length: n }, (_, i) => ({ id: seed + i, lat: lat + Math.sin(i * 1.7 + seed) * 0.004, lng: lng + Math.cos(i * 2.3 + seed) * 0.004 }));
  const pts = [...cluster(-8.60, 115.20, 12, 1), ...cluster(-8.65, 115.25, 9, 50), ...cluster(-8.70, 115.18, 7, 90)];

  it('finds the clusters: every group is one of the real clusters', () => {
    const z = DZ.autoZones(pts, 3);
    expect(z).toHaveLength(3);
    const sizes = z.map((g) => g.ids.length).sort((a, b) => a - b);
    expect(sizes).toEqual([7, 9, 12]);
  });

  it('every point lies inside its own zone polygon', () => {
    const z = DZ.autoZones(pts, 3);
    const byId = new Map(pts.map((p) => [p.id, p]));
    z.forEach((g) => g.ids.forEach((id) => {
      const p = byId.get(id);
      expect(DZ.pointInPolygon(p.lat, p.lng, g.polygon)).toBe(true);
    }));
  });

  it('is deterministic — the same input gives the same zones', () => {
    expect(DZ.autoZones(pts, 3)).toEqual(DZ.autoZones(pts, 3));
  });

  it('produces valid polygons even for a 1- or 2-point group', () => {
    const z = DZ.autoZones([{ id: 1, lat: -8.6, lng: 115.2 }, { id: 2, lat: -8.7, lng: 115.3 }, { id: 3, lat: -8.7001, lng: 115.3001 }], 2);
    z.forEach((g) => expect(DZ.validatePolygon(g.polygon).ok).toBe(true));
  });

  it('never asks for more zones than points, and ignores points without coordinates', () => {
    const z = DZ.autoZones([{ id: 1, lat: -8.6, lng: 115.2 }, { id: 2, lat: null, lng: null }], 4);
    expect(z).toHaveLength(1);
    expect(z[0].ids).toEqual([1]);
  });

  it('empty input → no zones', () => {
    expect(DZ.autoZones([], 3)).toEqual([]);
  });
});

describe('planMembership — the schedule follows the zone', () => {
  const Z1 = { id: 'z1', sortOrder: 1, polygon: SQ, armada: 'DK 1', days: ['Sen', 'Kam'] };
  const cust = (o) => Object.assign({ id: 'c', lat: -8.61, lng: 115.21, zoneId: null, zoneManual: false, armada: 'DK 9', days: ['Rab'] }, o);

  it('a customer inside a zone gets its zone and the zone schedule', () => {
    const out = DZ.planMembership([cust()], [Z1]);
    expect(out).toEqual([{ id: 'c', from: { zoneId: null, armada: 'DK 9', days: ['Rab'] }, to: { zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Kam'] } }]);
  });

  it('nothing to change → no entry', () => {
    expect(DZ.planMembership([cust({ zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Kam'] })], [Z1])).toEqual([]);
  });

  it('a zone field left empty never overwrites the customer (no blanked schedules)', () => {
    const half = Object.assign({}, Z1, { armada: '', days: [] });
    const out = DZ.planMembership([cust()], [half]);
    expect(out[0].to).toEqual({ zoneId: 'z1', armada: 'DK 9', days: ['Rab'] });
  });

  it('leaving every zone keeps the last schedule — only the membership changes', () => {
    const out = DZ.planMembership([cust({ lat: -9, lng: 116, zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Kam'] })], [Z1]);
    expect(out[0].to).toEqual({ zoneId: null, armada: 'DK 1', days: ['Sen', 'Kam'] });
  });

  it('a hand-placed customer stays where they were put, even outside the boundary', () => {
    const Z2 = { id: 'z2', sortOrder: 2, polygon: [[-9.1, 116], [-9.1, 116.1], [-9.2, 116.1]], armada: 'DK 2', days: ['Sab'] };
    const out = DZ.planMembership([cust({ zoneId: 'z2', zoneManual: true })], [Z1, Z2]);
    expect(out[0].to).toEqual({ zoneId: 'z2', armada: 'DK 2', days: ['Sab'] });
  });

  it('hand-placed OUT of every zone stays out, even inside a boundary', () => {
    expect(DZ.planMembership([cust({ zoneId: null, zoneManual: true })], [Z1])).toEqual([]);
  });

  it('a hand-placed customer whose zone was deleted falls back to their point', () => {
    const out = DZ.planMembership([cust({ zoneId: 'gone', zoneManual: true })], [Z1]);
    expect(out[0].to.zoneId).toBe('z1');
    expect(out[0].manualCleared).toBe(true);
  });

  it('no coordinates and not placed by hand → no zone', () => {
    expect(DZ.planMembership([cust({ lat: null, lng: null })], [Z1])).toEqual([]);
  });

  it('day order does not count as a change', () => {
    expect(DZ.planMembership([cust({ zoneId: 'z1', armada: 'DK 1', days: ['Kam', 'Sen'] })], [Z1])).toEqual([]);
  });

  it('a FIXED-day customer takes the zone armada but keeps its own days', () => {
    const out = DZ.planMembership([cust({ fixed: true, days: ['Sen', 'Rab', 'Jum'] })], [Z1]);
    expect(out[0].to).toEqual({ zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Rab', 'Jum'] });
  });

  it('a fixed customer already on the zone armada → no change at all', () => {
    expect(DZ.planMembership([cust({ fixed: true, zoneId: 'z1', armada: 'DK 1', days: ['Sen', 'Rab', 'Jum'] })], [Z1])).toEqual([]);
  });
});

describe('capacitatedGroups — one zone = one day\'s route, never over the daily maximum', () => {
  const blob = (lat, lng, n, seed) => Array.from({ length: n }, (_, i) => ({ id: seed + i, lat: lat + Math.sin(i * 1.3 + seed) * 0.006, lng: lng + Math.cos(i * 2.1 + seed) * 0.006 }));

  it('makes ceil(n / max) groups, none bigger than max, every customer exactly once', () => {
    const pts = blob(-8.65, 115.22, 95, 1);
    const g = DZ.capacitatedGroups(pts, 20);
    expect(g).toHaveLength(5);
    g.forEach((x) => expect(x.ids.length).toBeLessThanOrEqual(20));
    const all = g.flatMap((x) => x.ids).sort((a, b) => a - b);
    expect(all).toEqual(pts.map((p) => p.id).sort((a, b) => a - b));
  });

  it('keeps real neighbourhoods together when they fit', () => {
    const pts = [...blob(-8.60, 115.20, 12, 1), ...blob(-8.66, 115.26, 9, 50), ...blob(-8.72, 115.18, 7, 90)];
    const g = DZ.capacitatedGroups(pts, 12);
    expect(g.map((x) => x.ids.length).sort((a, b) => a - b)).toEqual([7, 9, 12]);
  });

  it('splits a neighbourhood that is too big for one day', () => {
    const g = DZ.capacitatedGroups(blob(-8.65, 115.22, 25, 3), 10);
    expect(g).toHaveLength(3);
    g.forEach((x) => expect(x.ids.length).toBeLessThanOrEqual(10));
  });

  it('is deterministic, and every group has a valid boundary', () => {
    const pts = blob(-8.65, 115.22, 40, 7);
    expect(DZ.capacitatedGroups(pts, 15)).toEqual(DZ.capacitatedGroups(pts, 15));
    DZ.capacitatedGroups(pts, 15).forEach((x) => expect(DZ.validatePolygon(x.polygon).ok).toBe(true));
  });

  it('ignores points without coordinates; empty input → no groups', () => {
    expect(DZ.capacitatedGroups([{ id: 1, lat: null, lng: null }], 5)).toEqual([]);
  });

  it('no stretched routes: nobody could swap with someone in another route and both be closer to home', () => {
    // Two towns side by side plus scattered stragglers, with a tight daily maximum — the case where
    // the greedy pass leaves a straggler in a far route because the near one filled up first.
    const Z = [[[-8.615, 115.195], [-8.615, 115.235], [-8.64, 115.24], [-8.645, 115.2]], [[-8.64, 115.245], [-8.63, 115.28], [-8.67, 115.285], [-8.675, 115.25]], [[-8.67, 115.2], [-8.668, 115.24], [-8.71, 115.235], [-8.705, 115.195]]];
    let sd = 7; const r = () => { sd = (sd * 1664525 + 1013904223) % 4294967296; return sd / 4294967296; };
    const pts = []; let n = 0;
    Z.forEach((q) => { const la = q.reduce((a, v) => a + v[0], 0) / 4, ln = q.reduce((a, v) => a + v[1], 0) / 4; for (let i = 0; i < 14; i++) { n++; pts.push({ id: n, lat: la + (r() - 0.5) * 0.018, lng: ln + (r() - 0.5) * 0.02 }); r(); } });
    for (let i = 0; i < 5; i++) { n++; pts.push({ id: n, lat: -8.69 + r() * 0.02, lng: 115.27 + r() * 0.02 }); }
    const groups = DZ.capacitatedGroups(pts, 3);
    const byId = new Map(pts.map((p) => [p.id, p]));
    const cos = Math.cos((-8.62 * Math.PI) / 180);
    const d = (p, c) => { const dx = (p.lng - c[1]) * cos, dy = p.lat - c[0]; return dx * dx + dy * dy; };
    let improvable = 0;
    groups.forEach((A, a) => groups.forEach((B, b) => {
      if (b <= a) return;
      A.ids.forEach((i) => B.ids.forEach((j) => {
        const pi = byId.get(i), pj = byId.get(j);
        if (d(pi, B.center) + d(pj, A.center) < d(pi, A.center) + d(pj, B.center) - 1e-12) improvable++;
      }));
    }));
    expect(improvable).toBe(0);
    groups.forEach((x) => expect(x.ids.length).toBeLessThanOrEqual(3));
  });
});

describe('assignSlots — each zone gets an armada and a day', () => {
  // Four zones around a centre, one per compass direction.
  const g = (id, lat, lng) => ({ id, center: [lat, lng] });
  const groups = [g('n', -8.60, 115.22), g('e', -8.65, 115.27), g('s', -8.70, 115.22), g('w', -8.65, 115.17)];
  const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  it('each armada gets a CONTIGUOUS territory; days run Sen, Sel, … inside it', () => {
    const r = DZ.assignSlots(groups, ['A', 'B'], DAYS);
    expect(r.ok).toBe(true);
    const by = {}; r.slots.forEach((s, i) => { (by[s.armada] = by[s.armada] || []).push({ id: groups[i].id, day: s.day }); });
    expect(Object.keys(by).sort()).toEqual(['A', 'B']);
    Object.values(by).forEach((list) => {
      expect(list).toHaveLength(2);
      expect(list.map((x) => x.day).sort()).toEqual(['Sel', 'Sen']);
      // Neighbours on the compass, never opposite sides (n+s or e+w).
      const pair = list.map((x) => x.id).sort().join('');
      expect(['en', 'es', 'sw', 'nw']).toContain(pair);
    });
  });

  it('no (armada, day) is used twice', () => {
    const r = DZ.assignSlots(groups, ['A'], DAYS);
    const keys = r.slots.map((s) => s.armada + s.day);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('more zones than armada × days → not ok, says how many are short', () => {
    const r = DZ.assignSlots(groups, ['A'], ['Sen', 'Sel', 'Rab']);
    expect(r.ok).toBe(false);
    expect(r.needed).toBe(4);
    expect(r.available).toBe(3);
  });
});

describe('palette', () => {
  it('gives distinct colours in order and wraps', () => {
    expect(DZ.colorAt(0)).not.toBe(DZ.colorAt(1));
    expect(DZ.colorAt(DZ.PALETTE.length)).toBe(DZ.colorAt(0));
  });
});
