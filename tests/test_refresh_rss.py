import importlib.util
from pathlib import Path
import unittest

module_path = Path(__file__).resolve().parent.parent / "scripts" / "refresh-rss.py"
spec = importlib.util.spec_from_file_location("refresh_rss", str(module_path))
rss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rss)


class RefreshRssTests(unittest.TestCase):
    def test_naive_china_published_time_uses_source_offset(self):
        self.assertEqual(rss.published_date("2026-09-28 21:56", 480), "2026-09-28T13:56:00Z")

    def test_parses_public_rss_as_plain_text_and_original_link(self):
        source = {"id": "example", "name": "Example", "category": "科研新闻",
                  "url": "https://example.org/feed.xml", "naiveUtcOffsetMinutes": 480}
        xml = b'<rss><channel><item><title>Research &amp; practice</title><link>https://example.org/article</link><description><![CDATA[<p>Useful <b>summary</b>.</p><script>secret()</script>]]></description><pubDate>2026-09-28 21:56</pubDate></item></channel></rss>'
        item = rss.parse_items(xml, source)[0]
        self.assertEqual(item["title"], "Research & practice")
        self.assertEqual(item["summary"], "Useful summary.")
        self.assertEqual(item["url"], "https://example.org/article")
        self.assertEqual(item["publishedAt"], "2026-09-28T13:56:00Z")

    def test_failed_source_preserves_only_its_previous_public_items(self):
        sources = [{"id": "a", "name": "A", "category": "科研新闻", "url": "https://a.example/rss"},
                   {"id": "b", "name": "B", "category": "科研新闻", "url": "https://b.example/rss"}]
        previous = {"items": [{"sourceId": "b", "url": "https://b.example/1", "publishedAt": None}],
                    "sources": [{"id": "b", "lastSuccessAt": "2026-09-27T00:00:00Z"}]}

        def fetch(source):
            if source["id"] == "b":
                raise ValueError("offline")
            return [{"sourceId": "a", "url": "https://a.example/1", "publishedAt": "2026-09-28T00:00:00Z"}]

        result = rss.build_snapshot(sources, previous, fetch)
        self.assertEqual(len(result["items"]), 2)
        self.assertFalse(result["sources"][1]["available"])
        self.assertEqual(result["sources"][1]["lastSuccessAt"], "2026-09-27T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
