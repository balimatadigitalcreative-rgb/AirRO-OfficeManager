/* AirRO Water — finance dataset (IDR). Plain JS, exposed on window. */
(function () {
  // Indonesian Rupiah formatting: dot thousands separator.
  const fmtFull = (n) => 'Rp\u00A0' + Math.round(Math.abs(n)).toLocaleString('id-ID');
  const fmtSigned = (n) => (n < 0 ? '-' : '+') + 'Rp\u00A0' + Math.round(Math.abs(n)).toLocaleString('id-ID');
  // Compact for chart axes: 250jt = 250 million
  const fmtCompact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a % 1e9 === 0 ? 0 : 1) + 'M';   // Miliar
    if (a >= 1e6) return Math.round(n / 1e6) + 'jt';                       // juta
    if (a >= 1e3) return Math.round(n / 1e3) + 'rb';
    return '' + n;
  };

  // ---- Headline numbers (this month: June 2026) ----
  const account = {
    name: 'AirRO Water',
    holder: 'Operating Account · BCA',
    balance: 412800000,
    number: '8420 1199 0034',
    exp: '08/29',
  };

  const kpis = {
    revenue: { label: 'Total Revenue', value: 248500000, delta: 5.2, dir: 'up' },
    expense: { label: 'Total Expense', value: 163200000, delta: 1.8, dir: 'down' },
    profit:  { label: 'Net Profit',    value: 85300000,  delta: 8.4, dir: 'up', margin: 34.3 },
  };

  // ---- Cashflow: trailing 12 months (Jul 2025 → Jun 2026), values in IDR ----
  const cashflow = [
    { m: 'Jul', rev: 189000000, exp: 138000000 },
    { m: 'Aug', rev: 201000000, exp: 144000000 },
    { m: 'Sep', rev: 176000000, exp: 131000000 },
    { m: 'Oct', rev: 214000000, exp: 149000000 },
    { m: 'Nov', rev: 232000000, exp: 155000000 },
    { m: 'Dec', rev: 261000000, exp: 168000000 },
    { m: 'Jan', rev: 198000000, exp: 142000000 },
    { m: 'Feb', rev: 187000000, exp: 134000000 },
    { m: 'Mar', rev: 221000000, exp: 150000000 },
    { m: 'Apr', rev: 209000000, exp: 146000000 },
    { m: 'May', rev: 236000000, exp: 158000000 },
    { m: 'Jun', rev: 248500000, exp: 163200000 },
  ];

  // ---- Expense breakdown (donut) — this month, total = 163,200,000 ----
  const expenseBreakdown = [
    { key: 'Salaries',    label: 'Salaries',         pct: 32, value: 52224000, icon: 'IconUsersGroup' },
    { key: 'Supplies',    label: 'Bottling',         pct: 26, value: 42432000, icon: 'IconDrop' },
    { key: 'Fuel',        label: 'Fuel & Delivery',  pct: 18, value: 29376000, icon: 'IconGas' },
    { key: 'Maintenance', label: 'Maintenance',      pct: 12, value: 19584000, icon: 'IconWrench' },
    { key: 'Utilities',   label: 'Utilities',        pct: 8,  value: 13056000, icon: 'IconBolt' },
    { key: 'Other',       label: 'Other',            pct: 4,  value: 6528000,  icon: 'IconDots' },
  ];

  // ---- Income breakdown (donut alt tab) — this month, total = 248,500,000 ----
  const incomeBreakdown = [
    { key: 'Refill',   label: 'Gallon Refills', pct: 62, value: 154070000, icon: 'IconDrop' },
    { key: 'Corp',     label: 'Corporate',      pct: 18, value: 44730000,  icon: 'IconStore' },
    { key: 'Deposit',  label: 'New Deposits',   pct: 12, value: 29820000,  icon: 'IconWallet' },
    { key: 'Disp',     label: 'Dispensers',     pct: 8,  value: 19880000,  icon: 'IconCoinIn' },
  ];

  // ---- Today's collection (was "Daily Limit") ----
  const todayCollection = { collected: 9850000, target: 12000000, orders: 64, gallons: 548 };

  // ---- Customer accounts (was "Saving Plans") — top accounts by outstanding balance ----
  const customers = [
    { name: 'RM Padang Sederhana', type: 'Restaurant',  icon: 'IconFork',  outstanding: 2400000, limit: 4000000, tier: 'Gold' },
    { name: 'Minimarket Cahaya',   type: 'Retail',      icon: 'IconStore', outstanding: 1800000, limit: 5000000, tier: 'Gold' },
    { name: 'Cafe Kopi Senja',     type: 'Restaurant',  icon: 'IconFork',  outstanding: 3250000, limit: 4500000, tier: 'Silver' },
    { name: 'Kost Putri Melati',   type: 'Residential', icon: 'IconHome',  outstanding: 640000,  limit: 2000000, tier: 'Silver' },
  ];
  const receivablesTotal = 18450000;

  // ---- Recent activity (right rail) ----
  const activity = {
    Today: [
      { who: 'Driver Andi', what: 'completed Route A-7 · 52 gallons delivered', t: '15:40' },
      { who: 'Warung Berkah Jaya', what: 'paid invoice #INV-2061 · Rp\u00A0360.000', t: '13:12' },
      { who: 'Kost Putri Melati', what: 'registered as a new customer', t: '10:05' },
    ],
    Yesterday: [
      { who: 'RO Unit 2', what: 'membrane filter replaced by technician', t: '17:20' },
      { who: 'PT Tirta Kemasan', what: 'supplier invoice settled · Rp\u00A04.250.000', t: '09:30' },
    ],
  };

  // ---- Recent transactions (dashboard mini-table, 5 rows) ----
  const recentTx = [
    { name: 'Gallon Refill — Bulk',   cat: 'Sales',       date: '2026-06-04', time: '14:28', amt: 1800000,  note: '100 × Galon 19L — Minimarket Cahaya', status: 'Completed' },
    { name: 'Fuel — Delivery Fleet',  cat: 'Fuel',        date: '2026-06-04', time: '08:15', amt: -350000,   note: 'Pertamina · 2 delivery trucks',       status: 'Completed' },
    { name: 'Gallon Refill',          cat: 'Sales',       date: '2026-06-03', time: '16:40', amt: 540000,    note: '30 × Galon 19L — RM Padang Sederhana', status: 'Pending' },
    { name: 'Empty Gallons Restock',  cat: 'Supplies',    date: '2026-06-03', time: '10:02', amt: -4250000,  note: 'PT Tirta Kemasan · 250 bottles',       status: 'Completed' },
    { name: 'RO Membrane Service',    cat: 'Maintenance', date: '2026-06-02', time: '11:30', amt: -1650000,  note: 'Filter replacement — Unit 2',          status: 'Failed' },
  ];

  // ---- Full transactions ledger (Transactions screen) ----
  const cats = {
    Sales:       { icon: 'IconDrop',  color: 'pos' },
    Fuel:        { icon: 'IconGas',   color: 'neg' },
    Supplies:    { icon: 'IconStore', color: 'neg' },
    Salaries:    { icon: 'IconUsersGroup', color: 'neg' },
    Maintenance: { icon: 'IconWrench', color: 'neg' },
    Utilities:   { icon: 'IconBolt',  color: 'neg' },
    Rent:        { icon: 'IconHome',  color: 'neg' },
    Deposit:     { icon: 'IconWallet', color: 'pos' },
  };

  const pay = ['Cash', 'Transfer BCA', 'QRIS', 'Transfer BRI', 'Transfer Mandiri'];
  const ledger = [
    { name: 'Gallon Refill — Bulk',     cat: 'Sales',       party: 'Minimarket Cahaya',     method: 'Transfer BCA',     id: 'TRX-206104', date: '2026-06-04', time: '14:28', amt: 1800000,  note: '100 × Galon 19L restock',           status: 'Completed' },
    { name: 'Fuel — Delivery Fleet',    cat: 'Fuel',        party: 'Pertamina',             method: 'Cash',             id: 'TRX-206103', date: '2026-06-04', time: '08:15', amt: -350000,   note: 'Solar · 2 delivery trucks',         status: 'Completed' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'RM Padang Sederhana',   method: 'QRIS',             id: 'TRX-206102', date: '2026-06-03', time: '16:40', amt: 540000,    note: '30 × Galon 19L',                    status: 'Pending' },
    { name: 'Empty Gallons Restock',    cat: 'Supplies',    party: 'PT Tirta Kemasan',      method: 'Transfer BCA',     id: 'TRX-206101', date: '2026-06-03', time: '10:02', amt: -4250000,  note: '250 empty bottles + caps',          status: 'Completed' },
    { name: 'RO Membrane Service',      cat: 'Maintenance', party: 'CV Aqua Teknik',        method: 'Transfer Mandiri', id: 'TRX-206011', date: '2026-06-02', time: '11:30', amt: -1650000,  note: 'Filter replacement — Unit 2',       status: 'Failed' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'Cafe Kopi Senja',       method: 'QRIS',             id: 'TRX-206010', date: '2026-06-02', time: '09:18', amt: 432000,    note: '24 × Galon 19L',                    status: 'Completed' },
    { name: 'New Gallon Deposit',       cat: 'Deposit',     party: 'Ibu Sari Wijaya',       method: 'Cash',             id: 'TRX-206009', date: '2026-06-01', time: '15:05', amt: 50000,     note: 'Deposit 1 galon kosong',            status: 'Completed' },
    { name: 'Staff Payroll — May',      cat: 'Salaries',    party: 'Payroll Run',           method: 'Transfer BCA',     id: 'TRX-205931', date: '2026-06-01', time: '07:00', amt: -12500000, note: '6 staff · monthly wages',           status: 'Completed' },
    { name: 'Electricity (PLN)',        cat: 'Utilities',   party: 'PLN',                   method: 'Transfer BRI',     id: 'TRX-205930', date: '2026-05-31', time: '13:44', amt: -2850000,  note: 'RO plant — May usage',              status: 'Completed' },
    { name: 'Gallon Refill — Bulk',     cat: 'Sales',       party: 'Kantin Sekolah Tunas',  method: 'Transfer BCA',     id: 'TRX-205929', date: '2026-05-31', time: '10:20', amt: 1260000,   note: '70 × Galon 19L',                    status: 'Completed' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'Warung Berkah Jaya',    method: 'Cash',             id: 'TRX-205928', date: '2026-05-30', time: '16:55', amt: 360000,    note: '20 × Galon 19L',                    status: 'Completed' },
    { name: 'Depot Rent — June',        cat: 'Rent',        party: 'H. Sulaiman',           method: 'Transfer BCA',     id: 'TRX-205927', date: '2026-05-30', time: '09:00', amt: -6000000,  note: 'Monthly depot lease',               status: 'Pending' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'Bu Rina Catering',      method: 'QRIS',             id: 'TRX-205926', date: '2026-05-29', time: '14:10', amt: 720000,    note: '40 × Galon 19L',                    status: 'Completed' },
    { name: 'Caps & Seals Restock',     cat: 'Supplies',    party: 'Toko Plastik Jaya',     method: 'Cash',             id: 'TRX-205925', date: '2026-05-29', time: '11:02', amt: -880000,   note: '5.000 tutup + segel galon',         status: 'Completed' },
    { name: 'Dispenser Sale',           cat: 'Deposit',     party: 'Pak Budi Santoso',      method: 'Transfer BRI',     id: 'TRX-205924', date: '2026-05-28', time: '15:30', amt: 385000,    note: 'Dispenser galon bawah',             status: 'Completed' },
    { name: 'Fuel — Delivery Fleet',    cat: 'Fuel',        party: 'Pertamina',             method: 'Cash',             id: 'TRX-205923', date: '2026-05-28', time: '07:50', amt: -300000,   note: 'Solar · route B',                   status: 'Completed' },
    { name: 'Gallon Refill — Bulk',     cat: 'Sales',       party: 'Toko Sumber Rejeki',    method: 'Transfer Mandiri', id: 'TRX-205922', date: '2026-05-27', time: '13:25', amt: 990000,    note: '55 × Galon 19L',                    status: 'Completed' },
    { name: 'RO Filter Cartridge',      cat: 'Maintenance', party: 'CV Aqua Teknik',        method: 'Transfer BCA',     id: 'TRX-205921', date: '2026-05-27', time: '10:40', amt: -1200000,  note: 'Sediment + carbon set',             status: 'Completed' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'Apotek Sehat',          method: 'QRIS',             id: 'TRX-205920', date: '2026-05-26', time: '12:15', amt: 270000,    note: '15 × Galon 19L',                    status: 'Completed' },
    { name: 'Water Test — Lab',         cat: 'Maintenance', party: 'Labkesda',              method: 'Transfer BCA',     id: 'TRX-205919', date: '2026-05-26', time: '09:30', amt: -650000,   note: 'Monthly quality certification',     status: 'Pending' },
    { name: 'Gallon Refill — Bulk',     cat: 'Sales',       party: 'Warteg Bahari',         method: 'Cash',             id: 'TRX-205918', date: '2026-05-25', time: '17:00', amt: 648000,    note: '36 × Galon 19L',                    status: 'Completed' },
    { name: 'Internet & Phone',         cat: 'Utilities',   party: 'Telkom',                method: 'Transfer BCA',     id: 'TRX-205917', date: '2026-05-25', time: '11:11', amt: -420000,   note: 'Depot office line',                 status: 'Completed' },
    { name: 'Gallon Refill',            cat: 'Sales',       party: 'Ibu Sari Wijaya',       method: 'Cash',             id: 'TRX-205916', date: '2026-05-24', time: '16:20', amt: 90000,     note: '5 × Galon 19L — home delivery',     status: 'Completed' },
    { name: 'Truck Service',            cat: 'Maintenance', party: 'Bengkel Lancar',        method: 'Cash',             id: 'TRX-205915', date: '2026-05-24', time: '08:40', amt: -1450000,  note: 'Oli + rem truk pengiriman',         status: 'Completed' },
  ];

  window.AIRRO = {
    fmtFull, fmtSigned, fmtCompact,
    account, kpis, cashflow, expenseBreakdown, incomeBreakdown,
    todayCollection, customers, receivablesTotal, activity, recentTx,
    cats, ledger, pay,
    statTotals: { Income: 248500000, Expense: 163200000 },
  };
})();
