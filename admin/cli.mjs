import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import * as argon2 from '@node-rs/argon2';
import {openStore,seedStore,audit,setReview,enqueue,enqueueSiteBuild} from './store.mjs';
import {secret,passwordOptions,validPassword} from './server.mjs';
import {digest} from './model.mjs';

const [command,...args]=process.argv.slice(2);
const dbPath=process.env.SCHOLAY_ADMIN_DB||resolve('.admin-local/admin.sqlite');
if(command==='import') {
  const file=args[0],kind=args[1],token=process.env.SCHOLAY_INGEST_TOKEN,origin=process.env.SCHOLAY_ADMIN_ORIGIN||'https://today.scholay.com';
  if(!token)throw new Error('Set SCHOLAY_INGEST_TOKEN in your environment');
  const input=JSON.parse(await readFile(file,'utf8'));
  const items=Array.isArray(input)?input:kind==='openSource'?input.items:input[kind];
  if(!Array.isArray(items))throw new Error('Input must contain selected section array');
  const result={created:0,exists:0,error:0};
  for(const item of items){
    const response=await fetch(origin+'/manage/api/import',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({items:[{kind,data:item}]})});
    if(!response.ok)throw new Error('Import failed: '+response.status);
    for(const row of (await response.json()).results){result[row.status]++;if(row.status==='error')console.error(row.message);}
    await new Promise(resolve=>setTimeout(resolve,1100));
  }
  console.log(JSON.stringify(result));
}else{
  const db=openStore(dbPath);
  try {
    if(command==='seed'){console.log(seedStore(db,resolve(args[0]||'.'))?'Imported published snapshot.':'Already initialized; existing edits preserved.');}
    else if(command==='setup'){
      if(db.prepare('SELECT 1 FROM users LIMIT 1').get())throw new Error('An administrator already exists');
      if(!args[0])throw new Error('Provide private output file path');
      const token=secret();
      await mkdir(dirname(resolve(args[0])),{recursive:true,mode:0o700});
      await writeFile(args[0],token+'\n',{mode:0o600,flag:'wx'});
      db.prepare("INSERT INTO meta VALUES('setup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({hash:digest(token),expires:Date.now()+7*86400000}));
      console.log('One-time setup code saved. Expires in 7 days.');
    }else if(command==='worker-token'){
      if(!args[0])throw new Error('Provide private output file path');
      const token=secret();
      await writeFile(args[0],'SCHOLAY_WORKER_TOKEN='+token+'\n',{mode:0o600,flag:'wx'});
      db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(randomUUID(),'server-publisher',digest(token),'publisher',Date.now());
      console.log('Publisher credential saved.');
    }else if(command==='content-token'||command==='editorial-token'||command==='editorial-draft-token'){
      if(!args[0])throw new Error('Provide private output file path');
      const token=secret();
      await writeFile(args[0],token+'\n',{mode:0o600,flag:'wx'});
      db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(randomUUID(),'local-editorial-publisher',digest(token),command==='editorial-draft-token'?'editorial_draft':command==='editorial-token'?'editorial_publish':'news_publish',Date.now());
      console.log('Article publishing credential saved to private file.');
    }else if(command==='reset-password'){
      const user=db.prepare('SELECT * FROM users WHERE username=?').get(args[0]);if(!user)throw new Error('Administrator not found');
      let password='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)password+=chunk;password=password.replace(/\r?\n$/,'');
      const hash=await argon2.hash(validPassword(password),passwordOptions);
      db.transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(hash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);audit(db,'local-admin','auth.password',user.id);})();
      console.log('Password reset; all sessions revoked.');
    }else if(command==='backup'){
      if(!args[0])throw new Error('Provide backup filename');
      await db.backup(args[0]);console.log('Database backup completed.');
    }else if(command==='rebuild'){
      console.log(JSON.stringify(enqueueSiteBuild(db)));
    }else if(command==='rebuild-status'){
      console.log(JSON.stringify(db.prepare('SELECT id,status,created,finished,error,release FROM site_jobs WHERE id=?').get(args[0])||null));
    }else if(command==='verify-publication'){
      const row=db.prepare("SELECT * FROM documents d WHERE published_revision=latest_revision AND kind='year' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.document_id=d.id AND j.status IN ('queued','running')) LIMIT 1").get();
      if(!row)throw new Error('No baseline content');
      setReview(db,row.id,row.latest_revision,'approved','deployment-check');
      console.log('Queued unchanged baseline:',enqueue(db,row.id,row.latest_revision,'publish',Date.now(),'deployment-check').id);
    }else throw new Error('Commands: seed, setup, worker-token, content-token, editorial-token, editorial-draft-token, reset-password, backup, import, rebuild, rebuild-status, verify-publication');
  } finally {db.close();}
}
