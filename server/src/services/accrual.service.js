'use strict';
// ACCRUAL MECHANICS on the double-entry engine (gated on ACCOUNTING_V2):
//   • PREPAID (Beban Dibayar Di Muka, 1-1600): a bill line covering a future period is CAPITALISED to
//     the prepaid asset on issue, then AMORTISED monthly into its expense account (Dr expense · Cr
//     1-1600) by postAmortization() — a month-end job that catches every due month idempotently.
//   • ACCRUED (Beban Yang Masih Harus Dibayar, 2-4000): recognise an expense before the bill arrives
//     using REVERSING ENTRIES — book it this period (Dr expense · Cr 2-4000) and AUTO-REVERSE it on the
//     next period's start (Dr 2-4000 · Cr expense), so when the real bill lands next period it counts
//     once, not twice. (The request cut off at "reverse"; this is the standard reversing-entry method.)
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const acc = require('./accounting.service');

const PREPAID = '1-1600', ACCRUED = '2-4000';
const n = (v) => Math.round(Number(v) || 0);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const ym = (d) => String(d || '').slice(0, 7);
const firstOf = (yearMonth) => yearMonth + '-01';
const addMonths = (yearMonth, k) => { let [y, m] = yearMonth.split('-').map(Number); m += (k | 0); y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return `${y}-${String(m).padStart(2, '0')}`; };
const nextMonthStart = (date) => firstOf(addMonths(ym(date), 1));
async function codeOf(id, db = prisma) { return db.chartAccount.findUnique({ where: { id }, select: { code: true, type: true } }); }

// ── ACCRUED EXPENSE ──────────────────────────────────────────────────────────────
function accrualClient(a, code) {
  return { id: a.id, chartAccountId: a.chartAccountId, chartCode: code || null, amount: n(a.amount), date: a.date, reverseDate: a.reverseDate,
    description: a.description || '', status: a.status, businessUnitId: a.businessUnitId || null, fleetId: a.fleetId || '',
    createdByName: a.createdByName || null, createdAt: a.createdAt ? new Date(a.createdAt).getTime() : null };
}
async function createAccrual(body, actor) {
  if (!isDate(body.date)) throw ApiError.badRequest('Tanggal tidak valid.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Jumlah harus lebih dari 0.');
  const acct = await prisma.chartAccount.findUnique({ where: { code: String(body.chartCode || '') } });
  if (!acct || acct.type !== 'expense') throw ApiError.badRequest('Pilih akun Beban yang valid.');
  const reverseDate = isDate(body.reverseDate) ? body.reverseDate : nextMonthStart(body.date);
  if (reverseDate <= body.date) throw ApiError.badRequest('Tanggal balik harus setelah tanggal akrual.');
  const fleetId = String(body.fleetId || '');
  const out = await prisma.$transaction(async (tx) => {
    const row = await tx.accrual.create({ data: { chartAccountId: acct.id, amount: BigInt(amount), date: body.date, reverseDate, description: String(body.description || '').slice(0, 300), businessUnitId: body.businessUnitId || null, fleetId, createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null } });
    if (config.accountingV2) {
      await acc.postJournal({ sourceType: 'accrual', sourceId: row.id, date: body.date, description: `Akrual: ${row.description}`, actor, businessUnitId: row.businessUnitId, lines: [{ code: acct.code, debit: amount, fleetId }, { code: ACCRUED, credit: amount, fleetId }] }, tx);
      await acc.postJournal({ sourceType: 'accrual_reversal', sourceId: row.id, date: reverseDate, description: `Balik akrual: ${row.description}`, actor, businessUnitId: row.businessUnitId, lines: [{ code: ACCRUED, debit: amount, fleetId }, { code: acct.code, credit: amount, fleetId }] }, tx);
    }
    return row;
  });
  return accrualClient(out, acct.code);
}
async function voidAccrual(id, body, actor) {
  const a = await prisma.accrual.findUnique({ where: { id } });
  if (!a) throw ApiError.notFound('Akrual tidak ditemukan.');
  if (a.status === 'batal') throw ApiError.badRequest('Akrual ini sudah dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan pembatalan wajib diisi.');
  await prisma.$transaction(async (tx) => {
    await tx.accrual.update({ where: { id }, data: { status: 'batal' } });
    if (config.accountingV2) {
      // Reverse BOTH legs (the accrual and its auto-reversal) so the net effect returns to zero.
      await acc.reverseJournal({ sourceType: 'accrual', sourceId: id, reversalSourceType: 'accrual_void', reversalSourceId: id, date: a.date, description: `Batal akrual: ${reason}`, actor }, tx);
      await acc.reverseJournal({ sourceType: 'accrual_reversal', sourceId: id, reversalSourceType: 'accrual_rev_void', reversalSourceId: id, date: a.reverseDate, description: `Batal balik akrual: ${reason}`, actor }, tx);
    }
  });
  return { voided: true, id, status: 'batal' };
}
async function listAccruals(query) {
  const q = query || {};
  const where = {};
  if (q.status === 'aktif' || q.status === 'batal') where.status = q.status;
  if (q.dateFrom || q.dateTo) { where.date = {}; if (q.dateFrom) where.date.gte = q.dateFrom; if (q.dateTo) where.date.lte = q.dateTo; }
  const rows = await prisma.accrual.findMany({ where, orderBy: [{ date: 'desc' }], take: 500 });
  const accts = await prisma.chartAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.chartAccountId))] } }, select: { id: true, code: true } });
  const code = {}; accts.forEach((a) => { code[a.id] = a.code; });
  return { data: rows.map((r) => accrualClient(r, code[r.chartAccountId])) };
}

