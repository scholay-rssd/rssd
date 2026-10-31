// Run privately on the site host. No public service or deployment is required.
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import Database from '../admin/sqlite.mjs';
import {SITE} from './site-config.mjs';
import {AUTHORIZATION_FORMAT,validateAuthorization,parseAuthorization,authorizationSummary} from '../contracts/site-authorization.mjs';

const digest=token=>createHash('sha256').update(token).digest('hex');
export function issueSiteAuthorization(db,site,file){
  if(existsSync(file)){
    if(statSync(file).size>64*1024)throw Error('已有文件过大，未签发新凭证');
    const existing=parseAuthorization(readFileSync(file,'utf8'));
    const token=db.prepare('SELECT hash,scope,revoked FROM tokens WHERE id=?').get(existing.credential.id);
    if(existing.site.id!==site.id||existing.site.spaceId!==site.spaceId||existing.site.origin!==site.origin||!token||token.revoked!==null||token.scope!==existing.credential.scope||token.hash!==digest(existing.credential.token))throw Error('已有授权文件与站点或有效凭证不一致；请使用新的输出路径');
    return {...authorizationSummary(existing),existing:true};
  }
  const authorization=validateAuthorization({format:AUTHORIZATION_FORMAT,version:1,issuedAt:new Date().toISOString(),site,credential:{id:randomUUID(),scope:'editorial_publish',token:randomBytes(32).toString('base64url')}});
  const bytes=JSON.stringify(authorization,null,2)+'\n';
  mkdirSync(dirname(resolve(file)),{recursive:true,mode:0o700});
  let written=false;
  try{
    db.transaction(()=>{
      db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run(authorization.credential.id,'workbench-file:'+site.id,digest(authorization.credential.token),authorization.credential.scope,Date.now());
      db.prepare('INSERT INTO audit(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(Date.now(),'local-admin','site-authorization.issue',authorization.credential.id,site.id);
      writeFileSync(file,bytes,{mode:0o600,flag:'wx'});written=true;
    })();
  }catch(error){if(written)rmSync(file,{force:true});throw error;}
  return {...authorizationSummary(authorization),existing:false};
}

export function revokeSiteAuthorization(db,id){
  if(typeof id!=='string'||!db.prepare("SELECT 1 FROM tokens WHERE id=? AND name LIKE 'workbench-file:%'").get(id))throw Error('未找到站点授权文件凭证');
  db.transaction(()=>{
    db.prepare('UPDATE tokens SET revoked=coalesce(revoked,?) WHERE id=?').run(Date.now(),id);
    db.prepare('INSERT INTO audit(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(Date.now(),'local-admin','site-authorization.revoke',id,'');
  })();
  return {credentialId:id,revoked:true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let db;
  try{
    const [command,argument]=process.argv.slice(2),path=process.env.SCHOLAY_ADMIN_DB;
    if(!path||!existsSync(path))throw Error('请指定已存在的站点 SCHOLAY_ADMIN_DB');
    if(!argument||!['issue','revoke'].includes(command))throw Error('用法：issue <私有输出路径> 或 revoke <credentialId>');
    db=new Database(path);db.pragma('busy_timeout=5000');
    const result=command==='issue'?issueSiteAuthorization(db,SITE,argument):revokeSiteAuthorization(db,argument);
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('站点授权操作未完成：请检查站点配置、私有输出路径和数据库；已有文件不会覆盖。\n');process.exitCode=1;}
  finally{db?.close();}
}
