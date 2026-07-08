/* global React, AIRRO, FS, CashflowChart, DonutChart */
const { useState: uS, useEffect: uE, useMemo: uM } = React;
const fmt = (n) => AIRRO.fmtFull(n);
const fmtS = (n) => AIRRO.fmtSigned(n);
const fmtC = (n) => AIRRO.fmtCompact(n);
function Icn(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
const trF = (k, v) => window.t(k, v);

const MONTHS_L = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] };
const DOW_L = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], id: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] };
const Mn = () => MONTHS_L[window.I18N.lang] || MONTHS_L.en;
const Dw = () => DOW_L[window.I18N.lang] || DOW_L.en;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULLMON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// "Hari ini" untuk kalender, batas tanggal, & agregasi harian.
// DEMO_TODAY: isi 'YYYY-MM-DD' untuk MEMBEKUKAN tanggal (mode demo dgn dataset
// contoh), atau null untuk pakai tanggal asli perangkat (mode produksi).
const DEMO_TODAY = null; // contoh demo: '2026-06-04'
const TODAY = DEMO_TODAY || (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; // tanggal lokal, BUKAN UTC
})();
const fmtDate = (ds) => { const d = new Date(ds + 'T00:00'); return `${Dw()[d.getDay()]}, ${d.getDate()} ${Mn()[d.getMonth()]} ${d.getFullYear()}`; };

/* ---------------- Amount input (IDR grouped) ---------------- */
function AmountInput({ value, onChange, accent, big }) {
  const disp = value ? value.toLocaleString('id-ID') : '';
  return (
    <div className="amt-input" style={{ borderColor: accent }}>
      <span className="amt-rp">Rp</span>
      <input inputMode="numeric" value={disp} placeholder="0" style={{ fontSize: big ? 30 : 20 }}
        onChange={(e) => onChange(+e.target.value.replace(/\D/g, '') || 0)} />
    </div>
  );
}

