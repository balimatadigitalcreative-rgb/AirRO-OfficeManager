'use strict';
// KOREKSI SAYA — a driver sees the corrections THEY submitted (with the office's decision) and can
// withdraw one that is still pending. They can never see or touch someone else's.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const today = todayISO();
const REQ = { distribusi: true, distribusiInput: true, distribusiKoreksi: true };
let gm, a, b, cid;
const mkDriver = async (u) => { const r = await reg({ name: u, username: u, password: 'secret123', role: 'finance' }); await prisma.user.update({ where: { id: r.user.id }, data: { permissions: JSON.stringify(REQ) } }); return login(u, 'secret123'); };
const txn = async (tok) => (await request(app).post(`${D}/transactions`).set(auth(tok)).send({ customerId: cid, qty: 2, method: 'bon', txnDate: today })).body.data.id;
const ask = (tok, id) => request(app).post(`${D}/transactions/${id}/corrections`).set(auth(tok)).send({ reason: 'salah ketik', qty: 1, unitPrice: 6000, gallonOut: 1 });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'mc_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko MC', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  a = await mkDriver('mc_a'); b = await mkDriver('mc_b');
});
afterAll(() => prisma.$disconnect());

let aReq, bReq;
it('each driver sees only their own requests, with status', async () => {
  const ra = await ask(a, await txn(a));
  expect(ra.status).toBe(201);
  aReq = ra.body.data.id;
  bReq = (await ask(b, await txn(b))).body.data.id;
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(a))).body.data;
  expect(mine.map((r) => r.id)).toEqual([aReq]);
  expect(mine[0].status).toBe('pending');
});
it('a driver cannot withdraw someone else\'s request', async () => {
  const r = await request(app).post(`${D}/change-requests/${bReq}/withdraw`).set(auth(a));
  expect(r.status).toBe(404);
  expect((await prisma.distChangeRequest.findUnique({ where: { id: bReq } })).status).toBe('pending');
});
it('withdraw a pending request; it shows as withdrawn and frees the txn for a new request', async () => {
  const r = await request(app).post(`${D}/change-requests/${aReq}/withdraw`).set(auth(a));
  expect(r.status).toBe(200);
  expect(r.body.data.status).toBe('withdrawn');
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(a))).body.data;
  expect(mine[0].status).toBe('withdrawn');
  const row = await prisma.distChangeRequest.findUnique({ where: { id: aReq } });
  expect((await ask(a, row.transactionId)).status).toBe(201);
});
it('a decided request cannot be withdrawn', async () => {
  await request(app).post(`${D}/change-requests/${bReq}/reject`).set(auth(gm)).send({ note: 'foto menunjukkan benar' });
  const r = await request(app).post(`${D}/change-requests/${bReq}/withdraw`).set(auth(b));
  expect(r.status).toBe(400);
  const mine = (await request(app).get(`${D}/change-requests/mine`).set(auth(b))).body.data;
  expect(mine[0].status).toBe('rejected');
  expect(mine[0].decisionNote).toMatch(/foto/);
});
