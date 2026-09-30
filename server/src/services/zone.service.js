'use strict';
/*
 * CUSTOMER ZONES — areas on the map that own the delivery schedule of the customers inside them.
 *
 * THE RULE (chosen by the owner): the schedule follows the zone. Every write here ends the same way —
 * recompute every affected customer's zone from its point (or its hand placement) and write the zone's
 * armada / delivery days onto it. The rule itself lives in dist-zones.js (planMembership), the SAME
 * code the map runs for its preview, so what the owner is shown before saving is what gets written.
 *
 * Guard rails, because this is a bulk schedule change:
 *   - every mutation takes `dryRun` and then returns the exact change list without writing;
 *   - a zone's armada '' / days [] mean "not set" — a half-configured zone never blanks a schedule;
 *   - leaving a zone keeps the schedule the customer last had;
 *   - managing zones needs distribusiZonaKelola AND access to every armada (zones span fleets);
 *   - each bulk write is one audit row naming who, which zone, and how many customers moved.
 */
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { fleetScopeOf } = require('../lib/fleet-scope');
const DZ = require('../../../dist-zones.js');

// Lazy: distribution.service requires this module for its location/edit hooks.
const dist = () => require('./distribution.service');

const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const cleanDays = (v) => { const a = Array.isArray(v) ? v : []; return DAY_CODES.filter((d) => a.includes(d)); };
const parseDays = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const parsePoly = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const hasCoords = (c) => typeof c.lat === 'number' && typeof c.lng === 'number';
const NEW_ID = '__baru__';

function zoneClient(z) {
  return { id: z.id, name: z.name, color: z.color, polygon: parsePoly(z.polygon), armada: z.armada || '', deliveryDays: parseDays(z.deliveryDays), sortOrder: z.sortOrder || 0 };
}
const planZone = (z) => ({ id: z.id, polygon: z.polygon, sortOrder: z.sortOrder || 0, armada: z.armada || '', days: z.deliveryDays || [] });
const planCust = (c) => ({ id: c.id, lat: c.lat, lng: c.lng, zoneId: c.zoneId || null, zoneManual: !!c.zoneManual, armada: c.armada || '', days: parseDays(c.deliveryDays) });
const CUST_SELECT = { id: true, code: true, name: true, lat: true, lng: true, zoneId: true, zoneManual: true, armada: true, deliveryDays: true };

// Zones span every armada, so managing them from a fleet-scoped account would let that account move
// other fleets' customers. The capability says "may manage zones"; this says "over everything".
function assertCanManage(actor) {
  if (fleetScopeOf(actor) !== null) throw ApiError.forbidden('Mengelola zona butuh akses ke semua armada.');
}

// The armada must be one the app knows — when the owner has curated the list (Setoran → Kelola Armada).
// Before that list exists nothing is known to compare against, so any name is taken as typed.
async function validArmada(armada) {
  const a = String(armada || '').trim();
  if (!a) return '';
  let list = [];
  try {
    const v = await require('./settings.service').get('airro_fleet');
    list = (Array.isArray(v) ? v : []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean);
  } catch (e) { /* no list yet */ }
  if (list.length && !list.includes(a)) throw ApiError.badRequest(`Armada "${a}" tidak ada di daftar armada.`);
  return a;
}

async function cleanInput(body, { creating }) {
  const out = {};
  if (creating || body.name !== undefined) {
    const n = String(body.name || '').trim().slice(0, 60);
    if (!n) throw ApiError.badRequest('Nama zona wajib diisi.');
    out.name = n;
  }
  if (body.color !== undefined) out.color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? body.color : undefined;
  if (creating || body.polygon !== undefined) {
    const v = DZ.validatePolygon(body.polygon);
    if (!v.ok) throw ApiError.badRequest(v.error);
    out.polygon = v.polygon;
  }
  if (body.armada !== undefined) out.armada = await validArmada(body.armada);
  if (body.deliveryDays !== undefined) out.deliveryDays = cleanDays(body.deliveryDays);
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

async function loadZones(db) {
  return (await (db || prisma).distZone.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })).map(zoneClient);
}

