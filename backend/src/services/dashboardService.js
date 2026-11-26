'use strict';
const prisma = require('../db');
const { notFound } = require('../utils/http');
const { compareCrawls, previousCompleted } = require('./compareService');

const DONE = ['COMPLETED', 'STOPPED'];
const BUCKETS = [[0, 49, '0-49'], [50, 69, '50-69'], [70, 89, '70-89'], [90, 100, '90-100']];

async function scoreHistory(projectId, limit = 30) {
  const crawls = await prisma.crawlJob.findMany({ where: { projectId, status: { in: DONE }, seoScore: { isNot: null } },
    orderBy: { finishedAt: 'desc' }, take: limit, include: { seoScore: true } });
  return crawls.reverse().map((c) => ({ crawlId: c.id, name: c.name, finishedAt: c.finishedAt, pages: c.pagesCrawled,
    score: c.seoScore.overall, critical: c.seoScore.criticalCount, high: c.seoScore.highCount,
    components: Object.fromEntries((c.seoScore.components || []).map((x) => [x.key, x.score])) }));
}

async function crawlAggregates(crawlId) {
  const [scoreRows, statusRows, depthRows, idxRows, topIssues, sevRows, cats, critical, lowest, highest] = await Promise.all([
    prisma.crawledPage.findMany({ where: { crawlId, seoScore: { not: null } }, select: { seoScore: true } }),
    prisma.crawledPage.groupBy({ by: ['statusCode'], where: { crawlId }, _count: { _all: true } }),
    prisma.crawledPage.groupBy({ by: ['depth'], where: { crawlId }, _count: { _all: true } }),
    prisma.crawledPage.groupBy({ by: ['indexable'], where: { crawlId, statusCode: { gte: 200, lt: 300 } }, _count: { _all: true } }),
    prisma.pageIssue.groupBy({ by: ['groupLabel'], where: { crawlId }, _count: { _all: true }, orderBy: { _count: { groupLabel: 'desc' } }, take: 15 }),
    prisma.pageIssue.groupBy({ by: ['severity'], where: { crawlId }, _count: { _all: true } }),
    prisma.seoCategoryScore.groupBy({ by: ['category'], where: { crawlId, scope: 'page', score: { not: null } }, _avg: { score: true }, _count: { _all: true } }),
    prisma.pageIssue.groupBy({ by: ['groupLabel'], where: { crawlId, severity: 'CRITICAL' }, _count: { _all: true }, orderBy: { _count: { groupLabel: 'desc' } }, take: 10 }),
    prisma.crawledPage.findMany({ where: { crawlId, seoScore: { not: null } }, orderBy: [{ seoScore: 'asc' }, { position: 'asc' }], take: 10,
      select: { id: true, url: true, seoScore: true, statusCode: true, issueCount: true } }),
    prisma.crawledPage.findMany({ where: { crawlId, seoScore: { not: null } }, orderBy: [{ seoScore: 'desc' }, { position: 'asc' }], take: 10,
      select: { id: true, url: true, seoScore: true, statusCode: true, issueCount: true } }),
  ]);
  const dist = BUCKETS.map(([lo, hi, label]) => ({ bucket: label, pages: scoreRows.filter((r) => r.seoScore >= lo && r.seoScore <= hi).length }));
  const rc = {};
  for (const r of statusRows) {
    const k = r.statusCode === 0 ? 'error' : `${Math.floor(r.statusCode / 100)}xx`;
    rc[k] = (rc[k] || 0) + r._count._all;
  }
  const sevOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  return {
    scoreDistribution: dist,
    responseCodes: Object.entries(rc).sort().map(([code, pages]) => ({ code, pages })),
    statusCodes: statusRows.map((r) => ({ status: r.statusCode, pages: r._count._all })).sort((a, b) => a.status - b.status),
    depth: depthRows.map((r) => ({ depth: r.depth, pages: r._count._all })).sort((a, b) => a.depth - b.depth),
    indexability: [
      { label: 'Indexable', pages: (idxRows.find((r) => r.indexable) || { _count: { _all: 0 } })._count._all },
      { label: 'Non-indexable', pages: (idxRows.find((r) => !r.indexable) || { _count: { _all: 0 } })._count._all },
    ],
    severity: sevOrder.map((s) => ({ severity: s, count: (sevRows.find((r) => r.severity === s) || { _count: { _all: 0 } })._count._all })),
    topIssues: topIssues.map((r) => ({ issue: r.groupLabel, pages: r._count._all })),
    criticalIssues: critical.map((r) => ({ issue: r.groupLabel, pages: r._count._all })),
    categoryScores: cats.map((c) => ({ category: c.category, score: Math.round(c._avg.score), pages: c._count._all })),
    lowestPages: lowest, highestPages: highest,
  };
}

async function projectDashboard(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { websites: true } });
  if (!project) throw notFound('Project');
  const [latest, recent, running] = await Promise.all([
    prisma.crawlJob.findFirst({ where: { projectId, status: { in: DONE }, seoScore: { isNot: null } }, orderBy: { finishedAt: 'desc' }, include: { seoScore: true } }),
    prisma.crawlJob.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, name: true, status: true, createdAt: true, finishedAt: true, pagesCrawled: true, source: true, seoScore: { select: { overall: true } } } }),
    prisma.crawlJob.findFirst({ where: { projectId, status: { in: ['QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING'] } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const base = { project, recentCrawls: recent, runningCrawl: running };
  if (!latest) return { ...base, empty: true };
  const prev = await previousCompleted(latest);
  const [agg, history, comparison] = await Promise.all([
    crawlAggregates(latest.id), scoreHistory(projectId), prev ? compareCrawls(prev.id, latest.id) : null,
  ]);
  const s = latest.seoScore;
  const nonIdx = agg.indexability[1].pages;
  return {
    ...base, empty: false,
    crawl: { id: latest.id, name: latest.name, finishedAt: latest.finishedAt, seedUrl: latest.seedUrl, status: latest.status, stopReason: latest.stopReason },
    score: { overall: s.overall, grade: s.grade, version: s.algorithmVersion, pageVersion: s.pageAlgorithm, components: s.components, caps: s.caps,
      explanation: s.explanation && s.explanation.text, previous: comparison ? comparison.base.score : null,
      change: comparison ? comparison.score_delta : null },
    kpis: { pagesCrawled: latest.pagesCrawled, pagesAnalyzed: s.pagesAnalyzed, indexable: agg.indexability[0].pages, nonIndexable: nonIdx,
      errors: s.pagesWithErrors, excellent: s.pagesExcellent, needAttention: s.pagesNeedAttention,
      critical: s.criticalCount, high: s.highCount, medium: s.mediumCount, low: s.lowCount, stats: s.stats },
    ...agg,
    history,
    changes: comparison && { previousCrawl: comparison.base, newIssues: comparison.new_issues.slice(0, 10), resolvedIssues: comparison.resolved_issues.slice(0, 10),
      persistentIssues: comparison.persistent_issues.slice(0, 10), pagesAdded: comparison.pages_added_count, pagesRemoved: comparison.pages_removed_count },
  };
}

module.exports = { projectDashboard, crawlAggregates, scoreHistory };
