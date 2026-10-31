#!/usr/bin/env python3
"""Activate a prepared SEO-only overlay of the currently deployed application.

Run from /tmp/scholay-seo-<site>-<stamp>. Keeps site configuration and content,
checks the publication queue, and rolls back code/web pointers on any failure.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time

site = sys.argv[1]
assert re.fullmatch(r"[a-z][a-z0-9-]{1,30}", site)
source = Path.cwd().resolve()
assert str(source).startswith("/tmp/scholay-seo-" + site + "-")
main = site == "scholay-today"
app = Path("/opt/scholay-admin") if main else Path("/opt/scholay-sites") / site / "app"
web = Path("/opt/scholay-today-web") if main else Path("/opt/scholay-sites") / site / "web"
database = "/var/lib/scholay-admin/admin.sqlite" if main else f"/var/lib/scholay-sites/{site}/admin.sqlite"
services = ["scholay-admin", "scholay-publisher"] if main else [f"scholay-{site}-admin", f"scholay-{site}-publisher"]
node = "/opt/scholay-admin/runtime/bin/node"
receipt = json.loads((source / "seo-overlay.json").read_text())
assert receipt["siteId"] == site and receipt["baseCode"] == str((app / "current").resolve())
for relative, digest in receipt["files"].items():
    assert relative in ("web/engine/page-metadata.mjs", "web/themes/journal/render.mjs", "web/themes/journal/blog-presets.mjs",
                        "web/themes/academic/build-seo.mjs", "web/themes/academic/archive-pages.mjs", "web/themes/academic/render.mjs",
                        "web/engine/social-metadata.mjs", "web/engine/language-pages.mjs", "admin/guestbook/api.mjs",
                        "web/engine/render-site.mjs", "web/engine/language-navigation.mjs", "web/engine/site-language.js", "web/engine/site-language.css")
    assert hashlib.sha256((source / relative).read_bytes()).hexdigest() == digest
    if relative.endswith((".mjs", ".js")):
        subprocess.run([node, "--check", str(source / relative)], check=True)
if receipt.get("homepage"):
    assert site == "personal"
    home = source / "theme-homepages/personal"
    assert hashlib.sha256((home / "manifest.json").read_bytes()).hexdigest() == receipt["homepage"]
    manifest = json.loads((home / "manifest.json").read_text())
    assert manifest["siteId"] == site and manifest["origin"] == "https://pm.scholay.com"
    for relative, digest in manifest["files"].items():
        assert not Path(relative).is_absolute() and ".." not in Path(relative).parts
        assert hashlib.sha256((home / "public" / relative).read_bytes()).hexdigest() == digest
stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
backup = Path("/var/backups/scholay-sites") / site / ("seo-" + stamp)
backup.mkdir(parents=True, mode=0o700)
release = app / "releases" / (stamp + "-seo")
old_code, old_web = str((app / "current").resolve()), str((web / "current").resolve())
(backup / "pointers.json").write_text(json.dumps({"app": old_code, "web": old_web}))


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def connect():
    return sqlite3.connect("file:" + database + "?mode=ro", uri=True)


def content_state(db):
    digest = hashlib.sha256()
    count = 0
    for row in db.execute("SELECT d.id,d.kind,d.permalink,d.latest_revision,d.published_revision,r.version,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id ORDER BY d.id,r.version"):
        digest.update(json.dumps(row, ensure_ascii=False).encode())
        count += 1
    for row in db.execute("SELECT key,value FROM meta WHERE key IN ('calendarMeta','sourceMeta','initialized') ORDER BY key"):
        digest.update(json.dumps(row, ensure_ascii=False).encode())
    return {"rows": count, "sha256": digest.hexdigest()}


def link(path, target):
    temporary = path.with_name(".seo-next")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(path)


job_id = None
changed = False
try:
    run(["systemctl", "stop", services[1], services[0]])
    with connect() as db:
        for table in ("jobs", "site_jobs"):
            assert not db.execute(f"SELECT 1 FROM {table} WHERE status IN ('queued','running') LIMIT 1").fetchone(), "Publication queue must be idle"
        before = content_state(db)
        with sqlite3.connect(backup / "admin.sqlite") as target:
            db.backup(target)
    (backup / "content-before.json").write_text(json.dumps(before))
    source.chmod(0o755)
    shutil.move(str(source), release)
    os.chdir(release)
    changed = True
    link(app / "current", release)
    run(["systemctl", "start", services[0]])
    env = {**os.environ, "SCHOLAY_ADMIN_DB": database}
    command = [node, "admin/cli.mjs", "rebuild"] if main else [node, "scripts/run-site.mjs", f"/etc/scholay-sites/{site}/site.json", "cli", "rebuild"]
    job_id = json.loads(subprocess.check_output(command, env=env, text=True))["id"]
    assert re.fullmatch(r"[a-f0-9-]{36}", job_id)
    run(["systemctl", "start", services[1]])
    print(json.dumps({"siteId": site, "stage": "verifying", "jobId": job_id}), flush=True)
    for _ in range(300):
        with connect() as db:
            job = db.execute("SELECT status,error FROM site_jobs WHERE id=?", (job_id,)).fetchone()
        if job and job[0] in ("success", "failed"):
            break
        time.sleep(1)
    assert job and job[0] == "success", "Rebuild did not succeed: " + str(job)
    with connect() as db:
        after = content_state(db)
    assert before == after, "Content changed during deployment"
    manifest = json.loads((web / "current/release.json").read_text())
    assert manifest["jobId"] == job_id
    for service in services:
        run(["systemctl", "is-active", "--quiet", service])
    result = {"siteId": site, "status": "success", "jobId": job_id, "contentUnchanged": True,
              "code": str(release), "public": str((web / "current").resolve()), "backup": str(backup)}
    (backup / "acceptance.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
except BaseException:
    if changed:
        run(["systemctl", "stop", services[1], services[0]])
        if job_id:
            with sqlite3.connect(database) as db:
                db.execute("UPDATE site_jobs SET status='failed',finished=?,error=? WHERE id=? AND status IN ('queued','running')",
                           (int(time.time()*1000), "SEO deployment rolled back; content retained", job_id))
        link(app / "current", old_code)
        link(web / "current", old_web)
    run(["systemctl", "start", *services])
    raise
