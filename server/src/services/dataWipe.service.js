'use strict';
// ── SELECTIVE DATA WIPE (post-trial cleanup) ─────────────────────────────────
// The most destructive operation in the app. Designed defensively:
//   • gated on a dedicated `dataWipe` capability that NO role has by default;
//   • the caller must pick categories explicitly — anything unchecked is untouched;
//   • an automatic backup (local + offsite) runs FIRST and the wipe aborts if it fails;
//   • the caller must type HAPUS and re-enter their password;
//   • all deletes run in ONE transaction, with the audit row written inside it;
//   • users/roles/permissions are NEVER wiped, so login always survives.
//
// NOT wipeable by design: User, Role, PasswordResetRequest (login + access), Attachment
// (photo bytes — orphans are harmless and cheap; keeping them avoids destroying proof
// images referenced by records the operator kept), and DataWipeLog itself (the trail).
const { execFile } = require('child_process');
const path = require('path');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');

// Attendance/payroll are NOT tables — they live in Setting blobs (the app stores them as
// shared documents). Wiping "attendance" therefore clears those keys.
const ATTENDANCE_SETTING_KEYS = ['airro_attendance', 'airro_oriatt'];
// App configuration blobs + dictionaries (only wiped via the explicit `app_settings` box).
const CONFIG_SETTING_KEYS_EXCLUDE = ATTENDANCE_SETTING_KEYS;

// The category registry. `deps` = categories that MUST also be selected (a parent can't be
// deleted while its children remain — we block with an explanation rather than silently
// cascading). `order` fixes the FK-safe delete sequence (children before parents).
const CATEGORIES = {
  // ── DISTRIBUSI ──
  dist_koreksi:    { group: 'distribusi', label: 'Koreksi / void transaksi', order: 10, model: 'correction' },
  dist_kirim:      { group: 'distribusi', label: 'Orderan & pengiriman',     order: 20, models: ['delivery', 'deliveryRun', 'deliveryCloseout'] },
  dist_invoice:    { group: 'distribusi', label: 'Invoice distribusi',       order: 30, model: 'distInvoice' },
  dist_txn:        { group: 'distribusi', label: 'Transaksi distribusi',     order: 40, model: 'distTransaction', deps: ['dist_koreksi'] },
  dist_galon:      { group: 'distribusi', label: 'Ledger stok galon',        order: 50, model: 'gallonMovement' },
  // ── PELANGGAN ── (deleting customers requires everything that points at them)
  pelanggan:       { group: 'pelanggan',  label: 'Pelanggan (+ riwayat harga & kode)', order: 60,
                     models: ['priceHistory', 'customer', 'customerCode'],
                     deps: ['dist_txn', 'dist_kirim', 'dist_invoice', 'dist_galon', 'dist_koreksi'] },
  // ── GUDANG ──
  gudang_stock:    { group: 'gudang',     label: 'Pergerakan stok gudang',   order: 70, model: 'stockMovement' },
  gudang_closeout: { group: 'gudang',     label: 'Tutup gudang harian',      order: 80, model: 'warehouseCloseout' },
  gudang_supplier: { group: 'gudang',     label: 'Pemasok',                  order: 90, models: ['supplier', 'supplierCode'] },
  gudang_items:    { group: 'gudang',     label: 'Jenis barang (inventory)', order: 100, model: 'inventoryItem', deps: ['gudang_stock'] },
  // ── KEUANGAN ──
  keu_entries:     { group: 'keuangan',   label: 'Catatan kas (transaksi)',  order: 110, model: 'entry' },
  keu_setoran:     { group: 'keuangan',   label: 'Setoran',                  order: 120, model: 'setoran' },
  keu_transfer:    { group: 'keuangan',   label: 'Transfer antar kas',       order: 130, model: 'transfer' },
  keu_accounts:    { group: 'keuangan',   label: 'Akun kas & bank',          order: 140, model: 'account', deps: ['keu_entries', 'keu_transfer'] },
  // ── HRD ──
  hrd_kasbon:      { group: 'hrd',        label: 'Kasbon',                   order: 150, model: 'cashbon' },
  hrd_approval:    { group: 'hrd',        label: 'Pengajuan / approval',     order: 160, model: 'approval' },
  hrd_attendance:  { group: 'hrd',        label: 'Absensi (data absensi)',   order: 170, settingKeys: ATTENDANCE_SETTING_KEYS },
  hrd_employees:   { group: 'hrd',        label: 'Karyawan (+ orientasi, training, dokumen, NIP)', order: 180,
                     models: ['orientationAttendance', 'orientation', 'training', 'document', 'employeeNip', 'employee'],
                     employeeCalendar: true, deps: ['hrd_kasbon'] },
  // ── LAINNYA ──
  kalender:        { group: 'lain',       label: 'Kalender / agenda',        order: 190, model: 'calendarEvent' },
  audit:           { group: 'lain',       label: 'Log audit distribusi',     order: 200, model: 'distAuditLog' },
  // ── KONFIGURASI (deliberately its own box, off by default) ──
  app_settings:    { group: 'konfigurasi', label: 'Pengaturan aplikasi (armada, kategori, tipe pelanggan, konfigurasi)',
                     order: 210, models: ['fleet', 'category', 'customerType'], configSettings: true },
};

