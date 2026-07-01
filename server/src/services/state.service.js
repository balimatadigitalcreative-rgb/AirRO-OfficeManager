'use strict';
const prisma = require('../lib/prisma');

// Shared app-state document store. Each key holds one JSON blob (the frontend's
// localStorage value), shared by all users.
// `since` (ISO) → only documents changed after it (incremental poll). Omit for a
// full snapshot (hydrate). Returns { data, meta } where meta[key] = updatedAt ISO
// so the client can tell a fresh remote change from a stale server value it must
// not let overwrite an unsynced local edit.
async function getAll(since) {
  const where = since ? { updatedAt: { gt: new Date(since) } } : undefined;
  const rows = await prisma.document.findMany({ where });
  const data = {}, meta = {};
  for (const r of rows) { data[r.key] = r.value; meta[r.key] = r.updatedAt.toISOString(); }
  return { data, meta };
}

async function get(key) {
  const r = await prisma.document.findUnique({ where: { key } });
  return r ? r.value : null;
}

async function set(key, value) {
  await prisma.document.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return { key };
}

module.exports = { getAll, get, set };
