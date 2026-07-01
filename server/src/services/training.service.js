'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list(q) {
  const where = {};
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.status) where.status = q.status;
  const rows = await prisma.training.findMany({ where, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] });
  const totalCost = rows.reduce((a, r) => a + (r.cost || 0), 0);
  return { data: rows, summary: { count: rows.length, totalCost } };
}

async function getById(id) {
  const r = await prisma.training.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Training not found');
  return r;
}

async function create(data) {
  const exists = await prisma.employee.count({ where: { id: data.employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  return prisma.training.create({ data });
}

async function update(id, data) {
  await getById(id);
  return prisma.training.update({ where: { id }, data });
}

async function remove(id) {
  await getById(id);
  await prisma.training.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
