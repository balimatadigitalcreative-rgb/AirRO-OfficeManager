// MODE LAPANGAN — KOREKSI. The driver says what is wrong with a delivered transaction; the request goes
// to the office through the existing approval engine (correction / void / reassign) and the original
// stays valid until it is approved (owner rule: every correction needs approval). "Koreksi saya" lists
// the driver's own requests. Built into the one bundle scope: top-level names start with Fld/FLD.

const FLD_KOREKSI_REASONS = ['fld.kr_salahInput', 'fld.kr_pelangganMinta', 'fld.kr_salahPelanggan'];

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
  const head = <FldTop title={trFl('fld.koreksiT')} sub={d ? [d.name, d.code].filter(Boolean).join(' · ') : ''} onBack={onBack} />;
  if (err) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} /></div></div>;
  if (!d) return <div className="mlap-screen">{head}<div className="mlap-empty">{trFl('fld.loading')}</div></div>;
  if (!t) return <div className="mlap-screen">{head}<div className="mlap-body"><FldNotice tone="warn" title={trFl('fld.kNotFound')} /></div></div>;
  const opts = FIELDLOGIC.koreksiOptions(t, can);
  const payNow = FIELDLOGIC.payOf(t);
  const needPhoto = kind === 'bayar' && pay === 'transfer' && payNow !== 'transfer';
  const rp = FIELDLOGIC.fmtRp;
  return (
    <div className="mlap-screen">
      {head}
      <div className="mlap-body">
        <div className="mlap-card mlap-sec">
          <span className="sb">{trFl('fld.kTxnLine', { date: t.txnDate, n: t.qty, pay: trFl('fld.m_' + payNow), v: rp(t.effectiveAmount != null ? t.effectiveAmount : t.amount) })}</span>
        </div>
        {t.pendingRequest ? (
          <FldNotice tone="warn" title={trFl('fld.kPendingT')} sub={trFl('fld.kPendingB')} action={onSaya ? trFl('fld.kSaya') : null} onAction={onSaya} />
        ) : !opts.length ? (
          <FldNotice tone="info" title={trFl(t.kind === 'ganti_rugi' ? 'fld.kOnlyVoid' : 'fld.kNoOptions')} />
        ) : (
          <>
            {t.kind === 'ganti_rugi' ? <FldNotice tone="info" title={trFl('fld.kOnlyVoid')} /> : null}
            <div className="mlap-eyebrow">{trFl('fld.kWhat')}</div>
            <div className="mlap-chips">{opts.map((k) => <button key={k} type="button" className={'mlap-chip-b' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => choose(k)}>{trFl('fld.ko_' + k)}</button>)}</div>
            {kind === 'jumlah' && (
              <div className="mlap-card">
                <FldStepper label={trFl('fld.galOut')} value={qty} onChange={setQty} min={1} max={999} />
                <FldStepper label={trFl('fld.galBack')} value={gIn} onChange={setGIn} min={0} max={999} />
              </div>
            )}
            {kind === 'bayar' && (
              <>
                <FldSeg label={trFl('fld.ko_bayar')} value={pay} onChange={setPay} options={[['lunas', trFl('fld.m_lunas')], ['bon', trFl('fld.m_bon')], ['transfer', trFl('fld.m_transfer')]]} />
                {needPhoto && (
                  <>
                    <div className="mlap-eyebrow">{trFl('fld.kTransferPhoto')} · {trFl('fld.required')}</div>
                    <FldPhoto api={api} value={photo} onChange={setPhoto} hintKey="fld.kTransferPhotoHint" />
                  </>
                )}
              </>
            )}
            {kind === 'nominal' && <div className="mlap-card"><FldMoney label={trFl('fld.ko_nominal')} value={amount} onChange={setAmount} /></div>}
            {kind === 'batal' && <FldNotice tone="warn" title={trFl('fld.kVoidNote')} />}
            {/* KOREKSI-PELANGGAN */}
            {pv && kind !== 'pelanggan' && (
              <div className="mlap-card mlap-sum">
                <div className="mlap-sumrow"><span>{trFl('fld.kAmountLine', { a: rp(pv.oldAmount), b: rp(pv.newAmount) })}</span></div>
                <div className="mlap-sumrow"><span>{trFl('fld.kBonLine', { a: rp(pv.oldSisaBon), b: rp(pv.newSisaBon) })}</span></div>
                {pv.wouldGoNegative ? <div className="mlap-warnline">{trFl('fld.kNegative')}</div> : null}
              </div>
            )}
            {pvErr ? <div className="mlap-err" role="alert">{pvErr}</div> : null}
            {kind && (
              <div className="mlap-card mlap-reason">
                <b>{trFl('fld.kReasonT')}</b>
                <FldChips options={FLD_KOREKSI_REASONS.map((k) => trFl(k)).concat([trFl('fld.r_other')])} otherLabel={trFl('fld.r_other')} value={reason} onChange={setReason} />
              </div>
            )}
            {kind && kind !== 'batal' ? <div className="mlap-hint">{trFl('fld.kStaysValid')}</div> : null}
            {why ? <div className="mlap-hint">{trFl(why)}</div> : null}
            {msg && <div className="mlap-err" role="alert">{msg}</div>}
            {kind && <button type="button" className={'mlap-btn mlap-wide ' + (kind === 'batal' ? 'danger' : 'primary')} disabled={busy || !!why || !!pvErr || !reason.trim()} onClick={send}>{trFl('fld.kSend')}</button>}
          </>
        )}
      </div>
    </div>
  );
}
