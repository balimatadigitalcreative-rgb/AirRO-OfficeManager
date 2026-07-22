'use strict';
// Koreksi Rit — append-only corrections to a delivery run's figures (muat / isi-kembali / kosong).
// Corrections are signed deltas; displayed figures + reconciliation use base + Σ active deltas.
// The stored columns are never overwritten. Cap: distribusiKoreksi. Runs do NOT feed the gallon
// ledger, so a correction writes NO GallonMovement (stock stays driven by per-customer movements).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);

let owner, cust;
const DATE = '2026-11-10';

// Open a run, sell `sold`, close it with the given full/empty. Returns the closed run's id.
async function makeClosedRun({ out, sold, full, empty, diffReason }) {
  const open = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Merah', gallonsOut: out });
  const rid = open.body.data.id;
  if (sold) await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cust, qty: sold, method: 'lunas', txnDate: DATE });
  const close = await request(app).post(`/api/v1/distribusi/runs/${rid}/close`).set(auth(owner)).send({ gallonsFullReturned: full, gallonsEmptyReturned: empty, diffReason });
  expect(close.status).toBe(200);
  return rid;
}
const getRun = async (rid, tok = owner) => (await request(app).get(`/api/v1/distribusi/runs?date=${DATE}`).set(auth(tok))).body.data.find((r) => r.id === rid);

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_rc', password: 'secret123', role: 'owner' })).token;
  const c = await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Cust', type: 'reguler', masterPrice: 5000, armada: 'Merah' });
  cust = c.body.data.id;
});
afterAll(() => prisma.$disconnect());

describe('Distribusi — Koreksi Rit (append-only run corrections)', () => {
  it('forgot empties (kosong=0) → correct empty to 55 → run shows 55, marked corrected, history recorded', async () => {
    const rid = await makeClosedRun({ out: 100, sold: 60, full: 40, empty: 0 });   // diff 0
    const r = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ empty: 55, reason: 'lupa input' });
    expect(r.status).toBe(200);
    expect(r.body.data.gallonsEmptyReturned).toBe(55);
    expect(r.body.data.corrected).toBe(true);
    expect(r.body.data.corrections).toHaveLength(1);
    expect(r.body.data.corrections[0]).toMatchObject({ field: 'empty', delta: 55, reason: 'lupa input' });
    // persisted as a signed RunCorrection row; base column untouched (still 0)
    const row = await prisma.deliveryRun.findUnique({ where: { id: rid } });
    expect(row.gallonsEmptyReturned).toBe(0);
    const corr = await prisma.runCorrection.findMany({ where: { runId: rid } });
    expect(corr).toEqual([expect.objectContaining({ field: 'empty', delta: 55, active: true })]);
    // list view reflects the effective value + corrected marker
    const listed = await getRun(rid);
    expect(listed).toMatchObject({ gallonsEmptyReturned: 55, corrected: true });
  });

  it('correcting full-returned recomputes Selisih from effective values', async () => {
    // expected remaining = 100 − 60 = 40; close returning 40 (diff 0). Then correct full 40 → 38.
    const rid = await makeClosedRun({ out: 100, sold: 60, full: 40, empty: 50 });
    expect((await getRun(rid)).diff).toBe(0);
    const r = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ full: 38, reason: 'salah hitung isi' });
    expect(r.status).toBe(200);
    expect(r.body.data.gallonsFullReturned).toBe(38);
    expect(r.body.data.diff).toBe(-2);   // 38 − 40 expected, recomputed from the corrected value
  });

  it('correcting muat (out) recomputes expectedRemaining and Selisih', async () => {
    // out 100, sold 60, returned 40 → diff 0. Correct muat 100 → 110 → expected 50, returned 40 → diff −10.
    const rid = await makeClosedRun({ out: 100, sold: 60, full: 40, empty: 50 });
    const r = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ out: 110, reason: 'muat kurang dicatat' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ gallonsOut: 110, expectedRemaining: 50, diff: -10 });
  });

  it('multiple fields in one correction → one signed row + one audit entry per field', async () => {
    const rid = await makeClosedRun({ out: 80, sold: 30, full: 50, empty: 0 });
    const r = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ full: 52, empty: 44, reason: 'rekap ulang' });
    expect(r.status).toBe(200);
    expect(r.body.data.corrections).toHaveLength(2);
    const audit = (await request(app).get('/api/v1/distribusi/audit').set(auth(owner))).body.data;
    const mine = audit.filter((a) => /Koreksi rit/.test(a.title) && /rekap ulang/.test(a.detail));
    expect(mine.length).toBe(2);   // one per changed field
    expect(mine.some((a) => /isi kembali 50 → 52/.test(a.detail))).toBe(true);
    expect(mine.some((a) => /kosong 0 → 44/.test(a.detail))).toBe(true);
  });

  it('a run correction writes NO GallonMovement (runs do not feed stock)', async () => {
    const before = await prisma.gallonMovement.count();
    const rid = await makeClosedRun({ out: 60, sold: 10, full: 50, empty: 0 });
    await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ empty: 9, reason: 'x' });
    // the 10-gallon sale creates a delivery_out movement; the correction itself must add none.
    const after = await prisma.gallonMovement.count();
    expect(after - before).toBe(1);   // only the sale's movement, none from the correction
  });

  it('open run: only muat correctable — full/empty rejected until closed', async () => {
    const open = await request(app).post('/api/v1/distribusi/runs/open').set(auth(owner)).send({ date: DATE, fleet: 'Biru', gallonsOut: 70 });
    const rid = open.body.data.id;
    expect((await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ empty: 10, reason: 'x' })).status).toBe(400);
    // muat correction on the open run is allowed and flows into close reconciliation
    const okOut = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ out: 90, reason: 'tambah muat' });
    expect(okOut.status).toBe(200);
    expect(okOut.body.data.gallonsOut).toBe(90);
    expect(okOut.body.data.expectedRemaining).toBe(90);   // nothing sold on Biru yet
    await request(app).post(`/api/v1/distribusi/runs/${rid}/close`).set(auth(owner)).send({ gallonsFullReturned: 90, gallonsEmptyReturned: 0 });   // diff 0 vs effective 90
  });

  it('reason required; a no-op correction is rejected', async () => {
    const rid = await makeClosedRun({ out: 50, sold: 20, full: 30, empty: 10 });
    expect((await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ empty: 12 })).status).toBe(400);            // no reason
    expect((await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(owner)).send({ empty: 10, reason: 'sama' })).status).toBe(400); // no change
  });

  it('capability enforced: a user with pengiriman but NOT distribusiKoreksi gets 403', async () => {
    const rid = await makeClosedRun({ out: 40, sold: 0, full: 40, empty: 5 });
    const u = await reg({ name: 'Helper', username: 'help_rc', password: 'secret123', role: 'gm' });
    // grant view/delivery but explicitly remove the correction cap
    await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiPengiriman: true, distribusiKoreksi: false } });
    const h = await login('help_rc', 'secret123');
    // can VIEW runs
    expect((await request(app).get(`/api/v1/distribusi/runs?date=${DATE}`).set(auth(h))).status).toBe(200);
    // cannot correct
    const denied = await request(app).post(`/api/v1/distribusi/runs/${rid}/corrections`).set(auth(h)).send({ empty: 9, reason: 'nope' });
    expect(denied.status).toBe(403);
    // the run is unchanged
    expect((await getRun(rid)).gallonsEmptyReturned).toBe(5);
  });
});
