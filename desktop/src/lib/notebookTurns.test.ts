import {describe,it,expect} from 'vitest';
import profiles from '../../../sites/profiles.json';
import {SITE_SECTIONS,sectionsForSite} from '../../../contracts/site-sections.mjs';
import {setActiveSite} from '../../../scripts/site-profile.mjs';
import {emptyTurn,sectionTurnDefaults,mergeTurnDefaults} from '../editorial/notebookTurns';
import {addTaskTab,removeTaskTab,tabFor} from '../editorial/taskWorkbench';
describe('conversation mounts and extension tabs',()=>{
 it.each(profiles)('$id supplies first-turn defaults for all of its sections, then removes article/title presets',site=>{
  setActiveSite(site);
  for(const section of sectionsForSite(site)){
   const first=sectionTurnDefaults(site.id,section.id,[],[],true),next=sectionTurnDefaults(site.id,section.id,[],[],false);
   expect(first.template?.mode).toBe(section.defaultMode);
   expect(first.template?.materials?.length).toBeGreaterThan(0);expect(first.titleTemplate?.requirement).toBeTruthy();
   expect(next.template).toBeUndefined();expect(next.titleTemplate).toBeUndefined();
  }
  setActiveSite(profiles[0]);
 });
 it('changes section defaults while preserving explicit custom mounts and material',()=>{
  const manual={id:'mine',mode:'essay' as const,name:'我的模板',prompt:'自定义'},source={id:'rss',title:'资料',summary:'',url:'https://example.org',acquiredVia:'rss' as const,reviewed:false};
  const result=mergeTurnDefaults({...emptyTurn(),template:manual,sources:[source]},sectionTurnDefaults('pets','daily-cat',[],[],true));
  expect(result.template).toEqual(manual);expect(result.sources).toEqual([source]);
 });
 it('keeps defaults tied to stable IDs when sections are inserted or reordered',()=>{
  const before=SITE_SECTIONS['scholay-today'];
  const saved=sectionTurnDefaults('scholay-today','history',[],[],true);
  try{
   SITE_SECTIONS['scholay-today']=[{id:'new-section',name:'新增板块',defaultMode:'essay'},...[...before].reverse()];
   expect(sectionTurnDefaults('scholay-today','history',[],[],true).template?.mode).toBe('history');
   expect(sectionTurnDefaults('scholay-today','calendar',[],[],true).template?.mode).toBe('calendar');
   expect(sectionTurnDefaults('scholay-today','new-section',[],[],true).template?.mode).toBe('essay');
   expect(saved.template?.mode).toBe('history');
  }finally{SITE_SECTIONS['scholay-today']=before;}
 });
 it('does not silently pick a template for an unset or unknown section',()=>{
  expect(sectionTurnDefaults('pets','',[],[],true).template).toBeUndefined();
  expect(()=>sectionTurnDefaults('pets','history',[],[],true)).toThrow(/同步栏目配置/);
 });
 it('the first notebook tab cannot be removed, and repeated links reuse a tab',()=>{
  const initial={tabs:[{id:'notebook',kind:'notebook' as const,title:'子弹笔记'}],activeTab:'notebook'};
  expect(removeTaskTab(initial,'notebook')).toEqual(initial);
  const link=tabFor('web','https://example.org','原文','https://example.org');let ui=addTaskTab(initial,link);ui=addTaskTab(ui,link);
  expect(ui.tabs).toHaveLength(2);expect(ui.expansionOpen).toBe(true);ui=removeTaskTab(ui,link.id);expect(ui.activeTab).toBe('notebook');
 });
});
