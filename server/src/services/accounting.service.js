'use strict';
// ══════════════ ACCOUNTING v2 — the ONE double-entry posting service ══════════════
// A LAYER on top of the cash book. It NEVER reads or writes Entry/Account/Category/DistTransaction as a
// source of truth — it only PROJECTS them into balanced journals. The cash book is unchanged, so every
// existing report stays byte-identical (proven in accounting-parity.test.js). Gated behind ACCOUNTING_V2.
//
// HARD INVARIANT (asserted on every post): sum(debit) === sum(credit) per journal entry.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { unitWhere } = require('../lib/scope');   // per-user business-unit access (mirrors report.service)

// ── SESSION SCOPE — a report read must NEVER exceed the caller's own business-unit / armada scope. A
// request-supplied businessUnitId/fleetId can only NARROW within this, never widen past the session's
// scope (the accounting-v2 reports previously trusted the query param, so a `reports` user scoped to one
// unit could read another unit's financials). Full-access users (scope null) are unaffected. ──
function fleetScopeArr(user) {
  const raw = user && user.fleetScope;
  if (raw == null || raw === 'all' || raw === '') return null;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const a = JSON.parse(raw); if (a === 'all') return null; if (Array.isArray(a)) return a.filter(Boolean); } catch (e) {}
  return null;
}
function scopeWhere(user) {
  if (!user) return {};
  const parts = [];
  const uw = unitWhere(user, 'businessUnitId');
  if (uw && Object.keys(uw).length) parts.push(uw);
  const fs = fleetScopeArr(user);
  if (fs) parts.push({ fleetId: { in: fs } });
  return parts.length ? { AND: parts } : {};
}
const andScope = (where, user) => { const s = scopeWhere(user); return Object.keys(s).length ? { AND: [where, s] } : where; };

// ── Indonesian SMB chart of accounts (seed). code · name · type · parent(code) · subtype. ──
// `subtype` drives the ARUS KAS (cash flow) classification (see CF_SECTION) — explicit + configurable
// here, never buried in report logic. 'cash' = the cash being explained; 'header' rows carry no lines.
const CHART = [
  ['1-0000', 'Aset', 'asset', '', 'header'],
  ['1-1000', 'Kas', 'asset', '1-0000', 'cash'],
  ['1-1100', 'Bank', 'asset', '1-0000', 'cash'],
  ['1-1200', 'Piutang Usaha', 'asset', '1-0000', 'receivable'],
  ['1-1250', 'Piutang Karyawan', 'asset', '1-0000', 'receivable'],   // employee advances (cashbon) — repaid via payroll
  ['1-1300', 'Persediaan Galon', 'asset', '1-0000', 'inventory'],
  ['1-1350', 'Persediaan Barang Jadi', 'asset', '1-0000', 'inventory'],   // finished RO water, valued at STANDARD cost
  ['1-1400', 'Peralatan', 'asset', '1-0000', 'fixed_asset'],
  ['1-1410', 'Kendaraan', 'asset', '1-0000', 'fixed_asset'],
  ['1-1420', 'Mesin & Peralatan Produksi', 'asset', '1-0000', 'fixed_asset'],   // RO machines etc. (production)
  ['1-1430', 'Bangunan', 'asset', '1-0000', 'fixed_asset'],
  ['1-1440', 'Galon (Aset Tetap)', 'asset', '1-0000', 'fixed_asset'],   // pooled gallon asset
  ['1-1900', 'Akumulasi Penyusutan', 'asset', '1-0000', 'accum_depreciation'],   // CONTRA-asset: reduces fixed assets to book value
  ['1-1500', 'PPN Masukan', 'asset', '1-0000', 'prepaid'],   // recoverable input VAT on a bill (Accounts Payable tax)
  ['1-1600', 'Beban Dibayar Di Muka', 'asset', '1-0000', 'prepaid'],   // prepaid expense — capitalised, amortised monthly
  ['2-0000', 'Kewajiban', 'liability', '', 'header'],
  ['2-1000', 'Utang Usaha', 'liability', '2-0000', 'payable'],
  ['2-2000', 'Utang Gaji', 'liability', '2-0000', 'payable'],
  ['2-2100', 'Utang Potongan Gaji', 'liability', '2-0000', 'payable'],   // deductions withheld (PPh 21 etc.) pending remittance
  ['2-3000', 'Uang Muka Pelanggan', 'liability', '2-0000', 'deferred_income'],   // customer credit balance (overpaid bon → not negative AR)
  ['2-4000', 'Beban Yang Masih Harus Dibayar', 'liability', '2-0000', 'accrued'],   // accrued expense (recognised before the bill arrives)
  ['3-0000', 'Ekuitas', 'equity', '', 'header'],
  ['3-1000', 'Modal', 'equity', '3-0000', 'capital'],
  ['3-2000', 'Laba Ditahan', 'equity', '3-0000', 'retained'],
  ['3-3000', 'Prive', 'equity', '3-0000', 'drawing'],
  ['4-0000', 'Pendapatan', 'revenue', '', 'header'],
  ['4-1000', 'Penjualan Air', 'revenue', '4-0000', 'revenue'],
  ['4-2000', 'Pendapatan Lain', 'revenue', '4-0000', 'revenue'],
  ['4-3000', 'Laba Pelepasan Aset', 'revenue', '4-0000', 'revenue'],   // gain on disposal of a fixed asset
  ['5-0000', 'Harga Pokok Penjualan', 'expense', '', 'header'],
  ['5-1000', 'HPP Galon', 'expense', '5-0000', 'cogs'],
  ['5-1500', 'HPP Tenaga Kerja Produksi', 'expense', '5-0000', 'cogs'],   // production-staff salaries → cost of goods (feeds costing)
  ['5-2000', 'Penyusutan Produksi (HPP)', 'expense', '5-0000', 'cogs'],   // depreciation of production assets → cost of goods
  // STANDARD-COSTING VARIANCE accounts — each difference posts to its OWN account (never absorbed
  // silently), rolls into COGS on the P&L (subtype cogs), and is closed to 5-1000 HPP at month-end.
  ['5-3100', 'Selisih Harga Bahan', 'expense', '5-0000', 'cogs'],
  ['5-3200', 'Selisih Kuantitas Bahan', 'expense', '5-0000', 'cogs'],
  ['5-3300', 'Selisih Tarif Tenaga Kerja', 'expense', '5-0000', 'cogs'],
  ['5-3400', 'Selisih Efisiensi Tenaga Kerja', 'expense', '5-0000', 'cogs'],
  ['5-3500', 'Selisih Pengeluaran Overhead', 'expense', '5-0000', 'cogs'],
  ['5-3600', 'Selisih Volume Overhead', 'expense', '5-0000', 'cogs'],
  ['6-0000', 'Beban Operasional', 'expense', '', 'header'],
  ['6-1000', 'Beban Gaji', 'expense', '6-0000', 'expense'],
  ['6-2000', 'Beban BBM & Pengiriman', 'expense', '6-0000', 'expense'],
  ['6-3000', 'Beban Perlengkapan', 'expense', '6-0000', 'expense'],
  ['6-4000', 'Beban Pemeliharaan', 'expense', '6-0000', 'expense'],
  ['6-5000', 'Beban Utilitas', 'expense', '6-0000', 'expense'],
  ['6-6000', 'Beban Sewa', 'expense', '6-0000', 'expense'],
  ['6-7000', 'Beban Kerugian Piutang', 'expense', '6-0000', 'expense'],   // bad-debt / dispute loss (kerugian) + write-offs
  ['6-8000', 'Beban Penyusutan', 'expense', '6-0000', 'expense'],   // depreciation of NON-production (operating) assets
  ['6-8500', 'Rugi Pelepasan/Kerusakan Aset', 'expense', '6-0000', 'expense'],   // loss on disposal + rusak/hilang gallon-pool write-off
  ['6-9000', 'Beban Lain-lain', 'expense', '6-0000', 'expense'],
];
// ARUS KAS classification — subtype → section. Explicit + configurable. An account whose subtype is not
// here (and isn't 'cash'/'header') is REPORTED as unclassified, never silently folded into Operasi.
const CF_SECTION = {
  cash: 'cash', header: 'header',
  receivable: 'operasi', inventory: 'operasi', prepaid: 'operasi', payable: 'operasi', accrued: 'operasi', deferred_income: 'operasi', revenue: 'operasi', expense: 'operasi', cogs: 'operasi',
  fixed_asset: 'investasi',
  // Accumulated depreciation is a CONTRA-asset whose only movement is the non-cash depreciation charge.
  // Classifying it under OPERASI turns the indirect method into the textbook "add depreciation back":
  // net income already carries the depreciation EXPENSE (−), and this contra account's period change
  // adds the same amount back (+), netting the non-cash item to zero cash effect. Reconciles exactly.
  accum_depreciation: 'operasi',
  capital: 'pendanaan', retained: 'pendanaan', drawing: 'pendanaan',
};
const CF_INCOME_SUBTYPES = new Set(['revenue', 'expense', 'cogs']);   // the accounts that make up "laba bersih"
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
const categoryToCode = (cat, type) => (CAT_MAP[type] && CAT_MAP[type][cat]) || null;   // null = unmapped (built-in only)
// Runtime overrides (CategoryMapping table) layered OVER the built-in CAT_MAP. Loaded per posting run.
async function categoryOverrides(db = prisma) {
  const rows = await db.categoryMapping.findMany({ select: { categoryKey: true, type: true, chartCode: true } });
  const m = { income: {}, expense: {} };
  rows.forEach((r) => { (m[r.type] || (m[r.type] = {}))[r.categoryKey] = r.chartCode; });
  return m;
}
// Effective account code for a category: an admin override wins, else the built-in default, else null
// (unmapped → the caller falls back to REV_OTHER/EXP_OTHER and it is surfaced by unmappedCategories).
async function resolveCategoryCode(cat, type, db = prisma) {
  if (cat == null || cat === '') return null;
  const ov = await db.categoryMapping.findUnique({ where: { categoryKey_type: { categoryKey: String(cat), type } }, select: { chartCode: true } }).catch(() => null);
  return (ov && ov.chartCode) || categoryToCode(cat, type);
}
const acctCode = (acct) => (/^(cash|tunai|kas)$/i.test(String(acct || '')) ? KAS : BANK);
const n = (v) => Math.round(Number(v) || 0);

