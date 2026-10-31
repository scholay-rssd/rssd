// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi,afterEach} from 'vitest';
const {call,settings,connectionsList}=vi.hoisted(()=>({call:vi.fn(),settings:new Map<string,string>(),connectionsList:vi.fn()}));
vi.mock('../api',()=>({getSetting:async(key:string)=>settings.get(key)||null,setSetting:async(key:string,value:string)=>{settings.set(key,value);}}));
vi.mock('../editorial/taskWorkbench',async original=>({...await original<any>(),taskCall:call}));
vi.mock('../editorial/CursorAgentPane',()=>({default:(p:any)=>createElement('aside',{'aria-label':'写作对话'},p.conversation.header,p.conversation.welcome,p.conversation.after,createElement('div',{hidden:p.conversation.view==='chat','data-config':true},p.conversation.tools),p.conversation.composer)}));
vi.mock('../connections/client',async original=>({...await original<any>(),connectionService:{list:connectionsList,browse:async()=>({items:[]})}}));
vi.mock('../editorial/TopicSourceShelf',()=>({default:(p:any)=>createElement('button',{onClick:()=>p.onChoose({kind:'template',template:{id:'template',name:'事实核查',prompt:'核对原始事实'}})},'fixture-template')}));
import {noteAt} from '../editorial/notebookEditorModel';
import {selectTemplate,stampTemplateBaseline} from '../../scripts/agent/notebook-templates.mjs';
import {stampNotebook} from '../../scripts/agent/notebook.mjs';
import {ACTIVE_SITE,setActiveSite} from '../../../scripts/site-profile.mjs';
import {sectionsForSite} from '../../../contracts/site-sections.mjs';
import profiles from '../../../sites/profiles.json';
import NotebookWorkflow from '../editorial/NotebookWorkflow';
const fixture=()=>({id:'task-notebook',mode:'observation',title:'写作',brief:'',days:30,articleId:'draft-notebook',workIds:[],revision:1,board:{titles:[],sections:[]},outline:{blocks:[]},assets:[],ui:{tabs:[],expansionOpen:true},notebook:{version:2,groups:[],mounts:{templates:[],brands:[]},assets:{},title:'测试文章',kind:'article',sectionId:'observations',skills:['essay'],fields:{},sources:[],blocks:[{id:'p',type:'paragraph',text:'',state:'placeholder',sourceIds:[]}]}} as any);
Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>new DOMRect(0,0,100,20)});
Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:()=>[]});
const roots:ReturnType<typeof createRoot>[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();setActiveSite(profiles[0]);document.body.innerHTML='';});
async function render(initial=fixture(),config=false){
 settings.clear();connectionsList.mockReset().mockResolvedValue({spaceId:ACTIVE_SITE.spaceId,connections:[]});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);let state=structuredClone(initial),changeTask:any,changeActive:any;
 call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='notebook_brands')return [];if(method==='notebook_catalog')return {siteId:ACTIVE_SITE.id,sections:sectionsForSite(ACTIVE_SITE),skills:[]};if(method==='task_get')return structuredClone(state);if(method==='task_update'){if(p.expectedRevision!==state.revision)throw Error('CONFLICT: 文章板已有新版');state={...state,...p.patch,revision:state.revision+1};return structuredClone(state);}if(method==='notebook_template'){const previous=structuredClone(state),note=selectTemplate(state.notebook,p.template,{spaceId:p.spaceId,makeId:()=>crypto.randomUUID()}).note;state={...state,revision:state.revision+1,notebook:stampTemplateBaseline(stampNotebook(note,previous.notebook,{documentId:state.articleId})),templateUndo:{revision:state.revision+1}};return structuredClone(state);}if(method==='notebook_prompt')return {started:true};if(method==='notebook_check')return {ready:true,issues:[]};if(method==='notebook_export'){state={...state,completedAt:'now'};return structuredClone(state);}throw Error(method);});
 function Harness(){const [task,setTask]=useState(initial),[active,setActive]=useState(true);changeTask=setTask;changeActive=setActive;return createElement(NotebookWorkflow,{task,run:{},active,refreshToken:0,obscured:false,agentBusy:false,onAccept:setTask,onUi:(ui:any)=>{state={...state,ui:{...state.ui,...ui}};setTask((old:any)=>({...old,ui:{...old.ui,...ui}}));},onSave:async()=>{},onDraft:()=>{},onRefresh:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));if(config)await act(async()=>button(host,'添加挂载').click());return {host,state:()=>state,active:async(value:boolean)=>{await act(async()=>changeActive(value));},backendChange:(text:string)=>{state={...state,revision:state.revision+1,notebook:{...state.notebook,blocks:state.notebook.blocks.map((b:any)=>({...b,text,state:'ready'}))}};},external:async()=>{state={...state,revision:state.revision+1};await act(async()=>changeTask(structuredClone(state)));}};
}
function button(host:HTMLElement,name:string){return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name||b.getAttribute('aria-label')===name)!;}
async function input(el:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{if(el.classList.contains('notebook-rich-content')){const editor=(el.closest('.notebook-prosemirror') as any).editor,found=noteAt(editor,el.dataset.rowId)!;editor.commands.insertContentAt({from:found.pos+2,to:found.pos+found.node.nodeSize-2},{type:'text',text:value});return;}const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
async function flush(){await act(async()=>{const promises:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('scholay-workbench-flush',{detail:{promises}}));await Promise.all(promises);});}
it('new revisions never silently bless an unsaved older editor snapshot',async()=>{const {host,external}=await render();await input(host.querySelector('[aria-label="内容行 1"]')!,'尚未写入的人工内容');await external();await expect(flush()).rejects.toThrow('CONFLICT');expect(host.querySelector('[aria-label="内容行 1"]')!.textContent).toBe('尚未写入的人工内容');expect(call.mock.calls.at(-1)?.[1].expectedRevision).toBe(1);});

it('reopening a clean notebook reads changes made through another workbench connection',async()=>{
 const {host,active,backendChange}=await render();await active(false);backendChange('工作台接口保存的新内容');await active(true);
 expect(host.querySelector('[aria-label="内容行 1"]')!.textContent).toBe('工作台接口保存的新内容');
 expect(call.mock.calls.filter(([method])=>method==='task_update')).toHaveLength(0);
});

it('reopening with pending edits keeps them and preserves the original conflict revision',async()=>{
 const {host,active,backendChange}=await render();await input(host.querySelector('[aria-label="内容行 1"]')!,'还未保存的本地文字');await active(false);backendChange('另一连接的新内容');await active(true);
 expect(host.querySelector('[aria-label="内容行 1"]')!.textContent).toBe('还未保存的本地文字');
 await expect(flush()).rejects.toThrow('CONFLICT');expect(call.mock.calls.at(-1)?.[1].expectedRevision).toBe(1);
});

it('selecting and cancelling AI rewrite never unlocks or saves the protected content',async()=>{
 const initial=fixture();initial.notebook.blocks[0]={...initial.notebook.blocks[0],text:'人工原文',state:'ready',locked:true};const {host,state}=await render(initial);
 await act(async()=>button(host,'交给 AI 改写').click());expect(host.textContent).toContain('改写 1 处内容');await act(async()=>button(host,'取消选择').click());await flush();
 expect(state().notebook.blocks[0]).toMatchObject({text:'人工原文',locked:true});expect(call.mock.calls.filter(([method])=>method==='task_update'||method==='notebook_prompt')).toHaveLength(0);
});

it('heading strategies stay internal while directly edited headings become protected',async()=>{
 const initial=fixture();initial.notebook.headingPolicy={mode:'auto',selected:'numbered'};initial.notebook.blocks=[{id:'h',type:'heading',level:2,text:'',state:'ready',sourceIds:[],heading:{mode:'numbered',owner:'agent'}},{id:'p',type:'paragraph',text:'已完成正文',state:'ready',sourceIds:[]}];const {host,state}=await render(initial);
 expect(host.querySelector('[aria-label="标题方式"]')).toBeNull();expect(host.querySelector('[aria-label="本节标题方式 1"]')).toBeNull();expect(host.querySelector('.notebook-heading-number')?.textContent).toBe('1');
 await input(host.querySelector('[aria-label="内容行 1"]')!,'作者自己的标题');await flush();
 expect(state().notebook.blocks[0]).toMatchObject({text:'作者自己的标题',locked:true});expect(state().notebook.blocks[0].heading).toBeUndefined();expect(host.querySelector('.notebook-heading-number')).toBeNull();expect(button(host,'整理子标题')).toBeUndefined();
});


it('block selection supports duplicate, delete and undo without changing the original prose',async()=>{
 const initial=fixture();initial.notebook.blocks=[{id:'a',type:'paragraph',text:'作者原文',state:'ready',locked:true,sourceIds:[]},{id:'b',type:'paragraph',text:'第二段',state:'ready',sourceIds:[]}];const {host,state}=await render(initial);
 const keys=async(key:string,ctrlKey=false)=>act(async()=>host.querySelector('[aria-label="内容块操作区"]')!.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey,bubbles:true,cancelable:true})));
 await act(async()=>button(host,'选择或拖动内容块 1').click());expect(host.querySelectorAll('.is-block-selected')).toHaveLength(1);await keys('d',true);await flush();expect(state().notebook.blocks.map((b:any)=>b.text)).toEqual(['作者原文','作者原文','第二段']);expect(state().notebook.blocks[0]).toEqual(initial.notebook.blocks[0]);
 await keys('Backspace');await flush();expect(state().notebook.blocks.map((b:any)=>b.text)).toEqual(['作者原文','第二段']);
 await act(async()=>host.querySelector('[aria-label=内容块操作区]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true})));await flush();expect(state().notebook.blocks.map((b:any)=>b.text)).toEqual(['作者原文','作者原文','第二段']);
 for(const label of ['内容状态 1','删除行 1','上移行 1','下移行 1','保护人工内容 1'])expect(host.querySelector('[aria-label="'+label+'"]')).toBeNull();
 expect(host.querySelector('.notebook-row-actions [aria-label="内容行菜单 1"]')).not.toBeNull();expect(host.textContent).not.toContain('在上方插入');expect(host.textContent).not.toContain('复制此行');
});


