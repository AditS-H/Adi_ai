'use strict';

const crypto = require('crypto');
const IngestionService = require('../ingestion/index');
const DocumentChunker = require('../rag/chunker');
const EmbeddingService = require('../rag/embedder');
const config = require('../../config');

/**
 * IngestionPipeline - Full pipeline: parse → clean → chunk → embed → store.
 * Orchestrates all ingestion services to process raw input into
 * embedded, searchable document chunks stored in Supabase.
 */
class IngestionPipeline {
  /**
   * @param {object} supabase - Supabase client instance
   */
  constructor(supabase) {
    if (!supabase) {
      throw new Error('[IngestionPipeline] Supabase client is required');
    }
    this.supabase = supabase;
    this.ingestionService = new IngestionService();
    const chunkSizeTokens = config.chunking?.chunkSize || 400;
    const chunkOverlapTokens = config.chunking?.chunkOverlap || 50;
    this.chunker = new DocumentChunker(chunkSizeTokens * 4, chunkOverlapTokens * 4);
    this.embedder = new EmbeddingService();
    console.log('[IngestionPipeline] Initialized');
  }

  /**
   * Process raw input through the full ingestion pipeline.
   * @param {Buffer|string} input - File buffer, file path, or raw text
   * @param {object} options
   * @param {string} options.sourceType - Source type (e.g., 'github', 'resume', 'faq', 'document')
   * @param {string} options.sourceId - Unique source identifier
   * @param {string} [options.sourceUrl] - Source URL
   * @param {string} [options.fileType] - File type for parsing ('pdf', 'docx', 'md', 'txt', 'string')
   * @param {object} [options.metadata] - Additional metadata to attach to chunks
   * @param {string} [options.chunkType] - Override chunk strategy ('sliding', 'faq', 'section')
   * @returns {Promise<{chunksCreated: number, embeddingsGenerated: number, timeTaken: number}>}
   */
  async process(input, options = {}) {
    const {
      sourceType,
      sourceId,
      sourceUrl,
      fileType,
      metadata,
      chunkType: overrideChunkType,
    } = options;

    if (!sourceType || !sourceId) {
      throw new Error(
        '[IngestionPipeline] sourceType and sourceId are required in options'
      );
    }

    const startTime = Date.now();
    console.log(
      `[IngestionPipeline] Starting pipeline for "${sourceId}" (type: ${sourceType})`
    );

    try {
      // Step 1: Parse input using IngestionService
      console.log('[IngestionPipeline] Step 1: Parsing input...');
      const parsedText = await this.ingestionService.ingest(input, {
        type: fileType,
        sourceType,
        sourceId,
        sourceUrl,
      });

      if (!parsedText || parsedText.trim().length === 0) {
        console.warn('[IngestionPipeline] Parsed text is empty. Aborting pipeline.');
        return { chunksCreated: 0, embeddingsGenerated: 0, timeTaken: Date.now() - startTime };
      }

      // Step 2: Clean text
      console.log('[IngestionPipeline] Step 2: Cleaning text...');
      let cleanedText = parsedText;
      // Basic cleaning: normalize excessive newlines, trim
      cleanedText = cleanedText.replace(/\n{4,}/g, '\n\n\n');
      cleanedText = cleanedText.replace(/[ \t]+\n/g, '\n');
      cleanedText = cleanedText.trim();

      // Step 3: Determine chunk type based on sourceType
      let chunkType = overrideChunkType;
      if (!chunkType) {
        switch (sourceType) {
          case 'faq':
            chunkType = 'faq';
            break;
          case 'resume':
          case 'github':
            chunkType = 'section';
            break;
          default:
            chunkType = 'sliding';
            break;
        }
      }

      // Step 4: Chunk the text
      console.log(`[IngestionPipeline] Step 3: Chunking text (strategy: ${chunkType})...`);
      const chunks = await this.chunker.chunk(cleanedText, { type: chunkType });

      if (chunks.length === 0) {
        console.warn('[IngestionPipeline] No chunks produced. Aborting pipeline.');
        return { chunksCreated: 0, embeddingsGenerated: 0, timeTaken: Date.now() - startTime };
      }

      console.log(`[IngestionPipeline] Created ${chunks.length} chunks`);

      // Step 5: Generate embeddings
      console.log('[IngestionPipeline] Step 4: Generating embeddings...');
      const textsToEmbed = chunks.map((c) => c.content);
      const embeddings = await this.embedder.embedBatch(textsToEmbed);

      const embeddingsGenerated = embeddings.filter(Boolean).length;
      console.log(`[IngestionPipeline] Generated ${embeddingsGenerated}/${chunks.length} embeddings`);

      // Step 6: Compute content hashes
      const contentHashes = chunks.map((chunk) =>
        crypto.createHash('sha256').update(chunk.content).digest('hex')
      );

      // Step 7: Delete old chunks for this sourceId
      console.log(`[IngestionPipeline] Step 5: Removing old chunks for "${sourceId}"...`);
      const { error: deleteError } = await this.supabase
        .from('documents')
        .delete()
        .eq('source_id', sourceId);

      if (deleteError) {
        console.warn(
          `[IngestionPipeline] Warning: Failed to delete old chunks for "${sourceId}":`,
          deleteError.message
        );
        // Continue anyway — new chunks will still be inserted
      }

      // Step 8: Build records and insert into documents table
      console.log('[IngestionPipeline] Step 6: Inserting new chunks into database...');
      const records = chunks.map((chunk, i) => ({
        content: chunk.content,
        source_type: sourceType,
        source_id: sourceId,
        source_url: sourceUrl || null,
        chunk_index: chunk.chunkIndex,
        total_chunks: chunk.totalChunks,
        metadata: {
          ...chunk.metadata,
          ...(metadata || {}),
        },
        embedding: embeddings[i] || null,
        content_hash: contentHashes[i],
        is_active: true,
      }));

      // Insert in batches of 50 to avoid payload size limits
      const BATCH_SIZE = 50;
      let insertedCount = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await this.supabase
          .from('documents')
          .insert(batch);

        if (insertError) {
          console.error(
            `[IngestionPipeline] Failed to insert batch ${Math.floor(i / BATCH_SIZE) + 1}:`,
            insertError.message
          );
          throw insertError;
        }

        insertedCount += batch.length;
      }

      const timeTaken = Date.now() - startTime;

      console.log(
        `[IngestionPipeline] Pipeline complete for "${sourceId}": ` +
        `${insertedCount} chunks created, ${embeddingsGenerated} embeddings, ` +
        `${timeTaken}ms elapsed`
      );

      return {
        chunksCreated: insertedCount,
        embeddingsGenerated,
        timeTaken,
      };
    } catch (error) {
      const timeTaken = Date.now() - startTime;
      console.error(
        `[IngestionPipeline] Pipeline failed for "${sourceId}" after ${timeTaken}ms:`,
        error.message
      );
      throw error;
    }
  }
}

module.exports = IngestionPipeline;
