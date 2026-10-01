/* MODE LAPANGAN — KIT: the small pieces every field screen shares (sheet, header, stepper, segmented
   control, reason chips, notice, the stamped proof photo, Navigasi/Telepon/WA links). The bundle shares
   one scope across files, so every top-level name here is unique (Fld*, fld*, *fl). */
const { useState: uSfl, useEffect: uEfl, useRef: uRfl } = React;
const trFl = (k, v) => window.t(k, v);
const fldPlates = (list) => (list || []).map((f) => (typeof f === 'string' ? f : (f && (f.plate || f.name || f.id)) || '')).map((s) => String(s).trim()).filter(Boolean);
const fldErrMsg = (e) => (e && e.body && e.body.error && e.body.error.message) || (e && e.message) || '';
const FldIco = (name, s) => { const C = window[name]; return C ? <C s={s || 20} /> : null; };

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

function FldTop({ title, sub, onBack }) {
  return (
    <div className="mlap-top">
      {onBack && <button type="button" className="mlap-round" aria-label={trFl('fld.back')} onClick={onBack}><span aria-hidden="true" className="mlap-chev">‹</span></button>}
      <div className="mlap-top-t"><h1>{title}</h1>{sub && <div className="mlap-top-sub">{sub}</div>}</div>
    </div>
  );
}

// The number can be cleared and retyped (a typed "4" never becomes "14"); it clamps when the field
// is left. The −/+ buttons always step from the last valid value.
function FldStepper({ label, hint, value, onChange, min, max }) {
  const lo = min == null ? 0 : min; const hi = max == null ? 999 : max;
  const [draft, setDraft] = uSfl(null);   // the text while typing; null = show the value
  const set = (v) => { setDraft(null); onChange(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))); };
  const typed = (text) => { const r = FIELDLOGIC.stepInput(text, lo, hi); setDraft(r.draft); if (r.value != null) onChange(r.value); };
  const leave = () => { if (draft === null) return; const r = FIELDLOGIC.stepInput(draft, lo, hi); setDraft(null); onChange(r.value != null ? r.value : lo); };
  return (
    <div className="mlap-stepper">
      <span className="lb">{label}{hint ? <span className="ht">{hint}</span> : null}</span>
      <button type="button" className="mlap-step" aria-label={trFl('fld.less') + ' — ' + label} disabled={value <= lo} onClick={() => set(value - 1)}>−</button>
      <input className="mlap-stepval" inputMode="numeric" aria-label={label} value={draft !== null ? draft : value} onChange={(e) => typed(e.target.value)} onBlur={leave} />
      <button type="button" className="mlap-step" aria-label={trFl('fld.more') + ' — ' + label} disabled={value >= hi} onClick={() => set(value + 1)}>+</button>
    </div>
  );
}

function FldSeg({ label, options, value, onChange }) {
  return (
    <div className="mlap-seg" role="group" aria-label={label}>
      {options.map(([k, text]) => <button key={k} type="button" aria-pressed={value === k} className={'mlap-seg-b' + (value === k ? ' on' : '')} onClick={() => onChange(k)}>{text}</button>)}
    </div>
  );
}

// Single choice of a written reason; the "other" option opens a text field (value = the final text).
function FldChips({ options, otherLabel, value, onChange }) {
  const [other, setOther] = uSfl(false);
  const pick = (o) => { if (o === otherLabel) { setOther(true); onChange(''); } else { setOther(false); onChange(o); } };
  return (
    <div className="mlap-chips">
      {options.map((o) => {
        const on = o === otherLabel ? other : (!other && value === o);
        return <button key={o} type="button" aria-pressed={on} className={'mlap-chip-b' + (on ? ' on' : '')} onClick={() => pick(o)}>{o}</button>;
      })}
      {other && <input className="mlap-text" placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.writeReason')} value={value} onChange={(e) => onChange(e.target.value.slice(0, 300))} />}
    </div>
  );
}

function FldNotice({ tone, title, sub, action, onAction }) {
  return (
    <div className={'mlap-notice ' + (tone || 'info')} role={tone === 'warn' ? 'alert' : 'status'}>
      <span className="mlap-grow"><b>{title}</b>{sub ? <span className="sb">{sub}</span> : null}</span>
      {action && onAction ? <button type="button" className="mlap-btn" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

// PROOF PHOTO — rear camera, shrunk to ≤1024 px (the app's shrinkToJpeg), uploaded through the
// adaptor (practice photos stay on the phone), stamped with the time and, when the phone gives one,
// a GPS fix. Gallery photos can't be blocked on the web; the stamp records when/where it was attached.
function FldPhoto({ api, value, onChange, hintKey }) {
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
  return (
    <div className="mlap-card mlap-photo">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      {value ? (
        <div className="mlap-photo-has">
          <img src={value.preview} alt={trFl('fld.proof')} />
          <span className="mlap-grow"><b>{trFl('fld.photoTaken')}</b><span className="sb">{stamp}</span></span>
          <button type="button" className="mlap-btn" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>{trFl('fld.retake')}</button>
        </div>
      ) : (
        <button type="button" className="mlap-photo-btn" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
          {FldIco('IconPlus', 22)}<b>{busy ? trFl('fld.photoBusy') : trFl('fld.camera')}</b>
          <span className="sb">{trFl(hintKey || 'fld.proofHint')}</span>
        </button>
      )}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </div>
  );
}