it('cut and paste carry block structure and sources; ordinary text editing clears block selection',async()=>{
 const initial=fixture();initial.notebook.sources=[{id:'s',title:'出处',summary:'摘要',url:'https://example.org/a',acquiredVia:'rss',reviewed:true}];initial.notebook.blocks=[{id:'a',type:'paragraph',text:'引用正文',state:'ready',locked:true,sourceIds:['s']},{id:'b',type:'paragraph',text:'第二段',state:'ready',sourceIds:[]}];const {host,state}=await render(initial),data=new Map<string,string>();
 async function clipboard(type:string){await act(async()=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)||''}});host.querySelector('[aria-label="内容块操作区"]')!.dispatchEvent(event);});}
 await act(async()=>button(host,'选择或拖动内容块 1').click());await clipboard('copy');await flush();expect(state().notebook.blocks).toEqual(initial.notebook.blocks);expect(data.get('text/plain')).toBe('引用正文');await clipboard('cut');await flush();expect(state().notebook.blocks.map((b:any)=>b.text)).toEqual(['第二段']);await clipboard('paste');await flush();expect(state().notebook.blocks.map((b:any)=>b.text)).toEqual(['第二段','引用正文']);expect(state().notebook.blocks[1].sourceIds).toEqual(['s']);expect(state().notebook.sources).toEqual(initial.notebook.sources);
 await act(async()=>host.querySelector('[aria-label="内容行 1"]')!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));expect(host.querySelectorAll('.is-block-selected')).toHaveLength(0);
});


