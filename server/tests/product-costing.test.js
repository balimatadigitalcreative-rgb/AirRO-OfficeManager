'use strict';
// HPP / PRODUCT COSTING — standard costing + variance analysis. Asserts:
//  • a run at standard posts finished goods at STANDARD with every difference in named variances + no
//    residual; a 10% material price rise → exactly that unfavourable price variance + zero qty variance;
//  • producing below normalVolume → an unfavourable VOLUME variance and nothing else;
//  • month-end close leaves the variance accounts at zero;
//  • the P&L HPP line equals the costing module's figure;
//  • accounting inventory quantity equals the gallon ledger's depot + armada;
//  • gallon-loss quantity in costing equals the gallon ledger's rusak/hilang for the period.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner, gm;
beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  owner = (await request(app).post('/api/v1/auth/register').send({ name: 'Owner', username: 'pc_owner', password: 'secret123', role: 'owner' })).body.token;
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'pc_gm', password: 'secret123', role: 'gm' })).body.token;
});
afterAll(() => prisma.$disconnect());

// Standard: 500 material + 300 var-OH + 200 fixed-OH + 100 labour = 1100/galon.
const LINES = [
  { component: 'air_baku', category: 'bahan_langsung', qtyPerUnit: 1, unit: 'galon', unitCost: 500, chartCode: '6-3000' },
  { component: 'listrik', category: 'overhead_variabel', qtyPerUnit: 1, unit: 'kWh', unitCost: 300, chartCode: '6-5000' },
  { component: 'penyusutan_mesin', category: 'overhead_tetap', qtyPerUnit: 1, unit: 'galon', unitCost: 200, chartCode: '6-4000' },
  { component: 'tenaga_kerja', category: 'tenaga_kerja', qtyPerUnit: 1, unit: 'jam', unitCost: 100, chartCode: '6-1000' },
];
// Inputs AT STANDARD for `units` (fixed OH input carries the FULL period fixed cost when below normal).
const stdInputs = (units, fixedActual) => ([
  { component: 'air_baku', category: 'bahan_langsung', actualQty: units, actualCost: 500 * units, chartCode: '6-3000' },
  { component: 'listrik', category: 'overhead_variabel', actualQty: units, actualCost: 300 * units, chartCode: '6-5000' },
  { component: 'penyusutan_mesin', category: 'overhead_tetap', actualQty: units, actualCost: fixedActual != null ? fixedActual : 200 * units, chartCode: '6-4000' },
  { component: 'tenaga_kerja', category: 'tenaga_kerja', actualQty: units, actualCost: 100 * units, chartCode: '6-1000' },
]);

// Create + activate a standard (gm requests, owner approves — different users, no self-approval).
async function activeStandard(normalVolume, from = '2026-01-01') {
  const std = (await request(app).post('/api/v1/accounting/cost-standards').set(auth(gm)).send({ effectiveFrom: from, normalVolume, lines: LINES })).body.data;
  const rq = (await request(app).post(`/api/v1/accounting/cost-standards/${std.id}/request-activation`).set(auth(gm)).send({})).body.data;
  const ap = await request(app).post(`/api/v1/distribusi/change-requests/${rq.requestId}/approve`).set(auth(owner)).send({});
  expect(ap.status).toBe(200);
  return (await request(app).get(`/api/v1/accounting/cost-standards/${std.id}`).set(auth(owner))).body.data;
}
const completeRun = (body) => request(app).post('/api/v1/accounting/production-runs').set(auth(owner)).send(body).then((r) => request(app).post(`/api/v1/accounting/production-runs/${r.body.data.id}/complete`).set(auth(owner)).send({}));
const ledgerBal = async (code, from, to) => { const r = await acc.accountBalances({ dateFrom: from, dateTo: to }); const a = r.find((x) => x.code === code); return a ? a.balance : 0; };

describe('Standard costing — activation + run posting', () => {
  it('a standard activates via the DistChangeRequest engine', async () => {
    const std = await activeStandard(100);
    expect(std.status).toBe('aktif');
    expect(std.perUnit).toBe(1100);
    expect(std.fixedRatePerUnit).toBe(200);
  });

  it('a run of 100 galon at standard posts inventory at standard, all difference in named variances, no residual', async () => {
    const std = await activeStandard(100);   // normalVolume 100 == output → no volume variance
    const r = await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs: stdInputs(100) });
    expect(r.status).toBe(200);
    const v = r.body.data.variances;
    expect(Object.values(v).every((x) => x === 0)).toBe(true);        // at standard → every named variance zero
    expect(await ledgerBal('1-1350', '2026-01-01', '2026-01-31')).toBe(110000);   // finished goods at STANDARD (100 × 1100)
    // no residual: the journal balanced (postJournal would have thrown otherwise); trial balance holds
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('a 10% material price rise → exactly the unfavourable price variance and zero quantity variance', async () => {
    const std = await activeStandard(100);
    const inputs = stdInputs(100);
    inputs[0].actualCost = Math.round(500 * 1.1) * 100;   // air baku +10% → 550 × 100
    const r = await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs });
    const v = r.body.data.variances;
    expect(v.price).toBe(5000);   // (550 − 500) × 100 — UNFAVOURABLE
    expect(v.qty).toBe(0);
    expect(v.rate).toBe(0); expect(v.eff).toBe(0); expect(v.spending).toBe(0); expect(v.volume).toBe(0);
    expect(await ledgerBal('5-3100', '2026-01-01', '2026-01-31')).toBe(5000);   // posted to its OWN account
  });

  it('producing below normalVolume → an unfavourable VOLUME variance and nothing else', async () => {
    const std = await activeStandard(1000);   // normal 1000, produce 100 → volume variance
    // fixed OH actual = the FULL period fixed cost (200 × 1000), incurred regardless of output
    const r = await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs: stdInputs(100, 200 * 1000) });
    const v = r.body.data.variances;
    expect(v.volume).toBe(180000);   // 200 × (1000 − 100) — UNFAVOURABLE (below normal)
    expect(v.spending).toBe(0);
    expect(v.price).toBe(0); expect(v.qty).toBe(0); expect(v.rate).toBe(0); expect(v.eff).toBe(0);
    expect(await ledgerBal('5-3600', '2026-01-01', '2026-01-31')).toBe(180000);
  });
});

