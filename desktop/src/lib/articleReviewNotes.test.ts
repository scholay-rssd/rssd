// @vitest-environment jsdom
import {act,createElement,Fragment} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import ArticleReviewNotes from '../editorial/ArticleReviewNotes';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../lib/nativeCore',()=>({invoke}));
let host:HTMLDivElement,root:Root;
const anchor='原文锚点。'.repeat(50);
const data={internalNotes:{writing:'PRIVATE_WRITING',images:'PRIVATE_IMAGE',verification:'PRIVATE_VERIFY'},blockNotes:{one:{anchor:{type:'paragraph',text:anchor},notes:{supplement:'PRIVATE_ROW'}}},modelSignatures:[{runId:'actual-run',agentId:'codex',agentName:'Codex',modelId:'gpt-6.1-terra[ultra]',modelName:null,action:'organize',status:'completed',startedAt:'2026-11-04T01:00:00Z',device:'Mac mini'}]};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);invoke.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('provides one visible read-only inspector for document notes, complete row anchors, and actual model records outside public prose',async()=>{
 invoke.mockResolvedValue(data);
 await act(async()=>root.render(createElement(Fragment,null,createElement('article',{className:'public-article'},'公开内容'),createElement(ArticleReviewNotes,{articleId:'one',version:'saved-sha'}))));
 expect(invoke).toHaveBeenCalledWith('editorial_call',{method:'draft_private_notes',params:{id:'one'}});
 const inspector=host.querySelector<HTMLDetailsElement>('details.article-review-notes')!;
 expect(inspector.open).toBe(false);expect(inspector.querySelector('summary')!.textContent).toContain('内部审查');expect(inspector.querySelector('summary')!.textContent).toContain('5 项');expect(inspector.getAttribute('data-visibility')).toBe('private');
 expect(inspector.textContent).toContain('仅作者可见 · 不对外展示');expect(inspector.textContent).toContain('PRIVATE_WRITING');expect(inspector.textContent).toContain('PRIVATE_IMAGE');expect(inspector.textContent).toContain('PRIVATE_VERIFY');expect(inspector.textContent).toContain('PRIVATE_ROW');expect(inspector.querySelector('blockquote')!.textContent).toBe(anchor);expect(inspector.textContent).toContain('gpt-6.1-terra[ultra]');expect(inspector.textContent).toContain('Mac mini');
 expect(inspector.querySelector('textarea,input,[contenteditable=true]')).toBeNull();expect(host.querySelector('.public-article')!.textContent).toBe('公开内容');expect(inspector.closest('article')).toBeNull();
});
it('hides previous notes immediately on article change and discards a late read',async()=>{
 let finishFirst!:(value:typeof data)=>void,finishSecond!:(value:null)=>void;
 invoke.mockImplementation((_command,args)=>args.params.id==='one'?new Promise(resolve=>{finishFirst=resolve;}):new Promise(resolve=>{finishSecond=resolve;}));
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'one',version:1})));
 expect(host.querySelector('summary')!.textContent).toContain('正在读取…');
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'two',version:1})));
 await act(async()=>finishFirst(data));expect(host.textContent).not.toContain('PRIVATE_');expect(host.querySelector('summary')!.textContent).toContain('正在读取…');
 await act(async()=>finishSecond(null));expect(host.querySelector('summary')!.textContent).toContain('暂无内部审查记录');
});
it('keeps a visible empty or error state and reads cloud revision through the publisher',async()=>{
 invoke.mockResolvedValue({source:'cloud',revision:2,privateEditorial:data});
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'cloud-one',version:'html',cloudRevision:3})));
 expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'private_notes',params:{id:'cloud-one',revision:3}});expect(host.textContent).toContain('作者备注来自 v2');
 invoke.mockResolvedValue({source:'unsupported',revision:null,privateEditorial:null});
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'cloud-two',version:'html',cloudRevision:1})));
 expect(host.querySelector('summary')!.textContent).toContain('内部审查');expect(host.textContent).toContain('暂无内部审查记录');expect(host.textContent).toContain('官网暂不支持读取其他设备的作者备注');expect(host.textContent).not.toContain('PRIVATE_');
 invoke.mockRejectedValue(Error('Credential unavailable'));
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'cloud-three',version:'html',cloudRevision:1})));
 expect(host.querySelector('summary')!.textContent).toContain('读取失败');expect(host.querySelector('[role=status]')!.textContent).toContain('Credential unavailable');
});

it('hides a previous cloud revision while the same article and rendered version load newer private notes',async()=>{
 let finish!:(value:unknown)=>void;
 invoke.mockImplementation((_command,args)=>args.params.revision===1?Promise.resolve({source:'cloud',revision:1,privateEditorial:{...data,internalNotes:{writing:'OLD_REVISION_PRIVATE'}}}):new Promise(resolve=>{finish=resolve;}));
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'same',version:'unchanged-html',cloudRevision:1})));
 expect(host.textContent).toContain('OLD_REVISION_PRIVATE');
 await act(async()=>root.render(createElement(ArticleReviewNotes,{articleId:'same',version:'unchanged-html',cloudRevision:2})));
 expect(host.textContent).not.toContain('OLD_REVISION_PRIVATE');expect(host.querySelector('summary')!.textContent).toContain('正在读取…');
 await act(async()=>finish({source:'cloud',revision:2,privateEditorial:{...data,internalNotes:{writing:'NEW_REVISION_PRIVATE'}}}));
 expect(host.textContent).toContain('NEW_REVISION_PRIVATE');expect(host.textContent).not.toContain('OLD_REVISION_PRIVATE');
});