const KEYS = Object.keys(CATEGORIES);
// Public description of the registry for the UI (no delete internals leaked).
function categoryList() {
  return KEYS.map((k) => ({ key: k, group: CATEGORIES[k].group, label: CATEGORIES[k].label, deps: CATEGORIES[k].deps || [] }));
}

function modelsOf(cat) { return cat.models || (cat.model ? [cat.model] : []); }

// Rows a category would delete right now.
async function countCategory(key) {
  const cat = CATEGORIES[key];
  if (!cat) return 0;
  let n = 0;
  for (const m of modelsOf(cat)) n += await prisma[m].count();
  if (cat.employeeCalendar) n += await prisma.calendarEvent.count({ where: { employeeId: { not: null } } });
  if (cat.settingKeys) n += await prisma.setting.count({ where: { key: { in: cat.settingKeys } } });
  if (cat.configSettings) n += await prisma.setting.count({ where: { key: { notIn: CONFIG_SETTING_KEYS_EXCLUDE } } });
  return n;
}

// Validate the selection: known keys + every dependency also selected.
function validateSelection(categories) {
  const sel = [...new Set((Array.isArray(categories) ? categories : []).filter((k) => typeof k === 'string'))];
  const unknown = sel.filter((k) => !CATEGORIES[k]);
  if (unknown.length) throw ApiError.badRequest(`Kategori tidak dikenal: ${unknown.join(', ')}`);
  const missing = [];
  for (const k of sel) {
    for (const d of CATEGORIES[k].deps || []) {
      if (!sel.includes(d)) missing.push({ category: CATEGORIES[k].label, needs: CATEGORIES[d].label, needsKey: d });
    }
  }
  if (missing.length) {
    const lines = missing.map((m) => `"${m.category}" butuh "${m.needs}" ikut dipilih`);
    throw ApiError.badRequest(`Pilihan belum lengkap — data turunan harus ikut dihapus: ${lines.join('; ')}`);
  }
  return sel.sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);
}

// PREVIEW — exact counts per selected category. No writes.
async function preview(categories) {
  const sel = validateSelection(categories);
  const items = [];
  let total = 0;
  for (const k of sel) {
    const n = await countCategory(k);
    items.push({ key: k, label: CATEGORIES[k].label, group: CATEGORIES[k].group, count: n });
    total += n;
  }
  return { categories: items, total };
}

