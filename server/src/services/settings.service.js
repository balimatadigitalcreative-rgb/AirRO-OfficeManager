'use strict';
const prisma = require('../lib/prisma');
const { DEFAULT_RATES } = require('./payroll.engine');

// Known settings keys + defaults (mirrors finance-store.js / finance-hrd.js).
const DEFAULTS = {
  alerts: { lowCash: 20000000, bigExpense: 5000000, costPerGalon: 12000 },
  hrBudget: 30000000,
  hrRates: DEFAULT_RATES,
};

async function getAll() {
  const rows = await prisma.setting.findMany();
  const stored = {};
  for (const r of rows) {
    try { stored[r.key] = JSON.parse(r.value); } catch { stored[r.key] = r.value; }
  }
  return { ...DEFAULTS, ...stored };
}

async function get(key) {
  const all = await getAll();
  return all[key];
}

async function set(key, value) {
  const str = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, update: { value: str }, create: { key, value: str } });
  return { key, value };
}

module.exports = { DEFAULTS, getAll, get, set };
