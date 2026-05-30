'use strict';

/**
 * DocumentChunker - Splits text into chunks for embedding and retrieval.
 * Supports sliding window, FAQ-based, and section-based chunking strategies.
 */
class DocumentChunker {
  /**
   * @param {number} chunkSize - Max chunk size in characters (default: 1600 ≈ 400 tokens)
   * @param {number} overlap - Overlap between chunks in characters (default: 200 ≈ 50 tokens)
   */
  constructor(chunkSize = 1600, overlap = 200) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  /**
   * Chunk text into an array of chunk objects.
   * @param {string} text - Input text to chunk
   * @param {object} options
   * @param {string} [options.type='sliding'] - Chunking strategy: 'sliding'|'faq'|'section'
   * @param {string} [options.sectionSeparator='##'] - Header marker for section splitting
   * @returns {Promise<Array<{content: string, chunkIndex: number, totalChunks: number, metadata: object}>>}
   */
  async chunk(text, options = {}) {
    const { type = 'sliding', sectionSeparator = '##' } = options;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.warn('[DocumentChunker] Empty or invalid text input');
      return [];
    }

    let chunks;

    switch (type) {
      case 'faq':
        chunks = this._chunkFAQ(text);
        break;
      case 'section':
        chunks = this._chunkBySection(text, sectionSeparator);
        break;
      case 'sliding':
      default:
        chunks = this._chunkSliding(text);
        break;
    }

    // Add totalChunks to each chunk
    const totalChunks = chunks.length;
    chunks = chunks.map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
      totalChunks,
    }));

    console.log(
      `[DocumentChunker] Created ${chunks.length} chunks using "${type}" strategy ` +
      `(chunkSize=${this.chunkSize}, overlap=${this.overlap})`
    );

    return chunks;
  }

  /**
   * Sliding window chunking.
   * Splits by paragraphs, accumulates until chunk size, overlaps by keeping
   * the last N characters for the next chunk.
   * @param {string} text
   * @returns {Array<{content: string, chunkIndex: number, totalChunks: number, metadata: object}>}
   */
  _chunkSliding(text) {
    const paragraphs = text.split('\n\n').filter((p) => p.trim().length > 0);
    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();

      // If adding this paragraph would exceed chunk size, save current chunk
      if (
        currentChunk.length > 0 &&
        currentChunk.length + trimmedParagraph.length + 2 > this.chunkSize
      ) {
        // Save current chunk if it meets minimum length
        if (currentChunk.trim().length >= 100) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: 0, // Will be set later
            totalChunks: 0, // Will be set later
            metadata: {},
          });
        }

        // Start next chunk with overlap from end of current chunk
        const overlapText = currentChunk.slice(-this.overlap);
        currentChunk = overlapText + '\n\n' + trimmedParagraph;
      } else {
        // Accumulate paragraphs
        if (currentChunk.length > 0) {
          currentChunk += '\n\n' + trimmedParagraph;
        } else {
          currentChunk = trimmedParagraph;
        }
      }

      // If current chunk exceeds chunk size (single large paragraph),
      // force-split it
      while (currentChunk.length > this.chunkSize) {
        const splitPoint = this._findSplitPoint(currentChunk, this.chunkSize);
        const splitChunk = currentChunk.slice(0, splitPoint).trim();

        if (splitChunk.length >= 100) {
          chunks.push({
            content: splitChunk,
            chunkIndex: 0,
            totalChunks: 0,
            metadata: {},
          });
        }

        // Overlap for next chunk
        const overlapStart = Math.max(0, splitPoint - this.overlap);
        currentChunk = currentChunk.slice(overlapStart);
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length >= 100) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: 0,
        totalChunks: 0,
        metadata: {},
      });
    }

    return chunks;
  }

  /**
   * FAQ chunking - each Q&A pair becomes its own chunk.
   * Splits on '## Q:' boundaries. No sliding window applied.
   * @param {string} text
   * @returns {Array<{content: string, chunkIndex: number, totalChunks: number, metadata: object}>}
   */
  _chunkFAQ(text) {
    const chunks = [];

    // Split on '## Q:' boundaries
    const faqPattern = /(?=## Q:)/g;
    const sections = text.split(faqPattern).filter((s) => s.trim().length > 0);

    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length < 10) continue; // Skip empty/trivial sections

      // Extract question from the section for metadata
      const questionMatch = trimmed.match(/^## Q:\s*(.+?)(?:\n|$)/);
      const question = questionMatch ? questionMatch[1].trim() : '';

      chunks.push({
        content: trimmed,
        chunkIndex: 0,
        totalChunks: 0,
        metadata: {
          type: 'faq',
          question,
        },
      });
    }

    // If no FAQ patterns were found, treat as single chunk
    if (chunks.length === 0 && text.trim().length >= 100) {
      chunks.push({
        content: text.trim(),
        chunkIndex: 0,
        totalChunks: 0,
        metadata: { type: 'faq' },
      });
    }

    return chunks;
  }

  /**
   * Section-based chunking - split by headers, then apply sliding window
   * within each section. Section name is added to each chunk's metadata.
   * @param {string} text
   * @param {string} separator - Header marker (default '##')
   * @returns {Array<{content: string, chunkIndex: number, totalChunks: number, metadata: object}>}
   */
  _chunkBySection(text, separator = '##') {
    const chunks = [];

    // Split by section headers (## Header)
    const sectionPattern = new RegExp(`(?=^${this._escapeRegex(separator)}\\s)`, 'gm');
    const sections = text.split(sectionPattern).filter((s) => s.trim().length > 0);

    for (const section of sections) {
      const trimmed = section.trim();

      // Extract section name from header
      const headerPattern = new RegExp(`^${this._escapeRegex(separator)}\\s+(.+?)(?:\\n|$)`);
      const headerMatch = trimmed.match(headerPattern);
      const sectionName = headerMatch ? headerMatch[1].trim() : 'Untitled Section';

      // Apply sliding window within this section
      const sectionChunks = this._chunkSliding(trimmed);

      // Add section name to each chunk's metadata
      for (const chunk of sectionChunks) {
        chunk.metadata = {
          ...chunk.metadata,
          section: sectionName,
          type: 'section',
        };
        chunks.push(chunk);
      }
    }

    // If no sections were found, fall back to regular sliding window
    if (chunks.length === 0) {
      return this._chunkSliding(text);
    }

    return chunks;
  }

  /**
   * Find a good split point near the target position.
   * Prefers splitting at sentence boundaries, then newlines, then spaces.
   * @param {string} text
   * @param {number} targetPos
   * @returns {number}
   */
  _findSplitPoint(text, targetPos) {
    // Look for sentence boundaries near the target
    const searchStart = Math.max(0, targetPos - 100);
    const searchEnd = Math.min(text.length, targetPos + 50);
    const searchArea = text.slice(searchStart, searchEnd);

    // Try to find a sentence boundary (. ! ?)
    const sentenceEnd = searchArea.lastIndexOf('. ');
    if (sentenceEnd !== -1) {
      return searchStart + sentenceEnd + 2;
    }

    // Try newline
    const newlinePos = searchArea.lastIndexOf('\n');
    if (newlinePos !== -1) {
      return searchStart + newlinePos + 1;
    }

    // Try space
    const spacePos = searchArea.lastIndexOf(' ');
    if (spacePos !== -1) {
      return searchStart + spacePos + 1;
    }

    // Hard split at target
    return targetPos;
  }

  /**
   * Escape special regex characters in a string.
   * @param {string} str
   * @returns {string}
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = DocumentChunker;
