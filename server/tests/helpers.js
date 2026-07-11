'use strict';
const prisma = require('../src/lib/prisma');
const { seedBuiltinRoles } = require('../src/config/permissions');
const distribution = require('../src/services/distribution.service');

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
  // Distribusi (children before parents): correction → transaction → customer.
  await prisma.correction.deleteMany();
  await prisma.distAuditLog.deleteMany();
  await prisma.deliveryRun.deleteMany();       // delivery runs (rit) — no FK, safe anytime
  await prisma.distTransaction.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.gallonMovement.deleteMany();   // gallon ledger (also feeds the Gudang galon card)
  await prisma.customer.deleteMany();
  await prisma.customerType.deleteMany();
  // Gudang (children before parents): stock movements → inventory items.
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.warehouseCloseout.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.role.deleteMany();
  await seedBuiltinRoles();       // built-in roles must exist for user creation (role FK-by-id)
  await distribution.seedCustomerTypes();   // seed customer types (reguler/kos/cafe/bulk)
}

module.exports = { resetDb, prisma };
