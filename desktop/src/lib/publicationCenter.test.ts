// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import PublicationCenter from "../publications/PublicationCenter";
import {EMPTY,type Snapshot,type Publication,type PublicationSection} from "../publications/model";
import {PUBLICATION_SPLIT_KEY,WEBSITE_SPLIT_KEY} from "../publications/usePublicationSplit";
const invoke=vi.hoisted(()=>vi.fn());
const openUrl=vi.hoisted(()=>vi.fn());
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock("@tauri-apps/plugin-opener",()=>({openUrl}));
vi.mock("../publications/PublicationReader",()=>({default:(props:{active:boolean;obscured:boolean;url:string|null;title:string;emptyMessage:string})=>createElement("section",{"data-reader":true,"data-active":String(props.active),"data-obscured":String(props.obscured),"data-url":props.url||""},props.url?props.title:props.emptyMessage)}));
const record=(id:string,sourceId:string,platform:string,url:string):Publication=>({id,sourceId,platform,url,taskId:id,title:sourceId,status:url?"已发布":"待审核",modifiedAt:"2026-10-02T00:00:00Z"});
const data:Snapshot={...EMPTY,drafts:[{id:"Article A",title:"A"}],feishu:{configured:true,updatedAt:"2026-10-02",records:[record("a","Article A","平台甲","https://a.example/post"),record("b","Article A","平台乙","https://b.example/post"),record("c","Article A","平台丙",""),record("d","Article B","平台丁","")]},website:{updatedAt:"2026-10-02",items:[{key:"news:one",articleId:"one",kind:"news",title:"官网文章",summary:"官网摘要",dateLabel:"2026-10-02",category:"新闻",url:"https://today.scholay.com/news/one/",detailPage:true,lastmod:null,sourceUrls:[]}]}};
let host:HTMLDivElement,root:Root;
let viewport:number,scale:number,observers:Set<()=>void>;
beforeEach(()=>{
  viewport=1200;scale=1;observers=new Set();localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class {constructor(private callback:()=>void){} observe(){observers.add(this.callback);} disconnect(){observers.delete(this.callback);}});
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(viewport);
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(()=>({x:0,y:0,left:0,top:0,right:viewport*scale,bottom:900,width:viewport*scale,height:900,toJSON(){}}));
  invoke.mockReset().mockImplementation(async(_,args)=>args.method==="published"?{id:"one",revision:1,title:"官网文章",html:"<p>数据库正文</p>",metadata:{author:"编辑",date:"2026-10-02",category:"学界犀闻"},url:"https://today.scholay.com/news/one/"}:structuredClone(data));openUrl.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=(active=true,section:PublicationSection="platforms")=>act(async()=>root.render(createElement(PublicationCenter,{section,active,onOpenDraft:vi.fn()})));
const click=(selector:string)=>act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());
const reader=()=>host.querySelector<HTMLElement>("[data-reader]")!;
const divider=()=>host.querySelector<HTMLElement>('[role="separator"]')!;
const dividerWidth=()=>Number(divider().getAttribute("aria-valuenow"));
const key=(key:string)=>act(()=>divider().dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})));
const resizeWindow=(width:number,zoom=1)=>act(()=>{viewport=width;scale=zoom;vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype,"clientWidth")!.get!).mockReturnValue(width);observers.forEach(callback=>callback());});
it("expands publication records in the middle list and opens the selected work internally",async()=>{
  await render();
  expect(host.querySelectorAll(".pub-list .pub-record")).toHaveLength(3);
  await click('[aria-label="查看平台乙作品：Article A"]');
  expect(reader().dataset.url).toBe("https://b.example/post");
  expect(host.querySelector('[aria-label="查看平台乙作品：Article A"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(reader().querySelector(".pub-record")).toBeNull();
  expect(openUrl).not.toHaveBeenCalled();
});
it("never leaves another platform's work visible for a record or article without a link",async()=>{
  await render();await click('[aria-label="查看平台乙作品：Article A"]');
  await click('[aria-label="查看平台丙作品：Article A"]');
  expect(reader().dataset.url).toBe("");expect(reader().textContent).toContain("平台丙暂无");
  await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>(".pub-list-item")).find(x=>x.textContent?.includes("Article B"))!.click());
  expect(reader().dataset.url).toBe("");expect(host.querySelectorAll(".pub-list .pub-record")).toHaveLength(1);
});
it("changing a platform filter resets the default reader to the matching record",async()=>{
  await render();await click('[aria-label="查看平台乙作品：Article A"]');
  await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>(".pub-filter")).find(x=>x.querySelector("span")?.textContent==="平台甲")!.click());
  expect(reader().dataset.url).toBe("https://a.example/post");
  expect(host.querySelectorAll(".pub-record.is-outside-filter")).toHaveLength(2);
  // Other platform records remain available, explicitly chosen by the user.
  await click('[aria-label="查看平台乙作品：Article A"]');expect(reader().dataset.url).toBe("https://b.example/post");
});
it("website reads the database body first and only opens a public page on request",async()=>{
  await render(true,"website");
  expect(host.querySelector("[data-reader]")).toBeNull();
  expect(host.querySelector(".website-db-preview")?.textContent).toContain("数据库正文");
  await act(async()=>Array.from(host.querySelectorAll("button")).find(x=>x.textContent==="预览公开页面")!.click());
  expect(reader().dataset.url).toBe("https://today.scholay.com/news/one/");
  expect(host.querySelector(".pub-list")?.textContent).toContain("官网摘要");
  expect(host.querySelector(".pub-list")?.textContent).toContain("未在此核验");
  await render(false,"website");expect(reader().dataset.active).toBe("false");
  expect(invoke).toHaveBeenCalledTimes(2);expect(invoke).toHaveBeenCalledWith("publications_call",{method:"snapshot"});
});

