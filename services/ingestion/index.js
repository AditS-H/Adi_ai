'use strict';

const path = require('path');
const fs = require('fs').promises;

const PlainTextParser = require('./text');
const MarkdownParser = require('./markdown');
const PDFParser = require('./pdf');
const DOCXParser = require('./docx');

/**
 * IngestionService - Routes input to the correct parser based on file type.
 * Accepts file buffers, file paths, or raw strings.
 */
class IngestionService {
  constructor() {
    this.parsers = {
      pdf: new PDFParser(),
      docx: new DOCXParser(),
      md: new MarkdownParser(),
      markdown: new MarkdownParser(),
      txt: new PlainTextParser(),
      text: new PlainTextParser(),
      string: new PlainTextParser(),
    };
  }

  /**
   * Determine if a string looks like a file path.
   * @param {string} str
   * @returns {boolean}
   */
  _isFilePath(str) {
    if (typeof str !== 'string') return false;
    // Check for common path indicators
    return (
      (str.includes('/') || str.includes('\\')) &&
      str.includes('.') &&
      str.length < 500 && // File paths shouldn't be excessively long
      !str.includes('\n') // File paths don't have newlines
    );
  }

  /**
   * Detect file type from extension.
   * @param {string} filePath
   * @returns {string|null}
   */
  _detectType(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const typeMap = {
      pdf: 'pdf',
      docx: 'docx',
      doc: 'docx',
      md: 'md',
      markdown: 'md',
      txt: 'txt',
      text: 'txt',
    };
    return typeMap[ext] || null;
  }

  /**
   * Ingest input (buffer, file path, or raw string) and return parsed text.
   * @param {Buffer|string} input - File buffer, file path, or raw text
   * @param {object} options
   * @param {string} [options.sourceType] - Type of source (e.g., 'github', 'resume')
   * @param {string} [options.sourceId] - Source identifier
   * @param {string} [options.sourceUrl] - Source URL
   * @param {string} [options.type] - File type: 'pdf'|'docx'|'md'|'txt'|'string'
   * @param {object} [options.metadata] - Additional metadata
   * @returns {Promise<string>} Parsed text content
   * @throws {Error} If file type is unsupported or parsing fails
   */
  async ingest(input, options = {}) {
    let { type } = options;
    let buffer = null;
    let textContent = null;

    // Determine input type and read file if necessary
    if (Buffer.isBuffer(input)) {
      // Input is a buffer - need type to route to correct parser
      buffer = input;
      if (!type) {
        throw new Error(
          '[IngestionService] Buffer input requires a "type" option (pdf, docx, etc.)'
        );
      }
    } else if (typeof input === 'string') {
      if (this._isFilePath(input) && !type) {
        // Input looks like a file path - detect type and read
        type = this._detectType(input);
        if (!type) {
          throw new Error(
            `[IngestionService] Could not detect file type from path: ${input}`
          );
        }

        try {
          buffer = await fs.readFile(input);
          console.log(`[IngestionService] Read file: ${input} (${buffer.length} bytes)`);
        } catch (error) {
          throw new Error(
            `[IngestionService] Failed to read file "${input}": ${error.message}`
          );
        }
      } else if (this._isFilePath(input) && type) {
        // Input is a file path with explicit type
        try {
          buffer = await fs.readFile(input);
          console.log(`[IngestionService] Read file: ${input} (${buffer.length} bytes)`);
        } catch (error) {
          throw new Error(
            `[IngestionService] Failed to read file "${input}": ${error.message}`
          );
        }
      } else {
        // Input is raw text content
        textContent = input;
        if (!type) {
          type = 'string';
        }
      }
    } else {
      throw new Error(
        '[IngestionService] Input must be a Buffer, file path string, or raw text string'
      );
    }

    // Normalize type
    type = type.toLowerCase().replace('.', '');

    // Validate type
    if (!this.parsers[type]) {
      const supported = Object.keys(this.parsers).join(', ');
      throw new Error(
        `[IngestionService] Unsupported file type: ${type}. Supported types: ${supported}`
      );
    }

    // Route to the correct parser
    console.log(`[IngestionService] Parsing input as type: ${type}`);

    let parsedText;
    if (type === 'pdf' || type === 'docx') {
      // Binary formats need a buffer
      if (!buffer) {
        throw new Error(
          `[IngestionService] ${type.toUpperCase()} parsing requires a buffer, not raw text`
        );
      }
      parsedText = await this.parsers[type].parse(buffer);
    } else {
      // Text formats use the text content or buffer converted to string
      const text = textContent || (buffer ? buffer.toString('utf-8') : '');
      parsedText = await this.parsers[type].parse(text);
    }

    console.log(
      `[IngestionService] Ingestion complete: ${parsedText.length} chars ` +
      `(source: ${options.sourceType || 'unknown'}, id: ${options.sourceId || 'unknown'})`
    );

    return parsedText;
  }
}

module.exports = IngestionService;
