'use strict';
// RECURRING SUBSCRIPTIONS (Part 3) — a recurring supplier cost defined once that AUTO-GENERATES a Bill
// (Accounts Payable) each cycle, so it is never forgotten. Firing reuses the AP engine: each due cycle
// creates a Bill and (if autoIssue) issues it, which posts the accrual through the double-entry engine.
// A SubscriptionRun per (subscription, cycle) makes runSubscriptions() idempotent — catching up any
// missed cycles up to a cut-off, never duplicating. Pause / resume / skip / cancel / edit supported.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const billSvc = require('./bill.service');

const CADENCE = { monthly: 1, quarterly: 3, yearly: 12 };
const n = (v) => Math.round(Number(v) || 0);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
// Add k months to a YYYY-MM-DD, clamping the day to the target month's length (e.g. Jan 31 +1 → Feb 28).
function addMonthsDate(date, k) {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + k, 1));
  const daysInMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, daysInMonth));
  return base.toISOString().slice(0, 10);
}
function addDays(date, k) { const dt = new Date(date + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + (k | 0)); return dt.toISOString().slice(0, 10); }
function advance(date, cadence, interval) { return addMonthsDate(date, (CADENCE[cadence] || 1) * Math.max(1, int(interval))); }

const todayISO = () => new Date().toISOString().slice(0, 10);
function subClient(s, today) {
  const t = today || todayISO();
  return { id: s.id, supplierId: s.supplierId, supplierName: s.supplier ? s.supplier.name : null, name: s.name, description: s.description || '',
    chartAccountId: s.chartAccountId, chartCode: s._code || null, amount: n(s.amount), tax: n(s.tax), total: n(s.amount) + n(s.tax),
    cadence: s.cadence, interval: s.interval, startDate: s.startDate, nextRunDate: s.nextRunDate, endDate: s.endDate || null,
    dueDays: s.dueDays, remindDays: s.remindDays != null ? s.remindDays : 3, autoIssue: !!s.autoIssue, status: s.status, businessUnitId: s.businessUnitId || null, fleetId: s.fleetId || '',
    // OVERDUE — an active subscription whose cycle date has passed with no bill yet generated (the job
    // hasn't run). Visually distinct on the list; paused/ended never flag.
    overdue: s.status === 'aktif' && s.nextRunDate < t,
    createdByName: s.createdByName || null, createdAt: s.createdAt ? new Date(s.createdAt).getTime() : null,
    runs: (s.runs || []).map((r) => ({ id: r.id, cycleDate: r.cycleDate, billId: r.billId || null, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null })) };
}
async function attachCode(s) { if (!s) return s; const a = await prisma.chartAccount.findUnique({ where: { id: s.chartAccountId }, select: { code: true } }); s._code = a ? a.code : null; return s; }

async function createSubscription(body, actor) {
  const supplier = await prisma.supplier.findUnique({ where: { id: String(body.supplierId || '') } });
  if (!supplier) throw ApiError.badRequest('Pemasok tidak ditemukan.');
  if (!CADENCE[body.cadence]) throw ApiError.badRequest("Frekuensi harus 'monthly', 'quarterly', atau 'yearly'.");
  if (!isDate(body.startDate)) throw ApiError.badRequest('Tanggal mulai tidak valid.');
  if (body.endDate && !isDate(body.endDate)) throw ApiError.badRequest('Tanggal akhir tidak valid.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Nominal harus lebih dari 0.');
  const acct = await prisma.chartAccount.findUnique({ where: { code: String(body.chartCode || '') } });
  if (!acct || acct.type !== 'expense') throw ApiError.badRequest('Pilih akun Beban yang valid.');
  const s = await prisma.subscription.create({ data: {
    supplierId: supplier.id, name: String(body.name || '').slice(0, 120) || supplier.name, description: String(body.description || '').slice(0, 300),
    chartAccountId: acct.id, amount: BigInt(amount), tax: BigInt(int(body.tax)), cadence: body.cadence, interval: Math.max(1, int(body.interval || 1)),
    startDate: body.startDate, nextRunDate: body.startDate, endDate: body.endDate || null, dueDays: int(body.dueDays), remindDays: body.remindDays != null ? int(body.remindDays) : 3, autoIssue: body.autoIssue !== false,
    businessUnitId: body.businessUnitId || null, fleetId: String(body.fleetId || ''), createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null,
  }, include: { supplier: { select: { name: true } } } });
  return subClient(await attachCode(s));
}

