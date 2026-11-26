# Groq AI Integration: Setup and Reference

Groq is the **only** LLM provider in Tendrils SEO Crawler. The key lives in the backend `.env` file and is never sent to the browser, logs or API responses.

---

## Phase 1: Get a key and pick a model

1. Create an API key at <https://console.groq.com/keys>.
2. Pick a chat model id from <https://console.groq.com/docs/models>. Model ids change over time, so check that the id is current.
   - Larger models answer better but hit Groq's tokens-per-minute limits sooner on the free tier. If you see rate-limit or "too large" errors, try a smaller model or lower `GROQ_CONTEXT_TOKEN_BUDGET`.

## Phase 2: Configure the backend

1. In the project folder (next to `app.py`):
   ```bash
   cp .env.example .env
   ```
2. Edit `.env`:
   ```
   GROQ_API_KEY=gsk_your_real_key
   GROQ_MODEL=the-model-id-you-chose
   ```
3. Restart the app (`python3 app.py`, or restart the service). `.env` is read at startup.
4. To change the model later, edit `GROQ_MODEL` and restart. No code changes.

Real environment variables override `.env`, so a systemd unit or launchd plist can set them instead.

### Optional tuning (all in `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_TIMEOUT_SECONDS` | 45 | Per-attempt timeout |
| `GROQ_MAX_RETRIES` | 2 | Retries for rate limits, 5xx, timeouts, network errors |
| `GROQ_MAX_OUTPUT_TOKENS` | 1800 | Cap on the length of each AI reply |
| `GROQ_CONTEXT_TOKEN_BUDGET` | 5000 | How many tokens of crawl data to send with each request |
| `GROQ_MAX_RETRY_WAIT_SECONDS` | 20 | Longest rate-limit wait the app sits through before showing the error |

## Phase 3: Verify

1. Open the app and click **AI Consultant**.
2. The panel shows setup problems if the key or model is missing. Click **Test connection** to check the key and model against Groq without spending tokens.
3. Run **Summarise this website** on a loaded crawl.

You can also check from a terminal: `curl "http://localhost:5002/ai/status?verify=1"` (never prints the key).

## Phase 4: Use it

| Feature | Endpoint | UI |
|---|---|---|
| Chat (history kept) | `POST /ai/chat` | AI Consultant, Chat |
| Report summary | `POST /ai/summary` | Summary tab |
| Page explanation | `POST /ai/page` | Page dock, AI tab |
| Action plan | `POST /ai/plan` | Action plan tab |
| Issue prioritisation | `POST /ai/prioritize` | Priorities tab |
| Compare two crawls | `POST /ai/compare` | Compare tab |
| Historical analysis | `POST /ai/history` | History tab (needs 2+ saved crawls of the site) |
| Conversation history | `GET/DELETE /ai/conversations[/id]` | Chat resumes automatically |

The AI reads **saved crawls**. A finished crawl is auto-saved; if you use an unsaved crawl, the panel saves it first.

---

## How it works

**One service.** `groq_service.py` is the only code that talks to an LLM. It calls Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`) with `requests`, so no extra package is needed.

**Context per request.** `ai_context.py` builds a compact summary of the crawl and sends it with every message:
- Always: overview (counts, status codes, ranked issue groups with sample URLs, duplicates, sitemap gaps, bot readability, site sections, most impactful pages).
- On demand: full detail for a page or issue the question mentions.
- Large sites: only aggregates plus the top pages are sent. Detail steps down automatically until it fits `GROQ_CONTEXT_TOKEN_BUDGET`. The panel notes when a large crawl was condensed.
- If Groq reports a token-limit error, the request is retried once with half the budget.

**Conversation history.** Stored in SQLite at `~/.site-crawler-crawls/ai-conversations.db` (git-ignored). The crawler had no database before, so this file is new. Recent turns are replayed to the model within a token budget; older turns are reduced to a one-line digest.

**Structured results.** Summaries, page explanations, plans, prioritisation, comparison and history use Groq's JSON mode, then are validated. Issue names and page counts are checked against the crawl, and invented issues are dropped.

**Errors you may see**

| Message | Fix |
|---|---|
| Groq is not set up yet | Add `GROQ_API_KEY` and `GROQ_MODEL` to `.env`, restart |
| Groq rejected the API key | Create a new key, update `.env`, restart |
| The configured model is not available | Pick a current id from the Groq models page |
| Groq rate limit reached | Wait the time shown, or use a model/plan with higher limits |
| Too much data for one request | Lower `GROQ_CONTEXT_TOKEN_BUDGET` or use a larger-limit model |
| Groq took too long / could not reach Groq | Check connection; raise `GROQ_TIMEOUT_SECONDS` |
| The AI reply could not be used | Retry, or try another model |

There are no mock or canned answers. If Groq cannot answer, you get the error.

## Security notes

- `.env` is git-ignored (`.env.*` except `.env.example`) and excluded by `package_zip.py`.
- Crawled page text is untrusted. It is sanitised, wrapped in `<crawl_data>` tags, and the prompts tell the model never to follow instructions inside it. All model output is rendered as plain text in the browser.
- The AI routes sit behind the app's existing cross-site write protection.
- What is sent to Groq: crawl summaries and, for page questions, that page's title, headings, issues and a few inbound links. Do not use the AI features on crawls you are not allowed to share with Groq.

## Important: auto-update and the installers

The in-app **Update** button and the one-line installers pull from the original open-source repository (`puneetindersingh/open-seo-crawler`) and hard-reset the checkout to it. That would **remove this Groq integration**. Run this project from the ZIP (it has no `.git`, so Update refuses safely), or push it to your own repo and change the repo/remote used by the installers and `/version` before using auto-update.

## Tests

```bash
python3 tests/test_groq_integration.py
```

Runs offline against a local stand-in for Groq's API: configuration, key handling, retries, rate limits, token limits, timeouts, JSON repair, context budgets, history, and a scan that no key is present in the source tree.

## Packaging

```bash
python3 package_zip.py
```

Builds a ZIP that never contains `.env`, `.git`, virtual environments, caches or saved crawls, and fails if it finds anything shaped like a Groq key.
