'use strict';

/**
 * VectorRetriever - Performs vector similarity search and full-text fallback
 * against the Supabase documents table using pgvector cosine similarity.
 */
class VectorRetriever {
  /**
   * @param {object} supabase - Supabase client instance
   */
  constructor(supabase) {
    if (!supabase) {
      throw new Error('[VectorRetriever] Supabase client is required');
    }
    this.supabase = supabase;
    console.log('[VectorRetriever] Initialized');
  }

  /**
   * Search for similar documents using vector similarity (pgvector cosine distance).
   * Calls the match_documents Supabase RPC function.
   * @param {number[]} embedding - Query embedding vector (768-dim)
   * @param {object} options
   * @param {number} [options.topK=5] - Maximum results to return
   * @param {number} [options.threshold=0.7] - Minimum similarity threshold
   * @param {string|null} [options.sourceType=null] - Filter by source type
   * @returns {Promise<Array<{id: string, content: string, source_type: string, source_id: string, source_url: string, metadata: object, similarity: number}>>}
   */
  async search(embedding, options = {}) {
    const {
      topK = 5,
      threshold = 0.7,
      sourceType = null,
    } = options;

    if (!embedding || !Array.isArray(embedding)) {
      console.error('[VectorRetriever] Invalid embedding provided');
      return [];
    }

    try {
      const { data, error } = await this.supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: topK,
        filter_source_type: sourceType,
      });

      if (error) {
        console.error('[VectorRetriever] Vector search RPC error:', error.message);
        return [];
      }

      if (!data || data.length === 0) {
        console.log('[VectorRetriever] No results above similarity threshold');
        return [];
      }

      console.log(
        `[VectorRetriever] Found ${data.length} results ` +
        `(threshold=${threshold}, topK=${topK})`
      );

      return data;
    } catch (error) {
      console.error('[VectorRetriever] Vector search failed:', error.message);
      return [];
    }
  }

  /**
   * Fallback full-text search using PostgreSQL ts_vector when embeddings are unavailable.
   * Tries RPC first, falls back to Supabase query builder.
   * @param {string} question - Search query text
   * @param {number} topK - Maximum results to return
   * @returns {Promise<Array<{id: string, content: string, source_type: string, source_id: string, source_url: string, metadata: object, similarity: number}>>}
   */
  async fallbackSearch(question, topK = 5) {
    if (!question || typeof question !== 'string') {
      console.error('[VectorRetriever] Invalid question for fallback search');
      return [];
    }

    console.log(`[VectorRetriever] Performing full-text fallback search: "${question.substring(0, 50)}..."`);

    // Try RPC-based full-text search first
    try {
      const { data, error } = await this.supabase.rpc('fulltext_search', {
        search_query: question,
        result_limit: topK,
      });

      if (!error && data && data.length > 0) {
        console.log(`[VectorRetriever] Full-text RPC returned ${data.length} results`);
        return data;
      }

      if (error) {
        console.warn('[VectorRetriever] Full-text RPC not available:', error.message);
      }
    } catch (rpcError) {
      console.warn('[VectorRetriever] Full-text RPC failed, trying query builder:', rpcError.message);
    }

    // Fallback to Supabase query builder with textSearch
    try {
      const { data, error } = await this.supabase
        .from('documents')
        .select('id, content, source_type, source_id, source_url, metadata')
        .eq('is_active', true)
        .textSearch('content', question, {
          type: 'websearch',
          config: 'english',
        })
        .limit(topK);

      if (error) {
        console.error('[VectorRetriever] Query builder text search error:', error.message);
        return [];
      }

      // Add a basic similarity score based on position (descending relevance)
      const results = (data || []).map((row, index) => ({
        ...row,
        similarity: 1 - index * 0.1, // Approximate ranking
      }));

      console.log(`[VectorRetriever] Query builder returned ${results.length} results`);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      console.error('[VectorRetriever] Fallback text search failed:', error.message);
    }

    // Last-resort fallback: keyword-based ILIKE on source_id/content
    const stopwords = new Set(['the', 'and', 'for', 'from', 'with', 'your', 'about', 'repo', 'github', 'data', 'summarize', 'tell', 'me', 'my', 'bullet', 'points']);
    const tokens = (question.toLowerCase().match(/[a-z0-9_-]{3,}/g) || [])
      .filter((token) => !stopwords.has(token));

    if (tokens.length === 0) {
      return [];
    }

    const uniqueTokens = Array.from(new Set(tokens)).slice(0, 5);
    const sourceOr = uniqueTokens.map((token) => `source_id.ilike.%${token}%`).join(',');
    const contentOr = uniqueTokens.map((token) => `content.ilike.%${token}%`).join(',');

    try {
      const { data: sourceMatches, error: sourceError } = await this.supabase
        .from('documents')
        .select('id, content, source_type, source_id, source_url, metadata')
        .eq('is_active', true)
        .or(sourceOr)
        .limit(topK);

      if (!sourceError && sourceMatches && sourceMatches.length > 0) {
        return sourceMatches.map((row, index) => ({
          ...row,
          similarity: 0.6 - index * 0.05,
        }));
      }
    } catch (error) {
      console.warn('[VectorRetriever] source_id ILIKE fallback failed:', error.message);
    }

    try {
      const { data: contentMatches, error: contentError } = await this.supabase
        .from('documents')
        .select('id, content, source_type, source_id, source_url, metadata')
        .eq('is_active', true)
        .or(contentOr)
        .limit(topK);

      if (contentError) {
        console.error('[VectorRetriever] content ILIKE fallback error:', contentError.message);
        return [];
      }

      return (contentMatches || []).map((row, index) => ({
        ...row,
        similarity: 0.5 - index * 0.05,
      }));
    } catch (error) {
      console.error('[VectorRetriever] content ILIKE fallback failed:', error.message);
      return [];
    }
  }
}

module.exports = VectorRetriever;
