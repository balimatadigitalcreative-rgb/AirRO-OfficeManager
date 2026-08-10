'use strict';
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');
const { toE164 } = require('../lib/phone');

const BIZ_NAME = 'AirRO Reverse Osmosis';
const BIZ_SUB = 'Air Minum Reverse Osmosis';
const LINK_TTL_MS = 30 * 24 * 3600 * 1000;   // default 30 days
const rp = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const publicBase = (req) => { const proto = (req && req.protocol) || 'https'; const host = (req && req.get && req.get('host')) || 'localhost'; return proto + '://' + host + '/api/v1/inv/'; };

async function loadInvoice(invoiceId) {
  const inv = await prisma.distInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw ApiError.notFound('Invoice tidak ditemukan.');
  return inv;
}

// Create (or reuse a still-valid) signed link for an invoice. Returns { token, url, expiresAt }.
async function createLink(invoiceId, actor, req) {
  const inv = await loadInvoice(invoiceId);
  const now = Date.now();
  let link = await prisma.invoiceLink.findFirst({ where: { invoiceId: inv.id, revoked: false, expiresAt: { gt: new Date(now) } }, orderBy: { createdAt: 'desc' } });
  if (!link) {
    link = await prisma.invoiceLink.create({ data: { token: crypto.randomBytes(24).toString('hex'), invoiceId: inv.id, expiresAt: new Date(now + LINK_TTL_MS), createdById: actor && actor.id, createdByName: actor && actor.name } });
  }
  return { token: link.token, url: publicBase(req) + link.token, expiresAt: link.expiresAt };
}

// Revoke every link for an invoice → any shared URL immediately shows "tautan tidak berlaku".
async function revokeLinks(invoiceId, actor) {
  const r = await prisma.invoiceLink.updateMany({ where: { invoiceId, revoked: false }, data: { revoked: true } });
  return { revoked: r.count };
}

// Resolve a public token → { status: 'ok'|'revoked'|'expired'|'notfound', invoice? }. NO auth.
async function publicView(token) {
  const link = await prisma.invoiceLink.findUnique({ where: { token: String(token || '') } });
  if (!link) return { status: 'notfound' };
  if (link.revoked) return { status: 'revoked' };
  if (link.expiresAt.getTime() < Date.now()) return { status: 'expired' };
  const inv = await prisma.distInvoice.findUnique({ where: { id: link.invoiceId } });
  if (!inv) return { status: 'notfound' };
  const cust = await prisma.customer.findUnique({ where: { id: inv.customerId }, select: { name: true, code: true, phone: true } });
  let items = []; try { items = JSON.parse(inv.items || '[]'); } catch (e) {}
  // ONLY this invoice — no login, no other customer, no internal metadata (creator/role stripped).
  return { status: 'ok', invoice: { number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate, total: inv.total, sisaBon: inv.sisaBon, note: inv.note, items, customer: cust ? { name: cust.name, code: cust.code || '', phone: cust.phone || '' } : null } };
}

