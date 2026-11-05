import importlib.util
from pathlib import Path
import re
import unittest

spec = importlib.util.spec_from_file_location('cache', Path(__file__).resolve().parents[1] / 'scripts/configure-academic-cache.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)

class AcademicCache(unittest.TestCase):
    def test_public_rules_leave_private_routes_unchanged(self):
        original = '''server {
    location /manage/ { proxy_pass http://127.0.0.1:4180; }
    location /guestbook/ { proxy_pass http://127.0.0.1:4180; }
    location / { try_files $uri $uri/ =404; }
    location = /data.json {
        add_header Cache-Control "no-cache";
    }
    location = /open-source.json {
        add_header Cache-Control "no-cache";
    }
}'''
        result = cache.configure(original)
        self.assertEqual(result.split('    # Academic')[0], original.split('    location / {')[0])
        self.assertEqual(cache.configure(result), result)
        self.assertIn('public, max-age=31536000, immutable', result)
        self.assertEqual(result.count('gzip on;'), 4)
        # The public location revalidates pages and caches only stamped assets.
        self.assertEqual(result.count('Cache-Control "no-cache"'), 3)
        self.assertIn('set $scholay_cache "no-cache";', result)
        self.assertIn('if ($arg_h ~ "^[0-9a-f]{10}$")', result)
        self.assertEqual(result.count('add_header Cache-Control $scholay_cache;'), 1)

    def test_unknown_config_is_not_rewritten(self):
        with self.assertRaises(ValueError):
            cache.configure('server { location / { proxy_pass http://other; } }')
