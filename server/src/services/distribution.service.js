'use strict';
// DISTRIBUSI module service — per-record REST, fully separate from the AirRO cash
// book (nothing here ever writes to the Entry/cash-flow tables). Core invariants:
//   • transaction unit price is LOCKED on the SERVER from the customer's master_price
//     (the client price, if any, is ignored) and amount is computed here;
//   • transactions + price history + corrections + audit are APPEND-ONLY — no update
//     or delete is exposed; mistakes are fixed by appending a correction;
//   • every write also appends an immutable DistAuditLog row.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');

const METHODS = ['lunas', 'bon', 'pelunasan'];
// Delivery-day codes (Mon…Sun). Stored on the customer as a JSON array of these.
const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
// Seed customer types — ids match the legacy string values so existing rows stay valid.
const SEED_TYPES = [
  { id: 'reguler', label: 'Reguler', sortOrder: 0 },
  { id: 'kos', label: 'Kos', sortOrder: 1 },
  { id: 'cafe', label: 'Cafe', sortOrder: 2 },
  { id: 'bulk', label: 'Bulk', sortOrder: 3 },
];
const int = (v) => Math.max(0, Math.round(+v || 0));
const cleanDays = (v) => { const a = Array.isArray(v) ? v : []; return DAY_CODES.filter((d) => a.includes(d)); };   // dedup + canonical order

// ── Customer types (editable dictionary) ──────────────────────────────────────
// Ensure the seed types exist (idempotent). Run at startup; resetDb re-seeds in tests.
async function seedCustomerTypes() {
  try {
    for (const t of SEED_TYPES) {
      const existing = await prisma.customerType.findUnique({ where: { id: t.id } });
      if (!existing) await prisma.customerType.create({ data: t });
    }
  } catch (e) { /* table may not exist yet on very first migrate; ignored */ }
}
async function listTypes() {
  const data = await prisma.customerType.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  return { data };
}
async function validTypeId(id) {
  if (!id) return 'reguler';
  const t = await prisma.customerType.findUnique({ where: { id } });
  return t ? t.id : 'reguler';   // unknown type id falls back to reguler (import back-compat)
}
async function createType(body, actor) {
  const label = String(body.label || '').trim();
  if (!label) throw ApiError.badRequest('Nama tipe tidak boleh kosong.');
  const all = await prisma.customerType.findMany();
  if (all.some((t) => t.label.toLowerCase() === label.toLowerCase())) throw ApiError.badRequest(`Tipe "${label}" sudah ada.`);
  const snap = await actorSnap(actor);
  const t = await prisma.customerType.create({ data: { label, sortOrder: all.length } });
  await logAudit('pelanggan', `Tipe pelanggan baru: ${label}`, '', snap);
  return t;
}
async function renameType(id, body, actor) {
  const cur = await prisma.customerType.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Tipe tidak ditemukan');
  const label = String(body.label || '').trim();
  if (!label) throw ApiError.badRequest('Nama tipe tidak boleh kosong.');
  const all = await prisma.customerType.findMany();
  if (all.some((t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase())) throw ApiError.badRequest(`Tipe "${label}" sudah ada.`);
  const snap = await actorSnap(actor);
  const t = await prisma.customerType.update({ where: { id }, data: { label } });
  await logAudit('pelanggan', `Ubah nama tipe: ${cur.label} → ${label}`, '', snap);
  return t;   // customers keep the same type id → rename is safe
}
// Delete a type. If customers still use it, refuse unless a reassignTo type is given
// (then move those customers to it first). Never leave a customer on a missing type.
async function deleteType(id, reassignTo, actor) {
  const cur = await prisma.customerType.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Tipe tidak ditemukan');
  if ((await prisma.customerType.count()) <= 1) throw ApiError.badRequest('Minimal satu tipe pelanggan harus ada.');
  const inUse = await prisma.customer.count({ where: { type: id } });
  if (inUse > 0) {
    if (!reassignTo) throw ApiError.badRequest(`Tipe ini masih dipakai ${inUse} pelanggan. Pindahkan dulu ke tipe lain.`, { inUse });
    if (reassignTo === id) throw ApiError.badRequest('Pilih tipe tujuan yang berbeda.');
    const dest = await prisma.customerType.findUnique({ where: { id: reassignTo } });
    if (!dest) throw ApiError.badRequest('Tipe tujuan tidak valid.');
    await prisma.customer.updateMany({ where: { type: id }, data: { type: reassignTo } });
  }
  const snap = await actorSnap(actor);
  await prisma.customerType.delete({ where: { id } });
  await logAudit('pelanggan', `Hapus tipe: ${cur.label}`, inUse > 0 ? `${inUse} pelanggan dipindahkan` : '', snap);
  return { deleted: true, reassigned: inUse };
}

// actor = req.user ({ id, role, username }). We snapshot id+role (+name from DB) so
// the trail is historical and can never be forged from the request body.
async function actorSnap(actor) {
  const out = { actorId: (actor && actor.id) || null, actorRole: (actor && actor.role) || null, actorName: null, actorStaff: false };
  if (actor && actor.id) {
    const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, role: true, permissions: true } });
    if (u) {
      out.actorName = u.name;
      const perms = resolvePerms(u.role, u.permissions);
      // A "staff" actor has base distribusi but none of the owner distribusi caps.
      out.actorStaff = !!(perms.distribusi && !perms.distribusiAudit && !perms.distribusiHargaMaster && !perms.distribusiCustomers);
    }
  }
  return out;
}
// Append one immutable audit row. `snap` is the resolved actor snapshot.
async function logAudit(kind, title, detail, snap) {
  return prisma.distAuditLog.create({ data: { kind, title, detail: detail || '', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, actorStaff: !!snap.actorStaff } });
}

