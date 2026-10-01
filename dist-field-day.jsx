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

const FLD_SOP_REASONS = ['fld.sop_sedikit', 'fld.sop_stok', 'fld.sop_armada', 'fld.sop_terakhir'];
const FLD_DIFF = [['kembali_besok', 'fld.d_besok'], ['rusak', 'fld.d_rusak'], ['hilang', 'fld.d_hilang'], ['salah_hitung', 'fld.d_salah']];

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
  if (!d) return err ? <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={err} /> : <div className="mlap-empty">{trFl('fld.loading')}</div>;
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
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.openRunN', { n: rs.nextNo })} sub={[ctx.fleet, cap ? trFl('fld.capN', { n: cap }) : trFl('fld.capNone')].join(' · ')} onBack={onBack} />
      <div className="mlap-body">
        <div className="mlap-card mlap-load">
          <span className="sb">{trFl('fld.loadQ')}</span>
          <div className={'mlap-loadval' + (g.under ? ' under' : '')}>{g.load}</div>
          <input type="range" className="mlap-range" min="0" max={g.max} value={g.load} onChange={(e) => setLoad(+e.target.value)} aria-label={trFl('fld.loadQ')} />
          <div className="mlap-scale"><span>0</span><span>{trFl('fld.sopN', { n: minLoad })}</span>{cap ? <span>{trFl('fld.capN', { n: cap })}</span> : <span />}</div>
          <FldStepper label={trFl('fld.loadQ')} value={g.load} onChange={setLoad} min={0} max={g.max} />
          <div className="mlap-chips">{presets.map((v) => <button key={v} type="button" className={'mlap-chip-b' + (g.load === v ? ' on' : '')} aria-pressed={g.load === v} onClick={() => setLoad(v)}>{v}</button>)}</div>
          {g.atCap ? <div className="mlap-hint ok">{trFl('fld.fullLoad')}</div> : null}
        </div>
        {g.under && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.underSopT', { n: g.load, min: minLoad })}</b>
            <FldChips options={FLD_SOP_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
            <span className="sb">{trFl('fld.underSopB')}</span>
          </div>
        )}
        {pv ? (
          <div className="mlap-card mlap-preview">
            <b>{trFl('fld.previewT')}</b>
            <span>{trFl('fld.previewFits', { n: pv.fits, g: pv.used })}</span>
            {pv.leftoverGallons > 0 ? <span className="sb">{trFl('fld.previewLeft', { g: pv.leftoverGallons, r: pv.estRits })}</span> : null}
            {pv.unlocated > 0 ? <span className="sb">{trFl('fld.previewNoPin', { n: pv.unlocated })}</span> : null}
          </div>
        ) : !ctx.depot ? <FldNotice tone="info" title={trFl('fld.noDepotT')} sub={trFl('fld.noDepotB')} /> : null}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !g.canOpen || (g.under && !reason.trim())} onClick={open}>{trFl('fld.openAndRoute')}</button>
      </div>
    </div>
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
    const label = (FLD_DIFF.find(([k]) => k === res) || [null, ''])[1];
    const body = { gallonsFullReturned: full, gallonsEmptyReturned: empty };
    if (diff !== 0) { body.diffReason = trFl(label) + (note.trim() ? ' · ' + note.trim() : ''); body.resolution = res; }
    api.closeRun(run.id, body).then(() => onDone(trFl('fld.runClosed', { n: run.runNo }))).catch((e) => setErr(fldErrMsg(e))).finally(() => setBusy(false));
  };
  return (
    <div className="mlap-screen">
      <FldTop title={trFl('fld.closeRunT', { n: run.runNo })} sub={trFl('fld.loadedSold', { out: run.gallonsOut, sold: run.sold || 0 })} onBack={onBack} />
      <div className="mlap-body">
        {stale ? <FldNotice tone="warn" title={trFl('fld.staleNote', { date: run.date })} sub={trFl('fld.staleRunB')} /> : null}
        <div className="mlap-card">
          <FldStepper label={trFl('fld.fullBack')} hint={trFl('fld.fullBackHint', { n: expected })} value={full} onChange={setFull} min={0} max={9999} />
          <FldStepper label={trFl('fld.emptyBack')} value={empty} onChange={setEmpty} min={0} max={9999} />
        </div>
        {diff !== 0 && (
          <div className="mlap-card mlap-reason warn">
            <b>{trFl('fld.diffT', { d: (diff > 0 ? '+' : '') + diff })}</b>
            <div className="mlap-chips">{allowed.map(([k, key]) => <button key={k} type="button" className={'mlap-chip-b' + (res === k ? ' on' : '')} aria-pressed={res === k} onClick={() => setRes(k)}>{trFl(key)}</button>)}</div>
            <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={trFl('fld.noteOpt')} aria-label={trFl('fld.noteOpt')} />
          </div>
        )}
        {err && <div className="mlap-err" role="alert">{err}</div>}
        <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || (diff !== 0 && !res)} onClick={close}>{trFl('fld.closeRunSave')}</button>
      </div>
    </div>
  );
}

