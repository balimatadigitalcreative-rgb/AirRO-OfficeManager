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
    data: items,
    now: new Date().toISOString(),   // lets the client run an incremental (?since=) poll
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

async function getById(id) {
  const entry = await prisma.entry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound('Entry not found');
  return entry;
}

async function create(data, userId) {
  return prisma.entry.create({ data: { ...data, createdById: userId || null } });
}

async function update(id, data) {
  await getById(id); // 404 if missing
  return prisma.entry.update({ where: { id }, data });
}

async function remove(id) {
  await getById(id);
  await prisma.entry.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
