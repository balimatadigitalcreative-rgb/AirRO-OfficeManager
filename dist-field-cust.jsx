/* MODE LAPANGAN — CUSTOMER SCREENS + MANUAL INPUTS: Pelanggan, customer sheet, Lengkapi data, Atur titik,
   Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi galon, Pengeluaran. Every read/write goes
   through the adaptor `api` the shell hands in (real server or this phone's practice copy) — never the
   server directly. Owner rules kept here: a proof photo for every money-in and damage charge and every
   expense; expenses always cash from the deposit; gallon adjustments wait for the office; a pin moved
   more than 150 m from the phone asks to confirm. */

// Avatar tints of the board, steady per customer (not per row, so a filter never recolours a person).
const FLD_AVA_TINTS = [['#E8F1F8', '#065489'], ['#DDF4F2', '#0F6B66'], ['#EEE9F8', '#4B3A8C'], ['#FCF1D6', '#7A4B00']];
const fldTint = (id) => FLD_AVA_TINTS[String(id || '').split('').reduce((t, ch) => t + ch.charCodeAt(0), 0) % FLD_AVA_TINTS.length];
const fldInitials = (name) => String(name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase();

// PELANGGAN (mockup Pelanggan board): filter chips that scroll sideways, round tinted avatars, the
// missing-data tags, the bon (or a green "Lunas") with the gallons held, and the glass search pill
// floating above the dock.
function FldCustomers({ api, tick, filter, onFilter, onOpen }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; setErr(null); api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, tick]);
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = FIELDLOGIC.customerList(list, { q, filter });
  const chips = [['all', trFl('fld.f_all', { n: v.counts.all })], ['warn', trFl('fld.f_warn', { n: v.counts.warn })], ['bon', trFl('fld.f_bon', { n: v.counts.bon })], ['fixed', trFl('fld.f_fixed', { n: v.counts.fixed })]];
  return (
    <>
      <div className="mlap-hscroll" role="group" aria-label={trFl('fld.filter')}>
        {chips.map(([k, text]) => <button key={k} type="button" className={'mlap-fchip' + (k === 'warn' ? ' warn' : '') + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => onFilter(k)}>{text}</button>)}
      </div>
      <div className="mlap-card mlap-list">
        {v.rows.length ? v.rows.map((c) => {
          const t = fldTint(c.id);
          const warns = [c.gaps.titik ? 'fld.tagNoPin' : '', c.gaps.wa ? 'fld.noWa' : '', c.gaps.foto ? 'fld.tagNoFoto' : ''].filter(Boolean);
          return (
            <button key={c.id} type="button" className="mlap-row mlap-rowbtn mlap-custrow" onClick={() => onOpen(c)}>
              <span className="mlap-ava" aria-hidden="true" style={{ background: t[0], color: t[1] }}>{fldInitials(c.name)}</span>
              <span className="mlap-grow">
                <span className="nm">{c.name}</span>
                <span className="sb">{[c.code, (c.deliveryDays || []).join(' · '), c.fixedDays ? trFl('fld.fixedLow') : ''].filter(Boolean).join(' · ')}</span>
                {warns.length ? <span className="mlap-gtags">{warns.map((k) => <span key={k} className="mlap-gtag">{trFl(k)}</span>)}</span> : null}
              </span>
              <span className="mlap-custside">
                {c.sisaBon > 0 ? <b className="bon">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <b className="ok">{trFl('fld.lunas')}</b>}
                <span className="sb">{trFl('fld.nGalon', { n: c.gallonsHeld || 0 })}</span>
              </span>
            </button>
          );
        }) : <div className="mlap-empty">{trFl('fld.noCustFilter')}</div>}
      </div>
      <div className="mlap-ctaspace" />
      <label className="mlap-glass mlap-searchpill">
        <FldSvg n="search" s={16} sw={2.2} />
        <input type="search" placeholder={trFl('fld.searchCust2')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
    </>
  );
}

