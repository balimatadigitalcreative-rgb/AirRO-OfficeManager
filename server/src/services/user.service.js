'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');
const { PUBLIC_FIELDS, publicUser, normUsername, isWeakPassword } = require('./auth.service');
const { unitScopeOf } = require('../lib/scope');

// ── ADMIN AUDIT — every user/permission/role/scope/status change writes one row (actor, target,
// before→after diff). Best-effort: auditing NEVER blocks the underlying write.
function effDiff(before, after) {
  const be = resolvePerms(before.role, before.permissions), ae = resolvePerms(after.role, after.permissions);
  const keys = new Set([...Object.keys(be), ...Object.keys(ae)]);
  const added = [], removed = [];
  keys.forEach((k) => { const b = !!be[k], a = !!ae[k]; if (a && !b) added.push(k); if (b && !a) removed.push(k); });
  return { added: added.sort(), removed: removed.sort() };
}
async function writeAudit(target, actor, action, detail) {
  try {
    let actorName = null;
    if (actor && actor.id) { const a = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); actorName = a && a.name; }
    await prisma.userAuditLog.create({ data: { targetUserId: target.id, targetName: target.name || '', actorId: (actor && actor.id) || null, actorName, action, detail: JSON.stringify(detail || {}) } });
  } catch (e) { /* audit is best-effort */ }
}
function auditClient(r) {
  let detail = {}; try { detail = JSON.parse(r.detail || '{}'); } catch (e) {}
  return { id: r.id, targetUserId: r.targetUserId, targetName: r.targetName || '', actorName: r.actorName || null, action: r.action, detail, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null };
}
async function listAudit(userId, limit) {
  const where = userId ? { targetUserId: String(userId) } : {};
  const rows = await prisma.userAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(200, limit || 100) });
  return rows.map(auditClient);
}

// LOCKOUT GUARD: the system must never end up with zero ACTIVE users who hold
// `manageUsers` — otherwise nobody can ever administer users again. Given a pending
// change to one user (new perms / role / active, or a delete), recompute how many active
// users would still hold the (effective) capability and reject if that would hit zero.
// Covers the self-edit case too: removing your OWN manageUsers is only allowed while
// another active user still has it.
const holdsManageUsers = (u) => !!(u.active && resolvePerms(u.role, u.permissions).manageUsers);
async function assertManageUsersKept({ targetId, deleting, next }) {
  const users = await prisma.user.findMany({ select: { id: true, role: true, permissions: true, active: true } });
  let holders = 0;
  for (const u of users) {
    if (u.id === targetId) {
      if (deleting) continue;
      if (holdsManageUsers({ role: u.role, permissions: u.permissions, active: u.active, ...next })) holders++;
    } else if (holdsManageUsers(u)) {
      holders++;
    }
  }
  if (holders === 0) throw ApiError.badRequest('Minimal satu pengguna harus punya akses Kelola Pengguna.');
}

// UNIT-ACCESS LOCKOUT GUARD: the system must never end up with zero ACTIVE admins (manageUsers
// holders) who have ALL-unit access — otherwise no one could ever administer users across units,
// nor grant anyone back full access. Mirrors assertManageUsersKept for the unitScope='all' case:
// restricting the last all-access admin to specific unit(s) (or removing their manageUsers /
// deactivating / deleting them) is rejected.
const holdsAllUnitAdmin = (u) => holdsManageUsers(u) && unitScopeOf(u) === null;
async function assertUnitAccessKept({ targetId, deleting, next }) {
  const users = await prisma.user.findMany({ select: { id: true, role: true, permissions: true, active: true, unitScope: true } });
  let holders = 0;
  for (const u of users) {
    if (u.id === targetId) {
      if (deleting) continue;
      if (holdsAllUnitAdmin({ role: u.role, permissions: u.permissions, active: u.active, unitScope: u.unitScope, ...next })) holders++;
    } else if (holdsAllUnitAdmin(u)) {
      holders++;
    }
  }
  if (holders === 0) throw ApiError.badRequest('Minimal satu admin (Kelola Pengguna) harus punya akses semua unit bisnis.');
}

// ── SELF-APPROVAL GRANT GUARD (owner-only) ───────────────────────────────────
// distribusiApproveSelf and its rupiah ceiling (maxSelfApproveAmount) are a deliberate waiver of
// segregation of duties, so ONLY the owner may change them — even though a GM also holds manageUsers
// and can edit every other capability. Resolved LIVE from the DB (never the token role), mirroring
// how the caps themselves are read. Revoking is also gated (a control change in either direction).
async function actorIsOwner(actor) {
  if (!actor || !actor.id) return false;
  const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true } });
  return !!(u && u.role === 'owner');
}
const selfApproveState = (role, perms) => {
  const e = resolvePerms(role, perms);
  return { cap: !!e.distribusiApproveSelf, limit: parseInt(e.maxSelfApproveAmount, 10) || 0 };
};
async function assertSelfApproveGrantAllowed({ beforeRole, beforePerms, afterRole, afterPerms, actor }) {
  const b = selfApproveState(beforeRole, beforePerms);
  const a = selfApproveState(afterRole, afterPerms);
  if ((b.cap !== a.cap || b.limit !== a.limit) && !(await actorIsOwner(actor))) {
    throw ApiError.forbidden('Hanya Pemilik yang boleh mengubah izin "Setujui Pengajuan Sendiri" atau batas nominalnya.');
  }
}

