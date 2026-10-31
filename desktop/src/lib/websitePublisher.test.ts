// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import WebsitePublisher from '../publications/WebsitePublisher';
import type {WebsiteDraftDetail,WebsitePublishingSnapshot} from '../publications/websitePublishing';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('../editorial/EditorialRichEditor',()=>({default:({text,onChange}:{text:string;onChange:(value:string)=>void})=>createElement('textarea',{'aria-label':'Markdown 正文',value:text,onChange:(event:{target:{value:string}})=>onChange(event.target.value)})}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../editorial/NoteCardsPreview',()=>({default:({text}:{text:string})=>createElement('div',{'data-note-draft':text})}));
vi.mock('../publications/PublicationReader',()=>({default:()=>createElement('div',{'data-native-reader':true})}));
const metadata={date:'2026-10-02',summary:'已核对来源的摘要',author:'编辑部',category:'新闻聚合'};
let detail:WebsiteDraftDetail,snapshot:WebsitePublishingSnapshot,host:HTMLDivElement,root:Root;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  detail={id:'local-news',title:'本地新闻',canonicalPath:'articles/annex/新闻聚合/正文.md',sourceSha256:'source',metadata,metadataSha256:'metadata',stage:'local',stale:false,validation:'',receipt:null,html:'<h1>本地新闻</h1><p>正文</p>',warnings:[],prepared:null};
  snapshot={connection:{configured:true,origin:'https://today.scholay.com'},articles:[{id:detail.id,shortTitle:detail.title,canonicalPath:detail.canonicalPath,batchDate:null,stage:'local',receipt:null,preparedAt:null}]};
  invoke.mockReset().mockImplementation(async(_command,args)=>{
    if(args.method==='draft_private_notes')return null;
    if(args.method==='snapshot')return structuredClone(snapshot);
    if(args.method==='inspect')return structuredClone(detail);
    if(args.method==='prepare'){detail={...detail,stage:'prepared',metadata:{...args.params.metadata},prepared:{requestKey:'stable-request',packetSha256:'packet',sourceSha256:'source',preparedAt:'2026-10-02T01:00:00Z',intent:args.params.intent,expectedVersion:0,title:'本地新闻',metadata:{...args.params.metadata},assetCount:0}};}
    if(args.method==='save_cloud'){detail={...detail,stage:'draft_saved',receipt:{requestKey:'stable-request'}};}
    if(args.method==='publish'){detail={...detail,stage:'queued',receipt:{requestKey:'stable-request',job:{id:'job-1',status:'queued'},url:'/news/local-news/'}};}
    if(args.method==='status'){detail={...detail,stage:'published',receipt:{requestKey:'stable-request',job:{id:'job-1',status:'success'},url:'/news/local-news/',publicReadback:true}};}
    snapshot.articles[0].stage=detail.stage;return structuredClone(detail);
  });
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
const render=async(active=true,publish=true)=>{await act(async()=>root.render(createElement(WebsitePublisher,{active,onOpenDraft:vi.fn()})));if(publish)await act(()=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="推送用途"]');if(select){select.value='publish';select.dispatchEvent(new Event('change',{bubbles:true}));}});};
const renderCompact=()=>act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
const button=(label:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(x=>x.textContent===label)!;
const click=(label:string)=>act(async()=>button(label).click());
it('starts from local manuscripts and requires preview plus explicit confirmation before sending',async()=>{
  await render();expect(host.textContent).toContain('本地稿件 → 预览确认');expect(invoke.mock.calls.every(([command,a])=>command==='website_publish_call'&&['snapshot','inspect'].includes(a.method)||command==='editorial_call'&&a.method==='draft_private_notes')).toBe(true);
  expect(button('推送到官网')).toBeUndefined();
  await click('生成官网预览');await click('推送到官网');
  expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(false);
  expect(host.querySelector('[aria-label="确认官网推送"]')?.textContent).toContain('本地新闻');
  await click('确认推送到官网');
  expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'publish',params:{id:'local-news',confirmed:true,packetSha256:'packet',retry:false}});
  expect(host.textContent).toContain('服务器排队中');expect(host.textContent).not.toContain('官网已公开');
  await click('查询服务器状态');expect(host.textContent).toContain('官网已公开');
});
it('metadata edits invalidate the confirmation and hide the submit action until another preview',async()=>{
  await render();await click('生成官网预览');await click('推送到官网');
  await act(()=>{const input=host.querySelector<HTMLTextAreaElement>('[aria-label="官网公开摘要"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'修改后的摘要');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('[aria-label="确认官网推送"]')).toBeNull();expect(button('推送到官网')).toBeUndefined();expect(host.textContent).toContain('尚未写入预览');
  await click('重新生成预览');expect(button('推送到官网')).toBeDefined();
});
it('uncertain submission remains queryable and does not generate a new request',async()=>{
  await render();await click('生成官网预览');await click('推送到官网');
  const original=invoke.getMockImplementation()!;invoke.mockImplementation(async(command,args)=>{if(args.method==='publish'){detail={...detail,stage:'unknown',receipt:{requestKey:'stable-request'}};throw Error('提交超时');}return original(command,args);});
  await click('确认推送到官网');
  expect(button('重新生成预览').disabled).toBe(true);expect(button('查询服务器状态')).toBeDefined();expect(button('重试原请求')).toBeDefined();
  expect(invoke.mock.calls.filter(([,a])=>a.method==='publish')).toHaveLength(1);
});
it('drops a polling collision after the original request has been publicly verified',async()=>{
 await render();await click('生成官网预览');await click('推送到官网');await click('确认推送到官网');
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(args.method==='status'){
   detail={...detail,stage:'published',receipt:{requestKey:'stable-request',job:{id:'job-1',status:'success'},url:'/news/local-news/',publicReadback:true}};
   throw Error('该稿件正在执行官网操作，请稍后再试。');
  }
  return original(command,args);
 });
 await click('查询服务器状态');expect(host.textContent).toContain('官网已公开');expect(host.textContent).not.toContain('该稿件正在执行官网操作');
 expect(invoke.mock.calls.filter(([,args])=>args.method==='publish')).toHaveLength(1);
});
it('inactive workspaces cannot submit and missing credentials keep preparation unavailable',async()=>{
  snapshot.connection={configured:false,origin:'https://today.scholay.com',message:'未配置凭证'};await render();expect(button('生成官网预览').disabled).toBe(true);
  expect(host.textContent).toContain('未配置凭证');await render(false);expect(button('生成官网预览').disabled).toBe(true);
});
it('embedded delivery explains missing credentials instead of only disabling preview',async()=>{
  snapshot.connection={configured:false,origin:'https://today.scholay.com'};
  await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('设置 → 账号与连接');
  expect(button('生成预览').disabled).toBe(true);
  expect(invoke.mock.calls.some(([,a])=>['publish','save_cloud'].includes(a.method))).toBe(false);
});

it('new cloud delivery always publishes and exposes no private destination choice',async()=>{
  await render();expect(host.querySelector('[aria-label="推送用途"]')).toBeNull();expect(host.textContent).not.toContain('保存云端草稿');
  await click('生成官网预览');expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params.intent).toBe('publish');await click('推送到官网');await click('确认推送到官网');
  expect(invoke.mock.calls.some(([,a])=>a.method==='save_cloud')).toBe(false);expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(true);
});
it('workflow delivery moves preview and final confirmation actions into navigation',async()=>{
 const nav=document.createElement('nav');host.append(nav);
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,actionHost:nav,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
 // React clears the host on first render; portal target remains valid independently.
 document.body.append(nav);
 const find=(label:string)=>[...nav.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;
 await act(async()=>find('生成预览').click());await act(async()=>find('推送到官网').click());
 expect(find('确认推送到官网')).toBeDefined();expect(find('生成预览')).toBeUndefined();expect(invoke.mock.calls.some(([,a])=>a.method==='save_cloud')).toBe(false);
 await act(async()=>find('取消').click());expect(find('推送到官网')).toBeDefined();nav.remove();
});


it('delivery controls stay beside the editor and publish only after confirmation',async()=>{
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,controlsOnly:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
 expect(host.querySelector('.publisher-controls-only')).not.toBeNull();expect(host.querySelector('[aria-label="官网推送预览"]')).toBeNull();expect(host.querySelector('[aria-label="推送用途"]')).toBeNull();await click('检查稿件');await click('推送到官网');
 expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(false);await click('确认推送到官网');expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(true);expect(invoke.mock.calls.some(([,a])=>a.method==='save_cloud')).toBe(false);
});

it('blocks new cloud submission for an invalid draft while preserving status queries on the original request',async()=>{
 const onPending=vi.fn();detail={...detail,stage:'unknown',receipt:{requestKey:'stable-request'}};
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,controlsOnly:true,submissionBlocked:true,onPending,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
 expect(onPending).toHaveBeenCalledWith(true);expect(button('检查稿件').disabled).toBe(true);expect(button('查询服务器状态').disabled).toBe(false);expect(invoke.mock.calls.some(([,a])=>['publish','save_cloud'].includes(a.method))).toBe(false);
});
it('refreshes saved editor changes before another cloud submission without rerunning preparation',async()=>{
 const props={active:true,embedded:true,controlsOnly:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()};await act(async()=>root.render(createElement(WebsitePublisher,{...props,refreshToken:0})));await click('检查稿件');expect(button('推送到官网')).toBeDefined();
 detail={...detail,stale:true,sourceSha256:'changed-body'};await act(async()=>root.render(createElement(WebsitePublisher,{...props,refreshToken:1})));
 expect(button('推送到官网')).toBeUndefined();expect(invoke.mock.calls.filter(([,a])=>a.method==='prepare')).toHaveLength(1);expect(invoke.mock.calls.some(([,a])=>['publish','save_cloud'].includes(a.method))).toBe(false);
});

it('compact delivery keeps one action and removes cloud visibility choices',async()=>{
 await renderCompact();expect(host.querySelector('[aria-label="推送用途"]')).toBeNull();expect(host.querySelector('.website-submit-actions')?.textContent).toBe('生成预览');
 await click('生成预览');expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'prepare',params:{id:'local-news',intent:'publish',releaseLocal:false,metadata,expectedSourceSha256:'source',expectedMetadataSha256:'metadata'}});
 expect(host.querySelector('.website-submit-actions')?.textContent).toBe('推送到官网');await click('推送到官网');expect(host.querySelector('.website-submit-actions')).toBeNull();await click('确认推送到官网');
 expect(invoke.mock.calls.some(([,a])=>a.method==='save_cloud')).toBe(false);
});

it('compact delivery prepares the chosen public intent and publishes only after its explicit confirmation',async()=>{
 await renderCompact();

 await click('生成预览');
 expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params.intent).toBe('publish');
 expect(host.querySelector('.website-submit-actions')?.textContent).toBe('推送到官网');
 await click('推送到官网');
 expect(host.querySelector('[aria-label="确认官网推送"]')?.textContent).toContain('确认公开');
 expect(invoke.mock.calls.some(([,a])=>['save_cloud','publish'].includes(a.method))).toBe(false);
 await click('确认推送到官网');
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'publish',params:{id:'local-news',confirmed:true,packetSha256:'packet',retry:false}});
 expect(invoke.mock.calls.some(([,a])=>a.method==='save_cloud')).toBe(false);
 expect(host.querySelector('.website-submit-actions')?.textContent).toBe('查询原任务');
 expect(host.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('.website-compose input,.website-compose textarea').length).toBeGreaterThan(0);
 expect([...host.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('.website-compose input,.website-compose textarea')].every(input=>input.disabled)).toBe(true);
});

