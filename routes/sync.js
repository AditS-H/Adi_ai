/**
 * Sync Route — GitHub Webhook Handler
 * POST /api/sync
 * 
 * Receives GitHub push event webhooks, validates the HMAC-SHA256 signature,
 * and triggers a background sync for the pushed repository.
 * 
 * IMPORTANT: Webhook signature validation requires the raw request body.
 * The server must provide req.rawBody (set via a custom middleware in server.js)
 * or this route uses its own express.raw() parser.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const logger = require('../utils/logger');

// ─── Lazy-loaded Services ──────────────────────────────────────────────────────
function getGitHubSync() {
  try {
    const { GitHubSync } = require('../services/github/sync');
    return new GitHubSync();
  } catch (err) {
    logger.error('GitHubSync not available for webhook', { error: err.message });
    return null;
  }
}

/**
 * Validate the GitHub webhook signature using HMAC-SHA256.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 * 
 * @param {Buffer|string} rawBody - The raw request body
 * @param {string} signatureHeader - The X-Hub-Signature-256 header value
 * @param {string} secret - The webhook secret
 * @returns {boolean} Whether the signature is valid
 */
function validateSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  try {
    // Ensure rawBody is a Buffer or string
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');

    // Compute expected signature
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const expectedSignature = 'sha256=' + hmac.digest('hex');

    // Convert both signatures to buffers for timing-safe comparison
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const receivedBuffer = Buffer.from(signatureHeader, 'utf-8');

    // Lengths must match for timingSafeEqual
    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch (err) {
    logger.error('Signature validation error', { error: err.message });
    return false;
  }
}

// ─── POST / ─────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.warn('GITHUB_WEBHOOK_SECRET not configured, rejecting webhook');
      return res.status(500).json({
        success: false,
        error: 'Webhook secret not configured',
        code: 'CONFIGURATION_ERROR'
      });
    }

    // ── Step 1: Validate signature ─────────────────────────────────────────────
    const signatureHeader = req.headers['x-hub-signature-256'];

    if (!signatureHeader) {
      logger.warn('Webhook received without signature header', {
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      return res.status(401).json({
        success: false,
        error: 'Missing webhook signature',
        code: 'INVALID_WEBHOOK'
      });
    }

    // Get raw body — try multiple sources
    // The server.js middleware should attach req.rawBody for JSON-parsed requests
    // For this route, we may receive a Buffer directly if express.raw() is used upstream
    let rawBody = req.rawBody || req.body;

    // If body is a parsed object (JSON), we need to stringify it back
    // But this is lossy — best practice is to capture raw body upstream
    if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
      rawBody = JSON.stringify(rawBody);
    }

    const isValid = validateSignature(rawBody, signatureHeader, webhookSecret);

    if (!isValid) {
      logger.warn('INVALID_WEBHOOK_SIGNATURE', {
        ip: req.ip,
        signaturePresent: !!signatureHeader,
        bodyLength: rawBody ? rawBody.length : 0
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature',
        code: 'INVALID_WEBHOOK'
      });
    }

    // ── Step 2: Verify event type ──────────────────────────────────────────────
    const eventType = req.headers['x-github-event'];

    if (eventType !== 'push') {
      logger.info('Ignoring non-push webhook event', { event: eventType });
      return res.status(200).json({
        success: true,
        message: `Event type '${eventType}' acknowledged but not processed`
      });
    }

    // ── Step 3: Extract repository info ────────────────────────────────────────
    // Parse body if it's a string/buffer
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) { /* already parsed */ }
    }
    if (Buffer.isBuffer(payload)) {
      try { payload = JSON.parse(payload.toString('utf-8')); } catch (e) { /* parse failed */ }
    }

    const repoName = payload?.repository?.name;
    const repoFullName = payload?.repository?.full_name;
    const ref = payload?.ref;
    const pusher = payload?.pusher?.name;

    if (!repoName) {
      logger.warn('Webhook payload missing repository name', {
        hasRepository: !!payload?.repository,
        keys: payload ? Object.keys(payload) : []
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook payload: missing repository name',
        code: 'INVALID_PAYLOAD'
      });
    }

    logger.info('GitHub push webhook received', {
      repository: repoFullName || repoName,
      ref,
      pusher
    });

    // ── Step 4: Trigger background sync ────────────────────────────────────────
    const githubSync = getGitHubSync();

    if (githubSync) {
      // Fire-and-forget: sync the specific repo in the background
      githubSync.syncRepo(repoName)
        .then(result => {
          logger.info('Webhook-triggered sync completed', {
            repository: repoName,
            result
          });
        })
        .catch(err => {
          logger.error('Webhook-triggered sync failed', {
            repository: repoName,
            error: err.message,
            stack: err.stack
          });
        });
    } else {
      logger.warn('GitHub sync service unavailable for webhook processing');
    }

    // ── Step 5: Return 200 immediately ─────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: `Sync triggered for repository: ${repoName}`,
      repository: repoName
    });

  } catch (err) {
    logger.error('Webhook handler error', {
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error processing webhook',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
