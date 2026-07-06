'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { PUBLIC_FIELDS, publicUser } = require('./auth.service');

// Guard: a user's role must reference an existing role in the Role table.
async function assertRole(role) {
  if (role == null) return;
  if (!(await prisma.role.count({ where: { id: role } }))) throw ApiError.badRequest(`Peran "${role}" tidak ada`);
}

// `permissions` arrives as an object (or null) — store it as a JSON string.
function normalize({ permissions, ...rest }) {
  const data = { ...rest };
  if (permissions !== undefined) {
    data.permissions = permissions ? JSON.stringify(permissions) : null;
  }
  return data;
}

async function list() {
  const rows = await prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
  return rows.map(publicUser);
}
async function getById(id) {
  const u = await prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
  if (!u) throw ApiError.notFound('User not found');
  return publicUser(u);
}
async function create({ password, ...rest }) {
  const existing = await prisma.user.findUnique({ where: { username: rest.username } });
  if (existing) throw ApiError.conflict('Username is already taken');
  await assertRole(rest.role);
  const passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.user.create({ data: { ...normalize(rest), passwordHash }, select: PUBLIC_FIELDS });
  return publicUser(u);
}
async function update(id, { password, ...rest }) {
  await getById(id);
  await assertRole(rest.role);
  const data = normalize(rest);
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
  return publicUser(u);
}
async function remove(id, currentUserId) {
  if (id === currentUserId) throw ApiError.badRequest('You cannot delete your own account');
  await getById(id);
  await prisma.user.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
