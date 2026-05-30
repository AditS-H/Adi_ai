'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { BaseProvider, ProviderRequestError } = require('./base');

class GeminiProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);

    if (this.apiKey) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.modelClient = this.genAI.getGenerativeModel({ model: this.model });
    } else {
      this.genAI = null;
      this.modelClient = null;
    }
  }

  isConfigured() {
    return !!this.apiKey;
  }

  _convertMessages(messages) {
    const systemMessages = [];
    const contents = [];

    for (const message of messages || []) {
      if (!message || !message.content) continue;
      if (message.role === 'system') {
        systemMessages.push(message.content);
        continue;
      }

      const role = message.role === 'assistant' ? 'model' : 'user';
      contents.push({
        role,
        parts: [{ text: message.content }],
      });
    }

    const systemInstruction = systemMessages.length
      ? { parts: [{ text: systemMessages.join('\n') }] }
      : undefined;

    return { systemInstruction, contents };
  }

  async call(messages, options = {}) {
    if (!this.modelClient) {
      throw new ProviderRequestError('Gemini API key not configured', {
        provider: this.name,
        code: 'NO_API_KEY',
      });
    }

    const { systemInstruction, contents } = this._convertMessages(messages);

    if (!contents.length) {
      throw new ProviderRequestError('Gemini requires at least one user message', {
        provider: this.name,
        code: 'EMPTY_MESSAGES',
      });
    }

    const generationConfig = {
      maxOutputTokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
    };

    const result = await this.modelClient.generateContent({
      contents,
      systemInstruction,
      generationConfig,
    });

    const response = result?.response;
    const text = response?.text ? response.text() : null;

    if (!text) {
      throw new ProviderRequestError('Gemini returned an empty response', {
        provider: this.name,
        code: 'EMPTY_RESPONSE',
        responseBody: response,
      });
    }

    return { text, raw: response, provider: this.name };
  }
}

module.exports = GeminiProvider;
