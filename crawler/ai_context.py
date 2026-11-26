"""Turns saved crawls into compact, token-budgeted context for the Groq prompts.

Nothing here calls a model. It decides *what the model gets to see*:

  * Tier 1, always sent: crawl overview. Counts, status codes, the ranked issue
    groups per severity with a few sample URLs, duplicates, sitemap gaps, bot
    readability, site sections, and the most impactful pages.
  * Tier 2, on demand: one page in full (details, issues, top inlinks), or the
    affected URLs of the issues a question mentions.
  * Large crawls: everything is aggregated (issue groups, site sections) and
    only the top-N pages are listed. The detail level steps down until the
    context fits GROQ_CONTEXT_TOKEN_BUDGET, and `meta` reports what was cut.

Crawled titles, headings and URLs are untrusted text from third-party sites,
so every value is sanitised and the prompts tell the model to treat the block
as data, never as instructions.
"""
import re
from collections import OrderedDict
from urllib.parse import urlparse

import agent_tools as at
from groq_service import estimate_tokens

_CTRL_RE = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')
_WS_RE = re.compile(r'\s+')
_TAG_RE = re.compile(r'</?\s*crawl_data[^>]*>', re.I)
_URL_RE = re.compile(r'https?://[^\s<>"\')\]]+')

# (issue groups per severity, sample URLs per group, top pages, site sections)
LEVELS = [
    (14, 3, 20, 10),
    (10, 2, 12, 8),
    (7, 1, 8, 6),
    (5, 1, 4, 4),
    (3, 0, 0, 3),
]


def clean(value, limit=160):
    """One-line, length-capped, control-character-free text safe to embed."""
    if value is None:
        return ''
    text = _TAG_RE.sub('', str(value))
    text = _WS_RE.sub(' ', _CTRL_RE.sub(' ', text)).strip()
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _short_url(url, host=None):
    url = clean(url, 200)
    if host and url.startswith(('https://' + host, 'http://' + host)):
        rest = url.split(host, 1)[1]
        return rest or '/'
    return url


def _host(rows):
    return at._host((rows[0] if rows else {}).get('url')) if rows else ''


def _section(url):
    path = urlparse(url or '').path or '/'
    parts = [p for p in path.split('/') if p]
    if not parts:
        return '/'
    return '/' + parts[0] + ('/' if len(parts) > 1 else '')


def _row_severity_counts(row):
    e = w = 0
    for issue in row.get('issues') or []:
        sev = at.sev_of(issue)
        if sev == 'error':
            e += 1
        elif sev == 'warn':
            w += 1
    if (row.get('status_code') or 0) >= 400:
        e += 1
    return e, w


# --------------------------------------------------------------------------
# Crawl loading
# --------------------------------------------------------------------------
class CrawlNotFound(Exception):
    pass


def load_crawl(loader, crawl_file):
    """`loader(file)` returns the saved-crawl dict or None. Adds 'file'."""
    data = loader(crawl_file)
    if not data:
        raise CrawlNotFound(f'The saved crawl "{crawl_file}" was not found. Saved crawls are kept for '
                            '30 days; load or run a crawl and try again.')
    data = dict(data)
    data['file'] = crawl_file
    data.setdefault('results', [])
    data.setdefault('inlinks', {})
    data.setdefault('reports', {})
    if not data['results']:
        raise CrawlNotFound('That saved crawl has no pages.')
    return data


# --------------------------------------------------------------------------
# Tier 1: overview
# --------------------------------------------------------------------------
def known_issue_labels(crawl):
    """Exact issue-group names present in this crawl (used to reject invented ones)."""
    return {g['issue'] for g in at._groups(crawl.get('results') or []).values()}


