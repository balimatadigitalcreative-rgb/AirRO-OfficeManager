'use strict';
// Dispute raise validation: Alasan is OPTIONAL (reason null accepted, not a fake default); selisih=0
// is allowed for "Masih diselidiki" (investigasi) but blocked for staf/perusahaan; evidence must be a
// real URL when present; Catatan stays required.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const raise = (t, txnId, body) => request(app).post('/api/v1/distribusi/transactions/' + txnId + '/dispute').set(auth(t)).send(body);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);

let gm, budi, cid, tx = [];
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'dv_gm', password: 'secret123', role: 'gm' })).token;
  const b = await reg({ name: 'Budi', username: 'dv_budi', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: b.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiBonAdjust: true }) } });
  budi = await login('dv_budi');
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko DV', type: 'reguler', masterPrice: 91000, armada: 'Merah' })).body.data.id;
  // Six separate 91.000 notas (one per case) so each raise targets a fresh transaction. Handled by Budi.
  for (let i = 0; i < 6; i++) tx.push((await request(app).post('/api/v1/distribusi/transactions').set(auth(budi)).send({ customerId: cid, qty: 1, method: 'bon', txnDate: '2026-08-01' })).body.data.id);
});
afterAll(() => prisma.$disconnect());

it('investigasi + acknowledged full (selisih 0) + NO reason → 201, reason null, Sisa Bon unchanged', async () => {
  const before = (await detail(gm, cid)).sisaBon;
  const r = await raise(gm, tx[0], { resolution: 'investigasi', customerClaimAmount: 91000, note: 'cek dulu' });
  expect(r.status).toBe(201);
  expect(r.body.data.reason).toBeNull();
  expect(r.body.data.status).toBe('disengketakan');
  expect((await detail(gm, cid)).sisaBon).toBe(before);   // disengketakan still counts
});
it('investigasi + acknowledged 0 (selisih 91.000) + NO reason → 201', async () => {
  const r = await raise(gm, tx[1], { resolution: 'investigasi', customerClaimAmount: 0, note: 'belum jelas' });
  expect(r.status).toBe(201);
  expect(r.body.data.disputedAmount).toBe(91000);
  expect(r.body.data.reason).toBeNull();
});
it('staf + selisih 0 → 400 with a clear message', async () => {
  const r = await raise(gm, tx[2], { resolution: 'staf', customerClaimAmount: 91000, note: 'x' });
  expect(r.status).toBe(400);
  expect(r.body.error.message).toMatch(/selisih/i);
});
it('note empty → 400', async () => {
  const r = await raise(gm, tx[3], { resolution: 'investigasi', customerClaimAmount: 0, note: '' });
  expect(r.status).toBe(400);
});
it('junk evidence "." → 400; a real URL → 201', async () => {
  expect((await raise(gm, tx[4], { resolution: 'investigasi', customerClaimAmount: 0, note: 'a', evidenceUrl: '.' })).status).toBe(400);
  const ok = await raise(gm, tx[4], { resolution: 'investigasi', customerClaimAmount: 0, note: 'a', evidenceUrl: 'https://bukti.example.com/x.jpg' });
  expect(ok.status).toBe(201);
});
it('explicit reason: null (what the client sends for "— pilih —") → 201, reason null', async () => {
  const r = await raise(gm, tx[5], { resolution: 'investigasi', reason: null, customerClaimAmount: 0, note: 'a' });
  expect(r.status).toBe(201);
  expect(r.body.data.reason).toBeNull();
});
