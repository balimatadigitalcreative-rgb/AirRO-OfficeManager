/* global React, PERIOD */
/* AirRO — clickable period navigator with popup calendar. window.DP.PeriodNav */
const { useState: uSdp, useRef: uRdp, useEffect: uEdp } = React;
const trDp = (k, v) => window.t(k, v);
function IcDp(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

const PAD = (n) => String(n).padStart(2, '0');
const ISO = (y, m, d) => `${y}-${PAD(m + 1)}-${PAD(d)}`;
// localized Monday-first weekday initials (2024-01-01 is a Monday)
const WD_HEAD = () => Array.from({ length: 7 }, (_, i) => PERIOD.dow(new Date(2024, 0, 1 + i)));

/* ---- day / week picker (month grid) ---- */
function DayGrid({ gran, anchor, today, min, onPick }) {
  const [view, setView] = uSdp(() => { const d = new Date(anchor + 'T00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const { y, m } = view;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startOff = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOff; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const sel = PERIOD.resolveRange(gran, anchor);
  const step = (dir) => { let nm = m + dir, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setView({ y: ny, m: nm }); };
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" onClick={() => step(-1)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <span>{PERIOD.mon(m)} {y}</span>
        <button className="pc-nav" onClick={() => step(1)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-wd">{WD_HEAD().map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="pc-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="pc-cell empty" />;
          const iso = ISO(y, m, d);
          const future = iso > today;
          const tooEarly = min && iso < min;   // honor min (e.g. range end >= start)
          const inSel = iso >= sel.start && iso <= sel.end;
          const isToday = iso === today;
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

/* ---- month picker ---- */
function MonthGrid({ anchor, today, onPick }) {
  const [vy, setVy] = uSdp(() => new Date(anchor + 'T00:00').getFullYear());
  const sel = new Date(anchor + 'T00:00');
  const ty = new Date(today + 'T00:00').getFullYear(), tm = new Date(today + 'T00:00').getMonth();
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" onClick={() => setVy(vy - 1)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <span>{vy}</span>
        <button className="pc-nav" disabled={vy >= ty} onClick={() => setVy(vy + 1)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-mgrid">
        {Array.from({ length: 12 }, (_, i) => {
          const future = vy > ty || (vy === ty && i > tm);
          const isSel = sel.getFullYear() === vy && sel.getMonth() === i;
          return <button key={i} disabled={future} className={`pc-mcell ${isSel ? 'sel' : ''}`} onClick={() => onPick(ISO(vy, i, 1))}>{PERIOD.mon(i)}</button>;
        })}
      </div>
    </div>
  );
}

/* ---- year picker ---- */
function YearGrid({ anchor, today, onPick }) {
  const ty = new Date(today + 'T00:00').getFullYear();
  const selY = new Date(anchor + 'T00:00').getFullYear();
  const [base, setBase] = uSdp(() => Math.floor(selY / 12) * 12);
  const years = Array.from({ length: 12 }, (_, i) => base + i);
  return (
    <div className="pop-cal">
      <div className="pc-head">
        <button className="pc-nav" onClick={() => setBase(base - 12)}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} /></button>
        <span>{base}–{base + 11}</span>
        <button className="pc-nav" disabled={base + 12 > ty} onClick={() => setBase(base + 12)}><IconCaret s={15} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="pc-mgrid">
        {years.map((yy) => <button key={yy} disabled={yy > ty} className={`pc-mcell ${yy === selY ? 'sel' : ''}`} onClick={() => onPick(ISO(yy, 0, 1))}>{yy}</button>)}
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
  const ref = uRdp(null);
  uEdp(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const today = max || (allowFuture ? '2030-12-31' : ((window.FIN && FIN.TODAY) || new Date().toLocaleDateString('en-CA')));
  let anchor = value || today;
  if (min && anchor < min) anchor = min;   // open on a month within [min, max]
  const niceDate = (s) => { const d = new Date(s + 'T00:00'); const M = (window.PERIOD ? PERIOD.mon(d.getMonth()) : d.getMonth() + 1); return `${d.getDate()} ${M} ${d.getFullYear()}`; };
  return (
    <div className={`ui-dd ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="ui-dd-control" onClick={() => setOpen((o) => !o)}>
        <IconCalendar s={15} style={{ color: 'var(--green-700)', flexShrink: 0 }} />
        <span className={`ui-dd-text ${value ? '' : 'ph'}`}>{value ? niceDate(value) : (placeholder || '—')}</span>
        <IconCaret s={15} style={{ flexShrink: 0, color: 'var(--text-mut)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <React.Fragment>
          <div className="pop-cal-backdrop" onClick={() => setOpen(false)} />
          <div className="pop-cal-wrap dd-cal">
            <DayGrid gran="day" anchor={anchor} today={today} min={min} onPick={(iso) => { onChange(iso); setOpen(false); }} />
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

window.DP = { PeriodNav, DateField };

