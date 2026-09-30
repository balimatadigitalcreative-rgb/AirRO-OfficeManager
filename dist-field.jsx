/* MODE LAPANGAN — the new phone UI for delivery staff (demo until the owner releases it). This file
   holds the shell (header, MODE LATIHAN ribbon, mode switch, glass dock + Catat menu) and the owner's
   Aturan lapangan & armada screen. The full screens (mockup) arrive in the next plan; until then the
   Pengiriman tab lists the day's stops so both modes can be tried end to end. Every read/write goes
   through ONE adaptor (FIELDAPI): real = the server, latihan = this phone only.
   The bundle shares one scope across files, so every top-level name here is unique (Fld*, *fl). */
const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;
const trFl = (k, v) => window.t(k, v);
const fldPlates = (list) => (list || []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean);
const fldErrMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || '';
const FldIco = (name, s) => { const C = window[name]; return C ? <C s={s || 20} /> : null; };
// Releasing makes this the main view for EVERY field account. Locked until the full field screens
// (Plan 3) replace the foundation stub; flip to true then. Un-releasing is always allowed.
const FLD_SCREENS_READY = false;

function FldSheet({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mlap-grab" />
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="mlap-actions">
          <button type="button" className="mlap-btn" onClick={onClose}>{trFl('fld.cancel')}</button>
          <button type="button" className={'mlap-btn ' + (danger ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel || trFl('fld.confirm')}</button>
        </div>
      </div>
    </>
  );
}

function FldApp({ user, pref, today, fleetList, fleetScope, refreshKey, onExit, onPref, onOpenRules }) {
  const mode = pref.mode;
  const scope = Array.isArray(fleetScope) ? fleetScope : null;
  const fleets = scope || fldPlates(fleetList);
  const [fleet, setFleet] = uSfl(fleets[0] || '');
  const [api, setApi] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [tab, setTab] = uSfl('kirim');
  const [menu, setMenu] = uSfl(false);
  const [catat, setCatat] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [toast, setToast] = uSfl('');
  const [tick, setTick] = uSfl(0);
  const storageRef = uRfl(null);
  const key = 'latihan:' + ((user && user.id) || 'anon') + ':' + (fleet || '');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };
  uEfl(() => {
    let live = true; setApi(null); setErr(null);
    const real = window.FIELDAPI.real(window.API, { date: today, fleet });
    if (mode === 'asli') { setApi(real); return () => { live = false; }; }
    if (!storageRef.current) storageRef.current = window.indexedDB ? window.FIELDAPI.idbStorage() : window.FIELDAPI.memoryStorage();
    window.FIELDAPI.openLatihan({ key, real, storage: storageRef.current, today })
      .then((a) => { if (live) setApi(a); })
      .catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [mode, fleet, today, tick]);

  const askSwitch = (to) => setAsk({
    title: to === 'asli' ? trFl('fld.switchToAsliT') : trFl('fld.switchToLatihanT'),
    body: to === 'asli' ? trFl('fld.switchToAsliB') : trFl('fld.switchToLatihanB'),
    danger: to === 'asli',
    run: () => { onPref({ mode: to }); setMenu(false); },
  });
  const askReset = () => setAsk({
    title: trFl('fld.resetLatihanT'), body: trFl('fld.resetLatihanB'), danger: true,
    run: () => { Promise.resolve(api && api.reset && api.reset()).then(() => { setMenu(false); setTick((t) => t + 1); flash(trFl('fld.resetDone')); }); },
  });

  const TABS = [['kirim', 'IconTruck'], ['peta', 'IconPin'], null, ['pelanggan', 'IconCustomers'], ['setoran', 'IconWallet']];
  const TAB_LABEL = { kirim: 'fld.tabKirim', peta: 'fld.tabPeta', pelanggan: 'fld.tabPelanggan', setoran: 'fld.tabSetoran' };
  const ACTIONS = ['catatSale', 'catatBon', 'catatExp', 'catatStop', 'catatAdj', 'catatDmg'];

  return (
    <div className="mlap-root">
      {mode === 'latihan' && <div className="mlap-ribbon" role="status">{trFl('fld.bannerLatihan')}</div>}
      <div className="mlap-head">
        <h1>{trFl(TAB_LABEL[tab])}</h1>
        <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={() => setMenu(true)}>{FldIco('IconDots', 20)}</button>
      </div>
      <div className="mlap-eyebrow mlap-meta">
        <span>{today}</span>
        <span className={'mlap-chip ' + mode}>{mode === 'latihan' ? trFl('fld.modeLatihan') : trFl('fld.modeAsli')}</span>
        {fleets.length > 1 ? (
          <span className="mlap-chip">
            <select value={fleet} onChange={(e) => setFleet(e.target.value)} aria-label={trFl('fld.pickFleet')}>
              {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </span>
        ) : <span className="mlap-chip">{fleet || '—'}</span>}
      </div>

      <div className="mlap-body">
        {err && (
          <div className="mlap-err" role="alert">
            <b>{err.offline ? trFl('fld.offline') : trFl('fld.loadErr')}</b>
            <span>{fldErrMsg(err)}</span>
            <button type="button" className="mlap-btn" onClick={() => setTick((t) => t + 1)}>{trFl('fld.retry')}</button>
          </div>
        )}
        {!err && api && api.persisted === false && <div className="mlap-err" role="status">{trFl('fld.noStore')}</div>}
        {!err && !api && <div className="mlap-empty">{trFl('fld.loading')}</div>}
        {!err && api && tab === 'kirim' && <FldBoard api={api} refreshKey={mode === 'asli' ? refreshKey : 0} />}
        {!err && api && tab !== 'kirim' && <div className="mlap-card"><div className="mlap-empty">{trFl('fld.soon')}</div></div>}
      </div>

      <nav className="mlap-dock" aria-label={trFl('fld.nav')}>
        {TABS.map((t, i) => (t ? (
          <button key={t[0]} type="button" className={'mlap-tab' + (tab === t[0] ? ' on' : '')} aria-current={tab === t[0] ? 'page' : undefined} onClick={() => setTab(t[0])}>
            {FldIco(t[1], 20)}<span>{trFl(TAB_LABEL[t[0]])}</span>
          </button>
        ) : <span key={'gap' + i} aria-hidden="true" />))}
      </nav>
      <button type="button" className={'mlap-catat' + (catat ? ' open' : '')} aria-label={trFl('fld.tabCatat')} aria-expanded={catat} onClick={() => setCatat(!catat)}>{FldIco('IconPlus', 24)}</button>
      {catat && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setCatat(false)} />
          <div className="mlap-catat-menu" role="menu" aria-label={trFl('fld.catatTitle')}>
            <div className="mlap-eyebrow" style={{ padding: '2px 6px 8px' }}>{trFl('fld.catatTitle')}</div>
            <div className="mlap-catat-grid">
              {ACTIONS.map((a, i) => <button key={a} type="button" role="menuitem" className="mlap-tile" disabled style={{ animationDelay: (70 + i * 40) + 'ms' }} title={trFl('fld.soon')}>{trFl('fld.' + a)}</button>)}
            </div>
          </div>
        </>
      )}

      {menu && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setMenu(false)} />
          <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={trFl('fld.menu')}>
            <div className="mlap-grab" />
            <h2>{trFl('fld.menu')}</h2>
            {pref.canAsli && pref.canLatihan && (mode === 'latihan'
              ? <button type="button" className="mlap-menu-item" onClick={() => askSwitch('asli')}>{trFl('fld.useAsli')}</button>
              : <button type="button" className="mlap-menu-item" onClick={() => askSwitch('latihan')}>{trFl('fld.useLatihan')}</button>)}
            {mode === 'latihan' && api && <button type="button" className="mlap-menu-item" onClick={askReset}>{trFl('fld.resetLatihan')}</button>}
            {onOpenRules && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onOpenRules(); }}>{trFl('fld.rules')}</button>}
            <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onExit(); }}>{trFl('fld.backOld')}</button>
          </div>
        </>
      )}
      {ask && <FldSheet title={ask.title} body={ask.body} danger={ask.danger} onClose={() => setAsk(null)} onConfirm={() => { const r = ask.run; setAsk(null); r(); }} />}
      {toast && <div className="mlap-toast" role="status">{toast}</div>}
    </div>
  );
}

