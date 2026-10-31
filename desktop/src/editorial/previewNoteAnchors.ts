import {marked} from 'marked';
import type {BlockInternalNotes,PrivateEditorialData} from '../../../contracts/article-internal-notes.mjs';

export type PreviewAnchor={tag:string;text:string;src?:string};
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
export function notePreviewAnchor(anchor:NonNullable<BlockInternalNotes[string]['anchor']>):PreviewAnchor|null{
 if(anchor.type==='image')return {tag:'IMG',text:'',src:anchor.text};
 const doc=new DOMParser().parseFromString(anchor.type==='heading'?`<h1>${marked.parseInline(anchor.text,{async:false})}</h1>`:marked.parse(anchor.text,{async:false}),'text/html');
 if(doc.body.children.length!==1)return null;
 const element=doc.body.firstElementChild!;
 return {tag:element.tagName,text:normalize(element.textContent||'')};
}
export function matchesPreviewAnchor(anchor:PreviewAnchor,candidate:PreviewAnchor){
 const heading=/^H[1-6]$/;
 return (anchor.tag===candidate.tag||heading.test(anchor.tag)&&heading.test(candidate.tag))&&(anchor.tag==='IMG'?anchor.src===candidate.src:!!anchor.text&&anchor.text===normalize(candidate.text));
}
/** Resolve only unique full-text matches. Repeated or edited text stays with the title. */
export function locatePreviewNotes<T>(data:PrivateEditorialData,targets:T[],matches:(anchor:PreviewAnchor,target:T)=>boolean){
 const located:{id:string;entry:BlockInternalNotes[string];target:T}[]=[],unplaced:BlockInternalNotes={};
 for(const [id,entry] of Object.entries(data.blockNotes||{})){
  const anchor=entry.anchor&&notePreviewAnchor(entry.anchor),found=anchor?targets.filter(target=>matches(anchor,target)):[];
  if(found.length===1)located.push({id,entry,target:found[0]});else unplaced[id]=entry;
 }
 return {located,unplaced};
}

export function previewElementMatches(anchor:PreviewAnchor,element:Element){
 const candidate={tag:element.tagName,text:element.textContent||'',src:element.getAttribute('src')||undefined};
 if(matchesPreviewAnchor(anchor,candidate))return true;
 // WeChat decorates headings with separate chapter-number spans. Match the
 // intact title span, never a substring of a paragraph or a guessed row number.
 return /^H[1-6]$/.test(element.tagName)&&/^H[1-6]$/.test(anchor.tag)&&[...element.querySelectorAll('span')].some(span=>matchesPreviewAnchor(anchor,{tag:element.tagName,text:span.textContent||''}));
}