async function updateSubscription(id, body, actor) {
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Langganan tidak ditemukan.');
  if (s.status === 'batal' || s.status === 'selesai') throw ApiError.badRequest('Langganan ini sudah berakhir — tidak bisa diubah.');
  const data = {};
  if (body.name != null) data.name = String(body.name).slice(0, 120);
  if (body.description != null) data.description = String(body.description).slice(0, 300);
  if (body.amount != null) { const a = int(body.amount); if (a <= 0) throw ApiError.badRequest('Nominal harus lebih dari 0.'); data.amount = BigInt(a); }
  if (body.tax != null) data.tax = BigInt(int(body.tax));
  if (body.cadence != null) { if (!CADENCE[body.cadence]) throw ApiError.badRequest('Frekuensi tidak valid.'); data.cadence = body.cadence; }
  if (body.interval != null) data.interval = Math.max(1, int(body.interval));
  if (body.dueDays != null) data.dueDays = int(body.dueDays);
  if (body.remindDays != null) data.remindDays = int(body.remindDays);
  if (body.autoIssue != null) data.autoIssue = !!body.autoIssue;
  if (body.endDate !== undefined) { if (body.endDate && !isDate(body.endDate)) throw ApiError.badRequest('Tanggal akhir tidak valid.'); data.endDate = body.endDate || null; }
  if (body.nextRunDate != null) { if (!isDate(body.nextRunDate)) throw ApiError.badRequest('Tanggal berikutnya tidak valid.'); data.nextRunDate = body.nextRunDate; }   // reschedule future runs
  if (body.chartCode != null) { const acct = await prisma.chartAccount.findUnique({ where: { code: String(body.chartCode) } }); if (!acct || acct.type !== 'expense') throw ApiError.badRequest('Pilih akun Beban yang valid.'); data.chartAccountId = acct.id; }
  const upd = await prisma.subscription.update({ where: { id }, data, include: { supplier: { select: { name: true } } } });
  return subClient(await attachCode(upd));
}

async function setStatus(id, status) {
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Langganan tidak ditemukan.');
  if (s.status === 'batal') throw ApiError.badRequest('Langganan ini sudah dibatalkan.');
  const upd = await prisma.subscription.update({ where: { id }, data: { status }, include: { supplier: { select: { name: true } } } });
  return subClient(await attachCode(upd));
}
const pauseSubscription = (id) => setStatus(id, 'jeda');
const resumeSubscription = (id) => setStatus(id, 'aktif');
const cancelSubscription = (id) => setStatus(id, 'batal');

// Skip the next cycle WITHOUT generating a bill — record it (billId null) and advance the cursor.
async function skipCycle(id) {
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Langganan tidak ditemukan.');
  if (s.status !== 'aktif' && s.status !== 'jeda') throw ApiError.badRequest('Langganan tidak aktif.');
  const next = advance(s.nextRunDate, s.cadence, s.interval);
  await prisma.$transaction(async (tx) => {
    await tx.subscriptionRun.upsert({ where: { subscriptionId_cycleDate: { subscriptionId: id, cycleDate: s.nextRunDate } }, update: {}, create: { subscriptionId: id, cycleDate: s.nextRunDate, billId: null } });
    await tx.subscription.update({ where: { id }, data: { nextRunDate: next, ...(s.endDate && next > s.endDate ? { status: 'selesai' } : {}) } });
  });
  return getSubscription(id);
}

// Generate every due cycle up to `asOf` (inclusive) for all ACTIVE subscriptions — catching up any
// missed cycles. Idempotent: a SubscriptionRun per cycle (unique) means a re-run generates nothing new.
async function runSubscriptions({ asOf } = {}, actor) {
  const today = isDate(asOf) ? asOf : new Date().toISOString().slice(0, 10);
  const subs = await prisma.subscription.findMany({ where: { status: 'aktif', nextRunDate: { lte: today } } });
  let generated = 0, skipped = 0; const bills = [];
  for (const s of subs) {
    const acct = await prisma.chartAccount.findUnique({ where: { id: s.chartAccountId }, select: { code: true } });
    if (!acct) continue;
    let next = s.nextRunDate;
    while (next <= today && (!s.endDate || next <= s.endDate)) {
      // one run per cycle — the unique index makes this the idempotency guard
      let run = null;
      try { run = await prisma.subscriptionRun.create({ data: { subscriptionId: s.id, cycleDate: next } }); }
      catch (e) { skipped++; run = null; }   // P2002 → this cycle was already generated
      if (run) {
        const bill = await billSvc.createBill({ supplierId: s.supplierId, billNumber: '', billDate: next, dueDate: s.dueDays ? addDays(next, s.dueDays) : next, description: s.name, tax: n(s.tax), businessUnitId: s.businessUnitId, lines: [{ chartCode: acct.code, description: s.description || s.name, qty: 1, unitPrice: n(s.amount), fleetId: s.fleetId }] }, actor);
        if (s.autoIssue) await billSvc.issueBill(bill.id, actor);
        await prisma.subscriptionRun.update({ where: { id: run.id }, data: { billId: bill.id } });
        generated++; bills.push({ subscriptionId: s.id, cycleDate: next, billId: bill.id });
      }
      next = advance(next, s.cadence, s.interval);
    }
    const done = s.endDate && next > s.endDate;
    await prisma.subscription.update({ where: { id: s.id }, data: { nextRunDate: next, ...(done ? { status: 'selesai' } : {}) } });
  }
  return { generated, skipped, bills, asOf: today };
}

