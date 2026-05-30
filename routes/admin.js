/**
 * Admin Routes
 * All routes require admin authentication via Bearer token.
 * 
 * POST   /sync-github        - Trigger full GitHub repository sync
 * POST   /upload-document    - Upload and process a document (PDF, DOCX, TXT, MD)
 * DELETE /document/:sourceId - Delete all chunks for a source document
 * GET    /analytics          - Retrieve usage analytics
 * GET    /provider-health    - Get detailed AI provider health status
 * POST   /rebuild-embeddings - Rebuild all embeddings in background
 * DELETE /clear-cache        - Flush the entire cache
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// ─── Multer Configuration ──────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-originalname
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${ext} is not supported. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ─── Admin Auth Middleware ──────────────────────────────────────────────────────
let adminAuth;
try {
  adminAuth = require('../middleware/auth');
  // If auth exports an object with adminAuth property, use that
  if (typeof adminAuth !== 'function' && adminAuth.adminAuth) {
    adminAuth = adminAuth.adminAuth;
  }
} catch (err) {
  logger.warn('Admin auth middleware not found, using fallback', { error: err.message });
  // Fallback: verify against ADMIN_TOKEN env var directly
  adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    next();
  };
}

// Apply admin auth to ALL routes in this router
router.use(adminAuth);

// ─── Lazy-loaded Services ──────────────────────────────────────────────────────
function getGitHubSync() {
  try {
    const { GitHubSync } = require('../services/github/sync');
    return new GitHubSync();
  } catch (err) {
    logger.error('GitHubSync not available', { error: err.message });
    return null;
  }
}

function getIngestionPipeline() {
  try {
    const Pipeline = require('../services/knowledge/pipeline');
    const supabase = require('../config/database');
    return typeof Pipeline === 'function' ? new Pipeline(supabase) : Pipeline;
  } catch (err) {
    logger.error('IngestionPipeline not available', { error: err.message });
    return null;
  }
}

function getKnowledgeManager() {
  try {
    const KnowledgeManager = require('../services/knowledge');
    const supabase = require('../config/database');
    return typeof KnowledgeManager === 'function' ? new KnowledgeManager(supabase) : KnowledgeManager;
  } catch (err) {
    logger.error('KnowledgeManager not available', { error: err.message });
    return null;
  }
}

function getAnalyticsService() {
  try {
    const AnalyticsService = require('../services/analytics');
    return typeof AnalyticsService === 'function' ? new AnalyticsService() : AnalyticsService;
  } catch (err) {
    logger.error('AnalyticsService not available', { error: err.message });
    return null;
  }
}

function getCacheService() {
  try {
    return require('../services/cache');
  } catch (err) {
    logger.error('CacheService not available', { error: err.message });
    return null;
  }
}

function getProviderRouter() {
  try {
    const { ProviderRouter } = require('../services/router');
    return ProviderRouter.getInstance();
  } catch (err) {
    logger.error('ProviderRouter not available', { error: err.message });
    return null;
  }
}

/**
 * Safely remove uploaded file
 * @param {string} filePath - Absolute path to file
 */
function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn('Failed to clean up uploaded file', { filePath, error: err.message });
  }
}