async function seedChart(db = prisma) {
  for (let i = 0; i < CHART.length; i++) {
    const [code, name, type, parent, subtype] = CHART[i];
    const existing = await db.chartAccount.findUnique({ where: { code } });
    if (!existing) await db.chartAccount.create({ data: { code, name, type, subtype: subtype || '', sortOrder: i, businessUnitId: null } });
    else if ((existing.subtype || '') !== (subtype || '')) await db.chartAccount.update({ where: { code }, data: { subtype: subtype || '' } });   // backfill subtype on rows seeded before cash-flow
  }
  // fill parentId now that all rows exist (kept loose to avoid seeding-order FK issues)
  const rows = await db.chartAccount.findMany({ select: { id: true, code: true } });
  const byCode = {}; rows.forEach((r) => { byCode[r.code] = r.id; });
  for (const [code, , , parent] of CHART) { if (parent && byCode[parent]) await db.chartAccount.update({ where: { code }, data: { parentId: byCode[parent] } }); }
  return byCode;
}
async function chartMap(db = prisma) { const rows = await db.chartAccount.findMany({ select: { id: true, code: true } }); const m = {}; rows.forEach((r) => { m[r.code] = r.id; }); return m; }
// Remove a projected journal (used only where a projection is genuinely MUTABLE — the per-customer
// overpayment reclass, whose figure changes as the balance moves. Immutable source journals are never
// deleted; corrections/voids append a reversing entry instead — see reconcileDistTxn / reverseJournal).
async function deleteJournal(sourceType, sourceId, db = prisma) {
  const existing = await db.journalEntry.findFirst({ where: { sourceType, sourceId: sourceId || null } });
  if (existing) await db.journalEntry.delete({ where: { id: existing.id } });
}

// The single balanced-journal writer. `lines` = [{ code, debit?, credit?, businessUnitId?, fleetId? }].
// `db` is the prisma client OR a caller's interactive-transaction client, so a journal can be written
// in the SAME transaction as its source record (LIVE posting) — a source can never exist without its
// journal, and a rollback drops both. Defaults to the module client for standalone use (backfill).
//
// IDEMPOTENCY: a source posts EXACTLY ONCE. If a journal for (sourceType, sourceId) already exists we
// return it unchanged — so re-running backfill never duplicates, and a repeated live post is a no-op
// (belt-and-suspenders behind the @@unique([sourceType, sourceId]) constraint). Immutable by default;
// pass `replace:true` ONLY for a genuinely mutable projection (the AR reclass) to overwrite in place.
async function postJournal({ sourceType, sourceId, date, ref, description, actor, businessUnitId, reversalOf, lines, replace }, db = prisma) {
  const debit = lines.reduce((a, l) => a + n(l.debit), 0);
  const credit = lines.reduce((a, l) => a + n(l.credit), 0);
  if (debit !== credit) throw new Error(`Journal not balanced (${sourceType}:${sourceId}): debit ${debit} != credit ${credit}`);   // HARD INVARIANT — fail the write, never warn
  let cm = await chartMap(db);
  // SELF-HEAL: the chart of accounts is reference data usually seeded at boot, but if a live post runs
  // before that (flag flipped without a restart, a fresh test), seed it in THIS transaction so posting
  // never fails for a missing account. Idempotent; only ever does real work once.
  if (lines.some((l) => !cm[l.code])) { await seedChart(db); cm = await chartMap(db); }
  for (const l of lines) if (!cm[l.code]) throw new Error(`Unknown account code ${l.code} (${sourceType}:${sourceId})`);
  if (sourceId != null) {
    const existing = await db.journalEntry.findFirst({ where: { sourceType, sourceId }, select: { id: true } });
    // Already posted → do nothing and return null (NOT the existing entry), so callers that count
    // "newly posted" (backfill) see a true no-op on a re-run. `replace` overwrites (the mutable reclass).
    if (existing) { if (!replace) return null; await db.journalEntry.delete({ where: { id: existing.id } }); }
  }
  try {
    return await db.journalEntry.create({ data: {
      sourceType, sourceId: sourceId || null, date, ref: ref || '', description: (description || '').slice(0, 500), reversalOf: reversalOf || null,
      postedById: (actor && actor.id) || null, postedByName: (actor && actor.name) || null,
      lines: { create: lines.filter((l) => n(l.debit) || n(l.credit)).map((l) => ({ chartAccountId: cm[l.code], debit: BigInt(n(l.debit)), credit: BigInt(n(l.credit)), businessUnitId: l.businessUnitId || businessUnitId || null, fleetId: l.fleetId || '' })) },
    } });
  } catch (e) {
    // Idempotency is enforced by the DB, not just the findFirst above: the UNIQUE (sourceType, sourceId)
    // index makes a concurrent/retried post of the SAME source lose the race here. Treat that as a no-op
    // (already posted) so a source can NEVER post twice — this is what the check-then-create alone could
    // not guarantee. Only swallow the uniqueness collision; every other error still fails the write.
    const uniqueClash = e && (e.code === 'P2002' || /unique/i.test(String(e.message || '')));
    if (uniqueClash && sourceId != null && !replace) return null;
    throw e;
  }
}

// Append a REVERSING entry for an existing source's journal — swap each line's debit/credit, link via
// reversalOf, never touch the original. Balanced by construction (the swap of a balanced entry is
// balanced). Idempotent on (reversalSourceType, reversalSourceId). Used for a plain full reversal.
async function reverseJournal({ sourceType, sourceId, reversalSourceType, reversalSourceId, date, description, actor }, db = prisma) {
  const orig = await db.journalEntry.findFirst({ where: { sourceType, sourceId }, include: { lines: true } });
  if (!orig) return null;
  const already = await db.journalEntry.findFirst({ where: { sourceType: reversalSourceType, sourceId: reversalSourceId }, select: { id: true } });
  if (already) return already;
  return db.journalEntry.create({ data: {
    sourceType: reversalSourceType, sourceId: reversalSourceId, date, ref: orig.ref || '', description: (description || '').slice(0, 500), reversalOf: orig.id,
    postedById: (actor && actor.id) || null, postedByName: (actor && actor.name) || null,
    lines: { create: orig.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: l.credit, credit: l.debit, businessUnitId: l.businessUnitId || null, fleetId: l.fleetId || '' })) },
  } });
}

