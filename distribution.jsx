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
// Colour class per seed type id; anything else (custom types) uses the neutral 'other'.
const CUST_TAG = { reguler: 'reg', kos: 'kos', cafe: 'cafe', bulk: 'bulk' };
const typeLabel = (t) => (t === 'bulk' ? 'Bulk' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Reguler');
// Delivery-day codes (Mon…Sun). Server stores the customer's days as a subset of these.
const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const fmtDays = (arr) => (Array.isArray(arr) && arr.length ? DAY_CODES.filter((d) => arr.includes(d)).join(', ') : '');
const initialsOf = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const AUDIT_KIND = { koreksi: { cls: 'koreksi', k: 'dist.akKoreksi' }, harga: { cls: 'harga', k: 'dist.akHarga' }, input: { cls: 'input', k: 'dist.akInput' }, impor: { cls: 'input', k: 'dist.akImpor' }, pelanggan: { cls: 'input', k: 'dist.akPelanggan' } };
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDT(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getDate() + ' ' + MONTHS_ID[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
// Local YYYY-MM-DD helpers for the Cash Integration period picker.
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const isoAddDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
function periodRange(period, today) {
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: isoAddDays(today, -6), to: today };
  return { from: today.slice(0, 8) + '01', to: today }; // month-to-date
}
function copyText(text, done) {
  const fin = () => { if (done) done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(fin).catch(() => fin()); return; }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) { /* ignore */ }
  fin();
}

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

// Fleet scope helpers. fleetScope is 'all' (or null) for full access, or an array of
// fleet names for a scoped user. The effective fleet passed to the API: for full access
// it's the chosen filter; for a scoped user it's 'all' (the server enforces the scope).
const isScoped = (fleetScope) => Array.isArray(fleetScope);
const effFleet = (fleetScope, distFleet) => (isScoped(fleetScope) ? 'all' : (distFleet || 'all'));
// A bar above the Distribusi screens: a label ("Armada: Merah") for scoped users, or a
// Semua/Merah/Biru toggle for full-access users so a GM can see the combined or per-fleet view.
function FleetBar({ fleetScope, fleet, value, onChange }) {
  if (isScoped(fleetScope)) {
    if (!fleetScope.length) return null;
    return <div className="dist-fleetbar scoped"><IconTruck s={14} /><span>{trD('dist.fleetLabel')}:</span><b>{fleetScope.join(', ')}</b></div>;
  }
  const opts = ['all', ...((fleet || []).filter(Boolean))];
  if (opts.length <= 1) return null;   // no fleets defined → nothing to toggle
  return (
    <div className="dist-fleetbar">
      <span className="dist-fleetbar-lbl"><IconTruck s={14} />{trD('dist.fleetFilter')}</span>
      <div className="dist-chips">
        {opts.map((f) => <button key={f} type="button" className={`dist-chip ${(value || 'all') === f ? 'on' : ''}`} onClick={() => onChange(f)}>{f === 'all' ? trD('dist.fleetAll') : f}</button>)}
      </div>
    </div>
  );
}

function Kpi({ icon, tile, fg, value, unit, label, cls, pill, pillCls, hero }) {
  // Every KPI is a `stat-box` → identical padding/size on all four. `dist-kpi-hero`
  // is a COLOUR-ONLY modifier (gradient + light text); it must not change the size.
  return (
    <div className={`card stat-box dist-kpi ${hero ? 'dist-kpi-hero' : ''}`}>
      <div className="dist-kpi-top">
        <span className={`icon-tile ${hero ? 'hero' : ''}`} style={hero ? null : { background: tile, color: fg }}>{IcX(icon, { s: 19 })}</span>
        {pill ? <span className={`dist-kpi-pill ${pillCls || ''}`}>{pill}</span> : null}
      </div>
      <div className={`tnum dist-kpi-val ${cls || ''}`}>{value}{unit ? <span className="dist-kpi-unit"> {unit}</span> : null}</div>
      <div className="dist-kpi-lbl">{label}</div>
    </div>
  );
}

function DistDashboard({ refreshKey, staffMode, canInput, onQuickInput, onOpenCustomers, today, fleetScope, fleet, distFleet, setDistFleet }) {
  const [sum, setSum] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  const ef = effFleet(fleetScope, distFleet);
  uEx(() => {
    let live = true; setErr(false);
    if (!(window.API && window.API.distribusi)) { setLoading(false); setErr(true); return; }
    window.API.distribusi.summary(today, ef).then((r) => { if (live) { setSum(r.data); setLoading(false); } })
      .catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, today, ef]);

  const fleetBar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  if (loading) return <div className="dist-dash screen-enter">{fleetBar}<div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-mut)' }}>{trD('common.loading') || 'Memuat…'}</div></div>;
  if (err || !sum) return <div className="dist-dash screen-enter">{fleetBar}<div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}><IconRefresh s={20} /><div style={{ marginTop: 8 }}>{trD('dist.loadErr')}</div></div></div>;

  const recent = sum.recent || [];
  const top = sum.topCustomers || [];
  const avgNota = sum.count ? Math.round(sum.amount / sum.count) : 0;
  return (
    <div className="dist-dash screen-enter">
      {fleetBar}
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
                    {t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}
                  </div>
                  <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)}</div>
                </div>
                <div className="dist-txn-right">
                  <div className="tnum dist-txn-amt">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</div>
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

          {canInput && (
          <div className="card dist-quick">
            <div className="dist-quick-t">{trD('dist.quickInput')}</div>
            <div className="dist-quick-s">{trD('dist.quickInputSub')}</div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onQuickInput}><IconPlus s={16} />{trD('dist.quickInputBtn')}</button>
          </div>
          )}

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