it('clicking between blocks inserts a row first and selects its type inside that row',async()=>{
 const initial=fixture();initial.notebook.blocks=[{id:'a',type:'paragraph',text:'第一段',state:'ready',sourceIds:[]},{id:'b',type:'paragraph',text:'第二段',state:'ready',sourceIds:[]}];const {host,state}=await render(initial);
 await act(async()=>button(host,'在第 2 行前插入').click());expect(host.querySelectorAll('.notebook-row')).toHaveLength(3);expect(host.querySelector('.notebook-row .notebook-inline-type')).not.toBeNull();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.notebook-insert-options button')].find(b=>b.textContent?.startsWith('标题 2'))!.click());await flush();
 expect(state().notebook.blocks.map((b:any)=>b.type)).toEqual(['paragraph','heading','paragraph']);expect(state().notebook.blocks[0].text).toBe('第一段');expect(state().notebook.blocks[2].text).toBe('第二段');
});


it('template mounts stay in the unsent turn, switching and cancelling never change the manuscript',async()=>{
 const {host,state}=await render(),body=structuredClone(state().notebook);
 await act(async()=>button(host,'添加挂载').click());
 const cards=()=>[...host.querySelectorAll<HTMLButtonElement>('.notebook-mount-row')].filter(b=>b.title.startsWith('文章模板 · '));expect(cards().length).toBeGreaterThanOrEqual(9);
 await act(async()=>cards()[0].click());expect(state().ui.turnDraft.template).toBeTruthy();expect(state().notebook).toEqual(body);
 const second=cards()[1],name=second.getAttribute('aria-label');
 await act(async()=>second.click());expect(state().ui.turnDraft.template.name).toBe(name);expect(second.isConnected).toBe(false);
 await act(async()=>button(host,'取消挂载：'+name).click());expect(state().ui.turnDraft.template).toBeUndefined();expect(state().notebook).toEqual(body);expect(cards().some(b=>b.getAttribute('aria-label')===name)).toBe(true);
 expect(call.mock.calls.filter(([m])=>m==='notebook_template'||m==='notebook_prompt')).toHaveLength(0);
});
it.each(profiles)('$spaceId starts collapsed, mounts section defaults, expands on send and respects later manual collapse',async site=>{
 setActiveSite(site);const initial=fixture();initial.ui.expansionOpen=false;initial.notebook={...initial.notebook,title:'',blocks:[],skills:[]};delete initial.notebook.sectionId;
 const {host,state}=await render(initial);expect(host.querySelector('[aria-label="子弹笔记编辑区"]')).toBeNull();
 await act(async()=>button(host,sectionsForSite(site)[0].name).click());expect(state().ui.turnDraft.template).toBeTruthy();expect(state().notebook.blocks).toHaveLength(0);
 await input(host.querySelector('[aria-label="写作要求"]')!,'写一篇文章');await act(async()=>button(host,'发送').click());
 expect(state().ui.expansionOpen).toBe(true);expect(state().ui.turnDraft.template).toBeUndefined();expect(state().notebook.blocks).toHaveLength(0);
 expect(call.mock.calls.findLast(([m])=>m==='notebook_prompt')?.[1].turnContext.template).toBeTruthy();
 await act(async()=>button(host,'收起拓展区').click());await input(host.querySelector('[aria-label="写作要求"]')!,'继续讨论');await act(async()=>button(host,'发送').click());expect(state().ui.expansionOpen).toBe(false);
});
it('shows all eight academic sections and sends the history template from its stable ID',async()=>{
 setActiveSite(profiles[0]);const initial=fixture();initial.notebook={...initial.notebook,title:'',blocks:[],skills:[]};delete initial.notebook.sectionId;
 const {host,state}=await render(initial);
 expect([...host.querySelectorAll('.notebook-start-sections button')].map(b=>b.querySelector('span')?.textContent)).toEqual(['学界犀闻','学者观察','今日学术','昔日学术','学术资源','学术开源','项目合作','课程资源']);
 await act(async()=>button(host,'昔日学术').click());
 expect(state().ui.turnDraft.template.mode).toBe('history');
 await input(host.querySelector('[aria-label="写作要求"]')!,'整理一条学术史事件');await act(async()=>button(host,'发送').click());
 expect(state().notebook.sectionId).toBe('history');
 expect(call.mock.calls.findLast(([m])=>m==='notebook_prompt')?.[1].turnContext.template.mode).toBe('history');
});
it('a rejected send preserves the composer and its per-turn mounts',async()=>{
 const {host,state}=await render();await act(async()=>button(host,'添加挂载').click());await act(async()=>host.querySelector<HTMLButtonElement>('.notebook-mount-row[title^="文章模板"]')!.click());
 const mounts=structuredClone(state().ui.turnDraft);await act(async()=>button(host,'添加挂载').click());await input(host.querySelector('[aria-label="写作要求"]')!,'不要丢失这条要求');
 call.mockImplementationOnce(async()=>{throw Error('连接失败');});await act(async()=>button(host,'发送').click());
 expect((host.querySelector('[aria-label="写作要求"]') as HTMLTextAreaElement).value).toBe('不要丢失这条要求');expect(state().ui.turnDraft).toEqual(mounts);
});

