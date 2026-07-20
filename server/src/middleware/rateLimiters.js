'use strict';
// Production rate limiters (express-rate-limit). Keyed on the REAL client IP — app.js sets
// `trust proxy` so limits use X-Forwarded-For from Nginx, not Nginx's own address.
//
// TESTING: express-rate-limit keeps ONE in-memory store per limiter for the whole process, and
// jest runs every suite in that one process — so if these counted normally, high-volume suites
// would trip the API limiter. They are therefore INERT under NODE_ENV=test UNLESS a request opts
// in with the header `x-ratelimit-test: on` (the rate-limit test does; nothing else does). SSE and
// health are always exempt from the general limiter so realtime + probes never get throttled.
const { rateLimit } = require('express-rate-limit');
const config = require('./../config/env');

const LOGIN_MSG = 'Terlalu banyak percobaan, coba lagi dalam beberapa menit.';
const FORGOT_MSG = 'Terlalu banyak permintaan. Coba lagi nanti.';
const API_MSG = 'Terlalu banyak permintaan dari perangkat ini. Coba lagi sebentar lagi.';

// In test, skip unless the caller explicitly opts in (so the rate-limit suite can exercise it
// while every other suite is unaffected).
const testInert = (req) => config.isTest && req.headers['x-ratelimit-test'] !== 'on';
const send429 = (message) => (req, res) => res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });

const common = { standardHeaders: 'draft-7', legacyHeaders: false };

// Login: only FAILED attempts count (skipSuccessfulRequests) — a user who types the right password
// is never locked out; a brute-forcer (all failures) hits the wall.
const loginLimiter = rateLimit({
  ...common, windowMs: config.rateLimit.loginWindowMs, limit: config.rateLimit.loginMax,
  skipSuccessfulRequests: true, skip: testInert, handler: send429(LOGIN_MSG),
});

// Forgot password: 5/hour/IP.
const forgotLimiter = rateLimit({
  ...common, windowMs: config.rateLimit.forgotWindowMs, limit: config.rateLimit.forgotMax,
  skip: testInert, handler: send429(FORGOT_MSG),
});

// General API guard: generous cap on ALL /api/v1 traffic so a bug/abuse can't hammer the box.
// SSE (long-lived) and the health probe are always exempt.
const isExemptPath = (req) => { const p = (req.originalUrl || '').split('?')[0]; return p === '/api/v1/events' || p === '/api/v1/health' || p === '/api/v1/version'; };
const apiLimiter = rateLimit({
  ...common, windowMs: config.rateLimit.apiWindowMs, limit: config.rateLimit.apiMax,
  skip: (req) => isExemptPath(req) || testInert(req), handler: send429(API_MSG),
});

// Data wipe: the most destructive endpoint in the app. Deliberately tight — a handful of
// attempts per hour is far more than any legitimate cleanup needs, and it blunts any
// scripted abuse of a borrowed session.
const WIPE_MSG = 'Terlalu banyak percobaan penghapusan data. Coba lagi nanti.';
const wipeLimiter = rateLimit({
  ...common, windowMs: 60 * 60 * 1000, limit: 5,
  skip: testInert, handler: send429(WIPE_MSG),
});

module.exports = { loginLimiter, forgotLimiter, apiLimiter, wipeLimiter, LOGIN_MSG, FORGOT_MSG, API_MSG, WIPE_MSG };