// ── Per-source posters — each PROJECTS one source record into a balanced journal. All take an
// optional `db` (the caller's transaction client) so the journal posts in the SAME transaction. ──
async function postEntry(e, actor, db = prisma) {
  const amt = n(e.amount); if (!amt) return null;
  const cash = acctCode(e.acct); const bu = e.businessUnitId || null;
  let lines;
  if (e.type === 'income') lines = [{ code: cash, debit: amt }, { code: (await resolveCategoryCode(e.category, 'income', db)) || REV_OTHER, credit: amt }];
  else if (e.gallonQty > 0 || /pembelian\s*galon/i.test(e.note || '')) lines = [{ code: PERSEDIAAN, debit: amt }, { code: cash, credit: amt }];   // gallon purchase → INVENTORY, not expense
  else lines = [{ code: (await resolveCategoryCode(e.category, 'expense', db)) || EXP_OTHER, debit: amt }, { code: cash, credit: amt }];
  return postJournal({ sourceType: 'entry', sourceId: e.id, date: e.date, description: e.note, actor, businessUnitId: bu, lines }, db);
}
async function postTransfer(t, actor, db = prisma) {
  const amt = n(t.amount); if (!amt) return null;
  const [from, to] = await Promise.all([db.account.findUnique({ where: { id: t.fromId } }), db.account.findUnique({ where: { id: t.toId } })]);
  const code = (a) => (a && a.type === 'cash' ? KAS : BANK);
  return postJournal({ sourceType: 'transfer', sourceId: t.id, date: t.date, description: t.note || 'Transfer', actor, lines: [{ code: code(to), debit: amt }, { code: code(from), credit: amt }] }, db);
}
async function postDistExpense(x, actor, db = prisma) {
  const amt = n(x.amount); if (!amt) return null;
  return postJournal({ sourceType: 'dist_expense', sourceId: x.id, date: x.date, description: 'Pengeluaran lapangan', actor, lines: [{ code: DIST_EXP_MAP[x.category] || EXP_OTHER, debit: amt, fleetId: x.fleetId || '' }, { code: KAS, credit: amt, fleetId: x.fleetId || '' }] }, db);
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
// The lines a distribution transaction PROJECTS to at its CURRENT effective figure (or [] when it
// nets to nothing — e.g. a void, or a fully-disputed bon). Pure projection; no writes.
//   • lunas     → Dr Kas / Cr Pendapatan (cash sale, no receivable)
//   • pelunasan → Dr Kas / Cr Piutang (collection)
//   • bon       → Dr Piutang(effective) / Cr Pendapatan, effective = amount + Σ price-corrections
//                 − capped disputes; a `kerugian` dispute is a company loss (Dr Beban Kerugian Piutang),
//                 a `tidak_diakui` reverses revenue. Capped at the sale (per-bon floor at 0).
// STANDARD cost per galon in force on `date` (via the caller's db client, so it reads inside the same
// transaction and never cycles back into costing.service). 0 = no active standard → HPP-on-sale is a
// no-op, so the cash book is untouched until product costing is set up.
async function standardPerUnitViaDb(date, db = prisma) {
  const d = String(date || '');
  const rows = await db.costStandard.findMany({ where: { productId: 'galon-19l', status: 'aktif', effectiveFrom: { lte: d } }, orderBy: { effectiveFrom: 'desc' } }).catch(() => []);
  const s = (rows || []).find((x) => !x.effectiveTo || x.effectiveTo >= d);
  if (!s) return 0;
  const lines = await db.costStandardLine.findMany({ where: { standardId: s.id } });
  return lines.reduce((sum, l) => sum + Math.round(Number(l.qtyPerUnit || 0) * Number(l.unitCost || 0)), 0);
}
// HPP ON SALE (standard costing): a gallon sale consumes finished-goods inventory at STANDARD cost —
// Dr HPP (5-1000) / Cr Persediaan Barang Jadi (1-1350). Self-balancing, so it rides in the sale journal.
async function hppOnSaleLines(t, db) {
  if (t.openingBon) return [];
  const qty = n(t.qty); if (qty <= 0) return [];
  const std = await standardPerUnitViaDb(t.txnDate, db);
  if (!std) return [];
  const amt = std * qty; const f = t.fleetId || '';
  return [{ code: '5-1000', debit: amt, fleetId: f }, { code: '1-1350', credit: amt, fleetId: f }];
}
// The AR projection obeys the SAME predicate as Sisa Bon (BON_TXN in distribution.service.js): a
// bon/pelunasan is a receivable IFF status!=void AND bonCounted. So a row archived to bonCounted=false
// (or voided) posts NO Piutang — reconcileDistTxn on that transition reverses whatever was posted. NOTE
// bonCounted is meaningless for a LUNAS cash sale (Dr Kas / Cr Pendapatan, no receivable), so the guard
// lives inside the bon/pelunasan branches only — never suppressing a lunas sale.
async function distTxnLines(t, db = prisma) {
  if (t.status === 'void') return [];
  const f = t.fleetId || '';
  if (t.method === 'pelunasan') {
    if (!t.bonCounted) return [];   // pelunasan excluded from sisa bon → no AR movement
    const amt = n(t.amount); if (!amt) return [];
    // PAYMENT NOT RECEIVED: the customer paid (their bon drops → Cr Piutang) but the money never
    // reached the company — a staff took it — so it is a LOSS (Dr Beban Kerugian Piutang), never cash.
    // This keeps accounting cash == the cash book (which also excludes it) while Piutang still falls,
    // so Piutang == Σ Sisa Bon holds (customerBonRaw counts a PNR row as an ordinary pelunasan).
    if (t.paymentNotReceived) return [{ code: LOSS_AR, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }];
    return [{ code: KAS, debit: amt, fleetId: f }, { code: AR, credit: amt, fleetId: f }];
  }
  if (t.method !== 'bon') { const amt = n(t.amount); if (!amt) return []; return [{ code: KAS, debit: amt, fleetId: f }, { code: REV_MAIN, credit: amt, fleetId: f }, ...(await hppOnSaleLines(t, db))]; }
  if (!t.bonCounted) return [];   // bon excluded from sisa bon (archived/mistaken) → no Piutang
  const corrs = t.corrections || await db.correction.findMany({ where: { transactionId: t.id, kind: 'price', active: true }, select: { deltaAmount: true, kind: true, active: true } });
  const pdelta = (corrs || []).filter((c) => c.kind === 'price' && c.active).reduce((a, c) => a + Number(c.deltaAmount || 0), 0);
  const disputes = await db.distTransactionDispute.findMany({ where: { transactionId: t.id, status: { in: DISPUTE_DEDUCTS }, reversedById: null, reversalOf: null }, select: { status: true, disputedAmount: true } });
  let ddTidak = 0, ddRugi = 0;
  disputes.forEach((d) => { const a = Number(d.disputedAmount || 0); if (d.status === 'kerugian') ddRugi += a; else ddTidak += a; });
  const revenue = n(t.amount) + n(pdelta);
  let cap = Math.max(0, revenue);
  const tidak = Math.min(ddTidak, cap); cap -= tidak;
  const rugi = Math.min(ddRugi, cap);
  const arNet = revenue - tidak - rugi;
  if (arNet <= 0 && revenue <= 0) return [];
  const lines = [{ code: AR, debit: arNet, fleetId: f }, { code: REV_MAIN, credit: revenue - tidak, fleetId: f }];
  if (rugi > 0) lines.push({ code: LOSS_AR, debit: rugi, fleetId: f });   // debits arNet + rugi = revenue − tidak = credit ✓
  return [...lines, ...(await hppOnSaleLines(t, db))];   // HPP on sale at standard (no-op without an active standard)
}
// LIVE post / backfill of a distribution transaction — INSERT-only under (dist_txn, id). At creation
// there are no corrections/disputes yet, so this is the original figure; for a historical backfill it
// is the effective figure (corrections already folded in). Later mutations do NOT re-post here (that
// would no-op on the idempotency guard) — they APPEND an adjusting entry via reconcileDistTxn.
async function postDistTransaction(t, actor, db = prisma) {
  const lines = await distTxnLines(t, db);
  if (!lines.length) return null;
  return postJournal({ sourceType: 'dist_txn', sourceId: t.id, date: t.txnDate, description: `Distribusi ${t.method}`, actor, businessUnitId: t.businessUnitId || null, lines }, db);
}
// APPEND-ONLY reconciliation for a mutated transaction (correction approved, void applied, dispute
// decided). Computes the DELTA between where the txn's journals currently sit (its original 'dist_txn'
// entry + any prior 'dist_txn_adj' entries) and where they SHOULD sit (distTxnLines of the current
// row), and posts that delta as a new adjusting entry — never editing or deleting the original. A void
// yields desired=[] so the delta fully reverses it; an already-reconciled txn posts nothing. Balanced
// by construction (both sides net to zero, so the delta does too). `eventKey` makes it idempotent per
// event (the correction id, 'void', or dispute id).
async function reconcileDistTxn(t, eventKey, actor, db = prisma) {
  const cm = await chartMap(db);
  const idToCode = {}; Object.entries(cm).forEach(([c, id]) => { idToCode[id] = c; });
  const desired = await distTxnLines(t, db);
  const entries = await db.journalEntry.findMany({ where: { OR: [{ sourceType: 'dist_txn', sourceId: t.id }, { sourceType: 'dist_txn_adj', ref: t.id }] }, include: { lines: true } });
  const orig = entries.find((e) => e.sourceType === 'dist_txn');
  // GUARD (the "adjustment posted the FULL amount" bug): an adjustment reconciles a txn AGAINST its
  // original journal. If that original was never posted — the txn was created while posting was OFF, then
  // corrected/voided BEFORE the backfill posted it — there is no baseline, so delta-from-zero would post
  // the FULL amount and DOUBLE-COUNT once the backfill later posts the original. Establish the original
  // from the CURRENT row instead (idempotent → the backfill then no-ops) and append NO adjustment: the
  // fresh original already carries the new figure. A void/archived row projects to [] so this is a no-op.
  if (!orig) { await postDistTransaction(t, actor, db); return null; }
  const posted = {}; entries.forEach((e) => e.lines.forEach((l) => { const c = idToCode[l.chartAccountId]; if (c) posted[c] = (posted[c] || 0) + Number(l.debit) - Number(l.credit); }));
  const want = {}; desired.forEach((l) => { want[l.code] = (want[l.code] || 0) + n(l.debit) - n(l.credit); });
  const f = t.fleetId || '';
  const lines = [];
  new Set([...Object.keys(posted), ...Object.keys(want)]).forEach((c) => { const d = (want[c] || 0) - (posted[c] || 0); if (d > 0) lines.push({ code: c, debit: d, fleetId: f }); else if (d < 0) lines.push({ code: c, credit: -d, fleetId: f }); });
  if (!lines.length) return null;   // already reconciled — nothing to append
  return postJournal({ sourceType: 'dist_txn_adj', sourceId: `${t.id}:${eventKey}`, ref: t.id, date: t.txnDate, description: `Penyesuaian jurnal (${eventKey})`, actor, reversalOf: orig ? orig.id : null, lines }, db);
}

// Approved bon ADJUSTMENT (penyesuaian) → receivable. delta>0 recognises more receivable/income;
// delta<0 writes the receivable down (bad debt). Mirrors approvedBonDelta in customerBonBalance.
async function postDistAdjustment(a, actor, db = prisma) {
  const d = n(a.delta); if (!d) return null;
  const f = a.fleetId || '';
  const lines = d > 0
    ? [{ code: AR, debit: d, fleetId: f }, { code: REV_OTHER, credit: d, fleetId: f }]
    : [{ code: LOSS_AR, debit: -d, fleetId: f }, { code: AR, credit: -d, fleetId: f }];
  return postJournal({ sourceType: 'dist_adjustment', sourceId: a.id, date: (a.approvedAt ? new Date(a.approvedAt) : a.createdAt ? new Date(a.createdAt) : new Date(0)).toISOString().slice(0, 10), description: `Penyesuaian bon: ${a.reason}`, actor, lines }, db);
}

// A customer's receivable BEFORE the final floor-at-zero: Σ effective bon − Σ pelunasan + Σ approved
// bon adjustments. This is exactly what the per-txn + adjustment journals net to for the customer, so
// when it is NEGATIVE (customer overpaid / holds a credit) the excess must move OFF Piutang into a
// customer-credit LIABILITY — otherwise the receivable would read negative. sisaBon = max(0, raw).
async function customerBonRaw(customerId, db = prisma) {
  const txns = await db.distTransaction.findMany({ where: { customerId, status: { not: 'void' }, bonCounted: true, method: { in: ['bon', 'pelunasan'] } }, include: { corrections: { select: { deltaAmount: true, kind: true, active: true } } } });
  const ids = txns.map((t) => t.id);
  const disputes = ids.length ? await db.distTransactionDispute.findMany({ where: { transactionId: { in: ids }, status: { in: DISPUTE_DEDUCTS }, reversedById: null, reversalOf: null }, select: { transactionId: true, disputedAmount: true } }) : [];
  const dd = {}; disputes.forEach((d) => { dd[d.transactionId] = (dd[d.transactionId] || 0) + Number(d.disputedAmount || 0); });
  let bon = 0, pel = 0;
  for (const t of txns) {
    if (t.method === 'pelunasan') { pel += n(t.amount); continue; }
    const pdelta = (t.corrections || []).filter((c) => c.kind === 'price' && c.active).reduce((s, c) => s + Number(c.deltaAmount || 0), 0);
    bon += Math.max(0, n(t.amount) + n(pdelta) - (dd[t.id] || 0));
  }
  const adjRows = await db.distAdjustment.findMany({ where: { customerId, kind: 'bon', status: 'approved' }, select: { delta: true } });
  const adj = adjRows.reduce((s, r) => s + Number(r.delta), 0);
  return bon - pel + adj;
}

// Reclass a customer's overpayment (raw < 0) from Piutang to Uang Muka Pelanggan so the Piutang
// balance never goes below their true Sisa Bon. This is the ONE genuinely MUTABLE projection (the
// credit shrinks/grows as the balance moves), so it posts with replace:true. Called after every write
// that changes a customer's receivable, in that write's transaction, so Piutang == Σ Sisa Bon always.
async function postReceivablesReclass(customerId, actor, db = prisma) {
  const raw = await customerBonRaw(customerId, db);
  if (raw >= 0) { await deleteJournal('ar_reclass', customerId, db); return false; }
  const over = -raw;
  const last = await db.distTransaction.findFirst({ where: { customerId, status: { not: 'void' }, method: { in: ['bon', 'pelunasan'] } }, orderBy: { txnDate: 'desc' }, select: { txnDate: true } });
  await postJournal({ sourceType: 'ar_reclass', sourceId: customerId, date: (last && last.txnDate) || '1970-01-01', description: 'Saldo kredit pelanggan (uang muka)', actor, replace: true, lines: [{ code: AR, debit: over }, { code: UANG_MUKA, credit: over }] }, db);
  return true;
}

// ── BACKFILL — a ONE-TIME migration that projects existing records into journals (ADDITIVE; source
// rows untouched). Live posting keeps new sources journalled, so this only fills the pre-flag history.
// It is STREAMED + CHUNKED + IDEMPOTENT so a large dataset can't time out or duplicate:
//   • idempotent — postJournal is skip-if-exists behind @@unique([sourceType, sourceId]); an
//     interrupted run is simply RE-RUN and continues where it stopped (never a duplicate);
//   • streamed — each source table is paged by id cursor, so the whole table never loads into memory;
//   • chunked — each page is one transaction; if a page fails, it retries source-by-source to isolate
//     the bad row instead of aborting the whole run;
//   • async — startBackfillJob returns a jobId immediately and the work runs in the background (below),
//     so nginx never waits on the long write. The old blocking path is what returned 502.
const BACKFILL_CHUNK = 200;

// Total sources to examine — cheap COUNTs, drives the progress bar. Never loads rows.
async function computeBackfillTotal({ fromDate } = {}) {
  const dGte = fromDate ? { gte: fromDate } : undefined;
  const [entry, transfer, ar, lunas, adj, exp] = await Promise.all([
    prisma.entry.count({ where: { status: { not: 'Failed' }, ...(dGte ? { date: dGte } : {}) } }),
    prisma.transfer.count({ where: dGte ? { date: dGte } : {} }),
    prisma.distTransaction.count({ where: { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true } }),
    prisma.distTransaction.count({ where: { method: 'lunas', status: 'active', legacy: false, ...(dGte ? { txnDate: dGte } : {}) } }),
    prisma.distAdjustment.count({ where: { kind: 'bon', status: 'approved' } }),
    prisma.distExpense.count({ where: { status: 'active', ...(dGte ? { date: dGte } : {}) } }),
  ]);
  const reclass = (await reclassCustomerIds()).length;
  return { entry, transfer, dist_txn: ar + lunas, ar, lunas, dist_adjustment: adj, reclass, dist_expense: exp, total: entry + transfer + ar + lunas + adj + reclass + exp };
}
// Distinct customers whose receivable might need a credit reclass (bon/pelunasan or approved bon adj).
async function reclassCustomerIds() {
  const [a, b] = await Promise.all([
    prisma.distTransaction.findMany({ where: { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true }, select: { customerId: true }, distinct: ['customerId'] }),
    prisma.distAdjustment.findMany({ where: { kind: 'bon', status: 'approved' }, select: { customerId: true }, distinct: ['customerId'] }),
  ]);
  return [...new Set([...a.map((r) => r.customerId), ...b.map((r) => r.customerId)])];
}

// DRY-RUN preview — what a run WOULD create per source type, writing nothing and never timing out
// (cheap counts only, no per-source poster work). ≈ sources minus what is already journalled per type.
async function backfillPreview({ fromDate } = {}) {
  await seedChart();
  const t = await computeBackfillTotal({ fromDate });
  const grouped = await prisma.journalEntry.groupBy({ by: ['sourceType'], _count: { _all: true } });
  const have = {}; grouped.forEach((g) => { have[g.sourceType] = g._count._all; });
  const rem = (n, type) => Math.max(0, (n || 0) - (have[type] || 0));
  return { dryRun: true,
    entry: rem(t.entry, 'entry'), transfer: rem(t.transfer, 'transfer'),
    dist_txn: Math.max(0, t.dist_txn - (have.dist_txn || 0)),
    dist_adjustment: rem(t.dist_adjustment, 'dist_adjustment'), dist_expense: rem(t.dist_expense, 'dist_expense'),
    reclass: rem(t.reclass, 'ar_reclass'), total: t.total };
}

// Stream a model id-ordered in chunks; post each (idempotent). Page = one transaction; on page failure,
// retry each source alone so one bad row is isolated. onChunk(seen, posted, failed, errs) → progress.
async function backfillStream({ fetchPage, postOne, onChunk }) {
  let cursor = null;
  for (;;) {
    const rows = await fetchPage(cursor, BACKFILL_CHUNK);
    if (!rows.length) break;
    let posted = 0, failed = 0; const errs = [];
    try {
      await prisma.$transaction(async (tx) => { for (const r of rows) { if (await postOne(r, tx)) posted++; } }, { timeout: 120000 });
    } catch (chunkErr) {
      posted = 0;   // the whole page rolled back — replay it source-by-source to find the bad one
      for (const r of rows) {
        try { if (await prisma.$transaction((tx) => postOne(r, tx), { timeout: 30000 })) posted++; }
        catch (e) { failed++; if (errs.length < 50) errs.push({ id: r.id, message: String((e && e.message) || e).slice(0, 200) }); }
      }
    }
    cursor = rows[rows.length - 1].id;
    if (onChunk) await onChunk(rows.length, posted, failed, errs);
    if (rows.length < BACKFILL_CHUNK) break;
  }
}

// The streamed worker. onProgress(seen, posted, failed) fires once per chunk so a job row can be
// updated. Returns per-type posted counts + failures. Used by the sync `backfill` and the async job.
async function runBackfillStreamed({ fromDate, actor, onProgress } = {}) {
  await seedChart();
  const dGte = fromDate ? { gte: fromDate } : undefined;
  const out = { entry: 0, transfer: 0, dist_txn: 0, dist_adjustment: 0, reclass: 0, dist_expense: 0, failed: 0, errors: [] };
  const bump = async (type, seen, posted, failed, errs) => {
    out[type] += posted; out.failed += failed;
    if (errs && errs.length) out.errors.push(...errs.slice(0, Math.max(0, 50 - out.errors.length)).map((e) => ({ sourceType: type, sourceId: e.id, message: e.message })));
    if (onProgress) await onProgress(seen, posted, failed);
  };
  const page = (model, where, extra) => (cursor, take) => prisma[model].findMany({ where, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take, ...(extra || {}) });

  await backfillStream({ fetchPage: page('entry', { status: { not: 'Failed' }, ...(dGte ? { date: dGte } : {}) }), postOne: (r, tx) => postEntry(r, actor, tx), onChunk: (s, p, f, e) => bump('entry', s, p, f, e) });
  await backfillStream({ fetchPage: page('transfer', dGte ? { date: dGte } : {}), postOne: (r, tx) => postTransfer(r, actor, tx), onChunk: (s, p, f, e) => bump('transfer', s, p, f, e) });
  // Receivables (bon/pelunasan): a running BALANCE, so NOT date-limited — corrections/disputes are
  // folded into each bon's effective figure inside postDistTransaction.
  await backfillStream({ fetchPage: page('distTransaction', { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true }, { include: { corrections: { select: { deltaAmount: true, kind: true, active: true } } } }), postOne: (r, tx) => postDistTransaction(r, actor, tx), onChunk: (s, p, f, e) => bump('dist_txn', s, p, f, e) });
  await backfillStream({ fetchPage: page('distTransaction', { method: 'lunas', status: 'active', legacy: false, ...(dGte ? { txnDate: dGte } : {}) }), postOne: (r, tx) => postDistTransaction(r, actor, tx), onChunk: (s, p, f, e) => bump('dist_txn', s, p, f, e) });
  await backfillStream({ fetchPage: page('distAdjustment', { kind: 'bon', status: 'approved' }), postOne: (r, tx) => postDistAdjustment(r, actor, tx), onChunk: (s, p, f, e) => bump('dist_adjustment', s, p, f, e) });
  // Per-customer overpayment reclass (raw < 0 → Uang Muka Pelanggan) so Piutang == Σ Sisa Bon. Chunked.
  const custIds = await reclassCustomerIds();
  for (let i = 0; i < custIds.length; i += BACKFILL_CHUNK) {
    const slice = custIds.slice(i, i + BACKFILL_CHUNK);
    let posted = 0, failed = 0; const errs = [];
    try { await prisma.$transaction(async (tx) => { for (const cid of slice) { if (await postReceivablesReclass(cid, actor, tx)) posted++; } }, { timeout: 120000 }); }
    catch (e) { posted = 0; for (const cid of slice) { try { if (await prisma.$transaction((tx) => postReceivablesReclass(cid, actor, tx))) posted++; } catch (er) { failed++; if (errs.length < 50) errs.push({ id: cid, message: String((er && er.message) || er).slice(0, 200) }); } } }
    await bump('reclass', slice.length, posted, failed, errs);
  }
  await backfillStream({ fetchPage: page('distExpense', { status: 'active', ...(dGte ? { date: dGte } : {}) }), postOne: (r, tx) => postDistExpense(r, actor, tx), onChunk: (s, p, f, e) => bump('dist_expense', s, p, f, e) });
  return out;
}

// Public entry: dry-run → fast preview; otherwise the streamed run (synchronous — used by tests + the
// async job worker). The HTTP endpoint uses startBackfillJob instead so it returns immediately.
async function backfill({ fromDate, actor, dryRun } = {}) {
  if (dryRun) return backfillPreview({ fromDate });
  return runBackfillStreamed({ fromDate, actor });
}

// ── ASYNC JOB ── create a BackfillJob row, launch the streamed run in the background, return the id.
async function startBackfillJob({ fromDate, actor } = {}) {
  await seedChart();
  const t = await computeBackfillTotal({ fromDate });
  const job = await prisma.backfillJob.create({ data: { status: 'running', fromDate: fromDate || null, total: t.total, startedById: (actor && actor.id) || null, startedByName: (actor && actor.name) || null } });
  setImmediate(() => { runBackfillJob(job.id, { fromDate, actor }).catch(() => {}); });   // fire-and-forget
  return { jobId: job.id, total: t.total };
}
// The background worker: stream the run, update the job each chunk, then run the integrity check + trial
// balance so the finished job reports whether the books are sound.
async function runBackfillJob(jobId, { fromDate, actor } = {}) {
  try {
    let processed = 0;
    const res = await runBackfillStreamed({ fromDate, actor, onProgress: async (seen, posted, failed) => {
      processed += seen;
      await prisma.backfillJob.update({ where: { id: jobId }, data: { processed, posted: { increment: posted }, failed: { increment: failed } } }).catch(() => {});
    } });
    const integrity = await integrityCheck({ fromDate }).catch(() => ({ ok: null, missingCount: null, orphanCount: null }));
    let trialBalanced = null; try { trialBalanced = (await trialBalance()).balanced === true; } catch (e) { /* empty ledger */ }
    await prisma.backfillJob.update({ where: { id: jobId }, data: {
      status: 'done', finishedAt: new Date(), errors: JSON.stringify((res.errors || []).slice(0, 50)),
      result: JSON.stringify({ counts: { entry: res.entry, transfer: res.transfer, dist_txn: res.dist_txn, dist_adjustment: res.dist_adjustment, reclass: res.reclass, dist_expense: res.dist_expense }, failed: res.failed, integrity: { ok: integrity.ok, missing: integrity.missingCount, orphan: integrity.orphanCount }, trialBalanced }),
    } });
  } catch (e) {
    await prisma.backfillJob.update({ where: { id: jobId }, data: { status: 'failed', finishedAt: new Date(), errors: JSON.stringify([{ message: String((e && e.message) || e).slice(0, 300) }]) } }).catch(() => {});
  }
}
async function backfillJobStatus(jobId) {
  const j = await prisma.backfillJob.findUnique({ where: { id: jobId } });
  if (!j) return null;
  let errors = []; try { errors = JSON.parse(j.errors || '[]'); } catch (e) {}
  let result = null; try { result = j.result ? JSON.parse(j.result) : null; } catch (e) {}
  return { jobId: j.id, status: j.status, total: j.total, processed: j.processed, posted: j.posted, failed: j.failed, startedByName: j.startedByName || null, startedAt: j.startedAt, finishedAt: j.finishedAt, errors, result };
}

// DRIFT DETECTOR — the source↔journal integrity check surfaced in Tutup Buku + a dedicated card.
// Returns sources that SHOULD have a journal but don't (missing), and journals whose source row is
// gone (orphan). With live posting both lists should always be empty; anything here is real drift.
async function integrityCheck({ fromDate } = {}) {
  const dGte = fromDate ? { gte: fromDate } : undefined;
  const has = async (sourceType, sourceId) => !!(await prisma.journalEntry.findFirst({ where: { sourceType, sourceId }, select: { id: true } }));
  const missing = [];
  const entries = await prisma.entry.findMany({ where: { status: { not: 'Failed' }, ...(dGte ? { date: dGte } : {}) }, select: { id: true, note: true, date: true, amount: true } });
  for (const e of entries) if (n(e.amount) && !(await has('entry', e.id))) missing.push({ sourceType: 'entry', sourceId: e.id, date: e.date, label: e.note || 'Transaksi kas' });
  const transfers = await prisma.transfer.findMany({ where: dGte ? { date: dGte } : {}, select: { id: true, date: true, amount: true } });
  for (const t of transfers) if (n(t.amount) && !(await has('transfer', t.id))) missing.push({ sourceType: 'transfer', sourceId: t.id, date: t.date, label: 'Transfer' });
  const exps = await prisma.distExpense.findMany({ where: { status: 'active', ...(dGte ? { date: dGte } : {}) }, select: { id: true, date: true, amount: true } });
  for (const x of exps) if (n(x.amount) && !(await has('dist_expense', x.id))) missing.push({ sourceType: 'dist_expense', sourceId: x.id, date: x.date, label: 'Pengeluaran lapangan' });
  // Distribution txns that PROJECT a non-empty journal but have none (skip those that net to nothing).
  const dtx = await prisma.distTransaction.findMany({ where: { status: { not: 'void' }, OR: [{ method: { in: ['bon', 'pelunasan'] }, bonCounted: true }, { method: 'lunas', legacy: false }] }, include: { corrections: { select: { deltaAmount: true, kind: true, active: true } } } });
  for (const t of dtx) { if ((await distTxnLines(t)).length && !(await has('dist_txn', t.id))) missing.push({ sourceType: 'dist_txn', sourceId: t.id, date: t.txnDate, label: `Distribusi ${t.method}` }); }
  // Orphan journals: sourceId present but the source row no longer exists (for the types we can check).
  const orphan = [];
  const journ = await prisma.journalEntry.findMany({ where: { sourceId: { not: null } }, select: { id: true, sourceType: true, sourceId: true, date: true } });
  const existsById = { entry: (id) => prisma.entry.findUnique({ where: { id }, select: { id: true } }), transfer: (id) => prisma.transfer.findUnique({ where: { id }, select: { id: true } }), dist_expense: (id) => prisma.distExpense.findUnique({ where: { id }, select: { id: true } }), dist_txn: (id) => prisma.distTransaction.findUnique({ where: { id }, select: { id: true } }), dist_adjustment: (id) => prisma.distAdjustment.findUnique({ where: { id }, select: { id: true } }) };
  for (const j of journ) {
    const chk = existsById[j.sourceType]; if (!chk) continue;   // synthetic types (ar_reclass, dist_txn_adj:*) — not row-backed
    if (!(await chk(j.sourceId))) orphan.push({ sourceType: j.sourceType, sourceId: j.sourceId, journalId: j.id, date: j.date });
  }
  // DUPLICATE journals: a (sourceType, sourceId) must be UNIQUE — one journal per source (idempotency).
  // More than one LIVE entry = a source POSTED TWICE, invisible to the missing/orphan checks above
  // because they test EXISTENCE, not CARDINALITY. This is the gap that let a double-posted transaction
  // inflate AR. An extra that has been NEUTRALISED by a 'dup_reversal' entry no longer counts, so the
  // reverse-duplicate-journals remediation clears this check without hard-deleting anything.
  const duplicate = [];
  // An extra NEUTRALISED by a 'dup_reversal' no longer counts (the remediation clears these checks
  // without hard-deleting). Computed once — both classes below honour it.
  const reversed = new Set((await prisma.journalEntry.findMany({ where: { sourceType: 'dup_reversal', reversalOf: { not: null } }, select: { reversalOf: true } })).map((r) => r.reversalOf));
  // (1) CARDINALITY — the same (sourceType, sourceId) posted more than once. reverseIds keeps the
  // earliest and neutralises the rest.
  const groups = await prisma.journalEntry.groupBy({ by: ['sourceType', 'sourceId'], where: { sourceId: { not: null } }, _count: { _all: true } });
  for (const g of groups.filter((x) => (x._count._all || 0) > 1)) {
    const rows = await prisma.journalEntry.findMany({ where: { sourceType: g.sourceType, sourceId: g.sourceId }, select: { id: true, date: true, postedAt: true }, orderBy: { postedAt: 'asc' } });
    const live = rows.filter((r) => !reversed.has(r.id));
    if (live.length > 1) duplicate.push({ type: 'cardinality', sourceType: g.sourceType, sourceId: g.sourceId, count: live.length, date: live[0] && live[0].date, entryIds: live.map((r) => r.id), reverseIds: live.slice(1).map((r) => r.id) });
  }
  // (2) FULL-AMOUNT ADJUSTMENT — the REAL defect is precise: a dist_txn_adj that reconciled with NO
  // baseline (reversalOf = null) and posted the parent BON's FULL AR amount instead of the delta, so it
  // double-counts once the original is posted. The signature is exact — reversalOf null AND a NON-ZERO AR
  // effect that EQUALS the parent bon's amount. Everything else with reversalOf=null is EXPECTED and must
  // NOT fail the invariant: a LUNAS parent never touches AR (its adj posts Kas/Pendapatan, AR = 0), and a
  // zero-AR adjustment moves no receivable. Those are counted informationally (baselineless) so the one
  // real overstatement is never buried among harmless rows — the noise that cost several rounds.
  const arAcc = (await chartMap())['1-1200'];
  let baselinelessAdj = 0;   // reversalOf=null dist_txn_adj that are NOT the defect (lunas / zero-AR) — informational only
  const noBaseAdjs = await prisma.journalEntry.findMany({ where: { sourceType: 'dist_txn_adj', reversalOf: null }, include: { lines: { where: { chartAccountId: arAcc } } } });
  if (noBaseAdjs.length) {
    const parents = Object.fromEntries((await prisma.distTransaction.findMany({ where: { id: { in: noBaseAdjs.map((e) => e.ref).filter(Boolean) } }, select: { id: true, amount: true, method: true } })).map((t) => [t.id, t]));
    for (const e of noBaseAdjs) {
      if (reversed.has(e.id)) continue;
      const arNet = e.lines.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
      const p = parents[e.ref];
      const isDefect = arNet !== 0 && p && p.method === 'bon' && Math.round(Math.abs(arNet)) === Math.round(Number(p.amount));
      if (isDefect) duplicate.push({ type: 'full_amount_adj', sourceType: 'dist_txn_adj', sourceId: e.sourceId, ref: e.ref, count: 1, date: e.date, entryIds: [e.id], reverseIds: [e.id], arNet, parentAmount: Number(p.amount) });
      else baselinelessAdj++;
    }
  }
  return { ok: missing.length === 0 && orphan.length === 0 && duplicate.length === 0, missing, orphan, duplicate, missingCount: missing.length, orphanCount: orphan.length, duplicateCount: duplicate.length, baselinelessAdjustments: baselinelessAdj };
}

// Category keys used by entries that have NO chart mapping — REPORTED so an admin fixes the map
// rather than the code guessing. (They still post to REV_OTHER/EXP_OTHER so journals stay balanced.)
async function unmappedCategories() {
  const grouped = await prisma.entry.groupBy({ by: ['category', 'type'], where: { status: { not: 'Failed' }, category: { not: null } }, _count: { _all: true } });
  const ov = await categoryOverrides();
  // Unmapped = a category resolved by NEITHER an admin override NOR a built-in default.
  return grouped.filter((g) => g.category && !((ov[g.type] && ov[g.type][g.category]) || categoryToCode(g.category, g.type)))
    .map((g) => ({ category: g.category, type: g.type, count: (g._count && g._count._all) || 0 }));
}

// POSTABLE accounts (leaf, non-header) grouped for the mapping picker: income categories map to a
// revenue account, expense categories to an expense/COGS account.
async function postableAccounts() {
  const rows = await prisma.chartAccount.findMany({ where: { subtype: { not: 'header' } }, select: { code: true, name: true, type: true }, orderBy: { sortOrder: 'asc' } });
  return {
    income: rows.filter((r) => r.type === 'revenue'),
    expense: rows.filter((r) => r.type === 'expense'),
  };
}

// Category → account mapping management for the "Pemetaan Akun" screen.
//  • list: every category seen on an entry, its EFFECTIVE account (override › default › unmapped), the
//    source (custom/default/none), and the postable-account options for the picker.
async function listCategoryMappings() {
  const grouped = await prisma.entry.groupBy({ by: ['category', 'type'], where: { status: { not: 'Failed' }, category: { not: null } }, _count: { _all: true } });
  const overrides = await prisma.categoryMapping.findMany({ select: { categoryKey: true, type: true, chartCode: true } });
  const ovMap = {}; overrides.forEach((o) => { ovMap[o.type + ' ' + o.categoryKey] = o.chartCode; });
  const accounts = await postableAccounts();
  const nameOf = {}; [...accounts.income, ...accounts.expense].forEach((a) => { nameOf[a.code] = a.name; });
  const items = grouped.filter((g) => g.category).map((g) => {
    const override = ovMap[g.type + ' ' + g.category] || null;
    const def = categoryToCode(g.category, g.type);
    const code = override || def || null;
    return { category: g.category, type: g.type, count: (g._count && g._count._all) || 0, code, name: code ? (nameOf[code] || code) : null,
      source: override ? 'custom' : (def ? 'default' : 'none') };
  }).sort((a, b) => (a.source === 'none' ? -1 : 1) - (b.source === 'none' ? -1 : 1) || a.type.localeCompare(b.type) || String(a.category).localeCompare(String(b.category)));
  return { items, accounts, unmappedCount: items.filter((i) => i.source === 'none').length };
}
async function setCategoryMapping({ categoryKey, type, chartCode }, actor) {
  const key = String(categoryKey || '').trim(); const t = type === 'income' ? 'income' : 'expense';
  if (!key) throw ApiError.badRequest('Kategori wajib diisi.');
  const acct = await prisma.chartAccount.findUnique({ where: { code: String(chartCode || '') } });
  if (!acct) throw ApiError.badRequest('Akun tidak ditemukan.');
  if ((acct.subtype || '') === 'header') throw ApiError.badRequest('Pilih akun rincian, bukan akun induk.');
  // Keep the sides sane: income (a credit) maps to revenue, expense (a debit) to an expense/COGS account.
  const okType = t === 'income' ? acct.type === 'revenue' : (acct.type === 'expense');
  if (!okType) throw ApiError.badRequest(t === 'income' ? 'Pemasukan harus dipetakan ke akun Pendapatan.' : 'Pengeluaran harus dipetakan ke akun Beban/HPP.');
  const row = await prisma.categoryMapping.upsert({
    where: { categoryKey_type: { categoryKey: key, type: t } },
    update: { chartCode: acct.code, createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null },
    create: { categoryKey: key, type: t, chartCode: acct.code, createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null },
  });
  return { categoryKey: row.categoryKey, type: row.type, chartCode: row.chartCode, name: acct.name };
}
async function clearCategoryMapping({ categoryKey, type }) {
  const t = type === 'income' ? 'income' : 'expense';
  await prisma.categoryMapping.deleteMany({ where: { categoryKey: String(categoryKey || ''), type: t } });   // reverts to the built-in default (or unmapped)
  return { cleared: true };
}

// One roll-up that powers the "Alur Kerja" workflow panel + every report screen's header line: when
// journals were last posted, whether the books balance, drift/unmapped/unreconciled counts, and
// whether the month BEFORE `asOf` (the one that should be closed) is closed.
async function accountingStatus({ asOf } = {}) {
  const [last, journalCount, integrity, unmapped] = await Promise.all([
    prisma.journalEntry.findFirst({ orderBy: { postedAt: 'desc' }, select: { postedAt: true } }),
    prisma.journalEntry.count(),
    integrityCheck(),
    unmappedCategories(),
  ]);
  let unreconciled = 0, trialBalanced = true;
  try { unreconciled = (await require('./reconciliation.service').unreconciledBankTotal()).count || 0; } catch (e) { /* bank rec optional */ }
  try { trialBalanced = (await trialBalance()).balanced === true; } catch (e) { /* empty ledger balances */ }
  let priorMonth = null, priorClosed = false;
  const base = /^\d{4}-\d{2}/.test(String(asOf || '')) ? String(asOf) : null;
  if (base) {
    const y = +base.slice(0, 4), m = +base.slice(5, 7);
    const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    priorMonth = `${pm.y}-${String(pm.m).padStart(2, '0')}`;
    const per = await prisma.accountingPeriod.findUnique({ where: { periodKey: priorMonth }, select: { status: true } }).catch(() => null);
    priorClosed = !!(per && (per.status === 'ditutup' || per.status === 'terkunci'));
  }
  // Subscription reminders (for the AlertBell) — active subs whose next cycle is within their remindDays.
  // Computed inline (not via subscription.service) to avoid a require cycle. Best-effort.
  let subsRemind = 0, subsRemindTotal = 0;
  try {
    const t = base || new Date().toISOString().slice(0, 10);
    const addD = (d, k) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + (k | 0)); return dt.toISOString().slice(0, 10); };
    const subs = await prisma.subscription.findMany({ where: { status: 'aktif' }, select: { nextRunDate: true, remindDays: true, amount: true, tax: true } });
    subs.forEach((s) => { if (s.nextRunDate <= addD(t, s.remindDays != null ? s.remindDays : 3)) { subsRemind++; subsRemindTotal += Number(s.amount) + Number(s.tax); } });
  } catch (e) { /* subscriptions optional */ }
  return {
    lastPostedAt: last ? last.postedAt : null, journalCount, trialBalanced,
    integrity: { ok: integrity.ok, missing: integrity.missingCount, orphan: integrity.orphanCount },
    unmappedCount: unmapped.length, unreconciled, priorMonth, priorClosed, subsRemind, subsRemindTotal,
  };
}

