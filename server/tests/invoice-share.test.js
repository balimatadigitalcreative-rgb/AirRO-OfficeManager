'use strict';
// PART B — send invoice via WhatsApp: shared phone helper (E.164), signed/expiring/revocable public
// link page (no auth, noindex, strips internal metadata), and the dispatch log ("Dikirim (dibuka di
// WhatsApp)"). The public page renders ONE invoice only; expired/revoked/unknown → friendly 404 page.
const request = require('supertest');
const createApp = require('../src/app');
const { resetDb, prisma } = require('./helpers');
const share = require('../src/services/invoiceShare.service');
const { toE164, isValidPhone } = require('../src/lib/phone');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const reg = (c) => request(app).post('/api/v1/auth/register').send(c).then((r) => r.body);

let gm, gmUser, cust, invoice;

beforeAll(async () => {
  await resetDb();
  const g = await reg({ name: 'Boss', username: 'gm_wa', password: 'secret123', role: 'gm' });
  gm = g.token; gmUser = g.user;
  cust = (await request(app).post('/api/v1/distribusi/customers').set(auth(gm)).send({ name: 'BU RIRIS', code: 'C-0243', type: 'reguler', masterPrice: 13000, phone: '081211223344' })).body.data;
  // one bon sale, then an invoice covering it
  await prisma.distTransaction.create({ data: { id: 'twa0', customerId: cust.id, fleetId: 'Merah', qty: 5, unitPriceLocked: BigInt(13000), amount: BigInt(65000), method: 'bon', txnDate: new Date().toISOString().slice(0, 10), status: 'active', bonCounted: true, actorName: 'S' } });
  invoice = (await request(app).post('/api/v1/distribusi/customers/' + cust.id + '/invoices').set(auth(gm)).send({ scope: 'selected', transactionIds: ['twa0'] })).body.data;
});
afterAll(() => prisma.$disconnect());

describe('phone → E.164', () => {
  it('081… → 6281…', () => expect(toE164('081211223344')).toBe('6281211223344'));
  it('strips +, spaces, dashes', () => expect(toE164('+62 812-1122-3344')).toBe('6281211223344'));
  it('bare 8… assumes Indonesia', () => expect(toE164('81211223344')).toBe('6281211223344'));
  it('rejects too short / empty', () => { expect(toE164('123')).toBeNull(); expect(toE164('')).toBeNull(); expect(isValidPhone('')).toBe(false); });
});

describe('signed public link', () => {
  let link;
  it('creates a link with token, url and 30-day expiry', async () => {
    link = await share.createLink(invoice.id, gmUser, { protocol: 'https', get: () => 'airro.test' });
    expect(link.token).toMatch(/^[a-f0-9]{48}$/);
    expect(link.url).toBe('https://airro.test/api/v1/inv/' + link.token);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 20 * 24 * 3600 * 1000);
  });
  it('reuses the still-valid link instead of minting a new one', async () => {
    const again = await share.createLink(invoice.id, gmUser, { protocol: 'https', get: () => 'airro.test' });
    expect(again.token).toBe(link.token);
  });
  it('publicView returns ONLY this invoice, no internal metadata', async () => {
    const v = await share.publicView(link.token);
    expect(v.status).toBe('ok');
    expect(v.invoice.number).toBe(invoice.number);
    expect(v.invoice.customer.name).toBe('BU RIRIS');
    // stripped internals: no creator/role/customerId leak
    expect(v.invoice.createdByName).toBeUndefined();
    expect(v.invoice.customer.id).toBeUndefined();
  });
  it('GET /api/v1/inv/:token serves noindex HTML (no auth)', async () => {
    const r = await request(app).get('/api/v1/inv/' + link.token);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(r.text).toContain(invoice.number);
    expect(r.text).toContain('BU RIRIS');
  });
  it('unknown token → 404 friendly page', async () => {
    const r = await request(app).get('/api/v1/inv/deadbeef');
    expect(r.status).toBe(404);
    expect(r.text).toMatch(/tidak berlaku|tidak ditemukan/i);
  });
  it('revoke → "tautan tidak berlaku"', async () => {
    await share.revokeLinks(invoice.id, gmUser);
    const v = await share.publicView(link.token);
    expect(v.status).toBe('revoked');
    const r = await request(app).get('/api/v1/inv/' + link.token);
    expect(r.status).toBe(404);
    expect(r.text).toMatch(/dicabut|tidak berlaku/i);
  });
  it('expired link likewise fails', async () => {
    const fresh = await share.createLink(invoice.id, gmUser, { protocol: 'https', get: () => 'airro.test' });
    await prisma.invoiceLink.update({ where: { token: fresh.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const v = await share.publicView(fresh.token);
    expect(v.status).toBe('expired');
  });
});

describe('dispatch log', () => {
  it('records sender + normalised phone; rejects invalid number', async () => {
    const d = await share.logDispatch({ invoiceId: invoice.id, phone: '081211223344', channel: 'wa', messageSnapshot: 'Halo BU RIRIS' }, gmUser);
    expect(d.phone).toBe('6281211223344');
    expect(d.sentByName).toBe('Boss');
    await expect(share.logDispatch({ invoiceId: invoice.id, phone: '12' }, gmUser)).rejects.toThrow(/tidak valid/i);
  });
  it('listDispatches returns history for the invoice with sender + time', async () => {
    const list = await share.listDispatches({ invoiceId: invoice.id });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].sentByName).toBe('Boss');
    expect(typeof list[0].sentAt).toBe('number');
  });
  it('HTTP dispatch endpoint logs a send and history is readable', async () => {
    const post = await request(app).post('/api/v1/distribusi/invoices/dispatch').set(auth(gm)).send({ invoiceId: invoice.id, phone: '081211223344', channel: 'wa', messageSnapshot: 'Pengingat' });
    expect(post.status).toBe(201);
    const get = await request(app).get('/api/v1/distribusi/invoices/dispatches?invoiceId=' + invoice.id).set(auth(gm));
    expect(get.status).toBe(200);
    expect(get.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
