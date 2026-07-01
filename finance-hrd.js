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
    // Overtime pay per hour
    otPerHour: 25000,
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
      base: 0, allowance: 0, risk: 'Low', jp: true, religion: 'Islam', pph: 0, offDays: 0, deductions: [],
      nip: '', office: 'AIRRO', status: 'Tetap', noSurat: '', joinedDate: '', contractStart: '', contractEnd: '',
      nik: '', noKk: '', noBpjsKes: '', noBpjsTk: '', birthPlace: '', birthDate: '',
      addressKtp: '', addressDomisili: '', maritalStatus: 'TK', bank: '', account: '', phone: '',
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
    const allow = +s.allowance || 0;
    const gross = base + allow;

    const kesBaseRaw = gross;
    const kesBase = Math.min(kesBaseRaw, r.kesCeiling);
    const kesEmployer = kesBase * r.kesEmployer;
    const kesEmployee = kesBase * r.kesEmployee;

    const jhtEmployer = gross * r.jhtEmployer;
    const jhtEmployee = gross * r.jhtEmployee;

    const jpBase = Math.min(gross, r.jpCeiling);
    const jpEmployer = s.jp ? jpBase * r.jpEmployer : 0;
    const jpEmployee = s.jp ? jpBase * r.jpEmployee : 0;

    const jkkRate = r.jkk[s.risk] != null ? r.jkk[s.risk] : r.jkk['Low'];
    const jkk = gross * jkkRate;
    const jkm = gross * r.jkm;

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

    return { base, allow, gross, jkkRate,
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
    const monthly = (+staff.base || 0) + (+staff.allowance || 0);
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

  window.HRD = {
    RATES_KEY, STAFF_KEY, JKK, DEFAULT_RATES, DEFAULT_STAFF, DEPARTMENTS, DEFAULT_BUDGET,
    loadRates, saveRates, resetRates, loadStaff, saveStaff, resetStaff, newStaffId, newStaff, newDedId,
    loadBudget, saveBudget, affordability, simulateHire, thr,
    compute, totals, RISK_LEVELS: Object.keys(JKK), RELIGIONS,
  };
})();
