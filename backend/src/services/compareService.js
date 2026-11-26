'use strict';
const prisma = require('../db');
const { notFound, badRequest } = require('../utils/http');

const VERSION = 'compare-v1';

async function issueGroups(crawlId) {
  const rows = await prisma.pageIssue.groupBy({ by: ['groupLabel', 'severity'], where: { crawlId }, _count: { _all: true } });
  const m = new Map();
  for (const r of rows) {
    const cur = m.get(r.groupLabel) || { issue: r.groupLabel, pages: 0, severity: r.severity };
    cur.pages += r._count._all;
    if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(r.severity) < ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(cur.severity)) cur.severity = r.severity;
    m.set(r.groupLabel, cur);
  }
  return m;
}

async function pageMap(crawlId) {
  const pages = await prisma.crawledPage.findMany({ where: { crawlId }, select: { url: true, seoScore: true, statusCode: true, issueCount: true } });
  return new Map(pages.map((p) => [p.url.replace(/\/$/, ''), p]));
}

/** Diff `base` (older) against `target` (newer). Stored per algorithm version. */
async function compareCrawls(baseId, targetId, { useCache = true } = {}) {
  if (baseId === targetId) throw badRequest('Pick two different crawls.');
  const [base, target] = await Promise.all([
    prisma.crawlJob.findUnique({ where: { id: baseId }, include: { seoScore: true } }),
    prisma.crawlJob.findUnique({ where: { id: targetId }, include: { seoScore: true } }),
  ]);
  if (!base || !target) throw notFound('Crawl');
  if (useCache) {
    const hit = await prisma.crawlComparison.findUnique({ where: { baseCrawlId_targetCrawlId_algorithmVersion: { baseCrawlId: baseId, targetCrawlId: targetId, algorithmVersion: VERSION } } });
    if (hit) return hit.result;
  }
  const [gA, gB, pA, pB, catA, catB] = await Promise.all([
    issueGroups(baseId), issueGroups(targetId), pageMap(baseId), pageMap(targetId),
    prisma.seoCategoryScore.groupBy({ by: ['category'], where: { crawlId: baseId, scope: 'page' }, _avg: { score: true } }),
    prisma.seoCategoryScore.groupBy({ by: ['category'], where: { crawlId: targetId, scope: 'page' }, _avg: { score: true } }),
  ]);
  const newIssues = []; const resolved = []; const persistent = [];
  for (const [k, v] of gB) {
    if (!gA.has(k)) newIssues.push(v);
    else persistent.push({ ...v, pages_before: gA.get(k).pages, pages_after: v.pages, delta: v.pages - gA.get(k).pages });
  }
  for (const [k, v] of gA) if (!gB.has(k)) resolved.push(v);
  const bySev = (a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(a.severity) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(b.severity) || b.pages - a.pages;
  const added = []; const removed = []; const changes = [];
  for (const [u, p] of pB) {
    const o = pA.get(u);
    if (!o) added.push(p.url);
    else if (o.seoScore !== null && p.seoScore !== null && o.seoScore !== p.seoScore) changes.push({ url: p.url, before: o.seoScore, after: p.seoScore, delta: p.seoScore - o.seoScore });
  }
  for (const [u, p] of pA) if (!pB.has(u)) removed.push(p.url);
  const catMapA = Object.fromEntries(catA.map((c) => [c.category, c._avg.score]));
  const result = {
    version: VERSION,
    base: { id: base.id, name: base.name, finishedAt: base.finishedAt, score: base.seoScore && base.seoScore.overall, pages: base.pagesCrawled },
    target: { id: target.id, name: target.name, finishedAt: target.finishedAt, score: target.seoScore && target.seoScore.overall, pages: target.pagesCrawled },
    score_delta: base.seoScore && target.seoScore ? target.seoScore.overall - base.seoScore.overall : null,
    severity_before: base.seoScore && base.seoScore.severityCounts, severity_after: target.seoScore && target.seoScore.severityCounts,
    categories: catB.map((c) => ({ category: c.category, before: catMapA[c.category] === undefined || catMapA[c.category] === null ? null : Math.round(catMapA[c.category]),
      after: c._avg.score === null ? null : Math.round(c._avg.score) })),
    new_issues: newIssues.sort(bySev), resolved_issues: resolved.sort(bySev),
    persistent_issues: persistent.sort(bySev),
    pages_added: added.slice(0, 500), pages_removed: removed.slice(0, 500), pages_added_count: added.length, pages_removed_count: removed.length,
    improved_pages: changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 25),
    declined_pages: changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 25),
  };
  await prisma.crawlComparison.upsert({
    where: { baseCrawlId_targetCrawlId_algorithmVersion: { baseCrawlId: baseId, targetCrawlId: targetId, algorithmVersion: VERSION } },
    update: { result }, create: { baseCrawlId: baseId, targetCrawlId: targetId, algorithmVersion: VERSION, result },
  });
  return result;
}

async function previousCompleted(crawl) {
  return prisma.crawlJob.findFirst({
    where: { projectId: crawl.projectId, status: { in: ['COMPLETED', 'STOPPED'] }, finishedAt: { lt: crawl.finishedAt || new Date() }, id: { not: crawl.id },
      ...(crawl.websiteId ? { websiteId: crawl.websiteId } : {}) },
    orderBy: { finishedAt: 'desc' },
  });
}

module.exports = { compareCrawls, previousCompleted, VERSION };
