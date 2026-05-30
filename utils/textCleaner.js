// ═══════════════════════════════════════════════════
// Text Cleaning & Sanitization Utilities
// ═══════════════════════════════════════════════════

/**
 * Collapse multiple whitespace characters into single spaces and trim.
 * @param {string} text
 * @returns {string}
 */
function removeExtraWhitespace(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Remove special / non-printable characters, keeping specified ones.
 * @param {string} text
 * @param {string[]} keep — Characters to preserve (e.g. ['?', '!'])
 * @returns {string}
 */
function removeSpecialChars(text, keep = []) {
  if (!text) return '';
  // Build a regex that keeps letters, digits, whitespace, and any "keep" chars
  const escaped = keep.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const keepPattern = escaped.length ? escaped.join('') : '';
  const regex = new RegExp(`[^\\w\\s${keepPattern}]`, 'g');
  return text.replace(regex, '');
}

/**
 * Strip excessive markdown formatting while preserving readability.
 * Removes repeated headings markers, excessive bold/italic, etc.
 * @param {string} text
 * @returns {string}
 */
function normalizeMarkdown(text) {
  if (!text) return '';
  return text
    // Remove excessive heading markers (keep single #)
    .replace(/^#{4,}\s/gm, '### ')
    // Remove excessive bold/italic nesting
    .replace(/(\*{3,})/g, '**')
    .replace(/(_{3,})/g, '__')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strip HTML tags from text.
 * @param {string} text
 * @returns {string}
 */
function stripHtmlTags(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Remove null bytes and other control characters.
 * @param {string} text
 * @returns {string}
 */
function removeNullBytes(text) {
  if (!text) return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ---------------------------------------------------------------------------
// Prompt injection patterns
// ---------------------------------------------------------------------------
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now/i,
  /disregard\s+your/i,
  /new\s+system\s+prompt/i,
  /forget\s+(all\s+)?(your\s+)?instructions/i,
  /override\s+(your\s+)?instructions/i,
  /act\s+as\s+(if\s+you\s+are|a\s+different)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /system\s*:\s*/i,
  /\[\s*INST\s*\]/i,
  /<\|im_start\|>/i,
];

/**
 * Sanitize user input: clean text, truncate, and detect prompt injection.
 *
 * @param {string} text
 * @returns {{ cleanedText: string, isInjection: boolean }}
 */
function sanitizeInput(text) {
  if (!text) return { cleanedText: '', isInjection: false };

  // Pipeline: null bytes → HTML → whitespace → markdown
  let cleaned = removeNullBytes(text);
  cleaned = stripHtmlTags(cleaned);
  cleaned = removeExtraWhitespace(cleaned);
  cleaned = normalizeMarkdown(cleaned);

  // Truncate to 500 characters
  if (cleaned.length > 500) {
    cleaned = cleaned.substring(0, 500);
  }

  // Check for prompt injection
  const isInjection = INJECTION_PATTERNS.some((pattern) => pattern.test(cleaned));

  return { cleanedText: cleaned, isInjection };
}

module.exports = {
  removeExtraWhitespace,
  removeSpecialChars,
  normalizeMarkdown,
  stripHtmlTags,
  removeNullBytes,
  sanitizeInput,
};
