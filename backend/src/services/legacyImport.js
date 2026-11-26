'use strict';
/**
 * Idempotent import of the old file-based persistence into PostgreSQL:
 *   <dir>/*.json                 saved crawls (results, inlinks, reports)
 *   <dir>/ai-conversations.db    SQLite AI conversations + messages
 *   <dir>/crawl-titles.jsonl     title/meta history
 * Source files are opened read-only and never modified or deleted.
 * Re-running skips crawls already imported (CrawlJob.legacyFile), conversations
 * by id, messages by (conversation, legacy id) and titles by (crawl, url, ts).
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../db');
const ingest = require('./ingestService');

const REPORT_KEYS = ['url_traps', 'response_codes', 'duplicate_titles', 'duplicate_metas', 'duplicate_h1s', 'duplicate_bodies',
  'redirect_chains', 'orphans', 'sitemap_count', 'depth_distribution', 'sitemap', 'near_dup', 'bot_check'];

function defaultDir() {
  return process.env.LEGACY_DATA_DIR || path.join(require('os').homedir(), '.site-crawler-crawls');
}

async function projectForHost(host, seed) {
  const site = await prisma.website.findFirst({ where: { host }, orderBy: { createdAt: 'asc' } });
  if (site) return site;
  const project = await prisma.project.create({ data: { name: host || 'Imported crawls', description: 'Imported from legacy saved crawls' } });
  return ingest.ensureWebsite(project.id, seed);
}

async function importCrawls(dir, log, errors, stats, { force = false } = {}) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const byFile = {};
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { errors.push({ source: f, error: `Invalid JSON: ${e.message}` }); continue; }
    if (!data || !Array.isArray(data.results)) { log.push(`skip ${f}: not a saved crawl`); continue; }
    stats.crawl_files += 1;
    const rows = data.results.filter((r) => r && r.url);
    const uniqueUrls = new Set(rows.map((r) => r.url)).size;
    const inlinkEdges = Object.values(data.inlinks || {}).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
    stats.source_pages += uniqueUrls;
    stats.source_inlinks += inlinkEdges;
    stats.source_reports += Object.keys(data.reports || {}).length;
    const existing = await prisma.crawlJob.findUnique({ where: { legacyFile: f } });
    if (existing && existing.status === 'COMPLETED' && !force) {
      byFile[f] = existing.id; stats.crawls_skipped += 1; log.push(`skip ${f}: already imported as ${existing.id}`); continue;
    }
    try {
      const seed = String(data.seed || (rows[0] && rows[0].url) || '');
      const host = ingest.hostOf(seed);
      const website = await projectForHost(host, seed);
      const savedAt = new Date((Number(data.saved_at) || Math.floor(fs.statSync(path.join(dir, f)).mtimeMs / 1000)) * 1000);
      const crawl = existing || await prisma.crawlJob.create({ data: {
        projectId: website.projectId, websiteId: website.id, name: String(data.name || f).slice(0, 300), seedUrl: seed, status: 'SAVING',
        source: 'IMPORT', legacyFile: f, savedBy: data.saved_by ? String(data.saved_by).slice(0, 100) : null, createdAt: savedAt, startedAt: savedAt,
      } });
      await ingest.persistCrawl(crawl.id, rows, data.inlinks || {}, data.reports || {}, { name: crawl.name, finishedAt: savedAt, titleHistory: false });
      byFile[f] = crawl.id; stats.crawls_imported += 1;
      log.push(`imported ${f}: ${uniqueUrls} pages, ${inlinkEdges} inlinks, ${Object.keys(data.reports || {}).length} reports -> ${crawl.id}`);
    } catch (e) {
      errors.push({ source: f, error: e.message });
    }
  }
  return byFile;
}

async function importConversations(dir, byFile, log, errors, stats) {
  const dbPath = path.join(dir, 'ai-conversations.db');
  if (!fs.existsSync(dbPath)) { log.push('no ai-conversations.db'); return; }
  // Read a private copy: opening a WAL database in place, even read-only,
  // creates -shm/-wal files next to the source.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'seo-import-'));
  const copy = path.join(tmp, 'ai-conversations.db');
  let db;
  try {
    fs.copyFileSync(dbPath, copy);
    for (const ext of ['-wal']) if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, copy + ext);
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(copy);
  } catch (e) { errors.push({ source: 'ai-conversations.db', error: e.message }); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  try {
    const convs = db.prepare('SELECT * FROM conversations ORDER BY created_at').all();
    stats.source_conversations = convs.length;
    for (const c of convs) {
      let crawlId = byFile[c.crawl_file] || null;
      if (!crawlId && c.crawl_file) {
        const hit = await prisma.crawlJob.findUnique({ where: { legacyFile: c.crawl_file }, select: { id: true } });
        crawlId = hit ? hit.id : null;
      }
      const exists = await prisma.aiConversation.findUnique({ where: { id: c.id }, select: { id: true } });
      if (!exists) {
        await prisma.aiConversation.create({ data: { id: c.id, kind: c.kind, crawlId, crawlRef: crawlId || c.crawl_file, ref: c.ref || '',
          title: c.title || '', createdAt: new Date(Number(c.created_at) * 1000), updatedAt: new Date(Number(c.updated_at) * 1000) } });
        stats.conversations_imported += 1;
      } else stats.conversations_skipped += 1;
      if (!crawlId && c.crawl_file) log.push(`conversation ${c.id}: crawl ${c.crawl_file} not found, kept with its original reference`);
      const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(c.id);
      stats.source_messages += msgs.length;
      const data = msgs.map((m) => {
        let structured;
        if (m.structured) { try { structured = JSON.parse(m.structured); } catch { structured = { raw: String(m.structured) }; } }
        return { conversationId: c.id, legacyId: Number(m.id), role: m.role, content: m.content, structured, model: m.model || null,
          promptTokens: m.prompt_tokens === null ? null : Number(m.prompt_tokens), completionTokens: m.completion_tokens === null ? null : Number(m.completion_tokens),
          createdAt: new Date(Number(m.created_at) * 1000) };
      });
      if (data.length) {
        const r = await prisma.aiMessage.createMany({ data, skipDuplicates: true });
        stats.messages_imported += r.count;
      }
    }
  } catch (e) {
    errors.push({ source: 'ai-conversations.db', error: e.message });
  } finally { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function importTitles(dir, log, errors, stats) {
  const p = path.join(dir, 'crawl-titles.jsonl');
  if (!fs.existsSync(p)) { log.push('no crawl-titles.jsonl'); return; }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  stats.source_titles = lines.length;
  const crawlIds = new Map();
  const batch = [];
  for (const [i, line] of lines.entries()) {
    let o;
    try { o = JSON.parse(line); } catch { errors.push({ source: 'crawl-titles.jsonl', line: i + 1, error: 'invalid JSON line' }); continue; }
    const ts = new Date(o.ts);
    if (!o.url || Number.isNaN(ts.getTime())) { errors.push({ source: 'crawl-titles.jsonl', line: i + 1, error: 'missing url or ts' }); continue; }
    const name = String(o.crawl || '');
    if (!crawlIds.has(name)) {
      const c = await prisma.crawlJob.findFirst({ where: { name, source: 'IMPORT' }, select: { id: true } });
      crawlIds.set(name, c ? c.id : null);
    }
    batch.push({ crawlId: crawlIds.get(name), crawlName: name, seed: String(o.seed || ''), url: String(o.url), title: String(o.title || ''),
      metaDescription: String(o.meta_description || ''), ts });
  }
  for (let i = 0; i < batch.length; i += 1000) {
    const r = await prisma.crawlTitleHistory.createMany({ data: batch.slice(i, i + 1000), skipDuplicates: true });
    stats.titles_imported += r.count;
  }
}

async function verify(byFile, dir) {
  const out = [];
  for (const [file, crawlId] of Object.entries(byFile)) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const urls = new Set(data.results.filter((r) => r && r.url).map((r) => r.url));
    const edges = Object.values(data.inlinks || {}).reduce((a, l) => a + (Array.isArray(l) ? l.filter((e) => e && (e.source || typeof e === 'string')).length : 0), 0);
    const [pages, inlinks, reports, score] = await Promise.all([
      prisma.crawledPage.count({ where: { crawlId } }), prisma.crawlInlink.count({ where: { crawlId } }),
      prisma.crawlReport.findMany({ where: { crawlId }, select: { key: true } }), prisma.seoScore.findUnique({ where: { crawlId } }),
    ]);
    const srcKeys = Object.keys(data.reports || {}).filter((k) => data.reports[k] !== null && data.reports[k] !== undefined).sort();
    const dbKeys = reports.map((r) => r.key).sort();
    const okRow = pages === urls.size && inlinks === edges && JSON.stringify(srcKeys) === JSON.stringify(dbKeys) && Boolean(score);
    out.push({ file, crawlId, pages_source: urls.size, pages_db: pages, inlinks_source: edges, inlinks_db: inlinks,
      reports_source: srcKeys, reports_db: dbKeys, missing_report_categories: REPORT_KEYS.filter((k) => !srcKeys.includes(k)),
      site_score: score && score.overall, ok: okRow });
  }
  return out;
}

async function runImport({ dir = defaultDir(), force = false } = {}) {
  if (!fs.existsSync(dir)) throw new Error(`Legacy data directory not found: ${dir}`);
  const run = await prisma.importRun.create({ data: { sourceDir: dir } });
  const log = []; const errors = [];
  const stats = { crawl_files: 0, crawls_imported: 0, crawls_skipped: 0, source_pages: 0, source_inlinks: 0, source_reports: 0,
    source_conversations: 0, conversations_imported: 0, conversations_skipped: 0, source_messages: 0, messages_imported: 0, source_titles: 0, titles_imported: 0 };
  const byFile = await importCrawls(dir, log, errors, stats, { force });
  await importConversations(dir, byFile, log, errors, stats);
  await importTitles(dir, log, errors, stats);
  const verification = await verify(byFile, dir);
  const messagesInDb = await prisma.aiMessage.count({ where: { legacyId: { not: null } } });
  const summary = { ...stats, legacy_messages_in_db: messagesInDb, verified_crawls: verification.filter((v) => v.ok).length,
    failed_verification: verification.filter((v) => !v.ok).length, errors: errors.length };
  await prisma.importRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), stats: { ...summary, verification }, errors, log } });
  return { runId: run.id, dir, summary, verification, errors, log };
}

function markdownReport(r) {
  const lines = [`# Legacy import verification report`, '', `- Run: ${r.runId}`, `- Source: \`${r.dir}\``, `- Generated: ${new Date().toISOString()}`, '', '## Totals', '',
    '| Metric | Value |', '|---|---|', ...Object.entries(r.summary).map(([k, v]) => `| ${k} | ${v} |`), '', '## Per crawl', '',
    '| File | Pages src/db | Inlinks src/db | Reports | Site score | OK |', '|---|---|---|---|---|---|',
    ...r.verification.map((v) => `| ${v.file} | ${v.pages_source}/${v.pages_db} | ${v.inlinks_source}/${v.inlinks_db} | ${v.reports_db.length} (${v.reports_db.join(', ')}) | ${v.site_score} | ${v.ok ? 'yes' : 'NO'} |`),
    '', '## Errors', '', ...(r.errors.length ? r.errors.map((e) => `- ${e.source}${e.line ? `:${e.line}` : ''}: ${e.error}`) : ['None.']), '',
    'Source files were opened read-only and were not modified or deleted.'];
  return lines.join('\n');
}

module.exports = { runImport, markdownReport, defaultDir, REPORT_KEYS };
