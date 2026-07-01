'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// Monthly installment = amount / installments (rounded).
const perInstallment = (r) => Math.round((r.amount || 0) / Math.max(1, r.installments || 1));
const withCalc = (r) => ({ ...r, perInstallment: perInstallment(r) });

async function list(q) {
  const where = {};
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.status) where.status = q.status;
  const rows = await prisma.cashbon.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  const data = rows.map(withCalc);
  const totalActive = data.filter((r) => r.status === 'active').reduce((a, r) => a + r.amount, 0);
  return { data, summary: { totalActive, count: data.length } };
}

async function getById(id) {
  const r = await prisma.cashbon.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Cashbon not found');
  return withCalc(r);
}

async function create(data) {
  const exists = await prisma.employee.count({ where: { id: data.employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  const r = await prisma.cashbon.create({ data });
  return withCalc(r);
}

async function update(id, data) {
  await getById(id);
  const r = await prisma.cashbon.update({ where: { id }, data });
  return withCalc(r);
}

async function remove(id) {
  await getById(id);
  await prisma.cashbon.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
