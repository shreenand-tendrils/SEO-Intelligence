'use strict';
const prisma = require('../db');
const v = require('../validators/schemas');
const { ok, notFound, pageParams, pageMeta } = require('../utils/http');
const ingest = require('../services/ingestService');
const crawls = require('../services/crawlService');
const dashboard = require('../services/dashboardService');

const latestScore = { where: { status: { in: ['COMPLETED', 'STOPPED'] }, seoScore: { isNot: null } }, orderBy: { finishedAt: 'desc' }, take: 1,
  select: { id: true, finishedAt: true, pagesCrawled: true, seoScore: { select: { overall: true, grade: true } } } };

exports.list = async (req, res) => {
  const p = pageParams(req.query, { defaultSize: 50, maxSize: 200 });
  const q = String(req.query.q || '').trim();
  const where = q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { websites: { some: { host: { contains: q, mode: 'insensitive' } } } }] } : {};
  const [total, items] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.take,
      include: { websites: true, crawls: latestScore, _count: { select: { crawls: true } } } }),
  ]);
  ok(res, items.map((x) => ({ ...x, latestCrawl: x.crawls[0] || null, crawls: undefined, crawlCount: x._count.crawls, _count: undefined })), pageMeta(p, total));
};

exports.create = async (req, res) => {
  const body = v.projectCreate.parse(req.body);
  const project = await prisma.project.create({ data: { name: body.name, description: body.description || null } });
  if (body.seedUrl) await ingest.ensureWebsite(project.id, new URL(/^https?:\/\//i.test(body.seedUrl) ? body.seedUrl : `https://${body.seedUrl}`).toString());
  ok(res, await prisma.project.findUnique({ where: { id: project.id }, include: { websites: true } }), undefined, 201);
};

exports.get = async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { websites: true, crawls: latestScore, _count: { select: { crawls: true } } } });
  if (!project) throw notFound('Project');
  ok(res, { ...project, latestCrawl: project.crawls[0] || null, crawls: undefined, crawlCount: project._count.crawls, _count: undefined });
};

exports.update = async (req, res) => {
  const body = v.projectUpdate.parse(req.body);
  const exists = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!exists) throw notFound('Project');
  await prisma.project.update({ where: { id: req.params.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}) } });
  if (body.seedUrl) await ingest.ensureWebsite(req.params.id, new URL(/^https?:\/\//i.test(body.seedUrl) ? body.seedUrl : `https://${body.seedUrl}`).toString());
  ok(res, await prisma.project.findUnique({ where: { id: req.params.id }, include: { websites: true } }));
};

exports.remove = async (req, res) => {
  const exists = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!exists) throw notFound('Project');
  await prisma.project.delete({ where: { id: req.params.id } });
  res.status(204).end();
};

exports.startCrawl = async (req, res) => {
  const settings = v.crawlSettings.parse(req.body || {});
  ok(res, await crawls.startCrawl(req.params.id, settings), undefined, 201);
};

exports.listCrawls = async (req, res) => {
  const p = pageParams(req.query, { defaultSize: 25, maxSize: 200 });
  const where = { projectId: req.params.id };
  const [total, items] = await Promise.all([
    prisma.crawlJob.count({ where }),
    prisma.crawlJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take,
      select: { id: true, name: true, seedUrl: true, status: true, source: true, pagesCrawled: true, fetchErrors: true, createdAt: true, startedAt: true,
        finishedAt: true, stopReason: true, error: true, seoScore: { select: { overall: true, grade: true, criticalCount: true, highCount: true } } } }),
  ]);
  ok(res, items, pageMeta(p, total));
};

exports.dashboard = async (req, res) => ok(res, await dashboard.projectDashboard(req.params.id));
exports.scoreHistory = async (req, res) => ok(res, await dashboard.scoreHistory(req.params.id, Math.min(200, parseInt(req.query.limit, 10) || 50)));
