'use strict';
// Deploy gate helper: prove the API is not just UP but actually WORKING.
//
// The 16 Jul incident was "server responds, every login fails" — a health check alone
// would have called that a success. So this drives a real authenticated round-trip:
//
//   1. GET /auth/me withOUT a token      → must be 401  (auth is actually enforced)
//   2. mint a short-lived (60s) JWT for a real active user, signed with the SAME
//      secret + payload shape the app uses, then GET /auth/me → must be 200 and
//      return that exact user (proves JWT verify + DB read + routing all work)
//
// No password is needed: the token is signed locally with JWT_SECRET from server/.env,
// which is the same secret the running API verifies against. It expires in 60s.
// Requiring ../src/config/env means a weak/missing JWT_SECRET fails here too.
const http = require('http');
const jwt = require('jsonwebtoken');
const config = require('../src/config/env');
const prisma = require('../src/lib/prisma');

const HOST = process.env.SMOKE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.SMOKE_PORT || process.env.PORT || config.port || 4000, 10);

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path, method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`timeout talking to ${HOST}:${PORT}`)));
    req.end();
  });
}

const fail = (msg) => { console.error(`SMOKE FAIL: ${msg}`); process.exitCode = 1; };

(async () => {
  // 1) auth must be ENFORCED — an unauthenticated call has to be rejected.
  const anon = await get('/api/v1/auth/me', null);
  if (anon.status !== 401) {
    fail(`GET /auth/me without a token returned ${anon.status}, expected 401 — auth is NOT being enforced`);
    return;
  }

  // 2) a real authenticated round-trip.
  const user = await prisma.user.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  if (!user) { fail('no active user in the database to authenticate as'); return; }

  const token = jwt.sign(
    { sub: user.id, role: user.role, username: user.username, permissions: user.permissions || null, fleetScope: user.fleetScope || 'all' },
    config.jwt.secret,
    { expiresIn: '60s' },
  );

  const res = await get('/api/v1/auth/me', token);
  if (res.status !== 200) { fail(`GET /auth/me → ${res.status} (expected 200): ${res.body.slice(0, 200)}`); return; }

  let parsed;
  try { parsed = JSON.parse(res.body); } catch (e) { fail(`/auth/me returned non-JSON: ${res.body.slice(0, 120)}`); return; }
  if (!parsed.user || parsed.user.id !== user.id) { fail('/auth/me returned the wrong user'); return; }

  console.log(`SMOKE OK: 401 without token, 200 authenticated round-trip as "${user.username}"`);
})()
  .catch((e) => fail(e.message))
  .finally(async () => { try { await prisma.$disconnect(); } catch (_) {} });
