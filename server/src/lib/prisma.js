'use strict';
const { PrismaClient } = require('@prisma/client');

// ── BigInt serialization safety net ──────────────────────────────────────────
// Money columns are BigInt (they can exceed the 32-bit Int range — see schema.prisma). BigInt has
// no default JSON representation, so `JSON.stringify` on any stray BigInt throws
// "Do not know how to serialize a BigInt". This global makes any BigInt that still reaches res.json
// (e.g. from an aggregate/groupBy or a raw query) serialize as a plain number — a last-resort belt
// to the result extension below, which already converts BigInt→Number on ordinary model reads.
if (typeof BigInt.prototype.toJSON !== 'function') {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function toJSON() { return Number(this); };
}

// Every BigInt money column, per model. On READ these are converted BigInt→Number so the ENTIRE app
// keeps working with plain Numbers exactly as before (arithmetic, JSON, rpFull all unchanged). IDR
// values are integers well under 2^53, so a JS Number holds them exactly. Writes still accept a
// Number (Prisma coerces it to BigInt for the column). Keep this map in sync with schema.prisma.
const MONEY = {
  account: ['opening'],
  entry: ['amount'],
  transfer: ['amount'],
  setoran: ['cash', 'bon', 'bonPay', 'expense'],
  employee: ['base', 'tjKinerja', 'tjProfesi', 'tjRumahDinas', 'tjBpjsKes', 'tjBpjsTk'],
  orientation: ['dailyWage'],
  training: ['cost'],
  cashbon: ['amount'],
  customer: ['masterPrice'],
  priceHistory: ['oldPrice', 'newPrice'],
  distTransaction: ['amount', 'unitPriceLocked'],
  distExpense: ['amount'],
  correction: ['deltaAmount'],
  distInvoice: ['total', 'sisaBon'],
  stockMovement: ['amount'],
};
function moneyResultExtension() {
  const result = {};
  for (const [model, fields] of Object.entries(MONEY)) {
    result[model] = {};
    for (const f of fields) {
      result[model][f] = {
        needs: { [f]: true },
        compute(row) { const v = row[f]; return typeof v === 'bigint' ? Number(v) : v; },
      };
    }
  }
  return { result };
}

// Single shared client across the app (avoids exhausting connections), extended so money BigInt
// columns read back as Number. The extended client keeps $disconnect/$transaction/$queryRaw etc.
const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
const prisma = base.$extends(moneyResultExtension());

module.exports = prisma;
