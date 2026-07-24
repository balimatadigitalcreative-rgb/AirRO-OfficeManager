'use strict';
// DISTRIBUSI module service — per-record REST, fully separate from the AirRO cash
// book (nothing here ever writes to the Entry/cash-flow tables). Core invariants:
//   • transaction unit price is LOCKED on the SERVER from the customer's master_price
//     (the client price, if any, is ignored) and amount is computed here;
//   • transactions + price history + corrections + audit are APPEND-ONLY — no update
//     or delete is exposed; mistakes are fixed by appending a correction;
//   • every write also appends an immutable DistAuditLog row.
const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const ApiError = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');
const { resolvePerms } = require('../config/permissions');
const { cycleOf } = require('./cashbon.rules');   // payroll cycle (16→15) for the "periode berjalan" scope
const { resolveUnitId } = require('./businessUnit.service');   // business-unit label (defaults to 'air')
const { resilientFindMany } = require('../lib/resilientFind');   // one bad row must not blank a whole list

const METHODS = ['lunas', 'bon', 'pelunasan'];
// Legacy (imported archive) transactions must NEVER touch any aggregate — KPIs, cash integration,
// receivables/bon, gallon totals. Add this to the `where` of every aggregate query. (`not: true`
// matches both false and legacy NULL, so it is safe on pre-migration rows too.)
const NOT_LEGACY = { legacy: { not: true } };
// A VOIDED (cancelled-but-kept) transaction is excluded from EVERY aggregate exactly like a legacy
// row — sisa bon, gallons, KPIs, receivables, invoices. `not: 'void'` matches active + pre-migration
// NULL. The Transactions LIST still shows voided rows (badged "Dibatalkan"); only the maths drops them.
const NOT_VOID = { status: { not: 'void' } };
const LIVE_TXN = { ...NOT_LEGACY, ...NOT_VOID };   // real, countable transactions
// RECEIVABLE (sisa bon) filter — DIFFERENT from LIVE_TXN on purpose. An outstanding bon is real debt
// regardless of when it was booked: a legacy/archive bon a customer still owes, and a legacy
// pelunasan that paid one down, BOTH belong in the balance. So the bon math includes legacy rows (it
// only drops VOID). Everything else — KPIs, gallons, cash integration — still excludes legacy via
// LIVE_TXN, so archive purchases never distort reports. This keeps sisa bon = Σ bon − Σ pelunasan
// (all non-void rows) correct after a historical import, while purchases stay archive-only.
const BON_METHODS = ['bon', 'pelunasan'];
// A row counts toward sisa bon iff it is bon/pelunasan, not void, AND flagged bonCounted (default
// true). `bonCounted` is INDEPENDENT of `legacy`, so an archive can keep or drop its receivable
// effect — while `legacy` still governs KPIs/gallons/cash exclusion.
const BON_TXN = { ...NOT_VOID, method: { in: BON_METHODS }, bonCounted: true };
// PELUNASAN TIDAK DITERIMA — the customer really paid their bon, but the money never reached the
// company (a staff member took it). Deliberately TWO-SIDED, and the two sides use different filters:
//   • CUSTOMER side — it IS a pelunasan. BON_TXN above still matches it, so their sisa bon drops and
//     their printed statement shows a received payment. They are never asked to pay twice, and the
//     internal reason never appears on anything customer-facing (it lives in `lossReason`, not `note`).
//   • COMPANY side — no cash arrived, so it must not appear in ANY money-in figure. `noMoneyIn(r)`
//     below is applied at every cash aggregate (dashboard money-in/tunai + per-fleet net cash, cash
//     integration, delivery report cash); the amount is reported as a LOSS against the responsible
//     staff instead (see lossReport).
const noMoneyIn = (r) => !!(r && r.paymentNotReceived);
const NOT_PNR = { paymentNotReceived: { not: true } };   // query-side twin of noMoneyIn (NULL-safe)
// Retroactive-price-change scopes (option b). Payments (pelunasan) are never re-priced.
const PRICE_SCOPES = ['all', 'cycle', 'bon'];
const todayISO = () => new Date().toISOString().slice(0, 10);
function scopeWhere(scope, today) {
  if (scope === 'bon') return { method: 'bon' };
  const sales = { method: { in: ['lunas', 'bon'] } };
  if (scope === 'cycle') { const c = cycleOf(today); return { ...sales, txnDate: { gte: c.start, lte: c.end } }; }
  return sales;   // 'all'
}
// Net active price-adjustment delta per transaction id, for corrections matching `where`.
async function activePriceDeltas(where) {
  const rows = await prisma.correction.findMany({ where: { kind: 'price', active: true, ...where }, select: { transactionId: true, deltaAmount: true } });
  const m = {}; rows.forEach((r) => { m[r.transactionId] = (m[r.transactionId] || 0) + r.deltaAmount; });
  return m;
}
// Effective amount of a transaction whose `corrections` are loaded = original + Σ active price deltas.
const priceDelta = (corrections) => (corrections || []).filter((x) => x.kind === 'price' && x.active).reduce((a, x) => a + x.deltaAmount, 0);
const hasManualCorrection = (corrections) => (corrections || []).some((x) => x.kind !== 'price');
// Delivery-day codes (Mon…Sun). Stored on the customer as a JSON array of these.
const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
// Seed customer types — ids match the legacy string values so existing rows stay valid.
const SEED_TYPES = [
  { id: 'reguler', label: 'Reguler', sortOrder: 0 },
  { id: 'kos', label: 'Kos', sortOrder: 1 },
  { id: 'cafe', label: 'Cafe', sortOrder: 2 },
  { id: 'bulk', label: 'Bulk', sortOrder: 3 },
];
const int = (v) => Math.max(0, Math.round(+v || 0));
// Per-row money ceiling — a single transaction/price/expense above this is almost certainly a typo
// (a mis-entered qty or price). Reject it server-side with a clear message so a bad row can never be
// created again (this is what produced the 4.2-billion amount that broke the transaction list). One
// billion rupiah per row is far above any real single delivery/expense.
const MAX_ROW_AMOUNT = 1000000000;
const overCeiling = (n) => Number(n) > MAX_ROW_AMOUNT;
const ceilingMsg = 'Nominal terlalu besar (maks Rp 1.000.000.000 per baris) — periksa jumlah/harga, kemungkinan salah ketik.';
// A pelunasan (bon settlement) is a bank TRANSFER — not field cash — when its note ends with the
// " · Transfer" tag written at pay time (see createTransaction); otherwise it counts as cash. Used
// by the dashboard cash split and the delivery report so both agree on what a driver owes in cash.
const isTransferPayment = (r) => { if (r.method !== 'pelunasan') return false; const parts = String(r.note || '').split(' · '); return parts[parts.length - 1].trim().toLowerCase() === 'transfer'; };
const cleanDays = (v) => { const a = Array.isArray(v) ? v : []; return DAY_CODES.filter((d) => a.includes(d)); };   // dedup + canonical order

// ── Fleet scope (per-user data separation) ──────────────────────────────────
// A user's fleetScope (from the token) is 'all'/null (full access) or an array of fleet
// names. Customers carry their fleet in `armada`; transactions & audit rows in `fleetId`.
// EVERY read filters by scope; EVERY write is forced within scope — server-enforced.
function fleetScopeOf(user) {
  const raw = user && user.fleetScope;
  if (raw == null || raw === 'all' || raw === '') return null;   // full access
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const a = JSON.parse(raw); if (Array.isArray(a)) return a.filter(Boolean); if (a === 'all') return null; } catch (e) {}
  return null;   // unparseable → full access (only an explicit array restricts)
}
// Prisma `where` fragment for a fleet column, honouring the scope + an optional explicit
// filter (`qFleet`, only meaningful for full-access users toggling a fleet).
function fleetWhere(user, col, qFleet) {
  const scope = fleetScopeOf(user);
  if (scope === null) return (qFleet && qFleet !== 'all') ? { [col]: qFleet } : {};
  const allowed = (qFleet && qFleet !== 'all') ? scope.filter((f) => f === qFleet) : scope;
  return { [col]: { in: allowed.length ? allowed : ['__no_fleet__'] } };   // empty → matches nothing
}
const fleetAllows = (user, fleet) => { const s = fleetScopeOf(user); return s === null ? true : (!!fleet && s.includes(fleet)); };
// The fleet a WRITE must carry: a scoped user cannot write outside their scope; a
// single-fleet staff is forced to their fleet (empty/other → their fleet, cross → 403).
function resolveWriteFleet(user, chosen) {
  const scope = fleetScopeOf(user);
  const c = (chosen || '').trim();
  if (scope === null) return c;                      // full access: whatever (may be '')
  if (c && !scope.includes(c)) throw ApiError.forbidden('Armada di luar akses Anda.');
  return c || scope[0];                              // default to their (first) fleet
}

// ── Customer types (editable dictionary) ──────────────────────────────────────
// Ensure the seed types exist (idempotent). Run at startup; resetDb re-seeds in tests.
async function seedCustomerTypes() {
  try {
    for (const t of SEED_TYPES) {
      const existing = await prisma.customerType.findUnique({ where: { id: t.id } });
      if (!existing) await prisma.customerType.create({ data: t });
    }
  } catch (e) { /* table may not exist yet on very first migrate; ignored */ }
}
async function listTypes() {
  const data = await prisma.customerType.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  return { data };
}
async function validTypeId(id) {
  if (!id) return 'reguler';
  const t = await prisma.customerType.findUnique({ where: { id } });
  return t ? t.id : 'reguler';   // unknown type id falls back to reguler (import back-compat)
}
async function createType(body, actor) {
  const label = String(body.label || '').trim();
  if (!label) throw ApiError.badRequest('Nama tipe tidak boleh kosong.');
  const all = await prisma.customerType.findMany();
  if (all.some((t) => t.label.toLowerCase() === label.toLowerCase())) throw ApiError.badRequest(`Tipe "${label}" sudah ada.`);
  const snap = await actorSnap(actor);
  const t = await prisma.customerType.create({ data: { label, sortOrder: all.length } });
  await logAudit('pelanggan', `Tipe pelanggan baru: ${label}`, '', snap);
  return t;
}
async function renameType(id, body, actor) {
  const cur = await prisma.customerType.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Tipe tidak ditemukan');
  const label = String(body.label || '').trim();
  if (!label) throw ApiError.badRequest('Nama tipe tidak boleh kosong.');
  const all = await prisma.customerType.findMany();
  if (all.some((t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase())) throw ApiError.badRequest(`Tipe "${label}" sudah ada.`);
  const snap = await actorSnap(actor);
  const t = await prisma.customerType.update({ where: { id }, data: { label } });
  await logAudit('pelanggan', `Ubah nama tipe: ${cur.label} → ${label}`, '', snap);
  return t;   // customers keep the same type id → rename is safe
}
// Delete a type. If customers still use it, refuse unless a reassignTo type is given
// (then move those customers to it first). Never leave a customer on a missing type.
async function deleteType(id, reassignTo, actor) {
  const cur = await prisma.customerType.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Tipe tidak ditemukan');
  if ((await prisma.customerType.count()) <= 1) throw ApiError.badRequest('Minimal satu tipe pelanggan harus ada.');
  const inUse = await prisma.customer.count({ where: { type: id } });
  if (inUse > 0) {
    if (!reassignTo) throw ApiError.badRequest(`Tipe ini masih dipakai ${inUse} pelanggan. Pindahkan dulu ke tipe lain.`, { inUse });
    if (reassignTo === id) throw ApiError.badRequest('Pilih tipe tujuan yang berbeda.');
    const dest = await prisma.customerType.findUnique({ where: { id: reassignTo } });
    if (!dest) throw ApiError.badRequest('Tipe tujuan tidak valid.');
    await prisma.customer.updateMany({ where: { type: id }, data: { type: reassignTo } });
  }
  const snap = await actorSnap(actor);
  await prisma.customerType.delete({ where: { id } });
  await logAudit('pelanggan', `Hapus tipe: ${cur.label}`, inUse > 0 ? `${inUse} pelanggan dipindahkan` : '', snap);
  return { deleted: true, reassigned: inUse };
}

// actor = req.user ({ id, role, username }). We snapshot id+role (+name from DB) so
// the trail is historical and can never be forged from the request body.
async function actorSnap(actor) {
  const out = { actorId: (actor && actor.id) || null, actorRole: (actor && actor.role) || null, actorName: null, actorStaff: false, canPrice: false };
  if (actor && actor.id) {
    const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, role: true, permissions: true } });
    if (u) {
      out.actorName = u.name;
      const perms = resolvePerms(u.role, u.permissions);
      // A "staff" actor has base distribusi but none of the owner distribusi caps.
      out.actorStaff = !!(perms.distribusi && !perms.distribusiAudit && !perms.distribusiHargaMaster && !perms.distribusiCustomers);
      // May this actor change a PRICE? Resolved from the DB (never from the token/client body) —
      // gates the unitPrice field of a correction, both at request and at approve time.
      out.canPrice = !!perms.distribusiHargaMaster;
    }
  }
  return out;
}
// Append one immutable audit row. `snap` is the resolved actor snapshot. `fleetId`
// tags the event's fleet ('' = global/cross-fleet).
async function logAudit(kind, title, detail, snap, fleetId) {
  return prisma.distAuditLog.create({ data: { kind, title, detail: detail || '', fleetId: fleetId || '', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, actorStaff: !!snap.actorStaff } });
}

