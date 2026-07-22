'use strict';
const prisma = require('../src/lib/prisma');
const { seedBuiltinRoles } = require('../src/config/permissions');
const distribution = require('../src/services/distribution.service');
const businessUnit = require('../src/services/businessUnit.service');

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
  await prisma.passwordResetRequest.deleteMany();
  // Distribusi (children before parents): correction → transaction → customer.
  await prisma.correction.deleteMany();
  await prisma.distAuditLog.deleteMany();
  await prisma.runCorrection.deleteMany();     // run corrections (FK → deliveryRun) — before the run
  await prisma.deliveryRun.deleteMany();       // delivery runs (rit)
  await prisma.distExpense.deleteMany();        // field expenses (no FK — Attachment ref is soft)
  await prisma.distTransaction.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.gallonMovement.deleteMany();   // gallon ledger (also feeds the Gudang galon card)
  await prisma.deliveryCloseout.deleteMany();
  await prisma.delivery.deleteMany();          // delivery-board stops (FK → customer)
  await prisma.distInvoice.deleteMany();       // invoices (FK → customer)
  await prisma.customer.deleteMany();
  await prisma.customerCode.deleteMany();       // customer-code counter (append-only in prod)
  await prisma.customerType.deleteMany();
  // Gudang (children before parents): stock movements → inventory items.
  await prisma.stockMovement.deleteMany();   // FK → supplier, so it goes first
  await prisma.inventoryItem.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.supplierCode.deleteMany();   // code counter — otherwise codes leak across suites
  await prisma.warehouseCloseout.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.businessUnit.deleteMany();   // reset the unit dictionary between suites
  await prisma.role.deleteMany();
  await seedBuiltinRoles();       // built-in roles must exist for user creation (role FK-by-id)
  await distribution.seedCustomerTypes();   // seed customer types (reguler/kos/cafe/bulk)
  await businessUnit.seedBusinessUnits();   // seed the starter units (air/manufaktur/unit3)
}

module.exports = { resetDb, prisma };
