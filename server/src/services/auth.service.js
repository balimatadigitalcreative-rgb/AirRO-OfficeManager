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
  color: true, active: true, permissions: true, mustChangePassword: true, createdAt: true,
};

// Shape a user row for API responses: permissions returned as a parsed object.
function publicUser(user) {
  return { ...user, permissions: parsePerms(user.permissions) };
}

function signToken(user) {
  return jwt.sign(
    // The raw permissions JSON string travels in the token; requireCap resolves it.
    { sub: user.id, role: user.role, username: user.username, permissions: user.permissions || null },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

async function register({ name, username, password, role, sub, color }) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw ApiError.conflict('Username is already taken');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, username, passwordHash, role, sub, color },
    select: PUBLIC_FIELDS,
  });
  return { user: publicUser(user), token: signToken(user) };
}

async function login({ username, password }) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) throw ApiError.unauthorized('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw ApiError.unauthorized('Invalid credentials');

  const { passwordHash, pin, updatedAt, ...safe } = user;
  return { user: publicUser(safe), token: signToken(user) };
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

module.exports = { register, login, me, changePassword, updateProfile, signToken, publicUser, PUBLIC_FIELDS, PASSWORD_MIN };