// The customer's sheet (same look as Detail stop): avatar + name + close X, Navigasi / Telepon / WhatsApp,
// bon and gallons held, the missing data, then the actions this account may use.
function FldCustSheet({ cust: c0, can, onClose, onAction }) {
  const drag = useFldSheetDrag(onClose);
  const c = Object.assign({}, c0, { gaps: c0.gaps || FIELDLOGIC.gapsOf(c0) });
  const links = fldLinks(c);
  const t = fldTint(c.id);
  const acts = [];
  if (can.sale) acts.push(['sale', 'receipt', 'fld.catatSale']);
  if (can.bon && c.sisaBon > 0) acts.push(['bon', 'cash', 'fld.terimaBon']);
  if (can.location && c.gaps.count > 0) acts.push(['complete', 'pinMove', 'fld.completeData']);
  if (can.addStop) acts.push(['addStop', 'pinPlus', 'fld.addToday']);
  if (can.adjust) acts.push(['adjust', 'adjust', 'fld.adjRow']);
  if (can.damage && c.gallonsHeld > 0) acts.push(['damage', 'bottleBroken', 'fld.dmgRow']);
  const fix = can.location && c.gaps.count > 0 ? () => onAction('complete', c) : null;
  const warns = [c.gaps.titik ? 'fld.tagNoPin' : '', c.gaps.wa ? 'fld.noWa' : '', c.gaps.foto ? 'fld.tagNoFoto' : ''].filter(Boolean);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={c.name} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={c.name} sub={[c.code, c.address].filter(Boolean).join(' · ')} lead={<span className="mlap-ava lg" aria-hidden="true" style={{ background: t[0], color: t[1] }}>{fldInitials(c.name)}</span>} onClose={onClose} />
        <div className="mlap-sheet-stack">
          <div className="mlap-contacts">
            <FldLinkBtn href={links.nav} className="mlap-ctile" newTab><FldSvg n="navigate" s={18} />{trFl('fld.navigate')}</FldLinkBtn>
            <FldLinkBtn href={links.tel} className="mlap-ctile"><FldSvg n="phone" s={18} />{trFl('fld.call')}</FldLinkBtn>
            {links.wa ? <FldLinkBtn href={links.wa} className="mlap-ctile" newTab><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>
              : fix ? <button type="button" className="mlap-ctile miss" onClick={fix}><FldSvg n="wa" s={18} />{trFl('fld.fillWaTile')}</button>
                : <FldLinkBtn href="" className="mlap-ctile"><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>}
          </div>
          <div className="mlap-card mlap-facts2">
            <div><span className="sb">{trFl('fld.bonNow')}</span>{c.sisaBon > 0 ? <b className="bon">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <b className="ok">{trFl('fld.lunas')}</b>}</div>
            <div><span className="sb">{trFl('fld.heldAt')}</span><b>{c.gallonsHeld == null ? '—' : c.gallonsHeld}</b></div>
          </div>
          {warns.length ? <span className="mlap-gtags">{warns.map((k) => <span key={k} className="mlap-gtag">{trFl(k)}</span>)}</span> : null}
          {acts.length ? (
            <div className="mlap-card">
              {acts.map(([k, ico, key]) => (
                <button key={k} type="button" className="mlap-actrow" onClick={() => onAction(k, c)}>
                  <FldSvg n={ico} s={17} /><span className="mlap-grow">{trFl(key)}</span><FldSvg n="chevron" s={13} sw={2.4} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// LENGKAPI DATA — the three things a route needs from a customer: a location pin (from this phone's
// GPS, or dragged on the map), a WhatsApp number, a location photo. "Simpan" saves only what changed.
function FldComplete({ api, cust: c, onPin, onDone, onBack }) {
  const g = FIELDLOGIC.gapsOf(c);
  const [gps, setGps] = uSfl(null);
  const [locBusy, setLocBusy] = uSfl(false);
  const [wa, setWa] = uSfl(c.phone || '');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const takeGps = () => { setLocBusy(true); setErr(''); fldGeo(12000).then((p) => { setLocBusy(false); if (p) setGps(p); else setErr(trFl('fld.noGps')); }); };
  const changed = !!gps || (wa.trim() !== String(c.phone || '').trim() && wa.trim() !== '') || !!photo;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (gps) await api.setLocation(c.id, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, method: 'gps' });
      if (wa.trim() && wa.trim() !== String(c.phone || '').trim()) await api.setPhone(c.id, wa);
      if (photo) await api.setLocationPhoto(c.id, photo.id);
      onDone(trFl('fld.dataSaved', { name: c.name }));
    } catch (e) { setErr(fldErrMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.completeT')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.titik && !gps ? 'miss' : 'ok')} aria-hidden="true">{g.titik && !gps ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkTitik')}</b><span className="sb">{gps ? trFl('fld.gpsTaken', { m: Math.round(gps.accuracy || 0) }) : (g.titik ? trFl('fld.pinNeeded') : trFl('fld.pinHave'))}</span></span></div>
          <div className="mlap-actions">
            <button type="button" className="mlap-btn" disabled={locBusy} onClick={takeGps}>{locBusy ? trFl('fld.locating') : trFl('fld.useMyLoc')}</button>
            <button type="button" className="mlap-btn" onClick={() => onPin(c)}>{trFl('fld.dragOnMap')}</button>
          </div>
          <span className="sb">{trFl('fld.gpsDrift')}</span>
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.wa && !wa.trim() ? 'miss' : 'ok')} aria-hidden="true">{g.wa && !wa.trim() ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkWa')}</b><span className="sb">{trFl('fld.waFor')}</span></span></div>
          <input className="mlap-text" type="tel" inputMode="tel" placeholder="08…" aria-label={trFl('fld.chkWa')} value={wa} onChange={(e) => setWa(e.target.value.slice(0, 20))} />
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check"><span className={'mlap-dot ' + (g.foto && !photo ? 'miss' : 'ok')} aria-hidden="true">{g.foto && !photo ? '!' : '✓'}</span><span className="mlap-grow"><b>{trFl('fld.chkFoto')}</b></span></div>
          <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.locPhotoHint" />
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !changed} onClick={save}>{trFl('fld.saveCust')}</button>
      </div>
    </div>
  );
}

// ATUR TITIK LOKASI — a draggable pin over the map. The phone's own GPS fix (with its accuracy circle)
// and the old pin are shown; a pin moved > 150 m from the phone asks to confirm. Saved as a "geser" with
// the device fix, so the history says how far it was moved from the phone's GPS.
function FldPinMap({ api, cust: c, depot, onDone, onBack }) {
  const had = typeof c.lat === 'number' && typeof c.lng === 'number';
  const [dev, setDev] = uSfl(null);
  const [pin, setPin] = uSfl(had ? { lat: c.lat, lng: c.lng } : null);
  const [mapErr, setMapErr] = uSfl(false);
  const [askFar, setAskFar] = uSfl(false);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [mapReady, setMapReady] = uSfl(false);   // the phone's fix may arrive before or after the map
  const [fallback, setFallback] = uSfl(false);   // no old pin + no GPS: started at the warehouse — must be moved
  const [moved, setMoved] = uSfl(false);
  const mapEl = uRfl(null);
  const mapRef = uRfl(null);
  const userRef = uRfl(false);   // a drag or zoom by the user (the first centring is not "moved")
  const [lift, setLift] = uSfl(false);
  uEfl(() => {
    let live = true;
    fldGeo(12000).then((p) => {
      if (!live) return; setDev(p);
      if (!had) { const st = FIELDLOGIC.pinStart({ cust: c, device: p, depot }); setPin((cur) => cur || st.pin); setFallback(st.fallback); }
    });
    return () => { live = false; };
  }, []);
  uEfl(() => {
    if (!pin || !mapEl.current || mapRef.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      if (had) L.circleMarker([c.lat, c.lng], { radius: 7, color: '#5B6B75', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(map);
      map.setView([pin.lat, pin.lng], 18);   // first: Leaflet fires zoomstart on the first view, which is not the driver
      // the pin stays in the centre; the driver moves the map under it (drag anywhere, mockup)
      map.on('move', () => { const ce = map.getCenter(); setPin({ lat: ce.lat, lng: ce.lng }); });
      map.on('dragstart zoomstart', () => { userRef.current = true; setLift(true); });
      map.on('moveend', () => { setLift(false); if (userRef.current) setMoved(true); });
      setMapReady(true);
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; };
  }, [!!pin]);
  // the phone's fix + its accuracy circle, whichever of (fix, map) comes last
  uEfl(() => {
    if (!dev || !mapReady || !mapRef.current || !window.L) return undefined;
    const L = window.L;
    const circle = L.circle([dev.lat, dev.lng], { radius: Math.max(5, dev.accuracy || 0), color: '#065489', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(mapRef.current);
    const dot = L.circleMarker([dev.lat, dev.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#065489', fillOpacity: 1, interactive: false }).addTo(mapRef.current);
    return () => { circle.remove(); dot.remove(); };
  }, [dev, mapReady]);
  uEfl(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);
  const mv = FIELDLOGIC.pinMove({ device: dev, pin });
  const save = (confirmFar) => {
    if (!pin) return;
    if (mv.far && !confirmFar) { setAskFar(true); return; }
    setBusy(true); setErr('');
    api.setLocation(c.id, { lat: pin.lat, lng: pin.lng, accuracy: dev ? dev.accuracy : null, method: 'geser', deviceLat: dev ? dev.lat : undefined, deviceLng: dev ? dev.lng : undefined, deviceAccuracy: dev ? dev.accuracy : undefined })
      .then(() => onDone(trFl('fld.pinSaved', { name: c.name }), { lat: pin.lat, lng: pin.lng }))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.pinT')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        {mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} sub={trFl('fld.pinNoMap')} /> : (pin ? (
          <div className="mlap-mapwrap">
            <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} />
            <span className={'mlap-centerpin' + (lift ? ' up' : '')} aria-hidden="true"><span className="mlap-centerpin-dot" /></span>
            <span className={'mlap-centerpin-shadow' + (lift ? ' up' : '')} aria-hidden="true" />
            {dev && mapReady ? <button type="button" className="mlap-round mlap-map-locate" aria-label={trFl('fld.useMyLoc')} onClick={() => mapRef.current.setView([dev.lat, dev.lng], 18)}><FldSvg n="locate" s={19} /></button> : null}
          </div>
        ) : <div className="mlap-empty">{trFl('fld.locating')}</div>)}
        <div className="mlap-hint">{trFl('fld.pinPan')}</div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-sumrow"><span>{trFl('fld.coords')}</span><b>{pin ? pin.lat.toFixed(6) + ', ' + pin.lng.toFixed(6) : '—'}</b></div>
          <div className="mlap-sumrow"><span>{dev ? trFl('fld.fromDevice', { m: Math.round(dev.accuracy || 0) }) : trFl('fld.noGps')}</span><b>{mv.meters == null ? '—' : trFl('fld.metersN', { m: mv.meters })}</b></div>
          {mv.far ? <div className="mlap-warnline">{trFl('fld.pinFar')}</div> : null}
          {fallback && !moved ? <div className="mlap-warnline">{trFl('fld.pinNoGpsMove')}</div> : null}
        </div>
        {mapErr && dev ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setPin({ lat: dev.lat, lng: dev.lng })}>{trFl('fld.useMyLoc')}</button> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pin || (fallback && !moved)} onClick={() => save(false)}>{trFl('fld.savePin')}</button>
      </div>
      {askFar && <FldSheet title={trFl('fld.pinFarT', { m: mv.meters })} body={trFl('fld.pinFarB')} confirmLabel={trFl('fld.savePin')} onClose={() => setAskFar(false)} onConfirm={() => { setAskFar(false); save(true); }} />}
    </div>
  );
}

// TAMBAH STOP — a customer outside today's schedule (or ordered via WhatsApp) as an extra stop. Today's
// stops that have no pin are listed first: they can't join the route until the pin is set. A customer
// picked without a pin goes to the end of the list (not on the route) with a prompt to set it.
function FldAddStop({ api, preset, can, onPin, onDone, onBack }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [pick, setPick] = uSfl(preset || null);
  const [qty, setQty] = uSfl(1);
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => { let live = true; Promise.all([api.board(), api.customers()]).then(([board, customers]) => { if (live) setD({ board, customers }); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  if (err) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-body"><FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  const cand = FIELDLOGIC.addStopCandidates({ board: d.board, customers: d.customers, q });
  const pickHasPin = !!pick && typeof pick.lat === 'number' && typeof pick.lng === 'number';
  const onBoard = !!pick && d.board.some((s) => s.customerId === pick.id && s.status !== 'batal');   // already on today's route (also a "Tambah ke hari ini" from the customer sheet)
  const save = () => {
    setBusy(true); setMsg('');
    api.addStop({ customerId: pick.id, qty }).then(() => onDone(trFl('fld.stopAdded', { name: pick.name }))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.addStopT')} onBack={onBack} />
      <div className="mlap-body">
        {!pick && (
          <>
            {cand.noPin.length > 0 && (
              <>
                <div className="mlap-eyebrow">{trFl('fld.noPinToday')}</div>
                <div className="mlap-card">
                  {cand.noPin.map((s) => (
                    <div key={s.id} className="mlap-row">
                      <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{s.customerCode}</span></span>
                      {can.location ? <button type="button" className="mlap-btn" onClick={() => onPin(fldCustFromStop(s))}>{trFl('fld.setPin')}</button> : null}
                    </div>
                  ))}
                </div>
              </>
            )}
            <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mlap-card">
              {cand.others.length ? cand.others.slice(0, 60).map((c) => (
                <button key={c.id} type="button" className="mlap-row mlap-rowbtn" onClick={() => setPick(c)}>
                  <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{[c.code, c.address].filter(Boolean).join(' · ')}</span></span>
                  {c.gaps.titik ? <span className="mlap-tag held">{trFl('fld.gapTitik')}</span> : null}
                </button>
              )) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
            </div>
          </>
        )}
        {pick && (
          <>
            <div className="mlap-card mlap-sec">
              <b>{pick.name}</b>
              <span className="sb">{[pick.code, pick.address].filter(Boolean).join(' · ')}</span>
              <button type="button" className="mlap-btn" onClick={() => setPick(null)}>{trFl('fld.changeCust')}</button>
            </div>
            {!pickHasPin && <FldNotice tone="warn" title={trFl('fld.pickNoPinT', { name: pick.name })} sub={trFl('fld.pickNoPinB')} action={can.location ? trFl('fld.setPinNow') : null} onAction={() => onPin(pick, true)} />}
            {onBoard ? <FldNotice tone="warn" title={trFl('fld.alreadyToday')} /> : null}
            <div className="mlap-card"><FldStepper label={trFl('fld.qtyGalon')} value={qty} onChange={setQty} min={1} max={999} /></div>
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
            <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || qty < 1 || onBoard} onClick={save}>{trFl('fld.addStopCta')}</button>
          </>
        )}
      </div>
    </div>
  );
}

// PEMBAYARAN BON — collect a customer's bon (cash or transfer) with a proof photo. The open bons are
// listed oldest first, as the payment settles them (view only — the server keeps the real balance).
function FldPayBon({ api, cust: c, refs, onDone, onBack }) {
  const [detail, setDetail] = uSfl(null);
  const [pay, setPay] = uSfl(null);
  const [via, setVia] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const slot = 'bon:' + c.id;
  const [ref] = uSfl(() => refs.take(slot));   // kept until saved (a retry after leaving is not a second payment)
  uEfl(() => { let live = true; api.customerDetail(c.id).then((x) => { if (live) setDetail(x); }).catch(() => { if (live) setDetail({ transactions: [] }); }); return () => { live = false; }; }, [api, c.id]);
  const bon = detail && detail.sisaBon != null ? detail.sisaBon : (c.sisaBon || 0);
  const pv = FIELDLOGIC.payPreview({ sisaBon: bon, pay });
  const open = detail ? FIELDLOGIC.openBons(detail.transactions || []) : [];
  const save = () => {
    setBusy(true); setErr('');
    const body = { customerId: c.id, payAmount: pay, payMethod: via, clientRef: ref, proofPhotoId: photo.id, proofTakenAt: photo.takenAt };
    if (typeof photo.lat === 'number' && typeof photo.lng === 'number') { body.proofLat = photo.lat; body.proofLng = photo.lng; }
    api.payBon(body).then((r) => { refs.done(slot); onDone(r && r.replay ? trFl('fld.replayed') : trFl('fld.paidDone', { name: c.name, v: FIELDLOGIC.fmtRp(pay) })); }).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatBon')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-sec"><span className="sb">{trFl('fld.bonNow')}</span><b className="mlap-bigrp">{FIELDLOGIC.fmtRp(bon)}</b></div>
        {open.length > 0 && (
          <div className="mlap-card">
            {open.map((b) => <div key={b.id} className="mlap-row"><span className="mlap-grow"><span className="nm">{b.txnDate}</span><span className="sb">{trFl('fld.nGalon', { n: b.qty })}{b.partial ? ' · ' + trFl('fld.partPaid') : ''}</span></span><b>{FIELDLOGIC.fmtRp(b.amount)}</b></div>)}
            <div className="mlap-hint">{trFl('fld.oldestFirst')}</div>
          </div>
        )}
        <div className="mlap-card">
          <FldMoney label={trFl('fld.payAmount')} value={pay} onChange={setPay} />
          <div className="mlap-chips mlap-pad">{[[bon, trFl('fld.payAll')], [50000, '50.000'], [100000, '100.000']].filter(([v]) => v > 0 && v <= bon).map(([v, l]) => <button key={l} type="button" className={'mlap-chip-b' + (pay === v ? ' on' : '')} aria-pressed={pay === v} onClick={() => setPay(v)}>{l}</button>)}</div>
        </div>
        <FldSeg label={trFl('fld.payVia')} value={via} onChange={setVia} options={[['tunai', trFl('fld.m_tunai')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintPay" />
        <div className="mlap-card mlap-sec">
          <div className="mlap-sumrow total"><span>{trFl('fld.bonAfterPay')}</span><b>{FIELDLOGIC.fmtRp(pv.rest)}</b></div>
          {pv.over > 0 ? <div className="mlap-warnline">{trFl('fld.payOver', { v: FIELDLOGIC.fmtRp(pv.over) })}</div> : null}
        </div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {!photo ? <div className="mlap-hint">{trFl('fld.needPhoto')}</div> : null}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pv.ok || !photo} onClick={save}>{trFl('fld.payCta', { v: FIELDLOGIC.fmtRp(pay || 0) })}</button>
      </div>
    </div>
  );
}

// PENYESUAIAN GALON — the gallons counted at the customer vs the record. Sent to the office: the count
// changes only after approval — unless the owner turned gallon approval off (then it applies at once,
// and the screen says so).
function FldAdjust({ api, cust: c, needsApproval, onDone, onBack }) {
  const rec = c.gallonsHeld == null ? 0 : c.gallonsHeld;
  const [counted, setCounted] = uSfl(rec);
  const [reasonKey, setReasonKey] = uSfl('');
  const [note, setNote] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const diff = counted - rec;
  const send = () => {
    setBusy(true); setErr('');
    api.adjustGallon(c.id, FIELDLOGIC.adjustBody({ counted, reasonKey, reasonLabel: trFl(reasonKey), note, photo }))
      .then((r) => onDone(trFl(r && r.status === 'approved' ? 'fld.adjApplied' : 'fld.adjSent', { name: c.name })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatAdj')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card">
          <div className="mlap-field"><span className="lb">{trFl('fld.adjRecord')}</span><b>{trFl('fld.nGalon', { n: rec })}</b></div>
          <FldStepper label={trFl('fld.adjCounted')} hint={trFl('fld.adjCountedHint')} value={counted} onChange={setCounted} min={0} max={9999} />
          <div className="mlap-field"><span className="lb">{trFl('fld.adjDiff')}</span><b className={diff ? 'mlap-bontxt' : ''}>{(diff > 0 ? '+' : '') + diff}</b></div>
        </div>
        <div className="mlap-eyebrow">{trFl('fld.reasonT')}</div>
        <div className="mlap-chips">{FIELDLOGIC.ADJ_REASON_KEYS.map(([k]) => <button key={k} type="button" className={'mlap-chip-b' + (reasonKey === k ? ' on' : '')} aria-pressed={reasonKey === k} onClick={() => setReasonKey(k)}>{trFl(k)}</button>)}</div>
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.optional')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.adjPhotoHint" />
        <FldNotice tone="info" title={trFl(needsApproval === false ? 'fld.adjNoWait' : 'fld.adjWaits')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !reasonKey || diff === 0} onClick={send}>{trFl('fld.adjCta')}</button>
      </div>
    </div>
  );
}

const FLD_DMG_KINDS = [['pecah', 'fld.k_pecah'], ['bocor', 'fld.k_bocor'], ['retak', 'fld.k_retak'], ['hilang', 'fld.k_hilang']];
// GANTI RUGI GALON — a borrowed gallon broken or lost at the customer: recorded straight away (no
// approval — owner rule), priced by the owner's setting, paid cash / on bon / by transfer, photo required.
function FldDamage({ api, cust: c, rules, refs, onDone, onBack }) {
  const held = c.gallonsHeld == null ? 0 : c.gallonsHeld;
  const [qty, setQty] = uSfl(1);
  const [kind, setKind] = uSfl('');
  const [pay, setPay] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const slot = 'dmg:' + c.id;
  const [ref] = uSfl(() => refs.take(slot));   // kept until saved (a retry after leaving is not a second charge)
  const pv = FIELDLOGIC.damagePreview({ qty, price: rules.hargaGantiRugiGalon, held, payMethod: pay });
  const save = () => {
    setBusy(true); setErr('');
    api.gallonDamage(c.id, { qty, kind, payMethod: pay, photoId: photo.id, clientRef: ref })
      .then((r) => { refs.done(slot); onDone(r && r.replay ? trFl('fld.replayed') : trFl('fld.dmgDone', { name: c.name, n: qty })); })
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatDmg')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        {pv.blocked ? <FldNotice tone="warn" title={trFl(pv.blocked)} sub={trFl(pv.blocked + 'B')} /> : null}
        <div className="mlap-card"><FldStepper label={trFl('fld.dmgQty')} hint={trFl('fld.dmgFrom', { n: held })} value={qty} onChange={setQty} min={1} max={Math.max(1, held)} /></div>
        <div className="mlap-eyebrow">{trFl('fld.dmgKind')}</div>
        <div className="mlap-chips">{FLD_DMG_KINDS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{trFl(key)}</button>)}</div>
        <div className="mlap-card"><div className="mlap-field"><span className="lb">{trFl('fld.dmgPrice')}</span><b>{FIELDLOGIC.fmtRp(rules.hargaGantiRugiGalon || 0)}</b></div></div>
        <div className="mlap-eyebrow">{trFl('fld.payVia')}</div>
        <FldSeg label={trFl('fld.payVia')} value={pay} onChange={setPay} options={[['tunai', trFl('fld.m_tunai')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.dmgPhotoHint" />
        <div className="mlap-card mlap-sum">
          <div className="mlap-sumrow"><span>{trFl('fld.heldAfter')}</span><b>{pv.heldAfter}</b></div>
          <div className="mlap-sumrow total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.total)}</b></div>
        </div>
        <FldNotice tone="ok" title={trFl('fld.dmgNoApproval')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !!pv.blocked || !kind || !photo} onClick={save}>{trFl('fld.dmgCta')}</button>
      </div>
    </div>
  );
}

const FLD_EXP_CATS = [['bensin', 'fld.c_bensin'], ['parkir', 'fld.c_parkir'], ['servis', 'fld.c_servis'], ['makan', 'fld.c_makan'], ['lainnya', 'fld.c_lainnya']];
// PENGELUARAN — paid from the day's deposit, always in cash (owner rule: never "uang pribadi"), with a
// photo of the receipt. Fuel asks litres + odometer (kept in the note).
function FldExpense({ api, refs, onDone, onBack }) {
  const [cat, setCat] = uSfl('');
  const [amount, setAmount] = uSfl(null);
  const [liters, setLiters] = uSfl('');
  const [odo, setOdo] = uSfl('');
  const [note, setNote] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [today, setToday] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const slot = 'exp';
  const [ref] = uSfl(() => refs.take(slot));   // kept until saved (a retry after leaving is not a second expense)
  uEfl(() => { let live = true; api.daySummary().then((s) => { if (live) setToday(s && s.pengeluaran != null ? s.pengeluaran : null); }).catch(() => {}); return () => { live = false; }; }, [api]);
  const save = () => {
    setBusy(true); setErr('');
    api.addExpense(Object.assign(FIELDLOGIC.expenseBody({ category: cat, amount, liters, odometer: odo, note, photo }), { clientRef: ref }))
      .then((r) => { refs.done(slot); onDone(r && r.replay ? trFl('fld.replayed') : trFl('fld.expDone', { v: FIELDLOGIC.fmtRp(amount) })); })
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatExp')} sub={today != null ? trFl('fld.expToday', { v: FIELDLOGIC.fmtRp(today) }) : ''} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-chips">{FLD_EXP_CATS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (cat === k ? ' on' : '')} aria-pressed={cat === k} onClick={() => setCat(k)}>{trFl(key)}</button>)}</div>
        <div className="mlap-card">
          <FldMoney label={trFl('fld.expAmount')} value={amount} onChange={setAmount} />
          {cat === 'bensin' && (
            <>
              <label className="mlap-field"><span className="lb">{trFl('fld.liters')}</span><input className="mlap-input" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))} aria-label={trFl('fld.liters')} /></label>
              <label className="mlap-field"><span className="lb">{trFl('fld.odometer')}</span><input className="mlap-input" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} aria-label={trFl('fld.odometer')} /></label>
            </>
          )}
        </div>
        <FldNotice tone="info" title={trFl('fld.expFromDeposit')} sub={trFl('fld.expFromDepositB')} />
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <div className="mlap-eyebrow">{trFl('fld.receipt')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.receiptHint" />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !cat || !(amount > 0) || !photo} onClick={save}>{trFl('fld.expCta')}</button>
      </div>
    </div>
  );
}
