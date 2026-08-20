'use strict';
// SELF-APPROVAL (distribusiApproveSelf) — a deliberate, owner-granted waiver of segregation of duties
// so a lone owner/GM isn't deadlocked approving their own submission. This asserts the whole control:
//  • WITHOUT the cap, a requester approving their OWN change request is rejected server-side, even via a
//    crafted direct API call (the UI hint is not the enforcement);
//  • WITH distribusiApprove + distribusiApproveSelf, the self-approval SUCCEEDS and the record carries
//    selfApproved=true (badge) + a self-approval audit row (the "Persetujuan mandiri" filter);
//  • a normal approver deciding SOMEONE ELSE's request is unaffected — selfApproved stays false;
//  • an amount ABOVE the per-approver ceiling (maxSelfApproveAmount) is refused with a clear message,
//    even holding the cap; below it succeeds;
//  • disputes obey the same rule (approving a dispute over your OWN transaction);
//  • only the OWNER may grant the cap (a GM admin is refused), and the grant lands in UserAuditLog.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { promoteToOwner, listRoles } = require('../scripts/promote-owner');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const setPerms = (actorTok, id, permissions) => request(app).patch(`/api/v1/users/${id}`).set(auth(actorTok)).send({ permissions });
const mkTxn = async (t, customerId, qty) => (await request(app).post('/api/v1/distribusi/transactions').set(auth(t)).send({ customerId, qty, method: 'bon', txnDate: '2026-04-01', gallonOut: qty })).body.data.id;
const correct = (t, id, body) => request(app).post(`/api/v1/distribusi/transactions/${id}/corrections`).set(auth(t)).send(body);
const approveReq = (t, id, body) => request(app).post(`/api/v1/distribusi/change-requests/${id}/approve`).set(auth(t)).send(body || {});
const listReqs = async (t, qs) => (await request(app).get('/api/v1/distribusi/change-requests' + (qs || '')).set(auth(t))).body.data;
const audit = async (t) => (await request(app).get('/api/v1/distribusi/audit').set(auth(t))).body.data;
const userAudit = async (t, id) => (await request(app).get(`/api/v1/users/audit?userId=${id}`).set(auth(t))).body.data;

// A distribusi actor who may request AND approve corrections (the base for the self-approval cases).
const APPROVER_PERMS = (extra) => ({ distribusi: true, distribusiInput: true, distribusiKoreksi: true, distribusiVoid: true, distribusiBonAdjust: true, distribusiApprove: true, ...(extra || {}) });

let owner, gm, cid;

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'sa_owner', password: 'secret123', role: 'owner' })).token;
  gm = (await reg({ name: 'GM', username: 'sa_gm', password: 'secret123', role: 'gm' })).token;   // manageUsers, but NOT owner
  cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(owner)).send({ name: 'Toko SA', type: 'reguler', masterPrice: 6000, armada: 'Merah' })).body.data.id;
  await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(owner)).send({ qty: 900, reason: 'stok awal', fleet: 'Merah' });
});
afterAll(() => prisma.$disconnect());

describe('Self-approval capability — grant is owner-only + audited', () => {
  let selfId;
  beforeAll(async () => {
    const u = await reg({ name: 'Andi Self', username: 'sa_self', password: 'secret123', role: 'finance' });
    selfId = u.user.id;
    await setPerms(owner, selfId, APPROVER_PERMS());   // approver, no self yet
  });

  it('a GM (manageUsers but not owner) CANNOT grant distribusiApproveSelf', async () => {
    const r = await setPerms(gm, selfId, APPROVER_PERMS({ distribusiApproveSelf: true }));
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Pemilik/i);
    // and the cap did NOT stick
    const eff = (await request(app).get(`/api/v1/users/${selfId}`).set(auth(owner))).body.data;
    expect(!!(eff.permissions && eff.permissions.distribusiApproveSelf)).toBe(false);
  });

  it('the OWNER can grant it, and the grant is written to UserAuditLog', async () => {
    const r = await setPerms(owner, selfId, APPROVER_PERMS({ distribusiApproveSelf: true }));
    expect(r.status).toBe(200);
    const rows = await userAudit(owner, selfId);
    const permRow = rows.find((x) => x.action === 'permissions' && x.detail && (x.detail.added || []).includes('distribusiApproveSelf'));
    expect(permRow).toBeTruthy();
  });
});

