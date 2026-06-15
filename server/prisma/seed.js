'use strict';
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

// Seeds the baseline data the frontend assumes: an admin/bootstrap user, the
// default money accounts, income/expense categories, and the delivery fleet.
//
// SEED_DEMO_USERS=false (recommended for production) seeds ONLY a single
// full-access (gm) bootstrap account from SEED_OWNER_USERNAME/PASSWORD — that
// account can then create the real staff via the /users API. With demo users
// enabled (the default for local dev) it also seeds the original role accounts
// with simple PINs for convenience. Never enable demo users on a public site.
async function main() {
  const seedDemo = process.env.SEED_DEMO_USERS !== 'false';
  const adminUser = process.env.SEED_OWNER_USERNAME || 'owner';
  let adminPass = process.env.SEED_OWNER_PASSWORD;

  if (!adminPass) {
    if (seedDemo) {
      adminPass = '1234';                                   // dev convenience only
    } else {
      adminPass = crypto.randomBytes(9).toString('base64url'); // strong, printed once
      // eslint-disable-next-line no-console
      console.log('\n  Generated admin password (save it now):', adminPass, '\n');
    }
  }

  // The bootstrap account is role "gm" so it can administer users from day one.
  const users = [
    { name: 'Administrator', username: adminUser, role: 'gm', sub: 'Administrator', color: '#065489', password: adminPass },
  ];
  if (seedDemo) {
    users.push(
      { name: 'Pak Hendra',   username: 'owner2',  role: 'owner',    sub: 'Owner · Pemilik',          color: '#065489', password: '1234' },
      { name: 'Dewi Lestari', username: 'hrd',     role: 'hrd',      sub: 'HRD · Sumber Daya Manusia', color: '#138FB3', password: '3456' },
      { name: 'Andi Pratama', username: 'finance', role: 'finance',  sub: 'Finance · Keuangan',        color: '#22A7A1', password: '4567' },
      { name: 'Rina Marlina', username: 'admin',   role: 'adminfin', sub: 'Admin Finance · Setoran',   color: '#3FB8B2', password: '5678' },
    );
  }
  for (const u of users) {
    const { password, ...rest } = u;
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...rest, passwordHash: await bcrypt.hash(password, 10) },
    });
  }

  const accounts = [
    { id: 'cash', name: 'Cash', type: 'cash', bank: '', opening: 0, color: '#22A7A1', sortOrder: 0 },
    { id: 'bca', name: 'BCA', type: 'bank', bank: 'BCA', opening: 0, color: '#065489', sortOrder: 1 },
    { id: 'mandiri', name: 'Mandiri', type: 'bank', bank: 'Mandiri', opening: 0, color: '#0B7EB1', sortOrder: 2 },
  ];
  for (const a of accounts) {
    await prisma.account.upsert({ where: { id: a.id }, update: {}, create: a });
  }

  const categories = [
    { key: 'Refill', label: 'Gallon Refill', icon: 'IconDrop', type: 'income' },
    { key: 'Bulk', label: 'Corporate / Bulk', icon: 'IconStore', type: 'income' },
    { key: 'Deposit', label: 'Gallon Deposit', icon: 'IconWallet', type: 'income' },
    { key: 'Dispenser', label: 'Dispenser & Acc.', icon: 'IconCoinIn', type: 'income' },
    { key: 'OtherIn', label: 'Other Income', icon: 'IconCoinIn', type: 'income' },
    { key: 'Fuel', label: 'Fuel & Delivery', icon: 'IconGas', type: 'expense' },
    { key: 'Supplies', label: 'Bottling & Supplies', icon: 'IconStore', type: 'expense' },
    { key: 'Salaries', label: 'Salaries & Wages', icon: 'IconUsersGroup', type: 'expense' },
    { key: 'Maintenance', label: 'RO Maintenance', icon: 'IconWrench', type: 'expense' },
    { key: 'Utilities', label: 'Electricity & Water', icon: 'IconBolt', type: 'expense' },
    { key: 'Rent', label: 'Depot Rent', icon: 'IconHome', type: 'expense' },
    { key: 'OtherOut', label: 'Other Expense', icon: 'IconDots', type: 'expense' },
  ];
  for (const c of categories) {
    await prisma.category.upsert({ where: { key: c.key }, update: {}, create: c });
  }

  for (const plate of ['L-281', 'L-294', 'L-257', 'L-224', 'L-311']) {
    await prisma.fleet.upsert({ where: { plate }, update: {}, create: { plate } });
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete. Admin login:', adminUser, '/', adminPass, seedDemo ? '(demo users enabled)' : '(production: demo users OFF)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
