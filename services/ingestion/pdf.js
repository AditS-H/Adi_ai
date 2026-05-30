'use strict';

const pdfParse = require('pdf-parse');

/**
 * PDFParser - Extracts and cleans text from PDF buffers using pdf-parse.
 * Handles corrupted PDFs gracefully by returning an empty string.
 */
class PDFParser {
  /**
   * Parse a PDF buffer and extract clean text.
   * @param {Buffer} buffer - PDF file buffer
   * @returns {Promise<string>} Extracted and cleaned text
   */
  async parse(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      console.warn('[PDFParser] Received invalid buffer input');
      return '';
    }

    try {
      const data = await pdfParse(buffer);

      if (!data || !data.text) {
        console.warn('[PDFParser] No text extracted from PDF');
        return '';
      }

      let text = data.text;

      // Remove null bytes
      text = text.replace(/\0/g, '');

      // Normalize line endings
      text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Remove common page headers/footers patterns
      // Pattern: standalone page numbers (e.g., "1", "- 2 -", "Page 3")
      text = text.replace(/^\s*-?\s*\d+\s*-?\s*$/gm, '');

      // Pattern: "Page X of Y" or "Page X"
      text = text.replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gim, '');

      // Pattern: repeated header/footer lines (lines that appear on multiple pages)
      // We detect lines that appear 3+ times and remove duplicates
      const lines = text.split('\n');
      const lineCounts = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 5 && trimmed.length < 100) {
          lineCounts[trimmed] = (lineCounts[trimmed] || 0) + 1;
        }
      }

      // Remove lines that appear more than 3 times (likely headers/footers)
      const repeatedLines = new Set(
        Object.entries(lineCounts)
          .filter(([, count]) => count >= 3)
          .map(([line]) => line)
      );

      if (repeatedLines.size > 0) {
        const filteredLines = lines.filter(
          (line) => !repeatedLines.has(line.trim())
        );
        text = filteredLines.join('\n');
        console.log(`[PDFParser] Removed ${repeatedLines.size} repeated header/footer patterns`);
      }

      // Remove form feed characters
      text = text.replace(/\f/g, '\n');

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

      console.log(
        `[PDFParser] Extracted ${data.numpages} pages, ${text.length} chars ` +
        `(info: ${data.info?.Title || 'untitled'})`
      );

      return text;
    } catch (error) {
      console.error('[PDFParser] Error parsing PDF:', error.message);
      // Return empty string for corrupted/invalid PDFs
      return '';
    }
  }
}

module.exports = PDFParser;