// ── Reports (read the journal, never the cash book). ──
const SIGN = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 };   // normal-balance sign for (debit − credit)
async function accountBalances({ dateFrom, dateTo, businessUnitId, fleetId, user } = {}) {
  const jWhere = {};
  if (dateFrom) (jWhere.date || (jWhere.date = {})).gte = dateFrom;
  if (dateTo) (jWhere.date || (jWhere.date = {})).lte = dateTo;
  const where = {};
  if (businessUnitId) where.businessUnitId = businessUnitId;   // per-unit filter (journal lines carry the unit)
  if (fleetId) where.fleetId = fleetId;                        // per-armada filter
  if (Object.keys(jWhere).length) where.journalEntry = jWhere;
  const lines = await prisma.journalLine.findMany({ where: andScope(where, user), select: { debit: true, credit: true, chartAccount: { select: { code: true, name: true, type: true, subtype: true } } } });
  const acc = {};
  for (const l of lines) { const c = l.chartAccount.code; if (!acc[c]) acc[c] = { code: c, name: l.chartAccount.name, type: l.chartAccount.type, subtype: l.chartAccount.subtype || '', debit: 0, credit: 0 }; acc[c].debit += Number(l.debit); acc[c].credit += Number(l.credit); }
  return Object.values(acc).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ ...a, balance: ((a.debit - a.credit) * SIGN[a.type]) || 0 }));   // `|| 0` normalises -0 → 0
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
  const of = (t) => rows.filter((r) => r.type === t && r.balance).map((r) => ({ code: r.code, name: r.name, balance: r.balance }));
  const assets = sum('asset'), liabilities = sum('liability'), equityBase = sum('equity');
  const netIncome = sum('revenue') - sum('expense');
  const equity = equityBase + netIncome;   // retained earnings for the (yet-unclosed) period
  // Grouped per-account rows so the client renders authoritative figures with NO client-side recompute.
  return { assets, liabilities, equity, equityBase, netIncome, balanced: assets === liabilities + equity,
    assetRows: of('asset'), liabilityRows: of('liability'), equityRows: of('equity') };
}
// Finance receivables from the journal (Piutang Usaha balance) — MUST equal Σ customer Sisa Bon.
async function receivablesBalance(range) { const rows = await accountBalances(range); const ar = rows.find((r) => r.code === AR); return ar ? ar.balance : 0; }
async function incomeStatement(range) {
  const rows = await accountBalances(range);
  const revenue = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.balance, 0);
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
  // HPP (cost of goods) is the cogs-subtype slice of expense — the standard-costing module's period HPP
  // reads the SAME accounts, so the two agree by construction (asserted in the costing tests).
  const hpp = rows.filter((r) => r.subtype === 'cogs').reduce((s, r) => s + r.balance, 0);
  const opex = expense - hpp;
  const of = (pred) => rows.filter(pred).filter((r) => r.balance).map((r) => ({ code: r.code, name: r.name, balance: r.balance }));
  // Grouped rows (revenue · HPP=cogs · opex=non-cogs expense) so the client renders server figures directly.
  return { revenue, expense, hpp, opex, grossProfit: revenue - hpp, profit: revenue - expense, margin: revenue ? +(((revenue - expense) / revenue) * 100).toFixed(1) : 0,
    rows: rows.filter((r) => r.type === 'revenue' || r.type === 'expense'),
    revenueRows: of((r) => r.type === 'revenue'), hppRows: of((r) => r.type === 'expense' && r.subtype === 'cogs'), opexRows: of((r) => r.type === 'expense' && r.subtype !== 'cogs') };
}

