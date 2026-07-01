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
    getToken, setToken, ping, login, me, logout,
    auth: { login, me, logout },
    accounts: collection('accounts'),
    transfers: collection('transfers'),
    entries: collection('entries'),
    categories: collection('categories'),
    setoran: collection('setoran'),
    fleet: collection('fleet'),
    employees: Object.assign(collection('employees'), {
      // Allocate a unique NIP server-side (race-safe). Body: { office, contractStart? }.
      nip: (data) => req('POST', '/employees/nip', data),
      regenerateNip: (id) => req('POST', '/employees/' + id + '/regenerate-nip'),
    }),
    cashbon: Object.assign(collection('cashbon'), {
      // Live kasbon limits for a cycle (authoritative, reads shared /state).
      preview: (data) => req('POST', '/cashbon/preview', data),
      // Validate + build a kasbon (server enforces cycle/weekly rules).
      request: (data) => req('POST', '/cashbon/request', data),
    }),
    users: collection('users'),
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
    state: {
      all: () => req('GET', '/state'),
      set: (key, value) => req('PUT', '/state/' + key, { value }),
    },
  };
})();
