'use strict';
const { z } = require('zod');
const service = require('../services/account.service');
const { replaceCollection } = require('../services/sync.service');
const prisma = require('../lib/prisma');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const bus = require('../lib/eventbus');

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['cash', 'bank']).optional().default('bank'),
  bank: z.string().max(60).optional().default(''),
  number: z.string().max(60).optional().default(''),
  opening: z.number().int().optional().default(0),
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().optional(),
  // Stage 3: the unit this money-spot belongs to. A real unit id, or 'shared' (Bersama) which
  // appears ONLY in the combined view so its balance is never double-counted. null → "Air".
  businessUnitId: z.string().max(60).nullable().optional(),
});
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.string().min(1) });

// Bulk replace-collection: each item carries its client id.
const syncSchema = z.object({
  items: z.array(createSchema.extend({ id: z.string().min(1) })).max(500),
});

const list = asyncHandler(async (req, res) => res.json({ data: await service.list(req.user) }));
const getOne = asyncHandler(async (req, res) => res.json({ data: await service.getById(req.params.id, req.user) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.body, req.user) }));
const update = asyncHandler(async (req, res) => res.json({ data: await service.update(req.params.id, req.body, req.user) }));
const remove = asyncHandler(async (req, res) => { await service.remove(req.params.id, req.user, req.query.reassignTo); res.status(204).send(); });
const balance = asyncHandler(async (req, res) => res.json({ data: await service.balance(req.params.id, req.user) }));
const sync = asyncHandler(async (req, res) => {
  // PREVENT ORPHANS: the bulk sync deletes any stored account absent from the incoming set. An account
  // still referenced by cash-book entries (Entry.acct — a plain string, NOT an FK, so nothing else
  // blocks it) must NEVER be dropped, or its entries dangle into "Belum dipetakan". Refuse the delete and
  // tell the caller to reassign the entries first (POST /entries/remap) — a guided migration, not a silent
  // history loss. (Editing/renaming an existing account is fine; only REMOVAL of a referenced one is blocked.)
  const items = req.body.items || [];
  const incoming = new Set(items.map((it) => it.id).filter(Boolean));
  const stored = await prisma.account.findMany({ select: { id: true, name: true } });
  const blocked = [];
  for (const a of stored) {
    if (incoming.has(a.id)) continue;                      // kept
    const n = await prisma.entry.count({ where: { acct: a.id } });
    if (n > 0) blocked.push({ id: a.id, name: a.name, entries: n });
  }
  if (blocked.length) {
    throw ApiError.conflict(
      `Akun ${blocked.map((b) => `"${b.name}" (${b.entries} transaksi)`).join(', ')} masih dipakai transaksi — pindahkan transaksinya ke akun lain dulu sebelum menghapus.`,
      { blocked },
    );
  }
  const data = await replaceCollection(prisma.account, req.body.items);
  bus.broadcast({ entity: 'config', action: 'accounts', id: null });
  res.json({ data });
});
// Remap every cash-book entry on a (usually orphaned/deleted) acct id to a LIVE account — the remediation
// for "Belum dipetakan". `dryRun` returns a preview (count + net) without writing. Never touches amounts or
// dates — only the corrupted account attribution — and posts nothing to the double-entry journal (which
// keys on chart-account codes, not this string), so verify-invariants is unaffected.
const remap = asyncHandler(async (req, res) => res.json({ data: await service.remapAccount(req.body, req.user) }));

const remapSchema = z.object({ fromAcct: z.string().min(1).max(80), toAcct: z.string().min(1).max(80), dryRun: z.boolean().optional() });
module.exports = { list, getOne, create, update, remove, balance, sync, remap, schemas: { createSchema, updateSchema, idParams, syncSchema, remapSchema } };
