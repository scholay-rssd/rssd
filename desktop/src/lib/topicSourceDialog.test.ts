// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({getSetting:vi.fn(),setSetting:vi.fn(),listArticles:vi.fn(),getArticle:vi.fn()}));
vi.mock('../api',()=>api);
import TopicCards from '../editorial/TopicCards';
const delay=()=>new Promise(r=>setTimeout(r,250));
const row={id:42,title:'资助政策更新',feedTitle:'研究机构',url:'https://example.org/source',publishedAt:null,snippet:'来源摘要'};
function input(el:HTMLInputElement|HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}
beforeEach(()=>{api.getSetting.mockReset().mockResolvedValue(JSON.stringify({version:2,templates:[],memory:{days:7,notes:''}}));api.setSetting.mockReset().mockResolvedValue(undefined);api.listArticles.mockReset().mockResolvedValue([row]);api.getArticle.mockReset().mockRejectedValue(new Error('offline'));});
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
async function setup(){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let board:any={titles:[],sections:[]};let busy=false;const render=()=>root.render(createElement(TopicCards,{busy,loading:false,sectionCount:1,onOpenUrl:vi.fn(),onChange:(next:any)=>{board=next;render();},board}));await act(async()=>render());await act(delay);return {host,root,get board(){return board;},render,setBusy:async()=>{busy=true;await act(render);}};}
const click=async(text:string)=>act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
const press=async(selector:string)=>act(async()=>document.querySelector<HTMLButtonElement>(selector)!.click());
async function drag(source:Element,target:Element){const e=new Event('dragstart',{bubbles:true});Object.defineProperty(e,'dataTransfer',{value:{effectAllowed:'',setData:vi.fn()}});await act(async()=>source.dispatchEvent(e));await act(async()=>target.dispatchEvent(new Event('drop',{bubbles:true,cancelable:true})));await act(async()=>source.dispatchEvent(new Event('dragend',{bubbles:true})));}
it('drags a starred article onto a column to add a card, and later drops insert new cards instead of overwriting',async()=>{
 const h=await setup();expect(api.listArticles).toHaveBeenCalledWith({kind:'starred'},false,null,false,30,0);
 await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-placeholder')!);
 expect(h.board.sections[0].items[0]).toMatchObject({rssId:'42',acquiredVia:'rss',selected:true,locked:true,date:'',dateBasis:'RSS 未提供发布日期'});expect(h.board.sections[0].slots[0].mode).toBe('manual');expect(document.querySelector<HTMLButtonElement>('.topic-source-select')!.disabled).toBe(true);
 await click('AI 模板');await press('[aria-label="新建 AI 模板"]');await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'科研');input(document.querySelector('textarea')!,'研究');});await click('保存模板');
 const manual=h.board.sections[0].slots[0];await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-card')!);
 expect(h.board.sections[0].slots).toHaveLength(2);expect(h.board.sections[0].slots[0].mode).toBe('smart');expect(h.board.sections[0].slots[1]).toEqual(manual);expect(h.board.sections[0].items).toHaveLength(1);await act(async()=>h.root.unmount());
});
it('creates reusable templates, multi-selects presets, fills by click, preserves prompt snapshot and enforces capacity',async()=>{
 const h=await setup();await click('AI 模板');await press('[aria-label="新建 AI 模板"]');await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'科研动态');input(document.querySelector('textarea')!,'关注高校');});await click('核实日期');await click('本地 RSS 优先');await click('核实日期');
 expect(document.querySelector('textarea')!.value).toContain('关注高校');expect(document.querySelector('textarea')!.value).not.toContain('核对原始发布日期与事件日期');await click('保存模板');expect(api.setSetting).toHaveBeenCalled();expect(document.querySelector('[role=dialog]')).toBeNull();await press('.topic-card-items');
 const saved=JSON.parse(api.setSetting.mock.calls[0][1]);expect(h.board.sections[0].slots[0]).toMatchObject({mode:'smart',prompt:expect.stringContaining(saved.templates[0].prompt)});
 for(let i=0;i<4;i++)await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-card-items')!);
 expect(h.board.sections[0].slots).toHaveLength(5);await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-card-items')!);expect(h.board.sections[0].slots).toHaveLength(5);
 await press('[aria-label="删除模板：科研动态"]');expect(h.board.sections[0].slots[0].prompt).toEqual(expect.stringContaining(saved.templates[0].prompt));await act(async()=>h.root.unmount());
 api.getSetting.mockResolvedValue(JSON.stringify(saved));const again=await setup();await click('AI 模板');expect(document.querySelector('.topic-shelf-card')!.textContent).toContain('科研动态');await act(async()=>again.root.unmount());
});
it('retains template draft on save failure and blocks board writes while busy',async()=>{
 api.setSetting.mockRejectedValue(Error('disk'));const h=await setup();await click('AI 模板');await press('[aria-label="新建 AI 模板"]');await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'保留草稿');input(document.querySelector('textarea')!,'检索方向');});await click('保存模板');expect(document.querySelector('textarea')!.value).toBe('检索方向');expect(document.querySelector('[role=dialog]')!.textContent).toContain('保存失败');await click('取消');await click('星标');await act(delay);await press('.topic-source-select');await h.setBusy();await press('.topic-card-items');expect(h.board.sections).toHaveLength(0);await act(async()=>h.root.unmount());
});
it('ignores stale starred search results and searches only favorites',async()=>{
 const h=await setup();let resolveOld!:(v:any)=>void;api.listArticles.mockImplementationOnce(()=>new Promise(r=>{resolveOld=r;})).mockResolvedValue([{...row,id:2,title:'新结果'}]);
 await act(async()=>input(document.querySelector('[aria-label="搜索星标文章"]')!,'旧'));await act(delay);await act(async()=>input(document.querySelector('[aria-label="搜索星标文章"]')!,'新'));await act(delay);await act(async()=>resolveOld([{...row,id:1,title:'旧结果'}]));expect(document.querySelector('.topic-shelf-results')!.textContent).toContain('新结果');expect(document.querySelector('.topic-shelf-results')!.textContent).not.toContain('旧结果');expect(api.listArticles).toHaveBeenLastCalledWith({kind:'starred'},false,'新',false,30,0);await act(async()=>h.root.unmount());
});
it('edits, searches and removes persisted templates, and keeps old slot snapshots',async()=>{
 const template={id:'t',kind:'material',name:'原模板',prompt:'原方向'};api.getSetting.mockResolvedValue(JSON.stringify({version:2,templates:[template],memory:{days:7,notes:''}}));const h=await setup();await click('AI 模板');await press('.topic-source-select');await press('.topic-card-items');const original=h.board.sections[0].slots[0].prompt;
 await press('[aria-label="编辑模板：原模板"]');await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'新模板');input(document.querySelector('textarea')!,'新方向');});await click('保存模板');expect(JSON.parse(api.setSetting.mock.calls.at(-1)![1]).templates[0]).toMatchObject({id:'t',name:'新模板',prompt:'新方向'});expect(h.board.sections[0].slots[0].prompt).toBe(original);
 await act(async()=>input(document.querySelector('[aria-label="搜索 AI 模板"]')!,'不存在'));expect(document.querySelectorAll('.topic-shelf-card')).toHaveLength(0);await act(async()=>input(document.querySelector('[aria-label="搜索 AI 模板"]')!,'新模板'));expect(document.querySelectorAll('.topic-shelf-card')).toHaveLength(1);await press('[aria-label="删除模板：新模板"]');expect(JSON.parse(api.setSetting.mock.calls.at(-1)![1]).templates).toEqual([]);expect(h.board.sections[0].slots[0].prompt).toBe(original);await act(async()=>h.root.unmount());
});
it('applies section templates only to blank sections and enforces section capacity',async()=>{
 api.getSetting.mockResolvedValue(JSON.stringify({version:2,templates:[{id:'s',name:'研究前沿',kind:'section',prompt:'原创研究',count:3}],memory:{days:7,notes:''}}));const h=await setup();await click('AI 模板');await press('[data-kind="section"]');expect(document.body.textContent).not.toContain('用户记忆');
 await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-section>header')!);expect(h.board.sections).toHaveLength(1);expect(h.board.sections[0].title).toBe('研究前沿');expect(h.board.sections[0].slots).toHaveLength(3);expect(h.board.sections[0].slots[0].prompt).toContain('最近 7 天');expect(h.board.sections[0].slots[1].prompt).toContain('第 2/3');
 const original=JSON.stringify(h.board);await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-section>header')!);expect(JSON.stringify(h.board)).toBe(original);
 for(let i=0;i<5;i++)await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-add-section')!);expect(h.board.sections).toHaveLength(5);
 expect(h.board.sections[0].slots[0].prompt).toContain('最近 7 天');await act(async()=>h.root.unmount());
});

