// ════════════════ GUDANG (warehouse inventory) ════════════════
// Ledger-based stock per item. Every number here comes from the server (item stock = Σ its
// StockMovement rows; galon = the Distribusi gallon ledger — one authoritative figure). This
// screen only reads that summary and posts movements; it never keeps a loose count.
const { useState: uSg, useEffect: uEg } = React;

const GUD_KIND_ICON = { galon: 'IconDrop', galon_rusak: 'IconWarn', sticker: 'IconInvoice', tutup: 'IconStore', segel: 'IconShield', lainnya: 'IconDots' };
// Ledger movement metadata: label key + adds/removes styling.
const SM_META = {
  opening:    { l: 'gud.mOpening',  cls: 'in' },
  purchase:   { l: 'gud.mPurchase', cls: 'in' },
  in:         { l: 'gud.mIn',       cls: 'in' },
  out:        { l: 'gud.mOut',      cls: 'out' },
  damage:     { l: 'gud.mDamage',   cls: 'dmg' },
  loss:       { l: 'gud.mLoss',     cls: 'dmg' },
  sale:       { l: 'gud.mSale',     cls: 'out' },
  correction: { l: 'gud.mCorr',     cls: 'corr' },
};

// Sanitize a SIGNED integer string: digits with an OPTIONAL leading "-" (any other
// minus is dropped). Used by the stock-correction field, which must accept negatives
// (e.g. -5) — on iOS the numeric keypad has no minus key, so the field is text + a
// sign-toggle button (see the correction modal).
function signedIntStr(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9-]/g, '');
  const neg = s.startsWith('-');
  return (neg ? '-' : '') + s.replace(/-/g, '');
}
// Flip the sign of a signed-int string ("" → "-" to prime a negative, "-5" → "5", "5" → "-5").
function flipSign(v) {
  const s = String(v == null ? '' : v);
  return s.startsWith('-') ? s.slice(1) : '-' + s;
}

// Item tile: a lazy-loaded photo thumbnail when the item has one (bytes fetched from the
// Attachment store on demand — never embedded in the item payload), else the kind icon.
function GudThumb({ photoId, kind }) {
  const [src, setSrc] = uSg(null);
  uEg(() => {
    let live = true; setSrc(null);
    if (photoId && window.API && window.API.attachments) {
      window.API.attachments.get(photoId).then((r) => { if (live && r && r.data) setSrc(r.data.data); }).catch(() => {});
    }
    return () => { live = false; };
  }, [photoId]);
  if (photoId && src) {
    return <span className="icon-tile" style={{ padding: 0, overflow: 'hidden' }}><img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>;
  }
  return <span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX(GUD_KIND_ICON[kind] || 'IconDots', { s: 18 })}</span>;
}

