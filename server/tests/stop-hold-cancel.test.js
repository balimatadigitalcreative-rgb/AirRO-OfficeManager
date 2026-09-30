'use strict';
// A stop can be put on HOLD (ditunda) straight from the board — reason required — and CANCELLED with a
// reason (required once the owner switches it on). Both land in pendingReason, the same column the
// day-closeout fills, so the report and carry-over read them unchanged.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm; const stops = {};
const mark = (id, body) => request(app).patch(`${D}/deliveries/${id}`).set(auth(gm)).send(body);

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'hc_gm', password: 'secret123', role: 'gm' })).body.token;
  for (const n of ['A', 'B', 'C']) await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: n, type: 'reguler', masterPrice: 6000, armada: 'DK 1', deliveryDays: ALL });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  board.forEach((s) => { stops[s.customerName] = s.id; });
});
afterAll(() => prisma.$disconnect());

it('ditunda needs a reason', async () => {
  const r = await mark(stops.A, { status: 'ditunda' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/alasan/i);
});
it('ditunda with a reason is stored and audited', async () => {
  const r = await mark(stops.A, { status: 'ditunda', reason: 'Toko tutup' });
  expect(r.status).toBe(200);
  const row = await prisma.delivery.findUnique({ where: { id: stops.A } });
  expect(row.status).toBe('ditunda');
  expect(row.pendingReason).toBe('Toko tutup');
  const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
  expect(audit.some((a) => /Tunda/.test(a.title) && /Toko tutup/.test(a.detail || ''))).toBe(true);
});
it('back to pending clears the reason', async () => {
  await mark(stops.A, { status: 'pending' });
  expect((await prisma.delivery.findUnique({ where: { id: stops.A } })).pendingReason).toBe('');
});
it('batal: reason optional while the switch is off, stored when given', async () => {
  expect((await mark(stops.B, { status: 'batal' })).status).toBe(200);
  expect((await mark(stops.C, { status: 'batal', reason: 'Pindah alamat' })).status).toBe(200);
  expect((await prisma.delivery.findUnique({ where: { id: stops.C } })).pendingReason).toBe('Pindah alamat');
});
it('batal: reason required once the owner switches it on', async () => {
  await mark(stops.B, { status: 'pending' });
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibAlasanBatal: true });
  const r = await mark(stops.B, { status: 'batal' });
  expect(r.status).toBe(400);
  expect(r.body.error.details.code).toBe('REASON_REQUIRED');
});
