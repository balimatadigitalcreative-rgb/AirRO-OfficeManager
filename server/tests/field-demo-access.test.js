'use strict';
// MODE LAPANGAN — izin demo: dua tingkat, TIDAK PERNAH diturunkan dari peran, hanya Owner yang memberi.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const setPerms = (tok, id, permissions) => request(app).patch(`/api/v1/users/${id}`).set(auth(tok)).send({ permissions });
const effective = async (tok, id) => (await request(app).get(`/api/v1/users/${id}`).set(auth(tok))).body.data.permissions || {};
const FIELD = { distribusi: true, distribusiPengiriman: true, distribusiInput: true };

let owner, gm, driverId, gmId;
beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'fd_owner', password: 'secret123', role: 'owner' })).token;
  const g = await reg({ name: 'GM', username: 'fd_gm', password: 'secret123', role: 'gm' });
  gm = g.token; gmId = g.user.id;
  driverId = (await reg({ name: 'Sopir', username: 'fd_driver', password: 'secret123', role: 'finance' })).user.id;
  await setPerms(owner, driverId, FIELD);
});
afterAll(() => prisma.$disconnect());

describe('izin demo', () => {
  it('tidak diturunkan dari peran: owner dan GM pun default false', async () => {
    const me = (await request(app).get('/api/v1/auth/me').set(auth(owner))).body;
    const perms = (me.data || me.user || me).permissions;
    expect(perms.distribusiDemoLatihan).toBe(false);
    expect(perms.distribusiDemoPenuh).toBe(false);
    const gp = await effective(owner, gmId);
    expect(!!gp.distribusiDemoPenuh).toBe(false);
  });

  it('GM tidak boleh memberi Demo latihan maupun Demo penuh', async () => {
    let r = await setPerms(gm, driverId, { ...FIELD, distribusiDemoLatihan: true });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Pemilik/);
    r = await setPerms(gm, driverId, { ...FIELD, distribusiDemoPenuh: true });
    expect(r.status).toBe(403);
    expect(!!(await effective(owner, driverId)).distribusiDemoLatihan).toBe(false);
  });

  it('Owner boleh memberi; Demo penuh menyiratkan Demo latihan', async () => {
    const r = await setPerms(owner, driverId, { ...FIELD, distribusiDemoPenuh: true });
    expect(r.status).toBe(200);
    // GET /users/:id returns the STORED blob; the implication lives in the RESOLVED caps (/auth/me).
    const tok = (await request(app).post('/api/v1/auth/login').send({ username: 'fd_driver', password: 'secret123' })).body.token;
    const me = (await request(app).get('/api/v1/auth/me').set(auth(tok))).body;
    const p = (me.data || me.user || me).permissions;
    expect(p.distribusiDemoPenuh).toBe(true);
    expect(p.distribusiDemoLatihan).toBe(true);
  });

  it('GM juga tidak boleh MENCABUT izin demo', async () => {
    const r = await setPerms(gm, driverId, { ...FIELD });
    expect(r.status).toBe(403);
    expect((await effective(owner, driverId)).distribusiDemoPenuh).toBe(true);
  });

  it('GM tetap boleh mengubah izin lain selama izin demo tidak berubah', async () => {
    const r = await setPerms(gm, driverId, { ...FIELD, distribusiExpense: true, distribusiDemoPenuh: true });
    expect(r.status).toBe(200);
  });
});

describe('katalog izin (klien)', () => {
  it('kedua izin demo ada di katalog sebagai ownerOnly, dan file ter-parse', () => {
    const fs = require('fs'); const path = require('path');
    const { parse } = require('@babel/parser');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-users.jsx'), 'utf8');
    expect(src).toMatch(/\['distribusiDemoLatihan', 'distribusi', [^\n]*ownerOnly: true/);
    expect(src).toMatch(/\['distribusiDemoPenuh', 'distribusi', [^\n]*ownerOnly: true/);
    expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  });
});
