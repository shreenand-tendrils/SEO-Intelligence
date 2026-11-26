'use strict';
// Public AI endpoints: validate, then proxy to the existing Groq routes in the
// crawler service (the Groq key never leaves that container).
const prisma = require('../db');
const v = require('../validators/schemas');
const crawler = require('../services/crawlerClient');
const { ok, notFound, pageParams, pageMeta, ApiError } = require('../utils/http');

async function ensureCrawl(id) {
  const c = await prisma.crawlJob.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!c) throw notFound('Crawl');
  if (!['COMPLETED', 'STOPPED'].includes(c.status)) throw new ApiError(409, 'crawl_not_ready', 'AI needs a completed crawl.');
}

async function proxy(path, body, res) {
  const r = await crawler.call('POST', path, body, { timeoutMs: 180000, raw: true });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: { code: 'ai_bad_response', message: 'AI service returned an invalid response.' } }; }
  res.status(r.ok ? 200 : (r.status >= 500 ? 502 : r.status)).json(r.ok ? { data: json } : { error: typeof json.error === 'object' ? json.error : { code: 'ai_error', message: String(json.error || 'AI request failed') } });
}

exports.status = async (_req, res) => {
  const r = await crawler.call('GET', '/ai/status', undefined, { timeoutMs: 10000 });
  ok(res, r);
};

exports.chat = async (req, res) => {
  const b = v.aiChat.parse(req.body);
  await ensureCrawl(b.crawlId);
  await proxy('/ai/chat', { crawl_file: b.crawlId, message: b.message, conversation_id: b.conversationId || undefined, page_url: b.url || undefined }, res);
};

const action = (path) => async (req, res) => {
  const b = v.aiAction.parse(req.body);
  await ensureCrawl(b.crawlId);
  if (path === '/ai/compare') {
    if (!b.otherCrawlId) throw new ApiError(400, 'bad_request', 'otherCrawlId is required.');
    await ensureCrawl(b.otherCrawlId);
    return proxy(path, { a_file: b.otherCrawlId, b_file: b.crawlId }, res);
  }
  return proxy(path, { crawl_file: b.crawlId, url: b.url, focus: b.scope, conversation_id: b.conversationId || undefined }, res);
};
exports.summary = action('/ai/summary');
exports.page = action('/ai/page');
exports.plan = action('/ai/plan');
exports.prioritize = action('/ai/prioritize');
exports.compare = action('/ai/compare');
exports.history = action('/ai/history');

exports.conversations = async (req, res) => {
  const p = pageParams(req.query, { defaultSize: 50, maxSize: 200 });
  const where = { ...(req.query.crawlId ? { crawlRef: String(req.query.crawlId) } : {}), ...(req.query.kind ? { kind: String(req.query.kind) } : {}) };
  const [total, items] = await Promise.all([
    prisma.aiConversation.count({ where }),
    prisma.aiConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.take, include: { _count: { select: { messages: true } } } }),
  ]);
  ok(res, items.map((c) => ({ ...c, messageCount: c._count.messages, _count: undefined })), pageMeta(p, total));
};

exports.conversation = async (req, res) => {
  const c = await prisma.aiConversation.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { id: 'asc' } } } });
  if (!c) throw notFound('Conversation');
  ok(res, c);
};

exports.deleteConversation = async (req, res) => {
  await prisma.aiConversation.delete({ where: { id: req.params.id } });
  res.status(204).end();
};
