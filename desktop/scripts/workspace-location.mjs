import {workspaceInfo,selectWorkspace,initializeWorkspace} from '../../scripts/editorial-location.mjs';
try{
  let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(input.length>20000)throw Error('Request too large');if(input.endsWith('\n'))break;}
  const {method,params}=JSON.parse(input);
  if(!['info','select','initialize'].includes(method))throw Error('Unknown directory operation');
  process.stdout.write(JSON.stringify(method==='initialize'?await initializeWorkspace(params.path):method==='select'?await selectWorkspace(params.path):await workspaceInfo()));
}catch(e){process.stderr.write(e.message);process.exitCode=1;}
