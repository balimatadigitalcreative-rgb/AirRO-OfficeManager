/* global React, FS */
const { useState: uSe, useEffect: uEe } = React;
function IcE(name, props) { const C = window[name]; return C ? <C {...props} /> : null; }

function EntryModal({ entry, incomeCats, expenseCats, onSave, onClose }) {
  const [type, setType] = uSe(entry.type);
  const [amount, setAmount] = uSe(entry.amount);
  const [cat, setCat] = uSe(entry.category);
  const [date, setDate] = uSe(entry.date);
  const [note, setNote] = uSe(entry.note);
  const [proof, setProof] = uSe(entry.proof || null);
  const [gallonQty, setGallonQty] = uSe(entry.gallonQty || 0);   // "Pembelian Galon" stock qty (expense only)
  const cats = type === 'income' ? incomeCats : expenseCats;
  const accent = type === 'income' ? '#065489' : '#E5484D';

  uEe(() => { if (!cats.find((c) => c.key === cat)) setCat(cats[0] && cats[0].key); }, [type]);
  uEe(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label = (k) => { const c = cats.find((x) => x.key === k); return c ? c.label : k; };
  const save = () => {
    if (!amount || amount <= 0) return;
    onSave({ ...entry, type, category: cat, amount, date, note: note.trim() || label(cat), proof, gallonQty: type === 'expense' ? Math.max(0, +gallonQty || 0) : 0 });
  };
  const disp = amount ? amount.toLocaleString('id-ID') : '';

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Edit Entry</div>
            <div className="tnum" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{entry.id}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IconClose s={18} /></button>
        </div>

        <div className="type-toggle">
          <button className={`tt-btn ${type === 'income' ? 'on inc' : ''}`} onClick={() => setType('income')}><IconCoinIn s={17} />Income</button>
          <button className={`tt-btn ${type === 'expense' ? 'on exp' : ''}`} onClick={() => setType('expense')}><IconCoinOut s={17} />Expense</button>
        </div>

        <label className="fld-label">Amount</label>
        <div className="amt-input" style={{ borderColor: accent }}>
          <span className="amt-rp">Rp</span>
          <input inputMode="numeric" value={disp} placeholder="0" style={{ fontSize: 26 }}
            onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || 0)} autoFocus />
        </div>

        <label className="fld-label">Category</label>
        <div className="cat-chips">
          {cats.map((c) => (
            <button key={c.key} className={`cat-chip ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
              {IcE(c.icon, { s: 15 })}{c.label}
            </button>
          ))}
        </div>

        {type === 'expense' && (
          <div className="gal-buy">
            <label className="fld-label" style={{ marginTop: 14 }}>{(window.t && window.t('ce.gallonQty')) || 'Pembelian Galon (jumlah)'}</label>
            <div className="gal-buy-row">
              <span className="gal-buy-ic">{IcE('IconDrop', { s: 16 })}</span>
              <input className="fld tnum" inputMode="numeric" value={gallonQty ? String(gallonQty) : ''} placeholder="0" onChange={(e) => setGallonQty(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))} />
              <span className="gal-buy-unit">{(window.t && window.t('ce.gallonUnit')) || 'galon'}</span>
            </div>
            <div className="gal-buy-hint">{(window.t && window.t('ce.gallonHint')) || 'Isi bila ini pembelian stok galon → menambah stok depot (bisa ditelusuri).'}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '0 0 150px' }}>
            <label className="fld-label">Date</label>
            <DP.DateField value={date} max={FIN.TODAY} onChange={setDate} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="fld-label">Note</label>
            <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <label className="fld-label">{(window.t && window.t('att.proof')) || 'Proof'}</label>
        <UI.FileAttach value={proof} onChange={setProof} />

        <div className="modal-foot">
          <button className="btn btn-ghost" style={{ height: 44 }} onClick={onClose}>Cancel</button>
          <button className="btn" style={{ height: 44, background: accent, color: '#fff', flex: 1 }} disabled={!amount} onClick={save}>
            <IconCheck s={17} />Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

window.EDIT = { EntryModal };
