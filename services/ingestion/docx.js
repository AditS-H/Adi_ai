'use strict';

const mammoth = require('mammoth');

/**
 * DOCXParser - Extracts and cleans text from DOCX buffers using mammoth.
 * Converts DOCX to raw text (not HTML) and normalizes whitespace.
 */
class DOCXParser {
  /**
   * Parse a DOCX buffer and extract clean text.
   * @param {Buffer} buffer - DOCX file buffer
   * @returns {Promise<string>} Extracted and cleaned text
   */
  async parse(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      console.warn('[DOCXParser] Received invalid buffer input');
      return '';
    }

    try {
      // Use extractRawText to get plain text (not HTML)
      const result = await mammoth.extractRawText({ buffer });

      if (!result || !result.value) {
        console.warn('[DOCXParser] No text extracted from DOCX');
        return '';
      }

      // Log any warnings from mammoth
      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages.filter((m) => m.type === 'warning');
        if (warnings.length > 0) {
          console.warn(
            `[DOCXParser] ${warnings.length} warning(s) during parsing:`,
            warnings.map((w) => w.message).join('; ')
          );
        }
      }

      let text = result.value;

      // Remove null bytes
      text = text.replace(/\0/g, '');

      // Normalize line endings
      text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Collapse multiple spaces (per line)
      text = text.replace(/[^\S\n]+/g, ' ');

      // Remove excessive blank lines
      text = text.replace(/\n{3,}/g, '\n\n');

      // Trim each line
      text = text
        .split('\n')
        .map((line) => line.trim())
        .join('\n');

      // Trim the whole document
      text = text.trim();

      console.log(`[DOCXParser] Extracted ${text.length} chars from DOCX`);
      return text;
    } catch (error) {
      console.error('[DOCXParser] Error parsing DOCX:', error.message);
      return '';
    }
  }
}

module.exports = DOCXParser;
