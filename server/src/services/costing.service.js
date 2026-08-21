'use strict';
// HPP / PRODUCT COSTING — STANDARD COSTING + VARIANCE ANALYSIS on the double-entry engine
// (ACCOUNTING_V2). A CostStandard is a VERSIONED, date-effective bill-of-cost per galon; activating one
// requires approval (REUSES the DistChangeRequest engine). A ProductionRun posts finished goods at
// STANDARD cost and routes EVERY difference to its own named variance account — nothing is silently
// absorbed (an unclassifiable difference FAILS the post). Distribution sales post HPP ON SALE at
// standard, consuming finished-goods inventory. Month-end closes variances to HPP.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const acc = require('./accounting.service');

const FG = '1-1350', HPP = '5-1000';
const VAR = { price: '5-3100', qty: '5-3200', rate: '5-3300', eff: '5-3400', spending: '5-3500', volume: '5-3600' };
const VAR_CODES = Object.values(VAR);
const CATEGORIES = ['bahan_langsung', 'tenaga_kerja', 'overhead_variabel', 'overhead_tetap'];
const OVERHEAD = new Set(['overhead_variabel', 'overhead_tetap']);
// Default RO-water bill-of-cost template (owner ESTIMATES — not fiscal figures). [component, category, unit, defaultAccount]
const RO_TEMPLATE = [
  ['air_baku', 'bahan_langsung', 'galon', '6-3000'], ['listrik', 'overhead_variabel', 'kWh', '6-5000'],
  ['membran_ro', 'bahan_langsung', 'pcs', '6-3000'], ['filter', 'bahan_langsung', 'pcs', '6-3000'],
  ['tutup', 'bahan_langsung', 'pcs', '6-3000'], ['segel', 'bahan_langsung', 'pcs', '6-3000'],
  ['tenaga_kerja', 'tenaga_kerja', 'jam', '6-1000'], ['penyusutan_mesin', 'overhead_tetap', 'galon', '5-2000'],
  ['penyusutan_galon', 'overhead_tetap', 'galon', '5-2000'], ['pemeliharaan', 'overhead_variabel', 'galon', '6-4000'],
  ['susut_galon', 'overhead_variabel', 'galon', '6-8500'],
];

const n = (v) => Math.round(Number(v) || 0);
const f = (v) => Number(v) || 0;
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const ym = (d) => String(d || '').slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);
async function idByCode(code) { const a = await prisma.chartAccount.findUnique({ where: { code: String(code || '') }, select: { id: true } }); return a ? a.id : null; }
async function codeById(id) { const a = await prisma.chartAccount.findUnique({ where: { id }, select: { code: true } }); return a ? a.code : null; }

