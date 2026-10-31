import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('installer', pathlib.Path(__file__).resolve().parents[1] / 'scripts/install-receiver.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def bundle(self, root, extra=None, bad_manifest=False):
        manifest = {'revision': 'a' * 40, 'platform': 'linux-x64', 'protocolVersion': 1,
                    'files': {'node': hashlib.sha256(b'fixture').hexdigest()}}
        if bad_manifest:
            manifest['files']['node'] = '0' * 64
        path = root / 'artifact.tar.gz'
        with tarfile.open(path, 'w:gz') as output:
            for name, data in {'node': b'fixture', 'artifact-manifest.json': json.dumps(manifest).encode()}.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                output.addfile(entry, io.BytesIO(data))
            if extra:
                output.addfile(extra)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_verified_install_does_not_activate_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive, digest = self.bundle(root)
            result = installer.install(archive, digest, root / 'service')
            self.assertFalse(result['activated'])
            self.assertFalse((root / 'service/current').exists())
            self.assertEqual((pathlib.Path(result['release']) / 'node').read_bytes(), b'fixture')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                installer.install(archive, digest, root / 'service')

    def test_tampering_and_archive_escape_leave_no_release(self):
        for kind in ['checksum', 'manifest', 'symlink', 'traversal']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                extra = None
                if kind == 'symlink':
                    extra = tarfile.TarInfo('escape')
                    extra.type = tarfile.SYMTYPE
                    extra.linkname = '/etc/passwd'
                if kind == 'traversal':
                    extra = tarfile.TarInfo('../escape')
                archive, digest = self.bundle(root, extra, kind == 'manifest')
                with self.assertRaises(ValueError):
                    installer.install(archive, '0' * 64 if kind == 'checksum' else digest, root / 'service')
                self.assertFalse((root / 'escape').exists())
                releases = root / 'service/releases'
                self.assertEqual(list(releases.iterdir()) if releases.exists() else [], [])


if __name__ == '__main__':
    unittest.main()
