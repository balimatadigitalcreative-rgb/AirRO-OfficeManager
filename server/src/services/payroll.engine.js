'use strict';

// Indonesian statutory payroll engine — ported verbatim (logic-wise) from the
// frontend's finance-hrd.js so the API computes identical figures.

const JKK = { 'Very Low': 0.0024, Low: 0.0054, Medium: 0.0089, High: 0.0127, 'Very High': 0.0174 };

const DEFAULT_RATES = {
  kesEmployer: 0.04, kesEmployee: 0.01, kesCeiling: 12000000,
  jhtEmployer: 0.037, jhtEmployee: 0.02,
  jpEmployer: 0.02, jpEmployee: 0.01, jpCeiling: 10547400,
  jkm: 0.003,
  jkk: JKK,
  workDays: 26,
  lateStart: '08:00', latePerMin: 500, lateBasis: 'minute',
  otPerHour: 25000,
  holidayShare: { Islam: 1, Kristen: 1, Katolik: 1, Hindu: 0.5, Buddha: 1 },
};

const RISK_LEVELS = Object.keys(JKK);
const RELIGIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha'];

// Core per-employee calculation. `s` carries optional monthly inputs
// (offDays, deductions[], otPay, pph); `r` is the rate table.
function compute(s, r = DEFAULT_RATES) {
  const base = +s.base || 0;
  const allow = +s.allowance || 0;
  const gross = base + allow;

  const kesBase = Math.min(gross, r.kesCeiling);
  const kesEmployer = kesBase * r.kesEmployer;
  const kesEmployee = kesBase * r.kesEmployee;

  const jhtEmployer = gross * r.jhtEmployer;
  const jhtEmployee = gross * r.jhtEmployee;

  const jpBase = Math.min(gross, r.jpCeiling);
  const jpEmployer = s.jp ? jpBase * r.jpEmployer : 0;
  const jpEmployee = s.jp ? jpBase * r.jpEmployee : 0;

  const jkkRate = r.jkk[s.risk] != null ? r.jkk[s.risk] : r.jkk.Low;
  const jkk = gross * jkkRate;
  const jkm = gross * r.jkm;

  const pph = +s.pph || 0;

  const workDays = r.workDays || 26;
  const offDays = +s.offDays || 0;
  const dailyRate = base / workDays;
  const absenceDeduct = Math.round(dailyRate * offDays);

  const dedList = Array.isArray(s.deductions) ? s.deductions : [];
  const otherDeduct = dedList.reduce((a, d) => a + (+d.amount || 0), 0);
  const otPay = +s.otPay || 0;

  const employeeDeduct = kesEmployee + jhtEmployee + jpEmployee + pph + absenceDeduct + otherDeduct;
  const employerContrib = kesEmployer + jhtEmployer + jpEmployer + jkk + jkm;
  const takeHome = gross - employeeDeduct + otPay;
  const companyCost = gross + employerContrib - absenceDeduct - otherDeduct + otPay;

  return {
    base, allow, gross, jkkRate,
    kesEmployer, kesEmployee, jhtEmployer, jhtEmployee, jpEmployer, jpEmployee, jkk, jkm, pph,
    dailyRate, offDays, absenceDeduct, deductions: dedList, otherDeduct, otPay,
    employeeDeduct, employerContrib, takeHome, companyCost,
  };
}

function totals(staff, r = DEFAULT_RATES) {
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

// THR (Tunjangan Hari Raya) prorated by length of service.
function thr(staff, joinedDate, refDate) {
  const monthly = (+staff.base || 0) + (+staff.allowance || 0);
  if (!joinedDate) return { monthly, months: 0, amount: 0, eligible: false, ratio: 0 };
  const j = new Date(joinedDate + 'T00:00');
  const ref = new Date(refDate + 'T00:00');
  let months = (ref.getFullYear() - j.getFullYear()) * 12 + (ref.getMonth() - j.getMonth());
  if (ref.getDate() < j.getDate()) months -= 1;
  months = Math.max(0, months);
  if (months >= 12) return { monthly, months, amount: monthly, eligible: true, ratio: 1 };
  if (months >= 1) { const ratio = months / 12; return { monthly, months, amount: Math.round(monthly * ratio), eligible: true, ratio }; }
  return { monthly, months, amount: 0, eligible: false, ratio: 0 };
}

module.exports = { JKK, DEFAULT_RATES, RISK_LEVELS, RELIGIONS, compute, totals, thr };
