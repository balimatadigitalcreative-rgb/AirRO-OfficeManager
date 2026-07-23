'use strict';

// One malformed row must NEVER blank an entire list screen. Normally `findMany` is atomic — if a
// single row fails to read (a bad value conversion, a broken relation, corrupt data) the whole query
// throws and the UI shows "no data" even though the rest is fine (this is exactly the bug the money
// BigInt widening fixed for the transaction list). This wrapper adds defense-in-depth for ANY such
// future row: try the normal query; on failure, log it, then degrade to a per-row read — fetch only
// the ids (which can't touch the offending column), read each row individually, and SKIP the ones
// that still throw (logging their id). The endpoint stays 200 and returns every good row.
async function resilientFindMany(delegate, args, label) {
  const a = args || {};
  try {
    return await delegate.findMany(a);
  } catch (err) {
    const tag = label || 'list';
    // eslint-disable-next-line no-console
    console.error(`[resilient] ${tag}: findMany failed (${err && err.message}); degrading to per-row read`);
    let ids;
    try {
      const idRows = await delegate.findMany({ where: a.where, orderBy: a.orderBy, take: a.take, skip: a.skip, select: { id: true } });
      ids = idRows.map((r) => r.id);
    } catch (idErr) {
      // eslint-disable-next-line no-console
      console.error(`[resilient] ${tag}: id-scan also failed (${idErr && idErr.message}); returning empty list`);
      return [];
    }
    const readOne = (id) => (a.select ? delegate.findUnique({ where: { id }, select: a.select }) : delegate.findUnique({ where: { id }, include: a.include }));
    const out = [];
    for (const id of ids) {
      try {
        const row = await readOne(id);
        if (row) out.push(row);
      } catch (rowErr) {
        // eslint-disable-next-line no-console
        console.error(`[resilient] ${tag}: skipping unreadable row id=${id} (${rowErr && rowErr.message})`);
      }
    }
    return out;
  }
}

module.exports = { resilientFindMany };
