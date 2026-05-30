// ═══════════════════════════════════════════════════
// Approximate Token Counter
// ═══════════════════════════════════════════════════

/**
 * Estimate the number of tokens in a text string.
 * Uses the ~4 characters ≈ 1 token heuristic.
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Check whether text is within a token limit.
 *
 * @param {string} text
 * @param {number} maxTokens
 * @returns {boolean}
 */
function isWithinLimit(text, maxTokens) {
  return countTokens(text) <= maxTokens;
}

/**
 * Truncate text to approximately maxTokens at a word boundary.
 *
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
function truncateToTokens(text, maxTokens) {
  if (!text) return '';
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  // Find the last space before the character limit so we don't cut mid-word
  const truncated = text.substring(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '…';
  }
  return truncated + '…';
}

module.exports = { countTokens, isWithinLimit, truncateToTokens };
