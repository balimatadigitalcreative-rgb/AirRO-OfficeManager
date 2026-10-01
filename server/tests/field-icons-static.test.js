'use strict';
// MOCKUP ICONS (static): the 45 stroke icons of the approved mockup, drawn as React elements (no HTML
// injection), shipped before the kit so every field screen can use them.
const fs = require('fs'); const path = require('path'); const { parse } = require('@babel/parser');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('dist-field-icons.jsx'); const build = read('build.mjs');

it('parses, ships right before the kit, never injects HTML', () => {
  expect(() => parse(src, { sourceType: 'script', plugins: ['jsx'] })).not.toThrow();
  expect(build).toMatch(/'dist-field-icons\.jsx',\s*'dist-field-kit\.jsx',/);
  expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
});
it('has the 45 mockup icons, each only path/circle/rect parts', () => {
  const start = src.indexOf('const FLD_ICONS = {'); const end = src.indexOf('\n};', start);
  const body = src.slice(start + 'const FLD_ICONS = '.length, end + 2);
  const icons = JSON.parse(body.replace(/^\s*([a-zA-Z]+):/gm, '"$1":').replace(/,\s*}$/, '}'));
  expect(Object.keys(icons).length).toBe(45);
  ['truck', 'map', 'users', 'clipboard', 'plus', 'route', 'dots', 'back', 'close', 'chevron', 'camera', 'navigate', 'check', 'warn', 'search', 'phone', 'wa'].forEach((n) => expect(icons[n]).toBeTruthy());
  Object.values(icons).forEach((parts) => parts.forEach(([tag]) => expect(['path', 'circle', 'rect']).toContain(tag)));
});
