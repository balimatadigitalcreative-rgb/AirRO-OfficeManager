/* MODE LAPANGAN — CUSTOMER SCREENS + MANUAL INPUTS: Pelanggan, customer sheet, Lengkapi data, Atur titik,
   Tambah stop, Pembayaran bon, Penyesuaian galon, Ganti rugi galon, Pengeluaran. Every read/write goes
   through the adaptor `api` the shell hands in (real server or this phone's practice copy) — never the
   server directly. Owner rules kept here: a proof photo for every money-in and damage charge and every
   expense; expenses always cash from the deposit; gallon adjustments wait for the office; a pin moved
   more than 150 m from the phone asks to confirm. */

function FldCustomers({ api, tick, onOpen }) {
  const [list, setList] = uSfl(null);
  const [err, setErr] = uSfl(null);
  const [q, setQ] = uSfl('');
  const [filter, setFilter] = uSfl('all');
  uEfl(() => { let live = true; setErr(null); api.customers().then((r) => { if (live) setList(r || []); }).catch((e) => { if (live) setErr(e); }); return () => { live = false; }; }, [api, tick]);
  if (err) return <FldNotice tone="warn" title={trFl('fld.loadErr')} sub={fldErrMsg(err)} />;
  if (!list) return <div className="mlap-empty">{trFl('fld.loading')}</div>;
  const v = FIELDLOGIC.customerList(list, { q, filter });
  return (
    <>
      <input className="mlap-text mlap-search" type="search" placeholder={trFl('fld.searchCust')} aria-label={trFl('fld.searchCust')} value={q} onChange={(e) => setQ(e.target.value)} />
      <FldSeg label={trFl('fld.filter')} value={filter} onChange={setFilter} options={[['all', trFl('fld.f_all', { n: v.counts.all })], ['warn', trFl('fld.f_warn', { n: v.counts.warn })], ['bon', trFl('fld.f_bon', { n: v.counts.bon })], ['fixed', trFl('fld.f_fixed', { n: v.counts.fixed })]]} />
      <div className="mlap-card">
        {v.rows.length ? v.rows.map((c) => (
          <button key={c.id} type="button" className="mlap-row mlap-rowbtn" onClick={() => onOpen(c)}>
            <span className="mlap-ava" aria-hidden="true">{String(c.name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('').toUpperCase()}</span>
            <span className="mlap-grow">
              <span className="nm">{c.name}</span>
              <span className="sb">{[c.code, (c.deliveryDays || []).join(' · ')].filter(Boolean).join(' · ')}</span>
              {c.gaps.count > 0 ? <span className="mlap-gapline">{[c.gaps.titik ? trFl('fld.gapTitik') : '', c.gaps.wa ? trFl('fld.gapWa') : '', c.gaps.foto ? trFl('fld.gapFoto') : ''].filter(Boolean).join(' · ')}</span> : null}
            </span>
            <span className="mlap-legleft">
              {c.sisaBon > 0 ? <b className="mlap-bontxt">{FIELDLOGIC.fmtRp(c.sisaBon)}</b> : <span className="sb">{trFl('fld.noBon')}</span>}
              <span className="sb">{trFl('fld.nGalon', { n: c.gallonsHeld || 0 })}</span>
            </span>
          </button>
        )) : <div className="mlap-empty">{trFl('fld.noCustFilter')}</div>}
      </div>
    </>
  );
}

function FldCustSheet({ cust: c0, can, onClose, onAction }) {
  const c = Object.assign({}, c0, { gaps: c0.gaps || FIELDLOGIC.gapsOf(c0) });
  const links = fldLinks(c);
  const acts = [];
  if (can.sale) acts.push(['sale', 'fld.catatSale', 'primary']);
  if (can.bon && c.sisaBon > 0) acts.push(['bon', 'fld.catatBon', '']);
  if (can.location && c.gaps.count > 0) acts.push(['complete', 'fld.completeData', '']);
  if (can.addStop) acts.push(['addStop', 'fld.addToday', '']);
  if (can.adjust) acts.push(['adjust', 'fld.catatAdj', '']);
  if (can.damage && c.gallonsHeld > 0) acts.push(['damage', 'fld.catatDmg', '']);
  return (
    <>
      <button type="button" className="mlap-scrim" aria-label={trFl('fld.cancel')} onClick={onClose} />
      <div className="mlap-sheet" role="dialog" aria-modal="true" aria-label={c.name}>
        <div className="mlap-grab" />
        <h2>{c.name}</h2>
        <p>{[c.code, c.address].filter(Boolean).join(' · ')}</p>
        <div className="mlap-links">
          <a className={'mlap-btn' + (links.nav ? '' : ' off')} href={links.nav || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.nav}>{trFl('fld.navigate')}</a>
          <a className={'mlap-btn' + (links.tel ? '' : ' off')} href={links.tel || undefined} aria-disabled={!links.tel}>{trFl('fld.call')}</a>
          <a className={'mlap-btn' + (links.wa ? '' : ' off')} href={links.wa || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!links.wa}>{trFl('fld.wa')}</a>
        </div>
        <div className="mlap-card mlap-facts">
          <div><span className="sb">{trFl('fld.bonNow')}</span><b>{FIELDLOGIC.fmtRp(c.sisaBon || 0)}</b></div>
          <div><span className="sb">{trFl('fld.heldAt')}</span><b>{c.gallonsHeld == null ? '—' : c.gallonsHeld}</b></div>
          <div><span className="sb">{trFl('fld.dataLabel')}</span><b>{trFl('fld.dataN', { n: 3 - c.gaps.count })}</b></div>
        </div>
        <div className="mlap-actlist">
          {acts.map(([k, key, tone]) => <button key={k} type="button" className={'mlap-btn mlap-wide ' + tone} onClick={() => onAction(k, c)}>{trFl(key)}</button>)}
        </div>
      </div>
    </>
  );
}
