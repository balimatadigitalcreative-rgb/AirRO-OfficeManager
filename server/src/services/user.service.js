'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { PUBLIC_FIELDS } = require('./auth.service');

async function list() {
  return prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
}
async function getById(id) {
  const u = await prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  if (!u) throw ApiError.notFound('User not found');
  return u;
}
async function create({ password, ...rest }) {
  const existing = await prisma.user.findUnique({ where: { username: rest.username } });
  if (existing) throw ApiError.conflict('Username is already taken');
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({ data: { ...rest, passwordHash }, select: PUBLIC_FIELDS });
}
async function update(id, { password, ...rest }) {
  await getById(id);
  const data = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
}
async function remove(id, currentUserId) {
  if (id === currentUserId) throw ApiError.badRequest('You cannot delete your own account');
  await getById(id);
  await prisma.user.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
