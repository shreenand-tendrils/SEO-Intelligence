'use strict';
// Real PostgreSQL + real Express app; crawler side simulated over the internal API.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let project; let crawlA; let crawlB;
test.before(async () => { await h.start(); await h.resetDb(); });
test.after(async () => { await h.stop(); });

test('health reports database up', async () => {
  const r = await h.api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.database, 'up');
});

test('Prisma connectivity and applied migrations', async () => {
  const prisma = require('../src/db');
  const [{ one }] = await prisma.$queryRawUnsafe('SELECT 1::int AS one');
  assert.equal(one, 1);
  const m = await prisma.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL');
  assert.ok(m.some((x) => /_init$/.test(x.migration_name)));
});

test('project CRUD, validation and 404s', async () => {
  assert.equal((await h.api('POST', '/api/projects', { name: '' })).status, 400);
  assert.equal((await h.api('POST', '/api/projects', { name: 'x', seedUrl: 'ftp://nope' })).status, 400);
  const c = await h.api('POST', '/api/projects', { name: 'Fixture', seedUrl: 'http://127.0.0.1:8765/' });
  assert.equal(c.status, 201);
  project = c.body.data;
  const list = await h.api('GET', '/api/projects');
  assert.equal(list.body.meta.total, 1);
  const up = await h.api('PATCH', `/api/projects/${project.id}`, { name: 'Fixture site' });
  assert.equal(up.body.data.name, 'Fixture site');
  assert.equal((await h.api('GET', '/api/projects/doesnotexist')).status, 404);
});

test('internal API rejects missing/wrong token', async () => {
  assert.equal((await h.api('POST', '/internal/crawls/x/progress', {}, { internal: true, token: '' })).status, 401);
  assert.equal((await h.api('POST', '/internal/crawls/x/progress', {}, { internal: true, token: 'wrong' })).status, 401);
});

test('crawl creation dispatches to crawler; second concurrent crawl is refused', async () => {
  const r = await h.api('POST', `/api/projects/${project.id}/crawls`, { max_pages: 100 });
  assert.equal(r.status, 201);
  crawlA = r.body.data;
  assert.equal(crawlA.status, 'RUNNING');
  const job = h.jobs.find((j) => j.crawl_id === crawlA.id);
  assert.ok(job, 'crawler received job');
  assert.equal(job.settings.url, 'http://127.0.0.1:8765/');
  assert.equal(job.settings.max_pages, 100);
  assert.equal((await h.api('POST', `/api/projects/${project.id}/crawls`, {})).status, 409);
  assert.equal((await h.api('POST', `/api/projects/${project.id}/crawls`, { max_pages: -5 })).status, 400);
});

test('crawl persistence: pages, issues, scores, reports, inlinks', async () => {
  const d = h.fixtureCrawl(0);
  const dupRows = [...d.results, d.results[0]];
  const done = await h.simulateCrawler(crawlA.id, { rows: dupRows, inlinks: d.inlinks, reports: d.reports, chunk: 10 });
  assert.equal(done.pages, d.results.length);
  const c = (await h.api('GET', `/api/crawls/${crawlA.id}`)).body.data;
  assert.equal(c.status, 'COMPLETED');
  assert.ok(c.seoScore.overall >= 0 && c.seoScore.overall <= 100);

  const prisma = require('../src/db');
  assert.equal(await prisma.crawledPage.count({ where: { crawlId: crawlA.id } }), d.results.length);
  const expectedIssues = d.results.reduce((a, r) => a + new Set(r.issues || []).size, 0);
  assert.equal(await prisma.pageIssue.count({ where: { page: { crawlId: crawlA.id } } }), expectedIssues);
  const inl = Object.values(d.inlinks).reduce((a, l) => a + l.length, 0);
  assert.equal(await prisma.crawlInlink.count({ where: { crawlId: crawlA.id } }), inl);

  const rep = (await h.api('GET', `/api/crawls/${crawlA.id}/reports`)).body.data;
  for (const k of Object.keys(d.reports)) assert.ok(k in rep, `report ${k}`);
  const scores = (await h.api('GET', `/api/crawls/${crawlA.id}/scores`)).body.data;
  assert.equal(scores.site.overall, c.seoScore.overall);
  assert.ok(scores.aggregates);
});

test('pages: pagination, filters, sorting, detail, page score', async () => {
  const p1 = await h.api('GET', `/api/crawls/${crawlA.id}/pages?pageSize=10&page=1&sort=score&order=asc`);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.data.length, 10);
  assert.equal(p1.body.meta.totalPages, Math.ceil(p1.body.meta.total / 10));
  const scored = p1.body.data.map((x) => x.seoScore).filter((x) => x !== null);
  assert.deepEqual(scored, [...scored].sort((a, b) => a - b));
  const p2 = await h.api('GET', `/api/crawls/${crawlA.id}/pages?pageSize=10&page=2&sort=score&order=asc`);
  assert.equal(new Set([...p1.body.data, ...p2.body.data].map((x) => x.id)).size, 20);
  const e4 = await h.api('GET', `/api/crawls/${crawlA.id}/pages?status=4xx`);
  assert.ok(e4.body.data.length >= 1 && e4.body.data.every((x) => x.statusCode >= 400 && x.statusCode < 500));
  const s = await h.api('GET', `/api/crawls/${crawlA.id}/pages?search=canonical`);
  assert.ok(s.body.data.every((x) => /canonical/i.test(x.url + (x.title || ''))));
  assert.equal((await h.api('GET', `/api/crawls/${crawlA.id}/pages?pageSize=100000`)).body.meta.pageSize <= 500, true);

  const id = p1.body.data[0].id;
  const det = (await h.api('GET', `/api/pages/${id}`)).body.data;
  assert.ok(det.scoreBreakdown.categories.length === 7);
  assert.ok(Array.isArray(det.issues));
  const sc = (await h.api('GET', `/api/pages/${id}/score`)).body.data;
  assert.equal(sc.score, det.seoScore);
  assert.equal((await h.api('GET', '/api/pages/nope')).status, 404);
  const iss = (await h.api('GET', `/api/crawls/${crawlA.id}/issues`)).body.data;
  assert.ok(iss.length > 0 && iss.every((i) => i.issue && i.severity && i.pages > 0));
});

