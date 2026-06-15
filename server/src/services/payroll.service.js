'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const settingsService = require('./settings.service');
const engine = require('./payroll.engine');

// Resolve the active rate table (stored override merged onto defaults).
async function resolveRates() {
  const stored = await settingsService.get('hrRates');
  return { ...engine.DEFAULT_RATES, ...(stored || {}), jkk: { ...engine.JKK, ...((stored && stored.jkk) || {}) } };
}

// Full payroll run for all active employees: per-employee breakdown + totals.
async function run() {
  const [staff, rates] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    resolveRates(),
  ]);
  const breakdown = staff.map((s) => ({
    id: s.id, name: s.name, department: s.department,
    ...engine.compute(s, rates),
  }));
  return { period: 'current', rates, employees: breakdown, totals: engine.totals(staff, rates) };
}

// Post the payroll run as a single salary expense entry in the cash book.
async function post({ date, accountId }, userId) {
  const { totals } = await run();
  const amount = Math.round(totals.companyCost);
  if (amount <= 0) throw ApiError.badRequest('Nothing to post — no active employees / zero company cost');
  return prisma.entry.create({
    data: {
      type: 'expense',
      amount,
      categoryKey: 'Salaries',
      note: `Payroll run — ${totals.count} staff (full company cost incl. BPJS)`,
      method: 'Transfer BCA',
      date,
      accountId: accountId || null,
      createdById: userId || null,
    },
  });
}

module.exports = { run, post, resolveRates };
