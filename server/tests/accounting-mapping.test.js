'use strict';
// ACCOUNTING v2 — PEMETAAN AKUN (category → account mapping). A cash-book category with no built-in
// mapping (e.g. a user-created one) falls to Pendapatan/Beban Lain-lain and is surfaced by /unmapped.
// An admin can now MAP it to a real account at runtime (CategoryMapping) with NO code change, and every
// subsequent posting uses it. This asserts: unmapped detection, the mapping picker list, that a set
// mapping changes where a new entry posts (live), side-validation (income→revenue, expense→beban), and
// that clearing reverts to the default/unmapped fall-back.
process.env.ACCOUNTING_V2 = 'true';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const acc = require('../src/services/accounting.service');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const mkEntry = (t, body) => request(app).post('/api/v1/entries').set(auth(t)).send(body);
const journalOf = (id) => acc.journalFor({ sourceType: 'entry', sourceId: id });

let gm, staff;
beforeAll(async () => {
  await resetDb();
  await acc.seedChart();
  gm = (await reg({ name: 'GM', username: 'map_gm', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Staf', username: 'map_staff', password: 'secret123', role: 'finance' });   // addEntry, no reports/owner
  staff = await login('map_staff', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('Pemetaan Akun — unmapped detection + live re-mapping', () => {
  it('a category with no built-in mapping is flagged unmapped and posts to the Lain-lain fallback', async () => {
    const e = (await mkEntry(gm, { type: 'expense', amount: 12000, category: 'Katering', acct: 'cash', date: '2026-08-01', note: 'rapat' })).body.data;
    const j = await journalOf(e.id);
    expect(j.lines.find((l) => l.code === '6-9000').debit).toBe(12000);   // Beban Lain-lain fallback
    const um = (await request(app).get('/api/v1/accounting/unmapped').set(auth(gm))).body.data;
    expect(um.some((u) => u.category === 'Katering' && u.type === 'expense')).toBe(true);
    const map = (await request(app).get('/api/v1/accounting/mappings').set(auth(gm))).body.data;
    expect(map.items.find((i) => i.category === 'Katering').source).toBe('none');
    expect(map.items.find((i) => i.category === 'Refill' || i.code === '4-1000')).toBeTruthy;   // a built-in default is present
    expect(map.unmappedCount).toBeGreaterThan(0);
    expect(map.accounts.expense.some((a) => a.code === '6-3000')).toBe(true);   // picker options
  });

  it('setting a mapping changes where a NEW entry posts (live), and marks the category "custom"', async () => {
    const r = await request(app).post('/api/v1/accounting/mappings').set(auth(gm)).send({ categoryKey: 'Katering', type: 'expense', chartCode: '6-3000' });
    expect(r.status).toBe(200);
    const e2 = (await mkEntry(gm, { type: 'expense', amount: 8000, category: 'Katering', acct: 'cash', date: '2026-08-02' })).body.data;
    const j = await journalOf(e2.id);
    expect(j.lines.find((l) => l.code === '6-3000').debit).toBe(8000);        // now the mapped account
    expect(j.lines.some((l) => l.code === '6-9000')).toBe(false);            // no longer the fallback
    const map = (await request(app).get('/api/v1/accounting/mappings').set(auth(gm))).body.data;
    expect(map.items.find((i) => i.category === 'Katering')).toMatchObject({ source: 'custom', code: '6-3000' });
    expect((await request(app).get('/api/v1/accounting/unmapped').set(auth(gm))).body.data.some((u) => u.category === 'Katering')).toBe(false);
  });

  it('rejects a nonsensical side: income → an expense account, and mapping to a header', async () => {
    expect((await request(app).post('/api/v1/accounting/mappings').set(auth(gm)).send({ categoryKey: 'HadiahMasuk', type: 'income', chartCode: '6-3000' })).status).toBe(400);   // income must map to revenue
    expect((await request(app).post('/api/v1/accounting/mappings').set(auth(gm)).send({ categoryKey: 'Katering', type: 'expense', chartCode: '6-0000' })).status).toBe(400);        // header, not a leaf
  });

  it('clearing a mapping reverts a new entry to the fallback', async () => {
    expect((await request(app).delete('/api/v1/accounting/mappings').set(auth(gm)).send({ categoryKey: 'Katering', type: 'expense' })).status).toBe(200);
    const e3 = (await mkEntry(gm, { type: 'expense', amount: 5000, category: 'Katering', acct: 'cash', date: '2026-08-03' })).body.data;
    const j = await journalOf(e3.id);
    expect(j.lines.find((l) => l.code === '6-9000').debit).toBe(5000);   // back to Lain-lain
  });

  it('mapping is owner/GM-tier — a plain finance user is 403', async () => {
    expect((await request(app).post('/api/v1/accounting/mappings').set(auth(staff)).send({ categoryKey: 'Katering', type: 'expense', chartCode: '6-3000' })).status).toBe(403);
    expect((await request(app).delete('/api/v1/accounting/mappings').set(auth(staff)).send({ categoryKey: 'Katering', type: 'expense' })).status).toBe(403);
  });
});

describe('Status roll-up (workflow panel + report headers)', () => {
  it('reports journals-posted, balance, integrity, unmapped count and the prior month', async () => {
    const s = (await request(app).get('/api/v1/accounting/status?asOf=2026-08-16').set(auth(gm))).body.data;
    expect(s.journalCount).toBeGreaterThan(0);          // live posting has journalled the entries
    expect(s.lastPostedAt).toBeTruthy();
    expect(s.trialBalanced).toBe(true);                 // the cash-book entries balance
    expect(s.integrity).toMatchObject({ ok: true });    // no drift with live posting
    expect(typeof s.unmappedCount).toBe('number');
    expect(s.priorMonth).toBe('2026-07');               // the month before asOf — the one that should close
    expect(s.priorClosed).toBe(false);                  // nothing closed in this test
  });
});