it('compact local editing of an existing cloud revision does not invent a pending server task',async()=>{
 detail={...detail,receipt:{requestKey:'previous-save',revision:1}};
 await renderCompact();
 expect(host.textContent).toContain('云端版本：1');
 expect(host.textContent).not.toContain('服务器任务');
 expect(host.textContent).not.toContain('待查询提交结果');
 expect(button('查询原任务')).toBeUndefined();
 expect(button('重试原请求')).toBeUndefined();
 expect(host.querySelector('.website-submit-actions')?.textContent).toBe('生成预览');
 expect(invoke.mock.calls.some(([,a])=>a.method==='status')).toBe(false);
});

it('compact delivery restores an uncertain public packet and queries or retries the original request with locked metadata',async()=>{
 detail={...detail,stage:'unknown',receipt:{requestKey:'stable-request'},prepared:{requestKey:'stable-request',packetSha256:'original-packet',sourceSha256:'source',preparedAt:'2026-10-02T01:00:00Z',intent:'publish',expectedVersion:1,title:'本地新闻',metadata,assetCount:0}};
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>args.method==='status'?structuredClone(detail):original(command,args));
 await renderCompact();
 expect(host.querySelector('[aria-label="推送用途"]')).toBeNull();
 expect([...host.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('.website-compose input,.website-compose textarea')].every(input=>input.disabled)).toBe(true);
 expect(host.querySelector('.website-submit-actions')?.textContent).toBe('查询原任务');
 expect(button('生成预览')).toBeUndefined();
 await click('查询原任务');
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'status',params:{id:'local-news'}});
 await click('重试原请求');
 expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(false);
 await click('确认推送到官网');
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'publish',params:{id:'local-news',confirmed:true,packetSha256:'original-packet',retry:true}});
 expect(invoke.mock.calls.some(([,a])=>['prepare','save_cloud'].includes(a.method))).toBe(false);
});

