// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WorkDetail from '../editorial/WorkDetail';
import {collectWorks} from '../editorial/contentLibrary';
import {EMPTY,type WebsiteItem} from '../publications/model';

const html='<p>正文</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="配图"><p>结尾</p>';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../editorial/EditorialBoard',()=>({default:()=>null}));
vi.mock('../publications/WebsitePublisher',()=>({default:()=>null}));
vi.mock('../publications/PublicationReader',()=>({default:()=>null}));

let root:Root,host:HTMLDivElement;
const noop=()=>{};
const item:WebsiteItem={key:'news:cloud-only',articleId:'cloud-only',kind:'news',title:'云端图文',summary:'摘要',category:'学术开源',dateLabel:'2026-10-20',lastmod:'2026-10-20T10:00:00Z',url:'https://example.invalid/news/cloud-only/',detailPage:true,sourceUrls:[],revision:2,version:2,publishedVersion:2,publicationState:'published'} as WebsiteItem;
const work=collectWorks([],{...EMPTY,website:{items:[item],updatedAt:null}})[0];
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 invoke.mockReset().mockImplementation(async(_command:string,{method}:{method:string})=>{
  if(method==='cloud_action_cached')return null;
  if(method==='cloud')return {id:'cloud-only',title:'云端图文',html,version:2,publishedVersion:2,url:'https://example.invalid/news/cloud-only/',metadata:{category:'学术开源',date:'2026-10-20'}};
  throw Error('Unexpected native call: '+method);
 });
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
// Each call passes fresh callbacks, as a workspace poll re-render does.
async function render(){await act(async()=>root.render(createElement(WorkDetail,{work,initialSource:'cloud',active:true,refreshToken:0,onChanged:()=>{},onCloudChanged:async()=>{},onEditorContext:()=>{},onLocalView:noop,onOpenLocal:noop})));}

it('keeps cloud article images mounted when an unrelated poll re-renders the work',async()=>{
 await render();
 const image=host.querySelector('.editorial-preview img');
 expect(image).not.toBeNull();
 const replaced=vi.fn();const observer=new MutationObserver(replaced);
 observer.observe(image!.parentElement!,{childList:true});
 for(let i=0;i<3;i++)await render();
 observer.disconnect();
 expect(host.querySelector('.editorial-preview img')).toBe(image);
 expect(replaced).not.toHaveBeenCalled();
});