def _overview_text(crawl, level):
    n_issues, n_samples, n_pages, n_sections = level
    rows = crawl['results']
    host = _host(rows)
    summary = at.summary_from_crawl(crawl, sample_urls=max(n_samples, 0))
    lines = []
    lines.append(f"SITE: {host} | crawl: {clean(crawl.get('name'), 80)} | pages crawled: {summary['pages']} | "
                 f"indexable 200s: {summary['indexable_200']} | avg response: {summary['avg_response_seconds']}s | "
                 f"max depth: {summary['max_depth']}")
    lines.append('STATUS CODES: ' + ', '.join(f'{k}:{v}' for k, v in sorted(summary['status_codes'].items())))
    site = crawl.get('seo_score')
    if isinstance(site, dict) and site.get('overall') is not None:
        comps = '; '.join(f"{clean(c.get('label'), 40)} {c.get('score')}" for c in (site.get('components') or [])
                          if c.get('score') is not None)
        sevs = site.get('severity_counts') or {}
        lines.append(f"WEBSITE SEO SCORE ({clean(site.get('version'), 20)}): {site.get('overall')}/100"
                     + (f" (previous crawl {site.get('previous')})" if site.get('previous') is not None else '')
                     + f" | components: {comps} | issues critical {sevs.get('critical', 0)}, high {sevs.get('high', 0)}, "
                     f"medium {sevs.get('medium', 0)}, low {sevs.get('low', 0)}")
        if site.get('caps'):
            lines.append('SCORE CAPS APPLIED: ' + '; '.join(clean(c, 120) for c in site['caps'][:4]))
        if n_pages and site.get('lowest_pages'):
            lines.append('LOWEST-SCORING PAGES (url | score): ' + '; '.join(
                f"{_short_url(p.get('url'), host)} {p.get('score')}" for p in site['lowest_pages'][:n_pages]))
    cmp_ = crawl.get('comparison_with_previous')
    if isinstance(cmp_, dict):
        def _names(key):
            return ', '.join(f"{clean(g.get('issue'), 60)} ({g.get('pages')})" for g in (cmp_.get(key) or [])[:8]) or 'none'
        lines.append(f"VS PREVIOUS CRAWL ({clean(cmp_.get('previous_name'), 60)}): score {cmp_.get('score_before')} -> "
                     f"{cmp_.get('score_after')} | pages {cmp_.get('pages_before')} -> {cmp_.get('pages_after')}")
        lines.append(f"NEW ISSUES: {_names('new_issues')} | RESOLVED: {_names('resolved_issues')} | "
                     f"PERSISTENT (top): {_names('persistent_issues')}")
    pw = summary['pages_with']
    lines.append(f"PAGES AFFECTED: {pw['errors']} with errors, {pw['warnings']} with warnings, {pw['info']} with notices")
    for label, key in (('ERRORS', 'errors'), ('WARNINGS', 'warnings'), ('NOTICES', 'info')):
        groups = summary[key]
        if not groups:
            continue
        lines.append(f'{label} (issue | pages affected | priority score 0-1.4 | examples):')
        for g in groups[:n_issues]:
            ex = ''
            if n_samples and g.get('sample'):
                ex = ' | ' + ', '.join(_short_url(s['url'], host) for s in g['sample'][:n_samples])
            conv = ' [convention, not a Google rule]' if g.get('convention') else ''
            lines.append(f"- {clean(g['issue'], 90)} | {g['pages']} | {g['score']}{conv}{ex}")
        if len(groups) > n_issues:
            lines.append(f'- (+{len(groups) - n_issues} more {label.lower()} groups not shown)')
    dup = summary.get('duplicates') or {}
    if any(dup.values()) or summary.get('redirect_chains'):
        lines.append('DUPLICATES/REDIRECTS: ' + ', '.join(f'{k.replace("duplicate_", "dup ")}={v}' for k, v in dup.items() if v)
                     + (f", redirect chains={summary['redirect_chains']}" if summary.get('redirect_chains') else ''))
    if summary.get('near_duplicate_pairs'):
        lines.append(f"NEAR-DUPLICATE PAIRS: {summary['near_duplicate_pairs']}")
    if summary.get('url_traps'):
        t = summary['url_traps']
        lines.append(f"URL TRAPS: root soft-404={t['root_soft_404']}, infinite URL space={t['infinite_url_space']}")
    sm = summary.get('sitemap')
    if sm:
        counts = ', '.join(f'{k}={v}' for k, v in (sm.get('counts') or {}).items() if v)
        lines.append('SITEMAP: ' + (counts or 'no gaps found'))
    bots = summary.get('bot_check')
    if bots:
        per = '; '.join(f"{k}: {', '.join(f'{c} {n}' for c, n in (v.get('counts') or {}).items())}"
                        for k, v in list((bots.get('by_crawler') or {}).items())[:8])
        lines.append(f"BOT READABILITY (sample of {bots.get('sample_pages')} pages): {per}")

    # Site sections: lets the model reason about a big site without seeing every page.
    sections = OrderedDict()
    for r in rows:
        s = sections.setdefault(_section(r.get('url')), [0, 0])
        s[0] += 1
        if _row_severity_counts(r)[0]:
            s[1] += 1
    top = sorted(sections.items(), key=lambda kv: -kv[1][0])[:n_sections]
    if len(sections) > 1:
        lines.append('SITE SECTIONS (path | pages | pages with errors): ' +
                     '; '.join(f'{clean(k, 40)} {v[0]}/{v[1]}' for k, v in top) +
                     (f' (+{len(sections) - len(top)} smaller sections)' if len(sections) > len(top) else ''))

    if n_pages:
        weights = at.page_weights(rows, crawl.get('inlinks') or {})
        ranked = []
        for r in rows:
            e, w = _row_severity_counts(r)
            if not (e or w):
                continue
            ranked.append(((e * 3 + w) * (0.5 + weights.get(r.get('url'), 0)), r, e, w))
        ranked.sort(key=lambda t: -t[0])
        if ranked:
            lines.append(f'MOST IMPACTFUL PAGES (url | status | depth | errors/warnings | words | first issues):')
            for _, r, e, w in ranked[:n_pages]:
                first = '; '.join(clean(i, 60) for i in (r.get('issues') or [])[:3])
                lines.append(f"- {_short_url(r.get('url'), host)} | {r.get('status_code')} | d{r.get('depth')} | "
                             f"{e}/{w} | {r.get('word_count')} | {first}")
    return '\n'.join(lines)


