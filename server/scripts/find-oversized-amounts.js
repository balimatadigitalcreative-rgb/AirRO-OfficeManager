'use strict';
// ── READ-ONLY diagnostic ──────────────────────────────────────────────────────
// Lists every money row whose value exceeds the OLD 32-bit Int limit (2,147,483,647) — the values
// that used to make Prisma throw "does not fit in an INT column" and blank a whole list screen.
// It MODIFIES NOTHING. Connects with DATABASE_URL from server/.env and reads via raw SQLite SQL
// (raw queries bypass Prisma's column type mapping, so an oversized row can still be read here).
//
//   Run:  cd server && node scripts/find-oversized-amounts.js
//
// Then review the output and correct any bad row through the app's normal Koreksi flow
// (recorded + audited) — NEVER by a silent SQL edit. See DEPLOY.md.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OLD_INT_LIMIT = 2147483647;
const N = (v) => (typeof v === 'bigint' ? Number(v) : v);

// table → money columns to scan (keep in sync with the BigInt columns in schema.prisma)
const TABLES = {
  DistExpense: ['amount'], Entry: ['amount'], Transfer: ['amount'], Cashbon: ['amount'],
  Customer: ['masterPrice'], PriceHistory: ['oldPrice', 'newPrice'], Correction: ['deltaAmount'],
  DistInvoice: ['total', 'sisaBon'], Setoran: ['cash', 'bon', 'bonPay', 'expense'],
  Account: ['opening'], StockMovement: ['amount'], Orientation: ['dailyWage'], Training: ['cost'],
  Employee: ['base', 'tjKinerja', 'tjProfesi', 'tjRumahDinas', 'tjBpjsKes', 'tjBpjsTk'],
};

(async () => {
  let found = 0;
  console.log(`Scanning for money values > ${OLD_INT_LIMIT.toLocaleString('en-US')} (old 32-bit Int limit)…`);

  // Detailed scan of DistTransaction (the screen that broke) — with the customer name resolved.
  const txns = await prisma.$queryRawUnsafe(
    `SELECT t."id", t."fleetId", t."txnDate", t."qty", t."unitPriceLocked", t."amount", t."actorName", c."name" AS "customerName"
       FROM "DistTransaction" t LEFT JOIN "Customer" c ON c."id" = t."customerId"
      WHERE t."amount" > ${OLD_INT_LIMIT} OR t."unitPriceLocked" > ${OLD_INT_LIMIT}
      ORDER BY t."amount" DESC`);
  if (txns.length) {
    console.log(`\n=== DistTransaction — ${txns.length} oversized row(s) ===`);
    for (const r of txns) {
      found++;
      console.log(`  id=${r.id} · fleet=${r.fleetId} · date=${r.txnDate} · qty=${N(r.qty)} · unitPrice=${N(r.unitPriceLocked)} · amount=${N(r.amount)} · by=${r.actorName || '—'} · customer=${r.customerName || '—'}`);
    }
  }

  // Broader scan of the other money tables (id + offending column/value only).
  for (const [table, cols] of Object.entries(TABLES)) {
    const cond = cols.map((c) => `"${c}" > ${OLD_INT_LIMIT}`).join(' OR ');
    let rows;
    try {
      rows = await prisma.$queryRawUnsafe(`SELECT "id", ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}" WHERE ${cond}`);
    } catch (e) { console.log(`  (skip ${table}: ${e.message})`); continue; }
    if (rows.length) {
      console.log(`\n=== ${table} — ${rows.length} oversized row(s) ===`);
      for (const r of rows) { found++; const o = {}; for (const k of Object.keys(r)) o[k] = N(r[k]); console.log('  ' + JSON.stringify(o)); }
    }
  }

  console.log(found
    ? `\nTotal: ${found} oversized row(s). Correct each via the app's Koreksi flow (recorded + audited) — see DEPLOY.md. NOTHING was modified by this script.`
    : '\nNo oversized rows found — nothing to do.');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
