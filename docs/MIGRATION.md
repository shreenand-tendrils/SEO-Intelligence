# Migrating existing crawl data to PostgreSQL

The original app stored everything under `~/.site-crawler-crawls/`:

| Source | Content | Imported into |
|---|---|---|
| `*.json` | one file per saved crawl: `results` (page rows), `inlinks`, `reports`, `seed`, `saved_at` | `Project`, `Website`, `CrawlJob` (`source=IMPORT`, `legacyFile`), `CrawledPage`, `PageIssue`, `SeoCategoryScore`, `CrawlInlink`, `CrawlReport`, `SeoScore` |
| `ai-conversations.db` (SQLite) | AI Consultant conversations + messages | `AiConversation`, `AiMessage` (linked to the imported crawl) |
| `crawl-titles.jsonl` | title history per crawl | `CrawlTitleHistory` |

## How it works

- Read-only: JSON/JSONL are only read; the SQLite DB (and its `-wal`) is copied to a temp dir and the copy is read, so the source folder is byte-for-byte unchanged.
- Idempotent: crawls are keyed by file name (`CrawlJob.legacyFile` unique), messages by `(conversationId, legacyId)`, titles by crawl + URL. Re-running imports nothing new. `--force` re-imports crawls.
- Each crawl is imported in one transaction and scored with the same engine as new crawls.
- One project per host; crawls of the same host are linked historically by `finishedAt` (taken from `saved_at`).
- Every run is recorded in `ImportRun` and writes `import-<timestamp>.json` + `.md` (log, errors, per-crawl verification: pages and inlinks source vs DB, reports, score).

## Run it

PowerShell (backend folder, Postgres running, `backend/.env` set):

```powershell
cd backend
npm run import:legacy                                      # default: $HOME\.site-crawler-crawls
npm run import:legacy -- --dir "C:\Users\you\.site-crawler-crawls" --out .\import-reports
```

Docker: set `LEGACY_DATA_DIR` in `.env` to the folder (mounted read-only at `/legacy`), then:

```powershell
docker compose exec backend node src/scripts/importLegacy.js --dir /legacy --out /tmp/import-reports
docker compose cp backend:/tmp/import-reports .\import-reports
```

After import, the app reads and writes PostgreSQL only. Keep the old folder until you have checked the report; nothing deletes it.

## Verified result (fixture data in `backend/test/fixtures/legacy`)

| Metric | First run | Second run |
|---|---|---|
| Crawl files | 2 imported | 2 skipped |
| Pages (source / DB) | 82 / 82 | no change |
| Inlinks (source / DB) | 308 / 308 | no change |
| Reports | 28 (14 per crawl) | no change |
| AI conversations / messages | 3 / 3 | 0 new |
| Title-history rows | 82 | 0 new |
| Verification failures / errors | 0 / 0 | 0 / 0 |
| Source file checksums | unchanged | unchanged |

This is covered by `backend/test/import.integration.test.js`.
