/* AirRO Water — daily cash-book store (localStorage). Exposed on window.FS */
(function () {
  const KEY = 'airro_cashbook_v4';   // trial: starts empty

  const INCOME_CATS = [
    { key: 'Refill',    label: 'Gallon Refill',     icon: 'IconDrop' },
    { key: 'Bulk',      label: 'Corporate / Bulk',  icon: 'IconStore' },
    { key: 'Deposit',   label: 'Gallon Deposit',    icon: 'IconWallet' },
    { key: 'Dispenser', label: 'Dispenser & Acc.',  icon: 'IconCoinIn' },
    { key: 'OtherIn',   label: 'Other Income',      icon: 'IconCoinIn' },
  ];
  const EXPENSE_CATS = [
    { key: 'Fuel',        label: 'Fuel & Delivery', icon: 'IconGas' },
    { key: 'Supplies',    label: 'Bottling & Supplies', icon: 'IconStore' },
    { key: 'Salaries',    label: 'Salaries & Wages', icon: 'IconUsersGroup' },
    { key: 'Orientation', label: 'Upah Orientasi (SDM)', icon: 'IconUsersGroup' },
    { key: 'Maintenance', label: 'RO Maintenance',  icon: 'IconWrench' },
    { key: 'Utilities',   label: 'Electricity & Water', icon: 'IconBolt' },
    { key: 'Rent',        label: 'Depot Rent',      icon: 'IconHome' },
    { key: 'OtherOut',    label: 'Other Expense',   icon: 'IconDots' },
  ];
  const CAT = {};
  INCOME_CATS.forEach(c => CAT[c.key] = { ...c, type: 'income' });
  EXPENSE_CATS.forEach(c => CAT[c.key] = { ...c, type: 'expense' });

  const parties = ['Warung Berkah Jaya', 'RM Padang Sederhana', 'Cafe Kopi Senja', 'Toko Sumber Rejeki',
    'Minimarket Cahaya', 'Bu Rina Catering', 'Warteg Bahari', 'Ibu Sari Wijaya', 'Pak Budi Santoso',
    'Kost Putri Melati', 'Apotek Sehat', 'Kantin Sekolah Tunas'];
  const methods = ['Cash', 'QRIS', 'Transfer BCA', 'Transfer BRI'];

  // ---- deterministic seed (~2 weeks ending 2026-06-04) ----
  function seed() {
    let s = 987654321;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const id = () => 'e' + Math.floor(rnd() * 1e9).toString(36);
    const out = [];
    const start = new Date('2026-05-22');
    const days = 14;
    for (let d = 0; d < days; d++) {
      const date = new Date(start); date.setDate(start.getDate() + d);
      const ds = date.toISOString().slice(0, 10);
      const dow = date.getDay();
      // income: accumulate realistic daily sales (~8–13jt/day)
      const dayTarget = 8000000 + Math.floor(rnd() * 5000000);
      let dayInc = 0;
      while (dayInc < dayTarget) {
        const roll = rnd();
        let cat, amount, note;
        const party = pick(parties);
        if (roll < 0.5) { const q = 10 + Math.floor(rnd() * 35); cat = 'Refill'; amount = q * 18000; note = q + ' × Galon 19L — ' + party; }
        else if (roll < 0.85) { const q = 60 + Math.floor(rnd() * 90); cat = 'Bulk'; amount = q * 17000; note = q + ' × Galon (bulk) — ' + party; }
        else if (roll < 0.93) { cat = 'Deposit'; amount = 50000 * (1 + Math.floor(rnd() * 3)); note = 'Deposit galon kosong — ' + party; }
        else { cat = 'Dispenser'; amount = 350000 + Math.floor(rnd() * 5) * 25000; note = 'Dispenser galon — ' + party; }
        out.push({ id: id(), type: 'income', category: cat, amount, note, method: pick(methods),
          date: ds, time: hhmm(8 + Math.floor(rnd() * 9), rnd()) });
        dayInc += amount;
      }
      // expenses
      if (rnd() < 0.7) out.push(mk('Fuel', 250000 + Math.floor(rnd() * 5) * 30000, 'Solar — armada pengiriman', ds, rnd, id));
      if (rnd() < 0.4) out.push(mk('Supplies', 800000 + Math.floor(rnd() * 8) * 250000, 'Galon kosong / tutup / segel', ds, rnd, id));
      if (rnd() < 0.25) out.push(mk('Maintenance', 600000 + Math.floor(rnd() * 4) * 200000, 'Servis filter / membran RO', ds, rnd, id));
      // fixed monthly-ish
      if (ds === '2026-05-30') out.push(mk('Rent', 6000000, 'Sewa depot bulan Juni', ds, rnd, id));
      if (ds === '2026-05-31') out.push(mk('Utilities', 2850000, 'Tagihan listrik PLN', ds, rnd, id));
      // NOTE: payroll is intentionally NOT seeded here — it flows into Cash Flow
      // only when posted from the Payroll/HRD report (full company cost incl. BPJS).
    }
    return out;
    function hhmm(h, r) { return String(h).padStart(2, '0') + ':' + String(Math.floor(r * 60)).padStart(2, '0'); }
    function mk(cat, amount, note, ds, rnd, id) {
      return { id: id(), type: 'expense', category: cat, amount, note, method: 'Cash', date: ds, time: hhmm2(rnd) };
      function hhmm2(r) { const h = 7 + Math.floor(r() * 11); return String(h).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0'); }
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
    } catch (e) {}
    const s = [];
    save(s);
    return s;
  }
  function save(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {} }
  function reset() { const s = []; save(s); return s; }

  // sort newest first
  const byNewest = (a, b) => (b.date + b.time).localeCompare(a.date + a.time);

  // ---- editable categories storage ----
  const CAT_KEY = 'airro_cats_v1';
  const ICON_CHOICES = ['IconDrop', 'IconStore', 'IconWallet', 'IconCoinIn', 'IconCoinOut',
    'IconGas', 'IconUsersGroup', 'IconWrench', 'IconBolt', 'IconHome', 'IconTruck', 'IconFork', 'IconInvoice', 'IconDots'];
  function loadCats() {
    try { const raw = localStorage.getItem(CAT_KEY); if (raw) { const o = JSON.parse(raw); if (o && Array.isArray(o.income) && Array.isArray(o.expense)) return o; } } catch (e) {}
    const def = { income: INCOME_CATS.map((c) => ({ ...c })), expense: EXPENSE_CATS.map((c) => ({ ...c })) };
    saveCats(def); return def;
  }
  function saveCats(c) { try { localStorage.setItem(CAT_KEY, JSON.stringify(c)); } catch (e) {} }
  function resetCats() { try { localStorage.removeItem(CAT_KEY); } catch (e) {} return loadCats(); }
  function buildMap(cats) {
    const m = {};
    cats.income.forEach((c) => m[c.key] = { ...c, type: 'income' });
    cats.expense.forEach((c) => m[c.key] = { ...c, type: 'expense' });
    return m;
  }
  // resolve a category key to its info, falling back to defaults then a generic
  function catInfo(map, key) { return (map && map[key]) || CAT[key] || { key, label: key, icon: 'IconDots', type: 'expense' }; }
  const newCatKey = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

  // ---- users / roles / session ----
  const SESSION_KEY = 'airro_session_v1';
  // No demo accounts in the client source: authentication is handled entirely
  // by the backend (see api.js / cloud.js). Users are administered via the
  // backend /users API. This array is intentionally empty for public builds.
  const SEED_USERS = [];
  const USERS_KEY = 'airro_users_v1';
  function loadUsers() { try { const r = localStorage.getItem(USERS_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a) && a.length) return a; } } catch (e) {} return JSON.parse(JSON.stringify(SEED_USERS)); }
  function saveUsers(a) { try { localStorage.setItem(USERS_KEY, JSON.stringify(a)); } catch (e) {} }
  const newUserId = () => 'u_' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  const USERS = loadUsers();
  const ROLE_COLORS = { owner: '#065489', gm: '#0B7EB1', hrd: '#138FB3', finance: '#22A7A1', adminfin: '#3FB8B2' };
  const ROLES = {
    owner:   { label: 'Owner',           blurb: 'Executive read-only overview', readonly: true,
      perms: { company: true,  cashflow: true,  employees: false, empDetail: false, attendance: false, addEntry: false, edit: false, seeMoney: true,  allEntries: false, reports: true,  advisor: false, payroll: false, approvals: false, delete: false, settings: false, reset: false, kasbon: false, kasbonApprove: false, distribusiInput: true, distribusiKoreksi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true } },
    gm:      { label: 'General Manager', blurb: 'Full access to everything',
      perms: { company: true,  cashflow: true,  employees: true,  empDetail: true,  attendance: true,  addEntry: true,  edit: true,  seeMoney: true,  allEntries: true,  reports: true,  advisor: true,  payroll: true,  approvals: true,  delete: true,  settings: true,  reset: true, kasbon: true, kasbonApprove: true, distribusiInput: true, distribusiKoreksi: true, distribusiCustomers: true, distribusiHargaMaster: true, distribusiAudit: true } },
    hrd:     { label: 'HRD',             blurb: 'People, payroll & attendance',
      perms: { company: false, cashflow: false, employees: true,  empDetail: true,  attendance: true,  addEntry: false, edit: false, seeMoney: true,  allEntries: false, reports: false, advisor: false, payroll: true,  approvals: true,  delete: false, settings: false, reset: false, kasbon: true, kasbonApprove: true, distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false } },
    finance: { label: 'Finance',         blurb: 'Cash book, reports & payroll posting',
      perms: { company: false, cashflow: true,  employees: false, empDetail: false, attendance: false, addEntry: true,  edit: true,  seeMoney: true,  allEntries: true,  reports: true,  advisor: true,  payroll: true,  approvals: true,  delete: true,  settings: true,  reset: false, setoran: true, kasbon: true, kasbonApprove: false, distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false } },
    adminfin:{ label: 'Admin Finance',    blurb: 'Daily delivery setoran input',
      perms: { company: false, cashflow: true,  employees: false, empDetail: false, attendance: false, addEntry: false, edit: false, seeMoney: true,  allEntries: true,  reports: false, advisor: false, payroll: false, approvals: false, delete: false, settings: false, reset: false, setoran: true, setoranOnly: true, kasbon: false, kasbonApprove: false, distribusiInput: false, distribusiKoreksi: false, distribusiCustomers: false, distribusiHargaMaster: false, distribusiAudit: false } },
  };
  // Roles are now DATA managed via /roles. The hard-coded ROLES above are the
  // built-in defaults / offline fallback; the shell calls FS.setRoles(list) with the
  // live roles after login, and everything below reads through roleMap().
  let dynRoles = null;
  function setRoles(list) {
    if (!Array.isArray(list) || !list.length) { dynRoles = null; return; }
    const m = {};
    list.forEach((r) => { if (r && r.id) m[r.id] = { label: r.name || r.id, color: r.color || ROLE_COLORS[r.id] || '#22A7A1', perms: r.permissions || {}, builtin: !!r.builtin }; });
    dynRoles = m;
  }
  function roleMap() {
    if (dynRoles) return dynRoles;
    const m = {}; Object.keys(ROLES).forEach((id) => { m[id] = { label: ROLES[id].label, color: ROLE_COLORS[id] || '#22A7A1', perms: ROLES[id].perms, builtin: true }; }); return m;
  }
  function roleList() { const rm = roleMap(); return Object.keys(rm).map((id) => ({ id, name: rm[id].label, color: rm[id].color, perms: rm[id].perms, builtin: rm[id].builtin })); }
  const roleName = (role) => (roleMap()[role] && roleMap()[role].label) || role;
  const roleColor = (role) => (roleMap()[role] && roleMap()[role].color) || ROLE_COLORS[role] || '#22A7A1';
  const perms = (role) => (roleMap()[role] || roleMap().finance || ROLES.finance).perms;
  // Kasbon caps were split per-action (request/approve/reject/cancel/delete). Mirror
  // the server's deriveKasbonCaps: fill any ABSENT granular cap from the legacy pair so
  // old roles/overrides keep working, keep `kasbon` as the request alias, and add a
  // `kasbonView` convenience (holds ANY kasbon cap → may open/list the Kasbon screen).
  function normKasbon(perms) {
    const p = { ...(perms || {}) };
    const legacyApprove = !!p.kasbonApprove;
    if (p.kasbonRequest === undefined) p.kasbonRequest = !!p.kasbon;
    if (p.kasbonReject === undefined) p.kasbonReject = legacyApprove;
    if (p.kasbonCancel === undefined) p.kasbonCancel = legacyApprove;
    if (p.kasbonDelete === undefined) p.kasbonDelete = legacyApprove;
    p.kasbon = !!p.kasbonRequest;
    p.kasbonView = !!(p.kasbon || p.kasbonApprove || p.kasbonReject || p.kasbonCancel || p.kasbonDelete);
    // Distribusi: 'distribusi' (input+koreksi combined) split into distribusiInput
    // (create + view) and distribusiKoreksi (corrections). Mirror the server's
    // deriveDistribusiCaps: fill absent split caps from the legacy value so old
    // roles/overrides keep both; keep `distribusi` as the "may open module" alias
    // (holds ANY distribusi cap).
    const legacyDist = !!p.distribusi;
    if (p.distribusiInput === undefined) p.distribusiInput = legacyDist;
    if (p.distribusiKoreksi === undefined) p.distribusiKoreksi = legacyDist;
    p.distribusi = !!(p.distribusiInput || p.distribusiKoreksi || p.distribusiCustomers || p.distribusiHargaMaster || p.distribusiAudit);
    return p;
  }
  const landingScreen = (role) => { const p = perms(role); return p.setoranOnly ? 'setoran' : p.company ? 'company' : p.cashflow ? 'overview' : p.employees ? 'employees' : p.payroll ? 'payroll' : p.kasbon ? 'kasbon' : 'overview'; };
  const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  function loadSession() { try { const id = localStorage.getItem(SESSION_KEY); return loadUsers().find((u) => u.id === id) || null; } catch (e) { return null; } }
  function setSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  // ---- app settings (alert thresholds) ----
  const SETTINGS_KEY = 'airro_settings_v1';
  const DEFAULT_SETTINGS = { lowCash: 20000000, bigExpense: 5000000, costPerGalon: 12000 };
  function loadSettings() { try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch (e) {} return { ...DEFAULT_SETTINGS }; }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

  // ---- money spots (cash + bank accounts) ----
  const ACCT_KEY = 'airro_accounts_v2';   // trial: zero opening balances
  const DEFAULT_ACCTS = [
    { id: 'cash',   name: 'Cash',     type: 'cash', bank: '',        number: '', opening: 0, color: '#22A7A1' },
    { id: 'bca',    name: 'BCA',      type: 'bank', bank: 'BCA',     number: '', opening: 0, color: '#065489' },
    { id: 'mandiri',name: 'Mandiri',  type: 'bank', bank: 'Mandiri', number: '', opening: 0, color: '#0B7EB1' },
  ];
  function loadAccts() { try { const r = localStorage.getItem(ACCT_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a) && a.length) return a; } } catch (e) {} const s = JSON.parse(JSON.stringify(DEFAULT_ACCTS)); saveAccts(s); return s; }
  function saveAccts(a) { try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch (e) {} }
  function resetAccts() { const s = JSON.parse(JSON.stringify(DEFAULT_ACCTS)); saveAccts(s); return s; }
  const newAcctId = () => 'ac' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  // balance of one account = opening + signed entries + net transfers in/out
  function acctBalance(acct, entries, accts, transfers) {
    const ids = (accts || []).map((a) => a.id);
    let bal = +acct.opening || 0;
    entries.forEach((e) => {
      if (e.reference) return;   // non-cash "reference" cost (e.g. production cost in reference mode) never touches a cash balance
      const aid = e.acct && ids.includes(e.acct) ? e.acct : ids[0];   // unassigned → first account
      if (aid === acct.id) bal += (e.type === 'income' ? e.amount : -e.amount);
    });
    (transfers || []).forEach((t) => {
      if (t.from === acct.id) bal -= (+t.amount || 0);
      if (t.to === acct.id) bal += (+t.amount || 0);
    });
    return bal;
  }

  // ---- account transfers (move money between spots, not income/expense) ----
  const XFER_KEY = 'airro_transfers_v1';
  function loadTransfers() { try { const r = localStorage.getItem(XFER_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} return []; }
  function saveTransfers(a) { try { localStorage.setItem(XFER_KEY, JSON.stringify(a)); } catch (e) {} }
  const newXferId = () => 'xf' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);

  // ---- delivery setoran (per-armada daily deposit) ----
  const SETORAN_KEY = 'airro_setoran_v2';   // trial: starts empty
  const FLEET_KEY = 'airro_fleet_v1';
  const FLEET_CACHE_KEY = 'airro_fleet_cache_v1';   // live REST-synced fleet (the single source of truth)
  // SINGLE SOURCE for the fleet list everywhere. The authoritative value is the
  // REST setting `airro_fleet` (managed in Setoran → Kelola Armada), mirrored to
  // FLEET_CACHE_KEY. Read that first, fall back to the legacy local key, then empty.
  // NEVER inject placeholder fleets — a fresh install has no fleets until the user
  // adds them, so no stale "L-xxx" defaults can leak into any picker.
  function loadFleet() {
    for (const k of [FLEET_CACHE_KEY, FLEET_KEY]) {
      try { const r = localStorage.getItem(k); if (r) { const a = JSON.parse(r); if (Array.isArray(a) && a.length) return a; } } catch (e) {}
    }
    return [];
  }
  function saveFleet(a) { try { localStorage.setItem(FLEET_KEY, JSON.stringify(a)); } catch (e) {} }
  function loadSetoran() { try { const r = localStorage.getItem(SETORAN_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} const s = seedSetoran(); saveSetoran(s); return s; }
  function saveSetoran(a) { try { localStorage.setItem(SETORAN_KEY, JSON.stringify(a)); } catch (e) {} }
  const newSetoranId = () => 'st' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  // setoran (deposit) = cash sales + bon payments received - field expenses
  function setoranOf(r) { return (+r.cash || 0) + (+r.bonPay || 0) - (+r.expense || 0); }
  function seedSetoran() { return []; }

  window.FS = { KEY, INCOME_CATS, EXPENSE_CATS, CAT, methods, parties, load, save, reset, byNewest, seed,
    CAT_KEY, ICON_CHOICES, loadCats, saveCats, resetCats, buildMap, catInfo, newCatKey,
    SESSION_KEY, USERS, ROLES, ROLE_COLORS, perms, normKasbon, setRoles, roleList, roleName, roleColor, landingScreen, initials, loadSession, setSession,
    USERS_KEY, SEED_USERS, loadUsers, saveUsers, newUserId,
    SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings,
    ACCT_KEY, loadAccts, saveAccts, resetAccts, newAcctId, acctBalance,
    XFER_KEY, loadTransfers, saveTransfers, newXferId,
    SETORAN_KEY, FLEET_KEY, loadFleet, saveFleet, loadSetoran, saveSetoran, newSetoranId, setoranOf };
})();
