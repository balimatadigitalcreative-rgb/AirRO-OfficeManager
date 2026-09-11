'use strict';
// FLEET GPS (Cartrack) — device↔armada mapping + timezone-correct position ingest.
//
// THE TIMEZONE TEST IS THE POINT: the two real vehicles report DIFFERENT default_timezone values
// (Merah null, Biru "Asia/Bangkok") while both drive in Bali (WITA, UTC+8). If a Bangkok wall clock
// were stored or rendered as-is, "posisi terakhir X menit lalu" would be silently ONE HOUR wrong.
// So: every stamp is normalised to a UTC instant on ingest, and rendered in the app timezone.
//
// Fake credentials below so `configured()` is true — the provider is stubbed, nothing is called.
process.env.CARTRACK_USERNAME = 'test-user';
process.env.CARTRACK_PASSWORD = 'test-pass';
process.env.CARTRACK_TZ = 'Asia/Bangkok';   // the zone WE assume for a NAIVE stamp (never the provider's field)
process.env.APP_TZ = 'Asia/Makassar';       // the business runs in Bali

const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const cartrack = require('../src/services/cartrack.service');
const gps = require('../src/services/gps.service');
const { formatInTz, todayISO, parseProviderTs } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

// The two REAL vehicles, exactly as the provider names them, plus one that maps to no armada.
const VEHICLES = () => ([
  { vehicle_id: 452461087, registration: 'DK8919AQ', vehicle_name: 'DK8919AQ (MERAH)', default_timezone: null,
    latitude: -8.65, longitude: 115.21, speed: 32, event_ts: '2026-09-12 14:30:00' },                     // NAIVE → assumed Bangkok
  { vehicle_id: 452461090, registration: 'DK8184AP', vehicle_name: 'DK8184AP (BIRU)', default_timezone: 'Asia/Bangkok',
    latitude: -8.66, longitude: 115.22, speed: 0, event_ts: '2026-09-12 14:30:00+07:00' },                // EXPLICIT offset
  { vehicle_id: 999999999, registration: 'DK0000XX', vehicle_name: 'DK0000XX (KUNING)', default_timezone: null },
]);

let gm, devices;
const stub = (rows) => { cartrack.listVehicles = async () => cartrack.unwrapList(rows).map(cartrack.normalizeVehicle).filter((v) => v.vehicleId); };
const stubStatus = (rows) => { cartrack.listStatuses = async () => cartrack.unwrapList(rows).map(cartrack.normalizeStatus).filter((v) => v.vehicleId); };

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_gps', password: 'secret123', role: 'gm' })).token;
  // The armada list the app knows about (Kelola Armada). KUNING is deliberately absent.
  await require('../src/services/settings.service').set('airro_fleet', ['Merah', 'Biru']);
  stub(VEHICLES());
  stubStatus([]);        // default: no live feed, so these cases exercise the identity rows
});
afterAll(() => prisma.$disconnect());

describe('seeding the mapping from vehicle_name', () => {
  it('derives the armada from the (MERAH)/(BIRU) suffix', async () => {
    const r = await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ total: 3, created: 3 });
    devices = r.body.data.data;
    const merah = devices.find((d) => d.vehicleId === '452461087');
    const biru = devices.find((d) => d.vehicleId === '452461090');
    expect(merah).toMatchObject({ registration: 'DK8919AQ', fleetId: 'Merah', fleetSource: 'derived', unmapped: false });
    expect(biru).toMatchObject({ registration: 'DK8184AP', fleetId: 'Biru', fleetSource: 'derived', unmapped: false });
  });

  it('a vehicle that maps to NO armada is reported, never dropped', async () => {
    const r = await request(app).get('/api/v1/gps/devices').set(auth(gm));
    expect(r.body.data).toHaveLength(3);                       // still listed
    expect(r.body.unmapped).toHaveLength(1);                   // …and surfaced for the UI warning
    expect(r.body.unmapped[0]).toMatchObject({ vehicleName: 'DK0000XX (KUNING)' });
    expect(r.body.configured).toBe(true);
    expect(r.body.appTz).toBe('Asia/Makassar');
  });
});

