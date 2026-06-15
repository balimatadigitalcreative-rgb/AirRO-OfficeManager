/* global React, FS, API, CLOUD */
/* AirRO — User Management (General Manager). window.USERMGMT
   When signed into the backend, this screen reads/writes real backend users
   via the /users API so created accounts can actually log in. When offline it
   falls back to the local (localStorage) user list. */
const { useState: uSu } = React;
const trU = (k, v) => window.t(k, v);
function IcU(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

const ROLE_OPTS = ['owner', 'gm', 'hrd', 'finance', 'adminfin'];

function UserModal({ row, users, onSave, onClose, busy }) {
  const [f, setF] = uSu(row);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const dupUser = users.some((u) => u.id !== f.id && (u.user || '').toLowerCase() === (f.user || '').trim().toLowerCase());
  // PIN required when creating; on edit, leave blank to keep the existing password.
  const pinOk = f._new ? /^\d{4,}$/.test(f.pin || '') : (!f.pin || /^\d{4,}$/.test(f.pin));
  const valid = f.name.trim() && /^[a-zA-Z0-9._-]{3,}$/.test((f.user || '').trim()) && pinOk && !dupUser;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trU('um.add') : trU('um.edit')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.name')}</label>
          <input className="fld" value={f.name} placeholder="e.g. Budi Santoso" onChange={(e) => set({ name: e.target.value })} />
          <label className="fld-label">{trU('um.role')}</label>
          <UI.Dropdown value={f.role} options={ROLE_OPTS.map((r) => ({ value: r, label: trU('role.' + r) }))} onChange={(r) => set({ role: r, color: FS.ROLE_COLORS[r] || f.color })} />
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.username')}</label>
              <input className="fld" value={f.user} placeholder="username" onChange={(e) => set({ user: e.target.value.replace(/\s/g, '') })} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="fld-label" style={{ marginTop: 0 }}>{trU('um.password')}</label>
              <input className="fld tnum" inputMode="numeric" value={f.pin} placeholder={f._new ? '4-digit PIN' : '•••• (unchanged)'} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </div>
          </div>
          {dupUser && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{trU('um.dup')}</div>}
          <label className="fld-label">{trU('um.note')}</label>
          <input className="fld" value={f.sub || ''} placeholder={trU('um.notePh')} onChange={(e) => set({ sub: e.target.value })} />
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

function UserManagement({ users, setUsers, currentId }) {
  const cloud = !!(window.CLOUD && window.CLOUD.active && window.API);
  const [rows, setRows] = uSu(cloud ? null : (users || []));
  const [edit, setEdit] = uSu(null);
  const [busy, setBusy] = uSu(false);
  const [err, setErr] = uSu(null);

  const toRow = (u) => ({ id: u.id, name: u.name, role: u.role, user: u.username, pin: '', sub: u.sub || '', color: u.color || FS.ROLE_COLORS[u.role] || '#22A7A1' });

  const refresh = () => {
    if (!cloud) { setRows(users || []); return; }
    window.API.users.list()
      .then((r) => setRows((r.data || []).map(toRow)))
      .catch((e) => setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Failed to load users'));
  };
  React.useEffect(() => { refresh(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const list = rows || [];

  const save = async (u, remove) => {
    setErr(null);
    if (!cloud) {
      // offline fallback: local-only list
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
        await window.API.users.create({ name: u.name.trim(), username: u.user.trim(), password: u.pin, role: u.role, sub: u.sub || '', color: u.color });
      } else {
        const body = { name: u.name.trim(), username: u.user.trim(), role: u.role, sub: u.sub || '', color: u.color };
        if (u.pin) body.password = u.pin;   // only change the password when re-entered
        await window.API.users.update(u.id, body);
      }
      setEdit(null);
      refresh();
    } catch (e) {
      setErr((e.body && e.body.error && e.body.error.message) || e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const addNew = () => { setErr(null); setEdit({ id: FS.newUserId(), name: '', role: 'finance', user: '', pin: '', sub: '', color: FS.ROLE_COLORS.finance, _new: true }); };
  const RoleBadge = window.AUTH.RoleBadge;
  return (
    <div className="screen-enter">
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
              <div style={{ marginTop: 6 }}><RoleBadge role={u.role} size="sm" /></div>
            </div>
            <span className="um-edit"><IconPencil s={15} /></span>
          </div>
        ))}
      </div>
      {edit && <UserModal row={edit} users={list} onSave={save} onClose={() => setEdit(null)} busy={busy} />}
    </div>
  );
}

window.USERMGMT = { UserManagement };