async function listSubscriptions(query) {
  const q = query || {};
  const where = {};
  if (q.status && ['aktif', 'jeda', 'selesai', 'batal'].includes(q.status)) where.status = q.status;
  if (q.supplierId) where.supplierId = String(q.supplierId);
  const rows = await prisma.subscription.findMany({ where, orderBy: [{ status: 'asc' }, { nextRunDate: 'asc' }], take: 500, include: { supplier: { select: { name: true } } } });
  const accts = await prisma.chartAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.chartAccountId))] } }, select: { id: true, code: true } });
  const code = {}; accts.forEach((a) => { code[a.id] = a.code; });
  rows.forEach((r) => { r._code = code[r.chartAccountId]; });
  // "jatuh berikutnya minggu ini" convenience: how many are due within 7 days
  const soon = new Date(); soon.setDate(soon.getDate() + 7); const soonStr = soon.toISOString().slice(0, 10);
  const dueSoon = rows.filter((r) => r.status === 'aktif' && r.nextRunDate <= soonStr).length;
  const today = todayISO();   // pass explicitly — map's 2nd arg is the index, which would corrupt `overdue`
  return { data: rows.map((r) => subClient(r, today)), summary: { active: rows.filter((r) => r.status === 'aktif').length, dueSoon } };
}
async function getSubscription(id) {
  const s = await prisma.subscription.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, runs: { orderBy: { cycleDate: 'desc' }, take: 60 } } });
  if (!s) throw ApiError.notFound('Langganan tidak ditemukan.');
  return subClient(await attachCode(s));
}

// Subscriptions falling due within `days` (default 7) — the dashboard "Langganan jatuh tempo" card.
// ACTIVE only (paused/ended/cancelled never appear). `overdue` = the cycle date already passed.
async function subscriptionsDue({ asOf, days = 7 } = {}) {
  const today = isDate(asOf) ? asOf : todayISO();
  const until = addDays(today, Math.max(0, int(days)));
  const rows = await prisma.subscription.findMany({ where: { status: 'aktif', nextRunDate: { lte: until } }, orderBy: { nextRunDate: 'asc' }, include: { supplier: { select: { name: true } } } });
  let total = 0;
  const out = rows.map((s) => { total += n(s.amount) + n(s.tax); return { id: s.id, name: s.name, supplierName: s.supplier ? s.supplier.name : '', nextRunDate: s.nextRunDate, total: n(s.amount) + n(s.tax), overdue: s.nextRunDate < today }; });
  return { asOf: today, until, count: out.length, total, rows: out };
}
// AlertBell reminder count — ACTIVE subs whose next cycle is within their OWN remindDays lead time.
// Returns count + total; paused/ended never remind. Folded into accountingStatus so the bell reuses one poll.
async function subscriptionReminderCount({ asOf } = {}) {
  const today = isDate(asOf) ? asOf : todayISO();
  const subs = await prisma.subscription.findMany({ where: { status: 'aktif' }, select: { nextRunDate: true, remindDays: true, amount: true, tax: true } });
  let count = 0, total = 0;
  for (const s of subs) { const threshold = addDays(today, s.remindDays != null ? s.remindDays : 3); if (s.nextRunDate <= threshold) { count++; total += n(s.amount) + n(s.tax); } }
  return { count, total };
}

module.exports = { createSubscription, updateSubscription, pauseSubscription, resumeSubscription, cancelSubscription, skipCycle, runSubscriptions, listSubscriptions, getSubscription, subscriptionsDue, subscriptionReminderCount };