it('restores edits and deletions from local storage after remounting',async()=>{
 let stored=JSON.stringify({version:2,templates:[{id:'keep',name:'自建模板',prompt:'原方向',kind:'material'},{id:'drop',name:'待删除模板',prompt:'方向',kind:'section',count:2}]});
 api.getSetting.mockImplementation(async()=>stored);api.setSetting.mockImplementation(async(_key:string,value:string)=>{stored=value;});
 const h=await setup();await click('AI 模板');await press('[aria-label="编辑模板：自建模板"]');
 await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'修改后的模板');input(document.querySelector('textarea')!,'保留本地修改');});await click('保存模板');
 await press('[data-kind="section"]');await press('[aria-label="删除模板：待删除模板"]');await act(async()=>h.root.unmount());
 const again=await setup();await click('AI 模板');expect(document.querySelectorAll('.topic-shelf-card')).toHaveLength(1);
 expect(document.querySelector('.topic-shelf-card')!.textContent).toContain('修改后的模板');
 await press('[aria-label="编辑模板：修改后的模板"]');expect(document.querySelector('textarea')!.value).toBe('保留本地修改');
 expect(document.body.textContent).not.toContain('用户记忆');await act(async()=>again.root.unmount());
});
it('shows only the active collection card as working while the rest queue, and clears animation on stop',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);const board:any={titles:[],sections:[{id:'s',title:'研究',slots:[{id:'a',mode:'smart',prompt:'方向一'},{id:'b',mode:'smart',prompt:'方向二'}],items:[]}]};const onCollect=vi.fn(),onCollectSlot=vi.fn();const props={board,busy:false,loading:false,sectionCount:1,onChange:vi.fn(),onOpenUrl:vi.fn(),onCollect,onCollectSlot};
 await act(async()=>root.render(createElement(TopicCards,props)));
 const all=host.querySelector<HTMLButtonElement>('.topic-ai-bar button')!;await act(async()=>all.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));expect(host.querySelector('.is-collect-hover')).not.toBeNull();await act(async()=>all.click());expect(onCollect).toHaveBeenCalledTimes(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('.topic-collect')!.click());expect(onCollectSlot).toHaveBeenCalledWith('a');expect(onCollect).toHaveBeenCalledTimes(1);
 await act(async()=>root.render(createElement(TopicCards,{...props,busy:true,loading:true,collection:{a:{status:'searching'},b:{status:'queued'}}})));
 expect(host.querySelectorAll('.is-processing')).toHaveLength(1);expect(host.textContent).toContain('排队中');
 await act(async()=>root.render(createElement(TopicCards,{...props,collection:{a:{status:'searching'},b:{status:'queued'}}})));
 expect(host.querySelectorAll('.is-processing')).toHaveLength(0);await act(async()=>root.unmount());vi.unstubAllGlobals();
});
it('plus card hands off to the RSS reader and selects the article starred there',async()=>{
 const h=await setup();const starts:any[]=[];window.addEventListener('scholay-topic-pick-start',e=>starts.push((e as CustomEvent).detail),{once:true});
 await press('.topic-shelf-add');expect(starts).toHaveLength(1);expect(document.querySelector('.topic-shelf-results')!.firstElementChild!.className).toBe('topic-shelf-add');
 const fresh={...row,id:77,title:'刚加星标的文章',url:'https://example.org/new'};api.listArticles.mockResolvedValue([fresh,row]);
 await act(async()=>{window.dispatchEvent(new CustomEvent('scholay-topic-pick-done',{detail:{token:'other',id:77}}));});await act(delay);
 expect(document.body.textContent).not.toContain('刚加星标的文章');
 await act(async()=>{window.dispatchEvent(new CustomEvent('scholay-topic-pick-done',{detail:{token:starts[0].token,id:77}}));});await act(delay);
 expect(document.body.textContent).toContain('刚加星标的文章');expect(document.querySelector('.topic-shelf-card.is-selected')!.textContent).toContain('刚加星标的文章');await act(async()=>h.root.unmount());
});

