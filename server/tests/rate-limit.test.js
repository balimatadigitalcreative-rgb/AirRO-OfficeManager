'use strict';
// Rate limiting (express-rate-limit). The three limiters share ONE in-memory store per process
// and are INERT in tests UNLESS a request opts in with the header `x-ratelimit-test: on`.
// That keeps the ~180 other tests (which fire far more than 300 req/min) from ever tripping them,
// while this file drives the real limiters by opting in. Per-IP counting relies on trust proxy=1,
// so requests set X-Forwarded-For to simulate distinct clients behind Nginx.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { LOGIN_MSG } = require('../src/middleware/rateLimiters');

const app = createApp();
const ON = { 'x-ratelimit-test': 'on' };
const login = (u, p, ip) => request(app).post('/api/v1/auth/login')
  .set('X-Forwarded-For', ip).set(ON).send({ username: u, password: p });

beforeAll(async () => {
  await resetDb();
  await request(app).post('/api/v1/auth/register')
    .send({ name: 'Owner', username: 'rl_owner', password: 'strongpass1', role: 'owner' });
});
afterAll(() => prisma.$disconnect());

describe('Rate limiting — login (10 / 15 min / IP)', () => {
  it('blocks the 11th FAILED login within the window → 429 + Indonesian message', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await login('rl_owner', 'wrongpass', '203.0.113.10');
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(last.body.error.message).toBe(LOGIN_MSG);
  });

  it('a DIFFERENT IP is unaffected (limiter is per-IP)', async () => {
    const r = await login('rl_owner', 'strongpass1', '203.0.113.99');
    expect(r.status).toBe(200);   // fresh IP, correct password → normal login
  });

  it('SUCCESSFUL logins never count toward the limit (skipSuccessfulRequests)', async () => {
    let last;
    for (let i = 0; i < 15; i++) last = await login('rl_owner', 'strongpass1', '203.0.113.55');
    expect(last.status).toBe(200);   // 15 good logins on one IP, still allowed
  });
});

describe('Rate limiting — general API limiter (SSE + polling unaffected)', () => {
  // /api/v1/events (SSE) and /api/v1/health are exempted by the same skip(); testing /health
  // proves the mechanism without opening a hanging SSE stream. Exempted requests are never
  // counted, so express-rate-limit emits NO RateLimit headers for them.
  it('/health is EXEMPT — no RateLimit headers', async () => {
    const r = await request(app).get('/api/v1/health').set('X-Forwarded-For', '198.51.100.1').set(ON);
    expect(r.status).toBe(200);
    expect(r.headers['ratelimit-policy']).toBeUndefined();
    expect(r.headers['ratelimit']).toBeUndefined();
  });

  it('a normal API route IS counted — RateLimit headers present', async () => {
    // No token → 401, but the apiLimiter still ran first and set the standard headers.
    const r = await request(app).get('/api/v1/users').set('X-Forwarded-For', '198.51.100.2').set(ON);
    expect(r.headers['ratelimit-policy'] || r.headers['ratelimit']).toBeDefined();
  });
});

// A WHOLE OFFICE SHARES ONE PUBLIC IP (and phones on mobile data share carrier NAT). Counting the API
// budget per IP meant a handful of open tabs used up everybody's quota and every dashboard in the
// office failed at once with 429. A signed-in request is now counted per USER; only anonymous traffic
// is counted per IP. A token that does not verify is anonymous — it cannot buy a fresh bucket.
describe('Rate limiting — general API limiter is per USER when signed in', () => {
  const OFFICE_IP = '203.0.113.50';
  const { API_MAX } = require('../src/middleware/rateLimiters');
  let tokA, tokB;
  beforeAll(async () => {
    tokA = (await request(app).post('/api/v1/auth/register').send({ name: 'A', username: 'rl_a', password: 'strongpass1', role: 'gm' })).body.token;
    tokB = (await request(app).post('/api/v1/auth/register').send({ name: 'B', username: 'rl_b', password: 'strongpass1', role: 'gm' })).body.token;
  });
  const me = (tok, ip) => request(app).get('/api/v1/auth/me').set('X-Forwarded-For', ip).set(ON).set(tok ? { Authorization: 'Bearer ' + tok } : {});

  it('one user using up their budget does not block a colleague on the same IP', async () => {
    for (let i = 0; i < API_MAX; i++) await me(tokA, OFFICE_IP);
    const a = await me(tokA, OFFICE_IP);
    expect(a.status).toBe(429);
    const b = await me(tokB, OFFICE_IP);
    expect(b.status).toBe(200);
  }, 60000);

  it('a forged token is anonymous: it shares the IP bucket instead of getting a fresh one', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < API_MAX; i++) await me(null, ip);
    const forged = await me('not.a.real.token', ip);
    expect(forged.status).toBe(429);
  }, 60000);
});
