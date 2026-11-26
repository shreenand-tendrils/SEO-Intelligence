'use strict';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.LOG_LEVEL || 'info'] || 20;
const SECRET_KEYS = /token|secret|password|authorization|api[_-]?key|cookie/i;

function scrub(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 3) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(x, depth + 1);
  return out;
}

function log(level, msg, meta) {
  if (LEVELS[level] < min || process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(meta ? scrub(meta) : {}) };
  (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
}
module.exports = {
  debug: (m, x) => log('debug', m, x), info: (m, x) => log('info', m, x),
  warn: (m, x) => log('warn', m, x), error: (m, x) => log('error', m, x), scrub,
};
