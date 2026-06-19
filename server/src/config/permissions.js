'use strict';

// Per-role capability matrix — mirrors ROLES[...].perms in the frontend's
// finance-store.js so the API enforces the same access rules as the UI.
const ROLE_PERMS = {
  owner: {
    company: true, cashflow: true, employees: false, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: false, reports: true, advisor: false,
    payroll: false, approvals: false, settings: false, reset: false, setoran: false, setoranOnly: false,
  },
  gm: {
    company: true, cashflow: true, employees: true, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: true, setoran: true, setoranOnly: false,
  },
  hrd: {
    company: false, cashflow: false, employees: true, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: false, reports: false, advisor: false,
    payroll: true, approvals: true, settings: false, reset: false, setoran: false, setoranOnly: false,
  },
  finance: {
    company: false, cashflow: true, employees: false, addEntry: true, edit: true,
    delete: true, seeMoney: true, allEntries: true, reports: true, advisor: true,
    payroll: true, approvals: true, settings: true, reset: false, setoran: true, setoranOnly: false,
  },
  adminfin: {
    company: false, cashflow: true, employees: false, addEntry: false, edit: false,
    delete: false, seeMoney: true, allEntries: true, reports: false, advisor: false,
    payroll: false, approvals: false, settings: false, reset: false, setoran: true, setoranOnly: true,
  },
};

const ROLES = Object.keys(ROLE_PERMS);

function hasPerm(role, perm) {
  const p = ROLE_PERMS[role];
  return !!(p && p[perm]);
}

// Parse a stored permissions JSON string into an object (or null on absent/bad).
function parsePerms(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try {
    const o = JSON.parse(str);
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    return null;
  }
}

// Effective capability map for a user: their per-user override if set,
// otherwise the role defaults.
function resolvePerms(role, permsStrOrObj) {
  const override = parsePerms(permsStrOrObj);
  return override || ROLE_PERMS[role] || ROLE_PERMS.finance;
}

module.exports = { ROLE_PERMS, ROLES, hasPerm, parsePerms, resolvePerms };
