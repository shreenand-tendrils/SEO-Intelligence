'use strict';
/**
 * Persists a finished crawl (from the live crawler or the legacy importer):
 * scores every page (page-v1) and the site (site-v1), then writes pages,
 * issues, category scores, inlinks, reports, title history and the site
 * score in one transaction.
 */
const crypto = require('crypto');
const prisma = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { scorePage, buildSiteContext, VERSION: PAGE_VERSION } = require('./scoring/pageScore');
const { scoreSite, VERSION: SITE_VERSION } = require('./scoring/siteScore');
const { issueGroup, sevOf, isConvention } = require('./scoring/issueTaxonomy');

const CHUNK = 1000;
const str = (v, max = 4000) => (v === null || v === undefined ? null : String(v).slice(0, max));
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

async function createManyChunked(tx, model, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) await tx[model].createMany({ data: rows.slice(i, i + CHUNK) });
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** Stage raw crawler rows (chunks from the crawler) before `complete`. */
async function stageRows(crawlId, { reset, offset = 0, rows = [] }) {
  if (reset) await prisma.crawledPage.deleteMany({ where: { crawlId } });
  const seen = new Set();
  const data = [];
  rows.forEach((r, i) => {
    if (!r || !r.url || seen.has(r.url)) return;
    seen.add(r.url);
    data.push({ crawlId, position: int(offset) + i, url: String(r.url), statusCode: int(r.status_code), data: r });
  });
  for (let i = 0; i < data.length; i += 500) {
    await prisma.crawledPage.createMany({ data: data.slice(i, i + 500), skipDuplicates: true });
  }
  return data.length;
}

async function stagedRows(crawlId) {
  const pages = await prisma.crawledPage.findMany({ where: { crawlId }, orderBy: { position: 'asc' }, select: { data: true } });
  return pages.map((p) => p.data);
}

function inlinkRows(crawlId, inlinks) {
  const out = [];
  for (const [target, list] of Object.entries(inlinks || {})) {
    for (const e of Array.isArray(list) ? list : []) {
      const src = typeof e === 'string' ? e : e && e.source;
      if (!src) continue;
      out.push({ crawlId, targetUrl: String(target).slice(0, 2048), sourceUrl: String(src).slice(0, 2048),
        anchor: String((e && e.anchor) || '').slice(0, 500), placement: String((e && e.placement) || '').slice(0, 40) });
    }
  }
  return out;
}

/**
 * rows: legacy crawler rows. Returns { siteScore, pages }.
 * opts: { name, status, finishedAt, stopReason, messages, titleHistory (bool) }
 */
