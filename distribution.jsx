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

function Kpi({ icon, tile, fg, value, label, cls }) {
  return (
    <div className="card stat-box dist-kpi">
      <span className="icon-tile" style={{ background: tile, color: fg }}>{IcX(icon, { s: 19 })}</span>
      <div className={`tnum dist-kpi-val ${cls || ''}`}>{value}</div>
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
  return (
    <div className="dist-dash screen-enter">
      {staffMode && (
        <div className="dist-staff-banner"><span className="dist-staff-ic"><IconShield s={16} /></span><div><b>{trD('dist.staffMode')}</b><span>{trD('dist.staffModeSub')}</span></div></div>
      )}

      <div className="dist-grid">
        <div className="dist-main">
          <div className="dist-kpis">
            <Kpi icon="IconDrop" tile="var(--mint-100)" fg="var(--green-800)" value={numX(sum.qty)} label={trD('dist.kpiGalon')} />
            <Kpi icon="IconCoinIn" tile="var(--pos-bg)" fg="var(--green-800)" value={rpX(sum.uangMasuk)} label={trD('dist.kpiIn')} cls="amt-pos" />
            <Kpi icon="IconInvoice" tile="var(--warn-bg)" fg="var(--warn)" value={rpX(sum.piutang)} label={trD('dist.kpiBon')} />
            <Kpi icon="IconTx" tile="#EAF1F4" fg="#5E7A88" value={numX(sum.count)} label={trD('dist.kpiTxn')} />
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="dist-txn-name">{t.customerName || '—'}</div>
                  <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)} · <span className={`dist-mpill ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tnum dist-txn-amt">{rpFull(t.amount)}</div>
                  <span className={`dist-badge ${t.corrected ? 'corr' : 'lock'}`}>{IcX(t.corrected ? 'IconPencil' : 'IconLock', { s: 11 })}{t.corrected ? trD('dist.corrected') : trD('dist.txLocked')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dist-rail">
          <div className="card dist-card">
            <div className="sec-title">{trD('dist.today')}</div>
            <div className="dist-sumrow"><span>{trD('dist.kpiGalon')}</span><b className="tnum">{numX(sum.qty)}</b></div>
            <div className="dist-sumrow"><span>{trD('dist.kpiIn')}</span><b className="tnum amt-pos">{rpFull(sum.uangMasuk)}</b></div>
            <div className="dist-sumrow"><span>{trD('dist.kpiBon')}</span><b className="tnum" style={{ color: 'var(--warn)' }}>{rpFull(sum.piutang)}</b></div>
            <div className="dist-sumrow"><span>{trD('dist.kpiTxn')}</span><b className="tnum">{numX(sum.count)}</b></div>
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

window.DIST = { Dashboard: DistDashboard };