it('falls back to the fetch date, labelled as such, and places the full article text with author',async()=>{
 const dateless={...row,id:91,title:'无发布日期',url:'https://example.org/dateless',fetchedAt:'2026-10-05 08:30:00',author:null};
 api.listArticles.mockResolvedValue([dateless]);api.getArticle.mockResolvedValue({id:91,author:'张三',publishedAt:null,extractedHtml:'<p>第一段正文。</p><script>x</script><p>第二段正文。</p>',contentHtml:null});
 const h=await setup();expect(document.querySelector('.topic-shelf-card small')!.textContent).toContain('2026-10-05 抓取');
 await press('.topic-source-select');await act(delay);
 await drag(document.querySelector('.topic-shelf-card')!,document.querySelector('.topic-placeholder')!);
 expect(h.board.sections[0].items[0]).toMatchObject({date:'2026-10-05',dateBasis:expect.stringContaining('订阅抓取日期'),summary:'作者：张三\n第一段正文。 第二段正文。'});await act(async()=>h.root.unmount());
});

it('template types are a mutually exclusive switch with distinct card styles, and new templates default to the active type',async()=>{
 api.getSetting.mockResolvedValue(JSON.stringify({version:2,templates:[{id:'m',name:'素材甲',prompt:'方向',kind:'material'},{id:'old',name:'旧版无类型',prompt:'方向'},{id:'s',name:'分栏乙',prompt:'方向',kind:'section',count:2}],memory:{days:7,notes:''}}));
 const h=await setup();await click('AI 模板');const on=()=>[...document.querySelectorAll('.topic-template-switch [aria-pressed=true]')].map(b=>(b as HTMLElement).dataset.kind);
 expect(document.querySelector('select[aria-label="筛选模板类型"]')).toBeNull();expect(on()).toEqual(['material']);
 expect([...document.querySelectorAll('.topic-shelf-card')].map(c=>c.className.includes('is-material'))).toEqual([true,true]);
 expect(document.querySelector('.topic-template-switch [data-kind=material] small')!.textContent).toBe('2');
 await press('[data-kind="section"]');expect(on()).toEqual(['section']);expect(document.querySelectorAll('.topic-shelf-card')).toHaveLength(1);
 expect(document.querySelector('.topic-shelf-card')!.className).toContain('is-section');expect(document.querySelector('.topic-type-tag')).toBeNull();expect(document.querySelector('.topic-shelf-card.is-section .tpl-materials')).not.toBeNull();expect(document.querySelector('.topic-shelf-card.is-section .tpl-direction')).toBeNull();
 await press('[aria-label="新建 AI 模板"]');expect(document.querySelector<HTMLSelectElement>('select[aria-label="模板类型"]')!.value).toBe('section');await act(async()=>h.root.unmount());
});