it('edits body in the publishing pane, saves with its source hash and keeps dirty text across inactive tabs',async()=>{
 const original=invoke.getMockImplementation()!;let source={markdown:'# 原稿\n\n原始正文',sha256:'source'};
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){
   if(args.method==='draft_read')return {...source};
   if(args.method==='draft_preview')return {html:'<p>'+args.params.markdown+'</p>'};
   if(args.method==='draft_save'){expect(args.params.expectedSha256).toBe('source');source={markdown:args.params.markdown,sha256:'saved'};detail.sourceSha256='saved';return {...source};}
  }return original(command,args);
 });
 // A public article: its push publishes the update.
 detail={...detail,sync:{state:'local_changed',baseRevision:1,remoteRevision:1,publishedRevision:1}};
 const props={active:true,embedded:true,editable:true,retireLocal:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()};
 await act(async()=>root.render(createElement(WebsitePublisher,props)));await click('编辑');
 await act(()=>{const input=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'# 新正文\n\n直接在这里编辑');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>root.render(createElement(WebsitePublisher,{...props,active:false})));await act(async()=>root.render(createElement(WebsitePublisher,props)));
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')?.value).toContain('直接在这里编辑');expect(button('保存')).toBeDefined();expect(button('生成预览')).toBeUndefined();expect(button('保存修改并检查')).toBeUndefined();
 expect(invoke.mock.calls.some(([,a])=>a.method==='draft_save')).toBe(false);
 // Push is available while editing and previews share the same saved source.
 expect(button('推送到官网')).toBeUndefined();expect(button('存到云端')).toBeUndefined();expect(button('复制公众号图文')).toBeUndefined();
 await click('图文笔记预览');expect(host.querySelector('[data-note-draft]')?.getAttribute('data-note-draft')).toBe('# 新正文\n\n直接在这里编辑');
 expect(invoke.mock.calls.some(([,args])=>['draft_save','prepare','publish','save_cloud'].includes(args.method))).toBe(false);
 expect(button('推送到官网')).toBeUndefined();expect(button('存到云端')).toBeUndefined();
 await click('编辑');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')?.value).toBe('# 新正文\n\n直接在这里编辑');
 await click('保存');expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_save')).toHaveLength(1);expect(button('编辑').getAttribute('aria-pressed')).toBe('true');await click('官网预览');expect(button('官网预览').getAttribute('aria-pressed')).toBe('true');
 await click('公众号预览');expect(button('推送到官网')).toBeUndefined();expect(button('存到云端')).toBeUndefined();expect(host.querySelector('.website-compose-heading .wechat-copy')).not.toBeNull();expect(host.querySelectorAll('.website-compose-heading [aria-label="排版风格"] button')).toHaveLength(4);expect(host.querySelector('.wechat-toolbar')).toBeNull();
 await click('官网预览');expect(host.querySelector('.wechat-copy')).toBeNull();
 await click('导出');expect(invoke).toHaveBeenCalledWith('editorial_export_directory',{path:'articles/annex/新闻聚合'});
 await click('用 Cursor 打开');expect(invoke).toHaveBeenCalledWith('editorial_open_directory',{path:'articles/annex/新闻聚合',target:'cursor',file:'articles/annex/新闻聚合/正文.md'});expect(button('推送并公开')).toBeDefined();
 await click('推送并公开');expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params.expectedSourceSha256).toBe('saved');
 expect(button('确认推送到官网')).toBeUndefined();expect(host.textContent).not.toContain('提交详情');expect(host.textContent).not.toContain('请求编号');expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(true);expect(button('返回编辑')).toBeUndefined();expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params.releaseLocal).toBe(true);
 expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(true);
});

