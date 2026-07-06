'use strict';
/*
  One-time migration of finance CONFIG off the shared /state blob:
    - accounts   (airro_accounts_v2) → Account table (upsert by client id)
    - categories (airro_cats_v1)      → Setting key "airro_cats" (object {income,expense})

  SAFE + idempotent: upserts by id / overwrites the single settings key; prints
  BEFORE/AFTER so you can verify. Does NOT delete the blobs.

  Run on the server (after `deploy/backup-db.sh`):
    cd server && node scripts/migrate-config-to-rest.js
*/
const prisma = require('../src/lib/prisma');

const ACC_KEY = 'airro_accounts_v2';
const CATS_KEY = 'airro_cats_v1';
const num = (v) => Math.round(+v || 0);

async function migrateAccounts() {
  const doc = await prisma.document.findUnique({ where: { key: ACC_KEY } });
  const before = await prisma.account.count();
  console.log(`\n== Accounts ==  table BEFORE: ${before}`);
  if (!doc) { console.log(`No "${ACC_KEY}" blob — skipping.`); return; }
  let arr; try { arr = JSON.parse(doc.value); } catch (e) { console.log('accounts blob not JSON — skipping.'); return; }
  if (!Array.isArray(arr)) { console.log('accounts blob not an array — skipping.'); return; }
  let created = 0, updated = 0;
  for (const a of arr.filter((x) => x && x.id && String(x.name || '').trim())) {
    const data = {
      name: String(a.name), type: a.type === 'cash' ? 'cash' : 'bank', bank: a.bank != null ? String(a.bank) : '',
      number: a.number != null ? String(a.number) : '', opening: num(a.opening),
      color: a.color != null ? String(a.color) : '#065489', sortOrder: num(a.sortOrder),
    };
    const ex = await prisma.account.findUnique({ where: { id: String(a.id) } });
    if (ex) { await prisma.account.update({ where: { id: String(a.id) }, data }); updated++; }
    else { await prisma.account.create({ data: { id: String(a.id), ...data } }); created++; }
  }
  console.log(`Blob accounts: ${arr.length}. Created: ${created}, Updated: ${updated}. Table AFTER: ${await prisma.account.count()}`);
}

async function migrateCats() {
  const doc = await prisma.document.findUnique({ where: { key: CATS_KEY } });
  console.log(`\n== Categories ==`);
  if (!doc) { console.log(`No "${CATS_KEY}" blob — skipping.`); return; }
  let obj; try { obj = JSON.parse(doc.value); } catch (e) { console.log('cats blob not JSON — skipping.'); return; }
  if (!obj || !Array.isArray(obj.income) || !Array.isArray(obj.expense)) { console.log('cats blob not {income,expense} — skipping.'); return; }
  await prisma.setting.upsert({ where: { key: 'airro_cats' }, update: { value: JSON.stringify(obj) }, create: { key: 'airro_cats', value: JSON.stringify(obj) } });
  console.log(`✅ Setting "airro_cats" written: ${obj.income.length} income + ${obj.expense.length} expense categories.`);
}

// settings/rates/budget/departments/projects/fleet → one Setting key each (verbatim).
const KEY_MAP = [
  ['airro_settings_v1', 'airro_settings'],
  ['airro_hrd_rates_v1', 'airro_hrd_rates'],
  ['airro_hr_budget_v1', 'airro_hr_budget'],
  ['airro_departments_v1', 'airro_departments'],
  ['airro_projects_v3', 'airro_projects'],
  ['airro_fleet_v1', 'airro_fleet'],
];
async function migrateSettingKeys() {
  console.log(`\n== Settings keys ==`);
  for (const [blobKey, settingKey] of KEY_MAP) {
    const doc = await prisma.document.findUnique({ where: { key: blobKey } });
    if (!doc) { console.log(`  ${blobKey} → ${settingKey}: no blob, skipped.`); continue; }
    let val; try { val = JSON.parse(doc.value); } catch (e) { console.log(`  ${blobKey}: not JSON, skipped.`); continue; }
    await prisma.setting.upsert({ where: { key: settingKey }, update: { value: JSON.stringify(val) }, create: { key: settingKey, value: JSON.stringify(val) } });
    const desc = Array.isArray(val) ? `${val.length} items` : (typeof val === 'object' ? `${Object.keys(val).length} keys` : String(val));
    console.log(`  ✅ ${blobKey} → Setting "${settingKey}" (${desc})`);
  }
}

// transfers (airro_transfers_v1) → Transfer table. Frontend uses from/to; the table
// uses fromId/toId (FK to Account). Skips transfers whose account is missing.
async function migrateTransfers() {
  const doc = await prisma.document.findUnique({ where: { key: 'airro_transfers_v1' } });
  const before = await prisma.transfer.count();
  console.log(`\n== Transfers ==  table BEFORE: ${before}`);
  if (!doc) { console.log('No airro_transfers_v1 blob — skipping.'); return; }
  let arr; try { arr = JSON.parse(doc.value); } catch (e) { console.log('transfers blob not JSON — skipping.'); return; }
  if (!Array.isArray(arr)) { console.log('transfers blob not an array — skipping.'); return; }
  let created = 0, updated = 0, missing = 0;
  for (const t of arr.filter((x) => x && x.id && x.date && x.amount != null)) {
    const fromId = t.from || t.fromId, toId = t.to || t.toId;
    const okF = fromId && await prisma.account.count({ where: { id: String(fromId) } });
    const okT = toId && await prisma.account.count({ where: { id: String(toId) } });
    if (!okF || !okT) { missing++; continue; }
    const data = { fromId: String(fromId), toId: String(toId), amount: num(t.amount), date: String(t.date), note: t.note != null ? String(t.note) : '' };
    const ex = await prisma.transfer.findUnique({ where: { id: String(t.id) } });
    if (ex) { await prisma.transfer.update({ where: { id: String(t.id) }, data }); updated++; }
    else { await prisma.transfer.create({ data: { id: String(t.id), ...data } }); created++; }
  }
  console.log(`Blob transfers: ${arr.length}. Created: ${created}, Updated: ${updated}, Skipped(missing account): ${missing}. Table AFTER: ${await prisma.transfer.count()}`);
}

async function main() {
  await migrateAccounts();
  await migrateCats();
  await migrateSettingKeys();
  await migrateTransfers();
  console.log('\nDone.');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
