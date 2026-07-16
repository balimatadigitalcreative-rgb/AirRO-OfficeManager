'use strict';
const ApiError = require('../utils/ApiError');

// Tiny in-memory fixed-window rate limiter — enough for a single-process, small-team app
// (no Redis). Keys by the first X-Forwarded-For hop (behind nginx) or the socket IP. Used to
// stop the PUBLIC /auth/forgot endpoint from being spammed. Not a security boundary on its own.
function rateLimit({ windowMs = 60 * 60 * 1000, max = 5, message = 'Terlalu banyak permintaan. Coba lagi nanti.' } = {}) {
  const hits = new Map();   // key → { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const key = fwd || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) { rec = { count: 0, resetAt: now + windowMs }; hits.set(key, rec); }
    rec.count++;
    // opportunistic cleanup so the Map can't grow unbounded
    if (hits.size > 5000) { for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); }
    if (rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
      return next(ApiError.tooMany ? ApiError.tooMany(message) : new ApiError(429, 'TOO_MANY_REQUESTS', message));
    }
    next();
  };
}

module.exports = rateLimit;
