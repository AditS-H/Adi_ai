'use strict';

const logger = require('../../utils/logger');

class AnalyticsService {
  constructor(supabaseClient) {
    try {
      this.supabase = supabaseClient || require('../../config/database');
    } catch (error) {
      this.supabase = null;
    }

    if (!this.supabase) {
      logger.warn('AnalyticsService disabled: Supabase client unavailable');
    }
  }

  _isReady() {
    return !!this.supabase;
  }

  _sinceIso(days) {
    const ms = days * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }

  async logQuery(payload = {}) {
    if (!this._isReady()) return;

    const record = {
      question: payload.question || '',
      answer_length: payload.answerLength || 0,
      provider_used: payload.providerUsed || null,
      was_cached: !!payload.wasCached,
      rag_chunks: payload.ragChunks || 0,
      response_time: payload.responseTime || null,
      session_id: payload.sessionId || null,
      ip_hash: payload.ipHash || null,
      created_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('analytics')
      .insert(record);

    if (error) {
      logger.warn('Analytics insert failed', { error: error.message });
    }
  }

  async _fetchRecent(days, fields) {
    if (!this._isReady()) return [];

    const { data, error } = await this.supabase
      .from('analytics')
      .select(fields)
      .gte('created_at', this._sinceIso(days))
      .limit(5000);

    if (error) {
      logger.warn('Analytics fetch failed', { error: error.message });
      return [];
    }

    return data || [];
  }

  async getTopQuestions(limit = 20, days = 7) {
    const rows = await this._fetchRecent(days, 'question');
    const counts = new Map();

    for (const row of rows) {
      if (!row.question) continue;
      counts.set(row.question, (counts.get(row.question) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([question, count]) => ({ question, count }));
  }

  async getProviderUsage(days = 7) {
    const rows = await this._fetchRecent(days, 'provider_used');
    const counts = new Map();

    for (const row of rows) {
      const provider = row.provider_used || 'unknown';
      counts.set(provider, (counts.get(provider) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([provider, count]) => ({ provider, count }));
  }

  async getQueryStats(days = 7) {
    const rows = await this._fetchRecent(days, 'was_cached');
    const totalQueries = rows.length;
    const cachedQueries = rows.filter((row) => row.was_cached).length;

    return { totalQueries, cachedQueries };
  }
}

module.exports = AnalyticsService;
