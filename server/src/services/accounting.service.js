'use strict';
// ══════════════ ACCOUNTING v2 — the ONE double-entry posting service ══════════════
// A LAYER on top of the cash book. It NEVER reads or writes Entry/Account/Category/DistTransaction as a
// source of truth — it only PROJECTS them into balanced journals. The cash book is unchanged, so every
// existing report stays byte-identical (proven in accounting-parity.test.js). Gated behind ACCOUNTING_V2.
//
// HARD INVARIANT (asserted on every post): sum(debit) === sum(credit) per journal entry.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// ── Indonesian SMB chart of accounts (seed). code · name · type · parent(code). ──
const CHART = [
  ['1-0000', 'Aset', 'asset', ''],
  ['1-1000', 'Kas', 'asset', '1-0000'],
  ['1-1100', 'Bank', 'asset', '1-0000'],
  ['1-1200', 'Piutang Usaha', 'asset', '1-0000'],
  ['1-1300', 'Persediaan Galon', 'asset', '1-0000'],
  ['1-1400', 'Peralatan', 'asset', '1-0000'],
  ['2-0000', 'Kewajiban', 'liability', ''],
  ['2-1000', 'Utang Usaha', 'liability', '2-0000'],
  ['2-2000', 'Utang Gaji', 'liability', '2-0000'],
  ['3-0000', 'Ekuitas', 'equity', ''],
  ['3-1000', 'Modal', 'equity', '3-0000'],
  ['3-2000', 'Laba Ditahan', 'equity', '3-0000'],
  ['3-3000', 'Prive', 'equity', '3-0000'],
  ['4-0000', 'Pendapatan', 'revenue', ''],
  ['4-1000', 'Penjualan Air', 'revenue', '4-0000'],
  ['4-2000', 'Pendapatan Lain', 'revenue', '4-0000'],
  ['5-0000', 'Harga Pokok Penjualan', 'expense', ''],
  ['5-1000', 'HPP Galon', 'expense', '5-0000'],
  ['6-0000', 'Beban Operasional', 'expense', ''],
  ['6-1000', 'Beban Gaji', 'expense', '6-0000'],
  ['6-2000', 'Beban BBM & Pengiriman', 'expense', '6-0000'],
  ['6-3000', 'Beban Perlengkapan', 'expense', '6-0000'],
  ['6-4000', 'Beban Pemeliharaan', 'expense', '6-0000'],
  ['6-5000', 'Beban Utilitas', 'expense', '6-0000'],
  ['6-6000', 'Beban Sewa', 'expense', '6-0000'],
  ['6-9000', 'Beban Lain-lain', 'expense', '6-0000'],
];
const AR = '1-1200', KAS = '1-1000', BANK = '1-1100', PERSEDIAAN = '1-1300';
const REV_MAIN = '4-1000', REV_OTHER = '4-2000', EXP_OTHER = '6-9000';
// Frontend cash-book category key → account code. UNMAPPED keys are REPORTED (unmappedCategories),
// never silently guessed into a real account — they fall to REV_OTHER/EXP_OTHER and are flagged.
const CAT_MAP = {
  income: { Refill: REV_MAIN, Bulk: REV_MAIN, Deposit: REV_OTHER, Dispenser: REV_OTHER, OtherIn: REV_OTHER },
  expense: { Fuel: '6-2000', Supplies: '6-3000', Salaries: '6-1000', Orientation: '6-1000', Maintenance: '6-4000', Utilities: '6-5000', Rent: '6-6000', OtherOut: EXP_OTHER },
};
const DIST_EXP_MAP = { bensin: '6-2000', makan: EXP_OTHER, parkir: EXP_OTHER, lainnya: EXP_OTHER };
const categoryToCode = (cat, type) => (CAT_MAP[type] && CAT_MAP[type][cat]) || null;   // null = unmapped
const acctCode = (acct) => (/^(cash|tunai|kas)$/i.test(String(acct || '')) ? KAS : BANK);
const n = (v) => Math.round(Number(v) || 0);

async function seedChart() {
  for (let i = 0; i < CHART.length; i++) {
    const [code, name, type, parent] = CHART[i];
    const existing = await prisma.chartAccount.findUnique({ where: { code } });
    if (!existing) await prisma.chartAccount.create({ data: { code, name, type, sortOrder: i, businessUnitId: null } });
  }
  // fill parentId now that all rows exist (kept loose to avoid seeding-order FK issues)
  const rows = await prisma.chartAccount.findMany({ select: { id: true, code: true } });
  const byCode = {}; rows.forEach((r) => { byCode[r.code] = r.id; });
  for (const [code, , , parent] of CHART) { if (parent && byCode[parent]) await prisma.chartAccount.update({ where: { code }, data: { parentId: byCode[parent] } }); }
  return byCode;
}
async function chartMap() { const rows = await prisma.chartAccount.findMany({ select: { id: true, code: true } }); const m = {}; rows.forEach((r) => { m[r.code] = r.id; }); return m; }

