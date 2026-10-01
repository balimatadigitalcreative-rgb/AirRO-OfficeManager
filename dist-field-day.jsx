/* MODE LAPANGAN — DAY SCREENS: Pengiriman, Detail stop, Transaksi, Buka/Tutup rit, Rute rit, Setoran.
   Every read/write goes through the adaptor `api` the shell hands in (real server or this phone's
   practice copy) — never the server directly. The rules the owner set are always followed here: a
   written reason for every hold, cancel, under-SOP load and unfinished stop, and a proof photo for every
   sale. */
const FLD_HOLD_REASONS = ['fld.r_tutup', 'fld.r_kosong', 'fld.r_besok', 'fld.r_habis'];

// Everything the Pengiriman screen shows, in one load. The route is asked only for TODAY's open rit
// (an older open rit must be closed first; the server would refuse its route).
function fldLoadDay(api, ctx) {
  return Promise.all([api.board(), api.customers(), api.runs(), api.outstanding()]).then(([board, customers, runs, outstanding]) => {
    const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs });
    return (rs.open && !rs.stale ? api.ritRoute().catch(() => null) : Promise.resolve(null)).then((route) => ({
      board, customers, runs, outstanding, route, rs,
      view: FIELDLOGIC.boardView({ board, customers, route, outstanding, demand: ctx.demand }),
    }));
  });
}

function fldStopTag(s) {
  if (s.status === 'terkirim') return ['ok', trFl('fld.st_terkirim')];
  if (s.status === 'ditunda') return ['held', trFl('fld.st_ditunda')];
  if (s.status === 'batal') return ['neg', trFl('fld.st_batal')];
  if (s.pinned) return ['pin', trFl('fld.tagPinned')];
  if (s.source === 'tambahan') return ['info', trFl('fld.tagExtra')];
  if (s.sisaBon > 0) return ['bon', trFl('fld.tagBon')];
  return null;
}

function FldStopRow({ s, n, onClick }) {
  const tag = fldStopTag(s);
  const sub = [s.customerCode, trFl('fld.nGalon', { n: s.planQty }), s.legKm != null ? FIELDLOGIC.fmtKm(s.legKm) : '', s.pendingReason].filter(Boolean).join(' · ');
  return (
    <button type="button" className="mlap-row mlap-rowbtn" onClick={onClick}>
      <span className="mlap-num">{n}</span>
      <span className="mlap-grow"><span className="nm">{s.customerName}{s.gaps.count > 0 ? <span className="mlap-warn-dot" aria-label={trFl('fld.incompleteB')}>!</span> : null}</span><span className="sb">{sub}</span></span>
      {tag && <span className={'mlap-tag ' + tag[0]}>{tag[1]}</span>}
    </button>
  );
}

function FldNextCard({ s, onSale, onOpen }) {
  const links = fldLinks(s);
  const chips = [trFl('fld.nGalon', { n: s.planQty })];
  if (s.sisaBon > 0) chips.push(trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(s.sisaBon) }));
  if (s.gallonsHeld != null) chips.push(trFl('fld.heldTag', { n: s.gallonsHeld }));
  if (s.gaps.wa) chips.push(trFl('fld.noWa'));
  return (
    <div className="mlap-card mlap-next">
      <button type="button" className="mlap-next-hd" onClick={onOpen}>
        <span className="mlap-eyebrow">{trFl('fld.next')}{s.legKm != null ? ' · ' + FIELDLOGIC.fmtKm(s.legKm) : ''}</span>
        <span className="mlap-next-nm">{s.customerName}</span>
        {s.address ? <span className="sb">{s.address}</span> : null}
      </button>
      <div className="mlap-chips">{chips.map((c) => <span key={c} className="mlap-chip-s">{c}</span>)}</div>
      <div className="mlap-actions">
        <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
        <button type="button" className="mlap-btn primary" onClick={onSale}>{trFl('fld.deliverRecord')}</button>
      </div>
    </div>
  );
}