// Self-contained, noindex HTML for the public page (Save-as-PDF from the browser).
function renderPublicHtml(view) {
  if (view.status !== 'ok') {
    const msg = view.status === 'expired' ? 'Tautan tidak berlaku (kedaluwarsa).' : view.status === 'revoked' ? 'Tautan tidak berlaku (dicabut).' : 'Tautan tidak ditemukan.';
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tautan tidak berlaku</title><style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f4f7f9;color:#334;display:grid;place-items:center;min-height:100vh;margin:0}.c{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:34px 40px;text-align:center;max-width:360px}.c h1{font-size:18px;margin:0 0 8px}.c p{color:#64748b;font-size:14px;margin:0}</style></head><body><div class="c"><h1>${esc(BIZ_NAME)}</h1><p>${esc(msg)}</p></div></body></html>`;
  }
  const iv = view.invoice; const c = iv.customer || {};
  const rows = (iv.items || []).map((it) => `<tr><td>${esc(it.date)}</td><td class="r">${esc(it.qty)}</td><td class="r">${rp(it.unitPrice)}</td><td class="r">${rp(it.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(iv.number)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#eef2f5;color:#1e293b;margin:0;padding:18px}
.sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(15,30,45,.08);padding:26px 30px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f2436;padding-bottom:12px;margin-bottom:14px}
.biz b{font-size:17px}.biz div{color:#64748b;font-size:12px}.tt{font-size:19px;font-weight:800;letter-spacing:.02em}
.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;margin-bottom:14px}.meta .r{text-align:right}
.meta b{display:block}.meta span{color:#64748b}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:left}th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#475569}
.r{text-align:right}
.tot{margin:16px 0 0 auto;width:280px;max-width:100%;border:1.5px solid #0f2436;border-radius:6px;padding:10px 14px}
.tot .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}.tot .sisa{border-top:2px solid #0f2436;margin-top:6px;padding-top:8px;font-weight:800}.tot .sisa b{font-size:18px}
.ft{margin-top:22px;color:#64748b;font-size:12px;text-align:center}
.pr{display:block;width:100%;margin:16px auto 0;max-width:300px;padding:12px;border:0;border-radius:10px;background:#0b7eb1;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
@media print{.pr{display:none}body{background:#fff;padding:0}.sheet{box-shadow:none}}
</style></head><body>
<div class="sheet">
  <div class="hd"><div class="biz"><b>${esc(BIZ_NAME)}</b><div>${esc(BIZ_SUB)}</div></div><div class="tt">RIWAYAT TRANSAKSI</div></div>
  <div class="meta"><div><b>${esc(c.name || '')}</b><span>${esc([c.code, c.phone].filter(Boolean).join(' · '))}</span></div><div class="r"><b>${esc(iv.number)}</b><span>${esc(iv.issueDate)}${iv.dueDate ? ' · jatuh tempo ' + esc(iv.dueDate) : ''}</span></div></div>
  <table><thead><tr><th>Tanggal</th><th class="r">Galon</th><th class="r">Harga</th><th class="r">Nominal</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:16px">Tidak ada baris.</td></tr>'}</tbody></table>
  <div class="tot"><div class="row"><span>Total</span><b>${rp(iv.total)}</b></div><div class="row sisa"><span>SISA BON</span><b>${rp(iv.sisaBon)}</b></div></div>
  <button class="pr" onclick="window.print()">Simpan / Cetak PDF</button>
  <div class="ft">${esc(BIZ_NAME)} · ${esc(BIZ_SUB)}${c.note ? '' : ''}</div>
</div></body></html>`;
}

// Log a dispatch (invoice opened in WhatsApp). Validates the phone to E.164.
async function logDispatch(body, actor) {
  const invoiceId = String((body && body.invoiceId) || '');
  const inv = await loadInvoice(invoiceId);
  const phone = toE164(body && body.phone);
  if (!phone) throw ApiError.badRequest('Nomor HP tidak valid.');
  const d = await prisma.invoiceDispatch.create({ data: {
    invoiceId: inv.id, customerId: inv.customerId, channel: String((body && body.channel) || 'wa').slice(0, 12), phone,
    messageSnapshot: String((body && body.messageSnapshot) || '').slice(0, 2000), linkUrl: String((body && body.linkUrl) || '').slice(0, 500),
    linkExpiresAt: body && body.linkExpiresAt ? new Date(body.linkExpiresAt) : null,
    sentById: actor && actor.id, sentByName: actor && actor.name,
  } });
  return d;
}
async function listDispatches(q) {
  const where = {};
  if (q && q.invoiceId) where.invoiceId = String(q.invoiceId);
  if (q && q.customerId) where.customerId = String(q.customerId);
  const rows = await prisma.invoiceDispatch.findMany({ where, orderBy: { sentAt: 'desc' }, take: 200 });
  return rows.map((r) => ({ id: r.id, invoiceId: r.invoiceId, customerId: r.customerId, channel: r.channel, phone: r.phone, messageSnapshot: r.messageSnapshot, linkUrl: r.linkUrl, linkExpiresAt: r.linkExpiresAt ? r.linkExpiresAt.getTime() : null, sentByName: r.sentByName || null, sentAt: r.sentAt ? r.sentAt.getTime() : null }));
}

module.exports = { createLink, revokeLinks, publicView, renderPublicHtml, logDispatch, listDispatches };
