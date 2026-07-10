'use strict';
// GUDANG (warehouse) — generic, ledger-based inventory. Every item's stock is the SUM of its
// StockMovement rows (append-only); nothing is stored loose. Adding a goods type = inserting an
// InventoryItem. GALON is special: its number comes from the existing GallonMovement ledger
// (Distribusi > Stok Galon) so there is a SINGLE authoritative gallon figure — the Galon item
// here only carries a buffer threshold; its stock/movements are never written through this module.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const distribution = require('./distribution.service');

// Seed the built-in item catalogue (idempotent). New types can also be added at runtime.
const SEED_ITEMS = [
  { id: 'galon',   name: 'Galon',        kind: 'galon',  unit: 'galon', sortOrder: 1 },
  { id: 'sticker', name: 'Sticker',      kind: 'sticker', unit: 'pcs',  sortOrder: 2 },
  { id: 'tutup',   name: 'Tutup Galon',  kind: 'tutup',  unit: 'pcs',   sortOrder: 3 },
  { id: 'segel',   name: 'Segel Galon',  kind: 'segel',  unit: 'pcs',   sortOrder: 4 },
];
async function seedInventoryItems() {
  try {
    for (const it of SEED_ITEMS) {
      const existing = await prisma.inventoryItem.findUnique({ where: { id: it.id } });
      if (!existing) await prisma.inventoryItem.create({ data: it });
    }
  } catch (e) { /* table may not exist yet on very first migrate; ignored */ }
}

// Movement types. Directional types add or subtract a positive qty; correction is a signed delta.
const ADD_TYPES = ['opening', 'purchase', 'in'];
const OUT_TYPES = ['out', 'damage', 'loss', 'sale'];
const ALL_TYPES = [...ADD_TYPES, ...OUT_TYPES, 'correction'];
const KINDS = ['galon', 'sticker', 'tutup', 'segel', 'lainnya'];
const moveEffect = (m) => (m.type === 'correction' ? m.qty : (OUT_TYPES.includes(m.type) ? -Math.abs(m.qty) : Math.abs(m.qty)));

async function actorSnap(actor) {
  let name = null;
  if (actor && actor.id) { try { const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); name = u && u.name; } catch (e) {} }
  return { actorId: (actor && actor.id) || null, actorName: name, actorRole: (actor && actor.role) || null };
}

function itemClient(i, stock) {
  const needsRestock = i.bufferMin > 0 && stock <= i.bufferMin;   // only flag when a threshold is configured
  return { id: i.id, name: i.name, kind: i.kind, unit: i.unit, bufferMin: i.bufferMin, sortOrder: i.sortOrder, stock, needsRestock, managed: i.kind !== 'galon' };
}
function movClient(m, itemName) {
  return { id: m.id, itemId: m.itemId, itemName: itemName || null, type: m.type, qty: m.qty, effect: moveEffect(m), reason: m.reason, actorName: m.actorName, createdAt: m.createdAt ? new Date(m.createdAt).getTime() : null };
}

// Sum of ledger movements per (non-galon) item.
async function stockMap() {
  const movs = await prisma.stockMovement.findMany({ select: { itemId: true, type: true, qty: true } });
  const m = {}; movs.forEach((x) => { m[x.itemId] = (m[x.itemId] || 0) + moveEffect(x); });
  return m;
}
// Galon stock comes from the distribution gallon ledger — one authoritative number.
async function galonOwned(user) {
  try { const g = await distribution.gallonSummary(user); return (g && g.stock && g.stock.totalOwned) || 0; } catch (e) { return 0; }
}

// Warehouse dashboard: every item's stock + restock status, the "Perlu Restock" list, and the
// recent movement ledger.
async function gudangSummary(user) {
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  const map = await stockMap();
  const needGalon = items.some((i) => i.kind === 'galon');
  const galon = needGalon ? await galonOwned(user) : 0;
  const out = items.map((i) => itemClient(i, i.kind === 'galon' ? galon : (map[i.id] || 0)));
  const restock = out.filter((i) => i.needsRestock);
  const rows = await prisma.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const nameById = {}; items.forEach((i) => { nameById[i.id] = i.name; });
  const movements = rows.map((m) => movClient(m, nameById[m.itemId]));
  return { items: out, restock, movements };
}

