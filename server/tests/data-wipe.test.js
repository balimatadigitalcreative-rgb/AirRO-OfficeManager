'use strict';
// Selective data wipe — the most destructive operation in the app. These tests pin every
// guard: capability, dependency validation, typed confirmation, password re-entry,
// backup-first-or-abort, selectivity (unchecked = untouched), and login surviving.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const wipeSvc = require('../src/services/dataWipe.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const PW = 'wipepass123';

let wiper, ownerNoCap, wiperId;

// Seed a little data in several categories so we can prove selectivity.
async function seedData() {
  const cust = await prisma.customer.create({ data: { name: 'Pelanggan A', phone: '0811', masterPrice: 6000 } });
  await prisma.distTransaction.createMany({ data: [
    { customerId: cust.id, qty: 2, unitPriceLocked: 6000, amount: 12000, txnDate: '2026-07-01' },
    { customerId: cust.id, qty: 1, unitPriceLocked: 6000, amount: 6000, txnDate: '2026-07-02' },
  ] });
  await prisma.entry.createMany({ data: [
    { type: 'income', amount: 50000, note: 'kas 1', date: '2026-07-01' },
    { type: 'expense', amount: 20000, note: 'kas 2', date: '2026-07-02' },
  ] });
  await prisma.calendarEvent.create({ data: { type: 'holiday', title: 'Rapat', startDate: '2026-07-05' } });
}

beforeAll(async () => {
  await resetDb();
  const w = await reg({ name: 'Wiper', username: 'dw_wiper', password: PW, role: 'owner' });
  wiperId = w.user.id;
  ownerNoCap = (await reg({ name: 'Plain Owner', username: 'dw_owner', password: PW, role: 'owner' })).token;
  // The cap is granted DELIBERATELY by an admin (register can't set permissions) — exactly
  // how the owner would assign it in Pengguna. Re-login so the token carries it.
  await request(app).patch(`/api/v1/users/${wiperId}`).set(auth(ownerNoCap)).send({ permissions: { cashflow: true, manageUsers: true, dataWipe: true } });
  wiper = (await request(app).post('/api/v1/auth/login').send({ username: 'dw_wiper', password: PW })).body.token;
  // never actually shell out in tests
  wipeSvc._setBackupRunner(async () => '/home/airro/airro-backups/airro-TEST.db.gz');
  await seedData();
});
afterAll(() => prisma.$disconnect());

describe('route surface — every endpoint the client calls is actually mounted', () => {
  // Regression guard: a handler can exist in the controller but never be wired in the
  // router, which fails as a 404 at runtime and stalls the UI flow. These paths must match
  // api.js (window.API.dataWipe) exactly — a 404 here means a route was dropped.
  const CLIENT_CALLS = [
    ['get', '/api/v1/data-wipe/categories', undefined],
    ['get', '/api/v1/data-wipe/history', undefined],
    ['post', '/api/v1/data-wipe/preview', { categories: ['keu_entries'] }],
    ['post', '/api/v1/data-wipe', { categories: ['keu_entries'], confirm: 'nope', password: 'nope' }],
  ];
  it.each(CLIENT_CALLS)('%s %s is mounted (never 404)', async (method, path, body) => {
    const r = await request(app)[method](path).set(auth(wiper)).send(body);
    expect(r.status).not.toBe(404);
  });
  it.each(CLIENT_CALLS)('%s %s is capability-gated (403 without dataWipe)', async (method, path, body) => {
    const r = await request(app)[method](path).set(auth(ownerNoCap)).send(body);
    expect(r.status).toBe(403);
  });
});

