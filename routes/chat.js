/**
 * Chat Route
 * POST /api/chat
 * 
 * Main endpoint — orchestrates the full AditAI pipeline:
 * 1. Validate & sanitize input
 * 2. Check cache for identical previous question
 * 3. RAG retrieval for relevant context
 * 4. Build persona-driven system prompt
 * 5. Route to best available AI provider
 * 6. Cache, log analytics, store session, respond
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { hashText } = require('../utils/hashUtils');
const textCleaner = require('../utils/textCleaner');

// Lazy-loaded services
let _supabase = null;
let _cacheService = null;
let _ragEngine = null;
let _personaEngine = null;
let _providerRouter = null;
let _analyticsService = null;

function getSupabase() {
  if (!_supabase) {
    try { _supabase = require('../config/database'); } catch (e) { /* handled below */ }
  }
  return _supabase;
}

function getCacheService() {
  if (!_cacheService) {
    try { _cacheService = require('../services/cache'); } catch (e) { /* handled below */ }
  }
  return _cacheService;
}

function getRagEngine() {
  if (!_ragEngine) {
    try {
      const RAGEngine = require('../services/rag');
      const supabase = getSupabase();
      if (!supabase) return null;
      _ragEngine = typeof RAGEngine === 'function' ? new RAGEngine(supabase) : RAGEngine;
    } catch (e) { /* handled below */ }
  }
  return _ragEngine;
}

function getPersonaEngine() {
  if (!_personaEngine) {
    try {
      const PersonaEngine = require('../services/persona');
      _personaEngine = typeof PersonaEngine === 'function' ? new PersonaEngine() : PersonaEngine;
    } catch (e) { /* handled below */ }
  }
  return _personaEngine;
}

function getProviderRouter() {
  if (!_providerRouter) {
    try {
      const { ProviderRouter } = require('../services/router');
      _providerRouter = ProviderRouter.getInstance();
    } catch (e) { /* handled below */ }
  }
  return _providerRouter;
}

function getAnalyticsService() {
  if (!_analyticsService) {
    try {
      const AnalyticsService = require('../services/analytics');
      _analyticsService = typeof AnalyticsService === 'function' ? new AnalyticsService() : AnalyticsService;
    } catch (e) { /* handled below */ }
  }
  return _analyticsService;
}

// ─── Validation Constants ──────────────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_MIN_LENGTH = 1;
const MESSAGE_MAX_LENGTH = 500;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_TURNS = 5; // Keep last 5 turns (10 messages: 5 user + 5 assistant)

/**
 * Validate the incoming chat request body
 * @param {Object} body - Request body
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validateInput(body) {
  const { message, sessionId, history } = body;

  // message is required and must be a non-empty string
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message is required and must be a string', code: 'VALIDATION_ERROR' };
  }

  const trimmed = message.trim();
  if (trimmed.length < MESSAGE_MIN_LENGTH) {
    return { valid: false, error: 'Message cannot be empty', code: 'VALIDATION_ERROR' };
  }

  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    return { valid: false, error: `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer`, code: 'VALIDATION_ERROR' };
  }

  // sessionId is required and must be a valid UUID
  if (!sessionId || typeof sessionId !== 'string') {
    return { valid: false, error: 'Session ID is required', code: 'VALIDATION_ERROR' };
  }

  if (!UUID_REGEX.test(sessionId)) {
    return { valid: false, error: 'Session ID must be a valid UUID', code: 'VALIDATION_ERROR' };
  }

  // history is optional but must be a valid array if provided
  if (history !== undefined && history !== null) {
    if (!Array.isArray(history)) {
      return { valid: false, error: 'History must be an array', code: 'VALIDATION_ERROR' };
    }

    if (history.length > MAX_HISTORY_ITEMS) {
      return { valid: false, error: `History cannot exceed ${MAX_HISTORY_ITEMS} items`, code: 'VALIDATION_ERROR' };
    }

    // Validate each history entry
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      if (!entry || typeof entry !== 'object') {
        return { valid: false, error: `History item at index ${i} is invalid`, code: 'VALIDATION_ERROR' };
      }
      if (!['user', 'assistant'].includes(entry.role)) {
        return { valid: false, error: `History item at index ${i} has invalid role`, code: 'VALIDATION_ERROR' };
      }
      if (!entry.content || typeof entry.content !== 'string') {
        return { valid: false, error: `History item at index ${i} has invalid content`, code: 'VALIDATION_ERROR' };
      }
    }
  }

  return { valid: true };
}

/**
 * Truncate conversation history to the last N turns (user+assistant pairs)
 * @param {Array} history - Full history array
 * @returns {Array} Truncated history
 */
function truncateHistory(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return [];
  // Keep last MAX_HISTORY_TURNS * 2 messages (each turn = user + assistant)
  const maxMessages = MAX_HISTORY_TURNS * 2;
  return history.slice(-maxMessages);
}

/**
 * Hash the client IP for privacy-safe analytics logging
 * @param {Object} req - Express request object
 * @returns {string} Hashed IP
 */