it('an uncertain legacy private request can be queried but cannot be resubmitted as public',async()=>{
 detail={...detail,stage:'unknown',receipt:{requestKey:'legacy-private'},prepared:{requestKey:'legacy-private',packetSha256:'legacy-packet',sourceSha256:'source',preparedAt:'2026-10-02T01:00:00Z',intent:'draft',expectedVersion:1,title:'本地新闻',metadata,assetCount:0}};
 await renderCompact();expect(button('查询原任务')).toBeDefined();expect(button('重试原请求')).toBeUndefined();expect(host.querySelector('[aria-label="推送用途"]')).toBeNull();expect(invoke.mock.calls.some(([,a])=>['publish','save_cloud','prepare'].includes(a.method))).toBe(false);
});
it('library editing starts private for a private article and submits that choice without a second confirmation',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){if(args.method==='draft_read')return {markdown:'# 原稿',sha256:'source'};if(args.method==='draft_preview')return {html:'<p>原稿</p>'};}
  if(args.method==='save_cloud')return {...await original(command,args),localReleased:true};
  return original(command,args);
 });
 const published=vi.fn(async()=>{});
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,editable:true,retireLocal:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn(),onPublished:published})));
 expect(button('推送更新')).toBeDefined();expect(button('存到云端')).toBeUndefined();
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
 await act(()=>host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');expect(button('推送并公开')).toBeDefined();
 await act(()=>host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
 await click('推送更新');
 expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params).toEqual(expect.objectContaining({intent:'draft',releaseLocal:true}));
 expect(host.querySelector('[aria-label="确认官网推送"]')).toBeNull();expect(host.querySelector('[aria-label="选择公开性"]')).toBeNull();
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'save_cloud',params:{id:'local-news',confirmed:true,packetSha256:'packet',retry:false}});
 expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(false);expect(published).toHaveBeenCalledTimes(1);
});

