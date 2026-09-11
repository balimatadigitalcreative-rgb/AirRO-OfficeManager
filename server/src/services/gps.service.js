'use strict';
/*
 * FLEET GPS — maps tracked vehicles to AirRO armadas and keeps their last known position.
 *
 * THE MAPPING IS SEEDED, THEN OWNED BY A HUMAN. `deriveFleet` reads the "(MERAH)"/"(BIRU)" suffix out
 * of the provider's vehicle_name to seed the link, but once someone sets it by hand
 * (fleetSource='manual') a later sync NEVER overwrites it. That is the whole point: renaming a vehicle
 * at the provider must not silently break the mapping. A vehicle that maps to nothing keeps fleetId ''
 * and is reported as `unmapped` so the UI can warn rather than quietly drop it from the fleet view.
 *
 * EVERY TIMESTAMP IS NORMALISED TO A UTC INSTANT ON INGEST (lib/time.parseProviderTs). The provider's
 * default_timezone is deliberately ignored — the two AirRO vehicles report different values (null and
 * "Asia/Bangkok") while both drive in Bali — so a stamp WITH an offset is used as-is and a NAIVE stamp
 * is interpreted in our configured CARTRACK_TZ, with the raw string and the assumed zone both stored.
 * Rendering happens in the app timezone (APP_TZ, WITA), so a one-hour drift cannot reach
 * "posisi terakhir X menit lalu" unnoticed.
 */
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const { parseProviderTs, todayISO, zonedNaiveToUtcMs } = require('../lib/time');
const { fleetScopeOf } = require('../lib/fleet-scope');
const cartrack = require('./cartrack.service');
const settings = require('./settings.service');

// ── fleet derivation ──────────────────────────────────────────────────────────────────────────────
// The token in the LAST parentheses of the vehicle name, e.g. "DK8919AQ (MERAH)" → "MERAH".
function fleetTokenOf(vehicleName) {
  const m = String(vehicleName || '').match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : '';
}
// The app's armada list. Single app-wide source: the `airro_fleet` setting (Setoran → Kelola Armada).
// Falls back to the armadas actually in use on customers, so derivation still works before anyone has
// curated that list.
async function knownFleets() {
  const out = [];
  try {
    const v = await settings.get('airro_fleet');
    (Array.isArray(v) ? v : []).forEach((f) => {
      const s = typeof f === 'string' ? f : (f && (f.plate || f.name || f.id));
      if (s && String(s).trim()) out.push(String(s).trim());
    });
  } catch (e) { /* setting absent is normal */ }
  if (!out.length) {
    const rows = await prisma.customer.findMany({ where: { armada: { not: '' } }, select: { armada: true }, distinct: ['armada'], take: 50 });
    rows.forEach((r) => { if (r.armada && r.armada.trim()) out.push(r.armada.trim()); });
  }
  return out;
}
// Match the token to a known armada, case-insensitively. Returns the armada EXACTLY as the app spells
// it (fleetId is compared verbatim everywhere else), or '' when nothing matches → unmapped.
function deriveFleet(vehicleName, fleets) {
  const token = fleetTokenOf(vehicleName);
  if (!token) return '';
  const hit = (fleets || []).find((f) => String(f).trim().toLowerCase() === token.toLowerCase());
  return hit ? String(hit).trim() : '';
}

/*
 * THE VEHICLE PROVIDER IS OPTIONAL. `cartrackAktif` (default on) switches the Cartrack adapter off
 * entirely - if the subscription is dropped, the setting goes false, the panel says so, and routing
 * carries on from the phone position or the depot. The adapter stays in the codebase, unbroken, so
 * turning it back on is a setting and not a redeploy.
 */
async function providerEnabled() {
  try { const v = await settings.get('cartrackAktif'); return v !== false; } catch (e) { return true; }
}