async function getItem(id, user) {
  const i = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!i) throw ApiError.notFound('Item tidak ditemukan');
  const stock = i.kind === 'galon' ? await galonOwned(user) : (await stockMap())[i.id] || 0;
  const rows = i.kind === 'galon' ? [] : await prisma.stockMovement.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  return { ...itemClient(i, stock), movements: rows.map((m) => movClient(m, i.name)) };
}

// Create a new goods type (generic — "mudah menambah jenis").
async function createItem(body) {
  const name = String(body.name || '').trim();
  if (!name) throw ApiError.badRequest('Nama barang wajib diisi.');
  const kind = KINDS.includes(body.kind) ? body.kind : 'lainnya';
  if (kind === 'galon') throw ApiError.badRequest('Item galon sudah dikelola oleh sistem.');
  const unit = String(body.unit || 'pcs').trim() || 'pcs';
  const bufferMin = Math.max(0, Math.round(+body.bufferMin || 0));
  const id = 'inv_' + Math.random().toString(36).slice(2, 10);
  const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
  const item = await prisma.inventoryItem.create({ data: { id, name, kind, unit, bufferMin, sortOrder: (max._max.sortOrder || 0) + 1 } });
  return itemClient(item, 0);
}

// Edit an item's buffer / name / unit (never its computed stock).
async function updateItem(id, body) {
  const i = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!i) throw ApiError.notFound('Item tidak ditemukan');
  const data = {};
  if (body.bufferMin !== undefined) data.bufferMin = Math.max(0, Math.round(+body.bufferMin || 0));
  if (body.name !== undefined) { const n = String(body.name).trim(); if (n) data.name = n; }
  if (body.unit !== undefined) { const u = String(body.unit || '').trim(); if (u) data.unit = u; }
  const updated = await prisma.inventoryItem.update({ where: { id }, data });
  const stock = updated.kind === 'galon' ? await galonOwned({ role: 'owner' }) : (await stockMap())[id] || 0;
  return itemClient(updated, stock);
}

// Append a stock movement. `allowed` restricts which types this endpoint may write (so the
// damage/loss endpoint can be gated by a separate capability). Reason is always required.
async function addMovement(id, body, actor, allowed) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) throw ApiError.notFound('Item tidak ditemukan');
  if (item.kind === 'galon') throw ApiError.badRequest('Stok galon dikelola di Distribusi > Stok Galon agar angka galon tunggal & konsisten.');
  const type = String(body.type || '');
  if (!allowed.includes(type)) throw ApiError.badRequest('Tipe pergerakan tidak diizinkan di sini.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan/keterangan wajib diisi.');
  let qty = Math.round(+body.qty || 0);
  if (type === 'correction') { if (!qty) throw ApiError.badRequest('Koreksi tidak boleh 0.'); }
  else { qty = Math.abs(qty); if (qty <= 0) throw ApiError.badRequest('Jumlah harus lebih dari 0.'); }
  const snap = await actorSnap(actor);
  const mov = await prisma.stockMovement.create({ data: { itemId: id, type, qty, reason, refId: body.refId ? String(body.refId) : null, fleetId: '', actorId: snap.actorId, actorName: snap.actorName, actorRole: snap.actorRole } });
  const stock = (await stockMap())[id] || 0;
  return { movement: movClient(mov, item.name), stock, needsRestock: item.bufferMin > 0 && stock <= item.bufferMin };
}

// Report: per-item stock + movement counts by type, and the restock list. Read-only.
async function report(user) {
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }] });
  const movs = await prisma.stockMovement.findMany({ select: { itemId: true, type: true, qty: true } });
  const map = {}; const counts = {};
  movs.forEach((m) => { map[m.itemId] = (map[m.itemId] || 0) + moveEffect(m); (counts[m.itemId] = counts[m.itemId] || {})[m.type] = ((counts[m.itemId] || {})[m.type] || 0) + 1; });
  const galon = items.some((i) => i.kind === 'galon') ? await galonOwned(user) : 0;
  const rows = items.map((i) => ({ ...itemClient(i, i.kind === 'galon' ? galon : (map[i.id] || 0)), byType: counts[i.id] || {} }));
  return { items: rows, restock: rows.filter((r) => r.needsRestock) };
}

module.exports = {
  seedInventoryItems, gudangSummary, getItem, createItem, updateItem, addMovement, report,
  ADD_TYPES, OUT_TYPES, ALL_TYPES, KINDS,
};
