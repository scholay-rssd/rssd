import {describe,it,expect} from 'vitest';
import {readLibrary,templatePrompt,defaultTemplates,bundleSlots} from '../editorial/topicTemplates';
describe('local topic template library',()=>{
 it('seeds presets once and retains custom templates, edits and deletions across reloads',()=>{
  const legacy={id:'user',name:'旧模板',prompt:'保留用户原文'};
  const first=readLibrary(JSON.stringify([legacy]));
  expect(first.migrated).toBe(true);expect(first.library.templates).toHaveLength(13);
  expect(first.library.templates[0]).toEqual(legacy);expect(first.library.templates.filter(t=>t.kind==='section')).toHaveLength(3);expect(first.library.templates.filter(t=>t.kind==='section').every(t=>t.materials?.length===3)).toBe(true);
  first.library.templates=first.library.templates.filter(t=>t.id!=='builtin-section-0');
  first.library.templates[1]={...first.library.templates[1],name:'自改预设',prompt:'我的检索方向',days:14};
  const next=readLibrary(JSON.stringify(first.library));expect(next.migrated).toBe(false);expect(next.library).toEqual(first.library);
  expect(readLibrary(JSON.stringify({version:2,templates:[]})).library.templates).toEqual([]);
 });
 it('reads previously saved libraries without carrying obsolete preference settings into prompts',()=>{
  const t={id:'m',kind:'material' as const,name:'素材',prompt:'研究新证据'};
  const saved=readLibrary(JSON.stringify({version:2,templates:[t],memory:{days:30,notes:'旧偏好'}}));
  expect(saved.library).toEqual({version:2,templates:[t]});expect(saved.migrated).toBe(false);
  expect(templatePrompt(saved.library.templates[0],1,3)).toContain('最近 7 天');
  expect(templatePrompt(t,1,3)).toContain('第 2/3 个素材槽位');expect(templatePrompt(t)).not.toContain('旧偏好');
  expect(templatePrompt({...t,days:14})).toContain('最近 14 天');
 });
 it('turns a saved title-plus-prompt column template into a bundle of the same direction from three angles',()=>{
  const legacy={id:'s',kind:'section' as const,name:'研究前沿',prompt:'研究新证据',count:1,days:14};
  const read=readLibrary(JSON.stringify({version:2,templates:[legacy]}));
  expect(read.bundled).toBe(true);expect(read.migrated).toBe(true);
  const bundle=read.library.templates[0];expect(bundle.count).toBeUndefined();expect(bundle.days).toBe(14);expect(bundle.materials).toHaveLength(3);
  expect(bundle.materials!.map(m=>m.name)).toEqual(['研究前沿 · 重点事件','研究前沿 · 方法与细节','研究前沿 · 补充视角']);
  for(const m of bundle.materials!)expect(m.prompt).toContain('研究新证据');expect(new Set(bundle.materials!.map(m=>m.prompt)).size).toBe(3);
  expect(bundle.prompt).toBe('研究前沿 · 重点事件、研究前沿 · 方法与细节、研究前沿 · 补充视角');
  const again=readLibrary(JSON.stringify(read.library));expect(again.bundled).toBe(false);expect(again.migrated).toBe(false);expect(again.library).toEqual(read.library);
  expect(readLibrary(JSON.stringify({version:2,templates:[{...legacy,count:4}]})).library.templates[0].materials).toHaveLength(4);
 });
 it('rejects column templates with missing, empty or too many materials',()=>{
  const bundle={id:'b',kind:'section',name:'栏',prompt:'摘要',materials:[{name:'甲',prompt:'方向'}]};
  expect(readLibrary(JSON.stringify({version:2,templates:[bundle]})).library.templates[0]).toEqual(bundle);
  for(const materials of [[],[{name:'',prompt:'x'}],[{name:'甲',prompt:' '}],Array.from({length:6},(_,i)=>({name:'m'+i,prompt:'x'})),[{name:'甲',prompt:'x'.repeat(1001)}]])expect(()=>readLibrary(JSON.stringify({version:2,templates:[{...bundle,materials}]}))).toThrow('模板数据格式异常');
 });
 it('a column template creates one AI slot per material, each with its own direction and a not-the-same-event rule',()=>{
  const t={id:'b',kind:'section' as const,name:'基金与政策',prompt:'x',materials:[{name:'资助新规',prompt:'查新公告'},{name:'出版诚信',prompt:'查出版制度'},{name:'会议征稿',prompt:'查会议'}]};
  const slots=bundleSlots(t);expect(slots.map(x=>x.templateName)).toEqual(['资助新规','出版诚信','会议征稿']);
  expect(slots[1].prompt).toContain('查出版制度');expect(slots[1].prompt).not.toContain('查新公告');expect(slots[1].prompt).toContain('第 2/3 个素材槽位');expect(slots[0].prompt).toContain('最近 7 天');
 });
 it('rejects corrupt libraries and oversized directions without dropping user text',()=>{
  expect(()=>readLibrary('{oops')).toThrow();expect(()=>readLibrary(JSON.stringify({version:8,templates:[]}))).toThrow();
  expect(()=>readLibrary(JSON.stringify({version:2,templates:[{id:'bad'}]}))).toThrow();
  expect(()=>templatePrompt({id:'s',kind:'material',name:'x',prompt:'a'.repeat(1000)})).toThrow('合计过长');
 });
 it('persists record enrichment identity up to 200 characters and rejects longer identities',()=>{
  const template={id:'enrichment',name:'增补史料',prompt:'核对既有史料日期',enrichRecordId:'r'.repeat(200)};
  const library={version:2,templates:[template]};expect(readLibrary(JSON.stringify(library)).library).toEqual(library);
  expect(()=>readLibrary(JSON.stringify({version:2,templates:[{...template,enrichRecordId:'r'.repeat(201)}]}))).toThrow('模板数据格式异常');
 });
 it('provides business-specific material and section templates without imposing news recency on history or RSS',()=>{
  for(const mode of ['observation','opensource','calendar','history','rss'] as const){
   const seeded=readLibrary(null,mode);expect(seeded.library.templates).toHaveLength(6);
   expect(seeded.library.templates.filter(t=>t.kind==='section')).toHaveLength(3);
   expect(seeded.library.templates.every(t=>t.mode===mode)).toBe(true);
   seeded.library.templates.shift();expect(readLibrary(JSON.stringify(seeded.library),mode).library).toEqual(seeded.library);
  }
  expect(templatePrompt(defaultTemplates('history')[0])).not.toContain('最近 7 天');
  expect(templatePrompt(defaultTemplates('rss')[0])).toContain('当前可用性');
  expect(templatePrompt(defaultTemplates('calendar')[0])).toContain('最近 30 天');
 });
});