// The single balanced-journal writer. `lines` = [{ code, debit?, credit?, businessUnitId?, fleetId? }].
// Idempotent per (sourceType, sourceId): re-posting replaces the previous journal, never duplicates.
async function postJournal({ sourceType, sourceId, date, ref, description, actor, businessUnitId, lines }) {
  const debit = lines.reduce((a, l) => a + n(l.debit), 0);
  const credit = lines.reduce((a, l) => a + n(l.credit), 0);
  if (debit !== credit) throw new Error(`Journal not balanced (${sourceType}:${sourceId}): debit ${debit} != credit ${credit}`);   // HARD INVARIANT
  const cm = await chartMap();
  for (const l of lines) if (!cm[l.code]) throw new Error(`Unknown account code ${l.code} (${sourceType}:${sourceId})`);
  const existing = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId: sourceId || null } });
  if (existing) await prisma.journalEntry.delete({ where: { id: existing.id } });
  return prisma.journalEntry.create({ data: {
    sourceType, sourceId: sourceId || null, date, ref: ref || '', description: (description || '').slice(0, 500),
    postedById: (actor && actor.id) || null, postedByName: (actor && actor.name) || null,
    lines: { create: lines.filter((l) => n(l.debit) || n(l.credit)).map((l) => ({ chartAccountId: cm[l.code], debit: BigInt(n(l.debit)), credit: BigInt(n(l.credit)), businessUnitId: l.businessUnitId || businessUnitId || null, fleetId: l.fleetId || '' })) },
  } });
}

// ── Per-source posters — each PROJECTS one source record into a balanced journal. ──
async function postEntry(e, actor) {
  const amt = n(e.amount); if (!amt) return null;
  const cash = acctCode(e.acct); const bu = e.businessUnitId || null;
  let lines;
  if (e.type === 'income') lines = [{ code: cash, debit: amt }, { code: categoryToCode(e.category, 'income') || REV_OTHER, credit: amt }];
  else if (e.gallonQty > 0 || /pembelian\s*galon/i.test(e.note || '')) lines = [{ code: PERSEDIAAN, debit: amt }, { code: cash, credit: amt }];   // gallon purchase → INVENTORY, not expense
  else lines = [{ code: categoryToCode(e.category, 'expense') || EXP_OTHER, debit: amt }, { code: cash, credit: amt }];
  return postJournal({ sourceType: 'entry', sourceId: e.id, date: e.date, description: e.note, actor, businessUnitId: bu, lines });
}
async function postTransfer(t, actor) {
  const amt = n(t.amount); if (!amt) return null;
  const [from, to] = await Promise.all([prisma.account.findUnique({ where: { id: t.fromId } }), prisma.account.findUnique({ where: { id: t.toId } })]);
  const code = (a) => (a && a.type === 'cash' ? KAS : BANK);
  return postJournal({ sourceType: 'transfer', sourceId: t.id, date: t.date, description: t.note || 'Transfer', actor, lines: [{ code: code(to), debit: amt }, { code: code(from), credit: amt }] });
}
async function postDistExpense(x, actor) {
  const amt = n(x.amount); if (!amt) return null;
  return postJournal({ sourceType: 'dist_expense', sourceId: x.id, date: x.date, description: 'Pengeluaran lapangan', actor, lines: [{ code: DIST_EXP_MAP[x.category] || EXP_OTHER, debit: amt, fleetId: x.fleetId || '' }, { code: KAS, credit: amt, fleetId: x.fleetId || '' }] });
}
// Distribution transaction → receivables. bon: Dr Piutang / Cr Pendapatan · lunas: Dr Kas / Cr Pendapatan
// · pelunasan: Dr Kas / Cr Piutang. (Corrections/disputes/adjustments parity lands in the receivables
// integration stage; this posts the base amount, which equals Sisa Bon for plain bon+pelunasan.)
async function postDistTransaction(t, actor) {
  const amt = n(t.amount); if (!amt) return null;
  const f = t.fleetId || ''; let lines;
  if (t.method === 'bon') lines = [{ code: AR, debit: amt, fleetId: f }, { code: REV_MAIN, credit: amt, fleetId: f }];
  else if (t.method === 'pelunasan') lines = [{ code: KAS, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }];
  else lines = [{ code: KAS, debit: amt, fleetId: f }, { code: REV_MAIN, credit: amt, fleetId: f }];   // lunas
  return postJournal({ sourceType: 'dist_txn', sourceId: t.id, date: t.txnDate, description: `Distribusi ${t.method}`, actor, businessUnitId: t.businessUnitId || null, lines });
}

