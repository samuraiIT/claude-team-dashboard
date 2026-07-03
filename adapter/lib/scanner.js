'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

/**
 * Discovers recent Claude Code session jsonl files under projectsDir.
 * Filters by age (maxAgeDays) and caps to the newest maxSessions.
 * Pure read-only; never mutates sources.
 */
class Scanner {
  constructor(config) {
    this.config = config;
  }

  /** @returns {Array<{sessionId, filePath, mtimeMs, subagentsDir}>} newest first */
  scan() {
    const { projectsDir, maxAgeDays, maxSessions } = this.config;
    let entries;
    try {
      entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.warn('projectsDir missing', { projectsDir });
        return [];
      }
      throw err;
    }

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const sessions = [];

    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.jsonl')) continue;
      const sessionId = ent.name.slice(0, -'.jsonl'.length);
      // session ids are uuids: [a-z0-9-]; matches dashboard sanitizeTeamName allowlist
      if (!/^[a-zA-Z0-9_.-]+$/.test(sessionId)) continue;
      const filePath = path.join(projectsDir, ent.name);
      let st;
      try {
        st = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      const subagentsDir = path.join(projectsDir, sessionId, 'subagents');
      sessions.push({
        sessionId,
        filePath,
        mtimeMs: st.mtimeMs,
        subagentsDir: fs.existsSync(subagentsDir) ? subagentsDir : null,
      });
    }

    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return sessions.slice(0, maxSessions);
  }
}

module.exports = { Scanner };
