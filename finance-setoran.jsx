/* global React, FS, FIN, DP, UI, PERIOD */
/* AirRO — Delivery Setoran (per-armada daily deposit) input. window.SETORAN */
const { useState: uSt, useMemo: uMt } = React;
const trT = (k, v) => window.t(k, v);
const rpT = (n) => FIN.fmt(n);
function IcT(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

/* numeric money field */
function MoneyF({ value, onChange, accent }) {
  return (
    <div className="amt-input" style={{ padding: '8px 12px', borderColor: accent }}>
      <span className="amt-rp" style={{ fontSize: 13 }}>Rp</span>
      <input inputMode="numeric" style={{ fontSize: 15 }} value={value ? (+value).toLocaleString('id-ID') : ''}
        onChange={(e) => onChange(+e.target.value.replace(/\D/g, '') || 0)} />
    </div>
  );
}

/* add / edit one armada's daily setoran */
function SetoranModal({ row, fleet, accounts, depositAcct, onDepositAcctChange, onSave, onClose, canDelete }) {
  const [f, setF] = uSt(row);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const setoran = FS.setoranOf(f);
  const totalSales = (+f.cash || 0) + (+f.bon || 0);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trT('st.add') : trT('st.edit')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trT('st.date')}</label><DP.DateField value={f.date} onChange={(v) => set({ date: v })} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trT('st.armada')}</label><UI.Dropdown value={f.armada} options={fleet} onChange={(v) => set({ armada: v })} /></div>
          </div>
          <label className="fld-label">{trT('st.galon')}</label>
          <input className="fld" inputMode="numeric" value={f.galon || ''} placeholder="0" onChange={(e) => set({ galon: +e.target.value.replace(/\D/g, '') || 0 })} />
          <div className="st-money-grid">
            <div><label className="fld-label">{trT('st.cash')}</label><MoneyF value={f.cash} onChange={(v) => set({ cash: v })} accent="var(--green-700)" /></div>
            <div><label className="fld-label">{trT('st.bon')}</label><MoneyF value={f.bon} onChange={(v) => set({ bon: v })} /></div>
            <div><label className="fld-label">{trT('st.bonPay')}</label><MoneyF value={f.bonPay} onChange={(v) => set({ bonPay: v })} accent="var(--green-700)" /></div>
            <div><label className="fld-label">{trT('st.expense')}</label><MoneyF value={f.expense} onChange={(v) => set({ expense: v })} accent="var(--neg)" /></div>
          </div>
          <label className="fld-label">{trT('add.note')}</label>
          <input className="fld" value={f.note || ''} placeholder={trT('st.notePh')} onChange={(e) => set({ note: e.target.value })} />
          <label className="fld-label">{trT('att.proof')}</label>
          <UI.FileAttach value={f.proof || null} onChange={(v) => set({ proof: v })} />
          {onDepositAcctChange && accounts && (<>
            <label className="fld-label">{trT('st.depositTo')}</label>
            <UI.Dropdown value={depositAcct || (accounts.find((a) => a.type === 'cash') || accounts[0]).id} options={accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={onDepositAcctChange} />
            <div className="fld-hint">{trT('st.depositHint')}</div>
          </>)}
          <div className="st-calc">
            <div className="st-calc-row"><span>{trT('st.totalSales')}</span><b className="tnum">{rpT(totalSales)}</b></div>
            <div className="st-calc-row hl"><span>{trT('st.setoran')}</span><b className="tnum">{rpT(setoran)}</b></div>
            <div className="st-calc-note">{trT('st.formula')}</div>
          </div>
        </div>
        <div className="modal-foot">
          {canDelete && !f._new && <button className="btn btn-ghost" style={{ color: 'var(--neg)', marginRight: 'auto' }} onClick={() => onSave(f, true)}><IconClose s={15} />{trT('st.remove')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trT('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!f.armada} onClick={() => onSave(f)}>{trT('st.save')}</button>
        </div>
      </div>
    </div>
  );
}

function SetoranScreen({ setoran, onAdd, onEdit, onRemove, fleet, setFleet, accounts, canEdit, postedDays, onPost, autoSynced, costPerGalon, onCostChange, depositAcct, onDepositAcctChange, mfgAcct, onMfgAcctChange, payments, onAddPayment, onDelPayment }) {
  const costPer = +costPerGalon || 0;
  const defBank = ((accounts || []).find((a) => a.type === 'bank') || (accounts || [])[0] || {}).id;   // legacy default for production cost
  const [fleetMgr, setFleetMgr] = uSt(false);
  const [payModal, setPayModal] = uSt(false);
  const [gran, setGran] = uSt('day');
  const [anchor, setAnchor] = uSt(FIN.TODAY);
  const [edit, setEdit] = uSt(null);
  const range = PERIOD.resolveRange(gran, anchor);
  const periodLbl = PERIOD.periodLabel(gran, anchor, range);
  const rows = uMt(() => setoran.filter((r) => r.date >= range.start && r.date <= range.end), [setoran, range.start, range.end]);

  const agg = rows.reduce((a, r) => {
    a.galon += +r.galon || 0; a.cash += +r.cash || 0; a.bon += +r.bon || 0; a.bonPay += +r.bonPay || 0;
    a.expense += +r.expense || 0; a.setoran += FS.setoranOf(r); return a;
  }, { galon: 0, cash: 0, bon: 0, bonPay: 0, expense: 0, setoran: 0 });

  // group by date desc
  const byDate = {};
  rows.forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  const dates = Object.keys(byDate).sort().reverse();

  const save = (r, remove) => {
    if (remove) { onRemove(r.id); setEdit(null); return; }
    const clean = { ...r }; const isNew = clean._new; delete clean._new;
    if (isNew || !setoran.find((x) => x.id === r.id)) onAdd(clean); else onEdit(clean);
    setEdit(null);
  };
  const addNew = () => setEdit({ id: FS.newSetoranId(), date: FIN.TODAY, armada: fleet[0], galon: 0, cash: 0, bon: 0, bonPay: 0, expense: 0, note: '', _new: true });

  const exportCSV = () => {
    const head = ['Date', 'Armada', 'Galon', 'Cash sales', 'Credit (bon)', 'Bon payment', 'Expense', 'Setoran'];
    const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [head.join(',')];
    rows.slice().sort((a, b) => (a.date + a.armada).localeCompare(b.date + b.armada)).forEach((r) => lines.push([r.date, esc(r.armada), r.galon, r.cash, r.bon, r.bonPay, r.expense, FS.setoranOf(r)].join(',')));
    lines.push(['TOTAL', '', agg.galon, agg.cash, agg.bon, agg.bonPay, agg.expense, agg.setoran].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `AirRO-Setoran-${periodLbl.replace(/[^\w]+/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen-enter">
      <div className="hrr-head">
        <div className="period-bar">
          <div className="gran-seg">
            {[['day', 'rep.day'], ['week', 'rep.week'], ['month', 'rep.month'], ['year', 'rep.year']].map(([g, key]) => (
              <button key={g} className={`gran-btn ${gran === g ? 'on' : ''}`} onClick={() => setGran(g)}>{trT(key)}</button>
            ))}
          </div>
          <DP.PeriodNav gran={gran} anchor={anchor} onAnchor={setAnchor} label={periodLbl} today={FIN.TODAY} />
        </div>
        <div className="hrr-head-actions">
          {onCostChange && (
            <div className="st-cost-cfg" title={trT('st.costHint')}>
              <IconDrop s={15} style={{ color: 'var(--green-700)', flexShrink: 0 }} />
              <span className="st-cost-lbl">{trT('st.costGalonShort')}</span>
              <div className="amt-input st-cost-input"><span className="amt-rp" style={{ fontSize: 12 }}>Rp</span>
                <input inputMode="numeric" value={costPer ? costPer.toLocaleString('id-ID') : ''} placeholder="0"
                  onChange={(e) => onCostChange(+e.target.value.replace(/\D/g, '') || 0)} /></div>
            </div>
          )}
          {onMfgAcctChange && accounts && accounts.length > 0 && (
            <div className="st-cost-cfg st-mfg-cfg" title={trT('st.mfgAcctHint')}>
              <IconInvoice s={15} style={{ color: 'var(--green-700)', flexShrink: 0 }} />
              <span className="st-cost-lbl">{trT('st.mfgAcct')}</span>
              <div style={{ minWidth: 150 }}><UI.Dropdown value={mfgAcct || defBank} options={[...accounts.map((a) => ({ value: a.id, label: a.name })), { value: '__reference__', label: trT('st.mfgReference') }]} onChange={onMfgAcctChange} /></div>
            </div>
          )}
          <button className="btn btn-ghost" onClick={exportCSV}><IconDownload s={16} />{trT('hrr.csv')}</button>
          {canEdit && <button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trT('st.add')}</button>}
        </div>
      </div>
      {autoSynced && <div className="st-sync-banner"><IconCheck s={15} />{trT('st.syncBanner')}</div>}
      {(setFleet) && (
        <div className="st-cfg-row">
          {setFleet && <button className="btn btn-ghost" onClick={() => setFleetMgr(true)}><IconTruck s={15} />{trT('st.manageFleet')}</button>}
          {onAddPayment && accounts && <button className="btn btn-ghost" onClick={() => setPayModal(true)}><IconCoinIn s={15} />{trT('cp.add')}</button>}
        </div>
      )}

      {onAddPayment && payments && payments.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 8, marginBottom: 8 }}>
          <div className="sec-title" style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{trT('cp.recent')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {payments.slice(0, 6).map((e) => (
              <div key={e.id} className="cp-row">
                <span className="appr-ic" style={{ background: 'var(--pos-bg)', color: 'var(--green-700)' }}><IconCoinIn s={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="appr-title">{e.party || '—'}<span className="cp-method"> · {e.method}</span></div>
                  <div className="appr-sub tnum">{e.date} · {(accounts.find((a) => a.id === e.acct) || {}).name || ''}</div>
                </div>
                <b className="tnum amt-pos">{rpT(e.amount)}</b>
                {onDelPayment && <button className="icon-btn del" onClick={() => onDelPayment(e.id)}><IconClose s={15} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="fin-stat-row st-stats">
        <div className="card stat-box dark"><div className="tnum" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{rpT(agg.setoran)}</div><div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>{trT('st.totalSetoran')}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{periodLbl}</div></div>
        <div className="card stat-box"><div className="tnum" style={{ fontSize: 22, fontWeight: 800 }}>{agg.galon.toLocaleString('id-ID')}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trT('st.galonSold')}</div></div>
        <div className="card stat-box"><div className="tnum amt-neg" style={{ fontSize: 22, fontWeight: 800 }}>{rpT(agg.galon * costPer)}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trT('st.mfgCost')}</div><div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>@ {rpT(costPer)}/galon</div></div>
        <div className="card stat-box"><div className="tnum amt-pos" style={{ fontSize: 22, fontWeight: 800 }}>{rpT(agg.setoran - agg.galon * costPer)}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trT('st.grossMargin')}</div></div>
      </div>

      {dates.length === 0 && <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)', marginTop: 18 }}>{trT('st.none')}</div>}

      {dates.map((d) => {
        const items = byDate[d].slice().sort((a, b) => a.armada.localeCompare(b.armada));
        const daySet = items.reduce((s, r) => s + FS.setoranOf(r), 0);
        const posted = postedDays && postedDays[d];
        return (
          <div key={d} className="card st-day" style={{ marginTop: 16 }}>
            <div className="st-day-head">
              <div className="st-day-date"><IconCalendar s={16} />{niceDate(d)}<span className="st-day-cnt">{items.length} {trT('st.armadaShort')}</span></div>
              <div className="st-day-right">
                <span className="tnum st-day-total">{rpT(daySet)}</span>
                {costPer > 0 && <span className="st-day-mfg">{trT('st.mfgCost')}: <b className="tnum amt-neg">{rpT(items.reduce((s, r) => s + (+r.galon || 0), 0) * costPer)}</b></span>}
                {canEdit && onPost && (posted
                  ? <span className="pill pill-pos">{trT('st.posted')}</span>
                  : <button className="btn btn-lime" style={{ height: 34 }} onClick={() => onPost(d, items)}><IconCoinOut s={15} />{trT('st.post')}</button>)}
                {autoSynced && <span className="pill pill-pos" title={trT('st.syncHint')}><IconCheck s={13} />{trT('st.synced')}</span>}
              </div>
            </div>
            <div className="st-table-wrap">
              <table className="hrd-table st-table">
                <thead><tr><th className="hcell-name">{trT('st.armada')}</th><th>{trT('st.galon')}</th><th>{trT('st.cash')}</th><th>{trT('st.bon')}</th><th>{trT('st.bonPay')}</th><th>{trT('st.expense')}</th><th>{trT('st.setoran')}</th>{canEdit && <th></th>}</tr></thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id}>
                      <td className="hcell-name"><span className="st-armada"><IconTruck s={15} />{r.armada}</span></td>
                      <td className="tnum">{(+r.galon || 0).toLocaleString('id-ID')}</td>
                      <td className="tnum amt-pos">{rpT(r.cash)}</td>
                      <td className="tnum mut">{rpT(r.bon)}</td>
                      <td className="tnum">{rpT(r.bonPay)}</td>
                      <td className="tnum amt-neg">{rpT(r.expense)}</td>
                      <td className="tnum strong">{rpT(FS.setoranOf(r))}</td>
                      {canEdit && <td className="hcell-act"><button className="icon-btn" onClick={() => setEdit(r)}><IconPencil s={15} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {edit && <SetoranModal row={edit} fleet={fleet} accounts={accounts} depositAcct={depositAcct} onDepositAcctChange={onDepositAcctChange} onSave={save} onClose={() => setEdit(null)} canDelete={canEdit} />}
      {fleetMgr && setFleet && <FleetManager fleet={fleet} setFleet={setFleet} onClose={() => setFleetMgr(false)} />}
      {payModal && <PaymentModal accounts={accounts} onSave={(p) => { onAddPayment(p); setPayModal(false); }} onClose={() => setPayModal(false)} />}
    </div>
  );
}

function PaymentModal({ accounts, onSave, onClose }) {
  const [party, setParty] = uSt('');
  const [amount, setAmount] = uSt(0);
  const [acct, setAcct] = uSt((accounts.find((a) => a.type === 'bank') || accounts[0]).id);
  const [method, setMethod] = uSt('Transfer BCA');
  const [date, setDate] = uSt(FIN.TODAY);
  const [proof, setProof] = uSt(null);
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const valid = party.trim() && amount > 0;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trT('cp.title')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trT('cp.customer')}</label>
          <input className="fld" value={party} placeholder={trT('cp.customerPh')} onChange={(e) => setParty(e.target.value)} />
          <label className="fld-label">{trT('add.amount')}</label>
          <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span><input inputMode="numeric" style={{ fontSize: 16 }} value={amount ? amount.toLocaleString('id-ID') : ''} onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trT('cp.method')}</label>
              <UI.Dropdown value={method} options={['Transfer BCA', 'Transfer Mandiri', 'Transfer BRI', 'QRIS', 'Cash'].map((m) => ({ value: m, label: m }))} onChange={setMethod} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trT('cp.toAcct')}</label>
              <UI.Dropdown value={acct} options={accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={setAcct} /></div>
          </div>
          <label className="fld-label">{trT('add.date')}</label>
          <DP.DateField value={date} onChange={setDate} />
          <label className="fld-label">{trT('att.proof')}</label>
          <UI.FileAttach value={proof} onChange={setProof} />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trT('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave({ party, amount, acct, method, date, proof })}>{trT('cp.save')}</button>
        </div>
      </div>
    </div>
  );
}

function FleetManager({ fleet, setFleet, onClose }) {
  const [list, setList] = uSt(fleet.slice());
  React.useEffect(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const upd = (i, v) => { const n = list.slice(); n[i] = v; setList(n); };
  const rm = (i) => { const n = list.slice(); n.splice(i, 1); setList(n); };
  const add = () => setList([...list, '']);
  const saveAll = () => { const clean = list.map((x) => x.trim()).filter(Boolean); setFleet(clean.length ? clean : fleet); onClose(); };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trT('st.manageFleet')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginBottom: 12 }}>{trT('st.fleetIntro')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((name, i) => (
              <div key={i} className="ded-row">
                <span className="iconpick-btn" style={{ cursor: 'default' }}><IconTruck s={17} /></span>
                <input className="fld ded-label" value={name} placeholder={trT('st.carName')} onChange={(e) => upd(i, e.target.value)} />
                <button className="icon-btn del" title={trT('st.remove')} onClick={() => rm(i)} disabled={list.length <= 1}><IconClose s={15} /></button>
              </div>
            ))}
          </div>
          <button className="add-cat-btn" style={{ color: 'var(--green-700)' }} onClick={add}><IconPlus s={16} />{trT('st.addCar')}</button>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trT('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" onClick={saveAll}>{trT('st.save')}</button>
        </div>
      </div>
    </div>
  );
}

function niceDate(ds) { const d = new Date(ds + 'T00:00'); return `${PERIOD.dow ? PERIOD.dow(d) + ', ' : ''}${d.getDate()} ${PERIOD.mon(d.getMonth())} ${d.getFullYear()}`; }

window.SETORAN = { SetoranScreen };