function DistTransactions({ today, staffMode, canInput, canKoreksi, refreshKey, openFormTick, onChanged, fleetScope, fleet, distFleet, setDistFleet }) {
  const [view, setView] = uSx('list');
  const [txns, setTxns] = uSx(null);
  const [customers, setCustomers] = uSx([]);
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [newIds, setNewIds] = uSx([]);
  // form
  const [fCust, setFCust] = uSx('');
  const [fQty, setFQty] = uSx(1);
  const [fGalOut, setFGalOut] = uSx(1);   // galon keluar (default = qty; editable)
  const [fGalIn, setFGalIn] = uSx(0);     // galon masuk (empties returned)
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

  const ef = effFleet(fleetScope, distFleet);
  const fleetQs = (ef && ef !== 'all') ? 'fleet=' + encodeURIComponent(ef) : '';
  const reload = () => Promise.all([
    window.API.distribusi.transactions.list(fleetQs).then((r) => setTxns(r.data || [])).catch(() => setTxns([])),
    window.API.distribusi.customers.list(ef).then((r) => setCustomers(r.data || [])).catch(() => {}),
  ]);
  uEx(() => { let live = true; if (window.API && window.API.distribusi) reload(); return () => { live = false; }; }, [refreshKey, ef]);
  uEx(() => { if (openFormTick) { setView('form'); setFErr(''); } }, [openFormTick]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const selCust = customers.find((c) => c.id === fCust) || null;
  const price = selCust ? selCust.masterPrice : 0;
  const total = price * Math.max(0, fQty || 0);

  const setQty = (q) => { const n = Math.max(1, q | 0); setFQty(n); setFGalOut(n); };   // gallon out tracks qty until edited
  const commitTxn = () => {
    if (!selCust || saving) return;
    setSaving(true); setFErr('');
    window.API.distribusi.transactions.create({ customerId: fCust, qty: Math.max(1, fQty | 0), method: fMethod, note: fNote.trim(), txnDate: staffMode ? today : (fDate || today), gallonOut: Math.max(0, fGalOut | 0), gallonIn: Math.max(0, fGalIn | 0) })
      .then((r) => { setSaving(false); setConfirmOpen(false); setNewIds((p) => [r.data.id, ...p]); setView('list'); setFilter('all'); setFCust(''); setFQty(1); setFGalOut(1); setFGalIn(0); setFMethod('lunas'); setFNote(''); flash(trD('dist.txnGalonSaved', { out: r.data.gallonOut, in: r.data.gallonIn, held: r.data.gallonsHeld })); reload(); if (onChanged) onChanged(); })
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
                  <button type="button" onClick={() => setQty(fQty - 1)}>−</button>
                  <span className="tnum">{fQty}</span>
                  <button type="button" onClick={() => setQty(fQty + 1)}>+</button>
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

            {/* Gallon flow (loan/exchange): full gallons out (default = qty) + empties in */}
            <div className="dist-form-row">
              <div style={{ flex: 1, minWidth: 150 }}>
                <label className="fld-label">{trD('dist.fGalOut')}</label>
                <input className="fld tnum" inputMode="numeric" value={fGalOut} onChange={(e) => setFGalOut(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label className="fld-label">{trD('dist.fGalIn')}</label>
                <input className="fld tnum" inputMode="numeric" value={fGalIn} onChange={(e) => setFGalIn(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
              </div>
            </div>
            <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.galFlowHint')}</div>

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
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-tx-toolbar">
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {canInput && <button type="button" className="btn btn-primary dist-newbtn" onClick={() => { setView('form'); setFErr(''); }}><IconPlus s={16} />{trD('dist.newTxn')}</button>}
      </div>
      <div className="dist-permbanner"><IconLock s={15} />{trD('dist.permBanner')}</div>

      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {txns === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {txns !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.noTxn')}</div>}
        {rows.map((t) => {
          const corrected = t.correctedManual != null ? t.correctedManual : (t.corrections || []).some((x) => x.kind !== 'price');
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
                  {t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}
                </div>
                <div className="dist-txn-sub">{shortRef(t.id)} · {t.txnDate} {hhmm(t.createdAt)} · {numX(t.qty)} × {rpFull(t.unitPriceLocked)}{t.actorName ? ' · ' + t.actorName : ''}{t.note ? ' · ' + t.note : ''}{t.adjusted ? ' · ' + (t.adjustAmount >= 0 ? '+' : '') + rpFull(t.adjustAmount) : ''}</div>
              </div>
              <div className="dist-txn-right">
                <div className="tnum dist-txn-amt">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</div>
                <span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>
              </div>
              {canKoreksi && <button type="button" className="dist-corr-btn" onClick={() => { setCorrTxn(t); setCorrReason(''); setCorrValue(''); }}><IconPencil s={13} />{trD('dist.korek')}</button>}
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
// `fleet` is the SINGLE app-wide armada source (shell state ← /settings airro_fleet,
// the same list managed in Setoran → Kelola Armada). Distribusi never keeps its own
// copy — changing a plate there is reflected here immediately.
function DistCustomers({ canCustomers, canPrice, staffMode, refreshKey, fleet, fleetScope, distFleet, setDistFleet, onGoHarga, onChanged }) {
  const [view, setView] = uSx('list');
  const [custs, setCusts] = uSx(null);
  const [types, setTypes] = uSx([]);
  const [detail, setDetail] = uSx(null);
  const [q, setQ] = uSx('');
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [form, setForm] = uSx(null);        // {id?, name, phone, type, price, deliveryDays[], armada} — Add/Edit modal
  const [saving, setSaving] = uSx(false);
  const [formErr, setFormErr] = uSx('');
  const [impOpen, setImpOpen] = uSx(false);
  const [impText, setImpText] = uSx('');
  const [impSaving, setImpSaving] = uSx(false);
  const [typesOpen, setTypesOpen] = uSx(false);

  const ef = effFleet(fleetScope, distFleet);
  const reload = () => window.API.distribusi.customers.list(ef).then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  const reloadTypes = () => window.API.distribusi.types.list().then((r) => setTypes(r.data || [])).catch(() => {});
  uEx(() => {
    if (!(window.API && window.API.distribusi)) return;
    reload(); reloadTypes();
  }, [refreshKey, ef]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const typeMap = {}; types.forEach((t) => { typeMap[t.id] = t; });
  const typeLabelOf = (id) => (typeMap[id] && typeMap[id].label) || typeLabel(id);
  const tag = (id) => <span className={`dist-ctag ${CUST_TAG[id] || 'other'}`}>{typeLabelOf(id)}</span>;
  const defaultType = () => (types[0] && types[0].id) || 'reguler';
  // Armada options from the single source. A value the customer already has but that
  // is no longer in the fleet list is kept (shown as "non-aktif") so it never vanishes.
  const fleetList = Array.isArray(fleet) ? fleet : [];
  const isActiveArmada = (v) => !v || fleetList.includes(v);
  const armadaFull = (v) => (v ? v + (isActiveArmada(v) ? '' : ' ' + trD('dist.armadaInactive')) : '');
  const fleetOptsFor = (cur) => {
    const opts = [{ value: '', label: trD('dist.noArmada') }, ...fleetList.map((pl) => ({ value: pl, label: pl }))];
    if (cur && !fleetList.includes(cur)) opts.push({ value: cur, label: armadaFull(cur) });
    return opts;
  };

  const openDetail = (id) => { setView('detail'); setDetail(null); window.API.distribusi.customers.get(id).then((r) => setDetail(r.data)).catch(() => setView('list')); };
  const cancelAdj = (batchId) => {
    if (!confirm(trD('dist.pcCancelConfirm'))) return;
    window.API.distribusi.customers.cancelPriceAdjustment(batchId)
      .then(() => { flash(trD('dist.pcCancelled')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
      .catch(() => {});
  };
  const openAdd = () => { setFormErr(''); setForm({ id: null, name: '', phone: '', type: defaultType(), price: '', deliveryDays: [], armada: '' }); };
  const openEdit = (d) => { setFormErr(''); setForm({ id: d.id, name: d.name || '', phone: d.phone || '', type: d.type || defaultType(), price: '', deliveryDays: Array.isArray(d.deliveryDays) ? d.deliveryDays : [], armada: d.armada || '' }); };
  const toggleDay = (d) => setForm((f) => ({ ...f, deliveryDays: f.deliveryDays.includes(d) ? f.deliveryDays.filter((x) => x !== d) : [...f.deliveryDays, d] }));

  const commitForm = () => {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) { setFormErr(trD('dist.cfNameReq')); return; }
    const onErr = (e) => { setSaving(false); setFormErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); };
    const finish = (msg, data) => { setSaving(false); setForm(null); flash(msg); reload(); if (data) setDetail((d) => (d && d.id === data.id ? { ...d, ...data } : d)); if (onChanged) onChanged(); };
    setSaving(true); setFormErr('');
    if (!form.id) {
      const price = parseInt(String(form.price).replace(/[^0-9]/g, ''), 10);
      if (!price) { setSaving(false); setFormErr(trD('dist.cfPriceReq')); return; }
      window.API.distribusi.customers.create({ name, phone: form.phone.trim(), type: form.type, masterPrice: price, deliveryDays: form.deliveryDays, armada: form.armada })
        .then(() => finish(trD('dist.custAdded'))).catch(onErr);
    } else {
      window.API.distribusi.customers.update(form.id, { name, phone: form.phone.trim(), type: form.type, deliveryDays: form.deliveryDays, armada: form.armada })
        .then((r) => finish(trD('dist.custSaved'), r.data)).catch(onErr);
    }
  };

  // ── spreadsheet import parsing (type matched by LABEL against the dynamic dictionary) ──
  const typeByLabel = {}; types.forEach((t) => { typeByLabel[(t.label || '').toLowerCase()] = t.id; });
  const existing = new Set((custs || []).map((c) => (c.name || '').toLowerCase()));
  const seen = new Set();
  let impLines = impText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (impLines.length && /nama/i.test(impLines[0]) && /harga|price/i.test(impLines[0])) impLines = impLines.slice(1);
  const impRows = impLines.map((line) => {
    const cols = line.split(/\t|,|;/).map((s) => s.trim());
    const name = cols[0] || ''; const phone = cols[1] || '';
    const type = typeByLabel[(cols[2] || '').toLowerCase()] || 'reguler';
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

  // Add/Edit modal — shared by the list and detail views. Price is add-only (edits
  // go through Harga Master, which keeps the price history).
  const renderForm = () => form && (
    <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{form.id ? trD('dist.editCust') : trD('dist.addCust')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.addCustSub')}</div></div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.cfName')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" value={form.name} placeholder={trD('dist.cfNamePh')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="fld-label">{trD('dist.cfPhone')}</label>
          <input className="fld" value={form.phone} placeholder="cth. 0812-3456-7890" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="fld-label">{trD('dist.cfType')}</label>
          <div className="dist-typechips">
            {types.map((t) => <button type="button" key={t.id} className={`dist-typechip ${form.type === t.id ? 'on' : ''}`} onClick={() => setForm({ ...form, type: t.id })}>{t.label}</button>)}
            {canCustomers && <button type="button" className="dist-typechip add" onClick={() => setTypesOpen(true)}><IconPlus s={13} />{trD('dist.kelolaTipe')}</button>}
          </div>
          <label className="fld-label">{trD('dist.cfDays')}</label>
          <div className="dist-typechips">{DAY_CODES.map((dd) => <button type="button" key={dd} className={`dist-typechip ${form.deliveryDays.includes(dd) ? 'on' : ''}`} onClick={() => toggleDay(dd)}>{dd}</button>)}</div>
          <label className="fld-label">{trD('dist.cfArmada')}</label>
          <UI.Dropdown value={form.armada} options={fleetOptsFor(form.armada)} placeholder={trD('dist.noArmada')} onChange={(v) => setForm({ ...form, armada: v })} fluid />
          {!form.id ? (<>
            <label className="fld-label">{trD('dist.cfPrice')} <span style={{ color: 'var(--neg)' }}>*</span></label>
            <div className="dist-priceinput"><IconLock s={15} /><input value={form.price} inputMode="numeric" placeholder="cth. 12000" onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, '') })} /></div>
            <div className="dist-hint" style={{ marginTop: 8 }}>{trD('dist.cfPriceNote')}</div>
          </>) : <div className="dist-hint" style={{ marginTop: 10 }}><IconLock s={12} /> {trD('dist.cfPriceEditNote')}</div>}
          {formErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{formErr}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!form.name.trim() || saving} onClick={commitForm}>{saving ? '…' : trD('dist.cfSave')}</button></div>
      </div>
    </div>
  );
  const typesModal = () => typesOpen && <CustomerTypesModal types={types} custs={custs} onReload={() => { reloadTypes(); reload(); }} onClose={() => setTypesOpen(false)} />;

  // ── DETAIL ──
  if (view === 'detail') {
    const d = detail;
    const days = d ? fmtDays(d.deliveryDays) : '';
    return (
      <div className="dist-dash screen-enter">
        <button type="button" className="dist-back" onClick={() => { setView('list'); setDetail(null); }}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trD('dist.backCust')}</button>
        {!d ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}>{trD('common.loading') || 'Memuat…'}</div> : (<>
          <div className="card dist-cd-head">
            <span className="dist-cd-av">{initialsOf(d.name)}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="dist-cd-namerow"><h2 className="dist-cd-name">{d.name}</h2>{tag(d.type)}</div>
              <div className="dist-cd-phone">{d.phone || '—'}</div>
              <div className="dist-cd-meta">
                <span><IconCalendar s={13} />{trD('dist.kirimHari')}: <b>{days || '—'}</b></span>
                <span className={d.armada && !isActiveArmada(d.armada) ? 'inactive' : ''}><IconTruck s={13} />{trD('dist.armada')}: <b>{d.armada ? armadaFull(d.armada) : '—'}</b></span>
              </div>
            </div>
            <div className="dist-cd-stats">
              <div><div className="dist-cd-slbl">{trD('dist.sisaBon')}</div><div className="dist-cd-sval" style={{ color: d.sisaBon > 0 ? 'var(--warn)' : 'var(--green-700)' }}>{d.sisaBon > 0 ? rpFull(d.sisaBon) : trD('dist.lunas')}</div></div>
              <div><div className="dist-cd-slbl">{trD('dist.totalGalon')}</div><div className="dist-cd-sval">{numX(d.totalGalon)}</div></div>
              <div><div className="dist-cd-slbl">{trD('dist.gallonsHeld')}</div><div className="dist-cd-sval" style={{ color: (d.gallonsHeld || 0) > 0 ? 'var(--warn)' : 'var(--text-mut)' }}>{numX(d.gallonsHeld || 0)}</div></div>
            </div>
            {canCustomers && <button type="button" className="btn btn-ghost dist-cd-edit" onClick={() => openEdit(d)}><IconPencil s={14} />{trD('dist.editCust')}</button>}
          </div>
          <div className="dist-cd-cols">
            <div className="card dist-cd-price">
              <div className="dist-card-head"><div className="sec-title">{trD('dist.hargaMenempel')}</div><span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span></div>
              <p className="dist-cd-pricenote">{trD('dist.hargaMenempelNote')}</p>
              <div className="dist-cd-pricebox"><div className="dist-cd-pricelbl">{trD('dist.hargaPerGalon')}</div><div className="dist-cd-priceval">{rpFull(d.masterPrice)}</div></div>
              {canPrice
                ? <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={onGoHarga}><IconPencil s={14} />{trD('dist.ubahHarga')}</button>
                : <div className="dist-cd-lockednote"><IconLock s={14} />{trD('dist.hargaOwnerOnly')}</div>}
              {(d.priceAdjustments || []).length > 0 && (
                <div className="dist-cd-adj">
                  <div className="dist-cd-adj-h"><IconInvoice s={13} />{trD('dist.pcActiveT')}</div>
                  {(d.priceAdjustments || []).map((b) => (
                    <div key={b.batchId} className="dist-cd-adj-row">
                      <div className="dist-cd-adj-txt"><b>{rpFull(b.oldPrice)} → {rpFull(b.newPrice)}</b><span>{trD('dist.pcAdjMeta', { n: b.count, d: (b.totalDelta >= 0 ? '+' : '') + rpFull(b.totalDelta) })}</span></div>
                      {canPrice && <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelAdj(b.batchId)}>{trD('dist.batalkan')}</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card dist-card" style={{ flex: 1, minWidth: 280 }}>
              <div className="sec-title" style={{ marginBottom: 8 }}>{trD('dist.riwayat')}</div>
              {(!d.transactions || d.transactions.length === 0) && <div className="dist-empty">{trD('dist.noTxn')}</div>}
              {(d.transactions || []).map((t) => (
                <div key={t.id} className="dist-txn">
                  <span className="dist-cd-bar" style={{ background: t.method === 'bon' ? '#e0a13c' : t.method === 'pelunasan' ? '#2f6fb0' : '#17b083' }} />
                  <div className="dist-txn-mid">
                    <div className="dist-txn-line1"><span className="dist-txn-name">{shortRef(t.id)}</span><span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>{t.corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}{t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}</div>
                    <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)} · {t.txnDate} {hhmm(t.createdAt)}{t.actorName ? ' · ' + t.actorName : ''}{t.adjusted ? ' · ' + (t.adjustAmount >= 0 ? '+' : '') + rpFull(t.adjustAmount) : ''}</div>
                  </div>
                  <div className="tnum dist-txn-amt">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </>)}
        {renderForm()}
        {typesModal()}
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
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-tx-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.searchCust')} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        {canCustomers ? (
          <div className="dist-cust-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setTypesOpen(true)}><IconSettings s={15} />{trD('dist.kelolaTipe')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setImpOpen(true)}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.import')}</button>
            <button type="button" className="btn btn-primary" onClick={openAdd}><IconPlus s={16} />{trD('dist.addCust')}</button>
          </div>
        ) : <div className="dist-lockbtn"><IconLock s={14} />{trD('dist.addOwner')}</div>}
      </div>

      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {custs === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {custs !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
        {rows.map((c) => {
          const days = fmtDays(c.deliveryDays);
          return (
            <div key={c.id} className="dist-cust-row" onClick={() => openDetail(c.id)}>
              <span className="dist-txn-av">{initialsOf(c.name)}</span>
              <div className="dist-cust-main">
                <div className="dist-txn-line1"><span className="dist-txn-name">{c.name}</span>{tag(c.type)}</div>
                <div className="dist-txn-sub">{c.phone || '—'} · {numX(c.totalGalon)} {trD('dist.galonUnit')}{c.lastDate ? ' · ' + c.lastDate : ''}</div>
                {(days || c.armada) && (
                  <div className="dist-cust-meta">
                    {days && <span><IconCalendar s={11} />{days}</span>}
                    {c.armada && <span className={isActiveArmada(c.armada) ? '' : 'inactive'}><IconTruck s={11} />{armadaFull(c.armada)}</span>}
                  </div>
                )}
              </div>
              <div className="dist-cust-price">
                <div className="dist-cust-priceval">{rpFull(c.masterPrice)} <IconLock s={11} /></div>
                <div className="dist-cust-pricecap">{trD('dist.txLocked')}</div>
              </div>
              <div className="dist-cust-bon">{c.sisaBon > 0 ? <span className="dist-bonpill">{rpX(c.sisaBon)}</span> : <span className="dist-bonmuted">{trD('dist.lunas')}</span>}</div>
              <IconCaret s={16} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)', flexShrink: 0 }} />
            </div>
          );
        })}
      </div>

      {renderForm()}
      {typesModal()}

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

// ════════════════ KELOLA TIPE PELANGGAN (editable dictionary) ════════════════
// Add / rename / delete customer types. Deleting a type still used by customers is
// blocked until they are reassigned — the modal shows the count and a "move to" picker.
function CustomerTypesModal({ types, custs, onReload, onClose }) {
  const [newLabel, setNewLabel] = uSx('');
  const [busy, setBusy] = uSx('');
  const [editId, setEditId] = uSx(null);
  const [editLabel, setEditLabel] = uSx('');
  const [delType, setDelType] = uSx(null);   // type pending delete (in use)
  const [reassign, setReassign] = uSx('');
  const [err, setErr] = uSx('');
  const usage = {}; (custs || []).forEach((c) => { usage[c.type] = (usage[c.type] || 0) + 1; });
  const onErr = (e) => { setBusy(''); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); };

  const add = () => { const l = newLabel.trim(); if (!l || busy) return; setBusy('add'); setErr('');
    window.API.distribusi.types.create(l).then(() => { setBusy(''); setNewLabel(''); onReload(); }).catch(onErr); };
  const saveRename = (id) => { const l = editLabel.trim(); if (!l || busy) return; setBusy(id); setErr('');
    window.API.distribusi.types.rename(id, l).then(() => { setBusy(''); setEditId(null); onReload(); }).catch(onErr); };
  const askDelete = (t) => { setErr(''); if ((usage[t.id] || 0) > 0) { setDelType(t); setReassign(''); } else { doDelete(t.id, null); } };
  const doDelete = (id, to) => { if (busy) return; setBusy('del'); setErr('');
    window.API.distribusi.types.remove(id, to).then(() => { setBusy(''); setDelType(null); onReload(); }).catch(onErr); };

  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.kelolaTipeT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.kelolaTipeSub')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-type-add">
            <input className="fld" value={newLabel} placeholder={trD('dist.tipeNamePh')} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" className="btn btn-primary" disabled={!newLabel.trim() || busy === 'add'} onClick={add}><IconPlus s={15} />{trD('dist.tambah')}</button>
          </div>
          {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
          <div className="dist-type-list">
            {types.map((t) => {
              const inUse = usage[t.id] || 0;
              if (delType && delType.id === t.id) {
                const opts = types.filter((x) => x.id !== t.id).map((x) => ({ value: x.id, label: x.label }));
                return (
                  <div key={t.id} className="dist-type-row del">
                    <div className="dist-type-delnote"><IconInvoice s={14} />{trD('dist.tipeInUse', { n: inUse })}</div>
                    <div className="dist-type-delrow">
                      <UI.Dropdown value={reassign} options={[{ value: '', label: trD('dist.pilihTipeTujuan') }, ...opts]} onChange={setReassign} fluid />
                      <button type="button" className="btn btn-ghost" onClick={() => setDelType(null)}>{trD('dist.cancel')}</button>
                      <button type="button" className="btn btn-primary" disabled={!reassign || busy === 'del'} onClick={() => doDelete(t.id, reassign)}>{busy === 'del' ? '…' : trD('dist.pindahHapus')}</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={t.id} className="dist-type-row">
                  {editId === t.id ? (
                    <input className="fld dist-type-edit" autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(t.id); if (e.key === 'Escape') setEditId(null); }} />
                  ) : (
                    <div className="dist-type-name"><span className={`dist-ctag ${CUST_TAG[t.id] || 'other'}`}>{t.label}</span>{inUse > 0 && <span className="dist-type-count">{trD('dist.tipeCount', { n: inUse })}</span>}</div>
                  )}
                  <div className="dist-type-actions">
                    {editId === t.id ? (<>
                      <button type="button" className="icon-btn" title={trD('dist.simpan')} disabled={!editLabel.trim()} onClick={() => saveRename(t.id)}><IconCheck s={15} /></button>
                      <button type="button" className="icon-btn" title={trD('dist.cancel')} onClick={() => setEditId(null)}><IconClose s={15} /></button>
                    </>) : (<>
                      <button type="button" className="icon-btn" title={trD('dist.ubah')} onClick={() => { setEditId(t.id); setEditLabel(t.label); setErr(''); }}><IconPencil s={14} /></button>
                      <button type="button" className="icon-btn del" title={trD('dist.hapus')} onClick={() => askDelete(t)}><IconBackspace s={15} /></button>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dist-hint" style={{ marginTop: 10 }}><IconInvoice s={12} /> {trD('dist.kelolaTipeNote')}</div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.tutup')}</button></div>
      </div>
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

// Modal shown when applying a new master price: choose (a) new-only or (b) retroactive,
// with a scope + a live "N transaksi · total selisih Rp X" summary before confirming.
function PriceChangeModal({ customer, newPrice, onDone, onClose }) {
  const [preview, setPreview] = uSx(null);
  const [mode, setMode] = uSx('new');     // 'new' | 'retro'
  const [scope, setScope] = uSx('all');   // 'all' | 'cycle' | 'bon'
  const [busy, setBusy] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { let live = true; window.API.distribusi.customers.pricePreview(customer.id, newPrice).then((r) => { if (live) setPreview(r.data); }).catch(() => {}); return () => { live = false; }; }, [customer.id, newPrice]);
  const sc = preview && preview.scopes ? preview.scopes[scope] : null;
  const commit = () => {
    if (busy) return; setBusy(true); setErr('');
    window.API.distribusi.customers.setPrice(customer.id, newPrice, mode === 'retro' ? scope : null)
      .then((r) => { setBusy(false); onDone(r.data); })
      .catch((e) => { setBusy(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const scopeRow = (key, label, hint) => (
    <label key={key} className={`dist-pc-scope ${scope === key ? 'on' : ''}`}>
      <input type="radio" name="pcscope" checked={scope === key} onChange={() => setScope(key)} />
      <div className="dist-pc-txt"><b>{label}</b><span>{hint}</span></div>
      {preview && <span className="dist-pc-count">{preview.scopes[key].count}</span>}
    </label>
  );
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 220 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.pcTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name} · {rpFull(customer.masterPrice)} → <b>{rpFull(newPrice)}</b></div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className={`dist-pc-opt ${mode === 'new' ? 'on' : ''}`}><input type="radio" name="pcmode" checked={mode === 'new'} onChange={() => setMode('new')} /><div className="dist-pc-txt"><b>{trD('dist.pcNewOnly')}</b><span>{trD('dist.pcNewOnlyHint')}</span></div></label>
          <label className={`dist-pc-opt ${mode === 'retro' ? 'on' : ''}`}><input type="radio" name="pcmode" checked={mode === 'retro'} onChange={() => setMode('retro')} /><div className="dist-pc-txt"><b>{trD('dist.pcRetro')}</b><span>{trD('dist.pcRetroHint')}</span></div></label>
          {mode === 'retro' && (
            <div className="dist-pc-scopes">
              {scopeRow('all', trD('dist.pcScopeAll'), trD('dist.pcScopeAllHint'))}
              {scopeRow('cycle', trD('dist.pcScopeCycle'), preview ? preview.cycle.start + ' – ' + preview.cycle.end : trD('dist.pcScopeCycleHint'))}
              {scopeRow('bon', trD('dist.pcScopeBon'), trD('dist.pcScopeBonHint'))}
              <div className="dist-pc-summary"><IconInvoice s={14} />{sc ? trD('dist.pcSummary', { n: sc.count, d: rpFull(sc.totalDelta) }) : (trD('common.loading') || '…')}</div>
            </div>
          )}
          {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={commit}>{busy ? '…' : trD('dist.pcConfirm')}</button></div>
      </div>
    </div>
  );
}

function DistPrices({ canPrice, refreshKey, onChanged }) {
  const [custs, setCusts] = uSx(null);
  const [drafts, setDrafts] = uSx({});
  const [pcModal, setPcModal] = uSx(null);   // { customer, newPrice }
  const [toast, setToast] = uSx('');
  const reload = () => window.API.distribusi.customers.list().then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  uEx(() => { if (canPrice && window.API && window.API.distribusi) reload(); }, [refreshKey, canPrice]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  if (!canPrice) return <DistLocked />;

  const tag = (t) => <span className={`dist-ctag ${CUST_TAG[t] || 'other'}`}>{typeLabel(t)}</span>;
  const apply = (c) => {
    const num = parseInt(String(drafts[c.id] || '').replace(/[^0-9]/g, ''), 10);
    if (!num || num === c.masterPrice) return;
    setPcModal({ customer: c, newPrice: num });   // open the options modal
  };
  const onApplied = (cust, data) => {
    setPcModal(null);
    setDrafts((d) => ({ ...d, [cust.id]: '' }));
    flash(data && data.affected ? trD('dist.pcAppliedRetro', { n: data.affected }) : trD('dist.hargaUpdated', { n: cust.name }));
    reload(); if (onChanged) onChanged();
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
              <button type="button" className="btn btn-ghost dist-harga-apply" disabled={!ready} onClick={() => apply(c)}>{trD('dist.terapkan')}</button>
            </div>
          );
        })}
      </div>
      <div className="dist-hint" style={{ marginTop: 8 }}><IconLock s={12} /> {trD('dist.hargaFootNote')}</div>
      {pcModal && <PriceChangeModal customer={pcModal.customer} newPrice={pcModal.newPrice} onDone={(data) => onApplied(pcModal.customer, data)} onClose={() => setPcModal(null)} />}
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

// ════════════════ INTEGRASI KAS (cash-flow mirror — read-only) ════════════════
// Distribusi is deliberately SEPARATE from the AirRO cash book: nothing here posts
// into the Entry/cash-flow tables. This screen is the bridge VIEW — for a chosen
// period it maps distribusi activity onto cash-book terms so the owner can see (and
// hand-copy) what really became cash:
//   • Lunas + Pelunasan → Uang Masuk (cash-book income)
//   • Bon               → Piutang (receivable, not cash yet)
//   • Koreksi + Harga   → Penyesuaian (adjustment / audit note)
// It never double-posts — that separation is the whole point.
function DistIntegration({ refreshKey, today }) {
  const [period, setPeriod] = uSx('month');
  const [txns, setTxns] = uSx(null);
  const [audit, setAudit] = uSx([]);
  const [custs, setCusts] = uSx([]);
  const [toast, setToast] = uSx('');
  const range = periodRange(period, today);

  uEx(() => {
    if (!(window.API && window.API.distribusi)) { setTxns([]); return; }
    let live = true; setTxns(null);
    Promise.all([
      window.API.distribusi.transactions.list('dateFrom=' + range.from + '&dateTo=' + range.to).then((r) => r.data || []).catch(() => []),
      window.API.distribusi.audit('limit=500').then((r) => r.data || []).catch(() => []),
      window.API.distribusi.customers.list().then((r) => r.data || []).catch(() => []),
    ]).then(([t, a, c]) => { if (!live) return; setTxns(t); setAudit(a); setCusts(c); });
    return () => { live = false; };
  }, [refreshKey, period]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const rows = txns || [];
  let lunas = 0, pelunasan = 0, bon = 0, qty = 0;
  const cnt = { lunas: 0, pelunasan: 0, bon: 0 };
  // Use the EFFECTIVE amount so retroactive price adjustments flow into the cash mirror.
  const effOf = (t) => (t.effectiveAmount != null ? t.effectiveAmount : (t.amount + (t.adjustAmount || 0)));
  rows.forEach((t) => {
    qty += t.qty; const e = effOf(t);
    if (t.method === 'bon') { bon += e; cnt.bon++; }
    else if (t.method === 'pelunasan') { pelunasan += e; cnt.pelunasan++; }
    else { lunas += e; cnt.lunas++; }
  });
  const masukKas = lunas + pelunasan;
  const adjRows = (audit || []).filter((a) => { if (a.kind !== 'koreksi' && a.kind !== 'harga') return false; const d = isoDay(a.createdAt); return d >= range.from && d <= range.to; });
  const koreksiN = adjRows.filter((a) => a.kind === 'koreksi').length;
  const hargaN = adjRows.filter((a) => a.kind === 'harga').length;
  const adjN = koreksiN + hargaN;
  const piutangBerjalan = (custs || []).reduce((s, c) => s + (c.sisaBon || 0), 0);
  const empty = rows.length === 0 && adjN === 0;

  const copySummary = () => {
    const lines = [
      trD('nav.distIntegration') + ' — ' + range.from + ' → ' + range.to,
      trD('dist.integLineLunas') + ': ' + rpFull(lunas),
      trD('dist.integLinePelunasan') + ': ' + rpFull(pelunasan),
      trD('dist.integTotalIn') + ': ' + rpFull(masukKas),
      trD('dist.integLineBon') + ': ' + rpFull(bon) + ' (' + trD('dist.integBonMemo') + ')',
      trD('dist.integLineAdjust') + ': ' + adjN + ' (' + koreksiN + ' ' + trD('dist.akKoreksi') + ', ' + hargaN + ' ' + trD('dist.akHarga') + ')',
    ];
    copyText(lines.join('\n'), () => flash(trD('dist.integCopied')));
  };

  const periods = [['today', trD('dist.periodToday')], ['week', trD('dist.periodWeek')], ['month', trD('dist.periodMonth')]];
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-integ-banner">
        <span className="dist-integ-flow"><IconTruck s={15} /><IconCaret s={12} style={{ transform: 'rotate(-90deg)' }} /><IconCoinIn s={15} /></span>
        <div><b>{trD('dist.integBannerT')}</b><span>{trD('dist.integBannerS')}</span></div>
      </div>

      <div className="dist-tx-toolbar">
        <div className="dist-chips">{periods.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        <span className="dist-integ-range"><IconCalendar s={13} />{range.from} — {range.to}</span>
        <button type="button" className="btn btn-ghost" disabled={txns === null} onClick={copySummary}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('dist.integCopy')}</button>
      </div>

      {txns === null ? <div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div> : (<>
        <div className="dist-integ-cards">
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: 'var(--pos-bg)', color: 'var(--green-800)' }}>{IcX('IconCoinIn', { s: 18 })}</span><span className="dist-kpi-pill pos">{trD('dist.pillCash')}</span></div>
            <div className="tnum dist-integ-kpi-val amt-pos">{rpFull(masukKas)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integMasukKas')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integMasukKasSub')}</div>
          </div>
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>{IcX('IconInvoice', { s: 18 })}</span><span className="dist-kpi-pill warn">{trD('dist.pillPiutang')}</span></div>
            <div className="tnum dist-integ-kpi-val" style={{ color: 'var(--warn)' }}>{rpFull(bon)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integPiutang')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integPiutangSub')}</div>
          </div>
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconPencil', { s: 17 })}</span><span className="dist-kpi-pill blue">{numX(adjN)}</span></div>
            <div className="tnum dist-integ-kpi-val">{numX(adjN)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integAdjust')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integAdjustSub')}</div>
          </div>
        </div>

        <div className="card dist-integ-ledger">
          <div className="dist-card-head"><div className="sec-title">{trD('dist.integLedger')}</div><span className="dist-badge lock"><IconLock s={10} />{trD('dist.integInfoBadge')}</span></div>
          {empty ? <div className="dist-empty">{trD('dist.integNoData')}</div> : (<>
            <div className="dist-integ-line">
              <span className="dist-integ-line-l"><span className="dist-integ-dot lunas" /><span>{trD('dist.integLineLunas')}</span><small>{numX(cnt.lunas)} {trD('dist.notaWord')}</small></span>
              <b className="tnum amt-pos">+{rpFull(lunas)}</b>
            </div>
            <div className="dist-integ-line">
              <span className="dist-integ-line-l"><span className="dist-integ-dot pelunasan" /><span>{trD('dist.integLinePelunasan')}</span><small>{numX(cnt.pelunasan)} {trD('dist.notaWord')}</small></span>
              <b className="tnum amt-pos">+{rpFull(pelunasan)}</b>
            </div>
            <div className="dist-integ-line total">
              <span className="dist-integ-line-l"><IconCoinIn s={14} /><span>{trD('dist.integTotalIn')}</span></span>
              <b className="tnum amt-pos">{rpFull(masukKas)}</b>
            </div>
            <div className="dist-integ-line memo">
              <span className="dist-integ-line-l"><span className="dist-integ-dot bon" /><span>{trD('dist.integLineBon')}</span><small>{trD('dist.integBonMemo')}</small></span>
              <b className="tnum" style={{ color: 'var(--warn)' }}>{rpFull(bon)}</b>
            </div>
            <div className="dist-integ-line memo">
              <span className="dist-integ-line-l"><span className="dist-integ-dot adj" /><span>{trD('dist.integLineAdjust')}</span><small>{numX(koreksiN)} {trD('dist.akKoreksi')} · {numX(hargaN)} {trD('dist.akHarga')}</small></span>
              <b className="tnum" style={{ color: 'var(--text-mut)' }}>{numX(adjN)}</b>
            </div>
          </>)}
        </div>

        <div className="dist-integ-foot">
          <div className="card dist-integ-outstanding">
            <div className="dist-integ-out-head"><IconInvoice s={15} /><span>{trD('dist.integOutstanding')}</span></div>
            <div className="tnum dist-integ-out-val">{rpFull(piutangBerjalan)}</div>
            <div className="dist-integ-out-sub">{trD('dist.integOutstandingSub')}</div>
          </div>
          <div className="dist-integ-note"><IconLock s={14} /><span>{trD('dist.integFootNote')}</span></div>
        </div>
      </>)}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ STOK GALON (loan/exchange ledger) ════════════════
// All numbers come from the append-only gallon ledger on the server: stock cards,
// per-customer balances, and the movement ledger. Corrections (never overwrites) are
// appended with a required reason and audited.
const GM_META = {
  purchase: { l: 'dist.gmPurchase', cls: 'purchase', sign: '+' },
  delivery_out: { l: 'dist.gmOut', cls: 'out', sign: '−' },
  return_in: { l: 'dist.gmIn', cls: 'in', sign: '+' },
  correction: { l: 'dist.gmCorr', cls: 'corr', sign: '' },
};
function DistGallon({ refreshKey, canCustomers, fleetScope, fleet, distFleet, setDistFleet }) {
  const [data, setData] = uSx(null);
  const [toast, setToast] = uSx('');
  const [corr, setCorr] = uSx(null);   // { customerId, name, qty, reason }
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => window.API.distribusi.gallon(ef).then((r) => setData(r.data)).catch(() => setData({ stock: {}, balances: [], movements: [] }));
  uEx(() => { if (window.API && window.API.distribusi) reload(); }, [refreshKey, ef]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const commitCorr = () => {
    if (!corr || saving) return;
    const qty = parseInt(String(corr.qty).replace(/[^0-9-]/g, ''), 10);
    if (!qty || !corr.reason.trim()) { setErr(trD('dist.gmCorrErr')); return; }
    setSaving(true); setErr('');
    window.API.distribusi.gallonCorrection({ qty, customerId: corr.customerId || undefined, reason: corr.reason.trim() })
      .then(() => { setSaving(false); setCorr(null); flash(trD('dist.gmCorrSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const bar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  if (!data) return <div className="dist-dash screen-enter">{bar}<div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div></div>;
  const st = data.stock || {};
  return (
    <div className="dist-dash screen-enter">
      {bar}
      <div className="dist-gm-cards">
        <div className="card stat-box"><span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconDrop', { s: 18 })}</span><div className="tnum dist-gm-val">{numX(st.totalOwned || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmTotal')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>{IcX('IconCustomers', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--warn)' }}>{numX(st.atCustomers || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtCust')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--pos-bg)', color: 'var(--green-800)' }}>{IcX('IconTruck', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--green-700)' }}>{numX(st.atDepot || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtDepot')}</div></div>
      </div>
      <div className="dist-cd-cols">
        <div className="card dist-card dist-gm-balcard">
          <div className="dist-card-head"><div className="sec-title">{trD('dist.gmBalances')}</div>{canCustomers && <button type="button" className="dist-link" onClick={() => { setErr(''); setCorr({ customerId: '', name: '', qty: '', reason: '' }); }}>{trD('dist.gmCorrectDepot')}</button>}</div>
          {(data.balances || []).length === 0 && <div className="dist-empty">{trD('dist.gmNoBal')}</div>}
          {(data.balances || []).map((b) => (
            <div key={b.customerId} className="dist-gm-bal">
              <span className="dist-txn-av sm">{initialsOf(b.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div className="dist-txn-name">{b.name}</div>{b.armada ? <div className="dist-txn-sub">{b.armada}</div> : null}</div>
              <b className="tnum dist-gm-held">{numX(b.held)}</b>
              {canCustomers && <button type="button" className="icon-btn" title={trD('dist.gmCorrect')} onClick={() => { setErr(''); setCorr({ customerId: b.customerId, name: b.name, qty: '', reason: '' }); }}><IconPencil s={14} /></button>}
            </div>
          ))}
        </div>
        <div className="card dist-card" style={{ flex: 1, minWidth: 280 }}>
          <div className="sec-title" style={{ marginBottom: 8 }}>{trD('dist.gmLedger')}</div>
          {(data.movements || []).length === 0 && <div className="dist-empty">{trD('dist.gmNoMov')}</div>}
          {(data.movements || []).map((m) => { const meta = GM_META[m.type] || GM_META.correction; const disp = meta.sign === '' ? ((m.qty > 0 ? '+' : '') + numX(m.qty)) : (meta.sign + numX(Math.abs(m.qty))); return (
            <div key={m.id} className="dist-txn">
              <span className={`dist-gm-mtag ${meta.cls}`}>{trD(meta.l)}</span>
              <div className="dist-txn-mid"><div className="dist-txn-name">{m.customerName || trD('dist.gmDepot')}</div><div className="dist-txn-sub">{fmtDT(m.createdAt)}{m.actorName ? ' · ' + m.actorName : ''}{m.note && m.type === 'correction' ? ' · ' + m.note : ''}</div></div>
              <b className={`tnum dist-gm-mqty ${meta.cls}`}>{disp}</b>
            </div>
          ); })}
        </div>
      </div>

      {corr && (
        <div className="modal-scrim" onClick={() => setCorr(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.gmCorrT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{corr.customerId ? corr.name : trD('dist.gmDepot')}</div></div><button className="jp-icon" onClick={() => setCorr(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.gmCorrInfo')}</span></div>
              <label className="fld-label">{trD('dist.gmCorrQty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld tnum" value={corr.qty} inputMode="numeric" placeholder="cth. -1 atau 3" onChange={(e) => setCorr({ ...corr, qty: e.target.value.replace(/[^0-9-]/g, '') })} />
              <label className="fld-label">{trD('dist.gmCorrReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 70, padding: 12, resize: 'vertical' }} value={corr.reason} placeholder={trD('dist.gmCorrReasonPh')} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setCorr(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commitCorr}>{saving ? '…' : trD('dist.gmCorrSave')}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

window.DIST = { Dashboard: DistDashboard, Transactions: DistTransactions, Customers: DistCustomers, Integration: DistIntegration, Prices: DistPrices, Audit: DistAudit, Gallon: DistGallon };
