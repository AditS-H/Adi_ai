// ═══════════════════════════════════════════════════
// AI Provider Definitions — Cascade Priority Order
// ═══════════════════════════════════════════════════

const providers = [
  // ── Priority 1: Groq ────────────────────────────
  {
    name: 'groq',
    displayName: 'Groq',
    priority: 1,
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    model: 'llama-3.1-8b-instant',
    maxTokens: 1024,
    contextWindow: 8192,
    timeout: 15000,
    apiStyle: 'openai',
    retryOnStatusCodes: [429, 500, 502, 503],
    failOnStatusCodes: [401, 403],
  },

  // ── Priority 2: Gemini ──────────────────────────
  {
    name: 'gemini',
    displayName: 'Gemini',
    priority: 2,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    maxTokens: 1024,
    contextWindow: 32768,
    timeout: 20000,
    apiStyle: 'gemini',
    retryOnStatusCodes: [429, 500, 503],
    failOnStatusCodes: [401, 403],
  },

  // ── Priority 3: OpenRouter ──────────────────────
  {
    name: 'openrouter',
    displayName: 'OpenRouter',
    priority: 3,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: 1024,
    contextWindow: 8192,
    timeout: 30000,
    apiStyle: 'openai',
    extraHeaders: {
      'HTTP-Referer': 'https://aditai.dev',
      'X-Title': 'AditAI Portfolio Assistant',
    },
    retryOnStatusCodes: [429, 500, 502, 503],
    failOnStatusCodes: [401, 403],
  },

  // ── Priority 4: DeepSeek ────────────────────────
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    priority: 4,
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    maxTokens: 1024,
    contextWindow: 16384,
    timeout: 25000,
    apiStyle: 'openai',
    retryOnStatusCodes: [429, 500, 502, 503],
    failOnStatusCodes: [401, 403],
  },

  // ── Priority 5: Cloudflare Workers AI ───────────
  {
    name: 'cloudflare',
    displayName: 'Cloudflare Workers AI',
    priority: 5,
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts',
    apiKeyEnvVar: 'CLOUDFLARE_API_TOKEN',
    model: '@cf/meta/llama-3.1-8b-instruct',
    maxTokens: 1024,
    contextWindow: 8192,
    timeout: 30000,
    apiStyle: 'cloudflare',
    retryOnStatusCodes: [429, 500, 502, 503],
    failOnStatusCodes: [401, 403],
  },
];

module.exports = providers;
