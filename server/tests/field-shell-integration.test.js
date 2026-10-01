'use strict';
// The shell decides old vs new with FIELDAPI.prefState only; an account without demo access sees the
// old board exactly as before (no card, no new UI); the rules screen has its own nav entry for owner/GM.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const shell = fs.readFileSync(path.join(root, 'finance-shell.jsx'), 'utf8');
const users = fs.readFileSync(path.join(root, 'finance-users.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'finance.css'), 'utf8');

it('parses', () => { expect(() => parse(shell, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow(); });
it('an account that may use the field view gets it FULL SCREEN (no app bar, no unit banner); the rules screen stays in the app', () => {
  expect(shell).toMatch(/const fieldPref = window\.FIELDAPI \? window\.FIELDAPI\.prefState\(\{ perms: p, rules: fieldRules, prefs: fieldPrefs \}\)/);
  expect(shell).toMatch(/const fieldFull = !!\(window\.FIELD && p\.distribusiPengiriman && fieldPref\.eligible && fieldPref\.ui === 'new' && screen !== 'dist-field-rules'\);/);
  const early = shell.indexOf('if (fieldFull) return (');
  expect(early).toBeGreaterThan(-1);
  expect(early).toBeLessThan(shell.indexOf('<div className="app">'));
  expect(shell).toMatch(/onExit=\{\(\) => \{ setFieldPref\(\{ ui: 'old' \}\); go\('dist-deliveries'\); \}\}/);
  expect(shell).not.toMatch(/screen === 'dist-deliveries' && p\.distribusiPengiriman && fieldPref\.ui === 'new' && window\.FIELD && \(/);
  expect(shell).toMatch(/\{fieldPref\.eligible && <div className="fld-try"/);
});
it('the old board keeps every prop it had', () => {
  const block = shell.slice(shell.indexOf('<DIST.Deliveries'), shell.indexOf('/>', shell.indexOf('<DIST.Deliveries')));
  ['refreshKey={distTick}', 'canOrder={!!p.distribusiOrder}', 'canRoute={!!p.distribusiRute}', 'canKoreksi={!!p.distribusiKoreksi}', 'canBelumTerkirim={!!p.distribusiBelumTerkirim}', 'canGps={!!p.distribusiLacakArmada}', 'canGpsMap={!!p.settings}', 'canLoc={!!p.distribusiLokasiSimpan}', 'setDistFleet={setDistFleet}', 'onChanged={() => setDistTick((t) => t + 1)}']
    .forEach((prop) => expect(block).toContain(prop));
});
it('field rules are refetched only on a rules change, not on every distribusi event (no request storm)', () => {
  expect(shell).toMatch(/evt\.entity === 'distribusi' && evt\.action === 'rules'\) setFieldRulesTick\(/);
  expect(shell).toMatch(/\}, \[user, p\.distribusiPengiriman, fieldRulesTick\]\);/);
});
it('rules nav + screen for owner/GM; release button for the owner only', () => {
  expect(shell).toMatch(/\{ id: 'dist-field-rules', label: tr\('nav\.distFieldRules'\), icon: 'IconSettings', caps: \['distribusiAturanLapangan'\] \}/);
  expect(shell).toMatch(/screen === 'dist-field-rules' && p\.distribusiAturanLapangan && window\.FIELD && <window\.FIELD\.RulesScreen[^>]*canRelease=\{!!user && user\.role === 'owner'\}/);
  expect(shell).toMatch(/'dist-zones', 'dist-field-rules'\]\.includes\(screen\)/);
});
it('the rules cap is in the permission editor; withdrawn has a badge colour', () => {
  expect(users).toMatch(/\['distribusiAturanLapangan', 'distribusi', /);
  expect(css).toMatch(/\.cr-status\.withdrawn \{/);
});

it('the field UI receives the user\'s caps (to show only the actions they may use)', () => {
  expect(shell).toMatch(/<window\.FIELD\.App user=\{user\} perms=\{p\} pref=\{fieldPref\}/);
});

it('Plan 3C: after release the board card no longer calls the field view a demo', () => {
  expect(shell).toMatch(/\{tr\(fieldPref\.released \? 'fld\.fieldView' : 'fld\.tryNew'\)\}/);
  expect(shell).toMatch(/\{tr\(fieldPref\.released \? 'fld\.fieldViewSub' : 'fld\.tryNewSub'\)\}/);
});
