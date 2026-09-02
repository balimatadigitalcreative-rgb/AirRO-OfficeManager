'use strict';
// D1 — a ledger must never abbreviate money. Finance tables render AIRRO.fmtFull (full rupiah with
// thousand separators); only dashboard KPI tiles may use fmtCompact ("rb"/"jt"). This asserts fmtFull
// reproduces the STORED integer exactly (no rounding, no abbreviation) for the values from the report,
// and that fmtCompact — the one the tables must NOT use — really does abbreviate (so the distinction is
// real). data.js is a browser IIFE; load it under a minimal window shim.
let AIRRO;
beforeAll(() => { global.window = global.window || {}; require('../../data.js'); AIRRO = global.window.AIRRO; });

describe('fmtFull — the amount rendered equals the amount stored', () => {
  const cases = [244000, 1690000, 122500, 5955078, 18068257, 15816048];
  it('renders every digit with thousand separators and never abbreviates', () => {
    for (const n of cases) {
      const s = AIRRO.fmtFull(n);
      expect(s).not.toMatch(/rb|jt/i);                 // no "244rb" / "2jt"
      expect(s.replace(/\D/g, '')).toBe(String(n));    // rendered digits === stored integer (no rounding)
      expect(s).toContain(Math.round(n).toLocaleString('id-ID'));   // grouped exactly, id-ID
    }
  });
  it('fmtSigned is also full (a signed running balance keeps every digit)', () => {
    expect(AIRRO.fmtSigned(-18068257).replace(/[^\d]/g, '')).toBe('18068257');
    expect(AIRRO.fmtSigned(-18068257)).not.toMatch(/rb|jt/i);
  });
  it('fmtCompact DOES abbreviate — proving the tables must use fmtFull, not this', () => {
    expect(AIRRO.fmtCompact(244000)).toMatch(/rb|jt/i);   // "244rb" — the D1 defect if used in a table
  });
});