// ── PREPAID AMORTISATION ─────────────────────────────────────────────────────────
// Create a schedule (called from bill.service for a prepaid line, or the manual endpoint). `db` lets
// it join the caller's transaction. `monthlyAmount` is floored; the LAST month posts the remainder.
async function createSchedule({ sourceType, sourceId, chartAccountId, prepaidCode, startDate, months, total, description, businessUnitId, fleetId }, db = prisma) {
  const m = Math.max(1, int(months));
  const tot = int(total);
  return db.amortizationSchedule.create({ data: {
    sourceType: sourceType || 'manual', sourceId: String(sourceId || ''), chartAccountId, prepaidCode: prepaidCode || PREPAID,
    startDate, months: m, monthlyAmount: BigInt(Math.floor(tot / m)), total: BigInt(tot),
    description: String(description || '').slice(0, 300), businessUnitId: businessUnitId || null, fleetId: fleetId || '',
  } });
}
// Manual schedule from a standalone prepaid (capitalise now: Dr 1-1600 · Cr Kas/Bank or a source).
async function createManualSchedule(body, actor) {
  if (!isDate(body.startDate)) throw ApiError.badRequest('Tanggal mulai tidak valid.');
  const total = int(body.total);
  if (total <= 0) throw ApiError.badRequest('Total harus lebih dari 0.');
  const acct = await prisma.chartAccount.findUnique({ where: { code: String(body.chartCode || '') } });
  if (!acct || acct.type !== 'expense') throw ApiError.badRequest('Pilih akun Beban yang valid.');
  const months = Math.max(1, int(body.months));
  const s = await createSchedule({ sourceType: 'manual', sourceId: '', chartAccountId: acct.id, startDate: body.startDate, months, total, description: body.description, businessUnitId: body.businessUnitId, fleetId: body.fleetId });
  return scheduleClient(s, acct.code);
}
function scheduleClient(s, code) {
  const posted = s.postedThrough ? (monthsBetween(ym(s.startDate), s.postedThrough) + 1) : 0;
  return { id: s.id, sourceType: s.sourceType, sourceId: s.sourceId, chartAccountId: s.chartAccountId, chartCode: code || null, prepaidCode: s.prepaidCode,
    startDate: s.startDate, months: s.months, monthlyAmount: n(s.monthlyAmount), total: n(s.total), postedThrough: s.postedThrough || null,
    postedMonths: Math.min(posted, s.months), remaining: Math.max(0, s.months - Math.min(posted, s.months)), description: s.description || '', businessUnitId: s.businessUnitId || null };
}
function monthsBetween(a, b) { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); }

// Post every amortisation month due through `asOf` (inclusive), idempotently. sourceId `${id}:${YYYY-MM}`
// + postedThrough both guard against double-posting, so this is safe to run daily / on close.
async function postAmortization({ asOf } = {}, actor) {
  const cutoff = ym(asOf || new Date().toISOString().slice(0, 10));
  const schedules = await prisma.amortizationSchedule.findMany();
  let posted = 0;
  for (const s of schedules) {
    const startYM = ym(s.startDate);
    const acct = await codeOf(s.chartAccountId);
    if (!acct) continue;
    for (let i = 0; i < s.months; i++) {
      const mKey = addMonths(startYM, i);
      if (mKey > cutoff) break;
      if (s.postedThrough && mKey <= s.postedThrough) continue;
      const isLast = i === s.months - 1;
      const amt = isLast ? (n(s.total) - n(s.monthlyAmount) * (s.months - 1)) : n(s.monthlyAmount);
      if (amt > 0) {
        await prisma.$transaction(async (tx) => {
          if (config.accountingV2) await acc.postJournal({ sourceType: 'amortization', sourceId: `${s.id}:${mKey}`, date: firstOf(mKey), description: `Amortisasi: ${s.description}`, actor, businessUnitId: s.businessUnitId, lines: [{ code: acct.code, debit: amt, fleetId: s.fleetId || '' }, { code: s.prepaidCode, credit: amt, fleetId: s.fleetId || '' }] }, tx);
          await tx.amortizationSchedule.update({ where: { id: s.id }, data: { postedThrough: mKey } });
        });
        posted++;
      } else { await prisma.amortizationSchedule.update({ where: { id: s.id }, data: { postedThrough: mKey } }); }
    }
  }
  return { posted, asOf: cutoff };
}
async function listSchedules(query) {
  const q = query || {};
  const rows = await prisma.amortizationSchedule.findMany({ orderBy: [{ createdAt: 'desc' }], take: 500 });
  const accts = await prisma.chartAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.chartAccountId))] } }, select: { id: true, code: true } });
  const code = {}; accts.forEach((a) => { code[a.id] = a.code; });
  let active = rows.map((r) => scheduleClient(r, code[r.chartAccountId]));
  if (q.active === 'true') active = active.filter((r) => r.remaining > 0);
  return { data: active };
}

module.exports = { createAccrual, voidAccrual, listAccruals, createSchedule, createManualSchedule, postAmortization, listSchedules, scheduleClient, PREPAID, ACCRUED };
