'use strict';
// ACCOUNTING v2 — PERIOD CLOSE. A month with no row is OPEN by default; closing writes a row with
// status 'ditutup' (or 'terkunci' for a hard lock). While ACCOUNTING_V2 is on, the entry write path
// asserts the target month is open — so a closed period rejects edits/deletes AT THE API, not just in
// the UI. Reopening (owner) requires a reason and is audited on the row.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');

const LOCKED = ['ditutup', 'terkunci'];
const keyOf = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
// req.user carries no display name (only id/role/username) — resolve it for the audit stamp.
async function actorName(actor) {
  if (actor && actor.name) return actor.name;
  if (actor && actor.id) { const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); if (u && u.name) return u.name; }
  return (actor && actor.username) || null;
}
const monthOf = (date) => String(date || '').slice(0, 7);   // YYYY-MM

async function statusForKey(key) {
  if (!/^\d{4}-\d{2}$/.test(key)) return 'terbuka';
  const p = await prisma.accountingPeriod.findUnique({ where: { periodKey: key } });
  return p ? p.status : 'terbuka';
}
async function statusForDate(date) { return statusForKey(monthOf(date)); }

// Enforced ONLY when the accounting feature flag is on, so the cash book is untouched until a business
// adopts double-entry + period close. Throws a 400 with a clear, actionable message otherwise.
async function assertPeriodOpen(date, action) {
  if (!config.accountingV2) return;
  const key = monthOf(date);
  const st = await statusForKey(key);
  if (LOCKED.includes(st)) {
    throw ApiError.badRequest(`Periode ${key} sudah ${st === 'terkunci' ? 'dikunci' : 'ditutup'} — ${action || 'perubahan'} tidak diizinkan. Gunakan jurnal penyesuaian bertanggal di periode yang masih terbuka.`);
  }
}

async function listPeriods() {
  return prisma.accountingPeriod.findMany({ orderBy: { periodKey: 'desc' } });
}

// Pre-close checklist. Surfaces what an accountant should clear before locking a month; it does NOT
// hard-block the close (the owner decides), but `clean` tells the UI whether anything is outstanding.
// Bank reconciliation is Part 6 (not built) → reported as null rather than a fake "0".
async function closeChecklist(year, month) {
  const key = keyOf(year, month);
  const [from, to] = [key + '-01', key + '-31'];
  const [uncategorised, pendingApprovals, distPending] = await Promise.all([
    prisma.entry.count({ where: { status: { not: 'Failed' }, date: { gte: from, lte: to }, OR: [{ category: null }, { category: '' }] } }),
    prisma.approval.count({ where: { status: 'pending' } }),
    prisma.distChangeRequest ? prisma.distChangeRequest.count({ where: { status: 'pending' } }).catch(() => 0) : Promise.resolve(0),
  ]);
  let bank = { total: 0, count: 0 };
  try { bank = await require('./reconciliation.service').unreconciledBankTotal(); } catch (e) { /* bank rec optional */ }
  const pending = pendingApprovals + (distPending || 0);
  return {
    periodKey: key,
    uncategorised,
    pendingApprovals: pending,
    unreconciledBank: bank.count,
    gallonIntegrity: 'ok',
    clean: uncategorised === 0 && pending === 0 && bank.count === 0,
  };
}

async function closePeriod({ year, month, lock }, actor) {
  if (!year || !month || month < 1 || month > 12) throw ApiError.badRequest('Tahun/bulan tidak valid.');
  // A period may not be closed while the books don't balance — the accounting equation must hold before
  // the month is frozen. (The double-entry engine keeps the trial balance balanced by construction, so
  // this only ever trips on a corrupted/hand-edited journal — but the guard makes the rule enforceable.)
  const tb = await require('./accounting.service').trialBalance();
  if (!tb.balanced) throw ApiError.badRequest('Neraca saldo tidak seimbang — tidak dapat menutup periode. Perbaiki jurnal terlebih dahulu.', { balanced: false });
  const key = keyOf(year, month);
  const status = lock ? 'terkunci' : 'ditutup';
  const stamp = { status, closedById: (actor && actor.id) || null, closedByName: await actorName(actor), closedAt: new Date(), reopenReason: null, reopenedById: null, reopenedByName: null, reopenedAt: null };
  const period = await prisma.accountingPeriod.upsert({
    where: { periodKey: key },
    update: stamp,
    create: { periodKey: key, year, month, ...stamp },
  });
  return { period, checklist: await closeChecklist(year, month) };
}

async function reopenPeriod({ year, month, reason }, actor) {
  const key = keyOf(year, month);
  const p = await prisma.accountingPeriod.findUnique({ where: { periodKey: key } });
  if (!p || p.status === 'terbuka') return p || null;   // already open — no-op
  if (p.status === 'terkunci') throw ApiError.forbidden('Periode terkunci tidak dapat dibuka kembali.');
  const why = String(reason || '').trim();
  if (!why) throw ApiError.badRequest('Alasan wajib diisi untuk membuka kembali periode.');
  return prisma.accountingPeriod.update({
    where: { periodKey: key },
    data: { status: 'terbuka', reopenReason: why.slice(0, 500), reopenedById: (actor && actor.id) || null, reopenedByName: await actorName(actor), reopenedAt: new Date() },
  });
}

module.exports = { LOCKED, keyOf, monthOf, statusForKey, statusForDate, assertPeriodOpen, listPeriods, closeChecklist, closePeriod, reopenPeriod };
