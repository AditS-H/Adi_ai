/**
 * Health Check Route
 * GET /api/health
 * 
 * Returns comprehensive system status including:
 * - Server uptime and timestamp
 * - AI provider health scores
 * - Database connectivity and document count
 * - Cache connectivity and type
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Lazy-loaded dependencies (resolved at request time to avoid circular imports)
let _supabase = null;
let _cacheService = null;
let _ProviderRouter = null;

function getSupabase() {
  if (!_supabase) {
    try {
      _supabase = require('../config/database');
    } catch (err) {
      logger.warn('Supabase client not available for health check', { error: err.message });
    }
  }
  return _supabase;
}

function getCacheService() {
  if (!_cacheService) {
    try {
      _cacheService = require('../services/cache');
    } catch (err) {
      logger.warn('Cache service not available for health check', { error: err.message });
    }
  }
  return _cacheService;
}

function getProviderRouter() {
  if (!_ProviderRouter) {
    try {
      const routerModule = require('../services/router');
      _ProviderRouter = routerModule.ProviderRouter;
    } catch (err) {
      logger.warn('ProviderRouter not available for health check', { error: err.message });
    }
  }
  return _ProviderRouter;
}

/**
 * Check database connectivity and get document count
 * @returns {{ connected: boolean, documentsIndexed: number, error?: string }}
 */
async function checkDatabase() {
  const supabase = getSupabase();
  if (!supabase) {
    return { connected: false, documentsIndexed: 0, error: 'Supabase client not initialized' };
  }

  try {
    const { count, error } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (error) {
      logger.warn('Database health check query failed', { error: error.message });
      return { connected: false, documentsIndexed: 0, error: error.message };
    }

    return { connected: true, documentsIndexed: count || 0 };
  } catch (err) {
    logger.warn('Database health check failed', { error: err.message });
    return { connected: false, documentsIndexed: 0, error: err.message };
  }
}

/**
 * Check cache connectivity and type
 * @returns {{ connected: boolean, type: string, error?: string }}
 */
async function checkCache() {
  const cacheService = getCacheService();
  if (!cacheService) {
    return { connected: false, type: 'none', error: 'Cache service not initialized' };
  }

  try {
    // Attempt a simple set/get cycle to verify connectivity
    const testKey = '__health_check__';
    const testValue = Date.now().toString();

    await cacheService.set(testKey, testValue, 10);
    const retrieved = await cacheService.get(testKey);
    await cacheService.delete(testKey);

    const connected = String(retrieved) === testValue;
    const type = cacheService.type || (cacheService.isRedis ? 'redis' : 'memory');

    return { connected, type };
  } catch (err) {
    logger.warn('Cache health check failed', { error: err.message });
    return {
      connected: false,
      type: cacheService.type || 'unknown',
      error: err.message
    };
  }
}

/**
 * Get provider health information
 * @returns {Object} Provider health data
 */
async function checkProviders() {
  const ProviderRouter = getProviderRouter();
  if (!ProviderRouter) {
    return { available: false, error: 'ProviderRouter not initialized' };
  }

  try {
    const router = ProviderRouter.getInstance();
    if (router && typeof router.getHealth === 'function') {
      return await router.getHealth();
    }

    // Fallback: try static method
    if (typeof ProviderRouter.getHealth === 'function') {
      return await ProviderRouter.getHealth();
    }

    return { available: false, error: 'No health method found on ProviderRouter' };
  } catch (err) {
    logger.warn('Provider health check failed', { error: err.message });
    return { available: false, error: err.message };
  }
}

// ─── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const startTime = Date.now();

  try {
    // Run all health checks in parallel for speed
    const [database, cache, providers] = await Promise.all([
      checkDatabase(),
      checkCache(),
      checkProviders()
    ]);

    const responseTime = Date.now() - startTime;

    // Determine overall status
    const isHealthy = database.connected;
    const status = isHealthy ? 'ok' : 'degraded';

    const healthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${responseTime}ms`,
      providers,
      database: {
        connected: database.connected,
        documentsIndexed: database.documentsIndexed,
        ...(database.error && { error: database.error })
      },
      cache: {
        connected: cache.connected,
        type: cache.type,
        ...(cache.error && { error: cache.error })
      }
    };

    const statusCode = isHealthy ? 200 : 503;
    return res.status(statusCode).json(healthResponse);
  } catch (err) {
    logger.error('Health check endpoint failed unexpectedly', {
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      error: 'Health check failed',
      providers: { available: false },
      database: { connected: false, documentsIndexed: 0 },
      cache: { connected: false, type: 'unknown' }
    });
  }
});

module.exports = router;