import {defaultTopicBoard} from '../editorial/topicTemplates';
describe('defaultTopicBoard',()=>{
 it.each(['observation','opensource','calendar','history'] as const)('%s opens with one column holding one empty card: the post is about a single material',mode=>{
  const board=defaultTopicBoard(mode)!;
  expect(board.sections).toHaveLength(1);expect(board.targetSections).toBe(1);expect(board.sections[0].title.trim()).not.toBe('');expect(board.sections[0].items).toEqual([]);
  expect(board.sections[0].slots).toHaveLength(1);expect(board.sections[0].slotCount).toBe(1);expect(board.sections[0].slots[0].mode).toBeUndefined();expect(board.sections[0].slots[0].id).toBeTruthy();
 });
 it.each(['xiwen','rss'] as const)('%s opens with nine valid AI slots in at most five columns',mode=>{
  const board=defaultTopicBoard(mode)!;const slots=board.sections.flatMap(s=>s.slots);
  expect(slots).toHaveLength(9);expect(board.sections.length).toBeGreaterThan(0);expect(board.sections.length).toBeLessThanOrEqual(5);expect(board.targetSections).toBe(board.sections.length);
  for(const s of board.sections){expect(s.slots.length).toBeLessThanOrEqual(5);expect(s.slotCount).toBe(s.slots.length);expect(s.items).toEqual([]);expect(s.title.trim()).not.toBe('');}
  for(const slot of slots){expect(slot.mode).toBe('smart');expect(slot.prompt!.trim().length).toBeGreaterThan(20);expect(slot.prompt!.length).toBeLessThanOrEqual(1000);expect(slot.templateName).not.toBe('');}
  expect(new Set(slots.map(s=>s.id)).size).toBe(9);
 });
 it('xiwen takes three different materials per column from the built-in column templates',()=>{
  const board=defaultTopicBoard('xiwen')!;expect(board.sections.map(s=>s.title)).toEqual(['研究前沿','基金与政策','学界动态']);
  expect(board.sections.map(s=>s.slots.map(x=>x.templateName))).toEqual([['科研突破','AI 科研工具','人文与社会'],['资助新规','出版与诚信','会议与征稿'],['高校与学者','学界热议','开源新项目']]);
  for(const s of board.sections){expect(s.slots).toHaveLength(3);expect(new Set(s.slots.map(x=>x.prompt)).size).toBe(3);expect(s.slots[2].prompt).toContain('第 3/3 个素材槽位');}
 });
});

it('new writing skills seed their own templates and retain saved user libraries',()=>{
 for(const mode of ['documentation','design','essay','encyclopedia'] as const){
  const templates=defaultTemplates(mode);expect(templates).toHaveLength(4);expect(templates.every(t=>t.mode===mode)).toBe(true);
  expect(templatePrompt(templates[0])).not.toContain('最近 7 天');
  const saved={version:2,templates:[{...templates[0],name:'人工修改'}]};expect(readLibrary(JSON.stringify(saved),mode).library).toEqual(saved);
 }
});
