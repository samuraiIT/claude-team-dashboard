'use strict';

// Minimal dependency-free assertions (node tests/transformer.test.js).
const assert = require('assert');
const { extractText, recordsToInboxes, buildTeamConfig } = require('../lib/transformer');

let pass = 0;
function ok(name, fn) {
  fn();
  pass++;
  console.log(`  ok - ${name}`);
}

ok('extractText handles plain user string', () => {
  assert.strictEqual(extractText('hello world'), 'hello world');
});

ok('extractText flattens assistant text + tool_use blocks, skips thinking', () => {
  const content = [
    { type: 'thinking', text: 'secret reasoning' },
    { type: 'text', text: 'Doing the thing' },
    { type: 'tool_use', name: 'Bash' },
  ];
  const out = extractText(content);
  assert.ok(out.includes('Doing the thing'));
  assert.ok(out.includes('→ Bash'));
  assert.ok(!out.includes('secret reasoning'));
});

ok('recordsToInboxes splits user vs claude-code and skips bookkeeping', () => {
  const records = [
    { type: 'queue-operation' },
    { type: 'user', timestamp: 't1', message: { content: 'do X' } },
    { type: 'assistant', timestamp: 't2', message: { content: [{ type: 'text', text: 'done' }] } },
    { type: 'ai-title', message: { content: 'noise' } },
  ];
  const inb = recordsToInboxes(records);
  assert.strictEqual(inb.user.length, 1);
  assert.strictEqual(inb['claude-code'].length, 1);
  assert.strictEqual(inb.user[0].from, 'user');
  assert.strictEqual(inb.user[0].text, 'do X');
  assert.strictEqual(inb['claude-code'][0].text, 'done');
});

ok('buildTeamConfig includes base members + subagents', () => {
  const cfg = buildTeamConfig('0d8164e0-aaaa', [
    { agentId: 'x', name: 'Explore: skills', agentType: 'Explore', type: 'subagent', status: 'completed' },
  ], 5);
  assert.strictEqual(cfg.name, 'cc-0d8164e0');
  assert.strictEqual(cfg.members.length, 3); // user + claude-code + 1 subagent
  assert.strictEqual(cfg.members[0].name, 'user');
});

console.log(`\n${pass} passed`);
