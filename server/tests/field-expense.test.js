'use strict';
// FIELD EXPENSES (pengeluaran lapangan) — cash a delivery person paid out (fuel, etc.) with an
// optional receipt photo stored via the Attachment system (never base64 inline). Fleet-scoped,
// cap-gated (distribusiExpense), append-only (VOID with a reason, never a silent delete). The day's
// total reduces the dashboard "net cash to deposit" and shows in the Integrasi Kas bridge WITHOUT
// posting to the cash book — so it can't double-count the separate Setoran.expense number.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let owner, custMerah, custBiru;
const DAY = '2026-09-20';

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_fe', password: 'secret123', role: 'owner' })).token;
  custMerah = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C Merah', type: 'reguler', masterPrice: 5000, armada: 'Merah' })).body.data.id;
  custBiru = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C Biru', type: 'reguler', masterPrice: 6000, armada: 'Biru' })).body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — field expenses (pengeluaran lapangan)', () => {
  it('logs "Bensin 50.000" with a receipt photo stored as an Attachment (not base64 in the expense)', async () => {
    // upload the receipt first (as FileAttach would), then reference its id
    const att = await request(app).post('/api/v1/attachments').set(auth(owner)).send({ data: 'data:image/jpeg;base64,/9j/EXAMPLE', name: 'bukti.jpg', mime: 'image/jpeg', isImg: true });
    expect(att.status).toBe(201);
    const photoId = att.body.data.id;
    const r = await request(app).post('/api/v1/distribusi/expenses').set(auth(owner)).send({ date: DAY, fleet: 'Merah', amount: 50000, category: 'bensin', note: 'isi solar', photoId });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ amount: 50000, category: 'bensin', fleetId: 'Merah', status: 'active', photoId });
    // the expense stores only the ref id; the bytes live in Attachment
    const row = await prisma.distExpense.findUnique({ where: { id: r.body.data.id } });
    expect(row.photoId).toBe(photoId);
    expect(row.photoId).not.toMatch(/^data:/);
    const fetched = await request(app).get('/api/v1/attachments/' + photoId).set(auth(owner));
    expect(fetched.body.data.data).toMatch(/^data:image\/jpeg/);   // bytes retrievable from Attachment
    // appears under the fleet's expenses for the day
    const list = await request(app).get(`/api/v1/distribusi/expenses?date=${DAY}&fleet=Merah`).set(auth(owner));
    expect(list.body.data.some((e) => e.id === r.body.data.id && e.amount === 50000)).toBe(true);
    // audited
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Pengeluaran lapangan: Merah/.test(a.title) && /bensin 50000/.test(a.detail))).toBe(true);
  });

  it('reduces the dashboard NET cash to deposit (cash − field expenses), no double-count', async () => {
    // Merah cash sale 4×5000 = 20 000 today; a 50 000 expense was logged above.
    await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: custMerah, qty: 4, method: 'lunas', txnDate: DAY });
    const s = await request(app).get(`/api/v1/distribusi/dashboard/summary?date=${DAY}&fleet=Merah`).set(auth(owner));
    const d = s.body.data;
    expect(d.todayCash).toBe(20000);
    expect(d.todayExpense).toBe(50000);
    expect(d.todayNetCash).toBe(20000 - 50000);          // cash − expenses (can go negative)
    const merah = d.todayCashByFleet.find((f) => f.fleetId === 'Merah');
    expect(merah).toMatchObject({ cash: 20000, expense: 50000, netCash: -30000 });
  });

  it('surfaces in the Integrasi Kas bridge as an informational line (never posts to the cash book)', async () => {
    const r = await request(app).get(`/api/v1/distribusi/cash-integration?dateFrom=${DAY}&dateTo=${DAY}`).set(auth(owner));
    expect(Array.isArray(r.body.data.expenses)).toBe(true);
    expect(r.body.data.expenses.reduce((s, e) => s + e.amount, 0)).toBe(50000);
    // no Entry (cash-book) row was created by the expense
    expect(await prisma.entry.count()).toBe(0);
  });

  it('append-only: a mistake is VOIDED with a reason (row stays, excluded from totals) — never deleted', async () => {
    const made = await request(app).post('/api/v1/distribusi/expenses').set(auth(owner)).send({ date: DAY, fleet: 'Merah', amount: 9000, category: 'parkir' });
    const id = made.body.data.id;
    // void needs a reason
    expect((await request(app).post(`/api/v1/distribusi/expenses/${id}/void`).set(auth(owner)).send({})).status).toBe(400);
    const v = await request(app).post(`/api/v1/distribusi/expenses/${id}/void`).set(auth(owner)).send({ reason: 'salah armada' });
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe('void');
    // the row still exists (not deleted), and is excluded from the active total on the dashboard
    expect(await prisma.distExpense.findUnique({ where: { id } })).not.toBeNull();
    const s = await request(app).get(`/api/v1/distribusi/dashboard/summary?date=${DAY}&fleet=Merah`).set(auth(owner));
    expect(s.body.data.todayExpense).toBe(50000);   // the voided 9 000 is NOT counted
    const audit = await request(app).get('/api/v1/distribusi/audit').set(auth(owner));
    expect(audit.body.data.some((a) => /Batalkan pengeluaran/.test(a.title) && /salah armada/.test(a.detail))).toBe(true);
  });

  it('capability + fleet scope enforced (server-side)', async () => {
    // a Biru-scoped staff with distribusiExpense: can log/see Biru only, never Merah
    const u = await reg({ name: 'Driver', username: 'drv_fe', password: 'secret123', role: 'gm' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiExpense: true }, fleetScope: ['Biru'] });
    const drv = await login('drv_fe', 'secret123');
    // logs to Biru (own fleet) — server forces the fleet even if none given
    const mine = await request(app).post('/api/v1/distribusi/expenses').set(auth(drv)).send({ date: DAY, amount: 15000, category: 'makan' });
    expect(mine.status).toBe(201);
    expect(mine.body.data.fleetId).toBe('Biru');
    // cannot log to Merah (out of scope) → 403
    expect((await request(app).post('/api/v1/distribusi/expenses').set(auth(drv)).send({ date: DAY, fleet: 'Merah', amount: 1000, category: 'bensin' })).status).toBe(403);
    // sees only Biru rows
    const seen = await request(app).get(`/api/v1/distribusi/expenses?date=${DAY}`).set(auth(drv));
    expect(seen.body.data.every((e) => e.fleetId === 'Biru')).toBe(true);

    // a user WITHOUT distribusiExpense is blocked entirely
    const noCap = await reg({ name: 'Fin', username: 'fin_fe', password: 'secret123', role: 'finance' });
    const fin = await login('fin_fe', 'secret123');
    expect((await request(app).get('/api/v1/distribusi/expenses').set(auth(fin))).status).toBe(403);
    expect((await request(app).post('/api/v1/distribusi/expenses').set(auth(fin)).send({ date: DAY, amount: 1000, category: 'bensin' })).status).toBe(403);
  });
});
