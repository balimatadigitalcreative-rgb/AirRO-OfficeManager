'use strict';
// Opening / carry-over bon: a REAL receivable an admin types in for a customer whose old
// records couldn't be imported. Stored as an ordinary bon (method='bon', legacy=FALSE), so
// it must flow through EVERY existing aggregation — unlike legacy archive rows.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const listed = (t, id) => request(app).get('/api/v1/distribusi/customers').set(auth(t)).then((r) => r.body.data.find((c) => c.id === id));
const openingBon = (t, id, body) => request(app).post(`/api/v1/distribusi/customers/${id}/opening-bon`).set(auth(t)).send(body);

let gm, owner, staff, custId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'ob_gm', password: 'secret123', role: 'gm' })).token;
  owner = (await reg({ name: 'Owner', username: 'ob_owner', password: 'secret123', role: 'owner' })).token;   // approver (≠ requester)
  // a helper who may INPUT sales but has no correction cap
  const s = await reg({ name: 'Helper', username: 'ob_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiKoreksi: false }) } });   // explicit false: the coarse `distribusi` cap back-fills absent ones
  staff = (await request(app).post('/api/v1/auth/login').send({ username: 'ob_staff', password: 'secret123' })).body.token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Bu Lama', masterPrice: 6000 });
  custId = c.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('opening bon — creation + guards', () => {
  it('requires the correction capability (a plain input helper is rejected)', async () => {
    const r = await openingBon(staff, custId, { amount: 500000, txnDate: '2025-12-31', note: 'carry-over' });
    expect(r.status).toBe(403);
  });

  it('validates nominal, date and the mandatory keterangan', async () => {
    expect((await openingBon(gm, custId, { amount: 0, txnDate: '2025-12-31', note: 'x' })).status).toBe(400);
    expect((await openingBon(gm, custId, { amount: 500000, txnDate: '31-12-2025', note: 'x' })).status).toBe(400);
    expect((await openingBon(gm, custId, { amount: 500000, txnDate: '2025-12-31', note: '' })).status).toBe(400);
    expect(await prisma.distTransaction.count()).toBe(0);   // nothing written by the rejects
  });

  it('adds Rp 500.000 dated 2025-12-31 and raises sisa bon', async () => {
    const r = await openingBon(gm, custId, { amount: 500000, txnDate: '2025-12-31', note: 'Bon carry-over 2025' });
    expect(r.status).toBe(201);
    expect(r.body.data.sisaBon).toBe(500000);
    const row = await prisma.distTransaction.findFirst({ where: { customerId: custId } });
    expect(row).toMatchObject({ method: 'bon', legacy: false, openingBon: true, qty: 0, amount: 500000, txnDate: '2025-12-31' });
    expect(row.actorName).toBe('GM');                       // audited actor
  });

  it('is REAL receivable — counted by the customer list and detail (not archive-only)', async () => {
    expect((await listed(gm, custId)).sisaBon).toBe(500000);
    const d = await detail(gm, custId);
    expect(d.sisaBon).toBe(500000);
    const t = d.transactions.find((x) => x.openingBon);
    expect(t).toMatchObject({ method: 'bon', amount: 500000, txnDate: '2025-12-31', legacy: false, note: 'Bon carry-over 2025' });
  });

  it('ages from the ADMIN-PICKED date, so overdue reminders fire on it', async () => {
    // enable an overdue reminder, then the billing rollup must see the bon as outstanding
    // since 2025-12-31 (the date typed in) — not since today.
    await request(app).patch('/api/v1/distribusi/customers/' + custId).set(auth(gm))
      .send({ reminder: { enabled: true, overdueDays: 1 } });
    const r = await request(app).get('/api/v1/distribusi/billing-reminders').set(auth(gm));
    const row = (r.body.data || []).find((x) => x.customerId === custId);
    expect(row).toBeTruthy();
    expect(row.sisaBon).toBe(500000);
    expect(row.since).toBe('2025-12-31');
    expect(row.ageDays).toBeGreaterThan(150);   // genuinely aged (~201d), not 0 = "today"
  });

  it('is billable on an invoice (unlike a legacy archive row)', async () => {
    const iv = await request(app).post(`/api/v1/distribusi/customers/${custId}/invoices`).set(auth(gm)).send({ scope: 'unpaidBon' });
    expect(iv.status).toBe(201);
    expect(iv.body.data.total).toBe(500000);
  });

  it('a later pelunasan reduces it like any bon', async () => {
    const pay = await request(app).post('/api/v1/distribusi/transactions').set(auth(gm))
      .send({ customerId: custId, method: 'pelunasan', payAmount: 200000, txnDate: '2026-07-01', payMethod: 'cash' });
    expect(pay.status).toBe(201);
    expect((await listed(gm, custId)).sisaBon).toBe(300000);
    // and it can be settled fully
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm))
      .send({ customerId: custId, method: 'pelunasan', payAmount: 300000, txnDate: '2026-07-02', payMethod: 'cash' });
    expect((await listed(gm, custId)).sisaBon).toBe(0);
  });

  it('is correctable/voidable through the approval flow (structured amount edit; audited, not deleted)', async () => {
    const row = await prisma.distTransaction.findFirst({ where: { customerId: custId, openingBon: true } });
    // an opening bon stores its amount directly (qty 0) → it is corrected like a pelunasan: amount only.
    const c = await request(app).post(`/api/v1/distribusi/transactions/${row.id}/corrections`).set(auth(gm)).send({ reason: 'salah nominal', amount: 250000 });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ kind: 'correction', status: 'pending', newAmount: 250000 });
    // gm can't approve their own request → owner approves
    const ap = await request(app).post(`/api/v1/distribusi/change-requests/${c.body.data.id}/approve`).set(auth(owner)).send({});
    expect(ap.status).toBe(200);
    const d = await detail(gm, custId);
    expect(d.transactions.find((x) => x.id === row.id).corrected).toBe(true);
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(gm));
    expect(audit.body.data.some((a) => /Bon awal/i.test(a.title || ''))).toBe(true);          // creation audited
    expect(audit.body.data.some((a) => /Setujui koreksi/i.test(a.title || ''))).toBe(true);   // approval audited
  });

  it('a fleet-scoped user cannot add one outside their scope', async () => {
    await prisma.customer.update({ where: { id: custId }, data: { armada: 'Biru' } });
    const s = await reg({ name: 'Merah', username: 'ob_merah', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: s.user.id }, data: { fleetScope: JSON.stringify(['Merah']), permissions: JSON.stringify({ distribusi: true, distribusiKoreksi: true }) } });
    const tok = (await request(app).post('/api/v1/auth/login').send({ username: 'ob_merah', password: 'secret123' })).body.token;
    const r = await openingBon(tok, custId, { amount: 1000, txnDate: '2025-12-31', note: 'x' });
    expect([403, 404]).toContain(r.status);
  });
});
