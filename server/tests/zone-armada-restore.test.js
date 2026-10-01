'use strict';
// "KEMBALIKAN ARMADA SEBELUM ZONA" (owner request 2026-10-01): zones moved many customers to another
// armada. The armada a customer had before the zones is read from their own history — every transaction
// keeps the armada it was input under (immutable), and a delivery stop keeps the armada it ran on — the
// newest entry from before the first zone wins. The owner sees the list (current → before), unticks
// any, and applies: those customers get their armada back, every zone stops setting an armada (days are
// untouched), audited. Customers taken out of their zone by hand are left alone.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const R = `${D}/zones/armada-restore`;
const NORTH = [[-8.60, 115.20], [-8.60, 115.21], [-8.61, 115.21], [-8.61, 115.20]];
const IN_N = { lat: -8.605, lng: 115.205 };
const OUTSIDE = { lat: -8.70, lng: 115.30 };
const today = todayISO();
const ago = (n) => { const d = new Date(today + 'T00:00'); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const get = (id) => prisma.customer.findUnique({ where: { id } });
let gm, scoped, A, B, C, Dd, E, F, zoneId;

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'zr_gm', password: 'secret123', role: 'gm' })).body.token;
  const s = (await request(app).post('/api/v1/auth/register').send({ name: 'Admin DK1', username: 'zr_sc', password: 'secret123', role: 'gm' })).body;
  await prisma.user.update({ where: { id: s.user.id }, data: { fleetScope: JSON.stringify(['DK 1']) } });
  scoped = (await request(app).post('/api/v1/auth/login').send({ username: 'zr_sc', password: 'secret123' })).body.token;
  const mk = async (name, loc, armada) => (await request(app).post(`${D}/customers`).set(auth(gm))
    .send(Object.assign({ name, type: 'reguler', masterPrice: 6000, armada, deliveryDays: ['Sen'] }, loc))).body.data.id;
  const sale = (customerId, txnDate) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId, qty: 1, method: 'lunas', txnDate });
  A = await mk('Ani', IN_N, 'DK 1'); await sale(A, ago(3));
  B = await mk('Budi', IN_N, 'DK 2'); await sale(B, ago(5));
  C = await mk('Cici (tanpa riwayat)', IN_N, 'DK 1');
  Dd = await mk('Dodi (luar zona)', OUTSIDE, 'DK 1'); await sale(Dd, ago(2));
  // Eka: bought on DK 3, then moved to DK 4 by hand — yesterday's stop ran on DK 4 (newest wins)
  E = await mk('Eka', IN_N, 'DK 3'); await sale(E, ago(4));
  await request(app).patch(`${D}/customers/${E}`).set(auth(gm)).send({ armada: 'DK 4' });
  await prisma.delivery.create({ data: { date: ago(1), customerId: E, source: 'jadwal', fleetId: 'DK 4', status: 'terkirim', seq: 0 } });
  F = await mk('Fani', IN_N, 'DK 2'); await sale(F, ago(2));
  await new Promise((r) => setTimeout(r, 1100));   // the zone is created strictly after that history
  zoneId = (await request(app).post(`${D}/zones`).set(auth(gm)).send({ name: 'Utara', polygon: NORTH, armada: 'DK 5', deliveryDays: ['Jum'] })).body.data.zone.id;
  await sale(A, today);   // after the zone: input under DK 5 — must not count as "before"
  // Fani was taken out of the zone by hand and given her own armada — a newer hand change
  await request(app).post(`${D}/zones/assign`).set(auth(gm)).send({ customerId: F, zoneId: null });
  await request(app).patch(`${D}/customers/${F}`).set(auth(gm)).send({ armada: 'DK 7' });
});
afterAll(() => prisma.$disconnect());

it('the zone really moved them (setup)', async () => {
  for (const id of [A, B, C, E]) expect((await get(id)).armada).toBe('DK 5');
  expect((await get(F)).armada).toBe('DK 7');
});

it('preview: current → before for each zoned customer, from their newest history before the first zone', async () => {
  const r = await request(app).get(R).set(auth(gm));
  expect(r.status).toBe(200);
  const d = r.body.data;
  expect(d.since).toBeTruthy();
  const row = (id) => d.rows.find((x) => x.id === id);
  expect(row(A)).toMatchObject({ name: 'Ani', zone: 'Utara', now: 'DK 5', before: 'DK 1', from: { kind: 'transaksi', date: ago(3) } });
  expect(row(B)).toMatchObject({ now: 'DK 5', before: 'DK 2' });
  expect(row(E)).toMatchObject({ before: 'DK 4', from: { kind: 'pengiriman', date: ago(1) } });
  expect(row(Dd)).toBeUndefined();                                   // never in a zone, unchanged
  expect(row(F)).toBeUndefined();                                    // taken out of the zone by hand
  expect(d.unknown.map((x) => x.id)).toEqual([C]);                   // no history before the zone
  expect(d.zonesWithArmada).toBe(1);
  expect((await get(A)).armada).toBe('DK 5');                        // preview wrote nothing
});

it('only an unscoped zone manager may use it', async () => {
  expect((await request(app).get(R).set(auth(scoped))).status).toBe(403);
  expect((await request(app).post(R).set(auth(scoped)).send({ ids: [A] })).status).toBe(403);
});

it('apply: the ticked customers get their armada back, zones stop setting an armada (days kept), audited', async () => {
  const r = await request(app).post(R).set(auth(gm)).send({ ids: [A, B, F] });   // Eka unticked; Fani is not offered → ignored
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ restored: 2, zones: 1 });
  expect((await get(A)).armada).toBe('DK 1'); expect((await get(B)).armada).toBe('DK 2');
  expect((await get(E)).armada).toBe('DK 5'); expect((await get(F)).armada).toBe('DK 7');
  expect(JSON.parse((await get(A)).deliveryDays)).toEqual(['Jum']);   // days untouched
  expect((await get(A)).zoneId).toBe(zoneId);                         // still grouped on the map
  const z = await prisma.distZone.findUnique({ where: { id: zoneId } });
  expect(z.armada).toBe(''); expect(JSON.parse(z.deliveryDays)).toEqual(['Jum']);
  expect(await prisma.distAuditLog.count({ where: { title: { startsWith: 'Armada dikembalikan' } } })).toBe(3);   // 2 customers + summary
  // a later zone edit does not move them again
  await request(app).put(`${D}/zones/${zoneId}`).set(auth(gm)).send({ name: 'Utara (lama)' });
  expect((await get(A)).armada).toBe('DK 1');
});

it('the unticked customer can still be restored later; a restored one is no longer listed', async () => {
  const d = (await request(app).get(R).set(auth(gm))).body.data;
  expect(d.rows.map((x) => x.id)).toEqual([E]);
  await request(app).post(R).set(auth(gm)).send({ ids: [E] });
  expect((await get(E)).armada).toBe('DK 4');
});
