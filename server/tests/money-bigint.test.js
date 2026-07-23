'use strict';
// Money columns are BigInt (fixes the production bug where a mis-entered ~4.28-billion amount
// overflowed the 32-bit Int mapping and blanked the whole transaction list). This covers:
//  (a) a 4,282,500,000 amount row is READABLE and appears in the list (200, correct fleet filter);
//  (b) creating an amount above the Rp 1,000,000,000 ceiling is REJECTED;
//  (c) a list containing one genuinely MALFORMED row still returns the other rows (resilient).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const DAY = '2026-07-24';

let owner, cust;
// Raw-insert a DistTransaction (bypasses Prisma so we can plant the exact bad-data shapes the
// production DB had). `amountSql` is inlined verbatim so we can store a numeric OR a corrupt value.
const rawTxn = (id, amountSql, unitPrice = 6000, qty = 1) => prisma.$executeRawUnsafe(
  `INSERT INTO "DistTransaction" ("id","customerId","fleetId","qty","unitPriceLocked","amount","method","txnDate","legacy","openingBon","status","createdAt")`
  + ` VALUES ('${id}','${cust}','Merah',${qty},${unitPrice},${amountSql},'lunas','${DAY}',0,0,'active',datetime('now'))`);

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_bi', password: 'secret123', role: 'owner' })).token;
  cust = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C Merah', type: 'reguler', masterPrice: 500000, armada: 'Merah' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Money BigInt widening + ceiling + list resilience', () => {
  it('(a) a 4,282,500,000-amount row is readable and appears in the list (200, fleet-filtered)', async () => {
    await rawTxn('bigrow', '4282500000', 451000, 9500);   // the exact production overflow value
    const merah = await request(app).get('/api/v1/distribusi/transactions?fleet=Merah').set(auth(owner));
    expect(merah.status).toBe(200);
    const big = merah.body.data.find((t) => t.id === 'bigrow');
    expect(big).toBeTruthy();
    expect(big.amount).toBe(4282500000);            // read back exactly, as a Number
    expect(typeof big.amount).toBe('number');
    // the UNFILTERED list (which used to fail because it included the bad row) is also 200 + has it
    const all = await request(app).get('/api/v1/distribusi/transactions').set(auth(owner));
    expect(all.status).toBe(200);
    expect(all.body.data.some((t) => t.id === 'bigrow')).toBe(true);
    // Biru (a different fleet) is unaffected + correctly filtered out
    const biru = await request(app).get('/api/v1/distribusi/transactions?fleet=Biru').set(auth(owner));
    expect(biru.status).toBe(200);
    expect(biru.body.data.every((t) => t.id !== 'bigrow')).toBe(true);
  });

  it('(b) an amount above the Rp 1,000,000,000 ceiling is rejected server-side', async () => {
    // qty 3000 × masterPrice 500,000 = 1.5e9 > ceiling
    const r = await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cust, qty: 3000, method: 'lunas', txnDate: DAY });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/terlalu besar|1\.000\.000\.000/i);
    // an ordinary-sized sale still works
    expect((await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cust, qty: 2, method: 'lunas', txnDate: DAY })).status).toBe(201);
    // an expense above the ceiling is rejected too
    expect((await request(app).post('/api/v1/distribusi/expenses').set(auth(owner)).send({ date: DAY, fleet: 'Merah', amount: 2000000000, category: 'bensin' })).status).toBe(400);
    // a masterPrice above the ceiling is rejected too
    expect((await request(app).patch(`/api/v1/distribusi/customers/${cust}/price`).set(auth(owner)).send({ newPrice: 3000000000 })).status).toBe(400);
  });

  it('(c) a list with one MALFORMED row still returns the other rows (resilient, 200)', async () => {
    // a corrupt row: a non-numeric value stored in the numeric amount column (SQLite loose typing)
    // — Prisma can't convert it, so a naive findMany would throw and blank the screen.
    await rawTxn('badrow', "'corrupt'");
    const r = await request(app).get('/api/v1/distribusi/transactions?fleet=Merah').set(auth(owner));
    expect(r.status).toBe(200);                                   // NOT blanked
    expect(r.body.data.some((t) => t.id === 'bigrow')).toBe(true); // the big (valid) row still returns
    expect(r.body.data.some((t) => t.qty === 2)).toBe(true);       // the ordinary sale still returns
    expect(r.body.data.every((t) => t.id !== 'badrow')).toBe(true); // the corrupt row is skipped
  });
});
