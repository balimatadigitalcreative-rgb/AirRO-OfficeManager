'use strict';
// "PELUNASAN TIDAK DITERIMA" — the customer really paid their bon, but the money never reached the
// company (a staff member took it). The whole point of the feature is that the two sides behave
// DIFFERENTLY, so these tests assert both halves explicitly:
//   • CUSTOMER side — sisa bon drops exactly like a normal pelunasan and the row appears in their
//     transaction history as a received payment, with NO trace of the internal problem.
//   • COMPANY side — no cash arrived: dashboard uang masuk / tunai / net cash, the cash-integration
//     bridge and the delivery report all ignore it, and the amount shows up in the internal loss
//     report against the responsible staff instead.
// Plus: the cap (distribusiBonAdjust) is server-enforced, every adjustment is audited, and a
// mistake is undone by the recorded VOID flow (never a silent delete).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const sisaBon = async (t, cid) => (await request(app).get(`/api/v1/distribusi/customers/${cid}`).set(auth(t))).body.data.sisaBon;
const dash = async (t) => (await request(app).get('/api/v1/distribusi/dashboard/summary').set(auth(t))).body.data;
const pnr = (t, body) => request(app).post('/api/v1/distribusi/transactions/payment-not-received').set(auth(t)).send(body);
const loss = async (t, qs) => (await request(app).get('/api/v1/distribusi/reports/loss' + (qs || '')).set(auth(t))).body.data;

