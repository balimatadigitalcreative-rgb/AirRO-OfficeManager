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

// Merge the JSON approval trail back onto a Cashbon row; expose createdAt as ms and
// the server-stamped creator snapshot as createdBy { name, role } (historical).
function toClient(r) {
  let trail = {}; try { trail = r.data ? JSON.parse(r.data) : {}; } catch (e) {}
  const { data, createdAt, updatedAt, createdByName, createdByRole, createdById, ...rest } = r;
  return { ...rest, ...trail, createdById: createdById || null,
    requestDate: r.date,   // `date` IS the request date — expose it under the spec name too
    createdBy: createdByName ? { name: createdByName, role: createdByRole || null } : null,
    createdAt: createdAt ? new Date(createdAt).getTime() : Date.now(), perInstallment: perInstallment(r) };
}
// identity + name/role read from the DB at request time — never from the client body/trail.
async function creatorSnap(userId) {
  if (!userId) return {};
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
  return u ? { createdById: userId, createdByName: u.name, createdByRole: u.role } : { createdById: userId };
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
async function request({ employeeId, amount, date, note, disbursedDate }, user) {
  const { base, existing, mode } = await cycleContext(employeeId);
  const v = rules.validate({ base, date, amount, existing, mode });
  if (!v.ok) throw ApiError.badRequest(v.message, v);
  const exists = await prisma.employee.count({ where: { id: employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  // A new kasbon is ALWAYS 'pending' → it does NOT deduct salary until an approver
  // ACCs it. disbursedDate is optional at request time (filled/confirmed on approval).
  const trail = { requestedBy: (user && (user.username || user.id)) || '', requestedAt: Date.now(), approvedBy: '', decidedAt: null, rejectReason: '' };
  const row = await prisma.cashbon.create({ data: {
    id: 'kb' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    employeeId, amount: +amount, date, disbursedDate: disbursedDate || null, note: (note || '').trim(),
    installments: 1, status: 'pending', cycleAnchor: v.cycleAnchor, data: JSON.stringify(trail),
    ...(await creatorSnap(user && user.id)),
  } });
  const cashbon = toClient(row);
  const summary = rules.summarize(base, existing.concat(row), date, mode);
  return { cashbon, info: { base, mode, ceiling: v.ceiling, weeklyMax: v.weeklyMax, remainingAfter: v.remainingAfter, summary } };
}

// Approve/reject a kasbon in the table; the approval trail is merged into `data`.
// On APPROVE we also stamp disbursedDate (the ACC date; the deduction cycle is derived
// from it) — the caller passes it (defaulting to "today"); fall back to the request
// date or the server date so an approved kasbon always has a disbursed date.
async function decide(id, status, user, reason, disbursedDate) {
  const existing = await prisma.cashbon.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Cashbon not found');
  let trail = {}; try { trail = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  trail.approvedBy = (user && (user.username || user.id)) || '';
  trail.decidedAt = Date.now();
  if (status === 'rejected') trail.rejectReason = reason || '';
  const data = { status, data: JSON.stringify(trail) };
  if (status === 'approved') data.disbursedDate = disbursedDate || existing.disbursedDate || new Date().toISOString().slice(0, 10);
  const r = await prisma.cashbon.update({ where: { id }, data });
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
async function create(body, userId) {
  const exists = await prisma.employee.count({ where: { id: body.employeeId } });
  if (!exists) throw ApiError.badRequest('employeeId does not reference an existing employee');
  const trail = {}; TRAIL.forEach((k) => { if (body[k] != null) trail[k] = body[k]; });
  // Strip client-supplied creator fields — the snapshot is authoritative (token only).
  const { requestedBy, requestedAt, approvedBy, decidedAt, rejectReason, createdAt, perInstallment: _pi, createdByName, createdByRole, createdBy, createdById, ...cols } = body;
  const r = await prisma.cashbon.create({ data: { ...cols, data: Object.keys(trail).length ? JSON.stringify(trail) : null, ...(await creatorSnap(userId)) } });
  return toClient(r);
}

async function update(id, body) {
  const existing = await prisma.cashbon.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Cashbon not found');
  let trail = {}; try { trail = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  TRAIL.forEach((k) => { if (body[k] != null) trail[k] = body[k]; });
  // Never let an update rewrite the original creator snapshot (strip from body).
  const { requestedBy, requestedAt, approvedBy, decidedAt, rejectReason, createdAt, perInstallment: _pi, createdByName, createdByRole, createdBy, createdById, ...cols } = body;
  const r = await prisma.cashbon.update({ where: { id }, data: { ...cols, data: JSON.stringify(trail) } });
  return toClient(r);
}

// Cancel a kasbon → status 'cancelled'. Its computed payroll deduction disappears
// automatically (withCashbon only counts approved). Allowed for a kasbonApprove holder
// (ANY status — e.g. undo an approved kasbon) OR the ORIGINAL submitter while the
// kasbon is still 'pending'. Records who/when in the trail.
async function cancel(id, user, isApprover) {
  const existing = await prisma.cashbon.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Cashbon not found');
  const isOwner = !!(user && existing.createdById && user.id === existing.createdById);
  if (!(isApprover || (isOwner && existing.status === 'pending'))) {
    throw ApiError.forbidden('Hanya pengaju (saat masih pending) atau pemegang kasbonApprove yang bisa membatalkan kasbon ini.');
  }
  let trail = {}; try { trail = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  trail.cancelledBy = (user && (user.username || user.id)) || '';
  trail.cancelledAt = Date.now();
  const r = await prisma.cashbon.update({ where: { id }, data: { status: 'cancelled', data: JSON.stringify(trail) } });
  return toClient(r);
}

// Delete (permanent) — only for kasbon that never (or no longer) deducts: pending /
// rejected / cancelled. An approved/active/paid kasbon must be CANCELLED first (which
// removes its payroll deduction) before it can be deleted — no dangling deduction.
async function remove(id) {
  const c = await getById(id);
  if (c.status === 'approved' || c.status === 'active' || c.status === 'paid') {
    throw ApiError.badRequest('Kasbon yang sudah disetujui/memotong gaji tidak bisa dihapus langsung — batalkan dulu.');
  }
  await prisma.cashbon.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, cancel, preview, request, decide, toClient };
