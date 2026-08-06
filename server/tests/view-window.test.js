'use strict';
// DISTRIBUSI VIEW-WINDOW (time-restriction) — SERVER enforcement. A restricted user may only READ
// data inside their allowed date window; wider requests are CLAMPED (not emptied), flagged, and the
// attempt is audited. GM/owner are unaffected. Grant/revoke takes effect WITHOUT re-login because the
// window is resolved from LIVE DB permissions on every request (not the JWT).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (n) => { const x = new Date(); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const TODAY = iso(new Date());
const OLD = shift(-40);   // well outside any window
const D6 = shift(-6);     // inside a 7-day window, outside today-only

const txns = (t, qs) => request(app).get('/api/v1/distribusi/transactions' + (qs ? '?' + qs : '')).set(auth(t));
const dash = (t, qs) => request(app).get('/api/v1/distribusi/dashboard/summary' + (qs ? '?' + qs : '')).set(auth(t));

let gm, staff, staffId, custId;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_vw', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Field Staff', username: 'staff_vw', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  // Restricted staff: can input + see dashboard + expenses, but NO wider view cap → derive defaults
  // them to hari_ini + sisa_bon (today only, but may see the Sisa Bon balance).
  await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true }) } });
  staff = await login('staff_vw', 'secret123');
  custId = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Warung A', type: 'reguler', masterPrice: 10000, armada: 'Merah' })).body.data.id;
  // Three bon rows: today, 6 days ago, 40 days ago. Directly seeded so txnDate is exact.
  const mk = (id, day, amt) => prisma.distTransaction.create({ data: { id, customerId: custId, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(10000), amount: BigInt(amt), method: 'bon', txnDate: day, status: 'active', bonCounted: true, actorId: 'seed', actorName: 'Seed' } });
  await mk('vwToday', TODAY, 50000);
  await mk('vwD6', D6, 60000);
  await mk('vwOld', OLD, 70000);
});
afterAll(() => prisma.$disconnect());

