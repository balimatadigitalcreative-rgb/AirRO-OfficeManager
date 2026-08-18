'use strict';
// ACCOUNTS PAYABLE (Utang Usaha) — accrual purchases. A Bill recognises the expense/asset when it is
// INCURRED (Dr expense/asset · Cr Utang Usaha), independent of when cash moves; payments (Dr Utang
// Usaha · Cr Kas/Bank) may be partial and the status derives from Σ paid. Posts through the SAME
// double-entry engine as everything else (accounting.postJournal), gated on ACCOUNTING_V2.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const acc = require('./accounting.service');
const accrual = require('./accrual.service');

const PAYABLE = '2-1000';   // Utang Usaha
const PPN_IN = '1-1500';    // PPN Masukan (recoverable input VAT)
const PREPAID_EXP = '1-1600';   // Beban Dibayar Di Muka (a prepaid line capitalises here, then amortises)
const KAS = '1-1000', BANK = '1-1100';
const n = (v) => Math.round(Number(v) || 0);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ── status derivation from Σ paid (never stored directly except 'draft'/'batal') ──
function deriveStatus(bill, paid) {
  if (bill.status === 'draft' || bill.status === 'batal') return bill.status;
  if (paid <= 0) return 'terbuka';
  if (paid >= n(bill.total)) return 'lunas';
  return 'sebagian';
}
async function paidOf(billId, db = prisma) {
  const rows = await db.billPayment.findMany({ where: { billId }, select: { amount: true } });
  return rows.reduce((s, r) => s + n(r.amount), 0);
}

// Client shape — the bill with its lines, payments, paid/outstanding, supplier name, live status.
function billClient(b, paid) {
  const total = n(b.total);
  const p = paid != null ? paid : (b.payments || []).reduce((s, x) => s + n(x.amount), 0);
  return {
    id: b.id, supplierId: b.supplierId, supplierName: b.supplier ? b.supplier.name : null,
    billNumber: b.billNumber || '', billDate: b.billDate, dueDate: b.dueDate || null, description: b.description || '',
    subtotal: n(b.subtotal), tax: n(b.tax), total, paid: p, outstanding: Math.max(0, total - p),
    status: deriveStatus(b, p), businessUnitId: b.businessUnitId || null, voidReason: b.voidReason || null,
    createdByName: b.createdByName || null, createdAt: b.createdAt ? new Date(b.createdAt).getTime() : null,
    lines: (b.lines || []).map((l) => ({ id: l.id, chartAccountId: l.chartAccountId, chartCode: l._code || null, description: l.description || '', qty: l.qty, unitPrice: n(l.unitPrice), amount: n(l.amount), fleetId: l.fleetId || '' })),
    payments: (b.payments || []).map((x) => ({ id: x.id, date: x.date, amount: n(x.amount), accountId: x.accountId || null, method: x.method || '', reference: x.reference || '', recordedByName: x.recordedByName || null })),
  };
}

// Validate + normalise line input; each line names a POSTABLE (leaf) expense/asset account by code.
async function normalizeLines(lines, db = prisma) {
  if (!Array.isArray(lines) || !lines.length) throw ApiError.badRequest('Minimal satu baris.');
  const codes = [...new Set(lines.map((l) => String(l.chartCode || '')))];
  const accts = await db.chartAccount.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, subtype: true, type: true } });
  const byCode = {}; accts.forEach((a) => { byCode[a.code] = a; });
  return lines.map((l) => {
    const a = byCode[String(l.chartCode || '')];
    if (!a) throw ApiError.badRequest(`Akun ${l.chartCode || '(kosong)'} tidak ditemukan.`);
    if (a.subtype === 'header') throw ApiError.badRequest('Pilih akun rincian, bukan akun induk.');
    const qty = Math.max(1, int(l.qty || 1)); const unitPrice = int(l.unitPrice);
    const amount = l.amount != null ? int(l.amount) : qty * unitPrice;
    if (amount <= 0) throw ApiError.badRequest('Nominal baris harus lebih dari 0.');
    // PREPAID: a line covering a future period is amortised over N months — capitalised on issue.
    const amortizeMonths = Math.max(0, int(l.amortizeMonths || 0));
    const amortizeStart = (amortizeMonths > 0 && isDate(l.amortizeStart)) ? l.amortizeStart : null;
    return { chartAccountId: a.id, chartCode: a.code, description: String(l.description || '').slice(0, 200), qty, unitPrice, amount, fleetId: String(l.fleetId || '').slice(0, 40), amortizeMonths, amortizeStart };
  });
}

