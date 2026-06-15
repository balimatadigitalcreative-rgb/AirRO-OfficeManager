'use strict';

// Validates and coerces req.body / req.query / req.params against Zod schemas.
// On success the parsed (typed/coerced) values replace the originals so
// controllers receive clean data. On failure a ZodError flows to the handler.
module.exports = (schemas) => (req, res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) req.query = schemas.query.parse(req.query);
    if (schemas.params) req.params = schemas.params.parse(req.params);
    next();
  } catch (err) {
    next(err);
  }
};
