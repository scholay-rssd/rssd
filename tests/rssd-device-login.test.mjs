import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceLogin,authorizationRequest} from '../scripts/rssd-device-login.mjs';
test('headless authorization backs off and never emits device credentials',async()=>{
 const shown=[],waits=[];let polls=0;
 const fetcher=async(url,options)=>{
  assert.equal(options.redirect,'error');const body=JSON.parse(options.body);
  if(url.endsWith('/start'))return Response.json({deviceCode:'private-device-code',userCode:'ABCDEF1234',verificationUri:'https://center.example/rssd/authorize',verificationUriComplete:'https://center.example/rssd/authorize?code=ABCDEF1234',expiresIn:600,interval:5});
  assert.equal(body.deviceCode,'private-device-code');polls++;
  return polls===1?Response.json({code:'authorization_pending'},{status:400}):polls===2?Response.json({code:'slow_down'},{status:400}):Response.json({token:'private-token',identity:{workerId:'worker'}});
 };
 const result=await deviceLogin({origin:'https://center.example',emit:v=>shown.push(v),fetcher,sleep:async ms=>waits.push(ms)});
 assert.equal(result.token,'private-token');assert.deepEqual(waits,[5000,5000,10000]);assert(!JSON.stringify(shown).includes('private-'));
});
test('headless denial terminates without retry and authorization cannot redirect to another center',async()=>{
 await assert.rejects(authorizationRequest('https://center.example','token',{}, {fetcher:async()=>Response.json({message:'Denied',code:'access_denied'},{status:400})}),{code:'access_denied'});
 await assert.rejects(deviceLogin({origin:'https://center.example',emit:()=>assert.fail('No foreign address shown'),fetcher:async()=>Response.json({verificationUriComplete:'https://other.example/authorize'})}),/does not match/);
});
