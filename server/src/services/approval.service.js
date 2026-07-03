'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// The full frontend approval object lives in `data`; type/status are projected
// columns. toClient returns the stored object with the authoritative id/status.
function toClient(row) {
  let obj = {}; try { obj = row.data ? JSON.parse(row.data) : {}; } catch (e) {}
  return { ...obj, id: row.id, type: row.type, status: row.status };
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

async function create(body) {
  const data = cols(body);
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
