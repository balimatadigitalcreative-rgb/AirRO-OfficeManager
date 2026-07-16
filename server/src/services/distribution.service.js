'use strict';
// DISTRIBUSI module service — per-record REST, fully separate from the AirRO cash
// book (nothing here ever writes to the Entry/cash-flow tables). Core invariants:
//   • transaction unit price is LOCKED on the SERVER from the customer's master_price
//     (the client price, if any, is ignored) and amount is computed here;
//   • transactions + price history + corrections + audit are APPEND-ONLY — no update
//     or delete is exposed; mistakes are fixed by appending a correction;
//   • every write also appends an immutable DistAuditLog row.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { resolvePerms } = require('../config/permissions');
const { cycleOf } = require('./cashbon.rules');   // payroll cycle (16→15) for the "periode berjalan" scope

const METHODS = ['lunas', 'bon', 'pelunasan'];
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
  const out = { actorId: (actor && actor.id) || null, actorRole: (actor && actor.role) || null, actorName: null, actorStaff: false };
  if (actor && actor.id) {
    const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, role: true, permissions: true } });
    if (u) {
      out.actorName = u.name;
      const perms = resolvePerms(u.role, u.permissions);
      // A "staff" actor has base distribusi but none of the owner distribusi caps.
      out.actorStaff = !!(perms.distribusi && !perms.distribusiAudit && !perms.distribusiHargaMaster && !perms.distribusiCustomers);
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
async function listCustomers(user, qFleet, status) {
  // status: 'active' (default) hides deactivated · 'inactive' shows only deactivated · 'all' shows both.
  const st = status === 'inactive' || status === 'all' ? status : 'active';
  const activeWhere = st === 'active' ? { active: { not: false } } : st === 'inactive' ? { active: false } : {};
  const rows = await prisma.customer.findMany({ where: { ...fleetWhere(user, 'armada', qFleet), ...activeWhere }, orderBy: { name: 'asc' } });
  const txns = await prisma.distTransaction.findMany({ where: fleetWhere(user, 'fleetId', qFleet), select: { id: true, customerId: true, qty: true, amount: true, method: true, txnDate: true } });
  const deltaMap = await activePriceDeltas({});   // effective bon includes active price adjustments
  const agg = {};
  txns.forEach((t) => {
    const a = agg[t.customerId] || (agg[t.customerId] = { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 });
    const eff = t.amount + (deltaMap[t.id] || 0);
    a.totalGalon += t.qty; a.txnCount++;
    if (t.method === 'bon') a.bon += eff; else if (t.method === 'pelunasan') a.pelunasan += t.amount;
    if (t.txnDate > a.lastDate) a.lastDate = t.txnDate;
  });
  const heldMap = await gallonBalances(user, qFleet);   // gallons each customer currently holds
  const data = rows.map((c) => {
    const a = agg[c.id] || { totalGalon: 0, bon: 0, pelunasan: 0, lastDate: '', txnCount: 0 };
    return { ...custClient(c), totalGalon: a.totalGalon, sisaBon: Math.max(0, a.bon - a.pelunasan), lastDate: a.lastDate || null, txnCount: a.txnCount, gallonsHeld: heldMap[c.id] || 0 };
  });
  return { data };
}
async function getCustomer(id, user) {
  const c = await prisma.customer.findUnique({ where: { id }, include: { priceHistory: { orderBy: { changedAt: 'desc' } } } });
  if (!c) throw ApiError.notFound('Customer not found');
  if (!fleetAllows(user, c.armada)) throw ApiError.notFound('Customer not found');   // out of the user's fleet scope
  const txns = await prisma.distTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, include: { corrections: true } });
  let bon = 0, pelunasan = 0, totalGalon = 0;
  const transactions = txns.map((t) => {
    const adj = priceDelta(t.corrections);
    const eff = t.amount + adj;
    totalGalon += t.qty;
    // bon uses the EFFECTIVE (adjusted) amount; a paid txn's adjustment is reported but
    // does not become a new receivable (money already settled at the old price).
    if (t.method === 'bon') bon += eff; else if (t.method === 'pelunasan') pelunasan += t.amount;
    return { id: t.id, qty: t.qty, unitPriceLocked: t.unitPriceLocked, amount: t.amount, adjustAmount: adj, effectiveAmount: eff, method: t.method, txnDate: t.txnDate, note: t.note, actorName: t.actorName, createdAt: t.createdAt ? new Date(t.createdAt).getTime() : null, corrected: hasManualCorrection(t.corrections), adjusted: adj !== 0 };
  });
  // Active price-adjustment batches (for the "batalkan penyesuaian" UI).
  const batches = {};
  txns.forEach((t) => t.corrections.filter((x) => x.kind === 'price' && x.active).forEach((x) => {
    let nv = {}, ov = {}; try { nv = x.newValue ? JSON.parse(x.newValue) : {}; } catch (e) {} try { ov = x.oldValue ? JSON.parse(x.oldValue) : {}; } catch (e) {}
    const b = batches[x.batchId] || (batches[x.batchId] = { batchId: x.batchId, count: 0, totalDelta: 0, createdAt: x.createdAt ? new Date(x.createdAt).getTime() : null, oldPrice: ov.oldPrice, newPrice: nv.newPrice, scope: nv.scope, actorName: x.actorName || null });
    b.count++; b.totalDelta += x.deltaAmount;
  }));
  const priceAdjustments = Object.values(batches).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const gallonsHeld = await gallonBalanceOf(id);   // computed from the gallon ledger
  return { ...custClient(c), transactions, totalGalon, sisaBon: Math.max(0, bon - pelunasan), txnCount: txns.length, priceAdjustments, gallonsHeld };
}
// Sync write columns (type is resolved separately — it needs a DB lookup).
function customerCols(body) {
  return {
    name: String(body.name || '').trim(),
    phone: body.phone != null ? String(body.phone).trim() : '',
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
  if (loc) { cols.lat = loc.lat; cols.lng = loc.lng; }
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
  if (body.phone != null) data.phone = String(body.phone).trim();
  if (body.deliveryDays !== undefined) data.deliveryDays = JSON.stringify(cleanDays(body.deliveryDays));
  if (body.armada !== undefined) data.armada = resolveWriteFleet(actor, body.armada);   // can't move out of scope
  if (body.reminder !== undefined) data.reminder = cleanReminder(body.reminder);        // billing-reminder settings
  if (body.type != null) data.type = await validTypeId(body.type);
  if (body.address !== undefined) data.address = String(body.address || '').slice(0, 300);
  const snap = await actorSnap(actor);
  // Google Maps link (pasted). '' clears it. A non-empty link stamps who/when.
  if (body.mapsUrl !== undefined) { data.mapsUrl = cleanMapsUrl(body.mapsUrl); if (data.mapsUrl) { data.locationSetAt = new Date(); data.locationSetByName = snap.actorName; } }
  // Manual coordinate entry. Providing both sets them + stamps; null/'' for both clears.
  if (body.lat !== undefined || body.lng !== undefined) {
    const loc = normLatLng(body.lat, body.lng);
    if (loc) { data.lat = loc.lat; data.lng = loc.lng; data.locationSetAt = new Date(); data.locationSetByName = snap.actorName; }
    else if ((body.lat === null || body.lat === '') && (body.lng === null || body.lng === '')) { data.lat = null; data.lng = null; }
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
  // Also build a ready-to-use Maps link from the point so "Petunjuk Arah" works right away.
  const data = { lat: loc.lat, lng: loc.lng, mapsUrl: 'https://www.google.com/maps?q=' + loc.lat + ',' + loc.lng, locationSetAt: new Date(), locationSetByName: snap.actorName };
  if (body.address !== undefined) data.address = String(body.address || '').slice(0, 300);
  const c = await prisma.customer.update({ where: { id }, data });
  await logAudit('pelanggan', `Set lokasi: ${c.name}`, `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`, snap, c.armada);
  return custClient(c);
}
async function importCustomers(list, actor) {
  const rows = Array.isArray(list) ? list : [];
  const snap = await actorSnap(actor);
  let created = 0; const out = [];
  for (const item of rows) {
    const cols = customerCols(item);
    if (!cols.name) continue;
    cols.type = await validTypeId(item.type);
    cols.armada = resolveWriteFleet(actor, cols.armada);   // scoped importer → their fleet
    cols.code = await allocateCustomerCode();
    const c = await prisma.customer.create({ data: { ...cols, createdById: snap.actorId, createdByName: snap.actorName, createdByRole: snap.actorRole } });
    out.push(custClient(c)); created++;
  }
  await logAudit('impor', `Impor ${created} pelanggan`, `Dari ${rows.length} baris`, snap);
  return { data: out, imported: created, received: rows.length };
}

// Small rollup used by both the deactivate flow and the delete-warning modal: how much
// history is attached to a customer (so the UI/audit can say "N transaksi & sisa bon Rp X").
async function customerImpact(id) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId: id }, include: { corrections: true } });
  let bon = 0, pelunasan = 0;
  txns.forEach((t) => { const eff = t.amount + priceDelta(t.corrections); if (t.method === 'bon') bon += eff; else if (t.method === 'pelunasan') pelunasan += t.amount; });
  return { txnCount: txns.length, sisaBon: Math.max(0, bon - pelunasan) };
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
    const txns = await prisma.distTransaction.findMany({ where: { customerId: id, ...scopeWhere(scope, todayISO()) } });
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
  const sales = await prisma.distTransaction.findMany({ where: { customerId: id, method: { in: ['lunas', 'bon'] } }, select: { qty: true, method: true, txnDate: true } });
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
  const rows = await prisma.distTransaction.findMany({
    where, orderBy: { createdAt: 'desc' },
    include: { customer: { select: { name: true, code: true, type: true } }, corrections: { orderBy: { createdAt: 'desc' } } },
  });
  // Expose the effective (adjusted) amount + flags so reports/Cash Integration follow the
  // new price while the original `amount` stays intact.
  const data = rows.map((r) => { const adj = priceDelta(r.corrections); return { ...r, adjustAmount: adj, effectiveAmount: r.amount + adj, adjusted: adj !== 0, correctedManual: hasManualCorrection(r.corrections) }; });
  return { data, now: new Date().toISOString() };
}
// Current outstanding bon (piutang) for a customer: Σ effective bon − Σ pelunasan,
// floored at 0 — identical to the sisaBon shown on the customer list/detail.
async function customerBonBalance(customerId) {
  const txns = await prisma.distTransaction.findMany({ where: { customerId }, include: { corrections: true } });
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
  const where = { customerId, method: { in: ['lunas', 'bon'] } };
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
  const rows = await prisma.distInvoice.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
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
  const txns = await prisma.distTransaction.findMany({ where: fleetWhere(user, 'fleetId', qFleet), select: { customerId: true, method: true, amount: true, txnDate: true, corrections: { select: { kind: true, deltaAmount: true, active: true } } } });
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
async function dashboardSummary(date, user, qFleet) {
  const day = date || new Date().toISOString().slice(0, 10);
  const from = addDays(day, -6);
  const fleetFilter = fleetWhere(user, 'fleetId', qFleet);
  const rows = await prisma.distTransaction.findMany({
    where: { txnDate: { gte: from, lte: day }, ...fleetFilter },
    include: { customer: { select: { name: true, type: true } }, corrections: { select: { kind: true, deltaAmount: true, active: true } } },
    orderBy: { createdAt: 'desc' },
  });
  // Amounts follow the EFFECTIVE (adjusted) value so retroactive price changes are reflected.
  const effOf = (r) => r.amount + priceDelta(r.corrections);

  // ── PERIOD (last 7 days) headline KPIs — computed from the SAME `rows` that power the
  // chart, the recent list and the top-customers list, so the headline numbers can never
  // disagree with what is shown right below them. Gallons sold = Σ qty; Money in = cash
  // actually received in the window (lunas sales + pelunasan payments). ──
  let periodQty = 0, periodIn = 0;
  rows.forEach((r) => { periodQty += r.qty; if (r.method === 'lunas') periodIn += effOf(r); else if (r.method === 'pelunasan') periodIn += r.amount; });

  // ── TODAY — powers the "today" rail + the "Transactions today" KPI. ──
  const todayRows = rows.filter((r) => r.txnDate === day);
  const byMethod = { lunas: 0, bon: 0, pelunasan: 0 };
  let amount = 0;
  todayRows.forEach((r) => { const e = effOf(r); amount += e; if (byMethod[r.method] != null) byMethod[r.method] += (r.method === 'pelunasan' ? r.amount : e); });
  const uangMasuk = byMethod.lunas + byMethod.pelunasan;
  const piutang = byMethod.bon;

  // ── RUNNING RECEIVABLES — outstanding bon across ALL time (fleet-scoped), computed
  // per-customer and floored at 0, identical to the Customers screen's sisaBon so the
  // dashboard total and the customer list can never disagree. This is a live balance,
  // NOT a 7-day figure, so a bon booked last month still shows as a receivable today. ──
  const allTxns = await prisma.distTransaction.findMany({ where: { ...fleetFilter }, select: { id: true, customerId: true, amount: true, method: true } });
  const rcvDelta = await activePriceDeltas({});
  const bonByCust = {};
  allTxns.forEach((t) => { const c = bonByCust[t.customerId] || (bonByCust[t.customerId] = { bon: 0, pel: 0 }); if (t.method === 'bon') c.bon += t.amount + (rcvDelta[t.id] || 0); else if (t.method === 'pelunasan') c.pel += t.amount; });
  const receivable = Object.values(bonByCust).reduce((s, c) => s + Math.max(0, c.bon - c.pel), 0);

  // 7-day stacked series: cash bucket (lunas + pelunasan) vs bon.
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(day, -i);
    let lunas = 0, bon = 0;
    rows.filter((r) => r.txnDate === d).forEach((r) => { const e = effOf(r); if (r.method === 'bon') bon += e; else lunas += e; });
    last7.push({ date: d, lunas, bon });
  }

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
  const reminders = (await billingReminders(user, qFleet, day)).data;   // "Perlu ditagih" list
  return {
    date: day, periodDays: 7,
    periodQty, periodIn,            // last-7-days headline KPIs (same source as chart/recent/top)
    receivable,                     // all-time outstanding bon (running balance)
    count: todayRows.length, amount, byMethod, uangMasuk, piutang,   // TODAY (rail + "Transactions today")
    customers, last7, recent, topCustomers, reminders,
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
  };
}
async function bonMapFor(custIds) {
  const map = {};
  if (!custIds.length) return map;
  const txns = await prisma.distTransaction.findMany({ where: { customerId: { in: custIds } }, select: { customerId: true, amount: true, method: true } });
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
  const rows = await prisma.delivery.findMany({
    where: { date, ...fleetWhere(user, 'fleetId', qFleet) },
    include: { customer: true }, orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
  });
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
function runClient(r, sold) {
  const expectedRemaining = r.gallonsOut - sold;                       // full gallons that SHOULD be left on the truck
  const diff = r.status === 'closed' ? (r.gallonsFullReturned - expectedRemaining) : null;   // returned − expected
  return {
    id: r.id, date: r.date, fleetId: r.fleetId, runNo: r.runNo, status: r.status,
    gallonsOut: r.gallonsOut, gallonsFullReturned: r.gallonsFullReturned, gallonsEmptyReturned: r.gallonsEmptyReturned,
    sold, expectedRemaining, diff, diffReason: r.diffReason || '', note: r.note || '',
    openedByName: r.openedByName || null, openedAt: runMs(r.openedAt), closedByName: r.closedByName || null, closedAt: runMs(r.closedAt),
  };
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
  const expectedRemaining = run.gallonsOut - sold;
  const diff = full - expectedRemaining;
  const reason = String(body.diffReason || '').trim();
  if (diff !== 0 && !reason) throw ApiError.badRequest(`Selisih ${diff > 0 ? '+' : ''}${diff} galon (seharusnya ${expectedRemaining}, dikembalikan ${full}) — alasan wajib diisi.`, { diff, expectedRemaining, sold });
  const snap = await actorSnap(actor);
  const updated = await prisma.deliveryRun.update({ where: { id }, data: {
    status: 'closed', gallonsFullReturned: full, gallonsEmptyReturned: empty, diffReason: diff !== 0 ? reason : '',
    closedById: snap.actorId, closedByName: snap.actorName, closedAt: new Date(),
  } });
  await logAudit('pengiriman', `Tutup rit-${run.runNo}: ${run.fleetId}`,
    `muat ${run.gallonsOut} · terjual ${sold} · sisa seharusnya ${expectedRemaining} · dikembalikan ${full} · selisih ${diff}${diff !== 0 ? ' (' + reason + ')' : ''} · kosong ${empty}`, snap, run.fleetId);
  return runClient(updated, sold);
}
// Report: runs within the user's scope (by date/fleet/status), each with sold + reconciliation.
async function listRuns(user, query) {
  const q = query || {};
  const where = { ...fleetWhere(user, 'fleetId', q.fleet) };
  if (q.date) where.date = q.date;
  if (q.status === 'open' || q.status === 'closed') where.status = q.status;
  const rows = await prisma.deliveryRun.findMany({ where, orderBy: [{ date: 'desc' }, { fleetId: 'asc' }, { runNo: 'asc' }], take: 500 });
  const sold = await soldForRuns(rows.map((r) => r.id));
  return { data: rows.map((r) => runClient(r, sold[r.id] || 0)) };
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

// Cash Integration view — one authorized read (gated distribusiCashIntegrasi) that
// composes exactly the datasets the screen needs: transactions in the range, all
// customers (for outstanding bon), and the adjustment audit rows for the counts.
async function cashIntegration(user, query) {
  const q = query || {};
  const [t, c, a] = await Promise.all([
    listTransactions({ dateFrom: q.dateFrom, dateTo: q.dateTo, fleet: q.fleet }, user),
    listCustomers(user, q.fleet, 'all'),   // include deactivated — they may still carry outstanding bon
    listAudit({ limit: 500, fleet: q.fleet }, user),
  ]);
  return { transactions: t.data, customers: c.data, audit: a.data };
}

module.exports = {
  METHODS, DAY_CODES, PRICE_SCOPES,
  gallonSummary, gallonCorrection, setOpeningStock, reportGallonDamage, resetGallon, logDistAudit, gallonBalances, syncPurchaseMovement, retractPurchaseMovement,
  listCustomers, getCustomer, createCustomer, updateCustomer, setCustomerLocation, importCustomers, updatePrice, pricePreview, cancelPriceAdjustment,
  deactivateCustomer, reactivateCustomer, deleteCustomer, customerImpact,
  listTypes, createType, renameType, deleteType, seedCustomerTypes,
  listTransactions, createTransaction, addCorrection, listAudit, dashboardSummary,
  createInvoice, listInvoices, getInvoice, billingReminders, cashIntegration,
  deliveryBoard, addOrder, markDelivery, reorderDeliveries, closeDay, listCloseouts,
  openRun, closeRun, listRuns,
};
