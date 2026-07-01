/* global React, FS, FIN, CashflowChart, DonutChart */
const { useMemo: uMr, useState: uSr } = React;
const trR = (k, v) => window.t(k, v);
function IcR(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

const EXP_PAL = ['#065489', '#0B7EB1', '#138FB3', '#8DD3D0', '#3FB8B2', '#DDF7F6', '#E7F1F5'];
const INC_PAL = ['#065489', '#22A7A1', '#8DD3D0', '#3FB8B2', '#DDF7F6'];
const P = () => window.PERIOD;
const GRAN_KEYS = P().GRAN_KEYS;
const niceDate = (s) => P().niceDate(s);
const resolveRange = (g, a, cs, ce) => P().resolveRange(g, a, cs, ce);
const stepAnchor = (a, g, d) => P().stepAnchor(a, g, d);
const periodLabel = (g, a, r) => P().periodLabel(g, a, r);
const buildSeries = (e, g, a, cs, ce) => P().buildSeries(e, g, a, cs, ce);

function downloadCSV(rows, catMap, label) {
  const head = ['Date', 'Time', 'Type', 'Category', 'Note', 'Amount (IDR)'];
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [head.join(',')];
  rows.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).forEach((e) => {
    lines.push([e.date, e.time, e.type, esc(FS.catInfo(catMap, e.category).label), esc(e.note), (e.type === 'income' ? '' : '-') + e.amount].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `AirRO-CashBook-${label.replace(/[^\w]+/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DeltaPill({ delta, invert }) {
  if (delta == null) return null;
  const up = delta > 0, flat = delta === 0;
  const good = invert ? !up : up;
  const cls = flat ? 'flat' : good ? 'pos' : 'neg';
  return (
    <span className={`delta-pill ${cls}`}>
      {!flat && (up ? <IconTrendUp s={11} /> : <IconTrendDown s={11} />)}
      {up ? '+' : ''}{delta}% <em>{trR('rep.vsPrev')}</em>
    </span>
  );
}

function MiniKpi({ label, value, cls, icon, bg, fg, sub, delta, invert }) {
  return (
    <div className="card rep-kpi">
      <span className="icon-tile" style={{ background: bg, color: fg }}>{IcR(icon, { s: 19 })}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-mut)' }}>{label}</div>
        <div className={`tnum ${cls || ''}`} style={{ fontSize: 21, fontWeight: 800, whiteSpace: 'nowrap' }}>{value}</div>
        {delta !== undefined ? <DeltaPill delta={delta} invert={invert} /> : (sub && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{sub}</div>)}
      </div>
    </div>
  );
}

function BreakdownCard({ title, segs, total, palette, period }) {
  if (!segs.length) return (
    <div className="card" style={{ padding: 18 }}>
      <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ padding: '46px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13 }}>{trR('rep.nodata')}</div>
    </div>
  );
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{period}</span>
      </div>
      <div style={{ margin: '14px 0' }}><DonutChart segments={segs} total={total} centerLabel="Total" palette={palette} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {segs.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tnum" style={{ width: 32, fontSize: 12, fontWeight: 700, color: 'var(--text-mut)' }}>{s.pct}%</span>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: palette[i % palette.length], flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
            <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{FIN.fmt(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadPayrollCSV(staff, rates, label) {
  const head = ['Employee', 'Position', 'Gross', 'BPJS Kesehatan', 'BPJS Ketenagakerjaan', 'PPh21', 'Other Deductions', 'Take-Home', 'Employer Contribution', 'Company Cost'];
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [head.join(',')];
  staff.forEach((s) => {
    const c = HRD.compute(s, rates);
    const bpjsKes = c.kesEmployer + c.kesEmployee;
    const bpjsTk = c.jhtEmployer + c.jhtEmployee + c.jpEmployer + c.jpEmployee + c.jkk + c.jkm;
    const other = (c.deductions || []).reduce((a, d) => a + (+d.amount || 0), 0) + (c.absenceDeduct || 0);
    lines.push([esc(s.name), esc(s.pos || ''), c.gross, bpjsKes, bpjsTk, c.pph, other, c.takeHome, c.employerContrib, c.companyCost].join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `AirRO-Payroll-${label.replace(/[^\w]+/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HRD_PAL = ['#065489', '#0B7EB1', '#22A7A1', '#3FB8B2', '#8DD3D0', '#F7CB6C'];

function HrdReport({ staff, rates, monLabel, payrollPosted, payrollTotal, onPost }) {
  const t = HRD.totals(staff, rates);
  let kesE = 0, kesW = 0, jhtE = 0, jhtW = 0, jpE = 0, jpW = 0, jkk = 0, jkm = 0, pph = 0;
  staff.forEach((s) => {
    const c = HRD.compute(s, rates);
    kesE += c.kesEmployer; kesW += c.kesEmployee; jhtE += c.jhtEmployer; jhtW += c.jhtEmployee;
    jpE += c.jpEmployer; jpW += c.jpEmployee; jkk += c.jkk; jkm += c.jkm; pph += c.pph;
  });
  const kesTot = kesE + kesW, jhtTot = jhtE + jhtW, jpTot = jpE + jpW, jkkjkm = jkk + jkm;

  const comp = [
    { key: 'thp', label: trR('hrdr.takehome'), value: t.takeHome },
    { key: 'kes', label: trR('hrdr.kes'), value: kesTot },
    { key: 'jht', label: 'JHT', value: jhtTot },
    { key: 'jp', label: 'JP', value: jpTot },
    { key: 'jkk', label: 'JKK + JKM', value: jkkjkm },
  ];
  if (pph > 0) comp.push({ key: 'pph', label: 'PPh 21', value: pph });
  const compTotal = comp.reduce((a, x) => a + x.value, 0);
  const compSegs = comp.map((x) => ({ ...x, pct: compTotal ? Math.round((x.value / compTotal) * 100) : 0 }));

  const bpjsRows = [
    { label: trR('hrdr.kes'), er: kesE, ee: kesW },
    { label: trR('hrdr.jht'), er: jhtE, ee: jhtW },
    { label: trR('hrdr.jp'), er: jpE, ee: jpW },
    { label: 'JKK', er: jkk, ee: 0 },
    { label: 'JKM', er: jkm, ee: 0 },
  ];
  const erTot = kesE + jhtE + jpE + jkk + jkm, eeTot = kesW + jhtW + jpW;

  return (
    <div>
      <div className={`payroll-status ${payrollPosted ? 'posted' : 'pending'}`}>
        <span className="ps-ic">{payrollPosted ? <IconCheck s={18} /> : <IconCoinOut s={18} />}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {payrollPosted ? (
            <>
              <div className="ps-t">{trR('hrdr.posted')}</div>
              <div className="ps-s">{trR('hrdr.postedOn', { amt: FIN.fmt(payrollPosted.amount), d: payrollPosted.date })}{Math.abs((payrollPosted.amount || 0) - payrollTotal) > 1 ? ' · ' + trR('hrdr.changed', { amt: FIN.fmt(payrollTotal) }) : ''}</div>
            </>
          ) : (
            <>
              <div className="ps-t">{trR('hrdr.notPosted')}</div>
              <div className="ps-s">{trR('hrdr.notPostedSub', { amt: FIN.fmt(payrollTotal) })}</div>
            </>
          )}
        </div>
        {onPost && (payrollPosted ? (Math.abs((payrollPosted.amount || 0) - payrollTotal) > 1 && <button className="btn btn-ghost ps-btn" onClick={onPost}>{trR('hrdr.update')}</button>)
          : <button className="btn btn-primary ps-btn" onClick={onPost}><IconPlus s={16} />{trR('hrdr.postBtn')}</button>)}
      </div>
      <div className="rep-kpi-row">
        <MiniKpi label={trR('hrdr.company')} value={FIN.fmt(t.companyCost)} icon="IconUsersGroup" bg="var(--green-800)" fg="#fff" sub={trR('hrd.employees', { n: t.count })} />
        <MiniKpi label={trR('hrdr.takehome')} value={FIN.fmt(t.takeHome)} cls="amt-pos" icon="IconWallet" bg="var(--mint-100)" fg="var(--green-800)" sub={trR('hrdr.netpaid')} />
        <MiniKpi label={trR('hrdr.deduct')} value={FIN.fmt(t.employeeDeduct)} cls="amt-neg" icon="IconCoinOut" bg="#EAF1F4" fg="#5E7A88" sub={trR('hrd.withheld')} />
        <MiniKpi label={trR('hrdr.employer')} value={FIN.fmt(t.employerContrib)} icon="IconShield" bg="var(--sand-soft)" fg="var(--warn)" sub={trR('hrd.contrib')} />
      </div>

      <div className="rep-grid">
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trR('hrdr.composition')}</div>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{monLabel}</span>
          </div>
          <div style={{ margin: '14px 0' }}><DonutChart segments={compSegs} total={compTotal} centerLabel={trR('hrdr.company')} palette={HRD_PAL} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {compSegs.map((s, i) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="tnum" style={{ width: 32, fontSize: 12, fontWeight: 700, color: 'var(--text-mut)' }}>{s.pct}%</span>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: HRD_PAL[i % HRD_PAL.length], flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{FIN.fmt(s.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{trR('hrdr.bpjsDetail')}</div>
          <div className="hrdr-bpjs">
            <div className="hrdr-bpjs-head"><span>{trR('hrdr.program')}</span><span>{trR('hrd.employer')}</span><span>{trR('hrd.employee')}</span><span>{trR('hrdr.total')}</span></div>
            {bpjsRows.map((r) => (
              <div className="hrdr-bpjs-row" key={r.label}>
                <span>{r.label}</span>
                <span className="tnum">{FIN.fmt(r.er)}</span>
                <span className="tnum">{r.ee ? FIN.fmt(r.ee) : '—'}</span>
                <span className="tnum strong">{FIN.fmt(r.er + r.ee)}</span>
              </div>
            ))}
            <div className="hrdr-bpjs-row total">
              <span>{trR('hrdr.total')}</span>
              <span className="tnum">{FIN.fmt(erTot)}</span>
              <span className="tnum">{FIN.fmt(eeTot)}</span>
              <span className="tnum strong">{FIN.fmt(erTot + eeTot)}</span>
            </div>
          </div>
          <div className="hrdr-note">{trR('hrdr.splitNote', { kes: FIN.fmt(kesTot), tk: FIN.fmt(jhtTot + jpTot + jkkjkm) })}</div>
        </div>
      </div>

      <div className="card hrd-table-card" style={{ marginTop: 18 }}>
        <div className="hrd-table-scroll">
          <table className="hrd-table">
            <thead>
              <tr><th className="hcell-name">{trR('hrd.cEmployee')}</th><th>{trR('hrd.cGross')}</th><th>{trR('hrd.cKes')}</th><th>{trR('hrd.cTk')}</th><th>{trR('hrd.cDeduct')}</th><th>{trR('hrd.cTakehome')}</th><th>{trR('hrd.cCost')}</th></tr>
            </thead>
            <tbody>
              {staff.map((s) => {
                const c = HRD.compute(s, rates);
                const bk = c.kesEmployer + c.kesEmployee, bt = c.jhtEmployer + c.jhtEmployee + c.jpEmployer + c.jpEmployee + c.jkk + c.jkm;
                return (
                  <tr key={s.id}>
                    <td className="hcell-name"><div className="hemp"><span className="hemp-av">{s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span><div style={{ minWidth: 0 }}><div className="hemp-name">{s.name}</div><div className="hemp-pos">{s.pos || '—'}</div></div></div></td>
                    <td className="tnum">{FIN.fmt(c.gross)}</td>
                    <td className="tnum mut">{FIN.fmt(bk)}</td>
                    <td className="tnum mut">{FIN.fmt(bt)}</td>
                    <td className="tnum amt-neg">−{FIN.fmt(c.employeeDeduct)}</td>
                    <td className="tnum strong">{FIN.fmt(c.takeHome)}</td>
                    <td className="tnum strong">{FIN.fmt(c.companyCost)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td className="hcell-name" style={{ fontWeight: 700 }}>{trR('hrd.totalStaff', { n: t.count })}</td><td className="tnum">{FIN.fmt(t.gross)}</td><td className="tnum mut">{FIN.fmt(t.bpjsKes)}</td><td className="tnum mut">{FIN.fmt(t.bpjsTk)}</td><td className="tnum amt-neg">−{FIN.fmt(t.employeeDeduct)}</td><td className="tnum strong">{FIN.fmt(t.takeHome)}</td><td className="tnum strong">{FIN.fmt(t.companyCost)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportsScreen({ entries, catMap, userName, rates, staff, payrollPosted, payrollTotal, payrollLabel, onPostPayroll }) {
  const [tab, setTab] = uSr('fin');
  const [gran, setGran] = uSr('month');
  const [anchor, setAnchor] = uSr(FIN.TODAY);
  const [cStart, setCStart] = uSr('2026-05-01');
  const [cEnd, setCEnd] = uSr(FIN.TODAY);

  const range = resolveRange(gran, anchor, cStart, cEnd);
  const label = periodLabel(gran, anchor, range);
  const nextDisabled = gran !== 'custom' && range.end >= FIN.TODAY;

  const rows = uMr(() => entries.filter((e) => e.date >= range.start && e.date <= range.end), [entries, range.start, range.end]);

  const k = uMr(() => {
    let income = 0, expense = 0; const days = new Set();
    rows.forEach((e) => { days.add(e.date); if (e.type === 'income') income += e.amount; else expense += e.amount; });
    const profit = income - expense;
    return { income, expense, profit, margin: income ? Math.round((profit / income) * 1000) / 10 : 0, days: days.size, count: rows.length };
  }, [rows]);
  const avgIncome = k.days ? Math.round(k.income / k.days) : 0;

  const prev = uMr(() => { const pm = P().prevMatched(gran, anchor, cStart, cEnd, FIN.TODAY); const ce = pm.curEnd < range.end ? pm.curEnd : range.end; return { cur: P().aggregate(entries, range.start, ce), prv: P().aggregate(entries, pm.start, pm.end) }; }, [entries, gran, anchor, cStart, cEnd, range.start, range.end]);
  const dInc = P().pctDelta(prev.cur.income, prev.prv.income);
  const dExp = P().pctDelta(prev.cur.expense, prev.prv.expense);
  const dProf = P().pctDelta(prev.cur.profit, prev.prv.profit);

  const series = uMr(() => buildSeries(entries, gran, anchor, cStart, cEnd), [entries, gran, anchor, cStart, cEnd]);

  const seg = (t) => {
    const map = {};
    rows.filter((e) => e.type === t).forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    return { total, segs: Object.entries(map).sort((a, b) => b[1] - a[1]).map(([key, v]) => ({ key, label: FS.catInfo(catMap, key).label, value: v, pct: total ? Math.round((v / total) * 100) : 0 })) };
  };
  const exp = uMr(() => seg('expense'), [rows, catMap]);
  const inc = uMr(() => seg('income'), [rows, catMap]);

  return (
    <div className="screen-enter" id="report-area">
      {/* print-only header */}
      <div className="print-head print-only">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo s={34} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{trR('rep.reportTitle')}</div>
            <div style={{ fontSize: 13, color: '#555' }}>{label} · {niceDate(range.start)} {trR('rep.to')} {niceDate(range.end)}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12, color: '#555' }}>
            <div>{trR('rep.generated', { d: niceDate(FIN.TODAY) })}</div>
            <div>{trR('rep.by', { n: userName })}</div>
          </div>
        </div>
        <hr style={{ border: 'none', borderTop: '2px solid #065489', margin: '14px 0 4px' }} />
      </div>

      <div className="rep-tabs">
        <button className={`rep-tab ${tab === 'fin' ? 'on' : ''}`} onClick={() => setTab('fin')}><IconReport s={16} />{trR('rep.tabFin')}</button>
        <button className={`rep-tab ${tab === 'hrd' ? 'on' : ''}`} onClick={() => setTab('hrd')}><IconUsersGroup s={16} />{trR('rep.tabHrd')}</button>
      </div>

      {tab === 'hrd' ? (
        <div className="screen-enter">
          <div className="rep-head">
            <div className="rep-subhead" style={{ marginTop: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>{trR('rep.tabHrd')}</span>
              <span style={{ fontSize: 13, color: 'var(--text-mut)' }}>{trR('hrdr.asof', { m: payrollLabel || label })} · {staff.length} {trR('hrdr.staff')}</span>
            </div>
            <div className="rep-actions">
              <button className="btn btn-ghost" style={{ height: 42 }} onClick={() => downloadPayrollCSV(staff, rates, label)}><IconDownload s={17} />{trR('rep.exportcsv')}</button>
              <button className="btn btn-primary" style={{ height: 42 }} onClick={() => window.print()}><IconReport s={17} />{trR('rep.savepdf')}</button>
            </div>
          </div>
          <HrdReport staff={staff} rates={rates} monLabel={payrollLabel || label} payrollPosted={payrollPosted} payrollTotal={payrollTotal} onPost={onPostPayroll} />
        </div>
      ) : (
      <div className="screen-enter">
      <div className="rep-head">
        <div className="rep-controls">
          <div className="range-picker">
            {GRAN_KEYS.map((r) => (
              <button key={r[0]} className={`range-btn ${gran === r[0] ? 'on' : ''}`} onClick={() => setGran(r[0])}>{trR(r[1])}</button>
            ))}
          </div>
          {gran !== 'custom' ? (
            <DP.PeriodNav gran={gran} anchor={anchor} onAnchor={setAnchor} label={label} today={FIN.TODAY} />
          ) : (
            <span className="custom-range">
              <span className="custom-date"><DP.DateField value={cStart} max={cEnd} onChange={setCStart} /></span>
              <span style={{ color: 'var(--text-faint)' }}>{trR('rep.to')}</span>
              <span className="custom-date"><DP.DateField value={cEnd} min={cStart} max={FIN.TODAY} onChange={setCEnd} /></span>
            </span>
          )}
        </div>
        <div className="rep-actions">
          <button className="btn btn-ghost" style={{ height: 42 }} onClick={() => downloadCSV(rows, catMap, label)}><IconDownload s={17} />{trR('rep.exportcsv')}</button>
          <button className="btn btn-primary" style={{ height: 42 }} onClick={() => window.print()}><IconReport s={17} />{trR('rep.savepdf')}</button>
        </div>
      </div>

      <div className="rep-subhead">
        <span style={{ fontSize: 17, fontWeight: 800 }}>{label}</span>
        <span style={{ fontSize: 13, color: 'var(--text-mut)' }}>{niceDate(range.start)} – {niceDate(range.end)} · {trR('rep.entriesDays', { c: k.count, d: k.days })}</span>
      </div>

      <div className="rep-kpi-row">
        <MiniKpi label={trR('rep.kIncome')} value={FIN.fmt(k.income)} cls="amt-pos" icon="IconCoinIn" bg="var(--mint-100)" fg="var(--green-800)" delta={dInc} />
        <MiniKpi label={trR('rep.kExpense')} value={FIN.fmt(k.expense)} cls="amt-neg" icon="IconCoinOut" bg="#EAF1F4" fg="#5E7A88" delta={dExp} invert />
        <MiniKpi label={trR('rep.kProfit')} value={FIN.fmtS(k.profit)} cls={k.profit >= 0 ? 'amt-pos' : 'amt-neg'} icon="IconTrendUp" bg="var(--sand)" fg="var(--green-900)" delta={dProf} />
        <MiniKpi label={trR('rep.kAvg')} value={FIN.fmt(avgIncome)} icon="IconWallet" bg="#E3F2FB" fg="#0B7EB1" sub={trR('rep.daysSub', { n: k.days })} />
      </div>

      <div className="card" style={{ padding: 20, marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trR('rep.trend')}</div>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-mut)', fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#065489' }} />{trR('rep.kIncome')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-mut)', fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#22A7A1' }} />{trR('rep.kExpense')}</span>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><CashflowChart data={series} range="ALL" /></div>
      </div>

      <div className="rep-grid">
        <BreakdownCard title={trR('rep.expBy')} segs={exp.segs} total={exp.total} palette={EXP_PAL} period={label} />
        <BreakdownCard title={trR('rep.incBy')} segs={inc.segs} total={inc.total} palette={INC_PAL} period={label} />
      </div>
      </div>
      )}
    </div>
  );
}

window.REPORTS = { ReportsScreen };
