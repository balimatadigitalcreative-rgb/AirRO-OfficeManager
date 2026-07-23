'use strict';
// Toggle a transaction between ACTIVE and ARCHIVE (legacy). Flipping the flag must recompute every
// downstream aggregate consistently: archive → the row stops counting (sisa bon / KPIs drop, gallon
// movements reversed); active → it counts again (movements restored, or none for imported rows). A
// reason is required, each toggle is audited, and the cap (distribusiLegacyImport) is enforced.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const sisaBon = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data.sisaBon;
const gallonOwned = async (t) => (await request(app).get('/api/v1/distribusi/gallon?fleet=Merah').set(auth(t))).body.data.stock.totalOwned;
const archive = (t, id, legacy, reason) => request(app).post(`/api/v1/distribusi/transactions/${id}/archive`).set(auth(t)).send({ legacy, reason });

let gm, cid, bonId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_arc', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'C', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  // a REAL bon sale: 5 gallons out → adds 30,000 to sisa bon + writes a gallon movement
  bonId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-03-01', gallonOut: 5 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — archive/active toggle', () => {
  it('archiving an active BON drops sisa bon, reverses its gallon movement, and is audited', async () => {
    expect(await sisaBon(gm, cid)).toBe(30000);
    const movesBefore = await prisma.gallonMovement.count({ where: { transactionId: bonId, active: true } });
    expect(movesBefore).toBeGreaterThanOrEqual(1);

    const r = await archive(gm, bonId, true, 'salah input');   // default: sisa bon NOT kept → drops
    expect(r.status).toBe(200);
    expect(r.body.data.legacy).toBe(true);
    expect(await sisaBon(gm, cid)).toBe(0);                    // no longer a receivable
    // its gallon movements are deactivated → the customer's held balance reverts (delivery_out reversed)
    expect(await prisma.gallonMovement.count({ where: { transactionId: bonId, active: true } })).toBe(0);
    expect(r.body.data.gallonsHeld).toBe(0);                   // the 5 gallons the sale moved are un-moved
    const audit = (await request(app).get('/api/v1/distribusi/audit').set(auth(gm))).body.data;
    expect(audit.some((a) => /Jadikan arsip/i.test(a.title) && /aktif → arsip/.test(a.detail) && /salah input/.test(a.detail))).toBe(true);
  });

  it('un-archiving restores counting: sisa bon rises again and the movement is reactivated', async () => {
    const r = await archive(gm, bonId, false, 'ternyata transaksi asli');
    expect(r.status).toBe(200);
    expect(r.body.data.legacy).toBe(false);
    expect(await sisaBon(gm, cid)).toBe(30000);               // receivable back
    expect(await prisma.gallonMovement.count({ where: { transactionId: bonId, active: true } })).toBeGreaterThanOrEqual(1);
    const audit = (await request(app).get('/api/v1/distribusi/audit').set(auth(gm))).body.data;
    expect(audit.some((a) => /Jadikan aktif/i.test(a.title) && /arsip → aktif/.test(a.detail))).toBe(true);
  });

  it('an imported (legacy) row promoted to active counts for money but fabricates NO gallon stock', async () => {
    const imp = await request(app).post(`/api/v1/distribusi/customers/${cid}/transactions/import`).set(auth(gm))
      .send({ rows: [{ txnDate: '2026-02-01', price: 6000, bonQty: 4 }] });   // legacy bon 24,000
    const impId = (await prisma.distTransaction.findFirst({ where: { importBatchId: imp.body.batchId } })).id;
    const bonAfterImport = await sisaBon(gm, cid);   // 30,000 + 24,000 = 54,000 (legacy bon counts too)
    const ownedBefore = await gallonOwned(gm);
    const r = await archive(gm, impId, false, 'baris asli');   // promote to active
    expect(r.status).toBe(200);
    expect(await sisaBon(gm, cid)).toBe(bonAfterImport);       // money unchanged (bon already counted)
    expect(await gallonOwned(gm)).toBe(ownedBefore);           // NO phantom stock (import had no gallon data)
    expect(await prisma.gallonMovement.count({ where: { transactionId: impId } })).toBe(0);
  });

  it('archiving with bonCounted=true KEEPS the row counting toward sisa bon (the per-action choice)', async () => {
    const c3 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'C3', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    const id3 = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c3, qty: 2, method: 'bon', txnDate: '2026-03-06' })).body.data.id;   // 12,000 bon
    expect(await sisaBon(gm, c3)).toBe(12000);
    // archive but KEEP it as a receivable → legacy (out of KPIs/gallons/cash) yet sisa bon unchanged
    const keep = await request(app).post(`/api/v1/distribusi/transactions/${id3}/archive`).set(auth(gm)).send({ legacy: true, bonCounted: true, reason: 'sembunyikan dari laporan, tetap piutang' });
    expect(keep.status).toBe(200);
    expect(keep.body.data).toMatchObject({ legacy: true, bonCounted: true });
    expect(await sisaBon(gm, c3)).toBe(12000);   // still an outstanding receivable despite being archived
  });

  it('reason required; a voided row cannot be toggled; cap enforced (403)', async () => {
    expect((await archive(gm, bonId, true, '')).status).toBe(400);   // no reason
    // void a fresh sale, then try to archive it → rejected
    const v = (await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 1, method: 'lunas', txnDate: '2026-03-02' })).body.data.id;
    await request(app).post(`/api/v1/distribusi/transactions/${v}/void`).set(auth(gm)).send({ reason: 'x' });
    expect((await archive(gm, v, true, 'coba')).status).toBe(400);
    // a user WITHOUT distribusiLegacyImport → 403
    const u = await reg({ name: 'NoCap', username: 'nocap_arc', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiLegacyImport: false } });
    const t = await login('nocap_arc', 'secret123');
    expect((await archive(t, bonId, true, 'coba')).status).toBe(403);
  });
});
