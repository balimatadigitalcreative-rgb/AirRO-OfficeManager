'use strict';

// ── Kasbon business rules (payroll cycle 16→15) ──────────────────────────
// Ceiling per cycle = 50% of BASE salary (base only, not allowances).
// Weekly max per request = ceiling / 4. Max 1 kasbon per week.
// Week window: 'cutoff' = rolling 7 days from the 16th; 'calendar' = Mon–Sun.
// Pure functions — shared shape with the frontend (finance-hrd.js) so limits
// shown in the UI match what the server enforces.

const CEILING_PCT = 0.5;
const WEEKS_PER_CYCLE = 4;
const pad = (n) => String(n).padStart(2, '0');

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function dowMon(iso) { const [y, m, d] = iso.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; } // Mon=0..Sun=6

// Payroll cycle (16 → 15 next month) that contains `iso`.
function cycleOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  let sy = y, sm = m;
  if (d < 16) { sm = m - 1; if (sm < 1) { sm = 12; sy = y - 1; } }
  const start = `${sy}-${pad(sm)}-16`;
  let ey = sy, em = sm + 1; if (em > 12) { em = 1; ey = ey + 1; }
  const end = `${ey}-${pad(em)}-15`;
  return { start, end, anchor: end };
}
function weekKey(iso, cycleStart, mode) {
  if (mode === 'calendar') return 'C' + addDaysISO(iso, -dowMon(iso));
  return 'W' + Math.floor(daysBetween(cycleStart, iso) / 7);
}
function nextWeekOpen(iso, cycleStart, mode) {
  if (mode === 'calendar') return addDaysISO(addDaysISO(iso, -dowMon(iso)), 7);
  const wk = Math.floor(daysBetween(cycleStart, iso) / 7);
  return addDaysISO(cycleStart, (wk + 1) * 7);
}
function limits(base) {
  const ceiling = Math.floor(CEILING_PCT * (+base || 0));
  return { ceiling, weeklyMax: Math.floor(ceiling / WEEKS_PER_CYCLE) };
}
const anchorOf = (c) => c.cycleAnchor || cycleOf(c.date).anchor;

// Snapshot of a staff's kasbon standing for the cycle containing `refDate`.
function summarize(base, existing, refDate, mode) {
  const cyc = cycleOf(refDate);
  const { ceiling, weeklyMax } = limits(base);
  const inCyc = (existing || []).filter((c) => c.status !== 'cancelled' && anchorOf(c) === cyc.anchor);
  const used = inCyc.reduce((a, c) => a + (+c.amount || 0), 0);
  const wk = weekKey(refDate, cyc.start, mode);
  const thisWeekTaken = inCyc.some((c) => weekKey(c.date, cyc.start, mode) === wk);
  const remaining = Math.max(0, ceiling - used);
  return {
    cycle: cyc, ceiling, weeklyMax, used, remaining, count: inCyc.length, thisWeekTaken,
    weekLeft: thisWeekTaken ? 0 : Math.min(weeklyMax, remaining),
    nextWeekDate: thisWeekTaken ? nextWeekOpen(refDate, cyc.start, mode) : null,
  };
}

// Authoritative check for a new kasbon request. Order: weekly cap → 1/week → ceiling.
function validate({ base, date, amount, existing, mode }) {
  const cyc = cycleOf(date);
  const { ceiling, weeklyMax } = limits(base);
  const inCyc = (existing || []).filter((c) => c.status !== 'cancelled' && anchorOf(c) === cyc.anchor);
  const used = inCyc.reduce((a, c) => a + (+c.amount || 0), 0);
  amount = +amount || 0;
  if (!(base > 0)) return { ok: false, code: 'NO_BASE', message: 'Gaji pokok karyawan belum diatur.' };
  if (!(amount > 0)) return { ok: false, code: 'AMOUNT', message: 'Nominal tidak valid.' };
  if (amount > weeklyMax) return { ok: false, code: 'WEEKLY_MAX', weeklyMax, remaining: Math.max(0, ceiling - used), message: `Melebihi batas mingguan. Maksimal Rp ${weeklyMax.toLocaleString('id-ID')} per pengambilan.` };
  const wk = weekKey(date, cyc.start, mode);
  if (inCyc.some((c) => weekKey(c.date, cyc.start, mode) === wk)) {
    const nd = nextWeekOpen(date, cyc.start, mode);
    return { ok: false, code: 'ONE_PER_WEEK', nextWeekDate: nd, message: `Sudah ada kasbon di minggu ini (maks 1×/minggu). Bisa mengajukan lagi mulai ${nd}.` };
  }
  if (used + amount > ceiling) {
    const remaining = Math.max(0, ceiling - used);
    return { ok: false, code: 'CEILING', remaining, ceiling, message: `Melebihi plafon siklus. Sisa plafon Rp ${remaining.toLocaleString('id-ID')}.` };
  }
  return { ok: true, cycleAnchor: cyc.anchor, ceiling, weeklyMax, used, remainingAfter: ceiling - used - amount };
}

module.exports = { CEILING_PCT, WEEKS_PER_CYCLE, cycleOf, weekKey, nextWeekOpen, limits, summarize, validate };
