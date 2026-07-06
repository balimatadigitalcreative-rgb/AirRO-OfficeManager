/* global React, FS, API, CLOUD */
/* AirRO — User Management (General Manager). window.USERMGMT
   Backend-connected: reads/writes real backend users via the /users API, with
   per-user feature permissions and GM-driven password reset. */
const { useState: uSu } = React;
const trU = (k, v) => window.t(k, v);
function IcU(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

const ROLE_OPTS = ['owner', 'gm', 'hrd', 'finance', 'adminfin'];

// Feature toggles shown to the GM, grouped. Keys map to the permission flags
// used across the app (see finance-store.js ROLES[*].perms).
const CAP_GROUPS = [
  { title: 'Keuangan', caps: [
    ['cashflow', 'Lihat Arus Kas'],
    ['seeMoney', 'Lihat Nominal Uang'],
    ['addEntry', 'Tambah Transaksi'],
    ['edit', 'Edit Transaksi'],
    ['delete', 'Hapus Transaksi'],
    ['allEntries', 'Semua Catatan'],
    ['setoran', 'Setoran'],
    ['reports', 'Laporan'],
  ] },
  { title: 'SDM / HRD', caps: [
    ['employees', 'Karyawan'],
    ['empDetail', 'Detail Karyawan'],
    ['attendance', 'Absensi'],
    ['payroll', 'Penggajian'],
    ['kasbon', 'Kasbon (ajukan)'],
    ['kasbonApprove', 'Setujui Kasbon'],
  ] },
  { title: 'Perusahaan & Admin', caps: [
    ['company', 'Dashboard Perusahaan'],
    ['approvals', 'Pengajuan'],
    ['settings', 'Pengaturan'],
    ['reset', 'Kelola User'],
  ] },
  { title: 'Distribusi', caps: [
    ['distribusi', 'Akses Distribusi (input & koreksi)'],
    ['distribusiCustomers', 'Kelola Pelanggan (tambah/impor)'],
    ['distribusiHargaMaster', 'Ubah Harga Master'],
    ['distribusiAudit', 'Lihat Log Audit'],
  ] },
];

function UserModal({ row, users, onSave, onClose, busy }) {
  const [f, setF] = uSu(row);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const dupUser = users.some((u) => u.id !== f.id && (u.user || '').toLowerCase() === (f.user || '').trim().toLowerCase());
  const pinOk = f._new ? /^\d{4,}$/.test(f.pin || '') : (!f.pin || /^\d{4,}$/.test(f.pin));
  const valid = f.name.trim() && /^[a-zA-Z0-9._-]{3,}$/.test((f.user || '').trim()) && pinOk && !dupUser;

  // Effective permissions: the per-user override if set, else the role defaults.
  const eff = f.permissions || FS.perms(f.role);
  const custom = !!f.permissions;
  const toggleCap = (key) => set({ permissions: { ...eff, [key]: !eff[key] } });
  const changeRole = (r) => set({ role: r, color: FS.roleColor(r) || f.color, permissions: null }); // reset to new role defaults
  const resetToRole = () => set({ permissions: null });

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trU('um.add') : trU('um.edit')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.name')}</label>
          <input className="fld" value={f.name} placeholder="e.g. Budi Santoso" onChange={(e) => set({ name: e.target.value })} />
          <label className="fld-label">{trU('um.role')}</label>
          <UI.Dropdown value={f.role} options={FS.roleList().map((r) => ({ value: r.id, label: r.name }))} onChange={changeRole} />
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.username')}</label>
              <input className="fld" value={f.user} placeholder="username" onChange={(e) => set({ user: e.target.value.replace(/\s/g, '') })} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="fld-label" style={{ marginTop: 0 }}>{f._new ? 'Password (PIN)' : trU('um.resetPw')}</label>
              <input className="fld tnum" inputMode="numeric" value={f.pin} placeholder={f._new ? 'min. 4 angka' : trU('um.newPwPh')} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </div>
          </div>
          {!f._new && <>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>Lupa password? Isi PIN baru di sini lalu Simpan, beri tahu user.</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 8, cursor: 'pointer', color: 'var(--text-mut)' }}>
              <input type="checkbox" checked={!!f.mustChangePassword} onChange={(e) => set({ mustChangePassword: e.target.checked })} />
              {trU('um.forceChange')}
            </label>
          </>}
          {dupUser && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{trU('um.dup')}</div>}
          <label className="fld-label">{trU('um.note')}</label>
          <input className="fld" value={f.sub || ''} placeholder={trU('um.notePh')} onChange={(e) => set({ sub: e.target.value })} />

          {/* ---- per-user feature permissions ---- */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
            <label className="fld-label" style={{ margin: 0 }}>Hak Akses Fitur</label>
            <span style={{ fontSize: 11.5, color: custom ? 'var(--green-700)' : 'var(--text-faint)' }}>
              {custom ? 'disesuaikan' : 'default role'}{custom && <button className="link-btn" style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--green-700)', cursor: 'pointer', fontWeight: 600 }} onClick={resetToRole}>reset</button>}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '2px 0 8px' }}>Centang fitur yang boleh diakses user ini.</div>
          {CAP_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mut)', marginBottom: 6 }}>{g.title}</div>
              <div className="cat-chips">
                {g.caps.map(([key, label]) => (
                  <button key={key} type="button" className={`cat-chip ${eff[key] ? 'on' : ''}`} onClick={() => toggleCap(key)}>
                    {eff[key] ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          {!f._new && users.length > 1 && <button className="btn btn-ghost" style={{ color: 'var(--neg)', marginRight: 'auto' }} disabled={busy} onClick={() => onSave(f, true)}><IconClose s={15} />{trU('um.remove')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trU('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onSave(f)}>{busy ? '…' : trU('um.save')}</button>
        </div>
      </div>
    </div>
  );
}

function UserManagement({ users, setUsers, currentId, roles, onRolesChanged, canManageRoles }) {
  const cloud = !!(window.CLOUD && window.CLOUD.active && window.API);
  const [rows, setRows] = uSu(cloud ? null : (users || []));
  const [edit, setEdit] = uSu(null);
  const [busy, setBusy] = uSu(false);
  const [err, setErr] = uSu(null);
  const [tab, setTab] = uSu('users');   // 'users' | 'roles'

  const toRow = (u) => ({ id: u.id, name: u.name, role: u.role, user: u.username, pin: '', sub: u.sub || '', color: u.color || FS.ROLE_COLORS[u.role] || '#22A7A1', permissions: u.permissions || null, mustChangePassword: !!u.mustChangePassword });

  const refresh = () => {
    if (!cloud) { setRows(users || []); return; }
    window.API.users.list()
      .then((r) => setRows((r.data || []).map(toRow)))
      .catch((e) => setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal memuat user'));
  };
  React.useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
      if (remove) {
        if (!confirm(trU('um.removeConfirm'))) { setBusy(false); return; }
        await window.API.users.remove(u.id);
      } else if (u._new) {
        await window.API.users.create({ name: u.name.trim(), username: u.user.trim(), password: u.pin, role: u.role, sub: u.sub || '', color: u.color, permissions: u.permissions || null });
      } else {
        const body = { name: u.name.trim(), username: u.user.trim(), role: u.role, sub: u.sub || '', color: u.color, permissions: u.permissions || null, mustChangePassword: !!u.mustChangePassword };
        if (u.pin) body.password = u.pin;   // only change the password when re-entered
        await window.API.users.update(u.id, body);
      }
      setEdit(null);
      refresh();
    } catch (e) {
      setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const addNew = () => { setErr(null); setEdit({ id: FS.newUserId(), name: '', role: 'finance', user: '', pin: '', sub: '', color: FS.roleColor('finance'), permissions: null, _new: true }); };
  const RoleBadge = window.AUTH.RoleBadge;
  if (canManageRoles && tab === 'roles') {
    return (
      <div className="screen-enter">
        <div className="gran-seg" style={{ marginBottom: 14 }}>
          <button className={`gran-btn ${tab === 'users' ? 'on' : ''}`} onClick={() => setTab('users')}>{trU('um.tabUsers')}</button>
          <button className={`gran-btn ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}>{trU('um.tabRoles')}</button>
        </div>
        <RoleManager onChanged={onRolesChanged} />
      </div>
    );
  }
  return (
    <div className="screen-enter">
      {canManageRoles && (
        <div className="gran-seg" style={{ marginBottom: 14 }}>
          <button className={`gran-btn ${tab === 'users' ? 'on' : ''}`} onClick={() => setTab('users')}>{trU('um.tabUsers')}</button>
          <button className={`gran-btn ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}>{trU('um.tabRoles')}</button>
        </div>
      )}
      <div className="hrr-head">
        <div style={{ fontSize: 13, color: 'var(--text-mut)' }}>
          {trU('um.intro', { n: list.length })}
          {!cloud && <span style={{ color: 'var(--neg)', marginLeft: 8 }}>· offline (local only)</span>}
        </div>
        <button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trU('um.add')}</button>
      </div>
      {err && <div className="login-err" style={{ margin: '4px 0 12px' }}><IconClose s={14} />{err}</div>}
      <div className="um-grid">
        {list.map((u) => (
          <div key={u.id} className="um-card card" onClick={() => { setErr(null); setEdit(u); }}>
            <span className="user-av" style={{ background: u.color, width: 46, height: 46 }}>{FS.initials(u.name)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="um-name">{u.name}{u.id === currentId && <span className="um-you">{trU('um.you')}</span>}</div>
              <div className="um-user">@{u.user}</div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <RoleBadge role={u.role} size="sm" />
                {u.permissions && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--green-700)', background: 'var(--pos-bg)', padding: '2px 7px', borderRadius: 999 }}>akses khusus</span>}
              </div>
            </div>
            <span className="um-edit"><IconPencil s={15} /></span>
          </div>
        ))}
      </div>
      {edit && <UserModal row={edit} users={list} onSave={save} onClose={() => setEdit(null)} busy={busy} />}
    </div>
  );
}

/* ---------------- Role management (Kelola Peran) ---------------- */
const ROLE_SWATCHES = ['#065489', '#0B7EB1', '#138FB3', '#22A7A1', '#3FB8B2', '#E8A33D', '#C9603F', '#7A5AF8', '#D6455D', '#5B8C3A'];

function RoleModal({ row, onSave, onClose, busy, err }) {
  const [f, setF] = uSu(row);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const perms = f.permissions || {};
  const toggleCap = (key) => set({ permissions: { ...perms, [key]: !perms[key] } });
  const valid = (f.name || '').trim();
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trU('rm.add') : trU('rm.edit')}{f.builtin && <span className="um-you">{trU('rm.builtin')}</span>}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <label className="fld-label" style={{ marginTop: 0 }}>{trU('rm.name')}</label>
          <input className="fld" value={f.name} placeholder={trU('rm.namePh')} onChange={(e) => set({ name: e.target.value })} />
          <label className="fld-label">{trU('rm.color')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLE_SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} title={c}
                style={{ width: 28, height: 28, borderRadius: 8, background: c, border: (f.color === c ? '3px solid var(--ink)' : '2px solid var(--border)'), cursor: 'pointer' }} />
            ))}
          </div>
          <label className="fld-label">{trU('rm.caps')}</label>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '2px 0 8px' }}>Centang fitur yang boleh diakses peran ini.</div>
          {CAP_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mut)', marginBottom: 6 }}>{g.title}</div>
              <div className="cat-chips">
                {g.caps.map(([key, label]) => (
                  <button key={key} type="button" className={`cat-chip ${perms[key] ? 'on' : ''}`} onClick={() => toggleCap(key)}>
                    {perms[key] ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot">
          {!f._new && !f.builtin && <button className="btn btn-ghost" style={{ color: 'var(--neg)', marginRight: 'auto' }} disabled={busy} onClick={() => onSave(f, true)}><IconClose s={15} />{trU('rm.delete')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trU('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onSave(f)}>{busy ? '…' : trU('rm.save')}</button>
        </div>
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
  React.useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const capCount = (perms) => Object.values(perms || {}).filter(Boolean).length;
  const save = async (role, remove) => {
    setErr(null); setBusy(true);
    try {
      if (remove) {
        if (!confirm(trU('rm.deleteConfirm', { n: role.name }))) { setBusy(false); return; }
        await window.API.roles.remove(role.id);
      } else if (role._new) {
        await window.API.roles.create({ name: (role.name || '').trim(), color: role.color, permissions: role.permissions || {} });
      } else {
        await window.API.roles.update(role.id, { name: (role.name || '').trim(), color: role.color, permissions: role.permissions || {} });
      }
      setEdit(null); refresh(); onChanged && onChanged();
    } catch (e) {
      setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Gagal menyimpan peran');
    } finally { setBusy(false); }
  };
  const addNew = () => { setErr(null); setEdit({ id: '', name: '', color: '#22A7A1', permissions: { cashflow: true, seeMoney: true }, _new: true }); };
  return (
    <div className="screen-enter">
      <div className="hrr-head">
        <div style={{ fontSize: 13, color: 'var(--text-mut)' }}>{trU('rm.intro', { n: rows.length })}</div>
        <button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trU('rm.add')}</button>
      </div>
      {err && !edit && <div className="login-err" style={{ margin: '4px 0 12px' }}><IconClose s={14} />{err}</div>}
      <div className="um-grid">
        {rows.map((r) => (
          <div key={r.id} className="um-card card" onClick={() => { setErr(null); setEdit({ id: r.id, name: r.name, color: r.color, builtin: r.builtin, permissions: { ...r.perms } }); }}>
            <span className="user-av" style={{ background: r.color, width: 44, height: 44 }}><IconShield s={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="um-name">{r.name}{r.builtin && <span className="um-you">{trU('rm.builtin')}</span>}</div>
              <div className="um-user">{trU('rm.capsN', { n: capCount(r.perms) })}</div>
            </div>
            <span className="um-edit"><IconPencil s={15} /></span>
          </div>
        ))}
      </div>
      {edit && <RoleModal row={edit} onSave={save} onClose={() => setEdit(null)} busy={busy} err={err} />}
    </div>
  );
}

window.USERMGMT = { UserManagement, RoleManager };
