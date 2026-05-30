// ═══════════════════════════════════════════════════
// Retry with Exponential Backoff
// ═══════════════════════════════════════════════════

const logger = require('./logger');

/**
 * Retry an async function with exponential backoff.
 *
 * @param {Function} fn          — Async function to retry
 * @param {number}   maxAttempts — Maximum number of attempts (default: 3)
 * @param {number}   baseDelay  — Base delay in ms before first retry (default: 1000)
 * @returns {Promise<*>}         — Resolved value from fn
 * @throws {Error}               — Last error if all attempts fail
 */
async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(
          `Retry attempt ${attempt + 1}/${maxAttempts} failed: ${error.message}. ` +
          `Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error(
          `All ${maxAttempts} attempts exhausted. Last error: ${error.message}`
        );
      }
    }
  }

  throw lastError;
}

module.exports = retry;
