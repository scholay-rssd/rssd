#!/usr/bin/env python3
"""Archive verified website releases/backups before pruning explicit private paths.

Linux maintenance only; no app deployment and no writes to live content databases.
Default is a dry run. Secrets and receipts live outside the source checkout.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import urllib.request

SITES = ('scholay-today', 'xsime', 'piggytuck', 'personal', 'pets',
         'legis', 'metho', 'enter', 'xsiching', 'study')
RECEIVER_SITES = Path('/opt/rssd-public/sites')
CONFIG = Path('/etc/scholay-retention/config.json')
STATE = Path('/var/lib/scholay-retention')


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def site_paths(site):
    if site == 'scholay-today':
        return Path('/opt/scholay-admin'), Path('/opt/scholay-today-web'), Path('/var/lib/scholay-admin')
    return (Path('/opt/scholay-sites') / site / 'app',
            Path('/opt/scholay-sites') / site / 'web', Path('/var/lib/scholay-sites') / site)


def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def validate_release(path, kind, site):
    if path.is_symlink() or not path.is_dir():
        raise ValueError('Release is not a real directory: ' + str(path))
    if kind == 'app':
        json.loads((path / 'package.json').read_text())
        for name in ('admin/server.mjs', 'admin/worker.mjs'):
            if not (path / name).is_file():
                raise ValueError('Incomplete application release: ' + str(path))
        node = '/opt/scholay-admin/runtime/bin/node'
        for name in ('admin/server.mjs', 'admin/worker.mjs'):
            checked = subprocess.run([node, '--check', str(path / name)], capture_output=True)
            if checked.returncode:
                raise ValueError('Application syntax check failed: ' + str(path / name))
        checked = subprocess.run([node, '-e',
            "const p=require('./package.json');for(const name of Object.keys(p.dependencies||{}))require.resolve(name)"],
            cwd=path, capture_output=True)
        if checked.returncode:
            raise ValueError('Application runtime dependency is missing: ' + str(path))
        return
    manifest = json.loads((path / 'release.json').read_text())
    if manifest.get('siteId', site) != site or not manifest.get('hashes'):
        raise ValueError('Invalid website manifest: ' + str(path))
    hashes = {**manifest['hashes'], **manifest.get('byteHashes', {})}
    for name, expected in hashes.items():
        file = path / name
        if not name or name.startswith('/') or '..' in Path(name).parts or '\\' in name:
            raise ValueError('Unsafe manifest path: ' + name)
        if not file.resolve().is_relative_to(path.resolve()):
            raise ValueError('Website file escapes release: ' + str(file))
        # Existing manifests use digest(String(Buffer)) for legacy `hashes`,
        # including images; only byteHashes are hashes of the original bytes.
        actual = (sha_file(file) if name in manifest.get('byteHashes', {}) else
                  hashlib.sha256(file.read_bytes().decode('utf-8', errors='replace').encode()).hexdigest())
        if actual != expected:
            raise ValueError('Website file failed hash check: ' + str(file))


def release_selection(base, kind, site, validate=validate_release):
    releases = base / 'releases'
    current_link = base / 'current'
    if not current_link.is_symlink() or releases.is_symlink():
        raise ValueError('Missing current symlink or unsafe release root: ' + str(base))
    current = current_link.resolve(strict=True)
    directories = [p for p in releases.iterdir()
                   if p.is_dir() and not p.is_symlink() and not p.name.startswith('.')]
    if kind == 'web' and current.is_relative_to((RECEIVER_SITES / site).resolve()):
        # After cutover the old web root forwards to the receiver; its own releases are pre-cutover history.
        return held(base, current, directories, [], 'Served by the RSSD receiver after cutover')
    if current.parent != releases.resolve(strict=True):
        raise ValueError('Current escapes releases: ' + str(current))
    validate(current, kind, site)
    ordered = sorted((p for p in directories if p != current),
                     key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
    kept, rejected = [current], []
    for path in ordered:
        try:
            validate(path, kind, site)
        except (ValueError, OSError, KeyError) as error:
            rejected.append({'path': str(path), 'error': str(error)})
            continue
        kept.append(path)
        if len(kept) == 3:
            break
    if len(kept) != 3:
        return held(base, current, directories, rejected, 'Two validated rollback releases are required')
    return {'base': str(base), 'current': str(current), 'keep': list(map(str, kept)),
            'candidates': [str(p) for p in directories if p not in kept], 'rejected': rejected}


def held(base, current, directories, rejected, reason):
    # Too few rollbacks: keep every release of this site and let the other sites proceed.
    emit('release-group-held', base=str(base), reason=reason)
    return {'base': str(base), 'current': str(current), 'keep': list(map(str, directories)),
            'candidates': [], 'rejected': rejected, 'held': reason}


def receiver_bases(root=None):
    root = RECEIVER_SITES if root is None else root
    return [root / site for site in SITES if (root / site / 'current').is_symlink()]


def chain_selection(base, site, validate=validate_release):
    """Receiver rollbacks follow recorded predecessors, so a build that never went live is not kept."""
    releases = base / 'releases'
    current_link = base / 'current'
    if not current_link.is_symlink() or releases.is_symlink():
        raise ValueError('Missing current symlink or unsafe release root: ' + str(base))
    root = releases.resolve(strict=True)
    current = current_link.resolve(strict=True)
    if current.parent != root or current.is_symlink() or not current.is_dir():
        raise ValueError('Current escapes releases: ' + str(current))
    validate(current, 'web', site)
    directories = [p for p in releases.iterdir()
                   if p.is_dir() and not p.is_symlink() and not p.name.startswith('.')]
    kept, path = [current], current
    while len(kept) < 3:
        previous = json.loads((path / 'release.json').read_text()).get('previousRelease')
        if previous is None:
            return held(base, current, directories, [], 'Two recorded rollback releases are required')
        if not isinstance(previous, str) or Path(previous).name != previous or previous in ('', '.', '..'):
            raise ValueError('Unsafe recorded rollback release: ' + str(path))
        path = releases / previous
        if path in kept:
            raise ValueError('Cyclic release chain: ' + str(path))
        try:
            if path.is_symlink() or not path.is_dir():
                raise ValueError('Recorded rollback release is missing: ' + str(path))
            validate(path, 'web', site)
        except (ValueError, OSError, KeyError) as error:
            return held(base, current, directories, [{'path': str(path), 'error': str(error)}],
                        'Two recorded rollback releases are required')
        kept.append(path)
    return {'base': str(base), 'current': str(current), 'keep': list(map(str, kept)),
            'candidates': [str(p) for p in directories if p not in kept], 'rejected': []}


def backup_groups():
    roots = [site_paths(site)[2] / 'backups' for site in SITES]
    roots += [Path('/var/backups/scholay-sites') / site for site in SITES]
    roots += [Path('/var/backups') / name for name in (
        'scholay-public-snapshots', 'scholay-admin', 'scholay-seo',
        'scholay-client-updates', 'scholay-community-links', 'scholay-performance')]
    return [p for p in roots if p.is_dir() and not p.is_symlink()]


def backup_selection(root, require=True):
    entries = sorted((p for p in root.iterdir() if not p.name.startswith('.') and
                      p.suffix not in ('.partial', '.tmp') and not p.is_symlink()),
                     key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
    keep = entries[:3]
    if root in {site_paths(site)[2] / 'backups' for site in SITES}:
        keep = []
        for path in entries:
            if not path.is_file() or path.suffix != '.sqlite':
                continue
            wal = path.with_name(path.name + '-wal')
            if wal.exists() and wal.stat().st_size:
                continue
            try:
                # These are completed offline backup files; immutable avoids
                # creating or mutating SQLite -shm/-wal files during inspection.
                with contextlib.closing(sqlite3.connect('file:' + str(path) + '?mode=ro&immutable=1', uri=True)) as db:
                    if db.execute('PRAGMA quick_check').fetchone()[0] == 'ok':
                        keep.append(path)
            except sqlite3.DatabaseError:
                pass
            if len(keep) == 3:
                break
        if not keep and require:
            raise ValueError('No valid local database backup: ' + str(root))
        if not keep:
            # A dry run takes no online backup first; an applied run must find the one it just made.
            emit('backup-group-held', base=str(root), reason='No valid local database backup yet')
            return {'base': str(root), 'keep': list(map(str, entries)), 'candidates': [], 'held': 'No valid local database backup yet'}
    return {'base': str(root), 'keep': list(map(str, keep)),
            'candidates': [str(p) for p in entries if p not in keep]}


def entries(path):
    yield path
    if path.is_dir() and not path.is_symlink():
        for child in sorted(path.iterdir()):
            yield from entries(child)


def node_token(relative, kind, size=0):
    # Restic ls JSON exposes link type but not link target. Targets are still
    # protected against source changes by fingerprint and verified on restore.
    value = json.dumps([relative, kind, size], ensure_ascii=False, separators=(',', ':'))
    return int.from_bytes(hashlib.sha256(value.encode()).digest(), 'big')


def fingerprint(path):
    """Track source mutations and independently match snapshot path/type/size coverage."""
    h, coverage, count, size = hashlib.sha256(), 0, 0, 0
    device = path.lstat().st_dev
    for p in entries(path):
        s = p.lstat()
        if s.st_dev != device:
            raise ValueError('Refuse to cross a filesystem: ' + str(p))
        kind = 'dir' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'symlink'
        if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode)):
            raise ValueError('Unsupported special file: ' + str(p))
        relative = p.relative_to(path).as_posix()
        target = os.readlink(p) if kind == 'symlink' else ''
        length = s.st_size if kind == 'file' else 0
        coverage = (coverage + node_token(relative, kind, length)) % (1 << 256)
        h.update(json.dumps([relative, s.st_dev, s.st_ino, s.st_mode, s.st_size,
                             s.st_mtime_ns, s.st_ctime_ns, target]).encode())
        count += 1
        size += length
    return {'fingerprint': h.hexdigest(), 'coverage': hex(coverage), 'nodes': count, 'bytes': size}


def make_plan(bootstrap=False, dry_run=False):
    releases = [release_selection(base, kind, site) for site in SITES
                for kind, base in zip(('app', 'web'), site_paths(site)[:2])]
    releases += [chain_selection(base, base.name) for base in receiver_bases()]
    backups = [backup_selection(root, require=not dry_run) for root in backup_groups()]
    candidates = [p for group in releases + backups for p in group['candidates']]
    # One-time historical migration bundles; never broad-match /var/backups.
    if bootstrap:
        candidates += [str(p) for p in (Path('/var/backups/multisite-migration-20261013.tar.gz'),
                                        Path('/var/backups/scholay-sites/endnotes-20261020')) if p.exists()]
    now = time.time()
    candidates = [p for p in candidates if now - Path(p).lstat().st_mtime > 900]
    return {'created': now, 'releases': releases, 'backups': backups,
            'candidates': {p: fingerprint(Path(p)) for p in candidates}}


def online_backups(stamp):
    result = {}
    for site in SITES:
        state = site_paths(site)[2]
        dest = state / 'backups' / ('retention-' + stamp + '.sqlite')
        temp = dest.with_suffix('.partial')
        if dest.exists() or temp.exists():
            raise ValueError('Refuse to overwrite an existing backup attempt: ' + str(dest))
        source = sqlite3.connect('file:' + str(state / 'admin.sqlite') + '?mode=ro', uri=True, timeout=30)
        try:
            with contextlib.closing(sqlite3.connect(temp)) as target:
                source.backup(target, pages=128, sleep=0.05)
                target.execute('PRAGMA journal_mode=DELETE')
                if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('SQLite backup failed integrity check: ' + site)
            with temp.open('r+b') as handle:
                os.fsync(handle.fileno())
            temp.replace(dest)
            # Keep existing admin service's access to its own backup directory.
            owner = (state / 'admin.sqlite').stat()
            os.chown(dest, owner.st_uid, owner.st_gid)
            result[site] = {'path': str(dest), 'sha256': sha_file(dest)}
        finally:
            source.close()
            temp.unlink(missing_ok=True)
    return result


def healthy_sites():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    result = {}
    for index, site in enumerate(SITES):
        base = 'http://127.0.0.1:' + str(4180 + index)
        with opener.open(base + '/manage/health', timeout=10) as response:
            if response.status != 200 or not json.load(response).get('ok'):
                raise RuntimeError('Site health check failed: ' + site)
        with opener.open(base + '/manage/api/site', timeout=10) as response:
            if json.load(response).get('siteId') != site:
                raise RuntimeError('Port/site mapping changed: ' + site)
        result[site] = 'ok'
    return result


class Restic:
    def __init__(self, config, run_dir):
        self.config, self.run_dir, self.step = config, run_dir, 0
        self.command = [config['restic'], '--repo', config['repository'],
                        '--password-file', config['passwordFile'], '--cache-dir', str(STATE / 'cache'),
                        '--limit-upload', '4096', '--limit-download', '8192',
                        '-o', 'sftp.command=ssh -F ' + config['sshConfig'] + ' -s archive sftp']
        self.env = {**os.environ, 'GOMAXPROCS': '1', 'GOMEMLIMIT': '240MiB'}

    def run(self, *arguments):
        self.step += 1
        log = self.run_dir / ('restic-%02d.log' % self.step)
        emit('restic-start', operation=arguments[0], log=str(log))
        with log.open('w') as handle:
            completed = subprocess.run(self.command + list(arguments), stdout=handle,
                                       stderr=subprocess.STDOUT, env=self.env)
        if completed.returncode:
            raise RuntimeError('Restic failed; no deletion permitted. See ' + str(log))
        return log.read_text()

    def verify_coverage(self, snapshot, candidates):
        expected = {Path(p): value for p, value in candidates.items()}
        actual = {p: {'nodes': 0, 'coverage': 0, 'bytes': 0} for p in expected}
        process = subprocess.Popen(self.command + ['ls', '--json', snapshot], stdout=subprocess.PIPE,
                                   text=True, env=self.env)
        try:
            for line in process.stdout:
                node = json.loads(line)
                if node.get('struct_type') != 'node':
                    continue
                path = Path(node['path'])
                root = next((p for p in (path, *path.parents) if p in expected), None)
                if root is None:
                    continue
                kind = node['type']
                length = node.get('size', 0) if kind == 'file' else 0
                token = node_token(path.relative_to(root).as_posix(), kind, length)
                actual[root]['nodes'] += 1
                actual[root]['bytes'] += length
                actual[root]['coverage'] = (actual[root]['coverage'] + token) % (1 << 256)
            if process.wait() != 0:
                raise RuntimeError('Snapshot listing failed')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait()
        for path, original in expected.items():
            found = actual[path]
            if (found['nodes'], found['bytes'], hex(found['coverage'])) != (
                    original['nodes'], original['bytes'], original['coverage']):
                raise ValueError('Archive does not exactly cover candidate: ' + str(path))
        emit('archive-coverage-verified', candidates=len(expected))

    def verify_data(self, snapshot):
        if not self.config.get('verifyHost'):
            self.run('check', '--read-data')
            return
        self.step += 1
        log = self.run_dir / ('restic-%02d-remote-verify.log' % self.step)
        emit('archive-full-read-check', snapshot=snapshot, log=str(log))
        with log.open('wb') as handle:
            result = subprocess.run(['ssh', '-F', self.config['sshConfig'], self.config['verifyHost'],
                                     'verify', snapshot], input=Path(self.config['passwordFile']).read_bytes(),
                                    stdout=handle, stderr=subprocess.STDOUT, timeout=7500)
        if result.returncode:
            raise RuntimeError('Archive host verification failed; see ' + str(log))
        receipt = json.loads(log.read_text().strip())
        if receipt != {'verifiedSnapshot': snapshot, 'repositoryId': self.config['repositoryId'], 'readData': True}:
            raise RuntimeError('Archive verification receipt does not match this repository/snapshot')


def archive_paths():
    paths = [str(base / 'releases') for site in SITES for base in site_paths(site)[:2]]
    paths += [str(site_paths(site)[2] / 'backups') for site in SITES]
    paths += [str(base / 'releases') for base in receiver_bases()]
    paths += [str(p) for p in Path('/var/backups').glob('scholay-*')]
    paths += [str(p) for p in Path('/etc/systemd/system').glob('scholay*')]
    paths += ['/var/backups/multisite-migration-20261013.tar.gz', '/var/backups/today-before-multisite.json',
              '/etc/scholay-admin', '/etc/scholay-sites', '/etc/nginx', '/opt/scholay-admin/runtime',
              '/var/lib/scholay-community-links', '/etc/tmpfiles.d/scholay-publication.conf',
              '/usr/local/libexec/scholay-retention.py']
    return sorted(p for p in paths if Path(p).exists())


def running_paths():
    result = []
    for cwd in Path('/proc').glob('[0-9]*/cwd'):
        try:
            result.append(cwd.resolve(strict=True))
        except OSError:
            pass
    return result


def safe_remove(path, original, allowed_parents, protected, active):
    path = Path(path)
    if path.is_symlink() or path.parent not in allowed_parents or path.parent.resolve() != path.parent:
        raise ValueError('Unsafe deletion path: ' + str(path))
    if any(p == path or p.is_relative_to(path) for p in protected + active):
        raise ValueError('Protected or running release: ' + str(path))
    if fingerprint(path) != original:
        raise ValueError('Candidate changed since archive: ' + str(path))
    if path.is_dir():
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError('Platform lacks symlink-safe recursive deletion')
        shutil.rmtree(path)
    else:
        path.unlink()


@contextlib.contextmanager
def locked(path, create=False):
    import fcntl
    with open(path, 'a' if create else 'r') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def prune_local(plan, bootstrap, run_dir):
    # Take the existing publication lock only for final checks/removals, not during upload.
    with locked('/run/lock/scholay-publication.lock'):
        fresh = make_plan(bootstrap)
        protected = [Path(p) for group in fresh['releases'] + fresh['backups'] for p in group['keep']]
        allowed = {Path(g['base']) / 'releases' for g in fresh['releases']}
        allowed.update(Path(g['base']) for g in fresh['backups'])
        if bootstrap:
            allowed.update((Path('/var/backups'), Path('/var/backups/scholay-sites')))
        selected = {p: v for p, v in plan['candidates'].items() if p in fresh['candidates']}
        active = running_paths()
        # Validate the complete batch first; refuse modified candidates before deleting anything.
        for p, original in selected.items():
            if fresh['candidates'][p] != original:
                raise ValueError('Candidate changed while archiving: ' + p)
            if any(x == Path(p) or x.is_relative_to(Path(p)) for x in active):
                raise ValueError('A process still uses candidate: ' + p)
        for p, original in selected.items():
            # A deployment may run outside the publisher lock. Re-resolve all current links each time.
            current = [(Path(g['base']) / 'current').resolve(strict=True) for g in fresh['releases']]
            safe_remove(p, original, allowed, protected + current, active)
            with (run_dir / 'deleted.jsonl').open('a') as handle:
                handle.write(json.dumps({'path': p, **original}) + '\n')
            emit('removed-archived-path', path=p)
        return len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--bootstrap', action='store_true', help='Pin initial archive; include known old migration bundles')
    args = parser.parse_args()
    os.umask(0o077)
    if not args.apply:
        plan = make_plan(args.bootstrap, dry_run=True)
        print(json.dumps(plan, indent=2))
        return
    config = json.loads(CONFIG.read_text())
    STATE.mkdir(mode=0o700, exist_ok=True)
    with locked('/run/lock/scholay-retention.lock', create=True):
        stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        run_dir = STATE / 'runs' / stamp
        run_dir.mkdir(parents=True, mode=0o700)
        # Query actual destination free space via its confined SFTP session.
        probe = subprocess.run(['sftp', '-F', config['sshConfig'], '-b', '-', 'archive'],
                               input='df /today\n', text=True, capture_output=True, check=True)
        fields = probe.stdout.strip().splitlines()[-1].split()
        if len(fields) < 4 or int(fields[2]) * 1024 < config.get('minimumRemoteFreeBytes', 8 * 1024**3):
            raise RuntimeError('Archive host free space is below reserve; no cleanup')
        needed = sum((site_paths(site)[2] / 'admin.sqlite').stat().st_size for site in SITES)
        if shutil.disk_usage(STATE).free < needed + 512 * 1024**2:
            raise RuntimeError('Insufficient local staging space; keep 512 MiB free and stop before copying')
        write_json(run_dir / 'health-before.json', healthy_sites())
        backups = online_backups(stamp)
        write_json(run_dir / 'database-backups.json', backups)
        plan = make_plan(args.bootstrap)
        write_json(run_dir / 'plan.json', plan)
        emit('plan-ready', candidates=len(plan['candidates']), run=str(run_dir))
        restic = Restic(config, run_dir)
        tag = 'bootstrap-pinned' if args.bootstrap else 'routine'
        output = restic.run('backup', '--json', '--quiet', '--host', 'scholay-today', '--tag', tag,
                            '--exclude', '**/.building-*', *archive_paths())
        summary = next(json.loads(line) for line in output.splitlines()
                       if line.startswith('{') and json.loads(line).get('message_type') == 'summary')
        snapshot = summary['snapshot_id']
        write_json(run_dir / 'archive.json', {'snapshot': snapshot, 'tag': tag, 'summary': summary})
        restic.verify_data(snapshot)
        restic.verify_coverage(snapshot, plan['candidates'])
        write_json(run_dir / 'verified.json', {'snapshot': snapshot, 'verifiedAt': time.time()})
        removed = prune_local(plan, args.bootstrap, run_dir)
        write_json(run_dir / 'health-after.json', healthy_sites())
        # Only routine snapshots rotate; the initial migration archive is permanently pinned.
        restic.run('forget', '--tag', 'routine', '--host', 'scholay-today', '--group-by', 'host,tags',
                   '--keep-last', '3', '--keep-daily', '7', '--keep-weekly', '4', '--keep-monthly', '3',
                   '--prune', '--max-repack-size', '256M')
        restic.run('check')
        write_json(run_dir / 'success.json', {'snapshot': snapshot, 'removed': removed, 'finished': time.time()})
        emit('success', snapshot=snapshot, removed=removed)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('failed', error=str(error))
        sys.exit(1)
