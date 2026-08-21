'use strict';
// PAYROLL — ACCRUAL basis on the double-entry engine (ACCOUNTING_V2). Reuses Employee + Cashbon. A
// period is built as a DRAFT (one line/employee), edited while draft, then APPROVED (posts the accrual
// journal — Dr Beban Gaji/COGS · Cr Utang Gaji net · Cr Utang Potongan · Cr Piutang Karyawan for
// cashbon), then PAID (Dr Utang Gaji · Cr Kas/Bank). Production staff (isProduction) post to a COGS
// labour account so the standard-costing module picks them up. Standards/rates are the OWNER's
// estimates — NO fiscal rules hardcoded; PPh 21 etc. are configurable components with manual amounts.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const acc = require('./accounting.service');
const cashbon = require('./cashbon.service');
const { resolvePerms } = require('../config/permissions');

const BEBAN_GAJI = '6-1000', COGS_LABOUR = '5-1500', UTANG_GAJI = '2-2000', UTANG_POTONGAN = '2-2100', PIUTANG_KARYAWAN = '1-1250', KAS = '1-1000', BANK = '1-1100';
const n = (v) => Math.round(Number(v) || 0);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const keyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

// ── COMPONENTS (tunjangan / potongan) — configurable; PPh 21 is just a potongan with a manual amount.
function componentClient(c) { return { id: c.id, name: c.name, type: c.type, taxable: !!c.taxable, defaultAmount: n(c.defaultAmount), appliesTo: c.appliesTo, chartCode: c.chartCode || null, isActive: !!c.isActive, note: c.note || '' }; }
async function listComponents() { const rows = await prisma.payrollComponent.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] }); return { data: rows.map(componentClient) }; }
async function createComponent(body, actor) {
  const type = body.type === 'potongan' ? 'potongan' : 'tunjangan';
  const c = await prisma.payrollComponent.create({ data: { name: String(body.name || '').slice(0, 120) || 'Komponen', type, taxable: !!body.taxable, defaultAmount: BigInt(int(body.defaultAmount)), appliesTo: body.appliesTo === 'per_karyawan' ? 'per_karyawan' : 'semua', chartCode: body.chartCode || null, isActive: body.isActive !== false, note: String(body.note || '').slice(0, 200) } });
  return componentClient(c);
}
async function updateComponent(id, body) {
  const data = {};
  if (body.name != null) data.name = String(body.name).slice(0, 120);
  if (body.defaultAmount != null) data.defaultAmount = BigInt(int(body.defaultAmount));
  if (body.isActive != null) data.isActive = !!body.isActive;
  if (body.note != null) data.note = String(body.note).slice(0, 200);
  const c = await prisma.payrollComponent.update({ where: { id }, data });
  return componentClient(c);
}

// Employee's built-in structured allowances (the tj* columns + the legacy catch-all).
function employeeAllowances(e) { return n(e.tjKinerja) + n(e.tjProfesi) + n(e.tjRumahDinas) + n(e.tjBpjsKes) + n(e.tjBpjsTk) + n(e.allowance); }
function lineNet(l) { return n(l.basicSalary) + n(l.overtime) + n(l.bonus) + n(l.allowancesTotal) - n(l.deductionsTotal) - n(l.cashbonDeduction); }