// ── STANDARD (bill of cost) ────────────────────────────────────────────────────
// Per-component standard unit cost (rupiah/galon), rounded per component so production (Σ) and
// per-galon HPP-on-sale stay perfectly consistent (no inventory rounding drift).
function lineUnit(l) { return Math.round(f(l.qtyPerUnit) * n(l.unitCost)); }
function standardBreakdown(lines) {
  const byCat = { bahan_langsung: 0, tenaga_kerja: 0, overhead_variabel: 0, overhead_tetap: 0 };
  const components = lines.map((l) => { const u = lineUnit(l); byCat[l.category] = (byCat[l.category] || 0) + u; return { component: l.component, category: l.category, qtyPerUnit: f(l.qtyPerUnit), unit: l.unit || '', unitCost: n(l.unitCost), unitStandard: u }; });
  const perUnit = components.reduce((s, c) => s + c.unitStandard, 0);
  const fixedRatePerUnit = byCat.overhead_tetap;   // fixed OH per galon at normal volume
  const varRatePerUnit = byCat.overhead_variabel;
  return { perUnit, byCat, components, fixedRatePerUnit, varRatePerUnit };
}
async function standardClient(s, lines) {
  const ls = lines || await prisma.costStandardLine.findMany({ where: { standardId: s.id }, orderBy: { sortOrder: 'asc' } });
  const bd = standardBreakdown(ls);
  const codes = {}; for (const l of ls) codes[l.id] = await codeById(l.chartAccountId);
  return {
    id: s.id, productId: s.productId, version: s.version, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo || null,
    normalVolume: s.normalVolume, status: s.status, note: s.note || '',
    approvedByName: s.approvedByName || null, approvedAt: s.approvedAt ? new Date(s.approvedAt).getTime() : null, requestId: s.requestId || null,
    perUnit: bd.perUnit, byCat: bd.byCat, fixedRatePerUnit: bd.fixedRatePerUnit, varRatePerUnit: bd.varRatePerUnit,
    lines: ls.map((l) => ({ id: l.id, component: l.component, category: l.category, qtyPerUnit: f(l.qtyPerUnit), unit: l.unit || '', unitCost: n(l.unitCost), unitStandard: lineUnit(l), chartCode: codes[l.id] || null })),
    createdByName: s.createdByName || null, createdAt: s.createdAt ? new Date(s.createdAt).getTime() : null,
  };
}
async function createStandard(body, actor) {
  if (!isDate(body.effectiveFrom)) throw ApiError.badRequest('Tanggal berlaku tidak valid.');
  const normalVolume = int(body.normalVolume);
  if (normalVolume <= 0) throw ApiError.badRequest('Volume normal (galon/bulan) wajib > 0 — ini penentu tarif overhead tetap & selisih volume.');
  const productId = String(body.productId || 'galon-19l');
  const version = (await prisma.costStandard.count({ where: { productId } })) + 1;
  const lines = Array.isArray(body.lines) ? body.lines : [];
  const out = await prisma.$transaction(async (tx) => {
    const s = await tx.costStandard.create({ data: { productId, version, effectiveFrom: body.effectiveFrom, normalVolume, status: 'draft', note: String(body.note || '').slice(0, 500), createdById: (actor && actor.id) || null, createdByName: (actor && actor.name) || null } });
    let i = 0;
    for (const l of lines) {
      const cat = CATEGORIES.includes(l.category) ? l.category : 'bahan_langsung';
      const accId = await idByCode(l.chartCode || '6-9000');
      await tx.costStandardLine.create({ data: { standardId: s.id, component: String(l.component || 'lainnya'), category: cat, qtyPerUnit: f(l.qtyPerUnit), unit: String(l.unit || ''), unitCost: BigInt(int(l.unitCost)), chartAccountId: accId, sortOrder: i++ } });
    }
    return s;
  });
  return standardClient(out);
}
async function listStandards(query) {
  const q = query || {};
  const where = {}; if (q.productId) where.productId = q.productId; if (['draft', 'aktif', 'arsip'].includes(q.status)) where.status = q.status;
  const rows = await prisma.costStandard.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], take: 200 });
  const data = []; for (const s of rows) data.push(await standardClient(s));
  return { data };
}
async function getStandard(id) { const s = await prisma.costStandard.findUnique({ where: { id } }); if (!s) throw ApiError.notFound('Standar tidak ditemukan.'); return standardClient(s); }

// The ACTIVE standard effective on `date` — drives HPP-on-sale + production. Reproducible: a sale is
// always costed by the standard in force on its own date, so re-posting a correction re-derives it.
async function standardEffectiveFor(date, productId = 'galon-19l') {
  const d = String(date || todayISO());
  const rows = await prisma.costStandard.findMany({ where: { productId, status: 'aktif', effectiveFrom: { lte: d } }, orderBy: { effectiveFrom: 'desc' } });
  const hit = rows.find((s) => !s.effectiveTo || s.effectiveTo >= d);
  return hit || null;
}
async function standardPerUnitFor(date, productId = 'galon-19l') {
  const s = await standardEffectiveFor(date, productId); if (!s) return 0;
  const lines = await prisma.costStandardLine.findMany({ where: { standardId: s.id } });
  return standardBreakdown(lines).perUnit;
}

