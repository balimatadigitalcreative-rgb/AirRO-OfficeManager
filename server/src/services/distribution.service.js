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

const CUSTOMER_TYPES = ['reguler', 'kos', 'cafe', 'bulk'];
const METHODS = ['lunas', 'bon', 'pelunasan'];
const int = (v) => Math.max(0, Math.round(+v || 0));

// actor = req.user ({ id, role, username }). We snapshot id+role (+name from DB) so
// the trail is historical and can never be forged from the request body.
async function actorSnap(actor) {
  const out = { actorId: (actor && actor.id) || null, actorRole: (actor && actor.role) || null, actorName: null };
  if (actor && actor.id) {
    const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    if (u) out.actorName = u.name;
  }
  return out;
}
// Append one immutable audit row. `snap` is the resolved actor snapshot.
async function logAudit(kind, title, detail, snap) {
  return prisma.distAuditLog.create({ data: { kind, title, detail: detail || '', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } });
}

// ── Customers ──────────────────────────────────────────────────────────────
async function listCustomers() {
  const rows = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  return { data: rows };
}
async function getCustomer(id) {
  const c = await prisma.customer.findUnique({ where: { id }, include: { priceHistory: { orderBy: { changedAt: 'desc' } } } });
  if (!c) throw ApiError.notFound('Customer not found');
  return c;
}
function customerCols(body) {
  return {
    name: String(body.name || '').trim(),
    phone: body.phone != null ? String(body.phone).trim() : '',
    type: CUSTOMER_TYPES.includes(body.type) ? body.type : 'reguler',
    masterPrice: int(body.masterPrice != null ? body.masterPrice : body.master_price),
  };
}
async function createCustomer(body, actor) {
  const cols = customerCols(body);
  if (!cols.name) throw ApiError.badRequest('name is required');
  const snap = await actorSnap(actor);
  const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
  await logAudit('pelanggan', `Pelanggan baru: ${c.name}`, `Tipe ${c.type} · harga master ${c.masterPrice}`, snap);
  return c;
}
async function importCustomers(list, actor) {
  const rows = Array.isArray(list) ? list : [];
  const snap = await actorSnap(actor);
  let created = 0; const out = [];
  for (const item of rows) {
    const cols = customerCols(item);
    if (!cols.name) continue;
    const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
    out.push(c); created++;
  }
  await logAudit('impor', `Impor ${created} pelanggan`, `Dari ${rows.length} baris`, snap);
  return { data: out, imported: created, received: rows.length };
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
  CUSTOMER_TYPES, METHODS,
  listCustomers, getCustomer, createCustomer, importCustomers, updatePrice,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
};