// The change list for a hypothetical set of zones — the preview and the write both come from here.
async function planFor(db, zones, custWhere, override) {
  const custs = await (db || prisma).customer.findMany({ where: custWhere || {}, select: CUST_SELECT });
  const input = custs.map(planCust).map((c) => (override ? override(c) : c));
  const plan = DZ.planMembership(input, zones.map(planZone));
  const byId = new Map(custs.map((c) => [c.id, c]));
  return plan.map((p) => Object.assign({}, p, { code: byId.get(p.id).code || '', name: byId.get(p.id).name }));
}

async function applyPlan(db, plan) {
  for (const p of plan) {
    const data = { zoneId: p.to.zoneId, armada: p.to.armada, deliveryDays: JSON.stringify(p.to.days) };
    if (p.manualCleared) data.zoneManual = false;
    await db.customer.update({ where: { id: p.id }, data });
  }
}

// What the screen shows for a change: zone NAMES, not ids, and at most 500 rows.
function describe(plan, zones, extraNames) {
  const names = Object.assign({}, extraNames || {});
  zones.forEach((z) => { names[z.id] = z.name; });
  const nm = (id) => (id ? names[id] || '(zona dihapus)' : null);
  return plan.slice(0, 500).map((p) => ({
    id: p.id, code: p.code, name: p.name,
    from: { zone: nm(p.from.zoneId), armada: p.from.armada, days: p.from.days },
    to: { zone: nm(p.to.zoneId), armada: p.to.armada, days: p.to.days },
  }));
}

async function audit(actor, title, plan, zone) {
  const names = plan.map((p) => p.name).slice(0, 20).join(', ') + (plan.length > 20 ? ' …' : '');
  const sched = zone ? ` · armada ${zone.armada || '(tidak diatur)'} · hari ${(zone.deliveryDays || []).join(', ') || '(tidak diatur)'}` : '';
  await dist().logDistAudit('pelanggan', title, `${plan.length} pelanggan ikut jadwal zona${sched}${names ? ' · ' + names : ''}`, actor, '');
}

const TX = { timeout: 60000, maxWait: 10000 };

// ── Reads ─────────────────────────────────────────────────────────────────────
async function listZones(actor) {
  const scope = fleetScopeOf(actor);
  const where = { active: { not: false }, ...(scope === null ? {} : { armada: { in: scope } }) };
  const custs = await prisma.customer.findMany({ where, select: { ...CUST_SELECT, phone: true, type: true } });
  const located = custs.filter(hasCoords);
  const bon = await dist().bonMapFor(located.map((c) => c.id));
  const zones = await loadZones();
  const count = {}, bonSum = {};
  located.forEach((c) => { if (c.zoneId) { count[c.zoneId] = (count[c.zoneId] || 0) + 1; bonSum[c.zoneId] = (bonSum[c.zoneId] || 0) + (bon[c.id] || 0); } });
  return {
    zones: zones.map((z) => Object.assign(z, { count: count[z.id] || 0, sisaBon: bonSum[z.id] || 0 })),
    customers: located.map((c) => ({
      id: c.id, code: c.code || '', name: c.name, phone: c.phone || '', type: c.type, lat: c.lat, lng: c.lng,
      zoneId: c.zoneId || null, zoneManual: !!c.zoneManual, armada: c.armada || '', deliveryDays: parseDays(c.deliveryDays), sisaBon: bon[c.id] || 0,
    })),
    coverage: { total: custs.length, withCoords: located.length, withoutCoords: custs.length - located.length },
    canManage: scope === null,
  };
}