// Guard: a user's role must reference an existing role in the Role table.
async function assertRole(role) {
  if (role == null) return;
  if (!(await prisma.role.count({ where: { id: role } }))) throw ApiError.badRequest(`Peran "${role}" tidak ada`);
}

// `permissions` arrives as an object (or null); `fleetScope` and `unitScope` as 'all' | string[] —
// all are stored as strings.
const scopeToStr = (v) => (v === 'all' || v == null || (Array.isArray(v) && v.length === 0))
  ? 'all'
  : JSON.stringify((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()));
function normalize({ permissions, fleetScope, unitScope, ...rest }) {
  const data = { ...rest };
  if (permissions !== undefined) {
    data.permissions = permissions ? JSON.stringify(permissions) : null;
  }
  if (fleetScope !== undefined) data.fleetScope = scopeToStr(fleetScope);
  if (unitScope !== undefined) data.unitScope = scopeToStr(unitScope);
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
async function create({ password, ...rest }, actor) {
  if (rest.username != null) rest.username = normUsername(rest.username);   // case-insensitive
  const existing = await prisma.user.findUnique({ where: { username: rest.username } });
  if (existing) throw ApiError.conflict('Username is already taken');
  await assertRole(rest.role);
  // Owner-only: a new user may only be created WITH self-approval already granted by an owner.
  await assertSelfApproveGrantAllowed({ beforeRole: rest.role, beforePerms: null, afterRole: rest.role, afterPerms: rest.permissions || null, actor });
  const passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.user.create({ data: { ...normalize(rest), passwordHash, weakPassword: isWeakPassword(password) }, select: PUBLIC_FIELDS });
  const pub = publicUser(u);
  await writeAudit(pub, actor, 'create', { role: pub.role });
  return pub;
}
async function update(id, { password, ...rest }, actor) {
  const before = await getById(id);
  await assertRole(rest.role);
  // Owner-only: granting/revoking self-approval (or changing its ceiling) is a control change even
  // when the rest of the permission edit is allowed for a GM admin. Checked against the resolved
  // before/after so a GM can still toggle every OTHER capability freely.
  if ('permissions' in rest || 'role' in rest) {
    await assertSelfApproveGrantAllowed({
      beforeRole: before.role, beforePerms: before.permissions,
      afterRole: 'role' in rest ? rest.role : before.role,
      afterPerms: 'permissions' in rest ? rest.permissions : before.permissions,
      actor,
    });
  }
  if (rest.username != null) {
    rest.username = normUsername(rest.username);   // case-insensitive
    // Block a rename that would collide with a DIFFERENT user (avoids a raw unique-constraint 500).
    const clash = await prisma.user.findUnique({ where: { username: rest.username } });
    if (clash && clash.id !== id) throw ApiError.conflict('Username is already taken');
  }
  // Lockout guard — only when a change could remove a manageUsers holder.
  if ('permissions' in rest || 'active' in rest || 'role' in rest) {
    const next = {};
    if ('permissions' in rest) next.permissions = rest.permissions;   // object | null (= role default)
    if ('active' in rest) next.active = rest.active;
    if ('role' in rest) next.role = rest.role;
    await assertManageUsersKept({ targetId: id, next });
  }
  // Unit-access lockout guard — a change to unitScope (or anything that could strip an all-unit
  // admin: manageUsers via permissions/role, or deactivation) must not remove the last one.
  if ('unitScope' in rest || 'permissions' in rest || 'active' in rest || 'role' in rest) {
    const next = {};
    if ('unitScope' in rest) next.unitScope = rest.unitScope;
    if ('permissions' in rest) next.permissions = rest.permissions;
    if ('active' in rest) next.active = rest.active;
    if ('role' in rest) next.role = rest.role;
    await assertUnitAccessKept({ targetId: id, next });
  }
  const data = normalize(rest);
  if (password) { data.passwordHash = await bcrypt.hash(password, 10); data.weakPassword = isWeakPassword(password); }   // admin reset → re-evaluate the flag
  const u = await prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
  const after = publicUser(u);
  // AUDIT (best-effort) — one entry per changed dimension, with the before→after diff.
  if ('permissions' in rest || 'role' in rest) { const d = effDiff(before, after); if (d.added.length || d.removed.length) await writeAudit(after, actor, 'permissions', d); }
  if ('role' in rest && before.role !== after.role) await writeAudit(after, actor, 'role', { from: before.role, to: after.role });
  if ('active' in rest && before.active !== after.active) await writeAudit(after, actor, 'active', { from: before.active, to: after.active });
  if ('fleetScope' in rest && JSON.stringify(before.fleetScope) !== JSON.stringify(after.fleetScope)) await writeAudit(after, actor, 'fleetScope', { from: before.fleetScope, to: after.fleetScope });
  if ('unitScope' in rest && JSON.stringify(before.unitScope) !== JSON.stringify(after.unitScope)) await writeAudit(after, actor, 'unitScope', { from: before.unitScope, to: after.unitScope });
  if (password) await writeAudit(after, actor, 'password', {});
  return after;
}
async function remove(id, currentUserId, actor) {
  if (id === currentUserId) throw ApiError.badRequest('You cannot delete your own account');
  const target = await getById(id);
  await assertManageUsersKept({ targetId: id, deleting: true });   // don't delete the last admin
  await assertUnitAccessKept({ targetId: id, deleting: true });    // …nor the last all-unit admin
  await prisma.user.delete({ where: { id } });
  await writeAudit(target, actor || { id: currentUserId }, 'delete', { role: target.role });
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

module.exports = { list, getById, create, update, remove, listResetRequests, handleResetRequest, listAudit };
