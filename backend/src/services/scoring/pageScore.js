'use strict';
/**
 * Page SEO score, algorithm `page-v1`.
 *
 * Every page gets 0-100 built from seven weighted categories. Each category is
 * a list of checks worth a number of points. A check is:
 *   pass     -> earns its points
 *   partial  -> earns points * fraction
 *   fail     -> earns 0
 *   unknown  -> earns 0 but stays in the denominator (data the crawler should
 *               have had was missing: no free points for uninspected pages)
 *   na       -> removed from the denominator (does not apply to this page)
 * category score = earned / possible over applicable checks (null when none apply)
 * page score     = sum(category score * weight) / sum(weight of applicable categories),
 *                  then gating caps (HTTP error 15, soft 404 30, noindex 60, redirect row 70).
 * Each crawler issue string is consumed by at most one check, so one underlying
 * problem never deducts twice. Crawler errors no check covers are caught by the
 * "Other crawler errors" check.
 */
const { sevOf, issueGroup, isConvention } = require('./issueTaxonomy');

const VERSION = 'page-v1';

const CATEGORIES = [
  { key: 'technical', label: 'Technical SEO', weight: 30 },
  { key: 'onpage', label: 'On-page SEO', weight: 25 },
  { key: 'content', label: 'Content quality', weight: 15 },
  { key: 'images', label: 'Images', weight: 8 },
  { key: 'linking', label: 'Internal linking', weight: 10 },
  { key: 'structured', label: 'Structured data', weight: 5 },
  { key: 'intl_social', label: 'International & social', weight: 7 },
];

const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

