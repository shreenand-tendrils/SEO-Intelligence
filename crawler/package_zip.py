"""Build a clean ZIP of the project:  python3 package_zip.py [output.zip]

Never includes .env (or any .env.* except .env.example), .git, virtual
environments, caches, databases or saved crawls. Refuses to write the ZIP if
any included file contains something shaped like a Groq API key.
"""
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
TOP = 'tendrils-seo-crawler'
SKIP_DIRS = {'.git', 'venv', '.venv', 'env', '__pycache__', 'node_modules', '.idea', '.vscode',
             'dist', 'site-crawler-crawls', '.site-crawler-crawls', 'crawls', 'logs'}
SKIP_SUFFIX = ('.pyc', '.pyo', '.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3', '.log', '.zip', '.bundle')
KEY_RE = re.compile(rb'gsk_[A-Za-z0-9]{20,}')


def excluded(rel):
    name = os.path.basename(rel)
    if name == '.env' or (name.startswith('.env.') and name != '.env.example'):
        return True
    if name == '.DS_Store' or name.endswith(SKIP_SUFFIX):
        return True
    return any(part in SKIP_DIRS for part in rel.split(os.sep)[:-1])


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', f'{TOP}-groq.zip')
    out = os.path.abspath(out)
    files = []
    for dp, dn, fns in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for fn in fns:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, ROOT)
            if not excluded(rel):
                files.append((full, rel))
    for full, rel in files:
        with open(full, 'rb') as fh:
            if KEY_RE.search(fh.read()):
                sys.exit(f'REFUSING to package: {rel} contains something that looks like a Groq API key.')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for full, rel in sorted(files, key=lambda t: t[1]):
            z.write(full, os.path.join(TOP, rel))
    print(f'{len(files)} files -> {out}')


if __name__ == '__main__':
    main()
