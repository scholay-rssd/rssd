#!/usr/bin/env python3
"""Deploy an existing site's complete Theme through its unchanged publication queue.
Run inside an allowlisted package on the server. No credential values are logged.
"""
import hashlib,json,os,pathlib,re,shutil,sqlite3,subprocess,sys,time
site_id,port=sys.argv[1:]
assert site_id in ('personal','piggytuck') and port.isdigit()
source=pathlib.Path.cwd();base=pathlib.Path('/opt/scholay-sites')/site_id
config=pathlib.Path('/etc/scholay-sites')/site_id
node='/opt/scholay-admin/runtime/bin/node'
profile=next(s for s in json.loads((source/'sites/profiles.json').read_text()) if s['id']==site_id)
old_profile=json.loads((config/'site.json').read_text())
assert old_profile['id']==profile['id'] and old_profile['origin']==profile['origin']
assert (source/'theme-homepages'/profile['themeId']/'manifest.json').is_file()
# Verify that the explicitly supplied port is this site's existing listener.
health=json.loads(subprocess.check_output(['curl','--noproxy','*','-fsS',f'http://127.0.0.1:{port}/manage/api/site']))
assert health['siteId']==site_id
stamp=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
backup=pathlib.Path('/var/backups/scholay-sites')/site_id/('theme-'+stamp);backup.mkdir(parents=True,mode=0o700)
vhost=pathlib.Path('/etc/nginx/conf.d')/('piggytuck.com.conf' if site_id=='piggytuck' else 'pm.scholay.com.conf')
old_nginx=vhost.read_text();old_code=os.readlink(base/'app/current');old_web=os.readlink(base/'web/current')
shutil.copy2(vhost,backup/'nginx.conf');shutil.copy2(config/'site.json',backup/'site.json')
(backup/'pointers.json').write_text(json.dumps({'app':old_code,'web':old_web}))
legacy_root='/opt/piggytuck/current' if site_id=='piggytuck' else '/opt/today-scholay/out'
root_line=f'    root {legacy_root};'
new_line=f'    root {base}/web/current;'
assert old_nginx.count(root_line)==1 or old_nginx.count(new_line)==1
nginx=old_nginx.replace(root_line,new_line)
if site_id=='personal' and 'location ^~ /downloads/rimes/' not in nginx:
 resource=pathlib.Path('/opt/today-scholay/input-schemes-20261007');assert (resource/'SHA256SUMS').is_file()
 # The external, already published ZIP store is not copied into every release.
 nginx=nginx.replace(new_line,new_line+f'\n    location ^~ /downloads/rimes/ {{ alias {resource}/; }}')
services=[f'scholay-{site_id}-admin',f'scholay-{site_id}-publisher']
run=lambda args,**kwargs:subprocess.run(args,check=True,**kwargs)
def link(path,target):
 temporary=path.with_name('.theme-next');temporary.unlink(missing_ok=True);temporary.symlink_to(target);temporary.replace(path)
def connect():return sqlite3.connect(f'file:/var/lib/scholay-sites/{site_id}/admin.sqlite?mode=ro',uri=True)
def content_state(db):
 rows=db.execute('SELECT d.id,d.kind,d.permalink,d.latest_revision,d.published_revision,r.version,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id ORDER BY d.id,r.version').fetchall()
 return {'rows':len(rows),'sha256':hashlib.sha256(json.dumps(rows,ensure_ascii=False).encode()).hexdigest()}
release=base/'app/releases'/(stamp+'-theme');bridge=base/'web/releases'/stamp
changed=False;job_id=None
try:
 # mktemp archives can carry mode 0700 on their root. Both isolated service
 # users must be able to traverse this code directory before it is activated.
 source.chmod(0o755)
 run(['runuser','-u',f'schp-{site_id}','--',node,'--check',str(source/'admin/worker.mjs')])
 run(['runuser','-u',f'schp-{site_id}','--','test','-r',str(source/'theme-homepages'/profile['themeId']/'public/index.html')])
 run(['systemctl','stop',services[1],services[0]])
 with connect() as db:
  assert not db.execute("SELECT 1 FROM jobs WHERE status IN ('running','queued') LIMIT 1").fetchone(),'Pending publication; retry when queue is idle'
  if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_jobs'").fetchone():assert not db.execute("SELECT 1 FROM site_jobs WHERE status IN ('queued','running') LIMIT 1").fetchone(),'Pending site rebuild; retry when idle'
  before=content_state(db)
  with sqlite3.connect(backup/'admin.sqlite') as target:db.backup(target)
 (backup/'content-before.json').write_text(json.dumps(before))
 run([node,'scripts/prepare-theme-bridge.mjs',site_id,str(base/'web/current'),str(bridge)])
 run(['chown','-R',f'schp-{site_id}:schp-{site_id}',str(bridge)])
 shutil.move(str(source),release);os.chdir(release)
 updated={**old_profile,**profile}
 changed=True
 (config/'site.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n')
 link(base/'app/current',release);link(base/'web/current',bridge)
 vhost.write_text(nginx);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','start',services[0]])
 for attempt in range(30):
  probe=subprocess.run(['curl','--noproxy','*','-fsS',f'http://127.0.0.1:{port}/manage/health'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if probe.returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('Admin failed to restart')
 # Rebuild only the existing published snapshot; preserve all draft/review states.
 env={**os.environ,'SCHOLAY_ADMIN_DB':f'/var/lib/scholay-sites/{site_id}/admin.sqlite'}
 output=subprocess.check_output([node,'scripts/run-site.mjs',str(config/'site.json'),'cli','rebuild'],env=env,text=True)
 job_id=json.loads(output)['id'];assert re.fullmatch(r'[a-f0-9-]{36}',job_id)
 run(['systemctl','start',services[1]])
 print(json.dumps({'siteId':site_id,'jobId':job_id,'stage':'verifying','backup':str(backup)}),flush=True)
 # External orchestration polls this process; bounded sleeps leave user updates free.
 for attempt in range(240):
  with connect() as db:job=db.execute('SELECT status,error,release FROM site_jobs WHERE id=?',(job_id,)).fetchone()
  if job[0] in ('success','failed'):break
  time.sleep(1)
 if job[0]!='success':raise RuntimeError('Publication '+job[0]+': '+str(job[1]))
 with connect() as db:after=content_state(db)
 assert before==after,'Content changed during code deployment'
 manifest=json.loads((base/'web/current/release.json').read_text())
 assert manifest['jobId']==job_id and manifest['theme']['id']==profile['themeId'] and manifest.get('homepage')
 (backup/'acceptance.json').write_text(json.dumps({'siteId':site_id,'jobId':job_id,'content':after,'release':manifest['release'],'code':str(release)},indent=2))
 print(json.dumps({'siteId':site_id,'jobId':job_id,'status':'success','contentUnchanged':True,'release':manifest['release']}),flush=True)
except BaseException:
 if changed:
  run(['systemctl','stop',services[1],services[0]])
  # A timed-out deployment must not resume its pending job against rollback code.
  if job_id:
   with sqlite3.connect(f'/var/lib/scholay-sites/{site_id}/admin.sqlite') as db:
    db.execute("UPDATE site_jobs SET status='failed',finished=?,error=? WHERE id=? AND status IN ('queued','running')",(int(time.time()*1000),'Theme deployment rolled back; existing content retained',job_id))
  shutil.copy2(backup/'site.json',config/'site.json');vhost.write_text(old_nginx)
  link(base/'app/current',old_code);link(base/'web/current',old_web)
  run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','start',*services])
 raise
