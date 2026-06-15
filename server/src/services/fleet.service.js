'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list() {
  return prisma.fleet.findMany({ orderBy: { plate: 'asc' } });
}
async function getById(id) {
  const f = await prisma.fleet.findUnique({ where: { id } });
  if (!f) throw ApiError.notFound('Fleet vehicle not found');
  return f;
}
async function create(data) {
  return prisma.fleet.create({ data });
}
async function update(id, data) {
  await getById(id);
  return prisma.fleet.update({ where: { id }, data });
}
async function remove(id) {
  await getById(id);
  // Keep setoran history; just detach the fleet reference.
  await prisma.$transaction([
    prisma.setoran.updateMany({ where: { fleetId: id }, data: { fleetId: null } }),
    prisma.fleet.delete({ where: { id } }),
  ]);
}

module.exports = { list, getById, create, update, remove };
