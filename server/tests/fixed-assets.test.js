'use strict';
// FIXED ASSETS & DEPRECIATION on the double-entry engine. Asserts:
//  • straight-line 60.000.000 / 60mo / 0 salvage → 1.000.000/month, book value EXACTLY 0 at month 60,
//    never negative;
//  • the monthly run is idempotent (running twice posts once);
//  • disposal at month 30 for 40.000.000 books a 10.000.000 GAIN and leaves the balance sheet balanced;
//  • isProduction routes the charge to COGS (5-2000), others to opex (6-8000);
//  • closing a period with unposted depreciation is BLOCKED and the reason names the count;
//  • a pooled gallon asset's quantity matches the gallon ledger's total-owned/dimiliki.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner;
beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Owner', username: 'fa_owner', password: 'secret123', role: 'owner' })).body.token;
});
afterAll(() => prisma.$disconnect());

const mkAsset = (body) => request(app).post('/api/v1/accounting/assets').set(auth(owner)).send(body);
const getAsset = (id) => request(app).get('/api/v1/accounting/assets/' + id).set(auth(owner)).then((r) => r.body.data);
const depreciate = (asOf, assetId) => request(app).post('/api/v1/accounting/depreciate').set(auth(owner)).send({ asOf, assetId });
const balanceSheet = () => request(app).get('/api/v1/accounting/balance-sheet').set(auth(owner)).then((r) => r.body.data);
const trial = () => request(app).get('/api/v1/accounting/trial-balance').set(auth(owner)).then((r) => r.body.data);
const STD = { code: 'AST-1', name: 'Mesin RO', category: 'mesin_ro', acquisitionDate: '2026-01-01', acquisitionCost: 60000000, salvageValue: 0, usefulLifeMonths: 60, method: 'garis_lurus' };

describe('Straight-line depreciation', () => {
  it('60jt / 60mo / 0 salvage → 1jt/month, book value exactly 0 at month 60, never negative', async () => {
    const a = (await mkAsset(STD)).body.data;
    expect(a.monthlyCharge).toBe(1000000);
    const full = await getAsset(a.id);
    expect(full.schedule).toHaveLength(60);
    expect(full.schedule.every((r) => r.charge === 1000000)).toBe(true);
    expect(full.schedule.every((r) => r.bookValue >= 0)).toBe(true);        // never negative
    expect(full.schedule[59].bookValue).toBe(0);                            // exactly zero at month 60
    expect(full.schedule[59].period).toBe('2030-12');
    // post it all and confirm the ledger agrees
    await depreciate('2030-12-31', a.id);
    const posted = await getAsset(a.id);
    expect(posted.accumulated).toBe(60000000);
    expect(posted.bookValue).toBe(0);
    expect(posted.remainingMonths).toBe(0);
  });

  it('the monthly run is idempotent — running it twice posts once', async () => {
    const a = (await mkAsset(STD)).body.data;
    const r1 = (await depreciate('2026-03-31', a.id)).body.data;   // Jan, Feb, Mar
    expect(r1.posted).toBe(3);
    const r2 = (await depreciate('2026-03-31', a.id)).body.data;   // same window again
    expect(r2.posted).toBe(0);
    expect((await getAsset(a.id)).accumulated).toBe(3000000);
    expect(await prisma.depreciationEntry.count({ where: { assetId: a.id } })).toBe(3);
  });
});

describe('Disposal', () => {
  it('at month 30 for 40jt → 10jt GAIN, balance sheet stays balanced', async () => {
    const a = (await mkAsset(STD)).body.data;
    await depreciate('2028-06-30', a.id);   // 30 months (2026-01 … 2028-06)
    expect((await getAsset(a.id)).accumulated).toBe(30000000);   // book value 30jt
    const disp = (await request(app).post(`/api/v1/accounting/assets/${a.id}/dispose`).set(auth(owner)).send({ disposalDate: '2028-06-30', disposalProceeds: 40000000, status: 'dijual' })).body.data;
    expect(disp.disposal.bookValue).toBe(30000000);
    expect(disp.disposal.gain).toBe(10000000);   // 40jt proceeds − 30jt book
    expect(disp.status).toBe('dijual');
    const bs = await balanceSheet();
    expect(bs.balanced).toBe(true);
    const tb = await trial();
    expect(tb.balanced).toBe(true);
  });
});