describe('access — dedicated dataWipe capability, granted to nobody by default', () => {
  it('an owner WITHOUT the capability is rejected everywhere', async () => {
    expect((await request(app).get('/api/v1/data-wipe/categories').set(auth(ownerNoCap))).status).toBe(403);
    expect((await request(app).post('/api/v1/data-wipe/preview').set(auth(ownerNoCap)).send({ categories: ['keu_entries'] })).status).toBe(403);
    const r = await request(app).post('/api/v1/data-wipe').set(auth(ownerNoCap)).send({ categories: ['keu_entries'], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(403);
  });
  it('the capability is NOT in any role default', () => {
    const { ROLE_PERMS } = require('../src/config/permissions');
    Object.keys(ROLE_PERMS).forEach((role) => expect(ROLE_PERMS[role].dataWipe).toBeUndefined());
  });
  it('a holder can list categories', async () => {
    const r = await request(app).get('/api/v1/data-wipe/categories').set(auth(wiper));
    expect(r.status).toBe(200);
    expect(r.body.data.map((c) => c.key)).toEqual(expect.arrayContaining(['dist_txn', 'pelanggan', 'keu_entries', 'app_settings']));
    // users/roles are not offered as a category at all
    expect(r.body.data.map((c) => c.key)).not.toEqual(expect.arrayContaining(['users', 'roles']));
  });
});

describe('preview + dependency guard', () => {
  it('previews exact counts without deleting anything', async () => {
    const r = await request(app).post('/api/v1/data-wipe/preview').set(auth(wiper)).send({ categories: ['dist_txn', 'dist_koreksi'] });
    expect(r.status).toBe(200);
    expect(r.body.data.categories.find((c) => c.key === 'dist_txn').count).toBe(2);
    expect(await prisma.distTransaction.count()).toBe(2);   // untouched
  });

  it('blocks a parent whose children are not also selected, with an explanation', async () => {
    const r = await request(app).post('/api/v1/data-wipe/preview').set(auth(wiper)).send({ categories: ['pelanggan'] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/butuh|ikut dipilih/i);
    expect(r.body.error.message).toMatch(/Transaksi distribusi/i);
  });
});

describe('confirmation guards', () => {
  it('rejects a wrong confirmation word', async () => {
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper)).send({ categories: ['keu_entries'], confirm: 'hapus semua', password: PW });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Ketik HAPUS/i);
    expect(await prisma.entry.count()).toBe(2);
  });

  it('rejects a wrong password', async () => {
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper)).send({ categories: ['keu_entries'], confirm: 'HAPUS', password: 'nope' });
    expect(r.status).toBe(401);
    expect(await prisma.entry.count()).toBe(2);
  });

  it('rejects an empty selection — nothing happens', async () => {
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper)).send({ categories: [], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(400);
    expect(await prisma.entry.count()).toBe(2);
  });
});

describe('backup-first', () => {
  it('ABORTS the whole wipe if the automatic backup fails — nothing is deleted', async () => {
    wipeSvc._setBackupRunner(async () => { throw new Error('offsite unreachable'); });
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper)).send({ categories: ['keu_entries'], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Backup otomatis GAGAL/i);
    expect(await prisma.entry.count()).toBe(2);          // untouched
    wipeSvc._setBackupRunner(async () => '/home/airro/airro-backups/airro-TEST.db.gz');
  });
});

describe('the wipe itself — selective, audited, login survives', () => {
  it('deletes ONLY the selected category and reports the backup + restore hint', async () => {
    const usersBefore = await prisma.user.count();
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper))
      .send({ categories: ['dist_txn', 'dist_koreksi'], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(2);
    expect(r.body.data.backupFile).toMatch(/airro-TEST\.db\.gz$/);
    expect(r.body.data.restoreHint).toMatch(/restore-db\.sh/);
    // selected → gone
    expect(await prisma.distTransaction.count()).toBe(0);
    // NOT selected → untouched
    expect(await prisma.entry.count()).toBe(2);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.calendarEvent.count()).toBe(1);
    // login/users/roles always survive
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.role.count()).toBeGreaterThan(0);
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'dw_wiper', password: PW });
    expect(login.status).toBe(200);
  });

  it('writes ONE audit row that survives even when the audit category is wiped', async () => {
    const log = await prisma.dataWipeLog.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(log).toBeTruthy();
    expect(JSON.parse(log.categories)).toEqual(['dist_koreksi', 'dist_txn']);   // FK-safe order
    expect(log.actorName).toBe('Wiper');
    expect(log.totalRows).toBe(2);
    // wipe the audit-log category too — the wipe trail itself must remain
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper)).send({ categories: ['audit'], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(200);
    expect(await prisma.dataWipeLog.count()).toBe(2);   // both wipes still recorded
    const hist = await request(app).get('/api/v1/data-wipe/history').set(auth(wiper));
    expect(hist.body.data.length).toBe(2);
  });

  it('a parent WITH its children selected succeeds (customers + their data)', async () => {
    const r = await request(app).post('/api/v1/data-wipe').set(auth(wiper))
      .send({ categories: ['pelanggan', 'dist_txn', 'dist_kirim', 'dist_invoice', 'dist_galon', 'dist_koreksi'], confirm: 'HAPUS', password: PW });
    expect(r.status).toBe(200);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.entry.count()).toBe(2);   // still untouched — never selected
  });
});
