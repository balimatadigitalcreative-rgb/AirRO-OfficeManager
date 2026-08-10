'use strict';
// ONE shared phone helper (was ad-hoc `.replace(/^0/,'62')` scattered around). Normalises an
// Indonesian number to E.164 digits (no '+'): 08xx → 628xx, strips separators, and REJECTS anything
// shorter than 9 or longer than 15 digits by returning null (callers must not build a broken wa.me).
function toE164(raw) {
  let d = String(raw == null ? '' : raw).trim();
  if (d[0] === '+') d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('62')) { /* already country-coded */ }
  else if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;   // bare mobile → assume Indonesia
  else d = '62' + d;
  if (d.length < 9 || d.length > 15) return null;
  return d;
}
const isValidPhone = (raw) => !!toE164(raw);
const waLink = (raw, text) => { const e = toE164(raw); return e ? ('https://wa.me/' + e + (text ? '?text=' + encodeURIComponent(text) : '')) : null; };
module.exports = { toE164, isValidPhone, waLink };
