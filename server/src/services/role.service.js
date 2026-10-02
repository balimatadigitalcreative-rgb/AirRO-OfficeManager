'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { parsePerms, OWNER_ROLE, isOwnerRole } = require('../config/permissions');

function toClient(r) {
  return { id: r.id, name: r.name, color: r.color, permissions: parsePerms(r.permissions) || {}, builtin: r.builtin, sortOrder: r.sortOrder };
}
// derive a safe role id from a name (e.g. "Supervisor Gudang" → "supervisor-gudang")
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// distribusiApproveSelf (+ its ceiling) is a Pemilik-only grant — per user (user.service) AND through a
// role template (else a manageUsers holder, e.g. a GM, could hand it to a whole role).
const WAIVER_KEYS = ['distribusiApproveSelf', 'maxSelfApproveAmount'];
async function assertWaiverGrant(beforeJson, after, actor) {
  if (after == null) return;
  const before = parsePerms(beforeJson) || {};
  const val = (o, k) => JSON.stringify(o[k] === undefined || o[k] === false ? null : o[k]);
  if (!WAIVER_KEYS.some((k) => val(before, k) !== val(after, k))) return;
  const u = actor && actor.id ? await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true } }) : null;
  if (!(u && isOwnerRole(u.role))) throw ApiError.forbidden('Hanya Pemilik yang boleh memberi izin menyetujui pengajuan sendiri.');
}

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

async function create({ id, name, color, permissions }, actor) {
  await assertWaiverGrant(null, permissions || {}, actor);
  const nm = String(name || '').trim();
  if (!nm) throw ApiError.badRequest('Nama peran wajib diisi');
  const rid = (id && slug(id)) || slug(nm);
  if (!rid) throw ApiError.badRequest('Nama peran tidak valid');
  if (await prisma.role.findUnique({ where: { id: rid } })) throw ApiError.conflict('Peran dengan nama itu sudah ada');
  const count = await prisma.role.count();
  const r = await prisma.role.create({ data: { id: rid, name: nm, color: color || '#22A7A1', permissions: JSON.stringify(permissions || {}), builtin: false, sortOrder: count } });
  return toClient(r);
}
async function update(id, { name, color, permissions }, actor) {
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Role not found');
  await assertWaiverGrant(existing.permissions, permissions, actor);
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
