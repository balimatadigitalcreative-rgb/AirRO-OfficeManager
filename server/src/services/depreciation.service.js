'use strict';
// FIXED ASSETS & DEPRECIATION on the double-entry engine (gated on ACCOUNTING_V2). An asset is
// CAPITALISED at registration (Dr asset · Cr funding, default Modal 3-1000 for opening balances), then
// DEPRECIATED monthly (Dr Beban Penyusutan / Cr Akumulasi Penyusutan) over usefulLifeMonths, floored at
// salvageValue. isProduction routes the charge to a COGS account instead of opex (explicit per asset).
// Disposal removes cost + accumulated and books the gain/loss. A pooled gallon asset covers a quantity
// reconciled to the gallon ledger. Useful lives + methods are the OWNER's accounting estimates — NOT
// hardcoded fiscal classes; tax depreciation may differ (see the visible note on the UI).
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const acc = require('./accounting.service');
const period = require('./period.service');
const { unitWhere } = require('../lib/scope');   // per-user business-unit access (assets carry unit + fleet)
// Confine an asset `where` to the SESSION user's units. query businessUnitId/fleetId stay filters only.
const withUnitScope = (where, user) => { const uw = unitWhere(user, 'businessUnitId'); return uw && Object.keys(uw).length ? { AND: [where, uw] } : where; };

const ACCUM = '1-1900', DEPR_OPEX = '6-8000', DEPR_COGS = '5-2000', GAIN = '4-3000', LOSS = '6-8500', MODAL = '3-1000', BANK = '1-1100';
const CATEGORY_ASSET = { kendaraan: '1-1410', mesin_ro: '1-1420', bangunan: '1-1430', galon: '1-1440', peralatan: '1-1400', lainnya: '1-1400' };
const CATEGORIES = ['kendaraan', 'mesin_ro', 'peralatan', 'galon', 'bangunan', 'lainnya'];
const METHODS = ['garis_lurus', 'saldo_menurun'];
const STATUSES = ['aktif', 'dijual', 'dilepas', 'rusak'];

