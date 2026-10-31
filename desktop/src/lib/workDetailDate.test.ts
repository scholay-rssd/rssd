// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WorkDetail from '../editorial/WorkDetail';
import {collectWorks,type Work} from '../editorial/contentLibrary';
import {EMPTY,type WebsiteItem} from '../publications/model';
import type {WebsiteDraft} from '../publications/websitePublishing';

vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async(_command:string,{method}:{method:string})=>{
 if(method==='cloud_action_cached')return null;
 throw Error('Unexpected native call: '+method);
})}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../editorial/EditorialBoard',()=>({default:()=>null}));
vi.mock('../publications/WebsitePublisher',()=>({default:()=>null}));
vi.mock('../publications/PublicationReader',()=>({default:()=>null}));

let root:Root,host:HTMLDivElement;
const noop=()=>{};
const local:WebsiteDraft={id:'local',shortTitle:'本地稿件',canonicalPath:'articles/annex/学术开源/正文.md',batchDate:'2026-09-01',archiveCategory:'学术开源',stage:'local',receipt:null,preparedAt:null};
const cloud:WebsiteItem={key:'news:local',articleId:'local',kind:'news',title:'云端稿件',summary:'云端摘要',category:'学术开源',dateLabel:'1998 年 11 月 20 日',lastmod:'2026-10-09T10:00:00Z',url:'https://example.invalid/local/',detailPage:true,sourceUrls:[]};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(work:Work){await act(async()=>root.render(createElement(WorkDetail,{work,active:true,refreshToken:0,onChanged:noop,onCloudChanged:async()=>{},onEditorContext:noop,onLocalView:noop,onOpenLocal:noop})));}
function work(draft:WebsiteDraft){return collectWorks([draft],{...EMPTY,website:{items:[cloud],updatedAt:null}})[0];}

it('shows the manuscript metadata date in local work information even with an older batch and newer cloud revision',async()=>{
 await render(work({...local,metadata:{date:'2026-10-06',summary:'本地摘要'}}));
 expect(host.querySelector('.work-info time')?.textContent).toBe('2026-10-06');
});

it('preserves batch dates for old drafts and cloud event labels when no local date is available',async()=>{
 await render(work(local));expect(host.querySelector('.work-info time')?.textContent).toBe('2026-09-01');
 await render(work({...local,batchDate:null,metadata:{date:' '}}));
 expect(host.querySelector('.work-info time')?.textContent).toBe('1998 年 11 月 20 日');
});

it('shows third-party releases as a read-only strip of chips that open each record in the work, and not in workflow mode',async()=>{
 const records=[{id:'a',taskId:'t',sourceId:'local',title:'知乎版',platform:'知乎',status:'已发布',url:'https://example.invalid/z'},{id:'b',taskId:'t',sourceId:'local',title:'微博版',platform:'微博',status:'待核验',url:'https://example.invalid/w'}];
 const decorated=collectWorks([local],{...EMPTY,website:{items:[cloud],updatedAt:null},feishu:{configured:true,updatedAt:null,records},drafts:[{id:'local',title:'作品',sourceIds:[]}]})[0];
 await render(decorated);
 const strip=host.querySelector('.work-published-on')!;expect(strip.getAttribute('aria-label')).toBe('已发布到');expect([...strip.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['知乎已发布','微博待核验']);
 expect(strip.querySelector('button')!.getAttribute('title')).toBe('知乎版 · 已发布');expect(strip.querySelector('[aria-pressed=true]')).toBeNull();
 await act(async()=>strip.querySelectorAll('button')[1].click());expect(strip.querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('true');expect(host.querySelector('.work-external')).not.toBeNull();expect(host.querySelector('.work-external-records [aria-pressed=true]')!.textContent).toContain('微博');
 await act(async()=>root.render(createElement(WorkDetail,{work:decorated,workflow:true,active:true,refreshToken:0,onChanged:noop,onCloudChanged:async()=>{},onEditorContext:noop,onLocalView:noop,onOpenLocal:noop})));expect(host.querySelector('.work-published-on')).toBeNull();
 await render(work(local));expect(host.querySelector('.work-published-on')).toBeNull();
});
