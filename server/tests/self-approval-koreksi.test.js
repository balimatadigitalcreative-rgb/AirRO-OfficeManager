'use strict';
// SELF-APPROVAL OF KOREKSI (owner, 2026-10-02): whoever holds approval access may approve their OWN
// correction / cancellation / customer move (badged selfApproved + audited, per-user ceiling still
// applies). Correction access alone = submit only. Disputes / cost standards / payroll keep the
// separate distribusiApproveSelf waiver, which only the Pemilik may grant — also through a role template.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let owner, gm, cid;
const reg = (b) => request(app).post('/api/v1/auth/register').send(b).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const mkUser = async (username, perms) => {
  const u = await reg({ name: username, username, password: 'secret123', role: 'finance' });
  await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: perms });
  return login(username);
};
const mkTxn = async (qty) => (await request(app).post(`${D}/transactions`).set(auth(owner)).send({ customerId: cid, qty, method: 'lunas', txnDate: today, gallonOut: qty, gallonIn: 0 })).body.data.id;
const correct = (tok, id, body) => request(app).post(`${D}/transactions/${id}/corrections`).set(auth(tok)).send(body);
const approve = (tok, id) => request(app).post(`${D}/change-requests/${id}/approve`).set(auth(tok)).send({});

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'sk_owner', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'sk_gm', password: 'secret123', role: 'gm' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(owner)).send({ name: 'Toko SK', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  await request(app).post(`${D}/gallon/opening`).set(auth(owner)).send({ qty: 500, reason: 'stok awal', fleet: 'DK 1' });
});
afterAll(() => prisma.$disconnect());

it('approval access (no separate waiver) → may approve their OWN correction; it is badged selfApproved', async () => {
  const tok = await mkUser('sk_appr', { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true });
  const cr = (await correct(tok, await mkTxn(5), { reason: 'salah jumlah', qty: 3, unitPrice: 6000, gallonOut: 3 })).body.data;
  const r = await approve(tok, cr.id);
  expect(r.status).toBe(200);
  expect(r.body.data.selfApproved).toBe(true);
});

it('correction access only → may submit but NOT approve (route refuses)', async () => {
  const tok = await mkUser('sk_kor', { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false });
  const cr = (await correct(tok, await mkTxn(4), { reason: 'salah jumlah', qty: 2, unitPrice: 6000, gallonOut: 2 })).body.data;
  expect(cr.status).toBe('pending');
  expect((await approve(tok, cr.id)).status).toBe(403);
});

it('a per-user ceiling still holds for koreksi self-approval', async () => {
  const u = await reg({ name: 'Batas', username: 'sk_lim', password: 'secret123', role: 'finance' });
  await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true, maxSelfApproveAmount: 10000 } });
  const tok = await login('sk_lim');
  const cr = (await correct(tok, await mkTxn(5), { reason: 'besar', qty: 4, unitPrice: 6000, gallonOut: 4 })).body.data;   // 24.000 > 10.000
  const r = await approve(tok, cr.id);
  expect(r.status).toBe(403);
  expect(r.body.error.details && r.body.error.details.overSelfApproveLimit).toBe(true);
});

it('a GM cannot slip distribusiApproveSelf into a role template; the Pemilik can', async () => {
  const bad = await request(app).post('/api/v1/roles').set(auth(gm)).send({ name: 'Penyetuju Mandiri', permissions: { distribusiApprove: true, distribusiApproveSelf: true } });
  expect(bad.status).toBe(403);
  const ok = await request(app).post('/api/v1/roles').set(auth(owner)).send({ name: 'Penyetuju Mandiri', permissions: { distribusiApprove: true, distribusiApproveSelf: true } });
  expect(ok.status).toBe(201);
  const up = await request(app).patch('/api/v1/roles/' + ok.body.data.id).set(auth(gm)).send({ permissions: { distribusiApprove: true, distribusiApproveSelf: false } });
  expect(up.status).toBe(403);
  // a GM editing an unrelated role permission (waiver untouched) is still fine
  const plain = await request(app).post('/api/v1/roles').set(auth(gm)).send({ name: 'Biasa', permissions: { distribusiApprove: true } });
  expect(plain.status).toBe(201);
});

it('the office UI lets an approver decide their own koreksi; the waiver text names what it still covers', () => {
  const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..', '..');
  const dist = fs.readFileSync(path.join(root, 'distribution.jsx'), 'utf8');
  expect(dist).toMatch(/const KOREKSI_KINDS = \['correction', 'void', 'reassign'\];/);
  expect(dist).toMatch(/if \(own && !canApproveSelf && !KOREKSI_KINDS\.includes\(r\.kind\)\) \{/);
  expect(dist).not.toMatch(/if \(own && !canApproveSelf\) return <div className="cd-pending-own">/);
  expect(fs.readFileSync(path.join(root, 'finance-users.jsx'), 'utf8')).toMatch(/sengketa, standar biaya dan penggajian/);
});
