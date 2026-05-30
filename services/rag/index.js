'use strict';

const EmbeddingService = require('./embedder');
const VectorRetriever = require('./retriever');
const config = require('../../config');

/**
 * RAGEngine - Retrieval Augmented Generation engine.
 * Orchestrates embedding, retrieval, filtering, and context building.
 */
class RAGEngine {
  /**
   * @param {object} supabase - Supabase client instance
   */
  constructor(supabase) {
    if (!supabase) {
      throw new Error('[RAGEngine] Supabase client is required');
    }

    this.embedder = new EmbeddingService();
    this.retriever = new VectorRetriever(supabase);

    // Max context tokens (configurable via env, default 2000 tokens ≈ 8000 chars)
    this.maxContextTokens = config.rag?.maxContextTokens || 2000;
    this.enableRerank = config.rag?.rerankEnabled ?? true;
    this.rerankTopK = config.rag?.rerankTopK || 10;

    console.log(
      `[RAGEngine] Initialized (maxContextTokens=${this.maxContextTokens})`
    );
  }

  /**
   * Estimate the number of tokens in a text (rough: 1 token ≈ 4 chars).
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  _tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  }

  _keywordScore(question, content) {
    const questionTokens = new Set(this._tokenize(question));
    if (questionTokens.size === 0) return 0;

    const contentTokens = new Set(this._tokenize(content));
    let overlap = 0;
    for (const token of questionTokens) {
      if (contentTokens.has(token)) overlap += 1;
    }

    return overlap / questionTokens.size;
  }

  /**
   * Retrieve relevant context for a question.
   * 1. Embed the question
   * 2. Vector search (or fallback to full-text)
   * 3. Filter by similarity threshold
   * 4. Sort by similarity (highest first)
   * 5. Build context within token budget
   * @param {string} question - User's question
   * @param {object} options
   * @param {number} [options.topK=5] - Max chunks to retrieve
   * @param {number} [options.threshold=0.7] - Minimum similarity
   * @param {string|null} [options.sourceType=null] - Filter by source type
   * @returns {Promise<{context: string, chunks: Array, totalTokens: number}>}
   */
  async retrieve(question, options = {}) {
    const {
      topK = 5,
      threshold = 0.7,
      sourceType = null,
    } = options;

    const requestedTopK = this.enableRerank ? Math.max(topK, this.rerankTopK) : topK;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      console.warn('[RAGEngine] Empty question provided');
      return { context: '', chunks: [], totalTokens: 0 };
    }

    console.log(`[RAGEngine] Retrieving context for: "${question.substring(0, 80)}..."`);

    let chunks = [];
    let usedFallback = false;

    // Step 1: Embed the question
    const embedding = await this.embedder.embed(question);

    // Step 2: Search
    if (embedding) {
      // Vector similarity search
      console.log('[RAGEngine] Using vector search');
      chunks = await this.retriever.search(embedding, {
        topK: requestedTopK,
        threshold,
        sourceType,
      });
    } else {
      // Fallback to full-text search when embedding fails
      console.warn('[RAGEngine] Embedding failed, using full-text fallback');
      chunks = await this.retriever.fallbackSearch(question, requestedTopK);
      usedFallback = true;
    }

    // Step 3: Filter by similarity threshold
    if (!usedFallback) {
      chunks = chunks.filter((chunk) => {
        const similarity = chunk.similarity || 0;
        return similarity >= threshold;
      });
    }

    // If vector search returned nothing, attempt full-text fallback
    if (!usedFallback && chunks.length === 0) {
      console.warn('[RAGEngine] No vector results above threshold, trying full-text fallback');
      chunks = await this.retriever.fallbackSearch(question, requestedTopK);
      usedFallback = true;
    }

    // Step 4: Sort by similarity (highest first)
    chunks.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

    // Step 4b: Optional keyword re-ranking
    if (this.enableRerank && chunks.length > 1) {
      chunks = chunks.map((chunk) => {
        const keywordScore = this._keywordScore(question, chunk.content || '');
        const similarity = chunk.similarity || 0;
        const combinedScore = similarity * 0.7 + keywordScore * 0.3;

        return {
          ...chunk,
          keyword_score: keywordScore,
          combined_score: combinedScore,
        };
      });

      chunks.sort((a, b) => (b.combined_score || 0) - (a.combined_score || 0));

      if (chunks.length > topK) {
        chunks = chunks.slice(0, topK);
      }
    }

    // Step 5: Build context string within token budget
    const contextParts = [];
    let totalTokens = 0;
    const usedChunks = [];

    for (const chunk of chunks) {
      // Format chunk with source information
      const formattedChunk =
        `---\nSource: ${chunk.source_type} - ${chunk.source_id}\n${chunk.content}\n---`;

      const chunkTokens = this.estimateTokens(formattedChunk);

      // Check if adding this chunk would exceed the budget
      if (totalTokens + chunkTokens > this.maxContextTokens) {
        console.log(
          `[RAGEngine] Token budget reached (${totalTokens}/${this.maxContextTokens}). ` +
          `Stopping at ${usedChunks.length} chunks.`
        );
        break;
      }

      contextParts.push(formattedChunk);
      totalTokens += chunkTokens;
      usedChunks.push(chunk);
    }

    const context = contextParts.join('\n\n');

    console.log(
      `[RAGEngine] Retrieved ${usedChunks.length} chunks, ` +
      `${totalTokens} tokens, ${context.length} chars`
    );

    return {
      context,
      chunks: usedChunks,
      totalTokens,
    };
  }
}

module.exports = RAGEngine;
