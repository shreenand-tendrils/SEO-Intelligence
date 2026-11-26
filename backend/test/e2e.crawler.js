'use strict';
// Python-to-Node integration: the real Python crawler crawls the repo's
// fixture site and reports into this backend + real PostgreSQL.
// Run with: npm run test:e2e   (PYTHON=python on Windows)
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const h = require('./helpers');

const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const CRAWLER_DIR = path.join(__dirname, '..', '..', 'crawler');
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
let home;

async function waitFor(url, headers = {}, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers }); if (r.ok) return; } catch { /* not up yet */ } await sleep(500); }
  throw new Error(`timeout waiting for ${url}`);
}

test.before(async () => {
  const [sitePort, crawlerPort] = [await freePort(), await freePort()];
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-home-'));
  const base = await h.start({ crawlerUrl: `http://127.0.0.1:${crawlerPort}` });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CRAWLER_HOST: '127.0.0.1', CRAWLER_PORT: String(crawlerPort), BACKEND_INTERNAL_URL: base, INTERNAL_API_TOKEN: h.TOKEN, GROQ_API_KEY: '' };
  if (!process.env.PYTHONUSERBASE && process.platform !== 'win32') env.PYTHONUSERBASE = path.join(os.homedir(), '.local');
  const fixtureDir = path.join(CRAWLER_DIR, 'tests', 'fixture_site');
  procs.push(spawn(PY, ['-c', `import sys,time; sys.path.insert(0, r'${fixtureDir}'); import build, serve; build.build('http://127.0.0.1:${sitePort}'); serve.start(${sitePort}); print('up', flush=True); time.sleep(10**6)`], { cwd: fixtureDir, env, stdio: 'ignore' }));
  procs.push(spawn(PY, ['app.py'], { cwd: CRAWLER_DIR, env, stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore' }));
  await waitFor(`http://127.0.0.1:${sitePort}/`);
  await waitFor(`http://127.0.0.1:${crawlerPort}/internal/health`, { 'X-Internal-Token': h.TOKEN });
  await h.resetDb();
  test.sitePort = sitePort;
});
test.after(async () => { for (const p of procs) p.kill(); await h.stop(); fs.rmSync(home, { recursive: true, force: true }); });

test('real crawl: Python crawler -> Node -> PostgreSQL, scored and queryable', { timeout: 240000 }, async () => {
  const seed = `http://127.0.0.1:${test.sitePort}/`;
  const p = await h.api('POST', '/api/projects', { name: 'Fixture e2e', seedUrl: seed });
  const c = await h.api('POST', `/api/projects/${p.body.data.id}/crawls`, { max_pages: 200, bot_sample: 3 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  let crawl;
  for (let i = 0; i < 200; i++) {
    crawl = (await h.api('GET', `/api/crawls/${c.body.data.id}`)).body.data;
    if (!['QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING'].includes(crawl.status)) break;
    await sleep(1000);
  }
  assert.equal(crawl.status, 'COMPLETED', crawl.error || '');
  assert.ok(crawl.pagesCrawled >= 30, `pages ${crawl.pagesCrawled}`);
  assert.ok(crawl.seoScore.overall > 0 && crawl.seoScore.overall < 100);
  const rep = (await h.api('GET', `/api/crawls/${crawl.id}/reports`)).body.data;
  for (const k of ['response_codes', 'duplicate_titles', 'sitemap', 'near_dup', 'bot_check']) assert.ok(k in rep, `report ${k}`);
  const pages = (await h.api('GET', `/api/crawls/${crawl.id}/pages?status=4xx`)).body.data;
  assert.ok(pages.some((x) => /\/gone\/$/.test(x.url)));
  assert.equal(fs.readdirSync(home).filter((f) => f.startsWith('.site-crawler')).flatMap((d) => fs.readdirSync(path.join(home, d))).filter((f) => f.endsWith('.json')).length, 0, 'no JSON crawl files written');
});
