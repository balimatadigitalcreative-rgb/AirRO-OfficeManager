'use strict';
// ACCOUNTING v2 — Part 5 report engine: Umur Piutang (AR aging) and Buku Besar (general ledger with
// a running balance). Aging must bucket the SAME money the receivable holds (Σ buckets == Σ Sisa Bon
// == receivablesBalance), and the ledger's closing balance must reconcile to accountBalances.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const AS_OF = '2026-08-31';

let owner, actor; const c = {};
beforeAll(async () => {
  await resetDb();
  const o = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'own_rep', password: 'secret123', role: 'gm' })).body;
  owner = o.token; actor = { id: o.user.id, name: 'Boss' };
  const mkCust = async (name) => (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name, type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  const bon = (id, qty, date) => request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: id, qty, method: 'bon', txnDate: date });
  c.fresh = await mkCust('FRESH'); await bon(c.fresh, 10, '2026-08-25');       // 6 days old → 0-30
  c.mid = await mkCust('MID'); await bon(c.mid, 8, '2026-07-20');              // 42 days → 31-60
  c.old = await mkCust('OLD'); await bon(c.old, 6, '2026-05-01');              // 122 days → 90+
  // A partly-paid customer: two bons, a pelunasan that (FIFO) clears the oldest first.
  c.paid = await mkCust('PAID');
  await bon(c.paid, 5, '2026-06-10');   // 50k, oldest (82 days → 61-90)
  await bon(c.paid, 4, '2026-08-20');   // 40k, newer (11 days → 0-30)
  await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: c.paid, method: 'pelunasan', txnDate: '2026-08-26', payAmount: 50000 });   // clears the old 50k
  await acc.backfill({ fromDate: '2026-01-01', actor });
});
afterAll(() => prisma.$disconnect());

describe('Umur Piutang (AR aging)', () => {
  it('buckets the receivable by age and totals to receivablesBalance == Σ Sisa Bon', async () => {
    const a = await acc.agingReceivables({ asOf: AS_OF });
    expect(a.buckets.d0_30).toBe(100000 + 40000);   // FRESH 100k + PAID newer 40k
    expect(a.buckets.d31_60).toBe(80000);            // MID 80k
    expect(a.buckets.d61_90).toBe(0);                // PAID's old 50k was cleared by the pelunasan
    expect(a.buckets.d90p).toBe(60000);              // OLD 60k
    expect(a.total).toBe(280000);
    expect(a.total).toBe(await acc.receivablesBalance());
    const list = (await request(app).get('/api/v1/distribusi/customers').set(auth(owner))).body.data;
    expect(a.total).toBe(list.reduce((s, x) => s + (x.sisaBon || 0), 0));
  });

  it('is gated (flag OFF → 404) and served (flag ON → 200) at /api/v1/accounting/aging', async () => {
    // Declare BOTH preconditions in the test body — don't rely on an ambient env default. The router
    // reads config.accountingV2 per request, so flipping it exercises both doors deterministically.
    const config = require('../src/config/env');
    const original = config.accountingV2;
    try {
      config.accountingV2 = false;
      const off = await request(app).get('/api/v1/accounting/aging').set(auth(owner));
      expect(off.status).toBe(404);   // flag OFF → the whole accounting router 404s

      config.accountingV2 = true;
      const on = await request(app).get('/api/v1/accounting/aging').set(auth(owner));
      expect(on.status).toBe(200);    // flag ON → served to an authorised (reports cap) user
      expect(on.body.data.total).toBe(280000);
    } finally {
      config.accountingV2 = original;
    }
  });
});

describe('Buku Besar (general ledger running balance)', () => {
  it('the Piutang ledger closing balance reconciles to accountBalances', async () => {
    const gl = await acc.generalLedger({ code: '1-1200' });
    const rows = await acc.accountBalances();
    const ar = rows.find((r) => r.code === '1-1200');
    expect(gl.closing).toBe(ar.balance);
    expect(gl.closing).toBe(280000);
    // running balance is internally consistent: last row's balance === closing
    expect(gl.rows[gl.rows.length - 1].balance).toBe(gl.closing);
    // every row carries its source for figure→journal→source drilling
    expect(gl.rows.every((r) => r.sourceType && (r.debit || r.credit))).toBe(true);
  });

  it('opening + Σ movements == closing per account (the running-balance identity)', async () => {
    for (const code of ['1-1200', '1-1000', '4-1000']) {
      const gl = await acc.generalLedger({ code });
      const rows = await acc.accountBalances();
      const type = (rows.find((r) => r.code === code) || {}).type;
      const sign = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 }[type];
      const moved = gl.rows.reduce((s, r) => s + (r.debit - r.credit), 0) * sign;
      expect(gl.opening + moved).toBe(gl.closing);
    }
  });

  it('journalFor returns the full BALANCED journal a ledger row belongs to (drill target)', async () => {
    const gl = await acc.generalLedger({ code: '1-1200' });
    const src = gl.rows[0];
    const j = await acc.journalFor({ sourceType: src.sourceType, sourceId: src.sourceId });
    expect(j).toBeTruthy();
    expect(j.lines.reduce((s, l) => s + l.debit, 0)).toBe(j.lines.reduce((s, l) => s + l.credit, 0));   // balanced
    expect(j.lines.some((l) => l.code === '1-1200')).toBe(true);
  });

  it('chart() returns the account hierarchy (parentId) for the Buku Besar picker', async () => {
    const c = await acc.chart();
    expect(c.length).toBeGreaterThan(10);
    expect(c.some((a) => a.code === '1-1200' && a.parentId)).toBe(true);   // leaf has a parent
    expect(c.some((a) => a.code === '1-0000' && !a.parentId)).toBe(true);  // header is a root
  });
});
