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
  ['2-3000', 'Uang Muka Pelanggan', 'liability', '2-0000'],   // customer credit balance (overpaid bon → not negative AR)
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
  ['6-7000', 'Beban Kerugian Piutang', 'expense', '6-0000'],   // bad-debt / dispute loss (kerugian) + write-offs
  ['6-9000', 'Beban Lain-lain', 'expense', '6-0000'],
];
const AR = '1-1200', KAS = '1-1000', BANK = '1-1100', PERSEDIAAN = '1-1300';
const REV_MAIN = '4-1000', REV_OTHER = '4-2000', EXP_OTHER = '6-9000';
const UANG_MUKA = '2-3000', LOSS_AR = '6-7000';   // customer-credit liability · bad-debt/dispute loss
const DISPUTE_DEDUCTS = ['tidak_diakui', 'kerugian'];   // mirror distribution.service DEDUCTS
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
// Remove a projected journal (used when a source no longer produces one — e.g. a customer's
// overpayment reclass that is no longer needed after further collection/backfill).
async function deleteJournal(sourceType, sourceId) {
  const existing = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId: sourceId || null } });
  if (existing) await prisma.journalEntry.delete({ where: { id: existing.id } });
}

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
// Distribution transaction → receivables, posting the EFFECTIVE figure so the Piutang balance equals
// Sisa Bon exactly (Part 3 receivables integration):
//   • lunas     → Dr Kas / Cr Pendapatan (cash sale, no receivable)
//   • pelunasan → Dr Kas / Cr Piutang (collection)
//   • bon       → Dr Piutang(effective) / Cr Pendapatan, where effective = amount + Σ price-corrections
//                 − capped disputes. A `tidak_diakui` dispute reverses revenue (Cr Pendapatan drops);
//                 a `kerugian` dispute is a company loss (Dr Beban Kerugian Piutang), revenue stays.
//                 Disputes are capped at the sale so the per-row receivable never goes below 0 — the
//                 exact per-bon floor customerBonBalance applies (max(0, amount + priceδ − dd)).
async function postDistTransaction(t, actor) {
  const f = t.fleetId || '';
  const base = { sourceType: 'dist_txn', sourceId: t.id, date: t.txnDate, description: `Distribusi ${t.method}`, actor, businessUnitId: t.businessUnitId || null };
  if (t.method === 'pelunasan') {
    const amt = n(t.amount); if (!amt) return null;
    return postJournal({ ...base, lines: [{ code: KAS, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }] });
  }
  if (t.method !== 'bon') {   // lunas — cash sale
    const amt = n(t.amount); if (!amt) return null;
    return postJournal({ ...base, lines: [{ code: KAS, debit: amt, fleetId: f }, { code: REV_MAIN, credit: amt, fleetId: f }] });
  }
  // bon — receivable at the effective figure
  const corrs = t.corrections || await prisma.correction.findMany({ where: { transactionId: t.id, kind: 'price', active: true }, select: { deltaAmount: true, kind: true, active: true } });
  const pdelta = (corrs || []).filter((c) => c.kind === 'price' && c.active).reduce((a, c) => a + Number(c.deltaAmount || 0), 0);
  const disputes = await prisma.distTransactionDispute.findMany({ where: { transactionId: t.id, status: { in: DISPUTE_DEDUCTS }, reversedById: null, reversalOf: null }, select: { status: true, disputedAmount: true } });
  let ddTidak = 0, ddRugi = 0;
  disputes.forEach((d) => { const a = Number(d.disputedAmount || 0); if (d.status === 'kerugian') ddRugi += a; else ddTidak += a; });
  const revenue = n(t.amount) + n(pdelta);          // amount + price corrections = revenue recognised
  let cap = Math.max(0, revenue);                    // cap total dispute at the sale (per-bon floor at 0)
  const tidak = Math.min(ddTidak, cap); cap -= tidak;
  const rugi = Math.min(ddRugi, cap);
  const arNet = revenue - tidak - rugi;              // = max(0, amount + priceδ − dd)
  if (arNet <= 0 && revenue <= 0) { await deleteJournal('dist_txn', t.id); return null; }
  const lines = [{ code: AR, debit: arNet, fleetId: f }, { code: REV_MAIN, credit: revenue - tidak, fleetId: f }];
  if (rugi > 0) lines.push({ code: LOSS_AR, debit: rugi, fleetId: f });   // debits: arNet + rugi = revenue − tidak = credit ✓
  return postJournal({ ...base, lines });
}

