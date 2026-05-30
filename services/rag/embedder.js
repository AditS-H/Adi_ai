'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const cacheService = require('../cache/index');

/**
 * EmbeddingService - Generates text embeddings using Gemini text-embedding-004.
 * Caches embeddings by content hash for 24 hours.
 * Returns null on failure so callers can fall back to text search.
 */
class EmbeddingService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    this.embeddingModelName = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
    this.fallbackModelName = this.embeddingModelName === 'text-embedding-004'
      ? 'embedding-001'
      : 'text-embedding-004';
    this.fallbackAttempted = false;

    if (!apiKey) {
      console.warn(
        '[EmbeddingService] GEMINI_API_KEY not set. Embedding calls will return null.'
      );
      this.model = null;
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this._initModel(this.embeddingModelName);
    }
  }

  _initModel(modelName) {
    this.embeddingModelName = modelName;
    this.model = this.genAI.getGenerativeModel({ model: modelName });
    console.log(`[EmbeddingService] Initialized with Gemini ${modelName}`);
  }

  /**
   * Generate an embedding for a single text string.
   * Results are cached by SHA-256 hash of the input text.
   * @param {string} text - Input text to embed
   * @returns {Promise<number[]|null>} 768-dimensional embedding vector, or null on failure
   */
  async embed(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.warn('[EmbeddingService] Empty text provided for embedding');
      return null;
    }

    if (!this.model) {
      console.error('[EmbeddingService] Model not initialized (missing API key)');
      return null;
    }

    // Create cache key from content hash
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const cacheKey = `embed:${hash}`;

    // Check cache first
    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        console.log(`[EmbeddingService] Cache HIT for embed:${hash.substring(0, 12)}...`);
        return cached;
      }
    } catch (error) {
      console.warn('[EmbeddingService] Cache lookup failed:', error.message);
    }

    // Generate embedding via Gemini API
    try {
      const result = await this.model.embedContent({
        content: { parts: [{ text }] },
      });

      if (!result || !result.embedding || !result.embedding.values) {
        console.error('[EmbeddingService] Unexpected response format from Gemini');
        return null;
      }

      const embedding = result.embedding.values;

      // Cache the result for 24 hours (86400 seconds)
      try {
        await cacheService.set(cacheKey, embedding, 86400);
        console.log(
          `[EmbeddingService] Generated and cached embedding (${embedding.length}-dim) ` +
          `for hash ${hash.substring(0, 12)}...`
        );
      } catch (cacheError) {
        console.warn('[EmbeddingService] Failed to cache embedding:', cacheError.message);
      }

      return embedding;
    } catch (error) {
      const message = error.message || '';
      const modelNotFound =
        message.includes('models/') &&
        (message.includes('not found') || message.includes('not supported for embedContent'));

      if (modelNotFound && !this.fallbackAttempted && this.fallbackModelName) {
        this.fallbackAttempted = true;
        console.warn(
          `[EmbeddingService] Model ${this.embeddingModelName} unavailable. ` +
          `Falling back to ${this.fallbackModelName}.`
        );
        this._initModel(this.fallbackModelName);
        return this.embed(text);
      }

      console.error('[EmbeddingService] Embedding generation failed:', error.message);
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts in batches.
   * Respects rate limits by waiting between batches.
   * @param {string[]} texts - Array of texts to embed
   * @param {number} batchSize - Number of texts per batch (default: 10)
   * @returns {Promise<Array<number[]|null>>} Array of embeddings (null for failed items)
   */
  async embedBatch(texts, batchSize = 10) {
    if (!Array.isArray(texts) || texts.length === 0) {
      console.warn('[EmbeddingService] Empty texts array provided for batch embedding');
      return [];
    }

    console.log(
      `[EmbeddingService] Starting batch embedding: ${texts.length} texts, ` +
      `batch size ${batchSize}`
    );

    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);

      console.log(
        `[EmbeddingService] Processing batch ${batchNum}/${totalBatches} ` +
        `(${batch.length} texts)`
      );

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map((text) => this.embed(text))
      );

      allEmbeddings.push(...batchResults);

      // Wait between batches to respect rate limits (skip after last batch)
      if (i + batchSize < texts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const successCount = allEmbeddings.filter(Boolean).length;
    console.log(
      `[EmbeddingService] Batch complete: ${successCount}/${texts.length} successful`
    );

    return allEmbeddings;
  }
}

module.exports = EmbeddingService;
