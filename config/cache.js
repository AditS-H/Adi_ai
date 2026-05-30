// ═══════════════════════════════════════════════════
// Upstash Redis Client
// ═══════════════════════════════════════════════════

const { Redis } = require('@upstash/redis');
const config = require('./index');
const logger = require('../utils/logger');

let redis = null;

try {
  if (config.redis.url && config.redis.token) {
    redis = new Redis({
      url: config.redis.url,
      token: config.redis.token,
    });
    logger.info('✅ Upstash Redis client initialized');
  } else {
    logger.warn(
      '⚠️  Upstash Redis not configured — caching will use in-memory fallback only. ' +
      'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your .env file.'
    );
  }
} catch (error) {
  logger.error('❌ Failed to initialize Upstash Redis client:', error.message);
  redis = null;
}

module.exports = redis;
