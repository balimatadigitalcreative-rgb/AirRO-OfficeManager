'use strict';
// TRANSAKSI split (presentation only): [Semua] [Setoran] [Operasional]. Same Entry data, same journals,
// same reports/balances — only the VIEW is split. These tests pin the contract:
//   • the shared predicate is a TOTAL, disjoint split → setoran ∪ operasional === semua for any filter;
//   • per-tab sums add up to the combined (old single-list) total;
//   • the API classifies + filters through the SAME shared predicate;
//   • finance creates OPERASIONAL only — a setoran row can neither be created nor edited-into here.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const FINSRC = require('../../finance-entry-source.js');   // the ONE shared predicate (client bundles the same file)

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

describe('shared predicate — one source of truth, total & disjoint', () => {
  // A representative mixed cash book: derived setoran rows (id prefix / tag / meta) + operasional rows.
  const book = [
    { id: 'stinc-2026-08-01', type: 'income', amount: 500000, setoranDay: '2026-08-01' },
    { id: 'stmfg-2026-08-01', type: 'expense', amount: 120000, setoranMfg: '2026-08-01' },
    { id: 'e1', type: 'expense', amount: 200000, category: 'Fuel' },
    { id: 'e2', type: 'income', amount: 90000, category: 'Refill' },
    { id: 'e3', type: 'expense', amount: 50000, interUnit: true },            // operasional, but "sumber lain"
    { id: 'e4', type: 'income', amount: 30000, meta: JSON.stringify({ setoranDay: '2026-08-02' }) }, // setoran via meta
  ];
  const setoran = book.filter((e) => FINSRC.entrySource(e) === 'setoran');
  const operasional = book.filter((e) => FINSRC.entrySource(e) === 'operasional');

  it('classifies setoran rows by id prefix, tag AND meta', () => {
    expect(FINSRC.isSetoranEntry({ id: 'stinc-x' })).toBe(true);
    expect(FINSRC.isSetoranEntry({ setoranMfg: '2026-08-01' })).toBe(true);
    expect(FINSRC.isSetoranEntry({ meta: JSON.stringify({ setoranDay: 'd' }) })).toBe(true);
    expect(FINSRC.isSetoranEntry({ id: 'e9', category: 'Fuel' })).toBe(false);
  });

  it('is a TOTAL, DISJOINT split — setoran ∪ operasional === semua (order-independent)', () => {
    const ids = (a) => a.map((e) => e.id).sort();
    expect(ids([...setoran, ...operasional])).toEqual(ids(book));                 // union == all
    expect(setoran.some((e) => operasional.includes(e))).toBe(false);            // disjoint
    expect(setoran.length + operasional.length).toBe(book.length);
  });

  it('holds for ANY filter (e.g. income-only) — the split commutes with filtering', () => {
    const income = book.filter((e) => e.type === 'income');
    const set = income.filter((e) => FINSRC.entrySource(e) === 'setoran');
    const ops = income.filter((e) => FINSRC.entrySource(e) === 'operasional');
    expect(set.length + ops.length).toBe(income.length);
    expect([...set, ...ops].map((e) => e.id).sort()).toEqual(income.map((e) => e.id).sort());
  });

  it('per-tab sums reconcile to the combined (old single-list) total', () => {
    const sum = (a) => a.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
    expect(sum(setoran) + sum(operasional)).toBe(sum(book));   // combined line == setoran + operasional
  });

  it('"sumber lain" is orthogonal — it flags an operasional row without moving it', () => {
    const other = book.find((e) => e.id === 'e3');
    expect(FINSRC.isOtherSource(other)).toBe(true);
    expect(FINSRC.entrySource(other)).toBe('operasional');   // still operasional (union unaffected)
    expect(operasional.includes(other)).toBe(true);
  });
});

describe('API — same predicate classifies + filters the /entries list', () => {
  let gm, kasId;
  beforeAll(async () => {
    await resetDb();
    gm = (await reg({ name: 'Boss', username: 'gm_txn', password: 'secret123', role: 'gm' })).token;
    kasId = (await request(app).post('/api/v1/accounts').set(auth(gm)).send({ name: 'Kas', type: 'cash', opening: 0 })).body.data.id;
    await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 500000, date: '2026-08-05', category: 'Refill', acct: kasId });
    await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'expense', amount: 200000, date: '2026-08-06', category: 'Fuel', acct: kasId });
  });

  it('stamps every row with its source, and persisted rows are operasional', async () => {
    const r = await request(app).get('/api/v1/entries').set(auth(gm));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
    expect(r.body.data.every((e) => e.source === 'operasional')).toBe(true);
  });

  it('?source= filters through the shared predicate; union == unfiltered', async () => {
    const all = (await request(app).get('/api/v1/entries').set(auth(gm))).body.data;
    const ops = (await request(app).get('/api/v1/entries?source=operasional').set(auth(gm))).body.data;
    const set = (await request(app).get('/api/v1/entries?source=setoran').set(auth(gm))).body.data;
    expect(set.length).toBe(0);                       // setoran rows live client-side — none persisted
    expect(ops.length).toBe(all.length);
    const ids = (a) => a.map((e) => e.id).sort();
    expect(ids([...set, ...ops])).toEqual(ids(all));  // union == the full list
  });
});

describe('finance creates OPERASIONAL only — a setoran row cannot be booked here', () => {
  let gm;
  beforeAll(async () => {
    await resetDb();
    gm = (await reg({ name: 'Boss', username: 'gm_txn2', password: 'secret123', role: 'gm' })).token;
  });

  it('rejects creating an entry tagged as setoran (points to Distribusi)', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm))
      .send({ type: 'income', amount: 500000, date: '2026-08-05', category: 'Refill', meta: JSON.stringify({ setoranDay: '2026-08-05' }) });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/setoran/i);
  });

  it('a normal operasional entry still posts fine', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm))
      .send({ type: 'expense', amount: 100000, date: '2026-08-05', category: 'Fuel' });
    expect(r.status).toBe(201);
    expect(FINSRC.entrySource(r.body.data)).toBe('operasional');
  });

  it('an existing operasional entry cannot be EDITED into a setoran row', async () => {
    const made = await request(app).post('/api/v1/entries').set(auth(gm)).send({ type: 'income', amount: 70000, date: '2026-08-05', category: 'Refill' });
    const r = await request(app).patch('/api/v1/entries/' + made.body.data.id).set(auth(gm)).send({ meta: JSON.stringify({ setoranMfg: '2026-08-05' }) });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/setoran/i);
  });
});
