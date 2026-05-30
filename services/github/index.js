'use strict';

const GitHubScraper = require('./scraper');
const GitHubProcessor = require('./processor');
const { GitHubSync } = require('./sync');

module.exports = {
  GitHubScraper,
  GitHubProcessor,
  GitHubSync,
};