// issue regex -> check key. First match wins; used to consume issue strings.
const ISSUE_TO_CHECK = [
  [/^HTTP [45]\d\d|^Timeout|^Connection error|^SSL |^Error: /i, 'http_status'],
  [/^noindex|^Conflicting robots|^Robots "none"|^unavailable_after|^meta robots outside head|^Paginated page set to noindex/i, 'robots_directives'],
  [/^Canonical|^Missing canonical|^Multiple (conflicting )?canonical|^Noindex plus a canonical|^canonical outside head/i, 'canonical'],
  [/^Served over HTTP|^HTTP version does not redirect/i, 'https'],
  [/^Mixed content/i, 'mixed_content'],
  [/^Redirect \(|^Trailing slash redirect|^HTTP→HTTPS redirect|^www normalization|^Host variant redirect|^www and non-www/i, 'redirects'],
  [/^Slow \(/i, 'response_time'],
  [/^Soft 404/i, 'soft_404'],
  [/^Missing title|^Multiple title tags|^title outside head/i, 'title_present'],
  [/^Title too (long|short)|^Title may truncate/i, 'title_length'],
  [/^Missing meta description|^Multiple meta descriptions|^Meta description outside head/i, 'meta_present'],
  [/^Meta desc too (long|short)|^Meta description may truncate/i, 'meta_length'],
  [/^Missing H1/i, 'h1_present'],
  [/^Multiple H1s|^H1 same as title|^H1 identical|^H1 too long/i, 'single_h1'],
  [/^First heading is H|^Heading level skips/i, 'heading_structure'],
  [/^URL: /i, 'url_structure'],
  [/^Missing viewport|^Multiple viewport/i, 'viewport'],
  [/^Thin content/i, 'word_count'],
  [/^JS-only content|^Content needs JavaScript|^noindex in the HTML is removed by JavaScript/i, 'js_dependency'],
  [/imgs missing alt/i, 'alt_missing'],
  [/imgs with empty alt/i, 'empty_alt_content'],
  [/image\(s\) with no width or height/i, 'image_dimensions'],
  [/^No internal outlinks|^Inbound internal links come only/i, 'outlinks'],
  [/internal link\(s\) are nofollow|internal link\(s\) point to HTTP|on-page anchor\(s\) point to nothing/i, 'link_hygiene'],
  [/^No schema/i, 'schema_present'],
  [/^Missing Open Graph|^Missing og:image/i, 'open_graph'],
  [/^Missing Twitter Card/i, 'twitter'],
  [/hreflang|^HTML lang .* does not match/i, 'hreflang'],
];

const CRITICAL_ISSUE_RE = /^HTTP [45]\d\d|^Missing title|^Search engines blocked|^noindex in the X-Robots-Tag|^Soft 404|^Timeout|^Connection error/i;

function checkForIssue(issue) {
  for (const [re, key] of ISSUE_TO_CHECK) if (re.test(issue)) return key;
  return null;
}

/** Severity for one crawler issue string (used for PageIssue rows). */
function issueSeverity(issue, failedCheckSeverity) {
  if (CRITICAL_ISSUE_RE.test(issue)) return 'CRITICAL';
  if (failedCheckSeverity) return failedCheckSeverity;
  const s = sevOf(issue);
  if (s === 'error') return 'HIGH';
  if (s === 'warn') return isConvention(issueGroup(issue).slug) ? 'LOW' : 'MEDIUM';
  return 'INFO';
}

const FIX = {
  http_status: 'Make the URL return 200, or 301 it to the right page and update links pointing here.',
  indexable: 'Remove the noindex (meta robots or X-Robots-Tag) if this page should rank.',
  canonical: 'Add one absolute <link rel="canonical"> in <head> pointing to the preferred, indexable 200 URL.',
  https: 'Serve the page over HTTPS and 301 the HTTP version.',
  mixed_content: 'Load every image, script and stylesheet over HTTPS.',
  redirects: 'Link straight to the final URL and collapse redirect chains to one hop.',
  robots_directives: 'Use one consistent robots directive in <head> (or header) and remove conflicts.',
  response_time: 'Cache the HTML and reduce server work so the document responds in under 1.5s.',
  security_headers: 'Add HSTS, X-Content-Type-Options, X-Frame-Options/CSP and Referrer-Policy headers.',
  soft_404: 'Return a real 404/410 for missing content instead of a 200 page.',
  crawler_errors: 'Fix the error findings listed for this page.',
  title_present: 'Add one unique, descriptive <title> in <head>.',
  title_length: 'Keep the title about 30-60 characters (under ~580px) with the main topic first.',
  meta_present: 'Write a unique meta description that summarises the page.',
  meta_length: 'Keep the meta description about 70-160 characters.',
  h1_present: 'Add one H1 that states the page topic.',
  single_h1: 'Use a single H1 that differs from the title tag.',
  heading_structure: 'Start the outline with H1 and do not skip heading levels.',
  duplicate_metadata: 'Give this page its own title, meta description and H1.',
  url_structure: 'Use short, lowercase, hyphenated URLs without parameters or spaces.',
  viewport: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  content_available: 'Make the main content available in the HTML (or render JS) so crawlers can read it.',
  word_count: 'Expand the copy so it fully answers the page topic (300+ words is a common target).',
  duplicate_content: 'Rewrite or consolidate duplicate pages; canonicalise true duplicates.',
  readability: 'Shorten sentences and words to make the copy easier to read.',
  js_dependency: 'Server-render the title, meta, headings and main copy so non-JS crawlers see them.',
  alt_missing: 'Add descriptive alt text to content images.',
  empty_alt_content: 'Give content images (and linked images) meaningful alt text.',
  image_dimensions: 'Set width and height on images to prevent layout shift.',
  outlinks: 'Link from this page to related pages on the site.',
  inlinks: 'Link to this page from relevant pages (menus, hubs, related content).',
  broken_internal: 'Update or remove links pointing to URLs that return errors.',
  link_hygiene: 'Use followed HTTPS internal links that point to real targets.',
  schema_present: 'Add JSON-LD structured data that matches the page type.',
  open_graph: 'Add og:title, og:description and og:image.',
  twitter: 'Add twitter:card (summary_large_image) and related tags.',
  hreflang: 'Make hreflang self-referencing, reciprocal and use valid codes.',
};

function fleschReadingEase(text) {
  const words = String(text || '').match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 100) return null;
  const sentences = Math.max(1, (String(text).match(/[.!?]+(\s|$)/g) || []).length);
  let syll = 0;
  for (const w of words) {
    const m = w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g);
    syll += Math.max(1, m ? m.length : 1);
  }
  return Math.round(206.835 - 1.015 * (words.length / sentences) - 84.6 * (syll / words.length));
}

