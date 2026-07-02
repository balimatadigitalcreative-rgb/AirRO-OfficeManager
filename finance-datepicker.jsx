/* global React, PERIOD */
/* AirRO — clickable period navigator with popup calendar. window.DP.PeriodNav */
const { useState: uSdp, useRef: uRdp, useEffect: uEdp } = React;
const trDp = (k, v) => window.t(k, v);
function IcDp(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

const PAD = (n) => String(n).padStart(2, '0');
const ISO = (y, m, d) => `${y}-${PAD(m + 1)}-${PAD(d)}`;
// localized Monday-first weekday initials (2024-01-01 is a Monday)
const WD_HEAD = () => Array.from({ length: 7 }, (_, i) => PERIOD.dow(new Date(2024, 0, 1 + i)));

/* ---- day / week picker (month grid) with drill: day → month → year ----
   `today` is the UPPER bound (max) — null/'' means no upper cap; `min` the lower
   bound; `todayIso` (optional) is the real date to highlight (defaults to `today`).
   Both bounds are honored in every mode. */
function DayGrid({ gran, anchor, today, min, onPick, todayIso }) {
  const [view, setView] = uSdp(() => { const d = new Date(anchor + 'T00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [mode, setMode] = uSdp('day');
  const [yearBase, setYearBase] = uSdp(() => Math.floor(new Date(anchor + 'T00:00').getFullYear() / 12) * 12);
  const { y, m } = view;
  const stepMonth = (dir) => { let nm = m + dir, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setView({ y: ny, m: nm }); };
  const toYear = () => { setYearBase(Math.floor(y / 12) * 12); setMode('year'); };
  const pickMonth = (iso) => { const d = new Date(iso + 'T00:00'); setView({ y: d.getFullYear(), m: d.getMonth() }); setMode('day'); };
  const pickYear = (iso) => { const d = new Date(iso + 'T00:00'); setView({ y: d.getFullYear(), m }); setMode('month'); };

  // 12-month picker for the viewed year → sets the month, back to day view.
  if (mode === 'month') return <MonthGrid anchor={anchor} max={today} min={min} ctrlYear={y} setCtrlYear={(yy) => setView({ y: yy, m })} onHeader={toYear} onPick={pickMonth} />;
  // decade year picker → sets the year, back to month view.
  if (mode === 'year') return <YearGrid anchor={anchor} max={today} min={min} ctrlBase={yearBase} setCtrlBase={setYearBase} onPick={pickYear} />;

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startOff = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOff; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const sel = PERIOD.resolveRange(gran, anchor);
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" onClick={() => stepMonth(-1)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <button className="pc-head-btn" onClick={() => setMode('month')}>{PERIOD.mon(m)} {y}</button>
        <button className="pc-nav" onClick={() => stepMonth(1)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-wd">{WD_HEAD().map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="pc-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="pc-cell empty" />;
          const iso = ISO(y, m, d);
          const future = today ? iso > today : false;   // no upper cap → nothing disabled above
          const tooEarly = min && iso < min;   // honor min (e.g. range end >= start)
          const inSel = iso >= sel.start && iso <= sel.end;
          const isToday = iso === (todayIso || today);
          return (
            <button key={i} disabled={future || tooEarly}
              className={`pc-cell ${inSel ? 'sel' : ''} ${gran === 'week' ? 'wk' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => onPick(iso)}>{d}</button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- month picker ----
   Bounds: upper = max || today (PeriodNav passes `today`), lower = min (optional).
   Optional controlled year (ctrlYear/setCtrlYear) + header drill (onHeader) let
   DayGrid reuse this for its month step; PeriodNav omits them → unchanged. */
function MonthGrid({ anchor, today, min, max, onPick, ctrlYear, setCtrlYear, onHeader }) {
  const [vyInt, setVyInt] = uSdp(() => new Date(anchor + 'T00:00').getFullYear());
  const vy = ctrlYear != null ? ctrlYear : vyInt;
  const setVy = setCtrlYear || setVyInt;
  const sel = new Date(anchor + 'T00:00');
  const upper = max || today;
  const maxYM = upper ? upper.slice(0, 7) : null, minYM = min ? min.slice(0, 7) : null;
  const maxY = upper ? +upper.slice(0, 4) : null, minY = min ? +min.slice(0, 4) : null;
  const monthOff = (i) => { const ym = `${vy}-${PAD(i + 1)}`; return (maxYM && ym > maxYM) || (minYM && ym < minYM); };
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" disabled={minY != null && vy - 1 < minY} onClick={() => setVy(vy - 1)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        {onHeader ? <button className="pc-head-btn" onClick={onHeader}>{vy}</button> : <span>{vy}</span>}
        <button className="pc-nav" disabled={maxY != null && vy + 1 > maxY} onClick={() => setVy(vy + 1)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-mgrid">
        {Array.from({ length: 12 }, (_, i) => {
          const isSel = sel.getFullYear() === vy && sel.getMonth() === i;
          return <button key={i} disabled={monthOff(i)} className={`pc-mcell ${isSel ? 'sel' : ''}`} onClick={() => onPick(ISO(vy, i, 1))}>{PERIOD.mon(i)}</button>;
        })}
      </div>
    </div>
  );
}

/* ---- year picker ----
   Upper bound = max || today; lower = min (none → decades stretch back freely,
   e.g. birthDate). Optional controlled base (ctrlBase/setCtrlBase) for DayGrid;
   PeriodNav omits it → unchanged (future decades still capped at today). */
function YearGrid({ anchor, today, min, max, onPick, ctrlBase, setCtrlBase }) {
  const upper = max || today;
  const maxY = upper ? +upper.slice(0, 4) : null, minY = min ? +min.slice(0, 4) : null;
  const selY = new Date(anchor + 'T00:00').getFullYear();
  const [baseInt, setBaseInt] = uSdp(() => Math.floor(selY / 12) * 12);
  const base = ctrlBase != null ? ctrlBase : baseInt;
  const setBase = setCtrlBase || setBaseInt;
  const years = Array.from({ length: 12 }, (_, i) => base + i);
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" disabled={minY != null && base - 1 < minY} onClick={() => setBase(base - 12)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <span>{base}–{base + 11}</span>
        <button className="pc-nav" disabled={maxY != null && base + 12 > maxY} onClick={() => setBase(base + 12)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-mgrid">
        {years.map((yy) => <button key={yy} disabled={(maxY != null && yy > maxY) || (minY != null && yy < minY)} className={`pc-mcell ${yy === selY ? 'sel' : ''}`} onClick={() => onPick(ISO(yy, 0, 1))}>{yy}</button>)}
      </div>
    </div>
  );
}

function PeriodNav({ gran, anchor, onAnchor, label, today }) {
  const [open, setOpen] = uSdp(false);
  const ref = uRdp(null);
  uEdp(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; if (open) document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const range = PERIOD.resolveRange(gran, anchor);
  const nextDisabled = range.end >= today;
  const pick = (iso) => { onAnchor(iso); setOpen(false); };
  return (
    <div className="month-nav period-nav" ref={ref}>
      <button className="mn-arrow" onClick={() => onAnchor(PERIOD.stepAnchor(anchor, gran, -1))}><IconCaret s={16} style={{ transform: 'rotate(90deg)' }} /></button>
      <button className={`pn-label ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}><IconCalendar s={14} />{label}</button>
      <button className="mn-arrow" disabled={nextDisabled} onClick={() => onAnchor(PERIOD.stepAnchor(anchor, gran, 1))}><IconCaret s={16} style={{ transform: 'rotate(-90deg)' }} /></button>
      {open && (
        <React.Fragment>
          <div className="pop-cal-backdrop" onClick={() => setOpen(false)} />
          <div className="pop-cal-wrap">
            {(gran === 'day' || gran === 'week') && <DayGrid gran={gran} anchor={anchor} today={today} onPick={pick} />}
            {gran === 'month' && <MonthGrid anchor={anchor} today={today} onPick={pick} />}
            {gran === 'year' && <YearGrid anchor={anchor} today={today} onPick={pick} />}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---- styled single-date field (matches UI.Dropdown control + calendar popover) ----
   Props: value (YYYY-MM-DD), onChange, min, max (YYYY-MM-DD; dates outside are
   disabled/dimmed), allowFuture, placeholder. The SAME custom .pop-cal / DayGrid
   the period navigator uses, so every date field looks identical. */
function DateField({ value, onChange, min, max, allowFuture, placeholder }) {
  const [open, setOpen] = uSdp(false);
  const [pos, setPos] = uSdp(null);
  const btnRef = uRdp(null);
  const realToday = (window.FIN && FIN.TODAY) || new Date().toLocaleDateString('en-CA');
  // Upper bound is SEPARATE from the anchor: allowFuture → no cap; otherwise `max`
  // (or today). The anchor never falls back to a far-future placeholder.
  const maxBound = allowFuture ? (max || null) : (max || realToday);
  let anchor = value || (min || realToday);
  if (min && anchor < min) anchor = min;
  if (maxBound && anchor > maxBound) anchor = maxBound;
  // Float the calendar with position:fixed at coords computed from the button,
  // clamped to the viewport and flipped up when space below is tight. Rendered in
  // a portal on document.body so a transformed modal ancestor can't trap it (which
  // used to inflate the modal and add a scrollbar).
  const place = () => {
    const el = btnRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 300, H = 372, pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(r.left, vw - W - pad); left = Math.max(pad, left);
    let top = r.bottom + 6;
    if (top + H > vh - pad) top = Math.max(pad, r.top - 6 - H);   // flip up
    setPos({ left, top });
  };
  uEdp(() => {
    if (!open) { setPos(null); return; }
    place();
    const on = () => place();
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', on); window.addEventListener('scroll', on, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  const niceDate = (s) => { const d = new Date(s + 'T00:00'); const M = (window.PERIOD ? PERIOD.mon(d.getMonth()) : d.getMonth() + 1); return `${d.getDate()} ${M} ${d.getFullYear()}`; };
  return (
    <div className={`ui-dd ${open ? 'open' : ''}`}>
      <button type="button" ref={btnRef} className="ui-dd-control" onClick={() => setOpen((o) => !o)}>
        <IconCalendar s={15} style={{ color: 'var(--green-700)', flexShrink: 0 }} />
        <span className={`ui-dd-text ${value ? '' : 'ph'}`}>{value ? niceDate(value) : (placeholder || '—')}</span>
        <IconCaret s={15} style={{ flexShrink: 0, color: 'var(--text-mut)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && ReactDOM.createPortal(
        <React.Fragment>
          <div className="pop-cal-backdrop dd-back" onClick={() => setOpen(false)} />
          <div className="pop-cal-wrap dd-cal" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
            <DayGrid gran="day" anchor={anchor} today={maxBound} min={min} todayIso={realToday} onPick={(iso) => { onChange(iso); setOpen(false); }} />
          </div>
        </React.Fragment>, document.body)}
    </div>
  );
}

window.DP = { PeriodNav, DateField };

