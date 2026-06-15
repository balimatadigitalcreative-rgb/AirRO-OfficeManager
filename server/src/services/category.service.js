'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function list(type) {
  return prisma.category.findMany({ where: type ? { type } : undefined, orderBy: { label: 'asc' } });
}
async function getById(id) {
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Category not found');
  return c;
}
async function create(data) {
  return prisma.category.create({ data });
}
async function update(id, data) {
  await getById(id);
  return prisma.category.update({ where: { id }, data });
}
async function remove(id) {
  const c = await getById(id);
  const used = await prisma.entry.count({ where: { categoryKey: c.key } });
  if (used > 0) throw ApiError.conflict(`Category is used by ${used} entries; reassign them first`);
  await prisma.category.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
