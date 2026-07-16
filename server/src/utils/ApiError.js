'use strict';

// Operational error carrying an HTTP status, a machine-readable code, and
// optional structured details. Thrown anywhere; caught by the error handler.
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to do that') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message = 'Resource already exists', details) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'TOO_MANY_REQUESTS', message);
  }
}

module.exports = ApiError;