// ── Customers ──────────────────────────────────────────────────────────────
// Expose deliveryDays as a parsed array (stored as a JSON string). Old rows without
// the column default to [] / '' → they render as "—" on the client.
function custClient(c) {
  let days = []; try { days = c.deliveryDays ? JSON.parse(c.deliveryDays) : []; } catch (e) {}
  return { ...c, deliveryDays: Array.isArray(days) ? days : [], armada: c.armada || '' };
}
// Per-customer rollups from the (immutable) transactions: total gallons, running
// bon (sisaBon = bon booked − pelunasan collected, floored at 0), last activity.
async function listCustomers() {
  const rows = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const txns = await prisma.distTransaction.findMany({ select: { customerId: true, qty: true, amount: true, method: true, txnDate: true } });
  const agg = {};
  txns.forEach((t) => {
    const a = agg[t.customerId] || (agg[t.customerId] = { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 });
    a.totalGalon += t.qty; a.txnCount++;
    if (t.method === 'bon') a.bon += t.amount; else if (t.method === 'pelunasan') a.pelunasan += t.amount;
    if (t.txnDate > a.lastDate) a.lastDate = t.txnDate;
  });
  const data = rows.map((c) => {
    const a = agg[c.id] || { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 };
    return { ...custClient(c), totalGalon: a.totalGalon, sisaBon: Math.max(0, a.bon - a.pelunasan), lastDate: a.lastDate || null, txnCount: a.txnCount };
  });
  return { data };
}
async function getCustomer(id) {
  const c = await prisma.customer.findUnique({ where: { id }, include: { priceHistory: { orderBy: { changedAt: 'desc' } } } });
  if (!c) throw ApiError.notFound('Customer not found');
  const txns = await prisma.distTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, include: { corrections: { select: { id: true } } } });
  let bon = 0, pelunasan = 0, totalGalon = 0;
  const transactions = txns.map((t) => {
    totalGalon += t.qty; if (t.method === 'bon') bon += t.amount; else if (t.method === 'pelunasan') pelunasan += t.amount;
    return { id: t.id, qty: t.qty, unitPriceLocked: t.unitPriceLocked, amount: t.amount, method: t.method, txnDate: t.txnDate, note: t.note, actorName: t.actorName, createdAt: t.createdAt ? new Date(t.createdAt).getTime() : null, corrected: t.corrections.length > 0 };
  });
  return { ...custClient(c), transactions, totalGalon, sisaBon: Math.max(0, bon - pelunasan), txnCount: txns.length };
}
// Sync write columns (type is resolved separately — it needs a DB lookup).
function customerCols(body) {
  return {
    name: String(body.name || '').trim(),
    phone: body.phone != null ? String(body.phone).trim() : '',
    masterPrice: int(body.masterPrice != null ? body.masterPrice : body.master_price),
    deliveryDays: JSON.stringify(cleanDays(body.deliveryDays)),
    armada: body.armada != null ? String(body.armada).trim() : '',
  };
}
async function createCustomer(body, actor) {
  const cols = customerCols(body);
  if (!cols.name) throw ApiError.badRequest('name is required');
  cols.type = await validTypeId(body.type);
  const snap = await actorSnap(actor);
  const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
  await logAudit('pelanggan', `Pelanggan baru: ${c.name}`, `Tipe ${c.type} · harga master ${c.masterPrice}`, snap);
  return custClient(c);
}
// Edit an existing customer's editable fields (name/phone/type/deliveryDays/armada).
// masterPrice is intentionally NOT editable here — it changes only via updatePrice
// (owner-gated, writes price_history). Only the provided fields are touched.
async function updateCustomer(id, body, actor) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Customer not found');
  const data = {};
  if (body.name != null) { const n = String(body.name).trim(); if (!n) throw ApiError.badRequest('name is required'); data.name = n; }
  if (body.phone != null) data.phone = String(body.phone).trim();
  if (body.deliveryDays !== undefined) data.deliveryDays = JSON.stringify(cleanDays(body.deliveryDays));
  if (body.armada !== undefined) data.armada = body.armada != null ? String(body.armada).trim() : '';
  if (body.type != null) data.type = await validTypeId(body.type);
  const c = await prisma.customer.update({ where: { id }, data });
  const snap = await actorSnap(actor);
  await logAudit('pelanggan', `Ubah pelanggan: ${c.name}`, `Tipe ${c.type}`, snap);
  return custClient(c);
}
async function importCustomers(list, actor) {
  const rows = Array.isArray(list) ? list : [];
  const snap = await actorSnap(actor);
  let created = 0; const out = [];
  for (const item of rows) {
    const cols = customerCols(item);
    if (!cols.name) continue;
    cols.type = await validTypeId(item.type);
    const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
    out.push(custClient(c)); created++;
  }
  await logAudit('impor', `Impor ${created} pelanggan`, `Dari ${rows.length} baris`, snap);
  return { data: out, imported: created, received: rows.length };
}
// Delivery fleet list for the customer form — reuses the shared Setoran fleet table
// (kept read-only here; managing plates stays in the Setoran/Settings area).
async function fleetList() {
  const rows = await prisma.fleet.findMany({ orderBy: { plate: 'asc' } });
  return { data: rows.map((f) => ({ id: f.id, plate: f.plate })) };
}