// ── BUILD a draft period: one line per active employee, allowances/deductions from the employee record
// + active components. isProduction defaults from the employee (settable per line while draft).
async function createPeriod(body, actor) {
  const year = int(body.year), month = int(body.month);
  if (!year || month < 1 || month > 12) throw ApiError.badRequest('Tahun/bulan tidak valid.');
  const existing = await prisma.payrollPeriod.findFirst({ where: { year, month, businessUnitId: body.businessUnitId || null, status: { not: 'batal' } } });
  if (existing) throw ApiError.badRequest('Payroll periode ini sudah ada.');
  const emps = await prisma.employee.findMany({ where: { active: true, ...(body.businessUnitId ? { businessUnitId: body.businessUnitId } : {}) }, orderBy: { name: 'asc' } });
  const comps = await prisma.payrollComponent.findMany({ where: { isActive: true, appliesTo: 'semua' } });
  const tunj = comps.filter((c) => c.type === 'tunjangan');
  const pot = comps.filter((c) => c.type === 'potongan');
  const created = await prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.create({ data: { year, month, status: 'draft', businessUnitId: body.businessUnitId || null, note: String(body.note || '').slice(0, 300), createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null } });
    for (const e of emps) {
      const compTunj = tunj.map((c) => ({ componentId: c.id, name: c.name, type: 'tunjangan', amount: n(c.defaultAmount) }));
      const compPot = pot.map((c) => ({ componentId: c.id, name: c.name, type: 'potongan', amount: n(c.defaultAmount) }));
      const allowancesTotal = employeeAllowances(e) + compTunj.reduce((s, c) => s + c.amount, 0);
      const deductionsTotal = compPot.reduce((s, c) => s + c.amount, 0);
      const basicSalary = n(e.base);
      const netPay = basicSalary + allowancesTotal - deductionsTotal;
      const line = await tx.payrollLine.create({ data: { payrollPeriodId: period.id, employeeId: e.id, employeeName: e.name, basicSalary: BigInt(basicSalary), overtime: 0n, bonus: 0n, allowancesTotal: BigInt(allowancesTotal), deductionsTotal: BigInt(deductionsTotal), cashbonDeduction: 0n, netPay: BigInt(netPay), isProduction: !!e.isProduction, chartAccountId: null, businessUnitId: e.businessUnitId || null, fleetId: '' } });
      for (const c of [...compTunj, ...compPot]) await tx.payrollLineComponent.create({ data: { payrollLineId: line.id, componentId: c.componentId, name: c.name, type: c.type, amount: BigInt(c.amount) } });
    }
    return period;
  });
  return getPeriod(created.id);
}

async function periodTotals(lines) {
  const t = { basic: 0, overtime: 0, bonus: 0, allowances: 0, deductions: 0, cashbon: 0, net: 0, gross: 0, prodGross: 0, opexGross: 0, count: lines.length };
  lines.forEach((l) => {
    const gross = n(l.basicSalary) + n(l.overtime) + n(l.bonus) + n(l.allowancesTotal);
    t.basic += n(l.basicSalary); t.overtime += n(l.overtime); t.bonus += n(l.bonus); t.allowances += n(l.allowancesTotal);
    t.deductions += n(l.deductionsTotal); t.cashbon += n(l.cashbonDeduction); t.net += lineNet(l); t.gross += gross;
    if (l.isProduction) t.prodGross += gross; else t.opexGross += gross;
  });
  return t;
}
async function lineClient(l, withEmployeeOutstanding) {
  const comps = await prisma.payrollLineComponent.findMany({ where: { payrollLineId: l.id } });
  return {
    id: l.id, employeeId: l.employeeId, employeeName: l.employeeName, basicSalary: n(l.basicSalary), overtime: n(l.overtime), bonus: n(l.bonus),
    allowancesTotal: n(l.allowancesTotal), deductionsTotal: n(l.deductionsTotal), cashbonDeduction: n(l.cashbonDeduction), netPay: lineNet(l),
    isProduction: !!l.isProduction, businessUnitId: l.businessUnitId || null, fleetId: l.fleetId || '',
    components: comps.map((c) => ({ id: c.id, componentId: c.componentId, name: c.name, type: c.type, amount: n(c.amount) })),
    cashbonOutstanding: withEmployeeOutstanding ? await cashbon.outstandingFor(l.employeeId) : undefined,
  };
}
async function periodClient(p, full) {
  const lines = await prisma.payrollLine.findMany({ where: { payrollPeriodId: p.id }, orderBy: { employeeName: 'asc' } });
  const totals = await periodTotals(lines);
  return {
    id: p.id, year: p.year, month: p.month, period: keyOf(p.year, p.month), status: p.status, businessUnitId: p.businessUnitId || null, note: p.note || '',
    approvedByName: p.approvedByName || null, approvedAt: p.approvedAt ? new Date(p.approvedAt).getTime() : null, selfApproved: !!p.selfApproved,
    paidAt: p.paidAt ? new Date(p.paidAt).getTime() : null, journalPosted: !!p.journalEntryId, paid: !!p.payJournalId,
    totals, lines: full ? await Promise.all(lines.map((l) => lineClient(l, p.status === 'draft'))) : undefined,
    createdByName: p.createdByName || null, createdAt: p.createdAt ? new Date(p.createdAt).getTime() : null,
  };
}
async function listPeriods(query) {
  const q = query || {};
  const where = {}; if (q.year) where.year = +q.year; if (['draft', 'disetujui', 'dibayar', 'batal'].includes(q.status)) where.status = q.status;
  const rows = await prisma.payrollPeriod.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 60 });
  const data = []; for (const p of rows) data.push(await periodClient(p, false));
  return { data };
}
async function getPeriod(id) { const p = await prisma.payrollPeriod.findUnique({ where: { id } }); if (!p) throw ApiError.notFound('Payroll periode tidak ditemukan.'); return periodClient(p, true); }
// ONE employee's payslip — never exposes another line. Callers pass the requesting employeeId to gate.
async function getPayslip(lineId, requesterEmployeeId) {
  const l = await prisma.payrollLine.findUnique({ where: { id: lineId } });
  if (!l) throw ApiError.notFound('Slip gaji tidak ditemukan.');
  if (requesterEmployeeId && l.employeeId !== requesterEmployeeId) throw ApiError.forbidden('Anda hanya boleh melihat slip gaji Anda sendiri.');
  const p = await prisma.payrollPeriod.findUnique({ where: { id: l.payrollPeriodId } });
  return { period: keyOf(p.year, p.month), status: p.status, line: await lineClient(l, false) };
}