it("collapses middle details without discarding the target currently being read",async()=>{
  await render();await click('[aria-label="查看平台乙作品：Article A"]');
  await click('.pub-list-item[aria-current="true"]');
  expect(host.querySelectorAll(".pub-record")).toHaveLength(0);
  expect(reader().dataset.url).toBe("https://b.example/post");
  await click('.pub-list-item[aria-current="true"]');
  expect(host.querySelectorAll(".pub-record")).toHaveLength(3);
});

it("clears the previous database article when a category has no results",async()=>{
  await render(true,"website");
  expect(host.querySelector(".website-db-preview")?.textContent).toContain("数据库正文");
  await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>(".pub-filter")).find(x=>x.querySelector('span')?.textContent==='昔日学术')!.click());
  expect(host.querySelector(".website-db-preview")?.textContent).toContain("选择一条官网记录");
  expect(host.querySelector(".website-db-preview .editorial-prose")).toBeNull();
});

it("routes open-source manuscripts by their archive category while keeping their news identity",async()=>{
  const base=invoke.getMockImplementation()!;
  invoke.mockImplementation(async(command,args)=>args.method==='snapshot'?{...structuredClone(data),website:{...structuredClone(data.website),items:data.website.items.map(x=>({...x,category:'学术开源'}))}}:base(command,args));
  await render(true,'website');
  const filter=Array.from(host.querySelectorAll<HTMLButtonElement>('.pub-filter')).find(x=>x.querySelector('span')?.textContent==='学术开源')!;
  expect(filter.querySelector('small')?.textContent).toBe('1');await act(async()=>filter.click());
  expect(host.querySelector('.pub-list')?.textContent).toContain('官网文章');
  expect(invoke).toHaveBeenCalledWith('website_publish_call',{method:'published',params:{id:'one'}});
});

it("reloads the selected database body when refresh finds a newer revision",async()=>{
  let version=1;
  const snapshot=()=>({...structuredClone(data),website:{...structuredClone(data.website),items:data.website.items.map(x=>({...x,revision:version}))}});
  invoke.mockImplementation(async(_,args)=>args.method==='published'?{id:'one',revision:version,title:'官网文章',html:`<p>定稿版本 ${version}</p>`,metadata:{category:'学者观察',date:'2026-10-02'}}:args.method==='refresh_website'?snapshot().website:snapshot());
  await render(true,'website');expect(host.querySelector('.editorial-prose')?.textContent).toContain('定稿版本 1');
  version=2;await click('.pub-refresh button');
  expect(host.querySelector('.editorial-prose')?.textContent).toContain('定稿版本 2');
  expect(invoke.mock.calls.filter(([,args])=>args.method==='published')).toHaveLength(2);
});

it("allows either pane to occupy most of the width and resets from keyboard or double click",async()=>{
  await render();
  key("Home");expect(dividerWidth()).toBe(250);
  key("End");expect(dividerWidth()).toBe(868); // reserves 320 reader + 12 gutter
  key("Enter");expect(dividerWidth()).toBe(463);expect(localStorage.getItem(PUBLICATION_SPLIT_KEY)).toBeNull();
  key("ArrowRight");expect(dividerWidth()).toBe(479);
  await act(()=>divider().dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));
  expect(dividerWidth()).toBe(463);
});

it("remembers the ratio across remounts, without replacing it when the window narrows",async()=>{
  localStorage.setItem("scholay.hotboard.panes.v1","unrelated");
  await render();key("End");
  const saved=localStorage.getItem(PUBLICATION_SPLIT_KEY);
  resizeWindow(600);expect(dividerWidth()).toBe(268);
  expect(localStorage.getItem(PUBLICATION_SPLIT_KEY)).toBe(saved);
  resizeWindow(1200);expect(dividerWidth()).toBe(868);
  await act(()=>root.render(null));await render();expect(dividerWidth()).toBe(868);
  expect(localStorage.getItem("scholay.hotboard.panes.v1")).toBe("unrelated");
});

