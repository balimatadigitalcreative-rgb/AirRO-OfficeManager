/* global React, FS */
const { useState: uSs } = React;
const trS = (k, v) => window.t(k, v);
function IcS(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

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

function SettingsScreen({ cats, onChange, canReset, onResetData, settings, onSettingsChange, entries, accounts, catLabel }) {
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

      <BackupSection entries={entries} accounts={accounts} catLabel={catLabel} />

      {canReset && (
        <div className="card danger-zone">
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--neg)' }}>{trS('set.resetTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trS('set.resetIntro')}</div>
          </div>
          <button className="btn" style={{ background: 'var(--neg)', color: '#fff' }} onClick={onResetData}>{trS('set.resetBtn')}</button>
        </div>
      )}
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