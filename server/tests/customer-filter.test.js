'use strict';
// Detailed multi-criteria customer filter (AND logic, all optional), applied SERVER-side so a
// large dataset is never shipped to the client. Also pins fleetScope enforcement and the
// "Menampilkan X dari Y" counts.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const list = (t, qs) => request(app).get('/api/v1/distribusi/customers' + (qs ? '?' + qs : '')).set(auth(t));
const names = (r) => r.body.data.map((c) => c.name).sort();

let gm, scoped;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'cf_gm', password: 'secret123', role: 'gm' })).token;

  const mk = (o) => prisma.customer.create({ data: {
    name: o.name, phone: o.phone || '', type: o.type || 'reguler', masterPrice: o.price || 6000,
    armada: o.armada || '', deliveryDays: JSON.stringify(o.days || []), mapsUrl: o.maps || '',
    lat: o.lat != null ? o.lat : null, lng: o.lng != null ? o.lng : null, active: o.active !== false,
  } });

  // A: kos, Merah, has bon, complete, Sen+Rab
  const a = await mk({ name: 'A Kos Merah', phone: '081200000001', type: 'kos', armada: 'Merah', days: ['Sen', 'Rab'], maps: 'https://maps.google.com/?q=1,1', price: 6000 });
  // B: kos, Merah, NO bon, INCOMPLETE (no phone), Sen
  await mk({ name: 'B Kos Merah Belum', phone: '', type: 'kos', armada: 'Merah', days: ['Sen'], maps: 'https://maps.google.com/?q=2,2', price: 7000 });
  // C: kos, Biru, has bon
  const c = await mk({ name: 'C Kos Biru', phone: '081200000003', type: 'kos', armada: 'Biru', days: ['Sel'], lat: -8.6, lng: 115.2, price: 8000 });
  // D: cafe, Merah, has bon, no location at all
  const d = await mk({ name: 'D Cafe Merah', phone: '081200000004', type: 'cafe', armada: 'Merah', days: ['Sen', 'Jum'], price: 9000 });
  // E: reguler, Merah, deactivated
  await mk({ name: 'E Reguler Nonaktif', phone: '081200000005', type: 'reguler', armada: 'Merah', active: false, price: 5000 });

  // give A, C, D an outstanding bon (A=50k, C=10k, D=200k)
  const bon = (cust, amount) => prisma.distTransaction.create({ data: { customerId: cust.id, fleetId: cust.armada, qty: 1, unitPriceLocked: amount, amount, method: 'bon', txnDate: '2026-07-01' } });
  await bon(a, 50000); await bon(c, 10000); await bon(d, 200000);

  // a fleet-scoped user (Merah only) to prove scope is enforced under filtering
  const s = await reg({ name: 'Scoped', username: 'cf_scope', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { fleetScope: JSON.stringify(['Merah']), permissions: JSON.stringify({ distribusi: true, distribusiCustomers: true }) } });
  scoped = (await request(app).post('/api/v1/auth/login').send({ username: 'cf_scope', password: 'secret123' })).body.token;
});
afterAll(() => prisma.$disconnect());

