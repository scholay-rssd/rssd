// @vitest-environment jsdom
import {act,createElement,Fragment} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LibraryManager from '../editorial/LibraryManager';
import ToastViewport from '../components/ToastViewport';
import {useToasts} from '../toast';
import {collectWorks,type Work} from '../editorial/contentLibrary';
import {EMPTY} from '../publications/model';

vi.mock('../lib/useWorkspaceTabShortcuts',()=>({default:()=>{}}));
vi.mock('../components/PaneToolbar',()=>({default:({children}:any)=>children}));
vi.mock('../editorial/WorkDetail',()=>({default:()=>null}));
let root:Root,host:HTMLDivElement;
const changed=vi.fn(),cloudChanged=vi.fn(),externalRefresh=vi.fn(),cloudLoad=vi.fn();
const sourceNames={local:'Mac mini (3)',cloud:'today.scholay.com',external:'飞书多维表格'};
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();useToasts.getState().dismiss();
 changed.mockReset();cloudChanged.mockReset().mockResolvedValue(undefined);externalRefresh.mockReset().mockResolvedValue(undefined);cloudLoad.mockReset().mockResolvedValue(undefined);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();useToasts.getState().dismiss();vi.unstubAllGlobals();});
let currentWorks:Work[]=[];
async function render(works:Work[]=[],scope:'local'|'cloud'='local'){currentWorks=works;await act(async()=>root.render(createElement(Fragment,null,createElement(LibraryManager,{key:scope,scope,onOpenLocal:vi.fn(),active:true,works,sourceNames,workspace:'/fixture',refreshToken:0,leases:{},localLoading:false,onCloudLoad:cloudLoad,onChanged:changed,onCloudChanged:cloudChanged,onExternalRefresh:externalRefresh,canEdit:()=>true,onEditorContext:vi.fn()}),createElement(ToastViewport))));}
const refresh=()=>host.querySelector<HTMLButtonElement>('.manager-refresh')!;
async function select(location:'local'|'cloud'){await render(currentWorks,location);}

it('refreshes only the selected location directly without a menu',async()=>{
 await render();expect(host.querySelector('.manager-search details')).toBeNull();
 expect(refresh().getAttribute('aria-label')).toBe('刷新稿件');
 await act(async()=>refresh().click());expect(changed).toHaveBeenCalledTimes(1);expect(cloudChanged).not.toHaveBeenCalled();expect(externalRefresh).not.toHaveBeenCalled();
 await select('cloud');expect(refresh().title).toBe('刷新today.scholay.com作品');
 await act(async()=>refresh().click());expect(cloudLoad).toHaveBeenCalledWith('manual');expect(cloudChanged).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledTimes(1);expect(externalRefresh).not.toHaveBeenCalled();
 expect(host.querySelector('[data-location="external"]')).toBeNull();expect(host.querySelectorAll('.manager-locations button')).toHaveLength(0);
 const published=host.querySelector<HTMLButtonElement>('.manager-refresh-published')!;expect(published.getAttribute('aria-label')).toBe('刷新发布记录');
 await act(async()=>published.click());expect(externalRefresh).toHaveBeenCalledTimes(1);expect(cloudChanged).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledTimes(1);
});

it('keeps refresh disabled until the selected source resolves and reports failures',async()=>{
 let reject!:(error:Error)=>void;cloudLoad.mockImplementation((refresh?:string)=>refresh==='manual'?new Promise<void>((_,fail)=>{reject=fail;}):Promise.resolve());
 await render();await select('cloud');await act(async()=>refresh().click());
 expect(refresh().disabled).toBe(true);expect(refresh().getAttribute('aria-busy')).toBe('true');
 const published=()=>host.querySelector<HTMLButtonElement>('.manager-refresh-published')!;expect(published().disabled).toBe(true);await act(async()=>published().click());expect(externalRefresh).not.toHaveBeenCalled();
 await act(async()=>reject(Error('云端暂时无法连接')));expect(refresh().disabled).toBe(false);expect(host.querySelector('[role=alert]')?.textContent).toContain('云端暂时无法连接');
 await act(async()=>published().click());expect(externalRefresh).toHaveBeenCalledTimes(1);expect(host.querySelector('[role=alert]')).toBeNull();
});

it('has no public versus private selector in any location and keeps publication labels honest',async()=>{
 const works:Work[]=[{id:'public',title:'官网稿件',type:'observation',category:'学者观察',locations:['local','cloud'],status:'public',external:[],date:''},{id:'old',title:'历史稿件',type:'observation',category:'学者观察',locations:['cloud'],status:'unpublished',external:[],date:''}];
 await render(works);expect(host.querySelector('[aria-label="公开性筛选"]')).toBeNull();
 await select('cloud');expect(host.querySelector('[aria-label="公开性筛选"]')).toBeNull();expect(host.querySelectorAll('.manager-card')).toHaveLength(2);
 expect(host.querySelector('.manager-collection')?.textContent).toContain('已公开');expect(host.querySelector('.manager-collection')?.textContent).toContain('未公开');expect(host.textContent).not.toContain('非公开');
});

