'use strict';
process.env.ACCOUNTING_V2 = 'true';
// GANTI RUGI GALON — a customer broke/lost gallons they held. One step, no approval: the gallons leave
// the customer into the rusak/hilang bucket (4-location invariant holds), and the charge is recorded as
// money only (qty 0, kind 'ganti_rugi') — cash/transfer → Pendapatan Lain, bon → Piutang (Sisa Bon).
// It never counts as a gallon sale. Void reverses everything.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, photoId;
const charge = (body) => request(app).post(`${D}/customers/${cid}/gallon-damage`).set(auth(gm)).send({ txnDate: today, photoId, ...body });
const gallon = async () => (await request(app).get(`${D}/gallon`).set(auth(gm))).body.data;
const creditBal = async (code) => (await prisma.journalLine.findMany({ where: { chartAccount: { code } } })).reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
const debitBal = async (code) => (await prisma.journalLine.findMany({ where: { chartAccount: { code } } })).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'gd_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Pak Wayan', type: 'reguler', masterPrice: 18000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 6, method: 'lunas', txnDate: today, gallonOut: 6, gallonIn: 0 });   // holds 6
  photoId = (await request(app).post('/api/v1/attachments').set(auth(gm)).send({ name: 'pecah.jpg', mime: 'image/jpeg', isImg: true, data: 'data:image/jpeg;base64,/9j/4AAQ' })).body.data.id;
  await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ hargaGantiRugiGalon: 45000 });
});
afterAll(() => prisma.$disconnect());

it('refuses without a photo, and more gallons than the customer holds', async () => {
  let r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai', photoId: undefined });
  expect(r.status).toBe(400);
  r = await charge({ qty: 7, kind: 'pecah', payMethod: 'tunai' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/6/);
  expect(await prisma.gallonMovement.count({ where: { type: { in: ['damage_customer', 'loss_customer'] } } })).toBe(0);
});

it('cash charge: gallons move to rusak, invariant holds, money to Pendapatan Lain, not a sale', async () => {
  const before = await gallon();
  const revBefore = await creditBal('4-2000');
  const sales = await creditBal('4-1000');
  const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai' });
  expect(r.status).toBe(201);
  const t = r.body.data.transaction;
  expect(t.kind).toBe('ganti_rugi');
  expect(t.qty).toBe(0);
  expect(t.gallonQty).toBe(1);
  expect(Number(t.amount)).toBe(45000);
  expect(r.body.data.gallonsHeld).toBe(5);
  const after = await gallon();
  expect(after.stock.rusakHilang).toBe(before.stock.rusakHilang + 1);
  expect(after.stock.atCustomers).toBe(before.stock.atCustomers - 1);
  expect(after.invariant.ok).toBe(true);
  const integ = (await request(app).get(`${D}/gallon/integrity`).set(auth(gm))).body.data;
  expect(integ.missingCount).toBe(0);
  expect(integ.orphanCount).toBe(0);
  expect(integ.invariant.ok).toBe(true);
  expect(await creditBal('4-2000')).toBe(revBefore + 45000);
  expect(await creditBal('4-1000')).toBe(sales);   // no gallon-sale revenue
});

it('bon charge raises Sisa Bon and keeps AR == Σ Sisa Bon', async () => {
  const r = await charge({ qty: 2, kind: 'hilang', payMethod: 'bon' });
  expect(r.status).toBe(201);
  expect(r.body.data.sisaBon).toBe(90000);
  expect(await debitBal('1-1200')).toBe(90000);
  expect((await gallon()).invariant.ok).toBe(true);
});

it('is not counted as a sale on the dashboard, but its cash is money-in', async () => {
  const d = (await request(app).get(`${D}/dashboard/summary`).set(auth(gm))).body.data;
  expect(d.byMethod.lunas).toBe(6 * 18000);   // the gallon sale only
  expect(d.byMethod.bon).toBe(0);
  expect(d.todayCash).toBe(6 * 18000 + 45000);
  expect(d.periodQty).toBe(6);
});

it('voiding a ganti rugi row returns the gallons to the customer and reverses the money', async () => {
  const svc = require('../src/services/distribution.service');
  const t = await prisma.distTransaction.findFirst({ where: { kind: 'ganti_rugi', method: 'bon' } });
  const gmUser = await prisma.user.findFirst({ where: { username: 'gd_gm' } });
  const heldBefore = (await gallon()).stock.atCustomers;
  const r = await svc.voidTransaction(t.id, { reason: 'salah catat' }, { id: gmUser.id, role: gmUser.role, username: gmUser.username });
  expect(r.sisaBon).toBe(0);
  expect((await gallon()).stock.atCustomers).toBe(heldBefore + 2);
  expect((await gallon()).invariant.ok).toBe(true);
  expect(await debitBal('1-1200')).toBe(0);
});

it('a correction request on a ganti rugi row is refused (void + re-enter instead)', async () => {
  const t = await prisma.distTransaction.findFirst({ where: { kind: 'ganti_rugi', method: 'lunas' } });
  const r = await request(app).post(`${D}/transactions/${t.id}/corrections`).set(auth(gm)).send({ reason: 'salah', payload: { amount: 1 } });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/ganti rugi/i);
});