describe('the mapping stays EDITABLE and survives a provider rename', () => {
  it('a hand-set armada marks the row manual', async () => {
    const unmapped = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.unmapped[0];
    const r = await request(app).patch(`/api/v1/gps/devices/${unmapped.id}/fleet`).set(auth(gm)).send({ fleetId: 'Biru' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ fleetId: 'Biru', fleetSource: 'manual', unmapped: false });
  });

  it('an unknown armada is rejected', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data[0];
    const r = await request(app).patch(`/api/v1/gps/devices/${d.id}/fleet`).set(auth(gm)).send({ fleetId: 'Ungu' });
    expect(r.status).toBe(400);
  });

  it('re-syncing does NOT overwrite the manual mapping, even when the vehicle is RENAMED', async () => {
    // The provider renames the vehicle so its suffix would now derive nothing at all.
    const renamed = VEHICLES();
    renamed[2].vehicle_name = 'DK0000XX';            // suffix gone entirely
    renamed[0].vehicle_name = 'DK8919AQ (MERAH)';
    stub(renamed);
    const r = await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    expect(r.body.data.keptManual).toBe(1);
    const after = r.body.data.data.find((d) => d.vehicleId === '999999999');
    expect(after).toMatchObject({ fleetId: 'Biru', fleetSource: 'manual' });   // link intact
    expect(after.vehicleName).toBe('DK0000XX');                                // name did update
  });

  it('clearing the mapping returns the row to derived so a sync may seed it again', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '999999999');
    const r = await request(app).patch(`/api/v1/gps/devices/${d.id}/fleet`).set(auth(gm)).send({ fleetId: '' });
    expect(r.body.data).toMatchObject({ fleetId: '', fleetSource: 'derived', unmapped: true });
  });
});

describe('TIMEZONE — a Bangkok-stamped payload must display as Bali time', () => {
  // 14:30 in Bangkok (UTC+7) is 07:30 UTC, which is 15:30 in Bali (UTC+8).
  const EXPECTED_UTC = '2026-09-12T07:30:00.000Z';
  const EXPECTED_BALI = '2026-09-12, 15:30';

  it('an EXPLICIT +07:00 offset is used as-is and renders +1h in Bali', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461090');
    expect(new Date(d.fixAt).toISOString()).toBe(EXPECTED_UTC);
    expect(d.fixAssumedTz).toBe('');                       // self-describing: nothing was assumed
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).toBe(EXPECTED_BALI);
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).not.toContain('14:30');   // the drift this test exists to catch
  });

  it('a NAIVE stamp is interpreted in the CONFIGURED zone, not the provider field', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461087');
    expect(new Date(d.fixAt).toISOString()).toBe(EXPECTED_UTC);
    expect(d.fixAssumedTz).toBe('Asia/Bangkok');           // recorded, so the assumption is auditable
    expect(d.fixRaw).toBe('2026-09-12 14:30:00');          // raw string kept verbatim
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).toBe(EXPECTED_BALI);
  });

  it("the provider's default_timezone is NOT what drives the maths", async () => {
    // Merah reports null and Biru reports Asia/Bangkok, yet both fixes land on the SAME UTC instant —
    // proof the provider's field was never consulted.
    const list = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data;
    const merah = list.find((x) => x.vehicleId === '452461087');
    const biru = list.find((x) => x.vehicleId === '452461090');
    expect(merah.providerTz).toBe('');                     // null from the provider
    expect(biru.providerTz).toBe('Asia/Bangkok');
    expect(merah.fixAt).toBe(biru.fixAt);
  });

  it('"X menit lalu" is computed from the UTC instant, so it cannot drift an hour', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461090');
    const now = new Date('2026-09-12T07:45:00.000Z');      // 15 minutes after the fix
    expect(Math.round((now.getTime() - d.fixAt) / 60000)).toBe(15);
  });

  it('a TWO-DIGIT offset ("+08") is an offset, NOT a naive stamp', () => {
    // Cartrack stamps its fixes this way. A pattern demanding +HH:MM misses it, the stamp is taken for
    // naive, and CARTRACK_TZ is applied on top of an offset that was already there. Read as naive it
    // would be 13:30 WITA here, or 20:30 with the UTC default — from a vehicle that reported 12:30.
    const t = parseProviderTs('2026-09-11 12:30:05+08', 'Asia/Bangkok');
    expect(t.assumedTz).toBe('');
    expect(t.at.toISOString()).toBe('2026-09-11T04:30:05.000Z');
    expect(formatInTz(t.at, 'Asia/Makassar')).toBe('2026-09-11, 12:30');
  });

  it('+0800 and +08:00 are the same instant as +08', () => {
    const iso = (x) => parseProviderTs(x, 'UTC').at.toISOString();
    expect(iso('2026-09-11 12:30:05+0800')).toBe('2026-09-11T04:30:05.000Z');
    expect(iso('2026-09-11 12:30:05+08:00')).toBe('2026-09-11T04:30:05.000Z');
    expect(iso('2026-09-11T04:30:05Z')).toBe('2026-09-11T04:30:05.000Z');
  });

  it('a stamp with no offset and no configured zone falls back to UTC, and says so', () => {
    const t = parseProviderTs('2026-09-12 14:30:00', 'UTC');
    expect(t.at.toISOString()).toBe('2026-09-12T14:30:00.000Z');
    expect(t.assumedTz).toBe('UTC');
  });
});

