'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { parsePerms, OWNER_ROLE } = require('../config/permissions');

function toClient(r) {
  return { id: r.id, name: r.name, color: r.color, permissions: parsePerms(r.permissions) || {}, builtin: r.builtin, sortOrder: r.sortOrder };
}
// derive a safe role id from a name (e.g. "Supervisor Gudang" → "supervisor-gudang")
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function list() {
  const rows = await prisma.role.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(toClient);
}
async function getById(id) {
  const r = await prisma.role.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Role not found');
  return toClient(r);
}
async function roleExists(id) { return (await prisma.role.count({ where: { id } })) > 0; }
async function usageCount(id) { return prisma.user.count({ where: { role: id } }); }

async function create({ id, name, color, permissions }) {
  const nm = String(name || '').trim();
  if (!nm) throw ApiError.badRequest('Nama peran wajib diisi');
  const rid = (id && slug(id)) || slug(nm);
  if (!rid) throw ApiError.badRequest('Nama peran tidak valid');
  if (await prisma.role.findUnique({ where: { id: rid } })) throw ApiError.conflict('Peran dengan nama itu sudah ada');
  const count = await prisma.role.count();
  const r = await prisma.role.create({ data: { id: rid, name: nm, color: color || '#22A7A1', permissions: JSON.stringify(permissions || {}), builtin: false, sortOrder: count } });
  return toClient(r);
}
async function update(id, { name, color, permissions }) {
  if (!(await prisma.role.findUnique({ where: { id } }))) throw ApiError.notFound('Role not found');
  const data = {};
  if (name != null) { const nm = String(name).trim(); if (!nm) throw ApiError.badRequest('Nama peran wajib diisi'); data.name = nm; }
  if (color != null) data.color = String(color);
  if (permissions != null) data.permissions = JSON.stringify(permissions);
  const r = await prisma.role.update({ where: { id }, data });
  return toClient(r);
}
async function remove(id) {
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Role not found');
  if (existing.builtin || id === OWNER_ROLE) throw ApiError.badRequest('Peran bawaan tidak bisa dihapus');
  const used = await usageCount(id);
  if (used > 0) throw ApiError.conflict(`Peran masih dipakai ${used} user — pindahkan mereka ke peran lain dulu.`, { used });
  await prisma.role.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, roleExists, usageCount, toClient };
