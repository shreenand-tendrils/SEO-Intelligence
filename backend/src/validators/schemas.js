'use strict';
const { z } = require('zod');

const httpUrl = z.string().trim().min(4).max(2048).refine((v) => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https?:\/\//i.test(v)) return false;
  try { const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); return ['http:', 'https:'].includes(u.protocol) && Boolean(u.hostname); } catch { return false; }
}, 'Must be a valid http(s) URL');

const projectCreate = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  seedUrl: httpUrl.optional(),
});
const projectUpdate = projectCreate.partial();

// Mirrors agent_tools.UI_DEFAULTS (crawler settings accepted by CrawlJob).
const crawlSettings = z.object({
  url: httpUrl.optional(),
  max_pages: z.coerce.number().int().min(1).max(100000).default(1500),
  max_workers: z.coerce.number().int().min(1).max(20).default(5),
  crawl_delay: z.coerce.number().min(0).max(10).default(0.4),
  max_depth: z.coerce.number().int().min(1).max(100).default(10),
  render_js: z.boolean().default(false),
  compare_no_js: z.boolean().default(false),
  ignore_robots: z.boolean().default(false),
  ignore_noindex: z.boolean().default(false),
  include_patterns: z.string().max(5000).default(''),
  exclude_patterns: z.string().max(5000).default(''),
  user_agent: z.string().max(400).default(''),
  solve_challenges: z.boolean().default(true),
  sitemap: z.boolean().default(true),
  near_dup: z.boolean().default(true),
  near_dup_threshold: z.coerce.number().min(50).max(100).default(90),
  near_dup_exclude: z.string().max(2000).default(''),
  bot_check: z.boolean().default(true),
  bot_sample: z.coerce.number().int().min(1).max(50).default(10),
  name: z.string().trim().max(160).optional(),
}).strict();

const compareBody = z.object({ otherCrawlId: z.string().min(1).max(64).optional() });

const aiChat = z.object({
  crawlId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().max(64).optional().nullable(),
  url: z.string().max(2048).optional(),
});
const aiAction = z.object({
  crawlId: z.string().min(1).max(64),
  url: z.string().max(2048).optional(),
  otherCrawlId: z.string().max(64).optional(),
  scope: z.string().max(400).optional(),
  conversationId: z.string().max(64).optional().nullable(),
});

module.exports = { httpUrl, projectCreate, projectUpdate, crawlSettings, compareBody, aiChat, aiAction };
