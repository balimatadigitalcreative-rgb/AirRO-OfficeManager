/* global React */
/* AirRO — Distribusi module screens. window.DIST. Separate from the cash book:
   all data comes from the /distribusi REST endpoints (never the AirRO Entry tables). */
const { useState: uSx, useEffect: uEx } = React;
const trD = (k, v) => window.t(k, v);
function IcX(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
// Money in the Distribusi module uses the FULL format ("Rp 500.000") — never the
// ambiguous compact form ("500rb"). Non-money counts (galon, txn count) use numX.
const rpFull = (n) => (window.FIN && FIN.fmt ? FIN.fmt(n) : String(n));
const numX = (n) => (n || 0).toLocaleString('id-ID');
// Warn (client-side) before saving when a computed amount looks absurd — likely a typo in qty/price.
// The server enforces a HARD ceiling of Rp 1,000,000,000 per row (overCeiling in the service — the
// value 4,282,500,000 that broke the transaction list was above it); this softer warning fires far
// earlier so a typo is caught at entry with a confirm step. MAX_ROW_AMOUNT mirrors the server ceiling
// so imports can flag an over-ceiling row as "Dilewati" client-side instead of silently dropping it.
const WARN_AMOUNT = 100000000;
const MAX_ROW_AMOUNT = 1000000000;
const DW_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const METHOD_META = {
  lunas: { cls: 'lunas', label: 'dist.lunas' },
  bon: { cls: 'bon', label: 'dist.bon' },
  pelunasan: { cls: 'pelunasan', label: 'dist.pelunasan' },
};
const methodLabel = (m) => trD(METHOD_META[m] ? METHOD_META[m].label : 'dist.lunas') || m;
const BIZ_NAME = 'AirRO Reverse Osmosis';
const BIZ_SUB = 'Air Minum Reverse Osmosis';
// Colour class per seed type id; anything else (custom types) uses the neutral 'other'.
const CUST_TAG = { reguler: 'reg', kos: 'kos', cafe: 'cafe', bulk: 'bulk' };
const typeLabel = (t) => (t === 'bulk' ? 'Bulk' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Reguler');
// A hidden search string for a customer dropdown option — matches on code, name, phone AND type
// even when the visible label doesn't show all of them (so typing "C-0136" or a phone fragment
// finds the customer). Used by the searchable UI.Dropdown.
const custSearchStr = (c) => [c.code, c.name, c.phone, c.type].filter(Boolean).join(' ');
// Readable label for a customer option: "C-0136 · A.A. Wintara · Reguler" (type only when not reguler).
const custOptLabel = (c) => (c.code ? c.code + ' · ' : '') + c.name + (c.type && c.type !== 'reguler' ? ' · ' + typeLabel(c.type) : '');
// Delivery-day codes (Mon…Sun). Server stores the customer's days as a subset of these.
const DAY_CODES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
// Map a single day token → canonical code. Accepts Indonesian (Sen/Senin), English (Mon/Monday)
// and numeric (1=Mon … 7=Sun, 0=Sun) forms, case-insensitive. Unknown → null.
const DAY_TOKEN = {
  sen: 'Sen', senin: 'Sen', mon: 'Sen', monday: 'Sen', '1': 'Sen',
  sel: 'Sel', selasa: 'Sel', tue: 'Sel', tues: 'Sel', tuesday: 'Sel', '2': 'Sel',
  rab: 'Rab', rabu: 'Rab', wed: 'Rab', weds: 'Rab', wednesday: 'Rab', '3': 'Rab',
  kam: 'Kam', kamis: 'Kam', thu: 'Kam', thur: 'Kam', thurs: 'Kam', thursday: 'Kam', '4': 'Kam',
  jum: 'Jum', jumat: 'Jum', "jum'at": 'Jum', fri: 'Jum', friday: 'Jum', '5': 'Jum',
  sab: 'Sab', sabtu: 'Sab', sat: 'Sab', saturday: 'Sab', '6': 'Sab',
  min: 'Min', minggu: 'Min', mgg: 'Min', sun: 'Min', sunday: 'Min', '7': 'Min', '0': 'Min',
};
// Parse a "Hari Kirim" cell (comma / space / pipe / slash / semicolon separated) → ordered,
// de-duplicated day codes. Tolerates a full name by also trying its first 3 letters.
function parseDeliveryDays(cell) {
  const raw = String(cell == null ? '' : cell).trim();
  if (!raw) return [];
  const set = {};
  raw.split(/[\s,;|/]+/).forEach((tok) => {
    const t = tok.trim().toLowerCase(); if (!t) return;
    const code = DAY_TOKEN[t] || DAY_TOKEN[t.slice(0, 3)];
    if (code) set[code] = true;
  });
  return DAY_CODES.filter((d) => set[d]);   // canonical Sen→Min order
}
// Detailed customer filter — "nothing selected" baseline. Every field is optional and the
// server ANDs whatever is set. Kept at module scope so it's a stable reference for resets.
const EMPTY_FILTER = { types: [], bon: '', bonMin: '', days: [], daysMode: 'any', complete: '', hasLocation: '', priceMin: '', priceMax: '' };
const filterIsEmpty = (f) => !f.types.length && !f.bon && !f.bonMin && !f.days.length && !f.complete && !f.hasLocation && !f.priceMin && !f.priceMax;
const filterCount = (f) => (f.types.length ? 1 : 0) + (f.bon ? 1 : 0) + (f.bonMin ? 1 : 0) + (f.days.length ? 1 : 0)
  + (f.complete ? 1 : 0) + (f.hasLocation ? 1 : 0) + (f.priceMin || f.priceMax ? 1 : 0);

// One removable chip per ACTIVE criterion. Each chip clears just its own criterion.
function activeFilterChips(f, setF, typeMap) {
  const out = [];
  const set = (patch) => setF({ ...f, ...patch });
  if (f.types.length) out.push({ key: 'types', label: trD('dist.fTipe') + ': ' + f.types.map((t) => (typeMap[t] && typeMap[t].label) || t).join(', '), clear: () => set({ types: [] }) });
  if (f.bon) out.push({ key: 'bon', label: f.bon === 'ada' ? trD('dist.fBonAda') : trD('dist.fBonLunas'), clear: () => set({ bon: '' }) });
  if (f.bonMin) out.push({ key: 'bonMin', label: trD('dist.fBonMin') + ' ' + rpFull(+f.bonMin || 0), clear: () => set({ bonMin: '' }) });
  if (f.days.length) out.push({ key: 'days', label: trD('dist.fDays') + ': ' + f.days.join(', ') + (f.daysMode === 'all' ? ' (' + trD('dist.fDaysAll') + ')' : ''), clear: () => set({ days: [], daysMode: 'any' }) });
  if (f.complete) out.push({ key: 'complete', label: f.complete === 'lengkap' ? trD('dist.fComplete') : trD('dist.fIncomplete'), clear: () => set({ complete: '' }) });
  if (f.hasLocation) out.push({ key: 'hasLocation', label: f.hasLocation === 'ya' ? trD('dist.fLocYes') : trD('dist.fLocNo'), clear: () => set({ hasLocation: '' }) });
  if (f.priceMin || f.priceMax) out.push({ key: 'price', label: trD('dist.fPrice') + ': ' + (f.priceMin ? rpFull(+f.priceMin) : '—') + ' – ' + (f.priceMax ? rpFull(+f.priceMax) : '—'), clear: () => set({ priceMin: '', priceMax: '' }) });
  return out;
}

// The detailed filter. A collapsible panel on desktop; a bottom sheet on mobile (CSS) —
// single scroll, chips wrap, safe-area honoured. Edits a DRAFT so nothing re-queries until
// "Terapkan" (or a criterion is cleared from the chip bar).
function CustomerFilterPanel({ value, types, onApply, onClose }) {
  const [d, setD] = uSx(value);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (patch) => setD({ ...d, ...patch });
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const num = (v) => v.replace(/[^0-9]/g, '');
  const Chip = ({ on, onClick, children }) => <button type="button" className={`cat-chip ${on ? 'on' : ''}`} onClick={onClick}>{on ? <IconCheck s={14} /> : <span style={{ width: 14 }} />}{children}</button>;

  return (
    <div className="modal-scrim dist-filter-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card dist-filter-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.filterT')}</div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fTipe')}</label>
          <div className="cat-chips">
            {(types || []).map((t) => <Chip key={t.id} on={d.types.includes(t.id)} onClick={() => set({ types: toggleIn(d.types, t.id) })}>{t.label}</Chip>)}
            {!(types || []).length && <div className="dist-empty" style={{ padding: 6 }}>—</div>}
          </div>

          <label className="fld-label">{trD('dist.fBon')}</label>
          <div className="cat-chips">
            <Chip on={d.bon === 'ada'} onClick={() => set({ bon: d.bon === 'ada' ? '' : 'ada' })}>{trD('dist.fBonAda')}</Chip>
            <Chip on={d.bon === 'lunas'} onClick={() => set({ bon: d.bon === 'lunas' ? '' : 'lunas' })}>{trD('dist.fBonLunas')}</Chip>
          </div>
          <div style={{ marginTop: 6 }}>
            <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fBonMin')}</label>
            <input className="fld tnum" inputMode="numeric" value={d.bonMin} placeholder="cth. 50000" onChange={(e) => set({ bonMin: num(e.target.value) })} />
          </div>

          <label className="fld-label">{trD('dist.fDays')}</label>
          <div className="cat-chips">
            {DAY_CODES.map((day) => <Chip key={day} on={d.days.includes(day)} onClick={() => set({ days: toggleIn(d.days, day) })}>{day}</Chip>)}
          </div>
          {d.days.length > 1 && (
            <div className="cat-chips" style={{ marginTop: 6 }}>
              <Chip on={d.daysMode !== 'all'} onClick={() => set({ daysMode: 'any' })}>{trD('dist.fDaysAny')}</Chip>
              <Chip on={d.daysMode === 'all'} onClick={() => set({ daysMode: 'all' })}>{trD('dist.fDaysAll')}</Chip>
            </div>
          )}

          <label className="fld-label">{trD('dist.fKelengkapan')}</label>
          <div className="cat-chips">
            <Chip on={d.complete === 'lengkap'} onClick={() => set({ complete: d.complete === 'lengkap' ? '' : 'lengkap' })}>{trD('dist.fComplete')}</Chip>
            <Chip on={d.complete === 'belum'} onClick={() => set({ complete: d.complete === 'belum' ? '' : 'belum' })}>{trD('dist.fIncomplete')}</Chip>
          </div>

          <label className="fld-label">{trD('dist.fLocation')}</label>
          <div className="cat-chips">
            <Chip on={d.hasLocation === 'ya'} onClick={() => set({ hasLocation: d.hasLocation === 'ya' ? '' : 'ya' })}>{trD('dist.fLocYes')}</Chip>
            <Chip on={d.hasLocation === 'tidak'} onClick={() => set({ hasLocation: d.hasLocation === 'tidak' ? '' : 'tidak' })}>{trD('dist.fLocNo')}</Chip>
          </div>

          <label className="fld-label">{trD('dist.fPrice')}</label>
          <div className="gud-row2">
            <div><input className="fld tnum" inputMode="numeric" value={d.priceMin} placeholder={trD('dist.fMin')} onChange={(e) => set({ priceMin: num(e.target.value) })} /></div>
            <div><input className="fld tnum" inputMode="numeric" value={d.priceMax} placeholder={trD('dist.fMax')} onChange={(e) => set({ priceMax: num(e.target.value) })} /></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => setD(EMPTY_FILTER)}>{trD('dist.fReset')}</button>
          <button className="btn btn-primary" onClick={() => onApply(d)}>{trD('dist.fApply')}</button>
        </div>
      </div>
    </div>
  );
}
const fmtDays = (arr) => (Array.isArray(arr) && arr.length ? DAY_CODES.filter((d) => arr.includes(d)).join(', ') : '');
const initialsOf = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
// Missing-field labels for the "Data belum lengkap" chips (keys match server completeness output).
const MISSING_KEYS = { phone: 'dist.mPhone', location: 'dist.mLoc', armada: 'dist.mArmada', deliveryDays: 'dist.mDays', price: 'dist.mPrice' };
const missChips = (missing) => (missing || []).map((k) => <span key={k} className="dist-miss-chip">{trD(MISSING_KEYS[k] || k)}</span>);
const AUDIT_KIND = { koreksi: { cls: 'koreksi', k: 'dist.akKoreksi' }, harga: { cls: 'harga', k: 'dist.akHarga' }, input: { cls: 'input', k: 'dist.akInput' }, impor: { cls: 'input', k: 'dist.akImpor' }, pelanggan: { cls: 'input', k: 'dist.akPelanggan' }, batal: { cls: 'koreksi', k: 'dist.akBatal' }, hapus: { cls: 'harga', k: 'dist.akHapus' }, akses: { cls: 'akses', k: 'dist.akAkses' } };
// Indonesian phone normalisation — MIRRORS server/src/utils/phone.js exactly (that one is
// authoritative; this is for live preview/dedupe in the browser). Excel silently drops the
// leading 0 from a phone column and people paste "+62 …", so every number is repaired to the
// stored "08…" form — staff never have to reformat a spreadsheet.
//   "" → ""  ·  "+62 812-1122-3344" → "081211223344"  ·  "81211223344" → "081211223344"
//   "6281…" → "081…"  ·  "081…" → "081…"  ·  other digits kept as-is (landline/short)
// Excel often stores a long phone column as a NUMBER and renders it in scientific notation
// (e.g. "8.1234E+11"). Stripping non-digits from that literal would mangle it ("8123411"), so
// expand any scientific-notation value back to its full integer digits BEFORE normalising.
function expandSciDigits(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (/^[+-]?\d(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (isFinite(n)) return Math.round(n).toLocaleString('fullwide', { useGrouping: false });
  }
  return s;
}
function normalizePhone(raw) {
  const d = expandSciDigits(raw).replace(/\D/g, '');   // strips +, spaces, dashes, dots
  if (!d) return '';
  if (d.startsWith('62')) return '0' + d.slice(2);   // +62… / 62… → 0…
  if (d.startsWith('0')) return d;
  if (d.startsWith('8')) return '0' + d;             // bare 8… (Excel dropped the 0) → 0…
  return d;                                          // 62-without-8, landline, short code → as-is
}
// Did normalisation actually repair the number (vs just strip formatting)? Drives the
// "0 dipulihkan" hint in the import preview so the fix is transparent, not silent.
const phoneWasFixed = (raw) => { const d = expandSciDigits(raw).replace(/\D/g, ''); return !!d && normalizePhone(raw) !== d; };
// WhatsApp wants the international form. Numbers are stored "08…", so: 62 + rest.
const waNumber = (raw) => { const p = normalizePhone(raw); return p.startsWith('0') ? '62' + p.slice(1) : p; };

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDT(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getDate() + ' ' + MONTHS_ID[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
// Local YYYY-MM-DD helpers for the Cash Integration period picker.
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const isoAddDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
function periodRange(period, today) {
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: isoAddDays(today, -6), to: today };
  return { from: today.slice(0, 8) + '01', to: today }; // month-to-date
}
function copyText(text, done) {
  const fin = () => { if (done) done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(fin).catch(() => fin()); return; }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) { /* ignore */ }
  fin();
}

// ── 7-day stacked bar (cash = navy, bon = amber) ──
// Round up to a "nice" axis maximum (1 · 2 · 2.5 · 5 × 10^k) so gridline ticks read cleanly.
function niceCeil(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}
// Compact Rupiah for axis ticks / bar labels ("Rp 1,2jt", "Rp 500rb", "Rp 0").
function rpTick(v) {
  const n = Math.round(v || 0);
  if (n >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'jt';
  if (n >= 1e3) return 'Rp ' + Math.round(n / 1e3) + 'rb';
  return 'Rp ' + n;
}
const DIST_MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function chartDayLabel(dateStr) { const d = new Date(dateStr + 'T00:00'); return DW_ID[d.getDay()] + ', ' + d.getDate() + ' ' + DIST_MON_SHORT[d.getMonth()]; }

// Trend chart: stacked lunas/bon bars with a Rupiah Y axis + gridlines, value labels, an on-hover
// tooltip (tanggal · lunas · bon · total), a real empty state, and bars that CENTER + cap their width
// (never stretch the scale) when the period has only 1–2 days.
function SevenDayChart({ last7 }) {
  const [hover, setHover] = uSx(null);
  const data = (last7 || []).map((d) => ({ date: d.date, lunas: d.lunas || 0, bon: d.bon || 0, total: (d.lunas || 0) + (d.bon || 0) }));
  const anyData = data.some((d) => d.total > 0);
  if (data.length === 0 || !anyData) {
    return <div className="dist-chart-empty"><IconTx s={20} /><span>{trD('dist.chartEmpty')}</span></div>;
  }
  const niceMax = niceCeil(Math.max(...data.map((d) => d.total)));
  const TICKS = 4;
  const ticks = []; for (let i = TICKS; i >= 0; i--) ticks.push((niceMax / TICKS) * i);
  const single = data.length <= 2;                 // 1–2 points → centered, capped bars, shorter plot
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div className={'dist-chart2' + (single ? ' single' : '')}>
      <div className="dist-chart2-yaxis">{ticks.map((t, i) => <span key={i} className="dist-chart2-tick">{rpTick(t)}</span>)}</div>
      <div className="dist-chart2-plot">
        <div className="dist-chart2-grid" aria-hidden="true">{ticks.map((t, i) => <span key={i} />)}</div>
        <div className={'dist-chart2-bars' + (single ? ' single' : '')}>
          {data.map((d, i) => {
            const h = (d.total / niceMax) * 100;
            const bonH = d.total ? (d.bon / d.total) * 100 : 0;
            const lunH = d.total ? (d.lunas / d.total) * 100 : 0;
            return (
              <div key={d.date} className="dist-chart2-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}>
                <div className="dist-chart2-barwrap">
                  {d.total > 0 && <span className="dist-chart2-vlabel">{rpTick(d.total)}</span>}
                  <div className="dist-chart2-bar" style={{ height: Math.max(h, d.total > 0 ? 2 : 0) + '%' }}>
                    <div className="dist-bar-seg bon" style={{ height: bonH + '%' }} />
                    <div className="dist-bar-seg lunas" style={{ height: lunH + '%' }} />
                  </div>
                  {hover === i && (
                    <div className="dist-chart2-tip" role="tooltip">
                      <div className="dist-chart2-tip-d">{chartDayLabel(d.date)}</div>
                      <div className="dist-chart2-tip-r"><span><span className="dot navy" />{trD('dist.lunas')}</span><b>{rpFull(d.lunas)}</b></div>
                      <div className="dist-chart2-tip-r"><span><span className="dot amber" />{trD('dist.bon')}</span><b>{rpFull(d.bon)}</b></div>
                      <div className="dist-chart2-tip-r total"><span>{trD('dist.total')}</span><b>{rpFull(d.total)}</b></div>
                    </div>
                  )}
                </div>
                <span className="dist-chart2-xlbl">{(i % labelStep === 0 || i === data.length - 1) ? chartDayLabel(d.date) : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Fleet scope helpers. fleetScope is 'all' (or null) for full access, or an array of
// fleet names for a scoped user. The effective fleet passed to the API: for full access
// it's the chosen filter; for a scoped user it's 'all' (the server enforces the scope).
const isScoped = (fleetScope) => Array.isArray(fleetScope);
const effFleet = (fleetScope, distFleet) => (isScoped(fleetScope) ? 'all' : (distFleet || 'all'));
// A bar above the Distribusi screens: a label ("Armada: Merah") for scoped users, or a
// Semua/Merah/Biru toggle for full-access users so a GM can see the combined or per-fleet view.
function FleetBar({ fleetScope, fleet, value, onChange }) {
  if (isScoped(fleetScope)) {
    if (!fleetScope.length) return null;
    return <div className="dist-fleetbar scoped"><IconTruck s={14} /><span>{trD('dist.fleetLabel')}:</span><b>{fleetScope.join(', ')}</b></div>;
  }
  const opts = ['all', ...((fleet || []).filter(Boolean))];
  if (opts.length <= 1) return null;   // no fleets defined → nothing to toggle
  return (
    <div className="dist-fleetbar">
      <span className="dist-fleetbar-lbl"><IconTruck s={14} />{trD('dist.fleetFilter')}</span>
      <div className="dist-chips">
        {opts.map((f) => <button key={f} type="button" className={`dist-chip ${(value || 'all') === f ? 'on' : ''}`} onClick={() => onChange(f)}>{f === 'all' ? trD('dist.fleetAll') : f}</button>)}
      </div>
    </div>
  );
}

function Kpi({ icon, tile, fg, value, unit, label, cls, pill, pillCls, hero, sub, loading }) {
  // Every KPI is a `stat-box` → identical padding/size on all four. `dist-kpi-hero`
  // is a COLOUR-ONLY modifier (gradient + light text); it must not change the size.
  // A KPI card NEVER renders without its label; a null/undefined value shows "—" + a muted
  // "data tidak tersedia" instead of a blank card, and `loading` shows a skeleton value.
  const hasVal = value !== null && value !== undefined && value !== '';
  const safeLabel = label || trD('dist.kpiUnknown');
  return (
    <div className={`card stat-box dist-kpi ${hero ? 'dist-kpi-hero' : ''}`}>
      <div className="dist-kpi-top">
        <span className={`icon-tile ${hero ? 'hero' : ''}`} style={hero ? null : { background: tile, color: fg }}>{IcX(icon, { s: 19 })}</span>
        {pill ? <span className={`dist-kpi-pill ${pillCls || ''}`}>{pill}</span> : null}
      </div>
      {loading
        ? <div className="dist-kpi-skel" aria-hidden="true" />
        : <div className={`tnum dist-kpi-val ${cls || ''} ${hasVal ? '' : 'na'}`}>{hasVal ? value : '—'}{hasVal && unit ? <span className="dist-kpi-unit"> {unit}</span> : null}</div>}
      <div className="dist-kpi-lbl">{safeLabel}</div>
      {loading ? null : (!hasVal ? <div className="dist-kpi-sub dist-kpi-na">{trD('dist.kpiNA')}</div> : (sub ? <div className="dist-kpi-sub">{sub}</div> : null))}
    </div>
  );
}

function DistDashboard({ refreshKey, staffMode, canInput, canHistory, onQuickInput, onOpenCustomers, onOpenTransactions, today, fleetScope, fleet, distFleet, setDistFleet }) {
  const [sum, setSum] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  const [bump, setBump] = uSx(0);
  const [period, setPeriod] = uSx('today');   // today | week | month | range (history-cap only)
  const [rFrom, setRFrom] = uSx(today);       // custom-range endpoints
  const [rTo, setRTo] = uSx(today);
  const [payCust, setPayCust] = uSx(null);   // Perlu-ditagih → catat Pelunasan
  const [invCust, setInvCust] = uSx(null);    // Perlu-ditagih → buat Invoice (fetched detail)
  const [invView, setInvView] = uSx(null);
  const ef = effFleet(fleetScope, distFleet);
  // Without the history cap the dashboard is LOCKED to today (the server rejects anything else too).
  const per = canHistory ? period : 'today';
  const refetch = () => setBump((b) => b + 1);
  const openInvoice = (id) => { window.API.distribusi.customers.get(id).then((r) => setInvCust(r.data)).catch(() => {}); };
  const reasonLabel = (x) => x.type === 'bon' ? trD('dist.rlBon') : x.type === 'gallon' ? trD('dist.rlGallon', { n: x.value }) : x.type === 'overdue' ? trD('dist.rlOverdue', { n: x.days }) : x.type === 'dueDay' ? trD('dist.rlDueDay', { n: x.day }) : x.type === 'weekly' ? trD('dist.rlWeekly', { d: x.weekday }) : x.type;
  uEx(() => {
    let live = true; setErr(false);
    if (!(window.API && window.API.distribusi)) { setLoading(false); setErr(trD('dist.loadErr')); return; }
    const opts = per === 'range' ? { period: 'range', dateFrom: rFrom, dateTo: rTo, fleet: ef } : { period: per, fleet: ef };
    window.API.distribusi.summary(opts).then((r) => { if (live) { setSum(r.data); setLoading(false); } })
      // Keep the REAL server message so the screen can show WHY (not a generic dead card), and let the
      // user retry. A 503 readiness-style failure now reads clearly instead of a blank dashboard.
      .catch((e) => { if (live) { setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, today, ef, bump, per, rFrom, rTo]);

  const periodLabel = { today: trD('dist.perToday'), week: trD('dist.per7d'), month: trD('dist.perMonth'), range: trD('dist.perRange') }[per] || trD('dist.perToday');
  const periodSelector = canHistory ? (
    <div className="dist-period-bar">
      <div className="dist-chips">
        {[['today', trD('dist.perToday')], ['week', trD('dist.per7d')], ['month', trD('dist.perMonth')], ['range', trD('dist.perRange')]].map(([k, l]) => (
          <button key={k} type="button" className={`dist-chip ${per === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      {per === 'range' && (
        <div className="dist-period-range">
          <DP.DateField value={rFrom} onChange={setRFrom} max={rTo || today} />
          <span>–</span>
          <DP.DateField value={rTo} onChange={setRTo} min={rFrom || undefined} max={today} />
        </div>
      )}
    </div>
  ) : (
    <div className="dist-period-bar"><span className="dist-period-locked"><IconCalendar s={13} />{trD('dist.perTodayOnly')}</span></div>
  );

  const fleetBar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  // Human caption for the ACTIVE fleet scope — so "Bon Baru / Hari ini" reads unambiguously.
  const fleetCaption = isScoped(fleetScope) ? (fleetScope || []).join(', ') : (ef && ef !== 'all' ? ef : trD('dist.fleetAll'));
  if (loading) return (
    <div className="dist-dash screen-enter">{fleetBar}{periodSelector}
      <div className="dist-grid">
        <div className="dist-main">
          <div className="dist-kpis">
            <Kpi loading hero icon="IconDrop" label={trD('dist.kpiGalon')} pill={periodLabel} pillCls="hero" />
            <Kpi loading icon="IconCoinIn" tile="var(--pos-bg)" fg="var(--green-800)" label={trD('dist.kpiIn')} pill={periodLabel} pillCls="pos" />
            <Kpi loading icon="IconInvoice" tile="var(--warn-bg)" fg="var(--warn)" label={trD('dist.kpiBonBaru')} pill={periodLabel} pillCls="warn" />
            <Kpi loading icon="IconWallet" tile="#F3ECFD" fg="#7c3aed" label={trD('dist.totalPiutang')} pill={trD('dist.allTimeScope')} pillCls="slate" />
            <Kpi loading icon="IconTx" tile="#EAF1F4" fg="#5E7A88" label={trD('dist.kpiTxn')} pill={periodLabel} pillCls="blue" />
          </div>
          <div className="card dist-card"><div className="dist-skel" style={{ height: 150 }} /></div>
          <div className="card dist-card"><div className="dist-skel" /><div className="dist-skel" /><div className="dist-skel" /></div>
        </div>
        <div className="dist-rail">
          <div className="card dist-card"><div className="dist-skel" style={{ height: 96 }} /></div>
          <div className="card dist-card"><div className="dist-skel" /><div className="dist-skel" /></div>
        </div>
      </div>
    </div>
  );
  if (err || !sum) return (
    <div className="dist-dash screen-enter">{fleetBar}
      <div className="card dist-loadfail" style={{ padding: 32, textAlign: 'center' }}>
        <IconWarn s={22} />
        <div className="dist-loadfail-msg">{typeof err === 'string' && err ? err : trD('dist.loadErr')}</div>
        <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setLoading(true); refetch(); }}><IconRefresh s={15} />{trD('common.retry')}</button>
      </div>
    </div>
  );

  const recent = sum.recent || [];
  const top = sum.topCustomers || [];
  const avgNota = sum.count ? Math.round(sum.amount / sum.count) : 0;
  return (
    <div className="dist-dash screen-enter">
      {fleetBar}
      {periodSelector}
      {staffMode && (
        <div className="dist-staff-banner"><span className="dist-staff-ic"><IconShield s={16} /></span><div><b>{trD('dist.staffMode')}</b><span>{trD('dist.staffModeSub')}</span></div></div>
      )}

      <div className="dist-grid">
        <div className="dist-main">
          <div className="dist-kpis">
            <Kpi hero icon="IconDrop" value={sum.periodQty != null ? numX(sum.periodQty) : null} unit={trD('dist.galonUnit')} label={trD('dist.kpiGalon')} pill={periodLabel} pillCls="hero" />
            <Kpi icon="IconCoinIn" tile="var(--pos-bg)" fg="var(--green-800)" value={sum.periodIn != null ? rpFull(sum.periodIn) : null} label={trD('dist.kpiIn')} cls="amt-pos" pill={periodLabel} pillCls="pos"
              sub={<><span className="dist-kpi-cash"><span className="dist-cash-dot cash" />{trD('dist.cashLbl')} {rpFull(sum.periodInCash || 0)}</span><span className="dist-kpi-cash"><span className="dist-cash-dot xfer" />{trD('dist.xferLbl')} {rpFull(sum.periodInTransfer || 0)}</span></>} />
            {/* BON BARU — bon created within the SELECTED period+fleet (sum.piutang = byMethod.bon).
                All-time outstanding is now its OWN card (below) so one card never mixes two scopes. */}
            <Kpi icon="IconInvoice" tile="var(--warn-bg)" fg="var(--warn)" value={sum.piutang != null ? rpFull(sum.piutang) : null} label={trD('dist.kpiBonBaru')} pill={periodLabel} pillCls="warn"
              sub={<span className="dist-kpi-cap">{periodLabel} · {fleetCaption}</span>} />
            {/* TOTAL PIUTANG — all-time outstanding bon. Carries an ALL-TIME scope chip (never the
                active-period chip) so its different time scope is unambiguous. */}
            <Kpi icon="IconWallet" tile="#F3ECFD" fg="#7c3aed" value={sum.receivable != null ? rpFull(sum.receivable) : null} label={trD('dist.totalPiutang')} pill={trD('dist.allTimeScope')} pillCls="slate"
              sub={<span className="dist-kpi-cap">{trD('dist.allTimeSub')} · {fleetCaption}</span>} />
            <Kpi icon="IconTx" tile="#EAF1F4" fg="#5E7A88" value={sum.count != null ? numX(sum.count) : null} label={trD('dist.kpiTxn')} pill={periodLabel} pillCls="blue" />
          </div>

          {(sum.reminders || []).length > 0 && (
            <div className="card dist-card dist-remind-card">
              <div className="dist-card-head"><div className="sec-title"><IconInvoice s={15} style={{ marginRight: 6, verticalAlign: '-2px', color: 'var(--warn)' }} />{trD('dist.needBilling')} <span className="dist-remind-count">{sum.reminders.length}</span></div></div>
              {sum.reminders.map((rm) => (
                <div key={rm.customerId} className="dist-remind-row">
                  <div className="dist-remind-mid">
                    <div className="dist-remind-name">{rm.name}{rm.armada ? <span className="dist-remind-fleet">{rm.armada}</span> : null}</div>
                    <div className="dist-remind-sub"><b className="amt-neg">{rpFull(rm.sisaBon)}</b>{rm.since ? ' · ' + trD('dist.since') + ' ' + rm.since + ' (' + trD('dist.daysAgo', { n: rm.ageDays }) + ')' : ''} · {rm.reasons.map(reasonLabel).join(', ')}</div>
                  </div>
                  {canInput && (
                    <div className="dist-remind-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => openInvoice(rm.customerId)}><IconInvoice s={13} />{trD('dist.makeInvoice')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPayCust({ id: rm.customerId, name: rm.name, sisaBon: rm.sisaBon })}><IconCoinIn s={13} />{trD('dist.payBon')}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="card dist-card">
            <div className="dist-card-head">
              <div className="sec-title">{trD('dist.chartTrend')} · {periodLabel}</div>
              <div className="dist-legend">
                <span><span className="dot navy" />{trD('dist.lunas')}</span>
                <span><span className="dot amber" />{trD('dist.bon')}</span>
              </div>
            </div>
            <SevenDayChart last7={sum.last7 || []} />
          </div>

          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title">{trD('dist.recent')}</div>{onOpenTransactions && recent.length > 0 && <button className="dist-link" onClick={onOpenTransactions}>{trD('dist.seeAll')}</button>}</div>
            {recent.length === 0 && <div className="dist-empty">{trD('dist.noTxn')}</div>}
            {recent.map((t) => (
              <div key={t.id} className="dist-txn">
                <span className="dist-txn-av">{(t.customerName || '?').slice(0, 1).toUpperCase()}</span>
                <div className="dist-txn-mid">
                  <div className="dist-txn-line1">
                    <span className="dist-txn-name">{t.customerName || '—'}</span>
                    <span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span>
                    {t.corrected ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}
                    {t.adjusted ? <span className="dist-badge adj"><IconInvoice s={10} />{trD('dist.adjusted')}</span> : null}
                  </div>
                  <div className="dist-txn-sub">{numX(t.qty)} × {rpFull(t.unitPriceLocked)}</div>
                </div>
                <div className="dist-txn-right">
                  <div className="tnum dist-txn-amt">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</div>
                  <span className={`dist-status ${METHOD_META[t.method] ? METHOD_META[t.method].cls : ''}`}>{methodLabel(t.method)}</span>
                </div>
              </div>
            ))}
            {recent.length > 0 && sum.count > recent.length && (
              <button type="button" className="dist-listfoot" onClick={onOpenTransactions}>
                <span>{trD('dist.showingOf', { n: recent.length, total: numX(sum.count) })}</span>
                {onOpenTransactions && <span className="dist-link">{trD('dist.seeAll')} →</span>}
              </button>
            )}
          </div>
        </div>

        <div className="dist-rail">
          <div className="card dist-today-hero">
            {/* Right rail = ONLY what the KPI strip doesn't already show: field expenses, net cash to
                deposit, avg/nota, and per-armada deposits. Uang Masuk / Bon Baru live in the KPI strip
                (single source of truth) and are intentionally NOT repeated here. */}
            <div className="dist-th-top"><span>{trD('dist.railTitle')} · {per === 'today' ? trD('dist.today') : periodLabel}</span><span className="dist-th-count">{numX(sum.count)} {trD('dist.notaWord')}</span></div>
            {/* Net cash to deposit = cash money-in − field expenses paid from that cash. */}
            <div className="dist-th-net">
              <div className="dist-th-net-row"><span>{trD('dist.fieldExpense')}</span><b className="tnum neg">− {rpFull(sum.todayExpense || 0)}</b></div>
              <div className="dist-th-net-row total"><span>{trD('dist.netCash')}</span><b className="tnum">{rpFull(sum.todayNetCash != null ? sum.todayNetCash : (sum.todayCash || 0))}</b></div>
              <div className="dist-th-net-formula">{trD('dist.netCashFormula')}</div>
            </div>
            <div className="dist-th-avg"><span>{trD('dist.avgNota')}</span><b className="tnum">{rpFull(avgNota)}</b></div>
            {(sum.todayCashByFleet || []).length > 1 && (
              <div className="dist-th-fleetcash">
                <div className="dist-th-fleetcash-h">{trD('dist.cashPerFleet')}</div>
                {sum.todayCashByFleet.map((f) => (
                  <div key={f.fleetId || '—'} className="dist-th-fleetcash-row">
                    <span className="dist-th-fleetcash-name">{f.fleetId || trD('dist.noFleet')}</span>
                    <span className="dist-th-fleetcash-nums">{(f.expense || 0) > 0 ? <span className="dist-th-fleetcash-exp">{rpFull(f.cash)} − {rpFull(f.expense)}</span> : null}<b className="tnum">{rpFull(f.netCash != null ? f.netCash : f.cash)}</b></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canInput && (
          <div className="card dist-quick">
            <div className="dist-quick-t">{trD('dist.quickInput')}</div>
            <div className="dist-quick-s">{trD('dist.quickInputSub')}</div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onQuickInput}><IconPlus s={16} />{trD('dist.quickInputBtn')}</button>
          </div>
          )}

          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title">{trD('dist.topCust')}</div>{onOpenCustomers && <button className="dist-link" onClick={onOpenCustomers}>{trD('dist.seeAll')}</button>}</div>
            {top.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
            {top.map((c, i) => (
              <div key={c.id} className="dist-topc">
                <span className="dist-topc-rank">{i + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}><div className="dist-topc-name">{c.name || '—'}</div><div className="dist-topc-sub">{numX(c.qty)} {trD('dist.galonUnit')}</div></div>
                <b className="tnum dist-topc-amt">{rpFull(c.amount)}</b>
              </div>
            ))}
            {top.length > 0 && sum.customers > top.length && (
              <button type="button" className="dist-listfoot" onClick={onOpenCustomers}>
                <span>{trD('dist.showingOf', { n: top.length, total: numX(sum.customers) })}</span>
                {onOpenCustomers && <span className="dist-link">{trD('dist.seeAll')} →</span>}
              </button>
            )}
          </div>
        </div>
      </div>
      {payCust && <PaymentModal customers={[payCust]} presetCustomer={payCust.id} staffMode={staffMode} today={today} onClose={() => setPayCust(null)} onSaved={() => { setPayCust(null); refetch(); }} />}
      {invCust && <InvoiceBuilder customer={invCust} onClose={() => setInvCust(null)} onCreated={(iv) => { setInvCust(null); setInvView(iv); refetch(); }} />}
      {invView && <InvoiceViewer invoice={invView} onClose={() => setInvView(null)} />}
    </div>
  );
}

// ════════════════ TRANSAKSI (list + input form + correction) ════════════════
// All data via /distribusi REST. Transactions are IMMUTABLE — no delete anywhere;
// a mistake is fixed by appending a Koreksi (server flags staff corrections). Price
// is locked server-side from the customer master price; we only preview it here.
function shortRef(id) { return '#' + String(id || '').slice(-6).toUpperCase(); }
function hhmm(ms) { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
// ════════ Customer-detail presentation helpers (design-system, presentation-only) ════════
// "12 Jan 2026" from an ISO string OR epoch ms OR a "YYYY-MM-DD" date. Never truncates.
function fmtDateShort(v) {
  if (!v) return '';
  const d = typeof v === 'number' ? new Date(v) : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(v + 'T00:00') : new Date(v));
  if (isNaN(d)) return String(v);
  return d.getDate() + ' ' + MONTHS_ID[d.getMonth()] + ' ' + d.getFullYear();
}
const fmtMonthYear = (ym) => { const [y, m] = ym.split('-'); return MONTHS_ID[(+m) - 1] + ' ' + y; };
const monthKeyOf = (t) => (t.txnDate && /^\d{4}-\d{2}/.test(t.txnDate)) ? t.txnDate.slice(0, 7) : (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 7) : '');
// A stable, copyable transaction code: the existing code if present, else TRX-<yyyymm>-<last6 of id>.
function txnCode(t) {
  if (t.code) return t.code;
  const ym = (t.txnDate && /^\d{4}-\d{2}/.test(t.txnDate)) ? t.txnDate.slice(0, 7).replace('-', '') : (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 7).replace('-', '') : '000000');
  return 'TRX-' + ym + '-' + String(t.id || '').slice(-6).toUpperCase();
}
// The signed receivable effect of a transaction on sisa bon (bonCounted rows only; a void contributes
// nothing). Mirrors the server's BON_TXN rule so a client-side running balance stays honest.
function bonEffectOf(t) {
  if (t.voided || t.status === 'void' || !t.bonCounted) return 0;
  if (t.method === 'bon') {
    let e = (t.effectiveAmount != null ? t.effectiveAmount : t.amount);
    if (disputeDeducts(t)) e -= (t.dispute.disputedAmount || 0);   // tidak_diakui/kerugian carve-out
    return Math.max(0, e);
  }
  if (t.method === 'pelunasan') return -t.amount;
  return 0;
}
// A transaction whose ACTIVE dispute removes its amount from the receivable (still shown, struck).
function disputeDeducts(t) { return !!(t.dispute && t.dispute.deducts && (t.dispute.status === 'tidak_diakui' || t.dispute.status === 'kerugian')); }
// Badge metadata per dispute status. Colours: amber (raised) · red-outline (tidak diakui) ·
// red-solid (kerugian) · green-outline (re-acknowledged).
const DISPUTE_META = {
  disengketakan: { cls: 'disp-amber', label: 'cd.dispDisengketakan' },
  tidak_diakui: { cls: 'disp-redout', label: 'cd.dispTidakDiakui' },
  kerugian: { cls: 'disp-redsolid', label: 'cd.dispKerugian' },
  diakui_kembali: { cls: 'disp-greenout', label: 'cd.dispDiakuiKembali' },
};
// Reason label that tolerates an ABSENT reason (Alasan is optional) — shows "—" instead of a raw key.
const dispReasonLabel = (r) => (r ? trD('disp.reason.' + r) : '—');
// Copy-to-clipboard chip/button. aria-labelled; shows a brief "✓" on success.
function CopyBtn({ text, label, cls }) {
  const [ok, setOk] = uSx(false);
  return <button type="button" className={'dist-copy ' + (cls || '')} aria-label={(label || 'Salin') + ': ' + text} title={label || 'Salin'} onClick={(e) => { e.stopPropagation(); copyText(String(text), () => { setOk(true); setTimeout(() => setOk(false), 1200); }); }}>{ok ? <IconCheck s={12} /> : <IconInvoice s={12} />}</button>;
}
// One KPI card. tone: '' | 'bon' (amber) | 'ok' (green). `action` = optional inline node (link).
function KpiCard({ label, value, sub, tone, action }) {
  return (
    <div className={'cd-kpicard ' + (tone ? 'k-' + tone : '')}>
      <div className="cd-kpi-lbl">{label}{action ? <span className="cd-kpi-act">{action}</span> : null}</div>
      <div className="cd-kpi-val tnum">{value}</div>
      {sub ? <div className="cd-kpi-sub">{sub}</div> : null}
    </div>
  );
}
// The four canonical list states. `state`: 'loading' | 'empty' | 'error' | 'nofilter'.
function ListState({ state, onRetry, onClear, emptyText, emptyAction }) {
  if (state === 'loading') return <div className="dist-liststate"><div className="dist-skel" /><div className="dist-skel" /><div className="dist-skel" /></div>;
  if (state === 'error') return <div className="dist-liststate col"><IconWarn s={22} /><div>{trD('dist.loadErr')}</div>{onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>{trD('dist.retry')}</button>}</div>;
  if (state === 'nofilter') return <div className="dist-liststate col"><IconInvoice s={22} /><div>{trD('dist.noResultFilter')}</div>{onClear && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>{trD('dist.clearFilter')}</button>}</div>;
  return <div className="dist-liststate col"><IconInvoice s={22} /><div>{emptyText || trD('dist.noTxn')}</div>{emptyAction || null}</div>;
}
// Lazy-load SheetJS — only when an .xlsx/.xls file is chosen, so its ~930 KB never
// touches the initial page load. (CSV needs no library; it's parsed as plain text.)
// Served from OUR origin (vendor/), not cdn.sheetjs.com: that CDN has failed before,
// and an Excel import must not depend on a third party being reachable.
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    let s = document.getElementById('sheetjs-vendor');
    if (s) { s.addEventListener('load', () => resolve(window.XLSX)); s.addEventListener('error', () => reject(new Error('sheetjs'))); return; }
    s = document.createElement('script'); s.id = 'sheetjs-vendor';
    s.src = '/vendor/xlsx.full.min.js';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('sheetjs')));
    s.onerror = () => reject(new Error('sheetjs'));
    document.head.appendChild(s);
  });
}
// Split a delimited line the same way the paste box does (tab / comma / semicolon).
const splitCells = (line) => line.split(/\t|,|;/).map((s) => s.trim());
// Download a ready-to-fill CSV template (header + one example row).
function downloadImportTemplate() {
  const rows = [
    ['Nama', 'No HP', 'Tipe', 'Harga', 'Hari Kirim', 'Armada', 'Alamat', 'Maps'],
    ['Warung Sejahtera', '0821-1122-3344', 'Reguler', '12500', 'Sen;Rab;Jum', 'Merah', 'Jl. Melati No. 7', 'https://maps.app.goo.gl/xxxx'],
  ];
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'template-pelanggan.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Parse a date CELL (imported legacy history) into strict YYYY-MM-DD, or null if unparseable.
// ROBUST + DAY-FIRST (Indonesian convention). Accepts:
//   • a real Date object / Excel date  — read LOCAL y/m/d parts (never toISOString: that shifts the
//     day across a timezone; SheetJS builds date cells at local midnight).
//   • an Excel serial number (e.g. 45678, 46017) — 1899-12-30 epoch (already accounts for the fake
//     1900 leap day for serials ≥ 60).
//   • ISO  yyyy-mm-dd  (also / or . separators)
//   • numeric d/m/y with any separator (/ - .), 2- or 4-digit year → dd/mm/yyyy, d-m-yy, 6.4.2026.
//     Ambiguous d/m vs m/d → ALWAYS day-first. 2-digit year: 00–79 → 2000s, 80–99 → 1900s.
//   • d MonthName y  — "12 Januari 2026", "9 Feb 2026", "6-Apr-26" — Indonesian month names
//     (Januari…Desember + Jan/Peb/Mei/Agu/Okt/Des) and English abbreviations (Jan…Dec), any sep.
// A REAL calendar date is required (32/13 → null). NO new Date(string)/Date.parse — locale-dependent.
// MIRRORED on the server (distribution.service.js parseLegacyDate) — keep both in sync.
const LEGACY_MONTHS = { jan: 1, januari: 1, feb: 2, februari: 2, peb: 2, pebruari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, nov: 11, november: 11, nop: 11, des: 12, dec: 12, desember: 12 };
function isoFromYMD(y, mo, d) { y = +y; mo = +mo; d = +d; const dt = new Date(Date.UTC(y, mo - 1, d)); return (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; }
function fullYear(yy) { yy = +yy; return yy >= 100 ? yy : (yy <= 79 ? 2000 + yy : 1900 + yy); }   // 00–79→2000s, 80–99→1900s
function excelSerialToISO(n) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return isNaN(dt.getTime()) ? null : `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`; }
function parseLegacyDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : isoFromYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') return (v > 59 && v < 80000) ? excelSerialToISO(v) : null;   // Excel serial
  const s = String(v == null ? '' : v).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return isoFromYMD(m[1], m[2], m[3]);         // ISO
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/); if (m) return isoFromYMD(fullYear(m[3]), m[2], m[1]);   // d/m/y day-first
  m = s.match(/^(\d{1,2})[\s./-]+([A-Za-z]+)\.?[\s./-]+(\d{2}|\d{4})$/);                                       // d MonthName y
  if (m) { const mo = LEGACY_MONTHS[m[2].toLowerCase()]; if (mo) return isoFromYMD(fullYear(m[3]), mo, m[1]); return null; }
  if (/^\d+(\.\d+)?$/.test(s)) { const n = +s; if (n > 59 && n < 80000) return excelSerialToISO(n); }          // serial as text
  return null;
}
// Parse a MONEY/qty cell → integer. Accepts "Rp 25.000", "25.000", "25 000", "25,000", "1.234,56",
// "", "-", "0". Strips currency + spaces; a comma or dot is the DECIMAL point only when it is the
// last separator with 1–2 trailing digits (so "25.000"/"25,000" = 25000 thousands, "1.234,56" =
// 1234.56). Empty / "-" → 0. Whole units (rupiah/gallons) → rounded.
function parseAmountCell(v) {
  if (typeof v === 'number') return Math.round(v);
  let s = String(v == null ? '' : v).trim();
  if (!s || s === '-') return 0;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  let dec = null;
  if (dots && commas) dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (dots === 1 && s.lastIndexOf('.') > 0 && s.length - s.lastIndexOf('.') - 1 <= 2) dec = '.';
  else if (commas === 1 && s.lastIndexOf(',') > 0 && s.length - s.lastIndexOf(',') - 1 <= 2) dec = ',';
  let intp, frac = '';
  if (dec) { const i = s.lastIndexOf(dec); intp = s.slice(0, i).replace(/[.,]/g, ''); frac = s.slice(i + 1).replace(/[.,]/g, ''); }
  else intp = s.replace(/[.,]/g, '');
  const n = parseFloat((intp || '0') + (frac ? '.' + frac : ''));
  return isNaN(n) ? 0 : Math.round(n);
}
// Normalise a header cell for matching: lowercase, strip accents + punctuation, collapse whitespace.
function normHeader(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/[^a-z0-9]+/g, ' ').trim(); }
const LEGACY_HDR = {
  date: /\b(tanggal|tgl|date)\b/, price: /\b(harga satuan|harga|price)\b/,
  lunas: /\b(pembelian lunas|beli lunas|lunas|tunai|cash)\b/,
  bon: /\b(pembelian bon|beli bon|hutang|piutang|kredit|bon)\b/,
  pay: /\b(pembayaran bon|bayar bon|pembayaran|pelunasan|setor)\b/,
  note: /\b(catatan|note|keterangan|ket)\b/,
};
// FIX 2 — find the header row (the first row where ≥2 cells match known headers) and map each field
// to its column, ORDER-INDEPENDENT, tolerant of blank/title rows above it. "Pembayaran Bon" is
// matched to `pay` first so the `bon` column (which also contains "bon") avoids it. If no header row
// is found → fixed column order with headerUnknown=true (surfaced in the preview).
function detectLegacyColumns(rawCells) {
  const FIELDS = ['date', 'price', 'lunas', 'bon', 'pay', 'note'];
  const FIXED = { date: 0, price: 1, lunas: 2, bon: 3, pay: 4, note: 5, qty: -1, method: -1 };
  for (let i = 0; i < Math.min(rawCells.length, 15); i++) {
    const cells = (rawCells[i] || []).map(normHeader);
    const hits = FIELDS.filter((f) => cells.some((c) => LEGACY_HDR[f].test(c))).length;
    if (hits >= 2) {
      const iPay = cells.findIndex((c) => LEGACY_HDR.pay.test(c));
      const iLunas = cells.findIndex((c, idx) => LEGACY_HDR.lunas.test(c) && idx !== iPay);
      const iBon = cells.findIndex((c, idx) => LEGACY_HDR.bon.test(c) && idx !== iPay && idx !== iLunas);
      return { headerRow: i, headerUnknown: false, colMap: { date: cells.findIndex((c) => LEGACY_HDR.date.test(c)), price: cells.findIndex((c) => LEGACY_HDR.price.test(c)), lunas: iLunas, bon: iBon, pay: iPay, note: cells.findIndex((c) => LEGACY_HDR.note.test(c)), qty: -1, method: -1 } };
    }
  }
  return { headerRow: -1, headerUnknown: true, colMap: FIXED };
}
// Ready-to-fill CSV template for the per-customer legacy transaction import: Tanggal · Harga ·
// Pembelian Lunas · Pembelian Bon · Pembayaran Bon · Catatan. A single row may hold any mix of
// Lunas / Bon / Pembayaran (they become separate transactions on the same date).
// FIX 5 (round-trip guard): the Tanggal column is written as UNAMBIGUOUS ISO "YYYY-MM-DD" TEXT, so
// re-importing our own template reads back exactly as written (no locale m/d/yy trap). Any d/m/y
// format still works on import; ISO is just what we EMIT.
function downloadLegacyTemplate() {
  const rows = [
    ['Tanggal', 'Harga', 'Pembelian Lunas', 'Pembelian Bon', 'Pembayaran Bon', 'Catatan'],
    ['2026-01-15', '12000', '10', '', '', 'penjualan lunas'],
    ['2026-01-16', '13000', '2', '3', '', 'lunas + bon sekaligus'],
    ['2026-01-20', '', '', '', '30000', 'pembayaran bon'],
  ];
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'template-riwayat-transaksi.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// EXPAND one parsed legacy row into ALL its transactions (the SAME rule the server uses). Columns:
// Tanggal · Harga · Pembelian Lunas · Pembelian Bon · Pembayaran Bon · Catatan. A single row may
// produce 1–3 transactions, all on the row's date:
//   • Pembelian Lunas qty > 0 → LUNAS  (qty × Harga)
//   • Pembelian Bon   qty > 0 → BON    (qty × Harga, adds to sisa bon)
//   • Pembayaran Bon  amount>0 → PELUNASAN (reduces sisa bon)
// Harga is required when either qty > 0. Returns an ARRAY of preview items { type, qty, price,
// amount, status, date, dateRaw, note }.
// FIX 4 — INDEPENDENT VALIDATION: every column that is readable is parsed and shown even when the
// date is bad, so the preview always reflects the real file content (Tipe/Nominal never blanked by a
// date error). A row with actions but a bad date shows each transaction line with status 'baddate';
// a row with a good date but no action → one 'nominal' (Nominal kosong) line. Status per line:
// ok · baddate · nominal (no valid amount) — dedupe/ceiling ('dup'/'toobig') are layered on later.
function expandLegacyImportRow(cells, colMap, cellAt) {
  const dateRaw = cellAt(cells, colMap.date);
  const date = parseLegacyDate(dateRaw);
  const amt = (i) => (i >= 0 ? parseAmountCell(cellAt(cells, i)) : 0);
  const price = colMap.price >= 0 ? parseAmountCell(cellAt(cells, colMap.price)) : 0;
  const lunasQty = amt(colMap.lunas);
  const bonQty = amt(colMap.bon);
  const pay = amt(colMap.pay);
  const legQty = amt(colMap.qty);   // legacy fallback: plain qty (+ optional metode)
  const legMethod = colMap.method >= 0 && /bon/i.test(cellAt(cells, colMap.method)) ? 'bon' : 'lunas';
  const note = colMap.note >= 0 ? cellAt(cells, colMap.note) : '';
  const base = { dateRaw, date, note, price };
  // A purchase line: needs Harga and a good date to be 'ok'; still SHOWN (type + qty) otherwise.
  const purchase = (type, qty) => {
    const amount = price > 0 ? qty * price : 0;
    const status = !date ? 'baddate' : (price > 0 ? 'ok' : 'nominal');
    return { ...base, type, qty, amount, status };
  };
  const items = [];
  if (lunasQty > 0) items.push(purchase('lunas', lunasQty));
  if (bonQty > 0) items.push(purchase('bon', bonQty));
  if (pay > 0) items.push({ ...base, type: 'pelunasan', qty: 0, amount: pay, status: !date ? 'baddate' : 'ok' });
  if (!items.length && legQty > 0) items.push(purchase(legMethod, legQty));
  if (!items.length) return [{ ...base, type: null, qty: 0, amount: 0, status: !date ? 'baddate' : 'nominal' }];
  return items;
}
// Free navigation link (opens Google/Apple Maps on the device — no API key/billing).
const mapsUrl = (lat, lng) => 'https://www.google.com/maps?q=' + lat + ',' + lng;
// GPS capture button — TOUCH-ONLY (hidden on desktop so the office location is never saved as a
// customer's; desktop keeps only the paste-a-Maps-link field). Reads a high-accuracy fix; if the
// reported accuracy is worse than 100 m (likely WiFi, not GPS) it asks first: Retry / Save anyway /
// Cancel. `onCapture` → fill mode (add/edit form); otherwise it saves straight to the server.
const IS_TOUCH = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const ACC_LIMIT = 100;
function GpsButton({ custId, hasLoc, onSaved, onCapture, onFlash, label }) {
  const [busy, setBusy] = uSx(false);
  const [low, setLow] = uSx(null);   // { lat, lng, accuracy } awaiting the low-accuracy choice
  if (!IS_TOUCH()) return null;
  const fail = (m) => onFlash && onFlash(m);
  const persist = (lat, lng, accuracy) => {
    if (onCapture) { onCapture({ lat, lng, accuracy }); return; }
    setBusy(true);
    window.API.distribusi.customers.setLocation(custId, { lat, lng, accuracy })
      .then((r) => { setBusy(false); onSaved && onSaved(r.data); })
      .catch(() => { setBusy(false); fail(trD('dist.locSaveErr')); });
  };
  const capture = () => {
    if (hasLoc && !onCapture && !window.confirm(trD('dist.locOverwriteConfirm'))) return;
    if (!(navigator.geolocation && navigator.geolocation.getCurrentPosition)) { fail(trD('dist.locUnavailable')); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const acc = Math.round(pos.coords.accuracy);
        if (acc > ACC_LIMIT) { setLow({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc }); return; }
        persist(pos.coords.latitude, pos.coords.longitude, acc);
      },
      () => { setBusy(false); fail(trD('dist.locDenied')); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  return (<>
    <button type="button" className="btn btn-ghost btn-sm dist-gps-btn" disabled={busy} onClick={capture}><IconPin s={14} />{busy ? '…' : (label || (hasLoc ? trD('dist.locUpdate') : trD('dist.locTag')))}</button>
    {low && (
      <div className="modal-scrim" onClick={() => setLow(null)} style={{ zIndex: 260 }}>
        <div className="modal-card" style={{ maxWidth: 390 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div style={{ fontSize: 16, fontWeight: 800 }}>{trD('dist.locLowT')}</div></div>
          <div className="modal-body"><div className="dist-gr-warn"><IconWarn s={16} /><span>{trD('dist.locLowMsg', { x: low.accuracy })}</span></div></div>
          <div className="modal-foot" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setLow(null)}>{trD('dist.locCancel')}</button>
            <button className="btn btn-ghost" onClick={() => { setLow(null); capture(); }}>{trD('dist.locRetry')}</button>
            <button className="btn btn-primary" onClick={() => { const l = low; setLow(null); persist(l.lat, l.lng, l.accuracy); }}>{trD('dist.locSaveAnyway')}</button>
          </div>
        </div>
      </div>
    )}
  </>);
}

// Customer LOCATION PHOTO. Bytes live in the Attachment store (never inline in the record); the
// customer row only keeps the attachment id. Thumbnail loads lazily; the full image opens via the
// shared ProofViewer (also lazy). Upload/replace/remove go through UI.FileAttach (camera on mobile)
// → we persist only the returned ref id. Not part of the "data lengkap" check — optional extra.
function LocThumb({ photoId, onView }) {
  const [src, setSrc] = uSx(null);
  uEx(() => { let live = true; setSrc(null); if (photoId && window.API && window.API.attachments) { window.API.attachments.get(photoId).then((r) => { if (live) setSrc(r && r.data ? r.data.data : null); }).catch(() => {}); } return () => { live = false; }; }, [photoId]);
  return src
    ? <img className="dist-locphoto-thumb" src={src} alt="foto lokasi" onClick={onView} />
    : <div className="dist-locphoto-ph" onClick={onView}><span className="ui-attach-spin" /></div>;
}
function LocPhoto({ custId, photoId, byName, at, canEdit, onChanged, compact }) {
  const view = () => { if (photoId && window.UI && window.UI._viewProof) window.UI._viewProof({ ref: photoId, isImg: true, name: 'foto-lokasi.jpg' }); };
  const persist = (id) => window.API.distribusi.customers.setLocationPhoto(custId, id).then(() => onChanged && onChanged()).catch(() => {});
  const onPick = (v) => { if (v && v.ref) persist(v.ref); };   // cloud upload → store only the ref id
  if (compact) {
    return (
      <span className="dist-locphoto-board">
        {photoId && <button type="button" className="dist-link" onClick={view}><IconPin s={12} />{trD('dist.locPhotoView')}</button>}
        {canEdit && <UI.FileAttach value={null} onChange={onPick} compact camera label={photoId ? trD('dist.locPhotoReplace') : trD('dist.locPhotoAdd')} />}
      </span>
    );
  }
  return (
    <div className="dist-locphoto">
      {photoId ? (<>
        <LocThumb photoId={photoId} onView={view} />
        <div className="dist-locphoto-side">
          {byName ? <div className="dist-locphoto-meta">{trD('dist.locPhotoBy', { who: byName, d: fmtDT(at) })}</div> : null}
          {canEdit && <div className="dist-locphoto-acts"><UI.FileAttach value={null} onChange={onPick} compact camera label={trD('dist.locPhotoReplace')} /><button type="button" className="dist-link danger" onClick={() => persist(null)}>{trD('dist.locPhotoRemove')}</button></div>}
        </div>
      </>) : (
        canEdit ? <UI.FileAttach value={null} onChange={onPick} camera label={trD('dist.locPhotoAdd')} /> : <div className="dist-hint">{trD('dist.locPhotoNone')}</div>
      )}
    </div>
  );
}

function DistTransactions({ today, staffMode, canInput, canKoreksi, canVoid, canHardDelete, canArchive, canExpense, canPrice, refreshKey, openFormTick, onChanged, fleetScope, fleet, distFleet, setDistFleet, userName, canViewAll, canView7, canViewMonth, canViewSisaBon, maxLookback }) {
  // ── VIEW-WINDOW (time restriction) — the UI HIDES presets outside what the server allows; the
  // server still enforces (this is convenience, not the guard). Mirror viewWindowFrom() client-side.
  const vwAddDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const vwFrom = canViewAll ? null : (() => { let f = today; const earlier = (d) => { if (d && d < f) f = d; }; if (canView7) earlier(vwAddDays(today, -6)); if (canViewMonth) earlier(today.slice(0, 8) + '01'); if (maxLookback > 0) earlier(vwAddDays(today, -maxLookback)); return f; })();
  const periodStart = { all: '0000-00-00', today: today, week: vwAddDays(today, -6), month: today.slice(0, 8) + '01', lastMonth: '0000-00-00', range: '0000-00-00' };
  // A preset is offered only if its whole range fits inside the allowed window. 'all'/'lastMonth'/
  // 'range' reach beyond a fixed window → they require full-history (semua).
  const periodAllowed = (k) => canViewAll || (k !== 'all' && k !== 'lastMonth' && k !== 'range' && vwFrom != null && periodStart[k] >= vwFrom);
  const [view, setView] = uSx('list');
  const [txns, setTxns] = uSx(null);
  const [customers, setCustomers] = uSx([]);
  const [filter, setFilter] = uSx('all');
  const [toast, setToast] = uSx('');
  const [newIds, setNewIds] = uSx([]);
  // form
  const [fCust, setFCust] = uSx('');
  const [fQty, setFQty] = uSx(1);
  const [fGalOut, setFGalOut] = uSx(1);   // galon keluar (default = qty; editable)
  const [fGalIn, setFGalIn] = uSx(0);     // galon masuk (empties returned)
  const [fMethod, setFMethod] = uSx('lunas');
  const [fDate, setFDate] = uSx(today);
  const [fNote, setFNote] = uSx('');
  const [confirmOpen, setConfirmOpen] = uSx(false);
  const [confirmAddAgain, setConfirmAddAgain] = uSx(false);   // sale confirm → route to "Simpan & tambah lagi"
  const [saving, setSaving] = uSx(false);
  const [fErr, setFErr] = uSx('');
  const [payOpen, setPayOpen] = uSx(false);   // standalone Pelunasan Bon
  // correction
  const [corrTxn, setCorrTxn] = uSx(null);
  const [corrReason, setCorrReason] = uSx('');
  const [corrForm, setCorrForm] = uSx(null);   // STRUCTURED input fields, pre-filled from the txn
  const [corrSaving, setCorrSaving] = uSx(false);
  // void (recorded cancellation) + hard delete (owner-only, permanent)
  const [voidTxn, setVoidTxn] = uSx(null);
  const [voidReason, setVoidReason] = uSx('');
  const [voidSaving, setVoidSaving] = uSx(false);
  const [delTxn, setDelTxn] = uSx(null);           // hard-delete danger modal
  const [delReason, setDelReason] = uSx('');
  const [delConfirm, setDelConfirm] = uSx('');
  const [delPw, setDelPw] = uSx('');
  const [delSaving, setDelSaving] = uSx(false);
  const [delErr, setDelErr] = uSx('');
  const [menuFor, setMenuFor] = uSx(null);          // which txn row's action menu is open
  // archive toggle (active ↔ arsip/legacy)
  const [archTxn, setArchTxn] = uSx(null);          // { ...txn, toLegacy } being toggled
  const [archReason, setArchReason] = uSx('');
  const [archBon, setArchBon] = uSx(false);         // when archiving a bon/pelunasan: keep counting toward sisa bon?
  const [archSaving, setArchSaving] = uSx(false);
  // ── PENGELUARAN (field expenses) — now a filter chip + inline form INSIDE this screen, not a
  // separate route. Expenses are DistExpense rows (never DistTransaction): they never appear under
  // "Semua" and never touch txn totals / gallons / bon / KPIs — only the dashboard's net-cash line.
  const [expenses, setExpenses] = uSx(null);        // DistExpense rows for the chosen day/fleet
  const [eDate, setEDate] = uSx(today);             // the day the expense list + form act on
  const [eCats, setECats] = uSx(['bensin', 'makan', 'parkir', 'lainnya']);
  const [eCat, setECat] = uSx('bensin');
  const [eAmount, setEAmount] = uSx('');            // raw digits; rupiah-formatted on blur (like the txn amount)
  const [eAmtFocus, setEAmtFocus] = uSx(false);
  const [eNote, setENote] = uSx('');
  const [ePhoto, setEPhoto] = uSx(null);
  const [eFleet, setEFleet] = uSx('');
  const [eBigOk, setEBigOk] = uSx(false);           // explicit confirm for an implausibly large expense
  const [eSaving, setESaving] = uSx(false);
  const [eErr, setEErr] = uSx('');
  const [eVoidRow, setEVoidRow] = uSx(null);        // the expense being voided (recorded, reason required)
  const [eVoidReason, setEVoidReason] = uSx('');
  const [eDetail, setEDetail] = uSx(null);          // expense row clicked in the list → detail + void panel
  const [eMethod, setEMethod] = uSx('tunai');       // pengeluaran: tunai | transfer (informational)
  const [eRecipient, setERecipient] = uSx('');      // pengeluaran: penerima / keterangan
  // ── UNIFIED "Transaksi Baru" ENTRY — one screen, a segmented control switches the TYPE:
  // penjualan (sale) · pelunasan (bon payment) · pengeluaran (field expense). Remembered per session.
  const [formType, setFormType] = uSx(() => { try { return sessionStorage.getItem('dist_form_type') || 'penjualan'; } catch (e) { return 'penjualan'; } });
  const [entryToast, setEntryToast] = uSx('');      // "Simpan & tambah lagi" success ping inside the form
  // Pelunasan (bon payment) fields — inlined from the old PaymentModal so it becomes a tab.
  const [pCust, setPCust] = uSx('');
  const [pAmount, setPAmount] = uSx(0);
  const [pMethod, setPMethod] = uSx('cash');
  const [pDate, setPDate] = uSx(today);
  const [pNote, setPNote] = uSx('');
  const [pSaving, setPSaving] = uSx(false);
  const [pErr, setPErr] = uSx('');
  // ── REDESIGNED LIST (presentation) — search / period / multi-filters / sort / windowing / slide-over.
  // All filters + sort mirror to the URL so a view is shareable and survives a refresh. Search, status,
  // sort and windowing run CLIENT-side (the endpoint has no such params); the PERIOD narrows the fetch.
  const txp = (k, d) => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch (e) { return d; } };
  const toSet = (s) => new Set(String(s || '').split(',').filter(Boolean));
  const [q, setQ] = uSx(() => txp('q', ''));
  const [qDeb, setQDeb] = uSx(q);
  const [period, setPeriod] = uSx(() => { const p = txp('period', canViewAll ? 'all' : 'today'); return periodAllowed(p) ? p : 'today'; });   // all | today | week | month | lastMonth | range
  const [rFrom, setRFrom] = uSx(() => txp('from', ''));
  const [rTo, setRTo] = uSx(() => txp('to', ''));
  const [methodSel, setMethodSel] = uSx(() => toSet(txp('m', '')));
  const [statusSel, setStatusSel] = uSx(() => toSet(txp('st', '')));
  const [sourceSel, setSourceSel] = uSx(() => toSet(txp('src', '')));
  const [armadaSel, setArmadaSel] = uSx(() => toSet(txp('arm', '')));
  const [petugasSel, setPetugasSel] = uSx(() => toSet(txp('pt', '')));
  const [custFilter, setCustFilter] = uSx(() => txp('cust', ''));
  const [minAmt, setMinAmt] = uSx(() => txp('min', ''));
  const [maxAmt, setMaxAmt] = uSx(() => txp('max', ''));
  const [flagNote, setFlagNote] = uSx(() => txp('note', '') === '1');
  const [flagCorr, setFlagCorr] = uSx(() => txp('corr', '') === '1');
  const [sortKey, setSortKey] = uSx(() => txp('sort', 'date'));  // date | amount | qty | customer | petugas
  const [sortDir, setSortDir] = uSx(() => txp('dir', 'desc'));
  const [txView, setTxView] = uSx(() => txp('v', 'table'));      // table | kartu
  const [txVisible, setTxVisible] = uSx(120);                    // windowed render (rows shown)
  const [detailIdx, setDetailIdx] = uSx(-1);                     // slide-over detail: index into the filtered rows
  const [sel, setSel] = uSx({});                                 // bulk selection { id: true }
  const [advOpen, setAdvOpen] = uSx(false);
  const [colMenu, setColMenu] = uSx(false);
  const [colHidden, setColHidden] = uSx(() => { try { return new Set(JSON.parse(localStorage.getItem('tx_cols_hidden') || '[]')); } catch (e) { return new Set(); } });
  const [presets, setPresets] = uSx(() => { try { return JSON.parse(localStorage.getItem('tx_presets') || '[]'); } catch (e) { return []; } });
  const [bulkVoid, setBulkVoid] = uSx(null);                     // { items } → bulk-cancel preview
  const [printFor2, setPrintFor2] = uSx(null);                   // { txn, custObj? } → Cetak Nota via PrintCenter
  const [isNarrow, setIsNarrow] = uSx(() => { try { return window.matchMedia('(max-width: 900px)').matches; } catch (e) { return false; } });
  const [density, setDensity] = uSx(() => { try { return localStorage.getItem('tx_density') === 'compact' ? 'compact' : 'comfortable'; } catch (e) { return 'comfortable'; } });
  const [moreMenu, setMoreMenu] = uSx(false);          // ⋯ overflow menu (secondary actions)
  const [infoOpen, setInfoOpen] = uSx(false);          // permanence-note info popover (replaces the banner)
  const [txWin, setTxWin] = uSx({ clamped: false, from: null, to: null, unlimited: !!canViewAll });   // server view-window meta (drives the clamp notice)
  const [periodExp, setPeriodExp] = uSx([]);   // DistExpense rows for the current period → merged into the list
  const [cursor, setCursor] = uSx(-1);                 // keyboard row cursor into txSorted (↑/↓ move, Enter opens)
  const [availW, setAvailW] = uSx(() => { try { return window.innerWidth; } catch (e) { return 1280; } });
  const txSentinel = React.useRef(null);
  const rootRef = React.useRef(null);                  // measured to auto-drop columns by available width
  const toolRef = React.useRef(null);                  // sticky-toolbar height → the header sticks just beneath it
  const [toolH, setToolH] = uSx(0);
  uEx(() => { const t = setTimeout(() => setQDeb(q), 300); return () => clearTimeout(t); }, [q]);   // debounce search
  uEx(() => { let mq; try { mq = window.matchMedia('(max-width: 900px)'); } catch (e) { return; } const on = () => setIsNarrow(mq.matches); on(); mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on); return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); }; }, []);
  uEx(() => { try { localStorage.setItem('tx_density', density); } catch (e) {} }, [density]);
  // Measure the real content width so columns drop to fit (never wrap, never horizontal-scroll ≥900px).
  uEx(() => { const el = rootRef.current; if (!el) return; const set = () => setAvailW(el.clientWidth || window.innerWidth); set(); if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', set); return () => window.removeEventListener('resize', set); } const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect(); }, []);
  uEx(() => { const el = toolRef.current; const set = () => setToolH(el ? el.offsetHeight : 0); set(); if (!el || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect(); });

  const doArchive = () => {
    if (!archTxn || !archReason.trim() || archSaving) return;
    setArchSaving(true);
    window.API.distribusi.transactions.setArchive(archTxn.id, { legacy: !!archTxn.toLegacy, bonCounted: archBon, reason: archReason.trim() })
      .then(() => { setArchSaving(false); setArchTxn(null); setArchReason(''); flash(trD(archTxn.toLegacy ? 'dist.archDone' : 'dist.unarchDone')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setArchSaving(false); flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const doVoid = () => {
    if (!voidTxn || !voidReason.trim() || voidSaving) return;
    setVoidSaving(true);
    // Submits a VOID REQUEST (approval-gated) — the transaction stays active until an approver approves.
    window.API.distribusi.transactions.void(voidTxn.id, { reason: voidReason.trim() })
      .then(() => { setVoidSaving(false); setVoidTxn(null); setVoidReason(''); flash(trD('dist.voidReqSent')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setVoidSaving(false); flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const doHardDelete = () => {
    if (!delTxn || !delReason.trim() || !delConfirm.trim() || !delPw || delSaving) return;
    setDelSaving(true); setDelErr('');
    window.API.distribusi.transactions.hardDelete(delTxn.id, { reason: delReason.trim(), confirm: delConfirm.trim(), password: delPw })
      .then(() => { setDelSaving(false); setDelTxn(null); setDelReason(''); setDelConfirm(''); setDelPw(''); flash(trD('dist.hardDelDone')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setDelSaving(false); setDelErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };

  const ef = effFleet(fleetScope, distFleet);
  const pb = txPeriodBounds(period, rFrom, rTo);
  // The PERIOD narrows the fetch server-side (dateFrom/dateTo) so a huge ledger never loads whole.
  const listQs = () => { const p = []; if (ef && ef !== 'all') p.push('fleet=' + encodeURIComponent(ef)); if (pb) { p.push('dateFrom=' + pb.from); p.push('dateTo=' + pb.to); } return p.join('&'); };
  // Field expenses over the SAME period as the txn fetch — merged into the list as "Pengeluaran" rows
  // (own badge, negative nominal, own KPI) so staff see money-out inline without a separate screen.
  const expQs = () => { const o = { status: 'active' }; if (ef && ef !== 'all') o.fleet = ef; if (pb) { o.dateFrom = pb.from; o.dateTo = pb.to; } return o; };
  const reload = () => Promise.all([
    window.API.distribusi.transactions.list(listQs()).then((r) => { setTxns(r.data || []); setTxWin({ clamped: !!r.clamped, from: r.effectiveFrom || null, to: r.effectiveTo || null, unlimited: !!(r.window && r.window.unlimited) }); }).catch(() => setTxns([])),
    window.API.distribusi.customers.list(ef).then((r) => setCustomers(r.data || [])).catch(() => {}),
    (canExpense ? window.API.distribusi.expenses.list(expQs()).then((r) => setPeriodExp(r.data || [])).catch(() => setPeriodExp([])) : Promise.resolve(setPeriodExp([]))),
  ]);
  uEx(() => { if (window.API && window.API.distribusi) { setTxns(null); reload(); } }, [refreshKey, ef, period, rFrom, rTo]);
  uEx(() => { if (!periodAllowed(period)) setPeriod('today'); }, [period, canViewAll, canView7, canViewMonth, maxLookback]);   // keep the selected period inside the allowed window
  // Mirror filters + sort to the URL (replaceState — shareable, survives refresh).
  uEx(() => {
    try {
      const u = new URL(window.location.href); const s = u.searchParams;
      const setp = (k, v, dflt) => { if (v && v !== dflt) s.set(k, v); else s.delete(k); };
      setp('q', qDeb, ''); setp('period', period, 'all'); setp('from', period === 'range' ? rFrom : '', ''); setp('to', period === 'range' ? rTo : '', '');
      setp('m', [...methodSel].join(','), ''); setp('st', [...statusSel].join(','), ''); setp('src', [...sourceSel].join(','), ''); setp('arm', [...armadaSel].join(','), ''); setp('pt', [...petugasSel].join(','), '');
      setp('cust', custFilter, ''); setp('min', minAmt, ''); setp('max', maxAmt, ''); setp('note', flagNote ? '1' : '', ''); setp('corr', flagCorr ? '1' : '', '');
      setp('sort', sortKey, 'date'); setp('dir', sortDir, 'desc'); setp('v', txView, 'table');
      window.history.replaceState(null, '', u);
    } catch (e) {}
  }, [qDeb, period, rFrom, rTo, methodSel, statusSel, sourceSel, armadaSel, petugasSel, custFilter, minAmt, maxAmt, flagNote, flagCorr, sortKey, sortDir, txView]);
  uEx(() => { setTxVisible(120); setCursor(-1); }, [qDeb, period, rFrom, rTo, methodSel, statusSel, sourceSel, armadaSel, petugasSel, custFilter, minAmt, maxAmt, flagNote, flagCorr, sortKey, sortDir]);   // reset window + cursor on filter change
  uEx(() => { localStorage.setItem('tx_cols_hidden', JSON.stringify([...colHidden])); }, [colHidden]);
  uEx(() => { if (openFormTick) { if (canInput) setType('penjualan'); setFErr(''); setView('form'); } }, [openFormTick]);

  // Expenses load independently (they are date-scoped, the txn list is not). The chip reads this.
  const scoped = isScoped(fleetScope);
  const fleetOpts = (fleet || []).filter(Boolean);
  const reloadExpenses = () => {
    if (!(window.API && window.API.distribusi && window.API.distribusi.expenses)) { setExpenses([]); return; }
    window.API.distribusi.expenses.list({ date: eDate, fleet: ef }).then((r) => setExpenses(r.data || [])).catch(() => setExpenses([]));
  };
  uEx(() => { if (canExpense) reloadExpenses(); }, [refreshKey, ef, eDate, canExpense]);
  uEx(() => { if (canExpense && window.API && window.API.distribusi && window.API.distribusi.expenses) window.API.distribusi.expenses.categories().then((r) => { if (r.data && r.data.length) setECats(r.data); }).catch(() => {}); }, [canExpense]);
  // An expense-only user (no input/koreksi) lands on the list pre-filtered to Pengeluaran rows.
  uEx(() => { if (!canInput && !canKoreksi && canExpense) setMethodSel(new Set(['pengeluaran'])); }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const selCust = customers.find((c) => c.id === fCust) || null;
  const price = selCust ? selCust.masterPrice : 0;
  const total = price * Math.max(0, fQty || 0);

  const setQty = (q) => { const n = Math.max(1, q | 0); setFQty(n); setFGalOut(n); };   // gallon out tracks qty until edited
  const resetSaleFields = () => { setFCust(''); setFQty(1); setFGalOut(1); setFGalIn(0); setFMethod('lunas'); setFNote(''); };
  // `addAgain` keeps the TYPE + date and clears the rest, staying on the entry screen (rapid entry).
  const commitTxn = (addAgain) => {
    if (!selCust || saving) return;
    setSaving(true); setFErr('');
    window.API.distribusi.transactions.create({ customerId: fCust, qty: Math.max(1, fQty | 0), method: fMethod, note: fNote.trim(), txnDate: staffMode ? today : (fDate || today), gallonOut: Math.max(0, fGalOut | 0), gallonIn: Math.max(0, fGalIn | 0) })
      .then((r) => { setSaving(false); setConfirmOpen(false); setNewIds((p) => [r.data.id, ...p]); resetSaleFields();
        const msg = trD('dist.txnGalonSaved', { out: r.data.gallonOut, in: r.data.gallonIn, held: r.data.gallonsHeld });
        if (addAgain) { pingEntry(msg); } else { setView('list'); setFilter('all'); flash(msg); }
        reload(); if (onChanged) onChanged(); })
      .catch((e) => { setSaving(false); setConfirmOpen(false); setFErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  // A real gallon SALE is corrected via qty/unitPrice/gallonOut/gallonIn (the total recomputes);
  // a pelunasan or an opening/carry-over bon (amount typed directly) is corrected via the amount.
  const isSaleTxn = (t) => t && (t.method === 'lunas' || t.method === 'bon') && !t.openingBon;
  const openCorrect = (t) => {
    setCorrTxn(t); setCorrReason('');
    if (isSaleTxn(t)) setCorrForm({ qty: t.qty, unitPrice: t.unitPriceLocked, gallonOut: t.gallonOut != null ? t.gallonOut : t.qty, gallonIn: t.gallonIn || 0, method: t.method });
    else setCorrForm({ amount: t.amount });
  };
  const corrSale = isSaleTxn(corrTxn);
  const corrNewTotal = corrForm ? (corrSale ? (+corrForm.qty || 0) * (+corrForm.unitPrice || 0) : (+corrForm.amount || 0)) : 0;
  // sisa-bon impact of a method change: a 'bon' row counts as receivable (its amount), a 'lunas' row
  // does not. So Δsisa bon = (new bon-contribution) − (current bon-contribution).
  const corrOldBonContrib = corrTxn && corrTxn.method === 'bon' ? corrTxn.amount : 0;
  const corrNewBonContrib = corrForm && corrForm.method === 'bon' ? corrNewTotal : 0;
  const corrBonImpact = corrSale ? (corrNewBonContrib - corrOldBonContrib) : 0;
  const corrMethodChanged = corrSale && corrForm && corrForm.method !== corrTxn.method;
  const corrValid = corrTxn && corrReason.trim() && (corrSale ? ((+corrForm.qty || 0) > 0 && (+corrForm.unitPrice || 0) > 0) : (+corrForm.amount || 0) > 0);
  const commitCorrect = () => {
    if (!corrValid || corrSaving) return;
    // The price is capability-gated: without distribusiHargaMaster we always send the transaction's
    // LOCKED price, so a staff correction can only move the total via qty. The server re-checks this
    // against the stored unitPriceLocked regardless of what is sent here. Method (bon↔lunas) needs no
    // price cap and is only sent for a gallon sale.
    const payload = corrSale
      ? { qty: +corrForm.qty || 0, unitPrice: canPrice ? (+corrForm.unitPrice || 0) : corrTxn.unitPriceLocked, gallonOut: +corrForm.gallonOut || 0, gallonIn: +corrForm.gallonIn || 0, method: corrForm.method }
      : { amount: +corrForm.amount || 0 };
    setCorrSaving(true);
    // Submits a REQUEST (approval-gated) — the transaction is not changed until an approver approves.
    window.API.distribusi.transactions.correct(corrTxn.id, { reason: corrReason.trim(), ...payload })
      .then(() => { setCorrSaving(false); setCorrTxn(null); setCorrForm(null); flash(trD('dist.corrReqSent')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setCorrSaving(false); flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };

  // ── Expense form/list helpers (same patterns as the transaction form: rupiah amount, chips, void). ──
  const expCatLabel = (c) => { const k = 'exp.cat_' + c; const t = trD(k); return t !== k ? t : c; };
  const viewExpPhoto = (id) => { if (id && window.UI && window.UI._viewProof) window.UI._viewProof({ ref: id, isImg: true, name: 'bukti.jpg' }); };
  const eAmt = parseInt(String(eAmount).replace(/[^0-9]/g, ''), 10) || 0;
  const eCatCustom = !eCats.includes(eCat);
  const expActive = (expenses || []).filter((r) => r.status === 'active');
  const expTotal = expActive.reduce((s, r) => s + r.amount, 0);
  // ── UNIFIED ENTRY (Transaksi Baru) — one screen, a segmented control switches the type. ──
  // A short success ping shown INSIDE the entry screen after "Simpan & tambah lagi".
  const pingEntry = (m) => { setEntryToast(m); setTimeout(() => setEntryToast(''), 2400); };
  // The types the user may create — hidden if the cap is missing; if only one remains the control hides.
  const entryTabs = [
    canInput ? { k: 'penjualan', l: trD('dist.tabPenjualan'), ic: IconDrop } : null,
    canInput ? { k: 'pelunasan', l: trD('dist.tabPelunasan'), ic: IconInvoice } : null,
    canExpense ? { k: 'pengeluaran', l: trD('dist.tabPengeluaran'), ic: IconCoinOut } : null,
  ].filter(Boolean);
  const setType = (t) => { setFormType(t); try { sessionStorage.setItem('dist_form_type', t); } catch (e) {} setFErr(''); setEErr(''); setPErr(''); };
  // Open the unified entry screen at a type (or last-used), coerced to a tab the user actually has.
  const openEntry = (t) => {
    const allowed = entryTabs.map((x) => x.k);
    const type = allowed.includes(t) ? t : (allowed.includes(formType) ? formType : allowed[0]);
    if (!type) return;
    setType(type); setFErr(''); setEErr(''); setPErr('');
    setEFleet((distFleet && distFleet !== 'all') ? distFleet : (scoped ? '' : (fleetOpts[0] || '')));   // prime expense fleet
    setView('form');
  };
  const resetExpFields = () => { setEAmount(''); setEAmtFocus(false); setENote(''); setERecipient(''); setEPhoto(null); setEBigOk(false); };   // keeps kategori/tanggal/armada/metode
  const commitExpense = (addAgain) => {
    if (eSaving) return;
    if (!(eAmt > 0)) { setEErr(trD('exp.amtReq')); return; }
    if (!scoped && !eFleet) { setEErr(trD('run.errFleet')); return; }
    // A typo-sized expense is confirmed once before saving (the server still hard-rejects > 1B).
    if (eAmt > WARN_AMOUNT && !eBigOk) { setEBigOk(true); return; }
    setESaving(true); setEErr('');
    const photoId = ePhoto && ePhoto.ref ? ePhoto.ref : undefined;
    // SAME storage path as the old Pengeluaran flow — one DistExpense record; never a duplicate.
    window.API.distribusi.expenses.create({ date: eDate, fleet: eFleet || undefined, amount: eAmt, category: (eCat || '').trim() || 'lainnya', method: eMethod, recipient: (eRecipient || '').trim() || undefined, note: (eNote || '').trim() || undefined, photoId })
      .then(() => { setESaving(false); resetExpFields();
        if (addAgain) { pingEntry(trD('exp.saved')); } else { setView('list'); flash(trD('exp.saved')); }
        reload(); reloadExpenses(); if (onChanged) onChanged(); })
      .catch((e) => { setESaving(false); setEErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  // Pelunasan (bon payment) — inlined from the old PaymentModal so it is a tab. Same create endpoint.
  const paySel = customers.find((c) => c.id === pCust) || null;
  const paySisa = paySel ? (paySel.sisaBon || 0) : 0;
  const payValid = !!(paySel && paySisa > 0 && pAmount > 0 && pAmount <= paySisa);
  const commitPay = (addAgain) => {
    if (!payValid || pSaving) return;
    setPSaving(true); setPErr('');
    window.API.distribusi.transactions.create({ customerId: pCust, method: 'pelunasan', payAmount: pAmount, payMethod: pMethod, note: pNote.trim(), txnDate: staffMode ? today : (pDate || today) })
      .then((r) => { setPSaving(false); setNewIds((p) => [r.data.id, ...p]); setPCust(''); setPAmount(0); setPNote('');
        const msg = trD('dist.paySaved', { amt: rpFull(r.data.amount), sisa: rpFull(r.data.sisaBon || 0) });
        if (addAgain) { pingEntry(msg); } else { setView('list'); setFilter('all'); flash(msg); }
        reload(); if (onChanged) onChanged(); })
      .catch((e) => { setPSaving(false); setPErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  // Unified save dispatch + dirty/validity across the three types (drives the buttons + keyboard).
  const entrySaving = saving || eSaving || pSaving;
  const entryCanSave = (formType === 'penjualan' && !!selCust) || (formType === 'pengeluaran' && eAmt > 0) || (formType === 'pelunasan' && payValid);
  const entryDirty = (formType === 'penjualan' && (!!fCust || !!fNote || fQty !== 1)) || (formType === 'pengeluaran' && (eAmt > 0 || !!eNote || !!eRecipient || !!ePhoto)) || (formType === 'pelunasan' && (!!pCust || pAmount > 0 || !!pNote));
  const doEntrySave = (addAgain) => {
    if (!entryCanSave || entrySaving) return;
    if (formType === 'penjualan') { setConfirmAddAgain(!!addAgain); setConfirmOpen(true); }   // sale keeps its confirm step
    else if (formType === 'pengeluaran') commitExpense(addAgain);
    else if (formType === 'pelunasan') commitPay(addAgain);
  };
  const closeEntry = () => { if (!entryDirty || window.confirm(trD('dist.entryDiscard'))) { setView('list'); setConfirmOpen(false); } };
  // Keyboard-first: Alt+1/2/3 switch type · Enter saves · Esc closes (confirm if dirty).
  uEx(() => {
    if (view !== 'form') return;
    const on = (e) => {
      if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) { const t = entryTabs[(+e.key) - 1]; if (t) { e.preventDefault(); setType(t.k); } return; }
      const tg = e.target, typing = tg && /^(TEXTAREA|SELECT)$/.test(tg.tagName || '');
      if (e.key === 'Enter' && !typing && !confirmOpen) { if (entryCanSave && !entrySaving) { e.preventDefault(); doEntrySave(false); } }
      else if (e.key === 'Escape' && !confirmOpen) { e.preventDefault(); closeEntry(); }
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [view, formType, entryCanSave, entrySaving, entryDirty, confirmOpen, entryTabs.length]);
  const commitExpenseVoid = () => {
    if (!eVoidRow || eSaving) return;
    if (!(eVoidReason || '').trim()) { setEErr(trD('exp.reasonReq')); return; }
    setESaving(true); setEErr('');
    window.API.distribusi.expenses.void(eVoidRow.id, { reason: eVoidReason.trim() })
      .then(() => { setESaving(false); setEVoidRow(null); setEVoidReason(''); flash(trD('exp.voided')); reload(); reloadExpenses(); if (onChanged) onChanged(); })
      .catch((e) => { setESaving(false); setEErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };

  const custOpts = customers.map((c) => ({ value: c.id, label: custOptLabel(c), search: custSearchStr(c) }));
  // ── Derived list (client-side filter → sort → window → group). All money via rpFull; dates fmtDateShort. ──
  const custById = {}; customers.forEach((c) => { custById[c.id] = c; });
  // Field-expense rows, shaped like a transaction so the ONE list pipeline (filter/sort/group/render)
  // can carry them. `_exp` marks them so KPIs exclude them from sales and the row shows a red badge.
  const expRows = (periodExp || []).map((e) => ({ _exp: true, expId: e.id, id: 'exp_' + e.id, method: 'pengeluaran', txnDate: e.date, amount: e.amount, effectiveAmount: e.amount, category: e.category, note: e.note || '', recipient: e.recipient || '', expMethod: e.method || 'tunai', fleetId: e.fleetId || '', actorName: e.createdByName || '', createdAt: e.createdAt || 0, status: e.status, photoId: e.photoId || null, legacy: false, corrections: [] }));
  const nameOf = (t) => (t.customer && t.customer.name) || (custById[t.customerId] && custById[t.customerId].name) || '';
  const codeOf = (t) => (t.customer && t.customer.code) || (custById[t.customerId] && custById[t.customerId].code) || '';
  const phoneOf = (t) => (custById[t.customerId] && custById[t.customerId].phone) || '';
  const amtOf = (t) => (t.effectiveAmount != null ? t.effectiveAmount : t.amount);
  const statusKey = (t) => t.status === 'void' ? 'dibatalkan'
    : (t.dispute && t.dispute.status === 'tidak_diakui') ? 'tidak_diakui'
      : (t.dispute && t.dispute.status === 'kerugian') ? 'kerugian'
        : (t.dispute && t.dispute.status === 'disengketakan') ? 'disengketakan'
          : t.pendingRequest ? 'terkunci' : 'normal';
  const smatch = (t) => { if (!qDeb) return true; const s = qDeb.toLowerCase(); const fields = t._exp ? [expCatLabel(t.category), t.category, t.recipient, t.note, String(t.amount)] : [txnCode(t), nameOf(t), codeOf(t), phoneOf(t), String(amtOf(t)), t.note]; return fields.some((v) => String(v || '').toLowerCase().includes(s)); };
  const minN = minAmt ? (parseInt(String(minAmt).replace(/\D/g, ''), 10) || 0) : null;
  const maxN = maxAmt ? (parseInt(String(maxAmt).replace(/\D/g, ''), 10) || 0) : null;
  const passFilters = (t) => {
    if (!smatch(t)) return false;
    if (t._exp) {   // expenses join only the method('pengeluaran')/status/armada/petugas/amount/date/note filters
      if (methodSel.size && !methodSel.has('pengeluaran')) return false;
      if (statusSel.size && !statusSel.has(t.status === 'void' ? 'dibatalkan' : 'normal')) return false;
      if (sourceSel.size && !sourceSel.has('manual')) return false;
      if (armadaSel.size && !armadaSel.has(t.fleetId || '')) return false;
      if (petugasSel.size && !petugasSel.has(t.actorName || '')) return false;
      if (custFilter) return false;   // an expense has no customer
      if (minN != null && t.amount < minN) return false;
      if (maxN != null && t.amount > maxN) return false;
      if (flagNote && !(t.note && String(t.note).trim())) return false;
      if (flagCorr) return false;
      return true;
    }
    if (methodSel.size && !(methodSel.has(t.method) || (t.adjusted && methodSel.has('penyesuaian')))) return false;
    if (statusSel.size && !statusSel.has(statusKey(t))) return false;
    if (sourceSel.size && !sourceSel.has(t.legacy ? 'impor' : 'manual')) return false;
    if (armadaSel.size && !armadaSel.has(t.fleetId || '')) return false;
    if (petugasSel.size && !petugasSel.has(t.actorName || '')) return false;
    if (custFilter && t.customerId !== custFilter) return false;
    if (minN != null && amtOf(t) < minN) return false;
    if (maxN != null && amtOf(t) > maxN) return false;
    if (flagNote && !(t.note && String(t.note).trim())) return false;
    if (flagCorr && !((t.corrections || []).length)) return false;
    return true;
  };
  const baseRows = txns === null ? [] : [...txns, ...expRows];   // transactions + merged expense rows
  const txFiltered = baseRows.filter(passFilters);
  const cmp = {
    date: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(b.txnDate || '').localeCompare(String(a.txnDate || '')),
    amount: (a, b) => amtOf(b) - amtOf(a), qty: (a, b) => (b.qty || 0) - (a.qty || 0),
    customer: (a, b) => nameOf(a).localeCompare(nameOf(b), 'id'), petugas: (a, b) => String(a.actorName || '').localeCompare(String(b.actorName || ''), 'id'),
  };
  const baseCmp = cmp[sortKey] || cmp.date;
  const txSorted = txFiltered.slice().sort((a, b) => { const r = baseCmp(a, b); return sortDir === 'asc' ? -r : r; });
  const txShown = txSorted.slice(0, txVisible);
  const effView = isNarrow ? 'kartu' : txView;
  const grouped = sortKey === 'date';
  // Date groups (only when sorted by date) — each with a subtotal header.
  const dayGroups = [];
  if (grouped) { const gm = {}; txShown.forEach((t) => { const k = t.txnDate || '—'; if (!gm[k]) { gm[k] = { date: k, rows: [], nota: 0, galon: 0, nominal: 0, expense: 0 }; dayGroups.push(gm[k]); } const g = gm[k]; g.rows.push(t); if (t._exp) { if (t.status !== 'void') g.expense += t.amount; } else if (t.status !== 'void') { g.nota++; if (t.method !== 'pelunasan' && !t.legacy) g.galon += t.qty || 0; g.nominal += (t.method === 'pelunasan' ? 0 : (t.effectiveAmount != null ? t.effectiveAmount : t.amount)); } }); }
  const groupDateLabel = (d) => { try { const dt = new Date(d + 'T00:00:00'); return DW_ID[dt.getDay()] + ', ' + fmtDateShort(d); } catch (e) { return d; } };
  // Summary over the WHOLE filtered set (not the render window). Expenses NEVER pollute the sales
  // figures — they are counted only into their OWN "Pengeluaran" KPI.
  let sGalon = 0, sNominal = 0, sLunas = 0, sBon = 0, sCount = 0, sExpense = 0;
  txFiltered.forEach((t) => { if (t._exp) { if (t.status !== 'void') sExpense += t.amount; return; } if (t.status === 'void') return; sCount++; if (t.method !== 'pelunasan' && !t.legacy) sGalon += t.qty || 0; const a = amtOf(t); if (t.method === 'lunas') { sNominal += a; sLunas += a; } else if (t.method === 'bon') { sNominal += a; sBon += a; } });
  const sAvg = sCount ? Math.round(sNominal / sCount) : 0;
  // Chip counts over the search+period set (stable while toggling category chips).
  const searchSet = (txns || []).filter(smatch);
  const methodCounts = { lunas: 0, bon: 0, pelunasan: 0, penyesuaian: 0, pengeluaran: expRows.filter((e) => e.status !== 'void' && smatch(e)).length };
  const statusCounts = { normal: 0, terkunci: 0, disengketakan: 0, tidak_diakui: 0, kerugian: 0, dibatalkan: 0 };
  const sourceCounts = { manual: 0, impor: 0 };
  searchSet.forEach((t) => { if (methodCounts[t.method] != null) methodCounts[t.method]++; if (t.adjusted) methodCounts.penyesuaian++; statusCounts[statusKey(t)]++; sourceCounts[t.legacy ? 'impor' : 'manual']++; });
  const armadaList = [...new Set(searchSet.map((t) => t.fleetId || '').filter(Boolean))];
  const petugasList = [...new Set(searchSet.map((t) => t.actorName || '').filter(Boolean))].slice(0, 40);
  const matchedFields = [];
  if (qDeb) { const s = qDeb.toLowerCase(); [['kode transaksi', txnCode], ['nama pelanggan', nameOf], ['kode pelanggan', codeOf], ['HP', phoneOf], ['nominal', (t) => String(amtOf(t))], ['catatan', (t) => t.note]].forEach(([lbl, fn]) => { if (txFiltered.some((t) => String(fn(t) || '').toLowerCase().includes(s))) matchedFields.push(lbl); }); }
  const anyFilter = !!qDeb || period !== 'all' || methodSel.size || statusSel.size || sourceSel.size || armadaSel.size || petugasSel.size || custFilter || minAmt || maxAmt || flagNote || flagCorr;
  const clearAll = () => { setQ(''); setPeriod('all'); setMethodSel(new Set()); setStatusSel(new Set()); setSourceSel(new Set()); setArmadaSel(new Set()); setPetugasSel(new Set()); setCustFilter(''); setMinAmt(''); setMaxAmt(''); setFlagNote(false); setFlagCorr(false); };
  const toggleIn = (setter) => (v) => setter((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n; });
  // Saved filter presets (localStorage), pinned in the toolbar.
  const savePreset = () => { const name = window.prompt(trD('tx.presetNamePrompt')); if (!name || !name.trim()) return; const ps = { name: name.trim().slice(0, 40), q: qDeb, period, from: rFrom, to: rTo, m: [...methodSel], st: [...statusSel], src: [...sourceSel], arm: [...armadaSel], pt: [...petugasSel], cust: custFilter, min: minAmt, max: maxAmt, note: flagNote, corr: flagCorr }; const next = [...presets, ps].slice(-8); setPresets(next); try { localStorage.setItem('tx_presets', JSON.stringify(next)); } catch (e) {} };
  const removePreset = (i) => { const next = presets.filter((_, j) => j !== i); setPresets(next); try { localStorage.setItem('tx_presets', JSON.stringify(next)); } catch (e) {} };
  const applyPreset = (ps) => { setQ(ps.q || ''); setPeriod(ps.period || 'all'); setRFrom(ps.from || ''); setRTo(ps.to || ''); setMethodSel(new Set(ps.m || [])); setStatusSel(new Set(ps.st || [])); setSourceSel(new Set(ps.src || [])); setArmadaSel(new Set(ps.arm || [])); setPetugasSel(new Set(ps.pt || [])); setCustFilter(ps.cust || ''); setMinAmt(ps.min || ''); setMaxAmt(ps.max || ''); setFlagNote(!!ps.note); setFlagCorr(!!ps.corr); };
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const selRows = txFiltered.filter((t) => sel[t.id]);
  // Slide-over detail row + j/k navigation over the FILTERED list.
  const detailTxn = detailIdx >= 0 && detailIdx < txSorted.length ? txSorted[detailIdx] : null;
  const openDetail = (t) => { if (t._exp) { setEDetail({ id: t.expId, category: t.category, amount: t.amount, recipient: t.recipient, note: t.note, method: t.expMethod, fleetId: t.fleetId, createdByName: t.actorName, createdAt: t.createdAt, status: t.status, photoId: t.photoId }); setEVoidReason(''); setEErr(''); return; } const i = txSorted.findIndex((x) => x.id === t.id); setDetailIdx(i); };
  const moveDetail = (d) => setDetailIdx((i) => { const n = i + d; return n >= 0 && n < txSorted.length ? n : i; });
  // Infinite scroll: reveal +120 rows as the sentinel nears the bottom of the single page scroller.
  uEx(() => { const el = txSentinel.current; if (!el || typeof IntersectionObserver === 'undefined') return; const root = document.querySelector('.content') || null; const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setTxVisible((n) => n + 120); }, { root, rootMargin: '700px' }); io.observe(el); return () => io.disconnect(); }, [txns, effView]);
  // Keyboard: with the slide-over CLOSED, ↑/↓ move a row cursor and Enter opens it; with it OPEN,
  // j/k move through rows without closing and Esc closes. All ignore typing in fields.
  uEx(() => {
    const on = (e) => {
      const tg = e.target; if (tg && /input|textarea|select/i.test(tg.tagName || '')) return;
      if (detailIdx >= 0) {
        if (e.key === 'j') { e.preventDefault(); moveDetail(1); }
        else if (e.key === 'k') { e.preventDefault(); moveDetail(-1); }
        else if (e.key === 'Escape') { e.preventDefault(); setDetailIdx(-1); }
        return;
      }
      const len = Math.min(txSorted.length, txVisible);
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((i) => Math.min(len - 1, (i < 0 ? -1 : i) + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((i) => Math.max(0, (i < 0 ? 0 : i) - 1)); }
      else if (e.key === 'Enter' && cursor >= 0 && cursor < txSorted.length) { e.preventDefault(); setDetailIdx(cursor); }
      else if (e.key === 'Escape' && cursor >= 0) { setCursor(-1); }
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [detailIdx, cursor, txSorted.length, txVisible]);
  uEx(() => { if (cursor < 0) return; try { const el = document.querySelector('.txt-row.cursor'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, [cursor]);
  const exportCsv = () => {
    const head = [trD('tx.colDate'), trD('tx.colTime'), trD('tx.colCode'), trD('dist.fCust'), trD('cl.colCode'), trD('tx.colType'), trD('tx.colGalon'), trD('tx.colPrice'), trD('tx.colAmount'), trD('tx.colStatus'), trD('cl.colArmada'), trD('tx.colStaff'), trD('cd.expandNote')];
    const src = selRows.length ? selRows : txFiltered;
    const body = src.map((t) => [t.txnDate, hhmm(t.createdAt), txnCode(t), nameOf(t), codeOf(t), methodLabel(t.method), t.method === 'pelunasan' ? '' : t.qty, t.method === 'pelunasan' ? '' : t.unitPriceLocked, amtOf(t), trD('tx.st.' + statusKey(t)), t.fleetId || '', t.actorName || '', t.note || '']);
    const csv = [head, ...body].map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
    const bl = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'transaksi.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doListPrint = () => { setTxVisible(Math.max(txVisible, txFiltered.length)); document.body.classList.add('txlist-printing'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('txlist-printing'), 100); }, 120); };
  // Bulk cancel (GM/owner, max 50) — loops the void-request endpoint (approval-gated) per row.
  const runBulkVoid = (reason, done) => {
    const items = (bulkVoid && bulkVoid.items) || [];
    Promise.all(items.map((t) => window.API.distribusi.transactions.void(t.id, { reason }).then(() => ({ ok: true })).catch(() => ({ ok: false }))))
      .then((rs) => { const ok = rs.filter((r) => r.ok).length; setBulkVoid(null); setSel({}); flash(trD('tx.bulkVoidDone', { n: ok })); reload(); if (onChanged) onChanged(); if (done) done(); });
  };

  // ── FORM ──
  if (view === 'form') {
    const activeType = entryTabs.some((x) => x.k === formType) ? formType : (entryTabs[0] && entryTabs[0].k);
    const payAfter = Math.max(0, paySisa - pAmount);
    const saveLabel = entrySaving ? '…' : (activeType === 'pengeluaran' && eAmt > WARN_AMOUNT && eBigOk) ? trD('dist.amtConfirmYes') : trD('dist.fSave');
    return (
      <div className="dist-dash screen-enter">
        <button type="button" className="dist-back" onClick={closeEntry}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trD('dist.backList')}</button>
        {/* ONE entry point — a segmented control switches the type. Hidden when only one type is allowed. */}
        {entryTabs.length > 1 && (
          <div className="tx-entry-tabs" role="tablist">
            {entryTabs.map((t, i) => { const TabIc = t.ic; return <button key={t.k} type="button" role="tab" aria-selected={activeType === t.k} className={`tx-entry-tab ${activeType === t.k ? 'on' : ''}`} onClick={() => setType(t.k)}><TabIc s={15} /><span>{t.l}</span><kbd className="tx-entry-kbd">Alt+{i + 1}</kbd></button>; })}
          </div>
        )}
        <div className="dist-form-wrap">
          <div className="card dist-form">
            {activeType === 'penjualan' && (<>
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
              {customers.length === 0
                ? <div className="dist-note">{trD('dist.noCustYet')}</div>
                : <UI.Dropdown value={fCust} options={custOpts} placeholder={trD('dist.fCustPh')} onChange={(v) => setFCust(v)} fluid />}
              <div className="dist-lockrow"><span className="dist-lockrow-l"><IconLock s={14} />{trD('dist.priceLocked')}</span><span className="dist-lockrow-r">{selCust ? rpFull(price) : '—'}<small> /{trD('dist.galonUnit')}</small></span></div>
              <div className="dist-form-row">
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('dist.fQty')}</label>
                  <div className="dist-stepper">
                    <button type="button" onClick={() => setQty(fQty - 1)}>−</button>
                    <input className="tnum" inputMode="numeric" value={fQty} aria-label={trD('dist.fQty')} onChange={(e) => setQty(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0)} onFocus={(e) => e.target.select()} />
                    <button type="button" onClick={() => setQty(fQty + 1)}>+</button>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('dist.fDate')}</label>
                  {staffMode ? <div className="dist-datelocked"><span><IconCalendar s={15} />{trD('dist.todayWord')} · {today}</span><IconLock s={13} /></div> : <DP.DateField value={fDate} onChange={setFDate} max={today} />}
                  {staffMode && <div className="dist-hint">{trD('dist.staffDateNote')}</div>}
                </div>
              </div>
              <div className="dist-gal-legend"><IconRefresh s={13} />{trD('dist.galLegend')}</div>
              <div className="dist-form-row">
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('dist.fGalOut')}</label>
                  <input className="fld tnum" inputMode="numeric" value={fGalOut} onChange={(e) => setFGalOut(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
                  <div className="dist-fieldhint">{trD('dist.fGalOutHelp')}</div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('dist.fGalIn')}</label>
                  <input className="fld tnum" inputMode="numeric" value={fGalIn} onChange={(e) => setFGalIn(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
                  <div className="dist-fieldhint">{trD('dist.fGalInHelp')}</div>
                </div>
              </div>
              <label className="fld-label">{trD('dist.fMethod')}</label>
              <div className="dist-method">
                <button type="button" className={`dist-method-btn lunas ${fMethod === 'lunas' ? 'on' : ''}`} onClick={() => setFMethod('lunas')}><IconCheck s={17} /><div><b>{trD('dist.lunas')}</b><span>{trD('dist.lunasHint')}</span></div></button>
                <button type="button" className={`dist-method-btn bon ${fMethod === 'bon' ? 'on' : ''}`} onClick={() => setFMethod('bon')}><IconInvoice s={17} /><div><b>{trD('dist.bon')}</b><span>{trD('dist.bonHint')}</span></div></button>
              </div>
              <label className="fld-label">{trD('dist.fNote')}</label>
              <input className="fld" value={fNote} maxLength={300} placeholder={trD('dist.fNotePh')} onChange={(e) => setFNote(e.target.value)} />
              {selCust && total > WARN_AMOUNT && <div className="dist-amt-warn"><IconInvoice s={14} />{trD('dist.amtWarn', { amt: rpFull(total) })}</div>}
              {fErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{fErr}</div>}
            </>)}

            {activeType === 'pelunasan' && (<>
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
              {customers.filter((c) => (c.sisaBon || 0) > 0).length === 0
                ? <div className="dist-note">{trD('dist.noBonCust')}</div>
                : <UI.Dropdown value={pCust} options={customers.filter((c) => (c.sisaBon || 0) > 0).map((c) => ({ value: c.id, label: (c.code ? c.code + ' · ' : '') + c.name + ' · ' + trD('dist.sisaBon') + ' ' + rpFull(c.sisaBon), search: custSearchStr(c) }))} placeholder={trD('dist.fCustPh')} onChange={(v) => { setPCust(v); setPAmount(0); }} fluid />}
              {paySel && <div className="dist-lockrow" style={{ marginTop: 10 }}><span className="dist-lockrow-l"><IconInvoice s={14} />{trD('dist.sisaBon')}</span><span className="dist-lockrow-r">{rpFull(paySisa)}</span></div>}
              <label className="fld-label">{trD('dist.payAmount')}</label>
              <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={pAmount ? pAmount.toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setPAmount(Math.min(paySisa, +e.target.value.replace(/\D/g, '') || 0))} /></div>
              <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.payHint')}{paySel ? ' · ' + trD('dist.payAfter', { sisa: rpFull(payAfter) }) : ''}</div>
              <label className="fld-label">{trD('dist.payMethod')}</label>
              <div className="cat-chips">{['cash', 'transfer'].map((m) => <button key={m} type="button" className={`cat-chip ${pMethod === m ? 'on' : ''}`} onClick={() => setPMethod(m)}>{trD('dist.pay_' + m)}</button>)}</div>
              {!staffMode && (<><label className="fld-label">{trD('dist.fDate')}</label><DP.DateField value={pDate} onChange={setPDate} max={today} /></>)}
              <label className="fld-label">{trD('dist.note')}</label>
              <input className="fld" value={pNote} onChange={(e) => setPNote(e.target.value)} placeholder={trD('dist.notePh')} />
              {pErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{pErr}</div>}
            </>)}

            {activeType === 'pengeluaran' && (<>
              {!scoped && (<>
                <label className="fld-label" style={{ marginTop: 0 }}>{trD('run.armada')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <select className="fld" value={eFleet} onChange={(e) => setEFleet(e.target.value)}><option value="">{trD('run.pickFleet')}</option>{fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}</select>
              </>)}
              <label className="fld-label" style={scoped ? { marginTop: 0 } : undefined}>{trD('exp.category')}</label>
              <div className="exp-cat-chips">
                {eCats.map((c) => <button key={c} type="button" className={`cat-chip ${eCat === c ? 'on' : ''}`} onClick={() => setECat(c)}>{expCatLabel(c)}</button>)}
                <button type="button" className={`cat-chip ${eCatCustom ? 'on' : ''}`} onClick={() => setECat(eCatCustom ? 'bensin' : '')}>{trD('exp.catCustom')}</button>
              </div>
              {eCatCustom && <input className="fld" style={{ marginTop: 8 }} value={eCat} placeholder={trD('exp.catOther')} onChange={(e) => setECat(e.target.value)} />}
              <div className="dist-form-row">
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('exp.amount')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                  <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={eAmtFocus ? eAmount : (eAmt ? eAmt.toLocaleString('id-ID') : '')} placeholder="0" onFocus={() => setEAmtFocus(true)} onBlur={() => setEAmtFocus(false)} onChange={(e) => { setEAmount(e.target.value.replace(/[^0-9]/g, '')); setEBigOk(false); }} /></div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label className="fld-label">{trD('dist.fDate')}</label>
                  <DP.DateField value={eDate} onChange={setEDate} max={today} />
                </div>
              </div>
              <label className="fld-label">{trD('dist.payMethod')}</label>
              <div className="cat-chips">{['tunai', 'transfer'].map((m) => <button key={m} type="button" className={`cat-chip ${eMethod === m ? 'on' : ''}`} onClick={() => setEMethod(m)}>{trD('exp.pay_' + m)}</button>)}</div>
              <label className="fld-label">{trD('exp.recipient')}</label>
              <input className="fld" value={eRecipient} maxLength={120} placeholder={trD('exp.recipientPh')} onChange={(e) => setERecipient(e.target.value)} />
              <label className="fld-label">{trD('exp.note')}</label>
              <input className="fld" value={eNote} maxLength={300} placeholder={trD('exp.notePh')} onChange={(e) => setENote(e.target.value)} />
              <label className="fld-label">{trD('exp.photo')}</label>
              <UI.FileAttach value={ePhoto} onChange={setEPhoto} camera accept="image/*" label={trD('exp.photoAdd')} />
              {eAmt > WARN_AMOUNT && <div className={`dist-amt-warn${eBigOk ? ' on' : ''}`}><IconInvoice s={14} />{eBigOk ? trD('dist.amtConfirm', { amt: rpFull(eAmt) }) : trD('dist.amtWarn', { amt: rpFull(eAmt) })}</div>}
              {eErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{eErr}</div>}
            </>)}

            <div className="tx-entry-actions">
              <button type="button" className="btn btn-ghost" disabled={!entryCanSave || entrySaving} onClick={() => doEntrySave(true)}>{trD('dist.saveAgain')}</button>
              <button type="button" className="btn btn-primary" disabled={!entryCanSave || entrySaving} onClick={() => doEntrySave(false)}>{saveLabel}</button>
            </div>
            <div className="dist-hint" style={{ textAlign: 'center', marginTop: 10 }}>{activeType === 'pengeluaran' ? trD('exp.formNote') : trD('dist.permanentNote')}</div>
          </div>

          <div className="card dist-form-sum">
            <div className="dist-fs-t">{trD('dist.summary')}</div>
            {activeType === 'penjualan' && (<>
              <div className="dist-fs-line"><span>{fQty} {trD('dist.galonUnit')} × {rpFull(price)}</span><b>{rpFull(total)}</b></div>
              <div className="dist-fs-total"><span>{trD('dist.total')}</span><b className="tnum">{rpFull(total)}</b></div>
              <div className="dist-fs-note">{fMethod === 'lunas' ? <><IconCheck s={13} />{trD('dist.lunasNote')}</> : <><IconInvoice s={13} />{trD('dist.bonNote')}</>}</div>
            </>)}
            {activeType === 'pelunasan' && (<>
              <div className="dist-fs-line"><span>{trD('dist.payAmount')}</span><b>{rpFull(pAmount)}</b></div>
              <div className="dist-fs-total"><span>{trD('dist.sisaBon')}</span><b className="tnum">{rpFull(payAfter)}</b></div>
              <div className="dist-fs-note"><IconInvoice s={13} />{trD('dist.payHint')}</div>
            </>)}
            {activeType === 'pengeluaran' && (<>
              <div className="dist-fs-line"><span>{expCatLabel(eCat || 'lainnya')}</span><b>−{rpFull(eAmt)}</b></div>
              <div className="dist-fs-total"><span>{trD('dist.total')}</span><b className="tnum">−{rpFull(eAmt)}</b></div>
              <div className="dist-fs-note"><IconCoinOut s={13} />{trD('exp.sumNote')}</div>
            </>)}
          </div>
        </div>

        {confirmOpen && (
          <div className="modal-scrim" onClick={() => setConfirmOpen(false)} style={{ zIndex: 200 }}>
            <div className="modal-card dist-confirm" onClick={(e) => e.stopPropagation()}>
              <span className="dist-confirm-ic"><IconLock s={24} /></span>
              <div className="dist-confirm-t">{trD('dist.confirmT')}</div>
              <div className="dist-confirm-s"><b>{selCust ? selCust.name : ''}</b> · {fQty} {trD('dist.galonUnit')} · {methodLabel(fMethod)} — <b>{rpFull(total)}</b>. {trD('dist.confirmS')}</div>
              {total > WARN_AMOUNT && <div className="dist-amt-warn" style={{ margin: '0 auto 4px', maxWidth: 340 }}><IconInvoice s={14} />{trD('dist.amtWarn', { amt: rpFull(total) })}</div>}
              <div className="dist-confirm-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>{trD('dist.cancel')}</button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => commitTxn(confirmAddAgain)}>{saving ? '…' : trD('dist.confirmYes')}</button>
              </div>
            </div>
          </div>
        )}
        {entryToast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{entryToast}</div>}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  // ── LIST ──
  const isExp = false;   // Pengeluaran is now merged INTO the list (a filter chip + own KPI) — no separate view.
  // Status cell — dispute/void/arsip/pending stay full badges; a plain "locked" (permanent) row is
  // reduced to a small lock icon+tooltip so the column isn't a wall of identical "Terkunci" chips.
  const statusBadgeOf = (t) => {
    if (t.status === 'void') return <span className="dist-badge void"><IconClose s={10} />{trD('tx.st.dibatalkan')}</span>;
    if (t.dispute) { const dm = DISPUTE_META[t.dispute.status]; if (dm) return <span className={'dist-badge ' + dm.cls}>{trD(dm.label)}</span>; }
    if (t.pendingRequest) return <span className="dist-badge pending"><IconClock s={10} />{trD('dist.pendingBadge')}</span>;
    if (t.legacy) return <span className="dist-badge arsip"><IconInvoice s={10} />{trD('dist.arsip')}</span>;
    return <span className="tx-lockicon" title={trD('dist.txLocked')}><IconLock s={12} /></span>;
  };
  const isMuted = (t) => t.status === 'void' || disputeDeducts(t);
  const colOn = (k) => !colHidden.has(k);   // manual Kolom toggle
  // ── ONE column system — a single COLUMNS list drives the <colgroup>, the <thead>, AND every <tr>,
  // so header and body share identical geometry and can never drift apart. Fixed px widths + one
  // flexible column (Pelanggan). `num` columns are right-aligned tabular-nums and never truncate. ──
  const CUSTMIN = 200;
  const COLUMNS = [
    { k: 'check', w: 40, cls: 'tx-ck no-print', always: 1 },
    { k: 'date', w: 108, sort: 'date', label: 'tx.colDate' },
    { k: 'code', w: 148, cls: 'tx-code', label: 'tx.colCode', drop: 4 },
    { k: 'cust', flex: 1, min: CUSTMIN, sort: 'customer', label: 'dist.fCust', always: 1 },
    { k: 'type', w: 108, label: 'tx.colType' },
    { k: 'galon', w: 72, num: 1, sort: 'qty', label: 'tx.colGalon' },
    { k: 'price', w: 104, num: 1, label: 'tx.colPrice', drop: 3 },
    { k: 'amount', w: 144, num: 1, sort: 'amount', label: 'tx.colAmount', always: 1 },
    { k: 'status', w: 116, label: 'tx.colStatus', drop: 5 },
    { k: 'armada', w: 90, label: 'cl.colArmada', drop: 2 },
    { k: 'staff', w: 112, cls: 'tx-staff', sort: 'petugas', label: 'tx.colStaff', drop: 1 },
    { k: 'aksi', w: 44, cls: 'tx-r no-print', always: 1 },
  ];
  // Manual Kolom hiding first, then auto-drop to fit the measured width (Petugas → Armada → Harga →
  // Kode → Status). Dropped fields still show in the slide-over. Never wrap, never h-scroll ≥900px.
  const manualCols = COLUMNS.filter((c) => c.always || colOn(c.k) || c.k === 'aksi');
  const dropSeq = ['staff', 'armada', 'price', 'code', 'status'];
  const autoDropped = new Set();
  const fixedSum = () => manualCols.filter((c) => !autoDropped.has(c.k)).reduce((s, c) => s + (c.flex ? CUSTMIN : c.w), 0);
  for (const dk of dropSeq) { if (fixedSum() <= availW) break; if (manualCols.some((c) => c.k === dk)) autoDropped.add(dk); }
  const cols = manualCols.filter((c) => !autoDropped.has(c.k));
  const tableMin = fixedSum();
  const cursorTxn = cursor >= 0 && cursor < txSorted.length ? txSorted[cursor] : null;
  // A merged expense row's cells: own "Pengeluaran" badge, negative red nominal, no galon/harga.
  const expCellOf = (t, k) => {
    switch (k) {
      case 'check': return <input type="checkbox" aria-label="pilih pengeluaran" checked={!!sel[t.id]} onChange={() => setSel((p) => ({ ...p, [t.id]: !p[t.id] }))} />;
      case 'date': return <><b className="tx-dated">{fmtDateShort(t.txnDate)}</b><span className="tx-time">{hhmm(t.createdAt)}</span></>;
      case 'code': return <span className="tx-codetxt">{trD('exp.pay_' + t.expMethod)}</span>;
      case 'cust': return <><div className="tx-custname">{expCatLabel(t.category)}</div>{(t.recipient || t.note) ? <div className="tx-custcode">{t.recipient || t.note}</div> : null}</>;
      case 'type': return <span className="dist-status tx-exp-badge"><IconCoinOut s={11} />{trD('dist.tabPengeluaran')}</span>;
      case 'galon': return '—';
      case 'price': return '—';
      case 'amount': return <span className={'tx-amt tx-exp-amt' + (t.status === 'void' ? ' muted' : '')}>{t.status === 'void' ? <s>−{rpFull(t.amount)}</s> : '−' + rpFull(t.amount)}</span>;
      case 'status': return t.status === 'void' ? <span className="dist-badge void"><IconClose s={10} />{trD('tx.st.dibatalkan')}</span> : <span className="tx-lockicon" title={trD('exp.btn')}><IconCoinOut s={12} /></span>;
      case 'armada': return <span className="tx-ellip">{t.fleetId || '—'}</span>;
      case 'staff': return <span className="tx-ellip">{t.actorName || '—'}</span>;
      case 'aksi': return <IconCaret s={14} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)' }} />;
      default: return null;
    }
  };
  const cellOf = (t, k, muted) => {
    if (t._exp) return expCellOf(t, k);
    switch (k) {
      case 'check': return <input type="checkbox" aria-label="pilih transaksi" checked={!!sel[t.id]} onChange={() => setSel((p) => ({ ...p, [t.id]: !p[t.id] }))} />;
      case 'date': return <><b className="tx-dated">{fmtDateShort(t.txnDate)}</b><span className="tx-time">{hhmm(t.createdAt)}</span></>;
      case 'code': return <span className="tx-codetxt">{txnCode(t)}</span>;
      case 'cust': return <><div className="tx-custname">{nameOf(t) || '—'}</div>{codeOf(t) ? <div className="tx-custcode">{codeOf(t)}</div> : null}</>;
      case 'type': return <span className={'dist-status ' + (METHOD_META[t.method] ? METHOD_META[t.method].cls : '')}>{methodLabel(t.method)}</span>;
      case 'galon': return t.method === 'pelunasan' ? '—' : numX(t.qty);
      case 'price': return t.method === 'pelunasan' ? '—' : rpFull(t.unitPriceLocked);
      case 'amount': return <span className={'tx-amt' + (muted ? ' muted' : '')}>{muted ? <s>{rpFull(amtOf(t))}</s> : rpFull(amtOf(t))}{disputeDeducts(t) ? <span className="tx-ack"> → {rpFull(t.dispute.customerClaimAmount || 0)}</span> : null}</span>;
      case 'status': return statusBadgeOf(t);
      case 'armada': return <span className="tx-ellip">{t.fleetId || '—'}</span>;
      case 'staff': return <span className="tx-ellip">{t.actorName || '—'}</span>;
      case 'aksi': return <IconCaret s={14} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)' }} />;
      default: return null;
    }
  };
  const cellCls = (c) => 'tx-td tx-td-' + c.k + (c.num ? ' tx-r tnum' : '') + (c.cls ? ' ' + c.cls : '');
  const txTableRow = (t) => {
    const muted = isMuted(t);
    const cls = 'txt-row' + (t._exp ? ' tx-exp-row' : '') + (muted ? ' is-muted' : '') + (detailTxn && detailTxn.id === t.id ? ' active' : '') + (cursorTxn && cursorTxn.id === t.id ? ' cursor' : '');
    return (
      <tr key={t.id} className={cls} onClick={() => openDetail(t)}>
        {cols.map((c) => <td key={c.k} className={cellCls(c)} onClick={c.k === 'check' ? (e) => e.stopPropagation() : undefined}>{cellOf(t, c.k, muted)}</td>)}
      </tr>
    );
  };
  const headTh = (c) => {
    if (c.k === 'check') return <th key="check" className="tx-th tx-ck no-print"><input type="checkbox" aria-label="pilih semua" checked={txShown.length > 0 && txShown.every((t) => sel[t.id])} onChange={(e) => { const on = e.target.checked; setSel((p) => { const n = { ...p }; txShown.forEach((t) => { if (on) n[t.id] = true; else delete n[t.id]; }); return n; }); }} /></th>;
    if (c.k === 'aksi') return <th key="aksi" className="tx-th no-print" aria-hidden="true" />;
    const sortable = !!c.sort, on = sortable && sortKey === c.sort;
    return <th key={c.k} className={'tx-th tx-th-' + c.k + (c.num ? ' tx-r' : '') + (sortable ? ' tx-sortable' : '') + (on ? ' sorted' : '')}
      onClick={sortable ? () => { if (sortKey === c.sort) setSortDir((d) => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(c.sort); setSortDir('desc'); } } : undefined}
      aria-sort={on ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined}>{trD(c.label)}{on ? <span className="tx-sortarrow">{sortDir === 'desc' ? '↓' : '↑'}</span> : null}</th>;
  };
  const txColGroup = <colgroup>{cols.map((c) => <col key={c.k} style={c.flex ? undefined : { width: c.w + 'px' }} />)}</colgroup>;
  const txCardRow = (t) => {
    const muted = isMuted(t);
    if (t._exp) return (
      <div key={t.id} className={'cl-card tx-card tx-exp-row' + (muted ? ' is-muted' : '')} onClick={() => openDetail(t)}>
        <div className="tx-card-top">
          <div className="tx-card-id"><div className="tx-card-cust">{expCatLabel(t.category)}</div><div className="tx-card-tags"><span className="dist-status tx-exp-badge"><IconCoinOut s={11} />{trD('dist.tabPengeluaran')}</span>{t.status === 'void' ? <span className="dist-badge void"><IconClose s={10} />{trD('tx.st.dibatalkan')}</span> : null}</div></div>
          <div className={'tx-card-amt tnum tx-exp-amt' + (muted ? ' muted' : '')}>−{rpFull(t.amount)}</div>
        </div>
        <div className="tx-card-meta"><span>{fmtDateShort(t.txnDate)} {hhmm(t.createdAt)}</span>{t.recipient ? <span>{t.recipient}</span> : null}{t.actorName ? <span>{t.actorName}</span> : null}</div>
      </div>
    );
    return (
      <div key={t.id} className={'cl-card tx-card' + (muted ? ' is-muted' : '')} onClick={() => openDetail(t)}>
        <div className="tx-card-top">
          <div className="tx-card-id"><div className="tx-card-cust">{nameOf(t) || '—'}</div><div className="tx-card-tags"><span className={'dist-status ' + (METHOD_META[t.method] ? METHOD_META[t.method].cls : '')}>{methodLabel(t.method)}</span>{statusBadgeOf(t)}</div></div>
          <div className={'tx-card-amt tnum' + (muted ? ' muted' : '')}>{muted ? <s>{rpFull(amtOf(t))}</s> : rpFull(amtOf(t))}</div>
        </div>
        <div className="tx-card-meta"><span>{fmtDateShort(t.txnDate)} {hhmm(t.createdAt)}</span><span>{txnCode(t)}</span>{t.actorName ? <span>{t.actorName}</span> : null}</div>
      </div>
    );
  };
  return (
    <div className="dist-dash screen-enter" ref={rootRef}>
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      {/* STICKY toolbar — row 1 (search grows · period · one primary + ⋯ overflow), row 2 (filter chips). */}
      {!isExp && (<div className="tx-toolbar" ref={toolRef}>
        <div className="tx-toolrow tx-toolrow-1">
          <div className="tx-infowrap"><button type="button" className="tx-infobtn" aria-label={trD('dist.permBanner')} title={trD('dist.permBanner')} onClick={() => { setMoreMenu(false); setColMenu(false); setInfoOpen((v) => !v); }}><IconWarn s={16} /></button>
            {infoOpen && <><div className="cd-menu-scrim" onClick={() => setInfoOpen(false)} /><div className="tx-infopop" role="tooltip"><IconLock s={14} />{trD('dist.permBanner')}</div></>}
          </div>
          <div className="dist-search tx-search"><IconSearch s={16} /><input value={q} placeholder={trD('tx.searchPh')} aria-label={trD('tx.searchPh')} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" aria-label="clear" onClick={() => setQ('')}><IconClose s={13} /></button>}</div>
          <div className="dist-chips tx-periodchips tx-segmented">{[['all', trD('dist.fAll')], ['today', trD('dist.perToday')], ['week', trD('dist.per7d')], ['month', trD('dist.perMonth')], ['lastMonth', trD('pc.pLastMonth')], ['range', trD('dist.perRange')]].filter(([k]) => periodAllowed(k)).map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
          {period === 'range' && canViewAll && <div className="dist-period-range"><DP.DateField value={rFrom} onChange={setRFrom} max={rTo || today} /><span>–</span><DP.DateField value={rTo} onChange={setRTo} min={rFrom || undefined} max={today} /></div>}
          <div style={{ flex: 1 }} />
          <button type="button" className={`btn btn-ghost btn-sm ${anyFilter ? 'on' : ''}`} onClick={() => setAdvOpen(true)}><IconFilter s={15} />{trD('tx.advanced')}</button>
          {(canInput || canExpense) && <button type="button" className="btn btn-primary btn-sm dist-newbtn" onClick={() => openEntry(formType)}><IconPlus s={16} />{trD('dist.newTxn')}</button>}
          <div className="tx-morewrap">
            <button type="button" className={`btn btn-ghost btn-sm tx-morebtn ${moreMenu ? 'on' : ''}`} aria-haspopup="true" aria-expanded={moreMenu} aria-label={trD('cd.more')} onClick={() => setMoreMenu((v) => !v)}><IconDots s={18} /></button>
            {moreMenu && <><div className="cd-menu-scrim" onClick={() => setMoreMenu(false)} /><div className="cd-menu tx-moremenu" role="menu">
              <button type="button" className="cd-menu-item" disabled={!txFiltered.length} onClick={() => { setMoreMenu(false); exportCsv(); }}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('cl.csv')}</button>
              <button type="button" className="cd-menu-item" disabled={!txFiltered.length} onClick={() => { setMoreMenu(false); doListPrint(); }}><IconDownload s={15} />{trD('dist.print')}</button>
              {(canInput || canExpense) && <div className="cd-menu-div" />}
              {canInput && <button type="button" className="cd-menu-item" onClick={() => { setMoreMenu(false); openEntry('pelunasan'); }}><IconInvoice s={15} />{trD('dist.payBon')}</button>}
              {canExpense && <button type="button" className="cd-menu-item" onClick={() => { setMoreMenu(false); openEntry('pengeluaran'); }}><IconCoinOut s={15} />{trD('exp.btn')}</button>}
              <div className="cd-menu-div" />
              <button type="button" className="cd-menu-item" onClick={() => { setMoreMenu(false); setColMenu(true); }}><IconSettings s={15} />{trD('tx.columns')}</button>
              <button type="button" className="cd-menu-item" onClick={() => { setMoreMenu(false); setAdvOpen(true); }}><IconFilter s={15} />{trD('tx.advanced')}</button>
              <div className="cd-menu-div" />
              <div className="tx-menu-density"><span>{trD('tx.density')}</span><div className="tx-denseg">{[['comfortable', trD('tx.densNyaman')], ['compact', trD('tx.densPadat')]].map(([k, l]) => <button key={k} type="button" className={density === k ? 'on' : ''} onClick={() => setDensity(k)}>{l}</button>)}</div></div>
            </div></>}
          </div>
          <div className="tx-colwrap">
            {colMenu && <><div className="cd-menu-scrim" onClick={() => setColMenu(false)} /><div className="cd-menu tx-colmenu" role="menu">{TX_COLS.map((c) => <label key={c.k} className="tx-colitem"><input type="checkbox" checked={!colHidden.has(c.k)} onChange={() => setColHidden((p) => { const n = new Set(p); n.has(c.k) ? n.delete(c.k) : n.add(c.k); return n; })} />{trD(c.l)}</label>)}</div></>}
          </div>
        </div>
        <div className="tx-toolrow tx-toolrow-2">
          {[['lunas', trD('dist.lunas'), methodCounts.lunas], ['bon', trD('dist.bon'), methodCounts.bon], ['pelunasan', trD('dist.pelunasan'), methodCounts.pelunasan], ['penyesuaian', trD('adj.kindBon'), methodCounts.penyesuaian], ['pengeluaran', trD('dist.tabPengeluaran'), methodCounts.pengeluaran]].filter(([k, l, n]) => k !== 'pengeluaran' || n > 0 || methodSel.has('pengeluaran')).map(([k, l, n]) => <button key={k} type="button" className={`dist-chip ${k === 'pengeluaran' ? 'tx-chip-exp ' : ''}${methodSel.has(k) ? 'on' : ''}`} onClick={() => toggleIn(setMethodSel)(k)}>{l} <span className="dist-imp-chipn">{n}</span></button>)}
          <span className="tx-chipdiv" />
          {[['normal', trD('tx.st.normal'), statusCounts.normal], ['terkunci', trD('tx.st.terkunci'), statusCounts.terkunci], ['disengketakan', trD('cd.dispDisengketakan'), statusCounts.disengketakan], ['tidak_diakui', trD('cd.dispTidakDiakui'), statusCounts.tidak_diakui], ['kerugian', trD('cd.dispKerugian'), statusCounts.kerugian], ['dibatalkan', trD('tx.st.dibatalkan'), statusCounts.dibatalkan]].filter(([k, l, n]) => n > 0 || statusSel.has(k)).map(([k, l, n]) => <button key={k} type="button" className={`dist-chip tx-stchip st-${k} ${statusSel.has(k) ? 'on' : ''}`} onClick={() => toggleIn(setStatusSel)(k)}>{l} <span className="dist-imp-chipn">{n}</span></button>)}
          <span className="tx-chipdiv" />
          {[['manual', trD('cd.srcManual'), sourceCounts.manual], ['impor', trD('cd.srcImpor'), sourceCounts.impor]].map(([k, l, n]) => <button key={k} type="button" className={`dist-chip ${sourceSel.has(k) ? 'on' : ''}`} onClick={() => toggleIn(setSourceSel)(k)}>{l} <span className="dist-imp-chipn">{n}</span></button>)}
          {armadaList.length > 1 && <select className="tx-minisel" value={[...armadaSel][0] || ''} onChange={(e) => setArmadaSel(e.target.value ? new Set([e.target.value]) : new Set())}><option value="">{trD('cl.colArmada')}</option>{armadaList.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
          {petugasList.length > 1 && <select className="tx-minisel" value={[...petugasSel][0] || ''} onChange={(e) => setPetugasSel(e.target.value ? new Set([e.target.value]) : new Set())}><option value="">{trD('tx.colStaff')}</option>{petugasList.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
          <div style={{ flex: 1 }} />
          {presets.length > 0 && presets.map((ps, i) => <button key={i} type="button" className="dist-chip tx-preset" onClick={() => applyPreset(ps)} title={trD('tx.applyPreset')}>{ps.name}<span className="tx-preset-x" onClick={(e) => { e.stopPropagation(); removePreset(i); }}><IconClose s={10} /></span></button>)}
          {anyFilter && <button type="button" className="dist-chip tx-savepreset" onClick={savePreset}><IconPlus s={11} />{trD('tx.savePreset')}</button>}
          {anyFilter && <button type="button" className="dist-link tx-clearall" onClick={clearAll}>{trD('tx.clearAll')}</button>}
        </div>
      </div>)}
      {/* VIEW-WINDOW notice — the server clamped this request to the caller's allowed window. Never an
          empty/misleading table with no explanation. */}
      {!isExp && txWin.clamped && txWin.from && (
        <div className="tx-winnotice no-print"><IconLock s={14} />{trD('tx.windowNote', { range: txWin.from === txWin.to ? fmtDateShort(txWin.from) : (fmtDateShort(txWin.from) + ' – ' + fmtDateShort(txWin.to)) })}</div>
      )}

      {/* PENGELUARAN LIST — DistExpense rows for the chosen day/fleet: outflow-styled amount, category,
          note, who logged it, lazy photo thumbnail, plus the day's total on top. These are NEVER
          transactions and never appear under "Semua". Date picker + a void (recorded) action. */}
      {isExp && (
        <div className="dist-exp-inline">
          <div className="dist-exp-datebar"><span className="dist-exp-datelbl"><IconCalendar s={14} />{trD('dist.fDate')}</span><div style={{ minWidth: 170 }}><DP.DateField value={eDate} onChange={setEDate} max={today} /></div></div>
          <div className="card exp-total-card">
            <div className="exp-total-lbl"><IconCoinOut s={15} />{trD('exp.totalToday')}</div>
            <div className="tnum exp-total-big">{rpFull(expTotal)}</div>
            <div className="exp-total-meta">{numX(expActive.length)} {trD('exp.itemWord')} · {eDate}</div>
          </div>
          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title"><IconCoinOut s={15} /> {trD('exp.title')}</div></div>
            {expenses === null ? <div className="dist-empty">{trD('common.loading') || '…'}</div>
              : expenses.length === 0 ? <div className="dist-empty">{trD('exp.none')}</div>
              : (
                <div className="exp-list">
                  {expenses.map((r) => {
                    const voided = r.status === 'void';
                    return (
                      <div key={r.id} className={`exp-row ${voided ? 'is-void' : ''}`}>
                        {r.photoId ? <LocThumb photoId={r.photoId} onView={() => viewExpPhoto(r.photoId)} /> : <div className="exp-nophoto"><IconCoinOut s={16} /></div>}
                        <div className="exp-mid">
                          <div className="exp-line1"><span className={`exp-cat ${'c-' + r.category}`}>{expCatLabel(r.category)}</span>{r.fleetId ? <span className="exp-fleet">{r.fleetId}</span> : null}{voided && <span className="dist-badge void"><IconClose s={10} />{trD('dist.voidBadge')}</span>}</div>
                          <div className="exp-sub">{r.createdByName ? r.createdByName + ' · ' : ''}{fmtDT(r.createdAt)}{r.note ? ' · ' + r.note : ''}{voided && r.voidReason ? ' · ' + trD('exp.voidReason') + ': ' + r.voidReason : ''}</div>
                        </div>
                        <div className="exp-right">
                          <div className={`tnum exp-amt ${voided ? 'struck' : ''}`}>−{rpFull(r.amount)}</div>
                          {!voided && canExpense && <button type="button" className="dist-link danger exp-void" onClick={() => { setEErr(''); setEVoidReason(''); setEVoidRow(r); }}><IconClose s={12} />{trD('exp.void')}</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            <div className="dist-fieldhint" style={{ marginTop: 8 }}><IconClock s={12} />{trD('exp.hint')}</div>
          </div>
        </div>
      )}

      {!isExp && (<>
        {/* SUMMARY BAR — follows the ACTIVE filter. */}
        {txns !== null && txFiltered.length > 0 && (
          <div className={'cl-summary tx-summary' + (sExpense > 0 ? ' tx-summary-6' : '')}>
            <div className="cl-sumcard"><span className="cl-sumlbl">{trD('tx.sumCount')}</span><span className="cl-sumval">{numX(sCount)}</span></div>
            <div className="cl-sumcard"><span className="cl-sumlbl">{trD('tx.sumGalon')}</span><span className="cl-sumval">{numX(sGalon)}</span></div>
            <div className="cl-sumcard"><span className="cl-sumlbl">{trD('tx.sumNominal')}</span><span className="cl-sumval tnum">{rpFull(sNominal)}</span></div>
            <div className="cl-sumcard tx-splitcard"><span className="cl-sumlbl">{trD('tx.sumSplit')}</span>
              <div className="tx-splitlines">
                <div className="tx-splitline"><b className="tnum">{rpFull(sLunas)}</b><small>{trD('dist.lunas')}</small></div>
                <div className="tx-splitline b"><b className="tnum">{rpFull(sBon)}</b><small>{trD('dist.bon')}</small></div>
              </div>
              <div className="tx-splitbar" role="presentation"><span className="l" style={{ width: (sLunas + sBon > 0 ? Math.round(sLunas / (sLunas + sBon) * 100) : 0) + '%' }} /><span className="b" style={{ width: (sLunas + sBon > 0 ? Math.round(sBon / (sLunas + sBon) * 100) : 0) + '%' }} /></div>
            </div>
            <div className="cl-sumcard"><span className="cl-sumlbl">{trD('tx.sumAvg')}</span><span className="cl-sumval tnum">{rpFull(sAvg)}</span></div>
            {/* Pengeluaran is its OWN KPI — never mixed into Total Nominal / Rata-rata (sales figures). */}
            {sExpense > 0 && <div className="cl-sumcard tx-expcard"><span className="cl-sumlbl"><IconCoinOut s={12} />{trD('dist.tabPengeluaran')}</span><span className="cl-sumval tnum tx-exp-amt">−{rpFull(sExpense)}</span></div>}
          </div>
        )}
        {txns !== null && <div className="tx-filternote no-print"><IconFilter s={12} />{trD('tx.filterNote')}{qDeb && matchedFields.length ? ' · ' + trD('tx.matched', { f: matchedFields.join(', ') }) : ''}</div>}

        {/* BULK actions bar. */}
        {selRows.length > 0 && (
          <div className="kv-bulkbar no-print">
            <span><b>{selRows.length}</b> {trD('kv.selected')}</span>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={doListPrint}><IconDownload s={13} />{trD('dist.print')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}><IconDownload s={13} style={{ transform: 'rotate(180deg)' }} />{trD('cl.csv')}</button>
            {canVoid && <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setBulkVoid({ items: selRows.filter((t) => t.status !== 'void' && !t.legacy && !t.pendingRequest).slice(0, 50) })}><IconClose s={13} />{trD('dist.voidBtn')}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel({})}><IconClose s={13} />{trD('dist.cancel')}</button>
          </div>
        )}

        {txns === null ? (
          <div className="card dist-card cl-listcard tx-skelwrap"><div className={'tx-skel tx-dense-' + density}>{Array.from({ length: 14 }).map((_, i) => <div key={i} className="tx-skel-row"><span className="tx-skel-ck" /><span className="tx-skel-l1" /><span className="tx-skel-l2" /><span className="tx-skel-amt" /></div>)}</div></div>
        ) : (txns.length === 0 && !anyFilter) ? (
          <div className="card dist-card cl-listcard"><div className="cl-emptybox"><IconTx s={26} /><div className="cl-empty-t">{trD('dist.noTxn')}</div>{(canInput || canExpense) && <button type="button" className="btn btn-primary" onClick={() => openEntry(formType)}><IconPlus s={16} />{trD('dist.newTxn')}</button>}</div></div>
        ) : txFiltered.length === 0 ? (
          <div className="card dist-card cl-listcard"><div className="cl-emptybox"><IconSearch s={26} /><div className="cl-empty-t">{trD('dist.noResultFilter')}</div><button type="button" className="dist-link" onClick={clearAll}>{trD('tx.clearAll')}</button></div></div>
        ) : effView === 'table' ? (
          <div className="tx-tablewrap" style={{ '--tx-toolh': toolH + 'px' }}>
            <table className={'tx-table tx-dense-' + density} style={{ minWidth: tableMin + 'px' }}>
              {txColGroup}
              <thead><tr className="tx-headrow">{cols.map((c) => headTh(c))}</tr></thead>
              {grouped
                ? dayGroups.map((g) => (
                  <tbody key={g.date} className="tx-grp">
                    <tr className="tx-grphead"><td colSpan={cols.length}><div className="tx-grphead-in"><span className="tx-grphead-d">{groupDateLabel(g.date)}</span><span className="tx-grphead-sub">{numX(g.nota)} {trD('dist.notaWord')} · {numX(g.galon)} {trD('dist.galonUnit')} · <b className="tnum">{rpFull(g.nominal)}</b></span></div></td></tr>
                    {g.rows.map((t) => txTableRow(t))}
                  </tbody>
                ))
                : <tbody>{txShown.map((t) => txTableRow(t))}</tbody>}
            </table>
            <div ref={txSentinel} className="cl-sentinel" />
            {txVisible < txFiltered.length && <div className="cl-more">{trD('cl.showingWindow', { n: txShown.length, total: txFiltered.length })}</div>}
          </div>
        ) : (
          <div className="tx-cards">{txShown.map((t) => txCardRow(t))}<div ref={txSentinel} className="cl-sentinel" />{txVisible < txFiltered.length && <div className="cl-more">{trD('cl.showingWindow', { n: txShown.length, total: txFiltered.length })}</div>}</div>
        )}
      </>)}

      {/* SLIDE-OVER detail panel + advanced filters + bulk-cancel — rendered outside the flow. */}
      {detailTxn && !detailTxn._exp && <TxDetailPanel txn={detailTxn} custById={custById} idx={detailIdx} total={txSorted.length} canKoreksi={canKoreksi} canVoid={canVoid} canArchive={canArchive} canHardDelete={canHardDelete} userName={userName}
        onClose={() => setDetailIdx(-1)} onMove={moveDetail} onPrint={(t) => window.API.distribusi.customers.get(t.customerId).then((r) => setPrintFor2({ txn: (r.data.transactions || []).find((x) => x.id === t.id) || t, custObj: r.data })).catch(() => setPrintFor2({ txn: t }))} onKoreksi={(t) => openCorrect(t)} onVoid={(t) => { setVoidTxn(t); setVoidReason(''); }} onArchive={(t) => { setArchTxn({ ...t, toLegacy: !t.legacy }); setArchReason(''); setArchBon(false); }} onDelete={(t) => { setDelTxn(t); setDelReason(''); setDelConfirm(''); setDelPw(''); setDelErr(''); }} flash={flash} />}
      {advOpen && <TxAdvancedPanel onClose={() => setAdvOpen(false)} minAmt={minAmt} setMinAmt={setMinAmt} maxAmt={maxAmt} setMaxAmt={setMaxAmt} flagNote={flagNote} setFlagNote={setFlagNote} flagCorr={flagCorr} setFlagCorr={setFlagCorr} custFilter={custFilter} setCustFilter={setCustFilter} custOpts={custOpts} onClear={clearAll} anyFilter={anyFilter} />}
      {bulkVoid && <TxBulkVoidModal items={bulkVoid.items} onClose={() => setBulkVoid(null)} onRun={runBulkVoid} />}
      {printFor2 && <PrintCenter customer={printFor2.custObj || (custById[printFor2.txn.customerId] || { id: printFor2.txn.customerId, name: nameOf(printFor2.txn), code: codeOf(printFor2.txn), phone: phoneOf(printFor2.txn), transactions: [printFor2.txn], sisaBon: 0 })} userName={userName} mode="nota" txn={printFor2.txn} onClose={() => setPrintFor2(null)} />}

      {corrTxn && corrForm && (
        <div className="modal-scrim" onClick={() => setCorrTxn(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.korekT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{shortRef(corrTxn.id)} · {corrTxn.customer ? corrTxn.customer.name : ''} · {methodLabel(corrTxn.method)}</div></div><button className="jp-icon" onClick={() => setCorrTxn(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {/* This SUBMITS a request — the transaction changes only after an approver approves it. */}
              <div className="dist-infobox"><IconClock s={16} /><span>{trD('dist.korekApprovalInfo')}</span></div>
              {/* STRUCTURED, input-level fields (the total is recomputed, never typed directly). */}
              {corrSale ? (<>
                <div className="dist-form-row">
                  <div style={{ flex: 1, minWidth: 130 }}><label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fQty')}</label><input className="fld tnum" inputMode="numeric" value={corrForm.qty} onChange={(e) => setCorrForm({ ...corrForm, qty: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                  {/* PRICE is capability-gated: editable only with distribusiHargaMaster; everyone
                      else sees it locked (the server enforces this too, against unitPriceLocked). */}
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.hargaPerGalon')}{!canPrice && <IconLock s={11} style={{ marginLeft: 5, verticalAlign: '-1px' }} />}</label>
                    {canPrice
                      ? <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={corrForm.unitPrice ? (+corrForm.unitPrice).toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setCorrForm({ ...corrForm, unitPrice: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                      : <><div className="amt-input is-locked"><span className="amt-rp">Rp</span><input inputMode="numeric" value={corrForm.unitPrice ? (+corrForm.unitPrice).toLocaleString('id-ID') : ''} readOnly disabled aria-readonly="true" /></div>
                        <div className="dist-fieldhint dist-price-locked"><IconLock s={11} />{trD('dist.korekPriceLocked')}</div></>}
                  </div>
                </div>
                <div className="dist-form-row">
                  <div style={{ flex: 1, minWidth: 130 }}><label className="fld-label">{trD('dist.fGalOut')}</label><input className="fld tnum" inputMode="numeric" value={corrForm.gallonOut} onChange={(e) => setCorrForm({ ...corrForm, gallonOut: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                  <div style={{ flex: 1, minWidth: 130 }}><label className="fld-label">{trD('dist.fGalIn')}</label><input className="fld tnum" inputMode="numeric" value={corrForm.gallonIn} onChange={(e) => setCorrForm({ ...corrForm, gallonIn: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                </div>
                {/* METHOD toggle (bon ↔ lunas), pre-set to the current method. No price cap needed. */}
                <label className="fld-label">{trD('dist.fMethod')}</label>
                <div className="cat-chips">
                  {['lunas', 'bon'].map((m) => <button key={m} type="button" className={`cat-chip ${corrForm.method === m ? 'on' : ''}`} onClick={() => setCorrForm({ ...corrForm, method: m })}>{methodLabel(m)}</button>)}
                </div>
              </>) : (
                <><label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.payAmount')}</label>
                <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={corrForm.amount ? (+corrForm.amount).toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setCorrForm({ ...corrForm, amount: e.target.value.replace(/[^0-9]/g, '') })} /></div></>
              )}
              {/* Live preview of the recomputed total + the delta before submitting. */}
              <div className="dist-korek-preview">
                <div><span>{trD('dist.korekOld')}</span><b className="tnum">{rpFull(corrTxn.amount)}</b></div>
                <div className="dist-korek-arrow"><IconCaret s={16} style={{ transform: 'rotate(-90deg)' }} /></div>
                <div><span>{trD('dist.korekNew')}</span><b className="tnum">{rpFull(corrNewTotal)}</b></div>
                <div className="dist-korek-delta"><span>{trD('dist.korekDelta')}</span><b className={`tnum ${corrNewTotal - corrTxn.amount < 0 ? 'amt-neg' : corrNewTotal - corrTxn.amount > 0 ? 'amt-pos' : ''}`}>{corrNewTotal - corrTxn.amount >= 0 ? '+' : ''}{rpFull(corrNewTotal - corrTxn.amount)}</b></div>
              </div>
              {/* METHOD change → its effect on the customer's sisa bon, so the consequence is explicit. */}
              {corrMethodChanged && (
                <div className="dist-korek-methodline">
                  <span className="dist-korek-methodflip">{methodLabel(corrTxn.method)} → <b>{methodLabel(corrForm.method)}</b></span>
                  <span className={`dist-korek-bonimpact ${corrBonImpact < 0 ? 'amt-neg' : 'amt-pos'}`}>{trD('dist.korekSisaBon')} {corrBonImpact >= 0 ? '+' : '−'}{rpFull(Math.abs(corrBonImpact))}</span>
                </div>
              )}
              <label className="fld-label">{trD('dist.korekReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 62, padding: 12, resize: 'vertical' }} value={corrReason} placeholder={trD('dist.korekReasonPh')} onChange={(e) => setCorrReason(e.target.value)} />
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setCorrTxn(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!corrValid || corrSaving} onClick={commitCorrect}>{corrSaving ? '…' : trD('dist.korekSubmit')}</button></div>
          </div>
        </div>
      )}
      {/* ARCHIVE TOGGLE — active ↔ arsip (legacy). Reason required; recomputes bon/KPIs/gallon. */}
      {archTxn && (
        <div className="modal-scrim" onClick={() => setArchTxn(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD(archTxn.toLegacy ? 'dist.makeArchive' : 'dist.makeActive')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{shortRef(archTxn.id)} · {archTxn.customer ? archTxn.customer.name : ''} · {methodLabel(archTxn.method)} · {rpFull(archTxn.amount)}</div></div><button className="jp-icon" onClick={() => setArchTxn(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{trD(archTxn.toLegacy ? 'dist.archInfo' : 'dist.unarchInfo')}</span></div>
              {archTxn.toLegacy && (archTxn.method === 'bon' || archTxn.method === 'pelunasan') && (
                <label className="dist-arch-bon"><input type="checkbox" checked={archBon} onChange={(e) => setArchBon(e.target.checked)} /><span><b>{trD('dist.archKeepBon')}</b><small>{trD('dist.archKeepBonHint')}</small></span></label>
              )}
              <label className="fld-label">{trD('dist.voidReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 74, padding: 12, resize: 'vertical' }} value={archReason} placeholder={trD('dist.archReasonPh')} onChange={(e) => setArchReason(e.target.value)} />
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setArchTxn(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!archReason.trim() || archSaving} onClick={doArchive}>{archSaving ? '…' : trD(archTxn.toLegacy ? 'dist.makeArchive' : 'dist.makeActive')}</button></div>
          </div>
        </div>
      )}
      {/* VOID (recorded cancellation) — the recommended everyday cancel. Reason required + confirm. */}
      {voidTxn && (
        <div className="modal-scrim" onClick={() => setVoidTxn(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.voidT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{shortRef(voidTxn.id)} · {voidTxn.customer ? voidTxn.customer.name : ''} · {rpFull(voidTxn.amount)}</div></div><button className="jp-icon" onClick={() => setVoidTxn(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconClock s={16} /><span>{trD('dist.voidApprovalInfo')}</span></div>
              <label className="fld-label">{trD('dist.voidReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 74, padding: 12, resize: 'vertical' }} value={voidReason} placeholder={trD('dist.voidReasonPh')} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setVoidTxn(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!voidReason.trim() || voidSaving} onClick={doVoid}>{voidSaving ? '…' : trD('dist.voidSubmit')}</button></div>
          </div>
        </div>
      )}
      {/* HARD DELETE — owner-only, permanent, the heavier/rarer action. Typed ref/HAPUS + password + reason. */}
      {delTxn && (
        <div className="modal-scrim" onClick={() => setDelTxn(null)} style={{ zIndex: 210 }}>
          <div className="modal-card dist-danger-modal" style={{ maxWidth: 470 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800, color: 'var(--neg)' }}>{trD('dist.hardDelT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{shortRef(delTxn.id)} · {delTxn.customer ? delTxn.customer.name : ''} · {rpFull(delTxn.amount)}</div></div><button className="jp-icon" onClick={() => setDelTxn(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-warnbox"><IconWarn s={16} /><span>{trD('dist.hardDelWarn')}</span></div>
              <label className="fld-label">{trD('dist.hardDelReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 60, padding: 12, resize: 'vertical' }} value={delReason} placeholder={trD('dist.hardDelReasonPh')} onChange={(e) => setDelReason(e.target.value)} />
              <label className="fld-label">{trD('dist.hardDelType', { ref: shortRef(delTxn.id) })} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld" value={delConfirm} placeholder={shortRef(delTxn.id)} autoComplete="off" onChange={(e) => setDelConfirm(e.target.value)} />
              <label className="fld-label">{trD('dist.hardDelPw')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld" type="password" value={delPw} autoComplete="off" onChange={(e) => setDelPw(e.target.value)} />
              {delErr && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{delErr}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setDelTxn(null)}>{trD('dist.cancel')}</button><button className="btn btn-danger" disabled={!delReason.trim() || !delConfirm.trim() || !delPw || delSaving} onClick={doHardDelete}>{delSaving ? '…' : trD('dist.hardDelConfirm')}</button></div>
          </div>
        </div>
      )}
      {/* Pembayaran Bon is now a TAB in the unified entry (openEntry('pelunasan')) — no separate modal. */}
      {/* EXPENSE VOID — recorded cancellation (reason required); expenses are never silently deleted. */}
      {eVoidRow && (
        <div className="modal-scrim" onClick={() => setEVoidRow(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('exp.voidT')}</div><button className="jp-icon" onClick={() => setEVoidRow(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconClose s={16} /><span>{trD('exp.voidInfo')}</span></div>
              <div className="exp-void-sum"><span className={`exp-cat ${'c-' + eVoidRow.category}`}>{expCatLabel(eVoidRow.category)}</span> · <b>{rpFull(eVoidRow.amount)}</b>{eVoidRow.note ? ' · ' + eVoidRow.note : ''}</div>
              <label className="fld-label">{trD('exp.voidReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={eVoidReason} placeholder={trD('exp.voidReasonPh')} onChange={(e) => setEVoidReason(e.target.value)} />
              {eErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{eErr}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setEVoidRow(null)}>{trD('dist.cancel')}</button><button className="btn btn-danger" disabled={eSaving} onClick={commitExpenseVoid}>{eSaving ? '…' : trD('exp.void')}</button></div>
          </div>
        </div>
      )}
      {/* EXPENSE DETAIL — opened by clicking a Pengeluaran row in the list. Read-only fields + void. */}
      {eDetail && (
        <div className="modal-scrim" onClick={() => setEDetail(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}><IconCoinOut s={16} /> {trD('dist.tabPengeluaran')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{expCatLabel(eDetail.category)} · {eDetail.date || fmtDateShort(eDetail.txnDate)}</div></div><button className="jp-icon" onClick={() => setEDetail(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="tx-dp-amt tx-exp-amt">−{rpFull(eDetail.amount)}{eDetail.status === 'void' && <span className="dist-badge void" style={{ marginLeft: 8 }}><IconClose s={10} />{trD('tx.st.dibatalkan')}</span>}</div>
              <div className="tx-dp-kv"><span>{trD('exp.category')}</span><b>{expCatLabel(eDetail.category)}</b></div>
              <div className="tx-dp-kv"><span>{trD('dist.payMethod')}</span><b>{trD('exp.pay_' + (eDetail.method || 'tunai'))}</b></div>
              {eDetail.recipient ? <div className="tx-dp-kv"><span>{trD('exp.recipient')}</span><b>{eDetail.recipient}</b></div> : null}
              {eDetail.note ? <div className="tx-dp-kv"><span>{trD('exp.note')}</span><b>{eDetail.note}</b></div> : null}
              {eDetail.fleetId ? <div className="tx-dp-kv"><span>{trD('cl.colArmada')}</span><b>{eDetail.fleetId}</b></div> : null}
              <div className="tx-dp-kv"><span>{trD('cd.expandBy')}</span><b>{eDetail.createdByName || '—'}{eDetail.createdAt ? ' · ' + fmtDT(eDetail.createdAt) : ''}</b></div>
              {eDetail.photoId && <button type="button" className="dist-link" style={{ marginTop: 8 }} onClick={() => viewExpPhoto(eDetail.photoId)}><IconInvoice s={13} />{trD('exp.photo')}</button>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setEDetail(null)}>{trD('dist.cancel')}</button>
              {canExpense && eDetail.status !== 'void' && <button type="button" className="btn btn-danger" onClick={() => { setEVoidRow(eDetail); setEDetail(null); setEVoidReason(''); setEErr(''); }}><IconClose s={13} />{trD('exp.void')}</button>}
            </div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// Slide-over transaction detail — full row info, correction/dispute trail, actions. j/k moves rows.
function TxDetailPanel({ txn, custById, idx, total, canKoreksi, canVoid, canArchive, canHardDelete, userName, onClose, onMove, onPrint, onKoreksi, onVoid, onArchive, onDelete, flash }) {
  const t = txn;
  const voided = t.status === 'void';
  const pending = !voided && t.pendingRequest;
  const cust = custById[t.customerId] || t.customer || {};
  const cname = (t.customer && t.customer.name) || cust.name || '—';
  const ccode = (t.customer && t.customer.code) || cust.code || '';
  const amt = t.effectiveAmount != null ? t.effectiveAmount : t.amount;
  const corrections = (t.corrections || []).filter((x) => x.kind !== 'price');
  const showKoreksi = canKoreksi && !voided && !t.legacy && !pending;
  const showVoid = canVoid && !voided && !t.legacy && !pending;
  const copy = () => copyText([txnCode(t), fmtDateShort(t.txnDate) + ' ' + hhmm(t.createdAt), cname, methodLabel(t.method), t.method === 'pelunasan' ? rpFull(amt) : (numX(t.qty) + ' × ' + rpFull(t.unitPriceLocked) + ' = ' + rpFull(amt)), t.actorName || '', t.note || ''].join(' · '), () => flash(trD('cd.copied')));
  const kv = (k, v) => <div className="tx-dp-kv"><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="tx-slideover" role="dialog" aria-label={trD('tx.detailTitle')}>
      <div className="tx-slide-scrim no-print" onClick={onClose} />
      <div className="tx-slide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tx-slide-head">
          <div><div className="tx-slide-title">{txnCode(t)}</div><div className="tx-slide-sub">{fmtDateShort(t.txnDate)} · {hhmm(t.createdAt)}</div></div>
          <div className="tx-slide-nav no-print">
            <button type="button" className="jp-icon" aria-label={trD('tx.prevRow')} onClick={() => onMove(-1)} disabled={idx <= 0}><IconCaret s={16} style={{ transform: 'rotate(180deg)' }} /></button>
            <span className="tx-slide-pos">{idx + 1}/{total}</span>
            <button type="button" className="jp-icon" aria-label={trD('tx.nextRow')} onClick={() => onMove(1)} disabled={idx >= total - 1}><IconCaret s={16} /></button>
            <button type="button" className="jp-icon" aria-label={trD('common.close') || 'Tutup'} onClick={onClose}><IconClose s={18} /></button>
          </div>
        </div>
        <div className="tx-slide-body">
          <div className="tx-dp-badges">
            {voided ? <span className="dist-badge void">{trD('tx.st.dibatalkan')}</span> : t.legacy ? <span className="dist-badge arsip">{trD('dist.arsip')}</span> : <span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span>}
            {pending ? <span className="dist-badge pending"><IconClock s={10} />{trD('dist.pendingBadge')}</span> : null}
            {t.dispute && DISPUTE_META[t.dispute.status] ? <span className={'dist-badge ' + DISPUTE_META[t.dispute.status].cls}>{trD(DISPUTE_META[t.dispute.status].label)}</span> : null}
            {corrections.length ? <span className="dist-badge corr"><IconPencil s={10} />{trD('dist.corrected')}</span> : null}
          </div>
          <div className="tx-dp-amt tnum">{voided ? <s>{rpFull(amt)}</s> : rpFull(amt)}</div>
          {kv(trD('dist.fCust'), cname + (ccode ? ' · ' + ccode : ''))}
          {kv(trD('tx.colType'), methodLabel(t.method))}
          {t.method !== 'pelunasan' ? kv(trD('tx.rincian'), numX(t.qty) + ' × ' + rpFull(t.unitPriceLocked) + ' = ' + rpFull(amt)) : null}
          {kv(trD('tx.colStaff'), t.actorName || '—')}
          {t.fleetId ? kv(trD('cl.colArmada'), t.fleetId) : null}
          {kv(trD('cd.expandSrc'), t.legacy ? trD('cd.srcImpor') + (t.importBatchId ? ' · ' + t.importBatchId : '') : trD('cd.srcManual'))}
          {t.note ? kv(trD('cd.expandNote'), t.note) : null}
          {voided ? kv(trD('tx.st.dibatalkan'), (t.voidReason || '—') + (t.voidedByName ? ' · ' + t.voidedByName : '')) : null}
          {pending ? <div className="dist-infobox" style={{ marginTop: 8 }}><IconClock s={15} /><span>{trD(t.pendingRequest.kind === 'void' ? 'dist.pendVoidLine' : 'dist.pendCorrLine', { who: t.pendingRequest.requestedByName || '—' })}</span></div> : null}
          {corrections.length > 0 && <div className="tx-dp-trail"><div className="tx-dp-trail-h"><IconPencil s={12} />{trD('tx.corrTrail')}</div>{corrections.map((c, i) => <div key={i} className="tx-dp-trail-row"><b>{c.reason || '—'}</b><div className="tx-dp-trail-meta">{c.actorName || '—'} · {fmtDateShort(c.createdAt)}</div></div>)}</div>}
          {t.dispute && (t.dispute.trail || []).length > 0 && <div className="tx-dp-trail"><div className="tx-dp-trail-h"><IconWarn s={12} />{trD('disp.trailTitle')}</div>{(t.dispute.trail || []).map((x) => <div key={x.id} className="tx-dp-trail-row"><b>{dispReasonLabel(x.reason)}</b><div className="tx-dp-trail-meta">{x.raisedByName || '—'} · {fmtDateShort(x.createdAt)}{x.note ? ' · ' + x.note : ''}</div></div>)}</div>}
        </div>
        <div className="tx-slide-foot no-print">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPrint(t)}><IconDownload s={13} />{trD('cd.printNota')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}><IconInvoice s={13} />{trD('cd.copyDetail')}</button>
          {showKoreksi && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onKoreksi(t)}><IconPencil s={13} />{trD('dist.korek')}</button>}
          {showVoid && <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => onVoid(t)}><IconClose s={13} />{trD('dist.voidBtn')}</button>}
          {canArchive && !voided && !pending && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onArchive(t)}><IconInvoice s={13} />{trD(t.legacy ? 'dist.makeActive' : 'dist.makeArchive')}</button>}
          {canHardDelete && <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => onDelete(t)}><IconTrash s={13} />{trD('dist.hardDelBtn')}</button>}
        </div>
      </div>
    </div>
  );
}

// Advanced-filter slide-over: nominal range · customer picker · "hanya punya catatan" · "hanya pernah dikoreksi".
function TxAdvancedPanel({ onClose, minAmt, setMinAmt, maxAmt, setMaxAmt, flagNote, setFlagNote, flagCorr, setFlagCorr, custFilter, setCustFilter, custOpts, onClear, anyFilter }) {
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const fmt = (v) => v ? (parseInt(String(v).replace(/\D/g, ''), 10) || 0).toLocaleString('id-ID') : '';
  return (
    <div className="tx-slideover" role="dialog" aria-label={trD('tx.advanced')}>
      <div className="tx-slide-scrim" onClick={onClose} />
      <div className="tx-slide-panel tx-adv" onClick={(e) => e.stopPropagation()}>
        <div className="tx-slide-head"><div className="tx-slide-title">{trD('tx.advanced')}</div><button type="button" className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="tx-slide-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
          <UI.Dropdown value={custFilter} options={[{ value: '', label: trD('dist.fAll') }].concat(custOpts)} placeholder={trD('dist.fCust')} onChange={setCustFilter} fluid />
          <label className="fld-label">{trD('tx.amtRange')}</label>
          <div className="dist-form-row"><div className="dist-priceinput" style={{ flex: 1 }}><input inputMode="numeric" placeholder={trD('tx.min')} value={fmt(minAmt)} onChange={(e) => setMinAmt(e.target.value.replace(/\D/g, ''))} /></div><span style={{ alignSelf: 'center' }}>–</span><div className="dist-priceinput" style={{ flex: 1 }}><input inputMode="numeric" placeholder={trD('tx.max')} value={fmt(maxAmt)} onChange={(e) => setMaxAmt(e.target.value.replace(/\D/g, ''))} /></div></div>
          <label className="pc-check"><input type="checkbox" checked={flagNote} onChange={(e) => setFlagNote(e.target.checked)} /><span>{trD('tx.onlyNote')}</span></label>
          <label className="pc-check"><input type="checkbox" checked={flagCorr} onChange={(e) => setFlagCorr(e.target.checked)} /><span>{trD('tx.onlyCorr')}</span></label>
        </div>
        <div className="tx-slide-foot">{anyFilter && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>{trD('tx.clearAll')}</button>}<div style={{ flex: 1 }} /><button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{trD('common.close') || 'Tutup'}</button></div>
      </div>
    </div>
  );
}

// Bulk-cancel — a preview list + one shared reason; loops the void-REQUEST endpoint (approval-gated).
function TxBulkVoidModal({ items, onClose, onRun }) {
  const [reason, setReason] = uSx('');
  const [busy, setBusy] = uSx(false);
  React.useEffect(() => { const o = (e) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [busy]);
  const run = () => { if (!reason.trim() || busy || !items.length) return; setBusy(true); onRun(reason.trim(), () => {}); };
  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.voidBtn')} · {items.length}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('tx.bulkVoidSub')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-infobox" style={{ marginBottom: 10 }}><IconClock s={15} /><span>{trD('dist.korekApprovalInfo')}</span></div>
          <div className="kv-preview-list">{items.map((t) => <div key={t.id} className="kv-preview-row"><span>{(t.customer && t.customer.name) || '—'}{t.customer && t.customer.code ? ' · ' + t.customer.code : ''} · {txnCode(t)}</span><b className="tnum">{rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</b></div>)}</div>
          <label className="fld-label">{trD('tx.voidReasonLbl')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <textarea className="fld" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={trD('tx.voidReasonPh')} />
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose} disabled={busy}>{trD('dist.cancel')}</button><button className="btn dist-btn-danger" disabled={!reason.trim() || busy || !items.length} onClick={run}>{busy ? '…' : trD('tx.bulkVoidBtn', { n: items.length })}</button></div>
      </div>
    </div>
  );
}

// Standalone Pelunasan Bon — record a bon payment without selling water (galon 0).
function PaymentModal({ customers, staffMode, today, onClose, onSaved, presetCustomer }) {
  const [cust, setCust] = uSx(presetCustomer || '');
  const [amount, setAmount] = uSx(0);
  const [method, setMethod] = uSx('cash');
  const [date, setDate] = uSx(today);
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const withBon = (customers || []).filter((c) => (c.sisaBon || 0) > 0);
  const sel = (customers || []).find((c) => c.id === cust) || null;
  const sisa = sel ? (sel.sisaBon || 0) : 0;
  const valid = sel && sisa > 0 && amount > 0 && amount <= sisa;
  const save = () => {
    if (!valid || saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.transactions.create({ customerId: cust, method: 'pelunasan', payAmount: amount, payMethod: method, note: note.trim(), txnDate: staffMode ? today : (date || today) })
      .then((r) => { setSaving(false); onSaved(r.data); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.payBonT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.payBonSub')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fCust')}</label>
          {withBon.length === 0 ? <div className="dist-note">{trD('dist.noBonCust')}</div>
            : <UI.Dropdown value={cust} options={withBon.map((c) => ({ value: c.id, label: (c.code ? c.code + ' · ' : '') + c.name + ' · ' + trD('dist.sisaBon') + ' ' + rpFull(c.sisaBon), search: custSearchStr(c) }))} placeholder={trD('dist.fCustPh')} onChange={(v) => { setCust(v); setAmount(0); }} fluid />}
          {sel && <div className="dist-lockrow" style={{ marginTop: 10 }}><span className="dist-lockrow-l"><IconInvoice s={14} />{trD('dist.sisaBon')}</span><span className="dist-lockrow-r">{rpFull(sisa)}</span></div>}
          <label className="fld-label">{trD('dist.payAmount')}</label>
          <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={amount ? amount.toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setAmount(Math.min(sisa, +e.target.value.replace(/\D/g, '') || 0))} /></div>
          <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.payHint')}{sel ? ' · ' + trD('dist.payAfter', { sisa: rpFull(Math.max(0, sisa - amount)) }) : ''}</div>
          <label className="fld-label">{trD('dist.payMethod')}</label>
          <div className="cat-chips">
            {['cash', 'transfer'].map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{trD('dist.pay_' + m)}</button>)}
          </div>
          {!staffMode && (<><label className="fld-label">{trD('dist.fDate')}</label><DP.DateField value={date} onChange={setDate} max={today} /></>)}
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.notePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!valid || saving} onClick={save}>{saving ? '…' : trD('dist.paySave')}</button></div>
      </div>
    </div>
  );
}

// ── PELUNASAN TIDAK DITERIMA ─────────────────────────────────────────────────────
// The customer really paid their bon, but the money never reached the company (a staff member took
// it). Deliberately TWO-SIDED, and the modal says so out loud so nobody books it by accident:
//   • the customer's bon goes DOWN and their printed statement shows a received payment — they must
//     never be asked to pay twice, and none of the internal wording below reaches them;
//   • the company books it as a LOSS against the responsible staff and it counts as ZERO cash.
// Cap: distribusiBonAdjust (owner/GM tier, server-enforced). Reason + a responsible person are
// mandatory; an evidence photo is optional. `note` is the ONLY field the statement prints, so the
// reason is kept in its own internal field.
function PaymentNotReceivedModal({ customer, today, onClose, onSaved }) {
  const [amount, setAmount] = uSx(0);
  const [date, setDate] = uSx(today);
  const [staffId, setStaffId] = uSx('');
  const [staffName, setStaffName] = uSx('');
  const [reason, setReason] = uSx('');
  const [photo, setPhoto] = uSx(null);
  const [users, setUsers] = uSx(null);   // null = still loading / unavailable → free-text only
  const [ack, setAck] = uSx(false);
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  // The staff picker is a convenience, not a requirement: a user without manageUsers cannot list
  // accounts, and field helpers are often not accounts at all — so a typed name always works.
  uEx(() => { let live = true; if (!(window.API && window.API.users)) return; window.API.users.list().then((r) => { if (live) setUsers((r.data || []).filter((u) => u.active !== false)); }).catch(() => { if (live) setUsers([]); }); return () => { live = false; }; }, []);
  const sisa = customer ? (customer.sisaBon || 0) : 0;
  const who = staffId ? ((users || []).find((u) => u.id === staffId) || {}).name || '' : staffName.trim();
  const valid = amount > 0 && amount <= sisa && !!who && !!reason.trim() && ack && !saving;
  const save = () => {
    if (!valid) return;
    setSaving(true); setErr('');
    const body = { customerId: customer.id, amount, txnDate: date || today, lossReason: reason.trim() };
    if (staffId) body.responsibleUserId = staffId; else body.responsibleName = staffName.trim();
    if (photo && photo.ref) body.lossPhotoId = photo.ref;
    window.API.distribusi.transactions.paymentNotReceived(body)
      .then((r) => { setSaving(false); onSaved(r.data); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('pnr.title')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name} · {trD('dist.sisaBon')} {rpFull(sisa)}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {/* Spell out both consequences before anything is typed. */}
          <div className="pnr-explain">
            <div className="pnr-side ok"><IconCoinIn s={14} /><div><b>{trD('pnr.sideCustT')}</b><span>{trD('pnr.sideCustD')}</span></div></div>
            <div className="pnr-side bad"><IconWarn s={14} /><div><b>{trD('pnr.sideCoT')}</b><span>{trD('pnr.sideCoD')}</span></div></div>
          </div>
          <label className="fld-label">{trD('pnr.amount')}</label>
          <div className="amt-input"><span className="amt-rp">Rp</span><input inputMode="numeric" value={amount ? amount.toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setAmount(Math.min(sisa, +e.target.value.replace(/\D/g, '') || 0))} /></div>
          <div className="dist-hint" style={{ marginTop: 6 }}>{trD('pnr.amountHint', { sisa: rpFull(Math.max(0, sisa - amount)) })}</div>
          <label className="fld-label">{trD('dist.fDate')}</label>
          <DP.DateField value={date} onChange={setDate} max={today} />
          <label className="fld-label">{trD('pnr.staff')}</label>
          {users && users.length > 0 && (
            <UI.Dropdown value={staffId} options={[{ value: '', label: trD('pnr.staffOther') }].concat(users.map((u) => ({ value: u.id, label: u.name + (u.username ? ' · ' + u.username : ''), search: (u.name || '') + ' ' + (u.username || '') })))} placeholder={trD('pnr.staffPh')} onChange={(v) => { setStaffId(v); if (v) setStaffName(''); }} fluid />
          )}
          {(!users || users.length === 0 || !staffId) && (
            <input className="fld" style={{ marginTop: users && users.length ? 8 : 0 }} value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder={trD('pnr.staffNamePh')} />
          )}
          <label className="fld-label">{trD('pnr.reason')}</label>
          <textarea className="fld" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={trD('pnr.reasonPh')} />
          <div className="dist-hint" style={{ marginTop: 6 }}>{trD('pnr.reasonHint')}</div>
          <label className="fld-label">{trD('pnr.proof')}</label>
          <UI.FileAttach value={photo} onChange={setPhoto} camera accept="image/*" label={trD('pnr.proofAdd')} />
          <label className="dist-arch-bon pnr-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{trD('pnr.ack')}</span></label>
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!valid} onClick={save}>{saving ? '…' : trD('pnr.save')}</button></div>
      </div>
    </div>
  );
}

window.DISTPAY = { PaymentModal, PaymentNotReceivedModal };

// Build an invoice from a customer's transactions: pick a scope (unpaid bon / period /
// all sales), a due date + note, preview the billed items + total, then create.
function InvoiceBuilder({ customer, onClose, onCreated }) {
  const [scope, setScope] = uSx('unpaidBon');
  const [dateFrom, setDateFrom] = uSx('');
  const [dateTo, setDateTo] = uSx('');
  const [dueDate, setDueDate] = uSx('');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const today = (window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  // Bill ONLY what the server will accept: live (non-legacy, non-void) lunas/bon sales, minus
  // disputed (tidak_diakui/kerugian) rows. This keeps the button state honest — no more "enabled
  // but the server returns 400 Tidak ada transaksi".
  const txns = (customer.transactions || []).filter((t) => (t.method === 'lunas' || t.method === 'bon') && !t.legacy && !t.voided && !disputeDeducts(t));
  const preview = txns.filter((t) => {
    if (scope === 'unpaidBon') return t.method === 'bon';
    if (scope === 'period') return (!dateFrom || t.txnDate >= dateFrom) && (!dateTo || t.txnDate <= dateTo);
    return true;   // 'selected'/all sales
  });
  const total = preview.reduce((s, t) => s + (t.effectiveAmount != null ? t.effectiveAmount : t.amount), 0);
  const create = () => {
    if (saving || !preview.length) return;
    setSaving(true); setErr('');
    const body = { scope, dueDate: dueDate || '', note: note.trim() };
    if (scope === 'period') { if (dateFrom) body.dateFrom = dateFrom; if (dateTo) body.dateTo = dateTo; }
    if (scope === 'selected') body.transactionIds = preview.map((t) => t.id);
    window.API.distribusi.invoices.create(customer.id, body)
      .then((r) => { setSaving(false); onCreated(r.data); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const scopes = [['unpaidBon', trD('dist.invScopeBon')], ['period', trD('dist.invScopePeriod')], ['selected', trD('dist.invScopeAll')]];
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.makeInvoice')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.invScope')}</label>
          <div className="cat-chips">{scopes.map(([k, l]) => <button key={k} type="button" className={`cat-chip ${scope === k ? 'on' : ''}`} onClick={() => setScope(k)}>{l}</button>)}</div>
          {scope === 'period' && (
            <div className="dist-form-row" style={{ marginTop: 10 }}>
              <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.from')}</label><DP.DateField value={dateFrom} onChange={setDateFrom} max={dateTo || today} /></div>
              <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.to')}</label><DP.DateField value={dateTo} onChange={setDateTo} min={dateFrom || undefined} max={today} /></div>
            </div>
          )}
          <label className="fld-label">{trD('dist.dueDate')}</label>
          <DP.DateField value={dueDate} onChange={setDueDate} min={today} allowFuture placeholder={trD('dist.dueDate')} />
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.notePh')} />
          <div className="dist-lockrow" style={{ marginTop: 12 }}><span className="dist-lockrow-l"><IconInvoice s={14} />{trD('dist.invPreview', { n: preview.length })}</span><span className="dist-lockrow-r">{rpFull(total)}</span></div>
          {preview.length === 0 && !err && <div className="dist-hint" style={{ marginTop: 8 }}><IconWarn s={12} />{trD('dist.invNoneBillable')}</div>}
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!preview.length || saving} onClick={create}>{saving ? '…' : trD('dist.invCreate')}</button></div>
      </div>
    </div>
  );
}

// Printable invoice / nota. Print (window.print) + WhatsApp share; a document only.
function InvoiceViewer({ invoice, onClose }) {
  uEx(() => { document.body.classList.add('invoice-open'); const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => { document.body.classList.remove('invoice-open'); window.removeEventListener('keydown', o); }; }, []);
  const iv = invoice; const cust = iv.customer || {};
  const share = () => {
    const lines = ['*Invoice ' + iv.number + '*', BIZ_NAME, trD('dist.invTo') + ': ' + cust.name, '',
      ...iv.items.map((it) => it.date + ' · ' + it.qty + ' ' + trD('dist.galonUnit') + ' · ' + rpFull(it.amount)),
      '', trD('dist.total') + ': ' + rpFull(iv.total), trD('dist.sisaBon') + ': ' + rpFull(iv.sisaBon),
      iv.dueDate ? trD('dist.dueDate') + ': ' + iv.dueDate : ''].filter(Boolean);
    window.open('https://wa.me/' + waNumber(cust.phone) + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };
  const ketOf = (it) => it.method === 'bon' ? trD('pc.ketBeliBon') : trD('pc.ketBeliLunas');
  return (
    <div className="modal-scrim invoice-overlay pc-overlay" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="invoice-sheet pc-sheet pc-doc pc-a4 pc-customer pc-invoice" onClick={(e) => e.stopPropagation()}>
        <div className="pc-toolbar no-print">
          <span className="pc-audlabel">{trD('dist.makeInvoice')}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => window.print()}><IconDownload s={16} />{trD('dist.print')}</button>
          {cust.phone ? <button className="btn btn-ghost" onClick={share}><IconWhatsApp s={16} />WhatsApp</button> : null}
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="pc-dochead">
          <div className="pc-biz"><Logo s={38} /><div><div className="pc-bizname">{BIZ_NAME}</div><div className="pc-bizsub">{BIZ_SUB}</div></div></div>
          <div className="pc-doctitle">{trD('inv.title')}</div>
        </div>
        <div className="pc-docmeta">
          <div className="pc-custblock">
            <div className="pc-custname">{cust.name}</div>
            <div className="pc-custsub">{[cust.code, cust.phone].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <div className="pc-metaright">
            <div><span>{trD('inv.no')}:</span> <b>{iv.number}</b></div>
            <div><span>{trD('dist.issueDate')}:</span> <b>{fmtDateShort(iv.issueDate)}</b></div>
            {iv.dueDate ? <div><span>{trD('dist.dueDate')}:</span> <b>{fmtDateShort(iv.dueDate)}</b></div> : null}
          </div>
        </div>
        <table className="pc-table pc-doctable">
          <thead><tr><th>{trD('pc.colDate')}</th><th>{trD('pc.colKet')}</th><th className="r">{trD('pc.colGalon')}</th><th className="r">{trD('pc.colUnit')}</th><th className="r">{trD('pc.colAmount')}</th></tr></thead>
          <tbody>{iv.items.map((it, i) => (<tr key={i}><td className="tnum">{fmtDateShort(it.date)}</td><td className="pc-ket">{ketOf(it)}</td><td className="r tnum">{numX(it.qty)}</td><td className="r tnum">{rpFull(it.unitPrice)}</td><td className="r tnum">{rpFull(it.amount)}</td></tr>))}</tbody>
        </table>
        <div className="pc-totalbox">
          <div className="pc-total-row"><span>{trD('inv.totalItems')}</span><b className="tnum">{rpFull(iv.total)}</b></div>
          <div className="pc-total-row pc-sisa"><span>{trD('inv.amountDue')}</span><b className="tnum" data-testid="inv-due">{rpFull(iv.sisaBon)}</b></div>
        </div>
        <div className="pc-docfoot">
          {iv.note ? <div className="pc-payinfo">{iv.note}</div> : null}
          <div className="pc-payinfo"><b>{trD('pc.payLbl')}:</b> {trD('pc.payInfo')}</div>
          <div className="pc-sign">
            <div><div className="pc-sign-line" />{trD('pc.signCust')}</div>
            <div><div className="pc-sign-line" />{trD('pc.signStaff')}</div>
          </div>
          <div className="pc-printedby no-print">{trD('dist.invBy')}: {iv.createdByName || '—'} · {fmtDateShort(iv.issueDate)}</div>
        </div>
      </div>
    </div>
  );
}

// ════════════════ SHARED PRINT CENTER — one source of truth ════════════════
// Options dialog (periode · arsip · penyesuaian · format · keluaran, remembered per user) → a
// printable sheet that reuses the invoice PRINT machinery (body.invoice-open + .invoice-overlay /
// .no-print + window.print). `mode`:
//   'statement' — full ledger for a period, with a running "Sisa Bon Berjalan" column, arsip /
//                 penyesuaian / cancelled markers, totals, and a signature block (bon disputes).
//   'nota'      — a single-transaction receipt (props.txn).
// `initial` carries the caller's on-screen filters (period/type/archive/search) so the toolbar
// "Cetak" prints EXACTLY what is on screen. The final SISA BON AKHIR always shows customer.sisaBon
// (the same figure as the on-screen KPI) so the printed statement reconciles to the app.
const PRINT_PREF_KEY = 'airro_print_prefs_v1';
const loadPrintPrefs = () => { try { return JSON.parse(localStorage.getItem(PRINT_PREF_KEY)) || {}; } catch (e) { return {}; } };
const savePrintPrefs = (p) => { try { localStorage.setItem(PRINT_PREF_KEY, JSON.stringify(p)); } catch (e) {} };
const printToday = () => (window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10);
// Transaksi-list period presets → {from,to} bounds (null = all). Used to narrow the SERVER load.
const txPeriodBounds = (period, from, to) => {
  const today = printToday();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: isoAddDays(today, -6), to: today };
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (period === 'lastMonth') { const dt = new Date(today + 'T00:00:00'); const lm = new Date(dt.getFullYear(), dt.getMonth() - 1, 1); const end = new Date(dt.getFullYear(), dt.getMonth(), 0); const p2 = (n) => String(n).padStart(2, '0'); const iso = (x) => x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); return { from: iso(lm), to: iso(end) }; }
  if (period === 'range') return (from && to) ? { from, to } : null;
  return null;   // 'all'
};
// Toggleable columns for the Transaksi table (Tanggal · Pelanggan · Nominal · [✓] · [⋯] are fixed).
const TX_COLS = [
  { k: 'code', l: 'tx.colCode' }, { k: 'type', l: 'tx.colType' },
  { k: 'galon', l: 'tx.colGalon' }, { k: 'price', l: 'tx.colPrice' }, { k: 'status', l: 'tx.colStatus' },
  { k: 'armada', l: 'cl.colArmada' }, { k: 'staff', l: 'tx.colStaff' },
];
const printPeriodBounds = (period, from, to) => {
  const today = printToday();
  if (period === '30') return { from: isoAddDays(today, -29), to: today };
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (period === 'lastMonth') { const dt = new Date(today + 'T00:00:00'); const lm = new Date(dt.getFullYear(), dt.getMonth() - 1, 1); const end = new Date(dt.getFullYear(), dt.getMonth(), 0); const p2 = (n) => String(n).padStart(2, '0'); const iso = (x) => x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); return { from: iso(lm), to: iso(end) }; }
  if (period === 'range') return (from && to) ? { from, to } : null;
  return null;   // 'all'
};

function PrintCenter({ customer, userName, mode, txn, initial, onClose }) {
  const pref = loadPrintPrefs();
  const init = initial || {};
  const [step, setStep] = uSx('opt');   // 'opt' (options) → 'doc' (preview sheet)
  const [period, setPeriod] = uSx(() => init.period || pref.period || 'all');   // all | 30 | month | lastMonth | range
  const [from, setFrom] = uSx(init.from || '');
  const [to, setTo] = uSx(init.to || '');
  const [incArchive, setIncArchive] = uSx(() => init.incArchive != null ? init.incArchive : (pref.incArchive != null ? pref.incArchive : true));
  const [incAdj, setIncAdj] = uSx(() => pref.incAdj != null ? pref.incAdj : true);
  const [format, setFormat] = uSx(() => pref.format || 'a4');    // a4 | r58 | r80
  const [output, setOutput] = uSx(() => pref.output || 'print'); // print | pdf | wa
  const [audience, setAudience] = uSx(() => pref.audience || 'customer'); // customer | internal
  const internal = audience === 'internal';
  const isNota = mode === 'nota';
  const today = printToday();
  const now = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const stamp = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
  const stampTime = p2(now.getHours()) + ':' + p2(now.getMinutes());

  // Sheet lifecycle: only add body.invoice-open while the SHEET is showing (not the options step),
  // so the print machinery targets the document. Escape closes the current step.
  uEx(() => {
    if (step !== 'doc') return;
    document.body.classList.add('invoice-open');
    return () => document.body.classList.remove('invoice-open');
  }, [step]);
  uEx(() => { const o = (e) => { if (e.key === 'Escape') { step === 'doc' ? setStep('opt') : onClose(); } }; window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [step]);

  // Running receivable over ALL transactions (oldest→newest) so a period subset still shows the
  // TRUE carried balance at each row. bonEffectOf mirrors the server BON rule.
  const allOldNew = (customer.transactions || []).slice().sort((a, b) => (a.txnDate || '').localeCompare(b.txnDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
  const runMap = {}; let rb = 0; allOldNew.forEach((t) => { rb += bonEffectOf(t); runMap[t.id] = rb; });
  const pb = printPeriodBounds(period, from, to);
  const q = String(init.search || '').trim().toLowerCase();
  const matchSearch = (t) => !q || [txnCode(t), t.note, String(t.amount)].some((x) => String(x || '').toLowerCase().includes(q));
  const rows = isNota ? (txn ? [txn] : []) : allOldNew.filter((t) => (
    (!pb || ((t.txnDate || '') >= pb.from && (t.txnDate || '') <= pb.to)) &&
    (incArchive || !t.legacy) &&
    (!init.type || init.type === 'all' || t.method === init.type) &&
    matchSearch(t)
  ));
  const effOf = (t) => (t.effectiveAmount != null ? t.effectiveAmount : t.amount);
  // CUSTOMER version EXCLUDES disputed (tidak_diakui/kerugian) rows — they are not being billed.
  // Their effect is already out of Sisa Bon, so the totals still reconcile. INTERNAL keeps everything.
  const docRows = internal ? rows : rows.filter((t) => !disputeDeducts(t));
  let galon = 0, pembelian = 0, pembayaran = 0, disputedTotal = 0;
  docRows.forEach((t) => {
    if (t.voided) return;
    galon += t.legacy ? 0 : (t.qty || 0);
    if (t.method === 'lunas') { pembelian += effOf(t); pembayaran += effOf(t); }
    else if (t.method === 'bon') { pembelian += effOf(t); }
    else if (t.method === 'pelunasan') { pembayaran += t.amount; }
    if (disputeDeducts(t)) disputedTotal += (t.dispute.disputedAmount || 0);   // internal only (customer excludes them)
  });
  // Group the document rows by month for a subtotal per month + a visible gap between groups.
  const monthOrder = []; const monthMap = {};
  docRows.forEach((t) => { const k = monthKeyOf(t) || '—'; if (!monthMap[k]) { monthMap[k] = { rows: [], galon: 0, jumlah: 0 }; monthOrder.push(k); } const g = monthMap[k]; g.rows.push(t); if (!t.voided) { g.galon += t.legacy ? 0 : (t.qty || 0); g.jumlah += (t.method === 'pelunasan' ? -t.amount : effOf(t)); } });
  // Plain-language description for the customer version — no codes, no badges.
  const ketOf = (t) => t.method === 'pelunasan' ? trD('pc.ketBayar') : t.method === 'bon' ? trD('pc.ketBeliBon') : trD('pc.ketBeliLunas');
  const approvedAdj = (customer.adjustments || []).filter((a) => a.status === 'approved');
  const adjBonTotal = approvedAdj.filter((a) => a.kind === 'bon').reduce((s, a) => s + ((a.after || 0) - (a.before || 0)), 0);
  const sisaAkhir = customer.sisaBon || 0;   // == the on-screen Sisa Bon KPI, by construction
  const docNo = (isNota ? 'NOTA-' : 'RWT-') + String((isNota && txn ? txn.id : customer.id) || '').slice(-6).toUpperCase() + '-' + stamp.replace(/-/g, '');
  const periodLabel = isNota ? '—' : (period === 'range' ? ((from || '…') + ' – ' + (to || '…')) : period === 'all' ? trD('dist.periodAll') : trD('pc.p' + period.charAt(0).toUpperCase() + period.slice(1)));

  const share = () => {
    const lines = isNota && txn
      ? ['*' + trD('pc.docNota') + '*', BIZ_NAME, (customer.code ? customer.code + ' · ' : '') + customer.name, '',
          txnCode(txn) + ' · ' + txn.txnDate, methodLabel(txn.method) + ' · ' + numX(txn.qty) + ' ' + trD('dist.galonUnit') + ' × ' + rpFull(txn.unitPriceLocked), trD('dist.amount') + ': ' + rpFull(effOf(txn)),
          txn.method === 'bon' ? trD('dist.sisaBon') + ': ' + rpFull(Math.max(0, runMap[txn.id] || 0)) : '', '', docNo].filter(Boolean)
      : ['*' + trD('dist.histTitle') + '*', BIZ_NAME, trD('dist.invTo') + ': ' + (customer.code ? customer.code + ' · ' : '') + customer.name, trD('dist.period') + ': ' + periodLabel, '',
          trD('dist.totalGalon') + ': ' + numX(galon), trD('pc.totPembelian') + ': ' + rpFull(pembelian), trD('pc.totPembayaran') + ': ' + rpFull(pembayaran), trD('pc.sisaAkhir') + ': ' + rpFull(sisaAkhir), '', trD('dist.txnCount', { n: rows.length }) + ' · ' + docNo];
    window.open('https://wa.me/' + waNumber(customer.phone) + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };
  const commit = () => {
    savePrintPrefs({ period, incArchive, incAdj, format, output, audience });
    if (output === 'wa') { share(); onClose(); return; }
    setStep('doc');
  };
  const doPrint = () => window.print();

  // ── OPTIONS STEP ──
  if (step === 'opt') {
    const periodOpts = [['all', trD('dist.periodAll')], ['30', trD('pc.p30')], ['month', trD('pc.pMonth')], ['lastMonth', trD('pc.pLastMonth')], ['range', trD('pc.pRange')]];
    const fmtOpts = [['a4', trD('pc.fmtA4')], ['r58', trD('pc.fmt58')], ['r80', trD('pc.fmt80')]];
    const outOpts = [['print', trD('pc.outPrint')], ['pdf', trD('pc.outPdf')]].concat(customer.phone ? [['wa', trD('pc.outWa')]] : []);
    return (
      <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
        <div className="modal-card pc-optcard" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{isNota ? trD('pc.titleNota') : trD('pc.titleStatement')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.code ? customer.code + ' · ' : ''}{customer.name}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
          <div className="modal-body">
            {/* Audience toggle — customer-facing (default, hides internal metadata) vs internal archive. */}
            <label className="fld-label" style={{ marginTop: 0 }}>{trD('pc.audience')}</label>
            <div className="cat-chips">
              <button type="button" className={`cat-chip ${!internal ? 'on' : ''}`} onClick={() => setAudience('customer')}>{trD('pc.audCustomer')}</button>
              <button type="button" className={`cat-chip ${internal ? 'on' : ''}`} onClick={() => setAudience('internal')}>{trD('pc.audInternal')}</button>
            </div>
            {!isNota && (<>
              <label className="fld-label">{trD('pc.period')}</label>
              <div className="cat-chips">{periodOpts.map(([k, l]) => <button key={k} type="button" className={`cat-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
              {period === 'range' && (
                <div className="dist-form-row" style={{ marginTop: 10 }}>
                  <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.from')}</label><DP.DateField value={from} onChange={setFrom} max={to || today} /></div>
                  <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.to')}</label><DP.DateField value={to} onChange={setTo} min={from || undefined} max={today} /></div>
                </div>
              )}
              <label className="pc-check"><input type="checkbox" checked={incArchive} onChange={(e) => setIncArchive(e.target.checked)} /><span>{trD('pc.incArchive')}</span></label>
              <label className="pc-check"><input type="checkbox" checked={incAdj} onChange={(e) => setIncAdj(e.target.checked)} /><span>{trD('pc.incAdj')}</span></label>
            </>)}
            <label className="fld-label">{trD('pc.format')}</label>
            <div className="cat-chips">{fmtOpts.map(([k, l]) => <button key={k} type="button" className={`cat-chip ${format === k ? 'on' : ''}`} onClick={() => setFormat(k)}>{l}</button>)}</div>
            <label className="fld-label">{trD('pc.output')}</label>
            <div className="cat-chips">{outOpts.map(([k, l]) => <button key={k} type="button" className={`cat-chip ${output === k ? 'on' : ''}`} onClick={() => setOutput(k)}>{l}</button>)}</div>
          </div>
          <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" onClick={commit}>{output === 'wa' ? trD('pc.outWa') : trD('pc.preview')}</button></div>
        </div>
      </div>
    );
  }

  // ── PREVIEW / DOCUMENT STEP ── (readable A4 document; two audiences share one engine)
  const periodPlain = isNota ? '' : (pb ? (fmtDateShort(pb.from) + ' – ' + fmtDateShort(pb.to)) : trD('dist.periodAll'));
  const colCount = isNota ? 6 : (internal ? 7 : 6);
  const docRow = (t) => {
    const dOut = internal && disputeDeducts(t);
    const dm = internal && t.dispute ? DISPUTE_META[t.dispute.status] : null;
    return (
      <tr key={t.id} className={(t.voided ? 'pc-voidrow' : '') + (dOut ? ' pc-disprow' : '')}>
        <td className="tnum">{fmtDateShort(t.txnDate)}</td>
        {(internal && !isNota) || isNota ? <td className="tnum pc-code">{txnCode(t)}</td> : null}
        <td className="pc-ket">
          {internal ? methodLabel(t.method) : ketOf(t)}
          {internal && t.legacy ? <span className="pc-tag arsip">{trD('pc.tagArsip')}</span> : null}
          {internal && t.openingBon ? <span className="pc-tag">{trD('dist.obLabel')}</span> : null}
          {internal && t.voided ? <span className="pc-tag batal">{trD('pc.tagBatal')}</span> : null}
          {dm ? <span className={'pc-tag ' + (t.dispute.status === 'kerugian' || t.dispute.status === 'tidak_diakui' ? 'batal' : t.dispute.status === 'diakui_kembali' ? 'pnys' : 'arsip')}>{trD(dm.label)}</span> : null}
          {internal && t.note ? <span className="pc-note"> · {t.note}</span> : null}
        </td>
        <td className="r tnum">{t.method === 'pelunasan' ? '—' : numX(t.qty)}</td>
        <td className="r tnum">{t.method === 'pelunasan' ? '—' : rpFull(t.unitPriceLocked)}</td>
        <td className="r tnum">{dOut ? <><s>{rpFull(effOf(t))}</s> → {rpFull(t.dispute.customerClaimAmount || 0)}</> : rpFull(effOf(t))}</td>
        {!isNota && <td className="r tnum">{rpFull(Math.max(0, runMap[t.id] || 0))}</td>}
      </tr>
    );
  };
  return (
    <div className="modal-scrim invoice-overlay pc-overlay" onClick={onClose} style={{ zIndex: 240 }}>
      <div className={'invoice-sheet pc-sheet pc-doc pc-' + format + (internal ? ' pc-internal' : ' pc-customer')} data-sisa-akhir={sisaAkhir} data-audience={audience} onClick={(e) => e.stopPropagation()}>
        <div className="pc-toolbar no-print">
          <button className="btn btn-ghost" onClick={() => setStep('opt')}><IconCaret s={15} style={{ transform: 'rotate(90deg)' }} />{trD('pc.back')}</button>
          <span className="pc-audlabel">{internal ? trD('pc.audInternal') : trD('pc.audCustomer')}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={doPrint}><IconDownload s={16} />{output === 'pdf' ? trD('pc.outPdf') : trD('dist.print')}</button>
          {customer.phone ? <button className="btn btn-ghost" onClick={share}><IconWhatsApp s={16} />WhatsApp</button> : null}
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        {/* HEADER */}
        <div className="pc-dochead">
          <div className="pc-biz"><Logo s={38} /><div><div className="pc-bizname">{BIZ_NAME}</div><div className="pc-bizsub">{BIZ_SUB}</div></div></div>
          <div className="pc-doctitle">{isNota ? trD('pc.docNota') : trD('pc.docStatement')}</div>
        </div>
        {/* CUSTOMER + META */}
        <div className="pc-docmeta">
          <div className="pc-custblock">
            <div className="pc-custname">{customer.name}</div>
            <div className="pc-custsub">{[customer.code, customer.phone].filter(Boolean).join(' · ') || '—'}</div>
            {internal && customer.address ? <div className="pc-custsub">{customer.address}</div> : null}
          </div>
          <div className="pc-metaright">
            <div><span>{trD('pc.docNoLbl')}:</span> <b>{docNo}</b></div>
            <div><span>{trD('pc.printDate')}:</span> <b>{fmtDateShort(stamp)}</b></div>
            {!isNota ? <div><span>{trD('dist.period')}:</span> <b>{periodPlain}</b></div> : (txn ? <div><span>{trD('pc.colCode')}:</span> <b>{txnCode(txn)}</b></div> : null)}
          </div>
        </div>
        {/* TABLE */}
        <table className="pc-table pc-doctable">
          <thead><tr>
            <th>{trD('pc.colDate')}</th>
            {(internal && !isNota) || isNota ? <th>{trD('pc.colCode')}</th> : null}
            <th>{internal ? trD('pc.colType') : trD('pc.colKet')}</th>
            <th className="r">{trD('pc.colGalon')}</th><th className="r">{trD('pc.colUnit')}</th><th className="r">{trD('pc.colAmount')}</th>
            {!isNota && <th className="r">{trD('pc.colRunning')}</th>}
          </tr></thead>
          {docRows.length === 0
            ? <tbody><tr><td colSpan={colCount} style={{ textAlign: 'center', padding: 18 }}>{trD('dist.noTxn')}</td></tr></tbody>
            : isNota
              ? <tbody>{docRows.map((t) => docRow(t))}</tbody>
              : monthOrder.map((mk) => (
                <tbody key={mk} className="pc-monthgrp">
                  <tr className="pc-month-head"><td colSpan={colCount}>{fmtMonthYear(mk)}</td></tr>
                  {monthMap[mk].rows.map((t) => docRow(t))}
                  <tr className="pc-month-sub"><td colSpan={colCount - 3} className="r">{trD('pc.monthSubtotal')}</td><td className="r tnum">{numX(monthMap[mk].galon)}</td><td /><td className="r tnum">{rpFull(monthMap[mk].jumlah)}</td>{!isNota ? <td /> : null}</tr>
                </tbody>
              ))}
        </table>
        {/* INTERNAL only: detailed adjustments table with reason codes. */}
        {internal && !isNota && incAdj && approvedAdj.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="pc-sectitle">{trD('adj.tableTitle')}</div>
            <table className="pc-table pc-doctable"><thead><tr><th>{trD('adj.colDate')}</th><th>{trD('adj.colKind')}</th><th className="r">{trD('adj.colChange')}</th><th>{trD('adj.colReason')}</th></tr></thead>
              <tbody>{approvedAdj.map((a) => (
                <tr key={a.id}><td>{fmtDateShort(a.createdAt)}</td><td>{a.kind === 'bon' ? trD('adj.kindBon') : trD('adj.kindGalon')}{a.reversalOf ? ' · ' + trD('adj.reversalBadge') : ''}</td><td className="r tnum">{(a.kind === 'bon' ? rpFull(a.before) : numX(a.before))} → {(a.kind === 'bon' ? rpFull(a.after) : numX(a.after))}</td><td>{adjReasonLabel(a.reason)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {isNota && txn && txn.method === 'bon' && (
          <div className="pc-notasisa"><span>{trD('pc.notaSisaAfter')}</span><b className="tnum">{rpFull(Math.max(0, runMap[txn.id] || 0))}</b></div>
        )}
        {/* TOTALS BOX — right-aligned, boxed, clear hierarchy, SISA BON largest. */}
        <div className="pc-totalbox">
          <div className="pc-total-row"><span>{trD('dist.totalGalon')}</span><b className="tnum">{numX(galon)}</b></div>
          <div className="pc-total-row"><span>{trD('pc.totPembelian')}</span><b className="tnum">{rpFull(pembelian)}</b></div>
          <div className="pc-total-row"><span>{trD('pc.totPembayaran')}</span><b className="tnum">{rpFull(pembayaran)}</b></div>
          {!isNota && <div className="pc-total-row"><span>{trD('pc.totPenyesuaian')}</span><b className="tnum">{rpFull(adjBonTotal)}</b></div>}
          {internal && !isNota && disputedTotal > 0 && <div className="pc-total-row"><span>{trD('disp.totLine')}</span><b className="tnum">{rpFull(disputedTotal)}</b></div>}
          <div className="pc-total-row pc-sisa"><span>{trD('pc.sisaAkhir')}</span><b className="tnum" data-testid="pc-sisa">{rpFull(sisaAkhir)}</b></div>
        </div>
        {/* FOOTER — payment method, signatures; printed-by only in the internal version. */}
        <div className="pc-docfoot">
          <div className="pc-payinfo"><b>{trD('pc.payLbl')}:</b> {trD('pc.payInfo')}</div>
          <div className="pc-sign">
            <div><div className="pc-sign-line" />{trD('pc.signCust')}</div>
            <div><div className="pc-sign-line" />{trD('pc.signStaff')}</div>
          </div>
          {internal && <div className="pc-printedby">{trD('dist.printedBy', { u: userName || '—', t: stamp + ' ' + stampTime })} · {trD('dist.txnCount', { n: docRows.length })}</div>}
        </div>
      </div>
    </div>
  );
}

// Two-option customer removal modal. Option (a) Nonaktifkan is the safe default (history
// kept, reversible); option (b) Hapus permanen is destructive and requires a firm confirm —
// the checkbox always, plus typing the exact name when the customer carries transactions or
// sisa bon (so an accidental wipe of real data can't happen with one click).
function DeleteCustomerModal({ customer, busy, onDeactivate, onDelete, onClose }) {
  const [mode, setMode] = uSx('deactivate');       // 'deactivate' (default, highlighted) | 'delete'
  const [understand, setUnderstand] = uSx(false);
  const [typed, setTyped] = uSx('');
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const txnCount = customer.txnCount || 0;
  const sisaBon = customer.sisaBon || 0;
  const hasHistory = txnCount > 0 || sisaBon > 0;
  const nameOk = typed.trim().toLowerCase() === String(customer.name || '').trim().toLowerCase();
  const canDeleteNow = mode === 'delete' && understand && (!hasHistory || nameOk);
  const primary = () => { if (busy) return; if (mode === 'deactivate') onDeactivate(); else if (canDeleteNow) onDelete(); };
  const opt = (key, title, desc, cls) => (
    <button type="button" className={`dist-del-opt ${cls} ${mode === key ? 'on' : ''}`} onClick={() => setMode(key)}>
      <span className="dist-del-radio">{mode === key ? <IconCheck s={13} /> : null}</span>
      <span className="dist-del-opt-body"><span className="dist-del-opt-title">{title}{key === 'deactivate' && <span className="dist-del-safe">{trD('dist.delSafer')}</span>}</span><span className="dist-del-opt-desc">{desc}</span></span>
    </button>
  );
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 260 }}>
      <div className="modal-card dist-del-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.delTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.delSubtitle', { name: customer.name })}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {opt('deactivate', trD('dist.delOptDeactivate'), trD('dist.delOptDeactivateDesc'), 'safe')}
          {opt('delete', trD('dist.delOptDelete'), trD('dist.delOptDeleteDesc'), 'danger')}
          {mode === 'delete' && (
            <div className="dist-del-confirm">
              {hasHistory && <div className="dist-del-warn"><IconWarn s={16} />{trD('dist.delWarnHistory', { n: txnCount, rp: rpFull(sisaBon) })}</div>}
              <label className="dist-del-check"><input type="checkbox" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} /><span>{trD('dist.delUnderstand')}</span></label>
              {hasHistory && (
                <div className="dist-del-typebox">
                  <div className="dist-del-typelbl">{trD('dist.delTypeName')}</div>
                  <input className="fld" value={typed} placeholder={customer.name} onChange={(e) => setTyped(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          {mode === 'deactivate'
            ? <button className="btn btn-primary" disabled={busy} onClick={primary}>{busy ? '…' : trD('dist.delConfirmDeactivate')}</button>
            : <button className="btn dist-btn-danger" disabled={busy || !canDeleteNow} onClick={primary}>{busy ? '…' : trD('dist.delConfirmDelete')}</button>}
        </div>
      </div>
    </div>
  );
}

// ════════════════ PELANGGAN (list + detail + add + import) ════════════════
// `fleet` is the SINGLE app-wide armada source (shell state ← /settings airro_fleet,
// the same list managed in Setoran → Kelola Armada). Distribusi never keeps its own
// copy — changing a plate there is reflected here immediately.
// Per-customer LEGACY (archive) transaction import. Paste OR upload (.csv/.xlsx/.xls). Columns:
// Tanggal · Jumlah galon · Harga · Metode(lunas|bon) · Catatan. No customer column — the server
// takes the customerId from the route. Live preview (Ready/Missing/Invalid date/Duplicate); imports
// valid rows only; dedupes vs this customer's existing rows + within the file.
function LegacyImportModal({ customer, onClose, onDone }) {
  const [text, setText] = uSx('');
  const [fileRows, setFileRows] = uSx(null);
  const [fileName, setFileName] = uSx('');
  const [fileBusy, setFileBusy] = uSx(false);
  const [err, setErr] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [filter, setFilter] = uSx('all');   // all | ok | skip
  const [includeBon, setIncludeBon] = uSx(true);   // count imported bon/pelunasan toward sisa bon?
  const [fileDebug, setFileDebug] = uSx(null);   // FIX 0: parse diagnostics from the last XLSX read
  const [showDebug, setShowDebug] = uSx(false);
  const fileRef = React.useRef(null);
  // dedupe against existing rows keyed on (date + TYPE + amount) — matches the server
  const existing = new Set((customer.transactions || []).map((t) => `${t.txnDate}|${t.method}|${t.amount}`));
  const rawCells = fileRows || text.split('\n').map((l) => l.trim()).filter(Boolean).map(splitCells);
  // FIX 2 — locate the header row (order-independent, tolerant of title rows) or fall back to fixed order.
  const { colMap, headerRow, headerUnknown } = detectLegacyColumns(rawCells);
  const dataRows = headerRow >= 0 ? rawCells.slice(headerRow + 1) : rawCells;
  const cellAt = (row, i) => (i >= 0 && row && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : '');
  const seen = new Set();
  // One spreadsheet row EXPANDS into 1–3 transactions, each its own preview item. Dedupe/ceiling are
  // applied PER TRANSACTION (date+type+amount) so a same-date lunas & bon are never dups of each other.
  const rows = dataRows.filter((r) => r && r.some((c) => String(c || '').trim()))
    .flatMap((cols) => expandLegacyImportRow(cols, colMap, cellAt))
    .map((d) => {
      let status = d.status;
      if (status === 'ok' && d.amount > MAX_ROW_AMOUNT) status = 'toobig';
      if (status === 'ok') {
        const k = `${d.date}|${d.type}|${d.amount}`;
        if (existing.has(k) || seen.has(k)) status = 'dup'; else seen.add(k);
      }
      return { ...d, status, valid: status === 'ok' };
    });
  const valid = rows.filter((r) => r.valid);
  const skipped = rows.filter((r) => !r.valid);
  const shown = filter === 'ok' ? valid : filter === 'skip' ? skipped : rows;
  const reset = () => { setText(''); setFileRows(null); setFileName(''); setErr(''); setFilter('all'); setFileDebug(null); setShowDebug(false); if (fileRef.current) fileRef.current.value = ''; };
  const typeLbl = (t) => t === 'bon' ? trD('dist.bon') : t === 'pelunasan' ? trD('dist.pelunasan') : trD('dist.lunas');
  // A bad-date chip shows the RAW cell text so the user sees exactly what was read (Tanggal salah: "abc").
  const reasonOf = (r) => r.status === 'baddate' ? (trD('dist.liBadDate') + (r.dateRaw ? ': "' + r.dateRaw + '"' : '')) : r.status === 'nominal' ? trD('dist.liNominal') : r.status === 'toobig' ? trD('dist.liTooBig') : r.status === 'dup' ? trD('dist.impDup') : trD('dist.impReady');
  // Download ONLY the skipped rows + their RAW cell value + reason, so the user fixes them and re-imports.
  const downloadSkipped = () => {
    const head = ['Tanggal', 'Harga', 'Pembelian Lunas', 'Pembelian Bon', 'Pembayaran Bon', 'Catatan', 'Alasan'];
    const out = [head, ...skipped.map((r) => [r.dateRaw || '', r.price || '', r.type === 'lunas' ? r.qty : '', r.type === 'bon' ? r.qty : '', r.type === 'pelunasan' ? r.amount : '', r.note || '', reasonOf(r)])];
    const csv = out.map((row) => row.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'riwayat-dilewati.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    setErr(''); setFileBusy(true); setFileName(file.name); setText('');
    const isXlsx = /\.xlsx?$/i.test(file.name) || /sheet|excel/i.test(file.type);
    if (isXlsx) {
      loadSheetJS().then((XLSX) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            // ROOT-CAUSE FIX: read the RAW underlying values (raw:true), NOT the localised display text.
            // With raw:false SheetJS returns each date cell's own format — its default is m/d/yy, so a
            // 15-Jan cell came back "1/15/26" and our day-first parser rejected it (month 15). With
            // cellDates:true + raw:true a date cell is a real Date object; we convert it via LOCAL
            // y/m/d parts (never toISOString — that shifts the day across a timezone). Serial numbers
            // and text dates are left for parseLegacyDate.
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true, defval: '' });
            const dcell = (c) => parseLegacyDate(c) || '';   // Date/serial → ISO (local), else ''
            const rws = aoa.map((r) => r.map((c) => (c == null ? '' : (c instanceof Date ? dcell(c) : String(c).trim()))));
            // FIX 0 — parse diagnostics for the collapsible "Detail teknis" panel + console.
            const dbg = { range: ws['!ref'] || '', sheet: wb.SheetNames[0], rows: aoa.slice(0, 4).map((r) => r.map((c) => ({ t: c instanceof Date ? 'Date' : typeof c, v: c instanceof Date ? (parseLegacyDate(c) || c.toString()) + ' (Date)' : c }))) };
            try { console.log('[legacy-import] range=%s sheet=%s', dbg.range, dbg.sheet); dbg.rows.forEach((r, i) => console.log('  row%d:', i, r.map((c) => c.t + ':' + JSON.stringify(c.v)).join(' | '))); } catch (e) {}
            setFileDebug(dbg); setFileRows(rws); setFileBusy(false);
          } catch (ex) { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); }
        };
        rd.onerror = () => { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); };
        rd.readAsArrayBuffer(file);
      }).catch(() => { setErr(trD('dist.importXlsxCdnErr')); setFileBusy(false); setFileName(''); });
    } else {
      const rd = new FileReader();
      rd.onload = () => { setFileDebug(null); setFileRows(String(rd.result || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitCells)); setFileBusy(false); };
      rd.onerror = () => { setErr(trD('dist.importFileErr')); setFileBusy(false); setFileName(''); };
      rd.readAsText(file);
    }
  };
  const commit = () => {
    if (!valid.length || saving) return;
    setSaving(true); setErr('');
    // The preview is already EXPANDED (one item per transaction); send each item as a single-action
    // legacy row. The server re-parses the date + re-derives (authoritative) and stamps them all with
    // one importBatchId, so a row's lunas + bon + pelunasan import together and undo together.
    const payload = valid.map((r) => {
      const o = { txnDate: r.date };
      if (r.type === 'pelunasan') o.paymentAmount = r.amount;
      else { o.price = r.price; if (r.type === 'bon') o.bonQty = r.qty; else o.lunasQty = r.qty; }
      if (r.note) o.note = r.note;
      return o;
    });
    window.API.distribusi.customers.importLegacyTxns(customer.id, payload, skipped.length, includeBon)
      .then((res) => { setSaving(false); onDone(res); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="modal-card" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.liTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.code ? customer.code + ' · ' : ''}{customer.name}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.liInfo')}</span></div>
          <div className="dist-imp-fmt"><span>{trD('dist.importFmt')}: <b>Tanggal · Harga · Pembelian Lunas · Pembelian Bon · Pembayaran Bon · Catatan</b> <span style={{ color: 'var(--text-faint)' }}>· {trD('dist.liDateAny')}</span></span><button type="button" className="dist-link" onClick={downloadLegacyTemplate}><IconDownload s={13} />{trD('dist.importTemplate')}</button></div>
          <label className="dist-arch-bon"><input type="checkbox" checked={includeBon} onChange={(e) => setIncludeBon(e.target.checked)} /><span><b>{trD('dist.liIncludeBon')}</b><small>{trD('dist.liIncludeBonHint')}</small></span></label>
          <div className="dist-imp-upload">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} onChange={onFile} />
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current && fileRef.current.click()}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.importUpload')}</button>
            {fileBusy ? <span className="dist-imp-fname"><span className="ui-attach-spin" />{trD('dist.importReading')}</span>
              : fileRows ? <span className="dist-imp-fname"><IconCheck s={13} />{fileName}<button type="button" className="dist-link" onClick={reset} style={{ marginLeft: 8 }}>{trD('dist.importClear')}</button></span>
              : <span className="dist-imp-or">{trD('dist.importOr')}</span>}
          </div>
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={13} />{err}</div>}
          {rawCells.length > 0 && headerUnknown && <div className="dist-hint" style={{ marginTop: 8, color: 'var(--warn)' }}><IconInvoice s={13} /> {trD('dist.liHeaderUnknown')}</div>}
          {/* FIX 0 — collapsible "Detail teknis": exactly what the reader saw (range, header row +
              mapping, and the first rows' raw value + type) so a bad file is diagnosable in the field. */}
          {fileDebug && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <button type="button" className="dist-link" onClick={() => setShowDebug((v) => !v)}>{showDebug ? '▾' : '▸'} {trD('dist.liDebug')}</button>
              {showDebug && (
                <div style={{ marginTop: 6, padding: 8, background: 'var(--surface-2, #f5f7f8)', borderRadius: 8, fontFamily: 'monospace', fontSize: 11.5, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
                  {'range=' + fileDebug.range + '  sheet=' + fileDebug.sheet + '\n'}
                  {'header row=' + (headerRow >= 0 ? '#' + (headerRow + 1) : 'tidak dikenali (urutan tetap)') + '\n'}
                  {'kolom → date[' + colMap.date + '] harga[' + colMap.price + '] lunas[' + colMap.lunas + '] bon[' + colMap.bon + '] bayar[' + colMap.pay + '] catatan[' + colMap.note + ']\n'}
                  {fileDebug.rows.map((r, i) => 'row' + i + ': ' + r.map((c) => c.t + ':' + JSON.stringify(c.v)).join('  |  ')).join('\n')}
                </div>
              )}
            </div>
          )}
          {!fileRows && !fileBusy && <textarea className="fld dist-imp-ta" value={text} placeholder={'15/01/2026\t12000\t10\t\t\tlunas\n16/01/2026\t13000\t2\t3\t\tlunas + bon\n20/01/2026\t\t\t\t30000\tbayar bon'} onChange={(e) => setText(e.target.value)} />}
          {rows.length > 0 && (<>
            {/* Status filter chips + "Unduh yang dilewati" so the user fixes skips and re-imports. */}
            <div className="dist-imp-chips">
              {[['all', trD('dist.impAll'), rows.length], ['ok', trD('dist.importReady'), valid.length], ['skip', trD('dist.importSkip'), skipped.length]]
                .map(([k, label, n]) => <button key={k} type="button" className={`dist-imp-chip ${filter === k ? 'on' : ''} ${k === 'skip' ? 'skip' : ''}`} onClick={() => setFilter(k)}>{label} <span className="dist-imp-chipn">{n}</span></button>)}
              {skipped.length > 0 && <button type="button" className="dist-link dist-imp-dl" onClick={downloadSkipped}><IconDownload s={13} />{trD('dist.impDownloadSkip')}</button>}
            </div>
            <div className="dist-imp-preview">
              <div className="dist-imp-hrow li3"><span>Tanggal</span><span>{trD('dist.liType')}</span><span>{trD('dist.liAmount')}</span><span>Status</span></div>
              {shown.slice(0, 400).map((r, i) => (
                <div key={i} className={`dist-imp-row li3 ${r.valid ? '' : 'is-skip'}`}>
                  <span className="dist-imp-name">{r.date || r.dateRaw || '—'}</span>
                  <span>{r.type ? <span className={`dist-badge ${r.type === 'bon' ? 'bon' : r.type === 'pelunasan' ? 'obon' : 'lunas'}`}>{typeLbl(r.type)}</span> : '—'}</span>
                  <span className="tnum">{r.amount ? rpFull(r.amount) : '—'}</span>
                  <span><span className={`dist-imp-status ${r.status}`}>{reasonOf(r)}</span></span>
                </div>
              ))}
              {shown.length > 400 && <div className="dist-hint" style={{ padding: '6px 10px' }}>… +{shown.length - 400}</div>}
              {shown.length === 0 && <div className="dist-hint" style={{ padding: '10px' }}>{trD('dist.impNoneInFilter')}</div>}
            </div>
          </>)}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!valid.length || saving} onClick={commit}>{saving ? '…' : trD('dist.liImport', { n: valid.length })}</button></div>
      </div>
    </div>
  );
}

// ── BON AWAL / MANUAL ────────────────────────────────────────────────────────
// Record a customer's PRIOR outstanding receivable (carried over from the old books).
// It is saved as a REAL bon dated on the day the admin picks, so it counts toward sisa
// bon from that date and a later pelunasan reduces it. Deliberately NOT the legacy/archive
// flag, which is excluded from every aggregate.
function OpeningBonModal({ customer, onClose, onSaved }) {
  const [amount, setAmount] = uSx('');
  const [date, setDate] = uSx((window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10));
  const [note, setNote] = uSx('');
  const [busy, setBusy] = uSx(false);
  const [err, setErr] = uSx('');
  const [confirming, setConfirming] = uSx(false);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const amt = parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
  const valid = amt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && note.trim();
  const save = () => {
    if (!valid || busy) return;
    setBusy(true); setErr('');
    window.API.distribusi.customers.openingBon(customer.id, { amount: amt, txnDate: date, note: note.trim() })
      .then((r) => { setBusy(false); onSaved(r.data); })
      .catch((e) => { setBusy(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.obTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name}</div></div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.obInfo')}</span></div>
          {/* Double-count guard: warn (never block) if this customer already carries a bon. */}
          {(customer.sisaBon || 0) > 0 && (
            <div className="dist-warnbox"><IconWarn s={16} /><span>{trD('dist.obDupWarn', { amt: rpFull(customer.sisaBon) })}</span></div>
          )}
          <label className="fld-label">{trD('dist.obAmount')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld tnum" inputMode="numeric" value={amount} placeholder="cth. 500000" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} />
          <label className="fld-label">{trD('dist.obDate')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="gud-hint">{trD('dist.obDateHint')}</div>
          <label className="fld-label">{trD('dist.obNote')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" value={note} placeholder={trD('dist.obNotePh')} onChange={(e) => setNote(e.target.value)} />
          {amt > WARN_AMOUNT && <div className="dist-amt-warn" style={{ marginTop: 10 }}><IconInvoice s={14} />{trD('dist.amtWarn', { amt: rpFull(amt) })}</div>}
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
          {confirming && <div className="dist-warnbox" style={{ marginTop: 10 }}><IconWarn s={16} /><span>{trD('dist.obConfirm', { amt: rpFull(amt), date })}</span></div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          {!confirming
            ? <button className="btn btn-primary" disabled={!valid} onClick={() => setConfirming(true)}>{trD('dist.obNext')}</button>
            : <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '…' : trD('dist.obSave')}</button>}
        </div>
      </div>
    </div>
  );
}

// The six adjustment reasons (server enum) — note required for lainnya / penghapusan_piutang.
const ADJ_REASONS = ['rekonsiliasi_fisik', 'salah_input', 'galon_pecah_hilang', 'penghapusan_piutang', 'selisih_staf', 'lainnya'];
const adjReasonLabel = (r) => trD('adj.reason.' + r) || r;
// PENYESUAIAN (balance adjustment) — corrects the CURRENT gallons-held or outstanding bon. It affects
// receivables/stock, so it's created as a PENDING record that a GM/owner must approve. before → after
// is shown and confirmed before submit; reason + optional note/evidence are captured for the audit.
// Mark a transaction disputed → Tidak Diakui / Kerugian. The transaction is NEVER changed; this only
// raises a dispute record (server-side). Shows the system nominal, the customer-acknowledged amount,
// the auto selisih, the settlement choice, and a before→after preview of the customer's Sisa Bon.
function DisputeModal({ txn, customer, onClose, onSubmit }) {
  const sys = Math.max(0, Math.round(txn.amount || 0));
  const [claimN, setClaimN] = uSx(0);                 // acknowledged amount as a NUMBER (Rupiah-formatted on screen)
  const [reason, setReason] = uSx('');                // '' = "— pilih —" (Alasan is OPTIONAL)
  const [resolution, setResolution] = uSx('staf');
  const [note, setNote] = uSx('');
  const [evidence, setEvidence] = uSx('');
  const [staffName, setStaffName] = uSx(txn.actorName || '');
  const [busy, setBusy] = uSx(false);
  const [errors, setErrors] = uSx({});                // { field: message } — inline field errors
  const [banner, setBanner] = uSx('');                // top summary / API error
  const noteRef = React.useRef(null), claimRef = React.useRef(null), eviRef = React.useRef(null);
  React.useEffect(() => { const o = (e) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [busy]);
  const selisih = Math.max(0, sys - claimN);
  const before = customer.sisaBon || 0;
  const after = resolution === 'investigasi' ? before : Math.max(0, before - selisih);
  const staffEdited = (staffName || '').trim() !== (txn.actorName || '');
  const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; } };
  const needsSelisih = resolution === 'staf' || resolution === 'perusahaan';
  const noteMissing = !note.trim();
  // Validate → { errors, firstRef }. selisih>0 is required ONLY for staf/perusahaan (investigasi ok at 0).
  const validate = () => {
    const er = {}; let first = null;
    if (noteMissing) { er.note = trD('disp.errNote'); first = first || noteRef; }
    if (needsSelisih && selisih <= 0) { er.claim = trD('disp.errSelisih'); first = first || claimRef; }
    const ev = evidence.trim();
    if (ev && !isUrl(ev)) { er.evidence = trD('disp.errUrl'); first = first || eviRef; }
    return { er, first };
  };
  const submit = () => {
    if (busy) return;
    const { er, first } = validate();
    setErrors(er);
    if (Object.keys(er).length) { setBanner(trD('disp.bannerFix')); if (first && first.current) first.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setBanner(''); setBusy(true);
    const body = { reason: reason || null, resolution, customerClaimAmount: claimN, note: note.trim(), evidenceUrl: evidence.trim() || undefined,
      staffUserId: staffEdited ? undefined : (txn.actorId || undefined), staffName: staffEdited ? staffName.trim() : undefined };
    Promise.resolve(onSubmit(txn.id, body)).catch((e) => {
      setBusy(false);
      setBanner((e && e.body && e.body.error && e.body.error.message) || (e && e.message) || trD('common.loadFail'));   // API error VERBATIM
    });
  };
  const setClaim = (raw) => { const n = Math.max(0, Math.min(sys, parseInt(String(raw).replace(/[^0-9]/g, ''), 10) || 0)); setClaimN(n); if (errors.claim) setErrors((p) => ({ ...p, claim: null })); };
  const RES = [['staf', trD('disp.resStaf'), trD('disp.resStafSub')], ['perusahaan', trD('disp.resPerusahaan'), trD('disp.resPerusahaanSub')], ['investigasi', trD('disp.resInvestigasi'), trD('disp.resInvestigasiSub')]];
  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()} style={{ zIndex: 220 }}>
      <div className="modal-card disp-modal" onClick={(e) => e.stopPropagation()}>
        {/* FIXED header — never scrolls. */}
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('disp.modalTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{txnCode(txn)} · {customer.name}</div></div><button className="jp-icon" onClick={() => !busy && onClose()}><IconClose s={18} /></button></div>
        {/* SCROLLING body. */}
        <div className="modal-body disp-body">
          {banner && <div className="disp-banner"><IconWarn s={15} /><span>{banner}</span></div>}
          <div className="disp-amtrow">
            <div className="disp-amtcell">
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('disp.nomSistem')}</label>
              <div className="disp-sys tnum">{rpFull(sys)} <IconLock s={12} /></div>
            </div>
            <div className="disp-amtcell" ref={claimRef}>
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('disp.nomDiakui')}</label>
              <div className={'dist-priceinput' + (errors.claim ? ' has-err' : '')}><input value={claimN ? claimN.toLocaleString('id-ID') : ''} inputMode="numeric" placeholder="0" onChange={(e) => setClaim(e.target.value)} /></div>
              <div className="disp-quickfill">
                <button type="button" onClick={() => setClaim('0')}>{trD('disp.qfNone')}</button>
                <button type="button" onClick={() => setClaim(String(sys))}>{trD('disp.qfFull')}</button>
              </div>
              <div className="fld-help">{trD('disp.nomDiakuiHelp')}</div>
              {errors.claim && <div className="fld-err"><IconWarn s={12} />{errors.claim}</div>}
            </div>
            <div className="disp-amtcell">
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('disp.selisih')}</label>
              <div className={'disp-selisih tnum ' + (selisih > 0 ? 'neg' : '')}>{rpFull(selisih)}</div>
              <div className="fld-help">{trD('disp.selisihHelp')}</div>
            </div>
          </div>
          <label className="fld-label">{trD('disp.alasanOpt')}</label>
          <select className="fld" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{trD('disp.pilih')}</option>
            {['nota_fiktif', 'galon_tidak_diterima', 'nominal_beda', 'pembayaran_tidak_disetor', 'pelanggan_menyangkal', 'lainnya'].map((r) => <option key={r} value={r}>{trD('disp.reason.' + r)}</option>)}
          </select>
          <label className="fld-label">{trD('disp.petugas')}</label>
          <input className="fld" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder={trD('disp.petugasPh')} />
          <label className="fld-label" ref={noteRef}>{trD('disp.catatan')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <textarea className={'fld' + (errors.note ? ' has-err' : '')} rows={2} value={note} onChange={(e) => { setNote(e.target.value); if (errors.note) setErrors((p) => ({ ...p, note: null })); }} placeholder={trD('disp.catatanPh')} />
          {errors.note && <div className="fld-err"><IconWarn s={12} />{errors.note}</div>}
          <label className="fld-label" ref={eviRef}>{trD('disp.buktiUrl')}</label>
          <input className={'fld' + (errors.evidence ? ' has-err' : '')} value={evidence} onChange={(e) => { setEvidence(e.target.value); if (errors.evidence) setErrors((p) => ({ ...p, evidence: null })); }} placeholder="https://…" />
          {errors.evidence && <div className="fld-err"><IconWarn s={12} />{errors.evidence}</div>}
          <label className="fld-label">{trD('disp.penyelesaian')}</label>
          <div className="disp-res">{RES.map(([k, l, s]) => (
            <button key={k} type="button" className={'disp-res-opt ' + (resolution === k ? 'on' : '')} onClick={() => { setResolution(k); if (errors.claim) setErrors((p) => ({ ...p, claim: null })); }}>
              <span className="disp-res-radio">{resolution === k ? <IconCheck s={12} /> : null}</span>
              <span className="disp-res-body"><b>{l}</b><span className="disp-res-sub">{s}</span></span>
            </button>
          ))}</div>
          <div className="disp-preview">
            <span>{trD('cd.kpiSisaBon')}</span>
            <b className="tnum">{rpFull(before)} → <span className={after < before ? 'neg' : ''}>{rpFull(after)}</span></b>
            <small>{resolution !== 'investigasi' && after < before ? trD('disp.previewApply') : trD('disp.previewInvestigasi')}</small>
          </div>
        </div>
        {/* FIXED footer — never scrolls. A disabled button always shows WHY below it (never silently dead). */}
        <div className="modal-foot disp-foot">
          {noteMissing && !busy && <div className="disp-foot-help"><IconWarn s={12} />{trD('disp.helpNote')}</div>}
          <div className="disp-foot-btns">
            <button className="btn btn-ghost" disabled={busy} onClick={() => !busy && onClose()}>{trD('dist.cancel')}</button>
            <button className="btn btn-primary" disabled={busy || noteMissing} onClick={submit}>{busy ? <><span className="dist-spin" style={{ marginRight: 7 }} />{trD('disp.processing')}</> : trD('disp.submitBtn')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdjustModal({ customer, kind, onClose, onSaved }) {
  const isBon = kind === 'bon';
  const before = isBon ? (customer.sisaBon || 0) : (customer.gallonsHeld || 0);
  const [mode, setMode] = uSx('set');
  const [target, setTarget] = uSx(String(before));
  const [delta, setDelta] = uSx('');
  const [reason, setReason] = uSx('rekonsiliasi_fisik');
  const [note, setNote] = uSx('');
  const [photo, setPhoto] = uSx(null);
  const [busy, setBusy] = uSx(false);
  const [err, setErr] = uSx('');
  const [confirming, setConfirming] = uSx(false);
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const num = (s) => { const t = String(s == null ? '' : s).trim(); const neg = /^-/.test(t); const n = parseInt(t.replace(/[^0-9]/g, ''), 10) || 0; return neg ? -n : n; };
  const after = mode === 'set' ? num(target) : before + num(delta);
  const selisih = after - before;
  const noteReq = reason === 'lainnya' || reason === 'penghapusan_piutang';
  const writeOff = isBon && reason === 'penghapusan_piutang';   // bon may be clamped to 0
  const numsOk = selisih !== 0 && (after >= 0 || writeOff);
  const valid = numsOk && (!noteReq || note.trim()) && !busy;
  const fmt = isBon ? rpFull : numX;
  const save = () => {
    if (!valid) return;
    setBusy(true); setErr('');
    const body = { kind, mode, reason };
    if (mode === 'set') body.value = num(target); else body.delta = num(delta);
    if (note.trim()) body.note = note.trim();
    if (photo && photo.ref) body.evidenceUrl = photo.ref;
    window.API.distribusi.customers.createAdjustment(customer.id, body)
      .then((r) => { setBusy(false); onSaved(r.data); })
      .catch((e) => { setBusy(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('adj.title')} · {isBon ? trD('adj.kindBon') : trD('adj.kindGalon')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name}</div></div>
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dist-warnbox"><IconWarn s={16} /><span>{trD('adj.info')}</span></div>
          <div className="dist-cd-stats" style={{ margin: '4px 0 10px' }}>
            <div><div className="dist-cd-slbl">{trD('adj.system')}</div><div className="dist-cd-sval">{fmt(before)}</div></div>
            <div><div className="dist-cd-slbl">{trD('adj.selisih')}</div><div className="dist-cd-sval" style={{ color: selisih === 0 ? 'var(--text-mut)' : selisih > 0 ? 'var(--green-700)' : 'var(--neg)' }}>{selisih >= 0 ? '+' : ''}{fmt(selisih)}</div></div>
            <div><div className="dist-cd-slbl">{trD('adj.after')}</div><div className="dist-cd-sval">{fmt(after)}</div></div>
          </div>
          <div className="gran-seg" style={{ marginBottom: 10 }}>
            <button className={`gran-btn ${mode === 'set' ? 'on' : ''}`} onClick={() => setMode('set')}>{trD('adj.modeSet')}</button>
            <button className={`gran-btn ${mode === 'delta' ? 'on' : ''}`} onClick={() => setMode('delta')}>{trD('adj.modeDelta')}</button>
          </div>
          {mode === 'set'
            ? (<><label className="fld-label">{trD('adj.newValue')}</label><input className="fld tnum" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></>)
            : (<><label className="fld-label">{trD('adj.delta')}</label><input className="fld tnum" inputMode="numeric" value={delta} placeholder="cth. -2" onChange={(e) => setDelta(e.target.value)} /></>)}
          <label className="fld-label">{trD('adj.reason')}</label>
          <UI.Dropdown value={reason} options={ADJ_REASONS.map((r) => ({ value: r, label: adjReasonLabel(r) }))} onChange={setReason} fluid />
          <label className="fld-label">{trD('adj.note')}{noteReq ? <span style={{ color: 'var(--neg)' }}> *</span> : null}</label>
          <input className="fld" value={note} placeholder={trD('adj.notePh')} onChange={(e) => setNote(e.target.value)} />
          <label className="fld-label">{trD('adj.evidence')}</label>
          <UI.FileAttach value={photo} onChange={setPhoto} camera accept="image/*" label={trD('adj.evidenceAdd')} />
          {writeOff && after === 0 && before > 0 && <div className="dist-hint" style={{ marginTop: 6 }}>{trD('adj.writeOffHint')}</div>}
          {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
          {confirming && <div className="dist-warnbox" style={{ marginTop: 10 }}><IconWarn s={16} /><span>{trD('adj.confirm', { before: fmt(before), after: fmt(after) })}</span></div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          {!confirming
            ? <button className="btn btn-primary" disabled={!valid} onClick={() => setConfirming(true)}>{trD('dist.obNext')}</button>
            : <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '…' : trD('adj.submit')}</button>}
        </div>
      </div>
    </div>
  );
}

function DistCustomers({ canCustomers, canCustImport, canPrice, canInput, canKoreksi, canDelete, canLegacyImport, canBonAdjust, canPenyesuaian, isGmOwner, staffMode, refreshKey, fleet, fleetScope, distFleet, setDistFleet, onGoHarga, onChanged, onOpenLoss, userName }) {
  const [view, setView] = uSx('list');
  const [custs, setCusts] = uSx(null);
  const clParam0 = (k, d) => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch (e) { return d; } };
  const [statusFilter, setStatusFilter] = uSx(() => clParam0('st', 'active'));   // 'active' (default) | 'inactive' — Nonaktif view (cap holders only)
  const [delFor, setDelFor] = uSx(null);                   // customer being removed → opens the 2-option DeleteCustomerModal
  const [delBusy, setDelBusy] = uSx(false);
  const [loadErr, setLoadErr] = uSx('');   // customer-list load failure → message + retry (never a silent hang)
  const [types, setTypes] = uSx([]);
  const [detail, setDetail] = uSx(null);
  const [invoices, setInvoices] = uSx([]);       // this customer's invoice history
  const [invBuilder, setInvBuilder] = uSx(false); // Buat Invoice modal
  const [invView, setInvView] = uSx(null);        // printable invoice viewer
  const [printFor, setPrintFor] = uSx(null);      // { mode:'statement'|'nota', txn?, initial? } → shared PrintCenter
  const [legacyOpen, setLegacyOpen] = uSx(false); // legacy (archive) transaction import modal
  const [payFor, setPayFor] = uSx(null);          // standalone Pelunasan Bon for this customer
  const [pnrFor, setPnrFor] = uSx(null);          // "Pelunasan tidak diterima" adjustment (cap-gated)
  const [q, setQ] = uSx(() => clParam0('q', ''));
  const [filter, setFilter] = uSx(() => clParam0('chip', 'all'));
  const [toast, setToast] = uSx('');
  const [form, setForm] = uSx(null);        // {id?, name, phone, type, price, deliveryDays[], armada} — Add/Edit modal
  const [saving, setSaving] = uSx(false);
  const [formErr, setFormErr] = uSx('');
  const [impOpen, setImpOpen] = uSx(false);
  const [impText, setImpText] = uSx('');
  const [impSaving, setImpSaving] = uSx(false);
  const [impFileRows, setImpFileRows] = uSx(null);   // 2D cells from an uploaded file (overrides the textarea)
  const [impFileName, setImpFileName] = uSx('');
  const [impFileErr, setImpFileErr] = uSx('');
  const [impFileBusy, setImpFileBusy] = uSx(false);
  const [impFilter, setImpFilter] = uSx('all');   // preview status chip: all | ok | skip | kurang | dup
  const impFileRef = React.useRef(null);
  const [typesOpen, setTypesOpen] = uSx(false);
  const [obFor, setObFor] = uSx(null);   // customer whose opening/carry-over bon is being entered
  const [adjustFor, setAdjustFor] = uSx(null);   // { customer, kind } — balance adjustment modal
  const [disputeFor, setDisputeFor] = uSx(null); // { txn } — transaction dispute / loss modal
  const [cdDispute, setCdDispute] = uSx('all');  // transaksi-tab dispute filter: all | disengketakan | lossed
  // ── Customer-detail redesign (presentation-only) state ──
  const [cdTab, setCdTabState] = uSx(() => { try { return new URLSearchParams(window.location.search).get('tab') || 'ringkasan'; } catch (e) { return 'ringkasan'; } });
  const setCdTab = (t) => { setCdTabState(t); try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u); } catch (e) {} };
  const [cdSearch, setCdSearch] = uSx('');
  const [cdPeriod, setCdPeriod] = uSx('all');        // all | 30 | month | lastMonth | year | range
  const [cdFrom, setCdFrom] = uSx(''); const [cdTo, setCdTo] = uSx('');
  const [cdType, setCdType] = uSx('all');            // all | lunas | bon | pelunasan
  const [cdArchive, setCdArchive] = uSx(true);       // show archive rows in the list (never affects KPIs)
  const [cdExpanded, setCdExpanded] = uSx(null);     // expanded transaction id
  const [cdMenu, setCdMenu] = uSx(false);            // overflow "⋯" menu
  // Approve / reverse an adjustment (GM/owner). Both re-open the detail so balances refresh.
  const approveAdjustment = (adjId) => window.API.distribusi.customers.approveAdjustment(adjId)
    .then(() => { flash(trD('adj.approved')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
    .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  const reverseAdjustment = (adjId) => { if (!window.confirm(trD('adj.reverseConfirm'))) return; window.API.distribusi.customers.reverseAdjustment(adjId)
    .then(() => { flash(trD('adj.reversed')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
    .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail'))); };
  // ── Transaction DISPUTES (raise / approve / reverse). Approve+reverse are GM/owner; all re-open the
  // detail so sisa bon + badges refresh. `raiseDispute` is submitted by the DisputeModal below. ──
  // On success the modal closes (setDisputeFor(null)); on error we RETHROW so the modal shows the
  // API message verbatim in its banner and stays open with the input preserved (no silent swallow).
  const submitDispute = (txnId, body) => window.API.distribusi.customers.raiseDispute(txnId, body)
    .then(() => { setDisputeFor(null); flash(trD('disp.raised')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
    .catch((e) => { throw e; });
  const approveDispute = (dId) => window.API.distribusi.customers.approveDispute(dId)
    .then(() => { flash(trD('disp.approved')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
    .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  const reverseDispute = (dId) => { if (!window.confirm(trD('disp.reverseConfirm'))) return; window.API.distribusi.customers.reverseDispute(dId)
    .then(() => { flash(trD('disp.reversed')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
    .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail'))); };
  // ── Detailed filter (server-side, AND logic). EMPTY_FILTER is the "nothing selected"
  // baseline; `fTotal` is the denominator for "Menampilkan X dari Y".
  const [flt, setFlt] = uSx(EMPTY_FILTER);
  const [fltOpen, setFltOpen] = uSx(false);
  const [fTotal, setFTotal] = uSx(null);

  // ── Customer-LIST redesign (presentation-only) state ── sort/view/search/chip/status are mirrored
  // into the URL so a detail round-trip + browser Back restores the exact same list; `clScroll`
  // captures the .content scrollTop before a detail open and re-applies it on return.
  const [clSort, setClSort] = uSx(() => clParam0('sort', 'nama'));   // nama | bon | last | spend
  const [clView, setClView] = uSx(() => clParam0('cv', 'table'));    // table | kartu
  const [clVisible, setClVisible] = uSx(60);                          // infinite-scroll window (rows rendered)
  const [isNarrow, setIsNarrow] = uSx(() => { try { return window.matchMedia('(max-width: 720px)').matches; } catch (e) { return false; } });
  const clScroll = React.useRef(0);
  const clSentinel = React.useRef(null);
  // Narrow viewports always get cards (regardless of the table/kartu toggle) so 375px never scrolls sideways.
  uEx(() => {
    let mq; try { mq = window.matchMedia('(max-width: 720px)'); } catch (e) { return; }
    const on = () => setIsNarrow(mq.matches); on();
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);
  // Keep the URL in step with every list control (replaceState — no history spam).
  uEx(() => {
    try {
      const u = new URL(window.location.href);
      const setp = (k, v, dflt) => { if (v && v !== dflt) u.searchParams.set(k, v); else u.searchParams.delete(k); };
      setp('q', q, ''); setp('chip', filter, 'all'); setp('sort', clSort, 'nama'); setp('cv', clView, 'table'); setp('st', statusFilter, 'active');
      window.history.replaceState(null, '', u);
    } catch (e) {}
  }, [q, filter, clSort, clView, statusFilter]);
  // A changed filter/sort resets the render window; view changes (detail round-trip) do NOT, so the
  // same number of rows is re-rendered and the saved scrollTop lands on the same customer.
  uEx(() => { setClVisible(60); }, [q, filter, clSort, statusFilter, flt]);
  // Infinite scroll: reveal 60 more rows whenever the sentinel nears the bottom of .content.
  uEx(() => {
    const el = clSentinel.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const root = document.querySelector('.content') || null;
    const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) setClVisible((n) => n + 60); }, { root, rootMargin: '600px' });
    io.observe(el); return () => io.disconnect();
  }, [view, clView, custs]);
  // Restore the list's scroll position when returning from a customer detail.
  uEx(() => {
    if (view !== 'list' || !clScroll.current) return;
    const c = document.querySelector('.content'); if (!c) return;
    const y = clScroll.current;
    requestAnimationFrame(() => { c.scrollTop = y; requestAnimationFrame(() => { c.scrollTop = y; }); });
  }, [view]);
  // Open a customer's detail, first remembering where the list was scrolled to.
  const openDetailKeepScroll = (id) => { try { const c = document.querySelector('.content'); clScroll.current = c ? c.scrollTop : 0; } catch (e) {} openDetail(id); };
  // Export the CURRENT filter (all matching rows, not just the rendered window) to CSV.
  const exportCustCsv = () => {
    const head = [trD('cl.colCode'), trD('cl.colName'), trD('cl.colPhone'), trD('cl.colType'), trD('cl.colArmada'), trD('cl.colDays'), trD('cl.colBon'), trD('cl.colGalon'), trD('cl.colLast'), trD('cl.colSpend')];
    const body = clFiltered.map((c) => [c.code || '', c.name || '', c.phone || '', typeLabelOf(c.type), c.armada || '', fmtDays(c.deliveryDays) || '', c.sisaBon || 0, c.gallonsHeld || 0, c.lastDate || '', c.spend || 0]);
    const csv = [head, ...body].map((row) => row.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pelanggan.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const ef = effFleet(fleetScope, distFleet);
  // Load the customer list. Never hangs: a stalled request is bounded by a 20s timeout, and any
  // failure surfaces as an error message + "coba lagi" (retry) instead of a perpetual spinner or a
  // misleading empty-state. On retry we reset to the loading state so the spinner reappears.
  const reload = () => {
    if (!(window.API && window.API.distribusi)) return Promise.resolve();
    setLoadErr('');   // keep any current list visible while refreshing; only retry() resets to the spinner
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000));
    // Only cap holders may view the Nonaktif list; everyone else is forced to 'active'.
    const st = (canDelete && statusFilter === 'inactive') ? 'inactive' : 'active';
    // The detailed criteria go to the SERVER so filtering runs against the whole dataset
    // (not just the rows already loaded), and the response carries the total for the count.
    return Promise.race([window.API.distribusi.customers.list(ef, st, { ...flt, q }), timeout])
      .then((r) => { setCusts(r.data || []); setFTotal(r.total != null ? r.total : null); setLoadErr(''); })
      .catch((e) => { setLoadErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  const retry = () => { setCusts(null); setLoadErr(''); reload(); };
  const reloadTypes = () => window.API.distribusi.types.list().then((r) => setTypes(r.data || [])).catch(() => {});
  uEx(() => {
    // window.API may attach a tick after this component mounts (async script/JSX compile); poll briefly
    // instead of bailing forever, and fall to an error (not an endless spinner) if it never arrives.
    let cancelled = false;
    const tryLoad = (n) => {
      if (cancelled) return;
      if (window.API && window.API.distribusi) { reload(); reloadTypes(); return; }
      if (n <= 0) { setLoadErr(trD('common.loadFail')); return; }
      setTimeout(() => tryLoad(n - 1), 150);
    };
    tryLoad(40);   // ~6s grace for the API to become ready
    return () => { cancelled = true; };
  }, [refreshKey, ef, statusFilter]);
  // Search text + detailed filter re-query the SERVER, debounced so typing doesn't fire a
  // request per keystroke. Skips the first run — the mount effect above already loaded.
  const fltMounted = React.useRef(false);
  uEx(() => {
    if (!fltMounted.current) { fltMounted.current = true; return; }
    const t = setTimeout(() => { if (window.API && window.API.distribusi) reload(); }, 300);
    return () => clearTimeout(t);
  }, [q, flt]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  // Match an imported armada string to the fleet dictionary, case-insensitive; unknown/empty → ''.
  const armadaMatch = (raw) => { const v = String(raw == null ? '' : raw).trim(); if (!v) return ''; return fleetList.find((f) => String(f).trim().toLowerCase() === v.toLowerCase()) || ''; };

  const typeMap = {}; types.forEach((t) => { typeMap[t.id] = t; });
  const typeLabelOf = (id) => (typeMap[id] && typeMap[id].label) || typeLabel(id);
  const tag = (id) => <span className={`dist-ctag ${CUST_TAG[id] || 'other'}`}>{typeLabelOf(id)}</span>;
  const defaultType = () => (types[0] && types[0].id) || 'reguler';
  // Armada options from the single source. A value the customer already has but that
  // is no longer in the fleet list is kept (shown as "non-aktif") so it never vanishes.
  const fleetList = Array.isArray(fleet) ? fleet : [];
  const isActiveArmada = (v) => !v || fleetList.includes(v);
  const armadaFull = (v) => (v ? v + (isActiveArmada(v) ? '' : ' ' + trD('dist.armadaInactive')) : '');
  const fleetOptsFor = (cur) => {
    const opts = [{ value: '', label: trD('dist.noArmada') }, ...fleetList.map((pl) => ({ value: pl, label: pl }))];
    if (cur && !fleetList.includes(cur)) opts.push({ value: cur, label: armadaFull(cur) });
    return opts;
  };

  const loadInvoices = (id) => window.API.distribusi.invoices.list(id).then((r) => setInvoices(r.data || [])).catch(() => setInvoices([]));
  const openDetail = (id) => { setView('detail'); setDetail(null); setInvoices([]); window.API.distribusi.customers.get(id).then((r) => setDetail(r.data)).catch(() => setView('list')); loadInvoices(id); };
  const cancelAdj = (batchId) => {
    if (!confirm(trD('dist.pcCancelConfirm'))) return;
    window.API.distribusi.customers.cancelPriceAdjustment(batchId)
      .then(() => { flash(trD('dist.pcCancelled')); if (detail) openDetail(detail.id); reload(); if (onChanged) onChanged(); })
      .catch(() => {});
  };
  // Customer removal (gated distribusiCustomerDelete). Deactivate = soft (history kept,
  // restorable); reactivate = restore; deletePermanent = irreversible wipe. The modal drives
  // which path runs; every result refreshes the list + notifies the shell.
  const doDeactivate = () => {
    if (!delFor) return; setDelBusy(true);
    window.API.distribusi.customers.deactivate(delFor.id)
      .then(() => { flash(trD('dist.delDeactivated', { name: delFor.name })); setDelFor(null); setView('list'); setDetail(null); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')))
      .finally(() => setDelBusy(false));
  };
  const doDeletePermanent = () => {
    if (!delFor) return; setDelBusy(true);
    window.API.distribusi.customers.remove(delFor.id)
      .then(() => { flash(trD('dist.delDeleted', { name: delFor.name })); setDelFor(null); setView('list'); setDetail(null); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')))
      .finally(() => setDelBusy(false));
  };
  const doReactivate = (c) => {
    window.API.distribusi.customers.reactivate(c.id)
      .then(() => { flash(trD('dist.delReactivated', { name: c.name })); if (detail && detail.id === c.id) openDetail(c.id); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  const defReminder = () => ({ enabled: false, dueDay: 0, weekday: '', overdueDays: 0, gallonThreshold: 0, bonThreshold: 0 });
  const remOf = (r) => (r && typeof r === 'object') ? { ...defReminder(), ...r, enabled: !!r.enabled } : defReminder();
  const openAdd = () => { setFormErr(''); setForm({ id: null, name: '', phone: '', type: defaultType(), price: '', deliveryDays: [], armada: '', reminder: defReminder(), address: '', mapsUrl: '' }); };
  const openEdit = (d) => { setFormErr(''); setForm({ id: d.id, name: d.name || '', phone: d.phone || '', type: d.type || defaultType(), price: '', deliveryDays: Array.isArray(d.deliveryDays) ? d.deliveryDays : [], armada: d.armada || '', reminder: remOf(d.reminder), address: d.address || '', mapsUrl: d.mapsUrl || '' }); };
  const toggleDay = (d) => setForm((f) => ({ ...f, deliveryDays: f.deliveryDays.includes(d) ? f.deliveryDays.filter((x) => x !== d) : [...f.deliveryDays, d] }));

  const commitForm = () => {
    if (!form || saving) return;
    const name = form.name.trim();
    if (!name) { setFormErr(trD('dist.cfNameReq')); return; }
    const onErr = (e) => { setSaving(false); setFormErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); };
    const finish = (msg, data) => { setSaving(false); setForm(null); flash(msg); reload(); if (data) setDetail((d) => (d && d.id === data.id ? { ...d, ...data } : d)); if (onChanged) onChanged(); };
    const mu = (form.mapsUrl || '').trim();
    if (mu && !/^https?:\/\//i.test(mu)) { setFormErr(trD('dist.mapsUrlInvalid')); return; }
    const locFields = { address: (form.address || '').trim(), mapsUrl: mu };
    // GPS-captured point → also send lat/lng/accuracy so the ±m is stored (not just the link).
    if (form._lat != null && form._lng != null) { locFields.lat = form._lat; locFields.lng = form._lng; locFields.accuracy = form._accuracy != null ? form._accuracy : null; }
    setSaving(true); setFormErr('');
    if (!form.id) {
      const price = parseInt(String(form.price).replace(/[^0-9]/g, ''), 10);
      if (!price) { setSaving(false); setFormErr(trD('dist.cfPriceReq')); return; }
      window.API.distribusi.customers.create({ name, phone: form.phone.trim(), type: form.type, masterPrice: price, deliveryDays: form.deliveryDays, armada: form.armada, reminder: form.reminder, ...locFields })
        .then(() => finish(trD('dist.custAdded'))).catch(onErr);
    } else {
      window.API.distribusi.customers.update(form.id, { name, phone: form.phone.trim(), type: form.type, deliveryDays: form.deliveryDays, armada: form.armada, reminder: form.reminder, ...locFields })
        .then((r) => finish(trD('dist.custSaved'), r.data)).catch(onErr);
    }
  };

  // ── spreadsheet import parsing (shared by paste-text AND file upload) ──
  const typeByLabel = {}; types.forEach((t) => { typeByLabel[(t.label || '').toLowerCase()] = t.id; });
  // Dedup key = name + phone (two different people can share a name), matched case-insensitively.
  // Dedup on the NORMALISED phone so an Excel-mangled "8123…" and a typed "08123…" are the
  // same person (mirrors the server's defensive dedup).
  const dupKey = (n, p) => (String(n || '').trim().toLowerCase() + '|' + normalizePhone(p));
  const existing = new Set((custs || []).map((c) => dupKey(c.name, c.phone)));
  // Rows of cells come from an uploaded file if present, else the pasted textarea.
  const rawCells = impFileRows || impText.split('\n').map((l) => l.trim()).filter(Boolean).map(splitCells);
  // Flexible header mapping: recognise common headers in ANY order; if the first row isn't a
  // header, fall back to the positional order (Nama · No HP · Tipe · Harga).
  const HRE = { name: /nama|name/i, phone: /hp|phone|telp|telepon|wa\b/i, type: /tipe|type|jenis/i, price: /harga|price|tarif/i, days: /hari|kirim|days/i, armada: /armada|fleet|mobil|kendaraan/i, address: /alamat|address/i, mapsUrl: /maps|link|gmaps|lokasi/i };
  // Positional fallback matches the downloadable template's full 8-column order, so a headerless
  // paste/file still reads Hari Kirim · Armada · Alamat · Maps (not just the first four).
  let colMap = { name: 0, phone: 1, type: 2, price: 3, days: 4, armada: 5, address: 6, mapsUrl: 7 };
  let dataRows = rawCells;
  let headerOffset = 0;   // +1 when the first row is a header, so srcRow maps to the spreadsheet line
  if (rawCells.length) {
    const h = rawCells[0].join(' ');
    if (HRE.name.test(h) && HRE.price.test(h)) {   // looks like a header row
      const hdr = rawCells[0]; const idx = (re) => hdr.findIndex((c) => re.test(c));
      colMap = { name: Math.max(0, idx(HRE.name)), phone: idx(HRE.phone), type: idx(HRE.type), price: idx(HRE.price), days: idx(HRE.days), armada: idx(HRE.armada), address: idx(HRE.address), mapsUrl: idx(HRE.mapsUrl) };
      dataRows = rawCells.slice(1); headerOffset = 1;
    }
  }
  const cellAt = (row, i) => (i >= 0 && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : '');
  // Existing customers by dedupe key → so a duplicate can name what it clashes with.
  const existingByKey = {}; (custs || []).forEach((c) => { existingByKey[dupKey(c.name, c.phone)] = c; });
  const seenAt = {};   // dedupe key → the source-row number of its FIRST occurrence in this file
  const impRows = dataRows
    .map((cols, di) => ({ cols, srcRow: di + 1 + headerOffset }))   // 1-based spreadsheet line (incl. header)
    .filter((x) => x.cols && x.cols.some((c) => String(c || '').trim()))
    .map(({ cols, srcRow }) => {
      const name = cellAt(cols, colMap.name); const phoneRaw = cellAt(cols, colMap.phone);
      // Auto-repair the number for BOTH the preview and the payload — the user never reformats Excel.
      const phone = normalizePhone(phoneRaw); const phoneFixed = phoneWasFixed(phoneRaw);
      const type = typeByLabel[cellAt(cols, colMap.type).toLowerCase()] || 'reguler';
      const num = parseInt(cellAt(cols, colMap.price).replace(/[^0-9]/g, ''), 10);
      const days = parseDeliveryDays(cellAt(cols, colMap.days));
      // Normalise the armada value to the fleet dictionary (case-insensitive): "merah"/"MERAH" →
      // "Merah". Unknown or empty → blank (not an error), so a customer never lands on a fleet the
      // filters don't know about.
      const armada = armadaMatch(cellAt(cols, colMap.armada)); const address = cellAt(cols, colMap.address);
      const mu = cellAt(cols, colMap.mapsUrl); const mapsUrl = /^https?:\/\//i.test(mu) ? mu : '';
      const key = dupKey(name, phone);
      const dbHit = name ? existingByKey[key] : null;                 // clashes with an existing customer
      const fileDup = name && seenAt[key] != null ? seenAt[key] : null; // clashes with an earlier row here
      const dup = !!dbHit || fileDup != null;
      if (name && seenAt[key] == null && !dbHit) seenAt[key] = srcRow;   // remember the first occurrence
      const status = (!name || !num) ? 'kurang' : (dup ? 'dup' : 'ok');
      // A precise, human reason for every skipped row so it reads as an intended skip, not a mystery.
      let reason = '';
      if (status === 'kurang') {
        const miss = []; if (!name) miss.push(trD('dist.impRNama')); if (!num) miss.push(trD('dist.impRHarga'));
        reason = miss.join(' · ');
      } else if (status === 'dup') {
        reason = dbHit ? trD('dist.impRDupDb', { who: dbHit.name + (dbHit.phone ? ' / ' + normalizePhone(dbHit.phone) : '') })
          : trD('dist.impRDupRow', { n: fileDup });
      }
      return { srcRow, name: name || '(kosong)', phone: phone || '—', phoneFixed, type, price: num || 0, days, armada, address, mapsUrl, valid: status === 'ok', status, reason };
    });
  const impValid = impRows.filter((r) => r.valid);
  const impSkipped = impRows.filter((r) => !r.valid);
  const impNKurang = impSkipped.filter((r) => r.status === 'kurang').length;
  const impNDup = impSkipped.filter((r) => r.status === 'dup').length;
  // Which rows the preview table shows, per the active status chip.
  const impShown = impFilter === 'ok' ? impValid : impFilter === 'skip' ? impSkipped
    : impFilter === 'kurang' ? impSkipped.filter((r) => r.status === 'kurang')
    : impFilter === 'dup' ? impSkipped.filter((r) => r.status === 'dup') : impRows;
  // Download ONLY the skipped rows + their reason, so the user fixes them in Excel and re-imports.
  const downloadSkipped = () => {
    const head = ['Baris', 'Nama', 'No HP', 'Tipe', 'Harga', 'Hari Kirim', 'Armada', 'Alamat', 'Maps', 'Keterangan'];
    const rows = [head, ...impSkipped.map((r) => [r.srcRow, r.name === '(kosong)' ? '' : r.name, r.phone === '—' ? '' : r.phone, typeLabel(r.type), r.price || '', r.days.join(';'), r.armada, r.address, r.mapsUrl, r.reason])];
    const csv = rows.map((row) => row.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pelanggan-dilewati.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const resetImport = () => { setImpText(''); setImpFileRows(null); setImpFileName(''); setImpFileErr(''); setImpFilter('all'); };
  const commitImport = () => {
    if (!impValid.length || impSaving) return;
    setImpSaving(true);
    window.API.distribusi.customers.import(impValid.map((r) => ({
      name: r.name, phone: r.phone === '—' ? '' : r.phone, type: r.type, masterPrice: r.price,
      ...(r.days.length ? { deliveryDays: r.days } : {}), ...(r.armada ? { armada: r.armada } : {}),
      ...(r.address ? { address: r.address } : {}), ...(r.mapsUrl ? { mapsUrl: r.mapsUrl } : {}),
    })), impRows.length - impValid.length)   // pass the count skipped in preview → server audit
      .then((r) => { setImpSaving(false); setImpOpen(false); resetImport(); flash(trD('dist.importedSum', { n: r.imported, m: r.skipped != null ? r.skipped : (impRows.length - impValid.length) })); reload(); if (onChanged) onChanged(); })
      .catch(() => setImpSaving(false));
  };
  // Read a chosen file → 2D cells. CSV as text; XLSX/XLS via lazy-loaded SheetJS.
  const onImpFile = (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    setImpFileErr(''); setImpFileBusy(true); setImpFileName(file.name); setImpText('');
    const isXlsx = /\.xlsx?$/i.test(file.name) || /sheet|excel/i.test(file.type);
    if (isXlsx) {
      loadSheetJS().then((XLSX) => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }).map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
            setImpFileRows(rows); setImpFileBusy(false);
          } catch (ex) { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); }
        };
        rd.onerror = () => { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); };
        rd.readAsArrayBuffer(file);
      }).catch(() => { setImpFileErr(trD('dist.importXlsxCdnErr')); setImpFileBusy(false); setImpFileName(''); });
    } else {
      const rd = new FileReader();
      rd.onload = () => { setImpFileRows(String(rd.result || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitCells)); setImpFileBusy(false); };
      rd.onerror = () => { setImpFileErr(trD('dist.importFileErr')); setImpFileBusy(false); setImpFileName(''); };
      rd.readAsText(file);
    }
  };
  const impSample = 'Warung Sejahtera\t0821-1122-3344\tReguler\t12500\nKos Anggrek\t0813-7788-9900\tKos\t13000\nCafe Ombak\t0817-2211-3344\tCafe\t14000';
  // Undo a legacy import batch (GM/owner) — typed confirmation. Safe: archive rows touch no ledger.
  const undoLegacyBatch = (batchId) => {
    if (window.prompt(trD('dist.liUndoPrompt')) !== 'HAPUS') return;
    window.API.distribusi.customers.undoLegacyBatch(detail.id, batchId)
      .then(() => { flash(trD('dist.liUndone')); openDetail(detail.id); reload(); if (onChanged) onChanged(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')));
  };

  // Add/Edit modal — shared by the list and detail views. Price is add-only (edits
  // go through Harga Master, which keeps the price history).
  const renderForm = () => form && (
    <div className="modal-scrim" onClick={() => setForm(null)} style={{ zIndex: 200 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{form.id ? trD('dist.editCust') : trD('dist.addCust')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.addCustSub')}</div></div><button className="jp-icon" onClick={() => setForm(null)}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.cfName')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <input className="fld" value={form.name} placeholder={trD('dist.cfNamePh')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="fld-label">{trD('dist.cfPhone')}</label>
          {/* Repair on blur so the field shows exactly what will be stored ("8123…" → "08123…"). */}
          <input className="fld" value={form.phone} placeholder="cth. 0812-3456-7890"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onBlur={() => setForm((f) => ({ ...f, phone: normalizePhone(f.phone) }))} />
          <label className="fld-label">{trD('dist.cfType')}</label>
          <div className="dist-typechips">
            {types.map((t) => <button type="button" key={t.id} className={`dist-typechip ${form.type === t.id ? 'on' : ''}`} onClick={() => setForm({ ...form, type: t.id })}>{t.label}</button>)}
            {canCustomers && <button type="button" className="dist-typechip add" onClick={() => setTypesOpen(true)}><IconPlus s={13} />{trD('dist.kelolaTipe')}</button>}
          </div>
          <label className="fld-label">{trD('dist.cfDays')}</label>
          <div className="dist-typechips">{DAY_CODES.map((dd) => <button type="button" key={dd} className={`dist-typechip ${form.deliveryDays.includes(dd) ? 'on' : ''}`} onClick={() => toggleDay(dd)}>{dd}</button>)}</div>
          <label className="fld-label">{trD('dist.cfArmada')}</label>
          <UI.Dropdown value={form.armada} options={fleetOptsFor(form.armada)} placeholder={trD('dist.noArmada')} onChange={(v) => setForm({ ...form, armada: v })} fluid />
          <label className="fld-label">{trD('dist.cfAddress')}</label>
          <input className="fld" value={form.address} maxLength={300} placeholder={trD('dist.cfAddressPh')} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <label className="fld-label">{trD('dist.cfMapsUrl')}</label>
          <div className="dist-mapsurl-row">
            {/* Manually editing the link clears any captured GPS coords so we never save stale lat/lng. */}
            <input className="fld" value={form.mapsUrl} maxLength={500} placeholder={trD('dist.cfMapsUrlPh')} onChange={(e) => setForm({ ...form, mapsUrl: e.target.value, _lat: undefined, _lng: undefined, _accuracy: undefined })} />
            <GpsButton label={trD('dist.getGps')} onFlash={setFormErr} onCapture={({ lat, lng, accuracy }) => { setForm((f) => ({ ...f, mapsUrl: mapsUrl(lat, lng), _lat: lat, _lng: lng, _accuracy: accuracy })); setFormErr(''); }} />
          </div>
          {form._accuracy != null && <div className="dist-hint" style={{ marginTop: 5 }}>{trD('dist.locAccNote', { x: Math.round(form._accuracy) })}</div>}
          {form.mapsUrl ? <a className="dist-link" href={form.mapsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, marginTop: 5, display: 'inline-flex', gap: 4, alignItems: 'center' }}><IconPin s={12} />{trD('dist.openMaps')}</a> : <div className="dist-hint" style={{ marginTop: 5 }}>{trD('dist.cfMapsUrlHint')}</div>}
          {(() => {
            const r = form.reminder || {};
            const setR = (p) => setForm((f) => ({ ...f, reminder: { ...(f.reminder || {}), ...p } }));
            const numF = (e) => Math.max(0, parseInt((e.target.value || '').replace(/[^0-9]/g, ''), 10) || 0);
            return (
              <div className="dist-reminder">
                <label className="dist-reminder-toggle"><input type="checkbox" checked={!!r.enabled} onChange={(e) => setR({ enabled: e.target.checked })} /><span><b>{trD('dist.remTitle')}</b><em>{trD('dist.remSub')}</em></span></label>
                {r.enabled && (
                  <div className="dist-reminder-body">
                    <div className="dist-form-row">
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remBon')}</label><div className="amt-input" style={{ padding: '6px 11px' }}><span className="amt-rp" style={{ fontSize: 12 }}>Rp</span><input inputMode="numeric" value={r.bonThreshold ? (+r.bonThreshold).toLocaleString('id-ID') : ''} placeholder="0" onChange={(e) => setR({ bonThreshold: numF(e) })} /></div></div>
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remGallon')}</label><input className="fld tnum" inputMode="numeric" value={r.gallonThreshold || ''} placeholder="0" onChange={(e) => setR({ gallonThreshold: numF(e) })} /></div>
                    </div>
                    <div className="dist-form-row">
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remOverdue')}</label><input className="fld tnum" inputMode="numeric" value={r.overdueDays || ''} placeholder="0" onChange={(e) => setR({ overdueDays: numF(e) })} /></div>
                      <div style={{ flex: 1 }}><label className="fld-label">{trD('dist.remDueDay')}</label><input className="fld tnum" inputMode="numeric" value={r.dueDay || ''} placeholder="0" onChange={(e) => setR({ dueDay: Math.min(31, numF(e)) })} /></div>
                    </div>
                    <label className="fld-label">{trD('dist.remWeekly')}</label>
                    <div className="dist-typechips">
                      <button type="button" className={`dist-typechip ${!r.weekday ? 'on' : ''}`} onClick={() => setR({ weekday: '' })}>{trD('dist.remOff')}</button>
                      {DAY_CODES.map((dd) => <button type="button" key={dd} className={`dist-typechip ${r.weekday === dd ? 'on' : ''}`} onClick={() => setR({ weekday: dd })}>{dd}</button>)}
                    </div>
                    <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.remHint')}</div>
                  </div>
                )}
              </div>
            );
          })()}
          {!form.id ? (<>
            <label className="fld-label">{trD('dist.cfPrice')} <span style={{ color: 'var(--neg)' }}>*</span></label>
            <div className="dist-priceinput"><IconLock s={15} /><input value={form.price} inputMode="numeric" placeholder="cth. 12000" onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^0-9]/g, '') })} /></div>
            <div className="dist-hint" style={{ marginTop: 8 }}>{trD('dist.cfPriceNote')}</div>
          </>) : <div className="dist-hint" style={{ marginTop: 10 }}><IconLock s={12} /> {trD('dist.cfPriceEditNote')}</div>}
          {formErr && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{formErr}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setForm(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!form.name.trim() || saving} onClick={commitForm}>{saving ? '…' : trD('dist.cfSave')}</button></div>
      </div>
    </div>
  );
  const typesModal = () => typesOpen && <CustomerTypesModal types={types} custs={custs} onReload={() => { reloadTypes(); reload(); }} onClose={() => setTypesOpen(false)} />;

  // ── DETAIL ──
  if (view === 'detail') {
    const d = detail;
    const days = d ? fmtDays(d.deliveryDays) : '';
    // ── Derived, PRESENTATION-ONLY figures from the existing response (no new business logic) ──
    const txAll = (d && d.transactions) || [];
    const adjustments = (d && d.adjustments) || [];
    const pendingAdj = adjustments.filter((a) => a.status === 'pending');
    // Problem-transaction summary (from the server's disputeSummary) → Ringkasan card + KPI chip.
    const dsum = (d && d.disputeSummary) || { disengketakan: { n: 0, amount: 0 }, tidak_diakui: { n: 0, amount: 0 }, kerugian: { n: 0, amount: 0 } };
    const problemN = dsum.disengketakan.n + dsum.tidak_diakui.n + dsum.kerugian.n;
    const problemAmt = dsum.disengketakan.amount + dsum.tidak_diakui.amount + dsum.kerugian.amount;
    const txOldNew = txAll.slice().sort((a, b) => (a.txnDate || '').localeCompare(b.txnDate || '') || (a.createdAt || 0) - (b.createdAt || 0));
    const runMap = {}; let runBal = 0; txOldNew.forEach((t) => { runBal += bonEffectOf(t); runMap[t.id] = runBal; });   // running receivable after each row
    const lastTx = txOldNew.length ? txOldNew[txOldNew.length - 1] : null;
    const tx30 = txAll.filter((t) => (t.createdAt || 0) >= Date.now() - 30 * 86400000 && !t.voided).length;
    const unpaidCount = txAll.filter((t) => t.method === 'bon' && !t.voided && t.bonCounted).length;
    const lifetimeGalon = txAll.filter((t) => !t.legacy && !t.voided).reduce((s, t) => s + (t.qty || 0), 0);
    const totalSpend = txAll.filter((t) => (t.method === 'lunas' || t.method === 'bon') && !t.voided).reduce((s, t) => s + (t.effectiveAmount != null ? t.effectiveAmount : t.amount), 0);
    const monthsSince = d && d.createdAt ? Math.max(1, Math.round((Date.now() - new Date(d.createdAt).getTime()) / (30 * 86400000))) : 1;
    const today = (window.FIN && FIN.TODAY) || new Date().toISOString().slice(0, 10);
    const periodBounds = () => {
      if (cdPeriod === 'all') return null;
      if (cdPeriod === '30') return { from: isoAddDays(today, -29), to: today };
      if (cdPeriod === 'month') return { from: today.slice(0, 8) + '01', to: today };
      if (cdPeriod === 'lastMonth') { const dt = new Date(today + 'T00:00'); const lm = new Date(dt.getFullYear(), dt.getMonth() - 1, 1); const end = new Date(dt.getFullYear(), dt.getMonth(), 0); return { from: lm.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }; }
      if (cdPeriod === 'year') return { from: today.slice(0, 4) + '-01-01', to: today };
      if (cdPeriod === 'range') return (cdFrom && cdTo) ? { from: cdFrom, to: cdTo } : null;
      return null;
    };
    const pb = periodBounds();
    const inPeriod = (t) => !pb || ((t.txnDate || '') >= pb.from && (t.txnDate || '') <= pb.to);
    const q = cdSearch.trim().toLowerCase();
    const matchSearch = (t) => !q || [txnCode(t), t.note, String(t.amount), String(t.effectiveAmount != null ? t.effectiveAmount : '')].some((x) => String(x || '').toLowerCase().includes(q));
    const dispStatusOf = (t) => (t.dispute ? t.dispute.status : null);
    const isLossed = (t) => dispStatusOf(t) === 'tidak_diakui' || dispStatusOf(t) === 'kerugian';
    const base0 = txAll.filter((t) => (cdArchive || !t.legacy) && inPeriod(t) && matchSearch(t));
    // Dispute chip counts (over the period/search set, before the dispute chip itself narrows).
    const dispCounts = { disengketakan: 0, lossed: 0 };
    base0.forEach((t) => { const s = dispStatusOf(t); if (s === 'disengketakan') dispCounts.disengketakan++; else if (s === 'tidak_diakui' || s === 'kerugian') dispCounts.lossed++; });
    const base = base0.filter((t) => cdDispute === 'all' || (cdDispute === 'disengketakan' ? dispStatusOf(t) === 'disengketakan' : isLossed(t)));
    const typeCounts = { all: base.length, lunas: 0, bon: 0, pelunasan: 0 };
    base.forEach((t) => { if (typeCounts[t.method] != null) typeCounts[t.method]++; });
    const rowsFiltered = base.filter((t) => cdType === 'all' || t.method === cdType).sort((a, b) => (b.txnDate || '').localeCompare(a.txnDate || '') || (b.createdAt || 0) - (a.createdAt || 0));
    // Group the (newest-first) rows by month with a subtotal.
    const monthOrder = []; const monthMap = {};
    rowsFiltered.forEach((t) => { const k = monthKeyOf(t); if (!monthMap[k]) { monthMap[k] = { galon: 0, nilai: 0, bon: 0, rows: [] }; monthOrder.push(k); } const g = monthMap[k]; g.rows.push(t); if (!t.voided) { g.galon += (t.legacy ? 0 : t.qty || 0); g.nilai += (t.method === 'pelunasan' ? 0 : (t.effectiveAmount != null ? t.effectiveAmount : t.amount)); g.bon += bonEffectOf(t); } });
    const anyFilter = cdSearch || cdType !== 'all' || cdPeriod !== 'all' || !cdArchive;
    // Semantic bar colour per row.
    const barOf = (t) => t.voided ? '#dc2626' : t.legacy ? '#94a3b8' : t.method === 'bon' ? '#e0a13c' : t.method === 'pelunasan' ? '#2f6fb0' : '#17b083';
    const srcOf = (t) => t.legacy ? { lbl: trD('cd.srcImpor'), cls: 'arsip' } : { lbl: trD('cd.srcManual'), cls: 'manual' };
    const waLink = d && d.phone ? 'https://wa.me/' + String(d.phone).replace(/[^0-9]/g, '').replace(/^0/, '62') : null;
    const telLink = d && d.phone ? 'tel:' + String(d.phone).replace(/\s/g, '') : null;
    // Overflow-menu action list (hidden, not disabled, when a capability is missing).
    const menuActions = d ? [
      (canInput || canCustomers) && { k: 'inv', label: trD('dist.makeInvoice'), ic: 'IconInvoice', fn: () => setInvBuilder(true) },
      canInput && d.sisaBon > 0 && { k: 'pay', label: trD('dist.payBon'), ic: 'IconCoinIn', fn: () => setPayFor(d) },
      canKoreksi && { k: 'ob', label: trD('dist.obBtn'), ic: 'IconInvoice', fn: () => setObFor(d) },
      canBonAdjust && d.sisaBon > 0 && { k: 'pnr', label: trD('pnr.btn'), ic: 'IconWarn', fn: () => setPnrFor(d) },
      canPenyesuaian && { k: 'adjg', label: trD('adj.title') + ' · ' + trD('adj.kindGalon'), ic: 'IconPencil', fn: () => setAdjustFor({ customer: d, kind: 'galon' }) },
      canPenyesuaian && { k: 'adjb', label: trD('adj.title') + ' · ' + trD('adj.kindBon'), ic: 'IconPencil', fn: () => setAdjustFor({ customer: d, kind: 'bon' }) },
      { k: 'hist', label: trD('dist.printHistory'), ic: 'IconDownload', fn: () => setPrintFor({ mode: 'statement' }) },
      canLegacyImport && { k: 'imp', label: trD('dist.liBtn'), ic: 'IconDownload', fn: () => setLegacyOpen(true) },
      canCustomers && { k: 'edit', label: trD('dist.editCust'), ic: 'IconPencil', fn: () => openEdit(d) },
      canDelete && d.active === false && { k: 're', label: trD('dist.reactivate'), ic: 'IconRefresh', fn: () => doReactivate(d) },
      canDelete && { k: 'del', label: trD('dist.delCust'), ic: 'IconTrash', danger: true, fn: () => setDelFor(d) },
    ].filter(Boolean) : [];
    const runExpand = (t) => setCdExpanded(cdExpanded === t.id ? null : t.id);
    const copyRow = (t) => copyText([txnCode(t), fmtDateShort(t.txnDate), methodLabel(t.method), numX(t.qty) + ' × ' + rpFull(t.unitPriceLocked), rpFull(t.effectiveAmount != null ? t.effectiveAmount : t.amount), t.actorName || '', t.note || ''].join(' · '), () => flash(trD('cd.copied')));
    // A single transaction row (shared desktop table + mobile card via CSS).
    const TxnRow = (t) => {
      const amt = t.effectiveAmount != null ? t.effectiveAmount : t.amount;
      const src = srcOf(t); const open = cdExpanded === t.id;
      const dsp = t.dispute;                    // effective (latest) dispute for this transaction, or null
      const dm = dsp ? DISPUTE_META[dsp.status] : null;
      const struck = disputeDeducts(t);         // strike-through Nominal + show acknowledged amount
      const hasActive = dsp && dsp.status !== 'diakui_kembali';
      return (
        <div key={t.id} className={'cd-txn' + (t.voided ? ' voided' : '') + (struck ? ' disputed-out' : '') + (open ? ' open' : '')}>
          <button type="button" className="cd-txn-main" aria-expanded={open} onClick={() => runExpand(t)}>
            <span className="cd-txn-bar" style={{ background: struck ? '#dc2626' : barOf(t) }} />
            <span className="cd-txn-date"><b>{fmtDateShort(t.txnDate)}</b><small>{hhmm(t.createdAt)}</small></span>
            <span className="cd-txn-code">{txnCode(t)}<CopyBtn text={txnCode(t)} label={trD('cd.colKode')} /></span>
            <span className="cd-txn-type"><span className={'dist-status ' + (METHOD_META[t.method] ? METHOD_META[t.method].cls : '')}>{methodLabel(t.method)}</span>{t.voided && <span className="dist-badge rev">{trD('dist.voided') || 'Batal'}</span>}{t.corrected && <span className="dist-badge corr"><IconPencil s={9} />{trD('dist.corrected')}</span>}{dm && <span className={'dist-badge ' + dm.cls}>{trD(dm.label)}</span>}</span>
            <span className="cd-txn-gal tnum">{t.method === 'pelunasan' ? '—' : numX(t.qty)}</span>
            <span className="cd-txn-price tnum">{t.method === 'pelunasan' ? '—' : rpFull(t.unitPriceLocked)}</span>
            <span className="cd-txn-amt tnum">{struck ? <><s className="cd-amt-struck">{rpFull(amt)}</s> <span className="cd-amt-ack">→ {trD('disp.ack')} {rpFull(dsp.customerClaimAmount || 0)}</span></> : rpFull(amt)}</span>
            <span className="cd-txn-run tnum" title={trD('cd.runningTip')}>{rpFull(Math.max(0, runMap[t.id] || 0))}</span>
            <span className={'cd-txn-src ' + src.cls}>{src.lbl}</span>
            <span className="cd-txn-staff">{t.actorName || '—'}</span>
            <span className="cd-txn-caret"><IconCaret s={13} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></span>
          </button>
          {open && (
            <div className="cd-txn-detail">
              <div><span>{trD('cd.expandBy')}</span><b>{t.actorName || '—'}</b></div>
              <div><span>Tanggal & jam</span><b>{fmtDateShort(t.txnDate)}{t.createdAt ? ' · ' + hhmm(t.createdAt) : ''}</b></div>
              <div><span>{trD('cd.expandSrc')}</span><b>{src.lbl}{t.importBatchId ? ' · ' + t.importBatchId : ''}</b></div>
              {t.note ? <div><span>{trD('cd.expandNote')}</span><b>{t.note}</b></div> : null}
              {t.voided ? <div><span>{trD('cd.actVoid')}</span><b>{t.voidReason || '—'}{t.voidedByName ? ' · ' + t.voidedByName : ''}</b></div> : null}
              {/* DISPUTE TRAIL — who raised it, when, why, evidence, who approved, and the linked loss. */}
              {(dsp && (dsp.trail || []).length > 0) && (
                <div className="cd-disp-trail">
                  <div className="cd-disp-t-head"><IconWarn s={13} />{trD('disp.trailTitle')}{dm && <span className={'dist-badge ' + dm.cls}>{trD(dm.label)}</span>}</div>
                  {(dsp.trail || []).map((x) => (
                    <div key={x.id} className="cd-disp-t-row">
                      <div className="cd-disp-t-main">
                        <b>{dispReasonLabel(x.reason)}</b>{x.disputedAmount ? ' · ' + trD('disp.selisih') + ' ' + rpFull(x.disputedAmount) : ''}
                        <div className="cd-disp-t-sub">{x.note}</div>
                        <div className="cd-disp-t-meta">
                          {trD('disp.raisedBy')}: <b>{x.raisedByName || '—'}</b> · {fmtDateShort(x.createdAt)}
                          {x.staffName ? ' · ' + trD('disp.staff') + ': ' + x.staffName : ''}
                          {x.approvedByName ? ' · ' + trD('disp.approvedBy') + ': ' + x.approvedByName : ''}
                          {(onOpenLoss && (x.staffLiabilityId || x.lossId)) ? <> · <button type="button" className="dist-link" onClick={() => onOpenLoss()}>{trD('disp.lihatKerugian')}</button></> : null}
                        </div>
                        {x.evidenceUrl ? <a className="cd-disp-evi" href={x.evidenceUrl} target="_blank" rel="noopener noreferrer"><IconInvoice s={12} />{trD('disp.bukti')}</a> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="cd-txn-detail-act">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyRow(t)}><IconInvoice s={13} />{trD('cd.copyDetail')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrintFor({ mode: 'nota', txn: t })}><IconDownload s={13} />{trD('cd.printNota')}</button>
                {/* Dispute action — capability-gated (hidden, not disabled). Only when the row isn't
                    already under an active dispute and isn't voided/pelunasan-loss. */}
                {canBonAdjust && !t.voided && !hasActive && t.method !== 'pelunasan' && <button type="button" className="btn btn-ghost btn-sm cd-disp-btn" onClick={() => setDisputeFor({ txn: t })}><IconWarn s={13} />{trD('disp.markBtn')}</button>}
                {isGmOwner && dsp && dsp.status === 'disengketakan' && <button type="button" className="btn btn-primary btn-sm" onClick={() => approveDispute(dsp.id)}><IconCheck s={13} />{trD('disp.approveBtn')}</button>}
                {isGmOwner && dsp && (dsp.status === 'tidak_diakui' || dsp.status === 'kerugian') && <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => reverseDispute(dsp.id)}><IconRefresh s={13} />{trD('disp.reverseBtn')}</button>}
              </div>
            </div>
          )}
        </div>
      );
    };
    const exportCsv = () => {
      const head = [trD('cd.colTanggal'), trD('cd.colKode'), trD('cd.colTipe'), trD('cd.colGalon'), trD('cd.colHarga'), trD('cd.colNominal'), trD('cd.colRunning'), trD('cd.colSumber'), trD('cd.colPetugas')];
      const out = [head].concat(rowsFiltered.map((t) => [t.txnDate, txnCode(t), methodLabel(t.method), t.method === 'pelunasan' ? '' : t.qty, t.method === 'pelunasan' ? '' : t.unitPriceLocked, t.effectiveAmount != null ? t.effectiveAmount : t.amount, Math.max(0, runMap[t.id] || 0), srcOf(t).lbl, t.actorName || '']));
      const csv = out.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const bl = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'transaksi-' + (d.code || d.id) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const TABS = [['ringkasan', trD('cd.tab.ringkasan')], ['transaksi', trD('cd.tab.transaksi')], ['penyesuaian', trD('cd.tab.penyesuaian')], ['info', trD('cd.tab.info')]].concat(isGmOwner ? [['aktivitas', trD('cd.tab.aktivitas')]] : []);
    // Activity feed (GM/owner) — composed from existing data (no new endpoint).
    const activity = [];
    if (d) {
      if (d.createdAt) activity.push({ at: new Date(d.createdAt).getTime(), t: trD('cd.actCreated'), who: d.createdByName, tone: 'ok' });
      (d.imports || []).forEach((b) => activity.push({ at: b.at, t: trD('cd.actImport', { n: b.count }), who: b.byName, tone: 'arsip' }));
      adjustments.forEach((a) => { activity.push({ at: a.createdAt, t: trD('cd.actAdjust', { kind: a.kind === 'bon' ? trD('adj.kindBon') : trD('adj.kindGalon') }) + ' · ' + (a.kind === 'bon' ? rpFull(a.before) + '→' + rpFull(a.after) : numX(a.before) + '→' + numX(a.after)), who: a.createdByName, tone: 'adj' }); if (a.approvedAt) activity.push({ at: a.approvedAt, t: trD('cd.actAdjustApproved'), who: a.approvedByName, tone: 'adj' }); });
      (d.priceAdjustments || []).forEach((b) => activity.push({ at: b.createdAt, t: trD('cd.actPrice') + ' · ' + rpFull(b.oldPrice) + '→' + rpFull(b.newPrice), who: b.actorName, tone: 'bon' }));
      txAll.filter((t) => t.voided).forEach((t) => activity.push({ at: t.voidedAt, t: trD('cd.actVoid') + ' · ' + txnCode(t), who: t.voidedByName, tone: 'rev' }));
    }
    activity.sort((a, b) => (b.at || 0) - (a.at || 0));
    return (
      <div className="dist-dash screen-enter cd-page">
        <button type="button" className="dist-back no-print" onClick={() => { setView('list'); setDetail(null); }}><IconCaret s={14} style={{ transform: 'rotate(90deg)' }} />{trD('dist.backCust')}</button>
        {!d ? <div className="card cd-skeleton"><div className="dist-skel" style={{ height: 60 }} /><div className="dist-skel" /><div className="dist-skel" /></div> : (<>
          {/* ── STICKY HEADER ── */}
          <div className="card cd-head">
            <div className="cd-head-top">
              <span className="cd-avatar" aria-hidden="true">{initialsOf(d.name)}</span>
              <div className="cd-head-id">
                <div className="cd-head-nrow"><h2 className="cd-name">{d.name}</h2>{d.code && <span className="cd-code">{d.code}<CopyBtn text={d.code} label={trD('cd.colKode')} /></span>}</div>
                <div className="cd-chips">
                  {tag(d.type)}
                  {d.armada && <span className={'cd-chip ' + (isActiveArmada(d.armada) ? '' : 'inactive')}><IconTruck s={11} />{armadaFull(d.armada)}</span>}
                  {days && <span className="cd-chip"><IconCalendar s={11} />{days}</span>}
                  <span className={'cd-chip ' + (d.active === false ? 'inactive' : 'ok')}>{d.active === false ? trD('dist.inactive') : trD('dist.aktif') || 'Aktif'}</span>
                </div>
              </div>
              <div className="cd-head-actions no-print">
                {waLink && <a className="cd-iconbtn wa" href={waLink} target="_blank" rel="noopener noreferrer" aria-label={trD('cd.wa')} title={trD('cd.wa')}><IconWhatsApp s={17} /></a>}
                {telLink && <a className="cd-iconbtn" href={telLink} aria-label={trD('cd.telp')} title={trD('cd.telp')}><IconPhone s={16} /></a>}
                {d.mapsLink && <a className="cd-iconbtn" href={d.mapsLink} target="_blank" rel="noopener noreferrer" aria-label={trD('cd.maps')} title={trD('cd.maps')}><IconPin s={16} /></a>}
                <div className="cd-menu-wrap">
                  <button type="button" className="cd-iconbtn" aria-haspopup="true" aria-expanded={cdMenu} aria-label={trD('cd.more')} onClick={() => setCdMenu((v) => !v)}><IconDots s={18} /></button>
                  {cdMenu && <><div className="cd-menu-scrim" onClick={() => setCdMenu(false)} /><div className="cd-menu" role="menu">{menuActions.map((a) => <button key={a.k} type="button" role="menuitem" className={'cd-menu-item' + (a.danger ? ' danger' : '')} onClick={() => { setCdMenu(false); a.fn(); }}>{IcX(a.ic, { s: 14 })}{a.label}</button>)}</div></>}
                </div>
              </div>
            </div>
          </div>
          {/* ── KPI STRIP ── */}
          <div className="cd-kpis">
            <KpiCard label={trD('cd.kpiSisaBon')} tone={d.sisaBon > 0 ? 'bon' : 'ok'} value={d.sisaBon > 0 ? rpFull(d.sisaBon) : trD('dist.lunas')} sub={unpaidCount > 0 ? trD('cd.subUnpaid', { n: unpaidCount }) : trD('dist.lunas')} action={d.sisaBon > 0 && canPenyesuaian ? <button type="button" className="dist-link" onClick={() => setAdjustFor({ customer: d, kind: 'bon' })}>{trD('cd.rekon')}</button> : null} />
            <KpiCard label={trD('cd.kpiGalon')} tone={(d.gallonsHeld || 0) > 0 ? 'bon' : ''} value={numX(d.gallonsHeld || 0)} sub={canPenyesuaian ? <button type="button" className="dist-link" onClick={() => setAdjustFor({ customer: d, kind: 'galon' })}>{trD('adj.adjustBtn')}</button> : trD('dist.gallonsHeld')} />
            <KpiCard label={trD('cd.kpiHarga')} value={rpFull(d.masterPrice)} sub={trD('dist.hargaPerGalon')} />
            <KpiCard label={trD('cd.kpi30')} value={numX(tx30)} sub={lastTx ? trD('cd.subLast', { d: fmtDateShort(lastTx.txnDate) }) : trD('cd.subNone')} />
            <KpiCard label={trD('cd.kpiLast')} value={lastTx ? fmtDateShort(lastTx.txnDate) : '—'} sub={lastTx ? methodLabel(lastTx.method) : trD('cd.subNone')} />
            {problemN > 0 && <KpiCard tone="bon" label={trD('disp.kpiProblem')} value={numX(problemN) + ' · ' + rpFull(problemAmt)} sub={<button type="button" className="dist-link" onClick={() => { setCdTab('transaksi'); setCdDispute(dsum.tidak_diakui.n + dsum.kerugian.n > 0 ? 'lossed' : 'disengketakan'); }}>{trD('disp.lihatTransaksi')} →</button>} />}
          </div>
          {/* ── TABS ── */}
          <div className="cd-tabs no-print" role="tablist">
            {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={cdTab === k} className={'cd-tab ' + (cdTab === k ? 'on' : '')} onClick={() => setCdTab(k)}>{l}{k === 'penyesuaian' && pendingAdj.length > 0 ? <span className="cd-tab-badge">{pendingAdj.length}</span> : null}</button>)}
          </div>

          {/* ── TAB: RINGKASAN ── */}
          {cdTab === 'ringkasan' && (
            <div className="cd-tabpanel">
              {pendingAdj.length > 0 && <div className="cd-pending-banner"><IconClock s={15} />{trD('cd.pendingBanner', { n: pendingAdj.length })}<button type="button" className="dist-link" onClick={() => setCdTab('penyesuaian')}>{trD('cd.tab.penyesuaian')} →</button></div>}
              <div className="cd-grid2">
                <div className="card cd-card">
                  <div className="dist-card-head"><div className="sec-title">{trD('dist.hargaMenempel')}</div><span className="dist-badge lock"><IconLock s={10} />{trD('dist.txLocked')}</span></div>
                  <div className="cd-priceval tnum">{rpFull(d.masterPrice)}</div>
                  <p className="cd-muted">{trD('dist.hargaMenempelNote')}</p>
                  {canPrice ? <button type="button" className="btn btn-ghost btn-sm" onClick={onGoHarga}><IconPencil s={13} />{trD('dist.ubahHarga')}</button> : <div className="cd-muted"><IconLock s={12} />{trD('dist.hargaOwnerOnly')}</div>}
                </div>
                <div className="card cd-card">
                  <div className="sec-title">{trD('cd.ringkasanCard')}</div>
                  <div className="cd-kv"><span>{trD('cd.lifetimeGalon')}</span><b className="tnum">{numX(lifetimeGalon)}</b></div>
                  <div className="cd-kv"><span>{trD('cd.totalSpend')}</span><b className="tnum">{rpFull(totalSpend)}</b></div>
                  <div className="cd-kv"><span>{trD('cd.avgMonth')}</span><b className="tnum">{rpFull(Math.round(totalSpend / monthsSince))}</b></div>
                  <div className="cd-kv"><span>{trD('cd.custSince')}</span><b>{d.createdAt ? fmtDateShort(d.createdAt) : '—'}</b></div>
                </div>
              </div>
              {/* TRANSAKSI BERMASALAH — disputed / not-acknowledged / loss, broken down. */}
              {problemN > 0 && (
                <div className="card cd-card cd-problem-card">
                  <div className="dist-card-head"><div className="sec-title"><IconWarn s={14} style={{ color: '#dc2626', verticalAlign: '-2px', marginRight: 5 }} />{trD('disp.summaryTitle')}</div><button type="button" className="dist-link" onClick={() => { setCdTab('transaksi'); setCdDispute('all'); }}>{trD('cd.tab.transaksi')} →</button></div>
                  <div className="cd-problem-total"><b className="tnum">{numX(problemN)} {trD('disp.txnWord')}</b><span className="tnum">{rpFull(problemAmt)}</span></div>
                  <div className="cd-problem-break">
                    <div className="cd-problem-seg"><span className="dist-badge disp-amber">{trD('cd.dispDisengketakan')}</span><b className="tnum">{numX(dsum.disengketakan.n)}</b><span className="tnum">{rpFull(dsum.disengketakan.amount)}</span></div>
                    <div className="cd-problem-seg"><span className="dist-badge disp-redout">{trD('cd.dispTidakDiakui')}</span><b className="tnum">{numX(dsum.tidak_diakui.n)}</b><span className="tnum">{rpFull(dsum.tidak_diakui.amount)}</span></div>
                    <div className="cd-problem-seg"><span className="dist-badge disp-redsolid">{trD('cd.dispKerugian')}</span><b className="tnum">{numX(dsum.kerugian.n)}</b><span className="tnum">{rpFull(dsum.kerugian.amount)}</span></div>
                  </div>
                </div>
              )}
              {/* INVOICE list — issued invoices reprint identically from the stored record. */}
              <div className="card cd-card">
                <div className="dist-card-head"><div className="sec-title"><IconInvoice s={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />{trD('inv.listTitle')}</div>{(canInput || canCustomers) && <button type="button" className="dist-link" onClick={() => setInvBuilder(true)}><IconPlus s={13} />{trD('dist.makeInvoice')}</button>}</div>
                {invoices.length === 0 ? <div className="cd-muted" style={{ padding: '8px 2px' }}>{trD('inv.none')}</div> : (
                  <div className="inv-list">
                    <div className="inv-list-head"><span>{trD('inv.no')}</span><span>{trD('inv.date')}</span><span className="r">{trD('inv.total')}</span><span>{trD('inv.status')}</span><span /></div>
                    {invoices.map((iv) => {
                      const lunas = (d.sisaBon || 0) <= 0;
                      return (
                        <div key={iv.id} className="inv-list-row">
                          <span className="inv-list-no">{iv.number}</span>
                          <span>{fmtDateShort(iv.issueDate)}</span>
                          <span className="r tnum">{rpFull(iv.sisaBon != null ? iv.sisaBon : iv.total)}</span>
                          <span><span className={'dist-badge ' + (lunas ? 'ok' : '')}>{lunas ? trD('inv.stLunas') : trD('inv.stSent')}</span></span>
                          <span className="r"><button type="button" className="dist-link" onClick={() => setInvView(iv)}><IconDownload s={12} />{trD('inv.reprint')}</button></span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="card cd-card">
                <div className="dist-card-head"><div className="sec-title">{trD('dist.riwayat')}</div><button type="button" className="dist-link" onClick={() => setCdTab('transaksi')}>{trD('cd.tab.transaksi')} →</button></div>
                {txOldNew.length === 0 ? <ListState state="empty" emptyText={trD('dist.noTxn')} emptyAction={canInput ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInvBuilder(true)}>{trD('dist.makeInvoice')}</button> : null} /> : <div className="cd-txns compact">{rowsFiltered.slice(0, 5).map((t) => TxnRow(t))}</div>}
              </div>
            </div>
          )}

          {/* ── TAB: TRANSAKSI ── */}
          {cdTab === 'transaksi' && (
            <div className="cd-tabpanel">
              <div className="cd-toolbar no-print">
                <div className="cd-search"><IconSearch s={14} /><input aria-label={trD('cd.search')} placeholder={trD('cd.search')} value={cdSearch} onChange={(e) => setCdSearch(e.target.value)} />{cdSearch && <button type="button" aria-label="clear" onClick={() => setCdSearch('')}><IconClose s={13} /></button>}</div>
                <div className="cd-chiprow">{[['all', trD('dist.fAll')], ['30', trD('cd.per30')], ['month', trD('cd.perThisMonth')], ['lastMonth', trD('cd.perLastMonth')], ['year', trD('cd.perThisYear')], ['range', trD('cd.perCustom')]].map(([k, l]) => <button key={k} type="button" className={'dist-chip ' + (cdPeriod === k ? 'on' : '')} onClick={() => setCdPeriod(k)}>{l}</button>)}</div>
                {cdPeriod === 'range' && <div className="dist-period-range"><DP.DateField value={cdFrom} onChange={setCdFrom} max={cdTo || today} /><span>–</span><DP.DateField value={cdTo} onChange={setCdTo} min={cdFrom || undefined} max={today} /></div>}
                <div className="cd-chiprow">{[['all', trD('dist.fAll') || 'Semua'], ['lunas', methodLabel('lunas')], ['bon', methodLabel('bon')], ['pelunasan', methodLabel('pelunasan')]].map(([k, l]) => <button key={k} type="button" className={'dist-chip ' + (cdType === k ? 'on' : '')} onClick={() => setCdType(k)}>{l} <span className="dist-imp-chipn">{typeCounts[k]}</span></button>)}</div>
                {/* DISPUTE filter chips — only shown once a transaction is disputed. */}
                {(dispCounts.disengketakan + dispCounts.lossed) > 0 && (
                  <div className="cd-chiprow">
                    <button type="button" className={'dist-chip ' + (cdDispute === 'all' ? 'on' : '')} onClick={() => setCdDispute('all')}>{trD('dist.fAll')}</button>
                    <button type="button" className={'dist-chip cd-chip-disp ' + (cdDispute === 'disengketakan' ? 'on' : '')} onClick={() => setCdDispute('disengketakan')}>{trD('cd.dispDisengketakan')} <span className="dist-imp-chipn">{dispCounts.disengketakan}</span></button>
                    <button type="button" className={'dist-chip cd-chip-disp ' + (cdDispute === 'lossed' ? 'on' : '')} onClick={() => setCdDispute('lossed')}>{trD('disp.chipLossed')} <span className="dist-imp-chipn">{dispCounts.lossed}</span></button>
                  </div>
                )}
                <label className="cd-toggle"><input type="checkbox" checked={cdArchive} onChange={(e) => setCdArchive(e.target.checked)} />{trD('cd.showArchive')}</label>
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" disabled={!rowsFiltered.length} onClick={exportCsv}><IconDownload s={13} style={{ transform: 'rotate(180deg)' }} />{trD('rep.csv')}</button>
                {/* Prints EXACTLY the on-screen view: pass the resolved period bounds + type + archive
                    + search so the document filters identically to what's rendered. */}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrintFor({ mode: 'statement', initial: { period: pb ? 'range' : 'all', from: pb ? pb.from : '', to: pb ? pb.to : '', incArchive: cdArchive, type: cdType, search: cdSearch } })}><IconDownload s={13} />{trD('dist.print')}</button>
              </div>
              <div className="card cd-card cd-txn-card">
                <div className="cd-txn-head" role="row">
                  <span>{trD('cd.colTanggal')}</span><span>{trD('cd.colKode')}</span><span>{trD('cd.colTipe')}</span><span className="r">{trD('cd.colGalon')}</span><span className="r">{trD('cd.colHarga')}</span><span className="r">{trD('cd.colNominal')}</span><span className="r" title={trD('cd.runningTip')}>{trD('cd.colRunning')}</span><span>{trD('cd.colSumber')}</span><span>{trD('cd.colPetugas')}</span><span />
                </div>
                {txAll.length === 0 ? <ListState state="empty" emptyText={trD('dist.noTxn')} emptyAction={canInput ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInvBuilder(true)}>{trD('dist.makeInvoice')}</button> : null} />
                  : rowsFiltered.length === 0 ? <ListState state="nofilter" onClear={() => { setCdSearch(''); setCdType('all'); setCdPeriod('all'); setCdArchive(true); setCdDispute('all'); }} />
                  : monthOrder.map((mk) => (
                    <div key={mk} className="cd-month">
                      <div className="cd-month-head"><b>{fmtMonthYear(mk)}</b><span>{trD('cd.monthSub', { g: numX(monthMap[mk].galon), v: rpFull(monthMap[mk].nilai), b: (monthMap[mk].bon >= 0 ? '+' : '') + rpFull(monthMap[mk].bon) })}</span></div>
                      {monthMap[mk].rows.map((t) => TxnRow(t))}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── TAB: PENYESUAIAN ── */}
          {cdTab === 'penyesuaian' && (
            <div className="cd-tabpanel">
              {pendingAdj.length > 0 && <div className="cd-pending-banner"><IconClock s={15} />{trD('cd.pendingBanner', { n: pendingAdj.length })}</div>}
              <div className="card cd-card">
                <div className="sec-title" style={{ marginBottom: 8 }}><IconPencil s={14} /> {trD('adj.tableTitle')}</div>
                {adjustments.length === 0 ? <ListState state="empty" emptyText={trD('adj.tableTitle')} emptyAction={canPenyesuaian ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdjustFor({ customer: d, kind: 'bon' })}>{trD('adj.adjustBtn')}</button> : null} /> : (
                  <div className="dist-adj-table">
                    <div className="dist-adj-hrow"><span>{trD('adj.colDate')}</span><span>{trD('adj.colKind')}</span><span>{trD('adj.colChange')}</span><span>{trD('adj.colReason')}</span><span>{trD('adj.colBy')}</span><span>{trD('adj.colApprovedBy')}</span><span /></div>
                    {adjustments.map((a) => (
                      <div key={a.id} className={'dist-adj-row ' + a.status}>
                        <span>{fmtDateShort(a.createdAt)}</span>
                        <span>{a.kind === 'bon' ? trD('adj.kindBon') : trD('adj.kindGalon')}{a.reversalOf ? ' · ' + trD('adj.reversalBadge') : ''}</span>
                        <span className="tnum">{(a.kind === 'bon' ? rpFull(a.before) : numX(a.before))} → <b>{(a.kind === 'bon' ? rpFull(a.after) : numX(a.after))}</b></span>
                        <span>{adjReasonLabel(a.reason)}{a.note ? ' · ' + a.note : ''}</span>
                        <span>{a.createdByName || '—'}</span>
                        <span>{a.status === 'pending' ? <span className="dist-badge pending"><IconClock s={10} />{trD('adj.pending')}</span> : a.status === 'reversed' ? trD('adj.reversedBadge') : (a.approvedByName || '—')}</span>
                        <span>{a.status === 'pending' && isGmOwner && <button type="button" className="dist-link" onClick={() => approveAdjustment(a.id)}>{trD('adj.approve')}</button>}{isGmOwner && !a.reversalOf && !a.reversedById && a.status !== 'reversed' && <button type="button" className="dist-link danger" onClick={() => reverseAdjustment(a.id)}>{trD('adj.reverse')}</button>}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: INFO & PENGIRIMAN ── */}
          {cdTab === 'info' && (
            <div className="cd-tabpanel">
              <div className="cd-grid2">
                <div className="card cd-card">
                  <div className="dist-card-head"><div className="sec-title">{trD('cd.contact')}</div>{canCustomers && <button type="button" className="dist-link" onClick={() => openEdit(d)}><IconPencil s={12} />{trD('dist.editCust')}</button>}</div>
                  <div className="cd-kv"><span>{trD('dist.fCust')}</span><b>{d.name}</b></div>
                  <div className="cd-kv"><span>HP</span><b>{d.phone || '—'}{d.phone && <span className="cd-inline-ic">{waLink && <a className="cd-iconbtn sm wa" href={waLink} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><IconWhatsApp s={13} /></a>}<CopyBtn text={d.phone} label="HP" /></span>}</b></div>
                  <div className="cd-kv"><span>{trD('dist.location')}</span><b>{d.mapsLink ? <a className="dist-link" href={d.mapsLink} target="_blank" rel="noopener noreferrer">{trD('dist.directions')}</a> : trD('dist.locNotSet')}</b></div>
                  {d.address ? <div className="cd-kv"><span>{trD('dist.address') || 'Alamat'}</span><b>{d.address}</b></div> : null}
                  <div className="cd-photo"><LocPhoto custId={d.id} photoId={d.locationPhotoId} byName={d.locationPhotoByName} at={d.locationPhotoAt} canEdit={canInput || canCustomers} onChanged={() => { openDetail(d.id); reload(); }} /></div>
                </div>
                <div className="card cd-card">
                  <div className="dist-card-head"><div className="sec-title">{trD('cd.pengiriman')}</div>{canCustomers && <button type="button" className="dist-link" onClick={() => openEdit(d)}><IconPencil s={12} />{trD('dist.editCust')}</button>}</div>
                  <div className="cd-kv"><span>{trD('cd.hariKirim')}</span><b>{days ? <span className="cd-daychips">{DAY_CODES.map((dd) => <span key={dd} className={'cd-daychip ' + ((d.deliveryDays || []).includes(dd) ? 'on' : '')}>{dd}</span>)}</span> : '—'}</b></div>
                  <div className="cd-kv"><span>{trD('dist.armada')}</span><b>{d.armada ? armadaFull(d.armada) : '—'}</b></div>
                  {d.locationSetByName ? <div className="cd-kv"><span>{trD('cd.locNote')}</span><b>{trD('dist.locSetBy', { d: fmtDateShort(d.locationSetAt), who: d.locationSetByName })}</b></div> : null}
                </div>
                <div className="card cd-card">
                  <div className="dist-card-head"><div className="sec-title">{trD('cd.hargaTipe')}</div>{canPrice && <button type="button" className="dist-link" onClick={onGoHarga}><IconPencil s={12} />{trD('dist.ubahHarga')}</button>}</div>
                  <div className="cd-kv"><span>{trD('dist.hargaPerGalon')}</span><b className="tnum">{rpFull(d.masterPrice)}</b></div>
                  <div className="cd-kv"><span>{trD('dist.fType') || 'Tipe'}</span><b>{tag(d.type)}</b></div>
                  <div className="cd-kv"><span>{trD('cd.custSince')}</span><b>{d.createdAt ? fmtDateShort(d.createdAt) : '—'}</b></div>
                </div>
                <div className="card cd-card">
                  <div className="sec-title">{trD('cd.ringkasanCard')}</div>
                  <div className="cd-kv"><span>{trD('cd.lifetimeGalon')}</span><b className="tnum">{numX(lifetimeGalon)}</b></div>
                  <div className="cd-kv"><span>{trD('cd.totalSpend')}</span><b className="tnum">{rpFull(totalSpend)}</b></div>
                  <div className="cd-kv"><span>{trD('cd.avgMonth')}</span><b className="tnum">{rpFull(Math.round(totalSpend / monthsSince))}</b></div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: AKTIVITAS (GM/owner) ── */}
          {cdTab === 'aktivitas' && isGmOwner && (
            <div className="cd-tabpanel">
              <div className="card cd-card">
                <div className="sec-title" style={{ marginBottom: 4 }}>{trD('cd.activityTitle')}</div>
                <p className="cd-muted">{trD('cd.gmOnly')}</p>
                {activity.length === 0 ? <ListState state="empty" emptyText={trD('cd.activityTitle')} /> : (
                  <div className="cd-activity">{activity.map((ev, i) => (
                    <div key={i} className="cd-act-row"><span className={'cd-act-dot ' + (ev.tone || '')} /><div className="cd-act-body"><div className="cd-act-t">{ev.t}</div><div className="cd-muted">{fmtDateShort(ev.at)}{ev.at ? ' · ' + hhmm(ev.at) : ''}{ev.who ? ' · ' + ev.who : ''}</div></div></div>
                  ))}</div>
                )}
              </div>
            </div>
          )}
        </>)}
        {invBuilder && d && <InvoiceBuilder customer={d} onClose={() => setInvBuilder(false)} onCreated={(iv) => { setInvBuilder(false); setInvView(iv); loadInvoices(d.id); if (onChanged) onChanged(); }} />}
        {invView && <InvoiceViewer invoice={invView} onClose={() => setInvView(null)} />}
        {printFor && d && <PrintCenter customer={d} userName={userName} mode={printFor.mode} txn={printFor.txn} initial={printFor.initial} onClose={() => setPrintFor(null)} />}
        {legacyOpen && d && <LegacyImportModal customer={d} onClose={() => setLegacyOpen(false)} onDone={(res) => { setLegacyOpen(false); flash(trD('dist.liDone', { n: res.imported, m: res.skipped })); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {payFor && <PaymentModal customers={[payFor]} presetCustomer={payFor.id} staffMode={staffMode} today={new Date().toISOString().slice(0, 10)} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); flash(trD('dist.corrSaved')); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {pnrFor && <PaymentNotReceivedModal customer={pnrFor} today={new Date().toISOString().slice(0, 10)} onClose={() => setPnrFor(null)} onSaved={(res) => { setPnrFor(null); flash(trD('pnr.saved', { amt: rpFull(res.amount), who: res.responsibleName || '' })); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {obFor && <OpeningBonModal customer={obFor} onClose={() => setObFor(null)} onSaved={(res) => { setObFor(null); flash(trD('dist.obSaved', { amt: rpFull(res.amount) })); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {adjustFor && <AdjustModal customer={adjustFor.customer} kind={adjustFor.kind} onClose={() => setAdjustFor(null)} onSaved={() => { setAdjustFor(null); flash(trD('adj.submitted')); openDetail(d.id); reload(); if (onChanged) onChanged(); }} />}
        {disputeFor && d && <DisputeModal txn={disputeFor.txn} customer={d} onClose={() => setDisputeFor(null)} onSubmit={submitDispute} />}
        {renderForm()}
        {typesModal()}
        {delFor && <DeleteCustomerModal customer={delFor} busy={delBusy} onDeactivate={doDeactivate} onDelete={doDeletePermanent} onClose={() => setDelFor(null)} />}
        {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
      </div>
    );
  }

  // ── LIST ── (redesigned to mirror the customer-detail page)
  // Search + the detailed criteria run SERVER-side (whole dataset); the quick chips, sort and the
  // render window are applied client-side to the returned rows.
  const clDaysSince = (d) => { if (!d) return Infinity; const t = new Date(String(d) + 'T00:00:00'); const ms = Date.now() - t.getTime(); return ms > 0 ? Math.floor(ms / 86400000) : 0; };
  const clFiltered = (custs || []).filter((c) => (
    filter === 'all' ? true
      : filter === 'bon' ? c.sisaBon > 0
      : filter === 'galon' ? (c.gallonsHeld || 0) > 0
      : filter === 'bulk' ? c.type === 'bulk'
      : filter === 'reguler' ? c.type === 'reguler'
      : filter === 'belum' ? c.complete === false : true
  ));
  const clCmp = {
    nama: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'),
    bon: (a, b) => (b.sisaBon || 0) - (a.sisaBon || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'id'),
    last: (a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'id'),
    spend: (a, b) => (b.spend || 0) - (a.spend || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'id'),
  };
  const clSorted = clFiltered.slice().sort(clCmp[clSort] || clCmp.nama);
  const rows = clSorted.slice(0, clVisible);   // the render window (infinite scroll extends it)
  const clSumBon = clFiltered.reduce((s, c) => s + (c.sisaBon || 0), 0);
  const clSumGalon = clFiltered.reduce((s, c) => s + (c.gallonsHeld || 0), 0);
  const incompleteN = (custs || []).filter((c) => c.complete === false).length;
  const chips = [['all', trD('dist.fAll')], ['bon', trD('dist.filterBon')], ['galon', trD('cl.chipGalon')], ['reguler', trD('dist.filterReg')], ['bulk', trD('dist.filterBulk')], ['belum', trD('dist.filterIncomplete') + (incompleteN ? ' (' + incompleteN + ')' : '')]];
  const sortOpts = [['nama', trD('cl.sortName')], ['bon', trD('cl.sortBon')], ['last', trD('cl.sortLast')], ['spend', trD('cl.sortSpend')]];
  const effView = isNarrow ? 'kartu' : clView;
  const waHref = (c) => { const n = String(c.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '62'); return n ? 'https://wa.me/' + n : ''; };
  const listState = custs === null ? (loadErr ? 'error' : 'loading') : (rows.length === 0 ? (filterIsEmpty(flt) && filter === 'all' && !q ? 'empty' : 'nofilter') : 'ready');
  const inactiveHint = (c) => c.active !== false && clDaysSince(c.lastDate) >= 30;
  return (
    <div className="dist-dash screen-enter">
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-tx-toolbar cl-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.searchCust')} onChange={(e) => setQ(e.target.value)} /></div>
        <button type="button" className={`btn btn-ghost dist-filter-btn ${!filterIsEmpty(flt) ? 'on' : ''}`} onClick={() => setFltOpen(true)}>
          <IconFilter s={15} />{trD('dist.filter')}{filterCount(flt) ? <span className="dist-filter-n">{filterCount(flt)}</span> : null}
        </button>
        <div className="dist-chips">{chips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {canDelete && (
          <div className="dist-chips dist-status-chips">
            <button type="button" className={`dist-chip ${statusFilter === 'active' ? 'on' : ''}`} onClick={() => setStatusFilter('active')}>{trD('dist.stActive')}</button>
            <button type="button" className={`dist-chip ${statusFilter === 'inactive' ? 'on' : ''}`} onClick={() => setStatusFilter('inactive')}>{trD('dist.stInactive')}</button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <label className="cl-sort"><span className="cl-sort-lbl">{trD('cl.sortBy')}</span>
          <select value={clSort} onChange={(e) => setClSort(e.target.value)}>{sortOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <div className="cl-viewtoggle" role="group" aria-label={trD('cl.view')}>
          <button type="button" className={clView === 'table' ? 'on' : ''} onClick={() => setClView('table')} title={trD('cl.viewTable')} aria-pressed={clView === 'table'}><IconList s={15} /></button>
          <button type="button" className={clView === 'kartu' ? 'on' : ''} onClick={() => setClView('kartu')} title={trD('cl.viewCards')} aria-pressed={clView === 'kartu'}><IconGrid s={15} /></button>
        </div>
        <button type="button" className="btn btn-ghost" disabled={!clFiltered.length} onClick={exportCustCsv}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('cl.csv')}</button>
        {(canCustomers || canCustImport) ? (
          <div className="dist-cust-actions">
            {canCustomers && <button type="button" className="btn btn-ghost" onClick={() => setTypesOpen(true)}><IconSettings s={15} />{trD('dist.kelolaTipe')}</button>}
            {/* Bulk spreadsheet import is a SEPARATE capability from add/edit. */}
            {canCustImport && <button type="button" className="btn btn-ghost" onClick={() => setImpOpen(true)}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.import')}</button>}
            {canCustomers && <button type="button" className="btn btn-primary" onClick={openAdd}><IconPlus s={16} />{trD('dist.addCust')}</button>}
          </div>
        ) : <div className="dist-lockbtn"><IconLock s={14} />{trD('dist.addOwner')}</div>}
      </div>

      {/* Active criteria as removable chips + the result count, so what's being applied is
          always visible (a filter you can't see is a filter you forget you set). */}
      {(!filterIsEmpty(flt) || custs !== null) && (
        <div className="dist-filter-bar">
          {activeFilterChips(flt, setFlt, typeMap).map((ch) => (
            <button key={ch.key} type="button" className="dist-fchip" onClick={ch.clear} title={trD('dist.fRemove')}>
              {ch.label}<IconClose s={12} />
            </button>
          ))}
          {!filterIsEmpty(flt) && <button type="button" className="dist-link" onClick={() => setFlt(EMPTY_FILTER)}>{trD('dist.fReset')}</button>}
          <div style={{ flex: 1 }} />
          {custs !== null && (
            <span className="dist-filter-count">
              {fTotal != null ? trD('dist.fShowing', { n: clFiltered.length, total: fTotal }) : trD('dist.fShowingN', { n: clFiltered.length })}
            </span>
          )}
        </div>
      )}

      {/* Summary bar — always reflects the CURRENT filter (client chips + server criteria). */}
      {custs !== null && (
        <div className="cl-summary">
          <div className="cl-sumcard"><span className="cl-sumlbl">{trD('cl.sumCount')}</span><span className="cl-sumval">{numX(clFiltered.length)}</span></div>
          <div className="cl-sumcard"><span className="cl-sumlbl">{trD('cl.sumBon')}</span><span className={`cl-sumval ${clSumBon > 0 ? 'amber' : ''}`}>{rpFull(clSumBon)}</span></div>
          <div className="cl-sumcard"><span className="cl-sumlbl">{trD('cl.sumGalon')}</span><span className="cl-sumval">{numX(clSumGalon)} {trD('dist.galonUnit')}</span></div>
        </div>
      )}

      {fltOpen && (
        <CustomerFilterPanel
          value={flt} types={types} onApply={(v) => { setFlt(v); setFltOpen(false); }} onClose={() => setFltOpen(false)}
        />
      )}

      {listState === 'loading' && (
        <div className="card dist-card cl-listcard"><div className="cl-skel">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="cl-skel-row"><span className="cl-skel-av" /><span className="cl-skel-lines"><span /><span /></span><span className="cl-skel-amt" /></div>)}</div></div>
      )}
      {listState === 'error' && (
        <div className="card dist-card cl-listcard"><div className="dist-empty dist-load-err"><span>{loadErr}</span><button type="button" className="btn btn-ghost dist-retry" onClick={retry}><IconRefresh s={15} />{trD('common.retry')}</button></div></div>
      )}
      {listState === 'nofilter' && (
        <div className="card dist-card cl-listcard"><div className="cl-emptybox"><IconSearch s={26} /><div className="cl-empty-t">{trD('dist.noResultFilter')}</div><button type="button" className="dist-link" onClick={() => { setFilter('all'); setQ(''); setFlt(EMPTY_FILTER); }}>{trD('dist.clearFilter')}</button></div></div>
      )}
      {listState === 'empty' && (
        <div className="card dist-card cl-listcard"><div className="cl-emptybox"><IconHome s={26} /><div className="cl-empty-t">{trD('cl.emptyTitle')}</div>{(canCustomers || canCustImport) && <div className="cl-empty-actions">{canCustomers && <button type="button" className="btn btn-primary" onClick={openAdd}><IconPlus s={16} />{trD('dist.addCust')}</button>}{canCustImport && <button type="button" className="btn btn-ghost" onClick={() => setImpOpen(true)}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.import')}</button>}</div>}</div></div>
      )}

      {listState === 'ready' && effView === 'table' && (
        <div className="card dist-card cl-listcard cl-tablewrap">
          <table className="cl-table">
            <thead><tr>
              <th>{trD('cl.colCode')}</th><th>{trD('cl.colName')}</th><th>{trD('cl.colType')}</th><th>{trD('cl.colArmada')}</th>
              <th>{trD('cl.colDays')}</th><th className="num">{trD('cl.colBon')}</th><th className="num">{trD('cl.colGalon')}</th><th>{trD('cl.colLast')}</th><th aria-label="aksi" />
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={`cl-trow ${c.active === false ? 'is-inactive' : ''}`} onClick={() => openDetailKeepScroll(c.id)}>
                  <td className="cl-td-code">{c.code ? <span className="dist-code">{c.code}</span> : '—'}</td>
                  <td className="cl-td-name">
                    <div className="cl-name">{c.name}{c.active === false && <span className="dist-inactive-badge"><IconClose s={10} />{trD('dist.inactive')}</span>}</div>
                    <div className="cl-sub">{c.phone || '—'}{inactiveHint(c) && <span className="cl-idle">· {trD('cl.idle30')}</span>}</div>
                  </td>
                  <td>{tag(c.type)}</td>
                  <td>{c.armada ? <span className={isActiveArmada(c.armada) ? 'cl-armada' : 'cl-armada inactive'}><IconTruck s={12} />{armadaFull(c.armada)}</span> : <span className="cl-muted">—</span>}</td>
                  <td>{fmtDays(c.deliveryDays) || <span className="cl-muted">—</span>}</td>
                  <td className="num">{c.sisaBon > 0 ? <span className="dist-bonpill">{rpFull(c.sisaBon)}</span> : <span className="dist-bonmuted">{trD('dist.lunas')}</span>}</td>
                  <td className="num">{(c.gallonsHeld || 0) > 0 ? <b>{numX(c.gallonsHeld)}</b> : <span className="cl-muted">0</span>}</td>
                  <td>{c.lastDate ? <span title={c.lastDate}>{fmtDateShort(c.lastDate)}</span> : <span className="cl-muted">{trD('cl.never')}</span>}</td>
                  <td className="cl-td-act">
                    {canDelete && c.active === false
                      ? <button type="button" className="btn btn-ghost btn-sm dist-reactivate" onClick={(e) => { e.stopPropagation(); doReactivate(c); }}><IconRefresh s={14} />{trD('dist.reactivate')}</button>
                      : <IconCaret s={16} style={{ transform: 'rotate(-90deg)', color: 'var(--text-faint)' }} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={clSentinel} className="cl-sentinel" />
          {clVisible < clFiltered.length && <div className="cl-more">{trD('cl.showingWindow', { n: rows.length, total: clFiltered.length })}</div>}
        </div>
      )}

      {listState === 'ready' && effView === 'kartu' && (
        <div className="cl-cards">
          {rows.map((c) => (
            <div key={c.id} className={`cl-card ${c.active === false ? 'is-inactive' : ''}`} onClick={() => openDetailKeepScroll(c.id)}>
              <div className="cl-card-top">
                <span className="dist-txn-av">{initialsOf(c.name)}</span>
                <div className="cl-card-id">
                  {c.code && <span className="dist-code">{c.code}</span>}
                  <div className="cl-card-name" title={c.name}>{c.name}</div>
                  <div className="cl-card-tags">{tag(c.type)}{c.active === false && <span className="dist-inactive-badge"><IconClose s={10} />{trD('dist.inactive')}</span>}</div>
                </div>
                <div className="cl-card-bon">
                  {c.sisaBon > 0 ? <span className="dist-bonpill">{rpFull(c.sisaBon)}</span> : <span className="dist-bonmuted">{trD('dist.lunas')}</span>}
                  <span className="cl-card-bonlbl">{trD('cl.colBon')}</span>
                </div>
              </div>
              <div className="cl-card-meta">
                <span>{c.phone || '—'}</span>
                {(c.gallonsHeld || 0) > 0 && <span><IconHome s={11} />{numX(c.gallonsHeld)} {trD('dist.galonUnit')}</span>}
                <span className={inactiveHint(c) ? 'cl-idle' : 'cl-muted'}>{c.lastDate ? fmtDateShort(c.lastDate) : trD('cl.never')}{inactiveHint(c) ? ' · ' + trD('cl.idle30') : ''}</span>
              </div>
              <div className="cl-card-actions" onClick={(e) => e.stopPropagation()}>
                {waHref(c) ? <a className="cl-qa" href={waHref(c)} target="_blank" rel="noopener noreferrer"><IconWhatsApp s={15} />WA</a> : <span className="cl-qa disabled"><IconWhatsApp s={15} />WA</span>}
                {c.mapsUrl ? <a className="cl-qa" href={c.mapsUrl} target="_blank" rel="noopener noreferrer"><IconPin s={15} />Maps</a> : <span className="cl-qa disabled"><IconPin s={15} />Maps</span>}
                <button type="button" className="cl-qa primary" onClick={() => openDetailKeepScroll(c.id)}><IconCaret s={14} style={{ transform: 'rotate(-90deg)' }} />{trD('cd.more')}</button>
                {canDelete && c.active === false && <button type="button" className="cl-qa" onClick={(e) => { e.stopPropagation(); doReactivate(c); }}><IconRefresh s={14} />{trD('dist.reactivate')}</button>}
              </div>
            </div>
          ))}
          <div ref={clSentinel} className="cl-sentinel" />
          {clVisible < clFiltered.length && <div className="cl-more">{trD('cl.showingWindow', { n: rows.length, total: clFiltered.length })}</div>}
        </div>
      )}

      {renderForm()}
      {typesModal()}
      {delFor && <DeleteCustomerModal customer={delFor} busy={delBusy} onDeactivate={doDeactivate} onDelete={doDeletePermanent} onClose={() => setDelFor(null)} />}

      {impOpen && (
        <div className="modal-scrim" onClick={() => setImpOpen(false)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.importT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.importSub')}</div></div><button className="jp-icon" onClick={() => setImpOpen(false)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-imp-fmt"><span>{trD('dist.importFmt')}: <b>Nama · No HP · Tipe · Harga · Hari Kirim · Armada · Alamat · Maps</b></span><button type="button" className="dist-link" onClick={downloadImportTemplate}><IconDownload s={13} />{trD('dist.importTemplate')}</button></div>
              <div className="dist-hint" style={{ marginBottom: 8 }}>{trD('dist.importXlsxOk')}</div>
              {/* Excel drops the leading 0 from phone columns — we repair it, so nobody has to reformat. */}
              <div className="dist-infobox" style={{ marginBottom: 10 }}><IconCheck s={16} /><span>{trD('dist.impPhoneNote')}</span></div>
              <div className="dist-imp-upload">
                <input ref={impFileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} onChange={onImpFile} />
                <button type="button" className="btn btn-ghost" onClick={() => impFileRef.current && impFileRef.current.click()}><IconDownload s={15} style={{ transform: 'rotate(180deg)' }} />{trD('dist.importPick')}</button>
                {impFileBusy ? <span className="dist-imp-fname"><span className="ui-attach-spin" />{trD('dist.importReading')}</span>
                  : impFileRows ? <span className="dist-imp-fname"><IconCheck s={13} />{impFileName}<button type="button" className="dist-link" onClick={resetImport} style={{ marginLeft: 8 }}>{trD('dist.importClear')}</button></span>
                  : <span className="dist-imp-or">{trD('dist.importOr')} <button type="button" className="dist-link" onClick={() => setImpText(impSample)}>{trD('dist.importSample')}</button></span>}
              </div>
              {impFileErr && <div className="add-err" style={{ margin: '4px 0 8px' }}><IconClose s={14} />{impFileErr}</div>}
              {!impFileRows && !impFileBusy && <textarea className="fld dist-imp-ta" value={impText} placeholder={'Warung Sejahtera\t0821-1122-3344\tReguler\t12500'} onChange={(e) => setImpText(e.target.value)} />}
              {impRows.length > 0 && (<>
                {/* Summary — tappable when there are skips, jumping straight to the Dilewati filter. */}
                <div className={`dist-imp-summary ${impSkipped.length ? 'has-skip' : ''}`} onClick={() => impSkipped.length && setImpFilter('skip')}>
                  <b>{impValid.length}</b> {trD('dist.importReady')}
                  {impSkipped.length > 0 && <> · <b>{impSkipped.length}</b> {trD('dist.importSkip')} <span className="dist-imp-sumbreak">({trD('dist.importSumBreak', { d: impNDup, k: impNKurang })})</span></>}
                </div>
                {/* Status filter chips — "Dilewati" is always one tap away; when both kinds exist it
                    splits into Data kurang / Duplikat so each problem is isolated. */}
                <div className="dist-imp-chips">
                  {[['all', trD('dist.importChipAll'), impRows.length], ['ok', trD('dist.importChipReady'), impValid.length], ['skip', trD('dist.importChipSkip'), impSkipped.length]]
                    .concat(impNDup > 0 && impNKurang > 0 ? [['kurang', trD('dist.importChipMissing'), impNKurang], ['dup', trD('dist.importChipDup'), impNDup]] : [])
                    .map(([k, label, n]) => <button key={k} type="button" className={`dist-imp-chip ${impFilter === k ? 'on' : ''} ${k !== 'all' && k !== 'ok' ? 'skip' : ''}`} onClick={() => setImpFilter(k)}>{label} <span className="dist-imp-chipn">{n}</span></button>)}
                  {impSkipped.length > 0 && <button type="button" className="dist-link dist-imp-dl" onClick={downloadSkipped}><IconDownload s={13} />{trD('dist.importDlSkipped')}</button>}
                </div>
                <div className="dist-imp-preview">
                  <div className="dist-imp-hrow c9"><span>#</span><span>Nama</span><span>No HP</span><span>Tipe</span><span>Harga</span><span>Armada</span><span>{trD('dist.importColDays')}</span><span>Status</span></div>
                  {impShown.length === 0 && <div className="dist-imp-empty">{trD('dist.importNoneInFilter')}</div>}
                  {impShown.map((r, i) => (
                    <div key={i} className={`dist-imp-row c9 ${r.status}`}>
                      <span className="dist-imp-srcn">{r.srcRow}</span>
                      <span className="dist-imp-name">{r.name}</span>
                      <span>{r.phone}{r.phoneFixed && <span className="dist-phone-fixed" title={trD('dist.impPhoneFixedT')}>{trD('dist.impPhoneFixed')}</span>}</span>
                      <span>{typeLabel(r.type)}</span><span>{r.price ? rpFull(r.price) : '—'}</span>
                      <span>{r.armada || '—'}</span>
                      <span>{r.days.length ? r.days.join(', ') : '—'}</span>
                      <span className="dist-imp-statuscell">
                        <span className={`dist-imp-status ${r.status}`}>{r.status === 'ok' ? trD('dist.impReady') : r.status === 'kurang' ? trD('dist.impMissing') : trD('dist.impDup')}</span>
                        {r.reason && <span className="dist-imp-reason" title={r.reason}>{r.reason}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </>)}
              <div className="dist-hint" style={{ marginTop: 10 }}><IconLock s={12} /> {trD('dist.importLockNote')}</div>
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setImpOpen(false)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={!impValid.length || impSaving} onClick={commitImport}>{impSaving ? '…' : trD('dist.importBtn', { n: impValid.length })}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ KELOLA TIPE PELANGGAN (editable dictionary) ════════════════
// Add / rename / delete customer types. Deleting a type still used by customers is
// blocked until they are reassigned — the modal shows the count and a "move to" picker.
function CustomerTypesModal({ types, custs, onReload, onClose }) {
  const [newLabel, setNewLabel] = uSx('');
  const [busy, setBusy] = uSx('');
  const [editId, setEditId] = uSx(null);
  const [editLabel, setEditLabel] = uSx('');
  const [delType, setDelType] = uSx(null);   // type pending delete (in use)
  const [reassign, setReassign] = uSx('');
  const [err, setErr] = uSx('');
  const usage = {}; (custs || []).forEach((c) => { usage[c.type] = (usage[c.type] || 0) + 1; });
  const onErr = (e) => { setBusy(''); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); };

  const add = () => { const l = newLabel.trim(); if (!l || busy) return; setBusy('add'); setErr('');
    window.API.distribusi.types.create(l).then(() => { setBusy(''); setNewLabel(''); onReload(); }).catch(onErr); };
  const saveRename = (id) => { const l = editLabel.trim(); if (!l || busy) return; setBusy(id); setErr('');
    window.API.distribusi.types.rename(id, l).then(() => { setBusy(''); setEditId(null); onReload(); }).catch(onErr); };
  const askDelete = (t) => { setErr(''); if ((usage[t.id] || 0) > 0) { setDelType(t); setReassign(''); } else { doDelete(t.id, null); } };
  const doDelete = (id, to) => { if (busy) return; setBusy('del'); setErr('');
    window.API.distribusi.types.remove(id, to).then(() => { setBusy(''); setDelType(null); onReload(); }).catch(onErr); };

  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 210 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.kelolaTipeT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.kelolaTipeSub')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-type-add">
            <input className="fld" value={newLabel} placeholder={trD('dist.tipeNamePh')} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" className="btn btn-primary" disabled={!newLabel.trim() || busy === 'add'} onClick={add}><IconPlus s={15} />{trD('dist.tambah')}</button>
          </div>
          {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
          <div className="dist-type-list">
            {types.map((t) => {
              const inUse = usage[t.id] || 0;
              if (delType && delType.id === t.id) {
                const opts = types.filter((x) => x.id !== t.id).map((x) => ({ value: x.id, label: x.label }));
                return (
                  <div key={t.id} className="dist-type-row del">
                    <div className="dist-type-delnote"><IconInvoice s={14} />{trD('dist.tipeInUse', { n: inUse })}</div>
                    <div className="dist-type-delrow">
                      <UI.Dropdown value={reassign} options={[{ value: '', label: trD('dist.pilihTipeTujuan') }, ...opts]} onChange={setReassign} fluid />
                      <button type="button" className="btn btn-ghost" onClick={() => setDelType(null)}>{trD('dist.cancel')}</button>
                      <button type="button" className="btn btn-primary" disabled={!reassign || busy === 'del'} onClick={() => doDelete(t.id, reassign)}>{busy === 'del' ? '…' : trD('dist.pindahHapus')}</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={t.id} className="dist-type-row">
                  {editId === t.id ? (
                    <input className="fld dist-type-edit" autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(t.id); if (e.key === 'Escape') setEditId(null); }} />
                  ) : (
                    <div className="dist-type-name"><span className={`dist-ctag ${CUST_TAG[t.id] || 'other'}`}>{t.label}</span>{inUse > 0 && <span className="dist-type-count">{trD('dist.tipeCount', { n: inUse })}</span>}</div>
                  )}
                  <div className="dist-type-actions">
                    {editId === t.id ? (<>
                      <button type="button" className="icon-btn" title={trD('dist.simpan')} disabled={!editLabel.trim()} onClick={() => saveRename(t.id)}><IconCheck s={15} /></button>
                      <button type="button" className="icon-btn" title={trD('dist.cancel')} onClick={() => setEditId(null)}><IconClose s={15} /></button>
                    </>) : (<>
                      <button type="button" className="icon-btn" title={trD('dist.ubah')} onClick={() => { setEditId(t.id); setEditLabel(t.label); setErr(''); }}><IconPencil s={14} /></button>
                      <button type="button" className="icon-btn del" title={trD('dist.hapus')} onClick={() => askDelete(t)}><IconBackspace s={15} /></button>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dist-hint" style={{ marginTop: 10 }}><IconInvoice s={12} /> {trD('dist.kelolaTipeNote')}</div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.tutup')}</button></div>
      </div>
    </div>
  );
}

// ════════════════ HARGA MASTER (owner only) ════════════════
function DistLocked() {
  return (
    <div className="dist-dash screen-enter">
      <div className="card dist-lockedpanel">
        <span className="dist-lockedpanel-ic"><IconLock s={26} /></span>
        <div className="dist-lockedpanel-t">{trD('dist.lockedStaff')}</div>
        <div className="dist-lockedpanel-s">{trD('dist.lockedStaffSub')}</div>
      </div>
    </div>
  );
}

// Modal shown when applying a new master price: choose (a) new-only or (b) retroactive,
// with a scope + a live "N transaksi · total selisih Rp X" summary before confirming.
function PriceChangeModal({ customer, newPrice, onDone, onClose }) {
  const [preview, setPreview] = uSx(null);
  const [mode, setMode] = uSx('new');     // 'new' | 'retro'
  const [scope, setScope] = uSx('all');   // 'all' | 'cycle' | 'bon'
  const [busy, setBusy] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { let live = true; window.API.distribusi.customers.pricePreview(customer.id, newPrice).then((r) => { if (live) setPreview(r.data); }).catch(() => {}); return () => { live = false; }; }, [customer.id, newPrice]);
  const sc = preview && preview.scopes ? preview.scopes[scope] : null;
  const commit = () => {
    if (busy) return; setBusy(true); setErr('');
    window.API.distribusi.customers.setPrice(customer.id, newPrice, mode === 'retro' ? scope : null)
      .then((r) => { setBusy(false); onDone(r.data); })
      .catch((e) => { setBusy(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const scopeRow = (key, label, hint) => (
    <label key={key} className={`dist-pc-scope ${scope === key ? 'on' : ''}`}>
      <input type="radio" name="pcscope" checked={scope === key} onChange={() => setScope(key)} />
      <div className="dist-pc-txt"><b>{label}</b><span>{hint}</span></div>
      {preview && <span className="dist-pc-count">{preview.scopes[key].count}</span>}
    </label>
  );
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 220 }}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.pcTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{customer.name} · {rpFull(customer.masterPrice)} → <b>{rpFull(newPrice)}</b></div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className={`dist-pc-opt ${mode === 'new' ? 'on' : ''}`}><input type="radio" name="pcmode" checked={mode === 'new'} onChange={() => setMode('new')} /><div className="dist-pc-txt"><b>{trD('dist.pcNewOnly')}</b><span>{trD('dist.pcNewOnlyHint')}</span></div></label>
          <label className={`dist-pc-opt ${mode === 'retro' ? 'on' : ''}`}><input type="radio" name="pcmode" checked={mode === 'retro'} onChange={() => setMode('retro')} /><div className="dist-pc-txt"><b>{trD('dist.pcRetro')}</b><span>{trD('dist.pcRetroHint')}</span></div></label>
          {mode === 'retro' && (
            <div className="dist-pc-scopes">
              {scopeRow('all', trD('dist.pcScopeAll'), trD('dist.pcScopeAllHint'))}
              {scopeRow('cycle', trD('dist.pcScopeCycle'), preview ? preview.cycle.start + ' – ' + preview.cycle.end : trD('dist.pcScopeCycleHint'))}
              {scopeRow('bon', trD('dist.pcScopeBon'), trD('dist.pcScopeBonHint'))}
              <div className="dist-pc-summary"><IconInvoice s={14} />{sc ? trD('dist.pcSummary', { n: sc.count, d: rpFull(sc.totalDelta) }) : (trD('common.loading') || '…')}</div>
            </div>
          )}
          {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={commit}>{busy ? '…' : trD('dist.pcConfirm')}</button></div>
      </div>
    </div>
  );
}

function DistPrices({ canPrice, refreshKey, onChanged }) {
  const [custs, setCusts] = uSx(null);
  const [drafts, setDrafts] = uSx({});
  const [pcModal, setPcModal] = uSx(null);   // { customer, newPrice }
  const [toast, setToast] = uSx('');
  const reload = () => window.API.distribusi.customers.list().then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  uEx(() => { if (canPrice && window.API && window.API.distribusi) reload(); }, [refreshKey, canPrice]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  if (!canPrice) return <DistLocked />;

  const tag = (t) => <span className={`dist-ctag ${CUST_TAG[t] || 'other'}`}>{typeLabel(t)}</span>;
  const apply = (c) => {
    const num = parseInt(String(drafts[c.id] || '').replace(/[^0-9]/g, ''), 10);
    if (!num || num === c.masterPrice) return;
    setPcModal({ customer: c, newPrice: num });   // open the options modal
  };
  const onApplied = (cust, data) => {
    setPcModal(null);
    setDrafts((d) => ({ ...d, [cust.id]: '' }));
    flash(data && data.affected ? trD('dist.pcAppliedRetro', { n: data.affected }) : trD('dist.hargaUpdated', { n: cust.name }));
    reload(); if (onChanged) onChanged();
  };

  return (
    <div className="dist-dash screen-enter">
      <div className="dist-warnbanner">
        <IconInvoice s={18} />
        <div><b>{trD('dist.hargaBannerT')}</b> {trD('dist.hargaBannerS')}</div>
      </div>
      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        <div className="dist-harga-hrow"><span>{trD('dist.fCust')}</span><span>{trD('dist.hargaBerlaku')}</span><span>{trD('dist.hargaBaru')}</span><span /></div>
        {custs === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {custs !== null && custs.length === 0 && <div className="dist-empty">{trD('dist.noCust')}</div>}
        {(custs || []).map((c) => {
          const draft = drafts[c.id] || '';
          const num = parseInt(String(draft).replace(/[^0-9]/g, ''), 10);
          const ready = !!num && num !== c.masterPrice;
          return (
            <div key={c.id} className="dist-harga-row">
              <div className="dist-harga-cust"><span className="dist-txn-av sm">{initialsOf(c.name)}</span><div style={{ minWidth: 0 }}><div className="dist-txn-name">{c.name}</div>{tag(c.type)}</div></div>
              <div className="dist-harga-cur">{rpFull(c.masterPrice)} <IconLock s={11} /></div>
              <div className="dist-harga-new"><input className="fld" value={draft} inputMode="numeric" placeholder={rpFull(c.masterPrice)} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))} onKeyDown={(e) => { if (e.key === 'Enter' && ready) apply(c); }} /></div>
              <button type="button" className="btn btn-ghost dist-harga-apply" disabled={!ready} onClick={() => apply(c)}>{trD('dist.terapkan')}</button>
            </div>
          );
        })}
      </div>
      <div className="dist-hint" style={{ marginTop: 8 }}><IconLock s={12} /> {trD('dist.hargaFootNote')}</div>
      {pcModal && <PriceChangeModal customer={pcModal.customer} newPrice={pcModal.newPrice} onDone={(data) => onApplied(pcModal.customer, data)} onClose={() => setPcModal(null)} />}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ LOG AUDIT (owner only, immutable timeline) ════════════════
function DistAudit({ canAudit, refreshKey }) {
  const [rows, setRows] = uSx(null);
  const [kind, setKind] = uSx('all');
  const [q, setQ] = uSx('');
  const reload = () => window.API.distribusi.audit('limit=500').then((r) => setRows(r.data || [])).catch(() => setRows([]));
  uEx(() => { if (canAudit && window.API && window.API.distribusi) reload(); }, [refreshKey, canAudit]);
  if (!canAudit) return <DistLocked />;

  const kindChips = [['all', trD('dist.fAll')], ['koreksi', trD('dist.akKoreksi')], ['harga', trD('dist.akHarga')], ['input', trD('dist.akInput')], ['impor', trD('dist.akImpor')], ['pelanggan', trD('dist.akPelanggan')], ['akses', trD('dist.akAkses')]];
  const filtered = (rows || []).filter((a) => {
    if (kind !== 'all' && a.kind !== kind) return false;
    if (q && !((a.title || '') + (a.detail || '') + (a.actorName || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-tx-toolbar">
        <div className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('dist.auditSearch')} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="dist-chips">{kindChips.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        <span className="dist-immutable"><IconLock s={13} />{trD('dist.immutable')}</span>
      </div>
      <div className="card dist-card" style={{ padding: '10px 22px' }}>
        {rows === null && <div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div>}
        {rows !== null && filtered.length === 0 && <div className="dist-empty">{trD('dist.noAudit')}</div>}
        {filtered.map((a) => {
          const m = AUDIT_KIND[a.kind] || AUDIT_KIND.input;
          return (
            <div key={a.id} className="dist-audit-row">
              <div className="dist-audit-rail"><span className="dist-audit-dot" /></div>
              <div className="dist-audit-body">
                <div className="dist-audit-head">
                  <span className={`dist-akind ${m.cls}`}>{trD(m.k)}</span>
                  <span className="dist-audit-title">{a.title}</span>
                  {a.actorStaff ? <span className="dist-audit-staff">{trD('dist.olehStaff')}</span> : null}
                </div>
                {a.detail ? <div className="dist-audit-detail">{a.detail}</div> : null}
                <div className="dist-audit-meta"><span className={a.actorStaff ? 'staff' : ''}>{a.actorName || a.actorRole || '—'}</span><span>{fmtDT(a.createdAt)}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════ INTEGRASI KAS (cash-flow mirror — read-only) ════════════════
// Distribusi is deliberately SEPARATE from the AirRO cash book: nothing here posts
// into the Entry/cash-flow tables. This screen is the bridge VIEW — for a chosen
// period it maps distribusi activity onto cash-book terms so the owner can see (and
// hand-copy) what really became cash:
//   • Lunas + Pelunasan → Uang Masuk (cash-book income)
//   • Bon               → Piutang (receivable, not cash yet)
//   • Koreksi + Harga   → Penyesuaian (adjustment / audit note)
// It never double-posts — that separation is the whole point.
function DistIntegration({ refreshKey, today }) {
  const [period, setPeriod] = uSx('month');
  const [txns, setTxns] = uSx(null);
  const [audit, setAudit] = uSx([]);
  const [custs, setCusts] = uSx([]);
  const [expenses, setExpenses] = uSx([]);
  const [toast, setToast] = uSx('');
  const range = periodRange(period, today);

  uEx(() => {
    if (!(window.API && window.API.distribusi)) { setTxns([]); return; }
    let live = true; setTxns(null);
    // One gated read (distribusiCashIntegrasi) returns everything the view composes:
    // transactions in range + customers (outstanding bon) + adjustment audit + field expenses.
    window.API.distribusi.cashIntegration('dateFrom=' + range.from + '&dateTo=' + range.to)
      .then((r) => { if (!live) return; const d = (r && r.data) || {}; setTxns(d.transactions || []); setAudit(d.audit || []); setCusts(d.customers || []); setExpenses(d.expenses || []); })
      .catch(() => { if (live) { setTxns([]); setAudit([]); setCusts([]); setExpenses([]); } });
    return () => { live = false; };
  }, [refreshKey, period]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const rows = txns || [];
  let lunas = 0, pelunasan = 0, bon = 0, qty = 0;
  const cnt = { lunas: 0, pelunasan: 0, bon: 0 };
  // Use the EFFECTIVE amount so retroactive price adjustments flow into the cash mirror.
  const effOf = (t) => (t.effectiveAmount != null ? t.effectiveAmount : (t.amount + (t.adjustAmount || 0)));
  rows.forEach((t) => {
    qty += t.qty; const e = effOf(t);
    if (t.method === 'bon') { bon += e; cnt.bon++; }
    else if (t.method === 'pelunasan') { pelunasan += e; cnt.pelunasan++; }
    else { lunas += e; cnt.lunas++; }
  });
  const masukKas = lunas + pelunasan;
  // Field expenses (pengeluaran lapangan) — an INFORMATIONAL line only. This bridge never posts to
  // the cash book, so it can't double-count the separate Setoran.expense number. Shown so the owner
  // sees field cash-out mapped to cash-book terms; the NET cash-in = masukKas − field expenses.
  const fieldExpense = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
  const masukBersih = masukKas - fieldExpense;
  const adjRows = (audit || []).filter((a) => { if (a.kind !== 'koreksi' && a.kind !== 'harga') return false; const d = isoDay(a.createdAt); return d >= range.from && d <= range.to; });
  const koreksiN = adjRows.filter((a) => a.kind === 'koreksi').length;
  const hargaN = adjRows.filter((a) => a.kind === 'harga').length;
  const adjN = koreksiN + hargaN;
  const piutangBerjalan = (custs || []).reduce((s, c) => s + (c.sisaBon || 0), 0);
  const empty = rows.length === 0 && adjN === 0 && fieldExpense === 0;

  const copySummary = () => {
    const lines = [
      trD('nav.distIntegration') + ' — ' + range.from + ' → ' + range.to,
      trD('dist.integLineLunas') + ': ' + rpFull(lunas),
      trD('dist.integLinePelunasan') + ': ' + rpFull(pelunasan),
      trD('dist.integTotalIn') + ': ' + rpFull(masukKas),
      trD('dist.integLineExpense') + ': ' + rpFull(fieldExpense),
      trD('dist.integNetIn') + ': ' + rpFull(masukBersih),
      trD('dist.integLineBon') + ': ' + rpFull(bon) + ' (' + trD('dist.integBonMemo') + ')',
      trD('dist.integLineAdjust') + ': ' + adjN + ' (' + koreksiN + ' ' + trD('dist.akKoreksi') + ', ' + hargaN + ' ' + trD('dist.akHarga') + ')',
    ];
    copyText(lines.join('\n'), () => flash(trD('dist.integCopied')));
  };

  const periods = [['today', trD('dist.periodToday')], ['week', trD('dist.periodWeek')], ['month', trD('dist.periodMonth')]];
  return (
    <div className="dist-dash screen-enter">
      <div className="dist-integ-banner">
        <span className="dist-integ-flow"><IconTruck s={15} /><IconCaret s={12} style={{ transform: 'rotate(-90deg)' }} /><IconCoinIn s={15} /></span>
        <div><b>{trD('dist.integBannerT')}</b><span>{trD('dist.integBannerS')}</span></div>
      </div>

      <div className="dist-tx-toolbar">
        <div className="dist-chips">{periods.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        <span className="dist-integ-range"><IconCalendar s={13} />{range.from} — {range.to}</span>
        <button type="button" className="btn btn-ghost" disabled={txns === null} onClick={copySummary}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('dist.integCopy')}</button>
      </div>

      {txns === null ? <div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div> : (<>
        <div className="dist-integ-cards">
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: 'var(--pos-bg)', color: 'var(--green-800)' }}>{IcX('IconCoinIn', { s: 18 })}</span><span className="dist-kpi-pill pos">{trD('dist.pillCash')}</span></div>
            <div className="tnum dist-integ-kpi-val amt-pos">{rpFull(masukKas)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integMasukKas')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integMasukKasSub')}</div>
          </div>
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>{IcX('IconInvoice', { s: 18 })}</span><span className="dist-kpi-pill warn">{trD('dist.pillPiutang')}</span></div>
            <div className="tnum dist-integ-kpi-val" style={{ color: 'var(--warn)' }}>{rpFull(bon)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integPiutang')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integPiutangSub')}</div>
          </div>
          <div className="card stat-box dist-integ-kpi">
            <div className="dist-integ-kpi-top"><span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconPencil', { s: 17 })}</span><span className="dist-kpi-pill blue">{numX(adjN)}</span></div>
            <div className="tnum dist-integ-kpi-val">{numX(adjN)}</div>
            <div className="dist-integ-kpi-lbl">{trD('dist.integAdjust')}</div>
            <div className="dist-integ-kpi-sub">{trD('dist.integAdjustSub')}</div>
          </div>
        </div>

        <div className="card dist-integ-ledger">
          <div className="dist-card-head"><div className="sec-title">{trD('dist.integLedger')}</div><span className="dist-badge lock"><IconLock s={10} />{trD('dist.integInfoBadge')}</span></div>
          {empty ? <div className="dist-empty">{trD('dist.integNoData')}</div> : (<>
            <div className="dist-integ-line">
              <span className="dist-integ-line-l"><span className="dist-integ-dot lunas" /><span>{trD('dist.integLineLunas')}</span><small>{numX(cnt.lunas)} {trD('dist.notaWord')}</small></span>
              <b className="tnum amt-pos">+{rpFull(lunas)}</b>
            </div>
            <div className="dist-integ-line">
              <span className="dist-integ-line-l"><span className="dist-integ-dot pelunasan" /><span>{trD('dist.integLinePelunasan')}</span><small>{numX(cnt.pelunasan)} {trD('dist.notaWord')}</small></span>
              <b className="tnum amt-pos">+{rpFull(pelunasan)}</b>
            </div>
            <div className="dist-integ-line total">
              <span className="dist-integ-line-l"><IconCoinIn s={14} /><span>{trD('dist.integTotalIn')}</span></span>
              <b className="tnum amt-pos">{rpFull(masukKas)}</b>
            </div>
            {fieldExpense > 0 && (<>
              <div className="dist-integ-line">
                <span className="dist-integ-line-l"><span className="dist-integ-dot exp" /><span>{trD('dist.integLineExpense')}</span><small>{numX(expenses.length)} {trD('exp.itemWord')}</small></span>
                <b className="tnum amt-neg">−{rpFull(fieldExpense)}</b>
              </div>
              <div className="dist-integ-line total">
                <span className="dist-integ-line-l"><IconWallet s={14} /><span>{trD('dist.integNetIn')}</span></span>
                <b className="tnum amt-pos">{rpFull(masukBersih)}</b>
              </div>
            </>)}
            <div className="dist-integ-line memo">
              <span className="dist-integ-line-l"><span className="dist-integ-dot bon" /><span>{trD('dist.integLineBon')}</span><small>{trD('dist.integBonMemo')}</small></span>
              <b className="tnum" style={{ color: 'var(--warn)' }}>{rpFull(bon)}</b>
            </div>
            <div className="dist-integ-line memo">
              <span className="dist-integ-line-l"><span className="dist-integ-dot adj" /><span>{trD('dist.integLineAdjust')}</span><small>{numX(koreksiN)} {trD('dist.akKoreksi')} · {numX(hargaN)} {trD('dist.akHarga')}</small></span>
              <b className="tnum" style={{ color: 'var(--text-mut)' }}>{numX(adjN)}</b>
            </div>
          </>)}
        </div>

        <div className="dist-integ-foot">
          <div className="card dist-integ-outstanding">
            <div className="dist-integ-out-head"><IconInvoice s={15} /><span>{trD('dist.integOutstanding')}</span></div>
            <div className="tnum dist-integ-out-val">{rpFull(piutangBerjalan)}</div>
            <div className="dist-integ-out-sub">{trD('dist.integOutstandingSub')}</div>
          </div>
          <div className="dist-integ-note"><IconLock s={14} /><span>{trD('dist.integFootNote')}</span></div>
        </div>
      </>)}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ STOK GALON (loan/exchange ledger) ════════════════
// All numbers come from the append-only gallon ledger on the server: stock cards,
// per-customer balances, and the movement ledger. Corrections (never overwrites) are
// appended with a required reason and audited.
const GM_META = {
  purchase: { l: 'dist.gmPurchase', cls: 'purchase', sign: '+' },
  delivery_out: { l: 'dist.gmOut', cls: 'out', sign: '−' },
  return_in: { l: 'dist.gmIn', cls: 'in', sign: '+' },
  correction: { l: 'dist.gmCorr', cls: 'corr', sign: '' },
  opening: { l: 'dist.gmOpening', cls: 'opening', sign: '' },
  damage: { l: 'dist.gmDamage', cls: 'dmg', sign: '−' },
  loss: { l: 'dist.gmLoss', cls: 'dmg', sign: '−' },
};
function DistGallon({ refreshKey, canCustomers, canReset, fleetScope, fleet, distFleet, setDistFleet }) {
  const [data, setData] = uSx(null);
  const [toast, setToast] = uSx('');
  const [corr, setCorr] = uSx(null);   // { customerId, name, qty, reason }
  const [opening, setOpening] = uSx(null);   // opening-stock modal: { qty, reason }
  const [reset, setReset] = uSx(null);   // reset-gallon modal: { mode, fleet, target, reason, confirm }
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => window.API.distribusi.gallon(ef).then((r) => setData(r.data)).catch(() => setData({ stock: {}, opening: {}, balances: [], movements: [] }));
  uEx(() => { if (window.API && window.API.distribusi) reload(); }, [refreshKey, ef]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const commitCorr = () => {
    if (!corr || saving) return;
    const qty = parseInt(String(corr.qty).replace(/[^0-9-]/g, ''), 10);
    if (!qty || !corr.reason.trim()) { setErr(trD('dist.gmCorrErr')); return; }
    setSaving(true); setErr('');
    window.API.distribusi.gallonCorrection({ qty, customerId: corr.customerId || undefined, reason: corr.reason.trim() })
      .then(() => { setSaving(false); setCorr(null); flash(trD('dist.gmCorrSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const op = (data && data.opening) || {};
  const openOpening = () => { setErr(''); setOpening({ qty: op.set ? String(op.total) : '', reason: '' }); };
  const commitOpening = () => {
    if (!opening || saving) return;
    const qty = parseInt(String(opening.qty).replace(/[^0-9]/g, ''), 10);
    if (!(qty >= 0) || !opening.reason.trim()) { setErr(trD('dist.goErr')); return; }
    setSaving(true); setErr('');
    window.API.distribusi.setOpeningStock({ qty, fleet: ef, reason: opening.reason.trim() })
      .then(() => { setSaving(false); setOpening(null); flash(trD('dist.goSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const openReset = () => { setErr(''); setReset({ mode: 'balanced', fleet: (distFleet && distFleet !== 'all') ? distFleet : 'all', target: '0', reason: '', confirm: '' }); };
  const commitReset = () => {
    if (!reset || saving) return;
    if (!reset.reason.trim()) { setErr(trD('dist.grErrReason')); return; }
    if (reset.mode === 'purge' && reset.confirm !== 'RESET') { setErr(trD('dist.grErrConfirm')); return; }
    setSaving(true); setErr('');
    const body = { mode: reset.mode, fleet: reset.fleet || 'all', reason: reset.reason.trim() };
    if (reset.mode === 'balanced') body.target = Math.max(0, parseInt(reset.target || '0', 10) || 0);
    else body.confirm = reset.confirm;
    window.API.distribusi.resetGallon(body)
      .then(() => { setSaving(false); setReset(null); flash(trD('dist.grSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const bar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  if (!data) return <div className="dist-dash screen-enter">{bar}<div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div></div>;
  const st = data.stock || {};
  return (
    <div className="dist-dash screen-enter">
      {bar}
      {canReset && (
        <div className="dist-gm-resetbar">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-danger btn-sm" onClick={openReset}><IconRefresh s={14} />{trD('dist.grBtn')}</button>
        </div>
      )}
      <div className="dist-gm-cards">
        <div className="card stat-box"><span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconDrop', { s: 18 })}</span><div className="tnum dist-gm-val">{numX(st.totalOwned || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmTotal')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>{IcX('IconCustomers', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--warn)' }}>{numX(st.atCustomers || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtCust')}</div></div>
        <div className="card stat-box"><span className="icon-tile" style={{ background: 'var(--pos-bg)', color: 'var(--green-800)' }}>{IcX('IconTruck', { s: 18 })}</span><div className="tnum dist-gm-val" style={{ color: 'var(--green-700)' }}>{numX(st.atDepot || 0)}</div><div className="dist-gm-lbl">{trD('dist.gmAtDepot')}</div></div>
      </div>
      <div className="dist-gm-note"><IconInvoice s={13} /><span>{trD('dist.gmTotalNote')}</span></div>
      <div className="card dist-gm-opening">
        <span className="icon-tile" style={{ background: '#EEF2FF', color: '#5b6ed6' }}>{IcX('IconWallet', { s: 17 })}</span>
        <div className="dist-gm-opening-main">
          <div className="dist-gm-opening-lbl">{trD('dist.gmOpeningTitle')}</div>
          {op.set
            ? <div className="dist-gm-opening-sub">{trD('dist.gmOpeningSet', { d: fmtDT(op.setAt), who: op.setByName || '—' })}{op.adjustCount > 0 ? ' · ' + trD('dist.gmOpeningAdj', { n: op.adjustCount, d: fmtDT(op.lastAt) }) : ''}</div>
            : <div className="dist-gm-opening-sub">{trD('dist.gmOpeningNone')}</div>}
        </div>
        <div className="tnum dist-gm-opening-val">{numX(op.total || 0)}</div>
        {canCustomers && <button type="button" className="btn btn-ghost btn-sm" onClick={openOpening}><IconPencil s={14} />{op.set ? trD('dist.gmOpeningAdjust') : trD('dist.gmOpeningBtn')}</button>}
      </div>
      <div className="dist-cd-cols">
        <div className="card dist-card dist-gm-balcard">
          <div className="dist-card-head"><div className="sec-title">{trD('dist.gmBalances')}</div>{canCustomers && <button type="button" className="dist-link" onClick={() => { setErr(''); setCorr({ customerId: '', name: '', qty: '', reason: '' }); }}>{trD('dist.gmCorrectDepot')}</button>}</div>
          {(data.balances || []).length === 0 && <div className="dist-empty">{trD('dist.gmNoBal')}</div>}
          {(data.balances || []).map((b) => (
            <div key={b.customerId} className="dist-gm-bal">
              <span className="dist-txn-av sm">{initialsOf(b.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div className="dist-txn-name">{b.name}</div>{b.armada ? <div className="dist-txn-sub">{b.armada}</div> : null}</div>
              <b className="tnum dist-gm-held">{numX(b.held)}</b>
              {canCustomers && <button type="button" className="icon-btn" title={trD('dist.gmCorrect')} onClick={() => { setErr(''); setCorr({ customerId: b.customerId, name: b.name, qty: '', reason: '' }); }}><IconPencil s={14} /></button>}
            </div>
          ))}
        </div>
        <div className="card dist-card" style={{ flex: 1, minWidth: 280 }}>
          <div className="sec-title" style={{ marginBottom: 8 }}>{trD('dist.gmLedger')}</div>
          {(data.movements || []).length === 0 && <div className="dist-empty">{trD('dist.gmNoMov')}</div>}
          {(data.movements || []).map((m) => { const meta = GM_META[m.type] || GM_META.correction; const disp = meta.sign === '' ? ((m.qty > 0 ? '+' : '') + numX(m.qty)) : (meta.sign + numX(Math.abs(m.qty))); return (
            <div key={m.id} className="dist-txn">
              <span className={`dist-gm-mtag ${meta.cls}`}>{trD(meta.l)}</span>
              <div className="dist-txn-mid"><div className="dist-txn-name">{m.type === 'opening' ? trD('dist.gmOpening') : (m.customerName || trD('dist.gmDepot'))}</div><div className="dist-txn-sub">{fmtDT(m.createdAt)}{m.actorName ? ' · ' + m.actorName : ''}{m.note && (m.type === 'correction' || m.type === 'opening') ? ' · ' + m.note : ''}</div></div>
              <b className={`tnum dist-gm-mqty ${meta.cls}`}>{disp}</b>
            </div>
          ); })}
        </div>
      </div>

      {corr && (
        <div className="modal-scrim" onClick={() => setCorr(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.gmCorrT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{corr.customerId ? corr.name : trD('dist.gmDepot')}</div></div><button className="jp-icon" onClick={() => setCorr(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('dist.gmCorrInfo')}</span></div>
              <label className="fld-label">{trD('dist.gmCorrQty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld tnum" value={corr.qty} inputMode="numeric" placeholder="cth. -1 atau 3" onChange={(e) => setCorr({ ...corr, qty: e.target.value.replace(/[^0-9-]/g, '') })} />
              <label className="fld-label">{trD('dist.gmCorrReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 70, padding: 12, resize: 'vertical' }} value={corr.reason} placeholder={trD('dist.gmCorrReasonPh')} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setCorr(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commitCorr}>{saving ? '…' : trD('dist.gmCorrSave')}</button></div>
          </div>
        </div>
      )}

      {opening && (
        <div className="modal-scrim" onClick={() => setOpening(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{op.set ? trD('dist.gmOpeningAdjust') : trD('dist.gmOpeningBtn')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.gmOpeningModalSub')}</div></div><button className="jp-icon" onClick={() => setOpening(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{op.set ? trD('dist.gmOpeningInfoAdj', { cur: numX(op.total) }) : trD('dist.gmOpeningInfoNew')}</span></div>
              <label className="fld-label">{trD('dist.gmOpeningQty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld tnum" value={opening.qty} inputMode="numeric" placeholder="cth. 500" onChange={(e) => setOpening({ ...opening, qty: e.target.value.replace(/[^0-9]/g, '') })} />
              {op.set && opening.qty !== '' && parseInt(opening.qty, 10) !== op.total && (
                <div className="dist-hint" style={{ marginTop: 6 }}>{trD('dist.gmOpeningDelta', { d: (parseInt(opening.qty, 10) - op.total >= 0 ? '+' : '') + numX(parseInt(opening.qty, 10) - op.total) })}</div>
              )}
              <label className="fld-label">{trD('dist.gmOpeningReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 66, padding: 12, resize: 'vertical' }} value={opening.reason} placeholder={trD('dist.gmOpeningReasonPh')} onChange={(e) => setOpening({ ...opening, reason: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setOpening(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commitOpening}>{saving ? '…' : trD('dist.gmOpeningSave')}</button></div>
          </div>
        </div>
      )}

      {reset && (() => { const tgt = reset.mode === 'balanced' ? (Math.max(0, parseInt(reset.target || '0', 10) || 0)) : 0; const fleetOpts = (fleet || []).filter(Boolean); return (
        <div className="modal-scrim" onClick={() => setReset(null)} style={{ zIndex: 210 }}>
          <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.grTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('dist.grSub')}</div></div><button className="jp-icon" onClick={() => setReset(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {/* mode choice */}
              <label className={`dist-gr-mode ${reset.mode === 'balanced' ? 'on' : ''}`} onClick={() => setReset({ ...reset, mode: 'balanced' })}>
                <input type="radio" checked={reset.mode === 'balanced'} readOnly />
                <div><b>{trD('dist.grModeA')}</b><span>{trD('dist.grModeADesc')}</span></div>
              </label>
              <label className={`dist-gr-mode danger ${reset.mode === 'purge' ? 'on' : ''}`} onClick={() => setReset({ ...reset, mode: 'purge' })}>
                <input type="radio" checked={reset.mode === 'purge'} readOnly />
                <div><b>{trD('dist.grModeB')}</b><span>{trD('dist.grModeBDesc')}</span></div>
              </label>

              <div className="gud-row2" style={{ marginTop: 6 }}>
                <div>
                  <label className="fld-label">{trD('dist.grScope')}</label>
                  <select className="fld" value={reset.fleet} onChange={(e) => setReset({ ...reset, fleet: e.target.value })}>
                    <option value="all">{trD('dist.grAllFleets')}</option>{fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {reset.mode === 'balanced' && (
                  <div><label className="fld-label">{trD('dist.grTarget')}</label><input className="fld tnum" value={reset.target} inputMode="numeric" placeholder="0" onChange={(e) => setReset({ ...reset, target: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                )}
              </div>

              <div className="dist-gr-preview">
                <span>{trD('dist.gmTotal')}: <b>{numX(st.totalOwned || 0)}</b> → <b className="to">{numX(tgt)}</b></span>
                <span>{trD('dist.gmAtCust')}: <b>{numX(st.atCustomers || 0)}</b> → <b className="to">0</b></span>
                <span>{trD('dist.gmAtDepot')}: <b>{numX(st.atDepot || 0)}</b> → <b className="to">{numX(tgt)}</b></span>
              </div>

              <label className="fld-label">{trD('dist.grReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={reset.reason} placeholder={trD('dist.grReasonPh')} onChange={(e) => setReset({ ...reset, reason: e.target.value })} />

              {reset.mode === 'purge' && (<>
                <div className="dist-gr-warn"><IconWarn s={16} /><span>{trD('dist.grPurgeWarn')}</span></div>
                <label className="fld-label">{trD('dist.grConfirmLbl')}</label>
                <input className="fld" value={reset.confirm} placeholder="RESET" onChange={(e) => setReset({ ...reset, confirm: e.target.value })} />
              </>)}
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setReset(null)}>{trD('dist.cancel')}</button><button className={`btn ${reset.mode === 'purge' ? 'btn-danger' : 'btn-primary'}`} disabled={saving} onClick={commitReset}>{saving ? '…' : (reset.mode === 'purge' ? trD('dist.grDoPurge') : trD('dist.grDo'))}</button></div>
          </div>
        </div>
      ); })()}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ════════════════ PENGIRIMAN (delivery board) ════════════════
// One board per (armada, tanggal): scheduled stops (from deliveryDays) + extra orders.
function DeliveryOrderModal({ date, customers, onClose, onSaved }) {
  const [cust, setCust] = uSx('');
  const [qty, setQty] = uSx('');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const opts = (customers || []).filter((c) => (c.armada || '').trim()).map((c) => ({ value: c.id, label: (c.code ? c.code + ' · ' : '') + c.name + ' · ' + c.armada, search: custSearchStr(c) }));
  const save = () => {
    if (!cust) { setErr(trD('dist.orderCustReq')); return; }
    if (saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.deliveries.addOrder({ customerId: cust, date, qty: qty ? +String(qty).replace(/[^0-9]/g, '') : undefined, note: note.trim() })
      .then(() => onSaved())
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.addOrder')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.orderCust')}</label>
          <UI.Dropdown value={cust} options={opts} placeholder={trD('dist.orderCustPh')} onChange={setCust} fluid />
          <label className="fld-label">{trD('dist.orderQty')}</label>
          <input className="fld tnum" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="—" />
          <label className="fld-label">{trD('dist.orderNote')}</label>
          <input className="fld" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.orderNotePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : trD('dist.orderSave')}</button></div>
      </div>
    </div>
  );
}
// Make a transaction directly from a stop; on success the caller marks the stop terkirim + links it.
function DeliveryTxnModal({ stop, today, onClose, onCreated }) {
  const [qty, setQty] = uSx(stop.qty || 1);
  const [method, setMethod] = uSx('lunas');
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const q = Math.max(1, qty | 0);
  const total = (stop.masterPrice || 0) * q;
  const save = () => {
    if (saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.transactions.create({ customerId: stop.customerId, qty: q, method, note: note.trim(), txnDate: today, gallonOut: q, gallonIn: 0 })
      .then((r) => onCreated(r.data))
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.delivMakeTxn')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{stop.customerName}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trD('dist.fQty')}</label>
          <div className="dist-stepper"><button type="button" onClick={() => setQty((n) => Math.max(1, (n | 0) - 1))}>−</button><input className="tnum" inputMode="numeric" value={qty} onChange={(e) => setQty(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0)} onFocus={(e) => e.target.select()} /><button type="button" onClick={() => setQty((n) => (n | 0) + 1)}>+</button></div>
          <label className="fld-label">{trD('dist.fMethod')}</label>
          <div className="cat-chips">{['lunas', 'bon'].map((m) => <button key={m} type="button" className={`cat-chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>{methodLabel(m)}</button>)}</div>
          <label className="fld-label">{trD('dist.note')}</label>
          <input className="fld" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="dist-lockrow" style={{ marginTop: 12 }}><span className="dist-lockrow-l"><IconLock s={14} />{numX(q)} × {rpFull(stop.masterPrice || 0)}</span><span className="dist-lockrow-r">{rpFull(total)}</span></div>
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : trD('dist.fSave')}</button></div>
      </div>
    </div>
  );
}
// Delivery runs (rit) panel — MUAT (load out) / TUTUP (return + reconcile) + a per-day report
// with the difference highlighted. Gallon STOCK is unchanged by this (it's driven by the
// per-customer movements); a run is a truck-level control that surfaces shortfalls.
function RunPanel({ date, ef, fleetScope, fleet, distFleet, canKoreksi, refreshKey, onChanged }) {
  const [runs, setRuns] = uSx(null);      // runs for the selected date (report)
  const [openRuns, setOpenRuns] = uSx([]); // currently-open runs (any date)
  const [modal, setModal] = uSx(null);    // { kind:'open'|'close', run?, ...fields }
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  const [toast, setToast] = uSx('');
  const reload = () => {
    if (!(window.API && window.API.distribusi && window.API.distribusi.runs)) return;
    window.API.distribusi.runs.list(date, ef).then((r) => setRuns(r.data || [])).catch(() => setRuns([]));
    window.API.distribusi.runs.list(null, ef, 'open').then((r) => setOpenRuns(r.data || [])).catch(() => setOpenRuns([]));
  };
  uEx(() => { reload(); }, [refreshKey, ef, date]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const scoped = isScoped(fleetScope);
  const fleetOpts = (fleet || []).filter(Boolean);
  const openModal = () => { setErr(''); setModal({ kind: 'open', gallonsOut: '', note: '', fleet: (distFleet && distFleet !== 'all') ? distFleet : (scoped ? '' : (fleetOpts[0] || '')) }); };
  const closeModal = (run) => { setErr(''); setModal({ kind: 'close', run, full: '', empty: '', diffReason: '' }); };
  // Koreksi Rit — prefill the fields with the run's current (effective) figures; the user edits
  // the wrong one and gives a reason. Only changed fields are sent (append-only signed deltas).
  const correctModal = (run) => { setErr(''); setModal({ kind: 'correct', run, out: String(run.gallonsOut), full: String(run.gallonsFullReturned), empty: String(run.gallonsEmptyReturned), reason: '' }); };
  const commit = () => {
    if (!modal || saving) return;
    setSaving(true); setErr('');
    const done = (m) => { setSaving(false); setModal(null); flash(m); reload(); if (onChanged) onChanged(); };
    const fail = (e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); };
    if (modal.kind === 'open') {
      const g = parseInt(String(modal.gallonsOut).replace(/[^0-9]/g, ''), 10);
      if (!(g > 0)) { setSaving(false); setErr(trD('run.errOut')); return; }
      if (!scoped && !modal.fleet) { setSaving(false); setErr(trD('run.errFleet')); return; }
      window.API.distribusi.runs.open({ date, fleet: modal.fleet || undefined, gallonsOut: g, note: (modal.note || '').trim() || undefined }).then(() => done(trD('run.opened'))).catch(fail);
      return;
    }
    if (modal.kind === 'correct') {
      const r = modal.run;
      const num = (v) => parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0;
      const payload = { reason: (modal.reason || '').trim() };
      if (num(modal.out) !== r.gallonsOut) payload.out = num(modal.out);
      if (r.status === 'closed') {   // isi-kembali/kosong only exist once the rit is closed
        if (num(modal.full) !== r.gallonsFullReturned) payload.full = num(modal.full);
        if (num(modal.empty) !== r.gallonsEmptyReturned) payload.empty = num(modal.empty);
      }
      if (payload.out === undefined && payload.full === undefined && payload.empty === undefined) { setSaving(false); setErr(trD('run.errNoChange')); return; }
      if (!payload.reason) { setSaving(false); setErr(trD('run.errReason')); return; }
      window.API.distribusi.runs.correct(r.id, payload).then(() => done(trD('run.corrected'))).catch(fail);
      return;
    }
    const full = parseInt(String(modal.full).replace(/[^0-9]/g, ''), 10) || 0;
    const empty = parseInt(String(modal.empty).replace(/[^0-9]/g, ''), 10) || 0;
    const expected = modal.run.expectedRemaining;
    const diff = full - expected;
    if (diff !== 0 && !(modal.diffReason || '').trim()) { setSaving(false); setErr(trD('run.errDiffReason', { d: (diff > 0 ? '+' : '') + numX(diff) })); return; }
    window.API.distribusi.runs.close(modal.run.id, { gallonsFullReturned: full, gallonsEmptyReturned: empty, diffReason: (modal.diffReason || '').trim() || undefined }).then(() => done(trD('run.closed'))).catch(fail);
  };
  const dayRuns = (runs || []);
  const totals = dayRuns.reduce((a, r) => ({ out: a.out + r.gallonsOut, sold: a.sold + r.sold, full: a.full + (r.gallonsFullReturned || 0), empty: a.empty + (r.gallonsEmptyReturned || 0) }), { out: 0, sold: 0, full: 0, empty: 0 });
  return (
    <div className="card dist-card gud-runpanel">
      <div className="dist-card-head">
        <div className="sec-title"><IconTruck s={15} /> {trD('run.title')}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openModal}><IconPlus s={14} />{trD('run.muat')}</button>
      </div>

      {openRuns.length > 0 && openRuns.map((r) => (
        <div key={r.id} className="run-open-row">
          <span className="run-open-badge"><span className="run-dot" />{trD('run.open')}</span>
          <div className="run-open-main"><b>{trD('run.ritN', { n: r.runNo })} · {r.fleetId}</b><span>{trD('run.loadedSold', { out: numX(r.gallonsOut), sold: numX(r.sold), exp: numX(r.expectedRemaining) })}</span></div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeModal(r)}><IconCheck s={14} />{trD('run.tutup')}</button>
        </div>
      ))}

      <div className="run-table-wrap">
        <table className="run-table">
          <thead><tr><th>{trD('run.rit')}</th><th>{trD('run.armada')}</th><th className="num">{trD('run.keluar')}</th><th className="num">{trD('run.terjual')}</th><th className="num">{trD('run.sisa')}</th><th className="num">{trD('run.dikembalikan')}</th><th className="num">{trD('run.selisih')}</th><th className="num">{trD('run.kosong')}</th><th>{trD('run.status')}</th>{canKoreksi && <th />}</tr></thead>
          <tbody>
            {dayRuns.length === 0 && <tr><td colSpan={canKoreksi ? 10 : 9} className="run-empty">{runs === null ? (trD('common.loading') || '…') : trD('run.none')}</td></tr>}
            {dayRuns.map((r) => (
              <tr key={r.id} className={r.status === 'closed' && r.diff !== 0 ? 'run-diff' : ''}>
                <td><span className="run-ritcell">{trD('run.ritN', { n: r.runNo })}{r.corrected && <span className="run-corr-badge" title={trD('run.correctedTip')} onClick={() => canKoreksi && correctModal(r)}>{trD('run.correctedTag')}</span>}</span></td>
                <td>{r.fleetId}</td>
                <td className="num">{numX(r.gallonsOut)}</td>
                <td className="num">{numX(r.sold)}</td>
                <td className="num">{numX(r.expectedRemaining)}</td>
                <td className="num">{r.status === 'closed' ? numX(r.gallonsFullReturned) : <span className="run-pending" title={trD('run.pendingClose')}>—</span>}</td>
                <td className="num">{r.status === 'closed' ? (r.diff === 0 ? <span className="run-ok">0</span> : <span className="run-bad" title={r.diffReason}>{(r.diff > 0 ? '+' : '') + numX(r.diff)}</span>) : <span className="run-pending" title={trD('run.pendingClose')}>—</span>}</td>
                <td className="num">{r.status === 'closed' ? numX(r.gallonsEmptyReturned) : <span className="run-pending" title={trD('run.pendingClose')}>—</span>}</td>
                <td>{r.status === 'closed' ? <span className="run-st closed">{trD('run.closed_')}</span> : <span className="run-st open">{trD('run.open')}</span>}</td>
                {canKoreksi && <td className="run-act"><button type="button" className="btn btn-ghost btn-xs" onClick={() => correctModal(r)}><IconPencil s={13} />{trD('run.koreksi')}</button></td>}
              </tr>
            ))}
            {dayRuns.length > 0 && (
              <tr className="run-total"><td colSpan={2}>{trD('run.total')}</td><td className="num">{numX(totals.out)}</td><td className="num">{numX(totals.sold)}</td><td className="num">—</td><td className="num">{numX(totals.full)}</td><td className="num">—</td><td className="num">{numX(totals.empty)}</td><td />{canKoreksi && <td />}</tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="dist-fieldhint" style={{ marginTop: 8 }}><IconClock s={12} />{trD('run.reconcileHint')}</div>

      {modal && (
        <div className="modal-scrim" onClick={() => setModal(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{modal.kind === 'open' ? trD('run.muatT') : modal.kind === 'correct' ? trD('run.koreksiT') : trD('run.tutupT')}</div>{modal.run && <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('run.ritN', { n: modal.run.runNo })} · {modal.run.fleetId}</div>}</div><button className="jp-icon" onClick={() => setModal(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {modal.kind === 'open' ? (<>
                <div className="dist-infobox"><IconTruck s={16} /><span>{trD('run.muatInfo')}</span></div>
                {!scoped && (<>
                  <label className="fld-label">{trD('run.armada')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                  <select className="fld" value={modal.fleet} onChange={(e) => setModal({ ...modal, fleet: e.target.value })}><option value="">{trD('run.pickFleet')}</option>{fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                </>)}
                <label className="fld-label">{trD('run.gallonsOut')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.gallonsOut} inputMode="numeric" placeholder="cth. 100" onChange={(e) => setModal({ ...modal, gallonsOut: e.target.value.replace(/[^0-9]/g, '') })} />
                <label className="fld-label">{trD('run.note')}</label>
                <input className="fld" value={modal.note} placeholder={trD('run.notePh')} onChange={(e) => setModal({ ...modal, note: e.target.value })} />
              </>) : modal.kind === 'correct' ? (<>
                <div className="dist-infobox"><IconPencil s={16} /><span>{trD('run.koreksiInfo')}</span></div>
                <label className="fld-label">{trD('run.keluar')} <span className="run-corr-sub">({trD('run.fldOut')})</span></label>
                <input className="fld tnum" value={modal.out} inputMode="numeric" onChange={(e) => setModal({ ...modal, out: e.target.value.replace(/[^0-9]/g, '') })} />
                {modal.run.status === 'closed' ? (<>
                  <label className="fld-label">{trD('run.dikembalikan')} <span className="run-corr-sub">({trD('run.fldFull')})</span></label>
                  <input className="fld tnum" value={modal.full} inputMode="numeric" onChange={(e) => setModal({ ...modal, full: e.target.value.replace(/[^0-9]/g, '') })} />
                  <label className="fld-label">{trD('run.kosong')} <span className="run-corr-sub">({trD('run.fldEmpty')})</span></label>
                  <input className="fld tnum" value={modal.empty} inputMode="numeric" onChange={(e) => setModal({ ...modal, empty: e.target.value.replace(/[^0-9]/g, '') })} />
                </>) : <div className="dist-fieldhint" style={{ marginTop: 6 }}><IconClock s={12} />{trD('run.koreksiOpenHint')}</div>}
                <label className="fld-label">{trD('run.koreksiReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={modal.reason} placeholder={trD('run.koreksiReasonPh')} onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
                {(modal.run.corrections || []).length > 0 && (
                  <div className="run-corr-hist">
                    <div className="run-corr-hist-h">{trD('run.koreksiHist')}</div>
                    {modal.run.corrections.map((c) => (
                      <div key={c.id} className="run-corr-hist-row">
                        <span className="run-corr-hist-f">{trD('run.fld_' + c.field)} <b>{(c.delta > 0 ? '+' : '') + numX(c.delta)}</b></span>
                        <span className="run-corr-hist-m">{c.reason} · {c.actorName || '—'}{c.createdAt ? ' · ' + fmtDT(c.createdAt) : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>) : (<>
                <div className="run-recon">
                  <div><span>{trD('run.keluar')}</span><b>{numX(modal.run.gallonsOut)}</b></div>
                  <div><span>{trD('run.terjual')}</span><b>{numX(modal.run.sold)}</b></div>
                  <div className="run-recon-exp"><span>{trD('run.sisa')}</span><b>{numX(modal.run.expectedRemaining)}</b></div>
                </div>
                <label className="fld-label">{trD('run.fullReturned')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.full} inputMode="numeric" placeholder={String(modal.run.expectedRemaining)} onChange={(e) => setModal({ ...modal, full: e.target.value.replace(/[^0-9]/g, '') })} />
                {modal.full !== '' && (() => { const d = (parseInt(modal.full, 10) || 0) - modal.run.expectedRemaining; return <div className={`run-diffline ${d !== 0 ? 'bad' : 'ok'}`}>{d === 0 ? trD('run.diffOk') : trD('run.diffBad', { d: (d > 0 ? '+' : '') + numX(d) })}</div>; })()}
                <label className="fld-label">{trD('run.emptyReturned')}</label>
                <input className="fld tnum" value={modal.empty} inputMode="numeric" placeholder="cth. 55" onChange={(e) => setModal({ ...modal, empty: e.target.value.replace(/[^0-9]/g, '') })} />
                {modal.full !== '' && (parseInt(modal.full, 10) || 0) !== modal.run.expectedRemaining && (<>
                  <label className="fld-label">{trD('run.diffReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                  <textarea className="fld" style={{ height: 58, padding: 12, resize: 'vertical' }} value={modal.diffReason} placeholder={trD('run.diffReasonPh')} onChange={(e) => setModal({ ...modal, diffReason: e.target.value })} />
                </>)}
              </>)}
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setModal(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commit}>{saving ? '…' : (modal.kind === 'open' ? trD('run.muat') : modal.kind === 'correct' ? trD('run.koreksiSave') : trD('run.tutup'))}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}


function DistDeliveries({ refreshKey, today, canOrder, canRoute, canClose, canKoreksi, fleetScope, fleet, distFleet, setDistFleet, onChanged }) {
  const [date, setDate] = uSx(today);
  const [board, setBoard] = uSx(null);
  const [closeouts, setCloseouts] = uSx([]);
  const [custs, setCusts] = uSx([]);
  const [toast, setToast] = uSx('');
  const [orderOpen, setOrderOpen] = uSx(false);
  const [txnStop, setTxnStop] = uSx(null);
  const [closeOpen, setCloseOpen] = uSx(false);
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => {
    if (!(window.API && window.API.distribusi)) return;
    // The board carries the day's closeout state for the fleets in scope (no separate admin
    // /closeouts call — that one is distribusiDashboard-gated and would 403 for a helper).
    window.API.distribusi.deliveries.board(date, ef)
      .then((r) => { setBoard(r.data || []); setCloseouts(r.closeouts || []); })
      // On failure fall back to an EMPTY board, never null: `board === null` means "still loading" and
      // would hide "Selesai Kerja Hari Ini". A secondary failure must never hide the primary action.
      .catch(() => { setBoard([]); setCloseouts([]); });
    // Customers only feed the "add order" picker — a 403 here must not affect the board or closeout.
    window.API.distribusi.customers.list(ef).then((r) => setCusts(r.data || [])).catch(() => setCusts([]));
  };
  uEx(() => { setBoard(null); reload(); }, [refreshKey, ef, date]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const mark = (id, status, transactionId) => window.API.distribusi.deliveries.mark(id, transactionId ? { status, transactionId } : { status })
    .then(() => { reload(); if (onChanged) onChanged(); }).catch(() => flash(trD('dist.loadErr')));
  // ── route reorder: ↑/↓ buttons (work everywhere, incl. mobile) + HTML5 drag (bonus). ──
  // Optimistic: reorder locally, then PUT the new id order; the saved seq drives the list.
  const dragIdx = React.useRef(null);
  const persistOrder = (list) => window.API.distribusi.deliveries.reorder({ date, fleet: ef, order: list.map((r) => r.id) })
    .then(() => { if (onChanged) onChanged(); }).catch(() => flash(trD('dist.loadErr')));
  const reorder = (from, to) => {
    if (from == null || to == null || from === to || to < 0) return;
    const next = (board || []).slice();
    if (to >= next.length) return;
    const [it] = next.splice(from, 1); next.splice(to, 0, it);
    setBoard(next); persistOrder(next);
  };
  const bar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  const rows = board || [];
  // The day is closed per (date, armada). Determine the fleet the board is showing, in order:
  //   1. the board itself, when every stop is one fleet;
  //   2. the user's OWN fleet scope when it names exactly one armada — a scoped helper's FleetBar is a
  //      static label (no picker), so `distFleet` stays 'all' for them forever. Without this fallback a
  //      helper whose board is EMPTY (a day with no scheduled stops) got closeFleet=null and the
  //      "Selesai Kerja Hari Ini" button was hidden — they could never close their day. Owner/GM never
  //      hit it because picking a fleet in the FleetBar sets `distFleet`;
  //   3. the full-access user's picked fleet.
  const fleetIds = [...new Set(rows.map((r) => r.fleetId))];
  const scopedFleets = isScoped(fleetScope) ? (fleetScope || []).filter(Boolean) : null;
  const closeFleet = fleetIds.length === 1 ? fleetIds[0]
    : (scopedFleets && scopedFleets.length === 1) ? scopedFleets[0]
    : (distFleet && distFleet !== 'all') ? distFleet : null;
  const closedFor = closeFleet ? closeouts.find((c) => c.fleetId === closeFleet) : null;
  const pendingStops = closeFleet ? rows.filter((s) => s.status === 'pending' && s.fleetId === closeFleet) : [];
  const srcBadge = (s) => <span className={`dist-src ${s}`}>{trD(s === 'tambahan' ? 'dist.srcTambahan' : 'dist.srcJadwal')}</span>;
  const statBadge = (s) => <span className={`dist-dstat ${s}`}>{trD('dist.dstat_' + s)}</span>;
  const hhmm2 = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
  return (
    <div className="dist-dash screen-enter">
      {bar}
      <div className="dist-tx-toolbar">
        <div style={{ minWidth: 190 }}><DP.DateField value={date} onChange={setDate} allowFuture /></div>
        <div style={{ flex: 1 }} />
        {canOrder && <button type="button" className="btn btn-ghost" onClick={() => setOrderOpen(true)}><IconPlus s={16} />{trD('dist.addOrder')}</button>}
        {canClose && closeFleet && !closedFor && board !== null && <button type="button" className="btn btn-primary" onClick={() => setCloseOpen(true)}><IconCheck s={16} />{trD('dist.closeDay')}</button>}
      </div>

      <RunPanel date={date} ef={ef} fleetScope={fleetScope} fleet={fleet} distFleet={distFleet} canKoreksi={canKoreksi} refreshKey={refreshKey} onChanged={reload} />
      {closeouts.map((c) => (
        <div key={c.id} className="card dist-closed-banner">
          <span className="dist-closed-ic"><IconCheck s={17} /></span>
          <div className="dist-closed-main">
            <b>{trD('dist.closedBy', { who: c.closedByName || '—', t: hhmm2(c.closedAt) })}{fleetIds.length !== 1 ? ' · ' + c.fleetId : ''}</b>
            <span className="dist-closed-sum">{trD('dist.closeSummary', { x: c.delivered, y: c.pending, z: c.cancelled })}{c.generalNote ? ' · ' + c.generalNote : ''}</span>
          </div>
        </div>
      ))}
      <div className="card dist-card" style={{ padding: '6px 18px' }}>
        {board === null && <div className="dist-empty dist-loading"><span className="dist-spin" />{trD('common.loading')}</div>}
        {board !== null && rows.length === 0 && <div className="dist-empty">{trD('dist.delivEmpty')}</div>}
        {rows.map((s, i) => (
          <div key={s.id} className={`dist-cust-row dist-deliv-row st-${s.status}`}
            draggable={canRoute} onDragStart={canRoute ? (e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; } : undefined}
            onDragOver={canRoute ? (e) => e.preventDefault() : undefined} onDrop={canRoute ? (e) => { e.preventDefault(); const from = dragIdx.current; dragIdx.current = null; reorder(from, i); } : undefined}>
            {canRoute && (
              <span className="dist-deliv-reorder no-print">
                <span className="dist-deliv-grip" title={trD('dist.dragHint')}><IconMenu s={15} /></span>
                <button type="button" className="icon-btn dist-deliv-mv" title={trD('dist.moveUp')} disabled={i === 0} onClick={() => reorder(i, i - 1)}><IconArrowUp s={14} /></button>
                <button type="button" className="icon-btn dist-deliv-mv" title={trD('dist.moveDown')} disabled={i === rows.length - 1} onClick={() => reorder(i, i + 1)}><IconArrowDown s={14} /></button>
              </span>
            )}
            <span className="dist-txn-av">{initialsOf(s.customerName)}</span>
            <div className="dist-cust-main">
              <div className="dist-txn-line1"><span className="dist-deliv-seq">{i + 1}.</span>{s.customerCode && <span className="dist-code">{s.customerCode}</span>}<span className="dist-txn-name">{s.customerName}</span>{srcBadge(s.source)}{statBadge(s.status)}</div>
              <div className="dist-txn-sub">{s.phone || '—'}{s.deliveryDays && s.deliveryDays.length ? ' · ' + fmtDays(s.deliveryDays) : ''}{s.qty ? ' · ' + numX(s.qty) + ' ' + trD('dist.galonUnit') : ''}{s.sisaBon > 0 ? ' · ' + trD('dist.sisaBon') + ' ' + rpFull(s.sisaBon) : ''}{s.note ? ' · ' + s.note : ''}</div>
              {s.pendingReason ? <div className="dist-deliv-reason"><IconInvoice s={11} />{trD('dist.pendingReason')}: {s.pendingReason}</div> : null}
              <div className="dist-deliv-loc no-print">
                {s.mapsLink
                  ? <a href={s.mapsLink} target="_blank" rel="noopener noreferrer" className="dist-link"><IconPin s={12} />{trD('dist.directions')}</a>
                  : <span className="dist-noloc"><IconPin s={12} />{trD('dist.locNotSet')}</span>}
                <GpsButton custId={s.customerId} hasLoc={s.hasLocation} onSaved={() => { flash(trD('dist.locSaved')); reload(); if (onChanged) onChanged(); }} onFlash={flash} />
                <LocPhoto custId={s.customerId} photoId={s.locationPhotoId} canEdit onChanged={() => { flash(trD('dist.locPhotoSaved')); reload(); if (onChanged) onChanged(); }} compact />
              </div>
            </div>
            {s.status === 'pending' && (
              <div className="dist-deliv-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setTxnStop(s)}><IconPlus s={13} />{trD('dist.delivMakeTxn')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(s.id, 'terkirim')}><IconCheck s={13} />{trD('dist.delivMarkSent')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(s.id, 'batal')}><IconClose s={13} />{trD('dist.delivCancel')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {orderOpen && <DeliveryOrderModal date={date} customers={custs} onClose={() => setOrderOpen(false)} onSaved={() => { setOrderOpen(false); flash(trD('dist.orderSaved')); reload(); if (onChanged) onChanged(); }} />}
      {txnStop && <DeliveryTxnModal stop={txnStop} today={date} onClose={() => setTxnStop(null)} onCreated={(txn) => { const st = txnStop; setTxnStop(null); mark(st.id, 'terkirim', txn.id); flash(trD('dist.delivSentTxn')); }} />}
      {closeOpen && closeFleet && <CloseoutModal date={date} fleet={closeFleet} pendingStops={pendingStops} onClose={() => setCloseOpen(false)} onClosed={() => { setCloseOpen(false); flash(trD('dist.closeDone')); reload(); if (onChanged) onChanged(); }} />}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}
// Day-closeout report. All delivered → optional note only. Any pending → a required
// reason per undelivered stop before the day can be closed (kept as 'ditunda').
function CloseoutModal({ date, fleet, pendingStops, onClose, onClosed }) {
  const [reasons, setReasons] = uSx({});
  const [note, setNote] = uSx('');
  const [saving, setSaving] = uSx(false);
  const [err, setErr] = uSx('');
  uEx(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const allFilled = pendingStops.every((s) => String(reasons[s.id] || '').trim());
  const save = () => {
    if (!allFilled || saving) return;
    setSaving(true); setErr('');
    window.API.distribusi.deliveries.close({ date, fleet, generalNote: note.trim(), reasons })
      .then(() => onClosed())
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('dist.closeDay')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{fleet} · {date}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {pendingStops.length > 0 ? (<>
            <div className="dist-close-warn"><IconInvoice s={15} />{trD('dist.closePendingWarn', { n: pendingStops.length })}</div>
            {pendingStops.map((s) => (
              <div key={s.id} className="dist-close-prow">
                <div className="dist-close-pname">{s.customerName}</div>
                <input className="fld" value={reasons[s.id] || ''} placeholder={trD('dist.closeReasonPh')} onChange={(e) => setReasons((r) => ({ ...r, [s.id]: e.target.value }))} />
              </div>
            ))}
          </>) : (
            <div className="dist-close-ok"><IconCheck s={16} />{trD('dist.closeAllDone')}</div>
          )}
          <label className="fld-label">{trD('dist.closeNote')}</label>
          <input className="fld" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={trD('dist.closeNotePh')} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving || !allFilled} onClick={save}>{saving ? '…' : trD('dist.closeConfirm')}</button></div>
      </div>
    </div>
  );
}

// LAPORAN PENGIRIMAN (delivery report) — a READ-ONLY per-fleet report over a day/range combining
// rits (runs) + reconciliation, delivery stops (planned vs terkirim vs batal/ditunda + reasons), the
// daily closeout notes, and the cash summary (tunai/transfer/field expenses/net). Printable + CSV.
// It never changes data; every endpoint it reads is server-cap-gated (distribusiPengirimanReport).
function DistDeliveryReport({ refreshKey, today, fleetScope, fleet, distFleet, setDistFleet }) {
  const [period, setPeriod] = uSx('today');
  const [from, setFrom] = uSx(today);
  const [to, setTo] = uSx(today);
  const [rep, setRep] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  const [toast, setToast] = uSx('');
  const ef = effFleet(fleetScope, distFleet);
  uEx(() => {
    let live = true; setLoading(true); setErr(false);
    if (!(window.API && window.API.distribusi && window.API.distribusi.deliveryReport)) { setLoading(false); setErr(true); return; }
    const opts = period === 'range' ? { period: 'range', dateFrom: from, dateTo: to, fleet: ef } : { period, fleet: ef };
    window.API.distribusi.deliveryReport(opts).then((r) => { if (live) { setRep(r.data); setLoading(false); } }).catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, ef, period, from, to]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const periods = [['today', trD('dist.perToday')], ['week', trD('dist.per7d')], ['month', trD('dist.perMonth')], ['range', trD('dist.perRange')]];
  const stName = (s) => trD('dist.dstat_' + s) !== 'dist.dstat_' + s ? trD('dist.dstat_' + s) : s;

  const exportCsv = () => {
    if (!rep) return;
    const rows = [[trD('rep.csvTitle'), rep.from + ' → ' + rep.to]];
    (rep.fleets || []).forEach((f) => {
      rows.push([]); rows.push(['ARMADA', f.fleetId || trD('dist.noFleet')]);
      rows.push([trD('rep.rits'), trD('run.keluar'), trD('run.terjual'), trD('run.dikembalikan'), trD('run.kosong'), trD('run.selisih'), trD('run.status')]);
      f.runs.forEach((r) => rows.push([trD('run.ritN', { n: r.runNo }), r.gallonsOut, r.sold, r.status === 'closed' ? r.gallonsFullReturned : '', r.status === 'closed' ? r.gallonsEmptyReturned : '', r.status === 'closed' ? r.diff : '', r.status]));
      rows.push([trD('rep.stops'), trD('rep.planned'), trD('dist.dstat_terkirim'), trD('dist.dstat_batal'), trD('dist.dstat_ditunda')]);
      rows.push(['', f.stops.planned, f.stops.terkirim, f.stops.batal, f.stops.ditunda + f.stops.pending]);
      rows.push([trD('rep.cash'), trD('dist.cashLbl'), trD('dist.xferLbl'), trD('dist.fieldExpense'), trD('dist.netCash')]);
      rows.push(['', f.cash.tunai, f.cash.transfer, f.cash.expense, f.cash.net]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'laporan-pengiriman-' + rep.from + (rep.from !== rep.to ? '_' + rep.to : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(trD('rep.exported'));
  };

  const fleetBar = <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />;
  const T = rep && rep.totals;
  return (
    <div className="dist-dash screen-enter dist-report">
      <div className="no-print">{fleetBar}</div>
      <div className="dist-tx-toolbar no-print">
        <div className="dist-chips">{periods.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {period === 'range' && <div className="dist-period-range"><DP.DateField value={from} onChange={setFrom} max={to || today} /><span>–</span><DP.DateField value={to} onChange={setTo} min={from || undefined} max={today} /></div>}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={!rep} onClick={() => window.print()}><IconDownload s={14} />{trD('dist.print')}</button>
        <button type="button" className="btn btn-ghost" disabled={!rep} onClick={exportCsv}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('rep.csv')}</button>
      </div>

      <div className="dist-report-head">
        <div><b>{trD('rep.title')}</b><span>{rep ? (rep.from === rep.to ? rep.from : rep.from + ' → ' + rep.to) : '…'}</span></div>
      </div>

      {loading ? <div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div>
        : err ? <div className="card"><div className="dist-empty">{trD('dist.loadErr')}</div></div>
        : !rep || rep.fleets.length === 0 ? <div className="card"><div className="dist-empty">{trD('rep.none')}</div></div>
        : (<>
          {/* Combined totals across fleets */}
          {rep.fleets.length > 1 && T && (
            <div className="card dist-card rep-totals">
              <div className="dist-card-head"><div className="sec-title">{trD('rep.combined')}</div></div>
              <div className="rep-cashrow">
                <div><span>{trD('dist.cashLbl')}</span><b className="amt-pos">{rpFull(T.cash.tunai)}</b></div>
                <div><span>{trD('dist.xferLbl')}</span><b>{rpFull(T.cash.transfer)}</b></div>
                <div><span>{trD('dist.fieldExpense')}</span><b className="amt-neg">−{rpFull(T.cash.expense)}</b></div>
                <div className="rep-net"><span>{trD('dist.netCash')}</span><b>{rpFull(T.cash.net)}</b></div>
              </div>
              <div className="rep-runrow"><span>{trD('rep.rits')}: {trD('run.keluar')} {numX(T.runs.out)} · {trD('run.terjual')} {numX(T.runs.sold)} · {trD('run.kosong')} {numX(T.runs.empty)}</span><span>{trD('rep.stops')}: {numX(T.stops.terkirim)}/{numX(T.stops.planned)} {trD('dist.dstat_terkirim')}</span></div>
            </div>
          )}

          {rep.fleets.map((f) => (
            <div key={f.fleetId || '—'} className="card dist-card rep-fleet">
              <div className="dist-card-head"><div className="sec-title"><IconTruck s={15} /> {f.fleetId || trD('dist.noFleet')}</div></div>

              {/* Cash reconciliation */}
              <div className="rep-cashrow">
                <div><span>{trD('dist.cashLbl')}</span><b className="amt-pos">{rpFull(f.cash.tunai)}</b></div>
                <div><span>{trD('dist.xferLbl')}</span><b>{rpFull(f.cash.transfer)}</b></div>
                <div><span>{trD('dist.fieldExpense')}</span><b className="amt-neg">−{rpFull(f.cash.expense)}</b></div>
                <div className="rep-net"><span>{trD('dist.netCash')}</span><b>{rpFull(f.cash.net)}</b></div>
              </div>

              {/* Rits */}
              <div className="rep-sub">{trD('rep.rits')}</div>
              {f.runs.length === 0 ? <div className="dist-empty sm">{trD('run.none')}</div> : (
                <div className="run-table-wrap"><table className="run-table">
                  <thead><tr><th>{trD('run.rit')}</th><th>{trD('dist.fDate')}</th><th className="num">{trD('run.keluar')}</th><th className="num">{trD('run.terjual')}</th><th className="num">{trD('run.dikembalikan')}</th><th className="num">{trD('run.kosong')}</th><th className="num">{trD('run.selisih')}</th><th>{trD('run.status')}</th><th>{trD('rep.who')}</th></tr></thead>
                  <tbody>
                    {f.runs.map((r) => (
                      <tr key={r.id} className={r.status === 'closed' && r.diff !== 0 ? 'run-diff' : ''}>
                        <td>{trD('run.ritN', { n: r.runNo })}{r.corrected ? <span className="run-corr-badge" title={trD('run.correctedTip')}>{trD('run.correctedTag')}</span> : null}</td>
                        <td>{r.date}</td>
                        <td className="num">{numX(r.gallonsOut)}</td>
                        <td className="num">{numX(r.sold)}</td>
                        <td className="num">{r.status === 'closed' ? numX(r.gallonsFullReturned) : '—'}</td>
                        <td className="num">{r.status === 'closed' ? numX(r.gallonsEmptyReturned) : '—'}</td>
                        <td className="num">{r.status === 'closed' ? (r.diff === 0 ? <span className="run-ok">0</span> : <span className="run-bad">{(r.diff > 0 ? '+' : '') + numX(r.diff)}</span>) : '—'}</td>
                        <td>{r.status === 'closed' ? <span className="run-st closed">{trD('run.closed_')}</span> : <span className="run-st open">{trD('run.open')}</span>}</td>
                        <td className="rep-who">{r.openedByName || '—'}{r.closedByName ? ' → ' + r.closedByName : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

              {/* Stops summary */}
              <div className="rep-sub">{trD('rep.stops')}</div>
              <div className="rep-stops">
                <span className="rep-pill planned">{trD('rep.planned')} {numX(f.stops.planned)}</span>
                <span className="rep-pill ok">{trD('dist.dstat_terkirim')} {numX(f.stops.terkirim)}</span>
                <span className="rep-pill bad">{trD('dist.dstat_batal')} {numX(f.stops.batal)}</span>
                <span className="rep-pill warn">{trD('dist.dstat_ditunda')} {numX(f.stops.ditunda + f.stops.pending)}</span>
              </div>
              {f.stopReasons.length > 0 && (
                <div className="rep-reasons">
                  {f.stopReasons.map((s, i) => <div key={i} className="rep-reason-row"><span className="rep-reason-cust">{s.customerName || '—'}</span><span className={`rep-pill sm ${s.status === 'batal' ? 'bad' : 'warn'}`}>{stName(s.status)}</span><span className="rep-reason-txt">{s.reason || '—'}{rep.from !== rep.to ? ' · ' + s.date : ''}</span></div>)}
                </div>
              )}

              {/* Closeout notes / kendala */}
              {f.closeouts.length > 0 && (<>
                <div className="rep-sub">{trD('rep.closeout')}</div>
                {f.closeouts.map((c) => (
                  <div key={c.id} className="rep-closeout"><span className="rep-co-meta">{c.date} · {c.closedByName || '—'}{c.closedAt ? ' · ' + fmtDT(c.closedAt) : ''}</span><span className="rep-co-counts">{trD('dist.dstat_terkirim')} {numX(c.delivered)} · {trD('dist.dstat_ditunda')} {numX(c.pending)} · {trD('dist.dstat_batal')} {numX(c.cancelled)}</span>{c.generalNote ? <span className="rep-co-note">{c.generalNote}</span> : null}</div>
                ))}
              </>)}
            </div>
          ))}
        </>)}
      {toast && <div className="dist-toast no-print"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ── KERUGIAN / UANG TIDAK DITERIMA ───────────────────────────────────────────────
// The INTERNAL side of "Pelunasan Tidak Diterima": every adjustment with its customer, amount,
// responsible staff, reason, evidence and who recorded it, plus totals per staff and for the period.
// Cap: distribusiBonAdjust (same as the action; server-enforced). This screen is company-internal —
// it is never part of a customer statement or any other customer-facing print.
function DistLossReport({ refreshKey, today, isOwner, isGmOwner, fleetScope, fleet, distFleet, setDistFleet, onChanged }) {
  const [period, setPeriod] = uSx('month');
  const [from, setFrom] = uSx(today);
  const [to, setTo] = uSx(today);
  const [rep, setRep] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  const [toast, setToast] = uSx('');
  const [tick, setTick] = uSx(0);
  const [statusF, setStatusF] = uSx('active');   // active | void | all
  const [sel, setSel] = uSx({});                  // { "source:id": true } — selection for bulk actions
  const [menuFor, setMenuFor] = uSx(null);        // row key whose ⋯ menu is open
  const [voidFor, setVoidFor] = uSx(null);        // { item, impact }
  const [delFor, setDelFor] = uSx(null);          // { item }
  const [detailFor, setDetailFor] = uSx(null);    // item — read-only detail
  const [editFor, setEditFor] = uSx(null);        // item — edit note
  const [bulkFor, setBulkFor] = uSx(null);        // { mode:'void'|'delete', items }
  const ef = effFleet(fleetScope, distFleet);
  uEx(() => {
    let live = true; setLoading(true); setErr(false);
    if (!(window.API && window.API.distribusi && window.API.distribusi.lossReport)) { setLoading(false); setErr(true); return; }
    const opts = period === 'range' ? { period: 'range', dateFrom: from, dateTo: to, fleet: ef } : { period, fleet: ef };
    window.API.distribusi.lossReport(opts).then((r) => { if (live) { setRep(r.data); setLoading(false); } }).catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, ef, period, from, to, tick]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const periods = [['today', trD('dist.perToday')], ['week', trD('dist.per7d')], ['month', trD('dist.perMonth')], ['range', trD('dist.perRange')]];
  const viewProof = (id) => { if (id && window.UI && window.UI._viewProof) window.UI._viewProof({ ref: id, isImg: true, name: 'bukti.jpg' }); };
  // ── selection + actions ──
  const K = (x) => x.source + ':' + x.id;
  const items = rep ? rep.items : [];
  const activeItems = items.filter((x) => !x.voided);
  const voidItems = items.filter((x) => x.voided);
  const shown = statusF === 'active' ? activeItems : statusF === 'void' ? voidItems : items;
  const selKeys = Object.keys(sel).filter((k) => sel[k]);
  const selItems = activeItems.filter((x) => sel[K(x)]);
  const toggleSel = (x) => setSel((s) => ({ ...s, [K(x)]: !s[K(x)] }));
  const clearSel = () => setSel({});
  const afterChange = (m) => { setVoidFor(null); setDelFor(null); setBulkFor(null); setEditFor(null); clearSel(); setTick((t) => t + 1); if (onChanged) onChanged(); if (m) flash(m); };
  const openVoid = (x) => { setMenuFor(null); window.API.distribusi.kerugianImpact(x.id, x.source).then((r) => setVoidFor({ item: x, impact: r.data })).catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail'))); };
  const openDelete = (x) => { setMenuFor(null); setDelFor({ item: x }); };
  const eligibleDelete = (x) => isOwner && x.source === 'pnr' && !x.voided && x.deletable;
  const exportCsv = () => {
    if (!rep) return;
    const rows = [[trD('loss.title'), rep.from + ' → ' + rep.to], [],
      [trD('dist.fDate'), trD('dist.fCust'), trD('pnr.amount'), trD('pnr.staff'), trD('pnr.reason'), trD('loss.recordedBy'), trD('loss.statusCol')]];
    (rep.items || []).forEach((x) => rows.push([x.txnDate, x.customerName, x.amount, x.responsibleName, x.lossReason, x.recordedByName, x.voided ? trD('loss.voided') : '']));
    rows.push([]); rows.push([trD('loss.perStaff')]);
    (rep.byStaff || []).forEach((s) => rows.push([s.responsibleName, s.count, s.total]));
    rows.push([]); rows.push([trD('loss.total'), rep.total]);
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kerugian-uang-tidak-diterima-' + rep.from + (rep.from !== rep.to ? '_' + rep.to : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(trD('rep.exported'));
  };
  return (
    <div className="dist-dash screen-enter dist-report">
      <div className="no-print"><FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} /></div>
      <div className="dist-tx-toolbar no-print">
        <div className="dist-chips">{periods.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {period === 'range' && <div className="dist-period-range"><DP.DateField value={from} onChange={setFrom} max={to || today} /><span>–</span><DP.DateField value={to} onChange={setTo} min={from || undefined} max={today} /></div>}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={!rep} onClick={() => window.print()}><IconDownload s={14} />{trD('dist.print')}</button>
        <button type="button" className="btn btn-ghost" disabled={!rep} onClick={exportCsv}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('rep.csv')}</button>
      </div>

      <div className="dist-report-head">
        <div><b>{trD('loss.title')}</b><span>{rep ? (rep.from === rep.to ? rep.from : rep.from + ' → ' + rep.to) : '…'}</span></div>
      </div>
      <div className="dist-warnbox loss-internal"><IconLock s={16} /><span>{trD('loss.internalOnly')}</span></div>

      <div className="dist-warnbox loss-internal" style={{ marginTop: -8 }} />

      {loading ? <div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div>
        : err ? <div className="card"><div className="dist-empty">{trD('dist.loadErr')}</div></div>
        : !rep || rep.items.length === 0 ? <div className="card"><div className="dist-empty">{trD('loss.none')}</div></div>
        : (<>
          <div className="card dist-card loss-totals">
            <div className="dist-card-head"><div className="sec-title">{trD('loss.total')}</div><span className="dist-badge">{numX(rep.count)} {trD('dist.notaWord')}</span></div>
            <div className="loss-big amt-neg">{rpFull(rep.total)}</div>
            {/* Cancelled records are excluded from the total; shown as their own line so it's visible. */}
            {rep.voidedCount > 0 && <div className="loss-cancelled-line"><span>{trD('kv.cancelledLine')} · {numX(rep.voidedCount)}</span><b className="tnum">− {rpFull(rep.voidedTotal)}</b></div>}
            <div className="loss-staff">
              {rep.byStaff.map((s) => (
                <div key={s.key} className="loss-staff-row"><span className="loss-staff-name">{s.responsibleName || '—'}</span><span className="loss-staff-cnt">{numX(s.count)}×</span><b className="tnum amt-neg">{rpFull(s.total)}</b></div>
              ))}
            </div>
          </div>

          {/* Status filter chips (Aktif · Dibatalkan · Semua) with counts. */}
          <div className="dist-tx-toolbar no-print" style={{ paddingTop: 0 }}>
            <div className="dist-chips">
              <button type="button" className={`dist-chip ${statusF === 'active' ? 'on' : ''}`} onClick={() => setStatusF('active')}>{trD('kv.statusActive')} <span className="dist-imp-chipn">{activeItems.length}</span></button>
              <button type="button" className={`dist-chip ${statusF === 'void' ? 'on' : ''}`} onClick={() => setStatusF('void')}>{trD('kv.statusVoid')} <span className="dist-imp-chipn">{voidItems.length}</span></button>
              <button type="button" className={`dist-chip ${statusF === 'all' ? 'on' : ''}`} onClick={() => setStatusF('all')}>{trD('kv.statusAll')} <span className="dist-imp-chipn">{items.length}</span></button>
            </div>
          </div>

          {/* Bulk actions bar. */}
          {selItems.length > 0 && (
            <div className="kv-bulkbar no-print">
              <span><b>{selItems.length}</b> {trD('kv.selected')}</span>
              <div style={{ flex: 1 }} />
              {isGmOwner && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkFor({ mode: 'void', items: selItems })}><IconRefresh s={13} />{trD('kv.void')}</button>}
              {isOwner && <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setBulkFor({ mode: 'delete', items: selItems })}><IconTrash s={13} />{trD('kv.delete')}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSel}><IconClose s={13} />{trD('dist.cancel')}</button>
            </div>
          )}

          <div className="card dist-card">
            <div className="dist-card-head"><div className="sec-title">{trD('loss.detail')}</div></div>
            <div className="run-table-wrap">
              <table className="run-table loss-table kv-table">
                <thead><tr><th className="kv-check no-print" /><th>{trD('dist.fDate')}</th><th>{trD('loss.colSource')}</th><th>{trD('dist.fCust')}</th><th className="num">{trD('pnr.amount')}</th><th>{trD('pnr.staff')}</th><th>{trD('pnr.reason')}</th><th>{trD('loss.recordedBy')}</th><th className="no-print" /></tr></thead>
                <tbody>
                  {shown.map((x) => {
                    const key = K(x); const open = menuFor === key;
                    return (
                    <tr key={key} className={x.voided ? 'loss-void' : ''}>
                      <td className="kv-check no-print">{!x.voided && isGmOwner ? <input type="checkbox" checked={!!sel[key]} onChange={() => toggleSel(x)} aria-label="pilih" /> : null}</td>
                      <td className="tnum">{x.txnDate}</td>
                      <td>{x.source === 'dispute'
                        ? <span className={'dist-badge ' + (x.disputeStatus === 'kerugian' ? 'disp-redsolid' : 'disp-redout')} title={'#' + String(x.transactionId || '').slice(-6).toUpperCase()}>{trD('loss.srcDispute')}</span>
                        : <span className="dist-badge">{trD('loss.srcPnr')}</span>}</td>
                      <td>{x.customerName}{x.customerCode ? <small> · {x.customerCode}</small> : null}{x.source === 'dispute' ? <small> · #{String(x.transactionId || '').slice(-6).toUpperCase()}</small> : null}</td>
                      <td className="num">{x.voided ? <s className="kv-struck">{rpFull(x.amount)}</s> : rpFull(x.amount)}{x.voided ? <span className="dist-badge void">{trD('loss.voided')}</span> : null}</td>
                      <td><b>{x.responsibleName || '—'}</b></td>
                      <td className="loss-reason">{x.source === 'dispute' ? dispReasonLabel(x.lossReason) : (x.lossReason || '—')}{x.voided && x.voidReason ? <small> · {trD('loss.voidReason')}: {trD('kv.reason.' + x.voidReason) || x.voidReason}</small> : null}</td>
                      <td><small>{x.recordedByName || '—'}{x.createdAt ? ' · ' + fmtDT(x.createdAt) : ''}</small></td>
                      <td className="kv-actcell no-print">
                        <button type="button" className="jp-icon kv-dots" aria-haspopup="true" aria-expanded={open} onClick={() => setMenuFor(open ? null : key)}><IconDots s={16} /></button>
                        {open && <><div className="cd-menu-scrim" onClick={() => setMenuFor(null)} /><div className="cd-menu kv-menu" role="menu">
                          <button type="button" role="menuitem" className="cd-menu-item" onClick={() => { setMenuFor(null); setDetailFor(x); }}>{IcX('IconInvoice', { s: 14 })}{trD('kv.detail')}</button>
                          {isGmOwner && <button type="button" role="menuitem" className="cd-menu-item" onClick={() => { setMenuFor(null); setEditFor(x); }}>{IcX('IconPencil', { s: 14 })}{trD('kv.editNote')}</button>}
                          {isGmOwner && !x.voided && <button type="button" role="menuitem" className="cd-menu-item" onClick={() => openVoid(x)}>{IcX('IconRefresh', { s: 14 })}{trD('kv.void')}</button>}
                          {isOwner && (eligibleDelete(x)
                            ? <button type="button" role="menuitem" className="cd-menu-item danger" onClick={() => openDelete(x)}>{IcX('IconTrash', { s: 14 })}{trD('kv.delete')}</button>
                            : (x.source === 'pnr' && !x.voided ? <div className="cd-menu-item disabled" title={trD('kv.delBlocked')}>{IcX('IconLock', { s: 14 })}{trD('kv.delete')}</div> : null))}
                        </div></>}
                      </td>
                    </tr>
                    );
                  })}
                  {shown.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-mut)', padding: 18 }}>{trD('loss.none')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      {voidFor && <KerugianVoidModal item={voidFor.item} impact={voidFor.impact} onClose={() => setVoidFor(null)} onDone={() => afterChange(trD('kv.voided'))} onFlash={flash} />}
      {delFor && <KerugianDeleteModal item={delFor.item} onClose={() => setDelFor(null)} onDone={() => afterChange(trD('kv.deleted'))} onFlash={flash} />}
      {bulkFor && <KerugianBulkModal mode={bulkFor.mode} items={bulkFor.items} onClose={() => setBulkFor(null)} onDone={(m) => afterChange(m)} onFlash={flash} />}
      {editFor && <KerugianEditModal item={editFor} onClose={() => setEditFor(null)} onDone={() => afterChange(trD('kv.saved'))} onFlash={flash} />}
      {detailFor && <KerugianDetailModal item={detailFor} onClose={() => setDetailFor(null)} onProof={viewProof} />}
      {toast && <div className="dist-toast no-print"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// Reason labels shared by the void modal + row. salah_input · sudah_tertagih · duplikat · salah_penilaian · lainnya.
const KV_VOID_REASONS = ['salah_input', 'sudah_tertagih', 'duplikat', 'salah_penilaian', 'lainnya'];
// One line describing a side effect of a void (from the server impact — never trust the client).
function kvEffectLine(e) {
  if (e.type === 'bon') return trD('kv.effBon', { code: e.customerCode || e.customerName || '', amt: rpFull(e.delta || 0) });
  if (e.type === 'liability') return trD('kv.effLiability', { staff: e.staffName || '', amt: rpFull(e.amount || 0) });
  if (e.type === 'disputeStatus') return trD('kv.effStatus', { ref: 'TRX ' + (e.txnRef || '') });
  return '';
}

// BATALKAN — reason + note + a preview of every side effect (from GET /impact) + a typed confirmation.
function KerugianVoidModal({ item, impact, onClose, onDone, onFlash }) {
  const [reason, setReason] = uSx('salah_input');
  const [note, setNote] = uSx('');
  const [typed, setTyped] = uSx('');
  const [busy, setBusy] = uSx(false);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const blocked = impact && impact.void && !impact.void.allowed ? impact.void.blockers : [];
  const canSubmit = !!note.trim() && typed.trim().toUpperCase() === trD('kv.confirmWord').toUpperCase() && blocked.length === 0 && !busy;
  const submit = () => {
    if (!canSubmit) return; setBusy(true);
    window.API.distribusi.voidKerugian(item.id, item.source, { reason, note: note.trim() })
      .then(() => onDone()).catch((e) => { onFlash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); setBusy(false); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('kv.voidTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{item.customerName}{item.customerCode ? ' · ' + item.customerCode : ''} · {rpFull(item.amount)}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {blocked.length > 0 && <div className="dist-warnbox" style={{ marginBottom: 10 }}><IconWarn s={16} /><span>{blocked.map((b) => trD('kv.blocked.' + b.code) || b.code).join(' · ')}</span></div>}
          <div className="kv-impact">
            <div className="kv-impact-h">{trD('kv.voidWillLead')}</div>
            <ul>{(impact && impact.effects || []).map((e, i) => <li key={i}>{kvEffectLine(e)}</li>)}</ul>
          </div>
          <label className="fld-label">{trD('kv.reason')}</label>
          <select className="fld" value={reason} onChange={(e) => setReason(e.target.value)}>{KV_VOID_REASONS.map((r) => <option key={r} value={r}>{trD('kv.reason.' + r)}</option>)}</select>
          <label className="fld-label">{trD('kv.note')} <span style={{ color: 'var(--neg)' }}>*</span></label>
          <textarea className="fld" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('kv.notePh')} />
          <label className="fld-label">{trD('kv.confirmType', { w: trD('kv.confirmWord') })}</label>
          <input className="fld" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={trD('kv.confirmWord')} />
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn dist-btn-danger" disabled={!canSubmit} onClick={submit}>{busy ? '…' : trD('kv.voidBtn')}</button></div>
      </div>
    </div>
  );
}

// HAPUS PERMANEN — owner-only. Type the amount or ref to confirm; the server re-checks eligibility.
function KerugianDeleteModal({ item, onClose, onDone, onFlash }) {
  const [typed, setTyped] = uSx('');
  const [busy, setBusy] = uSx(false);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const ref = '#' + String(item.transactionId || item.id).slice(-6).toUpperCase();
  const ok = typed.trim().toUpperCase() === ref || typed.replace(/[^0-9]/g, '') === String(item.amount);
  const submit = () => {
    if (!ok || busy) return; setBusy(true);
    window.API.distribusi.hardDeleteKerugian(item.id, item.source, typed.trim().toUpperCase() === ref ? ref : String(item.amount))
      .then(() => onDone()).catch((e) => { onFlash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); setBusy(false); });
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('kv.delTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{item.customerName} · {rpFull(item.amount)}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className="dist-warnbox" style={{ marginBottom: 12 }}><IconWarn s={16} /><span>{trD('kv.delWarn')}</span></div>
          <label className="fld-label">{trD('kv.delConfirmType', { ref: ref, amt: numX(item.amount) })}</label>
          <input className="fld" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={ref + ' / ' + item.amount} />
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn dist-btn-danger" disabled={!ok || busy} onClick={submit}>{busy ? '…' : trD('kv.delBtn')}</button></div>
      </div>
    </div>
  );
}

// BULK — void (loops the void endpoint with one shared reason+note) OR delete (server bulk-delete
// with a per-id result). Shows a preview list before confirming.
function KerugianBulkModal({ mode, items, onClose, onDone, onFlash }) {
  const [reason, setReason] = uSx('salah_input');
  const [note, setNote] = uSx('');
  const [busy, setBusy] = uSx(false);
  const [result, setResult] = uSx(null);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const del = mode === 'delete';
  const run = () => {
    if (busy) return;
    if (!del && !note.trim()) return;
    setBusy(true);
    if (del) {
      window.API.distribusi.bulkDeleteKerugian(items.map((x) => ({ id: x.id, source: x.source })))
        .then((r) => { const d = r.data; setResult(d); if (d.skipped === 0) onDone(trD('kv.bulkResult', { ok: d.deleted, skip: d.skipped })); else { setBusy(false); onFlash(trD('kv.bulkResult', { ok: d.deleted, skip: d.skipped })); } })
        .catch((e) => { onFlash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); setBusy(false); });
    } else {
      const ops = items.map((x) => window.API.distribusi.voidKerugian(x.id, x.source, { reason, note: note.trim() }).then(() => ({ id: x.id, ok: true })).catch(() => ({ id: x.id, ok: false })));
      Promise.all(ops).then((rs) => { const okN = rs.filter((r) => r.ok).length; onDone(trD('kv.bulkResult', { ok: okN, skip: rs.length - okN })); });
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{del ? trD('kv.delete') : trD('kv.void')} · {items.length}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{trD('kv.bulkPreview')}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {del && <div className="dist-warnbox" style={{ marginBottom: 10 }}><IconWarn s={16} /><span>{trD('kv.delWarn')}</span></div>}
          <div className="kv-preview-list">
            {items.map((x) => { const r = result && result.results && result.results.find((y) => y.id === x.id); return (
              <div key={x.id} className={'kv-preview-row' + (r ? (r.ok ? ' ok' : ' skip') : '')}>
                <span>{x.customerName}{x.customerCode ? ' · ' + x.customerCode : ''}</span>
                <b className="tnum">{rpFull(x.amount)}</b>
                {r ? <span className="kv-preview-res">{r.ok ? trD('kv.resOk') : (trD('kv.blocked.' + r.reason) || r.reason)}</span> : null}
              </div>
            ); })}
          </div>
          {!del && (<>
            <label className="fld-label">{trD('kv.reason')}</label>
            <select className="fld" value={reason} onChange={(e) => setReason(e.target.value)}>{KV_VOID_REASONS.map((r) => <option key={r} value={r}>{trD('kv.reason.' + r)}</option>)}</select>
            <label className="fld-label">{trD('kv.note')} <span style={{ color: 'var(--neg)' }}>*</span></label>
            <textarea className="fld" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={trD('kv.notePh')} />
          </>)}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{result ? trD('common.close') || 'Tutup' : trD('dist.cancel')}</button>{!result && <button className={'btn ' + (del ? 'dist-btn-danger' : 'btn-primary')} disabled={busy || (!del && !note.trim())} onClick={run}>{busy ? '…' : (del ? trD('kv.delBtn') : trD('kv.voidBtn'))}</button>}</div>
      </div>
    </div>
  );
}

// Edit the note/reason of a loss record (never the amount).
function KerugianEditModal({ item, onClose, onDone, onFlash }) {
  const [note, setNote] = uSx(item.note || '');
  const [busy, setBusy] = uSx(false);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const submit = () => { setBusy(true); window.API.distribusi.editKerugianNote(item.id, item.source, note.trim()).then(() => onDone()).catch((e) => { onFlash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); setBusy(false); }); };
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('kv.editTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{item.customerName} · {rpFull(item.amount)}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body"><label className="fld-label" style={{ marginTop: 0 }}>{trD('kv.note')}</label><textarea className="fld" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? '…' : trD('kv.save')}</button></div>
      </div>
    </div>
  );
}

// Read-only detail view.
function KerugianDetailModal({ item, onClose, onProof }) {
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const kv = (k, v) => <div className="cd-kv"><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('kv.detailTitle')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{item.source === 'dispute' ? trD('loss.srcDispute') : trD('loss.srcPnr')} · #{String(item.transactionId || item.id).slice(-6).toUpperCase()}</div></div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          {kv(trD('dist.fCust'), (item.customerName || '—') + (item.customerCode ? ' · ' + item.customerCode : ''))}
          {kv(trD('pnr.amount'), rpFull(item.amount))}
          {kv(trD('pnr.staff'), item.responsibleName || '—')}
          {kv(trD('pnr.reason'), item.source === 'dispute' ? dispReasonLabel(item.lossReason) : (item.lossReason || '—'))}
          {kv(trD('loss.recordedBy'), (item.recordedByName || '—') + (item.createdAt ? ' · ' + fmtDT(item.createdAt) : ''))}
          {item.note ? kv(trD('kv.note'), item.note) : null}
          {item.voided ? kv(trD('loss.voided'), (trD('kv.reason.' + item.voidReason) || item.voidReason || '') + (item.voidedByName ? ' · ' + item.voidedByName : '')) : null}
          {(item.lossPhotoId || item.evidenceUrl) ? <div style={{ marginTop: 10 }}>{item.lossPhotoId ? <button type="button" className="dist-link" onClick={() => onProof(item.lossPhotoId)}>{trD('pnr.proofView')}</button> : <a className="dist-link" href={item.evidenceUrl} target="_blank" rel="noopener noreferrer">{trD('pnr.proofView')}</a>}</div> : null}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>{trD('common.close') || 'Tutup'}</button></div>
      </div>
    </div>
  );
}

// ── CHANGE-REQUEST INBOX (correction / void approvals) ───────────────────────────
// Approvers (distribusiApprove) see pending correction/void requests here — transaction ref,
// customer, CURRENT vs REQUESTED input values, the recomputed delta, reason and requester — and
// Setujui (apply atomically) / Tolak (rejection needs a note). Lives inside the Requests screen.
function DistChangeRequests({ refreshKey, fleetScope, fleet, distFleet, setDistFleet, onChanged }) {
  const [reqs, setReqs] = uSx(null);
  const [loadErr, setLoadErr] = uSx('');   // real load failure → message + "Coba lagi" (never a silent [])
  const [tab, setTab] = uSx('pending');
  const [rejFor, setRejFor] = uSx(null);
  const [rejNote, setRejNote] = uSx('');
  const [busy, setBusy] = uSx(false);
  const [toast, setToast] = uSx('');
  const ef = effFleet(fleetScope, distFleet);
  const reload = () => {
    if (!(window.API && window.API.distribusi && window.API.distribusi.changeRequests)) { setLoadErr(trD('dist.loadErr')); setReqs([]); return; }
    setLoadErr(''); setReqs(null);
    window.API.distribusi.changeRequests.list({ status: tab, fleet: ef })
      .then((r) => { setReqs(r.data || []); })
      // Surface the REAL error (403 / server down) with a retry, instead of catching to [] which
      // looks identical to "no requests" and hides a genuine failure.
      .catch((e) => { setLoadErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); setReqs([]); });
  };
  uEx(() => { reload(); }, [refreshKey, ef, tab]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const approve = (r) => {
    if (busy) return;
    // A change that would push the customer's sisa bon negative needs the approver's explicit OK
    // (the server also enforces this — it 400s with needsNegativeConfirm unless confirmNegative is set).
    let confirmNegative = false;
    if (r.wouldGoNegative && !window.confirm(trD('cr.negativeConfirm', { amt: rpFull(Math.abs(r.bonImpact || 0)) }))) return;
    if (r.wouldGoNegative) confirmNegative = true;
    setBusy(true);
    window.API.distribusi.changeRequests.approve(r.id, confirmNegative ? { confirmNegative: true } : {})
      .then(() => { setBusy(false); flash(trD('cr.approved')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setBusy(false); flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const doReject = () => {
    if (!rejFor || !rejNote.trim() || busy) return; setBusy(true);
    window.API.distribusi.changeRequests.reject(rejFor.id, rejNote.trim())
      .then(() => { setBusy(false); setRejFor(null); setRejNote(''); flash(trD('cr.rejected')); reload(); if (onChanged) onChanged(); })
      .catch((e) => { setBusy(false); flash((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  // Compact "field: old → new" chips for the changed inputs of a correction.
  const fieldChips = (r) => {
    if (r.kind === 'void' || !r.requested) return null;
    const c = r.current || {}, q = r.requested || {};
    const chips = [];
    const add = (label, o, n) => { if (n != null && +o !== +n) chips.push(<span key={label} className="cr-fieldchip">{label}: <b>{numX(o)}</b> → <b>{numX(n)}</b></span>); };
    if (q.amount != null) add(trD('dist.payAmount'), c.amount, q.amount);
    else { add(trD('dist.fQty'), c.qty, q.qty); add(trD('dist.hargaPerGalon'), c.unitPrice, q.unitPrice); add(trD('dist.fGalOut'), c.gallonOut, q.gallonOut); add(trD('dist.fGalIn'), c.gallonIn, q.gallonIn); }
    return chips.length ? <div className="cr-fieldchips">{chips}</div> : null;
  };
  const tabs = [['pending', trD('cr.tabPending')], ['approved', trD('cr.tabApproved')], ['rejected', trD('cr.tabRejected')]];
  const statusBadge = (s) => <span className={`cr-status ${s}`}>{trD('cr.st_' + s)}</span>;
  return (
    <div className="dist-dash screen-enter">
      <FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} />
      <div className="dist-report-head"><div><b>{trD('cr.title')}</b><span>{trD('cr.subtitle')}</span></div></div>
      <div className="dist-tx-toolbar"><div className="dist-chips">{tabs.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {loadErr ? (
        <div className="card dist-loadfail" style={{ padding: 28, textAlign: 'center' }}>
          <IconWarn s={22} />
          <div className="dist-loadfail-msg">{loadErr}</div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={reload}><IconRefresh s={15} />{trD('common.retry')}</button>
        </div>
      ) : reqs === null ? <div className="card"><div className="dist-empty dist-loading"><span className="dist-spin" />{trD('common.loading')}</div></div>
        : reqs.length === 0 ? <div className="card"><div className="dist-empty">{trD('cr.none_' + tab)}</div></div>
        : (
          <div className="cr-list">
            {reqs.map((r) => {
              const down = r.delta < 0;
              return (
                <div key={r.id} className={`card cr-card ${r.status}`}>
                  <div className="cr-head">
                    <span className={`cr-kind ${r.kind}`}>{r.kind === 'void' ? <><IconClose s={12} />{trD('cr.kindVoid')}</> : <><IconPencil s={12} />{trD('cr.kindCorrection')}</>}</span>
                    <span className="cr-ref">{r.txnRef}</span>
                    <span className="cr-cust">{r.customerCode ? r.customerCode + ' · ' : ''}{r.customerName}</span>
                    <span style={{ flex: 1 }} />
                    {r.status !== 'pending' && statusBadge(r.status)}
                  </div>
                  <div className="cr-amounts">
                    <div><span>{trD('dist.total')}</span><b className="tnum">{rpFull(r.current ? r.current.amount : 0)}</b></div>
                    <div className="cr-arrow"><IconCaret s={16} style={{ transform: 'rotate(-90deg)' }} /></div>
                    <div><span>{r.kind === 'void' ? trD('cr.afterVoid') : trD('dist.korekNew')}</span><b className="tnum">{r.kind === 'void' ? rpFull(0) : rpFull(r.newAmount || 0)}</b></div>
                    <div className="cr-delta"><span>{trD('dist.korekDelta')}</span><b className={`tnum ${down ? 'amt-neg' : r.delta > 0 ? 'amt-pos' : ''}`}>{r.delta >= 0 ? '+' : ''}{rpFull(r.delta)}</b></div>
                  </div>
                  {fieldChips(r)}
                  {/* METHOD flip + its sisa-bon consequence — the decisive line for the approver. */}
                  {r.methodChanged && (
                    <div className={`cr-method ${r.wouldGoNegative ? 'warn' : ''}`}>
                      <span className="cr-method-flip"><IconRefresh s={12} />{methodLabel(r.method)} → <b>{methodLabel(r.requestedMethod)}</b></span>
                      <span className={`cr-method-bon ${r.bonImpact < 0 ? 'amt-neg' : 'amt-pos'}`}>{trD('dist.korekSisaBon')} {r.bonImpact >= 0 ? '+' : '−'}{rpFull(Math.abs(r.bonImpact || 0))}</span>
                      {r.wouldGoNegative && <span className="cr-method-neg"><IconWarn s={12} />{trD('cr.wouldGoNegative')}</span>}
                    </div>
                  )}
                  <div className="cr-meta"><IconInvoice s={12} />{r.reason}</div>
                  <div className="cr-meta cr-by">{trD('cr.requestedBy', { who: r.requestedBy ? r.requestedBy.name : '—' })}{r.createdAt ? ' · ' + fmtDT(r.createdAt) : ''}</div>
                  {r.status === 'rejected' && r.decisionNote && <div className="cr-meta cr-rej"><IconClose s={12} />{trD('cr.rejectedNote', { note: r.decisionNote })}{r.decidedBy ? ' · ' + r.decidedBy.name : ''}</div>}
                  {r.status === 'approved' && r.decidedBy && <div className="cr-meta cr-ok"><IconCheck s={12} />{trD('cr.approvedBy', { who: r.decidedBy.name })}</div>}
                  {r.status === 'pending' && (
                    <div className="cr-actions">
                      <button type="button" className="btn btn-ghost btn-sm cr-reject" disabled={busy} onClick={() => { setRejFor(r); setRejNote(''); }}><IconClose s={14} />{trD('cr.reject')}</button>
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => approve(r)}><IconCheck s={14} />{trD('cr.approve')}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {rejFor && (
        <div className="modal-scrim" onClick={() => setRejFor(null)} style={{ zIndex: 210 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('cr.rejectT')}</div><button className="jp-icon" onClick={() => setRejFor(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconClose s={16} /><span>{trD('cr.rejectInfo')}</span></div>
              <label className="fld-label">{trD('cr.rejectReason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <textarea className="fld" style={{ height: 62, padding: 12, resize: 'vertical' }} value={rejNote} placeholder={trD('cr.rejectReasonPh')} onChange={(e) => setRejNote(e.target.value)} />
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setRejFor(null)}>{trD('dist.cancel')}</button><button className="btn btn-danger" disabled={!rejNote.trim() || busy} onClick={doReject}>{busy ? '…' : trD('cr.reject')}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// PENYESUAIAN report — adjustments across customers, filterable by period / fleet / reason / kind /
// status. Adjustments are their OWN line; they are never counted as revenue or Money-in.
function DistAdjustReport({ refreshKey, today, fleetScope, fleet, distFleet, setDistFleet }) {
  const [period, setPeriod] = uSx('month');
  const [from, setFrom] = uSx(today);
  const [to, setTo] = uSx(today);
  const [reason, setReason] = uSx('');
  const [kind, setKind] = uSx('');
  const [status, setStatus] = uSx('');
  const [rep, setRep] = uSx(null);
  const [loading, setLoading] = uSx(true);
  const [err, setErr] = uSx(false);
  const ef = effFleet(fleetScope, distFleet);
  uEx(() => {
    let live = true; setLoading(true); setErr(false);
    if (!(window.API && window.API.distribusi && window.API.distribusi.adjustmentReport)) { setLoading(false); setErr(true); return; }
    const pr = period === 'range' ? { from, to } : periodRange(period, today);
    const opts = { dateFrom: pr.from, dateTo: pr.to, fleet: ef };
    if (reason) opts.reason = reason; if (kind) opts.kind = kind; if (status) opts.status = status;
    window.API.distribusi.adjustmentReport(opts).then((r) => { if (live) { setRep(r); setLoading(false); } }).catch(() => { if (live) { setErr(true); setLoading(false); } });
    return () => { live = false; };
  }, [refreshKey, ef, period, from, to, reason, kind, status]);
  const periods = [['today', trD('dist.perToday')], ['week', trD('dist.per7d')], ['month', trD('dist.perMonth')], ['range', trD('dist.perRange')]];
  const data = (rep && rep.data) || [];
  const exportCsv = () => {
    const rows = [[trD('adj.reportTitle')], [], [trD('adj.colDate'), trD('adj.colCustomer'), trD('adj.colKind'), trD('adj.colChange'), trD('adj.colReason'), trD('adj.colBy'), trD('adj.colApprovedBy'), trD('adj.colStatus')]];
    data.forEach((a) => rows.push([fmtDT(a.createdAt), a.customerName || '', a.kind, a.before + ' -> ' + a.after, adjReasonLabel(a.reason), a.createdByName || '', a.approvedByName || '', a.status]));
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'penyesuaian.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="dist-dash screen-enter dist-report">
      <div className="no-print"><FleetBar fleetScope={fleetScope} fleet={fleet} value={distFleet} onChange={setDistFleet} /></div>
      <div className="dist-tx-toolbar no-print">
        <div className="dist-chips">{periods.map(([k, l]) => <button key={k} type="button" className={`dist-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {period === 'range' && <div className="dist-period-range"><DP.DateField value={from} onChange={setFrom} max={to || today} /><span>–</span><DP.DateField value={to} onChange={setTo} min={from || undefined} max={today} /></div>}
        <UI.Dropdown value={kind} options={[{ value: '', label: trD('adj.allKinds') }, { value: 'galon', label: trD('adj.kindGalon') }, { value: 'bon', label: trD('adj.kindBon') }]} onChange={setKind} />
        <UI.Dropdown value={reason} options={[{ value: '', label: trD('adj.allReasons') }].concat(ADJ_REASONS.map((r) => ({ value: r, label: adjReasonLabel(r) })))} onChange={setReason} />
        <UI.Dropdown value={status} options={[{ value: '', label: trD('adj.allStatus') }, { value: 'pending', label: trD('adj.pending') }, { value: 'approved', label: 'Approved' }, { value: 'reversed', label: trD('adj.reversedBadge') }]} onChange={setStatus} />
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" disabled={!data.length} onClick={() => window.print()}><IconDownload s={14} />{trD('dist.print')}</button>
        <button type="button" className="btn btn-ghost" disabled={!data.length} onClick={exportCsv}><IconDownload s={14} style={{ transform: 'rotate(180deg)' }} />{trD('rep.csv')}</button>
      </div>
      <div className="dist-report-head"><div><b>{trD('adj.reportTitle')}</b></div></div>
      {loading ? <div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div>
        : err ? <div className="card"><div className="dist-empty">{trD('dist.loadErr')}</div></div>
        : (<>
          <div className="dist-cd-stats" style={{ marginBottom: 12 }}>
            <div><div className="dist-cd-slbl">{trD('adj.repCount')}</div><div className="dist-cd-sval">{numX(rep.summary.count)}</div></div>
            <div><div className="dist-cd-slbl">{trD('adj.repGalon')}</div><div className="dist-cd-sval">{rep.summary.galonDelta >= 0 ? '+' : ''}{numX(rep.summary.galonDelta)}</div></div>
            <div><div className="dist-cd-slbl">{trD('adj.repBon')}</div><div className="dist-cd-sval">{rep.summary.bonDelta >= 0 ? '+' : ''}{rpFull(rep.summary.bonDelta)}</div></div>
          </div>
          <div className="card dist-card">
            {data.length === 0 ? <div className="dist-empty">{trD('dist.noTxn')}</div> : (
              <div className="run-table-wrap"><table className="run-table">
                <thead><tr><th>{trD('adj.colDate')}</th><th>{trD('adj.colCustomer')}</th><th>{trD('adj.colKind')}</th><th className="num">{trD('adj.colChange')}</th><th>{trD('adj.colReason')}</th><th>{trD('adj.colBy')}</th><th>{trD('adj.colApprovedBy')}</th><th>{trD('adj.colStatus')}</th></tr></thead>
                <tbody>{data.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDT(a.createdAt)}</td><td>{a.customerName || '—'}</td><td>{a.kind === 'bon' ? trD('adj.kindBon') : trD('adj.kindGalon')}</td>
                    <td className="num tnum">{(a.kind === 'bon' ? rpFull(a.before) : numX(a.before))} → {(a.kind === 'bon' ? rpFull(a.after) : numX(a.after))}</td>
                    <td>{adjReasonLabel(a.reason)}</td><td>{a.createdByName || '—'}</td><td>{a.approvedByName || '—'}</td>
                    <td>{a.status === 'pending' ? trD('adj.pending') : a.status === 'reversed' ? trD('adj.reversedBadge') : 'OK'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>)}
    </div>
  );
}

window.DIST = { Dashboard: DistDashboard, Transactions: DistTransactions, Customers: DistCustomers, Integration: DistIntegration, Prices: DistPrices, Audit: DistAudit, Gallon: DistGallon, Deliveries: DistDeliveries, DeliveryReport: DistDeliveryReport, LossReport: DistLossReport, AdjustReport: DistAdjustReport, ChangeRequests: DistChangeRequests };
