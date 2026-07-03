'use strict';

const fs = require('fs');
const readline = require('readline');
const chokidar = require('chokidar');

const config = require('./config');
const log = require('./lib/logger');
const { StateManager } = require('./lib/state');
const { Scanner } = require('./lib/scanner');
const { Mirror } = require('./lib/mirror');
const {
  recordsToInboxes,
  readSubagentMembers,
  buildTeamConfig,
} = require('./lib/transformer');

const TEAM_PREFIX = 'cc-';

class Adapter {
  constructor() {
    this.state = new StateManager(config.stateDir);
    this.scanner = new Scanner(config);
    this.mirror = new Mirror(config);
    this.watcher = null;
    this.timer = null;
    this.processing = new Set(); // guard against concurrent processing of same session
  }

  teamKey(sessionId) {
    return TEAM_PREFIX + sessionId;
  }

  /** Reads jsonl from the saved offset; returns {records, lineCount}. */
  async readFromOffset(filePath, sessionId) {
    const startLine = this.state.lastLine(sessionId);
    const records = [];
    let lineNo = 0;
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lineNo++;
      if (lineNo <= startLine) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        log.debug('skip malformed jsonl line', { sessionId, lineNo });
      }
    }
    return { records, lineCount: lineNo };
  }

  /** Builds synthetic tasks (one per subagent) for the Tasks panel. */
  buildTasks(members) {
    return members
      .filter((m) => m.type === 'subagent')
      .map((m, i) => ({
        id: `subagent-${i}-${m.agentId}`,
        title: m.name,
        description: m.description || m.name,
        status: 'completed',
        assignee: m.name,
        createdAt: Date.now(),
        blockedBy: [],
      }));
  }

  async processSession(session) {
    const { sessionId, filePath, mtimeMs, subagentsDir } = session;
    if (this.processing.has(sessionId)) return;
    this.processing.add(sessionId);
    try {
      const prev = this.state.get(sessionId);
      // skip if file unchanged since last run AND we already have output
      if (prev && prev.mtimeMs === mtimeMs && this.mirror.isOwned(this.teamKey(sessionId))) {
        return;
      }

      const { records, lineCount } = await this.readFromOffset(filePath, sessionId);
      const members = readSubagentMembers(subagentsDir);

      // Always (re)build config so member/subagent changes show up; inbox
      // messages are appended incrementally below.
      const teamKey = this.teamKey(sessionId);

      // Merge new messages with whatever we already wrote (read existing inbox).
      const newInboxes = recordsToInboxes(records);
      const merged = this.mergeInboxes(teamKey, newInboxes);

      const totalMsgs = Object.values(merged).reduce((n, a) => n + a.length, 0);
      const teamConfig = buildTeamConfig(sessionId, members, totalMsgs);
      const tasks = this.buildTasks(members);

      this.mirror.writeTeam(teamKey, teamConfig, merged, tasks);
      const linked = this.mirror.mirrorOutputs(sessionId);

      this.state.record(sessionId, { lastProcessedLine: lineCount, mtimeMs });
      log.info('session synced', {
        sessionId: sessionId.slice(0, 8),
        newRecords: records.length,
        members: members.length,
        totalMsgs,
        outputs: linked,
      });
    } catch (err) {
      log.error('processSession failed', { sessionId, error: err.message });
    } finally {
      this.processing.delete(sessionId);
    }
  }

  /** Reads existing inbox files and appends new messages (dedup by from+ts+text). */
  mergeInboxes(teamKey, newInboxes) {
    const path = require('path');
    const inboxesDir = path.join(this.mirror.teamDir(teamKey), 'inboxes');
    const out = {};
    const agents = new Set([...Object.keys(newInboxes)]);
    // include any existing inbox agents
    try {
      for (const f of fs.readdirSync(inboxesDir)) {
        if (f.endsWith('.json')) agents.add(f.slice(0, -5));
      }
    } catch {
      /* fresh */
    }
    for (const agent of agents) {
      let existing = [];
      try {
        existing = JSON.parse(fs.readFileSync(path.join(inboxesDir, `${agent}.json`), 'utf8'));
        if (!Array.isArray(existing)) existing = [];
      } catch {
        /* none */
      }
      const seen = new Set(existing.map((m) => `${m.from}|${m.timestamp}|${(m.text || '').slice(0, 32)}`));
      const fresh = (newInboxes[agent] || []).filter(
        (m) => !seen.has(`${m.from}|${m.timestamp}|${(m.text || '').slice(0, 32)}`)
      );
      out[agent] = existing.concat(fresh);
    }
    return out;
  }

  syncOnce() {
    const sessions = this.scanner.scan();
    log.info('scan', { recent: sessions.length });
    // sequential to bound memory on large jsonl
    return sessions.reduce(
      (p, s) => p.then(() => this.processSession(s)),
      Promise.resolve()
    ).then(() => {
      this.cleanupStale(sessions);
      this.state.save();
    });
  }

  /** Removes adapter-owned teams whose session dropped out of the recent set. */
  cleanupStale(currentSessions) {
    const path = require('path');
    const live = new Set(currentSessions.map((s) => this.teamKey(s.sessionId)));
    let teamDirs = [];
    try {
      teamDirs = fs.readdirSync(config.teamsDir);
    } catch {
      return;
    }
    for (const d of teamDirs) {
      if (!d.startsWith(TEAM_PREFIX)) continue;
      if (live.has(d)) continue;
      if (fs.existsSync(path.join(config.teamsDir, d, config.ownerMarker))) {
        this.mirror.cleanup(d);
        const sid = d.slice(TEAM_PREFIX.length);
        this.state.remove(sid);
        log.info('cleaned stale team', { team: d });
      }
    }
  }

  async start() {
    this.state.load();
    log.info('adapter starting', {
      projectsDir: config.projectsDir,
      teamsDir: config.teamsDir,
      maxAgeDays: config.maxAgeDays,
      maxSessions: config.maxSessions,
    });

    await this.syncOnce();

    // periodic sync (catches new sessions, mtime changes, cleanup)
    this.timer = setInterval(() => {
      this.syncOnce().catch((err) => log.error('sync tick failed', { error: err.message }));
    }, config.syncIntervalMs);

    // watch jsonl for low-latency updates on the active session
    this.watcher = chokidar.watch(`${config.projectsDir}/*.jsonl`, {
      usePolling: config.watch.usePolling,
      interval: config.watch.interval,
      awaitWriteFinish: config.watch.awaitWriteFinish,
      ignoreInitial: true,
      depth: 0,
    });
    const onChange = (fp) => {
      const path = require('path');
      const sessionId = path.basename(fp, '.jsonl');
      const subDir = path.join(config.projectsDir, sessionId, 'subagents');
      let mtimeMs = Date.now();
      try {
        mtimeMs = fs.statSync(fp).mtimeMs;
      } catch {
        /* ignore */
      }
      this.processSession({
        sessionId,
        filePath: fp,
        mtimeMs,
        subagentsDir: fs.existsSync(subDir) ? subDir : null,
      }).then(() => this.state.save());
    };
    this.watcher.on('change', onChange).on('add', onChange);

    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  shutdown() {
    log.info('adapter shutting down');
    if (this.watcher) this.watcher.close();
    if (this.timer) clearInterval(this.timer);
    this.state.save();
    process.exit(0);
  }
}

// ---- entrypoint ----
const adapter = new Adapter();
if (process.argv.includes('--once')) {
  adapter.state.load();
  adapter
    .syncOnce()
    .then(() => {
      log.info('one-shot sync complete');
      process.exit(0);
    })
    .catch((err) => {
      log.error('one-shot failed', { error: err.message });
      process.exit(1);
    });
} else {
  adapter.start().catch((err) => {
    log.error('fatal', { error: err.message });
    process.exit(1);
  });
}
