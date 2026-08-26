'use strict';
// REGRESSION — the dashboard "Total kas" must be the exact sum of the cash accounts listed above it.
// The bug: FS.acctBalance dumped every entry whose `acct` referenced a MISSING account onto accounts[0]
// (finance-store.js ids[0] fallback), so one account's balance — and therefore "Total kas" — was wrong,
// and the total could read SMALLER than a single listed account (real report: Rp19.605.336 while the
// three accounts summed to Rp163.808.664). Fix: stale-acct money is never dumped onto a real account; it
// surfaces as a separate "Belum dipetakan" (unattributed) line so the total = Σ(every line shown).
//
// finance-store.js is a browser IIFE (assigns window.FS). We load it with a minimal shim and exercise
// the pure balance functions — no DOM needed.
const fs = require('fs');
const path = require('path');

function loadFS() {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'finance-store.js'), 'utf8');
  const sandboxWindow = {};
  const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  // eslint-disable-next-line no-new-func — loading our own trusted source into an isolated function scope.
  new Function('window', 'localStorage', code)(sandboxWindow, localStorage);
  return sandboxWindow.FS;
}

const FS = loadFS();
const sumInflowMinusOutflow = (entries) => entries.reduce((s, e) => e.reference ? s : s + (e.type === 'income' ? e.amount : -e.amount), 0);

const accounts = [
  { id: 'a_cash', name: 'Cash', type: 'cash', opening: 0 },
  { id: 'a_bca', name: 'BCA', type: 'bank', opening: 0 },
  { id: 'a_mand', name: 'Mandiri', type: 'bank', opening: 0 },
];

describe('cash-book "Total kas" == Σ listed accounts (+ unattributed line)', () => {
  it('a stale-acct entry does NOT corrupt the first account', () => {
    const entries = [
      { type: 'income', amount: 91707000, acct: 'a_cash' },
      { type: 'income', amount: 72101664, acct: 'a_bca' },
      { type: 'expense', amount: 144203328, acct: 'GONE_legacy' },   // account deleted after this was posted
    ];
    // Cash keeps ONLY its own income — it is not silently charged the stale expense.
    expect(FS.acctBalance(accounts[0], entries, accounts, [])).toBe(91707000);
    expect(FS.acctBalance(accounts[1], entries, accounts, [])).toBe(72101664);
    // The stale money is surfaced, not hidden.
    expect(FS.unattributed(entries, accounts)).toBe(-144203328);
  });

  it('money is conserved: Σ(account balances) + unattributed == opening + Σ inflow − outflow', () => {
    const entries = [
      { type: 'income', amount: 91707000, acct: 'a_cash' },
      { type: 'income', amount: 72101664, acct: 'a_bca' },
      { type: 'expense', amount: 144203328, acct: 'GONE_legacy' },
      { type: 'income', amount: 5000000 },                 // blank acct → defaults to the primary account
    ];
    const perAccount = accounts.reduce((s, a) => s + FS.acctBalance(a, entries, accounts, []), 0);
    const grand = perAccount + FS.unattributed(entries, accounts);
    const openingTotal = accounts.reduce((s, a) => s + (+a.opening || 0), 0);
    expect(grand).toBe(openingTotal + sumInflowMinusOutflow(entries));
  });

  it('the displayed total equals the sum of exactly the lines shown (accounts + unattributed)', () => {
    const entries = [
      { type: 'income', amount: 91707000, acct: 'a_cash' },
      { type: 'income', amount: 72101664, acct: 'a_bca' },
      { type: 'expense', amount: 144203328, acct: 'GONE_legacy' },
    ];
    const rows = accounts.map((a) => FS.acctBalance(a, entries, accounts, []));   // what the card lists
    const unattr = FS.unattributed(entries, accounts);                            // the "Belum dipetakan" line
    const displayedTotal = rows.reduce((s, b) => s + b, 0) + unattr;
    // The total the user sees is the arithmetic sum of every line above it — never less than a listed account by surprise.
    expect(displayedTotal).toBe(91707000 + 72101664 + 0 + (-144203328));
    expect(displayedTotal).toBe(rows.reduce((s, b) => s + b, 0) + unattr);
  });

  it('a blank acct still defaults to the primary account (single-account convenience preserved)', () => {
    const entries = [{ type: 'income', amount: 1000000 }];   // no acct
    expect(FS.acctBalance(accounts[0], entries, accounts, [])).toBe(1000000);   // primary
    expect(FS.acctBalance(accounts[1], entries, accounts, [])).toBe(0);
    expect(FS.unattributed(entries, accounts)).toBe(0);      // blank is not "unattributed"
  });
});
