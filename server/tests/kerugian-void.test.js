'use strict';
// KERUGIAN — Batalkan (void) + Hapus permanen (owner hard delete) + bulk delete. Void reverses a
// loss atomically (bon restored, dispute reverted, record shown "Dibatalkan", excluded from totals).
// Hard delete is owner-only, ≤30 days, no approved dispute; writes a full JSON snapshot to the audit
// log first. Server enforces every eligibility rule.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const loss = (t) => request(app).get('/api/v1/distribusi/reports/loss?period=range&dateFrom=2026-01-01&dateTo=2026-12-31').set(auth(t)).then((r) => r.body.data);
const impact = (t, id, src) => request(app).get('/api/v1/distribusi/kerugian/' + id + '/impact' + (src ? '?source=' + src : '')).set(auth(t));
const voidK = (t, id, src, body) => request(app).post('/api/v1/distribusi/kerugian/' + id + '/void' + (src ? '?source=' + src : '')).set(auth(t)).send(body);
const delK = (t, id, src, body) => request(app).delete('/api/v1/distribusi/kerugian/' + id + (src ? '?source=' + src : '')).set(auth(t)).send(body || {});
const bulkK = (t, items) => request(app).post('/api/v1/distribusi/kerugian/bulk-delete').set(auth(t)).send({ items });
const pnr = (t, body) => request(app).post('/api/v1/distribusi/transactions/payment-not-received').set(auth(t)).send(body);
const age = (id, days) => prisma.distTransaction.update({ where: { id }, data: { createdAt: new Date(Date.now() - days * 86400000) } });

let owner, gm, staff, budi, budiId, custA, custB, txnB150;
beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'kv_owner', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'kv_gm', password: 'secret123', role: 'gm' })).token;
  const b = await reg({ name: 'Budi', username: 'kv_budi', password: 'secret123', role: 'finance' });
  budiId = b.user.id;
  await prisma.user.update({ where: { id: budiId }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiBonAdjust: true }) } });
  budi = await login('kv_budi');
  const s = await reg({ name: 'Staf', username: 'kv_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiBonAdjust: true }) } });
  staff = await login('kv_staff');
  // Customer A: big bon so several PNRs can be recorded against it.
  custA = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Cust A', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: custA, qty: 200, method: 'bon', txnDate: '2026-08-01' });   // 2.000.000 bon
  // Customer B: 800.000 bon; the 150k nota HANDLED BY BUDI (its actor) so the GM can dispute it.
  custB = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Cust B', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  txnB150 = (await request(app).post('/api/v1/distribusi/transactions').set(auth(budi)).send({ customerId: custB, qty: 15, method: 'bon', txnDate: '2026-08-01' })).body.data.id;
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: custB, qty: 65, method: 'bon', txnDate: '2026-08-01' });
});
afterAll(() => prisma.$disconnect());

describe('BATALKAN a dispute-source loss', () => {
  let dId;
  it('raise + approve a dispute (staf, 150k) → it is a loss; customer B bon 650k', async () => {
    // Budi handled txnB150, so GM raises + approves (not the actor).
    const r = await request(app).post('/api/v1/distribusi/transactions/' + txnB150 + '/dispute').set(auth(gm)).send({ reason: 'nota_fiktif', resolution: 'staf', customerClaimAmount: 0, note: 'fiktif', staffUserId: budiId });
    dId = r.body.data.id;
    await request(app).post('/api/v1/distribusi/disputes/' + dId + '/approve').set(auth(gm)).send({});
    expect((await detail(gm, custB)).sisaBon).toBe(650000);
  });
  it('impact lists all side effects; void allowed; hard delete BLOCKED (approved dispute)', async () => {
    const r = await impact(gm, dId, 'dispute');
    expect(r.status).toBe(200);
    const im = r.body.data;
    expect(im.effects.some((e) => e.type === 'bon' && e.delta === 150000)).toBe(true);
    expect(im.effects.some((e) => e.type === 'liability' && e.staffName === 'Budi' && e.action === 'void')).toBe(true);
    expect(im.effects.some((e) => e.type === 'disputeStatus' && e.to === 'disengketakan')).toBe(true);
    expect(im.void.allowed).toBe(true);
    expect(im.delete.allowed).toBe(false);
    expect(im.delete.blockers.some((b) => b.code === 'dispute_approved')).toBe(true);
  });
  it('a non-GM cannot void — 403', async () => {
    expect((await voidK(staff, dId, 'dispute', { reason: 'salah_input', note: 'x' })).status).toBe(403);
  });
  it('note is required', async () => {
    expect((await voidK(gm, dId, 'dispute', { reason: 'salah_input', note: '' })).status).toBe(400);
  });
  it('GM voids → bon restored to 800k, dispute reverted to disengketakan, excluded from loss total', async () => {
    const before = await loss(gm); const beforeTotal = before.total;
    const r = await voidK(gm, dId, 'dispute', { reason: 'salah_penilaian', note: 'ternyata benar' });
    expect(r.status).toBe(200);
    expect((await detail(gm, custB)).sisaBon).toBe(800000);
    const row = (await detail(gm, custB)).transactions.find((t) => t.id === txnB150);
    expect(row.dispute.status).toBe('disengketakan');   // reverted, still visible
    const rep = await loss(gm);
    expect(rep.total).toBe(beforeTotal - 150000);
    const item = rep.items.find((x) => x.id === dId);
    expect(item.voided).toBe(true);                      // still LISTED, marked cancelled
    expect(rep.voidedTotal).toBeGreaterThanOrEqual(150000);
  });
  it('voiding again is rejected', async () => {
    expect((await voidK(gm, dId, 'dispute', { reason: 'salah_input', note: 'lagi' })).status).toBe(400);
  });
});