describe('customer filter — single criteria', () => {
  it('returns everything active by default, with the total for "X dari Y"', async () => {
    const r = await list(gm);
    expect(r.status).toBe(200);
    expect(names(r)).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'C Kos Biru', 'D Cafe Merah']);   // E is inactive
    expect(r.body.total).toBe(5);          // denominator = everything in scope, any status
    expect(r.body.filtered).toBe(4);
  });

  it('tipe (multi-select)', async () => {
    expect(names(await list(gm, 'types=kos'))).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'C Kos Biru']);
    expect(names(await list(gm, 'types=kos,cafe'))).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'C Kos Biru', 'D Cafe Merah']);
  });

  it('armada', async () => {
    expect(names(await list(gm, 'fleet=Biru'))).toEqual(['C Kos Biru']);
  });

  it('status aktif / nonaktif', async () => {
    expect(names(await list(gm, 'status=inactive'))).toEqual(['E Reguler Nonaktif']);
    expect((await list(gm, 'status=all')).body.data.length).toBe(5);
  });

  it('bon: ada / lunas / minimal Rp N', async () => {
    expect(names(await list(gm, 'bon=ada'))).toEqual(['A Kos Merah', 'C Kos Biru', 'D Cafe Merah']);
    expect(names(await list(gm, 'bon=lunas'))).toEqual(['B Kos Merah Belum']);
    expect(names(await list(gm, 'bonMin=50000'))).toEqual(['A Kos Merah', 'D Cafe Merah']);
    expect(names(await list(gm, 'bonMin=100000'))).toEqual(['D Cafe Merah']);
  });

  it('hari kirim — any (default) and all', async () => {
    expect(names(await list(gm, 'days=Sen'))).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'D Cafe Merah']);
    expect(names(await list(gm, 'days=Sen,Rab'))).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'D Cafe Merah']);   // any
    expect(names(await list(gm, 'days=Sen,Rab&daysMode=all'))).toEqual(['A Kos Merah']);                            // all
  });

  it('kelengkapan data (same rule as the completeness badge)', async () => {
    expect(names(await list(gm, 'complete=belum'))).toEqual(['B Kos Merah Belum', 'D Cafe Merah']);   // no phone / no location
    expect(names(await list(gm, 'complete=lengkap'))).toEqual(['A Kos Merah', 'C Kos Biru']);
  });

  it('punya lokasi (mapsUrl OR lat+lng)', async () => {
    expect(names(await list(gm, 'hasLocation=ya'))).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'C Kos Biru']);
    expect(names(await list(gm, 'hasLocation=tidak'))).toEqual(['D Cafe Merah']);
  });

  it('rentang harga master', async () => {
    expect(names(await list(gm, 'priceMin=7000'))).toEqual(['B Kos Merah Belum', 'C Kos Biru', 'D Cafe Merah']);
    expect(names(await list(gm, 'priceMin=7000&priceMax=8000'))).toEqual(['B Kos Merah Belum', 'C Kos Biru']);
  });

  it('search q matches name / code / phone (normalised)', async () => {
    expect(names(await list(gm, 'q=Cafe'))).toEqual(['D Cafe Merah']);
    expect(names(await list(gm, 'q=81200000001'))).toEqual(['A Kos Merah']);   // Excel-style, no leading 0
  });
});

describe('customer filter — combined (AND) + scope', () => {
  it('Tipe=Kos + Ada bon + Armada=Merah → only matching', async () => {
    const r = await list(gm, 'types=kos&bon=ada&fleet=Merah');
    expect(names(r)).toEqual(['A Kos Merah']);
    expect(r.body.filtered).toBe(1);
  });

  it('adding "Belum lengkap" narrows further (to none here)', async () => {
    expect(names(await list(gm, 'types=kos&bon=ada&fleet=Merah&complete=belum'))).toEqual([]);
    // and without the bon criterion it finds the incomplete kos on Merah
    expect(names(await list(gm, 'types=kos&fleet=Merah&complete=belum'))).toEqual(['B Kos Merah Belum']);
  });

  it('fleetScope is enforced regardless of the filter params', async () => {
    const all = await list(scoped);
    expect(names(all)).toEqual(['A Kos Merah', 'B Kos Merah Belum', 'D Cafe Merah']);   // no Biru
    expect(all.body.total).toBe(4);            // scoped denominator (Merah only, incl. inactive E)
    // asking for another fleet cannot escape the scope
    expect(names(await list(scoped, 'fleet=Biru'))).toEqual([]);
  });

  it('rejects an unknown filter value instead of silently ignoring it', async () => {
    expect((await list(gm, 'bon=maybe')).status).toBe(400);
    expect((await list(gm, 'complete=sort-of')).status).toBe(400);
  });
});
