'use strict';

const logger = require('../../utils/logger');
const providersConfig = require('../../config/providers');
const config = require('../../config');
const HealthManager = require('./healthManager');

const GroqProvider = require('./providers/groq');
const GeminiProvider = require('./providers/gemini');
const OpenRouterProvider = require('./providers/openrouter');
const DeepSeekProvider = require('./providers/deepseek');
const CloudflareProvider = require('./providers/cloudflare');

class AllProvidersFailedError extends Error {
  constructor(errors = []) {
    super('All AI providers failed');
    this.name = 'AllProvidersFailedError';
    this.code = 'ALL_PROVIDERS_FAILED';
    this.errors = errors;
  }
}

class ProviderRouter {
  static _instance = null;

  static getInstance() {
    if (!ProviderRouter._instance) {
      ProviderRouter._instance = new ProviderRouter();
    }
    return ProviderRouter._instance;
  }

  constructor() {
    this.providerConfigs = Array.isArray(providersConfig) ? providersConfig : [];
    this.providers = new Map();
    this.healthManager = new HealthManager(this.providerConfigs.map((p) => p.name));

    this._initProviders();
  }

  _initProviders() {
    const providerMap = {
      groq: GroqProvider,
      gemini: GeminiProvider,
      openrouter: OpenRouterProvider,
      deepseek: DeepSeekProvider,
      cloudflare: CloudflareProvider,
    };

    for (const config of this.providerConfigs) {
      const ProviderClass = providerMap[config.name];
      if (!ProviderClass) {
        logger.warn('Unknown provider config, skipping', { provider: config.name });
        continue;
      }

      try {
        const instance = new ProviderClass(config);
        this.providers.set(config.name, instance);
      } catch (error) {
        logger.warn('Failed to initialize provider', {
          provider: config.name,
          error: error.message,
        });
      }
    }
  }

  _classifyError(error) {
    const status = error.status || error.statusCode;
    const message = (error.message || '').toLowerCase();
    const code = error.code;

    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server';
    if (error.name === 'AbortError' || message.includes('timeout') || code === 'ETIMEDOUT') {
      return 'timeout';
    }
    if (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN' || message.includes('fetch failed')) {
      return 'network';
    }

    return 'unknown';
  }

  async route(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('ProviderRouter.route requires a messages array');
    }

    const orderedProviders = this.healthManager.getPreferredProviders(this.providerConfigs, {
      enableLoadBalancing: config.providerRouter?.loadBalanceHealthy,
      minHealthyScore: config.providerRouter?.loadBalanceMinScore,
    });
    const errors = [];

    for (const config of orderedProviders) {
      const provider = this.providers.get(config.name);
      if (!provider) {
        errors.push({ provider: config.name, error: 'Provider not initialized' });
        continue;
      }

      if (!provider.isConfigured()) {
        this.healthManager.markDisabled(config.name, 'Missing API key');
        errors.push({ provider: config.name, error: 'API key not configured' });
        continue;
      }

      if (!this.healthManager.canUse(config.name)) {
        errors.push({ provider: config.name, error: 'Provider in cooldown or disabled' });
        continue;
      }

      const start = Date.now();

      try {
        const response = await provider.call(messages, options);
        const latency = Date.now() - start;
        this.healthManager.recordSuccess(config.name, latency);

        return {
          text: response.text,
          raw: response.raw,
          provider: response.provider || config.name,
          latency,
        };
      } catch (error) {
        const errorType = this._classifyError(error);
        const status = error.status || error.statusCode;

        this.healthManager.recordFailure(
          config.name,
          errorType,
          status || error.code,
          error.message
        );

        errors.push({
          provider: config.name,
          error: error.message,
          status,
          type: errorType,
        });

        logger.warn('Provider call failed', {
          provider: config.name,
          status,
          error: error.message,
        });
      }
    }

    throw new AllProvidersFailedError(errors);
  }

  async getHealth() {
    const healthData = this.healthManager.getAllHealth();

    const providers = healthData.map((health) => {
      const provider = this.providers.get(health.providerName);
      const config = this.providerConfigs.find((cfg) => cfg.name === health.providerName);

      return {
        name: health.providerName,
        displayName: config?.displayName || health.providerName,
        priority: config?.priority || 99,
        model: config?.model || provider?.model,
        configured: provider ? provider.isConfigured() : false,
        healthScore: health.healthScore,
        status: health.status,
        cooldownUntil: health.cooldownUntil,
        consecutiveFailures: health.consecutiveFailures,
        lastError: health.lastError,
        lastErrorCode: health.lastErrorCode,
        totalRequests: health.totalRequests,
        totalFailures: health.totalFailures,
        updatedAt: health.updatedAt,
      };
    });

    const anyConfigured = providers.some((p) => p.configured);

    return {
      available: anyConfigured,
      providers,
      loadBalancing: {
        enabled: config.providerRouter?.loadBalanceHealthy ?? false,
        minHealthyScore: config.providerRouter?.loadBalanceMinScore ?? 70,
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  ProviderRouter,
  AllProvidersFailedError,
};
