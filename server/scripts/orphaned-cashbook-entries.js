'use strict';
/*
 * DIAGNOSTIC (read-only) — cash-book entries whose `acct` no longer resolves to a live Account.
 *
 * WHY THIS HAPPENS: the cash book keys an entry to its money-spot with the PLAIN STRING column
 * Entry.acct (a frontend account id) — deliberately NOT a foreign key (see the schema comment), so an
 * entry is never rejected for an account that only exists client-side. Entry also has a legacy FK
 * `accountId`, but the per-record cash-book path leaves it NULL. account.service.remove() detaches the
 * FK (accountId → null) and deletes the Account row, but it NEVER touches the `acct` STRING. Because
 * `acct` has no FK, nothing blocks or cascades: after the delete, every cash-book entry still carries
 * the deleted account's id in `acct`, and the /accounts list no longer contains it — so the client
 * cannot resolve them and buckets their net into "Belum dipetakan" (a NEGATIVE if the orphaned entries
 * are net expense, e.g. the account's opening balance died with the Account row).
 *
 * This lists every orphaned entry, groups by the dangling acct id, sums the net (income − expense) which
 * should equal the dashboard's "Belum dipetakan", and flags any account whose balance is negative.
 *
 *   cd server && DATABASE_URL="file:..." node scripts/orphaned-cashbook-entries.js
 */
const prisma = require('../src/lib/prisma');

const rupiah = (v) => (v < 0 ? '-' : '') + 'Rp' + Math.abs(Math.round(v)).toLocaleString('id-ID');

async function run() {
  const accounts = await prisma.account.findMany({ select: { id: true, name: true, type: true, opening: true } });
  const liveIds = new Set(accounts.map((a) => a.id));
  const primaryId = accounts.length ? accounts.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))[0].id : null;

  // Orphaned = acct is set (non-empty) AND not a live account id. A blank/null acct legitimately falls
  // back to the primary account, so it is NOT orphaned.
  const entries = await prisma.entry.findMany({ select: { id: true, date: true, type: true, amount: true, acct: true, note: true, category: true, createdByName: true, createdByRole: true, createdAt: true, meta: true } });
  const orphans = entries.filter((e) => e.acct && String(e.acct).trim() && !liveIds.has(e.acct));

  const byAcct = {};
  let net = 0;
  for (const e of orphans) {
    const signed = (e.type === 'income' ? 1 : -1) * Number(e.amount);
    net += signed;
    const g = byAcct[e.acct] || (byAcct[e.acct] = { acct: e.acct, count: 0, income: 0, expense: 0, net: 0, first: e.date, last: e.date });
    g.count++; if (e.type === 'income') g.income += Number(e.amount); else g.expense += Number(e.amount);
    g.net += signed; if (e.date < g.first) g.first = e.date; if (e.date > g.last) g.last = e.date;
  }

  console.log('\n══ ORPHANED CASH-BOOK ENTRIES (acct → deleted/renamed account) ══\n');
  console.log(`  Live accounts: ${accounts.map((a) => `${a.name}[${a.id}]`).join(', ') || '(none)'}`);
  console.log(`  Primary (blank-acct fallback): ${primaryId || '(none)'}\n`);
  if (!orphans.length) { console.log('  ✔ No orphaned entries — every acct resolves to a live account.\n'); }
  else {
    console.log(`  ${orphans.length} orphaned entr(y/ies) across ${Object.keys(byAcct).length} dangling acct id(s):\n`);
    for (const g of Object.values(byAcct).sort((a, b) => a.net - b.net)) {
      console.log(`   acct="${g.acct}"  ${g.count} rows  ${g.first}…${g.last}  in ${rupiah(g.income)}  out ${rupiah(g.expense)}  NET ${rupiah(g.net)}`);
    }
    console.log(`\n   ── the ${Math.min(orphans.length, 40)} rows — ORIGIN (createdAt · createdBy · meta) tells the write path ──`);
    orphans.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 40).forEach((e) => {
      const when = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
      const who = e.createdByName ? `${e.createdByName}${e.createdByRole ? '/' + e.createdByRole : ''}` : '(no creator — likely import/seed/migration)';
      console.log(`   ${e.date}  ${e.type.padEnd(7)} ${rupiah(Number(e.amount)).padStart(15)}  acct=${e.acct}  ${e.category || ''} ${e.note ? '· ' + e.note.slice(0, 32) : ''}`);
      console.log(`        created ${when}  by ${who}${e.meta ? '  meta=' + String(e.meta).slice(0, 60) : ''}`);
    });
    // Origin summary: group by creator, so "all import" vs "manual entry" is obvious at a glance.
    const byWho = {}; orphans.forEach((e) => { const k = e.createdByName || '(none)'; byWho[k] = (byWho[k] || 0) + 1; });
    console.log(`\n   origin by creator: ${Object.entries(byWho).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    const createdSpan = orphans.map((e) => e.createdAt).filter(Boolean).sort();
    if (createdSpan.length) console.log(`   createdAt span: ${new Date(createdSpan[0]).toISOString().slice(0, 10)} … ${new Date(createdSpan[createdSpan.length - 1]).toISOString().slice(0, 10)}`);
    console.log(`\n   Σ NET of orphaned entries (== dashboard "Belum dipetakan"): ${rupiah(net)}\n`);
  }

  // Negative-balance check (opening + Σ entries by acct + Σ transfers).
  const transfers = await prisma.transfer.findMany({ select: { fromId: true, toId: true, amount: true } }).catch(() => []);
  console.log('  ── per-account balances ──');
  let anyNeg = false;
  for (const a of accounts) {
    let bal = Number(a.opening || 0);
    for (const e of entries) {
      const aid = !e.acct ? primaryId : (liveIds.has(e.acct) ? e.acct : null);
      if (aid === a.id) bal += (e.type === 'income' ? 1 : -1) * Number(e.amount);
    }
    for (const t of transfers) { if (t.toId === a.id) bal += Number(t.amount); if (t.fromId === a.id) bal -= Number(t.amount); }
    const neg = bal < 0; if (neg) anyNeg = true;
    console.log(`   ${neg ? '⚠' : '·'} ${a.name.padEnd(14)} ${rupiah(bal)}`);
  }
  console.log('');
  if (orphans.length || anyNeg) { console.error(`✖ FOUND ${orphans.length} orphaned entr(y/ies)${anyNeg ? ' + a NEGATIVE account balance' : ''}. Remediate with the remap action (see the "Belum dipetakan" drill or /entries/remap).`); process.exitCode = 2; }
  else console.log('✔ clean.\n');
}

run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('DIAGNOSTIC FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
