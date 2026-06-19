/* AirRO Water — cloud sync adapter. Exposed on window.CLOUD.
   Bridges the localStorage stores (window.FS) to the REST backend (window.API)
   WITHOUT touching the React components: it swaps the implementation of a few
   FS load/save functions so that, when a backend session is active, reads come
   from a hydrated cache and writes go to both localStorage (offline mirror) and
   the backend (debounced bulk sync). When the backend is unreachable, the
   original localStorage behaviour is used unchanged.

   Scope (the cleanly-mapping resources): accounts, transfers, and the finance
   UI settings blob. Other stores remain localStorage-only for now — see
   server/README and the integration notes. */
(function () {
  if (!window.FS || !window.API) return;
  const FS = window.FS, API = window.API;

  const state = { active: false, user: null };
  const cache = {};

  // ---- field mappers (backend row shape ⇄ frontend store shape) ----
  const map = {
    accounts: {
      fromApi: (r) => ({ id: r.id, name: r.name, type: r.type, bank: r.bank || '', number: r.number || '', opening: +r.opening || 0, color: r.color, sortOrder: r.sortOrder }),
      toApi: (a, i) => ({ id: a.id, name: a.name, type: a.type || 'bank', bank: a.bank || '', number: a.number || '', opening: +a.opening || 0, color: a.color || '#065489', sortOrder: a.sortOrder != null ? a.sortOrder : i }),
    },
    transfers: {
      fromApi: (r) => ({ id: r.id, from: r.fromId, to: r.toId, amount: +r.amount || 0, date: r.date, note: r.note || '' }),
      toApi: (t) => ({ id: t.id, fromId: t.from, toId: t.to, amount: +t.amount || 0, date: t.date, note: t.note || '' }),
    },
  };

  // ---- debounced bulk sync per resource (best-effort) ----
  const timers = {};
  function queueSync(name, run) {
    if (!state.active) return;
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => {
      Promise.resolve().then(run).catch((e) => {
        // FK ordering / transient errors: keep localStorage mirror, retry on next change.
        console.warn('[cloud] sync ' + name + ' failed:', e.message);
      });
    }, 400);
  }

  // Keep originals so we can both mirror to localStorage and fall back offline.
  const orig = {
    loadAccts: FS.loadAccts, saveAccts: FS.saveAccts,
    loadTransfers: FS.loadTransfers, saveTransfers: FS.saveTransfers,
    loadSettings: FS.loadSettings, saveSettings: FS.saveSettings,
  };

  FS.loadAccts = function () { return state.active && cache.accounts ? cache.accounts : orig.loadAccts(); };
  FS.saveAccts = function (arr) {
    orig.saveAccts(arr);                       // always mirror to localStorage
    if (!state.active) return;
    cache.accounts = arr;
    queueSync('accounts', () => API.accounts.sync(arr.map(map.accounts.toApi)));
  };

  FS.loadTransfers = function () { return state.active && cache.transfers ? cache.transfers : orig.loadTransfers(); };
  FS.saveTransfers = function (arr) {
    orig.saveTransfers(arr);
    if (!state.active) return;
    cache.transfers = arr;
    queueSync('transfers', () => API.transfers.sync(arr.map(map.transfers.toApi)));
  };

  FS.loadSettings = function () { return state.active && cache.settings ? cache.settings : orig.loadSettings(); };
  FS.saveSettings = function (s) {
    orig.saveSettings(s);
    if (!state.active) return;
    cache.settings = s;
    queueSync('settings', () => API.settings.set('financeUI', s));
  };

  // ---- session lifecycle ----
  // Authenticate against the backend. Returns a frontend-shaped user on success,
  // or null when the backend is unreachable (caller then tries local PIN auth).
  async function login(username, password) {
    try {
      const u = await API.login(username, password);
      return await activate(u);
    } catch (e) {
      if (e && e.offline) return null;   // offline → let caller fall back
      throw e;                            // real 401 etc. → surface to caller
    }
  }

  // Hydrate the cache from the backend and flip the adapter on.
  async function activate(user) {
    try {
      const [accts, xfers, fxSettings] = await Promise.all([
        API.accounts.list().then((r) => r.data).catch(() => null),
        API.transfers.list().then((r) => r.data).catch(() => null),
        API.settings.get('financeUI').then((r) => r.data && r.data.value).catch(() => null),
      ]);
      cache.accounts = accts && accts.length ? accts.map(map.accounts.fromApi) : orig.loadAccts();
      cache.transfers = xfers ? xfers.map(map.transfers.fromApi) : orig.loadTransfers();
      cache.settings = fxSettings || orig.loadSettings();
      state.active = true;
      state.user = user;
      // Push the just-resolved baseline so a brand-new backend gets seeded from
      // whatever the client already had (no-op when they already match).
      queueSync('accounts', () => API.accounts.sync(cache.accounts.map(map.accounts.toApi)));
      return frontendUser(user);
    } catch (e) {
      console.warn('[cloud] activate failed, staying offline:', e.message);
      return null;
    }
  }

  function frontendUser(u) {
    return { id: u.id, name: u.name, role: u.role, user: u.username, sub: u.sub, color: u.color || '#22A7A1',
      permissions: u.permissions || null };  // per-user capability override (or null = role defaults)
  }

  function logout() { try { API.logout(); } catch (e) {} state.active = false; state.user = null; }

  // Try to restore a session from a persisted token on page load.
  async function restore() {
    if (!API.getToken()) return null;
    try {
      const u = await API.me();
      return await activate(u);
    } catch (e) {
      if (e && e.status === 401) API.setToken(null);   // drop an expired/invalid token
      return null;
    }
  }

  window.CLOUD = {
    get active() { return state.active; },
    login, logout, restore, activate, frontendUser,
  };
})();