it('on the customer invoice a bon charge reads as N galon ganti rugi, not "0 x price"', async () => {
  expect((await charge({ qty: 1, kind: 'retak', payMethod: 'bon' })).status).toBe(201);
  const r = await request(app).post(`${D}/customers/${cid}/invoices`).set(auth(gm)).send({ scope: 'unpaidBon', dueDate: '', note: '' });
  expect(r.status).toBe(201);
  const item = r.body.data.items.find((it) => it.kind === 'ganti_rugi');
  expect(item).toBeTruthy();
  expect(item.qty).toBe(1);
  expect(item.unitPrice).toBe(45000);
  expect(item.amount).toBe(45000);
  expect(item.label).toBe('Ganti rugi galon');
  const html = require('../src/services/invoiceShare.service').renderPublicHtml({ status: 'ok', invoice: { ...r.body.data, customer: { name: 'Pak Wayan' } } });
  expect(html).toMatch(/Ganti rugi galon/);
  const cust = (await request(app).get(`${D}/customers/${cid}`).set(auth(gm))).body.data;
  const row = (cust.transactions || []).find((t) => t.kind === 'ganti_rugi' && t.method === 'bon' && t.status !== 'void');
  expect(row.gallonQty).toBe(1);
});

it('client: the invoice viewer + printed statement label ganti rugi and show its gallon count', () => {
  const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'distribution.jsx'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-i18n.js'), 'utf8');
  expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect((src.match(/kind === 'ganti_rugi' \? trD\('pc\.ketGantiRugi'\)/g) || []).length).toBe(2);
  expect(src).toMatch(/numX\(t\.kind === 'ganti_rugi' \? t\.gallonQty : t\.qty\)/);
  expect((i18n.match(/'pc\.ketGantiRugi':/g) || []).length).toBe(2);
  expect((i18n.match(/'dist\.gmDamageCust':/g) || []).length).toBe(2);
});