// ── TRACKING SCOPE ─ the one resolver every tracking path goes through ──────────────────────
/*
 * WHO MAY SEE WHICH VEHICLE. Derived from the SESSION and nothing else: `fleetScope` off the JWT, via
 * the same lib/fleet-scope used by the delivery board. A request parameter never widens it - that is
 * the IDOR pattern already fixed once in the accounting reports, and it must not come back through a
 * `?fleetId=` on a map.
 *
 * The convention (lib/fleet-scope): null = EVERY fleet (owner, GM, back office); an array restricts;
 * an explicit [] restricts to NOTHING and is a real state, not a synonym for "all".
 *
 * Scope names are matched to the app's armada list case-insensitively and canonicalised to the app's
 * spelling, because GpsDevice.fleetId is compared verbatim everywhere else. A scope entry matching no
 * known armada is DRIFT: it would silently show the user nothing at all, so it is reported rather than
 * swallowed - an empty panel that means "your access is misspelt" must never look like "no vehicles".
 */
async function trackingScope(user) {
  const raw = fleetScopeOf(user);
  const known = await knownFleets();
  if (raw === null) return { all: true, fleets: known, drift: [] };
  const canon = (f) => known.find((k) => String(k).trim().toLowerCase() === String(f).trim().toLowerCase());
  const drift = raw.filter((f) => !canon(f)).map((f) => String(f).trim());
  if (drift.length) {
    // Visible to whoever reads the logs, and returned to the caller so an admin sees it in the UI.
    console.warn('[gps] fleetScope names match no known armada: ' + drift.join(', ') + ' (known: ' + known.join(', ') + ')');
  }
  return { all: false, fleets: raw.map((f) => canon(f) || String(f).trim()), drift };
}

// The prisma filter for a resolved scope. An unrestricted scope filters nothing; a restricted one is
// an explicit `in` list, and an EMPTY scope matches nothing rather than everything - the difference
// between "sees all vehicles" and "sees none" is one careless fallback.
function scopeWhereFleet(scope) {
  if (scope.all) return {};
  return { fleetId: { in: scope.fleets.length ? scope.fleets : ['__no_fleet__'] } };
}

// WHO LOOKED. Tracking is employee monitoring, so a view is recorded - once per actor per fleet per
// business day, because the panel reloads on every visit to the delivery screen and an audit log
// nobody can read answers nothing. Written directly (not via distribution.service) so that route
// ordering can depend on THIS module without a require cycle.
async function noteTrackingView(user, scope) {
  if (!user || !user.id) return;
  const ymd = todayISO();
  const since = new Date(zonedNaiveToUtcMs(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)), config.appTz));
  const fleetId = scope.all ? '' : scope.fleets.join(', ');       // '' = every fleet, the log's own convention
  const seen = await prisma.distAuditLog.findFirst({ where: { kind: 'lacak_armada', actorId: user.id, fleetId, createdAt: { gte: since } }, select: { id: true } });
  if (seen) return;
  let name = null;
  let role = (user && user.role) || null;
  try {
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, role: true } });
    if (u) { name = u.name; role = u.role; }
  } catch (e) { /* the log must never break the read it is recording */ }
  await prisma.distAuditLog.create({ data: {
    kind: 'lacak_armada',
    title: 'Lihat posisi kendaraan: ' + (scope.all ? 'semua armada' : (fleetId || 'tanpa armada')),
    detail: 'Akses pelacakan dibuka' + (scope.all ? '' : ' untuk armada ' + fleetId),
    fleetId, actorId: user.id, actorRole: role, actorName: name,
  } });
}

