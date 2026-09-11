'use strict';
/*
 * CARTRACK PROBE — read-only discovery of where the last-known position actually lives.
 *
 *   cd /var/www/airrooffice/server && node scripts/cartrack-probe.js
 *
 * WHY: /vehicles returns 200 but carries no position fields for this tenant, so devices show
 * "belum ada posisi". Cartrack's field names and endpoint set vary between tenants, and guessing in
 * application code is how a silent wrong-field bug gets shipped. This asks the provider instead.
 *
 * It issues GET requests ONLY — no writes, no deletes, nothing that can change fleet state. It prints
 * the field names it finds so the client can be pointed at the right ones, and it NEVER prints the
 * username, password or Authorization header.
 *
 * Paste the output back. Coordinates of your own vehicles will appear in it; nothing else leaves here.
 */
const config = require('../src/config/env');

const BASE = config.cartrack.baseUrl;
const AUTH = 'Basic ' + Buffer.from(config.cartrack.username + ':' + config.cartrack.password, 'utf8').toString('base64');

if (!config.cartrack.username || !config.cartrack.password) {
  console.error('CARTRACK_USERNAME / CARTRACK_PASSWORD are not set in server/.env — nothing to probe.');
  process.exit(1);
}

// Anything whose NAME looks like a position or a clock is printed in full: those are the values we are
// here to identify. Everything else is truncated — a probe should not dump the whole fleet record.
const INTERESTING = /(lat|lon|lng|pos|coord|geo|speed|head|bearing|odo|ign|time|ts$|_ts|date|stamp|updated|event|fix|zone|tz)/i;

const trunc = (v) => {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') return Array.isArray(v) ? `[array ${v.length}]` : `{object ${Object.keys(v).slice(0, 6).join(',')}}`;
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
};

async function GET(path) {
  const url = BASE + (path.startsWith('/') ? path : '/' + path);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.cartrack.timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: AUTH, Accept: 'application/json' }, signal: ctl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* not JSON — status still tells us something */ }
    return { status: res.status, body, raw: text.slice(0, 160) };
  } catch (e) {
    return { status: 0, err: e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const k of ['data', 'vehicles', 'results', 'items', 'positions', 'status']) {
      if (Array.isArray(body[k])) return body[k];
    }
    // A single object that itself looks like a record.
    if (Object.keys(body).some((k) => INTERESTING.test(k))) return [body];
  }
  return [];
}

function describe(label, r) {
  if (r.status !== 200) {
    console.log(`  ${label.padEnd(34)} ${r.status || 'ERR'} ${r.err || (r.raw ? r.raw.replace(/\s+/g, ' ').slice(0, 70) : '')}`);
    return null;
  }
  const rows = rowsOf(r.body);
  const shape = Array.isArray(r.body) ? `array(${r.body.length})` : `{${Object.keys(r.body || {}).slice(0, 8).join(',')}}`;
  console.log(`  ${label.padEnd(34)} 200  ${shape}  rows=${rows.length}`);
  return rows;
}

function dumpRow(row) {
  const keys = Object.keys(row);
  const hot = keys.filter((k) => INTERESTING.test(k));
  console.log('    ALL KEYS : ' + keys.join(', '));
  if (hot.length) {
    console.log('    POSITION / TIME FIELDS:');
    for (const k of hot) console.log(`      ${k.padEnd(28)} = ${trunc(row[k])}`);
  } else {
    console.log('    (no key name looks like a position or a timestamp)');
  }
  // ONE LEVEL DOWN. The first run of this probe printed `location` as a bare key and stopped there —
  // the coordinates were inside it all along. A nested object is exactly where a fix tends to hide.
  for (const k of keys) {
    const v = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = Object.keys(v);
      if (inner.length) console.log(`    ${k}.* : ` + inner.map((ik) => `${ik}=${trunc(v[ik])}`).join('  '));
    } else if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      console.log(`    ${k}[0].* : ` + Object.keys(v[0]).map((ik) => `${ik}=${trunc(v[0][ik])}`).join('  '));
    }
  }
}

(async () => {
  console.log('BASE = ' + BASE + '   (credentials present, never printed)\n');

  // ── 1. Does /vehicles itself carry a fix under a name we do not recognise? ────────────────────
  console.log('1. GET /vehicles — the endpoint we already use');
  const veh = describe('/vehicles', await GET('/vehicles'));
  let vid = null;
  if (veh && veh.length) {
    vid = veh[0].vehicle_id || veh[0].vehicleId || veh[0].id;
    dumpRow(veh[0]);
  }
  console.log('');

  // ── 2. Where else might the last fix live? ────────────────────────────────────────────────────
  const CANDIDATES = [
    '/vehicles/status', '/vehicles/statuses', '/vehicles/positions', '/vehicles/position',
    '/vehicles/locations', '/vehicles/location', '/vehicles/last-position', '/vehicles/latest',
    '/status', '/positions', '/fleet/status', '/vehicles/status/latest',
  ];
  console.log('2. Fleet-wide position endpoints');
  const hits = [];
  for (const p of CANDIDATES) {
    const rows = describe(p, await GET(p));
    if (rows && rows.length) hits.push([p, rows]);
  }
  console.log('');

  // ── 3. Per-vehicle variants, using the first real vehicle id. ─────────────────────────────────
  if (vid) {
    console.log(`3. Per-vehicle endpoints (vehicle_id ${vid})`);
    for (const p of [`/vehicles/${vid}/status`, `/vehicles/${vid}/position`, `/vehicles/${vid}/positions`,
                     `/vehicles/${vid}/location`, `/vehicles/${vid}/last-position`, `/vehicles/${vid}`]) {
      const rows = describe(p, await GET(p));
      if (rows && rows.length) hits.push([p, rows]);
    }
    console.log('');
  }

  // ── 4. Full field dump for whatever answered. ─────────────────────────────────────────────────
  if (!hits.length) {
    console.log('NOTHING returned a usable row. Paste the status codes above — a 404 everywhere means the\n' +
                'position feed is a different product on the account; a 401/403 means it needs a scope the\n' +
                'current credentials lack.');
  } else {
    console.log('4. Field names of every endpoint that answered — this is what the client gets pointed at');
    for (const [p, rows] of hits) {
      console.log('\n  ── ' + p + '  (' + rows.length + ' rows)');
      dumpRow(rows[0]);
      if (rows.length > 1) { console.log('    second row, for comparison:'); dumpRow(rows[1]); }
    }
    console.log('\nNOTE the exact SPELLING of the timestamp field and whether its value carries an offset\n' +
                '(…+07:00 / …Z) or is naive (“2026-09-12 14:30:00”). That decides CARTRACK_TZ.');
  }
})();
