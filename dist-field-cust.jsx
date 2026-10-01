/* MODE LAPANGAN — CUSTOMER SCREENS + MANUAL INPUTS: Pelanggan, customer sheet, Lengkapi data, Atur titik,
   Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi galon, Pengeluaran. Every read/write goes
   through the adaptor `api` the shell hands in (real server or this phone's practice copy) — never the
   server directly. Owner rules kept here: a proof photo for every money-in and damage charge and every
   expense; expenses always cash from the deposit; gallon adjustments wait for the office; a pin moved
   more than 150 m from the phone asks to confirm. */

function FldCustomers({ api, tick, onOpen }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [filter, setFilter] = uSfl('all');
  uEfl(() => { let live = true; setErr(null); api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, tick]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = FIELDLOGIC.customerList(list, { q, filter });
  return (
    <>
      <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      <FldSeg label={trFl('fld.filter')} value={filter} onChange={setFilter} options={[['all', trFl('fld.f_all', { n: v.counts.all })], ['warn', trFl('fld.f_warn', { n: v.counts.warn })], ['bon', trFl('fld.f_bon', { n: v.counts.bon })], ['fixed', trFl('fld.f_fixed', { n: v.counts.fixed })]]} />
      <div className="mlap-card">
        {v.rows.length ? v.rows.map((c) => (
          <button key={c.id} type="button" className="mlap-row mlap-rowbtn" onClick={() => onOpen(c)}>
            <span className="mlap-ava" aria-hidden="true">{String(c.name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase()}</span>
            <span className="mlap-grow">
              <span className="nm">{c.name}</span>
              <span className="sb">{[c.code, (c.deliveryDays || []).join(' · ')].filter(Boolean).join(' · ')}</span>
              {c.gaps.count > 0 ? <span className="mlap-gapline">{[c.gaps.titik ? trFl('fld.gapTitik') : '', c.gaps.wa ? trFl('fld.gapWa') : '', c.gaps.foto ? trFl('fld.gapFoto') : ''].filter(Boolean).join(' · ')}</span> : null}
            </span>
            <span className="mlap-legleft">
              {c.sisaBon > 0 ? <b className="mlap-bontxt">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <span className="sb">{trFl('fld.noBon')}</span>}
              <span className="sb">{trFl('fld.nGalon', { n: c.gallonsHeld || 0 })}</span>
            </span>
          </button>
        )) : <div className="mlap-empty">{trFl('fld.noCustFilter')}</div>}
      </div>
    </>
  );
}

function FldCustSheet({ cust: c0, can, onClose, onAction }) {
  const c = Object.assign({}, c0, { gaps: c0.gaps || FIELDLOGIC.gapsOf(c0) });
  const links = fldLinks(c);
  const acts = [];
  if (can.sale) acts.push(['sale', 'fld.catatSale', 'primary']);
  if (can.bon && c.sisaBon > 0) acts.push(['bon', 'fld.catatBon', '']);
  if (can.location && c.gaps.count > 0) acts.push(['complete', 'fld.completeData', '']);
  if (can.addStop) acts.push(['addStop', 'fld.addToday', '']);
  if (can.adjust) acts.push(['adjust', 'fld.catatAdj', '']);
  if (can.damage && c.gallonsHeld > 0) acts.push(['damage', 'fld.catatDmg', '']);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={c.name}>
        <div className="mlap-grab" />
        <h2>{c.name}</h2>
        <p>{[c.code, c.address].filter(Boolean).join(' · ')}</p>
        <div className="mlap-links">
          <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
          <a className={'mlap-btn' + (links.tel ? '' : ' off')} href={links.tel || undefined} aria-disabled={!links.tel}>{trFl('fld.call')}</a>
          <a className={'mlap-btn' + (links.wa ? '' : ' off')} href={links.wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.wa}>{trFl('fld.wa')}</a>
        </div>
        <div className="mlap-card mlap-facts">
          <div><span className="sb">{trFl('fld.bonNow')}</span><b>{FIELDLOGIC.fmtRp(c.sisaBon || 0)}</b></div>
          <div><span className="sb">{trFl('fld.heldAt')}</span><b>{c.gallonsHeld == null ? '—' : c.gallonsHeld}</b></div>
          <div><span className="sb">{trFl('fld.dataLabel')}</span><b>{trFl('fld.dataN', { n: 3 - c.gaps.count })}</b></div>
        </div>
        <div className="mlap-actlist">
          {acts.map(([k, key, tone]) => <button key={k} type="button" className={'mlap-btn mlap-wide ' + tone} onClick={() => onAction(k, c)}>{trFl(key)}</button>)}
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
function FldPinMap({ api, cust: c, onDone, onBack }) {
  const had = typeof c.lat === 'number' && typeof c.lng === 'number';
  const [dev, setDev] = uSfl(null);
  const [pin, setPin] = uSfl(had ? { lat: c.lat, lng: c.lng } : null);
  const [mapErr, setMapErr] = uSfl(false);
  const [askFar, setAskFar] = uSfl(false);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [mapReady, setMapReady] = uSfl(false);   // the phone's fix may arrive before or after the map
  const mapEl = uRfl(null);
  const mapRef = uRfl(null);
  const markRef = uRfl(null);
  uEfl(() => { let live = true; fldGeo(12000).then((p) => { if (!live) return; setDev(p); if (p) setPin((cur) => cur || { lat: p.lat, lng: p.lng }); }); return () => { live = false; }; }, []);
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
      const m = L.marker([pin.lat, pin.lng], { draggable: true, keyboard: true, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [30, 30], html: '<span class="mlap-pin drag">●</span>' }) }).addTo(map);
      m.on('dragend', () => { const ll = m.getLatLng(); setPin({ lat: ll.lat, lng: ll.lng }); });
      markRef.current = m;
      map.setView([pin.lat, pin.lng], 18);
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
      .then(() => onDone(trFl('fld.pinSaved', { name: c.name })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.pinT')} sub={[c.name, c.code].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        {mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} sub={trFl('fld.pinNoMap')} /> : (pin ? <div ref={mapEl} className="mlap-map mlap-pinmap" role="application" aria-label={trFl('fld.pinT')} /> : <div className="mlap-empty">{trFl('fld.locating')}</div>)}
        <div className="mlap-hint">{trFl('fld.pinDrag')}</div>
        <div className="mlap-card mlap-sec">
          <div className="mlap-sumrow"><span>{trFl('fld.coords')}</span><b>{pin ? pin.lat.toFixed(6) + ', ' + pin.lng.toFixed(6) : '—'}</b></div>
          <div className="mlap-sumrow"><span>{dev ? trFl('fld.fromDevice', { m: Math.round(dev.accuracy || 0) }) : trFl('fld.noGps')}</span><b>{mv.meters == null ? '—' : trFl('fld.metersN', { m: mv.meters })}</b></div>
          {mv.far ? <div className="mlap-warnline">{trFl('fld.pinFar')}</div> : null}
        </div>
        {mapErr && dev ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setPin({ lat: dev.lat, lng: dev.lng })}>{trFl('fld.useMyLoc')}</button> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !pin} onClick={() => save(false)}>{trFl('fld.savePin')}</button>
      </div>
      {askFar && <FldSheet title={trFl('fld.pinFarT', { m: mv.meters })} body={trFl('fld.pinFarB')} confirmLabel={trFl('fld.savePin')} onClose={() => setAskFar(false)} onConfirm={() => { setAskFar(false); save(true); }} />}
    </div>
  );
}

// TAMBAH STOP — a customer outside today's schedule (or ordered via WhatsApp) as an extra stop. Today's
// stops that have no pin are listed first: they can't join the route until the pin is set. A customer
// picked without a pin goes to the end of the list (not on the route) with a prompt to set it.
function FldAddStop({ api, preset, onPin, onDone, onBack }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [pick, setPick] = uSfl(preset || null);
  const [qty, setQty] = uSfl(1);
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => { let live = true; Promise.all([api.board(), api.customers()]).then(([board, customers]) => { if (live) setD({ board, customers }); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  if (err) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen"><FldTop title={trFl('fld.addStopT')} onBack={onBack} /><div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  const cand = FIELDLOGIC.addStopCandidates({ board: d.board, customers: d.customers, q });
  const pickHasPin = !!pick && typeof pick.lat === 'number' && typeof pick.lng === 'number';
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
                      <button type="button" className="mlap-btn" onClick={() => onPin(fldCustFromStop(s))}>{trFl('fld.setPin')}</button>
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
            {!pickHasPin && <FldNotice tone="warn" title={trFl('fld.pickNoPinT', { name: pick.name })} sub={trFl('fld.pickNoPinB')} action={trFl('fld.setPinNow')} onAction={() => onPin(pick)} />}
            <div className="mlap-card"><FldStepper label={trFl('fld.qtyGalon')} value={qty} onChange={setQty} min={1} max={999} /></div>
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
            <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || qty < 1} onClick={save}>{trFl('fld.addStopCta')}</button>
          </>
        )}
      </div>
    </div>
  );
}