const n = (v) => Math.round(Number(v) || 0);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const ym = (d) => String(d || '').slice(0, 7);
const firstOf = (yearMonth) => yearMonth + '-01';
const addMonths = (yearMonth, k) => { let [y, m] = yearMonth.split('-').map(Number); m += (k | 0); y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return `${y}-${String(m).padStart(2, '0')}`; };
const monthsBetween = (a, b) => { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
const daysInMonth = (date) => { const [y, m] = String(date).split('-').map(Number); return new Date(y, m, 0).getDate(); };
const todayISO = () => new Date().toISOString().slice(0, 10);

// First-month policy: 'full' (a full month's charge in the acquisition month) or 'prorata' (by days).
// Configurable — NOT left implicit. Default 'full' (simplest; common for monthly books).
async function firstMonthPolicy() {
  try { const s = await require('./settings.service').get('depreciation'); return (s && s.firstMonth === 'prorata') ? 'prorata' : 'full'; }
  catch (e) { return 'full'; }
}

// ── THE DEPRECIATION SCHEDULE — the single source for register figures, the detail schedule, posting,
// and the close-blocker count. Returns [{ index, period, charge, bookValueBefore, bookValueAfter }].
// Straight-line: even (cost−salvage)/life; declining: double-declining rate 2/life on book value. Both
// FLOOR at salvage (book value never goes below it) and STOP once salvage is reached.
function buildSchedule(asset, policy) {
  const cost = n(asset.acquisitionCost), salvage = Math.min(n(asset.salvageValue), n(asset.acquisitionCost)), life = Math.max(1, asset.usefulLifeMonths | 0);
  const startYM = ym(asset.acquisitionDate);
  const day = Number(String(asset.acquisitionDate).slice(8, 10)) || 1;
  const dim = daysInMonth(asset.acquisitionDate);
  const firstFrac = policy === 'prorata' ? (dim - day + 1) / dim : 1;
  const depreciable = Math.max(0, cost - salvage);
  const slBase = Math.round(depreciable / life);
  const ddbRate = 2 / life;
  const rows = [];
  let book = cost, i = 0;
  const guard = life * 3 + 24;   // declining balance can run long; hard stop so a bad input can't loop
  while (book > salvage && i < guard) {
    let charge = asset.method === 'saldo_menurun' ? Math.round(book * ddbRate) : slBase;
    if (i === 0 && firstFrac < 1) charge = Math.round(charge * firstFrac);
    if (charge <= 0) charge = book - salvage;             // guarantee progress; final catch-up to salvage
    if (book - charge < salvage) charge = book - salvage; // NEVER below salvage
    if (charge <= 0) break;
    const before = book; book -= charge;
    rows.push({ index: i, period: addMonths(startYM, i), charge, bookValueBefore: before, bookValueAfter: book });
    i++;
  }
  return rows;
}
const methodFormula = (asset) => asset.method === 'saldo_menurun'
  ? `Saldo menurun ganda: beban/bulan = nilai buku × (2 ÷ ${asset.usefulLifeMonths}), berhenti di nilai sisa ${n(asset.salvageValue)}`
  : `Garis lurus: beban/bulan = (harga ${n(asset.acquisitionCost)} − nilai sisa ${n(asset.salvageValue)}) ÷ ${asset.usefulLifeMonths} = ${Math.round(Math.max(0, n(asset.acquisitionCost) - n(asset.salvageValue)) / Math.max(1, asset.usefulLifeMonths))}/bulan`;

async function codeById(id) { const a = await prisma.chartAccount.findUnique({ where: { id }, select: { code: true } }); return a ? a.code : null; }
async function idByCode(code) { const a = await prisma.chartAccount.findUnique({ where: { code: String(code || '') }, select: { id: true } }); return a ? a.id : null; }
async function assetCodes(asset) {
  const [assetCode, accCode, expCode] = await Promise.all([codeById(asset.chartAccountId), codeById(asset.accumulatedAccountId), codeById(asset.expenseAccountId)]);
  return { assetCode, accCode, expCode };
}

// Posted accumulated depreciation for an asset (Σ posted DepreciationEntry.amount).
async function accumulatedOf(assetId) {
  const rows = await prisma.depreciationEntry.findMany({ where: { assetId }, select: { amount: true } });
  return rows.reduce((s, r) => s + n(r.amount), 0);
}

async function assetClient(a, extra = {}) {
  const codes = await assetCodes(a);
  const posted = await accumulatedOf(a.id);
  const sched = buildSchedule(a, extra.policy || 'full');
  const cost = n(a.acquisitionCost);
  const bookValue = cost - posted;
  const postedCount = await prisma.depreciationEntry.count({ where: { assetId: a.id } });
  // The next unposted month's charge = the "monthly charge" shown on the register.
  const nextRow = sched[postedCount] || null;
  const remaining = a.status === 'aktif' ? Math.max(0, sched.length - postedCount) : 0;
  return {
    id: a.id, code: a.code, name: a.name, category: a.category,
    acquisitionDate: a.acquisitionDate, acquisitionCost: cost, salvageValue: n(a.salvageValue),
    usefulLifeMonths: a.usefulLifeMonths, method: a.method, methodFormula: methodFormula(a),
    chartCode: codes.assetCode, accumulatedCode: codes.accCode, expenseCode: codes.expCode,
    businessUnitId: a.businessUnitId || null, fleetId: a.fleetId || '', isProduction: !!a.isProduction,
    pooled: !!a.pooled, quantity: a.quantity, status: a.status,
    disposalDate: a.disposalDate || null, disposalProceeds: a.disposalProceeds != null ? n(a.disposalProceeds) : null,
    note: a.note || '', attachmentId: a.attachmentId || null,
    accumulated: posted, bookValue, monthlyCharge: nextRow ? nextRow.charge : 0, remainingMonths: remaining, scheduleMonths: sched.length,
    createdByName: a.createdByName || null, createdAt: a.createdAt ? new Date(a.createdAt).getTime() : null,
    ...extra.include,
  };
}

// ── CREATE / REGISTER an asset. Capitalises it (Dr asset · Cr funding) so the cost lands on the balance
// sheet; funding defaults to Modal (3-1000) for opening balances of already-owned assets, or a cash/bank
// account for a fresh purchase. Depreciation posts separately, monthly.
function resolveExpenseCode(body) {
  if (body.expenseCode) return String(body.expenseCode);
  return body.isProduction ? DEPR_COGS : DEPR_OPEX;   // isProduction picks COGS vs opex — stored explicitly
}
async function createAsset(body, actor) {
  const code = String(body.code || '').trim();
  if (!code) throw ApiError.badRequest('Kode aset wajib diisi.');
  if (await prisma.fixedAsset.findUnique({ where: { code } })) throw ApiError.conflict('Kode aset sudah dipakai.');
  const name = String(body.name || '').trim();
  if (!name) throw ApiError.badRequest('Nama aset wajib diisi.');
  const category = CATEGORIES.includes(body.category) ? body.category : 'lainnya';
  if (!isDate(body.acquisitionDate)) throw ApiError.badRequest('Tanggal perolehan tidak valid.');
  const cost = int(body.acquisitionCost);
  if (cost <= 0) throw ApiError.badRequest('Harga perolehan harus lebih dari 0.');
  const salvage = int(body.salvageValue);
  if (salvage > cost) throw ApiError.badRequest('Nilai sisa tidak boleh melebihi harga perolehan.');
  const life = int(body.usefulLifeMonths);
  if (life <= 0) throw ApiError.badRequest('Umur manfaat (bulan) harus lebih dari 0.');
  const method = METHODS.includes(body.method) ? body.method : 'garis_lurus';
  const pooled = !!body.pooled || category === 'galon';
  const quantity = pooled ? Math.max(1, int(body.quantity)) : 1;
  const assetCode = String(body.assetCode || CATEGORY_ASSET[category] || '1-1400');
  const [assetAccId, accAccId, expAccId] = await Promise.all([idByCode(assetCode), idByCode(body.accumulatedCode || ACCUM), idByCode(resolveExpenseCode(body))]);
  if (!assetAccId || !accAccId || !expAccId) throw ApiError.badRequest('Akun aset/akumulasi/beban tidak ditemukan di bagan akun.');
  await period.assertPeriodOpen(body.acquisitionDate, 'registrasi aset');
  const fundingCode = String(body.fundingCode || MODAL);
  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.fixedAsset.create({ data: {
      code, name, category, acquisitionDate: body.acquisitionDate, acquisitionCost: BigInt(cost), salvageValue: BigInt(salvage),
      usefulLifeMonths: life, method, chartAccountId: assetAccId, accumulatedAccountId: accAccId, expenseAccountId: expAccId,
      businessUnitId: body.businessUnitId || null, fleetId: String(body.fleetId || ''), isProduction: !!body.isProduction,
      pooled, quantity, note: String(body.note || '').slice(0, 500), attachmentId: body.attachmentId || null,
      createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null,
    } });
    // Capitalisation journal (skips if the caller opted out, e.g. the cost is already on the books).
    if (config.accountingV2 && body.postAcquisition !== false) {
      await acc.postJournal({ sourceType: 'asset_acquisition', sourceId: a.id, date: body.acquisitionDate, description: `Perolehan aset: ${name}`, actor, businessUnitId: a.businessUnitId, lines: [{ code: assetCode, debit: cost, fleetId: a.fleetId }, { code: fundingCode, credit: cost, fleetId: a.fleetId }] }, tx);
    }
    return a;
  });
  return assetClient(created, { policy: await firstMonthPolicy() });
}

