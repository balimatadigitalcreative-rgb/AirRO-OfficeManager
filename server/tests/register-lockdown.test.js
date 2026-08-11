'use strict';
// SECURITY regression test for the /auth/register privilege-escalation fix. Outside the test harness
// (config.env !== 'test') registration is BOOTSTRAP-ONLY: it creates the first account on an empty DB,
// then closes — so an anonymous caller can never POST {role:'owner'} and receive an owner token. We
// flip config.env to simulate a real deploy, since the harness itself keeps the endpoint open to seed
// users. auth.service reads the SAME config object, so mutating it here exercises the production path.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const config = require('../src/config/env');
const app = createApp();
const reg = (body) => request(app).post('/api/v1/auth/register').send(body);

describe('register lockdown — anonymous role escalation is blocked in production', () => {
  afterAll(() => prisma.$disconnect());

  it('in the test harness the endpoint stays open (this is how tests seed users)', async () => {
    await resetDb();
    const r = await reg({ name: 'A', username: 'boot_a', password: 'secret123', role: 'gm' });
    expect(r.status).toBe(201);
  });

  it('with lockdown ON and a user already present, a second registration is refused (403)', async () => {
    const prev = config.env;
    config.env = 'production';   // simulate a real deploy (client never calls this endpoint)
    try {
      const r = await reg({ name: 'Evil', username: 'attacker', password: 'secret123', role: 'owner' });
      expect(r.status).toBe(403);
      expect(await prisma.user.findUnique({ where: { username: 'attacker' } })).toBeNull();   // account NOT created
    } finally { config.env = prev; }
  });

  it('with lockdown ON but an EMPTY database, the first (bootstrap) account is still allowed', async () => {
    await resetDb();
    const prev = config.env;
    config.env = 'production';
    try {
      const r = await reg({ name: 'Owner', username: 'first_owner', password: 'secret123', role: 'owner' });
      expect(r.status).toBe(201);
    } finally { config.env = prev; }
  });
});