it('mount picker is one scrolling list with four sections and no nested navigation or row management buttons',async()=>{
 const {host,state}=await render();await act(async()=>button(host,'添加挂载').click());
 const picker=host.querySelector('[aria-label="选择本轮挂载"]')!;
 expect([...picker.querySelectorAll('h3')].map(h=>h.textContent)).toEqual(['Attach','Plugin Skills','App','MCP']);
 expect(picker.querySelectorAll('details,select,input')).toHaveLength(0);
 expect(picker.querySelector('[aria-label="返回挂载列表"]')).toBeNull();
 expect([...picker.querySelectorAll('button')].every(b=>b.classList.contains('notebook-mount-row'))).toBe(true);
 await act(async()=>button(host,'联网搜索').click());expect(state().ui.turnDraft.webEnabled).toBe(true);expect(host.querySelector('[aria-label="选择本轮挂载"]')).not.toBeNull();
 expect(picker.querySelector('[aria-label="联网搜索"]')).toBeNull();expect(picker.querySelector('[aria-pressed]')).toBeNull();
 await act(async()=>button(host,'取消挂载：联网搜索').click());expect(state().ui.turnDraft.webEnabled).toBe(false);
 expect(picker.querySelector('[aria-label="联网搜索"]')).not.toBeNull();
});