// ── ACTIVATION via the DistChangeRequest approval engine (no second engine). Creates a pending change
// request of kind 'cost_standard' carrying the standard id; approving it calls activateStandard().
async function requestStandardActivation(id, actor) {
  const s = await prisma.costStandard.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Standar tidak ditemukan.');
  if (s.status !== 'draft') throw ApiError.badRequest('Hanya standar draft yang bisa diajukan.');
  if (!(await prisma.costStandardLine.count({ where: { standardId: id } }))) throw ApiError.badRequest('Standar belum punya komponen biaya.');
  const existing = await prisma.distChangeRequest.findFirst({ where: { transactionId: id, kind: 'cost_standard', status: 'pending' } });
  if (existing) throw ApiError.badRequest('Sudah ada pengajuan aktivasi menunggu persetujuan.');
  const dist = require('./distribution.service');
  const snap = await dist.actorSnap(actor);
  const req = await prisma.distChangeRequest.create({ data: {
    transactionId: id, fleetId: '', kind: 'cost_standard', status: 'pending',
    payload: JSON.stringify({ standardId: id, version: s.version }), reason: String((actor && actor.reason) || 'Aktivasi standar biaya v' + s.version),
    requestedById: snap.actorId, requestedByName: snap.actorName, requestedByRole: snap.actorRole,
  } });
  return { requestId: req.id, standardId: id, status: 'pending' };
}
// Called from decideChangeRequest when a 'cost_standard' request is APPROVED. Supersedes any currently
// active standard for the product (sets effectiveTo = day before this one) so history stays reproducible.
async function activateStandard(id, requestId, snap) {
  const s = await prisma.costStandard.findUnique({ where: { id } });
  if (!s) throw ApiError.notFound('Standar tidak ditemukan.');
  if (s.status === 'aktif') return standardClient(s);
  await prisma.$transaction(async (tx) => {
    const prior = await tx.costStandard.findMany({ where: { productId: s.productId, status: 'aktif' } });
    for (const p of prior) { const to = dayBefore(s.effectiveFrom); await tx.costStandard.update({ where: { id: p.id }, data: { status: 'arsip', effectiveTo: p.effectiveTo || to } }); }
    await tx.costStandard.update({ where: { id }, data: { status: 'aktif', requestId: requestId || null, approvedById: (snap && snap.actorId) || null, approvedByName: (snap && snap.actorName) || null, approvedAt: new Date() } });
  });
  return standardClient(await prisma.costStandard.findUnique({ where: { id } }));
}
function dayBefore(date) { const d = new Date(String(date) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

// ── VARIANCE MATH. Per-component reconciliation guarantees Σ variances == actualTotal − standardOutput
// EXACTLY (integer rupiah), so the run journal balances with NO residual. An input whose component is
// not in the standard is UNCLASSIFIABLE → the caller fails the post.
function computeVariances(standard, lines, run, inputs) {
  const output = int(run.unitsProduced);
  const bd = standardBreakdown(lines);
  const stdByComp = {}; bd.components.forEach((c) => { stdByComp[c.component] = c; });
  const inByComp = {}; (inputs || []).forEach((i) => { inByComp[i.component] = { qty: f(i.actualQty), cost: n(i.actualCost), category: i.category, code: i.chartCode || i.chartAccountId }; });
  const v = { price: 0, qty: 0, rate: 0, eff: 0, spending: 0, volume: 0 };
  const detail = [];
  let unclassified = null;
  // material + labour, per component
  for (const comp of Object.keys(stdByComp)) {
    const sc = stdByComp[comp]; const inp = inByComp[comp] || { qty: 0, cost: 0 };
    const stdForOutput = sc.unitStandard * output;
    if (sc.category === 'bahan_langsung' || sc.category === 'tenaga_kerja') {
      const stdAtActualQty = Math.round(sc.unitCost * inp.qty);
      const pv = inp.cost - stdAtActualQty;                 // price/rate: paid vs standard price × actual qty
      const qv = stdAtActualQty - stdForOutput;             // quantity/efficiency: actual qty vs standard qty
      if (sc.category === 'bahan_langsung') { v.price += pv; v.qty += qv; } else { v.rate += pv; v.eff += qv; }
      detail.push({ component: comp, category: sc.category, stdForOutput, actual: inp.cost, price: pv, qty: qv });
    }
  }
  // overhead, aggregate (2-variance method): spending = actual − budgeted; volume = fixedRate × (normal − output)
  const ohStdApplied = bd.components.filter((c) => OVERHEAD.has(c.category)).reduce((s, c) => s + c.unitStandard * output, 0);
  const ohActual = Object.entries(inByComp).filter(([comp]) => stdByComp[comp] && OVERHEAD.has(stdByComp[comp].category)).reduce((s, [, i]) => s + i.cost, 0);
  const fixedRate = bd.fixedRatePerUnit;
  v.volume = fixedRate * (int(standard.normalVolume) - output);   // >0 = under normal = UNFAVOURABLE
  v.spending = (ohActual - ohStdApplied) - v.volume;              // remainder → spending == actual − budgeted
  detail.push({ component: 'overhead', category: 'overhead', stdForOutput: ohStdApplied, actual: ohActual, spending: v.spending, volume: v.volume });
  // guardrail: any input component with NO standard line is unclassifiable
  for (const comp of Object.keys(inByComp)) if (!stdByComp[comp]) unclassified = comp;
  const standardOutput = bd.components.reduce((s, c) => s + c.unitStandard * output, 0);
  const actualTotal = (inputs || []).reduce((s, i) => s + n(i.actualCost), 0);
  const sumVar = v.price + v.qty + v.rate + v.eff + v.spending + v.volume;
  const residual = (actualTotal - standardOutput) - sumVar;
  return { output, standardOutput, actualTotal, variances: v, detail, sumVar, residual, unclassified, perUnit: bd.perUnit };
}

// ── PRODUCTION RUN ─────────────────────────────────────────────────────────────
async function runClient(r, standard) {
  const inputs = await prisma.productionInput.findMany({ where: { runId: r.id } });
  const inCodes = {}; for (const i of inputs) inCodes[i.id] = await codeById(i.chartAccountId);
  const lines = standard ? await prisma.costStandardLine.findMany({ where: { standardId: standard.id } }) : [];
  const vr = (standard && r.status === 'selesai') ? computeVariances(standard, lines, r, inputs.map((i) => ({ ...i, chartCode: inCodes[i.id] }))) : null;
  return {
    id: r.id, date: r.date, unitsProduced: r.unitsProduced, unitsRejected: r.unitsRejected, standardId: r.standardId,
    status: r.status, journalPosted: !!r.journalPosted, note: r.note || '',
    inputs: inputs.map((i) => ({ id: i.id, component: i.component, category: i.category, actualQty: f(i.actualQty), actualCost: n(i.actualCost), chartCode: inCodes[i.id] || null, auto: !!i.auto })),
    variances: vr ? vr.variances : null, standardOutput: vr ? vr.standardOutput : null, actualTotal: vr ? vr.actualTotal : null,
    recordedByName: r.recordedByName || null, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
  };
}
async function createRun(body, actor) {
  if (!isDate(body.date)) throw ApiError.badRequest('Tanggal produksi tidak valid.');
  const std = await prisma.costStandard.findUnique({ where: { id: String(body.standardId || '') } });
  if (!std || std.status !== 'aktif') throw ApiError.badRequest('Pilih standar biaya yang AKTIF.');
  const units = int(body.unitsProduced);
  if (units <= 0) throw ApiError.badRequest('Jumlah galon diproduksi harus > 0.');
  await require('./period.service').assertPeriodOpen(body.date, 'produksi');
  const inputs = Array.isArray(body.inputs) ? body.inputs : [];
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.productionRun.create({ data: { date: body.date, unitsProduced: units, unitsRejected: int(body.unitsRejected), standardId: std.id, businessUnitId: body.businessUnitId || null, status: 'draft', note: String(body.note || '').slice(0, 300), recordedById: (actor && actor.id) || null, recordedByName: (actor && actor.name) || null } });
    for (const i of inputs) { const accId = await idByCode(i.chartCode || '6-9000'); await tx.productionInput.create({ data: { runId: r.id, component: String(i.component || 'lainnya'), category: CATEGORIES.includes(i.category) ? i.category : 'bahan_langsung', actualQty: f(i.actualQty), actualCost: BigInt(int(i.actualCost)), chartAccountId: accId, auto: false } }); }
    return r;
  });
  return runClient(created, std);
}
// Complete a DRAFT run → post the STANDARD-COSTING journal: Dr Finished Goods (standard) · Cr each input
// (actual) · Dr/Cr each variance (its own account). Fails if any difference is unclassifiable.
async function completeRun(id, actor) {
  const r = await prisma.productionRun.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Production run tidak ditemukan.');
  if (r.status === 'selesai') throw ApiError.badRequest('Run ini sudah diselesaikan.');
  const std = await prisma.costStandard.findUnique({ where: { id: r.standardId } });
  const lines = await prisma.costStandardLine.findMany({ where: { standardId: r.standardId } });
  const inputsRaw = await prisma.productionInput.findMany({ where: { runId: id } });
  const inCodes = {}; for (const i of inputsRaw) inCodes[i.id] = await codeById(i.chartAccountId);
  const inputs = inputsRaw.map((i) => ({ ...i, chartCode: inCodes[i.id] }));
  const vr = computeVariances(std, lines, r, inputs);
  if (vr.unclassified) throw ApiError.badRequest(`Komponen "${vr.unclassified}" tidak ada di standar — selisih tidak dapat diklasifikasi. Perbaiki standar/input sebelum posting.`, { unclassified: vr.unclassified });
  if (vr.residual !== 0) throw ApiError.badRequest(`Selisih residual ${vr.residual} tidak terklasifikasi — posting dibatalkan (tidak boleh diserap diam-diam).`, { residual: vr.residual });
  await require('./period.service').assertPeriodOpen(r.date, 'penyelesaian produksi');
  await prisma.$transaction(async (tx) => {
    if (config.accountingV2) {
      const linesJ = [{ code: FG, debit: vr.standardOutput }];
      for (const i of inputs) linesJ.push({ code: i.chartCode, credit: n(i.actualCost) });
      const v = vr.variances;
      const pushVar = (amt, code) => { if (amt > 0) linesJ.push({ code, debit: amt }); else if (amt < 0) linesJ.push({ code, credit: -amt }); };
      pushVar(v.price, VAR.price); pushVar(v.qty, VAR.qty); pushVar(v.rate, VAR.rate); pushVar(v.eff, VAR.eff); pushVar(v.spending, VAR.spending); pushVar(v.volume, VAR.volume);
      await acc.postJournal({ sourceType: 'production_run', sourceId: id, date: r.date, description: `Produksi ${r.unitsProduced} galon (standar)`, actor, businessUnitId: r.businessUnitId, lines: linesJ }, tx);
    }
    await tx.productionRun.update({ where: { id }, data: { status: 'selesai', journalPosted: config.accountingV2 } });
  });
  return runClient(await prisma.productionRun.findUnique({ where: { id } }), std);
}
async function listRuns(query) {
  const q = query || {};
  const where = {}; if (['draft', 'selesai'].includes(q.status)) where.status = q.status;
  if (q.dateFrom || q.dateTo) { where.date = {}; if (q.dateFrom) where.date.gte = q.dateFrom; if (q.dateTo) where.date.lte = q.dateTo; }
  const rows = await prisma.productionRun.findMany({ where, orderBy: { date: 'desc' }, take: 300 });
  const stds = {}; const data = [];
  for (const r of rows) { if (!stds[r.standardId]) stds[r.standardId] = await prisma.costStandard.findUnique({ where: { id: r.standardId } }); data.push(await runClient(r, stds[r.standardId])); }
  return { data };
}
async function getRun(id) { const r = await prisma.productionRun.findUnique({ where: { id } }); if (!r) throw ApiError.notFound('Run tidak ditemukan.'); return runClient(r, await prisma.costStandard.findUnique({ where: { id: r.standardId } })); }

