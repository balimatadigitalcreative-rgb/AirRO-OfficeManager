/* global React, FS */
const { useState: uSs, useEffect: uEs } = React;
const trS = (k, v) => window.t(k, v);
function IcS(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

// ── SELECTIVE DATA WIPE (post-trial cleanup) ─────────────────────────────────
// Replaces the old vague "reset" (which only nuked cash entries with a bare confirm()).
// This is the ONE documented path. Flow: pick categories → PREVIEW exact counts → type
// HAPUS + your password → the server backs up FIRST, then deletes in one transaction.
// Users/roles are never wipeable, so login always survives.
const WIPE_GROUPS = [
  ['distribusi', 'Distribusi'], ['pelanggan', 'Pelanggan'], ['gudang', 'Gudang'],
  ['keuangan', 'Keuangan'], ['hrd', 'HRD'], ['lain', 'Lainnya'], ['konfigurasi', 'Konfigurasi aplikasi'],
];
const KNOWN_GROUPS = new Set(WIPE_GROUPS.map(([g]) => g));
// If the server ever adds a category in a group this client doesn't know about, it must
// still be shown — bucket it under "Lainnya" rather than rendering it nowhere. (A silently
// dropped category in a DELETE tool is exactly the kind of gap that bites later.)
function GROUPS_WITH_FALLBACK(cats) {
  const hasUnknown = (cats || []).some((c) => !KNOWN_GROUPS.has(c.group));
  return hasUnknown ? [...WIPE_GROUPS, ['_other', 'Lainnya (baru)']] : WIPE_GROUPS;
}
function DataWipePanel() {
  const [cats, setCats] = uSs(null);
  const [sel, setSel] = uSs([]);
  const [step, setStep] = uSs('pick');     // pick → confirm → done
  const [prev, setPrev] = uSs(null);
  const [loadErr, setLoadErr] = uSs('');   // why the category list is empty (never hide it)
  const [confirmWord, setConfirmWord] = uSs('');
  const [pw, setPw] = uSs('');
  const [busy, setBusy] = uSs(false);
  const [err, setErr] = uSs('');
  const [result, setResult] = uSs(null);

  // Load the category list. NEVER swallow a failure here: an empty panel with no reason
  // is indistinguishable from "there is nothing to delete". The common real cause is a
  // STALE TOKEN — capabilities are baked into the JWT at login, so granting yourself
  // dataWipe and merely reloading leaves the client showing the panel (it reads fresh
  // permissions from /auth/me) while the server still rejects with 403. Say so plainly.
  uEs(() => {
    if (!(window.API && window.API.dataWipe)) { setLoadErr(trS('wipe.errNoApi')); setCats([]); return; }
    window.API.dataWipe.categories()
      .then((r) => { setCats(Array.isArray(r && r.data) ? r.data : []); setLoadErr(''); })
      .catch((e) => {
        const status = e && e.status;
        setLoadErr(status === 403 ? trS('wipe.errStaleToken')
          : trS('wipe.errLoad', { msg: (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || 'error' }));
        setCats([]);
      });
  }, []);
  const toggle = (k) => { setErr(''); setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])); };
  const msg = (e) => (e && e.body && e.body.error && e.body.error.message) || 'Gagal.';

  const doPreview = () => {
    if (!sel.length) { setErr(trS('wipe.errNone')); return; }
    setBusy(true); setErr('');
    window.API.dataWipe.preview(sel)
      .then((r) => { setPrev(r.data); setStep('confirm'); setBusy(false); })
      .catch((e) => { setErr(msg(e)); setBusy(false); });   // dependency errors land here
  };
  const doWipe = () => {
    setBusy(true); setErr('');
    window.API.dataWipe.wipe(sel, confirmWord.trim(), pw)
      .then((r) => { setResult(r.data); setStep('done'); setBusy(false); setPw(''); setConfirmWord(''); })
      .catch((e) => { setErr(msg(e)); setBusy(false); });
  };
  const restart = () => { setSel([]); setPrev(null); setResult(null); setStep('pick'); setErr(''); setPw(''); setConfirmWord(''); };

  if (!cats) return null;

  return (
    <div className="card danger-zone" style={{ display: 'block' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--neg)' }}>{trS('wipe.title')}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3, marginBottom: 12 }}>{trS('wipe.intro')}</div>

      {step === 'pick' && (<>
        {/* A failed/empty load must EXPLAIN itself rather than look like "nothing to delete". */}
        {loadErr && <div className="login-err" style={{ marginBottom: 10 }}>{IcS('IconClose', { s: 14 })}{loadErr}</div>}
        {!loadErr && cats.length === 0 && <div className="dist-empty">{trS('wipe.errEmpty')}</div>}
        {GROUPS_WITH_FALLBACK(cats).map(([g, label]) => {
          const items = cats.filter((c) => (KNOWN_GROUPS.has(c.group) ? c.group : '_other') === g);
          if (!items.length) return null;
          return (
            <div key={g} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-mut)', marginBottom: 5 }}>{label}</div>
              <div className="cat-chips">
                {items.map((c) => (
                  <button key={c.key} type="button" className={`cat-chip ${sel.includes(c.key) ? 'on' : ''}`} onClick={() => toggle(c.key)}
                    title={c.deps.length ? trS('wipe.needs') + ': ' + c.deps.join(', ') : undefined}>
                    {sel.includes(c.key) ? IcS('IconCheck', { s: 14 }) : <span style={{ width: 14 }} />}{c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '8px 0 10px' }}>{trS('wipe.neverNote')}</div>
        {err && <div className="login-err" style={{ marginBottom: 8 }}>{IcS('IconClose', { s: 14 })}{err}</div>}
        <button className="btn" style={{ background: 'var(--neg)', color: '#fff' }} disabled={busy || !sel.length} onClick={doPreview}>
          {busy ? '…' : trS('wipe.previewBtn', { n: sel.length })}
        </button>
      </>)}

      {step === 'confirm' && prev && (<>
        <div className="dist-infobox" style={{ marginBottom: 10 }}>{IcS('IconWarn', { s: 16 })}<span>{trS('wipe.willDelete')}</span></div>
        {prev.categories.map((c) => (
          <div key={c.key} className="dist-txn" style={{ padding: '8px 0' }}>
            <div className="dist-txn-mid"><div className="dist-txn-name">{c.label}</div></div>
            <b className="tnum" style={{ color: c.count ? 'var(--neg)' : 'var(--text-faint)' }}>{c.count}</b>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span>{trS('wipe.total')}</span><span className="tnum" style={{ color: 'var(--neg)' }}>{prev.total}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mut)', margin: '10px 0 4px' }}>{trS('wipe.backupNote')}</div>
        <label className="fld-label">{trS('wipe.typeLabel')}</label>
        <input className="fld" value={confirmWord} placeholder="HAPUS" autoComplete="off" onChange={(e) => setConfirmWord(e.target.value)} />
        <label className="fld-label">{trS('wipe.pwLabel')}</label>
        <input className="fld" type="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
        {err && <div className="login-err" style={{ marginTop: 8 }}>{IcS('IconClose', { s: 14 })}{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={restart}>{trS('wipe.back')}</button>
          <button className="btn" style={{ background: 'var(--neg)', color: '#fff' }}
            disabled={busy || confirmWord.trim() !== 'HAPUS' || !pw} onClick={doWipe}>
            {busy ? trS('wipe.working') : trS('wipe.confirmBtn', { n: prev.total })}
          </button>
        </div>
      </>)}

      {step === 'done' && result && (<>
        <div className="dist-infobox" style={{ marginBottom: 10 }}>{IcS('IconCheck', { s: 16 })}<span>{trS('wipe.doneMsg', { n: result.total })}</span></div>
        {result.categories.filter((c) => c.count).map((c) => (
          <div key={c.key} style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>· {c.label}: <b>{c.count}</b></div>
        ))}
        <div style={{ marginTop: 12, fontSize: 12.5 }}>
          <div>{trS('wipe.backupMade')}</div>
          <code style={{ display: 'block', wordBreak: 'break-all', background: 'var(--card-soft)', padding: '6px 8px', borderRadius: 8, marginTop: 4 }}>{result.backupFile}</code>
          <div style={{ marginTop: 8 }}>{trS('wipe.restoreHow')}</div>
          <code style={{ display: 'block', wordBreak: 'break-all', background: 'var(--card-soft)', padding: '6px 8px', borderRadius: 8, marginTop: 4 }}>{result.restoreHint}</code>
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={restart}>{trS('wipe.done')}</button>
      </>)}
    </div>
  );
}

/* icon picker popover */
function IconPicker({ value, onPick }) {
  const [open, setOpen] = uSs(false);
  return (
    <div className="iconpick" tabIndex={0} onBlur={() => setOpen(false)}>
      <button className="iconpick-btn" onClick={() => setOpen(!open)} title="Change icon">
        {IcS(value, { s: 18 })}
      </button>
      {open && (
        <div className="iconpick-menu">
          {FS.ICON_CHOICES.map((ic) => (
            <button key={ic} className={`iconpick-opt ${ic === value ? 'on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(ic); setOpen(false); }}>
              {IcS(ic, { s: 18 })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CatGroup({ title, type, list, onChange }) {
  const accent = type === 'income' ? 'var(--green-800)' : 'var(--neg)';
  const update = (i, patch) => { const n = list.slice(); n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => { const n = list.slice(); n.splice(i, 1); onChange(n); };
  const add = () => onChange([...list, { key: FS.newCatKey(), label: '', icon: type === 'income' ? 'IconCoinIn' : 'IconDots' }]);
  return (
    <div className="card cat-group">
      <div className="cat-group-head">
        <span className="icon-tile" style={{ background: type === 'income' ? 'var(--mint-100)' : '#EAF1F4', color: type === 'income' ? 'var(--green-800)' : '#5E7A88', flexShrink: 0 }}>
          {type === 'income' ? <IconCoinIn s={19} /> : <IconCoinOut s={19} />}
        </span>
        <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</div>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--text-mut)', whiteSpace: 'nowrap' }}>{trS('set.items', { n: list.length })}</span>
      </div>
      <div className="cat-edit-list">
        {list.map((c, i) => (
          <div key={c.key} className="cat-edit-row">
            <IconPicker value={c.icon} onPick={(ic) => update(i, { icon: ic })} />
            <input className="cat-edit-input" value={c.label} placeholder={trS('set.categories')}
              onChange={(e) => update(i, { label: e.target.value })} />
            <button className="del-btn" style={{ opacity: 1 }} title="Remove" onClick={() => remove(i)} disabled={list.length <= 1}>
              <IconClose s={15} />
            </button>
          </div>
        ))}
      </div>
      <button className="add-cat-btn" style={{ color: accent }} onClick={add}><IconPlus s={16} />{trS('set.addcat')}</button>
    </div>
  );
}

function BackupSection({ entries, accounts, catLabel }) {
  const fileRef = React.useRef(null);
  const [msg, setMsg] = React.useState(null);
  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm(trS('bk.restoreConfirm'))) return;
    window.BACKUP.importAll(f, (r) => {
      if (r.ok) { setMsg({ ok: true, t: trS('bk.restored', { n: r.count }) }); setTimeout(() => location.reload(), 900); }
      else setMsg({ ok: false, t: trS('bk.restoreErr') });
    });
  };
  return (
    <div className="card alert-settings">
      <div className="cat-group-head" style={{ marginBottom: 6 }}>
        <span className="icon-tile" style={{ background: 'var(--mint-100)', color: 'var(--green-800)', flexShrink: 0 }}><IconDownload s={19} /></span>
        <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{trS('bk.title')}</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 14 }}>{trS('bk.intro')}</div>
      <div className="bk-actions">
        <button className="btn btn-primary" onClick={() => window.BACKUP.exportAll()}><IconDownload s={16} />{trS('bk.export')}</button>
        <button className="btn btn-ghost" onClick={() => fileRef.current && fileRef.current.click()}><IconArrowUp s={16} />{trS('bk.restore')}</button>
        <button className="btn btn-ghost" onClick={() => window.BACKUP.exportTxnsCSV(entries, accounts, catLabel)}><IconInvoice s={16} />{trS('bk.csv')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onPick} />
      </div>
      {msg && <div className="bk-msg" style={{ color: msg.ok ? 'var(--green-700)' : 'var(--neg)' }}>{msg.ok ? <IconCheck s={15} /> : <IconClose s={15} />}{msg.t}</div>}
      <div className="bk-note">{trS('bk.note')}</div>
    </div>
  );
}

// ── BUSINESS UNIT (unit bisnis) — STAGE 1: labels only ───────────────────────
// Manage the dictionary (add / rename / deactivate). Editing a unit here changes NO number:
// core records keep the same unit id, and this stage never filters or splits by unit. Owner-
// only (cap: manageBusinessUnits). Deactivate rather than delete — a unit may label history.
function BusinessUnitsPanel() {
  const [units, setUnits] = uSs(null);
  const [loadErr, setLoadErr] = uSs('');
  const [adding, setAdding] = uSs('');
  const [code, setCode] = uSs('');
  const [editId, setEditId] = uSs(null);
  const [editName, setEditName] = uSs('');
  const [busy, setBusy] = uSs(false);
  const [err, setErr] = uSs('');

  const load = () => {
    if (!(window.API && window.API.businessUnits)) { setLoadErr(trS('bu.errNoApi')); setUnits([]); return; }
    window.API.businessUnits.list()
      .then((r) => { setUnits(Array.isArray(r && r.data) ? r.data : []); setLoadErr(''); })
      .catch((e) => { setLoadErr((e && e.status === 403) ? trS('bu.errPerm') : ((e && e.body && e.body.error && e.body.error.message) || trS('common.loadFail'))); setUnits([]); });
  };
  uEs(() => { load(); }, []);
  const msg = (e) => (e && e.body && e.body.error && e.body.error.message) || trS('common.loadFail');

  const add = () => {
    const name = adding.trim();
    if (!name || busy) return;
    setBusy(true); setErr('');
    window.API.businessUnits.create({ name, code: code.trim() })
      .then(() => { setAdding(''); setCode(''); setBusy(false); load(); })
      .catch((e) => { setErr(msg(e)); setBusy(false); });
  };
  const saveEdit = () => {
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true); setErr('');
    window.API.businessUnits.update(editId, { name })
      .then(() => { setEditId(null); setEditName(''); setBusy(false); load(); })
      .catch((e) => { setErr(msg(e)); setBusy(false); });
  };
  const toggleActive = (u) => {
    setBusy(true); setErr('');
    window.API.businessUnits.update(u.id, { active: !u.active })
      .then(() => { setBusy(false); load(); })
      .catch((e) => { setErr(msg(e)); setBusy(false); });
  };

  return (
    <div className="card alert-settings">
      <div className="cat-group-head" style={{ marginBottom: 6 }}>
        <span className="icon-tile" style={{ background: 'var(--navy-50, #EAF1F4)', color: 'var(--brand, #065489)', flexShrink: 0 }}>{IcS('IconStore', { s: 19 })}</span>
        <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{trS('bu.title')}</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 16 }}>{trS('bu.intro')}</div>

      {loadErr && <div className="login-err" style={{ marginBottom: 12 }}>{IcS('IconClose', { s: 14 })}{loadErr}</div>}
      {units === null && !loadErr && <div className="dist-empty">{trS('common.loading')}</div>}

      {(units || []).map((u) => (
        <div key={u.id} className="bu-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
          {editId === u.id ? (
            <>
              <input className="fld" style={{ flex: 1, margin: 0 }} value={editName} autoFocus onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveEdit}>{trS('bu.save')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditId(null); setErr(''); }}>{trS('bu.cancel')}</button>
            </>
          ) : (
            <>
              {u.code ? <span className="dist-badge" style={{ background: 'var(--navy-50, #EAF1F4)', color: 'var(--brand, #065489)' }}>{u.code}</span> : null}
              <span style={{ flex: 1, fontWeight: 600, opacity: u.active ? 1 : 0.5 }}>{u.name}{u.id === 'air' ? ' · ' + trS('bu.default') : ''}</span>
              {!u.active && <span className="dist-badge arsip">{trS('bu.inactive')}</span>}
              <button className="dist-link" onClick={() => { setEditId(u.id); setEditName(u.name); setErr(''); }}>{trS('bu.rename')}</button>
              {u.id !== 'air' && <button className="dist-link" style={{ color: u.active ? 'var(--neg)' : 'var(--green-800)' }} disabled={busy} onClick={() => toggleActive(u)}>{u.active ? trS('bu.deactivate') : trS('bu.activate')}</button>}
            </>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <input className="fld" style={{ flex: '1 1 160px', margin: 0 }} placeholder={trS('bu.namePh')} value={adding}
          onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input className="fld" style={{ width: 90, margin: 0, textTransform: 'uppercase' }} placeholder={trS('bu.codePh')} value={code}
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-primary" disabled={!adding.trim() || busy} onClick={add}>{IcS('IconPlus', { s: 16 })}{trS('bu.add')}</button>
      </div>
      {err && <div className="login-err" style={{ marginTop: 10 }}>{IcS('IconClose', { s: 14 })}{err}</div>}
      <div className="dist-infobox" style={{ marginTop: 14, marginBottom: 0 }}>{IcS('IconInvoice', { s: 16 })}<span>{trS('bu.stageNote')}</span></div>
    </div>
  );
}

function SettingsScreen({ cats, onChange, canWipe, canManageUnits, settings, onSettingsChange, entries, accounts, catLabel }) {
  const setIncome = (income) => onChange({ ...cats, income });
  const setExpense = (expense) => onChange({ ...cats, expense });
  const setThresh = (key, val) => onSettingsChange({ ...settings, [key]: val });
  return (
    <div className="screen-enter">
      <div className="settings-intro card">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{trS('set.categories')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-mut)', marginTop: 3 }}>{trS('set.catIntro')}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => onChange({ income: FS.INCOME_CATS.map((c) => ({ ...c })), expense: FS.EXPENSE_CATS.map((c) => ({ ...c })) })}>{trS('set.restore')}</button>
      </div>

      <div className="cat-grid">
        <CatGroup title={trS('set.saleInc')} type="income" list={cats.income} onChange={setIncome} />
        <CatGroup title={trS('set.expenses')} type="expense" list={cats.expense} onChange={setExpense} />
      </div>

      {settings && (
        <div className="card alert-settings">
          <div className="cat-group-head" style={{ marginBottom: 6 }}>
            <span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', flexShrink: 0 }}><IconBell s={19} /></span>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{trS('set.alertTitle')}</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 16 }}>{trS('set.alertIntro')}</div>
          <div className="thresh-grid">
            <ThreshInput label={trS('set.lowcash')} value={settings.lowCash} onChange={(v) => setThresh('lowCash', v)} />
            <ThreshInput label={trS('set.bigexp')} value={settings.bigExpense} onChange={(v) => setThresh('bigExpense', v)} />
          </div>
        </div>
      )}

      {settings && (
        <div className="card alert-settings">
          <div className="cat-group-head" style={{ marginBottom: 6 }}>
            <span className="icon-tile" style={{ background: 'var(--mint-100)', color: 'var(--green-800)', flexShrink: 0 }}><IconDrop s={19} /></span>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{trS('set.prodTitle')}</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 16 }}>{trS('set.prodIntro')}</div>
          <div className="thresh-grid">
            <ThreshInput label={trS('set.costGalon')} value={settings.costPerGalon} onChange={(v) => setThresh('costPerGalon', v)} />
          </div>
        </div>
      )}

      {/* Business unit dictionary (Stage 1 — labels only, changes no numbers). Owner-only. */}
      {canManageUnits && <BusinessUnitsPanel />}

      <BackupSection entries={entries} accounts={accounts} catLabel={catLabel} />

      {/* The ONE data-deletion path. The old blanket "reset" (cash entries only, single
          confirm(), no backup) is gone — this is selective, previewed, backed up and audited. */}
      {canWipe && <DataWipePanel />}
    </div>
  );
}

function ThreshInput({ label, value, onChange }) {
  const disp = value ? value.toLocaleString('id-ID') : '';
  return (
    <div className="thresh-item">
      <label className="fld-label" style={{ marginTop: 0 }}>{label}</label>
      <div className="amt-input" style={{ borderColor: 'var(--border)', padding: '8px 14px' }}>
        <span className="amt-rp" style={{ fontSize: 15 }}>Rp</span>
        <input inputMode="numeric" value={disp} placeholder="0" style={{ fontSize: 18 }}
          onChange={(e) => onChange(+e.target.value.replace(/\D/g, '') || 0)} />
      </div>
    </div>
  );
}

window.SETTINGS = { SettingsScreen };