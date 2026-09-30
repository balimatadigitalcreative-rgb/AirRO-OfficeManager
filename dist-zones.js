'use strict';
/*
 * CUSTOMER ZONES — pure geometry, shared by the server and the browser.
 *
 * The server decides which zone a customer is in (and therefore which armada and delivery days it
 * gets); the map previews those decisions before they are saved. Both run THIS file, so a preview
 * can never disagree with what the server then writes.
 *
 * Coordinates are [lat, lng] pairs throughout (the order Leaflet uses). Zones are small (a few km),
 * so an equirectangular projection is accurate enough for grouping and for margins.
 *
 * Loaded as `window.DISTZONE` in the browser bundle AND require()d by the server.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // server (CommonJS)
  if (root) root.DISTZONE = api;                                               // browser (global)
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  var MAX_VERTICES = 200;
  var MAX_ZONES = 30;
  var MARGIN_M = 120;              // an auto zone reaches this far beyond its outermost customers
  var M_PER_DEG = 111320;
  // Distinct in hue AND lightness (never red-vs-green alone), each dark enough for white text.
  var PALETTE = ['#0B6FA8', '#138A84', '#B8740A', '#6A50BE', '#C2462F', '#1F7A4D', '#A63D7C', '#4A6272'];

  function num(v) { return typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); }
  function hasPoint(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng); }

  // Ray casting. A point exactly on an edge may fall either way — zones are drawn by hand, and a
  // customer sitting on a boundary to the centimetre is not a case worth a rule.
  function pointInPolygon(lat, lng, poly) {
    if (!hasPoint(lat, lng) || !poly || poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Which zone owns a point. Overlaps are resolved by sortOrder (then id), so membership is ONE zone,
  // always the same one — never "both", never input-order dependent.
  function zoneFor(lat, lng, zones) {
    if (!hasPoint(lat, lng) || !zones) return null;
    var ordered = zones.slice().sort(function (a, b) {
      return ((a.sortOrder || 0) - (b.sortOrder || 0)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    });
    for (var i = 0; i < ordered.length; i++) if (pointInPolygon(lat, lng, ordered[i].polygon)) return ordered[i].id;
    return null;
  }

  function area(poly) {
    var s = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j][1] + poly[i][1]) * (poly[j][0] - poly[i][0]);
    return Math.abs(s / 2);
  }

  // What a stored boundary may be. Returns the polygon with every coordinate as a Number.
  function validatePolygon(input) {
    if (!Array.isArray(input)) return { ok: false, error: 'Batas zona harus berupa daftar titik.' };
    if (input.length < 3) return { ok: false, error: 'Batas zona minimal 3 titik.' };
    if (input.length > MAX_VERTICES) return { ok: false, error: 'Batas zona maksimal ' + MAX_VERTICES + ' titik.' };
    var out = [];
    for (var i = 0; i < input.length; i++) {
      var p = input[i];
      if (!Array.isArray(p) || p.length !== 2) return { ok: false, error: 'Titik batas zona tidak valid.' };
      var lat = num(p[0]), lng = num(p[1]);
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: 'Koordinat batas zona tidak valid.' };
      out.push([lat, lng]);
    }
    if (area(out) < 1e-10) return { ok: false, error: 'Batas zona tidak membentuk area.' };
    return { ok: true, polygon: out };
  }

  // Deterministic PRNG so auto-grouping is reproducible (same customers → same zones).
  function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  // Monotone chain over projected [x, y]; returns the hull counter-clockwise.
  function hull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    var lower = [], upper = [], i;
    for (i = 0; i < p.length; i++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop(); lower.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop(); upper.push(p[i]); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // A zone around a group of points: the convex hull of a small octagon around EVERY point. That one
  // rule covers a single customer, two customers, and customers in a straight line, and keeps each
  // customer at least MARGIN_M inside the edge.
  function zonePolygon(points, cosLat) {
    var ring = [];
    var dy = MARGIN_M / M_PER_DEG;
    points.forEach(function (p) {
      for (var k = 0; k < 8; k++) {
        var a = (Math.PI / 4) * k + Math.PI / 8;
        ring.push([p.lng * cosLat + Math.cos(a) * dy, p.lat + Math.sin(a) * dy]);
      }
    });
    var h = hull(ring);
    // Stay under the vertex cap without ever cutting a customer out: thinning a convex hull's
    // vertices can only shrink it, so fall back to a bounding box, which contains everything.
    if (h.length > MAX_VERTICES) {
      var xs = ring.map(function (r) { return r[0]; }), ys = ring.map(function (r) { return r[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      h = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    return h.map(function (q) { return [round6(q[1]), round6(q[0] / cosLat)]; });
  }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  // Group points into k zones (k-means with k-means++ seeding, fixed seed). Points without coordinates
  // are ignored — they cannot be placed, and the UI lists them separately. Returns
  // [{ ids, center:[lat,lng], polygon }], largest group first.
  function autoZones(points, k) {
    var pts = (points || []).filter(function (p) { return p && hasPoint(p.lat, p.lng); });
    if (!pts.length) return [];
    k = Math.max(1, Math.min(Math.floor(k) || 1, pts.length, MAX_ZONES));
    var lat0 = pts.reduce(function (s, p) { return s + p.lat; }, 0) / pts.length;
    var cosLat = Math.cos((lat0 * Math.PI) / 180);
    var xy = pts.map(function (p) { return [p.lng * cosLat, p.lat]; });
    var d2 = function (a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    var r = rng(20260930);

    var centers = [xy[Math.floor(r() * xy.length)]];
    while (centers.length < k) {
      var dist = xy.map(function (p) { return Math.min.apply(null, centers.map(function (c) { return d2(p, c); })); });
      var total = dist.reduce(function (s, v) { return s + v; }, 0);
      if (total === 0) break;                                    // every remaining point coincides with a center
      var t = r() * total, idx = 0;
      while (idx < dist.length - 1 && (t -= dist[idx]) > 0) idx++;
      centers.push(xy[idx]);
    }

    var assign = new Array(xy.length).fill(-1);
    for (var iter = 0; iter < 100; iter++) {
      var changed = false;
      for (var i = 0; i < xy.length; i++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < centers.length; c++) { var v = d2(xy[i], centers[c]); if (v < bd) { bd = v; best = c; } }
        if (assign[i] !== best) { assign[i] = best; changed = true; }
      }
      if (!changed) break;
      centers = centers.map(function (c, ci) {
        var mine = xy.filter(function (_, i2) { return assign[i2] === ci; });
        if (!mine.length) return c;
        return [mine.reduce(function (s, p) { return s + p[0]; }, 0) / mine.length, mine.reduce(function (s, p) { return s + p[1]; }, 0) / mine.length];
      });
    }

    var groups = centers.map(function (c, ci) {
      var members = pts.filter(function (_, i3) { return assign[i3] === ci; });
      return { ids: members.map(function (p) { return p.id; }), center: [round6(c[1]), round6(c[0] / cosLat)], polygon: members.length ? zonePolygon(members, cosLat) : null };
    }).filter(function (g) { return g.ids.length; });
    groups.sort(function (a, b) { return b.ids.length - a.ids.length || (a.center[0] - b.center[0]) || (a.center[1] - b.center[1]); });
    return groups;
  }

  // ONE ZONE = ONE DAY'S ROUTE. Group points into ceil(n / maxPer) compact groups, NONE larger than
  // maxPer — k-means alone balances nothing, so a dense neighbourhood would become an impossible day.
  // Each round assigns points most-constrained first (largest "regret": how much worse their second-
  // nearest centre is) to the nearest centre that still has room, then moves the centres to the mean
  // of what they got. Total room (k × maxPer) always covers n, so everyone is placed.
  // Returns [{ ids, center:[lat,lng], polygon }], sorted like autoZones. Deterministic.
  function capacitatedGroups(points, maxPer) {
    var pts = (points || []).filter(function (p) { return p && hasPoint(p.lat, p.lng); });
    var cap = Math.max(1, Math.floor(maxPer) || 1);
    if (!pts.length) return [];
    var k = Math.ceil(pts.length / cap);
    var lat0 = pts.reduce(function (s, p) { return s + p.lat; }, 0) / pts.length;
    var cosLat = Math.cos((lat0 * Math.PI) / 180);
    var xy = pts.map(function (p) { return [p.lng * cosLat, p.lat]; });
    var d2 = function (a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    // Seed from plain k-means (same seed rules as autoZones) — good starting centres.
    var seeds = autoZones(pts, k).map(function (g) { return [g.center[1] * cosLat, g.center[0]]; });
    var centers = seeds.slice();
    while (centers.length < k) centers.push(xy[centers.length % xy.length]);   // coincident points: fewer seeds

    var n = xy.length, assign = null;
    for (var iter = 0; iter < 40; iter++) {
      var dist = xy.map(function (p) { return centers.map(function (c) { return d2(p, c); }); });
      var order = xy.map(function (_, i) {
        var s = dist[i].slice().sort(function (a, b) { return a - b; });
        return { i: i, regret: s.length > 1 ? s[1] - s[0] : 0 };
      }).sort(function (a, b) { return b.regret - a.regret || a.i - b.i; });
      var load = centers.map(function () { return 0; });
      var next = new Array(n).fill(-1);
      order.forEach(function (o) {
        var pref = centers.map(function (_, c) { return c; }).sort(function (a, b) { return dist[o.i][a] - dist[o.i][b] || a - b; });
        for (var j = 0; j < pref.length; j++) if (load[pref[j]] < cap) { next[o.i] = pref[j]; load[pref[j]]++; break; }
      });
      var same = assign && next.every(function (v, i) { return v === assign[i]; });
      assign = next;
      if (same) break;
      centers = centers.map(function (c, ci) {
        var mine = xy.filter(function (_, i2) { return assign[i2] === ci; });
        if (!mine.length) return c;
        return [mine.reduce(function (s, p) { return s + p[0]; }, 0) / mine.length, mine.reduce(function (s, p) { return s + p[1]; }, 0) / mine.length];
      });
    }
    // UNSTRETCH. The greedy pass can leave a straggler in a far route because the near one filled up
    // first — a route that crosses town. Keep improving until nothing can: move a customer to a closer
    // route that still has room, or swap two customers between routes when both end up closer to
    // their route's centre. Neither step can break the daily maximum, and each lowers the total
    // distance, so this stops.
    var mean = function (ci) {
      var mine = xy.filter(function (_, i2) { return assign[i2] === ci; });
      if (!mine.length) return centers[ci];
      return [mine.reduce(function (s, p) { return s + p[0]; }, 0) / mine.length, mine.reduce(function (s, p) { return s + p[1]; }, 0) / mine.length];
    };
    var EPS = 1e-14;
    for (var pass = 0; pass < 200; pass++) {
      centers = centers.map(function (_, ci) { return mean(ci); });
      var load2 = centers.map(function () { return 0; });
      assign.forEach(function (a) { load2[a]++; });
      var moved = false;
      for (var i = 0; i < n; i++) {
        var a = assign[i], di = d2(xy[i], centers[a]);
        for (var b = 0; b < centers.length; b++) {
          if (b === a || load2[b] >= cap) continue;
          if (d2(xy[i], centers[b]) < di - EPS) { load2[a]--; load2[b]++; assign[i] = b; a = b; di = d2(xy[i], centers[b]); moved = true; }
        }
      }
      for (var p = 0; p < n; p++) {
        for (var q = p + 1; q < n; q++) {
          var A = assign[p], B = assign[q];
          if (A === B) continue;
          if (d2(xy[p], centers[B]) + d2(xy[q], centers[A]) < d2(xy[p], centers[A]) + d2(xy[q], centers[B]) - EPS) { assign[p] = B; assign[q] = A; moved = true; }
        }
      }
      if (!moved) break;
    }
    var groups = centers.map(function (c, ci) {
      var members = pts.filter(function (_, i3) { return assign[i3] === ci; });
      return { ids: members.map(function (p) { return p.id; }), center: [round6(c[1]), round6(c[0] / cosLat)], polygon: members.length ? zonePolygon(members, cosLat) : null };
    }).filter(function (g) { return g.ids.length; });
    groups.sort(function (a, b) { return b.ids.length - a.ids.length || (a.center[0] - b.center[0]) || (a.center[1] - b.center[1]); });
    return groups;
  }

  // Give each group an (armada, day). Groups are ordered by bearing around the common centre, starting
  // just after the widest empty gap, and cut into one contiguous run per armada — so each truck works
  // one continuous territory rather than scattered patches. Within a run, days follow `days` in order.
  // Runs differ in length by at most one. More groups than armadas × days cannot be scheduled.
  // Returns { ok, slots:[{armada, day}] aligned with `groups` } or { ok:false, needed, available }.
  function assignSlots(groups, armadas, days) {
    var A = (armadas || []).filter(Boolean), D = (days || []).filter(Boolean);
    var needed = (groups || []).length, available = A.length * D.length;
    if (!needed) return { ok: true, slots: [] };
    if (needed > available) return { ok: false, needed: needed, available: available };
    var cy = groups.reduce(function (s, g) { return s + g.center[0]; }, 0) / needed;
    var cx = groups.reduce(function (s, g) { return s + g.center[1]; }, 0) / needed;
    var byAngle = groups.map(function (g, i) { return { i: i, a: Math.atan2(g.center[0] - cy, g.center[1] - cx) }; })
      .sort(function (p, q) { return p.a - q.a || p.i - q.i; });
    var start = 0, gap = -1;
    for (var j = 0; j < byAngle.length; j++) {
      var here = byAngle[j].a, prev = byAngle[(j - 1 + byAngle.length) % byAngle.length].a;
      var g2 = j === 0 ? here - prev + 2 * Math.PI : here - prev;
      if (g2 > gap) { gap = g2; start = j; }
    }
    var ring = byAngle.slice(start).concat(byAngle.slice(0, start));
    var usedArmadas = Math.min(A.length, needed);
    var base = Math.floor(needed / usedArmadas), extra = needed % usedArmadas;
    var slots = new Array(needed), pos = 0;
    for (var a = 0; a < usedArmadas; a++) {
      var len = base + (a < extra ? 1 : 0);
      for (var d = 0; d < len; d++) slots[ring[pos++].i] = { armada: A[a], day: D[d] };
    }
    return { ok: true, slots: slots };
  }

  function sameSet(a, b) {
    var x = (a || []).slice().sort().join(','), y = (b || []).slice().sort().join(',');
    return x === y;
  }

  // THE SCHEDULE FOLLOWS THE ZONE. For each customer: which zone they belong to, and the armada / days
  // that implies. Returns only the customers where something changes:
  //   [{ id, from:{zoneId,armada,days}, to:{zoneId,armada,days}, manualCleared? }]
  // Rules:
  //   - placed by hand (zoneManual) → stays in that zone, or out of every zone if zoneId is null;
  //     if that zone no longer exists, the customer falls back to their point (manualCleared);
  //   - otherwise → the zone their point is in (zoneFor), or none;
  //   - in a zone → the zone's armada / days where the zone sets them ('' / [] = leave the customer's);
  //   - in no zone → the schedule is left exactly as it is (leaving a zone never blanks a schedule).
  // customers: [{ id, lat, lng, zoneId, zoneManual, armada, days[] }]
  // zones:     [{ id, polygon, sortOrder, armada, days[] }]
  function planMembership(customers, zones) {
    var byId = {};
    (zones || []).forEach(function (z) { byId[z.id] = z; });
    var out = [];
    (customers || []).forEach(function (c) {
      var manualCleared = false, target;
      if (c.zoneManual) {
        if (c.zoneId == null) target = null;
        else if (byId[c.zoneId]) target = c.zoneId;
        else { manualCleared = true; target = zoneFor(c.lat, c.lng, zones); }
      } else target = zoneFor(c.lat, c.lng, zones);
      var z = target ? byId[target] : null;
      var armada = z && z.armada ? z.armada : (c.armada || '');
      var days = z && z.days && z.days.length ? z.days.slice() : (c.days || []).slice();
      var from = { zoneId: c.zoneId == null ? null : c.zoneId, armada: c.armada || '', days: (c.days || []).slice() };
      if (from.zoneId === target && from.armada === armada && sameSet(from.days, days) && !manualCleared) return;
      var row = { id: c.id, from: from, to: { zoneId: target, armada: armada, days: sameSet(from.days, days) ? from.days : days } };
      if (manualCleared) row.manualCleared = true;
      out.push(row);
    });
    return out;
  }

  function colorAt(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

  return {
    pointInPolygon: pointInPolygon, zoneFor: zoneFor, validatePolygon: validatePolygon, autoZones: autoZones, capacitatedGroups: capacitatedGroups, assignSlots: assignSlots, planMembership: planMembership,
    colorAt: colorAt, PALETTE: PALETTE, MAX_VERTICES: MAX_VERTICES, MAX_ZONES: MAX_ZONES, MARGIN_M: MARGIN_M,
  };
});
