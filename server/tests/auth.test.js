'use strict';
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();

beforeAll(() => resetDb());
afterAll(() => prisma.$disconnect());

describe('Health', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth', () => {
  const creds = { name: 'Test Finance', username: 'tester', password: 'secret123', role: 'finance' };

  it('registers a new user and returns a token', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('tester');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate usernames with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid registration payloads with 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ username: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'tester', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'tester', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('usernames are case-INSENSITIVE: register stores lowercase', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'Mixed', username: 'GuSDe17', password: 'secret123', role: 'finance' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('gusde17');   // normalised on save
  });

  it('login works with ANY case of the username', async () => {
    for (const u of ['gusde17', 'GUSDE17', 'GuSdE17', '  Gusde17 ']) {
      const res = await request(app).post('/api/v1/auth/login').send({ username: u, password: 'secret123' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    }
  });

  it('a duplicate that differs only by case is rejected (409)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'Dup', username: 'GUSDE17', password: 'secret123', role: 'finance' });
    expect(res.status).toBe(409);
  });

  it('login error is generic and never reveals whether the user exists', async () => {
    const noUser = await request(app).post('/api/v1/auth/login').send({ username: 'ghost_nobody', password: 'whatever1' });
    const wrongPw = await request(app).post('/api/v1/auth/login').send({ username: 'gusde17', password: 'wrongpass' });
    expect(noUser.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    expect(noUser.body.error.message).toBe(wrongPw.body.error.message);   // identical → no user-enumeration
  });

  it('GET /auth/me requires a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the current user with a valid token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'tester', password: 'secret123' });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('tester');
  });

  it('PATCH /auth/me updates the user\'s own name + colour', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'tester', password: 'secret123' });
    const res = await request(app).patch('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.token}`)
      .send({ name: 'Renamed User', color: '#7C3AED' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Renamed User');
    expect(res.body.user.color).toBe('#7C3AED');
  });

  it('PATCH /auth/me can NOT change role or permissions (stripped by schema)', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'tester', password: 'secret123' });
    const res = await request(app).patch('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.token}`)
      .send({ name: 'Still Finance', role: 'owner', permissions: { reset: true } });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Still Finance');
    expect(res.body.user.role).toBe('finance');   // role untouched — self-elevation blocked
  });

  it('PATCH /auth/me requires a token', async () => {
    const res = await request(app).patch('/api/v1/auth/me').send({ name: 'x' });
    expect(res.status).toBe(401);
  });
});
