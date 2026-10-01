/* MODE LAPANGAN — KIT: the small pieces every field screen shares (sheet, header, stepper, segmented
   control, reason chips, notice, the stamped proof photo, Navigasi/Telepon/WA links). The bundle shares
   one scope across files, so every top-level name here is unique (Fld*, fld*, *fl). */
const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;
const trFl = (k, v) => window.t(k, v);
const fldPlates = (list) => (list || []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean);
const fldErrMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || '';
const FldIco = (name, s) => { const C = window[name]; return C ? <C s={s || 20} /> : null; };

function FldSheet({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  const drag = useFldSheetDrag(onClose);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
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

// One position fix for a stamp; null when the phone has no location or the user said no.
const fldGeo = (ms) => new Promise((res) => {
  const geo = typeof navigator !== 'undefined' && navigator.geolocation;
  if (!(geo && geo.getCurrentPosition)) { res(null); return; }
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms || 8000);
  geo.getCurrentPosition(
    (p) => { if (done) return; done = true; clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
    () => { if (done) return; done = true; clearTimeout(t); res(null); },
    { enableHighAccuracy: true, timeout: ms || 8000, maximumAge: 60000 });
});

// Navigasi / Telepon / WhatsApp for a stop. WhatsApp goes through the app's ONE guarded wa.me gate.
const fldLinks = (s) => {
  const x = s || {};
  const hasPt = typeof x.lat === 'number' && typeof x.lng === 'number';
  const nav = x.mapsLink || (hasPt ? 'https://www.google.com/maps/dir/?api=1&destination=' + x.lat + ',' + x.lng : '');
  const digits = String(x.phone || '').replace(/[^0-9+]/g, '');
  return { nav, tel: digits ? 'tel:' + digits : '', wa: typeof waHref === 'function' ? waHref(x.phone) : '' };
};

// A button-styled link; with nowhere to go it is a disabled span (a disabled <a> without href is still
// announced as a link and focusable on some readers).
function FldLinkBtn({ href, className, newTab, children }) {
  if (!href) return <span className={className + ' off'} aria-disabled="true">{children}</span>;
  return <a className={className} href={href} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}>{children}</a>;
}

// Task screens (mockup): a glass "Batal" pill on the left — or a round back chevron for screens you only
// read (kind 'back') — the title centred, and a soft fade so the content scrolls under it.
function FldTop({ title, sub, onBack, kind, backLabel }) {
  return (
    <div className="mlap-top">
      {onBack ? (kind === 'back'
        ? <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><FldSvg n="back" s={18} sw={2.4} /></button>
        : <button type="button" className="mlap-pill" onClick={onBack}>{backLabel || trFl('fld.cancel')}</button>) : <span aria-hidden="true" />}
      <div className="mlap-top-t"><h1>{title}</h1>{sub && <div className="mlap-top-sub">{sub}</div>}</div>
      <span aria-hidden="true" />
    </div>
  );
}

// The fixed bottom action of a task screen (mockup): its hint above it, a fade under the content.
function FldCtaBar({ hint, children }) {
  return (
    <>
      <div className="mlap-ctafade" aria-hidden="true" />
      <div className="mlap-ctabar">
        {hint ? <span className="mlap-ctahint">{hint}</span> : null}
        {children}
      </div>
    </>
  );
}

// The glass round close button of a sheet (mockup).
function FldCloseX({ onClick, label }) {
  return <button type="button" className="mlap-closex" aria-label={label || trFl('fld.close')} onClick={onClick}><FldSvg n="close" s={14} sw={2.6} /></button>;
}

// A task screen's customer (mockup Transaksi / Bayar bon / Lengkapi): the name at 22 px, one sub line,
// an optional item on the right (a progress badge, "Ganti pelanggan").
function FldCustHead({ name, sub, aside }) {
  return (
    <div className="mlap-custhead">
      <span className="mlap-grow"><span className="mlap-custhead-nm">{name}</span>{sub ? <span className="mlap-custhead-sb">{sub}</span> : null}</span>
      {aside || null}
    </div>
  );
}

// A sheet's head (mockup Stop / Buka rit / Tambah stop): optional lead (the 38 px stop number), the
// title, one sub line, the glass close X.
function FldSheetHead({ title, sub, lead, onClose, big }) {
  return (
    <div className={'mlap-sheethd' + (big ? ' big' : '')}>
      {lead || null}
      <span className="mlap-grow"><span className="mlap-sheethd-t">{title}</span>{sub ? <span className="mlap-sheethd-sb">{sub}</span> : null}</span>
      <FldCloseX onClick={onClose} />
    </div>
  );
}

// A list choice in a sheet (instead of a <select>, which the boards never show): radio rows.
function FldPickSheet({ title, options, value, onPick, onClose }) {
  const drag = useFldSheetDrag(onClose);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={title} onClose={onClose} />
        <div className="mlap-card mlap-picklist">
          {options.map((o) => (
            <button key={o} type="button" className={'mlap-pickrow' + (value === o ? ' on' : '')} aria-pressed={value === o} onClick={() => onPick(o)}>
              <span className="mlap-radio" aria-hidden="true" /><span className="mlap-grow">{o}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// "Selasa, 30 Sep" in the screen's language (the eyebrow upper-cases it).
const fldDayLabel = (iso) => { try { return new Date(iso + 'T00:00').toLocaleDateString(trFl('fld.locale'), { weekday: 'long', day: 'numeric', month: 'short' }); } catch (e) { return iso; } };
// The number can be cleared and retyped (a typed "4" never becomes "14"); it clamps when the field
// is left. The −/+ buttons always step from the last valid value. Drawn like the boards: a gray −, a
// tinted +, the value between. `cls`: 'big' (Buka rit's 44 px load), 'under' (below SOP), 'teal' (+).
function FldStepper({ label, hint, value, onChange, min, max, cls }) {
  const lo = min == null ? 0 : min; const hi = max == null ? 999 : max;
  const [draft, setDraft] = uSfl(null);   // the text while typing; null = show the value
  const set = (v) => { setDraft(null); onChange(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))); };
  const typed = (text) => { const r = FIELDLOGIC.stepInput(text, lo, hi); setDraft(r.draft); if (r.value != null) onChange(r.value); };
  const leave = () => { if (draft === null) return; const r = FIELDLOGIC.stepInput(draft, lo, hi); setDraft(null); onChange(r.value != null ? r.value : lo); };
  const ico = cls && cls.split(' ').indexOf('big') >= 0 ? 18 : 16;
  return (
    <div className={'mlap-stepper' + (cls ? ' ' + cls : '')}>
      <span className="lb">{label}{hint ? <span className="ht">{hint}</span> : null}</span>
      <button type="button" className="mlap-step minus" aria-label={trFl('fld.less') + ' — ' + label} disabled={value <= lo} onClick={() => set(value - 1)}><FldSvg n="minus" s={ico} sw={2.6} /></button>
      <input className="mlap-stepval" inputMode="numeric" aria-label={label} value={draft !== null ? draft : value} onChange={(e) => typed(e.target.value)} onBlur={leave} />
      <button type="button" className="mlap-step plus" aria-label={trFl('fld.more') + ' — ' + label} disabled={value >= hi} onClick={() => set(value + 1)}><FldSvg n="plus" s={ico} sw={2.6} /></button>
    </div>
  );
}

function FldSeg({ label, options, value, onChange, size }) {
  return (
    <div className={'mlap-seg' + (size ? ' ' + size : '')} role="group" aria-label={label}>
      {options.map(([k, text]) => <button key={k} type="button" aria-pressed={value === k} className={'mlap-seg-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{text}</button>)}
    </div>
  );
}

// Single choice of a written reason; the "other" option opens a text field (value = the final text).
function FldChips({ options, otherLabel, value, onChange, tone }) {
  const [other, setOther] = uSfl(false);
  const pick = (o) => { if (o === otherLabel) { setOther(true); onChange(''); } else { setOther(false); onChange(o); } };
  return (
    <div className={'mlap-chips' + (tone ? ' ' + tone : '')}>
      {options.map((o) => {
        const on = o === otherLabel ? other : (!other && value === o);
        return <button key={o} type="button" aria-pressed={on} className={'mlap-chip-b' + (on ? ' on' : '')} onClick={() => pick(o)}>{o}</button>;
      })}
      {other && <input className="mlap-text" placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.writeReason')} value={value} onChange={(e) => onChange(e.target.value.slice(0, 300))} />}
    </div>
  );
}

// A standing notice (mockup info/warn cards): icon, title, one line. `alert` only for errors — a standing
// notice must not interrupt a screen reader.
function FldNotice({ tone, title, sub, action, onAction, alert }) {
  const t = tone || 'info';
  return (
    <div className={'mlap-notice ' + t} role={alert ? 'alert' : 'note'}>
      <FldSvg n={t === 'warn' ? 'warn' : t === 'ok' ? 'check' : 'info'} s={16} sw={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
      <span className="mlap-grow"><b>{title}</b>{sub ? <span className="sb">{sub}</span> : null}</span>
      {action && onAction ? <button type="button" className="mlap-btn" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

// PROOF PHOTO (mockup photo card) — rear camera, shrunk to ≤1024 px (the app's shrinkToJpeg), uploaded
// through the adaptor (practice photos stay on the phone), stamped with the time and, when the phone
// gives one, a GPS fix. Gallery photos can't be blocked on the web; the stamp records when/where it was
// attached. Card: title + red "Wajib …" label, the stamped thumbnail, a dashed camera tile, the hint.
function FldPhoto({ api, value, onChange, hintKey, title, req, w, h, optional }) {
  const inputRef = uRfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const geoP = fldGeo(8000);
      const src = await readDataURL(file);
      const img = await loadImage(src);
      const data = shrinkToJpeg(img);
      const up = await api.uploadPhoto({ name: 'bukti.jpg', mime: 'image/jpeg', isImg: true, data });
      const pos = await geoP;
      onChange({ id: up.id, takenAt: new Date().toISOString(), lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, preview: data });
    } catch (ex) {
      setErr(fldErrMsg(ex) || trFl('fld.photoErr'));
    }
    setBusy(false);
  };
  const stamp = value ? new Date(value.takenAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' · ' + (value.lat != null ? trFl('fld.gpsOk') : trFl('fld.gpsNo')) : '';
  const pw = w || 76; const ph = h || pw;
  const missing = !value && !optional;
  return (
    <div className={'mlap-card mlap-photo' + (missing ? ' miss' : '')}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <div className="mlap-photo-hd"><b>{title || trFl('fld.proof')}</b><span className={'mlap-photo-req' + (optional ? ' opt' : '')}>{req || trFl(optional ? 'fld.reqSuggest' : 'fld.reqPlain')}</span></div>
      <div className="mlap-photo-row">
        {value ? <span className="mlap-photo-thumb" style={{ width: pw, height: ph }}><img src={value.preview} alt={trFl('fld.photoTaken')} /><span className="mlap-stamp">{stamp}</span></span> : null}
        <button type="button" className={'mlap-cam' + (missing ? ' miss' : '')} style={{ width: pw, height: ph }} disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          <FldSvg n="camera" s={20} />{busy ? trFl('fld.photoBusy') : value ? trFl('fld.retake') : trFl('fld.cam')}
        </button>
        <span className="mlap-photo-hint">{trFl(hintKey || 'fld.proofHint')}</span>
      </div>
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </div>
  );
}

// Which field actions this account may use — the same caps the server checks, so a button never ends
// in a 403.
const fldCan = (perms) => {
  const p = perms || {};
  return {
    sale: !!p.distribusiInput, bon: !!p.distribusiInput, damage: !!p.distribusiInput,
    adjust: !!p.distribusiPenyesuaianGalon, expense: !!p.distribusiExpense,
    addStop: !!p.distribusiOrder, location: !!p.distribusiLokasiSimpan,
    correct: !!p.distribusiKoreksi, void: !!p.distribusiVoid,
  };
};
// The customer behind a board stop, in the shape the customer screens use.
const fldCustFromStop = (s) => ({
  id: s.customerId, name: s.customerName, code: s.customerCode || '', address: s.address || '', phone: s.phone || '',
  lat: s.lat, lng: s.lng, locationPhotoId: s.locationPhotoId || null, masterPrice: s.masterPrice || 0,
  sisaBon: s.sisaBon || 0, gallonsHeld: s.gallonsHeld, armada: s.fleetId || '',
});

// Rupiah amount (mockup Bayar bon / Pengeluaran): a big 30 px number after "Rp"; shows 45.000, can be
// cleared while typing (value null = nothing typed yet).
function FldMoney({ label, value, onChange }) {
  const shown = value == null ? '' : Number(value).toLocaleString('id-ID');
  return (
    <label className="mlap-money">
      <span className="lb">{label}</span>
      <span className="mlap-money-in"><span className="rp" aria-hidden="true">Rp</span>
        <input className="mlap-money-val" inputMode="numeric" aria-label={label} value={shown} onChange={(e) => { const d = String(e.target.value).replace(/[^0-9]/g, '').slice(0, 10); onChange(d === '' ? null : parseInt(d, 10)); }} />
      </span>
    </label>
  );
}

// PILIH PELANGGAN — search the armada's customers; `accept(c)` returns '' or the key saying why this
// customer can't be chosen for this action (the row stays visible, disabled, with the reason).
function FldPickCustomer({ api, title, hint, accept, onPick, onBack }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api]);
  const rows = list ? FIELDLOGIC.customerList(list, { q, filter: 'all' }).rows : [];
  return (
    <div className="mlap-screen">
      <FldTop title={title} sub={hint} onBack={onBack} />
      <div className="mlap-body">
        <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
        {err ? <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /> : null}
        {!list && !err ? <div className="mlap-empty">{trFl('fld.loading')}</div> : null}
        {list ? (
          <div className="mlap-card">
            {rows.length ? rows.map((c) => {
              const why = accept ? accept(c) : '';
              return (
                <button key={c.id} type="button" className="mlap-row mlap-rowbtn" disabled={!!why} onClick={() => onPick(c)}>
                  <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{why ? trFl(why) : [c.code, c.sisaBon > 0 ? trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(c.sisaBon) }) : ''].filter(Boolean).join(' · ')}</span></span>
                </button>
              );
            }) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// THE DOCK (mockup "Dock bar + animasi"): glass tabs with a liquid selection that springs to the tab and
// stretches 1.4× / squashes .82 while it travels (300 ms), a one-shot sheen across the dock, and the
// centre Catat button — the one tinted glass control — with its periodic sheen and its +→× turn.
function FldDock({ tabs, tab, onTab, labelOf, catat, onCatat }) {
  const navRef = uRfl(null);
  const [geo, setGeo] = uSfl(null);
  const [moving, setMoving] = uSfl(false);
  const prev = uRfl(tab);
  const measure = () => {
    const n = navRef.current; if (!n) return;
    setGeo([].slice.call(n.querySelectorAll('.mlap-tab')).map((b) => ({ left: b.offsetLeft, width: b.offsetWidth })));
  };
  uEfl(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, []);
  uEfl(() => {
    if (prev.current === tab) return undefined;
    prev.current = tab;
    setMoving(true); const t = setTimeout(() => setMoving(false), 300);
    return () => clearTimeout(t);
  }, [tab]);
  const idx = tabs.filter(Boolean).findIndex((t) => t[0] === tab);
  const g = geo && idx >= 0 ? geo[idx] : null;
  const w = g ? g.width * (moving ? 1.4 : 1) : 0;
  return (
    <>
      <nav ref={navRef} className="mlap-dock" aria-label={trFl('fld.nav')}>
        {g ? <span aria-hidden="true" className="mlap-blob" style={{ left: g.left - (w - g.width) / 2, width: w, transform: 'scaleY(' + (moving ? 0.82 : 1) + ')' }} /> : null}
        {moving ? <span aria-hidden="true" className="mlap-dock-sheen" /> : null}
        {tabs.map((t, i) => (t ? (
          <button key={t[0]} type="button" className={'mlap-tab' + (tab === t[0] ? ' on' : '')} aria-current={tab === t[0] ? 'page' : undefined} onClick={() => onTab(t[0])}>
            <FldSvg n={t[1]} s={20} sw={tab === t[0] ? 2.3 : 1.9} /><span>{labelOf(t[0])}</span>
          </button>
        ) : <span key={'gap' + i} aria-hidden="true" />))}
      </nav>
      <button type="button" className={'mlap-catat' + (catat ? ' open' : '')} aria-label={trFl('fld.tabCatat')} aria-expanded={catat} onClick={onCatat}>
        <span aria-hidden="true" className="mlap-sheen" />
        <FldSvg n="plus" s={24} sw={2.6} />
      </button>
    </>
  );
}

// Pull a sheet down by its grabber to close it (mockup grabbers): it follows the finger; past the line
// (or on a flick) it slides away, otherwise it springs back.
function useFldSheetDrag(onClose) {
  const ref = uRfl(null); const st = uRfl(null); const touched = uRfl(false);
  const [dy, setDy] = uSfl(0);
  const [leaving, setLeaving] = uSfl(false);
  const down = (e) => { st.current = { y: e.clientY, t: Date.now() }; touched.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ } };
  const move = (e) => { if (st.current) setDy(Math.max(0, e.clientY - st.current.y)); };
  const up = (e) => {
    const s = st.current; st.current = null; if (!s) return;
    const d = Math.max(0, e.clientY - s.y);
    const r = FIELDLOGIC.dragRelease({ dy: d, ms: Date.now() - s.t, height: ref.current ? ref.current.offsetHeight : 600 });
    // a sheet that stays mounted (the ⋯ menu) must open normally next time
    if (r === 'close') { setLeaving(true); setTimeout(() => { setLeaving(false); setDy(0); touched.current = false; onClose(); }, 220); } else setDy(0);
  };
  const style = leaving ? { transform: 'translate(-50%, 110%)', transition: 'transform .22s ease-in', animation: 'none' }
    : dy ? { transform: 'translate(-50%, ' + dy + 'px)', transition: 'none', animation: 'none' }
      // after a pull: spring back to place — never replay the entrance pop
      : touched.current ? { animation: 'none', transform: 'translate(-50%, 0)', transition: 'transform .3s cubic-bezier(.34,1.3,.64,1)' } : undefined;
  return { ref, style, handle: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: () => { st.current = null; setDy(0); } } };
}
function FldGrab({ handle }) {
  return <div className="mlap-grabzone" {...handle}><div className="mlap-grab" /></div>;
}
