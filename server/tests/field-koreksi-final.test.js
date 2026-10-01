'use strict';
// PLAN 3C FINAL REVIEW: (1) a decision lands only on a request that is STILL pending — a withdraw that
// got there first wins and the approval applies nothing; (2) a move's target customer must be in the
// requester's armada scope (no peeking at / moving into another armada).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');
const svc = require('../src/services/distribution.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
let gm, driver, cA, cOther;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'kf_gm', password: 'secret123', role: 'gm' })).token;
  const d = await reg({ name: 'Sopir', username: 'kf_drv', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiKoreksi: true }), fleetScope: JSON.stringify(['DK 1']) } });
  driver = await login('kf_drv');
  cA = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko A', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  cOther = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko Lain', type: 'reguler', masterPrice: 6000, armada: 'DK 2' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('a decision only lands on a still-pending request (one conditional write)', async () => {
  const t = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cA, qty: 2, method: 'lunas', txnDate: todayISO() })).body.data.id;
  const r = (await request(app).post(`${D}/transactions/${t}/corrections`).set(auth(driver)).send({ reason: 'salah', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 })).body.data;
  await prisma.distChangeRequest.update({ where: { id: r.id }, data: { status: 'withdrawn' } });   // the withdraw got there first
  await expect(svc.claimPending(prisma, r.id, { status: 'approved' })).rejects.toThrow(/sudah diputuskan atau ditarik/);
  expect((await prisma.distChangeRequest.findUnique({ where: { id: r.id } })).status).toBe('withdrawn');
});

it('every decision path claims the request inside its own write (approval claims first inside the transaction)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'services', 'distribution.service.js'), 'utf8');
  expect(src).not.toMatch(/distChangeRequest\.update\(\{ where: \{ id(: req\.id)? \}, data: \{\s*status: '(approved|rejected)'/);
  expect(src).toMatch(/await prisma\.\$transaction\(async \(db\) => \{\r?\n\s*await claimPending\(db, id, \{/);
  expect(src).toMatch(/await prisma\.\$transaction\(async \(db\) => \{\r?\n\s*await claimPending\(db, req\.id, \{/);
});

it('a move to a customer of another armada is refused (preview and request) for a scoped driver', async () => {
  const t = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cA, qty: 1, method: 'bon', txnDate: todayISO() })).body.data.id;
  const body = { fromCustomerId: cA, toCustomerId: cOther, transactionIds: [t] };
  expect((await request(app).post(`${D}/change-requests/reassign/preview`).set(auth(driver)).send(body)).status).toBe(404);
  expect((await request(app).post(`${D}/change-requests/reassign`).set(auth(driver)).send({ ...body, note: 'pindah' })).status).toBe(404);
});
