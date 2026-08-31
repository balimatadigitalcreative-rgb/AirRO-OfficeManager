'use strict';
/*
 * REMEDIATION — remap the orphaned cash-book entries whose `acct` was stored as a NAME/old-id string
 * instead of the live Account id. This is a data correction of a mis-stored REFERENCE: it changes only
 * Entry.acct (+ the legacy Entry.accountId), never an amount, date or type — so no correcting journal is
 * needed. Every touched row is printed (the run output is the audit trail).
 *
 * The mapping is EXACT (no guesswork). Override on the command line if the ids differ:
 *   node scripts/remap-orphaned-accts.js                       # DRY-RUN (default): before/after, writes nothing
 *   node scripts/remap-orphaned-accts.js --apply               # APPLY
 *   node scripts/remap-orphaned-accts.js bca=<id> cash=<id>    # override the mapping
 *
 * SAFE WORKFLOW: copy prod → prod-copy.db, run the DRY-RUN then --apply on the COPY, run
 * verify-invariants on the copy (expect: "Belum dipetakan" = Rp0; the negative-balance invariant will
 * STILL FAIL until the owner enters BCA's real opening balance — that is correct, see item 5), and only
 * then run --apply against production.
 */
const prisma = require('../src/lib/prisma');

// Default mapping (from the diagnosis): the string on the left → the live Account id on the right.
const DEFAULT_MAP = { bca: 'acmrbuic9lg7', cash: 'acmrbufn56ey' };
const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');

function parseArgs() {
  const apply = process.argv.includes('--apply');
  const map = { ...DEFAULT_MAP };
  process.argv.slice(2).forEach((a) => { const m = a.match(/^([^=]+)=(.+)$/); if (m) map[m[1]] = m[2]; });
  return { apply, map };
}

// opening + Σ(entries by acct, blank→primary) + Σ(transfers), computed over a given acct-resolver.
async function balances(resolve) {
  const accounts = await prisma.account.findMany({ select: { id: true, name: true, opening: true, sortOrder: true } });
  const liveIds = new Set(accounts.map((a) => a.id));
  const primary = accounts.length ? accounts.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))[0].id : null;
  const entries = await prisma.entry.findMany({ select: { type: true, amount: true, acct: true } });
  const transfers = await prisma.transfer.findMany({ select: { fromId: true, toId: true, amount: true } }).catch(() => []);
  const bal = {}; accounts.forEach((a) => { bal[a.id] = { name: a.name, v: Number(a.opening || 0) }; });
  let unattr = 0;
  for (const e of entries) {
    const raw = resolve(e.acct);                              // the acct AFTER applying the (simulated) remap
    const aid = !raw ? primary : (liveIds.has(raw) ? raw : null);
    const signed = (e.type === 'income' ? 1 : -1) * Number(e.amount);
    if (aid && bal[aid]) bal[aid].v += signed; else if (raw) unattr += signed;   // still-unresolved → "Belum dipetakan"
  }
  for (const t of transfers) { if (bal[t.toId]) bal[t.toId].v += Number(t.amount); if (bal[t.fromId]) bal[t.fromId].v -= Number(t.amount); }
  return { bal, unattr, accounts, liveIds };
}

async function run() {
  const { apply, map } = parseArgs();
  const before = await balances((x) => x);   // no remap
  // Validate every target is a LIVE account (never remap onto a non-existent id).
  for (const [from, to] of Object.entries(map)) {
    if (!before.liveIds.has(to)) { console.error(`✖ target account for "${from}" (${to}) is not a live account. Fix the mapping.`); process.exitCode = 3; return; }
  }
  const remap = (x) => (x && Object.prototype.hasOwnProperty.call(map, x) ? map[x] : x);
  const after = await balances(remap);

  // The rows that will be touched (the audit).
  const touched = await prisma.entry.findMany({ where: { acct: { in: Object.keys(map) } }, select: { id: true, date: true, type: true, amount: true, acct: true, note: true }, orderBy: [{ acct: 'asc' }, { date: 'asc' }] });

  console.log(`\n══ REMAP orphaned cash-book acct → live account  (${apply ? 'APPLY' : 'DRY-RUN'}) ══\n`);
  console.log('  mapping:'); Object.entries(map).forEach(([f, t]) => console.log(`    "${f}"  →  ${t}  (${(before.bal[t] || {}).name || '?'})`));
  const byAcct = {}; touched.forEach((e) => { byAcct[e.acct] = (byAcct[e.acct] || 0) + 1; });
  console.log(`\n  will touch ${touched.length} row(s): ${Object.entries(byAcct).map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
  touched.forEach((e) => console.log(`    ${e.id}  ${e.date}  ${e.type.padEnd(7)} ${rupiah(Number(e.amount)).padStart(15)}  ${e.acct} → ${map[e.acct]}  ${e.note ? '· ' + e.note.slice(0, 32) : ''}`));

  console.log('\n  ── balances BEFORE → AFTER ──');
  const ids = new Set([...Object.keys(before.bal)]);
  for (const id of ids) { const b = before.bal[id].v, a = after.bal[id].v; if (b !== a || Object.values(map).includes(id)) console.log(`   ${(before.bal[id].name || id).padEnd(14)} ${rupiah(b).padStart(16)}  →  ${rupiah(a).padStart(16)}${a < 0 ? '   ⚠ NEGATIVE' : ''}`); }
  console.log(`   ${'Belum dipetakan'.padEnd(14)} ${rupiah(before.unattr).padStart(16)}  →  ${rupiah(after.unattr).padStart(16)}${after.unattr === 0 ? '   ✔' : ''}`);

  if (!apply) { console.log('\n  DRY-RUN — nothing written. Re-run with --apply to commit.\n'); return; }

  let total = 0;
  for (const [from, to] of Object.entries(map)) { const r = await prisma.entry.updateMany({ where: { acct: from }, data: { acct: to, accountId: to } }); total += r.count; }
  console.log(`\n  ✔ APPLIED — remapped ${total} row(s). Amounts/dates untouched; only the account reference changed.`);
  if (after.unattr !== 0) console.log(`  ⚠ "Belum dipetakan" is still ${rupiah(after.unattr)} — other dangling acct ids remain (run the diagnostic).`);
  const negs = Object.values(after.bal).filter((x) => x.v < 0).map((x) => `${x.name} ${rupiah(x.v)}`);
  if (negs.length) console.log(`  ⚠ NEGATIVE balance(s): ${negs.join(', ')} — REAL missing funding (opening balance / transfers). The owner must enter the real figures; do NOT invent (see item 5).`);
  console.log('');
}

run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('REMAP FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
