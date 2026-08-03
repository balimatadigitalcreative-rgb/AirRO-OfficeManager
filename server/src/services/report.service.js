'use strict';
const prisma = require('../lib/prisma');
const { unitWhere } = require('../lib/scope');   // per-user business-unit access (Stage B)

function dateWhere(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return {};
  const date = {};
  if (dateFrom) date.gte = dateFrom;
  if (dateTo) date.lte = dateTo;
  return { date };
}

// Every report is scoped to the caller's unit(s): a user restricted to "air" gets totals/series/
// breakdowns for their unit(s) only — never the whole company. The AND-wrap keeps unitWhere's own
// OR (null-⇒-air) from colliding with the status/date/type predicates.
const scopedWhere = (user, base) => ({ AND: [base, unitWhere(user)] });

// Revenue / expense / net-profit headline for a date range.
async function summary({ dateFrom, dateTo } = {}, user) {
  const where = { status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) };
  const [income, expense] = await Promise.all([
    prisma.entry.aggregate({ _sum: { amount: true }, _count: true, where: scopedWhere(user, { ...where, type: 'income' }) }),
    prisma.entry.aggregate({ _sum: { amount: true }, _count: true, where: scopedWhere(user, { ...where, type: 'expense' }) }),
  ]);
  const revenue = Number(income._sum.amount || 0);   // _sum on a BigInt money column is BigInt → coerce
  const exp = Number(expense._sum.amount || 0);
  const profit = revenue - exp;
  return {
    range: { dateFrom: dateFrom || null, dateTo: dateTo || null },
    revenue,
    expense: exp,
    profit,
    margin: revenue ? +((profit / revenue) * 100).toFixed(1) : 0,
    counts: { income: income._count, expense: expense._count },
  };
}

// Monthly revenue vs expense series (grouped in JS for SQLite/PG portability).
async function cashflow({ dateFrom, dateTo } = {}, user) {
  const entries = await prisma.entry.findMany({
    where: scopedWhere(user, { status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) }),
    select: { date: true, type: true, amount: true },
  });
  const byMonth = new Map();
  for (const e of entries) {
    const m = e.date.slice(0, 7); // YYYY-MM
    if (!byMonth.has(m)) byMonth.set(m, { month: m, rev: 0, exp: 0 });
    const row = byMonth.get(m);
    if (e.type === 'income') row.rev += e.amount; else row.exp += e.amount;
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Sum by category for one entry type (donut breakdown).
async function breakdown({ type = 'expense', dateFrom, dateTo } = {}, user) {
  const grouped = await prisma.entry.groupBy({
    by: ['categoryKey'],
    where: scopedWhere(user, { type, status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) }),
    _sum: { amount: true },
  });
  const sumOf = (g) => Number(g._sum.amount || 0);   // groupBy _sum on a BigInt column is BigInt → coerce
  const total = grouped.reduce((a, g) => a + sumOf(g), 0);
  return {
    type,
    total,
    categories: grouped
      .map((g) => ({
        category: g.categoryKey || 'Uncategorized',
        value: sumOf(g),
        pct: total ? +((sumOf(g) / total) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.value - a.value),
  };
}

module.exports = { summary, cashflow, breakdown };