def build_overview(crawl, budget_tokens):
    """Largest overview that fits the budget. Returns (text, meta)."""
    total = len(crawl['results'])
    chosen = None
    for idx, level in enumerate(LEVELS):
        text = _overview_text(crawl, level)
        chosen = (text, idx, level)
        if estimate_tokens(text) <= budget_tokens:
            break
    text, idx, level = chosen
    meta = {
        'pages_total': total,
        'detail_level': idx + 1,
        'detail_levels': len(LEVELS),
        'top_pages_listed': level[2],
        'condensed': idx > 0,
        'tokens_estimate': estimate_tokens(text),
    }
    return text, meta


# --------------------------------------------------------------------------
# Tier 2: one page, or a few issues in detail
# --------------------------------------------------------------------------
def find_row(crawl, url):
    want = (url or '').strip().rstrip('/').lower()
    if not want:
        return None
    for r in crawl['results']:
        if (r.get('url') or '').rstrip('/').lower() == want or \
                (r.get('original_url') or '').rstrip('/').lower() == want:
            return r
    return None


def page_block(crawl, row, max_inlinks=6):
    host = _host(crawl['results'])
    inl = crawl.get('inlinks') or {}
    links = inl.get(row.get('original_url') or row.get('url')) or inl.get(row.get('url')) or []
    lines = [f"PAGE: {clean(row.get('url'), 220)}"]
    fields = (
        ('status', row.get('status_code')), ('indexable', row.get('indexable')), ('depth', row.get('depth')),
        ('response_seconds', row.get('response_time')), ('words', row.get('word_count')),
        ('internal_links_out', row.get('internal_links')), ('external_links_out', row.get('external_links')),
        ('images_total', row.get('images_total')), ('images_missing_alt', row.get('images_no_alt')),
        ('canonical', clean(row.get('canonical'), 200) or None), ('canonical_kind', row.get('canonical_kind')),
        ('redirects_to', clean(row.get('redirect_url'), 200) or None), ('schema', ', '.join(row.get('schema_types') or []) or None),
    )
    lines.append(' | '.join(f'{k}: {v}' for k, v in fields if v not in (None, '', [])))
    lines.append(f"TITLE ({row.get('title_len')} chars): {clean(row.get('title'), 200) or '(missing)'}")
    lines.append(f"META DESCRIPTION ({row.get('meta_len')} chars): {clean(row.get('meta_description'), 320) or '(missing)'}")
    lines.append(f"H1: {clean(row.get('h1'), 200) or '(missing)'}")
    h2 = [clean(x, 80) for x in (row.get('h2_list') or [])[:8]]
    if h2:
        lines.append('H2s: ' + ' | '.join(h2))
    og = row.get('og_tags') or {}
    if og:
        lines.append('OPEN GRAPH: ' + ', '.join(f'{clean(k, 20)}' for k in list(og)[:8]))
    sc = row.get('seo_score')
    if isinstance(sc, dict) and sc.get('score') is not None:
        cats = '; '.join(f"{clean(c.get('label'), 30)} {c.get('score')}" for c in (sc.get('categories') or [])
                         if c.get('score') is not None)
        lines.append(f"SEO SCORE ({clean(sc.get('version'), 20)}): {sc.get('score')}/100 | {cats}")
        top = '; '.join(f"[{clean(f.get('severity'), 10)}] {clean(f.get('label'), 90)}" for f in (sc.get('top_issues') or [])[:6])
        if top:
            lines.append('TOP SCORE DEDUCTIONS: ' + top)
    issues = row.get('issues') or []
    lines.append('ISSUES: ' + ('; '.join(f'[{at.sev_of(i)}] {clean(i, 140)}' for i in issues[:25]) or 'none flagged'))
    lines.append(f'INLINKS: {len(links)} internal pages link here')
    for e in links[:max_inlinks]:
        anchor = f' anchor "{clean(e.get("anchor"), 50)}"' if e.get('anchor') else ''
        lines.append(f"- from {_short_url(e.get('source'), host)}{anchor}")
    return '\n'.join(lines)


