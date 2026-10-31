// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import PrivateHtmlPreview from '../editorial/PreviewInternalNotes';
import WechatPreview from '../editorial/WechatPreview';
const {invoke,copy}=vi.hoisted(()=>({invoke:vi.fn(),copy:vi.fn()}));
vi.mock('../lib/nativeCore',()=>({invoke}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('../editorial/wechatFormat',async importOriginal=>({...await importOriginal<typeof import('../editorial/wechatFormat')>(),copyRichHtml:copy}));
let host:HTMLDivElement,root:Root;
const data={internalNotes:{writing:'TITLE_PRIVATE'},modelSignatures:[{runId:'one',agentId:'codex',agentName:'Codex',modelId:'gpt-6.1-terra',modelName:null,action:'organize',status:'completed',startedAt:'2026-10-28T00:00:00Z'}],blockNotes:{
 row:{anchor:{type:'paragraph',text:'模拟 **3.5 倍**。[1]'},notes:{supplement:'ROW_PRIVATE'}},
 repeated:{anchor:{type:'paragraph',text:'重复正文'},notes:{supplement:'REPEATED_PRIVATE'}},
 changed:{anchor:{type:'paragraph',text:'旧版本正文'},notes:{supplement:'CHANGED_PRIVATE'}}
}};
const html='<h1>报告</h1><p>模拟 <strong>3.5 倍</strong>。[1]</p><p>重复正文</p><p>重复正文</p><p>新版本正文</p>';
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();invoke.mockReset().mockResolvedValue(data);copy.mockReset().mockResolvedValue(undefined);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const marker=(id:string)=>host.querySelector<HTMLButtonElement>(`[data-preview-note-id="${id}"] button`)!;
it('anchors notes without altering public HTML, keeps ambiguous rows at the title, and preserves the body on rerender',async()=>{
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'one',html})));
 const body=host.querySelector('.private-preview-content')!,paragraph=body.querySelector('p');
 expect(body.innerHTML).toBe(html);expect(marker('row')).toBeDefined();expect(marker('repeated')).toBeNull();expect(marker('changed')).toBeNull();
 await act(async()=>marker('row').focus());expect(document.querySelector('[role=dialog]')?.textContent).toContain('ROW_PRIVATE');expect(host.textContent).not.toContain('ROW_PRIVATE');
 await act(async()=>marker('__title').click());expect(document.querySelector('[aria-label="作者备注"]')?.textContent).toContain('REPEATED_PRIVATE');expect(document.querySelector('[aria-label="作者备注"]')?.textContent).toContain('CHANGED_PRIVATE');expect(document.querySelector('[aria-label="作者备注"]')?.textContent).toContain('gpt-6.1-terra');
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'one',html})));
 expect(body.querySelector('p')).toBe(paragraph);expect(body.innerHTML).toBe(html);
 expect(invoke.mock.calls).toHaveLength(1);
});
it('WeChat keeps decorated heading anchors and copies only clean public HTML even with a note open',async()=>{
 invoke.mockResolvedValue({...data,blockNotes:{heading:{anchor:{type:'heading',text:'研究结果'},notes:{supplement:'HEADING_PRIVATE'}}}});
 await act(async()=>root.render(createElement(WechatPreview,{articleId:'one',html:'<h1>报告</h1><h2>研究结果</h2><p>已公开的内容</p>',category:'学者观察'})));
 expect(marker('heading')).not.toBeNull();await act(async()=>marker('heading').click());
 expect(document.querySelector('[role=dialog]')?.textContent).toContain('HEADING_PRIVATE');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='复制公众号图文')!.click());
 expect(copy).toHaveBeenCalledOnce();expect(copy.mock.calls[0][0]).toContain('研究结果');expect(copy.mock.calls[0][0]).not.toMatch(/PRIVATE|gpt-6|data-visibility|notebook-private/);
});
it('discards late private data when another article is selected',async()=>{
 let finish!:(value:typeof data)=>void;
 invoke.mockImplementation((_command,args)=>args.params.id==='one'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(null));
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'one',html})));
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'two',html})));
 await act(async()=>finish(data));expect(host.querySelector('.notebook-private-trigger')).toBeNull();
});
it('a cloud-only work reads notes through the publisher and names an older notes version',async()=>{
 invoke.mockResolvedValue({source:'cloud',revision:2,privateEditorial:data});
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'cloud-one',html,cloudRevision:3})));
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'private_notes',params:{id:'cloud-one',revision:3}});
 expect(marker('row')).not.toBeNull();expect(host.querySelector('.preview-internal-notice')?.textContent).toBe('作者备注来自 v2');
 expect(host.querySelector('.private-preview-content')!.innerHTML).toBe(html);
 invoke.mockResolvedValue({source:'unsupported',revision:null,privateEditorial:null});
 await act(async()=>root.render(createElement(PrivateHtmlPreview,{articleId:'cloud-two',html,cloudRevision:1})));
 expect(host.querySelector('.preview-internal-notice')?.textContent).toBe('官网暂不支持读取其他设备的作者备注');expect(host.querySelector('.notebook-private-trigger')).toBeNull();
});
