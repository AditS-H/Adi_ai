'use strict';

const EmbeddingService = require('../rag/embedder');

/**
 * KnowledgeManager - High-level API for managing documents in the knowledge base.
 * Handles CRUD operations on the documents table via Supabase.
 */
class KnowledgeManager {
  /**
   * @param {object} supabase - Supabase client instance
   */
  constructor(supabase) {
    if (!supabase) {
      throw new Error('[KnowledgeManager] Supabase client is required');
    }
    this.supabase = supabase;
    console.log('[KnowledgeManager] Initialized');
  }

  /**
   * Add a document (set of chunks) to the knowledge base.
   * @param {object} doc
   * @param {Array<{content: string, chunkIndex: number, totalChunks: number, metadata: object, embedding: number[]|null, contentHash: string}>} doc.chunks
   * @param {string} doc.sourceType - e.g., 'github', 'resume', 'faq', 'document'
   * @param {string} doc.sourceId - Unique source identifier
   * @param {string} [doc.sourceUrl] - Source URL
   * @returns {Promise<void>}
   */
  async addDocument(doc) {
    if (!doc || !doc.chunks || doc.chunks.length === 0) {
      console.warn('[KnowledgeManager] No chunks provided for addDocument');
      return;
    }

    try {
      const records = doc.chunks.map((chunk) => ({
        content: chunk.content,
        source_type: doc.sourceType,
        source_id: doc.sourceId,
        source_url: doc.sourceUrl || null,
        chunk_index: chunk.chunkIndex,
        total_chunks: chunk.totalChunks,
        metadata: chunk.metadata || {},
        embedding: chunk.embedding || null,
        content_hash: chunk.contentHash,
        is_active: true,
      }));

      const { error } = await this.supabase.from('documents').insert(records);

      if (error) {
        console.error(
          `[KnowledgeManager] Failed to insert ${records.length} chunks ` +
          `for source "${doc.sourceId}":`,
          error.message
        );
        throw error;
      }

      console.log(
        `[KnowledgeManager] Added ${records.length} chunks for ` +
        `"${doc.sourceId}" (type: ${doc.sourceType})`
      );
    } catch (error) {
      console.error('[KnowledgeManager] addDocument error:', error.message);
      throw error;
    }
  }

  /**
   * Update a document by soft-deleting old chunks and inserting new ones.
   * @param {string} sourceId - The source identifier to update
   * @param {object} doc - New document data (same shape as addDocument)
   * @returns {Promise<void>}
   */
  async updateDocument(sourceId, doc) {
    try {
      // Soft-delete old chunks
      const { error: deleteError } = await this.supabase
        .from('documents')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('source_id', sourceId);

      if (deleteError) {
        console.error(
          `[KnowledgeManager] Failed to deactivate old chunks for "${sourceId}":`,
          deleteError.message
        );
        throw deleteError;
      }

      console.log(`[KnowledgeManager] Deactivated old chunks for "${sourceId}"`);

      // Insert new chunks
      await this.addDocument({
        ...doc,
        sourceId,
      });

      console.log(`[KnowledgeManager] Updated document "${sourceId}" successfully`);
    } catch (error) {
      console.error('[KnowledgeManager] updateDocument error:', error.message);
      throw error;
    }
  }

  /**
   * Soft-delete all chunks for a given source ID.
   * @param {string} sourceId - The source identifier to delete
   * @returns {Promise<void>}
   */
  async deleteDocument(sourceId) {
    try {
      const { error } = await this.supabase
        .from('documents')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('source_id', sourceId);

      if (error) {
        console.error(
          `[KnowledgeManager] Failed to delete document "${sourceId}":`,
          error.message
        );
        throw error;
      }

      console.log(`[KnowledgeManager] Soft-deleted all chunks for "${sourceId}"`);
    } catch (error) {
      console.error('[KnowledgeManager] deleteDocument error:', error.message);
      throw error;
    }
  }

