'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info')] ?? LEVELS.info;

function emit(level, msg, data) {
  if (LEVELS[level] > current) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data && typeof data === 'object' ? data : data !== undefined ? { data } : {}),
  };
  // journald captures stdout/stderr; keep it single-line JSON.
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

module.exports = {
  error: (msg, data) => emit('error', msg, data),
  warn: (msg, data) => emit('warn', msg, data),
  info: (msg, data) => emit('info', msg, data),
  debug: (msg, data) => emit('debug', msg, data),
};
