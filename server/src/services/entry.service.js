'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');            // ACCOUNTING v2 flag — live journal posting
const acc = require('./accounting.service');        // the double-entry posting service
const distribution = require('./distribution.service');   // gallon-purchase movement sync (intentional cash-flow ↔ distribusi link)
const businessUnit = require('./businessUnit.service');   // Stage 3: unit label on each entry (default "Air")
const period = require('./period.service');   // ACCOUNTING v2: reject edits in a closed period (flag-gated)
const { unitWhere, canAccessUnit, assertCanAccessUnit, writableUnitFor } = require('../lib/scope');   // per-user business-unit access (Stage A/B)
const FINSRC = require('../../../finance-entry-source.js');   // SHARED setoran/operasional predicate (same file the client bundles) — never duplicated

// WRITE-PATH GUARD (closes the "Belum dipetakan" root cause): the cash book keys an entry to its
// money-spot with the plain string Entry.acct. Historically that could be ANY string ("bca", "cash", a
// name from an import, or an id for an account that didn't exist yet) — with no FK, nothing rejected it,
// so a later account delete/rename orphaned those rows. Now every write validates a NON-EMPTY acct
// against a LIVE Account id. Blank/unset is still allowed (the client falls back to the primary account).
async function assertValidAcct(acct) {
  const a = acct == null ? '' : String(acct).trim();
  if (!a) return;
  // Enforce ONLY once an account list exists. A fresh/bootstrap install (or a legacy trial before accounts
  // were persisted server-side) has no rows to validate against, and the schema deliberately allowed an
  // account that lives only client-side — so with zero accounts we can't (and mustn't) reject. In
  // production the accounts are always synced first, so a non-matching acct is exactly the orphan bug.
  if ((await prisma.account.count()) === 0) return;
  const exists = await prisma.account.findUnique({ where: { id: a }, select: { id: true } });
  if (!exists) throw ApiError.badRequest(`Akun "${a}" tidak dikenal — pilih akun kas/bank yang ada (bukan nama atau id lama).`, { unknownAcct: a });
}

// Build a Prisma `where` clause from validated list filters.
function buildWhere(q) {
  const where = {};
  if (q.type) where.type = q.type;
  if (q.category) where.categoryKey = q.category;
  if (q.account) where.accountId = q.account;
  if (q.method) where.method = q.method;
  if (q.status) where.status = q.status;
  if (q.dateFrom || q.dateTo) {
    where.date = {};
    if (q.dateFrom) where.date.gte = q.dateFrom;
    if (q.dateTo) where.date.lte = q.dateTo;
  }
  if (q.since) where.updatedAt = { gte: new Date(q.since) };
  // Stage 3 unit filter. Every row is stamped (backfilled + create/update default to "Air"),
  // so an exact match is correct and complete; null-as-Air legacy rows can't exist post-Stage-3.
  if (q.businessUnit) where.businessUnitId = q.businessUnit;
  if (q.search) {
    where.OR = [
      { note: { contains: q.search } },
      { category: { contains: q.search } },
      { method: { contains: q.search } },
    ];
  }
  return where;
}

// Expose the creator as a { name, role } object built from the AT-INPUT-TIME
// snapshot columns (never the live User relation), so the label is historical.
function shapeCreator(entry) {
  if (!entry) return entry;
  const { createdByName, createdByRole, ...rest } = entry;
  return { ...rest, createdBy: createdByName ? { name: createdByName, role: createdByRole || null } : null };
}

async function list(q, user) {
  // Per-user unit access is enforced SERVER-SIDE: a user scoped to "air" cannot read another
  // unit's entries even by crafting ?businessUnit=mfg (the AND collapses to no rows).
  const where = { AND: [buildWhere(q), unitWhere(user)] };
  const page = q.page || 1;
  const limit = q.limit || 20;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { time: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.entry.count({ where }),
  ]);

  // Stamp every row with its source (setoran | operasional) via the SHARED predicate, and honour an
  // optional ?source= filter. The classifier is tag/meta-based (not a SQL column), so the filter is
  // applied after the query; the client loads the full set (limit 2000), so the page holds all rows.
  let data = items.map((e) => Object.assign(shapeCreator(e), { source: FINSRC.entrySource(e) }));
  let outTotal = total;
  if (q.source && q.source !== 'all') { data = data.filter((e) => e.source === q.source); outTotal = data.length; }

  return {
    data,
    now: new Date().toISOString(),   // lets the client run an incremental (?since=) poll
    pagination: { page, limit, total: outTotal, totalPages: Math.ceil(outTotal / limit) || 1 },
  };
}

async function getById(id, user) {
  const entry = await prisma.entry.findUnique({ where: { id } });
  if (!entry) throw ApiError.notFound('Entry not found');
  // Out-of-scope rows are 404 (not 403) — never reveal the existence of another unit's record.
  if (user && !canAccessUnit(user, entry.businessUnitId)) throw ApiError.notFound('Entry not found');
  return shapeCreator(entry);
}

