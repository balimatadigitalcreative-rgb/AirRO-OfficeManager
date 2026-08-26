'use strict';
// SECURITY LINT (payslip-class guard). The payslip bug (fixed 21 Aug) derived AUTHORISATION from a
// request parameter instead of the session. This static check makes that whole bug class hard to
// reintroduce: it scans the trust boundary (controllers / middleware / routes) for any read of an
// IDENTITY field (userId / employeeId / customerId / fleetId / businessUnitId / unitId / …) out of
// req.query|body|params, and FAILS on any occurrence that is not on the reviewed allowlist below.
//
// Adding a new such read is not forbidden — but it forces a human decision, recorded here, that the
// value is a *filter* or *data parameter*, NEVER the identity an authorisation check trusts. The
// identity that gates access must always come from req.user (the verified session). If you land here
// because this test failed: confirm your new read is scope-enforced (threaded to req.user), then add
// it to ALLOW with a one-line reason — or fix it if it actually authorises off the request.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const IDENTITY = '(userId|employeeId|customerId|fleetId|businessUnitId|unitId|createdById|actorId|ownerId)';
const RE = new RegExp('req\\.(query|body|params)\\.' + IDENTITY, 'g');

// Reviewed & safe. Key = "<relative file>:<field>". Reason documents WHY it is not an authz identity.
const ALLOW = {
  // Accounting reports: businessUnitId/fleetId are FILTERS only — req.user is threaded through to the
  // service, which intersects the request filter with the caller's own unit/armada scope (scopeWhere).
  'controllers/accounting.controller.js:businessUnitId': 'filter, intersected with req.user scope in the service',
  'controllers/accounting.controller.js:fleetId': 'filter, intersected with req.user scope in the service',
  // NIP allocation: businessUnitId selects which NIP series to mint (a data parameter). The employee
  // create/edit path itself enforces unit write-access via assertCanAccessUnit — this read authorises nothing.
  'controllers/employee.controller.js:businessUnitId': 'data param (NIP series); write path enforces unit access',
  // User audit: req.query.userId names WHOSE audit trail to show (the admin target). Authorisation is the
  // manageUsers capability checked on req.user at the route — userId is a selector, not the authz identity.
  'controllers/user.controller.js:userId': 'admin target selector; gated by manageUsers cap on req.user',
};

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function scan(subdir) {
  const root = path.join(SRC, subdir);
  if (!fs.existsSync(root)) return [];
  const hits = [];
  for (const file of walk(root)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      let m;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) hits.push({ rel, field: m[2], line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

describe('authz-identity lint — no authorisation may trust a request-supplied identity', () => {
  it('every identity read at the controller/route boundary is on the reviewed allowlist', () => {
    const hits = [...scan('controllers'), ...scan('routes')];
    const unexpected = hits.filter((h) => !ALLOW[`${h.rel}:${h.field}`]);
    if (unexpected.length) {
      const msg = unexpected.map((h) => `  ${h.rel}:${h.line}  (req.*.${h.field})  ${h.text}`).join('\n');
      throw new Error(
        'Unreviewed request-supplied identity read(s) found. Each must be a FILTER or DATA PARAM ' +
        '(never the identity an authz check trusts) and scope-enforced via req.user, then allowlisted ' +
        'in tests/authz-identity-lint.test.js:\n' + msg
      );
    }
    expect(unexpected).toEqual([]);
  });

  it('auth middleware never derives identity from the request (only from req.user / the verified token)', () => {
    // requireAuth/requireCap/requireRole/requireUnit must read the session, not req.query|body|params.
    const hits = scan('middleware');
    expect(hits.map((h) => `${h.rel}:${h.line} ${h.text}`)).toEqual([]);
  });

  it('the allowlist itself stays reviewed — every entry still corresponds to a real read', () => {
    // Prevents the allowlist from rotting into stale exemptions that could mask a future real hit.
    const present = new Set([...scan('controllers'), ...scan('routes')].map((h) => `${h.rel}:${h.field}`));
    const stale = Object.keys(ALLOW).filter((k) => !present.has(k));
    expect(stale).toEqual([]);
  });
});