// UMUR PIUTANG (AR aging). Standard FIFO: a customer's collections/write-downs pay their OLDEST bon
// first; whatever remains of each bon is aged by its date vs `asOf` into 0-30 / 31-60 / 61-90 / 90+.
// By construction Σ(all buckets) == Σ customer Sisa Bon == receivablesBalance — the same money, aged.
function agingBucket(date, asOf) {
  const days = Math.floor((new Date(asOf + 'T00:00') - new Date((date || asOf) + 'T00:00')) / 86400000);
  return days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90p';
}
async function agingReceivables({ asOf, fleetId, businessUnitId, user } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const where = { method: { in: ['bon', 'pelunasan'] }, status: { not: 'void' }, bonCounted: true };
  if (fleetId) where.fleetId = fleetId;
  if (businessUnitId) where.businessUnitId = businessUnitId;
  const txns = await prisma.distTransaction.findMany({ where: andScope(where, user), include: { corrections: { select: { deltaAmount: true, kind: true, active: true } }, customer: { select: { id: true, name: true } } } });
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
async function generalLedger({ code, dateFrom, dateTo, businessUnitId, fleetId, user } = {}) {
  const acct = await prisma.chartAccount.findUnique({ where: { code } });
  if (!acct) return null;
  const sign = SIGN[acct.type];
  const scope = {}; if (businessUnitId) scope.businessUnitId = businessUnitId; if (fleetId) scope.fleetId = fleetId;   // unit/armada filters
  const openLines = dateFrom ? await prisma.journalLine.findMany({ where: andScope({ chartAccountId: acct.id, ...scope, journalEntry: { date: { lt: dateFrom } } }, user), select: { debit: true, credit: true } }) : [];
  const opening = openLines.reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0) * sign;
  const dw = {}; if (dateFrom) dw.gte = dateFrom; if (dateTo) dw.lte = dateTo;
  const lines = await prisma.journalLine.findMany({ where: andScope({ chartAccountId: acct.id, ...scope, ...(Object.keys(dw).length ? { journalEntry: { date: dw } } : {}) }, user), include: { journalEntry: { select: { id: true, date: true, ref: true, description: true, sourceType: true, sourceId: true } } } });
  lines.sort((a, b) => (a.journalEntry.date || '').localeCompare(b.journalEntry.date || '') || a.id.localeCompare(b.id));
  let bal = opening;
  // journalId is the always-present tracing handle — the Buku Besar "Jurnal" column shows ref when the
  // source set one, else the short journal id (a ledger must never render a permanently empty column).
  const rows = lines.map((l) => { const dr = Number(l.debit), cr = Number(l.credit); bal += (dr - cr) * sign; return { date: l.journalEntry.date, journalId: l.journalEntry.id, ref: l.journalEntry.ref, description: l.journalEntry.description, sourceType: l.journalEntry.sourceType, sourceId: l.journalEntry.sourceId, debit: dr, credit: cr, balance: bal }; });
  return { account: { code: acct.code, name: acct.name, type: acct.type }, opening, rows, closing: bal };
}

