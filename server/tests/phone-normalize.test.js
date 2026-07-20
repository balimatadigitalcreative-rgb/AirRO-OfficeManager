'use strict';
// Indonesian phone auto-correct: whatever comes in (typed, pasted, imported) is stored as "08…".
// The server is authoritative — the client mirror is only for preview.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { normalizePhone } = require('../src/utils/phone');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm;
beforeAll(async () => {
  await resetDb();
  gm = (await reg({ name: 'GM', username: 'ph_gm', password: 'secret123', role: 'gm' })).token;
});
afterAll(() => prisma.$disconnect());

describe('normalizePhone()', () => {
  it('applies the Indonesian rules', () => {
    expect(normalizePhone('81211223344')).toBe('081211223344');    // Excel dropped the 0
    expect(normalizePhone('+62 812-1122-3344')).toBe('081211223344');
    expect(normalizePhone('6281211223344')).toBe('081211223344');
    expect(normalizePhone('081211223344')).toBe('081211223344');   // already fine
    expect(normalizePhone('0361123456')).toBe('0361123456');       // landline kept
    expect(normalizePhone('123456')).toBe('123456');               // short/other kept
    expect(normalizePhone('')).toBe('');                           // optional
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone('  ')).toBe('');
  });
});

describe('customer writes always store the corrected number', () => {
  it('create: an Excel-mangled number is repaired', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
      .send({ name: 'Bu Sari', phone: '81211223344', masterPrice: 6000 });
    expect(r.status).toBe(201);
    expect(r.body.data.phone).toBe('081211223344');
  });

  it('create: a pasted +62 number is repaired', async () => {
    const r = await request(app).post('/api/v1/distribusi/customers').set(auth(gm))
      .send({ name: 'Pak Budi', phone: '+62 812-9988-7766', masterPrice: 6000 });
    expect(r.body.data.phone).toBe('081299887766');
  });

  it('update: editing to a stripped number repairs it too', async () => {
    const c = await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Edit Me', phone: '', masterPrice: 6000 });
    const up = await request(app).patch(`/api/v1/distribusi/customers/${c.body.data.id}`).set(auth(gm)).send({ phone: '8551234567' });
    expect(up.body.data.phone).toBe('08551234567');
  });
});

describe('import', () => {
  it('stores the corrected number and dedups across 0-prefixed / stripped forms', async () => {
    // "Toko Air" already exists with the 0-prefixed form
    await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'Toko Air', phone: '081277665544', masterPrice: 7000 });
    const r = await request(app).post('/api/v1/distribusi/customers/import').set(auth(gm)).send({
      customers: [
        { name: 'Toko Air', phone: '81277665544', masterPrice: 7000 },   // SAME person, Excel-mangled → skipped
        { name: 'Warung Baru', phone: '81233221100', masterPrice: 7000 }, // new → stored as 08…
      ],
      skipped: 0,
    });
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(1);
    expect(r.body.skipped).toBe(1);            // the mangled duplicate was caught
    const baru = await prisma.customer.findFirst({ where: { name: 'Warung Baru' } });
    expect(baru.phone).toBe('081233221100');   // repaired on the way in
    expect(await prisma.customer.count({ where: { name: 'Toko Air' } })).toBe(1);
  });
});