describe('Month-end variance close', () => {
  it('closing leaves every variance account at zero', async () => {
    const std = await activeStandard(1000);
    await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs: stdInputs(100, 200 * 1000) });   // volume variance 180000
    const before = await request(app).get('/api/v1/accounting/costing/variance-report?year=2026&month=1').set(auth(owner));
    expect(before.body.data.total).not.toBe(0);
    const close = await request(app).post('/api/v1/accounting/costing/close-variances').set(auth(owner)).send({ year: 2026, month: 1 });
    expect(close.status).toBe(200);
    for (const code of ['5-3100', '5-3200', '5-3300', '5-3400', '5-3500', '5-3600']) {
      expect(await ledgerBal(code, '2026-01-01', '2026-01-31')).toBe(0);
    }
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});

describe('HPP integration', () => {
  it('the P&L HPP line equals the costing module figure', async () => {
    const std = await activeStandard(100);
    await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs: stdInputs(100) });
    // sell 30 galon → HPP-on-sale at standard (30 × 1100)
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 100, reason: 'stok awal', fleet: 'Merah' });
    const cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Toko', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 30, method: 'lunas', txnDate: '2026-01-15', gallonOut: 30 });
    const mod = (await request(app).get('/api/v1/accounting/costing/monthly-hpp?year=2026&month=1').set(auth(owner))).body.data;
    const is = (await request(app).get('/api/v1/accounting/income-statement?dateFrom=2026-01-01&dateTo=2026-01-31').set(auth(owner))).body.data;
    expect(mod.hpp).toBe(33000);       // 30 × 1100 on sale (production variances net to 0 at standard)
    expect(is.hpp).toBe(mod.hpp);      // P&L HPP == costing module HPP
  });

  it('accounting inventory quantity equals the gallon ledger depot + armada', async () => {
    const std = await activeStandard(100);
    await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs: stdInputs(100) });
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 100, reason: 'stok awal', fleet: 'Merah' });
    const cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Toko', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 30, method: 'lunas', txnDate: '2026-01-15', gallonOut: 30 });   // 30 to customer → depot 70
    const inv = (await request(app).get('/api/v1/accounting/costing/inventory').set(auth(owner))).body.data;
    expect(inv.qty).toBe(inv.atDepot + inv.atArmada);
    expect(inv.qty).toBe(70);
  });

  it('gallon-loss quantity in costing equals the gallon ledger rusak/hilang', async () => {
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 200, reason: 'stok awal', fleet: 'Merah' });
    await request(app).post('/api/v1/gudang/gallon/damage').set(auth(owner)).send({ kind: 'hilang', qty: 8, reason: 'hilang di jalan', fleet: 'Merah' });   // ledger loss 8
    // the standard must include susut_galon so the input is CLASSIFIABLE (else the run post would fail)
    const stdLines = LINES.concat([{ component: 'susut_galon', category: 'overhead_variabel', qtyPerUnit: 0, unit: 'galon', unitCost: 0, chartCode: '6-8500' }]);
    const std = (await request(app).post('/api/v1/accounting/cost-standards').set(auth(gm)).send({ effectiveFrom: '2026-01-01', normalVolume: 100, lines: stdLines })).body.data;
    const rq = (await request(app).post(`/api/v1/accounting/cost-standards/${std.id}/request-activation`).set(auth(gm)).send({})).body.data;
    await request(app).post(`/api/v1/distribusi/change-requests/${rq.requestId}/approve`).set(auth(owner)).send({});
    const inputs = stdInputs(100).concat([{ component: 'susut_galon', category: 'overhead_variabel', actualQty: 8, actualCost: 0, chartCode: '6-8500' }]);
    await completeRun({ date: '2026-01-10', unitsProduced: 100, standardId: std.id, inputs });
    const rec = (await request(app).get('/api/v1/accounting/costing/gallon-loss').set(auth(owner))).body.data;   // all-time reconcile
    expect(rec.costingQty).toBe(8);
    expect(rec.ledgerQty).toBe(8);
    expect(rec.matches).toBe(true);
  });
});
