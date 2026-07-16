'use strict';
// Forgot-password request-to-admin flow: public generic endpoint (no enumeration + rate limit),
// owner/GM queue, one-click reset via the existing admin flow, forced change on next login.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p });
// Each forgot call uses a UNIQUE client IP so the 5/hour-per-IP limiter doesn't exhaust across
// the suite (the dedicated rate-limit test below deliberately reuses one IP on a fresh app).
let ipN = 0;
const forgot = (body) => request(app).post('/api/v1/auth/forgot').set('X-Forwarded-For', `10.0.${ipN++}.1`).send(body);

let owner, staffId;
beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Owner', username: 'own_fp', password: 'secret123', role: 'owner' })).token;
  const u = await reg({ name: 'Gusde', username: 'Gusde17', password: 'origpass1', role: 'finance' });
  staffId = u.user.id;
});
afterAll(() => prisma.$disconnect());

describe('Forgot password — request-to-admin', () => {
  it('POST /auth/forgot is public and returns a generic message for a REAL user (+ creates a request)', async () => {
    const r = await forgot({ username: 'gusde17', note: 'lupa sejak pagi' });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/admin/i);
    const rows = await prisma.passwordResetRequest.findMany({ where: { username: 'gusde17' } });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
  });

  it('an UNKNOWN username returns the SAME generic message and creates NO request (no enumeration)', async () => {
    const known = await forgot({ username: 'gusde17' });
    const unknown = await forgot({ username: 'ghost_nobody' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.message).toBe(known.body.message);   // identical → no leak
    expect(await prisma.passwordResetRequest.count({ where: { username: 'ghost_nobody' } })).toBe(0);
  });

  it('a repeat request for a pending username does NOT duplicate the row', async () => {
    await forgot({ username: 'gusde17', note: 'lagi' });
    expect(await prisma.passwordResetRequest.count({ where: { username: 'gusde17', status: 'pending' } })).toBe(1);
  });

  it('the queue is owner/GM-only and shows the request linked to the real user', async () => {
    const list = await request(app).get('/api/v1/users/reset-requests?status=pending').set(auth(owner));
    expect(list.status).toBe(200);
    const req = list.body.data.find((x) => x.username === 'gusde17');
    expect(req).toBeTruthy();
    expect(req.userId).toBe(staffId);
    expect(req.userName).toBe('Gusde');
    // a non-admin (finance) cannot read the queue
    const fin = (await reg({ name: 'Fin', username: 'fin_fp', password: 'secret123', role: 'finance' })).token;
    expect((await request(app).get('/api/v1/users/reset-requests').set(auth(fin))).status).toBe(403);
    expect((await forgot({ username: 'gusde17' })).status).toBe(200); // still public
  });

  it('full flow: admin resets (temp pw + force change) → marks handled → user is forced to change', async () => {
    // 1) admin sets a temporary password + mustChangePassword (the EXISTING reset flow)
    const up = await request(app).patch(`/api/v1/users/${staffId}`).set(auth(owner)).send({ password: 'temp1234', mustChangePassword: true });
    expect(up.status).toBe(200);
    expect(up.body.data.mustChangePassword).toBe(true);
    // 2) close the request
    const reqRow = await prisma.passwordResetRequest.findFirst({ where: { username: 'gusde17', status: 'pending' } });
    const done = await request(app).patch(`/api/v1/users/reset-requests/${reqRow.id}`).set(auth(owner)).send({ status: 'selesai' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('selesai');
    expect(done.body.data.handledByName).toBe('Owner');
    // 3) user logs in with the temp password (case-insensitive) → flagged to change
    const li = await login('GUSDE17', 'temp1234');
    expect(li.status).toBe(200);
    expect(li.body.user.mustChangePassword).toBe(true);
    // 4) user changes password → flag cleared, can log in normally
    const ch = await request(app).post('/api/v1/auth/change-password').set(auth(li.body.token)).send({ oldPassword: 'temp1234', newPassword: 'brandnew1' });
    expect(ch.status).toBe(200);
    const li2 = await login('gusde17', 'brandnew1');
    expect(li2.status).toBe(200);
    expect(li2.body.user.mustChangePassword).toBe(false);
  });

  it('reject (ditolak) closes a request without resetting', async () => {
    await forgot({ username: 'own_fp' });
    const row = await prisma.passwordResetRequest.findFirst({ where: { username: 'own_fp', status: 'pending' } });
    const r = await request(app).patch(`/api/v1/users/reset-requests/${row.id}`).set(auth(owner)).send({ status: 'ditolak' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ditolak');
  });

  it('the endpoint is rate-limited (max 5/hour per IP)', async () => {
    const app2 = createApp();   // fresh limiter state
    let last;
    for (let i = 0; i < 7; i++) last = await request(app2).post('/api/v1/auth/forgot').set('X-Forwarded-For', '9.9.9.9').send({ username: 'gusde17' });
    expect(last.status).toBe(429);
  });
});
