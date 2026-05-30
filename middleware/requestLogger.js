// ═══════════════════════════════════════════════════
// Request Logger Middleware
// ═══════════════════════════════════════════════════

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Assigns a UUID request ID and logs request/response metadata.
 */
function requestLogger(req, res, next) {
  // Assign a unique request ID
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();

  // Log the incoming request
  logger.http('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent') || 'unknown',
  });

  // Log response time when the response finishes
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http('Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime: `${duration}ms`,
    });
  });

  next();
}

module.exports = requestLogger;
