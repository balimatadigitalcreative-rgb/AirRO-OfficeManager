'use strict';
// override:true makes .env authoritative over any stray/inherited environment
// variables (e.g. a leftover DATABASE_URL from another setup). Skipped under
// test so the test runner's explicit DATABASE_URL/NODE_ENV still win.
require('dotenv').config({ override: process.env.NODE_ENV !== 'test' });

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
  // Rate limiting (per real client IP — see app.set('trust proxy')). All configurable via env so an
  // office behind one NAT IP can raise the general limit without a code change.
  rateLimit: {
    loginWindowMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS || String(15 * 60 * 1000), 10),   // 15 min
    loginMax: parseInt(process.env.LOGIN_RATE_MAX || '10', 10),
    forgotWindowMs: parseInt(process.env.FORGOT_RATE_WINDOW_MS || String(60 * 60 * 1000), 10),  // 1 hour
    forgotMax: parseInt(process.env.FORGOT_RATE_MAX || '5', 10),
    apiWindowMs: parseInt(process.env.API_RATE_WINDOW_MS || String(60 * 1000), 10),             // 1 min
    apiMax: parseInt(process.env.API_RATE_MAX || '300', 10),
  },
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