async function createBill(body, actor) {
  const supplier = await prisma.supplier.findUnique({ where: { id: String(body.supplierId || '') } });
  if (!supplier) throw ApiError.badRequest('Pemasok tidak ditemukan.');
  if (!isDate(body.billDate)) throw ApiError.badRequest('Tanggal tagihan tidak valid.');
  if (body.dueDate && !isDate(body.dueDate)) throw ApiError.badRequest('Tanggal jatuh tempo tidak valid.');
  const lines = await normalizeLines(body.lines);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = int(body.tax);
  const total = subtotal + tax;
  const businessUnitId = body.businessUnitId ? String(body.businessUnitId) : null;
  const bill = await prisma.bill.create({ data: {
    supplierId: supplier.id, billNumber: String(body.billNumber || '').slice(0, 60), billDate: body.billDate, dueDate: body.dueDate || null,
    description: String(body.description || '').slice(0, 500), subtotal: BigInt(subtotal), tax: BigInt(tax), total: BigInt(total),
    status: 'draft', businessUnitId, createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null,
    lines: { create: lines.map((l) => ({ chartAccountId: l.chartAccountId, description: l.description, qty: l.qty, unitPrice: BigInt(l.unitPrice), amount: BigInt(l.amount), fleetId: l.fleetId, amortizeMonths: l.amortizeMonths, amortizeStart: l.amortizeStart })) },
  }, include: { lines: true, supplier: { select: { name: true } } } });
  return billClient(bill, 0);
}

async function updateBill(id, body, actor) {
  const bill = await prisma.bill.findUnique({ where: { id } });
  if (!bill) throw ApiError.notFound('Tagihan tidak ditemukan.');
  if (bill.status !== 'draft') throw ApiError.badRequest('Hanya tagihan draft yang bisa diubah — batalkan lalu buat ulang.');
  const lines = await normalizeLines(body.lines);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = int(body.tax); const total = subtotal + tax;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.billLine.deleteMany({ where: { billId: id } });
    return tx.bill.update({ where: { id }, data: {
      billNumber: String(body.billNumber || '').slice(0, 60), billDate: isDate(body.billDate) ? body.billDate : bill.billDate, dueDate: body.dueDate || null,
      description: String(body.description || '').slice(0, 500), subtotal: BigInt(subtotal), tax: BigInt(tax), total: BigInt(total),
      businessUnitId: body.businessUnitId ? String(body.businessUnitId) : null,
      lines: { create: lines.map((l) => ({ chartAccountId: l.chartAccountId, description: l.description, qty: l.qty, unitPrice: BigInt(l.unitPrice), amount: BigInt(l.amount), fleetId: l.fleetId, amortizeMonths: l.amortizeMonths, amortizeStart: l.amortizeStart })) },
    }, include: { lines: true, supplier: { select: { name: true } } } });
  });
  return billClient(updated, 0);
}

// The accrual journal: Dr each line's account (a PREPAID line capitalises to 1-1600 instead of its
// expense account) + Dr PPN Masukan (tax) · Cr Utang Usaha (total).
async function billAccrualLines(bill, db = prisma) {
  const accts = await db.chartAccount.findMany({ where: { id: { in: bill.lines.map((l) => l.chartAccountId) } }, select: { id: true, code: true } });
  const code = {}; accts.forEach((a) => { code[a.id] = a.code; });
  const lines = bill.lines.map((l) => ({ code: (l.amortizeMonths > 0 ? PREPAID_EXP : code[l.chartAccountId]), debit: n(l.amount), fleetId: l.fleetId || '' }));
  if (n(bill.tax) > 0) lines.push({ code: PPN_IN, debit: n(bill.tax) });
  lines.push({ code: PAYABLE, credit: n(bill.total) });
  return lines;
}

// ISSUE — draft → terbuka; posts the accrual journal in the SAME transaction as the status change.
async function issueBill(id, actor) {
  const bill = await prisma.bill.findUnique({ where: { id }, include: { lines: true, supplier: { select: { name: true } } } });
  if (!bill) throw ApiError.notFound('Tagihan tidak ditemukan.');
  if (bill.status === 'batal') throw ApiError.badRequest('Tagihan ini sudah dibatalkan.');
  if (bill.status !== 'draft') throw ApiError.badRequest('Tagihan ini sudah diterbitkan.');
  if (n(bill.total) <= 0) throw ApiError.badRequest('Total tagihan harus lebih dari 0.');
  const out = await prisma.$transaction(async (tx) => {
    const b = await tx.bill.update({ where: { id }, data: { status: 'terbuka', periodId: bill.periodId }, include: { lines: true, supplier: { select: { name: true } } } });
    if (config.accountingV2) await acc.postJournal({ sourceType: 'bill', sourceId: b.id, date: b.billDate, description: `Tagihan ${b.supplier ? b.supplier.name : ''} ${b.billNumber || ''}`.trim(), actor, businessUnitId: b.businessUnitId || null, lines: await billAccrualLines(b, tx) }, tx);
    // PREPAID lines: capitalised above (Dr 1-1600); create their amortisation schedules so the expense
    // is spread monthly by postAmortization(). One schedule per prepaid line.
    for (const l of b.lines) {
      if (l.amortizeMonths > 0) await accrual.createSchedule({ sourceType: 'bill', sourceId: b.id, chartAccountId: l.chartAccountId, startDate: l.amortizeStart || b.billDate, months: l.amortizeMonths, total: n(l.amount), description: `${b.billNumber || ''} ${l.description || ''}`.trim(), businessUnitId: b.businessUnitId, fleetId: l.fleetId }, tx);
    }
    return b;
  });
  return billClient(out, 0);
}

