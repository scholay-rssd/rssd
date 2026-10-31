import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import {profiles,validateSite} from './site-config.mjs';
import {guestbookConfig} from '../admin/guestbook/config.mjs';

/** Export a consistent backup, retaining anonymous identities, moderation and quota. */
export async function exportGuestbook({database,site,output}){
 site=validateSite(site);const db=new DatabaseSync(resolve(database),{readOnly:true});
 try{
  db.exec('BEGIN');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Guestbook integrity failed');
  const source=Object.fromEntries(['guestbook_meta','messages','guard'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()]));
  if(source.guestbook_meta.find(r=>r.key==='site')?.value!==site.id)throw Error('Guestbook site mismatch');
  const value={version:1,siteId:site.id,workspaceId:site.spaceId,config:guestbookConfig(site),source,sourceHash:p.hash(source),databaseSha256:createHash('sha256').update(await readFile(database)).digest('hex')};
  await mkdir(dirname(resolve(output)),{recursive:true,mode:0o700});await writeFile(output,JSON.stringify(value),{mode:0o600});return {siteId:site.id,sourceHash:value.sourceHash,messages:source.messages.length,guards:source.guard.length};
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [siteId,database,output]=process.argv.slice(2),site=profiles.find(s=>s.id===siteId);
 if(!site||!database||!output||!resolve(output).split(/[\\/]/).includes('.local'))throw Error('Usage: rssd-migrate-guestbook.mjs SITE SNAPSHOT.sqlite .local/PRIVATE.json');
 console.log(JSON.stringify(await exportGuestbook({database,site,output})));
}
