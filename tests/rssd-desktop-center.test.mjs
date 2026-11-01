import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {writeCenterJson} from '../scripts/rssd-center-client.mjs';

test('native center bridge preserves paging and search through the HTTP client',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-center-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const requests=[];
  const server=createServer((request,response)=>{
    requests.push(new URL(request.url,'http://localhost'));
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify([{id:'second-page-item'}]));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{
    origin:'http://127.0.0.1:'+server.address().port,
    token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'example'}
  });
  for(const method of ['works','demands','publications']){
    const result=await centerDesktopCall(method,{workspaceId:'example',limit:51,offset:50,search:'research methods'},home);
    assert.deepEqual(result,[{id:'second-page-item'}]);
    const url=requests.at(-1);
    assert.equal(url.pathname,'/api/rssd/v1/'+method);
    assert.deepEqual(Object.fromEntries(url.searchParams),{
      workspaceId:'example',limit:'51',offset:'50',...(method==='publications'?{}:{search:'research methods'})
    });
  }
});
