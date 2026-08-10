'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY gallon-ledger diagnostic. Prints raw counts + the exact derivation
// classification for every GallonMovement row. It performs NO writes (findMany only).
//
// Run on the VPS against the LIVE database:
//     cd /var/www/airrooffice/server && node scripts/diagnose-gallon.js
//
// The classification branches below are copied VERBATIM from
// src/services/distribution.service.js so the buckets match what the app shows.
// ─────────────────────────────────────────────────────────────────────────────
const prisma = require('../src/lib/prisma');

const DAMAGE = new Set(['damage', 'loss']);
const OPENING_NOTE = /stok\s*awal|saldo\s*awal|opening\s*stock/i;
const OPNAME_ARMADA = /^Opname armada /;
const RESET_NOTE = /reset stok galon/i;
const movMs = (m) => (m && m.createdAt ? new Date(m.createdAt).getTime() : 0);
const isOpeningRow = (m) => m.type === 'opening' || (m.type === 'correction' && !m.customerId && OPENING_NOTE.test(m.note || '') && !RESET_NOTE.test(m.note || ''));
const totalEffect = (m) => { if (m.type === 'purchase' || m.type === 'opening') return m.qty; if (DAMAGE.has(m.type)) return -Math.abs(m.qty); if (m.type === 'correction' && !m.customerId) return m.qty; if (m.type === 'penyesuaian') return m.qty; return 0; };
const custEffect = (m) => (m.type === 'delivery_out' ? m.qty : m.type === 'return_in' ? -m.qty : ((m.type === 'correction' || m.type === 'penyesuaian') && m.customerId) ? m.qty : 0);
const rusakEffect = (m) => (DAMAGE.has(m.type) ? Math.abs(m.qty) : 0);
const armadaEffect = (m, cut) => { if (m.type === 'load_out') return m.qty; if (m.type === 'load_return') return -m.qty; const era = cut != null && movMs(m) >= cut; if (m.type === 'delivery_out') return era ? -m.qty : 0; if (m.type === 'return_in') return era ? m.qty : 0; if (DAMAGE.has(m.type) && m.fleetId && !m.customerId) return -Math.abs(m.qty); if (m.type === 'correction' && !m.customerId && m.fleetId && OPNAME_ARMADA.test(m.note || '')) return m.qty; return 0; };
const depotEffect = (m, cut) => { if (m.type === 'opening' || m.type === 'purchase') return m.qty; if (m.type === 'load_out') return -m.qty; if (m.type === 'load_return') return m.qty; const era = cut != null && movMs(m) >= cut; if (m.type === 'delivery_out') return era ? 0 : -m.qty; if (m.type === 'return_in') return era ? 0 : m.qty; if (DAMAGE.has(m.type) && !m.fleetId && !m.customerId) return -Math.abs(m.qty); if (m.type === 'correction' && !m.customerId && !(m.fleetId && OPNAME_ARMADA.test(m.note || ''))) return m.qty; if (m.type === 'correction' && m.customerId) return -m.qty; return 0; };

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => (n >= 0 ? '+' : '') + n;
const minute = (m) => (m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 16) : '—');
const short = (id) => (id ? String(id).slice(-6).toUpperCase() : '—');
const H = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78));