// ── what happened last time we asked the provider ────────────────────────────────
// A BLANK EMPTY STATE HIDES BUGS. "belum ada posisi" sat on the screen while the adapter was calling an
// endpoint that carries no position at all, and nothing on the page could have said so. So the outcome
// of every attempt is recorded and shown: when we last asked, and what came back.
// Provider error TEXT is safe to store - ApiError messages carry a status code and a path, never the
// Authorization header or the credentials themselves.
const ATTEMPT_KEY = 'gps_last_attempt';
async function recordAttempt(kind, ok, error) {
  const rec = { at: Date.now(), kind, ok: !!ok, error: error ? String(error).slice(0, 300) : '' };
  try { await settings.set(ATTEMPT_KEY, rec); } catch (e) { /* never fail a sync over its own bookkeeping */ }
  return rec;
}
async function lastAttempt() {
  try { const v = await settings.get(ATTEMPT_KEY); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

// The columns a fix writes - or {} when the reading is older than the one already stored.
// A LAST-KNOWN POSITION ONLY MOVES FORWARD: an out-of-order reading, or an identity row standing in for
// a status feed that is down, would otherwise draw the vehicle jumping back across town. That reads as
// real movement, which is worse than showing nothing.
function positionPatch(existing, fix, ts) {
  if (existing && existing.lastFixAt && ts.at && ts.at.getTime() < new Date(existing.lastFixAt).getTime()) return {};
  const pos = {};
  if (fix.lat != null && fix.lng != null) { pos.lastLat = fix.lat; pos.lastLng = fix.lng; }
  if (fix.speedKph != null) pos.lastSpeedKph = fix.speedKph;
  if (fix.headingDeg != null) pos.lastHeadingDeg = fix.headingDeg;
  if (fix.ignitionOn != null) pos.lastIgnitionOn = fix.ignitionOn;
  if (ts.at) { pos.lastFixAt = ts.at; pos.lastFixRaw = ts.raw; pos.lastFixAssumedTz = ts.assumedTz; }
  return pos;
}

// A fix older than this is flagged stale (it still shows - with its age).
const STALE_FIX_MS = 30 * 60 * 1000;

// ── client shape ─────────────────────────────────────────────────────────────────────────────────
function deviceClient(d) {
  return {
    id: d.id, provider: d.provider, vehicleId: d.vehicleId,
    registration: d.registration || '', vehicleName: d.vehicleName || '',
    fleetId: d.fleetId || '', fleetSource: d.fleetSource || 'derived', unmapped: !d.fleetId,
    providerTz: d.providerTz || '', active: d.active !== false,
    lat: d.lastLat != null ? d.lastLat : null, lng: d.lastLng != null ? d.lastLng : null,
    speedKph: d.lastSpeedKph != null ? d.lastSpeedKph : null,
    headingDeg: d.lastHeadingDeg != null ? d.lastHeadingDeg : null,
    // null is "the provider said nothing" - deliberately NOT folded into false.
    ignitionOn: d.lastIgnitionOn == null ? null : !!d.lastIgnitionOn,
    // WHY there is no position, so the UI never has to render an unexplained blank:
    //   ok    - we have one          never - this device has never been synced
    //   noFix - synced, but the provider has never reported a position for it
    posState: (d.lastLat != null && d.lastLng != null) ? 'ok' : (d.lastSyncAt ? 'noFix' : 'never'),
    // A fix old enough that "where the truck is" is a guess. Shown, never hidden: a stale position
    // presented as current is worse than an honest "posisi terakhir 3 jam lalu".
    stale: !!(d.lastFixAt && Date.now() - new Date(d.lastFixAt).getTime() > STALE_FIX_MS),
    // A UTC epoch. The client renders it in the app timezone; it is never a pre-formatted local string.
    fixAt: d.lastFixAt ? new Date(d.lastFixAt).getTime() : null,
    fixRaw: d.lastFixRaw || '', fixAssumedTz: d.lastFixAssumedTz || '',
    syncAt: d.lastSyncAt ? new Date(d.lastSyncAt).getTime() : null,
  };
}

// ── read ─────────────────────────────────────────────────────────────────────────────────────────
async function listDevices(user, scopeIn) {
  const scope = scopeIn || await trackingScope(user);
  const rows = await prisma.gpsDevice.findMany({ where: scopeWhereFleet(scope), orderBy: [{ fleetId: 'asc' }, { vehicleName: 'asc' }] });
  const data = rows.map(deviceClient);
  const enabled = await providerEnabled();
  return {
    data,
    // Switched OFF is a different state from NOT CONFIGURED, and the panel says which.
    providerEnabled: enabled,
    configured: enabled && cartrack.configured(),
    appTz: config.appTz,
    // When we last asked the provider and how it went - shown beside an empty position.
    lastAttempt: await lastAttempt(),
    // What this session may see, so the UI can explain itself instead of rendering an empty box.
    scope: { all: scope.all, fleets: scope.fleets, drift: scope.drift },
    //   emptyScope - holds the capability but is assigned no armada
    //   driftScope - the assigned armada matches no known fleet (a spelling problem, not an empty fleet)
    //   noDevice   - their armada has no GPS device mapped to it yet
    state: scope.all || scope.fleets.length ? (data.length ? 'ok' : (scope.drift.length ? 'driftScope' : 'noDevice')) : 'emptyScope',
    // Vehicles the app cannot attribute to any armada. They belong to no fleet, so they are only ever
    // visible to an unrestricted session - a driver is not shown another fleet's unmapped truck.
    unmapped: scope.all ? data.filter((d) => d.unmapped).map((d) => ({ id: d.id, vehicleName: d.vehicleName, registration: d.registration })) : [],
  };
}

// The read the API serves: identical to listDevices, plus the "who looked" record.
async function viewDevices(user) {
  const scope = await trackingScope(user);
  await noteTrackingView(user, scope);
  return listDevices(user, scope);
}

// One device, or 403. A crafted id naming another fleet's vehicle is REFUSED rather than served, and
// the message names no vehicle: an error must not become a way to learn that a truck exists.
async function deviceInScope(user, id) {
  const d = await prisma.gpsDevice.findUnique({ where: { id } });
  if (!d) throw ApiError.notFound('Perangkat GPS tidak ditemukan.');
  const scope = await trackingScope(user);
  if (!scope.all && !scope.fleets.includes(d.fleetId)) throw ApiError.forbidden('Armada di luar akses Anda.');
  return d;
}

// ── sync ─────────────────────────────────────────────────────────────────────────────────────────
async function syncDevices(actor) {
  if (!(await providerEnabled())) throw ApiError.badRequest('Pelacakan kendaraan dimatikan di pengaturan.', { providerEnabled: false });
  const vehicles = await cartrack.listVehicles();
  // TWO FEEDS, ONE ROW. /vehicles is identity (registration, name, licence) and carries no position on
  // this tenant; /vehicles/status is where the fix actually lives. A tenant that lacks the status feed
  // must still get its MAPPING synced — no position is "belum ada posisi", which is information, not a
  // failure — so a broken position feed is recorded and stepped over, never allowed to fail the sync.
  const statusById = new Map();
  let positionFeed = true;
  let feedError = '';
  try {
    (await cartrack.listStatuses()).forEach((st) => statusById.set(st.vehicleId, st));
  } catch (e) { positionFeed = false; feedError = (e && e.message) || 'gagal'; }
  await recordAttempt('sync', positionFeed, feedError);
  const fleets = await knownFleets();
  const now = new Date();
  const out = { created: 0, updated: 0, keptManual: 0, unmapped: 0, positioned: 0, positionFeed, total: vehicles.length };
  for (const v of vehicles) {
    const existing = await prisma.gpsDevice.findUnique({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: v.vehicleId } } });
    // A HUMAN-SET mapping is never overwritten by a sync — that is what makes a provider rename safe.
    const manual = existing && existing.fleetSource === 'manual';
    if (manual) out.keptManual++;
    const derived = deriveFleet(v.vehicleName, fleets);
    const fleetId = manual ? existing.fleetId : derived;
    if (!fleetId) out.unmapped++;
    // The live feed wins where it has an answer; the identity row is the fallback for a tenant that
    // does carry a fix there. A field missing from BOTH leaves the stored value untouched rather than
    // blanking a good last-known position with a momentary gap in the feed.
    const st = statusById.get(v.vehicleId) || {};
    const fix = {
      lat: st.lat != null ? st.lat : v.lat,
      lng: st.lng != null ? st.lng : v.lng,
      speedKph: st.speedKph != null ? st.speedKph : v.speedKph,
      headingDeg: st.headingDeg != null ? st.headingDeg : null,
      ignitionOn: st.ignitionOn != null ? st.ignitionOn : null,
      rawTs: st.rawTs != null ? st.rawTs : v.rawTs,
    };
    // Normalise the fix timestamp to a UTC instant; keep the raw string + the zone we assumed.
    const ts = parseProviderTs(fix.rawTs, config.cartrack.tz);
    const pos = positionPatch(existing, fix, ts);
    const data = {
      registration: v.registration, vehicleName: v.vehicleName, providerTz: v.providerTz,
      fleetId, fleetSource: manual ? 'manual' : 'derived', lastSyncAt: now, active: true, ...pos,
    };
    if (existing) { await prisma.gpsDevice.update({ where: { id: existing.id }, data }); out.updated++; }
    else { await prisma.gpsDevice.create({ data: { provider: 'cartrack', vehicleId: v.vehicleId, ...data } }); out.created++; }
  }
  const res = Object.assign(out, await listDevices(actor));
  // How many devices actually have a known position once the dust settles — the number the UI cares
  // about, and not the same as how many rows the sync happened to write.
  res.positioned = res.data.filter((d) => d.lat != null && d.lng != null).length;
  return res;
}

