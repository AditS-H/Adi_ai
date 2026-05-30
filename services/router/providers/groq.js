'use strict';

const { BaseProvider } = require('./base');

class GroqProvider extends BaseProvider {
  async call(messages, options = {}) {
    return this._callOpenAI(messages, options);
  }
}

module.exports = GroqProvider;
