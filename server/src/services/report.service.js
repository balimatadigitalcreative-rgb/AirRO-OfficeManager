'use strict';
const prisma = require('../lib/prisma');

function dateWhere(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return {};
  const date = {};
  if (dateFrom) date.gte = dateFrom;
  if (dateTo) date.lte = dateTo;
  return { date };
}

// Revenue / expense / net-profit headline for a date range.
async function summary({ dateFrom, dateTo } = {}) {
  const where = { status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) };
  const [income, expense] = await Promise.all([
    prisma.entry.aggregate({ _sum: { amount: true }, _count: true, where: { ...where, type: 'income' } }),
    prisma.entry.aggregate({ _sum: { amount: true }, _count: true, where: { ...where, type: 'expense' } }),
  ]);
  const revenue = income._sum.amount || 0;
  const exp = expense._sum.amount || 0;
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
async function cashflow({ dateFrom, dateTo } = {}) {
  const entries = await prisma.entry.findMany({
    where: { status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) },
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
async function breakdown({ type = 'expense', dateFrom, dateTo } = {}) {
  const grouped = await prisma.entry.groupBy({
    by: ['categoryKey'],
    where: { type, status: { not: 'Failed' }, ...dateWhere(dateFrom, dateTo) },
    _sum: { amount: true },
  });
  const total = grouped.reduce((a, g) => a + (g._sum.amount || 0), 0);
  return {
    type,
    total,
    categories: grouped
      .map((g) => ({
        category: g.categoryKey || 'Uncategorized',
        value: g._sum.amount || 0,
        pct: total ? +(((g._sum.amount || 0) / total) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.value - a.value),
  };
}

module.exports = { summary, cashflow, breakdown };
