// @vitest-environment jsdom
import {act,createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import StructuredWorkflow from '../editorial/StructuredWorkflow';
const {call,readRecords}=vi.hoisted(()=>({call:vi.fn(),readRecords:vi.fn()}));
vi.mock('../editorial/taskWorkbench',async importOriginal=>({...await importOriginal<any>(),taskCall:call}));
vi.mock('../editorial/CursorAgentPane',async()=>{const {default:Rail}=await import('../editorial/FlowStepRail');return {default:(props:any)=>createElement('aside',null,'执行记录',createElement(Rail,{steps:props.workflowRail?.steps||[]}))};});
vi.mock('../editorial/WorkDetail',()=>({default:()=>null}));
vi.mock('../calendar/academicRecords',async importOriginal=>({...await importOriginal<any>(),loadAcademicRecords:readRecords}));
vi.mock('../api',()=>({getSetting:vi.fn(async()=>JSON.stringify({version:2,templates:[]})),setSetting:vi.fn(async()=>{}),listArticles:vi.fn(async()=>[])}));
const record=(mode:'history'|'calendar')=>({id:mode+':original-1',title:mode==='history'?'有来源的历史论文':'基金申报公告',tags:[mode==='history'?'学术文献史':'科研申报'],source:mode==='history'?'history':'year',kind:'point',precision:'day',approximate:false,start:{year:mode==='history'?1949:2026,month:10,day:5},payload:{factSummary:'原始资料中已经记载的事实',sources:[{label:'原始档案',url:'https://archive.example.org/record'}]}});

it.each(['history','calendar'] as const)('%s starts from an existing-record board and saves a manual choice through task revision without changing source records',async mode=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
 const original=record(mode),copy=structuredClone(original);readRecords.mockResolvedValue({events:[original]});
 const host=document.createElement('div'),root=createRoot(host);let current:any={id:'maintenance-'+mode,mode,title:'维护',days:30,brief:'',articleId:'new-record',workIds:[],assets:[],outline:{blocks:[]},revision:8,board:{titles:[],sections:[{id:'section',title:'资料核验',slotCount:0,slots:[],items:[]}]},ui:{tabs:[]}};const saved=vi.fn();
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,active:true,run:{},agentBusy:false,refreshToken:0,obscured:false,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onAccept:setTask,onSave:async(p:any,revision)=>{saved(p,revision);current={...current,...p,revision:revision!+1};setTask(current);},onDraft:()=>{},onRefresh:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));
 expect(host.querySelector('[aria-label="搜索已有记录"]')).not.toBeNull();expect(host.querySelector('[aria-label="日期索引"]')).not.toBeNull();
 await act(async()=>(host.querySelector('[aria-label="选用已有记录：'+original.title+'"]') as HTMLButtonElement).click());
 await act(async()=>(host.querySelector('[aria-label="资料核验候选素材，横向滚动"]') as HTMLElement).click());
 expect(saved).toHaveBeenCalledWith(expect.objectContaining({board:expect.any(Object)}),8);
 expect(current.board.sections[0].slots).toHaveLength(1);expect(current.board.sections[0].slots[0]).toEqual({id:current.board.sections[0].items[0].id,mode:'manual'});
 expect(current.board.sections[0].items[0]).toMatchObject({recordId:original.id,recordKind:original.source,acquiredVia:'record',date:mode==='history'?'1949-10-05':'2026-10-05',datePrecision:'day',selected:true,locked:true});
 expect(original).toEqual(copy);expect(host.querySelector('[aria-label="选用已有记录：'+original.title+'"]')?.hasAttribute('disabled')).toBe(true);
 expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='确认选题')?.disabled).toBe(false);
 await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();
});

