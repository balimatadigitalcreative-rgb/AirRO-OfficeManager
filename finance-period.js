/* AirRO — shared period/granularity helpers (Day/Week/Month/Year/Custom).
   Local-time safe (no UTC drift). Exposed on window.PERIOD. */
(function () {
  const MONS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                 id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] };
  const DOWS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                 id: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] };
  const lang = () => (window.I18N && window.I18N.lang) || 'en';
  const mon = (i) => (MONS[lang()] || MONS.en)[i];
  const dow = (d) => (DOWS[lang()] || DOWS.en)[d.getDay()];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const D = (s) => new Date(s + 'T00:00');
  const niceDate = (s) => { const d = D(s); return `${d.getDate()} ${mon(d.getMonth())} ${d.getFullYear()}`; };
  const weekStart = (d) => { const x = new Date(d); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x; };

  function resolveRange(gran, anchor, cStart, cEnd) {
    const A = D(anchor);
    if (gran === 'day') return { start: anchor, end: anchor };
    if (gran === 'week') { const s = weekStart(A); const e = new Date(s); e.setDate(s.getDate() + 6); return { start: iso(s), end: iso(e) }; }
    if (gran === 'month') { const y = A.getFullYear(), m = A.getMonth(); return { start: `${y}-${pad(m + 1)}-01`, end: iso(new Date(y, m + 1, 0)) }; }
    if (gran === 'year') { const y = A.getFullYear(); return { start: `${y}-01-01`, end: `${y}-12-31` }; }
    return { start: cStart, end: cEnd };
  }

  function stepAnchor(anchor, gran, dir) {
    const A = D(anchor);
    if (gran === 'day') A.setDate(A.getDate() + dir);
    else if (gran === 'week') A.setDate(A.getDate() + dir * 7);
    else if (gran === 'month') A.setMonth(A.getMonth() + dir);
    else if (gran === 'year') A.setFullYear(A.getFullYear() + dir);
    return iso(A);
  }

  // previous comparable period range
  function prevRange(gran, anchor, cStart, cEnd) {
    if (gran === 'custom') {
      const s = D(cStart), e = D(cEnd);
      const len = Math.round((e - s) / 86400000) + 1;
      const pe = new Date(s); pe.setDate(s.getDate() - 1);
      const ps = new Date(pe); ps.setDate(pe.getDate() - (len - 1));
      return { start: iso(ps), end: iso(pe) };
    }
    return resolveRange(gran, stepAnchor(anchor, gran, -1), cStart, cEnd);
  }

  // If the period is in progress (contains today), match the previous range to
  // the same number of elapsed days — so a partial month compares to the same
  // partial slice of the prior month, not the whole month.
  function prevMatched(gran, anchor, cStart, cEnd, todayISO) {
    const range = resolveRange(gran, anchor, cStart, cEnd);
    const pr = prevRange(gran, anchor, cStart, cEnd);
    if (range.start <= todayISO && range.end >= todayISO) {
      const elapsed = Math.round((D(todayISO) - D(range.start)) / 86400000); // days after start
      const pe = new Date(D(pr.start)); pe.setDate(pe.getDate() + elapsed);
      return { start: pr.start, end: iso(pe), curEnd: todayISO, partial: true };
    }
    return { start: pr.start, end: pr.end, curEnd: range.end, partial: false };
  }

  function periodLabel(gran, anchor, range) {
    const A = D(anchor);
    if (gran === 'day') return `${dow(A)}, ${niceDate(anchor)}`;
    if (gran === 'week') return `${niceDate(range.start)} – ${niceDate(range.end)}`;
    if (gran === 'month') return `${mon(A.getMonth())} ${A.getFullYear()}`;
    if (gran === 'year') return `${A.getFullYear()}`;
    return `${niceDate(range.start)} – ${niceDate(range.end)}`;
  }

  // sum income/expense over a range; also active-day count
  function aggregate(entries, start, end) {
    let income = 0, expense = 0; const days = new Set();
    entries.forEach((e) => { if (e.date >= start && e.date <= end) { days.add(e.date); e.type === 'income' ? income += e.amount : expense += e.amount; } });
    return { income, expense, profit: income - expense, days: days.size };
  }

  // bucketed trend series for a chart, granularity-aware
  function buildSeries(entries, gran, anchor, cStart, cEnd) {
    const agg = (s, e) => { let rev = 0, exp = 0; entries.forEach((x) => { if (x.date >= s && x.date <= e) { x.type === 'income' ? rev += x.amount : exp += x.amount; } }); return { rev, exp }; };
    const A = D(anchor);
    const out = [];
    if (gran === 'day') {
      for (let i = 6; i >= 0; i--) { const d = new Date(A); d.setDate(A.getDate() - i); const ds = iso(d); const v = agg(ds, ds); out.push({ m: dow(d), rev: v.rev, exp: v.exp }); }
    } else if (gran === 'week') {
      const ws = weekStart(A); for (let i = 0; i < 7; i++) { const d = new Date(ws); d.setDate(ws.getDate() + i); const ds = iso(d); const v = agg(ds, ds); out.push({ m: dow(d), rev: v.rev, exp: v.exp }); }
    } else if (gran === 'month') {
      const y = A.getFullYear(), m = A.getMonth(), last = new Date(y, m + 1, 0).getDate(), mm = pad(m + 1);
      [[1, 7], [8, 14], [15, 21], [22, 28], [29, last]].forEach(([a, b]) => { if (a > last) return; const bb = Math.min(b, last); const v = agg(`${y}-${mm}-${pad(a)}`, `${y}-${mm}-${pad(bb)}`); out.push({ m: `${a}–${bb}`, rev: v.rev, exp: v.exp }); });
    } else if (gran === 'year') {
      const y = A.getFullYear(); for (let i = 0; i < 12; i++) { const v = agg(`${y}-${pad(i + 1)}-01`, iso(new Date(y, i + 1, 0))); out.push({ m: mon(i), rev: v.rev, exp: v.exp }); }
    } else {
      const e = D(cEnd); let cur = D(cStart); cur = new Date(cur.getFullYear(), cur.getMonth(), 1); let g = 0;
      while (cur <= e && g < 60) { const y = cur.getFullYear(), m = cur.getMonth(); const ms = `${y}-${pad(m + 1)}-01`, me = iso(new Date(y, m + 1, 0)); const v = agg(ms < cStart ? cStart : ms, me > cEnd ? cEnd : me); out.push({ m: mon(m), rev: v.rev, exp: v.exp }); cur.setMonth(cur.getMonth() + 1); g++; }
    }
    return out;
  }

  // % change vs previous; returns null when no prior basis
  function pctDelta(cur, prev) {
    if (!prev) return null;
    if (cur === prev) return 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  }

  window.PERIOD = { iso, niceDate, weekStart, resolveRange, stepAnchor, prevRange, prevMatched, periodLabel, aggregate, buildSeries, pctDelta, mon, dow,
    GRAN_KEYS: [['day', 'rep.day'], ['week', 'rep.week'], ['month', 'rep.month'], ['year', 'rep.year'], ['custom', 'rep.custom']] };
})();
