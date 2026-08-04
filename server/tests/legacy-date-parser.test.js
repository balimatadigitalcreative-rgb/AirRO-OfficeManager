'use strict';
// Unit tests for the legacy-import date parser (shared client + server logic). The XLSX-import bug
// was that the reader returned each date cell's own display format (SheetJS default m/d/yy → "1/15/26")
// and the day-first parser then read month=15 → "Tanggal salah" on every row. The reader now reads
// the raw value (Date object / serial), and the parser accepts every reasonable d/m/y + month-name +
// serial form, DAY-FIRST. This pins the parser contract.
const { parseLegacyDate } = require('../src/services/distribution.service');

describe('parseLegacyDate — every accepted format', () => {
  const cases = [
    ['12 Januari 2026', '2026-01-12'],   // Indonesian month name, full
    ['9 Feb 2026', '2026-02-09'],        // English abbrev
    ['6-Apr-26', '2026-04-06'],          // month-name, dashes, 2-digit year
    ['06/04/2026', '2026-04-06'],        // dd/mm/yyyy
    ['6/4/26', '2026-04-06'],            // d/m/yy
    ['2026-04-06', '2026-04-06'],        // ISO
    ['6.4.2026', '2026-04-06'],          // dotted d.m.y
    ['9 Desember 2026', '2026-12-09'],   // ID full (Desember)
    ['5 Agu 2026', '2026-08-05'],        // ID abbrev (Agu)
    ['5 Mei 2026', '2026-05-05'],        // Mei
  ];
  it.each(cases)('%s → %s (day-first, month names ID+EN)', (input, expected) => {
    expect(parseLegacyDate(input)).toBe(expected);
  });

  it('day-first for an ambiguous numeric date: 03/04/2026 → 3 April', () => {
    expect(parseLegacyDate('03/04/2026')).toBe('2026-04-03');
  });

  it('2-digit year: 00–79 → 2000s, 80–99 → 1900s', () => {
    expect(parseLegacyDate('5-1-26')).toBe('2026-01-05');
    expect(parseLegacyDate('5-1-79')).toBe('2079-01-05');
    expect(parseLegacyDate('5-1-80')).toBe('1980-01-05');
    expect(parseLegacyDate('5-1-95')).toBe('1995-01-05');
  });

  it('Excel serial number (45678) and a numeric-string serial parse via the 1899-12-30 epoch', () => {
    expect(parseLegacyDate(45678)).toBe('2025-01-21');
    expect(parseLegacyDate('45678')).toBe('2025-01-21');
    expect(parseLegacyDate(46017)).toBe('2025-12-26');
  });

  it('a real Date object uses LOCAL calendar parts (no timezone day-shift)', () => {
    expect(parseLegacyDate(new Date(2026, 0, 15))).toBe('2026-01-15');   // Jan 15, not Jan 14
    expect(parseLegacyDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  it('rejects genuinely impossible / empty values (→ null)', () => {
    expect(parseLegacyDate('32/13/2026')).toBeNull();
    expect(parseLegacyDate('abc')).toBeNull();
    expect(parseLegacyDate('')).toBeNull();
    expect(parseLegacyDate('31/02/2026')).toBeNull();   // Feb 31 doesn't exist
  });
});
