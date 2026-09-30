'use strict';
/*
 * RUTE RIT on screen: the Pengiriman board plans the open rit from the warehouse, and the zone map
 * sets the warehouse. Static checks of the browser code (the server side is rit-route.test.js); the
 * files are also parsed so a JSX slip fails here, not in the build.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const api = read('api.js');
const board = (() => { const s = read('distribution.jsx'); const a = s.indexOf('function DistDeliveries('); return s.slice(a, s.indexOf('function CloseoutModal(', a)); })();
const zones = read('dist-zones.jsx');
const i18n = read('finance-i18n.js');

describe('api', () => {
  it('has the rit route and the warehouse setter', () => {
    expect(api).toMatch(/ritRoute: \(o\) =>[^\n]*'\/distribusi\/deliveries\/rit-route\?'/);
    expect(api).toMatch(/setDepot: \(lat, lng\) => req\('PUT', '\/distribusi\/depot', \{ lat, lng \}\)/);
  });
});

describe('Pengiriman board', () => {
  it('offers "Rute rit" only for one armada with an open rit, and otherwise says why', () => {
    expect(board).toMatch(/trD\('dist\.ritRoute'\)/);
    expect(board).toMatch(/const ritRun = closeFleet \? openRuns\.find\(\(r\) => r\.fleetId === closeFleet\) : null;/);
    expect(board).toMatch(/disabled=\{routeBusy \|\| !ritRun\}/);
    expect(board).toMatch(/title=\{!closeFleet \? trD\('dist\.ritPickFleet'\) : !ritRun \? trD\('dist\.ritNeedRun'\) : ''\}/);
  });
  it('shows the rit summary, the load left after each stop, and what waits for the next rit', () => {
    expect(board).toMatch(/trD\('dist\.ritSummary'/);
    expect(board).toMatch(/trD\('dist\.ritLeg'/);
    expect(board).toMatch(/trD\('dist\.ritNext'/);
    expect(board).toMatch(/trD\('dist\.ritTooBig'/);
  });
  it('while a rit plan is shown, the proximity-only bits stay out of the way', () => {
    // "dari depot (posisi Anda tidak tersedia)" describes a phone-position fallback — for a rit, starting
    // at the warehouse is the point; and "Mulai dari titik terjauh" would silently throw the rit plan away.
    expect(board).toMatch(/\{!ritMeta && <span className="dist-route-origin">/);
    expect(board).toMatch(/\{routeOn && !ritMeta && <button type="button" className="btn btn-ghost" disabled=\{routeBusy\} onClick=\{\(\) => routeFromMe\(/);
  });
  it('the rit order survives background refreshes like a proximity route does', () => {
    expect(board).toMatch(/routeIds\.current = next\.map\(\(x\) => x\.id\);[\s\S]{0,80}setRitMeta/);
  });
});

describe('zone map', () => {
  it('shows the warehouse and lets a manager set it', () => {
    expect(zones).toMatch(/data\.depot/);
    expect(zones).toMatch(/zn-depot/);
    expect(zones).toMatch(/window\.API\.distribusi\.setDepot\(/);
    expect(zones).toMatch(/trD\('zn\.depotSet'\)/);
  });
});

describe('strings and syntax', () => {
  it('every new key exists in both languages', () => {
    ['dist.ritRoute', 'dist.ritNeedRun', 'dist.ritPickFleet', 'dist.ritSummary', 'dist.ritLeg', 'dist.ritNext', 'dist.ritTooBig', 'zn.depotSet', 'zn.depotHint', 'zn.depotSave', 'zn.depotSaved', 'zn.depot'].forEach((k) => {
      expect((i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length).toBe(2);
    });
  });
  it('the edited screens parse', () => {
    ['distribution.jsx', 'dist-zones.jsx'].forEach((f) => expect(() => parse(read(f), { sourceType: 'script', plugins: ['jsx'] })).not.toThrow());
  });
});
