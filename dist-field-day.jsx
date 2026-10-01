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

// The tag at the right of a stop row (mockup colours): delivered green, held/cancelled red, fixed order
// purple, extra blue, open bon amber.
function fldStopTag(s) {
  if (s.status === 'terkirim') return ['ok', trFl('fld.st_terkirim')];
  if (s.status === 'ditunda') return ['neg', trFl('fld.st_ditunda')];
  if (s.status === 'batal') return ['neg', trFl('fld.st_batal')];
  if (s.pinned) return ['pin', trFl('fld.tagPinned')];
  if (s.source === 'tambahan') return ['info', trFl('fld.tagExtra')];
  if (s.sisaBon > 0) return ['bon', trFl('fld.tagBon')];
  return null;
}

function FldStopRow({ s, n, tone, onClick }) {
  const tag = fldStopTag(s);
  const sub = [s.customerCode, trFl('fld.nGalon', { n: s.planQty }), s.legKm != null ? FIELDLOGIC.fmtKm(s.legKm) : '', s.pendingReason].filter(Boolean).join(' · ');
  return (
    <button type="button" className="mlap-row mlap-rowbtn" onClick={onClick}>
      <span className={'mlap-num' + (tone ? ' ' + tone : '')}>{n}</span>
      <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{sub}</span></span>
      {s.gaps.count > 0 ? <span className="mlap-warn-dot" role="img" aria-label={trFl('fld.incompleteB')}><FldSvg n="exclamThin" s={11} sw={3} /></span> : null}
      {tag && <span className={'mlap-tag ' + tag[0]}>{tag[1]}</span>}
    </button>
  );
}

// BERIKUTNYA (mockup next-stop card): the stop's number, the distance, name + address (opens the stop),
// coloured chips, then Navigasi and the wider "Antar & catat".
function FldNextCard({ s, n, canSale, onSale, onOpen }) {
  const links = fldLinks(s);
  const chips = [['blue', trFl('fld.nGalon', { n: s.planQty })]];
  if (s.sisaBon > 0) chips.push(['bon', trFl('fld.bonTag', { v: FIELDLOGIC.fmtRp(s.sisaBon) })]);
  if (s.gallonsHeld != null) chips.push(['gray', trFl('fld.heldTag', { n: s.gallonsHeld })]);
  if (s.gaps.wa) chips.push(['warn', trFl('fld.noWa')]);
  return (
    <div className="mlap-card mlap-next">
      <button type="button" className="mlap-next-hd" onClick={onOpen}>
        <span className="mlap-nbig">{n}</span>
        <span className="mlap-grow">
          <span className="mlap-next-eb">{trFl('fld.next')}{s.legKm != null ? ' · ' + FIELDLOGIC.fmtKm(s.legKm) : ''}</span>
          <span className="mlap-next-nm">{s.customerName}</span>
          {s.address ? <span className="mlap-next-ad">{s.address}</span> : null}
        </span>
        <FldSvg n="chevron" s={14} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
      </button>
      <div className="mlap-chips">{chips.map(([t, c]) => <span key={c} className={'mlap-chip-s ' + t}>{t === 'warn' ? <FldSvg n="exclam" s={11} sw={2.8} /> : null}{c}</span>)}</div>
      <div className="mlap-actions">
        <FldLinkBtn href={links.nav} className="mlap-btn gray" newTab><FldSvg n="navigate" s={16} />{trFl('fld.navigate')}</FldLinkBtn>
        {canSale ? <button type="button" className="mlap-btn primary" onClick={onSale}><FldSvg n="check" s={16} sw={2.6} />{trFl('fld.deliverRecord')}</button> : null}
      </div>
    </div>
  );
}

