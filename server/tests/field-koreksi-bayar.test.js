'use strict';
process.env.ACCOUNTING_V2 = 'true';
// KOREKSI CARA BAYAR (Mode Lapangan 3C): a delivered sale's "Cara bayar" can be corrected to Transfer
// (or back) through the SAME approval flow as every correction. Switching TO transfer needs the transfer
// receipt photo; on approval the cash leaves Kas for Bank and the day's deposit drops by the amount.
// An untouched pay method is never rewritten (a legacy '' row keeps its note-based meaning).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const bal = async (code) => { const lines = await prisma.journalLine.findMany({ where: { chartAccount: { code } } }); return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0); };
const photo = async (t) => (await request(app).post('/api/v1/attachments').set(auth(t)).send({ name: 't.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,AAAA' })).body.data.id;
const SALE = { qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 };
let gm, staff, cid, saleId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'kb_gm', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Sopir', username: 'kb_staff', password: 'secret123', role: 'finance' });
  await request(app).patch(`/api/v1/users/${s.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiPengiriman: true } });
  staff = await login('kb_staff');
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko KB', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal', fleet: 'DK 1' });
  saleId = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 3, method: 'lunas', payMethod: 'tunai', txnDate: today, gallonOut: 3, proofPhotoId: await photo(gm), proofLat: -8.6, proofLng: 115.2 })).body.data.id;
});
afterAll(() => prisma.$disconnect());

it('switching to transfer needs the transfer receipt photo; an unknown pay method is refused', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'dibayar transfer', ...SALE, method: 'lunas', payMethod: 'transfer' });
  expect(r.status).toBe(400);
  expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
  const bad = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'x', ...SALE, payMethod: 'kartu' });
  expect(bad.status).toBe(400);
});

it('the preview shows the pay method change without needing the photo yet', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections/preview`).set(auth(staff)).send({ ...SALE, method: 'lunas', payMethod: 'transfer' });
  expect(r.status).toBe(200);
  expect(r.body.data).toMatchObject({ payMethod: 'tunai', requestedPayMethod: 'transfer', oldAmount: 18000, newAmount: 18000 });
});

it('the request names the customer and the pay change; approval moves the cash from Kas to Bank', async () => {
  const pid = await photo(staff);
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'dibayar transfer', ...SALE, method: 'lunas', payMethod: 'transfer', proofPhotoId: pid });
  expect(r.status).toBe(201);
  expect(r.body.data).toMatchObject({ customerId: cid, current: { method: 'lunas', payMethod: 'tunai' }, requested: { payMethod: 'transfer' } });
  const kas0 = await bal('1-1000'); const bank0 = await bal('1-1100');
  const a = await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  expect(a.status).toBe(200);
  const t = await prisma.distTransaction.findUnique({ where: { id: saleId } });
  expect(t.payMethod).toBe('transfer'); expect(t.proofPhotoId).toBe(pid);
  expect(kas0 - (await bal('1-1000'))).toBe(18000);
  expect((await bal('1-1100')) - bank0).toBe(18000);
  const sum = (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
  expect(sum.transfer).toBe(18000); expect(sum.tunaiPenjualan).toBe(0);
});

it('lunas → bon clears the pay method; a qty-only correction never rewrites it', async () => {
  const r = await request(app).post(`${D}/transactions/${saleId}/corrections`).set(auth(staff)).send({ reason: 'ternyata bon', ...SALE, method: 'bon' });
  await request(app).post(`${D}/change-requests/${r.body.data.id}/approve`).set(auth(gm)).send({});
  expect((await prisma.distTransaction.findUnique({ where: { id: saleId } })).payMethod).toBe('');
  const legacy = (await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 2, method: 'lunas', txnDate: today, gallonOut: 2 })).body.data.id;
  await prisma.distTransaction.update({ where: { id: legacy }, data: { payMethod: '' } });   // an old row
  const q = await request(app).post(`${D}/transactions/${legacy}/corrections`).set(auth(staff)).send({ reason: 'salah hitung', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0, method: 'lunas' });
  await request(app).post(`${D}/change-requests/${q.body.data.id}/approve`).set(auth(gm)).send({});
  expect((await prisma.distTransaction.findUnique({ where: { id: legacy } })).payMethod).toBe('');
});

it('the customer detail carries each transaction\'s photo location (for "which customer was it?")', async () => {
  const d = (await request(app).get(`${D}/customers/${cid}`).set(auth(staff))).body.data;
  expect(d.transactions.find((x) => x.id === saleId)).toMatchObject({ proofLat: -8.6, proofLng: 115.2 });
});
