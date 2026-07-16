/* global React, FS, ReactDOM */
const { useState: uSa, useEffect: uEa, useRef: uRa } = React;
const trA = (k, v) => window.t(k, v);
function IcA(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

function LangToggle({ lang, onLang }) {
  return (
    <div className="lang-toggle">
      {['en', 'id'].map((l) => (
        <button key={l} className={`lang-btn ${lang === l ? 'on' : ''}`} onClick={() => onLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

function RoleBadge({ role, size }) {
  const cls = role === 'owner' ? 'rb-owner' : (role === 'gm' || role === 'manager') ? 'rb-mgr' : 'rb-cashier';
  // Role names are dynamic (custom roles have no i18n key) — read the live name from
  // the store, falling back to the i18n label for the built-ins.
  const name = (window.FS && FS.roleName) ? FS.roleName(role) : trA('role.' + role);
  return <span className={`role-badge ${cls} ${size === 'sm' ? 'sm' : ''}`}><IconShield s={size === 'sm' ? 11 : 13} />{name}</span>;
}

/* Change-password form — used both self-service (modal) and forced-on-login.
   Forced mode hides the old-password field (uses the just-entered login password)
   and removes the cancel affordance until a new password is set. */
function ChangePassword({ forced, prefillOld, onDone, onClose }) {
  const [oldP, setOldP] = uSa(prefillOld || '');
  const [newP, setNewP] = uSa('');
  const [conf, setConf] = uSa('');
  const [show, setShow] = uSa(false);
  const [err, setErr] = uSa('');
  const [busy, setBusy] = uSa(false);
  uEa(() => { if (!forced) { const o = (e) => e.key === 'Escape' && onClose && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); } }, []);
  const min8 = newP.length >= 8;
  const match = newP === conf;
  const valid = (forced || oldP.length >= 1) && min8 && match && !busy;
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!valid) return;
    setBusy(true); setErr('');
    try { await window.API.auth.changePassword(oldP, newP); setBusy(false); onDone && onDone(); }
    catch (ex) { setBusy(false); setErr((ex && ex.body && ex.body.error && ex.body.error.message) || trA('pw.failGeneric')); }
  };
  return (
    <div className="modal-scrim" onClick={forced ? undefined : onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }} onSubmit={submit}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 700 }}>{forced ? trA('pw.forcedTitle') : trA('pw.change')}</div>
          {!forced && <button type="button" className="jp-icon" onClick={onClose}><IconClose s={18} /></button>}
        </div>
        <div className="modal-body">
          {forced && <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 10 }}>{trA('pw.forcedSub')}</div>}
          {!forced && (<>
            <label className="fld-label" style={{ marginTop: 0 }}>{trA('pw.old')}</label>
            <input className="fld" type="password" value={oldP} autoFocus onChange={(e) => { setOldP(e.target.value); setErr(''); }} />
          </>)}
          <label className="fld-label" style={forced ? { marginTop: 0 } : {}}>{trA('pw.new')}</label>
          <div className="login-field" style={{ margin: 0 }}>
            <IconLock s={18} />
            <input type={show ? 'text' : 'password'} value={newP} autoFocus={forced} placeholder={trA('pw.min')} onChange={(e) => { setNewP(e.target.value); setErr(''); }} />
            <button type="button" className="login-eye" onClick={() => setShow(!show)}>{show ? trA('login.hide') : trA('login.showpw')}</button>
          </div>
          {newP && !min8 && <div style={{ fontSize: 11.5, color: 'var(--neg)', marginTop: 4 }}>{trA('pw.min')}</div>}
          <label className="fld-label">{trA('pw.confirm')}</label>
          <input className="fld" type={show ? 'text' : 'password'} value={conf} onChange={(e) => { setConf(e.target.value); setErr(''); }} />
          {conf && !match && <div style={{ fontSize: 11.5, color: 'var(--neg)', marginTop: 4 }}>{trA('pw.mismatch')}</div>}
          {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={14} />{err}</div>}
        </div>
        <div className="modal-foot">
          {!forced && <button type="button" className="btn btn-ghost" onClick={onClose}>{trA('common.cancel') || 'Cancel'}</button>}
          <button type="submit" className="btn btn-primary" disabled={!valid}>{busy ? '…' : trA('pw.save')}</button>
        </div>
      </form>
    </div>
  );
}

