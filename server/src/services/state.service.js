'use strict';
const prisma = require('../lib/prisma');

// Shared app-state document store. Each key holds one JSON blob (the frontend's
// localStorage value), shared by all users.
async function getAll() {
  const rows = await prisma.document.findMany();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function set(key, value) {
  await prisma.document.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return { key };
}

module.exports = { getAll, set };
