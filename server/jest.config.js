'use strict';
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  // Runs before every test file (and before src/config/env.js loads) to pin NODE_ENV and give every
  // env-default a hermetic baseline — so a flag in .env can't leak into the suite. See jest.setup.js.
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 20000,
};
