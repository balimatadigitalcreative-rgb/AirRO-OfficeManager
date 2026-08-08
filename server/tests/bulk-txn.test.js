'use strict';
// BULK transaction removal — batal / arsip / hapus with server-computed preview, per-row blockers,
// view-window enforcement, audit batch + restore. Mirrors the Kerugian bulk pattern.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const OLD = (() => { const x = new Date(); x.setUTCDate(x.getUTCDate() - 40); return iso(x); })();
const prev = (p, body, tok) => request(app).post('/api/v1/distribusi/transactions/bulk/preview').set(auth(tok)).send(body);
const exec = (p, body, tok) => request(app).post('/api/v1/distribusi/transactions/bulk').set(auth(tok)).send(body);
const restore = (batchId, tok) => request(app).post('/api/v1/distribusi/transactions/bulk/restore').set(auth(tok)).send({ batchId });
const sisa = async (cid) => { const r = await require('../src/services/distribution.service'); return null; };

let gm, staff, staffId, cA, cB, ids = [], invoicedIds = [];

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'gm_bx', password: 'secret123', role: 'gm' })).token;
  const s = await reg({ name: 'Staff', username: 'st_bx', password: 'secret123', role: 'finance' });
  staffId = s.user.id;
  // staff: can input + cancel + archive, but NOT hard-delete
  await prisma.user.update({ where: { id: staffId }, data: { permissions: JSON.stringify({ distribusiInput: true, distribusiVoid: true, distribusiLegacyImport: true }) } });
  staff = await login('st_bx', 'secret123');
  cA = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'BU RIRIS', code: 'C-0243', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
  cB = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'PAK ADI', type: 'reguler', masterPrice: 13000, armada: 'Merah' })).body.data.id;
  // Seed transactions directly (bon so sisaBon moves). 10 bon for cA, 5 bon for cB.
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ id: 'txa' + i, customerId: cA, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(13000), amount: BigInt(65000), method: 'bon', txnDate: TODAY, status: 'active', bonCounted: true, actorName: 'S' });
  for (let i = 0; i < 5; i++) rows.push({ id: 'txb' + i, customerId: cB, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(13000), amount: BigInt(65000), method: 'bon', txnDate: TODAY, status: 'active', bonCounted: true, actorName: 'S' });
  await prisma.distTransaction.createMany({ data: rows });
  ids = rows.map((r) => r.id);
  // Issue an invoice covering 3 of cA's txns → those become hard-delete-blocked.
  invoicedIds = ['txa0', 'txa1', 'txa2'];
  await request(app).post('/api/v1/distribusi/customers/' + cA + '/invoices').set(auth(gm)).send({ scope: 'selected', transactionIds: invoicedIds });
});
afterAll(() => prisma.$disconnect());

const custSisa = (r, code) => { const c = (r.body.data.sisaChanges || []).find((x) => x.code === code || x.name === code); return c || null; };

describe('bulk removal — batal + undo', () => {
  it('preview lists each customer Sisa Bon change (before → after)', async () => {
    const r = await prev(app, { ids, action: 'batal' }, gm);
    expect(r.status).toBe(200);
    expect(r.body.data.eligible.length).toBe(15);
    expect(r.body.data.blocked.length).toBe(0);
    const a = custSisa(r, 'BU RIRIS');
    expect(a.before).toBe(650000); expect(a.after).toBe(0);   // all 10 bon cancelled
  });
  it('execute batal voids the rows and drops Sisa Bon; undo restores everything', async () => {
    const r = await exec(app, { ids, action: 'batal', note: 'salah input massal' }, gm);
    expect(r.status).toBe(200); expect(r.body.data.done).toBe(15);
    const after = await prisma.distTransaction.count({ where: { id: { in: ids }, status: 'void' } });
    expect(after).toBe(15);
    // undo
    const u = await restore(r.body.data.batchId, gm);
    expect(u.status).toBe(200); expect(u.body.data.restored).toBe(15);
    const active = await prisma.distTransaction.count({ where: { id: { in: ids }, status: 'active' } });
    expect(active).toBe(15);
  });
});

describe('bulk removal — hapus with invoice blockers + restore', () => {
  it('preview blocks the 3 invoiced rows by invoice number; 12 eligible', async () => {
    const r = await prev(app, { ids, action: 'hapus' }, gm);
    expect(r.status).toBe(200);
    expect(r.body.data.eligible.length).toBe(12);
    const blk = r.body.data.blocked.filter((b) => b.reason === 'in_invoice');
    expect(blk.length).toBe(3);
    expect(blk[0].invoice).toMatch(/INV-/);
    expect(r.body.data.invoicesAffected.length).toBe(1);
  });
  it('staff WITHOUT distribusi.transaksi.hapus is rejected (API, crafted request)', async () => {
    const r = await exec(app, { ids, action: 'hapus', note: 'x', confirm: 'HAPUS' }, staff);
    expect(r.status).toBe(403);
  });
  it('GM executes: 12 deleted, 3 invoiced skipped; owner restores from the batch', async () => {
    const r = await exec(app, { ids, action: 'hapus', note: 'bersih-bersih', confirm: 'HAPUS' }, gm);
    expect(r.status).toBe(200);
    expect(r.body.data.done).toBe(12);
    expect(r.body.data.failed).toBe(3);
    const left = await prisma.distTransaction.count({ where: { id: { in: ids } } });
    expect(left).toBe(3);   // only the invoiced ones remain
    // restore recreates the 12
    const u = await restore(r.body.data.batchId, gm);
    expect(u.status).toBe(200); expect(u.body.data.restored).toBe(12);
    expect(await prisma.distTransaction.count({ where: { id: { in: ids } } })).toBe(15);
  });
  it('note is REQUIRED; typed confirmation is required for hapus', async () => {
    expect((await exec(app, { ids: ['txa0'], action: 'hapus', confirm: 'HAPUS' }, gm)).status).toBe(400);   // no note
    expect((await exec(app, { ids: ['txa0'], action: 'hapus', note: 'x', confirm: 'nope' }, gm)).status).toBe(400);   // bad confirm
  });
});

describe('view-window: a user who cannot SEE a row cannot act on it', () => {
  it('today-only staff cannot cancel an out-of-window row (blocked per row)', async () => {
    await prisma.distTransaction.create({ data: { id: 'txold', customerId: cB, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(13000), amount: BigInt(65000), method: 'bon', txnDate: OLD, status: 'active', bonCounted: true, actorName: 'S' } });
    const r = await exec(app, { ids: ['txold'], action: 'batal', note: 'coba' }, staff);   // staff defaults to hari_ini
    expect(r.status).toBe(200);
    expect(r.body.data.done).toBe(0);
    expect(r.body.data.results[0].reason).toBe('out_of_window');
    expect(await prisma.distTransaction.count({ where: { id: 'txold', status: 'active' } })).toBe(1);
  });
});
