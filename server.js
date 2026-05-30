/**
 * AditAI Backend — Main Entry Point
 * 
 * Orchestrates the entire Express application:
 * - Loads environment configuration
 * - Applies middleware (CORS, logging, JSON parsing, raw body capture)
 * - Mounts route handlers
 * - Starts cron jobs for scheduled GitHub sync
 * - Runs provider health recovery on interval
 * - Pre-warms cache with common questions after startup
 * - Handles graceful shutdown
 */

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// ─── Import Config & Utilities ─────────────────────────────────────────────────
const config = require('./config');
const logger = require('./utils/logger');

// ─── Import Middleware ─────────────────────────────────────────────────────────
let corsMiddleware;
try {
  corsMiddleware = require('./middleware/cors');
} catch (err) {
  logger.warn('CORS middleware not found, using permissive default');
  const cors = require('cors');
  corsMiddleware = cors();
}

let requestLoggerMiddleware;
try {
  // requestLogger module exports the middleware function directly
  const requestLogger = require('./middleware/requestLogger');
  requestLoggerMiddleware = requestLogger;
} catch (err) {
  logger.warn('Request logger middleware not found, using passthrough');
  requestLoggerMiddleware = (req, res, next) => next();
}

let errorHandler;
try {
  const errorMod = require('./middleware/errorHandler');
  errorHandler = errorMod.errorHandler || errorMod;
} catch (err) {
  logger.warn('Error handler middleware not found, using default');
  errorHandler = (err, req, res, _next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      code: err.code || 'INTERNAL_ERROR'
    });
  };
}

// ─── Import Rate Limiters (optional) ───────────────────────────────────────────
let healthLimiter, chatLimiter, adminLimiter;
try {
  const rateLimitMod = require('./middleware/rateLimit');
  healthLimiter = rateLimitMod.healthLimiter;
  chatLimiter = rateLimitMod.chatLimiter;
  adminLimiter = rateLimitMod.adminLimiter;
} catch (err) {
  logger.warn('Rate limit middleware not found, routes will run without rate limiting');
  const passthrough = (req, res, next) => next();
  healthLimiter = passthrough;
  chatLimiter = passthrough;
  adminLimiter = passthrough;
}

// ─── Import Routes ─────────────────────────────────────────────────────────────
const healthRoutes = require('./routes/health');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');

// ─── Import Services for Initialization ────────────────────────────────────────
let ProviderRouter, GitHubSync, IngestionPipeline, cacheService;

try {
  ({ ProviderRouter } = require('./services/router'));
} catch (err) {
  logger.warn('ProviderRouter not available at startup', { error: err.message });
}

try {
  ({ GitHubSync } = require('./services/github/sync'));
} catch (err) {
  logger.warn('GitHubSync not available at startup', { error: err.message });
}

try {
  IngestionPipeline = require('./services/knowledge/pipeline');
} catch (err) {
  logger.warn('IngestionPipeline not available at startup', { error: err.message });
}

try {
  cacheService = require('./services/cache');
} catch (err) {
  logger.warn('CacheService not available at startup', { error: err.message });
}

// ─── Create Express App ────────────────────────────────────────────────────────
const app = express();

// Diagnostic: log middleware/route types before mounting to help debug startup
logger.info('Middleware types at startup', {
  requestLogger: typeof requestLoggerMiddleware,
  cors: typeof corsMiddleware,
  jsonParser: typeof express.json,
  urlencoded: typeof express.urlencoded,
  healthLimiter: typeof healthLimiter,
  chatLimiter: typeof chatLimiter,
  adminLimiter: typeof adminLimiter,
  healthRoutes: typeof healthRoutes,
  chatRoutes: typeof chatRoutes,
  adminRoutes: typeof adminRoutes,
  syncRoutes: typeof syncRoutes,
});
// ─── Ensure Required Directories Exist ─────────────────────────────────────────
const dirs = ['logs', 'data/uploads'];
dirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    logger.info(`Created directory: ${dir}`);
  }
});

// ─── Apply Middleware (Order Matters!) ──────────────────────────────────────────

// 1. Request logging — must be first to capture all requests
app.use(requestLoggerMiddleware);

// 2. CORS — must be before route handlers
app.use(corsMiddleware);

// 3. JSON body parser with raw body capture for webhook signature validation
//    We capture rawBody on every JSON request so the sync webhook route
//    can verify the HMAC signature against the original payload.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    // Store raw body buffer for webhook signature validation
    req.rawBody = buf;
  }
}));

// 4. URL-encoded body parser (for form data from admin uploads)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Mount Routes ──────────────────────────────────────────────────────────────

// Health check endpoint
app.use('/api/health', healthLimiter, healthRoutes);

// Main chat endpoint
app.use('/api/chat', chatLimiter, chatRoutes);

// Admin panel endpoints (auth middleware is applied inside admin router)
app.use('/api/admin', adminLimiter, adminRoutes);

// GitHub webhook sync endpoint
app.use('/api/sync', syncRoutes);

// ─── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND'
  });
});

// ─── Global Error Handler (must be last middleware) ────────────────────────────
app.use(errorHandler);

// ─── Cron Jobs ─────────────────────────────────────────────────────────────────