function LoginScreen({ onLogin, lang, onLang }) {
  const [username, setUsername] = uSa('');
  const [password, setPassword] = uSa('');
  const [err, setErr] = uSa(false);
  const [errText, setErrText] = uSa('');
  const [show, setShow] = uSa(false);
  const [forceUser, setForceUser] = uSa(null);   // {cu, pw} when the account must set a new password

  const [busy, setBusy] = uSa(false);
  const badMsg = () => trA('login.bad');
  const offlineMsg = () => (window.I18N && window.I18N.lang === 'id')
    ? 'Tidak dapat terhubung ke server. Coba lagi nanti.'
    : 'Cannot reach the server. Please try again later.';
  const fail = (text) => { setErrText(text || badMsg()); setErr(true); setTimeout(() => setErr(false), 2500); };
  // Authentication is backend-only — no local/PIN fallback (public deployment).
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy) return;
    if (!window.CLOUD) { fail(offlineMsg()); return; }
    setBusy(true);
    try {
      const cu = await window.CLOUD.login(username.trim(), password);
      setBusy(false);
      if (cu) {
        if (cu.mustChangePassword) { setForceUser({ cu, pw: password }); return; }   // must set a new password first
        onLogin(cu); return;             // signed in via backend
      }
      fail(offlineMsg());                // null → backend unreachable
    } catch (err) {
      setBusy(false);
      fail(badMsg());                    // backend reachable but rejected the credentials
    }
  };

  return (
    <div className="login-stage">
      <div className="login-hero">
        <div className="login-hero-top">
          <div className="lh-brand"><Logo s={34} /><span className="lh-brandname">AirRO<b> Reverse Osmosis</b></span></div>
          <LangToggle lang={lang} onLang={onLang} />
        </div>
        <div className="login-hero-mid">
          <h1 className="lh-title">{trA('login.heroTitle')}<span style={{ color: 'var(--lime-500)' }}>.</span></h1>
          <div className="lh-sub">{trA('login.heroSub')}</div>
          <p className="lh-desc">{trA('login.heroDesc')}</p>
          <div className="lh-feats">
            <span className="lh-feat"><IconDrop s={16} />{trA('login.f1')}</span>
            <span className="lh-feat"><IconTruck s={16} />{trA('login.f2')}</span>
            <span className="lh-feat"><IconReport s={16} />{trA('login.f3')}</span>
          </div>
        </div>
        <div className="login-hero-foot">{trA('login.tagline')}</div>
        <span className="lh-wave lh-wave1" /><span className="lh-wave lh-wave2" /><span className="lh-drop" aria-hidden="true"><IconDrop s={120} /></span>
      </div>

      <div className="login-card">
        <div className="login-brand">
          <Logo s={36} />
          <div style={{ flex: 1 }}>
            <div className="lb-name">AirRO</div>
            <div className="lb-desc">Reverse Osmosis</div>
          </div>
        </div>

        <form className="screen-enter" onSubmit={submit}>
          <div className="login-title">{trA('login.signin')}</div>
          <div className="login-sub">{trA('login.signinSub')}</div>

          <label className="fld-label">{trA('login.username')}</label>
          <div className={`login-field ${err ? 'err' : ''}`}>
            <IconUserCircle s={18} />
            <input value={username} autoFocus placeholder={trA('login.usernamePh')} onChange={(e) => { setUsername(e.target.value); setErr(false); }} />
          </div>
          <div className="login-hint">{trA('login.usernameCI')}</div>

          <label className="fld-label">{trA('login.password')}</label>
          <div className={`login-field ${err ? 'err' : ''}`}>
            <IconLock s={18} />
            <input type={show ? 'text' : 'password'} value={password} placeholder={trA('login.passwordPh')} onChange={(e) => { setPassword(e.target.value); setErr(false); }} />
            <button type="button" className="login-eye" onClick={() => setShow(!show)}>{show ? trA('login.hide') : trA('login.showpw')}</button>
          </div>

          {err && <div className="login-err"><IconClose s={14} />{errText}</div>}

          <button type="submit" className="login-submit" disabled={busy}>{busy ? '…' : trA('login.login')}</button>
        </form>
      </div>
      {forceUser && <ChangePassword forced prefillOld={forceUser.pw} onDone={() => onLogin({ ...forceUser.cu, mustChangePassword: false })} />}
    </div>
  );
}