  /**
   * Get statistics about the knowledge base.
   * @returns {Promise<{totalDocuments: number, totalChunks: number, bySourceType: object}>}
   */
  async getDocumentStats() {
    try {
      const { data, count, error } = await this.supabase
        .from('documents')
        .select('source_type, source_id', { count: 'exact' })
        .eq('is_active', true);

      if (error) {
        console.error('[KnowledgeManager] Failed to get document stats:', error.message);
        return { totalDocuments: 0, totalChunks: 0, bySourceType: {} };
      }

      const totalChunks = count || (data ? data.length : 0);

      // Count unique source_ids for totalDocuments
      const uniqueSourceIds = new Set();
      const bySourceType = {};

      if (data) {
        for (const row of data) {
          uniqueSourceIds.add(row.source_id);

          if (!bySourceType[row.source_type]) {
            bySourceType[row.source_type] = {
              chunks: 0,
              documents: new Set(),
            };
          }
          bySourceType[row.source_type].chunks++;
          bySourceType[row.source_type].documents.add(row.source_id);
        }
      }

      // Convert Sets to counts for serialization
      const bySourceTypeCounts = {};
      for (const [type, stats] of Object.entries(bySourceType)) {
        bySourceTypeCounts[type] = {
          chunks: stats.chunks,
          documents: stats.documents.size,
        };
      }

      const result = {
        totalDocuments: uniqueSourceIds.size,
        totalChunks,
        bySourceType: bySourceTypeCounts,
      };

      console.log(
        `[KnowledgeManager] Stats: ${result.totalDocuments} documents, ` +
        `${result.totalChunks} chunks`
      );

      return result;
    } catch (error) {
      console.error('[KnowledgeManager] getDocumentStats error:', error.message);
      return { totalDocuments: 0, totalChunks: 0, bySourceType: {} };
    }
  }

  /**
   * Re-embed all active documents in the knowledge base.
   * Useful when the embedding model changes or embeddings need refreshing.
   * @returns {Promise<void>}
   */
  async rebuildAll() {
    console.log('[KnowledgeManager] Starting full embedding rebuild...');

    try {
      const embedder = new EmbeddingService();

      // Fetch all active documents
      const { data, error } = await this.supabase
        .from('documents')
        .select('*')
        .eq('is_active', true);

      if (error) {
        console.error('[KnowledgeManager] Failed to fetch documents for rebuild:', error.message);
        throw error;
      }

      if (!data || data.length === 0) {
        console.log('[KnowledgeManager] No active documents to rebuild');
        return;
      }

      console.log(`[KnowledgeManager] Rebuilding embeddings for ${data.length} chunks...`);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < data.length; i++) {
        const doc = data[i];

        try {
          const embedding = await embedder.embed(doc.content);

          if (embedding) {
            const { error: updateError } = await this.supabase
              .from('documents')
              .update({
                embedding,
                updated_at: new Date().toISOString(),
              })
              .eq('id', doc.id);

            if (updateError) {
              console.error(
                `[KnowledgeManager] Failed to update embedding for chunk ${doc.id}:`,
                updateError.message
              );
              failCount++;
            } else {
              successCount++;
            }
          } else {
            console.warn(`[KnowledgeManager] Embedding returned null for chunk ${doc.id}`);
            failCount++;
          }
        } catch (embedError) {
          console.error(`[KnowledgeManager] Embed error for chunk ${doc.id}:`, embedError.message);
          failCount++;
        }

        // Log progress every 50 chunks
        if ((i + 1) % 50 === 0) {
          console.log(`[KnowledgeManager] Rebuild progress: ${i + 1}/${data.length}`);
        }

        // Rate limit: small delay between embeddings
        if ((i + 1) % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(
        `[KnowledgeManager] Rebuild complete: ${successCount} success, ${failCount} failed ` +
        `out of ${data.length} total`
      );
    } catch (error) {
      console.error('[KnowledgeManager] rebuildAll error:', error.message);
      throw error;
    }
  }
}

module.exports = KnowledgeManager;