// ── automatic pre-wipe backup ────────────────────────────────────────────────
// Runs deploy/backup-db.sh (local + offsite). Injectable so tests can drive both the
// success and the failure path without shelling out.
let backupRunner = function realBackup() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '../../../deploy/backup-db.sh');
    execFile('bash', [script], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(((stderr || '') + (stdout || '')).trim().split('\n').slice(-3).join(' ') || err.message));
      const m = String(stdout || '').match(/^Backup written:\s*(\S+)/m);
      resolve(m ? m[1] : '(backup ok, filename not reported)');
    });
  });
};
function _setBackupRunner(fn) { backupRunner = fn; }   // tests only

// ── the wipe ─────────────────────────────────────────────────────────────────
async function wipe(body, actor) {
  const sel = validateSelection(body && body.categories);
  if (!sel.length) throw ApiError.badRequest('Tidak ada kategori dipilih — tidak ada yang dihapus.');
  // Typed confirmation + password re-entry (defence against a mis-click / borrowed session).
  if (String(body.confirm || '').trim() !== 'HAPUS') throw ApiError.badRequest('Ketik HAPUS untuk konfirmasi.');
  const me = await prisma.user.findUnique({ where: { id: (actor && actor.id) || '' } });
  if (!me) throw ApiError.unauthorized('Sesi tidak valid.');
  const okPw = await bcrypt.compare(String(body.password || ''), me.passwordHash);
  if (!okPw) throw ApiError.unauthorized('Password salah.');

  // Counts BEFORE deleting — this is what we report + audit.
  const before = await preview(sel);

  // 1) BACKUP FIRST — abort entirely if it fails.
  let backupFile = '';
  try {
    backupFile = await backupRunner();
  } catch (e) {
    throw ApiError.badRequest(`Backup otomatis GAGAL — penghapusan dibatalkan (tidak ada data yang dihapus). ${e.message || ''}`.trim());
  }

  // 2) DELETE — one transaction, children before parents, audit written inside it.
  const counts = {};
  before.categories.forEach((c) => { counts[c.key] = c.count; });
  const ops = [];
  for (const k of sel) {
    const cat = CATEGORIES[k];
    if (cat.employeeCalendar) ops.push(prisma.calendarEvent.deleteMany({ where: { employeeId: { not: null } } }));
    if (cat.settingKeys) ops.push(prisma.setting.deleteMany({ where: { key: { in: cat.settingKeys } } }));
    if (cat.configSettings) ops.push(prisma.setting.deleteMany({ where: { key: { notIn: CONFIG_SETTING_KEYS_EXCLUDE } } }));
    for (const m of modelsOf(cat)) ops.push(prisma[m].deleteMany());
  }
  const snap = { actorId: (actor && actor.id) || null, actorName: me.name || null, actorRole: (actor && actor.role) || null };
  ops.push(prisma.dataWipeLog.create({
    data: { categories: JSON.stringify(sel), counts: JSON.stringify(counts), totalRows: before.total, backupFile, ...snap },
  }));
  await prisma.$transaction(ops);

  console.warn(`[wipe] DATA DIHAPUS oleh ${snap.actorName || snap.actorId}: [${sel.join(', ')}] — ${before.total} baris · backup=${backupFile}`);
  return {
    ok: true,
    categories: before.categories,
    total: before.total,
    backupFile,
    restoreHint: `bash deploy/restore-db.sh ${backupFile}`,
  };
}

// Recent wipes (the trail that survives every wipe).
async function history() {
  const rows = await prisma.dataWipeLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    data: rows.map((r) => ({
      id: r.id, totalRows: r.totalRows, backupFile: r.backupFile,
      categories: (() => { try { return JSON.parse(r.categories); } catch (e) { return []; } })(),
      counts: (() => { try { return JSON.parse(r.counts); } catch (e) { return {}; } })(),
      actorName: r.actorName, createdAt: r.createdAt ? new Date(r.createdAt).getTime() : null,
    })),
  };
}

module.exports = { CATEGORIES, categoryList, preview, wipe, history, _setBackupRunner };
