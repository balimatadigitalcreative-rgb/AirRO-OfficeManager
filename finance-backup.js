/* global React */
/* AirRO — Backup & Restore + CSV export. window.BACKUP */
(function () {
  const APP_VER = 'airro-1';
  // every key this app owns starts with "airro_" — back them all up generically (future-proof)
  function collect() {
    const out = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('airro_') === 0) out[k] = localStorage.getItem(k); } } catch (e) {}
    return out;
  }
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---- full JSON backup ----
  function exportAll() {
    const payload = { app: APP_VER, exportedAt: new Date().toISOString(), data: collect() };
    download(`AirRO-backup-${stamp()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  }

  // ---- restore from a JSON backup file ----
  function importAll(file, onResult) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const data = parsed && parsed.data;
        if (!data || typeof data !== 'object') throw new Error('format');
        const keys = Object.keys(data).filter((k) => k.indexOf('airro_') === 0);
        if (!keys.length) throw new Error('empty');
        // clear existing airro_ keys first so a restore is exact, not a merge
        const existing = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('airro_') === 0) existing.push(k); }
        existing.forEach((k) => localStorage.removeItem(k));
        keys.forEach((k) => { if (typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
        onResult && onResult({ ok: true, count: keys.length, when: parsed.exportedAt });
      } catch (e) {
        onResult && onResult({ ok: false, error: e.message });
      }
    };
    reader.onerror = () => onResult && onResult({ ok: false, error: 'read' });
    reader.readAsText(file);
  }

  // ---- CSV of all transactions ----
  function exportTxnsCSV(entries, accounts, catLabel) {
    const acctName = (id) => { const a = (accounts || []).find((x) => x.id === id); return a ? a.name : (id || ''); };
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['Date', 'Time', 'Type', 'Category', 'Account', 'Note', 'Amount (IDR)', 'Has proof'];
    const rows = (entries || []).slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const lines = [head.join(',')];
    rows.forEach((e) => {
      lines.push([
        e.date, e.time || '', e.type,
        esc(catLabel ? catLabel(e.category) : e.category),
        esc(acctName(e.acct)),
        esc(e.note),
        (e.type === 'expense' ? '-' : '') + (e.amount || 0),
        e.proof ? 'yes' : 'no',
      ].join(','));
    });
    download(`AirRO-transactions-${stamp()}.csv`, new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  }

  window.BACKUP = { exportAll, importAll, exportTxnsCSV };
})();