// ── position refresh (on demand) ─────────────────────────────────────────────
/*
 * A READ of the live feed: it updates positions only, never creates a device and never touches the
 * fleet mapping. That is why it rides distribusiPengiriman rather than `settings` - a driver must be
 * able to ask "where is the truck now?" without holding the keys to the integration.
 *
 * THE SHORT CACHE IS THE RATE LIMIT. One call to /vehicles/status returns EVERY vehicle, so a whole
 * delivery team pressing [Coba lagi] at once costs the provider one request per REFRESH_MIN_MS - not
 * one per person, and not one per vehicle.
 */
const REFRESH_MIN_MS = 20000;
let lastRefreshMs = 0;

async function refreshPositions(user, opts) {
  const force = !!(opts && opts.force);
  if (!(await providerEnabled()) || !cartrack.configured()) return Object.assign({ refreshed: false, cached: false }, await listDevices(user));
  if (!force && Date.now() - lastRefreshMs < REFRESH_MIN_MS) {
    return Object.assign({ refreshed: false, cached: true }, await listDevices(user));
  }
  let statuses = null;
  let error = '';
  try { statuses = await cartrack.listStatuses(); } catch (e) { error = (e && e.message) || 'gagal'; }
  // SUCCESS IS CACHED; A FAILURE IS NOT. Someone staring at "penyedia error" and pressing [Coba lagi]
  // must actually reach the provider — serving them a twenty-second-old refusal would look like the
  // button is broken, and they would press it harder.
  if (!error) lastRefreshMs = Date.now();
  await recordAttempt('refresh', !error, error);
  if (error) return Object.assign({ refreshed: false, cached: false, error }, await listDevices(user));
  const now = new Date();
  for (const st of statuses) {
    const existing = await prisma.gpsDevice.findUnique({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: st.vehicleId } } });
    if (!existing) continue;      // a vehicle we have never synced is not ours to invent here
    const ts = parseProviderTs(st.rawTs, config.cartrack.tz);
    await prisma.gpsDevice.update({ where: { id: existing.id }, data: Object.assign({ lastSyncAt: now }, positionPatch(existing, st, ts)) });
  }
  return Object.assign({ refreshed: true, cached: false }, await listDevices(user));
}

