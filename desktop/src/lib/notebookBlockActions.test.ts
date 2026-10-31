import {expect,it} from 'vitest';
import {copyBlocks,pasteBlocks,removeBlocks,parseBlockClipboard} from '../editorial/notebookBlockActions';
import type {NoteBlock,NoteGroup,NoteSource} from '../../scripts/agent/notebook.mjs';
const b=(id:string,extra:Partial<NoteBlock>={}):NoteBlock=>({id,type:'paragraph',text:'作者原文',state:'ready',sourceIds:[],locked:true,...extra});
const source:NoteSource={id:'s',title:'出处',summary:'原始资料',url:'https://example.org/a',acquiredVia:'rss',reviewed:true};
it('copies a figure as one unit with remapped identity, caption, attribution and layout',()=>{
 const note={blocks:[b('image',{type:'image',text:'assets/notebook/'+('a'.repeat(64))+'.webp',groupId:'g',alt:'我的说明',presentation:{widthMode:'wide'}}),b('caption',{type:'annotation',role:'caption',targetId:'image',groupId:'g',sourceIds:['s']})],groups:[{id:'g',kind:'figure'}] as NoteGroup[]};
 const clip=parseBlockClipboard(JSON.stringify(copyBlocks(note,['image'],[source]))),result=pasteBlocks(note,clip,'caption',[source]);
 expect(result.note.blocks.slice(0,2)).toEqual(note.blocks);expect(result.note.blocks[2].id).not.toBe('image');expect(result.note.blocks[3].targetId).toBe(result.note.blocks[2].id);expect(result.note.blocks[2].groupId).not.toBe('g');expect(result.note.blocks[3].groupId).toBe(result.note.blocks[2].groupId);expect(result.sources).toEqual([source]);expect(result.note.blocks[2].presentation).toEqual({widthMode:'wide'});expect(removeBlocks(result.note,result.ids)).toEqual(note);
});
it('cross-article paste retains citations without replacing a colliding source',()=>{
 const payload=copyBlocks({blocks:[b('p',{sourceIds:['s']})],groups:[]},['p'],[source]),existing={...source,url:'https://example.org/other',title:'另一出处'};
 const result=pasteBlocks({blocks:[b('existing')],groups:[]},payload,'existing',[existing]);expect(result.sources[0]).toEqual(existing);expect(result.sources[1].id).not.toBe('s');expect(result.note.blocks[1].sourceIds).toEqual([result.sources[1].id]);expect(result.sources[1].url).toBe(source.url);
});
it('pasting into the pristine blank does not leave an extra placeholder',()=>{
 const result=pasteBlocks({blocks:[b('blank',{text:'',state:'placeholder',locked:false})],groups:[]},copyBlocks({blocks:[b('p')],groups:[]},['p']));expect(result.note.blocks).toHaveLength(1);expect(result.note.blocks[0].text).toBe('作者原文');
});
it('rejects malformed clipboard content and dangling citations before editing',()=>{
 expect(()=>parseBlockClipboard('{')).toThrow();expect(()=>parseBlockClipboard(JSON.stringify({version:1,blocks:[b('p',{sourceIds:['missing']})],groups:[],sources:[]}))).toThrow(/格式/);
});