// ── Customers ──────────────────────────────────────────────────────────────
// Expose deliveryDays as a parsed array (stored as a JSON string). Old rows without
// the column default to [] / '' → they render as "—" on the client.
// The effective navigation link: a pasted Google Maps share link if set, else one built
// from the GPS coordinates (both open Google Maps / directions on the device — free).
const mapsLinkOf = (c) => (c && c.mapsUrl && String(c.mapsUrl).trim()) || ((c && c.lat != null && c.lng != null) ? ('https://www.google.com/maps?q=' + c.lat + ',' + c.lng) : '');
// Light validation: keep only an http(s) URL (trimmed, capped); anything else → ''.
function cleanMapsUrl(u) { const s = String(u || '').trim(); return /^https?:\/\//i.test(s) ? s.slice(0, 500) : ''; }
// ONE shared completeness rule so the badge, filter, and counts never disagree. A customer is
// "complete" when it has BOTH a phone AND a location (mapsUrl OR lat+lng). `missing` also lists
// the softer-but-important gaps (armada / delivery days / price) so the detail can show every fix.
function customerCompleteness(c) {
  const hasPhone = !!(c.phone && String(c.phone).trim());
  const hasLoc = !!mapsLinkOf(c);
  const hasArmada = !!(c.armada && String(c.armada).trim());
  let days = c.deliveryDays; if (typeof days === 'string') { try { days = JSON.parse(days); } catch (e) { days = []; } }
  const hasDays = Array.isArray(days) && days.length > 0;
  const hasPrice = (+c.masterPrice || 0) > 0;
  const missing = [];
  if (!hasPhone) missing.push('phone');
  if (!hasLoc) missing.push('location');
  if (!hasArmada) missing.push('armada');
  if (!hasDays) missing.push('deliveryDays');
  if (!hasPrice) missing.push('price');
  return { complete: hasPhone && hasLoc, missing };   // core = phone + location
}
function custClient(c) {
  let days = []; try { days = c.deliveryDays ? JSON.parse(c.deliveryDays) : []; } catch (e) {}
  let reminder = null; try { reminder = c.reminder ? JSON.parse(c.reminder) : null; } catch (e) {}
  const mapsLink = mapsLinkOf(c);
  const comp = customerCompleteness(c);
  return {
    ...c, code: c.code || '', deliveryDays: Array.isArray(days) ? days : [], armada: c.armada || '', reminder,
    lat: c.lat != null ? c.lat : null, lng: c.lng != null ? c.lng : null, address: c.address || '',
    mapsUrl: c.mapsUrl || '', mapsLink, hasLocation: !!mapsLink,
    locationSetAt: c.locationSetAt ? new Date(c.locationSetAt).getTime() : null, locationSetByName: c.locationSetByName || null,
    locationAccuracy: c.locationAccuracy != null ? c.locationAccuracy : null,   // metres; null = pasted/unknown
    locationPhotoId: c.locationPhotoId || null,
    locationPhotoAt: c.locationPhotoAt ? new Date(c.locationPhotoAt).getTime() : null, locationPhotoByName: c.locationPhotoByName || null,
    active: c.active !== false,   // deactivated customers are hidden from active list + new txn/delivery selection
    deactivatedAt: c.deactivatedAt ? new Date(c.deactivatedAt).getTime() : null, deactivatedByName: c.deactivatedByName || null,
    complete: comp.complete, missing: comp.missing,
  };
}
// Normalise + serialise a billing-reminder config. Any combination of modes; empty → ''.
function cleanReminder(r) {
  if (!r || typeof r !== 'object') return '';
  const out = {
    enabled: !!r.enabled,
    dueDay: Math.max(0, Math.min(31, Math.round(+r.dueDay || 0))),           // remind on this calendar day (0 = off)
    weekday: DAY_CODES.includes(r.weekday) ? r.weekday : '',                 // remind on this weekday ('' = off)
    overdueDays: Math.max(0, Math.round(+r.overdueDays || 0)),               // remind if oldest unpaid bon ≥ N days old (0 = off)
    gallonThreshold: Math.max(0, Math.round(+r.gallonThreshold || 0)),       // remind if gallons held ≥ N (0 = off)
    bonThreshold: Math.max(0, Math.round(+r.bonThreshold || 0)),             // remind if sisa bon ≥ N (0 = off)
  };
  return JSON.stringify(out);
}
// Per-customer rollups from the (immutable) transactions: total gallons, running
// bon (sisaBon = bon booked − pelunasan collected, floored at 0), last activity.
// Build the DB-level WHERE for the detailed customer filter. Everything that can be
// expressed against a column is done here (so a large dataset never ships to the client);
// only `bon` needs post-filtering because sisaBon is computed from the transaction ledger.
// `q` searches name / phone / code. Phone is matched on the NORMALISED form as well, so
// searching "0812…" finds a row stored either way.
function customerFilterWhere(f) {
  const w = {};
  const AND = [];
  const q = String(f.q || '').trim();
  if (q) {
    const phoneDigits = normalizePhone(q);
    const or = [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }];
    if (phoneDigits && phoneDigits !== q) or.push({ phone: { contains: phoneDigits } });
    AND.push({ OR: or });
  }
  const types = String(f.types || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (types.length) AND.push({ type: { in: types } });
  const pMin = f.priceMin != null && f.priceMin !== '' ? Math.max(0, Math.round(+f.priceMin || 0)) : null;
  const pMax = f.priceMax != null && f.priceMax !== '' ? Math.max(0, Math.round(+f.priceMax || 0)) : null;
  if (pMin != null) AND.push({ masterPrice: { gte: pMin } });
  if (pMax != null) AND.push({ masterPrice: { lte: pMax } });
  // "Punya lokasi" = a maps link OR coordinates (mirrors mapsLinkOf / hasLocation).
  const hasLoc = { OR: [{ mapsUrl: { not: '' } }, { AND: [{ lat: { not: null } }, { lng: { not: null } }] }] };
  const noLoc = { AND: [{ mapsUrl: '' }, { OR: [{ lat: null }, { lng: null }] }] };
  if (f.hasLocation === 'ya') AND.push(hasLoc);
  else if (f.hasLocation === 'tidak') AND.push(noLoc);
  // Completeness reuses the SAME core rule as customerCompleteness(): phone AND location.
  if (f.complete === 'lengkap') AND.push({ AND: [{ phone: { not: '' } }, hasLoc] });
  else if (f.complete === 'belum') AND.push({ OR: [{ phone: '' }, noLoc] });
  // deliveryDays is a JSON array string — match the quoted code so "Sen" can't hit "Senin".
  const days = String(f.days || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (days.length) {
    const conds = days.map((d) => ({ deliveryDays: { contains: '"' + d + '"' } }));
    AND.push(f.daysMode === 'all' ? { AND: conds } : { OR: conds });
  }
  if (AND.length) w.AND = AND;
  return w;
}

async function listCustomers(user, qFleet, status, filters) {
  // status: 'active' (default) hides deactivated · 'inactive' shows only deactivated · 'all' shows both.
  const f = filters || {};
  const st = status === 'inactive' || status === 'all' ? status : 'active';
  const activeWhere = st === 'active' ? { active: { not: false } } : st === 'inactive' ? { active: false } : {};
  const scopeWhere = fleetWhere(user, 'armada', qFleet);
  // Denominator for "Menampilkan X dari Y": everything this user may see in the chosen
  // fleet, before any of the detailed criteria are applied.
  const total = await prisma.customer.count({ where: scopeWhere });
  const rows = await resilientFindMany(prisma.customer, { where: { ...scopeWhere, ...activeWhere, ...customerFilterWhere(f) }, orderBy: { name: 'asc' } }, 'customers');
  // Non-void rows (legacy INCLUDED) so sisa bon counts historical bon/pelunasan; gallons/count/last
  // activity below still exclude legacy so archive rows never distort those stats.
  const txns = await prisma.distTransaction.findMany({ where: { ...fleetWhere(user, 'fleetId', qFleet), ...NOT_VOID }, select: { id: true, customerId: true, qty: true, amount: true, method: true, txnDate: true, legacy: true, bonCounted: true } });
  const deltaMap = await activePriceDeltas({});   // effective bon includes active price adjustments
  const agg = {};
  txns.forEach((t) => {
    const a = agg[t.customerId] || (agg[t.customerId] = { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 });
    const eff = t.amount + (deltaMap[t.id] || 0);
    if (t.bonCounted) { if (t.method === 'bon') a.bon += eff; else if (t.method === 'pelunasan') a.pelunasan += t.amount; }   // receivable (bonCounted, incl. legacy)
    if (!t.legacy) { a.totalGalon += t.qty; a.txnCount++; if (t.txnDate > a.lastDate) a.lastDate = t.txnDate; }   // stats exclude archive
  });
  const heldMap = await gallonBalances(user, qFleet);   // gallons each customer currently holds
  let data = rows.map((c) => {
    const a = agg[c.id] || { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 };
    return { ...custClient(c), totalGalon: a.totalGalon, sisaBon: Math.max(0, a.bon - a.pelunasan), lastDate: a.lastDate || null, txnCount: a.txnCount, gallonsHeld: heldMap[c.id] || 0 };
  });
  // `bon` is the one criterion that can't be a DB predicate — sisaBon is derived from the
  // transaction ledger (+ active price adjustments), so it's applied to the computed rows.
  if (f.bon === 'ada') data = data.filter((c) => (c.sisaBon || 0) > 0);
  else if (f.bon === 'lunas') data = data.filter((c) => (c.sisaBon || 0) <= 0);
  const bonMin = f.bonMin != null && f.bonMin !== '' ? Math.max(0, Math.round(+f.bonMin || 0)) : null;
  if (bonMin != null && bonMin > 0) data = data.filter((c) => (c.sisaBon || 0) >= bonMin);
  return { data, total, filtered: data.length };
}
async function getCustomer(id, user) {
  const c = await prisma.customer.findUnique({ where: { id }, include: { priceHistory: { orderBy: { changedAt: 'desc' } } } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(user, c.armada)) throw ApiError.notFound('Customer not found');   // out of the user's fleet scope
  // The transaction LIST includes legacy (archive) rows — flagged — because the printed statement
  // needs them; the STATS below (totalGalon / sisaBon) count only real (non-legacy) rows.
  const txns = await prisma.distTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, include: { corrections: true } });
  let bon = 0, pelunasan = 0, totalGalon = 0;
  const transactions = txns.map((t) => {
    const adj = priceDelta(t.corrections);
    const eff = t.amount + adj;
    const voided = t.status === 'void';
    if (!voided) {
      // Receivable (sisa bon) counts a bon/pelunasan row iff bonCounted (default true) — independent
      // of legacy, so an archive can keep or drop its receivable. bon uses the EFFECTIVE (adjusted)
      // amount; a paid txn's adjustment is reported but does not become a new receivable.
      if (t.bonCounted) { if (t.method === 'bon') bon += eff; else if (t.method === 'pelunasan') pelunasan += t.amount; }
      if (!t.legacy) totalGalon += t.qty;   // gallons-sold stat still excludes archive rows
    }
    return { id: t.id, qty: t.qty, unitPriceLocked: t.unitPriceLocked, amount: t.amount, adjustAmount: adj, effectiveAmount: eff, method: t.method, txnDate: t.txnDate, note: t.note, actorName: t.actorName, createdAt: t.createdAt ? new Date(t.createdAt).getTime() : null, corrected: hasManualCorrection(t.corrections), adjusted: adj !== 0, legacy: !!t.legacy, bonCounted: !!t.bonCounted, openingBon: !!t.openingBon, importBatchId: t.importBatchId || null,
      status: t.status || 'active', voided, voidReason: t.voidReason || null, voidedByName: t.voidedByName || null, voidedAt: t.voidedAt ? new Date(t.voidedAt).getTime() : null };
  });
  // Legacy import batches (for the "Batalkan" undo list): one entry per importBatchId.
  const impMap = {};
  txns.forEach((t) => { if (t.legacy && t.importBatchId) { const b = impMap[t.importBatchId] || (impMap[t.importBatchId] = { batchId: t.importBatchId, count: 0, at: null, byName: t.actorName || null }); b.count++; const ms = t.createdAt ? new Date(t.createdAt).getTime() : 0; if (!b.at || ms < b.at) b.at = ms; } });
  const imports = Object.values(impMap).sort((a, b) => (b.at || 0) - (a.at || 0));
  // Active price-adjustment batches (for the "batalkan penyesuaian" UI).
  const batches = {};
  txns.forEach((t) => t.corrections.filter((x) => x.kind === 'price' && x.active).forEach((x) => {
    let nv = {}, ov = {}; try { nv = x.newValue ? JSON.parse(x.newValue) : {}; } catch (e) {} try { ov = x.oldValue ? JSON.parse(x.oldValue) : {}; } catch (e) {}
    const b = batches[x.batchId] || (batches[x.batchId] = { batchId: x.batchId, count: 0, totalDelta: 0, createdAt: x.createdAt ? new Date(x.createdAt).getTime() : null, oldPrice: ov.oldPrice, newPrice: nv.newPrice, scope: nv.scope, actorName: x.actorName || null });
    b.count++; b.totalDelta += x.deltaAmount;
  }));
  const priceAdjustments = Object.values(batches).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const gallonsHeld = await gallonBalanceOf(id);   // computed from the gallon ledger
  return { ...custClient(c), transactions, imports, totalGalon, sisaBon: Math.max(0, bon - pelunasan), txnCount: txns.filter((t) => !t.legacy).length, priceAdjustments, gallonsHeld };
}
// Sync write columns (type is resolved separately — it needs a DB lookup).
function customerCols(body) {
  return {
    name: String(body.name || '').trim(),
    phone: body.phone != null ? normalizePhone(body.phone) : '',   // always stored as "08…"
    masterPrice: int(body.masterPrice != null ? body.masterPrice : body.master_price),
    deliveryDays: JSON.stringify(cleanDays(body.deliveryDays)),
    armada: body.armada != null ? String(body.armada).trim() : '',
    reminder: cleanReminder(body.reminder),
    address: body.address != null ? String(body.address).slice(0, 300) : '',
    mapsUrl: cleanMapsUrl(body.mapsUrl),
  };
}
// Allocate the next human-readable customer code (C-0001, C-0002, …), server-side + race-safe.
// Mirrors the EmployeeNip allocator: a dedicated append-only counter table means the sequence is
// MONOTONIC — codes are never reused even when a customer is deactivated or deleted. On a unique
// clash (two concurrent creates) the loser retries with the next number.
async function allocateCustomerCode() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = await prisma.customerCode.count();
    const seq = count + 1;
    const code = 'C-' + String(seq).padStart(4, '0');
    try { await prisma.customerCode.create({ data: { code, seq } }); return code; }
    catch (e) { if (e && e.code === 'P2002') continue; throw e; }
  }
  throw ApiError.conflict('Gagal mengalokasikan kode pelanggan (terlalu banyak bentrokan, coba lagi).');
}
async function createCustomer(body, actor) {
  const cols = customerCols(body);
  if (!cols.name) throw ApiError.badRequest('name is required');
  cols.type = await validTypeId(body.type);
  cols.armada = resolveWriteFleet(actor, cols.armada);   // scoped staff → forced to their fleet
  const snap = await actorSnap(actor);
  const loc = normLatLng(body.lat, body.lng);            // optional coordinates at creation
  if (loc) { cols.lat = loc.lat; cols.lng = loc.lng; if (body.accuracy != null && Number.isFinite(+body.accuracy)) cols.locationAccuracy = Math.max(0, Math.round(+body.accuracy)); }
  if (loc || cols.mapsUrl) { cols.locationSetAt = new Date(); cols.locationSetByName = snap.actorName; }   // location provided at creation → stamp
  cols.code = await allocateCustomerCode();
  const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
  await logAudit('pelanggan', `Pelanggan baru: ${c.name}`, `Tipe ${c.type} · harga master ${c.masterPrice}`, snap, c.armada);
  return custClient(c);
}
// Edit an existing customer's editable fields (name/phone/type/deliveryDays/armada).
// masterPrice is intentionally NOT editable here — it changes only via updatePrice
// (owner-gated, writes price_history). Only the provided fields are touched.
async function updateCustomer(id, body, actor) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, cur.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const data = {};
  if (body.name != null) { const n = String(body.name).trim(); if (!n) throw ApiError.badRequest('name is required'); data.name = n; }
  if (body.phone != null) data.phone = normalizePhone(body.phone);
  if (body.deliveryDays !== undefined) data.deliveryDays = JSON.stringify(cleanDays(body.deliveryDays));
  if (body.armada !== undefined) data.armada = resolveWriteFleet(actor, body.armada);   // can't move out of scope
  if (body.reminder !== undefined) data.reminder = cleanReminder(body.reminder);        // billing-reminder settings
  if (body.type != null) data.type = await validTypeId(body.type);
  if (body.address !== undefined) data.address = String(body.address || '').slice(0, 300);
  const snap = await actorSnap(actor);
  // Google Maps link (pasted). '' clears it. A non-empty link stamps who/when. A pasted link
  // carries no GPS accuracy → clear locationAccuracy so a stale ±m from an old reading can't mislead.
  if (body.mapsUrl !== undefined) { data.mapsUrl = cleanMapsUrl(body.mapsUrl); if (data.mapsUrl) { data.locationSetAt = new Date(); data.locationSetByName = snap.actorName; data.locationAccuracy = null; } }
  // Manual coordinate entry. Providing both sets them + stamps; null/'' for both clears.
  if (body.lat !== undefined || body.lng !== undefined) {
    const loc = normLatLng(body.lat, body.lng);
    if (loc) { data.lat = loc.lat; data.lng = loc.lng; data.locationSetAt = new Date(); data.locationSetByName = snap.actorName; data.locationAccuracy = null; }
    else if ((body.lat === null || body.lat === '') && (body.lng === null || body.lng === '')) { data.lat = null; data.lng = null; data.locationAccuracy = null; }
  }
  const c = await prisma.customer.update({ where: { id }, data });
  await logAudit('pelanggan', `Ubah pelanggan: ${c.name}`, `Tipe ${c.type}`, snap, c.armada);
  return custClient(c);
}
// Coordinate validation: finite numbers within earth bounds (or null if invalid).
function normLatLng(lat, lng) {
  const a = typeof lat === 'string' ? parseFloat(lat) : lat;
  const b = typeof lng === 'string' ? parseFloat(lng) : lng;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}
// Field GPS tagging (delivery staff). Sets the coordinates + stamps who/when. Respects
// fleet scope. Separate from updateCustomer so it needs only the delivery caps, not
// full customer-management.
async function setCustomerLocation(id, body, actor) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, cur.armada)) throw ApiError.forbidden('Pelanggan di luar akses Anda.');
  const loc = normLatLng(body.lat, body.lng);
  if (!loc) throw ApiError.badRequest('Koordinat tidak valid.');
  const snap = await actorSnap(actor);
  const acc = (body.accuracy != null && Number.isFinite(+body.accuracy)) ? Math.max(0, Math.round(+body.accuracy)) : null;
  // Also build a ready-to-use Maps link from the point so "Petunjuk Arah" works right away.
  const data = { lat: loc.lat, lng: loc.lng, mapsUrl: 'https://www.google.com/maps?q=' + loc.lat + ',' + loc.lng, locationAccuracy: acc, locationSetAt: new Date(), locationSetByName: snap.actorName };
  if (body.address !== undefined) data.address = String(body.address || '').slice(0, 300);
  const c = await prisma.customer.update({ where: { id }, data });
  await logAudit('pelanggan', `Set lokasi: ${c.name}`, `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}${acc != null ? ' · ±' + acc + ' m' : ''}`, snap, c.armada);
  return custClient(c);
}
// Attach / replace / remove a customer's LOCATION PHOTO. The photo bytes already live in the
// Attachment store (uploaded via the existing /attachments flow); here we only store its id + who/
// when. photoId null removes it. Same audience as location tagging (delivery helpers + customer
// managers); fleet scope enforced. NOT part of the completeness check — optional extra info.
async function setLocationPhoto(id, body, actor) {
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, cur.armada)) throw ApiError.forbidden('Pelanggan di luar akses Anda.');
  const snap = await actorSnap(actor);
  const photoId = body.photoId ? String(body.photoId).slice(0, 60) : null;
  const data = { locationPhotoId: photoId, locationPhotoAt: photoId ? new Date() : null, locationPhotoByName: photoId ? snap.actorName : null };
  const c = await prisma.customer.update({ where: { id }, data });
  await logAudit('pelanggan', `${photoId ? 'Foto lokasi' : 'Hapus foto lokasi'}: ${c.name}`, photoId ? `oleh ${snap.actorName}` : '', snap, c.armada);
  return custClient(c);
}
// Bulk import. The client already validates + dedups in the preview and sends only the valid
// rows (+ how many it skipped). The server still dedups DEFENSIVELY by name+phone (against existing
// customers in scope + within the batch) so a race/duplicate can't slip in, and the audit records
// the true imported/skipped counts (who, when). Each new customer gets a sequential code.
async function importCustomers(list, actor, clientSkipped) {
  const rows = Array.isArray(list) ? list : [];
  const snap = await actorSnap(actor);
  // Dedup on the NORMALISED phone so "8123…" (Excel-mangled) and "08123…" are the same person.
  const dupKey = (n, p) => (String(n || '').trim().toLowerCase() + '|' + normalizePhone(p));
  const existing = await prisma.customer.findMany({ where: fleetWhere(actor, 'armada'), select: { name: true, phone: true } });
  const seen = new Set(existing.map((c) => dupKey(c.name, c.phone)));
  let created = 0, serverSkipped = 0; const out = [];
  for (const item of rows) {
    const cols = customerCols(item);
    if (!cols.name || cols.masterPrice <= 0) { serverSkipped++; continue; }   // missing required
    const k = dupKey(cols.name, cols.phone);
    if (seen.has(k)) { serverSkipped++; continue; }                            // duplicate name+phone
    seen.add(k);
    cols.type = await validTypeId(item.type);
    cols.armada = resolveWriteFleet(actor, cols.armada);   // scoped importer → their fleet
    cols.code = await allocateCustomerCode();
    const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
    out.push(custClient(c)); created++;
  }
  const skipped = Math.max(0, Math.round(+clientSkipped || 0)) + serverSkipped;
  await logAudit('impor', `Impor pelanggan: ${created} ditambah`, `${created} ditambah · ${skipped} dilewati (duplikat/data kurang)`, snap);
  return { data: out, imported: created, skipped, received: rows.length };
}

// A real calendar date in strict YYYY-MM-DD (the client normalises other formats before sending).
function validTxnDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
// Import LEGACY (historical) transactions for ONE customer — ARCHIVE ONLY. Every row is created
// with legacy=true + a shared importBatchId, unit price = the row's price (NOT the master price),
// and NO GallonMovement is ever written. Idempotent: dedupe by (customerId+date+qty+amount) within
// the batch AND against existing rows. The customerId comes from the ROUTE — any customer column in
// the file is ignored. Fleet scope + audit enforced.
// Derive the transaction from one imported row (the SAME rule the client preview uses). Exactly one
// action column must be filled: Pembelian Lunas (qty) → lunas, Pembelian Bon (qty) → bon,
// Pembayaran Bon (rupiah) → pelunasan (qty 0, reduces sisa bon). Returns { ok, method, qty, price,
// amount } or { ok:false, reason }. Also accepts the legacy shape {qty, method}.
function deriveLegacyRow(row) {
  const date = validTxnDate(row.txnDate);
  if (!date) return { ok: false, reason: 'Tanggal tidak valid' };
  const price = Math.round(+row.price || 0);
  const lunasQty = Math.round(+row.lunasQty || 0);
  const bonQty = Math.round(+row.bonQty || 0);
  const pay = Math.round(+row.paymentAmount || 0);
  // legacy fallback: {qty, method} with no action columns → treat as that purchase
  const legacyQty = Math.round(+row.qty || 0);
  const filled = [lunasQty > 0, bonQty > 0, pay > 0].filter(Boolean).length;
  if (filled === 0 && legacyQty > 0) {
    const method = row.method === 'bon' ? 'bon' : 'lunas';
    if (!(price > 0)) return { ok: false, reason: 'Harga wajib untuk pembelian' };
    return { ok: true, date, method, qty: legacyQty, price, amount: legacyQty * price };
  }
  if (filled === 0) return { ok: false, reason: 'Tidak ada aksi (isi salah satu: Lunas/Bon/Pembayaran)' };
  if (filled > 1) return { ok: false, reason: 'Lebih dari satu kolom aksi terisi — isi hanya satu' };
  if (lunasQty > 0 || bonQty > 0) {
    const method = lunasQty > 0 ? 'lunas' : 'bon';
    const qty = lunasQty > 0 ? lunasQty : bonQty;
    if (!(price > 0)) return { ok: false, reason: 'Harga wajib untuk pembelian' };
    return { ok: true, date, method, qty, price, amount: qty * price };
  }
  // payment
  if (!(pay > 0)) return { ok: false, reason: 'Nominal pembayaran harus > 0' };
  return { ok: true, date, method: 'pelunasan', qty: 0, price: 0, amount: pay };
}

