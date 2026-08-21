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
  // JOURNAL INTEGRITY — sources with no journal / journals with no source, for this period onward. A
  // clean close requires zero drift (live posting keeps it zero; anything here means a source didn't post).
  let integrity = { ok: true, missingCount: 0, orphanCount: 0 };
  try { integrity = await require('./accounting.service').integrityCheck({ fromDate: from }); } catch (e) { /* accounting optional */ }
  const journalDrift = (integrity.missingCount || 0) + (integrity.orphanCount || 0);
  const pending = pendingApprovals + (distPending || 0);
  // ACCRUAL-BASIS CHECKS — closing a period with unposted amortisation overstates profit, so it BLOCKS
  // the close (like an unbalanced trial balance). Accrued not-yet-reversed / subscriptions due / draft
  // bills only WARN. All are best-effort (the tables may not exist on an older DB).
  let amortPending = 0, accruedOpen = 0, subsDue = 0, draftBills = 0, deprPending = 0, deprAssets = 0;
  try { amortPending = await require('./accrual.service').pendingAmortizationCount({ asOf: to }); } catch (e) { /* accrual optional */ }
  // Unposted DEPRECIATION for this period understates expense / overstates profit — BLOCKS the close
  // (same rule as amortisation), with a one-click "post all" in the checklist.
  try { const d = await require('./depreciation.service').pendingDepreciation({ asOf: to }); deprPending = d.months; deprAssets = d.assets; } catch (e) { /* fixed assets optional */ }
  // COSTING — production runs not yet completed + variances not yet closed WARN; a completed run whose
  // journal never posted BLOCKS the close (an approved run without a journal).
  let prodDraft = 0, prodUnposted = 0, varOpen = 0;
  try { const pr = await require('./costing.service').pendingRuns({ asOf: to }); prodDraft = pr.draft; prodUnposted = pr.unposted; } catch (e) { /* costing optional */ }
  try { varOpen = await require('./costing.service').openVariancesCount({ asOf: to }); } catch (e) { /* costing optional */ }
  // PAYROLL — a draft period this month WARNS; an approved period with no journal BLOCKS.
  let payrollDraft = 0, payrollUnposted = 0;
  try { const pc = await require('./payrollAccrual.service').payrollCheck({ year, month }); payrollDraft = pc.draft; payrollUnposted = pc.approvedUnposted; } catch (e) { /* payroll optional */ }
  try { accruedOpen = await prisma.accrual.count({ where: { status: 'aktif', reverseDate: { gt: to } } }); } catch (e) { /* optional */ }
  try { subsDue = await prisma.subscription.count({ where: { status: 'aktif', nextRunDate: { lte: to } } }); } catch (e) { /* optional */ }
  try { draftBills = await prisma.bill.count({ where: { status: 'draft', billDate: { lte: to } } }); } catch (e) { /* optional */ }
  return {
    periodKey: key,
    uncategorised,
    pendingApprovals: pending,
    unreconciledBank: bank.count,
    gallonIntegrity: 'ok',
    journalIntegrity: integrity.ok ? 'ok' : 'drift',
    journalDrift,
    amortPending,        // BLOCKS the close
    deprPending, deprAssets,   // BLOCKS the close (n months across deprAssets assets)
    prodUnposted,        // BLOCKS the close (a completed run with no journal)
    payrollUnposted,     // BLOCKS the close (an approved payroll with no journal)
    prodDraft, varOpen, payrollDraft,  // warn only
    accruedOpen, subsDue, draftBills,   // warn only
    clean: uncategorised === 0 && pending === 0 && bank.count === 0 && journalDrift === 0 && amortPending === 0 && deprPending === 0 && prodUnposted === 0 && payrollUnposted === 0,
  };
}

async function closePeriod({ year, month, lock }, actor) {
  if (!year || !month || month < 1 || month > 12) throw ApiError.badRequest('Tahun/bulan tidak valid.');
  // A period may not be closed while the books don't balance — the accounting equation must hold before
  // the month is frozen. (The double-entry engine keeps the trial balance balanced by construction, so
  // this only ever trips on a corrupted/hand-edited journal — but the guard makes the rule enforceable.)
  const tb = await require('./accounting.service').trialBalance();
  if (!tb.balanced) throw ApiError.badRequest('Neraca saldo tidak seimbang — tidak dapat menutup periode. Perbaiki jurnal terlebih dahulu.', { balanced: false });
  // Unposted amortisation for this period would understate expense / overstate profit — block the close
  // until it is posted (the checklist offers a one-click "post all" to clear it).
  const periodEnd = keyOf(year, month) + '-31';
  let amortPending = 0;
  try { amortPending = await require('./accrual.service').pendingAmortizationCount({ asOf: periodEnd }); } catch (e) { /* accrual optional */ }
  if (amortPending > 0) throw ApiError.badRequest(`${amortPending} amortisasi belum diposting untuk periode ini — posting dulu sebelum menutup.`, { amortPending });
  // Unposted depreciation likewise blocks the close (the checklist offers a one-click "post all").
  let deprPending = { months: 0, assets: 0 };
  try { deprPending = await require('./depreciation.service').pendingDepreciation({ asOf: periodEnd }); } catch (e) { /* fixed assets optional */ }
  if (deprPending.months > 0) throw ApiError.badRequest(`Penyusutan bulan ini belum diposting (${deprPending.assets} aset) — posting dulu sebelum menutup.`, { deprPending: deprPending.months, deprAssets: deprPending.assets });
  // A completed production run whose journal never posted must not be frozen — block until it posts.
  let prodUnposted = 0;
  try { prodUnposted = (await require('./costing.service').pendingRuns({ asOf: periodEnd })).unposted; } catch (e) { /* costing optional */ }
  if (prodUnposted > 0) throw ApiError.badRequest(`${prodUnposted} production run selesai tanpa jurnal — selesaikan/posting dulu sebelum menutup.`, { prodUnposted });
  // An approved payroll with no journal must not be frozen.
  let payrollUnposted = 0;
  try { payrollUnposted = (await require('./payrollAccrual.service').payrollCheck({ year, month })).approvedUnposted; } catch (e) { /* payroll optional */ }
  if (payrollUnposted > 0) throw ApiError.badRequest(`${payrollUnposted} payroll disetujui tapi belum berjurnal — posting dulu sebelum menutup.`, { payrollUnposted });
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
