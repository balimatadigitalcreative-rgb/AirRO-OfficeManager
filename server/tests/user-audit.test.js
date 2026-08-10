'use strict';
// PART 2 — admin audit trail: every permission/role/status change writes an auditable before→after
// diff (actor, target, timestamp), and login stamps lastLoginAt ("Terakhir masuk").
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p });

let owner, ownerName;
beforeAll(async () => { await resetDb(); const o = await reg({ name: 'Boss', username: 'own_ua', password: 'secret123', role: 'owner' }); owner = o.token; ownerName = o.user.name; });
afterAll(() => prisma.$disconnect());

describe('login stamps lastLoginAt', () => {
  it('a fresh login records lastLoginAt and it is returned to the admin list', async () => {
    const u = await reg({ name: 'Staff', username: 'staff_ua', password: 'secret123', role: 'finance' });
    await login('staff_ua', 'secret123');
    const list = await request(app).get('/api/v1/users').set(auth(owner));
    const row = list.body.data.find((x) => x.id === u.user.id);
    expect(row.lastLoginAt).toBeTruthy();
  });
});

describe('permission change → audit with before→after diff', () => {
  it('granting a cap writes an audit entry naming the added cap + the actor', async () => {
    const u = await reg({ name: 'Clerk', username: 'clerk_ua', password: 'secret123', role: 'finance' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ permissions: { gudangGalonView: true, gudangGalonKoreksi: true } });
    const audit = await request(app).get('/api/v1/users/audit?userId=' + u.user.id).set(auth(owner));
    expect(audit.status).toBe(200);
    const permEntry = audit.body.data.find((a) => a.action === 'permissions');
    expect(permEntry).toBeTruthy();
    expect(permEntry.actorName).toBe(ownerName);
    expect(permEntry.detail.added).toEqual(expect.arrayContaining(['gudangGalonView', 'gudangGalonKoreksi']));
    expect(permEntry.targetName).toBe('Clerk');
  });
  it('role + active changes each write their own audit entry', async () => {
    const u = await reg({ name: 'Roley', username: 'roley_ua', password: 'secret123', role: 'finance' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ role: 'hrd' });
    await request(app).patch('/api/v1/users/' + u.user.id).set(auth(owner)).send({ active: false });
    const audit = (await request(app).get('/api/v1/users/audit?userId=' + u.user.id).set(auth(owner))).body.data;
    expect(audit.some((a) => a.action === 'role' && a.detail.from === 'finance' && a.detail.to === 'hrd')).toBe(true);
    expect(audit.some((a) => a.action === 'active' && a.detail.to === false)).toBe(true);
  });
  it('creating a user via /users is audited, and the global feed lists changes across users', async () => {
    const created = await request(app).post('/api/v1/users').set(auth(owner)).send({ name: 'Made', username: 'made_ua', password: 'secret123', role: 'finance' });
    expect(created.status).toBe(201);
    const all = await request(app).get('/api/v1/users/audit').set(auth(owner));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(4);
    expect(all.body.data.some((a) => a.action === 'create' && a.targetName === 'Made')).toBe(true);
  });
  it('a non-admin cannot read the audit feed', async () => {
    await reg({ name: 'NoAdmin', username: 'noadm_ua', password: 'secret123', role: 'finance' });
    const t = (await login('noadm_ua', 'secret123')).body.token;
    expect((await request(app).get('/api/v1/users/audit').set(auth(t))).status).toBe(403);
  });
});