describe('view-window — server enforcement', () => {
  it('staff (hari_ini) requesting ?dateFrom=OLD gets ONLY today + clamped:true', async () => {
    const r = await txns(staff, 'dateFrom=' + OLD);
    expect(r.status).toBe(200);
    expect(r.body.clamped).toBe(true);
    expect(r.body.effectiveFrom).toBe(TODAY);
    expect(r.body.effectiveTo).toBe(TODAY);
    const dates = r.body.data.map((x) => x.txnDate);
    expect(dates).toContain(TODAY);
    expect(dates).not.toContain(OLD);
    expect(dates).not.toContain(D6);
  });

  it('staff default fetch (no params) is bounded to today with no leak', async () => {
    const r = await txns(staff, '');
    expect(r.body.data.every((x) => x.txnDate === TODAY)).toBe(true);
    expect(r.body.window.unlimited).toBe(false);
  });

  it('search cannot surface an older row — the OLD kode/nominal is absent from the payload', async () => {
    const r = await txns(staff, 'dateFrom=' + OLD + '&dateTo=' + TODAY);
    const ids = r.body.data.map((x) => x.id);
    expect(ids).not.toContain('vwOld');   // no client-side search can find what the server never sent
    expect(ids).not.toContain('vwD6');
  });

  it('dashboard respects the window and hides all-time Total Piutang (no semua)', async () => {
    const r = await dash(staff, 'period=month');
    expect(r.status).toBe(200);
    const b = r.body.data;
    expect(b.clamped).toBe(true);
    expect(b.effectiveFrom).toBe(TODAY);
    expect(b.recent.every((x) => x.txnDate === TODAY)).toBe(true);
    expect(b.series.every((s) => s.date === TODAY)).toBe(true);
    expect(b.receivable).toBeNull();   // "Total Piutang (sepanjang waktu)" hidden without semua
  });

  it('customer detail: today rows only, but Sisa Bon TOTAL still shown (has sisa_bon)', async () => {
    const r = await request(app).get('/api/v1/distribusi/customers/' + custId).set(auth(staff));
    expect(r.status).toBe(200);
    const b = r.body.data;
    expect(b.transactions.every((x) => x.txnDate === TODAY)).toBe(true);   // no historical rows
    expect(typeof b.sisaBon).toBe('number');   // balance is a debt — kept for collection
    expect(b.sisaBon).toBe(180000);            // 50k + 60k + 70k, computed over ALL history
    expect(b.viewWindow.unlimited).toBe(false);
  });

  it('revoking sisa_bon hides the balance (no re-login) — customer detail sisaBon becomes null', async () => {
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true, 'distribusi.lihat.sisa_bon': false }) } });
    const r = await request(app).get('/api/v1/distribusi/customers/' + custId).set(auth(staff));   // SAME token
    expect(r.body.data.sisaBon).toBeNull();
    // restore for later tests
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true }) } });
  });

  it('the out-of-window attempt was AUDITED (kind=akses, actor=staff)', async () => {
    await txns(staff, 'dateFrom=' + OLD);   // one more explicit probe
    const r = await request(app).get('/api/v1/distribusi/audit?kind=akses').set(auth(gm));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    const row = r.body.data[0];
    expect(row.kind).toBe('akses');
    expect(row.title).toMatch(/di luar batas/i);
    expect(row.actorName).toBe('Field Staff');
    expect(row.detail).toMatch(/transactions/);   // endpoint recorded in the detail JSON
  });

  it('GM/owner is UNAFFECTED — sees the full history, no clamp', async () => {
    const r = await txns(gm, 'dateFrom=' + OLD + '&dateTo=' + TODAY);
    expect(r.body.clamped).toBe(false);
    const ids = r.body.data.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['vwToday', 'vwD6', 'vwOld']));
    expect(r.body.window.unlimited).toBe(true);
    // GM dashboard shows the all-time receivable
    const d = await dash(gm, 'period=month');
    expect(typeof d.body.data.receivable).toBe('number');
  });

  it('GRANT 7hari then REVOKE takes effect immediately with the SAME token (live DB perms)', async () => {
    // before: today-only → a 7-day ask is clamped
    let r = await txns(staff, 'dateFrom=' + D6 + '&dateTo=' + TODAY);
    expect(r.body.clamped).toBe(true);
    expect(r.body.data.map((x) => x.id)).not.toContain('vwD6');

    // GRANT 7hari (no re-login)
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true, 'distribusi.lihat.7hari': true }) } });
    r = await txns(staff, 'dateFrom=' + D6 + '&dateTo=' + TODAY);   // SAME token
    expect(r.body.clamped).toBe(false);
    expect(r.body.effectiveFrom).toBe(shift(-6));
    expect(r.body.data.map((x) => x.id)).toEqual(expect.arrayContaining(['vwToday', 'vwD6']));
    expect(r.body.data.map((x) => x.id)).not.toContain('vwOld');   // still outside 7 days

    // REVOKE (no re-login) → back to today-only
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true }) } });
    r = await txns(staff, 'dateFrom=' + D6 + '&dateTo=' + TODAY);   // SAME token
    expect(r.body.clamped).toBe(true);
    expect(r.body.data.map((x) => x.id)).not.toContain('vwD6');
  });

  it('maxLookbackDays override widens a today-only user by exact days (no cap needed)', async () => {
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true, maxLookbackDays: 10 }) } });
    const r = await txns(staff, 'dateFrom=' + OLD + '&dateTo=' + TODAY);
    expect(r.body.effectiveFrom).toBe(shift(-10));
    expect(r.body.data.map((x) => x.id)).toEqual(expect.arrayContaining(['vwToday', 'vwD6']));   // D6 within 10 days
    expect(r.body.data.map((x) => x.id)).not.toContain('vwOld');
    await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiDashboard: true, distribusiExpense: true }) } });
  });
});
