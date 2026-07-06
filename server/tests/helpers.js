'use strict';
const prisma = require('../src/lib/prisma');
const { seedBuiltinRoles } = require('../src/config/permissions');

// Wipe mutable tables so each test file starts from a clean slate.
async function resetDb() {
  // Order matters for FK constraints: children before parents.
  await prisma.entry.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.setoran.deleteMany();
  await prisma.fleet.deleteMany();
  await prisma.account.deleteMany();
  await prisma.category.deleteMany();
  await prisma.cashbon.deleteMany();    // child of Employee (employeeId FK) — before employee
  await prisma.approval.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.role.deleteMany();
  await seedBuiltinRoles();   // built-in roles must exist for user creation (role FK-by-id)
}

module.exports = { resetDb, prisma };