const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

/** Site-wide facts every page check needs, derived from the saved crawl. */
function buildSiteContext(rows, reports = {}, inlinks = {}) {
  const urlSet = (groups) => {
    const s = new Set();
    for (const g of groups || []) if ((g.urls || []).length > 1) for (const u of g.urls) s.add(norm(u));
    return s;
  };
  const nearDup = new Set();
  for (const p of (reports.near_dup && reports.near_dup.pairs) || []) {
    const a = p.a || p.url_a || (Array.isArray(p) ? p[0] : null);
    const b = p.b || p.url_b || (Array.isArray(p) ? p[1] : null);
    if (a) nearDup.add(norm(a));
    if (b) nearDup.add(norm(b));
  }
  const status = new Map();
  for (const r of rows) {
    status.set(norm(r.url), r.status_code || 0);
    if (r.original_url) status.set(norm(r.original_url), r.status_code || 0);
  }
  const inl = new Map();
  for (const [t, list] of Object.entries(inlinks || {})) inl.set(norm(t), (list || []).length);
  const sm = (reports.sitemap && reports.sitemap.reports) || {};
  const orphans = new Set((sm.orphan_in_sitemap || []).map((x) => norm(typeof x === 'string' ? x : x.url)));
  return {
    seed: norm(rows[0] && (rows[0].original_url || rows[0].url)),
    seedLanded: norm(rows[0] && rows[0].url),
    dupTitles: urlSet(reports.duplicate_titles),
    dupMetas: urlSet(reports.duplicate_metas),
    dupH1s: urlSet(reports.duplicate_h1s),
    dupBodies: urlSet(reports.duplicate_bodies),
    nearDup,
    status,
    inlinks: inl,
    orphans,
    hasSitemap: Boolean(reports.sitemap),
  };
}

function pageType(r) {
  const sc = r.status_code || 0;
  if (r.error || sc === 0) return 'error';
  if (sc >= 400) return 'error';
  if (sc >= 300 && sc < 400) return 'redirect';
  const ct = String(r.content_type || '').toLowerCase();
  if (ct && !ct.includes('html')) return 'non_html';
  return 'html';
}