async function importLegacyTransactions(customerId, rows, actor, clientSkipped, includeBon) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const snap = await actorSnap(actor);
  const list = Array.isArray(rows) ? rows : [];
  const batchId = 'lb' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  // Dedupe by (date + TYPE + amount) — within this batch AND against existing rows — so a re-import
  // is idempotent and a purchase never collides with a same-amount payment on the same day.
  const key = (d, m, a) => `${d}|${m}|${a}`;
  const existing = await prisma.distTransaction.findMany({ where: { customerId }, select: { txnDate: true, method: true, amount: true } });
  const seen = new Set(existing.map((t) => key(t.txnDate, t.method, t.amount)));
  // Whether the imported bon/pelunasan reconcile the customer's sisa bon. Default true (the historical
  // balance is counted); pass includeBon=false to import as pure archive that leaves sisa bon alone.
  const bonCounted = includeBon !== false;
  let created = 0, serverSkipped = 0;
  for (const row of list) {
    const d = deriveLegacyRow(row);
    if (!d.ok) { serverSkipped++; continue; }
    if (d.amount <= 0 || overCeiling(d.amount)) { serverSkipped++; continue; }
    const k = key(d.date, d.method, d.amount);
    if (seen.has(k)) { serverSkipped++; continue; }   // duplicate
    seen.add(k);
    await prisma.distTransaction.create({ data: {
      customerId, fleetId: customer.armada || '', qty: d.qty, unitPriceLocked: d.price, amount: d.amount, method: d.method, bonCounted,
      note: String(row.note || '').slice(0, 300), txnDate: d.date, legacy: true, importBatchId: batchId,
      actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
    } });   // legacy=true + NO GallonMovement — purchases stay archive-only; a pelunasan reduces sisa
            // bon because the receivable math (BON_TXN) counts legacy bon/pelunasan (see top of file).
    created++;
  }
  const skipped = Math.max(0, Math.round(+clientSkipped || 0)) + serverSkipped;
  await logAudit('impor', `Impor riwayat: ${customer.name}`, `batch ${batchId} · ${created} ditambah · ${skipped} dilewati (duplikat/invalid)`, snap, customer.armada);
  return { imported: created, skipped, batchId, received: list.length };
}
// Undo a whole legacy import batch — GM/OWNER ONLY. Safe: legacy rows touch no ledger. Only rows
// that are BOTH legacy AND in this batch AND this customer are removed (never a real sale).
async function undoLegacyBatch(customerId, batchId, actor) {
  if (!(actor && (actor.role === 'owner' || actor.role === 'gm'))) throw ApiError.forbidden('Hanya GM/Owner yang boleh membatalkan impor.');
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.notFound('Customer not found');
  const where = { customerId, importBatchId: String(batchId || ''), legacy: true };
  await prisma.correction.deleteMany({ where: { transaction: where } });   // defensive (legacy rows have none)
  const del = await prisma.distTransaction.deleteMany({ where });
  const snap = await actorSnap(actor);
  await logAudit('pelanggan', `Batalkan impor riwayat: ${customer.name}`, `batch ${batchId} · ${del.count} baris arsip dihapus`, snap, customer.armada);
  return { deleted: del.count, batchId };
}

// Small rollup used by both the deactivate flow and the delete-warning modal: how much
// history is attached to a customer (so the UI/audit can say "N transaksi & sisa bon Rp X").
async function customerImpact(id) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId: id }, include: { corrections: true } });
  let bon = 0, pelunasan = 0;
  // sisa bon counts a bon/pelunasan row iff bonCounted (default true) and not void — incl. legacy.
  txns.forEach((t) => { if (t.status === 'void' || !t.bonCounted) return; const eff = t.amount + priceDelta(t.corrections); if (t.method === 'bon') bon += eff; else if (t.method === 'pelunasan') pelunasan += t.amount; });
  return { txnCount: txns.length, sisaBon: Math.max(0, bon - pelunasan) };   // count includes legacy (they'll be deleted too)
}

// Mode (a) — Nonaktifkan: soft-hide the customer. ALL history (transactions, sisa bon,
// price history, deliveries) is kept and remains viewable; the customer just drops out of
// the active list + new txn/delivery selection. Reversible via reactivateCustomer.
async function deactivateCustomer(id, actor) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, c.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const snap = await actorSnap(actor);
  if (c.active === false) return custClient(c);   // already inactive — idempotent
  const updated = await prisma.customer.update({ where: { id }, data: { active: false, deactivatedAt: new Date(), deactivatedByName: snap.actorName } });
  const imp = await customerImpact(id);
  await logAudit('pelanggan', `Nonaktifkan pelanggan: ${c.name}`, `Riwayat tetap · ${imp.txnCount} transaksi · sisa bon ${imp.sisaBon}`, snap, c.armada);
  return custClient(updated);
}
// Restore a deactivated customer back to the active list.
async function reactivateCustomer(id, actor) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, c.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const snap = await actorSnap(actor);
  const updated = await prisma.customer.update({ where: { id }, data: { active: true, deactivatedAt: null, deactivatedByName: null } });
  await logAudit('pelanggan', `Aktifkan kembali pelanggan: ${c.name}`, `Kembali ke daftar aktif`, snap, c.armada);
  return custClient(updated);
}
// Mode (b) — Hapus permanen: delete the customer AND every related record in one
// transaction. FK relations default RESTRICT, so children are deleted first, deepest
// first: corrections (via their transaction) → transactions → deliveries → price history
// → invoices → gallon movements → the customer. Irreversible; the impact is audited BEFORE
// the wipe so the log survives (audit rows are not tied to the customer by FK).
async function deleteCustomer(id, actor) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, c.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const snap = await actorSnap(actor);
  const imp = await customerImpact(id);
  await prisma.$transaction([
    prisma.correction.deleteMany({ where: { transaction: { customerId: id } } }),
    prisma.distTransaction.deleteMany({ where: { customerId: id } }),
    prisma.delivery.deleteMany({ where: { customerId: id } }),
    prisma.priceHistory.deleteMany({ where: { customerId: id } }),
    prisma.distInvoice.deleteMany({ where: { customerId: id } }),
    prisma.gallonMovement.deleteMany({ where: { customerId: id } }),
    prisma.customer.delete({ where: { id } }),
  ]);
  await logAudit('pelanggan', `Hapus permanen pelanggan: ${c.name}`, `${imp.txnCount} transaksi & sisa bon ${imp.sisaBon} ikut terhapus · tidak bisa dikembalikan`, snap, c.armada);
  return { ok: true, deleted: { id, name: c.name }, impact: imp };
}

// Owner-only master price change. Appends price_history + audit; does NOT touch any
// existing transaction (their unit_price_locked stays exactly as sold).
async function updatePrice(id, newPriceRaw, actor, scopeRaw) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, c.armada)) throw ApiError.notFound('Customer not found');   // out of scope
  const newPrice = int(newPriceRaw);
  if (overCeiling(newPrice)) throw ApiError.badRequest(ceilingMsg, { newPrice });
  const oldPrice = c.masterPrice;
  const scope = PRICE_SCOPES.includes(scopeRaw) ? scopeRaw : null;   // null = option (a) new-only
  const snap = await actorSnap(actor);
  // Both options update master_price + price_history (old transactions' locked price is
  // never rewritten — new sales use the new price automatically).
  const [updated] = await prisma.$transaction([
    prisma.customer.update({ where: { id }, data: { masterPrice: newPrice } }),
    prisma.priceHistory.create({ data: { customerId: id, oldPrice, newPrice, changedById: snap.actorId, changedByName: snap.actorName, changedByRole: snap.actorRole } }),
  ]);

  let batchId = null, affected = 0, totalDelta = 0;
  if (scope && newPrice !== oldPrice) {
    // Option (b): append a numeric price adjustment per in-scope OLD transaction. The
    // original transaction is NEVER mutated; the effective/reported amount follows the
    // new price via these adjustments, grouped by batchId so the event can be reversed.
    const txns = await prisma.distTransaction.findMany({ where: { customerId: id, ...LIVE_TXN, ...scopeWhere(scope, todayISO()) } });
    batchId = 'pb' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    for (const t of txns) {
      const delta = (newPrice - oldPrice) * t.qty;
      if (delta === 0) continue;
      await prisma.correction.create({ data: {
        transactionId: t.id, kind: 'price', deltaAmount: delta, batchId, active: true,
        reason: `Penyesuaian harga master ${oldPrice} → ${newPrice}`,
        oldValue: JSON.stringify({ oldPrice, unitPriceLocked: t.unitPriceLocked, qty: t.qty, method: t.method }),
        newValue: JSON.stringify({ newPrice, scope }),
        actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, byStaff: !!snap.actorStaff,
      } });
      affected++; totalDelta += delta;
    }
    await logAudit('harga', `Harga master: ${c.name}`, `${oldPrice} → ${newPrice} · cakupan ${scope} · ${affected} transaksi disesuaikan · selisih ${totalDelta}`, snap, c.armada);
  } else {
    await logAudit('harga', `Harga master: ${c.name}`, `${oldPrice} → ${newPrice} · hanya transaksi baru`, snap, c.armada);
  }
  return { ...custClient(updated), batchId, affected, totalDelta, scope, oldPrice, newPrice };
}

// Preview the retroactive impact of a price change for each scope (no writes) — powers
// the options modal's "N transaksi · total selisih Rp X" summary.
async function pricePreview(id, newPriceRaw, user) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(user, c.armada)) throw ApiError.notFound('Customer not found');
  const newPrice = int(newPriceRaw);
  const oldPrice = c.masterPrice;
  const cyc = cycleOf(todayISO());
  const sales = await prisma.distTransaction.findMany({ where: { customerId: id, ...LIVE_TXN, method: { in: ['lunas', 'bon'] } }, select: { qty: true, method: true, txnDate: true } });
  const calc = (rows) => rows.reduce((acc, t) => { const d = (newPrice - oldPrice) * t.qty; if (d !== 0) { acc.count++; acc.totalDelta += d; } return acc; }, { count: 0, totalDelta: 0 });
  return {
    oldPrice, newPrice,
    cycle: { start: cyc.start, end: cyc.end },
    scopes: {
      all: calc(sales),
      cycle: calc(sales.filter((t) => t.txnDate >= cyc.start && t.txnDate <= cyc.end)),
      bon: calc(sales.filter((t) => t.method === 'bon')),
    },
  };
}

// Cancel a whole price-adjustment batch → its adjustments go inactive (effective amounts
// & bon revert). The original transactions are untouched; the reversal is audited.
async function cancelPriceAdjustment(batchId, actor) {
  const rows = await prisma.correction.findMany({ where: { kind: 'price', batchId, active: true } });
  if (!rows.length) throw ApiError.notFound('Batch penyesuaian tidak ditemukan atau sudah dibatalkan');
  // Scope check: the batch belongs to one customer → verify its fleet is in the actor's scope.
  const t0 = await prisma.distTransaction.findUnique({ where: { id: rows[0].transactionId }, include: { customer: { select: { name: true, armada: true } } } });
  if (!fleetAllows(actor, t0 && t0.fleetId)) throw ApiError.notFound('Batch penyesuaian tidak ditemukan atau sudah dibatalkan');
  const totalDelta = rows.reduce((a, r) => a + r.deltaAmount, 0);
  await prisma.correction.updateMany({ where: { kind: 'price', batchId, active: true }, data: { active: false } });
  const snap = await actorSnap(actor);
  const name = t0 && t0.customer ? t0.customer.name : '';
  await logAudit('harga', `Batalkan penyesuaian harga${name ? ': ' + name : ''}`, `batch ${batchId} · ${rows.length} transaksi · selisih ${-totalDelta}`, snap, t0 && t0.fleetId);
  return { reversed: rows.length, totalDelta };
}

// ── Transactions ── (immutable; price locked server-side)
async function listTransactions(q, user) {
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.date) where.txnDate = q.date;
  if (q.dateFrom || q.dateTo) { where.txnDate = {}; if (q.dateFrom) where.txnDate.gte = q.dateFrom; if (q.dateTo) where.txnDate.lte = q.dateTo; }
  if (q.customerId) where.customerId = q.customerId;
  if (q.method && METHODS.includes(q.method)) where.method = q.method;
  const rows = await resilientFindMany(prisma.distTransaction, {
    where, orderBy: { createdAt: 'desc' },
    include: { customer: { select: { name: true, code: true, type: true } }, corrections: { orderBy: { createdAt: 'desc' } } },
  }, 'transactions');
  // Pending change-requests (correction/void awaiting approval) for these rows → drives the
  // "Menunggu persetujuan" badge and blocks a second request. Plus each sale's current galon out/in,
  // so the structured correction form can pre-fill the actual input values (not just qty).
  const ids = rows.map((r) => r.id);
  const pendings = ids.length ? await prisma.distChangeRequest.findMany({ where: { transactionId: { in: ids }, status: 'pending' }, select: { transactionId: true, kind: true, requestedByName: true, createdAt: true } }) : [];
  const pendBy = {}; pendings.forEach((p) => { pendBy[p.transactionId] = { kind: p.kind, requestedByName: p.requestedByName || null, createdAt: p.createdAt ? new Date(p.createdAt).getTime() : null }; });
  const movs = ids.length ? await prisma.gallonMovement.findMany({ where: { transactionId: { in: ids }, active: true, type: { in: ['delivery_out', 'return_in'] } }, select: { transactionId: true, type: true, qty: true } }) : [];
  const galBy = {}; movs.forEach((m) => { const g = galBy[m.transactionId] || (galBy[m.transactionId] = { gallonOut: 0, gallonIn: 0 }); if (m.type === 'delivery_out') g.gallonOut += m.qty; else g.gallonIn += m.qty; });
  // Expose the effective (adjusted) amount + flags so reports/Cash Integration follow the
  // new price while the original `amount` stays intact. Legacy (archive) rows are INCLUDED here so
  // the Transactions screen can show them with an "Arsip" badge/filter — the `legacy` flag on each
  // row lets Cash Integration (and any aggregate) drop them.
  const data = rows.map((r) => { const adj = priceDelta(r.corrections); const g = galBy[r.id] || { gallonOut: 0, gallonIn: 0 }; return { ...r, legacy: !!r.legacy, adjustAmount: adj, effectiveAmount: r.amount + adj, adjusted: adj !== 0, correctedManual: hasManualCorrection(r.corrections), pendingRequest: pendBy[r.id] || null, gallonOut: g.gallonOut, gallonIn: g.gallonIn }; });
  return { data, now: new Date().toISOString() };
}
// Current outstanding bon (piutang) for a customer: Σ effective bon − Σ pelunasan,
// floored at 0 — identical to the sisaBon shown on the customer list/detail.
async function customerBonBalance(customerId) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId, ...BON_TXN }, include: { corrections: true } });   // includes legacy bon/pelunasan
  let bon = 0, pel = 0;
  txns.forEach((t) => { if (t.method === 'bon') bon += t.amount + priceDelta(t.corrections); else if (t.method === 'pelunasan') pel += t.amount; });
  return Math.max(0, bon - pel);
}

async function createTransaction(body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer) throw ApiError.badRequest('customerId does not reference an existing customer');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.forbidden('Pelanggan di luar akses armada Anda.');   // cross-fleet write blocked
  const method = METHODS.includes(body.method) ? body.method : 'lunas';
  // Deactivated customer: no new SALES (water out), but still allow pelunasan so any
  // outstanding bon can be collected. Restore the customer to sell to them again.
  if (customer.active === false && method !== 'pelunasan') throw ApiError.badRequest('Pelanggan nonaktif — aktifkan kembali untuk transaksi baru.');
  const fleetId = customer.armada || '';   // fleet is COPIED from the customer (not client-set)

  // ── Standalone BON PAYMENT (Pelunasan) — no water sold, qty 0, no gallon movement.
  // Reduces the customer's outstanding bon; recorded permanently + audited. Partial
  // (installment) payments are allowed; the payment can never exceed the current bon.
  if (method === 'pelunasan') {
    const payAmount = int(body.payAmount != null ? body.payAmount : body.amount);
    if (payAmount <= 0) throw ApiError.badRequest('Jumlah pembayaran harus lebih dari 0.');
    const sisaBon = await customerBonBalance(customer.id);
    if (sisaBon <= 0) throw ApiError.badRequest('Pelanggan ini tidak punya sisa bon.');
    if (payAmount > sisaBon) throw ApiError.badRequest(`Pembayaran (${payAmount}) melebihi sisa bon (${sisaBon}).`, { sisaBon });
    const payMethod = (body.payMethod === 'transfer') ? 'Transfer' : 'Cash';
    const snap = await actorSnap(actor);
    const note = [(body.note || '').trim(), payMethod].filter(Boolean).join(' · ');
    const txn = await prisma.distTransaction.create({ data: {
      customerId: customer.id, fleetId, qty: 0, unitPriceLocked: 0, amount: payAmount, method: 'pelunasan', note,
      txnDate: body.txnDate, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
    } });
    await logAudit('input', `Pelunasan bon: ${customer.name}`, `bayar ${payAmount} (${payMethod}) · sisa bon ${Math.max(0, sisaBon - payAmount)}`, snap, fleetId);
    return { ...txn, gallonOut: 0, gallonIn: 0, gallonsHeld: await gallonBalanceOf(customer.id), sisaBon: Math.max(0, sisaBon - payAmount), isPayment: true };
  }

  const qty = int(body.qty);
  if (qty <= 0) throw ApiError.badRequest('qty must be a positive integer');
  // PRICE LOCK: always the customer's current master_price — the client cannot set it.
  const unitPriceLocked = customer.masterPrice;
  const amount = qty * unitPriceLocked;
  if (overCeiling(amount) || overCeiling(unitPriceLocked)) throw ApiError.badRequest(ceilingMsg, { amount, qty, unitPriceLocked });
  const snap = await actorSnap(actor);
  const deliveryRunId = await openRunIdFor(fleetId);   // tag the sale to the fleet's open rit (if any)
  const txn = await prisma.distTransaction.create({ data: {
    customerId: customer.id, fleetId, qty, unitPriceLocked, amount, method, note: (body.note || '').trim(),
    txnDate: body.txnDate, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, deliveryRunId,
  } });
  // Gallon flow (loan/exchange): out = full gallons delivered (default = qty sold),
  // in = empty gallons returned. Recorded as append-only movements → customer balance.
  const gOut = body.gallonOut != null ? Math.max(0, int(body.gallonOut)) : qty;
  const gIn = Math.max(0, int(body.gallonIn));
  await recordDelivery(txn, customer, gOut, gIn, snap);
  const held = await gallonBalanceOf(customer.id);
  await logAudit('input', `Transaksi: ${customer.name}`, `${qty} × ${unitPriceLocked} = ${amount} (${method}) · galon keluar ${gOut} masuk ${gIn}`, snap, fleetId);
  return { ...txn, gallonOut: gOut, gallonIn: gIn, gallonsHeld: held };
}

