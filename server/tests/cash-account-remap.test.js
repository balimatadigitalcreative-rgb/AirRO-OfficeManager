'use strict';
// PREVENT + REMEDIATE the "Belum dipetakan" orphan bug. Entry.acct is a plain string (no FK), so deleting
// an account used to silently orphan its cash-book entries into a negative "Belum dipetakan" line. Now:
// deleting a referenced account is BLOCKED (bulk sync AND direct DELETE); a remap action reassigns the
// orphaned entries to a live account; and verify-invariants gains an orphan/negative check.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const acctItem = (id, name, type, opening) => ({ id, name, type, opening: opening || 0 });

let gm;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_remap', password: 'secret123', role: 'gm' })).token;
  // Two accounts via the bulk sync (the real client path), then BCA entries netting −18.081.664.
  await request(app).put('/api/v1/accounts/sync').set(auth(gm)).send({ items: [acctItem('cash', 'Cash', 'cash', 0), acctItem('bca', 'BCA', 'bank', 90000000)] });
  await prisma.entry.create({ data: { type: 'income', amount: 20000000n, date: '2026-08-01', acct: 'bca' } });
  await prisma.entry.create({ data: { type: 'expense', amount: 38081664n, date: '2026-08-05', acct: 'bca', note: 'sewa' } });
  await prisma.entry.create({ data: { type: 'income', amount: 91707000n, date: '2026-08-02', acct: 'cash' } });
});
afterAll(() => prisma.$disconnect());

describe('prevention: a referenced account cannot be deleted (no silent orphan)', () => {
  it('bulk sync that DROPS BCA is refused while entries reference it', async () => {
    const r = await request(app).put('/api/v1/accounts/sync').set(auth(gm)).send({ items: [acctItem('cash', 'Cash', 'cash', 0)] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/masih dipakai/i);
    // BCA is still there, entries intact
    expect(await prisma.account.count({ where: { id: 'bca' } })).toBe(1);
    expect(await prisma.entry.count({ where: { acct: 'bca' } })).toBe(2);
  });
  it('direct DELETE of BCA is refused without reassignTo, allowed with it', async () => {
    const no = await request(app).delete('/api/v1/accounts/bca').set(auth(gm));
    expect(no.status).toBe(409);
    // (we do NOT delete here — the remap test below needs BCA's entries; the reassignTo path is exercised there)
  });
});

describe('remediation: remap the orphaned entries to a live account', () => {
  it('dry-run previews the exact count and net (== "Belum dipetakan")', async () => {
    const r = await request(app).post('/api/v1/accounts/remap').set(auth(gm)).send({ fromAcct: 'bca', toAcct: 'cash', dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.data.dryRun).toBe(true);
    expect(r.body.data.count).toBe(2);
    expect(r.body.data.net).toBe(-18081664);   // −Rp18.081.664
  });
  it('rejects a non-live target account', async () => {
    const r = await request(app).post('/api/v1/accounts/remap').set(auth(gm)).send({ fromAcct: 'bca', toAcct: 'ghost' });
    expect(r.status).toBe(400);
  });
  it('applies the remap: entries move to the live account and none stay orphaned', async () => {
    const r = await request(app).post('/api/v1/accounts/remap').set(auth(gm)).send({ fromAcct: 'bca', toAcct: 'cash' });
    expect(r.body.data.remapped).toBe(2);
    expect(await prisma.entry.count({ where: { acct: 'bca' } })).toBe(0);
    expect(await prisma.entry.count({ where: { acct: 'cash' } })).toBe(3);
    // amounts/dates untouched — only the account attribution changed
    const moved = await prisma.entry.findFirst({ where: { note: 'sewa' } });
    expect(moved.acct).toBe('cash');
    expect(Number(moved.amount)).toBe(38081664);
    // now BCA has no references → it can be removed cleanly
    const del = await request(app).delete('/api/v1/accounts/bca').set(auth(gm));
    expect(del.status).toBe(204);
  });
});

describe('write-path guard: an entry can no longer be saved with an unknown acct', () => {
  it('rejects acct that is not a live account (the string-name / old-id root cause)', async () => {
    const bad = await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'expense', amount: 100000, date: '2026-08-09', category: 'Fuel', acct: 'ghost-name-not-an-id' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/tidak dikenal/i);
  });
  it('accepts a valid account id, and accepts a blank acct (falls back to the primary)', async () => {
    const ok = await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 100000, date: '2026-08-09', category: 'Refill', acct: 'cash' });
    expect(ok.status).toBe(201);
    const blank = await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 50000, date: '2026-08-09', category: 'Refill' });
    expect(blank.status).toBe(201);
  });
  it('a PATCH cannot repoint an entry to a dead account', async () => {
    const made = await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 70000, date: '2026-08-09', category: 'Refill', acct: 'cash' });
    const r = await request(app).patch('/api/v1/entries/' + made.body.data.id).set(auth(gm)).send({ acct: 'ghostacct' });
    expect(r.status).toBe(400);
  });
});

describe('the guided-migration delete path (reassignTo) never orphans', () => {
  it('DELETE with reassignTo remaps then deletes in one transaction', async () => {
    await request(app).put('/api/v1/accounts/sync').set(auth(gm)).send({ items: [acctItem('cash', 'Cash', 'cash', 0), acctItem('mandiri', 'Mandiri', 'bank', 0)] });
    await prisma.entry.create({ data: { type: 'income', amount: 5000000n, date: '2026-08-03', acct: 'mandiri' } });
    const r = await request(app).delete('/api/v1/accounts/mandiri?reassignTo=cash').set(auth(gm));
    expect(r.status).toBe(204);
    expect(await prisma.account.count({ where: { id: 'mandiri' } })).toBe(0);
    expect(await prisma.entry.count({ where: { acct: 'mandiri' } })).toBe(0);   // no orphan
    expect(await prisma.entry.count({ where: { acct: 'cash', amount: 5000000n } })).toBe(1);
  });
});
