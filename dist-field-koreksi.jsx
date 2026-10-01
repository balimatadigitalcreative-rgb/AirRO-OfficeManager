// MODE LAPANGAN — KOREKSI. The driver says what is wrong with a delivered transaction; the request goes
// to the office through the existing approval engine (correction / void / reassign) and the original
// stays valid until it is approved (owner rule: every correction needs approval). "Koreksi saya" lists
// the driver's own requests. Built into the one bundle scope: top-level names start with Fld/FLD.

const FLD_KOREKSI_REASONS = ['fld.kr_salahInput', 'fld.kr_pelangganMinta', 'fld.kr_salahPelanggan'];
const FLD_KICO = { pelanggan: 'userMove', jumlah: 'bottlePlus', bayar: 'cash', nominal: 'cash', batal: 'ban' };
// A raw value of a correction row, in words (the boards' "struck-through → new").
const fldValText = (type, v) => (type === 'rp' ? FIELDLOGIC.fmtRp(v) : type === 'n' ? trFl('fld.nGalon', { n: v }) : type === 'pay' ? trFl('fld.m_' + v) : type === 'status' ? trFl('fld.ks_' + v) : String(v == null ? '—' : v));

// KOREKSI TRANSAKSI — pick what is wrong (customer, gallon count, pay method, bon-payment amount, or
// cancel); the server previews the effect with the same calculation the approval applies; a reason is
// always asked. Switching to Transfer needs the transfer receipt photo.
function FldKoreksi({ api, target, can, onDone, onBack, onSaya }) {
  const [d, setD] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [kind, setKind] = uSfl('');
  const [qty, setQty] = uSfl(1);
  const [gIn, setGIn] = uSfl(0);
  const [pay, setPay] = uSfl('');
  const [photo, setPhoto] = uSfl(null);
  const [amount, setAmount] = uSfl(null);
  const [toCust, setToCust] = uSfl(null);
  const [pv, setPv] = uSfl(null);
  const [pvErr, setPvErr] = uSfl('');
  const [reason, setReason] = uSfl('');
  const [busy, setBusy] = uSfl(false);
  const [msg, setMsg] = uSfl('');
  uEfl(() => {
    let live = true;
    api.customerDetail(target.customerId).then((x) => { if (live) setD(x); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, target.customerId]);
  const t = d ? (d.transactions || []).find((x) => x.id === target.transactionId) || null : null;
  // each kind starts from the transaction's own values
  const choose = (k) => {
    setKind(k); setPv(null); setPvErr(''); setMsg(''); setPhoto(null); setToCust(null);
    if (t) { setQty(t.qty || 1); setGIn(t.gallonIn || 0); setPay(FIELDLOGIC.payOf(t)); setAmount(t.amount); }
  };
  const change = kind === 'jumlah' ? { qty, gallonIn: gIn } : kind === 'bayar' ? { pay, photo } : kind === 'nominal' ? { amount } : kind === 'pelanggan' ? { toId: toCust ? toCust.id : null } : {};
  const why = t && kind ? FIELDLOGIC.koreksiCheck({ t, kind, change }) : '';
  const pvWhy = t && kind ? FIELDLOGIC.koreksiCheck({ t, kind, change, preview: true }) : '';
  // the server's preview of what the approval would do (a cancel needs none)
  uEfl(() => {
    if (!t || !kind || kind === 'batal' || pvWhy) { setPv(null); setPvErr(''); return undefined; }
    let live = true;
    const p = kind === 'pelanggan'
      ? api.previewReassign({ fromCustomerId: target.customerId, toCustomerId: toCust.id, transactionIds: [t.id], priceMode: 'keep' })
      : api.previewCorrection(t.id, FIELDLOGIC.correctionBody(t, change));
    p.then((x) => { if (live) { setPv(x); setPvErr(''); } }).catch((e) => { if (live) { setPv(null); setPvErr(fldErrMsg(e) || trFl('fld.loadErr')); } });
    return () => { live = false; };
  }, [kind, qty, gIn, pay, amount, toCust ? toCust.id : '', pvWhy, t ? t.id : '']);
  const send = () => {
    setBusy(true); setMsg('');
    const text = reason.trim();
    const p = kind === 'batal' ? api.requestVoid(t.id, { reason: text })
      : kind === 'pelanggan' ? api.requestReassign({ fromCustomerId: target.customerId, toCustomerId: toCust.id, transactionIds: [t.id], priceMode: 'keep', note: text, reason: text })
        : api.requestCorrection(t.id, Object.assign(FIELDLOGIC.correctionBody(t, change), { reason: FIELDLOGIC.koreksiReason(kind, t, change, text) }));
    p.then(() => onDone(trFl('fld.kSent'))).catch((e) => setMsg(fldErrMsg(e))).finally(() => setBusy(false));
  };
  const head = <FldTop title={trFl('fld.koreksiT')} onBack={onBack} />;
  if (err) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen">{head}<div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  if (!t) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.kNotFound')} /></div></div>;
  const opts = FIELDLOGIC.koreksiOptions(t, can);
  const payNow = FIELDLOGIC.payOf(t);
  const needPhoto = kind === 'bayar' && pay === 'transfer' && payNow !== 'transfer';
  const rp = FIELDLOGIC.fmtRp;
  const impact = kind ? FIELDLOGIC.koreksiImpact({ kind, t, change, pv }) : [];
  return (
    <div className="mlap-screen">
      {head}
      <div className="mlap-body">
        <div className="mlap-card mlap-txncard">
          <span className="mlap-txnthumb" aria-hidden="true"><FldSvg n="receipt" s={22} /></span>
          <span className="mlap-grow">
            <span className="mlap-txn-eb">{trFl('fld.kTxnAt', { d: t.txnDate })}</span>
            <span className="mlap-txn-nm">{[d.name, d.code].filter(Boolean).join(' · ')}</span>
            <span className="mlap-txn-sb">{trFl('fld.kTxnGal', { n: t.qty, b: t.gallonIn || 0 })} · <b className={payNow === 'bon' ? 'mlap-bontxt' : ''}>{trFl('fld.m_' + payNow)} {rp(t.effectiveAmount != null ? t.effectiveAmount : t.amount)}</b></span>
          </span>
        </div>
        {t.pendingRequest ? (
          <FldNotice tone="warn" title={trFl('fld.kPendingT')} sub={trFl('fld.kPendingB')} action={onSaya ? trFl('fld.kSaya') : null} onAction={onSaya} />
        ) : !opts.length ? (
          <FldNotice tone="info" title={trFl(t.kind === 'ganti_rugi' ? 'fld.kOnlyVoid' : 'fld.kNoOptions')} />
        ) : (
          <>
            {t.kind === 'ganti_rugi' ? <FldNotice tone="info" title={trFl('fld.kOnlyVoid')} /> : null}
            <div className="mlap-label">{trFl('fld.kWhat')}</div>
            <div className="mlap-cats" style={{ gridTemplateColumns: 'repeat(' + opts.length + ', minmax(0, 1fr))' }}>
              {opts.map((k) => <button key={k} type="button" className={'mlap-cat k' + (k === 'batal' ? ' danger' : '') + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => choose(k)}><FldSvg n={FLD_KICO[k]} s={19} /><span>{trFl('fld.kt_' + k)}</span></button>)}
            </div>
            {kind === 'jumlah' && (
              <div className="mlap-card">
                <FldStepper label={trFl('fld.ki_out')} hint={trFl('fld.kWas', { n: t.qty })} value={qty} onChange={setQty} min={1} max={999} cls={qty !== t.qty ? 'chg' : ''} />
                <FldStepper label={trFl('fld.galBack')} hint={trFl('fld.kWas', { n: t.gallonIn || 0 })} value={gIn} onChange={setGIn} min={0} max={999} cls={gIn !== (t.gallonIn || 0) ? 'chg' : ''} />
              </div>
            )}
            {kind === 'bayar' && (
              <div className="mlap-card mlap-cardsec">
                <span className="mlap-cardsec-t">{trFl('fld.kShouldBe')} · {trFl('fld.kWasPay')} <b className={payNow === 'bon' ? 'mlap-bontxt' : ''}>{trFl('fld.m_' + payNow)}</b></span>
                <FldSeg label={trFl('fld.ko_bayar')} value={pay} onChange={setPay} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
              </div>
            )}
            {kind === 'bayar' && needPhoto && (
              <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.kTransferPhotoHint" title={trFl('fld.kTransferPhoto')} />
            )}
            {kind === 'nominal' && <div className="mlap-card"><FldMoney label={trFl('fld.ko_nominal')} value={amount} onChange={setAmount} /></div>}
            {kind === 'batal' && <div className="mlap-voidcard" role="note"><FldSvg n="warn" s={18} sw={2.2} /><span>{trFl('fld.kVoidNote')}</span></div>}
            {kind === 'pelanggan' && <FldKoreksiCust api={api} t={t} fromId={target.customerId} value={toCust} onChange={setToCust} />}
            {kind && (
              <div className="mlap-card mlap-impact">
                <div className="mlap-impact-hd">{trFl('fld.kImpact')}</div>
                {impact.length ? impact.map((r, i) => (
                  <div key={i} className="mlap-improw"><span className="l">{trFl(r.key, { name: r.name })}</span><s>{fldValText(r.type, r.a)}</s><FldSvg n="arrowRight" s={12} sw={2.4} /><b>{fldValText(r.type, r.b)}</b></div>
                )) : <div className="mlap-impact-none">{trFl('fld.kNoChange')}</div>}
                {pv && pv.wouldGoNegative ? <div className="mlap-warnline">{trFl('fld.kNegative')}</div> : null}
              </div>
            )}
            {pvErr ? <div className="mlap-err" role="alert">{pvErr}</div> : null}
            {kind && (
              <>
                <div className="mlap-label">{trFl('fld.kReasonL')}</div>
                <FldChips options={FLD_KOREKSI_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
              </>
            )}
            {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
          </>
        )}
      </div>
      {kind && !t.pendingRequest && opts.length ? (
        <FldCtaBar hint={<span className="muted">{trFl('fld.kStaysValid')}</span>}>
          <button type="button" className={'mlap-btn ' + (kind === 'batal' ? 'danger solid' : 'primary')} disabled={busy || !!why || !!pvErr || !reason.trim()} onClick={send}>{trFl(kind === 'batal' ? 'fld.kSendVoid' : 'fld.kSendFix')}</button>
        </FldCtaBar>
      ) : null}
    </div>
  );
}

// The right customer: those nearest to where this transaction's photo was taken first (that is where the
// delivery happened), then a search over the armada's own customers.
function FldKoreksiCust({ api, t, fromId, value, onChange }) {
  const [list, setList] = uSfl(null);
  const [q, setQ] = uSfl('');
  uEfl(() => { let live = true; api.customers().then((r) => { if (live) setList(r || []); }).catch(() => { if (live) setList([]); }); return () => { live = false; }; }, [api]);
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const pt = typeof t.proofLat === 'number' && typeof t.proofLng === 'number' ? { lat: t.proofLat, lng: t.proofLng } : null;
  const near = q.trim() || !pt ? [] : FIELDLOGIC.nearCustomers(list, pt, fromId, 5);
  const rows = q.trim() ? FIELDLOGIC.customerList(list, { q, filter: 'all' }).rows.filter((c) => c.id !== fromId).slice(0, 40) : [];
  const row = (c, sub) => (
    <button key={c.id} type="button" className={'mlap-pickrow' + (value && value.id === c.id ? ' on' : '')} aria-pressed={!!(value && value.id === c.id)} onClick={() => onChange(c)}>
      <span className="mlap-radio" aria-hidden="true" />
      <span className="mlap-grow"><span className="nm">{c.name}</span><span className="sb">{sub}</span></span>
    </button>
  );
  const shown = q.trim() ? rows : near;
  return (
    <div className="mlap-card mlap-kcust">
      <div className="mlap-kcust-t">{trFl('fld.kMoveTo')}</div>
      <label className="mlap-searchbox gray"><FldSvg n="search" s={15} sw={2.2} /><input type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!q.trim() && near.length ? <div className="mlap-kcust-sub">{trFl('fld.kNear')}</div> : null}
      {value && !shown.some((c) => c.id === value.id) ? row(value, value.code || '') : null}
      {q.trim() ? rows.map((c) => row(c, c.code || '')) : near.map((c) => row(c, [c.code, trFl('fld.kNearM', { m: c.meters })].filter(Boolean).join(' · ')))}
    </div>
  );
}

// KOREKSI SAYA (mockup KoreksiList board) — the driver's own requests in two segments (waiting / done):
// what was asked as "from → to", the status, the office's decision. A waiting one can be withdrawn (after
// a confirm); a rejected or withdrawn one can be sent again. A failed withdraw is said here; the list stays.
function FldKoreksiSaya({ api, tick, onResubmit, onBack, onChanged }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [msg, setMsg] = uSfl('');
  const [ask, setAsk] = uSfl(null);
  const [busy, setBusy] = uSfl(false);
  const [reload, setReload] = uSfl(0);
  const [seg, setSeg] = uSfl('wait');
  uEfl(() => {
    let live = true; setErr(null);
    api.myChangeRequests().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [api, tick, reload]);
  const withdraw = () => {
    setBusy(true); setMsg('');
    api.withdrawRequest(ask.id).then(() => { setAsk(null); setReload((x) => x + 1); onChanged(trFl('fld.kWithdrawn')); })
      .catch((e) => { setAsk(null); setMsg(fldErrMsg(e) || trFl('fld.kWithdrawErr')); }).finally(() => setBusy(false));
  };
  const tabs = list ? FIELDLOGIC.koreksiTabs(list) : { wait: [], done: [] };
  const shown = seg === 'wait' ? tabs.wait : tabs.done;
  const by = (r) => (r.decidedBy && r.decidedBy.name ? r.decidedBy.name : trFl('fld.kOffice'));
  return (
    <div className="mlap-screen">
      <FldBackHead onBack={onBack} title={trFl('fld.kSaya')} />
      <div className="mlap-body">
        {err ? <FldNotice tone="warn" alert title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /> : null}
        {msg ? <div className="mlap-err" role="alert">{msg}</div> : null}
        {!list && !err ? <div className="mlap-empty">{trFl('fld.loading')}</div> : null}
        {list ? <FldSeg size="sm" label={trFl('fld.kSaya')} value={seg} onChange={setSeg} options={[['wait', trFl('fld.kTabWait', { n: tabs.wait.length })], ['done', trFl('fld.kTabDone', { n: tabs.done.length })]]} /> : null}
        {list && !shown.length ? <div className="mlap-empty">{trFl('fld.kSayaEmpty')}</div> : null}
        {shown.map((r) => {
          const v = FIELDLOGIC.requestView(r);
          return (
            <div key={r.id} className="mlap-card mlap-kcard">
              <div className="mlap-kcard-hd">
                <span className="mlap-grow"><span className="nm">{r.customerName || r.fromCustomerName || '—'}</span><span className="sb">{[trFl(v.kindKey), r.txnRef, r.txnDate].filter(Boolean).join(' · ')}</span></span>
                <span className={'mlap-tag ' + v.tone}>{trFl(v.statusKey)}</span>
              </div>
              {v.changes.length ? (
                <div className="mlap-fromto">
                  {v.changes.map((ch) => (
                    <React.Fragment key={ch.key}>
                      <span className="k">{trFl(ch.key)}</span>
                      <span className="v"><s>{fldValText(ch.type, ch.a)}</s><FldSvg n="arrowRight" s={12} sw={2.4} /><b>{fldValText(ch.type, ch.b)}</b></span>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
              {r.reason ? <span className="mlap-kreason">{r.reason}</span> : null}
              {r.decisionNote ? (
                <div className={'mlap-decision ' + v.tone}><b>{trFl(r.status === 'rejected' ? 'fld.kRejectedBy' : r.status === 'approved' ? 'fld.kApprovedBy' : 'fld.kWithdrawnBy', { name: by(r) })}</b><span>{r.decisionNote}</span></div>
              ) : null}
              {v.canWithdraw ? <button type="button" className="mlap-btn soft" disabled={busy} onClick={() => setAsk(r)}>{trFl('fld.kWithdrawFull')}</button> : null}
              {v.canResubmit && v.target.transactionId ? <button type="button" className="mlap-btn primary" onClick={() => onResubmit(v.target)}>{trFl('fld.kResubmit')}</button> : null}
            </div>
          );
        })}
      </div>
      {ask && <FldSheet title={trFl('fld.kWithdrawT')} body={trFl('fld.kWithdrawB')} confirmLabel={trFl('fld.kWithdraw')} danger onClose={() => setAsk(null)} onConfirm={withdraw} />}
    </div>
  );
}