describe('Owner-role assignment is owner-only + the promote-owner recovery path', () => {
  it('a GM (manageUsers, not owner) CANNOT assign the owner role via the API', async () => {
    const u = await reg({ name: 'Wanna Owner', username: 'sa_wannaown', password: 'secret123', role: 'finance' });
    const r = await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(gm)).send({ role: 'owner' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Pemilik/i);
    expect((await request(app).get(`/api/v1/users/${u.user.id}`).set(auth(owner))).body.data.role).toBe('finance');
  });

  it('an OWNER can assign the owner role via the API', async () => {
    const u = await reg({ name: 'Made Owner', username: 'sa_madeown', password: 'secret123', role: 'finance' });
    const r = await request(app).patch(`/api/v1/users/${u.user.id}`).set(auth(owner)).send({ role: 'owner' });
    expect(r.status).toBe(200);
    expect(r.body.data.role).toBe('owner');
  });

  it('the promote-owner CLI promotes a named user and records it in UserAuditLog (the deadlock escape)', async () => {
    const u = await reg({ name: 'Deadlock GM', username: 'sa_deadlock', password: 'secret123', role: 'gm' });
    const res = await promoteToOwner('sa_deadlock');
    expect(res.changed).toBe(true);
    expect(res.from).toBe('gm');
    expect((await request(app).get(`/api/v1/users/${u.user.id}`).set(auth(owner))).body.data.role).toBe('owner');
    const rows = await request(app).get(`/api/v1/users/audit?userId=${u.user.id}`).set(auth(owner));
    const roleRow = rows.body.data.find((x) => x.action === 'role' && x.detail && x.detail.to === 'owner' && x.detail.via === 'cli');
    expect(roleRow).toBeTruthy();
    // idempotent — re-running is a no-op
    expect((await promoteToOwner('sa_deadlock')).changed).toBe(false);
    // --list diagnostic sees at least our promoted owner
    const { activeOwners } = await listRoles();
    expect(activeOwners.some((o) => o.username === 'sa_deadlock')).toBe(true);
  });
});

describe('Self-approval enforcement on change requests', () => {
  let selfTok, selfId, otherTok, otherId;
  beforeAll(async () => {
    const s = await reg({ name: 'Sari Self', username: 'sa_self2', password: 'secret123', role: 'finance' });
    selfId = s.user.id;
    await setPerms(owner, selfId, APPROVER_PERMS());   // approver WITHOUT self-approve (yet)
    selfTok = await login('sa_self2', 'secret123');
    const o = await reg({ name: 'Other Approver', username: 'sa_other', password: 'secret123', role: 'finance' });
    otherId = o.user.id;
    await setPerms(owner, otherId, APPROVER_PERMS());
    otherTok = await login('sa_other', 'secret123');
  });

  it('WITHOUT distribusiApproveSelf, a requester approving their OWN request is rejected (crafted API call)', async () => {
    const txn = await mkTxn(owner, cid, 5);   // 30.000
    const cr = (await correct(selfTok, txn, { reason: 'salah jumlah', qty: 3, unitPrice: 6000, gallonOut: 3 })).body.data;
    const r = await approveReq(selfTok, cr.id);   // the requester tries to approve their own — directly at the API
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/sendiri/i);
    // a DIFFERENT approver decides it normally → NOT flagged self-approved
    const ok = await approveReq(otherTok, cr.id);
    expect(ok.status).toBe(200);
    const decided = (await listReqs(owner, '?status=approved')).find((x) => x.id === cr.id);
    expect(decided.selfApproved).toBe(false);
  });

  it('WITH both caps, the requester approves their OWN request → success + selfApproved=true + audit', async () => {
    await setPerms(owner, selfId, APPROVER_PERMS({ distribusiApproveSelf: true }));
    selfTok = await login('sa_self2', 'secret123');
    const txn = await mkTxn(owner, cid, 4);   // 24.000
    const cr = (await correct(selfTok, txn, { reason: 'koreksi mandiri', qty: 2, unitPrice: 6000, gallonOut: 2 })).body.data;
    const r = await approveReq(selfTok, cr.id);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    expect(r.body.data.selfApproved).toBe(true);
    // surfaced on the inbox record (badge) …
    const decided = (await listReqs(owner, '?status=approved')).find((x) => x.id === cr.id);
    expect(decided.selfApproved).toBe(true);
    // … and as a self-approval audit row (the "Persetujuan mandiri" filter reads a.selfApproved)
    const a = await audit(owner);
    const selfRow = a.find((x) => x.selfApproved === true && /koreksi mandiri/.test(x.detail || ''));
    expect(selfRow).toBeTruthy();
  });

  it('a plain approver deciding someone ELSE’s request is unaffected (selfApproved stays false)', async () => {
    const txn = await mkTxn(owner, cid, 3);
    const cr = (await correct(otherTok, txn, { reason: 'bukan punya penyetuju', qty: 1, unitPrice: 6000, gallonOut: 1 })).body.data;
    const r = await approveReq(selfTok, cr.id);   // selfTok has approveSelf, but this isn't their request
    expect(r.status).toBe(200);
    expect(r.body.data.selfApproved).toBe(false);
  });
});

