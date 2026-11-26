"""Internal service API: lets the Node.js backend drive the existing crawler.

The crawl itself is the existing pipeline in ``agent_tools.CrawlJob`` (crawl,
late issues, sitemap analysis, near-duplicates, bot readability), the same
steps the browser runs. ``RemoteCrawlJob`` changes only where the results go:
progress and results are POSTed to the backend's internal API, which persists
them in PostgreSQL through Prisma. Nothing here writes crawl JSON files.

Also provides the Node-backed loader and conversation store used by the Groq
AI routes when ``BACKEND_INTERNAL_URL`` is set.

Every route here requires the shared ``X-Internal-Token`` header when
``INTERNAL_API_TOKEN`` is set. The crawler port is not published in Docker.
"""
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

from flask import Blueprint, jsonify, request

import agent_tools as at

log = logging.getLogger('service')
bp = Blueprint('internal_service', __name__)

PAGE_CHUNK = int(os.environ.get('CRAWLER_PAGE_CHUNK', '200') or 200)
PROGRESS_EVERY = float(os.environ.get('CRAWLER_PROGRESS_SECONDS', '1.5') or 1.5)
JOBS = OrderedDict()


def backend_url():
    return (os.environ.get('BACKEND_INTERNAL_URL') or '').rstrip('/')


def enabled():
    return bool(backend_url())


def _token():
    return os.environ.get('INTERNAL_API_TOKEN') or ''


class BackendError(Exception):
    pass


def backend_call(method, path, body=None, timeout=60, retries=2):
    """JSON request to the Node backend's internal API, with a short retry."""
    url = backend_url() + path
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    headers = {'Accept': 'application/json', 'X-Internal-Token': _token()}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = ''
            try:
                detail = e.read().decode('utf-8', 'replace')[:300]
            except Exception:
                pass
            if e.code < 500:
                raise BackendError(f'{method} {path} -> HTTP {e.code} {detail}')
            last = BackendError(f'{method} {path} -> HTTP {e.code} {detail}')
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = BackendError(f'{method} {path} failed: {e}')
        time.sleep(0.5 * (attempt + 1))
    raise last


@bp.before_request
def _auth():
    tok = _token()
    if tok and request.headers.get('X-Internal-Token') != tok:
        return jsonify({'error': 'unauthorized'}), 401
    return None


# ── crawl jobs ────────────────────────────────────────────────────────────────

class RemoteCrawlJob(at.CrawlJob):
    """CrawlJob whose results land in the backend instead of a JSON file."""

    def __init__(self, crawl_id, opts):
        super().__init__(opts)
        self.remote_id = crawl_id
        self._last_push = 0.0

    def _push_progress(self, force=False):
        now = time.time()
        if not force and now - self._last_push < PROGRESS_EVERY:
            return
        self._last_push = now
        try:
            backend_call('POST', f'/internal/crawls/{self.remote_id}/progress', {
                'state': self.state,
                'pages_crawled': self.crawled or len(self.rows),
                'queued': self.queued,
                'errors': self.errors,
                'messages': [m for m in self.messages if m['type'] != 'state'][-10:],
                'elapsed_seconds': int(time.time() - self.started),
                'error': self.error or None,
            }, timeout=10, retries=0)
        except BackendError as e:
            log.warning('progress push failed: %s', e)

    def _note(self, kind, msg):
        super()._note(kind, msg)
        self._push_progress(force=(kind == 'state'))

    def _save(self):
        self.state = 'saving'
        self._push_progress(force=True)
        rows = self.rows
        total = len(rows)
        for i in range(0, total, PAGE_CHUNK):
            backend_call('POST', f'/internal/crawls/{self.remote_id}/pages', {
                'reset': i == 0, 'offset': i, 'total': total, 'rows': rows[i:i + PAGE_CHUNK],
            }, timeout=120)
        res = backend_call('POST', f'/internal/crawls/{self.remote_id}/complete', {
            'name': at.autosave_name(rows),
            'total': total,
            'inlinks': self.inlinks,
            'reports': self.reports,
            'stop_reason': self.stop_reason or None,
            'stopped': self.stopped,
            'messages': self.messages[-20:],
        }, timeout=600)
        self.saved_file = self.remote_id
        self.saved_name = res.get('name') or ''

    def run(self):
        super().run()
        if self.state == 'error':
            try:
                backend_call('POST', f'/internal/crawls/{self.remote_id}/fail',
                             {'error': self.error or 'crawl failed', 'messages': self.messages[-20:]}, timeout=20)
            except BackendError as e:
                log.warning('fail push failed: %s', e)
        return self