async function listAssets(query, user) {
  const q = query || {};
  const where = {};
  if (CATEGORIES.includes(q.category)) where.category = q.category;
  if (STATUSES.includes(q.status)) where.status = q.status;
  if (q.businessUnitId) where.businessUnitId = q.businessUnitId;
  if (q.fleetId) where.fleetId = q.fleetId;
  const rows = await prisma.fixedAsset.findMany({ where: withUnitScope(where, user), orderBy: [{ code: 'asc' }], take: 1000 });
  const policy = await firstMonthPolicy();
  const data = [];
  for (const a of rows) data.push(await assetClient(a, { policy }));
  const totals = data.reduce((t, a) => ({ cost: t.cost + a.acquisitionCost, accumulated: t.accumulated + a.accumulated, bookValue: t.bookValue + a.bookValue, monthlyCharge: t.monthlyCharge + (a.status === 'aktif' ? a.monthlyCharge : 0) }), { cost: 0, accumulated: 0, bookValue: 0, monthlyCharge: 0 });
  return { data, totals, count: data.length };
}

async function getAsset(id) {
  const a = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!a) throw ApiError.notFound('Aset tidak ditemukan.');
  const policy = await firstMonthPolicy();
  const sched = buildSchedule(a, policy);
  const posted = await prisma.depreciationEntry.findMany({ where: { assetId: id }, select: { period: true } });
  const postedSet = new Set(posted.map((p) => p.period));
  let acc0 = 0;
  const schedule = sched.map((r) => { acc0 += r.charge; return { period: r.period, charge: r.charge, bookValue: r.bookValueAfter, accumulated: acc0, posted: postedSet.has(r.period) }; });
  return assetClient(a, { policy, include: { schedule, firstMonth: policy } });
}