// Owner-only master price change. Appends price_history + audit; does NOT touch any
// existing transaction (their unit_price_locked stays exactly as sold).
async function updatePrice(id, newPriceRaw, actor) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  const newPrice = int(newPriceRaw);
  const oldPrice = c.masterPrice;
  const snap = await actorSnap(actor);
  const [updated] = await prisma.$transaction([
    prisma.customer.update({ where: { id }, data: { masterPrice: newPrice } }),
    prisma.priceHistory.create({ data: { customerId: id, oldPrice, newPrice, changedById: snap.actorId, changedByName: snap.actorName, changedByRole: snap.actorRole } }),
  ]);
  await logAudit('harga', `Harga master: ${c.name}`, `${oldPrice} → ${newPrice}`, snap);
  return updated;
}

// ── Transactions ── (immutable; price locked server-side)
async function listTransactions(q) {
  const where = {};
  if (q.date) where.txnDate = q.date;
  if (q.dateFrom || q.dateTo) { where.txnDate = {}; if (q.dateFrom) where.txnDate.gte = q.dateFrom; if (q.dateTo) where.txnDate.lte = q.dateTo; }
  if (q.customerId) where.customerId = q.customerId;
  if (q.method && METHODS.includes(q.method)) where.method = q.method;
  const rows = await prisma.distTransaction.findMany({
    where, orderBy: { createdAt: 'desc' },
    include: { customer: { select: { name: true, type: true } }, corrections: { orderBy: { createdAt: 'desc' } } },
  });
  return { data: rows, now: new Date().toISOString() };
}
async function createTransaction(body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer) throw ApiError.badRequest('customerId does not reference an existing customer');
  const qty = int(body.qty);
  if (qty <= 0) throw ApiError.badRequest('qty must be a positive integer');
  const method = METHODS.includes(body.method) ? body.method : 'lunas';
  // PRICE LOCK: always the customer's current master_price — the client cannot set it.
  const unitPriceLocked = customer.masterPrice;
  const amount = qty * unitPriceLocked;
  const snap = await actorSnap(actor);
  const txn = await prisma.distTransaction.create({ data: {
    customerId: customer.id, qty, unitPriceLocked, amount, method, note: (body.note || '').trim(),
    txnDate: body.txnDate, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
  } });
  await logAudit('input', `Transaksi: ${customer.name}`, `${qty} × ${unitPriceLocked} = ${amount} (${method})`, snap);
  return txn;
}