// ── VARIANCE REPORT for a period (from the ledger — the single source of truth). Signed + favourable/
// unfavourable per account. Positive balance (debit) = MERUGIKAN; negative (credit) = MENGUNTUNGKAN.
async function varianceReport({ year, month } = {}) {
  const key = `${year}-${String(month).padStart(2, '0')}`; const [from, to] = [key + '-01', key + '-31'];
  const bals = await acc.accountBalances({ dateFrom: from, dateTo: to });
  const NAMES = { '5-3100': 'price', '5-3200': 'qty', '5-3300': 'rate', '5-3400': 'eff', '5-3500': 'spending', '5-3600': 'volume' };
  const rows = VAR_CODES.map((code) => { const b = bals.find((x) => x.code === code); const amt = b ? b.balance : 0; return { code, key: NAMES[code], name: b ? b.name : code, amount: amt, favourable: amt < 0, unfavourable: amt > 0 }; });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { period: key, rows, total, favourable: total < 0, note: 'Selisih volume di bawah normal → biaya per galon naik karena produksi di bawah normal.' };
}
// Close every variance account to HPP for a period (default policy = 100% to HPP; proration between HPP
// and inventory is configurable via the `costingVariance` setting — stated in the UI). Idempotent per period.
async function closeVariances({ year, month }, actor) {
  const key = `${year}-${String(month).padStart(2, '0')}`; const [from, to] = [key + '-01', key + '-31'];
  const bals = await acc.accountBalances({ dateFrom: from, dateTo: to });
  const lines = []; let net = 0;
  for (const code of VAR_CODES) { const b = bals.find((x) => x.code === code); const amt = b ? b.balance : 0; if (amt === 0) continue; if (amt > 0) lines.push({ code, credit: amt }); else lines.push({ code, debit: -amt }); net += amt; }   // zero each variance out
  if (!lines.length) return { closed: 0, period: key };
  lines.push(net > 0 ? { code: HPP, debit: net } : { code: HPP, credit: -net });   // net → HPP (default policy)
  if (config.accountingV2) await acc.postJournal({ sourceType: 'variance_close', sourceId: key, date: to, description: `Tutup selisih ke HPP ${key}`, actor, lines });
  return { closed: lines.length - 1, net, period: key };
}
async function openVariancesCount({ asOf } = {}) {
  const key = ym(asOf || todayISO()); const [from, to] = [key + '-01', key + '-31'];
  const bals = await acc.accountBalances({ dateFrom: from, dateTo: to });
  return VAR_CODES.filter((code) => { const b = bals.find((x) => x.code === code); return b && b.balance !== 0; }).length;
}
// Runs not yet completed (warn) + APPROVED/selesai runs whose journal somehow didn't post (BLOCK).
async function pendingRuns({ asOf } = {}) {
  const key = ym(asOf || todayISO()); const [from, to] = [key + '-01', key + '-31'];
  const draft = await prisma.productionRun.count({ where: { status: 'draft', date: { gte: from, lte: to } } });
  const unposted = await prisma.productionRun.count({ where: { status: 'selesai', journalPosted: false, date: { gte: from, lte: to } } });
  return { draft, unposted };
}

