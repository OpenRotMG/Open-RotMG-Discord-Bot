#!/usr/bin/env python3
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tarfile


def package(root, revision, output):
    root = Path(root)
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('An exact source revision is required')
    paths = [root / n for n in ['package.json', 'package-lock.json', 'LICENSE']]
    for name in ['src', 'test', 'node_modules', 'scripts/deploy']:
        directory = root / name
        if not directory.is_dir():
            raise ValueError('Missing package directory: ' + name)
        paths.extend([directory, *directory.rglob('*')])
    if any(p.is_symlink() for p in paths):
        raise ValueError('Bot package may not contain symlinks')
    files = {str(p.relative_to(root)): p.read_bytes() for p in sorted(paths) if p.is_file() and p.suffix != '.pyc'}
    files['REVISION'] = (revision + '\n').encode()
    metadata = {'revision': revision, 'manifest': {n: hashlib.sha256(d).hexdigest() for n, d in files.items()}}
    with tarfile.open(output, 'w:gz') as archive:
        for name, data in {'metadata.json': json.dumps(metadata).encode(), **{'bot/' + n: d for n, d in files.items()}}.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))


if __name__ == '__main__':
    package(*sys.argv[1:])
