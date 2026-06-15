'use strict';
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/globalSetup.js',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 20000,
};
