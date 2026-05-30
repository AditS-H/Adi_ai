'use strict';

const { Octokit } = require('@octokit/rest');
const logger = require('../../utils/logger');
const config = require('../../config');

class GitHubScraper {
  constructor(options = {}) {
    const username = options.username || config.github.username;
    const token = options.token || config.github.token;

    if (!username) {
      throw new Error('GITHUB_USERNAME is required for GitHub scraping');
    }

    this.username = username;
    this.skipRepos = new Set(options.skipRepos || config.github.skipRepos || []);
    this.skipForks = options.skipForks ?? config.github.skipForks;

    this.octokit = new Octokit({
      auth: token || undefined,
    });
  }

  async listRepos() {
    const repos = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.octokit.rest.repos.listForUser({
        username: this.username,
        type: 'owner',
        per_page: perPage,
        page,
      });

      if (!data || data.length === 0) break;

      for (const repo of data) {
        if (this.skipRepos.has(repo.name)) continue;
        if (this.skipForks && repo.fork) continue;
        repos.push(repo);
      }

      if (data.length < perPage) break;
      page += 1;
    }

    return repos;
  }

  async fetchRepo(repoName) {
    const { data: repo } = await this.octokit.rest.repos.get({
      owner: this.username,
      repo: repoName,
    });

    const readmeText = await this._fetchReadme(repoName);
    const languages = await this._fetchLanguages(repoName);

    return {
      repo,
      readmeText,
      languages,
    };
  }

  async _fetchReadme(repoName) {
    try {
      const { data } = await this.octokit.rest.repos.getReadme({
        owner: this.username,
        repo: repoName,
      });

      if (!data || !data.content) return '';
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      if (error.status === 404) return '';
      logger.warn('Failed to fetch README', { repo: repoName, error: error.message });
      return '';
    }
  }

  async _fetchLanguages(repoName) {
    try {
      const { data } = await this.octokit.rest.repos.listLanguages({
        owner: this.username,
        repo: repoName,
      });
      return data || {};
    } catch (error) {
      logger.warn('Failed to fetch languages', { repo: repoName, error: error.message });
      return {};
    }
  }
}

module.exports = GitHubScraper;
