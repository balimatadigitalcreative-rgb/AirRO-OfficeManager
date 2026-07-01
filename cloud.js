/* AirRO Water — cloud sync adapter. Exposed on window.CLOUD.
   Makes ALL app data shared across accounts by mirroring the app's localStorage
   to the backend document store (/state). On login it hydrates localStorage
   from the server; every write is mirrored back (write-through, retried); and a
   poll pulls remote changes every ~10s (near real-time). Auth goes through the
   backend.

   Data safety: each key tracks the last value CONFIRMED in sync with the server
   (from hydrate or a successful push). The poll never overwrites a key whose
   local value differs from that confirmed value (an unsynced local edit) — it
   waits until our own push is confirmed. Failed pushes retry with backoff, so a
   transient network blip can no longer revert a local edit.

   When the backend is unreachable, the app falls back to plain localStorage and
   keeps retrying the push, so nothing is lost. */
(function () {
  if (!window.FS || !window.API) return;
  const API = window.API;
  const state = { active: false, user: null };

  // Sync every airro_* key EXCEPT per-browser / auth-only ones.
  const SKIP = new Set(['airro_session_v1', 'airro_navopen_v1', 'airro_users_v1', 'airro_jwt_v1']);
  const shouldSync = (k) => /^airro_/i.test(k) && !SKIP.has(k);

  const rawSet = localStorage.setItem.bind(localStorage);
  const rawGet = localStorage.getItem.bind(localStorage);

  // Last value known to be in sync with the server, per key.
  const confirmed = Object.create(null);
  const timers = {};    // debounce timer per key
  const retries = {};   // pending retry timer per key
  const attempts = {};  // consecutive failed attempts per key (for backoff)
  // "dirty" = there is a local value that hasn't been confirmed on the server yet.
  const isDirty = (k) => { const v = rawGet(k); return v != null && v !== confirmed[k]; };

  // ---- sync status (saving | saved | error) for the UI indicator ----
  let inflight = 0, hadError = false;
  function status() { return hadError ? 'error' : (inflight > 0 || pendingKeys() ? 'saving' : 'saved'); }
  function pendingKeys() { for (const k in timers) if (timers[k]) return true; for (const k in retries) if (retries[k]) return true; return false; }
  function emit() { if (typeof window.CLOUD.onStatus === 'function') { try { window.CLOUD.onStatus(status()); } catch (e) {} } }

  const BACKOFF = [1000, 2000, 5000, 10000, 20000, 30000];

  // ---- write-through: mirror a local write to the server, then confirm ----
  function pushNow(key) {
    if (!state.active) return;
    const value = rawGet(key);
    if (value == null) return;
    inflight++;
    emit();
    API.state.set(key, value).then(() => {
      inflight--;
      attempts[key] = 0; hadError = false;
      // Only mark clean if the value hasn't changed again during the push.
      if (rawGet(key) === value) confirmed[key] = value;
      else schedulePush(key);
      emit();
    }).catch((e) => {
      inflight--;
      hadError = true;
      const n = (attempts[key] = (attempts[key] || 0) + 1);
      const delay = BACKOFF[Math.min(n - 1, BACKOFF.length - 1)];
      console.warn('[cloud] push ' + key + ' failed (retry ' + n + ' in ' + delay + 'ms):', e.message);
      clearTimeout(retries[key]);
      retries[key] = setTimeout(() => { retries[key] = null; pushNow(key); }, delay);
      emit();
    });
  }
  function schedulePush(key) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => { delete timers[key]; pushNow(key); }, 500);
    emit();
  }
  localStorage.setItem = function (key, value) {
    rawSet(key, value);
    if (state.active && shouldSync(key)) schedulePush(key);
  };

  // ---- hydrate localStorage from the server (no echo back) ----
  async function hydrate() {
    const r = await API.state.all();
    const docs = (r && r.data) || {};
    Object.keys(docs).forEach((k) => { if (shouldSync(k)) { rawSet(k, docs[k]); confirmed[k] = docs[k]; } });
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
        if (!shouldSync(k)) return;
        // Never clobber an unsynced local edit or a key with a push in progress —
        // wait until our own push is confirmed (confirmed[k] catches up).
        if (timers[k] || retries[k] || isDirty(k)) return;
        if (rawGet(k) !== docs[k]) { rawSet(k, docs[k]); confirmed[k] = docs[k]; changed = true; }
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
      emit();
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
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    Object.keys(retries).forEach((k) => clearTimeout(retries[k]));
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
    get syncStatus() { return status(); },
    login, logout, restore, activate, frontendUser,
    onSync: null,     // set by the app shell to re-read slices on remote change
    onStatus: null,   // set by the app shell to show a saving/saved/error indicator
  };
})();
