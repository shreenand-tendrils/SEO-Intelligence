"""Load backend configuration from a local `.env` file.

Standard library only (no python-dotenv), so installing the crawler does not
pull in anything new. Real environment variables always win over the file, so
a systemd unit, launchd plist or CI job can still set them directly.

The `.env` file lives next to app.py on the server. It is never served by the
app (Flask only serves /static), never committed (see .gitignore) and never
packaged (see package_zip.py).
"""
import os

_LOADED = False


def _parse_line(line):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        return None
    if line.startswith('export '):
        line = line[len('export '):].lstrip()
    key, _, value = line.partition('=')
    key = key.strip()
    value = value.strip()
    if not key or not key.replace('_', '').isalnum():
        return None
    if value[:1] in ('"', "'"):
        close = value.find(value[0], 1)
        if close != -1:
            return key, value[1:close]      # quoted: anything after the closing quote is a comment
    # Unquoted: allow a trailing " # comment".
    hash_at = value.find(' #')
    if hash_at != -1:
        value = value[:hash_at].rstrip()
    return key, value


def load_env(path=None, override=False):
    """Read KEY=VALUE lines from `path` (default: .env beside this file) into
    os.environ. Returns the number of variables set. Missing file is fine."""
    global _LOADED
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    count = 0
    try:
        with open(path, encoding='utf-8') as fh:
            for raw in fh:
                parsed = _parse_line(raw)
                if not parsed:
                    continue
                key, value = parsed
                if override or key not in os.environ:
                    os.environ[key] = value
                    count += 1
    except FileNotFoundError:
        pass
    except OSError:
        # Unreadable .env: behave as if absent; the Groq service then reports
        # the key as missing, which is the accurate user-facing outcome.
        pass
    _LOADED = True
    return count
