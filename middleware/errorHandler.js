// ═══════════════════════════════════════════════════
// Global Error Handler Middleware
// ═══════════════════════════════════════════════════

const logger = require('../utils/logger');
const config = require('../config');

/**
 * Express error-handling middleware (4-arg signature).
 * Formats all errors into a consistent JSON shape and hides stack traces
 * in production.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Determine status code
  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';

  // Log the full error server-side
  logger.error('Unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode,
    errorCode,
    message: err.message,
    stack: err.stack,
  });

  // Build client-facing response
  const response = {
    success: false,
    error: statusCode === 500
      ? 'An unexpected error occurred. Please try again later.'
      : err.message,
    code: errorCode,
  };

  // Include details only in development
  if (!config.server.isProduction) {
    response.details = {
      message: err.message,
      stack: err.stack,
    };
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