@bp.route('/internal/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'jobs_running': sum(1 for j in JOBS.values() if not j.finished),
                    'backend': enabled()})


@bp.route('/internal/jobs', methods=['POST'])
def start_job():
    body = request.get_json(silent=True) or {}
    crawl_id = str(body.get('crawl_id') or '').strip()
    if not crawl_id:
        return jsonify({'error': 'crawl_id is required'}), 400
    if not enabled():
        return jsonify({'error': 'BACKEND_INTERNAL_URL is not configured'}), 503
    try:
        job = RemoteCrawlJob(crawl_id, body.get('settings') or {})
    except at.ToolError as e:
        return jsonify({'error': str(e)}), 400
    JOBS[crawl_id] = job
    while len(JOBS) > 50:
        JOBS.popitem(last=False)
    threading.Thread(target=job.run, name=f'crawl-{crawl_id}', daemon=True).start()
    return jsonify({'ok': True, 'job': job.id, 'crawl_id': crawl_id, 'settings': job.opts}), 202


@bp.route('/internal/jobs/<crawl_id>', methods=['GET'])
def job_status(crawl_id):
    job = JOBS.get(crawl_id)
    if not job:
        return jsonify({'error': 'not found'}), 404
    return jsonify(job.status())


@bp.route('/internal/jobs/<crawl_id>/stop', methods=['POST'])
def job_stop(crawl_id):
    job = JOBS.get(crawl_id)
    if not job:
        return jsonify({'error': 'not found'}), 404
    job.stop()
    return jsonify({'ok': True, 'state': 'stopping'})


# ── AI: crawls and conversations through the backend ──────────────────────────

def remote_loader(crawl_ref):
    """Saved-crawl dict (legacy shape plus scores) for a crawl id, from Postgres."""
    if not crawl_ref or '/' in crawl_ref or '\\' in crawl_ref:
        return None
    try:
        return backend_call('GET', f'/internal/crawls/{urllib.parse.quote(crawl_ref)}/export', timeout=120)
    except BackendError as e:
        log.warning('crawl export failed: %s', e)
        return None


def remote_list_crawls():
    try:
        return backend_call('GET', '/internal/crawls', timeout=30).get('crawls') or []
    except BackendError as e:
        log.warning('crawl list failed: %s', e)
        return []


class RemoteConversationStore:
    """Same interface as ai_store.ConversationStore, persisted by the backend."""

    def create(self, kind, crawl_file, ref='', title=''):
        return backend_call('POST', '/internal/ai/conversations',
                            {'kind': kind, 'crawl_file': crawl_file or '', 'ref': ref or '',
                             'title': (title or '')[:120]})['id']

    def get(self, cid):
        try:
            return backend_call('GET', f'/internal/ai/conversations/{urllib.parse.quote(str(cid))}').get('conversation')
        except BackendError:
            return None

    def list(self, crawl_file=None, kind=None, limit=50):
        q = {k: v for k, v in (('crawl_file', crawl_file), ('kind', kind), ('limit', limit)) if v}
        return backend_call('GET', '/internal/ai/conversations?' + urllib.parse.urlencode(q)).get('conversations') or []

    def delete(self, cid):
        try:
            return bool(backend_call('DELETE', f'/internal/ai/conversations/{urllib.parse.quote(str(cid))}').get('ok'))
        except BackendError:
            return False

    def add_message(self, cid, role, content, structured=None, model=None,
                    prompt_tokens=None, completion_tokens=None):
        backend_call('POST', f'/internal/ai/conversations/{urllib.parse.quote(str(cid))}/messages',
                     {'role': role, 'content': content, 'structured': structured, 'model': model,
                      'prompt_tokens': prompt_tokens, 'completion_tokens': completion_tokens})

    def messages(self, cid, limit=None):
        out = backend_call('GET', f'/internal/ai/conversations/{urllib.parse.quote(str(cid))}').get('messages') or []
        return out[-limit:] if limit else out


def register(app):
    app.register_blueprint(bp)