/* ---------------- Add entry form ---------------- */
function AddEntry({ onAdd, incomeCats, expenseCats, accounts }) {
  const INC = incomeCats && incomeCats.length ? incomeCats : FS.INCOME_CATS;
  const EXP = expenseCats && expenseCats.length ? expenseCats : FS.EXPENSE_CATS;
  const ACCTS = accounts && accounts.length ? accounts : [{ id: 'cash', name: 'Cash' }];
  const [type, setType] = uS('income');
  const [amount, setAmount] = uS(0);
  const [cat, setCat] = uS(INC[0].key);
  const [acct, setAcct] = uS(ACCTS[0].id);
  const [date, setDate] = uS(TODAY);
  const [note, setNote] = uS('');
  const [proof, setProof] = uS(null);
  const [gallonQty, setGallonQty] = uS(0);   // "Pembelian Galon" stock qty (expense only)
  const [err, setErr] = uS(null);
  const cats = type === 'income' ? INC : EXP;
  const accent = type === 'income' ? '#065489' : '#E5484D';

  uE(() => { if (!cats.find((c) => c.key === cat)) setCat(cats[0] && cats[0].key); }, [type, incomeCats, expenseCats]);

  const switchType = (t) => { setType(t); const list = t === 'income' ? INC : EXP; setCat(list[0] && list[0].key); };
  const catLabel = (k) => { const c = cats.find((x) => x.key === k); return c ? c.label : k; };
  const hasCat = (k) => [...INC, ...EXP].some((c) => c.key === k);
  const presets = type === 'income'
    ? [{ c: 'Refill', a: 18000, n: '1 × Galon 19L' }, { c: 'Refill', a: 90000, n: '5 × Galon 19L' }, { c: 'Bulk', a: 510000, n: '30 × Galon (bulk)' }]
    : [{ c: 'Fuel', a: 300000, n: 'Solar pengiriman' }, { c: 'Supplies', a: 850000, n: 'Galon kosong + tutup' }, { c: 'Utilities', a: 0, n: 'Listrik PLN' }];

  const MAX_AMOUNT = 1e12; // Rp 1 trillion guard
  const validate = () => {
    if (!amount || amount <= 0) return trF('val.amountPos');
    if (amount > MAX_AMOUNT) return trF('val.amountMax');
    if (!date) return trF('val.dateReq');
    if (date > TODAY) return trF('val.dateFuture');
    return null;
  };
  const submit = () => {
    const e = validate();
    if (e) { setErr(e); return; }
    setErr(null);
    const now = new Date();
    onAdd({
      id: 'e' + Date.now().toString(36), type, category: cat, amount, note: note.trim() || catLabel(cat), acct, proof,
      gallonQty: type === 'expense' ? Math.max(0, +gallonQty || 0) : 0,
      method: ACCTS.find((a) => a.id === acct) ? (ACCTS.find((a) => a.id === acct).type === 'cash' ? 'Cash' : 'Transfer') : 'Cash', date, time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
    });
    setAmount(0); setNote(''); setProof(null); setGallonQty(0);
  };

  return (
    <div className="card add-card">
      <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{trF('add.title')}</div>
      <div className="type-toggle">
        <button className={`tt-btn ${type === 'income' ? 'on inc' : ''}`} onClick={() => switchType('income')}>
          <IconCoinIn s={17} />{trF('add.income')}
        </button>
        <button className={`tt-btn ${type === 'expense' ? 'on exp' : ''}`} onClick={() => switchType('expense')}>
          <IconCoinOut s={17} />{trF('add.expense')}
        </button>
      </div>

      <label className="fld-label">{trF('add.amount')}</label>
      <AmountInput value={amount} onChange={setAmount} accent={accent} big />

      <label className="fld-label">{trF('add.category')}</label>
      <div className="cat-chips">
        {cats.map((c) => (
          <button key={c.key} className={`cat-chip ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
            {Icn(c.icon, { s: 15 })}{c.label}
          </button>
        ))}
      </div>

      <label className="fld-label">{trF('add.acct') + (type === 'income' ? ' →' : ' ←')}</label>
      <div className="cat-chips">
        {ACCTS.map((a) => (
          <button key={a.id} className={`cat-chip ${acct === a.id ? 'on' : ''}`} onClick={() => setAcct(a.id)}>
            {Icn(a.type === 'cash' ? 'IconWallet' : 'IconStore', { s: 15 })}{a.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
        <div style={{ flex: '0 0 150px' }}>
          <label className="fld-label">{trF('add.date')}</label>
          <DP.DateField value={date} max={TODAY} onChange={setDate} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="fld-label">{trF('add.note')}</label>
          <input className="fld" value={note} placeholder={trF('add.notePh')} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {type === 'expense' && (
        <div className="gal-buy">
          <label className="fld-label">{(window.t && window.t('ce.gallonQty')) || 'Pembelian Galon (jumlah)'}</label>
          <div className="gal-buy-row">
            <span className="gal-buy-ic">{Icn('IconDrop', { s: 16 })}</span>
            <input className="fld tnum" inputMode="numeric" value={gallonQty ? String(gallonQty) : ''} placeholder="0" onChange={(e) => setGallonQty(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
            <span className="gal-buy-unit">{(window.t && window.t('ce.gallonUnit')) || 'galon'}</span>
          </div>
          <div className="gal-buy-hint">{(window.t && window.t('ce.gallonHint')) || 'Isi bila ini pembelian stok galon → menambah stok depot.'}</div>
        </div>
      )}

      <div className="preset-row">
        <span style={{ fontSize: 11.5, color: 'var(--text-faint)', fontWeight: 600 }}>{trF('add.quick')}</span>
        {presets.map((p, i) => (
          <button key={i} className="preset-chip" onClick={() => { if (hasCat(p.c)) setCat(p.c); if (p.a) setAmount(p.a); setNote(p.n); }}>{p.n}</button>
        ))}
      </div>

      <label className="fld-label">{trF('att.proof')}</label>
      <UI.FileAttach value={proof} onChange={setProof} />

      {err && <div className="add-err" role="alert"><IconClose s={14} />{err}</div>}

      <button className="btn save-btn" style={{ background: accent }} onClick={submit}>
        <IconPlus s={18} />{trF(type === 'income' ? 'add.saveIncome' : 'add.saveExpense')}
      </button>
    </div>
  );
}

/* ---------------- Stat cards ---------------- */
function DeltaPillF({ delta, invert }) {
  if (delta == null) return null;
  const up = delta > 0, flat = delta === 0;
  const good = invert ? !up : up;
  return (
    <span className={`delta-pill ${flat ? 'flat' : good ? 'pos' : 'neg'}`}>
      {!flat && (up ? <IconTrendUp s={11} /> : <IconTrendDown s={11} />)}
      {up ? '+' : ''}{delta}% <em>{trF('rep.vsPrev')}</em>
    </span>
  );
}

function StatRow({ stats, seeMoney = true, deltas }) {
  const [showBd, setShowBd] = uS(false);   // Cash Balance breakdown toggle (tap/click)
  // fmt() drops the sign (abs); a cash balance CAN go negative (overspent) — show the
  // minus, but no leading '+' for positives (that's for signed deltas, not a balance).
  const balStr = (stats.balance < 0 ? '−' : '') + fmt(stats.balance);
  const all = [
    { key: 'balance', label: trF('stat.balance'), value: balStr, icon: 'IconWallet', bg: 'var(--green-800)', dark: true, neg: stats.balance < 0,
      sub: trF('stat.balanceSub'), tip: trF('stat.balanceTip'),
      bd: [[trF('stat.bdOpening'), fmt(stats.opening), null], [trF('stat.bdIn'), fmt(stats.totalIn), 'amt-pos'], [trF('stat.bdOut'), '− ' + fmt(stats.totalOut), 'amt-neg']] },
    { key: 'income', label: trF('stat.income') + ' · ' + stats.monLabel, value: fmt(stats.income), icon: 'IconCoinIn', bg: 'var(--mint-100)', fg: 'var(--green-800)', cls: 'amt-pos', delta: deltas && deltas.income },
    { key: 'expense', label: trF('stat.expense') + ' · ' + stats.monLabel, value: fmt(stats.expense), icon: 'IconCoinOut', bg: '#EAF1F4', fg: '#5E7A88', cls: 'amt-neg', delta: deltas && deltas.expense, invert: true },
    { key: 'profit', label: trF('stat.profit') + ' · ' + stats.monLabel, value: fmtS(stats.profit), icon: 'IconTrendUp', bg: 'var(--sand)', fg: 'var(--green-900)', margin: stats.margin, cls: stats.profit >= 0 ? 'amt-pos' : 'amt-neg', delta: deltas && deltas.profit, tip: trF('stat.profitTip') },
  ];
  const cards = seeMoney ? all : all.filter((c) => c.key === 'income' || c.key === 'expense');
  return (
    <div className={`fin-stat-row ${seeMoney ? '' : 'two'}`}>
      {cards.map((c, i) => (
        <div key={i} className={`card stat-box ${c.dark ? 'dark' : ''} ${c.bd ? 'has-bd' : ''}`} title={c.tip || undefined}
          onClick={c.bd ? () => setShowBd((v) => !v) : undefined} style={c.bd ? { cursor: 'pointer' } : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="icon-tile" style={{ background: c.dark ? 'rgba(255,255,255,.12)' : c.bg, color: c.dark ? '#22A7A1' : c.fg }}>{Icn(c.icon, { s: 19 })}</span>
            {c.margin != null && <span className="pill pill-pos tnum">{c.margin}%</span>}
            {c.bd && <span className="stat-info" title={c.tip}>{showBd ? '✕' : 'ⓘ'}</span>}
          </div>
          <div className={`tnum ${c.dark ? '' : c.cls}`} style={{ fontSize: 23, fontWeight: 800, marginTop: 14, whiteSpace: 'nowrap', color: c.dark ? (c.neg ? '#ffc4b8' : '#fff') : undefined }}>{c.value}</div>
          <div style={{ fontSize: 12.5, color: c.dark ? 'rgba(255,255,255,.65)' : 'var(--text-mut)', marginTop: 2 }}>{c.label}{c.sub ? <span style={{ opacity: .8 }}> · {c.sub}</span> : ''}</div>
          {c.bd && showBd && (
            <div className="stat-bd" onClick={(e) => e.stopPropagation()}>
              {c.bd.map(([lbl, val, cls], j) => (
                <div key={j} className="stat-bd-row"><span>{lbl}</span><b className={`tnum ${cls || ''}`}>{val}</b></div>
              ))}
              <div className="stat-bd-row total"><span>{trF('stat.balance')}</span><b className={`tnum ${c.neg ? 'amt-neg' : ''}`}>{balStr}</b></div>
            </div>
          )}
          {c.delta !== undefined && c.delta !== null && <DeltaPillF delta={c.delta} invert={c.invert} />}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 7-day monitor ---------------- */
function MonitorCard({ last7 }) {
  const data = last7.map((d) => ({ m: Dw()[new Date(d.date + 'T00:00').getDay()], rev: d.income, exp: d.expense }));
  const totIn = last7.reduce((a, d) => a + d.income, 0);
  const totOut = last7.reduce((a, d) => a + d.expense, 0);
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trF('monitor.title')}</div>
        <div style={{ display: 'flex', gap: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trF('monitor.in')} <b className="tnum amt-pos">{fmtC(totIn)}</b></span>
          <span style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trF('monitor.out')} <b className="tnum amt-neg">{fmtC(totOut)}</b></span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, margin: '10px 0 4px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-mut)', fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#065489' }} />{trF('legend.income')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-mut)', fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#22A7A1' }} />{trF('legend.expense')}</span>
      </div>
      <CashflowChart data={data} range="7D" />
    </div>
  );
}

/* ---------------- Category breakdown ---------------- */
function CategoryCard({ breakdown, total, monLabel }) {
  const palette = ['#065489', '#0B7EB1', '#138FB3', '#8DD3D0', '#3FB8B2', '#DDF7F6', '#E7F1F5'];
  if (!breakdown.length) return (
    <div className="card" style={{ padding: 18 }}>
      <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trF('cat.title')}</div>
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13 }}>{trF('cat.none')}</div>
    </div>
  );
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trF('cat.title')}</div>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{monLabel}</span>
      </div>
      <div style={{ margin: '14px 0' }}>
        <DonutChart segments={breakdown} total={total} centerLabel={trF('add.expense')} palette={palette} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {breakdown.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tnum" style={{ width: 32, fontSize: 12, fontWeight: 700, color: 'var(--text-mut)' }}>{s.pct}%</span>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: palette[i % palette.length], flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</span>
            <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Today summary ---------------- */
function TodayCard({ today, seeMoney = true }) {
  return (
    <div className="card today-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="sec-title" style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{trF('today.title')} · {new Date(TODAY + 'T00:00').getDate()} {Mn()[5]}</div>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>{trF('today.entries', { n: today.count })}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <div><div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>{trF('today.income')}</div><div className="tnum" style={{ fontSize: 18, fontWeight: 800, color: '#22A7A1' }}>{fmt(today.income)}</div></div>
        <div><div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>{trF('today.expense')}</div><div className="tnum" style={{ fontSize: 18, fontWeight: 800, color: '#FFC4B8' }}>{fmt(today.expense)}</div></div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,.12)', marginTop: 14, paddingTop: 12, display: seeMoney ? 'flex' : 'none', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.75)' }}>{trF('today.net')}</span>
        <span className="tnum" style={{ fontSize: 19, fontWeight: 800, color: '#fff' }}>{fmtS(today.income - today.expense)}</span>
      </div>
    </div>
  );
}

// "Input by" line: historical creator snapshot (name · role-at-input). Role is
// resolved to its display name via the live role list; legacy/auto rows show "—".
const roleLbl = (r) => (r && window.FS && FS.roleName) ? FS.roleName(r) : (r || '');
function byLine(e) {
  const by = e.createdBy;
  const txt = by && by.name ? (by.name + (by.role ? ' · ' + roleLbl(by.role) : '')) : '—';
  return (
    <div className="entry-by" title={trF('entry.by') + ': ' + txt}>
      <IconUserCircle s={11} /><span>{txt}</span>
    </div>
  );
}

/* ---------------- Entries ledger (grouped by day) ---------------- */
function EntriesList({ entries, onDelete, onEdit, filterable, title, catMap, canDelete = true, canEdit = false }) {
  const [f, setF] = uS('all');
  const [q, setQ] = uS('');
  const info = (k) => FS.catInfo(catMap, k);
  let rows = entries;
  if (f !== 'all') rows = rows.filter((e) => e.type === f);
  if (q) rows = rows.filter((e) => (info(e.category).label + e.note).toLowerCase().includes(q.toLowerCase()));
  // group by date desc
  const groups = {};
  rows.forEach((e) => { (groups[e.date] = groups[e.date] || []).push(e); });
  const dates = Object.keys(groups).sort().reverse();

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{title || trF('nav.entries')}</div>
        {filterable && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="tx-search" style={{ height: 36, width: 220 }}>
              <IconSearch s={16} style={{ color: 'var(--text-faint)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={trF('entries.search')} />
            </div>
            <div className="seg">
              {['all', 'income', 'expense'].map((t) => (
                <button key={t} className={`seg-btn ${f === t ? 'on' : ''}`} onClick={() => setF(t)} style={{ textTransform: 'capitalize' }}>{trF('entries.' + t)}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {dates.length === 0 && <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13.5 }}>{trF('entries.none')}</div>}

      {dates.map((d) => {
        const items = groups[d].slice().sort((a, b) => b.time.localeCompare(a.time));
        const inc = items.filter((e) => e.type === 'income').reduce((a, e) => a + e.amount, 0);
        const exp = items.filter((e) => e.type === 'expense').reduce((a, e) => a + e.amount, 0);
        return (
          <div key={d} className="day-group">
            <div className="day-head">
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{fmtDate(d)}</span>
              <span style={{ display: 'flex', gap: 12, fontSize: 12, fontWeight: 600 }}>
                {inc > 0 && <span className="amt-pos tnum">+{fmtC(inc)}</span>}
                {exp > 0 && <span className="amt-neg tnum">-{fmtC(exp)}</span>}
              </span>
            </div>
            {items.map((e) => {
              const isInc = e.type === 'income';
              const c = info(e.category);
              // Setoran-derived rows (stinc-/stmfg-) are recomputed in-memory from the
              // Setoran table — they cannot be edited/deleted here (the change would just
              // be reverted on the next recompute). Edit them via Setoran instead. Hiding
              // the buttons avoids the confusing "account change doesn't save" revert.
              const derived = /^st(inc|mfg)-/.test(String(e.id || ''));
              const showEdit = canEdit && !derived;
              const showDel = canDelete && !derived;
              return (
                <div key={e.id} className="entry-row">
                  <span className="icon-tile" style={{ width: 38, height: 38, borderRadius: 11, background: isInc ? 'var(--pos-bg)' : '#EAF1F4', color: isInc ? 'var(--green-800)' : '#5E7A88' }}>{Icn(c.icon, { s: 18 })}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-mut)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.note}</div>
                    {byLine(e)}
                  </div>
                  <span className="tnum entry-time" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{e.time}</span>
                  {e.proof
                    ? <button className="entry-proof" title={trF('att.view')} onClick={() => window.UI._viewProof(e.proof)}>{e.proof.isImg && e.proof.data ? <img src={e.proof.data} alt="" /> : <IconInvoice s={15} />}</button>
                    : <span className="entry-proof empty" aria-hidden="true" />}
                  <span className={`tnum ${isInc ? 'amt-pos' : 'amt-neg'}`} style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>{fmtS(isInc ? e.amount : -e.amount)}</span>
                  <div className="entry-actions">
                    {showEdit && <button className="edit-btn" title="Edit" aria-label={trF('a11y.edit')} onClick={() => onEdit(e)}><IconPencil s={15} /></button>}
                    {showDel && <button className="del-btn" title="Delete" aria-label={trF('a11y.delete')} onClick={() => onDelete(e.id)}><IconClose s={15} /></button>}
                    {!showEdit && !showDel && <span className="del-spacer" />}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Money Spots (cash + bank accounts) ---------------- */
function AcctModal({ acct, onSave, onClose }) {
  const [f, setF] = uS(acct);
  uE(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const valid = f.name.trim();
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trF('ms.add') : trF('ms.edit')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trF('ms.type')}</label>
          <UI.Dropdown value={f.type} options={[{ value: 'cash', label: trF('ms.cash') }, { value: 'bank', label: trF('ms.bank') }]} onChange={(v) => set({ type: v })} />
          <label className="fld-label">{trF('ms.name')}</label>
          <input className="fld" value={f.name} placeholder={f.type === 'cash' ? 'Cash' : 'BCA'} onChange={(e) => set({ name: e.target.value })} />
          {f.type === 'bank' && (<>
            <label className="fld-label">{trF('ms.accNo')}</label>
            <input className="fld" value={f.number} placeholder="8420 1199 0034" onChange={(e) => set({ number: e.target.value })} />
          </>)}
          <label className="fld-label">{trF('ms.opening')}</label>
          <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span><input inputMode="numeric" style={{ fontSize: 16 }} value={f.opening ? (+f.opening).toLocaleString('id-ID') : ''} onChange={(e) => set({ opening: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
          <label className="fld-label">{trF('ms.color')}</label>
          <div className="cat-chips">{['#22A7A1', '#065489', '#0B7EB1', '#138FB3', '#F7CB6C', '#5E7A88'].map((c) => (
            <button key={c} onClick={() => set({ color: c })} style={{ width: 30, height: 30, borderRadius: 9, background: c, border: f.color === c ? '3px solid var(--ink)' : '2px solid var(--border)' }} />
          ))}</div>
        </div>
        <div className="modal-foot">
          {!f._new && <button className="btn btn-ghost" style={{ color: 'var(--neg)', marginRight: 'auto' }} onClick={() => onSave(f, true)}><IconClose s={15} />{trF('ms.remove')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trF('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(f)}>{trF('ms.save')}</button>
        </div>
      </div>
    </div>
  );
}

function XferModal({ accounts, onSave, onClose }) {
  const [from, setFrom] = uS((accounts.find((a) => a.type === 'cash') || accounts[0]).id);
  const [to, setTo] = uS((accounts.find((a) => a.type === 'bank') || accounts[1] || accounts[0]).id);
  const [amount, setAmount] = uS(0);
  const [date, setDate] = uS(TODAY);
  uE(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const valid = amount > 0 && from !== to;
  const opts = accounts.map((a) => ({ value: a.id, label: a.name }));
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trF('xf.title')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trF('xf.from')}</label>
          <UI.Dropdown value={from} options={opts} onChange={setFrom} />
          <div style={{ display: 'grid', placeItems: 'center', margin: '10px 0' }}><span className="xf-arrow"><IconArrowDown s={18} /></span></div>
          <label className="fld-label" style={{ marginTop: 0 }}>{trF('xf.to')}</label>
          <UI.Dropdown value={to} options={opts} onChange={setTo} />
          {from === to && <div style={{ fontSize: 12, color: 'var(--neg)', marginTop: 6 }}>{trF('xf.same')}</div>}
          <label className="fld-label">{trF('add.amount')}</label>
          <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span><input inputMode="numeric" style={{ fontSize: 16 }} value={amount ? amount.toLocaleString('id-ID') : ''} onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          <label className="fld-label">{trF('add.date')}</label>
          <DP.DateField value={date} onChange={setDate} />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trF('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ id: FS.newXferId(), from, to, amount, date, note: '' })}>{trF('xf.do')}</button>
        </div>
      </div>
    </div>
  );
}

function MoneySpots({ accounts, setAccounts, entries, transfers, setTransfers, canEdit }) {
  const [edit, setEdit] = uS(null);
  const [xfer, setXfer] = uS(false);
  const total = accounts.reduce((s, a) => s + FS.acctBalance(a, entries, accounts, transfers), 0);
  const save = (a, remove) => {
    if (remove) { if (accounts.length <= 1) { setEdit(null); return; } if (!confirm(trF('ms.removeConfirm'))) return; setAccounts((p) => p.filter((x) => x.id !== a.id)); setEdit(null); return; }
    const clean = { ...a }; delete clean._new;
    setAccounts((p) => p.find((x) => x.id === a.id) ? p.map((x) => x.id === a.id ? clean : x) : [...p, clean]);
    setEdit(null);
  };
  const addNew = () => setEdit({ id: FS.newAcctId(), name: '', type: 'bank', bank: '', number: '', opening: 0, color: '#065489', _new: true });
  const doXfer = (t) => { setTransfers((p) => [t, ...p]); setXfer(false); };
  const acctName = (id) => (accounts.find((a) => a.id === id) || {}).name || '—';
  const recentX = (transfers || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return (
    <div className="screen-enter">
      <div className="ms-total card">
        <div><div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.7)' }}>{trF('ms.totalBal')}</div><div className="tnum" style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{fmt(total)}</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && <button className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: 'none' }} onClick={() => setXfer(true)}><IconArrowUp s={16} />{trF('xf.title')}</button>}
          {canEdit && <button className="btn btn-lime" onClick={addNew}><IconPlus s={16} />{trF('ms.add')}</button>}
        </div>
      </div>
      <div className="ms-grid">
        {accounts.map((a) => {
          const bal = FS.acctBalance(a, entries, accounts, transfers);
          const txn = entries.filter((e) => (e.acct || accounts[0].id) === a.id).length;
          return (
            <div key={a.id} className="ms-card card" onClick={() => canEdit && setEdit(a)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
              <div className="ms-card-top">
                <span className="ms-ic" style={{ background: a.color }}>{a.type === 'cash' ? <IconWallet s={20} /> : <IconStore s={20} />}</span>
                {canEdit && <span className="ms-edit"><IconPencil s={14} /></span>}
              </div>
              <div className="ms-name">{a.name}</div>
              <div className="ms-sub">{a.type === 'bank' ? (a.number || trF('ms.bank')) : trF('ms.cash')}</div>
              <div className="tnum ms-bal">{fmt(bal)}</div>
              <div className="ms-txn">{txn} {trF('ms.txns')}</div>
            </div>
          );
        })}
      </div>

      {recentX.length > 0 && (
        <div className="card" style={{ padding: 18, marginTop: 18 }}>
          <div className="sec-title" style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{trF('xf.recent')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentX.map((t) => (
              <div key={t.id} className="xf-row">
                <span className="appr-ic"><IconArrowUp s={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="appr-title">{acctName(t.from)} → {acctName(t.to)}</div>
                  <div className="appr-sub tnum">{t.date}</div>
                </div>
                <b className="tnum">{fmt(t.amount)}</b>
                {canEdit && <button className="icon-btn del" title={trF('ms.remove')} onClick={() => setTransfers((p) => p.filter((x) => x.id !== t.id))}><IconClose s={15} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {edit && <AcctModal acct={edit} onSave={save} onClose={() => setEdit(null)} />}
      {xfer && <XferModal accounts={accounts} onSave={doXfer} onClose={() => setXfer(false)} />}
    </div>
  );
}

window.FIN = { AddEntry, StatRow, MonitorCard, CategoryCard, TodayCard, EntriesList, MoneySpots, TODAY, MONTHS, FULLMON, fmt, fmtS, fmtC };