// Append a correction to an immutable transaction. reason required; byStaff flags a
// staff-level actor (has 'distribusi' but none of the owner distribusi caps).
async function addCorrection(txnId, body, actor, isStaff) {
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('reason is required');
  const snap = await actorSnap(actor);
  const corr = await prisma.correction.create({ data: {
    transactionId: txnId, reason,
    oldValue: body.oldValue != null ? (typeof body.oldValue === 'string' ? body.oldValue : JSON.stringify(body.oldValue)) : null,
    newValue: body.newValue != null ? (typeof body.newValue === 'string' ? body.newValue : JSON.stringify(body.newValue)) : null,
    actorId: snap.actorId, actorRole: snap.actorRole, byStaff: !!isStaff,
  } });
  await logAudit('koreksi', `Koreksi transaksi${isStaff ? ' (staff)' : ''}`, reason, snap);
  return corr;
}

// ── Audit + dashboard ──
async function listAudit(q) {
  const where = {};
  if (q && q.kind) where.kind = q.kind;
  const rows = await prisma.distAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: (q && +q.limit) || 500 });
  return { data: rows };
}

const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Everything the Distribusi dashboard needs in ONE call (NOT posted to AirRO cash —
// informational): today's KPIs, a 7-day stacked series (lunas vs bon), the most
// recent transactions (with a corrected flag), and the top customers in the window.
async function dashboardSummary(date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const from = addDays(day, -6);
  const rows = await prisma.distTransaction.findMany({
    where: { txnDate: { gte: from, lte: day } },
    include: { customer: { select: { name: true, type: true } }, corrections: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Today's KPIs. uang masuk = cash actually received (lunas + pelunasan);
  // piutang = new receivables booked as bon.
  const todayRows = rows.filter((r) => r.txnDate === day);
  const byMethod = { lunas: 0, bon: 0, pelunasan: 0 };
  let qty = 0, amount = 0;
  todayRows.forEach((r) => { qty += r.qty; amount += r.amount; if (byMethod[r.method] != null) byMethod[r.method] += r.amount; });
  const uangMasuk = byMethod.lunas + byMethod.pelunasan;
  const piutang = byMethod.bon;

  // 7-day stacked series: cash bucket (lunas + pelunasan) vs bon.
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(day, -i);
    let lunas = 0, bon = 0;
    rows.filter((r) => r.txnDate === d).forEach((r) => { if (r.method === 'bon') bon += r.amount; else lunas += r.amount; });
    last7.push({ date: d, lunas, bon });
  }

  // Most recent transactions across the window.
  const recent = rows.slice(0, 8).map((r) => ({
    id: r.id, customerName: r.customer ? r.customer.name : '', customerType: r.customer ? r.customer.type : null,
    qty: r.qty, unitPriceLocked: r.unitPriceLocked, amount: r.amount, method: r.method, txnDate: r.txnDate,
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null, corrected: r.corrections.length > 0,
  }));

  // Top customers by amount in the window.
  const byCust = {};
  rows.forEach((r) => { const k = r.customerId; if (!byCust[k]) byCust[k] = { id: k, name: r.customer ? r.customer.name : '', type: r.customer ? r.customer.type : null, qty: 0, amount: 0 }; byCust[k].qty += r.qty; byCust[k].amount += r.amount; });
  const topCustomers = Object.values(byCust).sort((a, b) => b.amount - a.amount).slice(0, 5);

  const customers = await prisma.customer.count();
  return { date: day, count: todayRows.length, qty, amount, byMethod, uangMasuk, piutang, customers, last7, recent, topCustomers };
}

module.exports = {
  METHODS, DAY_CODES,
  listCustomers, getCustomer, createCustomer, updateCustomer, importCustomers, updatePrice, fleetList,
  listTypes, createType, renameType, deleteType, seedCustomerTypes,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
};
