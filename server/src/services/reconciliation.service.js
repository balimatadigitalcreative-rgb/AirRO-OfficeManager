'use strict';
// ACCOUNTING v2 — BANK RECONCILIATION. Reuses the Account model. A book movement (entry or transfer)
// touching a bank account is CLEARED once it appears on the statement; the cleared balance vs the
// statement balance is the running difference. Marks live in the Reconciliation table — the cash book
// is never modified. Served under the flag-gated /accounting router.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

async function actorName(actor) {
  if (actor && actor.name) return actor.name;
  if (actor && actor.id) { const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); if (u && u.name) return u.name; }
  return (actor && actor.username) || null;
}

// Every book movement on this account (income = +, expense = −; transfer in = +, out = −), oldest first.
async function accountMovements(accountId) {
  const acct = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acct) return null;
  const [entries, transfers] = await Promise.all([
    prisma.entry.findMany({ where: { acct: accountId, status: { not: 'Failed' } }, select: { id: true, date: true, time: true, type: true, amount: true, note: true, category: true } }),
    prisma.transfer.findMany({ where: { OR: [{ fromId: accountId }, { toId: accountId }] }, select: { id: true, date: true, amount: true, fromId: true, toId: true, note: true } }),
  ]);
  const items = [];
  for (const e of entries) items.push({ itemType: 'entry', itemId: e.id, date: e.date || '', time: e.time || '', desc: e.note || e.category || '—', amount: e.type === 'income' ? Number(e.amount) : -Number(e.amount) });
  for (const t of transfers) items.push({ itemType: 'transfer', itemId: t.id, date: t.date || '', time: '', desc: t.note || (t.toId === accountId ? 'Transfer masuk' : 'Transfer keluar'), amount: t.toId === accountId ? Number(t.amount) : -Number(t.amount) });
  items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { account: { id: acct.id, name: acct.name, type: acct.type, opening: Number(acct.opening) }, items };
}

// Full reconciliation for one account. `clearedBalance` = opening + Σ cleared movements. The running
// DIFFERENCE is (statement − cleared) when a statement balance is given, else the still-uncleared total.
async function reconcileView({ accountId, statementBalance } = {}) {
  const mv = await accountMovements(accountId);
  if (!mv) return null;
  const marks = await prisma.reconciliation.findMany({ where: { accountId } });
  const clearedSet = new Set(marks.map((m) => m.itemType + ':' + m.itemId));
  const refOf = {}; marks.forEach((m) => { refOf[m.itemType + ':' + m.itemId] = m.statementRef || ''; });
  let cleared = mv.account.opening, book = mv.account.opening;
  const unreconciled = [];
  const items = mv.items.map((it) => {
    const key = it.itemType + ':' + it.itemId;
    const isCleared = clearedSet.has(key);
    book += it.amount;
    if (isCleared) cleared += it.amount; else unreconciled.push(it);
    return { ...it, cleared: isCleared, statementRef: refOf[key] || '' };
  });
  const stmt = (statementBalance !== undefined && statementBalance !== null && statementBalance !== '') ? Math.round(Number(statementBalance)) : null;
  return {
    account: mv.account,
    items,
    bookBalance: book,
    clearedBalance: cleared,
    unreconciled,
    unreconciledCount: unreconciled.length,
    unclearedTotal: book - cleared,
    statementBalance: stmt,
    difference: stmt !== null ? stmt - cleared : book - cleared,
    reconciled: stmt !== null ? stmt - cleared === 0 : book - cleared === 0,
  };
}

async function markCleared({ accountId, itemType, itemId, cleared, statementRef }, actor) {
  if (!accountId || !['entry', 'transfer'].includes(itemType) || !itemId) throw ApiError.badRequest('Parameter rekonsiliasi tidak valid.');
  if (cleared === false) { await prisma.reconciliation.deleteMany({ where: { accountId, itemType, itemId } }); return { cleared: false }; }
  const name = await actorName(actor);
  await prisma.reconciliation.upsert({
    where: { accountId_itemType_itemId: { accountId, itemType, itemId } },
    update: { statementRef: statementRef || '', clearedById: (actor && actor.id) || null, clearedByName: name, clearedAt: new Date() },
    create: { accountId, itemType, itemId, statementRef: statementRef || '', clearedById: (actor && actor.id) || null, clearedByName: name },
  });
  return { cleared: true };
}

// Total still-uncleared across all bank accounts — feeds the period-close checklist (unreconciledBank).
async function unreconciledBankTotal() {
  const banks = await prisma.account.findMany({ where: { type: 'bank' }, select: { id: true } });
  let total = 0, count = 0;
  for (const b of banks) { const v = await reconcileView({ accountId: b.id }); if (v) { total += v.unclearedTotal; count += v.unreconciledCount; } }
  return { total, count };
}

module.exports = { accountMovements, reconcileView, markCleared, unreconciledBankTotal };