// Temporary Pengiriman list (both modes) — replaced by the full board in the next plan.
function FldBoard({ api, refreshKey }) {
  const [rows, setRows] = uSfl(null);
  const [err, setErr] = uSfl(null);
  uEfl(() => {
    let live = true;
    api.board().then((r) => { if (live) { setRows(r || []); setErr(null); } }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, refreshKey]);
  if (err) return <div className="mlap-err" role="alert">{fldErrMsg(err) || trFl('fld.loadErr')}</div>;
  if (!rows) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  if (!rows.length) return <div className="mlap-card"><div className="mlap-empty">{trFl('fld.emptyBoard')}</div></div>;
  return (
    <div className="mlap-card">
      {rows.map((s, i) => (
        <div key={s.id} className="mlap-row">
          <span className="mlap-num">{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}><span className="nm">{s.customerName}</span><br /><span className="sb">{[s.customerCode, s.pendingReason].filter(Boolean).join(' · ')}</span></span>
          <span className={'mlap-tag ' + s.status}>{trFl('fld.st_' + s.status)}</span>
        </div>
      ))}
    </div>
  );
}

// ATURAN LAPANGAN & ARMADA (owner/GM). ALWAYS the real rules — never the practice copy — and through
// the untagged owner API, so an owner without Demo penuh can still save them. Capacity is a merge on
// the server (0 = no limit), so every armada shown or previously limited is sent explicitly.
function FldRules({ fleetList, canRelease, onSaved }) {
  const [r, setR] = uSfl(null);
  const [err, setErr] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [done, setDone] = uSfl('');
  const loadedCap = uRfl({});   // the limits the server had, so a limit removed here is cleared there
  const plates = fldPlates(fleetList);
  const got = (d) => { loadedCap.current = Object.assign({}, d.fleetCapacity); setR(d); };
  const load = () => { setErr(''); window.API.distribusi.fieldRules.get().then((x) => got(x.data)).catch((e) => setErr(fldErrMsg(e) || trFl('fld.loadErr'))); };
  uEfl(load, []);
  if (!r) {
    return (
      <div className="mlap-root"><div className="mlap-body">
        {err ? <div className="mlap-err" role="alert">{err}<button type="button" className="mlap-btn" onClick={load}>{trFl('fld.retry')}</button></div> : <div className="mlap-empty">{trFl('fld.loading')}</div>}
      </div></div>
    );
  }
  const set = (patch) => setR(Object.assign({}, r, patch));
  const setSop = (patch) => set({ ritSop: Object.assign({}, r.ritSop, patch) });
  const cap = (p) => r.fleetCapacity[p] || 0;
  const setCap = (p, v) => { const fc = Object.assign({}, r.fleetCapacity); const n = Math.max(0, Math.min(10000, Math.round(v))); if (n) fc[p] = n; else delete fc[p]; set({ fleetCapacity: fc }); };
  const save = (patch) => {
    setBusy(true); setErr('');
    let body = patch;
    if (!body) {
      const fc = {};
      plates.forEach((p) => { fc[p] = r.fleetCapacity[p] || 0; });
      Object.keys(r.fleetCapacity).forEach((p) => { fc[p] = r.fleetCapacity[p]; });
      Object.keys(loadedCap.current).forEach((p) => { if (!(p in fc)) fc[p] = 0; });
      body = { ritSop: r.ritSop, fleetCapacity: fc, wajibFotoTransaksi: !!r.wajibFotoTransaksi, wajibFotoPengeluaran: !!r.wajibFotoPengeluaran, wajibAlasanBatal: !!r.wajibAlasanBatal, hargaGantiRugiGalon: r.hargaGantiRugiGalon || 0 };
    }
    window.API.distribusi.fieldRules.set(body)
      .then((x) => { got(x.data); setDone(trFl('fld.saved')); setTimeout(() => setDone(''), 2400); if (onSaved) onSaved(x.data); })
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  const toggle = (k, label) => (
    <label className="mlap-field"><span className="lb">{label}</span>
      <input type="checkbox" checked={!!r[k]} onChange={(e) => set({ [k]: e.target.checked })} /></label>
  );
  return (
    <div className="mlap-root">
      <div className="mlap-head"><h1>{trFl('fld.rulesTitle')}</h1></div>
      <div className="mlap-eyebrow">{trFl('fld.rulesSub')}</div>
      <div className="mlap-body">
        <div className="mlap-note">{trFl('fld.rulesAsliNote')}</div>
        <div className="mlap-card">
          <label className="mlap-field"><span className="lb">{trFl('fld.sopEnabled')}</span><input type="checkbox" checked={!!r.ritSop.enabled} onChange={(e) => setSop({ enabled: e.target.checked })} /></label>
          <div className="mlap-field"><span className="lb">{trFl('fld.sopMin')}</span>
            <button type="button" className="mlap-step" aria-label={trFl('fld.less')} onClick={() => setSop({ minLoad: Math.max(1, r.ritSop.minLoad - 5) })}>−</button>
            <span className="mlap-stepval">{r.ritSop.minLoad}</span>
            <button type="button" className="mlap-step" aria-label={trFl('fld.more')} onClick={() => setSop({ minLoad: r.ritSop.minLoad + 5 })}>+</button></div>
        </div>
        <div className="mlap-eyebrow" style={{ padding: '4px 4px 0' }}>{trFl('fld.capTitle')}</div>
        <div className="mlap-card">
          {plates.map((p) => (
            <div key={p}>
              <div className="mlap-field"><span className="lb">{p}<span className="ht">{cap(p) ? cap(p) + ' ' + trFl('fld.galon') : trFl('fld.capNone')}</span></span>
                <button type="button" className="mlap-step" aria-label={trFl('fld.less') + ' ' + p} onClick={() => setCap(p, cap(p) - 5)}>−</button>
                <span className="mlap-stepval">{cap(p) || '—'}</span>
                <button type="button" className="mlap-step" aria-label={trFl('fld.more') + ' ' + p} onClick={() => setCap(p, (cap(p) || r.ritSop.minLoad) + 5)}>+</button></div>
              {cap(p) > 0 && cap(p) < r.ritSop.minLoad && <div className="mlap-warnline">{trFl('fld.capBelowSop')}</div>}
            </div>
          ))}
          {!plates.length && <div className="mlap-empty">{trFl('fld.noFleet')}</div>}
        </div>
        <div className="mlap-card">
          {toggle('wajibFotoTransaksi', trFl('fld.fotoTxn'))}
          {toggle('wajibFotoPengeluaran', trFl('fld.fotoExp'))}
          {toggle('wajibAlasanBatal', trFl('fld.alasanBatal'))}
          <label className="mlap-field"><span className="lb">{trFl('fld.hargaGR')}</span>
            <input className="mlap-input" inputMode="numeric" value={r.hargaGantiRugiGalon || ''} onChange={(e) => set({ hargaGantiRugiGalon: +String(e.target.value).replace(/[^0-9]/g, '') || 0 })} /></label>
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary" disabled={busy} onClick={() => save()}>{trFl('fld.save')}</button>
        {canRelease && (
          <div className="mlap-card mlap-release">
            <b>{trFl('fld.releaseTitle')}</b>
            <small>{r.fieldUiDefault === 'new' ? trFl('fld.released') : trFl('fld.releaseSub')}</small>
            {r.fieldUiDefault === 'new'
              ? <button type="button" className="mlap-btn" disabled={busy} onClick={() => setAsk('old')}>{trFl('fld.unreleaseBtn')}</button>
              : <button type="button" className="mlap-btn danger" disabled={busy || !FLD_SCREENS_READY} onClick={() => setAsk('new')}>{trFl('fld.releaseBtn')}</button>}
            {r.fieldUiDefault !== 'new' && !FLD_SCREENS_READY && <small>{trFl('fld.releaseLater')}</small>}
          </div>
        )}
      </div>
      {ask && <FldSheet title={ask === 'new' ? trFl('fld.releaseT') : trFl('fld.unreleaseT')} body={ask === 'new' ? trFl('fld.releaseB') : trFl('fld.unreleaseB')} danger={ask === 'new'} onClose={() => setAsk(null)} onConfirm={() => { const v = ask; setAsk(null); save({ fieldUiDefault: v }); }} />}
      {done && <div className="mlap-toast" role="status">{done}</div>}
    </div>
  );
}

window.FIELD = { App: FldApp, RulesScreen: FldRules };
