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
});

describe('palette', () => {
  it('gives distinct colours in order and wraps', () => {
    expect(DZ.colorAt(0)).not.toBe(DZ.colorAt(1));
    expect(DZ.colorAt(DZ.PALETTE.length)).toBe(DZ.colorAt(0));
  });
});
