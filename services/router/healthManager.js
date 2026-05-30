'use strict';

const logger = require('../../utils/logger');
const supabase = require('../../config/database');

const SCORE_MAX = 100;
const SCORE_MIN = 0;

function clampScore(score) {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
}

function scoreToStatus(score) {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'degraded';
  if (score >= 20) return 'poor';
  if (score >= 1) return 'critical';
  return 'disabled';
}

class HealthManager {
  constructor(providerNames = []) {
    this.supabase = supabase;
    this.health = new Map();
    this._init(providerNames);
  }

  _defaultHealth(providerName) {
    return {
      providerName,
      healthScore: 100,
      consecutiveFailures: 0,
      lastError: null,
      lastErrorCode: null,
      lastSuccess: null,
      lastFailure: null,
      cooldownUntil: null,
      totalRequests: 0,
      totalFailures: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  _init(providerNames) {
    providerNames.forEach((name) => {
      if (!this.health.has(name)) {
        this.health.set(name, this._defaultHealth(name));
      }
    });

    this.loadFromDb().catch((err) => {
      logger.debug('Provider health load skipped', { error: err.message });
    });
  }

  async loadFromDb() {
    if (!this.supabase) return;

    const { data, error } = await this.supabase
      .from('provider_health')
      .select('*');

    if (error) {
      logger.warn('Failed to load provider health from database', { error: error.message });
      return;
    }

    (data || []).forEach((row) => {
      this.health.set(row.provider_name, {
        providerName: row.provider_name,
        healthScore: row.health_score ?? 100,
        consecutiveFailures: row.consecutive_failures ?? 0,
        lastError: row.last_error ?? null,
        lastErrorCode: row.last_error_code ?? null,
        lastSuccess: row.last_success ?? null,
        lastFailure: row.last_failure ?? null,
        cooldownUntil: row.cooldown_until ?? null,
        totalRequests: row.total_requests ?? 0,
        totalFailures: row.total_failures ?? 0,
        updatedAt: row.updated_at ?? new Date().toISOString(),
      });
    });

    logger.info('Provider health loaded from database', { providers: this.health.size });
  }

  _persist(health) {
    if (!this.supabase) return;

    const payload = {
      provider_name: health.providerName,
      health_score: health.healthScore,
      consecutive_failures: health.consecutiveFailures,
      last_error: health.lastError,
      last_error_code: health.lastErrorCode,
      last_success: health.lastSuccess,
      last_failure: health.lastFailure,
      cooldown_until: health.cooldownUntil,
      total_requests: health.totalRequests,
      total_failures: health.totalFailures,
      updated_at: health.updatedAt,
    };

    this.supabase
      .from('provider_health')
      .upsert(payload, { onConflict: 'provider_name' })
      .then(({ error }) => {
        if (error) {
          logger.warn('Failed to persist provider health', {
            provider: health.providerName,
            error: error.message,
          });
        }
      });
  }

  getHealth(providerName) {
    return this.health.get(providerName) || this._defaultHealth(providerName);
  }

  getAllHealth() {
    return Array.from(this.health.values()).map((health) => ({
      ...health,
      status: scoreToStatus(health.healthScore),
      cooldownActive: !!(health.cooldownUntil && new Date(health.cooldownUntil) > new Date()),
    }));
  }

  getOrderedProviders(providerConfigs) {
    return [...providerConfigs].sort((a, b) => {
      const aScore = this.getHealth(a.name).healthScore;
      const bScore = this.getHealth(b.name).healthScore;
      if (aScore !== bScore) return bScore - aScore;
      return (a.priority || 99) - (b.priority || 99);
    });
  }

  getPreferredProviders(providerConfigs, options = {}) {
    const enableLoadBalancing = options.enableLoadBalancing ?? false;
    const minHealthyScore = options.minHealthyScore ?? 70;

    if (!enableLoadBalancing) {
      return this.getOrderedProviders(providerConfigs);
    }

    const scores = providerConfigs.map((config) => this.getHealth(config.name).healthScore || 0);
    const allHealthy = scores.every((score) => score >= minHealthyScore);

    if (!allHealthy) {
      return this.getOrderedProviders(providerConfigs);
    }

    const weighted = providerConfigs.map((config, index) => ({
      config,
      weight: Math.max(1, scores[index] || 1),
    }));

    const ordered = [];
    let pool = weighted.slice();
    let totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);

    while (pool.length > 0) {
      let roll = Math.random() * totalWeight;
      let pickedIndex = 0;

      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) {
          pickedIndex = i;
          break;
        }
      }

      const [picked] = pool.splice(pickedIndex, 1);
      totalWeight -= picked.weight;
      ordered.push(picked.config);
    }

    return ordered;
  }

  canUse(providerName) {
    const health = this.getHealth(providerName);
    if (health.healthScore <= 0) return false;
    if (health.cooldownUntil && new Date(health.cooldownUntil) > new Date()) return false;
    return true;
  }

  markDisabled(providerName, reason) {
    const health = { ...this.getHealth(providerName) };
    health.healthScore = 0;
    health.lastError = reason || 'disabled';
    health.lastErrorCode = 'DISABLED';
    health.updatedAt = new Date().toISOString();
    this.health.set(providerName, health);
    this._persist(health);
  }

  recordSuccess(providerName, latencyMs) {
    const health = { ...this.getHealth(providerName) };
    const boost = latencyMs && latencyMs > 5000 ? 2 : 5;

    health.healthScore = clampScore(health.healthScore + boost);
    health.consecutiveFailures = 0;
    health.lastError = null;
    health.lastErrorCode = null;
    health.lastSuccess = new Date().toISOString();
    health.totalRequests += 1;
    health.updatedAt = new Date().toISOString();

    this.health.set(providerName, health);
    this._persist(health);
  }

  recordFailure(providerName, errorType, errorCode, errorMessage) {
    const health = { ...this.getHealth(providerName) };
    let penalty = 5;

    switch (errorType) {
      case 'rate_limit':
        penalty = 20;
        health.cooldownUntil = new Date(Date.now() + 60 * 1000).toISOString();
        break;
      case 'auth':
        penalty = 100;
        health.cooldownUntil = null;
        break;
      case 'server':
        penalty = 10;
        health.cooldownUntil = new Date(Date.now() + 30 * 1000).toISOString();
        break;
      case 'timeout':
        penalty = 5;
        health.cooldownUntil = new Date(Date.now() + 10 * 1000).toISOString();
        break;
      case 'network':
        penalty = 15;
        break;
      default:
        penalty = 5;
        break;
    }

    health.healthScore = clampScore(health.healthScore - penalty);
    health.consecutiveFailures += 1;
    health.totalRequests += 1;
    health.totalFailures += 1;
    health.lastFailure = new Date().toISOString();
    health.lastError = errorMessage || 'unknown error';
    health.lastErrorCode = errorCode ? String(errorCode) : null;

    if (health.consecutiveFailures >= 3) {
      health.cooldownUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }

    if (errorType === 'auth') {
      health.healthScore = 0;
    }

    health.updatedAt = new Date().toISOString();
    this.health.set(providerName, health);
    this._persist(health);
  }

  async recoverScores() {
    for (const [name, health] of this.health.entries()) {
      if (health.healthScore > 0 && health.healthScore < SCORE_MAX) {
        const updated = {
          ...health,
          healthScore: clampScore(health.healthScore + 5),
          updatedAt: new Date().toISOString(),
        };
        this.health.set(name, updated);
        this._persist(updated);
      }
    }
  }
}

module.exports = HealthManager;