// RUTE RIT / PETA — today's open rit planned from the warehouse (the server's planner, or the phone's
// copy of it in practice): map with numbered stops + the list. The map is a bonus: when Leaflet or the
// tiles can't load (offline), the list still works.
function FldRoute({ api, ctx, tick, onOpenRun }) {
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const [route, setRoute] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [mapErr, setMapErr] = uSfl(false);
  const [all, setAll] = uSfl(false);
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
    if (!route || !mapEl.current) return undefined;
    let live = true;
    znLoadLeaflet().then((L) => {
      if (!live || !mapEl.current) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      const depot = [route.origin.lat, route.origin.lng];
      const pts = [depot];
      L.marker(depot, { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [30, 30], html: '<span class="mlap-pin depot">G</span>' }) }).addTo(map);
      route.rit.forEach((s) => {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
        pts.push([s.lat, s.lng]);
        L.marker([s.lat, s.lng], { keyboard: false, icon: L.divIcon({ className: 'mlap-pin-wrap', iconSize: [26, 26], html: '<span class="mlap-pin">' + Number(s.order) + '</span>' }) }).addTo(map);
      });
      L.polyline(pts.concat([depot]), { color: '#065489', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(map);
      map.fitBounds(L.latLngBounds(pts).pad(0.2));
    }).catch(() => { if (live) setMapErr(true); });
    return () => { live = false; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [route]);
  if (!rs.open || rs.stale) return (
    <FldNotice tone={rs.stale ? 'warn' : 'info'} title={rs.stale ? trFl('fld.staleRunT', { n: rs.open.runNo, date: rs.open.date }) : trFl('fld.noRunT')} sub={rs.stale ? trFl('fld.staleRunB') : trFl('fld.noRunB')}
      action={rs.stale ? trFl('fld.closeRun') : trFl('fld.openRunN', { n: rs.nextNo })} onAction={onOpenRun} />
  );
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!route) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const legs = all ? route.rit : route.rit.slice(0, 4);
  const first = route.rit[0];
  const firstNav = first ? fldLinks(first).nav : '';
  return (
    <>
      {mapErr ? <FldNotice tone="info" title={trFl('fld.mapOff')} /> : <div ref={mapEl} className="mlap-map" role="img" aria-label={trFl('fld.routeT', { n: route.run.runNo })} />}
      <div className="mlap-card mlap-routehd">
        <div><b>{trFl('fld.routeT', { n: route.run.runNo })}</b><span className="sb">{trFl('fld.fromDepot')}</span></div>
        <div className="mlap-routefig"><span><b>{route.used}/{route.capacity}</b><span className="sb">{trFl('fld.gallonsUsed')}</span></span><span><b>{FIELDLOGIC.fmtKm(route.totalKm - route.returnKm)}</b><span className="sb">{trFl('fld.kmBack', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></span><span><b>{route.leftover.length}</b><span className="sb">{trFl('fld.toNextRun')}</span></span></div>
      </div>
      {route.unlocated.length > 0 ? <FldNotice tone="warn" title={trFl('fld.unlocatedT', { n: route.unlocated.length })} /> : null}
      {route.tooBig.length > 0 ? <FldNotice tone="warn" title={trFl('fld.tooBigT', { n: route.tooBig.length })} /> : null}
      <div className="mlap-card mlap-legs">
        {legs.length ? legs.map((s) => (
          <div key={s.id} className="mlap-row">
            <span className="mlap-num">{s.order}</span>
            <span className="mlap-grow"><span className="nm">{s.customerName}</span><span className="sb">{trFl('fld.legSub', { q: s.qty, km: FIELDLOGIC.fmtKm(s.legKm) })}</span></span>
            <span className="mlap-legleft"><b>{s.loadAfter}</b><span className="sb">{trFl('fld.loadLeft')}</span></span>
          </div>
        )) : <div className="mlap-empty">{trFl('fld.emptyRoute')}</div>}
        {route.rit.length > 4 && !all ? <button type="button" className="mlap-btn mlap-wide" onClick={() => setAll(true)}>{trFl('fld.showAll')}</button> : null}
        {route.rit.length ? <div className="mlap-row"><span className="mlap-num">G</span><span className="mlap-grow sb">{trFl('fld.backToDepot', { km: FIELDLOGIC.fmtKm(route.returnKm) })}</span></div> : null}
      </div>
      <div className="mlap-actions">
        <button type="button" className="mlap-btn" onClick={onOpenRun}>{trFl('fld.closeRun')}</button>
        <a className={'mlap-btn primary' + (firstNav ? '' : ' off')} href={firstNav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!firstNav}>{first ? trFl('fld.navTo', { n: first.order }) : trFl('fld.navigate')}</a>
      </div>
    </>
  );
}

// SETORAN / SELESAI KERJA — the day's money and gallons from the server's day summary (the same figures
// as the delivery report), then "close the day": every stop still waiting needs a reason (it moves to
// Tunda and carries over). Pending corrections never block closing.
function FldSetoran({ api, ctx, tick, onChanged }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [reasons, setReasons] = uSfl({});
  const [note, setNote] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  const [reload, setReload] = uSfl(0);
  uEfl(() => {
    let live = true; setErr(null);
    Promise.all([api.daySummary(), api.board()]).then(([sum, board]) => { if (live) setD({ sum, board }); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!d) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const sum = d.sum;
  const pending = d.board.filter((s) => s.status === 'pending');
  const chk = FIELDLOGIC.closeCheck(pending, reasons);
  const rs = FIELDLOGIC.runState({ today: ctx.today, openRun: ctx.openRun, runs: [] });
  const opts = FLD_HOLD_REASONS.map((k) => trFl(k));
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
      <div className="mlap-card mlap-kpis">
        <span><b>{sum.stops.terkirim}</b><span className="sb">{trFl('fld.k_terkirim')}</span></span>
        <span><b>{sum.stops.ditunda}</b><span className="sb">{trFl('fld.k_tunda')}</span></span>
        <span><b>{sum.stops.batal}</b><span className="sb">{trFl('fld.k_batal')}</span></span>
      </div>
      {sum.koreksiMenunggu > 0 ? <FldNotice tone="info" title={trFl('fld.koreksiWait', { n: sum.koreksiMenunggu })} sub={trFl('fld.koreksiWaitB')} /> : null}
      {rs.open ? <FldNotice tone="warn" title={trFl('fld.openRunWarn', { n: rs.open.runNo })} /> : null}
      <div className="mlap-card mlap-sum">
        {rows.map(([k, v, tone]) => <div key={k} className="mlap-sumrow"><span>{trFl(k)}</span><span className={tone === 'bon' ? 'mlap-bontxt' : ''}>{FIELDLOGIC.fmtRp(v)}</span></div>)}
        <div className="mlap-sumrow"><span>{trFl('fld.s_expense')}</span><span>{FIELDLOGIC.fmtRp(-sum.pengeluaran)}</span></div>
        <div className="mlap-sumrow total"><span>{trFl('fld.s_setor')}</span><b>{FIELDLOGIC.fmtRp(sum.wajibSetor)}</b></div>
      </div>
      <div className="mlap-card mlap-kpis">
        <span><b>{sum.galon.keluar}</b><span className="sb">{trFl('fld.g_out')}</span></span>
        <span><b>{sum.galon.kembali}</b><span className="sb">{trFl('fld.g_back')}</span></span>
        <span><b>{sum.galon.rusak}</b><span className="sb">{trFl('fld.g_rusak')}</span></span>
      </div>
      {sum.ritDiBawahSop.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.sopRuns')}</div>
          <div className="mlap-card">{sum.ritDiBawahSop.map((r) => <div key={r.runNo} className="mlap-row"><span className="mlap-grow sb">{trFl('fld.sopRunRow', { n: r.runNo, g: r.gallonsOut, r: r.reason })}</span></div>)}</div>
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className="mlap-eyebrow">{trFl('fld.openStopsT')}</div>
          <div className="mlap-card">
            {pending.map((s) => (
              <div key={s.id} className="mlap-row mlap-closerow">
                <span className="mlap-grow"><span className="nm">{s.customerName}</span></span>
                <select className={'mlap-select' + (String(reasons[s.id] || '').trim() ? '' : ' miss')} value={reasons[s.id] || ''} onChange={(e) => setReasons(Object.assign({}, reasons, { [s.id]: e.target.value }))} aria-label={trFl('fld.pickReason') + ' — ' + s.customerName}>
                  <option value="">{trFl('fld.pickReason')}</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          {!chk.ok ? <div className="mlap-hint">{trFl('fld.missingReasons', { n: chk.missing.length })}</div> : null}
        </>
      )}
      <input className="mlap-text" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={trFl('fld.generalNote')} aria-label={trFl('fld.generalNote')} />
      {msg && <div className="mlap-err" role="alert">{msg}</div>}
      <button type="button" className="mlap-btn primary mlap-wide" disabled={busy || !chk.ok} onClick={close}>{trFl('fld.closeDay')}</button>
    </>
  );
}
