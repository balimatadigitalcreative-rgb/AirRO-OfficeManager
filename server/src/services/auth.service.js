'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

const PUBLIC_FIELDS = {
  id: true, name: true, username: true, role: true, sub: true,
  color: true, active: true, createdAt: true,
};

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
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
  return { user, token: signToken(user) };
}

async function login({ username, password }) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) throw ApiError.unauthorized('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw ApiError.unauthorized('Invalid credentials');

  const { passwordHash, pin, updatedAt, ...safe } = user;
  return { user: safe, token: signToken(user) };
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_FIELDS });
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

module.exports = { register, login, me, signToken, PUBLIC_FIELDS };