it('offers clearing only when an empty list has active filters',async()=>{
 await render();expect(host.querySelector('.manager-empty')?.textContent).toBe('暂无稿件');expect(host.querySelector('.manager-empty button')).toBeNull();
 const input=host.querySelector<HTMLInputElement>('[aria-label="搜索稿件"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'未找到');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelector('.manager-empty p')?.textContent).toBe('没有匹配稿件');
 await act(async()=>host.querySelector<HTMLButtonElement>('.manager-empty button')!.click());
 expect(input.value).toBe('');expect(host.querySelector('.manager-empty button')).toBeNull();
});

it('selects one public section at a time and keeps it selected until choosing another or all',async()=>{
 await render([{id:'news',title:'新闻稿',type:'xiwen',category:'学界犀闻',locations:['local'],status:null,external:[],date:''},{id:'observation',title:'观察稿',type:'observation',category:'学者观察',locations:['local'],status:null,external:[],date:''}]);
 const category=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('.manager-categories button')].find(b=>b.querySelector('span')?.textContent===name)!;
 await act(async()=>category('学界犀闻').click());expect(host.querySelector('.manager-card strong')?.textContent).toBe('新闻稿');
 await act(async()=>category('学者观察').click());expect(category('学界犀闻').getAttribute('aria-pressed')).toBe('false');expect(host.querySelectorAll('.manager-card')).toHaveLength(1);expect(host.querySelector('.manager-card strong')?.textContent).toBe('观察稿');
 await act(async()=>category('学者观察').click());expect(category('学者观察').getAttribute('aria-pressed')).toBe('true');expect(host.querySelectorAll('.manager-card')).toHaveLength(1);
 await act(async()=>category('全部栏目').click());expect(host.querySelectorAll('.manager-card')).toHaveLength(2);
});

it('shows all online sections including empty sections and filters independent of writing method',async()=>{
 const work=(id:string,type:string,category:string):Work=>({id,title:id,type,category,locations:['local'],status:null,external:[],date:''});
 await render([work('report-as-news','observation','学界犀闻'),work('report','observation','学者观察'),work('digest','xiwen','学界犀闻')]);
 const tab=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('.manager-categories button')].find(b=>b.querySelector('span')?.textContent===name)!;
 expect(host.querySelector('[aria-label="按用途筛选"]')).toBeNull();expect(tab('项目合作').querySelector('small')?.textContent).toBe('0');expect(tab('课程资源')).toBeTruthy();
 await act(async()=>tab('学界犀闻').click());expect([...host.querySelectorAll('.manager-card strong')].map(x=>x.textContent)).toEqual(['report-as-news','digest']);
 await act(async()=>tab('项目合作').click());expect(host.querySelectorAll('.manager-card')).toHaveLength(0);
 await act(async()=>tab('全部栏目').click());expect(host.querySelectorAll('.manager-card')).toHaveLength(3);
});

it('displays local manuscript metadata and finds the same summary from the search field',async()=>{
 const drafts=[{id:'rich',shortTitle:'研究工具',canonicalPath:'articles/annex/学术开源/正文.md',batchDate:'2026-09-01',archiveCategory:'学术开源',stage:'local' as const,receipt:null,preparedAt:null,metadata:{date:'2026-10-06',summary:'可追溯的参数记录'}},{id:'legacy',shortTitle:'旧版稿件',canonicalPath:'articles/annex/昔日学术/正文.md',batchDate:'2026-10-02',archiveCategory:'昔日学术',stage:'local' as const,receipt:null,preparedAt:null}];
 await render(collectWorks(drafts,EMPTY));
 const cards=[...host.querySelectorAll('.manager-card')];
 expect(cards).toHaveLength(2);expect(cards[0].querySelector('time')?.textContent).toBe('2026-10-06');expect(cards[0].querySelector('p')?.textContent).toBe('可追溯的参数记录');
 expect(cards[1].querySelector('time')?.textContent).toBe('2026-10-02');expect(cards[1].querySelector('p')).toBeNull();
 const input=host.querySelector<HTMLInputElement>('[aria-label="搜索稿件"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'参数记录');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelectorAll('.manager-card')).toHaveLength(1);expect(host.querySelector('.manager-card strong')?.textContent).toBe('研究工具');expect(host.querySelector('.manager-card p')?.textContent).toBe('可追溯的参数记录');
});

it('keeps cloud summaries visible when local metadata is absent',async()=>{
 const work=collectWorks([],{...EMPTY,website:{updatedAt:null,items:[{key:'news:cloud',articleId:'cloud',kind:'news',title:'云端文章',summary:'云端原有摘要',category:'学者观察',dateLabel:'2026-10-02',lastmod:null,url:'https://example.invalid/cloud/',detailPage:true,sourceUrls:[]}]}})[0];
 await render([work]);await select('cloud');
 expect(host.querySelector('.manager-card p')?.textContent).toBe('云端原有摘要');expect(host.querySelector('.manager-card time')?.textContent).toBe('2026-10-02');
});
