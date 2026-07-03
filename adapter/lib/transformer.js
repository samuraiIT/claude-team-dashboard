'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

// jsonl record types that carry conversational content. Everything else
// (queue-operation, file-history-snapshot, ai-title, last-prompt, attachment)
// is bookkeeping and skipped.
const CONTENT_TYPES = new Set(['user', 'assistant']);

/**
 * Extracts a flat, human-readable string from a Claude Code message.content,
 * which is either a string (user) or an array of blocks (assistant).
 */
function extractText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (block.text && block.text.trim()) parts.push(block.text.trim());
        break;
      case 'thinking':
        // skip internal reasoning from the feed
        break;
      case 'tool_use':
        parts.push(`→ ${block.name}`);
        break;
      case 'tool_result': {
        const t = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => (c && c.text) || '').join(' ')
            : '';
        if (t.trim()) parts.push(`⌁ ${t.trim().slice(0, 200)}`);
        break;
      }
      default:
        break;
    }
  }
  return parts.join('\n').trim();
}

/**
 * Converts an array of parsed jsonl records into inbox message objects shaped
 * the way the dashboard frontend reads them: { from, to, text, type, timestamp }.
 * Returns { user: [...], 'claude-code': [...] } keyed by inbox agent name.
 */
function recordsToInboxes(records) {
  const userMsgs = [];
  const assistantMsgs = [];

  for (const rec of records) {
    if (!rec || !CONTENT_TYPES.has(rec.type)) continue;
    const msg = rec.message;
    if (!msg) continue;
    const text = extractText(msg.content);
    if (!text) continue;

    if (rec.type === 'user') {
      // skip harness-injected caveats/system reminders noise but keep real prompts
      userMsgs.push({
        from: 'user',
        to: 'claude-code',
        text,
        type: 'user',
        timestamp: rec.timestamp || null,
      });
    } else {
      assistantMsgs.push({
        from: 'claude-code',
        to: 'user',
        text,
        type: 'assistant',
        timestamp: rec.timestamp || null,
      });
    }
  }

  return { user: userMsgs, 'claude-code': assistantMsgs };
}

/**
 * Reads subagent meta files to derive named team members.
 * Each subagents/agent-<id>.meta.json => { agentType, description }.
 * @returns {Array<{agentId, name, agentType, type, status, description}>}
 */
function readSubagentMembers(subagentsDir) {
  const members = [];
  if (!subagentsDir) return members;
  let files;
  try {
    files = fs.readdirSync(subagentsDir);
  } catch {
    return members;
  }
  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, f), 'utf8'));
      const agentId = f.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
      members.push({
        agentId,
        name: meta.description ? `${meta.agentType}: ${meta.description}`.slice(0, 80) : `${meta.agentType || 'subagent'}-${agentId.slice(0, 6)}`,
        agentType: meta.agentType || 'subagent',
        type: 'subagent',
        status: 'completed',
        description: meta.description || '',
      });
    } catch (err) {
      log.debug('skip bad meta', { file: f, error: err.message });
    }
  }
  return members;
}

/**
 * Builds the team config.json the dashboard expects:
 *   { name, members: [{name, agentType, ...}], ... }
 */
function buildTeamConfig(sessionId, subagentMembers, messageCount) {
  const members = [
    { name: 'user', agentType: 'human', type: 'user', status: 'active' },
    { name: 'claude-code', agentType: 'Claude Code', type: 'orchestrator', status: 'active' },
    ...subagentMembers,
  ];
  return {
    name: `cc-${sessionId.slice(0, 8)}`,
    sessionId,
    source: 'claude-code-adapter',
    members,
    settings: {
      createdBy: 'claude-team-dashboard-adapter',
      messageCount,
      updatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  extractText,
  recordsToInboxes,
  readSubagentMembers,
  buildTeamConfig,
  CONTENT_TYPES,
};
