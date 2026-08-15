'use strict';
// ACCOUNTING v2 — LIVE POSTING. Every write path now posts its double-entry journal in the SAME
// transaction as the source, so reports are current the instant a transaction is recorded (no more
// "press Backfill to see today"). This asserts the core guarantees:
//   • a sale / expense writes a BALANCED journal in the same transaction;
//   • rolling the source back rolls the journal back (atomicity);
//   • re-running backfill posts NOTHING new (idempotent — the one-time migration, not the mechanism);
//   • approving a correction APPENDS a reversing/adjusting entry (never edits the original) and the
//     reports move; a void fully reverses;
//   • the trial balance balances after a month of mixed activity;
//   • finance AR == Σ customer Sisa Bon after LIVE posting (not just after a backfill);
//   • the integrity check finds a deliberately orphaned source and an orphan journal.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const sum = (lines, k) => lines.reduce((s, l) => s + l[k], 0);
const custList = async (t) => (await request(app).get('/api/v1/distribusi/customers').set(auth(t))).body.data;

let owner, staff, staffId, cid;
beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  owner = (await reg({ name: 'Boss', username: 'lp_own', password: 'secret123', role: 'gm' })).token;   // gm holds addEntry + distribusiApprove + reports
  const s = await reg({ name: 'Staf', username: 'lp_staff', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await request(app).patch(`/api/v1/users/${staffId}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiApprove: false } });
  staff = await login('lp_staff', 'secret123');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Toko Hidup', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('LIVE posting — a source and its balanced journal are written together', () => {
  it('a cash sale (lunas) posts Dr Kas / Cr Pendapatan the instant it is recorded', async () => {
    const sale = (await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 3, method: 'lunas', txnDate: '2026-08-01', gallonOut: 3 })).body.data;
    const j = await acc.journalFor({ sourceType: 'dist_txn', sourceId: sale.id });
    expect(j).toBeTruthy();                                   // posted LIVE — no backfill was run
    expect(sum(j.lines, 'debit')).toBe(sum(j.lines, 'credit'));   // balanced
    expect(j.lines.find((l) => l.code === '1-1000').debit).toBe(30000);   // Kas
    expect(j.lines.find((l) => l.code === '4-1000').credit).toBe(30000);  // Penjualan Air
  });

  it('a field expense posts Dr Beban / Cr Kas the instant it is recorded', async () => {
    const exp = (await request(app).post('/api/v1/distribusi/expenses').set(auth(owner)).send({ date: '2026-08-01', fleet: 'Merah', category: 'bensin', amount: 20000 })).body.data;
    const j = await acc.journalFor({ sourceType: 'dist_expense', sourceId: exp.id });
    expect(j).toBeTruthy();
    expect(sum(j.lines, 'debit')).toBe(sum(j.lines, 'credit'));
    expect(j.lines.find((l) => l.code === '6-2000').debit).toBe(20000);   // Beban BBM
    expect(j.lines.find((l) => l.code === '1-1000').credit).toBe(20000);  // Kas
  });

  it('a cash-book income entry posts in the same transaction (Dr Kas / Cr Pendapatan)', async () => {
    const e = (await request(app).post('/api/v1/entries').set(auth(owner)).send({ type: 'income', amount: 15000, category: 'Refill', acct: 'cash', date: '2026-08-02', note: 'x' })).body.data;
    const j = await acc.journalFor({ sourceType: 'entry', sourceId: e.id });
    expect(j).toBeTruthy();
    expect(sum(j.lines, 'debit')).toBe(15000);
    expect(sum(j.lines, 'credit')).toBe(15000);
  });
});

describe('atomicity + idempotency', () => {
  it('an unbalanced post FAILS the write and rolls the source back (same transaction)', async () => {
    const before = await prisma.entry.count();
    await expect(prisma.$transaction(async (tx) => {
      const e = await tx.entry.create({ data: { type: 'income', amount: 5000n, date: '2026-08-03', category: 'Refill', acct: 'cash' } });
      await acc.postJournal({ sourceType: 'entry', sourceId: e.id, date: e.date, lines: [{ code: '1-1000', debit: 5000 }, { code: '4-1000', credit: 4000 }] }, tx);   // 5000 != 4000
    })).rejects.toThrow(/not balanced/i);
    expect(await prisma.entry.count()).toBe(before);   // the entry did NOT persist — journal + source rolled back together
  });

  it('re-running backfill over already-posted sources posts NOTHING new', async () => {
    const first = await acc.backfill({ actor: { id: 'sys', name: 'sys' } });   // one-time migration (over live-posted data)
    const count1 = await prisma.journalEntry.count();
    const second = await acc.backfill({ actor: { id: 'sys', name: 'sys' } });
    const count2 = await prisma.journalEntry.count();
    expect(count2).toBe(count1);                                   // idempotent — no duplicates
    expect(Object.values(second).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0)).toBe(0);   // second run reports nothing posted
    expect(first).toBeTruthy();
  });
});

describe('corrections + voids APPEND reversing entries; reports move; AR stays exact', () => {
  it('approving a bon correction appends a dist_txn_adj (reversalOf set) and AR reflects the new figure', async () => {
    const bon = (await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-08-05', gallonOut: 5 })).body.data;   // 50.000
    const orig = await acc.journalFor({ sourceType: 'dist_txn', sourceId: bon.id });
    expect(orig.lines.find((l) => l.code === '1-1200').debit).toBe(50000);   // Piutang 50k live
    // staff requests qty 5→3 (30.000); owner approves
    const reqId = (await request(app).post(`/api/v1/distribusi/transactions/${bon.id}/corrections`).set(auth(staff)).send({ reason: 'salah hitung', qty: 3, unitPrice: 10000, gallonOut: 3 })).body.data.id;
    await request(app).post(`/api/v1/distribusi/change-requests/${reqId}/approve`).set(auth(owner)).send({});
    // the ORIGINAL journal is untouched; an adjusting entry was appended, linked via reversalOf
    const stillOrig = await acc.journalFor({ sourceType: 'dist_txn', sourceId: bon.id });
    expect(stillOrig.lines.find((l) => l.code === '1-1200').debit).toBe(50000);   // never edited
    const adj = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn_adj', ref: bon.id } });
    expect(adj).toBeTruthy();
    expect(adj.reversalOf).toBeTruthy();
    // net Piutang for this customer's bon now equals the corrected 30.000
    const bal = await acc.accountBalances();
    const ar = bal.find((r) => r.code === '1-1200');
    const list = await custList(owner);
    expect(ar.balance).toBe(list.reduce((s, x) => s + (x.sisaBon || 0), 0));
  });

  it('an approved void appends a full reversal so the txn nets to zero in the ledger', async () => {
    const bon = (await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 2, method: 'bon', txnDate: '2026-08-06', gallonOut: 2 })).body.data;   // 20.000
    const arBefore = (await acc.accountBalances()).find((r) => r.code === '1-1200').balance;
    // POST /void submits an approval request (like a correction); the approval applies it.
    const reqId = (await request(app).post(`/api/v1/distribusi/transactions/${bon.id}/void`).set(auth(staff)).send({ reason: 'dobel' })).body.data.id;
    await request(app).post(`/api/v1/distribusi/change-requests/${reqId}/approve`).set(auth(owner)).send({});
    // an adjusting entry (linked to the original via reversalOf) fully reverses this txn
    const adj = await prisma.journalEntry.findFirst({ where: { sourceType: 'dist_txn_adj', ref: bon.id } });
    expect(adj).toBeTruthy();
    expect(adj.reversalOf).toBeTruthy();
    const arAfter = (await acc.accountBalances()).find((r) => r.code === '1-1200').balance;
    expect(arAfter).toBe(arBefore - 20000);   // fully reversed
  });
});

describe('invariants after a month of LIVE activity', () => {
  it('the trial balance balances', async () => {
    const tb = await acc.trialBalance();
    expect(tb.balanced).toBe(true);
  });
  it('finance AR (Piutang) == Σ customer Sisa Bon — after LIVE posting, no backfill', async () => {
    // a partial collection, live
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, method: 'pelunasan', payAmount: 10000, txnDate: '2026-08-10' });
    const arBal = await acc.receivablesBalance();
    const list = await custList(owner);
    expect(arBal).toBe(list.reduce((s, x) => s + (x.sisaBon || 0), 0));
  });
});

describe('adjustments post live and keep AR exact', () => {
  it('an approved BON adjustment (write-down) posts its delta; AR stays == Σ Sisa Bon and TB balances', async () => {
    const adj = (await request(app).post(`/api/v1/distribusi/customers/${cid}/adjustments`).set(auth(owner)).send({ kind: 'bon', mode: 'delta', delta: -5000, reason: 'lainnya', note: 'koreksi manual' })).body.data;
    await request(app).post(`/api/v1/distribusi/adjustments/${adj.id}/approve`).set(auth(owner)).send({});
    const j = await acc.journalFor({ sourceType: 'dist_adjustment', sourceId: adj.id });
    expect(j).toBeTruthy();
    expect(sum(j.lines, 'debit')).toBe(sum(j.lines, 'credit'));   // balanced (Dr Beban Kerugian / Cr Piutang)
    const arBal = await acc.receivablesBalance();
    const list = await custList(owner);
    expect(arBal).toBe(list.reduce((s, x) => s + (x.sisaBon || 0), 0));
    expect((await acc.trialBalance()).balanced).toBe(true);
  });
});

describe('integrity / drift detector', () => {
  it('finds a source with no journal and a journal with no source', async () => {
    const clean = await acc.integrityCheck();
    expect(clean.ok).toBe(true);   // live posting keeps it clean
    // orphan SOURCE: a dist expense inserted straight into the DB (bypassing the posting service)
    const orphanExp = await prisma.distExpense.create({ data: { date: '2026-08-11', fleetId: 'Merah', amount: 7000n, category: 'bensin', status: 'active' } });
    // orphan JOURNAL: a journal whose source row does not exist
    await prisma.journalEntry.create({ data: { sourceType: 'entry', sourceId: 'ghost-entry-id', date: '2026-08-11', description: 'orphan', lines: { create: [] } } });
    const drift = await acc.integrityCheck();
    expect(drift.ok).toBe(false);
    expect(drift.missing.some((m) => m.sourceType === 'dist_expense' && m.sourceId === orphanExp.id)).toBe(true);
    expect(drift.orphan.some((o) => o.sourceType === 'entry' && o.sourceId === 'ghost-entry-id')).toBe(true);
  });
});