describe('owner 2026-10-02: ganti rugi takes the gallons off the asset pool, unless replaced by a new gallon', () => {
  let poolId, owner, gmUser;
  const svc = require('../src/services/distribution.service');
  const asActor = () => ({ id: gmUser.id, role: gmUser.role, username: gmUser.username });
  beforeAll(async () => {
    await require('../src/services/accounting.service').seedChart();
    owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Pemilik', username: 'gd_owner', password: 'secret123', role: 'owner' })).body.token;
    gmUser = await prisma.user.findFirst({ where: { username: 'gd_gm' } });
    poolId = (await request(app).post('/api/v1/accounting/assets').set(auth(owner)).send({ code: 'GAL-P', name: 'Galon', category: 'galon', acquisitionDate: '2026-01-01', acquisitionCost: 400000, salvageValue: 0, usefulLifeMonths: 40, quantity: 100 })).body.data.id;
    await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 6, method: 'lunas', txnDate: today, gallonOut: 6, gallonIn: 0 });   // enough gallons held
  });
  const pool = () => prisma.fixedAsset.findUnique({ where: { id: poolId } });

  it('a cash ganti rugi writes 1 gallon off the pool (Cr 1-1440, Dr 6-8500) once, idempotently', async () => {
    const lossBefore = await debitBal('6-8500');
    const r = await charge({ qty: 1, kind: 'retak', payMethod: 'tunai', clientRef: 'gr-pool-0001' });
    expect(r.status).toBe(201);
    expect((await pool()).quantity).toBe(99);
    const w = await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: r.body.data.transaction.id } });
    expect(w.qty).toBe(1);
    expect(Number(w.cost)).toBe(4000);
    expect(await debitBal('6-8500')).toBe(lossBefore + 4000 - Number(w.accum));
    const again = await charge({ qty: 1, kind: 'retak', payMethod: 'tunai', clientRef: 'gr-pool-0001' });   // replay
    expect(again.body.data.replay).toBe(true);
    expect((await pool()).quantity).toBe(99);
  });

  it('"Diganti galon baru": no money, no journal, the pool and the good stock stay whole', async () => {
    const before = await gallon();
    const q0 = (await pool()).quantity;
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'ganti_galon' });
    expect(r.status).toBe(201);
    const t = r.body.data.transaction;
    expect(Number(t.amount)).toBe(0);
    expect(t.payMethod).toBe('ganti_galon');
    expect((await pool()).quantity).toBe(q0);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'dist_txn', sourceId: t.id } })).toBe(0);
    const after = await gallon();
    expect(after.stock.totalOwned).toBe(before.stock.totalOwned);
    expect(after.stock.rusakHilang).toBe(before.stock.rusakHilang + 1);
    expect(after.stock.atCustomers).toBe(before.stock.atCustomers - 1);
    expect(after.invariant.ok).toBe(true);
    expect(after.movements.some((m) => m.type === 'replace_customer' && m.qty === 1)).toBe(true);
  });

  it('voiding a ganti rugi puts the gallons back in the pool; un-voiding takes them off again', async () => {
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'transfer' });
    const id = r.body.data.transaction.id;
    const q1 = (await pool()).quantity;
    const lossAfterCharge = await debitBal('6-8500');
    await svc.voidTransaction(id, { reason: 'salah catat' }, asActor());
    expect((await pool()).quantity).toBe(q1 + 1);
    expect((await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: id } })).reversedAt).not.toBeNull();
    const w = await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: id } });
    expect(await debitBal('6-8500')).toBe(lossAfterCharge - (Number(w.cost) - Number(w.accum)));
    // bulk void + restore (un-void) on another one: the pool follows both ways, exactly
    const r2 = await charge({ qty: 2, kind: 'hilang', payMethod: 'tunai' });
    const id2 = r2.body.data.transaction.id;
    const q2 = (await pool()).quantity;
    const b = await request(app).post(`${D}/transactions/bulk`).set(auth(gm)).send({ ids: [id2], action: 'batal', note: 'uji batal' });
    expect(b.status).toBe(200);
    expect((await pool()).quantity).toBe(q2 + 2);
    const rs = await request(app).post(`${D}/transactions/bulk/restore`).set(auth(gm)).send({ batchId: b.body.data.batchId });
    expect(rs.status).toBe(200);
    expect((await pool()).quantity).toBe(q2);
    const w2 = await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: id2 } });
    expect(w2.reversedAt).toBeNull();
    expect(w2.version).toBe(2);
  });

  it('with no gallon pool registered the ganti rugi still saves (nothing to write off)', async () => {
    await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'dilepas' } });
    const r = await charge({ qty: 1, kind: 'pecah', payMethod: 'tunai' });
    expect(r.status).toBe(201);
    expect(await prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: r.body.data.transaction.id } })).toBeNull();
    await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'aktif' } });
  });
});

