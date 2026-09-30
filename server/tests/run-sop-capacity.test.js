'use strict';
// BUKA RIT — the armada's capacity is a hard physical cap (whenever it is set); the SOP minimum
// (80 galon) needs a written reason below it once the owner switches the SOP on.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const D = '/api/v1/distribusi';
const today = todayISO();
let gm;
const open = (fleet, gallonsOut, extra) => request(app).post(`${D}/runs/open`).set(auth(gm)).send({ date: today, fleet, gallonsOut, ...(extra || {}) });
const closeOpen = async (fleet) => {
  const runs = (await request(app).get(`${D}/runs?date=${today}&fleet=${encodeURIComponent(fleet)}&status=open`).set(auth(gm))).body.data;
  for (const r of runs) await request(app).post(`${D}/runs/${r.id}/close`).set(auth(gm)).send({ gallonsFullReturned: r.gallonsOut, gallonsEmptyReturned: 0 });
};

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'sop_gm', password: 'secret123', role: 'gm' })).token;
  await request(app).post(`${D}/gallon/opening`).set(auth(gm)).send({ qty: 5000, reason: 'stok awal' });
});
afterAll(() => prisma.$disconnect());

describe('SOP + capacity', () => {
  it('with no rules set, any positive load opens (today\'s behaviour)', async () => {
    expect((await open('DK 1', 10)).status).toBe(201);
    await closeOpen('DK 1');
  });

  it('capacity is enforced even while the SOP switch is off', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fleetCapacity: { 'DK 1': 120 } });
    const r = await open('DK 1', 121);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/kapasitas/i);
    expect(r.body.error.details.code).toBe('OVER_CAPACITY');
    expect((await open('DK 1', 120)).status).toBe(201);
    await closeOpen('DK 1');
  });

  it('an armada without a capacity has no limit', async () => {
    expect((await open('DK 2', 500)).status).toBe(201);
    await closeOpen('DK 2');
  });

  it('SOP on: below the minimum needs a reason, which is stored and audited', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: true } });
    let r = await open('DK 1', 64);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/80/);
    expect(r.body.error.details.code).toBe('UNDER_SOP');
    r = await open('DK 1', 64, { underSopReason: 'Pesanan tersisa sedikit' });
    expect(r.status).toBe(201);
    expect(r.body.data.underSopReason).toBe('Pesanan tersisa sedikit');
    const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
    expect(audit.some((a) => /di bawah SOP/.test(a.detail || '') && /Pesanan tersisa sedikit/.test(a.detail || ''))).toBe(true);
    await closeOpen('DK 1');
  });

  it('SOP on: at or above the minimum needs no reason', async () => {
    const r = await open('DK 1', 80);
    expect(r.status).toBe(201);
    expect(r.body.data.underSopReason).toBe('');
    await closeOpen('DK 1');
  });

  it('SOP off again: a low load opens without a reason', async () => {
    await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: false } });
    expect((await open('DK 1', 20)).status).toBe(201);
    await closeOpen('DK 1');
  });
});
