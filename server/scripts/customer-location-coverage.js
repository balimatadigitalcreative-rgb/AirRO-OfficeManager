'use strict';
/*
 * DIAGNOSTIC (read-only) — customer LOCATION COVERAGE for route ordering by proximity.
 *
 * WHY THIS MATTERS: the proximity route can only order a stop it can measure. A customer with no
 * lat/lng is never dropped — it lands in the trailing "belum ada lokasi" group — but it also can't be
 * sequenced. So the feature is worth exactly as much as this coverage number, per armada.
 *
 * Coordinates come from Customer.lat/lng (the field GPS tag, or a pasted Maps link parsed into
 * coordinates). A pasted mapsUrl WITHOUT parsed coordinates still opens Maps but cannot be measured —
 * counted separately below, because that is a silently misleading case.
 *
 *   cd server && DATABASE_URL="file:..." node scripts/customer-location-coverage.js
 */
const prisma = require('../src/lib/prisma');

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 100);
const bar = (p) => '█'.repeat(Math.round(p / 5)).padEnd(20, '·');

async function run() {
  const custs = await prisma.customer.findMany({
    where: { active: { not: false } },
    select: { id: true, code: true, name: true, armada: true, lat: true, lng: true, mapsUrl: true, deliveryDays: true },
  });
  const located = (c) => c.lat != null && c.lng != null && Number.isFinite(+c.lat) && Number.isFinite(+c.lng);
  const total = custs.length;
  const withCoords = custs.filter(located);
  const without = custs.filter((c) => !located(c));
  // A pasted Maps link with no parsed coordinates: navigable by hand, but NOT measurable for routing.
  const linkOnly = without.filter((c) => (c.mapsUrl || '').trim());

  console.log('\n══ CUSTOMER LOCATION COVERAGE (active customers) ══\n');
  console.log(`  total active        : ${total}`);
  console.log(`  WITH coordinates    : ${withCoords.length}  (${pct(withCoords.length, total)}%)  ${bar(pct(withCoords.length, total))}`);
  console.log(`  WITHOUT coordinates : ${without.length}  (${pct(without.length, total)}%)`);
  if (linkOnly.length) console.log(`    …of which have a pasted Maps link but NO parsed lat/lng: ${linkOnly.length} (opens in Maps, cannot be routed)`);

  // Per armada — the route runs per fleet, so this is the number that actually decides usefulness.
  const byFleet = {};
  custs.forEach((c) => {
    const f = (c.armada || '(tanpa armada)').trim() || '(tanpa armada)';
    const g = byFleet[f] || (byFleet[f] = { total: 0, with: 0 });
    g.total++; if (located(c)) g.with++;
  });
  console.log('\n  per armada (the route runs per fleet):');
  Object.keys(byFleet).sort().forEach((f) => {
    const g = byFleet[f];
    console.log(`   ${f.padEnd(16)} ${String(g.with).padStart(4)}/${String(g.total).padEnd(4)} ${String(pct(g.with, g.total)).padStart(3)}%  ${bar(pct(g.with, g.total))}`);
  });

  // The ones that actually cost the driver something: customers on a delivery schedule but unlocatable.
  const scheduledUnlocated = without.filter((c) => {
    let d = []; try { d = c.deliveryDays ? JSON.parse(c.deliveryDays) : []; } catch (e) {}
    return Array.isArray(d) && d.length > 0;
  });
  console.log(`\n  SCHEDULED but without coordinates: ${scheduledUnlocated.length} — these are the ones that break a route.`);
  scheduledUnlocated.slice(0, 40).forEach((c) => console.log(`   ${(c.code || '—').padEnd(8)} ${(c.armada || '—').padEnd(12)} ${c.name}`));
  if (scheduledUnlocated.length > 40) console.log(`   …and ${scheduledUnlocated.length - 40} more`);

  console.log('\n  FIX IN PLACE: on Pengiriman, each stop has a GPS button — a helper standing at the door');
  console.log('  taps it and the coordinates are saved to that customer (cap: distribusiPengiriman).');
  console.log('  No separate data-entry project needed; coverage fills in during normal deliveries.\n');
}

run().then(() => prisma.$disconnect()).catch(async (e) => { console.error('FAILED:', e); try { await prisma.$disconnect(); } catch (x) {} process.exit(1); });
