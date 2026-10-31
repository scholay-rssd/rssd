import {marked} from 'marked';
import type {NoteBlock} from '../../scripts/agent/notebook.mjs';
import {newNote} from './notebookEditorModel';

const signature=(b:NoteBlock)=>JSON.stringify([b.type,b.text,b.level,b.alt]);
export function manuscriptBlocks(text:string){
 const originals=new Map<string,{signature:string;raw:string;index:number}>();
 const blocks:NoteBlock[]=[];
 const add=(raw:string,type:NoteBlock['type']='paragraph',extra:Partial<NoteBlock>={})=>{
  const b=newNote(type,{text:raw.replace(/\n+$/,''),state:'ready',locked:true,...extra});
  originals.set(b.id,{signature:signature(b),raw,index:blocks.length});blocks.push(b);
 };
 // YAML and reference definitions must remain literal, including their scope.
 let body=text;
 const front=body.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*\r?\n/);
 if(front){add(front[0],'markdown');body=body.slice(front[0].length);}
 for(const token of marked.lexer(body,{gfm:true})){
  if(token.type==='space'&&blocks.length){originals.get(blocks.at(-1)!.id)!.raw+=token.raw;continue;}
  if(token.type==='heading')add(token.raw,'heading',{text:token.text,level:token.depth});
  else if(token.type==='paragraph'&&token.tokens?.length===1&&token.tokens[0].type==='image'&&!token.tokens[0].title){const image=token.tokens[0];add(token.raw,'image',{text:image.href,alt:image.text});}
  else add(token.raw,['table','html','def','space'].includes(token.type)||/\[\^|\]\[|^\s*\[[^\]]+\]:/m.test(token.raw)?'markdown':'paragraph');
 }
 if(!blocks.length)blocks.push(newNote());
 return {blocks,serialize(next:NoteBlock[]){
  return next.map((b,i)=>{
   const original=originals.get(b.id),following=next[i+1]&&originals.get(next[i+1].id);
   let raw=original?.signature===signature(b)?original.raw:b.type==='heading'?'#'.repeat(b.level||2)+' '+b.text:b.type==='image'?(b.text?`![${(b.alt||'').replace(/([\\\[\]])/g,'\\$1')}](<${b.text}>)`:''):b.text;
   if(i<next.length-1&&!(original&&following?.index===original.index+1&&original.signature===signature(b))){raw=raw.replace(/\n+$/,'')+'\n\n';}
   return raw;
  }).join('');
 }};
}
