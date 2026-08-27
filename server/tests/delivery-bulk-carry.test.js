'use strict';
// BULK carry-over of undelivered stops — multi-select "Kirim hari ini / Tunda / Batalkan" in one action.
// Reuses the outstanding rule + the single-row _carryToday core. Per-row fleet/scope guards, 100/batch cap,
// idempotent (no duplicate today stop), route-order seq, and an UNDO that restores the exact prior state.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const TODAY = iso(new Date());
const YEST = shift(-1);

const bulkCarry = (t, body) => request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-carry').set(auth(t)).send(body);
const preview = (t, body) => request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-carry/preview').set(auth(t)).send(body);
const bulkResolve = (t, body) => request(app).post('/api/v1/distribusi/deliveries/outstanding/bulk-resolve').set(auth(t)).send(body);
const undoCarry = (t, body) => request(app).post('/api/v1/distribusi/deliveries/outstanding/undo-carry').set(auth(t)).send(body);
const outstanding = (t, qs) => request(app).get('/api/v1/distribusi/deliveries/outstanding' + (qs ? '?' + qs : '')).set(auth(t));

let gm, staffBiru;
const mkCust = async (name, armada) => (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name, type: 'reguler', masterPrice: 10000, armada })).body.data.id;
const mkStop = (id, customerId, fleetId, date, status, extra) => prisma.delivery.create({ data: { id, customerId, fleetId, date, source: 'jadwal', status, seq: (extra && extra.seq) || 0, ...(extra || {}) } });
const todayTambahan = (customerId) => prisma.delivery.findMany({ where: { customerId, date: TODAY, source: 'tambahan' } });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_bulk', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Sopir Biru', username: 'staff_bulk', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }), fleetScope: JSON.stringify(['Biru']) } });
  staffBiru = await login('staff_bulk', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('bulk kirim hari ini — 5 stops in one action', () => {
  const ids = [];
  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) { const c = await mkCust('B' + i, 'Biru'); await mkStop('s' + i, c, 'Biru', YEST, 'pending'); ids.push('s' + i); }
  });
  it('carries exactly 5, removes 5 from the outstanding list, and re-running adds none', async () => {
    const r = await bulkCarry(gm, { ids, date: TODAY });
    expect(r.status).toBe(200);
    expect(r.body.data.added).toBe(5);
    expect(r.body.data.already).toBe(0);
    // 5 new today stops (one per customer), and all 5 originals gone from outstanding
    const outIds = (await outstanding(gm)).body.data.map((x) => x.id);
    ids.forEach((id) => expect(outIds).not.toContain(id));
    const todayCount = await prisma.delivery.count({ where: { date: TODAY, source: 'tambahan', status: 'pending' } });
    expect(todayCount).toBeGreaterThanOrEqual(5);
    // re-run: originals are settled → nothing added, no duplicates
    const again = await bulkCarry(gm, { ids, date: TODAY });
    expect(again.body.data.added).toBe(0);
  });
});

describe('idempotency — a customer already on today\'s route', () => {
  it('reports "sudah_ada" and never duplicates', async () => {
    const c = await mkCust('AlreadyToday', 'Biru');
    await mkStop('jToday', c, 'Biru', TODAY, 'pending');           // already scheduled today
    await mkStop('jOut', c, 'Biru', YEST, 'pending', { source: 'tambahan' });   // outstanding from yesterday
    const r = await bulkCarry(gm, { ids: ['jOut'], date: TODAY });
    expect(r.body.data.already).toBe(1);
    expect(r.body.data.added).toBe(0);
    expect((await todayTambahan(c)).length).toBe(0);              // no duplicate tambahan created
    expect((await prisma.delivery.findUnique({ where: { id: 'jOut' } })).status).toBe('batal');   // still resolved
  });
});

describe('guards', () => {
  it('a 101-row selection is refused with a clear message', async () => {
    const many = Array.from({ length: 101 }, (_, i) => 'x' + i);
    const r = await bulkCarry(gm, { ids: many });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/100/);
  });
  it('a row from another fleet is rejected server-side even in a crafted request', async () => {
    const cm = await mkCust('MerahCust', 'Merah');
    await mkStop('mRow', cm, 'Merah', YEST, 'pending');
    const r = await bulkCarry(staffBiru, { ids: ['mRow'], date: TODAY });
    expect(r.status).toBe(200);
    const row = r.body.data.results.find((x) => x.id === 'mRow');
    expect(row.status).toBe('gagal');
    // untouched: still outstanding, no today stop
    expect((await prisma.delivery.findUnique({ where: { id: 'mRow' } })).status).toBe('pending');
    expect((await todayTambahan(cm)).length).toBe(0);
  });
});