// ── MONTHLY DEPRECIATION RUN. Posts every due month through `asOf` for every active asset (or one),
// idempotently (UNIQUE (assetId, period) + a skip-if-exists check). NEVER posts into a closed period.
async function postDepreciation({ asOf, assetId } = {}, actor) {
  const cutoff = ym(asOf || todayISO());
  const policy = await firstMonthPolicy();
  const where = { status: 'aktif' }; if (assetId) where.id = assetId;
  const assets = await prisma.fixedAsset.findMany({ where });
  let posted = 0, skippedClosed = 0;
  for (const a of assets) {
    const codes = await assetCodes(a);
    if (!codes.expCode || !codes.accCode) continue;
    const sched = buildSchedule(a, policy);
    for (const row of sched) {
      if (row.period > cutoff) break;
      const exists = await prisma.depreciationEntry.findUnique({ where: { assetId_period: { assetId: a.id, period: row.period } }, select: { id: true } });
      if (exists) continue;
      if (config.accountingV2 && period.LOCKED.includes(await period.statusForKey(row.period))) { skippedClosed++; continue; }   // never post into a closed period
      await prisma.$transaction(async (tx) => {
        let je = null;
        if (config.accountingV2) {
          je = await acc.postJournal({ sourceType: 'depreciation', sourceId: `${a.id}:${row.period}`, date: firstOf(row.period), description: `Penyusutan: ${a.name} (${row.period})`, actor, businessUnitId: a.businessUnitId, lines: [{ code: codes.expCode, debit: row.charge, fleetId: a.fleetId || '' }, { code: codes.accCode, credit: row.charge, fleetId: a.fleetId || '' }] }, tx);
        }
        await tx.depreciationEntry.create({ data: { assetId: a.id, period: row.period, amount: BigInt(row.charge), bookValueAfter: BigInt(row.bookValueAfter), journalEntryId: je ? je.id : null } });
      });
      posted++;
    }
  }
  return { posted, skippedClosed, asOf: cutoff };
}

// How many depreciation MONTHS are due through `asOf` but not yet posted — the Tutup Buku blocker
// ("penyusutan bulan ini belum diposting (n aset)"). Also returns the distinct asset count.
async function pendingDepreciation({ asOf } = {}) {
  const cutoff = ym(asOf || todayISO());
  const policy = await firstMonthPolicy();
  const assets = await prisma.fixedAsset.findMany({ where: { status: 'aktif' } });
  let months = 0; const assetIds = new Set();
  for (const a of assets) {
    const sched = buildSchedule(a, policy);
    const due = sched.filter((r) => r.period <= cutoff);
    if (!due.length) continue;
    const posted = await prisma.depreciationEntry.findMany({ where: { assetId: a.id, period: { in: due.map((d) => d.period) } }, select: { period: true } });
    const postedSet = new Set(posted.map((p) => p.period));
    const miss = due.filter((d) => !postedSet.has(d.period)).length;
    if (miss > 0) { months += miss; assetIds.add(a.id); }
  }
  return { months, assets: assetIds.size };
}
async function pendingDepreciationCount({ asOf } = {}) { return (await pendingDepreciation({ asOf })).months; }

// ── DISPOSAL. Catches up depreciation through the disposal date first (so accumulated is current), then
// removes cost + accumulated and books the gain/loss. Balanced by construction → the balance sheet still
// balances. proceeds land in `proceedsCode` (default Bank).
async function disposeAsset(id, body, actor) {
  const a = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!a) throw ApiError.notFound('Aset tidak ditemukan.');
  if (a.status !== 'aktif') throw ApiError.badRequest('Aset ini sudah dilepas/dijual.');
  if (!isDate(body.disposalDate)) throw ApiError.badRequest('Tanggal pelepasan tidak valid.');
  const status = ['dijual', 'dilepas', 'rusak'].includes(body.status) ? body.status : 'dijual';
  const proceeds = int(body.disposalProceeds);
  const proceedsCode = String(body.proceedsCode || BANK);
  await period.assertPeriodOpen(body.disposalDate, 'pelepasan aset');
  await postDepreciation({ asOf: body.disposalDate, assetId: id }, actor);   // catch up so accumulated is current
  const accumulated = await accumulatedOf(id);
  const cost = n(a.acquisitionCost);
  const book = cost - accumulated;
  const gain = proceeds - book;   // >0 gain, <0 loss
  const codes = await assetCodes(a);
  const updated = await prisma.$transaction(async (tx) => {
    if (config.accountingV2) {
      const lines = [
        { code: proceedsCode, debit: proceeds, fleetId: a.fleetId || '' },
        { code: codes.accCode, debit: accumulated, fleetId: a.fleetId || '' },
        { code: codes.assetCode, credit: cost, fleetId: a.fleetId || '' },
      ];
      if (gain > 0) lines.push({ code: GAIN, credit: gain, fleetId: a.fleetId || '' });
      else if (gain < 0) lines.push({ code: LOSS, debit: -gain, fleetId: a.fleetId || '' });
      await acc.postJournal({ sourceType: 'asset_disposal', sourceId: id, date: body.disposalDate, description: `Pelepasan aset: ${a.name} (${status})`, actor, businessUnitId: a.businessUnitId, lines }, tx);
    }
    return tx.fixedAsset.update({ where: { id }, data: { status, disposalDate: body.disposalDate, disposalProceeds: BigInt(proceeds) } });
  });
  return { ...(await assetClient(updated, { policy: await firstMonthPolicy() })), disposal: { cost, accumulated, bookValue: book, proceeds, gain } };
}