// ── GALLON LOSS AS A REAL COST — reconcile the costing "susut galon" quantity against the gallon ledger
// (rusak/hilang) for the period, so the two can never drift.
async function gallonLossReconcile({ year, month } = {}, actor) {
  // With a period → reconcile that month (ledger damage/loss by createdAt month, costing susut by run
  // date month); without → ALL-TIME. Both count the SAME physical rusak/hilang, so they must be equal.
  const period = (year && month) ? `${year}-${String(month).padStart(2, '0')}` : null;
  const ledgerWhere = { type: { in: ['damage', 'loss'] }, active: true };
  const runWhere = { component: 'susut_galon', run: { status: 'selesai' } };
  if (period) {
    ledgerWhere.createdAt = { gte: new Date(period + '-01T00:00:00.000Z'), lte: new Date(period + '-31T23:59:59.999Z') };
    runWhere.run = { status: 'selesai', date: { gte: period + '-01', lte: period + '-31' } };
  }
  let ledgerQty = 0;
  try { const rows = await prisma.gallonMovement.findMany({ where: ledgerWhere, select: { qty: true } }); ledgerQty = rows.reduce((s, r) => s + Math.abs(r.qty || 0), 0); } catch (e) { /* ledger optional */ }
  const inputs = await prisma.productionInput.findMany({ where: runWhere, select: { actualQty: true } });
  const costingQty = inputs.reduce((s, i) => s + Math.round(f(i.actualQty)), 0);
  return { period, ledgerQty, costingQty, drift: costingQty - ledgerQty, matches: costingQty === ledgerQty };
}