function FldBoardScreen({ api, ctx, tick, onStop, onSale, onOpenRun, onRoute }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [seg, setSeg] = uSfl('pending');
  uEfl(() => {
    let live = true; setErr(null);
    fldLoadDay(api, ctx).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, ctx, tick]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = d.view; const rs = d.rs; const r = d.route;
  const list = seg === 'pending' ? v.pending : seg === 'done' ? v.done : v.held;
  return (
    <>
      <div className="mlap-card mlap-run">
        {rs.open && rs.stale ? (
          <FldNotice tone="warn" title={trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date })} sub={trFl('fld.staleRunB')} action={trFl('fld.closeRun')} onAction={onOpenRun} />
        ) : rs.open ? (
          <>
            <div className="mlap-run-l"><b>{trFl('fld.ritN', { n: rs.open.runNo })}</b><span className="mlap-run-big">{rs.remaining}</span><span className="sb">{trFl('fld.ofLoadLeft', { n: rs.open.gallonsOut })}</span></div>
            {r ? <div className="sb">{trFl('fld.routeLine', { stops: r.rit.length, km: FIELDLOGIC.fmtKm(r.totalKm - r.returnKm), back: FIELDLOGIC.fmtKm(r.returnKm), rits: r.estRits })}</div> : null}
            <div className="mlap-actions"><button type="button" className="mlap-btn" onClick={onRoute}>{trFl('fld.seeRoute')}</button><button type="button" className="mlap-btn" onClick={onOpenRun}>{trFl('fld.closeRun')}</button></div>
          </>
        ) : (
          <>
            <div className="mlap-run-l"><b>{trFl('fld.noRunT')}</b></div>
            <div className="sb">{trFl('fld.noRunB')}</div>
            <button type="button" className="mlap-btn primary" onClick={onOpenRun}>{trFl('fld.openRunN', { n: rs.nextNo })}</button>
          </>
        )}
      </div>
      {v.incomplete > 0 && <FldNotice tone="warn" title={trFl('fld.incompleteT', { n: v.incomplete })} sub={trFl('fld.incompleteB')} />}
      {v.outsideRoute > 0 && <FldNotice tone="info" title={trFl('fld.outsideT', { n: v.outsideRoute })} sub={trFl('fld.outsideB')} />}
      {v.next && <FldNextCard s={v.next} onSale={() => onSale(v.next)} onOpen={() => onStop(v.next)} />}
      <FldSeg label={trFl('fld.filter')} value={seg} onChange={setSeg} options={[['pending', trFl('fld.segPending', { n: v.counts.pending })], ['done', trFl('fld.segDone', { n: v.counts.done })], ['held', trFl('fld.segHeld', { n: v.counts.held })]]} />
      <div className="mlap-card">
        {list.length ? list.map((s, i) => <FldStopRow key={s.id} s={s} n={i + 1} onClick={() => onStop(s)} />) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {v.outstanding.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.outstandingT', { n: v.outstanding.length })}</div>
          <div className="mlap-card">
            {v.outstanding.map((o) => (
              <div key={o.id} className="mlap-row">
                <span className="mlap-num">{o.umur}</span>
                <span className="mlap-grow"><span className="nm">{o.customerName}</span><span className="sb">{[o.customerCode, o.date, o.pendingReason].filter(Boolean).join(' · ')}</span></span>
              </div>
            ))}
          </div>
          <div className="mlap-hint">{trFl('fld.outstandingHint')}</div>
        </>
      )}
    </>
  );
}

