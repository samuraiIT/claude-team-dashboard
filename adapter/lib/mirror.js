'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

/** Atomic JSON write: tmp + rename so the dashboard never sees a partial file. */
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

class Mirror {
  constructor(config) {
    this.config = config;
  }

  /**
   * Path of the adapter-owned team dir for a team key.
   * The team key is always prefixed (cc-<sessionId>) so it can never collide
   * with a real ~/.claude/tasks/<sessionId> directory that Claude Code owns.
   */
  teamDir(teamKey) {
    return path.join(this.config.teamsDir, teamKey);
  }

  /** True only if this team dir exists AND carries our ownership marker. */
  isOwned(teamKey) {
    return fs.existsSync(path.join(this.teamDir(teamKey), this.config.ownerMarker));
  }

  /**
   * Writes config.json, inboxes/*.json (under ~/.claude/teams/<teamKey>) and
   * synthetic task files (under ~/.claude/tasks/<teamKey> — prefixed, so the
   * real ~/.claude/tasks/<sessionId> is never touched).
   */
  writeTeam(teamKey, teamConfig, inboxes, tasks) {
    const dir = this.teamDir(teamKey);
    const inboxesDir = path.join(dir, 'inboxes');
    fs.mkdirSync(inboxesDir, { recursive: true });

    // ownership marker (refuse to clean dirs we didn't create)
    const marker = path.join(dir, this.config.ownerMarker);
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'claude-team-dashboard-adapter\n');

    writeJsonAtomic(path.join(dir, 'config.json'), teamConfig);

    const cap = this.config.maxMessagesPerInbox;
    for (const [agent, msgs] of Object.entries(inboxes)) {
      if (!msgs || msgs.length === 0) continue;
      writeJsonAtomic(path.join(inboxesDir, `${agent}.json`), msgs.slice(-cap));
    }

    if (tasks && tasks.length) {
      const tasksDir = path.join(this.config.tasksDir, teamKey);
      fs.mkdirSync(tasksDir, { recursive: true });
      for (const t of tasks) {
        writeJsonAtomic(path.join(tasksDir, `${t.id}.json`), t);
      }
    }
  }

  /**
   * Mirrors plain-text .output files for the session into the dashboard's
   * temp-tasks dir via symlink (prefixed with session id to avoid collisions).
   * Uses the REAL sessionId (not the team key) because /tmp paths are keyed
   * by the underlying Claude Code session.
   * @returns {number} count of links created/refreshed
   */
  mirrorOutputs(sessionId) {
    const { tmpTasksGlobTemplate, dashboardTempTasks } = this.config;
    const srcDir = tmpTasksGlobTemplate.replace('{session}', sessionId);
    fs.mkdirSync(dashboardTempTasks, { recursive: true });

    // Garbage-collect this session's previously mirrored links whose source is
    // gone (Claude Code removes .output when a background task is reaped) —
    // otherwise the dashboard keeps polling dead symlinks and logs ENOENT.
    const prefix = `${sessionId.slice(0, 8)}--`;
    try {
      for (const entry of fs.readdirSync(dashboardTempTasks)) {
        if (!entry.startsWith(prefix)) continue;
        const linkPath = path.join(dashboardTempTasks, entry);
        try {
          fs.accessSync(linkPath); // follows symlink; throws if target missing
        } catch {
          fs.rmSync(linkPath, { force: true });
        }
      }
    } catch {
      /* ignore */
    }

    if (!fs.existsSync(srcDir)) return 0;
    let files;
    try {
      files = fs.readdirSync(srcDir);
    } catch {
      return 0;
    }
    let linked = 0;
    for (const f of files) {
      if (!f.endsWith('.output')) continue;
      const src = path.join(srcDir, f);
      // Claude Code .output entries are symlinks to jsonl transcripts; resolve
      // to the real file so the dashboard reads plain content.
      let realSrc;
      try {
        realSrc = fs.realpathSync(src);
      } catch {
        continue; // dangling
      }
      const dst = path.join(dashboardTempTasks, `${sessionId.slice(0, 8)}--${f}`);
      try {
        if (fs.lstatSync(dst, { throwIfNoEntry: false })) fs.rmSync(dst, { force: true });
      } catch {
        /* ignore */
      }
      try {
        fs.symlinkSync(realSrc, dst);
        linked++;
      } catch (err) {
        log.debug('symlink failed', { dst, error: err.message });
      }
    }
    return linked;
  }

  /** Removes an adapter-owned team dir + its synthetic (prefixed) tasks. */
  cleanup(teamKey) {
    if (!this.isOwned(teamKey)) {
      log.warn('refusing cleanup of non-owned team', { teamKey });
      return;
    }
    fs.rmSync(this.teamDir(teamKey), { recursive: true, force: true });
    const tasksDir = path.join(this.config.tasksDir, teamKey);
    try {
      fs.rmSync(tasksDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

module.exports = { Mirror, writeJsonAtomic };
