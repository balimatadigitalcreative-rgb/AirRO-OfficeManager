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

const fldPt = (p) => p.lat.toFixed(5).replace('.', ',') + ', ' + p.lng.toFixed(5).replace('.', ',');

// A small still map of the customer's point (mockup Lengkapi): no gestures, the OSM licence line kept;
// a plain ground with a grey pin when there is no point yet or the map cannot load.
function FldMiniMap({ pt, caption }) {
  const el = uRfl(null);
  uEfl(() => {
    if (!pt || !el.current) return undefined;
    let live = true; let map = null;
    znLoadLeaflet().then((L) => {
      if (!live || !el.current) return;
      map = L.map(el.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
      L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      map.setView([pt.lat, pt.lng], 17);
    }).catch(() => { /* the plain ground stays */ });
    return () => { live = false; if (map) map.remove(); };
  }, [pt ? pt.lat + ',' + pt.lng : '']);
  return (
    <div className="mlap-minimap">
      <div ref={el} className="mlap-map mlap-minimap-map" aria-hidden="true" />
      <svg className={'mlap-minipin' + (pt ? ' on' : '')} width="28" height="36" viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31s-10-10-10-18a10 10 0 0 1 20 0c0 8-10 18-10 18z" fill="currentColor" stroke="#FFFFFF" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="#FFFFFF" /></svg>
      <span className="mlap-glass mlap-minicap">{caption}</span>
    </div>
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
  const had = typeof c.lat === 'number' && typeof c.lng === 'number';
  const pt = gps ? { lat: gps.lat, lng: gps.lng } : had ? { lat: c.lat, lng: c.lng } : null;
  const okTitik = !g.titik || !!gps; const okWa = !g.wa || !!wa.trim(); const okFoto = !g.foto || !!photo;
  const done = (okTitik ? 1 : 0) + (okWa ? 1 : 0) + (okFoto ? 1 : 0);
  const cap = gps ? trFl('fld.ptGps', { p: fldPt(gps), m: Math.round(gps.accuracy || 0) }) : had ? trFl('fld.pinHave') : trFl('fld.ptNone');
  const dot = (ok) => <span className={'mlap-dot ' + (ok ? 'ok' : 'miss')} aria-hidden="true">{ok ? '✓' : '!'}</span>;
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.completeT2')} onBack={onBack} backLabel={trFl('fld.later')} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, c.address].filter(Boolean).join(' · ')} aside={<span className={'mlap-prog' + (done === 3 ? ' ok' : '')}>{trFl('fld.dataN', { n: done })}</span>} />
        <div className="mlap-card">
          <FldMiniMap pt={pt} caption={cap} />
          <div className="mlap-sec">
            <div className="mlap-check">{dot(okTitik)}<b className="mlap-grow">{trFl('fld.chkTitik')}</b><span className="mlap-secnote">{trFl('fld.pinNeeded')}</span></div>
            <div className="mlap-twobtn">
              <button type="button" className={'mlap-btn ' + (gps || had ? 'line' : 'soft2')} disabled={locBusy} onClick={takeGps}><FldSvg n="crosshair" s={16} sw={2.2} />{locBusy ? trFl('fld.locating') : gps ? trFl('fld.gpsAgain') : trFl('fld.useMyLoc2')}</button>
              <button type="button" className="mlap-btn line blue" onClick={() => onPin(c)}><FldSvg n="pinMove" s={16} />{trFl('fld.dragOnMap')}</button>
            </div>
            <span className="mlap-hint">{trFl('fld.gpsDrift')}</span>
          </div>
        </div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-check">{dot(okWa)}<b className="mlap-grow">{trFl('fld.chkWa')}</b><span className="mlap-secnote">{trFl('fld.waFor')}</span></div>
          <input className="mlap-text" type="tel" inputMode="tel" placeholder="0812 3456 7890" aria-label={trFl('fld.chkWa')} value={wa} onChange={(e) => setWa(e.target.value.slice(0, 20))} />
        </div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.locPhotoHint" title={trFl('fld.chkFoto')} optional={!g.foto} w={100} h={76} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !changed} onClick={save}>{trFl('fld.saveCust')}</button></FldCtaBar>
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
      map.on('keydown', () => { userRef.current = true; });   // M7: arrow-key panning is the driver too
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
      {!mapErr && pin ? (
        <div className="mlap-pinwrap">
          <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} />
          <span className={'mlap-centerpin' + (lift ? ' up' : '')} aria-hidden="true"><span className="mlap-centerpin-dot" /></span>
          <span className={'mlap-centerpin-shadow' + (lift ? ' up' : '')} aria-hidden="true" />
        </div>
      ) : null}
      <div className="mlap-mapbar">
        <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><FldSvg n="back" s={18} sw={2.4} /></button>
        <div className="mlap-glass mlap-mappill">{trFl('fld.pinT')}</div>
        {dev && mapReady ? <button type="button" className="mlap-round mlap-map-locate" aria-label={trFl('fld.useMyLoc')} onClick={() => mapRef.current.setView([dev.lat, dev.lng], 18)}><FldSvg n="locate" s={19} /></button> : <span className="mlap-roundsp" aria-hidden="true" />}
      </div>
      {!mapErr && pin ? <div className="mlap-glass mlap-pinhint"><FldSvg n="hand" s={14} sw={2.2} />{trFl('fld.pinPan')}</div> : null}
      {mapErr || !pin ? <div className="mlap-mapempty">{mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} sub={trFl('fld.pinNoMap')} /> : <div className="mlap-empty">{trFl('fld.locating')}</div>}</div> : null}
      <div className="mlap-pinsheet">
        <div className="mlap-grab" aria-hidden="true" />
        <div className="mlap-pinsheet-hd"><b>{trFl('fld.pinOf', { name: c.name })}</b>{c.code ? <span className="sb">{c.code}</span> : null}</div>
        <div className="mlap-card">
          <div className="mlap-kv"><span>{trFl('fld.coords')}</span><b>{pin ? fldPt(pin) : '—'}</b></div>
          <div className="mlap-kv"><span>{dev ? trFl('fld.fromDevice', { m: Math.round(dev.accuracy || 0) }) : trFl('fld.noGps')}</span><b className={mv.far ? 'far' : mv.meters != null && mv.meters >= 3 ? 'moved' : ''}>{mv.meters == null ? '—' : mv.meters < 3 ? trFl('fld.pinSame') : trFl('fld.pinMoved', { m: mv.meters })}</b></div>
        </div>
        <span className={'mlap-after' + (mv.far || (fallback && !moved) ? ' far' : '')}>{mv.far ? trFl('fld.pinFar') : fallback && !moved ? trFl('fld.pinNoGpsMove') : trFl('fld.pinAudit')}</span>
        {mapErr && dev ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setPin({ lat: dev.lat, lng: dev.lng })}>{trFl('fld.useMyLoc')}</button> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pin || (fallback && !moved)} onClick={() => save(false)}>{trFl('fld.savePin')}</button>
      </div>
      {askFar && <FldSheet title={trFl('fld.pinFarT', { m: mv.meters })} body={trFl('fld.pinFarB')} confirmLabel={trFl('fld.savePin')} onClose={() => setAskFar(false)} onConfirm={() => { setAskFar(false); save(true); }} />}
    </div>
  );
}

