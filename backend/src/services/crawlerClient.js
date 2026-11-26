'use strict';
const config = require('../config');
const { ApiError } = require('../utils/http');

/** Calls to the Python crawler service on the internal network. */
async function call(method, path, body, { timeoutMs = 30000, raw = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(config.crawlerUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Internal-Token': config.internalToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(502, 'crawler_unreachable', `Crawler service unreachable (${e.name === 'AbortError' ? 'timeout' : e.message})`);
  } finally {
    clearTimeout(timer);
  }
  if (raw) return res;
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = json.error;
    const msg = (err && (err.message || err)) || `Crawler returned HTTP ${res.status}`;
    throw new ApiError(res.status >= 500 ? 502 : res.status, (err && err.code) || 'crawler_error', String(msg).slice(0, 500));
  }
  return json;
}

module.exports = {
  call,
  health: () => call('GET', '/internal/health', undefined, { timeoutMs: 5000 }),
  startJob: (crawlId, settings) => call('POST', '/internal/jobs', { crawl_id: crawlId, settings }),
  stopJob: (crawlId) => call('POST', `/internal/jobs/${encodeURIComponent(crawlId)}/stop`, {}),
  jobStatus: (crawlId) => call('GET', `/internal/jobs/${encodeURIComponent(crawlId)}`),
};
