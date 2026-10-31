// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import EditorialBoard from "../editorial/EditorialBoard";
const invoke=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock('../editorial/EditorialRichEditor',()=>({default:({text,onChange}:{text:string;onChange:(value:string)=>void})=>createElement('textarea',{'aria-label':'Markdown 正文',value:text,onChange:(event:{target:{value:string}})=>onChange(event.target.value)})}));
vi.mock("@tauri-apps/plugin-opener",()=>({openUrl:vi.fn()}));
vi.mock("../i18n",()=>({default:{t:(key:string)=>key,language:"zh"}}));
it("publication links preserve an unsaved manuscript until the user decides",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  invoke.mockImplementation(async(_command:string,{method,params}:{method:string;params:{id:string}})=>{
    if(method==="draft_list")return {articles:[]};
    if(method==="draft_read")return {id:params.id,shortTitle:params.id,canonicalPath:"articles/"+params.id,markdown:"# original",sha256:"first"};
    if(method==="draft_preview")return {html:"<h1>Original</h1>"};
    return {};
  });
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(createElement(EditorialBoard,{active:true,openRequest:{id:"one",nonce:1}})));
    const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(x=>x.textContent===text)!;
    await act(async()=>button("编辑").click());
    const textarea=host.querySelector("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"# unsaved");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>root.render(createElement(EditorialBoard,{active:true,openRequest:{id:"two",nonce:2}})));
    expect(host.textContent).toContain("当前稿件有未保存修改");
    expect(textarea.value).toBe("# unsaved");
    expect(invoke.mock.calls.filter(([,x])=>x.method==="draft_read"&&x.params.id==="two")).toHaveLength(0);
    await act(async()=>button("继续编辑").click());
    expect(textarea.value).toBe("# unsaved");
    await act(async()=>root.render(createElement(EditorialBoard,{active:true,openRequest:{id:"two",nonce:3}})));
    await act(async()=>button("放弃修改并切换").click());
    expect(invoke.mock.calls.some(([,x])=>x.method==="draft_read"&&x.params.id==="two")).toBe(true);
  }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it("opens website preparation for the saved manuscript and blocks unsaved text",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);invoke.mockReset();const onPublishWebsite=vi.fn();
  invoke.mockImplementation(async(_command:string,{method,params}:{method:string;params:{id:string}})=>{
    if(method==="draft_list")return {articles:[]};
    if(method==="draft_read")return {id:params.id,shortTitle:params.id,canonicalPath:"articles/"+params.id,markdown:"# saved",sha256:"source"};
    if(method==="draft_preview")return {html:"<h1>saved</h1>"};return {};
  });
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(createElement(EditorialBoard,{active:true,openRequest:{id:"local-news",nonce:1},onPublishWebsite})));
    const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(x=>x.textContent===text)!;
    await act(()=>button("发布到官网").click());expect(onPublishWebsite).toHaveBeenCalledWith("local-news");onPublishWebsite.mockClear();
    await act(()=>button("编辑").click());
    await act(()=>{const textarea=host.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"# unsaved");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(button("发布到官网").disabled).toBe(true);await act(()=>button("发布到官网").click());expect(onPublishWebsite).not.toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([command])=>command==="website_publish_call").every(([,payload])=>["snapshot","inspect"].includes(payload.method))).toBe(true);
  }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