describe('final review: hard-deleting a ganti rugi (or its customer) puts the gallons back in the asset pool', () => {
  let own, poolId2;
  const wo = (id) => prisma.gallonPoolWriteOff.findUnique({ where: { transactionId: id } });
  const woJournals = (id) => prisma.journalEntry.count({ where: { sourceType: { in: ['ganti_rugi_writeoff', 'ganti_rugi_writeoff_rev'] }, sourceId: { startsWith: id + ':' } } });
  beforeAll(async () => {
    own = (await request(app).post('/api/v1/auth/register').send({ name: 'Pemilik2', username: 'gd_owner2', password: 'secret123', role: 'owner' })).body.token;
    poolId2 = (await prisma.fixedAsset.findFirst({ where: { pooled: true, category: 'galon', status: 'aktif' } })).id;
    await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 6, method: 'lunas', txnDate: today, gallonOut: 6, gallonIn: 0 });
  });
  const pq = async () => (await prisma.fixedAsset.findUnique({ where: { id: poolId2 } })).quantity;

  it('single hard delete: pool back, no write-off journal or row left', async () => {
    const q0 = await pq();
    const id = (await charge({ qty: 2, kind: 'pecah', payMethod: 'tunai' })).body.data.transaction.id;
    expect(await pq()).toBe(q0 - 2);
    const r = await request(app).delete(`${D}/transactions/${id}`).set(auth(own)).send({ reason: 'salah input', confirm: 'HAPUS', password: 'secret123' });
    expect(r.status).toBe(200);
    expect(await pq()).toBe(q0);
    expect(await wo(id)).toBeNull();
    expect(await woJournals(id)).toBe(0);
  });

  it('bulk hapus puts them back; restoring the deletion writes them off again', async () => {
    const q0 = await pq();
    const id = (await charge({ qty: 1, kind: 'pecah', payMethod: 'transfer' })).body.data.transaction.id;
    const b = await request(app).post(`${D}/transactions/bulk`).set(auth(own)).send({ ids: [id], action: 'hapus', note: 'uji hapus', confirm: 'HAPUS' });
    expect(b.status).toBe(200);
    expect(b.body.data.done).toBe(1);
    expect(await pq()).toBe(q0);
    expect(await wo(id)).toBeNull();
    const rs = await request(app).post(`${D}/transactions/bulk/restore`).set(auth(own)).send({ batchId: b.body.data.batchId });
    expect(rs.status).toBe(200);
    expect(await pq()).toBe(q0 - 1);
    expect((await wo(id)).reversedAt).toBeNull();
  });

  it('deleting the customer puts their ganti rugi gallons back and removes the new-gallon movement too', async () => {
    const c2 = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko Hapus', type: 'reguler', masterPrice: 18000, armada: 'DK 1' })).body.data.id;
    await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: c2, qty: 4, method: 'lunas', txnDate: today, gallonOut: 4, gallonIn: 0 });
    const q0 = await pq();
    const ch = (body) => request(app).post(`${D}/customers/${c2}/gallon-damage`).set(auth(gm)).send({ txnDate: today, photoId, ...body });
    const id1 = (await ch({ qty: 1, kind: 'pecah', payMethod: 'tunai' })).body.data.transaction.id;
    const id2 = (await ch({ qty: 1, kind: 'pecah', payMethod: 'ganti_galon' })).body.data.transaction.id;
    expect(await pq()).toBe(q0 - 1);
    const d = await request(app).delete(`${D}/customers/${c2}`).set(auth(own));
    expect(d.status).toBe(200);
    expect(await pq()).toBe(q0);
    expect(await wo(id1)).toBeNull();
    expect(await woJournals(id1)).toBe(0);
    expect(await prisma.gallonMovement.count({ where: { transactionId: { in: [id1, id2] } } })).toBe(0);
    expect((await gallon()).invariant.ok).toBe(true);
  });
});
