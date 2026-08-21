'use strict';
/*
 * SHARED SCRIPT SAFETY — require this FIRST in any script (before ../src/lib/prisma or any service) so
 * that:
 *   1. env is loaded up-front, and an EXPLICIT `DATABASE_URL` the caller passed on the command line WINS
 *      over .env (see src/config/env.js — a script pointed at a copy must never silently read prod);
 *   2. the resolved database is printed PROMINENTLY, so nobody is left guessing which DB a run touched;
 *   3. a WRITE run against a production-looking database is REFUSED unless --confirm-production is given.
 *
 * Usage:
 *   const guard = require('./_db-guard');
 *   guard.printBanner('READ-ONLY');      // read-only scripts
 *   guard.assertWriteAllowed();          // write scripts — call before the first mutation
 */
require('../src/config/env');   // force env.js to run now → DATABASE_URL is final before anything reads it

function dbUrl() { return process.env.DATABASE_URL || '(none set — Prisma will use its schema default)'; }
function dbFile() {
  const raw = String(process.env.DATABASE_URL || '').replace(/^file:/, '');
  return raw.split(/[\\/]/).pop() || raw;   // just the filename (or the whole URL for non-file DBs)
}
// A target is "production-looking" if its name says prod/production/live and does NOT say it is a
// copy/test/dev/staging/backup. Deliberately conservative: better to ask for --confirm-production once
// than to let a write hit the live DB.
function looksProduction() {
  const f = dbFile().toLowerCase();
  return /prod|production|live/.test(f) && !/copy|test|dev|staging|sample|backup|scratch/.test(f);
}

function printBanner(mode) {
  const line = '─'.repeat(74);
  console.log('\n' + line);
  console.log(`  DATABASE : ${dbUrl()}`);
  console.log(`  MODE     : ${mode}`);
  if (looksProduction()) console.log('  ⚠  filename looks like PRODUCTION');
  console.log(line + '\n');
}

// Call before ANY write. Refuses a production-looking target unless --confirm-production is present.
function assertWriteAllowed() {
  printBanner('WRITE');
  if (looksProduction() && !process.argv.includes('--confirm-production')) {
    console.error('✖ REFUSING to write to a PRODUCTION-looking database without --confirm-production.');
    console.error(`  Target: ${dbUrl()}`);
    console.error('  Point DATABASE_URL at a copy, or re-run with --confirm-production if you truly mean production.');
    process.exit(3);
  }
}

module.exports = { dbUrl, dbFile, looksProduction, printBanner, assertWriteAllowed };