// The creator is stamped from the AUTHENTICATED user (token → id), never from the
// request body, and the name/role are read from the DB at input time — so a client
// cannot forge who created a record, and the snapshot reflects the real user then.
async function create(data, actor) {
  await period.assertPeriodOpen(data.date, 'menambah transaksi');   // closed period → 400 (flag-gated)
  await assertValidAcct(data.acct);   // never persist an entry pointing at a non-existent account
  // Finance only creates OPERASIONAL entries. A setoran (deposit) belongs to the distribution flow;
  // accepting a parallel setoran record here is how double-counting starts (item 4). Reject it and
  // point the user to Distribusi → Setoran instead. Uses the shared predicate (meta/tag/id prefix).
  if (FINSRC.isSetoranEntry(data)) throw ApiError.badRequest('Setoran dicatat lewat Distribusi → Setoran, bukan di sini — supaya tidak tercatat dua kali.', { belongsTo: 'setoran' });

  const userId = actor && actor.id;
  const snap = { createdById: userId || null };
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (u) { snap.createdByName = u.name; snap.createdByRole = u.role; }
  }
  // Stage 3: stamp the unit label (defaults to "Air"; unknown ids fall back too). Stage B: a scoped
  // user may only create in a unit they can access — a specified out-of-scope unit is 403; an
  // unspecified unit lands in their first allowed unit instead of the "Air" default.
  const businessUnitId = writableUnitFor(actor, data.businessUnitId, await businessUnit.resolveUnitId(data.businessUnitId));
  await businessUnit.assertModuleEnabledForUser(actor, businessUnitId, 'finance');   // module toggle (full-access users bypass)
  // LIVE POSTING: the cash-book entry AND its double-entry journal are written in ONE transaction, so
  // a source can never exist without its journal and a failure rolls back both (flag-gated).
  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.entry.create({ data: { ...data, businessUnitId, ...snap } });
    if (config.accountingV2) await acc.postEntry(e, actor, tx);
    return e;
  });
  // A "Pembelian Galon" expense mirrors into the gallon ledger (purchase movement).
  if (entry.type === 'expense' && +entry.gallonQty > 0) await distribution.syncPurchaseMovement(entry.id, entry.gallonQty, actor);
  return shapeCreator(entry);
}

async function update(id, data, actor) {
  const cur = await getById(id, actor); // 404 if missing OR out of the actor's unit scope (Stage B)
  await period.assertPeriodOpen(cur.date, 'mengubah transaksi');   // can't edit an entry in a closed period
  if (data && data.date && data.date !== cur.date) await period.assertPeriodOpen(data.date, 'memindahkan transaksi');   // …nor move it into one
  // An inter-unit leg is half of a linked pair — editing it in isolation would desync the two
  // books. It must be voided (which reverses BOTH legs) and re-created, never patched.
  if (cur.interUnit) throw ApiError.badRequest('Transaksi antar-unit tidak bisa diedit — batalkan lalu buat ulang.');
  // Never let a PATCH overwrite the original creator snapshot (the fields aren't in
  // the update schema anyway, but strip defensively).
  const { createdById, createdByName, createdByRole, ...safe } = data;
  if (Object.prototype.hasOwnProperty.call(safe, 'acct')) await assertValidAcct(safe.acct);   // a PATCH can't repoint to a dead account
  // …nor turn an operasional entry INTO a setoran row (item 4 — one place to book a deposit).
  if (FINSRC.isSetoranEntry(safe)) throw ApiError.badRequest('Setoran dicatat lewat Distribusi → Setoran, bukan di sini — supaya tidak tercatat dua kali.', { belongsTo: 'setoran' });
  // Only re-resolve the unit when the request carries it, so a normal edit that omits it keeps
  // the entry's current unit (never silently reset to "Air"). Stage B: a scoped user can't MOVE a
  // record into a unit they can't access.
  if (safe.businessUnitId !== undefined) {
    safe.businessUnitId = await businessUnit.resolveUnitId(safe.businessUnitId);
    assertCanAccessUnit(actor, safe.businessUnitId);
  }
  // Module toggle: no finance write to a unit where finance is off (the target unit — the new one if
  // the edit moves it, else the entry's current unit).
  await businessUnit.assertModuleEnabledForUser(actor, safe.businessUnitId !== undefined ? safe.businessUnitId : cur.businessUnitId, 'finance');
  // An edited entry re-projects its journal in the SAME transaction. A cash-book entry is a directly
  // MUTABLE record (unlike an immutable dist txn), so its journal is replaced in place to stay in sync.
  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.entry.update({ where: { id }, data: safe });
    if (config.accountingV2) { await acc.deleteJournal('entry', e.id, tx); await acc.postEntry(e, actor, tx); }
    return e;
  });
  // Re-sync the gallon purchase movement (replace-on-change) so an edit never leaves
  // stock out of step; a non-gallon or income entry clears any prior movement.
  await distribution.syncPurchaseMovement(entry.id, (entry.type === 'expense' ? entry.gallonQty : 0), actor || { id: entry.createdById });
  return shapeCreator(entry);
}

async function remove(id) {
  const cur = await getById(id);
  await period.assertPeriodOpen(cur.date, 'menghapus transaksi');   // can't delete an entry in a closed period
  await distribution.retractPurchaseMovement(id);   // pull back any gallon stock this entry added
  // Deleting one leg of an inter-unit transfer deletes BOTH (atomic), so a leg is never orphaned
  // — whether removed here or via the dedicated void endpoint. The journal(s) go with them, in the
  // same transaction, so a deleted source can never leave an orphan journal behind.
  await prisma.$transaction(async (tx) => {
    if (cur.interUnit && cur.transferGroupId) {
      const legs = await tx.entry.findMany({ where: { transferGroupId: cur.transferGroupId, interUnit: true }, select: { id: true } });
      if (config.accountingV2) for (const l of legs) await acc.deleteJournal('entry', l.id, tx);
      await tx.entry.deleteMany({ where: { transferGroupId: cur.transferGroupId, interUnit: true } });
    } else {
      if (config.accountingV2) await acc.deleteJournal('entry', id, tx);
      await tx.entry.delete({ where: { id } });
    }
  });
}

module.exports = { list, getById, create, update, remove };