describe('Production routing (COGS vs opex)', () => {
  it('isProduction routes the charge to COGS 5-2000; a normal asset to opex 6-8000', async () => {
    const prod = (await mkAsset({ ...STD, code: 'PRD', name: 'RO Produksi', isProduction: true })).body.data;
    const ops = (await mkAsset({ ...STD, code: 'OPS', name: 'Mobil Kantor', category: 'kendaraan', isProduction: false })).body.data;
    expect(prod.expenseCode).toBe('5-2000');
    expect(ops.expenseCode).toBe('6-8000');
    await depreciate('2026-01-31');   // all assets, one month
    const tb = await trial();
    const cogs = tb.rows.find((r) => r.code === '5-2000');
    const opex = tb.rows.find((r) => r.code === '6-8000');
    expect(cogs && cogs.debit).toBe(1000000);   // production depreciation → COGS
    expect(opex && opex.debit).toBe(1000000);   // operating depreciation → opex
  });
});

describe('Tutup Buku blocks on unposted depreciation', () => {
  it('closing a period with unposted depreciation is rejected and the reason names the asset count', async () => {
    const a = (await mkAsset(STD)).body.data;
    const chk = (await request(app).get('/api/v1/accounting/periods/checklist?year=2026&month=1').set(auth(owner))).body.data;
    expect(chk.deprPending).toBe(1);
    expect(chk.deprAssets).toBe(1);
    expect(chk.clean).toBe(false);
    const blocked = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 1 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/1 aset/);
    expect(blocked.body.error.details.deprAssets).toBe(1);
    // post it → the checklist clears and the close succeeds
    await depreciate('2026-01-31', a.id);
    expect((await request(app).get('/api/v1/accounting/periods/checklist?year=2026&month=1').set(auth(owner))).body.data.deprPending).toBe(0);
    const ok = await request(app).post('/api/v1/accounting/periods/close').set(auth(owner)).send({ year: 2026, month: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.period.status).toBe('ditutup');
  });
});

describe('Declining balance never goes below salvage', () => {
  it('saldo_menurun floors at salvage value and never goes negative', async () => {
    const a = (await mkAsset({ code: 'DDB', name: 'Kendaraan', category: 'kendaraan', acquisitionDate: '2026-01-01', acquisitionCost: 10000000, salvageValue: 1000000, usefulLifeMonths: 24, method: 'saldo_menurun' })).body.data;
    const full = await getAsset(a.id);
    expect(full.schedule.every((r) => r.bookValue >= 1000000)).toBe(true);   // never below salvage
    expect(full.schedule[full.schedule.length - 1].bookValue).toBe(1000000); // reaches salvage exactly
  });
});

describe('Gallons as a pooled asset', () => {
  it('the pool quantity matches the gallon ledger total-owned/dimiliki', async () => {
    // seed the gallon ledger: 500 owned, no rusak/hilang → totalOwned == totalDimiliki == 500
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
    const pool = (await mkAsset({ code: 'GLN-POOL', name: 'Galon (pool)', category: 'galon', acquisitionDate: '2026-01-01', acquisitionCost: 25000000, salvageValue: 0, usefulLifeMonths: 36, method: 'garis_lurus', pooled: true, quantity: 500 })).body.data;
    expect(pool.pooled).toBe(true);
    expect(pool.quantity).toBe(500);
    const rec = (await request(app).get(`/api/v1/accounting/assets/${pool.id}/reconcile-pool`).set(auth(owner))).body.data;
    expect(rec.totalOwned).toBe(500);
    expect(rec.totalDimiliki).toBe(500);
    expect(rec.poolQuantity).toBe(500);
    expect(rec.drift).toBe(0);
    expect(rec.matchesDimiliki).toBe(true);
  });
});