// ── BULK IMPORT (preview → commit). Each row is validated independently; the preview never commits.
function parseImportRow(r, i, seenCodes) {
  const code = String(r.code || r.kode || '').trim();
  const name = String(r.name || r.nama || '').trim();
  const catRaw = String(r.category || r.kategori || 'lainnya').trim().toLowerCase().replace(/\s+/g, '_');
  const category = CATEGORIES.includes(catRaw) ? catRaw : (catRaw === 'mesin' || catRaw === 'mesinro' ? 'mesin_ro' : 'lainnya');
  const acquisitionDate = String(r.acquisitionDate || r.tanggal || r.tanggalPerolehan || '').trim().slice(0, 10);
  const acquisitionCost = int(String(r.acquisitionCost || r.harga || '').replace(/[^\d.-]/g, ''));
  const salvageValue = int(String(r.salvageValue || r.nilaiSisa || r.sisa || '0').replace(/[^\d.-]/g, ''));
  const usefulLifeMonths = int(r.usefulLifeMonths || r.umur || r.umurBulan || 0);
  const mRaw = String(r.method || r.metode || 'garis_lurus').trim().toLowerCase();
  const method = /menurun|declin|saldo/.test(mRaw) ? 'saldo_menurun' : 'garis_lurus';
  const isProduction = /^(1|ya|yes|true|produksi|y)$/i.test(String(r.isProduction || r.produksi || '').trim());
  const errors = [];
  if (!code) errors.push('kode kosong');
  else if (seenCodes.has(code)) errors.push('kode ganda di file');
  if (!name) errors.push('nama kosong');
  if (!isDate(acquisitionDate)) errors.push('tanggal tidak valid (YYYY-MM-DD)');
  if (acquisitionCost <= 0) errors.push('harga <= 0');
  if (salvageValue > acquisitionCost) errors.push('nilai sisa > harga');
  if (usefulLifeMonths <= 0) errors.push('umur bulan <= 0');
  seenCodes.add(code);
  return { srcRow: i + 1, code, name, category, acquisitionDate, acquisitionCost, salvageValue, usefulLifeMonths, method, isProduction, businessUnitId: r.businessUnitId || r.unit || null, fleetId: String(r.fleetId || r.armada || ''), valid: errors.length === 0, errors };
}
async function previewImport(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const parsed = list.map((r, i) => parseImportRow(r, i, seen));
  // Flag codes that already exist in the DB.
  const codes = parsed.filter((p) => p.code).map((p) => p.code);
  const existing = codes.length ? await prisma.fixedAsset.findMany({ where: { code: { in: codes } }, select: { code: true } }) : [];
  const has = new Set(existing.map((e) => e.code));
  parsed.forEach((p) => { if (p.valid && has.has(p.code)) { p.valid = false; p.errors.push('kode sudah terdaftar'); } });
  return { rows: parsed, validCount: parsed.filter((p) => p.valid).length, invalidCount: parsed.filter((p) => !p.valid).length, total: parsed.length };
}
async function commitImport(rows, actor) {
  const preview = await previewImport(rows);
  const valid = preview.rows.filter((p) => p.valid);
  const created = [];
  for (const p of valid) {
    try { const a = await createAsset({ ...p, postAcquisition: true }, actor); created.push(a.id); } catch (e) { /* a race can re-dup a code; skip it */ }
  }
  return { created: created.length, skipped: preview.total - created.length, invalid: preview.invalidCount };
}

