'use strict';
const { execSync } = require('child_process');
const path = require('path');

// Before the suite runs, create a fresh test database from the Prisma schema.
// `db push --force-reset` drops everything and recreates the schema — fast and
// migration-free, which is ideal for an ephemeral SQLite test DB.
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./test.db';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  execSync('npx prisma db push --force-reset --skip-generate', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
};
