# SEO scoring

Both scores are 0–100, computed in Node (`backend/src/services/scoring/`) from the crawler's real page rows and reports, stored with the algorithm version (`page-v1`, `site-v1`) and fully explained in the UI. `npm run rescore` recomputes stored crawls after an algorithm change.

## Page score (`page-v1`)

1. Every check gets a status: `pass` (full points), `partial` (fraction of points), `fail` (0), `unknown` (0; data the crawler could not inspect still counts in the denominator, so missing data never earns free points) or `na` (not applicable, e.g. image checks on a page without images; excluded from the denominator).
2. Category score = earned / possible × 100 over the applicable checks. A category with no applicable checks is `null` and is dropped.
3. Page score = weighted mean of the applicable categories, rounded:

| Category | Weight |
|---|---|
| Technical SEO | 30 |
| On-page SEO | 25 |
| Content quality | 15 |
| Internal linking | 10 |
| Images | 8 |
| International & social | 7 |
| Structured data | 5 |

4. Caps (applied after weighting, listed in the breakdown): HTTP error / fetch failure ≤ 15, soft 404 ≤ 30, noindex HTML page ≤ 60, redirect row ≤ 70. Non-HTML responses are not scored (`null`).
5. Every crawler issue string is mapped to the check that consumes it (severity from the original crawler's `sev_of` rules); duplicates are counted once; unmapped issues land in "Other crawler errors" so nothing is dropped.
6. Output per page: score, grade (Excellent ≥ 90, Good ≥ 75, Needs work ≥ 50, Poor), category scores, each check with points earned/possible, detail and fix, the top 8 deductions (by severity, then points lost), caps.

## Website score (`site-v1`)

Weighted mean of the components that have data (a component without data, e.g. no sitemap analysed, is dropped and the weights renormalise):

| Component | Weight | Formula (clamped 0–100; shares are fractions) |
|---|---|---|
| Page quality | 35 | 0.6 × mean page score + 0.4 × 25th-percentile page score |
| Technical health | 20 | 100 − 150·error share − 40·noindex share − 30·redirect-chain share − 30·non-HTTPS share |
| Site-wide metadata | 15 | 100 − 100·avg duplicate share (title, meta, H1) − 60·missing title − 40·missing meta − 30·missing H1 (indexable pages) |
| Content | 10 | 100 − 80·thin (< 200 words) − 100·exact-duplicate bodies − 50·near-duplicate pages |
| Internal linking & architecture | 10 | 100 − 60·sitemap orphans − 40·pages at depth ≥ 4 − 40·dead ends |
| Sitemap & robots.txt | 5 | 100 (50 without sitemap) − 100·bad sitemap URLs share (non-200, redirects, non-indexable) − 30 if soft-404 / URL trap |
| Bot readability | 5 | 100 − 100·share of sampled pages with a crawler-specific finding |

Caps: search engines blocked in robots.txt ≤ 30, start page failed ≤ 20, more than half the URLs are errors ≤ 40.

The result also stores severity counts, page stats, score distribution inputs, the lowest/highest pages and a plain-text explanation. The fixture site (41 pages) scores 58.

## Page checks (generated from the engine)

| Category | Check | Points | Severity when failing |
|---|---|---|---|
| Technical SEO | HTTP status | 10 | CRITICAL |
| Technical SEO | Indexability | 8 | HIGH |
| Technical SEO | Canonical tag | 5 | MEDIUM |
| Technical SEO | HTTPS | 4 | HIGH |
| Technical SEO | Mixed content | 2 | HIGH |
| Technical SEO | Redirect handling | 3 | MEDIUM |
| Technical SEO | Robots directives | 3 | HIGH |
| Technical SEO | Response time | 3 | LOW |
| Technical SEO | Security headers | 2 | LOW |
| Technical SEO | Soft 404 | 3 | CRITICAL |
| Technical SEO | Other crawler errors | 3 | HIGH |
| On-page SEO | Title present | 8 | CRITICAL |
| On-page SEO | Title length | 3 | LOW |
| On-page SEO | Meta description present | 5 | HIGH |
| On-page SEO | Meta description length | 2 | LOW |
| On-page SEO | H1 present | 5 | HIGH |
| On-page SEO | H1 usage | 2 | MEDIUM |
| On-page SEO | Heading structure | 2 | LOW |
| On-page SEO | Unique metadata | 4 | MEDIUM |
| On-page SEO | Mobile viewport | 2 | MEDIUM |
| On-page SEO | URL structure | 2 | LOW |
| Content quality | Content available | 4 | HIGH |
| Content quality | Content depth | 5 | MEDIUM |
| Content quality | Unique content | 4 | HIGH |
| Content quality | Readability | 2 | LOW |
| Images | Alt attributes | 5 | MEDIUM |
| Images | Alt on content images | 2 | LOW |
| Images | Image dimensions | 1 | LOW |
| Internal linking | Internal outlinks | 4 | MEDIUM |
| Internal linking | Broken internal links | 3 | HIGH |
| Internal linking | Link hygiene | 1 | LOW |
| Internal linking | Internal inlinks | 4 | MEDIUM |
| Structured data | Schema markup | 5 | LOW |
| Structured data | Schema validity | 0 | INFO |
| International & social | Open Graph | 3 | LOW |
| International & social | Twitter card | 2 | INFO |
| International & social | Hreflang | 2 | MEDIUM |
