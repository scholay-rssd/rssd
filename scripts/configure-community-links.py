#!/usr/bin/env python3
"""Configure optional static discussion metadata on the existing six-site host.

Run as root from an installed code release, with a private JSON configuration.
Does not restart applications, change publications, or enable the forum webhook.
"""
import grp
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import sys
import time

ROOT = Path('/var/lib/scholay-community-links')
SITES = ('scholay-today', 'legis', 'metho', 'enter', 'xsiching', 'study')


def configure(config_path, asset):
    config = json.loads(Path(config_path).read_text())
    assert config['mode'] in ('pilot', 'all', 'off')
    assert {s['id'] for s in config['sites']} == set(SITES)
    assert Path(asset).name == 'discussion-links.v1.js'
    uid, gid = pwd.getpwnam('scholay-admin').pw_uid, grp.getgrnam('www-data').gr_gid
    ROOT.mkdir(exist_ok=True, mode=0o750)
    os.chown(ROOT, uid, gid)
    ROOT.chmod(0o750)
    public = ROOT / 'public'
    public.mkdir(exist_ok=True, mode=0o755)
    public.chmod(0o755)
    os.chown(public, uid, gid)
    for site in SITES:
        directory = public / site
        directory.mkdir(exist_ok=True, mode=0o755)
        directory.chmod(0o755)
        os.chown(directory, uid, gid)
        target = directory / 'links.json'
        if not target.exists():
            target.write_text('{"version":1,"links":{}}\n')
            target.chmod(0o644)
            os.chown(target, uid, gid)
        target.chmod(0o644)
    shutil.copyfile(asset, public / 'discussion-links.v1.js')
    (public / 'discussion-links.v1.js').chmod(0o644)
    next_config = ROOT / 'config.next'
    next_config.write_text(json.dumps(config, ensure_ascii=False) + '\n')
    next_config.chmod(0o600)
    os.chown(next_config, uid, gid)
    next_config.replace(ROOT / 'config.json')
    env = Path('/etc/scholay-admin/community.env')
    if not env.exists():
        env.write_text('SCHOLAY_COMMUNITY_LINKS_ROOT=' + str(ROOT) + '\n'
                       'SCHOLAY_COMMUNITY_WEBHOOK_SECRET=' + secrets.token_hex(32) + '\n')
        env.chmod(0o600)
    dropin = Path('/etc/systemd/system/scholay-admin.service.d/community-links.conf')
    dropin.parent.mkdir(exist_ok=True)
    dropin.write_text('[Service]\nEnvironmentFile=/etc/scholay-admin/community.env\n'
                      'ReadWritePaths=' + str(ROOT) + '\n')
    backup = Path('/var/backups/scholay-community-links') / time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    backup.mkdir(parents=True, mode=0o700)
    changed = {}
    try:
        for site in SITES:
            web_root = next(s['webRoot'] for s in config['sites'] if s['id'] == site)
            assert web_root.startswith('/opt/') and all(c not in web_root for c in '\n;{}')
            snippet = Path('/etc/nginx/snippets/scholay-community-' + site + '.conf')
            path = (Path('/etc/nginx/conf.d/today.scholay.com.conf') if site == 'scholay-today'
                    else Path('/etc/nginx/snippets/scholay-site-' + site + '.conf'))
            for file in (path, snippet):
                changed[file] = file.read_bytes() if file.exists() else None
                if file.exists():
                    shutil.copyfile(file, backup / file.name)
            snippet.write_text('''# Per-column feeds bypass Discourse's per-URL polling lock.
location ^~ /feeds/ {
    root ''' + web_root + ''';
    try_files $uri =404;
    types { application/rss+xml xml; }
    add_header Cache-Control "no-cache";
    add_header X-Robots-Tag "noindex";
    gzip on;
    gzip_types application/rss+xml;
}
# Independent of page releases; no application/database read per visitor.
location = /community/links.json {
    alias ''' + str(public / site / 'links.json') + ''';
    default_type application/json;
    add_header Cache-Control "public, max-age=300";
    add_header X-Robots-Tag "noindex";
    gzip on;
    gzip_types application/json;
}
location = /community/discussion-links.v1.js {
    alias ''' + str(public / 'discussion-links.v1.js') + ''';
    default_type application/javascript;
    add_header Cache-Control "public, max-age=300";
    add_header X-Robots-Tag "noindex";
}
''' + ('''location = /manage/api/community/discourse {
    client_max_body_size 512k;
    limit_req zone=scholay_admin_api burst=30 nodelay;
    limit_req_status 429;
    include /etc/nginx/snippets/scholay-admin-proxy.conf;
}
''' if site == 'scholay-today' else ''))
            include = 'include ' + str(snippet) + ';'
            text = path.read_text()
            if include not in text:
                if site == 'scholay-today':
                    marker = '    root /opt/scholay-today-web/current;'
                    assert text.count(marker) == 1
                    text = text.replace(marker, marker + '\n    ' + include)
                else:
                    text += '\n' + include + '\n'
                path.write_text(text)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
    except BaseException:
        for path, data in changed.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(data)
        raise
    print(json.dumps({'staticMetadata': 'configured', 'sites': len(SITES), 'applicationRestartRequired': True}))


if __name__ == '__main__':
    configure(*sys.argv[1:])
