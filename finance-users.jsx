/* global React, FS, API, CLOUD */
/* AirRO — User & Role management (window.USERMGMT). Backend-connected via /users + /roles.
   Redesign: two tabs, a searchable/filterable user table (cards on mobile), a slide-over detail with
   an "Akses efektif" summary + change history, and a module-grouped, risk-ordered permission editor
   (destructive caps isolated in a red "Tindakan berisiko" block; dependency auto-enable; diff before save). */
const { useState: uSu, useEffect: uEu, useMemo: uMu } = React;
const trU = (k, v) => window.t(k, v);

// ── CAPABILITY CATALOG — the single backbone for every permission surface. ──────────────────────────
// [key, module, label, description, tier, {destructive?, dependsOn?}]. tier: 0=Lihat 1=Input 2=Koreksi
// 3=Berisiko. Modules mirror the sidebar exactly. A camelCase key is shown only in a tooltip.
const CAP_MODULES = [
  { id: 'keuangan', title: 'Keuangan' },
  { id: 'hrd', title: 'SDM / HRD' },
  { id: 'distribusi', title: 'Distribusi' },
  { id: 'gudang', title: 'Gudang' },
  { id: 'admin', title: 'Administrasi' },
];
const D = (dependsOn) => ({ dependsOn });
const X = (dependsOn) => ({ destructive: true, dependsOn });
const CAPS = [
  // Keuangan
  ['cashflow', 'keuangan', 'Lihat Arus Kas', 'Membuka modul keuangan dan melihat transaksi.', 0],
  ['seeMoney', 'keuangan', 'Lihat Nominal', 'Menampilkan angka rupiah (tanpa ini, nominal disamarkan).', 0],
  ['allEntries', 'keuangan', 'Semua Catatan', 'Melihat catatan seluruh pengguna, bukan hanya miliknya.', 0, D('cashflow')],
  ['reports', 'keuangan', 'Laporan Keuangan', 'Membuka laporan & ekspor keuangan.', 0],
  ['addEntry', 'keuangan', 'Tambah Transaksi', 'Mencatat pemasukan / pengeluaran.', 1, D('cashflow')],
  ['setoran', 'keuangan', 'Setoran', 'Mencatat setoran kas harian.', 1],
  ['edit', 'keuangan', 'Edit Transaksi', 'Mengubah transaksi yang sudah tercatat.', 2, D('cashflow')],
  ['delete', 'keuangan', 'Hapus Transaksi', 'Menghapus transaksi keuangan — tidak bisa dibatalkan.', 3, X('cashflow')],
  // SDM / HRD
  ['employees', 'hrd', 'Karyawan', 'Melihat daftar & data karyawan.', 0],
  ['empDetail', 'hrd', 'Detail Karyawan', 'Membuka detail lengkap tiap karyawan.', 0, D('employees')],
  ['attendance', 'hrd', 'Absensi', 'Melihat & mengelola absensi.', 0, D('employees')],
  ['payroll', 'hrd', 'Penggajian', 'Membuka penggajian & THR.', 0],
  ['sdmPayrollLihat', 'hrd', 'Payroll (jurnal) — Lihat', 'Melihat payroll akrual & slip gaji. Angka gaji bersifat sensitif.', 0],
  ['sdmPayrollKelola', 'hrd', 'Payroll (jurnal) — Kelola', 'Membuat/edit/bayar periode payroll akrual.', 1, D('sdmPayrollLihat')],
  ['sdmPayrollSetujui', 'hrd', 'Payroll (jurnal) — Setujui', 'Menyetujui payroll (memposting jurnal).', 2, D('sdmPayrollLihat')],
  ['kasbonRequest', 'hrd', 'Kasbon — Ajukan', 'Mengajukan kasbon karyawan.', 1],
  ['kasbonApprove', 'hrd', 'Kasbon — Setujui', 'Menyetujui pengajuan kasbon.', 2],
  ['kasbonReject', 'hrd', 'Kasbon — Tolak', 'Menolak pengajuan kasbon.', 2],
  ['kasbonCancel', 'hrd', 'Kasbon — Batalkan', 'Membatalkan kasbon yang berjalan.', 2],
  ['kasbonDelete', 'hrd', 'Kasbon — Hapus', 'Menghapus data kasbon permanen.', 3, { destructive: true }],
  // Distribusi — view-window (read range)
  ['distribusi.lihat.hari_ini', 'distribusi', 'Lihat data: Hari ini', 'Batas baca default — hanya hari ini.', 0],
  ['distribusi.lihat.7hari', 'distribusi', 'Lihat data: 7 hari', 'Boleh membaca 7 hari terakhir.', 0],
  ['distribusi.lihat.bulan_ini', 'distribusi', 'Lihat data: Bulan ini', 'Boleh membaca sepanjang bulan berjalan.', 0],
  ['distribusi.lihat.semua', 'distribusi', 'Lihat data: Semua riwayat', 'Boleh membaca seluruh riwayat + rentang custom.', 0],
  ['distribusi.lihat.sisa_bon', 'distribusi', 'Lihat Sisa Bon', 'Melihat total tunggakan walau riwayat dibatasi.', 0],
  ['distribusiDashboard', 'distribusi', 'Lihat Dashboard', 'Membuka dashboard distribusi.', 0],
  ['distribusiDashHistory', 'distribusi', 'Lihat Periode Sebelumnya', 'Melihat periode dashboard yang lampau.', 0],
  ['distribusiCashIntegrasi', 'distribusi', 'Lihat Integrasi Kas', 'Melihat integrasi distribusi ↔ kas.', 0],
  ['distribusiPengiriman', 'distribusi', 'Papan Pengiriman', 'Membuka papan pengiriman (rit).', 0],
  ['distribusiBelumTerkirim', 'distribusi', 'Belum Terkirim (carry-over)', 'Melihat & memindahkan pengiriman tertunggak hari sebelumnya ke rute hari ini — keputusan back office, terpisah dari Papan Pengiriman.', 2],
  ['distribusiPengirimanReport', 'distribusi', 'Laporan Pengiriman', 'Membuka laporan pengiriman.', 0],
  ['distribusiAudit', 'distribusi', 'Log Audit', 'Melihat log audit distribusi.', 0],
  ['distribusiInput', 'distribusi', 'Input Transaksi', 'Mencatat transaksi distribusi.', 1],
  ['distribusiCustomers', 'distribusi', 'Kelola Pelanggan', 'Menambah / mengubah data pelanggan.', 1],
  ['distribusiCustomerImport', 'distribusi', 'Impor Pelanggan (massal)', 'Mengimpor banyak pelanggan sekaligus.', 1, D('distribusiCustomers')],
  ['distribusiOrder', 'distribusi', 'Tambah Orderan', 'Menambah orderan tambahan.', 1],
  ['distribusiExpense', 'distribusi', 'Pengeluaran Lapangan', 'Mencatat pengeluaran lapangan.', 1],
  ['distribusiRute', 'distribusi', 'Atur Urutan Rute', 'Mengatur urutan rute pengiriman.', 1],
  ['distribusiKoreksi', 'distribusi', 'Koreksi Transaksi', 'Mengoreksi transaksi distribusi.', 2],
  ['distribusiHargaMaster', 'distribusi', 'Ubah Harga Master', 'Mengubah harga master pelanggan.', 2],
  ['distribusiBonAdjust', 'distribusi', 'Pelunasan/Kerugian', 'Pelunasan tidak diterima + laporan kerugian.', 2],
  ['distribusiPenyesuaianGalon', 'distribusi', 'Sesuaikan Galon Pelanggan', 'Mengoreksi jumlah galon yang dipegang pelanggan (hitung fisik di lapangan). TIDAK mengubah uang.', 2],
  ['distribusiPenyesuaianBon', 'distribusi', 'Sesuaikan Sisa Bon', 'Mengubah SISA BON pelanggan — mengubah uang yang terutang dan tidak dapat diverifikasi ulang setelahnya. Beri hanya ke GM/Pemilik.', 3, { destructive: true }],
  ['distribusiApprove', 'distribusi', 'Setujui Perubahan', 'Menyetujui koreksi/pembatalan distribusi.', 2],
  // Owner-only waiver of segregation of duties: approve your OWN correction/void/dispute. Needs
  // distribusiApprove to mean anything; every self-approval is badged + logged. Only Pemilik may grant.
  ['distribusiApproveSelf', 'distribusi', 'Setujui Pengajuan Sendiri', 'Menyetujui koreksi/pembatalan/sengketa yang Anda ajukan sendiri — pelonggaran pemisahan tugas. Hanya Pemilik yang boleh memberi; setiap persetujuan mandiri ditandai & dicatat.', 3, { destructive: true, ownerOnly: true, dependsOn: 'distribusiApprove' }],
  ['distribusiLegacyImport', 'distribusi', 'Impor Riwayat (arsip)', 'Mengimpor riwayat transaksi lama (arsip).', 2],
  ['distribusiVoid', 'distribusi', 'Batalkan Transaksi', 'Membatalkan transaksi distribusi.', 3, { destructive: true }],
  ['distribusiCustomerDelete', 'distribusi', 'Hapus/Nonaktifkan Pelanggan', 'Menghapus atau menonaktifkan pelanggan.', 3, { destructive: true }],
  ['distribusi.transaksi.hapus', 'distribusi', 'Hapus Massal Transaksi', 'Menghapus banyak transaksi sekaligus (owner/GM).', 3, { destructive: true }],
  ['distribusiHardDelete', 'distribusi', 'Hapus Permanen Transaksi', 'Menghapus transaksi permanen — tak bisa dibatalkan.', 3, { destructive: true }],
  // Gudang
  ['gudangView', 'gudang', 'Lihat Gudang', 'Membuka modul gudang & stok.', 0],
  ['gudangReport', 'gudang', 'Laporan Gudang', 'Membuka laporan & tutup gudang.', 0],
  ['gudangSupplier', 'gudang', 'Kelola Supplier', 'Mengelola data supplier + jual galon rusak.', 1],
  ['gudangAddStock', 'gudang', 'Tambah Stok', 'Menambah stok barang.', 1, D('gudangView')],
  ['gudangBuffer', 'gudang', 'Atur Buffer', 'Menyetel ambang buffer stok.', 1, D('gudangView')],
  ['gudangItems', 'gudang', 'Kelola Barang', 'Menambah / mengubah item gudang.', 1, D('gudangView')],
  ['gudangKoreksi', 'gudang', 'Koreksi Stok', 'Mengoreksi stok barang.', 2, D('gudangView')],
  ['gudangDamage', 'gudang', 'Catat Rusak/Hilang', 'Mencatat barang rusak / hilang.', 2, D('gudangView')],
  // Gudang → Stok Galon (page lives under Gudang)
  ['gudangGalonView', 'gudang', 'Lihat Stok Galon', 'Membuka halaman Stok Galon (posisi + ledger).', 0],
  ['gudangGalonKoreksi', 'gudang', 'Koreksi Stok Galon', 'Koreksi depot + set/ubah stok awal galon.', 2, D('gudangGalonView')],
  ['gudangGalonOpname', 'gudang', 'Stok Opname Galon', 'Hitung fisik → koreksi otomatis.', 2, D('gudangGalonView')],
  ['gudangGalonReset', 'gudang', 'Reset/Batalkan Baris Galon', 'Reset jumlah + batalkan/pulihkan baris depot.', 3, X('gudangGalonView')],
  ['gudangGalonHardDelete', 'gudang', 'Hapus Permanen Baris Galon', 'Hapus permanen baris galon (owner).', 3, X('gudangGalonView')],
  ['gudang.galon.reset_total', 'gudang', 'Reset Total Stok Galon', 'Mulai bersih seluruh ledger galon (owner).', 3, X('gudangGalonView')],
  // Administrasi
  ['company', 'admin', 'Dashboard Perusahaan', 'Membuka ringkasan perusahaan.', 0],
  ['approvals', 'admin', 'Pengajuan', 'Membuka pusat pengajuan/persetujuan.', 0],
  ['settings', 'admin', 'Pengaturan', 'Membuka pengaturan aplikasi.', 0],
  ['manageUsers', 'admin', 'Kelola Pengguna', 'Mengelola pengguna, peran & hak akses.', 2],
  ['manageBusinessUnits', 'admin', 'Kelola Unit Bisnis', 'Menambah/menonaktifkan unit bisnis.', 2],
  ['interUnitTransfer', 'admin', 'Transfer Antar-Unit', 'Mencatat/membatalkan transfer antar-unit.', 2],
  ['dataWipe', 'admin', 'Hapus Data (berbahaya)', 'Menghapus data terpilih secara permanen.', 3, { destructive: true }],
];
const CAP_META = {};
CAPS.forEach(([key, module, label, desc, tier, opt]) => { CAP_META[key] = { key, module, label, desc, tier, destructive: !!(opt && opt.destructive), ownerOnly: !!(opt && opt.ownerOnly), dependsOn: opt && opt.dependsOn }; });
// Caps that are togglable in the editor (order preserved within a module by tier then declaration).
const EDITABLE_KEYS = CAPS.map((c) => c[0]);
const capsFor = (moduleId) => EDITABLE_KEYS.filter((k) => CAP_META[k].module === moduleId).sort((a, b) => CAP_META[a].tier - CAP_META[b].tier);
// Reverse dependents: for a given view cap, which action caps depend on it.
const DEPENDENTS = {};
EDITABLE_KEYS.forEach((k) => { const dep = CAP_META[k].dependsOn; if (dep) (DEPENDENTS[dep] || (DEPENDENTS[dep] = [])).push(k); });

