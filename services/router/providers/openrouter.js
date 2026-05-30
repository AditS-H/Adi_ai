'use strict';

const { BaseProvider } = require('./base');

class OpenRouterProvider extends BaseProvider {
  async call(messages, options = {}) {
    return this._callOpenAI(messages, options);
  }
}

module.exports = OpenRouterProvider;
