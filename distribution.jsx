/* global React */
/* AirRO — Distribusi module screens. window.DIST. Separate from the cash book:
   all data comes from the /distribusi REST endpoints (never the AirRO Entry tables). */
const { useState: uSx, useEffect: uEx } = React;
const trD = (k, v) => window.t(k, v);
const AX = window.AIRRO;
function IcX(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
const rpX = (n) => (AX && AX.fmtCompact ? AX.fmtCompact(n) : String(n));
const rpFull = (n) => (window.FIN && FIN.fmt ? FIN.fmt(n) : String(n));
const numX = (n) => (n || 0).toLocaleString('id-ID');
const DW_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const METHOD_META = {
  lunas: { cls: 'lunas', label: 'dist.lunas' },
  bon: { cls: 'bon', label: 'dist.bon' },
  pelunasan: { cls: 'pelunasan', label: 'dist.pelunasan' },
};
const methodLabel = (m) => trD(METHOD_META[m] ? METHOD_META[m].label : 'dist.lunas') || m;
const CUST_TYPES = ['reguler', 'kos', 'cafe', 'bulk'];
const CUST_TAG = { reguler: 'reg', kos: 'kos', cafe: 'cafe', bulk: 'bulk' };
const typeLabel = (t) => (t === 'bulk' ? 'Bulk' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Reguler');
const initialsOf = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const AUDIT_KIND = { koreksi: { cls: 'koreksi', k: 'dist.akKoreksi' }, harga: { cls: 'harga', k: 'dist.akHarga' }, input: { cls: 'input', k: 'dist.akInput' }, impor: { cls: 'input', k: 'dist.akImpor' }, pelanggan: { cls: 'input', k: 'dist.akPelanggan' } };
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDT(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getDate() + ' ' + MONTHS_ID[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

// ── 7-day stacked bar (cash = navy, bon = amber) ──
function SevenDayChart({ last7 }) {
  const max = Math.max(1, ...last7.map((d) => d.lunas + d.bon));
  return (
    <div className="dist-chart">
      {last7.map((d) => {
        const wd = DW_ID[new Date(d.date + 'T00:00').getDay()];
        return (
          <div key={d.date} className="dist-chart-col" title={`${d.date} · ${trD('dist.lunas')} ${rpFull(d.lunas)} · ${trD('dist.bon')} ${rpFull(d.bon)}`}>
            <div className="dist-chart-bar">
              <div className="dist-bar-seg bon" style={{ height: (d.bon / max) * 100 + '%' }} />
              <div className="dist-bar-seg lunas" style={{ height: (d.lunas / max) * 100 + '%' }} />
            </div>
            <span className="dist-chart-lbl">{wd}</span>
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ icon, tile, fg, value, unit, label, cls, pill, pillCls, hero }) {
  return (
    <div className={`card dist-kpi ${hero ? 'dist-kpi-hero' : 'stat-box'}`}>
      <div className="dist-kpi-top">
        <span className={`icon-tile ${hero ? 'hero' : ''}`} style={hero ? null : { background: tile, color: fg }}>{IcX(icon, { s: 19 })}</span>
        {pill ? <span className={`dist-kpi-pill ${pillCls || ''}`}>{pill}</span> : null}
      </div>
      <div className={`tnum dist-kpi-val ${cls || ''}`}>{value}{unit ? <span className="dist-kpi-unit"> {unit}</span> : null}</div>
      <div className="dist-kpi-lbl">{label}</div>
    </div>
  );
}

function DistDashboard({ refreshKey, staffMode, onQuickInput, onOpenCustomers, today }) {
  const [sum, setSum] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  uEx(() => {
    let live = true; setErr(false);
    if (!(window.API && window.API.distribusi)) { setLoading(false); setErr(true); return; }
    window.API.distribusi.summary(today).then((r) => { if (live) { setSum(r.data); setLoading(false); } })
      .catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, today]);

  if (loading) return <div className="dist-dash screen-enter"><div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-mut)' }}>{trD('common.loading') || 'Memuat…'}</div></div>;
  if (err || !sum) return <div className="dist-dash screen-enter"><div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}><IconRefresh s={20} /><div style={{ marginTop: 8 }}>{trD('dist.loadErr')}</div></div></div>;

  const recent = sum.recent || [];
  const top = sum.topCustomers || [];
  const avgNota = sum.count ? Math.round(sum.amount / sum.count) : 0;
  return (
    <div className="dist-dash screen-enter">
      {staffMode && (
        <div className="dist-staff-banner"><span className="dist-staff-ic"><IconShield s={16} /></span><div><b>{trD('dist.staffMode')}</b><span>{trD('dist.staffModeSub')}</span></div></div>
      )}

      <div className="dist-grid">
        <div className="dist-main">
          <div className="dist-kpis">
            <Kpi hero icon="IconDrop" value={numX(sum.qty)} unit={trD('dist.galonUnit')} label={trD('dist.kpiGalon')} pill={trD('dist.pillToday')} pillCls="hero" />
            <Kpi icon="IconCoinIn" tile="var(--pos-bg)" fg="var(--green-800)" value={rpX(sum.uangMasuk)} label={trD('dist.kpiIn')} cls="amt-pos" pill={trD('dist.pillCash')} pillCls="pos" />
            <Kpi icon="IconInvoice" tile="var(--warn-bg)" fg="var(--warn)" value={rpX(sum.piutang)} label={trD('dist.kpiBon')} pill={trD('dist.pillPiutang')} pillCls="warn" />
            <Kpi icon="IconTx" tile="#EAF1F4" fg="#5E7A88" value={numX(sum.count)} label={trD('dist.kpiTxn')} pill={numX(sum.count) + ' ' + trD('dist.notaWord')} pillCls="blue" />
          </div>

          <div className="card dist-card">
            <div className="dist-card-head">
              <div className="sec-title">{trD('dist.chart7')}</div>
              <div className="dist-legend">
                <span><span className="dot navy" />{trD('dist.lunas')}</span>
                <span><span className="dot amber" />{trD('dist.bon')}</span>
              </div>
            </div>
            <SevenDayChart last7={sum.last7 || []} />
          </div>

          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title">{trD('dist.recent')}</div></div>
            {recent.length === 0 && <div className="dist-empty">{trD('dist.noTxn')}</div>}
            {recent.map((t) => (
              <div key={t.id} className="dist-txn">
                <span className="dist-txn-av">{(t.customerName || '?').slice(0, 1).toUpperCase()}</span>
                <div className="dist-txn-mid">
                  <div className="dist-txn-line1">
                    <span className="dist-txn-name">{t.customerName || '—'}</span>
                    <span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span>
                    {t.corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}
                  </div>
                  <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)}</div>
                </div>
                <div className="dist-txn-right">
                  <div className="tnum dist-txn-amt">{rpFull(t.amount)}</div>
                  <span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dist-rail">
          <div className="card dist-today-hero">
            <div className="dist-th-top"><span>{trD('dist.today')}</span><span className="dist-th-count">{numX(sum.count)} {trD('dist.notaWord')}</span></div>
            <div className="dist-th-metrics">
              <div><div className="dist-th-lbl">{trD('dist.kpiIn')}</div><div className="dist-th-val pos">{rpX(sum.uangMasuk)}</div></div>
              <div><div className="dist-th-lbl">{trD('dist.bonBaru')}</div><div className="dist-th-val warn">{rpX(sum.piutang)}</div></div>
            </div>
            <div className="dist-th-avg"><span>{trD('dist.avgNota')}</span><b className="tnum">{rpFull(avgNota)}</b></div>
          </div>

          <div className="card dist-quick">
            <div className="dist-quick-t">{trD('dist.quickInput')}</div>
            <div className="dist-quick-s">{trD('dist.quickInputSub')}</div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onQuickInput}><IconPlus s={16} />{trD('dist.quickInputBtn')}</button>
          </div>

          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title">{trD('dist.topCust')}</div>{onOpenCustomers && <button className="dist-link" onClick={onOpenCustomers}>{trD('dist.seeAll')}</button>}</div>
            {top.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
            {top.map((c, i) => (
              <div key={c.id} className="dist-topc">
                <span className="dist-topc-rank">{i + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}><div className="dist-topc-name">{c.name || '—'}</div><div className="dist-topc-sub">{numX(c.qty)} galon</div></div>
                <b className="tnum dist-topc-amt">{rpX(c.amount)}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════ TRANSAKSI (list + input form + correction) ════════════════
// All data via /distribusi REST. Transactions are IMMUTABLE — no delete anywhere;
// a mistake is fixed by appending a Koreksi (server flags staff corrections). Price
// is locked server-side from the customer master price; we only preview it here.
function shortRef(id) { return '#' + String(id || '').slice(-6).toUpperCase(); }
function hhmm(ms) { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }

function DistTransactions({ today, staffMode, refreshKey, openFormTick, onChanged }) {
  const [view, setView] = uSx('list');
  const [txns, setTxns] = uSx(null);
  const [customers, setCustomers] = uSx([]);
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [newIds, setNewIds] = uSx([]);
  // form
  const [fCust, setFCust] = uSx('');
  const [fQty, setFQty] = uSx(1);
  const [fMethod, setFMethod] = uSx('lunas');
  const [fDate, setFDate] = uSx(today);
  const [fNote, setFNote] = uSx('');
  const [confirmOpen, setConfirmOpen] = uSx(false);
  const [saving, setSaving] = uSx(false);
  const [fErr, setFErr] = uSx('');
  // correction
  const [corrTxn, setCorrTxn] = uSx(null);
  const [corrReason, setCorrReason] = uSx('');
  const [corrValue, setCorrValue] = uSx('');
  const [corrSaving, setCorrSaving] = uSx(false);

  const reload = () => Promise.all([
    window.API.distribusi.transactions.list('').then((r) => setTxns(r.data || [])).catch(() => setTxns([])),
    window.API.distribusi.customers.list().then((r) => setCustomers(r.data || [])).catch(() => {}),
  ]);
  uEx(() => { let live = true; if (window.API && window.API.distribusi) reload(); return () => { live = false; }; }, [refreshKey]);
  uEx(() => { if (openFormTick) { setView('form'); setFErr(''); } }, [openFormTick]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const selCust = customers.find((c) => c.id === fCust) || null;
  const price = selCust ? selCust.masterPrice : 0;
  const total = price * Math.max(0, fQty || 0);

  const commitTxn = () => {
    if (!selCust || saving) return;
    setSaving(true); setFErr('');
    window.API.distribusi.transactions.create({ customerId: fCust, qty: Math.max(1, fQty | 0), method: fMethod, note: fNote.trim(), txnDate: staffMode ? today : (fDate || today) })
      .then((r) => { setSaving(false); setConfirmOpen(false); setNewIds((p) => [r.data.id, ...p]); setView('list'); setFilter('all'); setFCust(''); setFQty(1); setFMethod('lunas'); setFNote(''); flash(trD('dist.txnSaved')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setSaving(false); setConfirmOpen(false); setFErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const commitCorrect = () => {
    if (!corrReason.trim() || corrSaving) return;
    setCorrSaving(true);
    window.API.distribusi.transactions.correct(corrTxn.id, { reason: corrReason.trim(), oldValue: { amount: corrTxn.amount }, newValue: corrValue.trim() || null })
      .then(() => { setCorrSaving(false); setCorrTxn(null); setCorrReason(''); setCorrValue(''); flash(trD('dist.corrSaved')); reload(); if (onChanged) onChanged(); })
      .catch(() => { setCorrSaving(false); });
  };

  const rows = (txns || []).filter((t) => {
    const corrected = (t.corrections || []).length > 0;
    return filter === 'all' ? true : filter === 'corrected' ? corrected : t.method === filter;
  });
  const custOpts = customers.map((c) => ({ value: c.id, label: c.name + (c.type && c.type !== 'reguler' ? ' · ' + c.type : '') }));

  // ── FORM ──
  if (view === 'form') {
    return (
      <div className="dist-dash screen-enter">
        <button type="button" className="dist-back" onClick={() => setView('list')}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trD('dist.backList')}</button>
        <div className="dist-form-wrap">
          <div className="card dist-form">
            <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
            {customers.length === 0
              ? <div className="dist-note">{trD('dist.noCustYet')}</div>
              : <UI.Dropdown value={fCust} options={custOpts} placeholder={trD('dist.fCustPh')} onChange={(v) => setFCust(v)} fluid />}
            <div className="dist-lockrow"><span className="dist-lockrow-l"><IconLock s={14} />{trD('dist.priceLocked')}</span><span className="dist-lockrow-r">{selCust ? rpFull(price) : '—'}<small> /{trD('dist.galonUnit')}</small></span></div>

            <div className="dist-form-row">
              <div style={{ flex: 1, minWidth: 150 }}>
                <label className="fld-label">{trD('dist.fQty')}</label>
                <div className="dist-stepper">
                  <button type="button" onClick={() => setFQty((q) => Math.max(1, (q | 0) - 1))}>−</button>
                  <span className="tnum">{fQty}</span>
                  <button type="button" onClick={() => setFQty((q) => (q | 0) + 1)}>+</button>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label className="fld-label">{trD('dist.fDate')}</label>
                {staffMode
                  ? <div className="dist-datelocked"><span><IconCalendar s={15} />{trD('dist.todayWord')} · {today}</span><IconLock s={13} /></div>
                  : <input type="date" className="fld" value={fDate} onChange={(e) => setFDate(e.target.value)} />}
                {staffMode && <div className="dist-hint">{trD('dist.staffDateNote')}</div>}
              </div>
            </div>

            <label className="fld-label">{trD('dist.fMethod')}</label>
            <div className="dist-method">
              <button type="button" className={`dist-method-btn lunas ${fMethod === 'lunas' ? 'on' : ''}`} onClick={() => setFMethod('lunas')}><IconCheck s={17} /><div><b>{trD('dist.lunas')}</b><span>{trD('dist.lunasHint')}</span></div></button>
              <button type="button" className={`dist-method-btn bon ${fMethod === 'bon' ? 'on' : ''}`} onClick={() => setFMethod('bon')}><IconInvoice s={17} /><div><b>{trD('dist.bon')}</b><span>{trD('dist.bonHint')}</span></div></button>
            </div>

            <label className="fld-label">{trD('dist.fNote')}</label>
            <input className="fld" value={fNote} maxLength={300} placeholder={trD('dist.fNotePh')} onChange={(e) => setFNote(e.target.value)} />
            {fErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{fErr}</div>}
            <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} disabled={!selCust} onClick={() => setConfirmOpen(true)}>{trD('dist.fSave')}</button>
            <div className="dist-hint" style={{ textAlign: 'center', marginTop: 10 }}>{trD('dist.permanentNote')}</div>
          </div>

          <div className="card dist-form-sum">
            <div className="dist-fs-t">{trD('dist.summary')}</div>
            <div className="dist-fs-line"><span>{fQty} {trD('dist.galonUnit')} × {rpFull(price)}</span><b>{rpFull(total)}</b></div>
            <div className="dist-fs-total"><span>{trD('dist.total')}</span><b className="tnum">{rpFull(total)}</b></div>
            <div className="dist-fs-note">{fMethod === 'lunas' ? <><IconCheck s={13} />{trD('dist.lunasNote')}</> : <><IconInvoice s={13} />{trD('dist.bonNote')}</>}</div>
          </div>
        </div>

        {confirmOpen && (
          <div className="modal-scrim" onClick={() => setConfirmOpen(false)} style={{ zIndex: 200 }}>
            <div className="modal-card dist-confirm" onClick={(e) => e.stopPropagation()}>
              <span className="dist-confirm-ic"><IconLock s={24} /></span>
              <div className="dist-confirm-t">{trD('dist.confirmT')}</div>
              <div className="dist-confirm-s"><b>{selCust ? selCust.name : ''}</b> · {fQty} {trD('dist.galonUnit')} · {methodLabel(fMethod)} — <b>{rpFull(total)}</b>. {trD('dist.confirmS')}</div>
              <div className="dist-confirm-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>{trD('dist.cancel')}</button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={commitTxn}>{saving ? '…' : trD('dist.confirmYes')}</button>
              </div>
            </div>
          </div>
        )}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  // ── LIST ──
  const chips = [['all', trD('dist.fAll')], ['lunas', trD('dist.lunas')], ['bon', trD('dist.bon')], ['pelunasan', trD('dist.pelunasan')], ['corrected', trD('dist.corrected')]];
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-tx-toolbar">
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <button type="button" className="btn btn-primary dist-newbtn" onClick={() => { setView('form'); setFErr(''); }}><IconPlus s={16} />{trD('dist.newTxn')}</button>
      </div>
      <div className="dist-permbanner"><IconLock s={15} />{trD('dist.permBanner')}</div>

      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {txns === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {txns !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.noTxn')}</div>}
        {rows.map((t) => {
          const corrected = (t.corrections || []).length > 0;
          const isNew = newIds.includes(t.id);
          return (
            <div key={t.id} className="dist-txn dist-txn-full">
              <span className="dist-txn-av">{(t.customer && t.customer.name || '?').slice(0, 1).toUpperCase()}</span>
              <div className="dist-txn-mid">
                <div className="dist-txn-line1">
                  <span className="dist-txn-name">{t.customer ? t.customer.name : '—'}</span>
                  <span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span>
                  {isNew ? <span className="dist-badge new">{trD('dist.baru')}</span> : null}
                  {corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}
                </div>
                <div className="dist-txn-sub">{shortRef(t.id)} · {t.txnDate} {hhmm(t.createdAt)} · {numX(t.qty)} × {rpFull(t.unitPriceLocked)}{t.actorName ? ' · ' + t.actorName : ''}{t.note ? ' · ' + t.note : ''}</div>
              </div>
              <div className="dist-txn-right">
                <div className="tnum dist-txn-amt">{rpFull(t.amount)}</div>
                <span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>
              </div>
              <button type="button" className="dist-corr-btn" onClick={() => { setCorrTxn(t); setCorrReason(''); setCorrValue(''); }}><IconPencil s={13} />{trD('dist.korek')}</button>
            </div>
          );
        })}
      </div>

      {corrTxn && (
        <div className="modal-scrim" onClick={() => setCorrTxn(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.korekT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{shortRef(corrTxn.id)} · {corrTxn.customer ? corrTxn.customer.name : ''} · {rpFull(corrTxn.amount)}</div></div><button className="jp-icon" onClick={() => setCorrTxn(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.korekInfo')}</span></div>
              <label className="fld-label">{trD('dist.korekReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 74, padding: 12, resize: 'vertical' }} value={corrReason} placeholder={trD('dist.korekReasonPh')} onChange={(e) => setCorrReason(e.target.value)} />
              <div className="dist-form-row">
                <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.korekOld')}</label><div className="fld dist-readonly">{rpFull(corrTxn.amount)}</div></div>
                <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.korekNew')}</label><input className="fld" value={corrValue} placeholder="Rp 0" onChange={(e) => setCorrValue(e.target.value)} /></div>
              </div>
              {staffMode && <div className="dist-staffnote"><IconShield s={14} />{trD('dist.korekStaff')}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setCorrTxn(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!corrReason.trim() || corrSaving} onClick={commitCorrect}>{corrSaving ? '…' : trD('dist.korekSave')}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ PELANGGAN (list + detail + add + import) ════════════════
function DistCustomers({ canCustomers, canPrice, staffMode, refreshKey, onGoHarga, onChanged }) {
  const [view, setView] = uSx('list');
  const [custs, setCusts] = uSx(null);
  const [detail, setDetail] = uSx(null);
  const [q, setQ] = uSx('');
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [addOpen, setAddOpen] = uSx(false);
  const [af, setAf] = uSx({ name: '', phone: '', type: 'reguler', price: '' });
  const [addSaving, setAddSaving] = uSx(false);
  const [impOpen, setImpOpen] = uSx(false);
  const [impText, setImpText] = uSx('');
  const [impSaving, setImpSaving] = uSx(false);

  const reload = () => window.API.distribusi.customers.list().then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  uEx(() => { if (window.API && window.API.distribusi) reload(); }, [refreshKey]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const openDetail = (id) => { setView('detail'); setDetail(null); window.API.distribusi.customers.get(id).then((r) => setDetail(r.data)).catch(() => setView('list')); };

  const commitAdd = () => {
    const name = af.name.trim(); const price = parseInt(String(af.price).replace(/[^0-9]/g, ''), 10);
    if (!name || !price || addSaving) return;
    setAddSaving(true);
    window.API.distribusi.customers.create({ name, phone: af.phone.trim(), type: af.type, masterPrice: price })
      .then(() => { setAddSaving(false); setAddOpen(false); setAf({ name: '', phone: '', type: 'reguler', price: '' }); flash(trD('dist.custAdded')); reload(); if (onChanged) onChanged(); })
      .catch(() => setAddSaving(false));
  };

  // ── spreadsheet import parsing (live preview) ──
  const existing = new Set((custs || []).map((c) => (c.name || '').toLowerCase()));
  const seen = new Set();
  let impLines = impText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (impLines.length && /nama/i.test(impLines[0]) && /harga|price/i.test(impLines[0])) impLines = impLines.slice(1);
  const impRows = impLines.map((line) => {
    const cols = line.split(/\t|,|;/).map((s) => s.trim());
    const name = cols[0] || ''; const phone = cols[1] || '';
    const rawType = (cols[2] || '').toLowerCase();
    const type = CUST_TYPES.includes(rawType) ? rawType : 'reguler';
    const num = parseInt((cols[3] || '').replace(/[^0-9]/g, ''), 10);
    const key = name.toLowerCase(); const dup = existing.has(key) || seen.has(key);
    if (name) seen.add(key);
    const valid = !!name && !!num && !dup;
    return { name: name || '(kosong)', phone: phone || '—', type, price: num || 0, valid, status: valid ? 'ok' : (!name || !num) ? 'kurang' : 'dup' };
  });
  const impValid = impRows.filter((r) => r.valid);
  const commitImport = () => {
    if (!impValid.length || impSaving) return;
    setImpSaving(true);
    window.API.distribusi.customers.import(impValid.map((r) => ({ name: r.name, phone: r.phone === '—' ? '' : r.phone, type: r.type, masterPrice: r.price })))
      .then((r) => { setImpSaving(false); setImpOpen(false); setImpText(''); flash(trD('dist.imported', { n: r.imported })); reload(); if (onChanged) onChanged(); })
      .catch(() => setImpSaving(false));
  };
  const impSample = 'Warung Sejahtera\t0821-1122-3344\tReguler\t12500\nKos Anggrek\t0813-7788-9900\tKos\t13000\nCafe Ombak\t0817-2211-3344\tCafe\t14000';

  const typeChip = (t, on, onClick) => <button type="button" key={t} className={`dist-typechip ${on ? 'on' : ''}`} onClick={onClick}>{typeLabel(t)}</button>;
  const tag = (t) => <span className={`dist-ctag ${CUST_TAG[t] || 'reg'}`}>{typeLabel(t)}</span>;

  // ── DETAIL ──
  if (view === 'detail') {
    const d = detail;
    return (
      <div className="dist-dash screen-enter">
        <button type="button" className="dist-back" onClick={() => { setView('list'); setDetail(null); }}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trD('dist.backCust')}</button>
        {!d ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}>{trD('common.loading') || 'Memuat…'}</div> : (<>
          <div className="card dist-cd-head">
            <span className="dist-cd-av">{initialsOf(d.name)}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="dist-cd-namerow"><h2 className="dist-cd-name">{d.name}</h2>{tag(d.type)}</div>
              <div className="dist-cd-phone">{d.phone || '—'}</div>
            </div>
            <div className="dist-cd-stats">
              <div><div className="dist-cd-slbl">{trD('dist.sisaBon')}</div><div className="dist-cd-sval" style={{ color: d.sisaBon > 0 ? 'var(--warn)' : 'var(--green-700)' }}>{d.sisaBon > 0 ? rpFull(d.sisaBon) : trD('dist.lunas')}</div></div>
              <div><div className="dist-cd-slbl">{trD('dist.totalGalon')}</div><div className="dist-cd-sval">{numX(d.totalGalon)}</div></div>
            </div>
          </div>
          <div className="dist-cd-cols">
            <div className="card dist-cd-price">
              <div className="dist-card-head"><div className="sec-title">{trD('dist.hargaMenempel')}</div><span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span></div>
              <p className="dist-cd-pricenote">{trD('dist.hargaMenempelNote')}</p>
              <div className="dist-cd-pricebox"><div className="dist-cd-pricelbl">{trD('dist.hargaPerGalon')}</div><div className="dist-cd-priceval">{rpFull(d.masterPrice)}</div></div>
              {canPrice
                ? <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={onGoHarga}><IconPencil s={14} />{trD('dist.ubahHarga')}</button>
                : <div className="dist-cd-lockednote"><IconLock s={14} />{trD('dist.hargaOwnerOnly')}</div>}
            </div>
            <div className="card dist-card" style={{ flex: 1, minWidth: 280 }}>
              <div className="sec-title" style={{ marginBottom: 8 }}>{trD('dist.riwayat')}</div>
              {(!d.transactions || d.transactions.length === 0) && <div className="dist-empty">{trD('dist.noTxn')}</div>}
              {(d.transactions || []).map((t) => (
                <div key={t.id} className="dist-txn">
                  <span className="dist-cd-bar" style={{ background: t.method === 'bon' ? '#e0a13c' : t.method === 'pelunasan' ? '#2f6fb0' : '#17b083' }} />
                  <div className="dist-txn-mid">
                    <div className="dist-txn-line1"><span className="dist-txn-name">{shortRef(t.id)}</span><span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>{t.corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}</div>
                    <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)} · {t.txnDate} {hhmm(t.createdAt)}{t.actorName ? ' · ' + t.actorName : ''}</div>
                  </div>
                  <div className="tnum dist-txn-amt">{rpFull(t.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </>)}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  // ── LIST ──
  const rows = (custs || []).filter((c) => {
    if (q && !((c.name || '') + (c.phone || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return filter === 'all' ? true : filter === 'bon' ? c.sisaBon > 0 : filter === 'bulk' ? c.type === 'bulk' : filter === 'reguler' ? c.type === 'reguler' : true;
  });
  const chips = [['all', trD('dist.fAll')], ['bon', trD('dist.filterBon')], ['reguler', trD('dist.filterReg')], ['bulk', trD('dist.filterBulk')]];
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-tx-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.searchCust')} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        {canCustomers ? (
          <div className="dist-cust-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setImpOpen(true)}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.import')}</button>
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}><IconPlus s={16} />{trD('dist.addCust')}</button>
          </div>
        ) : <div className="dist-lockbtn"><IconLock s={14} />{trD('dist.addOwner')}</div>}
      </div>

      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {custs === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {custs !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
        {rows.map((c) => (
          <div key={c.id} className="dist-cust-row" onClick={() => openDetail(c.id)}>
            <span className="dist-txn-av">{initialsOf(c.name)}</span>
            <div className="dist-cust-main">
              <div className="dist-txn-line1"><span className="dist-txn-name">{c.name}</span>{tag(c.type)}</div>
              <div className="dist-txn-sub">{c.phone || '—'} · {numX(c.totalGalon)} {trD('dist.galonUnit')}{c.lastDate ? ' · ' + c.lastDate : ''}</div>
            </div>
            <div className="dist-cust-price">
              <div className="dist-cust-priceval">{rpFull(c.masterPrice)} <IconLock s={11} /></div>
              <div className="dist-cust-pricecap">{trD('dist.txLocked')}</div>
            </div>
            <div className="dist-cust-bon">{c.sisaBon > 0 ? <span className="dist-bonpill">{rpX(c.sisaBon)}</span> : <span className="dist-bonmuted">{trD('dist.lunas')}</span>}</div>
            <IconCaret s={16} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)', flexShrink: 0 }} />
          </div>
        ))}
      </div>

      {addOpen && (
        <div className="modal-scrim" onClick={() => setAddOpen(false)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.addCust')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.addCustSub')}</div></div><button className="jp-icon" onClick={() => setAddOpen(false)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.cfName')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld" value={af.name} placeholder={trD('dist.cfNamePh')} onChange={(e) => setAf({ ...af, name: e.target.value })} />
              <label className="fld-label">{trD('dist.cfPhone')}</label>
              <input className="fld" value={af.phone} placeholder="cth. 0812-3456-7890" onChange={(e) => setAf({ ...af, phone: e.target.value })} />
              <label className="fld-label">{trD('dist.cfType')}</label>
              <div className="dist-typechips">{CUST_TYPES.map((t) => typeChip(t, af.type === t, () => setAf({ ...af, type: t })))}</div>
              <label className="fld-label">{trD('dist.cfPrice')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <div className="dist-priceinput"><IconLock s={15} /><input value={af.price} inputMode="numeric" placeholder="cth. 12000" onChange={(e) => setAf({ ...af, price: e.target.value.replace(/[^0-9]/g, '') })} /></div>
              <div className="dist-hint" style={{ marginTop: 8 }}>{trD('dist.cfPriceNote')}</div>
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setAddOpen(false)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!af.name.trim() || !af.price || addSaving} onClick={commitAdd}>{addSaving ? '…' : trD('dist.cfSave')}</button></div>
          </div>
        </div>
      )}

      {impOpen && (
        <div className="modal-scrim" onClick={() => setImpOpen(false)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.importT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.importSub')}</div></div><button className="jp-icon" onClick={() => setImpOpen(false)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-imp-fmt"><span>{trD('dist.importFmt')}: <b>Nama · No HP · Tipe · Harga</b></span><button type="button" className="dist-link" onClick={() => setImpText(impSample)}>{trD('dist.importSample')}</button></div>
              <textarea className="fld dist-imp-ta" value={impText} placeholder={'Warung Sejahtera\t0821-1122-3344\tReguler\t12500'} onChange={(e) => setImpText(e.target.value)} />
              {impRows.length > 0 && (<>
                <div className="dist-imp-counts"><span className="dist-imp-ok">{impValid.length} {trD('dist.importReady')}</span><span className="dist-imp-skip">{impRows.length - impValid.length} {trD('dist.importSkip')}</span></div>
                <div className="dist-imp-preview">
                  <div className="dist-imp-hrow"><span>Nama</span><span>No HP</span><span>Tipe</span><span>Harga</span><span>Status</span></div>
                  {impRows.map((r, i) => (
                    <div key={i} className="dist-imp-row">
                      <span className="dist-imp-name">{r.name}</span><span>{r.phone}</span><span>{typeLabel(r.type)}</span><span>{r.price ? rpFull(r.price) : '—'}</span>
                      <span><span className={`dist-imp-status ${r.status}`}>{r.status === 'ok' ? trD('dist.impReady') : r.status === 'kurang' ? trD('dist.impMissing') : trD('dist.impDup')}</span></span>
                    </div>
                  ))}
                </div>
              </>)}
              <div className="dist-hint" style={{ marginTop: 10 }}><IconLock s={12} /> {trD('dist.importLockNote')}</div>
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setImpOpen(false)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!impValid.length || impSaving} onClick={commitImport}>{impSaving ? '…' : trD('dist.importBtn', { n: impValid.length })}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ HARGA MASTER (owner only) ════════════════
function DistLocked() {
  return (
    <div className="dist-dash screen-enter">
      <div className="card dist-lockedpanel">
        <span className="dist-lockedpanel-ic"><IconLock s={26} /></span>
        <div className="dist-lockedpanel-t">{trD('dist.lockedStaff')}</div>
        <div className="dist-lockedpanel-s">{trD('dist.lockedStaffSub')}</div>
      </div>
    </div>
  );
}

function DistPrices({ canPrice, refreshKey, onChanged }) {
  const [custs, setCusts] = uSx(null);
  const [drafts, setDrafts] = uSx({});
  const [saving, setSaving] = uSx('');
  const [toast, setToast] = uSx('');
  const reload = () => window.API.distribusi.customers.list().then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  uEx(() => { if (canPrice && window.API && window.API.distribusi) reload(); }, [refreshKey, canPrice]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  if (!canPrice) return <DistLocked />;

  const tag = (t) => <span className={`dist-ctag ${CUST_TAG[t] || 'reg'}`}>{typeLabel(t)}</span>;
  const apply = (c) => {
    const num = parseInt(String(drafts[c.id] || '').replace(/[^0-9]/g, ''), 10);
    if (!num || num === c.masterPrice || saving) return;
    setSaving(c.id);
    window.API.distribusi.customers.setPrice(c.id, num)
      .then(() => { setSaving(''); setDrafts((d) => ({ ...d, [c.id]: '' })); flash(trD('dist.hargaUpdated', { n: c.name })); reload(); if (onChanged) onChanged(); })
      .catch(() => setSaving(''));
  };

  return (
    <div className="dist-dash screen-enter">
      <div className="dist-warnbanner">
        <IconInvoice s={18} />
        <div><b>{trD('dist.hargaBannerT')}</b> {trD('dist.hargaBannerS')}</div>
      </div>
      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        <div className="dist-harga-hrow"><span>{trD('dist.fCust')}</span><span>{trD('dist.hargaBerlaku')}</span><span>{trD('dist.hargaBaru')}</span><span /></div>
        {custs === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {custs !== null && custs.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
        {(custs || []).map((c) => {
          const draft = drafts[c.id] || '';
          const num = parseInt(String(draft).replace(/[^0-9]/g, ''), 10);
          const ready = !!num && num !== c.masterPrice;
          return (
            <div key={c.id} className="dist-harga-row">
              <div className="dist-harga-cust"><span className="dist-txn-av sm">{initialsOf(c.name)}</span><div style={{ minWidth: 0 }}><div className="dist-txn-name">{c.name}</div>{tag(c.type)}</div></div>
              <div className="dist-harga-cur">{rpFull(c.masterPrice)} <IconLock s={11} /></div>
              <div className="dist-harga-new"><input className="fld" value={draft} inputMode="numeric" placeholder={rpFull(c.masterPrice)} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))} onKeyDown={(e) => { if (e.key === 'Enter' && ready) apply(c); }} /></div>
              <button type="button" className="btn btn-ghost dist-harga-apply" disabled={!ready || saving === c.id} onClick={() => apply(c)}>{saving === c.id ? '…' : trD('dist.terapkan')}</button>
            </div>
          );
        })}
      </div>
      <div className="dist-hint" style={{ marginTop: 8 }}><IconLock s={12} /> {trD('dist.hargaFootNote')}</div>
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ LOG AUDIT (owner only, immutable timeline) ════════════════
function DistAudit({ canAudit, refreshKey }) {
  const [rows, setRows] = uSx(null);
  const [kind, setKind] = uSx('all');
  const [q, setQ] = uSx('');
  const reload = () => window.API.distribusi.audit('limit=500').then((r) => setRows(r.data || [])).catch(() => setRows([]));
  uEx(() => { if (canAudit && window.API && window.API.distribusi) reload(); }, [refreshKey, canAudit]);
  if (!canAudit) return <DistLocked />;

  const kindChips = [['all', trD('dist.fAll')], ['koreksi', trD('dist.akKoreksi')], ['harga', trD('dist.akHarga')], ['input', trD('dist.akInput')], ['impor', trD('dist.akImpor')], ['pelanggan', trD('dist.akPelanggan')]];
  const filtered = (rows || []).filter((a) => {
    if (kind !== 'all' && a.kind !== kind) return false;
    if (q && !((a.title || '') + (a.detail || '') + (a.actorName || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-tx-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.auditSearch')} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="dist-chips">{kindChips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        <span className="dist-immutable"><IconLock s={13} />{trD('dist.immutable')}</span>
      </div>
      <div className="card dist-card" style={{ padding: '10px 22px' }}>
        {rows === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {rows !== null && filtered.length === 0 && <div className="dist-empty">{trD('dist.noAudit')}</div>}
        {filtered.map((a) => {
          const m = AUDIT_KIND[a.kind] || AUDIT_KIND.input;
          return (
            <div key={a.id} className="dist-audit-row">
              <div className="dist-audit-rail"><span className="dist-audit-dot" /></div>
              <div className="dist-audit-body">
                <div className="dist-audit-head">
                  <span className={`dist-akind ${m.cls}`}>{trD(m.k)}</span>
                  <span className="dist-audit-title">{a.title}</span>
                  {a.actorStaff ? <span className="dist-audit-staff">{trD('dist.olehStaff')}</span> : null}
                </div>
                {a.detail ? <div className="dist-audit-detail">{a.detail}</div> : null}
                <div className="dist-audit-meta"><span className={a.actorStaff ? 'staff' : ''}>{a.actorName || a.actorRole || '—'}</span><span>{fmtDT(a.createdAt)}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.DIST = { Dashboard: DistDashboard, Transactions: DistTransactions, Customers: DistCustomers, Prices: DistPrices, Audit: DistAudit };
