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
  function logout() { setToken(null); }

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
    getToken, setToken, ping, login, me, logout, changePassword, updateProfile,
    auth: { login, me, logout, changePassword, updateProfile },
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
    users: collection('users'),
    roles: collection('roles'),
    // Distribusi module (separate from the cash book). Append-only: no update/delete.
    distribusi: {
      customers: {
        list: () => req('GET', '/distribusi/customers'),
        get: (id) => req('GET', '/distribusi/customers/' + id),
        create: (data) => req('POST', '/distribusi/customers', data),
        update: (id, data) => req('PATCH', '/distribusi/customers/' + id, data),
        import: (customers) => req('POST', '/distribusi/customers/import', { customers }),
        setPrice: (id, newPrice) => req('PATCH', '/distribusi/customers/' + id + '/price', { newPrice }),
      },
      // Delivery fleet (reuses the Setoran fleet list) for the customer form.
      fleet: () => req('GET', '/distribusi/fleet'),
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
        correct: (id, data) => req('POST', '/distribusi/transactions/' + id + '/corrections', data),
      },
      audit: (qs) => req('GET', '/distribusi/audit' + (qs ? '?' + qs : '')),
      summary: (date) => req('GET', '/distribusi/dashboard/summary' + (date ? '?date=' + encodeURIComponent(date) : '')),
    },
    settings: {
      all: () => req('GET', '/settings'),
      get: (key) => req('GET', '/settings/' + key),
      set: (key, value) => req('PUT', '/settings/' + key, { value }),
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