describe('the business day is the APP timezone, not the host clock', () => {
  it('23:30 UTC is already TOMORROW in Bali', () => {
    // This is the 00:00–08:00 WITA window where the old toISOString().slice(0,10) returned yesterday.
    expect(todayISO(new Date('2026-09-11T23:30:00Z'))).toBe('2026-09-12');
    expect(todayISO(new Date('2026-09-12T15:00:00Z'))).toBe('2026-09-12');
  });
});

// /vehicles carries NO position on this tenant — every device read "belum ada posisi" until the probe
// found the fix in /vehicles/status, nested inside `location` and stamped with a two-digit offset.
describe('the position feed lives in /vehicles/status', () => {
  // The provider's real payload, field-for-field.
  const STATUS = () => ([
    { vehicle_id: 452461087, registration: 'DK8919AQ', event_ts: '2026-09-12 16:30:05+08', speed: 44, bearing: 351,
      ignition: true, idling: false, odometer: 111121900, road_speed: 50,
      location: { latitude: -8.6712, longitude: 115.2126, address: 'Jl. Raya Kerobokan' } },
    { vehicle_id: 452461090, registration: 'DK8184AP', event_ts: '2026-09-12 16:21:19+08', speed: 0, bearing: 48,
      ignition: false, idling: false, odometer: 113936300, road_speed: 50,
      location: { latitude: -8.6500, longitude: 115.2167, address: 'Jl. Sunset Road' } },
  ]);

  it('a sync takes the fix from the status feed and the identity from /vehicles', async () => {
    stubStatus(STATUS());
    const r = await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ positionFeed: true, positioned: 2 });
    const merah = r.body.data.data.find((d) => d.vehicleId === '452461087');
    expect(merah).toMatchObject({ registration: 'DK8919AQ', lat: -8.6712, lng: 115.2126, speedKph: 44 });
  });

  it('coordinates nested inside `location` are found, not silently dropped', async () => {
    const list = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data;
    const biru = list.find((d) => d.vehicleId === '452461090');
    expect(biru.lat).toBe(-8.65);
    expect(biru.lng).toBe(115.2167);
    expect(biru.speedKph).toBe(0);            // parked is a real reading, not a missing one
  });

  it('the "+08" stamp renders as the SAME wall clock in Bali, not eight hours later', async () => {
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461087');
    expect(new Date(d.fixAt).toISOString()).toBe('2026-09-12T08:30:05.000Z');
    expect(d.fixAssumedTz).toBe('');                                   // the offset was honoured
    expect(d.fixRaw).toBe('2026-09-12 16:30:05+08');
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).toBe('2026-09-12, 16:30');
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).not.toContain('00:30');   // the UTC-assumed reading
    expect(formatInTz(d.fixAt, 'Asia/Makassar')).not.toContain('17:30');   // the Bangkok-assumed one
  });

  it('an OLDER reading never moves the position backwards', async () => {
    // Out-of-order rows happen. Accepting one would draw the vehicle jumping to where it was an hour
    // ago, which looks exactly like real movement.
    stubStatus([{ vehicle_id: 452461087, registration: 'DK8919AQ', event_ts: '2026-09-12 09:00:00+08',
                  speed: 12, location: { latitude: -8.9999, longitude: 115.9999 } }]);
    await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    const d = (await request(app).get('/api/v1/gps/devices').set(auth(gm))).body.data.find((x) => x.vehicleId === '452461087');
    expect(d.lat).toBe(-8.6712);                                      // the 16:30 fix still stands
    expect(new Date(d.fixAt).toISOString()).toBe('2026-09-12T08:30:05.000Z');
  });

  it('a broken position feed still syncs the MAPPING instead of failing the whole call', async () => {
    // The REAL tenant shape: /vehicles is identity only, so an outage leaves nothing to fall back on
    // and the last good fix must simply stand.
    stub(VEHICLES().map((v) => { const c = Object.assign({}, v); delete c.latitude; delete c.longitude; delete c.speed; delete c.event_ts; return c; }));
    const good = cartrack.listStatuses;
    cartrack.listStatuses = async () => { throw new Error('404 Not Found'); };
    const r = await request(app).post('/api/v1/gps/sync').set(auth(gm)).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.positionFeed).toBe(false);        // reported, so the UI can say why
    const merah = r.body.data.data.find((d) => d.vehicleId === '452461087');
    expect(merah.fleetId).toBe('Merah');                 // mapping intact
    expect(merah.lat).toBe(-8.6712);                     // last good fix NOT blanked by the outage
    cartrack.listStatuses = good;
  });
});

describe('not configured degrades, never throws', () => {
  it('reports configured:false instead of failing the request', async () => {
    const realUser = process.env.CARTRACK_USERNAME;
    const spy = cartrack.configured;
    cartrack.configured = () => false;
    const r = await request(app).get('/api/v1/gps/devices').set(auth(gm));
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    cartrack.configured = spy; process.env.CARTRACK_USERNAME = realUser;
  });
});
