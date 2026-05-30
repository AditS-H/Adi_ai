'use strict';

const logger = require('../../../utils/logger');

class ProviderRequestError extends Error {
  constructor(message, { provider, status, code, responseBody } = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
  }
}

class BaseProvider {
  constructor(config = {}) {
    this.name = config.name;
    this.displayName = config.displayName || config.name;
    this.priority = config.priority || 99;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.maxTokens = config.maxTokens || 1024;
    this.contextWindow = config.contextWindow || 8192;
    this.timeout = config.timeout || 15000;
    this.apiStyle = config.apiStyle || 'openai';
    this.apiKeyEnvVar = config.apiKeyEnvVar;
    this.apiKey = this.apiKeyEnvVar ? process.env[this.apiKeyEnvVar] : config.apiKey;
    this.extraHeaders = config.extraHeaders || {};
    this.retryOnStatusCodes = config.retryOnStatusCodes || [];
    this.failOnStatusCodes = config.failOnStatusCodes || [];
  }

  isConfigured() {
    return !!this.apiKey;
  }

  getModelInfo() {
    return {
      name: this.model,
      maxTokens: this.maxTokens,
      contextWindow: this.contextWindow,
    };
  }

  async call() {
    throw new Error('BaseProvider.call() not implemented');
  }

  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
    };
  }

  async _fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      return { res, data, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  async _requestJson(url, options, timeoutMs) {
    const maxAttempts = this.retryOnStatusCodes.length ? 2 : 1;
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { res, data, text } = await this._fetchJson(url, options, timeoutMs);

        if (res.ok) {
          return { data, status: res.status, headers: res.headers };
        }

        const err = new ProviderRequestError(
          `Provider ${this.name} returned ${res.status}`,
          {
            provider: this.name,
            status: res.status,
            responseBody: data || text,
          }
        );

        if (this.failOnStatusCodes.includes(res.status)) {
          throw err;
        }

        if (this.retryOnStatusCodes.includes(res.status) && attempt < maxAttempts - 1) {
          continue;
        }

        throw err;
      } catch (error) {
        lastError = error;

        const status = error.status || error.statusCode;
        const shouldRetry =
          this.retryOnStatusCodes.length > 0 &&
          attempt < maxAttempts - 1 &&
          (!status || this.retryOnStatusCodes.includes(status));

        if (shouldRetry) {
          logger.warn('Provider request retrying', {
            provider: this.name,
            attempt: attempt + 1,
            error: error.message,
          });
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  async _callOpenAI(messages, options = {}) {
    if (!this.isConfigured()) {
      throw new ProviderRequestError('Provider API key not configured', {
        provider: this.name,
        code: 'NO_API_KEY',
      });
    }

    const payload = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
    };

    const url = `${this.baseUrl}/chat/completions`;

    const { data } = await this._requestJson(
      url,
      {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(payload),
      },
      options.timeout || this.timeout
    );

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new ProviderRequestError('Provider returned an empty response', {
        provider: this.name,
        code: 'EMPTY_RESPONSE',
        responseBody: data,
      });
    }

    return { text, raw: data, provider: this.name };
  }
}

module.exports = {
  BaseProvider,
  ProviderRequestError,
};
