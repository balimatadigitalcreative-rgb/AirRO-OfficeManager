/* global React, ReactDOM, FS, FIN, AUTH, SETTINGS, ALERTS, REPORTS, EDIT, HRD, PAYROLL */
const { useState: uSh, useEffect: uEh, useMemo: uMh, useRef: uRf } = React;
const tr = (k, v) => window.t(k, v);
function Ish(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

function navForRole(p, role) {
  // Owner/GM always keep access to user & role management, even if the 'reset'
  // capability were edited off their role — so an admin can't lock themselves out.
  const canAdmin = !!(p.reset || role === 'owner' || role === 'gm');
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
  if (p.kasbon) items.push({ id: 'kasbon', label: tr('nav.kasbon'), icon: 'IconWallet', grp: 'hr' });
  if (p.payroll) items.push({ id: 'thr', label: tr('nav.thr'), icon: 'IconCoinIn', grp: 'hr' });
  if (p.employees && p.attendance) items.push({ id: 'hrreport', label: tr('nav.hrreport'), icon: 'IconReport', grp: 'hr' });
  if (p.payroll && p.attendance) items.push({ id: 'hrsettings', label: tr('nav.hrsettings'), icon: 'IconSettings', grp: 'hr' });
  if (p.approvals) items.push({ id: 'approvals', label: tr('nav.approvals'), icon: 'IconInvoice', grp: 'admin' });
  if (p.settings) items.push({ id: 'settings', label: tr('nav.settings'), icon: 'IconSettings', grp: 'admin' });
  if (canAdmin) items.push({ id: 'users', label: tr('nav.users'), icon: 'IconUserCircle', grp: 'admin' });
  // DISTRIBUSI — a separate module. Items are shown to everyone (discoverability);
  // ones the role can't access render LOCKED (gembok), never hidden, per the spec.
  // `cap` = the capability that unlocks the item; the server enforces it regardless.
  [
    { id: 'dist-dashboard', label: tr('nav.distDashboard'), icon: 'IconDashboard', cap: 'distribusi' },
    { id: 'dist-customers', label: tr('nav.distCustomers'), icon: 'IconCustomers', cap: 'distribusi' },
    { id: 'dist-transactions', label: tr('nav.distTransactions'), icon: 'IconTx', cap: 'distribusi' },
    { id: 'dist-integration', label: tr('nav.distIntegration'), icon: 'IconRefresh', cap: 'distribusi' },
    { id: 'dist-prices', label: tr('nav.distPrices'), icon: 'IconCoinIn', cap: 'distribusiHargaMaster' },
    { id: 'dist-audit', label: tr('nav.distAudit'), icon: 'IconShield', cap: 'distribusiAudit' },
    // `locked` (padlock) = missing the item's own cap; `blocked` (no nav) = missing
    // base distribusi entirely. A staff (has distribusi, not the owner caps) CAN open
    // Harga/Audit — the screen itself shows a "Terkunci untuk Staff" panel.
  ].forEach((it) => items.push({ ...it, grp: 'distribusi', locked: !p[it.cap], blocked: !p.distribusi }));
  return items;
}
const NAV_GROUPS = ['overview', 'finance', 'hr', 'distribusi', 'admin'];

function FToast({ msg, onDone }) {
  uEh(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [msg]);
  return <div className="fin-toast"><span style={{ color: '#22A7A1' }}><IconCheck s={17} /></span>{msg}</div>;
}

// Distribusi module — FOUNDATION placeholder. The real screens (Dashboard,
// Pelanggan, Transaksi, Integrasi Kas, Harga Master, Log Audit) are built next; this
// keeps navigation working and confirms access/lock state in the meantime.
function DistPlaceholder({ screen, nav }) {
  const item = (nav || []).find((n) => n.id === screen);
  return (
    <div className="screen-enter">
      <div className="card dist-ph">
        <span className="dist-ph-ic"><IconTruck s={30} /></span>
        <div className="dist-ph-t">{tr('dist.module')} · {item ? item.label : ''}</div>
        <div className="dist-ph-s">{tr('dist.phSub')}</div>
      </div>
    </div>
  );
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
  // Cash book now lives in the REST per-record Entry table (like setoran), NOT the
  // /state blob — so one user deleting/editing an entry is never overwritten by
  // another client's stale whole-array push. `realEntries` holds the persisted
  // records; the setoran→cash-flow rows are DERIVED in-memory (see setoranEntries)
  // and never persisted. We seed from a local read-cache (SKIP-listed) for instant
  // paint; GET /entries is authoritative.
  const [realEntries, setRealEntries] = uSh(() => { try { const c = localStorage.getItem('airro_cashbook_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  // Categories now persist to the REST key-value store (/settings key 'airro_cats'),
  // accounts to the /accounts table — both off the /state block-mirror. Seed from
  // SKIP-listed caches for instant paint.
  const [cats, setCats] = uSh(() => { try { const c = localStorage.getItem('airro_cats_cache_v1'); if (c) { const o = JSON.parse(c); if (o && Array.isArray(o.income) && Array.isArray(o.expense)) return o; } } catch (e) {} return FS.loadCats(); });
  const [settings, setSettings] = uSh(() => FS.loadSettings());
  const [screen, setScreen] = uSh('overview');
  const [gran, setGran] = uSh('month');
  const [anchor, setAnchor] = uSh(FIN.TODAY);
  const [drawer, setDrawer] = uSh(false);
  const [toast, setToast] = uSh(null);
  const [pwModal, setPwModal] = uSh(false);   // self "Ganti Password" modal
  const [distTick, setDistTick] = uSh(0);      // bumps on a distribusi SSE event → dashboard/transaksi re-fetch
  const [distFormTick, setDistFormTick] = uSh(0);   // bumps when "Input Cepat" wants the Transaksi form opened
  const [sessionExpired, setSessionExpired] = uSh(false);   // token expired → prompt re-login
  // Roles are DATA (managed via /roles). Seed FS with the cached list for instant
  // paint; the shell reloads the live list after login (reloadRoles).
  const [roles, setRolesState] = uSh(() => { try { const c = localStorage.getItem('airro_roles_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a) && a.length) { FS.setRoles(a); return a; } } } catch (e) {} return null; });
  const [editing, setEditing] = uSh(null);
  const [lang, setLang] = uSh(window.I18N.lang);
  const changeLang = (l) => { window.I18N.setLang(l); setLang(l); };
  const [hrdRates, setHrdRates] = uSh(() => HRD.loadRates());
  // Roster now lives in the REST per-record Employee table (like setoran/entries),
  // NOT the /state blob — so one user's add/edit/offboard is never overwritten by
  // another client's stale whole-array push. Seed from a SKIP-listed local cache for
  // instant paint; GET /employees?includeInactive=true is authoritative.
  const [hrdStaff, setHrdStaff] = uSh(() => { try { const c = localStorage.getItem('airro_staff_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  const [departments, setDepartments] = uSh(() => HRD.loadDepartments());
  const [hrBudget, setHrBudget] = uSh(() => HRD.loadBudget());
  // Approvals now live in the REST per-record Approval table (like kasbon) — submit
  // + approve by different users no longer clobber each other. Seed from a
  // SKIP-listed cache; GET /approvals is authoritative.
  const [approvals, setApprovals] = uSh(() => { try { const c = localStorage.getItem('airro_approvals_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  const [accounts, setAccounts] = uSh(() => { try { const c = localStorage.getItem('airro_accounts_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a) && a.length) return a; } } catch (e) {} return FS.loadAccts(); });
  // Setoran now lives in the REST table (per-record), NOT the /state blob — so
  // concurrent edits by different users never overwrite each other. We seed from a
  // local read-cache (SKIP-listed, not mirrored) just for instant paint on reload;
  // the authoritative list is (re)loaded from GET /setoran.
  const [setoran, setSetoran] = uSh(() => { try { const c = localStorage.getItem('airro_setoran_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  const [fleet, setFleet] = uSh(() => { try { const c = localStorage.getItem('airro_fleet_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a) && a.length) return a; } } catch (e) {} return FS.loadFleet(); });
  const [transfers, setTransfers] = uSh(() => { try { const c = localStorage.getItem('airro_transfers_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return FS.loadTransfers(); });
  const [projects, setProjects] = uSh(() => CO.loadProjects());
  // Kasbon now lives in the REST per-record Cashbon table (like setoran/entries/
  // staff), NOT the /state blob — submit/approve by different users no longer clobber
  // each other. Seed from a SKIP-listed cache; GET /cashbon is authoritative.
  const [cashbons, setCashbons] = uSh(() => { try { const c = localStorage.getItem('airro_cashbon_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  // HR calendar events now live in the REST CalendarEvent table (per-record). Seed
  // from a SKIP-listed cache; GET /calendar is authoritative.
  const [calEvents, setCalEvents] = uSh(() => { try { const c = localStorage.getItem('airro_calendar_cache_v1'); if (c) { const a = JSON.parse(c); if (Array.isArray(a)) return a; } } catch (e) {} return []; });
  const [users, setUsers] = uSh(() => FS.loadUsers());
  const [empDetail, setEmpDetail] = uSh(null);
  const [syncStatus, setSyncStatus] = uSh('saved');   // 'saving' | 'saved' | 'error' from the cloud adapter
  const [syncTick, setSyncTick] = uSh(0);             // bumps on every applied remote change → forces on-demand readers (attendance / orientation) to re-read
  const [navOpen, setNavOpen] = uSh(() => { try { return JSON.parse(localStorage.getItem('airro_navopen_v1')) || {}; } catch (e) { return {}; } });

  // settings/rates/budget/departments/projects persist to REST /settings keys (see
  // the config slices below) — no longer mirrored to /state.
  uEh(() => { FS.saveUsers(users); }, [users]);   // fleet/transfers are REST-loaded (see config slices below)

  // Per-user permission override (set by the GM) takes precedence over the role defaults.
  const p = (user && user.permissions) ? user.permissions : FS.perms(user ? user.role : 'cashier');
  const catMap = uMh(() => FS.buildMap(cats), [cats]);

  // ── Setoran: REST per-record (create/update/delete one record at a time) ──
  // The old model mirrored the whole array to /state, so two users saving at once
  // clobbered each other (last-write-wins on the blob). Now each row is its own
  // REST record; a light 3s poll of GET /setoran keeps everyone current.
  // Proof photos travel as a JSON STRING in the REST record (the server proof column
  // is a string), while the app works with an object { name, isImg, data }. Serialize
  // on the way out; parse on the way back (tolerating a legacy raw data-URL string).
  // Sending the object as-is was rejected 400 by the server → surfaced as the
  // misleading "server tidak terjangkau".
  const proofToApi = (pr) => (pr == null ? null : (typeof pr === 'string' ? pr : JSON.stringify(pr)));
  const proofFromApi = (s) => {
    if (s == null || s === '') return undefined;
    if (typeof s === 'object') return s;
    try { const o = JSON.parse(s); if (o && typeof o === 'object' && 'data' in o) return o; } catch (e) {}
    return /^data:/.test(s) ? { name: 'bukti', isImg: /^data:image\//.test(s), data: s } : undefined;
  };
  const setoranToApi = (r) => ({ id: r.id, date: r.date, armada: r.armada || '', galon: +r.galon || 0, cash: +r.cash || 0, bon: +r.bon || 0, bonPay: +r.bonPay || 0, expense: +r.expense || 0, note: r.note || '', proof: proofToApi(r.proof) });
  const reloadSetoran = () => {
    if (!(window.API && window.API.setoran)) return Promise.resolve();
    return window.API.setoran.list('limit=2000').then((r) => {
      if (r && Array.isArray(r.data)) { const rows = r.data.map((row) => ({ ...row, proof: proofFromApi(row.proof) })); setSetoran(rows); try { localStorage.setItem('airro_setoran_cache_v1', JSON.stringify(rows)); } catch (e) {} }
    }).catch(() => {});
  };
  const addSetoran = (rec) => {
    setSetoran((prev) => [{ ...rec }, ...prev.filter((x) => x.id !== rec.id)]);   // optimistic
    window.API.setoran.create(setoranToApi(rec)).then(reloadSetoran).catch(() => { setToast(tr('st.syncErr')); reloadSetoran(); });
  };
  const editSetoran = (rec) => {
    setSetoran((prev) => prev.map((x) => (x.id === rec.id ? { ...x, ...rec } : x)));   // optimistic
    window.API.setoran.update(rec.id, setoranToApi(rec)).then(reloadSetoran).catch(() => { setToast(tr('st.syncErr')); reloadSetoran(); });
  };
  const removeSetoran = (id) => {
    setSetoran((prev) => prev.filter((x) => x.id !== id));   // optimistic
    window.API.setoran.remove(id).then(reloadSetoran).catch(() => { setToast(tr('st.syncErr')); reloadSetoran(); });
  };
  // Initial load + light realtime poll (only for users with setoran access). Poll
  // pauses while the tab is hidden and refreshes immediately when it regains focus.
  uEh(() => {
    if (!p.setoran || !(window.API && window.API.setoran)) return;
    reloadSetoran();
    // SSE (CLOUD.onEvent → reloadSetoran) is the primary realtime path; this timer is
    // just a slow backstop in case an event is missed while the stream is down.
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadSetoran(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadSetoran(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [p.setoran]);

  // ── Cash book: REST per-record (create/update/delete one entry at a time) ──
  // Same model as setoran: each entry is its own row, so concurrent edits never
  // clobber each other. Derived setoran rows (stinc-/stmfg-) are NEVER persisted —
  // they are recomputed in-memory from the setoran table below.
  const ENTRY_TAGS = ['custPay', 'party', 'payroll', 'thr', 'orientation'];
  const isDerivedEntry = (id) => /^st(inc|mfg)-/.test(String(id || ''));
  const entryToApi = (e) => {
    const tags = {}; ENTRY_TAGS.forEach((k) => { if (e[k] != null) tags[k] = e[k]; });
    return { id: e.id, type: e.type === 'income' ? 'income' : 'expense', amount: Math.max(0, Math.round(+e.amount || 0)),
      note: e.note || '', method: e.method || 'Cash', date: e.date, time: e.time || '00:00',
      category: e.category != null ? e.category : null, acct: e.acct != null ? e.acct : null,
      proof: proofToApi(e.proof), meta: Object.keys(tags).length ? JSON.stringify(tags) : null };
  };
  const apiToEntry = (row) => {
    let tags = {}; try { tags = row.meta ? JSON.parse(row.meta) : {}; } catch (e) {}
    const o = { id: row.id, type: row.type, amount: row.amount, note: row.note || '', method: row.method || 'Cash',
      date: row.date, time: row.time || '00:00', category: row.category || undefined, acct: row.acct || undefined };
    const pf = proofFromApi(row.proof); if (pf) o.proof = pf;
    if (row.createdBy && row.createdBy.name) o.createdBy = { name: row.createdBy.name, role: row.createdBy.role || null };   // "input by" snapshot
    if (row.createdById) o.createdById = row.createdById;   // identity → drives "My Activity"
    if (row.createdAt) o.createdAt = new Date(row.createdAt).getTime();
    return Object.assign(o, tags);
  };
  const reloadEntries = () => {
    if (!(window.API && window.API.entries)) return Promise.resolve();
    return window.API.entries.list('limit=5000').then((r) => {
      if (r && Array.isArray(r.data)) { const rows = r.data.map(apiToEntry); setRealEntries(rows); try { localStorage.setItem('airro_cashbook_cache_v1', JSON.stringify(rows)); } catch (e) {} }
    }).catch(() => {});
  };
  // On failure: a 403 means the server refused (missing addEntry/edit/delete cap) —
  // tell the user plainly; anything else is a transient network error that retries.
  // Either way reloadEntries() re-syncs the optimistic change to the server's truth
  // (a rejected delete reappears; a rejected add drops back out).
  const entryErr = (op) => (err) => {
    const key = err && err.status === 403 ? (op === 'delete' ? 'toast.noDeletePerm' : 'toast.noPerm')
      : (err && err.status === 413) ? 'att.saveTooBig'   // payload too large → almost always the proof photo
      : 'st.syncErr';
    setToast(tr(key));
    reloadEntries();
  };
  const addEntry = (e) => {
    if (isDerivedEntry(e.id)) return;   // derived rows are in-memory only
    // Stamp the creator optimistically (the server does the authoritative stamp from
    // the token); reloadEntries then replaces it with the server's snapshot.
    const optimistic = { ...apiToEntry(entryToApi(e)), createdBy: e.createdBy || (user ? { name: user.name, role: user.role } : null), createdById: e.createdById || (user ? user.id : undefined), createdAt: e.createdAt || Date.now() };
    setRealEntries((prev) => [optimistic, ...prev.filter((x) => x.id !== e.id)]);
    if (window.API && window.API.entries) window.API.entries.create(entryToApi(e)).then(reloadEntries).catch(entryErr('add'));
  };
  const editEntry = (e) => {
    if (isDerivedEntry(e.id)) return;
    // Editing must not drop the original creator — preserve it on the optimistic row.
    setRealEntries((prev) => prev.map((x) => (x.id === e.id ? { ...apiToEntry(entryToApi(e)), createdBy: x.createdBy || null } : x)));
    if (window.API && window.API.entries) window.API.entries.update(e.id, entryToApi(e)).then(reloadEntries).catch(entryErr('edit'));
  };
  const removeEntry = (id) => {
    if (isDerivedEntry(id)) return;   // can't delete a derived row; it regenerates from setoran
    setRealEntries((prev) => prev.filter((x) => x.id !== id));   // optimistic
    if (window.API && window.API.entries) window.API.entries.remove(id).then(reloadEntries).catch(entryErr('delete'));
  };
  // Initial load + light realtime poll (only for users with cash-book access).
  uEh(() => {
    if (!p.cashflow || !(window.API && window.API.entries)) return;
    reloadEntries();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadEntries(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadEntries(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [p.cashflow]);

  // setoran → cash flow, DERIVED (in-memory, never persisted). Whenever setoran
  // rows or cost/gallon change, each day's linked income (deposit) + manufacturing
  // expense are recomputed from the setoran REST table. These rows carry
  // setoranDay/setoranMfg tags and stable ids (stinc-/stmfg-DAY); they are merged
  // into `entries` for display/stats but are excluded from the Entry table.
  const setoranEntries = uMh(() => {
    const salesCat = (cats.income.find((c) => /refill|galon|jual|sales/i.test(c.label)) || cats.income[0] || {}).key || 'Refill';
    const supCat = (cats.expense.find((c) => /supplies|produksi|pabrik|bottling|manufact/i.test(c.label)) || cats.expense[0] || {}).key || 'Supplies';
    const cashAcct = (accounts.find((a) => a.id === settings.setoranAcct) || accounts.find((a) => a.type === 'cash') || accounts[0] || {}).id;
    const bankAcct = (accounts.find((a) => a.type === 'bank') || accounts[0] || {}).id;
    const costPer = +settings.costPerGalon || 0;
    const byDay = {};
    setoran.forEach((r) => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    const out = [];
    Object.keys(byDay).forEach((day) => {
      const items = byDay[day];
      const totalSetoran = items.reduce((s, r) => s + FS.setoranOf(r), 0);
      const galon = items.reduce((s, r) => s + (+r.galon || 0), 0);
      if (totalSetoran !== 0) out.push({ id: 'stinc-' + day, type: 'income', category: salesCat, amount: totalSetoran,
        acct: cashAcct, note: tr('st.noteEntry', { d: day, n: galon, c: items.length }), method: 'Cash', date: day, time: '18:00', setoranDay: day, proof: (items.find((r) => r.proof) || {}).proof });
      const mfg = galon * costPer;
      if (mfg > 0) out.push({ id: 'stmfg-' + day, type: 'expense', category: supCat, amount: mfg,
        acct: bankAcct, note: tr('st.mfgNote', { d: day, n: galon, c: FIN.fmt(costPer) }), method: 'Transfer', date: day, time: '18:05', setoranMfg: day });
    });
    return out;
  }, [setoran, settings.costPerGalon, settings.setoranAcct, cats, accounts, lang]);

  // The cash book the whole app reads: derived setoran rows + persisted real
  // entries. Every existing consumer (stats, reports, ledger, alerts) keeps using
  // `entries` unchanged; only the WRITE paths were rerouted to REST.
  const entries = uMh(() => [...setoranEntries, ...realEntries], [setoranEntries, realEntries]);

  // ── Roster: REST per-record (create/update/offboard one employee at a time) ──
  // Reads are allowed for any role that consumes the roster (payroll/reports/kasbon/
  // approvals/company/attendance), matching the server. WRITES require the
  // `employees` capability server-side; a rejected write shows a message and reverts.
  const canViewRoster = !!(p.employees || p.payroll || p.reports || p.company || p.kasbon || p.approvals || p.attendance);
  const staffRef = uRf(hrdStaff);
  uEh(() => { staffRef.current = hrdStaff; }, [hrdStaff]);
  const cacheStaff = (arr) => { try { localStorage.setItem('airro_staff_cache_v1', JSON.stringify(arr)); } catch (e) {} };
  const reloadStaff = () => {
    if (!canViewRoster || !(window.API && window.API.employees)) return Promise.resolve();
    return window.API.employees.list('includeInactive=true').then((r) => {
      if (r && Array.isArray(r.data)) { staffRef.current = r.data; setHrdStaff(r.data); cacheStaff(r.data); }
    }).catch(() => {});
  };
  const staffWriteErr = (err) => { setToast(tr(err && err.status === 403 ? 'toast.noStaffPerm' : 'st.syncErr')); reloadStaff(); };
  const cleanStaff = (s) => { const c = { ...s }; delete c._isNew; return c; };
  const restCreateStaff = (s) => { if (window.API && window.API.employees) window.API.employees.create(cleanStaff(s)).then(reloadStaff).catch(staffWriteErr); };
  const restUpdateStaff = (s) => { if (window.API && window.API.employees) window.API.employees.update(s.id, cleanStaff(s)).then(reloadStaff).catch(staffWriteErr); };
  const restDeleteStaff = (id) => { if (window.API && window.API.employees) window.API.employees.remove(id).then(reloadStaff).catch(staffWriteErr); };
  const staffSame = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  // Diff-based per-record persistence: whatever array transform an HR screen makes
  // (upsert one, delete one, bulk dept-rename many) is translated to the matching
  // REST calls. Optimistic — state updates immediately; reloadStaff re-syncs to the
  // server's truth (also reverts an unauthorized optimistic change).
  const applyStaff = (updater) => {
    const prev = staffRef.current || [];
    const next = typeof updater === 'function' ? updater(prev) : updater;
    staffRef.current = next; setHrdStaff(next); cacheStaff(next);
    // Only holders of the `employees` write cap persist. Others (e.g. an automatic
    // late-deduction sync fired while a payroll-only user views a detail) update
    // locally and harmlessly revert on the next reloadStaff — no 403 spam. Explicit
    // edit controls are already UI-gated on p.employees.
    if (!p.employees) return;
    const prevById = new Map(prev.map((s) => [s.id, s]));
    const nextIds = new Set(next.map((s) => s.id));
    next.forEach((s) => { const b = prevById.get(s.id); if (!b) restCreateStaff(s); else if (!staffSame(b, s)) restUpdateStaff(s); });
    prev.forEach((s) => { if (!nextIds.has(s.id)) restDeleteStaff(s.id); });
  };
  // Initial load + light backstop poll for anyone who can view the roster.
  uEh(() => {
    if (!canViewRoster || !(window.API && window.API.employees)) return;
    reloadStaff();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadStaff(); }, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadStaff(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [canViewRoster]);

  // ── Kasbon: REST per-record (submit via /request persists as pending; approve/
  // reject via /:id/approve|reject) — gated on the `kasbon` capability. ──
  const reloadCashbons = () => {
    if (!p.kasbon || !(window.API && window.API.cashbon)) return Promise.resolve();
    return window.API.cashbon.list().then((r) => {
      if (r && Array.isArray(r.data)) { setCashbons(r.data); try { localStorage.setItem('airro_cashbon_cache_v1', JSON.stringify(r.data)); } catch (e) {} }
    }).catch(() => {});
  };
  // A kasbon returned by API.cashbon.request is ALREADY persisted → just merge + reload.
  const onAddCashbon = (cb) => { setCashbons((prev) => [cb, ...(prev || []).filter((x) => x.id !== cb.id)]); reloadCashbons(); };
  const onDecideCashbon = (id, status, reason) => {
    setCashbons((prev) => prev.map((c) => (c.id === id ? { ...c, status, ...(status === 'rejected' ? { rejectReason: reason || '' } : {}) } : c)));   // optimistic
    const call = status === 'approved' ? window.API.cashbon.approve(id) : window.API.cashbon.reject(id, { reason: reason || '' });
    call.then(reloadCashbons).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadCashbons(); });
  };
  const onUpdateCashbon = (id, patch) => {
    setCashbons((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));   // optimistic
    if (window.API && window.API.cashbon) window.API.cashbon.update(id, patch).then(reloadCashbons).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadCashbons(); });
  };
  uEh(() => {
    if (!p.kasbon || !(window.API && window.API.cashbon)) return;
    reloadCashbons();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadCashbons(); }, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadCashbons(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [p.kasbon]);

  // ── Approvals: REST per-record — gated on the `approvals` capability. ──
  const apprRef = uRf(approvals);
  uEh(() => { apprRef.current = approvals; }, [approvals]);
  const cacheApprovals = (arr) => { try { localStorage.setItem('airro_approvals_cache_v1', JSON.stringify(arr)); } catch (e) {} };
  const reloadApprovals = () => {
    if (!p.approvals || !(window.API && window.API.approvals)) return Promise.resolve();
    return window.API.approvals.list().then((r) => {
      if (r && Array.isArray(r.data)) { apprRef.current = r.data; setApprovals(r.data); cacheApprovals(r.data); }
    }).catch(() => {});
  };
  const apprErr = (e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadApprovals(); };
  const apprSame = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  // Diff each array transform (submit one / decide one / remove one) into per-record
  // POST/PATCH/DELETE. Optimistic; reloadApprovals re-syncs (and reverts on 403).
  const applyApprovals = (updater) => {
    const prev = apprRef.current || [];
    const next = typeof updater === 'function' ? updater(prev) : updater;
    apprRef.current = next; setApprovals(next); cacheApprovals(next);
    if (!p.approvals || !(window.API && window.API.approvals)) return;
    const prevById = new Map(prev.map((a) => [a.id, a]));
    const nextIds = new Set(next.map((a) => a.id));
    next.forEach((a) => { const b = prevById.get(a.id); if (!b) window.API.approvals.create(a).then(reloadApprovals).catch(apprErr); else if (!apprSame(b, a)) window.API.approvals.update(a.id, a).then(reloadApprovals).catch(apprErr); });
    prev.forEach((a) => { if (!nextIds.has(a.id)) window.API.approvals.remove(a.id).then(reloadApprovals).catch(apprErr); });
  };
  uEh(() => {
    if (!p.approvals || !(window.API && window.API.approvals)) return;
    reloadApprovals();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadApprovals(); }, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadApprovals(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [p.approvals]);

  // ── HR calendar: REST per-record. Read/write allowed for any HR/approval cap. ──
  const canViewCal = !!(p.employees || p.payroll || p.attendance || p.approvals || p.company);
  const calRef = uRf(calEvents);
  uEh(() => { calRef.current = calEvents; }, [calEvents]);
  const isVirtualEv = (id) => /^h-/.test(String(id || ''));   // computed holiday rows — never persisted
  const cacheCal = (arr) => { try { localStorage.setItem('airro_calendar_cache_v1', JSON.stringify(arr)); } catch (e) {} };
  const reloadEvents = () => {
    if (!canViewCal || !(window.API && window.API.calendar)) return Promise.resolve();
    return window.API.calendar.list().then((r) => {
      if (r && Array.isArray(r.data)) { calRef.current = r.data; setCalEvents(r.data); cacheCal(r.data); }
    }).catch(() => {});
  };
  const calErr = (e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadEvents(); };
  const calSame = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
  const calToApi = (e) => ({ id: e.id, type: e.type, title: e.title, employeeId: e.employeeId || null, startDate: e.startDate, endDate: e.endDate || '', note: e.note || '', sourceId: e.sourceId || null });
  const applyEvents = (updater) => {
    const prev = calRef.current || [];
    const next = typeof updater === 'function' ? updater(prev) : updater;
    calRef.current = next; setCalEvents(next); cacheCal(next);
    if (!(window.API && window.API.calendar)) return;
    const prevById = new Map(prev.map((e) => [e.id, e]));
    const nextIds = new Set(next.map((e) => e.id));
    next.forEach((e) => { if (isVirtualEv(e.id)) return; const b = prevById.get(e.id); if (!b) window.API.calendar.create(calToApi(e)).then(reloadEvents).catch(calErr); else if (!calSame(b, e)) window.API.calendar.update(e.id, calToApi(e)).then(reloadEvents).catch(calErr); });
    prev.forEach((e) => { if (!isVirtualEv(e.id) && !nextIds.has(e.id)) window.API.calendar.remove(e.id).then(reloadEvents).catch(calErr); });
  };
  uEh(() => {
    if (!canViewCal || !(window.API && window.API.calendar)) return;
    reloadEvents();
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && window.CLOUD && window.CLOUD.active) reloadEvents(); }, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') reloadEvents(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [canViewCal]);

  // ── Config (accounts + categories): off the /state block-mirror. Accounts use the
  // /accounts replace-collection sync (client ids preserved); categories persist as
  // a /settings key. Low-conflict, so whole-object writes are fine; the win is
  // escaping the 3s poll-revert. Writes require the `settings` cap. ──
  const cacheAccounts = (arr) => { try { localStorage.setItem('airro_accounts_cache_v1', JSON.stringify(arr)); } catch (e) {} };
  const cacheCats = (o) => { try { localStorage.setItem('airro_cats_cache_v1', JSON.stringify(o)); } catch (e) {} };
  const reloadAccounts = () => {
    if (!p.seeMoney || !(window.API && window.API.accounts)) return Promise.resolve();
    return window.API.accounts.list().then((r) => {
      if (r && Array.isArray(r.data) && r.data.length) { setAccounts(r.data); cacheAccounts(r.data); }
    }).catch(() => {});
  };
  const reloadCats = () => {
    if (!(window.API && window.API.settings)) return Promise.resolve();
    return window.API.settings.get('airro_cats').then((r) => {
      const v = r && r.data && r.data.value;
      if (v && Array.isArray(v.income) && Array.isArray(v.expense)) { setCats(v); cacheCats(v); }
    }).catch(() => {});
  };
  const applyAccounts = (updater) => {
    setAccounts((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      cacheAccounts(next);
      if (p.settings && window.API && window.API.accounts) window.API.accounts.sync(next).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadAccounts(); });
      return next;
    });
  };
  const applyCats = (updater) => {
    setCats((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      cacheCats(next);
      if (p.settings && window.API && window.API.settings) window.API.settings.set('airro_cats', next).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadCats(); });
      return next;
    });
  };
  // ── Config singletons via the REST /settings key-value store (off /state). Each
  // is one JSON key; low-conflict, whole-object write. Writes gate per-key on the
  // server (finance settings → 'settings'; HR keys → payroll/attendance/employees).
  const settingSlice = (key, cacheKey, setState, canWrite) => {
    const cache = (v) => { try { localStorage.setItem(cacheKey, JSON.stringify(v)); } catch (e) {} };
    const reload = () => (window.API && window.API.settings) ? window.API.settings.get(key).then((r) => { const v = r && r.data ? r.data.value : undefined; if (v !== undefined && v !== null) { setState(v); cache(v); } }).catch(() => {}) : Promise.resolve();
    const apply = (updater) => setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      cache(next);
      if (canWrite && window.API && window.API.settings) window.API.settings.set(key, next).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reload(); });
      return next;
    });
    return { reload, apply };
  };
  const settingsSlice = settingSlice('airro_settings', 'airro_settings_cache_v1', setSettings, !!p.settings);
  const ratesSlice = settingSlice('airro_hrd_rates', 'airro_hrd_rates_cache_v1', setHrdRates, !!(p.payroll || p.attendance || p.settings));
  const budgetSlice = settingSlice('airro_hr_budget', 'airro_hr_budget_cache_v1', setHrBudget, !!(p.payroll || p.settings));
  const deptSlice = settingSlice('airro_departments', 'airro_departments_cache_v1', setDepartments, !!(p.payroll || p.employees || p.settings));
  const projSlice = settingSlice('airro_projects', 'airro_projects_cache_v1', setProjects, !!(p.company || p.payroll || p.settings));
  const applySettings = settingsSlice.apply, applyRates = ratesSlice.apply, applyBudget = budgetSlice.apply, applyDepartments = deptSlice.apply, applyProjects = projSlice.apply;
  // Fleet is a plain string array → a /settings key (write cap: settings|setoran).
  const fleetSlice = settingSlice('airro_fleet', 'airro_fleet_cache_v1', setFleet, !!(p.setoran || p.settings));
  const applyFleet = fleetSlice.apply;
  // Transfers → /transfers replace-collection sync. Frontend uses from/to; the table
  // uses fromId/toId (FK to Account). Read cap 'cashflow', write cap 'addEntry'.
  const transferToApi = (t) => ({ id: t.id, fromId: t.from, toId: t.to, amount: Math.max(0, Math.round(+t.amount || 0)), date: t.date, note: t.note || '' });
  const apiToTransfer = (r) => ({ id: r.id, from: r.fromId, to: r.toId, amount: r.amount, date: r.date, note: r.note || '' });
  const reloadTransfers = () => {
    if (!p.cashflow || !(window.API && window.API.transfers)) return Promise.resolve();
    return window.API.transfers.list('limit=5000').then((r) => {
      if (r && Array.isArray(r.data)) { const rows = r.data.map(apiToTransfer); setTransfers(rows); try { localStorage.setItem('airro_transfers_cache_v1', JSON.stringify(rows)); } catch (e) {} }
    }).catch(() => {});
  };
  const applyTransfers = (updater) => {
    setTransfers((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('airro_transfers_cache_v1', JSON.stringify(next)); } catch (e) {}
      if (p.addEntry && window.API && window.API.transfers) window.API.transfers.sync(next.map(transferToApi)).catch((e) => { setToast(tr(e && e.status === 403 ? 'toast.noPerm' : 'st.syncErr')); reloadTransfers(); });
      return next;
    });
  };
  // ── Attendance + orientation attendance: the whole nested map mirrors to a REST
  // /settings key (off /state, so no poll-revert). CO writes fire a hook → debounced
  // push; a remote pull hydrates the local map + bumps syncTick so on-demand readers
  // re-render. Demo seeding is disabled in the store (months start empty). ──
  const canViewAtt = !!(p.attendance || p.payroll || p.employees || p.empDetail);
  const canWriteAtt = !!(p.attendance || p.payroll || p.employees);
  const attTimer = uRf(null), oriTimer = uRf(null);
  const pushAtt = () => { clearTimeout(attTimer.current); attTimer.current = setTimeout(() => { if (canWriteAtt && window.API && window.API.settings) window.API.settings.set('airro_attendance', CO.rawAtt()).catch(() => {}); }, 600); };
  const pushOriAtt = () => { clearTimeout(oriTimer.current); oriTimer.current = setTimeout(() => { if (canWriteAtt && window.API && window.API.settings) window.API.settings.set('airro_oriatt', CO.rawOriAtt()).catch(() => {}); }, 600); };
  const reloadAtt = () => (canViewAtt && window.API && window.API.settings) ? window.API.settings.get('airro_attendance').then((r) => { const v = r && r.data ? r.data.value : null; if (v && typeof v === 'object') { CO.hydrateAtt(v); setSyncTick((t) => t + 1); } }).catch(() => {}) : Promise.resolve();
  const reloadOriAtt = () => (canViewAtt && window.API && window.API.settings) ? window.API.settings.get('airro_oriatt').then((r) => { const v = r && r.data ? r.data.value : null; if (v && typeof v === 'object') { CO.hydrateOriAtt(v); setSyncTick((t) => t + 1); } }).catch(() => {}) : Promise.resolve();
  const pushAttRef = uRf(pushAtt), pushOriRef = uRf(pushOriAtt);
  pushAttRef.current = pushAtt; pushOriRef.current = pushOriAtt;
  uEh(() => { CO.setAttHooks(() => pushAttRef.current && pushAttRef.current(), () => pushOriRef.current && pushOriRef.current()); return () => CO.setAttHooks && CO.setAttHooks(null, null); }, []);
  // Roles list (dynamic) — load into FS (drives FS.perms) + state (re-render).
  const reloadRoles = () => {
    if (!(window.API && window.API.roles)) return Promise.resolve();
    return window.API.roles.list().then((r) => {
      if (r && Array.isArray(r.data) && r.data.length) { FS.setRoles(r.data); setRolesState(r.data); try { localStorage.setItem('airro_roles_cache_v1', JSON.stringify(r.data)); } catch (e) {} }
    }).catch(() => {});
  };
  const reloadConfig = () => { reloadAccounts(); reloadCats(); settingsSlice.reload(); ratesSlice.reload(); budgetSlice.reload(); deptSlice.reload(); projSlice.reload(); fleetSlice.reload(); reloadTransfers(); reloadAtt(); reloadOriAtt(); reloadRoles(); };
  uEh(() => {
    if (!(window.API && window.API.accounts)) return;
    reloadConfig();
    const onVis = () => { if (document.visibilityState === 'visible') reloadConfig(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [p.seeMoney, p.payroll]);

  // Re-read every data slice from the (server-hydrated) stores into React state.
  // NOTE: this covers every slice held in shell state. On-demand stores read
  // directly inside components (attendance `airro_attendance_v2`, orientation
  // attendance `airro_oriatt_v1`) are refreshed via the `syncTick` prop instead.
  // Used after login and whenever the cloud poll pulls remote changes.
  // Apply a slice into React state ONLY when its content actually changed. A poll
  // that pulled (say) setoran must not also hand a brand-new-but-identical array to
  // setEntries/setAccounts/etc — that needless setState would re-run the setoran →
  // cash-flow derivation and re-persist those keys on a passive client, exactly the
  // churn that used to make the poll treat them as "dirty". We compare against the
  // last-applied JSON snapshot (a ref, so it's immune to closure staleness).
  const appliedRef = uRf({});
  const applySlice = (name, val, setter) => {
    const s = JSON.stringify(val);
    if (appliedRef.current[name] === s) return;
    appliedRef.current[name] = s;
    setter(val);
  };
  const refreshAllSlices = () => {
    // Everything shared is REST-loaded now (entries, setoran, staff, cashbons,
    // approvals, calendar, accounts, cats, settings, rates, budget, departments,
    // projects, fleet, transfers). Only the users list remains blob-backed.
    applySlice('users', FS.loadUsers(), setUsers);
  };

  const login = (u) => {
    FS.setSession(u.id); setUser(u); setScreen(FS.landingScreen(u.role));
    // Backend session active → the cloud adapter hydrated localStorage from the
    // server; re-pull ALL slices so the UI shows the shared data. Entries & setoran
    // live in REST tables (not the blob), so pull them explicitly too.
    if (window.CLOUD && window.CLOUD.active) { refreshAllSlices(); reloadEntries(); reloadSetoran(); reloadStaff(); reloadCashbons(); reloadApprovals(); reloadEvents(); reloadConfig(); }
  };
  const logout = () => { if (window.CLOUD) window.CLOUD.logout(); FS.setSession(null); setUser(null); setDrawer(false); };
  // Self profile edit (display name + avatar colour only — server rejects anything
  // else). Reflect the new name/colour in the signed-in user + users list so every
  // profile card updates immediately; role/permissions are left untouched.
  const updateProfile = (data) => {
    if (!(window.API && window.API.auth && window.API.auth.updateProfile)) return Promise.reject(new Error('offline'));
    return window.API.auth.updateProfile(data).then((u) => {
      setUser((prev) => ({ ...prev, name: u.name, color: u.color }));
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, name: u.name, color: u.color } : x)));
      setToast(tr('pm.saved'));
      return u;
    });
  };

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
    window.CLOUD.onSync = () => { refreshAllSlices(); setSyncTick((t) => t + 1); };
    window.CLOUD.onStatus = (s) => setSyncStatus(s);
    // Token expired mid-session → prompt a re-login (unsynced local edits are kept
    // and flushed after signing back in).
    window.CLOUD.onSessionExpired = () => setSessionExpired(true);
    // SSE notice for a non-/state REST entity (setoran) or a tab-focus resync →
    // re-fetch that entity immediately. Near-0 latency; the 3s poll is now a backstop.
    window.CLOUD.onEvent = (evt) => {
      if (!evt) return;
      if (evt.entity === 'setoran' || evt.entity === 'focus') reloadSetoran();
      if (evt.entity === 'entry' || evt.entity === 'focus') reloadEntries();
      if (evt.entity === 'employee' || evt.entity === 'focus') reloadStaff();
      if (evt.entity === 'cashbon' || evt.entity === 'focus') reloadCashbons();
      if (evt.entity === 'approval' || evt.entity === 'focus') reloadApprovals();
      if (evt.entity === 'calendar' || evt.entity === 'focus') reloadEvents();
      if (evt.entity === 'config' || evt.entity === 'focus') reloadConfig();
      if (evt.entity === 'role') reloadRoles();
      if (evt.entity === 'distribusi' || evt.entity === 'focus') setDistTick((t) => t + 1);   // Distribusi dashboard self-refetches
    };
    return () => { if (window.CLOUD) { window.CLOUD.onSync = null; window.CLOUD.onStatus = null; window.CLOUD.onEvent = null; window.CLOUD.onSessionExpired = null; } };
  }, []);

  // Lock the page scroll behind the mobile drawer while it's open.
  uEh(() => {
    document.body.classList.toggle('drawer-lock', drawer);
    return () => document.body.classList.remove('drawer-lock');
  }, [drawer]);

  const add = (e) => { addEntry(e); setToast(tr(e.type === 'income' ? 'toast.incomeSaved' : 'toast.expenseSaved', { amt: FIN.fmt(e.amount) })); };
  // Upsert one staff into the roster (used by orientation actions + detail edits).
  const upsertStaff = (s) => applyStaff((prev) => { const clean = { ...s }; delete clean._isNew; return prev.find((x) => x.id === s.id) ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; });
  // ---- Orientation actions (new-hire lifecycle) ----
  // Graduating passes the employee out of the orientation/DW bucket into a payroll
  // stage (permanent/contract/probation) → they move to Data Karyawan automatically.
  const graduateOrientation = (s, targetStage) => { const stage = ['permanent', 'contract', 'probation'].indexOf(targetStage) >= 0 ? targetStage : 'permanent'; upsertStaff({ ...s, stage, orientation: { ...(s.orientation || {}), outcome: 'passed', endDate: HRD.orientationEnd(s) } }); setToast(tr('ori.toastPassed', { n: s.name, st: tr('stage.' + stage) })); };
  const failOrientation = (s) => { upsertStaff({ ...s, orientation: { ...(s.orientation || {}), outcome: 'failed' }, sepStatus: 'orientation_failed', active: false, separationDate: FIN.TODAY, separationReason: tr('ori.failReason') }); setToast(tr('ori.toastFailed', { n: s.name })); };
  // Orientation lump sum already posted to the cash book (by staff id) — no double post.
  const orientationPaidIds = uMh(() => (entries || []).filter((e) => e.orientation).map((e) => e.orientation), [entries]);
  const payOrientation = (s, alsoRecordExpense) => {
    const total = HRD.orientationTotal(s, CO.oriAtt(s.id), hrdRates);
    upsertStaff({ ...s, orientation: { ...(s.orientation || {}), paid: true, paidAt: FIN.TODAY } });
    if (alsoRecordExpense && total > 0 && !orientationPaidIds.includes(s.id)) {
      const bank = accounts.find((a) => a.type === 'bank') || accounts[0] || {};
      const entry = { id: 'e' + Date.now().toString(36), type: 'expense', category: 'Orientation', amount: total, acct: bank.id,
        note: tr('ori.expenseNote', { n: s.name }), method: 'Transfer BCA', date: FIN.TODAY, time: '09:00', orientation: s.id };
      addEntry(entry);
    }
    setToast(tr('ori.toastPaid', { amt: FIN.fmt(total) }));
  };
  const del = (id) => { if (!p.delete) { setToast(tr('toast.onlyOwnerDelete')); return; } const e = entries.find((x) => x.id === id); if (e && !confirm(tr('toast.deleteConfirm', { n: e.note || '', amt: FIN.fmt(e.amount || 0) }))) return; removeEntry(id); setToast(tr('toast.deleted')); };
  const saveEdit = (upd) => { editEntry(upd); setEditing(null); setToast(tr('toast.updated')); };
  // Demo reset now clears the REST cash book (real entries only; derived setoran
  // rows regenerate). Deletes each persisted entry, then repaints empty.
  const resetData = () => { if (!p.reset) return; if (!confirm('Hapus SEMUA catatan kas (kembali kosong)?')) return; realEntries.forEach((e) => { if (window.API && window.API.entries) window.API.entries.remove(e.id).catch(() => {}); }); setRealEntries([]); try { localStorage.setItem('airro_cashbook_cache_v1', '[]'); } catch (e) {} setTimeout(reloadEntries, 400); setToast(tr('toast.demoRestored')); };

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
    // Cash Balance = REAL cash on hand across all accounts = opening balances + every
    // inflow − every outflow (all-time). This matches the per-account totals in Kas &
    // Bank (FS.acctBalance also starts from each account's opening). It is deliberately
    // NOT the same as Net Profit, which is period income − expense (no opening).
    return { balance: openingTotal + balIn - balOut, opening: openingTotal, totalIn: balIn, totalOut: balOut, income: pIn, expense: pOut, profit, margin: pIn ? Math.round((profit / pIn) * 1000) / 10 : 0, monLabel: periodLbl };
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
    // Mirror the approved leave onto the shared HR calendar (dedupe by sourceId) —
    // now a per-record POST /calendar instead of a blob append.
    const already = (calRef.current || []).some((e) => e.sourceId && e.sourceId === req.id);
    if (!already) applyEvents((prev) => [...prev, { id: CO.newEventId(), type: 'leave', title: req.title || 'Cuti', employeeId: sid || null, startDate: req.from, endDate: req.to || req.from, note: req.detail || '', sourceId: req.id }]);
  };

  // approved deduction request → add to that employee's payroll deductions. Tag it
  // with reqId so cancelling/deleting the request can find & remove exactly this one.
  const approveDeduction = (req) => {
    if (!req || !req.staffId || !req.amount) return;
    applyStaff((prev) => prev.map((s) => s.id === req.staffId
      ? { ...s, deductions: [...(s.deductions || []), { id: CO.newReqId(), label: req.title || 'Potongan', amount: +req.amount, reqId: req.id }] }
      : s));
  };

  const submitRequest = (req) => { applyApprovals((prev) => [req, ...prev]); setToast(tr('req.submitted')); };

  // Undo the side-effects of an APPROVED request so nothing is left dangling when it
  // is cancelled/deleted: the leave mirror on the calendar + the attendance leave
  // marking, and the salary deduction it created.
  const reverseApproval = (a) => {
    if (!a) return;
    if (a.type === 'leave' && a.from && a.to) {
      const sid = a.staffId || (hrdStaff.find((s) => s.name === a.who) || {}).id;
      if (sid) CO.clearLeave(sid, a.from.slice(0, 7), a.from, a.to);
      applyEvents((prev) => (prev || []).filter((e) => e.sourceId !== a.id));
    }
    if (a.type === 'deduction' && a.staffId) {
      applyStaff((prev) => prev.map((s) => s.id === a.staffId ? { ...s, deductions: (s.deductions || []).filter((d) => d.reqId !== a.id) } : s));
    }
  };
  // Requester cancels their own still-pending request → status 'cancelled' (+ trail).
  const cancelRequest = (a) => {
    if (!a) return;
    applyApprovals((prev) => prev.map((x) => x.id === a.id ? { ...x, status: 'cancelled', cancelledBy: user.name, cancelledAt: Date.now() } : x));
    setToast(tr('req.cancelledToast'));
  };
  // Delete a request from the list. If it was approved, undo its effects first.
  const deleteRequest = (a) => {
    if (!a) return;
    if (a.status === 'approved') reverseApproval(a);
    applyApprovals((prev) => (prev || []).filter((x) => x.id !== a.id));
    setToast(tr('req.deletedToast'));
  };

  // keep auto late-penalty deduction + overtime pay in sync on each staff record
  const syncLateDeduct = (staffId, amount, label, otAmount) => {
    applyStaff((prev) => prev.map((s) => {
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
    realEntries.filter((e) => e.payroll === curMonthKey).forEach((e) => removeEntry(e.id));   // drop the previous month's posting
    addEntry(entry);
    // Kasbon of the payroll cycle just paid → mark settled ('paid') so they stop
    // counting. Per-record PATCH (approved/active → paid); optimistic + reload.
    const anchor = HRD.payCycle().anchor;
    (cashbons || []).forEach((c) => { if ((c.status === 'active' || c.status === 'approved') && (c.cycleAnchor || HRD.payCycle(c.date).anchor) === anchor) onUpdateCashbon(c.id, { status: 'paid' }); });
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
    realEntries.filter((e) => e.thr).forEach((e) => removeEntry(e.id));   // replace the previous THR posting
    addEntry(entry);
    setToast(tr('thr.toast', { amt: FIN.fmt(amount) }));
  };

  // Which setoran days are reflected in the cash book (derived, always true when the
  // day has a deposit) — used by the setoran screen's "posted" pill.
  const setoranPosted = uMh(() => { const m = {}; entries.forEach((e) => { if (e.setoranDay) m[e.setoranDay] = true; }); return m; }, [entries]);
  // customer payment transfers (bon/credit settled by transfer) → income entries tagged custPay
  const custPayments = uMh(() => entries.filter((e) => e.custPay).sort(FS.byNewest), [entries]);
  const addPayment = (pay) => {
    const salesCat = (cats.income.find((c) => /refill|galon|jual|sales|bon|piutang/i.test(c.label)) || cats.income[0] || {}).key || 'Refill';
    addEntry({ id: 'cp' + Date.now().toString(36), type: 'income', category: salesCat, amount: +pay.amount || 0,
      acct: pay.acct, note: tr('cp.note', { who: pay.party || '—', m: pay.method }), method: pay.method || 'Transfer', date: pay.date, time: '12:00', custPay: true, party: pay.party, proof: pay.proof });
    setToast(tr('cp.toast', { amt: FIN.fmt(+pay.amount || 0) }));
  };
  const delPayment = (id) => removeEntry(id);
  // (setoran→cash-flow derivation is the `setoranEntries` memo above — computed
  // in-memory from the setoran REST table and never persisted.)

  const alerts = uMh(() => p.seeMoney
    ? ALERTS.computeAlerts({ entries, balance: stats.balance, monthIncome: monthStats.income, monthExpense: monthStats.expense, month: monthKey, thresholds: settings, fmt: FIN.fmt, lang })
    : [], [entries, stats.balance, monthStats, monthKey, settings, p.seeMoney, lang]);

  // "Aktivitas Saya": the current user's own recent creations, gathered from the
  // records already loaded in shell state and filtered by createdById (stable
  // identity — survives a rename and never collides with a same-named colleague).
  // Only entities the user's role can see contribute, which is exactly right.
  const myActivity = uMh(() => {
    if (!user) return [];
    const uid = user.id, items = [];
    (realEntries || []).forEach((e) => { if (e.createdById === uid) items.push({ kind: 'entry', id: e.id, title: e.note || (catMap[e.category] && catMap[e.category].label) || tr('nav.entries'), amount: e.type === 'income' ? e.amount : -e.amount, when: e.createdAt || 0, date: e.date }); });
    (cashbons || []).forEach((c) => { if (c.createdById === uid) { const emp = (hrdStaff || []).find((s) => s.id === c.employeeId); items.push({ kind: 'kasbon', id: c.id, title: emp ? emp.name : tr('nav.kasbon'), amount: -(c.amount || 0), when: c.createdAt || 0, date: c.date }); } });
    (approvals || []).forEach((a) => { if (a.createdById === uid) items.push({ kind: 'approval', id: a.id, title: a.title || tr('nav.approvals'), amount: a.amount ? -a.amount : 0, when: a.createdAt || 0, date: a.date }); });
    (hrdStaff || []).forEach((s) => { if (s.createdById === uid) items.push({ kind: 'employee', id: s.id, title: s.name, when: s.createdAt || 0, date: s.joinedDate || s.contractStart }); });
    return items.sort((a, b) => (b.when || 0) - (a.when || 0) || String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 25);
  }, [user, realEntries, cashbons, approvals, hrdStaff, catMap]);

  // ---- not logged in ----
  if (!user) return <AUTH.LoginScreen onLogin={login} lang={lang} onLang={changeLang} users={users} />;

  const NAV = navForRole(p, user ? user.role : '');
  const go = (id, locked) => { if (locked) { setToast(tr('dist.lockedToast')); return; } if (NAV.find((n) => n.id === id)) setScreen(id); setDrawer(false); };
  // Admin/settings shortcuts inside the profile menu — already perm-filtered by NAV,
  // so a non-admin simply sees none.
  const pmShortcuts = NAV.filter((n) => n.id === 'users' || n.id === 'settings' || n.id === 'hrsettings');
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
              <button key={n.id} className={`nav-item ${screen === n.id ? 'on' : ''} ${n.locked ? 'locked' : ''}`} onClick={() => go(n.id, n.blocked)} title={n.locked ? tr('dist.locked') : ''}>
                {Ish(n.icon, { s: 20 })}<span>{n.label}</span>{n.locked && <IconLock s={13} className="nav-lock" />}
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
    kasbon: { t: tr('nav.kasbon'), s: tr('kb.intro') },
    settings: { t: tr('t.settings'), s: tr('s.settings') },
    users: { t: tr('t.users'), s: tr('s.users') },
  }[screen] || (screen && screen.indexOf('dist-') === 0
    ? { t: (NAV.find((n) => n.id === screen) || {}).label || tr('dist.module'), s: tr('dist.module') }
    : { t: '', s: '' });

  return (
    <div className="app">
      <aside className="sidebar">
        <Nav />
        <div className="user-chip">
          <span className="user-av" style={{ background: user.color, width: 38, height: 38 }}>{FS.initials(user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="up-name" title={user.name} style={{ fontSize: 13.5 }}>{user.name}</div>
            <AUTH.RoleBadge role={user.role} size="sm" />
          </div>
          <button className="icon-btn" title={tr('pw.change')} onClick={() => setPwModal(true)}><IconLock s={17} /></button>
          <button className="icon-btn logout-btn" title="Sign out" onClick={logout}><IconLogout s={18} /></button>
        </div>
      </aside>

      <div className={`scrim ${drawer ? 'open' : ''}`} onClick={() => setDrawer(false)} />
      <div className={`drawer ${drawer ? 'open' : ''}`}>
        <Nav />
        <div className="user-chip" style={{ marginTop: 'auto' }}>
          <span className="user-av" style={{ background: user.color, width: 38, height: 38 }}>{FS.initials(user.name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}><div className="up-name" title={user.name} style={{ fontSize: 13.5 }}>{user.name}</div><AUTH.RoleBadge role={user.role} size="sm" /></div>
          <button className="icon-btn" title={tr('pw.change')} onClick={() => setPwModal(true)}><IconLock s={17} /></button>
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
              {window.CLOUD && (window.CLOUD.active || syncStatus === 'expired') && (
                <span className={`sync-pill ${syncStatus}`} title={tr('sync.' + syncStatus)}>
                  <span className="sync-dot" /><span className="sync-txt">{tr('sync.' + syncStatus)}</span>
                </span>
              )}
              <AUTH.LangToggle lang={lang} onLang={changeLang} />
              {p.seeMoney && <ALERTS.AlertBell alerts={alerts} />}
              <AUTH.ProfileMenu user={user} lang={lang} onLang={changeLang} alerts={p.seeMoney ? alerts : []} activity={myActivity}
                onChangePassword={() => setPwModal(true)} onLogout={logout} onNavigate={go} shortcuts={pmShortcuts} onUpdateProfile={updateProfile} />
            </div>
          </header>

          {screen === 'dist-dashboard' && (
            <DIST.Dashboard refreshKey={distTick} today={FIN.TODAY}
              staffMode={!!(p.distribusi && !p.distribusiHargaMaster && !p.distribusiAudit && !p.distribusiCustomers)}
              onQuickInput={() => { go('dist-transactions', !p.distribusi); if (p.distribusi) setDistFormTick((t) => t + 1); }} onOpenCustomers={() => go('dist-customers', !p.distribusi)} />
          )}
          {screen === 'dist-transactions' && (
            <DIST.Transactions refreshKey={distTick} openFormTick={distFormTick} today={FIN.TODAY}
              staffMode={!!(p.distribusi && !p.distribusiHargaMaster && !p.distribusiAudit && !p.distribusiCustomers)}
              onChanged={() => setDistTick((t) => t + 1)} />
          )}
          {screen === 'dist-customers' && (
            <DIST.Customers refreshKey={distTick} canCustomers={!!p.distribusiCustomers} canPrice={!!p.distribusiHargaMaster}
              staffMode={!!(p.distribusi && !p.distribusiHargaMaster && !p.distribusiAudit && !p.distribusiCustomers)}
              onGoHarga={() => go('dist-prices', !p.distribusi)} onChanged={() => setDistTick((t) => t + 1)} />
          )}
          {screen === 'dist-prices' && (
            <DIST.Prices refreshKey={distTick} canPrice={!!p.distribusiHargaMaster} onChanged={() => setDistTick((t) => t + 1)} />
          )}
          {screen && screen.indexOf('dist-') === 0 && !['dist-dashboard', 'dist-transactions', 'dist-customers', 'dist-prices'].includes(screen) && <DistPlaceholder screen={screen} nav={NAV} />}

          {screen === 'setoran' && p.setoran && (
            <SETORAN.SetoranScreen setoran={setoran} onAdd={addSetoran} onEdit={editSetoran} onRemove={removeSetoran} fleet={fleet} setFleet={p.setoran ? applyFleet : null} accounts={accounts} canEdit={true} postedDays={setoranPosted} autoSynced={true} costPerGalon={settings.costPerGalon} onCostChange={(v) => applySettings((prev) => ({ ...prev, costPerGalon: v }))} depositAcct={settings.setoranAcct} onDepositAcctChange={(v) => applySettings((prev) => ({ ...prev, setoranAcct: v }))} payments={custPayments} onAddPayment={addPayment} onDelPayment={delPayment} />
          )}

          {screen === 'moneyspots' && p.cashflow && (
            <FIN.MoneySpots accounts={accounts} setAccounts={applyAccounts} entries={entries} transfers={transfers} setTransfers={applyTransfers} canEdit={p.addEntry} />
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
            <COMPANY.ProjectsScreen projects={projects} setProjects={applyProjects} canEdit={true} />
          )}

          {screen === 'company' && p.company && (            <COMPANY.CompanyDashboard fin={stats} staff={hrdStaff} rates={hrdRates} budget={hrBudget} approvals={approvals} setApprovals={applyApprovals} role={user.role} projects={projects} setoran={setoran} onApproveLeave={applyLeaveToAtt} onApproveDeduction={approveDeduction} onSubmitRequest={submitRequest} onCancelRequest={cancelRequest} onDeleteRequest={deleteRequest} userName={user.name} />
          )}

          {screen === 'headcount' && p.payroll && p.attendance && (
            <COMPANY.HeadcountAffordability staff={hrdStaff} rates={hrdRates} budget={hrBudget} setBudget={applyBudget} canEdit={p.payroll} />
          )}

          {screen === 'hrreport' && p.employees && (
            <COMPANY.HRReport staff={hrdStaff} rates={hrdRates} departments={departments} budget={hrBudget} monthKey={monthKey} today={FIN.TODAY} approvals={approvals} gran={gran} anchor={anchor} setAnchor={setAnchor} range={range} periodLbl={periodLbl} setGran={setGran} />
          )}

          {screen === 'hrsettings' && p.payroll && p.attendance && (            <PAYROLL.HrSettings rates={hrdRates} setRates={applyRates} departments={departments} setDepartments={applyDepartments} staff={hrdStaff} setStaff={applyStaff} canEditDept={p.payroll} />
          )}

          {screen === 'employees' && p.employees && (
            <COMPANY.EmployeeDirectory staff={hrdStaff} rates={hrdRates} departments={departments} monthKey={monthKey} today={FIN.TODAY} onOpen={setEmpDetail} onEdit={() => setScreen('payroll')} canEdit={p.employees} seeMoney={p.seeMoney} setStaff={applyStaff} />
          )}

          {screen === 'hrcalendar' && p.employees && (
            <COMPANY.HrCalendar staff={hrdStaff} rates={hrdRates} events={calEvents} setEvents={applyEvents} today={FIN.TODAY} canEdit={p.attendance || p.payroll} />
          )}

          {screen === 'orientation' && p.payroll && (
            <COMPANY.OrientationScreen staff={hrdStaff} setStaff={applyStaff} rates={hrdRates} today={FIN.TODAY} syncTick={syncTick} canEdit={p.employees} canAddEntry={p.addEntry} onGraduate={graduateOrientation} onFail={failOrientation} onPay={payOrientation} orientationPaidIds={orientationPaidIds} onOpen={setEmpDetail} />
          )}

          {screen === 'kasbon' && p.kasbon && (
            <COMPANY.KasbonScreen staff={hrdStaff} cashbons={cashbons} onAddCashbon={onAddCashbon} onDecideCashbon={onDecideCashbon} canApprove={p.kasbonApprove} today={FIN.TODAY} userName={user.name} />
          )}

          {screen === 'approvals' && p.approvals && (
            <div className="screen-enter"><COMPANY.ApprovalsCard approvals={approvals} setApprovals={applyApprovals} role={user.role} canSubmit={p.approvals} staff={hrdStaff} onApproveLeave={applyLeaveToAtt} onApproveDeduction={approveDeduction} onSubmitRequest={submitRequest} onCancelRequest={cancelRequest} onDeleteRequest={deleteRequest} userName={user.name} /></div>
          )}

          {screen === 'reports' && p.reports && (
            <REPORTS.ReportsScreen entries={entries} catMap={catMap} userName={user.name} rates={hrdRates} staff={hrdStaff} payrollPosted={payrollPosted} payrollTotal={hrdTotals.companyCost} payrollLabel={curPayLabel} onPostPayroll={() => postPayroll(hrdTotals.companyCost, curPayLabel)} />
          )}

          {screen === 'thr' && p.payroll && (
            <COMPANY.ThrScreen staff={hrdStaff} rates={hrdRates} setRates={applyRates} today={FIN.TODAY} posted={thrPosted} onPost={postThr} canPost={p.addEntry || p.payroll} canEdit={p.payroll} />
          )}

          {screen === 'payroll' && p.payroll && (
            <PAYROLL.PayrollScreen rates={hrdRates} setRates={applyRates} staff={hrdStaff} setStaff={applyStaff} monLabel={curPayLabel} onPost={postPayroll} canEdit={p.employees} cashbons={cashbons} monthKey={monthKey} />
          )}

          {screen === 'settings' && p.settings && (
            <SETTINGS.SettingsScreen cats={cats} onChange={applyCats} canReset={p.reset} onResetData={resetData} settings={settings} onSettingsChange={applySettings} entries={entries} accounts={accounts} catLabel={(k) => FS.catInfo(catMap, k).label} />
          )}

          {screen === 'users' && (p.reset || user.role === 'owner' || user.role === 'gm') && (
            <USERMGMT.UserManagement users={users} setUsers={setUsers} currentId={user.id} roles={roles} onRolesChanged={reloadRoles} canManageRoles={user.role === 'owner' || user.role === 'gm' || p.reset} />
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
        {/* "Menu" opens the drawer with EVERY permitted menu (finance + HR + admin),
            so nothing is unreachable on mobile. Highlighted when the drawer is open
            OR the current screen isn't one of the 4 quick items. Logout lives in the
            drawer's user chip. */}
        <button className={`mnav ${drawer || !NAV.slice(0, 4).some((n) => n.id === screen) ? 'on' : ''}`} onClick={() => setDrawer(true)}><IconMenu s={22} /><span>{tr('nav.more')}</span></button>
      </nav>

      {toast && <FToast msg={toast} onDone={() => setToast(null)} />}
      {pwModal && <AUTH.ChangePassword onClose={() => setPwModal(false)} onDone={() => { setPwModal(false); setToast(tr('pw.changed')); }} />}
      {sessionExpired && (
        <div className="modal-scrim" style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-body" style={{ textAlign: 'center', padding: '10px 6px' }}>
              <span className="sess-ic"><IconLock s={26} /></span>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 12 }}>{tr('sess.title')}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-mut)', marginTop: 8, lineHeight: 1.5 }}>{tr('sess.body')}</div>
            </div>
            <div className="modal-foot" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => { setSessionExpired(false); logout(); }}>{tr('sess.login')}</button>
            </div>
          </div>
        </div>
      )}
      <PROOFMOUNT />
      {editing && p.edit && (
        <EDIT.EntryModal entry={editing} incomeCats={cats.income} expenseCats={cats.expense} onSave={saveEdit} onClose={() => setEditing(null)} />
      )}
      {empDetail && p.empDetail && (
        <COMPANY.EmployeeDetail staff={empDetail} rates={hrdRates} monthKey={monthKey} today={FIN.TODAY} syncTick={syncTick} seeMoney={p.seeMoney} canEdit={p.employees} canEditAtt={p.attendance && p.payroll} onSyncDeduct={syncLateDeduct} onEdit={() => { setEmpDetail(null); setScreen('payroll'); }} onClose={() => setEmpDetail(null)} onSaveStaff={upsertStaff} cashbons={cashbons} onAddCashbon={onAddCashbon} onUpdateCashbon={onUpdateCashbon} onGraduate={graduateOrientation} onFailOrientation={failOrientation} onPayOrientation={payOrientation} orientationPaid={orientationPaidIds.includes(empDetail.id)} canAddEntry={p.addEntry} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<FApp />);
