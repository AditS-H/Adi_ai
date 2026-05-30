'use strict';

const crypto = require('crypto');

class GitHubProcessor {
  buildDocument({ repo, readmeText, languages }) {
    const languageEntries = Object.entries(languages || {});
    const totalBytes = languageEntries.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
    const languageSummary = languageEntries
      .map(([lang, bytes]) => {
        const pct = Math.round((bytes / totalBytes) * 100);
        return `${lang} (${pct}%)`;
      })
      .join(', ');

    const topics = repo.topics && repo.topics.length ? repo.topics.join(', ') : 'None';
    const description = repo.description || 'No description provided.';
    const readme = readmeText && readmeText.trim().length > 0
      ? readmeText.trim()
      : 'This project does not have detailed documentation.';

    const doc = [
      `# ${repo.name}`,
      '',
      `**Description:** ${description}`,
      `**Primary Language:** ${repo.language || 'Unknown'}`,
      `**All Languages:** ${languageSummary || 'Unknown'}`,
      `**Topics:** ${topics}`,
      `**GitHub URL:** ${repo.html_url}`,
      `**Stars:** ${repo.stargazers_count || 0} | **Last Updated:** ${repo.pushed_at || ''}`,
      '',
      '## About This Project',
      '',
      readme,
    ].join('\n');

    const hashInput = [readmeText || '', description, topics].join('|');
    const readmeHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    const shouldIndex =
      (readmeText && readmeText.trim().length >= 100) ||
      !!repo.description;

    return {
      document: doc,
      readmeHash,
      shouldIndex,
      languageSummary,
    };
  }
}

module.exports = GitHubProcessor;