def issue_block(crawl, labels, per_issue=25):
    """Affected URLs for the named issue groups."""
    host = _host(crawl['results'])
    groups = at._groups(crawl['results'])
    lines = []
    for label in labels:
        g = groups.get(label)
        if not g:
            continue
        lines.append(f"ISSUE DETAIL: {label} [{g['severity']}] on {len(g['pages'])} pages")
        for u, detail in list(g['pages'].items())[:per_issue]:
            lines.append(f"- {_short_url(u, host)}" + (f' ({clean(detail, 90)})' if detail else ''))
        if len(g['pages']) > per_issue:
            lines.append(f"- (+{len(g['pages']) - per_issue} more)")
    return '\n'.join(lines)


def issues_mentioned(crawl, question, limit=3):
    """Issue-group names a question refers to (simple, deterministic matching)."""
    q = (question or '').lower()
    if not q:
        return []
    hits = []
    for label in known_issue_labels(crawl):
        words = [w for w in re.split(r'\W+', label.lower()) if len(w) > 2 and w not in ('the', 'and', 'too', 'not')]
        if label.lower() in q or (len(words) >= 2 and all(w in q for w in words[:3])):
            hits.append(label)
    return hits[:limit]


def urls_mentioned(crawl, question, limit=2):
    out = []
    for m in _URL_RE.findall(question or ''):
        row = find_row(crawl, m.rstrip('.,;'))
        if row and row not in out:
            out.append(row)
    return out[:limit]


