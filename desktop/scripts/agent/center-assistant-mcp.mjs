// Private stdio proxy: only the local host possesses the center credential.
import {createInterface} from 'node:readline';
const address=process.env.RSSD_ASSISTANT_BRIDGE,key=process.env.RSSD_ASSISTANT_KEY;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(address||'')||!key)throw Error('Missing assistant host');
async function request(path,params){const r=await fetch(address+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(60000)});const value=await r.json();if(!r.ok)throw Error(value.error||'Tool failed');return value;}
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 if(line.length>1000000)continue;
 void(async()=>{let m;try{m=JSON.parse(line);if(m.id===undefined)return;let result;
 if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,serverInfo:{name:'rssd-center',version:'1.0.0'},capabilities:{tools:{}}};
 else if(m.method==='tools/list')result={tools:await request('/tools',{})};
 else if(m.method==='tools/call'){try{result=await request('/call',m.params);}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}}
 else if(m.method==='ping')result={};else throw Error('Unsupported method');
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
 }catch(e){if(m?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:e.message}})+'\n');}})();
}