// RECORD PAYMENT — Dr Utang Usaha · Cr Kas/Bank (by the paying account's type); status re-derives.
async function recordBillPayment(id, body, actor) {
  const bill = await prisma.bill.findUnique({ where: { id }, include: { supplier: { select: { name: true } } } });
  if (!bill) throw ApiError.notFound('Tagihan tidak ditemukan.');
  if (bill.status === 'draft') throw ApiError.badRequest('Terbitkan tagihan dulu sebelum membayar.');
  if (bill.status === 'batal') throw ApiError.badRequest('Tagihan ini sudah dibatalkan.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Jumlah pembayaran harus lebih dari 0.');
  if (!isDate(body.date)) throw ApiError.badRequest('Tanggal pembayaran tidak valid.');
  const paid = await paidOf(id);
  const outstanding = Math.max(0, n(bill.total) - paid);
  if (amount > outstanding) throw ApiError.badRequest(`Pembayaran (${amount}) melebihi sisa utang (${outstanding}).`, { outstanding });
  let payCode = BANK, account = null;
  if (body.accountId) {
    account = await prisma.account.findUnique({ where: { id: String(body.accountId) } });
    if (!account) throw ApiError.badRequest('Akun kas/bank tidak ditemukan.');
    payCode = account.type === 'cash' ? KAS : BANK;
  } else if (body.method === 'cash' || body.method === 'tunai') payCode = KAS;
  const out = await prisma.$transaction(async (tx) => {
    const pay = await tx.billPayment.create({ data: {
      billId: id, date: body.date, amount: BigInt(amount), accountId: body.accountId ? String(body.accountId) : null,
      method: String(body.method || (payCode === KAS ? 'cash' : 'transfer')).slice(0, 20), reference: String(body.reference || '').slice(0, 100),
      recordedById: (actor && actor.id) || null, recordedByName: (actor && actor.name) || null,
    } });
    const newPaid = paid + amount;
    await tx.bill.update({ where: { id }, data: { status: newPaid >= n(bill.total) ? 'lunas' : 'sebagian' } });
    if (config.accountingV2) await acc.postJournal({ sourceType: 'bill_payment', sourceId: pay.id, date: body.date, description: `Bayar tagihan ${bill.supplier ? bill.supplier.name : ''} ${bill.billNumber || ''}`.trim(), actor, businessUnitId: bill.businessUnitId || null, lines: [{ code: PAYABLE, debit: amount }, { code: payCode, credit: amount }] }, tx);
    return pay;
  });
  return { payment: { id: out.id, amount, date: body.date }, paid: paid + amount, outstanding: outstanding - amount, status: (paid + amount) >= n(bill.total) ? 'lunas' : 'sebagian' };
}

// VOID — only a bill with NO payments (reverse the payment(s) first). Appends a reversing accrual entry
// (never edits the original), sets status batal. Mirrors the append-only rule used everywhere else.
async function voidBill(id, body, actor) {
  const bill = await prisma.bill.findUnique({ where: { id } });
  if (!bill) throw ApiError.notFound('Tagihan tidak ditemukan.');
  if (bill.status === 'batal') throw ApiError.badRequest('Tagihan ini sudah dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan pembatalan wajib diisi.');
  const paid = await paidOf(id);
  if (paid > 0) throw ApiError.badRequest('Ada pembayaran pada tagihan ini — hapus pembayaran dulu sebelum membatalkan.', { paid });
  const wasIssued = bill.status !== 'draft';
  await prisma.$transaction(async (tx) => {
    await tx.bill.update({ where: { id }, data: { status: 'batal', voidReason: reason } });
    if (wasIssued && config.accountingV2) await acc.reverseJournal({ sourceType: 'bill', sourceId: id, reversalSourceType: 'bill_void', reversalSourceId: id, date: bill.billDate, description: `Pembatalan tagihan: ${reason}`, actor }, tx);
  });
  return { voided: true, id, status: 'batal' };
}

