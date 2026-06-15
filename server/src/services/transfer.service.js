'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list(q) {
  const where = {};
  if (q.account) where.OR = [{ fromId: q.account }, { toId: q.account }];
  if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = q.dateFrom;
    if (q.dateTo) where.date.lte = q.dateTo;
  }
  const page = q.page || 1;
  const limit = q.limit || 20;
  const [data, total] = await Promise.all([
    prisma.transfer.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.transfer.count({ where }),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

async function getById(id) {
  const t = await prisma.transfer.findUnique({ where: { id } });
  if (!t) throw ApiError.notFound('Transfer not found');
  return t;
}

async function assertAccounts(fromId, toId) {
  if (fromId === toId) throw ApiError.badRequest('Cannot transfer to the same account');
  const count = await prisma.account.count({ where: { id: { in: [fromId, toId] } } });
  if (count < 2) throw ApiError.badRequest('Both fromId and toId must reference existing accounts');
}

async function create(data, userId) {
  await assertAccounts(data.fromId, data.toId);
  return prisma.transfer.create({ data: { ...data, createdById: userId || null } });
}

async function remove(id) {
  await getById(id);
  await prisma.transfer.delete({ where: { id } });
}

module.exports = { list, getById, create, remove };
