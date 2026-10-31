// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const browse=vi.hoisted(()=>vi.fn());
vi.mock('../connections/client',async original=>({...await original<any>(),connectionService:{browse}}));
import NotebookAppResources from '../editorial/NotebookAppResources';
let root:Root,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.unstubAllGlobals();});
async function setup(providerId='github'){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const props={providerId,mountedIds:[] as string[],disabled:false,onSource:vi.fn(),onFile:vi.fn(()=>true),onOpen:vi.fn(),onClose:vi.fn()};
 const show=()=>act(async()=>root.render(createElement(NotebookAppResources,props)));await show();return {props,show};
}
it('app references preserve provider identity and removing a mount makes the result selectable again',async()=>{
 browse.mockResolvedValue({items:[{id:'release-1',title:'1.0',detail:'发布说明',kind:'release',url:'https://example.org/release'}]});
 const {props,show}=await setup(),button=()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('附加'))!;
 await act(async()=>button().click());expect(props.onSource).toHaveBeenCalledWith(expect.objectContaining({recordId:'github:release-1',publisher:'GitHub',url:'https://example.org/release'}));
 props.mountedIds=['github:release-1'];await show();expect(button().disabled).toBe(true);
 props.mountedIds=[];await show();expect(button().disabled).toBe(false);expect(browse).toHaveBeenCalledTimes(1);
});
it('directory-only records become explicitly labelled text attachments without pretending to contain book text',async()=>{
 browse.mockReset();browse.mockResolvedValue({items:[{id:'book',title:'书目',detail:'目录条目',target:'documents/book',kind:'document'}]});
 const {props}=await setup('google-books');await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='附加目录信息')!.click());
 expect(props.onSource).not.toHaveBeenCalled();expect(props.onFile).toHaveBeenCalledWith(expect.objectContaining({name:'书目.txt',type:'text',text:expect.stringContaining('不包含文档正文')}));
});
