// PETA ZONA PELANGGAN — customer points on a real street map, grouped into zones that own the
// delivery schedule (armada + hari kirim) of the customers inside them.
//
// What this screen must never do is change a schedule the owner has not seen: every save first asks
// the server for the change list (dryRun) and shows it; only "Simpan" writes. The server and this
// screen decide membership with the SAME code (dist-zones.js → window.DISTZONE).
//
// The map library (Leaflet) is vendored and loaded only when this screen opens. The street tiles come
// from OpenStreetMap — the one deliberate exception to "no third-party requests", chosen by the owner
// because customers cannot be mapped without streets. Attribution is required and always shown.
const uSz = React.useState, uEz = React.useEffect, uRz = React.useRef, uMz = React.useMemo;
const ZN_DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const ZN_CENTER = [-8.65, 115.22];   // Bali — only until the first customers load and the map fits them

let znLeafletP = null;
function znLoadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (znLeafletP) return znLeafletP;
  znLeafletP = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { znLeafletP = null; reject(new Error('leaflet')); };
    document.head.appendChild(s);
  });
  return znLeafletP;
}
const znEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const znSameDays = (a, b) => (a || []).slice().sort().join() === (b || []).slice().sort().join();
const znCenterOf = (poly) => {
  if (!poly || !poly.length) return null;
  let top = poly[0];
  poly.forEach((p) => { if (p[0] > top[0]) top = p; });                 // label sits at the northern edge
  const lng = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [top[0], lng];
};
// Insert a vertex into the edge nearest to it (so a click on the map while editing "bends" the edge
// the user meant, instead of appending a point that crosses the whole shape).
function znInsertVertex(poly, pt) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const t = Math.max(0, Math.min(1, ((pt[1] - a[1]) * dx + (pt[0] - a[0]) * dy) / ((dx * dx + dy * dy) || 1)));
    const px = a[1] + t * dx, py = a[0] + t * dy;
    const d = (pt[1] - px) ** 2 + (pt[0] - py) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const out = poly.slice(); out.splice(best + 1, 0, pt); return out;
}

// ── One Leaflet map in a div. Returns the map once ready; tears it down on unmount. ────────────────
function useZnMap(elRef, onErr) {
  const [map, setMap] = uSz(null);
  uEz(() => {
    let dead = false, m = null, ro = null;
    znLoadLeaflet().then((L) => {
      if (dead || !elRef.current) return;
      m = L.map(elRef.current, { zoomControl: false }).setView(ZN_CENTER, 12);   // SVG renderer: reliable dashes + hit-testing; hundreds of points are fine
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(m);
      L.control.zoom({ position: 'topright' }).addTo(m);
      if (window.ResizeObserver) { ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(elRef.current); }
      setMap(m);
    }).catch(() => { if (!dead && onErr) onErr(); });
    return () => { dead = true; if (ro) ro.disconnect(); if (m) m.remove(); };
  }, []);
  return map;
}