// Normalise a perms object for editing (derive kasbon split, strip computed flags).
function editablePerms(raw) { const { kasbonView: _k, gudangKelola: _g, distribusi: _d, kasbon: _kb, distribusiPenyesuaian: _dp, ...p } = FS.normKasbon(raw || {}); return p; }

// ── PERMISSION EDITOR — module groups, risk order, destructive block, tri-state, dependency handling ──
function PermissionEditor({ value, onChange, roleDefaults, lockedKeys, note, ownerAdmin }) {
  const perms = value || {};
  const [open, setOpen] = uSu(() => { const o = {}; CAP_MODULES.forEach((m) => { o[m.id] = false; }); return o; });
  const isOn = (k) => !!perms[k];
  const isDrift = (k) => roleDefaults && (!!perms[k] !== !!roleDefaults[k]);
  const setMany = (changes) => onChange({ ...perms, ...changes });
  // Owner-only caps (the self-approval waiver) are LOCKED for a non-owner admin — visible but not
  // togglable — so a GM sees the control yet cannot grant it (also enforced server-side).
  const ownerLocked = ownerAdmin ? [] : EDITABLE_KEYS.filter((k) => CAP_META[k].ownerOnly);
  const lockedAll = [...(lockedKeys || []), ...ownerLocked];
  // Toggle a cap; enabling an action auto-enables its view dependency; disabling a view is allowed but
  // flagged. Returns the set of auto-enabled view keys (for the "Otomatis mengaktifkan" note).
  const toggle = (k) => {
    if (lockedAll.includes(k) && isOn(k)) return;   // never strip a locked cap
    const next = { ...perms, [k]: !isOn(k) };
    const auto = [];
    if (!isOn(k)) { let d = CAP_META[k].dependsOn; while (d && !next[d]) { next[d] = true; auto.push(d); d = CAP_META[d].dependsOn; } }
    onChange(next);
    return auto;
  };
  const [autoMsg, setAutoMsg] = uSu('');
  const onToggle = (k) => { const auto = toggle(k); if (auto && auto.length) { setAutoMsg(trU('pe.autoOn', { list: auto.map((x) => CAP_META[x].label).join(', ') })); setTimeout(() => setAutoMsg(''), 3500); } };
  // Group-level tri-state (semua / sebagian / tidak) — NEVER touches destructive caps.
  const groupSafeKeys = (mid) => capsFor(mid).filter((k) => !CAP_META[k].destructive && !lockedAll.includes(k));
  const groupState = (mid) => { const ks = groupSafeKeys(mid); const on = ks.filter(isOn).length; return on === 0 ? 'none' : on === ks.length ? 'all' : 'some'; };
  const groupToggle = (mid) => { const ks = groupSafeKeys(mid); const target = groupState(mid) !== 'all'; const ch = {}; ks.forEach((k) => { ch[k] = target; if (target) { let d = CAP_META[k].dependsOn; while (d) { ch[d] = true; d = CAP_META[d].dependsOn; } } }); setMany(ch); };
  // A row's VISIBLE lock reason + unmet prerequisite (for the ownerOnly self-approval cap). The reason is
  // TEXT, not just a padlock: a non-owner reads WHY they cannot grant it; an owner whose prerequisite is
  // off gets a one-click "enable prerequisite" instead of hunting for the Setujui Perubahan cap.
  const rowLockReason = (k) => (CAP_META[k].ownerOnly && !ownerAdmin) ? trU('pe.ownerLockReason') : null;
  const rowPrereq = (k) => { if (!CAP_META[k].ownerOnly || lockedAll.includes(k)) return null; const d = CAP_META[k].dependsOn; return (d && !isOn(d)) ? { key: d, label: CAP_META[d].label } : null; };
  return (
    <div className="perm-editor">
      {note && <div className="perm-note">{note}</div>}
      {autoMsg && <div className="perm-auto"><IconCheck s={13} />{autoMsg}</div>}
      {CAP_MODULES.map((m) => {
        const ks = capsFor(m.id);
        const safe = ks.filter((k) => !CAP_META[k].destructive);
        const danger = ks.filter((k) => CAP_META[k].destructive);
        const onCount = ks.filter(isOn).length;
        const gs = groupState(m.id);
        return (
          <div key={m.id} className="perm-group">
            <button type="button" className="perm-group-head" onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}>
              <IconCaret s={14} className={'perm-chev' + (open[m.id] ? ' open' : '')} />
              <span className="perm-group-title">{m.title}</span>
              <span className="perm-group-count">{onCount} dari {ks.length}</span>
              <span className={'perm-tri ' + gs} onClick={(e) => { e.stopPropagation(); groupToggle(m.id); }} role="button" tabIndex={0} title={trU('pe.groupToggle')}>{gs === 'all' ? trU('pe.all') : gs === 'some' ? trU('pe.some') : trU('pe.none')}</span>
            </button>
            {open[m.id] && (
              <div className="perm-group-body">
                {safe.map((k) => <CapRow key={k} k={k} on={isOn(k)} drift={isDrift(k)} locked={lockedAll.includes(k)} onToggle={() => onToggle(k)} lockReason={rowLockReason(k)} prereq={rowPrereq(k)} onEnablePrereq={() => setMany({ [CAP_META[k].dependsOn]: true })} />)}
                {danger.length > 0 && (
                  <div className="perm-danger">
                    <div className="perm-danger-h"><IconWarn s={13} />{trU('pe.danger')}</div>
                    {danger.map((k) => <CapRow key={k} k={k} on={isOn(k)} drift={isDrift(k)} locked={lockedAll.includes(k)} onToggle={() => onToggle(k)} danger ownerOnly={CAP_META[k].ownerOnly && !ownerAdmin} lockReason={rowLockReason(k)} prereq={rowPrereq(k)} onEnablePrereq={() => setMany({ [CAP_META[k].dependsOn]: true })} />)}
                  </div>
                )}
                {/* SELF-APPROVAL CEILING — a per-approver rupiah cap (0/blank = unlimited). Owner-only,
                    shown only once the waiver itself is granted; stored in the same permissions blob. */}
                {m.id === 'distribusi' && ownerAdmin && isOn('distribusiApproveSelf') && (
                  <div className="perm-selflimit">
                    <label className="fld-label" style={{ marginTop: 0 }}>{trU('pe.selfLimitLabel')}</label>
                    <div className="cap-desc" style={{ marginBottom: 6 }}>{trU('pe.selfLimitHint')}</div>
                    <input className="fld tnum" inputMode="numeric" value={perms.maxSelfApproveAmount || ''} placeholder={trU('pe.selfLimitPh')}
                      onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); onChange({ ...perms, maxSelfApproveAmount: n ? +n : 0 }); }} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function CapRow({ k, on, drift, locked, danger, onToggle, ownerOnly, lockReason, prereq, onEnablePrereq }) {
  const m = CAP_META[k];
  return (
    <div className={'cap-row' + (on ? ' on' : '') + (danger ? ' danger' : '') + (locked ? ' locked' : '')} onClick={locked ? undefined : onToggle} title={k} role="button" tabIndex={0}
      onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}>
      <span className={'cap-check' + (on ? ' on' : '')}>{on ? <IconCheck s={13} /> : null}</span>
      <div className="cap-main">
        <div className="cap-label">{m.label}{drift ? <span className="cap-drift">{trU('pe.drift')}</span> : null}{ownerOnly ? <span className="cap-owneronly">{trU('pe.ownerOnly')}</span> : null}{locked ? ' 🔒' : ''}</div>
        <div className="cap-desc">{m.desc}</div>
        {/* The lock reason is TEXT — a disabled control with no explanation was the actual defect. */}
        {lockReason ? <div className="cap-lockreason"><IconLock s={11} />{lockReason}</div> : null}
        {prereq ? <div className="cap-prereq"><IconWarn s={11} />{trU('pe.prereqHint', { name: prereq.label })}<button type="button" className="cap-prereq-btn" onClick={(e) => { e.stopPropagation(); onEnablePrereq && onEnablePrereq(); }}>{trU('pe.enablePrereq')}</button></div> : null}
      </div>
    </div>
  );
}

// Compact read-only "Akses efektif" summary — module counts + the risky caps that are ON.
function AksesEfektif({ perms }) {
  const on = EDITABLE_KEYS.filter((k) => perms[k]);
  const risky = on.filter((k) => CAP_META[k].destructive);
  return (
    <div className="akses-efektif">
      <div className="ae-modules">
        {CAP_MODULES.map((m) => { const ks = capsFor(m.id); const c = ks.filter((k) => perms[k]).length; return <span key={m.id} className={'ae-mod' + (c ? ' has' : '')}>{m.title}<b>{c}/{ks.length}</b></span>; })}
      </div>
      {risky.length > 0 && <div className="ae-risky"><IconWarn s={12} />{trU('pe.riskyOn', { list: risky.map((k) => CAP_META[k].label).join(' · ') })}</div>}
    </div>
  );
}

// Compute a human diff between two perms objects → { added:[labels], removed:[labels] }.
function permLabelDiff(before, after) {
  const added = [], removed = [];
  EDITABLE_KEYS.forEach((k) => { const b = !!before[k], a = !!after[k]; if (a && !b) added.push(CAP_META[k].label); if (b && !a) removed.push(CAP_META[k].label); });
  return { added, removed };
}
const fmtWhen = (ms) => (FS.fmtWhen ? FS.fmtWhen(ms) : (ms ? new Date(ms).toLocaleString('id-ID') : '—'));

// ── Scope chips (fleet / unit) — extracted so the slide-over stays readable ──
function ScopeChips({ label, hint, value, active, allLabel, inactiveTag, onChange }) {
  const isAll = value === 'all' || value == null;
  const arr = Array.isArray(value) ? value : [];
  const known = active.map((x) => (typeof x === 'string' ? x : x.id));
  const extras = arr.filter((id) => !known.includes(id));
  const chips = [...active.map((x) => (typeof x === 'string' ? { id: x, name: x, inactive: false } : { id: x.id, name: x.name || x.id, inactive: x.active === false })), ...extras.map((id) => ({ id, name: id, inactive: true }))];
  const toggle = (id) => { const cur = Array.isArray(value) ? value : []; const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; onChange(next.length ? next : 'all'); };
  return (
    <div className="so-field">
      <label className="fld-label" style={{ margin: 0 }}>{label}</label>
      <div className="so-hint">{hint}</div>
      <div className="cat-chips">
        <button type="button" className={`cat-chip ${isAll ? 'on' : ''}`} onClick={() => onChange('all')}>{isAll ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{allLabel}</button>
        {chips.map(({ id, name, inactive }) => { const on = !isAll && arr.includes(id); return (
          <button key={id} type="button" className={`cat-chip ${on ? 'on' : ''}`} onClick={() => toggle(id)}>{on ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{name}{inactive ? ' ' + inactiveTag : ''}</button>
        ); })}
        {chips.length === 0 && <span className="so-empty-chip">{trU('um.fleetNone')}</span>}
      </div>
    </div>
  );
}

// ── USER SLIDE-OVER — identity · role · scope · permission editor · Akses efektif · history ──
function UserSlideOver({ row, users, onSave, onClose, busy, fleet, businessUnits, currentId, ownerAdmin }) {
  const [f, setF] = uSu(row);
  const [confirmSave, setConfirmSave] = uSu(false);
  const [audit, setAudit] = uSu(null);
  const cloud = !!(window.CLOUD && window.CLOUD.active && window.API);
  uEu(() => { const o = (e) => e.key === 'Escape' && (confirmSave ? setConfirmSave(false) : onClose()); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [confirmSave]);
  uEu(() => { if (!f._new && cloud && window.API.users.audit) window.API.users.audit(f.id).then((r) => setAudit(r.data || [])).catch(() => setAudit([])); }, []);
  const set = (p) => setF({ ...f, ...p });
  const roleDefaults = uMu(() => editablePerms(FS.perms(f.role)), [f.role]);
  const eff = f.permissions ? editablePerms(f.permissions) : { ...roleDefaults };
  const orig = uMu(() => editablePerms(row.permissions || FS.perms(row.role)), []);   // baseline at open, for the diff
  const diff = permLabelDiff(orig, eff);
  const custom = !!f.permissions;
  // last-admin lock: manageUsers can't be stripped from the only active holder
  const effMU = (role, perms) => { const e = FS.normKasbon(perms || FS.perms(role)); return e.manageUsers === undefined ? !!(e.reset || (FS.perms(role) || {}).manageUsers) : !!e.manageUsers; };
  const otherAdmins = (users || []).filter((u) => u.id !== f.id && u.active !== false && effMU(u.role, u.permissions));
  const lockMU = !!eff.manageUsers && otherAdmins.length === 0;
  const dupUser = users.some((u) => u.id !== f.id && (u.user || '').toLowerCase() === (f.user || '').trim().toLowerCase());
  const pinOk = f._new ? /^\d{4,}$/.test(f.pin || '') : (!f.pin || /^\d{4,}$/.test(f.pin));
  const valid = f.name.trim() && /^[a-zA-Z0-9._-]{3,}$/.test((f.user || '').trim()) && pinOk && !dupUser;
  const changeRole = (r) => set({ role: r, color: FS.roleColor(r) || f.color, permissions: null });
  const activeFleet = Array.isArray(fleet) ? fleet : ((window.FS && FS.loadFleet && FS.loadFleet()) || []);
  const units = Array.isArray(businessUnits) ? businessUnits.filter((u) => u && u.id) : [];
  const doSave = () => { if (!valid) return; if (diff.added.length || diff.removed.length) setConfirmSave(true); else onSave(f); };
  return (
    <div className="slideover-scrim" onClick={onClose}>
      <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
        <div className="so-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="user-av" style={{ background: f.color, width: 38, height: 38 }}>{FS.initials(f.name || '?')}</span>
            <div style={{ minWidth: 0 }}><div className="so-title">{f._new ? trU('um.add') : (f.name || trU('um.edit'))}</div>{!f._new && <div className="so-sub">@{f.user}{f.id === currentId ? ' · ' + trU('um.you') : ''}</div>}</div>
          </div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="so-body">
          {/* Identity */}
          <div className="so-section">
            <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.name')}</label>
            <input className="fld" value={f.name} placeholder="mis. Budi Santoso" onChange={(e) => set({ name: e.target.value })} />
            <div className="so-row2">
              <div><label className="fld-label">{trU('um.username')}</label><input className="fld" value={f.user} placeholder="username" onChange={(e) => set({ user: e.target.value.replace(/\s/g, '') })} /></div>
              <div><label className="fld-label">{f._new ? 'Password (PIN)' : trU('um.resetPw')}</label><input className="fld tnum" inputMode="numeric" value={f.pin} placeholder={f._new ? 'min. 4 angka' : trU('um.newPwPh')} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></div>
            </div>
            {dupUser && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{trU('um.dup')}</div>}
            {!f._new && <label className="so-check"><input type="checkbox" checked={!!f.mustChangePassword} onChange={(e) => set({ mustChangePassword: e.target.checked })} />{trU('um.forceChange')}</label>}
            <label className="fld-label">{trU('um.note')}</label>
            <input className="fld" value={f.sub || ''} placeholder={trU('um.notePh')} onChange={(e) => set({ sub: e.target.value })} />
          </div>
          {/* Role template */}
          <div className="so-section">
            <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.role')}</label>
            {/* Only an owner may assign the OWNER role (server-enforced too). Hide it from a non-owner's
                picker to avoid a dead-end 403 — unless the edited user is already an owner (keep it visible). */}
            <UI.Dropdown value={f.role} options={FS.roleList().filter((r) => ownerAdmin || r.id !== 'owner' || f.role === 'owner').map((r) => ({ value: r.id, label: r.name }))} onChange={changeRole} />
            <div className="so-role-state">{custom ? <><span className="so-custom">{trU('pe.customized')}</span><button className="dist-link" onClick={() => set({ permissions: null })}>{trU('pe.resetRole')}</button></> : <span className="so-default">{trU('pe.roleDefault')}</span>}</div>
          </div>
          {/* Akses efektif */}
          <div className="so-section">
            <div className="so-sec-title">{trU('pe.aksesEfektif')}</div>
            <AksesEfektif perms={eff} />
          </div>
          {/* Permission editor */}
          <div className="so-section">
            <div className="so-sec-title">{trU('pe.hakAkses')}</div>
            <PermissionEditor value={eff} roleDefaults={roleDefaults} lockedKeys={lockMU ? ['manageUsers'] : []} ownerAdmin={ownerAdmin} onChange={(next) => set({ permissions: next })} note={lockMU ? trU('um.lastAdmin') : trU('pe.editHint')} />
          </div>
          {/* Scopes */}
          <div className="so-section">
            <ScopeChips label={trU('um.fleetScope')} hint={trU('um.fleetScopeHint')} value={f.fleetScope} active={activeFleet} allLabel={trU('um.fleetAll')} inactiveTag={trU('um.fleetInactive')} onChange={(v) => set({ fleetScope: v })} />
            <ScopeChips label={trU('um.unitScope')} hint={trU('um.unitScopeHint')} value={f.unitScope} active={units} allLabel={trU('um.unitAll')} inactiveTag={trU('um.fleetInactive')} onChange={(v) => set({ unitScope: v })} />
          </div>
          {/* History */}
          {!f._new && (
            <div className="so-section">
              <div className="so-sec-title">{trU('pe.history')}</div>
              {audit === null ? <div className="so-empty">{trU('common.loading') || 'Memuat…'}</div>
                : audit.length === 0 ? <div className="so-empty">{trU('pe.noHistory')}</div>
                  : audit.slice(0, 12).map((a) => <AuditRow key={a.id} a={a} />)}
            </div>
          )}
        </div>
        <div className="so-foot">
          {!f._new && users.length > 1 && f.id !== currentId && <button className="btn btn-ghost so-del" disabled={busy} onClick={() => onSave(f, true)}><IconTrash s={15} />{trU('um.remove')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trU('common.cancel') || 'Batal'}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={doSave}>{busy ? '…' : (diff.added.length || diff.removed.length ? trU('pe.saveN', { n: diff.added.length + diff.removed.length }) : trU('um.save'))}</button>
        </div>
        {confirmSave && (
          <div className="so-confirm-scrim" onClick={() => setConfirmSave(false)}>
            <div className="so-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="so-confirm-h">{trU('pe.confirmTitle')}</div>
              {diff.added.length > 0 && <div className="so-diff add"><b>+{diff.added.length}</b> {diff.added.join(', ')}</div>}
              {diff.removed.length > 0 && <div className="so-diff rem"><b>−{diff.removed.length}</b> {diff.removed.join(', ')}</div>}
              <div className="so-confirm-foot"><button className="btn btn-ghost" onClick={() => setConfirmSave(false)}>{trU('common.cancel') || 'Batal'}</button><button className="btn btn-primary" disabled={busy} onClick={() => onSave(f)}>{busy ? '…' : trU('pe.confirmSave')}</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const AUDIT_ACTION = { permissions: 'pe.aPerms', role: 'pe.aRole', active: 'pe.aActive', fleetScope: 'pe.aFleet', unitScope: 'pe.aUnit', create: 'pe.aCreate', delete: 'pe.aDelete', password: 'pe.aPassword' };
function AuditRow({ a }) {
  const d = a.detail || {};
  let extra = '';
  if (a.action === 'permissions') { const parts = []; if (d.added && d.added.length) parts.push('+' + d.added.map((k) => (CAP_META[k] ? CAP_META[k].label : k)).join(', ')); if (d.removed && d.removed.length) parts.push('−' + d.removed.map((k) => (CAP_META[k] ? CAP_META[k].label : k)).join(', ')); extra = parts.join(' · '); }
  else if (a.action === 'role') extra = (FS.roleName ? FS.roleName(d.from) : d.from) + ' → ' + (FS.roleName ? FS.roleName(d.to) : d.to);
  else if (a.action === 'active') extra = d.to ? trU('pe.aActiveOn') : trU('pe.aActiveOff');
  return (
    <div className="audit-row">
      <span className="audit-dot" />
      <div className="audit-main">
        <div className="audit-act">{trU(AUDIT_ACTION[a.action] || 'pe.aChange')}{extra ? <span className="audit-extra"> · {extra}</span> : null}</div>
        <div className="audit-meta">{a.actorName || '—'} · {fmtWhen(a.createdAt)}</div>
      </div>
    </div>
  );
}

function UserManagement({ users, setUsers, currentId, roles, onRolesChanged, canManageRoles, fleet, businessUnits, ownerAdmin }) {
  const cloud = !!(window.CLOUD && window.CLOUD.active && window.API);
  const [rows, setRows] = uSu(cloud ? null : (users || []));
  const [edit, setEdit] = uSu(null);
  const [busy, setBusy] = uSu(false);
  const [err, setErr] = uSu(null);
  const [tab, setTab] = uSu('users');
  const [resetReqs, setResetReqs] = uSu([]);
  const [q, setQ] = uSu('');
  const [fRole, setFRole] = uSu('');
  const [fStatus, setFStatus] = uSu('');
  const toRow = (u) => ({ id: u.id, name: u.name, role: u.role, user: u.username, pin: '', sub: u.sub || '', color: u.color || FS.ROLE_COLORS[u.role] || '#22A7A1', permissions: u.permissions || null, fleetScope: u.fleetScope || 'all', unitScope: u.unitScope || 'all', active: u.active !== false, mustChangePassword: !!u.mustChangePassword, weakPassword: !!u.weakPassword, lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null });
  const refreshReqs = () => { if (cloud) window.API.users.resetRequests('pending').then((r) => setResetReqs(r.data || [])).catch(() => {}); };
  const refresh = () => {
    if (!cloud) { setRows(users || []); return; }
    window.API.users.list().then((r) => setRows((r.data || []).map(toRow))).catch((e) => setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal memuat user'));
    refreshReqs();
  };
  uEu(() => { refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const openReset = (rq) => { if (!rq.userId) return; const row = (rows || []).find((x) => x.id === rq.userId); if (!row) return; setErr(null); setEdit({ ...row, pin: '', mustChangePassword: true, _resetReqId: rq.id }); };
  const rejectReq = async (rq) => { try { await window.API.users.handleResetRequest(rq.id, 'ditolak'); refreshReqs(); } catch (e) {} };
  const list = rows || [];
  const save = async (u, remove) => {
    setErr(null);
    if (!cloud) {
      if (remove) { if (!confirm(trU('um.removeConfirm'))) return; setUsers((p) => p.filter((x) => x.id !== u.id)); setEdit(null); return; }
      const clean = { ...u }; delete clean._new;
      setUsers((p) => p.find((x) => x.id === u.id) ? p.map((x) => x.id === u.id ? clean : x) : [...p, clean]);
      setEdit(null); return;
    }
    setBusy(true);
    try {
      if (remove) { if (!confirm(trU('um.removeConfirm'))) { setBusy(false); return; } await window.API.users.remove(u.id); }
      else if (u._new) { await window.API.users.create({ name: u.name.trim(), username: u.user.trim(), password: u.pin, role: u.role, sub: u.sub || '', color: u.color, permissions: u.permissions || null, fleetScope: u.fleetScope || 'all', unitScope: u.unitScope || 'all' }); }
      else {
        const body = { name: u.name.trim(), username: u.user.trim(), role: u.role, sub: u.sub || '', color: u.color, permissions: u.permissions || null, fleetScope: u.fleetScope || 'all', unitScope: u.unitScope || 'all', mustChangePassword: !!u.mustChangePassword };
        if (u.pin) body.password = u.pin;
        await window.API.users.update(u.id, body);
        if (u._resetReqId && u.pin) { try { await window.API.users.handleResetRequest(u._resetReqId, 'selesai'); } catch (e) {} }
      }
      setEdit(null); refresh();
    } catch (e) { setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal menyimpan'); }
    finally { setBusy(false); }
  };
  const addNew = () => { setErr(null); setEdit({ id: FS.newUserId(), name: '', role: 'finance', user: '', pin: '', sub: '', color: FS.roleColor('finance'), permissions: null, fleetScope: 'all', unitScope: 'all', _new: true }); };
  const RoleBadge = window.AUTH.RoleBadge;
  const filtered = list.filter((u) => {
    if (fRole && u.role !== fRole) return false;
    if (fStatus === 'active' && u.active === false) return false;
    if (fStatus === 'inactive' && u.active !== false) return false;
    if (q) { const s = q.toLowerCase(); if (!((u.name || '').toLowerCase().includes(s) || (u.user || '').toLowerCase().includes(s))) return false; }
    return true;
  });
  const tabs = canManageRoles ? (
    <div className="gran-seg" style={{ marginBottom: 14 }}>
      <button className={`gran-btn ${tab === 'users' ? 'on' : ''}`} onClick={() => setTab('users')}>{trU('um.tabUsers')}</button>
      <button className={`gran-btn ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}>{trU('um.tabRoles')}</button>
    </div>
  ) : null;
  if (canManageRoles && tab === 'roles') return <div className="screen-enter">{tabs}<RoleManager onChanged={onRolesChanged} /></div>;
  return (
    <div className="screen-enter">
      {tabs}
      <div className="um-toolbar">
        <div className="um-search"><IconSearch s={15} /><input placeholder={trU('um.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />{q && <button className="jp-icon" onClick={() => setQ('')}><IconClose s={14} /></button>}</div>
        <select className="um-filter" value={fRole} onChange={(e) => setFRole(e.target.value)}><option value="">{trU('um.allRoles')}</option>{FS.roleList().map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="um-filter" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">{trU('um.allStatus')}</option><option value="active">{trU('um.active')}</option><option value="inactive">{trU('um.inactive')}</option></select>
        <button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trU('um.add')}</button>
      </div>
      {!cloud && <div className="um-offline">· offline (local only)</div>}
      {err && <div className="login-err" style={{ margin: '4px 0 12px' }}><IconClose s={14} />{err}</div>}
      {resetReqs.length > 0 && (
        <div className="card um-reqs">
          <div className="um-reqs-head"><IconLock s={15} />{trU('um.resetReqs', { n: resetReqs.length })}</div>
          {resetReqs.map((rq) => (
            <div key={rq.id} className="um-req-row">
              <div className="um-req-main"><div className="um-req-user">@{rq.username}{rq.userId ? (rq.userName ? ' · ' + rq.userName : '') : <span className="um-req-unknown">{trU('um.reqUnknown')}</span>}</div><div className="um-req-meta">{fmtWhen(rq.requestedAt)}{rq.note ? ' · ' + rq.note : ''}</div></div>
              <div className="um-req-actions">{rq.userId && rq.userActive !== false && <button className="btn btn-primary btn-sm" onClick={() => openReset(rq)}><IconLock s={13} />{trU('um.reqReset')}</button>}<button className="btn btn-ghost btn-sm" onClick={() => rejectReq(rq)}>{trU('um.reqReject')}</button></div>
            </div>
          ))}
        </div>
      )}
      {rows === null ? <div className="card"><div className="so-empty">{trU('common.loading') || 'Memuat…'}</div></div>
        : filtered.length === 0 ? <div className="card"><div className="so-empty">{trU('um.none')}</div></div>
          : (
            <div className="um-table-wrap card">
              <table className="um-table">
                <thead><tr><th>{trU('um.colName')}</th><th>{trU('um.colRole')}</th><th>{trU('um.colScope')}</th><th>{trU('um.colStatus')}</th><th>{trU('um.colLast')}</th><th /></tr></thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} onClick={() => { setErr(null); setEdit(u); }}>
                      <td><div className="um-td-name"><span className="user-av sm" style={{ background: u.color }}>{FS.initials(u.name)}</span><div><div className="um-name2">{u.name}{u.id === currentId && <span className="um-you">{trU('um.you')}</span>}</div><div className="um-user2">@{u.user}</div></div></div></td>
                      <td><RoleBadge role={u.role} size="sm" />{u.permissions && <span className="um-custom-chip" title={trU('pe.customized')}>{trU('um.customTag')}</span>}</td>
                      <td className="um-scope">{u.fleetScope === 'all' || u.fleetScope == null ? trU('um.fleetAll') : (Array.isArray(u.fleetScope) ? u.fleetScope.join(', ') : '—')}</td>
                      <td>{u.active === false ? <span className="um-st off">{trU('um.inactive')}</span> : <span className="um-st on">{trU('um.active')}</span>}{u.weakPassword && <span className="um-weakpw" title={trU('um.weakPwHint')}><IconLock s={10} />{trU('um.weakPw')}</span>}</td>
                      <td className="um-last">{fmtWhen(u.lastLoginAt)}</td>
                      <td className="um-chev"><IconCaret s={15} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      {edit && <UserSlideOver row={edit} users={list} onSave={save} onClose={() => setEdit(null)} busy={busy} fleet={fleet} businessUnits={businessUnits} currentId={currentId} ownerAdmin={ownerAdmin} />}
    </div>
  );
}

/* ---------------- Role management (Peran) ---------------- */
const ROLE_SWATCHES = ['#065489', '#0B7EB1', '#138FB3', '#22A7A1', '#3FB8B2', '#E8A33D', '#C9603F', '#7A5AF8', '#D6455D', '#5B8C3A'];
function RoleSlideOver({ row, onSave, onClose, busy, err }) {
  const [f, setF] = uSu(row);
  const [confirmSave, setConfirmSave] = uSu(false);
  uEu(() => { const o = (e) => e.key === 'Escape' && (confirmSave ? setConfirmSave(false) : onClose()); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [confirmSave]);
  const set = (p) => setF({ ...f, ...p });
  const perms = editablePerms(f.permissions || {});
  const orig = uMu(() => editablePerms(row.permissions || {}), []);
  const diff = permLabelDiff(orig, perms);
  const valid = (f.name || '').trim();
  const doSave = () => { if (!valid) return; if (diff.added.length || diff.removed.length) setConfirmSave(true); else onSave(f); };
  return (
    <div className="slideover-scrim" onClick={onClose}>
      <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
        <div className="so-head"><div className="so-title">{f._new ? trU('rm.add') : f.name}{f.builtin && <span className="um-you">{trU('rm.builtin')}</span>}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="so-body">
          <div className="so-section">
            <label className="fld-label" style={{ marginTop: 0 }}>{trU('rm.name')}</label>
            <input className="fld" value={f.name} placeholder={trU('rm.namePh')} onChange={(e) => set({ name: e.target.value })} />
            <label className="fld-label">{trU('rm.color')}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{ROLE_SWATCHES.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} title={c} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: (f.color === c ? '3px solid var(--ink)' : '2px solid var(--border)'), cursor: 'pointer' }} />)}</div>
          </div>
          <div className="so-section"><div className="so-sec-title">{trU('pe.aksesEfektif')}</div><AksesEfektif perms={perms} /></div>
          <div className="so-section"><div className="so-sec-title">{trU('rm.caps')}</div><PermissionEditor value={perms} onChange={(next) => set({ permissions: next })} note={trU('pe.roleEditHint')} /></div>
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="so-foot">
          {!f._new && !f.builtin && <button className="btn btn-ghost so-del" disabled={busy} onClick={() => onSave(f, true)}><IconTrash s={15} />{trU('rm.delete')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trU('common.cancel') || 'Batal'}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={doSave}>{busy ? '…' : (diff.added.length || diff.removed.length ? trU('pe.saveN', { n: diff.added.length + diff.removed.length }) : trU('rm.save'))}</button>
        </div>
        {confirmSave && (
          <div className="so-confirm-scrim" onClick={() => setConfirmSave(false)}>
            <div className="so-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="so-confirm-h">{trU('pe.confirmTitle')}</div>
              {diff.added.length > 0 && <div className="so-diff add"><b>+{diff.added.length}</b> {diff.added.join(', ')}</div>}
              {diff.removed.length > 0 && <div className="so-diff rem"><b>−{diff.removed.length}</b> {diff.removed.join(', ')}</div>}
              <div className="so-confirm-foot"><button className="btn btn-ghost" onClick={() => setConfirmSave(false)}>{trU('common.cancel') || 'Batal'}</button><button className="btn btn-primary" disabled={busy} onClick={() => onSave(f)}>{busy ? '…' : trU('pe.confirmSave')}</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function RoleManager({ onChanged }) {
  const [rows, setRows] = uSu(() => FS.roleList());
  const [edit, setEdit] = uSu(null);
  const [busy, setBusy] = uSu(false);
  const [err, setErr] = uSu(null);
  const refresh = () => { if (window.API && window.API.roles) window.API.roles.list().then((r) => { if (r && Array.isArray(r.data)) { FS.setRoles(r.data); setRows(FS.roleList()); } }).catch(() => {}); };
  uEu(() => { refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const capCount = (perms) => EDITABLE_KEYS.filter((k) => (perms || {})[k]).length;
  const save = async (role, remove) => {
    setErr(null); setBusy(true);
    try {
      if (remove) { if (!confirm(trU('rm.deleteConfirm', { n: role.name }))) { setBusy(false); return; } await window.API.roles.remove(role.id); }
      else if (role._new) await window.API.roles.create({ name: (role.name || '').trim(), color: role.color, permissions: role.permissions || {} });
      else await window.API.roles.update(role.id, { name: (role.name || '').trim(), color: role.color, permissions: role.permissions || {} });
      setEdit(null); refresh(); onChanged && onChanged();
    } catch (e) { setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal menyimpan peran'); }
    finally { setBusy(false); }
  };
  const addNew = () => { setErr(null); setEdit({ id: '', name: '', color: '#22A7A1', permissions: { cashflow: true, seeMoney: true }, _new: true }); };
  return (
    <div className="screen-enter">
      <div className="um-toolbar"><div style={{ flex: 1, fontSize: 13, color: 'var(--text-mut)' }}>{trU('rm.intro', { n: rows.length })}</div><button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trU('rm.add')}</button></div>
      {err && !edit && <div className="login-err" style={{ margin: '4px 0 12px' }}><IconClose s={14} />{err}</div>}
      <div className="um-table-wrap card">
        <table className="um-table">
          <thead><tr><th>{trU('rm.name')}</th><th>{trU('rm.colCaps')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => { setErr(null); setEdit({ id: r.id, name: r.name, color: r.color, builtin: r.builtin, permissions: { ...r.perms } }); }}>
                <td><div className="um-td-name"><span className="user-av sm" style={{ background: r.color }}><IconShield s={16} /></span><div className="um-name2">{r.name}{r.builtin && <span className="um-you">{trU('rm.builtin')}</span>}</div></div></td>
                <td>{trU('rm.capsN', { n: capCount(r.perms) })}</td>
                <td className="um-chev"><IconCaret s={15} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <RoleSlideOver row={edit} onSave={save} onClose={() => setEdit(null)} busy={busy} err={err} />}
    </div>
  );
}

window.USERMGMT = { UserManagement, RoleManager };
