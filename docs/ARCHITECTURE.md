# Tendrils SEO Intelligence Platform: Architecture

## 1. Audit of the existing crawler (Phase 1)

| Area | Where | Notes |
|---|---|---|
| Flask app + routes | `crawler/app.py` (≈5.9k lines) | `/crawl` (SSE BFS crawl), `/crawl/save|list|load|delete|compare`, `/sitemap-analyse`, `/near-dup-content`, `/bot-check`, `/recrawl-url`, `/detect-cms`, `/fetch-robots-txt`, `/export-crawl-xlsx`, `/export-crawl-sitemap`, `/crawl/continue`, `/crawl/update-rules` |
| Crawl engine / workers | `crawl_site()` in app.py | thread pool (1-20 workers, 1 when JS rendering), per-host politeness, retry/back-off, `crawl_throttle.py` latency pacing, resume, page cap continue/finalize |
| Page audit | `_crawl_page()` + `page_checks.py` | returns one row dict per URL (`title`, `meta_description`, `h1_list`, `canonical*`, `indexable`, `redirect_*`, `security`, `og_tags`, `twitter_tags`, `hreflang`, `images_*`, `internal_link_urls`, `body_text`, `issues[]` …). Issues are plain strings. |
| Playwright | `PlaywrightRenderer`, `challenge_browser.py` | optional JS render, JS-vs-noJS diff, headed challenge fallback |
| Robots | `_build_robots_checker`, `_analyze_robots_txt` | wildcard-aware, AI/search-engine block detection |
| Sitemap | `/sitemap-analyse` | 7 sitemap sub-reports |
| Duplicates | in `crawl_site()` + `/near-dup-content` | exact dup title/meta/H1/body; shingle Jaccard near-dup |
| Bot readability | `/bot-check` | sample pages fetched as Googlebot/Bingbot/AI crawlers |
| Severity | `agent_tools.sev_of` / `sevOf` in script.js | regex → error/warn/info; `issue_group` maps to Summary cards |
| Full-crawl orchestration | `agent_tools.CrawlJob` | crawl → late issues → sitemap → near-dup → bot check → save (same as browser) |
| Groq AI | `groq_service.py`, `ai_routes.py`, `ai_context.py` | env-configured, JSON-mode validators that reject invented issues |
| Persistence (old) | `~/.site-crawler-crawls/*.json`, `ai-conversations.db` (SQLite), `crawl-titles.jsonl` | 30-day cleanup of JSON |
| Frontend (old) | `templates/index.html`, `static/script.js` (7.7k lines) | vanilla JS; builds inlinks; saves crawl JSON; localStorage for theme/settings |

Saved crawl JSON = `{name, saved_at, pages, seed, saved_by, results[], inlinks{}, reports{}}`.
`reports` holds the 13 report categories: `url_traps, response_codes, duplicate_titles, duplicate_metas, duplicate_h1s, duplicate_bodies, redirect_chains, orphans, sitemap_count, depth_distribution, sitemap, near_dup, bot_check` (+ `crawl_summary` from the MCP path).

### Old lifecycle
browser POST `/crawl` → SSE `page` events → browser builds inlinks, merges `late_issues` → browser calls sitemap / near-dup / bot-check → browser POSTs everything to `/crawl/save` → JSON file.

## 2. New architecture

```
React (Vite, Zustand, Tailwind, Recharts)  :8080 (nginx in Docker / Vite dev :5173)
        │  /api/*
        ▼
Node.js Express API (backend)  :4000 ──Prisma──► PostgreSQL :5432 (internal only)
        │  ▲
        │  │ /internal/* (X-Internal-Token)  ← crawler pushes progress, pages, reports;
        │  │                                    AI reads crawls + stores conversations
        ▼  │
Python crawler service (Flask, existing code) :5002 (internal only)
        │
        └──► Groq API (key only in crawler env)
```

* The **Python crawler is unchanged at its core**. `crawler/service_api.py` adds `/internal/jobs` which runs the existing `agent_tools.CrawlJob` pipeline (identical to the browser flow) in a thread. `RemoteCrawlJob` only overrides *where results go*: progress is POSTed to Node, rows are POSTed in chunks, then reports + inlinks + stop reason are POSTed to `/internal/crawls/:id/complete`. No JSON file is written.
* **Node is the only writer to PostgreSQL** (Prisma). On `complete` it computes page scores and the website score, writes issues, category scores, inlinks, reports, and title history in a transaction, then marks the crawl `COMPLETED`.
* **AI**: the existing Groq routes stay in Python (keys stay server-side in the crawler container). When `BACKEND_INTERNAL_URL` is set, `ai_routes` uses a loader that fetches the crawl (in the legacy shape plus scores and a previous-crawl comparison) from Node, and a `RemoteConversationStore` that persists conversations/messages through Node into Postgres. The public `/api/ai/*` endpoints on Node proxy to Python.
* Crawler and Postgres are on the internal Docker network only; only frontend (and optionally backend) publish ports.

### New lifecycle
1. UI → `POST /api/projects/:id/crawls` (settings validated) → `CrawlJob` row (QUEUED) → Node calls crawler `/internal/jobs`.
2. Crawler crawls (existing engine), runs SEO checks, late issues, sitemap, near-dup, bot check.
3. Progress → `/internal/crawls/:id/progress` (UI polls `GET /api/crawls/:id`).
4. Rows → `/internal/crawls/:id/pages` (chunks of 200), then `/internal/crawls/:id/complete`.
5. Node scores every page (`scoring/pageScore.js`) and the site (`scoring/siteScore.js`), persists everything in one transaction.
6. Dashboard / pages / page detail / reports / compare read only from Postgres.
7. AI Consultant → Node → Python Groq routes → Node internal export (Postgres) → Groq.
8. History: `POST /api/crawls/:id/compare` diffs two persisted crawls; stored in `CrawlComparison`.

## 3. Scoring (algorithm version `page-v1` / `site-v1`)
See `docs/SCORING.md` – generated from `backend/src/services/scoring/*`.

## 4. Internal API contract (crawler ⇄ backend)

Crawler → backend (header `X-Internal-Token`):
* `POST /internal/crawls/:id/progress` `{state, pages_crawled, queued, errors, messages[], elapsed_seconds, error}`
* `POST /internal/crawls/:id/pages` `{reset, offset, total, rows[]}` (chunks of 200 legacy rows)
* `POST /internal/crawls/:id/complete` `{name, total, inlinks, reports, stop_reason, stopped, messages}`
* `POST /internal/crawls/:id/fail` `{error, messages}`
* `GET /internal/crawls/:id/export` → legacy crawl dict `{name, saved_at, seed, results[] (+row.seo_score), inlinks, reports, seo_score{overall, version, components[], severity_counts, caps[], lowest_pages[], previous}, comparison_with_previous{previous_name, score_before, score_after, pages_before, pages_after, new_issues[], resolved_issues[], persistent_issues[]}}`
* `GET /internal/crawls` → `{crawls:[{file:id, name, saved_at, seed, pages}]}`
* `POST|GET|DELETE /internal/ai/conversations[/:id]`, `POST /internal/ai/conversations/:id/messages` (same fields as old SQLite store)

Backend → crawler: `POST /internal/jobs {crawl_id, settings}` (settings = `agent_tools.UI_DEFAULTS` keys), `POST /internal/jobs/:id/stop`, `GET /internal/health`, AI `/ai/*` (proxied), `/export-crawl-xlsx`, `/detect-cms`, `/fetch-robots-txt`.