def build_chat_context(crawl, question, budget_tokens, focus_url=None):
    """Overview plus whatever detail the question calls for, inside the budget.
    Returns (text, meta)."""
    extras = []
    rows = []
    if focus_url:
        r = find_row(crawl, focus_url)
        if r:
            rows.append(r)
    for r in urls_mentioned(crawl, question):
        if r not in rows:
            rows.append(r)
    for r in rows[:2]:
        extras.append(page_block(crawl, r))
    labels = issues_mentioned(crawl, question)
    if labels:
        extras.append(issue_block(crawl, labels, per_issue=20))
    extra_text = '\n\n'.join(extras)
    extra_tokens = estimate_tokens(extra_text)
    overview_budget = max(1200, budget_tokens - extra_tokens)
    overview, meta = build_overview(crawl, overview_budget)
    if extra_tokens > budget_tokens - 1200:
        # Detail alone would crowd out the overview: trim it, keep the overview whole.
        keep = max(0, (budget_tokens - meta['tokens_estimate']) * 3)
        extra_text = extra_text[:keep]
    meta['focus_pages'] = [clean(r.get('url'), 200) for r in rows[:2]]
    meta['focus_issues'] = labels
    return overview + (('\n\n' + extra_text) if extra_text else ''), meta


# --------------------------------------------------------------------------
# Comparison and history
# --------------------------------------------------------------------------
def _issue_counts(crawl):
    return {g['issue']: (g['severity'], len(g['pages'])) for g in at._groups(crawl['results']).values()}


def _aggregate(crawl):
    s = at.summary_from_crawl(crawl, sample_urls=0)
    return {
        'pages': s['pages'], 'indexable_200': s['indexable_200'], 'avg_response_seconds': s['avg_response_seconds'],
        'status_codes': s['status_codes'], 'pages_with_errors': s['pages_with']['errors'],
        'pages_with_warnings': s['pages_with']['warnings'],
    }


def build_compare_context(a, b, budget_tokens):
    """Compact diff of two crawls: aggregates, issue deltas, URL changes."""
    host = _host(b['results']) or _host(a['results'])
    lines = [f"SITE: {host}",
             f"BEFORE: {clean(a.get('name'), 80)} (saved {a.get('saved_at')})  {_aggregate(a)}",
             f"AFTER:  {clean(b.get('name'), 80)} (saved {b.get('saved_at')})  {_aggregate(b)}"]
    ia, ib = _issue_counts(a), _issue_counts(b)
    rows = []
    for label in set(ia) | set(ib):
        sev = (ib.get(label) or ia.get(label))[0]
        na, nb = (ia.get(label) or (sev, 0))[1], (ib.get(label) or (sev, 0))[1]
        if na != nb:
            rows.append((abs(nb - na) * (3 if sev == 'error' else 1), label, sev, na, nb))
    rows.sort(reverse=True)
    lines.append('ISSUE CHANGES (issue | severity | before -> after pages):')
    for _, label, sev, na, nb in rows[:25]:
        lines.append(f'- {clean(label, 90)} | {sev} | {na} -> {nb}')
    if not rows:
        lines.append('- no change in any issue count')
    a_urls = {(r.get('url') or '').rstrip('/').lower(): r for r in a['results']}
    b_urls = {(r.get('url') or '').rstrip('/').lower(): r for r in b['results']}
    added = [k for k in b_urls if k not in a_urls]
    removed = [k for k in a_urls if k not in b_urls]
    lines.append(f'URLS ADDED: {len(added)}; REMOVED: {len(removed)}')
    for tag, keys, src in (('added', added, b_urls), ('removed', removed, a_urls)):
        for k in keys[:8]:
            lines.append(f"- {tag}: {_short_url(src[k].get('url'), host)} ({src[k].get('status_code')})")
    changes = {'status_code': 0, 'title': 0, 'meta_description': 0, 'h1': 0, 'canonical': 0, 'indexable': 0, 'word_count': 0}
    status_flips = []
    for k in set(a_urls) & set(b_urls):
        ra, rb = a_urls[k], b_urls[k]
        for f in changes:
            if (ra.get(f) or '') != (rb.get(f) or ''):
                changes[f] += 1
        if (ra.get('status_code') or 0) != (rb.get('status_code') or 0) and len(status_flips) < 10:
            status_flips.append(f"{_short_url(rb.get('url'), host)} {ra.get('status_code')}->{rb.get('status_code')}")
    lines.append('PAGES WHOSE FIELD CHANGED: ' + ', '.join(f'{k}={v}' for k, v in changes.items() if v))
    if status_flips:
        lines.append('STATUS CHANGES: ' + '; '.join(status_flips))
    text = '\n'.join(lines)
    if estimate_tokens(text) > budget_tokens:
        text = text[:budget_tokens * 3] + '\n(context trimmed to fit the token budget)'
    return text, {'condensed': estimate_tokens(text) >= budget_tokens, 'tokens_estimate': estimate_tokens(text)}


