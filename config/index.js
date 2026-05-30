// ═══════════════════════════════════════════════════
// Central Configuration — reads from process.env
// ═══════════════════════════════════════════════════

const dotenv = require('dotenv');
dotenv.config();

// ---------------------------------------------------------------------------
// Validate critical environment variables
// ---------------------------------------------------------------------------
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    throw new Error(
      `❌ Missing required environment variable: ${varName}. ` +
      `Check your .env file or deployment config.`
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: read env var with optional default
// ---------------------------------------------------------------------------
function env(key, defaultValue = undefined) {
  return process.env[key] ?? defaultValue;
}

function envInt(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envFloat(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envBool(key, defaultValue = false) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

function envList(key, defaultValue = []) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════
// Exported configuration object
// ═══════════════════════════════════════════════════

const config = {
  // ── Server ──────────────────────────────────────
  server: {
    port: envInt('PORT', 3000),
    nodeEnv: env('NODE_ENV', 'development'),
    isProduction: env('NODE_ENV', 'development') === 'production',
    frontendUrl: env('FRONTEND_URL', 'http://localhost:5173'),
  },

  // ── Supabase ────────────────────────────────────
  supabase: {
    url: env('SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_KEY'),
  },

  // ── Redis / Upstash ─────────────────────────────
  redis: {
    url: env('UPSTASH_REDIS_REST_URL', ''),
    token: env('UPSTASH_REDIS_REST_TOKEN', ''),
  },

  // ── AI Providers ────────────────────────────────
  providers: {
    groq: {
      apiKey: env('GROQ_API_KEY', ''),
    },
    gemini: {
      apiKey: env('GEMINI_API_KEY', ''),
    },
    openrouter: {
      apiKey: env('OPENROUTER_API_KEY', ''),
    },
    deepseek: {
      apiKey: env('DEEPSEEK_API_KEY', ''),
    },
    cloudflare: {
      accountId: env('CLOUDFLARE_ACCOUNT_ID', ''),
      apiToken: env('CLOUDFLARE_API_TOKEN', ''),
    },
  },

  // ── GitHub ──────────────────────────────────────
  github: {
    username: env('GITHUB_USERNAME', ''),
    token: env('GITHUB_TOKEN', ''),
    webhookSecret: env('GITHUB_WEBHOOK_SECRET', ''),
    skipRepos: envList('GITHUB_SKIP_REPOS'),
    skipForks: envBool('GITHUB_SKIP_FORKS', true),
  },

  // ── Admin ───────────────────────────────────────
  admin: {
    token: env('ADMIN_TOKEN', ''),
  },

  // ── Rate Limiting ───────────────────────────────
  rateLimit: {
    max: envInt('RATE_LIMIT_MAX', 30),
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 600000),
  },

  // ── RAG ─────────────────────────────────────────
  rag: {
    topK: envInt('RAG_TOP_K', 5),
    similarityThreshold: envFloat('RAG_SIMILARITY_THRESHOLD', 0.70),
    maxContextTokens: envInt('RAG_MAX_CONTEXT_TOKENS', 2000),
    rerankEnabled: envBool('RAG_RERANK', true),
    rerankTopK: envInt('RAG_RERANK_TOP_K', 10),
  },

  // ── Chunking ────────────────────────────────────
  chunking: {
    chunkSize: envInt('CHUNK_SIZE', 400),
    chunkOverlap: envInt('CHUNK_OVERLAP', 50),
  },

  // ── Cache TTLs (seconds) ────────────────────────
  cache: {
    ttlChat: envInt('CACHE_TTL_CHAT', 21600),
    ttlEmbedding: envInt('CACHE_TTL_EMBEDDING', 86400),
    ttlSession: envInt('CACHE_TTL_SESSION', 7200),
  },

  // ── Sync Schedule ──────────────────────────────
  sync: {
    cronSchedule: env('SYNC_CRON_SCHEDULE', '0 */6 * * *'),
    enabled: envBool('SYNC_ENABLED', true),
  },

  // ── Provider Router ────────────────────────────
  providerRouter: {
    loadBalanceHealthy: envBool('PROVIDER_LOAD_BALANCING', true),
    loadBalanceMinScore: envInt('PROVIDER_HEALTHY_THRESHOLD', 70),
  },
};

module.exports = config;
