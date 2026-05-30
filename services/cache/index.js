'use strict';

const RedisCache = require('./redis');
const MemoryCache = require('./memory');
const config = require('../../config');

/**
 * CacheService - Unified cache interface wrapping Redis (primary) and Memory (fallback).
 * On Redis hit, values are promoted to memory for faster subsequent access.
 * Writes go to both layers simultaneously for consistency.
 */
class CacheService {
  constructor() {
    // Always create memory cache as fallback
    this.memory = new MemoryCache();
    this.redis = null;
    this.useRedis = false;
    this.type = 'memory';
    this.isRedis = false;

    // Try to initialize Redis from environment variables
    const redisUrl = config.redis?.url || process.env.UPSTASH_REDIS_URL;
    const redisToken = config.redis?.token || process.env.UPSTASH_REDIS_TOKEN;

    if (redisUrl && redisToken) {
      try {
        this.redis = new RedisCache(redisUrl, redisToken);
        this.useRedis = true;
        this.type = 'redis';
        this.isRedis = true;
        console.log('[CacheService] Initialized with Redis (primary) + Memory (fallback)');

        // Verify Redis connectivity in the background
        this.redis.ping().then((ok) => {
          if (!ok) {
            console.warn('[CacheService] Redis ping failed. Falling back to memory-only.');
            this.useRedis = false;
            this.type = 'memory';
            this.isRedis = false;
          }
        }).catch(() => {
          console.warn('[CacheService] Redis ping error. Falling back to memory-only.');
          this.useRedis = false;
          this.type = 'memory';
          this.isRedis = false;
        });
      } catch (error) {
        console.warn('[CacheService] Failed to initialize Redis:', error.message);
        console.warn('[CacheService] Using memory-only cache.');
        this.useRedis = false;
        this.type = 'memory';
        this.isRedis = false;
      }
    } else {
      console.log('[CacheService] No Redis credentials found. Using memory-only cache.');
    }
  }

  /**
   * Retrieve a value. Checks Redis first, then memory.
   * On Redis hit, promotes value to memory for faster subsequent access.
   * @param {string} key
   * @returns {Promise<*>} The cached value or null/undefined if not found
   */
  async get(key) {
    // Try Redis first
    if (this.useRedis && this.redis) {
      try {
        const redisValue = await this.redis.get(key);
        if (redisValue !== null && redisValue !== undefined) {
          // Promote to memory for faster subsequent access
          await this.memory.set(key, redisValue);
          return redisValue;
        }
      } catch (error) {
        console.error('[CacheService] Redis get error, trying memory:', error.message);
      }
    }

    // Fallback to memory
    const memoryValue = await this.memory.get(key);
    return memoryValue !== undefined ? memoryValue : null;
  }

  /**
   * Store a value in both Redis and memory.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlSeconds] - TTL in seconds
   * @returns {Promise<void>}
   */
  async set(key, value, ttlSeconds) {
    // Set in memory (always)
    await this.memory.set(key, value, ttlSeconds);

    // Set in Redis (if available)
    if (this.useRedis && this.redis) {
      try {
        await this.redis.set(key, value, ttlSeconds);
      } catch (error) {
        console.error('[CacheService] Redis set error (memory still set):', error.message);
      }
    }
  }

  /**
   * Delete a key from both Redis and memory.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async delete(key) {
    // Delete from memory
    await this.memory.delete(key);

    // Delete from Redis
    if (this.useRedis && this.redis) {
      try {
        await this.redis.delete(key);
      } catch (error) {
        console.error('[CacheService] Redis delete error:', error.message);
      }
    }
  }

  /**
   * Flush all entries from both Redis and memory.
   * @returns {Promise<void>}
   */
  async flush() {
    await this.memory.flush();

    if (this.useRedis && this.redis) {
      try {
        await this.redis.flush();
      } catch (error) {
        console.error('[CacheService] Redis flush error:', error.message);
      }
    }

    console.log('[CacheService] All caches flushed');
  }

  /**
   * Get the current cache status.
   * @returns {Promise<{type: string, connected: boolean}>}
   */
  async getStatus() {
    if (this.useRedis && this.redis) {
      try {
        const connected = await this.redis.ping();
        return { type: 'redis', connected };
      } catch {
        return { type: 'redis', connected: false };
      }
    }
    return { type: 'memory', connected: true };
  }
}

// Export singleton instance
module.exports = new CacheService();
