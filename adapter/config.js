'use strict';

const os = require('os');
const path = require('path');

const HOME = os.homedir();

// The dashboard derives this temp dir from its own cwd basename:
//   path.join(os.tmpdir(), 'claude', 'D--agentdashboard', 'tasks')
// We mirror agent .output files into exactly that path so the dashboard's
// getAgentOutputs() watcher picks them up unchanged.
const DASHBOARD_TEMP_TASKS = path.join(os.tmpdir(), 'claude', 'D--agentdashboard', 'tasks');

module.exports = {
  // ---- Sources (READ-ONLY) ----
  // Claude Code project session logs (ndjson, one file per session).
  projectsDir: path.join(HOME, '.claude', 'projects', '-opt-project-llm'),
  // Where Claude Code writes plain-text tool output for the *current* run.
  // {session} is substituted per session id.
  tmpTasksGlobTemplate: path.join(os.tmpdir(), 'claude-1000', '-opt-project-llm', '{session}', 'tasks'),

  // ---- Destinations (WRITE) ----
  // Dashboard reads teams from here.
  teamsDir: path.join(HOME, '.claude', 'teams'),
  // Dashboard reads per-team tasks from ~/.claude/tasks/<team>/*.json
  tasksDir: path.join(HOME, '.claude', 'tasks'),
  // Dashboard reads agent outputs from here.
  dashboardTempTasks: DASHBOARD_TEMP_TASKS,
  // Adapter idempotency state (high-watermarks per session).
  stateDir: path.join(HOME, '.claude', 'adapter-state'),

  // ---- Selection / performance ----
  // Only translate recent sessions — there are 250+ historical jsonl files and
  // the dashboard only needs live/recent teams.
  maxAgeDays: Number(process.env.ADAPTER_MAX_AGE_DAYS || 3),
  maxSessions: Number(process.env.ADAPTER_MAX_SESSIONS || 12),
  // Cap messages mirrored per inbox to keep files small (dashboard shows last 200).
  maxMessagesPerInbox: Number(process.env.ADAPTER_MAX_MESSAGES || 300),

  // ---- Loop timing ----
  syncIntervalMs: Number(process.env.ADAPTER_SYNC_MS || 5000),
  // Marker file written into each generated team dir so we never touch or
  // delete a team that wasn't created by this adapter.
  ownerMarker: '.adapter-owned',

  watch: {
    usePolling: true,
    interval: 1000,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignoreInitial: false,
    depth: 0,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};
