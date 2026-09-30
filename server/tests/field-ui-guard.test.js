'use strict';
// The new phone UI tags every request with X-Airro-Ui: field. During the demo only a Demo penuh account
// may WRITE through it (Mode asli); reads always pass so Mode latihan can copy real data. After the
// owner releases the new UI (fieldUiDefault='new') the ordinary field caps are enough.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
const FIELD = { distribusi: true, distribusiPengiriman: true, distribusiInput: true };
const today = todayISO();
let owner, latihan, penuh, plain, cid;

const mkUser = async (username, extra) => {
  const u = await reg({ name: username, username, password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: u.user.id }, data: { permissions: JSON.stringify({ ...FIELD, ...(extra || {}) }) } });
  return login(username, 'secret123');
};
const sell = (tok, field) => {
  const r = request(app).post(`${D}/transactions`).set(auth(tok));
  if (field) r.set('X-Airro-Ui', 'field');
  return r.send({ customerId: cid, qty: 1, method: 'lunas', txnDate: today });
};

beforeAll(async () => {
  await resetDb();
  owner = (await reg({ name: 'Pemilik', username: 'fu_owner', password: 'secret123', role: 'owner' })).token;
  cid = (await request(app).post(`${D}/customers`).set(auth(owner)).send({ name: 'Toko FU', type: 'reguler', masterPrice: 6000, armada: 'DK 1' })).body.data.id;
  latihan = await mkUser('fu_latihan', { distribusiDemoLatihan: true });
  penuh = await mkUser('fu_penuh', { distribusiDemoPenuh: true });
  plain = await mkUser('fu_plain');
});
afterAll(() => prisma.$disconnect());

describe('field UI guard', () => {
  it('reads through the new UI pass for a Demo latihan account', async () => {
    const r = await request(app).get(`${D}/deliveries?date=${today}`).set(auth(latihan)).set('X-Airro-Ui', 'field');
    expect(r.status).toBe(200);
  });
  it('writes through the new UI are refused without Demo penuh', async () => {
    const r = await sell(latihan, true);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Mode asli/);
  });
  it('Demo penuh may write through the new UI', async () => {
    expect((await sell(penuh, true)).status).toBe(201);
  });
  it('the old UI (no header) is untouched', async () => {
    expect((await sell(plain, false)).status).toBe(201);
  });
  it('after release (fieldUiDefault=new) ordinary field caps are enough', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(owner)).send({ fieldUiDefault: 'new' });
    expect((await sell(plain, true)).status).toBe(201);
  });
});
