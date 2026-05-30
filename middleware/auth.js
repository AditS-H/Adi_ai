// ═══════════════════════════════════════════════════
// Admin Authentication Middleware
// ═══════════════════════════════════════════════════

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
let supabase = null;

try {
  supabase = require('../config/database');
} catch {
  supabase = null;
}

/**
 * Verify the Authorization header carries a valid admin Bearer token.
 * Returns 401 on missing / incorrect token.
 */
async function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Admin auth failed — missing or malformed Authorization header', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (config.admin.token && token === config.admin.token) {
    return next();
  }

  if (!supabase) {
    logger.warn('Admin auth failed — Supabase unavailable for token check', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data, error } = await supabase
      .from('admin_tokens')
      .select('id')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      logger.warn('Admin auth failed — token lookup error', {
        ip: req.ip,
        path: req.path,
        error: error.message,
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    if (!data) {
      logger.warn('Admin auth failed — invalid token', {
        ip: req.ip,
        path: req.path,
      });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    supabase
      .from('admin_tokens')
      .update({ last_used: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {})
      .catch(() => {});

    return next();
  } catch (err) {
    logger.warn('Admin auth failed — unexpected error', {
      ip: req.ip,
      path: req.path,
      error: err.message,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }
}

module.exports = adminAuth;
