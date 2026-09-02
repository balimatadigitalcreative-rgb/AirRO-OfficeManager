'use strict';
// PINDAHKAN KE PELANGGAN LAIN — reassign transactions to another customer (approval-gated, reuses the
// DistChangeRequest engine, kind='reassign'). Asserts: moving a bon lowers the wrong customer's Sisa Bon
// by exactly that amount and raises the right one by the same; running balances + gallon ledger follow;
// AR == Σ Sisa Bon after approval; an invoiced txn is blocked (invoice named); the requester can't
// approve their own without distribusiApproveSelf; a bulk move is one approval → many reassignments.
process.env.ACCOUNTING_V2 = 'true';   // live posting on → AR journals + reclass run, so AR == Σ Sisa Bon is checkable
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const mkCust = async (t, name, price) => (await request(app).post('/api/v1/distribusi/customers').set(auth(t)).send({ name, type: 'reguler', masterPrice: price, armada: 'Merah' })).body.data;
const bon = async (t, cid, qty, price, date, gOut) => (await request(app).post('/api/v1/distribusi/transactions').set(auth(t)).send({ customerId: cid, qty, unitPrice: price, method: 'bon', txnDate: date, gallonOut: gOut != null ? gOut : qty })).body.data.id;
const cust = async (t, cid) => (await request(app).get('/api/v1/distribusi/customers/' + cid).set(auth(t))).body.data;
const sisaBon = async (t, cid) => (await cust(t, cid)).sisaBon;
const held = async (t, cid) => (await cust(t, cid)).gallonsHeld;
const previewR = (t, body) => request(app).post('/api/v1/distribusi/change-requests/reassign/preview').set(auth(t)).send(body);
const submitR = (t, body) => request(app).post('/api/v1/distribusi/change-requests/reassign').set(auth(t)).send(body);
const approve = (t, id) => request(app).post('/api/v1/distribusi/change-requests/' + id + '/approve').set(auth(t)).send({});
const arTotal = () => acc.receivablesBalance();
const sumSisa = async (t, ids) => { let s = 0; for (const id of ids) s += await sisaBon(t, id); return s; };

let gm, staff, staffId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_ra', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Staf Rina', username: 'staff_ra', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch('/api/v1/users/' + staffId).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false } });
  staff = await login('staff_ra', 'secret123');
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 2000, reason: 'stok awal', fleet: 'Merah' });
});
afterAll(() => prisma.$disconnect());

describe('reassign one bon between customers', () => {
  let A, B, txnId, reqId;
  beforeAll(async () => {
    A = await mkCust(gm, 'BALI HOLIDAY INN', 6000);   // from (wrong)
    B = await mkCust(gm, 'WARUNG BERKAH', 6000);       // to (right)
    txnId = await bon(gm, A.id, 102, 6000, '2026-04-10');   // 102 × 6000 = 612.000, 102 galon out
  });

  it('preview shows the exact before→after on both sides (never confirm blind)', async () => {
    expect(await sisaBon(gm, A.id)).toBe(612000);
    expect(await sisaBon(gm, B.id)).toBe(0);
    const r = await previewR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: [txnId] });
    expect(r.status).toBe(200);
    expect(r.body.data.fromCustomer).toMatchObject({ sisaBonBefore: 612000, sisaBonAfter: 0 });
    expect(r.body.data.toCustomer).toMatchObject({ sisaBonBefore: 0, sisaBonAfter: 612000 });
    expect(r.body.data.count).toBe(1);
    expect(r.body.data.blocks).toHaveLength(0);
  });

  it('same-customer / inactive target / missing catatan are rejected', async () => {
    expect((await submitR(staff, { fromCustomerId: A.id, toCustomerId: A.id, transactionIds: [txnId], note: 'x' })).status).toBe(400);
    expect((await submitR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: [txnId] })).status).toBe(400);   // no catatan
  });

  it('submit creates a PENDING request and leaves both balances untouched', async () => {
    const r = await submitR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: [txnId], note: 'salah pelanggan saat input' });
    expect(r.status).toBe(201);
    reqId = r.body.data.id;
    expect(r.body.data).toMatchObject({ kind: 'reassign', status: 'pending', count: 1 });
    expect(await sisaBon(gm, A.id)).toBe(612000);   // unchanged while pending
    expect(await sisaBon(gm, B.id)).toBe(0);
    // a 2nd request on the same txn is blocked
    expect((await submitR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: [txnId], note: 'lagi' })).status).toBe(400);
  });

  it('the requester can NOT approve their own request without distribusiApproveSelf', async () => {
    await request(app).patch('/api/v1/users/' + staffId).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true } });
    const selfTok = await login('staff_ra', 'secret123');
    expect((await approve(selfTok, reqId)).status).toBe(403);
    await request(app).patch('/api/v1/users/' + staffId).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false } });
    staff = await login('staff_ra', 'secret123');
  });

  it('APPROVE moves the bon: Sisa Bon, gallon ledger and AR == Σ Sisa Bon all follow', async () => {
    const r = await approve(gm, reqId);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    expect(await sisaBon(gm, A.id)).toBe(0);         // −612.000
    expect(await sisaBon(gm, B.id)).toBe(612000);    // +612.000 (same amount)
    expect(await held(gm, A.id)).toBe(0);            // 102 galon left A
    expect(await held(gm, B.id)).toBe(102);          // …and landed on B
    const txn = (await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).body.data.find((x) => x.id === txnId);
    expect(txn.customerId).toBe(B.id);
    // AR == Σ Sisa Bon still holds
    expect(await arTotal()).toBe(await sumSisa(gm, [A.id, B.id]));
    expect(await arTotal()).toBe(612000);
  });
});

describe('guards', () => {
  it('a transaction inside an ISSUED invoice is blocked, naming the invoice', async () => {
    const A = await mkCust(gm, 'INV FROM', 5000); const B = await mkCust(gm, 'INV TO', 5000);
    const tid = await bon(gm, A.id, 4, 5000, '2026-04-12');
    const inv = await request(app).post('/api/v1/distribusi/customers/' + A.id + '/invoices').set(auth(gm)).send({ scope: 'unpaidBon' });
    expect(inv.status).toBe(201);
    const number = inv.body.data.number;
    const r = await submitR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: [tid], note: 'pindah' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain(number);   // the invoice is named
  });
});

describe('bulk — 4 transactions moved in ONE approved request', () => {
  it('one approval reassigns all four and shifts Sisa Bon by their total', async () => {
    const A = await mkCust(gm, 'VISIT WRONG', 5000); const B = await mkCust(gm, 'VISIT RIGHT', 5000);
    const ids = [];
    for (const q of [2, 3, 4, 5]) ids.push(await bon(gm, A.id, q, 5000, '2026-04-15'));   // 10k+15k+20k+25k = 70k
    expect(await sisaBon(gm, A.id)).toBe(70000);
    const sub = await submitR(staff, { fromCustomerId: A.id, toCustomerId: B.id, transactionIds: ids, note: 'satu kunjungan salah pelanggan' });
    expect(sub.status).toBe(201);
    expect(sub.body.data.count).toBe(4);
    const ap = await approve(gm, sub.body.data.id);
    expect(ap.status).toBe(200);
    expect(await sisaBon(gm, A.id)).toBe(0);
    expect(await sisaBon(gm, B.id)).toBe(70000);
    const moved = (await request(app).get('/api/v1/distribusi/transactions').set(auth(gm))).body.data.filter((x) => ids.includes(x.id));
    expect(moved).toHaveLength(4);
    expect(moved.every((x) => x.customerId === B.id)).toBe(true);
  });
});
