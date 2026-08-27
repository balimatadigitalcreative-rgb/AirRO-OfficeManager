'use strict';
// CARRY-OVER of undelivered stops. A stop is OUTSTANDING when date < today AND status in {pending,
// ditunda} AND no transactionId. 'terkirim'/'batal' are settled. The endpoint deliberately IGNORES the
// caller's read window (an outstanding stop is today's work) but still honours fleet scope + maxAgeDays.
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
const YEST = shift(-1);
const OLD = shift(-45);   // beyond the default 30-day actionable window

const outstanding = (t, qs) => request(app).get('/api/v1/distribusi/deliveries/outstanding' + (qs ? '?' + qs : '')).set(auth(t));
const resolve = (t, id, body) => request(app).post('/api/v1/distribusi/deliveries/outstanding/' + id + '/resolve').set(auth(t)).send(body);

let gm, staff, staffId, biruCust, biru2, merahCust;
const mkCust = async (t, name, armada) => (await request(app).post('/api/v1/distribusi/customers').set(auth(t)).send({ name, type: 'reguler', masterPrice: 10000, armada })).body.data.id;
// (date, customerId, source) is UNIQUE, so each seeded stop needs a distinct combo.
const mkStop = (id, customerId, fleetId, date, status, extra) => prisma.delivery.create({ data: { id, customerId, fleetId, date, source: 'jadwal', status, seq: 0, ...(extra || {}) } });

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_out', password: 'secret123', role: 'gm' })).token;
  biruCust = await mkCust(gm, 'Warung Biru', 'Biru');
  biru2 = await mkCust(gm, 'Warung Biru Dua', 'Biru');
  merahCust = await mkCust(gm, 'Warung Merah', 'Merah');

  // Biru: one pending yesterday (OUTSTANDING), one terkirim yesterday (settled), one batal yesterday
  // (settled), one very old pending (beyond maxAgeDays), and one pending TODAY (not yet outstanding).
  await mkStop('bOut', biruCust, 'Biru', YEST, 'pending');
  await mkStop('bDone', biruCust, 'Biru', YEST, 'terkirim', { source: 'tambahan', transactionId: 'tx1' });
  await mkStop('bToday', biru2, 'Biru', TODAY, 'pending');   // a TODAY stop on ANOTHER customer (not the one carried)
  await mkStop('bCanc', biru2, 'Biru', YEST, 'batal');
  await mkStop('bOld', biru2, 'Biru', OLD, 'pending');
  // Merah: a pending yesterday — must NOT appear for a Biru-scoped staff.
  await mkStop('mOut', merahCust, 'Merah', YEST, 'pending');

  // Staff: may run deliveries (reach the endpoint) but has NO wider view cap → hari_ini window; scoped
  // to fleet Biru only. fleetScope must be set BEFORE login so the token carries it.
  const s = await reg({ name: 'Sopir Biru', username: 'staff_out', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiPengiriman: true }), fleetScope: JSON.stringify(['Biru']) } });
  staff = await login('staff_out', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('outstanding list — the rule', () => {
  it('a pending stop dated yesterday appears; terkirim + batal never appear', async () => {
    const r = await outstanding(gm);
    expect(r.status).toBe(200);
    const ids = r.body.data.map((x) => x.id);
    expect(ids).toContain('bOut');
    expect(ids).not.toContain('bDone');   // terkirim = settled
    expect(ids).not.toContain('bCanc');   // batal = settled
    expect(ids).not.toContain('bToday');  // today is not yet "before today"
  });
  it('umur (days late) and the customer detail are populated', async () => {
    const row = (await outstanding(gm)).body.data.find((x) => x.id === 'bOut');
    expect(row.umur).toBe(1);
    expect(row.customerName).toBe('Warung Biru');
    expect(row).toHaveProperty('sisaBon');
    expect(row).toHaveProperty('alamat');
  });
  it('a stop older than maxAgeDays is excluded from the actionable list (default 30)', async () => {
    const ids = (await outstanding(gm)).body.data.map((x) => x.id);
    expect(ids).not.toContain('bOld');
    // …but a wider maxAgeDays surfaces it (hygiene knob).
    const wide = await outstanding(gm, 'maxAgeDays=90');
    expect(wide.body.data.map((x) => x.id)).toContain('bOld');
  });
});

describe('resolve — deliver today (carry-over) is idempotent', () => {
  it('kirim creates ONE new stop for today and removes the original from the list', async () => {
    const before = (await outstanding(gm)).body.data.map((x) => x.id);
    expect(before).toContain('bOut');
    const r = await resolve(gm, 'bOut', { action: 'kirim' });
    expect(r.status).toBe(200);
    // original is settled (batal, rescheduled) → gone from the list
    const after = (await outstanding(gm)).body.data.map((x) => x.id);
    expect(after).not.toContain('bOut');
    // exactly one new tambahan stop for today for that customer
    const todayStops = await prisma.delivery.findMany({ where: { customerId: biruCust, date: TODAY, source: 'tambahan' } });
    expect(todayStops.length).toBe(1);
    const orig = await prisma.delivery.findUnique({ where: { id: 'bOut' } });
    expect(orig.status).toBe('batal');
    expect(orig.pendingReason).toMatch(/dijadwalkan ulang/i);
  });
  it('running kirim AGAIN is a no-op — no duplicate today stop', async () => {
    const r = await resolve(gm, 'bOut', { action: 'kirim' });
    expect(r.status).toBe(200);
    expect(r.body.data.already).toBe(true);
    const todayStops = await prisma.delivery.findMany({ where: { customerId: biruCust, date: TODAY, source: 'tambahan' } });
    expect(todayStops.length).toBe(1);   // still one
  });
  it('running the outstanding query twice produces identical results (no duplicates)', async () => {
    const a = (await outstanding(gm)).body.data.map((x) => x.id).sort();
    const b = (await outstanding(gm)).body.data.map((x) => x.id).sort();
    expect(a).toEqual(b);
  });
  it('batal requires a reason and settles the stop', async () => {
    const noReason = await resolve(gm, 'mOut', { action: 'batal' });
    expect(noReason.status).toBe(400);
    const ok = await resolve(gm, 'mOut', { action: 'batal', reason: 'Alamat pindah' });
    expect(ok.status).toBe(200);
    const row = await prisma.delivery.findUnique({ where: { id: 'mOut' } });
    expect(row.status).toBe('batal');
    expect(row.pendingReason).toBe('Alamat pindah');
  });
});

describe('scope — a today-only, Biru-scoped staff', () => {
  it('still sees THEIR outstanding stops from earlier days (window carve-out)', async () => {
    // re-seed a fresh Biru outstanding stop (bOut was resolved above) — biru2's tambahan slot is free
    await mkStop('bOut2', biru2, 'Biru', YEST, 'ditunda', { source: 'tambahan' });
    const r = await outstanding(staff);
    expect(r.status).toBe(200);
    const ids = r.body.data.map((x) => x.id);
    expect(ids).toContain('bOut2');    // visible despite being before today and the staff being hari_ini
  });
  it('but the normal history window still applies elsewhere (transactions clamped to today)', async () => {
    const tx = await request(app).get('/api/v1/distribusi/transactions?dateFrom=' + OLD).set(auth(staff));
    expect(tx.body.clamped).toBe(true);
    expect(tx.body.effectiveFrom).toBe(TODAY);
  });
  it('fleet Biru\'s list excludes Merah', async () => {
    await mkStop('mOut2', merahCust, 'Merah', YEST, 'ditunda', { source: 'tambahan' });
    const ids = (await outstanding(staff)).body.data.map((x) => x.id);
    expect(ids).not.toContain('mOut2');
    // GM filtering ?fleet=Biru likewise excludes Merah
    const gmBiru = (await outstanding(gm, 'fleet=Biru')).body.data.map((x) => x.id);
    expect(gmBiru).not.toContain('mOut2');
    expect(gmBiru).toContain('bOut2');
  });
});