// ── editable mapping ─────────────────────────────────────────────────────────────────────────────
// Setting the fleet by hand marks the row 'manual' so a later sync leaves it alone. Passing '' clears
// the mapping AND returns the row to 'derived', so the next sync may seed it again.
async function setDeviceFleet(user, id, body) {
  // BOTH ends are scoped: you may not re-map a vehicle you cannot see, and you may not hand one to a
  // fleet outside your own access - otherwise a scoped admin could move a truck out of sight.
  const d = await deviceInScope(user, id);
  const fleetId = String(body.fleetId == null ? '' : body.fleetId).trim();
  if (fleetId) {
    const fleets = await knownFleets();
    if (fleets.length && !fleets.some((f) => String(f).trim().toLowerCase() === fleetId.toLowerCase())) {
      throw ApiError.badRequest('Armada "' + fleetId + '" tidak dikenal.', { fleets });
    }
    const scope = await trackingScope(user);
    if (!scope.all && !scope.fleets.some((f) => f.toLowerCase() === fleetId.toLowerCase())) {
      throw ApiError.forbidden('Armada di luar akses Anda.');
    }
  }
  const up = await prisma.gpsDevice.update({ where: { id }, data: { fleetId, fleetSource: fleetId ? 'manual' : 'derived' } });
  return deviceClient(up);
}

module.exports = { listDevices, viewDevices, providerEnabled, trackingScope, deviceInScope, syncDevices, refreshPositions, setDeviceFleet, deriveFleet, fleetTokenOf, knownFleets, deviceClient };