function scorePage(r, ctx) {
  const type = pageType(r);
  const url = norm(r.url);
  const issues = Array.isArray(r.issues) ? r.issues.map(String) : [];
  const byCheck = {};
  const unmapped = [];
  for (const i of issues) {
    const k = checkForIssue(i);
    if (k) (byCheck[k] = byCheck[k] || []).push(i);
    else unmapped.push(i);
  }
  const checks = [];
  const add = (category, key, label, points, severity, status, detail, fraction) => {
    checks.push({ category, key, label, points, severity, status, detail: detail || '', fraction,
      issues: byCheck[key] || [], fix: FIX[key] || null });
  };
  const has = (k) => (byCheck[k] || []).length > 0;
  const html = type === 'html';
  const inspected = html;
  const sec = r.security || {};
  const contentEligible = html && r.indexable !== false && r.canonical_kind !== 'canonicalised' && !r.is_pagination;
  const unk = (cat, key, label, pts, sev) => add(cat, key, label, pts, sev, inspected ? 'fail' : (type === 'error' ? 'unknown' : 'na'),
    type === 'error' ? 'Not inspected: the page did not load.' : 'Does not apply to this response.');

  // ---- Technical
  const sc = r.status_code || 0;
  if (type === 'error') add('technical', 'http_status', 'HTTP status', 10, 'CRITICAL', 'fail', r.error ? `Fetch failed: ${r.error}` : `HTTP ${sc}`);
  else if (type === 'redirect') add('technical', 'http_status', 'HTTP status', 10, 'MEDIUM', 'partial', `Redirects (${sc}) to ${r.redirect_url || 'another URL'}`, 0.7);
  else add('technical', 'http_status', 'HTTP status', 10, 'CRITICAL', 'pass', `HTTP ${sc}`);

  if (!html) add('technical', 'indexable', 'Indexability', 8, 'HIGH', type === 'error' ? 'unknown' : 'na', 'Not an indexable document.');
  else if (r.indexable === false) add('technical', 'indexable', 'Indexability', 8, 'HIGH', 'fail', 'Page is noindex.');
  else if (r.canonical_kind === 'canonicalised') add('technical', 'indexable', 'Indexability', 8, 'MEDIUM', 'partial', `Canonicalised to ${r.canonical}`, 0.5);
  else add('technical', 'indexable', 'Indexability', 8, 'HIGH', 'pass', 'Indexable.');

  if (!html) unk('technical', 'canonical', 'Canonical tag', 5, 'MEDIUM');
  else {
    const bad = (byCheck.canonical || []).filter((i) => !/^Missing canonical/i.test(i));
    const hard = bad.some((i) => sevOf(i) === 'error');
    if (hard) add('technical', 'canonical', 'Canonical tag', 5, 'HIGH', 'fail', bad[0]);
    else if (!r.canonical) add('technical', 'canonical', 'Canonical tag', 5, 'MEDIUM', 'fail', 'No canonical tag.');
    else if (bad.length) add('technical', 'canonical', 'Canonical tag', 5, 'MEDIUM', 'partial', bad[0], 0.5);
    else add('technical', 'canonical', 'Canonical tag', 5, 'MEDIUM', 'pass', r.canonical_kind === 'self' ? 'Self-referencing.' : 'Present.');
  }

  const isHttps = sec.is_https !== undefined ? Boolean(sec.is_https) : /^https:/i.test(r.url || '');
  if (type === 'error' && !Object.keys(sec).length) add('technical', 'https', 'HTTPS', 4, 'HIGH', /^https:/i.test(r.url || '') ? 'pass' : 'fail', 'From the URL scheme.');
  else add('technical', 'https', 'HTTPS', 4, 'HIGH', isHttps && !has('https') ? 'pass' : 'fail', isHttps ? 'Served over HTTPS.' : 'Served over HTTP.');

  if (!html) add('technical', 'mixed_content', 'Mixed content', 2, 'HIGH', 'na');
  else add('technical', 'mixed_content', 'Mixed content', 2, 'HIGH', (r.mixed_content || []).length ? 'fail' : 'pass',
    (r.mixed_content || []).length ? `${r.mixed_content.length} insecure resources` : 'None.');

  const hops = r.redirect_hops || 0;
  if (hops >= 2) add('technical', 'redirects', 'Redirect handling', 3, 'MEDIUM', 'fail', `Redirect chain of ${hops} hops.`);
  else if (hops === 1 || has('redirects')) add('technical', 'redirects', 'Redirect handling', 3, 'LOW', 'partial', `Reached through one redirect (${r.redirect_kind || 'redirect'}).`, 0.7);
  else add('technical', 'redirects', 'Redirect handling', 3, 'MEDIUM', 'pass', 'No redirect.');

  if (!html) add('technical', 'robots_directives', 'Robots directives', 3, 'HIGH', 'na');
  else add('technical', 'robots_directives', 'Robots directives', 3, 'HIGH', has('robots_directives') ? 'fail' : 'pass',
    (byCheck.robots_directives || [])[0] || (r.x_robots_tag ? `X-Robots-Tag: ${r.x_robots_tag}` : 'No conflicting directives.'));

  if (type === 'error') add('technical', 'response_time', 'Response time', 3, 'LOW', 'unknown', 'Not measured.');
  else {
    const t = Number(r.response_time || 0);
    add('technical', 'response_time', 'Response time', 3, 'LOW', t <= 1.5 ? 'pass' : t <= 3 ? 'partial' : 'fail', `${t}s`, 0.5);
  }

  const secKeys = ['hsts', 'csp', 'x_content_type_options', 'x_frame_options', 'referrer_policy'];
  if (!Object.keys(sec).length) add('technical', 'security_headers', 'Security headers', 2, 'LOW', type === 'error' ? 'unknown' : 'na', 'Headers not captured.');
  else {
    const present = secKeys.filter((k) => sec[k]).length;
    const st = present === secKeys.length ? 'pass' : present === 0 ? 'fail' : 'partial';
    add('technical', 'security_headers', 'Security headers', 2, 'LOW', st, `${present}/${secKeys.length} present (${secKeys.filter((k) => !sec[k]).join(', ') || 'all'} missing)`.replace('(all missing)', ''), present / secKeys.length);
  }

  if (html) add('technical', 'soft_404', 'Soft 404', 3, 'CRITICAL', has('soft_404') ? 'fail' : 'pass', (byCheck.soft_404 || [])[0] || 'Not a soft 404.');
  const otherErrors = unmapped.filter((i) => sevOf(i) === 'error');
  if (html) {
    add('technical', 'crawler_errors', 'Other crawler errors', 3, 'HIGH', otherErrors.length ? 'fail' : 'pass',
      otherErrors.length ? otherErrors.slice(0, 3).join('; ') : 'None.');
    checks[checks.length - 1].issues = otherErrors;
  }

  // ---- On-page
  if (!html) {
    for (const [k, l, p, s] of [['title_present', 'Title present', 8, 'CRITICAL'], ['title_length', 'Title length', 3, 'LOW'],
      ['meta_present', 'Meta description present', 5, 'HIGH'], ['meta_length', 'Meta description length', 2, 'LOW'],
      ['h1_present', 'H1 present', 5, 'HIGH'], ['single_h1', 'H1 usage', 2, 'MEDIUM'], ['heading_structure', 'Heading structure', 2, 'LOW'],
      ['duplicate_metadata', 'Unique metadata', 4, 'MEDIUM'], ['viewport', 'Mobile viewport', 2, 'MEDIUM']]) unk('onpage', k, l, p, s);
  } else {
    const tl = r.title_len || (r.title || '').length;
    add('onpage', 'title_present', 'Title present', 8, 'CRITICAL', r.title && !has('title_present') ? 'pass' : (r.title ? 'partial' : 'fail'),
      r.title ? `"${String(r.title).slice(0, 80)}"` : 'Missing.', 0.5);
    if (!r.title) add('onpage', 'title_length', 'Title length', 3, 'LOW', 'na', 'No title.');
    else add('onpage', 'title_length', 'Title length', 3, 'LOW', tl >= 30 && tl <= 60 && !has('title_length') ? 'pass' : (tl >= 15 && tl <= 70 ? 'partial' : 'fail'), `${tl} characters`, 0.5);
    const ml = r.meta_len || (r.meta_description || '').length;
    add('onpage', 'meta_present', 'Meta description present', 5, 'HIGH', r.meta_description && !has('meta_present') ? 'pass' : (r.meta_description ? 'partial' : 'fail'),
      r.meta_description ? `${ml} characters` : 'Missing.', 0.5);
    if (!r.meta_description) add('onpage', 'meta_length', 'Meta description length', 2, 'LOW', 'na', 'No meta description.');
    else add('onpage', 'meta_length', 'Meta description length', 2, 'LOW', ml >= 70 && ml <= 160 && !has('meta_length') ? 'pass' : (ml >= 50 && ml <= 180 ? 'partial' : 'fail'), `${ml} characters`, 0.5);
    const h1s = (r.h1_list && r.h1_list.length) || (r.h1 ? 1 : 0);
    add('onpage', 'h1_present', 'H1 present', 5, 'HIGH', h1s ? 'pass' : 'fail', h1s ? `"${String(r.h1 || '').slice(0, 80)}"` : 'Missing.');
    if (!h1s) add('onpage', 'single_h1', 'H1 usage', 2, 'MEDIUM', 'na', 'No H1.');
    else add('onpage', 'single_h1', 'H1 usage', 2, 'MEDIUM', has('single_h1') ? (h1s > 1 ? 'fail' : 'partial') : 'pass', (byCheck.single_h1 || [])[0] || 'One H1.', 0.5);
    add('onpage', 'heading_structure', 'Heading structure', 2, 'LOW', has('heading_structure') ? 'fail' : (h1s || (r.h2_count || 0) ? 'pass' : 'fail'),
      (byCheck.heading_structure || [])[0] || `${h1s} H1, ${r.h2_count || 0} H2`);
    if (!contentEligible) add('onpage', 'duplicate_metadata', 'Unique metadata', 4, 'MEDIUM', 'na', 'Not indexable or canonicalised: duplicates are expected.');
    else {
      const d = [ctx.dupTitles.has(url) && 'title', ctx.dupMetas.has(url) && 'meta description', ctx.dupH1s.has(url) && 'H1'].filter(Boolean);
      add('onpage', 'duplicate_metadata', 'Unique metadata', 4, 'MEDIUM', d.length === 0 ? 'pass' : d.length === 3 ? 'fail' : 'partial',
        d.length ? `Duplicate ${d.join(', ')} across pages.` : 'Unique.', 1 - d.length / 3);
    }
    add('onpage', 'viewport', 'Mobile viewport', 2, 'MEDIUM', has('viewport') ? 'fail' : 'pass', (byCheck.viewport || [])[0] || 'Present.');
  }
  const ui = r.url_issues || [];
  add('onpage', 'url_structure', 'URL structure', 2, 'LOW', type === 'error' && !ui.length ? 'unknown' : (ui.length ? (ui.length > 1 ? 'fail' : 'partial') : 'pass'),
    ui.length ? ui.join(', ') : 'Clean URL.', 0.5);

  // ---- Content
  if (!contentEligible) {
    for (const [k, l, p, s] of [['content_available', 'Content available', 4, 'HIGH'], ['word_count', 'Content depth', 5, 'MEDIUM'],
      ['duplicate_content', 'Unique content', 4, 'HIGH'], ['readability', 'Readability', 2, 'LOW']]) {
      if (type === 'error') unk('content', k, l, p, s);
      else add('content', k, l, p, s, 'na', html ? 'Not indexable, canonicalised or paginated: content checks skipped (as in the crawler).' : 'Not an HTML page.');
    }
  } else {
    const wc = r.word_count || 0;
    add('content', 'content_available', 'Content available', 4, 'HIGH', wc > 0 ? 'pass' : 'fail', wc > 0 ? `${wc} words` : 'No readable text in the HTML.');
    add('content', 'word_count', 'Content depth', 5, 'MEDIUM', wc >= 300 ? 'pass' : wc >= 200 ? 'partial' : 'fail', `${wc} words`, 0.6);
    const exact = ctx.dupBodies.has(url);
    const near = ctx.nearDup.has(url);
    add('content', 'duplicate_content', 'Unique content', 4, 'HIGH', exact ? 'fail' : near ? 'partial' : 'pass',
      exact ? 'Body identical to another page.' : near ? 'Near-duplicate of another page.' : 'Unique.', 0.5);
    const fre = fleschReadingEase(r.body_text);
    if (fre === null) add('content', 'readability', 'Readability', 2, 'LOW', 'na', 'Not enough text captured to measure.');
    else add('content', 'readability', 'Readability', 2, 'LOW', fre >= 50 ? 'pass' : fre >= 30 ? 'partial' : 'fail', `Flesch reading ease ${fre}`, 0.5);
  }
  if (r.js_diff || has('js_dependency')) {
    const sev = (r.js_diff && r.js_diff.severity) || '';
    add('content', 'js_dependency', 'Content without JavaScript', 4, 'HIGH',
      sev === 'critical' || /critical/i.test((byCheck.js_dependency || [])[0] || '') ? 'fail' : (sev === 'high' || has('js_dependency')) ? 'partial' : 'pass',
      (byCheck.js_dependency || [])[0] || 'Server HTML carries the content.', 0.4);
  }

  // ---- Images
  const imgs = r.images_total || 0;
  if (!html || imgs === 0) {
    for (const [k, l, p, s] of [['alt_missing', 'Alt attributes', 5, 'MEDIUM'], ['empty_alt_content', 'Alt on content images', 2, 'LOW'], ['image_dimensions', 'Image dimensions', 1, 'LOW']]) {
      if (type === 'error') unk('images', k, l, p, s); else add('images', k, l, p, s, 'na', 'No images on the page.');
    }
  } else {
    const noAlt = r.images_no_alt || 0;
    const frac = Math.max(0, 1 - noAlt / imgs);
    add('images', 'alt_missing', 'Alt attributes', 5, 'MEDIUM', noAlt === 0 ? 'pass' : frac === 0 ? 'fail' : 'partial', `${noAlt} of ${imgs} images missing alt`, frac);
    const emptyContent = (r.images_empty_alt_content || []).length || (typeof r.images_empty_alt_content === 'number' ? r.images_empty_alt_content : 0);
    add('images', 'empty_alt_content', 'Alt on content images', 2, 'LOW', emptyContent || has('empty_alt_content') ? 'partial' : 'pass',
      emptyContent ? `${emptyContent} content images with empty alt` : 'OK.', 0.5);
    add('images', 'image_dimensions', 'Image dimensions', 1, 'LOW', has('image_dimensions') ? 'partial' : 'pass', (byCheck.image_dimensions || [])[0] || 'OK.', 0.5);
  }

  // ---- Internal linking
  if (!html) {
    for (const [k, l, p, s] of [['outlinks', 'Internal outlinks', 4, 'MEDIUM'], ['broken_internal', 'Broken internal links', 3, 'HIGH'], ['link_hygiene', 'Link hygiene', 1, 'LOW']]) unk('linking', k, l, p, s);
  } else {
    add('linking', 'outlinks', 'Internal outlinks', 4, 'MEDIUM', (r.internal_links || 0) > 0 && !has('outlinks') ? 'pass' : (r.internal_links || 0) > 0 ? 'partial' : 'fail',
      (byCheck.outlinks || [])[0] || `${r.internal_links || 0} internal links`, 0.5);
    const targets = new Set();
    for (const e of r.internal_link_urls || []) {
      const t = norm(Array.isArray(e) ? e[0] : e);
      if (t && (ctx.status.get(t) || 0) >= 400) targets.add(t);
    }
    add('linking', 'broken_internal', 'Broken internal links', 3, 'HIGH', targets.size ? 'fail' : 'pass',
      targets.size ? `${targets.size} link(s) to error URLs: ${[...targets].slice(0, 3).join(', ')}` : 'No links to crawled error pages.');
    add('linking', 'link_hygiene', 'Link hygiene', 1, 'LOW', has('link_hygiene') ? 'partial' : 'pass', (byCheck.link_hygiene || [])[0] || 'OK.', 0.5);
  }
  const isSeed = url === ctx.seed || url === ctx.seedLanded;
  if (type === 'error') add('linking', 'inlinks', 'Internal inlinks', 4, 'MEDIUM', 'na', 'Error page.');
  else {
    const n = ctx.inlinks.get(url) || 0;
    const orphan = ctx.orphans.has(url);
    add('linking', 'inlinks', 'Internal inlinks', 4, 'MEDIUM', isSeed ? 'pass' : orphan ? 'fail' : n > 0 ? 'pass' : 'partial',
      isSeed ? 'Start page.' : orphan ? 'Orphan: in the sitemap but no internal links.' : `${n} internal pages link here`, 0.5);
  }

  // ---- Structured data
  if (!html) unk('structured', 'schema_present', 'Schema markup', 5, 'LOW');
  else {
    const types = r.schema_types || [];
    add('structured', 'schema_present', 'Schema markup', 5, 'LOW', types.length ? 'pass' : 'fail', types.length ? types.join(', ') : 'No JSON-LD or microdata found.');
  }
  add('structured', 'schema_validity', 'Schema validity', 0, 'INFO', 'na', 'Not validated: the crawler detects schema types but does not validate them.');

  // ---- International & social
  if (!html) {
    unk('intl_social', 'open_graph', 'Open Graph', 3, 'LOW'); unk('intl_social', 'twitter', 'Twitter card', 2, 'INFO');
  } else {
    const og = r.og_tags || {};
    const got = ['og:title', 'og:image'].filter((k) => og[k]).length;
    add('intl_social', 'open_graph', 'Open Graph', 3, 'LOW', got === 2 ? 'pass' : got ? 'partial' : 'fail', got === 2 ? 'og:title and og:image present.' : `Missing ${['og:title', 'og:image'].filter((k) => !og[k]).join(', ')}`, 0.5);
    add('intl_social', 'twitter', 'Twitter card', 2, 'INFO', Object.keys(r.twitter_tags || {}).length ? 'pass' : 'fail', Object.keys(r.twitter_tags || {}).length ? 'Present.' : 'Missing.');
  }
  if ((r.hreflang || []).length || has('hreflang')) add('intl_social', 'hreflang', 'Hreflang', 2, 'MEDIUM', has('hreflang') ? 'fail' : 'pass', (byCheck.hreflang || [])[0] || `${(r.hreflang || []).length} alternates`);
  else add('intl_social', 'hreflang', 'Hreflang', 2, 'MEDIUM', 'na', 'No hreflang on this page.');

  // ---- Aggregate
  const categories = CATEGORIES.map((c) => {
    const cs = checks.filter((x) => x.category === c.key);
    let earned = 0; let possible = 0;
    for (const x of cs) {
      if (x.status === 'na' || !x.points) continue;
      possible += x.points;
      x.earned = x.status === 'pass' ? x.points : x.status === 'partial' ? +(x.points * (x.fraction ?? 0.5)).toFixed(2) : 0;
      earned += x.earned;
    }
    for (const x of cs) if (x.earned === undefined) x.earned = 0;
    const score = possible ? Math.round((earned / possible) * 100) : null;
    const failed = cs.filter((x) => x.status === 'fail' || x.status === 'partial' || x.status === 'unknown');
    return { key: c.key, label: c.label, weight: c.weight, score, earned: +earned.toFixed(2), possible, max_score: 100,
      passed: cs.filter((x) => x.status === 'pass').length, failed: failed.length,
      explanation: score === null ? 'No checks apply to this page.' : `${+earned.toFixed(1)} of ${possible} points from ${cs.filter((x) => x.status !== 'na').length} applicable checks.` };
  });
  const applicable = categories.filter((c) => c.score !== null);
  const wsum = applicable.reduce((a, c) => a + c.weight, 0);
  let raw = wsum ? applicable.reduce((a, c) => a + c.score * c.weight, 0) / wsum : 0;
  const caps = [];
  const cap = (v, why) => { if (raw > v) { caps.push(`${why}: capped at ${v}`); raw = v; } };
  if (type === 'error') cap(15, 'HTTP error or fetch failure');
  if (has('soft_404')) cap(30, 'Soft 404');
  if (html && r.indexable === false) cap(60, 'Noindex page');
  if (type === 'redirect') cap(70, 'Redirect row: scored on redirect handling only');
  const scored = type !== 'non_html';
  const score = scored ? Math.round(raw) : null;

  const failedChecks = checks.filter((x) => ['fail', 'partial', 'unknown'].includes(x.status) && x.points);
  const topIssues = failedChecks
    .map((x) => ({ check: x.key, label: x.label, category: x.category, severity: x.severity, detail: x.detail,
      lost: +(x.points - x.earned).toFixed(2), fix: x.fix, issues: x.issues }))
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.lost - a.lost)
    .slice(0, 8);

  // Severity per crawler issue, from the check that consumed it.
  const sevByIssue = {};
  for (const x of checks) {
    const failed = ['fail', 'partial', 'unknown'].includes(x.status);
    for (const i of x.issues || []) sevByIssue[i] = { severity: issueSeverity(i, failed ? x.severity : null), category: x.category, check: x.key };
  }
  for (const i of unmapped) if (!sevByIssue[i]) sevByIssue[i] = { severity: issueSeverity(i, null), category: 'other', check: null };

  return {
    version: VERSION, type, score, grade: grade(score), caps,
    categories, checks, top_issues: topIssues, issue_meta: sevByIssue,
    explanation: !scored ? 'Non-HTML response: not scored.' :
      `Weighted average of ${applicable.length} applicable categories${caps.length ? `, then ${caps.join('; ')}` : ''}.`,
  };
}

function grade(score) {
  if (score === null || score === undefined) return 'N/A';
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Needs work';
  return 'Poor';
}

module.exports = { VERSION, CATEGORIES, scorePage, buildSiteContext, pageType, issueSeverity, grade, fleschReadingEase, norm };
