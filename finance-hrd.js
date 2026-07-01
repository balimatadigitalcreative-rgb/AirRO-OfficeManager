/* AirRO Water — HRD / Payroll store + BPJS calculation engine.
   Indonesian statutory rates (2024/2025). Exposed on window.HRD. */
(function () {
  const RATES_KEY = 'airro_hrd_rates_v1';
  const STAFF_KEY = 'airro_hrd_staff_v7';   // trial: empty roster
  const BUDGET_KEY = 'airro_hr_budget_v1';
  const DEFAULT_BUDGET = 30000000;
  const DEPARTMENTS = ['Supervisor Distribution', 'Finance', 'Driver', 'Helper', 'Staff Storage'];

  // JKK (work-accident) employer rate by occupational risk class
  const JKK = { 'Very Low': 0.0024, 'Low': 0.0054, 'Medium': 0.0089, 'High': 0.0127, 'Very High': 0.0174 };

  const DEFAULT_RATES = {
    // BPJS Kesehatan — total 5% (employer 4% + employee 1%), salary capped at ceiling
    kesEmployer: 0.04, kesEmployee: 0.01, kesCeiling: 12000000,
    // BPJS Ketenagakerjaan — JHT total 5.7% (employer 3.7% + employee 2%)
    jhtEmployer: 0.037, jhtEmployee: 0.02,
    // JP (Pension) total 3% (employer 2% + employee 1%), capped at ceiling
    jpEmployer: 0.02, jpEmployee: 0.01, jpCeiling: 10547400,
    // JKM (death) 0.30% employer
    jkm: 0.003,
    jkk: JKK,
    // Payroll basis: working days per month (for unpaid day-off proration)
    workDays: 26,
    // Late-attendance penalty: deduction per minute late, vs a standard start time
    lateStart: '08:00', latePerMin: 500, lateBasis: 'minute',
    // Overtime pay per hour (shared by monthly payroll AND orientation).
    otPerHour: 25000,
    // Optional orientation-specific overtime rate; 0 = reuse otPerHour above.
    otOrientation: 0,
    // Kasbon (cash advance): ceiling = 50% of BASE per payroll cycle (16→15),
    // max 1×/week, weekly max = ceiling/4. Week window definition:
    cashbonWeekMode: 'cutoff', // 'cutoff' = 7 days from the 16th | 'calendar' = Mon–Sun
    // Severance / separation compensation per exit type. NOT statutory amounts —
    // the user configures these per UU Ketenagakerjaan/Cipta Kerja (see UI disclaimer).
    // severance = monthly(base+allowances) × (baseMonths + perYearMonths × tenureYears), capped.
    severanceRules: {
      resigned:       { baseMonths: 0, perYearMonths: 0, capMonths: 0 },
      terminated:     { baseMonths: 0, perYearMonths: 1, capMonths: 0 },
      contract_ended: { baseMonths: 0, perYearMonths: 0, capMonths: 0 },
      retired:        { baseMonths: 0, perYearMonths: 2, capMonths: 0 },
      dishonorable:   { baseMonths: 0, perYearMonths: 0, capMonths: 0 },
      absconded:      { baseMonths: 0, perYearMonths: 0, capMonths: 0 },
    },
    // THR holiday dates per religion (Tunjangan Hari Raya keagamaan)
    holidayDates: { Islam: '2026-03-20', Kristen: '2026-12-25', Katolik: '2026-12-25', Hindu: '2026-03-19', Buddha: '2026-05-31' },
    // THR portion per religion (1 = full at one holiday; 0.5 = half, e.g. religions with 2 holidays/year)
    holidayShare: { Islam: 1, Kristen: 1, Katolik: 1, Hindu: 0.5, Buddha: 1 },
  };
  const RELIGIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha'];

  // Realistic AirRO depot roster
  const DEFAULT_STAFF = [];

  function loadRates() { try { const r = localStorage.getItem(RATES_KEY); if (r) return { ...DEFAULT_RATES, ...JSON.parse(r), jkk: { ...JKK, ...(JSON.parse(r).jkk || {}) } }; } catch (e) {} return JSON.parse(JSON.stringify(DEFAULT_RATES)); }
  function saveRates(r) { try { localStorage.setItem(RATES_KEY, JSON.stringify(r)); } catch (e) {} }
  function resetRates() { try { localStorage.removeItem(RATES_KEY); } catch (e) {} return JSON.parse(JSON.stringify(DEFAULT_RATES)); }

  function loadStaff() { try { const s = localStorage.getItem(STAFF_KEY); if (s) { const a = JSON.parse(s); if (Array.isArray(a)) return a; } } catch (e) {} const seed = JSON.parse(JSON.stringify(DEFAULT_STAFF)); saveStaff(seed); return seed; }
  function saveStaff(s) { try { localStorage.setItem(STAFF_KEY, JSON.stringify(s)); } catch (e) {} }
  function resetStaff() { const seed = JSON.parse(JSON.stringify(DEFAULT_STAFF)); saveStaff(seed); return seed; }
  const newStaffId = () => 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  // Canonical blank staff object — the SINGLE shape used by both the Payroll form
  // and the Employee Directory form, so fields never drift apart. Salary fields
  // default to 0 ("gaji belum diatur"); identity fields default blank.
  function newStaff() {
    return {
      id: newStaffId(), name: '', pos: '', dept: DEPARTMENTS[0],
      base: 0, allowance: 0, tjKinerja: 0, tjProfesi: 0, tjRumahDinas: 0, tjBpjsKes: 0, tjBpjsTk: 0,
      risk: 'Low', jp: true, religion: 'Islam', pph: 0, offDays: 0, deductions: [],
      nip: '', office: 'AIRRO', status: 'Tetap', noSurat: '', joinedDate: '', contractStart: '', contractEnd: '',
      nik: '', noKk: '', noBpjsKes: '', noBpjsTk: '', birthPlace: '', birthDate: '',
      addressKtp: '', addressDomisili: '', maritalStatus: 'TK', bank: '', account: '', phone: '',
      // offboarding (sepStatus, NOT `status` which is employment type Tetap/Kontrak)
      sepStatus: 'active', separationDate: '', separationReason: '', separationNote: '', active: true,
      // lifecycle: new hires start in orientation (paid a daily lump sum, excluded
      // from monthly payroll until promoted). Orientation data embedded 1:1.
      stage: 'orientation',
      orientation: { startDate: '', durationDays: 7, dailyWage: 0, outcome: 'pending', paid: false, paidAt: '', note: '' },
      _isNew: true,
    };
  }
  const newDedId = () => 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

  function loadBudget() { try { const b = localStorage.getItem(BUDGET_KEY); if (b != null) return +b || DEFAULT_BUDGET; } catch (e) {} return DEFAULT_BUDGET; }
  function saveBudget(b) { try { localStorage.setItem(BUDGET_KEY, String(b)); } catch (e) {} }

  // ---- Headcount affordability ----
  function affordability(staff, rates, budget) {
    const t = totals(staff, rates);
    const overhead = t.companyCost;
    const remaining = budget - overhead;
    const util = budget ? overhead / budget : 0;
    const avgCost = staff.length ? overhead / staff.length : 0;
    const canHire = avgCost > 0 ? Math.floor(Math.max(0, remaining) / avgCost) : 0;
    return { overhead, budget, remaining, util, avgCost, canHire, count: staff.length };
  }
  function simulateHire(staff, rates, budget, candidate) {
    const c = compute({ base: candidate.base, allowance: candidate.allowance, risk: candidate.risk || 'Low', jp: candidate.jp !== false, pph: 0, offDays: 0, deductions: [] }, rates);
    const cur = affordability(staff, rates, budget);
    const newOverhead = cur.overhead + c.companyCost;
    return { addCost: c.companyCost, addTakeHome: c.takeHome, newOverhead, newRemaining: budget - newOverhead, newUtil: budget ? newOverhead / budget : 0, affordable: newOverhead <= budget };
  }

  // ---- the core calculation for one employee ----
  function compute(s, r) {
    const base = +s.base || 0;
    // ── Structured allowances (all add to gross earnings) ──
    const tjKinerja = +s.tjKinerja || 0;
    const tjProfesi = +s.tjProfesi || 0;
    const tjRumahDinas = +s.tjRumahDinas || 0;
    const tjBpjsKes = +s.tjBpjsKes || 0;   // cash allowance to employee (NOT the iuran)
    const tjBpjsTk = +s.tjBpjsTk || 0;      // cash allowance to employee (NOT the iuran)
    const allowOther = +s.allowance || 0;   // "Tunjangan lain" (legacy catch-all)
    const allow = allowOther + tjKinerja + tjProfesi + tjRumahDinas + tjBpjsKes + tjBpjsTk; // total tunjangan
    const gross = base + allow;             // full monthly earnings

    // Statutory contribution base (upah dasar iuran). It EXCLUDES the BPJS-support
    // allowances (tjBpjsKes/tjBpjsTk): those are cash given to the employee to help
    // pay BPJS, so folding them back into the iuran base would make the allowance
    // inflate the very contribution it offsets — a double count. Everything else
    // (base + kinerja + profesi + rumah dinas + tunjangan lain) is regular wage and
    // stays in the base. For legacy rows (all tj*=0) iuranBase === gross → identical.
    const iuranBase = base + allowOther + tjKinerja + tjProfesi + tjRumahDinas;

    const kesBase = Math.min(iuranBase, r.kesCeiling);
    const kesEmployer = kesBase * r.kesEmployer;
    const kesEmployee = kesBase * r.kesEmployee;

    const jhtEmployer = iuranBase * r.jhtEmployer;
    const jhtEmployee = iuranBase * r.jhtEmployee;

    const jpBase = Math.min(iuranBase, r.jpCeiling);
    const jpEmployer = s.jp ? jpBase * r.jpEmployer : 0;
    const jpEmployee = s.jp ? jpBase * r.jpEmployee : 0;

    const jkkRate = r.jkk[s.risk] != null ? r.jkk[s.risk] : r.jkk['Low'];
    const jkk = iuranBase * jkkRate;
    const jkm = iuranBase * r.jkm;

    const pph = +s.pph || 0;

    // Unpaid days off (potongan tidak masuk) prorated from base salary
    const workDays = r.workDays || 26;
    const offDays = +s.offDays || 0;
    const dailyRate = base / workDays;
    const absenceDeduct = Math.round(dailyRate * offDays);
    // Other deductions (kasbon / loan / fine / seragam, etc.) — list of {label, amount}
    const dedList = Array.isArray(s.deductions) ? s.deductions
      : (s.otherDeduct ? [{ id: 'd0', label: s.otherNote || 'Other deduction', amount: s.otherDeduct }] : []);
    const otherDeduct = dedList.reduce((a, d) => a + (+d.amount || 0), 0);
    const otPay = +s.otPay || 0;

    const employeeDeduct = kesEmployee + jhtEmployee + jpEmployee + pph + absenceDeduct + otherDeduct;
    const employerContrib = kesEmployer + jhtEmployer + jpEmployer + jkk + jkm;
    const takeHome = gross - employeeDeduct + otPay;
    // Real company cash outflow = full burden, less days not paid and amounts recovered, plus overtime
    const companyCost = gross + employerContrib - absenceDeduct - otherDeduct + otPay;

    return { base, allow, gross, jkkRate, iuranBase,
      tjKinerja, tjProfesi, tjRumahDinas, tjBpjsKes, tjBpjsTk, allowOther,
      kesEmployer, kesEmployee, jhtEmployer, jhtEmployee, jpEmployer, jpEmployee, jkk, jkm, pph,
      dailyRate, offDays, absenceDeduct, deductions: dedList, otherDeduct, otPay,
      employeeDeduct, employerContrib, takeHome, companyCost };
  }

  function totals(staff, r) {
    const acc = { gross: 0, takeHome: 0, employeeDeduct: 0, employerContrib: 0, companyCost: 0, bpjsKes: 0, bpjsTk: 0, count: staff.length };
    staff.forEach((s) => {
      const c = compute(s, r);
      acc.gross += c.gross; acc.takeHome += c.takeHome; acc.employeeDeduct += c.employeeDeduct;
      acc.employerContrib += c.employerContrib; acc.companyCost += c.companyCost;
      acc.bpjsKes += c.kesEmployer + c.kesEmployee;
      acc.bpjsTk += c.jhtEmployer + c.jhtEmployee + c.jpEmployer + c.jpEmployee + c.jkk + c.jkm;
    });
    return acc;
  }

  // ---- THR (Tunjangan Hari Raya) — prorated by length of service ----
  function thr(staff, joinedDate, refDate) {
    const monthly = (+staff.base || 0) + (+staff.allowance || 0)
      + (+staff.tjKinerja || 0) + (+staff.tjProfesi || 0) + (+staff.tjRumahDinas || 0)
      + (+staff.tjBpjsKes || 0) + (+staff.tjBpjsTk || 0);
    if (!joinedDate) return { monthly, months: 0, amount: 0, eligible: false, ratio: 0 };
    const j = new Date(joinedDate + 'T00:00'), r = new Date(refDate + 'T00:00');
    let months = (r.getFullYear() - j.getFullYear()) * 12 + (r.getMonth() - j.getMonth());
    if (r.getDate() < j.getDate()) months -= 1;
    months = Math.max(0, months);
    let amount, eligible, ratio;
    if (months >= 12) { amount = monthly; ratio = 1; eligible = true; }
    else if (months >= 1) { ratio = months / 12; amount = Math.round(monthly * ratio); eligible = true; }
    else { amount = 0; ratio = 0; eligible = false; }
    return { monthly, months, amount, eligible, ratio };
  }

  // ---- Kasbon (cash advance) — payroll cycle 16→15 rules ----
  // Ceiling per cycle = 50% of BASE (base only). Deducted in full at the cutoff
  // (15th) of the cycle each kasbon belongs to. Authoritative validation is on
  // the server (cashbon.rules.js); these mirror it for the live UI + payroll cut.
  const pad2 = (n) => String(n).padStart(2, '0');
  function payCycle(iso) {
    if (!iso) iso = (window.FIN && window.FIN.TODAY) || '';
    const [y, m, d] = iso.split('-').map(Number);
    let sy = y, sm = m; if (d < 16) { sm = m - 1; if (sm < 1) { sm = 12; sy = y - 1; } }
    let ey = sy, em = sm + 1; if (em > 12) { em = 1; ey = ey + 1; }
    return { start: `${sy}-${pad2(sm)}-16`, end: `${ey}-${pad2(em)}-15`, anchor: `${ey}-${pad2(em)}-15` };
  }
  const cbAnchor = (c) => c.cycleAnchor || payCycle(c.date).anchor;
  function cashbonCeiling(staff) { return Math.floor(0.5 * (+staff.base || 0)); }
  function cashbonWeeklyMax(staff) { return Math.floor(cashbonCeiling(staff) / 4); }
  // Active kasbon a staff has in a given cycle (deducted in full at that cutoff).
  function cashbonsInCycle(staffId, cashbons, anchor) {
    return (cashbons || []).filter((c) => c.employeeId === staffId && c.status !== 'cancelled' && cbAnchor(c) === anchor);
  }
  function cashbonCycleTotal(staffId, cashbons, anchor) {
    return (cashbons || []).filter((c) => c.employeeId === staffId && c.status === 'active' && cbAnchor(c) === anchor).reduce((a, c) => a + (+c.amount || 0), 0);
  }
  // All still-owed active kasbon (any cycle) — for termination / final settlement.
  function cashbonOutstanding(staffId, cashbons) {
    return (cashbons || []).filter((c) => c.employeeId === staffId && c.status === 'active').reduce((a, c) => a + (+c.amount || 0), 0);
  }
  // Fold a cycle's kasbon total into the staff's deductions as one auto "Kasbon"
  // row so compute()/payslip/breakdown pick it up. Default cycle = today's.
  function withCashbon(staff, cashbons, anchor) {
    anchor = anchor || payCycle().anchor;
    const total = cashbonCycleTotal(staff.id, cashbons, anchor);
    const keep = Array.isArray(staff.deductions) ? staff.deductions.filter((d) => !d.kasbon) : (staff.deductions || []);
    if (total <= 0) return { ...staff, deductions: keep };
    return { ...staff, deductions: [...keep, { id: 'kasbon-cycle', label: 'Kasbon', amount: total, auto: true, kasbon: true }] };
  }

  // ---- Offboarding / separation (Tahap 4) ----
  const SEP_STATUSES = ['resigned', 'terminated', 'dishonorable', 'absconded', 'contract_ended', 'retired', 'orientation_failed'];
  function isActive(s) { return (s.sepStatus || 'active') === 'active'; }
  function activeStaff(list) { return (list || []).filter(isActive); }
  function tenureYears(staff, asOfIso) {
    const j = staff.joinedDate || staff.contractStart; if (!j || !asOfIso) return 0;
    const a = j.split('-').map(Number), b = asOfIso.split('-').map(Number);
    let y = b[0] - a[0]; if (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) y--; return Math.max(0, y);
  }
  function prorateStaff(s, f) {
    const sc = (v) => Math.round((+v || 0) * f);
    return { ...s, base: sc(s.base), allowance: sc(s.allowance), tjKinerja: sc(s.tjKinerja), tjProfesi: sc(s.tjProfesi), tjRumahDinas: sc(s.tjRumahDinas), tjBpjsKes: sc(s.tjBpjsKes), tjBpjsTk: sc(s.tjBpjsTk), _prorate: f };
  }
  // Payroll standing for a calendar month: excluded if gone before it, prorated in
  // the separation month (base + all allowances × daysWorked/workDays), else full.
  function prorateForMonth(s, monthKey, rates) {
    const sep = s.separationDate;
    if (!sep) return { included: true, factor: 1, staff: s };
    const sepMonth = sep.slice(0, 7);
    if (monthKey > sepMonth) return { included: false, factor: 0, staff: null };
    if (monthKey < sepMonth) return { included: true, factor: 1, staff: s };
    const wd = rates.workDays || 26;
    const daysWorked = Math.min(+sep.slice(8, 10) || wd, wd);
    const factor = daysWorked / wd;
    return { included: true, factor, staff: prorateStaff(s, factor), daysWorked, workDays: wd };
  }
  // ---- Lifecycle stage + new-hire orientation ----
  const stageOf = (s) => s.stage || 'permanent';   // legacy rows (no stage) → permanent
  // The "orientation bucket" — paid a daily lump sum via attendance, NOT monthly payroll.
  const ORI_STAGES = ['orientation', 'dw'];
  const isOrientationStage = (s) => ORI_STAGES.indexOf(stageOf(s)) >= 0;

  // ---- Orientation/DW daily wage from attendance (REUSES rates.late* / rates.ot*) ----
  const hmMin = (t) => { if (!t) return 0; const p = String(t).split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); };
  // Minutes late for a check-in vs rates.lateStart (0 if on time / no check-in).
  function oriLateMinutes(checkIn, rates) { if (!checkIn) return 0; return Math.max(0, hmMin(checkIn) - hmMin((rates && rates.lateStart) || '08:00')); }
  // Auto-classify a day from its check-in: status 'present'|'late'|'absent' + lateMinutes.
  function orientationClassify(checkIn, rates, absent) {
    if (absent) return { status: 'absent', lateMinutes: 0 };
    if (!checkIn) return { status: 'present', lateMinutes: 0 };
    const mins = oriLateMinutes(checkIn, rates);
    return { status: mins > 0 ? 'late' : 'present', lateMinutes: mins };
  }
  // Wage for a single attendance day, using the SAME config as monthly payroll:
  //   base           = (status != 'absent') ? dailyWage : 0
  //   lateDeduct     = lateBasis 'minute' → lateMinutes × latePerMin
  //                    lateBasis 'hour'   → ceil(lateMinutes/60) × latePerMin (per-hour value)
  //   otPay          = overtimeHours × (otOrientation || otPerHour)
  //   pay            = max(0, base − lateDeduct + otPay)
  function orientationDayPay(day, rates, dailyWage) {
    const r = rates || {}, dw = +dailyWage || 0;
    const status = day.status || 'present';
    const base = status === 'absent' ? 0 : dw;
    const lateMin = +day.lateMinutes || 0;
    const basis = r.lateBasis === 'hour' ? 'hour' : 'minute';
    const per = +r.latePerMin || 0;
    const lateDeduct = base === 0 ? 0 : (basis === 'hour' ? Math.ceil(lateMin / 60) * per : lateMin * per);
    const otRate = (+r.otOrientation > 0) ? +r.otOrientation : (+r.otPerHour || 0);
    const otPay = Math.round((+day.overtimeHours || 0) * otRate);
    const pay = Math.max(0, base - lateDeduct + otPay);
    return { date: day.date, status, base, lateMinutes: lateMin, lateDeduct, overtimeHours: +day.overtimeHours || 0, otRate, otPay, pay };
  }
  // Aggregate wage over all attendance days → per-day rows + subtotals.
  function orientationWage(days, rates, dailyWage) {
    const rows = (days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => orientationDayPay(d, rates, dailyWage));
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    return { rows, days: rows.length, total: sum('pay'), sumBase: sum('base'), sumLate: sum('lateDeduct'), sumOt: sum('otPay') };
  }
  function addDaysISO(iso, n) { const a = iso.split('-').map(Number); const dt = new Date(Date.UTC(a[0], a[1] - 1, a[2]) + n * 86400000); return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`; }
  function daysBetweenISO(a, b) { const x = a.split('-').map(Number), y = b.split('-').map(Number); return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000); }
  // Orientation ends the day AFTER the last worked day (probation starts here).
  function orientationEnd(staff) { const o = staff.orientation || {}; return o.startDate ? addDaysISO(o.startDate, +o.durationDays || 7) : ''; }
  // Days actually served: full duration, unless failed & left early → up to exit day.
  function orientationDaysServed(staff) {
    const o = staff.orientation || {}; const dur = +o.durationDays || 7;
    if (!o.startDate) return 0;
    const end = addDaysISO(o.startDate, dur);
    if (o.outcome === 'failed' && staff.separationDate && staff.separationDate < end) {
      return Math.max(1, Math.min(daysBetweenISO(o.startDate, staff.separationDate) + 1, dur));
    }
    return dur;
  }
  // Total orientation wage. When `days` (attendance) is supplied → attendance-based
  // (base − late + overtime, per day). Otherwise falls back to the flat
  // dailyWage × daysServed estimate (used before any attendance is recorded).
  function orientationTotal(staff, days, rates) {
    if (Array.isArray(days) && days.length) return orientationWage(days, rates || {}, (staff.orientation || {}).dailyWage).total;
    return (+((staff.orientation || {}).dailyWage) || 0) * orientationDaysServed(staff);
  }
  function orientationRemaining(staff, today) { const o = staff.orientation || {}; if (!o.startDate || !today) return 0; return Math.max(0, daysBetweenISO(today, addDaysISO(o.startDate, +o.durationDays || 7))); }

  // Active + prorated staff list for a payroll month. EXCLUDES orientation-stage
  // staff (they are paid via the orientation lump sum, never monthly payroll — no
  // double pay) and those who left before this month; prorates the separation month.
  function payrollStaff(list, monthKey, rates) {
    return (list || []).filter((s) => !isOrientationStage(s)).map((s) => prorateForMonth(s, monthKey, rates)).filter((r) => r.included).map((r) => r.staff);
  }
  function severance(staff, rates) {
    const rule = ((rates.severanceRules || {})[staff.sepStatus]) || { baseMonths: 0, perYearMonths: 0, capMonths: 0 };
    const years = tenureYears(staff, staff.separationDate);
    let months = (+rule.baseMonths || 0) + (+rule.perYearMonths || 0) * years;
    if (+rule.capMonths > 0) months = Math.min(months, +rule.capMonths);
    const monthly = (+staff.base || 0) + (+staff.allowance || 0) + (+staff.tjKinerja || 0) + (+staff.tjProfesi || 0) + (+staff.tjRumahDinas || 0) + (+staff.tjBpjsKes || 0) + (+staff.tjBpjsTk || 0);
    return { amount: Math.round(monthly * months), months, years, monthly, rule };
  }
  // One-shot exit calc: prorated last-month NET (excl. kasbon) + severance
  // − outstanding kasbon (all cycles) − other deductions. May be negative.
  function finalSettlement(staff, rates, cashbons) {
    const sep = staff.separationDate;
    const sepMonth = sep ? sep.slice(0, 7) : '';
    const pr = sep ? prorateForMonth(staff, sepMonth, rates) : { factor: 1, staff, daysWorked: rates.workDays || 26, workDays: rates.workDays || 26 };
    const prStaff = { ...pr.staff, deductions: (pr.staff.deductions || []).filter((d) => !d.kasbon) };
    const c = compute(prStaff, rates);
    const sev = severance(staff, rates);
    const kasbon = cashbonOutstanding(staff.id, cashbons);
    const finalPay = c.takeHome + sev.amount - kasbon;
    return {
      sepMonth, factor: pr.factor, daysWorked: pr.daysWorked, workDays: pr.workDays,
      proratedGross: c.gross, proratedNet: c.takeHome, employeeDeduct: c.employeeDeduct, otherDeduct: c.otherDeduct,
      severance: sev.amount, severanceMonths: sev.months, tenureYears: sev.years, monthly: sev.monthly,
      kasbonOutstanding: kasbon, finalPay,
    };
  }

  window.HRD = {
    RATES_KEY, STAFF_KEY, JKK, DEFAULT_RATES, DEFAULT_STAFF, DEPARTMENTS, DEFAULT_BUDGET,
    loadRates, saveRates, resetRates, loadStaff, saveStaff, resetStaff, newStaffId, newStaff, newDedId,
    loadBudget, saveBudget, affordability, simulateHire, thr,
    compute, totals, RISK_LEVELS: Object.keys(JKK), RELIGIONS,
    payCycle, cashbonCeiling, cashbonWeeklyMax, cashbonsInCycle, cashbonCycleTotal, cashbonOutstanding, withCashbon,
    SEP_STATUSES, isActive, activeStaff, tenureYears, prorateForMonth, payrollStaff, severance, finalSettlement,
    stageOf, ORI_STAGES, isOrientationStage, orientationEnd, orientationDaysServed, orientationTotal, orientationRemaining, addDaysISO,
    oriLateMinutes, orientationClassify, orientationDayPay, orientationWage,
  };
})();
