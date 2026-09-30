'use strict';
/*
 * RUTE RIT — plan ONE trip (rit) of one armada, the way the owner runs deliveries:
 *
 *   start at the warehouse → the NEAREST customer the remaining load still covers → the nearest from
 *   there → … until no remaining customer fits the load → back to the warehouse.
 *
 * Whatever does not fit waits for the next rit, which starts from the warehouse again (the caller plans
 * it when that rit is opened, with that rit's own load). Pure: no I/O, deterministic.
 *
 *   planRit({ depot:{lat,lng}, capacity, stops:[{ id, lat, lng, qty, pinned }] }) →
 *   { rit:[{ id, qty, legKm, cumKm, loadAfter }], used, capacity, returnKm, totalKm,
 *     leftover:[{ id, qty }], leftoverGallons, estRits, tooBig:[{ id, qty }], unlocated:[id] }
 *
 * Rules:
 *   - a stop without coordinates cannot be placed → `unlocated` (listed, never planned);
 *   - a stop needing more than the WHOLE load can never ride this rit → `tooBig` (flagged, never
 *     silently dropped);
 *   - pinned stops (a fixed hour, "urutan tetap") are RESERVED into this rit first, in their board order,
 *     as far as the load allows; the other stops fill around them;
 *   - among the stops that still fit (load minus what the pinned stops still need), always go to the
 *     nearest — so a small order further away can still ride when a big nearby one no longer fits.
 */
function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const km1 = (v) => Math.round(v * 10) / 10;
const hasCoords = (s) => typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);

function planRit({ depot, capacity, stops }) {
  const cap = Math.max(0, Math.floor(Number(capacity) || 0));
  const all = (stops || []).map((s, i) => ({ id: s.id, lat: s.lat, lng: s.lng, qty: Math.max(1, Math.floor(Number(s.qty) || 1)), pinned: !!s.pinned, i }));
  const unlocated = all.filter((s) => !hasCoords(s)).map((s) => s.id);
  const located = all.filter(hasCoords);
  const tooBig = located.filter((s) => s.qty > cap).map((s) => ({ id: s.id, qty: s.qty }));
  const eligible = located.filter((s) => s.qty <= cap);

  // Pinned stops are reserved first, in board order, while the load allows.
  const reserved = new Set();
  let reservedQty = 0;
  eligible.filter((s) => s.pinned).forEach((s) => { if (reservedQty + s.qty <= cap) { reserved.add(s.id); reservedQty += s.qty; } });

  const rit = [];
  const done = new Set();
  let pos = depot, load = cap, cum = 0;
  for (;;) {
    const room = load - reservedQty;   // what the unreserved stops may still use
    let best = null, bestD = Infinity;
    eligible.forEach((s) => {
      if (done.has(s.id)) return;
      // A reserved pinned stop always may go; a pinned stop that did not fit the reservation waits for
      // the next rit (its hour is kept there); any other stop goes if it fits the unreserved room.
      const ok = reserved.has(s.id) || (!s.pinned && s.qty <= room);
      if (!ok) return;
      const d = haversineKm(pos, s);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && s.i < best.i)) { best = s; bestD = d; }
    });
    if (!best) break;
    done.add(best.id);
    if (reserved.has(best.id)) reservedQty -= best.qty;
    load -= best.qty;
    cum += bestD;
    rit.push({ id: best.id, qty: best.qty, legKm: km1(bestD), cumKm: km1(cum), loadAfter: load });
    pos = best;
  }
  const returnKm = rit.length ? km1(haversineKm(pos, depot)) : 0;
  const leftover = eligible.filter((s) => !done.has(s.id)).map((s) => ({ id: s.id, qty: s.qty }));
  const leftoverGallons = leftover.reduce((t, s) => t + s.qty, 0);
  return {
    rit, used: cap - load, capacity: cap, returnKm, totalKm: km1(cum + returnKm),
    leftover, leftoverGallons, estRits: cap > 0 && leftoverGallons > 0 ? Math.ceil(leftoverGallons / cap) : 0,
    tooBig, unlocated,
  };
}

module.exports = { planRit, haversineKm };