async function listBills(query, user) {
  const q = query || {};
  const where = {};
  if (q.status && ['draft', 'terbuka', 'sebagian', 'lunas', 'batal'].includes(q.status)) where.status = q.status;
  if (q.supplierId) where.supplierId = String(q.supplierId);
  if (q.dateFrom || q.dateTo) { where.billDate = {}; if (q.dateFrom) where.billDate.gte = q.dateFrom; if (q.dateTo) where.billDate.lte = q.dateTo; }
  if (q.businessUnitId) where.businessUnitId = String(q.businessUnitId);
  const bills = await prisma.bill.findMany({ where, orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }], take: 500, include: { lines: true, payments: { select: { amount: true } }, supplier: { select: { name: true } } } });
  // Outstanding summary for the header KPIs (open + overdue).
  const today = q.asOf || new Date().toISOString().slice(0, 10);
  let openTotal = 0, overdueTotal = 0;
  const data = bills.map((b) => {
    const c = billClient(b);
    if (c.status === 'terbuka' || c.status === 'sebagian') { openTotal += c.outstanding; if (b.dueDate && b.dueDate < today) overdueTotal += c.outstanding; }
    return c;
  });
  return { data, summary: { open: openTotal, overdue: overdueTotal } };
}

async function getBill(id) {
  const b = await prisma.bill.findUnique({ where: { id }, include: { lines: true, payments: true, supplier: { select: { name: true } } } });
  if (!b) throw ApiError.notFound('Tagihan tidak ditemukan.');
  // attach line codes for the client
  const accts = await prisma.chartAccount.findMany({ where: { id: { in: b.lines.map((l) => l.chartAccountId) } }, select: { id: true, code: true } });
  const code = {}; accts.forEach((a) => { code[a.id] = a.code; });
  b.lines.forEach((l) => { l._code = code[l.chartAccountId]; });
  return billClient(b);
}

// ── UMUR UTANG (AP aging) — outstanding per supplier, aged by billDate into 0-30/31-60/61-90/90+.
// By construction Σ buckets == Σ outstanding == the Utang Usaha (2-1000) ledger balance.
function bucket(date, asOf) {
  const days = Math.floor((new Date(asOf + 'T00:00') - new Date((date || asOf) + 'T00:00')) / 86400000);
  return days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90p';
}
async function agingPayables({ asOf, businessUnitId } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const where = { status: { in: ['terbuka', 'sebagian'] } };
  if (businessUnitId) where.businessUnitId = String(businessUnitId);
  const bills = await prisma.bill.findMany({ where, include: { payments: { select: { amount: true } }, supplier: { select: { id: true, name: true } } } });
  const totals = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const bySup = {};
  for (const b of bills) {
    const paid = (b.payments || []).reduce((s, x) => s + n(x.amount), 0);
    const outstanding = Math.max(0, n(b.total) - paid);
    if (outstanding <= 0) continue;
    const sid = b.supplierId; const r = bySup[sid] || (bySup[sid] = { supplierId: sid, name: b.supplier ? b.supplier.name : '', d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0, total: 0 });
    const bk = bucket(b.billDate, today);
    r[bk] += outstanding; r.total += outstanding; totals[bk] += outstanding;
  }
  const rows = Object.values(bySup).sort((a, b) => b.total - a.total);
  return { asOf: today, buckets: totals, total: totals.d0_30 + totals.d31_60 + totals.d61_90 + totals.d90p, rows };
}
async function payablesBalance() { const rows = await acc.accountBalances(); const p = rows.find((r) => r.code === PAYABLE); return p ? p.balance : 0; }

// "JATUH TEMPO MINGGU INI" — unpaid bills due within the next 7 days (incl. already overdue), so nothing
// is missed. Sorted soonest-first; flags overdue.
async function payablesDue({ asOf, days = 7 } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const until = new Date(today + 'T00:00'); until.setDate(until.getDate() + days);
  const untilStr = until.toISOString().slice(0, 10);
  const bills = await prisma.bill.findMany({ where: { status: { in: ['terbuka', 'sebagian'] }, dueDate: { not: null, lte: untilStr } }, include: { payments: { select: { amount: true } }, supplier: { select: { name: true } } }, orderBy: { dueDate: 'asc' } });
  let total = 0;
  const rows = bills.map((b) => { const paid = (b.payments || []).reduce((s, x) => s + n(x.amount), 0); const outstanding = Math.max(0, n(b.total) - paid); total += outstanding; return { id: b.id, supplierName: b.supplier ? b.supplier.name : '', billNumber: b.billNumber || '', dueDate: b.dueDate, outstanding, overdue: b.dueDate < today }; }).filter((r) => r.outstanding > 0);
  return { asOf: today, until: untilStr, total, count: rows.length, rows };
}

module.exports = { createBill, updateBill, issueBill, recordBillPayment, voidBill, listBills, getBill, agingPayables, payablesBalance, payablesDue };