it('empty slots are ghost cards with a one-click AI action that becomes a smart slot and surfaces the collect bar',async()=>{
 const h=await setup();expect(document.querySelector('.topic-placeholder .topic-ghost')).not.toBeNull();expect(document.querySelector('.topic-ai-bar')).toBeNull();
 await press('.topic-slot-ai');const slot=h.board.sections[0].slots[0];
 expect(slot).toMatchObject({mode:'smart',templateName:'分栏 1'});expect(slot.prompt).toContain('分栏 1');expect(slot.prompt.length).toBeLessThanOrEqual(1000);
 expect(document.querySelector('.topic-slot-ai')).toBeNull();expect(document.querySelector('.topic-ai-bar')!.textContent).toContain('1 个 AI 槽位待检索');expect(document.querySelector('.topic-collect')).not.toBeNull();
 await act(async()=>h.root.unmount());
});

it('while a run is active, idle AI cards can be queued, queued cards wait, and the batch button is locked',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const board:any={titles:[],sections:[{id:'s',title:'研究',slots:[{id:'a',mode:'smart',prompt:'方向一'},{id:'b',mode:'smart',prompt:'方向二'},{id:'c',mode:'smart',prompt:'方向三'}],items:[]}]};
 const onCollectSlot=vi.fn(),props={board,busy:true,canQueue:true,loading:true,collection:{a:{status:'searching'}},sectionCount:1,onChange:vi.fn(),onOpenUrl:vi.fn(),onCollect:vi.fn(),onCollectSlot,queuedSlots:['b']};
 await act(async()=>root.render(createElement(TopicCards,props)));
 const cards=[...host.querySelectorAll<HTMLButtonElement>('.topic-collect')];expect(cards.map(c=>c.disabled)).toEqual([true,true,false]);
 expect(cards[0].textContent).toContain('采集中');expect(cards[1].textContent).toContain('排队中');expect(cards[2].textContent).toContain('点击加入队列');
 await act(async()=>cards[2].click());expect(onCollectSlot).toHaveBeenCalledWith('c');expect(host.querySelector<HTMLButtonElement>('.topic-ai-bar button')!.disabled).toBe(true);
 await act(async()=>root.unmount());
});