// Append a correction to an immutable transaction. reason required; byStaff flags a
// staff-level actor (has 'distribusi' but none of the owner distribusi caps).
// ── OPENING / CARRY-OVER BON ────────────────────────────────────────────────
// Record a customer's PRIOR outstanding receivable (e.g. carried over from last year's
// spreadsheet, which couldn't be imported). Deliberately stored as an ORDINARY bon
// transaction — method:'bon', legacy:FALSE — so it needs no special-casing anywhere:
// every existing aggregation (list, detail, receivables/aging, cash integration, invoices)
// already sums method==='bon', and a 'pelunasan' reduces it like any other bon. The
// openingBon flag only labels the row and makes it auditable.
// Dated by the ADMIN (txnDate), so the receivable appears as of the real date, not today.
// Allowed for a deactivated customer too: this is historical debt, and collecting it via
// pelunasan is already permitted for inactive customers.
async function createOpeningBon(customerId, body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.forbidden('Pelanggan di luar akses armada Anda.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Nominal bon awal harus lebih dari 0.');
  if (overCeiling(amount)) throw ApiError.badRequest(ceilingMsg, { amount });
  const note = String(body.note || '').trim();
  if (!note) throw ApiError.badRequest('Keterangan wajib diisi.');
  const txnDate = String(body.txnDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) throw ApiError.badRequest('Tanggal bon tidak valid.');
  const snap = await actorSnap(actor);
  const before = await customerBonBalance(customer.id);
  const txn = await prisma.distTransaction.create({ data: {
    customerId: customer.id, fleetId: customer.armada || '', qty: 0, unitPriceLocked: 0,
    amount, method: 'bon', openingBon: true, legacy: false, note,
    txnDate, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
  } });
  await logAudit('input', `Bon awal: ${customer.name}`, `${amount} per ${txnDate} · ${note} · sisa bon ${before} → ${before + amount}`, snap, customer.armada || '');
  return { ...txn, isOpeningBon: true, sisaBon: before + amount, sisaBonBefore: before };
}

async function addCorrection(txnId, body, actor, isStaff) {
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!fleetAllows(actor, txn.fleetId)) throw ApiError.notFound('Transaction not found');   // out of scope
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('reason is required');
  const snap = await actorSnap(actor);
  const corr = await prisma.correction.create({ data: {
    transactionId: txnId, reason,
    oldValue: body.oldValue != null ? (typeof body.oldValue === 'string' ? body.oldValue : JSON.stringify(body.oldValue)) : null,
    newValue: body.newValue != null ? (typeof body.newValue === 'string' ? body.newValue : JSON.stringify(body.newValue)) : null,
    actorId: snap.actorId, actorRole: snap.actorRole, byStaff: !!isStaff,
  } });
  await logAudit('koreksi', `Koreksi transaksi${isStaff ? ' (staff)' : ''}`, reason, snap, txn.fleetId);
  return corr;
}

// Short human ref for a transaction — mirrors the client's shortRef (last 6, upper). Used as the
// typed-confirmation token for a hard delete and in audit lines.
const shortRefServer = (id) => String(id || '').slice(-6).toUpperCase();

// ── VOID (recorded cancellation) — the everyday cancel path (cap: distribusiVoid) ──────────────
// The record STAYS (status='void', shown "Dibatalkan", still filterable) but is excluded from
// EVERY aggregate — LIVE_TXN drops it from sisa bon / receivables / KPIs, and its gallon movements
// are reversed (set inactive) so no gallon number dangles. One immutable audit entry is written.
async function voidTransaction(txnId, body, actor) {
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId }, include: { customer: { select: { name: true } } } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!fleetAllows(actor, txn.fleetId)) throw ApiError.notFound('Transaction not found');   // out of fleet scope
  if (txn.status === 'void') throw ApiError.badRequest('Transaksi ini sudah dibatalkan.');
  if (txn.legacy) throw ApiError.badRequest('Baris arsip tidak masuk hitungan — tak perlu dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan pembatalan wajib diisi.');
  const snap = await actorSnap(actor);
  const updated = await prisma.$transaction(async (tx) => {
    // Reverse the gallon movements this sale produced (append-only ledger → deactivate, not delete).
    await tx.gallonMovement.updateMany({ where: { transactionId: txnId, active: true }, data: { active: false } });
    return tx.distTransaction.update({ where: { id: txnId }, data: {
      status: 'void', voidedById: snap.actorId, voidedByName: snap.actorName, voidedByRole: snap.actorRole, voidedAt: new Date(), voidReason: reason,
    } });
  });
  await logAudit('batal', `Batalkan transaksi: ${txn.customer ? txn.customer.name : ''}`, `${shortRefServer(txn.id)} · ${txn.method} ${txn.amount} · ${reason}`, snap, txn.fleetId);
  return { ...updated, voided: true, sisaBon: await customerBonBalance(txn.customerId), gallonsHeld: await gallonBalanceOf(txn.customerId) };
}

// ── APPROVAL-GATED CORRECTIONS / VOIDS ───────────────────────────────────────────
// A correction or void is submitted as a PENDING DistChangeRequest and applied only on approval.
// Requesting needs distribusiKoreksi (correction) / distribusiVoid (void); approving needs the
// separate distribusiApprove, and a requester can never approve their own request. Corrections are
// STRUCTURED and input-level: the requester edits qty/unitPrice/gallonOut/gallonIn (purchase) or the
// payment amount (pelunasan); the server RECOMPUTES the total and, on apply, rewrites the amount,
// the gallon movements and (through the normal aggregates) sisa bon / KPIs / cash.
const isPurchaseMethod = (m) => m === 'lunas' || m === 'bon';
// A real gallon SALE (qty × price + gallon movements). An opening/carry-over bon is method 'bon' but
// stores its amount directly (qty 0), so it is corrected like a pelunasan: the amount field only.
const isGallonSale = (txn) => isPurchaseMethod(txn.method) && !txn.openingBon;
// Current active galon out/in a sale produced (for pre-fill + old→new trail).
async function currentGallonsOf(txnId) {
  const rows = await prisma.gallonMovement.findMany({ where: { transactionId: txnId, active: true, type: { in: ['delivery_out', 'return_in'] } }, select: { type: true, qty: true } });
  let gallonOut = 0, gallonIn = 0;
  rows.forEach((m) => { if (m.type === 'delivery_out') gallonOut += m.qty; else gallonIn += m.qty; });
  return { gallonOut, gallonIn };
}
// Validate + normalize a structured correction payload against the txn's method.
// Returns { fields, newAmount }. Throws ApiError on any invalid input.
async function normalizeCorrection(txn, payload, opts) {
  const p = payload || {};
  // FIELD-LEVEL GATE: qty / gallonOut / gallonIn are editable by anyone who may request a correction
  // (distribusiKoreksi). The PRICE is not — only distribusiHargaMaster may change it. Enforced here,
  // server-side, against the transaction's STORED unitPriceLocked (the client's value is never
  // trusted): a non-holder sending a different price is rejected, and an absent/equal price is
  // pinned to the stored one. Applied at BOTH request time (requester's caps) and approve time
  // (approver's caps), so a price change can never slip through either door.
  const canPrice = !!(opts && opts.canPrice);
  if (isGallonSale(txn)) {
    const qty = int(p.qty);
    const gallonOut = int(p.gallonOut), gallonIn = int(p.gallonIn);   // int() floors negatives to 0
    let unitPrice = int(p.unitPrice);
    if (!canPrice) {
      if (p.unitPrice != null && unitPrice !== txn.unitPriceLocked) {
        throw ApiError.forbidden('Harga terkunci — hanya pemegang akses Harga Master yang boleh mengubah harga.', { unitPriceLocked: txn.unitPriceLocked });
      }
      unitPrice = txn.unitPriceLocked;   // pin to the stored price, whatever the client sent
    }
    if (qty <= 0) throw ApiError.badRequest('Jumlah galon harus lebih dari 0.');
    if (unitPrice <= 0) throw ApiError.badRequest('Harga harus lebih dari 0.');
    const newAmount = qty * unitPrice;
    if (overCeiling(newAmount) || overCeiling(unitPrice)) throw ApiError.badRequest(ceilingMsg, { newAmount });
    return { fields: { qty, unitPrice, gallonOut, gallonIn }, newAmount };
  }
  // Amount-only: a pelunasan (payment) or an opening/carry-over bon (lump receivable typed directly).
  const amount = int(p.amount);
  if (amount <= 0) throw ApiError.badRequest('Jumlah harus lebih dari 0.');
  if (overCeiling(amount)) throw ApiError.badRequest(ceilingMsg, { amount });
  if (txn.method === 'pelunasan') {
    // Can't pay more than owed: customerBonBalance already reflects THIS pelunasan's reduction, so the
    // max new payment = current outstanding bon + this row's current amount (its effect added back).
    const maxPay = (await customerBonBalance(txn.customerId)) + txn.amount;
    if (amount > maxPay) throw ApiError.badRequest(`Pembayaran (${amount}) melebihi sisa bon (${maxPay}).`, { maxPay });
  }
  return { fields: { amount }, newAmount: amount };
}

// Enrich a request row into the client shape: current vs requested inputs + the recomputed delta.
async function changeRequestClient(req, txnMaybe) {
  const txn = txnMaybe || await prisma.distTransaction.findUnique({ where: { id: req.transactionId }, include: { customer: { select: { name: true, code: true } } } });
  let payload = {}; try { payload = JSON.parse(req.payload || '{}'); } catch (e) {}
  const sale = txn && isGallonSale(txn);
  const curG = (txn && sale) ? await currentGallonsOf(txn.id) : { gallonOut: 0, gallonIn: 0 };
  const current = txn ? { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, ...curG } : null;
  let requested = null, newAmount = null;
  if (req.kind === 'correction' && txn) {
    if (sale) { requested = { qty: payload.qty, unitPrice: payload.unitPrice, gallonOut: payload.gallonOut, gallonIn: payload.gallonIn }; newAmount = (payload.qty || 0) * (payload.unitPrice || 0); }
    else { requested = { amount: payload.amount }; newAmount = payload.amount; }
  }
  const delta = req.kind === 'void' ? (txn ? -txn.amount : 0) : (newAmount != null && txn ? newAmount - txn.amount : 0);
  return {
    id: req.id, transactionId: req.transactionId, fleetId: req.fleetId, kind: req.kind, status: req.status,
    method: txn ? txn.method : null, reason: req.reason,
    customerName: txn && txn.customer ? txn.customer.name : '', customerCode: txn && txn.customer ? txn.customer.code : '',
    txnRef: shortRefServer(req.transactionId), txnDate: txn ? txn.txnDate : null,
    current, requested, newAmount, delta,
    requestedBy: req.requestedByName ? { name: req.requestedByName, role: req.requestedByRole || null } : null,
    requestedById: req.requestedById || null,
    decidedBy: req.decidedByName ? { name: req.decidedByName, role: req.decidedByRole || null } : null,
    decisionNote: req.decisionNote || '', decidedAt: req.decidedAt ? new Date(req.decidedAt).getTime() : null,
    createdAt: req.createdAt ? new Date(req.createdAt).getTime() : null,
  };
}

// Submit a correction/void request (does NOT change the transaction). One pending request per txn.
async function requestChange(txnId, kind, body, actor) {
  if (kind !== 'correction' && kind !== 'void') throw ApiError.badRequest('Jenis pengajuan tidak dikenal.');
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId }, include: { customer: { select: { name: true, code: true } } } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!fleetAllows(actor, txn.fleetId)) throw ApiError.notFound('Transaction not found');   // out of scope
  if (txn.status === 'void') throw ApiError.badRequest('Transaksi ini sudah dibatalkan.');
  if (txn.legacy) throw ApiError.badRequest('Baris arsip tidak masuk hitungan — tak perlu dikoreksi/dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan wajib diisi.');
  const already = await prisma.distChangeRequest.findFirst({ where: { transactionId: txnId, status: 'pending' } });
  if (already) throw ApiError.badRequest('Sudah ada pengajuan menunggu persetujuan untuk transaksi ini.');
  const snap = await actorSnap(actor);   // resolved from the DB → carries the REQUESTER's price cap
  let payloadObj = {};
  // Validate now (fail fast) with the requester's caps: a staff member without distribusiHargaMaster
  // cannot submit a price change at all — the request never even reaches an approver.
  if (kind === 'correction') payloadObj = (await normalizeCorrection(txn, body.payload || body, { canPrice: snap.canPrice })).fields;
  const req = await prisma.distChangeRequest.create({ data: {
    transactionId: txnId, fleetId: txn.fleetId || '', kind, status: 'pending',
    payload: JSON.stringify(payloadObj), reason,
    requestedById: snap.actorId, requestedByName: snap.actorName, requestedByRole: snap.actorRole,
  } });
  const what = kind === 'void' ? 'pembatalan' : 'koreksi ' + JSON.stringify(payloadObj);
  await logAudit('koreksi', `Pengajuan ${kind === 'void' ? 'pembatalan' : 'koreksi'}: ${txn.customer ? txn.customer.name : ''}`, `${shortRefServer(txn.id)} · ${what} · ${reason}`, snap, txn.fleetId);
  return changeRequestClient(req, txn);
}

// List requests in the actor's fleet scope (approver inbox + audit of decided ones).
async function listChangeRequests(user, query) {
  const q = query || {};
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.status === 'pending' || q.status === 'approved' || q.status === 'rejected') where.status = q.status;
  const rows = await prisma.distChangeRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 200 });
  const data = [];
  for (const r of rows) data.push(await changeRequestClient(r));
  return { data };
}

// Approve (apply atomically) or reject (close, note required) a pending request.
async function decideChangeRequest(id, decision, body, actor) {
  const req = await prisma.distChangeRequest.findUnique({ where: { id } });
  if (!req) throw ApiError.notFound('Pengajuan tidak ditemukan.');
  if (!fleetAllows(actor, req.fleetId)) throw ApiError.notFound('Pengajuan tidak ditemukan.');   // out of scope
  if (req.status !== 'pending') throw ApiError.badRequest('Pengajuan ini sudah diputuskan.');
  // A requester can NEVER approve their own request — even holding distribusiApprove.
  if (decision === 'approve' && req.requestedById && actor && req.requestedById === actor.id) {
    throw ApiError.forbidden('Anda tidak boleh menyetujui pengajuan Anda sendiri.');
  }
  const snap = await actorSnap(actor);
  const txn = await prisma.distTransaction.findUnique({ where: { id: req.transactionId }, include: { customer: { select: { name: true } } } });
  if (!txn) throw ApiError.notFound('Transaction not found');

  if (decision === 'reject') {
    const note = String(body.note || '').trim();
    if (!note) throw ApiError.badRequest('Alasan penolakan wajib diisi.');
    const updated = await prisma.distChangeRequest.update({ where: { id }, data: {
      status: 'rejected', decidedById: snap.actorId, decidedByName: snap.actorName, decidedByRole: snap.actorRole, decisionNote: note, decidedAt: new Date(),
    } });
    await logAudit('koreksi', `Tolak ${req.kind === 'void' ? 'pembatalan' : 'koreksi'}: ${txn.customer ? txn.customer.name : ''}`, `${shortRefServer(txn.id)} · ${note}`, snap, req.fleetId);
    return changeRequestClient(updated, txn);   // nothing on the txn changed
  }

  // approve → apply. The txn must still be applyable.
  if (txn.status === 'void') throw ApiError.badRequest('Transaksi sudah dibatalkan.');
  if (txn.legacy) throw ApiError.badRequest('Baris arsip tidak bisa diubah.');
  let payload = {}; try { payload = JSON.parse(req.payload || '{}'); } catch (e) {}
  // A request that CHANGES THE PRICE can only be applied by an approver who also holds
  // distribusiHargaMaster. Approving is what actually rewrites the price, so the same field-level
  // gate applies at this door too. The request is NOT dropped — it stays pending for an approver who
  // does hold the cap; any approver may still REJECT it (rejecting changes nothing).
  const priceChanged = req.kind === 'correction' && isGallonSale(txn) && payload.unitPrice != null && int(payload.unitPrice) !== txn.unitPriceLocked;
  if (priceChanged && !snap.canPrice) {
    throw ApiError.forbidden('Pengajuan ini mengubah harga — hanya penyetuju dengan akses Harga Master yang boleh menyetujuinya. Anda tetap bisa menolaknya.', { unitPriceLocked: txn.unitPriceLocked, requestedUnitPrice: int(payload.unitPrice) });
  }
  // Re-validate + gather old values BEFORE the write transaction (avoids nested-client reads).
  let norm = null, oldVals = null, newVals = null;
  if (req.kind === 'correction') {
    norm = await normalizeCorrection(txn, payload, { canPrice: snap.canPrice });   // re-validate against the CURRENT txn state
    const oldG = isGallonSale(txn) ? await currentGallonsOf(txn.id) : {};
    oldVals = { qty: txn.qty, unitPrice: txn.unitPriceLocked, amount: txn.amount, ...oldG };
    newVals = { ...norm.fields, amount: norm.newAmount };
  }
  await prisma.$transaction(async (db) => {
    if (req.kind === 'void') {
      await db.gallonMovement.updateMany({ where: { transactionId: txn.id, active: true }, data: { active: false } });
      await db.distTransaction.update({ where: { id: txn.id }, data: {
        status: 'void', voidedById: snap.actorId, voidedByName: snap.actorName, voidedByRole: snap.actorRole, voidedAt: new Date(), voidReason: req.reason,
      } });
    } else if (isGallonSale(txn)) {
      // Rewrite this sale's gallon movements to the corrected out/in (append-only: deactivate + add).
      await db.gallonMovement.updateMany({ where: { transactionId: txn.id, active: true, type: { in: ['delivery_out', 'return_in'] } }, data: { active: false } });
      const base = { customerId: txn.customerId, transactionId: txn.id, fleetId: txn.fleetId || '', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, active: true };
      if (norm.fields.gallonOut > 0) await db.gallonMovement.create({ data: { ...base, type: 'delivery_out', qty: norm.fields.gallonOut, note: 'Galon keluar (koreksi)' } });
      if (norm.fields.gallonIn > 0) await db.gallonMovement.create({ data: { ...base, type: 'return_in', qty: norm.fields.gallonIn, note: 'Galon masuk (koreksi)' } });
      await db.distTransaction.update({ where: { id: txn.id }, data: { qty: norm.fields.qty, unitPriceLocked: norm.fields.unitPrice, amount: norm.newAmount } });
    } else {
      await db.distTransaction.update({ where: { id: txn.id }, data: { amount: norm.newAmount } });
    }
    if (req.kind === 'correction') {
      // Record the applied correction (kind 'manual' → the "Dikoreksi" badge + the old→new trail).
      await db.correction.create({ data: { transactionId: txn.id, reason: req.reason, kind: 'manual',
        oldValue: JSON.stringify(oldVals), newValue: JSON.stringify(newVals),
        actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, byStaff: false } });
    }
    await db.distChangeRequest.update({ where: { id }, data: {
      status: 'approved', decidedById: snap.actorId, decidedByName: snap.actorName, decidedByRole: snap.actorRole, decidedAt: new Date(),
    } });
  });
  // A price change is called out explicitly (old → new) so the audit reads without decoding the JSON.
  const priceLine = (req.kind === 'correction' && oldVals && newVals && newVals.unitPrice != null && oldVals.unitPrice !== newVals.unitPrice)
    ? ` · HARGA ${oldVals.unitPrice} → ${newVals.unitPrice} (oleh pemegang Harga Master)` : '';
  const detail = req.kind === 'void' ? `pembatalan diterapkan` : `koreksi diterapkan → ${JSON.stringify(newVals)}${priceLine}`;
  await logAudit(req.kind === 'void' ? 'batal' : 'koreksi', `Setujui ${req.kind === 'void' ? 'pembatalan' : 'koreksi'}: ${txn.customer ? txn.customer.name : ''}`, `${shortRefServer(txn.id)} · ${detail} · ${req.reason} · oleh ${snap.actorName}`, snap, req.fleetId);
  const fresh = await prisma.distChangeRequest.findUnique({ where: { id } });
  const out = await changeRequestClient(fresh);
  return { ...out, sisaBon: await customerBonBalance(txn.customerId), gallonsHeld: await gallonBalanceOf(txn.customerId) };
}

