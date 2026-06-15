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

function LoginScreen({ onLogin, lang, onLang }) {
  const [username, setUsername] = uSa('');
  const [password, setPassword] = uSa('');
  const [err, setErr] = uSa(false);
  const [errText, setErrText] = uSa('');
  const [show, setShow] = uSa(false);

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
      if (cu) { onLogin(cu); return; }   // signed in via backend
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
    </div>
  );
}

window.AUTH = { LoginScreen, RoleBadge, LangToggle };
