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
  const ACC2 = () => (window.API && window.API.payrollAccrual);   // accrual payroll (separate router)
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

  // Dashboard card — subscriptions falling due in the next 7 days (a Bill isn't generated until the run
  // job fires, so this is the "heads-up" before the cash goes out). Overdue rows (cycle passed, no bill)
  // sort first and read red. Renders nothing when the engine is off or nothing is due — no empty clutter.
  function SubsDueCard({ onNav }) {
    const q = useAcct(() => ACC().subscriptionsDue({ asOf: todayISO(), days: 7 }), []);
    if (q.state === 'gated' || q.state === 'error') return null;
    const d = q.data || {};
    if (q.state === 'ready' && (d.count || 0) === 0) return null;   // nothing due — stay out of the way
    const loading = q.state === 'loading';
    if (loading) return null;
    const rows = d.rows || [];
    return (
      <div className="card fin-scope subsdue-card">
        <button type="button" className="subsdue-head" onClick={() => onNav && onNav('acct-subscriptions')}>
          <span className="subsdue-hic">{IcA('IconCalendar', { s: 15 })}</span>
          <span className="subsdue-htxt">{trA('subsDue.title', { n: d.count })}</span>
          <span className="subsdue-htot tnum">{money(d.total)}</span>
          <span className="flow-caret">{IcA('IconCaret', { s: 13 })}</span>
        </button>
        <div className="subsdue-rows">
          {rows.map((r) => (
            <button key={r.id} type="button" className={`subsdue-row${r.overdue ? ' overdue' : ''}`} onClick={() => onNav && onNav('acct-subscriptions')}>
              <span className="subsdue-name">{r.name}{r.supplierName ? <em> · {r.supplierName}</em> : ''}</span>
              <span className="subsdue-when">{r.overdue ? <span className="subsdue-badge">{trA('subsDue.overdue')}</span> : r.nextRunDate}</span>
              <span className="subsdue-amt tnum">{money(r.total)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Small "?" info dot with a plain-language tooltip (Part 2 #6) — used to explain accounting terms
  // (Neraca Saldo, Buku Besar, Piutang Usaha, Arus Kas sections) to a non-accountant reader.
  function InfoDot({ tip }) { return <span className="fin-infodot" tabIndex={0} title={tip} aria-label={tip}>{IcA('IconInfo', { s: 11 }) || '?'}</span>; }

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
      // ACCRUAL-BASIS checks. Amortisation BLOCKS (unposted → overstated profit) and offers a one-click
      // fix; accrued / subscriptions-due / draft bills only WARN.
      { key: 'amort', ok: (chk.amortPending || 0) === 0, label: trA('tp.chkAmort'), fix: 'acct-accrual', blocking: true, val: chk.amortPending ? String(chk.amortPending) : '', action: (chk.amortPending || 0) > 0 ? 'amort' : null },
      { key: 'depr', ok: (chk.deprPending || 0) === 0, label: trA('tp.chkDepr'), fix: 'acct-assets', blocking: true, val: chk.deprPending ? trA('tp.chkDeprVal', { n: chk.deprAssets || 0 }) : '', action: (chk.deprPending || 0) > 0 ? 'depr' : null },
      { key: 'prodJ', ok: (chk.prodUnposted || 0) === 0, label: trA('tp.chkProdJ'), fix: 'acct-costing', blocking: true, val: chk.prodUnposted ? String(chk.prodUnposted) : '' },
      { key: 'prodD', ok: (chk.prodDraft || 0) === 0, label: trA('tp.chkProdD'), fix: 'acct-costing', val: chk.prodDraft ? String(chk.prodDraft) : '' },
      { key: 'varO', ok: (chk.varOpen || 0) === 0, label: trA('tp.chkVarO'), fix: 'acct-costing', val: chk.varOpen ? String(chk.varOpen) : '' },
      { key: 'payJ', ok: (chk.payrollUnposted || 0) === 0, label: trA('tp.chkPayJ'), fix: 'acct-payroll', blocking: true, val: chk.payrollUnposted ? String(chk.payrollUnposted) : '' },
      { key: 'payD', ok: (chk.payrollDraft || 0) === 0, label: trA('tp.chkPayD'), fix: 'acct-payroll', val: chk.payrollDraft ? String(chk.payrollDraft) : '' },
      { key: 'accrued', ok: (chk.accruedOpen || 0) === 0, label: trA('tp.chkAccrued'), fix: 'acct-accrual', val: chk.accruedOpen ? String(chk.accruedOpen) : '' },
      { key: 'subs', ok: (chk.subsDue || 0) === 0, label: trA('tp.chkSubs'), fix: 'acct-subscriptions', val: chk.subsDue ? String(chk.subsDue) : '' },
      { key: 'draft', ok: (chk.draftBills || 0) === 0, label: trA('tp.chkDraft'), fix: 'acct-payables', val: chk.draftBills ? String(chk.draftBills) : '' },
    ];
    const targetStatus = (periods.find((p) => p.periodKey === target) || {}).status || 'terbuka';
    const amortBlocked = (chk.amortPending || 0) > 0;
    const deprBlocked = (chk.deprPending || 0) > 0;
    const prodBlocked = (chk.prodUnposted || 0) > 0;
    const payBlocked = (chk.payrollUnposted || 0) > 0;
    const canClose = balanced && !amortBlocked && !deprBlocked && !prodBlocked && !payBlocked && targetStatus === 'terbuka' && confirm.trim().toUpperCase() === 'TUTUP';

    const doClose = async () => {
      setBusy(true); setErr('');
      try { await ACC().periodClose({ year: Y, month: M }); setConfirm(''); periodsQ.reload(); checkQ.reload(); }
      catch (e) { setErr((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || 'Gagal.'); }
      finally { setBusy(false); }
    };
    // One-click "post all amortisation for this period" — clears the amort blocker from the checklist.
    const doPostAmort = async () => {
      setBusy(true); setErr('');
      try { await ACC().amortize({ asOf: target + '-31' }); checkQ.reload(); }
      catch (e) { setErr((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || 'Gagal.'); }
      finally { setBusy(false); }
    };
    // One-click "post all depreciation for this period" — clears the depreciation blocker.
    const doPostDepr = async () => {
      setBusy(true); setErr('');
      try { await ACC().depreciate({ asOf: target + '-31' }); checkQ.reload(); }
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
                  {!it.ok && it.action === 'amort' && <button className="btn btn-primary btn-xs" disabled={busy} onClick={doPostAmort}>{IcA('IconRefresh', { s: 12 })}{trA('tp.postAmort')}</button>}
                  {!it.ok && it.action === 'depr' && <button className="btn btn-primary btn-xs" disabled={busy} onClick={doPostDepr}>{IcA('IconRefresh', { s: 12 })}{trA('tp.postDepr')}</button>}
                  {!it.ok && it.fix && <button className="dist-link" onClick={() => onNav && onNav(it.fix)}>{trA('tp.fix')}</button>}
                </div>
              ))}
            </div>
          )}
          {targetStatus === 'terbuka' && (
            <div className="tp-confirm">
              {!balanced && <div className="add-err"><IconClose s={14} />{trA('tp.blockedUnbalanced')}</div>}
              {balanced && amortBlocked && <div className="add-err"><IconClose s={14} />{trA('tp.blockedAmort', { n: chk.amortPending })}</div>}
              {balanced && !amortBlocked && deprBlocked && <div className="add-err"><IconClose s={14} />{trA('tp.blockedDepr', { n: chk.deprAssets || 0 })}</div>}
              {balanced && !amortBlocked && !deprBlocked && prodBlocked && <div className="add-err"><IconClose s={14} />{trA('tp.blockedProd', { n: chk.prodUnposted })}</div>}
              {balanced && !amortBlocked && !deprBlocked && !prodBlocked && payBlocked && <div className="add-err"><IconClose s={14} />{trA('tp.blockedPay', { n: chk.payrollUnposted })}</div>}
              <label className="fld-label">{trA('tp.typeConfirm')}</label>
              <input className="fld" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="TUTUP" disabled={!balanced || amortBlocked || deprBlocked || prodBlocked || payBlocked} />
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
    const [job, setJob] = aS(null);       // async job: { jobId, status, processed, total, posted, failed, result, errors }
    const [busy, setBusy] = aS('');
    const [err, setErr] = aS('');
    const [gated, setGated] = aS(false);
    const pollRef = aRf(null);
    const LS = 'acct_backfill_job';
    const isGated = (e) => e && (e.status === 404 || /404|disabled/i.test(String((e && e.message) || '')));
    const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    // Poll the async job's status; stop (and forget the persisted id) once it's no longer running.
    const poll = (jobId) => {
      stopPoll();
      const tick = async () => {
        try { const r = await ACC().backfillStatus(jobId); const s = (r && r.data) || r; setJob(s);
          if (s.status !== 'running') { stopPoll(); try { localStorage.removeItem(LS); } catch (e) {} } }
        catch (e) { if (e && e.status === 404) { stopPoll(); try { localStorage.removeItem(LS); } catch (er) {} setJob(null); } }
      };
      tick(); pollRef.current = setInterval(tick, 1200);
    };
    // Resume a running job across a page refresh (the id is persisted in localStorage).
    aEf(() => { let saved = null; try { saved = localStorage.getItem(LS); } catch (e) {} if (saved) poll(saved); return stopPoll; }, []);

    const doPreview = async () => {
      setBusy('preview'); setErr('');
      try { const r = await ACC().backfill({ fromDate: from || undefined, dryRun: true }); setPreview((r && r.data) || r); }
      catch (e) { if (isGated(e)) setGated(true); else setErr(errMsg(e)); } finally { setBusy(''); }
    };
    const doRun = async () => {
      setBusy('run'); setErr('');
      try { const r = await ACC().backfill({ fromDate: from || undefined }); const d = (r && r.data) || r;
        try { localStorage.setItem(LS, d.jobId); } catch (e) {}
        setPreview(null); setJob({ jobId: d.jobId, status: 'running', processed: 0, total: d.total || 0, posted: 0, failed: 0 }); poll(d.jobId); }
      catch (e) { if (isGated(e)) setGated(true); else setErr(errMsg(e)); } finally { setBusy(''); }
    };

    if (gated) return <GatedCard icon="IconRefresh" body={trA('fin.backfillSoon')} />;
    const SRC = [['entry', 'bf.srcEntry'], ['transfer', 'bf.srcTransfer'], ['dist_txn', 'bf.srcDistTxn'], ['dist_expense', 'bf.srcExpense'], ['dist_adjustment', 'bf.srcAdjust'], ['reclass', 'bf.srcReclass']];
    const cells = (o) => SRC.map(([k, lbl]) => ({ k, lbl, n: (o && o[k]) || 0 })).filter((r) => r.n > 0);
    const totalOf = (o) => SRC.reduce((s, [k]) => s + ((o && o[k]) || 0), 0);
    const running = job && job.status === 'running';
    const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
    const rc = job && job.result && job.result.counts;
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finBackfill')}</h2><div className="fin-head-scope">{trA('s.finBackfill')}</div></div></div>
        <ScreenIntro answers={trA('bf.answers')} extra={trA('bf.oneTime')} tone="info" />
        <div className="card">
          <div className="bf-controls">
            <label className="fld-label" style={{ marginTop: 0 }}>{trA('bf.fromDate')}</label>
            <div className="bf-row">
              <input type="date" className="fld bf-date" value={from} max={todayISO()} disabled={running} onChange={(e) => setFrom(e.target.value)} />
              <button className="btn btn-ghost" disabled={!!busy || running} onClick={doPreview}>{IcA('IconInvoice', { s: 15 })}{busy === 'preview' ? trA('bf.previewing') : trA('bf.preview')}</button>
            </div>
            <div className="bf-hint">{trA('bf.fromHint')}</div>
          </div>
          {err && <div className="add-err" style={{ marginTop: 10 }}><IconClose s={14} />{err}</div>}

          {/* PREVIEW (dry-run) — shown only when there's no active/finished job to display. */}
          {preview && !job && (
            <div className="bf-preview">
              <div className="bf-preview-head">{IcA('IconInvoice', { s: 15 })}{trA('bf.wouldPost', { n: totalOf(preview) })}</div>
              {totalOf(preview) === 0
                ? <div className="fin-empty-s">{trA('bf.nothingNew')}</div>
                : (<>
                  <div className="bf-grid">{cells(preview).map((r) => <div key={r.k} className="bf-cell"><span className="bf-cell-n tnum">{r.n}</span><span className="bf-cell-l">{trA(r.lbl)}</span></div>)}</div>
                  {canRun ? <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy === 'run'} onClick={doRun}>{IcA('IconRefresh', { s: 16 })}{busy === 'run' ? trA('bf.starting') : trA('bf.commit', { n: totalOf(preview) })}</button>
                    : <div className="bf-hint" style={{ marginTop: 10 }}>{trA('bf.ownerOnly')}</div>}
                </>)}
            </div>
          )}

          {/* ASYNC JOB — progress while running, a sound-books summary when done, guidance if it fails. */}
          {job && (
            <div className={`bf-job ${job.status}`}>
              {running && (<>
                <div className="bf-preview-head">{IcA('IconRefresh', { s: 15 })}{trA('bf.progress', { done: job.processed || 0, total: job.total || 0 })}</div>
                <div className="bf-bar"><div className="bf-bar-fill" style={{ width: pct + '%' }} /></div>
                <div className="bf-hint" style={{ marginTop: 6 }}>{trA('bf.runningHint')}{job.failed ? ' · ' + trA('bf.failedN', { n: job.failed }) : ''}</div>
              </>)}
              {job.status === 'done' && (<>
                <div className="bf-preview-head ok">{IcA('IconCheck', { s: 15 })}{trA('bf.done', { n: job.posted || 0 })}</div>
                {rc && <div className="bf-grid">{cells(rc).map((r) => <div key={r.k} className="bf-cell"><span className="bf-cell-n tnum">{r.n}</span><span className="bf-cell-l">{trA(r.lbl)}</span></div>)}</div>}
                {job.result && (
                  <div className="bf-checks">
                    <div className={`bf-check ${job.result.trialBalanced ? 'ok' : 'bad'}`}>{IcA(job.result.trialBalanced ? 'IconCheck' : 'IconWarn', { s: 14 })}{trA(job.result.trialBalanced ? 'bf.tbOk' : 'bf.tbBad')}</div>
                    <div className={`bf-check ${job.result.integrity && job.result.integrity.ok ? 'ok' : 'bad'}`}>{IcA(job.result.integrity && job.result.integrity.ok ? 'IconCheck' : 'IconWarn', { s: 14 })}{job.result.integrity && job.result.integrity.ok ? trA('bf.integrityOk') : trA('bf.integrityBad', { m: (job.result.integrity && job.result.integrity.missing) || 0, o: (job.result.integrity && job.result.integrity.orphan) || 0 })}</div>
                    {job.failed > 0 && <div className="bf-check bad">{IcA('IconWarn', { s: 14 })}{trA('bf.failedN', { n: job.failed })}</div>}
                  </div>
                )}
                {canRun && <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setJob(null); setPreview(null); }}>{trA('bf.again')}</button>}
              </>)}
              {job.status === 'failed' && (<>
                <div className="bf-preview-head bad">{IcA('IconClose', { s: 15 })}{trA('bf.jobFailed')}</div>
                <div className="dist-warnbox" style={{ marginTop: 8 }}><IconWarn s={15} /><span>{trA('bf.jobFailedHint', { n: job.posted || 0 })}</span></div>
                {(job.errors || []).slice(0, 3).map((e, i) => <div key={i} className="bf-err-line">{e.message}</div>)}
                {canRun && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={doRun}>{IcA('IconRefresh', { s: 16 })}{trA('bf.resume')}</button>}
              </>)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Shared pickers for the AP / accrual / subscription forms ──
  const rpInput = (v, set, ph) => <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" placeholder={ph || '0'} value={v ? (+v).toLocaleString('id-ID') : ''} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} /></div>;
  // Postable expense/asset accounts (leaf, non-header) for a bill/accrual line, fetched once.
  function useChart() { const q = useAcct(() => ACC().chart(), []); const rows = (q.state === 'ready' && q.data) || []; return rows.filter((a) => a.subtype !== 'header'); }
  function AcctSelect({ value, onChange, kinds }) {
    const accts = useChart();
    const opts = accts.filter((a) => !kinds || kinds.includes(a.type));
    return <select className="fld" value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{trA('ap.pickAccount')}</option>{opts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select>;
  }
  function SupplierSelect({ value, onChange }) {
    const q = useAcct(() => ACC().apSuppliers(), []);
    const [adding, setAdding] = aS(''); const [busy, setBusy] = aS(false);
    const list = (q.state === 'ready' && q.data && q.data.data) || [];
    const add = async () => { if (!adding.trim() || busy) return; setBusy(true); try { const r = await ACC().apSupplierCreate({ name: adding.trim() }); const s = (r && r.data) || r; q.reload(); onChange(s.id); setAdding(''); } catch (e) {} finally { setBusy(false); } };
    return (
      <div className="ap-suppick">
        <select className="fld" value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{trA('ap.pickSupplier')}</option>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="ap-suppick-add"><input className="fld" placeholder={trA('ap.newSupplier')} value={adding} onChange={(e) => setAdding(e.target.value)} /><button className="btn btn-ghost btn-sm" disabled={!adding.trim() || busy} onClick={add}>{IcA('IconPlus', { s: 14 }) || '+'}{trA('ap.addSupplier')}</button></div>
      </div>
    );
  }
  const APBADGE = { draft: 'default', terbuka: 'warn', sebagian: 'warn', lunas: 'ok', batal: 'bad' };
  function ApStatus({ s }) { return <span className={`ap-badge ${APBADGE[s] || 'default'}`}>{trA('ap.st_' + s)}</span>; }

  // ═══════════ UTANG USAHA (Accounts Payable) — bills, payments, aging, due-this-week ═══════════
  function PayablesScreen({ canRun, accounts }) {
    const [tab, setTab] = aS('bills');
    const [status, setStatus] = aS('');
    const [form, setForm] = aS(null);      // create-bill modal
    const [detail, setDetail] = aS(null);  // bill id opened
    const billsQ = useAcct(() => ACC().bills(status ? { status } : {}), [status]);
    const dueQ = useAcct(() => ACC().payablesDue(), []);
    const agingQ = useAcct(() => ACC().agingPayable(), []);
    if (billsQ.state === 'gated') return <GatedCard icon="IconInvoice" body={trA('ap.soon')} />;
    const bills = (billsQ.data && billsQ.data.data) || [];
    const summary = (billsQ.data && billsQ.data.summary) || { open: 0, overdue: 0 };
    const due = dueQ.data || { rows: [], total: 0 };
    const reloadAll = () => { billsQ.reload(); dueQ.reload(); agingQ.reload(); };
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finAP')}</h2><div className="fin-head-scope">{trA('s.finAP')}</div></div>
          {canRun && <div className="fin-head-actions"><button className="btn btn-primary" onClick={() => setForm({ supplierId: '', billDate: todayISO(), dueDate: '', tax: '', lines: [{ chartCode: '', description: '', qty: 1, unitPrice: '', amortizeMonths: 0, amortizeStart: '' }], issue: true })}>{IcA('IconPlus', { s: 16 })}{trA('ap.newBill')}</button></div>}
        </div>
        <ScreenIntro answers={trA('ap.answers')} extra={trA('ap.openN', { v: moneyS(summary.open) }) + (summary.overdue ? ' · ' + trA('ap.overdueN', { v: moneyS(summary.overdue) }) : '')} tone={summary.overdue ? 'warn' : 'info'} />

        {/* Jatuh tempo minggu ini */}
        {due.rows.length > 0 && (
          <div className="card ap-due">
            <div className="ap-due-head">{IcA('IconClock', { s: 15 })}{trA('ap.dueThisWeek', { n: due.rows.length, v: moneyS(due.total) })}</div>
            <div className="ap-due-list">{due.rows.slice(0, 8).map((r) => <button key={r.id} type="button" className={`ap-due-row ${r.overdue ? 'over' : ''}`} onClick={() => setDetail(r.id)}><span className="ap-due-sup">{r.supplierName}</span><span className="ap-due-date">{r.dueDate}{r.overdue ? ' · ' + trA('ap.overdue') : ''}</span><b className="tnum">{money(r.outstanding)}</b></button>)}</div>
          </div>
        )}

        <div className="rep-tabs" style={{ marginBottom: 12 }}>
          <button className={`rep-tab ${tab === 'bills' ? 'on' : ''}`} onClick={() => setTab('bills')}>{IcA('IconInvoice', { s: 15 })}{trA('ap.tabBills')}</button>
          <button className={`rep-tab ${tab === 'aging' ? 'on' : ''}`} onClick={() => setTab('aging')}>{IcA('IconReport', { s: 15 })}{trA('ap.tabAging')}</button>
        </div>

        {tab === 'bills' && (
          <div className="card">
            <div className="ap-filter">{['', 'terbuka', 'sebagian', 'lunas', 'draft', 'batal'].map((s) => <button key={s || 'all'} className={`dist-chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s ? trA('ap.st_' + s) : trA('ap.all')}</button>)}</div>
            {billsQ.state === 'loading' && <Skeleton n={6} />}
            {billsQ.state === 'error' && <ErrorCard onRetry={billsQ.reload} />}
            {billsQ.state === 'ready' && (bills.length === 0
              ? <EmptyState title={trA('ap.emptyT')} body={trA('ap.emptyB')} actionLabel={canRun ? trA('ap.newBill') : null} onAction={canRun ? () => setForm({ supplierId: '', billDate: todayISO(), dueDate: '', tax: '', lines: [{ chartCode: '', description: '', qty: 1, unitPrice: '', amortizeMonths: 0, amortizeStart: '' }], issue: true }) : null} />
              : (<div className="fin-tablewrap"><table className="fin-table">
                  <thead><tr><th className="fin-th">{trA('ap.colDate')}</th><th className="fin-th">{trA('ap.colSupplier')}</th><th className="fin-th">{trA('ap.colDue')}</th><th className="fin-th fin-r">{trA('ap.colTotal')}</th><th className="fin-th fin-r">{trA('ap.colOutstanding')}</th><th className="fin-th">{trA('ap.colStatus')}</th></tr></thead>
                  <tbody>{bills.map((b) => <tr key={b.id} className="fin-trow ap-row" onClick={() => setDetail(b.id)}><td className="fin-td tnum">{b.billDate}</td><td className="fin-td">{b.supplierName}{b.billNumber ? <span className="fin-td-sub">{b.billNumber}</span> : ''}</td><td className="fin-td tnum">{b.dueDate || '—'}</td><td className="fin-td fin-r tnum">{money(b.total)}</td><td className="fin-td fin-r tnum">{money(b.outstanding)}</td><td className="fin-td"><ApStatus s={b.status} /></td></tr>)}</tbody>
                </table></div>))}
          </div>
        )}
        {tab === 'aging' && <AgingTable q={agingQ} colName={trA('ap.colSupplier')} />}

        {form && <BillForm form={form} setForm={setForm} onDone={() => { setForm(null); reloadAll(); }} />}
        {detail && <BillDetail id={detail} accounts={accounts} canRun={canRun} onClose={() => setDetail(null)} onChanged={reloadAll} />}
      </div>
    );
  }

  // Reusable 4-bucket aging table (AR or AP).
  function AgingTable({ q, colName }) {
    if (q.state === 'loading') return <div className="card"><Skeleton n={6} /></div>;
    if (q.state === 'error') return <ErrorCard onRetry={q.reload} />;
    const d = q.data || { buckets: {}, rows: [], total: 0 };
    if (!d.rows.length) return <EmptyState title={trA('ap.agingEmpty')} />;
    const B = d.buckets;
    return (
      <div className="card"><div className="fin-tablewrap"><table className="fin-table">
        <thead><tr><th className="fin-th">{colName}</th><th className="fin-th fin-r">0–30</th><th className="fin-th fin-r">31–60</th><th className="fin-th fin-r">61–90</th><th className="fin-th fin-r">90+</th><th className="fin-th fin-r">{trA('ap.colTotal')}</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.supplierId || r.customerId} className="fin-trow"><td className="fin-td">{r.name}</td><td className="fin-td fin-r tnum">{money(r.d0_30)}</td><td className="fin-td fin-r tnum">{money(r.d31_60)}</td><td className="fin-td fin-r tnum">{money(r.d61_90)}</td><td className="fin-td fin-r tnum">{money(r.d90p)}</td><td className="fin-td fin-r tnum"><b>{money(r.total)}</b></td></tr>)}</tbody>
        <tfoot><tr className="fin-trow subtotal"><td className="fin-td">{trA('ap.total')}</td><td className="fin-td fin-r tnum">{money(B.d0_30)}</td><td className="fin-td fin-r tnum">{money(B.d31_60)}</td><td className="fin-td fin-r tnum">{money(B.d61_90)}</td><td className="fin-td fin-r tnum">{money(B.d90p)}</td><td className="fin-td fin-r tnum"><b>{money(d.total)}</b></td></tr></tfoot>
      </table></div></div>
    );
  }

  // Create-bill modal — supplier + line items (with optional prepaid amortisation) + tax → draft, then
  // optionally issue (posts the accrual).
  function BillForm({ form, setForm, onDone }) {
    const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const set = (k, v) => setForm({ ...form, [k]: v });
    const setLine = (i, k, v) => set('lines', form.lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
    const addLine = () => set('lines', [...form.lines, { chartCode: '', description: '', qty: 1, unitPrice: '', amortizeMonths: 0, amortizeStart: '' }]);
    const delLine = (i) => set('lines', form.lines.filter((_, j) => j !== i));
    const subtotal = form.lines.reduce((s, l) => s + (Math.max(1, +l.qty || 1) * (+l.unitPrice || 0)), 0);
    const total = subtotal + (+form.tax || 0);
    const valid = form.supplierId && form.billDate && form.lines.every((l) => l.chartCode && (+l.unitPrice > 0));
    const submit = async () => {
      if (!valid || busy) return; setBusy(true); setErr('');
      try {
        const body = { supplierId: form.supplierId, billDate: form.billDate, dueDate: form.dueDate || undefined, tax: +form.tax || 0,
          lines: form.lines.map((l) => ({ chartCode: l.chartCode, description: l.description, qty: Math.max(1, +l.qty || 1), unitPrice: +l.unitPrice || 0, amortizeMonths: +l.amortizeMonths || 0, amortizeStart: l.amortizeStart || undefined })) };
        const r = await ACC().billCreate(body); const bill = (r && r.data) || r;
        if (form.issue) await ACC().billIssue(bill.id);
        onDone();
      } catch (e) { setErr((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || trA('acct.saveFail')); } finally { setBusy(false); }
    };
    return (
      <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}>
        <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('ap.newBill')}</div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
          <div className="modal-body">
            <label className="fld-label" style={{ marginTop: 0 }}>{trA('ap.supplier')} *</label>
            <SupplierSelect value={form.supplierId} onChange={(v) => set('supplierId', v)} />
            <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('ap.billDate')} *</label><input type="date" className="fld" value={form.billDate} max={todayISO()} onChange={(e) => set('billDate', e.target.value)} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('ap.dueDate')}</label><input type="date" className="fld" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div></div>
            <label className="fld-label">{trA('ap.lines')}</label>
            {form.lines.map((l, i) => (
              <div key={i} className="ap-line">
                <div className="ap-line-main"><AcctSelect value={l.chartCode} onChange={(v) => setLine(i, 'chartCode', v)} kinds={['expense', 'asset']} /><input className="fld" placeholder={trA('ap.lineDesc')} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></div>
                <div className="ap-line-num"><input className="fld tnum" style={{ width: 56 }} inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value.replace(/\D/g, ''))} title={trA('ap.qty')} />{rpInput(l.unitPrice, (v) => setLine(i, 'unitPrice', v), trA('ap.unitPrice'))}{form.lines.length > 1 && <button className="jp-icon" onClick={() => delLine(i)}><IconClose s={15} /></button>}</div>
                <label className="ap-prepaid"><span>{trA('ap.prepaidMonths')}</span><input className="fld tnum" style={{ width: 52 }} inputMode="numeric" value={l.amortizeMonths || ''} placeholder="0" onChange={(e) => setLine(i, 'amortizeMonths', e.target.value.replace(/\D/g, ''))} />{+l.amortizeMonths > 0 && <input type="date" className="fld" value={l.amortizeStart} onChange={(e) => setLine(i, 'amortizeStart', e.target.value)} title={trA('ap.prepaidStart')} />}</label>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addLine}>{IcA('IconPlus', { s: 14 }) || '+'}{trA('ap.addLine')}</button>
            <div className="dist-form-row" style={{ marginTop: 10 }}><div style={{ flex: 1 }}><label className="fld-label">{trA('ap.tax')}</label>{rpInput(form.tax, (v) => set('tax', v))}</div><div style={{ flex: 1, alignSelf: 'flex-end', textAlign: 'right' }}><div className="ap-total-lbl">{trA('ap.total')}</div><div className="ap-total tnum">{money(total)}</div></div></div>
            <label className="ap-issue"><input type="checkbox" checked={form.issue} onChange={(e) => set('issue', e.target.checked)} /><span>{trA('ap.issueNow')}</span></label>
            {err && <div className="add-err"><IconClose s={14} />{err}</div>}
          </div>
          <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : (form.issue ? trA('ap.createIssue') : trA('ap.createDraft'))}</button></div>
        </div>
      </div>
    );
  }

  // Bill detail + payment recording + void.
  function BillDetail({ id, accounts, canRun, onClose, onChanged }) {
    const q = useAcct(() => ACC().bill(id), [id]);
    const [pay, setPay] = aS(null); const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const b = (q.state === 'ready' && q.data) || null;
    const doIssue = async () => { setBusy(true); setErr(''); try { await ACC().billIssue(id); q.reload(); onChanged(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    const doVoid = async () => { const reason = window.prompt(trA('ap.voidReason')); if (!reason) return; setBusy(true); setErr(''); try { await ACC().billVoid(id, { reason }); q.reload(); onChanged(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    const submitPay = async () => { if (!(+pay.amount > 0) || busy) return; setBusy(true); setErr(''); try { await ACC().billPay(id, { date: pay.date, amount: +pay.amount, accountId: pay.accountId || undefined, method: pay.method, reference: pay.reference }); setPay(null); q.reload(); onChanged(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
        <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div>{b ? <><div style={{ fontSize: 17, fontWeight: 800 }}>{b.supplierName} {b.billNumber ? '· ' + b.billNumber : ''}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{b.billDate}{b.dueDate ? ' · ' + trA('ap.due') + ' ' + b.dueDate : ''} · <ApStatus s={b.status} /></div></> : '…'}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
          <div className="modal-body">
            {q.state === 'loading' && <Skeleton n={5} />}
            {b && (<>
              <div className="fin-tablewrap"><table className="fin-table"><tbody>{b.lines.map((l) => <tr key={l.id} className="fin-trow"><td className="fin-td">{l.chartCode} · {l.description || ''}{l.amortizeMonths > 0 ? <span className="fin-td-sub">{trA('ap.prepaidN', { n: l.amortizeMonths })}</span> : ''}</td><td className="fin-td fin-r tnum">{money(l.amount)}</td></tr>)}{b.tax > 0 && <tr className="fin-trow"><td className="fin-td">{trA('ap.tax')} (PPN)</td><td className="fin-td fin-r tnum">{money(b.tax)}</td></tr>}</tbody><tfoot><tr className="fin-trow subtotal"><td className="fin-td">{trA('ap.total')}</td><td className="fin-td fin-r tnum"><b>{money(b.total)}</b></td></tr></tfoot></table></div>
              <div className="ap-paybar"><span>{trA('ap.paid')}: <b className="tnum">{money(b.paid)}</b></span><span>{trA('ap.outstanding')}: <b className="tnum">{money(b.outstanding)}</b></span></div>
              {b.payments.length > 0 && <div className="ap-payments">{b.payments.map((p) => <div key={p.id} className="ap-pay-row"><span>{p.date}</span><span>{p.method || ''}{p.reference ? ' · ' + p.reference : ''}</span><b className="tnum">{money(p.amount)}</b></div>)}</div>}
              {err && <div className="add-err"><IconClose s={14} />{err}</div>}
              {canRun && (
                <div className="ap-actions">
                  {b.status === 'draft' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={doIssue}>{IcA('IconCheck', { s: 14 })}{trA('ap.issue')}</button>}
                  {(b.status === 'terbuka' || b.status === 'sebagian') && !pay && <button className="btn btn-primary btn-sm" onClick={() => setPay({ date: todayISO(), amount: '', accountId: (accounts && accounts[0] && accounts[0].id) || '', method: 'transfer', reference: '' })}>{IcA('IconCoinIn', { s: 14 })}{trA('ap.recordPayment')}</button>}
                  {b.status !== 'batal' && b.paid === 0 && <button className="btn btn-ghost btn-sm danger" disabled={busy} onClick={doVoid}>{IcA('IconClose', { s: 14 })}{trA('ap.void')}</button>}
                </div>
              )}
              {pay && (
                <div className="ap-payform">
                  <div className="sec-title" style={{ fontSize: 14 }}>{trA('ap.recordPayment')}</div>
                  <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('ap.payDate')}</label><input type="date" className="fld" value={pay.date} max={todayISO()} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('ap.payAmount')}</label>{rpInput(pay.amount, (v) => setPay({ ...pay, amount: v }))}</div></div>
                  <label className="fld-label">{trA('ap.payAccount')}</label><select className="fld" value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}><option value="">{trA('ap.pickAccount')}</option>{(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  <input className="fld" style={{ marginTop: 8 }} placeholder={trA('ap.reference')} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => setPay(null)}>{trA('common.cancel')}</button><button className="btn btn-primary btn-sm" disabled={!(+pay.amount > 0) || busy} onClick={submitPay}>{busy ? '…' : trA('ap.pay')}</button></div>
                </div>
              )}
            </>)}
          </div>
        </div>
      </div>
    );
  }
  const msgOf = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || trA('acct.saveFail');

  // ═══════════ AKRUAL & BEBAN DIBAYAR DI MUKA (accrued + prepaid amortisation) ═══════════
  function AccrualScreen({ canRun }) {
    const [aForm, setAForm] = aS(null); const [sForm, setSForm] = aS(null); const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const accrualsQ = useAcct(() => ACC().accruals({ status: 'aktif' }), []);
    const schedQ = useAcct(() => ACC().amortSchedules(), []);
    if (accrualsQ.state === 'gated') return <GatedCard icon="IconRefresh" body={trA('ac.soon')} />;
    const accruals = (accrualsQ.data && accrualsQ.data.data) || [];
    const scheds = (schedQ.data && schedQ.data.data) || [];
    const pendingAmort = scheds.some((s) => s.remaining > 0);
    const runAmort = async () => { setBusy('amort'); setErr(''); try { const r = await ACC().amortize({ asOf: todayISO() }); schedQ.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    const voidAccrual = async (id) => { const reason = window.prompt(trA('ac.voidReason')); if (!reason) return; try { await ACC().accrualVoid(id, { reason }); accrualsQ.reload(); } catch (e) { setErr(msgOf(e)); } };
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finAccrual')}</h2><div className="fin-head-scope">{trA('s.finAccrual')}</div></div></div>
        <ScreenIntro answers={trA('ac.answers')} tone="info" />
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}

        {/* PREPAID / amortisation schedules */}
        <div className="card">
          <div className="ac-sec-head"><div className="sec-title" style={{ fontSize: 15 }}>{trA('ac.prepaidTitle')}</div><div className="ac-sec-act">{canRun && <button className="btn btn-ghost btn-sm" onClick={() => setSForm({ chartCode: '', total: '', months: 12, startDate: todayISO(), description: '' })}>{IcA('IconPlus', { s: 14 }) || '+'}{trA('ac.newPrepaid')}</button>}{canRun && pendingAmort && <button className="btn btn-primary btn-sm" disabled={busy === 'amort'} onClick={runAmort}>{IcA('IconRefresh', { s: 14 })}{busy === 'amort' ? trA('ac.running') : trA('ac.runAmort')}</button>}</div></div>
          {schedQ.state === 'loading' && <Skeleton n={4} />}
          {schedQ.state === 'ready' && (scheds.length === 0
            ? <EmptyState title={trA('ac.prepaidEmpty')} body={trA('ac.prepaidEmptyB')} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('ac.colWhat')}</th><th className="fin-th">{trA('ac.colStart')}</th><th className="fin-th fin-r">{trA('ac.colMonthly')}</th><th className="fin-th fin-r">{trA('ac.colTotal')}</th><th className="fin-th">{trA('ac.colProgress')}</th></tr></thead>
              <tbody>{scheds.map((s) => <tr key={s.id} className="fin-trow"><td className="fin-td">{s.chartCode} · {s.description || ''}</td><td className="fin-td tnum">{s.startDate}</td><td className="fin-td fin-r tnum">{money(s.monthlyAmount)}</td><td className="fin-td fin-r tnum">{money(s.total)}</td><td className="fin-td"><span className="ac-prog">{s.postedMonths}/{s.months}</span>{s.remaining === 0 ? <span className="ap-badge ok">{trA('ac.done')}</span> : null}</td></tr>)}</tbody></table></div>)}
        </div>

        {/* ACCRUED expenses */}
        <div className="card" style={{ marginTop: 14 }}>
          <div className="ac-sec-head"><div className="sec-title" style={{ fontSize: 15 }}>{trA('ac.accruedTitle')}</div>{canRun && <button className="btn btn-ghost btn-sm" onClick={() => setAForm({ chartCode: '', amount: '', date: todayISO(), reverseDate: '', description: '' })}>{IcA('IconPlus', { s: 14 }) || '+'}{trA('ac.newAccrued')}</button>}</div>
          {accrualsQ.state === 'loading' && <Skeleton n={3} />}
          {accrualsQ.state === 'ready' && (accruals.length === 0
            ? <EmptyState title={trA('ac.accruedEmpty')} body={trA('ac.accruedEmptyB')} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('ac.colDate')}</th><th className="fin-th">{trA('ac.colWhat')}</th><th className="fin-th">{trA('ac.colReverse')}</th><th className="fin-th fin-r">{trA('ac.colAmount')}</th><th className="fin-th" /></tr></thead>
              <tbody>{accruals.map((a) => <tr key={a.id} className="fin-trow"><td className="fin-td tnum">{a.date}</td><td className="fin-td">{a.chartCode} · {a.description || ''}</td><td className="fin-td tnum">{a.reverseDate}</td><td className="fin-td fin-r tnum">{money(a.amount)}</td><td className="fin-td fin-r">{canRun && <button className="btn btn-ghost btn-xs danger" onClick={() => voidAccrual(a.id)}>{trA('ac.void')}</button>}</td></tr>)}</tbody></table></div>)}
        </div>

        {aForm && <AccrualForm form={aForm} setForm={setAForm} onDone={() => { setAForm(null); accrualsQ.reload(); }} />}
        {sForm && <PrepaidForm form={sForm} setForm={setSForm} onDone={() => { setSForm(null); schedQ.reload(); }} />}
      </div>
    );
  }
  function AccrualForm({ form, setForm, onDone }) {
    const [busy, setBusy] = aS(false); const [err, setErr] = aS(''); const set = (k, v) => setForm({ ...form, [k]: v });
    const valid = form.chartCode && +form.amount > 0 && form.date;
    const submit = async () => { if (!valid || busy) return; setBusy(true); setErr(''); try { await ACC().accrualCreate({ chartCode: form.chartCode, amount: +form.amount, date: form.date, reverseDate: form.reverseDate || undefined, description: form.description }); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('ac.newAccrued')}</div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
        <div className="modal-body"><div className="dist-infobox"><IconClock s={15} /><span>{trA('ac.accruedInfo')}</span></div>
          <label className="fld-label">{trA('ac.expenseAcct')} *</label><AcctSelect value={form.chartCode} onChange={(v) => set('chartCode', v)} kinds={['expense']} />
          <label className="fld-label">{trA('ac.amount')} *</label>{rpInput(form.amount, (v) => set('amount', v))}
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('ac.date')} *</label><input type="date" className="fld" value={form.date} onChange={(e) => set('date', e.target.value)} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('ac.reverseDate')}</label><input type="date" className="fld" value={form.reverseDate} onChange={(e) => set('reverseDate', e.target.value)} /></div></div>
          <label className="fld-label">{trA('ac.desc')}</label><input className="fld" value={form.description} onChange={(e) => set('description', e.target.value)} />
          {err && <div className="add-err"><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('ac.save')}</button></div>
      </div></div>
    );
  }
  function PrepaidForm({ form, setForm, onDone }) {
    const [busy, setBusy] = aS(false); const [err, setErr] = aS(''); const set = (k, v) => setForm({ ...form, [k]: v });
    const valid = form.chartCode && +form.total > 0 && +form.months > 0 && form.startDate;
    const submit = async () => { if (!valid || busy) return; setBusy(true); setErr(''); try { await ACC().amortScheduleCreate({ chartCode: form.chartCode, total: +form.total, months: +form.months, startDate: form.startDate, description: form.description }); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('ac.newPrepaid')}</div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
        <div className="modal-body"><div className="dist-infobox"><IconInvoice s={15} /><span>{trA('ac.prepaidInfo')}</span></div>
          <label className="fld-label">{trA('ac.expenseAcct')} *</label><AcctSelect value={form.chartCode} onChange={(v) => set('chartCode', v)} kinds={['expense']} />
          <div className="dist-form-row"><div style={{ flex: 2 }}><label className="fld-label">{trA('ac.total')} *</label>{rpInput(form.total, (v) => set('total', v))}</div><div style={{ flex: 1 }}><label className="fld-label">{trA('ac.months')} *</label><input className="fld tnum" inputMode="numeric" value={form.months} onChange={(e) => set('months', e.target.value.replace(/\D/g, ''))} /></div></div>
          <label className="fld-label">{trA('ac.startDate')} *</label><input type="date" className="fld" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          <label className="fld-label">{trA('ac.desc')}</label><input className="fld" value={form.description} onChange={(e) => set('description', e.target.value)} />
          {form.total > 0 && form.months > 0 && <div className="ac-hint">{trA('ac.perMonth', { v: money(Math.floor((+form.total) / (+form.months))) })}</div>}
          {err && <div className="add-err"><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('ac.save')}</button></div>
      </div></div>
    );
  }

  // ═══════════ LANGGANAN BERULANG (recurring subscriptions) ═══════════
  const SUBBADGE = { aktif: 'ok', jeda: 'warn', selesai: 'default', batal: 'bad' };
  function SubscriptionScreen({ canRun }) {
    const [form, setForm] = aS(null); const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const q = useAcct(() => ACC().subscriptions(), []);
    if (q.state === 'gated') return <GatedCard icon="IconRefresh" body={trA('sb.soon')} />;
    const subs = (q.data && q.data.data) || [];
    const summary = (q.data && q.data.summary) || { active: 0, dueSoon: 0 };
    const act = async (fn) => { setBusy('x'); setErr(''); try { await fn(); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    const runNow = () => act(() => ACC().subscriptionsRun({ asOf: todayISO() }));
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finSubs')}</h2><div className="fin-head-scope">{trA('s.finSubs')}</div></div>
          <div className="fin-head-actions">{canRun && summary.dueSoon > 0 && <button className="btn btn-ghost" disabled={!!busy} onClick={runNow}>{IcA('IconRefresh', { s: 15 })}{trA('sb.runNow')}</button>}{canRun && <button className="btn btn-primary" onClick={() => setForm({ supplierId: '', name: '', chartCode: '', amount: '', tax: '', cadence: 'monthly', interval: 1, startDate: todayISO(), endDate: '', dueDays: 0, remindDays: 3, autoIssue: true })}>{IcA('IconPlus', { s: 16 })}{trA('sb.new')}</button>}</div>
        </div>
        <ScreenIntro answers={trA('sb.answers')} extra={trA('sb.activeN', { n: summary.active }) + (summary.dueSoon ? ' · ' + trA('sb.dueSoonN', { n: summary.dueSoon }) : '')} tone={summary.dueSoon ? 'warn' : 'info'} />
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="card">
          {q.state === 'loading' && <Skeleton n={5} />}
          {q.state === 'ready' && (subs.length === 0
            ? <EmptyState title={trA('sb.emptyT')} body={trA('sb.emptyB')} actionLabel={canRun ? trA('sb.new') : null} onAction={canRun ? () => setForm({ supplierId: '', name: '', chartCode: '', amount: '', tax: '', cadence: 'monthly', interval: 1, startDate: todayISO(), endDate: '', dueDays: 0, remindDays: 3, autoIssue: true }) : null} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('sb.colName')}</th><th className="fin-th">{trA('sb.colCadence')}</th><th className="fin-th fin-r">{trA('sb.colAmount')}</th><th className="fin-th">{trA('sb.colNext')}</th><th className="fin-th">{trA('sb.colStatus')}</th><th className="fin-th" /></tr></thead>
              <tbody>{subs.map((s) => <tr key={s.id} className="fin-trow"><td className="fin-td">{s.name}<span className="fin-td-sub">{s.supplierName}</span></td><td className="fin-td">{trA('sb.cad_' + s.cadence)}{s.interval > 1 ? ' ×' + s.interval : ''}</td><td className="fin-td fin-r tnum">{money(s.total)}</td><td className={`fin-td tnum${s.overdue ? ' sb-overdue' : ''}`}>{s.status === 'aktif' ? <span>{s.nextRunDate}{s.overdue ? <span className="subsdue-badge" style={{ marginLeft: 6 }}>{trA('subsDue.overdue')}</span> : ''}</span> : '—'}</td><td className="fin-td"><span className={`ap-badge ${SUBBADGE[s.status]}`}>{trA('sb.st_' + s.status)}</span></td>
                <td className="fin-td fin-r">{canRun && s.status !== 'batal' && s.status !== 'selesai' && (
                  <span className="sb-acts">
                    {s.status === 'aktif' ? <button className="btn btn-ghost btn-xs" disabled={!!busy} onClick={() => act(() => ACC().subscriptionPause(s.id))}>{trA('sb.pause')}</button> : <button className="btn btn-ghost btn-xs" disabled={!!busy} onClick={() => act(() => ACC().subscriptionResume(s.id))}>{trA('sb.resume')}</button>}
                    <button className="btn btn-ghost btn-xs" disabled={!!busy} onClick={() => act(() => ACC().subscriptionSkip(s.id))}>{trA('sb.skip')}</button>
                    <button className="btn btn-ghost btn-xs danger" disabled={!!busy} onClick={() => { if (window.confirm(trA('sb.cancelConfirm'))) act(() => ACC().subscriptionCancel(s.id)); }}>{trA('sb.cancel')}</button>
                  </span>
                )}</td></tr>)}</tbody></table></div>)}
        </div>
        {form && <SubForm form={form} setForm={setForm} onDone={() => { setForm(null); q.reload(); }} />}
      </div>
    );
  }
  function SubForm({ form, setForm, onDone }) {
    const [busy, setBusy] = aS(false); const [err, setErr] = aS(''); const set = (k, v) => setForm({ ...form, [k]: v });
    const valid = form.supplierId && form.name.trim() && form.chartCode && +form.amount > 0 && form.startDate;
    const submit = async () => { if (!valid || busy) return; setBusy(true); setErr(''); try { await ACC().subscriptionCreate({ supplierId: form.supplierId, name: form.name.trim(), chartCode: form.chartCode, amount: +form.amount, tax: +form.tax || 0, cadence: form.cadence, interval: +form.interval || 1, startDate: form.startDate, endDate: form.endDate || undefined, dueDays: +form.dueDays || 0, remindDays: form.remindDays === '' ? 3 : +form.remindDays, autoIssue: form.autoIssue }); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('sb.new')}</div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trA('sb.supplier')} *</label><SupplierSelect value={form.supplierId} onChange={(v) => set('supplierId', v)} />
          <label className="fld-label">{trA('sb.name')} *</label><input className="fld" placeholder={trA('sb.namePh')} value={form.name} onChange={(e) => set('name', e.target.value)} />
          <label className="fld-label">{trA('sb.expenseAcct')} *</label><AcctSelect value={form.chartCode} onChange={(v) => set('chartCode', v)} kinds={['expense']} />
          <div className="dist-form-row"><div style={{ flex: 2 }}><label className="fld-label">{trA('sb.amount')} *</label>{rpInput(form.amount, (v) => set('amount', v))}</div><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.tax')}</label>{rpInput(form.tax, (v) => set('tax', v))}</div></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.cadence')} *</label><select className="fld" value={form.cadence} onChange={(e) => set('cadence', e.target.value)}>{['monthly', 'quarterly', 'yearly'].map((c) => <option key={c} value={c}>{trA('sb.cad_' + c)}</option>)}</select></div><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.every')}</label><input className="fld tnum" inputMode="numeric" value={form.interval} onChange={(e) => set('interval', e.target.value.replace(/\D/g, ''))} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.dueDays')}</label><input className="fld tnum" inputMode="numeric" value={form.dueDays} onChange={(e) => set('dueDays', e.target.value.replace(/\D/g, ''))} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.remindDays')}</label><input className="fld tnum" inputMode="numeric" value={form.remindDays} onChange={(e) => set('remindDays', e.target.value.replace(/\D/g, ''))} /></div></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.startDate')} *</label><input type="date" className="fld" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('sb.endDate')}</label><input type="date" className="fld" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} /></div></div>
          <label className="ap-issue"><input type="checkbox" checked={form.autoIssue} onChange={(e) => set('autoIssue', e.target.checked)} /><span>{trA('sb.autoIssue')}</span></label>
          {err && <div className="add-err"><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('sb.save')}</button></div>
      </div></div>
    );
  }

  // ── FIXED ASSETS & DEPRECIATION — the ASSET REGISTER (cost · accumulated · book value · monthly
  // charge · remaining life), filters, XLSX export, the monthly depreciation run, register/import forms,
  // and a detail view with the full schedule (past + future) + disposal + gallon-pool reconcile. ──
  const AS_CATS = ['kendaraan', 'mesin_ro', 'peralatan', 'galon', 'bangunan', 'lainnya'];
  const AS_METHODS = ['garis_lurus', 'saldo_menurun'];
  const AS_STATUSES = ['aktif', 'dijual', 'dilepas', 'rusak'];
  const asCat = (c) => trA('as.cat_' + c) || c;

  function AssetsScreen({ canRun }) {
    const [fCat, setFCat] = aS(''); const [fStatus, setFStatus] = aS('aktif');
    const [form, setForm] = aS(false); const [imp, setImp] = aS(false); const [detail, setDetail] = aS(null);
    const [busy, setBusy] = aS(''); const [err, setErr] = aS(''); const [toast, setToast] = aS('');
    const q = useAcct(() => ACC().assets({ category: fCat || undefined, status: fStatus || undefined }), [fCat, fStatus]);
    if (q.state === 'gated') return <GatedCard icon="IconInvoice" body={trA('sb.soon')} />;
    const data = (q.data && q.data.data) || [];
    const totals = (q.data && q.data.totals) || { cost: 0, accumulated: 0, bookValue: 0, monthlyCharge: 0 };
    const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
    const doPost = async () => { setBusy('post'); setErr(''); try { const r = await ACC().depreciate({ asOf: todayISO() }); flash(trA('as.posted', { n: (r.data && r.data.posted) || 0 })); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    const doExport = () => {
      const head = [trA('as.colCode'), trA('as.colName'), trA('as.colCat'), trA('as.colCost'), trA('as.colAccum'), trA('as.colBook'), trA('as.colMonthly'), trA('as.colRemain'), trA('as.colStatus'), trA('as.colProd')];
      const body = data.map((a) => [a.code, a.name, asCat(a.category), a.acquisitionCost, a.accumulated, a.bookValue, a.monthlyCharge, a.remainingMonths, trA('as.st_' + a.status), a.isProduction ? 'COGS' : 'Opex']);
      exportXLS('Aset Tetap', [head, ...body], `AirRO-AsetTetap-${todayISO()}.xls`);
    };
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finAssets')}</h2><div className="fin-head-scope">{trA('s.finAssets')}</div></div>
          <div className="fin-head-actions">
            {canRun && <button className="btn btn-ghost" disabled={!!busy} onClick={doPost}>{IcA('IconRefresh', { s: 15 })}{trA('as.postDepr')}</button>}
            {canRun && <button className="btn btn-ghost" onClick={() => setImp(true)}>{IcA('IconDownload', { s: 15 })}{trA('as.import')}</button>}
            <button className="btn btn-ghost" disabled={!data.length} onClick={doExport}>{IcA('IconDownload', { s: 15 })}XLSX</button>
            {canRun && <button className="btn btn-primary" onClick={() => setForm(true)}>{IcA('IconPlus', { s: 16 })}{trA('as.new')}</button>}
          </div>
        </div>
        <ScreenIntro answers={trA('as.answers')} extra={trA('as.taxNote')} tone="warn" />
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="rep-controls" style={{ marginBottom: 10 }}>
          <div className="range-picker">{['', ...AS_STATUSES].map((s) => <button key={s || 'all'} className={`range-btn ${fStatus === s ? 'on' : ''}`} onClick={() => setFStatus(s)}>{s ? trA('as.st_' + s) : trA('as.all')}</button>)}</div>
          <select className="fld" style={{ maxWidth: 180 }} value={fCat} onChange={(e) => setFCat(e.target.value)}><option value="">{trA('as.allCats')}</option>{AS_CATS.map((c) => <option key={c} value={c}>{asCat(c)}</option>)}</select>
        </div>
        <div className="card">
          {q.state === 'loading' && <Skeleton n={6} />}
          {q.state === 'error' && <ErrorCard onRetry={q.reload} />}
          {q.state === 'ready' && (data.length === 0
            ? <EmptyState title={trA('as.emptyT')} body={trA('as.emptyB')} icon="IconInvoice" actionLabel={canRun ? trA('as.new') : null} onAction={canRun ? () => setForm(true) : null} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr>
              <th className="fin-th">{trA('as.colCode')}</th><th className="fin-th">{trA('as.colName')}</th><th className="fin-th fin-r">{trA('as.colCost')}</th><th className="fin-th fin-r">{trA('as.colAccum')}</th><th className="fin-th fin-r">{trA('as.colBook')}</th><th className="fin-th fin-r">{trA('as.colMonthly')}</th><th className="fin-th fin-r">{trA('as.colRemain')}</th><th className="fin-th">{trA('as.colStatus')}</th></tr></thead>
              <tbody>{data.map((a) => <tr key={a.id} className="fin-trow" style={{ cursor: 'pointer' }} onClick={() => setDetail(a.id)}>
                <td className="fin-td">{a.code}{a.isProduction ? <span className="ap-badge ok" style={{ marginLeft: 6 }}>COGS</span> : ''}</td>
                <td className="fin-td">{a.name}<span className="fin-td-sub">{asCat(a.category)}{a.pooled ? ' · ' + trA('as.pool', { n: a.quantity }) : ''}</span></td>
                <td className="fin-td fin-r tnum">{money(a.acquisitionCost)}</td>
                <td className="fin-td fin-r tnum">{money(a.accumulated)}</td>
                <td className="fin-td fin-r tnum">{money(a.bookValue)}</td>
                <td className="fin-td fin-r tnum">{a.status === 'aktif' ? money(a.monthlyCharge) : '—'}</td>
                <td className="fin-td fin-r tnum">{a.status === 'aktif' ? a.remainingMonths : '—'}</td>
                <td className="fin-td"><span className={`ap-badge ${a.status === 'aktif' ? 'ok' : 'default'}`}>{trA('as.st_' + a.status)}</span></td></tr>)}
              </tbody>
              <tfoot><tr className="fin-trow" style={{ fontWeight: 700 }}><td className="fin-td" colSpan={2}>{trA('as.totals')}</td><td className="fin-td fin-r tnum">{money(totals.cost)}</td><td className="fin-td fin-r tnum">{money(totals.accumulated)}</td><td className="fin-td fin-r tnum">{money(totals.bookValue)}</td><td className="fin-td fin-r tnum">{money(totals.monthlyCharge)}</td><td className="fin-td" colSpan={2} /></tr></tfoot>
            </table></div>)}
        </div>
        {form && <AssetForm onClose={() => setForm(false)} onDone={() => { setForm(false); q.reload(); flash(trA('as.saved')); }} />}
        {imp && <AssetImport onClose={() => setImp(false)} onDone={(n) => { setImp(false); q.reload(); flash(trA('as.importDone', { n })); }} />}
        {detail && <AssetDetail id={detail} canRun={canRun} onClose={() => setDetail(null)} onChanged={() => q.reload()} />}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  function AssetForm({ onClose, onDone }) {
    const [f, setF] = aS({ code: '', name: '', category: 'peralatan', acquisitionDate: todayISO(), acquisitionCost: '', salvageValue: '', usefulLifeMonths: '', method: 'garis_lurus', isProduction: false, pooled: false, quantity: '', note: '' });
    const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const set = (k, v) => setF({ ...f, [k]: v });
    const pooled = f.pooled || f.category === 'galon';
    const valid = f.code.trim() && f.name.trim() && f.acquisitionDate && +f.acquisitionCost > 0 && +f.usefulLifeMonths > 0 && (!pooled || +f.quantity > 0);
    const submit = async () => {
      if (!valid || busy) return; setBusy(true); setErr('');
      try { await ACC().assetCreate({ code: f.code.trim(), name: f.name.trim(), category: f.category, acquisitionDate: f.acquisitionDate, acquisitionCost: +f.acquisitionCost, salvageValue: +f.salvageValue || 0, usefulLifeMonths: +f.usefulLifeMonths, method: f.method, isProduction: !!f.isProduction, pooled, quantity: +f.quantity || 1, note: f.note.trim() }); onDone(); }
      catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
    };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('as.new')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-warnbox"><IconWarn s={16} /><span>{trA('as.taxNote')}</span></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('as.fCode')} *</label><input className="fld" value={f.code} onChange={(e) => set('code', e.target.value)} /></div><div style={{ flex: 2 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('as.fName')} *</label><input className="fld" value={f.name} onChange={(e) => set('name', e.target.value)} /></div></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fCat')}</label><select className="fld" value={f.category} onChange={(e) => set('category', e.target.value)}>{AS_CATS.map((c) => <option key={c} value={c}>{asCat(c)}</option>)}</select></div><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fDate')} *</label><input type="date" className="fld" value={f.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)} /></div></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fCost')} *</label>{rpInput(f.acquisitionCost, (v) => set('acquisitionCost', v))}</div><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fSalvage')}</label>{rpInput(f.salvageValue, (v) => set('salvageValue', v))}</div></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fLife')} *</label><input className="fld tnum" inputMode="numeric" value={f.usefulLifeMonths} onChange={(e) => set('usefulLifeMonths', e.target.value.replace(/\D/g, ''))} /></div><div style={{ flex: 1 }}><label className="fld-label">{trA('as.fMethod')}</label><select className="fld" value={f.method} onChange={(e) => set('method', e.target.value)}>{AS_METHODS.map((m) => <option key={m} value={m}>{trA('as.m_' + m)}</option>)}</select></div></div>
          {pooled && <div><label className="fld-label">{trA('as.fQty')} *</label><input className="fld tnum" inputMode="numeric" value={f.quantity} onChange={(e) => set('quantity', e.target.value.replace(/\D/g, ''))} /><div className="cap-desc">{trA('as.poolHint')}</div></div>}
          <label className="ap-issue" style={{ marginTop: 10 }}><input type="checkbox" checked={f.isProduction} onChange={(e) => set('isProduction', e.target.checked)} /><span>{trA('as.fProd')}</span></label>
          <label className="fld-label">{trA('as.fNote')}</label><input className="fld" value={f.note} onChange={(e) => set('note', e.target.value)} />
          {err && <div className="add-err"><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('sb.save')}</button></div>
      </div></div>
    );
  }

  function AssetDetail({ id, canRun, onClose, onChanged }) {
    const q = useAcct(() => ACC().assetGet(id), [id]);
    const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const [disp, setDisp] = aS(null); const [poolQty, setPoolQty] = aS(''); const [recon, setRecon] = aS(null);
    const a = q.data || {};
    const doDispose = async () => {
      if (!disp || busy) return; setBusy('d'); setErr('');
      try { await ACC().assetDispose(id, { disposalDate: disp.date, disposalProceeds: +disp.proceeds || 0, status: disp.status }); onChanged(); q.reload(); setDisp(null); }
      catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
    };
    const doReconcile = async () => { setBusy('r'); try { const r = await ACC().gallonPoolReconcile(id); setRecon(r.data); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    const doPoolLoss = async () => { if (!(+poolQty > 0) || busy) return; setBusy('l'); setErr(''); try { await ACC().gallonPoolLoss(id, { qty: +poolQty, kind: 'rusak' }); setPoolQty(''); onChanged(); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{a.code} · {a.name}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{asCat(a.category)} · {trA('as.st_' + (a.status || 'aktif'))}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {q.state !== 'ready' ? <Skeleton n={5} /> : <>
            <div className="dist-cd-stats" style={{ marginBottom: 10 }}>
              <div><div className="dist-cd-slbl">{trA('as.colCost')}</div><div className="dist-cd-sval">{money(a.acquisitionCost)}</div></div>
              <div><div className="dist-cd-slbl">{trA('as.colAccum')}</div><div className="dist-cd-sval">{money(a.accumulated)}</div></div>
              <div><div className="dist-cd-slbl">{trA('as.colBook')}</div><div className="dist-cd-sval">{money(a.bookValue)}</div></div>
            </div>
            <div className="dist-hint" style={{ marginBottom: 10 }}><b>{trA('as.formula')}:</b> {a.methodFormula} · {trA('as.firstMonth_' + (a.firstMonth || 'full'))}</div>
            {a.pooled && (
              <div className="card" style={{ padding: 12, marginBottom: 10 }}>
                <div className="sec-title" style={{ fontSize: 13 }}>{trA('as.poolTitle')}</div>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={doReconcile}>{trA('as.reconcile')}</button>
                {recon && <div className="dist-hint" style={{ marginTop: 8 }}>{trA('as.poolQty')}: <b>{recon.poolQuantity}</b> · {trA('as.ledgerOwned')}: <b>{recon.totalOwned}</b> · {trA('as.ledgerDimiliki')}: <b>{recon.totalDimiliki}</b> · {trA('as.drift')}: <b className={recon.drift === 0 ? 'amt-pos' : 'amt-neg'}>{recon.drift}</b></div>}
                {canRun && a.status === 'aktif' && <div className="dist-form-row" style={{ marginTop: 8 }}><div style={{ flex: 1 }}><input className="fld tnum" inputMode="numeric" placeholder={trA('as.lossQty')} value={poolQty} onChange={(e) => setPoolQty(e.target.value.replace(/\D/g, ''))} /></div><button className="btn btn-ghost btn-sm danger" disabled={!(+poolQty > 0) || !!busy} onClick={doPoolLoss}>{trA('as.poolLoss')}</button></div>}
              </div>
            )}
            <div className="sec-title" style={{ fontSize: 13, marginBottom: 6 }}>{trA('as.schedule')}</div>
            <div className="fin-tablewrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="fin-table"><thead><tr><th className="fin-th">{trA('as.period')}</th><th className="fin-th fin-r">{trA('as.charge')}</th><th className="fin-th fin-r">{trA('as.colAccum')}</th><th className="fin-th fin-r">{trA('as.colBook')}</th><th className="fin-th" /></tr></thead>
              <tbody>{(a.schedule || []).map((r) => <tr key={r.period} className="fin-trow"><td className="fin-td">{r.period}</td><td className="fin-td fin-r tnum">{money(r.charge)}</td><td className="fin-td fin-r tnum">{money(r.accumulated)}</td><td className="fin-td fin-r tnum">{money(r.bookValue)}</td><td className="fin-td">{r.posted ? <span className="ap-badge ok">{trA('as.postedBadge')}</span> : <span className="ap-badge default">{trA('as.future')}</span>}</td></tr>)}</tbody>
            </table></div>
            {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
            {canRun && a.status === 'aktif' && !disp && <button className="btn btn-ghost btn-sm danger" style={{ marginTop: 10 }} onClick={() => setDisp({ date: todayISO(), proceeds: '', status: 'dijual' })}>{trA('as.dispose')}</button>}
            {disp && (
              <div className="card" style={{ padding: 12, marginTop: 10 }}>
                <div className="sec-title" style={{ fontSize: 13 }}>{trA('as.dispose')}</div>
                <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('as.dispDate')}</label><input type="date" className="fld" value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} /></div><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('as.dispProceeds')}</label>{rpInput(disp.proceeds, (v) => setDisp({ ...disp, proceeds: v }))}</div><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('as.dispStatus')}</label><select className="fld" value={disp.status} onChange={(e) => setDisp({ ...disp, status: e.target.value })}>{['dijual', 'dilepas', 'rusak'].map((s) => <option key={s} value={s}>{trA('as.st_' + s)}</option>)}</select></div></div>
                <div className="modal-foot" style={{ padding: '8px 0 0' }}><button className="btn btn-ghost" onClick={() => setDisp(null)}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!!busy} onClick={doDispose}>{busy === 'd' ? '…' : trA('as.disposeBtn')}</button></div>
              </div>
            )}
          </>}
        </div>
      </div></div>
    );
  }

  function AssetImport({ onClose, onDone }) {
    const [text, setText] = aS(''); const [preview, setPreview] = aS(null); const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const parseCsv = (raw) => {
      const lines = String(raw || '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return [];
      const split = (l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const head = split(lines[0]).map((h) => h.toLowerCase());
      return lines.slice(1).map((l) => { const cells = split(l); const o = {}; head.forEach((h, i) => { o[h] = cells[i] || ''; }); return o; });
    };
    const doPreview = async () => { setBusy(true); setErr(''); try { const rows = parseCsv(text); const r = await ACC().assetsImportPreview({ rows }); setPreview(r.data); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    const doCommit = async () => { setBusy(true); setErr(''); try { const rows = parseCsv(text); const r = await ACC().assetsImportCommit({ rows }); onDone((r.data && r.data.created) || 0); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    const tmpl = () => { const csv = 'kode,nama,kategori,tanggal,harga,nilai_sisa,umur_bulan,metode,produksi\nAST-001,Mesin RO,mesin_ro,2025-01-15,60000000,0,60,garis_lurus,ya\n'; const bl = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(bl); const el = document.createElement('a'); el.href = url; el.download = 'template-aset.csv'; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const onFile = (e) => { const file = e.target.files && e.target.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = () => setText(String(rd.result || '')); rd.readAsText(file); };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('as.import')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-hint" style={{ marginBottom: 8 }}>{trA('as.importHint')} <button className="dist-link" onClick={tmpl}>{trA('as.template')}</button></div>
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ marginBottom: 8 }} />
          <textarea className="fld" style={{ height: 90, fontFamily: 'monospace', fontSize: 12 }} placeholder="kode,nama,kategori,tanggal,harga,nilai_sisa,umur_bulan,metode,produksi" value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn btn-ghost" disabled={!text.trim() || busy} onClick={doPreview}>{trA('as.preview')}</button></div>
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
          {preview && <>
            <div className="dist-hint" style={{ margin: '10px 0' }}>{trA('as.previewSummary', { ok: preview.validCount, bad: preview.invalidCount, total: preview.total })}</div>
            <div className="fin-tablewrap" style={{ maxHeight: 300, overflow: 'auto' }}><table className="fin-table"><thead><tr><th className="fin-th">#</th><th className="fin-th">{trA('as.colCode')}</th><th className="fin-th">{trA('as.colName')}</th><th className="fin-th fin-r">{trA('as.colCost')}</th><th className="fin-th">{trA('as.status')}</th></tr></thead>
              <tbody>{preview.rows.map((r) => <tr key={r.srcRow} className="fin-trow"><td className="fin-td">{r.srcRow}</td><td className="fin-td">{r.code || '—'}</td><td className="fin-td">{r.name || '—'}</td><td className="fin-td fin-r tnum">{money(r.acquisitionCost)}</td><td className="fin-td">{r.valid ? <span className="ap-badge ok">OK</span> : <span className="ap-badge bad" title={r.errors.join(', ')}>{r.errors[0]}</span>}</td></tr>)}</tbody>
            </table></div>
          </>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={busy || !(preview && preview.validCount > 0)} onClick={doCommit}>{busy ? '…' : trA('as.importCommit', { n: (preview && preview.validCount) || 0 })}</button></div>
      </div></div>
    );
  }

  // ── HPP / PRODUCT COSTING — cost standards (versioned, approval-activated), production runs with
  // variance analysis, the variance report, and margin / break-even support. ──
  const PC_CATS = ['bahan_langsung', 'tenaga_kerja', 'overhead_variabel', 'overhead_tetap'];
  const VAR_META = [['price', 'pc.vPrice'], ['qty', 'pc.vQty'], ['rate', 'pc.vRate'], ['eff', 'pc.vEff'], ['spending', 'pc.vSpending'], ['volume', 'pc.vVolume']];
  const varTag = (amt) => amt === 0 ? <span className="ap-badge default">—</span> : amt > 0 ? <span className="pc-var-bad">{trA('pc.unfav')} {money(amt)}</span> : <span className="pc-var-good">{trA('pc.fav')} {money(-amt)}</span>;

  function CostingScreen({ canRun }) {
    const [tab, setTab] = aS('standar');
    const tabs = [['standar', 'pc.tabStd'], ['produksi', 'pc.tabRun'], ['selisih', 'pc.tabVar'], ['margin', 'pc.tabMargin']];
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finCosting')}</h2><div className="fin-head-scope">{trA('s.finCosting')}</div></div></div>
        <ScreenIntro answers={trA('pc.answers')} extra={trA('pc.taxNote')} tone="warn" />
        <div className="gran-seg" style={{ marginBottom: 12 }}>{tabs.map(([k, l]) => <button key={k} className={`gran-btn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{trA(l)}</button>)}</div>
        {tab === 'standar' && <StandardsTab canRun={canRun} />}
        {tab === 'produksi' && <RunsTab canRun={canRun} />}
        {tab === 'selisih' && <VarianceTab canRun={canRun} />}
        {tab === 'margin' && <MarginTab />}
      </div>
    );
  }

  function StandardsTab({ canRun }) {
    const [form, setForm] = aS(false); const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const q = useAcct(() => ACC().costStandards(), []);
    if (q.state === 'gated') return <GatedCard icon="IconInvoice" body={trA('sb.soon')} />;
    const data = (q.data && q.data.data) || [];
    const activate = async (id) => { setBusy(id); setErr(''); try { await ACC().costStandardActivate(id, {}); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    return (
      <div>
        {canRun && <div style={{ marginBottom: 10 }}><button className="btn btn-primary" onClick={() => setForm(true)}>{IcA('IconPlus', { s: 16 })}{trA('pc.newStd')}</button></div>}
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="card">
          {q.state === 'loading' && <Skeleton n={4} />}
          {q.state === 'ready' && (data.length === 0
            ? <EmptyState title={trA('pc.emptyStdT')} body={trA('pc.emptyStdB')} icon="IconInvoice" actionLabel={canRun ? trA('pc.newStd') : null} onAction={canRun ? () => setForm(true) : null} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">v</th><th className="fin-th">{trA('pc.effFrom')}</th><th className="fin-th fin-r">{trA('pc.normalVol')}</th><th className="fin-th fin-r">{trA('pc.perUnit')}</th><th className="fin-th">{trA('pc.status')}</th><th className="fin-th" /></tr></thead>
              <tbody>{data.map((s) => <tr key={s.id} className="fin-trow"><td className="fin-td">v{s.version}</td><td className="fin-td">{s.effectiveFrom}{s.effectiveTo ? ' → ' + s.effectiveTo : ''}</td><td className="fin-td fin-r tnum">{s.normalVolume}</td><td className="fin-td fin-r tnum">{money(s.perUnit)}</td>
                <td className="fin-td"><span className={`ap-badge ${s.status === 'aktif' ? 'ok' : s.status === 'draft' ? 'warn' : 'default'}`}>{trA('pc.st_' + s.status)}</span></td>
                <td className="fin-td fin-r">{canRun && s.status === 'draft' && <button className="btn btn-ghost btn-xs" disabled={!!busy} onClick={() => activate(s.id)}>{IcA('IconLock', { s: 12 })}{trA('pc.activate')}</button>}</td></tr>)}</tbody>
            </table></div>)}
        </div>
        {form && <StandardForm onClose={() => setForm(false)} onDone={() => { setForm(false); q.reload(); }} />}
      </div>
    );
  }
  function StandardForm({ onClose, onDone }) {
    const [f, setF] = aS({ effectiveFrom: todayISO(), normalVolume: '', note: '' });
    const [lines, setLines] = aS([{ component: 'air_baku', category: 'bahan_langsung', qtyPerUnit: '1', unit: 'galon', unitCost: '', chartCode: '6-3000' }]);
    const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const setL = (i, k, v) => setLines(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
    const perUnit = lines.reduce((s, l) => s + Math.round((+l.qtyPerUnit || 0) * (+l.unitCost || 0)), 0);
    const valid = f.effectiveFrom && +f.normalVolume > 0 && lines.length && lines.every((l) => l.component && +l.unitCost >= 0);
    const submit = async () => { if (!valid || busy) return; setBusy(true); setErr(''); try { await ACC().costStandardCreate({ effectiveFrom: f.effectiveFrom, normalVolume: +f.normalVolume, note: f.note, lines: lines.map((l) => ({ component: l.component, category: l.category, qtyPerUnit: +l.qtyPerUnit || 0, unit: l.unit, unitCost: +l.unitCost || 0, chartCode: l.chartCode })) }); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('pc.newStd')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-warnbox"><IconWarn s={16} /><span>{trA('pc.taxNote')}</span></div>
          <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('pc.effFrom')} *</label><input type="date" className="fld" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('pc.normalVol')} *</label><input className="fld tnum" inputMode="numeric" value={f.normalVolume} onChange={(e) => setF({ ...f, normalVolume: e.target.value.replace(/\D/g, '') })} /><div className="cap-desc">{trA('pc.normalHint')}</div></div></div>
          <div className="sec-title" style={{ fontSize: 13, margin: '12px 0 6px' }}>{trA('pc.components')} · {trA('pc.perUnit')}: <b className="tnum">{money(perUnit)}</b></div>
          {lines.map((l, i) => (
            <div key={i} className="dist-form-row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 2 }}><input className="fld" placeholder={trA('pc.component')} value={l.component} onChange={(e) => setL(i, 'component', e.target.value)} /></div>
              <div style={{ flex: 2 }}><select className="fld" value={l.category} onChange={(e) => setL(i, 'category', e.target.value)}>{PC_CATS.map((c) => <option key={c} value={c}>{trA('pc.cat_' + c)}</option>)}</select></div>
              <div style={{ flex: 1 }}><input className="fld tnum" placeholder={trA('pc.qtyU')} value={l.qtyPerUnit} onChange={(e) => setL(i, 'qtyPerUnit', e.target.value.replace(/[^\d.]/g, ''))} /></div>
              <div style={{ flex: 1 }}>{rpInput(l.unitCost, (v) => setL(i, 'unitCost', v))}</div>
              <div style={{ flex: 2 }}><AcctSelect value={l.chartCode} onChange={(v) => setL(i, 'chartCode', v)} /></div>
              <button className="jp-icon" onClick={() => setLines(lines.filter((_, j) => j !== i))}><IconClose s={16} /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setLines([...lines, { component: '', category: 'overhead_variabel', qtyPerUnit: '1', unit: '', unitCost: '', chartCode: '6-9000' }])}>{IcA('IconPlus', { s: 14 })}{trA('pc.addLine')}</button>
          {err && <div className="add-err"><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('sb.save')}</button></div>
      </div></div>
    );
  }

  function RunsTab({ canRun }) {
    const [form, setForm] = aS(false); const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const q = useAcct(() => ACC().productionRuns(), []);
    if (q.state === 'gated') return <GatedCard icon="IconRefresh" body={trA('sb.soon')} />;
    const data = (q.data && q.data.data) || [];
    const complete = async (id) => { setBusy(id); setErr(''); try { await ACC().productionRunComplete(id); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    return (
      <div>
        {canRun && <div style={{ marginBottom: 10 }}><button className="btn btn-primary" onClick={() => setForm(true)}>{IcA('IconPlus', { s: 16 })}{trA('pc.newRun')}</button></div>}
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="card">
          {q.state === 'loading' && <Skeleton n={4} />}
          {q.state === 'ready' && (data.length === 0
            ? <EmptyState title={trA('pc.emptyRunT')} body={trA('pc.emptyRunB')} icon="IconRefresh" actionLabel={canRun ? trA('pc.newRun') : null} onAction={canRun ? () => setForm(true) : null} />
            : <div className="pc-runs">{data.map((r) => (
              <div key={r.id} className="card pc-run">
                <div className="pc-run-head"><b>{r.date}</b> · {trA('pc.produced', { n: r.unitsProduced })}<span style={{ flex: 1 }} /><span className={`ap-badge ${r.status === 'selesai' ? 'ok' : 'warn'}`}>{trA('pc.rst_' + r.status)}</span>{canRun && r.status === 'draft' && <button className="btn btn-primary btn-xs" disabled={!!busy} onClick={() => complete(r.id)} style={{ marginLeft: 8 }}>{trA('pc.complete')}</button>}</div>
                {r.variances && <div className="pc-vargrid">{VAR_META.map(([k, lbl]) => <div key={k} className="pc-varcell"><span className="pc-varlbl">{trA(lbl)}</span>{varTag(r.variances[k])}</div>)}</div>}
              </div>
            ))}</div>)}
        </div>
        {form && <RunForm onClose={() => setForm(false)} onDone={() => { setForm(false); q.reload(); }} />}
      </div>
    );
  }
  function RunForm({ onClose, onDone }) {
    const sq = useAcct(() => ACC().costStandards({ status: 'aktif' }), []);
    const stds = (sq.data && sq.data.data) || [];
    const [f, setF] = aS({ date: todayISO(), unitsProduced: '', standardId: '' });
    const [inputs, setInputs] = aS([]);
    const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    aEf(() => { if (stds.length && !f.standardId) { const s = stds[0]; setF((x) => ({ ...x, standardId: s.id })); setInputs(s.lines.map((l) => ({ component: l.component, category: l.category, actualQty: '', actualCost: '', chartCode: l.chartCode }))); } }, [stds.length]);
    const setI = (i, k, v) => setInputs(inputs.map((x, j) => j === i ? { ...x, [k]: v } : x));
    const valid = f.date && +f.unitsProduced > 0 && f.standardId;
    const submit = async () => { if (!valid || busy) return; setBusy(true); setErr(''); try { await ACC().productionRunCreate({ date: f.date, unitsProduced: +f.unitsProduced, standardId: f.standardId, inputs: inputs.map((i) => ({ component: i.component, category: i.category, actualQty: +i.actualQty || 0, actualCost: +i.actualCost || 0, chartCode: i.chartCode })) }); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 700, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('pc.newRun')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {stds.length === 0 ? <div className="dist-warnbox"><IconWarn s={16} /><span>{trA('pc.noActiveStd')}</span></div> : <>
            <div className="dist-form-row"><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('pc.date')} *</label><input type="date" className="fld" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div><div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trA('pc.produced_l')} *</label><input className="fld tnum" inputMode="numeric" value={f.unitsProduced} onChange={(e) => setF({ ...f, unitsProduced: e.target.value.replace(/\D/g, '') })} /></div></div>
            <div className="sec-title" style={{ fontSize: 13, margin: '12px 0 6px' }}>{trA('pc.actualInputs')}</div>
            {inputs.map((i, idx) => (
              <div key={idx} className="dist-form-row" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: 2 }}><input className="fld" value={i.component} onChange={(e) => setI(idx, 'component', e.target.value)} /></div>
                <div style={{ flex: 1 }}><input className="fld tnum" placeholder={trA('pc.actualQty')} value={i.actualQty} onChange={(e) => setI(idx, 'actualQty', e.target.value.replace(/[^\d.]/g, ''))} /></div>
                <div style={{ flex: 1 }}>{rpInput(i.actualCost, (v) => setI(idx, 'actualCost', v))}</div>
                <div style={{ flex: 2 }}><AcctSelect value={i.chartCode} onChange={(v) => setI(idx, 'chartCode', v)} /></div>
              </div>
            ))}
            {err && <div className="add-err"><IconClose s={14} />{err}</div>}
          </>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? '…' : trA('pc.saveRun')}</button></div>
      </div></div>
    );
  }

  function VarianceTab({ canRun }) {
    const now = todayISO();
    const [ym, setYm] = aS(now.slice(0, 7));
    const [Y, M] = ym.split('-').map(Number);
    const [busy, setBusy] = aS(false); const [err, setErr] = aS('');
    const q = useAcct(() => ACC().varianceReport({ year: Y, month: M }), [ym]);
    const lq = useAcct(() => ACC().costingGallonLoss({ year: Y, month: M }), [ym]);
    const data = q.data || {}; const rows = data.rows || [];
    const close = async () => { setBusy(true); setErr(''); try { await ACC().closeVariances({ year: Y, month: M }); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
    return (
      <div>
        <div className="rep-controls" style={{ marginBottom: 10 }}><input type="month" className="fld tp-month" value={ym} max={now.slice(0, 7)} onChange={(e) => setYm(e.target.value)} />{canRun && <button className="btn btn-ghost" disabled={busy} onClick={close}>{IcA('IconLock', { s: 15 })}{trA('pc.closeVar')}</button>}</div>
        <div className="dist-hint" style={{ marginBottom: 10 }}>{trA('pc.closePolicy')}</div>
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="card">
          {q.state === 'loading' ? <Skeleton n={6} /> : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('pc.variance')}</th><th className="fin-th">{trA('pc.account')}</th><th className="fin-th fin-r">{trA('pc.result')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.code} className="fin-trow"><td className="fin-td">{r.name}</td><td className="fin-td">{r.code}</td><td className="fin-td fin-r">{varTag(r.amount)}</td></tr>)}</tbody>
            <tfoot><tr className="fin-trow" style={{ fontWeight: 700 }}><td className="fin-td" colSpan={2}>{trA('pc.totalVar')}</td><td className="fin-td fin-r">{varTag(data.total || 0)}</td></tr></tfoot>
          </table></div>}
        </div>
        {lq.state === 'ready' && lq.data && (
          <div className="card" style={{ marginTop: 12, padding: 14 }}>
            <div className="sec-title" style={{ fontSize: 13 }}>{trA('pc.gallonLoss')}</div>
            <div className="dist-hint">{trA('pc.costingQty')}: <b>{lq.data.costingQty}</b> · {trA('pc.ledgerQty')}: <b>{lq.data.ledgerQty}</b> · {trA('pc.drift')}: <b className={lq.data.drift === 0 ? 'amt-pos' : 'amt-neg'}>{lq.data.drift}</b></div>
          </div>
        )}
      </div>
    );
  }

  function MarginTab() {
    const q = useAcct(() => ACC().marginAnalysis(), []);
    const iq = useAcct(() => ACC().costingInventory(), []);
    const d = q.data || {}; const segs = d.segments || [];
    return (
      <div>
        <div className="dist-hint" style={{ marginBottom: 10 }}>{trA('pc.priceNote')}</div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="sec-title" style={{ padding: '10px 14px 0' }}>{trA('pc.marginTitle')} · {trA('pc.hppUnit')}: <b className="tnum">{money(d.hppPerUnit || 0)}</b></div>
          {q.state === 'loading' ? <Skeleton n={3} /> : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('pc.segment')}</th><th className="fin-th fin-r">{trA('pc.avgPrice')}</th><th className="fin-th fin-r">{trA('pc.hpp')}</th><th className="fin-th fin-r">{trA('pc.margin')}</th><th className="fin-th fin-r">%</th></tr></thead>
            <tbody>{segs.map((s) => <tr key={s.type} className="fin-trow"><td className="fin-td">{s.type}</td><td className="fin-td fin-r tnum">{money(s.avgPrice)}</td><td className="fin-td fin-r tnum">{money(s.hpp)}</td><td className="fin-td fin-r tnum" style={{ color: s.margin >= 0 ? 'var(--green-700)' : 'var(--neg)' }}>{money(s.margin)}</td><td className="fin-td fin-r tnum">{s.marginPct}%</td></tr>)}</tbody>
          </table></div>}
          <div className="dist-hint" style={{ padding: '8px 14px 12px' }}>{trA('pc.breakEven')}: <b>{d.breakEvenVolume != null ? d.breakEvenVolume + ' galon/bulan' : '—'}</b> ({trA('pc.normalVol')}: {d.normalVolume || '—'})</div>
        </div>
        {iq.state === 'ready' && iq.data && <div className="card" style={{ padding: 14 }}><div className="sec-title" style={{ fontSize: 13 }}>{trA('pc.inventory')}</div><div className="dist-hint">{trA('pc.invQty')}: <b>{iq.data.qty}</b> ({trA('as.ledgerOwned')} depot+armada) · {trA('pc.invValue')}: <b className="tnum">{money(iq.data.value)}</b></div></div>}
      </div>
    );
  }

  // ── PAYROLL (accrual, double-entry) — period list, per-employee worksheet with inline draft editing,
  // an approval view showing totals + the production/operating split, payment, and a printable payslip. ──
  const PST = { draft: 'warn', disetujui: 'ok', dibayar: 'ok', batal: 'default' };
  function PayrollAccrualScreen({ canRun, canApprove }) {
    const [open, setOpen] = aS(null); const [form, setForm] = aS(false); const [busy, setBusy] = aS(''); const [err, setErr] = aS('');
    const q = useAcct(() => ACC2().periods(), []);
    if (q.state === 'gated') return <GatedCard icon="IconCustomers" body={trA('sb.soon')} />;
    const data = (q.data && q.data.data) || [];
    if (open) return <PayrollDetail id={open} canRun={canRun} canApprove={canApprove} onBack={() => { setOpen(null); q.reload(); }} />;
    const create = async (y, m) => { setBusy('c'); setErr(''); try { const r = await ACC2().periodCreate({ year: y, month: m }); setForm(false); q.reload(); setOpen(r.data.id); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    return (
      <div className="screen-enter fin-scope">
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finPayroll')}</h2><div className="fin-head-scope">{trA('s.finPayroll')}</div></div>
          {canRun && <div className="fin-head-actions"><button className="btn btn-primary" onClick={() => setForm(true)}>{IcA('IconPlus', { s: 16 })}{trA('py.new')}</button></div>}
        </div>
        <ScreenIntro answers={trA('py.answers')} extra={trA('py.taxNote')} tone="warn" />
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="card">
          {q.state === 'loading' && <Skeleton n={4} />}
          {q.state === 'ready' && (data.length === 0
            ? <EmptyState title={trA('py.emptyT')} body={trA('py.emptyB')} icon="IconCustomers" actionLabel={canRun ? trA('py.new') : null} onAction={canRun ? () => setForm(true) : null} />
            : <div className="fin-tablewrap"><table className="fin-table"><thead><tr><th className="fin-th">{trA('py.period')}</th><th className="fin-th fin-r">{trA('py.staff')}</th><th className="fin-th fin-r">{trA('py.net')}</th><th className="fin-th">{trA('py.status')}</th><th className="fin-th" /></tr></thead>
              <tbody>{data.map((p) => <tr key={p.id} className="fin-trow" style={{ cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
                <td className="fin-td">{p.period}</td><td className="fin-td fin-r tnum">{p.totals.count}</td><td className="fin-td fin-r tnum">{money(p.totals.net)}</td>
                <td className="fin-td"><span className={`ap-badge ${PST[p.status] || 'default'}`}>{trA('py.st_' + p.status)}</span>{p.selfApproved ? <span className="cr-selfbadge" style={{ marginLeft: 6 }}>{trA('cr.selfApprovedBadge')}</span> : ''}</td>
                <td className="fin-td fin-r">{IcA('IconCaret', { s: 15 })}</td></tr>)}</tbody>
            </table></div>)}
        </div>
        {form && <PayrollNewForm busy={busy} onClose={() => setForm(false)} onCreate={create} />}
      </div>
    );
  }
  function PayrollNewForm({ busy, onClose, onCreate }) {
    const now = todayISO(); const [ym, setYm] = aS(now.slice(0, 7));
    const [Y, M] = ym.split('-').map(Number);
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}><div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trA('py.new')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body"><label className="fld-label" style={{ marginTop: 0 }}>{trA('py.period')}</label><input type="month" className="fld" value={ym} max={now.slice(0, 7)} onChange={(e) => setYm(e.target.value)} /><div className="cap-desc" style={{ marginTop: 6 }}>{trA('py.newHint')}</div></div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trA('common.cancel')}</button><button className="btn btn-primary" disabled={busy === 'c'} onClick={() => onCreate(Y, M)}>{busy === 'c' ? '…' : trA('py.build')}</button></div>
      </div></div>
    );
  }
  function PayrollDetail({ id, canRun, canApprove, onBack }) {
    const q = useAcct(() => ACC2().period(id), [id]);
    const [busy, setBusy] = aS(''); const [err, setErr] = aS(''); const [slip, setSlip] = aS(null);
    const p = q.data || {}; const t = p.totals || {}; const draft = p.status === 'draft';
    const edit = async (lineId, patch) => { setBusy(lineId); setErr(''); try { await ACC2().lineUpdate(lineId, patch); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    const act = async (fn) => { setBusy('a'); setErr(''); try { await fn(); q.reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); } };
    return (
      <div className="screen-enter fin-scope">
        <button className="dist-back no-print" onClick={onBack}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trA('py.back')}</button>
        <div className="fin-head"><div className="fin-head-titles"><h2>{trA('t.finPayroll')} · {p.period}</h2><div className="fin-head-scope"><span className={`ap-badge ${PST[p.status] || 'default'}`}>{trA('py.st_' + (p.status || 'draft'))}</span>{p.approvedByName ? ' · ' + trA('py.approvedBy', { who: p.approvedByName }) : ''}</div></div>
          <div className="fin-head-actions">
            {canApprove && draft && <button className="btn btn-primary" disabled={!!busy} onClick={() => act(() => ACC2().approve(id))}>{IcA('IconLock', { s: 15 })}{trA('py.approve')}</button>}
            {canRun && p.status === 'disetujui' && <button className="btn btn-primary" disabled={!!busy} onClick={() => act(() => ACC2().pay(id, { account: 'bank' }))}>{IcA('IconCoinIn', { s: 15 })}{trA('py.pay')}</button>}
          </div>
        </div>
        {err && <div className="add-err" style={{ marginBottom: 10 }}><IconClose s={14} />{err}</div>}
        <div className="dist-cd-stats" style={{ marginBottom: 12 }}>
          <div><div className="dist-cd-slbl">{trA('py.gross')}</div><div className="dist-cd-sval">{money(t.gross || 0)}</div></div>
          <div><div className="dist-cd-slbl">{trA('py.net')}</div><div className="dist-cd-sval">{money(t.net || 0)}</div></div>
          <div><div className="dist-cd-slbl">{trA('py.splitProd')}</div><div className="dist-cd-sval" style={{ color: '#7c3aed' }}>{money(t.prodGross || 0)}</div></div>
          <div><div className="dist-cd-slbl">{trA('py.splitOpex')}</div><div className="dist-cd-sval">{money(t.opexGross || 0)}</div></div>
        </div>
        <div className="card">
          {q.state !== 'ready' ? <Skeleton n={6} /> : <div className="fin-tablewrap"><table className="fin-table"><thead><tr>
            <th className="fin-th">{trA('py.employee')}</th><th className="fin-th fin-r">{trA('py.basic')}</th><th className="fin-th fin-r">{trA('py.ot')}</th><th className="fin-th fin-r">{trA('py.bonus')}</th><th className="fin-th fin-r">{trA('py.allow')}</th><th className="fin-th fin-r">{trA('py.ded')}</th><th className="fin-th fin-r">{trA('py.cashbon')}</th><th className="fin-th fin-r">{trA('py.net')}</th><th className="fin-th">{trA('py.prod')}</th><th className="fin-th" /></tr></thead>
            <tbody>{(p.lines || []).map((l) => <tr key={l.id} className="fin-trow">
              <td className="fin-td">{l.employeeName}</td>
              <td className="fin-td fin-r tnum">{money(l.basicSalary)}</td>
              <td className="fin-td fin-r tnum">{draft && canRun ? <input className="fld tnum py-inp" value={l.overtime || ''} onChange={(e) => edit(l.id, { overtime: +e.target.value.replace(/\D/g, '') || 0 })} /> : money(l.overtime)}</td>
              <td className="fin-td fin-r tnum">{draft && canRun ? <input className="fld tnum py-inp" value={l.bonus || ''} onChange={(e) => edit(l.id, { bonus: +e.target.value.replace(/\D/g, '') || 0 })} /> : money(l.bonus)}</td>
              <td className="fin-td fin-r tnum">{money(l.allowancesTotal)}</td>
              <td className="fin-td fin-r tnum">{money(l.deductionsTotal)}</td>
              <td className="fin-td fin-r tnum">{draft && canRun ? <input className="fld tnum py-inp" value={l.cashbonDeduction || ''} title={trA('py.outstanding', { amt: money(l.cashbonOutstanding || 0) })} onChange={(e) => edit(l.id, { cashbonDeduction: +e.target.value.replace(/\D/g, '') || 0 })} /> : money(l.cashbonDeduction)}</td>
              <td className="fin-td fin-r tnum"><b>{money(l.netPay)}</b></td>
              <td className="fin-td">{draft && canRun ? <input type="checkbox" checked={l.isProduction} onChange={(e) => edit(l.id, { isProduction: e.target.checked })} /> : (l.isProduction ? <span className="ap-badge ok">COGS</span> : '—')}</td>
              <td className="fin-td fin-r"><button className="dist-link" onClick={() => setSlip(l)}>{trA('py.slip')}</button></td></tr>)}
            </tbody>
          </table></div>}
        </div>
        {slip && <PayslipModal period={p.period} line={slip} onClose={() => setSlip(null)} />}
      </div>
    );
  }
  function PayslipModal({ period, line, onClose }) {
    aEf(() => { document.body.classList.add('payslip-open'); return () => document.body.classList.remove('payslip-open'); }, []);
    const l = line;
    return (
      <div className="payslip-overlay modal-scrim" onClick={onClose} style={{ zIndex: 250 }}><div className="payslip-sheet modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head"><div><div style={{ fontSize: 18, fontWeight: 800 }}>{trA('py.slipTitle')}</div><div style={{ color: 'var(--text-mut)' }}>{period}</div></div><button className="jp-icon no-print" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="ps-body">
          <div className="ps-name">{l.employeeName}</div>
          <table className="fin-table" style={{ marginTop: 10 }}><tbody>
            <tr><td className="fin-td">{trA('py.basic')}</td><td className="fin-td fin-r tnum">{money(l.basicSalary)}</td></tr>
            <tr><td className="fin-td">{trA('py.ot')}</td><td className="fin-td fin-r tnum">{money(l.overtime)}</td></tr>
            <tr><td className="fin-td">{trA('py.bonus')}</td><td className="fin-td fin-r tnum">{money(l.bonus)}</td></tr>
            <tr><td className="fin-td">{trA('py.allow')}</td><td className="fin-td fin-r tnum">{money(l.allowancesTotal)}</td></tr>
            {(l.components || []).map((c) => <tr key={c.id}><td className="fin-td" style={{ paddingLeft: 20, color: 'var(--text-mut)' }}>· {c.name}</td><td className="fin-td fin-r tnum">{c.type === 'potongan' ? '−' : ''}{money(c.amount)}</td></tr>)}
            <tr><td className="fin-td">{trA('py.ded')}</td><td className="fin-td fin-r tnum amt-neg">−{money(l.deductionsTotal)}</td></tr>
            <tr><td className="fin-td">{trA('py.cashbon')}</td><td className="fin-td fin-r tnum amt-neg">−{money(l.cashbonDeduction)}</td></tr>
            <tr style={{ fontWeight: 800 }}><td className="fin-td">{trA('py.net')}</td><td className="fin-td fin-r tnum">{money(l.netPay)}</td></tr>
          </tbody></table>
          <div className="dist-hint" style={{ marginTop: 10 }}>{trA('py.taxNote')}</div>
        </div>
        <div className="ps-actions no-print"><button className="btn btn-primary" onClick={() => window.print()}>{IcA('IconDownload', { s: 15 })}{trA('py.print')}</button></div>
      </div></div>
    );
  }

  window.ACCT = { LedgerScreen, ReconcileScreen, CloseScreen, MappingScreen, BackfillScreen, WorkflowPanel, SubsDueCard, ReportHeader, ScreenIntro, InfoDot, PayablesScreen, AccrualScreen, SubscriptionScreen, AssetsScreen, CostingScreen, PayrollAccrualScreen };
})();
