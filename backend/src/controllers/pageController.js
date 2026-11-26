'use strict';
const prisma = require('../db');
const { ok, notFound } = require('../utils/http');

async function getPage(id) {
  const page = await prisma.crawledPage.findUnique({ where: { id }, include: { crawl: { select: { id: true, name: true, projectId: true, seedUrl: true, finishedAt: true } } } });
  if (!page) throw notFound('Page');
  return page;
}

exports.get = async (req, res) => {
  const page = await getPage(req.params.id);
  const [issues, inlinks, history] = await Promise.all([
    prisma.pageIssue.findMany({ where: { pageId: page.id }, orderBy: [{ severity: 'asc' }, { label: 'asc' }] }),
    prisma.crawlInlink.findMany({ where: { crawlId: page.crawlId, targetUrl: { in: [page.url, page.data && page.data.original_url].filter(Boolean) } }, take: 200 }),
    prisma.crawledPage.findMany({ where: { url: page.url, crawl: { projectId: page.crawl.projectId, status: { in: ['COMPLETED', 'STOPPED'] } } },
      select: { id: true, seoScore: true, crawl: { select: { id: true, name: true, finishedAt: true } } }, orderBy: { crawl: { finishedAt: 'asc' } }, take: 30 }),
  ]);
  const { bodyText, ...rest } = page;
  ok(res, { ...rest, bodyTextLength: bodyText ? bodyText.length : 0, issues, inlinks, scoreHistory: history.map((h) => ({ pageId: h.id, score: h.seoScore, crawl: h.crawl })) });
};

exports.issues = async (req, res) => {
  const page = await getPage(req.params.id);
  ok(res, await prisma.pageIssue.findMany({ where: { pageId: page.id }, orderBy: [{ severity: 'asc' }, { label: 'asc' }] }));
};

exports.score = async (req, res) => {
  const page = await getPage(req.params.id);
  ok(res, { score: page.seoScore, version: page.scoreVersion, breakdown: page.scoreBreakdown });
};
