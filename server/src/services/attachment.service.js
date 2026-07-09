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

// ── One-time migration of inline proofs stuck inside /state Document blobs ───────────
// Entry/Setoran moved to REST, but their old localStorage blobs (attendance, setoran,
// cashbon, …) still sit in the Document table with base64 photos baked in, so GET /state
// ships megabytes on every hydrate/poll. This deep-walks each blob, moves every base64
// `data:` payload into an Attachment, and swaps it for a tiny { ref } — shrinking /state
// without losing a single proof. Idempotent: a ref has no `data:`, so a re-run is a no-op.
const DATA_MIN = 200;   // ignore trivially-short data: URLs; real photos are far larger
const isDataUrl = (s) => typeof s === 'string' && s.slice(0, 5) === 'data:' && s.length > DATA_MIN;
const mimeOf = (s) => (s.match(/^data:([^;]+)/) || [])[1] || '';

// Returns the transformed node; accumulates moved-payload stats into ctx.
async function moveDataUrls(node, ctx) {
  if (node == null || typeof node === 'number' || typeof node === 'boolean') return node;
  if (typeof node === 'string') {
    if (!isDataUrl(node)) return node;
    const att = await prisma.attachment.create({ data: { name: 'bukti', mime: mimeOf(node), isImg: /^data:image\//.test(node), data: node, size: node.length, createdById: null } });
    ctx.moved++; ctx.bytes += node.length;
    return { ref: att.id, name: 'bukti', isImg: /^data:image\//.test(node) };
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = await moveDataUrls(node[i], ctx);
    return node;
  }
  if (typeof node === 'object') {
    // A proof object { data:'data:…', name?, isImg?, type?/mime? } → move as one unit so we
    // don't also process its `.data` string separately (which would drop name/isImg).
    if (isDataUrl(node.data)) {
      const raw = node.data;
      const isImg = node.isImg !== false;
      const att = await prisma.attachment.create({ data: { name: String(node.name || 'bukti').slice(0, 200), mime: node.type || node.mime || mimeOf(raw), isImg, data: raw, size: raw.length, createdById: null } });
      ctx.moved++; ctx.bytes += raw.length;
      return { ref: att.id, name: node.name || 'bukti', isImg, mime: node.type || node.mime || mimeOf(raw) };
    }
    for (const k of Object.keys(node)) node[k] = await moveDataUrls(node[k], ctx);
    return node;
  }
  return node;
}

async function migrateStateBlobProofs() {
  const summary = { docs: 0, photos: 0, bytesSaved: 0 };
  let rows;
  try { rows = await prisma.document.findMany(); } catch (e) { return summary; }
  for (const r of rows) {
    if (!r.value || r.value.indexOf('data:') === -1) continue;   // fast skip: no inline payload
    let parsed;
    try { parsed = JSON.parse(r.value); } catch (e) { continue; } // non-JSON blob → leave untouched
    const ctx = { moved: 0, bytes: 0 };
    const next = await moveDataUrls(parsed, ctx);
    if (ctx.moved > 0) {
      const newVal = JSON.stringify(next);
      await prisma.document.update({ where: { key: r.key }, data: { value: newVal } });
      summary.docs++; summary.photos += ctx.moved; summary.bytesSaved += (r.value.length - newVal.length);
    }
  }
  if (summary.photos) {
    // eslint-disable-next-line no-console
    console.log(`[attachments] state-blob proof migration → docs:${summary.docs} photos:${summary.photos} bytesSaved:${summary.bytesSaved}`);
  }
  return summary;
}

module.exports = { create, getOne, migrateInlineProofs, migrateStateBlobProofs };