async function persistCrawl(crawlId, rows, inlinks, reports, opts = {}) {
  const uniq = [];
  const seen = new Set();
  for (const r of rows || []) if (r && r.url && !seen.has(r.url)) { seen.add(r.url); uniq.push(r); }
  const ctx = buildSiteContext(uniq, reports || {}, inlinks || {});
  const scored = uniq.map((row) => ({ row, score: scorePage(row, ctx) }));
  const site = scoreSite(scored, reports || {}, inlinks || {});
  const finishedAt = opts.finishedAt || new Date();

  const inlinkCount = new Map();
  for (const [t, list] of Object.entries(inlinks || {})) inlinkCount.set(t, (list || []).length);

  const pageData = []; const issueData = []; const catData = [];
  scored.forEach(({ row, score }, position) => {
    const id = crypto.randomUUID();
    const { body_text: bodyText, ...rest } = row;
    const issues = [...new Set((row.issues || []).map(String))];
    let critical = 0; let high = 0;
    for (const label of issues) {
      const meta = score.issue_meta[label] || {};
      const sev = meta.severity || 'INFO';
      if (sev === 'CRITICAL') critical += 1;
      if (sev === 'HIGH') high += 1;
      const g = issueGroup(label);
      issueData.push({ crawlId, pageId: id, label: label.slice(0, 2000), groupLabel: g.label.slice(0, 300), crawlerSeverity: sevOf(label),
        severity: sev, category: meta.category || 'other', checkKey: meta.check || null, convention: isConvention(g.slug) });
    }
    for (const c of score.categories) {
      catData.push({ crawlId, pageId: id, scope: 'page', category: c.key, score: c.score, weight: c.weight,
        earned: c.earned, possible: c.possible, passed: c.passed, failed: c.failed });
    }
    pageData.push({
      id, crawlId, position, url: String(row.url).slice(0, 4096), statusCode: int(row.status_code),
      contentType: str(row.content_type, 200), indexable: row.indexable !== false, depth: int(row.depth),
      title: str(row.title, 2000), titleLength: int(row.title_len), metaDescription: str(row.meta_description, 4000),
      metaLength: int(row.meta_len), h1: str(row.h1, 2000), canonical: str(row.canonical, 4096), wordCount: int(row.word_count),
      internalLinks: int(row.internal_links), externalLinks: int(row.external_links), imagesTotal: int(row.images_total),
      imagesNoAlt: int(row.images_no_alt), responseTime: Number(row.response_time) || 0, redirectUrl: str(row.redirect_url, 4096),
      inlinkCount: inlinkCount.get(row.original_url) || inlinkCount.get(row.url) || 0, fetchError: str(row.error, 2000),
      issueCount: issues.length, criticalCount: critical, highCount: high,
      seoScore: score.score, scoreVersion: score.version,
      scoreBreakdown: { type: score.type, grade: score.grade, caps: score.caps, explanation: score.explanation,
        categories: score.categories, checks: score.checks, top_issues: score.top_issues },
      data: rest, bodyText: bodyText ? String(bodyText).slice(0, config.bodyTextCap) : null,
    });
  });

  const siteCats = site.components.map((c) => ({ crawlId, pageId: null, scope: 'site', category: c.key, score: c.score, weight: c.weight,
    earned: c.score === null ? 0 : (c.score * c.weight) / 100, possible: c.score === null ? 0 : c.weight, passed: 0, failed: 0 }));
  const titleRows = opts.titleHistory === false ? [] : uniq.map((r) => ({
    crawlId, crawlName: opts.name || '', seed: uniq[0] ? String(uniq[0].url) : '', url: String(r.url).slice(0, 4096),
    title: String(r.title || '').slice(0, 2000), metaDescription: String(r.meta_description || '').slice(0, 4000), ts: finishedAt,
  }));
  const reportRows = Object.entries(reports || {}).filter(([, v]) => v !== undefined && v !== null).map(([key, data]) => ({ crawlId, key, data }));
  const inl = inlinkRows(crawlId, inlinks);
  const t0 = Date.now();

  await prisma.$transaction(async (tx) => {
    await tx.seoCategoryScore.deleteMany({ where: { crawlId } });
    await tx.pageIssue.deleteMany({ where: { crawlId } });
    await tx.crawledPage.deleteMany({ where: { crawlId } });
    await tx.crawlInlink.deleteMany({ where: { crawlId } });
    await tx.crawlReport.deleteMany({ where: { crawlId } });
    await tx.seoScore.deleteMany({ where: { crawlId } });
    await tx.crawlComparison.deleteMany({ where: { OR: [{ baseCrawlId: crawlId }, { targetCrawlId: crawlId }] } });
    if (opts.titleHistory !== false) await tx.crawlTitleHistory.deleteMany({ where: { crawlId } });
    await createManyChunked(tx, 'crawledPage', pageData);
    await createManyChunked(tx, 'pageIssue', issueData);
    await createManyChunked(tx, 'seoCategoryScore', [...catData, ...siteCats]);
    await createManyChunked(tx, 'crawlInlink', inl);
    for (const r of reportRows) await tx.crawlReport.create({ data: r });
    if (titleRows.length) {
      for (let i = 0; i < titleRows.length; i += CHUNK) await tx.crawlTitleHistory.createMany({ data: titleRows.slice(i, i + CHUNK), skipDuplicates: true });
    }
    await tx.seoScore.create({ data: {
      crawlId, algorithmVersion: SITE_VERSION, pageAlgorithm: PAGE_VERSION, overall: site.overall, grade: site.grade,
      components: site.components, severityCounts: site.severity_counts, caps: site.caps, stats: site.stats,
      explanation: { text: site.explanation, lowest_pages: site.lowest_pages, highest_pages: site.highest_pages },
      pagesAnalyzed: site.pages_analyzed, pagesWithErrors: site.pages_with_errors, pagesExcellent: site.pages_excellent,
      pagesNeedAttention: site.pages_need_attention, criticalCount: site.severity_counts.critical, highCount: site.severity_counts.high,
      mediumCount: site.severity_counts.medium, lowCount: site.severity_counts.low,
    } });
    const errors = scored.filter((p) => p.score.type === 'error').length;
    await tx.crawlJob.update({ where: { id: crawlId }, data: {
      status: opts.status || 'COMPLETED', pagesCrawled: uniq.length, fetchErrors: errors, finishedAt,
      ...(opts.name ? { name: opts.name } : {}), ...(opts.stopReason !== undefined ? { stopReason: opts.stopReason } : {}),
      ...(opts.messages ? { messages: opts.messages } : {}),
      ...(uniq[0] && opts.setSeed ? { seedUrl: String(uniq[0].original_url || uniq[0].url) } : {}),
    } });
  }, { timeout: 300000, maxWait: 20000 });

  logger.info('crawl persisted', { crawlId, pages: pageData.length, issues: issueData.length, inlinks: inl.length, ms: Date.now() - t0, score: site.overall });
  return { site, pages: pageData.length, issues: issueData.length, inlinks: inl.length };
}

async function ensureWebsite(projectId, seedUrl) {
  const host = hostOf(seedUrl);
  if (!host) return null;
  return prisma.website.upsert({ where: { projectId_host: { projectId, host } }, update: {}, create: { projectId, host, seedUrl } });
}

module.exports = { persistCrawl, stageRows, stagedRows, ensureWebsite, hostOf };
