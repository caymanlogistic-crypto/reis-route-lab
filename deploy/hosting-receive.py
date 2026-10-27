#!/usr/bin/env python3
"""Forced SSH command: receive a source archive only; never execute its contents."""
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
match = re.fullmatch(r'sync ([a-f0-9]{40})', command)
if not match:
    sys.exit('Only sync <commit-sha> is allowed.')
sha = match.group(1)
base = Path.home() / 'planexp' / 'reis-route-lab-private'
releases = base / 'releases'
releases.mkdir(mode=0o700, parents=True, exist_ok=True)
os.umask(0o077)
content = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
if len(content) > 10 * 1024 * 1024:
    sys.exit('Archive exceeds 10 MiB.')
stage = Path(tempfile.mkdtemp(prefix=sha + '.', dir=str(releases)))
allowed_dirs = {'src', 'tests', 'scripts', 'docs', 'drizzle', 'deploy', '.github', '.openai'}
allowed_files = {'README.md', 'AGENTS.md', 'package.json', 'package-lock.json', '.gitattributes', '.gitignore', '.node-version', '.env.example', 'Запустить.cmd'}
seen = set()
try:
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
        total = 0
        for member in archive:
            parts = Path(member.name).parts
            if not parts or member.name.startswith('/') or '..' in parts or '\\' in member.name:
                raise ValueError('Invalid archive path.')
            if parts[0] not in allowed_dirs and not (len(parts) == 1 and parts[0] in allowed_files):
                raise ValueError('Unexpected root entry.')
            if any(p == '.env' or (p.startswith('.env.') and p != '.env.example') for p in parts):
                raise ValueError('Environment files may not be uploaded.')
            if member.name in seen:
                raise ValueError('Duplicate archive entry.')
            seen.add(member.name)
            target = stage.joinpath(*parts)
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            elif member.isfile():
                total += member.size
                if total > 30 * 1024 * 1024:
                    raise ValueError('Expanded archive exceeds 30 MiB.')
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
            else:
                raise ValueError('Links and special files are forbidden.')
    if not (stage / 'src' / 'local.js').is_file() or not (stage / 'package.json').is_file():
        raise ValueError('Application sources missing.')
    manifest = {'commit': sha, 'archiveSha256': hashlib.sha256(content).hexdigest(),
                'syncedAt': datetime.now(timezone.utc).isoformat(), 'runtime': 'not-deployed',
                'reason': 'Shared hosting does not support this Node 24 web application.'}
    (stage / 'hosting-sync.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf8')
    next_link = base / ('current-' + stage.name)
    next_link.symlink_to(stage)
    os.replace(str(next_link), str(base / 'current'))
    print('Source synced: ' + sha + '. Runtime not deployed; archive stored outside public_html.')
except Exception:
    shutil.rmtree(str(stage))
    sys.exit('Source sync rejected; previous release retained.')
