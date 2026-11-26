'use strict';
// Rebuilds the legacy saved-crawl shape from PostgreSQL, plus scores, so the
// existing Python AI context builders work unchanged on Postgres data.
const prisma = require('../db');
const { previousCompleted, compareCrawls } = require('./compareService');

async function exportCrawl(id, { withComparison = true } = {}) {
  const crawl = await prisma.crawlJob.findUnique({ where: { id }, include: { seoScore: true } });
  if (!crawl) return null;
  const [pages, inl, reports] = await Promise.all([
    prisma.crawledPage.findMany({ where: { crawlId: id }, orderBy: { position: 'asc' } }),
    prisma.crawlInlink.findMany({ where: { crawlId: id }, select: { targetUrl: true, sourceUrl: true, anchor: true, placement: true } }),
    prisma.crawlReport.findMany({ where: { crawlId: id } }),
  ]);
  const inlinks = {};
  for (const e of inl) (inlinks[e.targetUrl] = inlinks[e.targetUrl] || []).push({ source: e.sourceUrl, anchor: e.anchor, placement: e.placement });
  const results = pages.map((p) => {
    const row = { ...p.data };
    if (p.bodyText) row.body_text = p.bodyText;
    const b = p.scoreBreakdown || {};
    if (p.seoScore !== null) {
      row.seo_score = { score: p.seoScore, version: p.scoreVersion,
        categories: (b.categories || []).map((c) => ({ key: c.key, label: c.label, score: c.score })),
        top_issues: (b.top_issues || []).slice(0, 8).map((t) => ({ label: t.label, severity: t.severity, detail: t.detail, fix: t.fix })) };
    }
    return row;
  });
  const out = {
    id: crawl.id, name: crawl.name, saved_at: Math.floor(new Date(crawl.finishedAt || crawl.createdAt).getTime() / 1000),
    pages: results.length, seed: crawl.seedUrl, saved_by: crawl.savedBy || 'platform', results, inlinks,
    reports: Object.fromEntries(reports.map((r) => [r.key, r.data])),
  };
  let prev = null;
  if (withComparison && crawl.finishedAt) prev = await previousCompleted(crawl);
  if (crawl.seoScore) {
    const s = crawl.seoScore;
    out.seo_score = { overall: s.overall, version: s.algorithmVersion, grade: s.grade, components: s.components, severity_counts: s.severityCounts,
      caps: s.caps, lowest_pages: (s.explanation && s.explanation.lowest_pages) || [], previous: null };
  }
  if (prev) {
    const c = await compareCrawls(prev.id, crawl.id);
    if (out.seo_score) out.seo_score.previous = c.base.score;
    out.comparison_with_previous = { previous_name: prev.name, score_before: c.base.score, score_after: c.target.score,
      pages_before: c.base.pages, pages_after: c.target.pages,
      new_issues: c.new_issues.slice(0, 15), resolved_issues: c.resolved_issues.slice(0, 15), persistent_issues: c.persistent_issues.slice(0, 15) };
  }
  return out;
}

async function listForAi() {
  const crawls = await prisma.crawlJob.findMany({ where: { status: { in: ['COMPLETED', 'STOPPED'] } }, orderBy: { finishedAt: 'desc' }, take: 500,
    select: { id: true, name: true, finishedAt: true, createdAt: true, seedUrl: true, pagesCrawled: true } });
  return crawls.map((c) => ({ file: c.id, name: c.name, saved_at: Math.floor(new Date(c.finishedAt || c.createdAt).getTime() / 1000), seed: c.seedUrl, pages: c.pagesCrawled }));
}

module.exports = { exportCrawl, listForAi };
