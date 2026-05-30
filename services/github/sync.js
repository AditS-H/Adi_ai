'use strict';

const logger = require('../../utils/logger');
const config = require('../../config');
const GitHubScraper = require('./scraper');
const GitHubProcessor = require('./processor');
const IngestionPipeline = require('../knowledge/pipeline');

let syncInProgress = false;

class GitHubSync {
  constructor() {
    this.supabase = require('../../config/database');
    this.scraper = new GitHubScraper();
    this.processor = new GitHubProcessor();
    this.pipeline = new IngestionPipeline(this.supabase);
  }

  async syncAll(force = false) {
    if (syncInProgress) {
      const err = new Error('Sync already in progress');
      err.code = 'SYNC_IN_PROGRESS';
      throw err;
    }

    syncInProgress = true;
    const start = Date.now();

    try {
      const repos = await this.scraper.listRepos();
      let newRepos = 0;
      let updatedRepos = 0;
      let skippedRepos = 0;

      for (const repo of repos) {
        const result = await this._syncRepoByData(repo, force);
        if (result === 'new') newRepos += 1;
        else if (result === 'updated') updatedRepos += 1;
        else skippedRepos += 1;
      }

      return {
        totalRepos: repos.length,
        newRepos,
        updatedRepos,
        skippedRepos,
        timeTaken: `${Date.now() - start}ms`,
      };
    } finally {
      syncInProgress = false;
    }
  }

  async syncRepo(repoName) {
    if (!repoName) {
      throw new Error('Repository name is required');
    }

    const { repo, readmeText, languages } = await this.scraper.fetchRepo(repoName);
    const result = await this._syncRepoByData(repo, true, { readmeText, languages });

    return { repo: repoName, status: result };
  }

  async _syncRepoByData(repo, force, details = null) {
    if (!repo || !repo.name) return 'skipped';
    if (config.github.skipForks && repo.fork) return 'skipped';
    if (config.github.skipRepos && config.github.skipRepos.includes(repo.name)) return 'skipped';

    const { data: existing } = await this.supabase
      .from('github_repos')
      .select('*')
      .eq('repo_name', repo.name)
      .maybeSingle();

    let readmeText = details?.readmeText;
    let languages = details?.languages;

    if (readmeText === undefined || languages === undefined) {
      const fetched = await this.scraper.fetchRepo(repo.name);
      readmeText = fetched.readmeText;
      languages = fetched.languages;
    }
    const processed = this.processor.buildDocument({ repo, readmeText, languages });

    const hasChanged = !existing || existing.readme_hash !== processed.readmeHash;
    if (!hasChanged && !force) {
      return 'skipped';
    }

    const repoRow = {
      repo_name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      html_url: repo.html_url,
      language: repo.language,
      languages,
      topics: repo.topics || [],
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      readme_hash: processed.readmeHash,
      last_scraped: new Date().toISOString(),
      last_commit: repo.pushed_at,
      is_fork: !!repo.fork,
      is_private: !!repo.private,
      is_indexed: false,
      updated_at: new Date().toISOString(),
    };

    await this.supabase
      .from('github_repos')
      .upsert(repoRow, { onConflict: 'repo_name' });

    if (processed.shouldIndex) {
      await this.pipeline.process(processed.document, {
        sourceType: 'github',
        sourceId: repo.name,
        sourceUrl: repo.html_url,
        fileType: 'string',
        metadata: {
          repo: repo.full_name,
          language: repo.language,
          languages: processed.languageSummary,
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
        },
      });

      await this.supabase
        .from('github_repos')
        .update({ is_indexed: true, updated_at: new Date().toISOString() })
        .eq('repo_name', repo.name);
    }

    return existing ? 'updated' : 'new';
  }
}

module.exports = { GitHubSync };