// Scheduled GitHub sync (default: every 6 hours)
if (config.sync && config.sync.enabled) {
  const cronSchedule = config.sync.cronSchedule || '0 */6 * * *';

  if (cron.validate(cronSchedule)) {
    cron.schedule(cronSchedule, async () => {
      logger.info('Starting scheduled GitHub sync...', { schedule: cronSchedule });

      try {
        if (!GitHubSync) {
          logger.warn('GitHubSync not available for scheduled sync');
          return;
        }

        const githubSync = new GitHubSync();
        const result = await githubSync.syncAll();

        logger.info('Scheduled sync completed', {
          repos: result?.totalRepos || 0,
          new: result?.newRepos || 0,
          updated: result?.updatedRepos || 0,
          skipped: result?.skippedRepos || 0,
          timeTaken: result?.timeTaken || 'unknown'
        });
      } catch (error) {
        logger.error('Scheduled sync failed', {
          error: error.message,
          stack: error.stack
        });
      }
    });

    logger.info(`GitHub sync cron job scheduled: ${cronSchedule}`);
  } else {
    logger.error('Invalid cron schedule expression', { cronSchedule });
  }
}

// ─── Provider Health Recovery ──────────────────────────────────────────────────
// Gradually recover health scores for providers every 30 minutes
const HEALTH_RECOVERY_INTERVAL = 30 * 60 * 1000; // 30 minutes

const healthRecoveryTimer = setInterval(async () => {
  try {
    if (!ProviderRouter) return;

    const router = ProviderRouter.getInstance();
    if (router && router.healthManager && typeof router.healthManager.recoverScores === 'function') {
      await router.healthManager.recoverScores();
      logger.debug('Provider health scores recovery cycle completed');
    }
  } catch (e) {
    // Silent — health recovery is best-effort
    logger.debug('Health recovery cycle skipped', { error: e.message });
  }
}, HEALTH_RECOVERY_INTERVAL);

// Prevent health recovery timer from keeping the process alive
if (healthRecoveryTimer.unref) {
  healthRecoveryTimer.unref();
}

// ─── Cache Pre-Warming ─────────────────────────────────────────────────────────
const PREWARM_QUESTIONS = [
  'Who is Adit?',
  'What projects has Adit built?',
  'What programming languages does Adit know?',
  "What is Adit's strongest skill?",
  'Tell me about Cinevox',
  'Tell me about BlitzOS',
  'Is Adit available for hire?'
];

/**
 * Pre-warm the cache by running common questions through the full pipeline.
 * This ensures the first real user gets fast cached responses.
 * Failures are logged but never crash the server.
 */
async function prewarmCache() {
  if (!cacheService) {
    logger.info('Cache service not available, skipping pre-warm');
    return;
  }

  logger.info('Starting cache pre-warm...', { questions: PREWARM_QUESTIONS.length });

  let warmed = 0;
  let skipped = 0;
  let failed = 0;

  for (const question of PREWARM_QUESTIONS) {
    try {
      // Use internal imports to avoid circular dependency issues
      const { hashText } = require('./utils/hashUtils');
      const cacheKey = 'chat:' + hashText(question.toLowerCase().trim());

      // Check if already cached
      const existing = await cacheService.get(cacheKey);
      if (existing) {
        skipped++;
        continue;
      }

      // Attempt to run through the pipeline
      let ragEngine, personaEngine, providerRouter;

      try {
        const RAGEngine = require('./services/rag');
        const supabase = require('./config/database');
        ragEngine = typeof RAGEngine === 'function' ? new RAGEngine(supabase) : RAGEngine;
      } catch (e) { /* not available */ }

      try {
        const PersonaEngine = require('./services/persona');
        personaEngine = typeof PersonaEngine === 'function' ? new PersonaEngine() : PersonaEngine;
      } catch (e) { /* not available */ }

      try {
        if (ProviderRouter) {
          providerRouter = ProviderRouter.getInstance();
        }
      } catch (e) { /* not available */ }

      if (!ragEngine || !personaEngine || !providerRouter) {
        logger.debug('Services not ready for pre-warm, skipping remaining questions');
        break;
      }

      // Run RAG
      const ragContext = await ragEngine.retrieve(question);

      // Build prompt
      const systemPrompt = personaEngine.buildSystemPrompt(ragContext, []);

      // Build messages
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ];

      // Get AI response
      const aiResponse = await providerRouter.route(messages, {
        maxTokens: 1024,
        temperature: 0.7
      });

      const answer = aiResponse.text || aiResponse.content || aiResponse;

      // Cache the response
      if (answer && typeof answer === 'string' && answer.length > 0) {
        const ttl = parseInt(process.env.CACHE_TTL_CHAT, 10) || 21600;
        await cacheService.set(cacheKey, answer, ttl);
        warmed++;
      }

      // Small delay between questions to avoid overwhelming providers
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      failed++;
      logger.debug('Pre-warm failed for question', {
        question: question.substring(0, 50),
        error: err.message
      });
    }
  }

  logger.info('Cache pre-warm completed', { warmed, skipped, failed });
}

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = (config.server && config.server.port) || process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 AditAI Backend running on port ${PORT}`);
  logger.info(`📍 Environment: ${(config.server && config.server.nodeEnv) || process.env.NODE_ENV || 'development'}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/api/health`);

  // Pre-warm cache after a 10-second delay to let the server settle
  setTimeout(() => {
    prewarmCache().catch(err => {
      logger.warn('Cache pre-warm encountered an error', { error: err.message });
    });
  }, 10000);
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Clear intervals and timers
    clearInterval(healthRecoveryTimer);

    // Flush cache if possible
    if (cacheService && typeof cacheService.disconnect === 'function') {
      cacheService.disconnect()
        .then(() => logger.info('Cache disconnected'))
        .catch(() => { /* ignore */ });
    }

    logger.info('AditAI Backend shut down cleanly');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

// ─── Export for Testing ────────────────────────────────────────────────────────
module.exports = app;