// ── Change-list preview: what a save will do, before it does it ─────────────────────────────────
function ZnConfirm({ title, changes, applied, busy, onCancel, onConfirm, confirmLabel }) {
  uEz(() => { const o = (e) => e.key === 'Escape' && onCancel(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const rows = changes || [];
  const fmtDays = (d) => (d && d.length ? d.join(', ') : '—');
  return (
    <div className="modal-scrim" onClick={onCancel} style={{ zIndex: 260 }}>
      <div className="modal-card zn-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div><button className="jp-icon" onClick={onCancel} aria-label={trD('dist.cancel')}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div className={'zn-impact' + (rows.length ? ' warn' : '')}>
            {rows.length ? <IconWarn s={16} /> : <IconCheck s={16} />}
            <span>{rows.length ? trD('zn.impactN', { n: applied != null ? applied : rows.length }) : trD('zn.impactNone')}</span>
          </div>
          {rows.length > 0 && (
            <div className="zn-chg">
              <div className="zn-chg-h"><span>{trD('zn.colCustomer')}</span><span>{trD('zn.colZone')}</span><span>{trD('zn.colArmada')}</span><span>{trD('zn.colDays')}</span></div>
              {rows.slice(0, 200).map((c) => (
                <div key={c.id} className="zn-chg-r">
                  <span className="zn-chg-n">{c.code ? <em>{c.code}</em> : null}{c.name}</span>
                  <span className={c.from.zone !== c.to.zone ? 'chg' : ''}>{c.from.zone !== c.to.zone ? (c.from.zone || trD('zn.noZone')) + ' → ' + (c.to.zone || trD('zn.noZone')) : (c.to.zone || trD('zn.noZone'))}</span>
                  <span className={c.from.armada !== c.to.armada ? 'chg' : ''}>{c.from.armada !== c.to.armada ? (c.from.armada || '—') + ' → ' + (c.to.armada || '—') : (c.to.armada || '—')}</span>
                  <span className={!znSameDays(c.from.days, c.to.days) ? 'chg' : ''}>{!znSameDays(c.from.days, c.to.days) ? fmtDays(c.from.days) + ' → ' + fmtDays(c.to.days) : fmtDays(c.to.days)}</span>
                </div>
              ))}
              {rows.length > 200 && <div className="zn-chg-more">{trD('zn.andMore', { n: rows.length - 200 })}</div>}
            </div>
          )}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onCancel}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={onConfirm}>{busy ? '…' : (confirmLabel || trD('zn.save'))}</button></div>
      </div>
    </div>
  );
}

// ── Automatic zones: group the points, preview on a map, then replace the zones ──────────────────
// Two ways to cut the map:
//   'daily' — one zone per (armada, day), each at most `max` customers: the route of one day. The
//             owner sets the daily maximum and which armadas run; days are Senin–Sabtu.
//   'count' — k zones by proximity; armada suggested, days left for the owner.
function ZnAuto({ initialK, armadaOpts, armadaDefault, onClose, onApplied }) {
  const [mode, setMode] = uSz('daily');
  const [k, setK] = uSz(initialK || 5);
  const [max, setMax] = uSz(40);
  const [armadas, setArmadas] = uSz(armadaDefault && armadaDefault.length ? armadaDefault : armadaOpts);
  const [keepManual, setKeepManual] = uSz(true);
  const [prev, setPrev] = uSz(null);
  const [err, setErr] = uSz('');
  const [busy, setBusy] = uSz(false);
  const [confirm, setConfirm] = uSz(false);
  const el = uRz(null);
  const map = useZnMap(el);
  const layer = uRz(null);
  const body = () => (mode === 'daily' ? { mode, maxPerDay: max, armadas, keepManual } : { mode, k, keepManual });
  uEz(() => { const o = (e) => e.key === 'Escape' && !confirm && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, [confirm]);
  uEz(() => {
    let live = true;
    setErr('');
    const t = setTimeout(() => {
      window.API.distribusi.zones.auto(Object.assign(body(), { dryRun: true }))
        .then((r) => { if (live) setPrev(r.data); })
        // A refused preview (e.g. not enough capacity) must not leave the previous one on screen.
        .catch((e) => { if (live) { setPrev(null); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); } });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [mode, k, max, armadas.join('|'), keepManual]);
  uEz(() => {
    if (!map) return;
    const L = window.L;
    if (layer.current) layer.current.remove();
    layer.current = null;
    if (!prev) return;
    const g = L.layerGroup().addTo(map);
    const bounds = [];
    prev.groups.forEach((z) => { if (!z.polygon) return; L.polygon(z.polygon, { color: z.color, weight: 2, fillOpacity: 0.18 }).addTo(g); z.polygon.forEach((p) => bounds.push(p)); });
    layer.current = g;
    if (bounds.length) map.fitBounds(bounds, { padding: [16, 16] });
  }, [map, prev]);
  const apply = () => {
    setBusy(true);
    window.API.distribusi.zones.auto(body())
      .then((r) => { setBusy(false); onApplied(r.data); })
      .catch((e) => { setBusy(false); setConfirm(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr')); });
  };
  const toggleArmada = (a) => setArmadas((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : armadaOpts.filter((x) => x === a || xs.includes(x))));
  const setMaxSafe = (v) => setMax(Math.max(1, Math.min(500, parseInt(v, 10) || 1)));
  const applyLabel = prev ? trD(mode === 'daily' ? 'zn.dailyApply' : 'zn.autoApply', { n: prev.groups.length }) : trD('zn.autoApply', { n: mode === 'daily' ? '…' : k });
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 240 }}>
      <div className="modal-card zn-auto" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('zn.autoTitle')}</div><div className="zn-sub">{trD(mode === 'daily' ? 'zn.dailySub' : 'zn.autoSub')}</div></div>
          <button className="jp-icon" onClick={onClose} aria-label={trD('dist.cancel')}><IconClose s={18} /></button>
        </div>
        <div className="modal-body">
          <div className="zn-seg" role="group" aria-label={trD('zn.autoMode')}>
            <button type="button" className={mode === 'daily' ? 'on' : ''} aria-pressed={mode === 'daily'} onClick={() => setMode('daily')}>{trD('zn.modeDaily')}</button>
            <button type="button" className={mode === 'count' ? 'on' : ''} aria-pressed={mode === 'count'} onClick={() => setMode('count')}>{trD('zn.modeCount')}</button>
          </div>
          {mode === 'daily' ? (
            <div className="zn-auto-ctl">
              <div>
                <label className="fld-label" htmlFor="zn-max">{trD('zn.dailyMax')}</label>
                <div className="zn-step">
                  <button type="button" className="btn btn-ghost" aria-label={trD('zn.autoLess')} disabled={max <= 1} onClick={() => setMaxSafe(max - 5)}>−</button>
                  <input id="zn-max" className="fld zn-num" type="number" inputMode="numeric" min={1} max={500} value={max} onChange={(e) => setMaxSafe(e.target.value)} />
                  <button type="button" className="btn btn-ghost" aria-label={trD('zn.autoMore')} disabled={max >= 500} onClick={() => setMaxSafe(max + 5)}>+</button>
                </div>
              </div>
              <div className="zn-armadas">
                <div className="fld-label">{trD('zn.dailyArmadas')}</div>
                <div className="zn-armada-list">
                  {armadaOpts.map((a) => (
                    <label key={a} className={'zn-armada' + (armadas.includes(a) ? ' on' : '')}><input type="checkbox" checked={armadas.includes(a)} onChange={() => toggleArmada(a)} />{a}</label>
                  ))}
                  {!armadaOpts.length && <span className="zn-mut">{trD('zn.dailyNoArmada')}</span>}
                </div>
              </div>
              <div className="zn-mut zn-days-note">{trD('zn.dailyDays')}</div>
            </div>
          ) : (
            <div className="zn-auto-ctl">
              <div>
                <div className="fld-label">{trD('zn.autoK')}</div>
                <div className="zn-step">
                  <button type="button" className="btn btn-ghost" aria-label={trD('zn.autoLess')} disabled={k <= 1} onClick={() => setK((v) => Math.max(1, v - 1))}>−</button>
                  <b>{k}</b>
                  <button type="button" className="btn btn-ghost" aria-label={trD('zn.autoMore')} disabled={k >= 30} onClick={() => setK((v) => Math.min(30, v + 1))}>+</button>
                </div>
              </div>
            </div>
          )}
          <label className="dist-check"><input type="checkbox" checked={keepManual} onChange={(e) => setKeepManual(e.target.checked)} /><span>{trD('zn.autoKeep')}</span></label>
          <div className="zn-auto-map" ref={el} />
          {err && <div className="add-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
          {prev && (<>
            {prev.capacity && <div className="zn-impact"><IconTruck s={15} /><span>{trD('zn.dailyCapacity', { n: prev.capacity.needed, a: prev.capacity.available })}</span></div>}
            <div className="zn-auto-rows">
              {prev.groups.map((g) => (
                <div key={g.name} className="zn-auto-row">
                  <span className="zn-sw" style={{ background: g.color }} /><b>{g.name}</b>
                  <span className={g.max && g.count + (g.fixed || 0) >= g.max ? 'zn-full' : ''}>{g.max ? (g.fixed ? trD('zn.nPlusFixed', { n: g.count, f: g.fixed, t: g.count + g.fixed, m: g.max }) : trD('zn.nOfMax', { n: g.count, m: g.max })) : trD('zn.nCust', { n: g.count })}</span>
                  <span className="zn-mut">{g.day ? '' : (g.armada ? trD('zn.suggest', { a: g.armada }) : trD('zn.armadaUnset'))}</span>
                </div>
              ))}
            </div>
            {prev.replaces > 0 && <div className="zn-impact warn"><IconWarn s={15} /><span>{trD('zn.autoReplaces', { n: prev.replaces })}</span></div>}
            {prev.locked > 0 && <div className="zn-impact"><IconLock s={15} /><span>{trD('zn.dailyLocked', { n: prev.locked })}</span></div>}
            {prev.fixedCustomers > 0 && <div className="zn-impact"><IconCalendar s={15} /><span>{trD('zn.dailyFixed', { n: prev.fixedCustomers })}</span></div>}
            {prev.sundayVisits > 0 && <div className="zn-impact"><IconWarn s={15} /><span>{trD('zn.dailySunday', { n: prev.sundayVisits })}</span></div>}
            {prev.withoutCoords > 0 && <div className="zn-impact"><IconPin s={15} /><span>{trD('zn.autoNoCoords', { n: prev.withoutCoords })}</span></div>}
            <div className="zn-mut" style={{ marginTop: 6 }}>{trD(mode === 'daily' ? 'zn.dailyNote' : 'zn.autoDaysNote')}</div>
          </>)}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trD('dist.cancel')}</button>
          <button className="btn btn-primary" disabled={!prev || !prev.groups.length} onClick={() => setConfirm(true)}>{applyLabel}</button>
        </div>
      </div>
      {confirm && prev && <ZnConfirm title={applyLabel} changes={prev.changes} busy={busy} onCancel={() => setConfirm(false)} onConfirm={apply} />}
    </div>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────────────────────────
function DistZones({ refreshKey, canManage: capManage, canCustomers, fleet, onChanged, onOpenCustomer }) {
  const [data, setData] = uSz(null);
  const [loadErr, setLoadErr] = uSz(false);
  const [mapErr, setMapErr] = uSz(false);
  const [selId, setSelId] = uSz(null);
  const [filter, setFilter] = uSz('all');   // all | bon | none
  const [q, setQ] = uSz('');
  const [pick, setPick] = uSz(null);         // customer id whose card is open
  const [mode, setMode] = uSz('view');       // view | draw | edit
  const [draft, setDraft] = uSz([]);         // vertices while drawing / editing a boundary
  const [depotMode, setDepotMode] = uSz(false);   // choosing the warehouse on the map (owner/GM)
  const [depotPt, setDepotPt] = uSz(null);         // [lat, lng] picked, not yet saved
  const [form, setForm] = uSz(null);         // { id|null, name, color, armada, days }
  const [confirm, setConfirm] = uSz(null);   // { title, changes, applied, run }
  const [busy, setBusy] = uSz(false);
  const [autoOpen, setAutoOpen] = uSz(false);
  const [moveOpen, setMoveOpen] = uSz(false);
  const [fx, setFx] = uSz(null);           // { id, on, days } — the fixed-days editor, bound to ONE customer
  const [toast, setToast] = uSz('');
  const liveKey = useLiveKey(refreshKey);
  const latest = uRz(window.DISTLIVE.createLatest());
  const fitted = uRz(false);
  const mapEl = uRz(null);
  const map = useZnMap(mapEl, () => setMapErr(true));
  const layers = uRz({});
  const clickRef = uRz(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };
  const errMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || trD('dist.loadErr');
  const reload = () => {
    const t = latest.current.next();
    return window.API.distribusi.zones.list()
      .then((r) => { if (latest.current.isCurrent(t)) { setData(r.data); setLoadErr(false); } })
      .catch(() => { if (latest.current.isCurrent(t)) setLoadErr((prev) => prev || !data); });
  };
  uEz(() => { reload(); }, [liveKey]);

  const canManage = !!(capManage && data && data.canManage);
  const zones = (data && data.zones) || [];
  const custs = (data && data.customers) || [];
  const zoneById = uMz(() => { const m = {}; zones.forEach((z) => { m[z.id] = z; }); return m; }, [data]);
  const sel = selId ? zoneById[selId] : null;
  const members = uMz(() => custs.filter((c) => c.zoneId === selId), [data, selId]);
  const noZoneN = custs.filter((c) => !c.zoneId).length;
  const bonN = custs.filter((c) => c.sisaBon > 0).length;
  const fixedN = custs.filter((c) => c.fixedDays).length;
  const fleetOpts = [...new Set((fleet || []).filter(Boolean).concat(form && form.armada ? [form.armada] : []))];
  // Armadas offered for daily routes: those customers already use, then the rest of the fleet list.
  const armadaOpts = [...new Set(custs.map((c) => c.armada).filter(Boolean).sort().concat((fleet || []).filter(Boolean)))];
  const ql = q.trim().toLowerCase();
  const matches = ql ? custs.filter((c) => (c.name || '').toLowerCase().includes(ql) || (c.code || '').toLowerCase().includes(ql)).slice(0, 8) : [];
  const picked = pick ? custs.find((c) => c.id === pick) : null;

  // The form mirrors the selected zone until the user edits it.
  uEz(() => {
    if (mode !== 'view') return;
    setForm(sel ? { id: sel.id, name: sel.name, color: sel.color, armada: sel.armada, days: sel.deliveryDays } : null);
  }, [selId, data]);
  const dirty = !!(form && (form.id === null || !sel || form.name !== sel.name || form.color !== sel.color || form.armada !== sel.armada || !znSameDays(form.days, sel.deliveryDays)));

  // ── Map layers ────────────────────────────────────────────────────────────────────────────────
  uEz(() => { clickRef.current = (e) => {
    if (depotMode) { setDepotPt([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); return; }
    if (mode === 'draw') setDraft((d) => d.concat([[+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]]));
    else if (mode === 'edit') setDraft((d) => znInsertVertex(d, [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]));
    else setPick(null);
  }; });
  uEz(() => { if (map) map.on('click', (e) => clickRef.current && clickRef.current(e)); }, [map]);

  // Fit the map to the customers once, when they first arrive.
  uEz(() => {
    if (!map || fitted.current || !custs.length) return;
    fitted.current = true;
    map.fitBounds(custs.map((c) => [c.lat, c.lng]), { padding: [30, 30], maxZoom: 15 });
  }, [map, data]);

  uEz(() => {
    if (!map) return;
    const L = window.L;
    const ly = layers.current;
    ['zones', 'custs', 'draw'].forEach((k) => { if (ly[k]) ly[k].remove(); });
    const interactive = mode === 'view' && !depotMode;
    // Zones (the one being re-drawn is shown by the draft instead).
    const zg = L.layerGroup().addTo(map);
    zones.forEach((z) => {
      if (mode === 'edit' && form && z.id === form.id) return;
      const on = z.id === selId;
      const poly = L.polygon(z.polygon, { color: z.color, weight: on ? 3 : 1.5, dashArray: on ? null : '6 4', fillColor: z.color, fillOpacity: on ? 0.2 : 0.08, interactive });
      if (interactive) poly.on('click', (e) => { L.DomEvent.stopPropagation(e); setSelId(z.id); setPick(null); });
      poly.addTo(zg);
      const c = znCenterOf(z.polygon);
      if (c) L.marker(c, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'zn-lbl-wrap', iconSize: null, html: '<span class="zn-lbl' + (on ? ' on' : '') + '" style="--zc:' + znEsc(z.color) + '">' + znEsc(z.name) + ' · ' + (z.count || 0) + '</span>' }) }).addTo(zg);
    });
    ly.zones = zg;
    // Customers.
    const cg = L.layerGroup().addTo(map);
    custs.forEach((c) => {
      const z = c.zoneId ? zoneById[c.zoneId] : null;
      const shown = filter === 'all' || (filter === 'bon' && c.sisaBon > 0) || (filter === 'none' && !c.zoneId) || (filter === 'fixed' && c.fixedDays);
      const dim = !shown ? 0.15 : (selId && c.zoneId !== selId ? 0.5 : 1);
      const isPick = c.id === pick;
      if (c.sisaBon > 0 && shown) L.circleMarker([c.lat, c.lng], { radius: isPick ? 11 : 9, color: '#F7CB6C', weight: 3, fill: false, opacity: dim, interactive: false }).addTo(cg);
      let m;
      if (c.fixedDays) {
        // Fixed-day customers: a labelled marker ("3×") so they stand out from once-a-week customers.
        m = L.marker([c.lat, c.lng], { interactive, keyboard: false, opacity: dim, icon: L.divIcon({ className: 'zn-fx-wrap', iconSize: [30, 20], html: '<span class="zn-fx' + (isPick ? ' on' : '') + '" style="--zc:' + znEsc(z ? z.color : '#5E7480') + '">' + (c.deliveryDays || []).length + '×</span>' }) });
      } else {
        m = L.circleMarker([c.lat, c.lng], z
          ? { radius: isPick ? 8 : 6, color: isPick ? '#06334F' : '#fff', weight: isPick ? 3 : 2, fillColor: z.color, fillOpacity: dim, opacity: dim, interactive }
          : { radius: isPick ? 8 : 6, color: isPick ? '#06334F' : '#5E7480', weight: isPick ? 3 : 2, dashArray: isPick ? null : '2 2', fillColor: '#fff', fillOpacity: dim, opacity: dim, interactive });
      }
      if (interactive) m.on('click', (e) => { L.DomEvent.stopPropagation(e); setPick(c.id); setMoveOpen(false); setFx(null); });
      m.addTo(cg);
    });
    ly.custs = cg;
    // The warehouse every rit starts from — and, while choosing it, the point picked.
    if (ly.depot) ly.depot.remove();
    const dg = L.layerGroup().addTo(map);
    const house = (cls) => L.divIcon({ className: 'zn-depot-wrap', iconSize: [30, 30], html: '<span class="zn-depot' + cls + '" title="' + znEsc(trD('zn.depot')) + '"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 11 12 4l9 7v9H3z\"/><path d=\"M9 20v-6h6v6\"/></svg></span>' });
    if (data && data.depot) L.marker([data.depot.lat, data.depot.lng], { interactive: false, keyboard: false, icon: house('') }).addTo(dg);
    if (depotMode && depotPt) L.marker(depotPt, { interactive: false, keyboard: false, icon: house(' new') }).addTo(dg);
    ly.depot = dg;
    // Draft boundary with its vertices.
    if (mode !== 'view') {
      const dg = L.layerGroup().addTo(map);
      const color = (form && form.color) || '#065489';
      if (draft.length >= 2) (draft.length >= 3 ? L.polygon(draft, { color, weight: 3, fillOpacity: 0.15, interactive: false }) : L.polyline(draft, { color, weight: 3, interactive: false })).addTo(dg);
      draft.forEach((p, i) => {
        const vm = L.marker(p, { draggable: mode === 'edit', keyboard: false, icon: L.divIcon({ className: 'zn-vtx-wrap', iconSize: [22, 22], html: '<span class="zn-vtx" style="--zc:' + znEsc(color) + '"></span>' }) });
        vm.on('click', (e) => L.DomEvent.stopPropagation(e));
        if (mode === 'edit') {
          vm.on('dragend', (e) => { const ll = e.target.getLatLng(); setDraft((d) => d.map((q2, j) => (j === i ? [+ll.lat.toFixed(6), +ll.lng.toFixed(6)] : q2))); });
          // Long-press (touch) / right-click removes a vertex, as long as the shape keeps an area.
          vm.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); setDraft((d) => (d.length > 3 ? d.filter((_, j) => j !== i) : d)); });
        }
        vm.addTo(dg);
      });
      ly.draw = dg;
    }
  }, [map, data, selId, filter, pick, mode, draft, form && form.color, depotMode, depotPt]);

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────
  // Preview first; save straight away only when the preview shows nobody's schedule changes.
  const previewThen = (title, dry, run) => {
    setBusy(true);
    return dry().then((r) => {
      setBusy(false);
      const changes = (r.data && r.data.changes) || [];
      if (!changes.length) return run();
      setConfirm({ title, changes, run });
    }).catch((e) => { setBusy(false); flash(errMsg(e)); });
  };
  const runConfirm = () => {
    const c = confirm; setBusy(true);
    Promise.resolve(c.run()).then(() => { setBusy(false); setConfirm(null); }).catch((e) => { setBusy(false); flash(errMsg(e)); });
  };
  const done = (msg) => { flash(msg); if (onChanged) onChanged(); return reload(); };

  const startDraw = () => {
    setPick(null); setSelId(null); setDraft([]); setMode('draw');
    setForm({ id: null, name: trD('zn.newName', { n: zones.length + 1 }), color: window.DISTZONE.colorAt(zones.length), armada: '', days: [] });
  };
  const startEdit = () => { if (!sel) return; setPick(null); setDraft(sel.polygon.slice()); setMode('edit'); };
  const cancelDraw = () => { setMode('view'); setDraft([]); setForm(sel ? { id: sel.id, name: sel.name, color: sel.color, armada: sel.armada, days: sel.deliveryDays } : null); };
  const finishDraw = () => {
    const v = window.DISTZONE.validatePolygon(draft);
    if (!v.ok) { flash(v.error); return; }
    if (mode === 'draw') { setMode('view'); return; }             // → fill in the new zone's form, then Simpan
    const id = form.id;
    previewThen(trD('zn.saveBoundary'), () => window.API.distribusi.zones.update(id, { polygon: v.polygon, dryRun: true }),
      () => window.API.distribusi.zones.update(id, { polygon: v.polygon }).then(() => { setMode('view'); setDraft([]); return done(trD('zn.saved')); }));
  };
  const saveForm = () => {
    if (!form) return;
    const body = { name: form.name, color: form.color, armada: form.armada, deliveryDays: form.days };
    if (form.id === null) {
      const v = window.DISTZONE.validatePolygon(draft);
      if (!v.ok) { flash(v.error); return; }
      body.polygon = v.polygon;
      previewThen(trD('zn.createTitle', { name: form.name }), () => window.API.distribusi.zones.create(Object.assign({}, body, { dryRun: true })),
        () => window.API.distribusi.zones.create(body).then((r) => { setDraft([]); setSelId(r.data.zone.id); return done(trD('zn.created', { n: r.data.applied })); }));
      return;
    }
    const id = form.id;
    previewThen(trD('zn.saveTitle', { name: form.name }), () => window.API.distribusi.zones.update(id, Object.assign({}, body, { dryRun: true })),
      () => window.API.distribusi.zones.update(id, body).then((r) => done(trD('zn.savedN', { n: r.data.applied }))));
  };
  const removeZone = () => {
    if (!sel) return;
    const id = sel.id, name = sel.name;
    setBusy(true);
    window.API.distribusi.zones.remove(id, true).then((r) => {
      setBusy(false);
      setConfirm({ title: trD('zn.deleteTitle', { name }), changes: r.data.changes, confirmLabel: trD('zn.delete'), run: () => window.API.distribusi.zones.remove(id).then(() => { setSelId(null); return done(trD('zn.deleted')); }) });
    }).catch((e) => { setBusy(false); flash(errMsg(e)); });
  };
  const moveTo = (c, target) => {   // target: zone id | null (out of all zones) | 'auto'
    const body = target === 'auto' ? { customerId: c.id, auto: true } : { customerId: c.id, zoneId: target };
    setMoveOpen(false);
    previewThen(trD('zn.moveTitle', { name: c.name }), () => window.API.distribusi.zones.assign(Object.assign({}, body, { dryRun: true })),
      () => window.API.distribusi.zones.assign(body).then(() => done(trD('zn.moved'))));
  };
  const flyTo = (c) => { setQ(''); setPick(c.id); setSelId(c.zoneId || null); if (map) map.setView([c.lat, c.lng], Math.max(map.getZoom(), 16)); };

  // ── Render ────────────────────────────────────────────────────────────────────────────────────
  if (loadErr && !data) return <div className="card dist-loadfail" style={{ padding: 28, textAlign: 'center' }}><IconWarn s={22} /><div style={{ marginTop: 8 }}>{trD('dist.loadErr')}</div><button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={reload}>{trD('gps.retry')}</button></div>;
  const cov = data ? data.coverage : null;
  const covPct = cov && cov.total ? Math.round((cov.withCoords / cov.total) * 100) : 0;
  const rp = (n) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
  const drawing = mode !== 'view';

  return (
    <div className="dist-dash screen-enter zn-screen">
      <div className="zn-head">
        <div className="zn-title"><h2>{trD('nav.distZones')}</h2><span className="zn-mut">{trD('zn.lead')}</span></div>
        {canManage && !drawing && !depotMode && (
          <div className="zn-head-act">
            <button type="button" className="btn btn-ghost" onClick={() => setAutoOpen(true)} disabled={!custs.length}><IconSparkle s={16} />{trD('zn.auto')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setPick(null); setDepotPt(data && data.depot ? [data.depot.lat, data.depot.lng] : null); setDepotMode(true); }}><IconHome s={16} />{trD('zn.depotSet')}</button>
            <button type="button" className="btn btn-primary" onClick={startDraw}><IconPlus s={16} />{trD('zn.draw')}</button>
          </div>
        )}
      </div>

      <div className={'zn-layout' + (form || drawing ? ' has-side' : '')}>
        {/* Left: coverage + zones */}
        <div className="card zn-list">
          {cov && (
            <div className="zn-cov">
              <div className="zn-cov-top"><span>{trD('zn.covTitle')}</span><b>{cov.withCoords} / {cov.total}</b></div>
              <div className="dist-cov-bar"><span style={{ width: covPct + '%' }} /></div>
              {cov.withoutCoords > 0 && <div className="zn-mut">{trD('zn.covGap', { n: cov.withoutCoords })}</div>}
            </div>
          )}
          <div className="zn-list-h"><b>{trD('zn.zonesN', { n: zones.length })}</b></div>
          {!zones.length && data && <div className="zn-empty">{canManage ? trD('zn.emptyManage') : trD('zn.empty')}</div>}
          <div className="zn-zlist">
            {zones.map((z) => (
              <button key={z.id} type="button" className={'zn-zitem' + (z.id === selId ? ' on' : '')} style={{ '--zc': z.color }} aria-pressed={z.id === selId}
                onClick={() => { if (drawing) return; setSelId(z.id === selId ? null : z.id); setPick(null); if (map && z.id !== selId) map.fitBounds(z.polygon, { padding: [30, 30], maxZoom: 16 }); }}>
                <span className="zn-sw" style={{ background: z.color }} />
                <span className="zn-zitem-m"><b>{z.name}</b><em>{(z.armada || trD('zn.armadaUnset'))} · {z.deliveryDays.length ? z.deliveryDays.join(', ') : trD('zn.daysUnset')}</em></span>
                <span className="zn-zitem-n">{z.count}</span>
              </button>
            ))}
          </div>
          {data && (
            <button type="button" className={'zn-zitem zn-none' + (filter === 'none' ? ' on' : '')} onClick={() => setFilter(filter === 'none' ? 'all' : 'none')} aria-pressed={filter === 'none'}>
              <span className="zn-sw dashed" />
              <span className="zn-zitem-m"><b>{trD('zn.noZone')}</b><em>{trD('zn.noZoneSub')}</em></span>
              <span className="zn-zitem-n">{noZoneN}</span>
            </button>
          )}
        </div>

        {/* Center: map */}
        <div className="card zn-mapcard">
          <div ref={mapEl} className="zn-map" />
          {mapErr && <div className="zn-map-err"><IconWarn s={18} />{trD('zn.mapErr')}</div>}
          {!drawing && !depotMode && (
            <div className="zn-overlay">
              <div className="zn-search">
                <label className="dist-search"><IconSearch s={16} /><input value={q} placeholder={trD('zn.search')} aria-label={trD('zn.search')} onChange={(e) => setQ(e.target.value)} /></label>
                {matches.length > 0 && (
                  <div className="zn-results">{matches.map((c) => <button key={c.id} type="button" onClick={() => flyTo(c)}>{c.code ? <em>{c.code}</em> : null}{c.name}</button>)}</div>
                )}
              </div>
              <div className="dist-chips">
                {[['all', trD('zn.fAll', { n: custs.length })], ['bon', trD('zn.fBon', { n: bonN })], ['fixed', trD('zn.fFixed', { n: fixedN })], ['none', trD('zn.fNone', { n: noZoneN })]].map(([k, l]) => (
                  <button key={k} type="button" className={'dist-chip zn-chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          {depotMode && (
            <div className="zn-drawbar">
              <span>{trD('zn.depotHint')}</span>
              <div className="zn-drawbar-act">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDepotMode(false); setDepotPt(null); }}>{trD('dist.cancel')}</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={!depotPt || busy} onClick={() => { setBusy(true); window.API.distribusi.setDepot(depotPt[0], depotPt[1]).then(() => { setBusy(false); setDepotMode(false); setDepotPt(null); return done(trD('zn.depotSaved')); }).catch((e) => { setBusy(false); flash(errMsg(e)); }); }}><IconCheck s={14} />{trD('zn.depotSave')}</button>
              </div>
            </div>
          )}
          {drawing && (
            <div className="zn-drawbar">
              <span>{mode === 'draw' ? trD('zn.drawHint', { n: draft.length }) : trD('zn.editHint')}</span>
              <div className="zn-drawbar-act">
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelDraw}>{trD('dist.cancel')}</button>
                {mode === 'draw' && <button type="button" className="btn btn-ghost btn-sm" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>{trD('zn.undoPoint')}</button>}
                <button type="button" className="btn btn-primary btn-sm" disabled={draft.length < 3 || busy} onClick={finishDraw}><IconCheck s={14} />{trD('zn.finish')}</button>
              </div>
            </div>
          )}
          {picked && !drawing && (
            <div className="zn-pop">
              <div className="zn-pop-h">
                <span className="dist-txn-av">{initialsOf(picked.name)}</span>
                <div className="zn-pop-m">
                  <div>{picked.code && <span className="dist-code">{picked.code}</span>}<b>{picked.name}</b></div>
                  <em>{picked.zoneId ? (zoneById[picked.zoneId] || {}).name : trD('zn.noZone')}{picked.zoneManual ? ' · ' + trD('zn.manual') : ''} · {picked.armada || '—'} · {picked.deliveryDays.join(', ') || '—'}</em>
                </div>
                <button type="button" className="jp-icon" aria-label={trD('dist.cancel')} onClick={() => setPick(null)}><IconClose s={16} /></button>
              </div>
              {picked.sisaBon > 0 && <div className="zn-pop-bon">{trD('dist.sisaBon')} <b>{rp(picked.sisaBon)}</b></div>}
              {picked.fixedDays && !(fx && fx.id === picked.id) && <div className="zn-pop-fx"><span className="cust-fixed-badge">{trD('cust.fixedBadge')}</span> {picked.deliveryDays.join(', ')}</div>}
              {fx && fx.id === picked.id && (
                <div className="zn-fx-edit">
                  <label className="dist-check"><input type="checkbox" checked={fx.on} onChange={(e) => setFx((f) => ({ ...f, on: e.target.checked }))} /><span>{trD('cust.fixedDays')}</span></label>
                  {fx.on && <div className="zn-days">{ZN_DAYS.map((d) => { const on = fx.days.includes(d); return <button key={d} type="button" className={'zn-day' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setFx((f) => ({ ...f, days: on ? f.days.filter((x) => x !== d) : ZN_DAYS.filter((x) => x === d || f.days.includes(x)) }))}>{d}</button>; })}</div>}
                  <div className="zn-pop-act">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFx(null)}>{trD('dist.cancel')}</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || (fx.on && !fx.days.length)} onClick={() => { setBusy(true); window.API.distribusi.customers.update(fx.id, fx.on ? { fixedDays: true, deliveryDays: fx.days } : { fixedDays: false }).then(() => { setBusy(false); setFx(null); return done(trD('zn.fxSaved')); }).catch((e) => { setBusy(false); flash(errMsg(e)); }); }}>{trD('zn.save')}</button>
                  </div>
                </div>
              )}
              {moveOpen && canManage && (
                <div className="zn-move">
                  {zones.filter((z) => z.id !== picked.zoneId).map((z) => <button key={z.id} type="button" onClick={() => moveTo(picked, z.id)}><span className="zn-sw" style={{ background: z.color }} />{z.name}</button>)}
                  {picked.zoneId && <button type="button" onClick={() => moveTo(picked, null)}><span className="zn-sw dashed" />{trD('zn.moveOut')}</button>}
                  {picked.zoneManual && <button type="button" onClick={() => moveTo(picked, 'auto')}><IconPin s={13} />{trD('zn.followPoint')}</button>}
                </div>
              )}
              <div className="zn-pop-act">
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoveOpen((o) => !o)}>{trD('zn.move')}</button>}
                {canCustomers && !(fx && fx.id === picked.id) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFx({ id: picked.id, on: !!picked.fixedDays, days: picked.deliveryDays.slice() })}>{trD('zn.fxEdit')}</button>}
                <a className="btn btn-ghost btn-sm" href={'https://www.google.com/maps?q=' + picked.lat + ',' + picked.lng} target="_blank" rel="noopener noreferrer"><IconPin s={13} />{trD('dist.directions')}</a>
                {onOpenCustomer && <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenCustomer(picked.id)}>{trD('zn.openCust')}</button>}
              </div>
            </div>
          )}
          <div className="zn-legend">
            <span><i className="zn-lg-dot" />{trD('zn.lgZone')}</span>
            <span><i className="zn-lg-dot none" />{trD('zn.noZone')}</span>
            <span><i className="zn-lg-dot bon" />{trD('zn.lgBon')}</span>
            <span><i className="zn-fx zn-lg-fx" style={{ '--zc': '#065489' }}>3×</i>{trD('zn.lgFixed')}</span>
            <span><i className="zn-lg-depot" />{trD('zn.depot')}</span>
          </div>
        </div>

        {/* Right: the selected (or new) zone */}
        {(form || drawing) && (
          <div className="card zn-side">
            {drawing && mode === 'draw' ? (
              <div className="zn-side-draw">
                <b>{trD('zn.drawTitle')}</b>
                <p>{trD('zn.drawHelp')}</p>
              </div>
            ) : drawing ? (
              <div className="zn-side-draw"><b>{trD('zn.editTitle', { name: form ? form.name : '' })}</b><p>{trD('zn.editHelp')}</p></div>
            ) : form && (<>
              <div className="zn-side-h">
                <span className="zn-sw lg" style={{ background: form.color }} />
                {canManage
                  ? <input className="fld zn-name" value={form.name} maxLength={60} aria-label={trD('zn.name')} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  : <h3>{form.name}</h3>}
                {canManage && form.id && <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>{trD('zn.editBoundary')}</button>}
              </div>
              {canManage && (
                <div className="zn-colors" role="group" aria-label={trD('zn.color')}>
                  {window.DISTZONE.PALETTE.map((c) => <button key={c} type="button" className={'zn-color' + (form.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} aria-pressed={form.color === c} onClick={() => setForm((f) => ({ ...f, color: c }))} />)}
                </div>
              )}
              {form.id && sel && (
                <div className="zn-stats">
                  <div><span>{trD('zn.statCust')}</span><b>{sel.count}</b></div>
                  <div><span>{trD('zn.statBon')}</span><b>{rp(sel.sisaBon)}</b></div>
                </div>
              )}
              <label className="fld-label">{trD('zn.armada')}</label>
              <select className="fld" value={form.armada} disabled={!canManage} onChange={(e) => setForm((f) => ({ ...f, armada: e.target.value }))}>
                <option value="">{trD('zn.armadaUnsetOpt')}</option>
                {fleetOpts.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <div className="fld-label">{trD('zn.days')}</div>
              <div className="zn-days" role="group" aria-label={trD('zn.days')}>
                {ZN_DAYS.map((d) => {
                  const on = form.days.includes(d);
                  return <button key={d} type="button" className={'zn-day' + (on ? ' on' : '')} aria-pressed={on} disabled={!canManage}
                    onClick={() => setForm((f) => ({ ...f, days: on ? f.days.filter((x) => x !== d) : ZN_DAYS.filter((x) => x === d || f.days.includes(x)) }))}>{d}</button>;
                })}
              </div>
              <div className="zn-mut zn-rule">{trD('zn.rule')}</div>
              {form.id && (<>
                <div className="zn-mem-h"><b>{trD('zn.members')}</b><span className="zn-mut">{members.length}</span></div>
                <div className="zn-mem">
                  {members.slice(0, 60).map((c) => (
                    <button key={c.id} type="button" className="zn-mem-r" onClick={() => flyTo(c)}>
                      <span className="dist-txn-av">{initialsOf(c.name)}</span>
                      <span className="zn-mem-m"><b>{c.name}</b><em>{c.code}{c.zoneManual ? ' · ' + trD('zn.manual') : ''}</em></span>
                      {c.sisaBon > 0 && <span className="zn-mem-bon">{rp(c.sisaBon)}</span>}
                    </button>
                  ))}
                  {members.length > 60 && <div className="zn-mut" style={{ padding: 8 }}>{trD('zn.andMore', { n: members.length - 60 })}</div>}
                </div>
              </>)}
              {canManage && (
                <div className="zn-side-act">
                  {form.id && <button type="button" className="btn btn-danger" disabled={busy} onClick={removeZone}>{trD('zn.delete')}</button>}
                  {form.id === null && <button type="button" className="btn btn-ghost" onClick={() => { setForm(null); setDraft([]); }}>{trD('dist.cancel')}</button>}
                  <button type="button" className="btn btn-primary" disabled={!dirty || busy || !String(form.name).trim()} onClick={saveForm}>{busy ? '…' : form.id === null ? trD('zn.createBtn') : trD('zn.save')}</button>
                </div>
              )}
            </>)}
          </div>
        )}
      </div>

      {confirm && <ZnConfirm title={confirm.title} changes={confirm.changes} confirmLabel={confirm.confirmLabel} busy={busy} onCancel={() => setConfirm(null)} onConfirm={runConfirm} />}
      {autoOpen && <ZnAuto initialK={zones.length || 5} armadaOpts={armadaOpts} armadaDefault={[...new Set(custs.map((c) => c.armada).filter(Boolean))].sort()} onClose={() => setAutoOpen(false)} onApplied={(r) => { setAutoOpen(false); setSelId(null); done(trD('zn.autoDone', { z: (r.zones || []).length, n: r.applied })); }} />}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

window.DIST = Object.assign(window.DIST || {}, { Zones: DistZones });