it('keeps mode navigation outside the scroller and lets dirty text preview without saving',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){
   if(args.method==='draft_read')return {markdown:'原稿',sha256:'source'};
   if(args.method==='draft_preview')return {html:'<p>'+args.params.markdown+'</p>'};
  }return original(command,args);
 });
 const props={active:true,embedded:true,editable:true,openRequest:{id:detail.id,nonce:1,mode:'edit' as const},onOpenDraft:vi.fn()};
 await act(async()=>root.render(createElement(WebsitePublisher,props)));
 await act(()=>{const input=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'未保存内容');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(button('保存')).toBeDefined();expect(button('官网预览')).toBeDefined();
 expect(button('官网预览').closest('.pub-list-scroll')).toBeNull();
 await click('官网预览');expect(button('官网预览').getAttribute('aria-pressed')).toBe('true');
 expect(invoke.mock.calls.some(([,a])=>a.method==='draft_save')).toBe(false);
 await act(async()=>root.render(createElement(WebsitePublisher,{...props,active:false})));
 await act(async()=>root.render(createElement(WebsitePublisher,{...props,openRequest:{...props.openRequest}})));
 expect(button('官网预览').getAttribute('aria-pressed')).toBe('true');
 await click('编辑');expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')?.value).toBe('未保存内容');
});

it('retains preview DOM and scroll position during an unchanged background inspection',async()=>{
 const props={active:true,embedded:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()};
 await act(async()=>root.render(createElement(WebsitePublisher,{...props,refreshToken:0})));
 const preview=host.querySelector('.website-preview-html')!,paragraph=preview.querySelector('p'),scroller=host.querySelector('.website-preview-scroll')!;
 scroller.scrollTop=200;const mutations:MutationRecord[]=[];const observer=new MutationObserver(rows=>mutations.push(...rows));observer.observe(preview,{childList:true,subtree:true});
 await act(async()=>root.render(createElement(WebsitePublisher,{...props,refreshToken:1})));
 expect(host.querySelector('.website-preview-html p')).toBe(paragraph);expect(scroller.scrollTop).toBe(200);expect(mutations).toHaveLength(0);observer.disconnect();
});

it('shows push errors in a dismissible modal without inserting a recovery panel',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){if(args.method==='draft_read')return {markdown:'# 原稿',sha256:'source'};if(args.method==='draft_preview')return {html:'<p>原稿</p>'};}
  if(args.method==='prepare')throw Error('服务器暂时不可用');
  return original(command,args);
 });
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,editable:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn()})));
 await click('推送更新');
 const modal=document.body.querySelector('[role="alertdialog"]')!;
 expect(modal.textContent).toContain('服务器暂时不可用');expect(host.textContent).not.toContain('服务器暂时不可用');
 expect(host.textContent).not.toContain('恢复为新稿');expect(invoke.mock.calls.some(([,a])=>a.method==='publish')).toBe(false);
 await act(()=>[...modal.querySelectorAll('button')].find(b=>b.textContent==='知道了')!.click());
 expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
});

