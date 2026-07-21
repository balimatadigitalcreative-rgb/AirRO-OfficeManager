'use strict';
// Stage 4 — inter-unit transfers. ONE internal money movement between two business units, stored
// as a LINKED PAIR of Entry rows created atomically:
//   • payer leg    — an EXPENSE in the from-unit, on the from-account
//   • receiver leg — an INCOME  in the to-unit,  on the to-account
// Both share a transferGroupId and carry interUnit=true + counterpart{Unit,Account}Id. The
// combined view eliminates the pair from company income/expense (it nets to zero); each single
// unit sees its own leg as real income/expense. This is NOT the setoranMfg "biaya produksi"
// reference (that is a single, unpaired reference-cost estimate with no income counterpart and no
// transferGroupId) — so a manual transfer and the setoran reference never double-count.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const businessUnit = require('./businessUnit.service');

function newGroupId() { return 'iut_' + require('crypto').randomBytes(9).toString('hex'); }

// Snapshot the actor from the token (never the body) so both legs are audited to a real identity.
async function actorSnap(userId) {
  const snap = { createdById: userId || null };
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (u) { snap.createdByName = u.name; snap.createdByRole = u.role; }
  }
  return snap;
}

async function createTransfer(body, actor) {
  const amount = Math.round(+body.amount || 0);
  if (amount <= 0) throw ApiError.badRequest('Nominal transfer harus lebih dari 0.');
  const fromUnit = await businessUnit.resolveUnitId(body.fromUnitId);
  const toUnit = await businessUnit.resolveUnitId(body.toUnitId);
  if (fromUnit === toUnit) throw ApiError.badRequest('Unit asal dan tujuan harus berbeda.');
  const fromAccount = body.fromAccountId ? String(body.fromAccountId) : null;
  const toAccount = body.toAccountId ? String(body.toAccountId) : null;
  if (!fromAccount || !toAccount) throw ApiError.badRequest('Pilih akun asal dan tujuan.');
  if (fromAccount === toAccount) throw ApiError.badRequest('Akun asal dan tujuan harus berbeda.');
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest('Tanggal tidak valid.');
  const note = String(body.note || '').trim().slice(0, 2000);
  const category = body.category ? String(body.category).slice(0, 60) : null;
  const groupId = newGroupId();
  const snap = await actorSnap(actor && actor.id);

  const common = { amount, date, time: body.time || '00:00', category, note, interUnit: true, transferGroupId: groupId, ...snap };
  // Payer leg (expense, from-unit) + receiver leg (income, to-unit). One DB transaction so a leg
  // can never exist without its partner.
  const [payer, receiver] = await prisma.$transaction([
    prisma.entry.create({ data: { ...common, type: 'expense', businessUnitId: fromUnit, acct: fromAccount, method: 'Transfer', counterpartUnitId: toUnit, counterpartAccountId: toAccount } }),
    prisma.entry.create({ data: { ...common, type: 'income', businessUnitId: toUnit, acct: toAccount, method: 'Transfer', counterpartUnitId: fromUnit, counterpartAccountId: fromAccount } }),
  ]);
  return { transferGroupId: groupId, amount, fromUnit, toUnit, payer, receiver };
}

// List one transfer's legs (for the void confirmation / detail).
async function getTransfer(groupId) {
  const legs = await prisma.entry.findMany({ where: { transferGroupId: String(groupId), interUnit: true } });
  if (!legs.length) throw ApiError.notFound('Transfer tidak ditemukan');
  return legs;
}

// Void = permanently remove BOTH legs atomically. Reversing one always reverses both, so a leg is
// never orphaned. Permanent (no soft-undo); the linked pair simply ceases to exist.
async function voidTransfer(groupId) {
  const legs = await getTransfer(groupId);
  await prisma.entry.deleteMany({ where: { transferGroupId: String(groupId), interUnit: true } });
  return { transferGroupId: String(groupId), voided: legs.length };
}

module.exports = { createTransfer, getTransfer, voidTransfer };
