'use strict';
const { z } = require('zod');
const service = require('../services/distribution.service');
const asyncHandler = require('../utils/asyncHandler');
const bus = require('../lib/eventbus');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const bcast = (action, id) => bus.broadcast({ entity: 'distribusi', action, id });

// ── validation schemas ──
const DAYS = z.array(z.string().max(4)).max(7);   // day codes; the service canonicalises them
const reminderSchema = z.object({
  enabled: z.boolean().optional(),
  dueDay: z.number().int().min(0).max(31).optional(),
  weekday: z.string().max(4).optional(),
  overdueDays: z.number().int().min(0).max(3650).optional(),
  gallonThreshold: z.number().int().min(0).optional(),
  bonThreshold: z.number().int().min(0).optional(),
}).nullable();
const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).optional().default(''),
  type: z.string().trim().min(1).max(60).optional().default('reguler'),   // CustomerType id (validated in the service)
  masterPrice: z.number().int().nonnegative().optional().default(0),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
  reminder: reminderSchema.optional(),
  address: z.string().max(300).optional(),
  mapsUrl: z.string().max(500).optional(),
  lat: z.union([z.number(), z.string(), z.null()]).optional(),
  lng: z.union([z.number(), z.string(), z.null()]).optional(),
  accuracy: z.union([z.number(), z.string(), z.null()]).optional(),
});
// Edit: every field optional; masterPrice is NOT accepted here (owner-gated price route).
const LATLNG = z.union([z.number(), z.string(), z.null()]).optional();
const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  deliveryDays: DAYS.optional(),
  armada: z.string().max(40).optional(),
  reminder: reminderSchema.optional(),
  address: z.string().max(300).optional(),
  mapsUrl: z.string().max(500).optional(),
  lat: LATLNG,
  lng: LATLNG,
});
// Field GPS tag / paste — coordinates required; accuracy (metres) + address optional.
const locationSchema = z.object({ lat: z.union([z.number(), z.string()]), lng: z.union([z.number(), z.string()]), accuracy: z.union([z.number(), z.string(), z.null()]).optional(), address: z.string().max(300).optional() });
const locationPhotoSchema = z.object({ photoId: z.string().max(60).nullable().optional() });
const importSchema = z.object({ customers: z.array(customerSchema.partial({ masterPrice: true, phone: true, type: true })).max(5000), skipped: z.number().int().nonnegative().optional() });
// Per-customer legacy (archive) transaction import — customerId comes from the route, NOT the body.
// Columns: Tanggal · Harga · Pembelian Lunas · Pembelian Bon · Pembayaran Bon · Catatan. A single
// row EXPANDS into 1–3 transactions (lunas + bon + pelunasan may all be present, same date). txnDate
// is intentionally lenient here (max 20) — the server re-parses it with the robust d/m/y parser and
// skips a row whose date is unparseable.
const legacyRow = z.object({
  txnDate: z.string().max(20),
  price: z.number().int().nonnegative().optional(),      // Harga (required for a purchase qty)
  lunasQty: z.number().int().optional(),                 // Pembelian Lunas (gallons)
  bonQty: z.number().int().optional(),                   // Pembelian Bon (gallons)
  paymentAmount: z.number().int().optional(),            // Pembayaran Bon (rupiah) → pelunasan
  note: z.string().max(300).optional(),
  // legacy shape kept accepted so an old client/paste still works (qty+method → lunas/bon).
  qty: z.number().int().optional(),
  method: z.enum(['lunas', 'bon']).optional(),
});
const legacyImportSchema = z.object({ rows: z.array(legacyRow).max(5000), skipped: z.number().int().nonnegative().optional(), includeBon: z.boolean().optional() });
const legacyBatchParams = z.object({ id: z.string().min(1), batchId: z.string().min(1) });
// scope null/omitted = option (a) new-only; 'all'|'cycle'|'bon' = option (b) retroactive.
const priceSchema = z.object({ newPrice: z.number().int().nonnegative(), scope: z.enum(['all', 'cycle', 'bon']).nullable().optional() });
const pricePreviewSchema = z.object({ newPrice: z.number().int().nonnegative() });
// Customer types (editable dictionary)
const typeCreateSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeRenameSchema = z.object({ label: z.string().trim().min(1).max(60) });
const typeDeleteQuery = z.object({ reassignTo: z.string().min(1).optional() });
// NOTE: no unitPrice/amount here — the server locks the price from master_price.
const txnSchema = z.object({
  customerId: z.string().min(1),
  qty: z.number().int().nonnegative().optional().default(0),   // 0 allowed for a standalone bon payment
  method: z.enum(['lunas', 'bon', 'pelunasan']).optional().default('lunas'),
  note: z.string().max(300).optional().default(''),
  txnDate: DATE,
  gallonOut: z.number().int().nonnegative().optional(),   // full gallons delivered (default = qty)
  gallonIn: z.number().int().nonnegative().optional(),    // empty gallons returned
  payAmount: z.number().int().nonnegative().optional(),   // method='pelunasan': bon payment amount
  payMethod: z.enum(['cash', 'transfer']).optional(),     // method='pelunasan': how it was paid
});
// Gallon stock: a correction is a SIGNED delta (may be negative); reason required.
const gallonCorrectionSchema = z.object({ qty: z.number().int(), customerId: z.string().min(1).optional(), reason: z.string().trim().min(1).max(300) });
const openingStockSchema = z.object({ qty: z.number().int().min(0), fleet: z.string().max(60).optional(), reason: z.string().trim().min(1).max(300) });
// Reset gallon count (GM). mode 'balanced' (append corrections to target) | 'purge' (delete ledger).
const gallonResetSchema = z.object({
  mode: z.enum(['balanced', 'purge']),
  fleet: z.string().max(60).optional(),
  target: z.number().int().min(0).optional(),        // balanced only (default 0)
  confirm: z.string().max(20).optional(),            // purge requires exactly "RESET"
  reason: z.string().trim().min(1).max(300),
});
const gallonQuery = z.object({ fleet: z.string().max(60).optional() });
// CORRECTION REQUEST — STRUCTURED, input-level fields (the server recomputes the total; the total is
// never edited directly). Which fields matter depends on the txn method: purchase (lunas|bon) uses
// qty/unitPrice/gallonOut/gallonIn; pelunasan uses amount. All optional here — the service validates
// the right set per method and rejects the rest. Submitting only creates a PENDING request.
const correctionSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  qty: z.number().int().nonnegative().optional(),
  unitPrice: z.number().int().nonnegative().optional(),
  gallonOut: z.number().int().nonnegative().optional(),
  gallonIn: z.number().int().nonnegative().optional(),
  amount: z.number().int().nonnegative().optional(),
  // METHOD change (bon ↔ lunas) on a PURCHASE. 'pelunasan' is never a valid target — a purchase can't
  // become a payment; the service also rejects it on a pelunasan/opening-bon row. Method-only changes
  // need no price cap; a price change in the SAME request still requires distribusiHargaMaster.
  method: z.enum(['lunas', 'bon']).optional(),
});
// VOID REQUEST — a mandatory reason. HARD DELETE — reason + typed confirmation (ref or "HAPUS") + password.
const voidSchema = z.object({ reason: z.string().trim().min(1, 'reason is required').max(1000) });
// Change-request inbox filter + the reject note (rejection requires a reason).
const changeReqQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), fleet: z.string().max(60).optional() });
const rejectSchema = z.object({ note: z.string().trim().min(1, 'note is required').max(1000) });
// Toggle a transaction between ARCHIVE (legacy=true) and ACTIVE (legacy=false); reason required.
const archiveSchema = z.object({ legacy: z.boolean(), bonCounted: z.boolean().optional(), reason: z.string().trim().min(1, 'reason is required').max(1000) });
// PELUNASAN TIDAK DITERIMA — the customer paid but the money never reached the company. Reason and a
// responsible staff member are mandatory (a loss with nobody attached is not reportable); the staff
// may be a system user id or a typed name. `note` is the only field that ever prints for the
// customer, so the internal reason is a SEPARATE field the statement never reads.
const pnrSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().int().positive(),
  txnDate: DATE,
  responsibleUserId: z.string().min(1).max(60).optional(),
  responsibleName: z.string().trim().max(120).optional(),
  lossReason: z.string().trim().min(1, 'lossReason is required').max(500),
  lossPhotoId: z.string().max(60).optional(),
  note: z.string().max(300).optional(),
});
const lossQuery = z.object({ period: z.enum(['today', 'week', 'month', 'range']).optional(), date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional() });
// TRANSACTION DISPUTE — raise a dispute on an existing transaction. `note` is mandatory; the
// customer-acknowledged amount may be 0 (the whole nota is disputed). resolution picks the outcome.
const disputeSchema = z.object({
  // Alasan is OPTIONAL — null/absent is accepted and stored as "no reason" (never a fake default).
  reason: z.enum(['nota_fiktif', 'galon_tidak_diterima', 'nominal_beda', 'pembayaran_tidak_disetor', 'pelanggan_menyangkal', 'lainnya']).nullable().optional(),
  resolution: z.enum(['staf', 'perusahaan', 'investigasi']).optional(),
  customerClaimAmount: z.number().int().min(0).optional(),
  note: z.string().trim().min(1, 'note is required').max(500),          // the only required field
  evidenceUrl: z.string().trim().max(500).optional(),                    // validated as a URL in the service
  staffUserId: z.string().max(60).optional(),
  staffName: z.string().trim().max(120).optional(),
});
const disputeApproveSchema = z.object({ resolution: z.enum(['staf', 'perusahaan']).optional() });
// KERUGIAN void / delete. `source` (pnr|dispute) disambiguates which underlying record the id refers
// to. void needs a reason (dropdown) + note; hard delete needs a typed confirm (amount or ref).
const kerugianQuery = z.object({ source: z.enum(['pnr', 'dispute']).optional() });
const kerugianVoidSchema = z.object({ reason: z.enum(['salah_input', 'sudah_tertagih', 'duplikat', 'salah_penilaian', 'lainnya']), note: z.string().trim().min(1, 'note is required').max(500) });
const kerugianDeleteSchema = z.object({ confirm: z.string().trim().min(1).max(60) });
const kerugianNoteSchema = z.object({ note: z.string().trim().max(500) });
const kerugianBulkSchema = z.object({ items: z.array(z.union([z.string().min(1), z.object({ id: z.string().min(1), source: z.enum(['pnr', 'dispute']).optional() })])).min(1).max(100) });
const hardDeleteSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(1000),
  confirm: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
});
// BULK removal (batal · arsip · hapus): a preview + an execute + a restore.
const bulkTxnPreviewSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200), action: z.enum(['batal', 'arsip', 'hapus']) });
const bulkTxnSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200), action: z.enum(['batal', 'arsip', 'hapus']), note: z.string().trim().min(1).max(1000), reason: z.string().trim().max(1000).optional(), confirm: z.string().max(40).optional() });
const bulkRestoreSchema = z.object({ batchId: z.string().min(1).max(60) });
const listTxnQuery = z.object({
  date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(),
  customerId: z.string().optional(), method: z.enum(['lunas', 'bon', 'pelunasan']).optional(),
  fleet: z.string().max(60).optional(),
});
const auditQuery = z.object({ kind: z.enum(['koreksi', 'harga', 'input', 'impor', 'pelanggan', 'akses', 'batal-massal', 'arsip-massal', 'hapus-massal']).optional(), limit: z.coerce.number().int().positive().max(2000).optional(), fleet: z.string().max(60).optional() });
const summaryQuery = z.object({ date: DATE.optional(), period: z.enum(['today', 'week', 'month', 'range']).optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional() });
// Delivery report (Laporan Pengiriman) — a date or range + fleet. Read-only, server-cap-gated.
const deliveryReportQuery = z.object({ period: z.enum(['today', 'week', 'month', 'range']).optional(), date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional() });
const cashIntegQuery = z.object({ dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional() });
const boardQuery = z.object({ date: DATE, fleet: z.string().max(60).optional() });
const orderSchema = z.object({ customerId: z.string().min(1), date: DATE, qty: z.number().int().nonnegative().optional(), note: z.string().max(300).optional() });
const markSchema = z.object({ status: z.enum(['pending', 'terkirim', 'batal']), transactionId: z.string().min(1).optional() });
const reorderSchema = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional(), order: z.array(z.string().min(1)).max(2000) });
const closeSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), generalNote: z.string().max(500).optional(), reasons: z.record(z.string().max(300)).optional() });
const closeoutQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional() });
// Delivery runs (rit)
const runOpenSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), gallonsOut: z.number().int().positive(), note: z.string().max(300).optional() });
const runCloseSchema = z.object({ gallonsFullReturned: z.number().int().nonnegative(), gallonsEmptyReturned: z.number().int().nonnegative(), diffReason: z.string().max(300).optional() });
// Koreksi Rit (append-only): CORRECTED absolute value(s) for muat/isi-kembali/kosong + a required
// reason. At least one field must be present (enforced in the service via a zero-change check).
const runCorrectionSchema = z.object({ out: z.number().int().nonnegative().optional(), full: z.number().int().nonnegative().optional(), empty: z.number().int().nonnegative().optional(), reason: z.string().min(1).max(300) });
const runQuery = z.object({ date: DATE.optional(), fleet: z.string().max(60).optional(), status: z.enum(['open', 'closed']).optional() });
// Field expenses (pengeluaran lapangan). Amount + category required; a receipt photoId (Attachment
// ref) is optional. Void takes a mandatory reason (append-only correction, never a silent delete).
const expenseSchema = z.object({ date: DATE, fleet: z.string().max(60).optional(), amount: z.number().int().positive(), category: z.string().min(1).max(40), method: z.enum(['tunai', 'transfer']).optional(), recipient: z.string().max(120).optional(), note: z.string().max(300).optional(), photoId: z.string().max(60).optional(), businessUnitId: z.string().max(60).optional() });
const expenseVoidSchema = z.object({ reason: z.string().min(1).max(300) });
const expenseQuery = z.object({ date: DATE.optional(), dateFrom: DATE.optional(), dateTo: DATE.optional(), fleet: z.string().max(60).optional(), status: z.enum(['active', 'void']).optional() });
// Customer list + detailed multi-criteria filter. Every criterion is optional and they
// combine with AND. Kept as query params so the list stays a plain cacheable GET.
// Opening / carry-over bon (cap: distribusiKoreksi). Nominal + the date the admin picks +
// a mandatory keterangan. It is stored as a real bon, so it counts toward sisa bon.
const openingBonSchema = z.object({
  amount: z.number().int().positive(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(300),
});
// Balance ADJUSTMENT (penyesuaian): correct gallons-held or outstanding bon. Exactly ONE of
// value (mode=set) / delta (mode=delta). Server re-reads the system value + re-computes before/after.
const ADJ_REASON = z.enum(['rekonsiliasi_fisik', 'salah_input', 'galon_pecah_hilang', 'penghapusan_piutang', 'selisih_staf', 'lainnya']);
const adjustCreateSchema = z.object({
  kind: z.enum(['galon', 'bon']),
  mode: z.enum(['set', 'delta']),
  value: z.number().int().optional(),      // target (mode=set)
  delta: z.number().int().optional(),      // +/- change (mode=delta)
  reason: ADJ_REASON,
  note: z.string().max(500).optional(),
  evidenceUrl: z.string().max(500).optional(),
}).refine((d) => (d.mode === 'set' ? d.value != null : d.delta != null), { message: 'value (set) atau delta (delta) wajib diisi' });
const adjustReportQuery = z.object({
  period: z.enum(['today', 'week', 'month', 'range']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fleet: z.string().max(60).optional(),
  reason: ADJ_REASON.optional(),
  kind: z.enum(['galon', 'bon']).optional(),
  status: z.enum(['pending', 'approved', 'reversed']).optional(),
  userId: z.string().max(60).optional(),
});
const custListQuery = z.object({
  fleet: z.string().max(60).optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
  q: z.string().max(80).optional(),                       // name / phone / code
  types: z.string().max(400).optional(),                  // CSV of CustomerType ids
  bon: z.enum(['ada', 'lunas']).optional(),
  bonMin: z.coerce.number().int().min(0).optional(),      // sisa bon ≥ N
  days: z.string().max(60).optional(),                    // CSV of day codes (Sen…Min)
  daysMode: z.enum(['any', 'all']).optional(),
  complete: z.enum(['lengkap', 'belum']).optional(),
  hasLocation: z.enum(['ya', 'tidak']).optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
});
const idParams = z.object({ id: z.string().min(1) });
const batchParams = z.object({ batchId: z.string().min(1) });
const invoiceCreateSchema = z.object({
  scope: z.enum(['unpaidBon', 'period', 'selected']).optional(),
  transactionIds: z.array(z.string().min(1)).max(2000).optional(),
  dateFrom: DATE.optional(), dateTo: DATE.optional(),
  dueDate: z.union([DATE, z.literal('')]).optional(),
  note: z.string().max(500).optional(),
});

// ── customers ──
const createOpeningBon = asyncHandler(async (req, res) => res.status(201).json({ data: await service.createOpeningBon(req.params.id, req.body, req.user) }));
// Balance adjustments (penyesuaian)
const createAdjustment = asyncHandler(async (req, res) => { const a = await service.createAdjustment(req.params.id, req.body, req.user); bcast('update', req.params.id); res.status(201).json({ data: a }); });
const listAdjustments = asyncHandler(async (req, res) => res.json({ data: await service.listCustomerAdjustments(req.params.id, req.user) }));
const approveAdjustment = asyncHandler(async (req, res) => { const a = await service.approveAdjustment(req.params.id, req.user); bcast('update', a.customerId); res.json({ data: a }); });
const reverseAdjustment = asyncHandler(async (req, res) => { const a = await service.reverseAdjustment(req.params.id, req.user); bcast('update', a.customerId); res.json({ data: a }); });
const adjustmentReport = asyncHandler(async (req, res) => res.json(await service.adjustmentReport(req.user, req.query)));
const listCustomers = asyncHandler(async (req, res) => res.json(await service.listCustomers(req.user, req.query.fleet, req.query.status, req.query)));
const getCustomer = asyncHandler(async (req, res) => res.json({ data: await service.getCustomer(req.params.id, req.user) }));
const createCustomer = asyncHandler(async (req, res) => { const c = await service.createCustomer(req.body, req.user); bcast('create', c.id); res.status(201).json({ data: c }); });
const updateCustomer = asyncHandler(async (req, res) => { const c = await service.updateCustomer(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const setLocation = asyncHandler(async (req, res) => { const c = await service.setCustomerLocation(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const setLocationPhoto = asyncHandler(async (req, res) => { const c = await service.setLocationPhoto(req.params.id, req.body, req.user); bcast('update', c.id); res.json({ data: c }); });
const importCustomers = asyncHandler(async (req, res) => { const r = await service.importCustomers(req.body.customers, req.user, req.body.skipped); bcast('import', 'customers'); res.status(201).json(r); });
const importLegacyTxns = asyncHandler(async (req, res) => { const r = await service.importLegacyTransactions(req.params.id, req.body.rows, req.user, req.body.skipped, req.body.includeBon); bcast('update', req.params.id); res.status(201).json(r); });
const undoLegacyBatch = asyncHandler(async (req, res) => { const r = await service.undoLegacyBatch(req.params.id, req.params.batchId, req.user); bcast('update', req.params.id); res.json({ data: r }); });
const updatePrice = asyncHandler(async (req, res) => { const c = await service.updatePrice(req.params.id, req.body.newPrice, req.user, req.body.scope); bcast('price', c.id); res.json({ data: c }); });
const pricePreview = asyncHandler(async (req, res) => res.json({ data: await service.pricePreview(req.params.id, req.body.newPrice, req.user) }));
const cancelPriceAdjustment = asyncHandler(async (req, res) => { const r = await service.cancelPriceAdjustment(req.params.batchId, req.user); bcast('price', req.params.batchId); res.json({ data: r }); });
// Customer deactivate (soft, reversible) / reactivate / hard delete — all gated distribusiCustomerDelete.
const deactivateCustomer = asyncHandler(async (req, res) => { const c = await service.deactivateCustomer(req.params.id, req.user); bcast('deactivate', c.id); res.json({ data: c }); });
const reactivateCustomer = asyncHandler(async (req, res) => { const c = await service.reactivateCustomer(req.params.id, req.user); bcast('reactivate', c.id); res.json({ data: c }); });
const deleteCustomer = asyncHandler(async (req, res) => { const r = await service.deleteCustomer(req.params.id, req.user); bcast('delete', req.params.id); res.json(r); });

// ── customer types (editable dictionary) ──
const listTypes = asyncHandler(async (req, res) => res.json(await service.listTypes()));
const createType = asyncHandler(async (req, res) => { const t = await service.createType(req.body, req.user); bcast('type', t.id); res.status(201).json({ data: t }); });
const updateType = asyncHandler(async (req, res) => { const t = await service.renameType(req.params.id, req.body, req.user); bcast('type', t.id); res.json({ data: t }); });
const deleteType = asyncHandler(async (req, res) => { const r = await service.deleteType(req.params.id, req.query.reassignTo, req.user); bcast('type', req.params.id); res.json({ data: r }); });

// ── transactions ── (immutable; price locked server-side)
const listTransactions = asyncHandler(async (req, res) => res.json(await service.listTransactions(req.query, req.user)));
const createTransaction = asyncHandler(async (req, res) => { const t = await service.createTransaction(req.body, req.user); bcast('create', t.id); res.status(201).json({ data: t }); });
// A correction/void no longer applies immediately — it creates a PENDING request (distribusiKoreksi /
// distribusiVoid are now REQUEST rights). Approving them needs the separate distribusiApprove.
const requestCorrection = asyncHandler(async (req, res) => { const r = await service.requestChange(req.params.id, 'correction', req.body, req.user); bcast('changereq', req.params.id); res.status(201).json({ data: r }); });
const requestVoid = asyncHandler(async (req, res) => { const r = await service.requestChange(req.params.id, 'void', req.body, req.user); bcast('changereq', req.params.id); res.status(201).json({ data: r }); });
const listChangeRequests = asyncHandler(async (req, res) => res.json(await service.listChangeRequests(req.user, req.query)));
const approveChangeRequest = asyncHandler(async (req, res) => { const r = await service.decideChangeRequest(req.params.id, 'approve', req.body, req.user); bcast('changereq', req.params.id); res.json({ data: r }); });
const rejectChangeRequest = asyncHandler(async (req, res) => { const r = await service.decideChangeRequest(req.params.id, 'reject', req.body, req.user); bcast('changereq', req.params.id); res.json({ data: r }); });
const setTransactionArchive = asyncHandler(async (req, res) => { const t = await service.setTransactionArchive(req.params.id, req.body.legacy, req.body, req.user); bcast('archive', req.params.id); res.json({ data: t }); });
const hardDeleteTransaction = asyncHandler(async (req, res) => { const r = await service.hardDeleteTransaction(req.params.id, req.body, req.user); bcast('delete', req.params.id); res.json({ data: r }); });
const bulkTxnPreview = asyncHandler(async (req, res) => { res.json({ data: await service.bulkTxnPreview(req.body.ids, req.body.action, req.user) }); });
const bulkTxn = asyncHandler(async (req, res) => { const r = await service.bulkExecuteTransactions(req.body.ids, req.body.action, req.body, req.user); bcast('txn', 'bulk'); res.json({ data: r }); });
const bulkTxnRestore = asyncHandler(async (req, res) => { const r = await service.restoreBulk(req.body.batchId, req.user); bcast('txn', 'restore'); res.json({ data: r }); });

// ── invoices / notas ──
const createInvoice = asyncHandler(async (req, res) => { const inv = await service.createInvoice(req.params.id, req.body, req.user); bcast('invoice', inv.id); res.status(201).json({ data: inv }); });
const listInvoices = asyncHandler(async (req, res) => res.json(await service.listInvoices(req.params.id, req.user)));
const getInvoice = asyncHandler(async (req, res) => res.json({ data: await service.getInvoice(req.params.id, req.user) }));
// ── Invoice sharing (signed link + dispatch log) ──
const share = require('../services/invoiceShare.service');
const invoiceLink = asyncHandler(async (req, res) => res.json({ data: await share.createLink(req.params.id, req.user, req) }));
const invoiceRevoke = asyncHandler(async (req, res) => res.json({ data: await share.revokeLinks(req.params.id, req.user) }));
const invoiceDispatch = asyncHandler(async (req, res) => res.status(201).json({ data: await share.logDispatch(req.body, req.user) }));
const invoiceDispatches = asyncHandler(async (req, res) => res.json({ data: await share.listDispatches(req.query) }));
const dispatchSchema = z.object({ invoiceId: z.string().min(1), phone: z.string().min(3).max(30), channel: z.string().max(12).optional(), messageSnapshot: z.string().max(2000).optional(), linkUrl: z.string().max(500).optional(), linkExpiresAt: z.coerce.number().optional() });
const dispatchQuery = z.object({ invoiceId: z.string().optional(), customerId: z.string().optional() });

// ── audit + dashboard ──
const listAudit = asyncHandler(async (req, res) => res.json(await service.listAudit(req.query, req.user)));
const dashboardSummary = asyncHandler(async (req, res) => res.json({ data: await service.dashboardSummary(req.user, req.query) }));
const deliveryReport = asyncHandler(async (req, res) => res.json({ data: await service.deliveryReport(req.user, req.query) }));
const createPaymentNotReceived = asyncHandler(async (req, res) => { const t = await service.createPaymentNotReceived(req.body, req.user); bcast('txn', t.id); res.status(201).json({ data: t }); });
const lossReport = asyncHandler(async (req, res) => res.json({ data: await service.lossReport(req.user, req.query) }));
const raiseDispute = asyncHandler(async (req, res) => { const d = await service.raiseDispute(req.params.id, req.body, req.user); bcast('txn', d.customerId); res.status(201).json({ data: d }); });
const approveDispute = asyncHandler(async (req, res) => { const d = await service.approveDispute(req.params.id, req.body, req.user); bcast('txn', d.customerId); res.json({ data: d }); });
const reverseDispute = asyncHandler(async (req, res) => { const d = await service.reverseDispute(req.params.id, req.user); bcast('txn', d.customerId); res.json({ data: d }); });
const kerugianImpact = asyncHandler(async (req, res) => res.json({ data: await service.kerugianImpact(req.params.id, req.query.source, req.user) }));
const voidKerugian = asyncHandler(async (req, res) => { const r = await service.voidKerugian(req.params.id, req.query.source, req.body, req.user); bcast('txn', r.id); res.json({ data: r }); });
const hardDeleteKerugian = asyncHandler(async (req, res) => { const r = await service.hardDeleteKerugian(req.params.id, req.query.source, req.body, req.user); bcast('txn', r.id); res.json({ data: r }); });
const bulkDeleteKerugian = asyncHandler(async (req, res) => { const r = await service.bulkDeleteKerugian(req.body.items, req.user); bcast('txn', 'bulk'); res.json({ data: r }); });
const editKerugianNote = asyncHandler(async (req, res) => { const r = await service.editKerugianNote(req.params.id, req.query.source, req.body, req.user); bcast('txn', r.id); res.json({ data: r }); });
const billingReminders = asyncHandler(async (req, res) => res.json(await service.billingReminders(req.user, req.query.fleet, req.query.date)));
const cashIntegration = asyncHandler(async (req, res) => res.json({ data: await service.cashIntegration(req.user, req.query) }));

// ── Delivery board ──
const deliveryBoard = asyncHandler(async (req, res) => res.json(await service.deliveryBoard(req.user, req.query.date, req.query.fleet)));
const addOrder = asyncHandler(async (req, res) => {
  const { delivery, fleetId } = await service.addOrder(req.body, req.user);
  // Notify the fleet's crew (AlertBell) + refresh open boards — carry fleetId so a scoped
  // helper's client can tell whether the new order is for them.
  bus.broadcast({ entity: 'distribusi', action: 'order', id: delivery.id, fleetId });
  res.status(201).json({ data: delivery });
});
const markDelivery = asyncHandler(async (req, res) => { const r = await service.markDelivery(req.params.id, req.body, req.user); bcast('delivery', req.params.id); res.json(r); });
const reorderDeliveries = asyncHandler(async (req, res) => { const r = await service.reorderDeliveries(req.user, req.body); bcast('delivery', 'reorder'); res.json({ data: r }); });
const closeDay = asyncHandler(async (req, res) => {
  const r = await service.closeDay(req.user, req.body);
  // Notify the fleet's admins/atasan (AlertBell) when the day is closed with undelivered
  // stops — carry the pending count + fleet so a scoped viewer can filter.
  bus.broadcast({ entity: 'distribusi', action: 'closeout', id: r.closeout.id, fleetId: r.fleetId, pending: r.pending });
  res.status(201).json({ data: r.closeout });
});
const listCloseouts = asyncHandler(async (req, res) => res.json(await service.listCloseouts(req.user, req.query)));

// ── Delivery runs (rit) ──
const openRun = asyncHandler(async (req, res) => { const r = await service.openRun(req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.status(201).json({ data: r }); });
const closeRun = asyncHandler(async (req, res) => { const r = await service.closeRun(req.params.id, req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.json({ data: r }); });
const correctRun = asyncHandler(async (req, res) => { const r = await service.correctRun(req.params.id, req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'run', id: r.id, fleetId: r.fleetId }); res.json({ data: r }); });
const listRuns = asyncHandler(async (req, res) => res.json(await service.listRuns(req.user, req.query)));

// ── Field expenses (pengeluaran lapangan) ──
const listExpenses = asyncHandler(async (req, res) => res.json(await service.listExpenses(req.user, req.query)));
const createExpense = asyncHandler(async (req, res) => { const e = await service.createExpense(req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'expense', id: e.id, fleetId: e.fleetId }); res.status(201).json({ data: e }); });
const voidExpense = asyncHandler(async (req, res) => { const e = await service.voidExpense(req.params.id, req.body, req.user); bus.broadcast({ entity: 'distribusi', action: 'expense', id: e.id, fleetId: e.fleetId }); res.json({ data: e }); });
const expenseCats = asyncHandler(async (req, res) => res.json({ data: service.DEFAULT_EXP_CATS }));

// ── gallon stock ──
const gallonSummary = asyncHandler(async (req, res) => res.json({ data: await service.gallonSummary(req.user, req.query.fleet) }));
const gallonCorrection = asyncHandler(async (req, res) => { const m = await service.gallonCorrection(req.body, req.user); bcast('gallon', m.id); res.status(201).json({ data: m }); });
const setOpeningStock = asyncHandler(async (req, res) => { const r = await service.setOpeningStock(req.body, req.user); bcast('gallon', 'opening'); res.status(201).json({ data: r }); });
const resetGallon = asyncHandler(async (req, res) => { const r = await service.resetGallon(req.body, req.user); bcast('gallon', 'reset'); res.status(201).json({ data: r }); });
// Depot gallon-stock entry void / restore / hard-delete + reset-stok-awal (customerId=null rows only).
const gallonMovementImpact = asyncHandler(async (req, res) => res.json({ data: await service.gallonMovementImpact(req.params.id, req.user) }));
const gallonMovementVoid = asyncHandler(async (req, res) => { const r = await service.voidGallonMovement(req.params.id, req.body, req.user); bcast('gallon', req.params.id); res.json({ data: r }); });
const gallonMovementRestore = asyncHandler(async (req, res) => { const r = await service.restoreGallonMovement(req.params.id, req.body, req.user); bcast('gallon', req.params.id); res.json({ data: r }); });
const gallonMovementDelete = asyncHandler(async (req, res) => { const r = await service.hardDeleteGallonMovement(req.params.id, req.body, req.user); bcast('gallon', req.params.id); res.json({ data: r }); });
const openingResetImpact = asyncHandler(async (req, res) => res.json({ data: await service.openingResetImpact(req.query, req.user) }));
const openingReset = asyncHandler(async (req, res) => { const r = await service.resetOpeningStock(req.body, req.user); bcast('gallon', 'opening-reset'); res.status(201).json({ data: r }); });
const gallonVoidSchema = z.object({ note: z.string().trim().min(1).max(500), reason: z.enum(['salah_input', 'duplikat', 'uji_coba', 'lainnya']).optional() });
const gallonRestoreSchema = z.object({ note: z.string().trim().max(500).optional() });
const gallonMovDeleteSchema = z.object({ note: z.string().trim().min(1).max(500) });
const openingResetSchema = z.object({ mode: z.enum(['delta', 'void_all']).optional(), targetQty: z.coerce.number().int().min(0).optional(), fleetId: z.string().max(60).optional(), note: z.string().trim().min(1).max(500), confirm: z.string().max(30).optional() });
const openingResetImpactSchema = z.object({ mode: z.enum(['delta', 'void_all']).optional(), targetQty: z.coerce.number().int().min(0).optional(), fleetId: z.string().max(60).optional() });

module.exports = {
  listCustomers, getCustomer, createCustomer, createOpeningBon, updateCustomer, setLocation, setLocationPhoto, importCustomers, importLegacyTxns, undoLegacyBatch, updatePrice, pricePreview, cancelPriceAdjustment,
  deactivateCustomer, reactivateCustomer, deleteCustomer,
  listTypes, createType, updateType, deleteType,
  listTransactions, createTransaction, requestCorrection, requestVoid, listChangeRequests, approveChangeRequest, rejectChangeRequest, setTransactionArchive, hardDeleteTransaction, bulkTxnPreview, bulkTxn, bulkTxnRestore, listAudit, dashboardSummary,
  gallonSummary, gallonCorrection, setOpeningStock, resetGallon, gallonMovementImpact, gallonMovementVoid, gallonMovementRestore, gallonMovementDelete, openingResetImpact, openingReset, createInvoice, listInvoices, getInvoice, invoiceLink, invoiceRevoke, invoiceDispatch, invoiceDispatches, billingReminders, cashIntegration,
  deliveryBoard, addOrder, markDelivery, reorderDeliveries, closeDay, listCloseouts,
  openRun, closeRun, correctRun, listRuns,
  listExpenses, createExpense, voidExpense, expenseCats, deliveryReport,
  createPaymentNotReceived, lossReport,
  raiseDispute, approveDispute, reverseDispute,
  kerugianImpact, voidKerugian, hardDeleteKerugian, bulkDeleteKerugian, editKerugianNote,
  createAdjustment, listAdjustments, approveAdjustment, reverseAdjustment, adjustmentReport,
  schemas: { openingBonSchema, adjustCreateSchema, adjustReportQuery, customerSchema, customerUpdateSchema, locationSchema, locationPhotoSchema, importSchema, legacyImportSchema, legacyBatchParams, priceSchema, pricePreviewSchema, txnSchema, correctionSchema, voidSchema, changeReqQuery, rejectSchema, archiveSchema, pnrSchema, lossQuery, disputeSchema, disputeApproveSchema, kerugianQuery, kerugianVoidSchema, kerugianDeleteSchema, kerugianNoteSchema, kerugianBulkSchema, hardDeleteSchema, bulkTxnPreviewSchema, bulkTxnSchema, bulkRestoreSchema, listTxnQuery, auditQuery, summaryQuery, deliveryReportQuery, cashIntegQuery, boardQuery, orderSchema, markSchema, reorderSchema, closeSchema, closeoutQuery, runOpenSchema, runCloseSchema, runCorrectionSchema, runQuery, expenseSchema, expenseVoidSchema, expenseQuery, custListQuery, gallonQuery, gallonCorrectionSchema, openingStockSchema, gallonResetSchema, gallonVoidSchema, gallonRestoreSchema, gallonMovDeleteSchema, openingResetSchema, openingResetImpactSchema, idParams, typeCreateSchema, typeRenameSchema, typeDeleteQuery, batchParams, invoiceCreateSchema, dispatchSchema, dispatchQuery },
};