// Approved bon ADJUSTMENT (penyesuaian) → receivable. delta>0 recognises more receivable/income;
// delta<0 writes the receivable down (bad debt). Mirrors approvedBonDelta in customerBonBalance.
async function postDistAdjustment(a, actor) {
  const d = n(a.delta); if (!d) { await deleteJournal('dist_adjustment', a.id); return null; }
  const f = a.fleetId || '';
  const lines = d > 0
    ? [{ code: AR, debit: d, fleetId: f }, { code: REV_OTHER, credit: d, fleetId: f }]
    : [{ code: LOSS_AR, debit: -d, fleetId: f }, { code: AR, credit: -d, fleetId: f }];
  return postJournal({ sourceType: 'dist_adjustment', sourceId: a.id, date: (a.approvedAt ? new Date(a.approvedAt) : a.createdAt ? new Date(a.createdAt) : new Date(0)).toISOString().slice(0, 10), description: `Penyesuaian bon: ${a.reason}`, actor, lines });
}

// A customer's receivable BEFORE the final floor-at-zero: Σ effective bon − Σ pelunasan + Σ approved
// bon adjustments. This is exactly what the per-txn + adjustment journals net to for the customer, so
// when it is NEGATIVE (customer overpaid / holds a credit) the excess must move OFF Piutang into a
// customer-credit LIABILITY — otherwise the receivable would read negative. sisaBon = max(0, raw).
async function customerBonRaw(customerId) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId, status: { not: 'void' }, bonCounted: true, method: { in: ['bon', 'pelunasan'] } }, include: { corrections: { select: { deltaAmount: true, kind: true, active: true } } } });
  const ids = txns.map((t) => t.id);
  const disputes = ids.length ? await prisma.distTransactionDispute.findMany({ where: { transactionId: { in: ids }, status: { in: DISPUTE_DEDUCTS }, reversedById: null, reversalOf: null }, select: { transactionId: true, disputedAmount: true } }) : [];
  const dd = {}; disputes.forEach((d) => { dd[d.transactionId] = (dd[d.transactionId] || 0) + Number(d.disputedAmount || 0); });
  let bon = 0, pel = 0;
  for (const t of txns) {
    if (t.method === 'pelunasan') { pel += n(t.amount); continue; }
    const pdelta = (t.corrections || []).filter((c) => c.kind === 'price' && c.active).reduce((s, c) => s + Number(c.deltaAmount || 0), 0);
    bon += Math.max(0, n(t.amount) + n(pdelta) - (dd[t.id] || 0));
  }
  const adjRows = await prisma.distAdjustment.findMany({ where: { customerId, kind: 'bon', status: 'approved' }, select: { delta: true } });
  const adj = adjRows.reduce((s, r) => s + Number(r.delta), 0);
  return bon - pel + adj;
}

