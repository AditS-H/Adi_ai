'use strict';

const { LRUCache } = require('lru-cache');

/**
 * MemoryCache - In-memory LRU cache using lru-cache v11+
 * Used as a fast local cache and fallback when Redis is unavailable.
 */
class MemoryCache {
  /**
   * @param {object} options
   * @param {number} options.maxItems - Maximum number of items in cache (default: 1000)
   * @param {number} options.ttl - Default TTL in milliseconds (default: 3600000 = 1 hour)
   */
  constructor({ maxItems = 1000, ttl = 3600000 } = {}) {
    this.cache = new LRUCache({
      max: maxItems,
      ttl: ttl,
    });
    this.defaultTTL = ttl;
    this.maxItems = maxItems;
    console.log(`[MemoryCache] Initialized with max=${maxItems}, defaultTTL=${ttl}ms`);
  }

  /**
   * Retrieve a value from the cache.
   * @param {string} key
   * @returns {Promise<*>} The cached value or undefined if not found/expired
   */
  async get(key) {
    try {
      const value = this.cache.get(key);
      if (value !== undefined) {
        console.log(`[MemoryCache] HIT: ${key}`);
        return value;
      }
      console.log(`[MemoryCache] MISS: ${key}`);
      return undefined;
    } catch (error) {
      console.error(`[MemoryCache] Error getting key "${key}":`, error.message);
      return undefined;
    }
  }

  /**
   * Store a value in the cache.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlSeconds] - TTL in seconds (overrides default). Converted to ms internally.
   * @returns {Promise<void>}
   */
  async set(key, value, ttlSeconds) {
    try {
      const options = {};
      if (ttlSeconds !== undefined && ttlSeconds !== null) {
        options.ttl = ttlSeconds * 1000; // Convert seconds to milliseconds
      }
      this.cache.set(key, value, options);
      console.log(`[MemoryCache] SET: ${key} (TTL: ${ttlSeconds ? ttlSeconds + 's' : 'default'})`);
    } catch (error) {
      console.error(`[MemoryCache] Error setting key "${key}":`, error.message);
    }
  }

  /**
   * Delete a specific key from the cache.
   * @param {string} key
   * @returns {Promise<boolean>} True if the key existed and was deleted
   */
  async delete(key) {
    try {
      const existed = this.cache.delete(key);
      console.log(`[MemoryCache] DELETE: ${key} (existed: ${existed})`);
      return existed;
    } catch (error) {
      console.error(`[MemoryCache] Error deleting key "${key}":`, error.message);
      return false;
    }
  }

  /**
   * Clear all entries from the cache.
   * @returns {Promise<void>}
   */
  async flush() {
    try {
      this.cache.clear();
      console.log('[MemoryCache] FLUSHED: All entries cleared');
    } catch (error) {
      console.error('[MemoryCache] Error flushing cache:', error.message);
    }
  }

  /**
   * Get cache statistics.
   * @returns {Promise<{size: number, maxSize: number}>}
   */
  async getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxItems,
    };
  }
}

module.exports = MemoryCache;
