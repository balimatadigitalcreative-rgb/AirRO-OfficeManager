/* AirRO Water — cloud sync adapter. Exposed on window.CLOUD.
   Makes ALL app data shared across accounts by mirroring the app's localStorage
   to the backend document store (/state). On login it hydrates localStorage
   from the server; every write is mirrored back (write-through, retried); and a
   poll pulls remote changes every 3s (near real-time) for every logged-in user.
   Auth goes through the backend.

   The session is armed (active + poll + write-through) BEFORE the initial hydrate
   and STAYS active even if that hydrate fails, so a transient server blip never
   drops a user into a silent offline state. On activation every unconfirmed local
   key is flushed up, so pending edits reach the server without a manual re-save.

   Data safety: each key tracks the last value CONFIRMED in sync with the server
   (from hydrate or a successful push). The poll never overwrites a key whose
   local value differs from that confirmed value (an unsynced local edit) — it
   waits until our own push is confirmed. Failed pushes retry with backoff, so a
   transient network blip can no longer revert a local edit.

   A write only counts as a local edit when its CONTENT differs from `confirmed`.
   Echo rewrites (re-persisting server data after the poll applied it) are equal to
   confirmed, so they don't mark the key dirty and don't block the poll — otherwise
   a passive client would keep skipping a remote change until a manual refresh. A
   derived rewrite that genuinely differs (a passive client re-computing cash flow
   from a freshly received setoran) is a real change and IS pushed, so every client
   converges on it. The shell's refreshAllSlices additionally applies each slice
   only when its content changed, so unrelated slices don't needlessly re-derive.

   When the backend is unreachable, the app falls back to plain localStorage and
   keeps retrying the push, so nothing is lost. */
