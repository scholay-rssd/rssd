import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWebsitePublisher} from '../../scripts/website-publication.mjs';
import {workspaceRoot} from '../../scripts/editorial-workspace.mjs';

export async function websitePublisherCall(method,params={},client=createWebsitePublisher()){
  if(method==='queue_status'){
    const {publicationQueueSnapshot}=await import('../../scripts/publication-queue-status.mjs');
    const {siteForWorkspace}=await import('../../scripts/site-config.mjs');
    const root=client.root||workspaceRoot;
    return publicationQueueSnapshot({root,site:siteForWorkspace(root)});
  }
  if(method==='reconcile'){
    const publications=await client.reconcile();
    const {TaskStore}=await import('./agent/task-store.mjs');
    const tasks=await new TaskStore(client.root||workspaceRoot,{publisher:()=>client}).reconcileArticleDelivery({client});
    return {changed:publications.changed||tasks.changed,results:[...publications.results,...tasks.results]};
  }
  if(method==='snapshot')return client.snapshot();
  if(method==='refresh')return client.refresh();
  if(method==='published')return client.published(params.id,{cache:params.cache===true,notes:params.notes===true});
  if(method==='cloud')return client.cloud(params.id,{cache:params.cache===true,notes:params.notes===true});
  if(method==='private_notes')return client.privateNotes(params.id,{revision:Number.isSafeInteger(params.revision)?params.revision:undefined});
  if(method==='cloud_export')return client.exportCloud(params.id,{directory:params.directory});
  if(method==='cloud_action')return client.cloudAction(params.id,params);
  if(method==='cloud_action_status')return client.cloudActionStatus(params.id);
  if(method==='cloud_action_cached')return client.cloudActionCached(params.id);
  if(method==='local_action')return client.localAction(params.id,params);
  if(method==='pull')return client.pull(params.id,{expectedFingerprint:params.expectedFingerprint,source:params.source});
  if(method==='accept_merge')return client.acceptMerge(params.id,params);
  if(method==='inspect')return client.inspect(params.id);
  // 'draft' stores the manuscript in the cloud without making it public.
  if(method==='prepare'){return client.prepare(params.id,{intent:params.intent==='draft'?'draft':'publish',releaseLocal:params.releaseLocal===true,metadata:params.metadata,expectedSourceSha256:params.expectedSourceSha256,expectedMetadataSha256:params.expectedMetadataSha256});}
  if(method==='save_cloud'){
    if(params.confirmed!==true)throw Error('请明确确认保存到云端。');
    return process.env.SCHOLAY_DESKTOP_RUNTIME==='1'&&client.enqueue?client.enqueue(params.id,{packetSha256:params.packetSha256,retry:params.retry===true,intent:'draft'}):client.saveCloud(params.id,{packetSha256:params.packetSha256,retry:params.retry===true});
  }
  if(method==='publish'){
    if(params.confirmed!==true)throw Error('请在预览后明确确认推送到官网。');
    return process.env.SCHOLAY_DESKTOP_RUNTIME==='1'&&client.enqueue?client.enqueue(params.id,{packetSha256:params.packetSha256,retry:params.retry===true}):client.publish(params.id,{packetSha256:params.packetSha256,retry:params.retry===true});
  }
  if(method==='status')return client.status(params.id);
  throw Error('Unknown website publishing operation');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(input.length>20000)throw Error('Request too large');if(input.endsWith('\n'))break;}const {method,params}=JSON.parse(input);process.stdout.write(JSON.stringify(await websitePublisherCall(method,params)));}
  catch(e){process.stderr.write(e.message);process.exitCode=1;}
}
