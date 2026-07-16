'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { PUBLIC_FIELDS, publicUser, normUsername } = require('./auth.service');

// Guard: a user's role must reference an existing role in the Role table.
async function assertRole(role) {
  if (role == null) return;
  if (!(await prisma.role.count({ where: { id: role } }))) throw ApiError.badRequest(`Peran "${role}" tidak ada`);
}

// `permissions` arrives as an object (or null) and `fleetScope` as 'all' | string[] —
// both are stored as strings.
function normalize({ permissions, fleetScope, ...rest }) {
  const data = { ...rest };
  if (permissions !== undefined) {
    data.permissions = permissions ? JSON.stringify(permissions) : null;
  }
  if (fleetScope !== undefined) {
    data.fleetScope = (fleetScope === 'all' || fleetScope == null || (Array.isArray(fleetScope) && fleetScope.length === 0))
      ? 'all'
      : JSON.stringify((Array.isArray(fleetScope) ? fleetScope : []).filter((x) => typeof x === 'string' && x.trim()));
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
  if (rest.username != null) rest.username = normUsername(rest.username);   // case-insensitive
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
  if (rest.username != null) {
    rest.username = normUsername(rest.username);   // case-insensitive
    // Block a rename that would collide with a DIFFERENT user (avoids a raw unique-constraint 500).
    const clash = await prisma.user.findUnique({ where: { username: rest.username } });
    if (clash && clash.id !== id) throw ApiError.conflict('Username is already taken');
  }
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

// ── Password-reset requests (forgot-password → admin queue) ──────────────────
function resetReqClient(r) {
  return { id: r.id, username: r.username, note: r.note || '', status: r.status, requestedAt: r.requestedAt ? new Date(r.requestedAt).getTime() : null, handledByName: r.handledByName || null, handledAt: r.handledAt ? new Date(r.handledAt).getTime() : null };
}
// List reset requests (owner/GM). Default: pending first, newest first. Enrich with whether the
// username still maps to a real account so the UI can offer a one-click reset (or flag unknown).
async function listResetRequests(query) {
  const q = query || {};
  const where = {};
  if (q.status === 'pending' || q.status === 'selesai' || q.status === 'ditolak') where.status = q.status;
  const rows = await prisma.passwordResetRequest.findMany({ where, orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }], take: 200 });
  const names = [...new Set(rows.map((r) => r.username))];
  const users = names.length ? await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true, username: true, name: true, active: true } }) : [];
  const byName = {}; users.forEach((u) => { byName[u.username] = u; });
  return rows.map((r) => { const u = byName[r.username]; return { ...resetReqClient(r), userId: u ? u.id : null, userName: u ? u.name : null, userActive: u ? u.active : null }; });
}
// Mark a request handled (selesai) or rejected (ditolak). The actual password reset happens via
// the existing PATCH /users/:id { password, mustChangePassword } — this only closes the request.
async function handleResetRequest(id, status, actor) {
  if (status !== 'selesai' && status !== 'ditolak') throw ApiError.badRequest('Status tidak valid.');
  const r = await prisma.passwordResetRequest.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Permintaan tidak ditemukan.');
  let name = null;
  if (actor && actor.id) { try { const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); name = u && u.name; } catch (e) {} }
  const updated = await prisma.passwordResetRequest.update({ where: { id }, data: { status, handledById: (actor && actor.id) || null, handledByName: name, handledAt: new Date() } });
  console.info(`[auth] reset password: permintaan ${status} (username="${r.username}", id=${id}, oleh=${name || actor && actor.id})`);
  return resetReqClient(updated);
}

module.exports = { list, getById, create, update, remove, listResetRequests, handleResetRequest };
