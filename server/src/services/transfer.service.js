'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { unitWhere, canAccessUnit, unitScopeOf } = require('../lib/scope');   // per-user business-unit access (Stage B)
const businessUnit = require('./businessUnit.service');   // module toggle (finance)

// A Transfer has NO businessUnitId of its own — its unit is that of the from/to accounts. So a
// scoped user may see a transfer only when it TOUCHES one of their units (either leg's account),
// and may INITIATE one only FROM an account in a unit they can access (the receiving account may be
// any unit — that is the whole point of an inter-unit move). Full-access users are unconstrained.
function transferScopeWhere(user) {
  const frag = unitWhere(user);                 // {} when full access
  if (!Object.keys(frag).length) return null;   // no restriction
  return { OR: [{ from: frag }, { to: frag }] };
}

async function list(q, user) {
  const base = {};
  if (q.account) base.OR = [{ fromId: q.account }, { toId: q.account }];
  if (q.dateFrom || q.dateTo) {
    base.date = {};
    if (q.dateFrom) base.date.gte = q.dateFrom;
    if (q.dateTo) base.date.lte = q.dateTo;
  }
  const scope = transferScopeWhere(user);
  const where = scope ? { AND: [base, scope] } : base;
  const page = q.page || 1;
  const limit = q.limit || 20;
  const [data, total] = await Promise.all([
    prisma.transfer.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.transfer.count({ where }),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

async function getById(id, user) {
  const t = await prisma.transfer.findUnique({ where: { id }, include: { from: true, to: true } });
  if (!t) throw ApiError.notFound('Transfer not found');
  // Out of scope only when NEITHER leg touches the caller's units (404, never reveal existence).
  if (user && unitScopeOf(user) !== null && !canAccessUnit(user, t.from && t.from.businessUnitId) && !canAccessUnit(user, t.to && t.to.businessUnitId)) {
    throw ApiError.notFound('Transfer not found');
  }
  const { from, to, ...row } = t;
  return row;
}

async function assertAccounts(fromId, toId) {
  if (fromId === toId) throw ApiError.badRequest('Cannot transfer to the same account');
  const count = await prisma.account.count({ where: { id: { in: [fromId, toId] } } });
  if (count < 2) throw ApiError.badRequest('Both fromId and toId must reference existing accounts');
}

async function create(data, user) {
  await assertAccounts(data.fromId, data.toId);
  const from = await prisma.account.findUnique({ where: { id: data.fromId }, select: { businessUnitId: true } });
  // Stage B: a scoped user may only move money OUT of a unit they can access (the PAYING account).
  if (user && unitScopeOf(user) !== null && (!from || !canAccessUnit(user, from.businessUnitId))) {
    throw ApiError.forbidden('Anda tidak punya akses ke unit bisnis akun sumber transfer.');
  }
  // Module toggle: a transfer is a finance action — the PAYING account's unit must have finance on.
  if (from) await businessUnit.assertModuleEnabledForUser(user, from.businessUnitId, 'finance');
  return prisma.transfer.create({ data: { ...data, createdById: (user && user.id) || null } });
}

async function remove(id, user) {
  await getById(id, user);   // 404 if the transfer touches none of the caller's units
  await prisma.transfer.delete({ where: { id } });
}

module.exports = { list, getById, create, remove };