// ── PELUNASAN TIDAK DITERIMA (payment not received) ──────────────────────────────
// The customer really DID pay their bon, but the money never reached the company — a staff member
// took it. This is an accounting fact with two different, deliberately asymmetric consequences:
//   • CUSTOMER SIDE — they paid, so their debt MUST go down. The row is created as an ordinary
//     `pelunasan` with bonCounted:true, so sisa bon drops and "Cetak Riwayat Transaksi" prints it as
//     a received payment. Nothing about the internal problem appears anywhere they can see: the
//     reason lives in `lossReason` (internal-only), NEVER in `note` (which prints). They must never
//     be asked to pay twice.
//   • COMPANY SIDE — no cash arrived, so `paymentNotReceived:true` keeps it out of every money-in /
//     cash figure (dashboard uang masuk + tunai + per-fleet net cash, cash integration, delivery
//     report). The amount is instead a recorded LOSS against the named responsible staff, visible
//     only to distribusiBonAdjust holders via lossReport().
// Immutable like every other transaction: a mistake is corrected by voiding (recorded), never by a
// silent delete or edit.
async function createPaymentNotReceived(body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer) throw ApiError.badRequest('customerId does not reference an existing customer');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.forbidden('Pelanggan di luar akses armada Anda.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Jumlah harus lebih dari 0.');
  if (overCeiling(amount)) throw ApiError.badRequest(ceilingMsg, { amount });
  const sisaBon = await customerBonBalance(customer.id);
  if (sisaBon <= 0) throw ApiError.badRequest('Pelanggan ini tidak punya sisa bon.');
  if (amount > sisaBon) throw ApiError.badRequest(`Jumlah (${amount}) melebihi sisa bon (${sisaBon}).`, { sisaBon });
  const lossReason = String(body.lossReason || body.reason || '').trim();
  if (!lossReason) throw ApiError.badRequest('Alasan / keterangan wajib diisi.');
  // Responsible staff: a system user id when one is picked, otherwise a typed name (field helpers
  // are not always users). One of the two is required — a loss with nobody attached is not reportable.
  let responsibleUserId = body.responsibleUserId ? String(body.responsibleUserId) : null;
  let responsibleName = String(body.responsibleName || '').trim();
  if (responsibleUserId) {
    const u = await prisma.user.findUnique({ where: { id: responsibleUserId }, select: { id: true, name: true, username: true } });
    if (!u) throw ApiError.badRequest('Staf yang bertanggung jawab tidak ditemukan.');
    responsibleName = responsibleName || u.name || u.username;
  }
  if (!responsibleName) throw ApiError.badRequest('Staf yang bertanggung jawab wajib dipilih.');
  const snap = await actorSnap(actor);
  const txn = await prisma.distTransaction.create({ data: {
    customerId: customer.id, fleetId: customer.armada || '', qty: 0, unitPriceLocked: 0, amount,
    method: 'pelunasan', bonCounted: true, paymentNotReceived: true,
    // `note` PRINTS on the customer statement → keep it clean. The reason goes to lossReason.
    note: (body.note || '').trim(),
    responsibleUserId, responsibleName: responsibleName.slice(0, 120), lossReason: lossReason.slice(0, 500),
    lossPhotoId: body.lossPhotoId ? String(body.lossPhotoId).slice(0, 60) : null,
    txnDate: body.txnDate, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
  } });
  await logAudit('koreksi', `Pelunasan tidak diterima: ${customer.name}`,
    `${shortRefServer(txn.id)} · ${amount} · penanggung jawab ${responsibleName} · ${lossReason}`, snap, customer.armada || '');
  return { ...txn, sisaBon: Math.max(0, sisaBon - amount), gallonsHeld: await gallonBalanceOf(customer.id), isPayment: true };
}

// Internal loss report — "Kerugian / Uang Tidak Diterima". Cap-gated (distribusiBonAdjust) and
// NEVER rendered on anything customer-facing. Lists every adjustment with its evidence + who
// recorded it, plus totals per responsible staff and for the period.
async function lossReport(user, query) {
  const q = query || {};
  const { from, to, period } = dayRange(q, todayISO());
  const rows = await resilientFindMany(prisma.distTransaction, {
    where: { paymentNotReceived: true, txnDate: { gte: from, lte: to }, ...fleetWhere(user, 'fleetId', q.fleet) },
    include: { customer: { select: { name: true, code: true } } }, orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
  }, 'loss-report');
  const items = rows.map((r) => ({
    id: r.id, txnDate: r.txnDate, amount: r.amount, status: r.status, voided: r.status === 'void',
    customerId: r.customerId, customerName: r.customer ? r.customer.name : '', customerCode: r.customer ? r.customer.code : '',
    responsibleUserId: r.responsibleUserId || null, responsibleName: r.responsibleName || '',
    lossReason: r.lossReason || '', lossPhotoId: r.lossPhotoId || null, fleetId: r.fleetId || '',
    recordedByName: r.actorName || '', recordedByRole: r.actorRole || '', createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
    voidReason: r.voidReason || '', voidedByName: r.voidedByName || '',
  }));
  // Voided adjustments stay listed (append-only, nothing is hidden) but never count toward totals.
  const live = items.filter((x) => !x.voided);
  const byStaff = {};
  live.forEach((x) => {
    const k = x.responsibleUserId || ('name:' + x.responsibleName);
    const s = byStaff[k] || (byStaff[k] = { key: k, responsibleUserId: x.responsibleUserId, responsibleName: x.responsibleName, count: 0, total: 0 });
    s.count += 1; s.total += x.amount;
  });
  return {
    from, to, period,
    items, count: live.length, total: live.reduce((a, x) => a + x.amount, 0),
    byStaff: Object.values(byStaff).sort((a, b) => b.total - a.total),
  };
}

// ── ARCHIVE TOGGLE — flip a row between ACTIVE and ARCHIVE (legacy). Cap: distribusiLegacyImport
// (the archive-management capability). Because every money aggregate (KPIs, gallons sold, sisa bon,
// receivables, cash integration) is derived DIRECTLY from the transaction rows and filters on the
// `legacy` flag, flipping it recomputes all of those automatically — no double-count, no orphan.
// The only side channel is the gallon STOCK ledger (GallonMovement, the single source of truth for
// stock):
//   • active → archive: reverse this row's gallon movements (append-only → deactivate), so an
//     archived row no longer moves stock — exactly like a void.
//   • archive → active: RESTORE this row's own movements if it ever had any. A legacy-IMPORTED row
//     never recorded gallon out/in (the importer writes none), so there is nothing to restore and no
//     phantom stock is fabricated — the row starts counting for money only. A row that was a REAL
//     sale, archived, then reactivated gets its original movements back.
// A reason is required and one immutable audit entry (who/when/from→to/reason) is written.
async function setTransactionArchive(txnId, targetLegacy, body, actor) {
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId }, include: { customer: { select: { name: true } } } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!fleetAllows(actor, txn.fleetId)) throw ApiError.notFound('Transaction not found');   // out of fleet scope
  if (txn.status === 'void') throw ApiError.badRequest('Transaksi yang dibatalkan tidak bisa diubah arsip/aktif.');
  const target = !!targetLegacy;
  if (!!txn.legacy === target) throw ApiError.badRequest(target ? 'Transaksi ini sudah arsip.' : 'Transaksi ini sudah aktif.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan wajib diisi.');
  // Receivable choice: archiving may KEEP counting toward sisa bon (bonCounted=true, e.g. a real
  // historical debt) or DROP it (bonCounted=false, e.g. a mistaken row). Reactivating always counts.
  const bonCounted = target ? !!body.bonCounted : true;
  const snap = await actorSnap(actor);
  const updated = await prisma.$transaction(async (tx) => {
    if (target) await tx.gallonMovement.updateMany({ where: { transactionId: txnId, active: true }, data: { active: false } });   // archive → reverse stock
    else await tx.gallonMovement.updateMany({ where: { transactionId: txnId, active: false }, data: { active: true } });          // reactivate own movements (none for imports)
    return tx.distTransaction.update({ where: { id: txnId }, data: { legacy: target, bonCounted } });
  });
  const bonNote = (txn.method === 'bon' || txn.method === 'pelunasan') ? ` · sisa bon ${bonCounted ? 'dihitung' : 'tidak dihitung'}` : '';
  await logAudit('impor', `${target ? 'Jadikan arsip' : 'Jadikan aktif'}: ${txn.customer ? txn.customer.name : ''}`,
    `${shortRefServer(txn.id)} · ${txn.method} ${txn.amount} · ${txn.legacy ? 'arsip' : 'aktif'} → ${target ? 'arsip' : 'aktif'}${bonNote} · ${reason}`, snap, txn.fleetId);
  return { ...updated, legacy: target, bonCounted, sisaBon: await customerBonBalance(txn.customerId), gallonsHeld: await gallonBalanceOf(txn.customerId) };
}

// ── HARD DELETE (permanent) — OWNER-ONLY last resort (cap: distribusiHardDelete) ───────────────
// Safeguards (ALL required): typed confirmation (the txn ref e.g. "ZSMNG9" or the word "HAPUS"),
// the caller's own password re-entered, and a mandatory reason. The audit entry is written FIRST —
// to the immutable audit log, which is NOT deleted — so a permanent trace of WHAT was deleted (ref,
// customer, amount, who, when, reason) always survives even though the transaction row itself is
// gone. Downstream effects (gallon movements + corrections) are removed with the row.
async function hardDeleteTransaction(txnId, body, actor) {
  const txn = await prisma.distTransaction.findUnique({ where: { id: txnId }, include: { customer: { select: { name: true } } } });
  if (!txn) throw ApiError.notFound('Transaction not found');
  if (!fleetAllows(actor, txn.fleetId)) throw ApiError.notFound('Transaction not found');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan wajib diisi.');
  // Typed confirmation: the ref (last-6 upper) OR the word HAPUS.
  const typed = String(body.confirm || '').trim().toUpperCase();
  if (typed !== shortRefServer(txn.id) && typed !== 'HAPUS') throw ApiError.badRequest(`Ketik ref (${shortRefServer(txn.id)}) atau HAPUS untuk konfirmasi.`);
  // Re-enter the caller's OWN password (defence against a mis-click / borrowed session).
  const me = await prisma.user.findUnique({ where: { id: (actor && actor.id) || '' } });
  if (!me) throw ApiError.unauthorized('Sesi tidak valid.');
  const okPw = await bcrypt.compare(String(body.password || ''), me.passwordHash);
  if (!okPw) throw ApiError.unauthorized('Password salah.');
  const snap = await actorSnap(actor);
  // AUDIT FIRST — the row is about to disappear; the trace must not.
  await logAudit('hapus', `Hapus permanen transaksi: ${txn.customer ? txn.customer.name : ''}`, `${shortRefServer(txn.id)} · ${txn.method} ${txn.amount} · ${reason} · tidak bisa dikembalikan`, snap, txn.fleetId);
  await prisma.$transaction([
    prisma.gallonMovement.deleteMany({ where: { transactionId: txnId } }),
    prisma.correction.deleteMany({ where: { transactionId: txnId } }),
    prisma.distTransaction.delete({ where: { id: txnId } }),
  ]);
  return { deleted: true, id: txnId, ref: shortRefServer(txnId), sisaBon: await customerBonBalance(txn.customerId), gallonsHeld: await gallonBalanceOf(txn.customerId) };
}

// ── Invoices / Notas ── (documents; NEVER mutate transactions)
function invoiceClient(inv, customer) {
  let items = []; try { items = JSON.parse(inv.items); } catch (e) {}
  return {
    id: inv.id, number: inv.number, customerId: inv.customerId, fleetId: inv.fleetId,
    issueDate: inv.issueDate, dueDate: inv.dueDate, items, total: inv.total, sisaBon: inv.sisaBon, note: inv.note,
    createdByName: inv.createdByName, createdByRole: inv.createdByRole, createdAt: inv.createdAt ? new Date(inv.createdAt).getTime() : null,
    customer: customer ? { id: customer.id, code: customer.code || '', name: customer.name, phone: customer.phone, type: customer.type, armada: customer.armada || '' } : null,
  };
}
// Create an invoice from selected transactions (or a scope). Snapshots items + totals.
// scope: 'unpaidBon' (default, all bon sales) | 'period' (dateFrom..dateTo sales) | 'selected'
// (explicit transactionIds). Only SALES (lunas/bon) are billable — never pelunasan/payments.
async function createInvoice(customerId, body, actor) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, customer.armada)) throw ApiError.notFound('Customer not found');
  const where = { customerId, ...LIVE_TXN, method: { in: ['lunas', 'bon'] } };   // legacy archive rows are never billable
  const scope = body.scope || 'unpaidBon';
  if (scope === 'period') { where.txnDate = {}; if (body.dateFrom) where.txnDate.gte = body.dateFrom; if (body.dateTo) where.txnDate.lte = body.dateTo; }
  let txns = await prisma.distTransaction.findMany({ where, orderBy: [{ txnDate: 'asc' }, { createdAt: 'asc' }], include: { corrections: true } });
  if (Array.isArray(body.transactionIds) && body.transactionIds.length) {
    const set = new Set(body.transactionIds);
    txns = txns.filter((t) => set.has(t.id));
  } else if (scope === 'unpaidBon') {
    txns = txns.filter((t) => t.method === 'bon');   // "outstanding bon" bill = the bon sales
  }
  if (!txns.length) throw ApiError.badRequest('Tidak ada transaksi untuk ditagih pada pilihan ini.');
  const items = txns.map((t) => { const amt = t.amount + priceDelta(t.corrections); return { txnId: t.id, date: t.txnDate, qty: t.qty, unitPrice: t.unitPriceLocked, amount: amt, method: t.method }; });
  const total = items.reduce((s, it) => s + it.amount, 0);
  const sisaBon = await customerBonBalance(customerId);
  const issueDate = todayISO();
  const prefix = 'INV-' + issueDate.replace(/-/g, '') + '-';
  const cnt = await prisma.distInvoice.count({ where: { number: { startsWith: prefix } } });
  const number = prefix + String(cnt + 1).padStart(4, '0');
  const snap = await actorSnap(actor);
  const inv = await prisma.distInvoice.create({ data: {
    number, customerId, fleetId: customer.armada || '', issueDate, dueDate: (body.dueDate || '').trim(),
    items: JSON.stringify(items), total, sisaBon, note: (body.note || '').trim(),
    createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole,
  } });
  await logAudit('pelanggan', `Invoice ${number}: ${customer.name}`, `${items.length} item · total ${total} · jatuh tempo ${body.dueDate || '-'}`, snap, customer.armada);
  return invoiceClient(inv, customer);
}
async function listInvoices(customerId, user) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(user, customer.armada)) throw ApiError.notFound('Customer not found');
  const rows = await resilientFindMany(prisma.distInvoice, { where: { customerId }, orderBy: { createdAt: 'desc' } }, 'invoices');
  return { data: rows.map((r) => invoiceClient(r, customer)) };
}
async function getInvoice(id, user) {
  const inv = await prisma.distInvoice.findUnique({ where: { id } });
  if (!inv) throw ApiError.notFound('Invoice not found');
  const customer = await prisma.customer.findUnique({ where: { id: inv.customerId } });
  if (customer && !fleetAllows(user, customer.armada)) throw ApiError.notFound('Invoice not found');
  return invoiceClient(inv, customer);
}

// ── Audit + dashboard ──
async function listAudit(q, user) {
  const where = { ...fleetWhere(user, 'fleetId', q && q.fleet) };
  if (q && q.kind) where.kind = q.kind;
  const rows = await prisma.distAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: (q && +q.limit) || 500 });
  return { data: rows };
}

const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Evaluate each customer's billing-reminder settings and return those that need billing
// today, with the reason(s), outstanding bon, gallons held, and since when. Fleet-scoped.
// Modes (any combination): dueDay (calendar day), weekly (weekday), overdueDays (aging of
// the oldest unpaid bon), gallonThreshold (gallons held), bonThreshold (sisa bon).
const DOW_CODE = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];   // JS getUTCDay() 0=Sun → code
async function billingReminders(user, qFleet, dateStr) {
  const today = dateStr || todayISO();
  const customers = await prisma.customer.findMany({ where: fleetWhere(user, 'armada', qFleet) });
  const active = customers.filter((c) => { try { const r = JSON.parse(c.reminder || ''); return r && r.enabled; } catch (e) { return false; } });
  if (!active.length) return { data: [], date: today };
  const txns = await prisma.distTransaction.findMany({ where: { ...fleetWhere(user, 'fleetId', qFleet), ...BON_TXN }, select: { customerId: true, method: true, amount: true, txnDate: true, corrections: { select: { kind: true, deltaAmount: true, active: true } } } });   // receivable incl. legacy bon/pelunasan
  const agg = {};
  txns.forEach((t) => {
    const a = agg[t.customerId] || (agg[t.customerId] = { bon: 0, pel: 0, oldestBon: null });
    if (t.method === 'bon') { a.bon += t.amount + priceDelta(t.corrections); if (!a.oldestBon || t.txnDate < a.oldestBon) a.oldestBon = t.txnDate; }
    else if (t.method === 'pelunasan') a.pel += t.amount;
  });
  const held = await gallonBalances(user, qFleet);
  const dow = DOW_CODE[new Date(today + 'T00:00:00Z').getUTCDay()];
  const dom = +today.slice(8, 10);
  const out = [];
  active.forEach((c) => {
    let rem = {}; try { rem = JSON.parse(c.reminder); } catch (e) { return; }
    const a = agg[c.id] || { bon: 0, pel: 0, oldestBon: null };
    const sisaBon = Math.max(0, a.bon - a.pel);
    const gallons = held[c.id] || 0;
    const since = sisaBon > 0 ? a.oldestBon : null;
    const ageDays = since ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(since)) / 86400000)) : 0;
    const reasons = [];
    if (rem.bonThreshold > 0 && sisaBon >= rem.bonThreshold) reasons.push({ type: 'bon', value: sisaBon, threshold: rem.bonThreshold });
    if (rem.gallonThreshold > 0 && gallons >= rem.gallonThreshold) reasons.push({ type: 'gallon', value: gallons, threshold: rem.gallonThreshold });
    if (rem.overdueDays > 0 && sisaBon > 0 && ageDays >= rem.overdueDays) reasons.push({ type: 'overdue', days: ageDays, threshold: rem.overdueDays });
    if (rem.dueDay > 0 && dom === rem.dueDay && sisaBon > 0) reasons.push({ type: 'dueDay', day: rem.dueDay });
    if (rem.weekday && dow === rem.weekday && sisaBon > 0) reasons.push({ type: 'weekly', weekday: rem.weekday });
    if (reasons.length) out.push({ customerId: c.id, name: c.name, phone: c.phone || '', armada: c.armada || '', sisaBon, gallonsHeld: gallons, since, ageDays, reasons });
  });
  out.sort((a, b) => b.sisaBon - a.sisaBon);
  return { data: out, date: today };
}

