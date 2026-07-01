'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const state = require('./state.service');
const rules = require('./cashbon.rules');

// Live kasbon lives in the shared /state store (keyed by the frontend staff id),
// so validation reads the latest base + existing kasbon from there.
const STAFF_DOC = 'airro_hrd_staff_v7';
const CB_DOC = 'airro_cashbon_v1';
const RATES_DOC = 'airro_hrd_rates_v1';
const parseDoc = (v, fb) => { if (!v) return fb; try { return JSON.parse(v); } catch (e) { return fb; } };

async function cycleContext(employeeId) {
  const staffArr = parseDoc(await state.get(STAFF_DOC), []);
  const staff = Array.isArray(staffArr) ? staffArr.find((s) => s.id === employeeId) : null;
  const base = staff ? (+staff.base || 0) : 0;
  const all = parseDoc(await state.get(CB_DOC), []);
  const existing = (Array.isArray(all) ? all : []).filter((c) => c.employeeId === employeeId);
  const r = parseDoc(await state.get(RATES_DOC), {});
  const mode = r && r.cashbonWeekMode === 'calendar' ? 'calendar' : 'cutoff';
  return { staff, base, existing, mode };
}

// Limits + remaining for the cycle containing `date` (drives the live UI).
async function preview({ employeeId, date, amount }) {
  const { base, existing, mode } = await cycleContext(employeeId);
  const summary = rules.summarize(base, existing, date, mode);
  const check = amount ? rules.validate({ base, date, amount, existing, mode }) : null;
  return { base, mode, summary, check };
}

// Authoritative validation. On success returns the ready-to-store kasbon object
// (with cycleAnchor); the frontend appends it to the shared /state store.
async function request({ employeeId, amount, date, note }) {
  const { base, existing, mode } = await cycleContext(employeeId);
  const v = rules.validate({ base, date, amount, existing, mode });
  if (!v.ok) throw ApiError.badRequest(v.message, v);
  const cashbon = {
    id: 'kb' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    employeeId, amount: +amount, date, note: (note || '').trim(),
    installments: 1, status: 'active', cycleAnchor: v.cycleAnchor, createdAt: Date.now(),
  };
  const summary = rules.summarize(base, existing.concat(cashbon), date, mode);
  return { cashbon, info: { base, mode, ceiling: v.ceiling, weeklyMax: v.weeklyMax, remainingAfter: v.remainingAfter, summary } };
}

// Monthly installment = amount / installments (rounded).
const perInstallment = (r) => Math.round((r.amount || 0) / Math.max(1, r.installments || 1));
const withCalc = (r) => ({ ...r, perInstallment: perInstallment(r) });

async function list(q) {
  const where = {};
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.status) where.status = q.status;
  const rows = await prisma.cashbon.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  const data = rows.map(withCalc);
  const totalActive = data.filter((r) => r.status === 'active').reduce((a, r) => a + r.amount, 0);
  return { data, summary: { totalActive, count: data.length } };
}

async function getById(id) {
  const r = await prisma.cashbon.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Cashbon not found');
  return withCalc(r);
}

async function create(data) {
  const exists = await prisma.employee.count({ where: { id: data.employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  const r = await prisma.cashbon.create({ data });
  return withCalc(r);
}

async function update(id, data) {
  await getById(id);
  const r = await prisma.cashbon.update({ where: { id }, data });
  return withCalc(r);
}

async function remove(id) {
  await getById(id);
  await prisma.cashbon.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, preview, request };
