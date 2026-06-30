/* AirRO Water — cloud sync adapter. Exposed on window.CLOUD.
   Makes ALL app data shared across accounts by mirroring the app's localStorage
   to the backend document store (/state). On login it hydrates localStorage
   from the server; every write is mirrored back; and a poll pulls remote changes
   every ~10s (near real-time). Auth (login/restore) goes through the backend.

   When the backend is unreachable, the app falls back to plain localStorage. */
(function () {
  if (!window.FS || !window.API) return;
  const API = window.API;
  const state = { active: false, user: null };

  // Sync every airro_* key EXCEPT per-browser / auth-only ones.
  const SKIP = new Set(['airro_session_v1', 'airro_navopen_v1', 'airro_users_v1', 'airro_jwt_v1']);
  const shouldSync = (k) => /^airro_/i.test(k) && !SKIP.has(k);

  const rawSet = localStorage.setItem.bind(localStorage);
  const rawGet = localStorage.getItem.bind(localStorage);

  // ---- write-through: mirror local writes to the server (debounced) ----
  const timers = {};
  function queuePush(key) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      delete timers[key];
      const value = rawGet(key);
      if (value == null) return;
      API.state.set(key, value).catch((e) => console.warn('[cloud] push ' + key + ':', e.message));
    }, 500);
  }
  localStorage.setItem = function (key, value) {
    rawSet(key, value);
    if (state.active && shouldSync(key)) queuePush(key);
  };

  // ---- hydrate localStorage from the server (no echo back) ----
  async function hydrate() {
    const r = await API.state.all();
    const docs = (r && r.data) || {};
    Object.keys(docs).forEach((k) => { if (shouldSync(k)) rawSet(k, docs[k]); });
  }

  // ---- poll for remote changes (near real-time) ----
  let pollTimer = null;
  async function poll() {
    if (!state.active) return;
    try {
      const r = await API.state.all();
      const docs = (r && r.data) || {};
      let changed = false;
      Object.keys(docs).forEach((k) => {
        if (!shouldSync(k) || timers[k]) return;      // skip keys with a pending local push
        if (rawGet(k) !== docs[k]) { rawSet(k, docs[k]); changed = true; }
      });
      if (changed && typeof window.CLOUD.onSync === 'function') window.CLOUD.onSync();
    } catch (e) { /* transient — try again next tick */ }
  }
  function startPoll() { if (!pollTimer) pollTimer = setInterval(poll, 10000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---- session lifecycle ----
  async function login(username, password) {
    try {
      const u = await API.login(username, password);
      return await activate(u);
    } catch (e) {
      if (e && e.offline) return null;   // offline → caller may fall back
      throw e;                            // 401 etc. → surface
    }
  }

  async function activate(user) {
    try {
      await hydrate();
      state.active = true;
      state.user = user;
      startPoll();
      return frontendUser(user);
    } catch (e) {
      console.warn('[cloud] activate failed, staying offline:', e.message);
      return null;
    }
  }

  function frontendUser(u) {
    return { id: u.id, name: u.name, role: u.role, user: u.username, sub: u.sub,
      color: u.color || '#22A7A1', permissions: u.permissions || null };
  }

  function logout() {
    try { API.logout(); } catch (e) {}
    state.active = false; state.user = null; stopPoll();
  }

  async function restore() {
    if (!API.getToken()) return null;
    try {
      const u = await API.me();
      return await activate(u);
    } catch (e) {
      if (e && e.status === 401) API.setToken(null);
      return null;
    }
  }

  window.CLOUD = {
    get active() { return state.active; },
    login, logout, restore, activate, frontendUser,
    onSync: null,   // set by the app shell to re-read slices on remote change
  };
})();
