// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import ImageGallery from '../editorial/ImageGallery';
const {invoke,listen,shortcutUi}=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),shortcutUi:{modalOpen:false,menuOpen:false,aiOpen:false}}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../store',()=>({useUi:Object.assign((selector:any)=>selector(shortcutUi),{getState:()=>shortcutUi})}));
let host:HTMLDivElement,root:Root,tasks:any[],receivers:Set<(v:any)=>void>;
const fixture=(id='image-one')=>({id,mode:'image',title:'学术封面',brief:'',days:30,revision:1,stage:'topic',articleId:'draft-'+id,workIds:[],board:{titles:[],sections:[]},outline:{blocks:[]},assets:[],ui:{tabs:[],composer:''}});
const status={connected:true,busy:false,status:'已连接',history:[],pending:[],sessionId:'gallery-fixture'};
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Object.assign(shortcutUi,{modalOpen:false,menuOpen:false,aiOpen:false});tasks=[fixture(),{...fixture('article-task'),mode:'xiwen',title:'文章任务不在图库'}];receivers=new Set();
 listen.mockReset().mockImplementation(async(_name,cb)=>{receivers.add(cb);return ()=>receivers.delete(cb);});
 invoke.mockReset().mockImplementation(async(_command,args)=>{const p=args.params||{};
  if(args.method==='gallery_list')return [];if(args.method==='task_list')return tasks;if(args.method==='task_states')return {};
  if(args.method==='task_get')return tasks.find(t=>t.id===p.taskId);
  if(args.method==='status')return status;
  if(args.method==='task_create'){const task={...fixture('image-new'),...p};tasks.push(task);return task;}
  if(args.method==='task_update'){const task=tasks.find(t=>t.id===p.taskId);Object.assign(task,{...p.patch,ui:{...task.ui,...p.patch.ui}});return task;}
  if(args.method==='gallery_prompt')return {started:true,queued:true,runId:'run-one'};
  if(args.method==='task_finish'){const task=tasks.find(t=>t.id===p.taskId);task.completedAt='2026-10-04';return task;}
  return {};
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=(props:object={})=>act(async()=>root.render(createElement(ImageGallery,{active:true,...props})));
const button=(text:string)=>{const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);if(!b)throw Error('Missing button '+text);return b;};
const event=(payload:object)=>act(()=>{for(const receive of receivers)receive({payload});});
const input=async(value:string)=>act(async()=>{const el=host.querySelector<HTMLTextAreaElement>('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});

it('separates imported pictures from AI generation and manuscript assets',async()=>{
 const implementation=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>args.method==='gallery_list'?Promise.resolve([
  {id:'import',key:'one:import',taskId:'one',storage:'gallery',origin:'imported',name:'原创本地示意图',createdAt:'2026-10-05T17:00:00Z'},
  {id:'generated',key:'one:generated',taskId:'one',storage:'gallery',origin:'generated',name:'模型生成图'},
  {id:'article',key:'two:article',taskId:'two',name:'稿件成图',taskTitle:'正文标题'}
 ]):args.method==='gallery_read'?Promise.resolve({src:'data:image/png;base64,AA=='}):implementation(command,args));
 await render();expect(host.querySelectorAll('.gallery-card')).toHaveLength(3);expect(host.querySelector('.gallery-card small')?.textContent).toContain('本地导入');
 await act(async()=>button('AI 生成').click());expect(host.querySelectorAll('.gallery-card')).toHaveLength(1);expect(host.querySelector('.gallery-card strong')?.textContent).toBe('模型生成图');
 await act(async()=>button('本地导入').click());expect(host.querySelectorAll('.gallery-card')).toHaveLength(1);expect(host.querySelector('.gallery-card strong')?.textContent).toBe('原创本地示意图');
 await act(async()=>button('文章配图').click());expect(host.querySelectorAll('.gallery-card')).toHaveLength(1);expect(host.querySelector('.gallery-card strong')?.textContent).toBe('稿件成图');
});

it('opens a gallery conversation without starting Cursor and creates only an image task when sending',async()=>{
 await render();expect(host.textContent).not.toContain('文章任务不在图库');await act(async()=>button('＋ 新建图片对话').click());
 expect(host.querySelector('[aria-label="会话智能体"]')).not.toBeNull();expect(host.textContent).not.toContain('Cursor Auto');expect(invoke.mock.calls.some(([,a])=>['task_create','gallery_prompt'].includes(a.method))).toBe(false);
 await input('研究方法关系图，横向，无文字');await act(async()=>button('发送').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_create',params:{mode:'image',title:'研究方法关系图，横向，无文字',brief:'研究方法关系图，横向，无文字'}});
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'gallery_prompt',params:{taskId:'image-new',text:'研究方法关系图，横向，无文字'}});
 expect(invoke.mock.calls.some(([,a])=>['task_run','image_task_create','configure'].includes(a.method))).toBe(false);
 expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
});
it('opens an article image prompt as a draft without generating or modifying the article',async()=>{
 await render({compose:{key:1,prompt:'为研究报道生成一张插图',articleId:'article-one',slotPath:'placeholder.png'}});
 expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('为研究报道生成一张插图');
 expect(invoke.mock.calls.some(([,a])=>['gallery_prompt','task_create','article_image_replace'].includes(a.method))).toBe(false);
});
it('uses task-scoped live messages, settles stopped tool animations and supports a subsequent message',async()=>{
 await render({initialTaskId:'image-one'});
 event({taskId:'other',type:'message',message:{id:'other',role:'assistant',text:'其他任务不能串进来'}});
 event({taskId:'image-one',type:'state',...status,busy:true,history:[{id:'tool',role:'tool',text:'',tool:{title:'Generate Image',status:'in_progress'}}]});
 expect(host.querySelector('.cursor-spinner')).not.toBeNull();expect(host.textContent).not.toContain('其他任务不能串进来');
 event({taskId:'image-one',type:'state',...status,busy:false,status:'已停止',history:[{id:'tool',role:'tool',text:'',tool:{title:'Generate Image',status:'in_progress'}},{id:'stop',role:'turn',text:'',status:'已停止'}]});
 expect(host.querySelector('.cursor-spinner')).toBeNull();expect(host.textContent).toContain('已停止');
 await input('颜色再柔和一点');await act(async()=>button('发送').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'gallery_prompt',params:{taskId:'image-one',text:'颜色再柔和一点'}});
 expect(invoke.mock.calls.filter(([,a])=>a.method==='task_create')).toHaveLength(0);
});
it('persists the draft when switching views and never resumes work on restore',async()=>{
 tasks[0].ui.composer='未发送的配图想法';await render({initialTaskId:'image-one'});
 expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('未发送的配图想法');await input('保留这段修改');
 await act(async()=>button('全部图片').click());
 expect(tasks[0].ui.composer).toBe('保留这段修改');
 expect(invoke.mock.calls.some(([,a])=>['gallery_prompt','task_run','connect'].includes(a.method))).toBe(false);
});
it('does not auto-approve permissions and makes completed conversations read only',async()=>{
 await render({initialTaskId:'image-one'});
 event({taskId:'image-one',type:'request',request:{requestId:'r1',kind:'permission',title:'生成图片',options:[{optionId:'once',kind:'allow_once',name:'Allow'}]}});
 expect(invoke.mock.calls.some(([,a])=>a.method==='respond')).toBe(false);await act(async()=>button('允许这一次').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'respond',params:{taskId:'image-one',requestId:'r1',allow:true,optionId:'once',answers:undefined}});
 tasks[0].completedAt='2026-10-04';await render({initialTaskId:'image-one',compose:{key:2,taskId:'image-one'}});
 expect(host.querySelector('textarea')).toBeNull();expect(host.textContent).toContain('此对话已结束');
});
it('retains the same conversation and draft after a rejected generation request',async()=>{
 const implementation=invoke.getMockImplementation()!;invoke.mockImplementation((command,args)=>args.method==='gallery_prompt'?Promise.reject(Error('Cursor Auto 不可用')):implementation(command,args));
 await render();await act(async()=>button('＋ 新建图片对话').click());await input('需要保存的要求');await act(async()=>button('发送').click());
 expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('需要保存的要求');expect(host.textContent).toContain('Cursor Auto 不可用');
 expect(invoke.mock.calls.filter(([,a])=>a.method==='task_create')).toHaveLength(1);expect(tasks.find(t=>t.id==='image-new').ui.composer).toBe('需要保存的要求');
});
it('allows an empty stopped conversation to end and still prevents ending during a run',async()=>{
 await render({initialTaskId:'image-one'});
 event({taskId:'image-one',type:'state',...status,busy:true,status:'正在生成'});
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='结束对话')).toBe(false);
 event({taskId:'image-one',type:'state',...status,busy:false,status:'已停止'});
 expect(button('结束对话').disabled).toBe(false);await act(async()=>button('结束对话').click());
 expect(invoke).toHaveBeenCalledWith('cursor_agent_call',{method:'task_finish',params:{taskId:'image-one'}});
 expect(tasks[0].assets).toHaveLength(0);expect(host.querySelector('textarea')).toBeNull();expect(host.textContent).toContain('此对话已结束');
});
it('contributes its current draft save to the exit event and waits for persistence',async()=>{
 await render({initialTaskId:'image-one'});await input('退出前最新的图片要求');
 let resolveSave!:(value:unknown)=>void;const save=new Promise(resolve=>{resolveSave=resolve;});const implementation=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>args.method==='task_update'?save:implementation(command,args));
 const promises:Promise<unknown>[]=[];act(()=>window.dispatchEvent(new CustomEvent('scholay-workbench-flush',{detail:{promises}})));
 expect(promises).toHaveLength(1);expect(invoke).toHaveBeenLastCalledWith('cursor_agent_call',{method:'task_update',params:{taskId:'image-one',patch:{ui:{composer:'退出前最新的图片要求',scrollTop:0,follow:true}}}});
 let persisted=false;const complete=Promise.all(promises).then(()=>{persisted=true;});await Promise.resolve();expect(persisted).toBe(false);
 resolveSave({saved:true});await complete;expect(persisted).toBe(true);
});
it('propagates an exit save rejection through the collected promise',async()=>{
 await render({initialTaskId:'image-one'});const implementation=invoke.getMockImplementation()!;
 invoke.mockImplementation((command,args)=>args.method==='task_update'?Promise.reject(Error('图库草稿保存失败')):implementation(command,args));
 const promises:Promise<unknown>[]=[];act(()=>window.dispatchEvent(new CustomEvent('scholay-workbench-flush',{detail:{promises}})));
 expect(promises).toHaveLength(1);await expect(Promise.all(promises)).rejects.toThrow('图库草稿保存失败');
});