describe('undo restores the exact prior state', () => {
  it('removes the created stop and restores the outstanding row', async () => {
    const c = await mkCust('UndoCust', 'Biru');
    await mkStop('uRow', c, 'Biru', YEST, 'pending');
    const carried = await bulkCarry(gm, { ids: ['uRow'], date: TODAY });
    expect(carried.body.data.added).toBe(1);
    expect((await todayTambahan(c)).length).toBe(1);
    const undoPayload = carried.body.data.undo;
    expect(undoPayload).toBeTruthy();
    const u = await undoCarry(gm, undoPayload);
    expect(u.status).toBe(200);
    expect(u.body.data.restored).toBe(1);
    // exact prior state: original back to pending, the created today stop gone
    expect((await prisma.delivery.findUnique({ where: { id: 'uRow' } })).status).toBe('pending');
    expect((await todayTambahan(c)).length).toBe(0);
    // and it is outstanding again
    expect((await outstanding(gm)).body.data.map((x) => x.id)).toContain('uRow');
  });
});

describe('route seq follows the customers\' route order, not click order', () => {
  it('appends after today\'s max seq, in original route order', async () => {
    const cA = await mkCust('RouteA', 'Hijau'); await mkStop('rA', cA, 'Hijau', YEST, 'pending', { seq: 30 });
    const cB = await mkCust('RouteB', 'Hijau'); await mkStop('rB', cB, 'Hijau', YEST, 'pending', { seq: 10 });
    const cC = await mkCust('RouteC', 'Hijau'); await mkStop('rC', cC, 'Hijau', YEST, 'pending', { seq: 20 });
    // an existing TODAY stop on Hijau at seq 5 → new stops must start at 6
    const cx = await mkCust('RouteX', 'Hijau'); await mkStop('rX', cx, 'Hijau', TODAY, 'pending', { seq: 5 });
    // clicked out of route order (A=30, C=20, B=10) — result must still be route order B(10),C(20),A(30)
    const r = await bulkCarry(gm, { ids: ['rA', 'rC', 'rB'], date: TODAY });
    expect(r.body.data.added).toBe(3);
    const seqOf = async (cid) => (await prisma.delivery.findFirst({ where: { customerId: cid, date: TODAY, source: 'tambahan' } })).seq;
    const sB = await seqOf(cB), sC = await seqOf(cC), sA = await seqOf(cA);
    expect(sB).toBe(6); expect(sC).toBe(7); expect(sA).toBe(8);   // route order (10,20,30) → 6,7,8, not click order
  });
});

describe('bulk tunda / batalkan + preview', () => {
  it('preview reports willAdd + alreadyToday + per-fleet totals', async () => {
    const c = await mkCust('PrevCust', 'Biru'); await mkStop('pRow', c, 'Biru', YEST, 'pending');
    const r = await preview(gm, { ids: ['pRow'], date: TODAY });
    expect(r.status).toBe(200);
    expect(r.body.data.willAdd).toBe(1);
    expect(Array.isArray(r.body.data.fleets)).toBe(true);
  });
  it('bulk batal requires a reason and settles each row (audited per row)', async () => {
    const c = await mkCust('BatalCust', 'Biru'); await mkStop('xRow', c, 'Biru', YEST, 'pending');
    const noReason = await bulkResolve(gm, { ids: ['xRow'], action: 'batal' });
    expect(noReason.status).toBe(400);
    const ok = await bulkResolve(gm, { ids: ['xRow'], action: 'batal', reason: 'Tutup permanen' });
    expect(ok.body.data.done).toBe(1);
    const row = await prisma.delivery.findUnique({ where: { id: 'xRow' } });
    expect(row.status).toBe('batal');
    expect(row.pendingReason).toBe('Tutup permanen');
    // per-row audit trail exists
    const audits = await prisma.distAuditLog.findMany({ where: { title: { contains: 'dibatalkan (massal)' } } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
