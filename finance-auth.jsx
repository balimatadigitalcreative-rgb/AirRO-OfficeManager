/* global React, FS */
const { useState: uSa, useEffect: uEa } = React;
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
  const cls = role === 'owner' ? 'rb-owner' : role === 'manager' ? 'rb-mgr' : 'rb-cashier';
  return <span className={`role-badge ${cls} ${size === 'sm' ? 'sm' : ''}`}><IconShield s={size === 'sm' ? 11 : 13} />{trA('role.' + role)}</span>;
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

window.AUTH = { LoginScreen, RoleBadge, LangToggle, ChangePassword };
