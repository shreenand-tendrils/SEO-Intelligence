# HTTP API

All public routes are under `/api`. Responses: `{ "data": ..., "meta"?: {...} }`; errors: `{ "error": { "code", "message", "details"? } }`.
List endpoints accept `page` and `pageSize` (max 500) and return `meta: { page, pageSize, total, totalPages }`.

## Public (browser → Node)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | API, database and crawler status |
| GET/POST | `/api/projects` | list (`q` search) / create `{ name, seedUrl?, description? }` |
| GET/PATCH/DELETE | `/api/projects/:id` | |
| POST | `/api/projects/:id/crawls` | start crawl; body = crawler settings (`max_pages`, `max_depth`, `max_workers`, `crawl_delay`, `render_js`, `compare_no_js`, `user_agent`, `include_patterns`, `exclude_patterns`, `ignore_robots`, `ignore_noindex`, `solve_challenges`, `sitemap`, `near_dup`, `bot_check`, …). 409 if one is running |
| GET | `/api/projects/:id/crawls` | crawl history |
| GET | `/api/projects/:id/dashboard` | KPIs, score + components, distributions, top/critical issues, lowest/highest pages, changes vs previous crawl, history |
| GET | `/api/projects/:id/score-history` | site score per completed crawl |
| GET/DELETE | `/api/crawls/:id` | status/progress / delete |
| POST | `/api/crawls/:id/stop` | |
| GET | `/api/crawls/:id/pages` | `search`, `status` (2xx…5xx, error), `indexable`, `issue`, `severity`, `sort` (score, url, status, issues, title, words, depth, inlinks, response), `order` |
| GET | `/api/crawls/:id/issues` | issue → severity, category, pages affected |
| GET | `/api/crawls/:id/reports` | all crawler reports by key |
| GET | `/api/crawls/:id/scores` | site score + aggregates |
| GET | `/api/crawls/:id/inlinks` | `target` filter |
| POST | `/api/crawls/:id/compare` | `{ otherCrawlId? }` (default: previous crawl); cached per algorithm version |
| GET | `/api/crawls/:id/export.xlsx` | original XLSX export |
| GET | `/api/pages/:id`, `/issues`, `/score` | page detail, issues, score breakdown |
| GET | `/api/ai/status` | Groq configured? (never returns the key) |
| POST | `/api/ai/chat` `{ crawlId, message, conversationId?, url? }` | AI Consultant chat |
| POST | `/api/ai/summary`, `/plan`, `/prioritize`, `/page`, `/compare`, `/history` | structured AI actions `{ crawlId, url?, otherCrawlId? }` |
| GET/DELETE | `/api/ai/conversations[/:id]` | stored conversations (`crawlId` filter) |

AI routes are rate limited separately (`AI_RATE_LIMIT_PER_MINUTE`, default 20).

## Internal (Docker network only; header `X-Internal-Token`)

Crawler → Node: `POST /internal/crawls/:id/progress|pages|complete|fail`, `GET /internal/crawls`, `GET /internal/crawls/:id/export`, `/internal/ai/conversations…` (AI store).
Node → crawler: `GET /internal/health`, `POST /internal/jobs`, `GET /internal/jobs/:id`, `POST /internal/jobs/:id/stop`.
nginx returns 404 for `/internal` and does not publish the backend or crawler ports.
