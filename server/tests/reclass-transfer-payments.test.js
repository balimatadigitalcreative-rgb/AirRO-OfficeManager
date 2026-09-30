'use strict';
process.env.ACCOUNTING_V2 = 'true';
// Older bon settlements paid by transfer were posted to KAS (the note carried "· Transfer"). The script
// LISTS them without writing; --apply sets payMethod='transfer' and reconciles each journal to Bank.
// Idempotent: a second apply changes nothing.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');
const script = require('../scripts/reclass-transfer-payments');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm, cid, legacyId;
const bal = async (code) => {
  const lines = await prisma.journalLine.findMany({ where: { chartAccount: { code } } });
  return lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
};

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'rc_gm', password: 'secret123', role: 'gm' })).body.token;
  cid = (await request(app).post(`${D}/customers`).set(auth(gm)).send({ name: 'Toko RC', type: 'reguler', masterPrice: 10000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 100, reason: 'stok awal' });
  await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: today });
  // A legacy-shaped transfer settlement: posted the old way (payMethod '' → Kas), note tag only.
  const r = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, method: 'pelunasan', payAmount: 20000, payMethod: 'cash', txnDate: today });
  legacyId = r.body.data.id;
  await prisma.distTransaction.update({ where: { id: legacyId }, data: { payMethod: '', note: 'bayar · Transfer' } });
});
afterAll(() => prisma.$disconnect());

it('--list reports the legacy transfer rows and writes nothing', async () => {
  const kasBefore = await bal('1-1000');
  const l = await script.listLegacyTransfers();
  expect(l.count).toBe(1);
  expect(l.total).toBe(20000);
  expect(await bal('1-1000')).toBe(kasBefore);
  expect((await prisma.distTransaction.findUnique({ where: { id: legacyId } })).payMethod).toBe('');
});

it('--apply moves the money from Kas to Bank, once', async () => {
  const kas = await bal('1-1000'); const bank = await bal('1-1100');
  const a = await script.applyReclass({ id: null, name: 'test' });
  expect(a.changed).toBe(1);
  expect(await bal('1-1000')).toBe(kas - 20000);
  expect(await bal('1-1100')).toBe(bank + 20000);
  expect((await script.applyReclass({ id: null, name: 'test' })).changed).toBe(0);
  expect((await script.listLegacyTransfers()).count).toBe(0);
});

describe('closed periods (Tutup Buku)', () => {
  let closedId;
  beforeAll(async () => {
    // A legacy transfer settlement in January, whose month is closed.
    await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, qty: 3, method: 'bon', txnDate: '2026-01-10' });
    const r = await request(app).post(`${D}/transactions`).set(auth(gm)).send({ customerId: cid, method: 'pelunasan', payAmount: 5000, payMethod: 'cash', txnDate: '2026-01-15' });
    closedId = r.body.data.id;
    await prisma.distTransaction.update({ where: { id: closedId }, data: { payMethod: '', note: 'lama · Transfer' } });
    await prisma.accountingPeriod.create({ data: { periodKey: '2026-01', year: 2026, month: 1, status: 'ditutup' } });
  });

  it('--list flags a row whose month is closed, and keeps it out of the applicable total', async () => {
    const l = await script.listLegacyTransfers();
    const row = l.rows.find((x) => x.id === closedId);
    expect(row.periodClosed).toBe(true);
    expect(l.closedCount).toBe(1);
    expect(l.count).toBe(0);          // nothing left that --apply may change
  });

  it('--apply skips it: the closed month\'s Kas/Bank do not move', async () => {
    const kas = await bal('1-1000'); const bank = await bal('1-1100');
    const a = await script.applyReclass({ id: null, name: 'test' });
    expect(a.changed).toBe(0);
    expect(a.skippedClosed).toBe(1);
    expect(await bal('1-1000')).toBe(kas);
    expect(await bal('1-1100')).toBe(bank);
    expect((await prisma.distTransaction.findUnique({ where: { id: closedId } })).payMethod).toBe('');
  });
});
