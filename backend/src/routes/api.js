'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const prisma = require('../db');
const crawler = require('../services/crawlerClient');
const { asyncHandler: h } = require('../utils/http');
const projects = require('../controllers/projectController');
const crawls = require('../controllers/crawlController');
const pages = require('../controllers/pageController');
const ai = require('../controllers/aiController');

const r = express.Router();
const aiLimit = rateLimit({ windowMs: 60000, limit: config.aiRateLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many AI requests, try again in a minute.' } } });

r.get('/health', h(async (_req, res) => {
  const out = { status: 'ok', database: 'down', crawler: 'down', time: new Date().toISOString() };
  try { await prisma.$queryRaw`SELECT 1`; out.database = 'up'; } catch { out.status = 'degraded'; }
  try { await crawler.health(); out.crawler = 'up'; } catch { /* crawler optional for reads */ }
  res.status(out.database === 'up' ? 200 : 503).json({ data: out });
}));

r.get('/projects', h(projects.list));
r.post('/projects', h(projects.create));
r.get('/projects/:id', h(projects.get));
r.patch('/projects/:id', h(projects.update));
r.delete('/projects/:id', h(projects.remove));
r.post('/projects/:id/crawls', h(projects.startCrawl));
r.get('/projects/:id/crawls', h(projects.listCrawls));
r.get('/projects/:id/dashboard', h(projects.dashboard));
r.get('/projects/:id/score-history', h(projects.scoreHistory));

r.get('/crawls/:id', h(crawls.get));
r.delete('/crawls/:id', h(crawls.remove));
r.post('/crawls/:id/stop', h(crawls.stop));
r.get('/crawls/:id/pages', h(crawls.pages));
r.get('/crawls/:id/issues', h(crawls.issues));
r.get('/crawls/:id/reports', h(crawls.reports));
r.get('/crawls/:id/scores', h(crawls.scores));
r.get('/crawls/:id/inlinks', h(crawls.inlinks));
r.post('/crawls/:id/compare', h(crawls.compare));

r.get('/pages/:id', h(pages.get));
r.get('/pages/:id/issues', h(pages.issues));
r.get('/pages/:id/score', h(pages.score));

r.get('/ai/status', h(ai.status));
r.post('/ai/chat', aiLimit, h(ai.chat));
r.post('/ai/summary', aiLimit, h(ai.summary));
r.post('/ai/page', aiLimit, h(ai.page));
r.post('/ai/plan', aiLimit, h(ai.plan));
r.post('/ai/prioritize', aiLimit, h(ai.prioritize));
r.post('/ai/compare', aiLimit, h(ai.compare));
r.post('/ai/history', aiLimit, h(ai.history));
r.get('/ai/conversations', h(ai.conversations));
r.get('/ai/conversations/:id', h(ai.conversation));
r.delete('/ai/conversations/:id', h(ai.deleteConversation));

// Export via the existing crawler XLSX exporter, fed from PostgreSQL.
r.get('/crawls/:id/export.xlsx', h(async (req, res) => {
  const { exportCrawl } = require('../services/exportService');
  const data = await exportCrawl(req.params.id, { withComparison: false });
  if (!data) return res.status(404).json({ error: { code: 'not_found', message: 'Crawl not found' } });
  const up = await crawler.call('POST', '/export-crawl-xlsx', { results: data.results, inlinks: data.inlinks, reports: data.reports, name: data.name }, { timeoutMs: 120000, raw: true });
  if (!up.ok) return res.status(502).json({ error: { code: 'export_failed', message: 'Export failed' } });
  res.setHeader('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', up.headers.get('content-disposition') || `attachment; filename="crawl-${req.params.id}.xlsx"`);
  return res.send(Buffer.from(await up.arrayBuffer()));
}));

r.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } }));
module.exports = r;
