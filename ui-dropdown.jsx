/* global React */
/* AirRO — reusable custom dropdown (Semantic-UI-style menu). window.UI.Dropdown */
const { useState: uSd, useRef: uRd, useEffect: uEd } = React;
function IcD(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

function Dropdown({ value, options, onChange, placeholder, compact, color, fluid, menuColor }) {
  const [open, setOpen] = uSd(false);
  const [pos, setPos] = uSd(null);   // fixed coords {left, top, width} from the control
  const btnRef = uRd(null);
  const norm = (options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const sel = norm.find((o) => o.value === value);
  // Float the menu with position:fixed anchored to the control (portaled to <body>),
  // so it's never clipped by a modal's overflow — same pattern as the calendar/time
  // picker. The menu keeps its own max-height + internal scroll for long lists.
  uEd(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = btnRef.current; if (!el) return;
      // desktop-scale.css sets html{zoom}; rect is visual px, fixed left/top get
      // re-scaled by zoom → work in visual px then divide back.
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const r = el.getBoundingClientRect();
      const M = 8;
      const hCss = Math.min(norm.length * 38 + 10, 272);   // menu height estimate (CSS px)
      const H = hCss * zoom, vw = window.innerWidth * zoom, vh = window.innerHeight * zoom;
      let left = Math.max(M, Math.min(r.left, vw - r.width - M));
      let top = r.bottom + 4;
      if (top + H > vh - M) { const up = r.top - 4 - H; top = up >= M ? up : Math.max(M, vh - H - M); }
      setPos({ left: left / zoom, top: top / zoom, width: r.width / zoom });
    };
    place();
    const on = () => place();
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', on); window.addEventListener('scroll', on, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`ui-dd ${open ? 'open' : ''} ${compact ? 'compact' : ''} ${fluid ? 'fluid' : ''}`}>
      <button type="button" ref={btnRef} className="ui-dd-control" onClick={() => setOpen((o) => !o)}
        style={color ? { color, background: menuColor || 'transparent' } : null}>
        <span className={`ui-dd-text ${sel ? '' : 'ph'}`}>{sel ? sel.label : (placeholder || '')}</span>
        <IconCaret s={compact ? 13 : 15} style={{ flexShrink: 0, color: color || 'var(--text-mut)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && ReactDOM.createPortal(
        <React.Fragment>
          <div className="pop-cal-backdrop dd-back" onClick={() => setOpen(false)} />
          <div className="ui-dd-menu ui-dd-menu-fixed scroll-y" style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}>
            {norm.map((o) => (
              <button type="button" key={o.value} className={`ui-dd-item ${o.value === value ? 'on' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                {o.icon ? <span className="ui-dd-ic">{IcD(o.icon, { s: 16 })}</span> : null}
                <span style={{ flex: 1, minWidth: 0 }}>{o.label}</span>
                {o.value === value && <IconCheck s={15} />}
              </button>
            ))}
          </div>
        </React.Fragment>, document.body)}
    </div>
  );
}
function TimePicker({ value, onChange, compact, color, menuColor, placeholder }) {
  const [open, setOpen] = uSd(false);
  const [pos, setPos] = uSd(null);   // { left, top } fixed coords computed from the button
  const btnRef = uRd(null);
  // Float the menu with position:fixed anchored to the button, clamped to the
  // viewport and flipped above when the space below is tight — same idea as the
  // DateField pop-cal, so it never grows/covers the card layout.
  const place = () => {
    const el = btnRef.current; if (!el) return;
    // Compensate for desktop-scale.css `html { zoom }`: getBoundingClientRect is in
    // visual px, but a fixed element's left/top get re-scaled by the zoom.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = el.getBoundingClientRect();
    const W = 268 * zoom, H = 300 * zoom, pad = 8;
    const vw = window.innerWidth * zoom, vh = window.innerHeight * zoom;
    let left = Math.min(r.left, vw - W - pad); left = Math.max(pad, left);
    let top = r.bottom + 6;
    if (top + H > vh - pad) top = r.top - 6 - H;              // flip above the button
    top = Math.max(pad, Math.min(top, vh - H - pad));         // always keep fully on-screen
    setPos({ left: left / zoom, top: top / zoom });
  };
  uEd(() => {
    if (!open) { setPos(null); return; }
    place();
    const on = () => place();
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', on); window.addEventListener('scroll', on, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  const v = value || '';
  const [hh, mm] = (v || '08:00').split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  const setH = (h) => onChange(`${h}:${mm}`);
  const setM = (m) => { onChange(`${hh}:${m}`); setOpen(false); };
  return (
    <div className={`ui-dd ui-tp ${open ? 'open' : ''} ${compact ? 'compact' : ''}`}>
      <button type="button" ref={btnRef} className="ui-dd-control" onClick={() => setOpen((o) => !o)} style={color ? { color, background: menuColor || 'transparent' } : null}>
        <IconClock s={compact ? 14 : 15} style={{ flexShrink: 0, color: color || 'var(--green-700)' }} />
        <span className={`ui-dd-text tnum ${v ? '' : 'ph'}`}>{v || placeholder || '—'}</span>
        <IconCaret s={compact ? 13 : 15} style={{ flexShrink: 0, color: color || 'var(--text-mut)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && ReactDOM.createPortal(
        <React.Fragment>
          {/* Portaled to <body> so the fixed popup can't be clipped by a modal's
              overflow:hidden or trapped by a transformed ancestor. Backdrop closes. */}
          <div className="pop-cal-backdrop dd-back" onClick={() => setOpen(false)} />
          <div className="ui-tp-pop" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
            <div className="ui-tp-grp">
              <div className="ui-tp-h">{window.t ? window.t('tp.hour') : 'Jam'}</div>
              <div className="ui-tp-grid ui-tp-hours">
                {hours.map((h) => <button type="button" key={h} className={`ui-tp-cell tnum ${h === hh ? 'on' : ''}`} onClick={() => setH(h)}>{h}</button>)}
              </div>
            </div>
            <div className="ui-tp-grp">
              <div className="ui-tp-h">{window.t ? window.t('tp.minute') : 'Menit'}</div>
              <div className="ui-tp-grid ui-tp-mins">
                {mins.map((m) => <button type="button" key={m} className={`ui-tp-cell tnum ${m === mm ? 'on' : ''}`} onClick={() => setM(m)}>{m}</button>)}
              </div>
            </div>
          </div>
        </React.Fragment>, document.body)}
    </div>
  );
}
/* file/photo proof attachment — resizes images to keep storage small */
function FileAttach({ value, onChange, compact }) {
  const inputRef = uRd(null);
  const onPick = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          const max = 1100; let { width: w, height: h } = img;
          if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          onChange({ name: file.name, type: file.type, isImg: true, data: c.toDataURL('image/jpeg', 0.7) });
        };
        img.src = src;
      } else {
        onChange({ name: file.name, type: file.type, isImg: false, data: src });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  return (
    <div className={`ui-attach ${compact ? 'compact' : ''}`}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={onPick} />
      {!value ? (
        <button type="button" className="ui-attach-btn" onClick={() => inputRef.current && inputRef.current.click()}>
          <IconPlus s={15} /><span>{(window.t && window.t('att.upload')) || 'Attach proof'}</span>
        </button>
      ) : (
        <div className="ui-attach-prev">
          {value.isImg ? <img src={value.data} alt="proof" onClick={() => window.UI._viewProof(value)} />
            : <span className="ui-attach-file" onClick={() => window.UI._viewProof(value)}><IconInvoice s={18} /></span>}
          <span className="ui-attach-name" title={value.name}>{value.name}</span>
          <button type="button" className="ui-attach-x" onClick={() => onChange(null)}><IconClose s={14} /></button>
        </div>
      )}
    </div>
  );
}

/* lightbox viewer for a saved proof */
function ProofViewer({ proof, onClose }) {
  uEd(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  if (!proof) return null;
  return (
    <div className="modal-scrim" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="proof-view" onClick={(e) => e.stopPropagation()}>
        <div className="proof-view-head"><span className="proof-view-name">{proof.name}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <a className="icon-btn" href={proof.data} download={proof.name} title="Download"><IconDownload s={17} /></a>
            <button className="icon-btn" onClick={onClose}><IconClose s={18} /></button>
          </span>
        </div>
        {proof.isImg ? <img src={proof.data} alt={proof.name} className="proof-view-img" />
          : <iframe src={proof.data} title={proof.name} className="proof-view-frame" />}
      </div>
    </div>
  );
}

window.UI = { Dropdown, TimePicker, FileAttach, ProofViewer };
