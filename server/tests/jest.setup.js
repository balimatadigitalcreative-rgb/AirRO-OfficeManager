'use strict';
// HERMETIC TEST ENVIRONMENT.
//
// Registered as a jest `setupFiles` entry, so this runs before EVERY test file's own module code —
// and therefore before src/config/env.js is first required by that file. It fixes NODE_ENV and gives
// an explicit, known baseline for every environment variable whose DEFAULT a test relies on, so a
// test's result can never hinge on what happens to be in server/.env or the ambient shell.
//
// The rule for feature flags: the baseline here is the code's REAL default (OFF). A test that needs a
// non-default sets it at the top of its OWN file (e.g. `process.env.ACCOUNTING_V2 = 'true'`). That
// line runs AFTER this setup but BEFORE the file requires the app, so the test's explicit choice wins
// while every other file is guaranteed the default — regardless of .env.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./test.db';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Feature flags — force the code's default (OFF) unless a test opts in explicitly.
delete process.env.ACCOUNTING_V2;