it("drags in layout pixels, yields the browser, and cancels cleanly on workspace leave",async()=>{
  await render();resizeWindow(1200,1.5);
  await act(()=>divider().dispatchEvent(new MouseEvent("pointerdown",{button:0,clientX:700,bubbles:true})));
  expect(reader().dataset.obscured).toBe("true");expect(reader().dataset.active).toBe("true");
  await act(()=>window.dispatchEvent(new MouseEvent("pointermove",{clientX:850})));
  expect(dividerWidth()).toBe(563); // 150 screen px = 100 layout px
  const saved=localStorage.getItem(PUBLICATION_SPLIT_KEY);
  await render(false);
  expect(reader().dataset.obscured).toBe("false");expect(document.body.style.cursor).toBe("");
  await act(()=>window.dispatchEvent(new MouseEvent("pointermove",{clientX:1000})));
  expect(localStorage.getItem(PUBLICATION_SPLIT_KEY)).toBe(saved);
  await render();expect(dividerWidth()).toBe(563);
});

it("restores native visibility on pointer cancellation and blur without changing the work link",async()=>{
  await render();const url=reader().dataset.url;
  for(const event of ["pointerup","pointercancel","blur"]){
    await act(()=>divider().dispatchEvent(new MouseEvent("pointerdown",{button:0,clientX:460,bubbles:true})));
    expect(reader().dataset.obscured).toBe("true");
    await act(()=>window.dispatchEvent(new Event(event)));
    expect(reader().dataset.obscured).toBe("false");expect(reader().dataset.url).toBe(url);
  }
});

it("ignores broken preferences and can resize when local storage is unavailable",async()=>{
  localStorage.setItem(PUBLICATION_SPLIT_KEY,'{"ratio":"bad"}');await render();expect(dividerWidth()).toBe(463);
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("disabled");});
  key("ArrowLeft");expect(dividerWidth()).toBe(447);
  resizeWindow(430);expect(dividerWidth()).toBeGreaterThan(0);expect(dividerWidth()).toBeLessThan(430);
});

it("keeps the two workspaces' selections, filters, scroll and split preferences independent",async()=>{
  const both=(section:PublicationSection)=>act(async()=>root.render(createElement("div",{},
    ...(["platforms","website"] as const).map(value=>createElement(PublicationCenter,{key:value,section:value,active:value===section,onOpenDraft:vi.fn()})))));
  const pane=(section:PublicationSection)=>host.querySelector<HTMLElement>(`[data-publication-section="${section}"]`)!;
  const sectionKey=(section:PublicationSection,key:string)=>act(()=>pane(section).querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})));
  const sectionWidth=(section:PublicationSection)=>Number(pane(section).querySelector('[role="separator"]')!.getAttribute("aria-valuenow"));
  const setSearch=(section:PublicationSection,value:string)=>act(()=>{
    const input=pane(section).querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await both("platforms");
  expect(host.querySelector('.pub-tabs')).toBeNull();
  await act(()=>pane("platforms").querySelector<HTMLButtonElement>('[aria-label="查看平台乙作品：Article A"]')!.click());
  setSearch("platforms","Article A");
  // Select after filtering: the reader belongs to this filter scope.
  await act(()=>pane("platforms").querySelector<HTMLButtonElement>('[aria-label="查看平台乙作品：Article A"]')!.click());
  pane("platforms").querySelector(".pub-list-scroll")!.scrollTop=180;
  sectionKey("platforms","End");
  const platformPreference=localStorage.getItem(PUBLICATION_SPLIT_KEY);
  await both("website");
  expect(sectionWidth("website")).toBe(356);
  expect(pane("platforms").querySelector<HTMLElement>('[data-reader]')?.dataset.active).toBe("false");
  setSearch("website","官网文章");sectionKey("website","Home");
  expect(localStorage.getItem(PUBLICATION_SPLIT_KEY)).toBe(platformPreference);
  expect(localStorage.getItem(WEBSITE_SPLIT_KEY)).not.toBeNull();
  await both("platforms");
  expect(sectionWidth("platforms")).toBe(868);
  expect(pane("platforms").querySelector("input")!.value).toBe("Article A");
  expect(pane("platforms").querySelector<HTMLElement>('[data-reader]')?.dataset.url).toBe("https://b.example/post");
  expect(pane("platforms").querySelector(".pub-list-scroll")!.scrollTop).toBe(180);
  sectionKey("platforms","Enter");
  await both("website");
  expect(sectionWidth("website")).toBe(250);
  expect(pane("website").querySelector("input")!.value).toBe("官网文章");
  expect(pane("website").querySelector(".website-db-preview")?.textContent).toContain("数据库正文");
  expect(invoke.mock.calls.every(([,args])=>["snapshot","published"].includes(args.method))).toBe(true);
});

it("refreshes only the selected workspace's data source",async()=>{
  invoke.mockImplementation(async(_,args)=>args.method==="published"?{id:"one",revision:1,title:"官网文章",html:"<p>数据库正文</p>",metadata:{author:"编辑",date:"2026-10-02",category:"学界犀闻"},url:"https://today.scholay.com/news/one/"}:args.method==="refresh_website"?structuredClone(data.website):structuredClone(data));
  await render(true,"website");invoke.mockClear();
  await click('.pub-refresh button');
  expect(invoke.mock.calls.map(([,args])=>args.method)).toEqual(["refresh_website","snapshot"]);
  expect(host.querySelector("h1")?.textContent).toBe("官网内容");
  expect(host.textContent).not.toContain("平台甲");
});
