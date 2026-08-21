'use strict';
// REGRESSION — finance AR (1-1200) must stay == Σ customer Sisa Bon through the ARCHIVE / REACTIVATE
// path. A bon is created (Dr Piutang posted, counted in Sisa Bon); archiving it as a mistaken row
// (bonCounted=false) drops it from Sisa Bon, so its AR journal MUST be reversed too — otherwise a stale
// Dr Piutang lingers and AR reads too high (the production Rp612k gap). Reactivating must re-post it.
// The rule: a row is a receivable IFF method in {bon,pelunasan} AND status!=void AND bonCounted — and
// the AR journal obeys the SAME predicate as Sisa Bon.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const dist = require('../src/services/distribution.service');

const rnd = () => Math.random().toString(36).slice(2, 8);
let actor;

beforeEach(async () => {
  await resetDb();
  await acc.seedChart();
  const u = await prisma.user.create({ data: { name: 'Owner', username: 'arc_' + rnd(), passwordHash: 'x', role: 'owner' } });
  actor = { id: u.id, role: 'owner', name: 'Owner' };
});
afterAll(() => prisma.$disconnect());

const mkCust = (price = 200000) => prisma.customer.create({ data: { name: 'C ' + rnd(), code: 'C' + rnd(), armada: 'Merah', masterPrice: price, active: true } });
const mkBon = (cid, date = '2026-05-10') => dist.createTransaction({ customerId: cid, method: 'bon', qty: 1, txnDate: date }, actor);
const gap = async () => (await acc.receivablesBalance()) - (await acc.agingReceivables({})).total;

describe('AR == Σ Sisa Bon through archive / reactivate', () => {
  it('archiving a posted bon to bonCounted=false REVERSES its AR journal (no stale Piutang)', async () => {
    const c = await mkCust();
    const t = await mkBon(c.id);
    expect(await gap()).toBe(0);
    await dist.setTransactionArchive(t.id, true, { reason: 'salah input', bonCounted: false }, actor);
    expect((await acc.agingReceivables({})).total).toBe(0);   // dropped from Sisa Bon
    expect(await acc.receivablesBalance()).toBe(0);           // AND from the ledger
    expect(await gap()).toBe(0);
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('reactivating re-posts the AR journal', async () => {
    const c = await mkCust();
    const t = await mkBon(c.id);
    await dist.setTransactionArchive(t.id, true, { reason: 'x', bonCounted: false }, actor);
    await dist.setTransactionArchive(t.id, false, { reason: 'restore' }, actor);   // reactivate → counts again
    expect((await acc.agingReceivables({})).total).toBe(200000);
    expect(await acc.receivablesBalance()).toBe(200000);
    expect(await gap()).toBe(0);
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('re-archiving after a reactivate reverses again (unique key per toggle)', async () => {
    const c = await mkCust();
    const t = await mkBon(c.id);
    await dist.setTransactionArchive(t.id, true, { reason: 'a', bonCounted: false }, actor);
    await dist.setTransactionArchive(t.id, false, { reason: 'b' }, actor);
    await dist.setTransactionArchive(t.id, true, { reason: 'c', bonCounted: false }, actor);   // 2nd archive — must NOT no-op
    expect(await acc.receivablesBalance()).toBe(0);
    expect(await gap()).toBe(0);
    expect((await acc.trialBalance()).balanced).toBe(true);
  });

  it('archiving but KEEPING bonCounted=true (real historical debt) leaves AR intact', async () => {
    const c = await mkCust();
    const t = await mkBon(c.id);
    await dist.setTransactionArchive(t.id, true, { reason: 'historical debt', bonCounted: true }, actor);
    expect((await acc.agingReceivables({})).total).toBe(200000);
    expect(await gap()).toBe(0);
  });

  it('a bonCounted=false LUNAS cash sale is NOT suppressed (bonCounted is irrelevant to lunas)', async () => {
    const c = await mkCust();
    const t = await dist.createTransaction({ customerId: c.id, method: 'lunas', qty: 1, txnDate: '2026-05-10' }, actor);
    // archive the lunas with bonCounted=false — the cash sale (Dr Kas / Cr Pendapatan) must remain.
    await dist.setTransactionArchive(t.id, true, { reason: 'arsip', bonCounted: false }, actor);
    const is = await acc.incomeStatement({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
    expect(is.revenue).toBe(200000);                 // revenue still recognised
    expect(await acc.receivablesBalance()).toBe(0);  // lunas never touched AR
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});
