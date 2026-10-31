#!/usr/bin/env python3
"""Submit changed public sitemap URLs to IndexNow, with per-site durable receipts.

Initialize --baseline before enabling a site. An unchanged release makes no
request. Run under flock when scheduled; never read editorial data or tokens.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://api.indexnow.org/indexnow"


def save(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def public_pages(site):
    origin = urllib.parse.urlsplit(site["origin"])
    if origin.scheme != "https" or origin.path or origin.query or origin.fragment or origin.username or origin.port:
        raise ValueError("Expected a canonical HTTPS origin")
    if not re.fullmatch(r"[a-z0-9-]{2,40}", site["id"]):
        raise ValueError("Invalid site id")
    if not re.fullmatch(r"[a-zA-Z0-9-]{8,128}", site["key"]):
        raise ValueError("Invalid verification key")
    if site["keyLocation"] != site["origin"] + "/" + site["key"] + ".txt":
        raise ValueError("Verification must use the root key file")
    root = Path(site["root"]).resolve(strict=True)
    manifest = read_json(root / "seo-manifest.json")
    pages = {}
    for route, item in manifest["pages"].items():
        parsed = urllib.parse.urlsplit(route)
        if not route.startswith("/") or route.startswith("//") or parsed.query or parsed.fragment or parsed.netloc or parsed.scheme:
            raise ValueError("Invalid canonical route")
        decoded = urllib.parse.unquote(route)
        if any(part in (".", "..") for part in decoded.split("/")) or decoded.startswith(("/manage/", "/admin/")):
            raise ValueError("Non-public route in SEO manifest")
        if not isinstance(item.get("hash"), str) or not item["hash"]:
            raise ValueError("Missing content hash")
        pages[site["origin"] + route] = item["hash"]
    if not pages:
        raise ValueError("Empty SEO manifest; refusing to submit mass removals")
    return pages


def changed_urls(previous, current):
    return sorted(url for url in previous.keys() | current.keys() if previous.get(url) != current.get(url))


def post(site, urls):
    payload = {"host": urllib.parse.urlsplit(site["origin"]).hostname,
               "key": site["key"], "keyLocation": site["keyLocation"], "urlList": urls}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(),
                                    headers={"Content-Type": "application/json; charset=utf-8",
                                             "User-Agent": "Scholay-IndexNow/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def process(site, directory, mode, sender=post, clock=time.time):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    file = directory / (site["id"] + ".json")
    current = public_pages(site)
    state = read_json(file, {})
    if mode == "baseline":
        if not state:
            save(file, {"pages": current, "initialized": int(clock())})
        return {"siteId": site["id"], "status": "baseline-existing" if state else "baseline-created", "pages": len(current)}
    if not state:
        raise ValueError(site["id"] + ": baseline required before submission")
    urls = changed_urls(state["pages"], current)
    if mode == "plan":
        return {"siteId": site["id"], "status": "plan", "count": len(urls), "urls": urls}
    if not urls:
        return {"siteId": site["id"], "status": "unchanged", "count": 0}
    if state.get("retryAfter", 0) > clock():
        return {"siteId": site["id"], "status": "backoff", "count": len(urls)}
    total = 0
    for start in range(0, len(urls), 10000):
        batch = urls[start:start + 10000]
        try:
            status = sender(site, batch)
        except (OSError, TimeoutError, urllib.error.URLError):
            status = 0
        accepted = status in (200, 202)
        receipt = {"siteId": site["id"], "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "httpStatus": status, "accepted": accepted, "urls": batch}
        with (directory / (site["id"] + ".receipts.jsonl")).open("a") as output:
            os.chmod(output.name, 0o600)
            output.write(json.dumps(receipt, ensure_ascii=False) + "\n")
        if not accepted:
            state["retryAfter"] = int(clock()) + (86400 if status in (400, 403, 422) else 3600)
            save(file, state)
            return {"siteId": site["id"], "status": "failed", "httpStatus": status, "accepted": total}
        # Acknowledgment is URL-granular: a later failed batch cannot lose changes.
        for url in batch:
            if url in current:
                state["pages"][url] = current[url]
            else:
                state["pages"].pop(url, None)
        state.pop("retryAfter", None)
        state["lastAccepted"] = int(clock())
        state["lastHttpStatus"] = status
        save(file, state)
        total += len(batch)
    return {"siteId": site["id"], "status": "accepted", "httpStatus": state["lastHttpStatus"], "count": total}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/scholay-seo/indexnow.json")
    parser.add_argument("--state", default="/var/lib/scholay-seo/state")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--baseline", action="store_true")
    modes.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    mode = "baseline" if args.baseline else "plan" if args.plan else "submit"
    failed = False
    for site in read_json(Path(args.config))["sites"]:
        try:
            result = process(site, Path(args.state), mode)
        except (ValueError, KeyError, OSError) as error:
            result = {"siteId": site.get("id"), "status": "error", "error": str(error)}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        failed |= result["status"] in ("failed", "error")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
