'use strict';
// Attachment store — proof photos/PDFs kept OUT of the record sync payload. Records hold
// only a small ref; the bytes live here and are fetched lazily by the proof viewer.
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// Create an attachment from a base64 data URL. Returns metadata only — never echoes the
// bytes back (the caller already has them locally for its preview).
async function create(body, actor) {
  const data = String(body.data || '');
  if (!/^data:/.test(data)) throw ApiError.badRequest('data must be a data: URL');
  const a = await prisma.attachment.create({ data: {
    name: String(body.name || '').slice(0, 200),
    mime: String(body.mime || (data.match(/^data:([^;]+)/) || [])[1] || '').slice(0, 100),
    isImg: body.isImg !== false,
    data,
    size: data.length,
    createdById: (actor && actor.id) || null,
  } });
  return { id: a.id, name: a.name, mime: a.mime, isImg: a.isImg, size: a.size };
}

// Fetch the full attachment (bytes included) — the lazy path used when a proof is opened.
async function getOne(id) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw ApiError.notFound('Attachment not found');
  return { id: a.id, name: a.name, mime: a.mime, isImg: a.isImg, data: a.data };
}

// ── One-time migration of already-stored inline proofs ──────────────────────────────
// Move base64 proofs on Entry/Setoran into Attachment rows and replace the record's
// `proof` with a small ref. Idempotent: once a proof is a ref it no longer contains
// 'data:' so it is never reprocessed. Handles BOTH stored shapes — a JSON object
// {name,isImg,data} and a legacy raw "data:...;base64,..." string — so no proof is lost.
function parseInline(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^data:/.test(s)) return { data: s, name: 'bukti', isImg: /^data:image\//.test(s), mime: (s.match(/^data:([^;]+)/) || [])[1] || '' };
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && typeof o.data === 'string' && /^data:/.test(o.data)) {
      return { data: o.data, name: o.name || 'bukti', isImg: o.isImg !== false, mime: o.type || (o.data.match(/^data:([^;]+)/) || [])[1] || '' };
    }
  } catch (e) { /* not JSON → not an inline proof we can move */ }
  return null;
}
const asRef = (attId, name, isImg) => JSON.stringify({ ref: attId, name: name || 'bukti', isImg: isImg !== false });

async function migrateInlineProofs() {
  const summary = { entries: 0, setoran: 0, lost: 0 };
  const migrate = async (rows, updater) => {
    let n = 0;
    for (const r of rows) {
      const p = parseInline(r.proof);
      if (!p) { summary.lost++; continue; }   // had 'data:' but unparseable → leave untouched (never drop)
      const att = await prisma.attachment.create({ data: { name: p.name, mime: p.mime || '', isImg: p.isImg, data: p.data, size: p.data.length, createdById: r.createdById || null } });
      await updater(r.id, asRef(att.id, p.name, p.isImg));
      n++;
    }
    return n;
  };
  try {
    const entries = await prisma.entry.findMany({ where: { proof: { contains: 'data:' } }, select: { id: true, proof: true, createdById: true } });
    summary.entries = await migrate(entries, (id, proof) => prisma.entry.update({ where: { id }, data: { proof } }));
  } catch (e) { /* table not ready on first migrate → ignored */ }
  try {
    const setoran = await prisma.setoran.findMany({ where: { proof: { contains: 'data:' } }, select: { id: true, proof: true } });
    summary.setoran = await migrate(setoran.map((r) => ({ ...r, createdById: null })), (id, proof) => prisma.setoran.update({ where: { id }, data: { proof } }));
  } catch (e) { /* ignored */ }
  if (summary.entries || summary.setoran || summary.lost) {
    // eslint-disable-next-line no-console
    console.log(`[attachments] inline-proof migration → entries:${summary.entries} setoran:${summary.setoran} unparseable:${summary.lost}`);
  }
  return summary;
}

module.exports = { create, getOne, migrateInlineProofs };
