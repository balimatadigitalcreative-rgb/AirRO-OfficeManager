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

// PEMBAYARAN BON — collect a customer's bon (cash or transfer) with a proof photo. The open bons are
// listed oldest first, as the payment settles them (view only — the server keeps the real balance).
function FldPayBon({ api, cust: c, onDone, onBack }) {
  const [detail, setDetail] = uSfl(null);
  const [pay, setPay] = uSfl(null);
  const [via, setVia] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const refRef = uRfl(FIELDLOGIC.newRef());
  uEfl(() => { let live = true; api.customerDetail(c.id).then((x) => { if (live) setDetail(x); }).catch(() => { if (live) setDetail({ transactions: [] }); }); return () => { live = false; }; }, [api, c.id]);
  const bon = detail && detail.sisaBon != null ? detail.sisaBon : (c.sisaBon || 0);
  const pv = FIELDLOGIC.payPreview({ sisaBon: bon, pay });
  const open = detail ? FIELDLOGIC.openBons(detail.transactions || []) : [];
  const save = () => {
    setBusy(true); setErr('');
    const body = { customerId: c.id, payAmount: pay, payMethod: via, clientRef: refRef.current, proofPhotoId: photo.id, proofTakenAt: photo.takenAt };
    if (typeof photo.lat === 'number' && typeof photo.lng === 'number') { body.proofLat = photo.lat; body.proofLng = photo.lng; }
    api.payBon(body).then(() => onDone(trFl('fld.paidDone', { name: c.name, v: FIELDLOGIC.fmtRp(pay) }))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
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
// changes only after approval (owner rule).
function FldAdjust({ api, cust: c, onDone, onBack }) {
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
      .then(() => onDone(trFl('fld.adjSent', { name: c.name })))
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
        <FldNotice tone="info" title={trFl('fld.adjWaits')} />
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !reasonKey || diff === 0} onClick={send}>{trFl('fld.adjCta')}</button>
      </div>
    </div>
  );
}

const FLD_DMG_KINDS = [['pecah', 'fld.k_pecah'], ['bocor', 'fld.k_bocor'], ['retak', 'fld.k_retak'], ['hilang', 'fld.k_hilang']];
// GANTI RUGI GALON — a borrowed gallon broken or lost at the customer: recorded straight away (no
// approval — owner rule), priced by the owner's setting, paid cash / on bon / by transfer, photo required.
function FldDamage({ api, cust: c, rules, onDone, onBack }) {
  const held = c.gallonsHeld == null ? 0 : c.gallonsHeld;
  const [qty, setQty] = uSfl(1);
  const [kind, setKind] = uSfl('');
  const [pay, setPay] = uSfl('tunai');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const refRef = uRfl(FIELDLOGIC.newRef());
  const pv = FIELDLOGIC.damagePreview({ qty, price: rules.hargaGantiRugiGalon, held, payMethod: pay });
  const save = () => {
    setBusy(true); setErr('');
    api.gallonDamage(c.id, { qty, kind, payMethod: pay, photoId: photo.id, clientRef: refRef.current })
      .then(() => onDone(trFl('fld.dmgDone', { name: c.name, n: qty })))
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
function FldExpense({ api, onDone, onBack }) {
  const [cat, setCat] = uSfl('');
  const [amount, setAmount] = uSfl(null);
  const [liters, setLiters] = uSfl('');
  const [odo, setOdo] = uSfl('');
  const [note, setNote] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [today, setToday] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  uEfl(() => { let live = true; api.daySummary().then((s) => { if (live) setToday(s && s.pengeluaran != null ? s.pengeluaran : null); }).catch(() => {}); return () => { live = false; }; }, [api]);
  const save = () => {
    setBusy(true); setErr('');
    api.addExpense(FIELDLOGIC.expenseBody({ category: cat, amount, liters, odometer: odo, note, photo }))
      .then(() => onDone(trFl('fld.expDone', { v: FIELDLOGIC.fmtRp(amount) })))
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
