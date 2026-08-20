'use strict';
// SPLIT of the penyesuaian capability: gallon adjustments (verifiable field work, staff-grantable) vs
// bon adjustments (change money owed, GM/owner tier) are now granted SEPARATELY. Asserts:
//  • a gallon-only user submits a gallon adjustment but is rejected (server-side, crafted call) on the
//    bon endpoint — and vice-versa for a bon-only user;
//  • "Rekonsiliasi Bon" (a bon adjustment, reason selisih_staf) is refused to a gallon-only user;
//  • MIGRATION: everyone who held the old combined cap gets BOTH new caps, and nobody is widened;
//  • an approved gallon adjustment leaves Sisa Bon byte-identical; an approved bon adjustment leaves
//    gallon counts byte-identical.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { resolvePerms } = require('../src/config/permissions');
const { run: runSplitCheck } = require('../scripts/split-penyesuaian-caps');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u) => request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' }).then((r) => r.body.token);
const detail = (t, id) => request(app).get('/api/v1/distribusi/customers/' + id).set(auth(t)).then((r) => r.body.data);
const adjust = (t, id, body) => request(app).post('/api/v1/distribusi/customers/' + id + '/adjustments').set(auth(t)).send(body);
const approve = (t, id) => request(app).post('/api/v1/distribusi/adjustments/' + id + '/approve').set(auth(t)).send({});
const setPerms = (ownerTok, id, permissions) => request(app).patch(`/api/v1/users/${id}`).set(auth(ownerTok)).send({ permissions });

describe('Penyesuaian split — migration derives both, widens nobody', () => {
  it('resolvePerms: the legacy combined cap grants BOTH new caps; absence grants NEITHER', () => {
    const legacy = resolvePerms('finance', { distribusi: true, distribusiPenyesuaian: true });
    expect(legacy.distribusiPenyesuaianGalon).toBe(true);
    expect(legacy.distribusiPenyesuaianBon).toBe(true);
    const none = resolvePerms('finance', { distribusi: true, distribusiInput: true });
    expect(none.distribusiPenyesuaianGalon).toBe(false);
    expect(none.distribusiPenyesuaianBon).toBe(false);
    // owner/GM keep both by default; an explicit split value wins (gallon-only staff)
    expect(resolvePerms('gm', {}).distribusiPenyesuaianBon).toBe(true);
    const galonOnly = resolvePerms('finance', { distribusiPenyesuaianGalon: true });
    expect(galonOnly.distribusiPenyesuaianGalon).toBe(true);
    expect(galonOnly.distribusiPenyesuaianBon).toBe(false);
  });

  it('the migration verification script reports NO widening on a legacy DB', async () => {
    await resetDb();
    await reg({ name: 'Owner', username: 'sp_owner', password: 'secret123', role: 'owner' });
    await reg({ name: 'GM', username: 'sp_gm', password: 'secret123', role: 'gm' });   // had combined by default → gets both
    const combined = await reg({ name: 'Combo', username: 'sp_combo', password: 'secret123', role: 'finance' });
    await prisma.user.update({ where: { id: combined.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiPenyesuaian: true }) } });   // legacy holder
    await reg({ name: 'Plain', username: 'sp_plain', password: 'secret123', role: 'finance' });   // never had it
    const res = await runSplitCheck();
    expect(res.widened).toEqual([]);
    // the legacy holder now resolves to BOTH new caps
    const eff = resolvePerms('finance', { distribusi: true, distribusiPenyesuaian: true });
    expect(eff.distribusiPenyesuaianGalon && eff.distribusiPenyesuaianBon).toBe(true);
  });
});

