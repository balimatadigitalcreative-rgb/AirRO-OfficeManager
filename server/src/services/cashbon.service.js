'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const rules = require('./cashbon.rules');

// Staff + kasbon are now per-record REST tables (TAHAP B/C). HR rates moved to the
// /settings key-value store (TAHAP C4b), so read the kasbon week-mode from there
// (NOT the old airro_hrd_rates_v1 /state blob, which is no longer mirrored).
const settingsService = require('./settings.service');
const TRAIL = ['requestedBy', 'requestedAt', 'approvedBy', 'decidedAt', 'rejectReason'];

// Base salary from the Employee table (the `data` document is authoritative; the
// mirrored column is the fallback). Reading from the table — NOT the old
// airro_hrd_staff_v7 blob, which is no longer mirrored after TAHAP B.
async function empBase(employeeId) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return 0;
  let base = +emp.base || 0;
  try { const d = emp.data ? JSON.parse(emp.data) : null; if (d && d.base != null) base = +d.base || base; } catch (e) {}
  return base;
}

// Merge the JSON approval trail back onto a Cashbon row; expose createdAt as ms.
function toClient(r) {
  let trail = {}; try { trail = r.data ? JSON.parse(r.data) : {}; } catch (e) {}
  const { data, createdAt, updatedAt, ...rest } = r;
  return { ...rest, ...trail, createdAt: createdAt ? new Date(createdAt).getTime() : Date.now(), perInstallment: perInstallment(r) };
}

async function cycleContext(employeeId) {
  const base = await empBase(employeeId);
  // Count only requests that still consume the cycle allowance: pending + approved
  // (+ legacy 'active'). Rejected/cancelled requests free the allowance back up.
  const CONSUMES = { pending: 1, approved: 1, active: 1 };
  const rows = await prisma.cashbon.findMany({ where: { employeeId } });
  const existing = rows.filter((c) => CONSUMES[c.status || 'pending']);
  let r = {}; try { r = (await settingsService.get('airro_hrd_rates')) || {}; } catch (e) {}
  const mode = r && r.cashbonWeekMode === 'calendar' ? 'calendar' : 'cutoff';
  return { base, existing, mode };
}

// Limits + remaining for the cycle containing `date` (drives the live UI).
async function preview({ employeeId, date, amount }) {
  const { base, existing, mode } = await cycleContext(employeeId);
  const summary = rules.summarize(base, existing, date, mode);
  const check = amount ? rules.validate({ base, date, amount, existing, mode }) : null;
  return { base, mode, summary, check };
}

// Authoritative validation + PERSIST. On success the kasbon is created in the table
// as 'pending' (per-record — no more shared-blob append) and returned to the client.
async function request({ employeeId, amount, date, note }, user) {
  const { base, existing, mode } = await cycleContext(employeeId);
  const v = rules.validate({ base, date, amount, existing, mode });
  if (!v.ok) throw ApiError.badRequest(v.message, v);
  const exists = await prisma.employee.count({ where: { id: employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  const trail = { requestedBy: (user && (user.username || user.id)) || '', requestedAt: Date.now(), approvedBy: '', decidedAt: null, rejectReason: '' };
  const row = await prisma.cashbon.create({ data: {
    id: 'kb' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    employeeId, amount: +amount, date, note: (note || '').trim(),
    installments: 1, status: 'pending', cycleAnchor: v.cycleAnchor, data: JSON.stringify(trail),
  } });
  const cashbon = toClient(row);
  const summary = rules.summarize(base, existing.concat(row), date, mode);
  return { cashbon, info: { base, mode, ceiling: v.ceiling, weeklyMax: v.weeklyMax, remainingAfter: v.remainingAfter, summary } };
}

// Approve/reject a kasbon in the table; the approval trail is merged into `data`.
async function decide(id, status, user, reason) {
  const existing = await prisma.cashbon.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Cashbon not found');
  let trail = {}; try { trail = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  trail.approvedBy = (user && (user.username || user.id)) || '';
  trail.decidedAt = Date.now();
  if (status === 'rejected') trail.rejectReason = reason || '';
  const r = await prisma.cashbon.update({ where: { id }, data: { status, data: JSON.stringify(trail) } });
  return toClient(r);
}

// Monthly installment = amount / installments (rounded).
const perInstallment = (r) => Math.round((r.amount || 0) / Math.max(1, r.installments || 1));

async function list(q) {
  const where = {};
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.status) where.status = q.status;
  const rows = await prisma.cashbon.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  const data = rows.map(toClient);
  const CONSUMES = { pending: 1, approved: 1, active: 1 };
  const totalActive = data.filter((r) => CONSUMES[r.status]).reduce((a, r) => a + r.amount, 0);
  return { data, summary: { totalActive, count: data.length } };
}

async function getById(id) {
  const r = await prisma.cashbon.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Cashbon not found');
  return toClient(r);
}

// Direct create (API completeness / imports). Accepts a client id + trail fields;
// the trail is folded into `data`.
async function create(body) {
  const exists = await prisma.employee.count({ where: { id: body.employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  const trail = {}; TRAIL.forEach((k) => { if (body[k] != null) trail[k] = body[k]; });
  const { requestedBy, requestedAt, approvedBy, decidedAt, rejectReason, createdAt, perInstallment: _pi, ...cols } = body;
  const r = await prisma.cashbon.create({ data: { ...cols, data: Object.keys(trail).length ? JSON.stringify(trail) : null } });
  return toClient(r);
}

async function update(id, body) {
  const existing = await prisma.cashbon.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Cashbon not found');
  let trail = {}; try { trail = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  TRAIL.forEach((k) => { if (body[k] != null) trail[k] = body[k]; });
  const { requestedBy, requestedAt, approvedBy, decidedAt, rejectReason, createdAt, perInstallment: _pi, ...cols } = body;
  const r = await prisma.cashbon.update({ where: { id }, data: { ...cols, data: JSON.stringify(trail) } });
  return toClient(r);
}

async function remove(id) {
  await getById(id);
  await prisma.cashbon.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, preview, request, decide, toClient };
