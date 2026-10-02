'use strict';
process.env.ACCOUNTING_V2 = 'true';
// GALLON POOL WRITE-OFF CORE — removing N gallons from the pooled gallon asset takes their share of cost,
// accumulated depreciation AND salvage; the written-off accumulated is remembered so the register's book
// value stays equal to the ledger (1-1440 − 1-1900). Two write-offs of the same size on the same day both post.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const dep = require('../src/services/depreciation.service');
const acc = require('../src/services/accounting.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let owner, poolId;
const bal = async (code) => (await prisma.journalLine.findMany({ where: { chartAccount: { code } } })).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Pemilik', username: 'pw_owner', password: 'secret123', role: 'owner' })).body.token;
  const a = await request(app).post('/api/v1/accounting/assets').set(auth(owner)).send({ code: 'GAL-1', name: 'Galon', category: 'galon', acquisitionDate: '2026-01-15', acquisitionCost: 1000000, salvageValue: 100000, usefulLifeMonths: 20, quantity: 100 });
  poolId = a.body.data.id;
  await request(app).post('/api/v1/accounting/depreciate').set(auth(owner)).send({ asOf: '2026-05-31' });   // 5 months posted
});
afterAll(() => prisma.$disconnect());

it('writes off its share of cost, accumulated and salvage; the register book value equals the ledger', async () => {
  const before = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  const accum = await dep.accumulatedOf(before);
  expect(accum).toBeGreaterThan(0);
  await prisma.$transaction((tx) => dep.writeOffPool({ asset: before, qty: 10, date: '2026-06-02', kind: 'rusak', sourceType: 'gallon_pool_loss', sourceId: 't:1', actor: null }, tx));
  const after = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  expect(after.quantity).toBe(90);
  expect(Number(after.acquisitionCost)).toBe(900000);
  expect(Number(after.salvageValue)).toBe(90000);
  expect(Number(after.writtenOffAccum)).toBe(Math.round(accum / 100) * 10);
  const reg = (await request(app).get('/api/v1/accounting/assets/' + poolId).set(auth(owner))).body.data;
  expect(reg.bookValue).toBe((await bal('1-1440')) + (await bal('1-1900')));
  // a later month's depreciation keeps register == ledger
  await request(app).post('/api/v1/accounting/depreciate').set(auth(owner)).send({ asOf: '2026-06-30' });
  const reg2 = (await request(app).get('/api/v1/accounting/assets/' + poolId).set(auth(owner))).body.data;
  expect(reg2.bookValue).toBe((await bal('1-1440')) + (await bal('1-1900')));
});

it('two write-offs of the same size on the same day both post (no sourceId collision)', async () => {
  const a = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  expect((await request(app).post('/api/v1/accounting/assets/' + poolId + '/pool-loss').set(auth(owner)).send({ qty: 2, kind: 'rusak', date: '2026-06-03' })).status).toBe(200);
  expect((await request(app).post('/api/v1/accounting/assets/' + poolId + '/pool-loss').set(auth(owner)).send({ qty: 2, kind: 'rusak', date: '2026-06-03' })).status).toBe(200);
  expect((await prisma.fixedAsset.findUnique({ where: { id: poolId } })).quantity).toBe(a.quantity - 4);
  expect(await prisma.journalEntry.count({ where: { sourceType: 'gallon_pool_loss', date: '2026-06-03' } })).toBe(2);
});

it('restorePool puts back exactly what was taken', async () => {
  const a = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  const w = await prisma.$transaction((tx) => dep.writeOffPool({ asset: a, qty: 5, date: '2026-06-04', kind: 'rusak', sourceType: 'gallon_pool_loss', sourceId: 't:2', actor: null }, tx));
  const mid = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  await prisma.$transaction((tx) => dep.restorePool({ asset: mid, qty: 5, cost: w.cost, accum: w.accum, salvage: w.salvage, date: '2026-06-04', sourceType: 'gallon_pool_loss', sourceId: 't:2', actor: null }, tx));
  const back = await prisma.fixedAsset.findUnique({ where: { id: poolId } });
  expect(back.quantity).toBe(a.quantity);
  expect(Number(back.acquisitionCost)).toBe(Number(a.acquisitionCost));
  expect(Number(back.salvageValue)).toBe(Number(a.salvageValue));
  expect(Number(back.writtenOffAccum)).toBe(Number(a.writtenOffAccum));
  const reg = (await request(app).get('/api/v1/accounting/assets/' + poolId).set(auth(owner))).body.data;
  expect(reg.bookValue).toBe((await bal('1-1440')) + (await bal('1-1900')));
});

it('findGallonPool prefers the armada\'s own pool, else any active gallon pool, else null', async () => {
  expect((await dep.findGallonPool('DK 9')).id).toBe(poolId);
  await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'dilepas' } });
  expect(await dep.findGallonPool('DK 9')).toBeNull();
  await prisma.fixedAsset.update({ where: { id: poolId }, data: { status: 'aktif' } });
});
