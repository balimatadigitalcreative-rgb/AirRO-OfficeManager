'use strict';
// SINGLE RULE for how .env is loaded: outside test it is authoritative (override:true beats any
// stray/inherited variable, e.g. a leftover DATABASE_URL); under NODE_ENV=test it is NOT loaded AT
// ALL. The old `override:false` still LOADED keys that were merely absent from process.env, so a
// production flag in .env (e.g. ACCOUNTING_V2=true on the deploy box) leaked into every test run and
// tests ended up asserting an ambient default that isn't the code's real default. Under test the only
// environment is what the runner + tests/jest.setup.js set explicitly — the suite is hermetic.
if (process.env.NODE_ENV !== 'test') {
  // An EXPLICITLY-provided DATABASE_URL (e.g. a script pointed at a prod COPY:
  // `DATABASE_URL="file:./prod-copy.db" node scripts/...`) must ALWAYS win — otherwise override:true
  // silently clobbers it with .env's DATABASE_URL and the script reads the WRONG database (this is
  // exactly how a "read a copy" verification once read production). We pin the caller's value, let
  // dotenv override everything else (its purpose: beat stray/inherited vars), then restore the pin.
  // In production DATABASE_URL lives only in .env (not in process.env before dotenv), so pinned is
  // undefined and behaviour is unchanged; a real deploy that sets it in the environment keeps that too.
  const pinnedDbUrl = process.env.DATABASE_URL;
  require('dotenv').config({ override: true });
  if (pinnedDbUrl) process.env.DATABASE_URL = pinnedDbUrl;
}

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
  // ACCOUNTING v2 (double-entry) feature flag. OFF by default — the cash book stays the sole source of
  // truth for every existing report until the new engine is proven byte-identical and cut over.
  accountingV2: process.env.ACCOUNTING_V2 === 'true',
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
