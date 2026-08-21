'use strict';
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  // Runs before every test file (and before src/config/env.js loads) to pin NODE_ENV and give every
  // env-default a hermetic baseline — so a flag in .env can't leak into the suite. See jest.setup.js.
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 20000,
  // The deploy runs the suite with --runInBand (single process) because the 90+ compile-heavy suites
  // blow past V8's default old-space when jest spreads them across parallel workers. This is the safety
  // net for the OTHER path: if parallel mode is ever re-enabled (a bare `npx jest`, or dropping
  // --runInBand), a worker that grows past this limit is RECYCLED after the current test file instead of
  // ballooning until it is OOM-killed. Harmless under --runInBand (no workers to recycle).
  workerIdleMemoryLimit: '512MB',
};
