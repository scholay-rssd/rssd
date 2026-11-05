import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("indexnow", Path(__file__).parents[1] / "scripts/indexnow.py")
indexnow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexnow)


class IndexNowTest(unittest.TestCase):
    def test_changes_deletions_and_failed_requests_are_not_lost(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            site = {"id": "example", "origin": "https://example.org", "root": folder,
                    "key": "abcd1234", "keyLocation": "https://example.org/abcd1234.txt"}
            manifest = root / "seo-manifest.json"
            manifest.write_text(json.dumps({"pages": {"/": {"hash": "a"}, "/old/": {"hash": "old"}}}))
            state = root / "state"
            indexnow.process(site, state, "baseline")
            manifest.write_text(json.dumps({"pages": {"/": {"hash": "b"}, "/new/": {"hash": "new"}}}))
            sent = []
            def reject(site, urls):
                sent.append(urls)
                return 429
            result = indexnow.process(site, state, "submit", sender=reject, clock=lambda: 10)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(len(indexnow.process(site, state, "plan")["urls"]), 3)
            result = indexnow.process(site, state, "submit", sender=lambda *_: 200, clock=lambda: 4000)
            self.assertEqual(result["count"], 3)
            self.assertEqual(indexnow.process(site, state, "plan")["count"], 0)
            self.assertIn("https://example.org/old/", sent[0])

    def test_cross_host_routes_and_empty_manifest_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            site = {"id": "example", "origin": "https://example.org", "root": folder,
                    "key": "abcd1234", "keyLocation": "https://example.org/abcd1234.txt"}
            for pages in [{}, {"//other.test/": {"hash": "a"}}, {"/manage/": {"hash": "a"}}]:
                (Path(folder) / "seo-manifest.json").write_text(json.dumps({"pages": pages}))
                with self.assertRaises(ValueError):
                    indexnow.public_pages(site)
