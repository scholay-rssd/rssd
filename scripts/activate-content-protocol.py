#!/usr/bin/env python3
"""Apply a reviewed content-protocol overlay to one existing production release.

Run on the server with SITE_ID OVERLAY_DIRECTORY. The overlay contains only
the allowlisted files and manifest.json with before/after SHA256 digests.
Existing themes, dependencies, site configuration and content remain in place.
"""
import fcntl, hashlib, json, os, pathlib, shutil, sqlite3, subprocess, sys, time

ALLOWED = {
    'admin/news.mjs', 'admin/model.mjs', 'admin/news-api.mjs',
    'scripts/editorial-record.mjs', 'contracts/site-sections.mjs',
    'web/engine/published-content.mjs', 'web/engine/site-organization.mjs',
    'web/themes/academic/content.mjs', 'web/themes/academic/build-seo.mjs',
    'web/themes/academic/render.mjs', 'web/themes/academic/public/app.js',
    'web/themes/academic/public/styles.css',
}
IDS = ['scholay-today', 'lingxi', 'piggytuck', 'personal', 'pets',
       'legis', 'metho', 'enter', 'xsiching', 'study']
NODE = '/opt/scholay-admin/runtime/bin/node'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def link(path, target):
    temporary = path.with_name('.content-next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(path)

def activate(site_id, overlay):
    if site_id not in IDS:
        raise ValueError('Unknown site')
    manifest = json.loads((overlay / 'manifest.json').read_text())
    if not manifest or not set(manifest).issubset(ALLOWED):
        raise ValueError('Unexpected protocol overlay files')
    academic = site_id == 'scholay-today'
    app = pathlib.Path('/opt/scholay-admin' if academic else f'/opt/scholay-sites/{site_id}/app')
    web = pathlib.Path('/opt/scholay-today-web' if academic else f'/opt/scholay-sites/{site_id}/web')
    database = '/var/lib/scholay-admin/admin.sqlite' if academic else f'/var/lib/scholay-sites/{site_id}/admin.sqlite'
    services = ['scholay-admin', 'scholay-publisher'] if academic else [f'scholay-{site_id}-admin', f'scholay-{site_id}-publisher']
    old = (app / 'current').resolve()
    for name, expected in manifest.items():
        if digest(old / name) != expected['before'] or digest(overlay / name) != expected['after']:
            raise ValueError('Code changed since review: ' + name)
    connect = lambda: sqlite3.connect('file:' + database + '?mode=ro', uri=True)
    def content_state(db):
        rows = db.execute('SELECT d.id,d.kind,d.permalink,d.latest_revision,d.published_revision,r.version,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id ORDER BY d.id,r.version').fetchall()
        return hashlib.sha256(json.dumps(rows, ensure_ascii=False).encode()).hexdigest()
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    backup = pathlib.Path('/var/backups/scholay-sites') / site_id / ('content-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    release = app / 'releases' / (stamp + '-content')
    run = lambda args, **kw: subprocess.run(args, check=True, **kw)
    run(['cp', '-a', '--reflink=auto', str(old), str(release)])
    for name in manifest:
        target = release / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(overlay / name, target)
        target.chmod(0o644)
        if target.suffix in ('.mjs', '.js'):
            run([NODE, '--check', str(target)])
    before = None
    job_id = None
    changed = False
    try:
        run(['systemctl', 'stop', services[1], services[0]])
        if (app / 'current').resolve() != old:
            raise RuntimeError('Another deployment changed the active release')
        with connect() as db:
            for table in ['jobs', 'site_jobs']:
                if db.execute(f"SELECT 1 FROM {table} WHERE status IN ('queued','running') LIMIT 1").fetchone():
                    raise RuntimeError('Publication queue must be idle')
            before = content_state(db)
            with sqlite3.connect(backup / 'admin.sqlite') as target:
                db.backup(target)
        (backup / 'pointers.json').write_text(json.dumps({'app': str(old), 'web': str((web / 'current').resolve())}))
        link(app / 'current', release)
        changed = True
        run(['systemctl', 'start', services[0]])
        port = 4180 + IDS.index(site_id)
        for _ in range(30):
            probe = subprocess.run(['curl', '--noproxy', '*', '--max-time', '5', '-fsS', f'http://127.0.0.1:{port}/manage/api/site'], capture_output=True)
            if probe.returncode == 0 and json.loads(probe.stdout).get('siteId') == site_id:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Admin failed to restart')
        command = [NODE, 'admin/cli.mjs', 'rebuild'] if academic else [NODE, 'scripts/run-site.mjs', f'/etc/scholay-sites/{site_id}/site.json', 'cli', 'rebuild']
        job_id = json.loads(subprocess.check_output(command, cwd=release, env={**os.environ, 'SCHOLAY_ADMIN_DB': database}, text=True))['id']
        receipt = {'siteId': site_id, 'jobId': job_id, 'code': str(release), 'backup': str(backup), 'status': 'verifying'}
        (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt), flush=True)
        run(['systemctl', 'start', services[1]])
        for _ in range(360):
            with connect() as db:
                job = db.execute('SELECT status,error,release FROM site_jobs WHERE id=?', (job_id,)).fetchone()
            if job[0] in ('success', 'failed'):
                break
            time.sleep(1)
        if job[0] != 'success':
            raise RuntimeError('Query original rebuild before any retry: ' + json.dumps({'jobId': job_id, 'result': job}))
        active = json.loads((web / 'current/release.json').read_text())
        if active['jobId'] != job_id or active['release'] != job[2]:
            raise RuntimeError('Active release differs from completed job')
        with connect() as db:
            if content_state(db) != before:
                raise RuntimeError('Content changed during code deployment')
        receipt.update(status='success', release=job[2], contentUnchanged=True)
        (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt), flush=True)
    except BaseException:
        # Before submission it is safe to restore code. Once a rebuild exists,
        # retain its identity and code for recovery; the worker retains the old
        # public release if a new release fails verification.
        if changed and not job_id:
            link(app / 'current', old)
        run(['systemctl', 'start', *services])
        raise

if __name__ == '__main__':
    with open('/run/lock/scholay-content-deployment.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        activate(sys.argv[1], pathlib.Path(sys.argv[2]).resolve())
