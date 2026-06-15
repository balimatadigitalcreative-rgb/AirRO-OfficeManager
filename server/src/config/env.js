'use strict';
require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-secret';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: parseInt(process.env.PORT || '4000', 10),
  // Behind Nginx in production, bind to localhost only; bind all interfaces in dev.
  host: process.env.HOST || (isProd ? '127.0.0.1' : '0.0.0.0'),
  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),
  jwt: {
    // In test we allow a default so the suite runs without a .env file.
    secret: required('JWT_SECRET', isTest ? 'test-secret' : undefined),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

// ---- production hardening guards --------------------------------------------
if (isProd) {
  if (!config.jwt.secret || config.jwt.secret === PLACEHOLDER_SECRET || config.jwt.secret.length < 32) {
    throw new Error(
      'Refusing to start in production: set a strong JWT_SECRET (>= 32 chars). ' +
      'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (config.corsOrigin === '*') {
    // eslint-disable-next-line no-console
    console.warn('[AirRO] WARNING: CORS_ORIGIN is "*" in production. Set it to your site origin, e.g. https://app.yourdomain.com');
  }
}

module.exports = config;
