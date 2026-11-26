'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scorePage, buildSiteContext, CATEGORIES } = require('../src/services/scoring/pageScore');
const { scoreSite, COMPONENTS } = require('../src/services/scoring/siteScore');

const good = {
  url: 'https://ex.com/', status_code: 200, content_type: 'text/html; charset=utf-8', response_time: 0.2, depth: 0, indexable: true,
  title: 'Example widgets – handmade widgets shipped worldwide', meta_description: 'Handmade widgets in every size and colour, built to last and shipped worldwide within two days. Browse the full catalogue today.',
  h1: 'Handmade widgets', h1_list: ['Handmade widgets'], h1_count: 1, h2_count: 3, h2_list: ['A', 'B', 'C'], canonical: 'https://ex.com/', canonical_kind: 'self',
  word_count: 900, internal_links: 25, external_links: 3, images_total: 4, images_no_alt: 0, images_empty_alt: 0, schema_types: ['Organization', 'WebSite'],
  security: { is_https: true, hsts: true, csp: true, x_content_type_options: true, x_frame_options: true, referrer_policy: true },
  og_tags: { 'og:title': 'x', 'og:description': 'y', 'og:image': 'https://ex.com/i.png', 'og:url': 'https://ex.com/' }, twitter_tags: { 'twitter:card': 'summary' },
  body_hash: 'abc', issues: [],
};
const scoreOne = (row, rows = [row]) => scorePage(row, buildSiteContext(rows, {}, {}));

test('page score: well-optimised page scores high and is explained', () => {
  const s = scoreOne(good);
  assert.ok(s.score >= 75 && s.score <= 100, `score ${s.score}`);
  assert.equal(s.categories.length, CATEGORIES.length);
  for (const c of s.categories) if (c.score !== null) assert.ok(c.score >= 0 && c.score <= 100);
  assert.ok(s.explanation.length > 10);
});

test('page score: issues reduce the score and produce fixes', () => {
  const bad = { ...good, url: 'https://ex.com/bad', title: '', meta_description: '', h1: '', h1_list: [], h1_count: 0, word_count: 40,
    issues: ['Missing title', 'Missing meta description', 'Missing H1', 'Thin content (40 words)'] };
  const s = scoreOne(bad, [good, bad]);
  assert.ok(s.score < scoreOne(good).score);
  assert.ok(s.top_issues.length > 0);
  assert.ok(s.top_issues.every((t) => t.lost > 0 && t.severity));
});

test('page score: not-applicable checks are excluded from the denominator', () => {
  const s = scoreOne({ ...good, images_total: 0 });
  for (const c of s.categories) {
    const applicable = s.checks.filter((x) => x.category === c.key && x.status !== 'na' && x.points);
    assert.equal(c.possible, applicable.reduce((a, x) => a + x.points, 0), c.key);
    if (!applicable.length) assert.equal(c.score, null);
  }
  assert.ok(s.checks.some((x) => x.status === 'na'));
  for (const x of s.checks.filter((y) => y.status === 'na')) assert.equal(x.earned, 0);
});

test('page score: missing data does not crash and stays in range', () => {
  const s = scoreOne({ url: 'https://ex.com/x', status_code: 200, content_type: 'text/html' });
  assert.ok(Number.isInteger(s.score) && s.score >= 0 && s.score <= 100);
  assert.ok(s.checks.some((x) => x.status === 'unknown' || x.status === 'fail'));
});

test('page score: caps for errors, noindex, soft 404; non-HTML not scored', () => {
  assert.ok(scoreOne({ url: 'https://ex.com/404', status_code: 404, content_type: 'text/html', issues: ['HTTP 404'] }).score <= 15);
  const ni = scoreOne({ ...good, url: 'https://ex.com/ni', indexable: false, issues: ['Noindex'] });
  assert.ok(ni.score <= 60); assert.ok(ni.caps.length >= 1);
  assert.ok(scoreOne({ ...good, url: 'https://ex.com/s404', issues: ['Soft 404 (200 status on a missing page)'] }).score <= 30);
  assert.equal(scoreOne({ url: 'https://ex.com/a.pdf', status_code: 200, content_type: 'application/pdf' }).score, null);
});

test('page score: duplicate and unknown issue strings handled once', () => {
  const s = scoreOne({ ...good, issues: ['Missing H1', 'Missing H1', 'Some brand-new crawler warning'] });
  const keys = Object.keys(s.issue_meta);
  assert.equal(keys.filter((k) => k === 'Missing H1').length, 1);
  assert.ok(s.issue_meta['Some brand-new crawler warning'], 'unmapped issue retained');
});

const pages = (rows) => { const ctx = buildSiteContext(rows, {}, {}); return rows.map((row) => ({ row, score: scorePage(row, ctx) })); };

test('site score: weights, range, explanation', () => {
  assert.equal(COMPONENTS.reduce((a, c) => a + c.weight, 0), 100);
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...good, url: `https://ex.com/${i}`, title: `Title ${i} for widgets page`, body_hash: `h${i}` }));
  const s = scoreSite(pages(rows), {}, {});
  assert.ok(s.overall >= 0 && s.overall <= 100);
  assert.equal(s.stats.pages_total, 5);
  assert.ok(s.components.every((c) => c.score === null || (c.score >= 0 && c.score <= 100)));
  assert.match(s.explanation, /Weighted average/);
});

test('site score: empty crawl and caps', () => {
  assert.equal(scoreSite([], {}, {}).overall, 0);
  const err = (i) => ({ url: `https://ex.com/e${i}`, status_code: 500, content_type: 'text/html', issues: ['HTTP 500'] });
  const startFail = scoreSite(pages([err(0), good]), {}, {});
  assert.ok(startFail.overall <= 20); assert.ok(startFail.caps.some((c) => /Start page/.test(c)));
  const mostlyErr = scoreSite(pages([good, err(1), err(2), err(3)]), {}, {});
  assert.ok(mostlyErr.overall <= 40);
  const blocked = scoreSite(pages([{ ...good, issues: ['Search engines blocked by robots.txt'] }]), {}, {});
  assert.ok(blocked.overall <= 30);
});

test('site score: real crawler output from the fixture site', () => {
  const { fixtureCrawl } = require('./helpers.js');
  const d = fixtureCrawl(0);
  const ctx = buildSiteContext(d.results, d.reports, d.inlinks);
  const s = scoreSite(d.results.map((row) => ({ row, score: scorePage(row, ctx) })), d.reports, d.inlinks);
  assert.equal(s.stats.pages_total, d.results.length);
  assert.ok(s.overall > 0 && s.overall < 100);
  assert.ok(s.lowest_pages.length > 0);
});
