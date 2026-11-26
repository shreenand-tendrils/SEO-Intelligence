'use strict';
const prisma = require('../db');
const v = require('../validators/schemas');
const { ok, notFound, badRequest, pageParams, pageMeta } = require('../utils/http');
const crawls = require('../services/crawlService');
const { compareCrawls, previousCompleted } = require('../services/compareService');
const { crawlAggregates } = require('../services/dashboardService');

const SORTS = { url: 'url', status: 'statusCode', score: 'seoScore', issues: 'issueCount', words: 'wordCount', depth: 'depth', response: 'responseTime', position: 'position', title: 'title', inlinks: 'inlinkCount' };
const PAGE_LIST = { id: true, url: true, statusCode: true, indexable: true, depth: true, title: true, titleLength: true, metaLength: true, h1: true,
  wordCount: true, issueCount: true, criticalCount: true, highCount: true, seoScore: true, responseTime: true, inlinkCount: true, contentType: true, position: true };

async function getCrawl(id) {
  const crawl = await prisma.crawlJob.findUnique({ where: { id }, include: { seoScore: true, configuration: true, website: true } });
  if (!crawl) throw notFound('Crawl');
  return crawl;
}

exports.get = async (req, res) => ok(res, await getCrawl(req.params.id));

exports.stop = async (req, res) => { await crawls.stopCrawl(req.params.id); ok(res, { stopping: true }, undefined, 202); };

exports.remove = async (req, res) => {
  const crawl = await getCrawl(req.params.id);
  if (crawls.ACTIVE.includes(crawl.status)) throw badRequest('Stop the crawl before deleting it.');
  await prisma.crawlJob.delete({ where: { id: crawl.id } });
  res.status(204).end();
};

exports.pages = async (req, res) => {
  await getCrawl(req.params.id);
  const p = pageParams(req.query, { defaultSize: 50, maxSize: 500 });
  const q = req.query;
  const where = { crawlId: req.params.id };
  if (q.search) where.OR = [{ url: { contains: String(q.search), mode: 'insensitive' } }, { title: { contains: String(q.search), mode: 'insensitive' } }];
  if (q.status) {
    const s = String(q.status);
    if (/^[1-5]xx$/.test(s)) where.statusCode = { gte: Number(s[0]) * 100, lt: Number(s[0]) * 100 + 100 };
    else if (s === 'error') where.statusCode = 0;
    else if (/^\d{3}$/.test(s)) where.statusCode = Number(s);
  }
  if (q.indexable === 'true' || q.indexable === 'false') where.indexable = q.indexable === 'true';
  if (q.minScore || q.maxScore) where.seoScore = { ...(q.minScore ? { gte: Number(q.minScore) } : {}), ...(q.maxScore ? { lte: Number(q.maxScore) } : {}) };
  if (q.issue) where.issues = { some: { groupLabel: String(q.issue) } };
  if (q.severity) where.issues = { some: { ...(where.issues ? where.issues.some : {}), severity: String(q.severity).toUpperCase() } };
  const sortKey = SORTS[q.sort] || 'position';
  const dir = q.order === 'desc' ? 'desc' : 'asc';
  const orderBy = sortKey === 'seoScore' ? [{ seoScore: { sort: dir, nulls: 'last' } }, { position: 'asc' }] : [{ [sortKey]: dir }, { position: 'asc' }];
  const [total, items] = await Promise.all([
    prisma.crawledPage.count({ where }),
    prisma.crawledPage.findMany({ where, orderBy, skip: p.skip, take: p.take, select: PAGE_LIST }),
  ]);
  ok(res, items, pageMeta(p, total));
};

exports.issues = async (req, res) => {
  await getCrawl(req.params.id);
  const rows = await prisma.pageIssue.groupBy({ by: ['groupLabel', 'severity', 'category'], where: { crawlId: req.params.id }, _count: { _all: true } });
  const m = new Map();
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  for (const r of rows) {
    const cur = m.get(r.groupLabel) || { issue: r.groupLabel, severity: r.severity, category: r.category, pages: 0 };
    cur.pages += r._count._all;
    if (order.indexOf(r.severity) < order.indexOf(cur.severity)) cur.severity = r.severity;
    m.set(r.groupLabel, cur);
  }
  ok(res, [...m.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.pages - a.pages));
};

exports.reports = async (req, res) => {
  await getCrawl(req.params.id);
  const where = { crawlId: req.params.id, ...(req.query.key ? { key: String(req.query.key) } : {}) };
  const reps = await prisma.crawlReport.findMany({ where });
  ok(res, Object.fromEntries(reps.map((r) => [r.key, r.data])));
};

exports.scores = async (req, res) => {
  const crawl = await getCrawl(req.params.id);
  if (!crawl.seoScore) throw notFound('Score');
  ok(res, { site: crawl.seoScore, aggregates: await crawlAggregates(crawl.id) });
};

exports.compare = async (req, res) => {
  const body = v.compareBody.parse(req.body || {});
  const crawl = await getCrawl(req.params.id);
  let otherId = body.otherCrawlId;
  if (!otherId) {
    const prev = await previousCompleted(crawl);
    if (!prev) throw badRequest('No earlier completed crawl to compare with.');
    otherId = prev.id;
  }
  const other = await getCrawl(otherId);
  const [base, target] = new Date(other.finishedAt || other.createdAt) <= new Date(crawl.finishedAt || crawl.createdAt) ? [other, crawl] : [crawl, other];
  ok(res, await compareCrawls(base.id, target.id));
};

exports.inlinks = async (req, res) => {
  await getCrawl(req.params.id);
  const p = pageParams(req.query, { defaultSize: 100, maxSize: 1000 });
  const where = { crawlId: req.params.id, ...(req.query.target ? { targetUrl: String(req.query.target) } : {}), ...(req.query.source ? { sourceUrl: String(req.query.source) } : {}) };
  const [total, items] = await Promise.all([prisma.crawlInlink.count({ where }), prisma.crawlInlink.findMany({ where, skip: p.skip, take: p.take, orderBy: { id: 'asc' } })]);
  ok(res, items, pageMeta(p, total));
};