// Everything the Distribusi dashboard needs in ONE call (NOT posted to AirRO cash —
// informational): today's KPIs, a 7-day stacked series (lunas vs bon), the most
// recent transactions (with a corrected flag), and the top customers in the window.
// Resolve the dashboard/report window [from,to] from a period request, and ENFORCE the history cap
// server-side: without `distribusiDashHistory` a user may ONLY see today — any other window is 403,
// so a normal user can't craft a request for last month. Returns { from, to, period, canHistory }.
function resolveDashWindow(user, query) {
  const q = query || {};
  const today = todayISO();
  const perms = resolvePerms(user.role, user.permissions);
  const canHistory = !!perms.distribusiDashHistory;
  let from = today, to = today, period = 'today';
  const p = q.period || (q.date ? 'range' : (q.dateFrom || q.dateTo ? 'range' : 'today'));
  if (q.date && !q.period && !q.dateFrom && !q.dateTo) { from = to = q.date; period = (q.date === today ? 'today' : 'range'); }
  else if (p === 'today') { from = to = today; period = 'today'; }
  else if (p === 'week') { from = addDays(today, -6); to = today; period = 'week'; }
  else if (p === 'month') { from = today.slice(0, 8) + '01'; to = today; period = 'month'; }
  else if (p === 'range') {
    from = q.dateFrom || q.date || today; to = q.dateTo || q.date || today; period = 'range';
    if (from > to) { const t = from; from = to; to = t; }
  }
  if (!(from === today && to === today) && !canHistory) {
    throw ApiError.forbidden('Perlu izin "Lihat Periode Sebelumnya" untuk melihat periode selain hari ini.');
  }
  return { from, to, period, canHistory };
}

async function dashboardSummary(user, query) {
  const q = query || {};
  const { from, to, period, canHistory } = resolveDashWindow(user, q);
  const qFleet = q.fleet;
  const fleetFilter = fleetWhere(user, 'fleetId', qFleet);
  const rows = await prisma.distTransaction.findMany({
    where: { txnDate: { gte: from, lte: to }, ...fleetFilter, ...LIVE_TXN },
    include: { customer: { select: { name: true, type: true } }, corrections: { select: { kind: true, deltaAmount: true, active: true } } },
    orderBy: { createdAt: 'desc' },
  });
  // Amounts follow the EFFECTIVE (adjusted) value so retroactive price changes are reflected.
  const effOf = (r) => r.amount + priceDelta(r.corrections);
  // Money-in splits into CASH vs TRANSFER. Delivery staff hand over CASH in the field, so this is
  // what a driver must physically deposit: a `lunas` sale is always cash, and a `pelunasan` (bon
  // settlement) is cash UNLESS it was paid by bank transfer — recorded as the trailing " · Transfer"
  // tag on the note at pay time (see createTransaction). Transfers land straight in the company
  // account and must NOT count toward the cash owed. Older/untagged pelunasan default to cash (safe).
  const isTransferPay = isTransferPayment;   // shared module helper (see top): pelunasan · Transfer
  // A "Pelunasan Tidak Diterima" row is a real payment for the CUSTOMER (it clears their bon) but no
  // money ever reached the company, so on the COMPANY side it contributes ZERO to every cash figure
  // below — money-in, the cash/transfer split, per-fleet reconciliation and the daily chart. It is
  // reported instead as a loss against the responsible staff (see lossReport).
  const moneyInOf = (r) => (noMoneyIn(r) ? 0 : r.method === 'lunas' ? effOf(r) : r.method === 'pelunasan' ? r.amount : 0);

  // ── PERIOD KPIs — all computed over the SELECTED window [from,to] (default = today), from the
  // SAME `rows` that power the chart, the recent list and the top-customers list, so the headline
  // numbers can never disagree with what is shown right below them. ──
  const byMethod = { lunas: 0, bon: 0, pelunasan: 0 };
  let periodQty = 0, periodIn = 0, periodInCash = 0, periodInTransfer = 0, amount = 0, todayCash = 0, todayTransfer = 0;
  const cashFleet = {};   // per-fleet CASH the driver should deposit (reconcile)
  rows.forEach((r) => {
    periodQty += r.qty;
    const e = effOf(r); amount += e;
    if (byMethod[r.method] != null && !noMoneyIn(r)) byMethod[r.method] += (r.method === 'pelunasan' ? r.amount : e);
    const inc = moneyInOf(r);
    if (!inc) return;
    periodIn += inc;
    const transfer = isTransferPay(r);
    if (transfer) { periodInTransfer += inc; todayTransfer += inc; } else { periodInCash += inc; todayCash += inc; }
    const f = r.fleetId || '';
    const slot = cashFleet[f] || (cashFleet[f] = { fleetId: f, cash: 0, transfer: 0 });
    if (transfer) slot.transfer += inc; else slot.cash += inc;
  });
  const uangMasuk = byMethod.lunas + byMethod.pelunasan;   // == todayCash + todayTransfer
  const piutang = byMethod.bon;
  // Field expenses paid in cash over the window reduce what the driver must physically deposit:
  //   net cash to deposit = cash money-in − field expenses. Per-fleet too, for reconciliation.
  const exp = await expensesForRange(user, from, to, qFleet);
  const todayExpense = exp.total;
  const todayNetCash = todayCash - todayExpense;
  const todayCashByFleet = Object.values(cashFleet).map((f) => {
    const e = exp.byFleet[f.fleetId] || 0;
    return { ...f, expense: e, netCash: f.cash - e };
  }).sort((a, b) => b.netCash - a.netCash);

  // ── RUNNING RECEIVABLES — outstanding bon across ALL time (fleet-scoped), floored at 0 per
  // customer, identical to the Customers screen's sisaBon. A live balance, not a window figure. ──
  const allTxns = await prisma.distTransaction.findMany({ where: { ...fleetFilter, ...BON_TXN }, select: { id: true, customerId: true, amount: true, method: true } });   // receivable incl. legacy bon/pelunasan
  const rcvDelta = await activePriceDeltas({});
  const bonByCust = {};
  allTxns.forEach((t) => { const c = bonByCust[t.customerId] || (bonByCust[t.customerId] = { bon: 0, pel: 0 }); if (t.method === 'bon') c.bon += t.amount + (rcvDelta[t.id] || 0); else if (t.method === 'pelunasan') c.pel += t.amount; });
  const receivable = Object.values(bonByCust).reduce((s, c) => s + Math.max(0, c.bon - c.pel), 0);

  // Daily stacked series over the window (cash bucket = lunas + pelunasan, vs bon). For "today" it
  // is a single bar; a longer period fills in each day. Capped so a huge custom range stays sane.
  const byDay = {};
  rows.forEach((r) => { if (noMoneyIn(r)) return; const s = byDay[r.txnDate] || (byDay[r.txnDate] = { lunas: 0, bon: 0 }); const e = effOf(r); if (r.method === 'bon') s.bon += e; else s.lunas += e; });
  const series = [];
  let cur = from, guard = 0;
  while (cur <= to && guard++ < 92) { const s = byDay[cur] || { lunas: 0, bon: 0 }; series.push({ date: cur, lunas: s.lunas, bon: s.bon }); cur = addDays(cur, 1); }

  // Most recent transactions across the window.
  const recent = rows.slice(0, 8).map((r) => { const adj = priceDelta(r.corrections); return {
    id: r.id, customerName: r.customer ? r.customer.name : '', customerType: r.customer ? r.customer.type : null,
    qty: r.qty, unitPriceLocked: r.unitPriceLocked, amount: r.amount, adjustAmount: adj, effectiveAmount: r.amount + adj, method: r.method, txnDate: r.txnDate,
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null, corrected: hasManualCorrection(r.corrections), adjusted: adj !== 0,
  }; });

  // Top customers by (effective) amount in the window.
  const byCust = {};
  rows.forEach((r) => { const k = r.customerId; if (!byCust[k]) byCust[k] = { id: k, name: r.customer ? r.customer.name : '', type: r.customer ? r.customer.type : null, qty: 0, amount: 0 }; byCust[k].qty += r.qty; byCust[k].amount += effOf(r); });
  const topCustomers = Object.values(byCust).sort((a, b) => b.amount - a.amount).slice(0, 5);

  const customers = await prisma.customer.count({ where: fleetWhere(user, 'armada', qFleet) });
  const reminders = (await billingReminders(user, qFleet, to)).data;   // "Perlu ditagih" list
  return {
    date: to, from, to, period, canHistory, periodDays: series.length,
    periodQty, periodIn,            // headline KPIs over the window (same source as chart/recent/top)
    periodInCash, periodInTransfer, // …split: cash driver deposits vs bank transfers (sum = periodIn)
    receivable,                     // all-time outstanding bon (running balance)
    count: rows.length, amount, byMethod, uangMasuk, piutang,   // window txns + money-in
    todayCash, todayTransfer, todayCashByFleet,   // money-in split + per-fleet cash to reconcile
    todayExpense, todayNetCash,   // field expenses in the window + net cash to deposit (cash − expenses)
    customers, last7: series, series, recent, topCustomers, reminders,
  };
}

// ── Gallon stock (loan/exchange) — the append-only ledger is the SINGLE source of
// truth. All numbers (customer balances, depot, total) are computed from it; nothing
// is stored loose. delivery_out moves a gallon depot→customer, return_in the reverse,
// purchase adds to the depot, correction is a signed adjustment (customer or depot).
const custEffect = (m) => (m.type === 'delivery_out' ? m.qty : m.type === 'return_in' ? -m.qty : (m.type === 'correction' && m.customerId) ? m.qty : 0);
// 'opening' is a depot baseline (owned + at depot, never at a customer). Its qty is a signed
// delta so an adjustment (nilai_baru − nilai_lama) is another append, never an overwrite.
// 'damage'/'loss' remove good gallons from the depot (broken/lost), qty positive → negative effect.
const totalEffect = (m) => {
  if (m.type === 'purchase' || m.type === 'opening') return m.qty;
  if (m.type === 'damage' || m.type === 'loss') return -Math.abs(m.qty);
  if (m.type === 'correction' && !m.customerId) return m.qty;
  return 0;
};
// A ledger row that REPRESENTS opening stock. The dedicated 'opening' type, PLUS legacy depot
// corrections whose note was tagged as opening/starting stock (entered via "Koreksi depot"
// before this feature existed). Recognising both keeps ONE source of truth: the Stok Awal card,
// the ledger tag, and the delta baseline all read the same rows.
const OPENING_NOTE = /stok\s*awal|saldo\s*awal|opening\s*stock/i;
// A gallon-reset correction is NOT opening stock even if the reason mentions "stok awal".
const isOpeningRow = (m) => m.type === 'opening' || (m.type === 'correction' && !m.customerId && OPENING_NOTE.test(m.note || '') && !/reset stok galon/i.test(m.note || ''));

// Per-customer held balance (fleet-scoped): Σ(delivery_out − return_in ± customer correction).
async function gallonBalances(user, qFleet) {
  const rows = await prisma.gallonMovement.findMany({ where: { active: true, NOT: { customerId: null }, ...fleetWhere(user, 'fleetId', qFleet) }, select: { customerId: true, type: true, qty: true } });
  const m = {}; rows.forEach((r) => { m[r.customerId] = (m[r.customerId] || 0) + custEffect(r); });
  return m;
}
async function gallonBalanceOf(customerId) {
  const rows = await prisma.gallonMovement.findMany({ where: { active: true, customerId }, select: { type: true, qty: true, customerId: true } });
  return rows.reduce((a, r) => a + custEffect(r), 0);
}
async function gallonStock(user, qFleet) {
  const rows = await prisma.gallonMovement.findMany({ where: { active: true, ...fleetWhere(user, 'fleetId', qFleet) }, select: { type: true, qty: true, customerId: true } });
  let totalOwned = 0, atCustomers = 0;
  rows.forEach((r) => { totalOwned += totalEffect(r); atCustomers += custEffect(r); });
  return { totalOwned, atCustomers, atDepot: totalOwned - atCustomers };
}
// Opening-stock rollup (fleet-scoped): the physical gallons owned at go-live, kept as its
// own movement type so it shows separately from purchases/deliveries and its provenance is
// clear. total = Σ opening deltas; first entry = when/who set it, last = when/who last tuned it.
async function openingInfo(user, qFleet) {
  // Pull the dedicated 'opening' rows AND depot corrections, then keep the ones that represent
  // opening stock — so a baseline set via the old depot-correction flow still counts here.
  const candidates = await prisma.gallonMovement.findMany({ where: { active: true, customerId: null, type: { in: ['opening', 'correction'] }, ...fleetWhere(user, 'fleetId', qFleet) }, orderBy: { createdAt: 'asc' } });
  const rows = candidates.filter(isOpeningRow);
  if (!rows.length) return { set: false, total: 0, adjustCount: 0 };
  const total = rows.reduce((a, r) => a + r.qty, 0);
  const first = rows[0], last = rows[rows.length - 1];
  return {
    set: true, total, adjustCount: rows.length - 1,
    setAt: first.createdAt ? new Date(first.createdAt).getTime() : null, setByName: first.actorName || null,
    lastAt: last.createdAt ? new Date(last.createdAt).getTime() : null, lastByName: last.actorName || null,
  };
}
// Set / adjust the opening gallon stock. Approach (b): never overwrites — records a single
// 'opening' movement whose qty is the DELTA (target − current), so the ledger stays
// append-only and every change is traceable. First call sets the baseline; later calls tune
// it by the difference. The stock number is always recomputed from the ledger (no loose value).
async function setOpeningStock(body, actor) {
  const target = Math.round(+body.qty);
  if (!Number.isFinite(target) || target < 0) throw ApiError.badRequest('Jumlah stok awal tidak valid.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan/catatan wajib diisi.');
  const chosen = (body.fleet && body.fleet !== 'all') ? body.fleet : '';
  const fleetId = resolveWriteFleet(actor, chosen);   // scoped staff forced to their fleet; else global depot ''
  // Baseline = every opening-representing row (dedicated 'opening' + legacy opening corrections),
  // so an adjustment nets against the real current value and never double-counts.
  const candidates = await prisma.gallonMovement.findMany({ where: { active: true, customerId: null, type: { in: ['opening', 'correction'] }, fleetId }, select: { type: true, qty: true, note: true, customerId: true } });
  const existing = candidates.filter(isOpeningRow);
  const current = existing.reduce((a, r) => a + r.qty, 0);
  const isFirst = existing.length === 0;
  const delta = target - current;
  if (delta === 0) throw ApiError.badRequest('Stok awal tidak berubah (nilai sama dengan saat ini).');
  const snap = await actorSnap(actor);
  const note = isFirst ? reason : `${reason} · penyesuaian ${current} → ${target}`;
  const mov = await prisma.gallonMovement.create({ data: { type: 'opening', qty: delta, fleetId, active: true, note, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } });
  await logAudit('koreksi', isFirst ? 'Set stok galon awal' : 'Penyesuaian stok galon awal',
    `${isFirst ? '' : current + ' → '}${target} galon (${delta >= 0 ? '+' : ''}${delta}) · ${reason}`, snap, fleetId);
  return { movement: mov, opening: { total: target, previous: current, delta, isFirst } };
}

// Report broken/lost GOOD gallons. Appends a 'damage' (pecah/rusak) or 'loss' (hilang)
// GallonMovement that REDUCES the good-gallon total (single source), stamped with who/when/
// why + optional evidence photo, and mirrored to the Distribusi audit log. Called by the
// Gudang module — good-gallon stock lives here so the reduction stays authoritative.
async function reportGallonDamage({ qty, kind, reason, fleetId, proof }, actor) {
  const n = Math.round(+qty || 0);
  if (n <= 0) throw ApiError.badRequest('Jumlah galon harus lebih dari 0.');
  const rsn = String(reason || '').trim();
  if (!rsn) throw ApiError.badRequest('Alasan wajib diisi.');
  const kk = ['pecah', 'rusak', 'hilang'].includes(kind) ? kind : 'rusak';
  const type = kk === 'hilang' ? 'loss' : 'damage';
  const snap = await actorSnap(actor);
  const fId = resolveWriteFleet(actor, (fleetId && fleetId !== 'all') ? fleetId : '');
  const mov = await prisma.gallonMovement.create({ data: {
    type, qty: n, fleetId: fId, active: true, note: `Galon ${kk}: ${rsn}`,
    proof: proof ? JSON.stringify(proof) : null, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
  } });
  await logAudit('koreksi', `Galon ${kk} (${type === 'loss' ? 'hilang' : 'rusak'})`, `${n} galon · ${rsn}`, snap, fId);
  const stock = await gallonStock(actor, undefined);
  return { movement: mov, kind: kk, type, qty: n, goodStock: stock.totalOwned };
}
// Public helper so sibling modules (Gudang) can append a Distribusi audit row using the same
// actor-snapshot + trail. Keeps sensitive cross-module events in one auditable place.
async function logDistAudit(kind, title, detail, actor, fleetId) {
  const snap = await actorSnap(actor);
  return logAudit(kind, title, detail, snap, fleetId || '');
}
// Everything the "Stok Galon" screen needs: stock cards, per-customer balances, ledger.
async function gallonSummary(user, qFleet) {
  const stock = await gallonStock(user, qFleet);
  const opening = await openingInfo(user, qFleet);
  const balMap = await gallonBalances(user, qFleet);
  const rows = await prisma.gallonMovement.findMany({ where: { active: true, ...fleetWhere(user, 'fleetId', qFleet) }, orderBy: { createdAt: 'desc' }, take: 300 });
  const ids = [...new Set([...Object.keys(balMap).filter((id) => balMap[id] !== 0), ...rows.map((r) => r.customerId).filter(Boolean)])];
  const custs = ids.length ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, armada: true } }) : [];
  const info = {}; custs.forEach((c) => { info[c.id] = c; });
  const balances = Object.keys(balMap).filter((id) => balMap[id] !== 0)
    .map((id) => ({ customerId: id, name: (info[id] && info[id].name) || '—', armada: (info[id] && info[id].armada) || '', held: balMap[id] }))
    .sort((a, b) => b.held - a.held);
  // Display a legacy opening correction under the 'opening' tag so the ledger matches the card.
  const movements = rows.map((r) => ({ id: r.id, type: isOpeningRow(r) ? 'opening' : r.type, qty: r.qty, customerId: r.customerId, customerName: r.customerId ? ((info[r.customerId] && info[r.customerId].name) || '—') : null, fleetId: r.fleetId, note: r.note, actorName: r.actorName, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null }));
  return { stock, opening, balances, movements };
}
// Record a delivery's gallon flow (called from createTransaction). out = full gallons
// delivered, in_ = empty gallons returned. Tied to the transaction + customer.
async function recordDelivery(txn, customer, out, in_, snap) {
  const base = { customerId: customer.id, transactionId: txn.id, fleetId: customer.armada || '', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName, active: true };
  if (out > 0) await prisma.gallonMovement.create({ data: { ...base, type: 'delivery_out', qty: out, note: 'Galon keluar' } });
  if (in_ > 0) await prisma.gallonMovement.create({ data: { ...base, type: 'return_in', qty: in_, note: 'Galon masuk' } });
}
// Append a stock correction (never overwrite). Signed qty; reason required; audited.
async function gallonCorrection(body, actor) {
  const qty = Math.round(+body.qty || 0);
  if (!qty) throw ApiError.badRequest('Jumlah koreksi tidak boleh 0.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan koreksi wajib diisi.');
  const customerId = body.customerId || null;
  let fleetId;
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) throw ApiError.badRequest('Pelanggan tidak ditemukan.');
    if (!fleetAllows(actor, c.armada)) throw ApiError.forbidden('Pelanggan di luar akses armada Anda.');
    fleetId = c.armada || '';
  } else {
    fleetId = resolveWriteFleet(actor, '');   // depot correction → global (or the scoped user's fleet)
  }
  const snap = await actorSnap(actor);
  const mov = await prisma.gallonMovement.create({ data: { type: 'correction', qty, customerId, fleetId, active: true, note: reason, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } });
  await logAudit('koreksi', `Koreksi stok galon (${customerId ? 'pelanggan' : 'depot'})`, `${qty > 0 ? '+' : ''}${qty} galon · ${reason}`, snap, fleetId);
  return mov;
}
// Mirror a cash-flow "Pembelian Galon" expense as a purchase movement. Replace-on-change:
// any prior purchase for this entry is deactivated first, so an edit/delete never dangles.
async function syncPurchaseMovement(entryId, qtyRaw, actor) {
  const qty = Math.max(0, Math.round(+qtyRaw || 0));
  await prisma.gallonMovement.updateMany({ where: { cashEntryId: entryId, type: 'purchase', active: true }, data: { active: false } });
  if (qty > 0) {
    const snap = await actorSnap(actor);
    const fleetId = resolveWriteFleet(actor, '');
    await prisma.gallonMovement.create({ data: { type: 'purchase', qty, cashEntryId: entryId, fleetId, active: true, note: 'Pembelian galon', actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } });
  }
}
async function retractPurchaseMovement(entryId) {
  await prisma.gallonMovement.updateMany({ where: { cashEntryId: entryId, type: 'purchase', active: true }, data: { active: false } });
}

