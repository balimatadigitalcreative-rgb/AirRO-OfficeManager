'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// setoran (deposit) = cash sales + bon (receivable) payments − field expenses.
const deposit = (r) => (r.cash || 0) + (r.bonPay || 0) - (r.expense || 0);
const withDeposit = (r) => ({ ...r, deposit: deposit(r) });

async function list(q) {
  const where = {};
  if (q.date) where.date = q.date;
  else if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = q.dateFrom;
    if (q.dateTo) where.date.lte = q.dateTo;
  }
  if (q.fleetId) where.fleetId = q.fleetId;

  const page = q.page || 1;
  const limit = q.limit || 50;
  const [rows, total] = await Promise.all([
    prisma.setoran.findMany({ where, include: { fleet: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.setoran.count({ where }),
  ]);
  const data = rows.map(withDeposit);
  const totalDeposit = data.reduce((a, r) => a + r.deposit, 0);
  return { data, summary: { totalDeposit, count: total }, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

async function getById(id) {
  const r = await prisma.setoran.findUnique({ where: { id }, include: { fleet: true } });
  if (!r) throw ApiError.notFound('Setoran not found');
  return withDeposit(r);
}

async function create(data, userId) {
  if (data.fleetId) {
    const exists = await prisma.fleet.count({ where: { id: data.fleetId } });
    if (!exists) throw ApiError.badRequest('fleetId does not reference an existing fleet vehicle');
  }
  const r = await prisma.setoran.create({ data: { ...data, createdById: userId || null }, include: { fleet: true } });
  return withDeposit(r);
}

async function update(id, data) {
  await getById(id);
  const r = await prisma.setoran.update({ where: { id }, data, include: { fleet: true } });
  return withDeposit(r);
}

async function remove(id) {
  await getById(id);
  await prisma.setoran.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
