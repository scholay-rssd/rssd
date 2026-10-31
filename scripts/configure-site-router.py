#!/usr/bin/env python3
"""Run on the target as root after install-site.sh; extend existing vhosts in place."""
import json, pathlib, re, shutil, subprocess, sys, time
site_id=sys.argv[1]; port=int(sys.argv[2])
assert re.fullmatch(r'[a-z][a-z0-9-]{1,30}',site_id) and site_id!='scholay-today' and 1024<port<65536
site=json.loads(pathlib.Path('/etc/scholay-sites',site_id,'site.json').read_text())
from urllib.parse import urlparse
host=urlparse(site['origin']).hostname
assert re.fullmatch(r'[a-z0-9.-]+',host)
base=f'/opt/scholay-sites/{site_id}'
backup=pathlib.Path('/var/backups/scholay-sites',site_id,time.strftime('%Y%m%d-%H%M%S')); backup.mkdir(parents=True)
def write_config(path,content):
 p=pathlib.Path(path)
 if p.exists(): shutil.copy2(p,backup/p.name)
 p.write_text(content)
 try: subprocess.run(['nginx','-t'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 except Exception:
  if (backup/p.name).exists(): shutil.copy2(backup/p.name,p)
  else: p.unlink()
  raise
 subprocess.run(['systemctl','reload','nginx'],check=True)
proxy=f'''location = /manage {{ return 302 /manage/; }}
location ^~ /manage/ {{
    client_max_body_size 68m;
    proxy_pass http://127.0.0.1:{port};
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 65s;
}}
'''
content=proxy
if site.get('services',{}).get('guestbook',{}).get('enabled'):
 content+=f'''location = /guestbook {{ return 302 /guestbook/; }}
location ^~ /guestbook/ {{
    proxy_pass http://127.0.0.1:{port};
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}}
'''

for route in ['journal','calendar','gallery','graph','showcase','roadmap','display','works','projects','project-notes','organization','archive','news','history','open-source','article-media']:
 content+=f'location ^~ /{route}/ {{ root {base}/web/current; index index.html; try_files $uri $uri/ =404; add_header Cache-Control "no-cache"; }}\n'
for file in ['site-theme.css','site-calendar.js','site-content.json','published-content.json','site-logo.png','site-logo.webp','site-logo.jpg','site-logo.svg','sitemap-content.xml','content-feed.xml','release.json']:
 content+=f'location = /{file} {{ root {base}/web/current; try_files $uri =404; add_header Cache-Control "no-cache"; }}\n'
snippet=f'/etc/nginx/snippets/scholay-site-{site_id}.conf'
if pathlib.Path(snippet).exists(): shutil.copy2(snippet,backup/pathlib.Path(snippet).name)
pathlib.Path(snippet).write_text(content)
include=f'    include {snippet};\n'
if site['homeMode']=='existing' or site.get('themeId') in ('portfolio','personal'):
 file='/etc/nginx/conf.d/'+('piggytuck.com' if site_id=='piggytuck' else host)+'.conf'
 prior=pathlib.Path(file).read_text()
 # Match the existing homepage root, not redirects or any other vhost.
 root=('/opt/piggytuck/current' if site_id=='piggytuck' else '/opt/today-scholay/out') if site['homeMode']=='existing' else base+'/web/current'
 anchor='    root '+root+';\n'
 assert prior.count(anchor)==1, 'Existing frontend root changed; inspect before continuing'
 if include not in prior: write_config(file,prior.replace(anchor,anchor+include))
else:
 file='/etc/nginx/conf.d/'+host+'.conf'
 acme=f'{base}/acme';pathlib.Path(acme).mkdir(parents=True,exist_ok=True)
 http=f'''server {{
    listen 80;
    listen [::]:80;
    server_name {host};
    location ^~ /.well-known/acme-challenge/ {{ root {acme}; default_type text/plain; try_files $uri =404; }}
    location / {{ return 301 https://{host}$request_uri; }}
}}
'''
 cert=pathlib.Path('/etc/letsencrypt/live',host,'fullchain.pem')
 if not cert.exists():
  assert not pathlib.Path(file).exists() or pathlib.Path(file).read_text()==http, 'Unrecognized existing vhost; inspect before replacing'
  write_config(file,http)
  subprocess.run(['certbot','certonly','--webroot','-w',acme,'-d',host,'--non-interactive'],check=True)
 tls=f'''server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {host};
    root {base}/web/current;
    index index.html;
    ssl_certificate /etc/letsencrypt/live/{host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
{include}
    location / {{ try_files $uri $uri/ =404; }}
    location ~ /\\. {{ deny all; }}
}}
'''
 write_config(file,http+'\n'+tls)
# Retain authenticated old API connections while redirecting public pages.
# Alias hosts must be explicit in the profile and already possess a certificate.
for alias in site.get('aliases',[]):
 old_host=urlparse(alias).hostname
 assert re.fullmatch(r'[a-z0-9.-]+',old_host) and old_host!=host
 old_cert=pathlib.Path('/etc/letsencrypt/live',old_host,'fullchain.pem')
 assert old_cert.exists(), 'Existing alias certificate is required'
 old_config=f'/etc/nginx/conf.d/{old_host}.conf'
 assert pathlib.Path(old_config).exists(), 'Inspect alias ownership before creating a router'
 alias_content=f'''server {{
    listen 80;
    listen [::]:80;
    server_name {old_host};
    location ^~ /.well-known/acme-challenge/ {{ root {base}/acme; default_type text/plain; try_files $uri =404; }}
    location / {{ return 301 https://{host}$request_uri; }}
}}
server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {old_host};
    ssl_certificate /etc/letsencrypt/live/{old_host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{old_host}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location ^~ /manage/api/ {{
        client_max_body_size 68m;
        proxy_pass http://127.0.0.1:{port};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 65s;
    }}
    location / {{ return 301 https://{host}$request_uri; }}
}}
'''
 write_config(old_config,alias_content)
subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('configure-domain-redirects.py')),'--site',site_id],check=True)
print(json.dumps({'siteId':site_id,'origin':site['origin'],'nginxBackup':str(backup)}))
