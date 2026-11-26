'use strict';
/**
 * Website SEO score, algorithm `site-v1`. Reproducible from the saved crawl
 * (page rows + reports + the page scores computed by page-v1).
 *
 * Components (0-100 each; a component with no data is excluded and the
 * remaining weights are renormalised):
 *   page_quality   35  0.6 * mean + 0.4 * 25th percentile of HTML page scores
 *                      (a few great pages cannot hide many weak ones)
 *   technical      20  100 - 150*error_rate - 40*non_indexable_rate(of HTML 200s)
 *                      - 30*redirect_chain_rate - 30*non_https_rate
 *   metadata       15  100 - 100*avg(dup title, dup meta, dup H1 share)
 *                      - 60*missing_title_share - 40*missing_meta_share - 30*missing_h1_share
 *   content        10  100 - 80*thin_share - 100*exact_dup_body_share - 50*near_dup_share
 *   architecture   10  100 - 60*orphan_share - 40*deep_page_share(depth>=4) - 40*dead_end_share
 *   sitemap_robots  5  sitemap found (else 50); -100*non200/redirect/noindex-in-sitemap share; soft-404 trap -30
 *   bot_readability 5  100 - 100*(sample pages with a bot finding / sample pages)
 * Then caps: search engines blocked in robots.txt -> 30; start page fails -> 20;
 * more than half the pages are errors -> 40.
 */
const { pageType, grade } = require('./pageScore');