// TAMBAH STOP (mockup Tambah stop board) — a sheet: search; today's stops that cannot join the route (no
// pin — set it); other customers as radio rows tagged with whether they have a pin; what the pick means
// (no pin → the end of the list, set the pin now; a pin → it joins the route); how many gallons; add.
function FldAddStop({ api, preset, can, onPin, onDone, onBack }) {
  const drag = useFldSheetDrag(onBack);
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [pick, setPick] = uSfl(preset || null);
  const [qty, setQty] = uSfl(1);
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => { let live = true; Promise.all([api.board(), api.customers()]).then(([board, customers]) => { if (live) setD({ board, customers }); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  const sheet = (body, cta) => (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onBack} />
      <div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label={trFl('fld.addStopT')} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={trFl('fld.addStopT')} onClose={onBack} />
        <div className="mlap-sheet-body">{body}</div>
        {cta ? <div className="mlap-sheet-cta">{cta}</div> : null}
      </div>
    </>
  );
  if (err) return sheet(<FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />);
  if (!d) return sheet(<div className="mlap-empty">{trFl('fld.loading')}</div>);
  const cand = FIELDLOGIC.addStopCandidates({ board: d.board, customers: d.customers, q });
  const pickHasPin = !!pick && typeof pick.lat === 'number' && typeof pick.lng === 'number';
  const onBoard = !!pick && d.board.some((s) => s.customerId === pick.id && s.status !== 'batal');   // already on today's route (also a "Tambah ke hari ini" from the customer sheet)
  const save = () => {
    setBusy(true); setMsg('');
    api.addStop({ customerId: pick.id, qty }).then(() => onDone(trFl('fld.stopAdded', { name: pick.name }))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return sheet(
    <>
      <label className="mlap-searchbox"><FldSvg n="search" s={16} sw={2.2} /><input type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {cand.noPin.length > 0 && !q.trim() && (
        <>
          <div className="mlap-label">{trFl('fld.noPinToday')}</div>
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
      <div className="mlap-label">{trFl('fld.otherCust')}</div>
      <div className="mlap-card">
        {cand.others.length ? cand.others.slice(0, 60).map((c) => (
          <button key={c.id} type="button" className={'mlap-pickrow' + (pick && pick.id === c.id ? ' on' : '')} aria-pressed={!!(pick && pick.id === c.id)} onClick={() => setPick(c)}>
            <span className="mlap-radio" aria-hidden="true" />
            <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{[c.code, c.address].filter(Boolean).join(' · ')}</span></span>
            <span className={'mlap-tag ' + (c.gaps.titik ? 'warnt' : 'ok')}>{trFl(c.gaps.titik ? 'fld.tagNoPin' : 'fld.tagHasPin')}</span>
          </button>
        )) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {pick && !pickHasPin ? (
        <div className="mlap-nopincard" role="alert">
          <div className="mlap-nopincard-hd"><FldSvg n="pinOff" s={18} sw={2.2} /><span className="mlap-grow"><b>{trFl('fld.pickNoPinT', { name: pick.name })}</b><span>{trFl('fld.pickNoPinB')}</span></span></div>
          {can.location ? <button type="button" className="mlap-btn mlap-pinnow" onClick={() => onPin(pick, true)}><FldSvg n="crosshair" s={16} sw={2.2} />{trFl('fld.setPinNow')}</button> : null}
        </div>
      ) : pick ? <FldNotice tone="info" title={trFl('fld.pickPinT', { name: pick.name })} /> : null}
      {onBoard ? <FldNotice tone="warn" title={trFl('fld.alreadyToday')} /> : null}
      {pick ? <div className="mlap-card"><FldStepper label={trFl('fld.qtyGalon')} value={qty} onChange={setQty} min={1} max={999} /></div> : null}
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
    </>,
    <button type="button" className="mlap-btn primary" disabled={busy || qty < 1 || onBoard || !pick} onClick={save}>{trFl(pick ? (pickHasPin ? 'fld.addToRoute' : 'fld.addAtEnd') : 'fld.addStopCta')}</button>
  );
}

const FLD_BS = { lunas: 'fld.bs_lunas', sebagian: 'fld.bs_sebagian', belum: 'fld.bs_belum' };
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
  const settle = FIELDLOGIC.settleBons(open, pay);
  const quick = [[bon, trFl('fld.payAllV', { v: FIELDLOGIC.fmtRp(bon) })], [open.length > 1 ? open[0].amount : 0, trFl('fld.payOldestV', { v: FIELDLOGIC.fmtRp(open.length > 1 ? open[0].amount : 0) })]].filter(([v]) => v > 0 && v <= bon);
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.catatBon')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={<>{c.code ? c.code + ' · ' : ''}{trFl('fld.sisaBonL')} <b className="mlap-bontxt">{FIELDLOGIC.fmtRp(bon)}</b></>} />
        {open.length > 0 && (
          <div className="mlap-card">
            {open.map((b, i) => (
              <div key={b.id} className="mlap-bonrow">
                <span className="mlap-grow"><span className="nm">{b.txnDate}</span><span className="sb">{trFl('fld.nGalon', { n: b.qty })}{b.partial ? ' · ' + trFl('fld.partPaid') : ''}</span></span>
                <b>{FIELDLOGIC.fmtRp(b.amount)}</b>
                <span className={'mlap-bonst ' + settle[i]}>{trFl(FLD_BS[settle[i]])}</span>
              </div>
            ))}
            <div className="mlap-cardnote">{trFl('fld.oldestFirst')}</div>
          </div>
        )}
        <div className="mlap-card">
          <FldMoney label={trFl('fld.payAmount')} value={pay} onChange={setPay} />
          {quick.length ? <div className="mlap-chips mlap-pad">{quick.map(([v, l]) => <button key={l} type="button" className={'mlap-chip-b' + (pay === v ? ' on' : '')} aria-pressed={pay === v} onClick={() => setPay(v)}>{l}</button>)}</div> : null}
        </div>
        <FldSeg label={trFl('fld.payVia')} value={via} onChange={setVia} options={[['tunai', trFl('fld.m_tunai')], ['transfer', trFl('fld.m_transfer')]]} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey={via === 'transfer' ? 'fld.payTfHint' : 'fld.payCashHint'} title={trFl(via === 'transfer' ? 'fld.payTfPhoto' : 'fld.payCashPhoto')} w={64} />
        <div className="mlap-card"><div className="mlap-kv tall"><span>{trFl('fld.bonAfterPay')}</span><b className={pv.rest === 0 ? 'big ok' : 'big bon'}>{pv.rest === 0 ? trFl('fld.lunas') : FIELDLOGIC.fmtRp(pv.rest)}</b></div></div>
        {pv.over > 0 ? <div className="mlap-warnline">{trFl('fld.payOver', { v: FIELDLOGIC.fmtRp(pv.over) })}</div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar hint={!photo ? trFl('fld.needPhoto') : ''}>
        <button type="button" className="mlap-btn primary" disabled={busy || !pv.ok || !photo} onClick={save}>{trFl('fld.payCta', { v: FIELDLOGIC.fmtRp(pay || 0) })}</button>
      </FldCtaBar>
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
      <FldTop title={trFl('fld.catatAdj')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, trFl('fld.adjSub')].filter(Boolean).join(' · ')} />
        <div className="mlap-card">
          <div className="mlap-kv tall"><span>{trFl('fld.adjRecord')}</span><b className="big">{trFl('fld.nGalon', { n: rec })}</b></div>
          <FldStepper label={trFl('fld.adjCounted')} hint={trFl('fld.adjCountedHint')} value={counted} onChange={setCounted} min={0} max={9999} />
          <div className={'mlap-diffrow' + (diff === 0 ? ' same' : '')}><span>{trFl('fld.adjDiff')}</span><b>{diff === 0 ? trFl('fld.pinSame') : (diff > 0 ? '+' : '−') + trFl('fld.nGalon', { n: Math.abs(diff) })}</b></div>
        </div>
        <div className="mlap-label">{trFl('fld.reasonT')}</div>
        <div className="mlap-chips">{FIELDLOGIC.ADJ_REASON_KEYS.map(([k]) => <button key={k} type="button" className={'mlap-chip-b' + (reasonKey === k ? ' on' : '')} aria-pressed={reasonKey === k} onClick={() => setReasonKey(k)}>{trFl(k)}</button>)}</div>
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.adjPhotoHint" title={trFl('fld.adjPhotoT')} optional w={64} />
        <FldNotice tone="info" title={trFl(needsApproval === false ? 'fld.adjNoWait' : 'fld.adjWaits')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !reasonKey || diff === 0} onClick={send}>{trFl('fld.adjCta')}</button></FldCtaBar>
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
      <FldTop title={trFl('fld.catatDmg')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={c.name} sub={[c.code, trFl('fld.dmgSub')].filter(Boolean).join(' · ')} />
        {pv.blocked ? <FldNotice tone="warn" title={trFl(pv.blocked)} sub={trFl(pv.blocked + 'B')} /> : null}
        <div className="mlap-card">
          <FldStepper label={trFl('fld.dmgQty')} hint={trFl('fld.dmgFrom', { n: held })} value={qty} onChange={setQty} min={1} max={Math.max(1, held)} />
          <div className="mlap-cardsec"><span className="mlap-cardsec-t">{trFl('fld.dmgKindL')}</span><div className="mlap-chips">{FLD_DMG_KINDS.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{trFl(key)}</button>)}</div></div>
          <div className="mlap-kv tall"><span className="strong">{trFl('fld.dmgPrice')}</span>{pay === 'ganti_galon' ? <span className="mlap-pricebox">—</span> : <span className="mlap-pricebox">Rp <b>{Number(rules.hargaGantiRugiGalon || 0).toLocaleString('id-ID')}</b></span>}</div>
        </div>
        <div className="mlap-label">{trFl('fld.payVia')}</div>
        <FldSeg label={trFl('fld.payVia')} value={pay} onChange={setPay} options={[['tunai', trFl('fld.m_tunai')], ['bon', trFl('fld.toBon')], ['transfer', trFl('fld.m_transfer')], ['ganti_galon', trFl('fld.m_gantiGalon')]]} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.dmgPhotoHint" title={trFl('fld.dmgPhotoT')} w={72} />
        <div className="mlap-card">
          <div className="mlap-kv"><span>{trFl('fld.galAtCust')}</span><b>{held + ' → ' + pv.heldAfter}</b></div>
          <div className="mlap-kv"><span>{trFl('fld.dmgToDepot')}</span><b>{kind === 'hilang' ? trFl('fld.dmgLost') : trFl('fld.nGalon', { n: qty })}</b></div>
          {pay === 'ganti_galon' ? <div className="mlap-kv"><span>{trFl('fld.newGalonIn')}</span><b>{trFl('fld.nGalon', { n: qty })}</b></div> : null}
          <div className="mlap-kv total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.total)}</b></div>
        </div>
        {pay === 'ganti_galon' ? <div className="mlap-hint">{trFl('fld.poolKept')}</div> : null}
        <div className="mlap-hint">{trFl('fld.dmgNoApproval')}</div>
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !!pv.blocked || !kind || !photo} onClick={save}>{trFl('fld.dmgCta')}</button></FldCtaBar>
    </div>
  );
}

const FLD_EXP_CATS = [['bensin', 'fld.c_bensin', 'fuel'], ['parkir', 'fld.c_parkir', 'parking'], ['servis', 'fld.c_servis', 'wrench'], ['makan', 'fld.c_makan', 'food'], ['lainnya', 'fld.c_lainnya', 'dots']];
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
      <FldTop title={trFl('fld.catatExp')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-cats" role="group" aria-label={trFl('fld.catatExp')}>{FLD_EXP_CATS.map(([k, key, ico]) => <button key={k} type="button" className={'mlap-cat' + (cat === k ? ' on' : '')} aria-pressed={cat === k} onClick={() => setCat(k)}><FldSvg n={ico} s={20} /><span>{trFl(key)}</span></button>)}</div>
        <div className="mlap-card"><FldMoney label={trFl('fld.expAmount')} value={amount} onChange={setAmount} /></div>
        {cat === 'bensin' && (
          <div className="mlap-card mlap-two">
            <label><span>{trFl('fld.liters')}</span><input inputMode="decimal" placeholder={trFl('fld.litersPh')} value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 6))} /></label>
            <label><span>{trFl('fld.odometer')}</span><input inputMode="numeric" placeholder={trFl('fld.odoPh')} value={odo} onChange={(e) => setOdo(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} /></label>
          </div>
        )}
        <FldNotice tone="info" title={trFl('fld.expFromDeposit')} sub={trFl('fld.expFromDepositB')} />
        <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.receiptHint" title={trFl('fld.receiptT')} w={64} h={76} />
        {today != null ? <div className="mlap-card"><div className="mlap-kv"><span>{trFl('fld.expToday', { v: FIELDLOGIC.fmtRp(today) })}</span></div></div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar><button type="button" className="mlap-btn primary" disabled={busy || !cat || !(amount > 0) || !photo} onClick={save}>{trFl('fld.expCta')}</button></FldCtaBar>
    </div>
  );
}
