'use strict';
// Indonesian phone normalisation — ONE authoritative rule, applied to every write path
// (form, paste import, file import) so no entry point can store a mangled number.
//
// Why: Excel silently strips the leading zero from a phone column ("081211223344" becomes
// the number 81211223344), and people paste "+62 812-1122-3344". Rather than asking staff
// to reformat spreadsheets, we repair it on the way in and always store the "08…" form.
//
//   ""                    → ""            (phone is optional)
//   "+62 812-1122-3344"   → "081211223344"
//   "6281211223344"       → "081211223344"
//   "81211223344"         → "081211223344"  (Excel dropped the 0)
//   "081211223344"        → "081211223344"
//   "0361123456"          → "0361123456"    (landline, already 0-prefixed)
//   "123456"              → "123456"        (short/other — kept as cleaned digits)
//
// The client mirrors this exactly (distribution.jsx normalizePhone) for live preview; the
// server value is the one that gets stored.
function normalizePhone(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('62')) return '0' + d.slice(2);
  if (d.startsWith('0')) return d;
  if (d.startsWith('8')) return '0' + d;
  return d;
}

module.exports = { normalizePhone };
