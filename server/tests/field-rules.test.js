'use strict';
// ATURAN LAPANGAN — one settings object: SOP muatan, kapasitas per armada, saklar foto/alasan, harga
// ganti rugi galon, default tampilan. Everything defaults OFF; only owner/GM may change it; every change
// is audited in the distribusi audit log.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);
const login = (u, p) => request(app).post('/api/v1/auth/login').send({ username: u, password: p }).then((r) => r.body.token);
const D = '/api/v1/distribusi';
let gm, driver;

beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'Boss', username: 'fr_gm', password: 'secret123', role: 'gm' })).token;
  const d = await reg({ name: 'Sopir', username: 'fr_driver', password: 'secret123', role: 'finance' });
  await prisma.user.update({ where: { id: d.user.id }, data: { permissions: JSON.stringify({ distribusi: true, distribusiPengiriman: true }) } });
  driver = await login('fr_driver', 'secret123');
});
afterAll(() => prisma.$disconnect());

describe('field rules', () => {
  it('defaults: everything off, SOP 80, no capacities, old UI', async () => {
    const r = await request(app).get(`${D}/field-rules`).set(auth(driver));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      ritSop: { enabled: false, minLoad: 80 }, fleetCapacity: {},
      wajibFotoTransaksi: false, wajibFotoPengeluaran: false, wajibAlasanBatal: false,
      hargaGantiRugiGalon: 0, fieldUiDefault: 'old',
    });
  });

  it('a driver cannot change the rules', async () => {
    const r = await request(app).put(`${D}/field-rules`).set(auth(driver)).send({ ritSop: { enabled: true } });
    expect(r.status).toBe(403);
  });

  it('owner/GM patch merges, validates and audits', async () => {
    const r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { enabled: true }, fleetCapacity: { 'DK 1': 120, 'DK 2': 70 }, hargaGantiRugiGalon: 45000 });
    expect(r.status).toBe(200);
    expect(r.body.data.ritSop).toEqual({ enabled: true, minLoad: 80 });   // minLoad kept
    expect(r.body.data.fleetCapacity).toEqual({ 'DK 1': 120, 'DK 2': 70 });
    expect(r.body.data.hargaGantiRugiGalon).toBe(45000);
    const audit = (await request(app).get(`${D}/audit`).set(auth(gm))).body.data;
    expect(audit.some((a) => /Aturan lapangan/.test(a.title) && /SOP/.test(a.detail))).toBe(true);
  });

  it('a capacity of 0 or empty removes the limit; nonsense is refused', async () => {
    let r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fleetCapacity: { 'DK 2': 0 } });
    expect(r.body.data.fleetCapacity).toEqual({ 'DK 1': 120 });
    r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ ritSop: { minLoad: -5 } });
    expect(r.status).toBe(400);
    r = await request(app).put(`${D}/field-rules`).set(auth(gm)).send({ fieldUiDefault: 'purple' });
    expect(r.status).toBe(400);
  });
});

describe('the generic settings route cannot bypass the rules cap + audit', () => {
  it('PUT /settings/fieldRules is refused even for an admin with the settings cap', async () => {
    const r = await request(app).put('/api/v1/settings/fieldRules').set(auth(gm)).send({ value: { fieldUiDefault: 'new' } });
    expect(r.status).toBe(403);
    const rules = (await request(app).get(`${D}/field-rules`).set(auth(gm))).body.data;
    expect(rules.fieldUiDefault).toBe('old');
  });
});