// The full BALANCED journal a ledger line belongs to (both Dr and Cr sides), for figure → journal →
// source drill-down. Read-only. `ref` carries the source record so the UI can point at the Entry /
// DistTransaction / Setoran the projection came from.
async function journalFor({ sourceType, sourceId } = {}) {
  const je = await prisma.journalEntry.findFirst({ where: { sourceType, sourceId: sourceId || null }, include: { lines: { include: { chartAccount: { select: { code: true, name: true } } } } } });
  if (!je) return null;
  return {
    id: je.id, date: je.date, ref: je.ref, description: je.description, sourceType: je.sourceType, sourceId: je.sourceId,
    postedByName: je.postedByName || null, postedAt: je.postedAt || null,
    lines: je.lines.map((l) => ({ code: l.chartAccount.code, name: l.chartAccount.name, debit: Number(l.debit), credit: Number(l.credit) })),
  };
}

// JURNAL — a chronological list of posted journal entries in a period (read-only; the "Jurnal" tab in
// Laporan). Scoped by unit/armada like every other report (a line carries the unit; an entry is listed if
// it has ≥1 line in the caller's scope, and its `amount` is the Σ debit of those in-scope lines). No figure
// is computed here that isn't already in the ledger — it is a different *view* of the same journal lines.
async function journalList({ dateFrom, dateTo, businessUnitId, fleetId, user, limit } = {}) {
  const jw = {};
  if (dateFrom) (jw.date || (jw.date = {})).gte = dateFrom;
  if (dateTo) (jw.date || (jw.date = {})).lte = dateTo;
  const uw = {};
  if (businessUnitId) uw.businessUnitId = businessUnitId;
  if (fleetId) uw.fleetId = fleetId;
  const where = andScope({ ...uw, ...(Object.keys(jw).length ? { journalEntry: jw } : {}) }, user);
  const lines = await prisma.journalLine.findMany({ where, select: { debit: true, journalEntry: { select: { id: true, date: true, ref: true, description: true, sourceType: true, sourceId: true } } } });
  const m = {};
  for (const l of lines) { const je = l.journalEntry; const e = m[je.id] || (m[je.id] = { id: je.id, date: je.date, ref: je.ref || '', description: je.description || '', sourceType: je.sourceType, sourceId: je.sourceId, amount: 0 }); e.amount += Number(l.debit); }
  const rows = Object.values(m).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)));
  return { rows: rows.slice(0, limit || 500), count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0) };
}

