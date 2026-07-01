/* global React, ReactDOM, FS, FIN, AUTH, SETTINGS, ALERTS, REPORTS, EDIT, HRD, PAYROLL */
const { useState: uSh, useEffect: uEh, useMemo: uMh } = React;
const tr = (k, v) => window.t(k, v);
function Ish(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

function navForRole(p) {
  const items = [];
  if (p.company) items.push({ id: 'company', label: tr('nav.company'), icon: 'IconHome', grp: 'overview' });
  if (p.company && p.reset) items.push({ id: 'projects', label: tr('nav.projects'), icon: 'IconBolt', grp: 'overview' });
  if (p.cashflow) items.push({ id: 'overview', label: tr('nav.overview'), icon: 'IconDashboard', grp: 'finance' });
  if (p.cashflow) items.push({ id: 'moneyspots', label: tr('nav.moneyspots'), icon: 'IconWallet', grp: 'finance' });
  if (p.setoran) items.push({ id: 'setoran', label: tr('nav.setoran'), icon: 'IconTruck', grp: 'finance' });
  if (p.allEntries) items.push({ id: 'entries', label: tr('nav.entries'), icon: 'IconTx', grp: 'finance' });
  if (p.reports) items.push({ id: 'reports', label: tr('nav.reports'), icon: 'IconReport', grp: 'finance' });
  if (p.employees) items.push({ id: 'employees', label: tr('nav.employees'), icon: 'IconCustomers', grp: 'hr' });
  if (p.employees) items.push({ id: 'hrcalendar', label: tr('nav.hrcalendar'), icon: 'IconCalendar', grp: 'hr' });
  if (p.payroll) items.push({ id: 'orientation', label: tr('nav.orientation'), icon: 'IconUserCircle', grp: 'hr' });
  if (p.payroll && p.attendance) items.push({ id: 'headcount', label: tr('nav.headcount'), icon: 'IconUsersGroup', grp: 'hr' });
  if (p.payroll) items.push({ id: 'payroll', label: tr('nav.payroll'), icon: 'IconUsersGroup', grp: 'hr' });
  if (p.payroll) items.push({ id: 'thr', label: tr('nav.thr'), icon: 'IconCoinIn', grp: 'hr' });
  if (p.employees && p.attendance) items.push({ id: 'hrreport', label: tr('nav.hrreport'), icon: 'IconReport', grp: 'hr' });
  if (p.payroll && p.attendance) items.push({ id: 'hrsettings', label: tr('nav.hrsettings'), icon: 'IconSettings', grp: 'hr' });
  if (p.approvals) items.push({ id: 'approvals', label: tr('nav.approvals'), icon: 'IconInvoice', grp: 'admin' });
  if (p.settings) items.push({ id: 'settings', label: tr('nav.settings'), icon: 'IconSettings', grp: 'admin' });
  if (p.reset) items.push({ id: 'users', label: tr('nav.users'), icon: 'IconUserCircle', grp: 'admin' });
  return items;
}
const NAV_GROUPS = ['overview', 'finance', 'hr', 'admin'];

function FToast({ msg, onDone }) {
  uEh(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [msg]);
  return <div className="fin-toast"><span style={{ color: '#22A7A1' }}><IconCheck s={17} /></span>{msg}</div>;
}

function PROOFMOUNT() {
  const [proof, setProof] = uSh(null);
  uEh(() => { window.UI._viewProof = setProof; return () => { if (window.UI) window.UI._viewProof = null; }; }, []);
  return proof ? <UI.ProofViewer proof={proof} onClose={() => setProof(null)} /> : null;
}

function FApp() {
  // Auth is backend-only: never auto-login from a stale LOCAL session (left over
  // from the old localStorage build). The session is restored solely from a
  // valid backend JWT by the restore effect below; otherwise the login screen
  // shows. This guarantees CLOUD is active whenever a user is signed in, so the
  // user-management / data screens always talk to the backend.
  const [user, setUser] = uSh(null);
  const [entries, setEntries] = uSh(() => FS.load());
  const [cats, setCats] = uSh(() => FS.loadCats());
  const [settings, setSettings] = uSh(() => FS.loadSettings());
  const [screen, setScreen] = uSh('overview');
  const [gran, setGran] = uSh('month');
  const [anchor, setAnchor] = uSh(FIN.TODAY);
  const [drawer, setDrawer] = uSh(false);
  const [toast, setToast] = uSh(null);
  const [editing, setEditing] = uSh(null);
  const [lang, setLang] = uSh(window.I18N.lang);
  const changeLang = (l) => { window.I18N.setLang(l); setLang(l); };
  const [hrdRates, setHrdRates] = uSh(() => HRD.loadRates());
  const [hrdStaff, setHrdStaff] = uSh(() => HRD.loadStaff());
  const [hrBudget, setHrBudget] = uSh(() => HRD.loadBudget());
  const [approvals, setApprovals] = uSh(() => CO.load());
  const [accounts, setAccounts] = uSh(() => FS.loadAccts());
  const [setoran, setSetoran] = uSh(() => FS.loadSetoran());
  const [fleet, setFleet] = uSh(() => FS.loadFleet());
  const [transfers, setTransfers] = uSh(() => FS.loadTransfers());
  const [projects, setProjects] = uSh(() => CO.loadProjects());
  const [cashbons, setCashbons] = uSh(() => CO.loadCashbons());
  const [calEvents, setCalEvents] = uSh(() => CO.loadEvents());
  const [users, setUsers] = uSh(() => FS.loadUsers());
  const [empDetail, setEmpDetail] = uSh(null);
  const [syncStatus, setSyncStatus] = uSh('saved');   // 'saving' | 'saved' | 'error' from the cloud adapter
  const [navOpen, setNavOpen] = uSh(() => { try { return JSON.parse(localStorage.getItem('airro_navopen_v1')) || {}; } catch (e) { return {}; } });

  uEh(() => { FS.save(entries); }, [entries]);
  uEh(() => { FS.saveCats(cats); }, [cats]);
  uEh(() => { FS.saveSettings(settings); }, [settings]);
  uEh(() => { HRD.saveRates(hrdRates); }, [hrdRates]);
  uEh(() => { HRD.saveStaff(hrdStaff); }, [hrdStaff]);
  uEh(() => { HRD.saveBudget(hrBudget); }, [hrBudget]);
  uEh(() => { CO.save(approvals); }, [approvals]);
  uEh(() => { FS.saveAccts(accounts); }, [accounts]);
  uEh(() => { FS.saveSetoran(setoran); }, [setoran]);
  uEh(() => { FS.saveFleet(fleet); }, [fleet]);
  uEh(() => { FS.saveTransfers(transfers); }, [transfers]);
  uEh(() => { CO.saveProjects(projects); }, [projects]);
  uEh(() => { CO.saveCashbons(cashbons); }, [cashbons]);
  uEh(() => { CO.saveEvents(calEvents); }, [calEvents]);
  uEh(() => { FS.saveUsers(users); }, [users]);

  // Per-user permission override (set by the GM) takes precedence over the role defaults.
  const p = (user && user.permissions) ? user.permissions : FS.perms(user ? user.role : 'cashier');
  const catMap = uMh(() => FS.buildMap(cats), [cats]);

  // Re-read every data slice from the (server-hydrated) stores into React state.
  // Used after login and whenever the cloud poll pulls remote changes.
  const refreshAllSlices = () => {
    setEntries(FS.load()); setCats(FS.loadCats()); setSettings(FS.loadSettings());
    setAccounts(FS.loadAccts()); setSetoran(FS.loadSetoran()); setFleet(FS.loadFleet());
    setTransfers(FS.loadTransfers());
    setHrdStaff(HRD.loadStaff()); setHrdRates(HRD.loadRates()); setHrBudget(HRD.loadBudget());
    setApprovals(CO.load()); setProjects(CO.loadProjects()); setCashbons(CO.loadCashbons()); setCalEvents(CO.loadEvents());
    setUsers(FS.loadUsers());
  };

  const login = (u) => {
    FS.setSession(u.id); setUser(u); setScreen(FS.landingScreen(u.role));
    // Backend session active → the cloud adapter hydrated localStorage from the
    // server; re-pull ALL slices so the UI shows the shared data.
    if (window.CLOUD && window.CLOUD.active) refreshAllSlices();
  };
  const logout = () => { if (window.CLOUD) window.CLOUD.logout(); FS.setSession(null); setUser(null); setDrawer(false); };

  // Restore a backend session from a persisted JWT on reload.
  uEh(() => {
    if (user || !window.CLOUD || !window.API || !window.API.getToken()) return;
    let live = true;
    window.CLOUD.restore().then((cu) => { if (live && cu) login(cu); });
    return () => { live = false; };
  }, []);

  // Auto-refresh: when the cloud poll detects remote changes, re-read slices.
  // (The poll never overwrites a key with an unsynced local edit, so re-reading
  // here can't clobber a pending local change.)
  uEh(() => {
    if (!window.CLOUD) return;
    window.CLOUD.onSync = () => refreshAllSlices();
    window.CLOUD.onStatus = (s) => setSyncStatus(s);
    return () => { if (window.CLOUD) { window.CLOUD.onSync = null; window.CLOUD.onStatus = null; } };
  }, []);

  // Lock the page scroll behind the mobile drawer while it's open.
  uEh(() => {
    document.body.classList.toggle('drawer-lock', drawer);
    return () => document.body.classList.remove('drawer-lock');
  }, [drawer]);

  const add = (e) => { setEntries((prev) => [e, ...prev]); setToast(tr(e.type === 'income' ? 'toast.incomeSaved' : 'toast.expenseSaved', { amt: FIN.fmt(e.amount) })); };
  // Upsert one staff into the roster (used by orientation actions + detail edits).
  const upsertStaff = (s) => setHrdStaff((prev) => { const clean = { ...s }; delete clean._isNew; return prev.find((x) => x.id === s.id) ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; });
  // ---- Orientation actions (new-hire lifecycle) ----
  const graduateOrientation = (s) => { upsertStaff({ ...s, stage: 'probation', orientation: { ...(s.orientation || {}), outcome: 'passed', endDate: HRD.orientationEnd(s) } }); setToast(tr('ori.toastPassed', { n: s.name })); };
  const failOrientation = (s) => { upsertStaff({ ...s, orientation: { ...(s.orientation || {}), outcome: 'failed' }, sepStatus: 'orientation_failed', active: false, separationDate: FIN.TODAY, separationReason: tr('ori.failReason') }); setToast(tr('ori.toastFailed', { n: s.name })); };
  // Orientation lump sum already posted to the cash book (by staff id) — no double post.
  const orientationPaidIds = uMh(() => (entries || []).filter((e) => e.orientation).map((e) => e.orientation), [entries]);
  const payOrientation = (s, alsoRecordExpense) => {
    const total = HRD.orientationTotal(s);
    upsertStaff({ ...s, orientation: { ...(s.orientation || {}), paid: true, paidAt: FIN.TODAY } });
    if (alsoRecordExpense && total > 0 && !orientationPaidIds.includes(s.id)) {
      const bank = accounts.find((a) => a.type === 'bank') || accounts[0] || {};
      const entry = { id: 'e' + Date.now().toString(36), type: 'expense', category: 'Orientation', amount: total, acct: bank.id,
        note: tr('ori.expenseNote', { n: s.name }), method: 'Transfer BCA', date: FIN.TODAY, time: '09:00', orientation: s.id };
      setEntries((prev) => [entry, ...prev]);
    }
    setToast(tr('ori.toastPaid', { amt: FIN.fmt(total) }));
  };
  const del = (id) => { if (!p.delete) { setToast(tr('toast.onlyOwnerDelete')); return; } const e = entries.find((x) => x.id === id); if (e && !confirm(tr('toast.deleteConfirm', { n: e.note || '', amt: FIN.fmt(e.amount || 0) }))) return; setEntries((prev) => prev.filter((x) => x.id !== id)); setToast(tr('toast.deleted')); };
  const saveEdit = (upd) => { setEntries((prev) => prev.map((x) => x.id === upd.id ? upd : x)); setEditing(null); setToast(tr('toast.updated')); };
  const resetData = () => { if (!p.reset) return; if (confirm('Reset all entries back to the demo data?')) { setEntries(FS.reset()); setToast(tr('toast.demoRestored')); } };

  const range = PERIOD.resolveRange(gran, anchor);
  const periodLbl = PERIOD.periodLabel(gran, anchor, range);
  const monthKey = anchor.slice(0, 7);                 // for payroll / alerts / tips (month-based)
  const nextDisabled = range.end >= FIN.TODAY;

  const stats = uMh(() => {
    let balIn = 0, balOut = 0, pIn = 0, pOut = 0;
    entries.forEach((e) => {
      if (e.type === 'income') balIn += e.amount; else balOut += e.amount;
      if (e.date >= range.start && e.date <= range.end) { if (e.type === 'income') pIn += e.amount; else pOut += e.amount; }
    });
    const profit = pIn - pOut;
    const openingTotal = accounts.reduce((s, a) => s + (+a.opening || 0), 0);
    return { balance: openingTotal + balIn - balOut, income: pIn, expense: pOut, profit, margin: pIn ? Math.round((profit / pIn) * 1000) / 10 : 0, monLabel: periodLbl };
  }, [entries, accounts, range.start, range.end, periodLbl]);

  const deltas = uMh(() => {
    const pm = PERIOD.prevMatched(gran, anchor, null, null, FIN.TODAY);
    const curEnd = pm.curEnd < range.end ? pm.curEnd : range.end;
    const cur = PERIOD.aggregate(entries, range.start, curEnd);
    const prv = PERIOD.aggregate(entries, pm.start, pm.end);
    return { income: PERIOD.pctDelta(cur.income, prv.income), expense: PERIOD.pctDelta(cur.expense, prv.expense), profit: PERIOD.pctDelta(cur.profit, prv.profit) };
  }, [entries, gran, anchor, range.start, range.end]);

  const curMonthKey = FIN.TODAY.slice(0, 7);
  const curPayLabel = FIN.MONTHS[+curMonthKey.split('-')[1] - 1] + ' ' + curMonthKey.split('-')[0];

  const last7 = uMh(() => {
    const arr = []; const end = new Date(FIN.TODAY + 'T00:00');
    for (let i = 6; i >= 0; i--) { const d = new Date(end); d.setDate(end.getDate() - i); arr.push({ date: d.toISOString().slice(0, 10), income: 0, expense: 0 }); }
    const byDate = {}; arr.forEach((a) => byDate[a.date] = a);
    entries.forEach((e) => { const a = byDate[e.date]; if (a) { if (e.type === 'income') a.income += e.amount; else a.expense += e.amount; } });
    return arr;
  }, [entries]);

  const breakdown = uMh(() => {
    const map = {};
    entries.filter((e) => e.type === 'expense' && e.date >= range.start && e.date <= range.end).forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    return { total, segs: Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: FS.catInfo(catMap, k).label, value: v, pct: total ? Math.round((v / total) * 100) : 0 })) };
  }, [entries, range.start, range.end, catMap]);

  const today = uMh(() => {
    let income = 0, expense = 0, count = 0;
    entries.forEach((e) => { if (e.date === FIN.TODAY) { count++; if (e.type === 'income') income += e.amount; else expense += e.amount; } });
    return { income, expense, count };
  }, [entries]);

  const recent = uMh(() => entries.slice().sort(FS.byNewest).slice(0, 12), [entries]);
  const periodEntries = uMh(() => entries.filter((e) => e.date >= range.start && e.date <= range.end).sort(FS.byNewest), [entries, range.start, range.end]);

  const prevAgg = uMh(() => {
    const [y, m] = monthKey.split('-').map(Number);
    let pm = m - 1, py = y; if (pm <= 0) { pm = 12; py--; }
    const key = `${py}-${String(pm).padStart(2, '0')}`;
    let income = 0, expense = 0; const days = new Set();
    entries.forEach((e) => { if (e.date.startsWith(key)) { days.add(e.date); e.type === 'income' ? income += e.amount : expense += e.amount; } });
    return { income, expense, days: days.size };
  }, [entries, monthKey]);

  const monthStats = uMh(() => {
    let mIn = 0, mOut = 0; const days = new Set();
    entries.forEach((e) => { if (e.date.startsWith(monthKey)) { days.add(e.date); e.type === 'income' ? mIn += e.amount : mOut += e.amount; } });
    return { income: mIn, expense: mOut, profit: mIn - mOut, margin: mIn ? Math.round(((mIn - mOut) / mIn) * 1000) / 10 : 0, days: days.size };
  }, [entries, monthKey]);

  // approved leave → auto-mark attendance days as leave
  const applyLeaveToAtt = (req) => {
    if (!req || req.type !== 'leave' || !req.from || !req.to) return;
    const mk = req.from.slice(0, 7);
    const sid = req.staffId || (hrdStaff.find((s) => s.name === req.who) || {}).id;
    CO.applyLeave(sid, mk, req.from, req.to);
    // Mirror the approved leave onto the shared HR calendar (dedupe by request id).
    if (!CO.hasEventForSource(req.id)) { CO.addEventFromRequest({ ...req, staffId: sid }, 'leave'); setCalEvents(CO.loadEvents()); }
  };

  // approved deduction request → add to that employee's payroll deductions
  const approveDeduction = (req) => {
    if (!req || !req.staffId || !req.amount) return;
    setHrdStaff((prev) => prev.map((s) => s.id === req.staffId
      ? { ...s, deductions: [...(s.deductions || []), { id: CO.newReqId(), label: req.title || 'Potongan', amount: +req.amount }] }
      : s));
  };

  const submitRequest = (req) => { setApprovals((prev) => [req, ...prev]); setToast(tr('req.submitted')); };

  // keep auto late-penalty deduction + overtime pay in sync on each staff record
  const syncLateDeduct = (staffId, amount, label, otAmount) => {
    setHrdStaff((prev) => prev.map((s) => {
      if (s.id !== staffId) return s;
      const manual = (s.deductions || []).filter((d) => !d.auto);
      const cur = (s.deductions || []).find((d) => d.auto && d.id === 'auto-late');
      const newDeds = amount > 0 ? [...manual, { id: 'auto-late', label, amount, auto: true }] : manual;
      const sameDed = (amount > 0 ? (cur && +cur.amount === amount) : !cur);
      const sameOt = (+s.otPay || 0) === (+otAmount || 0);
      if (sameDed && sameOt) return s;
      return { ...s, deductions: newDeds, otPay: +otAmount || 0 };
    }));
  };

  const salaryCatKey = uMh(() => {
    const m = cats.expense.find((c) => /salar|gaji|wage|payroll/i.test(c.label));
    return (m && m.key) || (cats.expense[0] && cats.expense[0].key) || 'Salaries';
  }, [cats]);
  // Payroll totals for the current month: exclude separated staff, prorate the
  // separation month, and fold in the running cycle's kasbon — matches PayrollScreen.
  const hrdTotals = uMh(() => HRD.totals(HRD.payrollStaff(hrdStaff, curMonthKey, hrdRates).map((s) => HRD.withCashbon(s, cashbons, HRD.payCycle().anchor)), hrdRates), [hrdStaff, hrdRates, cashbons, curMonthKey]);
  const payrollPosted = uMh(() => entries.find((e) => e.payroll === curMonthKey) || null, [entries, curMonthKey]);
  const postPayroll = (amount, label) => {
    if (!p.payroll || !amount) return;
    const existing = entries.find((e) => e.payroll === curMonthKey);
    const msg = existing ? tr('hrd.repostConfirm', { amt: FIN.fmt(amount), m: label }) : tr('hrd.postConfirm', { amt: FIN.fmt(amount), m: label });
    if (!confirm(msg)) return;
    const [yy, mm] = curMonthKey.split('-');
    const lastDay = new Date(+yy, +mm, 0).getDate();
    const date = curMonthKey === FIN.TODAY.slice(0, 7) ? FIN.TODAY : `${curMonthKey}-${String(lastDay).padStart(2, '0')}`;
    const entry = { id: 'e' + Date.now().toString(36), type: 'expense', category: salaryCatKey, amount, acct: (accounts.find((a) => a.type === 'bank') || accounts[0] || {}).id,
      note: tr('hrd.payrollNote', { m: label, n: hrdStaff.length }), method: 'Transfer BCA', date, time: '09:00', payroll: curMonthKey };
    setEntries((prev) => [entry, ...prev.filter((e) => e.payroll !== curMonthKey)]);
    // Kasbon of the payroll cycle just paid → mark settled ('paid') so they stop counting.
    const anchor = HRD.payCycle().anchor;
    setCashbons((prev) => prev.map((c) => (c.status === 'active' && (c.cycleAnchor || HRD.payCycle(c.date).anchor) === anchor) ? { ...c, status: 'paid' } : c));
    setToast(tr(existing ? 'toast.payrollUpdated' : 'toast.payrollPosted', { amt: FIN.fmt(amount) }));
  };

  // THR posting → record holiday allowance as an expense in the cash book
  const thrPosted = uMh(() => entries.find((e) => e.thr) || null, [entries]);
  const postThr = (amount, label) => {
    if (!amount) return;
    const existing = entries.find((e) => e.thr);
    if (!confirm(tr('thr.confirm', { amt: FIN.fmt(amount), d: label }))) return;
    const entry = { id: 'e' + Date.now().toString(36), type: 'expense', category: salaryCatKey, amount,
      acct: (accounts.find((a) => a.type === 'bank') || accounts[0] || {}).id,
      note: tr('thr.noteEntry', { d: label, n: hrdStaff.length }), method: 'Transfer BCA', date: FIN.TODAY, time: '09:30', thr: true };
    setEntries((prev) => [entry, ...prev.filter((e) => !e.thr)]);
    setToast(tr('thr.toast', { amt: FIN.fmt(amount) }));
  };

  // setoran → cash flow: AUTO-SYNC. Whenever setoran rows or cost/gallon change,
  // rebuild each day's linked income (deposit) + manufacturing expense in the cash book.
  const setoranPosted = uMh(() => { const m = {}; entries.forEach((e) => { if (e.setoranDay) m[e.setoranDay] = true; }); return m; }, [entries]);
  // customer payment transfers (bon/credit settled by transfer) → income entries tagged custPay
  const custPayments = uMh(() => entries.filter((e) => e.custPay).sort(FS.byNewest), [entries]);
  const addPayment = (pay) => {
    const salesCat = (cats.income.find((c) => /refill|galon|jual|sales|bon|piutang/i.test(c.label)) || cats.income[0] || {}).key || 'Refill';
    setEntries((prev) => [{ id: 'cp' + Date.now().toString(36), type: 'income', category: salesCat, amount: +pay.amount || 0,
      acct: pay.acct, note: tr('cp.note', { who: pay.party || '—', m: pay.method }), method: pay.method || 'Transfer', date: pay.date, time: '12:00', custPay: true, party: pay.party, proof: pay.proof }, ...prev]);
    setToast(tr('cp.toast', { amt: FIN.fmt(+pay.amount || 0) }));
  };
  const delPayment = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));
  uEh(() => {
    const salesCat = (cats.income.find((c) => /refill|galon|jual|sales/i.test(c.label)) || cats.income[0] || {}).key || 'Refill';
    const supCat = (cats.expense.find((c) => /supplies|produksi|pabrik|bottling|manufact/i.test(c.label)) || cats.expense[0] || {}).key || 'Supplies';
    const cashAcct = (accounts.find((a) => a.id === settings.setoranAcct) || accounts.find((a) => a.type === 'cash') || accounts[0] || {}).id;
    const bankAcct = (accounts.find((a) => a.type === 'bank') || accounts[0] || {}).id;
    const costPer = +settings.costPerGalon || 0;
    const byDay = {};
    setoran.forEach((r) => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    const fresh = [];
    Object.keys(byDay).forEach((day) => {
      const items = byDay[day];
      const totalSetoran = items.reduce((s, r) => s + FS.setoranOf(r), 0);
      const galon = items.reduce((s, r) => s + (+r.galon || 0), 0);
      if (totalSetoran !== 0) fresh.push({ id: 'stinc-' + day, type: 'income', category: salesCat, amount: totalSetoran,
        acct: cashAcct, note: tr('st.noteEntry', { d: day, n: galon, c: items.length }), method: 'Cash', date: day, time: '18:00', setoranDay: day, proof: (items.find((r) => r.proof) || {}).proof });
      const mfg = galon * costPer;
      if (mfg > 0) fresh.push({ id: 'stmfg-' + day, type: 'expense', category: supCat, amount: mfg,
        acct: bankAcct, note: tr('st.mfgNote', { d: day, n: galon, c: FIN.fmt(costPer) }), method: 'Transfer', date: day, time: '18:05', setoranMfg: day });
    });
    setEntries((prev) => {
      const others = prev.filter((e) => !e.setoranDay && !e.setoranMfg);
      const cur = prev.filter((e) => e.setoranDay || e.setoranMfg);
      const sig = (arr) => arr.map((e) => (e.setoranDay || e.setoranMfg) + ':' + e.amount + ':' + e.acct + ':' + (e.proof ? '1' : '0')).sort().join('|');
      if (sig(cur) === sig(fresh)) return prev;
      return [...fresh, ...others];
    });
  }, [setoran, settings.costPerGalon, settings.setoranAcct, cats, accounts, lang]);

  const alerts = uMh(() => p.seeMoney
    ? ALERTS.computeAlerts({ entries, balance: stats.balance, monthIncome: monthStats.income, monthExpense: monthStats.expense, month: monthKey, thresholds: settings, fmt: FIN.fmt, lang })
    : [], [entries, stats.balance, monthStats, monthKey, settings, p.seeMoney, lang]);

  // ---- not logged in ----
  if (!user) return <AUTH.LoginScreen onLogin={login} lang={lang} onLang={changeLang} users={users} />;

  const NAV = navForRole(p);
  const go = (id) => { if (NAV.find((n) => n.id === id)) setScreen(id); setDrawer(false); };
  const toggleGrp = (g) => setNavOpen((prev) => { const n = { ...prev, [g]: prev[g] === false ? true : false }; try { localStorage.setItem('airro_navopen_v1', JSON.stringify(n)); } catch (e) {} return n; });
  const Nav = () => (
    <>
      <div className="brand"><Logo s={32} /><div className="brand-lockup"><div className="brand-name">AirRO</div><div className="brand-desc">Reverse Osmosis</div></div></div>
      {NAV_GROUPS.map((g) => {
        const items = NAV.filter((n) => n.grp === g);
        if (!items.length) return null;
        const collapsed = navOpen[g] === false;
        return (
          <div key={g} className="nav-section">
            <button className={`nav-label nav-label-btn ${collapsed ? 'collapsed' : ''}`} onClick={() => toggleGrp(g)}>
              <span>{tr('navgrp.' + g)}</span><IconCaret s={13} />
            </button>
            {!collapsed && items.map((n) => (
              <button key={n.id} className={`nav-item ${screen === n.id ? 'on' : ''}`} onClick={() => go(n.id)}>
                {Ish(n.icon, { s: 20 })}<span>{n.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );

  const periodBar = (
    <div className="period-bar">
      <div className="gran-seg">
        {[['day', 'rep.day'], ['week', 'rep.week'], ['month', 'rep.month'], ['year', 'rep.year']].map(([g, key]) => (
          <button key={g} className={`gran-btn ${gran === g ? 'on' : ''}`} onClick={() => setGran(g)}>{tr(key)}</button>
        ))}
      </div>
      <DP.PeriodNav gran={gran} anchor={anchor} onAnchor={setAnchor} label={periodLbl} today={FIN.TODAY} />
    </div>
  );

  const titles = {
    company: { t: tr('t.company'), s: tr('s.company') },
    projects: { t: tr('t.projects'), s: tr('s.projects') },
    headcount: { t: tr('t.headcount'), s: tr('s.headcount') },
    employees: { t: tr('t.employees'), s: tr('s.employees') },
    hrsettings: { t: tr('t.hrsettings'), s: tr('s.hrsettings') },
    hrreport: { t: tr('t.hrreport'), s: tr('s.hrreport') },
    thr: { t: tr('t.thr'), s: tr('s.thr') },
    rollcall: { t: tr('t.rollcall'), s: tr('s.rollcall') },
    approvals: { t: tr('t.approvals'), s: tr('s.approvals') },
    overview: { t: tr('t.overview'), s: tr('s.overview') },
    moneyspots: { t: tr('t.moneyspots'), s: tr('s.moneyspots') },
    setoran: { t: tr('t.setoran'), s: tr('s.setoran') },
    entries: { t: tr('t.entries'), s: tr('s.entries') },
    reports: { t: tr('t.reports'), s: tr('s.reports') },
    payroll: { t: tr('t.payroll'), s: tr('s.payroll') },
    settings: { t: tr('t.settings'), s: tr('s.settings') },
    users: { t: tr('t.users'), s: tr('s.users') },
  }[screen] || { t: '', s: '' };

  return (
    <div className="app">
      <aside className="sidebar">
        <Nav />
        <div className="user-chip">
          <span className="user-av" style={{ background: user.color, width: 38, height: 38 }}>{FS.initials(user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="up-name" style={{ fontSize: 13.5 }}>{user.name}</div>
            <AUTH.RoleBadge role={user.role} size="sm" />
          </div>
          <button className="icon-btn logout-btn" title="Sign out" onClick={logout}><IconLogout s={18} /></button>
        </div>
      </aside>

      <div className={`scrim ${drawer ? 'open' : ''}`} onClick={() => setDrawer(false)} />
      <div className={`drawer ${drawer ? 'open' : ''}`}>
        <Nav />
        <div className="user-chip" style={{ marginTop: 'auto' }}>
          <span className="user-av" style={{ background: user.color, width: 38, height: 38 }}>{FS.initials(user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}><div className="up-name" style={{ fontSize: 13.5 }}>{user.name}</div><AUTH.RoleBadge role={user.role} size="sm" /></div>
          <button className="icon-btn logout-btn" onClick={logout}><IconLogout s={18} /></button>
        </div>
      </div>

      <main className="main">
        <div className="content">
          <header className="topbar">
            <button className="hamburger" onClick={() => setDrawer(true)}><IconMenu s={22} /></button>
            <div>
              <h1>{titles.t}</h1>
              <div className="sub">{titles.s}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {(screen === 'overview' || screen === 'entries') && periodBar}
              {window.CLOUD && window.CLOUD.active && (
                <span className={`sync-pill ${syncStatus}`} title={tr('sync.' + syncStatus)}>
                  <span className="sync-dot" /><span className="sync-txt">{tr('sync.' + syncStatus)}</span>
                </span>
              )}
              <AUTH.LangToggle lang={lang} onLang={changeLang} />
              {p.seeMoney && <ALERTS.AlertBell alerts={alerts} />}
              <div className="avatar" title={user.name} style={{ background: user.color, color: '#fff' }}>{FS.initials(user.name)}</div>
            </div>
          </header>

          {screen === 'setoran' && p.setoran && (
            <SETORAN.SetoranScreen setoran={setoran} setSetoran={setSetoran} fleet={fleet} setFleet={p.setoran ? setFleet : null} accounts={accounts} canEdit={true} postedDays={setoranPosted} autoSynced={true} costPerGalon={settings.costPerGalon} onCostChange={(v) => setSettings({ ...settings, costPerGalon: v })} depositAcct={settings.setoranAcct} onDepositAcctChange={(v) => setSettings({ ...settings, setoranAcct: v })} payments={custPayments} onAddPayment={addPayment} onDelPayment={delPayment} />
          )}

          {screen === 'moneyspots' && p.cashflow && (
            <FIN.MoneySpots accounts={accounts} setAccounts={setAccounts} entries={entries} transfers={transfers} setTransfers={setTransfers} canEdit={p.addEntry} />
          )}

          {screen === 'overview' && p.cashflow && (
            <div className="screen-enter">
              {p.seeMoney && <ALERTS.AlertBanner alerts={alerts} />}
              <FIN.StatRow stats={stats} seeMoney={p.seeMoney} deltas={deltas} />
              <div className="fin-grid">
                <div className="fin-col">
                  {p.addEntry ? <FIN.AddEntry onAdd={add} incomeCats={cats.income} expenseCats={cats.expense} accounts={accounts} /> : null}
                  <FIN.EntriesList entries={recent} onDelete={del} onEdit={setEditing} title={tr('recent.title')} catMap={catMap} canDelete={p.delete} canEdit={p.edit} />
                </div>
                <div className="fin-col">
                  <FIN.TodayCard today={today} seeMoney={p.seeMoney} />
                  <FIN.MonitorCard last7={last7} />
                  {p.seeMoney && <FIN.CategoryCard breakdown={breakdown.segs} total={breakdown.total} monLabel={periodLbl} />}
                </div>
              </div>
            </div>
          )}

          {screen === 'entries' && p.allEntries && (
            <div className="screen-enter">
              <FIN.StatRow stats={stats} seeMoney={p.seeMoney} deltas={deltas} />
              <div style={{ marginTop: 16 }}>
                <FIN.EntriesList entries={periodEntries} onDelete={del} onEdit={setEditing} filterable title={tr('entries.titleMonth', { m: periodLbl })} catMap={catMap} canDelete={p.delete} canEdit={p.edit} />
              </div>
            </div>
          )}

          {screen === 'projects' && p.company && p.reset && (
            <COMPANY.ProjectsScreen projects={projects} setProjects={setProjects} canEdit={true} />
          )}

          {screen === 'company' && p.company && (            <COMPANY.CompanyDashboard fin={stats} staff={hrdStaff} rates={hrdRates} budget={hrBudget} approvals={approvals} setApprovals={setApprovals} role={user.role} projects={projects} setoran={setoran} onApproveLeave={applyLeaveToAtt} onApproveDeduction={approveDeduction} onSubmitRequest={submitRequest} userName={user.name} />
          )}

          {screen === 'headcount' && p.payroll && p.attendance && (
            <COMPANY.HeadcountAffordability staff={hrdStaff} rates={hrdRates} budget={hrBudget} setBudget={setHrBudget} canEdit={p.payroll} />
          )}

          {screen === 'hrreport' && p.employees && (
            <COMPANY.HRReport staff={hrdStaff} rates={hrdRates} budget={hrBudget} monthKey={monthKey} today={FIN.TODAY} approvals={approvals} gran={gran} anchor={anchor} setAnchor={setAnchor} range={range} periodLbl={periodLbl} setGran={setGran} />
          )}

          {screen === 'hrsettings' && p.payroll && p.attendance && (            <PAYROLL.HrSettings rates={hrdRates} setRates={setHrdRates} />
          )}

          {screen === 'employees' && p.employees && (
            <COMPANY.EmployeeDirectory staff={hrdStaff} rates={hrdRates} monthKey={monthKey} today={FIN.TODAY} onOpen={setEmpDetail} onEdit={() => setScreen('payroll')} canEdit={p.payroll} seeMoney={p.seeMoney} setStaff={setHrdStaff} />
          )}

          {screen === 'hrcalendar' && p.employees && (
            <COMPANY.HrCalendar staff={hrdStaff} rates={hrdRates} events={calEvents} setEvents={setCalEvents} today={FIN.TODAY} canEdit={p.attendance || p.payroll} />
          )}

          {screen === 'orientation' && p.payroll && (
            <COMPANY.OrientationScreen staff={hrdStaff} setStaff={setHrdStaff} today={FIN.TODAY} canEdit={p.payroll} canAddEntry={p.addEntry} onGraduate={graduateOrientation} onFail={failOrientation} onPay={payOrientation} orientationPaidIds={orientationPaidIds} onOpen={setEmpDetail} />
          )}

          {screen === 'approvals' && p.approvals && (
            <div className="screen-enter"><COMPANY.ApprovalsCard approvals={approvals} setApprovals={setApprovals} role={user.role} canSubmit={p.approvals} staff={hrdStaff} onApproveLeave={applyLeaveToAtt} onApproveDeduction={approveDeduction} onSubmitRequest={submitRequest} /></div>
          )}

          {screen === 'reports' && p.reports && (
            <REPORTS.ReportsScreen entries={entries} catMap={catMap} userName={user.name} rates={hrdRates} staff={hrdStaff} payrollPosted={payrollPosted} payrollTotal={hrdTotals.companyCost} payrollLabel={curPayLabel} onPostPayroll={() => postPayroll(hrdTotals.companyCost, curPayLabel)} />
          )}

          {screen === 'thr' && p.payroll && (
            <COMPANY.ThrScreen staff={hrdStaff} rates={hrdRates} setRates={setHrdRates} today={FIN.TODAY} posted={thrPosted} onPost={postThr} canPost={p.addEntry || p.payroll} canEdit={p.payroll} />
          )}

          {screen === 'payroll' && p.payroll && (
            <PAYROLL.PayrollScreen rates={hrdRates} setRates={setHrdRates} staff={hrdStaff} setStaff={setHrdStaff} monLabel={curPayLabel} onPost={postPayroll} canEdit={true} cashbons={cashbons} monthKey={monthKey} />
          )}

          {screen === 'settings' && p.settings && (
            <SETTINGS.SettingsScreen cats={cats} onChange={setCats} canReset={p.reset} onResetData={resetData} settings={settings} onSettingsChange={setSettings} entries={entries} accounts={accounts} catLabel={(k) => FS.catInfo(catMap, k).label} />
          )}

          {screen === 'users' && p.reset && (
            <USERMGMT.UserManagement users={users} setUsers={setUsers} currentId={user.id} />
          )}

          <footer className="app-footer">
            <span>© 2026 AirRO Reverse Osmosis · {tr('nav.cashbook')} · {user.name}</span>
          </footer>
        </div>
      </main>

      <nav className="mobile-nav">
        {NAV.slice(0, 4).map((n) => (
          <button key={n.id} className={`mnav ${screen === n.id ? 'on' : ''}`} onClick={() => go(n.id)}>{Ish(n.icon, { s: 22 })}<span>{n.label}</span></button>
        ))}
        <button className="mnav" onClick={logout}><IconLogout s={22} /><span>{tr('nav.signout')}</span></button>
      </nav>

      {toast && <FToast msg={toast} onDone={() => setToast(null)} />}
      <PROOFMOUNT />
      {editing && p.edit && (
        <EDIT.EntryModal entry={editing} incomeCats={cats.income} expenseCats={cats.expense} onSave={saveEdit} onClose={() => setEditing(null)} />
      )}
      {empDetail && p.empDetail && (
        <COMPANY.EmployeeDetail staff={empDetail} rates={hrdRates} monthKey={monthKey} today={FIN.TODAY} seeMoney={p.seeMoney} canEdit={p.payroll} canEditAtt={p.attendance && p.payroll} onSyncDeduct={syncLateDeduct} onEdit={() => { setEmpDetail(null); setScreen('payroll'); }} onClose={() => setEmpDetail(null)} onSaveStaff={(s) => setHrdStaff((prev) => { const clean = { ...s }; delete clean._isNew; return prev.find((x) => x.id === s.id) ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; })} cashbons={cashbons} setCashbons={setCashbons} onGraduate={graduateOrientation} onFailOrientation={failOrientation} onPayOrientation={payOrientation} orientationPaid={orientationPaidIds.includes(empDetail.id)} canAddEntry={p.addEntry} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<FApp />);
