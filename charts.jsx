/* global React */
const { useState, useRef, useEffect } = React;
const AF = window.AIRRO;

/* ---------------- Cashflow bar chart (income up / expense down) ---------------- */
function CashflowChart({ data, range }) {
  const view = range === '6M' ? data.slice(-6) : data;
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const H = 280, padL = 38, padB = 26, padT = 10;
  const innerH = H - padB - padT;
  const maxVal = Math.max(1, ...view.map(d => Math.max(d.rev, d.exp)));
  // adaptive "nice" ceiling: 1/2/5 × 10^n just above maxVal
  const niceCeil = (m) => {
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    const f = m / pow;
    const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return n * pow;
  };
  const niceMax = niceCeil(maxVal);
  const half = innerH / 2;
  const zeroY = padT + half;
  const colW = (w - padL - 8) / view.length;
  const barW = Math.min(26, colW * 0.42);

  const yFor = (v, dir) => dir === 'up'
    ? zeroY - (v / niceMax) * half
    : zeroY + (v / niceMax) * half;

  const ticks = [niceMax, niceMax / 2, 0, -niceMax / 2, -niceMax];

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg width="100%" viewBox={`0 0 ${w} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, i) => {
          const y = zeroY - (t / niceMax) * half;
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
          const revTop = yFor(d.rev, 'up');
          const expBot = yFor(d.exp, 'down');
          return (
            <g key={d.m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <rect x={cx - colW / 2} y={padT} width={colW} height={innerH} fill="transparent" />
              <rect x={cx - barW / 2} y={revTop} width={barW} height={Math.max(0, zeroY - revTop)}
                rx="5" fill={on ? '#053F66' : '#065489'} style={{ transition: 'fill .15s' }} />
              <rect x={cx - barW / 2} y={zeroY} width={barW} height={Math.max(0, expBot - zeroY)}
                rx="5" fill={on ? '#1C8F8A' : '#22A7A1'} style={{ transition: 'fill .15s' }} />
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="11"
                fill={on ? '#242E2C' : '#9AA3A0'} fontWeight={on ? 700 : 500} fontFamily="Poppins">{d.m}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (() => {
        const cx = padL + colW * hover + colW / 2;
        const d = view[hover];
        const left = Math.max(8, Math.min(w - 168, cx - 80));
        return (
          <div style={{
            position: 'absolute', left, top: 4, width: 160, pointerEvents: 'none',
            background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: 'var(--shadow-md)', padding: '10px 12px', zIndex: 5,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>{d.m} 2026</div>
            <Row label="Revenue" val={AF.fmtFull(d.rev)} dot="#065489" />
            <Row label="Expense" val={AF.fmtFull(d.exp)} dot="#22A7A1" />
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
