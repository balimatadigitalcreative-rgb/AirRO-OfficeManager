'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { unitWhere, canAccessUnit, assertCanAccessUnit, writableUnitFor } = require('../lib/scope');   // per-user business-unit access (Stage A/B)

// setoran (deposit) = cash sales + bon (receivable) payments − field expenses.
const deposit = (r) => (r.cash || 0) + (r.bonPay || 0) - (r.expense || 0);
const withDeposit = (r) => ({ ...r, deposit: deposit(r) });

async function list(q, user) {
  const base = {};
  if (q.date) base.date = q.date;
  else if (q.dateFrom || q.dateTo) {
    base.date = {};
    if (q.dateFrom) base.date.gte = q.dateFrom;
    if (q.dateTo) base.date.lte = q.dateTo;
  }
  if (q.fleetId) base.fleetId = q.fleetId;
  if (q.since) base.updatedAt = { gte: new Date(q.since) };
  // Per-user unit access enforced server-side (setoran carries businessUnitId; null ⇒ "air").
  const where = { AND: [base, unitWhere(user)] };

  const page = q.page || 1;
  const limit = q.limit || 1000;
  const [rows, total] = await Promise.all([
    prisma.setoran.findMany({ where, include: { fleet: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.setoran.count({ where }),
  ]);
  const data = rows.map(withDeposit);
  const totalDeposit = data.reduce((a, r) => a + r.deposit, 0);
  // `now` lets the client run an incremental (?since=) poll next time; `total` is the
  // authoritative current count for the migration's before/after verification.
  return { data, now: new Date().toISOString(), summary: { totalDeposit, count: total }, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
}

async function getById(id, user) {
  const r = await prisma.setoran.findUnique({ where: { id }, include: { fleet: true } });
  if (!r) throw ApiError.notFound('Setoran not found');
  if (user && !canAccessUnit(user, r.businessUnitId)) throw ApiError.notFound('Setoran not found');
  return withDeposit(r);
}

async function create(data, actor) {
  if (data.fleetId) {
    const exists = await prisma.fleet.count({ where: { id: data.fleetId } });
    if (!exists) throw ApiError.badRequest('fleetId does not reference an existing fleet vehicle');
  }
  // Stage B: a setoran carries a businessUnitId (default "air"). A scoped user may only create in a
  // unit they can access; an unspecified unit lands in their first allowed unit.
  const businessUnitId = writableUnitFor(actor, data.businessUnitId, data.businessUnitId || 'air');
  const r = await prisma.setoran.create({ data: { ...data, businessUnitId, createdById: (actor && actor.id) || null }, include: { fleet: true } });
  return withDeposit(r);
}

async function update(id, data, actor) {
  await getById(id, actor);   // 404 if the row is outside the caller's unit scope (Stage B)
  const safe = { ...data };
  if (safe.businessUnitId !== undefined) assertCanAccessUnit(actor, safe.businessUnitId);   // no moving into another unit
  const r = await prisma.setoran.update({ where: { id }, data: safe, include: { fleet: true } });
  return withDeposit(r);
}

async function remove(id, actor) {
  await getById(id, actor);   // 404 if outside scope
  await prisma.setoran.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove };
