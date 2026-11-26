'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(async () => { await h.start(); await h.resetDb(); });
test.after(async () => { await h.stop(); });

test('1,500-page crawl persists, scores and paginates', { timeout: 300000 }, async () => {
  const base = h.fixtureCrawl(0).results.filter((r) => r.status_code === 200);
  const rows = Array.from({ length: 1500 }, (_, i) => {
    const t = base[i % base.length];
    return { ...t, url: `https://big.example/p/${i}`, title: `${t.title || 'Page'} ${i}`, body_hash: `hash-${i}`, depth: 1 + (i % 6) };
  });
  rows[0] = { ...rows[0], url: 'https://big.example/', depth: 0 };
  const inlinks = Object.fromEntries(rows.slice(1, 400).map((r) => [r.url, [{ source: 'https://big.example/', anchor: 'x' }]]));
  const p = await h.api('POST', '/api/projects', { name: 'Big', seedUrl: 'https://big.example/' });
  const c = await h.api('POST', `/api/projects/${p.body.data.id}/crawls`, { max_pages: 2000 });
  const t0 = Date.now();
  const done = await h.simulateCrawler(c.body.data.id, { rows, inlinks, reports: {} });
  const ms = Date.now() - t0;
  assert.equal(done.pages, 1500);
  const prisma = require('../src/db');
  assert.equal(await prisma.crawledPage.count({ where: { crawlId: c.body.data.id } }), 1500);
  assert.equal(await prisma.seoCategoryScore.count({ where: { page: { crawlId: c.body.data.id } } }) > 0, true);
  const last = await h.api('GET', `/api/crawls/${c.body.data.id}/pages?pageSize=100&page=15`);
  assert.equal(last.body.data.length, 100);
  assert.equal(last.body.meta.total, 1500);
  const dash = (await h.api('GET', `/api/projects/${p.body.data.id}/dashboard`)).body.data;
  assert.equal(dash.kpis.pagesCrawled, 1500);
  console.log(`# 1500 pages staged+scored+persisted in ${ms} ms`);
});
