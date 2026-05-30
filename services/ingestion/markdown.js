'use strict';

/**
 * MarkdownParser - Strips excessive markdown syntax while preserving structure.
 * Removes images, HTML tags, and large code blocks. Keeps small code blocks
 * and structural elements like headers and lists.
 */
class MarkdownParser {
  /**
   * Parse and clean markdown text.
   * @param {string} text - Raw markdown content
   * @returns {Promise<string>} Cleaned text with minimal markdown syntax
   */
  async parse(text) {
    if (!text || typeof text !== 'string') {
      console.warn('[MarkdownParser] Received empty or non-string input');
      return '';
    }

    let cleaned = text;

    // Remove null bytes
    cleaned = cleaned.replace(/\0/g, '');

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove image references: ![alt](url) or ![alt][ref]
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
    cleaned = cleaned.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '');

    // Remove HTML tags (but preserve content between tags)
    cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, '');

    // Handle code blocks: remove large ones (>500 chars), keep small ones as inline
    cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
      // Extract the code content (strip the ``` markers and optional language identifier)
      const codeContent = match
        .replace(/^```\w*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      if (codeContent.length > 500) {
        // Large code block - replace with a placeholder
        return '[code block removed]';
      }
      // Small code block - keep as inline code
      return codeContent;
    });

    // Remove horizontal rules (---, ***, ___)
    cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');

    // Simplify bold/italic markers but keep text
    // **bold** or __bold__ → bold
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');

    // *italic* or _italic_ → italic (be careful with underscores in words)
    cleaned = cleaned.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');
    cleaned = cleaned.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');

    // Remove inline code backticks but keep content
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // Remove link syntax but keep link text: [text](url) → text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

    // Remove reference-style link definitions: [ref]: url
    cleaned = cleaned.replace(/^\[([^\]]+)\]:\s+.*$/gm, '');

    // Remove blockquote markers but keep content
    cleaned = cleaned.replace(/^>\s?/gm, '');

    // Normalize multiple consecutive blank lines to double newline
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Collapse multiple spaces
    cleaned = cleaned.replace(/[^\S\n]+/g, ' ');

    // Trim each line
    cleaned = cleaned
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    // Trim the whole thing
    cleaned = cleaned.trim();

    console.log(`[MarkdownParser] Parsed ${text.length} chars → ${cleaned.length} chars`);
    return cleaned;
  }
}

module.exports = MarkdownParser;
