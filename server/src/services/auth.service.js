'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');
const { parsePerms } = require('../config/permissions');

const PASSWORD_MIN = 8;   // minimum length for a user-chosen password (self change)
const PUBLIC_FIELDS = {
  id: true, name: true, username: true, role: true, sub: true,
  color: true, active: true, permissions: true, fleetScope: true, mustChangePassword: true, createdAt: true,
};

// Distribusi fleet access is stored as a string: "all" or a JSON array of fleet names.
// Parse to 'all' or an array for API responses.
function parseFleetScope(str) {
  if (str == null || str === 'all' || str === '') return 'all';
  try { const a = JSON.parse(str); if (Array.isArray(a)) return a.filter((x) => typeof x === 'string' && x.trim()); if (a === 'all') return 'all'; } catch (e) {}
  return 'all';
}

// Shape a user row for API responses: permissions + fleetScope returned parsed.
function publicUser(user) {
  return { ...user, permissions: parsePerms(user.permissions), fleetScope: parseFleetScope(user.fleetScope) };
}

function signToken(user) {
  return jwt.sign(
    // The raw permissions JSON string + fleetScope travel in the token; the server
    // resolves them (requireCap / distribusi fleet filter). Changing them takes effect
    // on the user's next login.
    { sub: user.id, role: user.role, username: user.username, permissions: user.permissions || null, fleetScope: user.fleetScope || 'all' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

// Usernames are case-INSENSITIVE everywhere: always normalise to lowercase before storing
// or looking up. The controller schema also lowercases; this is the defensive backstop.
const normUsername = (u) => String(u || '').trim().toLowerCase();

async function register({ name, username, password, role, sub, color }) {
  const uname = normUsername(username);
  const existing = await prisma.user.findUnique({ where: { username: uname } });
  if (existing) throw ApiError.conflict('Username is already taken');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, username: uname, passwordHash, role, sub, color },
    select: PUBLIC_FIELDS,
  });
  return { user: publicUser(user), token: signToken(user) };
}

async function login({ username, password }) {
  const uname = normUsername(username);
  const user = await prisma.user.findUnique({ where: { username: uname } });
  // SECURITY: the message returned to the client is ALWAYS generic (never reveal whether the
  // user exists / is inactive / the password is wrong). The real reason is only logged
  // server-side so the owner can diagnose from the server logs.
  if (!user) { console.warn(`[auth] login gagal — user tidak ditemukan (username="${uname}")`); throw ApiError.unauthorized('Invalid credentials'); }
  if (!user.active) { console.warn(`[auth] login gagal — akun nonaktif (username="${uname}", id=${user.id})`); throw ApiError.unauthorized('Invalid credentials'); }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) { console.warn(`[auth] login gagal — password salah (username="${uname}", id=${user.id})`); throw ApiError.unauthorized('Invalid credentials'); }

  const { passwordHash, pin, updatedAt, ...safe } = user;
  return { user: publicUser(safe), token: signToken(user) };
}

// Forgot-password (request-to-admin; no email). ALWAYS succeeds silently from the client's
// point of view — the caller returns the same generic message regardless, so a probe can't tell
// whether the username exists. A request row is created ONLY for a real, active user (a pending
// one is reused, not duplicated); unknown/inactive usernames are logged server-side and dropped.
async function requestPasswordReset({ username, note }) {
  const uname = normUsername(username);
  const cleanNote = String(note || '').slice(0, 300).trim();
  const user = await prisma.user.findUnique({ where: { username: uname } });
  if (!user || !user.active) {
    console.warn(`[auth] reset password diminta untuk username tak terpakai (username="${uname}") — diabaikan, balasan tetap generik`);
    return { ok: true };   // generic path — nothing created, nothing leaked
  }
  const existing = await prisma.passwordResetRequest.findFirst({ where: { username: uname, status: 'pending' } });
  if (existing) {
    await prisma.passwordResetRequest.update({ where: { id: existing.id }, data: { requestedAt: new Date(), note: cleanNote || existing.note } });
    console.info(`[auth] reset password: permintaan pending diperbarui (username="${uname}", id=${existing.id})`);
  } else {
    const r = await prisma.passwordResetRequest.create({ data: { username: uname, note: cleanNote } });
    console.info(`[auth] reset password: permintaan baru (username="${uname}", id=${r.id})`);
  }
  return { ok: true };
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_FIELDS });
  if (!user) throw ApiError.notFound('User not found');
  return publicUser(user);
}

// A user changes their OWN password: verify the current one, then store the new
// hash (bcrypt) and clear the force-change flag. The password is never returned.
async function changePassword(userId, oldPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');
  const ok = await bcrypt.compare(oldPassword || '', user.passwordHash);
  if (!ok) throw ApiError.unauthorized('Password lama salah');
  if (!newPassword || newPassword.length < PASSWORD_MIN) throw ApiError.badRequest(`Password baru minimal ${PASSWORD_MIN} karakter`);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
  return { ok: true };
}

// A user edits their OWN profile — display name and avatar colour only. Sensitive
// fields (role, permissions, username, salary/position) are intentionally NOT
// updatable here; those stay under HRD/owner control via user management.
async function updateProfile(userId, { name, color }) {
  const data = {};
  if (name != null) data.name = name;
  if (color != null) data.color = color;
  if (!Object.keys(data).length) return me(userId);
  const user = await prisma.user.update({ where: { id: userId }, data, select: PUBLIC_FIELDS });
  return publicUser(user);
}

module.exports = { register, login, requestPasswordReset, me, changePassword, updateProfile, signToken, publicUser, normUsername, PUBLIC_FIELDS, PASSWORD_MIN };