// ─── POST /sync-github ─────────────────────────────────────────────────────────
router.post('/sync-github', async (req, res) => {
  const startTime = Date.now();

  try {
    const { force } = req.body || {};
    const githubSync = getGitHubSync();

    if (!githubSync) {
      return res.status(503).json({
        success: false,
        error: 'GitHub sync service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    logger.info('Admin triggered GitHub sync', { force: !!force });

    const result = await githubSync.syncAll(!!force);

    return res.status(200).json({
      success: true,
      result,
      timeTaken: `${Date.now() - startTime}ms`
    });
  } catch (err) {
    logger.error('GitHub sync failed', { error: err.message, stack: err.stack });

    // Check if sync is already in progress
    if (err.message?.includes('already') || err.code === 'SYNC_IN_PROGRESS') {
      return res.status(409).json({
        success: false,
        error: 'A sync operation is already in progress',
        code: 'SYNC_IN_PROGRESS'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'GitHub sync failed: ' + err.message,
      code: 'SYNC_FAILED'
    });
  }
});

// ─── POST /upload-document ──────────────────────────────────────────────────────
router.post('/upload-document', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  let uploadedFilePath = null;

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded. Use form field name "file".',
        code: 'VALIDATION_ERROR'
      });
    }

    uploadedFilePath = req.file.path;
    const { sourceId, sourceType, description } = req.body;

    // Validate required fields
    if (!sourceId || typeof sourceId !== 'string' || sourceId.trim().length === 0) {
      cleanupFile(uploadedFilePath);
      return res.status(400).json({
        success: false,
        error: 'sourceId is required',
        code: 'VALIDATION_ERROR'
      });
    }

    const validSourceTypes = ['resume', 'document', 'portfolio', 'faq'];
    if (!sourceType || !validSourceTypes.includes(sourceType)) {
      cleanupFile(uploadedFilePath);
      return res.status(400).json({
        success: false,
        error: `sourceType must be one of: ${validSourceTypes.join(', ')}`,
        code: 'VALIDATION_ERROR'
      });
    }

    // Verify file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      cleanupFile(uploadedFilePath);
      return res.status(400).json({
        success: false,
        error: `File type ${ext} is not supported. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`,
        code: 'VALIDATION_ERROR'
      });
    }

    const pipeline = getIngestionPipeline();
    if (!pipeline) {
      cleanupFile(uploadedFilePath);
      return res.status(503).json({
        success: false,
        error: 'Document ingestion service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    logger.info('Processing uploaded document', {
      originalName: req.file.originalname,
      sourceId,
      sourceType,
      sizeBytes: req.file.size
    });

    // Process through ingestion pipeline
    const result = await pipeline.process(uploadedFilePath, {
      sourceId: sourceId.trim(),
      sourceType,
      description: description || '',
      fileName: req.file.originalname,
      fileType: ext.replace('.', '')
    });

    const timeTaken = Date.now() - startTime;

    logger.info('Document processed successfully', {
      sourceId,
      chunksCreated: result.chunksCreated || result.chunks,
      timeTaken
    });

    return res.status(200).json({
      success: true,
      result: {
        documentId: result.documentId || sourceId.trim(),
        chunksCreated: result.chunksCreated || result.chunks || 0,
        embeddingsGenerated: result.embeddingsGenerated || result.embeddings || 0,
        timeTaken: `${timeTaken}ms`
      }
    });
  } catch (err) {
    logger.error('Document upload failed', { error: err.message, stack: err.stack });

    return res.status(500).json({
      success: false,
      error: 'Document processing failed: ' + err.message,
      code: 'PROCESSING_FAILED'
    });
  } finally {
    // Always clean up the uploaded file
    cleanupFile(uploadedFilePath);
  }
});

// ─── DELETE /document/:sourceId ─────────────────────────────────────────────────
router.delete('/document/:sourceId', async (req, res) => {
  try {
    const { sourceId } = req.params;

    if (!sourceId || sourceId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'sourceId parameter is required',
        code: 'VALIDATION_ERROR'
      });
    }

    const knowledgeManager = getKnowledgeManager();
    if (!knowledgeManager) {
      return res.status(503).json({
        success: false,
        error: 'Knowledge manager service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    logger.info('Deleting document', { sourceId });

    const result = await knowledgeManager.deleteDocument(sourceId.trim());
    const chunksDeleted = result?.chunksDeleted || result?.deleted || result?.count || 0;

    logger.info('Document deleted', { sourceId, chunksDeleted });

    return res.status(200).json({
      success: true,
      chunksDeleted
    });
  } catch (err) {
    logger.error('Document deletion failed', { error: err.message, sourceId: req.params.sourceId });

    return res.status(500).json({
      success: false,
      error: 'Document deletion failed: ' + err.message,
      code: 'DELETE_FAILED'
    });
  }
});

// ─── GET /analytics ─────────────────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const analyticsService = getAnalyticsService();
    if (!analyticsService) {
      return res.status(503).json({
        success: false,
        error: 'Analytics service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Fetch analytics data in parallel
    const [topQuestions, providerUsage, queryStats] = await Promise.all([
      analyticsService.getTopQuestions ? analyticsService.getTopQuestions(limit, days) : [],
      analyticsService.getProviderUsage ? analyticsService.getProviderUsage(days) : [],
      analyticsService.getQueryStats ? analyticsService.getQueryStats(days) : null
    ]);

    const totalQueries = queryStats?.totalQueries || 0;
    const cachedQueries = queryStats?.cachedQueries || 0;
    const cacheHitRate = totalQueries > 0 ? ((cachedQueries / totalQueries) * 100).toFixed(1) : '0.0';

    return res.status(200).json({
      success: true,
      period: `${days} days`,
      totalQueries,
      cachedQueries,
      cacheHitRate: `${cacheHitRate}%`,
      topQuestions,
      providerUsage
    });
  } catch (err) {
    logger.error('Analytics fetch failed', { error: err.message });

    return res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics: ' + err.message,
      code: 'ANALYTICS_FAILED'
    });
  }
});

