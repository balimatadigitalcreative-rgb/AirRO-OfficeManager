'use strict';
/*
 * FLEET SCOPE - the ONE definition of "which armadas may this session see".
 *
 * THE CONVENTION, stated once because every guard depends on it:
 *   'all' / '' / null / unparseable  ->  UNRESTRICTED. The resolver returns null, meaning every fleet.
 *                                       The COLUMN is a non-null String defaulting to 'all', so that is
 *                                       what owner, GM and back office actually carry; the other forms
 *                                       are accepted because the token can be older than the column.
 *   ["Biru"]                         ->  restricted to exactly those fleets.
 *   []                               ->  restricted to NOTHING. An explicit empty array is a real
 *                                       state (a user whose access was cleared), not a synonym for
 *                                       "all", and it must render as "no access" rather than "all
 *                                       access". This is the distinction a `!scope.length` shortcut
 *                                       would quietly get wrong.
 *
 * It lives in lib/ because distribution and vehicle tracking must not drift apart: the whole point of
 * scoping tracking is that a driver sees the same fleets here as everywhere else. It reads ONLY the
 * session (the JWT payload), never a request parameter - deriving scope from the client is exactly the
 * IDOR that had to be fixed across the accounting reports.
 */
function fleetScopeOf(user) {
  const raw = user && user.fleetScope;
  if (raw == null || raw === 'all' || raw === '') return null;   // full access
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const a = JSON.parse(raw); if (Array.isArray(a)) return a.filter(Boolean); if (a === 'all') return null; } catch (e) {}
  return null;   // unparseable -> full access (only an explicit array restricts)
}

module.exports = { fleetScopeOf };
