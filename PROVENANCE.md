# PROVENANCE — claude-team-dashboard (vendored)

## Upstream
- Source: https://github.com/mukul975/claude-team-dashboard
- Commit pinned: `918abb7de7c7944340eb0f20752edf8a853206f1`
- package.json version: `1.2.8`
- Upstream date: 2026-02-25
- License: MIT (see LICENSE)
- Vendored into `/opt/project_llm/projects/claude-team-dashboard/` on 2026-06-14.

## Why vendored (not `npm install -g`)
The server runs under a loopback-bind hardening policy (all services bind
127.0.0.1, fail2ban, secrets `chmod 600`). Upstream binds the HTTP/WebSocket
server to `0.0.0.0` implicitly and ships no `HOST` knob, and it monitors a
Claude Code "teams" file layout this server does not use. Both required local
changes, so the repo is vendored and pinned.

## Local modifications (the ONLY edits to upstream code)
1. `config.js` — added `HOST: process.env.HOST || '127.0.0.1'`.
   Reason: force loopback bind per hardening policy.
2. `server.js` — `server.listen(config.PORT, ...)` →
   `server.listen(config.PORT, config.HOST, ...)` (one line) + a log line
   noting the bound host.
   Reason: actually honour the loopback bind.

No other upstream files are modified. Everything else added lives in:
- `adapter/` — NEW bridge code (not upstream); see `adapter/README.md`.
- `systemd/` — NEW unit templates (not upstream).

## Why an adapter is needed
Upstream watches `~/.claude/teams/<team>/{config.json,inboxes/*.json}` and
`os.tmpdir()/claude/D--agentdashboard/tasks/*.output`. This server's Claude Code
does NOT use the teams feature — `~/.claude/teams/` does not exist. Real data
lives in `~/.claude/projects/-opt-project-llm/*.jsonl` (session logs +
`subagents/*.jsonl` + `*.meta.json`) and `/tmp/claude-1000/.../tasks/*.output`.
The adapter (read-only on sources) translates recent sessions into the teams
layout so the dashboard shows live data instead of an empty screen.

## Port
- Runs on `127.0.0.1:20132`. Upstream default `3001` is taken by Grafana in ufw.
- NOT opened in ufw — access via SSH tunnel only:
  `ssh -L 20132:127.0.0.1:20132 samurai@<server>` → http://localhost:20132

## Known upstream npm audit notes
`npm install` reports vulnerabilities concentrated in devDependencies
(vite/playwright/d3/jsfuzz — build & test only). Runtime deps
(express/ws/chokidar/helmet/compression/cors) are the attack surface and the
service is loopback-only behind password auth. Acceptable for this deployment;
revisit on upstream bumps.

## Update procedure
1. `git fetch` upstream, review diff against pinned commit.
2. Re-apply the two local edits above (or rebase the patch).
3. `npm install && npm run build`, re-run `adapter/tests`, bind-gate check
   (`ss -tlnp | grep 20132` must show `127.0.0.1`).
4. Update the pinned commit/version here.
