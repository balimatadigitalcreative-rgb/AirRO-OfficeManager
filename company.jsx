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
  const aff = uMc(() => HRD.affordability(staff, rates, budget), [staff, rates, budget]);
  const [base, setBase] = uSc(3000000);
  const [allow, setAllow] = uSc(400000);
  const [risk, setRisk] = uSc('Low');
  const [jp, setJp] = uSc(true);
  const [editBudget, setEditBudget] = uSc(false);
  const sim = uMc(() => HRD.simulateHire(staff, rates, budget, { base, allowance: allow, risk, jp }), [staff, rates, budget, base, allow, risk, jp]);
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

function ApprovalsCard({ approvals, setApprovals, role, canSubmit, staff, compact, onApproveLeave, onApproveDeduction, onSubmitRequest }) {
  const [showNew, setShowNew] = uSc(false);
  const canActOn = (a) => role === 'gm' || a.routeTo === role;
  const inbox = approvals.filter((a) => canActOn(a) || a.requestedBy === role);
  const pending = inbox.filter((a) => a.status === 'pending' && canActOn(a));
  const act = (id, status) => {
    const item = approvals.find((a) => a.id === id);
    if (status === 'approved' && item) {
      if (item.type === 'leave' && onApproveLeave) onApproveLeave(item);
      if (item.type === 'deduction' && onApproveDeduction) onApproveDeduction(item);
    }
    setApprovals((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
  };
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
              {a.status === 'pending' ? (
                canActOn(a) ? (
                  <div className="appr-actions">
                    <button className="appr-btn ok" title={trC('co.approve')} onClick={() => act(a.id, 'approved')}><IconCheck s={15} /></button>
                    <button className="appr-btn no" title={trC('co.reject')} onClick={() => act(a.id, 'rejected')}><IconClose s={15} /></button>
                  </div>
                ) : <span className="pill pill-warn">{mine ? trC('req.waiting') : trC('co.pending')}</span>
              ) : (
                <span className={`pill ${a.status === 'approved' ? 'pill-pos' : 'pill-neg'}`}>{trC(a.status === 'approved' ? 'co.approved' : 'co.rejected')}</span>
              )}
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

function CompanyDashboard({ fin, staff, rates, budget, approvals, setApprovals, role, projects, setoran, onApproveLeave, onApproveDeduction, onSubmitRequest, userName }) {
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
        <ApprovalsCard approvals={approvals} setApprovals={setApprovals} role={role} canSubmit={false} staff={staff} onApproveLeave={onApproveLeave} onApproveDeduction={onApproveDeduction} onSubmitRequest={onSubmitRequest} compact />
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

/* ---------- Employee Detail ---------- */
function EmployeeDetail({ staff: staffProp, rates, monthKey, today, seeMoney, canEdit, canEditAtt, onEdit, onClose, onSyncDeduct, onSaveStaff, cashbons, setCashbons }) {
  const [staff, setStaffLocal] = uSc(staffProp);   // local copy so identity edits reflect immediately
  const [att, setAtt] = uSc(() => CO.attendance(staffProp, monthKey, today));
  const acc = uMc(() => CO.accountInfo(staffProp), [staffProp]);   // legacy fallback for fields not yet on the staff object
  const [identEdit, setIdentEdit] = uSc(false);
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
  const saveCashbon = (cb) => { CO.addCashbon(cb); if (setCashbons) setCashbons(CO.loadCashbons()); setKbAdd(false); };
  const cancelCashbon = (id) => { if (confirm(trC('co.kasbonCancelConfirm'))) { CO.updateCashbon(id, { status: 'cancelled' }); if (setCashbons) setCashbons(CO.loadCashbons()); } };
  // staff with auto late-penalty + overtime + this cycle's kasbon merged in
  const augStaff = uMc(() => {
    const manual = (staff.deductions || []).filter((d) => !d.auto);
    const extra = late.amount > 0 ? [{ id: 'auto-late', label: trC('co.lateDeduct'), amount: late.amount, auto: true }] : [];
    if (cycleTotal > 0) extra.push({ id: 'kasbon-cycle', label: 'Kasbon', amount: cycleTotal, auto: true, kasbon: true });
    return { ...staff, deductions: [...manual, ...extra], otPay: ot.amount };
  }, [staff, late, ot, cycleTotal]);
  const c = HRD.compute(augStaff, rates);
  // keep the roster in sync so payroll/payslip reflect late penalty + overtime
  uEc(() => { if (onSyncDeduct) onSyncDeduct(staff.id, late.amount, trC('co.lateDeduct'), ot.amount); }, [late.amount, ot.amount]);
  const setDay = (date, status, patch) => { CO.setAttDay(staff.id, monthKey, date, status, patch); setAtt(CO.attendance(staff, monthKey, today)); };
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
          {canEdit && onSaveStaff && <button className="btn btn-lime ed-editbtn" onClick={() => setIdentEdit(true)}><IconPencil s={15} />{trC('co.editData')}</button>}
          <button className="jp-icon" onClick={onClose}><IconClose s={18} /></button>
        </div>

        <div className="ed-body scroll-y">
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
              const timed = r.status === 'present' || r.status === 'late';
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
                      <UI.TimePicker compact value={r.in || '08:00'} onChange={(v) => setDay(r.date, r.status, { in: v, out: r.out })} />
                      <span className="ed-time-dash">–</span>
                      <UI.TimePicker compact value={r.out || '17:00'} onChange={(v) => setDay(r.date, r.status, { in: r.in, out: v })} />
                      <input className="ed-ot-input" inputMode="numeric" title={trC('att.otHours')} placeholder="0" value={r.ot || ''} onChange={(e) => setDay(r.date, r.status, { ot: +e.target.value.replace(/\D/g, '') || 0 })} />
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
        </div>
      </div>
    </div>
  );
}

/* ---------- Employee Directory ---------- */
function EmployeeDirectory({ staff, rates, monthKey, today, onEdit, onOpen, canEdit, seeMoney, setStaff }) {
  const [q, setQ] = uSc('');
  const [dept, setDept] = uSc('All');
  const [editing, setEditing] = uSc(null);
  const depts = ['All', ...HRD.DEPARTMENTS];
  // Writes to the SAME hrdStaff array → instantly visible in Payroll too.
  const saveStaff = (s) => {
    setStaff((prev) => { const clean = { ...s }; delete clean._isNew; return prev.find((x) => x.id === s.id) ? prev.map((x) => x.id === s.id ? clean : x) : [...prev, clean]; });
    setEditing(null);
  };
  const addStaff = () => setEditing(HRD.newStaff());
  let rows = staff;
  if (dept !== 'All') rows = rows.filter((s) => s.dept === dept);
  if (q) rows = rows.filter((s) => (s.name + (s.pos || '') + (s.dept || '')).toLowerCase().includes(q.toLowerCase()));
  const groups = {};
  rows.forEach((s) => { (groups[s.dept || 'Other'] = groups[s.dept || 'Other'] || []).push(s); });
  const order = [...HRD.DEPARTMENTS.filter((d) => groups[d]), ...Object.keys(groups).filter((d) => !HRD.DEPARTMENTS.includes(d))];
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
        {canEdit && setStaff && <button className="btn btn-primary emp-add-btn" onClick={addStaff}><IconPlus s={16} />{trC('hrd.addEmp')}</button>}
      </div>
      {order.length === 0 && <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-mut)' }}>{trC('entries.none')}</div>}
      {order.map((d) => (
        <div key={d} className="emp-dept">
          <div className="emp-dept-head"><span>{d}</span><span className="emp-dept-count">{groups[d].length}</span></div>
          <div className="emp-cards">
            {groups[d].map((s) => {
              const c = HRD.compute(s, rates);
              return (
                <div key={s.id} className="emp-card" onClick={() => onOpen(s)} style={{ cursor: 'pointer' }}>
                  <span className="emp-av" style={{ background: 'var(--mint-100)', color: 'var(--green-800)' }}>{s.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="emp-name">{s.name}</div>
                    <div className="emp-pos">{s.nip ? <span className="emp-nip">{s.nip}</span> : null}{s.nip ? ' · ' : ''}{s.pos || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {(+s.base > 0)
                      ? <><div className="tnum emp-thp">{rpC(c.takeHome)}</div><div className="emp-thp-l">{trC('hrd.cTakehome')}</div></>
                      : <div className="emp-thp-unset">{trC('co.salaryNotSet')}</div>}
                  </div>
                  {canEdit && setStaff && <button className="emp-card-edit" title={trC('co.editData')} onClick={(e) => { e.stopPropagation(); setEditing(s); }}><IconPencil s={15} /></button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {editing && <PAYROLL.StaffModal staff={editing} rates={rates} variant="identity" onSave={saveStaff} onClose={() => setEditing(null)} />}
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
function HRReport({ staff, rates, budget, monthKey, today, approvals, gran, anchor, setAnchor, range, periodLbl, setGran }) {
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
      return { s, a, c: HRD.compute(s, rates) };
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
    perEmp.forEach(({ s, a, c }) => { const d = (m[s.dept] = m[s.dept] || { count: 0, cost: 0, present: 0, wd: 0 }); d.count++; d.cost += c.companyCost; d.present += a.present + a.late; d.wd += a.workdays; });
    return HRD.DEPARTMENTS.filter((d) => m[d]).map((d) => ({ dept: d, ...m[d], rate: m[d].wd ? Math.round((m[d].present / m[d].wd) * 100) : 100 }));
  }, [perEmp]);
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

window.COMPANY = { CompanyDashboard, HeadcountAffordability, ApprovalsCard, EmployeeDirectory, EmployeeDetail, RollCall, HRReport, ThrScreen, ProjectsScreen };

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
