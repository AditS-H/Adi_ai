'use strict';

/**
 * PlainTextParser - Minimal text cleaner for raw text input.
 * Removes null bytes, normalizes whitespace, and trims.
 */
class PlainTextParser {
  /**
   * Parse and clean plain text input.
   * @param {string} text - Raw text content
   * @returns {Promise<string>} Cleaned text
   */
  async parse(text) {
    if (!text || typeof text !== 'string') {
      console.warn('[PlainTextParser] Received empty or non-string input');
      return '';
    }

    let cleaned = text;

    // Remove null bytes
    cleaned = cleaned.replace(/\0/g, '');

    // Normalize line endings to \n
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Replace tabs with spaces
    cleaned = cleaned.replace(/\t/g, ' ');

    // Collapse multiple consecutive spaces into a single space (per line)
    cleaned = cleaned.replace(/[^\S\n]+/g, ' ');

    // Remove excessive blank lines (more than 2 consecutive newlines → 2)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    cleaned = cleaned.trim();

    console.log(`[PlainTextParser] Parsed ${text.length} chars → ${cleaned.length} chars`);
    return cleaned;
  }
}

module.exports = PlainTextParser;