const TODAY = new Date().toISOString().slice(0, 10);
let gm, cid, staffId, pnrId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_pnr', password: 'secret123', role: 'gm' })).token;
  // the staff member who took the money — a real system user, so the loss is attributable
  staffId = (await reg({ name: 'Sopir Budi', username: 'sopir_pnr', password: 'secret123', role: 'finance' })).user.id;
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Warung Melati', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 500, reason: 'stok awal', fleet: 'Merah' });
  // 50 gallons × 10.000 on credit = Rp 500.000 outstanding bon (the scenario in the brief)
  await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 50, method: 'bon', txnDate: TODAY, gallonOut: 50 });
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — pelunasan tidak diterima (payment not received)', () => {
  it('CUSTOMER SIDE: Rp 500.000 recorded against staff X clears the bon and prints as a payment', async () => {
    expect(await sisaBon(gm, cid)).toBe(500000);
    const before = await dash(gm);

    const r = await pnr(gm, { customerId: cid, amount: 500000, txnDate: TODAY, responsibleUserId: staffId, lossReason: 'uang dibawa sopir, tidak disetor' });
    expect(r.status).toBe(201);
    pnrId = r.body.data.id;
    expect(r.body.data).toMatchObject({ method: 'pelunasan', paymentNotReceived: true, bonCounted: true, amount: 500000 });
    expect(r.body.data.responsibleName).toBe('Sopir Budi');

    // the debt is gone — the customer paid and must never be asked to pay twice
    expect(await sisaBon(gm, cid)).toBe(0);

    // it appears in their history exactly like a received payment…
    const hist = (await request(app).get(`/api/v1/distribusi/transactions?customerId=${cid}`).set(auth(gm))).body.data;
    const row = hist.find((x) => x.id === pnrId);
    expect(row).toBeTruthy();
    expect(row.method).toBe('pelunasan');
    expect(row.amount).toBe(500000);
    // …with NOTHING about the internal issue in any field the statement prints (it renders `note`)
    expect(row.note || '').not.toMatch(/sopir|setor|tidak diterima|kerugian/i);

    // the window's transaction/receivable maths still balances
    expect(before.receivable).toBe(500000);
    expect((await dash(gm)).receivable).toBe(0);
  });

  it('COMPANY SIDE: no cash arrived — dashboard uang masuk / tunai / net cash all stay at 0', async () => {
    const d = await dash(gm);
    expect(d.uangMasuk).toBe(0);          // NOT counted as money-in
    expect(d.byMethod.pelunasan).toBe(0);
    expect(d.todayCash).toBe(0);          // driver has no cash to hand over for it
    expect(d.todayTransfer).toBe(0);
    expect(d.periodIn).toBe(0);
    expect(d.periodInCash).toBe(0);
    expect(d.todayNetCash).toBe(0);
    expect(d.todayCashByFleet.reduce((a, f) => a + f.cash, 0)).toBe(0);
    // the daily chart's cash bucket is empty too — only the bon sale shows
    expect(d.series[d.series.length - 1]).toMatchObject({ lunas: 0, bon: 500000 });
  });

  it('COMPANY SIDE: the cash-integration bridge and the delivery report both skip it', async () => {
    const bridge = (await request(app).get('/api/v1/distribusi/cash-integration').set(auth(gm))).body.data;
    expect(bridge.transactions.some((x) => x.id === pnrId)).toBe(false);
    const rep = (await request(app).get('/api/v1/distribusi/reports/delivery').set(auth(gm))).body.data;
    expect(rep.fleets.reduce((a, f) => a + f.cash.tunai + f.cash.transfer, 0)).toBe(0);
  });

  it('a REAL pelunasan on the same customer still counts as cash (the flag is what makes the difference)', async () => {
    const c2 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Kontrol', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 3, method: 'bon', txnDate: TODAY, gallonOut: 3 });
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c2, qty: 0, method: 'pelunasan', payAmount: 30000, payMethod: 'cash', txnDate: TODAY });
    const d = await dash(gm);
    expect(d.uangMasuk).toBe(30000);   // the normal payment lands; the not-received one still doesn't
    expect(d.todayCash).toBe(30000);
    expect(await sisaBon(gm, c2)).toBe(0);
  });

  it('the INTERNAL loss report lists it with the responsible staff, evidence and who recorded it', async () => {
    const rep = await loss(gm);
    expect(rep.total).toBe(500000);
    expect(rep.count).toBe(1);
    const it0 = rep.items[0];
    expect(it0).toMatchObject({ id: pnrId, amount: 500000, customerName: 'Warung Melati', responsibleUserId: staffId, responsibleName: 'Sopir Budi' });
    expect(it0.lossReason).toBe('uang dibawa sopir, tidak disetor');
    expect(it0.recordedByName).toBe('Boss');            // who booked the adjustment
    expect(rep.byStaff).toEqual([expect.objectContaining({ responsibleUserId: staffId, responsibleName: 'Sopir Budi', count: 1, total: 500000 })]);
    // an immutable audit entry exists for the adjustment
    const audit = (await request(app).get('/api/v1/distribusi/audit').set(auth(gm))).body.data;
    expect(audit.some((a) => /Pelunasan tidak diterima/i.test(a.title) && /Sopir Budi/.test(a.detail) && /dibawa sopir/.test(a.detail))).toBe(true);
  });

  it('totals accumulate per staff and per period; a window outside the date shows nothing', async () => {
    const c3 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko Dua', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c3, qty: 12, method: 'bon', txnDate: TODAY, gallonOut: 12 });
    await pnr(gm, { customerId: c3, amount: 120000, txnDate: TODAY, responsibleUserId: staffId, lossReason: 'sama, tidak disetor' });
    const rep = await loss(gm);
    expect(rep.total).toBe(620000);
    expect(rep.byStaff[0]).toMatchObject({ responsibleName: 'Sopir Budi', count: 2, total: 620000 });
    // …and the dashboard is STILL untouched by both of them
    expect((await dash(gm)).uangMasuk).toBe(30000);
    const empty = await loss(gm, '?period=range&dateFrom=2020-01-01&dateTo=2020-01-31');
    expect(empty.total).toBe(0);
    expect(empty.items).toEqual([]);
  });

  it('validation: amount > sisa bon, no bon, missing reason and missing staff are all rejected', async () => {
    const c4 = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Tanpa Bon', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
    expect((await pnr(gm, { customerId: c4, amount: 10000, txnDate: TODAY, responsibleUserId: staffId, lossReason: 'x' })).status).toBe(400);   // no outstanding bon
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: c4, qty: 1, method: 'bon', txnDate: TODAY, gallonOut: 1 });
    expect((await pnr(gm, { customerId: c4, amount: 999999, txnDate: TODAY, responsibleUserId: staffId, lossReason: 'x' })).status).toBe(400);  // exceeds sisa bon
    expect((await pnr(gm, { customerId: c4, amount: 10000, txnDate: TODAY, responsibleUserId: staffId, lossReason: '' })).status).toBe(400);    // reason required
    expect((await pnr(gm, { customerId: c4, amount: 10000, txnDate: TODAY, lossReason: 'x' })).status).toBe(400);                               // nobody responsible
    expect((await pnr(gm, { customerId: c4, amount: 10000, txnDate: TODAY, responsibleUserId: 'nope', lossReason: 'x' })).status).toBe(400);    // unknown user
    // a typed name (a field helper who is not a system user) IS accepted
    const ok = await pnr(gm, { customerId: c4, amount: 10000, txnDate: TODAY, responsibleName: 'Helper Andi', lossReason: 'diambil helper' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.responsibleUserId).toBe(null);
    expect((await loss(gm)).byStaff.some((s) => s.responsibleName === 'Helper Andi')).toBe(true);
  });

  it('a mistake is undone by the recorded VOID flow: the bon comes back and the loss stops counting', async () => {
    const before = await loss(gm);
    const v = await request(app).post(`/api/v1/distribusi/transactions/${pnrId}/void`).set(auth(gm)).send({ reason: 'salah pelanggan' });
    expect(v.status).toBe(200);
    expect(await sisaBon(gm, cid)).toBe(500000);   // the debt is a receivable again
    const after = await loss(gm);
    expect(after.total).toBe(before.total - 500000);
    const stillListed = after.items.find((x) => x.id === pnrId);
    expect(stillListed).toBeTruthy();              // nothing is hidden — it stays visible…
    expect(stillListed.voided).toBe(true);         // …clearly marked and out of the totals
    expect(stillListed.voidReason).toBe('salah pelanggan');
  });

  it('CAP: a user without distribusiBonAdjust gets 403 on BOTH the action and the report', async () => {
    const u = await reg({ name: 'NoCap', username: 'nocap_pnr', password: 'secret123', role: 'finance' });
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiBonAdjust: false } });
    const t = await login('nocap_pnr', 'secret123');
    expect((await pnr(t, { customerId: cid, amount: 1000, txnDate: TODAY, responsibleUserId: staffId, lossReason: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/v1/distribusi/reports/loss').set(auth(t))).status).toBe(403);
  });

  it('the cap is NOT back-filled from the legacy `distribusi` flag — it must be granted deliberately', async () => {
    const { deriveDistribusiCaps, resolvePerms } = require('../src/config/permissions');
    expect(deriveDistribusiCaps({ distribusi: true }).distribusiBonAdjust).toBe(false);
    expect(resolvePerms('gm', null).distribusiBonAdjust).toBe(true);      // owner/GM tier by default
    expect(resolvePerms('owner', null).distribusiBonAdjust).toBe(true);
    expect(!!resolvePerms('finance', null).distribusiBonAdjust).toBe(false);
  });
});