describe('HAPUS PERMANEN a PNR loss (owner only)', () => {
  let pnrId, amt = 120000;
  it('create a PNR loss (staff Budi)', async () => {
    const r = await pnr(gm, { customerId: custA, amount: amt, txnDate: '2026-08-03', responsibleUserId: budiId, lossReason: 'uang dibawa kabur' });
    expect(r.status).toBe(201);
    pnrId = r.body.data.id;
  });
  it('non-owner (GM) hard delete → 403; record still there', async () => {
    expect((await delK(gm, pnrId, 'pnr', { confirm: String(amt) })).status).toBe(403);
    expect((await loss(owner)).items.some((x) => x.id === pnrId)).toBe(true);
  });
  it('wrong confirm text → 400', async () => {
    expect((await delK(owner, pnrId, 'pnr', { confirm: 'salah' })).status).toBe(400);
  });
  it('owner hard-deletes a fresh (2-day-old) record → gone; audit holds a full JSON snapshot', async () => {
    await age(pnrId, 2);
    const r = await delK(owner, pnrId, 'pnr', { confirm: String(amt) });
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe(true);
    expect((await loss(owner)).items.some((x) => x.id === pnrId)).toBe(false);
    const audit = await prisma.distAuditLog.findFirst({ where: { kind: 'hapus', detail: { contains: pnrId } } });
    expect(audit).toBeTruthy();
    expect(audit.detail).toMatch(/SNAPSHOT/);
    const m = audit.detail.match(/SNAPSHOT (\{.*\})/); const snap = JSON.parse(m[1]);
    expect(snap.row.amount).toBe(amt);          // reconstructable
    expect(snap.table).toBe('DistTransaction');
  });
  it('a record older than 30 days cannot be hard-deleted (too_old) → use Batalkan', async () => {
    const old = (await pnr(gm, { customerId: custA, amount: 50000, txnDate: '2026-06-01', responsibleName: 'Budi', lossReason: 'lama' })).body.data.id;
    await age(old, 40);
    const r = await delK(owner, old, 'pnr', { confirm: '50000' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/30 hari|Batalkan/i);
  });
});

describe('BULK delete — mixed eligibility', () => {
  it('5 records, 2 too old → 3 deleted, 2 reported with reasons', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) { const r = await pnr(gm, { customerId: custA, amount: 30000 + i, txnDate: '2026-08-04', responsibleName: 'Budi', lossReason: 'bulk ' + i }); ids.push(r.body.data.id); }
    await age(ids[0], 45); await age(ids[1], 60);   // 2 ineligible (too old)
    const r = await bulkK(owner, ids.map((id) => ({ id, source: 'pnr' })));
    expect(r.status).toBe(200);
    expect(r.body.data.deleted).toBe(3);
    expect(r.body.data.skipped).toBe(2);
    const skipped = r.body.data.results.filter((x) => !x.ok);
    expect(skipped.every((x) => x.reason === 'too_old')).toBe(true);
    expect(r.body.data.results.filter((x) => x.ok).length).toBe(3);
  });
  it('a non-owner cannot bulk delete — 403', async () => {
    expect((await bulkK(gm, [{ id: 'x', source: 'pnr' }])).status).toBe(403);
  });
});
