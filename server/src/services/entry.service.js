'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const distribution = require('./distribution.service');   // gallon-purchase movement sync (intentional cash-flow ↔ distribusi link)
const businessUnit = require('./businessUnit.service');   // Stage 3: unit label on each entry (default "Air")

// Build a Prisma `where` clause from validated list filters.
function buildWhere(q) {
  const where = {};
  if (q.type) where.type = q.type;
  if (q.category) where.categoryKey = q.category;
  if (q.account) where.accountId = q.account;
  if (q.method) where.method = q.method;
  if (q.status) where.status = q.status;
  if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = q.dateFrom;
    if (q.dateTo) where.date.lte = q.dateTo;
  }
  if (q.since) where.updatedAt = { gte: new Date(q.since) };
  // Stage 3 unit filter. Every row is stamped (backfilled + create/update default to "Air"),
  // so an exact match is correct and complete; null-as-Air legacy rows can't exist post-Stage-3.
  if (q.businessUnit) where.businessUnitId = q.businessUnit;
  if (q.search) {
    where.OR = [
      { note: { contains: q.search } },
      { category: { contains: q.search } },
      { method: { contains: q.search } },
    ];
  }
  return where;
}

// Expose the creator as a { name, role } object built from the AT-INPUT-TIME
// snapshot columns (never the live User relation), so the label is historical.
function shapeCreator(entry) {
  if (!entry) return entry;
  const { createdByName, createdByRole, ...rest } = entry;
  return { ...rest, createdBy: createdByName ? { name: createdByName, role: createdByRole || null } : null };
}

async function list(q) {
  const where = buildWhere(q);
  const page = q.page || 1;
  const limit = q.limit || 20;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { time: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.entry.count({ where }),
  ]);

  return {
    data: items.map(shapeCreator),
    now: new Date().toISOString(),   // lets the client run an incremental (?since=) poll
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

async function getById(id) {
  const entry = await prisma.entry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound('Entry not found');
  return shapeCreator(entry);
}

// The creator is stamped from the AUTHENTICATED user (token → id), never from the
// request body, and the name/role are read from the DB at input time — so a client
// cannot forge who created a record, and the snapshot reflects the real user then.
async function create(data, actor) {
  const userId = actor && actor.id;
  const snap = { createdById: userId || null };
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (u) { snap.createdByName = u.name; snap.createdByRole = u.role; }
  }
  // Stage 3: stamp the unit label (defaults to "Air"; unknown ids fall back too). Purely a
  // label — it changes no amount, only which unit view the entry appears under.
  const businessUnitId = await businessUnit.resolveUnitId(data.businessUnitId);
  const entry = await prisma.entry.create({ data: { ...data, businessUnitId, ...snap } });
  // A "Pembelian Galon" expense mirrors into the gallon ledger (purchase movement).
  if (entry.type === 'expense' && +entry.gallonQty > 0) await distribution.syncPurchaseMovement(entry.id, entry.gallonQty, actor);
  return shapeCreator(entry);
}

async function update(id, data, actor) {
  const cur = await getById(id); // 404 if missing
  // An inter-unit leg is half of a linked pair — editing it in isolation would desync the two
  // books. It must be voided (which reverses BOTH legs) and re-created, never patched.
  if (cur.interUnit) throw ApiError.badRequest('Transaksi antar-unit tidak bisa diedit — batalkan lalu buat ulang.');
  // Never let a PATCH overwrite the original creator snapshot (the fields aren't in
  // the update schema anyway, but strip defensively).
  const { createdById, createdByName, createdByRole, ...safe } = data;
  // Only re-resolve the unit when the request carries it, so a normal edit that omits it keeps
  // the entry's current unit (never silently reset to "Air").
  if (safe.businessUnitId !== undefined) safe.businessUnitId = await businessUnit.resolveUnitId(safe.businessUnitId);
  const entry = await prisma.entry.update({ where: { id }, data: safe });
  // Re-sync the gallon purchase movement (replace-on-change) so an edit never leaves
  // stock out of step; a non-gallon or income entry clears any prior movement.
  await distribution.syncPurchaseMovement(entry.id, (entry.type === 'expense' ? entry.gallonQty : 0), actor || { id: entry.createdById });
  return shapeCreator(entry);
}

async function remove(id) {
  const cur = await getById(id);
  await distribution.retractPurchaseMovement(id);   // pull back any gallon stock this entry added
  // Deleting one leg of an inter-unit transfer deletes BOTH (atomic), so a leg is never orphaned
  // — whether removed here or via the dedicated void endpoint.
  if (cur.interUnit && cur.transferGroupId) {
    await prisma.entry.deleteMany({ where: { transferGroupId: cur.transferGroupId, interUnit: true } });
  } else {
    await prisma.entry.delete({ where: { id } });
  }
}

module.exports = { list, getById, create, update, remove };
