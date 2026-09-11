'use strict';
/*
 * CARTRACK fleet API client (read-only).
 *
 * Scope: this is the ONLY place that talks to the provider. Credentials come from env
 * (CARTRACK_USERNAME / CARTRACK_PASSWORD) and never leave this module — they are not stored in the
 * database, never returned in a response, and never written to the audit log or an error message.
 *
 * Not configured is NOT an error: `configured()` is false and callers surface a clear
 * "belum dihubungkan" state instead of throwing, so a box without credentials still boots and serves.
 *
 * CONFIRMED: GET {base}/vehicles returns 200 with Basic auth. Everything else about the payload is
 * read DEFENSIVELY — field names vary between Cartrack tenants, so `pick()` accepts the common
 * spellings and a missing field simply means "unknown", never a crash.
 */
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const configured = () => !!(config.cartrack.username && config.cartrack.password);

// Basic auth header, built per call and never retained.
function authHeader() {
  const raw = config.cartrack.username + ':' + config.cartrack.password;
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

// GET a path under the configured base. Times out rather than hanging a request thread. The provider's
// body is returned verbatim for the caller to interpret; errors NEVER echo the credentials or the
// Authorization header.
async function get(path) {
  if (!configured()) throw ApiError.badRequest('Cartrack belum dihubungkan — set CARTRACK_USERNAME dan CARTRACK_PASSWORD di server.', { configured: false });
  const url = config.cartrack.baseUrl + (path.startsWith('/') ? path : '/' + path);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.cartrack.timeoutMs);
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: authHeader(), Accept: 'application/json' }, signal: ctl.signal });
  } catch (e) {
    const why = e && e.name === 'AbortError' ? 'timeout' : 'tidak dapat dihubungi';
    throw ApiError.badRequest('Cartrack ' + why + ' (' + path + ').', { provider: 'cartrack', path });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw ApiError.badRequest('Cartrack menolak permintaan (HTTP ' + res.status + ').', { status: res.status, path });
  try { return await res.json(); } catch (e) { throw ApiError.badRequest('Cartrack mengirim respons yang bukan JSON.', { path }); }
}

// Providers wrap the list differently ({data:[…]}, {vehicles:[…]}, or a bare array).
function unwrapList(body) {
  if (Array.isArray(body)) return body;
  for (const k of ['data', 'vehicles', 'results', 'items']) {
    if (body && Array.isArray(body[k])) return body[k];
  }
  return [];
}

// First present, non-empty value among several candidate field names.
function pick(obj, names) {
  for (const n of names) {
    const v = obj ? obj[n] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

const F = {
  vehicleId: ['vehicle_id', 'vehicleId', 'id'],
  registration: ['registration', 'vehicle_registration', 'registration_number', 'plate', 'license_plate'],
  name: ['vehicle_name', 'vehicleName', 'name', 'description'],
  tz: ['default_timezone', 'timezone', 'time_zone'],
  lat: ['latitude', 'lat', 'position_latitude', 'gps_latitude', 'last_latitude'],
  lng: ['longitude', 'lng', 'lon', 'position_longitude', 'gps_longitude', 'last_longitude'],
  ts: ['event_ts', 'gps_ts', 'position_ts', 'last_position_ts', 'last_update', 'event_date', 'timestamp', 'updated_at'],
  speed: ['speed', 'speed_kph', 'speed_km_h', 'velocity'],
};

// Normalise ONE provider vehicle row into the shape the GPS service stores. Position fields are
// optional: /vehicles may or may not carry a last-known fix depending on the tenant, and "no fix yet"
// is a legitimate state, not a failure.
function normalizeVehicle(v) {
  return {
    vehicleId: String(pick(v, F.vehicleId) != null ? pick(v, F.vehicleId) : '').trim(),
    registration: String(pick(v, F.registration) || '').trim(),
    vehicleName: String(pick(v, F.name) || '').trim(),
    providerTz: String(pick(v, F.tz) || '').trim(),
    lat: num(pick(v, F.lat)),
    lng: num(pick(v, F.lng)),
    speedKph: num(pick(v, F.speed)),
    rawTs: pick(v, F.ts),
  };
}

async function listVehicles() {
  const body = await get('/vehicles');
  return unwrapList(body).map(normalizeVehicle).filter((v) => v.vehicleId);
}

/*
 * THE FIX LIVES IN A DIFFERENT ENDPOINT. On this tenant `/vehicles` is pure identity — registration,
 * model, licence — with no position on it at all, which is why every device read "belum ada posisi".
 * `/vehicles/status` is the live feed: event_ts, speed, bearing, ignition, odometer and `location`.
 *
 * Its coordinates are NESTED inside `location`, not at the top level, so the shapes below are tried in
 * turn. Other tenants flatten them, and GeoJSON puts them in an array the other way round
 * ([longitude, latitude]) — a wrong guess there silently plots Bali into the Indian Ocean.
 */
function coordsOf(row) {
  const bags = [row, row && row.location, row && row.position, row && row.gps,
                row && row.location && row.location.position, row && row.location && row.location.geometry];
  for (const b of bags) {
    if (!b || typeof b !== 'object') continue;
    const lat = num(pick(b, F.lat));
    const lng = num(pick(b, F.lng));
    if (lat !== null && lng !== null) return { lat, lng };
    const c = b.coordinates;   // GeoJSON order is [lng, lat] — deliberately reversed on the way out.
    if (Array.isArray(c) && c.length >= 2 && num(c[0]) !== null && num(c[1]) !== null) return { lat: num(c[1]), lng: num(c[0]) };
  }
  const m = (typeof (row && row.location) === 'string' ? row.location : '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { lat: num(m[1]), lng: num(m[2]) };
  return { lat: null, lng: null };
}

// Normalise ONE row of the live feed. (0,0) is Null Island: a tracker that has never had a fix reports
// it, and a vehicle in Bali never does — so it means "no position", not a position off West Africa.
function normalizeStatus(s) {
  const c = coordsOf(s);
  const real = c.lat !== null && c.lng !== null && !(c.lat === 0 && c.lng === 0);
  return {
    vehicleId: String(pick(s, F.vehicleId) != null ? pick(s, F.vehicleId) : '').trim(),
    registration: String(pick(s, F.registration) || '').trim(),
    lat: real ? c.lat : null,
    lng: real ? c.lng : null,
    speedKph: num(pick(s, F.speed)),
    rawTs: pick(s, F.ts),
  };
}

async function listStatuses() {
  const body = await get('/vehicles/status');
  return unwrapList(body).map(normalizeStatus).filter((v) => v.vehicleId);
}

module.exports = { configured, listVehicles, listStatuses, normalizeVehicle, normalizeStatus, coordsOf, unwrapList, pick, FIELDS: F };
