'use strict';
// Shared harness: real PostgreSQL (TEST_DATABASE_URL), the real Express app on
// a random port, and a stub crawler service that records job requests.
const http = require('node:http');
const path = require('node:path');

const TOKEN = 'test-internal-token-0123456789';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://seo:seo@localhost:5432/seo_test?schema=public';
process.env.INTERNAL_API_TOKEN = TOKEN;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.RATE_LIMIT_PER_MINUTE = '100000';

const jobs = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-internal-token'] !== TOKEN) { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
    if (req.url === '/internal/health') return res.end('{"ok":true}');
    if (req.method === 'POST' && req.url === '/internal/jobs') { jobs.push(JSON.parse(body)); res.statusCode = 202; return res.end('{"ok":true}'); }
    if (req.method === 'POST' && /\/stop$/.test(req.url)) return res.end('{"ok":true}');
    res.statusCode = 404; return res.end('{"error":"not found"}');
  });
});

let server; let base;
let migrated = false;
async function start({ crawlerUrl } = {}) {
  if (!migrated) {
    require('node:child_process').execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'ignore', shell: true });
    migrated = true;
  }
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.CRAWLER_INTERNAL_URL = crawlerUrl || `http://127.0.0.1:${stub.address().port}`;
  const { createApp } = require('../src/app');
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function stop() {
  const prisma = require('../src/db');
  await prisma.$disconnect();
  await new Promise((r) => server.close(r));
  await new Promise((r) => stub.close(r));
}

async function api(method, url, body, { internal = false, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (internal) headers['X-Internal-Token'] = token === undefined ? TOKEN : token;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function resetDb() {
  const prisma = require('../src/db');
  const tables = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

const FIXTURES = path.join(__dirname, 'fixtures', 'legacy');
function fixtureCrawl(i = 0) {
  const fs = require('node:fs');
  const f = fs.readdirSync(FIXTURES).filter((x) => x.endsWith('.json')).sort()[i];
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
}

/** Plays the crawler's side of the internal protocol for an existing crawl. */
async function simulateCrawler(crawlId, { rows, inlinks = {}, reports = {}, chunk = 200 }) {
  await api('POST', `/internal/crawls/${crawlId}/progress`, { state: 'running', pages_crawled: 1, queued: rows.length }, { internal: true });
  for (let i = 0; i < rows.length; i += chunk) {
    const r = await api('POST', `/internal/crawls/${crawlId}/pages`, { reset: i === 0, offset: i, rows: rows.slice(i, i + chunk) }, { internal: true });
    if (r.status !== 200) throw new Error(`pages chunk failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const done = await api('POST', `/internal/crawls/${crawlId}/complete`, { inlinks, reports }, { internal: true });
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`);
  return done.body;
}

module.exports = { start, stop, api, resetDb, jobs, fixtureCrawl, simulateCrawler, FIXTURES, TOKEN };
