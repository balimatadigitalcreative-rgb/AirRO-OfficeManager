'use strict';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const login = async (u, p) => (await request(app).post('/api/v1/auth/login').send({ username: u, password: p })).body.token;

let gmToken;
beforeAll(async () => {
  await resetDb();
  await request(app).post('/api/v1/auth/register').send({ name: 'GM', username: 'gmx', password: 'secret123', role: 'gm' });
  gmToken = await login('gmx', 'secret123');
  await prisma.category.create({ data: { key: 'Refill', label: 'Refill', icon: 'IconDrop', type: 'income' } });
});
afterAll(() => prisma.$disconnect());

describe('Per-user permission overrides', () => {
  it('override can DISABLE a capability the role normally has', async () => {
    const create = await request(app).post('/api/v1/users').set(auth(gmToken)).send({
      name: 'Limited Fin', username: 'limfin', password: '1234', role: 'finance',
      permissions: { cashflow: true, seeMoney: true, addEntry: false, edit: false, delete: false, allEntries: true },
    });
    expect(create.status).toBe(201);
    expect(create.body.data.permissions.addEntry).toBe(false);

    const t = await login('limfin', '1234');
    // can read (cashflow:true)
    expect((await request(app).get('/api/v1/entries').set(auth(t))).status).toBe(200);
    // cannot add (addEntry:false) — even though the finance role normally can
    const add = await request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount: 1000, date: '2026-06-01' });
    expect(add.status).toBe(403);
  });

  it('override can ENABLE a capability the role normally lacks', async () => {
    const create = await request(app).post('/api/v1/users').set(auth(gmToken)).send({
      name: 'Power Admin', username: 'pwradmin', password: '1234', role: 'adminfin',
      permissions: { cashflow: true, seeMoney: true, addEntry: true, allEntries: true },
    });
    expect(create.status).toBe(201);

    const t = await login('pwradmin', '1234');
    // adminfin normally cannot addEntry; override allows it
    const add = await request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount: 1000, date: '2026-06-01', categoryKey: 'Refill' });
    expect(add.status).toBe(201);
  });

  it('no override falls back to role defaults', async () => {
    const create = await request(app).post('/api/v1/users').set(auth(gmToken)).send({ name: 'Normal Fin', username: 'normfin', password: '1234', role: 'finance' });
    expect(create.status).toBe(201);
    expect(create.body.data.permissions).toBeNull();

    const t = await login('normfin', '1234');
    const add = await request(app).post('/api/v1/entries').set(auth(t)).send({ type: 'income', amount: 1000, date: '2026-06-01', categoryKey: 'Refill' });
    expect(add.status).toBe(201);   // finance role default allows addEntry
  });

  it('updating permissions takes effect on next login', async () => {
    // normfin currently has no override (can add). Disable cashflow → can't even read.
    const u = (await request(app).get('/api/v1/users').set(auth(gmToken))).body.data.find((x) => x.username === 'normfin');
    await request(app).patch('/api/v1/users/' + u.id).set(auth(gmToken)).send({ permissions: { cashflow: false } });
    const t = await login('normfin', '1234');
    expect((await request(app).get('/api/v1/entries').set(auth(t))).status).toBe(403);
  });
});
