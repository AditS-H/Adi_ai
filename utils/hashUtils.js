// ═══════════════════════════════════════════════════
// SHA-256 Hashing Utilities
// ═══════════════════════════════════════════════════

const crypto = require('crypto');

/**
 * Produce a SHA-256 hex digest of a text string.
 * @param {string} text
 * @returns {string} 64-char hex string
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Produce a SHA-256 hex digest of a JSON-serialized object.
 * @param {object} obj
 * @returns {string} 64-char hex string
 */
function hashObject(obj) {
  const json = JSON.stringify(obj);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

module.exports = { hashText, hashObject };
