'use strict';
/*
 * APP TIME — the one place that knows what "today" means and how to turn a provider's timestamp into
 * a real instant.
 *
 * WHY THIS EXISTS: every service used to derive the business date with
 * `new Date().toISOString().slice(0, 10)`, which is the UTC date. The business runs in Bali (WITA,
 * UTC+8), so on a UTC server every moment between 00:00 and 08:00 WITA resolved to YESTERDAY — the
 * delivery board, setoran, outstanding stops and every `asOf` silently shifted a day for the whole
 * morning. The timezone is configuration (APP_TZ, default Asia/Makassar), never the host's clock.
 *
 * It also carries the provider-timestamp rules, because an integration that guesses an offset is the
 * same bug one hour at a time.
 */
const config = require('../config/env');

// YYYY-MM-DD for an instant, in a given IANA zone. 'en-CA' formats exactly as YYYY-MM-DD.
function ymdInTz(d, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The business date NOW, in the app's configured zone. Replaces every `toISOString().slice(0,10)`.
function todayISO(now) {
  return ymdInTz(now || new Date(), config.appTz);
}

// A zone's UTC offset (minutes) AT a given instant — computed from Intl, so DST is handled wherever
// it applies (Asia/Makassar and Asia/Bangkok have none, but this must not be wrong elsewhere).
function offsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  dtf.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  // Read the wall-clock reading back AS IF it were UTC; the gap is the offset.
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return (asUtc - date.getTime()) / 60000;
}

// A NAIVE wall-clock reading (no offset) interpreted in `tz` → the real UTC instant (ms).
// Settled twice so a reading that lands near a DST transition converges.
function zonedNaiveToUtcMs(naiveUtcMs, tz) {
  let ms = naiveUtcMs - offsetMinutes(tz, new Date(naiveUtcMs)) * 60000;
  ms = naiveUtcMs - offsetMinutes(tz, new Date(ms)) * 60000;
  return ms;
}

// Does this timestamp string carry its own offset? Only then is it self-describing.
//
// THE MINUTES ARE OPTIONAL, and that is not a nicety. Cartrack stamps a fix "2026-09-11 12:30:05+08" —
// a TWO-digit offset. A pattern demanding a full +HH:MM misses it, the stamp is then taken for naive,
// and CARTRACK_TZ is applied to a reading that already carried its own offset: with the UTC default
// that is a silent EIGHT-hour error on every position, and it would have looked like real data.
const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)\s*$/i;

// Put an offset-bearing stamp into a form V8 will actually parse. TWO repairs are needed and the second
// is the easy one to miss: `new Date('2026-09-11T12:30:05+08')` is Invalid Date, because a bare +HH is
// not valid ISO 8601. Widen it before Date ever sees the string.
function isoish(s) {
  return String(s).trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')         // +08   -> +08:00
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');  // +0800 -> +08:00
}

/*
 * Normalise a provider timestamp to a UTC instant.
 *
 * RULE 1 — an explicit offset (…Z, …+07:00) is authoritative. Use it, assume nothing.
 * RULE 2 — a NAIVE stamp ("2026-09-12 14:30:00") describes a wall clock with no zone, so it needs an
 *   assumption. We deliberately do NOT take that assumption from the provider's own timezone field:
 *   the two AirRO vehicles report DIFFERENT values (one null, one "Asia/Bangkok") while both drive in
 *   Bali, so that field describes the account, not the clock on the fix. The assumption is ours,
 *   configured (CARTRACK_TZ, default UTC), and RETURNED so the caller can surface it instead of
 *   quietly believing it.
 *
 * Returns { at: Date|null, assumedTz: '' | tz, raw } — `assumedTz` is '' when the stamp was explicit.
 */
function parseProviderTs(raw, assumeTz) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { at: null, assumedTz: '', raw: s };
  if (HAS_OFFSET.test(s)) {
    const d = new Date(isoish(s));
    return { at: isNaN(d.getTime()) ? null : d, assumedTz: '', raw: s };
  }
  // Naive: "YYYY-MM-DD HH:MM:SS" (or with a T, optional seconds/fraction).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const d = new Date(s); return { at: isNaN(d.getTime()) ? null : d, assumedTz: '', raw: s }; }
  const tz = assumeTz || config.cartrack.tz || 'UTC';
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0);
  return { at: new Date(zonedNaiveToUtcMs(naive, tz)), assumedTz: tz, raw: s };
}

// Render a UTC instant as wall-clock text in the app's zone (for "posisi terakhir", logs, exports).
function formatInTz(d, tz, opts) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', Object.assign({
    timeZone: tz || config.appTz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }, opts || {})).format(d instanceof Date ? d : new Date(d));
}

module.exports = { todayISO, ymdInTz, offsetMinutes, zonedNaiveToUtcMs, parseProviderTs, formatInTz, isoish };
