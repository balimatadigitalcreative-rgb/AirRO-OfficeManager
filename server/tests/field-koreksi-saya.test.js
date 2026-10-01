'use strict';
// KOREKSI SAYA (Mode Lapangan 3C): an account that may only CANCEL (distribusiVoid) sees and withdraws
// its own requests too; a withdraw can never overwrite a decision (one conditional write).
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
const as = async (gm, username, permissions) => { const u = await reg({ name: username, username, password: 'secret123', role: 'finance' }); await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions }); return login(username); };
let gm, voider, koreksi, nobody, cid;
const sale = async () => (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 1, method: 'lunas', txnDate: todayISO() })).body.data.id;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'ks_gm', password: 'secret123', role: 'gm' })).token;
  voider = await as(gm, 'ks_void', { distribusi: true, distribusiKoreksi: false, distribusiVoid: true });   // distribusi:true alone derives Koreksi
  koreksi = await as(gm, 'ks_kor', { distribusi: true, distribusiKoreksi: true });
  nobody = await as(gm, 'ks_none', { distribusi: true, distribusiKoreksi: false, distribusiVoid: false });
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko KS', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('a cancel-only account sees its own request and can withdraw it; an account with neither right cannot', async () => {
  const v = await request(app).post(`${D}/transactions/${await sale()}/void`).set(auth(voider)).send({ reason: 'dobel' });
  expect(v.status).toBe(201);
  const mine = await request(app).get(`${D}/change-requests/mine`).set(auth(voider));
  expect(mine.status).toBe(200);
  expect(mine.body.data.map((r) => r.id)).toContain(v.body.data.id);
  const w = await request(app).post(`${D}/change-requests/${v.body.data.id}/withdraw`).set(auth(voider)).send({});
  expect(w.status).toBe(200); expect(w.body.data.status).toBe('withdrawn');
  expect((await request(app).get(`${D}/change-requests/mine`).set(auth(nobody))).status).toBe(403);
});

it('a decided request cannot be withdrawn and keeps its decision', async () => {
  const id = await sale();
  const r = await request(app).post(`${D}/transactions/${id}/corrections`).set(auth(koreksi)).send({ reason: 'salah', qty: 2, unitPrice: 6000, gallonOut: 2, gallonIn: 0 });
  await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  const w = await request(app).post(`${D}/change-requests/${r.body.data.id}/withdraw`).set(auth(koreksi)).send({});
  expect(w.status).toBe(400);
  expect((await prisma.distChangeRequest.findUnique({ where: { id: r.body.data.id } })).status).toBe('approved');
});

it('the withdraw is ONE conditional write: only the requester\'s own still-pending row', () => {
  expect(svc.withdrawWhere('r1', 'u1')).toEqual({ id: 'r1', requestedById: 'u1', status: 'pending' });
});
