import {afterEach,expect,it} from 'vitest';
import {ACTIVE_SITE,setActiveSite} from '../../../scripts/site-profile.mjs';
import profiles from '../../../sites/profiles.json';
import {readNotebookTemplateLibrary,notebookTemplateModes,templateForArticle,isStarter} from '../editorial/notebookTemplates';
import {defaultTemplates} from '../editorial/topicTemplates';
import {selectTemplate,releaseTemplate} from '../../scripts/agent/notebook-templates.mjs';
const original=ACTIVE_SITE;
afterEach(()=>setActiveSite(original));
it.each(profiles)('$name has all nine start choices with domain-specific directions and reversible selection',site=>{
 setActiveSite(site);let serial=0;
 for(const mode of notebookTemplateModes){
  const result=readNotebookTemplateLibrary(null,mode),t=result.library.templates.find(isStarter)!;
  expect(t,site.id+' '+mode).toBeTruthy();expect(result.library.notebookVersion).toBe(1);
  const parsed=readNotebookTemplateLibrary(JSON.stringify(result.library),mode);expect(parsed.migrated).toBe(false);
  const prepared=templateForArticle(t,mode);expect(prepared.materials!.length).toBeGreaterThan(0);
  if(['observation','opensource','calendar','history'].includes(mode))expect(prepared.materials).toHaveLength(3);
  if(mode!=='xiwen')expect(JSON.stringify(prepared.materials)).not.toContain('寻找与其他槽位及已有素材不同的事件');
  const n:any={version:2,title:'',kind:'article',skills:[],fields:{},blocks:[],sources:[],groups:[],mounts:{templates:[],brands:[]}};
  const selected=selectTemplate(n,prepared,{spaceId:site.spaceId,makeId:()=>String(++serial)}).note;
  expect(selected.templateSelection?.spaceId).toBe(site.spaceId);expect(releaseTemplate(selected).note.blocks).toEqual([]);
  if(site.spaceId==='xsiching'&&mode!=='calendar')expect(prepared.materials!.every(m=>!m.prompt.includes('最近 7 天'))).toBe(true);
 }
});
it('preserves custom entries, modified built-ins and deliberate deletions across repeated loads',()=>{
 const custom={id:'mine',name:'我的结构',kind:'section',prompt:'自定义',materials:[{name:'A',prompt:'只写我的方向'}],enrichRecordId:'original-record'};
 const raw=JSON.stringify({version:2,templates:[custom]});
 const first=readNotebookTemplateLibrary(raw,'essay');expect(first.library.templates).toEqual([custom]);
 const loaded=readNotebookTemplateLibrary(JSON.stringify(first.library),'essay');expect(loaded.library.templates).toEqual([custom]);expect(loaded.migrated).toBe(false);
 const result=readNotebookTemplateLibrary(null,'calendar');result.library.templates=result.library.templates.filter(t=>!isStarter(t));
 expect(readNotebookTemplateLibrary(JSON.stringify(result.library),'calendar').library.templates.some(isStarter)).toBe(false);
 const defaults=defaultTemplates('essay');defaults.at(-1)!.prompt='我改过的提纲';
 expect(readNotebookTemplateLibrary(JSON.stringify({version:2,templates:defaults}),'essay').library.templates.at(-1)!.prompt).toBe('我改过的提纲');
});
it('non-pet encyclopedias do not inherit animal-care directions',()=>{
 for(const site of profiles){setActiveSite(site);const text=JSON.stringify(defaultTemplates('encyclopedia'));expect(text.includes('习性与照护')).toBe(site.spaceId==='pets');}
});
it('retains a full-length custom prompt when adding article-specific guidance',()=>{
 const prompt='作者要求'.repeat(250);
 expect(templateForArticle({id:'long',name:'完整要求',kind:'material',prompt},'essay').materials![0].prompt).toContain(prompt);
});
