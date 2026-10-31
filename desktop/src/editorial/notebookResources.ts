import type {Notebook, NoteSource} from '../../scripts/agent/notebook.mjs';
import {templateSection} from '../../scripts/agent/notebook-authoring.mjs';
import {recordMaterial} from '../calendar/academicRecords';
import {articleMaterial, urlKey, type TopicSource} from './topicSources';
import {notebookMoveUnits, type DropEdge} from './notebookReorder';

export type NotebookResource = TopicSource | {kind:'web'; source:NoteSource};
export type ResourceDrop = {id?:string; edge:DropEdge};
export const resourceTitle = (resource:NotebookResource) => resource.kind==='article'?resource.article.title:resource.kind==='template'?resource.template.name:resource.kind==='web'?resource.source.title:resource.event.title;
export const resourceKey = (resource:NotebookResource) => resource.kind==='article'?'article:'+resource.article.id:resource.kind==='template'?'template:'+resource.template.id:resource.kind==='web'?'web:'+resource.source.id:'record:'+resource.event.id;
export const placedSources = (note:Notebook) => {
  const used = new Set(note.blocks.flatMap(block=>block.sourceIds));
  return note.sources.filter(source=>used.has(source.id));
};
export const placedTemplates = (note:Notebook) => (note.mounts?.templates||[]).filter(template=>!template.blockIds||template.blockIds.some(id=>note.blocks.some(block=>block.id===id))).map(template=>template.id);

/** Inserting at a group boundary keeps sections and image/caption pairs intact. */
export function placeNotebookResource(note:Notebook, resource:NotebookResource, drop:ResourceDrop={edge:'after'}, makeId=()=>crypto.randomUUID()):Notebook {
  let index=note.blocks.length;
  if(drop.id){
    const unit=notebookMoveUnits(note).find(unit=>unit.some(block=>block.id===drop.id));
    if(!unit)return note;
    index=note.blocks.findIndex(block=>block.id===(drop.edge==='before'?unit[0].id:unit.at(-1)!.id))+(drop.edge==='after'?1:0);
  }
  const blank=note.blocks.length===1?note.blocks[0]:note.blocks.find(block=>block.id===drop.id);
  if(blank&&blank.type==='paragraph'&&blank.state==='placeholder'&&!blank.text&&!blank.requirement&&!blank.sourceIds.length&&!blank.locked&&!blank.groupId){index=note.blocks.indexOf(blank);note={...note,blocks:note.blocks.filter(block=>block.id!==blank.id)};}
  if(resource.kind==='template'){
    const template=resource.template;
    if(placedTemplates(note).includes(template.id))return note;
    const materials=template.kind==='section'&&template.materials?.length?template.materials:[{name:template.name,prompt:template.prompt}];
    const sections=materials.map(material=>templateSection(material,makeId));
    const blocks=sections.flatMap(section=>section.blocks);
    return {...note,blocks:[...note.blocks.slice(0,index),...blocks,...note.blocks.slice(index)],groups:[...(note.groups||[]),...sections.map(section=>section.group)],mounts:{...note.mounts!,brands:note.mounts?.brands||[],templates:[...(note.mounts?.templates||[]).filter(item=>item.id!==template.id),{id:template.id,name:template.name,version:JSON.stringify(template),blockIds:blocks.map(block=>block.id)}]}};
  }
  const material=resource.kind==='web'?resource.source:resource.kind==='article'?articleMaterial(resource.article,makeId()):recordMaterial(resource.event,makeId());
  const existing=note.sources.find(source=>urlKey(source.url)===urlKey(material.url));
  const source:NoteSource=existing||{...material,acquiredVia:material.acquiredVia||'web',reviewed:false};
  const context={webEnabled:note.context?.webEnabled||false,excludedSourceIds:(note.context?.excludedSourceIds||[]).filter(id=>id!==source.id)};
  if(placedSources(note).some(item=>item.id===source.id))return context.excludedSourceIds.length===(note.context?.excludedSourceIds||[]).length?note:{...note,context};
  note={...note,context};
  const block={id:makeId(),type:'paragraph' as const,text:'',state:'placeholder' as const,requirement:`根据《${source.title}》整理这部分内容，核对原文，保留来源。`,sourceIds:[source.id]};
  return {...note,sources:existing?note.sources:[...note.sources,source],blocks:[...note.blocks.slice(0,index),block,...note.blocks.slice(index)]};
}
