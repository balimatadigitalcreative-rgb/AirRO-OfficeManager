'use strict';
// Two ways to cancel a distribution transaction, with separate capabilities.
//   VOID (distribusiVoid): recorded cancellation — row STAYS ("Dibatalkan"), excluded from EVERY
//     aggregate, gallon movements reversed, audited. The everyday path.
//   HARD DELETE (distribusiHardDelete, owner-only): permanent — typed ref/HAPUS + password + reason;
//     an audit entry is written BEFORE the row is removed, so a trace always survives.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const listed = (t, id) => request(app).get('/api/v1/distribusi/customers').set(auth(t)).then((r) => r.body.data.find((c) => c.id === id));
const shortRef = (id) => String(id).slice(-6).toUpperCase();

let owner, gm, staff, custId;
beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'vd_owner', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'vd_gm', password: 'secret123', role: 'gm' })).token;
  // a distribusi input+koreksi staffer WITHOUT void or hard-delete
  const s = await reg({ name: 'Staff', username: 'vd_staff', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: s.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: false, distribusiHardDelete: false }) } });
  staff = (await request(app).post('/api/v1/auth/login').send({ username: 'vd_staff', password: 'secret123' })).body.token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Bu Void', masterPrice: 6000 });
  custId = c.body.data.id;
});
afterAll(() => prisma.$disconnect());

// helper: make a bon sale of qty gallons (adds to sisa bon + gallons out)
const sell = (tok, qty, method) => request(app).post('/api/v1/distribusi/transactions').set(auth(tok))
  .send({ customerId: custId, qty, method: method || 'bon', txnDate: '2026-07-10' }).then((r) => r.body.data);

describe('VOID (recorded cancellation)', () => {
  it('a user WITHOUT distribusiVoid gets 403 and no Batalkan', async () => {
    const t = await sell(gm, 5);
    const r = await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(staff)).send({ reason: 'salah' });
    expect(r.status).toBe(403);
    // and the sale is untouched
    expect((await listed(gm, custId)).sisaBon).toBe(30000);
  });

  it('requires a reason', async () => {
    const t = await sell(gm, 1);
    expect((await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(gm)).send({ reason: '' })).status).toBe(400);
  });

  it('voids a bon sale → row stays "Dibatalkan", bon + gallons reversed, excluded from aggregates, audited', async () => {
    await resetDb.__noop?.();
    // fresh customer for a clean ledger
    const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Void Clean', masterPrice: 5000 });
    const id = c.body.data.id;
    const t = await request(app).post('/api/v1/distribusi/transactions').set(auth(gm))
      .send({ customerId: id, qty: 4, method: 'bon', txnDate: '2026-07-11' }).then((r) => r.body.data);
    // before: sisa bon 20000, holds 4 gallons
    const before = await request(app).get('/api/v1/distribusi/customers').set(auth(gm)).then((r) => r.body.data.find((x) => x.id === id));
    expect(before.sisaBon).toBe(20000);
    expect(before.gallonsHeld).toBe(4);

    const v = await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(gm)).send({ reason: 'batal — pelanggan komplain' });
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ status: 'void', voided: true, voidedByName: 'GM', voidReason: 'batal — pelanggan komplain' });

    // aggregates: bon + gallons back to zero (excluded)
    const after = await request(app).get('/api/v1/distribusi/customers').set(auth(gm)).then((r) => r.body.data.find((x) => x.id === id));
    expect(after.sisaBon).toBe(0);
    expect(after.gallonsHeld).toBe(0);
    // this customer no longer appears among those with a receivable
    expect((await request(app).get('/api/v1/distribusi/customers?bon=ada').set(auth(gm))).body.data.some((x) => x.id === id)).toBe(false);
    // the row STILL EXISTS in the detail, flagged voided (filterable)
    const d = await detail(gm, id);
    const row = d.transactions.find((x) => x.id === t.id);
    expect(row).toMatchObject({ status: 'void', voided: true });
    // one immutable audit entry
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(gm));
    expect(audit.body.data.some((a) => /Batalkan transaksi/i.test(a.title) && /Void Clean/.test(a.title))).toBe(true);
    // gallon movements reversed (inactive)
    expect(await prisma.gallonMovement.count({ where: { transactionId: t.id, active: true } })).toBe(0);
  });

  it('cannot void twice', async () => {
    const t = await sell(gm, 2);
    await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(gm)).send({ reason: 'x' });
    expect((await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(gm)).send({ reason: 'y' })).status).toBe(400);
  });

  it('a fleet-scoped user cannot void outside their scope', async () => {
    await prisma.customer.update({ where: { id: custId }, data: { armada: 'Biru' } });
    const t = await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: custId, qty: 1, method: 'bon', txnDate: '2026-07-12' }).then((r) => r.body.data);
    const m = await reg({ name: 'Merah', username: 'vd_merah', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: m.user.id }, data: { fleetScope: JSON.stringify(['Merah']), permissions: JSON.stringify({ distribusi: true, distribusiVoid: true }) } });
    const tok = (await request(app).post('/api/v1/auth/login').send({ username: 'vd_merah', password: 'secret123' })).body.token;
    expect([403, 404]).toContain((await request(app).post(`/api/v1/distribusi/transactions/${t.id}/void`).set(auth(tok)).send({ reason: 'x' })).status);
  });
});

