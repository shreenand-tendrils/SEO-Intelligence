# Tendrils SEO Intelligence Platform

The existing Python SEO crawler (Flask + optional Playwright, Groq AI Consultant) turned into a full-stack app:
React dashboard → Node/Express API → PostgreSQL (Prisma), with the crawler running as an internal service.
The crawler's own UI, CLI and MCP server in `crawler/` still work standalone (see `crawler/README.md`).

```
React + Vite (frontend, :8080 Docker / :5173 dev)
   │ /api
   ▼
Node.js Express API (backend, :4000) ──Prisma──► PostgreSQL 16
   │ internal token
   ▼
Python crawler service (crawler, :5002) ──► Groq API
```

| Folder | What |
|---|---|
| `crawler/` | Original crawler, unchanged crawl engine; `service_api.py` adds the internal job API and Postgres-backed AI store |
| `backend/` | Express API, Prisma schema + migrations, scoring engines, ingest, compare, dashboard, legacy importer, tests |
| `frontend/` | React (JS), Zustand, React Router, Tailwind, Recharts, Lucide |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [Scoring](docs/SCORING.md), [API](docs/API.md), [Migration](docs/MIGRATION.md) |
| `docker-compose.yml` | postgres, crawler, backend, frontend (`docker-compose.dev.yml` publishes DB/API on localhost) |

## Run with Docker

```powershell
Copy-Item .env.example .env        # then edit POSTGRES_PASSWORD, INTERNAL_API_TOKEN, GROQ_API_KEY, GROQ_MODEL
docker compose up -d --build
docker compose ps                  # all four services should be "healthy"
Start-Process http://localhost:8080
```

| Command | Purpose |
|---|---|
| `docker compose logs -f backend crawler` | follow logs |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` | also expose Postgres `127.0.0.1:5432` and API `127.0.0.1:4000` |
| `docker compose build --build-arg INSTALL_PLAYWRIGHT=true crawler` | crawler image with Chromium for JS rendering (or set `INSTALL_PLAYWRIGHT=true` in `.env`) |
| `docker compose exec backend node src/scripts/importLegacy.js --dir /legacy --out /tmp/import-reports` | import old crawls (`LEGACY_DATA_DIR` in `.env`) |
| `docker compose exec backend node src/scripts/rescore.js` | recompute scores |
| `docker compose down` | stop (data kept in volume `pgdata`) |
| `docker compose down -v` | stop and delete the database volume |

Only the frontend port is published. Postgres, backend and crawler sit on an internal network; nginx proxies `/api` and returns 404 for `/internal`.

## Run locally on Windows (PowerShell, no Docker for the app)

Requirements: Node 22.13+, Python 3.10+, PostgreSQL 16 (or `docker run` below).

```powershell
# 1. PostgreSQL
docker run -d --name seo-pg -e POSTGRES_DB=seo -e POSTGRES_USER=seo -e POSTGRES_PASSWORD=seo -p 127.0.0.1:5432:5432 -v seo-pg-data:/var/lib/postgresql/data postgres:16-alpine

# 2. Backend (terminal 1)
cd backend
Copy-Item .env.example .env        # set INTERNAL_API_TOKEN
npm install
npx prisma migrate deploy
npm run dev                        # http://localhost:4000/api/health

# 3. Crawler (terminal 2)
cd crawler
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt    # optional JS rendering: pip install playwright; playwright install chromium
$env:BACKEND_INTERNAL_URL = "http://127.0.0.1:4000"
$env:INTERNAL_API_TOKEN   = "<same value as backend/.env>"
$env:GROQ_API_KEY         = "<your Groq key>"
$env:GROQ_MODEL           = "<model id>"
python app.py                      # :5002

# 4. Frontend (terminal 3)
cd frontend
npm install
npm run dev                        # http://localhost:5173

# 5. Import old crawls (optional)
cd backend; npm run import:legacy
```

Without `BACKEND_INTERNAL_URL` the crawler runs exactly as before (its own UI on :5002, JSON files, SQLite AI history).

## Tests

```powershell
# Original Python tests (crawler folder)
cd crawler
python .\test_crawl_throttle.py
python .\test_page_checks.py
python .\tests\test_groq_integration.py

# Node tests against a real PostgreSQL test database
docker exec seo-pg psql -U seo -c "CREATE DATABASE seo_test"
cd backend
$env:TEST_DATABASE_URL = "postgresql://seo:seo@localhost:5432/seo_test?schema=public"
npm test                           # scoring unit + API/persistence/import/1,500-page integration
npm run test:e2e                   # real Python crawler -> Node -> Postgres on the fixture site
cd ..\frontend; npm run build
```

## Check the data in PostgreSQL

```powershell
docker exec -it seo-pg psql -U seo -d seo          # Docker Compose: docker compose exec postgres psql -U seo -d seo
```
```sql
\dt
SELECT migration_name, finished_at FROM _prisma_migrations;
SELECT p.name, c.name, c.status, c."pagesCrawled", s.overall FROM "CrawlJob" c JOIN "Project" p ON p.id = c."projectId" LEFT JOIN "SeoScore" s ON s."crawlId" = c.id ORDER BY c."createdAt" DESC;
SELECT "crawlId", count(*) pages, round(avg("seoScore")) avg_score FROM "CrawledPage" GROUP BY 1;
SELECT severity, count(*) FROM "PageIssue" GROUP BY 1 ORDER BY 2 DESC;
SELECT key FROM "CrawlReport" WHERE "crawlId" = '<crawl id>';
SELECT count(*) FROM "AiConversation"; SELECT count(*) FROM "AiMessage";
SELECT "startedAt", "finishedAt", stats->>'crawls_imported' imported, stats->>'errors' errors FROM "ImportRun" ORDER BY "startedAt" DESC;
```

## Known limitations

- No login yet: single local user. `authStore` and route layout are ready for it; add it before exposing the app beyond a trusted network.
- JS rendering needs Playwright + Chromium (not in the default crawler image; build with `INSTALL_PLAYWRIGHT=true`).
- Crawl jobs live in the crawler process: restarting the crawler mid-crawl marks the crawl failed.
- Crawler rows are staged in PostgreSQL and scored when the crawl completes, so the dashboard updates at the end of a crawl (progress is live).
