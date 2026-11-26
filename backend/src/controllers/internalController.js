'use strict';
const crypto = require('crypto');
const prisma = require('../db');
const crawls = require('../services/crawlService');
const ingest = require('../services/ingestService');
const { exportCrawl, listForAi } = require('../services/exportService');
const { notFound, badRequest } = require('../utils/http');

exports.progress = async (req, res) => res.json(await crawls.recordProgress(req.params.id, req.body || {}));

exports.pages = async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.rows)) throw badRequest('rows must be an array');
  const crawl = await prisma.crawlJob.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!crawl) throw notFound('Crawl');
  res.json({ ok: true, stored: await ingest.stageRows(req.params.id, b) });
};

exports.complete = async (req, res) => res.json({ ok: true, ...(await crawls.completeCrawl(req.params.id, req.body || {})) });
exports.fail = async (req, res) => { await crawls.failCrawl(req.params.id, req.body || {}); res.json({ ok: true }); };

exports.exportCrawl = async (req, res) => {
  const out = await exportCrawl(req.params.id);
  if (!out) throw notFound('Crawl');
  res.json(out);
};
exports.listCrawls = async (_req, res) => res.json({ crawls: await listForAi() });

const toSec = (d) => Math.floor(new Date(d).getTime() / 1000);
const convOut = (c) => c && { id: c.id, kind: c.kind, crawl_file: c.crawlRef, ref: c.ref, title: c.title, created_at: toSec(c.createdAt), updated_at: toSec(c.updatedAt) };

exports.createConversation = async (req, res) => {
  const b = req.body || {};
  const crawlRef = String(b.crawl_file || '');
  const crawl = crawlRef ? await prisma.crawlJob.findUnique({ where: { id: crawlRef }, select: { id: true } }) : null;
  const c = await prisma.aiConversation.create({ data: { id: crypto.randomBytes(8).toString('hex'), kind: String(b.kind || 'chat').slice(0, 40),
    crawlRef, crawlId: crawl ? crawl.id : null, ref: String(b.ref || '').slice(0, 2048), title: String(b.title || '').slice(0, 120) } });
  res.status(201).json({ id: c.id });
};

exports.getConversation = async (req, res) => {
  const c = await prisma.aiConversation.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { id: 'asc' } } } });
  if (!c) throw notFound('Conversation');
  res.json({ conversation: convOut(c), messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, structured: m.structured, model: m.model,
    prompt_tokens: m.promptTokens, completion_tokens: m.completionTokens, created_at: toSec(m.createdAt) })) });
};

exports.listConversations = async (req, res) => {
  const where = { ...(req.query.crawl_file ? { crawlRef: String(req.query.crawl_file) } : {}), ...(req.query.kind ? { kind: String(req.query.kind) } : {}) };
  const rows = await prisma.aiConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take: Math.min(200, parseInt(req.query.limit, 10) || 50),
    include: { _count: { select: { messages: true } } } });
  res.json({ conversations: rows.map((c) => ({ ...convOut(c), message_count: c._count.messages })) });
};

exports.deleteConversation = async (req, res) => {
  const r = await prisma.aiConversation.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: r.count > 0 });
};

exports.addMessage = async (req, res) => {
  const b = req.body || {};
  const c = await prisma.aiConversation.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!c) throw notFound('Conversation');
  const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Math.trunc(Number(v)) : null);
  await prisma.$transaction([
    prisma.aiMessage.create({ data: { conversationId: c.id, role: String(b.role || 'user').slice(0, 20), content: String(b.content || ''),
      structured: b.structured === undefined || b.structured === null ? undefined : b.structured, model: b.model ? String(b.model).slice(0, 200) : null,
      promptTokens: num(b.prompt_tokens), completionTokens: num(b.completion_tokens) } }),
    prisma.aiConversation.update({ where: { id: c.id }, data: { updatedAt: new Date() } }),
  ]);
  res.status(201).json({ ok: true });
};
