'use strict';
// SETORAN (Mode Lapangan 3C): the day summary says when the day was already closed, and closing again
// keeps the earlier note unless a new one is written.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const { todayISO } = require('../src/lib/time');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const D = '/api/v1/distribusi';
const today = todayISO();
let gm;
const sum = async () => (await request(app).get(`${D}/deliveries/day-summary?date=${today}&fleet=DK%201`).set(auth(gm))).body.data;
const close = (generalNote) => request(app).post(`${D}/deliveries/close`).set(auth(gm)).send({ date: today, fleet: 'DK 1', reasons: {}, generalNote });

beforeAll(async () => {
  await resetDb();
  gm = (await request(app).post('/api/v1/auth/register').send({ name: 'Boss', username: 'dc_gm', password: 'secret123', role: 'gm' })).body.token;
});
afterAll(() => prisma.$disconnect());

it('not closed yet → closeout null; closed → when, who, the note', async () => {
  expect((await sum()).closeout).toBeNull();
  expect((await close('setor lengkap')).status).toBe(201);
  expect((await sum()).closeout).toMatchObject({ closedByName: 'Boss', generalNote: 'setor lengkap' });
});
it('closing again with no note keeps the earlier note; a new note replaces it', async () => {
  await close('');
  expect((await sum()).closeout.generalNote).toBe('setor lengkap');
  await close('kurang 1 galon');
  expect((await sum()).closeout.generalNote).toBe('kurang 1 galon');
});
