'use strict';

const { BaseProvider } = require('./base');

class DeepSeekProvider extends BaseProvider {
  async call(messages, options = {}) {
    return this._callOpenAI(messages, options);
  }
}

module.exports = DeepSeekProvider;
