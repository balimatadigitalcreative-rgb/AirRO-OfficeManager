'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// The full frontend approval object lives in `data`; type/status are projected
// columns. toClient returns the stored object with the authoritative id/status and
// the server-stamped creator snapshot (overrides anything the client put in `data`).
function toClient(row) {
  let obj = {}; try { obj = row.data ? JSON.parse(row.data) : {}; } catch (e) {}
  return { ...obj, id: row.id, type: row.type, status: row.status,
    createdBy: row.createdByName ? { name: row.createdByName, role: row.createdByRole || null } : null,
    createdById: row.createdById || null, createdAt: row.createdAt ? new Date(row.createdAt).getTime() : null };
}
// identity + name/role read from the DB at submit time — never from the request body.
async function creatorSnap(userId) {
  if (!userId) return {};
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
  return u ? { createdById: userId, createdByName: u.name, createdByRole: u.role } : { createdById: userId };
}
function cols(body) {
  return {
    type: body.type ? String(body.type) : 'custom',
    status: body.status ? String(body.status) : 'pending',
    data: JSON.stringify(body),
  };
}

async function list() {
  const rows = await prisma.approval.findMany({ orderBy: { createdAt: 'desc' } });
  return { data: rows.map(toClient) };
}
async function getRow(id) {
  const r = await prisma.approval.findUnique({ where: { id } });
  if (!r) throw ApiError.notFound('Approval not found');
  return r;
}
async function getById(id) { return toClient(await getRow(id)); }

async function create(body, userId) {
  const data = { ...cols(body), ...(await creatorSnap(userId)) };
  if (body.id) data.id = String(body.id);   // keep the client id (optimistic insert)
  return toClient(await prisma.approval.create({ data }));
}
async function update(id, body) {
  const existing = await getRow(id);
  let prev = {}; try { prev = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  const merged = { ...prev, ...body, id };
  return toClient(await prisma.approval.update({ where: { id }, data: cols(merged) }));
}
async function remove(id) {
  await getRow(id);
  await prisma.approval.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, toClient };
