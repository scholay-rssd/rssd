#!/usr/bin/env python3
"""Upgrade the existing academic service without changing its data/configuration.
The optional identical-pages gate is used for the first Theme migration.
"""
import hashlib,json,os,pathlib,re,shutil,sqlite3,subprocess,sys,time
refresh=len(sys.argv)>1 and sys.argv[1]=='--refresh-site'
identical=len(sys.argv)>2 and sys.argv[2]=='1'
source=pathlib.Path.cwd();node='/opt/scholay-admin/runtime/bin/node'
app=pathlib.Path('/opt/scholay-admin');web=pathlib.Path('/opt/scholay-today-web')
database='/var/lib/scholay-admin/admin.sqlite'
services=['scholay-admin','scholay-publisher']
run=lambda args,**kw:subprocess.run(args,check=True,**kw)
def connect():return sqlite3.connect('file:'+database+'?mode=ro',uri=True)
def content_state(db):
 rows=db.execute('SELECT d.id,d.kind,d.permalink,d.latest_revision,d.published_revision,r.version,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id ORDER BY d.id,r.version')
 # Worker heartbeat and authentication metadata legitimately change at runtime;
 # only the metadata used to render published content belongs in this digest.
 meta=db.execute("SELECT key,value FROM meta WHERE key IN ('calendarMeta','sourceMeta','initialized') ORDER BY key").fetchall()
 # Keep the original receipt digest, but never hold all revision payloads or
 # their serialized copy in memory alongside the publisher on small hosts.
 digest=hashlib.sha256();encoder=json.JSONEncoder(ensure_ascii=False);count=0
 digest.update(b'[[')
 for row in rows:
  if count:digest.update(b', ')
  for chunk in encoder.iterencode(row):digest.update(chunk.encode())
  count+=1
 digest.update(b'], ')
 for chunk in encoder.iterencode(meta):digest.update(chunk.encode())
 digest.update(b']')
 return {'rows':count,'sha256':digest.hexdigest()}
def public_files(directory):
 return {str(p.relative_to(directory)):hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.rglob('*') if p.is_file() and p.name not in ['release.json','data.json','open-source.json']}
def link(path,target):
 temp=path.with_name('.theme-next');temp.unlink(missing_ok=True);temp.symlink_to(target);temp.replace(path)
def healthy():
 for attempt in range(30):
  if subprocess.run(['curl','--noproxy','*','--max-time','5','-fsS','http://127.0.0.1:4180/manage/health'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return
  time.sleep(1)
 raise RuntimeError('Academic admin failed to restart')
stamp=time.strftime('%Y%m%d-%H%M%S',time.gmtime());backup=pathlib.Path('/var/backups/scholay-sites/scholay-today')/('theme-'+stamp);backup.mkdir(parents=True,mode=0o700)
old_code=os.readlink(app/'current');old_web=os.readlink(web/'current')
(backup/'pointers.json').write_text(json.dumps({'app':old_code,'web':old_web}))
shutil.copy2('/etc/nginx/conf.d/today.scholay.com.conf',backup/'nginx.conf')
vhost=pathlib.Path('/etc/nginx/conf.d/today.scholay.com.conf');old_nginx=vhost.read_text()
release=app/'releases'/(stamp+'-theme');changed=False;job_id=None
try:
 source.chmod(0o755)
 run(['runuser','-u','scholay-publisher','--',node,'--check',str(source/'admin/worker.mjs')])
 run(['runuser','-u','scholay-publisher','--','test','-r',str(source/'web/themes/academic/public/index.html')])
 run(['systemctl','stop',services[1],services[0]])
 with connect() as db:
  assert not db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").fetchone(),'Publication queue must be idle'
  if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_jobs'").fetchone():assert not db.execute("SELECT 1 FROM site_jobs WHERE status IN ('queued','running') LIMIT 1").fetchone(),'Pending site rebuild; retry when idle'
  before=content_state(db)
  with sqlite3.connect(backup/'admin.sqlite') as target:db.backup(target)
 prior_files=public_files((web/'current').resolve()) if identical else {}
 (backup/'content-before.json').write_text(json.dumps(before))
 shutil.move(str(source),release);os.chdir(release);changed=True;link(app/'current',release)
 if 'location ^~ /guestbook/' not in old_nginx:
  marker='    location / { try_files $uri $uri/ =404; }'
  assert old_nginx.count(marker)==1,'Inspect academic vhost before updating guestbook'
  guestbook='''    location = /guestbook { return 302 /guestbook/; }
    location ^~ /guestbook/ {
        proxy_pass http://127.0.0.1:4180;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
'''
  vhost.write_text(old_nginx.replace(marker,guestbook+marker));run(['nginx','-t']);run(['systemctl','reload','nginx'])

 run([sys.executable,str(release/'scripts/configure-academic-cache.py')])
 run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','start',services[0]]);healthy()
 if refresh:
  output=subprocess.check_output([node,'admin/cli.mjs','rebuild'],env={**os.environ,'SCHOLAY_ADMIN_DB':database},text=True)
  job_id=json.loads(output)['id'];assert re.fullmatch(r'[a-f0-9-]{36}',job_id)
 run(['systemctl','start',services[1]])
 if refresh:
  print(json.dumps({'jobId':job_id,'stage':'verifying','backup':str(backup)}),flush=True)
  for attempt in range(300):
   with connect() as db:job=db.execute('SELECT status,error FROM site_jobs WHERE id=?',(job_id,)).fetchone()
   if job[0] in ('success','failed'):break
   time.sleep(1)
  assert job[0]=='success','Publication '+str(job)
  manifest=json.loads((web/'current/release.json').read_text());assert manifest['jobId']==job_id and manifest['theme']['id']=='academic'
  if identical:
   current_files=public_files((web/'current').resolve());differences=[p for p,h in prior_files.items() if current_files.get(p)!=h]
   (backup/'page-differences.json').write_text(json.dumps(differences))
   assert not differences,'Published page differences: '+str(differences[:10])
 with connect() as db:after=content_state(db)
 assert before==after,'Academic content changed during upgrade'
 receipt={'status':'success','jobId':job_id,'code':str(release),'contentUnchanged':True,'verifiedExistingFiles':len(prior_files),'backup':str(backup)}
 (backup/'acceptance.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt),flush=True)
except BaseException:
 if changed:
  run(['systemctl','stop',services[1],services[0]])
  if job_id:
   with sqlite3.connect(database) as db:db.execute("UPDATE site_jobs SET status='failed',finished=?,error=? WHERE id=? AND status IN ('queued','running')",(int(time.time()*1000),'Theme deployment rolled back; content retained',job_id))
  link(app/'current',old_code);link(web/'current',old_web)
  vhost.write_text(old_nginx);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','start',*services]);raise
