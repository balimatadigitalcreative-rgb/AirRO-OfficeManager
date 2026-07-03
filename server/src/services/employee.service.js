'use strict';
const prisma = require('../lib/prisma');
const ApiError = require('../utils/ApiError');

// Posisi kantor → KODE NIP. Office value IS the code (AIRRO/NSN/MFG).
const OFFICES = ['AIRRO', 'NSN', 'MFG'];
const MARITAL = ['TK', 'K', 'Cerai'];

const PAD3 = (n) => String(n).padStart(3, '0');
// 2-digit year from a YYYY-MM-DD string, or the current year when absent.
function yy2(contractStart) {
  const y = (typeof contractStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(contractStart))
    ? contractStart.slice(0, 4)
    : String(new Date().getFullYear());
  return y.slice(2);
}

// Allocate the next unique NIP for an office+year, race-safe.
// Format: <OFFICE>-YY-NNN. NNN resets per office+year, starts at 001.
// The EmployeeNip unique constraint on (office, year, seq) means two concurrent
// callers can't both claim the same seq — the loser gets P2002 and retries.
async function allocateNip({ office = 'AIRRO', contractStart = null } = {}) {
  const code = OFFICES.includes(office) ? office : 'AIRRO';
  const year = yy2(contractStart);
  for (let attempt = 0; attempt < 25; attempt++) {
    const count = await prisma.employeeNip.count({ where: { office: code, year } });
    const seq = count + 1;
    const nip = `${code}-${year}-${PAD3(seq)}`;
    try {
      await prisma.employeeNip.create({ data: { nip, office: code, year, seq } });
      return nip;
    } catch (e) {
      if (e && e.code === 'P2002') continue; // someone grabbed this seq/nip first — retry
      throw e;
    }
  }
  throw ApiError.conflict('Gagal mengalokasikan NIP (terlalu banyak bentrokan, coba lagi)');
}

// ── document ⇆ columns projection ─────────────────────────────────────────
// The full frontend staff object lives verbatim in the `data` JSON column. The
// structured columns are a server-side projection (payroll engine + queries +
// NIP). Map the object → columns so those keep working, WITHOUT dropping any
// frontend-only field (that stays in `data`).
const int = (v) => Math.max(0, Math.round(+v || 0));
const str = (v) => (v == null ? null : String(v));
const OFFBOARD = ['active', 'resigned', 'terminated', 'dishonorable', 'absconded', 'contract_ended', 'retired', 'orientation_failed'];
const RISKS = ['Low', 'Medium', 'High'];

function toColumns(o) {
  // Frontend offboarding lives in `sepStatus`; the column is named `status`. (The
  // frontend's own `status`, e.g. "Tetap"/"Kontrak", is employment TYPE — it stays
  // in `data` only.) `active` mirrors sepStatus so they can't contradict.
  const sep = OFFBOARD.includes(o.sepStatus) ? o.sepStatus : (OFFBOARD.includes(o.status) ? o.status : 'active');
  const active = o.active != null ? !!o.active : sep === 'active';
  const c = {
    name: String(o.name || '').trim() || 'Tanpa Nama',
    department: str(o.department || o.dept) || 'Staff',
    base: int(o.base), allowance: int(o.allowance),
    tjKinerja: int(o.tjKinerja), tjProfesi: int(o.tjProfesi), tjRumahDinas: int(o.tjRumahDinas),
    tjBpjsKes: int(o.tjBpjsKes), tjBpjsTk: int(o.tjBpjsTk),
    risk: RISKS.includes(o.risk) ? o.risk : 'Low',
    jp: o.jp != null ? !!o.jp : true,
    religion: o.religion || 'Islam',
    joinedDate: str(o.joinedDate) || null,
    status: sep, active,
    separationDate: str(o.separationDate) || null, separationReason: str(o.separationReason) || null, separationNote: str(o.separationNote) || null,
    stage: o.stage || 'permanent',
    bpjsKesEnrolled: !!o.bpjsKesEnrolled, bpjsKesStart: str(o.bpjsKesStart) || null,
    bpjsTkEnrolled: !!o.bpjsTkEnrolled, bpjsTkStart: str(o.bpjsTkStart) || null,
    office: OFFICES.includes(o.office) ? o.office : 'AIRRO',
    contractStart: str(o.contractStart) || null, contractEnd: str(o.contractEnd) || null,
    noSurat: str(o.noSurat) || null, noKk: str(o.noKk) || null,
    noBpjsKes: str(o.noBpjsKes) || null, noBpjsTk: str(o.noBpjsTk) || null,
    birthPlace: str(o.birthPlace) || null, birthDate: str(o.birthDate) || null,
    addressKtp: str(o.addressKtp) || null, addressDomisili: str(o.addressDomisili) || null,
    maritalStatus: MARITAL.includes(o.maritalStatus) ? o.maritalStatus : 'TK',
  };
  return c;
}
// Row → the frontend object it stored (verbatim), with the authoritative id/nip.
function toClient(row) {
  let obj = {}; try { obj = row.data ? JSON.parse(row.data) : {}; } catch (e) {}
  return { ...obj, id: row.id, nip: row.nip || obj.nip || '' };
}

async function list(includeInactive) {
  const rows = await prisma.employee.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: 'asc' },
  });
  return rows.map(toClient);
}
async function getRow(id) {
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw ApiError.notFound('Employee not found');
  return e;
}
async function getById(id) { return toClient(await getRow(id)); }

async function create(body) {
  const cols = toColumns(body);
  // NIP is controlled by the frontend, which pre-allocates via POST /employees/nip
  // and includes it here. Do NOT auto-allocate on create — that would burn an extra
  // sequence number (double-allocation) and give a NIP to staff the UI didn't assign
  // one to. Empty → stored as NULL (the unique index allows many NULLs).
  const nip = body.nip ? String(body.nip) : null;
  const full = { ...body, nip: nip || '' };          // faithful copy incl. the resolved NIP
  delete full._isNew;
  const data = { ...cols, nip, data: JSON.stringify(full) };
  if (body.id) data.id = String(body.id);           // keep the client id (optimistic insert)
  const row = await prisma.employee.create({ data });
  return toClient(row);
}
async function update(id, body) {
  const existing = await getRow(id);
  let prev = {}; try { prev = existing.data ? JSON.parse(existing.data) : {}; } catch (e) {}
  const merged = { ...prev, ...body };
  merged.nip = existing.nip;                          // NIP is immutable on a normal edit
  delete merged._isNew;
  const cols = toColumns(merged);
  delete cols.nip;                                    // never change NIP here
  const row = await prisma.employee.update({ where: { id }, data: { ...cols, data: JSON.stringify(merged) } });
  return toClient(row);
}
// Explicit "Regenerasi NIP" — allocates a fresh NIP using current office/contract.
async function regenerateNip(id) {
  const e = await getRow(id);
  let obj = {}; try { obj = e.data ? JSON.parse(e.data) : {}; } catch (er) {}
  const nip = await allocateNip({ office: e.office, contractStart: e.contractStart });
  const row = await prisma.employee.update({ where: { id }, data: { nip, data: JSON.stringify({ ...obj, nip }) } });
  return toClient(row);
}
// Kept for API completeness / tests. The frontend NEVER deletes staff — it offboards
// them (PATCH status), so the record and its history are preserved.
async function remove(id) {
  await getRow(id);
  await prisma.employee.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, regenerateNip, allocateNip, toColumns, toClient, OFFICES, MARITAL };