describe('HARD DELETE (permanent, owner-only)', () => {
  let dcust, dtxn;
  beforeAll(async () => {
    const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Del Cust', masterPrice: 7000 });
    dcust = c.body.data.id;
  });
  beforeEach(async () => {
    dtxn = await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: dcust, qty: 3, method: 'bon', txnDate: '2026-07-13' }).then((r) => r.body.data);
  });

  it('a NON-owner (even GM, who lacks distribusiHardDelete) gets 403', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/transactions/${dtxn.id}`).set(auth(gm))
      .send({ reason: 'x', confirm: shortRef(dtxn.id), password: 'secret123' });
    expect(r.status).toBe(403);
    expect(await prisma.distTransaction.count({ where: { id: dtxn.id } })).toBe(1);   // still there
  });

  it('owner: wrong typed confirmation is rejected', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/transactions/${dtxn.id}`).set(auth(owner))
      .send({ reason: 'salah input', confirm: 'NOPE', password: 'secret123' });
    expect(r.status).toBe(400);
    expect(await prisma.distTransaction.count({ where: { id: dtxn.id } })).toBe(1);
  });

  it('owner: wrong password is rejected (401)', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/transactions/${dtxn.id}`).set(auth(owner))
      .send({ reason: 'salah', confirm: shortRef(dtxn.id), password: 'wrong-pass' });
    expect(r.status).toBe(401);
    expect(await prisma.distTransaction.count({ where: { id: dtxn.id } })).toBe(1);
  });

  it('owner with ref + password + reason: row is GONE, effects reversed, but an audit trace remains', async () => {
    const ref = shortRef(dtxn.id);
    const r = await request(app).delete(`/api/v1/distribusi/transactions/${dtxn.id}`).set(auth(owner))
      .send({ reason: 'duplikat entri', confirm: ref, password: 'secret123' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ deleted: true, ref });
    // the row is permanently gone
    expect(await prisma.distTransaction.count({ where: { id: dtxn.id } })).toBe(0);
    // its gallon movements are gone too
    expect(await prisma.gallonMovement.count({ where: { transactionId: dtxn.id } })).toBe(0);
    // but the audit log KEPT a trace of the deletion (ref, customer, amount, reason)
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    const del = audit.body.data.find((a) => /Hapus permanen transaksi/i.test(a.title) && /Del Cust/.test(a.title));
    expect(del).toBeTruthy();
    expect(del.detail).toMatch(new RegExp(ref));
    expect(del.detail).toMatch(/duplikat entri/);
  });

  it('the word HAPUS is also accepted as the typed confirmation', async () => {
    const r = await request(app).delete(`/api/v1/distribusi/transactions/${dtxn.id}`).set(auth(owner))
      .send({ reason: 'test', confirm: 'HAPUS', password: 'secret123' });
    expect(r.status).toBe(200);
    expect(await prisma.distTransaction.count({ where: { id: dtxn.id } })).toBe(0);
  });
});
