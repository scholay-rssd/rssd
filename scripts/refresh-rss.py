#!/usr/bin/env python3
"""Build a public, read-only RSS snapshot from an explicit source allowlist.

This does not access the desktop database. It publishes titles, short summaries,
dates and original links only; every source URL is reviewed in rss-sources.json.
Compatible with the Python 3.6 runtime on the current hosting server.
"""

from concurrent.futures import ThreadPoolExecutor
import datetime
import email.utils
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "rss-sources.json"
OUTPUT = ROOT / "rss.json"
MAX_ITEMS_PER_SOURCE = 24
MAX_TOTAL_ITEMS = 360
USER_AGENT = "ScholayToday-PublicRSS/1.0 (+https://today.scholay.com/)"


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def local_name(tag):
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]


def child(node, *names):
    for name in names:
        for part in node:
            if local_name(part.tag).lower() == name.lower():
                return part
    return None


def text_of(node):
    if node is None:
        return ""
    return "".join(node.itertext()).strip()


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        elif tag in ("p", "br", "div", "li"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        elif tag in ("p", "div", "li"):
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def plain(value, limit):
    parser = PlainText()
    parser.feed(value or "")
    value = html.unescape("".join(parser.parts))
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit].rstrip() + ("…" if len(value) > limit else "")


def safe_url(value):
    try:
        parsed = urllib.parse.urlsplit((value or "").strip())
        if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            return None
        return urllib.parse.urlunsplit(parsed._replace(fragment=""))
    except ValueError:
        return None


def published_date(value, naive_utc_offset_minutes=0):
    if not value:
        return None
    try:
        date = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        date = None
    if date is None:
        try:
            match = re.match(r"^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d(?::\d\d)?))?(Z|[+-]\d\d:?\d\d)?", value)
            if not match:
                return None
            clock = match.group(2) or "00:00:00"
            if len(clock) == 5:
                clock += ":00"
            date = datetime.datetime.strptime(match.group(1) + " " + clock, "%Y-%m-%d %H:%M:%S")
            zone = match.group(3)
            if zone and zone != "Z":
                sign = 1 if zone[0] == "+" else -1
                offset = zone[1:].replace(":", "")
                date -= datetime.timedelta(minutes=sign * (int(offset[:2]) * 60 + int(offset[2:])))
            date = date.replace(tzinfo=datetime.timezone(datetime.timedelta(minutes=naive_utc_offset_minutes)))
        except (TypeError, ValueError):
            return None
    if date.tzinfo is None:
        date = date.replace(tzinfo=datetime.timezone(datetime.timedelta(minutes=naive_utc_offset_minutes)))
    date = date.astimezone(datetime.timezone.utc)
    if date.year < 1990 or date > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1):
        return None
    return date.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_items(xml_bytes, source):
    root = ET.fromstring(xml_bytes)
    entries = [element for element in root.iter() if local_name(element.tag).lower() in ("item", "entry")]
    result = []
    seen = set()
    for item in entries:
        title = plain(text_of(child(item, "title")), 240)
        link_node = child(item, "link")
        link = (link_node.attrib.get("href") or text_of(link_node)) if link_node is not None else ""
        link = safe_url(urllib.parse.urljoin(source["url"], link))
        if not title or not link or link in seen:
            continue
        seen.add(link)
        summary = plain(text_of(child(item, "description", "summary", "content", "encoded")), 260)
        date = published_date(text_of(child(item, "pubDate", "published", "updated", "date")), source.get("naiveUtcOffsetMinutes", 0))
        result.append({"id": source["id"] + ":" + hashlib.sha1(link.encode("utf-8")).hexdigest()[:14], "sourceId": source["id"],
                       "source": source["name"], "category": source["category"],
                       "title": title, "summary": summary, "url": link, "publishedAt": date})
        if len(result) >= MAX_ITEMS_PER_SOURCE:
            break
    return result


def fetch_source(source):
    request = urllib.request.Request(source["url"], headers={"User-Agent": USER_AGENT, "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(request, timeout=16) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
    if len(payload) > 4 * 1024 * 1024:
        raise ValueError("feed exceeded 4 MiB")
    items = parse_items(payload, source)
    if not items:
        raise ValueError("feed contained no usable entries")
    return items


def build_snapshot(sources, previous=None, fetch=fetch_source):
    previous = previous or {}
    old_by_source = {}
    for item in previous.get("items", []):
        old_by_source.setdefault(item.get("sourceId"), []).append(item)
    old_status = {entry.get("id"): entry for entry in previous.get("sources", [])}
    entries = []
    status = []
    success = 0
    for source in sources:
        if not safe_url(source.get("url")):
            raise ValueError("invalid source URL: " + source.get("id", "unknown"))
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [(source, pool.submit(fetch, source)) for source in sources]
        for source, future in futures:
            try:
                fresh = future.result()
                entries.extend(fresh)
                status.append({"id": source["id"], "name": source["name"], "category": source["category"],
                               "url": source["url"], "lastSuccessAt": utc_now(), "available": True})
                success += 1
            except Exception as error:
                print("RSS fetch failed for {}: {}".format(source["id"], error), file=sys.stderr)
                entries.extend(old_by_source.get(source["id"], [])[:MAX_ITEMS_PER_SOURCE])
                status.append({"id": source["id"], "name": source["name"], "category": source["category"],
                               "url": source["url"], "lastSuccessAt": old_status.get(source["id"], {}).get("lastSuccessAt"),
                               "available": False})
    if not entries or (success == 0 and not previous.get("items")):
        raise RuntimeError("no public RSS entries available; keeping previous snapshot")
    unique = {}
    for item in entries:
        unique.setdefault(item["url"], item)
    items = sorted(unique.values(), key=lambda item: item.get("publishedAt") or "", reverse=True)[:MAX_TOTAL_ITEMS]
    return {"version": 1, "updatedAt": utc_now(), "successfulSources": success,
            "sources": status, "items": items}


def main():
    with SOURCES.open(encoding="utf-8") as file:
        sources = json.load(file)["sources"]
    previous = None
    if OUTPUT.exists():
        try:
            with OUTPUT.open(encoding="utf-8") as file:
                previous = json.load(file)
        except (OSError, ValueError):
            pass
    snapshot = build_snapshot(sources, previous)
    temporary = str(OUTPUT) + ".tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(snapshot, file, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, str(OUTPUT))
    print("Wrote {} articles from {}/{} available sources".format(len(snapshot["items"]), snapshot["successfulSources"], len(sources)))


if __name__ == "__main__":
    main()