it.each(profiles)('$spaceId only offers its enabled connections and refreshes after a setting changes',async site=>{
 setActiveSite(site);const {host}=await render();
 connectionsList.mockResolvedValue({spaceId:site.spaceId,connections:[{provider:'github',configured:true,enabled:true,status:'verified',target:''},{provider:'figma',configured:true,enabled:false,status:'verified',target:''},{provider:'feedly',configured:false,status:'unconfigured',target:''}]});
 await act(async()=>button(host,'添加挂载').click());const picker=host.querySelector('[aria-label="选择本轮挂载"]')!;
 expect(picker.querySelector('[aria-label="GitHub"]')).not.toBeNull();expect(picker.querySelector('[aria-label="Figma"]')).toBeNull();expect(picker.querySelector('[aria-label="Feedly"]')).toBeNull();
 connectionsList.mockResolvedValue({spaceId:site.spaceId,connections:[{provider:'github',configured:true,enabled:false,status:'verified',target:''}]});
 await act(async()=>window.dispatchEvent(new CustomEvent('today:connections-changed',{detail:{spaceId:site.spaceId}})));
 expect(picker.querySelector('[aria-label="GitHub"]')).toBeNull();
});

it('does not add an old space connection after a delayed response',async()=>{
 const {host}=await render(),space=ACTIVE_SITE.spaceId;let finish!:(value:any)=>void;
 connectionsList.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>button(host,'添加挂载').click());
 setActiveSite(profiles[1]);await act(async()=>finish({spaceId:space,connections:[{provider:'github',configured:true,status:'verified',target:''}]}));
 expect(host.querySelector('.notebook-mount-row[aria-label="GitHub"]')).toBeNull();
});

it('local files reach the send payload, history has metadata only and the next turn starts without attachments',async()=>{
 const {host,state}=await render(),file=new File(['用户资料'],'材料.md',{type:'text/markdown'});
 Object.defineProperty(file,'text',{value:async()=>'用户资料'});
 await act(async()=>{const input=host.querySelector<HTMLInputElement>('[aria-label="本地附件"]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(state().ui.turnDraft.files[0].text).toBe('用户资料');
 await input(host.querySelector('[aria-label="写作要求"]')!,'根据附件整理');await act(async()=>button(host,'发送').click());
 const sent=call.mock.calls.findLast(([m])=>m==='notebook_prompt')![1];expect(sent.attachments[0]).toMatchObject({name:'材料.md',text:'用户资料'});expect(sent.turnContext.files[0].text).toBeUndefined();expect(state().ui.turnDraft.files).toBeUndefined();
});

it('an unfinished file read cannot mount into a workspace that is no longer active',async()=>{
 const {host,state,active}=await render(),file=new File(['内容'],'材料.md');let finish!:(value:string)=>void;
 Object.defineProperty(file,'text',{value:()=>new Promise<string>(resolve=>{finish=resolve;})});
 await act(async()=>{const input=host.querySelector<HTMLInputElement>('[aria-label="本地附件"]')!;Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));});
 await active(false);await act(async()=>finish('内容'));expect(state().ui.turnDraft?.files).toBeUndefined();
});

it('keeps an empty paragraph and its DOM mounted across Enter and autosave acknowledgements',async()=>{
 const initial=fixture();initial.notebook.blocks=[{id:'a',type:'paragraph',text:'作者原文',state:'ready',locked:true,sourceIds:[]}];const {host}=await render(initial);
 const editor=(host.querySelector('.notebook-prosemirror') as any).editor;
 await act(async()=>{editor.commands.setTextSelection(6);host.querySelector('.notebook-prosemirror')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 expect(host.querySelectorAll('.notebook-rich-content')).toHaveLength(2);
 const row=host.querySelectorAll('.notebook-rich-content')[1],pos=editor.state.selection.from;
 await flush();expect(host.querySelectorAll('.notebook-rich-content')[1]).toBe(row);expect(editor.state.selection.from).toBe(pos);
 await act(async()=>editor.commands.insertContent('新一段'));await flush();expect(host.querySelectorAll('.notebook-rich-content')[1].textContent).toBe('新一段');
});
