'use strict';
// SETORAN HARIAN — one armada, one day: what the driver must hand over. Cash from sales + bon payments +
// ganti rugi, transfers apart (never deposited), minus cash field expenses; plus gallons, stop counts,
// pending corrections and rits below the SOP. Same data the delivery report uses — no second figure.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const ALL = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
let gm, c1, c2, photoId;
const post = (body) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ txnDate: today, ...body });
const summary = async () => (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'ds_gm', password: 'secret123', role: 'gm' })).body.token;
  c1 = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'A', type: 'reguler', masterPrice: 10000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  c2 = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'B', type: 'reguler', masterPrice: 10000, armada: 'DK 1', deliveryDays: ALL })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 500, reason: 'stok awal' });
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 40000, ritSop: { enabled: true } });
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'x.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
  await request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet: 'DK 1', gallonsOut: 60, underSopReason: 'Rit terakhir' });
  await post({ customerId: c1, qty: 3, method: 'lunas', gallonOut: 3, gallonIn: 2 });                 // tunai 30.000
  await post({ customerId: c1, qty: 2, method: 'lunas', payMethod: 'transfer', gallonOut: 2 });        // transfer 20.000
  await post({ customerId: c2, qty: 5, method: 'bon', gallonOut: 5 });                                 // bon 50.000
  await post({ customerId: c2, method: 'pelunasan', payAmount: 15000, payMethod: 'cash' });            // tunai 15.000
  await request(app).post(`${D}/customers/${c1}/gallon-damage`).set(auth(gm)).send({ qty: 1, kind: 'pecah', payMethod: 'tunai', photoId, txnDate: today });   // tunai 40.000
  await request(app).post(`${D}/expenses`).set(auth(gm)).send({ date: today, fleet: 'DK 1', amount: 25000, category: 'bensin' });
  const board = (await request(app).get(`${D}/deliveries?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  await request(app).patch(`${D}/deliveries/${board[0].id}`).set(auth(gm)).send({ status: 'ditunda', reason: 'Toko tutup' });
});
afterAll(() => prisma.$disconnect());

it('adds up what the driver must deposit', async () => {
  const s = await summary();
  expect(s.tunaiPenjualan).toBe(30000);
  expect(s.tunaiPelunasan).toBe(15000);
  expect(s.tunaiGantiRugi).toBe(40000);
  expect(s.transfer).toBe(20000);
  expect(s.bonBaru).toBe(50000);
  expect(s.pengeluaran).toBe(25000);
  expect(s.wajibSetor).toBe(30000 + 15000 + 40000 - 25000);
});
it('gallons, stops, corrections and under-SOP rits', async () => {
  const s = await summary();
  expect(s.galon).toEqual({ keluar: 10, kembali: 2, rusak: 1 });
  expect(s.stops.ditunda).toBe(1);
  expect(s.koreksiMenunggu).toBe(0);
  expect(s.ritDiBawahSop).toEqual([{ runNo: 1, gallonsOut: 60, reason: 'Rit terakhir' }]);
});
it('matches the delivery report cash (tunai − expense)', async () => {
  const rep = (await request(app).get(`${D}/reports/delivery?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  const f = rep.fleets.find((x) => x.fleetId === 'DK 1');
  expect(f.cash.net).toBe((await summary()).wajibSetor);
  expect(f.cash.transfer).toBe(20000);
});
