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
  { id: 'galon',        name: 'Galon',        kind: 'galon',        unit: 'galon', sortOrder: 1 },
  { id: 'galon_rusak',  name: 'Galon Rusak',  kind: 'galon_rusak',  unit: 'galon', sortOrder: 2 },
  { id: 'sticker',      name: 'Sticker',      kind: 'sticker',      unit: 'pcs',   sortOrder: 3 },
  { id: 'tutup',        name: 'Tutup Galon',  kind: 'tutup',        unit: 'pcs',   sortOrder: 4 },
  { id: 'segel',        name: 'Segel Galon',  kind: 'segel',        unit: 'pcs',   sortOrder: 5 },
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
const KINDS = ['galon', 'galon_rusak', 'sticker', 'tutup', 'segel', 'lainnya'];
const moveEffect = (m) => (m.type === 'correction' ? m.qty : (OUT_TYPES.includes(m.type) ? -Math.abs(m.qty) : Math.abs(m.qty)));

async function actorSnap(actor) {
  let name = null;
  if (actor && actor.id) { try { const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }); name = u && u.name; } catch (e) {} }
  return { actorId: (actor && actor.id) || null, actorName: name, actorRole: (actor && actor.role) || null };
}

function itemClient(i, stock) {
  const needsRestock = i.bufferMin > 0 && stock <= i.bufferMin;   // only flag when a threshold is configured
  return {
    id: i.id, name: i.name, kind: i.kind, unit: i.unit, form: i.form || '', description: i.description || '',
    photoId: i.photoId || null, bufferMin: i.bufferMin, sortOrder: i.sortOrder, stock, needsRestock,
    managed: i.kind !== 'galon',
    editedByName: i.editedByName || null, editedAt: i.editedAt ? new Date(i.editedAt).getTime() : null,
  };
}
function movClient(m, itemName) {
  return { id: m.id, itemId: m.itemId, itemName: itemName || null, type: m.type, qty: m.qty, effect: moveEffect(m), amount: m.amount != null ? m.amount : null, method: m.method || null, reason: m.reason, actorName: m.actorName, createdAt: m.createdAt ? new Date(m.createdAt).getTime() : null };
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
  // Damaged-gallon sale money — a dedicated figure, kept SEPARATE from normal water sales.
  const sales = await prisma.stockMovement.findMany({ where: { itemId: 'galon_rusak', type: 'sale' }, select: { qty: true, amount: true } });
  const rusakSales = { count: sales.length, qty: sales.reduce((a, s) => a + s.qty, 0), total: sales.reduce((a, s) => a + (s.amount || 0), 0) };
  return { items: out, restock, movements, rusakSales };
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
  if (kind === 'galon' || kind === 'galon_rusak') throw ApiError.badRequest('Item galon sudah dikelola oleh sistem.');
  const unit = String(body.unit || 'pcs').trim() || 'pcs';
  const bufferMin = Math.max(0, Math.round(+body.bufferMin || 0));
  const id = 'inv_' + Math.random().toString(36).slice(2, 10);
  const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
  const item = await prisma.inventoryItem.create({ data: { id, name, kind, unit, bufferMin, sortOrder: (max._max.sortOrder || 0) + 1 } });
  return itemClient(item, 0);
}

// Edit an item's DETAILS (name / unit / form / description / photo / buffer) — never its
// computed stock. The id is stable, so renaming can't break the ledger (movements key on
// itemId). Built-in items are editable here too; none are deletable (no delete endpoint).
// Records who edited + when for the audit.
async function updateItem(id, body, actor) {
  const i = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!i) throw ApiError.notFound('Item tidak ditemukan');
  const data = {};
  if (body.bufferMin !== undefined) data.bufferMin = Math.max(0, Math.round(+body.bufferMin || 0));
  if (body.name !== undefined) { const n = String(body.name).trim(); if (n) data.name = n; }
  if (body.unit !== undefined) { const u = String(body.unit || '').trim(); if (u) data.unit = u; }
  if (body.form !== undefined) data.form = String(body.form || '').trim().slice(0, 60);
  if (body.description !== undefined) data.description = String(body.description || '').trim().slice(0, 500);
  if (body.photoId !== undefined) data.photoId = body.photoId ? String(body.photoId) : null;
  if (Object.keys(data).length) {
    const snap = await actorSnap(actor);
    data.editedById = snap.actorId; data.editedByName = snap.actorName; data.editedAt = new Date();
  }
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

async function ensureGalonRusak() {
  const it = await prisma.inventoryItem.findUnique({ where: { id: 'galon_rusak' } });
  if (!it) await prisma.inventoryItem.create({ data: { id: 'galon_rusak', name: 'Galon Rusak', kind: 'galon_rusak', unit: 'galon', sortOrder: 2 } });
}