function GudangDept({ refreshKey, canManage, canDamage, canReport, fleet, today }) {
  const [data, setData] = uSg(null);
  const [err, setErr] = uSg('');
  const [toast, setToast] = uSg('');
  const [modal, setModal] = uSg(null);   // { kind:'stock'|'damage'|'correction'|'buffer'|'new', item?, type, qty, reason, bufferMin, name, unit, itemKind }
  const [saving, setSaving] = uSg(false);
  const [closeouts, setCloseouts] = uSg([]);   // recent daily closeouts (report)
  const [coModal, setCoModal] = uSg(null);     // closeout modal: { items:[{...,physical,reason}], summary, note }
  const [coView, setCoView] = uSg(null);       // view a past closeout's detail
  const [suppliers, setSuppliers] = uSg([]);   // active suppliers, for the stock-in dropdown

  const reload = () => {
    if (!(window.API && window.API.gudang)) return Promise.resolve();
    window.API.gudang.closeouts().then((r) => setCloseouts(r.data || [])).catch(() => {});
    if (canManage) window.API.gudang.suppliers('status=active').then((r) => setSuppliers(r.data || [])).catch(() => {});
    return window.API.gudang.summary().then((r) => { setData(r.data); setErr(''); })
      .catch((e) => setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  uEg(() => {
    let cancelled = false;
    const tryLoad = (n) => { if (cancelled) return; if (window.API && window.API.gudang) { reload(); return; } if (n <= 0) { setErr(trD('common.loadFail')); return; } setTimeout(() => tryLoad(n - 1), 150); };
    tryLoad(40); return () => { cancelled = true; };
  }, [refreshKey]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const openStock = (item) => { setErr(''); setModal({ kind: 'stock', item, type: 'in', qty: '', reason: '' }); };
  const openCorrection = (item) => { setErr(''); setModal({ kind: 'correction', item, type: 'correction', qty: '', reason: '' }); };
  const openDamage = (item) => { setErr(''); setModal({ kind: 'damage', item, type: 'damage', qty: '', reason: '' }); };
  const openBuffer = (item) => { setErr(''); setModal({ kind: 'buffer', item, bufferMin: String(item.bufferMin || 0) }); };
  const openNew = () => { setErr(''); setModal({ kind: 'new', name: '', itemKind: 'sticker', unit: 'pcs', bufferMin: '' }); };
  // Edit an item's details. Reconstruct the photo as a FileAttach ref value so the existing
  // photo shows (lazy) and can be replaced/removed. photoId is stored on save (not base64).
  const openEdit = (item) => { setErr(''); setModal({ kind: 'edit', item, name: item.name || '', unit: item.unit || '', form: item.form || '', description: item.description || '', bufferMin: String(item.bufferMin || 0), photo: item.photoId ? { ref: item.photoId, isImg: true, name: 'foto' } : null }); };
  const openReport = () => { setErr(''); setModal({ kind: 'report', jenis: 'pecah', qty: '', reason: '', culprit: '', fleet: '', proof: null }); };
  const openSell = (item) => { setErr(''); setModal({ kind: 'sell', item, qty: '', price: '', method: 'Cash', reason: '' }); };
  const openCloseout = () => {
    setErr('');
    window.API.gudang.closeoutPreview(today).then((r) => {
      const d = r.data;
      if (d.closed) { setCoView(d.closeout); return; }
      setCoModal({ items: (d.items || []).map((i) => ({ ...i, physical: String(i.system), reason: '' })), summary: d.summary || {}, note: '' });
    }).catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  const commitCloseout = () => {
    if (!coModal || saving) return;
    const bad = coModal.items.find((it) => (parseInt(it.physical, 10) || 0) !== it.system && !(it.reason || '').trim());
    if (bad) { setErr(trD('gud.coErrReason', { name: bad.name })); return; }
    setSaving(true); setErr('');
    const payload = { date: today, note: (coModal.note || '').trim() || undefined,
      items: coModal.items.map((it) => ({ itemId: it.itemId, physical: parseInt(it.physical, 10) || 0, reason: (it.reason || '').trim() || undefined })) };
    window.API.gudang.closeWarehouse(payload)
      .then(() => { setSaving(false); setCoModal(null); flash(trD('gud.coSaved')); reload(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };

  const commit = () => {
    if (!modal || saving) return;
    setSaving(true); setErr('');
    const done = (msg) => { setSaving(false); setModal(null); flash(msg); reload(); };
    const fail = (e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); };
    if (modal.kind === 'buffer') {
      window.API.gudang.updateItem(modal.item.id, { bufferMin: Math.max(0, parseInt(modal.bufferMin || '0', 10) || 0) }).then(() => done(trD('gud.bufferSaved'))).catch(fail);
      return;
    }
    if (modal.kind === 'new') {
      const name = (modal.name || '').trim();
      if (!name) { setSaving(false); setErr(trD('gud.errName')); return; }
      window.API.gudang.createItem({ name, kind: modal.itemKind, unit: (modal.unit || 'pcs').trim() || 'pcs', bufferMin: Math.max(0, parseInt(modal.bufferMin || '0', 10) || 0) }).then(() => done(trD('gud.itemAdded'))).catch(fail);
      return;
    }
    if (modal.kind === 'edit') {
      const name = (modal.name || '').trim();
      if (!name) { setSaving(false); setErr(trD('gud.errName')); return; }
      // Photo: store ONLY the Attachment id (FileAttach uploaded the compressed bytes and
      // returned a ref). Inline fallback (offline) has no id → treated as no photo change.
      const photoId = (modal.photo && modal.photo.ref) ? modal.photo.ref : null;
      window.API.gudang.updateItem(modal.item.id, {
        name, unit: (modal.unit || '').trim() || 'pcs', form: (modal.form || '').trim(),
        description: (modal.description || '').trim(), bufferMin: Math.max(0, parseInt(modal.bufferMin || '0', 10) || 0),
        photoId,
      }).then(() => done(trD('gud.itemSaved'))).catch(fail);
      return;
    }
    if (modal.kind === 'report') {
      const qty = parseInt(String(modal.qty).replace(/[^0-9]/g, ''), 10);
      const reason = (modal.reason || '').trim();
      if (!(qty > 0)) { setSaving(false); setErr(trD('gud.errQty')); return; }
      if (!reason) { setSaving(false); setErr(trD('gud.errReason')); return; }
      window.API.gudang.reportGallonDamage({ kind: modal.jenis, qty, reason, culprit: (modal.culprit || '').trim() || undefined, fleet: modal.fleet || undefined, proof: modal.proof || undefined }).then(() => done(trD('gud.reportSaved'))).catch(fail);
      return;
    }
    if (modal.kind === 'sell') {
      const qty = parseInt(String(modal.qty).replace(/[^0-9]/g, ''), 10);
      const price = parseInt(String(modal.price).replace(/[^0-9]/g, ''), 10);
      if (!(qty > 0)) { setSaving(false); setErr(trD('gud.errQty')); return; }
      if (!(price > 0)) { setSaving(false); setErr(trD('gud.errPrice')); return; }
      window.API.gudang.sellRusak({ qty, price, method: modal.method, reason: (modal.reason || '').trim() || undefined }).then(() => done(trD('gud.sellSaved'))).catch(fail);
      return;
    }
    const reason = (modal.reason || '').trim();
    if (!reason) { setSaving(false); setErr(trD('gud.errReason')); return; }
    if (modal.kind === 'correction') {
      const qty = parseInt(signedIntStr(modal.qty), 10);   // signed; may be negative
      if (!Number.isInteger(qty) || qty === 0) { setSaving(false); setErr(trD('gud.errQtyCorr')); return; }
      window.API.gudang.addStock(modal.item.id, { type: 'correction', qty, reason }).then(() => done(trD('gud.moveSaved'))).catch(fail);
      return;
    }
    const qty = parseInt(String(modal.qty).replace(/[^0-9]/g, ''), 10);
    if (!(qty > 0)) { setSaving(false); setErr(trD('gud.errQty')); return; }
    if (modal.kind === 'damage') {
      window.API.gudang.addDamage(modal.item.id, { type: modal.type, qty, reason }).then(() => done(trD('gud.moveSaved'))).catch(fail);
      return;
    }
    // stock-in: attach the supplier + invoice ref when it's an incoming movement
    const extra = {};
    if (modal.type === 'purchase' || modal.type === 'in') {
      if (modal.supplierId) extra.supplierId = modal.supplierId;
      if ((modal.refId || '').trim()) extra.refId = modal.refId.trim();
    }
    window.API.gudang.addStock(modal.item.id, { type: modal.type, qty, reason, ...extra }).then(() => done(trD('gud.moveSaved'))).catch(fail);
  };

  if (!data && !err) return <div className="dist-dash screen-enter"><div className="card"><div className="dist-empty">{trD('common.loading') || 'Memuat…'}</div></div></div>;
  if (!data) return <div className="dist-dash screen-enter"><div className="card"><div className="dist-empty">{err}</div></div></div>;

  const items = data.items || [];
  const restock = data.restock || [];
  const statusBadge = (it) => {
    if (it.bufferMin <= 0) return <span className="gud-badge none">{trD('gud.noBuffer')}</span>;
    return it.needsRestock ? <span className="gud-badge low"><IconWarn s={11} />{trD('gud.needRestock')}</span> : <span className="gud-badge ok"><IconCheck s={11} />{trD('gud.safe')}</span>;
  };

  const fmtT = (ms) => { if (!ms) return ''; const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
  const todayCo = (closeouts || []).find((c) => c.date === today);

  return (
    <div className="dist-dash screen-enter">
      <div className="gud-head">
        <div className="sec-title">{trD('gud.title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canReport && !todayCo && <button type="button" className="btn btn-ghost btn-sm" onClick={openCloseout}><IconCheck s={15} />{trD('gud.coBtn')}</button>}
          {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={openNew}><IconPlus s={15} />{trD('gud.addItem')}</button>}
        </div>
      </div>

      {todayCo && (
        <div className="card gud-closed-banner" onClick={() => setCoView(todayCo)}>
          <span className="gud-closed-ic"><IconCheck s={16} /></span>
          <div className="gud-closed-main">
            <b>{trD('gud.coClosedBy', { who: todayCo.closedByName || '—', t: fmtT(todayCo.closedAt) })}</b>
            {todayCo.diffCount > 0 ? <span className="gud-closed-diff"><IconWarn s={12} />{trD('gud.coDiffN', { n: todayCo.diffCount })}</span> : <span className="gud-closed-ok">{trD('gud.coNoDiff')}</span>}
          </div>
          <span className="dist-link">{trD('gud.coView')}</span>
        </div>
      )}

      {restock.length > 0 && (
        <div className="card gud-restock">
          <div className="gud-restock-h"><IconWarn s={15} />{trD('gud.restockList')} · {restock.length}</div>
          <div className="gud-restock-items">
            {restock.map((it) => <span key={it.id} className="gud-restock-pill">{it.name}: <b>{numX(it.stock)}</b> / {numX(it.bufferMin)} {it.unit}</span>)}
          </div>
        </div>
      )}

      {data.rusakSales && data.rusakSales.count > 0 && (
        <div className="card gud-salesnote"><IconCoinIn s={15} /><span>{trD('gud.rusakSales', { n: numX(data.rusakSales.qty), rp: rpFull(data.rusakSales.total) })}</span></div>
      )}

      <div className="gud-cards">
        {items.map((it) => (
          <div key={it.id} className={`card gud-card ${it.needsRestock ? 'low' : ''}`}>
            <div className="gud-card-top">
              <GudThumb photoId={it.photoId} kind={it.kind} />
              <div style={{ flex: 1, minWidth: 0 }}><div className="gud-card-name">{it.name}</div><div className="gud-card-unit">{it.form ? it.form + ' · ' : ''}{trD('gud.unit')}: {it.unit}</div></div>
              {statusBadge(it)}
            </div>
            <div className="gud-card-stock"><span className="tnum gud-card-num">{numX(it.stock)}</span><span className="gud-card-numunit">{it.unit}</span></div>
            <div className="gud-card-buffer">{trD('gud.buffer')}: <b>{it.bufferMin > 0 ? numX(it.bufferMin) : '—'}</b>{canManage && <button type="button" className="dist-link" onClick={() => openBuffer(it)} style={{ marginLeft: 8 }}>{trD('gud.setBuffer')}</button>}</div>
            {it.kind === 'galon' ? (
              <>
                <div className="gud-card-note"><IconLock s={12} />{trD('gud.galonManaged')}</div>
                {(canManage || canDamage) && <div className="gud-card-actions">
                  {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(it)}><IconPencil s={13} />{trD('gud.editItem')}</button>}
                  {canDamage && <button type="button" className="btn btn-ghost btn-sm gud-dmg" onClick={openReport}><IconWarn s={13} />{trD('gud.report')}</button>}
                </div>}
              </>
            ) : it.kind === 'galon_rusak' ? (
              <div className="gud-card-actions">
                {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => openSell(it)} disabled={it.stock <= 0}><IconCoinIn s={13} />{trD('gud.sell')}</button>}
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openCorrection(it)}><IconPencil s={13} />{trD('gud.correct')}</button>}
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(it)}><IconPencil s={13} />{trD('gud.editItem')}</button>}
              </div>
            ) : (
              <div className="gud-card-actions">
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openStock(it)}><IconPlus s={13} />{trD('gud.addStock')}</button>}
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openCorrection(it)}><IconPencil s={13} />{trD('gud.correct')}</button>}
                {canDamage && <button type="button" className="btn btn-ghost btn-sm gud-dmg" onClick={() => openDamage(it)}><IconWarn s={13} />{trD('gud.damage')}</button>}
                {canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(it)}><IconPencil s={13} />{trD('gud.editItem')}</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card dist-card gud-ledger">
        <div className="sec-title" style={{ marginBottom: 8 }}>{trD('gud.ledger')}</div>
        {(data.movements || []).length === 0 && <div className="dist-empty">{trD('gud.noMov')}</div>}
        {(data.movements || []).map((m) => { const meta = SM_META[m.type] || SM_META.correction; const disp = (m.effect >= 0 ? '+' : '') + numX(m.effect); return (
          <div key={m.id} className="dist-txn">
            <span className={`gud-mtag ${meta.cls}`}>{trD(meta.l)}</span>
            <div className="dist-txn-mid"><div className="dist-txn-name">{m.itemName || '—'}</div><div className="dist-txn-sub">{fmtDT(m.createdAt)}{m.actorName ? ' · ' + m.actorName : ''}{m.reason ? ' · ' + m.reason : ''}</div></div>
            <b className={`tnum gud-mqty ${meta.cls}`}>{disp}</b>
          </div>
        ); })}
      </div>

      {canReport && (closeouts || []).length > 0 && (
        <div className="card dist-card gud-coreport">
          <div className="sec-title" style={{ marginBottom: 8 }}>{trD('gud.coHistory')}</div>
          {closeouts.map((c) => (
            <div key={c.id} className="gud-co-row" onClick={() => setCoView(c)}>
              <span className="gud-co-date">{c.date}</span>
              <div className="gud-co-main"><span>{c.closedByName || '—'} · {fmtT(c.closedAt)}</span>{c.note ? <small>{c.note}</small> : null}</div>
              {c.diffCount > 0 ? <span className="gud-badge low"><IconWarn s={11} />{trD('gud.coDiffN', { n: c.diffCount })}</span> : <span className="gud-badge ok"><IconCheck s={11} />{trD('gud.coNoDiff')}</span>}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-scrim" onClick={() => setModal(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{modal.kind === 'new' ? trD('gud.addItem') : modal.kind === 'edit' ? trD('gud.editItemT') : modal.kind === 'buffer' ? trD('gud.setBufferT') : modal.kind === 'correction' ? trD('gud.correctT') : modal.kind === 'damage' ? trD('gud.damageT') : modal.kind === 'report' ? trD('gud.reportT') : modal.kind === 'sell' ? trD('gud.sellT') : trD('gud.addStockT')}</div>
                {modal.item && <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{modal.item.name}</div>}
              </div>
              <button className="jp-icon" onClick={() => setModal(null)}><IconClose s={18} /></button>
            </div>
            <div className="modal-body">
              {modal.kind === 'new' && (<>
                <label className="fld-label">{trD('gud.itemName')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld" value={modal.name} placeholder={trD('gud.itemNamePh')} onChange={(e) => setModal({ ...modal, name: e.target.value })} />
                <label className="fld-label">{trD('gud.itemKind')}</label>
                <select className="fld" value={modal.itemKind} onChange={(e) => setModal({ ...modal, itemKind: e.target.value })}>
                  <option value="sticker">Sticker</option><option value="tutup">Tutup</option><option value="segel">Segel</option><option value="lainnya">{trD('gud.kindOther')}</option>
                </select>
                <div className="gud-row2">
                  <div><label className="fld-label">{trD('gud.unit')}</label><input className="fld" value={modal.unit} placeholder="pcs" onChange={(e) => setModal({ ...modal, unit: e.target.value })} /></div>
                  <div><label className="fld-label">{trD('gud.buffer')}</label><input className="fld tnum" value={modal.bufferMin} inputMode="numeric" placeholder="0" onChange={(e) => setModal({ ...modal, bufferMin: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                </div>
              </>)}
              {modal.kind === 'edit' && (<>
                <label className="fld-label">{trD('gud.itemName')}</label>
                <input className="fld" value={modal.name} placeholder={trD('gud.itemNamePh')} onChange={(e) => setModal({ ...modal, name: e.target.value })} />
                <div className="gud-row2">
                  <div><label className="fld-label">{trD('gud.unit')}</label><input className="fld" value={modal.unit} placeholder="pcs" onChange={(e) => setModal({ ...modal, unit: e.target.value })} /></div>
                  <div><label className="fld-label">{trD('gud.form')}</label><input className="fld" value={modal.form} placeholder={trD('gud.formPh')} onChange={(e) => setModal({ ...modal, form: e.target.value })} /></div>
                </div>
                <label className="fld-label">{trD('gud.buffer')}</label>
                <input className="fld tnum" value={modal.bufferMin} inputMode="numeric" placeholder="0" onChange={(e) => setModal({ ...modal, bufferMin: e.target.value.replace(/[^0-9]/g, '') })} />
                <label className="fld-label">{trD('gud.desc')}</label>
                <textarea className="fld" style={{ height: 56, padding: 12, resize: 'vertical' }} value={modal.description} placeholder={trD('gud.descPh')} onChange={(e) => setModal({ ...modal, description: e.target.value })} />
                <label className="fld-label">{trD('gud.photo')}</label>
                <UI.FileAttach value={modal.photo} onChange={(v) => setModal({ ...modal, photo: v })} camera accept="image/*" label={trD('gud.photoAdd')} />
              </>)}
              {modal.kind === 'buffer' && (<>
                <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('gud.bufferInfo')}</span></div>
                <label className="fld-label">{trD('gud.bufferMin')}</label>
                <input className="fld tnum" value={modal.bufferMin} inputMode="numeric" placeholder="cth. 100" onChange={(e) => setModal({ ...modal, bufferMin: e.target.value.replace(/[^0-9]/g, '') })} />
              </>)}
              {(modal.kind === 'stock' || modal.kind === 'damage') && (<>
                <label className="fld-label">{trD('gud.moveType')}</label>
                <select className="fld" value={modal.type} onChange={(e) => setModal({ ...modal, type: e.target.value })}>
                  {modal.kind === 'stock'
                    ? [<option key="in" value="in">{trD('gud.mIn')}</option>, <option key="purchase" value="purchase">{trD('gud.mPurchase')}</option>, <option key="opening" value="opening">{trD('gud.mOpening')}</option>]
                    : [<option key="damage" value="damage">{trD('gud.mDamage')}</option>, <option key="loss" value="loss">{trD('gud.mLoss')}</option>]}
                </select>
                <label className="fld-label">{trD('gud.qty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.qty} inputMode="numeric" placeholder="cth. 500" onChange={(e) => setModal({ ...modal, qty: e.target.value.replace(/[^0-9]/g, '') })} />
                {/* Supplier + invoice/PO ref — optional, only for incoming stock (purchase/in). */}
                {modal.kind === 'stock' && (modal.type === 'purchase' || modal.type === 'in') && (<>
                  <label className="fld-label">{trD('gud.supplier')}</label>
                  <select className="fld" value={modal.supplierId || ''} onChange={(e) => setModal({ ...modal, supplierId: e.target.value })}>
                    <option value="">{trD('gud.supplierNone')}</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{(s.code ? s.code + ' · ' : '') + s.name}</option>)}
                  </select>
                  <label className="fld-label">{trD('gud.invoiceRef')}</label>
                  <input className="fld" value={modal.refId || ''} placeholder={trD('gud.invoiceRefPh')} onChange={(e) => setModal({ ...modal, refId: e.target.value })} />
                </>)}
                <label className="fld-label">{trD('gud.reason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <textarea className="fld" style={{ height: 64, padding: 12, resize: 'vertical' }} value={modal.reason} placeholder={trD('gud.reasonPh')} onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
              </>)}
              {modal.kind === 'correction' && (<>
                <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('gud.corrInfo')}</span></div>
                <label className="fld-label">{trD('gud.corrQty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                {/* Signed field: iOS's numeric keypad has NO minus key, so use a text keyboard
                    (pattern keeps it digit-ish) PLUS a +/− toggle so the sign works on any device. */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <button type="button" className="btn btn-ghost" title={trD('gud.corrFlip')} aria-label={trD('gud.corrFlip')}
                    style={{ flex: '0 0 auto', minWidth: 48, fontSize: 20, fontWeight: 800, lineHeight: 1 }}
                    onClick={() => setModal({ ...modal, qty: flipSign(modal.qty) })}>
                    {String(modal.qty).startsWith('-') ? '−' : '+'}
                  </button>
                  <input className="fld tnum" style={{ flex: 1 }} value={modal.qty} inputMode="text" pattern="-?[0-9]*"
                    placeholder="cth. -5 atau 3" onChange={(e) => setModal({ ...modal, qty: signedIntStr(e.target.value) })} />
                </div>
                <label className="fld-label">{trD('gud.reason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <textarea className="fld" style={{ height: 64, padding: 12, resize: 'vertical' }} value={modal.reason} placeholder={trD('gud.reasonPh')} onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
              </>)}
              {modal.kind === 'report' && (<>
                <div className="dist-infobox"><IconWarn s={16} /><span>{trD('gud.reportInfo')}</span></div>
                <label className="fld-label">{trD('gud.jenis')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <select className="fld" value={modal.jenis} onChange={(e) => setModal({ ...modal, jenis: e.target.value })}>
                  <option value="pecah">{trD('gud.jPecah')}</option><option value="rusak">{trD('gud.jRusak')}</option><option value="hilang">{trD('gud.jHilang')}</option>
                </select>
                <div className="gud-hint">{modal.jenis === 'hilang' ? trD('gud.jHilangNote') : trD('gud.jRusakNote')}</div>
                <label className="fld-label">{trD('gud.qty')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <input className="fld tnum" value={modal.qty} inputMode="numeric" placeholder="cth. 3" onChange={(e) => setModal({ ...modal, qty: e.target.value.replace(/[^0-9]/g, '') })} />
                <label className="fld-label">{trD('gud.reason')} <span style={{ color: 'var(--neg)' }}>*</span></label>
                <textarea className="fld" style={{ height: 60, padding: 12, resize: 'vertical' }} value={modal.reason} placeholder={trD('gud.reportReasonPh')} onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
                {Array.isArray(fleet) && fleet.length > 0 && (<>
                  <label className="fld-label">{trD('gud.fleet')}</label>
                  <select className="fld" value={modal.fleet} onChange={(e) => setModal({ ...modal, fleet: e.target.value })}>
                    <option value="">{trD('gud.noFleet')}</option>{fleet.filter(Boolean).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </>)}
                <label className="fld-label">{trD('gud.culprit')}</label>
                <input className="fld" value={modal.culprit} placeholder={trD('gud.culpritPh')} onChange={(e) => setModal({ ...modal, culprit: e.target.value })} />
                <label className="fld-label">{trD('gud.photo')}</label>
                <UI.FileAttach value={modal.proof} onChange={(v) => setModal({ ...modal, proof: v })} />
              </>)}
              {modal.kind === 'sell' && (<>
                <div className="dist-infobox"><IconCoinIn s={16} /><span>{trD('gud.sellInfo')}</span></div>
                <div className="gud-row2">
                  <div><label className="fld-label">{trD('gud.qty')} <span style={{ color: 'var(--neg)' }}>*</span></label><input className="fld tnum" value={modal.qty} inputMode="numeric" placeholder="cth. 2" onChange={(e) => setModal({ ...modal, qty: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                  <div><label className="fld-label">{trD('gud.price')} <span style={{ color: 'var(--neg)' }}>*</span></label><input className="fld tnum" value={modal.price} inputMode="numeric" placeholder="cth. 5000" onChange={(e) => setModal({ ...modal, price: e.target.value.replace(/[^0-9]/g, '') })} /></div>
                </div>
                {modal.qty && modal.price && <div className="gud-hint">{trD('gud.sellTotal', { rp: rpFull((parseInt(modal.qty, 10) || 0) * (parseInt(modal.price, 10) || 0)) })}</div>}
                <label className="fld-label">{trD('gud.method')}</label>
                <select className="fld" value={modal.method} onChange={(e) => setModal({ ...modal, method: e.target.value })}>
                  <option value="Cash">Cash</option><option value="Transfer">Transfer</option><option value="QRIS">QRIS</option>
                </select>
                <label className="fld-label">{trD('gud.reasonOpt')}</label>
                <input className="fld" value={modal.reason} placeholder={trD('gud.sellReasonPh')} onChange={(e) => setModal({ ...modal, reason: e.target.value })} />
              </>)}
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setModal(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={commit}>{saving ? '…' : trD('gud.save')}</button></div>
          </div>
        </div>
      )}

      {coModal && (() => { const S = coModal.summary || {}; const anyDiff = coModal.items.some((it) => (parseInt(it.physical, 10) || 0) !== it.system);
        const setIt = (idx, patch) => setCoModal({ ...coModal, items: coModal.items.map((it, i) => i === idx ? { ...it, ...patch } : it) });
        return (
        <div className="modal-scrim" onClick={() => setCoModal(null)} style={{ zIndex: 210 }}>
          <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('gud.coT')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{today}</div></div><button className="jp-icon" onClick={() => setCoModal(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-infobox"><IconInvoice s={16} /><span>{trD('gud.coInfo')}</span></div>
              <div className="gud-co-daysum">
                <span>{trD('gud.coSumRuns', { out: numX(S.runsOut || 0), full: numX(S.runsFullReturned || 0), empty: numX(S.runsEmptyReturned || 0) })}</span>
                <span>{trD('gud.coSumDmg', { d: numX((S.gallonDamage || 0) + (S.stockDamageLoss || 0)), l: numX(S.gallonLoss || 0) })}</span>
                <span>{trD('gud.coSumRestock', { n: numX(S.restock || 0) })}</span>
                <span>{trD('gud.coSumSales', { n: numX((S.rusakSales || {}).qty || 0), rp: rpFull((S.rusakSales || {}).total || 0) })}</span>
              </div>
              <div className="gud-co-items">
                <div className="gud-co-ihead"><span>{trD('gud.coItem')}</span><span className="num">{trD('gud.coSystem')}</span><span className="num">{trD('gud.coPhysical')}</span></div>
                {coModal.items.map((it, idx) => { const phys = parseInt(it.physical, 10) || 0; const diff = phys - it.system; return (
                  <div key={it.itemId} className={`gud-co-irow ${diff !== 0 ? 'diff' : ''}`}>
                    <span className="gud-co-iname">{it.name}<small>{it.unit}</small></span>
                    <span className="num gud-co-sys">{numX(it.system)}</span>
                    <input className="fld tnum gud-co-phys" value={it.physical} inputMode="numeric" onChange={(e) => setIt(idx, { physical: e.target.value.replace(/[^0-9]/g, '') })} />
                    {diff !== 0 && (
                      <div className="gud-co-diffrow">
                        <span className="gud-co-diff">{trD('gud.coDiff', { d: (diff > 0 ? '+' : '') + numX(diff) })}</span>
                        <input className="fld gud-co-reason" value={it.reason} placeholder={trD('gud.coReasonPh')} onChange={(e) => setIt(idx, { reason: e.target.value })} />
                      </div>
                    )}
                  </div>
                ); })}
              </div>
              <label className="fld-label">{trD('gud.coNote')}</label>
              <textarea className="fld" style={{ height: 56, padding: 12, resize: 'vertical' }} value={coModal.note} placeholder={trD('gud.coNotePh')} onChange={(e) => setCoModal({ ...coModal, note: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 10 }}><IconClose s={13} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setCoModal(null)}>{trD('dist.cancel')}</button><button className={`btn ${anyDiff ? 'gud-btn-warn' : 'btn-primary'}`} disabled={saving} onClick={commitCloseout}>{saving ? '…' : (anyDiff ? trD('gud.coCloseDiff') : trD('gud.coClose'))}</button></div>
          </div>
        </div>
      ); })()}

      {coView && (
        <div className="modal-scrim" onClick={() => setCoView(null)} style={{ zIndex: 210 }}>
          <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div><div style={{ fontSize: 17, fontWeight: 800 }}>{trD('gud.coViewT')} · {coView.date}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 3 }}>{coView.closedByName || '—'} · {fmtT(coView.closedAt)}</div></div><button className="jp-icon" onClick={() => setCoView(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              {(() => { const S = coView.summary || {}; return (
                <div className="gud-co-daysum">
                  <span>{trD('gud.coSumRuns', { out: numX(S.runsOut || 0), full: numX(S.runsFullReturned || 0), empty: numX(S.runsEmptyReturned || 0) })}</span>
                  <span>{trD('gud.coSumDmg', { d: numX((S.gallonDamage || 0) + (S.stockDamageLoss || 0)), l: numX(S.gallonLoss || 0) })}</span>
                  <span>{trD('gud.coSumRestock', { n: numX(S.restock || 0) })}</span>
                  <span>{trD('gud.coSumSales', { n: numX((S.rusakSales || {}).qty || 0), rp: rpFull((S.rusakSales || {}).total || 0) })}</span>
                </div>
              ); })()}
              <div className="gud-co-items">
                <div className="gud-co-ihead"><span>{trD('gud.coItem')}</span><span className="num">{trD('gud.coSystem')}</span><span className="num">{trD('gud.coPhysical')}</span><span className="num">{trD('gud.coDiffCol')}</span></div>
                {(coView.items || []).map((it) => (
                  <div key={it.itemId} className={`gud-co-vrow ${it.diff !== 0 ? 'diff' : ''}`}>
                    <span className="gud-co-iname">{it.name}</span>
                    <span className="num">{numX(it.system)}</span>
                    <span className="num">{numX(it.physical)}</span>
                    <span className="num">{it.diff === 0 ? <span className="run-ok">0</span> : <span className="run-bad" title={it.reason}>{(it.diff > 0 ? '+' : '') + numX(it.diff)}</span>}</span>
                  </div>
                ))}
              </div>
              {(coView.items || []).filter((it) => it.diff !== 0 && it.reason).map((it) => (
                <div key={'r' + it.itemId} className="gud-co-reasonline"><b>{it.name}:</b> {it.reason}</div>
              ))}
              {coView.note ? <div className="gud-co-noteline"><IconInvoice s={13} /> {coView.note}</div> : null}
            </div>
            <div className="modal-foot"><button className="btn btn-primary" onClick={() => setCoView(null)}>{trD('gud.ok')}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

// ── SUPPLIER (Pemasok) screen — Gudang group, gudangKelola cap (server-enforced) ──────
function GudangSuppliers() {
  const [list, setList] = uSg([]);
  const [q, setQ] = uSg('');
  const [status, setStatus] = uSg('active');
  const [edit, setEdit] = uSg(null);      // add/edit form: { id?, name, phone, address, note, _new? }
  const [detail, setDetail] = uSg(null);  // supplier detail incl. purchase history
  const [err, setErr] = uSg('');
  const [toast, setToast] = uSg('');
  const [saving, setSaving] = uSg(false);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = () => {
    if (!(window.API && window.API.gudang)) return;
    const parts = []; if (q.trim()) parts.push('q=' + encodeURIComponent(q.trim())); parts.push('status=' + status);
    window.API.gudang.suppliers(parts.join('&')).then((r) => { setList(r.data || []); setErr(''); })
      .catch((e) => setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  uEg(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, status]);

  const addNew = () => { setErr(''); setEdit({ name: '', phone: '', address: '', note: '', _new: true }); };
  const openEdit = (s) => { setErr(''); setEdit({ id: s.id, name: s.name, phone: s.phone || '', address: s.address || '', note: s.note || '' }); };
  const save = () => {
    if (saving) return;
    const name = (edit.name || '').trim();
    if (!name) { setErr(trD('gud.errName')); return; }
    setSaving(true);
    const body = { name, phone: (edit.phone || '').trim(), address: (edit.address || '').trim(), note: (edit.note || '').trim() };
    const p = edit._new ? window.API.gudang.createSupplier(body) : window.API.gudang.updateSupplier(edit.id, body);
    p.then(() => { setSaving(false); setEdit(null); flash(edit._new ? trD('gud.supAdded') : trD('gud.supSaved')); load(); })
      .catch((e) => { setSaving(false); setErr((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')); });
  };
  const toggleActive = (s) => {
    window.API.gudang.setSupplierActive(s.id, !s.active).then(() => { flash(s.active ? trD('gud.supDeactivated') : trD('gud.supRestored')); load(); }).catch(() => {});
  };
  const del = (s) => {
    if (!confirm(trD('gud.supDeleteConfirm', { name: s.name }))) return;
    window.API.gudang.deleteSupplier(s.id).then(() => { flash(trD('gud.supDeleted')); load(); })
      .catch((e) => flash((e && e.body && e.body.error && e.body.error.message) || trD('common.loadFail')));
  };
  const openDetail = (id) => { window.API.gudang.supplier(id).then((r) => setDetail(r.data)).catch(() => {}); };

  return (
    <div className="dist-dash screen-enter">
      <div className="card dist-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div className="sec-title" style={{ margin: 0, flex: 1 }}>{trD('nav.suppliers')}</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={addNew}><IconPlus s={15} />{trD('gud.supAdd')}</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }}><IconSearch s={15} /></span>
            <input className="fld" style={{ paddingLeft: 32 }} value={q} placeholder={trD('gud.supSearch')} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="fld" style={{ maxWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">{trD('gud.supActive')}</option>
            <option value="inactive">{trD('gud.supInactive')}</option>
            <option value="all">{trD('gud.supAll')}</option>
          </select>
        </div>
        {err && <div className="dist-empty">{err}</div>}
        {!err && list.length === 0 && <div className="dist-empty">{trD('gud.supEmpty')}</div>}
        {list.map((s) => (
          <div key={s.id} className="dist-txn" style={{ opacity: s.active ? 1 : 0.6 }}>
            <span className="icon-tile" style={{ background: '#EAF1F4', color: '#5E7A88' }}>{IcX('IconStore', { s: 16 })}</span>
            <div className="dist-txn-mid" style={{ cursor: 'pointer' }} onClick={() => openDetail(s.id)}>
              <div className="dist-txn-name">{s.code ? s.code + ' · ' : ''}{s.name}{!s.active && <span className="gud-mtag dmg" style={{ marginLeft: 8 }}>{trD('gud.supInactiveTag')}</span>}</div>
              <div className="dist-txn-sub">{[s.phone, s.address].filter(Boolean).join(' · ') || trD('gud.supNoContact')}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title={trD('gud.editItem')}><IconPencil s={13} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(s)}>{s.active ? trD('gud.supDeactivate') : trD('gud.supRestore')}</button>
              {!s.active && <button type="button" className="btn btn-ghost btn-sm gud-dmg" onClick={() => del(s)} title={trD('gud.supDelete')}><IconTrash s={13} /></button>}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <div className="modal-scrim" onClick={() => setEdit(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{edit._new ? trD('gud.supAdd') : trD('gud.supEdit')}</div><button className="jp-icon" onClick={() => setEdit(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <label className="fld-label" style={{ marginTop: 0 }}>{trD('gud.supName')} <span style={{ color: 'var(--neg)' }}>*</span></label>
              <input className="fld" value={edit.name} placeholder={trD('gud.supNamePh')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <div className="gud-row2">
                <div><label className="fld-label">{trD('gud.supPhone')}</label><input className="fld" value={edit.phone} inputMode="tel" placeholder="08…" onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                <div><label className="fld-label">{trD('gud.supAddress')}</label><input className="fld" value={edit.address} placeholder={trD('gud.supAddressPh')} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></div>
              </div>
              <label className="fld-label">{trD('gud.supNote')}</label>
              <textarea className="fld" style={{ height: 56, padding: 12, resize: 'vertical' }} value={edit.note} placeholder={trD('gud.supNotePh')} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
              {err && <div className="login-err" style={{ marginTop: 8 }}><IconClose s={14} />{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setEdit(null)}>{trD('dist.cancel')}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : trD('gud.save')}</button></div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-scrim" onClick={() => setDetail(null)} style={{ zIndex: 200 }}>
          <div className="modal-card" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 800 }}>{detail.code ? detail.code + ' · ' : ''}{detail.name}</div><button className="jp-icon" onClick={() => setDetail(null)}><IconClose s={18} /></button></div>
            <div className="modal-body">
              <div className="dist-txn-sub" style={{ marginBottom: 10 }}>
                {[detail.phone, detail.address].filter(Boolean).join(' · ') || trD('gud.supNoContact')}
                {detail.note ? <div style={{ marginTop: 4 }}><IconInvoice s={12} /> {detail.note}</div> : null}
                <div style={{ marginTop: 6, color: 'var(--text-faint)', fontSize: 11 }}>
                  {detail.createdByName ? trD('gud.supCreatedBy', { who: detail.createdByName }) : ''}
                  {detail.editedByName ? ' · ' + trD('gud.supEditedBy', { who: detail.editedByName }) : ''}
                  {!detail.active && detail.deactivatedByName ? ' · ' + trD('gud.supDeactBy', { who: detail.deactivatedByName }) : ''}
                </div>
              </div>
              <div className="sec-title" style={{ fontSize: 13, marginBottom: 6 }}>{trD('gud.supPurchases')}</div>
              {(detail.purchases || []).length === 0 && <div className="dist-empty">{trD('gud.supNoPurchases')}</div>}
              {(detail.purchases || []).map((m) => {
                const meta = SM_META[m.type] || SM_META.correction;
                return (
                  <div key={m.id} className="dist-txn">
                    <span className={`gud-mtag ${meta.cls}`}>{trD(meta.l)}</span>
                    <div className="dist-txn-mid"><div className="dist-txn-name">{m.itemName || '—'}</div><div className="dist-txn-sub">{fmtDT(m.createdAt)}{m.actorName ? ' · ' + m.actorName : ''}{m.reason ? ' · ' + m.reason : ''}</div></div>
                    <b className="tnum gud-mqty in">+{numX(Math.abs(m.effect))}</b>
                  </div>
                );
              })}
            </div>
            <div className="modal-foot"><button className="btn btn-primary" onClick={() => setDetail(null)}>{trD('gud.ok')}</button></div>
          </div>
        </div>
      )}

      {toast && <div className="dist-toast"><span className="dist-toast-ic"><IconCheck s={15} /></span>{toast}</div>}
    </div>
  );
}

window.GUDANG = { Dept: GudangDept, Suppliers: GudangSuppliers };
