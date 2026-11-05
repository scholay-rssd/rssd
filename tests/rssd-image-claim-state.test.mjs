import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const url=process.env.RSSD_IMAGE_TEST_DATABASE_URL;
test('real Center blocked/resume retains the original worker, token and generation', {skip:!url}, async()=>{
 const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.port!=='65018'||parsed.pathname!=='/rssd_image_claim')throw Error('Only the named isolated fixture database is permitted');
 process.env.DATABASE_URL=url;
 const require=createRequire(new URL('../center/package.json',import.meta.url));
 const {PrismaClient}=require('@prisma/client'),{RssdStore}=require('./rssd/store.cjs');
 const db=new PrismaClient(),store=new RssdStore(db),ctx={orgId:'image-test',workerId:'device-1',workspaceIds:['enter'],admin:false};
 try{
  await db.$executeRawUnsafe('INSERT INTO rssd_demands ("orgId",id,"workspaceId","sectionId",kind,title,state,generation,"workerId","claimToken",payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',ctx.orgId,'demand-1','enter','forums','write','Synthetic','claimed',4,ctx.workerId,'token-original','{}');
  await store.changeDemand(ctx,'demand-1',{action:'blocked',claimToken:'token-original',message:'image pending'});
  let [row]=await db.$queryRawUnsafe('SELECT state,generation,"workerId","claimToken" FROM rssd_demands WHERE "orgId"=$1 AND id=$2',ctx.orgId,'demand-1');
  assert.deepEqual(row,{state:'blocked',generation:4,workerId:'device-1',claimToken:'token-original'});
  await assert.rejects(store.changeDemand(ctx,'demand-1',{action:'resume',claimToken:'wrong'}),{code:'claim_revoked'});
  await store.changeDemand(ctx,'demand-1',{action:'resume',claimToken:'token-original'});
  [row]=await db.$queryRawUnsafe('SELECT state,generation,"workerId","claimToken" FROM rssd_demands WHERE "orgId"=$1 AND id=$2',ctx.orgId,'demand-1');
  assert.deepEqual(row,{state:'claimed',generation:4,workerId:'device-1',claimToken:'token-original'});
 }finally{await db.$executeRawUnsafe('DELETE FROM rssd_audit WHERE "orgId"=$1',ctx.orgId);await db.$executeRawUnsafe('DELETE FROM rssd_demands WHERE "orgId"=$1',ctx.orgId);await db.$disconnect();}
});
