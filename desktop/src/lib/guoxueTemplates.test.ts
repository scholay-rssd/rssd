// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import profiles from '../../../sites/profiles.json';
import {ACTIVE_SITE,setActiveSite} from '../../../scripts/site-profile.mjs';
import {CURRENT_DOMAIN} from '../../scripts/agent/domain-pack.mjs';
import {WRITING_SKILLS,notebookInstructions,type Notebook} from '../../scripts/agent/notebook.mjs';
import {defaultTemplates,defaultTopicBoard,templatePrompt,readLibrary,type TemplateMode} from '../editorial/topicTemplates';
import {placeNotebookResource} from '../editorial/notebookResources';
import TopicTemplateDialog from '../editorial/TopicTemplateDialog';
import {rangeLabel} from '../editorial/TemplateCards';

const originalSite=ACTIVE_SITE,guoxue=profiles.find(site=>site.id==='xsiching')!;
const modes=['xiwen','observation','opensource','calendar','history','documentation','design','essay','encyclopedia','rss'] as const;
const note=():Notebook=>({version:2,title:'论语读书札记',kind:'article',skills:['observation'],fields:{},sources:[],groups:[],blocks:[{id:'author',type:'paragraph',text:'作者原文',state:'ready',sourceIds:[],locked:true}],mounts:{templates:[],brands:[],skills:[]}});
beforeEach(()=>{setActiveSite(guoxue);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterEach(()=>{setActiveSite(originalSite);document.body.innerHTML='';vi.unstubAllGlobals();});
describe('国学空间模板',()=>{
 it('provides classical source directions for every mounted template library',()=>{
  expect(CURRENT_DOMAIN.id).toBe('xsiching');
  const text=modes.flatMap(mode=>defaultTemplates(mode)).map(t=>t.name+' '+t.prompt+' '+JSON.stringify(t.materials||[])).join('\n');
  for(const word of ['四书','五经','儒家','易经','礼俗','注疏'])expect(text).toContain(word);
  expect(text).not.toMatch(/科研突破|科研资助|AI 科研|科研软件|实验技术|习性与照护|个体诊断|代码示例/);
  for(const mode of modes)for(const t of defaultTemplates(mode)){
   expect(templatePrompt(t).length).toBeLessThanOrEqual(1000);
   expect(templatePrompt(t)).not.toMatch(/最近 7 天|不同的事件|优先本地 RSS/);
   expect(rangeLabel(t)).not.toContain('近 7 天');
  }
  expect(defaultTopicBoard('xiwen')?.sections.map(s=>s.title)).toEqual(['四书五经','儒家思想','易经与传统文化']);
 });
 it('mounts a classical template without altering existing author text or snapshots',()=>{
  const original=note(),before=JSON.stringify(original),template=defaultTemplates('observation')[0];
  const next=placeNotebookResource(original,{kind:'template',template});
  expect(JSON.stringify(original)).toBe(before);expect(next.blocks[0]).toEqual(original.blocks[0]);
  expect(next.blocks.slice(1).some(block=>block.requirement?.includes('四书五经'))).toBe(true);
  expect(next.mounts?.templates[0].version).toBe(JSON.stringify(template));
  const library={version:2,templates:[{id:'custom',name:'自定注疏',prompt:'保留我的原文'}]};
  expect(readLibrary(JSON.stringify(library),'observation').library).toEqual(library);
  const instructions=notebookInstructions({notebook:next,runtime:{notebookAction:{action:'fill',targetIds:next.blocks.slice(1).map(b=>b.id)}}});
  expect(instructions).toContain('不得把现代自然科学');expect(instructions).toContain('不受最近七天限制');
 });
 it.each(modes)('refreshes only unchanged saved %s defaults and leaves custom entries and later deletions alone',mode=>{
  // A generic space with the same domain reproduces the previously shipped
  // xsiching presets without changing production data or old notebook mounts.
  setActiveSite({...guoxue,id:'qa-generic',spaceId:'qa-generic'});
  const old=defaultTemplates(mode),edited={...old[0],name:'作者修改',prompt:'作者自己的检索要求'},custom={id:'custom',name:'自定义',prompt:'保留原文'};
  const raw=JSON.stringify({version:2,templates:[edited,...old.slice(1),custom]});
  setActiveSite(guoxue);
  const result=readLibrary(raw,mode);expect(result.domainUpdated).toBe(true);expect(result.migrated).toBe(true);
  expect(result.library.templates).toContainEqual(edited);expect(result.library.templates).toContainEqual(custom);
  expect(result.library.templates.filter(t=>t.id.startsWith('guoxue-v1-'))).toEqual(defaultTemplates(mode));
  const shortened={...result.library,templates:result.library.templates.filter(t=>t.id!==defaultTemplates(mode)[0].id)};
  expect(readLibrary(JSON.stringify(shortened),mode)).toMatchObject({library:shortened,migrated:false,domainUpdated:false});
  expect(readLibrary(JSON.stringify({version:2,templates:[]}),mode).library.templates).toEqual([]);
 });
 it('recognizes an unedited academic preset cached by an older client',()=>{
  setActiveSite(originalSite);const old=defaultTemplates('xiwen');setActiveSite(guoxue);
  const result=readLibrary(JSON.stringify({version:2,templates:old}));
  expect(result.domainUpdated).toBe(true);expect(result.library.templates).toEqual(defaultTemplates('xiwen'));
 });
 it('changes the template editor presets, examples and time controls with the active space',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const render=async(mode:TemplateMode='xiwen')=>{await act(async()=>{root.render(createElement(TopicTemplateDialog,{mode,onConfirm:vi.fn(),onClose:vi.fn(),saving:false,errorMessage:''}));});};
  try{
   await render();
   expect(document.body.textContent).toContain('四书五经');expect(document.body.textContent).toContain('儒家思想');expect(document.body.textContent).toContain('易经经典');
   expect(document.querySelector('[aria-label="时间范围"]')).toBeNull();
   expect(document.body.innerHTML).not.toMatch(/科研新进展|资助政策|论文原文|科研突破/);
   expect(WRITING_SKILLS.documentation.name).toBe('经典导读');expect(WRITING_SKILLS.encyclopedia.hint).not.toContain('萌宠');
   setActiveSite(originalSite);await render();
   expect(document.body.textContent).toContain('科研新进展');expect(WRITING_SKILLS.documentation.name).toBe('技术文档');
   expect(defaultTopicBoard('xiwen')?.sections[0].title).toBe('研究前沿');
  }finally{await act(async()=>root.unmount());}
 });
});
