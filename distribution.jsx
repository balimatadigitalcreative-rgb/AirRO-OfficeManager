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

window.DIST = { Dashboard: DistDashboard, Transactions: DistTransactions };