// GM-only "Reset Jumlah Galon". Two modes, both fleet-scoped (all / one fleet):
//  (a) 'balanced' (recommended) — APPEND balancing corrections so the numbers become the target
//      (default 0) WITHOUT touching history: per-customer correction −balance (→ "at customers"
//      = 0) + one depot correction (target − totalOwned) so total → target and the derived depot
//      → target. The old ledger stays intact and traceable.
//  (b) 'purge' — DELETE every GallonMovement in scope (permanent). Requires confirm === 'RESET'.
// Everything numeric is recomputed from the ledger; one audit row records who/mode/scope/
// before→after/reason.
async function resetGallon(body, actor) {
  const mode = body.mode === 'purge' ? 'purge' : 'balanced';
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan wajib diisi.');
  const chosen = (body.fleet && body.fleet !== 'all') ? String(body.fleet) : '';
  const qFleet = chosen || undefined;
  if (chosen && !fleetAllows(actor, chosen)) throw ApiError.forbidden('Armada di luar akses Anda.');
  const snap = await actorSnap(actor);
  const scopeLabel = chosen || 'semua armada';
  const before = await gallonStock(actor, qFleet);

  if (mode === 'purge') {
    if (String(body.confirm) !== 'RESET') throw ApiError.badRequest('Ketik RESET untuk konfirmasi penghapusan permanen.');
    const del = await prisma.gallonMovement.deleteMany({ where: { ...fleetWhere(actor, 'fleetId', qFleet) } });
    await logAudit('koreksi', `Reset stok galon — HAPUS PERMANEN oleh ${snap.actorName}`,
      `cakupan ${scopeLabel} · ${del.count} baris ledger dihapus · total ${before.totalOwned}→0 · di pelanggan ${before.atCustomers}→0 · alasan: ${reason}`, snap, chosen);
    const after = await gallonStock(actor, qFleet);
    return { mode, scope: scopeLabel, before, after, deleted: del.count, reason };
  }

  // balanced
  const target = Math.max(0, Math.round(+body.target || 0));
  const balMap = await gallonBalances(actor, qFleet);
  const custIds = Object.keys(balMap).filter((id) => balMap[id] !== 0);
  const custs = custIds.length ? await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, armada: true, name: true } }) : [];
  const ops = [];
  let customersReset = 0;
  for (const c of custs) {
    if (!fleetAllows(actor, c.armada)) continue;   // out of the actor's scope
    const bal = balMap[c.id];
    if (!bal) continue;
    ops.push(prisma.gallonMovement.create({ data: { type: 'correction', qty: -bal, customerId: c.id, fleetId: c.armada || '', active: true, note: `Reset stok galon oleh ${snap.actorName}: saldo pelanggan → 0 · ${reason}`, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } }));
    customersReset++;
  }
  // depot correction sets TOTAL owned to target (the derived depot then follows, since
  // atDepot = totalOwned − atCustomers and customers are now 0).
  const depotDelta = target - before.totalOwned;
  if (depotDelta !== 0) {
    ops.push(prisma.gallonMovement.create({ data: { type: 'correction', qty: depotDelta, customerId: null, fleetId: resolveWriteFleet(actor, chosen), active: true, note: `Reset stok galon oleh ${snap.actorName}: total → ${target} · ${reason}`, actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName } }));
  }
  if (ops.length) await prisma.$transaction(ops);
  await logAudit('koreksi', `Reset stok galon (tercatat) oleh ${snap.actorName}`,
    `cakupan ${scopeLabel} · total ${before.totalOwned}→${target} · di pelanggan ${before.atCustomers}→0 · ${customersReset} pelanggan disetel · alasan: ${reason}`, snap, chosen);
  const after = await gallonStock(actor, qFleet);
  return { mode, scope: scopeLabel, target, before, after, customersReset, reason };
}

// ── Delivery board ──────────────────────────────────────────────────────────
// One stop per fleet per date: 'jadwal' rows generated (idempotent) from each
// customer's deliveryDays, plus 'tambahan' orders added by an admin.
const DOW = (date) => DAY_CODES[(new Date(date + 'T00:00').getDay() + 6) % 7];   // Mon=Sen … Sun=Min
function deliveryClient(r, sisaBon) {
  const c = r.customer || {};
  let days = []; try { days = c.deliveryDays ? JSON.parse(c.deliveryDays) : []; } catch (e) {}
  return {
    id: r.id, date: r.date, fleetId: r.fleetId, customerId: r.customerId, source: r.source, seq: r.seq,
    status: r.status, qty: r.qty, note: r.note || '', pendingReason: r.pendingReason || '', transactionId: r.transactionId || null,
    createdByName: r.createdByName || null, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
    customerName: c.name || '', customerCode: c.code || '', phone: c.phone || '', armada: c.armada || '', masterPrice: c.masterPrice || 0,
    deliveryDays: Array.isArray(days) ? days : [], sisaBon: sisaBon || 0,
    lat: c.lat != null ? c.lat : null, lng: c.lng != null ? c.lng : null, mapsLink: mapsLinkOf(c), hasLocation: !!mapsLinkOf(c),
    locationPhotoId: c.locationPhotoId || null,   // board shows a lazy "Foto lokasi" button when set
  };
}
async function bonMapFor(custIds) {
  const map = {};
  if (!custIds.length) return map;
  const txns = await prisma.distTransaction.findMany({ where: { customerId: { in: custIds }, ...BON_TXN }, select: { customerId: true, amount: true, method: true } });   // includes legacy bon/pelunasan
  txns.forEach((t) => { const b = map[t.customerId] || (map[t.customerId] = { bon: 0, pel: 0 }); if (t.method === 'bon') b.bon += t.amount; else if (t.method === 'pelunasan') b.pel += t.amount; });
  const out = {}; Object.keys(map).forEach((k) => { out[k] = Math.max(0, map[k].bon - map[k].pel); });
  return out;
}
async function deliveryBoard(user, date, qFleet) {
  const dow = DOW(date);
  // customers scheduled today AND within the user's fleet scope; a stop needs a fleet.
  const custs = await prisma.customer.findMany({ where: { ...fleetWhere(user, 'armada', qFleet), active: { not: false } } });
  const scheduled = custs.filter((c) => {
    let d = []; try { d = c.deliveryDays ? JSON.parse(c.deliveryDays) : []; } catch (e) {}
    return Array.isArray(d) && d.includes(dow) && (c.armada || '').trim();
  });
  // idempotent generation — one jadwal row per scheduled customer per day.
  for (const c of scheduled) {
    await prisma.delivery.upsert({
      where: { date_customerId_source: { date, customerId: c.id, source: 'jadwal' } },
      update: { fleetId: c.armada || '' },
      create: { date, customerId: c.id, source: 'jadwal', fleetId: c.armada || '', status: 'pending', seq: 0 },
    });
  }
  const rows = await resilientFindMany(prisma.delivery, {
    where: { date, ...fleetWhere(user, 'fleetId', qFleet) },
    include: { customer: true }, orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
  }, 'deliveries');
  const bon = await bonMapFor([...new Set(rows.map((r) => r.customerId))]);
  const cos = await prisma.deliveryCloseout.findMany({ where: { date, ...fleetWhere(user, 'fleetId', qFleet) } });
  return { data: rows.map((r) => deliveryClient(r, bon[r.customerId])), closeouts: cos.map(closeoutClient) };
}
function closeoutClient(c) {
  return { id: c.id, date: c.date, fleetId: c.fleetId, closedByName: c.closedByName || null, closedAt: c.closedAt ? new Date(c.closedAt).getTime() : null, generalNote: c.generalNote || '', delivered: c.delivered, pending: c.pending, cancelled: c.cancelled };
}
// Close the delivery day for (date, armada). Every stop still 'pending' must carry a
// reason (reasons[deliveryId]); those move to status 'ditunda' with the reason recorded
// (kept, never dropped). Writes an accountable DeliveryCloseout {who, when, counts}.
async function closeDay(user, body) {
  const date = body.date;
  const fleetId = resolveWriteFleet(user, body.fleet);   // scoped → their fleet; full-access must pass one
  if (!fleetId) throw ApiError.badRequest('Pilih armada yang ditutup.');
  const stops = await prisma.delivery.findMany({ where: { date, fleetId } });
  const reasons = (body.reasons && typeof body.reasons === 'object') ? body.reasons : {};
  const pending = stops.filter((s) => s.status === 'pending');
  const missing = pending.filter((s) => !String(reasons[s.id] || '').trim());
  if (missing.length) throw ApiError.badRequest('Isi alasan untuk setiap pengiriman yang belum tuntas.');
  const snap = await actorSnap(user);
  for (const s of pending) await prisma.delivery.update({ where: { id: s.id }, data: { status: 'ditunda', pendingReason: String(reasons[s.id]).slice(0, 300) } });
  const delivered = stops.filter((s) => s.status === 'terkirim').length;
  const cancelled = stops.filter((s) => s.status === 'batal').length;
  const pendingCount = pending.length;   // now 'ditunda'
  const co = await prisma.deliveryCloseout.upsert({
    where: { date_fleetId: { date, fleetId } },
    update: { closedById: snap.actorId, closedByName: snap.actorName, closedAt: new Date(), generalNote: String(body.generalNote || '').slice(0, 500), delivered, pending: pendingCount, cancelled },
    create: { date, fleetId, closedById: snap.actorId, closedByName: snap.actorName, generalNote: String(body.generalNote || '').slice(0, 500), delivered, pending: pendingCount, cancelled },
  });
  const reasonList = pending.map((s) => ({ customerId: s.customerId, reason: String(reasons[s.id]).slice(0, 300) }));
  await logAudit('pengiriman', `Tutup pengiriman: ${fleetId}`, `Tanggal ${date} · terkirim ${delivered}, belum ${pendingCount}, batal ${cancelled}`, snap, fleetId);
  return { closeout: closeoutClient(co), fleetId, pending: pendingCount, reasons: reasonList };
}
// Admin report: closeouts within the user's scope (optionally by date).
async function listCloseouts(user, query) {
  const q = query || {};
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.date) where.date = q.date;
  const rows = await prisma.deliveryCloseout.findMany({ where, orderBy: { closedAt: 'desc' }, take: 500 });
  return { data: rows.map(closeoutClient) };
}
// ── Delivery runs (rit) — per-trip gallon out/in + reconciliation ─────────────
// The gallon STOCK is still driven by the per-customer delivery_out/return_in movements
// (single source). A run is a TRUCK-level control layer: it records what was loaded and what
// came back, then reconciles against what was actually sold — surfacing any shortfall (theft/
// breakage) the per-customer ledger can't see. No extra stock movements → no second number.
const runMs = (d) => (d ? new Date(d).getTime() : null);
// The three correctable run figures and their base column + human label (audit / UI).
const RUN_FIELDS = { out: { col: 'gallonsOut', label: 'muat' }, full: { col: 'gallonsFullReturned', label: 'isi kembali' }, empty: { col: 'gallonsEmptyReturned', label: 'kosong' } };
// EFFECTIVE run figures = base column + Σ active correction deltas for that field. Append-only:
// the stored gallonsOut/…Returned columns are never overwritten; a correction is a signed row.
function effectiveRun(r, corrs) {
  const eff = { out: r.gallonsOut, full: r.gallonsFullReturned, empty: r.gallonsEmptyReturned };
  (corrs || []).forEach((c) => { if (c.active && RUN_FIELDS[c.field]) eff[c.field] += c.delta; });
  return eff;
}
function runClient(r, sold, corrs) {
  const cs = corrs || [];
  const eff = effectiveRun(r, cs);
  const expectedRemaining = eff.out - sold;                            // full gallons that SHOULD be left on the truck
  const diff = r.status === 'closed' ? (eff.full - expectedRemaining) : null;   // returned − expected (from EFFECTIVE values)
  const active = cs.filter((c) => c.active);
  return {
    id: r.id, date: r.date, fleetId: r.fleetId, runNo: r.runNo, status: r.status,
    // displayed figures are the EFFECTIVE (corrected) values; base kept for the history view
    gallonsOut: eff.out, gallonsFullReturned: eff.full, gallonsEmptyReturned: eff.empty,
    baseGallonsOut: r.gallonsOut, baseGallonsFullReturned: r.gallonsFullReturned, baseGallonsEmptyReturned: r.gallonsEmptyReturned,
    sold, expectedRemaining, diff, diffReason: r.diffReason || '', note: r.note || '',
    corrected: active.length > 0,
    corrections: cs.map((c) => ({ id: c.id, field: c.field, delta: c.delta, reason: c.reason, active: c.active, actorName: c.actorName || null, createdAt: runMs(c.createdAt) })),
    openedByName: r.openedByName || null, openedAt: runMs(r.openedAt), closedByName: r.closedByName || null, closedAt: runMs(r.closedAt),
  };
}
// Active corrections for a set of runs, grouped by runId (one query for the whole report).
async function correctionsForRuns(runIds) {
  if (!runIds.length) return {};
  const rows = await prisma.runCorrection.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: 'asc' } });
  const m = {}; rows.forEach((c) => { (m[c.runId] = m[c.runId] || []).push(c); });
  return m;
}
// Σ gallons sold (lunas/bon) per run, from the linked transactions.
async function soldForRuns(runIds) {
  if (!runIds.length) return {};
  const txns = await prisma.distTransaction.findMany({ where: { deliveryRunId: { in: runIds }, method: { in: ['lunas', 'bon'] } }, select: { deliveryRunId: true, qty: true } });
  const m = {}; txns.forEach((t) => { m[t.deliveryRunId] = (m[t.deliveryRunId] || 0) + t.qty; });
  return m;
}
// The fleet's currently-open run id (used to auto-tag new sales), or null.
async function openRunIdFor(fleetId) {
  if (!fleetId) return null;
  const r = await prisma.deliveryRun.findFirst({ where: { fleetId, status: 'open' }, select: { id: true } });
  return r ? r.id : null;
}
// MUAT — open a run: record full gallons loaded onto the truck. One open run per fleet at a
// time (must close the previous). runNo auto-increments per fleet per day.
async function openRun(body, actor) {
  const date = body.date;
  if (!date) throw ApiError.badRequest('Tanggal wajib diisi.');
  const fleetId = resolveWriteFleet(actor, body.fleet);
  if (!fleetId) throw ApiError.badRequest('Pilih armada.');
  const gallonsOut = int(body.gallonsOut);
  if (gallonsOut <= 0) throw ApiError.badRequest('Jumlah galon dimuat harus lebih dari 0.');
  const openExisting = await prisma.deliveryRun.findFirst({ where: { fleetId, status: 'open' } });
  if (openExisting) throw ApiError.badRequest(`Masih ada rit terbuka (rit-${openExisting.runNo}) untuk armada ini — tutup dulu.`, { runId: openExisting.id });
  const last = await prisma.deliveryRun.findFirst({ where: { date, fleetId }, orderBy: { runNo: 'desc' } });
  const runNo = (last ? last.runNo : 0) + 1;
  const snap = await actorSnap(actor);
  const run = await prisma.deliveryRun.create({ data: { date, fleetId, runNo, gallonsOut, note: String(body.note || '').slice(0, 300), status: 'open', openedById: snap.actorId, openedByName: snap.actorName } });
  await logAudit('pengiriman', `Muat rit-${runNo}: ${fleetId}`, `${gallonsOut} galon dimuat · ${date}`, snap, fleetId);
  return runClient(run, 0);
}
// TUTUP — close a run: record full + empty gallons returned, reconcile vs expected, and REQUIRE
// a reason when the difference ≠ 0.
async function closeRun(id, body, actor) {
  const run = await prisma.deliveryRun.findUnique({ where: { id } });
  if (!run) throw ApiError.notFound('Rit tidak ditemukan.');
  if (!fleetAllows(actor, run.fleetId)) throw ApiError.notFound('Rit tidak ditemukan.');
  if (run.status === 'closed') throw ApiError.badRequest('Rit ini sudah ditutup.');
  const full = int(body.gallonsFullReturned);
  const empty = int(body.gallonsEmptyReturned);
  const sold = (await soldForRuns([id]))[id] || 0;
  // Reconcile against the EFFECTIVE muat (base + any 'out' corrections made while open).
  const corrs = (await correctionsForRuns([id]))[id] || [];
  const expectedRemaining = effectiveRun(run, corrs).out - sold;
  const diff = full - expectedRemaining;
  const reason = String(body.diffReason || '').trim();
  if (diff !== 0 && !reason) throw ApiError.badRequest(`Selisih ${diff > 0 ? '+' : ''}${diff} galon (seharusnya ${expectedRemaining}, dikembalikan ${full}) — alasan wajib diisi.`, { diff, expectedRemaining, sold });
  const snap = await actorSnap(actor);
  const updated = await prisma.deliveryRun.update({ where: { id }, data: {
    status: 'closed', gallonsFullReturned: full, gallonsEmptyReturned: empty, diffReason: diff !== 0 ? reason : '',
    closedById: snap.actorId, closedByName: snap.actorName, closedAt: new Date(),
  } });
  await logAudit('pengiriman', `Tutup rit-${run.runNo}: ${run.fleetId}`,
    `muat ${effectiveRun(run, corrs).out} · terjual ${sold} · sisa seharusnya ${expectedRemaining} · dikembalikan ${full} · selisih ${diff}${diff !== 0 ? ' (' + reason + ')' : ''} · kosong ${empty}`, snap, run.fleetId);
  return runClient(updated, sold, corrs);
}
// KOREKSI RIT (append-only) — fix a mistake in a run's muat / isi-kembali / kosong without
// overwriting the stored figure. The caller submits the CORRECTED absolute value(s); we append
// one signed RunCorrection per changed field (delta = new − current effective) with a required
// reason, and one immutable audit row per field. Displayed figures + reconciliation then use the
// effective totals. No GallonMovement is touched (a run is a truck-level tally — stock stays
// driven by the per-customer movements). Cap: distribusiKoreksi.
async function correctRun(id, body, actor) {
  const run = await prisma.deliveryRun.findUnique({ where: { id } });
  if (!run) throw ApiError.notFound('Rit tidak ditemukan.');
  if (!fleetAllows(actor, run.fleetId)) throw ApiError.notFound('Rit tidak ditemukan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan koreksi wajib diisi.');
  // On an OPEN run only the muat (out) is known; isi-kembali/kosong are entered at close.
  if (run.status !== 'closed' && (body.full != null || body.empty != null)) {
    throw ApiError.badRequest('Rit masih terbuka — hanya galon muat yang bisa dikoreksi. Tutup rit dulu untuk mengoreksi isi/kosong.');
  }
  const existing = (await correctionsForRuns([id]))[id] || [];
  const eff = effectiveRun(run, existing);
  // Build one signed correction per field the caller actually changed.
  const changes = [];
  for (const field of ['out', 'full', 'empty']) {
    if (body[field] == null) continue;
    const target = int(body[field]);
    const delta = target - eff[field];
    if (delta !== 0) changes.push({ field, delta, from: eff[field], to: target });
  }
  if (!changes.length) throw ApiError.badRequest('Tidak ada perubahan nilai untuk dikoreksi.');
  const snap = await actorSnap(actor);
  for (const ch of changes) {
    await prisma.runCorrection.create({ data: {
      runId: id, field: ch.field, delta: ch.delta, reason,
      actorId: snap.actorId, actorRole: snap.actorRole, actorName: snap.actorName,
    } });
    // One immutable audit entry per field (run, field, delta, reason, actor).
    await logAudit('koreksi', `Koreksi rit-${run.runNo}: ${run.fleetId}`,
      `${RUN_FIELDS[ch.field].label} ${ch.from} → ${ch.to} (${ch.delta > 0 ? '+' : ''}${ch.delta}) · ${reason}`, snap, run.fleetId);
  }
  const corrs = (await correctionsForRuns([id]))[id] || [];
  const sold = (await soldForRuns([id]))[id] || 0;
  return runClient(run, sold, corrs);
}
// Report: runs within the user's scope (by date/fleet/status), each with sold + reconciliation.
async function listRuns(user, query) {
  const q = query || {};
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.date) where.date = q.date;
  if (q.status === 'open' || q.status === 'closed') where.status = q.status;
  const rows = await prisma.deliveryRun.findMany({ where, orderBy: [{ date: 'desc' }, { fleetId: 'asc' }, { runNo: 'asc' }], take: 500 });
  const ids = rows.map((r) => r.id);
  const sold = await soldForRuns(ids);
  const corrs = await correctionsForRuns(ids);
  return { data: rows.map((r) => runClient(r, sold[r.id] || 0, corrs[r.id] || [])) };
}