// ARUS KAS (cash flow statement) — INDIRECT method, computed from the journal. Chosen over a
// transaction-by-transaction direct build because the identity Δcash = −Σ Δ(non-cash accounts) holds
// on any balanced ledger, so summing each non-cash account's period change and negating it gives the
// cash effect EXACTLY — kas awal + arus kas bersih == kas akhir by construction, no drift. It naturally
// produces the indirect layout: revenue/expense roll up to laba bersih; receivable/inventory/payable
// changes are working-capital adjustments (a credit sale nets to zero until collected). Sections come
// from the ChartAccount subtype (CF_SECTION); an unclassified account with movement is reported in its
// own bucket (still counted, so the statement always reconciles) rather than hidden inside Operasi.
async function cashFlow({ dateFrom, dateTo, businessUnitId, fleetId, user } = {}) {
  const lw = {};
  if (businessUnitId) lw.businessUnitId = businessUnitId;
  if (fleetId) lw.fleetId = fleetId;
  const rawMap = async (dateCond) => {
    const lines = await prisma.journalLine.findMany({ where: andScope({ ...lw, ...(dateCond ? { journalEntry: { date: dateCond } } : {}) }, user), select: { debit: true, credit: true, chartAccount: { select: { code: true, name: true, subtype: true } } } });
    const m = {};
    for (const l of lines) { const a = l.chartAccount; (m[a.code] || (m[a.code] = { code: a.code, name: a.name, subtype: a.subtype || '', raw: 0 })).raw += Number(l.debit) - Number(l.credit); }
    return m;
  };
  const endMap = await rawMap(dateTo ? { lte: dateTo } : undefined);
  const startMap = dateFrom ? await rawMap({ lt: dateFrom }) : {};
  const buckets = { operasi: [], investasi: [], pendanaan: [], unclassified: [] };
  let kasAwal = 0, kasAkhir = 0, netIncome = 0;
  for (const code of new Set([...Object.keys(endMap), ...Object.keys(startMap)])) {
    const info = endMap[code] || startMap[code];
    const startRaw = startMap[code] ? startMap[code].raw : 0;
    const endRaw = endMap[code] ? endMap[code].raw : 0;
    const section = CF_SECTION[info.subtype] || 'unclassified';
    if (section === 'cash') { kasAwal += startRaw; kasAkhir += endRaw; continue; }   // the cash being explained
    if (section === 'header') continue;
    const delta = endRaw - startRaw;
    if (delta === 0) continue;
    const amount = -delta;   // indirect identity: an account's cash-flow effect is minus its raw change
    if (CF_INCOME_SUBTYPES.has(info.subtype)) netIncome += amount;
    buckets[section].push({ code: info.code, name: info.name, subtype: info.subtype, amount });
  }
  const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
  const operasiTotal = sum(buckets.operasi), investasiTotal = sum(buckets.investasi), pendanaanTotal = sum(buckets.pendanaan), unclassifiedTotal = sum(buckets.unclassified);
  const netFlow = operasiTotal + investasiTotal + pendanaanTotal + unclassifiedTotal;
  return {
    range: { dateFrom: dateFrom || null, dateTo: dateTo || null },
    kasAwal, kasAkhir,
    operasi: { netIncome, workingCapital: buckets.operasi.filter((r) => !CF_INCOME_SUBTYPES.has(r.subtype)), incomeItems: buckets.operasi.filter((r) => CF_INCOME_SUBTYPES.has(r.subtype)), rows: buckets.operasi, total: operasiTotal },
    investasi: { rows: buckets.investasi, total: investasiTotal },
    pendanaan: { rows: buckets.pendanaan, total: pendanaanTotal },
    unclassified: buckets.unclassified,   // accounts with movement but no cash-flow section — fix the subtype
    netFlow,
    reconciles: kasAwal + netFlow === kasAkhir,
    reconciliation: { kasAwal, netFlow, kasAkhir, diff: kasAkhir - (kasAwal + netFlow) },
  };
}

// Full chart of accounts (all rows, incl. zero-activity headers) for the Buku Besar account picker /
// hierarchy. Read-only projection of ChartAccount — no business logic.
async function chart() {
  return prisma.chartAccount.findMany({ select: { id: true, code: true, name: true, type: true, subtype: true, parentId: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } });
}

module.exports = {
  CHART, CF_SECTION, CAT_MAP, seedChart, chartMap, chart, postJournal, reverseJournal, deleteJournal, postEntry, postTransfer, postDistExpense, postDistTransaction,
  distTxnLines, reconcileDistTxn, postDistAdjustment, customerBonRaw, postReceivablesReclass, backfill, startBackfillJob, runBackfillJob, backfillJobStatus, computeBackfillTotal, integrityCheck, unmappedCategories, categoryToCode, resolveCategoryCode,
  listCategoryMappings, setCategoryMapping, clearCategoryMapping, postableAccounts, accountingStatus,
  accountBalances, trialBalance, balanceSheet, receivablesBalance, incomeStatement, agingReceivables, generalLedger, journalFor, journalList, cashFlow,
};
