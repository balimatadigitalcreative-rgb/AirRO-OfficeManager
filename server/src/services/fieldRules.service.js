'use strict';
// ATURAN LAPANGAN — the business rules the new phone UI (Mode Lapangan) always follows and the server
// enforces once the owner switches them on. ONE settings key so a release flips them together.
const ApiError = require('../utils/ApiError');
const settings = require('./settings.service');

const KEY = 'fieldRules';
const DEFAULT_RULES = Object.freeze({
  ritSop: { enabled: false, minLoad: 80 },
  fleetCapacity: {},
  wajibFotoTransaksi: false,
  wajibFotoPengeluaran: false,
  wajibAlasanBatal: false,
  hargaGantiRugiGalon: 0,
  fieldUiDefault: 'old',
});

const posInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

// Whatever is stored, hand back a complete, well-typed object (older/partial blobs included).
function normalize(v) {
  const s = (v && typeof v === 'object') ? v : {};
  const sop = (s.ritSop && typeof s.ritSop === 'object') ? s.ritSop : {};
  const cap = {};
  Object.entries((s.fleetCapacity && typeof s.fleetCapacity === 'object') ? s.fleetCapacity : {}).forEach(([k, n]) => { const c = posInt(n); if (String(k).trim() && c) cap[String(k).trim()] = c; });
  return {
    ritSop: { enabled: !!sop.enabled, minLoad: posInt(sop.minLoad) || DEFAULT_RULES.ritSop.minLoad },
    fleetCapacity: cap,
    wajibFotoTransaksi: !!s.wajibFotoTransaksi,
    wajibFotoPengeluaran: !!s.wajibFotoPengeluaran,
    wajibAlasanBatal: !!s.wajibAlasanBatal,
    hargaGantiRugiGalon: posInt(s.hargaGantiRugiGalon),
    fieldUiDefault: s.fieldUiDefault === 'new' ? 'new' : 'old',
  };
}

async function getRules() {
  let v = null;
  try { v = await settings.get(KEY); } catch (e) { v = null; }
  return normalize(v);
}

const capacityOf = (rules, fleetId) => (fleetId && rules.fleetCapacity[fleetId]) || null;

// A human line per changed field, for the audit row.
function describeChanges(a, b) {
  const out = [];
  if (a.ritSop.enabled !== b.ritSop.enabled || a.ritSop.minLoad !== b.ritSop.minLoad) out.push(`SOP muatan ${b.ritSop.enabled ? 'aktif' : 'mati'}, minimal ${b.ritSop.minLoad} galon`);
  const plates = new Set([...Object.keys(a.fleetCapacity), ...Object.keys(b.fleetCapacity)]);
  plates.forEach((p) => { if ((a.fleetCapacity[p] || 0) !== (b.fleetCapacity[p] || 0)) out.push(`kapasitas ${p}: ${a.fleetCapacity[p] || 'tanpa batas'} → ${b.fleetCapacity[p] || 'tanpa batas'}`); });
  [['wajibFotoTransaksi', 'foto wajib transaksi'], ['wajibFotoPengeluaran', 'foto wajib pengeluaran'], ['wajibAlasanBatal', 'alasan wajib batal']].forEach(([k, label]) => { if (a[k] !== b[k]) out.push(`${label} ${b[k] ? 'aktif' : 'mati'}`); });
  if (a.hargaGantiRugiGalon !== b.hargaGantiRugiGalon) out.push(`harga ganti rugi galon ${a.hargaGantiRugiGalon} → ${b.hargaGantiRugiGalon}`);
  if (a.fieldUiDefault !== b.fieldUiDefault) out.push(b.fieldUiDefault === 'new' ? 'tampilan baru dijadikan tampilan utama' : 'tampilan lama dijadikan tampilan utama');
  return out;
}

async function setRules(patch, actor) {
  const p = patch || {};
  const cur = await getRules();
  const next = JSON.parse(JSON.stringify(cur));
  if (p.ritSop !== undefined) {
    if (p.ritSop.enabled !== undefined) next.ritSop.enabled = !!p.ritSop.enabled;
    if (p.ritSop.minLoad !== undefined) {
      const m = Math.round(Number(p.ritSop.minLoad));
      if (!Number.isFinite(m) || m < 1 || m > 10000) throw ApiError.badRequest('Muatan minimal harus 1–10000 galon.');
      next.ritSop.minLoad = m;
    }
  }
  if (p.fleetCapacity !== undefined) {
    Object.entries(p.fleetCapacity || {}).forEach(([k, v]) => {
      const plate = String(k).trim(); if (!plate) return;
      if (v === null || v === '' || Number(v) === 0) { delete next.fleetCapacity[plate]; return; }
      const c = Math.round(Number(v));
      if (!Number.isFinite(c) || c < 1 || c > 10000) throw ApiError.badRequest(`Kapasitas ${plate} harus 1–10000 galon.`);
      next.fleetCapacity[plate] = c;
    });
  }
  ['wajibFotoTransaksi', 'wajibFotoPengeluaran', 'wajibAlasanBatal'].forEach((k) => { if (p[k] !== undefined) next[k] = !!p[k]; });
  if (p.hargaGantiRugiGalon !== undefined) {
    const h = Math.round(Number(p.hargaGantiRugiGalon));
    if (!Number.isFinite(h) || h < 0 || h > 10000000) throw ApiError.badRequest('Harga ganti rugi galon tidak valid.');
    next.hargaGantiRugiGalon = h;
  }
  if (p.fieldUiDefault !== undefined) {
    if (p.fieldUiDefault !== 'old' && p.fieldUiDefault !== 'new') throw ApiError.badRequest('Tampilan utama harus "old" atau "new".');
    next.fieldUiDefault = p.fieldUiDefault;
  }
  const saved = normalize(next);
  await settings.set(KEY, saved);
  const changes = describeChanges(cur, saved);
  if (changes.length) await require('./distribution.service').logDistAudit('pengaturan', 'Aturan lapangan diubah', changes.join(' · '), actor, '');
  return saved;
}

module.exports = { KEY, DEFAULT_RULES, normalize, getRules, setRules, capacityOf };