// ── GALLONS AS A POOLED ASSET. One record covers `quantity` gallons. The pool quantity is reconciled to
// the gallon ledger's TOTAL OWNED (good stock: depot + armada + customers). A pool LOSS (rusak/hilang
// written off the books) reduces the pool quantity + cost, posts a loss (Dr Rugi + Dr Akumulasi share /
// Cr Aset), and records the physical rusak/hilang in the gallon ledger — so the two move together and
// never drift. (totalDimiliki, which keeps broken gallons for the physical audit, is reported too.)
async function gallonLedgerTotals(actor) {
  try { const s = await require('./distribution.service').gallonSummary(actor || {}, undefined); return s && s.stock ? s.stock : { totalOwned: 0, totalDimiliki: 0 }; }
  catch (e) { return { totalOwned: 0, totalDimiliki: 0 }; }
}
async function reconcileGallonPool(id, actor) {
  const a = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!a || !a.pooled) throw ApiError.badRequest('Bukan aset galon terkumpul (pool).');
  const stock = await gallonLedgerTotals(actor);
  return { assetId: id, poolQuantity: a.quantity, totalOwned: stock.totalOwned, totalDimiliki: stock.totalDimiliki, drift: a.quantity - stock.totalOwned, matchesDimiliki: a.quantity === stock.totalDimiliki };
}
async function gallonPoolLoss(id, body, actor) {
  const a = await prisma.fixedAsset.findUnique({ where: { id } });
  if (!a || !a.pooled) throw ApiError.badRequest('Bukan aset galon terkumpul (pool).');
  if (a.status !== 'aktif') throw ApiError.badRequest('Aset ini sudah dilepas.');
  const qty = int(body.qty);
  if (qty <= 0 || qty > a.quantity) throw ApiError.badRequest('Jumlah galon hilang/rusak tidak valid.');
  const kind = /hilang/.test(String(body.kind || '')) ? 'hilang' : 'rusak';
  const date = isDate(body.date) ? body.date : todayISO();
  await period.assertPeriodOpen(date, 'kerugian galon');
  const cost = n(a.acquisitionCost);
  const perUnitCost = a.quantity ? Math.round(cost / a.quantity) : 0;
  const accumulated = await accumulatedOf(id);
  const perUnitAccum = a.quantity ? Math.round(accumulated / a.quantity) : 0;
  const lossCost = perUnitCost * qty;                 // cost removed from the pool
  const lossAccum = Math.min(perUnitAccum * qty, accumulated);   // its share of accumulated depreciation
  const lossAmount = lossCost - lossAccum;            // book value written off → the P&L loss
  const codes = await assetCodes(a);
  const updated = await prisma.$transaction(async (tx) => {
    if (config.accountingV2) {
      const lines = [
        { code: codes.accCode, debit: lossAccum, fleetId: a.fleetId || '' },   // remove its accumulated depreciation
        { code: LOSS, debit: lossAmount, fleetId: a.fleetId || '' },           // book value → loss
        { code: codes.assetCode, credit: lossCost, fleetId: a.fleetId || '' }, // remove its cost
      ];
      await acc.postJournal({ sourceType: 'gallon_pool_loss', sourceId: `${id}:${date}:${qty}`, date, description: `Galon ${kind} (pool): ${a.name} × ${qty}`, actor, businessUnitId: a.businessUnitId, lines }, tx);
    }
    return tx.fixedAsset.update({ where: { id }, data: { quantity: a.quantity - qty, acquisitionCost: BigInt(Math.max(0, cost - lossCost)) } });
  });
  // Record the physical rusak/hilang in the GALLON LEDGER too, so ledger total-owned drops by qty and
  // the pool stays reconciled (best-effort; the accounting write above is the source of truth).
  try { await require('./distribution.service').reportGallonDamage({ kind: kind === 'hilang' ? 'hilang' : 'rusak', qty, reason: String(body.reason || 'kerugian aset galon'), fleetId: a.fleetId || '' }, actor); } catch (e) { /* ledger write best-effort */ }
  return { ...(await assetClient(updated, { policy: await firstMonthPolicy() })), loss: { qty, kind, lossCost, lossAccum, lossAmount } };
}

module.exports = {
  CATEGORIES, METHODS, STATUSES, buildSchedule, methodFormula, firstMonthPolicy,
  createAsset, listAssets, getAsset, postDepreciation, pendingDepreciation, pendingDepreciationCount,
  disposeAsset, previewImport, commitImport, reconcileGallonPool, gallonPoolLoss,
};
