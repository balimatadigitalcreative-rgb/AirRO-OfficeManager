'use strict';

// Wraps an async route handler so rejected promises flow to next() and hit
// the centralized error middleware instead of crashing the process.
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
