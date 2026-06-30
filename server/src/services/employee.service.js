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

async function list(includeInactive) {
  return prisma.employee.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: 'asc' },
  });
}
async function getById(id) {
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw ApiError.notFound('Employee not found');
  return e;
}
async function create(data) {
  // NIP is generated once at create, server-side, unless the caller supplied one.
  const payload = { ...data };
  if (!payload.nip) {
    payload.nip = await allocateNip({ office: payload.office, contractStart: payload.contractStart });
  }
  return prisma.employee.create({ data: payload });
}
async function update(id, data) {
  await getById(id);
  // Editing office/contract must NOT silently change the NIP — only the explicit
  // regenerate path does that. Ignore any `nip` slipped into a normal update.
  const { nip, ...rest } = data;
  return prisma.employee.update({ where: { id }, data: rest });
}
// Explicit "Regenerasi NIP" — allocates a fresh NIP using current office/contract.
async function regenerateNip(id) {
  const e = await getById(id);
  const nip = await allocateNip({ office: e.office, contractStart: e.contractStart });
  return prisma.employee.update({ where: { id }, data: { nip } });
}
async function remove(id) {
  await getById(id);
  await prisma.employee.delete({ where: { id } });
}

module.exports = { list, getById, create, update, remove, regenerateNip, allocateNip, OFFICES, MARITAL };