// ── EDIT a draft line (overtime / bonus / cashbon / isProduction / component amounts). Blocked once the
// period is approved — corrections go through a reversing void, never an edit (consistent with modules).
async function updateLine(lineId, body, actor) {
  const l = await prisma.payrollLine.findUnique({ where: { id: lineId } });
  if (!l) throw ApiError.notFound('Baris payroll tidak ditemukan.');
  const p = await prisma.payrollPeriod.findUnique({ where: { id: l.payrollPeriodId } });
  if (p.status !== 'draft') throw ApiError.badRequest('Periode sudah disetujui — koreksi lewat pembatalan/penyesuaian, bukan edit.');
  const data = {};
  if (body.overtime != null) data.overtime = BigInt(int(body.overtime));
  if (body.bonus != null) data.bonus = BigInt(int(body.bonus));
  if (body.isProduction != null) data.isProduction = !!body.isProduction;
  if (body.fleetId != null) data.fleetId = String(body.fleetId);
  if (body.cashbonDeduction != null) { const out = await cashbon.outstandingFor(l.employeeId); data.cashbonDeduction = BigInt(Math.min(int(body.cashbonDeduction), out)); }   // never deduct more than owed
  await prisma.$transaction(async (tx) => {
    if (Array.isArray(body.components)) {
      let dedTotal = 0, tunjTotal = 0;
      for (const bc of body.components) { const row = await tx.payrollLineComponent.update({ where: { id: bc.id }, data: { amount: BigInt(int(bc.amount)) } }); if (row.type === 'potongan') dedTotal += int(bc.amount); else tunjTotal += int(bc.amount); }
      const emp = await tx.employee.findUnique({ where: { id: l.employeeId } });
      data.allowancesTotal = BigInt(employeeAllowances(emp) + tunjTotal);
      data.deductionsTotal = BigInt(dedTotal);
    }
    const merged = { ...l, ...data };
    data.netPay = BigInt(lineNet({ basicSalary: n(merged.basicSalary), overtime: n(merged.overtime), bonus: n(merged.bonus), allowancesTotal: n(merged.allowancesTotal), deductionsTotal: n(merged.deductionsTotal), cashbonDeduction: n(merged.cashbonDeduction) }));
    await tx.payrollLine.update({ where: { id: lineId }, data });
  });
  return getPeriod(l.payrollPeriodId);
}

