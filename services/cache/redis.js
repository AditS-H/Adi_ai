'use strict';

const { Redis } = require('@upstash/redis');

/**
 * RedisCache - Upstash Redis HTTP-based cache client
 * Serverless Redis with no persistent connection needed.
 * All methods are wrapped in try/catch for graceful degradation.
 */
class RedisCache {
  /**
   * @param {string} url - Upstash Redis REST URL
   * @param {string} token - Upstash Redis REST token
   */
  constructor(url, token) {
    if (!url || !token) {
      throw new Error('[RedisCache] Missing url or token for Upstash Redis');
    }
    this.redis = new Redis({ url, token });
    this.connected = false;
    console.log('[RedisCache] Initialized with Upstash Redis');
  }

  /**
   * Retrieve a value from Redis.
   * Upstash redis.get auto-deserializes JSON, but we handle string fallback.
   * @param {string} key
   * @returns {Promise<*>} Parsed value or null on failure
   */
  async get(key) {
    try {
      const result = await this.redis.get(key);
      if (result === null || result === undefined) {
        console.log(`[RedisCache] MISS: ${key}`);
        return null;
      }
      // Upstash SDK auto-deserializes JSON for us, but if the value
      // was stored as a JSON string, we may need to parse it
      let value = result;
      if (typeof result === 'string') {
        try {
          value = JSON.parse(result);
        } catch {
          // Not JSON, return as-is
          value = result;
        }
      }
      console.log(`[RedisCache] HIT: ${key}`);
      return value;
    } catch (error) {
      console.error(`[RedisCache] Error getting key "${key}":`, error.message);
      return null;
    }
  }

  /**
   * Store a value in Redis with optional TTL.
   * @param {string} key
   * @param {*} value - Will be JSON.stringified
   * @param {number} [ttlSeconds] - Time-to-live in seconds
   * @returns {Promise<boolean>} True on success, false on failure
   */
  async set(key, value, ttlSeconds) {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds > 0) {
        await this.redis.set(key, serialized, { ex: ttlSeconds });
      } else {
        await this.redis.set(key, serialized);
      }
      console.log(`[RedisCache] SET: ${key} (TTL: ${ttlSeconds ? ttlSeconds + 's' : 'none'})`);
      return true;
    } catch (error) {
      console.error(`[RedisCache] Error setting key "${key}":`, error.message);
      return false;
    }
  }

  /**
   * Delete a key from Redis.
   * @param {string} key
   * @returns {Promise<boolean>} True on success, false on failure
   */
  async delete(key) {
    try {
      await this.redis.del(key);
      console.log(`[RedisCache] DELETE: ${key}`);
      return true;
    } catch (error) {
      console.error(`[RedisCache] Error deleting key "${key}":`, error.message);
      return false;
    }
  }

  /**
   * Flush all keys from the Redis database.
   * @returns {Promise<boolean>} True on success, false on failure
   */
  async flush() {
    try {
      await this.redis.flushdb();
      console.log('[RedisCache] FLUSHED: All keys cleared');
      return true;
    } catch (error) {
      console.error('[RedisCache] Error flushing database:', error.message);
      return false;
    }
  }

  /**
   * Ping Redis to check connectivity.
   * @returns {Promise<boolean>} True if Redis is reachable
   */
  async ping() {
    try {
      const result = await this.redis.ping();
      this.connected = result === 'PONG';
      console.log(`[RedisCache] PING: ${this.connected ? 'OK' : 'FAILED'}`);
      return this.connected;
    } catch (error) {
      console.error('[RedisCache] Ping failed:', error.message);
      this.connected = false;
      return false;
    }
  }
}

module.exports = RedisCache;
