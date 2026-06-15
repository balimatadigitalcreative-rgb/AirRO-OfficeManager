'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list(includeInactive) {
  return prisma.employee.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: 'asc' },
  });
}
async function getById(id) {
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw ApiError.notFound('Employee not found');
  return e;
}
async function create(data) {
  return prisma.employee.create({ data });
}
async function update(id, data) {
  await getById(id);
  return prisma.employee.update({ where: { id }, data });
}
async function remove(id) {
  await getById(id);
  await prisma.employee.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