// ── Zone writes ───────────────────────────────────────────────────────────────
async function createZone(body, actor) {
  assertCanManage(actor);
  const input = await cleanInput(body, { creating: true });
  const zones = await loadZones();
  const sortOrder = zones.reduce((m, z) => Math.max(m, z.sortOrder), 0) + 1;
  const draft = { id: NEW_ID, name: input.name, color: input.color || DZ.colorAt(zones.length), polygon: input.polygon, armada: input.armada || '', deliveryDays: input.deliveryDays || [], sortOrder };
  if (body.dryRun) {
    const all = zones.concat([draft]);
    const plan = await planFor(prisma, all);
    return { zone: null, applied: 0, changes: describe(plan, all) };
  }
  const snap = await dist().actorSnap(actor);
  const res = await prisma.$transaction(async (tx) => {
    const z = await tx.distZone.create({ data: { name: draft.name, color: draft.color, polygon: JSON.stringify(draft.polygon), armada: draft.armada, deliveryDays: JSON.stringify(draft.deliveryDays), sortOrder, createdByName: snap.actorName } });
    const all = await loadZones(tx);
    const plan = await planFor(tx, all);
    await applyPlan(tx, plan);
    return { zone: zoneClient(z), plan, all };
  }, TX);
  await audit(actor, `Zona dibuat: ${res.zone.name}`, res.plan, res.zone);
  return { zone: res.zone, applied: res.plan.length, changes: describe(res.plan, res.all) };
}

async function updateZone(id, body, actor) {
  assertCanManage(actor);
  const cur = await prisma.distZone.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Zona tidak ditemukan.');
  const input = await cleanInput(body, { creating: false });
  const zones = await loadZones();
  const next = zones.map((z) => (z.id === id ? Object.assign({}, z, input) : z));
  if (body.dryRun) {
    const plan = await planFor(prisma, next);
    return { zone: next.find((z) => z.id === id), applied: 0, changes: describe(plan, next) };
  }
  const data = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.color !== undefined) data.color = input.color;
  if (input.polygon !== undefined) data.polygon = JSON.stringify(input.polygon);
  if (input.armada !== undefined) data.armada = input.armada;
  if (input.deliveryDays !== undefined) data.deliveryDays = JSON.stringify(input.deliveryDays);
  const res = await prisma.$transaction(async (tx) => {
    const z = await tx.distZone.update({ where: { id }, data });
    const all = await loadZones(tx);
    const plan = await planFor(tx, all);
    await applyPlan(tx, plan);
    return { zone: zoneClient(z), plan, all };
  }, TX);
  await audit(actor, `Zona diubah: ${res.zone.name}`, res.plan, res.zone);
  return { zone: res.zone, applied: res.plan.length, changes: describe(res.plan, res.all) };
}

async function deleteZone(id, query, actor) {
  assertCanManage(actor);
  const cur = await prisma.distZone.findUnique({ where: { id } });
  if (!cur) throw ApiError.notFound('Zona tidak ditemukan.');
  const zones = await loadZones();
  const rest = zones.filter((z) => z.id !== id);
  // Hand-placed INTO this zone → back to their point (not "kept out of every zone", which is what a
  // bare SET NULL would silently turn them into).
  const release = (c) => (c.zoneManual && c.zoneId === id ? Object.assign({}, c, { zoneManual: false }) : c);
  if (query && (query.dryRun === '1' || query.dryRun === true)) {
    const plan = await planFor(prisma, rest, {}, release);
    return { applied: 0, changes: describe(plan, zones) };
  }
  const res = await prisma.$transaction(async (tx) => {
    // Plan BEFORE the delete: afterwards SET NULL has already emptied zoneId, and the change list
    // (and the audit count) would no longer show who left this zone.
    const plan = await planFor(tx, rest, {}, release);
    await tx.customer.updateMany({ where: { zoneId: id, zoneManual: true }, data: { zoneManual: false } });
    await tx.distZone.delete({ where: { id } });
    await applyPlan(tx, plan);
    return { plan };
  }, TX);
  await audit(actor, `Zona dihapus: ${cur.name}`, res.plan, null);
  return { applied: res.plan.length, changes: describe(res.plan, zones) };
}

