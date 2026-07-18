'use strict';
// Build-stamp endpoint that the web app polls to detect a stale tab after a deploy.
// Must be public (no auth), cheap, and no-store. The value comes from version.json
// at the repo root (written by build.mjs); it may be null in a bare checkout.
const request = require('supertest');
const createApp = require('../src/app');

const app = createApp();

describe('GET /api/v1/version — frontend code-freshness stamp', () => {
  it('is public (no token) and returns a { version } shape', async () => {
    const r = await request(app).get('/api/v1/version');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('version');           // string when built, null in a bare checkout
    expect(['string', 'object']).toContain(typeof r.body.version);  // string | null
  });

  it('is sent no-store so a proxy/browser never caches a stale stamp', async () => {
    const r = await request(app).get('/api/v1/version');
    expect((r.headers['cache-control'] || '')).toMatch(/no-store/);
  });

  it('is not blocked by the general API rate limiter (exempt path)', async () => {
    // The limiter is inert in tests unless a request opts in; opting in on an EXEMPT
    // path must still pass every time (no 429), even well past the limit.
    let last;
    for (let i = 0; i < 20; i++) last = await request(app).get('/api/v1/version').set('x-ratelimit-test', 'on');
    expect(last.status).toBe(200);
  });
});
