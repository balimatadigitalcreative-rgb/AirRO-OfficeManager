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
