/* global React, FIN, DP, Logo */
// ACCOUNTING v2 screens — Buku Besar (ledger) · Rekonsiliasi (reconcile) · Tutup Buku (period close).
// Presentation only: every figure comes from window.API.accounting.* (the tested double-entry engine);
// this file recomputes nothing. All three sit behind ACCOUNTING_V2 — when the flag is off the endpoints
// 404 and each screen shows the informative "coming soon" card instead of a broken screen. Reuses the
// Stage 1-5 design system (fin-* classes, fin-scope print, skeleton/empty/error states).
(function () {
  const { useState: aS, useEffect: aEf, useMemo: aM, useRef: aRf } = React;
  const trA = (k, v) => window.t(k, v);
  function IcA(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
  const money = (n) => (window.FIN ? FIN.fmt(n) : String(n));
  const moneyS = (n) => (window.FIN ? FIN.fmtS(n) : String(n));
  const ACC = () => (window.API && window.API.accounting);
  const todayISO = () => (window.FIN ? FIN.TODAY : new Date().toISOString().slice(0, 10));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthKey = (d) => String(d || '').slice(0, 7);
  const fmtWhen = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const p = (x) => String(x).padStart(2, '0'); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  // Generic SpreadsheetML (.xls) export — same self-contained approach as the shipped report exports.
  function exportXLS(sheetName, matrix, filename) {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cell = (v) => (typeof v === 'number' ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`);
    const rows = matrix.map((r) => '<Row>' + r.map(cell).join('') + '</Row>').join('');
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${esc(sheetName).slice(0, 31)}"><Table>${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Fetch helper with the four states every accounting screen needs: loading · gated (flag off / 404)
  // · error · ready. Re-runs when deps change or reload() is called.
  function useAcct(fetcher, deps) {
    const [state, setState] = aS('loading');
    const [data, setData] = aS(null);
    const [tick, setTick] = aS(0);
    aEf(() => {
      let alive = true; setState('loading');
      Promise.resolve().then(fetcher).then((r) => {
        if (!alive) return; setData(r && r.data !== undefined ? r.data : r); setState('ready');
      }).catch((err) => {
        if (!alive) return;
        const gated = err && (err.status === 404 || /404|not found|disabled/i.test(String((err && err.message) || '')));
        setState(gated ? 'gated' : 'error');
      });
      return () => { alive = false; };
    }, [...(deps || []), tick]);
    return { state, data, reload: () => setTick((t) => t + 1) };
  }

  function GatedCard({ icon, body }) {
    return <div className="card fin-scope"><div className="fin-coming"><span className="fin-coming-ic">{IcA(icon, { s: 24 })}</span><div className="fin-coming-t">{trA('fin.soonTitle')}</div><div className="fin-coming-s">{body}</div></div></div>;
  }
  function Skeleton({ n }) { return <div className="fin-skel">{Array.from({ length: n || 8 }).map((_, i) => <div key={i} className="fin-skel-row"><span className="fin-skel-bar" style={{ width: (45 + (i * 13) % 50) + '%' }} /></div>)}</div>; }
  function ErrorCard({ onRetry }) { return <div className="card fin-scope"><div className="fin-error"><span className="fin-error-ic">{IcA('IconClose', { s: 20 })}</span><div className="fin-empty-t">{trA('rep.nodata')}</div>{onRetry && <button className="btn btn-ghost" onClick={onRetry} style={{ marginTop: 8 }}>{IcA('IconRefresh', { s: 15 })}{trA('acct.retry')}</button>}</div></div>; }

  // One-line "what this screen answers" header (Part 2 #1/#6) — the plain-language purpose plus a
  // context line (period · closed? · journals last posted, or a status note), colour-toned to draw the
  // eye when something needs attention. Reused by the mapping/backfill screens and the report headers.
  function ScreenIntro({ answers, extra, meta, tone }) {
    const ic = tone === 'warn' ? 'IconWarn' : tone === 'ok' ? 'IconCheck' : 'IconInvoice';
    const bits = [extra, meta].filter(Boolean).join(' · ');
    return (
      <div className={`fin-intro fin-intro-${tone || 'info'}`}>
        <span className="fin-intro-ic">{IcA(ic, { s: 15 })}</span>
        <div className="fin-intro-body"><div className="fin-intro-answers">{answers}</div>{bits && <div className="fin-intro-meta">{bits}</div>}</div>
      </div>
    );
  }
  // Report-screen header (Part 2 #1): what the screen answers + a live context line — the period it
  // covers, whether it is closed, and when the underlying journals were last posted. One shared status
  // fetch; tone turns amber when the books don't balance or a source hasn't posted. `periodLabel` /
  // `closed` are passed by screens that have a period concept.
  function ReportHeader({ answers, periodLabel, closed }) {
    const q = useAcct(() => ACC().status({ asOf: todayISO() }), []);
    const s = (q.state === 'ready' && q.data) || {};
    const parts = [];
    if (periodLabel) parts.push(trA('rep.periodIs', { p: periodLabel }) + (closed === true ? ' · ' + trA('rep.periodClosed') : closed === false ? ' · ' + trA('rep.periodOpen') : ''));
    if (q.state === 'ready') parts.push(s.lastPostedAt ? trA('rep.lastPosted', { when: fmtWhen(s.lastPostedAt) }) : trA('rep.noJournals'));
    const warn = q.state === 'ready' && (s.trialBalanced === false || (s.integrity && s.integrity.ok === false) || s.unmappedCount > 0);
    return <ScreenIntro answers={answers} meta={parts.join(' · ')} tone={warn ? 'warn' : 'info'} />;
  }

  // ALUR KERJA (Part 2 #5) — the workflow map on the Ringkasan: Record → Auto-journal → Trial balance →
  // Reconcile → Close. Each step is a link with a status dot (ok / needs-attention), so it is obvious
  // what to do next and in what order. Hidden entirely when accounting v2 is off (status 404s).
  function WorkflowPanel({ onNav }) {
    const q = useAcct(() => ACC().status({ asOf: todayISO() }), []);
    if (q.state === 'gated' || q.state === 'error') return null;   // don't clutter the dashboard when it isn't live
    const s = q.data || {};
    const loading = q.state === 'loading';
    const drift = s.integrity ? ((s.integrity.missing || 0) + (s.integrity.orphan || 0)) : 0;
    const steps = [
      { k: 'record', tone: 'done', to: 'entries', label: trA('flow.record'), sub: trA('flow.recordSub') },
      { k: 'journal', to: s.unmappedCount ? 'acct-mapping' : 'acct-backfill', label: trA('flow.journal'),
        tone: (s.integrity && s.integrity.ok && !s.unmappedCount) ? 'ok' : 'warn',
        sub: s.unmappedCount ? trA('flow.journalUnmapped', { n: s.unmappedCount }) : drift ? trA('flow.journalDrift', { n: drift }) : (s.lastPostedAt ? trA('flow.journalOk', { when: fmtWhen(s.lastPostedAt) }) : trA('flow.journalNone')) },
      { k: 'tb', to: 'reports', label: trA('flow.tb'), tone: s.trialBalanced ? 'ok' : 'warn', sub: s.trialBalanced ? trA('flow.tbOk') : trA('flow.tbBad') },
      { k: 'recon', to: 'reconcile', label: trA('flow.recon'), tone: (s.unreconciled || 0) === 0 ? 'ok' : 'warn', sub: (s.unreconciled || 0) === 0 ? trA('flow.reconOk') : trA('flow.reconN', { n: s.unreconciled }) },
      { k: 'close', to: 'close', label: trA('flow.close'), tone: s.priorClosed ? 'ok' : 'warn', sub: s.priorMonth ? (s.priorClosed ? trA('flow.closeOk', { m: s.priorMonth }) : trA('flow.closeTodo', { m: s.priorMonth })) : trA('flow.closeSub') },
    ];
    return (
      <div className="card fin-scope flow-card">
        <div className="flow-head"><span className="flow-hic">{IcA('IconDashboard', { s: 15 })}</span>{trA('flow.title')}<span className="flow-hsub">{trA('flow.subtitle')}</span></div>
        <div className="flow-steps">
          {steps.map((st, i) => (
            <button key={st.k} type="button" className={`flow-step flow-${loading ? 'load' : st.tone}`} onClick={() => onNav && onNav(st.to)} disabled={loading}>
              <span className="flow-n">{i + 1}</span>
              <span className="flow-body"><span className="flow-label">{st.label}<span className="flow-dot" /></span><span className="flow-sub">{loading ? '…' : st.sub}</span></span>
              <span className="flow-caret">{IcA('IconCaret', { s: 13 })}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Actionable empty state (Part 2 #2) — never a blank table. Title + guidance + an optional CTA.
  function EmptyState({ title, body, actionLabel, onAction, icon }) {
    return (
      <div className="fin-empty">
        <span className="fin-empty-ic">{IcA(icon || 'IconInvoice', { s: 22 })}</span>
        <div className="fin-empty-t">{title}</div>
        {body && <div className="fin-empty-s">{body}</div>}
        {actionLabel && onAction && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onAction}>{actionLabel}</button>}
      </div>
    );
  }

  // ── Period selector (presets + custom), shared by all three screens. value = {preset,start,end,label} ──
  function presetRange(preset) {
    const t = todayISO(); const y = +t.slice(0, 4), m = +t.slice(5, 7);
    const mr = (yy, mm) => ({ start: `${yy}-${String(mm).padStart(2, '0')}-01`, end: `${yy}-${String(mm).padStart(2, '0')}-31`, label: MON[mm - 1] + ' ' + yy });
    if (preset === 'month') return mr(y, m);
    if (preset === 'last') { const d = new Date(y, m - 2, 1); return mr(d.getFullYear(), d.getMonth() + 1); }
    if (preset === 'year') return { start: `${y}-01-01`, end: `${y}-12-31`, label: 'Tahun ' + y };
    return null;
  }
  const defaultPeriod = () => ({ preset: 'month', ...presetRange('month') });
  function PeriodBar({ value, onChange }) {
    const set = (preset) => { if (preset === 'custom') { onChange({ ...value, preset: 'custom' }); return; } const r = presetRange(preset); onChange({ preset, ...r }); };
    return (
      <div className="rep-controls">
        <div className="range-picker">
          {[['month', 'rep.month'], ['last', 'acct.lastMonth'], ['year', 'rep.year'], ['custom', 'rep.custom']].map(([k, lbl]) => (
            <button key={k} className={`range-btn ${value.preset === k ? 'on' : ''}`} onClick={() => set(k)}>{trA(lbl)}</button>
          ))}
        </div>
        {value.preset === 'custom' && (
          <span className="custom-range">
            <span className="custom-date"><DP.DateField value={value.start} max={value.end} onChange={(v) => onChange({ ...value, start: v })} /></span>
            <span style={{ color: 'var(--text-faint)' }}>{trA('rep.to')}</span>
            <span className="custom-date"><DP.DateField value={value.end} min={value.start} max={todayISO()} onChange={(v) => onChange({ ...value, end: v })} /></span>
          </span>
        )}
      </div>
    );
  }

  // Small helper — is a given YYYY-MM closed? (from the periods list). Used to badge reports/rows.
  function usePeriodStatus() {
    const { data } = useAcct(() => (ACC() ? ACC().periods() : Promise.resolve({ data: [] })), []);
    const map = {}; (data || []).forEach((p) => { map[p.periodKey] = p.status; });
    return (ym) => map[ym] || 'terbuka';
  }
  function PeriodBadge({ status }) {
    if (!status || status === 'terbuka') return <span className="tp-badge open">{trA('tp.open')}</span>;
    return <span className={`tp-badge ${status === 'terkunci' ? 'locked' : 'closed'}`}>{status === 'terkunci' ? trA('tp.locked') : trA('tp.closed')}</span>;
  }

  // ════════════════════════ 1) BUKU BESAR (general ledger) ════════════════════════
  function AccountTree({ chart, selected, onSelect }) {
    const [q, setQ] = aS('');
    const [open, setOpen] = aS({});
    const byParent = aM(() => { const m = {}; (chart || []).forEach((a) => { (m[a.parentId || '_root'] || (m[a.parentId || '_root'] = [])).push(a); }); return m; }, [chart]);
    const query = q.trim().toLowerCase();
    const match = (a) => a.code.includes(query) || (a.name || '').toLowerCase().includes(query);
    if (query) {
      const hits = (chart || []).filter((a) => match(a) && byParent[a.id] === undefined);   // leaves only
      return (
        <div className="bb-tree">
          <div className="tx-search bb-search"><IconSearch s={15} style={{ color: 'var(--text-faint)' }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={trA('acct.searchAccount')} aria-label={trA('acct.searchAccount')} /></div>
          <div className="bb-tree-scroll">
            {hits.length === 0 && <div className="fin-empty-s" style={{ padding: 16 }}>{trA('acct.noAccount')}</div>}
            {hits.map((a) => <button key={a.id} className={`bb-acct ${selected === a.code ? 'on' : ''}`} onClick={() => onSelect(a.code)}><b className="tnum">{a.code}</b> {a.name}</button>)}
          </div>
        </div>
      );
    }
    const node = (a, depth) => {
      const kids = byParent[a.id];
      const isOpen = open[a.id] !== false;   // default expanded
      return (
        <div key={a.id}>
          <div className={`bb-node lvl-${depth}`}>
            {kids ? <button className={`bb-caret ${isOpen ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, [a.id]: !isOpen }))} aria-label="toggle">{IcA('IconCaret', { s: 12 })}</button> : <span className="bb-caret-spacer" />}
            {kids
              ? <span className="bb-head"><b className="tnum">{a.code}</b> {a.name}</span>
              : <button className={`bb-acct ${selected === a.code ? 'on' : ''}`} onClick={() => onSelect(a.code)}><b className="tnum">{a.code}</b> {a.name}</button>}
          </div>
          {kids && isOpen && kids.map((k) => node(k, depth + 1))}
        </div>
      );
    };
    return (
      <div className="bb-tree">
        <div className="tx-search bb-search"><IconSearch s={15} style={{ color: 'var(--text-faint)' }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={trA('acct.searchAccount')} aria-label={trA('acct.searchAccount')} /></div>
        <div className="bb-tree-scroll">{(byParent._root || []).map((a) => node(a, 0))}</div>
      </div>
    );
  }

  function JournalDrill({ row, onClose, onOpenEntry }) {
    const { state, data } = useAcct(() => ACC().journal({ sourceType: row.sourceType, sourceId: row.sourceId }), [row.sourceType, row.sourceId]);
    aEf(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
    const j = data;
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal-card fin-scope" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
          <div className="modal-head"><div><div style={{ fontSize: 16, fontWeight: 800 }}>{trA('acct.journalEntry')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{row.date}{row.ref ? ' · ' + row.ref : ''}</div></div><button className="icon-btn" onClick={onClose}>{IcA('IconClose', { s: 18 })}</button></div>
          <div className="modal-body">
            {state === 'loading' && <Skeleton n={3} />}
            {state === 'error' && <ErrorCard />}
            {state === 'ready' && j && (<>
              <div className="fin-journal-cap">{j.description || row.description || '—'}</div>
              <div className="fin-jrow head"><span>{trA('je.account')}</span><span className="fin-r">{trA('je.debit')}</span><span className="fin-r">{trA('je.credit')}</span></div>
              {j.lines.map((l, i) => (<div key={i} className="fin-jrow"><span className="fin-jacct"><b className="tnum">{l.code}</b> {l.name}</span><span className="fin-r tnum">{l.debit ? money(l.debit) : ''}</span><span className="fin-r tnum">{l.credit ? money(l.credit) : ''}</span></div>))}
              <div className="fin-jrow total"><span>{trA('cf.net')}</span><span className="fin-r tnum">{money(j.lines.reduce((s, l) => s + l.debit, 0))}</span><span className="fin-r tnum">{money(j.lines.reduce((s, l) => s + l.credit, 0))}</span></div>
              <div className="acct-src">{trA('acct.source')}: <b>{j.sourceType}</b>{j.sourceId ? ' · ' + j.sourceId : ''}</div>
              {onOpenEntry && j.sourceType === 'entry' && j.sourceId && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { onClose(); onOpenEntry({ id: j.sourceId }); }}>{IcA('IconPencil', { s: 14 })}{trA('rep.openSource')}</button>}
            </>)}
          </div>
        </div>
      </div>
    );
  }

  function LedgerScreen({ businessUnitId, fleetId, unitLabel, onOpenEntry }) {
    const [period, setPeriod] = aS(defaultPeriod);
    const [code, setCode] = aS(null);
    const [dense, setDense] = aS('comfortable');
    const [visible, setVisible] = aS(200);
    const [drill, setDrill] = aS(null);
    const chartQ = useAcct(() => ACC().chart(), []);
    const led = useAcct(() => (code ? ACC().ledger({ code, dateFrom: period.start, dateTo: period.end, businessUnitId, fleetId }) : Promise.resolve({ data: null })), [code, period.start, period.end, businessUnitId, fleetId]);
    const statusOf = usePeriodStatus();
    aEf(() => { setVisible(200); }, [code, period.start, period.end]);
    const sentinel = aRf(null);
    aEf(() => {
      if (!sentinel.current || led.state !== 'ready' || !led.data) return;
      const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setVisible((v) => v + 200); }, { rootMargin: '600px' });
      io.observe(sentinel.current); return () => io.disconnect();
    }, [led.state, led.data]);

    if (chartQ.state === 'gated' || led.state === 'gated') return <GatedCard icon="IconInvoice" body={trA('fin.ledgerSoon')} />;

    const data = led.data;
    const rows = (data && data.rows) || [];
    const shown = rows.slice(0, visible);
    const closedBadge = period.preset !== 'custom' && monthKey(period.start) === monthKey(period.end) ? statusOf(monthKey(period.start)) : null;
    const doXLS = () => {
      if (!data) return;
      const head = [trA('ms.date'), trA('acct.journalNo'), trA('ms.desc'), trA('je.debit'), trA('je.credit'), trA('acct.runningBal')];
      const body = [[trA('acct.opening'), '', '', '', '', data.opening]];
      rows.forEach((r) => body.push([r.date, r.ref, r.description, r.debit || '', r.credit || '', r.balance]));
      body.push([trA('acct.closing'), '', '', '', '', data.closing]);
      exportXLS('Buku Besar ' + code, [head, ...body], `AirRO-BukuBesar-${code}-${period.start}.xls`);
    };

    return (
      <div className="screen-enter fin-scope bb-screen" id="report-area">
        <div className="fin-print-head print-only">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{IcA('Logo', { s: 30 })}<div><div style={{ fontSize: 19, fontWeight: 800 }}>{trA('t.finLedger')}{data ? ' · ' + data.account.code + ' ' + data.account.name : ''}</div><div style={{ fontSize: 12.5, color: '#555' }}>{period.label || period.start + '–' + period.end}{unitLabel ? ' · ' + unitLabel : ''}</div></div></div>
          <hr style={{ border: 'none', borderTop: '2px solid #065489', margin: '12px 0 4px' }} />
        </div>

        <div className="fin-head">
          <div className="fin-head-titles"><h2>{trA('t.finLedger')}</h2><div className="fin-head-scope">{IcA('IconCalendar', { s: 11 })} {period.label || `${period.start} – ${period.end}`}{unitLabel ? ' · ' + unitLabel : ''}{closedBadge && closedBadge !== 'terbuka' ? <span> · <PeriodBadge status={closedBadge} /></span> : null}</div></div>
          <div className="fin-head-actions">
            <PeriodBar value={period} onChange={setPeriod} />
            <div className="fin-denseg"><button className={dense === 'comfortable' ? 'on' : ''} onClick={() => setDense('comfortable')}>{trA('acct.comfortable')}</button><button className={dense === 'compact' ? 'on' : ''} onClick={() => setDense('compact')}>{trA('acct.compact')}</button></div>
            <button className="btn btn-ghost" disabled={!data} onClick={doXLS}>{IcA('IconDownload', { s: 16 })}<span className="fin-btn-lbl">XLSX</span></button>
            <button className="btn btn-primary" disabled={!data} onClick={() => window.print()}>{IcA('IconReport', { s: 16 })}<span className="fin-btn-lbl">{trA('rep.print')}</span></button>
          </div>
        </div>
        <div className="no-print"><ReportHeader answers={trA('rep.ledgerAnswers')} /></div>

        <div className="bb-layout">
          <div className="card bb-picker">
            <div className="sec-title" style={{ fontSize: 13, marginBottom: 8 }}>{trA('acct.chart')}</div>
            {chartQ.state === 'loading' && <Skeleton n={8} />}
            {chartQ.state === 'error' && <ErrorCard onRetry={chartQ.reload} />}
            {chartQ.state === 'ready' && <AccountTree chart={chartQ.data} selected={code} onSelect={setCode} />}
          </div>

          <div className="card bb-ledger">
            {!code && <div className="fin-empty"><span className="fin-empty-ic">{IcA('IconInvoice', { s: 22 })}</span><div className="fin-empty-t">{trA('acct.pickAccount')}</div><div className="fin-empty-s">{trA('acct.pickAccountHint')}</div></div>}
            {code && led.state === 'loading' && <Skeleton n={10} />}
            {code && led.state === 'error' && <ErrorCard onRetry={led.reload} />}
            {code && led.state === 'ready' && data && (
              <div className={`fin-tablewrap fin-dense-${dense}`}>
                <table className="fin-table bb-table">
                  <colgroup><col style={{ width: '104px' }} /><col style={{ width: '120px' }} /><col /><col style={{ width: '124px' }} /><col style={{ width: '124px' }} /><col style={{ width: '140px' }} /></colgroup>
                  <thead><tr>
                    <th className="fin-th">{trA('ms.date')}</th><th className="fin-th">{trA('acct.journalNo')}</th><th className="fin-th">{trA('ms.desc')}</th>
                    <th className="fin-th fin-r">{trA('je.debit')}</th><th className="fin-th fin-r">{trA('je.credit')}</th><th className="fin-th fin-r">{trA('acct.runningBal')}</th>
                  </tr></thead>
                  <tbody>
                    <tr className="fin-trow subtotal"><td className="fin-td" colSpan={5}>{trA('acct.opening')} · {period.label || period.start}</td><td className="fin-td fin-r tnum">{money(data.opening)}</td></tr>
                    {shown.map((r, i) => (
                      <tr key={i} className="fin-trow clickable" tabIndex={0} onClick={() => setDrill(r)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setDrill(r)}>
                        <td className="fin-td tnum">{r.date}</td>
                        <td className="fin-td"><span className="bb-ref tnum">{r.ref || '—'}</span></td>
                        <td className="fin-td"><span className="fin-td-desc">{r.description || '—'}</span><span className="fin-td-sub">{r.sourceType}{r.sourceId ? ' · ' + String(r.sourceId).slice(0, 8) : ''}</span></td>
                        <td className="fin-td fin-r tnum">{r.debit ? money(r.debit) : ''}</td>
                        <td className="fin-td fin-r tnum">{r.credit ? money(r.credit) : ''}</td>
                        <td className="fin-td fin-r tnum">{money(r.balance)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td className="fin-td" colSpan={6} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 24 }}>{trA('acct.noMovement')}</td></tr>}
                    <tr className="fin-trow grand"><td className="fin-td" colSpan={5}>{trA('acct.closing')} · {money(data.rows.reduce((s, r) => s + (r.debit || 0), 0))} / {money(data.rows.reduce((s, r) => s + (r.credit || 0), 0))}</td><td className="fin-td fin-r tnum">{money(data.closing)}</td></tr>
                  </tbody>
                </table>
                {visible < rows.length && <div ref={sentinel} className="fin-more">{trA('acct.showingOf', { a: visible, b: rows.length })}</div>}
              </div>
            )}
          </div>
        </div>
        {drill && <JournalDrill row={drill} onClose={() => setDrill(null)} onOpenEntry={onOpenEntry} />}
      </div>
    );
  }

  // ════════════════════════ 2) REKONSILIASI (bank reconciliation) ════════════════════════
  function ReconcileScreen({ accounts }) {
    const banks = (accounts || []).filter((a) => a.type === 'bank' || a.type === 'cash');
    const [accountId, setAccountId] = aS(() => (banks[0] && banks[0].id) || '');
    const [stmtInput, setStmtInput] = aS('');
    const [sel, setSel] = aS({});          // selected book itemIds for bulk mark
    const [stmt, setStmt] = aS([]);        // imported statement lines [{date, amount, desc, matchedItemId?}]
    const [busy, setBusy] = aS(false);
    const statusOf = usePeriodStatus();
    const rec = useAcct(() => (accountId ? ACC().reconciliation({ accountId, statementBalance: stmtInput === '' ? undefined : stmtInput }) : Promise.resolve({ data: null })), [accountId, stmtInput]);
    if (rec.state === 'gated') return <GatedCard icon="IconRefresh" body={trA('fin.rekonSoon')} />;
    const data = rec.data;

    const mark = async (itemType, itemId, cleared, statementRef) => {
      setBusy(true);
      try { await ACC().reconcileMark({ accountId, itemType, itemId, cleared, statementRef: statementRef || '' }); rec.reload(); }
      finally { setBusy(false); }
    };
    const bulkMark = async () => {
      const ids = Object.keys(sel).filter((k) => sel[k]); if (!ids.length || !data) return;
      setBusy(true);
      try { for (const key of ids) { const [t, id] = key.split(':'); await ACC().reconcileMark({ accountId, itemType: t, itemId: id, cleared: true }); } setSel({}); rec.reload(); }
      finally { setBusy(false); }
    };
    // A cleared item dated inside a closed period may not be un-marked (points the user to Tutup Buku).
    const lockedItem = (it) => { const s = statusOf(monthKey(it.date)); return s === 'ditutup' || s === 'terkunci'; };

    const importCSV = (file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const out = [];
        lines.forEach((l, idx) => {
          const cols = l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
          if (idx === 0 && /tanggal|date|amount|jumlah|nominal/i.test(l)) return;   // header row
          const date = (cols.find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) || '');
          const amtRaw = cols.map((c) => c.replace(/[^0-9.-]/g, '')).find((c) => c && !/^\d{4}$/.test(c) && Math.abs(+c) >= 1);
          const amount = amtRaw ? Math.round(+amtRaw) : 0;
          const desc = cols.filter((c) => c && c !== date && c.replace(/[^0-9.-]/g, '') !== amtRaw).join(' ') || cols.join(' ');
          if (amount) out.push({ date, amount, desc });
        });
        // Suggest a book match by amount (and near date) among UNRECONCILED items — never auto-confirm.
        const pool = (data && data.unreconciled) || [];
        out.forEach((s) => { const m = pool.find((b) => Math.abs(b.amount) === Math.abs(s.amount) && (!s.date || Math.abs(new Date(b.date) - new Date(s.date)) <= 4 * 864e5)); if (m) s.suggest = m; });
        setStmt(out);
      };
      reader.readAsText(file);
    };

    const acctOpts = banks.map((a) => ({ value: a.id, label: a.name + (a.number ? ' · ' + a.number : '') }));
    const diff = data ? data.difference : 0;

    return (
      <div className="screen-enter fin-scope rc-screen" id="report-area">
        <div className="fin-head">
          <div className="fin-head-titles"><h2>{trA('t.finRekon')}</h2><div className="fin-head-scope">{trA('s.finRekon')}</div></div>
          <div className="fin-head-actions">
            <div style={{ minWidth: 190 }}><UI.Dropdown value={accountId} options={acctOpts} onChange={setAccountId} /></div>
            <div className="amt-input rc-stmt"><span className="amt-rp" style={{ fontSize: 13 }}>Rp</span><input inputMode="numeric" placeholder={trA('rc.stmtBalance')} value={stmtInput ? (+stmtInput).toLocaleString('id-ID') : ''} onChange={(e) => setStmtInput(e.target.value.replace(/\D/g, ''))} aria-label={trA('rc.stmtBalance')} /></div>
            <label className="btn btn-ghost rc-import">{IcA('IconDownload', { s: 16 })}<span className="fin-btn-lbl">{trA('rc.importCsv')}</span><input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importCSV(e.target.files[0])} /></label>
          </div>
        </div>
        <div className="no-print"><ReportHeader answers={trA('rep.reconAnswers')} /></div>

        {rec.state === 'loading' && <div className="card fin-scope"><Skeleton n={8} /></div>}
        {rec.state === 'error' && <ErrorCard onRetry={rec.reload} />}
        {rec.state === 'ready' && data && (<>
          <div className={`rc-diff ${data.reconciled ? 'ok' : 'warn'}`}>
            {IcA(data.reconciled ? 'IconCheck' : 'IconWarn', { s: 20 })}
            <span className="rc-diff-lbl">{trA('rc.difference')}</span>
            <span className="rc-diff-val tnum">{moneyS(diff)}</span>
            <span className="rc-diff-tag">{data.reconciled ? trA('rc.balanced') : trA('rc.notBalanced')}</span>
          </div>

          <div className="rc-summary">
            {[['rc.bookBal', data.bookBalance], ['rc.stmtBal', data.statementBalance == null ? '—' : money(data.statementBalance)], ['rc.selisih', moneyS(diff)], ['rc.unreconciled', data.unreconciledCount]].map(([k, v]) => (
              <div key={k} className="cl-sumcard"><span>{trA(k)}</span><b className="tnum">{typeof v === 'number' ? money(v) : v}</b></div>
            ))}
          </div>

          <div className="rc-panels">
            <div className="card rc-panel">
              <div className="rc-panel-head"><span>{trA('rc.bookUnreconciled')} ({data.unreconciled.length})</span>{Object.values(sel).some(Boolean) && <button className="btn btn-primary btn-sm" disabled={busy} onClick={bulkMark}>{IcA('IconCheck', { s: 14 })}{trA('rc.markSelected')}</button>}</div>
              <div className="rc-list">
                {data.unreconciled.length === 0 && <div className="fin-empty-s" style={{ padding: 18, textAlign: 'center' }}>{trA('rc.allCleared')}</div>}
                {data.unreconciled.map((it) => (
                  <div key={it.itemType + it.itemId} className="rc-row">
                    <input type="checkbox" checked={!!sel[it.itemType + ':' + it.itemId]} onChange={(e) => setSel((s) => ({ ...s, [it.itemType + ':' + it.itemId]: e.target.checked }))} aria-label="pilih" />
                    <span className="rc-row-date tnum">{it.date}</span>
                    <span className="rc-row-desc">{it.desc}</span>
                    <span className={`tnum rc-row-amt ${it.amount < 0 ? 'amt-neg' : 'amt-pos'}`}>{moneyS(it.amount)}</span>
                    <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => mark(it.itemType, it.itemId, true)}>{trA('rc.markOne')}</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card rc-panel">
              <div className="rc-panel-head"><span>{trA('rc.statementItems')} ({stmt.length})</span></div>
              <div className="rc-list">
                {stmt.length === 0 && <div className="fin-empty-s" style={{ padding: 18, textAlign: 'center' }}>{trA('rc.importHint')}</div>}
                {stmt.map((s, i) => (
                  <div key={i} className={`rc-row ${s.suggest ? 'has-suggest' : ''}`}>
                    <span className="rc-row-date tnum">{s.date || '—'}</span>
                    <span className="rc-row-desc">{s.desc}{s.suggest && <em className="rc-suggest">{trA('rc.suggest')}: {s.suggest.desc}</em>}</span>
                    <span className="tnum rc-row-amt">{money(s.amount)}</span>
                    {s.suggest
                      ? <button className="btn btn-primary btn-xs" disabled={busy} onClick={() => { mark(s.suggest.itemType, s.suggest.itemId, true, s.desc); setStmt((arr) => arr.map((x, ix) => ix === i ? { ...x, done: true, suggest: null } : x)); }}>{trA('rc.confirmMatch')}</button>
                      : <span className="rc-nomatch">{s.done ? trA('rc.matched') : trA('rc.noMatch')}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cleared items (with un-mark; blocked inside a closed period). */}
          <div className="card rc-panel" style={{ marginTop: 'var(--fs-4)' }}>
            <div className="rc-panel-head"><span>{trA('rc.cleared')} ({data.items.filter((i) => i.cleared).length})</span></div>
            <div className="rc-list">
              {data.items.filter((i) => i.cleared).map((it) => {
                const locked = lockedItem(it);
                return (
                  <div key={it.itemType + it.itemId} className="rc-row cleared">
                    <span className="rc-row-date tnum">{it.date}</span>
                    <span className="rc-row-desc">{it.desc}{it.statementRef ? <em className="rc-suggest">{it.statementRef}</em> : null}</span>
                    <span className={`tnum rc-row-amt ${it.amount < 0 ? 'amt-neg' : 'amt-pos'}`}>{moneyS(it.amount)}</span>
                    {locked
                      ? <span className="rc-locked" title={trA('rc.lockedHint')}>{IcA('IconLock', { s: 13 })}{trA('rc.locked')}</span>
                      : <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => mark(it.itemType, it.itemId, false)}>{trA('rc.unmark')}</button>}
                  </div>
                );
              })}
              {data.items.filter((i) => i.cleared).length === 0 && <div className="fin-empty-s" style={{ padding: 18, textAlign: 'center' }}>{trA('rc.noneCleared')}</div>}
            </div>
          </div>
        </>)}
      </div>
    );
  }

  // ════════════════════════ 3) TUTUP BUKU (period close) ════════════════════════
  function CloseScreen({ isOwner, onNav }) {
    const [target, setTarget] = aS(() => monthKey(todayISO()));   // YYYY-MM being closed
    const [confirm, setConfirm] = aS('');
    const [reopenFor, setReopenFor] = aS(null);   // periodKey being reopened
    const [reason, setReason] = aS('');
    const [busy, setBusy] = aS(false);
    const [err, setErr] = aS('');
    const periodsQ = useAcct(() => ACC().periods(), []);
    const [Y, M] = target.split('-').map(Number);
    const checkQ = useAcct(() => ACC().periodChecklist({ year: Y, month: M }), [target]);
    const tbQ = useAcct(() => ACC().trialBalance(), []);
    if (periodsQ.state === 'gated') return <GatedCard icon="IconLock" body={trA('fin.closeSoon')} />;

    const periods = periodsQ.data || [];
    const chk = checkQ.data || {};
    const tb = tbQ.data || {};
    const balanced = tb.balanced === true;
    const items = [
      { key: 'tb', ok: balanced, label: trA('tp.chkBalance'), fix: null, blocking: true, val: balanced ? '' : trA('tp.chkBalanceBad') },
      { key: 'bank', ok: (chk.unreconciledBank || 0) === 0, label: trA('tp.chkBank'), fix: 'reconcile', val: chk.unreconciledBank ? String(chk.unreconciledBank) : '' },
      { key: 'uncat', ok: (chk.uncategorised || 0) === 0, label: trA('tp.chkUncat'), fix: 'entries', val: chk.uncategorised ? String(chk.uncategorised) : '' },
      { key: 'appr', ok: (chk.pendingApprovals || 0) === 0, label: trA('tp.chkAppr'), fix: 'approvals', val: chk.pendingApprovals ? String(chk.pendingApprovals) : '' },
      { key: 'galon', ok: chk.gallonIntegrity === 'ok', label: trA('tp.chkGalon'), fix: 'dist-gallon', val: chk.gallonIntegrity === 'ok' ? '' : trA('tp.chkGalonBad') },
      { key: 'journal', ok: chk.journalIntegrity !== 'drift', label: trA('tp.chkJournal'), fix: 'acct-backfill', val: chk.journalDrift ? trA('tp.chkJournalBad', { n: chk.journalDrift }) : '' },
    ];
    const targetStatus = (periods.find((p) => p.periodKey === target) || {}).status || 'terbuka';
    const canClose = balanced && targetStatus === 'terbuka' && confirm.trim().toUpperCase() === 'TUTUP';

    const doClose = async () => {
      setBusy(true); setErr('');
      try { await ACC().periodClose({ year: Y, month: M }); setConfirm(''); periodsQ.reload(); checkQ.reload(); }
      catch (e) { setErr((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || 'Gagal.'); }
      finally { setBusy(false); }
    };
    const doReopen = async (pk) => {
      const [yy, mm] = pk.split('-').map(Number);
      setBusy(true); setErr('');
      try { await ACC().periodReopen({ year: yy, month: mm, reason: reason.trim() }); setReopenFor(null); setReason(''); periodsQ.reload(); }
      catch (e) { setErr((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || 'Gagal.'); }
      finally { setBusy(false); }
    };

    return (
      <div className="screen-enter fin-scope tp-screen">
        <div className="fin-head">
          <div className="fin-head-titles"><h2>{trA('t.finClose')}</h2><div className="fin-head-scope">{trA('s.finClose')}</div></div>
        </div>
        <ReportHeader answers={trA('rep.closeAnswers')} periodLabel={target} closed={targetStatus !== 'terbuka'} />

        {/* CLOSE a period — checklist gates the button */}
        <div className="card tp-close">
          <div className="tp-close-head">
            <div className="sec-title" style={{ fontSize: 15 }}>{trA('tp.closeMonth')}</div>
            <input type="month" className="fld tp-month" value={target} max={monthKey(todayISO())} onChange={(e) => setTarget(e.target.value)} aria-label={trA('tp.closeMonth')} />
            <PeriodBadge status={targetStatus} />
          </div>
          {(checkQ.state === 'loading' || tbQ.state === 'loading') && <Skeleton n={5} />}
          {checkQ.state === 'ready' && (
            <div className="tp-checklist">
              {items.map((it) => (
                <div key={it.key} className={`tp-chk ${it.ok ? 'ok' : (it.blocking ? 'bad' : 'warn')}`}>
                  <span className="tp-chk-ic">{IcA(it.ok ? 'IconCheck' : (it.blocking ? 'IconClose' : 'IconWarn'), { s: 15 })}</span>
                  <span className="tp-chk-lbl">{it.label}{it.val ? <em> — {it.val}</em> : ''}</span>
                  {!it.ok && it.fix && <button className="dist-link" onClick={() => onNav && onNav(it.fix)}>{trA('tp.fix')}</button>}
                </div>
              ))}
            </div>
          )}
          {targetStatus === 'terbuka' && (
            <div className="tp-confirm">
              {!balanced && <div className="add-err"><IconClose s={14} />{trA('tp.blockedUnbalanced')}</div>}
              <label className="fld-label">{trA('tp.typeConfirm')}</label>
              <input className="fld" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="TUTUP" disabled={!balanced} />
              <div className="tp-lockinfo">{trA('tp.lockInfo')}</div>
              {err && <div className="add-err"><IconClose s={14} />{err}</div>}
              <button className="btn btn-primary" disabled={!canClose || busy} onClick={doClose}>{IcA('IconLock', { s: 16 })}{trA('tp.closeBtn', { m: target })}</button>
            </div>
          )}
        </div>

        {/* PERIOD LIST + audit */}
        <div className="card tp-list">
          <div className="sec-title" style={{ fontSize: 15, marginBottom: 8 }}>{trA('tp.periods')}</div>
          {periodsQ.state === 'loading' && <Skeleton n={4} />}
          {periodsQ.state === 'error' && <ErrorCard onRetry={periodsQ.reload} />}
          {periodsQ.state === 'ready' && (
            periods.length === 0
              ? <div className="fin-empty-s" style={{ padding: 18 }}>{trA('tp.noneClosed')}</div>
              : (
                <div className="fin-tablewrap">
                  <table className="fin-table">
                    <colgroup><col style={{ width: '110px' }} /><col style={{ width: '110px' }} /><col /><col style={{ width: '150px' }} /><col style={{ width: '120px' }} /></colgroup>
                    <thead><tr><th className="fin-th">{trA('tp.month')}</th><th className="fin-th">{trA('tp.status')}</th><th className="fin-th">{trA('tp.closedBy')}</th><th className="fin-th">{trA('tp.closedAt')}</th><th className="fin-th fin-r">{trA('tp.action')}</th></tr></thead>
                    <tbody>
                      {periods.map((p) => (
                        <React.Fragment key={p.periodKey}>
                          <tr className="fin-trow">
                            <td className="fin-td tnum">{p.periodKey}</td>
                            <td className="fin-td"><PeriodBadge status={p.status} /></td>
                            <td className="fin-td">{p.closedByName || '—'}{p.reopenedByName ? <span className="fin-td-sub">{trA('tp.reopenedBy', { n: p.reopenedByName })}</span> : null}</td>
                            <td className="fin-td tnum">{p.closedAt ? String(p.closedAt).slice(0, 10) : '—'}</td>
                            <td className="fin-td fin-r">
                              {p.status !== 'terbuka' && p.status !== 'terkunci' && isOwner && <button className="btn btn-ghost btn-xs" onClick={() => { setReopenFor(reopenFor === p.periodKey ? null : p.periodKey); setReason(''); setErr(''); }}>{trA('tp.reopen')}</button>}
                            </td>
                          </tr>
                          {p.reopenReason && <tr className="tp-audit-row"><td className="fin-td" colSpan={5}><span className="tp-audit">{IcA('IconRefresh', { s: 12 })} {trA('tp.reopenAudit', { n: p.reopenedByName || '—', d: p.reopenedAt ? String(p.reopenedAt).slice(0, 10) : '—', r: p.reopenReason })}</span></td></tr>}
                          {reopenFor === p.periodKey && (
                            <tr className="tp-reopen-row"><td className="fin-td" colSpan={5}>
                              <div className="tp-reopen">
                                <label className="fld-label" style={{ marginTop: 0 }}>{trA('tp.reopenReason')} *</label>
                                <input className="fld" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={trA('tp.reopenReasonPh')} />
                                {err && <div className="add-err"><IconClose s={14} />{err}</div>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                  <button className="btn btn-ghost" onClick={() => setReopenFor(null)}>{trA('common.cancel')}</button>
                                  <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => doReopen(p.periodKey)}>{trA('tp.reopenDo')}</button>
                                </div>
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}
        </div>
      </div>
    );
  }

  const errMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || trA('acct.saveFail');

  // ── PEMETAAN AKUN — map each cash-book category to a chart account. Unmapped categories (no built-in
  // default and no override) are shown first, highlighted, because they fall to the Lain-lain bucket
  // until mapped. Owner/GM may edit; everyone with reports may view. ──
  function MappingScreen({ canEdit }) {
    const q = useAcct(() => ACC().mappings(), []);
    const [busy, setBusy] = aS('');      // "categoryKey|type" currently saving
    const [err, setErr] = aS('');
    if (q.state === 'gated') return <GatedCard icon="IconInvoice" body={trA('fin.mapSoon')} />;
    const d = q.data || { items: [], accounts: { income: [], expense: [] }, unmappedCount: 0 };
    const items = d.items || [];
    const nUnmapped = items.filter((i) => i.source === 'none').length;
    const apply = async (categoryKey, type, chartCode) => {
      setBusy(categoryKey + '|' + type); setErr('');
      try {
        if (chartCode) await ACC().setMapping({ categoryKey, type, chartCode });
        else await ACC().clearMapping({ categoryKey, type });
        q.reload();
      } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
    };
    const Row = (it) => {
      const opts = (d.accounts && d.accounts[it.type]) || [];
      const key = it.category + '|' + it.type;
      const srcCls = it.source === 'none' ? 'bad' : (it.source === 'custom' ? 'custom' : 'default');
      return (
        <tr key={key} className={`fin-trow map-row map-${srcCls}`}>
          <td className="fin-td"><b>{it.category}</b>{it.count ? <span className="fin-td-sub">{trA('map.entriesN', { n: it.count })}</span> : null}</td>
          <td className="fin-td"><span className={`map-type map-type-${it.type}`}>{trA(it.type === 'income' ? 'map.income' : 'map.expense')}</span></td>
          <td className="fin-td">
            {canEdit ? (
              <select className="fld map-pick" value={it.source === 'custom' ? it.code : ''} disabled={busy === key}
                onChange={(e) => apply(it.category, it.type, e.target.value)} aria-label={trA('map.pickAccount')}>
                <option value="">{it.source === 'default' ? trA('map.useDefault', { code: it.code }) : trA('map.choose')}</option>
                {opts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            ) : (<span className="tnum">{it.code ? it.code + ' · ' + (it.name || '') : trA('map.none')}</span>)}
          </td>
          <td className="fin-td">
            {it.source === 'none' ? <span className="map-badge bad">{IcA('IconWarn', { s: 12 })} {trA('map.unmapped')}</span>
              : it.source === 'custom' ? <span className="map-badge custom">{trA('map.custom')}</span>
              : <span className="map-badge default">{trA('map.builtin')}</span>}
          </td>
          <td className="fin-td fin-r">{canEdit && it.source === 'custom' && <button className="btn btn-ghost btn-xs" disabled={busy === key} onClick={() => apply(it.category, it.type, '')}>{trA('map.reset')}</button>}</td>
        </tr>
      );
    };
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finMap')}</h2><div className="fin-head-scope">{trA('s.finMap')}</div></div></div>
        <ScreenIntro answers={trA('map.answers')} extra={nUnmapped > 0 ? trA('map.nUnmapped', { n: nUnmapped }) : trA('map.allMapped')} tone={nUnmapped > 0 ? 'warn' : 'ok'} />
        <div className="card">
          {q.state === 'loading' && <Skeleton n={6} />}
          {q.state === 'error' && <ErrorCard onRetry={q.reload} />}
          {q.state === 'ready' && (items.length === 0
            ? <EmptyState title={trA('map.emptyT')} body={trA('map.emptyB')} />
            : (<>
              {err && <div className="add-err" style={{ margin: '4px 0 10px' }}><IconClose s={14} />{err}</div>}
              <div className="fin-tablewrap">
                <table className="fin-table">
                  <colgroup><col /><col style={{ width: '110px' }} /><col style={{ width: '260px' }} /><col style={{ width: '130px' }} /><col style={{ width: '90px' }} /></colgroup>
                  <thead><tr><th className="fin-th">{trA('map.colCat')}</th><th className="fin-th">{trA('map.colType')}</th><th className="fin-th">{trA('map.colAccount')}</th><th className="fin-th">{trA('map.colSource')}</th><th className="fin-th" /></tr></thead>
                  <tbody>{items.map(Row)}</tbody>
                </table>
              </div>
            </>))}
        </div>
      </div>
    );
  }

  // ── BACKFILL — owner/GM one-time migration: project existing cash-book + distribusi records into
  // journals. A DRY-RUN preview (writes nothing) shows exactly what WOULD post per source type before
  // committing. Live posting keeps things current afterward, so this is a migration tool, not routine. ──
  function BackfillScreen({ canRun }) {
    const [from, setFrom] = aS('');
    const [preview, setPreview] = aS(null);
    const [result, setResult] = aS(null);
    const [busy, setBusy] = aS('');
    const [err, setErr] = aS('');
    const [gated, setGated] = aS(false);
    const call = async (dryRun) => {
      setBusy(dryRun ? 'preview' : 'run'); setErr(''); if (dryRun) setResult(null);
      try { const r = await ACC().backfill({ fromDate: from || undefined, dryRun }); const data = (r && r.data) || r; if (dryRun) setPreview(data); else { setResult(data); setPreview(null); } }
      catch (e) { const g = e && (e.status === 404 || /404|disabled/i.test(String((e && e.message) || ''))); if (g) setGated(true); else setErr(errMsg(e)); }
      finally { setBusy(''); }
    };
    if (gated) return <GatedCard icon="IconRefresh" body={trA('fin.backfillSoon')} />;
    const SRC = [['entry', 'bf.srcEntry'], ['transfer', 'bf.srcTransfer'], ['dist_txn', 'bf.srcDistTxn'], ['dist_expense', 'bf.srcExpense'], ['dist_adjustment', 'bf.srcAdjust'], ['reclass', 'bf.srcReclass']];
    const counts = (o) => SRC.map(([k, lbl]) => ({ k, lbl, n: (o && o[k]) || 0 })).filter((r) => r.n > 0);
    const totalOf = (o) => SRC.reduce((s, [k]) => s + ((o && o[k]) || 0), 0);
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finBackfill')}</h2><div className="fin-head-scope">{trA('s.finBackfill')}</div></div></div>
        <ScreenIntro answers={trA('bf.answers')} extra={trA('bf.oneTime')} tone="info" />
        <div className="card">
          <div className="bf-controls">
            <label className="fld-label" style={{ marginTop: 0 }}>{trA('bf.fromDate')}</label>
            <div className="bf-row">
              <input type="date" className="fld bf-date" value={from} max={todayISO()} onChange={(e) => setFrom(e.target.value)} />
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => call(true)}>{IcA('IconInvoice', { s: 15 })}{busy === 'preview' ? trA('bf.previewing') : trA('bf.preview')}</button>
            </div>
            <div className="bf-hint">{trA('bf.fromHint')}</div>
          </div>
          {err && <div className="add-err" style={{ marginTop: 10 }}><IconClose s={14} />{err}</div>}
          {preview && (
            <div className="bf-preview">
              <div className="bf-preview-head">{IcA('IconInvoice', { s: 15 })}{trA('bf.wouldPost', { n: totalOf(preview) })}</div>
              {totalOf(preview) === 0
                ? <div className="fin-empty-s">{trA('bf.nothingNew')}</div>
                : (<>
                  <div className="bf-grid">{counts(preview).map((r) => <div key={r.k} className="bf-cell"><span className="bf-cell-n tnum">{r.n}</span><span className="bf-cell-l">{trA(r.lbl)}</span></div>)}</div>
                  {canRun && <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy === 'run'} onClick={() => call(false)}>{IcA('IconRefresh', { s: 16 })}{busy === 'run' ? trA('bf.running') : trA('bf.commit', { n: totalOf(preview) })}</button>}
                  {!canRun && <div className="bf-hint" style={{ marginTop: 10 }}>{trA('bf.ownerOnly')}</div>}
                </>)}
            </div>
          )}
          {result && (
            <div className="bf-result">
              <div className="bf-preview-head ok">{IcA('IconCheck', { s: 15 })}{trA('bf.done', { n: totalOf(result) })}</div>
              <div className="bf-grid">{counts(result).map((r) => <div key={r.k} className="bf-cell"><span className="bf-cell-n tnum">{r.n}</span><span className="bf-cell-l">{trA(r.lbl)}</span></div>)}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.ACCT = { LedgerScreen, ReconcileScreen, CloseScreen, MappingScreen, BackfillScreen, WorkflowPanel };
})();
