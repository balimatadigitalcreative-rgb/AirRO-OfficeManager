/* AirRO — Company Management store: approvals (leave / reimbursement / purchase). window.CO */
(function () {
  const KEY = 'airro_approvals_v4';   // trial: empty
  const SEED = [];
  const TYPE_META = {
    leave:     { label: 'Leave',         icon: 'IconCalendar', routeTo: 'gm',      needsEmp: true,  needsDates: true,  needsAmount: false },
    deduction: { label: 'Deduction',     icon: 'IconCoinOut',  routeTo: 'finance', needsEmp: true,  needsDates: false, needsAmount: true },
    reimburse: { label: 'Reimbursement', icon: 'IconWallet',   routeTo: 'finance', needsEmp: true,  needsDates: false, needsAmount: true },
    purchase:  { label: 'Purchase',      icon: 'IconStore',    routeTo: 'gm',      needsEmp: false, needsDates: false, needsAmount: true },
    custom:    { label: 'Custom',         icon: 'IconInvoice',  routeTo: 'gm',      needsEmp: true,  needsDates: false, needsAmount: true },
  };
  const ROUTE_ROLES = ['owner', 'gm', 'hrd', 'finance'];
  const newReqId = () => 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  function load() { try { const r = localStorage.getItem(KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} save(SEED); return JSON.parse(JSON.stringify(SEED)); }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function reset() { const s = JSON.parse(JSON.stringify(SEED)); save(s); return s; }

  // ---- company projects / initiatives (under development) ----
  const PROJ_KEY = 'airro_projects_v3';   // trial: empty
  const PROJ_SEED = [];
  const PROJ_STATUS = { planning: { label: 'Planning', color: '#5E7A88' }, building: { label: 'In progress', color: '#0B7EB1' }, done: { label: 'Done', color: '#1C8F8A' }, hold: { label: 'On hold', color: '#B07A12' } };
  function loadProjects() { try { const r = localStorage.getItem(PROJ_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} const s = JSON.parse(JSON.stringify(PROJ_SEED)); saveProjects(s); return s; }
  function saveProjects(a) { try { localStorage.setItem(PROJ_KEY, JSON.stringify(a)); } catch (e) {} }
  const newProjId = () => 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);

  // ---- deterministic attendance seed (this month, working days Mon–Sat) ----
  const ATT_KEY = 'airro_attendance_v2';   // trial: empty
  const PAD = (n) => String(n).padStart(2, '0');
  function loadAttMap() { try { const r = localStorage.getItem(ATT_KEY); if (r) { const o = JSON.parse(r); if (o && typeof o === 'object') return o; } } catch (e) {} return {}; }
  function saveAttMap(m) { try { localStorage.setItem(ATT_KEY, JSON.stringify(m)); } catch (e) {} }

  function genMonth(staff, monthKey, today) {
    let s = 0; for (let i = 0; i < staff.id.length; i++) s = (s * 31 + staff.id.charCodeAt(i)) & 0x7fffffff;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const todayDay = (today && today.startsWith(monthKey)) ? +today.slice(8) : lastDay;
    const offTarget = +staff.offDays || 0;
    const recs = {}; let offGiven = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      const ds = `${y}-${PAD(m)}-${PAD(d)}`;
      if (dow === 0) { recs[ds] = { status: 'off', in: null, out: null }; continue; } // Sunday = libur
      if (d > todayDay) { recs[ds] = { status: 'none', in: null, out: null }; continue; }      // future = not filled
      let status;
      if (offGiven < offTarget && rnd() < 0.5) { status = 'absent'; offGiven++; }
      else { const r = rnd(); status = r < 0.10 ? 'late' : r < 0.13 ? 'leave' : 'present'; }
      const off = status === 'absent' || status === 'leave';
      const inH = status === 'late' ? 8 + Math.floor(rnd() * 2) : 7; const inM = status === 'late' ? 20 + Math.floor(rnd() * 35) : Math.floor(rnd() * 30);
      recs[ds] = { status, in: off ? null : `${PAD(inH)}:${PAD(inM)}`, out: off ? null : `1${6 + Math.floor(rnd() * 2)}:${PAD(Math.floor(rnd() * 60))}` };
    }
    return recs;
  }

  // every calendar day of the month (1..last)
  function allDates(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const out = [];
    for (let d = 1; d <= lastDay; d++) out.push(`${y}-${PAD(m)}-${PAD(d)}`);
    return out;
  }

  function summarize(recs) {
    let present = 0, late = 0, absent = 0, leave = 0;
    Object.values(recs).forEach((r) => { if (r.status === 'present') present++; else if (r.status === 'late') late++; else if (r.status === 'absent') absent++; else if (r.status === 'leave') leave++; });
    const workdays = present + late + absent + leave;
    const rate = workdays ? Math.round(((present + late) / workdays) * 100) : 100;
    return { present, late, absent, leave, workdays, rate };
  }

  const toMin = (t) => { if (!t) return 0; const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  // total late minutes + rupiah deduction for a staff's month, given policy {lateStart, latePerMin}
  function lateInfo(staff, monthKey, today, policy) {
    const map = loadAttMap(); const k = staff.id + '|' + monthKey;
    if (!map[k]) { map[k] = genMonth(staff, monthKey, today); saveAttMap(map); }
    const start = toMin((policy && policy.lateStart) || '08:00');
    const basis = (policy && policy.lateBasis) === 'hour' ? 'hour' : 'minute';
    const per = (policy && +policy.latePerMin) || 0;
    let minutes = 0;
    Object.values(map[k]).forEach((r) => { if (r.status === 'late' && r.in) minutes += Math.max(0, toMin(r.in) - start); });
    const amount = basis === 'hour' ? Math.round((minutes / 60) * per) : Math.round(minutes * per);
    return { minutes, amount, basis };
  }

  // overtime: sum of per-day overtime hours × hourly rate
  function overtimeInfo(staff, monthKey, today, policy) {
    const map = loadAttMap(); const k = staff.id + '|' + monthKey;
    if (!map[k]) { map[k] = genMonth(staff, monthKey, today); saveAttMap(map); }
    const rate = (policy && +policy.otPerHour) || 0;
    let hours = 0;
    Object.values(map[k]).forEach((r) => { hours += (+r.ot || 0); });
    return { hours, amount: Math.round(hours * rate) };
  }

  // materialize a staff's month into storage (seed once), return {summary, log[]}
  function attendance(staff, monthKey, today) {
    const map = loadAttMap();
    const k = staff.id + '|' + monthKey;
    if (!map[k]) { map[k] = genMonth(staff, monthKey, today); saveAttMap(map); }
    const recs = map[k];
    const log = allDates(monthKey).map((ds) => ({ date: ds, ...(recs[ds] || { status: 'none', in: null, out: null }) }));
    return { ...summarize(recs), log };
  }
  // edit one day; status of 'absent'/'leave'/'off'/'none' clears clock times. patch = {in, out, ot}
  function setAttDay(staffId, monthKey, date, status, patch) {
    const map = loadAttMap();
    const k = staffId + '|' + monthKey;
    map[k] = map[k] || {};
    const off = status !== 'present' && status !== 'late';
    const prev = map[k][date] || {};
    const ot = patch && patch.ot != null ? +patch.ot || 0 : (+prev.ot || 0);
    map[k][date] = { status, in: off ? null : ((patch && patch.in) || prev.in || '08:00'), out: off ? null : ((patch && patch.out) || prev.out || '17:00'), ot: off ? 0 : ot };
    saveAttMap(map);
  }

  // mark a date range as 'leave' (from an approved leave request)
  function applyLeave(staffId, monthKey, fromDate, toDate) {
    const map = loadAttMap();
    const k = staffId + '|' + monthKey;
    map[k] = map[k] || {};
    allDates(monthKey).forEach((ds) => { if (ds >= fromDate && ds <= toDate) map[k][ds] = { status: 'leave', in: null, out: null, ot: 0 }; });
    saveAttMap(map);
  }

  // ---- demo account / employment info (with persisted overrides) ----
  const ACC_KEY = 'airro_empacct_v2';   // trial: empty (renamed; previously collided with money-spots 'airro_accounts_v1')
  function loadAccMap() { try { const r = localStorage.getItem(ACC_KEY); if (r) { const o = JSON.parse(r); if (o && typeof o === 'object') return o; } } catch (e) {} return {}; }
  function saveAccMap(m) { try { localStorage.setItem(ACC_KEY, JSON.stringify(m)); } catch (e) {} }
  const BANKS = ['BCA', 'BRI', 'Mandiri', 'BNI'];
  function genAccount(staff) {
    let s = 7; for (let i = 0; i < staff.id.length; i++) s = (s * 37 + staff.id.charCodeAt(i)) & 0x7fffffff;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const acc = Array.from({ length: 10 }, () => Math.floor(rnd() * 10)).join('');
    const yr = 2019 + Math.floor(rnd() * 6), mo = 1 + Math.floor(rnd() * 12);
    return { bank: BANKS[Math.floor(rnd() * BANKS.length)], account: acc, joined: `${yr}-${PAD(mo)}-01`,
      nik: '32' + Array.from({ length: 14 }, () => Math.floor(rnd() * 10)).join(''),
      status: rnd() < 0.8 ? 'Tetap' : 'Kontrak', phone: '08' + Array.from({ length: 10 }, () => Math.floor(rnd() * 10)).join(''),
      // extended HR profile defaults (kept blank; only office/maritalStatus carry a default)
      nip: '', office: 'AIRRO', noSurat: '', noKk: '', noBpjsKes: '', noBpjsTk: '',
      contractStart: '', contractEnd: '', birthPlace: '', birthDate: '',
      addressKtp: '', addressDomisili: '', maritalStatus: 'TK' };
  }
  function accountInfo(staff) { const ov = loadAccMap()[staff.id] || {}; return { ...genAccount(staff), ...ov }; }
  function saveAccount(staffId, data) { const m = loadAccMap(); m[staffId] = { ...(m[staffId] || {}), ...data }; saveAccMap(m); }

  // ---- Kasbon (employee cash advances) — shared via /state ----
  const CB_KEY = 'airro_cashbon_v1';
  function loadCashbons() { try { const r = localStorage.getItem(CB_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} return []; }
  function saveCashbons(list) { try { localStorage.setItem(CB_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch (e) {} }
  const newCashbonId = () => 'kb' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  function cashbonsFor(staffId) { return loadCashbons().filter((c) => c.employeeId === staffId); }
  function addCashbon(cb) { const list = loadCashbons(); list.push(cb); saveCashbons(list); return list; }
  function updateCashbon(id, patch) { const list = loadCashbons().map((c) => c.id === id ? { ...c, ...patch } : c); saveCashbons(list); return list; }
  function removeCashbon(id) { const list = loadCashbons().filter((c) => c.id !== id); saveCashbons(list); return list; }

  // ---- Training records — shared via /state ----
  const TR_KEY = 'airro_training_v1';
  function loadTrainings() { try { const r = localStorage.getItem(TR_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} return []; }
  function saveTrainings(list) { try { localStorage.setItem(TR_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch (e) {} }
  const newTrainingId = () => 'tr' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  function trainingsFor(staffId) { return loadTrainings().filter((t) => t.employeeId === staffId); }
  function addTraining(t) { const list = loadTrainings(); list.push(t); saveTrainings(list); return list; }
  function updateTraining(id, patch) { const list = loadTrainings().map((t) => t.id === id ? { ...t, ...patch } : t); saveTrainings(list); return list; }
  function removeTraining(id) { const list = loadTrainings().filter((t) => t.id !== id); saveTrainings(list); return list; }

  // ---- Orientation/DW daily attendance — shared via /state ----
  // Map: { [staffId]: { [date]: { checkIn, checkOut, status, lateMinutes, overtimeHours, note } } }
  // overtimeHours = manual OT override (used only when checkOut is empty).
  const ORIATT_KEY = 'airro_oriatt_v1';
  function loadOriAtt() { try { const r = localStorage.getItem(ORIATT_KEY); if (r) { const o = JSON.parse(r); if (o && typeof o === 'object') return o; } } catch (e) {} return {}; }
  function saveOriAtt(m) { try { localStorage.setItem(ORIATT_KEY, JSON.stringify(m || {})); } catch (e) {} }
  function oriAtt(staffId) {
    const days = loadOriAtt()[staffId] || {};
    return Object.keys(days).map((date) => ({ date, ...days[date] })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function setOriAttDay(staffId, date, rec) {
    const m = loadOriAtt(); m[staffId] = m[staffId] || {};
    m[staffId][date] = { checkIn: rec.checkIn || null, checkOut: rec.checkOut || null, status: rec.status || 'present', lateMinutes: +rec.lateMinutes || 0, overtimeHours: +rec.overtimeHours || 0, note: rec.note || '' };
    saveOriAtt(m);
  }
  function removeOriAttDay(staffId, date) { const m = loadOriAtt(); if (m[staffId]) { delete m[staffId][date]; saveOriAtt(m); } }

  // ---- HR calendar events (holiday | leave | permit) — shared via /state ----
  const CAL_KEY = 'airro_calendar_v1';
  function loadEvents() { try { const r = localStorage.getItem(CAL_KEY); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a; } } catch (e) {} return []; }
  function saveEvents(list) { try { localStorage.setItem(CAL_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch (e) {} }
  const newEventId = () => 'ev' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  function addEvent(ev) { const list = loadEvents(); list.push(ev); saveEvents(list); return list; }
  function updateEvent(id, patch) { const list = loadEvents().map((e) => e.id === id ? { ...e, ...patch } : e); saveEvents(list); return list; }
  function removeEvent(id) { const list = loadEvents().filter((e) => e.id !== id); saveEvents(list); return list; }
  function hasEventForSource(sourceId) { return loadEvents().some((e) => e.sourceId && e.sourceId === sourceId); }
  // Auto-create a calendar event from an approved request (dedupe by sourceId).
  function addEventFromRequest(req, type) {
    if (!req || hasEventForSource(req.id)) return loadEvents();
    return addEvent({ id: newEventId(), type: type || 'leave', title: req.title || (type === 'permit' ? 'Ijin' : 'Cuti'), employeeId: req.staffId || null, startDate: req.from, endDate: req.to || req.from, note: req.detail || '', sourceId: req.id, createdAt: Date.now() });
  }

  window.CO = { KEY, TYPE_META, ROUTE_ROLES, newReqId, load, save, reset, attendance, setAttDay, lateInfo, overtimeInfo, accountInfo, saveAccount, applyLeave, PROJ_STATUS, loadProjects, saveProjects, newProjId,
    CB_KEY, loadCashbons, saveCashbons, newCashbonId, cashbonsFor, addCashbon, updateCashbon, removeCashbon,
    TR_KEY, loadTrainings, saveTrainings, newTrainingId, trainingsFor, addTraining, updateTraining, removeTraining,
    ORIATT_KEY, oriAtt, setOriAttDay, removeOriAttDay,
    CAL_KEY, loadEvents, saveEvents, newEventId, addEvent, updateEvent, removeEvent, hasEventForSource, addEventFromRequest };
})();
