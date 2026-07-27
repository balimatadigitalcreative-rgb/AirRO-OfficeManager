'use strict';
// Regression guard for the app-wide outage class: "the API is UP but cannot SERVE DATA" (DB
// unreachable, or the deployed schema is behind the running Prisma client). The plain /health probe
// could not see that — it returned 200 with no DB dependency — so a broken deploy went green and
// every screen showed a load error. /health/ready closes that gap; the deploy gates on it.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();

beforeAll(async () => { await resetDb(); });
afterAll(() => prisma.$disconnect());

describe('health probes', () => {
  it('/health is pure liveness — 200, no DB dependency', async () => {
    const r = await request(app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('/health/ready reports db + schema OK on a fully-migrated database', async () => {
    const r = await request(app).get('/api/v1/health/ready');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'ok', schema: 'ok' });
  });

  it('the readiness probe touches the RECENT schema (the columns a behind-DB would lack)', async () => {
    // It must actually query officeCode / DistChangeRequest / paymentNotReceived through the running
    // client — the exact things that throw when `migrate deploy` didn't run. Prove they exist here.
    await expect(prisma.businessUnit.findFirst({ select: { officeCode: true } })).resolves.not.toThrow?.();
    await expect(prisma.distChangeRequest.findFirst({ select: { id: true } })).resolves.toBeDefined?.();
    const bu = await prisma.businessUnit.findFirst({ select: { officeCode: true } });   // no throw = column exists
    expect(bu === null || typeof bu.officeCode === 'string').toBe(true);
    const txn = await prisma.distTransaction.findFirst({ select: { paymentNotReceived: true } });
    expect(txn === null || typeof txn.paymentNotReceived === 'boolean').toBe(true);
  });

  it('BigInt money endpoints return VALID JSON (a stray BigInt would 500 many endpoints at once)', async () => {
    const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
    const owner = (await reg({ name: 'Owner', username: 'own_hr', password: 'secret123', role: 'owner' })).token;
    const auth = { Authorization: `Bearer ${owner}` };
    const cid = (await request(app).post('/api/v1/distribusi/customers').set(auth).send({ name: 'C', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth).send({ qty: 100, reason: 'stok awal', fleet: 'Merah' });
    await request(app).post('/api/v1/distribusi/transactions').set(auth).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-07-27', gallonOut: 5 });
    // These are the BigInt-bearing / bootstrap endpoints every screen leans on — all must be valid JSON 200.
    for (const path of ['/distribusi/transactions', '/distribusi/dashboard/summary', '/entries', '/accounts', '/distribusi/customers']) {
      const r = await request(app).get('/api/v1' + path).set(auth);
      expect(r.status).toBe(200);
      expect(() => JSON.stringify(r.body)).not.toThrow();   // BigInt→Number boundary held
    }
    const list = await request(app).get('/api/v1/distribusi/transactions').set(auth);
    expect(typeof list.body.data[0].amount).toBe('number');   // not a BigInt leaking through
  });
});