it('keeps a fixed image home before conversation tabs and returns to it from sidebar filters',async()=>{
 await render();const home=host.querySelector<HTMLButtonElement>('.gallery-tabs .reader-home-tab [role=tab]')!;
 expect(home.getAttribute('aria-label')).toBe('图片列表');expect(home.getAttribute('aria-selected')).toBe('true');
 expect(home.closest('.reader-home-tab')?.querySelector('[aria-label^="关闭"]')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('.gallery-chat-list button')!.click());
 expect(home.getAttribute('aria-selected')).toBe('false');expect(host.querySelector('.gallery-tabstrip [role=tab]')?.textContent).toBe('学术封面');
 await act(async()=>button('全部图片').click());expect(home.getAttribute('aria-selected')).toBe('true');
 expect(host.querySelector('.gallery-toolbar [aria-label="搜索本地图片"]')).not.toBeNull();expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('.gallery-tabstrip [role=tab]')!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭 学术封面"]')!.click());
 expect(home.getAttribute('aria-selected')).toBe('true');expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(0);
 expect(invoke.mock.calls.some(([,args])=>['task_finish','cancel','gallery_prompt'].includes(args.method))).toBe(false);
});

it('retains an unsent image draft when using the home tab and supports keyboard return to home',async()=>{
 await render();await act(async()=>button('＋ 新建图片对话').click());await input('未发送的图片要求');
 const home=host.querySelector<HTMLButtonElement>('.gallery-tabs .reader-home-tab [role=tab]')!;
 await act(async()=>home.click());expect(host.querySelector('textarea')).toBeNull();
 const draftTab=host.querySelector<HTMLButtonElement>('.gallery-tabstrip [role=tab]')!;
 await act(async()=>draftTab.click());expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('未发送的图片要求');
 await act(async()=>draftTab.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
 expect(home.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(home);
 expect(invoke.mock.calls.some(([,args])=>['gallery_prompt','task_create'].includes(args.method))).toBe(false);
});


const shortcut=async(action:string)=>act(async()=>{for(const [name,handler] of listen.mock.calls)if(name==='reader-tab-shortcut')handler({payload:action});});
const tabKey=async(key:string,options:KeyboardEventInit)=>act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));
it('cycles through image home and restores a closed conversation without restarting a completed task',async()=>{
 tasks[0].completedAt='2026-10-05';await render({initialTaskId:'image-one'});
 const home=()=>host.querySelector('[aria-label="图片列表"][role=tab]')!;
 await shortcut('next');expect(home().getAttribute('aria-selected')).toBe('true');
 await shortcut('close');expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(1);
 await tabKey('Tab',{ctrlKey:true,shiftKey:true});expect(home().getAttribute('aria-selected')).toBe('false');
 await shortcut('close');expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(0);expect(home().getAttribute('aria-selected')).toBe('true');
 await shortcut('reopen');expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(1);expect(host.querySelector('textarea')).toBeNull();
 expect(host.textContent).toContain('此对话已结束');expect(invoke.mock.calls.some(([,args])=>['task_create','gallery_prompt','task_finish','cancel'].includes(args.method))).toBe(false);
 await render({active:false});await shortcut('close');expect(host.querySelectorAll('.gallery-tabstrip>div')).toHaveLength(1);
});
it('restores an unsent closed image draft through the same keyboard commands without creating a task',async()=>{
 await render();await act(async()=>button('＋ 新建图片对话').click());await input('关闭后要恢复的草稿');
 await tabKey('w',{metaKey:true});expect(host.querySelector('textarea')).toBeNull();
 await tabKey('t',{metaKey:true,shiftKey:true});expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('关闭后要恢复的草稿');
 expect(invoke.mock.calls.some(([,args])=>['task_create','gallery_prompt'].includes(args.method))).toBe(false);
});
