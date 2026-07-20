/* global React */
/* AirRO — Distribusi module screens. window.DIST. Separate from the cash book:
   all data comes from the /distribusi REST endpoints (never the AirRO Entry tables). */
const { useState: uSx, useEffect: uEx } = React;
const trD = (k, v) => window.t(k, v);
function IcX(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
// Money in the Distribusi module uses the FULL format ("Rp 500.000") — never the
// ambiguous compact form ("500rb"). Non-money counts (galon, txn count) use numX.
const rpFull = (n) => (window.FIN && FIN.fmt ? FIN.fmt(n) : String(n));
const numX = (n) => (n || 0).toLocaleString('id-ID');
const DW_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const METHOD_META = {
  lunas: { cls: 'lunas', label: 'dist.lunas' },
  bon: { cls: 'bon', label: 'dist.bon' },
  pelunasan: { cls: 'pelunasan', label: 'dist.pelunasan' },
};
const methodLabel = (m) => trD(METHOD_META[m] ? METHOD_META[m].label : 'dist.lunas') || m;
const BIZ_NAME = 'AirRO Reverse Osmosis';
const BIZ_SUB = 'Air Minum Reverse Osmosis';
// Colour class per seed type id; anything else (custom types) uses the neutral 'other'.
const CUST_TAG = { reguler: 'reg', kos: 'kos', cafe: 'cafe', bulk: 'bulk' };
const typeLabel = (t) => (t === 'bulk' ? 'Bulk' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Reguler');
// Delivery-day codes (Mon…Sun). Server stores the customer's days as a subset of these.
const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
// Detailed customer filter — "nothing selected" baseline. Every field is optional and the
// server ANDs whatever is set. Kept at module scope so it's a stable reference for resets.
const EMPTY_FILTER = { types: [], bon: '', bonMin: '', days: [], daysMode: 'any', complete: '', hasLocation: '', priceMin: '', priceMax: '' };
const filterIsEmpty = (f) => !f.types.length && !f.bon && !f.bonMin && !f.days.length && !f.complete && !f.hasLocation && !f.priceMin && !f.priceMax;
const filterCount = (f) => (f.types.length ? 1 : 0) + (f.bon ? 1 : 0) + (f.bonMin ? 1 : 0) + (f.days.length ? 1 : 0)
  + (f.complete ? 1 : 0) + (f.hasLocation ? 1 : 0) + (f.priceMin || f.priceMax ? 1 : 0);

// One removable chip per ACTIVE criterion. Each chip clears just its own criterion.
function activeFilterChips(f, setF, typeMap) {
  const out = [];
  const set = (patch) => setF({ ...f, ...patch });
  if (f.types.length) out.push({ key: 'types', label: trD('dist.fTipe') + ': ' + f.types.map((t) => (typeMap[t] && typeMap[t].label) || t).join(', '), clear: () => set({ types: [] }) });
  if (f.bon) out.push({ key: 'bon', label: f.bon === 'ada' ? trD('dist.fBonAda') : trD('dist.fBonLunas'), clear: () => set({ bon: '' }) });
  if (f.bonMin) out.push({ key: 'bonMin', label: trD('dist.fBonMin') + ' ' + rpFull(+f.bonMin || 0), clear: () => set({ bonMin: '' }) });
  if (f.days.length) out.push({ key: 'days', label: trD('dist.fDays') + ': ' + f.days.join(', ') + (f.daysMode === 'all' ? ' (' + trD('dist.fDaysAll') + ')' : ''), clear: () => set({ days: [], daysMode: 'any' }) });
  if (f.complete) out.push({ key: 'complete', label: f.complete === 'lengkap' ? trD('dist.fComplete') : trD('dist.fIncomplete'), clear: () => set({ complete: '' }) });
  if (f.hasLocation) out.push({ key: 'hasLocation', label: f.hasLocation === 'ya' ? trD('dist.fLocYes') : trD('dist.fLocNo'), clear: () => set({ hasLocation: '' }) });
  if (f.priceMin || f.priceMax) out.push({ key: 'price', label: trD('dist.fPrice') + ': ' + (f.priceMin ? rpFull(+f.priceMin) : '—') + ' – ' + (f.priceMax ? rpFull(+f.priceMax) : '—'), clear: () => set({ priceMin: '', priceMax: '' }) });
  return out;
}

// The detailed filter. A collapsible panel on desktop; a bottom sheet on mobile (CSS) —
// single scroll, chips wrap, safe-area honoured. Edits a DRAFT so nothing re-queries until
// "Terapkan" (or a criterion is cleared from the chip bar).
function CustomerFilterPanel({ value, types, onApply, onClose }) {
  const [d, setD] = uSx(value);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (patch) => setD({ ...d, ...patch });
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const num = (v) => v.replace(/[^0-9]/g, '');
  const Chip = ({ on, onClick, children }) => <button type="button" className={`cat-chip ${on ? 'on' : ''}`} onClick={onClick}>{on ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{children}</button>;

  return (
    <div className="modal-scrim dist-filter-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card dist-filter-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.filterT')}</div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fTipe')}</label>
          <div className="cat-chips">
            {(types || []).map((t) => <Chip key={t.id} on={d.types.includes(t.id)} onClick={() => set({ types: toggleIn(d.types, t.id) })}>{t.label}</Chip>)}
            {!(types || []).length && <div className="dist-empty" style={{ padding: 6 }}>—</div>}
          </div>

          <label className="fld-label">{trD('dist.fBon')}</label>
          <div className="cat-chips">
            <Chip on={d.bon === 'ada'} onClick={() => set({ bon: d.bon === 'ada' ? '' : 'ada' })}>{trD('dist.fBonAda')}</Chip>
            <Chip on={d.bon === 'lunas'} onClick={() => set({ bon: d.bon === 'lunas' ? '' : 'lunas' })}>{trD('dist.fBonLunas')}</Chip>
          </div>
          <div style={{ marginTop: 6 }}>
            <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fBonMin')}</label>
            <input className="fld tnum" inputMode="numeric" value={d.bonMin} placeholder="cth. 50000" onChange={(e) => set({ bonMin: num(e.target.value) })} />
          </div>

          <label className="fld-label">{trD('dist.fDays')}</label>
          <div className="cat-chips">
            {DAY_CODES.map((day) => <Chip key={day} on={d.days.includes(day)} onClick={() => set({ days: toggleIn(d.days, day) })}>{day}</Chip>)}
          </div>
          {d.days.length > 1 && (
            <div className="cat-chips" style={{ marginTop: 6 }}>
              <Chip on={d.daysMode !== 'all'} onClick={() => set({ daysMode: 'any' })}>{trD('dist.fDaysAny')}</Chip>
              <Chip on={d.daysMode === 'all'} onClick={() => set({ daysMode: 'all' })}>{trD('dist.fDaysAll')}</Chip>
            </div>
          )}

          <label className="fld-label">{trD('dist.fKelengkapan')}</label>
          <div className="cat-chips">
            <Chip on={d.complete === 'lengkap'} onClick={() => set({ complete: d.complete === 'lengkap' ? '' : 'lengkap' })}>{trD('dist.fComplete')}</Chip>
            <Chip on={d.complete === 'belum'} onClick={() => set({ complete: d.complete === 'belum' ? '' : 'belum' })}>{trD('dist.fIncomplete')}</Chip>
          </div>

          <label className="fld-label">{trD('dist.fLocation')}</label>
          <div className="cat-chips">
            <Chip on={d.hasLocation === 'ya'} onClick={() => set({ hasLocation: d.hasLocation === 'ya' ? '' : 'ya' })}>{trD('dist.fLocYes')}</Chip>
            <Chip on={d.hasLocation === 'tidak'} onClick={() => set({ hasLocation: d.hasLocation === 'tidak' ? '' : 'tidak' })}>{trD('dist.fLocNo')}</Chip>
          </div>

          <label className="fld-label">{trD('dist.fPrice')}</label>
          <div className="gud-row2">
            <div><input className="fld tnum" inputMode="numeric" value={d.priceMin} placeholder={trD('dist.fMin')} onChange={(e) => set({ priceMin: num(e.target.value) })} /></div>
            <div><input className="fld tnum" inputMode="numeric" value={d.priceMax} placeholder={trD('dist.fMax')} onChange={(e) => set({ priceMax: num(e.target.value) })} /></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => setD(EMPTY_FILTER)}>{trD('dist.fReset')}</button>
          <button className="btn btn-primary" onClick={() => onApply(d)}>{trD('dist.fApply')}</button>
        </div>
      </div>
    </div>
  );
}
const fmtDays = (arr) => (Array.isArray(arr) && arr.length ? DAY_CODES.filter((d) => arr.includes(d)).join(', ') : '');
const initialsOf = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
// Missing-field labels for the "Data belum lengkap" chips (keys match server completeness output).
const MISSING_KEYS = { phone: 'dist.mPhone', location: 'dist.mLoc', armada: 'dist.mArmada', deliveryDays: 'dist.mDays', price: 'dist.mPrice' };
const missChips = (missing) => (missing || []).map((k) => <span key={k} className="dist-miss-chip">{trD(MISSING_KEYS[k] || k)}</span>);
const AUDIT_KIND = { koreksi: { cls: 'koreksi', k: 'dist.akKoreksi' }, harga: { cls: 'harga', k: 'dist.akHarga' }, input: { cls: 'input', k: 'dist.akInput' }, impor: { cls: 'input', k: 'dist.akImpor' }, pelanggan: { cls: 'input', k: 'dist.akPelanggan' } };
// Indonesian phone normalisation — MIRRORS server/src/utils/phone.js exactly (that one is
// authoritative; this is for live preview/dedupe in the browser). Excel silently drops the
// leading 0 from a phone column and people paste "+62 …", so every number is repaired to the
// stored "08…" form — staff never have to reformat a spreadsheet.
//   "" → ""  ·  "+62 812-1122-3344" → "081211223344"  ·  "81211223344" → "081211223344"
//   "6281…" → "081…"  ·  "081…" → "081…"  ·  other digits kept as-is (landline/short)
function normalizePhone(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return '0' + d.slice(2);
  if (d.startsWith('0')) return d;
  if (d.startsWith('8')) return '0' + d;
  return d;
}
// Did normalisation actually repair the number (vs just strip formatting)? Drives the
// "0 dipulihkan" hint in the import preview so the fix is transparent, not silent.
const phoneWasFixed = (raw) => { const d = String(raw == null ? '' : raw).replace(/\D/g, ''); return !!d && normalizePhone(d) !== d; };
// WhatsApp wants the international form. Numbers are stored "08…", so: 62 + rest.
const waNumber = (raw) => { const p = normalizePhone(raw); return p.startsWith('0') ? '62' + p.slice(1) : p; };

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
  const [bump, setBump] = uSx(0);
  const [payCust, setPayCust] = uSx(null);   // Perlu-ditagih → catat Pelunasan
  const [invCust, setInvCust] = uSx(null);    // Perlu-ditagih → buat Invoice (fetched detail)
  const [invView, setInvView] = uSx(null);
  const ef = effFleet(fleetScope, distFleet);
  const refetch = () => setBump((b) => b + 1);
  const openInvoice = (id) => { window.API.distribusi.customers.get(id).then((r) => setInvCust(r.data)).catch(() => {}); };
  const reasonLabel = (x) => x.type === 'bon' ? trD('dist.rlBon') : x.type === 'gallon' ? trD('dist.rlGallon', { n: x.value }) : x.type === 'overdue' ? trD('dist.rlOverdue', { n: x.days }) : x.type === 'dueDay' ? trD('dist.rlDueDay', { n: x.day }) : x.type === 'weekly' ? trD('dist.rlWeekly', { d: x.weekday }) : x.type;
  uEx(() => {
    let live = true; setErr(false);
    if (!(window.API && window.API.distribusi)) { setLoading(false); setErr(true); return; }
    window.API.distribusi.summary(today, ef).then((r) => { if (live) { setSum(r.data); setLoading(false); } })
      .catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, today, ef, bump]);

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
            <Kpi hero icon="IconDrop" value={numX(sum.periodQty)} unit={trD('dist.galonUnit')} label={trD('dist.kpiGalon')} pill={trD('dist.pill7d')} pillCls="hero" />
            <Kpi icon="IconCoinIn" tile="var(--pos-bg)" fg="var(--green-800)" value={rpFull(sum.periodIn)} label={trD('dist.kpiIn')} cls="amt-pos" pill={trD('dist.pill7d')} pillCls="pos" />
            <Kpi icon="IconInvoice" tile="var(--warn-bg)" fg="var(--warn)" value={rpFull(sum.receivable)} label={trD('dist.kpiBon')} pill={trD('dist.pillRunning')} pillCls="warn" />
            <Kpi icon="IconTx" tile="#EAF1F4" fg="#5E7A88" value={numX(sum.count)} label={trD('dist.kpiTxn')} pill={trD('dist.pillToday')} pillCls="blue" />
          </div>

          {(sum.reminders || []).length > 0 && (
            <div className="card dist-card dist-remind-card">
              <div className="dist-card-head"><div className="sec-title"><IconInvoice s={15} style={{ marginRight: 6, verticalAlign: '-2px', color: 'var(--warn)' }} />{trD('dist.needBilling')} <span className="dist-remind-count">{sum.reminders.length}</span></div></div>
              {sum.reminders.map((rm) => (
                <div key={rm.customerId} className="dist-remind-row">
                  <div className="dist-remind-mid">
                    <div className="dist-remind-name">{rm.name}{rm.armada ? <span className="dist-remind-fleet">{rm.armada}</span> : null}</div>
                    <div className="dist-remind-sub"><b className="amt-neg">{rpFull(rm.sisaBon)}</b>{rm.since ? ' · ' + trD('dist.since') + ' ' + rm.since + ' (' + trD('dist.daysAgo', { n: rm.ageDays }) + ')' : ''} · {rm.reasons.map(reasonLabel).join(', ')}</div>
                  </div>
                  {canInput && (
                    <div className="dist-remind-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => openInvoice(rm.customerId)}><IconInvoice s={13} />{trD('dist.makeInvoice')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPayCust({ id: rm.customerId, name: rm.name, sisaBon: rm.sisaBon })}><IconCoinIn s={13} />{trD('dist.payBon')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
              <div><div className="dist-th-lbl">{trD('dist.kpiIn')}</div><div className="dist-th-val pos">{rpFull(sum.uangMasuk)}</div></div>
              <div><div className="dist-th-lbl">{trD('dist.bonBaru')}</div><div className="dist-th-val warn">{rpFull(sum.piutang)}</div></div>
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
                <b className="tnum dist-topc-amt">{rpFull(c.amount)}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      {payCust && <PaymentModal customers={[payCust]} presetCustomer={payCust.id} staffMode={staffMode} today={today} onClose={() => setPayCust(null)} onSaved={() => { setPayCust(null); refetch(); }} />}
      {invCust && <InvoiceBuilder customer={invCust} onClose={() => setInvCust(null)} onCreated={(iv) => { setInvCust(null); setInvView(iv); refetch(); }} />}
      {invView && <InvoiceViewer invoice={invView} onClose={() => setInvView(null)} />}
    </div>
  );
}

// ════════════════ TRANSAKSI (list + input form + correction) ════════════════
// All data via /distribusi REST. Transactions are IMMUTABLE — no delete anywhere;
// a mistake is fixed by appending a Koreksi (server flags staff corrections). Price
// is locked server-side from the customer master price; we only preview it here.
function shortRef(id) { return '#' + String(id || '').slice(-6).toUpperCase(); }
function hhmm(ms) { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
// Lazy-load SheetJS — only when an .xlsx/.xls file is chosen, so its ~930 KB never
// touches the initial page load. (CSV needs no library; it's parsed as plain text.)
// Served from OUR origin (vendor/), not cdn.sheetjs.com: that CDN has failed before,
// and an Excel import must not depend on a third party being reachable.
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    let s = document.getElementById('sheetjs-vendor');
    if (s) { s.addEventListener('load', () => resolve(window.XLSX)); s.addEventListener('error', () => reject(new Error('sheetjs'))); return; }
    s = document.createElement('script'); s.id = 'sheetjs-vendor';
    s.src = '/vendor/xlsx.full.min.js';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('sheetjs')));
    s.onerror = () => reject(new Error('sheetjs'));
    document.head.appendChild(s);
  });
}
// Split a delimited line the same way the paste box does (tab / comma / semicolon).
const splitCells = (line) => line.split(/\t|,|;/).map((s) => s.trim());
// Download a ready-to-fill CSV template (header + one example row).
function downloadImportTemplate() {
  const rows = [
    ['Nama', 'No HP', 'Tipe', 'Harga', 'Hari Kirim', 'Armada', 'Alamat', 'Maps'],
    ['Warung Sejahtera', '0821-1122-3344', 'Reguler', '12500', 'Sen;Rab;Jum', 'Merah', 'Jl. Melati No. 7', 'https://maps.app.goo.gl/xxxx'],
  ];
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'template-pelanggan.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Parse a date cell (imported legacy history) into strict YYYY-MM-DD, or null if unparseable.
// Accepts ISO, dd/mm/yyyy (and . or - separators), and Excel serial numbers.
function realDate(y, mo, d) { const dt = new Date(Date.UTC(+y, +mo - 1, +d)); return (dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d) ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; }
function parseLegacyDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return realDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return realDate(m[3], m[2], m[1]);   // dd/mm/yyyy
  if (/^\d+(\.\d+)?$/.test(s)) { const n = +s; if (n > 59 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10); }
  const t = Date.parse(s); if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}
// Ready-to-fill CSV template for the per-customer legacy transaction import (header + 1 example).
function downloadLegacyTemplate() {
  const rows = [['Tanggal', 'Jumlah Galon', 'Harga', 'Metode', 'Catatan'], ['2026-01-15', '10', '12000', 'lunas', 'saldo awal']];
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'template-riwayat-transaksi.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Free navigation link (opens Google/Apple Maps on the device — no API key/billing).
const mapsUrl = (lat, lng) => 'https://www.google.com/maps?q=' + lat + ',' + lng;
// GPS capture button — TOUCH-ONLY (hidden on desktop so the office location is never saved as a
// customer's; desktop keeps only the paste-a-Maps-link field). Reads a high-accuracy fix; if the
// reported accuracy is worse than 100 m (likely WiFi, not GPS) it asks first: Retry / Save anyway /
// Cancel. `onCapture` → fill mode (add/edit form); otherwise it saves straight to the server.
const IS_TOUCH = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const ACC_LIMIT = 100;
function GpsButton({ custId, hasLoc, onSaved, onCapture, onFlash, label }) {
  const [busy, setBusy] = uSx(false);
  const [low, setLow] = uSx(null);   // { lat, lng, accuracy } awaiting the low-accuracy choice
  if (!IS_TOUCH()) return null;
  const fail = (m) => onFlash && onFlash(m);
  const persist = (lat, lng, accuracy) => {
    if (onCapture) { onCapture({ lat, lng, accuracy }); return; }
    setBusy(true);
    window.API.distribusi.customers.setLocation(custId, { lat, lng, accuracy })
      .then((r) => { setBusy(false); onSaved && onSaved(r.data); })
      .catch(() => { setBusy(false); fail(trD('dist.locSaveErr')); });
  };
  const capture = () => {
    if (hasLoc && !onCapture && !window.confirm(trD('dist.locOverwriteConfirm'))) return;
    if (!(navigator.geolocation && navigator.geolocation.getCurrentPosition)) { fail(trD('dist.locUnavailable')); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const acc = Math.round(pos.coords.accuracy);
        if (acc > ACC_LIMIT) { setLow({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc }); return; }
        persist(pos.coords.latitude, pos.coords.longitude, acc);
      },
      () => { setBusy(false); fail(trD('dist.locDenied')); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  return (<>
    <button type="button" className="btn btn-ghost btn-sm dist-gps-btn" disabled={busy} onClick={capture}><IconPin s={14} />{busy ? '…' : (label || (hasLoc ? trD('dist.locUpdate') : trD('dist.locTag')))}</button>
    {low && (
      <div className="modal-scrim" onClick={() => setLow(null)} style={{ zIndex: 260 }}>
        <div className="modal-card" style={{ maxWidth: 390 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div style={{ fontSize: 16, fontWeight: 800 }}>{trD('dist.locLowT')}</div></div>
          <div className="modal-body"><div className="dist-gr-warn"><IconWarn s={16} /><span>{trD('dist.locLowMsg', { x: low.accuracy })}</span></div></div>
          <div className="modal-foot" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setLow(null)}>{trD('dist.locCancel')}</button>
            <button className="btn btn-ghost" onClick={() => { setLow(null); capture(); }}>{trD('dist.locRetry')}</button>
            <button className="btn btn-primary" onClick={() => { const l = low; setLow(null); persist(l.lat, l.lng, l.accuracy); }}>{trD('dist.locSaveAnyway')}</button>
          </div>
        </div>
      </div>
    )}
  </>);
}

// Customer LOCATION PHOTO. Bytes live in the Attachment store (never inline in the record); the
// customer row only keeps the attachment id. Thumbnail loads lazily; the full image opens via the
// shared ProofViewer (also lazy). Upload/replace/remove go through UI.FileAttach (camera on mobile)
// → we persist only the returned ref id. Not part of the "data lengkap" check — optional extra.
function LocThumb({ photoId, onView }) {
  const [src, setSrc] = uSx(null);
  uEx(() => { let live = true; setSrc(null); if (photoId && window.API && window.API.attachments) { window.API.attachments.get(photoId).then((r) => { if (live) setSrc(r && r.data ? r.data.data : null); }).catch(() => {}); } return () => { live = false; }; }, [photoId]);
  return src
    ? <img className="dist-locphoto-thumb" src={src} alt="foto lokasi" onClick={onView} />
    : <div className="dist-locphoto-ph" onClick={onView}><span className="ui-attach-spin" /></div>;
}
function LocPhoto({ custId, photoId, byName, at, canEdit, onChanged, compact }) {
  const view = () => { if (photoId && window.UI && window.UI._viewProof) window.UI._viewProof({ ref: photoId, isImg: true, name: 'foto-lokasi.jpg' }); };
  const persist = (id) => window.API.distribusi.customers.setLocationPhoto(custId, id).then(() => onChanged && onChanged()).catch(() => {});
  const onPick = (v) => { if (v && v.ref) persist(v.ref); };   // cloud upload → store only the ref id
  if (compact) {
    return (
      <span className="dist-locphoto-board">
        {photoId && <button type="button" className="dist-link" onClick={view}><IconPin s={12} />{trD('dist.locPhotoView')}</button>}
        {canEdit && <UI.FileAttach value={null} onChange={onPick} compact camera label={photoId ? trD('dist.locPhotoReplace') : trD('dist.locPhotoAdd')} />}
      </span>
    );
  }
  return (
    <div className="dist-locphoto">
      {photoId ? (<>
        <LocThumb photoId={photoId} onView={view} />
        <div className="dist-locphoto-side">
          {byName ? <div className="dist-locphoto-meta">{trD('dist.locPhotoBy', { who: byName, d: fmtDT(at) })}</div> : null}
          {canEdit && <div className="dist-locphoto-acts"><UI.FileAttach value={null} onChange={onPick} compact camera label={trD('dist.locPhotoReplace')} /><button type="button" className="dist-link danger" onClick={() => persist(null)}>{trD('dist.locPhotoRemove')}</button></div>}
        </div>
      </>) : (
        canEdit ? <UI.FileAttach value={null} onChange={onPick} camera label={trD('dist.locPhotoAdd')} /> : <div className="dist-hint">{trD('dist.locPhotoNone')}</div>
      )}
    </div>
  );
}

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
  const [payOpen, setPayOpen] = uSx(false);   // standalone Pelunasan Bon
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
    return filter === 'all' ? true : filter === 'corrected' ? corrected : filter === 'arsip' ? t.legacy : t.method === filter;
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
                  <input className="tnum" inputMode="numeric" value={fQty} aria-label={trD('dist.fQty')}
                    onChange={(e) => setQty(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0)}
                    onFocus={(e) => e.target.select()} />
                  <button type="button" onClick={() => setQty(fQty + 1)}>+</button>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <label className="fld-label">{trD('dist.fDate')}</label>
                {staffMode
                  ? <div className="dist-datelocked"><span><IconCalendar s={15} />{trD('dist.todayWord')} · {today}</span><IconLock s={13} /></div>
                  : <DP.DateField value={fDate} onChange={setFDate} max={today} />}
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
  const chips = [['all', trD('dist.fAll')], ['lunas', trD('dist.lunas')], ['bon', trD('dist.bon')], ['pelunasan', trD('dist.pelunasan')], ['corrected', trD('dist.corrected')], ['arsip', trD('dist.arsip')]];
  return (
    <div className="dist-dash screen-enter">
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-tx-toolbar">
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canInput && <button type="button" className="btn btn-ghost dist-paybtn" onClick={() => setPayOpen(true)}><IconInvoice s={15} />{trD('dist.payBon')}</button>}
          {canInput && <button type="button" className="btn btn-primary dist-newbtn" onClick={() => { setView('form'); setFErr(''); }}><IconPlus s={16} />{trD('dist.newTxn')}</button>}
        </div>
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
                  {t.customer && t.customer.code && <span className="dist-code">{t.customer.code}</span>}
                  <span className="dist-txn-name">{t.customer ? t.customer.name : '—'}</span>
                  {t.legacy ? <span className="dist-badge arsip"><IconInvoice s={10} />{trD('dist.arsip')}</span> : <span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span>}
                  {isNew ? <span className="dist-badge new">{trD('dist.baru')}</span> : null}
                  {corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}
                  {t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}
                </div>
                <div className="dist-txn-sub">{shortRef(t.id)} · {t.txnDate} {hhmm(t.createdAt)} · {t.method === 'pelunasan' ? trD('dist.payLine') : (numX(t.qty) + ' × ' + rpFull(t.unitPriceLocked))}{t.actorName ? ' · ' + t.actorName : ''}{t.note ? ' · ' + t.note : ''}{t.adjusted ? ' · ' + (t.adjustAmount >= 0 ? '+' : '') + rpFull(t.adjustAmount) : ''}</div>
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
      {payOpen && <PaymentModal customers={customers} staffMode={staffMode} today={today} onClose={() => setPayOpen(false)}
        onSaved={(d) => { setPayOpen(false); setNewIds((p) => [d.id, ...p]); flash(trD('dist.paySaved', { amt: rpFull(d.amount), sisa: rpFull(d.sisaBon || 0) })); reload(); if (onChanged) onChanged(); }} />}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// Standalone Pelunasan Bon — record a bon payment without selling water (galon 0).
function PaymentModal({ customers, staffMode, today, onClose, onSaved, presetCustomer }) {
  const [cust, setCust] = uSx(presetCustomer || '');
  const [amount, setAmount] = uSx(0);
  const [method, setMethod] = uSx('cash');
  const [date, setDate] = uSx(today);
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const withBon = (customers || []).filter((c) => (c.sisaBon || 0) > 0);
  const sel = (customers || []).find((c) => c.id === cust) || null;
  const sisa = sel ? (sel.sisaBon || 0) : 0;
  const valid = sel && sisa > 0 && amount > 0 && amount <= sisa;
  const save = () => {
    if (!valid || saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.transactions.create({ customerId: cust, method: 'pelunasan', payAmount: amount, payMethod: method, note: note.trim(), txnDate: staffMode ? today : (date || today) })
      .then((r) => { setSaving(false); onSaved(r.data); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.payBonT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.payBonSub')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
          {withBon.length === 0 ? <div className="dist-note">{trD('dist.noBonCust')}</div>
            : <UI.Dropdown value={cust} options={withBon.map((c) => ({ value: c.id, label: c.name + ' · ' + trD('dist.sisaBon') + ' ' + rpFull(c.sisaBon) }))} placeholder={trD('dist.fCustPh')} onChange={(v) => { setCust(v); setAmount(0); }} fluid />}
          {sel && <div className="dist-lockrow" style={{ marginTop: 10 }}><span className="dist-lockrow-l"><IconInvoice s={14} />{trD('dist.sisaBon')}</span><span className="dist-lockrow-r">{rpFull(sisa)}</span></div>}
          <label className="fld-label">{trD('dist.payAmount')}</label>
          <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={amount ? amount.toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setAmount(Math.min(sisa, +e.target.value.replace(/\D/g, '') || 0))} /></div>
          <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.payHint')}{sel ? ' · ' + trD('dist.payAfter', { sisa: rpFull(Math.max(0, sisa - amount)) }) : ''}</div>
          <label className="fld-label">{trD('dist.payMethod')}</label>
          <div className="cat-chips">
            {['cash', 'transfer'].map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{trD('dist.pay_' + m)}</button>)}
          </div>
          {!staffMode && (<><label className="fld-label">{trD('dist.fDate')}</label><DP.DateField value={date} onChange={setDate} max={today} /></>)}
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.notePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!valid || saving} onClick={save}>{saving ? '…' : trD('dist.paySave')}</button></div>
      </div>
    </div>
  );
}

window.DISTPAY = { PaymentModal };

// Build an invoice from a customer's transactions: pick a scope (unpaid bon / period /
// all sales), a due date + note, preview the billed items + total, then create.
function InvoiceBuilder({ customer, onClose, onCreated }) {
  const [scope, setScope] = uSx('unpaidBon');
  const [dateFrom, setDateFrom] = uSx('');
  const [dateTo, setDateTo] = uSx('');
  const [dueDate, setDueDate] = uSx('');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const today = (window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const txns = (customer.transactions || []).filter((t) => t.method !== 'pelunasan');
  const preview = txns.filter((t) => {
    if (scope === 'unpaidBon') return t.method === 'bon';
    if (scope === 'period') return (!dateFrom || t.txnDate >= dateFrom) && (!dateTo || t.txnDate <= dateTo);
    return true;   // 'selected'/all sales
  });
  const total = preview.reduce((s, t) => s + (t.effectiveAmount != null ? t.effectiveAmount : t.amount), 0);
  const create = () => {
    if (saving || !preview.length) return;
    setSaving(true); setErr('');
    const body = { scope, dueDate: dueDate || '', note: note.trim() };
    if (scope === 'period') { if (dateFrom) body.dateFrom = dateFrom; if (dateTo) body.dateTo = dateTo; }
    if (scope === 'selected') body.transactionIds = preview.map((t) => t.id);
    window.API.distribusi.invoices.create(customer.id, body)
      .then((r) => { setSaving(false); onCreated(r.data); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const scopes = [['unpaidBon', trD('dist.invScopeBon')], ['period', trD('dist.invScopePeriod')], ['selected', trD('dist.invScopeAll')]];
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.makeInvoice')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.invScope')}</label>
          <div className="cat-chips">{scopes.map(([k, l]) => <button key={k} type="button" className={`cat-chip ${scope === k ? 'on' : ''}`} onClick={() => setScope(k)}>{l}</button>)}</div>
          {scope === 'period' && (
            <div className="dist-form-row" style={{ marginTop: 10 }}>
              <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.from')}</label><DP.DateField value={dateFrom} onChange={setDateFrom} max={dateTo || today} /></div>
              <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.to')}</label><DP.DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} max={today} /></div>
            </div>
          )}
          <label className="fld-label">{trD('dist.dueDate')}</label>
          <DP.DateField value={dueDate} onChange={setDueDate} min={today} allowFuture placeholder={trD('dist.dueDate')} />
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.notePh')} />
          <div className="dist-lockrow" style={{ marginTop: 12 }}><span className="dist-lockrow-l"><IconInvoice s={14} />{trD('dist.invPreview', { n: preview.length })}</span><span className="dist-lockrow-r">{rpFull(total)}</span></div>
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!preview.length || saving} onClick={create}>{saving ? '…' : trD('dist.invCreate')}</button></div>
      </div>
    </div>
  );
}

// Printable invoice / nota. Print (window.print) + WhatsApp share; a document only.
function InvoiceViewer({ invoice, onClose }) {
  uEx(() => { document.body.classList.add('invoice-open'); const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => { document.body.classList.remove('invoice-open'); window.removeEventListener('keydown', o); }; }, []);
  const iv = invoice; const cust = iv.customer || {};
  const share = () => {
    const lines = ['*Invoice ' + iv.number + '*', BIZ_NAME, trD('dist.invTo') + ': ' + cust.name, '',
      ...iv.items.map((it) => it.date + ' · ' + it.qty + ' ' + trD('dist.galonUnit') + ' · ' + rpFull(it.amount)),
      '', trD('dist.total') + ': ' + rpFull(iv.total), trD('dist.sisaBon') + ': ' + rpFull(iv.sisaBon),
      iv.dueDate ? trD('dist.dueDate') + ': ' + iv.dueDate : ''].filter(Boolean);
    window.open('https://wa.me/' + waNumber(cust.phone) + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };
  return (
    <div className="modal-scrim invoice-overlay" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="invoice-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Logo s={34} /><div><div className="inv-biz">{BIZ_NAME}</div><div className="inv-biz-sub">{BIZ_SUB}</div></div></div>
          <div className="inv-actions no-print">
            <button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trD('dist.print')}</button>
            {cust.phone ? <button className="btn btn-ghost" onClick={share}><IconInvoice s={16} />WhatsApp</button> : null}
            <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
          </div>
        </div>
        <div className="inv-meta">
          <div><div className="inv-title">INVOICE / NOTA</div><div className="inv-num">{iv.number}</div></div>
          <div className="inv-to"><div className="inv-lbl">{trD('dist.invTo')}</div><b>{cust.name}</b><div style={{ color: 'var(--text-mut)', fontSize: 12.5 }}>{cust.phone || ''}</div></div>
        </div>
        <div className="inv-dates"><span>{trD('dist.issueDate')}: <b>{iv.issueDate}</b></span>{iv.dueDate ? <span>{trD('dist.dueDate')}: <b>{iv.dueDate}</b></span> : null}</div>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>{trD('dist.date')}</th><th>{trD('dist.item')}</th><th className="r">Qty</th><th className="r">{trD('dist.hargaPerGalon')}</th><th className="r">Subtotal</th></tr></thead>
            <tbody>{iv.items.map((it, i) => (<tr key={i}><td className="tnum">{it.date}</td><td>{trD('dist.galonUnit')} · {methodLabel(it.method)}</td><td className="r tnum">{numX(it.qty)}</td><td className="r tnum">{rpFull(it.unitPrice)}</td><td className="r tnum">{rpFull(it.amount)}</td></tr>))}</tbody>
            <tfoot><tr><td colSpan="4" className="r"><b>{trD('dist.total')}</b></td><td className="r tnum"><b>{rpFull(iv.total)}</b></td></tr></tfoot>
          </table>
        </div>
        <div className="inv-foot">
          <div className="inv-sisa"><span>{trD('dist.sisaBon')}</span><b className="tnum">{rpFull(iv.sisaBon)}</b></div>
          {iv.note ? <div className="inv-note">{iv.note}</div> : null}
        </div>
        <div className="inv-by no-print">{trD('dist.invBy')}: {iv.createdByName || '—'} · {iv.issueDate}</div>
      </div>
    </div>
  );
}

// Printable FULL transaction-history document — evidence for when a customer disputes a
// transaction. Reuses the invoice PRINT machinery (invoice-open body class + .invoice-overlay
// / .no-print) and window.print, plus an optional period filter (all / date range / month).
// Corrected & adjusted transactions are shown WITH their status + delta (never hidden) so the
// record is credible; every row carries who recorded it (actorName) + when, and the footer
// stamps who printed it and when.
function TxnHistoryDoc({ customer, userName, onClose }) {
  uEx(() => { document.body.classList.add('invoice-open'); const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => { document.body.classList.remove('invoice-open'); window.removeEventListener('keydown', o); }; }, []);
  const [mode, setMode] = uSx('all');
  const [from, setFrom] = uSx('');
  const [to, setTo] = uSx('');
  const [month, setMonth] = uSx(new Date().toISOString().slice(0, 7));
  // Oldest → newest reads like a ledger on paper.
  const all = (customer.transactions || []).slice().sort((a, b) => (a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  const inPeriod = (t) => {
    if (mode === 'range') return (!from || t.txnDate >= from) && (!to || t.txnDate <= to);
    if (mode === 'month') return (t.txnDate || '').slice(0, 7) === month;
    return true;
  };
  const rows = all.filter(inPeriod);
  let galon = 0, nilai = 0, terbayar = 0;
  rows.forEach((t) => {
    galon += t.qty || 0;
    const eff = t.effectiveAmount != null ? t.effectiveAmount : t.amount;
    if (t.method === 'lunas') { nilai += eff; terbayar += eff; }
    else if (t.method === 'bon') { nilai += eff; }
    else if (t.method === 'pelunasan') { terbayar += t.amount; }
  });
  const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  const stampTime = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const docNo = 'RWT-' + String(customer.id || '').slice(-6).toUpperCase() + '-' + stamp.replace(/-/g, '');
  const periodLabel = mode === 'range' ? ((from || '…') + ' – ' + (to || '…')) : mode === 'month' ? month : trD('dist.periodAll');
  const share = () => {
    const lines = ['*' + trD('dist.histTitle') + '*', BIZ_NAME, trD('dist.invTo') + ': ' + (customer.code ? customer.code + ' · ' : '') + customer.name, trD('dist.period') + ': ' + periodLabel, '',
      trD('dist.totalGalon') + ': ' + numX(galon), trD('dist.histTotalValue') + ': ' + rpFull(nilai), trD('dist.histTotalPaid') + ': ' + rpFull(terbayar), trD('dist.sisaBon') + ': ' + rpFull(customer.sisaBon || 0),
      '', trD('dist.txnCount', { n: rows.length }) + ' · ' + docNo];
    window.open('https://wa.me/' + waNumber(customer.phone) + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };
  return (
    <div className="modal-scrim invoice-overlay" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="invoice-sheet dist-hist-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="inv-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Logo s={34} /><div><div className="inv-biz">{BIZ_NAME}</div><div className="inv-biz-sub">{BIZ_SUB}</div></div></div>
          <div className="inv-actions no-print">
            <button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trD('dist.print')}</button>
            {customer.phone ? <button className="btn btn-ghost" onClick={share}><IconInvoice s={16} />WhatsApp</button> : null}
            <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
          </div>
        </div>
        <div className="dist-hist-filter no-print">
          <span className="dist-hist-flabel">{trD('dist.period')}:</span>
          {[['all', 'dist.periodAll'], ['range', 'dist.periodRange'], ['month', 'dist.periodMonth']].map(([k, l]) => <button key={k} type="button" className={`cat-chip ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>{trD(l)}</button>)}
          {mode === 'range' && (<><DP.DateField value={from} onChange={setFrom} max={to || stamp} /><span>–</span><DP.DateField value={to} onChange={setTo} min={from || undefined} max={stamp} /></>)}
          {mode === 'month' && <input type="month" className="fld dist-hist-date" value={month} onChange={(e) => setMonth(e.target.value)} />}
        </div>
        <div className="inv-meta">
          <div><div className="inv-title">{trD('dist.histTitle')}</div><div className="inv-num">{docNo}</div></div>
          <div className="inv-to"><div className="inv-lbl">{trD('dist.invTo')}</div><b>{customer.code ? customer.code + ' · ' : ''}{customer.name}</b><div style={{ color: 'var(--text-mut)', fontSize: 12.5 }}>{customer.phone || '—'}{customer.armada ? ' · ' + customer.armada : ''}</div></div>
        </div>
        <div className="inv-dates"><span>{trD('dist.issueDate')}: <b>{stamp}</b></span><span>{trD('dist.period')}: <b>{periodLabel}</b></span></div>
        <div className="inv-table-wrap">
          <table className="inv-table dist-hist-table">
            <thead><tr><th>{trD('dist.docNoShort')}</th><th>{trD('dist.date')}</th><th>{trD('dist.method')}</th><th className="r">Qty × {trD('dist.hargaPerGalon')}</th><th className="r">{trD('dist.amount')}</th></tr></thead>
            <tbody>{rows.length === 0
              ? <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-mut)', padding: 18 }}>{trD('dist.noTxn')}</td></tr>
              : rows.map((t) => {
                // Always the EFFECTIVE amount (corrections/adjustments folded in) so totals are
                // accurate — no status/koreksi markers, just the correct number.
                const eff = t.effectiveAmount != null ? t.effectiveAmount : t.amount;
                return (
                  <tr key={t.id}>
                    <td className="tnum">{shortRef(t.id)}</td>
                    <td className="tnum">{t.txnDate}</td>
                    <td>{methodLabel(t.method)}{t.openingBon ? ' · ' + trD('dist.obLabel') : ''}{t.note ? ' · ' + t.note : ''}</td>
                    <td className="r tnum">{t.method === 'pelunasan' ? '—' : (numX(t.qty) + ' × ' + rpFull(t.unitPriceLocked))}</td>
                    <td className="r tnum">{rpFull(eff)}</td>
                  </tr>
                );
              })}</tbody>
          </table>
        </div>
        <div className="dist-hist-summary">
          <div><span>{trD('dist.totalGalon')}</span><b className="tnum">{numX(galon)}</b></div>
          <div><span>{trD('dist.histTotalValue')}</span><b className="tnum">{rpFull(nilai)}</b></div>
          <div><span>{trD('dist.histTotalPaid')}</span><b className="tnum">{rpFull(terbayar)}</b></div>
          <div><span>{trD('dist.sisaBon')}</span><b className="tnum" style={{ color: (customer.sisaBon || 0) > 0 ? 'var(--warn)' : 'var(--green-700)' }}>{rpFull(customer.sisaBon || 0)}</b></div>
        </div>
        <div className="inv-by">{trD('dist.printedBy', { u: userName || '—', t: stamp + ' ' + stampTime })} · {trD('dist.txnCount', { n: rows.length })}</div>
      </div>
    </div>
  );
}

// Two-option customer removal modal. Option (a) Nonaktifkan is the safe default (history
// kept, reversible); option (b) Hapus permanen is destructive and requires a firm confirm —
// the checkbox always, plus typing the exact name when the customer carries transactions or
// sisa bon (so an accidental wipe of real data can't happen with one click).
function DeleteCustomerModal({ customer, busy, onDeactivate, onDelete, onClose }) {
  const [mode, setMode] = uSx('deactivate');       // 'deactivate' (default, highlighted) | 'delete'
  const [understand, setUnderstand] = uSx(false);
  const [typed, setTyped] = uSx('');
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const txnCount = customer.txnCount || 0;
  const sisaBon = customer.sisaBon || 0;
  const hasHistory = txnCount > 0 || sisaBon > 0;
  const nameOk = typed.trim().toLowerCase() === String(customer.name || '').trim().toLowerCase();
  const canDeleteNow = mode === 'delete' && understand && (!hasHistory || nameOk);
  const primary = () => { if (busy) return; if (mode === 'deactivate') onDeactivate(); else if (canDeleteNow) onDelete(); };
  const opt = (key, title, desc, cls) => (
    <button type="button" className={`dist-del-opt ${cls} ${mode === key ? 'on' : ''}`} onClick={() => setMode(key)}>
      <span className="dist-del-radio">{mode === key ? <IconCheck s={13} /> : null}</span>
      <span className="dist-del-opt-body"><span className="dist-del-opt-title">{title}{key === 'deactivate' && <span className="dist-del-safe">{trD('dist.delSafer')}</span>}</span><span className="dist-del-opt-desc">{desc}</span></span>
    </button>
  );
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 260 }}>
      <div className="modal-card dist-del-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.delTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.delSubtitle', { name: customer.name })}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {opt('deactivate', trD('dist.delOptDeactivate'), trD('dist.delOptDeactivateDesc'), 'safe')}
          {opt('delete', trD('dist.delOptDelete'), trD('dist.delOptDeleteDesc'), 'danger')}
          {mode === 'delete' && (
            <div className="dist-del-confirm">
              {hasHistory && <div className="dist-del-warn"><IconWarn s={16} />{trD('dist.delWarnHistory', { n: txnCount, rp: rpFull(sisaBon) })}</div>}
              <label className="dist-del-check"><input type="checkbox" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} /><span>{trD('dist.delUnderstand')}</span></label>
              {hasHistory && (
                <div className="dist-del-typebox">
                  <div className="dist-del-typelbl">{trD('dist.delTypeName')}</div>
                  <input className="fld" value={typed} placeholder={customer.name} onChange={(e) => setTyped(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          {mode === 'deactivate'
            ? <button className="btn btn-primary" disabled={busy} onClick={primary}>{busy ? '…' : trD('dist.delConfirmDeactivate')}</button>
            : <button className="btn dist-btn-danger" disabled={busy || !canDeleteNow} onClick={primary}>{busy ? '…' : trD('dist.delConfirmDelete')}</button>}
        </div>
      </div>
    </div>
  );
}

// ════════════════ PELANGGAN (list + detail + add + import) ════════════════
// `fleet` is the SINGLE app-wide armada source (shell state ← /settings airro_fleet,
// the same list managed in Setoran → Kelola Armada). Distribusi never keeps its own
// copy — changing a plate there is reflected here immediately.
// Per-customer LEGACY (archive) transaction import. Paste OR upload (.csv/.xlsx/.xls). Columns:
// Tanggal · Jumlah galon · Harga · Metode(lunas|bon) · Catatan. No customer column — the server
// takes the customerId from the route. Live preview (Ready/Missing/Invalid date/Duplicate); imports
// valid rows only; dedupes vs this customer's existing rows + within the file.
function LegacyImportModal({ customer, onClose, onDone }) {
  const [text, setText] = uSx('');
  const [fileRows, setFileRows] = uSx(null);
  const [fileName, setFileName] = uSx('');
  const [fileBusy, setFileBusy] = uSx(false);
  const [err, setErr] = uSx('');
  const [saving, setSaving] = uSx(false);
  const fileRef = React.useRef(null);
  const existing = new Set((customer.transactions || []).map((t) => `${t.txnDate}|${t.qty}|${t.amount}`));
  const rawCells = fileRows || text.split('\n').map((l) => l.trim()).filter(Boolean).map(splitCells);
  const HRE = { date: /tanggal|tgl|date/i, qty: /galon|jumlah|qty/i, price: /harga|price|tarif/i, method: /metode|method|bayar|cara/i, note: /catatan|note|keterangan|ket/i };
  let colMap = { date: 0, qty: 1, price: 2, method: 3, note: 4 };
  let dataRows = rawCells;
  if (rawCells.length) {
    const h = rawCells[0].join(' ');
    if (HRE.date.test(h) && (HRE.qty.test(h) || HRE.price.test(h))) {   // header row
      const hdr = rawCells[0]; const idx = (re) => hdr.findIndex((c) => re.test(c));
      colMap = { date: Math.max(0, idx(HRE.date)), qty: idx(HRE.qty), price: idx(HRE.price), method: idx(HRE.method), note: idx(HRE.note) };
      dataRows = rawCells.slice(1);
    }
  }
  const cellAt = (row, i) => (i >= 0 && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : '');
  const seen = new Set();
  const rows = dataRows.filter((r) => r && r.some((c) => String(c || '').trim())).map((cols) => {
    const dateRaw = cellAt(cols, colMap.date); const date = parseLegacyDate(dateRaw);
    const qty = parseInt(cellAt(cols, colMap.qty).replace(/[^0-9]/g, ''), 10);
    const priceCell = cellAt(cols, colMap.price); const price = priceCell === '' ? null : parseInt(priceCell.replace(/[^0-9]/g, ''), 10);
    const method = /bon/i.test(cellAt(cols, colMap.method)) ? 'bon' : 'lunas';
    const note = cellAt(cols, colMap.note);
    const okBase = !!date && qty > 0 && price != null && !isNaN(price);
    const amount = okBase ? qty * price : 0;
    const key = okBase ? `${date}|${qty}|${amount}` : '';
    const dup = okBase && (existing.has(key) || seen.has(key));
    if (key && !dup) seen.add(key);
    const status = !date ? 'baddate' : (!(qty > 0) || price == null || isNaN(price)) ? 'kurang' : dup ? 'dup' : 'ok';
    return { dateRaw, date, qty: qty || 0, price: (price == null || isNaN(price)) ? null : price, method, note, amount, status, valid: status === 'ok' };
  });
  const valid = rows.filter((r) => r.valid);
  const reset = () => { setText(''); setFileRows(null); setFileName(''); setErr(''); if (fileRef.current) fileRef.current.value = ''; };
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    setErr(''); setFileBusy(true); setFileName(file.name); setText('');
    const isXlsx = /\.xlsx?$/i.test(file.name) || /sheet|excel/i.test(file.type);
    if (isXlsx) {
      loadSheetJS().then((XLSX) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rws = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }).map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
            setFileRows(rws); setFileBusy(false);
          } catch (ex) { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); }
        };
        rd.onerror = () => { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); };
        rd.readAsArrayBuffer(file);
      }).catch(() => { setErr(trD('dist.importXlsxCdnErr')); setFileBusy(false); setFileName(''); });
    } else {
      const rd = new FileReader();
      rd.onload = () => { setFileRows(String(rd.result || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitCells)); setFileBusy(false); };
      rd.onerror = () => { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); };
      rd.readAsText(file);
    }
  };
  const commit = () => {
    if (!valid.length || saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.customers.importLegacyTxns(customer.id, valid.map((r) => ({ txnDate: r.date, qty: r.qty, price: r.price, method: r.method, ...(r.note ? { note: r.note } : {}) })), rows.length - valid.length)
      .then((res) => { setSaving(false); onDone(res); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  const statusLabel = (s) => s === 'ok' ? trD('dist.impReady') : s === 'kurang' ? trD('dist.impMissing') : s === 'baddate' ? trD('dist.liBadDate') : trD('dist.impDup');
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="modal-card" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.liTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.code ? customer.code + ' · ' : ''}{customer.name}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.liInfo')}</span></div>
          <div className="dist-imp-fmt"><span>{trD('dist.importFmt')}: <b>Tanggal · Jumlah Galon · Harga · Metode · Catatan</b></span><button type="button" className="dist-link" onClick={downloadLegacyTemplate}><IconDownload s={13} />{trD('dist.importTemplate')}</button></div>
          <div className="dist-imp-upload">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} onChange={onFile} />
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current && fileRef.current.click()}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.importUpload')}</button>
            {fileBusy ? <span className="dist-imp-fname"><span className="ui-attach-spin" />{trD('dist.importReading')}</span>
              : fileRows ? <span className="dist-imp-fname"><IconCheck s={13} />{fileName}<button type="button" className="dist-link" onClick={reset} style={{ marginLeft: 8 }}>{trD('dist.importClear')}</button></span>
              : <span className="dist-imp-or">{trD('dist.importOr')}</span>}
          </div>
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={13} />{err}</div>}
          {!fileRows && !fileBusy && <textarea className="fld dist-imp-ta" value={text} placeholder={'2026-01-15\t10\t12000\tlunas\tsaldo awal'} onChange={(e) => setText(e.target.value)} />}
          {rows.length > 0 && (<>
            <div className="dist-imp-counts"><span className="dist-imp-ok">{valid.length} {trD('dist.importReady')}</span><span className="dist-imp-skip">{rows.length - valid.length} {trD('dist.importSkip')}</span></div>
            <div className="dist-imp-preview">
              <div className="dist-imp-hrow li"><span>Tanggal</span><span>Galon</span><span>Harga</span><span>Metode</span><span>Status</span></div>
              {rows.slice(0, 400).map((r, i) => (
                <div key={i} className="dist-imp-row li">
                  <span className="dist-imp-name">{r.date || r.dateRaw || '—'}</span><span>{r.qty || '—'}</span><span>{r.price != null ? rpFull(r.price) : '—'}</span><span>{r.method}</span>
                  <span><span className={`dist-imp-status ${r.status}`}>{statusLabel(r.status)}</span></span>
                </div>
              ))}
              {rows.length > 400 && <div className="dist-hint" style={{ padding: '6px 10px' }}>… +{rows.length - 400}</div>}
            </div>
          </>)}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!valid.length || saving} onClick={commit}>{saving ? '…' : trD('dist.liImport', { n: valid.length })}</button></div>
      </div>
    </div>
  );
}

// ── BON AWAL / MANUAL ────────────────────────────────────────────────────────
// Record a customer's PRIOR outstanding receivable (carried over from the old books).
// It is saved as a REAL bon dated on the day the admin picks, so it counts toward sisa
// bon from that date and a later pelunasan reduces it. Deliberately NOT the legacy/archive
// flag, which is excluded from every aggregate.
function OpeningBonModal({ customer, onClose, onSaved }) {
  const [amount, setAmount] = uSx('');
  const [date, setDate] = uSx((window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10));
  const [note, setNote] = uSx('');
  const [busy, setBusy] = uSx(false);
  const [err, setErr] = uSx('');
  const [confirming, setConfirming] = uSx(false);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const amt = parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
  const valid = amt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && note.trim();
  const save = () => {
    if (!valid || busy) return;
    setBusy(true); setErr('');
    window.API.distribusi.customers.openingBon(customer.id, { amount: amt, txnDate: date, note: note.trim() })
      .then((r) => { setBusy(false); onSaved(r.data); })
      .catch((e) => { setBusy(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.obTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name}</div></div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.obInfo')}</span></div>
          {/* Double-count guard: warn (never block) if this customer already carries a bon. */}
          {(customer.sisaBon || 0) > 0 && (
            <div className="dist-warnbox"><IconWarn s={16} /><span>{trD('dist.obDupWarn', { amt: rpFull(customer.sisaBon) })}</span></div>
          )}
          <label className="fld-label">{trD('dist.obAmount')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld tnum" inputMode="numeric" value={amount} placeholder="cth. 500000" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} />
          <label className="fld-label">{trD('dist.obDate')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="gud-hint">{trD('dist.obDateHint')}</div>
          <label className="fld-label">{trD('dist.obNote')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" value={note} placeholder={trD('dist.obNotePh')} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
          {confirming && <div className="dist-warnbox" style={{ marginTop: 10 }}><IconWarn s={16} /><span>{trD('dist.obConfirm', { amt: rpFull(amt), date })}</span></div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          {!confirming
            ? <button className="btn btn-primary" disabled={!valid} onClick={() => setConfirming(true)}>{trD('dist.obNext')}</button>
            : <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '…' : trD('dist.obSave')}</button>}
        </div>
      </div>
    </div>
  );
}

function DistCustomers({ canCustomers, canPrice, canInput, canKoreksi, canDelete, canLegacyImport, isGmOwner, staffMode, refreshKey, fleet, fleetScope, distFleet, setDistFleet, onGoHarga, onChanged, userName }) {
  const [view, setView] = uSx('list');
  const [custs, setCusts] = uSx(null);
  const [statusFilter, setStatusFilter] = uSx('active');   // 'active' (default) | 'inactive' — Nonaktif view (cap holders only)
  const [delFor, setDelFor] = uSx(null);                   // customer being removed → opens the 2-option DeleteCustomerModal
  const [delBusy, setDelBusy] = uSx(false);
  const [loadErr, setLoadErr] = uSx('');   // customer-list load failure → message + retry (never a silent hang)
  const [types, setTypes] = uSx([]);
  const [detail, setDetail] = uSx(null);
  const [invoices, setInvoices] = uSx([]);       // this customer's invoice history
  const [invBuilder, setInvBuilder] = uSx(false); // Buat Invoice modal
  const [invView, setInvView] = uSx(null);        // printable invoice viewer
  const [histOpen, setHistOpen] = uSx(false);     // printable full transaction-history doc
  const [legacyOpen, setLegacyOpen] = uSx(false); // legacy (archive) transaction import modal
  const [payFor, setPayFor] = uSx(null);          // standalone Pelunasan Bon for this customer
  const [q, setQ] = uSx('');
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [form, setForm] = uSx(null);        // {id?, name, phone, type, price, deliveryDays[], armada} — Add/Edit modal
  const [saving, setSaving] = uSx(false);
  const [formErr, setFormErr] = uSx('');
  const [impOpen, setImpOpen] = uSx(false);
  const [impText, setImpText] = uSx('');
  const [impSaving, setImpSaving] = uSx(false);
  const [impFileRows, setImpFileRows] = uSx(null);   // 2D cells from an uploaded file (overrides the textarea)
  const [impFileName, setImpFileName] = uSx('');
  const [impFileErr, setImpFileErr] = uSx('');
  const [impFileBusy, setImpFileBusy] = uSx(false);
  const impFileRef = React.useRef(null);
  const [typesOpen, setTypesOpen] = uSx(false);
  const [obFor, setObFor] = uSx(null);   // customer whose opening/carry-over bon is being entered
  // ── Detailed filter (server-side, AND logic). EMPTY_FILTER is the "nothing selected"
  // baseline; `fTotal` is the denominator for "Menampilkan X dari Y".
  const [flt, setFlt] = uSx(EMPTY_FILTER);
  const [fltOpen, setFltOpen] = uSx(false);
  const [fTotal, setFTotal] = uSx(null);

  const ef = effFleet(fleetScope, distFleet);
  // Load the customer list. Never hangs: a stalled request is bounded by a 20s timeout, and any
  // failure surfaces as an error message + "coba lagi" (retry) instead of a perpetual spinner or a
  // misleading empty-state. On retry we reset to the loading state so the spinner reappears.
  const reload = () => {
    if (!(window.API && window.API.distribusi)) return Promise.resolve();
    setLoadErr('');   // keep any current list visible while refreshing; only retry() resets to the spinner
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000));
    // Only cap holders may view the Nonaktif list; everyone else is forced to 'active'.
    const st = (canDelete && statusFilter === 'inactive') ? 'inactive' : 'active';
    // The detailed criteria go to the SERVER so filtering runs against the whole dataset
    // (not just the rows already loaded), and the response carries the total for the count.
    return Promise.race([window.API.distribusi.customers.list(ef, st, { ...flt, q }), timeout])
      .then((r) => { setCusts(r.data || []); setFTotal(r.total != null ? r.total : null); setLoadErr(''); })
      .catch((e) => { setLoadErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  const retry = () => { setCusts(null); setLoadErr(''); reload(); };
  const reloadTypes = () => window.API.distribusi.types.list().then((r) => setTypes(r.data || [])).catch(() => {});
  uEx(() => {
    // window.API may attach a tick after this component mounts (async script/JSX compile); poll briefly
    // instead of bailing forever, and fall to an error (not an endless spinner) if it never arrives.
    let cancelled = false;
    const tryLoad = (n) => {
      if (cancelled) return;
      if (window.API && window.API.distribusi) { reload(); reloadTypes(); return; }
      if (n <= 0) { setLoadErr(trD('common.loadFail')); return; }
      setTimeout(() => tryLoad(n - 1), 150);
    };
    tryLoad(40);   // ~6s grace for the API to become ready
    return () => { cancelled = true; };
  }, [refreshKey, ef, statusFilter]);
  // Search text + detailed filter re-query the SERVER, debounced so typing doesn't fire a
  // request per keystroke. Skips the first run — the mount effect above already loaded.
  const fltMounted = React.useRef(false);
  uEx(() => {
    if (!fltMounted.current) { fltMounted.current = true; return; }
    const t = setTimeout(() => { if (window.API && window.API.distribusi) reload(); }, 300);
    return () => clearTimeout(t);
  }, [q, flt]);
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

  const loadInvoices = (id) => window.API.distribusi.invoices.list(id).then((r) => setInvoices(r.data || [])).catch(() => setInvoices([]));
  const openDetail = (id) => { setView('detail'); setDetail(null); setInvoices([]); window.API.distribusi.customers.get(id).then((r) => setDetail(r.data)).catch(() => setView('list')); loadInvoices(id); };
  const cancelAdj = (batchId) => {
    if (!confirm(trD('dist.pcCancelConfirm'))) return;
    window.API.distribusi.customers.cancelPriceAdjustment(batchId)
      .then(() => { flash(trD('dist.pcCancelled')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
      .catch(() => {});
  };
  // Customer removal (gated distribusiCustomerDelete). Deactivate = soft (history kept,
  // restorable); reactivate = restore; deletePermanent = irreversible wipe. The modal drives
  // which path runs; every result refreshes the list + notifies the shell.
  const doDeactivate = () => {
    if (!delFor) return; setDelBusy(true);
    window.API.distribusi.customers.deactivate(delFor.id)
      .then(() => { flash(trD('dist.delDeactivated', { name: delFor.name })); setDelFor(null); setView('list'); setDetail(null); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')))
      .finally(() => setDelBusy(false));
  };
  const doDeletePermanent = () => {
    if (!delFor) return; setDelBusy(true);
    window.API.distribusi.customers.remove(delFor.id)
      .then(() => { flash(trD('dist.delDeleted', { name: delFor.name })); setDelFor(null); setView('list'); setDetail(null); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')))
      .finally(() => setDelBusy(false));
  };
  const doReactivate = (c) => {
    window.API.distribusi.customers.reactivate(c.id)
      .then(() => { flash(trD('dist.delReactivated', { name: c.name })); if (detail && detail.id === c.id) openDetail(c.id); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  const defReminder = () => ({ enabled: false, dueDay: 0, weekday: '', overdueDays: 0, gallonThreshold: 0, bonThreshold: 0 });
  const remOf = (r) => (r && typeof r === 'object') ? { ...defReminder(), ...r, enabled: !!r.enabled } : defReminder();
  const openAdd = () => { setFormErr(''); setForm({ id: null, name: '', phone: '', type: defaultType(), price: '', deliveryDays: [], armada: '', reminder: defReminder(), address: '', mapsUrl: '' }); };
  const openEdit = (d) => { setFormErr(''); setForm({ id: d.id, name: d.name || '', phone: d.phone || '', type: d.type || defaultType(), price: '', deliveryDays: Array.isArray(d.deliveryDays) ? d.deliveryDays : [], armada: d.armada || '', reminder: remOf(d.reminder), address: d.address || '', mapsUrl: d.mapsUrl || '' }); };
  const toggleDay = (d) => setForm((f) => ({ ...f, deliveryDays: f.deliveryDays.includes(d) ? f.deliveryDays.filter((x) => x !== d) : [...f.deliveryDays, d] }));

  const commitForm = () => {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) { setFormErr(trD('dist.cfNameReq')); return; }
    const onErr = (e) => { setSaving(false); setFormErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); };
    const finish = (msg, data) => { setSaving(false); setForm(null); flash(msg); reload(); if (data) setDetail((d) => (d && d.id === data.id ? { ...d, ...data } : d)); if (onChanged) onChanged(); };
    const mu = (form.mapsUrl || '').trim();
    if (mu && !/^https?:\/\//i.test(mu)) { setFormErr(trD('dist.mapsUrlInvalid')); return; }
    const locFields = { address: (form.address || '').trim(), mapsUrl: mu };
    // GPS-captured point → also send lat/lng/accuracy so the ±m is stored (not just the link).
    if (form._lat != null && form._lng != null) { locFields.lat = form._lat; locFields.lng = form._lng; locFields.accuracy = form._accuracy != null ? form._accuracy : null; }
    setSaving(true); setFormErr('');
    if (!form.id) {
      const price = parseInt(String(form.price).replace(/[^0-9]/g, ''), 10);
      if (!price) { setSaving(false); setFormErr(trD('dist.cfPriceReq')); return; }
      window.API.distribusi.customers.create({ name, phone: form.phone.trim(), type: form.type, masterPrice: price, deliveryDays: form.deliveryDays, armada: form.armada, reminder: form.reminder, ...locFields })
        .then(() => finish(trD('dist.custAdded'))).catch(onErr);
    } else {
      window.API.distribusi.customers.update(form.id, { name, phone: form.phone.trim(), type: form.type, deliveryDays: form.deliveryDays, armada: form.armada, reminder: form.reminder, ...locFields })
        .then((r) => finish(trD('dist.custSaved'), r.data)).catch(onErr);
    }
  };

  // ── spreadsheet import parsing (shared by paste-text AND file upload) ──
  const typeByLabel = {}; types.forEach((t) => { typeByLabel[(t.label || '').toLowerCase()] = t.id; });
  // Dedup key = name + phone (two different people can share a name), matched case-insensitively.
  // Dedup on the NORMALISED phone so an Excel-mangled "8123…" and a typed "08123…" are the
  // same person (mirrors the server's defensive dedup).
  const dupKey = (n, p) => (String(n || '').trim().toLowerCase() + '|' + normalizePhone(p));
  const existing = new Set((custs || []).map((c) => dupKey(c.name, c.phone)));
  // Rows of cells come from an uploaded file if present, else the pasted textarea.
  const rawCells = impFileRows || impText.split('\n').map((l) => l.trim()).filter(Boolean).map(splitCells);
  // Flexible header mapping: recognise common headers in ANY order; if the first row isn't a
  // header, fall back to the positional order (Nama · No HP · Tipe · Harga).
  const HRE = { name: /nama|name/i, phone: /hp|phone|telp|telepon|wa\b/i, type: /tipe|type|jenis/i, price: /harga|price|tarif/i, days: /hari|kirim|days/i, armada: /armada|fleet|mobil|kendaraan/i, address: /alamat|address/i, mapsUrl: /maps|link|gmaps|lokasi/i };
  let colMap = { name: 0, phone: 1, type: 2, price: 3, days: -1, armada: -1, address: -1, mapsUrl: -1 };
  let dataRows = rawCells;
  if (rawCells.length) {
    const h = rawCells[0].join(' ');
    if (HRE.name.test(h) && HRE.price.test(h)) {   // looks like a header row
      const hdr = rawCells[0]; const idx = (re) => hdr.findIndex((c) => re.test(c));
      colMap = { name: Math.max(0, idx(HRE.name)), phone: idx(HRE.phone), type: idx(HRE.type), price: idx(HRE.price), days: idx(HRE.days), armada: idx(HRE.armada), address: idx(HRE.address), mapsUrl: idx(HRE.mapsUrl) };
      dataRows = rawCells.slice(1);
    }
  }
  const cellAt = (row, i) => (i >= 0 && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : '');
  const seen = new Set();
  const impRows = dataRows.filter((r) => r && r.some((c) => String(c || '').trim())).map((cols) => {
    const name = cellAt(cols, colMap.name); const phoneRaw = cellAt(cols, colMap.phone);
    // Auto-repair the number for BOTH the preview and the payload — the user never reformats Excel.
    const phone = normalizePhone(phoneRaw); const phoneFixed = phoneWasFixed(phoneRaw);
    const type = typeByLabel[cellAt(cols, colMap.type).toLowerCase()] || 'reguler';
    const num = parseInt(cellAt(cols, colMap.price).replace(/[^0-9]/g, ''), 10);
    const dc = cellAt(cols, colMap.days); const days = dc ? DAY_CODES.filter((d) => new RegExp(d, 'i').test(dc)) : [];
    const armada = cellAt(cols, colMap.armada); const address = cellAt(cols, colMap.address);
    const mu = cellAt(cols, colMap.mapsUrl); const mapsUrl = /^https?:\/\//i.test(mu) ? mu : '';
    const key = dupKey(name, phone); const dup = existing.has(key) || seen.has(key);
    if (name) seen.add(key);
    const valid = !!name && !!num && !dup;
    return { name: name || '(kosong)', phone: phone || '—', phoneFixed, type, price: num || 0, days, armada, address, mapsUrl, valid, status: valid ? 'ok' : (!name || !num) ? 'kurang' : 'dup' };
  });
  const impValid = impRows.filter((r) => r.valid);
  const resetImport = () => { setImpText(''); setImpFileRows(null); setImpFileName(''); setImpFileErr(''); };
  const commitImport = () => {
    if (!impValid.length || impSaving) return;
    setImpSaving(true);
    window.API.distribusi.customers.import(impValid.map((r) => ({
      name: r.name, phone: r.phone === '—' ? '' : r.phone, type: r.type, masterPrice: r.price,
      ...(r.days.length ? { deliveryDays: r.days } : {}), ...(r.armada ? { armada: r.armada } : {}),
      ...(r.address ? { address: r.address } : {}), ...(r.mapsUrl ? { mapsUrl: r.mapsUrl } : {}),
    })), impRows.length - impValid.length)   // pass the count skipped in preview → server audit
      .then((r) => { setImpSaving(false); setImpOpen(false); resetImport(); flash(trD('dist.importedSum', { n: r.imported, m: r.skipped != null ? r.skipped : (impRows.length - impValid.length) })); reload(); if (onChanged) onChanged(); })
      .catch(() => setImpSaving(false));
  };
  // Read a chosen file → 2D cells. CSV as text; XLSX/XLS via lazy-loaded SheetJS.
  const onImpFile = (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    setImpFileErr(''); setImpFileBusy(true); setImpFileName(file.name); setImpText('');
    const isXlsx = /\.xlsx?$/i.test(file.name) || /sheet|excel/i.test(file.type);
    if (isXlsx) {
      loadSheetJS().then((XLSX) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }).map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
            setImpFileRows(rows); setImpFileBusy(false);
          } catch (ex) { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); }
        };
        rd.onerror = () => { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); };
        rd.readAsArrayBuffer(file);
      }).catch(() => { setImpFileErr(trD('dist.importXlsxCdnErr')); setImpFileBusy(false); setImpFileName(''); });
    } else {
      const rd = new FileReader();
      rd.onload = () => { setImpFileRows(String(rd.result || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitCells)); setImpFileBusy(false); };
      rd.onerror = () => { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); };
      rd.readAsText(file);
    }
  };
  const impSample = 'Warung Sejahtera\t0821-1122-3344\tReguler\t12500\nKos Anggrek\t0813-7788-9900\tKos\t13000\nCafe Ombak\t0817-2211-3344\tCafe\t14000';
  // Undo a legacy import batch (GM/owner) — typed confirmation. Safe: archive rows touch no ledger.
  const undoLegacyBatch = (batchId) => {
    if (window.prompt(trD('dist.liUndoPrompt')) !== 'HAPUS') return;
    window.API.distribusi.customers.undoLegacyBatch(detail.id, batchId)
      .then(() => { flash(trD('dist.liUndone')); openDetail(detail.id); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')));
  };

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
          {/* Repair on blur so the field shows exactly what will be stored ("8123…" → "08123…"). */}
          <input className="fld" value={form.phone} placeholder="cth. 0812-3456-7890"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onBlur={() => setForm((f) => ({ ...f, phone: normalizePhone(f.phone) }))} />
          <label className="fld-label">{trD('dist.cfType')}</label>
          <div className="dist-typechips">
            {types.map((t) => <button type="button" key={t.id} className={`dist-typechip ${form.type === t.id ? 'on' : ''}`} onClick={() => setForm({ ...form, type: t.id })}>{t.label}</button>)}
            {canCustomers && <button type="button" className="dist-typechip add" onClick={() => setTypesOpen(true)}><IconPlus s={13} />{trD('dist.kelolaTipe')}</button>}
          </div>
          <label className="fld-label">{trD('dist.cfDays')}</label>
          <div className="dist-typechips">{DAY_CODES.map((dd) => <button type="button" key={dd} className={`dist-typechip ${form.deliveryDays.includes(dd) ? 'on' : ''}`} onClick={() => toggleDay(dd)}>{dd}</button>)}</div>
          <label className="fld-label">{trD('dist.cfArmada')}</label>
          <UI.Dropdown value={form.armada} options={fleetOptsFor(form.armada)} placeholder={trD('dist.noArmada')} onChange={(v) => setForm({ ...form, armada: v })} fluid />
          <label className="fld-label">{trD('dist.cfAddress')}</label>
          <input className="fld" value={form.address} maxLength={300} placeholder={trD('dist.cfAddressPh')} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <label className="fld-label">{trD('dist.cfMapsUrl')}</label>
          <div className="dist-mapsurl-row">
            {/* Manually editing the link clears any captured GPS coords so we never save stale lat/lng. */}
            <input className="fld" value={form.mapsUrl} maxLength={500} placeholder={trD('dist.cfMapsUrlPh')} onChange={(e) => setForm({ ...form, mapsUrl: e.target.value, _lat: undefined, _lng: undefined, _accuracy: undefined })} />
            <GpsButton label={trD('dist.getGps')} onFlash={setFormErr} onCapture={({ lat, lng, accuracy }) => { setForm((f) => ({ ...f, mapsUrl: mapsUrl(lat, lng), _lat: lat, _lng: lng, _accuracy: accuracy })); setFormErr(''); }} />
          </div>
          {form._accuracy != null && <div className="dist-hint" style={{ marginTop: 5 }}>{trD('dist.locAccNote', { x: Math.round(form._accuracy) })}</div>}
          {form.mapsUrl ? <a className="dist-link" href={form.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, marginTop: 5, display: 'inline-flex', gap: 4, alignItems: 'center' }}><IconPin s={12} />{trD('dist.openMaps')}</a> : <div className="dist-hint" style={{ marginTop: 5 }}>{trD('dist.cfMapsUrlHint')}</div>}
          {(() => {
            const r = form.reminder || {};
            const setR = (p) => setForm((f) => ({ ...f, reminder: { ...(f.reminder || {}), ...p } }));
            const numF = (e) => Math.max(0, parseInt((e.target.value || '').replace(/[^0-9]/g, ''), 10) || 0);
            return (
              <div className="dist-reminder">
                <label className="dist-reminder-toggle"><input type="checkbox" checked={!!r.enabled} onChange={(e) => setR({ enabled: e.target.checked })} /><span><b>{trD('dist.remTitle')}</b><em>{trD('dist.remSub')}</em></span></label>
                {r.enabled && (
                  <div className="dist-reminder-body">
                    <div className="dist-form-row">
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remBon')}</label><div className="amt-input" style={{ padding: '6px 11px' }}><span className="amt-rp" style={{ fontSize: 12 }}>Rp</span><input inputMode="numeric" value={r.bonThreshold ? (+r.bonThreshold).toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setR({ bonThreshold: numF(e) })} /></div></div>
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remGallon')}</label><input className="fld tnum" inputMode="numeric" value={r.gallonThreshold || ''} placeholder="0" onChange={(e) => setR({ gallonThreshold: numF(e) })} /></div>
                    </div>
                    <div className="dist-form-row">
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remOverdue')}</label><input className="fld tnum" inputMode="numeric" value={r.overdueDays || ''} placeholder="0" onChange={(e) => setR({ overdueDays: numF(e) })} /></div>
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remDueDay')}</label><input className="fld tnum" inputMode="numeric" value={r.dueDay || ''} placeholder="0" onChange={(e) => setR({ dueDay: Math.min(31, numF(e)) })} /></div>
                    </div>
                    <label className="fld-label">{trD('dist.remWeekly')}</label>
                    <div className="dist-typechips">
                      <button type="button" className={`dist-typechip ${!r.weekday ? 'on' : ''}`} onClick={() => setR({ weekday: '' })}>{trD('dist.remOff')}</button>
                      {DAY_CODES.map((dd) => <button type="button" key={dd} className={`dist-typechip ${r.weekday === dd ? 'on' : ''}`} onClick={() => setR({ weekday: dd })}>{dd}</button>)}
                    </div>
                    <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.remHint')}</div>
                  </div>
                )}
              </div>
            );
          })()}
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
              <div className="dist-cd-namerow">{d.code && <span className="dist-code lg">{d.code}</span>}<h2 className="dist-cd-name">{d.name}</h2>{tag(d.type)}{d.active === false && <span className="dist-inactive-badge"><IconClose s={10} />{trD('dist.inactive')}</span>}</div>
              {d.complete === false && (
                <div className="dist-incomplete" style={{ marginTop: 6 }} onClick={() => canCustomers && openEdit(d)}>
                  <span className="dist-incomplete-badge"><IconWarn s={11} />{trD('dist.incomplete')}</span>
                  {missChips(d.missing)}
                </div>
              )}
              <div className="dist-cd-phone">{d.phone || '—'}</div>
              <div className="dist-cd-meta">
                <span><IconCalendar s={13} />{trD('dist.kirimHari')}: <b>{days || '—'}</b></span>
                <span className={d.armada && !isActiveArmada(d.armada) ? 'inactive' : ''}><IconTruck s={13} />{trD('dist.armada')}: <b>{d.armada ? armadaFull(d.armada) : '—'}</b></span>
                <span className={d.locationAccuracy != null && d.locationAccuracy > ACC_LIMIT ? 'inactive' : ''}><IconPin s={13} />{trD('dist.location')}: {d.mapsLink
                  ? <a href={d.mapsLink} target="_blank" rel="noopener noreferrer" className="dist-link">{trD('dist.directions')}</a>
                  : <b className="dist-noloc">{trD('dist.locNotSet')}</b>}
                  {d.hasLocation && d.locationAccuracy != null && <b className={d.locationAccuracy > ACC_LIMIT ? 'dist-acc-bad' : 'dist-acc-ok'}> · ±{Math.round(d.locationAccuracy)} m{d.locationAccuracy > ACC_LIMIT ? ' ' + trD('dist.locAccPoor') : ''}</b>}
                  {d.hasLocation && d.locationSetByName && <span className="dist-loc-by"> · {trD('dist.locSetBy', { d: fmtDT(d.locationSetAt), who: d.locationSetByName })}</span>}</span>
              </div>
              {d.address ? <div className="dist-cd-addr"><IconHome s={12} />{d.address}</div> : null}
              <div className="dist-cd-photo">
                <div className="dist-cd-photo-lbl"><IconPin s={12} />{trD('dist.locPhoto')}</div>
                <LocPhoto custId={d.id} photoId={d.locationPhotoId} byName={d.locationPhotoByName} at={d.locationPhotoAt} canEdit={canInput || canCustomers} onChanged={() => { openDetail(d.id); reload(); }} />
              </div>
            </div>
            <div className="dist-cd-stats">
              <div><div className="dist-cd-slbl">{trD('dist.sisaBon')}</div><div className="dist-cd-sval" style={{ color: d.sisaBon > 0 ? 'var(--warn)' : 'var(--green-700)' }}>{d.sisaBon > 0 ? rpFull(d.sisaBon) : trD('dist.lunas')}</div></div>
              <div><div className="dist-cd-slbl">{trD('dist.totalGalon')}</div><div className="dist-cd-sval">{numX(d.totalGalon)}</div></div>
              <div><div className="dist-cd-slbl">{trD('dist.gallonsHeld')}</div><div className="dist-cd-sval" style={{ color: (d.gallonsHeld || 0) > 0 ? 'var(--warn)' : 'var(--text-mut)' }}>{numX(d.gallonsHeld || 0)}</div></div>
            </div>
            <div className="dist-cd-actions">
              {(canInput || canCustomers) && <button type="button" className="btn btn-primary btn-sm" onClick={() => setInvBuilder(true)}><IconInvoice s={14} />{trD('dist.makeInvoice')}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistOpen(true)}><IconDownload s={14} />{trD('dist.printHistory')}</button>
              {canLegacyImport && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegacyOpen(true)}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('dist.liBtn')}</button>}
              {(canInput || canCustomers) && <GpsButton custId={d.id} hasLoc={d.hasLocation} onSaved={() => { flash(trD('dist.locSaved')); openDetail(d.id); reload(); }} onFlash={flash} />}
              {canInput && d.sisaBon > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPayFor(d)}><IconCoinIn s={14} />{trD('dist.payBon')}</button>}
              {/* Carry-over receivable from the old books. Correction-tier cap: this creates a
                  real bon out of nothing, so a plain input helper must not be able to. */}
              {canKoreksi && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setObFor(d)}><IconInvoice s={14} />{trD('dist.obBtn')}</button>}
              {canCustomers && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(d)}><IconPencil s={14} />{trD('dist.editCust')}</button>}
              {canDelete && d.active === false && <button type="button" className="btn btn-ghost btn-sm dist-reactivate" onClick={() => doReactivate(d)}><IconRefresh s={14} />{trD('dist.reactivate')}</button>}
              {canDelete && <button type="button" className="btn btn-ghost btn-sm dist-del-btn" onClick={() => setDelFor(d)}><IconTrash s={14} />{trD('dist.delCust')}</button>}
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
                <div key={t.id} className={`dist-txn ${t.legacy ? 'is-legacy' : ''}`}>
                  <span className="dist-cd-bar" style={{ background: t.legacy ? '#94a3b8' : t.method === 'bon' ? '#e0a13c' : t.method === 'pelunasan' ? '#2f6fb0' : '#17b083' }} />
                  <div className="dist-txn-mid">
                    <div className="dist-txn-line1"><span className="dist-txn-name">{shortRef(t.id)}</span><span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>{t.legacy && <span className="dist-badge arsip"><IconInvoice s={10} />{trD('dist.arsip')}</span>}{t.openingBon && <span className="dist-badge obon"><IconInvoice s={10} />{trD('dist.obLabel')}</span>}{t.corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}{t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}</div>
                    <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)} · {t.txnDate} {hhmm(t.createdAt)}{t.actorName ? ' · ' + t.actorName : ''}{t.adjusted ? ' · ' + (t.adjustAmount >= 0 ? '+' : '') + rpFull(t.adjustAmount) : ''}{t.note ? ' · ' + t.note : ''}</div>
                  </div>
                  <div className="tnum dist-txn-amt">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</div>
                </div>
              ))}
            </div>
          </div>
          {(d.imports || []).length > 0 && (
            <div className="card dist-card dist-imp-hist" style={{ marginTop: 16 }}>
              <div className="sec-title" style={{ marginBottom: 8 }}><IconInvoice s={14} /> {trD('dist.liHistTitle')}</div>
              {(d.imports || []).map((b) => (
                <div key={b.batchId} className="dist-imp-hist-row">
                  <div className="dist-imp-hist-main">{trD('dist.liHistLine', { d: fmtDT(b.at), n: b.count, who: b.byName || '—' })}</div>
                  {isGmOwner && <button type="button" className="dist-link danger" onClick={() => undoLegacyBatch(b.batchId)}>{trD('dist.liUndo')}</button>}
                </div>
              ))}
            </div>
          )}
          <div className="card dist-card" style={{ marginTop: 16 }}>
            <div className="dist-card-head"><div className="sec-title">{trD('dist.invHistory')}</div>{(canInput || canCustomers) && <button type="button" className="dist-link" onClick={() => setInvBuilder(true)}>{trD('dist.makeInvoice')}</button>}</div>
            {invoices.length === 0 && <div className="dist-empty">{trD('dist.noInvoice')}</div>}
            {invoices.map((iv) => (
              <div key={iv.id} className="dist-txn dist-inv-row" onClick={() => setInvView(iv)}>
                <span className="dist-cd-bar" style={{ background: '#5b7cff' }} />
                <div className="dist-txn-mid">
                  <div className="dist-txn-line1"><span className="dist-txn-name">{iv.number}</span></div>
                  <div className="dist-txn-sub">{iv.issueDate} · {iv.items.length} item{iv.dueDate ? ' · ' + trD('dist.dueDate') + ' ' + iv.dueDate : ''}{iv.createdByName ? ' · ' + iv.createdByName : ''}</div>
                </div>
                <div className="tnum dist-txn-amt">{rpFull(iv.total)}</div>
              </div>
            ))}
          </div>
        </>)}
        {invBuilder && d && <InvoiceBuilder customer={d} onClose={() => setInvBuilder(false)} onCreated={(iv) => { setInvBuilder(false); setInvView(iv); loadInvoices(d.id); if (onChanged) onChanged(); }} />}
        {invView && <InvoiceViewer invoice={invView} onClose={() => setInvView(null)} />}
        {histOpen && d && <TxnHistoryDoc customer={d} userName={userName} onClose={() => setHistOpen(false)} />}
        {legacyOpen && d && <LegacyImportModal customer={d} onClose={() => setLegacyOpen(false)} onDone={(res) => { setLegacyOpen(false); flash(trD('dist.liDone', { n: res.imported, m: res.skipped })); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {payFor && <PaymentModal customers={[payFor]} presetCustomer={payFor.id} staffMode={staffMode} today={new Date().toISOString().slice(0, 10)} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); flash(trD('dist.corrSaved')); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {obFor && <OpeningBonModal customer={obFor} onClose={() => setObFor(null)} onSaved={(res) => { setObFor(null); flash(trD('dist.obSaved', { amt: rpFull(res.amount) })); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {renderForm()}
        {typesModal()}
        {delFor && <DeleteCustomerModal customer={delFor} busy={delBusy} onDeactivate={doDeactivate} onDelete={doDeletePermanent} onClose={() => setDelFor(null)} />}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  // ── LIST ──
  // Search + the detailed criteria are applied SERVER-side (so they cover the whole dataset,
  // not just the loaded page); only the quick chips still narrow the returned rows.
  const rows = (custs || []).filter((c) => (
    filter === 'all' ? true : filter === 'bon' ? c.sisaBon > 0 : filter === 'bulk' ? c.type === 'bulk' : filter === 'reguler' ? c.type === 'reguler' : filter === 'belum' ? c.complete === false : true
  ));
  const incompleteN = (custs || []).filter((c) => c.complete === false).length;
  const chips = [['all', trD('dist.fAll')], ['bon', trD('dist.filterBon')], ['reguler', trD('dist.filterReg')], ['bulk', trD('dist.filterBulk')], ['belum', trD('dist.filterIncomplete') + (incompleteN ? ' (' + incompleteN + ')' : '')]];
  return (
    <div className="dist-dash screen-enter">
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-tx-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.searchCust')} onChange={(e) => setQ(e.target.value)} /></div>
        <button type="button" className={`btn btn-ghost dist-filter-btn ${!filterIsEmpty(flt) ? 'on' : ''}`} onClick={() => setFltOpen(true)}>
          <IconFilter s={15} />{trD('dist.filter')}{filterCount(flt) ? <span className="dist-filter-n">{filterCount(flt)}</span> : null}
        </button>
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {canDelete && (
          <div className="dist-chips dist-status-chips">
            <button type="button" className={`dist-chip ${statusFilter === 'active' ? 'on' : ''}`} onClick={() => setStatusFilter('active')}>{trD('dist.stActive')}</button>
            <button type="button" className={`dist-chip ${statusFilter === 'inactive' ? 'on' : ''}`} onClick={() => setStatusFilter('inactive')}>{trD('dist.stInactive')}</button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {canCustomers ? (
          <div className="dist-cust-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setTypesOpen(true)}><IconSettings s={15} />{trD('dist.kelolaTipe')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setImpOpen(true)}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.import')}</button>
            <button type="button" className="btn btn-primary" onClick={openAdd}><IconPlus s={16} />{trD('dist.addCust')}</button>
          </div>
        ) : <div className="dist-lockbtn"><IconLock s={14} />{trD('dist.addOwner')}</div>}
      </div>

      {/* Active criteria as removable chips + the result count, so what's being applied is
          always visible (a filter you can't see is a filter you forget you set). */}
      {(!filterIsEmpty(flt) || custs !== null) && (
        <div className="dist-filter-bar">
          {activeFilterChips(flt, setFlt, typeMap).map((ch) => (
            <button key={ch.key} type="button" className="dist-fchip" onClick={ch.clear} title={trD('dist.fRemove')}>
              {ch.label}<IconClose s={12} />
            </button>
          ))}
          {!filterIsEmpty(flt) && <button type="button" className="dist-link" onClick={() => setFlt(EMPTY_FILTER)}>{trD('dist.fReset')}</button>}
          <div style={{ flex: 1 }} />
          {custs !== null && (
            <span className="dist-filter-count">
              {fTotal != null ? trD('dist.fShowing', { n: rows.length, total: fTotal }) : trD('dist.fShowingN', { n: rows.length })}
            </span>
          )}
        </div>
      )}

      {fltOpen && (
        <CustomerFilterPanel
          value={flt} types={types} onApply={(v) => { setFlt(v); setFltOpen(false); }} onClose={() => setFltOpen(false)}
        />
      )}

      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {loadErr && custs === null && (
          <div className="dist-empty dist-load-err">
            <span>{loadErr}</span>
            <button type="button" className="btn btn-ghost dist-retry" onClick={retry}><IconRefresh s={15} />{trD('common.retry')}</button>
          </div>
        )}
        {!loadErr && custs === null && <div className="dist-empty dist-loading"><span className="dist-spin" />{trD('common.loading')}</div>}
        {custs !== null && rows.length === 0 && <div className="dist-empty">{loadErr ? loadErr : trD('dist.noCust')}</div>}
        {rows.map((c) => {
          const days = fmtDays(c.deliveryDays);
          return (
            <div key={c.id} className={`dist-cust-row ${c.active === false ? 'is-inactive' : ''}`} onClick={() => openDetail(c.id)}>
              <span className="dist-txn-av">{initialsOf(c.name)}</span>
              <div className="dist-cust-main">
                <div className="dist-txn-line1">{c.code && <span className="dist-code">{c.code}</span>}<span className="dist-txn-name">{c.name}</span>{tag(c.type)}{c.active === false && <span className="dist-inactive-badge"><IconClose s={10} />{trD('dist.inactive')}</span>}</div>
                <div className="dist-txn-sub">{c.phone || '—'} · {numX(c.totalGalon)} {trD('dist.galonUnit')}{c.lastDate ? ' · ' + c.lastDate : ''}</div>
                {c.active !== false && c.complete === false && (
                  <div className="dist-incomplete" onClick={(e) => { e.stopPropagation(); canCustomers ? openEdit(c) : openDetail(c.id); }}>
                    <span className="dist-incomplete-badge"><IconWarn s={11} />{trD('dist.incomplete')}</span>
                    {missChips(c.missing)}
                  </div>
                )}
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
              <div className="dist-cust-bon">{c.sisaBon > 0 ? <span className="dist-bonpill">{rpFull(c.sisaBon)}</span> : <span className="dist-bonmuted">{trD('dist.lunas')}</span>}</div>
              {canDelete && c.active === false && <button type="button" className="btn btn-ghost btn-sm dist-reactivate" onClick={(e) => { e.stopPropagation(); doReactivate(c); }}><IconRefresh s={14} />{trD('dist.reactivate')}</button>}
              <IconCaret s={16} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)', flexShrink: 0 }} />
            </div>
          );
        })}
      </div>

      {renderForm()}
      {typesModal()}
      {delFor && <DeleteCustomerModal customer={delFor} busy={delBusy} onDeactivate={doDeactivate} onDelete={doDeletePermanent} onClose={() => setDelFor(null)} />}

      {impOpen && (
        <div className="modal-scrim" onClick={() => setImpOpen(false)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.importT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.importSub')}</div></div><button className="jp-icon" onClick={() => setImpOpen(false)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-imp-fmt"><span>{trD('dist.importFmt')}: <b>Nama · No HP · Tipe · Harga</b></span><button type="button" className="dist-link" onClick={downloadImportTemplate}><IconDownload s={13} />{trD('dist.importTemplate')}</button></div>
              {/* Excel drops the leading 0 from phone columns — we repair it, so nobody has to reformat. */}
              <div className="dist-infobox" style={{ marginBottom: 10 }}><IconCheck s={16} /><span>{trD('dist.impPhoneNote')}</span></div>
              <div className="dist-imp-upload">
                <input ref={impFileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} onChange={onImpFile} />
                <button type="button" className="btn btn-ghost" onClick={() => impFileRef.current && impFileRef.current.click()}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.importPick')}</button>
                {impFileBusy ? <span className="dist-imp-fname"><span className="ui-attach-spin" />{trD('dist.importReading')}</span>
                  : impFileRows ? <span className="dist-imp-fname"><IconCheck s={13} />{impFileName}<button type="button" className="dist-link" onClick={resetImport} style={{ marginLeft: 8 }}>{trD('dist.importClear')}</button></span>
                  : <span className="dist-imp-or">{trD('dist.importOr')} <button type="button" className="dist-link" onClick={() => setImpText(impSample)}>{trD('dist.importSample')}</button></span>}
              </div>
              {impFileErr && <div className="add-err" style={{ margin: '4px 0 8px' }}><IconClose s={14} />{impFileErr}</div>}
              {!impFileRows && !impFileBusy && <textarea className="fld dist-imp-ta" value={impText} placeholder={'Warung Sejahtera\t0821-1122-3344\tReguler\t12500'} onChange={(e) => setImpText(e.target.value)} />}
              {impRows.length > 0 && (<>
                <div className="dist-imp-counts"><span className="dist-imp-ok">{impValid.length} {trD('dist.importReady')}</span><span className="dist-imp-skip">{impRows.length - impValid.length} {trD('dist.importSkip')}</span></div>
                <div className="dist-imp-preview">
                  <div className="dist-imp-hrow"><span>Nama</span><span>No HP</span><span>Tipe</span><span>Harga</span><span>Status</span></div>
                  {impRows.map((r, i) => (
                    <div key={i} className="dist-imp-row">
                      <span className="dist-imp-name">{r.name}</span>
                      <span>{r.phone}{r.phoneFixed && <span className="dist-phone-fixed" title={trD('dist.impPhoneFixedT')}>{trD('dist.impPhoneFixed')}</span>}</span>
                      <span>{typeLabel(r.type)}</span><span>{r.price ? rpFull(r.price) : '—'}</span>
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
    // One gated read (distribusiCashIntegrasi) returns everything the view composes:
    // transactions in range + customers (outstanding bon) + adjustment audit.
    window.API.distribusi.cashIntegration('dateFrom=' + range.from + '&dateTo=' + range.to)
      .then((r) => { if (!live) return; const d = (r && r.data) || {}; setTxns(d.transactions || []); setAudit(d.audit || []); setCusts(d.customers || []); })
      .catch(() => { if (live) { setTxns([]); setAudit([]); setCusts([]); } });
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
  opening: { l: 'dist.gmOpening', cls: 'opening', sign: '' },
  damage: { l: 'dist.gmDamage', cls: 'dmg', sign: '−' },
  loss: { l: 'dist.gmLoss', cls: 'dmg', sign: '−' },
};
function DistGallon({ refreshKey, canCustomers, canReset, fleetScope, fleet, distFleet, setDistFleet }) {
  const [data, setData] = uSx(null);
  const [toast, setToast] = uSx('');
  const [corr, setCorr] = uSx(null);   // { customerId, name, qty, reason }
  const [opening, setOpening] = uSx(null);   // opening-stock modal: { qty, reason }
  const [reset, setReset] = uSx(null);   // reset-gallon modal: { mode, fleet, target, reason, confirm }
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => window.API.distribusi.gallon(ef).then((r) => setData(r.data)).catch(() => setData({ stock: {}, opening: {}, balances: [], movements: [] }));
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
  const op = (data && data.opening) || {};
  const openOpening = () => { setErr(''); setOpening({ qty: op.set ? String(op.total) : '', reason: '' }); };
  const commitOpening = () => {
    if (!opening || saving) return;
    const qty = parseInt(String(opening.qty).replace(/[^0-9]/g, ''), 10);
    if (!(qty >= 0) || !opening.reason.trim()) { setErr(trD('dist.goErr')); return; }
    setSaving(true); setErr('');
    window.API.distribusi.setOpeningStock({ qty, fleet: ef, reason: opening.reason.trim() })
      .then(() => { setSaving(false); setOpening(null); flash(trD('dist.goSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const openReset = () => { setErr(''); setReset({ mode: 'balanced', fleet: (distFleet && distFleet !== 'all') ? distFleet : 'all', target: '0', reason: '', confirm: '' }); };
  const commitReset = () => {
    if (!reset || saving) return;
    if (!reset.reason.trim()) { setErr(trD('dist.grErrReason')); return; }
    if (reset.mode === 'purge' && reset.confirm !== 'RESET') { setErr(trD('dist.grErrConfirm')); return; }
    setSaving(true); setErr('');
    const body = { mode: reset.mode, fleet: reset.fleet || 'all', reason: reset.reason.trim() };
    if (reset.mode === 'balanced') body.target = Math.max(0, parseInt(reset.target || '0', 10) || 0);
    else body.confirm = reset.confirm;
    window.API.distribusi.resetGallon(body)
      .then(() => { setSaving(false); setReset(null); flash(trD('dist.grSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const bar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  if (!data) return <div className="dist-dash screen-enter">{bar}<div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div></div>;
  const st = data.stock || {};
  return (
    <div className="dist-dash screen-enter">
      {bar}
      {canReset && (
        <div className="dist-gm-resetbar">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-danger btn-sm" onClick={openReset}><IconRefresh s={14} />{trD('dist.grBtn')}</button>
        </div>
      )}
      <div className="dist-gm-cards">
        <div className="card stat-box"><span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconDrop', { s: 18 })}</span><div className="tnum dist-gm-val">{numX(st.totalOwned || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmTotal')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>{IcX('IconCustomers', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--warn)' }}>{numX(st.atCustomers || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtCust')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--pos-bg)', color: 'var(--green-800)' }}>{IcX('IconTruck', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--green-700)' }}>{numX(st.atDepot || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtDepot')}</div></div>
      </div>
      <div className="dist-gm-note"><IconInvoice s={13} /><span>{trD('dist.gmTotalNote')}</span></div>
      <div className="card dist-gm-opening">
        <span className="icon-tile" style={{ background: '#EEF2FF', color: '#5b6ed6' }}>{IcX('IconWallet', { s: 17 })}</span>
        <div className="dist-gm-opening-main">
          <div className="dist-gm-opening-lbl">{trD('dist.gmOpeningTitle')}</div>
          {op.set
            ? <div className="dist-gm-opening-sub">{trD('dist.gmOpeningSet', { d: fmtDT(op.setAt), who: op.setByName || '—' })}{op.adjustCount > 0 ? ' · ' + trD('dist.gmOpeningAdj', { n: op.adjustCount, d: fmtDT(op.lastAt) }) : ''}</div>
            : <div className="dist-gm-opening-sub">{trD('dist.gmOpeningNone')}</div>}
        </div>
        <div className="tnum dist-gm-opening-val">{numX(op.total || 0)}</div>
        {canCustomers && <button type="button" className="btn btn-ghost btn-sm" onClick={openOpening}><IconPencil s={14} />{op.set ? trD('dist.gmOpeningAdjust') : trD('dist.gmOpeningBtn')}</button>}
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
              <div className="dist-txn-mid"><div className="dist-txn-name">{m.type === 'opening' ? trD('dist.gmOpening') : (m.customerName || trD('dist.gmDepot'))}</div><div className="dist-txn-sub">{fmtDT(m.createdAt)}{m.actorName ? ' · ' + m.actorName : ''}{m.note && (m.type === 'correction' || m.type === 'opening') ? ' · ' + m.note : ''}</div></div>
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

      {opening && (
        <div className="modal-scrim" onClick={() => setOpening(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{op.set ? trD('dist.gmOpeningAdjust') : trD('dist.gmOpeningBtn')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.gmOpeningModalSub')}</div></div><button className="jp-icon" onClick={() => setOpening(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{op.set ? trD('dist.gmOpeningInfoAdj', { cur: numX(op.total) }) : trD('dist.gmOpeningInfoNew')}</span></div>
              <label className="fld-label">{trD('dist.gmOpeningQty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld tnum" value={opening.qty} inputMode="numeric" placeholder="cth. 500" onChange={(e) => setOpening({ ...opening, qty: e.target.value.replace(/[^0-9]/g, '') })} />
              {op.set && opening.qty !== '' && parseInt(opening.qty, 10) !== op.total && (
                <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.gmOpeningDelta', { d: (parseInt(opening.qty, 10) - op.total >= 0 ? '+' : '') + numX(parseInt(opening.qty, 10) - op.total) })}</div>
              )}
              <label className="fld-label">{trD('dist.gmOpeningReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 66, padding: 12, resize: 'vertical' }} value={opening.reason} placeholder={trD('dist.gmOpeningReasonPh')} onChange={(e) => setOpening({ ...opening, reason: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setOpening(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commitOpening}>{saving ? '…' : trD('dist.gmOpeningSave')}</button></div>
          </div>
        </div>
      )}

      {reset && (() => { const tgt = reset.mode === 'balanced' ? (Math.max(0, parseInt(reset.target || '0', 10) || 0)) : 0; const fleetOpts = (fleet || []).filter(Boolean); return (
        <div className="modal-scrim" onClick={() => setReset(null)} style={{ zIndex: 210 }}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.grTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.grSub')}</div></div><button className="jp-icon" onClick={() => setReset(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {/* mode choice */}
              <label className={`dist-gr-mode ${reset.mode === 'balanced' ? 'on' : ''}`} onClick={() => setReset({ ...reset, mode: 'balanced' })}>
                <input type="radio" checked={reset.mode === 'balanced'} readOnly />
                <div><b>{trD('dist.grModeA')}</b><span>{trD('dist.grModeADesc')}</span></div>
              </label>
              <label className={`dist-gr-mode danger ${reset.mode === 'purge' ? 'on' : ''}`} onClick={() => setReset({ ...reset, mode: 'purge' })}>
                <input type="radio" checked={reset.mode === 'purge'} readOnly />
                <div><b>{trD('dist.grModeB')}</b><span>{trD('dist.grModeBDesc')}</span></div>
              </label>

              <div className="gud-row2" style={{ marginTop: 6 }}>
                <div>
                  <label className="fld-label">{trD('dist.grScope')}</label>
                  <select className="fld" value={reset.fleet} onChange={(e) => setReset({ ...reset, fleet: e.target.value })}>
                    <option value="all">{trD('dist.grAllFleets')}</option>{fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {reset.mode === 'balanced' && (
                  <div><label className="fld-label">{trD('dist.grTarget')}</label><input className="fld tnum" value={reset.target} inputMode="numeric" placeholder="0" onChange={(e) => setReset({ ...reset, target: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                )}
              </div>

              <div className="dist-gr-preview">
                <span>{trD('dist.gmTotal')}: <b>{numX(st.totalOwned || 0)}</b> → <b className="to">{numX(tgt)}</b></span>
                <span>{trD('dist.gmAtCust')}: <b>{numX(st.atCustomers || 0)}</b> → <b className="to">0</b></span>
                <span>{trD('dist.gmAtDepot')}: <b>{numX(st.atDepot || 0)}</b> → <b className="to">{numX(tgt)}</b></span>
              </div>

              <label className="fld-label">{trD('dist.grReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={reset.reason} placeholder={trD('dist.grReasonPh')} onChange={(e) => setReset({ ...reset, reason: e.target.value })} />

              {reset.mode === 'purge' && (<>
                <div className="dist-gr-warn"><IconWarn s={16} /><span>{trD('dist.grPurgeWarn')}</span></div>
                <label className="fld-label">{trD('dist.grConfirmLbl')}</label>
                <input className="fld" value={reset.confirm} placeholder="RESET" onChange={(e) => setReset({ ...reset, confirm: e.target.value })} />
              </>)}
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setReset(null)}>{trD('dist.cancel')}</button><button className={`btn ${reset.mode === 'purge' ? 'btn-danger' : 'btn-primary'}`} disabled={saving} onClick={commitReset}>{saving ? '…' : (reset.mode === 'purge' ? trD('dist.grDoPurge') : trD('dist.grDo'))}</button></div>
          </div>
        </div>
      ); })()}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ PENGIRIMAN (delivery board) ════════════════
// One board per (armada, tanggal): scheduled stops (from deliveryDays) + extra orders.
function DeliveryOrderModal({ date, customers, onClose, onSaved }) {
  const [cust, setCust] = uSx('');
  const [qty, setQty] = uSx('');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const opts = (customers || []).filter((c) => (c.armada || '').trim()).map((c) => ({ value: c.id, label: c.name + ' · ' + c.armada }));
  const save = () => {
    if (!cust) { setErr(trD('dist.orderCustReq')); return; }
    if (saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.deliveries.addOrder({ customerId: cust, date, qty: qty ? +String(qty).replace(/[^0-9]/g, '') : undefined, note: note.trim() })
      .then(() => onSaved())
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.addOrder')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.orderCust')}</label>
          <UI.Dropdown value={cust} options={opts} placeholder={trD('dist.orderCustPh')} onChange={setCust} fluid />
          <label className="fld-label">{trD('dist.orderQty')}</label>
          <input className="fld tnum" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="—" />
          <label className="fld-label">{trD('dist.orderNote')}</label>
          <input className="fld" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.orderNotePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : trD('dist.orderSave')}</button></div>
      </div>
    </div>
  );
}
// Make a transaction directly from a stop; on success the caller marks the stop terkirim + links it.
function DeliveryTxnModal({ stop, today, onClose, onCreated }) {
  const [qty, setQty] = uSx(stop.qty || 1);
  const [method, setMethod] = uSx('lunas');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const q = Math.max(1, qty | 0);
  const total = (stop.masterPrice || 0) * q;
  const save = () => {
    if (saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.transactions.create({ customerId: stop.customerId, qty: q, method, note: note.trim(), txnDate: today, gallonOut: q, gallonIn: 0 })
      .then((r) => onCreated(r.data))
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.delivMakeTxn')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{stop.customerName}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fQty')}</label>
          <div className="dist-stepper"><button type="button" onClick={() => setQty((n) => Math.max(1, (n | 0) - 1))}>−</button><input className="tnum" inputMode="numeric" value={qty} onChange={(e) => setQty(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0)} onFocus={(e) => e.target.select()} /><button type="button" onClick={() => setQty((n) => (n | 0) + 1)}>+</button></div>
          <label className="fld-label">{trD('dist.fMethod')}</label>
          <div className="cat-chips">{['lunas', 'bon'].map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{methodLabel(m)}</button>)}</div>
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="dist-lockrow" style={{ marginTop: 12 }}><span className="dist-lockrow-l"><IconLock s={14} />{numX(q)} × {rpFull(stop.masterPrice || 0)}</span><span className="dist-lockrow-r">{rpFull(total)}</span></div>
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : trD('dist.fSave')}</button></div>
      </div>
    </div>
  );
}
// Delivery runs (rit) panel — MUAT (load out) / TUTUP (return + reconcile) + a per-day report
// with the difference highlighted. Gallon STOCK is unchanged by this (it's driven by the
// per-customer movements); a run is a truck-level control that surfaces shortfalls.
function RunPanel({ date, ef, fleetScope, fleet, distFleet, refreshKey, onChanged }) {
  const [runs, setRuns] = uSx(null);      // runs for the selected date (report)
  const [openRuns, setOpenRuns] = uSx([]); // currently-open runs (any date)
  const [modal, setModal] = uSx(null);    // { kind:'open'|'close', run?, ...fields }
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const [toast, setToast] = uSx('');
  const reload = () => {
    if (!(window.API && window.API.distribusi && window.API.distribusi.runs)) return;
    window.API.distribusi.runs.list(date, ef).then((r) => setRuns(r.data || [])).catch(() => setRuns([]));
    window.API.distribusi.runs.list(null, ef, 'open').then((r) => setOpenRuns(r.data || [])).catch(() => setOpenRuns([]));
  };
  uEx(() => { reload(); }, [refreshKey, ef, date]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const scoped = isScoped(fleetScope);
  const fleetOpts = (fleet || []).filter(Boolean);
  const openModal = () => { setErr(''); setModal({ kind: 'open', gallonsOut: '', note: '', fleet: (distFleet && distFleet !== 'all') ? distFleet : (scoped ? '' : (fleetOpts[0] || '')) }); };
  const closeModal = (run) => { setErr(''); setModal({ kind: 'close', run, full: '', empty: '', diffReason: '' }); };
  const commit = () => {
    if (!modal || saving) return;
    setSaving(true); setErr('');
    const done = (m) => { setSaving(false); setModal(null); flash(m); reload(); if (onChanged) onChanged(); };
    const fail = (e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); };
    if (modal.kind === 'open') {
      const g = parseInt(String(modal.gallonsOut).replace(/[^0-9]/g, ''), 10);
      if (!(g > 0)) { setSaving(false); setErr(trD('run.errOut')); return; }
      if (!scoped && !modal.fleet) { setSaving(false); setErr(trD('run.errFleet')); return; }
      window.API.distribusi.runs.open({ date, fleet: modal.fleet || undefined, gallonsOut: g, note: (modal.note || '').trim() || undefined }).then(() => done(trD('run.opened'))).catch(fail);
      return;
    }
    const full = parseInt(String(modal.full).replace(/[^0-9]/g, ''), 10) || 0;
    const empty = parseInt(String(modal.empty).replace(/[^0-9]/g, ''), 10) || 0;
    const expected = modal.run.expectedRemaining;
    const diff = full - expected;
    if (diff !== 0 && !(modal.diffReason || '').trim()) { setSaving(false); setErr(trD('run.errDiffReason', { d: (diff > 0 ? '+' : '') + numX(diff) })); return; }
    window.API.distribusi.runs.close(modal.run.id, { gallonsFullReturned: full, gallonsEmptyReturned: empty, diffReason: (modal.diffReason || '').trim() || undefined }).then(() => done(trD('run.closed'))).catch(fail);
  };
  const dayRuns = (runs || []);
  const totals = dayRuns.reduce((a, r) => ({ out: a.out + r.gallonsOut, sold: a.sold + r.sold, full: a.full + (r.gallonsFullReturned || 0), empty: a.empty + (r.gallonsEmptyReturned || 0) }), { out: 0, sold: 0, full: 0, empty: 0 });
  return (
    <div className="card dist-card gud-runpanel">
      <div className="dist-card-head">
        <div className="sec-title"><IconTruck s={15} /> {trD('run.title')}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openModal}><IconPlus s={14} />{trD('run.muat')}</button>
      </div>

      {openRuns.length > 0 && openRuns.map((r) => (
        <div key={r.id} className="run-open-row">
          <span className="run-open-badge"><span className="run-dot" />{trD('run.open')}</span>
          <div className="run-open-main"><b>{trD('run.ritN', { n: r.runNo })} · {r.fleetId}</b><span>{trD('run.loadedSold', { out: numX(r.gallonsOut), sold: numX(r.sold), exp: numX(r.expectedRemaining) })}</span></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeModal(r)}><IconCheck s={14} />{trD('run.tutup')}</button>
        </div>
      ))}

      <div className="run-table-wrap">
        <table className="run-table">
          <thead><tr><th>{trD('run.rit')}</th><th>{trD('run.armada')}</th><th className="num">{trD('run.keluar')}</th><th className="num">{trD('run.terjual')}</th><th className="num">{trD('run.sisa')}</th><th className="num">{trD('run.dikembalikan')}</th><th className="num">{trD('run.selisih')}</th><th className="num">{trD('run.kosong')}</th><th>{trD('run.status')}</th></tr></thead>
          <tbody>
            {dayRuns.length === 0 && <tr><td colSpan={9} className="run-empty">{runs === null ? (trD('common.loading') || '…') : trD('run.none')}</td></tr>}
            {dayRuns.map((r) => (
              <tr key={r.id} className={r.status === 'closed' && r.diff !== 0 ? 'run-diff' : ''}>
                <td>{trD('run.ritN', { n: r.runNo })}</td>
                <td>{r.fleetId}</td>
                <td className="num">{numX(r.gallonsOut)}</td>
                <td className="num">{numX(r.sold)}</td>
                <td className="num">{numX(r.expectedRemaining)}</td>
                <td className="num">{r.status === 'closed' ? numX(r.gallonsFullReturned) : '—'}</td>
                <td className="num">{r.status === 'closed' ? (r.diff === 0 ? <span className="run-ok">0</span> : <span className="run-bad" title={r.diffReason}>{(r.diff > 0 ? '+' : '') + numX(r.diff)}</span>) : '—'}</td>
                <td className="num">{r.status === 'closed' ? numX(r.gallonsEmptyReturned) : '—'}</td>
                <td>{r.status === 'closed' ? <span className="run-st closed">{trD('run.closed_')}</span> : <span className="run-st open">{trD('run.open')}</span>}</td>
              </tr>
            ))}
            {dayRuns.length > 0 && (
              <tr className="run-total"><td colSpan={2}>{trD('run.total')}</td><td className="num">{numX(totals.out)}</td><td className="num">{numX(totals.sold)}</td><td className="num">—</td><td className="num">{numX(totals.full)}</td><td className="num">—</td><td className="num">{numX(totals.empty)}</td><td /></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-scrim" onClick={() => setModal(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{modal.kind === 'open' ? trD('run.muatT') : trD('run.tutupT')}</div>{modal.run && <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('run.ritN', { n: modal.run.runNo })} · {modal.run.fleetId}</div>}</div><button className="jp-icon" onClick={() => setModal(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {modal.kind === 'open' ? (<>
                <div className="dist-infobox"><IconTruck s={16} /><span>{trD('run.muatInfo')}</span></div>
                {!scoped && (<>
                  <label className="fld-label">{trD('run.armada')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                  <select className="fld" value={modal.fleet} onChange={(e) => setModal({ ...modal, fleet: e.target.value })}><option value="">{trD('run.pickFleet')}</option>{fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                </>)}
                <label className="fld-label">{trD('run.gallonsOut')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.gallonsOut} inputMode="numeric" placeholder="cth. 100" onChange={(e) => setModal({ ...modal, gallonsOut: e.target.value.replace(/[^0-9]/g, '') })} />
                <label className="fld-label">{trD('run.note')}</label>
                <input className="fld" value={modal.note} placeholder={trD('run.notePh')} onChange={(e) => setModal({ ...modal, note: e.target.value })} />
              </>) : (<>
                <div className="run-recon">
                  <div><span>{trD('run.keluar')}</span><b>{numX(modal.run.gallonsOut)}</b></div>
                  <div><span>{trD('run.terjual')}</span><b>{numX(modal.run.sold)}</b></div>
                  <div className="run-recon-exp"><span>{trD('run.sisa')}</span><b>{numX(modal.run.expectedRemaining)}</b></div>
                </div>
                <label className="fld-label">{trD('run.fullReturned')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.full} inputMode="numeric" placeholder={String(modal.run.expectedRemaining)} onChange={(e) => setModal({ ...modal, full: e.target.value.replace(/[^0-9]/g, '') })} />
                {modal.full !== '' && (() => { const d = (parseInt(modal.full, 10) || 0) - modal.run.expectedRemaining; return <div className={`run-diffline ${d !== 0 ? 'bad' : 'ok'}`}>{d === 0 ? trD('run.diffOk') : trD('run.diffBad', { d: (d > 0 ? '+' : '') + numX(d) })}</div>; })()}
                <label className="fld-label">{trD('run.emptyReturned')}</label>
                <input className="fld tnum" value={modal.empty} inputMode="numeric" placeholder="cth. 55" onChange={(e) => setModal({ ...modal, empty: e.target.value.replace(/[^0-9]/g, '') })} />
                {modal.full !== '' && (parseInt(modal.full, 10) || 0) !== modal.run.expectedRemaining && (<>
                  <label className="fld-label">{trD('run.diffReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                  <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={modal.diffReason} placeholder={trD('run.diffReasonPh')} onChange={(e) => setModal({ ...modal, diffReason: e.target.value })} />
                </>)}
              </>)}
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setModal(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commit}>{saving ? '…' : (modal.kind === 'open' ? trD('run.muat') : trD('run.tutup'))}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

function DistDeliveries({ refreshKey, today, canOrder, canRoute, canClose, fleetScope, fleet, distFleet, setDistFleet, onChanged }) {
  const [date, setDate] = uSx(today);
  const [board, setBoard] = uSx(null);
  const [closeouts, setCloseouts] = uSx([]);
  const [custs, setCusts] = uSx([]);
  const [toast, setToast] = uSx('');
  const [orderOpen, setOrderOpen] = uSx(false);
  const [txnStop, setTxnStop] = uSx(null);
  const [closeOpen, setCloseOpen] = uSx(false);
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => {
    if (!(window.API && window.API.distribusi)) return;
    window.API.distribusi.deliveries.board(date, ef).then((r) => { setBoard(r.data || []); setCloseouts(r.closeouts || []); }).catch(() => { setBoard([]); setCloseouts([]); });
    window.API.distribusi.customers.list(ef).then((r) => setCusts(r.data || [])).catch(() => {});
  };
  uEx(() => { setBoard(null); reload(); }, [refreshKey, ef, date]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const mark = (id, status, transactionId) => window.API.distribusi.deliveries.mark(id, transactionId ? { status, transactionId } : { status })
    .then(() => { reload(); if (onChanged) onChanged(); }).catch(() => flash(trD('dist.loadErr')));
  // ── route reorder: ↑/↓ buttons (work everywhere, incl. mobile) + HTML5 drag (bonus). ──
  // Optimistic: reorder locally, then PUT the new id order; the saved seq drives the list.
  const dragIdx = React.useRef(null);
  const persistOrder = (list) => window.API.distribusi.deliveries.reorder({ date, fleet: ef, order: list.map((r) => r.id) })
    .then(() => { if (onChanged) onChanged(); }).catch(() => flash(trD('dist.loadErr')));
  const reorder = (from, to) => {
    if (from == null || to == null || from === to || to < 0) return;
    const next = (board || []).slice();
    if (to >= next.length) return;
    const [it] = next.splice(from, 1); next.splice(to, 0, it);
    setBoard(next); persistOrder(next);
  };
  const bar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  const rows = board || [];
  // The day is closed per (date, armada). Determine the fleet the board is showing: a
  // single-fleet board (scoped helper) → its fleetId; a full-access user must pick a fleet.
  const fleetIds = [...new Set(rows.map((r) => r.fleetId))];
  const closeFleet = fleetIds.length === 1 ? fleetIds[0] : (distFleet && distFleet !== 'all' ? distFleet : null);
  const closedFor = closeFleet ? closeouts.find((c) => c.fleetId === closeFleet) : null;
  const pendingStops = closeFleet ? rows.filter((s) => s.status === 'pending' && s.fleetId === closeFleet) : [];
  const srcBadge = (s) => <span className={`dist-src ${s}`}>{trD(s === 'tambahan' ? 'dist.srcTambahan' : 'dist.srcJadwal')}</span>;
  const statBadge = (s) => <span className={`dist-dstat ${s}`}>{trD('dist.dstat_' + s)}</span>;
  const hhmm2 = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
  return (
    <div className="dist-dash screen-enter">
      {bar}
      <div className="dist-tx-toolbar">
        <div style={{ minWidth: 190 }}><DP.DateField value={date} onChange={setDate} allowFuture /></div>
        <div style={{ flex: 1 }} />
        {canOrder && <button type="button" className="btn btn-ghost" onClick={() => setOrderOpen(true)}><IconPlus s={16} />{trD('dist.addOrder')}</button>}
        {canClose && closeFleet && !closedFor && board !== null && <button type="button" className="btn btn-primary" onClick={() => setCloseOpen(true)}><IconCheck s={16} />{trD('dist.closeDay')}</button>}
      </div>

      <RunPanel date={date} ef={ef} fleetScope={fleetScope} fleet={fleet} distFleet={distFleet} refreshKey={refreshKey} onChanged={reload} />
      {closeouts.map((c) => (
        <div key={c.id} className="card dist-closed-banner">
          <span className="dist-closed-ic"><IconCheck s={17} /></span>
          <div className="dist-closed-main">
            <b>{trD('dist.closedBy', { who: c.closedByName || '—', t: hhmm2(c.closedAt) })}{fleetIds.length !== 1 ? ' · ' + c.fleetId : ''}</b>
            <span className="dist-closed-sum">{trD('dist.closeSummary', { x: c.delivered, y: c.pending, z: c.cancelled })}{c.generalNote ? ' · ' + c.generalNote : ''}</span>
          </div>
        </div>
      ))}
      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {board === null && <div className="dist-empty dist-loading"><span className="dist-spin" />{trD('common.loading')}</div>}
        {board !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.delivEmpty')}</div>}
        {rows.map((s, i) => (
          <div key={s.id} className={`dist-cust-row dist-deliv-row st-${s.status}`}
            draggable={canRoute} onDragStart={canRoute ? (e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; } : undefined}
            onDragOver={canRoute ? (e) => e.preventDefault() : undefined} onDrop={canRoute ? (e) => { e.preventDefault(); const from = dragIdx.current; dragIdx.current = null; reorder(from, i); } : undefined}>
            {canRoute && (
              <span className="dist-deliv-reorder no-print">
                <span className="dist-deliv-grip" title={trD('dist.dragHint')}><IconMenu s={15} /></span>
                <button type="button" className="icon-btn dist-deliv-mv" title={trD('dist.moveUp')} disabled={i === 0} onClick={() => reorder(i, i - 1)}><IconArrowUp s={14} /></button>
                <button type="button" className="icon-btn dist-deliv-mv" title={trD('dist.moveDown')} disabled={i === rows.length - 1} onClick={() => reorder(i, i + 1)}><IconArrowDown s={14} /></button>
              </span>
            )}
            <span className="dist-txn-av">{initialsOf(s.customerName)}</span>
            <div className="dist-cust-main">
              <div className="dist-txn-line1"><span className="dist-deliv-seq">{i + 1}.</span>{s.customerCode && <span className="dist-code">{s.customerCode}</span>}<span className="dist-txn-name">{s.customerName}</span>{srcBadge(s.source)}{statBadge(s.status)}</div>
              <div className="dist-txn-sub">{s.phone || '—'}{s.deliveryDays && s.deliveryDays.length ? ' · ' + fmtDays(s.deliveryDays) : ''}{s.qty ? ' · ' + numX(s.qty) + ' ' + trD('dist.galonUnit') : ''}{s.sisaBon > 0 ? ' · ' + trD('dist.sisaBon') + ' ' + rpFull(s.sisaBon) : ''}{s.note ? ' · ' + s.note : ''}</div>
              {s.pendingReason ? <div className="dist-deliv-reason"><IconInvoice s={11} />{trD('dist.pendingReason')}: {s.pendingReason}</div> : null}
              <div className="dist-deliv-loc no-print">
                {s.mapsLink
                  ? <a href={s.mapsLink} target="_blank" rel="noopener noreferrer" className="dist-link"><IconPin s={12} />{trD('dist.directions')}</a>
                  : <span className="dist-noloc"><IconPin s={12} />{trD('dist.locNotSet')}</span>}
                <GpsButton custId={s.customerId} hasLoc={s.hasLocation} onSaved={() => { flash(trD('dist.locSaved')); reload(); if (onChanged) onChanged(); }} onFlash={flash} />
                <LocPhoto custId={s.customerId} photoId={s.locationPhotoId} canEdit onChanged={() => { flash(trD('dist.locPhotoSaved')); reload(); if (onChanged) onChanged(); }} compact />
              </div>
            </div>
            {s.status === 'pending' && (
              <div className="dist-deliv-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setTxnStop(s)}><IconPlus s={13} />{trD('dist.delivMakeTxn')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(s.id, 'terkirim')}><IconCheck s={13} />{trD('dist.delivMarkSent')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(s.id, 'batal')}><IconClose s={13} />{trD('dist.delivCancel')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {orderOpen && <DeliveryOrderModal date={date} customers={custs} onClose={() => setOrderOpen(false)} onSaved={() => { setOrderOpen(false); flash(trD('dist.orderSaved')); reload(); if (onChanged) onChanged(); }} />}
      {txnStop && <DeliveryTxnModal stop={txnStop} today={date} onClose={() => setTxnStop(null)} onCreated={(txn) => { const st = txnStop; setTxnStop(null); mark(st.id, 'terkirim', txn.id); flash(trD('dist.delivSentTxn')); }} />}
      {closeOpen && closeFleet && <CloseoutModal date={date} fleet={closeFleet} pendingStops={pendingStops} onClose={() => setCloseOpen(false)} onClosed={() => { setCloseOpen(false); flash(trD('dist.closeDone')); reload(); if (onChanged) onChanged(); }} />}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}
// Day-closeout report. All delivered → optional note only. Any pending → a required
// reason per undelivered stop before the day can be closed (kept as 'ditunda').
function CloseoutModal({ date, fleet, pendingStops, onClose, onClosed }) {
  const [reasons, setReasons] = uSx({});
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const allFilled = pendingStops.every((s) => String(reasons[s.id] || '').trim());
  const save = () => {
    if (!allFilled || saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.deliveries.close({ date, fleet, generalNote: note.trim(), reasons })
      .then(() => onClosed())
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.closeDay')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{fleet} · {date}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {pendingStops.length > 0 ? (<>
            <div className="dist-close-warn"><IconInvoice s={15} />{trD('dist.closePendingWarn', { n: pendingStops.length })}</div>
            {pendingStops.map((s) => (
              <div key={s.id} className="dist-close-prow">
                <div className="dist-close-pname">{s.customerName}</div>
                <input className="fld" value={reasons[s.id] || ''} placeholder={trD('dist.closeReasonPh')} onChange={(e) => setReasons((r) => ({ ...r, [s.id]: e.target.value }))} />
              </div>
            ))}
          </>) : (
            <div className="dist-close-ok"><IconCheck s={16} />{trD('dist.closeAllDone')}</div>
          )}
          <label className="fld-label">{trD('dist.closeNote')}</label>
          <input className="fld" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.closeNotePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving || !allFilled} onClick={save}>{saving ? '…' : trD('dist.closeConfirm')}</button></div>
      </div>
    </div>
  );
}

window.DIST = { Dashboard: DistDashboard, Transactions: DistTransactions, Customers: DistCustomers, Integration: DistIntegration, Prices: DistPrices, Audit: DistAudit, Gallon: DistGallon, Deliveries: DistDeliveries };
