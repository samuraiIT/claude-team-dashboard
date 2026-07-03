'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

/**
 * Tracks per-session high-watermarks so we only translate new jsonl lines.
 * Persisted atomically to <stateDir>/state.json.
 */
class StateManager {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.file = path.join(stateDir, 'state.json');
    this.data = { version: 1, sessions: {} };
  }

  load() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.sessions) this.data = parsed;
      log.debug('state loaded', { sessions: Object.keys(this.data.sessions).length });
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('state load failed, starting fresh', { error: err.message });
    }
  }

  save() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file); // atomic
    } catch (err) {
      log.error('state save failed', { error: err.message });
    }
  }

  get(sessionId) {
    return this.data.sessions[sessionId];
  }

  /** Returns the last processed line index (exclusive), 0 if unseen. */
  lastLine(sessionId) {
    return this.data.sessions[sessionId]?.lastProcessedLine || 0;
  }

  record(sessionId, { lastProcessedLine, mtimeMs }) {
    this.data.sessions[sessionId] = {
      lastProcessedLine,
      mtimeMs,
      updatedAt: new Date().toISOString(),
    };
  }

  remove(sessionId) {
    delete this.data.sessions[sessionId];
  }

  knownSessions() {
    return Object.keys(this.data.sessions);
  }
}

module.exports = { StateManager };
