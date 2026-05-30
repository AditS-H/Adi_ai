'use strict';

const { BaseProvider, ProviderRequestError } = require('./base');

class CloudflareProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || config.accountId;
  }

  isConfigured() {
    return !!this.apiKey && !!this.accountId;
  }

  async call(messages, options = {}) {
    if (!this.isConfigured()) {
      throw new ProviderRequestError('Cloudflare credentials not configured', {
        provider: this.name,
        code: 'NO_API_KEY',
      });
    }

    const url = `${this.baseUrl}/${this.accountId}/ai/run/${encodeURI(this.model)}`;
    const payload = {
      messages,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
    };

    const { data } = await this._requestJson(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      options.timeout || this.timeout
    );

    const text =
      data?.result?.response ||
      data?.result?.message?.content ||
      data?.result?.output ||
      data?.result?.text ||
      null;

    if (!text) {
      throw new ProviderRequestError('Cloudflare returned an empty response', {
        provider: this.name,
        code: 'EMPTY_RESPONSE',
        responseBody: data,
      });
    }

    return { text, raw: data, provider: this.name };
  }
}

module.exports = CloudflareProvider;
