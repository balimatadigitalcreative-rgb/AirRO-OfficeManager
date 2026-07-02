/* global React, HRD, FIN */
const { useState: uShr, useEffect: uEhr } = React;
const trH = (k, v) => window.t(k, v);
function IcH(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
const rp = (n) => FIN.fmt(n);
const pctStr = (v) => (Math.round(v * 10000) / 100) + '%';

// Allowance components: fk = staff/form field, ck = compute() result key, t = i18n label.
const ALLOW_LIST = [
  { fk: 'tjKinerja', ck: 'tjKinerja', t: 'hrd.tjKinerja' },
  { fk: 'tjProfesi', ck: 'tjProfesi', t: 'hrd.tjProfesi' },
  { fk: 'tjRumahDinas', ck: 'tjRumahDinas', t: 'hrd.tjRumahDinas' },
  { fk: 'tjBpjsKes', ck: 'tjBpjsKes', t: 'hrd.tjBpjsKes' },
  { fk: 'tjBpjsTk', ck: 'tjBpjsTk', t: 'hrd.tjBpjsTk' },
  { fk: 'allowance', ck: 'allowOther', t: 'hrd.allowOther' },
];

function SBRow({ label, val, strong, neg, muted, note }) {
  return (
    <div className={`sb-row ${strong ? 'strong' : ''} ${muted ? 'muted' : ''}`}>
      <span className="sb-lbl">{label}{note && <em> · {note}</em>}</span>
      <span className={`tnum ${neg ? 'amt-neg' : ''}`}>{neg && val ? '− ' : ''}{rp(val)}</span>
    </div>
  );
}

/* ---------------- Summary cards ---------------- */
function HrdSummary({ t, monLabel }) {
  const cards = [
    { label: trH('hrd.takehome'), value: rp(t.takeHome), icon: 'IconWallet', bg: 'var(--mint-100)', fg: 'var(--green-800)', sub: trH('hrd.employees', { n: t.count }) },
    { label: trH('hrd.empDeduct'), value: rp(t.employeeDeduct), icon: 'IconCoinOut', bg: '#EAF1F4', fg: '#5E7A88', sub: trH('hrd.withheld') },
    { label: trH('hrd.employerBpjs'), value: rp(t.employerContrib), icon: 'IconShield', bg: 'var(--sand-soft)', fg: 'var(--warn)', sub: trH('hrd.contrib') },
    { label: trH('hrd.totalCost'), value: rp(t.companyCost), icon: 'IconUsersGroup', bg: 'var(--green-800)', fg: '#fff', dark: true, sub: monLabel },
  ];
  return (
    <div className="hrd-summary">
      {cards.map((c, i) => (
        <div key={i} className={`card hrd-sum ${c.dark ? 'dark' : ''}`}>
          <span className="icon-tile" style={{ background: c.dark ? 'rgba(255,255,255,.14)' : c.bg, color: c.dark ? '#fff' : c.fg }}>{IcH(c.icon, { s: 19 })}</span>
          <div className={`tnum ${c.dark ? '' : ''}`} style={{ fontSize: 21, fontWeight: 800, marginTop: 12, whiteSpace: 'nowrap', color: c.dark ? '#fff' : 'var(--ink)' }}>{c.value}</div>
          <div style={{ fontSize: 12.5, color: c.dark ? 'rgba(255,255,255,.7)' : 'var(--text-mut)', marginTop: 2 }}>{c.label}</div>
          <div style={{ fontSize: 11, color: c.dark ? 'rgba(255,255,255,.5)' : 'var(--text-faint)', marginTop: 2 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Editable BPJS rates panel ---------------- */
function RatePct({ label, value, onChange }) {
  return (
    <div className="rate-item">
      <label>{label}</label>
      <div className="rate-input">
        <input inputMode="decimal" value={(Math.round(value * 10000) / 100)} onChange={(e) => onChange((+e.target.value || 0) / 100)} />
        <span>%</span>
      </div>
    </div>
  );
}
function RateMoney({ label, value, onChange }) {
  return (
    <div className="rate-item">
      <label>{label}</label>
      <div className="rate-input wide">
        <span className="rm-rp">Rp</span>
        <input inputMode="numeric" value={value ? value.toLocaleString('id-ID') : ''} onChange={(e) => onChange(+e.target.value.replace(/\D/g, '') || 0)} />
      </div>
    </div>
  );
}
function RatesPanel({ rates, onChange, onReset }) {
  const set = (patch) => onChange({ ...rates, ...patch });
  return (
    <div className="card rates-panel">
      <div className="rates-head">
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{trH('hrd.ratesTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mut)', marginTop: 2 }}>{trH('hrd.ratesSub')}</div>
        </div>
        <button className="btn btn-ghost" onClick={onReset}>{trH('set.restore')}</button>
      </div>
      <div className="rates-grid">
        <div className="rate-group">
          <div className="rate-group-title">BPJS Kesehatan</div>
          <RatePct label={trH('hrd.employer')} value={rates.kesEmployer} onChange={(v) => set({ kesEmployer: v })} />
          <RatePct label={trH('hrd.employee')} value={rates.kesEmployee} onChange={(v) => set({ kesEmployee: v })} />
          <RateMoney label={trH('hrd.ceiling')} value={rates.kesCeiling} onChange={(v) => set({ kesCeiling: v })} />
        </div>
        <div className="rate-group">
          <div className="rate-group-title">JHT · Hari Tua</div>
          <RatePct label={trH('hrd.employer')} value={rates.jhtEmployer} onChange={(v) => set({ jhtEmployer: v })} />
          <RatePct label={trH('hrd.employee')} value={rates.jhtEmployee} onChange={(v) => set({ jhtEmployee: v })} />
        </div>
        <div className="rate-group">
          <div className="rate-group-title">JP · Pensiun</div>
          <RatePct label={trH('hrd.employer')} value={rates.jpEmployer} onChange={(v) => set({ jpEmployer: v })} />
          <RatePct label={trH('hrd.employee')} value={rates.jpEmployee} onChange={(v) => set({ jpEmployee: v })} />
          <RateMoney label={trH('hrd.ceiling')} value={rates.jpCeiling} onChange={(v) => set({ jpCeiling: v })} />
        </div>
        <div className="rate-group">
          <div className="rate-group-title">JKM · Kematian</div>
          <RatePct label={trH('hrd.employer')} value={rates.jkm} onChange={(v) => set({ jkm: v })} />
          <div className="rate-item">
            <label>{trH('hrd.workdays')}</label>
            <div className="rate-input"><input inputMode="numeric" value={rates.workDays || 26} onChange={(e) => set({ workDays: Math.max(1, +e.target.value.replace(/\D/g, '') || 1) })} /><span>d</span></div>
          </div>
          <div className="rate-note">{trH('hrd.jkkNote', { a: pctStr(rates.jkk['Very Low']), b: pctStr(rates.jkk['Very High']) })}</div>
        </div>
        <div className="rate-group">
          <div className="rate-group-title">{trH('hrd.bpjsEnrollTitle')}</div>
          <div className="rate-item">
            <label>{trH('hrd.bpjsMode')}</label>
            <UI.Dropdown compact value={rates.bpjsProrationMode || 'prorate'} options={[{ value: 'prorate', label: trH('hrd.bpjsModeProrate') }, { value: 'full', label: trH('hrd.bpjsModeFull') }, { value: 'next', label: trH('hrd.bpjsModeNext') }]} onChange={(v) => set({ bpjsProrationMode: v })} />
          </div>
          <div className="rate-note">{trH('hrd.bpjsModeNote')}</div>
        </div>
        <div className="rate-group">
          <div className="rate-group-title">{trH('hrd.latePenalty')}</div>
          <div className="rate-item">
            <label>{trH('hrd.lateStart')}</label>
            <UI.TimePicker compact value={rates.lateStart || '08:00'} onChange={(v) => set({ lateStart: v })} />
          </div>
          <div className="rate-item">
            <label>{trH('hrd.lateBasis')}</label>
            <UI.Dropdown compact value={rates.lateBasis || 'minute'} options={[{ value: 'minute', label: trH('hrd.perMinute') }, { value: 'hour', label: trH('hrd.perHour') }]} onChange={(v) => set({ lateBasis: v })} />
          </div>
          <div className="rate-item">
            <label>{rates.lateBasis === 'hour' ? trH('hrd.latePerHour') : trH('hrd.latePerMin')}</label>
            <div className="rate-input wide"><span className="rm-rp">Rp</span><input inputMode="numeric" value={(rates.latePerMin || 0).toLocaleString('id-ID')} onChange={(e) => set({ latePerMin: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
          </div>
          <div className="rate-note">{trH('hrd.lateNote')}</div>
        </div>
        <div className="rate-group">
          <div className="rate-group-title">{trH('hrd.overtime')}</div>
          <div className="rate-item">
            <label>{trH('hrd.otPerHour')}</label>
            <div className="rate-input wide"><span className="rm-rp">Rp</span><input inputMode="numeric" value={(rates.otPerHour || 0).toLocaleString('id-ID')} onChange={(e) => set({ otPerHour: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
          </div>
          <div className="rate-item">
            <label>{trH('hrd.otOrientation')}</label>
            <div className="rate-input wide"><span className="rm-rp">Rp</span><input inputMode="numeric" value={(rates.otOrientation || 0).toLocaleString('id-ID')} onChange={(e) => set({ otOrientation: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
          </div>
          <div className="rate-item">
            <label>{trH('hrd.workEnd')}</label>
            <UI.TimePicker compact value={rates.workEnd || '17:00'} onChange={(v) => set({ workEnd: v })} />
          </div>
          <div className="rate-item">
            <label>{trH('hrd.otMinHours')}</label>
            <div className="rate-input"><input inputMode="decimal" value={rates.otMinHours != null ? rates.otMinHours : 1} onChange={(e) => set({ otMinHours: Math.max(0, +e.target.value.replace(/[^\d.]/g, '') || 0) })} /><span>h</span></div>
          </div>
          <div className="rate-item">
            <label>{trH('hrd.otRounding')}</label>
            <UI.Dropdown compact value={rates.otRounding || 'down-hour'} options={[{ value: 'down-hour', label: trH('hrd.otRoundDown') }, { value: 'per-30min', label: trH('hrd.otRound30') }, { value: 'exact', label: trH('hrd.otRoundExact') }]} onChange={(v) => set({ otRounding: v })} />
          </div>
          <div className="rate-note">{trH('hrd.otOrientationNote')}</div>
        </div>
        <div className="rate-group">
          <div className="rate-group-title">{trH('hrd.sundayTitle')}</div>
          <div className="rate-item">
            <label>{trH('hrd.sundayMode')}</label>
            <UI.Dropdown compact value={rates.sundayMode || 'off'} options={[{ value: 'off', label: trH('hrd.sunOff') }, { value: 'rate', label: trH('hrd.sunRate') }, { value: 'allHours', label: trH('hrd.sunAll') }, { value: 'allHoursRate', label: trH('hrd.sunAllRate') }]} onChange={(v) => set({ sundayMode: v })} />
          </div>
          {(rates.sundayMode === 'rate' || rates.sundayMode === 'allHoursRate') && (
            <React.Fragment>
              <div className="rate-item">
                <label>{trH('hrd.sundayMult')}</label>
                <div className="rate-input"><input inputMode="decimal" value={rates.sundayMultiplier != null ? rates.sundayMultiplier : 2} onChange={(e) => set({ sundayMultiplier: Math.max(0, +e.target.value.replace(/[^\d.]/g, '') || 0) })} /><span>×</span></div>
              </div>
              <div className="rate-item">
                <label>{trH('hrd.otSundayPerHour')}</label>
                <div className="rate-input wide"><span className="rm-rp">Rp</span><input inputMode="numeric" value={(rates.otSundayPerHour || 0).toLocaleString('id-ID')} onChange={(e) => set({ otSundayPerHour: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
              </div>
            </React.Fragment>
          )}
          <div className="rate-note">{trH('hrd.sundayNote')}</div>
        </div>
        <div className="rate-group">
          <div className="rate-group-title">{trH('hrd.cashbon')}</div>
          <div className="rate-item">
            <label>{trH('hrd.cashbonWeek')}</label>
            <UI.Dropdown compact value={rates.cashbonWeekMode || 'cutoff'} options={[{ value: 'cutoff', label: trH('hrd.cashbonWeekCutoff') }, { value: 'calendar', label: trH('hrd.cashbonWeekCal') }]} onChange={(v) => set({ cashbonWeekMode: v })} />
          </div>
          <div className="rate-note">{trH('hrd.cashbonNote')}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Staff edit modal ---------------- */
// Shared add/edit form for an employee — used BOTH in Payroll (variant="payroll",
// salary emphasized) and the Employee Directory / detail (variant="identity",
// identity emphasized). Both write the SAME fields to one staff object so the
// single hrdStaff array stays the only source of truth.
function StaffModal({ staff, rates, onSave, onClose, variant, departments }) {
  const ident = variant === 'identity';
  // Dept options come from the HRD-managed list; include the staff's current dept
  // even if it was removed (legacy) so the dropdown never loses their value.
  const deptList = (() => { const base = (departments && departments.length ? departments : HRD.loadDepartments()).slice(); if (staff && staff.dept && base.indexOf(staff.dept) < 0) base.push(staff.dept); return base; })();
  const [f, setF] = uShr(staff);
  const [showSalary, setShowSalary] = uShr(!ident);   // identity: salary collapsed
  const [showIdent, setShowIdent] = uShr(true);        // payroll: identity shown below salary
  const [nipBusy, setNipBusy] = uShr(false);
  uEhr(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (patch) => setF({ ...f, ...patch });
  const today = (window.FIN && FIN.TODAY) || new Date().toLocaleDateString('en-CA');
  const dedList = (Array.isArray(f.deductions) ? f.deductions : []).filter((d) => !d.auto);
  const autoDed = (Array.isArray(f.deductions) ? f.deductions : []).filter((d) => d.auto);
  const updDed = (i, patch) => { const l = dedList.slice(); l[i] = { ...l[i], ...patch }; set({ deductions: [...l, ...autoDed] }); };
  const addDed = () => set({ deductions: [...dedList, { id: HRD.newDedId(), label: '', amount: 0 }, ...autoDed] });
  const removeDed = (i) => { const l = dedList.slice(); l.splice(i, 1); set({ deductions: [...l, ...autoDed] }); };
  const valid = (f.name || '').trim();   // name required; salary may be 0 ("belum diatur")
  const c = HRD.compute(f, rates, HRD.currentPeriod());   // preview against the current 16→15 period
  const dr = Math.round(c.dailyRate);
  const salaryUnset = !(+f.base > 0);
  // NIP is allocated server-side (race-safe & unique); never typed manually.
  const genNip = async () => {
    if (nipBusy) return;
    if (!(window.API && window.API.employees)) { alert(trH('co.nipOffline')); return; }
    setNipBusy(true);
    try {
      const r = await window.API.employees.nip({ office: f.office || 'AIRRO', contractStart: f.contractStart || undefined });
      if (r && r.data && r.data.nip) set({ nip: r.data.nip }); else alert(trH('co.nipOffline'));
    } catch (e) { alert(trH('co.nipOffline')); }
    finally { setNipBusy(false); }
  };
  const money = (label, key) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="fld-label" style={{ marginTop: 0 }}>{label}</label>
      <div className="amt-input" style={{ padding: '8px 13px' }}>
        <span className="amt-rp" style={{ fontSize: 14 }}>Rp</span>
        <input inputMode="numeric" style={{ fontSize: 16 }} value={f[key] ? (+f[key]).toLocaleString('id-ID') : ''} onChange={(e) => set({ [key]: +e.target.value.replace(/\D/g, '') || 0 })} />
      </div>
    </div>
  );

  // ── Identity block (grouped Identitas / Kepegawaian / Alamat / BPJS) ──
  const identityBlock = (
    <div className="ed-acc-form" style={{ marginTop: 6 }}>
      <div className="ed-grp-t">{trH('co.grpIdentity')}</div>
      <label className="ed-af ed-af-wide"><span>{trH('co.nip')}</span>
        <div className="ed-nip-row">
          <input value={f.nip || ''} readOnly placeholder="—" />
          <button type="button" className="ed-nip-btn" disabled={nipBusy} onClick={genNip}>{nipBusy ? trH('co.nipBusy') : (f.nip ? trH('co.regenNip') : trH('co.genNip'))}</button>
        </div>
      </label>
      <label className="ed-af"><span>{trH('co.office')}</span><UI.Dropdown value={f.office || 'AIRRO'} options={['AIRRO', 'NSN', 'MFG']} onChange={(v) => set({ office: v })} /></label>
      <label className="ed-af"><span>{trH('co.maritalStatus')}</span><UI.Dropdown value={f.maritalStatus || 'TK'} options={[{ value: 'TK', label: trH('co.mTK') }, { value: 'K', label: trH('co.mK') }, { value: 'Cerai', label: trH('co.mCerai') }]} onChange={(v) => set({ maritalStatus: v })} /></label>
      <label className="ed-af"><span>NIK</span><input value={f.nik || ''} inputMode="numeric" onChange={(e) => set({ nik: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="ed-af"><span>{trH('co.noKk')}</span><input value={f.noKk || ''} inputMode="numeric" onChange={(e) => set({ noKk: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="ed-af"><span>{trH('co.birthPlace')}</span><input value={f.birthPlace || ''} onChange={(e) => set({ birthPlace: e.target.value })} /></label>
      <label className="ed-af"><span>{trH('co.birthDate')}</span><DP.DateField value={f.birthDate || ''} max={today} onChange={(v) => set({ birthDate: v })} /></label>
      <label className="ed-af"><span>{trH('hrd.religion')}</span><UI.Dropdown value={f.religion || 'Islam'} options={HRD.RELIGIONS} onChange={(v) => set({ religion: v })} /></label>

      <div className="ed-grp-t">{trH('co.grpContract')}</div>
      <label className="ed-af"><span>{trH('hrd.position')}</span><input value={f.pos || ''} placeholder="e.g. Sopir" onChange={(e) => set({ pos: e.target.value })} /></label>
      <label className="ed-af"><span>{trH('hrd.dept')}</span><UI.Dropdown value={f.dept || deptList[0]} options={deptList} onChange={(v) => set({ dept: v })} /></label>
      <label className="ed-af"><span>{trH('co.empStatus')}</span><UI.Dropdown value={f.status || 'Tetap'} options={['Tetap', 'Kontrak', 'Probation', 'Harian']} onChange={(v) => set({ status: v })} /></label>
      <label className="ed-af"><span>{trH('co.noSurat')}</span><input value={f.noSurat || ''} onChange={(e) => set({ noSurat: e.target.value })} /></label>
      <label className="ed-af"><span>{trH('co.joined')}</span><DP.DateField value={f.joinedDate || ''} max={today} onChange={(v) => set({ joinedDate: v })} /></label>
      <label className="ed-af"><span>{trH('co.contractStart')}</span><DP.DateField value={f.contractStart || ''} allowFuture onChange={(v) => set({ contractStart: v })} /></label>
      <label className="ed-af"><span>{trH('co.contractEnd')}</span><DP.DateField value={f.contractEnd || ''} allowFuture onChange={(v) => set({ contractEnd: v })} /></label>

      <div className="ed-grp-t">{trH('co.grpAddress')}</div>
      <label className="ed-af ed-af-wide"><span>{trH('co.addressKtp')}</span><input value={f.addressKtp || ''} onChange={(e) => set({ addressKtp: e.target.value })} /></label>
      <label className="ed-af ed-af-wide"><span>{trH('co.addressDomisili')}</span><input value={f.addressDomisili || ''} onChange={(e) => set({ addressDomisili: e.target.value })} /></label>
      <label className="ed-af"><span>{trH('co.phone')}</span><input value={f.phone || ''} inputMode="numeric" onChange={(e) => set({ phone: e.target.value.replace(/[^\d]/g, '') })} /></label>

      <div className="ed-grp-t">{trH('co.grpBpjs')}</div>
      <label className="ed-af"><span>{trH('co.noBpjsKes')}</span><input value={f.noBpjsKes || ''} inputMode="numeric" onChange={(e) => set({ noBpjsKes: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="ed-af"><span>{trH('co.noBpjsTk')}</span><input value={f.noBpjsTk || ''} inputMode="numeric" onChange={(e) => set({ noBpjsTk: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="ed-af"><span>{trH('co.bpjsKesEnroll')}</span>
        <label className="bpjs-toggle"><input type="checkbox" checked={f.bpjsKesEnrolled !== false} onChange={(e) => set({ bpjsKesEnrolled: e.target.checked })} /><span>{f.bpjsKesEnrolled !== false ? trH('co.enrolledYes') : trH('co.enrolledNo')}</span></label>
      </label>
      {f.bpjsKesEnrolled !== false && <label className="ed-af"><span>{trH('co.bpjsKesStart')}</span><DP.DateField value={f.bpjsKesStart || ''} allowFuture onChange={(v) => set({ bpjsKesStart: v })} /></label>}
      <label className="ed-af"><span>{trH('co.bpjsTkEnroll')}</span>
        <label className="bpjs-toggle"><input type="checkbox" checked={f.bpjsTkEnrolled !== false} onChange={(e) => set({ bpjsTkEnrolled: e.target.checked })} /><span>{f.bpjsTkEnrolled !== false ? trH('co.enrolledYes') : trH('co.enrolledNo')}</span></label>
      </label>
      {f.bpjsTkEnrolled !== false && <label className="ed-af"><span>{trH('co.bpjsTkStart')}</span><DP.DateField value={f.bpjsTkStart || ''} allowFuture onChange={(v) => set({ bpjsTkStart: v })} /></label>}
      <label className="ed-af"><span>{trH('co.bank')}</span><UI.Dropdown value={f.bank || 'BCA'} options={['BCA', 'BRI', 'Mandiri', 'BNI', 'BSI', 'CIMB']} onChange={(v) => set({ bank: v })} /></label>
      <label className="ed-af"><span>{trH('co.accNo')}</span><input value={f.account || ''} inputMode="numeric" onChange={(e) => set({ account: e.target.value.replace(/\D/g, '') })} /></label>
    </div>
  );

  // ── Salary block (base / allowance / jp / risk / pph / deductions) ──
  const salaryBlock = (
    <div className="staff-salary-fields">
      <div style={{ marginTop: 4 }}>{money(trH('hrd.basesal'), 'base')}</div>
      <div className="hrd-allow-title">{trH('hrd.allowances')}</div>
      <div className="hrd-allow-grid">{ALLOW_LIST.map((a) => <React.Fragment key={a.fk}>{money(trH(a.t), a.fk)}</React.Fragment>)}</div>
      <label className="hrd-toggle">
        <input type="checkbox" checked={!!f.jp} onChange={(e) => set({ jp: e.target.checked })} />
        <span>{trH('hrd.enrollJp')}</span>
      </label>
      <div style={{ display: 'flex', gap: 12, marginTop: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="fld-label" style={{ marginTop: 0 }}>{trH('hrd.riskClass')}</label>
          <UI.Dropdown value={f.risk} options={HRD.RISK_LEVELS} onChange={(v) => set({ risk: v })} />
        </div>
        {money(trH('hrd.pph'), 'pph')}
      </div>
      <div className="hrd-deduct-block">
        <div className="hrd-deduct-title">{trH('hrd.attendDeduct')}</div>
        <label className="fld-label" style={{ marginTop: 0 }}>{trH('hrd.unpaiddays')}</label>
        <input className="fld" style={{ maxWidth: 140 }} inputMode="numeric" value={f.offDays || 0} onChange={(e) => set({ offDays: Math.max(0, +e.target.value.replace(/\D/g, '') || 0) })} />
        <div className="fld-hint">{f.offDays > 0 ? trH('hrd.dailyHintOff', { dr: rp(dr), wd: rates.workDays || 26, n: f.offDays, ded: rp(c.absenceDeduct) }) : trH('hrd.dailyHint', { dr: rp(dr), wd: rates.workDays || 26 })}</div>

        <div className="ded-list-head">{trH('hrd.otherDeducts')} <span>{trH('hrd.otherHint')}</span></div>
        {dedList.length === 0 && <div className="ded-empty">{trH('hrd.noDeducts')}</div>}
        {dedList.map((d, i) => (
          <div className="ded-row" key={d.id || i}>
            <input className="fld ded-label" value={d.label} placeholder={trH('hrd.dedPh', { n: i + 1 })} onChange={(e) => updDed(i, { label: e.target.value })} />
            <div className="amt-input ded-amt" style={{ padding: '8px 11px' }}>
              <span className="amt-rp" style={{ fontSize: 13 }}>Rp</span>
              <input inputMode="numeric" style={{ fontSize: 14 }} value={d.amount ? (+d.amount).toLocaleString('id-ID') : ''} onChange={(e) => updDed(i, { amount: +e.target.value.replace(/\D/g, '') || 0 })} />
            </div>
            <button className="icon-btn del" title="Remove" onClick={() => removeDed(i)}><IconClose s={15} /></button>
          </div>
        ))}
        <button className="add-ded-btn" onClick={addDed}><IconPlus s={15} />{trH('hrd.addDeduct')}</button>
      </div>
    </div>
  );

  const breakdown = (
    <div className="staff-breakdown">
      <div className="sb-head"><IconInvoice s={16} />{trH('hrd.live')}</div>
      <div className="sb-sec">{trH('hrd.earnings')}</div>
      <SBRow label={trH('hrd.baseShort')} val={c.base} />
      {ALLOW_LIST.map((a) => c[a.ck] > 0 && <SBRow key={a.ck} label={trH(a.t)} val={c[a.ck]} />)}
      <SBRow label={trH('hrd.gross')} val={c.gross} strong />
      <div className="sb-sec">{trH('hrd.deductFrom')} <em>{trH('hrd.deductFromEm')}</em></div>
      {c.kesEnrolled && c.kesFactor > 0 && <SBRow label={`BPJS Kesehatan · ${pctStr(rates.kesEmployee)}`} val={c.kesEmployee} neg note={c.kesFactor < 1 ? trH('hrd.prorataSince', { d: c.bpjsKesStart }) : null} />}
      {c.tkEnrolled && c.tkFactor > 0 && <SBRow label={`JHT · ${pctStr(rates.jhtEmployee)}`} val={c.jhtEmployee} neg note={c.tkFactor < 1 ? trH('hrd.prorataSince', { d: c.bpjsTkStart }) : null} />}
      {c.tkEnrolled && c.tkFactor > 0 && (f.jp
        ? <SBRow label={`JP · ${pctStr(rates.jpEmployee)}`} val={c.jpEmployee} neg />
        : <SBRow label="JP" val={0} muted note={trH('hrd.notenroll')} />)}
      {c.pph > 0 && <SBRow label="PPh 21" val={c.pph} neg />}
      {c.absenceDeduct > 0 && <SBRow label={trH('hrd.unpaidleave', { n: c.offDays, dr: rp(dr) })} val={c.absenceDeduct} neg />}
      {c.deductions.filter((d) => +d.amount > 0).map((d, i) => <SBRow key={d.id || i} label={d.label || trH('hrd.dedPh', { n: i + 1 })} val={+d.amount} neg />)}
      <SBRow label={trH('hrd.totaldeduct')} val={c.employeeDeduct} strong neg />
      <div className="sb-thp"><span>{trH('hrd.thp')}</span><span className="tnum">{rp(c.takeHome)}</span></div>
      <div className="sb-sec">{trH('hrd.employerTop')} <em>{trH('hrd.bpjsParen')}</em></div>
      {c.kesEnrolled && c.kesFactor > 0 && <SBRow label={`Kesehatan · ${pctStr(rates.kesEmployer)}`} val={c.kesEmployer} note={c.kesFactor < 1 ? trH('hrd.prorataSince', { d: c.bpjsKesStart }) : null} />}
      {c.tkEnrolled && c.tkFactor > 0 && <SBRow label={`JHT · ${pctStr(rates.jhtEmployer)}`} val={c.jhtEmployer} />}
      {c.tkEnrolled && c.tkFactor > 0 && f.jp && <SBRow label={`JP · ${pctStr(rates.jpEmployer)}`} val={c.jpEmployer} />}
      {c.tkEnrolled && c.tkFactor > 0 && <SBRow label={`JKK · ${pctStr(c.jkkRate)} (${f.risk})`} val={c.jkk} />}
      {c.tkEnrolled && c.tkFactor > 0 && <SBRow label={`JKM · ${pctStr(rates.jkm)}`} val={c.jkm} />}
      {(!c.kesEnrolled || c.kesFactor === 0) && (!c.tkEnrolled || c.tkFactor === 0) && <SBRow label={trH('hrd.bpjsNone')} val={0} muted />}
      <SBRow label={trH('hrd.totalemployer')} val={c.employerContrib} strong />
      <div className="sb-cost"><span>{trH('hrd.totalcompany')}</span><span className="tnum">{rp(c.companyCost)}</span></div>
    </div>
  );

  const nameField = (
    <div>
      <label className="fld-label" style={{ marginTop: 0 }}>{trH('hrd.fullname')}</label>
      <input className="fld" value={f.name} placeholder="e.g. Budi Santoso" onChange={(e) => set({ name: e.target.value })} />
    </div>
  );

  // ── New-hire path (only when adding). Drives `stage`, which in turn decides the
  //    bucket: orientation/dw → Data Orientasi/DW (daily wage, no monthly payroll);
  //    probation/contract/permanent → Data Karyawan (monthly payroll). ──
  const stageNow = HRD.stageOf(f);
  const hirePath = HRD.isOrientationStage(f) ? 'orientation' : (stageNow === 'probation' ? 'probation' : 'contract');
  const setHirePath = (pth) => set({ stage: pth === 'orientation' ? 'orientation' : pth === 'probation' ? 'probation' : 'permanent' });
  const pathSelector = f._isNew ? (
    <div className="hire-path">
      <div className="ed-grp-t" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>{trH('hrd.newHirePath')}</div>
      <div className="hire-path-seg">
        {[['orientation', 'hrd.pathOri'], ['probation', 'hrd.pathProb'], ['contract', 'hrd.pathContract']].map(([pth, k]) => (
          <button key={pth} type="button" className={`hire-path-btn ${hirePath === pth ? 'on' : ''}`} onClick={() => setHirePath(pth)}>{trH(k)}</button>
        ))}
      </div>
      <div className="hire-path-hint">{trH('hrd.pathHint_' + hirePath)}</div>
      {hirePath === 'contract' && (
        <label className="ed-af" style={{ marginTop: 8 }}><span>{trH('hrd.contractType')}</span>
          <UI.Dropdown value={stageNow === 'contract' ? 'contract' : 'permanent'} options={[{ value: 'permanent', label: trH('stage.permanent') }, { value: 'contract', label: trH('stage.contract') }]} onChange={(v) => set({ stage: v })} />
        </label>
      )}
    </div>
  ) : null;

  // ── Orientation/DW block (new hires start in orientation OR daily-worker (DW) →
  //    paid a daily wage via attendance, excluded from monthly payroll until
  //    graduated to a payroll stage) ──
  const oo = f.orientation || {};
  const setOri = (patch) => set({ orientation: { ...(f.orientation || {}), ...patch } });
  const oriDays = +oo.durationDays || 7;
  const oriTotal = oriDays * (+oo.dailyWage || 0);
  const orientationBlock = HRD.isOrientationStage(f) ? (
    <div className="ori-newhire">
      <div className="ed-grp-t">{trH('ori.section')}</div>
      <div className="ori-nh-hint">{trH('ori.newHireHint')}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="ed-af"><span>{trH('ori.bucketStage')}</span><UI.Dropdown value={HRD.stageOf(f)} options={[{ value: 'orientation', label: trH('stage.orientation') }, { value: 'dw', label: trH('stage.dw') }]} onChange={(v) => set({ stage: v })} /></label>
        <label className="ed-af"><span>{trH('ori.start')}</span><DP.DateField value={oo.startDate || ''} allowFuture onChange={(v) => setOri({ startDate: v })} /></label>
        {HRD.stageOf(f) === 'orientation' && (
          <div style={{ width: 120 }}>
            <label className="fld-label" style={{ marginTop: 0 }}>{trH('ori.durationDays')}</label>
            <input className="fld" inputMode="numeric" value={oriDays} onChange={(e) => setOri({ durationDays: Math.max(1, +e.target.value.replace(/\D/g, '') || 7) })} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 150 }}>
          <label className="fld-label" style={{ marginTop: 0 }}>{trH('ori.dailyWage')}</label>
          <div className="amt-input" style={{ padding: '8px 13px' }}>
            <span className="amt-rp" style={{ fontSize: 14 }}>Rp</span>
            <input inputMode="numeric" style={{ fontSize: 16 }} value={oo.dailyWage ? (+oo.dailyWage).toLocaleString('id-ID') : ''} onChange={(e) => setOri({ dailyWage: +e.target.value.replace(/\D/g, '') || 0 })} />
          </div>
        </div>
      </div>
      <div className="ori-nh-total">{HRD.stageOf(f) === 'orientation' ? <React.Fragment>{trH('ori.estTotal')}: <b>{rp(oriTotal)}</b> <span>({rp(+oo.dailyWage || 0)} × {oriDays} {trH('ori.days')})</span></React.Fragment> : <span>{trH('ori.dwHint')}</span>}</div>
    </div>
  ) : null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={`modal-card wide ${ident ? 'staff-ident-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 700 }}>{f._isNew ? trH('hrd.addEmpT') : trH('hrd.editEmpT')}</div>
          <button className="icon-btn" onClick={onClose}><IconClose s={18} /></button>
        </div>

        {ident ? (
          /* IDENTITY-first: profile fields prominent, salary optional/collapsed */
          <div className="staff-form-single">
            {nameField}
            {pathSelector}
            {orientationBlock}
            {identityBlock}
            <div className="staff-salary-toggle">
              <button type="button" onClick={() => setShowSalary((v) => !v)}>
                <IconCoinOut s={15} />{showSalary ? trH('co.salaryHide') : trH('co.salaryOptional')}
                {salaryUnset && !showSalary && <span className="salary-unset-badge">{trH('co.salaryNotSet')}</span>}
              </button>
            </div>
            {showSalary && <div className="staff-salary-wrap">{salaryBlock}{breakdown}</div>}
          </div>
        ) : (
          /* PAYROLL-first: salary + live breakdown prominent, identity below */
          <>
            <div className="staff-edit-grid">
              <div className="staff-form">
                {nameField}
                {pathSelector}
                {orientationBlock}
                {salaryBlock}
              </div>
              {breakdown}
            </div>
            <div className="staff-salary-toggle">
              <button type="button" onClick={() => setShowIdent((v) => !v)}>
                <IconUsersGroup s={15} />{showIdent ? trH('co.identityHide') : trH('co.identityShow')}
              </button>
            </div>
            {showIdent && identityBlock}
          </>
        )}

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trH('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(f)}>{trH('hrd.saveEmp')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Payslip modal (printable) ---------------- */
function PayslipModal({ staff, calc, rates, monLabel, onClose }) {
  uEhr(() => {
    document.body.classList.add('payslip-open');
    const o = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', o);
    return () => { document.body.classList.remove('payslip-open'); window.removeEventListener('keydown', o); };
  }, []);
  const Row = ({ label, value, strong, neg, note }) => (
    <div className={`ps-row ${strong ? 'strong' : ''}`}>
      <span>{label}{note ? <em style={{ fontStyle: 'normal', color: 'var(--text-faint)', fontSize: 11, marginLeft: 5 }}>{note}</em> : null}</span><span className={`tnum ${neg ? 'amt-neg' : ''}`}>{neg ? '− ' : ''}{rp(value)}</span>
    </div>
  );
  const kesShow = calc.kesEnrolled && calc.kesFactor > 0, tkShow = calc.tkEnrolled && calc.tkFactor > 0;
  const kesNote = kesShow && calc.kesFactor < 1 ? trH('hrd.prorataSince', { d: calc.bpjsKesStart }) : null;
  const tkNote = tkShow && calc.tkFactor < 1 ? trH('hrd.prorataSince', { d: calc.bpjsTkStart }) : null;
  return (
    <div className="modal-scrim payslip-overlay" onClick={onClose}>
      <div className="payslip-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Logo s={34} />
            <div>
              <div style={{ fontFamily: 'Poppins', fontSize: 17, fontWeight: 800 }}>AirRO Reverse Osmosis</div>
              <div style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trH('hrd.payslip')} · {monLabel}</div>
            </div>
          </div>
          <div className="ps-actions">
            <button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trH('hrd.print')}</button>
            <button className="icon-btn no-print" onClick={onClose}><IconClose s={18} /></button>
          </div>
        </div>
        <div className="ps-emp">
          <div><div className="ps-emp-name">{staff.name}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{staff.pos || '—'}</div></div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-mut)' }}>JKK: <b>{staff.risk}</b><br />JP: <b>{staff.jp ? (window.I18N.lang === 'id' ? 'Ya' : 'Yes') : (window.I18N.lang === 'id' ? 'Tidak' : 'No')}</b></div>
        </div>
        <div className="ps-cols">
          <div className="ps-col">
            <div className="ps-col-title">{trH('hrd.psEarnings')}</div>
            <Row label={trH('hrd.basesal')} value={calc.base} />
            {ALLOW_LIST.map((a) => calc[a.ck] > 0 && <Row key={a.ck} label={trH(a.t)} value={calc[a.ck]} />)}
            <Row label={trH('hrd.gross')} value={calc.gross} strong />
            <div className="ps-col-title" style={{ marginTop: 14 }}>{trH('hrd.psDeduct')}</div>
            {kesShow && <Row label={`BPJS Kesehatan (${pctStr(rates.kesEmployee)})`} value={calc.kesEmployee} neg note={kesNote} />}
            {tkShow && <Row label={`JHT (${pctStr(rates.jhtEmployee)})`} value={calc.jhtEmployee} neg note={tkNote} />}
            {tkShow && staff.jp && <Row label={`JP (${pctStr(rates.jpEmployee)})`} value={calc.jpEmployee} neg />}
            {calc.pph > 0 && <Row label="PPh 21" value={calc.pph} neg />}
            {calc.absenceDeduct > 0 && <Row label={trH('hrd.unpaidleave', { n: calc.offDays, dr: rp(Math.round(calc.dailyRate)) })} value={calc.absenceDeduct} neg />}
            {calc.deductions.filter((d) => +d.amount > 0).map((d, i) => <Row key={d.id || i} label={d.label || trH('hrd.dedPh', { n: i + 1 })} value={+d.amount} neg />)}
            <Row label={trH('hrd.totaldeduct')} value={calc.employeeDeduct} strong neg />
          </div>
          <div className="ps-col">
            <div className="ps-col-title">{trH('hrd.psEmployer')}</div>
            {kesShow && <Row label={`Kesehatan (${pctStr(rates.kesEmployer)})`} value={calc.kesEmployer} note={kesNote} />}
            {tkShow && <Row label={`JHT (${pctStr(rates.jhtEmployer)})`} value={calc.jhtEmployer} />}
            {tkShow && staff.jp && <Row label={`JP (${pctStr(rates.jpEmployer)})`} value={calc.jpEmployer} />}
            {tkShow && <Row label={`JKK (${pctStr(calc.jkkRate)})`} value={calc.jkk} />}
            {tkShow && <Row label={`JKM (${pctStr(rates.jkm)})`} value={calc.jkm} />}
            {!kesShow && !tkShow && <Row label={trH('hrd.bpjsNone')} value={0} />}
            <Row label={trH('hrd.totalemployer')} value={calc.employerContrib} strong />
            <div className="ps-cost">{trH('hrd.psCostFor')}<br /><b className="tnum">{rp(calc.companyCost)}</b></div>
          </div>
        </div>
        <div className="ps-thp">
          <span>{trH('hrd.thp')}</span>
          <span className="tnum">{rp(calc.takeHome)}</span>
        </div>
        <div className="ps-foot">{trH('hrd.psFoot', { m: monLabel })}</div>
      </div>
    </div>
  );
}

/* ---------------- Main HRD screen ---------------- */
function PayrollScreen({ rates, setRates, staff, setStaff, monLabel, onPost, canEdit, cashbons, monthKey }) {
  const [showRates, setShowRates] = uShr(false);
  const [editStaff, setEditStaff] = uShr(null);
  const [payslip, setPayslip] = uShr(null);
  // Fold the current payroll cycle's kasbon total in as a deduction before computing.
  const cycleAnchor = HRD.payCycle().anchor;
  const aug = (s) => HRD.withCashbon(s, cashbons, cycleAnchor);
  // Exclude the orientation/DW bucket (paid via daily lump sum, never monthly payroll)
  // and staff who left before this payroll month; prorate the separation month.
  const period = HRD.payPeriod(monthKey);   // 16→15 cycle → BPJS enrollment gating/proration
  const rows = staff.filter((s) => !HRD.isOrientationStage(s)).map((s) => ({ o: s, pr: HRD.prorateForMonth(s, monthKey, rates) })).filter((x) => x.pr.included);
  const t = HRD.totals(rows.map((x) => aug(x.pr.staff)), rates, period);

  const saveStaff = (s) => {
    setStaff((prev) => { const ex = prev.find((x) => x.id === s.id); const clean = { ...s }; delete clean._isNew; return ex ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; });
    setEditStaff(null);
  };
  const delStaff = (id) => { if (confirm(trH('hrd.removeConfirm'))) setStaff((prev) => prev.filter((x) => x.id !== id)); };
  const addStaff = () => setEditStaff(HRD.newStaff());

  return (
    <div className="screen-enter">
      <HrdSummary t={t} monLabel={monLabel} />

      <div className="hrd-actionbar">
        {canEdit && <button className="btn btn-primary" onClick={addStaff}><IconPlus s={17} />{trH('hrd.addEmp')}</button>}
        <button className={`btn btn-ghost ${showRates ? 'on' : ''}`} onClick={() => setShowRates((v) => !v)}><IconSettings s={16} />{trH('hrd.rates')}</button>
        <div style={{ flex: 1 }} />
        {canEdit && <button className="btn btn-lime" onClick={() => onPost(t.companyCost, monLabel)}><IconCoinOut s={16} />{trH('hrd.post', { m: monLabel })}</button>}
      </div>

      {showRates && <RatesPanel rates={rates} onChange={setRates} onReset={() => setRates(HRD.resetRates())} />}

      <div className="card hrd-table-card">
        <div className="hrd-table-scroll">
          <table className="hrd-table">
            <thead>
              <tr>
                <th className="hcell-name">{trH('hrd.cEmployee')}</th>
                <th>{trH('hrd.cGross')}</th>
                <th>{trH('hrd.cKes')}</th>
                <th>{trH('hrd.cTk')}</th>
                <th>{trH('hrd.cDeduct')}</th>
                <th>{trH('hrd.cTakehome')}</th>
                <th>{trH('hrd.cCost')}</th>
                <th className="hcell-act"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, pr }) => {
                const sa = aug(pr.staff);
                const c = HRD.compute(sa, rates, period);
                const bpjsKes = c.kesEmployer + c.kesEmployee;
                const bpjsTk = c.jhtEmployer + c.jhtEmployee + c.jpEmployer + c.jpEmployee + c.jkk + c.jkm;
                const partial = pr.factor < 1;
                return (
                  <tr key={o.id}>
                    <td className="hcell-name">
                      <div className="hemp">
                        <span className="hemp-av">{o.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="hemp-name">{o.name}</div>
                          <div className="hemp-pos">{o.pos || '—'} · <span style={{ color: 'var(--text-faint)' }}>{o.risk}</span></div>
                          {(partial || c.offDays > 0 || c.otherDeduct > 0) && (
                            <div className="hemp-badges">
                              {partial && <span className="hbadge off" title={o.separationDate}>{trH('hrd.proratedBadge', { n: pr.daysWorked, w: pr.workDays })}</span>}
                              {c.offDays > 0 && <span className="hbadge off">{trH(c.offDays > 1 ? 'hrd.daysoff' : 'hrd.dayoff', { n: c.offDays })}</span>}
                              {c.deductions.filter((d) => +d.amount > 0).slice(0, 2).map((d, i) => <span key={i} className="hbadge other">{d.label || 'Deduction'}</span>)}
                              {c.deductions.filter((d) => +d.amount > 0).length > 2 && <span className="hbadge other">+{c.deductions.filter((d) => +d.amount > 0).length - 2}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="tnum">{rp(c.gross)}</td>
                    <td className="tnum mut">{rp(bpjsKes)}</td>
                    <td className="tnum mut">{rp(bpjsTk)}</td>
                    <td className="tnum amt-neg">−{rp(c.employeeDeduct)}</td>
                    <td className="tnum strong">{rp(c.takeHome)}</td>
                    <td className="tnum strong">{rp(c.companyCost)}</td>
                    <td className="hcell-act">
                      <div className="hrow-actions">
                        <button className="icon-btn" title="Payslip" onClick={() => setPayslip(sa)}><IconInvoice s={17} /></button>
                        {canEdit && <button className="icon-btn" title="Edit" onClick={() => setEditStaff(o)}><IconPencil s={16} /></button>}
                        {canEdit && <button className="icon-btn del" title="Remove" onClick={() => delStaff(o.id)}><IconClose s={16} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="hcell-name" style={{ fontWeight: 700 }}>{trH('hrd.totalStaff', { n: t.count })}</td>
                <td className="tnum">{rp(t.gross)}</td>
                <td className="tnum mut">{rp(t.bpjsKes)}</td>
                <td className="tnum mut">{rp(t.bpjsTk)}</td>
                <td className="tnum amt-neg">−{rp(t.employeeDeduct)}</td>
                <td className="tnum strong">{rp(t.takeHome)}</td>
                <td className="tnum strong">{rp(t.companyCost)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="hrd-disclaimer">
        <IconShield s={15} /> {trH('hrd.disclaimer')}
      </div>

      {editStaff && <StaffModal staff={editStaff} rates={rates} onSave={saveStaff} onClose={() => setEditStaff(null)} />}
      {payslip && <PayslipModal staff={payslip} calc={HRD.compute(payslip, rates, period)} rates={rates} monLabel={monLabel} onClose={() => setPayslip(null)} />}
    </div>
  );
}

/* ---------------- HR Settings screen (cost policies) ---------------- */
// Configurable severance table (NOT statutory amounts — user fills per policy/UU).
function SeverancePanel({ rates, onChange }) {
  const rules = rates.severanceRules || {};
  const set = (st, field, v) => onChange({ ...rates, severanceRules: { ...rules, [st]: { ...(rules[st] || {}), [field]: v } } });
  const num = (e) => +e.target.value.replace(/[^\d.]/g, '') || 0;
  return (
    <div className="card rates-panel" style={{ marginTop: 16 }}>
      <div className="rates-head">
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{trH('hrd.sevTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mut)', marginTop: 2 }}>{trH('hrd.sevSub')}</div>
        </div>
      </div>
      <div className="sev-disclaimer"><IconShield s={15} /> {trH('hrd.sevDisclaimer')}</div>
      <div className="sev-table">
        <div className="sev-hrow sev-head"><span>{trH('hrd.sevType')}</span><span>{trH('hrd.sevBase')}</span><span>{trH('hrd.sevPerYear')}</span><span>{trH('hrd.sevCap')}</span></div>
        {HRD.SEP_STATUSES.map((st) => { const r = rules[st] || {}; return (
          <div key={st} className="sev-hrow">
            <span className="sev-name">{trH('co.sep_' + st)}</span>
            <input inputMode="decimal" value={r.baseMonths || 0} onChange={(e) => set(st, 'baseMonths', num(e))} />
            <input inputMode="decimal" value={r.perYearMonths || 0} onChange={(e) => set(st, 'perYearMonths', num(e))} />
            <input inputMode="numeric" value={r.capMonths || 0} onChange={(e) => set(st, 'capMonths', num(e))} />
          </div>
        ); })}
      </div>
      <div className="rate-note">{trH('hrd.sevFormula')}</div>
    </div>
  );
}

/* ---------------- Department manager (HRD-managed list) ---------------- */
function DeptManager({ departments, setDepartments, staff, setStaff, canEdit }) {
  const list = departments && departments.length ? departments : HRD.loadDepartments();
  const [newName, setNewName] = uShr('');
  const [editIdx, setEditIdx] = uShr(-1);
  const [editVal, setEditVal] = uShr('');
  const [reassign, setReassign] = uShr(null);   // { name, idx, target }
  const usage = (name) => (staff || []).filter((s) => s.dept === name).length;
  const dup = (name, exceptIdx) => list.some((d, i) => i !== exceptIdx && d.trim().toLowerCase() === name.trim().toLowerCase());

  const add = () => {
    const nn = newName.trim();
    if (!nn) return;
    if (dup(nn, -1)) { alert(trH('dept.dup')); return; }
    setDepartments([...list, nn]); setNewName('');
  };
  const startEdit = (i) => { setEditIdx(i); setEditVal(list[i]); };
  const saveEdit = () => {
    const nn = editVal.trim(); const oldName = list[editIdx];
    if (!nn) { alert(trH('dept.emptyName')); return; }
    if (dup(nn, editIdx)) { alert(trH('dept.dup')); return; }
    setDepartments(list.map((d, i) => (i === editIdx ? nn : d)));
    // Rename cascade → keep every employee's dept pointing at the renamed label.
    if (oldName !== nn && setStaff) setStaff((prev) => prev.map((s) => (s.dept === oldName ? { ...s, dept: nn } : s)));
    setEditIdx(-1); setEditVal('');
  };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= list.length) return; const next = list.slice(); const t = next[i]; next[i] = next[j]; next[j] = t; setDepartments(next); };
  const remove = (i) => {
    const name = list[i]; const used = usage(name);
    if (used > 0) {
      const others = list.filter((_, k) => k !== i);
      if (!others.length) { alert(trH('dept.cantDeleteLast')); return; }
      setReassign({ name, idx: i, target: others[0] });
      return;
    }
    if (!confirm(trH('dept.confirmDelete', { name }))) return;
    setDepartments(list.filter((_, k) => k !== i));
  };
  const doReassign = () => {
    if (!reassign) return;
    if (setStaff) setStaff((prev) => prev.map((s) => (s.dept === reassign.name ? { ...s, dept: reassign.target } : s)));
    setDepartments(list.filter((_, k) => k !== reassign.idx));
    setReassign(null);
  };

  return (
    <div className="card dept-mgr">
      <div className="rate-group-title" style={{ marginBottom: 4 }}>{trH('dept.title')}</div>
      <div className="rate-note" style={{ marginTop: 0, marginBottom: 12 }}>{trH('dept.intro')}</div>
      <div className="dept-list">
        {list.map((d, i) => (
          <div className="dept-row" key={d + i}>
            {canEdit && (
              <span className="dept-move">
                <button className="icon-btn" disabled={i === 0} title={trH('dept.moveUp')} onClick={() => move(i, -1)}><IconArrowUp s={14} /></button>
                <button className="icon-btn" disabled={i === list.length - 1} title={trH('dept.moveDown')} onClick={() => move(i, 1)}><IconArrowDown s={14} /></button>
              </span>
            )}
            {editIdx === i ? (
              <input className="fld dept-edit" autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditIdx(-1); }} />
            ) : (
              <span className="dept-name">{d}</span>
            )}
            <span className="dept-count">{trH('dept.count', { n: usage(d) })}</span>
            {canEdit && (editIdx === i ? (
              <React.Fragment>
                <button className="icon-btn ok" title={trH('dept.save')} onClick={saveEdit}><IconCheck s={15} /></button>
                <button className="icon-btn" title={trH('common.cancel')} onClick={() => setEditIdx(-1)}><IconClose s={15} /></button>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <button className="icon-btn" title={trH('dept.rename')} onClick={() => startEdit(i)}><IconPencil s={14} /></button>
                <button className="icon-btn del" title={trH('dept.remove')} onClick={() => remove(i)}><IconClose s={15} /></button>
              </React.Fragment>
            ))}
          </div>
        ))}
        {list.length === 0 && <div className="ori-empty">{trH('dept.none')}</div>}
      </div>
      {canEdit && (
        <div className="dept-add">
          <input className="fld" placeholder={trH('dept.addPh')} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="btn btn-primary btn-sm" onClick={add}><IconPlus s={15} />{trH('dept.add')}</button>
        </div>
      )}

      {reassign && (
        <div className="modal-scrim" onClick={() => setReassign(null)}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div style={{ fontSize: 16, fontWeight: 700 }}>{trH('dept.reassignTitle')}</div><button className="icon-btn" onClick={() => setReassign(null)}><IconClose s={18} /></button></div>
            <div style={{ padding: '4px 2px 8px' }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-mut)', marginBottom: 12 }}>{trH('dept.reassignBody', { n: usage(reassign.name), name: reassign.name })}</div>
              <label className="fld-label" style={{ marginTop: 0 }}>{trH('dept.reassignTo')}</label>
              <UI.Dropdown value={reassign.target} options={list.filter((d) => d !== reassign.name)} onChange={(v) => setReassign({ ...reassign, target: v })} />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setReassign(null)}>{trH('common.cancel')}</button>
              <button className="btn btn-primary" onClick={doReassign}>{trH('dept.reassignBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HrSettings({ rates, setRates, departments, setDepartments, staff, setStaff, canEditDept }) {
  return (
    <div className="screen-enter">
      <div className="settings-intro card">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{trH('hrs.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-mut)', marginTop: 3 }}>{trH('hrs.intro')}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <RatesPanel rates={rates} onChange={setRates} onReset={() => setRates(HRD.resetRates())} alwaysOpen />
      </div>
      <SeverancePanel rates={rates} onChange={setRates} />
      <div style={{ marginTop: 16 }}>
        <DeptManager departments={departments} setDepartments={setDepartments} staff={staff} setStaff={setStaff} canEdit={canEditDept !== false} />
      </div>
    </div>
  );
}

window.PAYROLL = { PayrollScreen, HrSettings, StaffModal, DeptManager };
