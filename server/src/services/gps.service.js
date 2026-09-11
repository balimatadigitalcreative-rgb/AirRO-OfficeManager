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
const { parseProviderTs } = require('../lib/time');
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

// ── client shape ─────────────────────────────────────────────────────────────────────────────────
function deviceClient(d) {
  return {
    id: d.id, provider: d.provider, vehicleId: d.vehicleId,
    registration: d.registration || '', vehicleName: d.vehicleName || '',
    fleetId: d.fleetId || '', fleetSource: d.fleetSource || 'derived', unmapped: !d.fleetId,
    providerTz: d.providerTz || '', active: d.active !== false,
    lat: d.lastLat != null ? d.lastLat : null, lng: d.lastLng != null ? d.lastLng : null,
    speedKph: d.lastSpeedKph != null ? d.lastSpeedKph : null,
    // A UTC epoch. The client renders it in the app timezone; it is never a pre-formatted local string.
    fixAt: d.lastFixAt ? new Date(d.lastFixAt).getTime() : null,
    fixRaw: d.lastFixRaw || '', fixAssumedTz: d.lastFixAssumedTz || '',
    syncAt: d.lastSyncAt ? new Date(d.lastSyncAt).getTime() : null,
  };
}

// ── read ─────────────────────────────────────────────────────────────────────────────────────────
async function listDevices() {
  const rows = await prisma.gpsDevice.findMany({ orderBy: [{ fleetId: 'asc' }, { vehicleName: 'asc' }] });
  const data = rows.map(deviceClient);
  return {
    data,
    configured: cartrack.configured(),
    appTz: config.appTz,
    // The UI warning: tracked vehicles the app cannot attribute to any armada.
    unmapped: data.filter((d) => d.unmapped).map((d) => ({ id: d.id, vehicleName: d.vehicleName, registration: d.registration })),
  };
}

// ── sync ─────────────────────────────────────────────────────────────────────────────────────────
async function syncDevices(actor) {
  const vehicles = await cartrack.listVehicles();
  const fleets = await knownFleets();
  const now = new Date();
  const out = { created: 0, updated: 0, keptManual: 0, unmapped: 0, total: vehicles.length };
  for (const v of vehicles) {
    const existing = await prisma.gpsDevice.findUnique({ where: { provider_vehicleId: { provider: 'cartrack', vehicleId: v.vehicleId } } });
    // A HUMAN-SET mapping is never overwritten by a sync — that is what makes a provider rename safe.
    const manual = existing && existing.fleetSource === 'manual';
    if (manual) out.keptManual++;
    const derived = deriveFleet(v.vehicleName, fleets);
    const fleetId = manual ? existing.fleetId : derived;
    if (!fleetId) out.unmapped++;
    // Normalise the fix timestamp to a UTC instant; keep the raw string + the zone we assumed.
    const ts = parseProviderTs(v.rawTs, config.cartrack.tz);
    const pos = {};
    if (v.lat != null && v.lng != null) { pos.lastLat = v.lat; pos.lastLng = v.lng; }
    if (v.speedKph != null) pos.lastSpeedKph = v.speedKph;
    if (ts.at) { pos.lastFixAt = ts.at; pos.lastFixRaw = ts.raw; pos.lastFixAssumedTz = ts.assumedTz; }
    const data = {
      registration: v.registration, vehicleName: v.vehicleName, providerTz: v.providerTz,
      fleetId, fleetSource: manual ? 'manual' : 'derived', lastSyncAt: now, active: true, ...pos,
    };
    if (existing) { await prisma.gpsDevice.update({ where: { id: existing.id }, data }); out.updated++; }
    else { await prisma.gpsDevice.create({ data: { provider: 'cartrack', vehicleId: v.vehicleId, ...data } }); out.created++; }
  }
  return Object.assign(out, await listDevices());
}

// ── editable mapping ─────────────────────────────────────────────────────────────────────────────
// Setting the fleet by hand marks the row 'manual' so a later sync leaves it alone. Passing '' clears
// the mapping AND returns the row to 'derived', so the next sync may seed it again.
async function setDeviceFleet(id, body) {
  const d = await prisma.gpsDevice.findUnique({ where: { id } });
  if (!d) throw ApiError.notFound('Perangkat GPS tidak ditemukan.');
  const fleetId = String(body.fleetId == null ? '' : body.fleetId).trim();
  if (fleetId) {
    const fleets = await knownFleets();
    if (fleets.length && !fleets.some((f) => String(f).trim().toLowerCase() === fleetId.toLowerCase())) {
      throw ApiError.badRequest('Armada "' + fleetId + '" tidak dikenal.', { fleets });
    }
  }
  const up = await prisma.gpsDevice.update({ where: { id }, data: { fleetId, fleetSource: fleetId ? 'manual' : 'derived' } });
  return deviceClient(up);
}

module.exports = { listDevices, syncDevices, setDeviceFleet, deriveFleet, fleetTokenOf, knownFleets, deviceClient };
