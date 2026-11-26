'use strict';
// Port of agent_tools.sev_of / issue_group (and sevOf/_scIssueGroup in the old
// script.js) so the backend classifies the crawler's issue strings exactly the
// way the crawler and its Summary do.

const PAGE_CHECK_ERR_RE = new RegExp([
  '^(title|canonical|meta robots) outside head', '^unavailable_after', '^canonical is malformed',
  '^multiple conflicting canonicals', '^canonical conflict', '^soft 404', '^noindex in the x-robots-tag',
  '^conflicting robots directives', '^robots "none"', '^lorem ipsum placeholder',
  '^\\d+ link\\(s\\) to a local or staging host', '^\\d+ form\\(s\\) submit over http', '^no <head> element',
  '^canonical points to a non-200', '^canonical points to a non-indexable',
  '^(search|ai search|ai assistant) bot (blocked|challenged):', '^noindex only for ',
  '^noindex in the html is removed by javascript', '^http version does not redirect to https',
].join('|'));

const PAGE_CHECK_WARN_RE = new RegExp([
  '^multiple (title tags|canonical tags|meta descriptions|viewport tags|head elements|body elements)',
  '^canonical (points to http|is a relative url|points to another host|only in the http header)',
  '^noindex plus a canonical', '^meta description outside head', '^no compression', '^paginated page', 'hreflang',
  '^no lang attribute', '^invalid lang attribute', '^html lang', '^h1 too long', 'may truncate in results',
  'point to http', 'on-page anchor\\(s\\) point to nothing', '^no doctype', '^no charset declared', '^charset is ',
  '^nosnippet', '^canonical contains a fragment', '^canonical points to a url that redirects',
  '^no <body> element', '^html document over 2mb', '^no internal outlinks', '^inbound internal links come only',
  'pagination url\\(s\\) declared by rel',
  '^(search|ai search|ai assistant|training) bot (sees different content|sees a thinner page|redirected elsewhere):',
  '^content needs javascript', '^mobile page has less content', '^mobile and desktop pages differ',
  '^host variant redirect is temporary', '^www and non-www both answer',
].join('|'));

const ERR_RE = /^missing (title|h1)\b|^http [45]|served over http|^mixed content/;
const WARN_RE = new RegExp([
  '^missing (canonical|meta description)', 'too (long|short)', 'imgs missing alt', 'imgs with empty alt',
  'thin content', 'multiple h1', 'h1 same as title', 'missing viewport', 'no schema', 'missing open graph',
  'missing og:image', '^slow ', '^url:', 'trailing slash', '^redirect \\(', 'www normalization', 'http→https',
].join('|'));

function sevOf(issue) {
  const low = String(issue || '').toLowerCase();
  if (ERR_RE.test(low) || PAGE_CHECK_ERR_RE.test(low)) return 'error';
  if (WARN_RE.test(low) || PAGE_CHECK_WARN_RE.test(low)) return 'warn';
  return 'info';
}

const GROUP_MAP = {
  'Title too long': ['Title too long', 'Title too long'],
  'Title too short': ['Title too short', 'Title too short'],
  'Meta desc too long': ['Meta description too long', 'Meta desc too long'],
  'Meta desc too short': ['Meta description too short', 'Meta desc too short'],
  'Multiple H1s': ['Multiple H1s', 'Multiple H1s'],
  'H1 same as title': ['H1 same as title', 'H1 same as title'],
  'H1 identical to title tag': ['H1 same as title', 'H1 same as title'],
  'Missing title': ['Missing title', 'Missing title'],
  'Missing H1': ['Missing H1', 'Missing H1'],
  'Missing meta description': ['Missing meta description', 'Missing meta description'],
  'Missing canonical': ['Missing canonical', 'Missing canonical'],
  'Missing viewport': ['Missing viewport', 'Missing viewport'],
  'Missing Open Graph': ['Missing Open Graph tags', 'Missing Open Graph'],
  'Missing og:image': ['Missing og:image', 'Missing og:image'],
  'Missing Twitter Card': ['Missing Twitter Card', 'Missing Twitter Card'],
  'Mixed content': ['Mixed content', 'Mixed content'],
  noindex: ['Noindex pages', 'noindex'],
  Canonicalised: ['Canonicalised', 'Canonicalised'],
  'Thin content': ['Thin content', 'Thin content'],
  Slow: ['Slow response', 'Slow'],
  'No schema': ['No schema markup', 'No schema'],
  Redirect: ['Redirects', 'Redirect'],
  'Trailing slash redirect': ['Redirects', 'Redirect'],
  'HTTP→HTTPS redirect': ['Redirects', 'Redirect'],
  'www normalization': ['Redirects', 'Redirect'],
};