(async () => {
  const rows = await prisma.gallonMovement.findMany({ orderBy: { createdAt: 'asc' } });
  const active = rows.filter((r) => r.active);
  // cutover per fleet = earliest active load_out
  const cut = {};
  active.filter((m) => m.type === 'load_out').forEach((m) => { const t = movMs(m); if (cut[m.fleetId] == null || t < cut[m.fleetId]) cut[m.fleetId] = t; });

  console.log('GALLON LEDGER DIAGNOSTIC  ·  rows total=' + rows.length + '  active=' + active.length);

  // Authoritative buckets (what "Semua armada" shows), summed over ACTIVE rows.
  let depot = 0, armada = 0, cust = 0, rusak = 0, good = 0;
  active.forEach((m) => { const c = cut[m.fleetId]; depot += depotEffect(m, c); armada += armadaEffect(m, c); cust += custEffect(m); rusak += rusakEffect(m); good += totalEffect(m); });
  const opening = active.filter(isOpeningRow).reduce((a, m) => a + m.qty, 0);
  H('BUCKETS (active rows, all fleets)');
  console.log(`Stok awal (isOpeningRow):  ${opening}`);
  console.log(`Di depot:                  ${depot}`);
  console.log(`Di armada:                 ${armada}`);
  console.log(`Di pelanggan:              ${cust}`);
  console.log(`Rusak/hilang:              ${rusak}`);
  console.log(`Total dimiliki (good+rusak): ${good + rusak}   (good=${good})`);

  // ── 1) group by type × customerId-null × active ──
  H('1) GROUP BY type × customerId-null × active  →  count, SUM(qty)');
  const g1 = {};
  rows.forEach((m) => { const k = `${pad(m.type, 14)} cust=${m.customerId ? 'Y' : 'n'} active=${m.active ? 'Y' : 'n'}`; (g1[k] || (g1[k] = { n: 0, q: 0 })); g1[k].n++; g1[k].q += m.qty; });
  Object.keys(g1).sort().forEach((k) => console.log(`${k}   n=${pad(g1[k].n, 5)} sum(qty)=${g1[k].q}`));

  // ── 2) rusak/hilang bucket rows ──
  H('2) ROWS IN THE rusak/hilang BUCKET  (filter: type ∈ {damage,loss}, active)');
  const rusakRows = active.filter((m) => rusakEffect(m) > 0);
  console.log(`count=${rusakRows.length}  sum=${rusakRows.reduce((a, m) => a + rusakEffect(m), 0)}`);
  rusakRows.forEach((m) => console.log(`  ${pad(m.type, 8)} qty=${pad(m.qty, 5)} fleet=${pad(m.fleetId || '∅', 8)} ${minute(m)} ${m.actorName || '—'}  "${(m.note || '').slice(0, 50)}"`));
  // fall-through detector: active rows contributing to good total but landing in NO bucket
  const fell = active.filter((m) => totalEffect(m) !== 0 && depotEffect(m, cut[m.fleetId]) === 0 && armadaEffect(m, cut[m.fleetId]) === 0 && custEffect(m) === 0 && rusakEffect(m) === 0);
  console.log(`Unclassified (good≠0 but no bucket): ${fell.length}` + (fell.length ? ' ⚠' : ''));
  fell.slice(0, 20).forEach((m) => console.log(`  ⚠ ${pad(m.type, 10)} qty=${m.qty} cust=${m.customerId ? 'Y' : 'n'} fleet=${m.fleetId || '∅'} "${(m.note || '').slice(0, 40)}"`));

  // ── 3) +N / −N pairs at the same minute per customer ──
  H('3) +N/−N PAIRS (same customer, same minute) — type + transactionId of each side');
  const byKey = {};
  active.filter((m) => m.customerId).forEach((m) => { const k = m.customerId + '|' + minute(m); (byKey[k] || (byKey[k] = [])).push(m); });
  let pairShown = 0;
  Object.keys(byKey).forEach((k) => {
    const grp = byKey[k];
    const pos = grp.filter((m) => m.qty > 0), neg = grp.filter((m) => m.qty < 0);
    if (pos.length && neg.length && pairShown < 25) {
      pairShown++;
      const p = pos[0], n = neg[0];
      const dup = p.type === n.type;   // same type on both sides = suspicious duplicate
      console.log(`  cust=${short(k.split('|')[0])} @${k.split('|')[1]}${dup ? '  ⚠ SAME TYPE (possible dup)' : ''}`);
      console.log(`     +  ${pad(p.type, 12)} qty=${p.qty} txn=${short(p.transactionId)} "${(p.note || '').slice(0, 24)}"`);
      console.log(`     -  ${pad(n.type, 12)} qty=${n.qty} txn=${short(n.transactionId)} "${(n.note || '').slice(0, 24)}"`);
    }
  });
  console.log(`(pairs shown: ${pairShown})`);

  // ── 4) opening rows' fleetId + depot trace ──
  H('4) OPENING ROWS fleetId + DEPOT trace (why depot can be 0 while opening>0)');
  const openRows = active.filter(isOpeningRow);
  const byFleet = {};
  openRows.forEach((m) => { (byFleet[m.fleetId || '∅'] || (byFleet[m.fleetId || '∅'] = { n: 0, q: 0 })); byFleet[m.fleetId || '∅'].n++; byFleet[m.fleetId || '∅'].q += m.qty; });
  console.log('opening rows by fleetId:'); Object.keys(byFleet).forEach((f) => console.log(`   fleet=${pad(f, 10)} n=${byFleet[f].n} sum=${byFleet[f].q}`));
  // depot contribution by source
  const depBySrc = {};
  active.forEach((m) => { const d = depotEffect(m, cut[m.fleetId]); if (d) { const key = isOpeningRow(m) ? 'opening' : (RESET_NOTE.test(m.note || '') ? 'RESET-correction' : m.type); depBySrc[key] = (depBySrc[key] || 0) + d; } });
  console.log('depot contribution by source:'); Object.keys(depBySrc).forEach((k) => console.log(`   ${pad(k, 18)} ${num(depBySrc[k])}`));
  console.log(`depot TOTAL = ${depot}`);

  // ── 5) verify opening − rusak = ? ──
  H('5) DOES opening − rusak MATCH A REAL QUANTITY?');
  const resetCorr = active.filter((m) => m.type === 'correction' && !m.customerId && RESET_NOTE.test(m.note || ''));
  const resetSum = resetCorr.reduce((a, m) => a + m.qty, 0);
  const deliveredNet = active.reduce((a, m) => a + (m.type === 'delivery_out' ? m.qty : m.type === 'return_in' ? -m.qty : 0), 0);
  console.log(`opening(${opening}) − rusak(${rusak}) = ${opening - rusak}`);
  console.log(`RESET depot-corrections (note "reset stok galon", cust=null): count=${resetCorr.length} sum=${resetSum}`);
  console.log(`delivery_out − return_in (net at customers): ${deliveredNet}`);
  console.log(`→ opening + resetSum − rusak(as depot) = ${opening + resetSum - rusak}  (should equal depot=${depot} if that is the story)`);

  // ── 6) opening adjustments + reset-produced rows, with deltas ──
  H('6) OPENING ADJUSTMENTS + RESET-PRODUCED ROWS (deltas, chronological)');
  active.filter((m) => m.type === 'opening' || RESET_NOTE.test(m.note || '')).forEach((m) => {
    console.log(`  ${minute(m)}  ${pad(m.type, 11)} qty=${pad(num(m.qty), 6)} cust=${m.customerId ? short(m.customerId) : '—'} fleet=${pad(m.fleetId || '∅', 8)} ${m.actorName || '—'}  "${(m.note || '').slice(0, 46)}"`);
  });

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