// Backfill journals for existing records from a start date (ADDITIVE — source rows untouched).
async function backfill({ fromDate, actor } = {}) {
  await seedChart();
  const dGte = fromDate ? { gte: fromDate } : undefined;
  const out = { entry: 0, transfer: 0, dist_txn: 0, dist_expense: 0 };
  const entries = await prisma.entry.findMany({ where: { status: { not: 'Failed' }, ...(dGte ? { date: dGte } : {}) } });
  for (const e of entries) { if (await postEntry(e, actor)) out.entry++; }
  const transfers = await prisma.transfer.findMany({ where: dGte ? { date: dGte } : {} });
  for (const t of transfers) { if (await postTransfer(t, actor)) out.transfer++; }
  const txns = await prisma.distTransaction.findMany({ where: { method: { in: ['bon', 'lunas', 'pelunasan'] }, status: 'active', legacy: false, ...(dGte ? { txnDate: dGte } : {}) } });
  for (const t of txns) { if (await postDistTransaction(t, actor)) out.dist_txn++; }
  const exps = await prisma.distExpense.findMany({ where: { status: 'active', ...(dGte ? { date: dGte } : {}) } });
  for (const x of exps) { if (await postDistExpense(x, actor)) out.dist_expense++; }
  return out;
}

// Category keys used by entries that have NO chart mapping — REPORTED so an admin fixes the map
// rather than the code guessing. (They still post to REV_OTHER/EXP_OTHER so journals stay balanced.)
async function unmappedCategories() {
  const grouped = await prisma.entry.groupBy({ by: ['category', 'type'], where: { status: { not: 'Failed' }, category: { not: null } } });
  return grouped.filter((g) => g.category && !categoryToCode(g.category, g.type)).map((g) => ({ category: g.category, type: g.type }));
}

// ── Reports (read the journal, never the cash book). ──
const SIGN = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 };   // normal-balance sign for (debit − credit)
async function accountBalances({ dateFrom, dateTo } = {}) {
  const jWhere = {};
  if (dateFrom) (jWhere.date || (jWhere.date = {})).gte = dateFrom;
  if (dateTo) (jWhere.date || (jWhere.date = {})).lte = dateTo;
  const lines = await prisma.journalLine.findMany({ where: Object.keys(jWhere).length ? { journalEntry: jWhere } : {}, select: { debit: true, credit: true, chartAccount: { select: { code: true, name: true, type: true } } } });
  const acc = {};
  for (const l of lines) { const c = l.chartAccount.code; if (!acc[c]) acc[c] = { code: c, name: l.chartAccount.name, type: l.chartAccount.type, debit: 0, credit: 0 }; acc[c].debit += Number(l.debit); acc[c].credit += Number(l.credit); }
  return Object.values(acc).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ ...a, balance: (a.debit - a.credit) * SIGN[a.type] }));
}
async function trialBalance(range) {
  const rows = await accountBalances(range);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows: rows.filter((r) => r.debit || r.credit), totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}
async function balanceSheet(range) {
  const rows = await accountBalances(range);
  const sum = (t) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.balance, 0);
  const assets = sum('asset'), liabilities = sum('liability'), equityBase = sum('equity');
  const netIncome = sum('revenue') - sum('expense');
  const equity = equityBase + netIncome;   // retained earnings for the (yet-unclosed) period
  return { assets, liabilities, equity, equityBase, netIncome, balanced: assets === liabilities + equity };
}
// Finance receivables from the journal (Piutang Usaha balance) — MUST equal Σ customer Sisa Bon.
async function receivablesBalance(range) { const rows = await accountBalances(range); const ar = rows.find((r) => r.code === AR); return ar ? ar.balance : 0; }
async function incomeStatement(range) {
  const rows = await accountBalances(range);
  const revenue = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.balance, 0);
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
  return { revenue, expense, profit: revenue - expense, margin: revenue ? +(((revenue - expense) / revenue) * 100).toFixed(1) : 0, rows: rows.filter((r) => r.type === 'revenue' || r.type === 'expense') };
}

module.exports = {
  CHART, CAT_MAP, seedChart, chartMap, postJournal, postEntry, postTransfer, postDistExpense, postDistTransaction,
  backfill, unmappedCategories, categoryToCode, accountBalances, trialBalance, balanceSheet, receivablesBalance, incomeStatement,
};