const GROUP_RULES = [
  [/^\d+ image\(s\) with alt text/i, 'raw', 'Images with alt text over 150 chars', 'long alt'],
  [/^\d+ internal link\(s\) point to HTTP/i, 'raw', 'Internal links pointing to HTTP', 'internal http links'],
  [/^\d+ internal link\(s\) are nofollow/i, 'raw', 'Internal nofollow links', 'internal nofollow'],
  [/^\d+ on-page anchor\(s\) point to nothing/i, 'raw', 'On-page anchors pointing to nothing', 'dead anchors'],
  [/^\d+ link\(s\) to a local or staging host/i, 'raw', 'Links to a local or staging host', 'local staging links'],
  [/^\d+ form\(s\) submit over HTTP/i, 'raw', 'Forms submitting over HTTP', 'insecure forms'],
  [/^\d+ image\(s\) with no width or height/i, 'raw', 'Images with no width or height', 'image dimensions'],
  [/^\d+ pagination URL\(s\) declared by rel/i, 'raw', 'Pagination URLs not linked in an anchor tag', 'pagination not linked'],
  [/^\d+ hreflang alternate\(s\) do not link back/i, 'raw', 'Hreflang alternates that do not link back', 'hreflang no return'],
  [/^Soft 404/i, 'stripped', 'Soft 404 (200 status on a missing page)', 'soft 404'],
  [/^HTML lang .* does not match/i, 'stripped', 'HTML lang does not match its hreflang entry', 'lang vs hreflang'],
  [/^Charset is /i, 'stripped', 'Charset is not UTF-8', 'charset'],
  [/^First heading is H/i, 'stripped', 'First heading is not H1', 'first heading'],
  [/^HTTP \d{3}/i, 'stripped', 'HTTP errors (4xx / 5xx)', 'HTTP'],
  [/^URL:/i, 'stripped', 'URL hygiene', 'URL:'],
  [/^AI crawlers blocked/i, 'stripped', 'AI crawlers blocked in robots.txt', 'AI crawlers blocked'],
  [/^AI training bots blocked/i, 'stripped', 'AI training bots blocked in robots.txt', 'AI training bots blocked'],
  [/^Search engines blocked/i, 'stripped', 'Search engines blocked in robots.txt', 'Search engines blocked'],
];

const CONVENTION = new Set([
  'Title too long', 'Title too short', 'Meta desc too long', 'Meta desc too short',
  'Title may truncate in results', 'Meta description may truncate in results',
  'Multiple H1s', 'H1 same as title', 'H1 too long', 'first heading', 'Heading level skips',
  'Thin content', 'Slow', 'URL:', 'No schema', 'long alt',
]);

function issueGroup(issue) {
  const raw = String(issue || '');
  const stripped = raw.replace(/\s*\(.*$/s, '').trim();
  if (Object.prototype.hasOwnProperty.call(GROUP_MAP, stripped)) {
    const [label, slug] = GROUP_MAP[stripped];
    return { label, slug };
  }
  if (/^imgs missing alt|imgs with empty alt/i.test(stripped) || /^\d+ imgs missing alt|^\d+ imgs with empty alt/i.test(raw)) {
    return { label: 'Images missing alt', slug: 'imgs missing alt' };
  }
  for (const [re, target, label, slug] of GROUP_RULES) {
    if (re.test(target === 'raw' ? raw : stripped)) return { label, slug };
  }
  return { label: stripped, slug: stripped };
}

const isConvention = (slug) => CONVENTION.has(slug);

module.exports = { sevOf, issueGroup, isConvention };
