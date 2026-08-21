/* AirRO Water — REST API client. Exposed on window.API.
   Talks to the Express backend in /server. Token is persisted in
   localStorage so the session survives reloads. Every call degrades
   gracefully: on a network/connection error it throws ApiOffline, which the
   cloud adapter catches to fall back to localStorage. */
(function () {
  const BASE = window.AIRRO_API_BASE || 'http://localhost:4000/api/v1';
  const TOKEN_KEY = 'airro_jwt_v1';

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}

  const setToken = (t) => { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} };
  const getToken = () => token;

  class ApiOffline extends Error { constructor(m) { super(m || 'backend unreachable'); this.offline = true; } }
  class ApiError extends Error { constructor(status, body) { super((body && body.error && body.error.message) || ('HTTP ' + status)); this.status = status; this.body = body; } }

  async function req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiOffline(e.message);   // connection refused / DNS / CORS preflight failure
    }
    // Centralised 401 (token expired/invalid): notify the app ONCE. Login is exempt
    // (a 401 there is just wrong credentials, not an expired session). The cloud
    // adapter decides whether to surface it (only while a session is active).
    if (res.status === 401 && !/\/auth\/login$/.test(path) && window.API && typeof window.API.onUnauthorized === 'function') {
      try { window.API.onUnauthorized(path); } catch (e) {}
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // Quick liveness check used by the cloud adapter before hydrating.
  async function ping() {
    try { await req('GET', '/health'); return true; } catch (e) { return false; }
  }

  // ---- auth ----
  async function login(username, password) {
    const r = await req('POST', '/auth/login', { username, password });
    setToken(r.token);
    return r.user;
  }
  async function me() { const r = await req('GET', '/auth/me'); return r.user; }
  // Change the signed-in user's own password (server verifies the old one).
  async function changePassword(oldPassword, newPassword) { return req('POST', '/auth/change-password', { oldPassword, newPassword }); }
  // Edit the signed-in user's own profile (display name / avatar colour only).
  async function updateProfile(data) { const r = await req('PATCH', '/auth/me', data); return r.user; }
  // Forgot password (public, no token): always resolves with a generic message.
  async function forgot(username, note) { return req('POST', '/auth/forgot', { username, note: note || undefined }); }
  function logout() { setToken(null); }

  // Build a ?a=b&c=d query string, dropping null/'' values.
  const acctQs = (p) => { const q = []; Object.keys(p || {}).forEach((k) => { const v = p[k]; if (v != null && v !== '') q.push(k + '=' + encodeURIComponent(v)); }); return q.length ? '?' + q.join('&') : ''; };

  // ---- generic resource helpers ----
  const collection = (name) => ({
    list: (qs) => req('GET', '/' + name + (qs ? '?' + qs : '')),
    get: (id) => req('GET', '/' + name + '/' + id),
    create: (data) => req('POST', '/' + name, data),
    update: (id, data) => req('PATCH', '/' + name + '/' + id, data),
    remove: (id) => req('DELETE', '/' + name + '/' + id),
    sync: (items) => req('PUT', '/' + name + '/sync', { items }),  // bulk replace-collection
  });

  window.API = {
    BASE, ApiOffline, ApiError,
    onUnauthorized: null,   // set by the cloud adapter; called on any non-login 401
    getToken, setToken, ping, login, me, logout, changePassword, updateProfile, forgot,
    auth: { login, me, logout, changePassword, updateProfile, forgot },
    accounts: collection('accounts'),
    transfers: collection('transfers'),
    entries: collection('entries'),
    categories: collection('categories'),
    setoran: collection('setoran'),
    approvals: collection('approvals'),
    calendar: collection('calendar'),
    fleet: collection('fleet'),
    employees: Object.assign(collection('employees'), {
      // Allocate a unique NIP server-side (race-safe). Body: { office, contractStart? }.
      nip: (data) => req('POST', '/employees/nip', data),
      regenerateNip: (id) => req('POST', '/employees/' + id + '/regenerate-nip'),
    }),
    cashbon: Object.assign(collection('cashbon'), {
      // Live kasbon limits for a cycle (authoritative, reads the Employee table).
      preview: (data) => req('POST', '/cashbon/preview', data),
      // Validate + PERSIST a kasbon as 'pending' (server enforces cycle/weekly rules).
      request: (data) => req('POST', '/cashbon/request', data),
      // Approve / reject a pending kasbon (requires kasbonApprove).
      approve: (id, data) => req('POST', '/cashbon/' + id + '/approve', data || {}),
      reject: (id, data) => req('POST', '/cashbon/' + id + '/reject', data),
      cancel: (id) => req('POST', '/cashbon/' + id + '/cancel', {}),
    }),
    users: Object.assign(collection('users'), {
      // Forgot-password request queue (owner/GM).
      resetRequests: (status) => req('GET', '/users/reset-requests' + (status ? '?status=' + encodeURIComponent(status) : '')),
      handleResetRequest: (id, status) => req('PATCH', '/users/reset-requests/' + id, { status }),
      audit: (userId) => req('GET', '/users/audit' + (userId ? '?userId=' + encodeURIComponent(userId) : '')),   // admin audit trail (all or one user)
    }),
    roles: collection('roles'),
    // ACCOUNTING v2 (double-entry) reports — flag-gated server-side (404 when ACCOUNTING_V2 is off).
    accounting: {
      cashFlow: (p) => req('GET', '/accounting/cash-flow' + acctQs(p)),   // { dateFrom, dateTo, businessUnitId?, fleetId? }
      ledger: (p) => req('GET', '/accounting/ledger' + acctQs(p)),        // { code, dateFrom?, dateTo? } — Buku Besar (one account)
      generalLedger: (p) => req('GET', '/accounting/general-ledger' + acctQs(p)),   // all accounts w/ balances
      chart: () => req('GET', '/accounting/chart'),                       // full chart of accounts (hierarchy)
      journal: (p) => req('GET', '/accounting/journal' + acctQs(p)),      // { sourceType, sourceId } — full balanced journal (drill)
      trialBalance: (p) => req('GET', '/accounting/trial-balance' + acctQs(p)),
      aging: (p) => req('GET', '/accounting/aging' + acctQs(p)),
      // Period close (Tutup Buku)
      periods: () => req('GET', '/accounting/periods'),
      periodChecklist: (p) => req('GET', '/accounting/periods/checklist' + acctQs(p)),   // { year, month }
      periodClose: (b) => req('POST', '/accounting/periods/close', b),   // { year, month, lock? }
      periodReopen: (b) => req('POST', '/accounting/periods/reopen', b), // { year, month, reason }
      // Bank reconciliation (Rekonsiliasi)
      reconciliation: (p) => req('GET', '/accounting/reconciliation' + acctQs(p)),   // { accountId, statementBalance? }
      reconcileMark: (b) => req('POST', '/accounting/reconciliation/mark', b),        // { accountId, itemType, itemId, cleared, statementRef? }
      // Integrity (drift), Pemetaan Akun (category mapping), and Backfill (with dry-run preview)
      integrity: (p) => req('GET', '/accounting/integrity' + acctQs(p)),             // { missing[], orphan[], ok }
      status: (p) => req('GET', '/accounting/status' + acctQs(p)),                   // { lastPostedAt, trialBalanced, integrity, unmappedCount, unreconciled, priorMonth, priorClosed }
      mappings: () => req('GET', '/accounting/mappings'),                             // { items[], accounts{income,expense}, unmappedCount }
      setMapping: (b) => req('POST', '/accounting/mappings', b),                      // { categoryKey, type, chartCode }
      clearMapping: (b) => req('DELETE', '/accounting/mappings', b),                  // { categoryKey, type }
      backfill: (b) => req('POST', '/accounting/backfill', b || {}),                  // dryRun → preview counts; else → { jobId, total } (async job)
      backfillStatus: (jobId) => req('GET', '/accounting/backfill/status/' + jobId),  // { processed, total, posted, failed, status, result, errors[] }
      // ACCOUNTS PAYABLE (Utang Usaha)
      apSuppliers: (p) => req('GET', '/accounting/suppliers' + acctQs(p)),             // supplier picker → { data }
      apSupplierCreate: (b) => req('POST', '/accounting/suppliers', b),                // { name, phone? }
      bills: (p) => req('GET', '/accounting/bills' + acctQs(p)),                       // { status?, supplierId?, dateFrom?, dateTo? } → { data, summary }
      bill: (id) => req('GET', '/accounting/bills/' + id),
      billCreate: (b) => req('POST', '/accounting/bills', b),                          // { supplierId, billDate, dueDate?, lines[], tax?, ... } (draft)
      billUpdate: (id, b) => req('PATCH', '/accounting/bills/' + id, b),               // draft only
      billIssue: (id) => req('POST', '/accounting/bills/' + id + '/issue', {}),        // draft → terbuka (posts accrual)
      billPay: (id, b) => req('POST', '/accounting/bills/' + id + '/payments', b),     // { date, amount, accountId?, method?, reference? }
      billVoid: (id, b) => req('POST', '/accounting/bills/' + id + '/void', b),        // { reason }
      agingPayable: (p) => req('GET', '/accounting/aging-payable' + acctQs(p)),        // Umur Utang (AP aging buckets)
      payablesDue: (p) => req('GET', '/accounting/payables-due' + acctQs(p)),          // jatuh tempo minggu ini
      // ACCRUAL MECHANICS — accrued expenses (reversing) + prepaid amortisation
      accruals: (p) => req('GET', '/accounting/accruals' + acctQs(p)),
      accrualCreate: (b) => req('POST', '/accounting/accruals', b),                    // { chartCode, amount, date, reverseDate?, description? }
      accrualVoid: (id, b) => req('POST', '/accounting/accruals/' + id + '/void', b),  // { reason }
      amortSchedules: (p) => req('GET', '/accounting/amortization-schedules' + acctQs(p)),
      amortScheduleCreate: (b) => req('POST', '/accounting/amortization-schedules', b),// { chartCode, total, months, startDate, description? }
      amortize: (b) => req('POST', '/accounting/amortize', b || {}),                   // { asOf? } → posts every due month
      // RECURRING SUBSCRIPTIONS — a recurring bill template
      subscriptions: (p) => req('GET', '/accounting/subscriptions' + acctQs(p)),       // → { data, summary }
      subscription: (id) => req('GET', '/accounting/subscriptions/' + id),
      subscriptionCreate: (b) => req('POST', '/accounting/subscriptions', b),          // { supplierId, name, chartCode, amount, cadence, startDate, ... }
      subscriptionUpdate: (id, b) => req('PATCH', '/accounting/subscriptions/' + id, b),
      subscriptionPause: (id) => req('POST', '/accounting/subscriptions/' + id + '/pause', {}),
      subscriptionResume: (id) => req('POST', '/accounting/subscriptions/' + id + '/resume', {}),
      subscriptionCancel: (id) => req('POST', '/accounting/subscriptions/' + id + '/cancel', {}),
      subscriptionSkip: (id) => req('POST', '/accounting/subscriptions/' + id + '/skip', {}),
      subscriptionsRun: (b) => req('POST', '/accounting/subscriptions/run', b || {}),  // { asOf? } → generates due bills
      subscriptionsDue: (p) => req('GET', '/accounting/subscriptions-due' + acctQs(p)), // dashboard card — due within N days
      // FIXED ASSETS & DEPRECIATION
      assets: (p) => req('GET', '/accounting/assets' + acctQs(p)),                      // { category, unit, fleet, status }
      assetGet: (id) => req('GET', '/accounting/assets/' + id),                         // detail + full schedule
      assetCreate: (b) => req('POST', '/accounting/assets', b),
      assetDispose: (id, b) => req('POST', '/accounting/assets/' + id + '/dispose', b), // { disposalDate, disposalProceeds, status, proceedsCode? }
      depreciate: (b) => req('POST', '/accounting/depreciate', b || {}),               // { asOf?, assetId? } → posts every due month
      assetsImportPreview: (b) => req('POST', '/accounting/assets/import/preview', b),  // { rows } → per-row validation
      assetsImportCommit: (b) => req('POST', '/accounting/assets/import', b),           // { rows } → commit valid rows
      gallonPoolReconcile: (id) => req('GET', '/accounting/assets/' + id + '/reconcile-pool'),
      gallonPoolLoss: (id, b) => req('POST', '/accounting/assets/' + id + '/pool-loss', b), // { qty, kind, reason }
    },
    // Proof attachments live out of the record payload. `create` uploads a compressed
    // data URL and returns { id, name, isImg, mime, size }; `get` lazily fetches the bytes
    // (only when a proof is actually opened).
    attachments: {
      create: (data) => req('POST', '/attachments', data),
      get: (id) => req('GET', '/attachments/' + id),
    },
    // Distribusi module (separate from the cash book). Append-only: no update/delete.
    distribusi: {
      // A `fleet` filter ('Merah'/'Biru'/…) narrows a full-access user to one fleet;
      // scoped users are always restricted server-side regardless. Falsy/'all' = no filter.
      customers: {
        // status: undefined/'active' = active only (default); 'inactive' = deactivated only; 'all' = both.
        // `filter` = the detailed multi-criteria panel (all optional, combined with AND):
        // { q, types:[], bon:'ada'|'lunas', bonMin, days:[], daysMode:'any'|'all',
        //   complete:'lengkap'|'belum', hasLocation:'ya'|'tidak', priceMin, priceMax }.
        // Sent to the server so filtering happens against the whole dataset, not the loaded page.
        list: (fleet, status, filter) => {
          const q = [];
          if (fleet && fleet !== 'all') q.push('fleet=' + encodeURIComponent(fleet));
          if (status && status !== 'active') q.push('status=' + encodeURIComponent(status));
          const f = filter || {};
          const add = (k, v) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) q.push(k + '=' + encodeURIComponent(Array.isArray(v) ? v.join(',') : v)); };
          add('q', (f.q || '').trim()); add('types', f.types); add('bon', f.bon); add('bonMin', f.bonMin);
          add('days', f.days); if ((f.days || []).length && f.daysMode === 'all') add('daysMode', 'all');
          add('complete', f.complete); add('hasLocation', f.hasLocation); add('priceMin', f.priceMin); add('priceMax', f.priceMax);
          return req('GET', '/distribusi/customers' + (q.length ? '?' + q.join('&') : ''));
        },
        get: (id) => req('GET', '/distribusi/customers/' + id),
        create: (data) => req('POST', '/distribusi/customers', data),
        update: (id, data) => req('PATCH', '/distribusi/customers/' + id, data),
        setLocation: (id, data) => req('PATCH', '/distribusi/customers/' + id + '/location', data),   // { lat, lng, accuracy?, address? }
        setLocationPhoto: (id, photoId) => req('PATCH', '/distribusi/customers/' + id + '/location-photo', { photoId: photoId || null }),
        // Opening / carry-over bon (cap: distribusiKoreksi) — a REAL receivable dated by the admin.
        openingBon: (id, data) => req('POST', '/distribusi/customers/' + id + '/opening-bon', data),   // { amount, txnDate, note }
        // Balance ADJUSTMENTS (penyesuaian galon/bon) — cap distribusiPenyesuaian; approve/reverse are GM/owner.
        createAdjustment: (id, data) => req('POST', '/distribusi/customers/' + id + '/adjustments', data),   // { kind, mode, value|delta, reason, note?, evidenceUrl? }
        listAdjustments: (id) => req('GET', '/distribusi/customers/' + id + '/adjustments'),
        approveAdjustment: (adjId) => req('POST', '/distribusi/adjustments/' + adjId + '/approve', {}),
        reverseAdjustment: (adjId) => req('POST', '/distribusi/adjustments/' + adjId + '/reverse', {}),
        // TRANSACTION DISPUTES / LOSS — cap distribusiBonAdjust; approve/reverse are GM/owner.
        raiseDispute: (txnId, data) => req('POST', '/distribusi/transactions/' + txnId + '/dispute', data),   // { reason, resolution, customerClaimAmount?, note, evidenceUrl?, staffUserId?, staffName? }
        approveDispute: (dId, data) => req('POST', '/distribusi/disputes/' + dId + '/approve', data || {}),
        reverseDispute: (dId) => req('POST', '/distribusi/disputes/' + dId + '/reverse', {}),
        import: (customers, skipped) => req('POST', '/distribusi/customers/import', { customers, skipped: skipped || 0 }),
        // Per-customer legacy (archive) transaction import + undo a batch.
        importLegacyTxns: (id, rows, skipped, includeBon) => req('POST', '/distribusi/customers/' + id + '/transactions/import', { rows, skipped: skipped || 0, includeBon: includeBon !== false }),
        undoLegacyBatch: (id, batchId) => req('DELETE', '/distribusi/customers/' + id + '/transactions/legacy-batch/' + batchId),
        // scope: null = new transactions only; 'all'|'cycle'|'bon' = also adjust old ones.
        setPrice: (id, newPrice, scope) => req('PATCH', '/distribusi/customers/' + id + '/price', { newPrice, scope: scope || null }),
        pricePreview: (id, newPrice) => req('POST', '/distribusi/customers/' + id + '/price/preview', { newPrice }),
        cancelPriceAdjustment: (batchId) => req('DELETE', '/distribusi/price-adjustments/' + batchId),
        // Customer removal (gated distribusiCustomerDelete): deactivate = soft/reversible; remove = permanent wipe.
        deactivate: (id) => req('PATCH', '/distribusi/customers/' + id + '/deactivate'),
        reactivate: (id) => req('PATCH', '/distribusi/customers/' + id + '/reactivate'),
        remove: (id) => req('DELETE', '/distribusi/customers/' + id),
      },
      // Editable customer-type dictionary (id + label).
      types: {
        list: () => req('GET', '/distribusi/customer-types'),
        create: (label) => req('POST', '/distribusi/customer-types', { label }),
        rename: (id, label) => req('PATCH', '/distribusi/customer-types/' + id, { label }),
        remove: (id, reassignTo) => req('DELETE', '/distribusi/customer-types/' + id + (reassignTo ? '?reassignTo=' + encodeURIComponent(reassignTo) : '')),
      },
      transactions: {
        list: (qs) => req('GET', '/distribusi/transactions' + (qs ? '?' + qs : '')),
        create: (data) => req('POST', '/distribusi/transactions', data),
        // CORRECTION / VOID are APPROVAL-GATED. These now SUBMIT a pending request (they no longer
        // change the transaction). correct: structured input fields per method + reason; void: reason.
        correct: (id, data) => req('POST', '/distribusi/transactions/' + id + '/corrections', data),   // { reason, qty?, unitPrice?, gallonOut?, gallonIn?, amount? }
        // DRY-RUN preview of a correction (server-computed nominal + sisa-bon impact). No reason needed.
        previewCorrect: (id, data) => req('POST', '/distribusi/transactions/' + id + '/corrections/preview', data),   // → { oldAmount, newAmount, oldSisaBon, newSisaBon, wouldGoNegative, ... }
        void: (id, data) => req('POST', '/distribusi/transactions/' + id + '/void', data),   // { reason }
        // ARCHIVE TOGGLE (cap distribusiLegacyImport) — flip active↔archive(legacy); reason required.
        setArchive: (id, data) => req('POST', '/distribusi/transactions/' + id + '/archive', data),   // { legacy, reason }
        // PELUNASAN TIDAK DITERIMA (cap distribusiBonAdjust) — the customer paid but the money never
        // reached the company. Reduces their bon like a normal pelunasan; recorded as an internal loss
        // against the responsible staff and excluded from every cash figure.
        paymentNotReceived: (data) => req('POST', '/distribusi/transactions/payment-not-received', data),
        // HARD DELETE (cap distribusiHardDelete, owner) — permanent; audit written first.
        hardDelete: (id, data) => req('DELETE', '/distribusi/transactions/' + id, data),     // { reason, confirm, password }
        // BULK removal (batal · arsip · hapus): server-computed preview → execute → restore/undo.
        bulkPreview: (data) => req('POST', '/distribusi/transactions/bulk/preview', data),   // { ids, action }
        bulk: (data) => req('POST', '/distribusi/transactions/bulk', data),                  // { ids, action, note, reason?, confirm? }
        bulkRestore: (batchId) => req('POST', '/distribusi/transactions/bulk/restore', { batchId }),
      },
      // CHANGE REQUESTS — the approval inbox for correction/void requests (cap distribusiApprove).
      changeRequests: {
        list: (opts) => { const o = opts || {}; const p = []; if (o.status) p.push('status=' + encodeURIComponent(o.status)); if (o.fleet && o.fleet !== 'all') p.push('fleet=' + encodeURIComponent(o.fleet)); return req('GET', '/distribusi/change-requests' + (p.length ? '?' + p.join('&') : '')); },
        approve: (id, body) => req('POST', '/distribusi/change-requests/' + id + '/approve', body || {}),   // body: { confirmNegative? }
        reject: (id, note) => req('POST', '/distribusi/change-requests/' + id + '/reject', { note }),
      },
      // Customer invoices / notas (documents). create/list are per-customer; get by id.
      invoices: {
        create: (customerId, data) => req('POST', '/distribusi/customers/' + customerId + '/invoices', data || {}),
        list: (customerId) => req('GET', '/distribusi/customers/' + customerId + '/invoices'),
        get: (id) => req('GET', '/distribusi/invoices/' + id),
        // WhatsApp share: signed public link (create/reuse), revoke, dispatch log + history.
        link: (id) => req('POST', '/distribusi/invoices/' + id + '/link'),                     // → { token, url, expiresAt }
        revoke: (id) => req('POST', '/distribusi/invoices/' + id + '/revoke'),                 // → { revoked }
        dispatch: (data) => req('POST', '/distribusi/invoices/dispatch', data),                // log a WA send
        dispatches: (qs) => req('GET', '/distribusi/invoices/dispatches' + (qs ? '?' + qs : '')),
      },
      audit: (qs) => req('GET', '/distribusi/audit' + (qs ? '?' + qs : '')),
      // Cash Integration — one gated read (distribusiCashIntegrasi) returning { transactions, customers, audit }.
      cashIntegration: (qs) => req('GET', '/distribusi/cash-integration' + (qs ? '?' + qs : '')),
      // Delivery board: one stop per fleet per date (jadwal generated + tambahan orders).
      deliveries: {
        board: (date, fleet) => { const p = ['date=' + encodeURIComponent(date)]; if (fleet && fleet !== 'all') p.push('fleet=' + encodeURIComponent(fleet)); return req('GET', '/distribusi/deliveries?' + p.join('&')); },
        addOrder: (data) => req('POST', '/distribusi/deliveries/order', data),
        mark: (id, data) => req('PATCH', '/distribusi/deliveries/' + id, data),
        reorder: (data) => req('PUT', '/distribusi/deliveries/reorder', data),   // { date, fleet, order:[ids] }
        close: (data) => req('POST', '/distribusi/deliveries/close', data),      // { date, fleet, generalNote, reasons:{id:reason} }
        closeouts: (qs) => req('GET', '/distribusi/closeouts' + (qs ? '?' + qs : '')),
      },
      // Delivery runs (rit): per-trip gallon out/in + reconciliation.
      runs: {
        list: (date, fleet, status) => { const p = []; if (date) p.push('date=' + encodeURIComponent(date)); if (fleet && fleet !== 'all') p.push('fleet=' + encodeURIComponent(fleet)); if (status) p.push('status=' + encodeURIComponent(status)); return req('GET', '/distribusi/runs' + (p.length ? '?' + p.join('&') : '')); },
        open: (data) => req('POST', '/distribusi/runs/open', data),               // { date, fleet, gallonsOut, note? }
        close: (id, data) => req('POST', '/distribusi/runs/' + id + '/close', data), // { gallonsFullReturned, gallonsEmptyReturned, diffReason?, resolution? }
        correct: (id, data) => req('POST', '/distribusi/runs/' + id + '/corrections', data), // { out?, full?, empty?, reason } — corrected absolute values
      },
      // Field expenses (pengeluaran lapangan): cash a driver paid out, with an optional receipt photo.
      expenses: {
        list: (qs) => { const p = []; if (qs) { for (const k in qs) if (qs[k] != null && qs[k] !== '' && qs[k] !== 'all') p.push(k + '=' + encodeURIComponent(qs[k])); } return req('GET', '/distribusi/expenses' + (p.length ? '?' + p.join('&') : '')); },
        categories: () => req('GET', '/distribusi/expenses/categories'),
        create: (data) => req('POST', '/distribusi/expenses', data),          // { date, fleet?, amount, category, method?, recipient?, note?, photoId? }
        void: (id, data) => req('POST', '/distribusi/expenses/' + id + '/void', data), // { reason }
      },
      // Gallon stock (loan/exchange): summary + per-customer balances + ledger; correction.
      gallon: (fleet) => req('GET', '/distribusi/gallon' + (fleet && fleet !== 'all' ? '?fleet=' + encodeURIComponent(fleet) : '')),
      // Location model: physical count (opname) + integrity guard (silent-leakage check).
      opname: (data) => req('POST', '/distribusi/gallon/opname', data),                 // { location:'depot'|fleetId, count, note, proof? }
      opnameHistory: (fleet) => req('GET', '/distribusi/gallon/opname/history' + (fleet && fleet !== 'all' ? '?fleet=' + encodeURIComponent(fleet) : '')),
      gallonIntegrity: () => req('GET', '/distribusi/gallon/integrity'),
      gallonIntegrityRepair: () => req('POST', '/distribusi/gallon/integrity/repair'),
      // Reset Total Stok Galon (owner) — clean slate for the whole gallon ledger; never touches money.
      resetTotalPreview: (data) => req('POST', '/distribusi/gallon/reset-total/preview', data),   // { mode, counts } → dryRun preview
      resetTotal: (data) => req('POST', '/distribusi/gallon/reset-total', data),                  // { mode, counts, note, confirm:'RESET TOTAL' }
      resetTotalRestore: (batchId) => req('POST', '/distribusi/gallon/reset-total/restore', { batchId }),
      // Rincian Stok Awal — per-row opening/depot management (customerId=null rows only; never money).
      openingRows: (fleet) => req('GET', '/distribusi/gallon/opening-rows' + (fleet && fleet !== 'all' ? '?fleet=' + encodeURIComponent(fleet) : '')),
      openingRowsPreview: (data) => req('POST', '/distribusi/gallon/opening-rows/bulk/preview', data),   // { ids, action, fleetId }
      openingRowsBulk: (data) => req('POST', '/distribusi/gallon/opening-rows/bulk', data),              // { ids, action, fleetId, note }
      openingRowsRestore: (batchId) => req('POST', '/distribusi/gallon/opening-rows/restore', { batchId }),
      gallonCorrection: (data) => req('POST', '/distribusi/gallon/correction', data),
      setOpeningStock: (data) => req('POST', '/distribusi/gallon/opening', data),   // { qty, fleet?, reason }
      resetGallon: (data) => req('POST', '/distribusi/gallon/reset', data),          // { mode:balanced|purge, fleet?, target?, confirm?, reason }
      // Depot gallon-stock ENTRY void / restore / hard-delete + reset-stok-awal (customerId=null rows only).
      gallonMovementImpact: (id) => req('GET', '/distribusi/gallon/movements/' + id + '/impact'),
      gallonMovementVoid: (id, data) => req('POST', '/distribusi/gallon/movements/' + id + '/void', data),      // { note, reason? }
      gallonMovementRestore: (id, data) => req('POST', '/distribusi/gallon/movements/' + id + '/restore', data || {}),
      gallonMovementDelete: (id, data) => req('DELETE', '/distribusi/gallon/movements/' + id, data),            // owner; { note }
      openingResetImpact: (q) => req('GET', '/distribusi/gallon/opening/reset/impact?' + q),                    // mode&targetQty&fleetId
      openingReset: (data) => req('POST', '/distribusi/gallon/opening/reset', data),                            // { mode:delta|void_all, targetQty?, fleetId?, note, confirm? }
      // opts: { period?, dateFrom?, dateTo?, fleet? }. Default (no opts) = today only. History
      // periods require the distribusiDashHistory cap (server-enforced — a non-today window 403s).
      summary: (opts) => { const o = opts || {}; const p = []; ['period', 'dateFrom', 'dateTo'].forEach((k) => { if (o[k]) p.push(k + '=' + encodeURIComponent(o[k])); }); if (o.fleet && o.fleet !== 'all') p.push('fleet=' + encodeURIComponent(o.fleet)); return req('GET', '/distribusi/dashboard/summary' + (p.length ? '?' + p.join('&') : '')); },
      billingReminders: (fleet) => req('GET', '/distribusi/billing-reminders' + (fleet && fleet !== 'all' ? '?fleet=' + encodeURIComponent(fleet) : '')),
      // Laporan Pengiriman (delivery report) — read-only, cap distribusiPengirimanReport.
      deliveryReport: (opts) => { const o = opts || {}; const p = []; ['period', 'date', 'dateFrom', 'dateTo'].forEach((k) => { if (o[k]) p.push(k + '=' + encodeURIComponent(o[k])); }); if (o.fleet && o.fleet !== 'all') p.push('fleet=' + encodeURIComponent(o.fleet)); return req('GET', '/distribusi/reports/delivery' + (p.length ? '?' + p.join('&') : '')); },
      // Kerugian / Uang Tidak Diterima — INTERNAL loss report, cap distribusiBonAdjust. Never printed
      // on anything the customer sees.
      lossReport: (opts) => { const o = opts || {}; const p = []; ['period', 'date', 'dateFrom', 'dateTo'].forEach((k) => { if (o[k]) p.push(k + '=' + encodeURIComponent(o[k])); }); if (o.fleet && o.fleet !== 'all') p.push('fleet=' + encodeURIComponent(o.fleet)); return req('GET', '/distribusi/reports/loss' + (p.length ? '?' + p.join('&') : '')); },
      // KERUGIAN void / delete (cap distribusiBonAdjust; delete owner-only, server-checked). `source` = pnr|dispute.
      kerugianImpact: (id, source) => req('GET', '/distribusi/kerugian/' + id + '/impact' + (source ? '?source=' + source : '')),
      voidKerugian: (id, source, data) => req('POST', '/distribusi/kerugian/' + id + '/void' + (source ? '?source=' + source : ''), data),   // { reason, note }
      editKerugianNote: (id, source, note) => req('POST', '/distribusi/kerugian/' + id + '/note' + (source ? '?source=' + source : ''), { note }),
      hardDeleteKerugian: (id, source, confirm) => req('DELETE', '/distribusi/kerugian/' + id + (source ? '?source=' + source : ''), { confirm }),
      bulkDeleteKerugian: (items) => req('POST', '/distribusi/kerugian/bulk-delete', { items }),
      adjustmentReport: (opts) => { const o = opts || {}; const p = []; ['period', 'dateFrom', 'dateTo', 'reason', 'kind', 'status', 'userId'].forEach((k) => { if (o[k]) p.push(k + '=' + encodeURIComponent(o[k])); }); if (o.fleet && o.fleet !== 'all') p.push('fleet=' + encodeURIComponent(o.fleet)); return req('GET', '/distribusi/reports/adjustments' + (p.length ? '?' + p.join('&') : '')); },
    },
    // Gudang (warehouse) — ledger-based inventory.
    gudang: {
      summary: () => req('GET', '/gudang/summary'),
      report: () => req('GET', '/gudang/report'),
      item: (id) => req('GET', '/gudang/items/' + id),
      createItem: (data) => req('POST', '/gudang/items', data),          // { name, kind?, unit?, bufferMin? }
      updateItem: (id, data) => req('PATCH', '/gudang/items/' + id, data), // { name?, unit?, form?, description?, photoId? }
      // Buffer is its own action/capability (gudangBuffer), not part of item details.
      setBuffer: (id, bufferMin) => req('PATCH', '/gudang/items/' + id + '/buffer', { bufferMin }),
      addStock: (id, data) => req('POST', '/gudang/items/' + id + '/stock', data),   // { type:in|purchase|opening|correction, qty, reason }
      addDamage: (id, data) => req('POST', '/gudang/items/' + id + '/damage', data), // { type:damage|loss, qty, reason }
      reportGallonDamage: (data) => req('POST', '/gudang/gallon/damage', data),      // { kind:pecah|rusak|hilang, qty, reason, fleet?, culprit?, proof? }
      sellRusak: (data) => req('POST', '/gudang/gallon-rusak/sell', data),           // { qty, price, method?, reason? }
      // Daily closeout (opname + day report).
      closeoutPreview: (date) => req('GET', '/gudang/closeout?date=' + encodeURIComponent(date)),
      closeWarehouse: (data) => req('POST', '/gudang/closeout', data),               // { date, items:[{itemId,physical,reason?}], note? }
      closeouts: (date) => req('GET', '/gudang/closeouts' + (date ? '?date=' + encodeURIComponent(date) : '')),
      // Suppliers (Pemasok).
      suppliers: (query) => req('GET', '/gudang/suppliers' + (query ? '?' + query : '')),   // ?q=&status=active|inactive|all
      supplier: (id) => req('GET', '/gudang/suppliers/' + id),                        // + purchase history
      createSupplier: (data) => req('POST', '/gudang/suppliers', data),               // { name, phone?, address?, note? }
      updateSupplier: (id, data) => req('PATCH', '/gudang/suppliers/' + id, data),
      setSupplierActive: (id, active) => req('PATCH', '/gudang/suppliers/' + id + '/active', { active }),
      deleteSupplier: (id) => req('DELETE', '/gudang/suppliers/' + id),
    },
    // Selective data wipe (cap: dataWipe). The server backs up first and refuses without
    // the typed word + the caller's password.
    dataWipe: {
      categories: () => req('GET', '/data-wipe/categories'),
      history: () => req('GET', '/data-wipe/history'),
      preview: (categories) => req('POST', '/data-wipe/preview', { categories }),
      wipe: (categories, confirm, password) => req('POST', '/data-wipe', { categories, confirm, password }),
    },
    settings: {
      all: () => req('GET', '/settings'),
      get: (key) => req('GET', '/settings/' + key),
      set: (key, value) => req('PUT', '/settings/' + key, { value }),
    },
    // Business unit (unit bisnis) dictionary — Stage 1 labels only. Read is open to any
    // authed user; write needs manageBusinessUnits (owner). Nothing is filtered by unit yet.
    businessUnits: {
      list: () => req('GET', '/business-units'),
      create: (data) => req('POST', '/business-units', data),          // { name, code? }
      update: (id, data) => req('PATCH', '/business-units/' + id, data), // { name?, code?, active?, enabledModules? }
    },
    // Inter-unit transfer (Stage 4) — an internal money movement posted as a linked pair of
    // entries. Owner-tier (cap: interUnitTransfer). Void reverses BOTH legs.
    interUnitTransfers: {
      create: (data) => req('POST', '/inter-unit-transfers', data),    // { fromUnitId,toUnitId,fromAccountId,toAccountId,amount,date,note? }
      void: (groupId) => req('DELETE', '/inter-unit-transfers/' + groupId),
    },
    reports: {
      summary: (qs) => req('GET', '/reports/summary' + (qs ? '?' + qs : '')),
      cashflow: (qs) => req('GET', '/reports/cashflow' + (qs ? '?' + qs : '')),
      breakdown: (qs) => req('GET', '/reports/breakdown' + (qs ? '?' + qs : '')),
    },
    payroll: {
      run: () => req('GET', '/payroll'),
      post: (data) => req('POST', '/payroll/post', data),
    },
    // Shared app-state document store (mirrors localStorage across all accounts).
    // all(since): pass the server `now` from the previous pull to fetch only keys
    // changed since then (incremental poll); omit for a full snapshot (hydrate).
    // Returns { data, meta, now } — meta[key] = server updatedAt ISO, used by the
    // cloud adapter to avoid overwriting a newer unsynced local edit.
    state: {
      all: (since) => req('GET', '/state' + (since ? '?since=' + encodeURIComponent(since) : '')),
      set: (key, value) => req('PUT', '/state/' + key, { value }),
    },
  };
})();