// Report broken/lost gallons (anti-fraud: reason mandatory, who/when/why recorded, optional
// evidence photo). Reduces GOOD gallon stock via the distribution ledger (single source). For
// recoverable damage (pecah/rusak) it also books the gallon INTO "Galon Rusak" so it can later
// be sold; a loss (hilang) is gone and books nothing extra.
async function reportGallonDamage(body, actor) {
  const kind = ['pecah', 'rusak', 'hilang'].includes(body.kind) ? body.kind : null;
  if (!kind) throw ApiError.badRequest('Jenis tidak valid (pecah/rusak/hilang).');
  const qty = Math.round(+body.qty || 0);
  if (qty <= 0) throw ApiError.badRequest('Jumlah galon harus lebih dari 0.');
  const reason = String(body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Alasan wajib diisi.');
  const culprit = String(body.culprit || '').trim();
  const fullReason = culprit ? `${reason} · pelaku: ${culprit}` : reason;
  // 1) reduce good gallon stock (+ distribusi audit) — authoritative, in the gallon ledger
  const good = await distribution.reportGallonDamage({ qty, kind, reason: fullReason, fleetId: body.fleet, proof: body.proof }, actor);
  // 2) recoverable damage → book into the sellable "Galon Rusak" inventory
  let rusak = null;
  if (kind !== 'hilang') {
    await ensureGalonRusak();
    const snap = await actorSnap(actor);
    const mov = await prisma.stockMovement.create({ data: { itemId: 'galon_rusak', type: 'in', qty, reason: `Dari laporan galon ${kind}: ${reason}`, refId: good.movement.id, fleetId: '', actorId: snap.actorId, actorName: snap.actorName, actorRole: snap.actorRole } });
    rusak = movClient(mov, 'Galon Rusak');
  }
  const rusakStock = (await stockMap()).galon_rusak || 0;
  return { kind, qty, goodStock: good.goodStock, rusak, rusakStock };
}

// Sell damaged gallons: reduce "Galon Rusak" stock (movement 'sale') + record the money as a
// SEPARATE figure (never mixed with normal water sales) + Distribusi audit. Reason optional,
// but qty/price/method captured. Cannot sell more than is in stock.
async function sellGalonRusak(body, actor) {
  await ensureGalonRusak();
  const qty = Math.round(+body.qty || 0);
  if (qty <= 0) throw ApiError.badRequest('Jumlah harus lebih dari 0.');
  const unitPrice = Math.max(0, Math.round(+body.price || 0));
  if (unitPrice <= 0) throw ApiError.badRequest('Harga harus lebih dari 0.');
  const method = ['Cash', 'Transfer', 'QRIS'].includes(body.method) ? body.method : 'Cash';
  const reason = String(body.reason || '').trim();
  const have = (await stockMap()).galon_rusak || 0;
  if (qty > have) throw ApiError.badRequest(`Stok galon rusak hanya ${have}.`, { stock: have });
  const amount = qty * unitPrice;
  const snap = await actorSnap(actor);
  const note = [reason, `${qty} × ${unitPrice}`, method].filter(Boolean).join(' · ');
  const mov = await prisma.stockMovement.create({ data: { itemId: 'galon_rusak', type: 'sale', qty, amount, method, reason: note, actorId: snap.actorId, actorName: snap.actorName, actorRole: snap.actorRole } });
  await distribution.logDistAudit('input', 'Jual galon rusak', `${qty} galon · ${amount} (${method})${reason ? ' · ' + reason : ''}`, actor, '');
  const stock = (await stockMap()).galon_rusak || 0;
  return { movement: movClient(mov, 'Galon Rusak'), stock, amount, method };
}

// ── Daily warehouse closeout (opname + day report) ───────────────────────────
// createdAt range for a calendar day (server-local). Used for the day summary counts.
function dayRange(date) {
  const start = new Date(date + 'T00:00:00.000');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { gte: start, lt: end };
}
// Informational day summary: gallons out/in from runs (rit), damage/loss, restock, rusak sales.
async function daySummary(date, user) {
  const runs = await prisma.deliveryRun.findMany({ where: { date }, select: { gallonsOut: true, gallonsFullReturned: true, gallonsEmptyReturned: true } });
  const range = dayRange(date);
  const gm = await prisma.gallonMovement.findMany({ where: { active: true, createdAt: range, type: { in: ['damage', 'loss', 'purchase'] } }, select: { type: true, qty: true } });
  const sm = await prisma.stockMovement.findMany({ where: { createdAt: range }, select: { itemId: true, type: true, qty: true, amount: true } });
  const sum = (a, k) => a.reduce((n, x) => n + (x[k] || 0), 0);
  const sale = sm.filter((m) => m.itemId === 'galon_rusak' && m.type === 'sale');
  return {
    runsOut: sum(runs, 'gallonsOut'), runsFullReturned: sum(runs, 'gallonsFullReturned'), runsEmptyReturned: sum(runs, 'gallonsEmptyReturned'), runsCount: runs.length,
    gallonDamage: gm.filter((m) => m.type === 'damage').reduce((a, m) => a + m.qty, 0),
    gallonLoss: gm.filter((m) => m.type === 'loss').reduce((a, m) => a + m.qty, 0),
    gallonPurchase: gm.filter((m) => m.type === 'purchase').reduce((a, m) => a + m.qty, 0),
    restock: sm.filter((m) => ['in', 'purchase', 'opening'].includes(m.type)).reduce((a, m) => a + m.qty, 0),
    stockDamageLoss: sm.filter((m) => ['damage', 'loss'].includes(m.type)).reduce((a, m) => a + m.qty, 0),
    rusakSales: { qty: sale.reduce((a, m) => a + m.qty, 0), total: sale.reduce((a, m) => a + (m.amount || 0), 0) },
  };
}
function closeoutClient(c) {
  let items = []; try { items = JSON.parse(c.items); } catch (e) {}
  let summary = {}; try { summary = JSON.parse(c.summary); } catch (e) {}
  return { id: c.id, date: c.date, closedByName: c.closedByName || null, closedAt: c.closedAt ? new Date(c.closedAt).getTime() : null, items, summary, note: c.note || '', diffCount: c.diffCount };
}
// Current system stock per item (galon from the gallon ledger; others from the stock ledger).
async function systemStock(user) {
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }] });
  const map = await stockMap();
  const galon = items.some((i) => i.kind === 'galon') ? await galonOwned(user) : 0;
  return items.map((i) => ({ itemId: i.id, name: i.name, unit: i.unit, kind: i.kind, system: i.kind === 'galon' ? galon : (map[i.id] || 0) }));
}
// Preview the closeout for a date: system numbers + day summary + whether already closed.
async function closeoutPreview(date, user) {
  const existing = await prisma.warehouseCloseout.findUnique({ where: { date } });
  return { date, closed: !!existing, closeout: existing ? closeoutClient(existing) : null, items: await systemStock(user), summary: await daySummary(date, user) };
}
// Close the warehouse for a date: confirm/opname each item. A physical ≠ system gap REQUIRES a
// reason and is posted as a correction (append, never a silent overwrite). One closeout per date.
async function closeWarehouse(body, actor) {
  const date = body.date;
  if (!date) throw ApiError.badRequest('Tanggal wajib diisi.');
  const existing = await prisma.warehouseCloseout.findUnique({ where: { date } });
  if (existing) throw ApiError.badRequest('Gudang sudah ditutup untuk tanggal ini.');
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }] });
  const map = await stockMap();
  const galon = items.some((i) => i.kind === 'galon') ? await galonOwned(actor) : 0;
  const inputs = {}; (Array.isArray(body.items) ? body.items : []).forEach((it) => { if (it && it.itemId) inputs[it.itemId] = it; });
  const snap = await actorSnap(actor);
  const rows = []; let diffCount = 0;
  for (const i of items) {
    const system = i.kind === 'galon' ? galon : (map[i.id] || 0);
    const inp = inputs[i.id] || {};
    const physical = inp.physical != null ? Math.max(0, Math.round(+inp.physical)) : system;   // default = confirm system
    const diff = physical - system;
    const reason = String(inp.reason || '').trim();
    if (diff !== 0 && !reason) throw ApiError.badRequest(`Selisih opname ${i.name} (${diff > 0 ? '+' : ''}${diff}) — alasan wajib diisi.`, { itemId: i.id, diff });
    if (diff !== 0) {
      diffCount++;
      // Post the correction so the ledger now matches the physical count (append-only, with reason).
      if (i.kind === 'galon') {
        await distribution.gallonCorrection({ qty: diff, reason: `Opname ${date}: ${reason}` }, actor);
      } else {
        await prisma.stockMovement.create({ data: { itemId: i.id, type: 'correction', qty: diff, reason: `Opname ${date}: ${reason}`, actorId: snap.actorId, actorName: snap.actorName, actorRole: snap.actorRole } });
      }
    }
    rows.push({ itemId: i.id, name: i.name, unit: i.unit, kind: i.kind, system, physical, diff, reason: diff !== 0 ? reason : '' });
  }
  const summary = await daySummary(date, actor);
  const co = await prisma.warehouseCloseout.create({ data: {
    date, closedById: snap.actorId, closedByName: snap.actorName, items: JSON.stringify(rows), summary: JSON.stringify(summary), note: String(body.note || '').slice(0, 500), diffCount,
  } });
  await distribution.logDistAudit('gudang', `Tutup gudang ${date}`, `${rows.length} item · ${diffCount} selisih opname${body.note ? ' · ' + String(body.note).slice(0, 120) : ''}`, actor, '');
  return closeoutClient(co);
}
// Report: recent closeouts (supervisors). Optionally by date.
async function listCloseouts(query) {
  const q = query || {};
  const where = {}; if (q.date) where.date = q.date;
  const rows = await prisma.warehouseCloseout.findMany({ where, orderBy: { closedAt: 'desc' }, take: 200 });
  return { data: rows.map(closeoutClient) };
}

module.exports = {
  seedInventoryItems, gudangSummary, getItem, createItem, updateItem, addMovement, report,
  reportGallonDamage, sellGalonRusak,
  closeoutPreview, closeWarehouse, listCloseouts,
  ADD_TYPES, OUT_TYPES, ALL_TYPES, KINDS,
};