it('creates a targeted enrichment slot then authorizes Cursor only after the current board has been saved',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));
 const original={...record('history'),precision:'month',approximate:true,start:{year:1949,month:10,day:null}};readRecords.mockResolvedValue({events:[original]});
 const host=document.createElement('div'),root=createRoot(host);let current:any={id:'enrichment',mode:'history',title:'增补史料',days:30,brief:'',articleId:'new-record',workIds:[],assets:[],outline:{blocks:[]},revision:11,board:{titles:[],sections:[{id:'section',title:'机构沿革',slotCount:0,slots:[],items:[]}]},ui:{tabs:[]}};
 call.mockReset();call.mockImplementation(async(method,p)=>{if(method==='task_workflow'){expect(p.expectedRevision).toBe(12);expect(current.board.sections[0].slots[0].prompt).toContain('1949-10');current={...current,workflow:{authorized:true,sources:'combined'},revision:13};return current;}if(method==='task_run'){expect(current.workflow.authorized).toBe(true);expect(current.board.sections[0].slots[0].prompt).toContain('https://archive.example.org/record');return {runId:'enrich-run'};}throw Error(method);});
 function Harness(){const [task,setTask]=useState(current);return createElement(StructuredWorkflow,{task,active:true,run:{},agentBusy:false,refreshToken:0,obscured:false,onUi:p=>setTask((t:any)=>({...t,ui:{...t.ui,...p}})),onAccept:setTask,onSave:async(p:any,revision)=>{expect(revision).toBe(11);current={...current,...p,revision:12};setTask(current);},onDraft:()=>{},onRefresh:()=>{},onChanged:()=>{},onCloudChanged:async()=>{},onOpenUrl:()=>{},onEditorContext:()=>{},onOpenLocal:()=>{}});}
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>(host.querySelector('[aria-label="增补已有记录：'+original.title+'"]') as HTMLButtonElement).click());
 await act(async()=>(host.querySelector('[aria-label="机构沿革候选素材，横向滚动"]') as HTMLElement).click());
 expect(current.board.sections[0].slots).toHaveLength(1);const slot=current.board.sections[0].slots[0];expect(slot.mode).toBe('smart');for(const fact of ['history:original-1','1949-10','学术文献史','确切月日','原记录只读'])expect(slot.prompt).toContain(fact);
 expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='确认选题')?.disabled).toBe(true);
 await act(async()=>(host.querySelector('.topic-collect') as HTMLButtonElement).click());
 expect(call).toHaveBeenLastCalledWith('task_run',{taskId:'enrichment',action:'topic',target:expect.any(String)});
 expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('选题');
 await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();
});

it('drags the existing record and its enrichment request through the same source payload while keeping manual slots immutable',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T01:00:00Z'));readRecords.mockResolvedValue({events:[record('calendar')]});
 const {default:TopicCards}=await import('../editorial/TopicCards');const host=document.createElement('div'),root=createRoot(host);let board:any={titles:[],sections:[{id:'s',title:'公告',slotCount:0,slots:[],items:[]}]};
 const render=()=>root.render(createElement(TopicCards,{mode:'calendar',board,busy:false,loading:false,sectionCount:1,onChange:next=>{board=next;render();},onOpenUrl:()=>{}}));
 const start=(element:Element)=>{const event=new Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{effectAllowed:'',setData:vi.fn()}});element.dispatchEvent(event);};
 await act(async()=>render());
 const row=()=>host.querySelector('.topic-card-items')!,drop=()=>act(async()=>row().dispatchEvent(new Event('drop',{bubbles:true,cancelable:true})));
 await act(async()=>start(host.querySelector('.academic-record-card')!));await drop();
 const manual=board.sections[0].slots[0];expect(manual).toEqual({id:manual.id,mode:'manual'});expect(board.sections[0].items[0]).toMatchObject({id:manual.id,recordId:'calendar:original-1',locked:true});
 await act(async()=>start(host.querySelector('[aria-label="增补已有记录：基金申报公告"]')!));
 await act(async()=>host.querySelectorAll('.topic-card')[0].dispatchEvent(new Event('drop',{bubbles:true,cancelable:true})));
 expect(board.sections[0].slots).toHaveLength(2);expect(board.sections[0].slots[1]).toEqual(manual);
 const smart=board.sections[0].slots[0];expect(smart).toMatchObject({mode:'smart',templateName:'增补：基金申报公告',enrichRecordId:'calendar:original-1'});expect(smart.prompt).toContain('calendar:original-1');expect(board.sections[0].items).toHaveLength(1);expect(board.sections[0].items[0].id).toBe(manual.id);
 await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();
});