it('keeps editor and preview instances plus independent scroll positions when changing modes',async()=>{
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){if(args.method==='draft_read')return {markdown:'原稿',sha256:'source'};if(args.method==='draft_preview')return {html:'<p>原稿</p>'};}
  return original(command,args);
 });
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,editable:true,openRequest:{id:detail.id,nonce:1,mode:'edit'},onOpenDraft:vi.fn()})));
 const editor=host.querySelector('[aria-label="Markdown 正文"]'),editScroll=host.querySelector('.pub-list-scroll')!;
 expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_preview')).toHaveLength(0);
 editScroll.scrollTop=350;await click('官网预览');const preview=host.querySelector('.website-preview-html p'),previewScroll=host.querySelector('.website-preview-scroll')!;previewScroll.scrollTop=170;
 expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_preview')).toHaveLength(1);
 await click('编辑');expect(host.querySelector('[aria-label="Markdown 正文"]')).toBe(editor);expect(editScroll.scrollTop).toBe(350);
 await click('官网预览');expect(host.querySelector('.website-preview-html p')).toBe(preview);expect(previewScroll.scrollTop).toBe(170);
 expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_preview')).toHaveLength(1);
 await click('公众号预览');expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_preview')).toHaveLength(1);
});

it('background status polling leaves modes responsive and skips library refresh while queued',async()=>{
 vi.useFakeTimers();let resolveStatus!:(value:WebsiteDraftDetail)=>void;
 try{
  const original=invoke.getMockImplementation()!;
  invoke.mockImplementation(async(command,args)=>{
   if(command==='editorial_call'){if(args.method==='draft_read')return {markdown:'原稿',sha256:'source'};if(args.method==='draft_preview')return {html:'<p>原稿</p>'};}
   if(args.method==='status')return new Promise<WebsiteDraftDetail>(r=>{resolveStatus=r;});
   return original(command,args);
  });
  const onChanged=vi.fn();
  // A public article starts with 公开 on, so its push publishes the update.
  detail={...detail,sync:{state:'local_changed',baseRevision:1,remoteRevision:1,publishedRevision:1}};
  await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,editable:true,openRequest:{id:detail.id,nonce:1},onOpenDraft:vi.fn(),onChanged})));
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  await click('推送并公开');invoke.mockClear();onChanged.mockClear();
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(invoke.mock.calls.some(([,a])=>a.method==='status')).toBe(true);
  expect(button('正在查询…')).toBeUndefined();expect(button('官网预览').disabled).toBe(false);
  await click('编辑');expect(button('编辑').getAttribute('aria-pressed')).toBe('true');
  await act(()=>resolveStatus(structuredClone(detail)));
  expect(invoke.mock.calls.some(([,a])=>a.method==='snapshot')).toBe(false);expect(onChanged).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});

it('push gives immediate feedback, saves once, skips redundant inspection and ignores double clicks',async()=>{
 const original=invoke.getMockImplementation()!;let finishSave!:()=>void;
 invoke.mockImplementation(async(command,args)=>{
  if(command==='editorial_call'){
   if(args.method==='draft_read')return {markdown:'原稿',sha256:'source'};
   if(args.method==='draft_save'){await new Promise<void>(r=>{finishSave=r;});return {markdown:args.params.markdown,sha256:'saved'};}
   if(args.method==='draft_preview')return {html:'<p>预览</p>'};
  }return original(command,args);
 });
 detail={...detail,sync:{state:'local_changed',baseRevision:1,remoteRevision:1,publishedRevision:1}};
 await act(async()=>root.render(createElement(WebsitePublisher,{active:true,embedded:true,editable:true,openRequest:{id:detail.id,nonce:1,mode:'edit'},onOpenDraft:vi.fn()})));
 await act(()=>{const input=host.querySelector<HTMLTextAreaElement>('[aria-label="Markdown 正文"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'新稿');input.dispatchEvent(new Event('input',{bubbles:true}));});
 invoke.mockClear();const push=button('推送并公开');await act(()=>{push.click();push.click();});
 expect(button('正在检查…').disabled).toBe(true);expect(button('官网预览').disabled).toBe(false);
 await act(()=>finishSave());
 expect(invoke.mock.calls.filter(([,a])=>a.method==='draft_save')).toHaveLength(1);
 expect(invoke.mock.calls.filter(([,a])=>a.method==='prepare')).toHaveLength(1);
 expect(invoke.mock.calls.filter(([,a])=>a.method==='publish')).toHaveLength(1);
 expect(invoke.mock.calls.some(([,a])=>a.method==='inspect')).toBe(false);
 expect(invoke.mock.calls.find(([,a])=>a.method==='prepare')?.[1].params.expectedSourceSha256).toBe('saved');
});
