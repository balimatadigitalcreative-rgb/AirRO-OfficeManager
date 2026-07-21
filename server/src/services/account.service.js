'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const businessUnit = require('./businessUnit.service');

// Resolve an account's unit: 'shared' (Bersama) is kept verbatim; anything else resolves to a
// real unit id or defaults to "Air". A shared account shows only in the combined view, so its
// balance is never added into a single-unit total (no double-counting).
async function resolveAcctUnit(id) {
  if (id === 'shared') return 'shared';
  return businessUnit.resolveUnitId(id);
}

async function list() {
  return prisma.account.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

async function getById(id) {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) throw ApiError.notFound('Account not found');
  return account;
}

async function create(data) {
  const businessUnitId = await resolveAcctUnit(data.businessUnitId);
  return prisma.account.create({ data: { ...data, businessUnitId } });
}

async function update(id, data) {
  await getById(id);
  const safe = { ...data };
  if (safe.businessUnitId !== undefined) safe.businessUnitId = await resolveAcctUnit(safe.businessUnitId);
  return prisma.account.update({ where: { id }, data: safe });
}

async function remove(id) {
  await getById(id);
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
async function balance(id) {
  const account = await getById(id);
  const [income, expense, xferIn, xferOut] = await Promise.all([
    prisma.entry.aggregate({ _sum: { amount: true }, where: { accountId: id, type: 'income' } }),
    prisma.entry.aggregate({ _sum: { amount: true }, where: { accountId: id, type: 'expense' } }),
    prisma.transfer.aggregate({ _sum: { amount: true }, where: { toId: id } }),
    prisma.transfer.aggregate({ _sum: { amount: true }, where: { fromId: id } }),
  ]);
  const s = (a) => a._sum.amount || 0;
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