// Place ONE customer by hand (zoneId, or null = keep out of every zone), or hand them back to their
// point (auto: true).
async function assignCustomer(body, actor) {
  assertCanManage(actor);
  const c = await prisma.customer.findUnique({ where: { id: String(body.customerId || '') }, select: CUST_SELECT });
  if (!c) throw ApiError.notFound('Pelanggan tidak ditemukan.');
  const zones = await loadZones();
  let manual, zoneId;
  if (body.auto) { manual = false; zoneId = c.zoneId; }
  else {
    manual = true; zoneId = body.zoneId || null;
    if (zoneId && !zones.find((z) => z.id === zoneId)) throw ApiError.badRequest('Zona tidak ditemukan.');
  }
  const override = (x) => Object.assign({}, x, { zoneManual: manual, zoneId });
  if (body.dryRun) {
    const plan = await planFor(prisma, zones, { id: c.id }, override);
    return { applied: 0, changes: describe(plan, zones) };
  }
  const res = await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: c.id }, data: { zoneManual: manual, zoneId } });
    const plan = await planFor(tx, zones, { id: c.id });
    await applyPlan(tx, plan);
    return { plan, row: await tx.customer.findUnique({ where: { id: c.id }, select: CUST_SELECT }) };
  }, TX);
  const zn = res.row.zoneId ? (zones.find((z) => z.id === res.row.zoneId) || {}).name : null;
  await dist().logDistAudit('pelanggan', `Pindah zona: ${c.name}`,
    body.auto ? `ikuti lokasi → ${zn || 'tanpa zona'}` : `${zn ? 'dipindah ke ' + zn : 'dikeluarkan dari semua zona'} (manual) · armada ${res.row.armada || '-'} · hari ${parseDays(res.row.deliveryDays).join(', ') || '-'}`, actor, '');
  return { applied: 1, customer: { id: c.id, zoneId: res.row.zoneId, zoneManual: res.row.zoneManual, armada: res.row.armada, deliveryDays: parseDays(res.row.deliveryDays) } };
}

// Group every located customer into k zones and REPLACE the current zones with them. Each new zone
// suggests the armada most of its customers already use, and leaves the days unset — changing
// everybody's delivery days is the owner's call, made per zone afterwards.
async function autoZones(body, actor) {
  assertCanManage(actor);
  const k = Math.max(1, Math.min(DZ.MAX_ZONES, parseInt(body.k, 10) || 1));
  const keepManual = body.keepManual !== false;
  const custs = await prisma.customer.findMany({ where: { active: { not: false } }, select: CUST_SELECT });
  const located = custs.filter(hasCoords);
  const groups = DZ.autoZones(located.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })), k);
  const byId = new Map(custs.map((c) => [c.id, c]));
  const drafts = groups.map((g, i) => {
    const tally = {};
    g.ids.forEach((id) => { const a = (byId.get(id).armada || '').trim(); if (a) tally[a] = (tally[a] || 0) + 1; });
    const armada = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || (a < b ? -1 : 1))[0] || '';
    return { id: '__auto_' + i, name: 'Zona ' + (i + 1), color: DZ.colorAt(i), polygon: g.polygon, armada, deliveryDays: [], sortOrder: i + 1, count: g.ids.length };
  });
  const existing = await loadZones();
  const gone = new Set(existing.map((z) => z.id));
  // Hand placements: kept (keepManual) unless they point at a zone this replaces; otherwise all reset.
  const override = (c) => {
    if (!c.zoneManual) return c;
    if (!keepManual) return Object.assign({}, c, { zoneManual: false });
    if (c.zoneId && gone.has(c.zoneId)) return Object.assign({}, c, { zoneManual: false });
    return c;
  };
  if (body.dryRun) {
    const plan = await planFor(prisma, drafts, {}, override);
    return {
      groups: drafts.map((d) => ({ name: d.name, color: d.color, polygon: d.polygon, armada: d.armada, count: d.count })),
      replaces: existing.length, withoutCoords: custs.length - located.length, applied: 0, changes: describe(plan, drafts),
    };
  }
  const snap = await dist().actorSnap(actor);
  const res = await prisma.$transaction(async (tx) => {
    if (!keepManual) await tx.customer.updateMany({ where: { zoneManual: true }, data: { zoneManual: false } });
    else if (gone.size) await tx.customer.updateMany({ where: { zoneManual: true, zoneId: { in: [...gone] } }, data: { zoneManual: false } });
    await tx.distZone.deleteMany({});
    for (const d of drafts) {
      await tx.distZone.create({ data: { name: d.name, color: d.color, polygon: JSON.stringify(d.polygon), armada: d.armada, deliveryDays: '[]', sortOrder: d.sortOrder, createdByName: snap.actorName } });
    }
    const all = await loadZones(tx);
    const plan = await planFor(tx, all);
    await applyPlan(tx, plan);
    return { plan, all };
  }, TX);
  await dist().logDistAudit('pelanggan', `Zona otomatis: ${drafts.length} zona`, `${existing.length ? 'mengganti ' + existing.length + ' zona lama · ' : ''}${res.plan.length} pelanggan ikut jadwal zona`, actor, '');
  return { zones: res.all, applied: res.plan.length, changes: describe(res.plan, res.all) };
}