const VERSION = 'site-v1';
const COMPONENTS = [
  { key: 'page_quality', label: 'Page quality', weight: 35 },
  { key: 'technical', label: 'Technical health', weight: 20 },
  { key: 'metadata', label: 'Site-wide metadata', weight: 15 },
  { key: 'content', label: 'Content', weight: 10 },
  { key: 'architecture', label: 'Internal linking & architecture', weight: 10 },
  { key: 'sitemap_robots', label: 'Sitemap & robots.txt', weight: 5 },
  { key: 'bot_readability', label: 'Bot readability', weight: 5 },
];
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const share = (n, d) => (d ? n / d : 0);
const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx); const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** pages: [{row, score: pageScoreResult}] in crawl order. */
function scoreSite(pages, reports = {}, inlinks = {}) {
  const total = pages.length;
  const types = pages.map((p) => pageType(p.row));
  const html = pages.filter((_, i) => types[i] === 'html');
  const errors = types.filter((t) => t === 'error').length;
  const scores = html.map((p) => p.score.score).filter((s) => s !== null).sort((a, b) => a - b);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const p25 = percentile(scores, 0.25);
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const p of pages) for (const m of Object.values(p.score.issue_meta || {})) sevCounts[m.severity.toLowerCase()] += 1;

  const indexable200 = html.filter((p) => p.row.indexable !== false && p.row.canonical_kind !== 'canonicalised');
  const content = indexable200.filter((p) => !p.row.is_pagination);
  const comp = {};
  const notes = {};
  comp.page_quality = mean === null ? null : clamp(0.6 * mean + 0.4 * p25);
  notes.page_quality = mean === null ? 'No HTML pages scored.' : `Mean ${mean.toFixed(1)}, 25th percentile ${p25.toFixed(1)} over ${scores.length} pages.`;

  const chains = (reports.redirect_chains || []).length;
  const nonIdx = html.filter((p) => p.row.indexable === false).length;
  const nonHttps = pages.filter((p) => !/^https:/i.test(p.row.url || '')).length;
  comp.technical = total ? clamp(100 - 150 * share(errors, total) - 40 * share(nonIdx, html.length) - 30 * share(chains, total) - 30 * share(nonHttps, total)) : null;
  notes.technical = `${errors} error pages, ${nonIdx} noindex HTML pages, ${chains} redirect chains, ${nonHttps} non-HTTPS URLs of ${total}.`;

  const dupShare = (key) => {
    const s = new Set();
    for (const g of reports[key] || []) if ((g.urls || []).length > 1) for (const u of g.urls) s.add(norm(u));
    return share(s.size, content.length);
  };
  const miss = (f) => content.filter((p) => !p.row[f]).length;
  if (content.length) {
    const dupAvg = (dupShare('duplicate_titles') + dupShare('duplicate_metas') + dupShare('duplicate_h1s')) / 3;
    comp.metadata = clamp(100 - 100 * dupAvg - 60 * share(miss('title'), content.length) - 40 * share(miss('meta_description'), content.length) - 30 * share(miss('h1'), content.length));
    notes.metadata = `Avg duplicate share ${(dupAvg * 100).toFixed(1)}%; missing title ${miss('title')}, meta ${miss('meta_description')}, H1 ${miss('h1')} of ${content.length} indexable pages.`;
    const thin = content.filter((p) => (p.row.word_count || 0) < 200).length;
    const nd = new Set();
    for (const pr of (reports.near_dup && reports.near_dup.pairs) || []) { const a = pr.a || pr.url_a; const b = pr.b || pr.url_b; if (a) nd.add(norm(a)); if (b) nd.add(norm(b)); }
    comp.content = clamp(100 - 80 * share(thin, content.length) - 100 * dupShare('duplicate_bodies') - 50 * share(nd.size, content.length));
    notes.content = `${thin} thin pages, ${(dupShare('duplicate_bodies') * 100).toFixed(1)}% exact duplicate bodies, ${nd.size} near-duplicate pages.`;
  } else { comp.metadata = null; comp.content = null; notes.metadata = notes.content = 'No indexable HTML pages.'; }

  const sm = (reports.sitemap && reports.sitemap.reports) || null;
  const orphans = sm ? (sm.orphan_in_sitemap || []).length : 0;
  const deep = html.filter((p) => (p.row.depth || 0) >= 4).length;
  const deadEnds = html.filter((p) => (p.row.internal_links || 0) === 0).length;
  comp.architecture = html.length ? clamp(100 - 60 * share(orphans, html.length) - 40 * share(deep, html.length) - 40 * share(deadEnds, html.length)) : null;
  notes.architecture = `${orphans} sitemap orphans, ${deep} pages at depth >= 4, ${deadEnds} pages with no internal outlinks.`;

  const traps = reports.url_traps || {};
  if (reports.sitemap || reports.url_traps) {
    let v = reports.sitemap ? 100 : 50;
    if (sm) {
      const inSm = (reports.sitemap.totals && reports.sitemap.totals.urls_in_sitemap) || 0;
      const bad = (sm.non_200_in_sitemap || []).length + (sm.redirects_in_sitemap || []).length + (sm.non_indexable_in_sitemap || []).length;
      v -= 100 * share(bad, inSm || 1);
    }
    if (traps.soft_404 || traps.nested_trap) v -= 30;
    comp.sitemap_robots = clamp(v);
    notes.sitemap_robots = `${reports.sitemap ? 'Sitemap found' : 'No sitemap analysed'}${traps.soft_404 ? '; server soft-404s unknown URLs' : ''}.`;
  } else { comp.sitemap_robots = null; notes.sitemap_robots = 'No sitemap or URL-trap data in this crawl.'; }

  const bc = reports.bot_check;
  const bcSample = bc ? ((bc.sample || []).length || Object.keys(bc.pages || {}).length) : 0;
  if (bcSample) {
    const sample = bcSample;
    const hit = Object.keys(bc.page_issues || {}).length;
    comp.bot_readability = clamp(100 - 100 * share(hit, sample));
    notes.bot_readability = `${hit} of ${sample} sampled pages had a crawler-specific finding.`;
  } else { comp.bot_readability = null; notes.bot_readability = 'Bot readability check not run.'; }

  const components = COMPONENTS.map((c) => ({ ...c, score: comp[c.key], explanation: notes[c.key] }));
  const used = components.filter((c) => c.score !== null);
  const wsum = used.reduce((a, c) => a + c.weight, 0);
  let overall = wsum ? used.reduce((a, c) => a + c.score * c.weight, 0) / wsum : 0;
  const caps = [];
  const cap = (v, why) => { if (overall > v) { caps.push(`${why}: capped at ${v}`); overall = v; } };
  const allIssues = pages.flatMap((p) => p.row.issues || []);
  if (allIssues.some((i) => /^Search engines blocked/i.test(i))) cap(30, 'Search engines blocked in robots.txt');
  if (total && types[0] === 'error') cap(20, 'Start page failed to load');
  if (share(errors, total) > 0.5) cap(40, 'More than half the crawled URLs are errors');
  overall = total ? Math.round(overall) : 0;

  const ranked = html.filter((p) => p.score.score !== null).map((p) => ({ url: p.row.url, score: p.score.score }));
  return {
    version: VERSION, overall, grade: grade(overall), components, caps,
    severity_counts: sevCounts,
    stats: { pages_total: total, html_pages: html.length, error_pages: errors, redirect_rows: types.filter((t) => t === 'redirect').length,
      non_html: types.filter((t) => t === 'non_html').length, indexable: indexable200.length, non_indexable: nonIdx,
      mean_page_score: mean === null ? null : +mean.toFixed(1), p25_page_score: p25 === null ? null : +p25.toFixed(1) },
    pages_analyzed: pages.filter((p) => p.score.score !== null).length,
    pages_with_errors: errors,
    pages_excellent: scores.filter((s) => s >= 90).length,
    pages_need_attention: scores.filter((s) => s < 50).length,
    lowest_pages: [...ranked].sort((a, b) => a.score - b.score).slice(0, 10),
    highest_pages: [...ranked].sort((a, b) => b.score - a.score).slice(0, 10),
    explanation: `Weighted average of ${used.length} components (${used.map((c) => `${c.label} ${c.score}×${c.weight}`).join(', ')})${caps.length ? `; ${caps.join('; ')}` : ''}.`,
  };
}

module.exports = { VERSION, COMPONENTS, scoreSite };