// ── INVENTORY / HPP reconciliations. Accounting finished-goods QUANTITY is the gallon ledger's depot +
// armada (single source of truth). Monthly HPP is the ledger's cogs-subtype total for the period, which
// the P&L reads from the SAME accounts → equal by construction.
async function costingInventory(actor) {
  let atDepot = 0, atArmada = 0;
  try { const s = await require('./distribution.service').gallonSummary(actor || {}, undefined); if (s && s.stock) { atDepot = s.stock.atDepot || 0; atArmada = s.stock.atArmada || 0; } } catch (e) {}
  const perUnit = await standardPerUnitFor(todayISO());
  const qty = atDepot + atArmada;
  const fgBal = (await acc.accountBalances()).find((r) => r.code === FG);
  return { qty, atDepot, atArmada, value: qty * perUnit, ledgerValue: fgBal ? fgBal.balance : 0, perUnit };
}
async function monthlyHpp({ year, month } = {}) {
  const key = `${year}-${String(month).padStart(2, '0')}`; const [from, to] = [key + '-01', key + '-31'];
  const bals = await acc.accountBalances({ dateFrom: from, dateTo: to });
  const cogs = bals.filter((r) => r.subtype === 'cogs');   // 5-1000 HPP + 5-2000 prod deprec + variances
  const hpp = cogs.reduce((s, r) => s + r.balance, 0);
  return { period: key, hpp, rows: cogs.map((r) => ({ code: r.code, name: r.name, amount: r.balance })) };
}