// ── Hooks for the rest of distribusi ─────────────────────────────────────────
// After a customer's point (or hand placement) changes: put them in the right zone and apply its
// schedule. Returns the plan rows actually written.
async function syncCustomers(ids, actor) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return [];
  const zones = await loadZones();
  if (!zones.length) {
    // No zones at all: nobody can be in one. Only stale ids (from a since-deleted zone) need clearing.
    await prisma.customer.updateMany({ where: { id: { in: want }, zoneId: { not: null } }, data: { zoneId: null } });
    return [];
  }
  const plan = await planFor(prisma, zones, { id: { in: want } });
  if (!plan.length) return [];
  await applyPlan(prisma, plan);
  const names = {}; zones.forEach((z) => { names[z.id] = z.name; });
  for (const p of plan) {
    if (p.from.zoneId === p.to.zoneId && p.from.armada === p.to.armada) continue;
    await dist().logDistAudit('pelanggan', `Zona: ${p.name}`,
      `${p.from.zoneId ? names[p.from.zoneId] || '(zona lama)' : 'tanpa zona'} → ${p.to.zoneId ? names[p.to.zoneId] : 'tanpa zona'} · armada ${p.to.armada || '-'} · hari ${p.to.days.join(', ') || '-'}`, actor, p.to.armada);
  }
  return plan;
}

// A customer inside a zone that sets their armada/days cannot have those edited directly — the next
// zone write would silently undo it. Throws 409 naming the zone; same values (a full edit form) pass.
async function assertScheduleEditable(cur, data) {
  if (!cur.zoneId) return;
  const z = await prisma.distZone.findUnique({ where: { id: cur.zoneId } });
  if (!z) return;
  const zDays = parseDays(z.deliveryDays);
  const armadaLocked = z.armada && data.armada !== undefined && data.armada !== z.armada;
  const daysLocked = zDays.length && data.deliveryDays !== undefined && parseDays(data.deliveryDays).slice().sort().join() !== zDays.slice().sort().join();
  if (armadaLocked || daysLocked) {
    throw ApiError.conflict(`Jadwal pelanggan ini diatur oleh zona "${z.name}". Ubah armada/hari kirim di Peta Zona, atau keluarkan pelanggan dari zona.`);
  }
}

module.exports = { listZones, createZone, updateZone, deleteZone, assignCustomer, autoZones, syncCustomers, assertScheduleEditable };
