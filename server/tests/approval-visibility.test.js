'use strict';
// Regression for "the approval UI never showed": an owner/GM whose stored permissions blob PREDATES
// distribusiApprove (the production reality — accounts created/edited before the cap existed) was
// resolving distribusiApprove=false, so the Pengajuan screen + the DIST.ChangeRequests block never
// rendered and the endpoints 403'd. The normalize step now defaults the owner/GM-tier caps by ROLE,
// so owner/GM keep them even with a legacy override, while a plain user never gains them.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { resolvePerms } = require('../src/config/permissions');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const listReqs = (t, qs) => request(app).get('/api/v1/distribusi/change-requests' + (qs || '')).set(auth(t));
const approve = (t, id, body) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send(body || {});
const reject = (t, id, note) => request(app).post(`/api/v1/distribusi/change-requests/${id}/reject`).set(auth(t)).send({ note });
const getTxn = async (t, id) => (await request(app).get('/api/v1/distribusi/transactions').set(auth(t))).body.data.find((x) => x.id === id);

describe('distribusiApprove — normalize defaults by role', () => {
  // A stored blob from BEFORE the cap existed (note: no distribusiApprove key).
  const legacyBlob = { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiDashboard: true };
  it('owner/GM with a legacy override still resolve distribusiApprove = true (+ the sibling owner-tier caps)', () => {
    for (const role of ['owner', 'gm']) {
      const p = resolvePerms(role, JSON.stringify(legacyBlob));
      expect(p.distribusiApprove).toBe(true);
      expect(p.distribusiBonAdjust).toBe(true);
      expect(p.distribusiDashHistory).toBe(true);
    }
  });
  it('a plain user (finance / custom role) never gains it by derivation', () => {
    expect(resolvePerms('finance', JSON.stringify({ distribusi: true, distribusiKoreksi: true })).distribusiApprove).toBe(false);
    expect(resolvePerms('customrole', JSON.stringify({ distribusi: true, distribusiInput: true })).distribusiApprove).toBe(false);
  });
  it('an explicit false in the blob is respected (never silently re-granted)', () => {
    expect(resolvePerms('gm', JSON.stringify({ ...legacyBlob, distribusiApprove: false })).distribusiApprove).toBe(false);
  });
});

describe('approval UI end-to-end (seeded pending request)', () => {
  let owner, gmLegacy, staff, staffId, cid, bonId, reqId;
  beforeAll(async () => {
    await resetDb();
    owner = (await reg({ name: 'Owner', username: 'own_av', password: 'secret123', role: 'owner' })).token;   // full caps — does the setup
    // a GM whose per-user permissions blob PREDATES distribusiApprove — the exact broken account.
    const g = await reg({ name: 'GM Lama', username: 'gm_av', password: 'secret123', role: 'gm' });
    await prisma.user.update({ where: { id: g.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiDashboard: true }) } });
    gmLegacy = await login('gm_av', 'secret123');
    const s = await reg({ name: 'Staf', username: 'staff_av', password: 'secret123', role: 'finance' });
    staffId = s.user.id;
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(owner)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false } });
    staff = await login('staff_av', 'secret123');
    cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'C', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 200, reason: 'stok awal', fleet: 'Merah' });
    bonId = (await request(app).post('/api/v1/distribusi/transactions').set(auth(owner)).send({ customerId: cid, qty: 5, method: 'bon', txnDate: '2026-07-27', gallonOut: 5 })).body.data.id;
    reqId = (await correct(staff, bonId, { reason: 'salah qty', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 })).body.data.id;
  });
  afterAll(() => prisma.$disconnect());

  it('/auth/me returns RESOLVED self-permissions, so the client renders the same caps the API enforces', async () => {
    // The deeper cause: the client renders nav/screens/buttons from user.permissions. If /auth/me
    // returned the RAW blob (no distribusiApprove), the approval UI stayed hidden even though the API
    // granted it. The self shape is resolved → distribusiApprove is present for this legacy-blob GM.
    const meRaw = await request(app).get('/api/v1/auth/me').set(auth(gmLegacy));
    expect(meRaw.status).toBe(200);
    expect(meRaw.body.user.permissions.distribusiApprove).toBe(true);   // was undefined/absent before the fix
    expect(meRaw.body.user.permissions.distribusi).toBe(true);
    // login returns the same resolved self shape
    const relog = await request(app).post('/api/v1/auth/login').send({ username: 'gm_av', password: 'secret123' });
    expect(relog.body.user.permissions.distribusiApprove).toBe(true);
  });

  it('the legacy-blob GM CAN read the change-request inbox and sees the pending request', async () => {
    const r = await listReqs(gmLegacy, '?status=pending');
    expect(r.status).toBe(200);   // was 403 before the fix
    expect(r.body.data.some((x) => x.id === reqId)).toBe(true);
    expect(r.body.data.find((x) => x.id === reqId)).toMatchObject({ current: { qty: 5 }, requested: { qty: 3 }, newAmount: 18000 });
  });

  it('the staff requester CANNOT read the inbox or approve their own request (403)', async () => {
    expect((await listReqs(staff, '?status=pending')).status).toBe(403);
    expect((await approve(staff, reqId)).status).toBe(403);
    // even granted the cap, a requester can't self-approve
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gmLegacy)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: true } });
    const selfTok = await login('staff_av', 'secret123');
    expect((await approve(selfTok, reqId)).status).toBe(403);
    await request(app).patch(`/api/v1/users/${staffId}`).set(auth(gmLegacy)).send({ permissions: { distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiApprove: false } });
  });

  it('REJECT requires a note and leaves the transaction unchanged', async () => {
    expect((await reject(gmLegacy, reqId, '')).status).toBe(400);   // note required
    const r = await reject(gmLegacy, reqId, 'jumlah sudah benar');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('rejected');
    expect(r.body.data.decisionNote).toBe('jumlah sudah benar');
    expect((await getTxn(gmLegacy, bonId)).qty).toBe(5);   // unchanged
  });

  it('APPROVE applies the change (a fresh request from the legacy-blob GM as approver)', async () => {
    const rid = (await correct(staff, bonId, { reason: 'benar-benar salah', qty: 3, unitPrice: 6000, gallonOut: 3, gallonIn: 0 })).body.data.id;
    const r = await approve(gmLegacy, rid);
    expect(r.status).toBe(200);
    const t = await getTxn(gmLegacy, bonId);
    expect(t.qty).toBe(3);
    expect(t.amount).toBe(18000);
    expect(t.correctedManual).toBe(true);
  });
});
