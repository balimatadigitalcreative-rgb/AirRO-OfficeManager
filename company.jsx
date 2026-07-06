/* global React, HRD, CO, FIN, DonutChart, Ring */
const { useState: uSc, useMemo: uMc, useEffect: uEc } = React;
const trC = (k, v) => window.t(k, v);
function IcC(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }
const rpC = (n) => FIN.fmt(n);

/* ---------- Budget gauge ring ---------- */
function BudgetRing({ aff }) {
  const pct = Math.round(aff.util * 100);
  const over = aff.remaining < 0;
  const color = over ? '#E5484D' : aff.util > 0.85 ? '#B07A12' : '#0B7EB1';
  const size = 132, stroke = 13, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const dash = Math.min(1, aff.util) * C;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7F1F5" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${dash} ${C}`} />
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="tnum" style={{ fontFamily: 'Poppins', fontSize: 26, fontWeight: 800, color }}>{pct}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-mut)' }}>{trC('co.ofBudget')}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Headcount Affordability (with what-if) ---------- */
function HeadcountAffordability({ staff, rates, budget, setBudget, canEdit }) {
  const activeS = uMc(() => HRD.activeStaff(staff), [staff]);   // headcount = active only
  const aff = uMc(() => HRD.affordability(activeS, rates, budget), [activeS, rates, budget]);
  const [base, setBase] = uSc(3000000);
  const [allow, setAllow] = uSc(400000);
  const [risk, setRisk] = uSc('Low');
  const [jp, setJp] = uSc(true);
  const [editBudget, setEditBudget] = uSc(false);
  const sim = uMc(() => HRD.simulateHire(activeS, rates, budget, { base, allowance: allow, risk, jp }), [activeS, rates, budget, base, allow, risk, jp]);
  const over = aff.remaining < 0;

  return (
    <div className="card co-afford">
      <div className="co-afford-head">
        <div>
          <div className="sec-title" style={{ fontSize: 17, fontWeight: 700 }}>{trC('co.affordTitle')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trC('co.affordSub')}</div>
        </div>
        <div className="co-budget">
          <span style={{ fontSize: 11.5, color: 'var(--text-mut)' }}>{trC('co.monthlyBudget')}</span>
          {editBudget && canEdit ? (
            <div className="amt-input" style={{ padding: '4px 10px', width: 170 }}>
              <span className="amt-rp" style={{ fontSize: 13 }}>Rp</span>
              <input autoFocus inputMode="numeric" style={{ fontSize: 15 }} value={budget ? budget.toLocaleString('id-ID') : ''}
                onChange={(e) => setBudget(+e.target.value.replace(/\D/g, '') || 0)} onBlur={() => setEditBudget(false)} />
            </div>
          ) : (
            <button className="co-budget-val" onClick={() => canEdit && setEditBudget(true)}>{rpC(budget)}{canEdit && <IconPencil s={13} />}</button>
          )}
        </div>
      </div>

      <div className="co-afford-body">
        <BudgetRing aff={aff} />
        <div className="co-afford-stats">
          <div className="co-stat"><span>{trC('co.overhead')}</span><b className="tnum">{rpC(aff.overhead)}</b><em>{aff.count} {trC('hrdr.staff')}</em></div>
          <div className="co-stat"><span>{trC('co.remaining')}</span><b className={`tnum ${over ? 'amt-neg' : 'amt-pos'}`}>{over ? '−' + rpC(-aff.remaining) : rpC(aff.remaining)}</b><em>{over ? trC('co.overBudget') : trC('co.underBudget')}</em></div>
          <div className="co-stat"><span>{trC('co.avgCost')}</span><b className="tnum">{rpC(aff.avgCost)}</b><em>{trC('co.perEmployee')}</em></div>
          <div className="co-stat hire"><span>{trC('co.canHire')}</span><b className="tnum" style={{ color: aff.canHire > 0 ? 'var(--green-700)' : 'var(--neg)' }}>{aff.canHire}</b><em>{trC('co.moreStaff')}</em></div>
        </div>
      </div>

      <div className="co-whatif">
        <div className="co-whatif-head"><IconSparkle s={16} />{trC('co.whatif')}</div>
        <div className="co-whatif-grid">
          <label className="wif-field"><span>{trC('hrd.basesal')}</span>
            <div className="amt-input" style={{ padding: '7px 11px' }}><span className="amt-rp" style={{ fontSize: 13 }}>Rp</span>
              <input inputMode="numeric" style={{ fontSize: 14 }} value={base ? base.toLocaleString('id-ID') : ''} onChange={(e) => setBase(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          </label>
          <label className="wif-field"><span>{trC('hrd.allowance')}</span>
            <div className="amt-input" style={{ padding: '7px 11px' }}><span className="amt-rp" style={{ fontSize: 13 }}>Rp</span>
              <input inputMode="numeric" style={{ fontSize: 14 }} value={allow ? allow.toLocaleString('id-ID') : ''} onChange={(e) => setAllow(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          </label>
          <label className="wif-field"><span>{trC('hrd.riskClass')}</span>
            <UI.Dropdown value={risk} options={HRD.RISK_LEVELS} onChange={setRisk} />
          </label>
          <label className="wif-field jp"><span>JP</span>
            <button className={`wif-toggle ${jp ? 'on' : ''}`} onClick={() => setJp(!jp)}>{jp ? trC('co.yes') : trC('co.no')}</button>
          </label>
        </div>
        <div className={`co-whatif-result ${sim.affordable ? 'ok' : 'no'}`}>
          <span className="wif-ic">{sim.affordable ? <IconCheck s={18} /> : <IconClose s={18} />}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="wif-r-title">{sim.affordable ? trC('co.affordableYes') : trC('co.affordableNo')}</div>
            <div className="wif-r-sub">{trC('co.addCost', { c: rpC(sim.addCost) })} · {trC('co.newRemain', { r: sim.newRemaining < 0 ? '−' + rpC(-sim.newRemaining) : rpC(sim.newRemaining) })} · {Math.round(sim.newUtil * 100)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Approvals ---------- */
function NewRequestModal({ staff, role, onSubmit, onClose }) {
  const types = Object.keys(CO.TYPE_META);
  const [type, setType] = uSc('deduction');
  const [routeTo, setRouteTo] = uSc(CO.TYPE_META.deduction.routeTo);
  const [customType, setCustomType] = uSc('');
  const [staffId, setStaffId] = uSc(staff[0] ? staff[0].id : '');
  const [title, setTitle] = uSc('');
  const [detail, setDetail] = uSc('');
  const [amount, setAmount] = uSc(0);
  const [from, setFrom] = uSc(FIN.TODAY);
  const [to, setTo] = uSc(FIN.TODAY);
  const meta = CO.TYPE_META[type];
  const emp = staff.find((s) => s.id === staffId);
  const pickType = (t) => { setType(t); setRouteTo(CO.TYPE_META[t].routeTo); };
  const valid = title.trim() && (type !== 'custom' || customType.trim()) && (!meta.needsAmount || amount > 0) && (!meta.needsEmp || emp);
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const submit = () => {
    onSubmit({
      id: CO.newReqId(), type, customType: type === 'custom' ? customType.trim() : null,
      who: emp ? emp.name : '—', staffId: emp ? emp.id : null, dept: emp ? emp.dept : '—',
      title: title.trim(), detail: detail.trim(), amount: meta.needsAmount ? amount : 0,
      from: meta.needsDates ? from : null, to: meta.needsDates ? to : null,
      date: FIN.TODAY, status: 'pending', requestedBy: role, routeTo,
    });
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trC('req.new')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trC('req.type')}</label>
          <UI.Dropdown value={type} options={types.map((t) => ({ value: t, label: trC('co.t.' + t) }))} onChange={pickType} />
          {type === 'custom' && (<>
            <label className="fld-label">{trC('req.customType')}</label>
            <input className="fld" value={customType} placeholder={trC('req.customTypePh')} onChange={(e) => setCustomType(e.target.value)} />
          </>)}
          <label className="fld-label">{trC('req.routedTo')}</label>
          <UI.Dropdown value={routeTo} options={CO.ROUTE_ROLES.map((r) => ({ value: r, label: trC('role.' + r) }))} onChange={setRouteTo} />
          {meta.needsEmp && (<>
            <label className="fld-label">{trC('req.employee')}</label>
            <UI.Dropdown value={staffId} options={staff.map((s) => ({ value: s.id, label: s.name + ' · ' + s.dept }))} onChange={setStaffId} />
          </>)}
          <label className="fld-label">{trC('req.title')}</label>
          <input className="fld" value={title} placeholder={trC('co.t.' + type)} onChange={(e) => setTitle(e.target.value)} />
          {meta.needsAmount && (<>
            <label className="fld-label">{trC('add.amount')}</label>
            <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span><input inputMode="numeric" style={{ fontSize: 16 }} value={amount ? amount.toLocaleString('id-ID') : ''} onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          </>)}
          {meta.needsDates && (
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trC('req.from')}</label><DP.DateField value={from} onChange={setFrom} /></div>
              <div style={{ flex: 1 }}><label className="fld-label" style={{ marginTop: 0 }}>{trC('req.to')}</label><DP.DateField value={to} onChange={setTo} /></div>
            </div>
          )}
          <label className="fld-label">{trC('req.note')}</label>
          <input className="fld" value={detail} placeholder={trC('req.notePh')} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>{trC('req.submit')}</button>
        </div>
      </div>
    </div>
  );
}

function ApprovalsCard({ approvals, setApprovals, role, canSubmit, staff, compact, onApproveLeave, onApproveDeduction, onSubmitRequest, onCancelRequest, onDeleteRequest, userName }) {
  const [showNew, setShowNew] = uSc(false);
  const canActOn = (a) => role === 'gm' || a.routeTo === role;   // may approve/reject
  const isMine = (a) => a.requestedBy === role;                  // the requester
  // Who can delete: an approved request only by an approver (undoes its effects);
  // anything else (pending / cancelled / rejected) by the requester or an approver.
  const canDelete = (a) => (a.status === 'approved' ? canActOn(a) : (isMine(a) || canActOn(a)));
  const inbox = approvals.filter((a) => canActOn(a) || isMine(a));
  const pending = inbox.filter((a) => a.status === 'pending' && canActOn(a));
  const act = (id, status) => {
    const item = approvals.find((a) => a.id === id);
    if (status === 'approved' && item) {
      if (item.type === 'leave' && onApproveLeave) onApproveLeave(item);
      if (item.type === 'deduction' && onApproveDeduction) onApproveDeduction(item);
    }
    setApprovals((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
  };
  const doCancel = (a) => { if (confirm(trC('req.cancelConfirm'))) (onCancelRequest ? onCancelRequest(a) : setApprovals((prev) => prev.map((x) => x.id === a.id ? { ...x, status: 'cancelled' } : x))); };
  const doDelete = (a) => { if (confirm(trC(a.status === 'approved' ? 'req.deleteApprovedConfirm' : 'req.deleteConfirm'))) (onDeleteRequest ? onDeleteRequest(a) : setApprovals((prev) => prev.filter((x) => x.id !== a.id))); };
  const submit = (req) => { onSubmitRequest ? onSubmitRequest(req) : setApprovals((prev) => [req, ...prev]); setShowNew(false); };
  const list = compact ? inbox.filter((a) => a.status === 'pending').slice(0, 4) : inbox;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 10 }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700 }}>{trC('co.approvals')}{pending.length > 0 && <span className="co-pend-badge" style={{ marginLeft: 8 }}>{pending.length} {trC('co.pending')}</span>}</div>
        {canSubmit && !compact && <button className="btn btn-primary" style={{ height: 38 }} onClick={() => setShowNew(true)}><IconPlus s={16} />{trC('req.new')}</button>}
      </div>
      {list.length === 0 && <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-mut)', fontSize: 13 }}><IconCheck s={18} /> {trC('co.allClear')}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {list.map((a) => {
          const meta = CO.TYPE_META[a.type] || CO.TYPE_META.custom;
          const mine = a.requestedBy === role && !canActOn(a);
          const typeLabel = a.type === 'custom' && a.customType ? a.customType : trC('co.t.' + a.type);
          return (
            <div key={a.id} className={`appr-row ${a.status}`}>
              <span className="appr-ic">{IcC(meta.icon, { s: 17 })}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="appr-title">{a.title}{a.amount > 0 && <b className="tnum"> · {rpC(a.amount)}</b>}</div>
                <div className="appr-sub">{a.who !== '—' ? a.who + ' · ' : ''}{typeLabel}{a.detail ? ' · ' + a.detail : ''}</div>
                <div className="appr-route">{trC('role.' + (a.requestedBy || 'hrd'))} <IconArrowUp s={11} style={{ transform: 'rotate(90deg)' }} /> {trC('role.' + (a.routeTo || 'gm'))}</div>
              </div>
              <div className="appr-actions">
                {a.status === 'pending' && canActOn(a) && (<>
                  <button className="appr-btn ok" title={trC('co.approve')} onClick={() => act(a.id, 'approved')}><IconCheck s={15} /></button>
                  <button className="appr-btn no" title={trC('co.reject')} onClick={() => act(a.id, 'rejected')}><IconClose s={15} /></button>
                </>)}
                {a.status === 'pending' && !canActOn(a) && <span className="pill pill-warn">{mine ? trC('req.waiting') : trC('co.pending')}</span>}
                {a.status === 'approved' && <span className="pill pill-pos">{trC('co.approved')}</span>}
                {a.status === 'rejected' && <span className="pill pill-neg">{trC('co.rejected')}</span>}
                {a.status === 'cancelled' && <span className="pill pill-mut">{trC('co.cancelled')}</span>}
                {a.status === 'pending' && isMine(a) && <button className="appr-txtbtn" onClick={() => doCancel(a)}>{trC('req.cancel')}</button>}
                {canDelete(a) && <button className="appr-txtbtn del" title={trC('req.delete')} onClick={() => doDelete(a)}>{trC('req.delete')}</button>}
              </div>
            </div>
          );
        })}
      </div>
      {showNew && <NewRequestModal staff={staff} role={role} onSubmit={submit} onClose={() => setShowNew(false)} />}
    </div>
  );
}

/* ---------- Owner / Company Dashboard ---------- */
function ProjectsCard({ projects }) {
  const list = (projects || []).filter((p) => p.status !== 'done');
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{trC('co.projects')}<span className="co-pend-badge" style={{ marginLeft: 8 }}>{list.length}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
        {list.map((p) => {
          const st = CO.PROJ_STATUS[p.status] || CO.PROJ_STATUS.planning;
          return (
            <div key={p.id} className="proj-row">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="proj-name">{p.name}</span>
                <span className="proj-status" style={{ color: st.color, background: st.color + '1a' }}>{st.label}</span>
              </div>
              <div className="proj-sub">{p.note}</div>
              <div className="proj-barwrap"><div className="proj-bar" style={{ width: p.progress + '%', background: st.color }} /></div>
              <div className="proj-foot"><span className="tnum">{p.progress}%</span><span className="tnum">{rpC(p.budget)}</span></div>
            </div>
          );
        })}
        {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-mut)', padding: '12px 0' }}>{trC('co.noProjects')}</div>}
      </div>
    </div>
  );
}

