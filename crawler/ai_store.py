"""Conversation history for the AI features, kept in a local SQLite file.

The crawler had no database (saved crawls are JSON files), so this adds one
using the standard library only. The file lives beside the saved crawls
(~/.site-crawler-crawls/ai-conversations.db), which .gitignore already
excludes (`*.db`). It holds chat text and AI results, never credentials.
"""
import json
import os
import sqlite3
import threading
import time
import uuid

DB_NAME = 'ai-conversations.db'
_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,           -- chat | summary | page | plan | prioritize | compare | history
    crawl_file  TEXT NOT NULL,           -- saved crawl file this talks about ('' for site-wide history)
    ref         TEXT NOT NULL DEFAULT '',-- page URL, second crawl file, or site host
    title       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_crawl ON conversations(crawl_file, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,           -- user | assistant
    content     TEXT NOT NULL,
    structured  TEXT,                    -- JSON for structured assistant replies
    model       TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
"""


def default_path():
    return os.path.join(os.path.expanduser('~/.site-crawler-crawls'), DB_NAME)


class ConversationStore:
    def __init__(self, path=None):
        self.path = path or default_path()
        self._ready = False

    def _connect(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        if not self._ready:
            with _LOCK:
                conn.execute('PRAGMA journal_mode = WAL')
                conn.executescript(SCHEMA)
                conn.commit()
                self._ready = True
        return conn

    # ---- conversations --------------------------------------------------
    def create(self, kind, crawl_file, ref='', title=''):
        cid = uuid.uuid4().hex[:16]
        now = int(time.time())
        conn = self._connect()
        try:
            conn.execute('INSERT INTO conversations(id, kind, crawl_file, ref, title, created_at, updated_at) '
                         'VALUES (?,?,?,?,?,?,?)', (cid, kind, crawl_file or '', ref or '', (title or '')[:120], now, now))
            conn.commit()
        finally:
            conn.close()
        return cid

    def get(self, cid):
        conn = self._connect()
        try:
            row = conn.execute('SELECT * FROM conversations WHERE id = ?', (cid,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list(self, crawl_file=None, kind=None, limit=50):
        sql, args = 'SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages ' \
                    'FROM conversations c WHERE 1=1', []
        if crawl_file:
            sql += ' AND c.crawl_file = ?'
            args.append(crawl_file)
        if kind:
            sql += ' AND c.kind = ?'
            args.append(kind)
        sql += ' ORDER BY c.updated_at DESC LIMIT ?'
        args.append(int(limit))
        conn = self._connect()
        try:
            return [dict(r) for r in conn.execute(sql, args).fetchall()]
        finally:
            conn.close()

    def delete(self, cid):
        conn = self._connect()
        try:
            n = conn.execute('DELETE FROM conversations WHERE id = ?', (cid,)).rowcount
            conn.commit()
            return n > 0
        finally:
            conn.close()

    # ---- messages ---------------------------------------------------------
    def add_message(self, cid, role, content, structured=None, model=None,
                    prompt_tokens=None, completion_tokens=None):
        now = int(time.time())
        conn = self._connect()
        try:
            conn.execute(
                'INSERT INTO messages(conversation_id, role, content, structured, model, prompt_tokens, '
                'completion_tokens, created_at) VALUES (?,?,?,?,?,?,?,?)',
                (cid, role, content, json.dumps(structured, ensure_ascii=False) if structured is not None else None,
                 model, prompt_tokens, completion_tokens, now))
            conn.execute('UPDATE conversations SET updated_at = ? WHERE id = ?', (now, cid))
            conn.commit()
        finally:
            conn.close()

    def messages(self, cid, limit=None):
        conn = self._connect()
        try:
            rows = conn.execute('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', (cid,)).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            if d.get('structured'):
                try:
                    d['structured'] = json.loads(d['structured'])
                except ValueError:
                    d['structured'] = None
            out.append(d)
        return out[-limit:] if limit else out