const choose=async(el:HTMLSelectElement,value:string)=>act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});
it('creates a column template from a title and its own materials, shows them on the card, and dropping it builds that column',async()=>{
 const h=await setup();await click('AI 模板');await press('[data-kind="section"]');await press('[aria-label="新建 AI 模板"]');
 expect(document.querySelector<HTMLSelectElement>('select[aria-label="模板类型"]')!.value).toBe('section');expect(document.body.textContent).toContain('分栏标题');expect(document.body.textContent).not.toContain('分栏素材数量');
 expect(document.querySelectorAll('[aria-label^="素材名称"]')).toHaveLength(3);expect(document.querySelector<HTMLButtonElement>('.s-btn.primary')!.disabled).toBe(true);
 await act(async()=>{input(document.querySelector('.topic-search-direction input')!,'基金与政策');for(const [i,[n,p]] of [['资助新规','查找新发布的基金公告'],['出版与诚信','查找出版制度变化'],['会议与征稿','查找新会议与征稿']].entries()){input(document.querySelector('[aria-label="素材名称 '+(i+1)+'"]')!,n);input(document.querySelector('[aria-label="素材检索方向 '+(i+1)+'"]')!,p);}});
 await click('保存模板');const saved=JSON.parse(api.setSetting.mock.calls.at(-1)![1]).templates.find((t:any)=>t.name==='基金与政策');
 expect(saved).toMatchObject({kind:'section',materials:[{name:'资助新规',prompt:'查找新发布的基金公告'},{name:'出版与诚信',prompt:'查找出版制度变化'},{name:'会议与征稿',prompt:'查找新会议与征稿'}]});expect(saved.count).toBeUndefined();expect(saved.prompt).toBe('资助新规、出版与诚信、会议与征稿');
 const card=document.querySelector('.topic-shelf-card.is-section')!;expect(card.textContent).toContain('基金与政策');expect([...card.querySelectorAll('.tpl-materials li span')].map(x=>x.textContent)).toEqual(['资助新规','出版与诚信','会议与征稿']);expect(card.querySelector('.tpl-materials li')!.getAttribute('title')).toBe('查找新发布的基金公告');expect(card.querySelector('.tpl-meta')!.textContent).toContain('3 张');
 await drag(card,document.querySelector('.topic-section>header')!);
 const column=h.board.sections[0];expect(column.title).toBe('基金与政策');expect(column.slots.map((s:any)=>s.templateName)).toEqual(['资助新规','出版与诚信','会议与征稿']);
 expect(column.slots[1].prompt).toContain('查找出版制度变化');expect(column.slots[1].prompt).not.toContain('查找新发布的基金公告');expect(column.slots[2].prompt).toContain('第 3/3 个素材槽位');await act(async()=>h.root.unmount());
});
it('the column editor allows one to five materials, needs every material filled, and can copy from a material template',async()=>{
 api.getSetting.mockResolvedValue(JSON.stringify({version:2,templates:[{id:'m1',kind:'material',name:'科研突破',prompt:'查找原创研究'}],memory:{days:7,notes:''}}));
 const h=await setup();await click('AI 模板');await press('[data-kind="section"]');await press('[aria-label="新建 AI 模板"]');
 const names=()=>[...document.querySelectorAll<HTMLInputElement>('[aria-label^="素材名称"]')].map(x=>x.value),add=()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='＋ 添加素材')!;
 await choose(document.querySelector<HTMLSelectElement>('select[aria-label="从素材模板选取"]')!,'m1');expect(names()).toEqual(['科研突破','','']);expect(document.querySelector<HTMLTextAreaElement>('[aria-label="素材检索方向 1"]')!.value).toBe('查找原创研究');
 await act(async()=>add().click());await act(async()=>add().click());expect(names()).toHaveLength(5);expect(add().disabled).toBe(true);
 await press('[aria-label="删除素材 5"]');await press('[aria-label="删除素材 4"]');await press('[aria-label="删除素材 3"]');await press('[aria-label="删除素材 2"]');expect(names()).toEqual(['科研突破']);expect(document.querySelector<HTMLButtonElement>('[aria-label="删除素材 1"]')!.disabled).toBe(true);
 await act(async()=>input(document.querySelector('.topic-search-direction input')!,'只有一张'));expect(document.querySelector<HTMLButtonElement>('.s-btn.primary')!.disabled).toBe(false);
 await act(async()=>add().click());expect(document.querySelector<HTMLButtonElement>('.s-btn.primary')!.disabled).toBe(true);await act(async()=>h.root.unmount());
});
it('backs up the old library once before turning saved column templates into bundles',async()=>{
 const raw=JSON.stringify({version:2,templates:[{id:'s',name:'研究前沿',kind:'section',prompt:'原创研究',count:3}],memory:{days:7,notes:''}});api.getSetting.mockResolvedValue(raw);
 const h=await setup();await act(delay);const writes=api.setSetting.mock.calls;
 expect(writes[0]).toEqual(['editorial.topic-templates.v1.pre-bundles',raw]);expect(writes[1][0]).toBe('editorial.topic-templates.v1');
 const migrated=JSON.parse(writes[1][1]).templates[0];expect(migrated.materials).toHaveLength(3);expect(migrated.count).toBeUndefined();
 await act(async()=>h.root.unmount());api.setSetting.mockClear();api.getSetting.mockResolvedValue(writes.length?JSON.stringify({version:2,templates:[migrated]}):raw);
 const again=await setup();await act(delay);expect(api.setSetting).not.toHaveBeenCalled();await act(async()=>again.root.unmount());
});
it('material cards show one direction and its range; column cards show their materials in order; each has its own actions',async()=>{
 const long='查找'.repeat(80);api.getSetting.mockResolvedValue(JSON.stringify({version:2,templates:[
  {id:'m',kind:'material',name:'科研突破',prompt:long,days:14},{id:'h',kind:'material',name:'史料',prompt:'核对原始史料',mode:'history'},
  {id:'c',kind:'section',name:'基金与政策',prompt:'x',materials:[{name:'资助新规',prompt:'查公告'},{name:'出版诚信',prompt:'查制度'}]}],memory:{days:7,notes:''}}));
 const h=await setup();await click('AI 模板');
 const materials=[...document.querySelectorAll<HTMLElement>('.topic-shelf-card.is-material')];expect(materials).toHaveLength(2);
 expect(materials[0].querySelector('.tpl-head strong')!.textContent).toBe('科研突破');expect(materials[0].querySelector('.tpl-meta')!.textContent).toBe('近 14 天');expect(materials[1].querySelector('.tpl-meta')!.textContent).toBe('历史史料');
 expect(materials[0].querySelector('.tpl-direction')!.getAttribute('title')).toBe(long);expect(materials[0].querySelector('.tpl-materials')).toBeNull();expect(materials[0].querySelector('[aria-label="编辑模板：科研突破"]')).not.toBeNull();
 await press('[data-kind="section"]');const column=document.querySelector<HTMLElement>('.topic-shelf-card.is-section')!;
 expect(column.querySelector('.tpl-meta')!.textContent).toBe('2 张 · 近 7 天');expect([...column.querySelectorAll('.tpl-materials li')].map(li=>li.textContent)).toEqual(['1资助新规','2出版诚信']);expect(column.querySelector('.tpl-direction')).toBeNull();
 expect(column.querySelector('[aria-label="删除模板：基金与政策"]')).not.toBeNull();
 await act(async()=>column.querySelector<HTMLButtonElement>('.topic-source-select')!.click());expect(column.className).toContain('is-selected');expect(column.querySelector('.topic-source-select')!.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>h.root.unmount());
});