function hashClientIP(req) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  return hashText(ip);
}

// ─── POST / ────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const startTime = Date.now();

  try {
    // ── Step 1: Validate input ─────────────────────────────────────────────────
    const validation = validateInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
        code: validation.code
      });
    }

    const { message, sessionId, history } = req.body;

    // ── Step 2: Sanitize message ───────────────────────────────────────────────
    let sanitizedMessage;
    try {
      const sanitizeResult = textCleaner.sanitizeInput(message);

      // sanitizeInput may return a string directly or an object with { text, injectionDetected }
      if (typeof sanitizeResult === 'object' && sanitizeResult !== null) {
        sanitizedMessage = sanitizeResult.text || sanitizeResult.sanitized || message.trim();
        if (sanitizeResult.injectionDetected) {
          logger.warn('PROMPT_INJECTION_DETECTED', {
            ip: hashClientIP(req),
            sessionId,
            pattern: sanitizeResult.pattern || 'unknown'
          });
          return res.status(200).json({
            success: true,
            answer: "I'm Adit's portfolio assistant and I'm not able to process that request. Feel free to ask me about Adit's projects, skills, or experience!",
            provider: 'system',
            cached: false,
            responseTime: Date.now() - startTime,
            sessionId
          });
        }
      } else {
        sanitizedMessage = typeof sanitizeResult === 'string' ? sanitizeResult : message.trim();
      }
    } catch (sanitizeErr) {
      logger.warn('Message sanitization failed, using trimmed input', { error: sanitizeErr.message });
      sanitizedMessage = message.trim();
    }

    // ── Step 3: Generate cache key ─────────────────────────────────────────────
    const normalizedMessage = sanitizedMessage.toLowerCase().trim();
    const cacheKey = 'chat:' + hashText(normalizedMessage);

    // ── Step 4: Check cache ────────────────────────────────────────────────────
    const cacheService = getCacheService();
    if (cacheService) {
      try {
        const cachedAnswer = await cacheService.get(cacheKey);
        if (cachedAnswer) {
          const responseTime = Date.now() - startTime;
          logger.info('CACHE_HIT', {
            question: normalizedMessage.substring(0, 80),
            key: cacheKey.substring(0, 20),
            responseTime
          });

          // Log analytics for cached response
          const analyticsService = getAnalyticsService();
          if (analyticsService) {
            analyticsService.logQuery({
              question: sanitizedMessage,
              answerLength: cachedAnswer.length,
              providerUsed: 'cached',
              wasCached: true,
              ragChunks: 0,
              responseTime,
              sessionId,
              ipHash: hashClientIP(req)
            }).catch(err => logger.warn('Analytics log failed (cached)', { error: err.message }));
          }

          return res.status(200).json({
            success: true,
            answer: cachedAnswer,
            provider: 'cached',
            cached: true,
            responseTime,
            sessionId
          });
        }
      } catch (cacheErr) {
        logger.warn('Cache lookup failed, continuing without cache', { error: cacheErr.message });
      }
    }

    // ── Step 5: RAG retrieval ──────────────────────────────────────────────────
    let ragContext = { context: '', chunks: [] };
    const ragEngine = getRagEngine();
    if (ragEngine) {
      try {
        ragContext = await ragEngine.retrieve(sanitizedMessage);
      } catch (ragErr) {
        logger.warn('RAG retrieval failed, continuing without context', { error: ragErr.message });
      }
    }

    // ── Step 6: Build system prompt ────────────────────────────────────────────
    const truncatedHistory = truncateHistory(history);
    const hasContext = !!(ragContext && ragContext.context && ragContext.context.trim() && ragContext.chunks && ragContext.chunks.length > 0);

    if (!hasContext) {
      const answer = 'I do not have that specific information in my portfolio data. Feel free to ask me about my projects, skills, or experience.';
      const responseTime = Date.now() - startTime;

      const analyticsService = getAnalyticsService();
      if (analyticsService) {
        analyticsService.logQuery({
          question: sanitizedMessage,
          answerLength: answer.length,
          providerUsed: 'no_context',
          wasCached: false,
          ragChunks: 0,
          responseTime,
          sessionId,
          ipHash: hashClientIP(req)
        }).catch(err => logger.warn('Analytics log failed (no_context)', { error: err.message }));
      }

      const supabase = getSupabase();
      if (supabase) {
        const sessionUpdate = async () => {
          try {
            const now = new Date().toISOString();
            const newMessages = [
              ...(truncatedHistory || []),
              { role: 'user', content: sanitizedMessage, timestamp: now },
              { role: 'assistant', content: answer, timestamp: now }
            ];

            const storedMessages = newMessages.slice(-20);

            await supabase
              .from('chat_sessions')
              .upsert({
                session_id: sessionId,
                messages: storedMessages,
                message_count: storedMessages.length,
                last_active: now,
                ip_address: hashClientIP(req)
              }, {
                onConflict: 'session_id'
              });
          } catch (sessionErr) {
            logger.warn('Session upsert failed (no_context)', { error: sessionErr.message, sessionId });
          }
        };

        sessionUpdate();
      }

      return res.status(200).json({
        success: true,
        answer,
        provider: 'system',
        cached: false,
        responseTime,
        sessionId,
        noContext: true
      });
    }

    let systemPrompt = 'You are Adit Sharma\'s AI portfolio assistant. Answer questions about Adit based on available knowledge.';

    const personaEngine = getPersonaEngine();
    if (personaEngine) {
      try {
        systemPrompt = personaEngine.buildSystemPrompt(ragContext, truncatedHistory);
      } catch (personaErr) {
        logger.warn('Persona engine failed, using default system prompt', { error: personaErr.message });
      }
    }

    // ── Step 7: Build messages array ───────────────────────────────────────────
    const messages = [
      { role: 'system', content: systemPrompt },
      ...truncatedHistory.map(entry => ({
        role: entry.role,
        content: entry.content
      })),
      { role: 'user', content: sanitizedMessage }
    ];

    // ── Step 8: Route to AI provider ───────────────────────────────────────────
    const providerRouter = getProviderRouter();
    if (!providerRouter) {
      logger.error('ProviderRouter not available');
      return res.status(503).json({
        success: false,
        error: 'AI service is temporarily unavailable. Please try again shortly.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    let aiResponse;
    try {
      aiResponse = await providerRouter.route(messages, {
        maxTokens: 1024,
        temperature: 0.7
      });
    } catch (providerErr) {
      // Check for AllProvidersFailedError
      if (
        providerErr.name === 'AllProvidersFailedError' ||
        providerErr.code === 'ALL_PROVIDERS_FAILED' ||
        providerErr.message?.includes('All') && providerErr.message?.includes('failed')
      ) {
        logger.error('ALL_PROVIDERS_FAILED', {
          questionHash: cacheKey,
          sessionId,
          error: providerErr.message
        });

        return res.status(503).json({
          success: false,
          error: 'All AI providers are temporarily unavailable. Please try again in a few minutes — this is usually resolved quickly!',
          code: 'ALL_PROVIDERS_FAILED'
        });
      }

      throw providerErr; // Re-throw unexpected errors
    }

    const answer = aiResponse.text || aiResponse.content || aiResponse;
    const providerUsed = aiResponse.provider || 'unknown';

    // ── Step 9: Cache the response ─────────────────────────────────────────────
    if (cacheService && answer) {
      try {
        const ttl = parseInt(process.env.CACHE_TTL_CHAT, 10) || 21600; // 6 hours default
        await cacheService.set(cacheKey, answer, ttl);
      } catch (cacheSetErr) {
        logger.warn('Failed to cache response', { error: cacheSetErr.message });
      }
    }

    const responseTime = Date.now() - startTime;

    // ── Step 10: Log analytics (fire-and-forget) ───────────────────────────────
    const analyticsService = getAnalyticsService();
    if (analyticsService) {
      analyticsService.logQuery({
        question: sanitizedMessage,
        answerLength: typeof answer === 'string' ? answer.length : 0,
        providerUsed,
        wasCached: false,
        ragChunks: ragContext.chunks ? ragContext.chunks.length : 0,
        responseTime,
        sessionId,
        ipHash: hashClientIP(req)
      }).catch(err => logger.warn('Analytics log failed', { error: err.message }));
    }

    // ── Step 11: Store session in database (fire-and-forget) ───────────────────
    const supabase = getSupabase();
    if (supabase) {
      const sessionUpdate = async () => {
        try {
          const now = new Date().toISOString();
          const newMessages = [
            ...(truncatedHistory || []),
            { role: 'user', content: sanitizedMessage, timestamp: now },
            { role: 'assistant', content: answer, timestamp: now }
          ];

          // Keep only the last 20 messages in stored session
          const storedMessages = newMessages.slice(-20);

          await supabase
            .from('chat_sessions')
            .upsert({
              session_id: sessionId,
              messages: storedMessages,
              message_count: storedMessages.length,
              last_active: now,
              ip_address: hashClientIP(req)
            }, {
              onConflict: 'session_id'
            });
        } catch (sessionErr) {
          logger.warn('Session upsert failed', { error: sessionErr.message, sessionId });
        }
      };

      sessionUpdate(); // Fire and forget
    }

    // ── Step 12: Return response ───────────────────────────────────────────────
    logger.info('CHAT_RESPONSE', {
      provider: providerUsed,
      responseTime,
      ragChunks: ragContext.chunks ? ragContext.chunks.length : 0,
      answerLength: typeof answer === 'string' ? answer.length : 0,
      cached: false
    });

    return res.status(200).json({
      success: true,
      answer,
      provider: providerUsed,
      cached: false,
      responseTime,
      sessionId
    });

  } catch (err) {
    const responseTime = Date.now() - startTime;

    logger.error('Chat endpoint error', {
      error: err.message,
      stack: err.stack,
      responseTime
    });

    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred. Please try again.',
      code: 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
  }
});

module.exports = router;
