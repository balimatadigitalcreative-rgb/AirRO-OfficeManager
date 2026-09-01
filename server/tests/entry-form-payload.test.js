'use strict';
// REPRO + REGRESSION for the finance entry form payload (the "Other Expense · BCA · AirRO · 31 Agu ·
// with attachment" 400). The exact shape the client sends (finance-shell entryToApi) MUST save, and the
// ONE thing that legitimately 400s — an `acct` that is not a live account id — must say so clearly so the
// UI can surface it (never "server tidak terjangkau"). Prints payload + response for the repro run.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const acctItem = (id, name, type, opening) => ({ id, name, type, opening: opening || 0 });

let gm, bcaId;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_epf', password: 'secret123', role: 'gm' })).token;
  // Accounts synced the real client way (PUT /accounts/sync). BCA is a bank money-spot.
  await request(app).put('/api/v1/accounts/sync').set(auth(gm)).send({ items: [acctItem('cash', 'Cash', 'cash', 0), acctItem('bca', 'BCA', 'bank', 0)] });
  bcaId = 'bca';
});
afterAll(() => prisma.$disconnect());

// The exact entryToApi shape (proof is a JSON STRING — a ref to a just-uploaded attachment).
const formPayload = (over) => Object.assign({
  id: 'e_form_1', type: 'expense', amount: 150000, note: 'Other expense', method: 'Transfer',
  date: '2026-08-31', time: '14:20', category: 'Lainnya', acct: bcaId,
  businessUnitId: 'air', gallonQty: 0,
  proof: JSON.stringify({ ref: 'att_abc123', name: 'nota.jpg', isImg: true, mime: 'image/jpeg' }),
  meta: null,
}, over || {});

describe('the finance entry-form payload saves (exact client shape)', () => {
  it('Other Expense · BCA · AirRO · 2026-08-31 · attachment ref → 201', async () => {
    const body = formPayload();
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(body);
    if (r.status !== 201) { console.log('PAYLOAD', JSON.stringify(body)); console.log('RESPONSE', r.status, JSON.stringify(r.body)); }
    expect(r.status).toBe(201);
    expect(r.body.data.acct).toBe(bcaId);
    expect(r.body.data.businessUnitId).toBe('air');
    expect(typeof r.body.data.proof === 'object' || typeof r.body.data.proof === 'string').toBe(true);
  });
});

describe('the ONLY legitimate 400 is an acct that is not a live account id', () => {
  it('acct sent as the NAME "BCA" (not the id) → 400 with a clear, field-specific message', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(formPayload({ id: 'e_form_2', acct: 'BCA' }));
    console.log('acct=name REPRO →', r.status, JSON.stringify(r.body));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/tidak dikenal/i);
    expect(r.body.error.details && r.body.error.details.unknownAcct).toBe('BCA');   // names the offending value
  });

  it('acct sent as a STALE id (deleted/renamed account) → 400, not a silent orphan', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(formPayload({ id: 'e_form_3', acct: 'ac_deleted_x' }));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/tidak dikenal/i);
  });

  it('a blank acct still saves (falls back to the primary account) — never a 400', async () => {
    const r = await request(app).post('/api/v1/entries').set(auth(gm)).send(formPayload({ id: 'e_form_4', acct: null }));
    expect(r.status).toBe(201);
  });
});