// ─── GET /provider-health ───────────────────────────────────────────────────────
router.get('/provider-health', async (req, res) => {
  try {
    const providerRouter = getProviderRouter();
    if (!providerRouter) {
      return res.status(503).json({
        success: false,
        error: 'Provider router is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    let healthData;
    if (typeof providerRouter.getHealth === 'function') {
      healthData = await providerRouter.getHealth();
    } else if (providerRouter.healthManager && typeof providerRouter.healthManager.getAllHealth === 'function') {
      healthData = await providerRouter.healthManager.getAllHealth();
    } else {
      healthData = { message: 'Health data not available' };
    }

    return res.status(200).json({
      success: true,
      providers: healthData
    });
  } catch (err) {
    logger.error('Provider health check failed', { error: err.message });

    return res.status(500).json({
      success: false,
      error: 'Failed to fetch provider health: ' + err.message,
      code: 'HEALTH_CHECK_FAILED'
    });
  }
});

// ─── POST /rebuild-embeddings ───────────────────────────────────────────────────
router.post('/rebuild-embeddings', async (req, res) => {
  try {
    const knowledgeManager = getKnowledgeManager();
    if (!knowledgeManager) {
      return res.status(503).json({
        success: false,
        error: 'Knowledge manager service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    // Start rebuild in background — don't await
    knowledgeManager.rebuildAll()
      .then(result => {
        logger.info('Embedding rebuild completed', result);
      })
      .catch(err => {
        logger.error('Embedding rebuild failed', { error: err.message, stack: err.stack });
      });

    logger.info('Embedding rebuild started in background');

    return res.status(202).json({
      success: true,
      message: 'Rebuild started in background. Check logs for progress.'
    });
  } catch (err) {
    logger.error('Failed to start embedding rebuild', { error: err.message });

    return res.status(500).json({
      success: false,
      error: 'Failed to start rebuild: ' + err.message,
      code: 'REBUILD_FAILED'
    });
  }
});

// ─── DELETE /clear-cache ────────────────────────────────────────────────────────
router.delete('/clear-cache', async (req, res) => {
  try {
    const cacheService = getCacheService();
    if (!cacheService) {
      return res.status(503).json({
        success: false,
        error: 'Cache service is not available',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    await cacheService.flush();

    logger.info('Cache cleared by admin');

    return res.status(200).json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (err) {
    logger.error('Cache clear failed', { error: err.message });

    return res.status(500).json({
      success: false,
      error: 'Failed to clear cache: ' + err.message,
      code: 'CACHE_CLEAR_FAILED'
    });
  }
});

// ─── Multer Error Handler ───────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        code: 'FILE_TOO_LARGE'
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
      code: 'UPLOAD_ERROR'
    });
  }

  if (err.message && err.message.includes('File type')) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'INVALID_FILE_TYPE'
    });
  }

  next(err);
});

module.exports = router;
