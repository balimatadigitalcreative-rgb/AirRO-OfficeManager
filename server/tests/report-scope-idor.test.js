'use strict';
// SECURITY REGRESSION — accounting-v2 report scope (IDOR class, same family as the payslip bug fixed
// 21 Aug). Every financial report reads the caller's business-unit / armada scope from the SESSION
// (req.user), never from the request. A user confined to one unit must NOT be able to read another
// unit's figures — not by default, and NOT by crafting a foreign businessUnitId in the query. The
// request-supplied businessUnitId is only ever a *filter within* the caller's own scope.
process.env.ACCOUNTING_V2 = 'true';
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');

const actor = { id: null, name: 'test' };
// Session users as requireAuth would mint them (unitScope parsed to an array; 'all' ⇒ full access).
const AIR = { id: 'u-air', role: 'finance', unitScope: ['air'] };
const MFG = { id: 'u-mfg', role: 'finance', unitScope: ['mfg'] };
const FULL = { id: 'u-gm', role: 'gm', unitScope: 'all' };

async function seed(businessUnitId) {
  const bu = businessUnitId ? { businessUnitId } : {};
  // revenue 1,000,000 (Dr Kas / Cr Pendapatan); HPP 300,000; opex 200,000.
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j1' + (businessUnitId || ''), date: '2026-08-10', actor, ...bu, lines: [{ code: '1-1000', debit: 1000000 }, { code: '4-1000', credit: 1000000 }] });
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j2' + (businessUnitId || ''), date: '2026-08-11', actor, ...bu, lines: [{ code: '5-1000', debit: 300000 }, { code: '1-1000', credit: 300000 }] });
  await acc.postJournal({ sourceType: 'manual', sourceId: 'j3' + (businessUnitId || ''), date: '2026-08-12', actor, ...bu, lines: [{ code: '6-1000', debit: 200000 }, { code: '1-1000', credit: 200000 }] });
}

beforeAll(async () => { await resetDb(); await acc.seedChart(); await seed('air'); await seed('mfg'); });
afterAll(() => prisma.$disconnect());

describe('income statement is scoped to the caller\'s units', () => {
  it('a full-access user sees both units combined', async () => {
    expect((await acc.incomeStatement({ user: FULL })).revenue).toBe(2000000);
  });
  it('an air-scoped user sees ONLY air — never the other unit', async () => {
    expect((await acc.incomeStatement({ user: AIR })).revenue).toBe(1000000);
  });
  it('IDOR: an air-scoped user crafting ?businessUnitId=mfg gets NOTHING, not mfg\'s figures', async () => {
    const stolen = await acc.incomeStatement({ businessUnitId: 'mfg', user: AIR });
    expect(stolen.revenue).toBe(0);   // the foreign filter intersects an empty set with the caller's scope
  });
  it('the mfg-scoped user is the mirror image (only mfg; air is invisible)', async () => {
    expect((await acc.incomeStatement({ user: MFG })).revenue).toBe(1000000);
    expect((await acc.incomeStatement({ businessUnitId: 'air', user: MFG })).revenue).toBe(0);
  });
});

describe('raw account balances + balance sheet obey the same scope', () => {
  it('accountBalances sums only the caller\'s unit', async () => {
    const airRows = await acc.accountBalances({ user: AIR });
    const rev = airRows.find((r) => r.code === '4-1000');
    expect(rev.balance).toBe(1000000);   // air only, not 2,000,000
  });
  it('IDOR: crafting the foreign unit still yields nothing', async () => {
    const rows = await acc.accountBalances({ businessUnitId: 'mfg', user: AIR });
    const rev = rows.find((r) => r.code === '4-1000');
    expect(rev ? rev.balance : 0).toBe(0);
  });
  it('balance-sheet asset total is the caller\'s slice, not the company', async () => {
    const airBs = await acc.balanceSheet({ user: AIR });
    const fullBs = await acc.balanceSheet({ user: FULL });
    expect(airBs.assets).toBe(500000);
    expect(fullBs.assets).toBe(1000000);
    expect(airBs.assets).toBeLessThan(fullBs.assets);
  });
});

describe('per-account Buku Besar (generalLedger) obeys the scope', () => {
  it('an air-scoped ledger for Pendapatan shows only air movements', async () => {
    const gl = await acc.generalLedger({ code: '4-1000', user: AIR });
    expect(gl.closing).toBe(1000000);   // one air credit, not both units
    expect(gl.rows.length).toBe(1);
  });
  it('IDOR: crafting ?businessUnitId=mfg on the ledger returns an empty movement set', async () => {
    const gl = await acc.generalLedger({ code: '4-1000', businessUnitId: 'mfg', user: AIR });
    expect(gl.closing === 0).toBe(true);   // empty movement set (-0 === 0); no mfg data leaks
    expect(gl.rows.length).toBe(0);
  });
  it('a full-access ledger shows both units', async () => {
    const gl = await acc.generalLedger({ code: '4-1000', user: FULL });
    expect(gl.closing).toBe(2000000);
    expect(gl.rows.length).toBe(2);
  });
});