// ── APPROVE — posts the accrual journal + settles cashbon, in ONE transaction. Reuses the
// distribusiApproveSelf rule (a creator approving their own run needs the waiver). Only an approved
// period has a journal; recalculation is blocked afterwards.
async function actorPerms(actor) { if (!actor || !actor.id) return {}; const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, permissions: true } }); return u ? resolvePerms(u.role, u.permissions) : {}; }
async function approvePeriod(id, actor) {
  const p = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!p) throw ApiError.notFound('Payroll periode tidak ditemukan.');
  if (p.status !== 'draft') throw ApiError.badRequest('Hanya periode draft yang bisa disetujui.');
  const lines = await prisma.payrollLine.findMany({ where: { payrollPeriodId: id } });
  if (!lines.length) throw ApiError.badRequest('Periode tidak punya baris gaji.');
  // Self-approval waiver — the creator may only approve their own run with distribusiApproveSelf.
  const isSelf = !!(p.createdById && actor && p.createdById === actor.id);
  if (isSelf) { const perms = await actorPerms(actor); if (!perms.distribusiApproveSelf) throw ApiError.forbidden('Anda tidak boleh menyetujui payroll yang Anda buat sendiri.'); }
  await require('./period.service').assertPeriodOpen(keyOf(p.year, p.month) + '-15', 'persetujuan payroll');
  const name = (actor && actor.name) || null;
  const updated = await prisma.$transaction(async (tx) => {
    let je = null;
    if (config.accountingV2) {
      const jlines = [];
      let net = 0, ded = 0, cb = 0;
      for (const l of lines) {
        const gross = n(l.basicSalary) + n(l.overtime) + n(l.bonus) + n(l.allowancesTotal);
        if (gross > 0) jlines.push({ code: l.isProduction ? COGS_LABOUR : BEBAN_GAJI, debit: gross, businessUnitId: l.businessUnitId || null, fleetId: l.fleetId || '' });
        net += lineNet(l); ded += n(l.deductionsTotal); cb += n(l.cashbonDeduction);
      }
      if (net > 0) jlines.push({ code: UTANG_GAJI, credit: net });
      if (ded > 0) jlines.push({ code: UTANG_POTONGAN, credit: ded });
      if (cb > 0) jlines.push({ code: PIUTANG_KARYAWAN, credit: cb });
      je = await acc.postJournal({ sourceType: 'payroll', sourceId: id, date: keyOf(p.year, p.month) + '-28', description: `Beban gaji ${keyOf(p.year, p.month)}`, actor, businessUnitId: p.businessUnitId, lines: jlines }, tx);
    }
    // Settle cashbon repayments (moves the employee balance; the journal above credited Piutang Karyawan).
    for (const l of lines) if (n(l.cashbonDeduction) > 0) await cashbon.applyRepayment(l.employeeId, n(l.cashbonDeduction), tx);
    return tx.payrollPeriod.update({ where: { id }, data: { status: 'disetujui', approvedById: (actor && actor.id) || null, approvedByName: name, approvedAt: new Date(), selfApproved: isSelf, journalEntryId: je ? je.id : null } });
  });
  return periodClient(updated, false);
}
// ── PAY — clears Utang Gaji for this period to exactly zero (Dr Utang Gaji · Cr Kas/Bank).
async function payPeriod(id, body, actor) {
  const p = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!p) throw ApiError.notFound('Payroll periode tidak ditemukan.');
  if (p.status !== 'disetujui') throw ApiError.badRequest('Hanya periode disetujui yang bisa dibayar.');
  const lines = await prisma.payrollLine.findMany({ where: { payrollPeriodId: id } });
  const net = lines.reduce((s, l) => s + lineNet(l), 0);
  const payCode = String(body.account || '').toLowerCase() === 'kas' ? KAS : BANK;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : keyOf(p.year, p.month) + '-28';
  const updated = await prisma.$transaction(async (tx) => {
    let je = null;
    if (config.accountingV2 && net > 0) je = await acc.postJournal({ sourceType: 'payroll_pay', sourceId: id, date, description: `Bayar gaji ${keyOf(p.year, p.month)}`, actor, businessUnitId: p.businessUnitId, lines: [{ code: UTANG_GAJI, debit: net }, { code: payCode, credit: net }] }, tx);
    return tx.payrollPeriod.update({ where: { id }, data: { status: 'dibayar', paidAt: new Date(), paidAccountId: body.account || null, payJournalId: je ? je.id : null } });
  });
  return periodClient(updated, false);
}
// ── VOID (reversing correction) — never an edit. Reverses the accrual (and payment) journals, restores
// cashbon repayments, and marks the period batal so a fresh period can be built.
async function voidPeriod(id, body, actor) {
  const p = await prisma.payrollPeriod.findUnique({ where: { id } });
  if (!p) throw ApiError.notFound('Payroll periode tidak ditemukan.');
  if (p.status === 'batal' || p.status === 'draft') throw ApiError.badRequest('Periode ini tidak dalam keadaan yang bisa dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan pembatalan wajib diisi.');
  const lines = await prisma.payrollLine.findMany({ where: { payrollPeriodId: id } });
  await prisma.$transaction(async (tx) => {
    if (config.accountingV2) {
      if (p.payJournalId) await acc.reverseJournal({ sourceType: 'payroll_pay', sourceId: id, reversalSourceType: 'payroll_pay_void', reversalSourceId: id, date: keyOf(p.year, p.month) + '-28', description: `Batal bayar gaji: ${reason}`, actor }, tx);
      await acc.reverseJournal({ sourceType: 'payroll', sourceId: id, reversalSourceType: 'payroll_void', reversalSourceId: id, date: keyOf(p.year, p.month) + '-28', description: `Batal beban gaji: ${reason}`, actor }, tx);
    }
    // restore cashbon repayments
    for (const l of lines) if (n(l.cashbonDeduction) > 0) { const rows = await tx.cashbon.findMany({ where: { employeeId: l.employeeId, repaidAmount: { gt: 0 } }, orderBy: { disbursedDate: 'desc' } }); let back = n(l.cashbonDeduction); for (const c of rows) { if (back <= 0) break; const undo = Math.min(Number(c.repaidAmount), back); await tx.cashbon.update({ where: { id: c.id }, data: { repaidAmount: BigInt(Number(c.repaidAmount) - undo), status: 'approved' } }); back -= undo; } }
    await tx.payrollPeriod.update({ where: { id }, data: { status: 'batal' } });
  });
  return periodClient(await prisma.payrollPeriod.findUnique({ where: { id } }), false);
}