test('second crawl, dashboard aggregation, score history and comparison', async () => {
  const r = await h.api('POST', `/api/projects/${project.id}/crawls`, {});
  crawlB = r.body.data;
  const d = h.fixtureCrawl(1);
  const rows = d.results.filter((x) => !/\/gone\/$/.test(x.url)).map((x) => (/\/no-head\/$/.test(x.url) ? { ...x, issues: [] } : x));
  rows.push({ ...rows[1], url: 'http://127.0.0.1:8765/brand-new/', issues: ['Missing meta description'] });
  await h.simulateCrawler(crawlB.id, { rows, inlinks: d.inlinks, reports: d.reports });

  const dash = (await h.api('GET', `/api/projects/${project.id}/dashboard`)).body.data;
  assert.equal(dash.crawl.id, crawlB.id);
  assert.equal(dash.kpis.pagesCrawled, rows.length);
  assert.equal(dash.scoreDistribution.reduce((a, b) => a + b.pages, 0), dash.kpis.pagesAnalyzed);
  assert.equal(dash.responseCodes.reduce((a, b) => a + b.pages, 0), rows.length);
  assert.equal(dash.history.length, 2);
  assert.ok(dash.changes && dash.changes.previousCrawl.id === crawlA.id);

  const hist = (await h.api('GET', `/api/projects/${project.id}/score-history`)).body.data;
  assert.equal(hist.length, 2);

  const cmp = await h.api('POST', `/api/crawls/${crawlB.id}/compare`, { otherCrawlId: crawlA.id });
  assert.equal(cmp.status, 200);
  const c = cmp.body.data;
  assert.equal(c.pages_added_count, 1);
  assert.equal(c.pages_removed_count, 1);
  assert.ok(c.pages_added.includes('http://127.0.0.1:8765/brand-new/'));
  assert.equal(typeof c.score_delta, 'number');
  const again = (await h.api('POST', `/api/crawls/${crawlB.id}/compare`, { otherCrawlId: crawlA.id })).body.data;
  assert.deepEqual(again.new_issues, c.new_issues);
  const prisma = require('../src/db');
  assert.equal(await prisma.crawlComparison.count(), 1);
});

test('AI conversation persistence via internal store API', async () => {
  const c = await h.api('POST', '/internal/ai/conversations', { kind: 'chat', crawl_file: crawlB.id, title: 'Why is my score low?' }, { internal: true });
  assert.equal(c.status, 201);
  const cid = c.body.id;
  await h.api('POST', `/internal/ai/conversations/${cid}/messages`, { role: 'user', content: 'Why is my score low?' }, { internal: true });
  await h.api('POST', `/internal/ai/conversations/${cid}/messages`, { role: 'assistant', content: 'Because…', model: 'm', prompt_tokens: 10, completion_tokens: 5 }, { internal: true });
  const got = (await h.api('GET', `/internal/ai/conversations/${cid}`, undefined, { internal: true })).body;
  assert.equal(got.messages.length, 2);
  assert.equal(got.messages[1].completion_tokens, 5);
  const pub = (await h.api('GET', `/api/ai/conversations?crawlId=${crawlB.id}`)).body;
  assert.equal(pub.data.length, 1);
  assert.equal(pub.data[0].messageCount, 2);
  const exp = (await h.api('GET', `/internal/crawls/${crawlB.id}/export`, undefined, { internal: true })).body;
  assert.equal(exp.results.length, (await h.api('GET', `/api/crawls/${crawlB.id}`)).body.data.pagesCrawled);
  assert.ok(exp.seo_score && typeof exp.seo_score.overall === 'number');
  assert.ok(exp.results.every((r) => r.seo_score));
  assert.ok([200, 204].includes((await h.api('DELETE', `/api/ai/conversations/${cid}`)).status));
});

test('crawl with no pages fails cleanly; delete cascades', async () => {
  const r = await h.api('POST', `/api/projects/${project.id}/crawls`, {});
  await h.api('POST', `/internal/crawls/${r.body.data.id}/complete`, { inlinks: {}, reports: {} }, { internal: true });
  assert.equal((await h.api('GET', `/api/crawls/${r.body.data.id}`)).body.data.status, 'FAILED');
  assert.equal((await h.api('DELETE', `/api/crawls/${crawlA.id}`)).status, 204);
  const prisma = require('../src/db');
  assert.equal(await prisma.crawledPage.count({ where: { crawlId: crawlA.id } }), 0);
  assert.equal(await prisma.crawlInlink.count({ where: { crawlId: crawlA.id } }), 0);
});
