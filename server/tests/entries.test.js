'use strict';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();

let financeToken;
let ownerToken; // owner is read-only on the cash book

async function registerAndLogin(creds) {
  await request(app).post('/api/v1/auth/register').send(creds);
  const res = await request(app).post('/api/v1/auth/login').send({ username: creds.username, password: creds.password });
  return res.body.token;
}

beforeAll(async () => {
  await resetDb();
  financeToken = await registerAndLogin({ name: 'Fin', username: 'fin', password: 'secret123', role: 'finance' });
  ownerToken = await registerAndLogin({ name: 'Own', username: 'own', password: 'secret123', role: 'owner' });
});
afterAll(() => prisma.$disconnect());

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sample = { type: 'income', amount: 540000, note: '30 × Galon 19L', method: 'QRIS', date: '2026-06-03', time: '16:40' };

describe('Entries CRUD', () => {
  let id;

  it('requires auth to list', async () => {
    const res = await request(app).get('/api/v1/entries');
    expect(res.status).toBe(401);
  });

  it('creates an entry (finance role)', async () => {
    const res = await request(app).post('/api/v1/entries').set(auth(financeToken)).send(sample);
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(540000);
    id = res.body.data.id;
  });

  it('forbids owner (read-only) from creating', async () => {
    const res = await request(app).post('/api/v1/entries').set(auth(ownerToken)).send(sample);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('validates the create payload', async () => {
    const res = await request(app).post('/api/v1/entries').set(auth(financeToken)).send({ type: 'income', amount: -5, date: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists with pagination metadata', async () => {
    const res = await request(app).get('/api/v1/entries').set(auth(financeToken));
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2000, total: 1 });
    expect(res.body.data).toHaveLength(1);
  });

  it('filters by type', async () => {
    await request(app).post('/api/v1/entries').set(auth(financeToken)).send({ ...sample, type: 'expense', amount: 350000 });
    const inc = await request(app).get('/api/v1/entries?type=income').set(auth(financeToken));
    expect(inc.body.data.every((e) => e.type === 'income')).toBe(true);
    expect(inc.body.pagination.total).toBe(1);
  });

  it('gets one by id', async () => {
    const res = await request(app).get(`/api/v1/entries/${id}`).set(auth(financeToken));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('returns 404 for a missing entry', async () => {
    const res = await request(app).get('/api/v1/entries/does-not-exist').set(auth(financeToken));
    expect(res.status).toBe(404);
  });

  it('updates an entry', async () => {
    const res = await request(app).patch(`/api/v1/entries/${id}`).set(auth(financeToken)).send({ note: 'updated note' });
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe('updated note');
  });

  it('deletes an entry', async () => {
    const res = await request(app).delete(`/api/v1/entries/${id}`).set(auth(financeToken));
    expect(res.status).toBe(204);
    const after = await request(app).get(`/api/v1/entries/${id}`).set(auth(financeToken));
    expect(after.status).toBe(404);
  });
});
