// ═══════════════════════════════════════════════════
// Rate Limiting Middleware
// ═══════════════════════════════════════════════════

const rateLimit = require('express-rate-limit');
const config = require('../config');

// ---------------------------------------------------------------------------
// Shared handler for 429 responses
// ---------------------------------------------------------------------------
function limitHandler(req, res) {
  const retryAfter = Math.ceil(res.getHeader('Retry-After') || 60);
  return res.status(429).json({
    success: false,
    error: 'Rate limit exceeded. Please try again later.',
    retryAfter,
  });
}

// ---------------------------------------------------------------------------
// Chat endpoint limiter — 30 requests per 10 minutes (configurable)
// ---------------------------------------------------------------------------
const chatLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
  keyGenerator: (req) => req.ip,
});

// ---------------------------------------------------------------------------
// Admin endpoint limiter — 10 requests per minute
// ---------------------------------------------------------------------------
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
  keyGenerator: (req) => req.ip,
});

// ---------------------------------------------------------------------------
// Health endpoint limiter — 60 requests per minute
// ---------------------------------------------------------------------------
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
  keyGenerator: (req) => req.ip,
});

module.exports = { chatLimiter, adminLimiter, healthLimiter };
