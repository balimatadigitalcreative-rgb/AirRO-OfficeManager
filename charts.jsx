/* global React */
const { useState, useRef, useEffect } = React;
const AF = window.AIRRO;

/* ---------------- Cashflow bar chart — GROUPED positive bars (income + expense both up from 0) ----------------
   Income and expense are positive magnitudes, so both are drawn as positive bars from a single 0-baseline
   (never one below zero, which read as "negative"). Leading empty months are trimmed so the real months
   fill the width instead of being squeezed into a sliver. The month axis shows the year where it changes;
   bars respond to hover AND tap (phones), and the height shrinks on small screens. */
function CashflowChart({ data, range }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const T = (k, d) => (window.t ? window.t(k) : d);
  const yr = (d) => (d && d.key ? String(d.key).slice(0, 4) : '');

  // Trim leading empty months so two real months don't get squeezed by ten blanks; keep everything from
  // the first month with activity onward. If nothing has data, keep the full window (empty state).
  const base = range === '6M' ? data.slice(-6) : data;
  const firstData = base.findIndex((d) => d.rev || d.exp);
  const view = firstData > 0 ? base.slice(firstData) : base;

  // Height shrinks on phones so the chart doesn't dominate a screen carrying two bars.
  const H = w < 480 ? 176 : w < 768 ? 216 : 280;
  const padL = 40, padB = w < 480 ? 30 : 26, padT = 10;
  const innerH = H - padB - padT;
  const baseY = padT + innerH;
  const maxVal = Math.max(1, ...view.map((d) => Math.max(d.rev, d.exp)));
  const niceCeil = (m) => { const pow = Math.pow(10, Math.floor(Math.log10(m))); const f = m / pow; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return n * pow; };
  const niceMax = niceCeil(maxVal);
  const colW = (w - padL - 8) / view.length;
  const barW = Math.min(15, colW * 0.3);          // two grouped bars per month
  const gap = 2;
  const hFor = (v) => Math.max(v > 0 ? 2 : 0, (v / niceMax) * innerH);
  const ticks = [niceMax, niceMax / 2, 0];        // all ≥ 0 — no phantom negative axis

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg width="100%" viewBox={`0 0 ${w} ${H}`} style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => {
          const y = baseY - (t / niceMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - 4} y2={y} stroke={t === 0 ? '#C5D5DD' : '#E7F1F5'} strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#9AA3A0" fontFamily="Inter">
                {t === 0 ? '0' : AF.fmtCompact(t)}
              </text>
            </g>
          );
        })}
        {view.map((d, i) => {
          const cx = padL + colW * i + colW / 2;
          const on = hover === i;
          const revH = hFor(d.rev), expH = hFor(d.exp);
          const showYear = i === 0 || yr(d) !== yr(view[i - 1]);
          return (
            <g key={d.key || d.m} onMouseEnter={() => setHover(i)} onClick={() => setHover(on ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={cx - colW / 2} y={padT} width={colW} height={innerH} fill="transparent" />
              <rect x={cx - barW - gap / 2} y={baseY - revH} width={barW} height={revH}
                rx="4" fill={on ? '#053F66' : '#065489'} style={{ transition: 'fill .15s' }} />
              <rect x={cx + gap / 2} y={baseY - expH} width={barW} height={expH}
                rx="4" fill={on ? '#1C8F8A' : '#22A7A1'} style={{ transition: 'fill .15s' }} />
              <text x={cx} y={baseY + 15} textAnchor="middle" fontSize="11"
                fill={on ? '#242E2C' : '#9AA3A0'} fontWeight={on ? 700 : 500} fontFamily="Poppins">{d.m}</text>
              {showYear && <text x={cx} y={baseY + (w < 480 ? 27 : 25)} textAnchor="middle" fontSize="9" fill="#B7C2C7" fontFamily="Inter">{yr(d)}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && view[hover] && (() => {
        const cx = padL + colW * hover + colW / 2;
        const d = view[hover];
        const left = Math.max(8, Math.min(w - 168, cx - 80));
        return (
          <div style={{
            position: 'absolute', left, top: 4, width: 160, pointerEvents: 'none',
            background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: 'var(--shadow-md)', padding: '10px 12px', zIndex: 5,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{d.m} {yr(d)}</div>
            <Row label={T('stat.income', 'Pemasukan')} val={AF.fmtFull(d.rev)} dot="#065489" />
            <Row label={T('stat.expense', 'Pengeluaran')} val={AF.fmtFull(d.exp)} dot="#22A7A1" />
          </div>
        );
      })()}
    </div>
  );
}
function Row({ label, val, dot }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-mut)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: dot }} />{label}
      </span>
      <span className="tnum" style={{ fontWeight: 700, color: 'var(--ink)' }}>{val}</span>
    </div>
  );
}

/* ---------------- Donut chart ---------------- */
function DonutChart({ segments, total, centerLabel, palette }) {
  const [active, setActive] = useState(null);
  const size = 196, stroke = 30, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  let acc = 0;
  const shown = active != null ? segments[active] : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7F1F5" strokeWidth={stroke} />
          {segments.map((s, i) => {
            const len = (s.pct / 100) * C;
            const off = acc;
            acc += len;
            const on = active === i;
            return (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={palette[i % palette.length]}
                strokeWidth={on ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`}
                strokeDashoffset={-off} strokeLinecap="round"
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                style={{ transition: 'stroke-width .15s', cursor: 'pointer' }} />
            );
          })}
        </g>
        <text x="50%" y="46%" textAnchor="middle" fontSize="11" fill="#9AA3A0" fontFamily="Poppins" fontWeight="600">
          {shown ? shown.label : centerLabel}
        </text>
        <text x="50%" y="58%" textAnchor="middle" fontSize="17" fill="#242E2C" fontFamily="Poppins" fontWeight="800" className="tnum">
          {shown ? shown.pct + '%' : AF.fmtCompact(total)}
        </text>
      </svg>
    </div>
  );
}

/* ---------------- Mini progress ring (used in cards) ---------------- */
function Ring({ pct, size = 44, stroke = 5, color = '#065489', track = '#DDF7F6' }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${(pct / 100) * C} ${C}`} strokeLinecap="round" />
      </g>
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontSize="11"
        fontWeight="700" fill="#242E2C" fontFamily="Poppins" className="tnum">{pct}%</text>
    </svg>
  );
}

Object.assign(window, { CashflowChart, DonutChart, Ring });
