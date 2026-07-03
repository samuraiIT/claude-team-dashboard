# claude-team-dashboard adapter

Read-only bridge that translates this server's real Claude Code logs into the
`~/.claude/teams/` layout the dashboard expects. Without it the dashboard shows
an empty screen (the Claude Code "teams" feature is not used here).

## What it reads (never mutates)
- `~/.claude/projects/-opt-project-llm/*.jsonl` — session transcripts
- `~/.claude/projects/-opt-project-llm/<session>/subagents/*.meta.json` — subagent roles
- `/tmp/claude-1000/-opt-project-llm/<session>/tasks/*.output` — tool output

## What it writes
- `~/.claude/teams/cc-<session>/config.json` — team + members (user, claude-code, subagents)
- `~/.claude/teams/cc-<session>/inboxes/{user,claude-code}.json` — messages `{from,to,text,type,timestamp}`
- `~/.claude/tasks/cc-<session>/*.json` — synthetic tasks (one per subagent)
- `/tmp/claude/D--agentdashboard/tasks/<sid>--*.output` — symlinks to real outputs
- `~/.claude/adapter-state/state.json` — per-session high-watermarks (idempotency)

Team keys are **prefixed `cc-`** so they can never collide with real
`~/.claude/tasks/<session>` dirs that Claude Code owns. Each generated team dir
carries an `.adapter-owned` marker; cleanup refuses to touch anything without it.

## Run
```bash
npm install
npm test           # transformer unit tests
npm run once       # one-shot sync (dry-run friendly)
npm start          # watch + periodic sync (5s)
```

## Config (env, see config.js)
- `ADAPTER_MAX_AGE_DAYS` (default 3) — only sessions newer than this
- `ADAPTER_MAX_SESSIONS` (default 12) — cap newest N sessions (250+ exist on disk)
- `ADAPTER_MAX_MESSAGES` (default 300) — per-inbox message cap
- `ADAPTER_SYNC_MS` (default 5000) — periodic sync interval
- `LOG_LEVEL` (info|debug)
- `TMPDIR` — must match the dashboard's (`/tmp`); do NOT enable systemd PrivateTmp

## Service
`systemd/claude-dashboard-adapter.service` (After=claude-dashboard.service).
Logs: `journalctl -u claude-dashboard-adapter -f`.
