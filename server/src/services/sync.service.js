'use strict';
const prisma = require('../lib/prisma');

// Replace-collection sync: the client sends the full desired set of rows for a
// resource (each carrying its client-generated id). We upsert every row by id
// and delete any stored row whose id is no longer present — making the server
// collection an exact mirror of the client array. This matches the frontend's
// "save the whole array on every change" persistence pattern and sidesteps any
// client/server id mapping (client ids become the stored ids).
//
// `model`   - prisma delegate (e.g. prisma.account)
// `items`   - array of plain rows from the client (already field-mapped)
// `idField` - identity column (default 'id')
async function replaceCollection(model, items, idField = 'id') {
  const ids = items.map((it) => it[idField]).filter(Boolean);

  const ops = [
    // Drop rows the client no longer has.
    model.deleteMany({ where: { [idField]: { notIn: ids.length ? ids : ['__none__'] } } }),
    // Upsert each incoming row by its id.
    ...items.map((it) => {
      const { [idField]: id, ...rest } = it;
      return model.upsert({ where: { [idField]: id }, update: rest, create: it });
    }),
  ];

  await prisma.$transaction(ops);
  return model.findMany();
}

module.exports = { replaceCollection };