/* Avatar → floating profile menu. Anchored (position:fixed) to the topbar avatar,
   portaled to <body> so no ancestor clips it, right-aligned + clamped to the viewport,
   backdrop tap-to-close — the same pattern as the dropdown/date pickers. Sub-views
   (Profil Saya, Notifikasi, Aktivitas) render inline within the same floating card.
   A user can edit only their display name + avatar colour here; role / permissions
   stay under HRD/owner control (never exposed in this menu). */
const PM_AV_COLORS = ['#22A7A1', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#475569'];

const PM_ACT_META = { entry: { icon: 'IconTx', k: 'pm.act.entry' }, kasbon: { icon: 'IconWallet', k: 'pm.act.kasbon' }, approval: { icon: 'IconInvoice', k: 'pm.act.approval' }, employee: { icon: 'IconCustomers', k: 'pm.act.employee' } };
// compact "x mnt/jam/hr lalu" from a ms timestamp (browser-side; falls back to the date)
function pmAgo(when, date) {
  if (!when) return date || '';
  const s = Math.max(0, (Date.now() - when) / 1000);
  if (s < 60) return trA('pm.ago.now');
  if (s < 3600) return trA('pm.ago.m', { n: Math.floor(s / 60) });
  if (s < 86400) return trA('pm.ago.h', { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return trA('pm.ago.d', { n: Math.floor(s / 86400) });
  return date || '';
}
const pmMoney = (n) => (window.FIN && FIN.fmt) ? FIN.fmt(Math.abs(n)) : String(Math.abs(n));

function ProfileMenu({ user, lang, onLang, alerts, activity, onChangePassword, onLogout, onNavigate, shortcuts, onUpdateProfile }) {
  const [open, setOpen] = uSa(false);
  const [view, setView] = uSa('menu');            // 'menu' | 'profile' | 'notif' | 'activity'
  const [pos, setPos] = uSa(null);                // fixed coords from the avatar
  const btnRef = uRa(null);
  const list = alerts || [];
  // Read-state for the (derived) alerts: ids marked read are muted + drop off the
  // unread badge until a genuinely new alert id appears. Persisted per-browser.
  const [readIds, setReadIds] = uSa(() => { try { return new Set(JSON.parse(localStorage.getItem('airro_alertread_v1') || '[]')); } catch (e) { return new Set(); } });
  const unread = list.filter((a) => !readIds.has(a.id));
  const hi = unread.some((a) => a.level === 'high');
  const markAllRead = () => { const s = new Set(readIds); list.forEach((a) => s.add(a.id)); setReadIds(s); try { localStorage.setItem('airro_alertread_v1', JSON.stringify([...s])); } catch (e) {} };
  // profile-edit local state
  const [pName, setPName] = uSa(user.name || '');
  const [pColor, setPColor] = uSa(user.color || PM_AV_COLORS[0]);
  const [saving, setSaving] = uSa(false);
  const [pErr, setPErr] = uSa('');
  const dirty = pName.trim() !== (user.name || '') || pColor !== (user.color || '');
  const initials = window.FS ? FS.initials(user.name) : '';

  const place = () => {
    const el = btnRef.current; if (!el) return;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = el.getBoundingClientRect();
    const M = 8;
    const W = Math.min(304, window.innerWidth - M * 2) * zoom;
    const vw = window.innerWidth * zoom, vh = window.innerHeight * zoom;
    let left = Math.min(r.right - W, vw - W - M); left = Math.max(M, left);   // right-align to the avatar
    const top = r.bottom + 6;
    const maxH = vh - top - M;                        // keep the card fully on-screen (scrolls inside)
    setPos({ left: left / zoom, top: top / zoom, width: W / zoom, maxH: maxH / zoom });
  };
  uEa(() => {
    if (!open) { setPos(null); return; }
    place();
    const on = () => place();
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', on); window.addEventListener('scroll', on, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); window.removeEventListener('keydown', esc); };
  }, [open, view]);

  const openMenu = () => { setView('menu'); setPName(user.name || ''); setPColor(user.color || PM_AV_COLORS[0]); setPErr(''); setOpen(true); };
  const close = () => setOpen(false);
  const act = (fn) => { close(); fn(); };
  const saveProfile = async () => {
    if (saving) return;
    const name = pName.trim();
    if (!name) { setPErr(trA('pm.nameReq')); return; }
    setSaving(true); setPErr('');
    try { await onUpdateProfile({ name, color: pColor }); setSaving(false); setView('menu'); }
    catch (ex) { setSaving(false); setPErr((ex && ex.body && ex.body.error && ex.body.error.message) || trA('pm.saveErr')); }
  };
  const Caret = (dir) => <IconCaret s={14} style={{ transform: dir === 'right' ? 'rotate(-90deg)' : 'rotate(90deg)', opacity: .5, flexShrink: 0 }} />;
  const Back = () => <button type="button" className="pm-back" onClick={() => setView('menu')}>{Caret('left')}{trA('pm.back')}</button>;

  return (
    <div className="pm-wrap">
      <button type="button" ref={btnRef} className="avatar pm-av" title={user.name} style={{ background: user.color, color: '#fff' }} onClick={() => (open ? close() : openMenu())}>
        {initials}
        {unread.length > 0 && <span className={`pm-avdot ${hi ? 'high' : ''}`} />}
      </button>
      {open && ReactDOM.createPortal(
        <React.Fragment>
          <div className="pop-cal-backdrop dd-back" onClick={close} />
          <div className="pm-menu scroll-y" style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH } : { visibility: 'hidden' }}>
            <div className="pm-head">
              <span className="user-av lg" style={{ background: user.color }}>{initials}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="pm-name" title={user.name}>{user.name}</div>
                <div style={{ marginTop: 3 }}><RoleBadge role={user.role} size="sm" /></div>
                {(user.user || user.username) && <div className="pm-username">@{user.user || user.username}</div>}
              </div>
            </div>

            {view === 'menu' && (
              <div className="pm-list">
                <button type="button" className="pm-item" onClick={() => setView('profile')}><span className="pm-ic"><IconUserCircle s={18} /></span><span className="pm-lbl">{trA('pm.profile')}</span>{Caret('right')}</button>
                <button type="button" className="pm-item" onClick={() => act(onChangePassword)}><span className="pm-ic"><IconLock s={18} /></span><span className="pm-lbl">{trA('pm.password')}</span></button>
                <button type="button" className="pm-item" onClick={() => setView('notif')}><span className="pm-ic"><IconBell s={18} /></span><span className="pm-lbl">{trA('pm.notif')}</span>{unread.length > 0 && <span className={`pm-count ${hi ? 'high' : ''}`}>{unread.length}</span>}{Caret('right')}</button>
                <button type="button" className="pm-item" onClick={() => setView('activity')}><span className="pm-ic"><IconClock s={18} /></span><span className="pm-lbl">{trA('pm.activity')}</span>{Caret('right')}</button>
                <div className="pm-row"><span className="pm-ic"><IconChat s={18} /></span><span className="pm-lbl">{trA('pm.lang')}</span><LangToggle lang={lang} onLang={onLang} /></div>
                {shortcuts && shortcuts.length > 0 && <div className="pm-sep" />}
                {(shortcuts || []).map((s) => (
                  <button type="button" key={s.id} className="pm-item" onClick={() => act(() => onNavigate(s.id))}><span className="pm-ic">{IcA(s.icon, { s: 18 })}</span><span className="pm-lbl">{s.label}</span>{Caret('right')}</button>
                ))}
                <div className="pm-sep" />
                <button type="button" className="pm-item pm-danger" onClick={() => act(onLogout)}><span className="pm-ic"><IconLogout s={18} /></span><span className="pm-lbl">{trA('pm.logout')}</span></button>
              </div>
            )}

            {view === 'profile' && (
              <div className="pm-panel">
                <Back />
                <div className="pm-preview"><span className="user-av lg" style={{ background: pColor }}>{FS.initials(pName || user.name)}</span></div>
                <label className="fld-label" style={{ marginTop: 4 }}>{trA('pm.dispName')}</label>
                <input className="fld" value={pName} maxLength={120} onChange={(e) => { setPName(e.target.value); setPErr(''); }} />
                <label className="fld-label">{trA('pm.avColor')}</label>
                <div className="pm-swatches">
                  {PM_AV_COLORS.map((c) => (
                    <button type="button" key={c} className={`pm-sw ${c === pColor ? 'on' : ''}`} style={{ background: c }} onClick={() => setPColor(c)}>{c === pColor && <IconCheck s={14} />}</button>
                  ))}
                </div>
                <div className="pm-note">{trA('pm.selfNote')}</div>
                {pErr && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={13} />{pErr}</div>}
                <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={!dirty || saving} onClick={saveProfile}>{saving ? '…' : trA('pm.save')}</button>
              </div>
            )}

            {view === 'notif' && (
              <div className="pm-panel">
                <div className="pm-panel-bar"><Back />{unread.length > 0 && <button type="button" className="pm-txtbtn" onClick={markAllRead}>{trA('pm.markRead')}</button>}</div>
                <div className="pm-panel-title">{trA('al.title')} {list.length > 0 && <span className="tnum">({list.length})</span>}</div>
                {list.length === 0 && <div className="alert-empty"><IconCheck s={16} />{trA('al.allgood')}</div>}
                {list.map((a) => (
                  <div key={a.id} className={`alert-item ${a.level} ${readIds.has(a.id) ? 'pm-read' : ''}`}>
                    <span className="alert-ic">{IcA(a.icon, { s: 18 })}</span>
                    <div style={{ minWidth: 0 }}><div className="alert-title">{a.title}</div><div className="alert-msg">{a.msg}</div></div>
                  </div>
                ))}
              </div>
            )}

            {view === 'activity' && (
              <div className="pm-panel">
                <Back />
                <div className="pm-panel-title">{trA('pm.activity')}{activity && activity.length > 0 && <span className="tnum"> ({activity.length})</span>}</div>
                {/* The user's own recent creations, attributed by stable identity
                    (createdById) — see finance-shell myActivity. */}
                {(!activity || activity.length === 0) ? (
                  <div className="pm-activity-empty">
                    <span className="pm-ae-ic"><IconClock s={24} /></span>
                    <div className="pm-ae-title">{trA('pm.actNoneTitle')}</div>
                    <div className="pm-ae-sub">{trA('pm.actNoneSub')}</div>
                  </div>
                ) : activity.map((it) => {
                  const m = PM_ACT_META[it.kind] || PM_ACT_META.entry;
                  return (
                    <div key={it.kind + it.id} className="pm-act">
                      <span className="pm-act-ic">{IcA(m.icon, { s: 16 })}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="pm-act-title">{it.title}</div>
                        <div className="pm-act-sub">{trA(m.k)}{it.date ? ' · ' + pmAgo(it.when, it.date) : ''}</div>
                      </div>
                      {it.amount ? <span className={`pm-act-amt ${it.amount < 0 ? 'neg' : 'pos'}`}>{it.amount < 0 ? '−' : '+'}{pmMoney(it.amount)}</span> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </React.Fragment>, document.body)}
    </div>
  );
}

window.AUTH = { LoginScreen, RoleBadge, LangToggle, ChangePassword, ProfileMenu };
