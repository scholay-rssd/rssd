#!/usr/bin/env python3
"""Install only declared public redirect vhosts; existing API aliases are separate."""
import argparse, json, pathlib, re, shutil, subprocess, time
from urllib.parse import urlparse
MARKER = '# Managed by Scholay configure-domain-redirects.py\n'

def validate(entry):
    host, origin, site = entry['host'], entry['origin'], entry['siteId']
    parsed = urlparse(origin)
    if not re.fullmatch(r'www\.[a-z0-9][a-z0-9.-]+', host) or not re.fullmatch(r'[a-z][a-z0-9-]{1,48}', site):
        raise ValueError('Invalid redirect identity')
    if parsed.scheme != 'https' or not re.fullmatch(r'[a-z0-9][a-z0-9.-]+', parsed.netloc) or parsed.path or parsed.query or parsed.fragment or parsed.hostname == host:
        raise ValueError('Invalid canonical origin')
    return host, origin, site

def configuration(entry, tls=False):
    host, origin, site = validate(entry)
    acme = f'/opt/scholay-sites/{site}/acme'
    content = MARKER + f'''server {{
    listen 80;
    listen [::]:80;
    server_name {host};
    location ^~ /.well-known/acme-challenge/ {{ root {acme}; default_type text/plain; try_files $uri =404; }}
    location / {{ return 301 {origin}$request_uri; }}
}}
'''
    if tls:
        content += f'''server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {host};
    ssl_certificate /etc/letsencrypt/live/{host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {{ return 301 {origin}$request_uri; }}
}}
'''
    return content

def install(entry, backup):
    host, origin, site = validate(entry)
    path = pathlib.Path('/etc/nginx/conf.d', host + '.conf')
    original = path.read_text() if path.exists() else None
    if original is not None and not original.startswith(MARKER):
        raise RuntimeError('Existing vhost is not owned by this redirect installer: ' + host)
    if original is not None:
        shutil.copy2(path, backup / path.name)
    def write(content):
        previous = path.read_text() if path.exists() else None
        if previous == content:
            return
        path.write_text(content)
        try:
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        except Exception:
            if previous is None:
                path.unlink()
            else:
                path.write_text(previous)
            raise
    acme = pathlib.Path(f'/opt/scholay-sites/{site}/acme')
    acme.mkdir(parents=True, exist_ok=True)
    certificate = pathlib.Path('/etc/letsencrypt/live', host, 'fullchain.pem')
    if not certificate.exists():
        write(configuration(entry))
        subprocess.run(['certbot', 'certonly', '--webroot', '-w', str(acme), '-d', host, '--cert-name', host, '--non-interactive'], check=True)
    write(configuration(entry, tls=True))
    return {'host': host, 'origin': origin, 'certificate': str(certificate), 'backup': str(backup)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default=str(pathlib.Path(__file__).resolve().parent.parent / 'sites/domain-redirects.json'))
    parser.add_argument('--site')
    args = parser.parse_args()
    entries = json.loads(pathlib.Path(args.config).read_text())
    if len({entry['host'] for entry in entries}) != len(entries):
        raise ValueError('Duplicate redirect host')
    for entry in entries:
        validate(entry)
    entries = [entry for entry in entries if not args.site or entry['siteId'] == args.site]
    if not entries:
        return
    backup = pathlib.Path('/var/backups/scholay-sites/domain-redirects', time.strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, exist_ok=True)
    print(json.dumps([install(entry, backup) for entry in entries]))

if __name__ == '__main__':
    main()