function CompanyDashboard({ fin, staff, rates, budget, approvals, setApprovals, role, projects, setoran, onApproveLeave, onApproveDeduction, onSubmitRequest, onCancelRequest, onDeleteRequest, userName }) {
  const pendCount = approvals.filter((a) => a.status === 'pending').length;
  const monthKey = FIN.TODAY.slice(0, 7);
  const sales = uMc(() => {
    let galon = 0, dep = 0; const cars = new Set();
    (setoran || []).forEach((r) => { if ((r.date || '').startsWith(monthKey)) { galon += +r.galon || 0; dep += FS.setoranOf(r); cars.add(r.armada); } });
    return { galon, dep, cars: cars.size };
  }, [setoran, monthKey]);
  const projCount = (projects || []).filter((p) => p.status !== 'done').length;
  const cards = [
    { label: trC('co.cashBalance'), value: rpC(fin.balance), icon: 'IconWallet', bg: 'var(--green-800)', dark: true, sub: trC('co.company') },
    { label: trC('co.revenueM'), value: rpC(fin.income), icon: 'IconCoinIn', bg: 'var(--mint-100)', fg: 'var(--green-800)', cls: 'amt-pos', sub: fin.monLabel },
    { label: trC('co.profitM'), value: (fin.profit < 0 ? '−' : '') + rpC(Math.abs(fin.profit)), icon: 'IconTrendUp', bg: 'var(--sand)', fg: 'var(--green-900)', cls: fin.profit >= 0 ? 'amt-pos' : 'amt-neg', sub: trC('rep.marginSub', { m: fin.margin }) },
    { label: trC('co.salesMonth'), value: sales.galon.toLocaleString('id-ID') + ' galon', icon: 'IconTruck', bg: 'var(--sand-soft)', fg: 'var(--warn)', sub: rpC(sales.dep) },
  ];
  return (
    <div className="screen-enter">
      <div className="co-hero">
        <div>
          <div className="co-hello">{trC('co.welcome', { n: userName.split(' ')[0] })}</div>
          <div className="co-hello-sub">{trC('co.heroSub')}</div>
        </div>
        <div className="co-hero-tags">
          <span className="co-tag"><IconUsersGroup s={15} />{staff.length} {trC('hrdr.staff')}</span>
          <span className="co-tag good"><IconBolt s={14} />{trC('co.projTag', { n: projCount })}</span>
          {pendCount > 0 && <span className="co-tag warn"><IconBell s={14} />{pendCount} {trC('co.pending')}</span>}
        </div>
      </div>

      <div className="fin-stat-row">
        {cards.map((c, i) => (
          <div key={i} className={`card stat-box ${c.dark ? 'dark' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="icon-tile" style={{ background: c.dark ? 'rgba(255,255,255,.14)' : c.bg, color: c.dark ? '#fff' : c.fg }}>{IcC(c.icon, { s: 19 })}</span>
            </div>
            <div className={`tnum ${c.cls || ''}`} style={{ fontSize: 22, fontWeight: 800, marginTop: 12, whiteSpace: 'nowrap', color: c.dark ? '#fff' : undefined }}>{c.value}</div>
            <div style={{ fontSize: 12.5, color: c.dark ? 'rgba(255,255,255,.7)' : 'var(--text-mut)', marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 11, color: c.dark ? 'rgba(255,255,255,.5)' : 'var(--text-faint)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="co-grid">
        <ProjectsCard projects={projects} />
        <ApprovalsCard approvals={approvals} setApprovals={setApprovals} role={role} canSubmit={false} staff={staff} onApproveLeave={onApproveLeave} onApproveDeduction={onApproveDeduction} onSubmitRequest={onSubmitRequest} onCancelRequest={onCancelRequest} onDeleteRequest={onDeleteRequest} userName={userName} compact />
      </div>
    </div>
  );
}

/* ---------- Kasbon request modal (server-validated: cycle 16→15 rules) ---------- */
function CashbonModal({ staff, onSave, onClose }) {
  const today = (window.FIN && FIN.TODAY) || new Date().toLocaleDateString('en-CA');
  const [amount, setAmount] = uSc(0);
  const [date, setDate] = uSc(today);
  const [note, setNote] = uSc('');
  const [pv, setPv] = uSc(null);      // server preview: { base, summary, check }
  const [err, setErr] = uSc('');
  const [busy, setBusy] = uSc(false);
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  // Live limits from the server (authoritative), debounced on amount/date.
  uEc(() => {
    let alive = true;
    const h = setTimeout(async () => {
      if (!(window.API && window.API.cashbon)) { setErr(trC('co.kasbonOffline')); return; }
      try { const r = await window.API.cashbon.preview({ employeeId: staff.id, date, amount: +amount || 0 }); if (alive) { setPv(r.data); setErr(''); } }
      catch (e) { if (alive) setErr(e && e.offline ? trC('co.kasbonOffline') : (e.message || '')); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [amount, date, staff.id]);
  const sum = pv && pv.summary;
  const check = pv && pv.check;
  const canSubmit = amount > 0 && check && check.ok && !busy;
  const submit = async () => {
    if (busy) return; setBusy(true); setErr('');
    try {
      const r = await window.API.cashbon.request({ employeeId: staff.id, amount: +amount, date, note: note.trim() });
      onSave(r.data.cashbon);
    } catch (e) { setErr(e && e.offline ? trC('co.kasbonOffline') : ((e.body && e.body.error && e.body.error.message) || e.message || trC('co.kasbonOffline'))); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 470 }}>
        <div className="modal-head">
          <div style={{ fontSize: 17, fontWeight: 700 }}>{trC('co.kasbonAdd')} · {staff.name}</div>
          <button className="icon-btn" onClick={onClose}><IconClose s={18} /></button>
        </div>
        {sum && (
          <div className="kb-limits">
            <div className="kb-lim"><span>{trC('co.kasbonCeiling')}</span><b className="tnum">{rpC(sum.ceiling)}</b></div>
            <div className="kb-lim"><span>{trC('co.kasbonRemainingCycle')}</span><b className="tnum">{rpC(sum.remaining)}</b></div>
            <div className="kb-lim"><span>{trC('co.kasbonWeeklyMax')}</span><b className="tnum">{rpC(sum.weeklyMax)}</b></div>
            <div className="kb-lim full">{sum.thisWeekTaken
              ? <span className="kb-week-x">{trC('co.kasbonWeekTaken', { d: sum.nextWeekDate })}</span>
              : <span className="kb-week-ok">{trC('co.kasbonWeekOpen', { v: rpC(sum.weekLeft) })}</span>}
              <em>· {trC('co.kasbonCycle', { a: sum.cycle.end })}</em>
            </div>
          </div>
        )}
        <div className="ed-acc-form" style={{ padding: '4px 2px' }}>
          <label className="ed-af ed-af-wide"><span>{trC('co.kasbonAmount')}</span>
            <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span>
              <input inputMode="numeric" style={{ fontSize: 16 }} value={amount ? (+amount).toLocaleString('id-ID') : ''} onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || 0)} /></div>
          </label>
          <label className="ed-af"><span>{trC('co.kasbonDate')}</span><DP.DateField value={date} max={today} onChange={setDate} /></label>
          <label className="ed-af"><span>{trC('co.kasbonNote')}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" /></label>
        </div>
        <div className={`kb-hint ${(err || (check && !check.ok && amount > 0)) ? 'over' : ''}`}>
          {err ? `⚠ ${err}`
            : (amount > 0 && check && !check.ok) ? `⚠ ${check.message}`
            : (amount > 0 && check && check.ok) ? `✓ ${trC('co.kasbonCutAt', { d: sum ? sum.cycle.end : '' })} · ${trC('co.kasbonRemainingCycle')}: ${rpC(check.remainingAfter)}`
            : trC('co.kasbonRule')}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{busy ? '…' : trC('co.kasbonAdd')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Kasbon screen (request + approval workflow) ---------- */
const KB_STATUS = { pending: { l: 'kb.stPending', c: 'var(--warn)', bg: 'var(--sand-soft)' }, approved: { l: 'kb.stApproved', c: 'var(--green-700)', bg: 'var(--mint-100)' }, rejected: { l: 'kb.stRejected', c: 'var(--neg)', bg: '#FDEBEC' }, active: { l: 'kb.stApproved', c: 'var(--green-700)', bg: 'var(--mint-100)' }, cancelled: { l: 'kb.stRejected', c: 'var(--text-mut)', bg: 'var(--card-soft)' } };
const kbStat = (s) => KB_STATUS[s || 'pending'] || KB_STATUS.pending;

function KasbonPicker({ staff, onPick, onClose }) {
  const [id, setId] = uSc('');
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const opts = (staff || []).map((s) => ({ value: s.id, label: `${s.name} · ${s.dept || ''}` }));
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trC('kb.pickEmp')}</div><button className="icon-btn" onClick={onClose}><IconClose s={18} /></button></div>
        <div style={{ padding: '4px 2px 10px' }}>
          <label className="fld-label" style={{ marginTop: 0 }}>{trC('req.employee')}</label>
          <UI.Dropdown value={id} options={[{ value: '', label: '— ' + trC('kb.pickEmp') + ' —' }, ...opts]} onChange={setId} />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!id} onClick={() => onPick((staff || []).find((s) => s.id === id))}>{trC('kb.continue')}</button>
        </div>
      </div>
    </div>
  );
}

function KasbonScreen({ staff, cashbons, onAddCashbon, onDecideCashbon, canApprove, today, userName }) {
  const [pick, setPick] = uSc(false);        // employee-picker open
  const [reqStaff, setReqStaff] = uSc(null); // staff chosen → CashbonModal
  const [fEmp, setFEmp] = uSc('all');
  const [fStatus, setFStatus] = uSc('all');
  const active = HRD.activeStaff(staff || []);
  const nameOf = (idv) => ((staff || []).find((s) => s.id === idv) || {}).name || '—';
  const rows = uMc(() => (cashbons || [])
    .filter((c) => (fEmp === 'all' || c.employeeId === fEmp) && (fStatus === 'all' || (c.status || 'pending') === fStatus))
    .slice().sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt || 0) - (a.createdAt || 0))), [cashbons, fEmp, fStatus]);
  // The kasbon is already persisted by API.cashbon.request → just merge + reload.
  const save = (cb) => { if (onAddCashbon) onAddCashbon(cb); setReqStaff(null); setPick(false); };
  const decide = (id, status) => {
    if (!canApprove) return;
    let reason = '';
    if (status === 'rejected') { const r = prompt(trC('kb.rejectReason')); if (r == null) return; reason = r; }
    if (onDecideCashbon) onDecideCashbon(id, status, reason);
  };
  const pending = rows.filter((c) => (c.status || 'pending') === 'pending').length;
  return (
    <div className="screen-enter">
      <div className="settings-intro card">
        <div><div style={{ fontSize: 16, fontWeight: 700 }}>{trC('nav.kasbon')}</div><div style={{ fontSize: 13, color: 'var(--text-mut)', marginTop: 3 }}>{trC('kb.intro')}</div></div>
        <button className="btn btn-primary" onClick={() => setPick(true)}><IconPlus s={16} />{trC('kb.request')}</button>
      </div>
      <div className="kb-toolbar">
        <UI.Dropdown compact value={fEmp} options={[{ value: 'all', label: trC('kb.allEmp') }, ...active.map((s) => ({ value: s.id, label: s.name }))]} onChange={setFEmp} />
        <UI.Dropdown compact value={fStatus} options={[{ value: 'all', label: trC('kb.allStatus') }, { value: 'pending', label: trC('kb.stPending') }, { value: 'approved', label: trC('kb.stApproved') }, { value: 'rejected', label: trC('kb.stRejected') }]} onChange={setFStatus} />
        {pending > 0 && <span className="kb-pending-chip">{trC('kb.pendingN', { n: pending })}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)', marginTop: 14 }}>{trC('kb.none')}</div>
      ) : (
        <div className="kb-cards">
          {rows.map((c) => { const st = kbStat(c.status); const dec = (c.status || 'pending') !== 'pending'; return (
            <div className="card kb-card" key={c.id}>
              <div className="kb-card-top">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="kb-card-name">{nameOf(c.employeeId)}</div>
                  <div className="kb-card-sub">{c.date} · {trC('co.kasbonCycle', { a: c.cycleAnchor || '—' })}</div>
                </div>
                <div className="kb-card-amt tnum">{rpC(c.amount)}</div>
                <span className="kb-badge" style={{ background: st.bg, color: st.c }}>{trC(st.l)}</span>
              </div>
              {c.note && <div className="kb-card-note">{c.note}</div>}
              <div className="kb-card-trail">
                {c.requestedBy && <span>{trC('kb.requestedBy', { n: c.requestedBy })}</span>}
                {dec && c.approvedBy && <span>{(c.status === 'rejected' ? trC('kb.rejectedBy', { n: c.approvedBy }) : trC('kb.approvedBy', { n: c.approvedBy }))}{c.rejectReason ? ` · ${c.rejectReason}` : ''}</span>}
              </div>
              {canApprove && (c.status || 'pending') === 'pending' && (
                <div className="kb-card-actions">
                  <button className="btn btn-lime btn-sm" onClick={() => decide(c.id, 'approved')}><IconCheck s={15} />{trC('kb.approve')}</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--neg)' }} onClick={() => decide(c.id, 'rejected')}><IconClose s={15} />{trC('kb.reject')}</button>
                </div>
              )}
            </div>
          ); })}
        </div>
      )}
      {pick && <KasbonPicker staff={active} onPick={(s) => { setReqStaff(s); setPick(false); }} onClose={() => setPick(false)} />}
      {reqStaff && <CashbonModal staff={reqStaff} onSave={save} onClose={() => setReqStaff(null)} />}
    </div>
  );
}

/* ---------- Offboarding modal (mark leaving, with impact preview) ---------- */
function OffboardModal({ staff, rates, cashbons, onSave, onClose }) {
  const today = (window.FIN && FIN.TODAY) || new Date().toLocaleDateString('en-CA');
  const [sepStatus, setSepStatus] = uSc('resigned');
  const [date, setDate] = uSc(today);
  const [reason, setReason] = uSc('');
  const [note, setNote] = uSc('');
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const minDate = staff.joinedDate || staff.contractStart || '';
  const dateErr = !!(minDate && date && date < minDate);
  const preview = uMc(() => HRD.finalSettlement({ ...staff, sepStatus, separationDate: date }, rates, cashbons), [sepStatus, date, staff, rates, cashbons]);
  const valid = date && !dateErr;
  const opts = HRD.SEP_STATUSES.map((v) => ({ value: v, label: trC('co.sep_' + v) }));
  const submit = () => {
    if (!valid) return;
    const neg = preview.finalPay < 0;
    const msg = trC('co.sepConfirm', { name: staff.name, type: trC('co.sep_' + sepStatus), d: date, pay: rpC(preview.finalPay) }) + (neg ? '\n\n⚠ ' + trC('co.sepFinalNeg') : '');
    if (!confirm(msg)) return;
    onSave({ ...staff, sepStatus, separationDate: date, separationReason: reason.trim(), separationNote: note.trim(), active: false });
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trC('co.offboardT', { name: staff.name })}</div><button className="icon-btn" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="ed-acc-form" style={{ padding: '4px 2px' }}>
          <label className="ed-af"><span>{trC('co.sepStatus')}</span><UI.Dropdown value={sepStatus} options={opts} onChange={setSepStatus} /></label>
          <label className="ed-af"><span>{trC('co.sepDate')}</span><DP.DateField value={date} max={today} onChange={setDate} /></label>
          <label className="ed-af ed-af-wide"><span>{trC('co.sepReason')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="—" /></label>
          <label className="ed-af ed-af-wide"><span>{trC('co.sepNote')}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" /></label>
        </div>
        {dateErr && <div className="kb-hint over">⚠ {trC('co.sepDateErr')}</div>}
        <div className="sep-impact">
          <div className="sep-impact-t">{trC('co.sepImpact')} · {trC('co.sepTenure')} {trC('co.sepYears', { n: preview.tenureYears })}</div>
          <div className="sep-row"><span>{trC('co.sepProrated')} ({preview.daysWorked}/{preview.workDays})</span><b className="tnum">{rpC(preview.proratedNet)}</b></div>
          <div className="sep-row"><span>{trC('co.sepSeverance')} ({preview.severanceMonths}× {rpC(preview.monthly)})</span><b className="tnum amt-pos">+{rpC(preview.severance)}</b></div>
          {preview.kasbonOutstanding > 0 && <div className="sep-row"><span>{trC('co.kasbonOutstanding')}</span><b className="tnum amt-neg">−{rpC(preview.kasbonOutstanding)}</b></div>}
          <div className="sep-row total"><span>{trC('co.sepFinal')}</span><b className={`tnum ${preview.finalPay < 0 ? 'amt-neg' : 'amt-pos'}`}>{preview.finalPay < 0 ? '− ' : ''}{rpC(preview.finalPay)}</b></div>
          {preview.finalPay < 0 && <div className="sep-neg">⚠ {trC('co.sepFinalNeg')}</div>}
        </div>
        <div className="kb-hint">{trC('co.sepDisclaimer')}</div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel')}</button>
          <button className="btn btn-primary" style={{ background: 'var(--neg)' }} disabled={!valid} onClick={submit}>{trC('co.offboard')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Final-settlement slip (printable) ---------- */
function SettlementSlip({ staff, rates, cashbons, onClose }) {
  const s = HRD.finalSettlement(staff, rates, cashbons);
  uEc(() => { document.body.classList.add('payslip-open'); const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => { document.body.classList.remove('payslip-open'); window.removeEventListener('keydown', o); }; }, []);
  const Row = ({ label, value, neg, pos, strong }) => (<div className={`ps-row ${strong ? 'strong' : ''}`}><span>{label}</span><span className={`tnum ${neg ? 'amt-neg' : pos ? 'amt-pos' : ''}`}>{neg ? '− ' : pos ? '+ ' : ''}{rpC(value)}</span></div>);
  return (
    <div className="modal-scrim payslip-overlay" onClick={onClose}>
      <div className="payslip-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Logo s={34} /><div><div style={{ fontFamily: 'Poppins', fontSize: 17, fontWeight: 800 }}>AirRO Reverse Osmosis</div><div style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trC('co.settlementSlip')} · {staff.separationDate}</div></div></div>
          <div className="ps-actions"><button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trC('hrd.print')}</button><button className="jp-icon no-print" onClick={onClose}><IconClose s={18} /></button></div>
        </div>
        <div className="ps-emp">
          <div><div className="ps-emp-name">{staff.name}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{staff.pos || '—'} · {staff.dept}</div></div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-mut)' }}>{trC('co.sep_' + staff.sepStatus)}<br />{trC('co.sepTenure')}: <b>{trC('co.sepYears', { n: s.tenureYears })}</b></div>
        </div>
        <div className="ps-cols" style={{ gridTemplateColumns: '1fr' }}>
          <div className="ps-col">
            <div className="ps-col-title">{trC('co.settlement')}</div>
            <Row label={`${trC('co.sepProrated')} (${s.daysWorked}/${s.workDays} ${trC('co.sepDaysUnit')})`} value={s.proratedNet} />
            <Row label={`${trC('co.sepSeverance')} · ${s.severanceMonths}× ${rpC(s.monthly)}`} value={s.severance} pos />
            {s.kasbonOutstanding > 0 && <Row label={trC('co.kasbonOutstanding')} value={s.kasbonOutstanding} neg />}
          </div>
        </div>
        <div className="ps-thp" style={s.finalPay < 0 ? { background: 'var(--neg)' } : null}><span>{trC('co.sepFinal')}</span><span className="tnum">{s.finalPay < 0 ? '− ' : ''}{rpC(s.finalPay)}</span></div>
        {s.finalPay < 0 && <div className="sep-neg" style={{ margin: '8px 0 0' }}>⚠ {trC('co.sepFinalNeg')}</div>}
        <div className="ps-foot">{trC('co.sepDisclaimer')}</div>
      </div>
    </div>
  );
}

/* ---------- Orientation wage slip (lump sum, per-day breakdown, printable) ---------- */
function OrientationSlip({ staff, rates, onClose }) {
  const o = staff.orientation || {};
  const days = CO.oriAtt(staff.id);
  const wage = HRD.orientationWage(days, rates || {}, o.dailyWage);
  const rawFor = (date) => days.find((d) => d.date === date) || {};
  const end = HRD.orientationEnd(staff);
  uEc(() => { document.body.classList.add('payslip-open'); const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => { document.body.classList.remove('payslip-open'); window.removeEventListener('keydown', h); }; }, []);
  return (
    <div className="modal-scrim payslip-overlay" onClick={onClose}>
      <div className="payslip-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Logo s={34} /><div><div style={{ fontFamily: 'Poppins', fontSize: 17, fontWeight: 800 }}>AirRO Reverse Osmosis</div><div style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trC('ori.slipTitle')}{o.paidAt ? ' · ' + o.paidAt : ''}</div></div></div>
          <div className="ps-actions"><button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trC('hrd.print')}</button><button className="jp-icon no-print" onClick={onClose}><IconClose s={18} /></button></div>
        </div>
        <div className="ps-emp">
          <div><div className="ps-emp-name">{staff.name}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{staff.pos || '—'} · {staff.dept}</div></div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-mut)' }}>{trC('ori.outcome')}: <b>{trC('ori.out_' + (o.outcome || 'pending'))}</b></div>
        </div>
        <div className="ps-col-title" style={{ marginTop: 8 }}>{trC('ori.period')}: {o.startDate || '—'} → {end || '—'} · {trC('ori.dailyWage')} {rpC(o.dailyWage || 0)}</div>
        {days.length === 0 ? (
          <div className="ori-empty" style={{ padding: '18px 0' }}>{trC('ori.noDays')}</div>
        ) : (
          <table className="ori-slip-tbl">
            <thead><tr><th>{trC('ori.colDate')}</th><th>{trC('ori.colIn')}</th><th>{trC('ori.colStatus')}</th><th className="tr">{trC('ori.colBase')}</th><th className="tr">{trC('ori.colLate')}</th><th className="tr">{trC('ori.colOt')}</th><th className="tr">{trC('ori.colPay')}</th></tr></thead>
            <tbody>
              {wage.rows.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}{r.isSunday ? <span className="ori-sun">{trC('ori.sun')}</span> : null}</td>
                  <td>{r.status === 'absent' ? '—' : ((rawFor(r.date).checkIn || '—') + (rawFor(r.date).checkOut ? '–' + rawFor(r.date).checkOut : ''))}</td>
                  <td><span className={`ori-st ${r.status}`}>{trC('ori.st_' + r.status)}{r.status === 'late' && r.lateMinutes ? ` ${r.lateMinutes}m` : ''}</span></td>
                  <td className="tr tnum">{rpC(r.base)}</td>
                  <td className="tr tnum">{r.lateDeduct ? '−' + rpC(r.lateDeduct) : '—'}</td>
                  <td className="tr tnum">{r.otPay ? '+' + rpC(r.otPay) + (r.sundayApplied ? ' ' + trC('ori.sun') : '') : '—'}</td>
                  <td className="tr tnum">{rpC(r.pay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>{trC('ori.subtotal')} · {wage.days} {trC('ori.days')}</td><td className="tr tnum">{rpC(wage.sumBase)}</td><td className="tr tnum">−{rpC(wage.sumLate)}</td><td className="tr tnum">+{rpC(wage.sumOt)}</td><td className="tr tnum">{rpC(wage.total)}</td></tr></tfoot>
          </table>
        )}
        <div className="ps-thp"><span>{trC('ori.total')}</span><span className="tnum">{rpC(wage.total)}</span></div>
        <div className="ps-foot">{trC('ori.slipFoot')}</div>
      </div>
    </div>
  );
}

/* ---------- One orientation/DW card with daily attendance editor ---------- */
function OriCard({ s, rates, today, syncTick, canEdit, canAddEntry, onGraduate, onFail, onPay, onOpen, onSlip }) {
  const o = s.orientation || {};
  const [tick, setTick] = uSc(0);
  const bump = () => setTick((t) => t + 1);
  // Re-read on local edits (tick) AND on remote sync (syncTick) so another user's
  // attendance change shows up live without a refresh.
  const days = uMc(() => CO.oriAtt(s.id), [s.id, tick, syncTick]);
  const wage = uMc(() => HRD.orientationWage(days, rates || {}, o.dailyWage), [days, rates, o.dailyWage]);
  const decided = o.outcome !== 'pending';
  const [target, setTarget] = uSc(HRD.stageOf(s) === 'dw' ? 'permanent' : 'permanent');
  const [nd, setNd] = uSc({ date: today, checkIn: '08:00', checkOut: '', absent: false, ot: 0 });
  const rawFor = (date) => days.find((d) => d.date === date) || {};
  // Patch one day; unspecified fields keep their stored value (so editing check-out
  // doesn't wipe check-in, etc.). checkOut auto-computes OT via the engine.
  const writeDay = (date, patch) => {
    const prev = rawFor(date);
    const absent = patch.absent != null ? patch.absent : prev.status === 'absent';
    const checkIn = absent ? null : (patch.checkIn != null ? patch.checkIn : prev.checkIn);
    const checkOut = absent ? null : (patch.checkOut != null ? patch.checkOut : prev.checkOut);
    const overtimeHours = patch.overtimeHours != null ? patch.overtimeHours : (+prev.overtimeHours || 0);
    const cls = HRD.orientationClassify(checkIn, rates, absent);
    CO.setOriAttDay(s.id, date, { checkIn, checkOut, status: cls.status, lateMinutes: cls.lateMinutes, overtimeHours, note: prev.note || '' });
    bump();
  };
  const addDay = () => { if (!nd.date) return; writeDay(nd.date, { checkIn: nd.checkIn, checkOut: nd.checkOut || null, absent: nd.absent, overtimeHours: +nd.ot || 0 }); setNd({ date: today, checkIn: '08:00', checkOut: '', absent: false, ot: 0 }); };
  const pay = () => { const rec = canAddEntry && confirm(trC('ori.payConfirm', { amt: rpC(wage.total) })); onPay(s, !!rec); };
  return (
    <div className="card ori-card">
      <div className="ori-top" onClick={() => onOpen && onOpen(s)} style={{ cursor: onOpen ? 'pointer' : 'default' }}>
        <span className="emp-av" style={{ background: 'var(--mint-100)', color: 'var(--green-800)' }}>{s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="emp-name">{s.name}</div>
          <div className="emp-pos">{s.pos || '—'} · {s.dept}</div>
        </div>
        <span className={`ori-badge stage-${HRD.stageOf(s)}`}>{trC('stage.' + HRD.stageOf(s))}</span>
        <span className={`ori-badge ${o.outcome || 'pending'}`}>{trC('ori.out_' + (o.outcome || 'pending'))}</span>
      </div>
      <div className="ori-facts">
        <div><span>{trC('ori.start')}</span><b>{o.startDate || '—'}</b></div>
        <div><span>{trC('ori.dailyWage')}</span><b className="tnum">{rpC(o.dailyWage || 0)}</b></div>
        <div><span>{trC('ori.daysRecorded')}</span><b>{wage.days} {trC('ori.days')}</b></div>
        <div><span>{trC('ori.paidQ')}</span><b>{o.paid ? `✓ ${o.paidAt || ''}` : trC('ori.unpaid')}</b></div>
      </div>

      <div className="ori-att">
        <div className="ori-att-head"><IconClock s={14} /> {trC('ori.attendance')}</div>
        {wage.rows.length === 0 ? <div className="ori-empty">{trC('ori.noDays')}</div> : (
          <div className="ori-att-wrap">
          <table className="ori-att-tbl">
            <thead><tr><th>{trC('ori.colDate')}</th><th>{trC('ori.colIn')}</th><th>{trC('ori.colOut')}</th><th>{trC('ori.colStatus')}</th><th>{trC('ori.colOt')}</th><th className="tr">{trC('ori.colPay')}</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {wage.rows.map((r) => { const raw = rawFor(r.date); const absent = r.status === 'absent'; return (
                <tr key={r.date}>
                  <td>{r.date}{r.isSunday ? <span className="ori-sun">{trC('ori.sun')}</span> : null}</td>
                  <td>{absent ? <span className="ori-mut">—</span> : (canEdit ? <UI.TimePicker compact value={raw.checkIn || '08:00'} onChange={(v) => writeDay(r.date, { checkIn: v })} /> : (raw.checkIn || '—'))}</td>
                  <td>{absent ? <span className="ori-mut">—</span> : (canEdit ? <UI.TimePicker compact value={raw.checkOut || ''} placeholder="—" onChange={(v) => writeDay(r.date, { checkOut: v })} /> : (raw.checkOut || '—'))}</td>
                  <td>
                    <span className={`ori-st ${r.status}`}>{trC('ori.st_' + r.status)}{r.status === 'late' && r.lateMinutes ? ` ${r.lateMinutes}m` : ''}</span>
                    {canEdit && <label className="ori-abs"><input type="checkbox" checked={absent} onChange={(e) => writeDay(r.date, { absent: e.target.checked })} />{trC('ori.absent')}</label>}
                  </td>
                  <td>
                    {raw.checkOut
                      ? <span className="ori-ot-calc">{r.overtimeHours || 0}{trC('ori.hUnit')}{r.otPay > 0 ? <span className="ori-ot-rate">@{rpC(r.otRate)}{r.sundayApplied ? ` ${trC('ori.sun')}` : ''}</span> : null}</span>
                      : (canEdit ? <input className="ori-ot-in" inputMode="decimal" value={raw.overtimeHours || ''} placeholder={trC('ori.otManual')} title={trC('ori.otManualHint')} onChange={(e) => writeDay(r.date, { overtimeHours: +e.target.value.replace(/[^\d.]/g, '') || 0 })} /> : `${r.overtimeHours || 0}`)}
                  </td>
                  <td className="tr tnum">{rpC(r.pay)}</td>
                  {canEdit && <td><button className="icon-btn del" title={trC('ori.removeDay')} onClick={() => { CO.removeOriAttDay(s.id, r.date); bump(); }}><IconClose s={14} /></button></td>}
                </tr>
              ); })}
            </tbody>
          </table>
          </div>
        )}
        {canEdit && !decided && (
          <div className="ori-att-add">
            <DP.DateField value={nd.date} max={today} onChange={(v) => setNd({ ...nd, date: v })} />
            {!nd.absent && <label className="ori-add-fld"><span>{trC('ori.colIn')}</span><UI.TimePicker compact value={nd.checkIn} onChange={(v) => setNd({ ...nd, checkIn: v })} /></label>}
            {!nd.absent && <label className="ori-add-fld"><span>{trC('ori.colOut')}</span><UI.TimePicker compact value={nd.checkOut} placeholder="—" onChange={(v) => setNd({ ...nd, checkOut: v })} /></label>}
            <label className="ori-abs"><input type="checkbox" checked={nd.absent} onChange={(e) => setNd({ ...nd, absent: e.target.checked })} />{trC('ori.absent')}</label>
            {!nd.absent && !nd.checkOut && <input className="ori-ot-in" inputMode="decimal" placeholder={trC('ori.otH')} title={trC('ori.otManualHint')} value={nd.ot || ''} onChange={(e) => setNd({ ...nd, ot: +e.target.value.replace(/[^\d.]/g, '') || 0 })} />}
            <button className="btn btn-sm btn-primary" onClick={addDay}><IconPlus s={14} />{trC('ori.addDay')}</button>
          </div>
        )}
        <div className="ori-att-sum">
          <span>{trC('ori.subBase')} {rpC(wage.sumBase)} · {trC('ori.subLate')} −{rpC(wage.sumLate)} · {trC('ori.subOt')} +{rpC(wage.sumOt)}</span>
          <b className="tnum">{trC('ori.runningTotal')}: {rpC(wage.total)}</b>
        </div>
      </div>

      {canEdit && (
        <div className="ori-actions">
          {!decided && <UI.Dropdown compact value={target} options={[{ value: 'permanent', label: trC('stage.permanent') }, { value: 'contract', label: trC('stage.contract') }, { value: 'probation', label: trC('stage.probation') }]} onChange={setTarget} />}
          {!decided && <button className="btn btn-primary" onClick={() => { if (confirm(trC('ori.gradConfirm', { n: s.name, st: trC('stage.' + target) }))) onGraduate(s, target); }}><IconCheck s={15} />{trC('ori.graduate')}</button>}
          {!decided && <button className="btn btn-ghost" style={{ color: 'var(--neg)' }} onClick={() => { if (confirm(trC('ori.failConfirm', { n: s.name }))) onFail(s); }}><IconClose s={15} />{trC('ori.fail')}</button>}
          {!o.paid && wage.total > 0 && <button className="btn btn-lime" onClick={pay}><IconWallet s={15} />{trC('ori.pay')}</button>}
          <button className="btn btn-ghost" onClick={onSlip}><IconInvoice s={15} />{trC('ori.slip')}</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Orientation/DW screen (daily-paid new hires) ---------- */
function OrientationScreen({ staff, setStaff, rates, today, syncTick, canEdit, canAddEntry, onGraduate, onFail, onPay, orientationPaidIds, onOpen }) {
  const [slip, setSlip] = uSc(null);
  const bucket = (staff || []).filter((s) => HRD.isOrientationStage(s));
  const active = bucket.filter((s) => (s.orientation || {}).outcome !== 'failed' || !(s.orientation || {}).paid);
  return (
    <div className="screen-enter">
      <div className="settings-intro card"><div><div style={{ fontSize: 16, fontWeight: 700 }}>{trC('nav.orientation')}</div><div style={{ fontSize: 13, color: 'var(--text-mut)', marginTop: 3 }}>{trC('ori.intro')}</div></div></div>
      {active.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)', marginTop: 16 }}>{trC('ori.none')}</div>
      ) : (
        <div className="ori-list" style={{ marginTop: 16 }}>
          {active.map((s) => <OriCard key={s.id} s={s} rates={rates} today={today} syncTick={syncTick} canEdit={canEdit} canAddEntry={canAddEntry} onGraduate={onGraduate} onFail={onFail} onPay={onPay} onOpen={onOpen} onSlip={() => setSlip(s)} />)}
        </div>
      )}
      {slip && <OrientationSlip staff={slip} rates={rates} onClose={() => setSlip(null)} />}
    </div>
  );
}

/* ---------- Employee Detail ---------- */
function EmployeeDetail({ staff: staffProp, rates, monthKey, today, syncTick, seeMoney, canEdit, canEditAtt, onEdit, onClose, onSyncDeduct, onSaveStaff, cashbons, onAddCashbon, onUpdateCashbon, onGraduate, onFailOrientation, onPayOrientation, orientationPaid, canAddEntry }) {
  const [staff, setStaffLocal] = uSc(staffProp);   // local copy so identity edits reflect immediately
  const [att, setAtt] = uSc(() => CO.attendance(staffProp, monthKey, today));
  // A remote sync (another user edited this employee's attendance) → re-read the
  // month so the grid + late/OT totals update live without reopening the modal.
  uEc(() => { setAtt(CO.attendance(staffProp, monthKey, today)); }, [syncTick, monthKey]);
  const acc = uMc(() => CO.accountInfo(staffProp), [staffProp]);   // legacy fallback for fields not yet on the staff object
  const [identEdit, setIdentEdit] = uSc(false);
  const [offboard, setOffboard] = uSc(false);
  const [settle, setSettle] = uSc(false);
  const separated = !HRD.isActive(staff);
  const doOffboard = (u) => { setStaffLocal(u); if (onSaveStaff) onSaveStaff(u); setOffboard(false); };
  const doReactivate = () => {
    const r = prompt(trC('co.reactivateReason')); if (r == null) return;
    const u = { ...staff, sepStatus: 'active', active: true, separationDate: '', separationReason: '', separationNote: (staff.separationNote ? staff.separationNote + ' | ' : '') + 'Reactivated: ' + r };
    setStaffLocal(u); if (onSaveStaff) onSaveStaff(u);
  };
  // Identity value: prefer the staff object (single source of truth); fall back to legacy account-map.
  const g = (k) => (staff[k] != null && staff[k] !== '') ? staff[k] : (acc[k] != null ? acc[k] : '');
  const joined = staff.joinedDate || acc.joined || '';
  const STATUS = { present: { l: trC('att.present'), c: 'var(--green-700)', bg: 'var(--pos-bg)' }, late: { l: trC('att.late'), c: 'var(--warn)', bg: 'var(--sand-soft)' }, absent: { l: trC('att.absent'), c: 'var(--neg)', bg: 'var(--neg-bg)' }, leave: { l: trC('att.leave'), c: 'var(--blue-700)', bg: '#E3F2FB' }, off: { l: trC('att.off'), c: 'var(--text-mut)', bg: 'var(--card-soft)' }, none: { l: trC('att.none'), c: 'var(--text-faint)', bg: 'var(--card-soft)' } };
  const STATUS_OPTS = ['present', 'late', 'absent', 'leave', 'off'].map((v) => ({ value: v, label: STATUS[v].l }));
  // late penalty (auto, from attendance + rate policy)
  const late = uMc(() => CO.lateInfo(staff, monthKey, today, rates), [staff, monthKey, today, rates, att]);
  const ot = uMc(() => CO.overtimeInfo(staff, monthKey, today, rates), [staff, monthKey, today, rates, att]);
  // this employee's kasbon (cash advances) for the CURRENT payroll cycle (16→15)
  const [kbAdd, setKbAdd] = uSc(false);
  const cycleAnchor = HRD.payCycle(today).anchor;
  const cycleCashbons = uMc(() => HRD.cashbonsInCycle(staff.id, cashbons, cycleAnchor), [cashbons, staff.id, cycleAnchor]);
  const cycleTotal = uMc(() => HRD.cashbonCycleTotal(staff.id, cashbons, cycleAnchor), [cashbons, staff.id, cycleAnchor]);
  const outstanding = uMc(() => HRD.cashbonOutstanding(staff.id, cashbons), [cashbons, staff.id]);   // all cycles (for termination)
  const ceiling = HRD.cashbonCeiling(staff);
  const kbCut = cycleTotal > 0; // deducted in full at this cycle's cutoff
  const saveCashbon = (cb) => { if (onAddCashbon) onAddCashbon(cb); setKbAdd(false); };
  const cancelCashbon = (id) => { if (confirm(trC('co.kasbonCancelConfirm')) && onUpdateCashbon) onUpdateCashbon(id, { status: 'cancelled' }); };
  // orientation (new hire)
  const [oriSlip, setOriSlip] = uSc(false);
  const inOrientation = HRD.isOrientationStage(staff);
  const ori = staff.orientation || {};
  const oriDays = inOrientation ? CO.oriAtt(staff.id) : [];
  // staff with auto late-penalty + overtime + this cycle's kasbon merged in
  const augStaff = uMc(() => {
    const manual = (staff.deductions || []).filter((d) => !d.auto);
    const extra = late.amount > 0 ? [{ id: 'auto-late', label: trC('co.lateDeduct'), amount: late.amount, auto: true }] : [];
    if (cycleTotal > 0) extra.push({ id: 'kasbon-cycle', label: 'Kasbon', amount: cycleTotal, auto: true, kasbon: true });
    return { ...staff, deductions: [...manual, ...extra], otPay: ot.amount };
  }, [staff, late, ot, cycleTotal]);
  const c = HRD.compute(augStaff, rates, HRD.payPeriod(monthKey));
  // keep the roster in sync so payroll/payslip reflect late penalty + overtime
  uEc(() => { if (onSyncDeduct) onSyncDeduct(staff.id, late.amount, trC('co.lateDeduct'), ot.amount); }, [late.amount, ot.amount]);
  const setDay = (date, status, patch) => { CO.setAttDay(staff.id, monthKey, date, status, patch); setAtt(CO.attendance(staff, monthKey, today)); };
  // A working day shows the clock (present/late, or a still-'none' row that displays
  // as "Hadir"); only absent/leave/off hide it.
  const isTimedStatus = (s) => s !== 'absent' && s !== 'leave' && s !== 'off';
  const hmMin = (t) => { const p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); };
  // Status to PERSIST when a timed row's clock is edited: keep an explicit
  // present/late choice; a not-yet-set ('none') row becomes present — or late when
  // the check-in is past the standard start time — so it never stays 'none'.
  const timedStatus = (r, nextIn) => {
    if (r.status === 'present' || r.status === 'late') return r.status;
    const inT = nextIn || r.in || '08:00';
    return hmMin(inT) > hmMin((rates && rates.lateStart) || '08:00') ? 'late' : 'present';
  };
  // Identity edits go through the SHARED StaffModal → same hrdStaff array (single source of truth).
  const saveIdentity = (s) => { setStaffLocal(s); if (onSaveStaff) onSaveStaff(s); setIdentEdit(false); };
  const deds = (staff.deductions || []).filter((d) => +d.amount > 0 && !d.auto);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="emp-detail" onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="emp-av lg" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}>{staff.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ed-name">{staff.name}</div>
            <div className="ed-pos">{staff.pos || '—'} · {staff.dept}</div>
          </div>
          {canEdit && onSaveStaff && !separated && <button className="btn btn-lime ed-editbtn" onClick={() => setIdentEdit(true)}><IconPencil s={15} />{trC('co.editData')}</button>}
          {canEdit && onSaveStaff && !separated && <button className="ed-editbtn ed-offbtn" onClick={() => setOffboard(true)} title={trC('co.offboard')}><IconLogout s={15} />{trC('co.offboard')}</button>}
          {separated && <button className="ed-editbtn" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }} onClick={() => setSettle(true)}><IconInvoice s={15} />{trC('co.settlement')}</button>}
          {canEdit && onSaveStaff && separated && <button className="btn btn-lime ed-editbtn" onClick={doReactivate}><IconCheck s={15} />{trC('co.reactivate')}</button>}
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>

        <div className="ed-body scroll-y">
          {separated && (
            <div className="sep-banner">
              <IconShield s={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{trC('co.sepBannerT')} · {trC('co.sep_' + staff.sepStatus)}</b>
                <span>{staff.separationDate}{staff.separationReason ? ` · ${staff.separationReason}` : ''}</span>
              </div>
            </div>
          )}
          <div className="ed-section-t">{trC('att.title')} · {att.workdays} {trC('att.workdays')}{canEditAtt && <span className="ed-edit-hint">{trC('att.fullMonth')}</span>}</div>
          <div className="ed-att-grid">
            <div className="ed-att-stat"><b className="tnum" style={{ color: 'var(--green-700)' }}>{att.present}</b><span>{trC('att.present')}</span></div>
            <div className="ed-att-stat"><b className="tnum" style={{ color: 'var(--warn)' }}>{att.late}</b><span>{trC('att.late')}</span></div>
            <div className="ed-att-stat"><b className="tnum" style={{ color: 'var(--neg)' }}>{att.absent}</b><span>{trC('att.absent')}</span></div>
            <div className="ed-att-stat"><b className="tnum" style={{ color: 'var(--blue-700)' }}>{att.leave}</b><span>{trC('att.leave')}</span></div>
            <div className="ed-att-stat"><b className="tnum">{att.rate}%</b><span>{trC('att.rate')}</span></div>
          </div>
          <div className="ed-att-log scroll-y">
            {att.log.map((r) => {
              const st = STATUS[r.status] || STATUS.none;
              const timed = isTimedStatus(r.status);   // present / late / none(→Hadir) show the clock
              const isToday = r.date === today;
              if (!canEditAtt) {
                return (
                  <div className={`ed-log-row ${isToday ? 'today' : ''}`} key={r.date}>
                    <span className="ed-log-date tnum">{r.date.slice(8)}/{r.date.slice(5, 7)}</span>
                    <span className="ed-log-pill" style={{ background: st.bg, color: st.c }}>{st.l}</span>
                    <span className="ed-log-time tnum">{r.in ? `${r.in} – ${r.out}` : '—'}</span>
                  </div>
                );
              }
              return (
                <div className={`ed-log-row edit ${isToday ? 'today' : ''}`} key={r.date}>
                  <span className="ed-log-date tnum">{r.date.slice(8)}/{r.date.slice(5, 7)}</span>
                  <UI.Dropdown compact value={r.status === 'none' ? 'present' : r.status} color={st.c} menuColor={st.bg}
                    options={STATUS_OPTS}
                    onChange={(v) => setDay(r.date, v, { in: r.in, out: r.out })} />
                  {timed ? (
                    <div className="ed-inline-times">
                      <UI.TimePicker compact value={r.in || '08:00'} onChange={(v) => setDay(r.date, timedStatus(r, v), { in: v, out: r.out || '17:00' })} />
                      <span className="ed-time-dash">–</span>
                      <UI.TimePicker compact value={r.out || '17:00'} onChange={(v) => setDay(r.date, timedStatus(r), { in: r.in || '08:00', out: v })} />
                      <input className="ed-ot-input" inputMode="numeric" title={trC('att.otHours')} placeholder="0" value={r.ot || ''} onChange={(e) => setDay(r.date, timedStatus(r), { in: r.in || '08:00', out: r.out || '17:00', ot: +e.target.value.replace(/\D/g, '') || 0 })} />
                      <span className="ed-ot-lbl">{trC('att.ot')}</span>
                    </div>
                  ) : <span className="ed-log-time tnum">—</span>}
                </div>
              );
            })}
          </div>

          <div className="ed-section-t">{trC('hrd.otherDeducts')}</div>
          <div className="ed-ded-list">
            {att.absent > 0 && <div className="ed-ded-row"><span><IconCalendar s={15} /> {trC('hrd.unpaiddays')} ({att.absent})</span>{seeMoney && <b className="tnum amt-neg">−{rpC(Math.round(c.dailyRate * att.absent))}</b>}</div>}
            {late.amount > 0 && <div className="ed-ded-row"><span><IconClock s={15} /> {trC('co.lateDeduct')} ({trC('co.lateMins', { n: late.minutes })})</span>{seeMoney && <b className="tnum amt-neg">−{rpC(late.amount)}</b>}</div>}
            {ot.amount > 0 && <div className="ed-ded-row"><span><IconTrendUp s={15} /> {trC('co.overtime')} ({trC('co.otHours', { n: ot.hours })})</span>{seeMoney && <b className="tnum amt-pos">+{rpC(ot.amount)}</b>}</div>}
            {deds.map((d) => <div className="ed-ded-row" key={d.id}><span><IconCoinOut s={15} /> {d.label}</span>{seeMoney && <b className="tnum amt-neg">−{rpC(+d.amount)}</b>}</div>)}
            {kbCut && <div className="ed-ded-row"><span><IconWallet s={15} /> {trC('co.kasbon')} ({trC('co.kasbonCutAt', { d: cycleAnchor })})</span>{seeMoney && <b className="tnum amt-neg">−{rpC(cycleTotal)}</b>}</div>}
            {att.absent === 0 && late.amount === 0 && ot.amount === 0 && deds.length === 0 && !kbCut && <div className="ed-empty">{trC('co.noDeducts')}</div>}
          </div>

          {seeMoney && (
            <>
              <div className="ed-section-t">{trC('co.payrollSnap')}{canEdit && <button className="ed-acc-edit" onClick={onEdit}><IconCoinOut s={13} />{trC('co.setSalary')}</button>}</div>
              {(+staff.base > 0) ? (
                <div className="ed-pay-grid">
                  <div className="ed-pay"><span>{trC('hrd.gross')}</span><b className="tnum">{rpC(c.gross)}</b></div>
                  <div className="ed-pay"><span>{trC('hrd.cDeduct')}</span><b className="tnum amt-neg">−{rpC(c.employeeDeduct)}</b></div>
                  <div className="ed-pay hl"><span>{trC('hrd.cTakehome')}</span><b className="tnum amt-pos">{rpC(c.takeHome)}</b></div>
                  <div className="ed-pay"><span>{trC('hrd.cCost')}</span><b className="tnum">{rpC(c.companyCost)}</b></div>
                </div>
              ) : <div className="ed-empty">{trC('co.salaryNotSet')}</div>}
            </>
          )}

          {seeMoney && (
            <>
              <div className="ed-section-t">{trC('co.kasbon')} · {trC('co.kasbonCycle', { a: cycleAnchor })}{canEdit && <button className="ed-acc-edit" onClick={() => setKbAdd(true)}><IconPlus s={12} />{trC('co.kasbonAdd')}</button>}</div>
              <div className="kb-limbar">
                <span>{trC('co.kasbonCeiling')}: <b className="tnum">{rpC(ceiling)}</b></span>
                <span>{trC('co.kasbonRemainingCycle')}: <b className="tnum">{rpC(Math.max(0, ceiling - cycleTotal))}</b></span>
                {outstanding > cycleTotal && <span className="kb-outs">{trC('co.kasbonOutstanding')}: <b className="tnum">{rpC(outstanding)}</b></span>}
              </div>
              {cycleCashbons.length === 0 ? (
                <div className="ed-empty">{trC('co.kasbonNone')}</div>
              ) : (
                <div className="kb-list">
                  {cycleCashbons.map((cb) => (
                    <div className="kb-row" key={cb.id}>
                      <div className="kb-main">
                        <div className="kb-amt tnum">{rpC(cb.amount)}</div>
                        <div className="kb-sub">{cb.date}{cb.note ? ' · ' + cb.note : ''}</div>
                      </div>
                      <div className="kb-right">
                        {cb.status === 'paid' ? <span className="kb-paid">{trC('co.kasbonPaid')}</span> : <span className="kb-week-ok">{trC('co.kasbonActive')}</span>}
                      </div>
                      {canEdit && cb.status === 'active' && <button className="icon-btn del" title={trC('co.kasbonCancel')} onClick={() => cancelCashbon(cb.id)}><IconClose s={15} /></button>}
                    </div>
                  ))}
                  <div className="kb-total"><span>{trC('co.kasbonCycleTotal')} · {trC('co.kasbonCutAt', { d: cycleAnchor })}</span><b className="tnum amt-neg">−{rpC(cycleTotal)}</b></div>
                </div>
              )}
            </>
          )}

          {inOrientation && (() => {
            const end = HRD.orientationEnd(staff);
            const wage = HRD.orientationWage(oriDays, rates, ori.dailyWage);
            const total = wage.total;
            const oc = ori.outcome || 'pending';
            const ocCls = oc === 'passed' ? 'passed' : oc === 'failed' ? 'failed' : 'pending';
            return (
              <div>
                <div className="ed-section-t">{trC('ori.section')}<span className={`ori-badge stage-${HRD.stageOf(staff)}`}>{trC('stage.' + HRD.stageOf(staff))}</span><span className={`ori-badge ${ocCls}`}>{trC('ori.out_' + oc)}</span></div>
                <div className="ori-facts">
                  <div><span>{trC('ori.start')}</span><b>{ori.startDate || '—'}</b></div>
                  <div><span>{trC('ori.end')}</span><b>{end || '—'}</b></div>
                  <div><span>{trC('ori.dailyWage')}</span><b>{rpC(+ori.dailyWage || 0)}</b></div>
                  <div><span>{trC('ori.daysRecorded')}</span><b>{wage.days} {trC('ori.days')}</b></div>
                  {seeMoney && <div><span>{trC('ori.runningTotal')}</span><b>{rpC(total)}</b></div>}
                  <div><span>{trC('ori.paidQ')}</span><b>{ori.paid ? trC('ori.paidYes') + (ori.paidAt ? ' · ' + ori.paidAt : '') : trC('ori.unpaid')}</b></div>
                </div>
                <div className="ed-empty" style={{ marginTop: 6 }}>{trC('ori.manageHint')}</div>
                {canEdit && (
                  <div className="ori-actions">
                    {!ori.paid && onPayOrientation && total > 0 && <button className="btn" onClick={() => { const rec = canAddEntry && confirm(trC('ori.payExpenseQ', { amt: rpC(total) })); onPayOrientation(staff, rec); }}>{trC('ori.pay')}</button>}
                    <button className="btn" onClick={() => setOriSlip(true)}>{trC('ori.slip')}</button>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="ed-section-t">{trC('co.account')}{canEdit && onSaveStaff && <button className="ed-acc-edit" onClick={() => setIdentEdit(true)}><IconPencil s={12} />{trC('co.editData')}</button>}</div>
          <div className="ed-acc-grid">
            {/* ── Identitas ── */}
            <div className="ed-grp-t">{trC('co.grpIdentity')}</div>
            <div className="ed-acc"><span>{trC('co.nip')}</span><b className="tnum">{g('nip') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.office')}</span><b>{g('office') || 'AIRRO'}</b></div>
            <div className="ed-acc"><span>{trC('co.maritalStatus')}</span><b>{trC('co.m' + (g('maritalStatus') || 'TK'))}</b></div>
            <div className="ed-acc"><span>NIK</span><b className="tnum">{g('nik') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.noKk')}</span><b className="tnum">{g('noKk') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.ttl')}</span><b>{g('birthPlace') || '—'}{g('birthDate') ? `, ${g('birthDate')}` : ''}</b></div>

            {/* ── Kontrak ── */}
            <div className="ed-grp-t">{trC('co.grpContract')}</div>
            <div className="ed-acc"><span>{trC('co.empStatus')}</span><b>{(g('status') || '—')} · {staff.jp ? 'JP' : trC('hrd.notenroll')}</b></div>
            <div className="ed-acc"><span>{trC('co.noSurat')}</span><b>{g('noSurat') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.joined')}</span><b className="tnum">{joined || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.contractStart')}</span><b className="tnum">{g('contractStart') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.contractEnd')}</span><b className="tnum">{g('contractEnd') || '—'}</b></div>
            <div className="ed-acc"><span>JKK</span><b>{staff.risk}</b></div>

            {/* ── Alamat ── */}
            <div className="ed-grp-t">{trC('co.grpAddress')}</div>
            <div className="ed-acc ed-acc-wide"><span>{trC('co.addressKtp')}</span><b>{g('addressKtp') || '—'}</b></div>
            <div className="ed-acc ed-acc-wide"><span>{trC('co.addressDomisili')}</span><b>{g('addressDomisili') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.phone')}</span><b className="tnum">{g('phone') || '—'}</b></div>

            {/* ── BPJS & Bank ── */}
            <div className="ed-grp-t">{trC('co.grpBpjs')}</div>
            <div className="ed-acc"><span>{trC('co.noBpjsKes')}</span><b className="tnum">{g('noBpjsKes') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.noBpjsTk')}</span><b className="tnum">{g('noBpjsTk') || '—'}</b></div>
            <div className="ed-acc"><span>{trC('co.bank')}</span><b>{(g('bank') || '—')}{g('account') ? ` · ${g('account')}` : ''}</b></div>
          </div>
          {identEdit && <PAYROLL.StaffModal staff={staff} rates={rates} variant="identity" onSave={saveIdentity} onClose={() => setIdentEdit(false)} />}
          {kbAdd && <CashbonModal staff={staff} onSave={saveCashbon} onClose={() => setKbAdd(false)} />}
          {offboard && <OffboardModal staff={staff} rates={rates} cashbons={cashbons} onSave={doOffboard} onClose={() => setOffboard(false)} />}
          {settle && <SettlementSlip staff={staff} rates={rates} cashbons={cashbons} onClose={() => setSettle(false)} />}
          {oriSlip && <OrientationSlip staff={staff} rates={rates} onClose={() => setOriSlip(false)} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Employee Directory ---------- */
function EmployeeDirectory({ staff, rates, departments, monthKey, today, onEdit, onOpen, canEdit, seeMoney, setStaff }) {
  const [q, setQ] = uSc('');
  const [dept, setDept] = uSc('All');
  const [editing, setEditing] = uSc(null);
  const [showArchive, setShowArchive] = uSc(false);
  const deptList = (departments && departments.length ? departments : HRD.loadDepartments());
  const depts = ['All', ...deptList];
  // Writes to the SAME hrdStaff array → instantly visible in Payroll too.
  const saveStaff = (s) => {
    setStaff((prev) => { const clean = { ...s }; delete clean._isNew; return prev.find((x) => x.id === s.id) ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; });
    setEditing(null);
  };
  const addStaff = () => setEditing(HRD.newStaff());
  const archivedCount = staff.filter((s) => !HRD.isActive(s)).length;
  let rows = showArchive ? staff : HRD.activeStaff(staff);   // default hides former employees
  // Employees screen shows the payroll roster only — active orientation/DW workers
  // live on the Orientation/DW screen (former/failed ones still appear in Archive).
  rows = rows.filter((s) => !(HRD.isOrientationStage(s) && HRD.isActive(s)));
  if (dept !== 'All') rows = rows.filter((s) => s.dept === dept);
  if (q) rows = rows.filter((s) => (s.name + (s.pos || '') + (s.dept || '')).toLowerCase().includes(q.toLowerCase()));
  const groups = {};
  rows.forEach((s) => { (groups[s.dept || 'Other'] = groups[s.dept || 'Other'] || []).push(s); });
  const order = [...deptList.filter((d) => groups[d]), ...Object.keys(groups).filter((d) => !deptList.includes(d))];
  return (
    <div className="screen-enter">
      <div className="emp-toolbar">
        <div className="tx-search" style={{ width: 260 }}>
          <IconSearch s={17} style={{ color: 'var(--text-faint)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={trC('co.searchEmp')} />
        </div>
        <div className="dept-chips">
          {depts.map((d) => <button key={d} className={`dept-chip ${dept === d ? 'on' : ''}`} onClick={() => setDept(d)}>{d === 'All' ? trC('co.allDepts') : d}</button>)}
        </div>
        {archivedCount > 0 && <button className={`dept-chip ${showArchive ? 'on' : ''}`} onClick={() => setShowArchive((v) => !v)} title={trC('co.archiveToggle')}>{trC('co.archive')} · {archivedCount}</button>}
        {canEdit && setStaff && <button className="btn btn-primary emp-add-btn" onClick={addStaff}><IconPlus s={16} />{trC('hrd.addEmp')}</button>}
      </div>
      {order.length === 0 && <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}>{trC('entries.none')}</div>}
      {order.map((d) => (
        <div key={d} className="emp-dept">
          <div className="emp-dept-head"><span>{d}</span><span className="emp-dept-count">{groups[d].length}</span></div>
          <div className="emp-cards">
            {groups[d].map((s) => {
              const c = HRD.compute(s, rates, HRD.payPeriod(monthKey));
              const sep = !HRD.isActive(s);
              return (
                <div key={s.id} className={`emp-card ${sep ? 'archived' : ''}`} onClick={() => onOpen(s)} style={{ cursor: 'pointer' }}>
                  <span className="emp-av" style={{ background: 'var(--mint-100)', color: 'var(--green-800)' }}>{s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="emp-name">{s.name}</div>
                    <div className="emp-pos">{s.nip ? <span className="emp-nip">{s.nip}</span> : null}{s.nip ? ' · ' : ''}{s.pos || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {sep
                      ? <span className="emp-sep-badge">{trC('co.sep_' + s.sepStatus)}{s.separationDate ? ` · ${s.separationDate}` : ''}</span>
                      : (+s.base > 0)
                        ? <><div className="tnum emp-thp">{rpC(c.takeHome)}</div><div className="emp-thp-l">{trC('hrd.cTakehome')}</div></>
                        : <div className="emp-thp-unset">{trC('co.salaryNotSet')}</div>}
                  </div>
                  {canEdit && setStaff && !sep && <button className="emp-card-edit" title={trC('co.editData')} onClick={(e) => { e.stopPropagation(); setEditing(s); }}><IconPencil s={15} /></button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {editing && <PAYROLL.StaffModal staff={editing} rates={rates} departments={departments} variant="identity" onSave={saveStaff} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ---------- Daily Roll-Call ---------- */
function RollCall({ staff, monthKey, today }) {
  const STATUS = { present: { l: trC('att.present'), c: 'var(--green-700)' }, late: { l: trC('att.late'), c: 'var(--warn)' }, absent: { l: trC('att.absent'), c: 'var(--neg)' }, leave: { l: trC('att.leave'), c: 'var(--blue-700)' } };
  const init = {};
  staff.forEach((s) => { const a = CO.attendance(s, monthKey, today); const rec = a.log.find((r) => r.date === today); init[s.id] = (rec && rec.status !== 'none' && rec.status !== 'off') ? rec.status : 'present'; });
  const [marks, setMarks] = uSc(init);
  const [savedAt, setSavedAt] = uSc(null);
  const setMark = (id, st) => { const next = { ...marks, [id]: st }; setMarks(next); CO.setAttDay(id, monthKey, today, st); };
  const bulk = (st) => { const next = {}; staff.forEach((s) => { next[s.id] = st; CO.setAttDay(s.id, monthKey, today, st); }); setMarks(next); };
  const save = () => { staff.forEach((s) => CO.setAttDay(s.id, monthKey, today, marks[s.id])); setSavedAt(Date.now()); setTimeout(() => setSavedAt(null), 2200); };
  const counts = staff.reduce((a, s) => { a[marks[s.id]] = (a[marks[s.id]] || 0) + 1; return a; }, {});
  const niceToday = (() => { const d = new Date(today + 'T00:00'); return `${d.getDate()} ${PERIOD.mon(d.getMonth())} ${d.getFullYear()}`; })();
  return (
    <div className="screen-enter">
      <div className="rollcall-head">
        <div className="rc-date"><IconCalendar s={18} />{niceToday}</div>
        <div className="rc-bulk">
          <button className="btn btn-ghost" onClick={() => bulk('present')}><IconCheck s={15} />{trC('rc.allPresent')}</button>
          <button className="btn btn-primary" onClick={save}><IconCheck s={15} />{savedAt ? trC('rc.saved') : trC('rc.save')}</button>
        </div>
      </div>
      <div className="fin-stat-row" style={{ marginBottom: 16 }}>
        {['present', 'late', 'absent', 'leave'].map((k) => (
          <div key={k} className="card stat-box"><div className="tnum" style={{ fontSize: 24, fontWeight: 800, color: STATUS[k].c }}>{counts[k] || 0}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{STATUS[k].l}</div></div>
        ))}
      </div>
      <div className="rc-list">
        {staff.map((s) => (
          <div key={s.id} className="rc-row">
            <span className="rc-av">{s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rc-name">{s.name}</div>
              <div className="rc-dept">{s.pos || '—'} · {s.dept}</div>
            </div>
            <div className="rc-seg">
              {['present', 'late', 'absent', 'leave'].map((st) => (
                <button key={st} className={`rc-opt ${marks[s.id] === st ? 'on' : ''}`} style={marks[s.id] === st ? { background: STATUS[st].c } : null} onClick={() => setMark(s.id, st)}>{STATUS[st].l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- HR Report (KPIs & analytics) ---------- */
function HRReport({ staff, rates, departments, budget, monthKey, today, approvals, gran, anchor, setAnchor, range, periodLbl, setGran }) {
  const t = HRD.totals(staff, rates);
  const aff = HRD.affordability(staff, rates, budget);
  const MN = (window.PERIOD ? PERIOD.mon : (i) => i + 1);
  const toMin = (x) => { const [h, m] = (x || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const lateStart = toMin(rates.lateStart || '08:00'), perMin = +rates.latePerMin || 0, basis = rates.lateBasis === 'hour' ? 'hour' : 'minute', otPer = +rates.otPerHour || 0;
  const monthsInRange = (start, end) => { const out = []; let [y, m] = start.split('-').map(Number); const ek = end.slice(0, 7); let k = `${y}-${String(m).padStart(2, '0')}`; while (k <= ek) { out.push(k); m++; if (m > 12) { m = 1; y++; } k = `${y}-${String(m).padStart(2, '0')}`; } return out; };
  // per-employee attendance over the selected date range
  const perEmp = uMc(() => {
    const mks = monthsInRange(range.start, range.end);
    return staff.map((s) => {
      let present = 0, late = 0, absent = 0, leave = 0, lateMin = 0, otHrs = 0;
      mks.forEach((mk) => {
        const a = CO.attendance(s, mk, mk === today.slice(0, 7) ? today : null);
        a.log.forEach((r) => {
          if (r.date < range.start || r.date > range.end) return;
          if (r.status === 'present') present++;
          else if (r.status === 'late') { late++; if (r.in) lateMin += Math.max(0, toMin(r.in) - lateStart); }
          else if (r.status === 'absent') absent++;
          else if (r.status === 'leave') leave++;
          otHrs += (+r.ot || 0);
        });
      });
      const workdays = present + late + absent + leave;
      const rate = workdays ? Math.round(((present + late) / workdays) * 100) : 100;
      const lateAmt = basis === 'hour' ? Math.round((lateMin / 60) * perMin) : Math.round(lateMin * perMin);
      const a = { present, late, absent, leave, workdays, rate, lateMin, lateAmt, otHrs, otAmt: Math.round(otHrs * otPer) };
      return { s, a, c: HRD.compute(s, rates, HRD.payPeriod(monthKey)) };
    });
  }, [staff, rates, range.start, range.end, today]);
  const agg = uMc(() => {
    let present = 0, late = 0, absent = 0, leave = 0, workdays = 0, lateMin = 0, lateAmt = 0, otHrs = 0, otAmt = 0;
    perEmp.forEach(({ a }) => { present += a.present; late += a.late; absent += a.absent; leave += a.leave; workdays += a.workdays; lateMin += a.lateMin; lateAmt += a.lateAmt; otHrs += a.otHrs; otAmt += a.otAmt; });
    const rate = workdays ? Math.round(((present + late) / workdays) * 100) : 100;
    return { present, late, absent, leave, workdays, rate, lateMin, lateAmt, otHrs, otAmt };
  }, [perEmp]);
  // department detail
  const byDept = uMc(() => {
    const m = {};
    perEmp.forEach(({ s, a, c }) => { const k = s.dept || 'Other'; const d = (m[k] = m[k] || { count: 0, cost: 0, present: 0, wd: 0 }); d.count++; d.cost += c.companyCost; d.present += a.present + a.late; d.wd += a.workdays; });
    const dl = (departments && departments.length ? departments : HRD.loadDepartments());
    // Known departments first (managed order), then any legacy dept still on staff.
    const order = [...dl.filter((d) => m[d]), ...Object.keys(m).filter((d) => dl.indexOf(d) < 0)];
    return order.map((d) => ({ dept: d, ...m[d], rate: m[d].wd ? Math.round((m[d].present / m[d].wd) * 100) : 100 }));
  }, [perEmp, departments]);
  const maxDept = Math.max(1, ...byDept.map((d) => d.cost));
  // workforce composition
  const comp = uMc(() => {
    const status = {}, risk = {};
    staff.forEach((s) => { const ac = CO.accountInfo(s); const st = s.status || ac.status; status[st] = (status[st] || 0) + 1; risk[s.risk] = (risk[s.risk] || 0) + 1; });
    return { status, risk };
  }, [staff]);
  // 6-month attendance-rate trend
  const trend = uMc(() => {
    const [yy, mm] = monthKey.split('-').map(Number);
    const out = [];
    for (let i = 5; i >= 0; i--) { let m = mm - i, y = yy; while (m <= 0) { m += 12; y--; } const mk = `${y}-${String(m).padStart(2, '0')}`; let p = 0, w = 0; staff.forEach((s) => { const a = CO.attendance(s, mk, mk === today.slice(0, 7) ? today : null); p += a.present + a.late; w += a.workdays; }); out.push({ m: MN(m - 1), rate: w ? Math.round((p / w) * 100) : 100 }); }
    return out;
  }, [staff, monthKey, today]);
  const pendCount = (approvals || []).filter((a) => a.status === 'pending').length;
  const jpCount = staff.filter((s) => s.jp).length;
  const topLate = perEmp.filter((e) => e.a.lateMin > 0).sort((a, b) => b.a.lateMin - a.a.lateMin).slice(0, 3);
  const topOt = perEmp.filter((e) => e.a.otHrs > 0).sort((a, b) => b.a.otHrs - a.a.otHrs).slice(0, 3);

  const kpis = [
    { label: trC('hrr.headcount'), value: t.count, icon: 'IconUsersGroup', bg: 'var(--green-800)', dark: true, sub: byDept.length + ' ' + trC('hrr.depts') },
    { label: trC('hrr.attRate'), value: agg.rate + '%', icon: 'IconCheck', bg: 'var(--mint-100)', fg: 'var(--green-800)', sub: periodLbl },
    { label: trC('hrr.payrollCost'), value: rpC(t.companyCost), icon: 'IconWallet', bg: 'var(--sand-soft)', fg: 'var(--warn)', sub: Math.round(aff.util * 100) + '% ' + trC('co.ofBudget') },
    { label: trC('hrr.avgCost'), value: rpC(aff.avgCost), icon: 'IconCoinOut', bg: '#EAF1F4', fg: '#5E7A88', sub: trC('co.perEmployee') },
  ];
  const StatTile = ({ label, value, color }) => (<div className="hrr-tile"><b className="tnum" style={color ? { color } : null}>{value}</b><span>{label}</span></div>);
  const maxRate = 100, minRate = Math.min(80, ...trend.map((d) => d.rate)) - 3;
  const av = (s) => s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const exportCSV = () => {
    const head = ['Employee', 'Department', 'Position', 'Present', 'Late', 'Absent', 'Leave', 'Workdays', 'Attendance %', 'Late minutes', 'Late penalty', 'Overtime hrs', 'Overtime pay', 'Gross', 'Take-home', 'Company cost'];
    const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [head.join(',')];
    perEmp.forEach(({ s, a, c }) => {
      lines.push([esc(s.name), esc(s.dept), esc(s.pos || ''), a.present, a.late, a.absent, a.leave, a.workdays, a.rate, a.lateMin, a.lateAmt, a.otHrs, a.otAmt, c.gross, c.takeHome, c.companyCost].join(','));
    });
    lines.push(['TOTAL', '', '', agg.present, agg.late, agg.absent, agg.leave, agg.workdays, agg.rate, agg.lateMin, agg.lateAmt, agg.otHrs, agg.otAmt, t.gross, t.takeHome, t.companyCost].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `AirRO-HR-Report-${periodLbl.replace(/[^\w]+/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen-enter">
      <div className="hrr-head">
        <div className="period-bar">
          <div className="gran-seg">
            {[['day', 'rep.day'], ['week', 'rep.week'], ['month', 'rep.month'], ['year', 'rep.year']].map(([g, key]) => (
              <button key={g} className={`gran-btn ${gran === g ? 'on' : ''}`} onClick={() => setGran(g)}>{trC(key)}</button>
            ))}
          </div>
          <DP.PeriodNav gran={gran} anchor={anchor} onAnchor={setAnchor} label={periodLbl} today={today} />
        </div>
        <div className="hrr-head-actions">
          <button className="btn btn-ghost" onClick={exportCSV}><IconDownload s={16} />{trC('hrr.csv')}</button>
          <button className="btn btn-ghost" onClick={() => window.print()}><IconReport s={16} />{trC('hrr.print')}</button>
        </div>
      </div>
      <div className="fin-stat-row">
        {kpis.map((c, i) => (
          <div key={i} className={`card stat-box ${c.dark ? 'dark' : ''}`}>
            <span className="icon-tile" style={{ background: c.dark ? 'rgba(255,255,255,.14)' : c.bg, color: c.dark ? '#fff' : c.fg }}>{IcC(c.icon, { s: 19 })}</span>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 800, marginTop: 12, whiteSpace: 'nowrap', color: c.dark ? '#fff' : 'var(--ink)' }}>{c.value}</div>
            <div style={{ fontSize: 12.5, color: c.dark ? 'rgba(255,255,255,.7)' : 'var(--text-mut)', marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 11, color: c.dark ? 'rgba(255,255,255,.5)' : 'var(--text-faint)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* attendance trend */}
      <div className="card" style={{ padding: 20, marginTop: 18 }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{trC('hrr.trend')}</div>
        <div className="hrr-trend">
          {trend.map((d, i) => (
            <div key={i} className="hrr-trend-col">
              <span className="hrr-trend-val tnum">{d.rate}%</span>
              <div className="hrr-trend-track"><div className="hrr-trend-bar" style={{ height: Math.max(4, ((d.rate - minRate) / (maxRate - minRate)) * 100) + '%' }} /></div>
              <span className="hrr-trend-m">{d.m}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="co-grid" style={{ marginTop: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{trC('hrr.attHealth')}</div>
          <div className="hrr-tiles">
            <StatTile label={trC('att.present')} value={agg.present} color="var(--green-700)" />
            <StatTile label={trC('att.late')} value={agg.late} color="var(--warn)" />
            <StatTile label={trC('att.absent')} value={agg.absent} color="var(--neg)" />
            <StatTile label={trC('att.leave')} value={agg.leave} color="var(--blue-700)" />
          </div>
          <div className="hrr-rows">
            <div className="hrr-row"><span><IconClock s={15} /> {trC('hrr.totalLate')}</span><b className="tnum">{agg.lateMin} min · <span className="amt-neg">−{rpC(agg.lateAmt)}</span></b></div>
            <div className="hrr-row"><span><IconTrendUp s={15} /> {trC('hrr.totalOt')}</span><b className="tnum">{agg.otHrs} {trC('hrr.hrs')} · <span className="amt-pos">+{rpC(agg.otAmt)}</span></b></div>
            <div className="hrr-row"><span><IconShield s={15} /> {trC('hrr.bpjsEnroll')}</span><b className="tnum">{jpCount}/{t.count} JP · {t.count}/{t.count} Kes</b></div>
            <div className="hrr-row"><span><IconInvoice s={15} /> {trC('hrr.pendingReq')}</span><b className="tnum">{pendCount}</b></div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{trC('hrr.composition')}</div>
          <div className="hrr-comp-t">{trC('hrr.empStatus')}</div>
          <div className="hrr-chips">{Object.entries(comp.status).map(([k, v]) => <span key={k} className="hrr-chip"><b>{v}</b> {k}</span>)}</div>
          <div className="hrr-comp-t" style={{ marginTop: 14 }}>{trC('hrr.riskMix')}</div>
          <div className="hrr-chips">{Object.entries(comp.risk).map(([k, v]) => <span key={k} className="hrr-chip"><b>{v}</b> {k}</span>)}</div>
          <div className="hrr-comp-t" style={{ marginTop: 14 }}>{trC('hrr.bpjsEnroll')}</div>
          <div className="hrr-chips"><span className="hrr-chip"><b>{jpCount}</b> JP</span><span className="hrr-chip"><b>{t.count}</b> Kesehatan</span></div>
        </div>
      </div>

      {/* department detail table */}
      <div className="card" style={{ padding: 20, marginTop: 18 }}>
        <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{trC('hrr.byDept')}</div>
        <div className="hrr-dtable">
          <div className="hrr-dt-head"><span>{trC('hrr.dept')}</span><span>{trC('hrr.staff')}</span><span>{trC('att.rate')}</span><span>{trC('hrr.cost')}</span><span>{trC('hrr.share')}</span></div>
          {byDept.map((d) => (
            <div key={d.dept} className="hrr-dt-row">
              <span className="hrr-dt-name">{d.dept}</span>
              <span className="tnum">{d.count}</span>
              <span className="tnum" style={{ color: d.rate >= 90 ? 'var(--green-700)' : d.rate >= 80 ? 'var(--warn)' : 'var(--neg)' }}>{d.rate}%</span>
              <span className="tnum">{rpC(d.cost)}</span>
              <span className="hrr-dt-share"><span className="hrr-bar" style={{ width: 54 }}><span className="hrr-bar-fill" style={{ width: Math.round((d.cost / maxDept) * 100) + '%' }} /></span></span>
            </div>
          ))}
        </div>
      </div>

      {/* attention lists */}
      <div className="co-grid" style={{ marginTop: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{trC('hrr.topLate')}</div>
          {topLate.length === 0 ? <div className="ed-empty">{trC('hrr.none')}</div> : topLate.map(({ s, a }) => (
            <div key={s.id} className="hrr-emp-row"><span className="emp-av sm">{av(s)}</span><div style={{ flex: 1, minWidth: 0 }}><div className="hrr-emp-n">{s.name}</div><div className="hrr-emp-d">{s.dept} · {a.late}× {trC('att.late').toLowerCase()}</div></div><b className="tnum amt-neg">{a.lateMin}m · −{rpC(a.lateAmt)}</b></div>
          ))}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="sec-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{trC('hrr.topOt')}</div>
          {topOt.length === 0 ? <div className="ed-empty">{trC('hrr.none')}</div> : topOt.map(({ s, a }) => (
            <div key={s.id} className="hrr-emp-row"><span className="emp-av sm">{av(s)}</span><div style={{ flex: 1, minWidth: 0 }}><div className="hrr-emp-n">{s.name}</div><div className="hrr-emp-d">{s.dept}</div></div><b className="tnum amt-pos">{a.otHrs} {trC('hrr.hrs')} · +{rpC(a.otAmt)}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- THR (Holiday Allowance) ---------- */
/* ---------- THR slip (printable) ---------- */
function ThrSlip({ row, onClose }) {
  const { s, acc, thr } = row;
  const joined = row.joined || acc.joined;
  uEc(() => { document.body.classList.add('payslip-open'); const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => { document.body.classList.remove('payslip-open'); window.removeEventListener('keydown', o); }; }, []);
  const niceHol = (() => { const d = new Date((thr.holiday || joined) + 'T00:00'); return `${d.getDate()} ${PERIOD.mon(d.getMonth())} ${d.getFullYear()}`; })();
  return (
    <div className="modal-scrim payslip-overlay" onClick={onClose}>
      <div className="payslip-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ps-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Logo s={34} />
            <div><div style={{ fontFamily: 'Poppins', fontSize: 17, fontWeight: 800 }}>AirRO Reverse Osmosis</div><div style={{ fontSize: 12, color: 'var(--text-mut)' }}>{trC('thr.slipTitle')} · {niceHol}</div></div>
          </div>
          <div className="ps-actions"><button className="btn btn-ghost" onClick={() => window.print()}><IconDownload s={16} />{trC('hrd.print')}</button><button className="jp-icon no-print" onClick={onClose}><IconClose s={18} /></button></div>
        </div>
        <div className="ps-emp">
          <div><div className="ps-emp-name">{s.name}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)' }}>{s.pos || '—'} · {s.dept}</div></div>
          <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-mut)' }}>{trC('hrd.religion')}: <b>{s.religion || 'Islam'}</b><br />{trC('thr.joined')}: <b>{joined}</b></div>
        </div>
        <div className="ps-cols" style={{ gridTemplateColumns: '1fr' }}>
          <div className="ps-col">
            <div className="ps-col-title">{trC('thr.calcTitle')}</div>
            <div className="ps-row"><span>{trC('thr.basis')}</span><span className="tnum">{rpC(thr.monthly)}</span></div>
            <div className="ps-row"><span>{trC('thr.service')}</span><span className="tnum">{thr.months} {trC('thr.mo')}</span></div>
            <div className="ps-row"><span>{trC('thr.eligibility')}</span><span>{thr.months >= 12 ? trC('thr.fullx') : thr.eligible ? trC('thr.prorated', { p: Math.round(thr.ratio * 100) }) : trC('thr.notElig')}</span></div>
            <div className="ps-row"><span>{trC('thr.formula')}</span><span className="tnum">{thr.months >= 12 ? '1 × ' + rpC(thr.monthly) : thr.months + '/12 × ' + rpC(thr.monthly)}</span></div>
            {thr.share != null && thr.share !== 1 && <div className="ps-row"><span>{trC('thr.portion')}</span><span className="tnum">{Math.round(thr.share * 100)}% (× {rpC(thr.fullAmount)})</span></div>}
          </div>
        </div>
        <div className="ps-thp"><span>{trC('thr.amount')} (THR)</span><span className="tnum">{rpC(thr.amount)}</span></div>
        <div className="ps-foot">{trC('thr.note')}</div>
      </div>
    </div>
  );
}

function ThrScreen({ staff, rates, setRates, today, posted, onPost, canPost, canEdit }) {
  const [slip, setSlip] = uSc(null);
  const holidays = (rates && rates.holidayDates) || {};
  const shares = (rates && rates.holidayShare) || {};
  const shareOf = (rel) => { const v = shares[rel]; return v == null ? 1 : v; };
  const setHoliday = (rel, iso) => { if (setRates) setRates({ ...rates, holidayDates: { ...holidays, [rel]: iso } }); };
  const setShare = (rel, v) => { if (setRates) setRates({ ...rates, holidayShare: { ...shares, [rel]: v } }); };
  const refFor = (s) => holidays[s.religion || 'Islam'] || today;
  const rows = staff.map((s) => { const acc = CO.accountInfo(s); const joined = s.joinedDate || acc.joined; const ref = refFor(s); const t = HRD.thr(s, joined, ref); const sh = shareOf(s.religion || 'Islam'); t.holiday = ref; t.share = sh; t.fullAmount = t.amount; t.amount = Math.round(t.amount * sh); return { s, acc, joined, thr: t }; });
  const total = rows.reduce((a, r) => a + r.thr.amount, 0);
  const eligible = rows.filter((r) => r.thr.eligible).length;
  const fullMo = rows.filter((r) => r.thr.months >= 12).length;
  const niceRef = '' + new Date(today + 'T00:00').getFullYear();
  const av = (s) => s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const byRel = {};
  rows.forEach((r) => { const k = r.s.religion || 'Islam'; (byRel[k] = byRel[k] || { count: 0, amount: 0 }); byRel[k].count++; byRel[k].amount += r.thr.amount; });
  const monShort = (iso) => { const d = new Date(iso + 'T00:00'); return `${d.getDate()} ${PERIOD.mon(d.getMonth())}`; };

  const exportCSV = () => {
    const head = ['Employee', 'Department', 'Religion', 'Holiday date', 'Portion', 'Joined', 'Months of service', 'Eligibility', 'Monthly (base+allowance)', 'THR amount'];
    const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [head.join(',')];
    rows.forEach((r) => lines.push([esc(r.s.name), esc(r.s.dept), r.s.religion || 'Islam', r.thr.holiday, Math.round(r.thr.share * 100) + '%', r.joined, r.thr.months, r.thr.months >= 12 ? 'Full (1x)' : r.thr.eligible ? 'Prorated' : 'Not eligible', r.thr.monthly, r.thr.amount].join(',')));
    lines.push(['TOTAL', '', '', '', '', '', '', '', '', total].join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `AirRO-THR-${niceRef}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="screen-enter">
      <div className="hrr-head">
        <div className="thr-refpick"><IconCalendar s={17} style={{ color: 'var(--green-700)' }} /><span className="thr-reflabel">{trC('thr.byReligion')}</span></div>
        <div className="hrr-head-actions">
          <button className="btn btn-ghost" onClick={exportCSV}><IconDownload s={16} />{trC('hrr.csv')}</button>
          {canPost && <button className="btn btn-primary" onClick={() => onPost(total, niceRef)} disabled={total <= 0}><IconCoinOut s={16} />{posted ? trC('thr.reposted') : trC('thr.post')}</button>}
        </div>
      </div>

      {posted && <div className="payroll-status posted" style={{ marginBottom: 16 }}><span className="ps-ic"><IconCheck s={18} /></span><div style={{ flex: 1 }}><div className="ps-t">{trC('thr.postedT')}</div><div className="ps-s">{trC('thr.postedS', { amt: rpC(posted.amount), d: posted.date })}</div></div></div>}

      <div className="fin-stat-row">
        <div className="card stat-box dark"><div className="tnum" style={{ fontSize: 23, fontWeight: 800, color: '#fff' }}>{rpC(total)}</div><div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.7)', marginTop: 2 }}>{trC('thr.total')}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{niceRef}</div></div>
        <div className="card stat-box"><div className="tnum" style={{ fontSize: 23, fontWeight: 800 }}>{eligible}/{staff.length}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trC('thr.eligible')}</div></div>
        <div className="card stat-box"><div className="tnum" style={{ fontSize: 23, fontWeight: 800 }}>{fullMo}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trC('thr.full')}</div></div>
        <div className="card stat-box"><div className="tnum" style={{ fontSize: 23, fontWeight: 800 }}>{Object.keys(byRel).length}</div><div style={{ fontSize: 12.5, color: 'var(--text-mut)', marginTop: 2 }}>{trC('thr.religions')}</div></div>
      </div>

      <div className="thr-rel-chips">
        {Object.entries(byRel).map(([rel, v]) => (
          <div key={rel} className="thr-rel-chip">
            <div className="thr-rel-top"><span className="thr-rel-name">{rel}</span><span className="thr-rel-cnt">{v.count}</span></div>
            {canEdit ? <DP.DateField value={holidays[rel] || today} allowFuture onChange={(iso) => setHoliday(rel, iso)} />
              : <span className="thr-rel-meta">{monShort(holidays[rel] || today)}</span>}
            {canEdit
              ? <UI.Dropdown compact value={shareOf(rel)} options={[{ value: 1, label: trC('thr.full100') }, { value: 0.5, label: trC('thr.half50') }]} onChange={(val) => setShare(rel, val)} />
              : <span className="thr-rel-meta">{shareOf(rel) === 0.5 ? trC('thr.half50') : trC('thr.full100')}</span>}
            <span className="tnum thr-rel-amt">{rpC(v.amount)}</span>
          </div>
        ))}
      </div>

      <div className="card hrd-table-card" style={{ marginTop: 16 }}>
        <div className="hrd-table-scroll">
          <table className="hrd-table">
            <thead><tr><th className="hcell-name">{trC('hrd.cEmployee')}</th><th>{trC('hrd.religion')}</th><th>{trC('thr.holidayCol')}</th><th>{trC('thr.service')}</th><th>{trC('thr.eligibility')}</th><th>{trC('thr.amount')}</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ s, acc, thr }) => (
                <tr key={s.id}>
                  <td className="hcell-name"><div className="hemp"><span className="hemp-av">{av(s)}</span><div style={{ minWidth: 0 }}><div className="hemp-name">{s.name}</div><div className="hemp-pos">{s.dept}</div></div></div></td>
                  <td className="mut">{s.religion || 'Islam'}</td>
                  <td className="tnum mut">{monShort(thr.holiday)}</td>
                  <td className="tnum">{thr.months} {trC('thr.mo')}</td>
                  <td><span className={`pill ${thr.months >= 12 ? 'pill-pos' : thr.eligible ? 'pill-warn' : 'pill-neg'}`}>{thr.months >= 12 ? trC('thr.fullx') : thr.eligible ? trC('thr.prorated', { p: Math.round(thr.ratio * 100) }) : trC('thr.notElig')}{thr.share === 0.5 ? ' · ½' : ''}</span></td>
                  <td className="tnum strong">{rpC(thr.amount)}</td>
                  <td className="hcell-act"><button className="icon-btn" title={trC('thr.slip')} onClick={() => setSlip({ s, acc, thr })}><IconInvoice s={17} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="hcell-name" style={{ fontWeight: 700 }}>{trC('hrd.totalStaff', { n: staff.length })}</td><td></td><td></td><td></td><td></td><td className="tnum strong">{rpC(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="hrd-disclaimer"><IconShield s={15} /> {trC('thr.note')}</div>
      {slip && <ThrSlip row={slip} onClose={() => setSlip(null)} />}
    </div>
  );
}

/* ---------- HR Calendar (holidays / leave / permits) ---------- */
const CAL_COLORS = { holiday: 'var(--neg)', leave: 'var(--blue-700)', permit: 'var(--warn)' };
const PAD2 = (n) => String(n).padStart(2, '0');

function CalEventModal({ staff, today, onSave, onClose }) {
  const [type, setType] = uSc('permit');
  const [title, setTitle] = uSc('');
  const [employeeId, setEmployeeId] = uSc(staff[0] ? staff[0].id : '');
  const [startDate, setStart] = uSc(today);
  const [endDate, setEnd] = uSc('');
  const [note, setNote] = uSc('');
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const needEmp = type !== 'holiday';
  const valid = (title || '').trim() && startDate;
  const save = () => { if (!valid) return; onSave({ id: CO.newEventId(), type, title: title.trim(), employeeId: needEmp ? (employeeId || null) : null, startDate, endDate: endDate || '', note: note.trim(), createdAt: Date.now() }); };
  const typeOpts = [{ value: 'holiday', label: trC('cal.holiday') }, { value: 'leave', label: trC('cal.leave') }, { value: 'permit', label: trC('cal.permit') }];
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{trC('cal.add')}</div><button className="icon-btn" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="ed-acc-form" style={{ padding: '4px 2px' }}>
          <label className="ed-af"><span>{trC('cal.type')}</span><UI.Dropdown value={type} options={typeOpts} onChange={setType} /></label>
          <label className="ed-af"><span>{trC('cal.evTitle')}</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="—" /></label>
          {needEmp && <label className="ed-af ed-af-wide"><span>{trC('req.employee')}</span><UI.Dropdown value={employeeId} options={[{ value: '', label: '— ' + trC('cal.allEmp') + ' —' }, ...staff.map((s) => ({ value: s.id, label: s.name + ' · ' + s.dept }))]} onChange={setEmployeeId} /></label>}
          <label className="ed-af"><span>{trC('cal.start')}</span><DP.DateField value={startDate} allowFuture onChange={setStart} /></label>
          <label className="ed-af"><span>{trC('cal.end')}</span><DP.DateField value={endDate || ''} allowFuture onChange={setEnd} /></label>
          <label className="ed-af ed-af-wide"><span>{trC('cal.note')}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="—" /></label>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={save}>{trC('cal.save')}</button>
        </div>
      </div>
    </div>
  );
}

function HrCalendar({ staff, rates, events, setEvents, today, canEdit }) {
  const [view, setView] = uSc(() => { const d = new Date(today + 'T00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [addOpen, setAddOpen] = uSc(false);
  const { y, m } = view;
  const monKey = `${y}-${PAD2(m + 1)}`;
  const iso = (d) => `${y}-${PAD2(m + 1)}-${PAD2(d)}`;
  const step = (dir) => { let nm = m + dir, ny = y; if (nm < 0) { nm = 11; ny--; } if (nm > 11) { nm = 0; ny++; } setView({ y: ny, m: nm }); };
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startOff = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const staffName = (id) => { const s = staff.find((x) => x.id === id); return s ? s.name : trC('cal.allEmp'); };
  const WD = () => Array.from({ length: 7 }, (_, i) => (window.PERIOD ? PERIOD.dow(new Date(2024, 0, 1 + i)) : ''));
  const monLabel = window.PERIOD ? `${PERIOD.mon(m)} ${y}` : monKey;

  // National / religious holidays from HR rates → virtual events (not stored).
  const holidays = rates.holidayDates || {};
  const vHolidays = Object.entries(holidays).filter(([, d]) => d && d.slice(0, 7) === monKey).map(([rel, d]) => ({ id: 'h-' + rel, type: 'holiday', title: trC('cal.holidayFor', { r: rel }), startDate: d, endDate: d, _virtual: true }));
  // Stored events overlapping this month.
  const inMonth = (e) => { const s = e.startDate || '', en = e.endDate || e.startDate || ''; return s.slice(0, 7) === monKey || en.slice(0, 7) === monKey || (s <= `${monKey}-01` && en >= `${monKey}-31`); };
  const stored = (events || []).filter(inMonth);
  const monthEvents = [...vHolidays, ...stored].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  // date -> events map for the grid.
  const dayMap = {};
  const push = (date, ev) => { (dayMap[date] = dayMap[date] || []).push(ev); };
  monthEvents.forEach((e) => { const s = e.startDate, en = e.endDate || e.startDate; for (let d = 1; d <= daysInMonth; d++) { const ds = iso(d); if (ds >= s && ds <= en) push(ds, e); } });

  const cells = [];
  for (let i = 0; i < startOff; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const removeEv = (id) => { if (confirm(trC('cal.removeConfirm')) && setEvents) setEvents((prev) => (prev || []).filter((e) => e.id !== id)); };
  const saveEv = (ev) => { if (setEvents) setEvents((prev) => [...(prev || []).filter((e) => e.id !== ev.id), ev]); setAddOpen(false); };

  return (
    <div className="screen-enter">
      <div className="hrcal-head">
        <div className="month-nav period-nav">
          <button className="mn-arrow" onClick={() => step(-1)}><IconCaret s={16} style={{ transform: 'rotate(90deg)' }} /></button>
          <span className="hrcal-month">{monLabel}</span>
          <button className="mn-arrow" onClick={() => step(1)}><IconCaret s={16} style={{ transform: 'rotate(-90deg)' }} /></button>
        </div>
        <div className="hrcal-legend">
          {['holiday', 'leave', 'permit'].map((t) => <span key={t} className="hrcal-lg"><i style={{ background: CAL_COLORS[t] }} />{trC('cal.' + t)}</span>)}
        </div>
        {canEdit && <button className="btn btn-primary hrcal-add" onClick={() => setAddOpen(true)}><IconPlus s={16} />{trC('cal.add')}</button>}
      </div>

      <div className="card hrcal-card">
        <div className="hrcal-wd">{WD().map((w, i) => <span key={i}>{w}</span>)}</div>
        <div className="hrcal-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="hrcal-cell empty" />;
            const evs = dayMap[iso(d)] || [];
            const types = [...new Set(evs.map((e) => e.type))];
            return (
              <div key={i} className={`hrcal-cell ${iso(d) === today ? 'today' : ''} ${evs.length ? 'has-ev' : ''}`}>
                <span className="hrcal-dnum">{d}</span>
                <div className="hrcal-dots">{types.map((t) => <span key={t} className="hrcal-dot" style={{ background: CAL_COLORS[t] }} />)}</div>
                {evs[0] && <span className="hrcal-ev-mini" style={{ color: CAL_COLORS[evs[0].type] }}>{evs[0].employeeId ? staffName(evs[0].employeeId).split(' ')[0] : evs[0].title}{evs.length > 1 ? ` +${evs.length - 1}` : ''}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card hrcal-list">
        <div className="hrcal-list-t">{trC('cal.eventsIn', { m: monLabel })} · {monthEvents.length}</div>
        {monthEvents.length === 0 ? <div className="ed-empty">{trC('cal.none')}</div> : monthEvents.map((e) => (
          <div key={e.id} className="hrcal-ev">
            <span className="hrcal-ev-dot" style={{ background: CAL_COLORS[e.type] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hrcal-ev-t">{e.title}{e.employeeId ? <span className="hrcal-ev-emp"> · {staffName(e.employeeId)}</span> : ''}</div>
              <div className="hrcal-ev-s">{trC('cal.' + e.type)} · {e.startDate}{e.endDate && e.endDate !== e.startDate ? ` → ${e.endDate}` : ''}{e.sourceId ? ` · ${trC('cal.fromApproval')}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
            </div>
            {canEdit && !e._virtual && <button className="icon-btn del" title={trC('cal.remove')} onClick={() => removeEv(e.id)}><IconClose s={15} /></button>}
          </div>
        ))}
      </div>

      {addOpen && <CalEventModal staff={staff} today={today} onSave={saveEv} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

window.COMPANY = { CompanyDashboard, HeadcountAffordability, ApprovalsCard, EmployeeDirectory, EmployeeDetail, RollCall, HRReport, ThrScreen, ProjectsScreen, HrCalendar, OrientationScreen, OrientationSlip, KasbonScreen };

function projDueInfo(p) {
  if (p.status === 'done' || !p.due) return null;
  const today = new Date(FIN.TODAY + 'T00:00');
  const d = new Date(p.due + 'T00:00');
  const days = Math.round((d - today) / 86400000);
  if (days < 0) return { kind: 'overdue', days: -days };
  if (days <= 14) return { kind: 'soon', days };
  return { kind: 'ok', days };
}

function ProjectModal({ row, onSave, onClose }) {
  const [f, setF] = uSc(row);
  uEc(() => { const o = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', o); return () => window.removeEventListener('keydown', o); }, []);
  const set = (p) => setF({ ...f, ...p });
  const valid = f.name.trim();
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><div style={{ fontSize: 17, fontWeight: 700 }}>{f._new ? trC('pj.add') : trC('pj.edit')}</div><button className="jp-icon" onClick={onClose}><IconClose s={18} /></button></div>
        <div className="modal-body">
          <label className="fld-label" style={{ marginTop: 0 }}>{trC('pj.name')}</label>
          <input className="fld" value={f.name} placeholder={trC('pj.namePh')} onChange={(e) => set({ name: e.target.value })} />
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trC('pj.status')}</label>
              <UI.Dropdown value={f.status} options={['planning', 'building', 'hold', 'done'].map((s) => ({ value: s, label: CO.PROJ_STATUS[s].label }))} onChange={(v) => set({ status: v })} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><label className="fld-label" style={{ marginTop: 0 }}>{trC('pj.due')}</label>
              <DP.DateField value={f.due || FIN.TODAY} allowFuture onChange={(v) => set({ due: v })} /></div>
          </div>
          <label className="fld-label">{trC('pj.progress')}: {f.progress || 0}%</label>
          <input type="range" min="0" max="100" step="5" value={f.progress || 0} onChange={(e) => set({ progress: +e.target.value })} style={{ width: '100%', accentColor: 'var(--green-700)' }} />
          <label className="fld-label">{trC('pj.budget')}</label>
          <div className="amt-input" style={{ padding: '8px 13px' }}><span className="amt-rp" style={{ fontSize: 14 }}>Rp</span><input inputMode="numeric" style={{ fontSize: 16 }} value={f.budget ? (+f.budget).toLocaleString('id-ID') : ''} onChange={(e) => set({ budget: +e.target.value.replace(/\D/g, '') || 0 })} /></div>
          <label className="fld-label">{trC('pj.note')}</label>
          <input className="fld" value={f.note || ''} placeholder={trC('pj.notePh')} onChange={(e) => set({ note: e.target.value })} />
        </div>
        <div className="modal-foot">
          {!f._new && <button className="btn btn-ghost" style={{ color: 'var(--neg)', marginRight: 'auto' }} onClick={() => onSave(f, true)}><IconClose s={15} />{trC('pj.remove')}</button>}
          <button className="btn btn-ghost" onClick={onClose}>{trC('common.cancel') || 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(f)}>{trC('pj.save')}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectsScreen({ projects, setProjects, canEdit }) {
  const [edit, setEdit] = uSc(null);
  const active = projects.filter((p) => p.status !== 'done');
  const overdue = active.filter((p) => { const i = projDueInfo(p); return i && i.kind === 'overdue'; });
  const soon = active.filter((p) => { const i = projDueInfo(p); return i && i.kind === 'soon'; });
  const save = (p, remove) => {
    if (remove) { if (!confirm(trC('pj.removeConfirm'))) return; setProjects((x) => x.filter((y) => y.id !== p.id)); setEdit(null); return; }
    const clean = { ...p }; delete clean._new;
    setProjects((x) => x.find((y) => y.id === p.id) ? x.map((y) => y.id === p.id ? clean : y) : [...x, clean]);
    setEdit(null);
  };
  const addNew = () => setEdit({ id: CO.newProjId(), name: '', status: 'planning', progress: 0, budget: 0, due: FIN.TODAY, note: '', _new: true });
  const niceDate = (iso) => { const d = new Date(iso + 'T00:00'); return `${d.getDate()} ${PERIOD.mon(d.getMonth())} ${d.getFullYear()}`; };
  return (
    <div className="screen-enter">
      <div className="hrr-head">
        <div className="pj-reminders">
          {overdue.length > 0 && <span className="pj-rem over"><IconBell s={14} />{trC('pj.overdueN', { n: overdue.length })}</span>}
          {soon.length > 0 && <span className="pj-rem soon"><IconClock s={14} />{trC('pj.soonN', { n: soon.length })}</span>}
          {overdue.length === 0 && soon.length === 0 && <span className="pj-rem ok"><IconCheck s={14} />{trC('pj.onTrack')}</span>}
        </div>
        {canEdit && <button className="btn btn-primary" onClick={addNew}><IconPlus s={16} />{trC('pj.add')}</button>}
      </div>
      <div className="pj-grid">
        {projects.map((p) => {
          const st = CO.PROJ_STATUS[p.status] || CO.PROJ_STATUS.planning;
          const due = projDueInfo(p);
          return (
            <div key={p.id} className="card pj-card" onClick={() => canEdit && setEdit(p)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
              <div className="pj-card-top">
                <span className="pj-name">{p.name}</span>
                <span className="proj-status" style={{ color: st.color, background: st.color + '1a' }}>{st.label}</span>
              </div>
              <div className="pj-note">{p.note}</div>
              <div className="proj-barwrap"><div className="proj-bar" style={{ width: (p.progress || 0) + '%', background: st.color }} /></div>
              <div className="pj-card-foot">
                <span className="tnum">{p.progress || 0}%</span>
                <span className="tnum">{rpC(p.budget)}</span>
              </div>
              {p.due && (
                <div className={`pj-due ${due ? due.kind : 'done'}`}>
                  <IconCalendar s={13} />{niceDate(p.due)}
                  {due && due.kind === 'overdue' && <b> · {trC('pj.overdueDays', { n: due.days })}</b>}
                  {due && due.kind === 'soon' && <b> · {trC('pj.dueDays', { n: due.days })}</b>}
                  {p.status === 'done' && <b> · {CO.PROJ_STATUS.done.label}</b>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {edit && <ProjectModal row={edit} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  );
}