// ── PRODUCT COST CARD + MARGIN (price SUPPORT — presents data, never sets prices). ──
async function productCostCard({ year, month, productId } = {}) {
  const std = await standardEffectiveFor((year && month) ? `${year}-${String(month).padStart(2, '0')}-15` : todayISO(), productId || 'galon-19l');
  const stdC = std ? await standardClient(std) : null;
  let actualHpp = null;
  if (year && month) { const m = await monthlyHpp({ year, month }); const inv = await costingInventory(); const soldQty = null; actualHpp = { total: m.hpp }; }
  return { standard: stdC, monthly: (year && month) ? await monthlyHpp({ year, month }) : null };
}
async function marginAnalysis({ productId } = {}) {
  const perUnit = await standardPerUnitFor(todayISO(), productId || 'galon-19l');
  const std = await standardEffectiveFor(todayISO(), productId || 'galon-19l');
  // Average selling price per customer type from live master prices.
  let segs = [];
  try {
    const custs = await prisma.customer.groupBy({ by: ['type'], _avg: { masterPrice: true }, _count: { _all: true } });
    segs = custs.map((c) => { const price = Math.round(Number(c._avg.masterPrice || 0)); return { type: c.type || 'reguler', avgPrice: price, count: c._count._all, hpp: perUnit, margin: price - perUnit, marginPct: price ? +(((price - perUnit) / price) * 100).toFixed(1) : 0 }; });
  } catch (e) {}
  // Break-even volume = fixed overhead budget ÷ (avg contribution/galon). Presented, not enforced.
  const fixedBudget = std ? standardBreakdown(await prisma.costStandardLine.findMany({ where: { standardId: std.id } })).fixedRatePerUnit * std.normalVolume : 0;
  const avgPrice = segs.length ? Math.round(segs.reduce((s, x) => s + x.avgPrice, 0) / segs.length) : 0;
  const contributionPerUnit = avgPrice - perUnit + (std ? standardBreakdown(await prisma.costStandardLine.findMany({ where: { standardId: std.id } })).fixedRatePerUnit : 0);
  const breakEvenVolume = contributionPerUnit > 0 ? Math.ceil(fixedBudget / contributionPerUnit) : null;
  return { hppPerUnit: perUnit, normalVolume: std ? std.normalVolume : null, segments: segs, breakEvenVolume, note: 'Data pendukung — keputusan harga tetap di tangan pemilik.' };
}

module.exports = {
  FG, HPP, VAR, VAR_CODES, RO_TEMPLATE, CATEGORIES, standardBreakdown,
  createStandard, listStandards, getStandard, standardEffectiveFor, standardPerUnitFor,
  requestStandardActivation, activateStandard,
  createRun, completeRun, listRuns, getRun, computeVariances,
  varianceReport, closeVariances, openVariancesCount, pendingRuns,
  gallonLossReconcile, costingInventory, monthlyHpp, productCostCard, marginAnalysis,
};