def build_history_context(crawls, budget_tokens):
    """Trend across several crawls of one site, oldest first."""
    crawls = sorted(crawls, key=lambda c: c.get('saved_at') or 0)
    host = _host(crawls[-1]['results'])
    lines = [f'SITE: {host} | crawls analysed: {len(crawls)} (oldest to newest)']
    counts = [_issue_counts(c) for c in crawls]
    for c, ic in zip(crawls, counts):
        agg = _aggregate(c)
        sc = agg['status_codes']
        bad = sum(v for k, v in sc.items() if str(k).startswith(('4', '5')))
        lines.append(f"- {c.get('saved_at')} | {clean(c.get('name'), 60)} | pages {agg['pages']} | 4xx/5xx {bad} | "
                     f"pages with errors {agg['pages_with_errors']} | with warnings {agg['pages_with_warnings']} | "
                     f"avg resp {agg['avg_response_seconds']}s")
    first, last = counts[0], counts[-1]
    rows = []
    for label in set(first) | set(last):
        sev = (last.get(label) or first.get(label))[0]
        na, nb = (first.get(label) or (sev, 0))[1], (last.get(label) or (sev, 0))[1]
        if na != nb:
            series = [str((ic.get(label) or (sev, 0))[1]) for ic in counts]
            rows.append((abs(nb - na) * (3 if sev == 'error' else 1), label, sev, series))
    rows.sort(reverse=True)
    lines.append('ISSUE TRENDS (issue | severity | pages per crawl, oldest to newest):')
    for _, label, sev, series in rows[:20]:
        lines.append(f"- {clean(label, 90)} | {sev} | {' -> '.join(series)}")
    if not rows:
        lines.append('- issue counts did not change across these crawls')
    text = '\n'.join(lines)
    if estimate_tokens(text) > budget_tokens:
        text = text[:budget_tokens * 3] + '\n(context trimmed to fit the token budget)'
    return text, {'crawls': len(crawls), 'tokens_estimate': estimate_tokens(text)}


# --------------------------------------------------------------------------
# Conversation history trimming
# --------------------------------------------------------------------------
def trim_history(messages, budget_tokens):
    """Keep the newest turns that fit. Older turns collapse into one
    deterministic line (no extra model call, so no extra tokens or cost)."""
    kept, used = [], 0
    for m in reversed(messages):
        cost = estimate_tokens(m['content']) + 4
        if used + cost > budget_tokens and kept:
            break
        kept.append(m)
        used += cost
    kept.reverse()
    dropped = messages[:len(messages) - len(kept)]
    digest = None
    if dropped:
        asked = [clean(m['content'], 70) for m in dropped if m['role'] == 'user'][-6:]
        digest = ('Earlier in this conversation (older messages not shown) the user asked about: ' +
                  ('; '.join(asked) if asked else 'various topics') + '.')
    return kept, digest
