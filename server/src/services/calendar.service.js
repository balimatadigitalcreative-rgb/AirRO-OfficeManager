'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list(q) {
  const where = {};
  if (q.type) where.type = q.type;
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.dateFrom || q.dateTo) {
    where.startDate = {};
    if (q.dateFrom) where.startDate.gte = q.dateFrom;
    if (q.dateTo) where.startDate.lte = q.dateTo;
  }
  const rows = await prisma.calendarEvent.findMany({ where, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] });
  return { data: rows, summary: { count: rows.length } };
}

async function getById(id) {
  const r = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Calendar event not found');
  return r;
}

async function create(data) {
  if (data.employeeId) {
    const exists = await prisma.employee.count({ where: { id: data.employeeId } });
    if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  }
  return prisma.calendarEvent.create({ data });
}

async function update(id, data) {
  await getById(id);
  return prisma.calendarEvent.update({ where: { id }, data });
}

async function remove(id) {
  await getById(id);
  await prisma.calendarEvent.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
