/* MODE LAPANGAN — the new phone UI for delivery staff (demo until the owner releases it). This file
   holds the shell (header, MODE LATIHAN ribbon, mode switch, glass dock + Catat menu, which tab and
   which task screen is open) and the owner's Aturan lapangan & armada screen. The day screens live in
   dist-field-day.jsx, the shared pieces in dist-field-kit.jsx. Every read/write goes through ONE
   adaptor (FIELDAPI): real = the server, latihan = this phone only.
   The bundle shares one scope across files, so every top-level name here is unique (Fld*, *fl). */
// Releasing makes this the main view for EVERY field account. Locked until the full field screens
// (Plan 3) replace the foundation stub; flip to true then. Un-releasing is always allowed.
// 3C: all screens built (day, customers, manual inputs, koreksi).
const FLD_SCREENS_READY = true;

function FldApp({ user, perms, pref, today, fleetList, fleetScope, refreshKey, onExit, onPref, onOpenRules, onLogout }) {
  const mode = pref.mode;
  const can = fldCan(perms);
  const scope = Array.isArray(fleetScope) ? fleetScope : null;
  const fleets = scope || fldPlates(fleetList);
  const [fleet, setFleet] = uSfl(fleets[0] || '');
  const [api, setApi] = uSfl(null);
  const [ctx, setCtx] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [tab, setTab] = uSfl('kirim');
  const [custFilter, setCustFilter] = uSfl('all');   // the Pelanggan filter — the board can open it on "Belum lengkap"
  const goIncomplete = () => { setCustFilter('warn'); setTab('pelanggan'); };
  const [view, setView] = uSfl(null);   // { name: 'stop'|'sale'|'run', stop? }
  const [menu, setMenu] = uSfl(false);
  const menuDrag = useFldSheetDrag(() => setMenu(false));
  // Swipe between tabs (owner, 3D) — touch only; never from a map, an input, a sideways scroller or a sheet.
  const TAB_ORDER = ['kirim', 'peta', 'pelanggan', 'setoran'];
  const swipeRef = uRfl(null);
  const swipeDown = (e) => {
    swipeRef.current = null;   // a start that is ignored never pairs with a later release (M8)
    if (e.pointerType === 'mouse') return;
    if (!FIELDLOGIC.swipeStart({ x: e.clientX, width: window.innerWidth })) return;   // the edge is the phone's back gesture
    if (e.target.closest('.mlap-map, input, textarea, select, .mlap-hscroll, .mlap-sheet, .leaflet-container')) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const swipeUp = (e) => {
    const s = swipeRef.current; swipeRef.current = null; if (!s) return;
    const next = FIELDLOGIC.swipeTab({ dx: e.clientX - s.x, dy: e.clientY - s.y, ms: Date.now() - s.t, tab, order: TAB_ORDER });
    if (next) { setTab(next); setView(null); }
  };
  const [catat, setCatat] = uSfl(false);
  const [ask, setAsk] = uSfl(null);
  const [toast, setToast] = uSfl('');
  const [tick, setTick] = uSfl(0);           // bumped right after the context reloads → screens reload ONCE
  const [ctxTick, setCtxTick] = uSfl(0);     // bumped after every write / office event → context reloads
  const ctxRef = uRfl(null);
  const [openTick, setOpenTick] = uSfl(0);   // bumped by "Coba lagi" / restart → the adaptor reopens
  const [persistOk, setPersistOk] = uSfl(true);
  const storageRef = uRfl(null);
  // A sale saved on the server whose stop could not be marked delivered yet, per stop — remembered per
  // mode + user for the browser session, so coming back to that stop retries only the marking.
  const pendKey = 'airro.fld.pending:' + mode + ':' + ((user && user.id) || 'anon');
  const pendRef = uRfl({});
  if (!pendRef.current[pendKey]) pendRef.current[pendKey] = FIELDLOGIC.pendingSales((() => { try { return window.sessionStorage; } catch (e) { return null; } })(), pendKey);
  const pending = pendRef.current[pendKey];
  // Each write's clientRef, per action + target, kept until it is saved — in localStorage (per mode + user
  // + armada + day) so it outlives leaving the screen and a reload: a retry is never a second write.
  const refKey = 'airro.fld.ref:' + mode + ':' + ((user && user.id) || 'anon') + ':' + fleet + ':' + today;
  if (!pendRef.current[refKey]) pendRef.current[refKey] = FIELDLOGIC.refStore((() => { try { return window.localStorage; } catch (e) { return null; } })(), refKey);
  const refs = pendRef.current[refKey];
  const key = 'latihan:' + ((user && user.id) || 'anon') + ':' + (fleet || '');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  // The glass dock IS the navigation here: the app's own phone bottom nav steps aside while this is
  // open (the topbar menu still reaches every other screen).
  uEfl(() => { document.body.classList.add('mlap-on'); return () => { document.body.classList.remove('mlap-on'); }; }, []);
  // Full screen: the phone's status bar takes the screen's colour while the field view is open.
  uEfl(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return undefined;
    const before = meta.getAttribute('content');
    meta.setAttribute('content', '#EEF2F6');
    return () => { meta.setAttribute('content', before); };
  }, []);
  // The armada list can arrive after the first render (empty cache): follow it.
  uEfl(() => { if (!fleets.includes(fleet)) setFleet(fleets[0] || ''); }, [fleets.join('|')]);
  // Open the adaptor of the chosen mode (practice copy is per user + armada + day).
  uEfl(() => {
    let live = true; setApi(null); setCtx(null); ctxRef.current = null; setErr(null); setPersistOk(true); setView(null);
    const real = window.FIELDAPI.real(window.API, { date: today, fleet });
    if (mode === 'asli') { setApi(real); return () => { live = false; }; }
    if (!storageRef.current) storageRef.current = window.indexedDB ? window.FIELDAPI.idbStorage() : window.FIELDAPI.memoryStorage();
    window.FIELDAPI.openLatihan({ key, real, storage: storageRef.current, today, onPersist: (ok) => { if (live) setPersistOk(ok); } })
      .then((a) => { if (live) setApi(a); })
      .catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [mode, fleet, today, openTick]);
  // The day's context (rules, warehouse, open rit, expected gallons) — reloaded after every write and,
  // in Mode asli, when the office changes something (refreshKey).
  // Then the screens reload once (tick) with the fresh context. A failed RELOAD keeps the working screen
  // (a small notice); only the very first load may show the error screen.
  uEfl(() => {
    if (!api || api.mode !== mode) return undefined;
    let live = true;
    api.context()
      .then((c) => { if (!live) return; ctxRef.current = c; setCtx(c); setTick((t) => t + 1); })
      .catch((e) => { if (!live) return; if (ctxRef.current) flash(trFl('fld.reloadErr')); else setErr(e); });
    return () => { live = false; };
  }, [api, ctxTick]);
  // Office events (Mode asli) are coalesced, like the old board: a burst of company-wide changes costs
  // one reload, not one per event.
  const coalRef = uRfl(null);
  if (!coalRef.current && window.DISTLIVE) coalRef.current = window.DISTLIVE.createCoalescer(() => setCtxTick((t) => t + 1), 1500);
  uEfl(() => { if (mode === 'asli' && refreshKey && coalRef.current) coalRef.current.trigger(); }, [refreshKey]);
  uEfl(() => () => { if (coalRef.current) coalRef.current.cancel(); }, []);
  // Screens only ever run on the adaptor of the ACTIVE mode — never the previous one after a switch.
  const ready = !!api && api.mode === mode && !!ctx;
  const done = (m) => { setView(null); setCtxTick((t) => t + 1); if (m) flash(m); };
  // MODE ASLI: report the driver's position like the old board (every POS_EVERY_MS or after POS_MOVE_M;
  // fixes vaguer than POS_MAX_ACC_M skipped) — for the owner's live map, and because finishing a stop
  // can require a recent fix. Never in practice. Stops when this screen closes or the mode changes.
  uEfl(() => {
    if (mode !== 'asli' || !ready) return undefined;
    const geo = typeof navigator !== 'undefined' && navigator.geolocation;
    if (!(geo && geo.watchPosition)) return undefined;
    const last = { lat: null, lng: null, at: 0 };
    const id = navigator.geolocation.watchPosition((p) => {
      const c = p.coords; const acc = Math.round(c.accuracy);
      if (acc > POS_MAX_ACC_M) return;
      const moved = last.lat == null ? Infinity : haversineM(last.lat, last.lng, c.latitude, c.longitude);
      if (!(moved > POS_MOVE_M || Date.now() - last.at >= POS_EVERY_MS)) return;
      last.lat = c.latitude; last.lng = c.longitude; last.at = Date.now();
      api.position({ lat: c.latitude, lng: c.longitude, accuracy: acc, recordedAt: p.timestamp || Date.now() }).catch(() => { /* a dropped fix is not worth interrupting a round */ });
    }, () => { /* denied / unavailable: finishing a stop then asks for a reason */ }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    return () => { navigator.geolocation.clearWatch(id); };
  }, [mode, ready, api]);

  const askSwitch = (to) => setAsk({
    title: to === 'asli' ? trFl('fld.switchToAsliT') : trFl('fld.switchToLatihanT'),
    body: to === 'asli' ? trFl('fld.switchToAsliB') : trFl('fld.switchToLatihanB'),
    danger: to === 'asli',
    run: () => { onPref({ mode: to }); setMenu(false); },
  });
  const askReset = () => setAsk({
    title: trFl('fld.resetLatihanT'), body: trFl('fld.resetLatihanB'), danger: true,
    run: () => {
      Promise.resolve(api && api.reset ? api.reset() : null)
        .then(() => { setMenu(false); setOpenTick((t) => t + 1); flash(trFl('fld.resetDone')); })
        .catch((e) => flash(trFl('fld.resetFail') + (fldErrMsg(e) ? ' (' + fldErrMsg(e) + ')' : '')));
    },
  });

  const TABS = [['kirim', 'truck'], ['peta', 'map'], null, ['pelanggan', 'users'], ['setoran', 'clipboard']];
  const TAB_LABEL = { kirim: 'fld.tabKirim', peta: 'fld.tabPeta', pelanggan: 'fld.tabPelanggan', setoran: 'fld.tabSetoran' };
  const ACTIONS = [['catatSale', can.sale], ['catatBon', can.bon], ['catatExp', can.expense], ['catatStop', can.addStop], ['catatAdj', can.adjust], ['catatDmg', can.damage]].filter((a) => a[1]).map((a) => a[0]);
  const ACTION_ICON = { catatSale: 'receipt', catatBon: 'cash', catatExp: 'fuel', catatStop: 'pinPlus', catatAdj: 'adjust', catatDmg: 'bottleBroken' };
  const ACTION_VIEW = { catatSale: { name: 'pick', act: 'sale' }, catatBon: { name: 'pick', act: 'bon' }, catatExp: { name: 'exp' }, catatStop: { name: 'addStop' }, catatAdj: { name: 'pick', act: 'adjust' }, catatDmg: { name: 'pick', act: 'damage' } };
  // a customer chosen for an action → the action's screen
  const openFor = (act, c) => {
    if (act === 'koreksi') { setView({ name: 'koreksi', target: c }); return; }
    if (act !== 'sale') { setView(act === 'addStop' ? { name: 'addStop', preset: c } : { name: act, cust: c }); return; }
    // a customer with a pending stop today is sold THROUGH that stop (marked delivered, never sold twice)
    api.board().then((board) => FIELDLOGIC.saleStopFor({ board, customer: c, demand: ctx.demand })).catch(() => null)
      .then((s) => setView({ name: 'sale', stop: s || fldSaleStopFromCust(c) }));
  };
  const full = view && ['sale', 'pick', 'bon', 'adjust', 'damage', 'exp', 'addStop', 'complete', 'pin', 'koreksi', 'koreksiSaya'].includes(view.name);   // full-screen task: no tab header/dock
  // M6: a new tab or task screen opens at the top (the root is the one scroller of the field view); a
  // sheet over a tab (stop, customer) keeps the tab where it was.
  const rootRef = uRfl(null);
  const scrollKey = full ? 'v:' + view.name : 't:' + tab;
  uEfl(() => { if (rootRef.current) rootRef.current.scrollTop = 0; }, [scrollKey]);

  let body = null;
  if (err) {
    body = (
      <div className="mlap-err" role="alert">
        <b>{err.offline ? trFl('fld.offline') : trFl('fld.loadErr')}</b>
        <span>{fldErrMsg(err)}</span>
        <button type="button" className="mlap-btn" onClick={() => setOpenTick((t) => t + 1)}>{trFl('fld.retry')}</button>
      </div>
    );
  } else if (!ready) {
    body = <div className="mlap-empty">{trFl('fld.loading')}</div>;
  } else if (tab === 'kirim') {
    body = <FldBoardScreen api={api} ctx={ctx} tick={tick} can={can} onStop={(s) => setView({ name: 'stop', stop: s })} onSale={(s) => setView({ name: 'sale', stop: s })} onOpenRun={() => setView({ name: 'run' })} onIncomplete={goIncomplete} onOutside={() => (can.addStop ? setView({ name: 'addStop' }) : setTab('peta'))} />;
  } else if (tab === 'peta') {
    body = <FldRoute api={api} ctx={ctx} tick={tick} fleet={fleet} onOpenRun={() => setView({ name: 'run' })} onMenu={() => setMenu(true)} onAddStop={can.addStop ? () => setView({ name: 'addStop' }) : null} />;
  } else if (tab === 'setoran') {
    body = <FldSetoran api={api} ctx={ctx} tick={tick} canKoreksi={can.correct || can.void} onKoreksiSaya={() => setView({ name: 'koreksiSaya' })} onChanged={(m) => done(m)} />;
  } else {
    body = <FldCustomers api={api} tick={tick} filter={custFilter} onFilter={setCustFilter} onOpen={(c) => setView({ name: 'cust', cust: c })} />;
  }

  return (
    <div className="mlap-root" ref={rootRef}>
      {ready && full && view.name === 'sale' && <FldSale api={api} stop={view.stop} pending={pending} refs={refs} onDone={done} onBack={() => setView(null)} onPayBon={view.stop.sisaBon > 0 && can.bon ? () => openFor('bon', fldCustFromStop(view.stop)) : null} />}
      {ready && full && view.name === 'pick' && (
        <FldPickCustomer api={api} title={trFl('fld.' + ({ sale: 'catatSale', bon: 'catatBon', adjust: 'catatAdj', damage: 'catatDmg' })[view.act])} hint={trFl('fld.pickHint')}
          accept={view.act === 'bon' ? ((c) => (c.sisaBon > 0 ? '' : 'fld.pickNoBon')) : view.act === 'damage' ? ((c) => (c.gallonsHeld > 0 ? '' : 'fld.dmgNoHeld')) : null}
          onPick={(c) => openFor(view.act, c)} onBack={() => setView(null)} />
      )}
      {ready && full && view.name === 'bon' && <FldPayBon api={api} cust={view.cust} refs={refs} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'adjust' && <FldAdjust api={api} cust={view.cust} needsApproval={ctx.galonNeedsApproval} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'damage' && <FldDamage api={api} cust={view.cust} rules={ctx.rules || {}} refs={refs} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'exp' && <FldExpense api={api} refs={refs} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'addStop' && <FldAddStop api={api} preset={view.preset} can={can} onPin={(c, keep) => setView({ name: 'pin', cust: c, back: keep ? Object.assign({}, view, { preset: c }) : view })} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'complete' && <FldComplete api={api} cust={view.cust} onPin={(c) => setView({ name: 'pin', cust: c, back: view })} onDone={done} onBack={() => setView(null)} />}
      {ready && full && view.name === 'pin' && <FldPinMap api={api} cust={view.cust} depot={ctx.depot} onDone={(m, pt) => { if (view.back) { setView(pt ? FIELDLOGIC.afterPin(view.back, view.cust.id, pt) : view.back); flash(m); setCtxTick((t) => t + 1); } else done(m); }} onBack={() => setView(view.back || null)} />}
      {ready && full && view.name === 'koreksi' && <FldKoreksi api={api} target={view.target} can={can} onDone={(m) => { setView({ name: 'koreksiSaya' }); flash(m); setCtxTick((t) => t + 1); }} onBack={() => setView(null)} onSaya={() => setView({ name: 'koreksiSaya' })} />}
      {ready && full && view.name === 'koreksiSaya' && <FldKoreksiSaya api={api} tick={tick} onResubmit={(tg) => setView({ name: 'koreksi', target: tg })} onBack={() => setView(null)} onChanged={(m) => { flash(m); setCtxTick((t) => t + 1); }} />}
      {!full && (
        <>
          {tab !== 'peta' ? (
            <div className="mlap-head">
              <div className="mlap-head-t">
                <span className="mlap-eyebrow mlap-meta">
                  <span>{fldDayLabel(today)}{fleet ? ' · ' + fleet : ''}</span>
                  {mode === 'latihan' ? <span className="mlap-chip latihan" role="note">{trFl('fld.modeLatihan')}</span> : null}
                </span>
                <h1>{trFl(TAB_LABEL[tab])}</h1>
              </div>
              <div className="mlap-head-act">
                {tab === 'kirim' ? <button type="button" className="mlap-round" aria-label={trFl('fld.seeRoute')} onClick={() => setTab('peta')}><FldSvg n="route" s={19} /></button> : null}
                <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={() => setMenu(true)}><FldSvg n="dots" s={19} /></button>
              </div>
            </div>
          ) : null}
          <div className="mlap-body mlap-swipe" onPointerDown={swipeDown} onPointerUp={swipeUp} onPointerCancel={() => { swipeRef.current = null; }}>
            {api && mode === 'latihan' && (api.persisted === false || persistOk === false) && <div className="mlap-err" role="status">{trFl('fld.noStore')}</div>}
            {body}
          </div>
          <div className="mlap-dockfade" aria-hidden="true" />
          <FldDock tabs={TABS} tab={tab} onTab={(k) => { setTab(k); setView(null); }} labelOf={(k) => trFl(TAB_LABEL[k])} catat={catat} onCatat={() => setCatat(!catat)} />
        </>
      )}
      {catat && !full && (
        <>
          <button type="button" className="mlap-scrim menu" aria-label={trFl('fld.cancel')} onClick={() => setCatat(false)} />
          <div className="mlap-catat-menu" role="menu" aria-label={trFl('fld.catatTitle')}>
            <div className="mlap-eyebrow" style={{ padding: '2px 6px 8px' }}>{trFl('fld.catatTitle')}</div>
            <div className="mlap-catat-grid">
              {ACTIONS.map((a, i) => <button key={a} type="button" role="menuitem" className="mlap-tile" style={{ animationDelay: (70 + i * 40) + 'ms' }} onClick={() => { setCatat(false); setView(ACTION_VIEW[a]); }}><span className="mlap-tile-ico"><FldSvg n={ACTION_ICON[a]} s={19} /></span>{trFl('fld.' + a)}</button>)}
              {!ACTIONS.length ? <div className="mlap-empty">{trFl('fld.noActions')}</div> : null}
            </div>
          </div>
        </>
      )}
      {ready && view && view.name === 'run' && <FldOpenRun api={api} ctx={ctx} tick={tick} onDone={done} onBack={() => setView(null)} />}
      {ready && view && view.name === 'stop' && <FldStopSheet api={api} stop={view.stop} can={can} onClose={() => setView(null)} onSale={(s) => setView({ name: 'sale', stop: s })} onAction={(a, c) => openFor(a, c)} onChanged={done} />}
      {ready && view && view.name === 'cust' && <FldCustSheet cust={view.cust} can={can} onClose={() => setView(null)} onAction={(a, c) => openFor(a, c)} />}
      {menu && (
        <>
          <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={() => setMenu(false)} />
          <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={trFl('fld.menu')} ref={menuDrag.ref} style={menuDrag.style}>
            <FldGrab handle={menuDrag.handle} />
            <h2>{trFl('fld.menu')}</h2>
            {fleets.length > 1 && (
              <label className="mlap-menu-item mlap-menu-fleet">
                <span className="mlap-grow">{trFl('fld.pickFleet')}</span>
                <select className="mlap-select" value={fleet} onChange={(e) => { setFleet(e.target.value); setMenu(false); }} aria-label={trFl('fld.pickFleet')}>
                  {fleets.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}
            {pref.canAsli && pref.canLatihan && (mode === 'latihan'
              ? <button type="button" className="mlap-menu-item" onClick={() => askSwitch('asli')}>{trFl('fld.useAsli')}</button>
              : <button type="button" className="mlap-menu-item" onClick={() => askSwitch('latihan')}>{trFl('fld.useLatihan')}</button>)}
            {mode === 'latihan' && api && <button type="button" className="mlap-menu-item" onClick={askReset}>{trFl('fld.resetLatihan')}</button>}
            {(can.correct || can.void) && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); setView({ name: 'koreksiSaya' }); }}>{trFl('fld.kSaya')}</button>}
            {onOpenRules && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onOpenRules(); }}>{trFl('fld.rules')}</button>}
            <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onExit(); }}>{trFl('fld.backOld')}</button>
            {onLogout && <button type="button" className="mlap-menu-item" onClick={() => { setMenu(false); onLogout(); }}>{trFl('fld.logout')}</button>}
          </div>
        </>
      )}
      {ask && <FldSheet title={ask.title} body={ask.body} danger={ask.danger} onClose={() => setAsk(null)} onConfirm={() => { const r = ask.run; setAsk(null); r(); }} />}
      {toast && <div className="mlap-toast" role="status">{toast}</div>}
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
      .then((x) => {
        // the release switch alone: keep every other edit still unsaved on this screen
        if (patch && patch.fieldUiDefault !== undefined) { setR((cur) => Object.assign({}, cur, { fieldUiDefault: x.data.fieldUiDefault })); } else got(x.data);
        setDone(trFl('fld.saved')); setTimeout(() => setDone(''), 2400); if (onSaved) onSaved(x.data);
      })
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