// ── TUTUP BUKU helpers + reports ────────────────────────────────────────────────
async function payrollCheck({ year, month } = {}) {
  const where = { year, month };
  const draft = await prisma.payrollPeriod.count({ where: { ...where, status: 'draft' } });
  const approvedUnposted = await prisma.payrollPeriod.count({ where: { ...where, status: { in: ['disetujui', 'dibayar'] }, journalEntryId: null } });
  return { draft, approvedUnposted };
}
// Actual PRODUCTION labour for a period = the 5-1500 (COGS labour) balance — what the costing module
// reads as production-labour overhead, entered ONCE (by payroll), never twice.
async function productionLabourFor({ year, month } = {}) {
  const key = keyOf(year, month); const bals = await acc.accountBalances({ dateFrom: key + '-01', dateTo: key + '-31' });
  const a = bals.find((r) => r.code === COGS_LABOUR); return a ? a.balance : 0;
}
async function payrollReport({ year, month } = {}) {
  const periods = await prisma.payrollPeriod.findMany({ where: { year, month, status: { in: ['disetujui', 'dibayar'] } } });
  const byUnit = {}; let prodGross = 0, opexGross = 0;
  for (const p of periods) { const lines = await prisma.payrollLine.findMany({ where: { payrollPeriodId: p.id } }); for (const l of lines) { const g = n(l.basicSalary) + n(l.overtime) + n(l.bonus) + n(l.allowancesTotal); const u = l.businessUnitId || 'air'; const f = l.fleetId || '-'; const key = u + '/' + f; (byUnit[key] || (byUnit[key] = { unit: u, fleet: f, gross: 0 })).gross += g; if (l.isProduction) prodGross += g; else opexGross += g; } }
  const bals = await acc.accountBalances({ dateFrom: keyOf(year, month) + '-01', dateTo: keyOf(year, month) + '-31' });
  const utangGaji = (bals.find((r) => r.code === UTANG_GAJI) || {}).balance || 0;
  const piutang = (bals.find((r) => r.code === PIUTANG_KARYAWAN) || {}).balance || 0;
  return { period: keyOf(year, month), byUnit: Object.values(byUnit), prodGross, opexGross, utangGaji, piutangKaryawan: piutang, productionLabour: await productionLabourFor({ year, month }) };
}

module.exports = {
  listComponents, createComponent, updateComponent,
  createPeriod, listPeriods, getPeriod, getPayslip, updateLine,
  approvePeriod, payPeriod, voidPeriod, payrollCheck, productionLabourFor, payrollReport,
};
