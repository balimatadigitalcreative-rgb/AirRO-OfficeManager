'use strict';
process.env.ACCOUNTING_V2 = 'true';   // the journal assertions below need live posting
// FOTO BUKTI + TRANSFER — a sale can be paid by transfer (not only bon settlements); the money lands in
// BANK, cash stays in KAS; every txn can carry a proof photo, mandatory once the owner switches it on.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, photoId;
const post = (body) => request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, txnDate: today, ...body });
const cashCodeOf = async (txnId) => {
  const e = await prisma.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: 'dist_txn', sourceId: txnId } }, include: { lines: { include: { chartAccount: true } } } });
  const debit = e.lines.find((l) => Number(l.debit) > 0 && ['1-1000', '1-1100'].includes(l.chartAccount.code));
  return debit ? debit.chartAccount.code : null;
};

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'pt_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko PT', type: 'reguler', masterPrice: 18000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 500, reason: 'stok awal' });
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'bukti.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('transfer + Kas/Bank', () => {
  it('a cash sale posts to Kas', async () => {
    const r = await post({ qty: 2, method: 'lunas' });
    expect(r.status).toBe(201);
    expect(await cashCodeOf(r.body.data.id)).toBe('1-1000');
  });
  it('a transfer sale posts to Bank and is stored as lunas + payMethod transfer', async () => {
    const r = await post({ qty: 2, method: 'lunas', payMethod: 'transfer', proofPhotoId: photoId });
    expect(r.status).toBe(201);
    expect(r.body.data.method).toBe('lunas');
    expect(r.body.data.payMethod).toBe('transfer');
    expect(await cashCodeOf(r.body.data.id)).toBe('1-1100');
  });
  it('a pelunasan by transfer posts to Bank; by cash to Kas', async () => {
    await post({ qty: 5, method: 'bon' });
    const tf = await post({ method: 'pelunasan', payAmount: 18000, payMethod: 'transfer' });
    expect(tf.body.data.payMethod).toBe('transfer');
    expect(await cashCodeOf(tf.body.data.id)).toBe('1-1100');
    const cash = await post({ method: 'pelunasan', payAmount: 18000, payMethod: 'cash' });
    expect(cash.body.data.payMethod).toBe('tunai');
    expect(await cashCodeOf(cash.body.data.id)).toBe('1-1000');
  });
  it('the dashboard counts a transfer sale as transfer money-in, not cash to deposit', async () => {
    const s = (await request(app).get(`${D}/dashboard/summary`).set(auth(gm))).body.data;
    expect(s.todayTransfer).toBe(36000 + 18000);   // transfer sale 2×18000 + transfer pelunasan
    expect(s.todayCash).toBe(36000 + 18000);       // cash sale 2×18000 + cash pelunasan
  });
  it('a legacy pelunasan tagged "· Transfer" in the note still counts as transfer', async () => {
    const t = await prisma.distTransaction.create({ data: { customerId: cid, fleetId: 'DK 1', qty: 0, unitPriceLocked: 0, amount: 1000, method: 'pelunasan', note: 'lama · Transfer', txnDate: today } });
    const svc = require('../src/services/distribution.service');
    expect(svc.isTransferPayment(t)).toBe(true);
    await prisma.distTransaction.delete({ where: { id: t.id } });
  });
});

describe('foto bukti', () => {
  it('stores the proof photo + where/when it was taken', async () => {
    const r = await post({ qty: 1, method: 'lunas', proofPhotoId: photoId, proofTakenAt: new Date().toISOString(), proofLat: -8.67, proofLng: 115.22 });
    expect(r.body.data.proofPhotoId).toBe(photoId);
    const row = await prisma.distTransaction.findUnique({ where: { id: r.body.data.id } });
    expect(row.proofLat).toBeCloseTo(-8.67);
    expect(row.proofTakenAt).toBeTruthy();
  });
  it('switch off: a txn without a photo is accepted', async () => {
    expect((await post({ qty: 1, method: 'lunas' })).status).toBe(201);
  });
  it('switch on: sales AND bon payments need a photo; an unknown photo id is refused', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoTransaksi: true });
    let r = await post({ qty: 1, method: 'bon' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
    r = await post({ method: 'pelunasan', payAmount: 1000, payMethod: 'cash' });
    expect(r.status).toBe(400);
    r = await post({ qty: 1, method: 'bon', proofPhotoId: 'tidak-ada' });
    expect(r.status).toBe(400);
    expect((await post({ qty: 1, method: 'bon', proofPhotoId: photoId })).status).toBe(201);
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoTransaksi: false });
  });
  it('expense receipt photo: optional until switched on', async () => {
    const x = (body) => request(app).post(`${D}/expenses`).set(auth(gm)).send({ date: today, fleet: 'DK 1', amount: 150000, category: 'bensin', ...body });
    expect((await x({})).status).toBe(201);
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ wajibFotoPengeluaran: true });
    const r = await x({});
    expect(r.status).toBe(400);
    expect(r.body.error.details.code).toBe('PROOF_REQUIRED');
    expect((await x({ photoId })).status).toBe(201);
  });
});
