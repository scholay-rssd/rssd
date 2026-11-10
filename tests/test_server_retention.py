import importlib.util
import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('retention', Path(__file__).parents[1] / 'scripts/server-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def link(self, path, target):
        try:
            path.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('Directory symlinks unavailable')

    def releases(self):
        base = self.root / 'web'
        (base / 'releases').mkdir(parents=True)
        dirs = []
        for i in range(5):
            path = base / 'releases' / str(i)
            path.mkdir()
            (path / 'index.html').write_text(str(i))
            (path / 'release.json').write_text(json.dumps({'siteId': 'pets', 'hashes': {
                'index.html': retention.sha_file(path / 'index.html')}}))
            os.utime(path, (100 + i, 100 + i))
            dirs.append(path)
        self.link(base / 'current', dirs[0])
        return base, dirs

    def receiver_releases(self, chain):
        base = self.root / 'rssd-public' / 'metho'
        (base / 'releases').mkdir(parents=True)
        for name, previous in chain:
            path = base / 'releases' / name
            path.mkdir()
            (path / 'index.html').write_text(name)
            manifest = {'siteId': 'metho', 'hashes': {'index.html': retention.sha_file(path / 'index.html')}}
            if previous:
                manifest['previousRelease'] = previous
            (path / 'release.json').write_text(json.dumps(manifest))
        return base

    def test_receiver_rollbacks_follow_recorded_chain_not_newest_build(self):
        # A build that failed readback is newer than the real rollback but never went live.
        base = self.receiver_releases([('initial', None), ('a', 'initial'), ('b', 'a'),
                                       ('failed', 'b'), ('c', 'b'), ('d', 'c')])
        os.utime(base / 'releases' / 'failed', (10**9, 10**9))
        self.link(base / 'current', base / 'releases' / 'd')
        selected = retention.chain_selection(base, 'metho')
        names = lambda paths: sorted(Path(p).name for p in paths)
        self.assertEqual([Path(p).name for p in selected['keep']], ['d', 'c', 'b'])
        self.assertEqual(names(selected['candidates']), ['a', 'failed', 'initial'])

    def test_receiver_chain_with_missing_invalid_or_absent_rollback_holds_every_release(self):
        base = self.receiver_releases([('old', None), ('c', 'missing'), ('d', 'c')])
        self.link(base / 'current', base / 'releases' / 'd')
        names = lambda paths: sorted(Path(p).name for p in paths)
        selected = retention.chain_selection(base, 'metho')
        self.assertEqual((selected['candidates'], names(selected['keep'])), ([], ['c', 'd', 'old']))
        self.assertIn('held', selected)
        # The recorded predecessor exists but fails validation.
        (base / 'releases' / 'missing').mkdir()
        (base / 'releases' / 'missing' / 'release.json').write_text(json.dumps({'siteId': 'metho', 'hashes': {}}))
        selected = retention.chain_selection(base, 'metho')
        self.assertEqual((selected['candidates'], names(selected['keep'])), ([], ['c', 'd', 'missing', 'old']))
        self.assertIn('held', selected)
        lone = self.root / 'lone'
        (lone / 'releases' / 'only').mkdir(parents=True)
        (lone / 'releases' / 'only' / 'release.json').write_text(json.dumps({'siteId': 'metho', 'hashes': {}}))
        self.link(lone / 'current', lone / 'releases' / 'only')
        selected = retention.chain_selection(lone, 'metho', validate=lambda *a: None)
        self.assertEqual((selected['candidates'], 'held' in selected), ([], True))

    def test_invalid_receiver_current_still_aborts(self):
        base = self.receiver_releases([('c', None), ('d', 'c')])
        (base / 'releases' / 'd' / 'index.html').write_text('corrupted')
        self.link(base / 'current', base / 'releases' / 'd')
        with self.assertRaises(ValueError):
            retention.chain_selection(base, 'metho')

    def test_empty_database_backup_group_fails_applied_run_but_is_held_in_dry_run(self):
        root = self.root / 'state' / 'backups'
        root.mkdir(parents=True)
        (root / 'notes.txt').write_text('not a database')
        with patch.object(retention, 'site_paths', lambda site: (None, None, self.root / 'state')):
            with self.assertRaises(ValueError):
                retention.backup_selection(root)
            selected = retention.backup_selection(root, require=False)
        self.assertEqual((selected['candidates'], selected['keep']), ([], [str(root / 'notes.txt')]))
        self.assertIn('held', selected)

    UNIT = Path(__file__).parents[1] / 'deploy/storage-retention/scholay-retention.service'

    @unittest.skipUnless(UNIT.exists(), 'requires the private deployment units')
    def test_service_sandbox_can_write_every_pruned_root(self):
        unit = self.UNIT.read_text()
        writable = [Path(p) for line in unit.splitlines() if line.startswith('ReadWritePaths=')
                    for p in line.split('=', 1)[1].split()]
        roots = [retention.RECEIVER_SITES, retention.STATE]
        roots += [base / 'releases' for site in retention.SITES for base in retention.site_paths(site)[:2]]
        roots += [retention.site_paths(site)[2] / 'backups' for site in retention.SITES]
        roots += [Path('/var/backups/scholay-sites'), Path('/run/lock')]
        for root in roots:
            self.assertTrue(any(root == w or root.is_relative_to(w) for w in writable), root)

    def test_legacy_web_root_forwarding_to_receiver_is_held(self):
        base, dirs = self.releases()
        receiver = self.receiver_releases([('r', None)])
        self.link(receiver / 'current', receiver / 'releases' / 'r')
        (base / 'current').unlink()
        self.link(base / 'current', receiver / 'current')
        with patch.object(retention, 'RECEIVER_SITES', self.root / 'rssd-public'):
            selected = retention.release_selection(base, 'web', 'metho')
            self.assertEqual((selected['candidates'], sorted(selected['keep'])), ([], sorted(map(str, dirs))))
            self.assertIn('held', selected)
            with self.assertRaises(ValueError):
                retention.release_selection(base, 'web', 'pets')

    def test_site_with_too_few_valid_rollbacks_is_held_not_fatal(self):
        base, dirs = self.releases()
        for path in dirs[2:]:
            (path / 'index.html').write_text('corrupted')
        selected = retention.release_selection(base, 'web', 'pets')
        self.assertEqual(selected['candidates'], [])
        self.assertEqual(sorted(selected['keep']), sorted(map(str, dirs)))
        self.assertEqual(len(selected['rejected']), 3)
        self.assertIn('held', selected)

    def test_receiver_chain_cannot_escape_or_loop(self):
        base = self.receiver_releases([('c', '../outside'), ('d', 'c')])
        self.link(base / 'current', base / 'releases' / 'd')
        with self.assertRaises(ValueError):
            retention.chain_selection(base, 'metho')
        loop = self.root / 'loop'
        (loop / 'releases').mkdir(parents=True)
        for name, previous in (('x', 'y'), ('y', 'x')):
            (loop / 'releases' / name).mkdir()
            (loop / 'releases' / name / 'release.json').write_text(json.dumps(
                {'siteId': 'metho', 'hashes': {'release.json': '0' * 64}, 'previousRelease': previous}))
        self.link(loop / 'current', loop / 'releases' / 'x')
        with self.assertRaises(ValueError):
            retention.chain_selection(loop, 'metho', validate=lambda *a: None)

    def test_receiver_bases_include_only_sites_with_a_current_release(self):
        base = self.receiver_releases([('a', None)])
        self.link(base / 'current', base / 'releases' / 'a')
        (self.root / 'rssd-public' / 'pets' / 'releases').mkdir(parents=True)
        (self.root / 'rssd-public' / 'unknown-site').mkdir()
        self.link(self.root / 'rssd-public' / 'unknown-site' / 'current', base / 'releases' / 'a')
        self.assertEqual(retention.receiver_bases(self.root / 'rssd-public'), [base])

    def test_current_is_kept_even_when_older_than_other_releases(self):
        base, dirs = self.releases()
        selected = retention.release_selection(base, 'web', 'pets')
        self.assertEqual(selected['keep'], list(map(str, [dirs[0], dirs[4], dirs[3]])))
        self.assertEqual(set(selected['candidates']), set(map(str, [dirs[1], dirs[2]])))

    def test_corrupt_latest_is_not_a_rollback(self):
        base, dirs = self.releases()
        (dirs[4] / 'index.html').write_text('corrupted')
        selected = retention.release_selection(base, 'web', 'pets')
        self.assertEqual(selected['keep'], list(map(str, [dirs[0], dirs[3], dirs[2]])))
        self.assertEqual(len(selected['rejected']), 1)

    def test_corrupt_current_aborts(self):
        base, dirs = self.releases()
        (dirs[0] / 'index.html').write_text('corrupted')
        with self.assertRaises(ValueError):
            retention.release_selection(base, 'web', 'pets')

    def test_manifest_path_cannot_escape(self):
        base, dirs = self.releases()
        (dirs[0] / 'release.json').write_text(json.dumps({'hashes': {'../escape': 'x'}}))
        with self.assertRaises(ValueError):
            retention.validate_release(dirs[0], 'web', 'pets')

    def test_current_outside_release_root_aborts(self):
        base, dirs = self.releases()
        (base / 'current').unlink()
        self.link(base / 'current', self.root)
        with self.assertRaises(ValueError):
            retention.release_selection(base, 'web', 'pets')

    def test_legacy_text_digest_and_explicit_binary_hash(self):
        path = self.root / 'release'
        path.mkdir()
        data = b'\xff\x80image\x00'
        (path / 'image.webp').write_bytes(data)
        legacy = retention.hashlib.sha256(data.decode('utf-8', errors='replace').encode()).hexdigest()
        (path / 'release.json').write_text(json.dumps({'hashes': {'image.webp': legacy}}))
        retention.validate_release(path, 'web', 'pets')
        (path / 'release.json').write_text(json.dumps({'hashes': {'image.webp': legacy},
            'byteHashes': {'image.webp': retention.sha_file(path / 'image.webp')}}))
        retention.validate_release(path, 'web', 'pets')

    def file(self):
        path = self.root / 'old.sqlite'
        path.write_bytes(b'backup')
        return path

    def test_changed_candidate_is_not_deleted(self):
        path = self.file()
        original = retention.fingerprint(path)
        path.write_bytes(b'edited backup')
        with self.assertRaises(ValueError):
            retention.safe_remove(path, original, {self.root}, [], [])
        self.assertTrue(path.exists())

    def test_protected_current_and_running_process_are_not_deleted(self):
        path = self.file()
        original = retention.fingerprint(path)
        for protected, active in [([path], []), ([], [path])]:
            with self.assertRaises(ValueError):
                retention.safe_remove(path, original, {self.root}, protected, active)
            self.assertTrue(path.exists())

    def test_outside_allowlist_is_not_deleted(self):
        path = self.file()
        with self.assertRaises(ValueError):
            retention.safe_remove(path, retention.fingerprint(path), {self.root / 'other'}, [], [])
        self.assertTrue(path.exists())

    def test_verified_unchanged_allowed_file_can_be_removed(self):
        path = self.file()
        retention.safe_remove(path, retention.fingerprint(path), {self.root}, [], [])
        self.assertFalse(path.exists())

    def test_backup_retention_keeps_three_newest(self):
        for i in range(5):
            path = self.root / (str(i) + '.sqlite')
            path.touch()
            os.utime(path, (100 + i, 100 + i))
        selected = retention.backup_selection(self.root)
        self.assertEqual([Path(p).name for p in selected['keep']], ['4.sqlite', '3.sqlite', '2.sqlite'])

    def test_database_rollback_slots_require_valid_sqlite_files(self):
        root = self.root / 'backups'
        root.mkdir()
        for i in range(4):
            path = root / (str(i) + '.sqlite')
            with contextlib.closing(sqlite3.connect(path)) as db:
                db.execute('CREATE TABLE articles(body TEXT)')
                db.commit()
            os.utime(path, (100 + i, 100 + i))
        corrupt = root / 'corrupt.sqlite'
        corrupt.write_bytes(b'not a SQLite backup')
        with patch.object(retention, 'SITES', ('fixture',)), \
             patch.object(retention, 'site_paths', return_value=(None, None, self.root)):
            selected = retention.backup_selection(root)
        self.assertEqual([Path(p).name for p in selected['keep']], ['3.sqlite', '2.sqlite', '1.sqlite'])
        self.assertIn(str(corrupt), selected['candidates'])

    def test_restic_partial_backup_is_failure(self):
        cfg = {'restic': 'restic', 'repository': 'test', 'passwordFile': 'secret', 'sshConfig': 'ssh-config'}
        runner = retention.Restic(cfg, self.root)
        with patch.object(retention.subprocess, 'run') as run:
            run.return_value.returncode = 3
            with self.assertRaises(RuntimeError):
                runner.run('backup', '/test')

    def test_incomplete_archive_listing_cannot_authorize_deletion(self):
        path = self.file()
        cfg = {'restic': 'restic', 'repository': 'test', 'passwordFile': 'secret', 'sshConfig': 'ssh-config'}
        runner = retention.Restic(cfg, self.root)
        process = Mock(stdout=iter([]))
        process.wait.return_value = 0
        process.poll.return_value = 0
        with patch.object(retention.subprocess, 'Popen', return_value=process):
            with self.assertRaises(ValueError):
                runner.verify_coverage('snapshot', {str(path): retention.fingerprint(path)})
        self.assertTrue(path.exists())

    def test_wrong_remote_repository_receipt_is_rejected(self):
        password = self.root / 'password'
        password.write_text('fixture-only-password-not-a-real-secret\n')
        cfg = {'restic': 'restic', 'repository': 'test', 'passwordFile': str(password),
               'sshConfig': 'ssh-config', 'verifyHost': 'archive-check', 'repositoryId': 'expected'}
        runner = retention.Restic(cfg, self.root)

        def fake_check(*args, **kwargs):
            kwargs['stdout'].write(json.dumps({'verifiedSnapshot': 'snapshot',
                'repositoryId': 'different', 'readData': True}).encode())
            return Mock(returncode=0)

        with patch.object(retention.subprocess, 'run', side_effect=fake_check):
            with self.assertRaises(RuntimeError):
                runner.verify_data('snapshot')

    def test_online_backup_includes_uncheckpointed_wal(self):
        (self.root / 'backups').mkdir()
        source = sqlite3.connect(self.root / 'admin.sqlite')
        self.addCleanup(source.close)
        source.execute('PRAGMA journal_mode=WAL')
        source.execute('PRAGMA wal_autocheckpoint=0')
        source.execute('CREATE TABLE articles(body TEXT)')
        source.execute("INSERT INTO articles VALUES('original article')")
        source.commit()
        self.assertGreater((self.root / 'admin.sqlite-wal').stat().st_size, 0)
        with patch.object(retention, 'SITES', ('fixture',)), \
             patch.object(retention, 'site_paths', return_value=(None, None, self.root)), \
             patch.object(retention.os, 'chown', create=True):
            receipt = retention.online_backups('test')
        with contextlib.closing(sqlite3.connect(receipt['fixture']['path'])) as backup:
            self.assertEqual(backup.execute('SELECT body FROM articles').fetchone()[0], 'original article')
            self.assertEqual(backup.execute('PRAGMA quick_check').fetchone()[0], 'ok')


if __name__ == '__main__':
    unittest.main()