function FldBoardScreen({ api, ctx, tick, can, onStop, onSale, onOpenRun, onIncomplete, onOutside }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [seg, setSeg] = uSfl('pending');
  uEfl(() => {
    let live = true; setErr(null);
    fldLoadDay(api, ctx).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick]);   // the shell bumps tick right after the context reloads — ctx is current here
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = d.view; const rs = d.rs; const r = d.route;
  const list = seg === 'pending' ? v.pending.filter((s) => !v.next || s.id !== v.next.id) : seg === 'done' ? v.done : v.held;
  // numbers run on like the board: delivered 1…k, the next stop k+1, then the waiting list; held = "!"
  const first = seg === 'pending' ? v.counts.done + (v.next ? 2 : 1) : 1;
  const pct = rs.open ? FIELDLOGIC.loadPct(rs.remaining, rs.open.gallonsOut) : 0;
  return (
    <>
      <div className="mlap-card mlap-ritcard">
        {rs.open && rs.stale ? (
          <FldNotice tone="warn" title={trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date })} sub={trFl('fld.staleRunB')} action={trFl('fld.closeRun')} onAction={onOpenRun} />
        ) : rs.open ? (
          <>
            <div className="mlap-rit-l">
              <span className="mlap-rit-dot" aria-hidden="true" />
              <b className="n">{trFl('fld.ritN', { n: rs.open.runNo })}</b>
              <span className="mlap-rit-left">· <b>{rs.remaining}</b> {trFl('fld.ofLoadLeft', { n: rs.open.gallonsOut })}</span>
              <button type="button" className="mlap-rit-link" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
            </div>
            <div className="mlap-bar" role="img" aria-label={trFl('fld.loadPctL', { p: pct })}><span style={{ width: pct + '%' }} /></div>
            {r ? (
              <div className="mlap-rit-meta">
                <span>{trFl('fld.nStops', { n: r.rit.length })}</span>
                <span>{trFl('fld.kmPlusBack', { km: FIELDLOGIC.fmtKm(r.totalKm - r.returnKm), back: FIELDLOGIC.fmtKm(r.returnKm) })}</span>
                {r.estRits ? <span>{trFl('fld.moreRits', { n: r.estRits })}</span> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="mlap-rit-l"><span className="mlap-rit-dot off" aria-hidden="true" /><b className="n">{trFl('fld.noRunT')}</b></div>
            <div className="mlap-rit-meta">{trFl('fld.noRunB')}</div>
            <button type="button" className="mlap-btn primary" onClick={onOpenRun}>{trFl('fld.openRunN', { n: rs.nextNo })}</button>
          </>
        )}
      </div>
      {v.incomplete > 0 && (
        <button type="button" className="mlap-alert warn" onClick={onIncomplete}>
          <FldSvg n="warn" s={18} sw={2.2} style={{ flexShrink: 0 }} />
          <span className="mlap-grow"><span className="t">{trFl('fld.incompleteT', { n: v.incomplete })}</span><span className="s">{trFl('fld.incompleteB')}</span></span>
          <span className="act">{trFl('fld.lengkapi')}</span>
        </button>
      )}
      {v.outsideRoute > 0 && (
        <button type="button" className="mlap-alert" onClick={onOutside}>
          <FldSvg n="pinOff" s={18} style={{ flexShrink: 0, color: '#9A3412' }} />
          <span className="mlap-grow"><span className="t">{trFl('fld.outsideT', { n: v.outsideRoute })}</span><span className="s">{trFl('fld.outsideB')}</span></span>
          <FldSvg n="chevron" s={14} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
        </button>
      )}
      {v.next && <FldNextCard s={v.next} n={v.counts.done + 1} canSale={!!(can && can.sale)} onSale={() => onSale(Object.assign({}, v.next, { boardNo: v.counts.done + 1 }))} onOpen={() => onStop(Object.assign({}, v.next, { boardNo: v.counts.done + 1 }))} />}
      <FldSeg size="sm" label={trFl('fld.filter')} value={seg} onChange={setSeg} options={[['pending', trFl('fld.segPending', { n: v.counts.pending })], ['done', trFl('fld.segDone', { n: v.counts.done })], ['held', trFl('fld.segHeld', { n: v.counts.held })]]} />
      <div className="mlap-card mlap-list">
        {list.length ? list.map((s, i) => {
          const n = seg === 'held' ? '!' : first + i;
          return <FldStopRow key={s.id} s={s} n={n} tone={seg === 'done' ? 'ok' : seg === 'held' ? 'neg' : ''} onClick={() => onStop(Object.assign({}, s, { boardNo: n }))} />;
        }) : <div className="mlap-empty">{trFl('fld.emptySeg')}</div>}
      </div>
      {v.outstanding.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.outstandingT', { n: v.outstanding.length })}</div>
          <div className="mlap-card mlap-list">
            {v.outstanding.map((o) => (
              <div key={o.id} className="mlap-row">
                <span className="mlap-num neg">{o.umur}</span>
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

// DETAIL STOP (mockup Stop board): a tall sheet — the stop's number + name, what data is missing (each
// with its own action), Navigasi / Telepon / WhatsApp, the order and the gallons held, the note, the
// money/gallon actions, Tunda / Batal (always with a written reason), and "Antar & catat" fixed below.
function FldStopSheet({ api, stop: s, can, onClose, onSale, onAction, onChanged }) {
  const drag = useFldSheetDrag(onClose);
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
  const checks = [['titik', 'fld.chkTitik', 'fld.setPin'], ['wa', 'fld.chkWa', 'fld.fillNo'], ['foto', 'fld.chkFoto', 'fld.camera']];
  const sub = [s.customerCode, s.address, s.deliveryDays && s.deliveryDays.length ? trFl('fld.sendDays', { d: s.deliveryDays.join(', ') }) : ''].filter(Boolean).join(' · ');
  const fix = can.location && s.gaps.count > 0 ? () => onAction('complete', fldCustFromStop(s)) : null;
  const acts = [];
  if (can.bon && s.sisaBon > 0) acts.push(['bon', 'cash', 'fld.terimaBon', FIELDLOGIC.fmtRp(s.sisaBon)]);
  if (can.adjust) acts.push(['adjust', 'adjust', 'fld.adjRow', '']);
  if (can.damage && s.gallonsHeld > 0) acts.push(['damage', 'bottleBroken', 'fld.dmgRow', '']);
  const pending = s.status === 'pending';
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet tall" role="dialog" aria-modal="true" aria-label={s.customerName} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead title={s.customerName} sub={sub} lead={s.boardNo != null ? <span className="mlap-nbig">{s.boardNo}</span> : null} onClose={onClose} />
        <div className="mlap-sheet-body">
          {s.gaps.count > 0 && (
            <div className="mlap-gapcard">
              <div className="mlap-gapcard-hd"><FldSvg n="warn" s={16} sw={2.2} /><span>{trFl('fld.gapsT', { n: 3 - s.gaps.count })}</span></div>
              {checks.map(([k, key, act]) => (
                <div key={k} className="mlap-check">
                  <span className={'mlap-dot ' + (s.gaps[k] ? 'miss' : 'ok')} aria-hidden="true">{s.gaps[k] ? '!' : '✓'}</span>
                  <span className="mlap-grow">{trFl(key)}</span>
                  {s.gaps[k] && fix ? <button type="button" className="mlap-gapact" onClick={fix}>{trFl(act)}</button> : null}
                </div>
              ))}
            </div>
          )}
          <div className="mlap-contacts">
            <FldLinkBtn href={links.nav} className="mlap-ctile" newTab><FldSvg n="navigate" s={18} />{trFl('fld.navigate')}</FldLinkBtn>
            <FldLinkBtn href={links.tel} className="mlap-ctile"><FldSvg n="phone" s={18} />{trFl('fld.call')}</FldLinkBtn>
            {links.wa ? <FldLinkBtn href={links.wa} className="mlap-ctile" newTab><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>
              : fix ? <button type="button" className="mlap-ctile miss" onClick={fix}><FldSvg n="wa" s={18} />{trFl('fld.fillWaTile')}</button>
                : <FldLinkBtn href="" className="mlap-ctile"><FldSvg n="wa" s={18} />{trFl('fld.wa')}</FldLinkBtn>}
          </div>
          <div className="mlap-card mlap-facts2">
            <div><span className="sb">{trFl('fld.orderToday')}</span><b className="blue">{trFl('fld.nGalon', { n: s.planQty })}</b></div>
            <div><span className="sb">{trFl('fld.heldAt')}</span><b>{s.gallonsHeld == null ? '—' : s.gallonsHeld}</b></div>
          </div>
          {s.note ? <div className="mlap-card mlap-notecard"><FldSvg n="note" s={16} /><span>{s.note}</span></div> : null}
          {acts.length || (!can.bon && s.sisaBon > 0) ? (
            <div className="mlap-card">
              {acts.map(([k, ico, key, val]) => (
                <button key={k} type="button" className="mlap-actrow" onClick={() => onAction(k, fldCustFromStop(s))}>
                  <FldSvg n={ico} s={17} /><span className="mlap-grow">{trFl(key)}</span>{val ? <b className="mlap-bontxt">{val}</b> : null}<FldSvg n="chevron" s={13} sw={2.4} />
                </button>
              ))}
              {!can.bon && s.sisaBon > 0 ? <div className="mlap-actrow off"><FldSvg n="cash" s={17} /><span className="mlap-grow">{trFl('fld.bonNow')}</span><b className="mlap-bontxt">{FIELDLOGIC.fmtRp(s.sisaBon)}</b></div> : null}
            </div>
          ) : null}
          {err && <div className="mlap-err" role="alert">{err}</div>}
          {pending && !mode && (
            <div className="mlap-holdrow">
              <button type="button" className="mlap-btn hold" onClick={() => { setMode('tunda'); setReason(''); }}><FldSvg n="clock" s={16} sw={2.2} />{trFl('fld.hold')}</button>
              <button type="button" className="mlap-btn cancel" onClick={() => { setMode('batal'); setReason(''); }}><FldSvg n="ban" s={16} sw={2.2} />{trFl('fld.cancelStop')}</button>
            </div>
          )}
          {mode && (
            <div className={'mlap-card mlap-reason' + (mode === 'batal' ? ' neg' : '')}>
              <b>{trFl(mode === 'tunda' ? 'fld.holdWhy' : 'fld.cancelWhy')}</b>
              <FldChips options={reasons} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} tone={mode === 'tunda' ? 'hold' : 'danger'} />
              <div className="mlap-actions">
                <button type="button" className="mlap-btn gray" onClick={() => setMode('')}>{trFl('fld.cancel')}</button>
                <button type="button" className={'mlap-btn ' + (mode === 'batal' ? 'danger' : 'primary')} disabled={busy || !reason.trim()} onClick={doHold}>{trFl(mode === 'tunda' ? 'fld.holdSave' : 'fld.cancelSave')}</button>
              </div>
            </div>
          )}
          {(s.status === 'ditunda' || s.status === 'batal') && <button type="button" className="mlap-btn mlap-wide" disabled={busy} onClick={reopen}>{trFl('fld.reopen')}</button>}
          {s.status === 'terkirim' && s.transactionId && (can.correct || can.void)
            ? <button type="button" className="mlap-btn mlap-wide" onClick={() => onAction('koreksi', { transactionId: s.transactionId, customerId: s.customerId })}>{trFl('fld.koreksiT')}</button>
            : s.status === 'terkirim' ? <div className="mlap-note">{trFl('fld.doneNote')}</div> : null}
        </div>
        {pending && !mode && can.sale ? (
          <div className="mlap-sheet-cta"><button type="button" className="mlap-btn primary" onClick={() => onSale(s)}><FldSvg n="check" s={18} sw={2.6} />{trFl('fld.deliverRecordFull')}</button></div>
        ) : null}
      </div>
    </>
  );
}

// A manual sale from Catat: no stop to mark — the same screen, `id: null`.
const fldSaleStopFromCust = (c) => ({ id: null, customerId: c.id, customerName: c.name, customerCode: c.code || '', masterPrice: c.masterPrice || 0, sisaBon: c.sisaBon || 0, gallonsHeld: c.gallonsHeld, planQty: 1 });

// TRANSAKSI — gallons out/back, Lunas/Bon/Transfer, what the customer pays now and what their bon
// becomes, a proof photo (always required here), then "save & mark delivered". The sale is created
// ONCE: if marking fails (no signal, or the server asks for a position), only the marking is retried —
// also after leaving this screen and coming back (the shell remembers the saved sale per stop), and the
// inputs lock once the sale is saved (they could no longer change it).
function FldSale({ api, stop: s, pending, refs, onDone, onBack, onPayBon }) {
  const held = s.gallonsHeld == null ? null : s.gallonsHeld;
  const [qty, setQty] = uSfl(Math.max(1, s.planQty || 1));
  const [back, setBack] = uSfl(held == null ? 0 : Math.min(held, 999));
  const [method, setMethod] = uSfl('lunas');
  const [photo, setPhoto] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const [needReason, setNeedReason] = uSfl(false);
  const [noLoc, setNoLoc] = uSfl('');
  const [txnId, setTxnId] = uSfl(() => (s.id ? pending.get(s.id) : null));
  // one ref per stop (or customer) until saved: a retry after a lost response — even after leaving this
  // screen or reloading — returns the sale already saved instead of a second one
  const slot = 'sale:' + (s.id || 'c:' + s.customerId);
  const [ref] = uSfl(() => refs.take(slot));
  const keep = (id) => { setTxnId(id); if (s.id) pending.set(s.id, id); };
  const pv = FIELDLOGIC.salePreview({ qty, price: s.masterPrice, method, sisaBon: s.sisaBon || 0 });
  const why = txnId ? '' : FIELDLOGIC.canSaveSale({ qty, photo });
  const save = () => {
    setBusy(true); setErr('');
    const body = FIELDLOGIC.saleBody({ customerId: s.customerId, qty, gallonIn: back, method, photo, clientRef: ref });
    FIELDLOGIC.recordSale(api, { stopId: s.id, body, txnId, noLocationReason: needReason ? noLoc.trim() : '' })
      .then((r) => {
        if (r.done) { if (s.id) pending.clear(s.id); refs.done(slot); onDone(trFl(r.replay ? 'fld.replayed' : 'fld.saleDone', { name: s.customerName })); return; }
        keep(r.txnId); setNeedReason(true);
      })
      .catch((e) => { if (e && e.txnId) keep(e.txnId); setErr(fldErrMsg(e) || trFl('fld.loadErr')); })
      .finally(() => setBusy(false));
  };
  const reqKey = method === 'transfer' ? 'fld.reqTf' : method === 'bon' ? 'fld.reqBon' : 'fld.reqCash';
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.saleTitle')} onBack={onBack} />
      <div className="mlap-body">
        <FldCustHead name={s.customerName} aside={<span className="mlap-custhead-sb">{[s.boardNo != null && s.boardNo !== '!' ? trFl('fld.stopN', { n: s.boardNo }) : '', s.customerCode].filter(Boolean).join(' · ')}</span>} />
        {txnId ? <FldNotice tone="warn" title={trFl('fld.savedNotMarkedT')} sub={trFl('fld.savedNotMarkedB')} /> : null}
        <fieldset className="mlap-fs" disabled={!!txnId}>
          <div className="mlap-card">
            <FldStepper label={trFl('fld.galOut')} hint={trFl('fld.galOutHint', { n: s.planQty })} value={qty} onChange={setQty} min={1} max={999} />
            <FldStepper label={trFl('fld.galBack')} hint={held == null ? '' : trFl('fld.galBackHint', { n: held })} value={back} onChange={setBack} min={0} max={999} />
          </div>
          <div className="mlap-label">{trFl('fld.payment')}</div>
          <FldSeg label={trFl('fld.payment')} value={method} onChange={setMethod} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
          <div className="mlap-card mlap-sum2">
            <div className="mlap-sumline"><span>{trFl('fld.qtyLine', { n: qty, p: FIELDLOGIC.fmtRp(s.masterPrice) })}</span><span>{FIELDLOGIC.fmtRp(pv.subtotal)}</span></div>
            {s.sisaBon > 0 ? <div className="mlap-sumline"><span>{trFl('fld.oldBon')}</span><span className="mlap-bontxt">{FIELDLOGIC.fmtRp(s.sisaBon)}</span></div> : null}
            <div className="mlap-sumdiv" />
            <div className="mlap-sumtot"><span>{trFl(pv.totalKey)}</span><b>{FIELDLOGIC.fmtRp(pv.paidNow)}</b></div>
            <div className={'mlap-after' + (method === 'bon' ? ' bon' : '')}>{method === 'bon' ? trFl('fld.bonAfter', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) }) : trFl('fld.bonStays', { v: FIELDLOGIC.fmtRp(pv.sisaAfter) })}</div>
            {onPayBon && !photo ? <button type="button" className="mlap-linkrow" onClick={onPayBon}><FldSvg n="cash" s={15} sw={2.2} />{trFl('fld.payOldBon')}</button> : null}
          </div>
          <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.proofHintSale" req={trFl(reqKey)} />
        </fieldset>
        {needReason && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.noLocT')}</b>
            <span className="sb">{trFl('fld.noLocB')}</span>
            <input className="mlap-text" value={noLoc} onChange={(e) => setNoLoc(e.target.value.slice(0, 300))} placeholder={trFl('fld.writeReason')} aria-label={trFl('fld.noLocT')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
      </div>
      <FldCtaBar hint={why ? trFl(why) : ''}>
        <button type="button" className="mlap-btn primary" disabled={busy || !!why || (needReason && !noLoc.trim())} onClick={save}><FldSvg n="check" s={18} sw={2.6} />{trFl(txnId ? 'fld.retryMark' : 'fld.saveDeliver')}</button>
      </FldCtaBar>
    </div>
  );
}

const FLD_SOP_REASONS = ['fld.sop_sedikit', 'fld.sop_stok', 'fld.sop_armada', 'fld.sop_terakhir'];
const FLD_DIFF = [['kembali_besok', 'fld.d_besok', 'Tetap di armada (besok)'], ['rusak', 'fld.d_rusak', 'Rusak'], ['hilang', 'fld.d_hilang', 'Hilang'], ['salah_hitung', 'fld.d_salah', 'Salah hitung']];   // [code, label key, the Indonesian text office records keep]

// Buka / Tutup rit as a sheet over Pengiriman (mockup Buka rit board): head with the close X, the body
// scrolls, the action stays at the bottom.
function FldRitSheet({ title, sub, onClose, cta, children }) {
  const drag = useFldSheetDrag(onClose);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet tall mid" role="dialog" aria-modal="true" aria-label={title} ref={drag.ref} style={drag.style}>
        <FldGrab handle={drag.handle} />
        <FldSheetHead big title={title} sub={sub} onClose={onClose} />
        <div className="mlap-sheet-body">{children}</div>
        {cta ? <div className="mlap-sheet-cta">{cta}</div> : null}
      </div>
    </>
  );
}

// BUKA RIT — how many gallons go on the truck. Capacity is a hard cap; below the owner's SOP the new
// UI always asks why (the server only insists once the switch is on). The preview plans the rit from
// the warehouse with the same planner the server uses.
function FldOpenRun({ api, ctx, tick, onDone, onBack }) {
  const rules = ctx.rules || {};
  const minLoad = (rules.ritSop && rules.ritSop.minLoad) || 80;
  const cap = (rules.fleetCapacity || {})[ctx.fleet] || 0;
  const [d, setD] = uSfl(null);
  const [load, setLoad] = uSfl(cap || minLoad);
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  uEfl(() => {
    let live = true;
    Promise.all([api.board(), api.runs()]).then(([board, runs]) => { if (live) setD({ board, runs }); }).catch((e) => { if (live) setErr(fldErrMsg(e)); });
    return () => { live = false; };
  }, [api, tick]);
  if (!d) return <FldRitSheet title={trFl('fld.openRunT')} onClose={onBack}>{err ? <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={err} /> : <div className="mlap-empty">{trFl('fld.loading')}</div>}</FldRitSheet>;
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: d.runs });
  if (rs.open) return <FldCloseRun api={api} run={rs.open} stale={rs.stale} onDone={onDone} onBack={onBack} />;
  const g = FIELDLOGIC.runGauge({ load, capacity: cap, minLoad });
  const pend = d.board.filter((s) => s.status === 'pending');
  const pv = FIELDLOGIC.loadPreview({
    planRit: window.RITPLAN && window.RITPLAN.planRit, depot: ctx.depot, load,
    stops: pend.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, pinned: s.pinned, qty: s.qty > 0 ? s.qty : ((ctx.demand || {})[s.id] || 1) })),
  });
  const presets = [...new Set([60, minLoad, 100, cap].filter((v) => v > 0 && (!cap || v <= cap)))].sort((a, b) => a - b);
  const open = () => {
    setBusy(true); setErr('');
    api.openRun({ gallonsOut: g.load, underSopReason: g.under ? reason.trim() : '' })
      .then(() => onDone(trFl('fld.runOpened', { n: rs.nextNo })))
      .catch((e) => setErr(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  const gpct = (x) => Math.max(0, Math.min(100, (x / g.max) * 100));
  const last = (d.runs || []).filter((r) => r.date === ctx.today).sort((a, b) => b.runNo - a.runNo)[0];
  const sub = [ctx.fleet, cap ? trFl('fld.capN', { n: cap }) : trFl('fld.capNone'), last ? trFl('fld.lastRunN', { n: last.runNo, g: last.gallonsOut }) : ''].filter(Boolean).join(' · ');
  return (
    <FldRitSheet title={trFl('fld.openRunN', { n: rs.nextNo })} sub={sub} onClose={onBack}
      cta={<button type="button" className="mlap-btn primary" disabled={busy || !g.canOpen || (g.under && !reason.trim())} onClick={open}>{trFl('fld.openAndRoute')}</button>}>
      <div className="mlap-card mlap-loadcard">
        <FldStepper label={trFl('fld.loadQ')} value={g.load} onChange={setLoad} min={0} max={cap || 9999} cls={'big teal' + (g.under ? ' under' : '')} />
        <div className="mlap-presets">{presets.map((v) => <button key={v} type="button" className={'mlap-preset' + (g.load === v ? ' on' : '')} aria-pressed={g.load === v} onClick={() => setLoad(v)}>{v}</button>)}</div>
        <div className="mlap-gauge">
          <div className="mlap-gauge-bar"><span className={g.under ? 'under' : ''} style={{ width: gpct(g.load) + '%' }} /><i style={{ left: gpct(minLoad) + '%' }} /></div>
          <div className="mlap-gauge-sc"><span>0</span><b style={{ left: gpct(minLoad) + '%' }}>{trFl('fld.sopN', { n: minLoad })}</b>{cap ? <span className="r">{trFl('fld.capN', { n: cap })}</span> : null}</div>
          {g.atCap ? <span className="mlap-gauge-full">{trFl('fld.fullLoad')}</span> : null}
        </div>
      </div>
      {g.under && (
        <div className="mlap-card mlap-reason warn">
          <div className="mlap-reason-hd"><FldSvg n="warn" s={16} sw={2.2} /><b>{trFl('fld.underSopT2', { n: minLoad - g.load })}</b></div>
          <FldChips options={FLD_SOP_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} tone="warn" />
          <span className="mlap-reason-note">{trFl('fld.underSopB')}</span>
        </div>
      )}
      {pv ? (
        <div className="mlap-card mlap-fit">
          <div className="mlap-fit-hd"><FldSvg n="route" s={16} /><b>{trFl('fld.previewT')}</b></div>
          <div className="mlap-fit-n"><b>{pv.fits}</b><span>{trFl('fld.fitsOf', { n: pv.total, g: pv.used })}</span></div>
          {pv.bar.length ? <div className="mlap-fitbar" aria-hidden="true">{pv.bar.map((b, i) => <span key={i} className={b.fit ? 'on' : ''} style={{ flex: b.qty }} />)}</div> : null}
          <span className={'mlap-after' + (pv.leftoverGallons > 0 ? '' : ' ok')}>{pv.leftoverGallons > 0 ? trFl('fld.fitLeft', { n: pv.total - pv.fits, g: pv.leftoverGallons }) : trFl('fld.fitAll', { g: g.load - pv.used })}</span>
          {pv.unlocated > 0 ? <span className="mlap-hint">{trFl('fld.previewNoPin', { n: pv.unlocated })}</span> : null}
        </div>
      ) : !ctx.depot ? <FldNotice tone="info" title={trFl('fld.noDepotT')} sub={trFl('fld.noDepotB')} /> : null}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </FldRitSheet>
  );
}

// TUTUP RIT — full and empty gallons brought back. A difference needs what happened; damaged/lost only
// make sense when gallons are missing (the server refuses them otherwise).
function FldCloseRun({ api, run, stale, onDone, onBack }) {
  const expected = Math.max(0, run.expectedRemaining != null ? run.expectedRemaining : ((run.gallonsOut || 0) - (run.sold || 0)));
  const [full, setFull] = uSfl(expected);
  const [empty, setEmpty] = uSfl(0);
  const [res, setRes] = uSfl('');
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [err, setErr] = uSfl('');
  const diff = full - expected; const lost = expected - full;
  const allowed = FLD_DIFF.filter(([k]) => ((k === 'rusak' || k === 'hilang') ? lost > 0 : true));
  uEfl(() => { if (res && !allowed.some(([k]) => k === res)) setRes(''); }, [full]);
  const close = () => {
    setBusy(true); setErr('');
    const label = (FLD_DIFF.find(([k]) => k === res) || [null, '', ''])[2];
    const body = { gallonsFullReturned: full, gallonsEmptyReturned: empty };
    if (diff !== 0) { body.diffReason = label + (note.trim() ? ' · ' + note.trim() : ''); body.resolution = res; }
    api.closeRun(run.id, body).then(() => onDone(trFl('fld.runClosed', { n: run.runNo }))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <FldRitSheet title={trFl('fld.closeRunT', { n: run.runNo })} sub={trFl('fld.loadedSold', { out: run.gallonsOut, sold: run.sold || 0 })} onClose={onBack}
      cta={<button type="button" className="mlap-btn primary" disabled={busy || (diff !== 0 && !res)} onClick={close}>{trFl('fld.closeRunSave')}</button>}>
      {stale ? <FldNotice tone="warn" title={trFl('fld.staleNote', { date: run.date })} sub={trFl('fld.staleRunB')} /> : null}
      <div className="mlap-card">
        <FldStepper label={trFl('fld.fullBack')} hint={trFl('fld.fullBackHint', { n: expected })} value={full} onChange={setFull} min={0} max={9999} />
        <FldStepper label={trFl('fld.emptyBack')} value={empty} onChange={setEmpty} min={0} max={9999} />
      </div>
      {diff !== 0 && (
        <div className="mlap-card mlap-reason warn">
          <div className="mlap-reason-hd"><FldSvg n="warn" s={16} sw={2.2} /><b>{trFl('fld.diffT', { d: (diff > 0 ? '+' : '') + diff })}</b></div>
          <div className="mlap-chips warn">{allowed.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (res === k ? ' on' : '')} aria-pressed={res === k} onClick={() => setRes(k)}>{trFl(key)}</button>)}</div>
          <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
        </div>
      )}
      {err && <div className="mlap-err" role="alert">{err}</div>}
    </FldRitSheet>
  );
}

// RUTE RIT / PETA (mockup Rute rit board) — today's open rit planned from the warehouse (the server's
// planner, or the phone's copy of it in practice): a full-bleed map under a glass bar, and a sheet that
// opens from 470 to 700 px with the figures and the legs. The map is a bonus: when Leaflet or the tiles
// can't load (offline), the sheet still works.
function FldRoute({ api, ctx, tick, fleet, mode, onOpenRun, onMenu, onAddStop }) {
  const [runs, setRuns] = uSfl([]);
  uEfl(() => { let live = true; api.runs().then((r) => { if (live) setRuns(r || []); }).catch(() => {}); return () => { live = false; }; }, [api, tick]);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs });
  const [route, setRoute] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [mapErr, setMapErr] = uSfl(false);
  const [open, setOpen] = uSfl(false);
  const mapEl = uRfl(null);
  const mapRef = uRfl(null);
  const routeOk = !!(rs.open && !rs.stale);
  uEfl(() => {
    if (!routeOk) return undefined;
    let live = true; setErr(null); setRoute(null);
    api.ritRoute().then((r) => { if (live) setRoute(r); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, routeOk]);
  uEfl(() => {
    if (!route || mapErr || !mapEl.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: false });
      L.control.attribution({ position: 'topright' }).addTo(map);
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      const depot = [route.origin.lat, route.origin.lng];
      const pts = [depot];
      L.marker(depot, { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [34, 34], html: '<span class="mlap-pin depot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"><path d="M3 12 12 4l9 8v8H3z"/></svg></span>' }) }).addTo(map);
      route.rit.forEach((s, i) => {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
        pts.push([s.lat, s.lng]);
        L.marker([s.lat, s.lng], { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [28, 28], html: '<span class="mlap-pin' + (i === 0 ? ' now' : '') + '">' + Number(s.order) + '</span>' }) }).addTo(map);
      });
      L.polyline(pts, { color: '#065489', weight: 4, opacity: 0.9 }).addTo(map);
      if (pts.length > 1) L.polyline([pts[pts.length - 1], depot], { color: '#065489', weight: 3.5, opacity: 0.75, dashArray: '2 7' }).addTo(map);
      map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.min(470, window.innerHeight * 0.56) + 24] });
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [route, mapErr]);
  const locate = () => { fldGeo(8000).then((p) => { if (p && mapRef.current) mapRef.current.setView([p.lat, p.lng], 16); }); };
  const bar = (title) => (
    <div className="mlap-mapbar">
      <div className="mlap-glass mlap-mappill">{routeOk ? <span className="mlap-rit-dot" aria-hidden="true" /> : null}<span className="mlap-mappill-t">{title}</span>{mode === 'latihan' ? <span className="mlap-chip latihan" role="note">{trFl('fld.modeLatihan')}</span> : null}</div>
      {route && !mapErr ? <button type="button" className="mlap-round" aria-label={trFl('fld.myPos')} onClick={locate}><FldSvg n="locate" s={18} /></button> : null}
      <button type="button" className="mlap-round" aria-label={trFl('fld.menu')} onClick={onMenu}><FldSvg n="dots" s={19} /></button>
    </div>
  );
  if (!rs.open || rs.stale) return (
    <div className="mlap-mapempty">
      {bar(trFl('fld.tabPeta'))}
      <FldNotice tone={rs.stale ? 'warn' : 'info'} title={rs.stale ? trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date }) : trFl('fld.noRunT')} sub={rs.stale ? trFl('fld.staleRunB') : trFl('fld.noRunB')}
        action={rs.stale ? trFl('fld.closeRun') : trFl('fld.openRunN', { n: rs.nextNo })} onAction={onOpenRun} />
    </div>
  );
  const title = trFl('fld.ritN', { n: rs.open.runNo }) + (fleet ? ' · ' + fleet : '');
  if (err) return <div className="mlap-mapempty">{bar(title)}<FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div>;
  if (!route) return <div className="mlap-mapempty">{bar(title)}<div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  const legs = open ? route.rit : route.rit.slice(0, 4);
  const first = route.rit[0];
  const firstNav = first ? fldLinks(first).nav : '';
  return (
    <>
      {mapErr ? null : <div ref={mapEl} className="mlap-map mlap-mapfull" role="img" aria-label={trFl('fld.routeT', { n: route.run.runNo })} />}
      {bar(title)}
      {mapErr ? <div className="mlap-mapempty"><FldNotice tone="info" title={trFl('fld.mapOff')} action={trFl('fld.retry')} onAction={() => setMapErr(false)} /></div> : null}
      <div className={'mlap-mapsheet' + (open ? ' open' : '')}>
        <button type="button" className="mlap-mapsheet-grab" aria-label={trFl(open ? 'fld.sheetLess' : 'fld.sheetMore')} aria-expanded={open} onClick={() => setOpen(!open)}><span className="mlap-grab" /></button>
        <div className="mlap-mapsheet-hd"><b>{trFl('fld.routeT', { n: route.run.runNo })}</b><span className="sb">{trFl('fld.fromDepot')}</span></div>
        <div className="mlap-mapsheet-in">
          <div className="mlap-card mlap-routefig2">
            <div><b className="teal">{route.used}/{route.capacity}</b><span>{trFl('fld.gallonsUsed')}</span></div>
            <div><b>{FIELDLOGIC.fmtKm(route.totalKm - route.returnKm)}</b><span>{trFl('fld.kmBack', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></div>
            <div><b>{route.leftover.length}</b><span>{trFl('fld.toRitN', { n: route.run.runNo + 1 })}</span></div>
          </div>
          {route.unlocated.length > 0 ? (
            <button type="button" className="mlap-alert warn sm" disabled={!onAddStop} onClick={onAddStop || undefined}>
              <FldSvg n="pinOff" s={15} sw={2.2} style={{ flexShrink: 0 }} />
              <span className="mlap-grow">{trFl('fld.unlocatedT', { n: route.unlocated.length })}</span>
              {onAddStop ? <span className="act">{trFl('fld.see')}</span> : null}
            </button>
          ) : null}
          {route.tooBig.length > 0 ? <FldNotice tone="warn" title={trFl('fld.tooBigT', { n: route.tooBig.length })} /> : null}
          <div className="mlap-card mlap-legs">
            {legs.length ? legs.map((s, i) => (
              <div key={s.id} className="mlap-row mlap-legrow">
                <span className={'mlap-legno' + (i === 0 ? ' now' : '')}>{s.order}</span>
                <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{trFl('fld.legSub', { q: s.qty, km: FIELDLOGIC.fmtKm(s.legKm) })}{i === 0 ? ' · ' + trFl('fld.nextLow') : ''}</span></span>
                <span className="mlap-legleft"><b>{s.loadAfter}</b><span className="sb">{trFl('fld.loadLeft')}</span></span>
              </div>
            )) : <div className="mlap-empty">{trFl('fld.emptyRoute')}</div>}
            {route.rit.length ? (
              <div className="mlap-row mlap-legrow">
                <span className="mlap-legno depot"><FldSvg n="home" s={14} sw={2.4} /></span>
                <span className="mlap-grow mlap-legdep">{trFl('fld.backToDepot', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span>
                <button type="button" className="mlap-rit-link" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mlap-mapsheet-cta"><FldLinkBtn href={firstNav} className="mlap-btn primary" newTab><FldSvg n="navigate" s={18} sw={2.2} />{first ? trFl('fld.navTo', { n: first.order }) : trFl('fld.navigate')}</FldLinkBtn></div>
      </div>
    </>
  );
}

// SETORAN / SELESAI KERJA (mockup Selesai board) — the day's money and gallons from the server's day
// summary (the same figures as the delivery report), then "close the day": every stop still waiting
// needs a reason (it moves to Tunda and carries over), picked in a sheet. Pending corrections never block
// closing.
function FldSetoran({ api, ctx, tick, canKoreksi, onKoreksiSaya, onChanged, onExpense, onIncomplete }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [reasons, setReasons] = uSfl({});
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  const [reload, setReload] = uSfl(0);
  const [askRe, setAskRe] = uSfl(false);
  const [pick, setPick] = uSfl(null);   // the stop whose reason is being chosen
  uEfl(() => {
    let live = true; setErr(null);
    Promise.all([api.daySummary(), api.board()]).then(([sum, board]) => { if (live) setD({ sum, board }); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  if (err) return <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const sum = d.sum;
  const pending = d.board.filter((s) => s.status === 'pending');
  const chk = FIELDLOGIC.closeCheck(pending, reasons);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const opts = FLD_HOLD_REASONS.map((k) => trFl(k));
  const gaps = d.board.filter((s) => FIELDLOGIC.gapsOf(s).count > 0).length;
  const rows = [['fld.s_tunai', sum.tunaiPenjualan], ['fld.s_pelunasan', sum.tunaiPelunasan], ['fld.s_transfer', sum.transfer], ['fld.s_bon', sum.bonBaru, 'bon'], ['fld.s_gantiRugi', sum.tunaiGantiRugi]];
  const close = () => {
    setBusy(true); setMsg('');
    const picked = {}; pending.forEach((s) => { picked[s.id] = String(reasons[s.id] || '').trim(); });
    api.closeDay({ reasons: picked, generalNote: note.trim() })
      .then(() => { setReasons({}); setReload((x) => x + 1); onChanged(trFl('fld.dayClosed')); })
      .catch((e) => setMsg(fldErrMsg(e)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="mlap-kpi3">
        <div><b className="ok">{sum.stops.terkirim}</b><span>{trFl('fld.k_terkirim')}</span></div>
        <div><b className="bon">{sum.stops.ditunda}</b><span>{trFl('fld.k_tunda')}</span></div>
        <div><b className="neg">{sum.stops.batal}</b><span>{trFl('fld.k_batal')}</span></div>
      </div>
      {canKoreksi ? (
        <button type="button" className="mlap-alert sm2" onClick={onKoreksiSaya}>
          <FldSvg n="pen" s={16} sw={2.2} style={{ color: '#7A4B00', flexShrink: 0 }} />
          <span className="mlap-grow"><span className="t">{sum.koreksiMenunggu > 0 ? trFl('fld.koreksiWait', { n: sum.koreksiMenunggu }) : trFl('fld.kSaya')}</span>{sum.koreksiMenunggu > 0 ? <span className="s">{trFl('fld.koreksiWaitB')}</span> : null}</span>
          <FldSvg n="chevron" s={12} sw={2.4} style={{ color: '#8A9AA3', flexShrink: 0 }} />
        </button>
      ) : sum.koreksiMenunggu > 0 ? <FldNotice tone="info" title={trFl('fld.koreksiWait', { n: sum.koreksiMenunggu })} sub={trFl('fld.koreksiWaitB')} /> : null}
      {sum.closeout ? <FldNotice tone="ok" title={trFl('fld.dayClosedT', { t: new Date(sum.closeout.closedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), by: sum.closeout.closedByName ? ' · ' + sum.closeout.closedByName : '' })} sub={trFl('fld.dayClosedB')} /> : null}
      {rs.open ? <FldNotice tone="warn" title={trFl('fld.openRunWarn', { n: rs.open.runNo })} /> : null}
      <div className="mlap-card">
        {rows.map(([k, v, tone]) => <div key={k} className="mlap-kv sm"><span>{trFl(k)}</span><b className={tone === 'bon' ? 'mlap-bontxt' : ''}>{FIELDLOGIC.fmtRp(v)}</b></div>)}
        {onExpense ? <button type="button" className="mlap-kv mlap-kvbtn" onClick={onExpense}><span>{trFl('fld.s_expense')}</span><b className="neg">{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</b><FldSvg n="chevron" s={12} sw={2.4} /></button>
          : <div className="mlap-kv"><span>{trFl('fld.s_expense')}</span><b className="neg">{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</b></div>}
        <div className="mlap-kv total"><span>{trFl('fld.s_setor')}</span><b>{FIELDLOGIC.fmtRp(sum.wajibSetor)}</b></div>
      </div>
      <div className="mlap-card mlap-gal3">
        <div><b>{sum.galon.keluar}</b><span>{trFl('fld.g_out')}</span></div>
        <div><b>{sum.galon.kembali}</b><span>{trFl('fld.g_back')}</span></div>
        <div><b className="neg">{sum.galon.rusak}</b><span>{trFl('fld.g_rusak')}</span></div>
      </div>
      {sum.ritDiBawahSop.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.sopRuns')}</div>
          <div className="mlap-card">{sum.ritDiBawahSop.map((r) => <div key={r.runNo} className="mlap-kv"><span>{trFl('fld.sopRunRow', { n: r.runNo, g: r.gallonsOut, r: r.reason })}</span></div>)}</div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="mlap-label">{trFl('fld.openStopsT')}</div>
          <div className="mlap-card">
            {pending.map((s) => {
              const r = String(reasons[s.id] || '').trim();
              return (
                <div key={s.id} className="mlap-closerow2">
                  <span className="mlap-closenm"><span className="nm">{s.customerName}</span></span>
                  <button type="button" className={'mlap-pickbtn' + (r ? '' : ' miss')} aria-label={trFl('fld.pickReason') + ' — ' + s.customerName} onClick={() => setPick(s)}><span>{r || trFl('fld.pickReason')}</span><FldSvg n="chevDown" s={12} sw={2.4} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {gaps > 0 && onIncomplete ? (
        <button type="button" className="mlap-alert warn sm" onClick={onIncomplete}>
          <FldSvg n="warn" s={15} sw={2.2} style={{ flexShrink: 0 }} />
          <span className="mlap-grow">{trFl('fld.gapsToday', { n: gaps })}</span>
          <span className="act">{trFl('fld.lengkapi')}</span>
        </button>
      ) : null}
      <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={trFl('fld.generalNote')} aria-label={trFl('fld.generalNote')} />
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
      <div className="mlap-ctaspace" />
      <FldCtaBar hint={chk.ok ? <span className="ok">{trFl('fld.allStopsDone')}</span> : trFl('fld.missingReasons', { n: chk.missing.length })}>
        <button type="button" className="mlap-btn primary" disabled={busy || !chk.ok} onClick={() => (sum.closeout ? setAskRe(true) : close())}>{trFl(sum.closeout ? 'fld.reclose' : 'fld.closeDay')}</button>
      </FldCtaBar>
      {pick && <FldPickSheet title={trFl('fld.reasonFor', { name: pick.customerName })} options={opts} value={reasons[pick.id] || ''} onPick={(o) => { setReasons(Object.assign({}, reasons, { [pick.id]: o })); setPick(null); }} onClose={() => setPick(null)} />}
      {askRe && <FldSheet title={trFl('fld.recloseT')} body={trFl('fld.recloseB')} confirmLabel={trFl('fld.reclose')} onClose={() => setAskRe(false)} onConfirm={() => { setAskRe(false); close(); }} />}
    </>
  );
}
