'use strict';
const prisma = require('../db');
const crawler = require('./crawlerClient');
const ingest = require('./ingestService');
const { notFound, badRequest, ApiError } = require('../utils/http');
const logger = require('../utils/logger');

const ACTIVE = ['QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING'];
const STATE_MAP = { starting: 'RUNNING', crawling: 'RUNNING', 'post-processing': 'POST_PROCESSING', saving: 'SAVING' };

function normaliseSeed(url) {
  const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  return u.toString();
}

async function startCrawl(projectId, settings) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { websites: { orderBy: { createdAt: 'asc' }, take: 1 } } });
  if (!project) throw notFound('Project');
  const seed = settings.url ? normaliseSeed(settings.url) : project.websites[0] && project.websites[0].seedUrl;
  if (!seed) throw badRequest('A start URL is required (set one on the project or pass url).');
  const running = await prisma.crawlJob.count({ where: { projectId, status: { in: ACTIVE } } });
  if (running) throw new ApiError(409, 'crawl_in_progress', 'A crawl is already running for this project.');
  const website = await ingest.ensureWebsite(projectId, seed);
  const { name, url: _u, ...opts } = settings;
  const crawlerSettings = { ...opts, url: seed };
  const crawl = await prisma.crawlJob.create({ data: {
    projectId, websiteId: website && website.id, name: name || `${ingest.hostOf(seed)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    seedUrl: seed, status: 'QUEUED', source: 'APP',
    configuration: { create: {
      maxPages: opts.max_pages, maxDepth: opts.max_depth, maxWorkers: opts.max_workers, crawlDelay: opts.crawl_delay,
      renderJs: opts.render_js, compareNoJs: opts.compare_no_js, ignoreRobots: opts.ignore_robots, ignoreNoindex: opts.ignore_noindex,
      solveChallenges: opts.solve_challenges, userAgent: opts.user_agent, includePatterns: opts.include_patterns,
      excludePatterns: opts.exclude_patterns, sitemap: opts.sitemap, nearDup: opts.near_dup, nearDupThreshold: opts.near_dup_threshold,
      nearDupExclude: opts.near_dup_exclude, botCheck: opts.bot_check, botSample: opts.bot_sample, settings: crawlerSettings,
    } },
  } });
  try {
    await crawler.startJob(crawl.id, crawlerSettings);
    return prisma.crawlJob.update({ where: { id: crawl.id }, data: { status: 'RUNNING', startedAt: new Date() } });
  } catch (e) {
    await prisma.crawlJob.update({ where: { id: crawl.id }, data: { status: 'FAILED', error: e.message, finishedAt: new Date() } });
    throw e;
  }
}

async function stopCrawl(id) {
  const crawl = await prisma.crawlJob.findUnique({ where: { id } });
  if (!crawl) throw notFound('Crawl');
  if (!ACTIVE.includes(crawl.status)) throw new ApiError(409, 'not_running', 'Crawl is not running.');
  try { await crawler.stopJob(id); } catch (e) {
    if (e.status === 404) {
      return prisma.crawlJob.update({ where: { id }, data: { status: 'FAILED', error: 'Crawler lost the job (service restarted).', finishedAt: new Date() } });
    }
    throw e;
  }
  return crawl;
}

async function recordProgress(id, body) {
  const crawl = await prisma.crawlJob.findUnique({ where: { id }, select: { status: true } });
  if (!crawl) throw notFound('Crawl');
  if (!ACTIVE.includes(crawl.status)) return crawl;
  const status = STATE_MAP[body.state] || crawl.status;
  return prisma.crawlJob.update({ where: { id }, data: {
    status, pagesCrawled: Math.max(0, parseInt(body.pages_crawled, 10) || 0), queued: Math.max(0, parseInt(body.queued, 10) || 0),
    fetchErrors: Math.max(0, parseInt(body.errors, 10) || 0),
    progress: { state: body.state, elapsed_seconds: body.elapsed_seconds, updated_at: new Date().toISOString() },
    messages: Array.isArray(body.messages) ? body.messages.slice(-20) : undefined,
  }, select: { status: true } });
}

async function completeCrawl(id, body) {
  const crawl = await prisma.crawlJob.findUnique({ where: { id } });
  if (!crawl) throw notFound('Crawl');
  const rows = await ingest.stagedRows(id);
  if (!rows.length) {
    await prisma.crawlJob.update({ where: { id }, data: { status: 'FAILED', error: 'Crawl finished with no pages.', finishedAt: new Date() } });
    return { name: crawl.name, pages: 0 };
  }
  const res = await ingest.persistCrawl(id, rows, body.inlinks || {}, body.reports || {}, {
    name: crawl.name, status: body.stopped ? 'STOPPED' : 'COMPLETED', stopReason: body.stop_reason || null, messages: body.messages,
  });
  logger.info('crawl completed', { crawlId: id, pages: res.pages, score: res.site.overall });
  return { name: crawl.name, pages: res.pages, score: res.site.overall };
}

async function failCrawl(id, body) {
  return prisma.crawlJob.update({ where: { id }, data: { status: 'FAILED', error: String(body.error || 'Crawl failed').slice(0, 2000),
    messages: Array.isArray(body.messages) ? body.messages.slice(-20) : undefined, finishedAt: new Date() } });
}

module.exports = { startCrawl, stopCrawl, recordProgress, completeCrawl, failCrawl, ACTIVE };
