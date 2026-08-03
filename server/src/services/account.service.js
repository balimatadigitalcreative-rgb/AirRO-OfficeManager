'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const businessUnit = require('./businessUnit.service');
const { unitWhere, canAccessUnit, assertCanAccessUnit, writableUnitFor } = require('../lib/scope');   // per-user business-unit access (Stage A/B)

// Resolve an account's unit: 'shared' (Bersama) is kept verbatim; anything else resolves to a
// real unit id or defaults to "Air". A shared account shows only in the combined view, so its
// balance is never added into a single-unit total (no double-counting).
async function resolveAcctUnit(id) {
  if (id === 'shared') return 'shared';
  return businessUnit.resolveUnitId(id);
}

// A unit-scoped user still sees 'shared' (Bersama) accounts — they belong to no single unit and
// appear in the combined view — but not another unit's accounts.
function acctScopeWhere(user) {
  const scoped = unitWhere(user);
  if (!Object.keys(scoped).length) return undefined;   // full access
  return { OR: [scoped, { businessUnitId: 'shared' }] };
}

async function list(user) {
  return prisma.account.findMany({ where: acctScopeWhere(user), orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

async function getById(id, user) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) throw ApiError.notFound('Account not found');
  if (user && account.businessUnitId !== 'shared' && !canAccessUnit(user, account.businessUnitId)) throw ApiError.notFound('Account not found');
  return account;
}

async function create(data, user) {
  let businessUnitId = await resolveAcctUnit(data.businessUnitId);
  // Stage B: a scoped user may only create an account in a unit they can access. 'shared' (Bersama)
  // is a common account visible to everyone, so it's always allowed.
  if (businessUnitId !== 'shared') {
    businessUnitId = writableUnitFor(user, data.businessUnitId, businessUnitId);
    await businessUnit.assertModuleEnabled(businessUnitId, 'finance');   // module toggle
  }
  return prisma.account.create({ data: { ...data, businessUnitId } });
}

async function update(id, data, user) {
  const cur = await getById(id, user);   // 404 if missing OR out of the actor's unit scope (Stage B)
  const safe = { ...data };
  if (safe.businessUnitId !== undefined) {
    safe.businessUnitId = await resolveAcctUnit(safe.businessUnitId);
    if (safe.businessUnitId !== 'shared') assertCanAccessUnit(user, safe.businessUnitId);   // no moving into another unit
  }
  // Module toggle: finance must be enabled for the effective unit (skip the always-shared account).
  const target = safe.businessUnitId !== undefined ? safe.businessUnitId : cur.businessUnitId;
  if (target !== 'shared') await businessUnit.assertModuleEnabled(target, 'finance');
  return prisma.account.update({ where: { id }, data: safe });
}

async function remove(id, user) {
  await getById(id, user);   // 404 if out of the actor's unit scope (Stage B)
  // Detach entries/transfers rather than cascade-deleting financial history.
  await prisma.$transaction([
    prisma.entry.updateMany({ where: { accountId: id }, data: { accountId: null } }),
    prisma.account.delete({ where: { id } }),
  ]).catch((e) => {
    // Transfers FK is required, so block deletion if the account is referenced.
    throw ApiError.conflict('Account is referenced by transfers; reassign or delete those first');
  });
}

// balance = opening + Σ(income) − Σ(expense) + Σ(transfers in) − Σ(transfers out)
async function balance(id, user) {
  const account = await getById(id, user);   // 404 if the account is outside the caller's unit scope (Stage B)
  const [income, expense, xferIn, xferOut] = await Promise.all([
    prisma.entry.aggregate({ _sum: { amount: true }, where: { accountId: id, type: 'income' } }),
    prisma.entry.aggregate({ _sum: { amount: true }, where: { accountId: id, type: 'expense' } }),
    prisma.transfer.aggregate({ _sum: { amount: true }, where: { toId: id } }),
    prisma.transfer.aggregate({ _sum: { amount: true }, where: { fromId: id } }),
  ]);
  const s = (a) => Number(a._sum.amount || 0);   // _sum on a BigInt money column is BigInt → coerce to Number
  const value = account.opening + s(income) - s(expense) + s(xferIn) - s(xferOut);
  return {
    accountId: id,
    opening: account.opening,
    income: s(income),
    expense: s(expense),
    transfersIn: s(xferIn),
    transfersOut: s(xferOut),
    balance: value,
  };
}

module.exports = { list, getById, create, update, remove, balance };