// Add a 'tambahan' order (admin). fleetId comes from the chosen customer. Idempotent per
// customer/day. Returns the row + fleetId so the controller can notify that fleet.
async function addOrder(body, actor) {
  const c = await prisma.customer.findUnique({ where: { id: String(body.customerId || '') } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(actor, c.armada)) throw ApiError.forbidden('Pelanggan di luar akses Anda.');
  if (c.active === false) throw ApiError.badRequest('Pelanggan nonaktif — aktifkan kembali untuk menambah orderan.');
  if (!(c.armada || '').trim()) throw ApiError.badRequest('Pelanggan belum punya armada.');
  const snap = await actorSnap(actor);
  const qty = body.qty != null ? Math.max(0, int(body.qty)) : null;
  const note = String(body.note || '').slice(0, 300);
  const row = await prisma.delivery.upsert({
    where: { date_customerId_source: { date: body.date, customerId: c.id, source: 'tambahan' } },
    update: { qty, note, status: 'pending' },
    create: { date: body.date, customerId: c.id, source: 'tambahan', fleetId: c.armada, status: 'pending', seq: 999, qty, note, createdById: snap.actorId, createdByName: snap.actorName },
    include: { customer: true },
  });
  await logAudit('pengiriman', `Orderan tambahan: ${c.name}`, `Tanggal ${body.date} · armada ${c.armada}`, snap, c.armada);
  const sisa = (await bonMapFor([c.id]))[c.id];
  return { delivery: deliveryClient(row, sisa), fleetId: c.armada };
}
// Update a stop's status (terkirim/batal/pending) and optionally link a transaction.
async function markDelivery(id, body, actor) {
  const d = await prisma.delivery.findUnique({ where: { id }, include: { customer: true } });
  if (!d) throw ApiError.notFound('Delivery not found');
  if (!fleetAllows(actor, d.fleetId)) throw ApiError.forbidden('Pengiriman di luar akses Anda.');
  const status = ['pending', 'terkirim', 'batal'].includes(body.status) ? body.status : d.status;
  const data = { status };
  if (body.transactionId) data.transactionId = String(body.transactionId);
  const row = await prisma.delivery.update({ where: { id }, data, include: { customer: true } });
  const sisa = (await bonMapFor([row.customerId]))[row.customerId];
  return { data: deliveryClient(row, sisa) };
}
// Persist a new route order for a board: `order` is the ordered list of delivery ids;
// each gets seq = its position. Every referenced stop must be within the user's scope.
async function reorderDeliveries(user, body) {
  const ids = Array.isArray(body.order) ? body.order : [];
  const rows = await prisma.delivery.findMany({ where: { id: { in: ids } } });
  const byId = {}; rows.forEach((r) => { byId[r.id] = r; });
  for (const r of rows) { if (!fleetAllows(user, r.fleetId)) throw ApiError.forbidden('Pengiriman di luar akses Anda.'); }
  let seq = 0;
  for (const id of ids) { if (byId[id]) { await prisma.delivery.update({ where: { id }, data: { seq } }); seq++; } }
  return { ok: true, count: seq };
}

// ── FIELD EXPENSES (pengeluaran lapangan) ────────────────────────────────────────
// Cash a delivery person paid out in the field (fuel/bensin, meals, parking…). Itemised, fleet-
// scoped, append-only (a mistake is VOIDED with a reason + re-logged, never silently deleted). It
// never posts to Entry/Setoran — so it can't double-count the old Setoran.expense number; it only
// reduces the dashboard's "net cash to deposit" and shows as an informational bridge line.
const DEFAULT_EXP_CATS = ['bensin', 'makan', 'parkir', 'lainnya'];
function expenseClient(e) {
  return {
    id: e.id, date: e.date, fleetId: e.fleetId, amount: e.amount, category: e.category, note: e.note || '',
    photoId: e.photoId || null, businessUnitId: e.businessUnitId || 'air', status: e.status,
    voidedByName: e.voidedByName || null, voidedAt: e.voidedAt ? new Date(e.voidedAt).getTime() : null, voidReason: e.voidReason || '',
    createdByName: e.createdByName || null, createdAt: e.createdAt ? new Date(e.createdAt).getTime() : null,
  };
}
// List field expenses in the user's fleet scope. Owner/admin (no scope) see all fleets; a scoped
// staff sees only their fleet(s). Filter by date and/or fleet; voided rows are included but marked.
async function listExpenses(user, query) {
  const q = query || {};
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.date) where.date = q.date;
  if (q.dateFrom || q.dateTo) where.date = { ...(q.dateFrom ? { gte: q.dateFrom } : {}), ...(q.dateTo ? { lte: q.dateTo } : {}) };
  if (q.status === 'active' || q.status === 'void') where.status = q.status;
  const rows = await resilientFindMany(prisma.distExpense, { where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 }, 'expenses');
  return { data: rows.map(expenseClient) };
}
async function createExpense(body, actor) {
  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest('Tanggal wajib diisi.');
  const amount = int(body.amount);
  if (amount <= 0) throw ApiError.badRequest('Nominal pengeluaran harus lebih dari 0.');
  if (overCeiling(amount)) throw ApiError.badRequest(ceilingMsg, { amount });
  const fleetId = resolveWriteFleet(actor, body.fleet);
  if (!fleetId) throw ApiError.badRequest('Pilih armada.');
  const category = String(body.category || 'lainnya').trim().slice(0, 40) || 'lainnya';
  const businessUnitId = await resolveUnitId(body.businessUnitId);
  const snap = await actorSnap(actor);
  const e = await prisma.distExpense.create({ data: {
    date, fleetId, amount, category, note: String(body.note || '').slice(0, 300),
    photoId: body.photoId ? String(body.photoId).slice(0, 60) : null, businessUnitId,
    createdById: snap.actorId, createdByName: snap.actorName,
  } });
  await logAudit('input', `Pengeluaran lapangan: ${fleetId}`, `${category} ${amount}${e.note ? ' · ' + e.note : ''} · ${date}`, snap, fleetId);
  return expenseClient(e);
}
// VOID a field expense (recorded cancellation) — the append-only correction path. Row STAYS
// (status='void', excluded from totals); a reason is required and the action is audited.
async function voidExpense(id, body, actor) {
  const e = await prisma.distExpense.findUnique({ where: { id } });
  if (!e) throw ApiError.notFound('Pengeluaran tidak ditemukan.');
  if (!fleetAllows(actor, e.fleetId)) throw ApiError.notFound('Pengeluaran tidak ditemukan.');
  if (e.status === 'void') throw ApiError.badRequest('Pengeluaran ini sudah dibatalkan.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan pembatalan wajib diisi.');
  const snap = await actorSnap(actor);
  const upd = await prisma.distExpense.update({ where: { id }, data: {
    status: 'void', voidedById: snap.actorId, voidedByName: snap.actorName, voidedAt: new Date(), voidReason: reason,
  } });
  await logAudit('koreksi', `Batalkan pengeluaran: ${e.fleetId}`, `${e.category} ${e.amount} · ${reason}`, snap, e.fleetId);
  return expenseClient(upd);
}
// Σ active field expenses per fleet for a date, in the user's scope (drives dashboard net cash).
async function expensesForDate(user, day, qFleet) {
  return expensesForRange(user, day, day, qFleet);
}
// Σ active field expenses per fleet over a date range [from,to], in the user's scope.
async function expensesForRange(user, from, to, qFleet) {
  const rows = await prisma.distExpense.findMany({ where: { date: { gte: from, lte: to }, status: 'active', ...fleetWhere(user, 'fleetId', qFleet) }, select: { fleetId: true, amount: true } });
  let total = 0; const byFleet = {};
  rows.forEach((r) => { total += r.amount; byFleet[r.fleetId || ''] = (byFleet[r.fleetId || ''] || 0) + r.amount; });
  return { total, byFleet };
}

// Cash Integration view — one authorized read (gated distribusiCashIntegrasi) that composes exactly
// the datasets the screen needs: transactions in the range, all customers (for outstanding bon), the
// adjustment audit rows for the counts, and field expenses (informational net-cash line).
async function cashIntegration(user, query) {
  const q = query || {};
  const [t, c, a, e] = await Promise.all([
    listTransactions({ dateFrom: q.dateFrom, dateTo: q.dateTo, fleet: q.fleet }, user),
    listCustomers(user, q.fleet, 'all'),   // include deactivated — they may still carry outstanding bon
    listAudit({ limit: 500, fleet: q.fleet }, user),
    listExpenses(user, { dateFrom: q.dateFrom, dateTo: q.dateTo, fleet: q.fleet, status: 'active' }),
  ]);
  // Field expenses ride along as an INFORMATIONAL line only — the bridge never posts to the cash
  // book, so surfacing them here can't double-count the separate Setoran.expense number.
  // …and a "pelunasan tidak diterima" is dropped here too: the bridge exists to reconcile MONEY that
  // moved, and for that row none did. It stays on the customer's ledger; the shortfall is reported by
  // lossReport instead. Dropping it server-side means no client can sum it into a cash figure.
  return { transactions: t.data.filter((x) => !x.legacy && !x.paymentNotReceived), customers: c.data, audit: a.data, expenses: e.data };
}

// ── LAPORAN PENGIRIMAN (delivery report) ─────────────────────────────────────────
// A READ-ONLY per-fleet report over a day/range combining what already exists: rits (runs) with
// their reconciliation, delivery stops (planned vs terkirim vs batal/ditunda + reasons), the daily
// closeouts (notes/kendala), and the day's cash summary (tunai/transfer/field expenses/net cash).
// Fleet scope + business-unit filtering apply (same fleetWhere as everything else). It NEVER writes.
const dayRange = (query, today) => {
  const q = query || {};
  if (q.date) return { from: q.date, to: q.date, period: 'range' };
  const p = q.period || (q.dateFrom || q.dateTo ? 'range' : 'today');
  if (p === 'week') return { from: addDays(today, -6), to: today, period: 'week' };
  if (p === 'month') return { from: today.slice(0, 8) + '01', to: today, period: 'month' };
  if (p === 'range') { let f = q.dateFrom || today, t = q.dateTo || today; if (f > t) { const x = f; f = t; t = x; } return { from: f, to: t, period: 'range' }; }
  return { from: today, to: today, period: 'today' };
};
async function deliveryReport(user, query) {
  const { from, to, period } = dayRange(query, todayISO());
  const qFleet = query.fleet;
  const inRange = { gte: from, lte: to };
  // 1) RUNS (rits) with effective figures + reconciliation
  const runRows = await prisma.deliveryRun.findMany({ where: { date: inRange, ...fleetWhere(user, 'fleetId', qFleet) }, orderBy: [{ date: 'asc' }, { fleetId: 'asc' }, { runNo: 'asc' }] });
  const runIds = runRows.map((r) => r.id);
  const sold = await soldForRuns(runIds);
  const runCorrs = await correctionsForRuns(runIds);
  const runs = runRows.map((r) => runClient(r, sold[r.id] || 0, runCorrs[r.id] || []));
  // 2) DELIVERY STOPS — planned vs terkirim vs batal/ditunda (+ reasons for the non-delivered)
  const stopRows = await resilientFindMany(prisma.delivery, { where: { date: inRange, ...fleetWhere(user, 'fleetId', qFleet) }, include: { customer: { select: { name: true } } }, orderBy: [{ date: 'asc' }, { seq: 'asc' }] }, 'report-stops');
  // 3) CLOSEOUTS (notes / kendala)
  const coRows = await prisma.deliveryCloseout.findMany({ where: { date: inRange, ...fleetWhere(user, 'fleetId', qFleet) }, orderBy: { date: 'asc' } });
  // 4) CASH — money-in split (tunai/transfer) + field expenses → net cash, per fleet
  const txns = await resilientFindMany(prisma.distTransaction, { where: { txnDate: inRange, ...fleetWhere(user, 'fleetId', qFleet), ...LIVE_TXN }, include: { corrections: { select: { kind: true, deltaAmount: true, active: true } } } }, 'report-cash');
  const exp = await resilientFindMany(prisma.distExpense, { where: { date: inRange, status: 'active', ...fleetWhere(user, 'fleetId', qFleet) }, select: { fleetId: true, amount: true } }, 'report-expenses');

  // Bucket everything by fleet.
  const fleetMap = {};
  const F = (id) => (fleetMap[id] || (fleetMap[id] = {
    fleetId: id, runs: [], stops: { planned: 0, terkirim: 0, batal: 0, ditunda: 0, pending: 0 }, stopReasons: [],
    closeouts: [], cash: { tunai: 0, transfer: 0, expense: 0, net: 0 },
    runTotals: { out: 0, sold: 0, full: 0, empty: 0, diff: 0 },
  }));
  runs.forEach((r) => { const f = F(r.fleetId); f.runs.push(r); f.runTotals.out += r.gallonsOut; f.runTotals.sold += r.sold; f.runTotals.full += (r.status === 'closed' ? r.gallonsFullReturned : 0); f.runTotals.empty += (r.status === 'closed' ? r.gallonsEmptyReturned : 0); f.runTotals.diff += (r.diff || 0); });
  stopRows.forEach((s) => {
    const f = F(s.fleetId || '');
    f.stops.planned += 1;
    if (f.stops[s.status] != null) f.stops[s.status] += 1;
    if (s.status === 'batal' || s.status === 'ditunda' || s.status === 'pending') {
      f.stopReasons.push({ date: s.date, customerName: s.customer ? s.customer.name : '', status: s.status, reason: s.pendingReason || s.note || '' });
    }
  });
  coRows.forEach((c) => { F(c.fleetId || '').closeouts.push(closeoutClient(c)); });
  txns.forEach((t) => {
    // "Pelunasan tidak diterima" cleared the customer's bon but no cash arrived → never a cash line.
    const inc = noMoneyIn(t) ? 0 : t.method === 'lunas' ? (t.amount + priceDelta(t.corrections)) : t.method === 'pelunasan' ? t.amount : 0;
    if (!inc) return;
    const f = F(t.fleetId || '');
    if (isTransferPayment(t)) f.cash.transfer += inc; else f.cash.tunai += inc;
  });
  exp.forEach((e) => { F(e.fleetId || '').cash.expense += e.amount; });
  Object.values(fleetMap).forEach((f) => { f.cash.net = f.cash.tunai - f.cash.expense; });

  const fleets = Object.values(fleetMap).sort((a, b) => (a.fleetId || '~').localeCompare(b.fleetId || '~'));
  // Combined totals across fleets.
  const totals = {
    runs: fleets.reduce((a, f) => ({ out: a.out + f.runTotals.out, sold: a.sold + f.runTotals.sold, full: a.full + f.runTotals.full, empty: a.empty + f.runTotals.empty, diff: a.diff + f.runTotals.diff }), { out: 0, sold: 0, full: 0, empty: 0, diff: 0 }),
    stops: fleets.reduce((a, f) => ({ planned: a.planned + f.stops.planned, terkirim: a.terkirim + f.stops.terkirim, batal: a.batal + f.stops.batal, ditunda: a.ditunda + f.stops.ditunda, pending: a.pending + f.stops.pending }), { planned: 0, terkirim: 0, batal: 0, ditunda: 0, pending: 0 }),
    cash: fleets.reduce((a, f) => ({ tunai: a.tunai + f.cash.tunai, transfer: a.transfer + f.cash.transfer, expense: a.expense + f.cash.expense, net: a.net + f.cash.net }), { tunai: 0, transfer: 0, expense: 0, net: 0 }),
  };
  return { from, to, period, fleets, totals };
}

module.exports = {
  METHODS, DAY_CODES, PRICE_SCOPES,
  gallonSummary, gallonCorrection, setOpeningStock, reportGallonDamage, resetGallon, logDistAudit, gallonBalances, syncPurchaseMovement, retractPurchaseMovement,
  listCustomers, getCustomer, createCustomer, updateCustomer, setCustomerLocation, setLocationPhoto, importCustomers, importLegacyTransactions, undoLegacyBatch, updatePrice, pricePreview, cancelPriceAdjustment,
  deactivateCustomer, reactivateCustomer, deleteCustomer, customerImpact,
  listTypes, createType, renameType, deleteType, seedCustomerTypes,
  listTransactions, createTransaction, createOpeningBon, addCorrection, voidTransaction, setTransactionArchive, hardDeleteTransaction, listAudit, dashboardSummary,
  requestChange, listChangeRequests, decideChangeRequest,
  createPaymentNotReceived, lossReport,
  createInvoice, listInvoices, getInvoice, billingReminders, cashIntegration, deliveryReport,
  deliveryBoard, addOrder, markDelivery, reorderDeliveries, closeDay, listCloseouts,
  openRun, closeRun, listRuns, correctRun,
  listExpenses, createExpense, voidExpense, DEFAULT_EXP_CATS,
};