describe('Penyesuaian split — per-kind enforcement + byte-identical balances', () => {
  let owner, gm, galonTok, bonTok, cid, baseBon, baseGalon;
  beforeAll(async () => {
    await resetDb();
    owner = (await reg({ name: 'Owner', username: 'sp2_owner', password: 'secret123', role: 'owner' })).token;
    gm = (await reg({ name: 'GM', username: 'sp2_gm', password: 'secret123', role: 'gm' })).token;
    // gallon-only helper (staff-grantable cap)
    const g = await reg({ name: 'Galon Only', username: 'sp2_galon', password: 'secret123', role: 'finance' });
    await setPerms(owner, g.user.id, { distribusi: true, distribusiInput: true, distribusiPenyesuaianGalon: true });
    galonTok = await login('sp2_galon');
    // bon-only user
    const b = await reg({ name: 'Bon Only', username: 'sp2_bon', password: 'secret123', role: 'finance' });
    await setPerms(owner, b.user.id, { distribusi: true, distribusiInput: true, distribusiPenyesuaianBon: true });
    bonTok = await login('sp2_bon');
    await request(app).post('/api/v1/distribusi/gallon/opening').set(auth(gm)).send({ qty: 200, reason: 'stok awal', fleet: 'Merah' });
    cid = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Split', type: 'reguler', masterPrice: 50000, armada: 'Merah' })).body.data.id;
    await request(app).post('/api/v1/distribusi/transactions').set(auth(gm)).send({ customerId: cid, qty: 10, method: 'bon', txnDate: '2026-08-01', gallonOut: 12 });
    const d = await detail(gm, cid); baseBon = d.sisaBon; baseGalon = d.gallonsHeld;   // 500000 / 12
  });

  it('a GALLON-only user submits a gallon adjustment but is REJECTED on the bon endpoint (crafted call)', async () => {
    const ok = await adjust(galonTok, cid, { kind: 'galon', mode: 'set', value: 10, reason: 'rekonsiliasi_fisik', note: 'hitung fisik' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.kind).toBe('galon');
    const bad = await adjust(galonTok, cid, { kind: 'bon', mode: 'set', value: 400000, reason: 'salah_input' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.message).toMatch(/distribusiPenyesuaianBon/);
  });

  it('"Rekonsiliasi Bon" (a bon adjustment, selisih_staf) is REFUSED to a gallon-only user', async () => {
    const bad = await adjust(galonTok, cid, { kind: 'bon', mode: 'set', value: 450000, reason: 'selisih_staf', note: 'selisih setoran' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.message).toMatch(/distribusiPenyesuaianBon/);
  });

  it('a BON-only user submits a bon adjustment but is REJECTED on the gallon endpoint (crafted call)', async () => {
    const ok = await adjust(bonTok, cid, { kind: 'bon', mode: 'set', value: 400000, reason: 'salah_input' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.kind).toBe('bon');
    const bad = await adjust(bonTok, cid, { kind: 'galon', mode: 'set', value: 8, reason: 'rekonsiliasi_fisik', note: 'x' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.message).toMatch(/distribusiPenyesuaianGalon/);
  });

  it('an approved GALLON adjustment leaves Sisa Bon byte-identical', async () => {
    const before = (await detail(gm, cid)).sisaBon;
    const a = await adjust(galonTok, cid, { kind: 'galon', mode: 'set', value: 9, reason: 'rekonsiliasi_fisik', note: 'pecah 3' });
    await approve(gm, a.body.data.id);
    const d = await detail(gm, cid);
    expect(d.sisaBon).toBe(before);          // money untouched
    expect(d.gallonsHeld).toBe(9);           // gallons changed
  });

  it('an approved BON adjustment leaves gallon counts byte-identical', async () => {
    const before = (await detail(gm, cid)).gallonsHeld;
    const a = await adjust(bonTok, cid, { kind: 'bon', mode: 'set', value: 300000, reason: 'salah_input' });
    await approve(gm, a.body.data.id);
    const d = await detail(gm, cid);
    expect(d.gallonsHeld).toBe(before);      // gallons untouched
    expect(d.sisaBon).toBe(300000);          // money changed
  });
});
