'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

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
async function create(data, userId) {
  const snap = { createdById: userId || null };
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (u) { snap.createdByName = u.name; snap.createdByRole = u.role; }
  }
  const entry = await prisma.entry.create({ data: { ...data, ...snap } });
  return shapeCreator(entry);
}

async function update(id, data) {
  await getById(id); // 404 if missing
  // Never let a PATCH overwrite the original creator snapshot (the fields aren't in
  // the update schema anyway, but strip defensively).
  const { createdById, createdByName, createdByRole, ...safe } = data;
  const entry = await prisma.entry.update({ where: { id }, data: safe });
  return shapeCreator(entry);
}

async function remove(id) {
  await getById(id);
  await prisma.entry.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
