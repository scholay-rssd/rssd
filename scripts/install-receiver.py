#!/usr/bin/env python3
"""Install a verified CI receiver artifact; configuration and activation are separate."""
import argparse
import hashlib
import json
import pathlib
import shutil
import tarfile
import tempfile


def install(archive, expected, root):
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ValueError('Archive checksum mismatch')
    root = root.resolve()
    (root / 'releases').mkdir(parents=True, exist_ok=True)
    root.chmod(0o755)
    (root / 'releases').chmod(0o755)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='.install-', dir=root / 'releases'))
    try:
        with tarfile.open(archive, 'r:gz') as bundle:
            members = bundle.getmembers()
            seen = set()
            for member in members:
                name = pathlib.PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts or '\\' in member.name:
                    raise ValueError('Unsafe archive path')
                if not (member.isdir() or member.isfile()):
                    raise ValueError('Only regular files and directories are allowed')
                normalized = str(name)
                if normalized in seen:
                    raise ValueError('Duplicate archive path')
                seen.add(normalized)
            bundle.extractall(stage, filter='data')
        manifest = json.loads((stage / 'artifact-manifest.json').read_text())
        revision = manifest['revision']
        if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
            raise ValueError('Invalid revision identity')
        if manifest.get('platform') != 'linux-x64' or manifest.get('protocolVersion') != 1:
            raise ValueError('Unsupported receiver artifact')
        actual = {p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file()}
        if actual != set(manifest['files']) | {'artifact-manifest.json'}:
            raise ValueError('Artifact file inventory mismatch')
        for name, digest in manifest['files'].items():
            with (stage / name).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise ValueError('Artifact file checksum mismatch: ' + name)
        # Public artifacts are read-only inputs for the service account.
        for path in stage.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        stage.chmod(0o755)
        (stage / 'node').chmod(0o755)
        target = root / 'releases' / revision
        if target.exists():
            raise ValueError('Release already exists; refusing to overlay it')
        stage.rename(target)
        return {'revision': revision, 'release': str(target), 'sha256': expected, 'activated': False}
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=pathlib.Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('/opt/rssd-receiver'))
    args = parser.parse_args()
    print(json.dumps(install(args.archive, args.sha256, args.root)))
