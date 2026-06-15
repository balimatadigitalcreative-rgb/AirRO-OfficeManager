'use strict';
const prisma = require('../src/lib/prisma');

// Wipe mutable tables so each test file starts from a clean slate.
async function resetDb() {
  // Order matters for FK constraints: children before parents.
  await prisma.entry.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.setoran.deleteMany();
  await prisma.fleet.deleteMany();
  await prisma.account.deleteMany();
  await prisma.category.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
}

module.exports = { resetDb, prisma };