describe('Self-approval ceiling (maxSelfApproveAmount)', () => {
  let selfTok, selfId;
  beforeAll(async () => {
    const s = await reg({ name: 'Budi Limit', username: 'sa_limit', password: 'secret123', role: 'finance' });
    selfId = s.user.id;
    await setPerms(owner, selfId, APPROVER_PERMS({ distribusiApproveSelf: true, maxSelfApproveAmount: 20000 }));
    selfTok = await login('sa_limit', 'secret123');
  });

  it('ABOVE the ceiling, self-approval is refused with a clear message — the request stays pending', async () => {
    const txn = await mkTxn(owner, cid, 5);   // 30.000 > 20.000 ceiling
    const cr = (await correct(selfTok, txn, { reason: 'di atas batas', qty: 4, unitPrice: 6000, gallonOut: 4 })).body.data;
    const r = await approveReq(selfTok, cr.id);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/batas persetujuan mandiri/i);
    expect(r.body.error.details.overSelfApproveLimit).toBe(true);
    expect(r.body.error.details.selfApproveLimit).toBe(20000);
    // still pending — waiting for another approver
    expect((await listReqs(owner, '?status=pending')).some((x) => x.id === cr.id)).toBe(true);
  });

  it('BELOW the ceiling, the same user self-approves fine', async () => {
    const txn = await mkTxn(owner, cid, 3);   // 18.000 ≤ 20.000
    const cr = (await correct(selfTok, txn, { reason: 'di bawah batas', qty: 2, unitPrice: 6000, gallonOut: 2 })).body.data;
    const r = await approveReq(selfTok, cr.id);
    expect(r.status).toBe(200);
    expect(r.body.data.selfApproved).toBe(true);
  });
});

describe('Self-approval on disputes obeys the same rule', () => {
  // Dispute approval is GM/owner-tier by ROLE, so this uses a GM who handles the txn then disputes it.
  it('a GM cannot approve a dispute over their OWN transaction without the cap, but can with it', async () => {
    const s = await reg({ name: 'Dewi GM', username: 'sa_dispgm', password: 'secret123', role: 'gm' });
    let tok = await login('sa_dispgm', 'secret123');
    const txn = await mkTxn(tok, cid, 5);   // handled BY this GM → they are the txn actor
    // WITHOUT the cap, even raising a dispute over your OWN transaction is blocked (deadlock guard).
    const raiseBlocked = await request(app).post(`/api/v1/distribusi/transactions/${txn}/dispute`).set(auth(tok)).send({ reason: 'nominal_beda', resolution: 'staf', note: 'selisih', customerClaimAmount: 20000 });
    expect(raiseBlocked.status).toBe(403);
    expect(raiseBlocked.body.error.message).toMatch(/sendiri/i);
    // grant the cap (owner-only) → they may now raise AND self-approve; it is flagged self-approved.
    await setPerms(owner, s.user.id, APPROVER_PERMS({ distribusiApproveSelf: true }));
    tok = await login('sa_dispgm', 'secret123');
    const d = (await request(app).post(`/api/v1/distribusi/transactions/${txn}/dispute`).set(auth(tok)).send({ reason: 'nominal_beda', resolution: 'staf', note: 'selisih', customerClaimAmount: 20000 })).body.data;
    const ap = await request(app).post(`/api/v1/distribusi/disputes/${d.id}/approve`).set(auth(tok)).send({ resolution: 'staf' });
    expect(ap.status).toBe(200);
    expect(ap.body.data.selfApproved).toBe(true);
  });
});