// Reclass a customer's overpayment (raw < 0) from Piutang to Uang Muka Pelanggan so the Piutang
// balance never goes below their true Sisa Bon. Idempotent per customer; removed once raw ≥ 0.
async function postReceivablesReclass(customerId, actor) {
  const raw = await customerBonRaw(customerId);
  if (raw >= 0) { await deleteJournal('ar_reclass', customerId); return false; }
  const over = -raw;
  const last = await prisma.distTransaction.findFirst({ where: { customerId, status: { not: 'void' }, method: { in: ['bon', 'pelunasan'] } }, orderBy: { txnDate: 'desc' }, select: { txnDate: true } });
  await postJournal({ sourceType: 'ar_reclass', sourceId: customerId, date: (last && last.txnDate) || '1970-01-01', description: 'Saldo kredit pelanggan (uang muka)', actor, lines: [{ code: AR, debit: over }, { code: UANG_MUKA, credit: over }] });
  return true;
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
  // RECEIVABLES (bon/pelunasan): a running BALANCE, so it is NOT date-limited — matches
  // customerBonBalance's inclusion exactly (non-void, bonCounted, INCLUDING legacy). Corrections and
  // disputes are folded into each bon's effective figure inside postDistTransaction.
  const arTxns = await prisma.distTransaction.findMany({ where: { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true }, include: { corrections: { select: { deltaAmount: true, kind: true, active: true } } } });
  for (const t of arTxns) { if (await postDistTransaction(t, actor)) out.dist_txn++; }
  // Cash sales (lunas) are a period FLOW → keep the fromDate window; active, non-legacy.
  const lunas = await prisma.distTransaction.findMany({ where: { method: 'lunas', status: 'active', legacy: false, ...(dGte ? { txnDate: dGte } : {}) } });
  for (const t of lunas) { if (await postDistTransaction(t, actor)) out.dist_txn++; }
  // Approved bon adjustments (penyesuaian) move the receivable up/down.
  const adjs = await prisma.distAdjustment.findMany({ where: { kind: 'bon', status: 'approved' } });
  out.dist_adjustment = 0;
  for (const a of adjs) { if (await postDistAdjustment(a, actor)) out.dist_adjustment++; }
  // Per-customer overpayment reclass (raw < 0 → Uang Muka Pelanggan) so Piutang == Σ Sisa Bon.
  const custIds = [...new Set([...arTxns.map((t) => t.customerId), ...adjs.map((a) => a.customerId)])];
  out.reclass = 0;
  for (const cid of custIds) { if (await postReceivablesReclass(cid, actor)) out.reclass++; }
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

// UMUR PIUTANG (AR aging). Standard FIFO: a customer's collections/write-downs pay their OLDEST bon
// first; whatever remains of each bon is aged by its date vs `asOf` into 0-30 / 31-60 / 61-90 / 90+.
// By construction Σ(all buckets) == Σ customer Sisa Bon == receivablesBalance — the same money, aged.
function agingBucket(date, asOf) {
  const days = Math.floor((new Date(asOf + 'T00:00') - new Date((date || asOf) + 'T00:00')) / 86400000);
  return days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90p';
}
async function agingReceivables({ asOf, fleetId, businessUnitId } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const where = { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true };
  if (fleetId) where.fleetId = fleetId;
  if (businessUnitId) where.businessUnitId = businessUnitId;
  const txns = await prisma.distTransaction.findMany({ where, include: { corrections: { select: { deltaAmount: true, kind: true, active: true } }, customer: { select: { id: true, name: true } } } });
  const ids = txns.map((t) => t.id);
  const disputes = ids.length ? await prisma.distTransactionDispute.findMany({ where: { transactionId: { in: ids }, status: { in: DISPUTE_DEDUCTS }, reversedById: null, reversalOf: null }, select: { transactionId: true, disputedAmount: true } }) : [];
  const dd = {}; disputes.forEach((d) => { dd[d.transactionId] = (dd[d.transactionId] || 0) + Number(d.disputedAmount || 0); });
  const byCust = {};
  const custOf = (id, name) => (byCust[id] || (byCust[id] = { customerId: id, name: name || '', bons: [], credit: 0 }));
  for (const t of txns) {
    const c = custOf(t.customerId, t.customer && t.customer.name);
    if (t.method === 'pelunasan') { c.credit += n(t.amount); continue; }
    const pd = (t.corrections || []).filter((x) => x.kind === 'price' && x.active).reduce((a, x) => a + Number(x.deltaAmount || 0), 0);
    const eff = Math.max(0, n(t.amount) + n(pd) - (dd[t.id] || 0));
    if (eff > 0) c.bons.push({ date: t.txnDate, eff });
  }
  const adjs = await prisma.distAdjustment.findMany({ where: { kind: 'bon', status: 'approved' }, select: { customerId: true, delta: true, approvedAt: true, createdAt: true } });
  for (const a of adjs) {
    const c = custOf(a.customerId); const d = Number(a.delta);
    if (d > 0) { const when = a.approvedAt || a.createdAt; c.bons.push({ date: when ? new Date(when).toISOString().slice(0, 10) : today, eff: d }); }
    else c.credit += -d;
  }
  const totals = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const rows = [];
  for (const c of Object.values(byCust)) {
    c.bons.sort((a, b) => (a.date || '').localeCompare(b.date || ''));   // oldest first — FIFO
    let credit = c.credit;
    const r = { customerId: c.customerId, name: c.name, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0, total: 0 };
    for (const b of c.bons) {
      let rem = b.eff;
      if (credit > 0) { const pay = Math.min(credit, rem); credit -= pay; rem -= pay; }
      if (rem > 0) { const bk = agingBucket(b.date, today); r[bk] += rem; r.total += rem; totals[bk] += rem; }
    }
    if (r.total > 0) rows.push(r);
  }
  rows.sort((a, b) => b.total - a.total);
  return { asOf: today, buckets: totals, total: totals.d0_30 + totals.d31_60 + totals.d61_90 + totals.d90p, rows };
}

// BUKU BESAR — one account's journal lines in date order with a RUNNING BALANCE (in the account's
// normal-balance direction). `opening` is the balance carried in before dateFrom; `closing` reconciles
// to accountBalances for that account. Each row keeps sourceType/sourceId for figure→journal→source.
async function generalLedger({ code, dateFrom, dateTo } = {}) {
  const acct = await prisma.chartAccount.findUnique({ where: { code } });
  if (!acct) return null;
  const sign = SIGN[acct.type];
  const openLines = dateFrom ? await prisma.journalLine.findMany({ where: { chartAccountId: acct.id, journalEntry: { date: { lt: dateFrom } } }, select: { debit: true, credit: true } }) : [];
  const opening = openLines.reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0) * sign;
  const dw = {}; if (dateFrom) dw.gte = dateFrom; if (dateTo) dw.lte = dateTo;
  const lines = await prisma.journalLine.findMany({ where: { chartAccountId: acct.id, ...(Object.keys(dw).length ? { journalEntry: { date: dw } } : {}) }, include: { journalEntry: { select: { date: true, ref: true, description: true, sourceType: true, sourceId: true } } } });
  lines.sort((a, b) => (a.journalEntry.date || '').localeCompare(b.journalEntry.date || '') || a.id.localeCompare(b.id));
  let bal = opening;
  const rows = lines.map((l) => { const dr = Number(l.debit), cr = Number(l.credit); bal += (dr - cr) * sign; return { date: l.journalEntry.date, ref: l.journalEntry.ref, description: l.journalEntry.description, sourceType: l.journalEntry.sourceType, sourceId: l.journalEntry.sourceId, debit: dr, credit: cr, balance: bal }; });
  return { account: { code: acct.code, name: acct.name, type: acct.type }, opening, rows, closing: bal };
}

module.exports = {
  CHART, CAT_MAP, seedChart, chartMap, postJournal, deleteJournal, postEntry, postTransfer, postDistExpense, postDistTransaction,
  postDistAdjustment, customerBonRaw, postReceivablesReclass, backfill, unmappedCategories, categoryToCode,
  accountBalances, trialBalance, balanceSheet, receivablesBalance, incomeStatement, agingReceivables, generalLedger,
};