function FldStopSheet({ api, stop: s, onClose, onSale, onChanged }) {
  const [mode, setMode] = uSfl('');   // '' | 'tunda' | 'batal'
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const links = fldLinks(s);
  const reasons = FLD_HOLD_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')]);
  const doHold = () => {
    setBusy(true); setErr('');
    (mode === 'tunda' ? api.holdStop(s.id, reason) : api.cancelStop(s.id, reason))
      .then(() => onChanged(trFl(mode === 'tunda' ? 'fld.heldDone' : 'fld.cancelDone')))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  const reopen = () => {
    setBusy(true); setErr('');
    api.markStop(s.id, { status: 'pending' }).then(() => onChanged(trFl('fld.reopened'))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  const checks = [['titik', 'fld.chkTitik'], ['wa', 'fld.chkWa'], ['foto', 'fld.chkFoto']];
  const sub = [s.customerCode, s.address, s.deliveryDays && s.deliveryDays.length ? trFl('fld.sendDays', { d: s.deliveryDays.join(', ') }) : ''].filter(Boolean).join(' · ');
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={s.customerName}>
        <div className="mlap-grab" />
        <h2>{s.customerName}</h2>
        {sub ? <p>{sub}</p> : null}
        {s.gaps.count > 0 && (
          <div className="mlap-card mlap-checks">
            <div className="mlap-check-hd">{trFl('fld.gapsT', { n: 3 - s.gaps.count })}</div>
            {checks.map(([k, key]) => (
              <div key={k} className="mlap-check">
                <span className={'mlap-dot ' + (s.gaps[k] ? 'miss' : 'ok')} aria-hidden="true">{s.gaps[k] ? '!' : '✓'}</span>
                <span className="mlap-grow">{trFl(key)}</span>
                {s.gaps[k] ? <span className="sb">{trFl('fld.fillLater')}</span> : null}
              </div>
            ))}
          </div>
        )}
        <div className="mlap-links">
          <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
          <a className={'mlap-btn' + (links.tel ? '' : ' off')} href={links.tel || undefined} aria-disabled={!links.tel}>{trFl('fld.call')}</a>
          <a className={'mlap-btn' + (links.wa ? '' : ' off')} href={links.wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.wa}>{trFl('fld.wa')}</a>
        </div>
        <div className="mlap-card mlap-facts">
          <div><span className="sb">{trFl('fld.orderToday')}</span><b>{trFl('fld.nGalon', { n: s.planQty })}</b></div>
          <div><span className="sb">{trFl('fld.heldAt')}</span><b>{s.gallonsHeld == null ? '—' : s.gallonsHeld}</b></div>
          <div><span className="sb">{trFl('fld.bonNow')}</span><b>{FIELDLOGIC.fmtRp(s.sisaBon || 0)}</b></div>
        </div>
        {s.note ? <div className="mlap-note">{s.note}</div> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {s.status === 'pending' && !mode && (
          <>
            <div className="mlap-actions">
              <button type="button" className="mlap-btn" onClick={() => { setMode('tunda'); setReason(''); }}>{trFl('fld.hold')}</button>
              <button type="button" className="mlap-btn danger" onClick={() => { setMode('batal'); setReason(''); }}>{trFl('fld.cancelStop')}</button>
            </div>
            <button type="button" className="mlap-btn primary mlap-wide" onClick={() => onSale(s)}>{trFl('fld.deliverRecord')}</button>
          </>
        )}
        {mode && (
          <div className="mlap-card mlap-reason">
            <b>{trFl(mode === 'tunda' ? 'fld.holdWhy' : 'fld.cancelWhy')}</b>
            <FldChips options={reasons} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
            <div className="mlap-actions">
              <button type="button" className="mlap-btn" onClick={() => setMode('')}>{trFl('fld.cancel')}</button>
              <button type="button" className={'mlap-btn ' + (mode === 'batal' ? 'danger' : 'primary')} disabled={busy || !reason.trim()} onClick={doHold}>{trFl(mode === 'tunda' ? 'fld.holdSave' : 'fld.cancelSave')}</button>
            </div>
          </div>
        )}
        {(s.status === 'ditunda' || s.status === 'batal') && <button type="button" className="mlap-btn mlap-wide" disabled={busy} onClick={reopen}>{trFl('fld.reopen')}</button>}
        {s.status === 'terkirim' && <div className="mlap-note">{trFl('fld.doneNote')}</div>}
      </div>
    </>
  );
}

// TRANSAKSI — gallons out/back, Lunas/Bon/Transfer, what the customer pays now and what their bon
// becomes, a proof photo (always required here), then "save & mark delivered". The sale is created
// ONCE: if marking fails (no signal, or the server asks for a position), only the marking is retried.
function FldSale({ api, stop: s, onDone, onBack }) {
  const held = s.gallonsHeld == null ? null : s.gallonsHeld;
  const [qty, setQty] = uSfl(Math.max(1, s.planQty || 1));
  const [back, setBack] = uSfl(held == null ? 0 : Math.min(held, 999));
  const [method, setMethod] = uSfl('lunas');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [needReason, setNeedReason] = uSfl(false);
  const [noLoc, setNoLoc] = uSfl('');
  const txnRef = uRfl(null);
  const pv = FIELDLOGIC.salePreview({ qty, price: s.masterPrice, method, sisaBon: s.sisaBon || 0 });
  const why = FIELDLOGIC.canSaveSale({ qty, photo });
  const save = () => {
    setBusy(true); setErr('');
    const body = FIELDLOGIC.saleBody({ customerId: s.customerId, qty, gallonIn: back, method, photo });
    FIELDLOGIC.recordSale(api, { stopId: s.id, body, txnId: txnRef.current, noLocationReason: needReason ? noLoc.trim() : '' })
      .then((r) => { txnRef.current = r.txnId; if (r.done) onDone(trFl('fld.saleDone', { name: s.customerName })); else setNeedReason(true); })
      .catch((e) => { if (e && e.txnId) txnRef.current = e.txnId; setErr(fldErrMsg(e) || trFl('fld.loadErr')); })
      .finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.saleTitle')} sub={[s.customerName, s.customerCode].filter(Boolean).join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card">
          <FldStepper label={trFl('fld.galOut')} hint={trFl('fld.galOutHint', { n: s.planQty })} value={qty} onChange={setQty} min={1} max={999} />
          <FldStepper label={trFl('fld.galBack')} hint={held == null ? '' : trFl('fld.galBackHint', { n: held })} value={back} onChange={setBack} min={0} max={999} />
        </div>
        <div className="mlap-eyebrow">{trFl('fld.payment')}</div>
        <FldSeg label={trFl('fld.payment')} value={method} onChange={setMethod} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
        <div className="mlap-card mlap-sum">
          <div className="mlap-sumrow"><span>{trFl('fld.qtyLine', { n: qty, p: FIELDLOGIC.fmtRp(s.masterPrice) })}</span><b>{FIELDLOGIC.fmtRp(pv.subtotal)}</b></div>
          {s.sisaBon > 0 ? <div className="mlap-sumrow"><span>{trFl('fld.oldBon')}</span><span>{FIELDLOGIC.fmtRp(s.sisaBon)}</span></div> : null}
          <div className="mlap-sumrow total"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.paidNow)}</b></div>
          <div className={'mlap-after' + (method === 'bon' ? ' bon' : '')}>{method === 'bon' ? trFl('fld.bonAfter', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) }) : trFl('fld.bonStays', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) })}</div>
        </div>
        <div className="mlap-eyebrow">{trFl('fld.proof')} · {trFl('fld.required')}</div>
        <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintSale" />
        {needReason && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.noLocT')}</b>
            <span className="sb">{trFl('fld.noLocB')}</span>
            <input className="mlap-text" value={noLoc} onChange={(e) => setNoLoc(e.target.value.slice(0, 300))} placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.noLocT')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !!why || (needReason && !noLoc.trim())} onClick={save}>{trFl(txnRef.current ? 'fld.retryMark' : 'fld.saveDeliver')}</button>
      </div>
    </div>
  );
}
