/* global React, FS */
const { useState: uSal, useEffect: uEal } = React;
const trAl = (k, v) => window.t(k, v);
function Ial(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

// Build the alert list from current data + thresholds. fmt = currency formatter.
function computeAlerts({ entries, balance, monthIncome, monthExpense, month, thresholds, fmt, lang }) {
  const P = (en, id) => (lang === 'id' ? id : en);
  const out = [];
  if (balance < thresholds.lowCash) {
    out.push({ id: 'lowcash', level: 'high', icon: 'IconWallet', title: P('Low cash balance', 'Saldo kas rendah'),
      msg: P(`Balance ${fmt(balance)} is below your ${fmt(thresholds.lowCash)} safety threshold.`,
        `Saldo ${fmt(balance)} di bawah ambang aman ${fmt(thresholds.lowCash)}.`) });
  }
  const big = entries.filter((e) => e.type === 'expense' && e.date.startsWith(month) && e.amount >= thresholds.bigExpense)
    .sort((a, b) => b.amount - a.amount);
  if (big.length) {
    out.push({ id: 'bigexp', level: 'warn', icon: 'IconCoinOut',
      title: P(`${big.length} large expense${big.length > 1 ? 's' : ''} this month`, `${big.length} pengeluaran besar bulan ini`),
      msg: P(`Over ${fmt(thresholds.bigExpense)} each — largest is ${fmt(big[0].amount)} (${big[0].note}).`,
        `Di atas ${fmt(thresholds.bigExpense)} per item — terbesar ${fmt(big[0].amount)} (${big[0].note}).`) });
  }
  if (monthIncome > 0 && monthExpense / monthIncome > 0.8) {
    out.push({ id: 'ratio', level: 'warn', icon: 'IconTrendDown', title: P('Expenses running high', 'Pengeluaran tinggi'),
      msg: P(`Expenses are ${Math.round((monthExpense / monthIncome) * 100)}% of income this month.`,
        `Pengeluaran ${Math.round((monthExpense / monthIncome) * 100)}% dari pemasukan bulan ini.`) });
  }
  return out;
}

function AlertBell({ alerts }) {
  const [open, setOpen] = uSal(false);
  const high = alerts.some((a) => a.level === 'high');
  return (
    <div className="alert-wrap" tabIndex={0} onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <button className="icon-circle" onClick={() => setOpen((o) => !o)} title="Alerts">
        <IconBell s={20} />
        {alerts.length > 0 && <span className={`alert-count ${high ? 'high' : ''}`}>{alerts.length}</span>}
      </button>
      {open && (
        <div className="alert-menu">
          <div className="alert-menu-head">{trAl('al.title')} {alerts.length > 0 && <span className="tnum">({alerts.length})</span>}</div>
          {alerts.length === 0 && <div className="alert-empty"><IconCheck s={16} />{trAl('al.allgood')}</div>}
          {alerts.map((a) => (
            <div key={a.id} className={`alert-item ${a.level}`}>
              <span className="alert-ic">{Ial(a.icon, { s: 18 })}</span>
              <div style={{ minWidth: 0 }}>
                <div className="alert-title">{a.title}</div>
                <div className="alert-msg">{a.msg}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertBanner({ alerts, onView }) {
  const high = alerts.find((a) => a.level === 'high');
  if (!high) return null;
  return (
    <div className="alert-banner">
      <span className="alert-ic">{Ial(high.icon, { s: 19 })}</span>
      <div style={{ flex: 1, minWidth: 0 }}><b>{high.title}</b> — {high.msg}</div>
    </div>
  );
}

window.ALERTS = { computeAlerts, AlertBell, AlertBanner };