(function () {
  if (!window.FS || !window.API) return;
  const API = window.API;
  const state = { active: false, user: null, sessionExpired: false };

  // Sync every airro_* key EXCEPT per-browser / auth-only ones. The sync-meta key
  // (per-key last local-write time) is also local-only.
  const META_KEY = 'airro_synmeta_v1';
  // Setoran AND the cash book are migrated to REST per-record tables — their old
  // blobs (airro_setoran_v2 / airro_cashbook_v4) and local read-caches must NOT be
  // mirrored to /state, or the two paths would fight (the poll would resurrect a
  // deleted entry from a stale blob push — the exact data-loss this fixes).
  const SKIP = new Set(['airro_session_v1', 'airro_navopen_v1', 'airro_users_v1', 'airro_jwt_v1', 'airro_setoran_v2', 'airro_setoran_cache_v1', 'airro_cashbook_v4', 'airro_cashbook_cache_v1', 'airro_hrd_staff_v7', 'airro_staff_cache_v1', 'airro_cashbon_v1', 'airro_cashbon_cache_v1', 'airro_approvals_v4', 'airro_approvals_cache_v1', 'airro_calendar_v1', 'airro_calendar_cache_v1', 'airro_accounts_v2', 'airro_accounts_cache_v1', 'airro_cats_v1', 'airro_cats_cache_v1',
    'airro_settings_v1', 'airro_settings_cache_v1', 'airro_hrd_rates_v1', 'airro_hrd_rates_cache_v1', 'airro_hr_budget_v1', 'airro_hr_budget_cache_v1',
    'airro_departments_v1', 'airro_departments_cache_v1', 'airro_positions_v1', 'airro_positions_cache_v1', 'airro_projects_v3', 'airro_projects_cache_v1',
    'airro_fleet_v1', 'airro_fleet_cache_v1', 'airro_transfers_v1', 'airro_transfers_cache_v1',
    'airro_attendance_v2', 'airro_oriatt_v1', 'airro_training_v1', 'airro_empacct_v2', 'airro_roles_cache_v1',
    // Per-browser PREFERENCES — never shared via /state (or one user's choice would
    // last-write-win over everyone else's): notification read-state and UI language.
    'airro_alertread_v1', 'airro_lang', META_KEY]);
  const shouldSync = (k) => /^airro_/i.test(k) && !SKIP.has(k);

  const rawSet = localStorage.setItem.bind(localStorage);
  const rawGet = localStorage.getItem.bind(localStorage);

  // Content-equal comparison that ignores JSON property-order differences, so a
  // value re-serialized with keys in another order (React re-render, different
  // store) isn't mistaken for a real change / a dirty local edit. Object keys are
  // sorted; arrays keep their order (list order is real data). Non-JSON → exact.
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function sameJSON(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    try { return JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b))); }
    catch (e) { return a === b; }
  }

  // Per-key timestamp (client clock, ms) of the last LOCAL write, persisted so it
  // survives a refresh. Lets hydrate() tell an unsynced local edit from a stale
  // server value. (Stored under META_KEY, which is skipped from sync.)
  function loadMeta() { try { const r = rawGet(META_KEY); if (r) { const o = JSON.parse(r); if (o && typeof o === 'object') return o; } } catch (e) {} return {}; }
  const localMTime = loadMeta();
  const saveMeta = () => { try { rawSet(META_KEY, JSON.stringify(localMTime)); } catch (e) {} };

  // Last value known to be in sync with the server, per key.
  const confirmed = Object.create(null);
  const timers = {};    // debounce timer per key
  const retries = {};   // pending retry timer per key
  const attempts = {};  // consecutive failed attempts per key (for backoff)
  // "dirty" = there is a local value whose CONTENT hasn't been confirmed on the
  // server yet (tolerant of property-order-only differences).
  const isDirty = (k) => { const v = rawGet(k); return v != null && !sameJSON(v, confirmed[k]); };

  // ---- sync status (saving | saved | error) for the UI indicator ----
  let inflight = 0, hadError = false;
  function status() { return state.sessionExpired ? 'expired' : (hadError ? 'error' : (inflight > 0 || pendingKeys() ? 'saving' : 'saved')); }
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
      // Only mark clean if the content hasn't changed again during the push.
      if (sameJSON(rawGet(key), value)) confirmed[key] = value;
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
    // Small debounce: one-click saves (setoran/entry) push almost immediately,
    // while rapidly-typed inputs still collapse into a single push.
    timers[key] = setTimeout(() => { delete timers[key]; pushNow(key); }, 250);
    emit();
  }
  localStorage.setItem = function (key, value) {
    rawSet(key, value);
    if (!shouldSync(key)) return;
    // A synced write counts as a REAL local edit only when its content differs from
    // the value last confirmed in sync with the server. An ECHO write — re-persisting
    // server-received data (a React re-render / FS.save* after the poll applied it) —
    // is content-equal to `confirmed`, so it must NOT stamp localMTime or push:
    // otherwise the poll guard (timers/isDirty) would treat the key as busy and keep
    // skipping genuine remote changes for it, which then surface only on a refresh.
    // A DERIVED write that produces genuinely new data (differs from confirmed) is a
    // real change and falls through below so it IS pushed — that's how a passive
    // client's re-derived cash flow reaches the server and every other client.
    if (sameJSON(value, confirmed[key])) return;
    // Stamp the local write time even while offline, so a later hydrate can see
    // this edit is newer than the server's stale value and must not be clobbered.
    localMTime[key] = Date.now(); saveMeta();
    if (state.active) schedulePush(key);
  };

  // Server timestamp of the last pull; sent back as `since` so each poll only
  // fetches keys changed since then (incremental — cheap even at 3s).
  let lastPollAt = null;

  // ---- hydrate localStorage from the server (full snapshot) ----
  // Same protection as poll(): never overwrite a key that holds an unsynced local
  // edit. Accept the server value only when it is genuinely newer than our last
  // local write (server.updatedAt > localMTime) or when we have nothing local;
  // otherwise keep the local value and push it up.
  async function hydrate() {
    const r = await API.state.all();
    const docs = (r && r.data) || {};
    const meta = (r && r.meta) || {};
    Object.keys(docs).forEach((k) => {
      if (!shouldSync(k)) return;
      const serverVal = docs[k];
      const localVal = rawGet(k);
      if (localVal == null || sameJSON(localVal, serverVal)) {
        rawSet(k, serverVal); confirmed[k] = serverVal;   // nothing local, or same content → accept
        return;
      }
      // Values differ — decide by last-local-write vs server's updatedAt.
      const localMs = localMTime[k];
      const serverMs = meta[k] ? Date.parse(meta[k]) : NaN;
      // No local stamp (legacy data) or no server time → safe default: keep local,
      // push it up (don't risk losing an unsynced edit).
      const keepLocal = (localMs == null) || isNaN(serverMs) || (localMs > serverMs);
      if (keepLocal) {
        schedulePush(k);            // local is newer/unsynced → send it, leave localStorage as-is
      } else {
        rawSet(k, serverVal); confirmed[k] = serverVal;   // server is newer → accept it
      }
    });
    lastPollAt = (r && r.now) || lastPollAt;
  }

  // ---- poll for remote changes (near real-time, incremental) ----
  let pollTimer = null;
  async function poll() {
    if (!state.active) return;
    try {
      const r = await API.state.all(lastPollAt);   // only keys changed since last pull
      const docs = (r && r.data) || {};
      let changed = false, skipped = false;
      Object.keys(docs).forEach((k) => {
        if (!shouldSync(k)) return;
        const remoteDiffers = !sameJSON(rawGet(k), docs[k]);
        // Never clobber an unsynced local edit or a key with a push in progress —
        // wait until our own push is confirmed (confirmed[k] catches up). But if a
        // real remote change is being skipped, remember it so we DON'T advance the
        // cursor past it (else it would only reappear on a full refresh).
        if (timers[k] || retries[k] || isDirty(k)) { if (remoteDiffers) skipped = true; return; }
        if (remoteDiffers) { rawSet(k, docs[k]); confirmed[k] = docs[k]; changed = true; }
      });
      // Advance the incremental cursor ONLY when nothing was left behind; otherwise
      // keep it so the next poll re-requests the skipped change and applies it once
      // the key is free.
      if (r && r.now && !skipped) lastPollAt = r.now;
      if (changed && typeof window.CLOUD.onSync === 'function') window.CLOUD.onSync();
    } catch (e) { /* transient — try again next tick */ }
  }
  // The poll is now a SAFETY NET behind SSE (below). With the event stream healthy,
  // updates arrive in well under a second; the 5s poll only backfills anything an SSE
  // hiccup might have missed. (Was 3s when poll was the primary channel.)
  function startPoll() { if (!pollTimer) pollTimer = setInterval(poll, 5000); }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---- SSE realtime: push change notices instead of waiting for the next poll ----
  // The server broadcasts { entity, action, id } on every write. A 'state' notice
  // triggers an immediate incremental poll (near-0 latency); any other entity is
  // handed to the shell via CLOUD.onEvent so it can re-fetch that REST resource
  // (e.g. setoran). EventSource auto-reconnects; on (re)connect and on tab-focus we
  // run a full poll to close any gap while the stream was down.
  let es = null;
  function handleEvent(evt) {
    if (!evt || !evt.entity) return;
    if (evt.entity === 'state') { poll(); return; }
    if (evt.entity === 'hello') return;
    if (typeof window.CLOUD.onEvent === 'function') { try { window.CLOUD.onEvent(evt); } catch (e) {} }
  }
  function startEvents() {
    if (es || typeof window.EventSource === 'undefined') return;
    const base = (window.API && window.API.BASE) || '';
    const tok = API.getToken && API.getToken();
    if (!base || !tok) return;
    try {
      es = new EventSource(base + '/events?token=' + encodeURIComponent(tok));
      es.onopen = () => {   // catch up on connect/reconnect: pull /state AND re-fetch REST entities
        hadError = false; poll();
        if (typeof window.CLOUD.onEvent === 'function') { try { window.CLOUD.onEvent({ entity: 'focus', action: 'reconnect', id: null }); } catch (e) {} }
        emit();
      };
      es.onmessage = (m) => { let evt; try { evt = JSON.parse(m.data); } catch (e) { return; } handleEvent(evt); };
      es.onerror = () => { /* browser auto-reconnects using our retry hint */ };
    } catch (e) { es = null; }
  }
  function stopEvents() { if (es) { try { es.close(); } catch (e) {} es = null; } }

  // When the tab regains focus, run one full sync (poll + let the shell refetch its
  // REST entities) to cover events missed while the connection was asleep/offline.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !state.active) return;
      startEvents();   // reopen if the stream was dropped while hidden
      poll();
      if (typeof window.CLOUD.onEvent === 'function') { try { window.CLOUD.onEvent({ entity: 'focus', action: 'resync', id: null }); } catch (e) {} }
    });
  }

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

  // Push every local key whose CONTENT isn't confirmed on the server yet (dirty or
  // never-pushed), so all local edits go up the moment the session is active —
  // without waiting for the next manual save or a refresh.
  function flushDirty() {
    if (!state.active) return;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && shouldSync(k) && isDirty(k)) schedulePush(k);
    }
  }

  async function activate(user) {
    // Arm the session FULLY before hydrating so write-through has no dead window:
    // any local save during/after hydrate is pushed, never dropped. Identical for
    // every user, on login AND on restore/refresh.
    state.active = true;
    state.user = user;
    state.sessionExpired = false;   // fresh session — clear any prior expiry
    startPoll();
    startEvents();
    emit();
    // Hydrate the full snapshot (API.state.all — can be large: every doc incl. base64 photos)
    // in the BACKGROUND so login returns instantly instead of blocking on the whole payload.
    // The session is already armed above, so write-through has no dead window: any local save
    // made before the snapshot lands is still pushed, never dropped. When the data arrives we
    // flush dirty keys, emit, and poke the shell (onSync) so the UI re-reads its slices.
    (async () => {
      try {
        await hydrate();
      } catch (e) {
        // Server briefly unreachable → DO NOT kill the session. Poll keeps pulling
        // and the flush below queues local edits; both retry until the server is back.
        hadError = true;
        console.warn('[cloud] hydrate failed; session stays active, will retry:', e.message);
      }
      flushDirty();
      emit();
      if (typeof window.CLOUD.onSync === 'function') window.CLOUD.onSync();
    })();
    return frontendUser(user);
  }

  function frontendUser(u) {
    return { id: u.id, name: u.name, role: u.role, user: u.username, sub: u.sub,
      color: u.color || '#22A7A1', permissions: u.permissions || null, fleetScope: u.fleetScope || 'all', mustChangePassword: !!u.mustChangePassword };
  }

  function logout() {
    try { API.logout(); } catch (e) {}
    state.active = false; state.user = null; state.sessionExpired = false; stopPoll(); stopEvents();
    Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    Object.keys(retries).forEach((k) => clearTimeout(retries[k]));
  }

  // A 401 arrived while a session was active → the token expired. Stop the sync loop
  // (so we don't retry-fail silently), DROP the dead token, but KEEP every localStorage
  // key and its dirty/confirmed state so nothing is lost — on the next login,
  // activate()'s flushDirty pushes the unsynced edits up. Then tell the shell so it can
  // show a "session ended, please sign in again" prompt.
  function handleSessionExpired() {
    if (state.sessionExpired) return;                 // fire once
    state.sessionExpired = true;
    state.active = false;                             // pushes pause; local data + confirmed[] stay intact
    hadError = true;
    stopPoll(); stopEvents();
    Object.keys(timers).forEach((k) => { clearTimeout(timers[k]); delete timers[k]; });
    Object.keys(retries).forEach((k) => { clearTimeout(retries[k]); delete retries[k]; });
    try { API.setToken(null); } catch (e) {}          // drop the expired JWT (localStorage data untouched)
    emit();
    if (typeof window.CLOUD.onSessionExpired === 'function') { try { window.CLOUD.onSessionExpired(); } catch (e) {} }
  }
  // Any non-login 401 (routed here from api.js) means the token is no longer valid —
  // but only SURFACE it while a session is active. During restore() (before activate)
  // a 401 on /auth/me just means "no valid session", handled quietly there.
  API.onUnauthorized = () => { if (state.active) handleSessionExpired(); };

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
    get sessionExpired() { return state.sessionExpired; },
    login, logout, restore, activate, frontendUser,
    onSync: null,     // set by the app shell to re-read slices on remote change
    onStatus: null,   // set by the app shell to show a saving/saved/error indicator
    onEvent: null,    // set by the app shell to react to a non-state SSE entity notice
    onSessionExpired: null,  // set by the app shell to prompt a re-login on token expiry
  };
})();
