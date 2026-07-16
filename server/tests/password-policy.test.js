'use strict';
// Password policy (minimal, non-disruptive): self-serve register/change enforce min 8 chars;
// admin-set passwords may be short PINs but are FLAGGED weak for the owner (never force-reset).
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { isWeakPassword } = require('../src/services/auth.service');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let owner;
beforeAll(async () => {
  await resetDb();
  owner = (await request(app).post('/api/v1/auth/register')
    .send({ name: 'Owner', username: 'pp_owner', password: 'strongpass1', role: 'owner' })).body.token;
});
afterAll(() => prisma.$disconnect());

describe('Password policy — min length on self-serve', () => {
  it('register rejects a password shorter than 8 chars', async () => {
    const r = await request(app).post('/api/v1/auth/register')
      .send({ name: 'Short', username: 'pp_short', password: '1234', role: 'finance' });
    expect(r.status).toBe(400);
    expect(await prisma.user.count({ where: { username: 'pp_short' } })).toBe(0);
  });

  it('register accepts an 8+ char password and does NOT flag it weak', async () => {
    const r = await request(app).post('/api/v1/auth/register')
      .send({ name: 'Ok', username: 'pp_ok', password: 'longenough1', role: 'finance' });
    expect(r.status).toBe(201);
    expect(r.body.user.weakPassword).toBe(false);
  });
});

describe('Password policy — weak flag for the owner', () => {
  it('flags a user created by the admin with a short PIN, and surfaces it in the list', async () => {
    const c = await request(app).post('/api/v1/users').set(auth(owner))
      .send({ name: 'PIN User', username: 'pp_pin', password: '1234', role: 'finance' });
    expect(c.status).toBe(201);
    expect(c.body.data.weakPassword).toBe(true);
    const list = await request(app).get('/api/v1/users').set(auth(owner));
    expect(list.body.data.find((u) => u.username === 'pp_pin').weakPassword).toBe(true);
  });

  it('admin resetting to a strong password clears the flag', async () => {
    const u = await prisma.user.findUnique({ where: { username: 'pp_pin' } });
    const up = await request(app).patch(`/api/v1/users/${u.id}`).set(auth(owner))
      .send({ password: 'a-strong-one1' });
    expect(up.status).toBe(200);
    expect(up.body.data.weakPassword).toBe(false);
  });

  it('self change-password: weak → still flagged is impossible (min 8 enforced); strong clears it', async () => {
    // Give the user a weak PIN via admin, log in, then self-change to a strong one.
    const u = await prisma.user.findUnique({ where: { username: 'pp_pin' } });
    await request(app).patch(`/api/v1/users/${u.id}`).set(auth(owner)).send({ password: '1234' });
    const li = await request(app).post('/api/v1/auth/login').send({ username: 'pp_pin', password: '1234' });
    expect(li.body.user.weakPassword).toBe(true);
    // < 8 is rejected outright
    const bad = await request(app).post('/api/v1/auth/change-password').set(auth(li.body.token))
      .send({ oldPassword: '1234', newPassword: 'abc12' });
    expect(bad.status).toBe(400);
    // strong → flag cleared
    const ok = await request(app).post('/api/v1/auth/change-password').set(auth(li.body.token))
      .send({ oldPassword: '1234', newPassword: 'freshstrong9' });
    expect(ok.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after.weakPassword).toBe(false);
  });
});

describe('isWeakPassword() unit', () => {
  it('flags short, all-same, ascending runs and notorious passwords', () => {
    ['1234', '', 'abc', '1111111', '00000000', '12345678', 'password', 'iloveyou', '123456789']
      .forEach((p) => expect(isWeakPassword(p)).toBe(true));
  });
  it('accepts a reasonable password', () => {
    ['longenough1', 'a-strong-one1', 'freshstrong9', 'Tr0ub4dour'].forEach((p) => expect(isWeakPassword(p)).toBe(false));
  });
});
