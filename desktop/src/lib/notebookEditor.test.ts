// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {Editor} from '@tiptap/core';
import {TextSelection} from '@tiptap/pm/state';
import {NotebookDoc,NotebookBlock,NotebookAtom,NotebookEditing,notebookStarter,notebookJSON,readNotebook,readNote,noteAt,boundaryKey,replaceNotebook,patchNote,syncNotebook} from '../editorial/notebookEditorModel';
import {notebookMarkdown,formatErrors,type NoteBlock} from '../../scripts/agent/notebook.mjs';
const editors:Editor[]=[];
const block=(id:string,text:string,extra:Partial<NoteBlock>={}):NoteBlock=>({id,type:'paragraph',text,state:text?'ready':'placeholder',sourceIds:[],...extra});
const note=(blocks:NoteBlock[],groups:any[]=[])=>({version:2 as const,title:'测试',kind:'article' as const,skills:['essay'],sources:[{id:'s1',title:'S1',summary:'',url:'https://example.org/1',acquiredVia:'web' as const,reviewed:false},{id:'s2',title:'S2',summary:'',url:'https://example.org/2',acquiredVia:'web' as const,reviewed:false}],fields:{},blocks,groups});
function create(blocks:NoteBlock[],groups:any[]=[]){const e=new Editor({extensions:[NotebookDoc,notebookStarter(),NotebookBlock,NotebookAtom,NotebookEditing],content:notebookJSON(blocks,groups)});editors.push(e);return e;}
afterEach(()=>{editors.splice(0).forEach(e=>e.destroy());});
it('round trips existing Markdown, metadata, captions and raw syntax without rewriting it',()=>{
 const blocks=[block('a','正文 **加粗** 和 _斜体_ [原文](https://example.org)'),block('h','**标题**',{type:'heading',level:6}),block('l','1. one\n2. two'),block('q','> quote'),block('c','```js\nlet a = 1;\n```'),block('raw','| A | B |\n|---|---|\n| 1 | 2 |'),block('html','<div>原文</div>')];
 const e=create(blocks);expect(readNotebook(e.state.doc).blocks).toEqual(blocks);expect(notebookMarkdown(note(readNotebook(e.state.doc).blocks))).toContain('###### **标题**');expect(e.state.doc.child(5).type.name).toBe('notebookAtom');
});
it('persists bold, italic and links, then reopens and exports equivalent marks',()=>{
 const e=create([block('a','文字')]);e.commands.setTextSelection({from:2,to:4});e.chain().toggleBold().toggleItalic().setLink({href:'https://example.org'}).run();
 const saved=readNotebook(e.state.doc).blocks;expect(saved[0]).toMatchObject({id:'a',state:'ready',locked:true});expect(saved[0].text).toContain('https://example.org');
 const reopened=create(saved);const text=reopened.state.doc.firstChild!.firstChild!.firstChild!;expect(text.marks.map(x=>x.type.name).sort()).toEqual(['bold','italic','link']);expect(notebookMarkdown(note(saved))).toContain(saved[0].text);
});
it.each(['toggleBulletList','toggleOrderedList','toggleBlockquote','toggleCodeBlock'] as const)('%s keeps block identity and exports Markdown',command=>{
 const e=create([block('a','内容',{sourceIds:['s1'],requirement:'保留此要求'})]);e.commands.setTextSelection(2);e.commands[command]();const saved=readNotebook(e.state.doc).blocks;expect(saved[0]).toMatchObject({id:'a',sourceIds:['s1'],requirement:'保留此要求'});expect(saved[0].text).not.toBe('内容');expect(readNotebook(create(saved).state.doc).blocks).toEqual(saved);
});
it('splits text at Enter, then merges at Backspace with sources and undo intact',()=>{
 const e=create([block('a','前后',{groupId:'g',sourceIds:['s1'],locked:true}),block('b','尾',{groupId:'g',sourceIds:['s2']})],[{id:'g',kind:'section'}]);e.commands.setTextSelection(3);expect(boundaryKey(e,'Enter')).toBe(true);let n=readNotebook(e.state.doc);expect(n.blocks.map(b=>b.text)).toEqual(['前','后','尾']);expect(n.blocks[1].groupId).toBe('g');
 expect(boundaryKey(e,'Backspace')).toBe(true);n=readNotebook(e.state.doc);expect(n.blocks.map(b=>b.text)).toEqual(['前后','尾']);expect(n.blocks[0].sourceIds).toEqual(['s1']);e.commands.undo();expect(readNotebook(e.state.doc).blocks.map(b=>b.text)).toEqual(['前','后','尾']);
});
it('cross-block deletion keeps remaining text and citations and is one undo step',()=>{
 const original=[block('a','abcdef',{sourceIds:['s1']}),block('b','uvwxyz',{sourceIds:['s2']})];const e=create(original);const b=noteAt(e,'b')!;e.commands.setTextSelection({from:5,to:b.pos+5});e.commands.deleteSelection();const n=readNotebook(e.state.doc);expect(n.blocks.map(b=>b.text).join('')).toBe('abcxyz');expect(n.blocks.flatMap(b=>b.sourceIds)).toContain('s2');e.commands.undo();expect(readNotebook(e.state.doc).blocks).toEqual(original);
});
it('autosave receipts preserve cursor and undo; external AI text is independently undoable',()=>{
 const e=create([block('a','原文',{locked:true})]);e.commands.setTextSelection(4);e.commands.insertContent('补充');const before=e.state.selection.from,saved=readNotebook(e.state.doc);syncNotebook(e,saved.blocks.map(b=>({...b,revision:2,updatedAt:'now'})),saved.groups);expect(e.state.selection.from).toBe(before);e.commands.undo();expect(readNotebook(e.state.doc).blocks[0].text).toBe('原文');e.commands.redo();
 const local=readNotebook(e.state.doc).blocks;syncNotebook(e,local.map(b=>({...b,text:'AI 改写',revision:3})),[]);expect(readNotebook(e.state.doc).blocks[0].text).toBe('AI 改写');e.commands.undo();expect(readNotebook(e.state.doc).blocks[0].text).toBe('原文补充');
});
it('deleting an image also deletes its caption, undo restores the group and exact metadata',()=>{
 const blocks=[block('image','assets/notebook/'+('a'.repeat(64))+'.webp',{type:'image',groupId:'g',alt:'说明',presentation:{widthMode:'wide'}}),block('caption','图注',{type:'annotation',role:'caption',targetId:'image',groupId:'g',sourceIds:['s1']})],groups=[{id:'g',kind:'figure'}];const e=create(blocks,groups);const image=noteAt(e,'image')!;e.view.dispatch(e.state.tr.delete(image.pos,image.pos+image.node.nodeSize));expect(readNotebook(e.state.doc).blocks.some(b=>b.role==='caption')).toBe(false);e.commands.undo();expect(readNotebook(e.state.doc)).toEqual({blocks,groups});
});
it('normalizes a group inserted in the middle without losing trailing rows or IDs',()=>{
 const e=create([block('a','A',{groupId:'g'}),block('b','B',{groupId:'g'}),block('c','C',{groupId:'g'})],[{id:'g',kind:'section'}]);const n=readNotebook(e.state.doc);n.blocks.splice(1,0,block('new','新节',{type:'heading',level:2,groupId:'new-group'}));n.groups.push({id:'new-group',kind:'section'});replaceNotebook(e,n.blocks,n.groups);const result=readNotebook(e.state.doc);expect(result.blocks.map(b=>b.id)).toEqual(['a','new','b','c']);expect(result.blocks[2].groupId).toBe(result.blocks[3].groupId);expect(formatErrors(note(result.blocks,result.groups))).toEqual([]);
});
it('converting a block and changing its requirement participate in document history',()=>{
 const e=create([block('a','原文',{requirement:'原要求'})]);patchNote(e,'a',{type:'heading',level:2});expect(readNote(e.state.doc.firstChild!).type).toBe('heading');e.commands.undo();expect(readNote(e.state.doc.firstChild!).type).toBe('paragraph');patchNote(e,'a',{requirement:'新要求'});e.commands.undo();expect(readNote(e.state.doc.firstChild!).requirement).toBe('原要求');
});
it('IME confirmation does not split a paragraph',()=>{
 const e=create([block('a','中文')]);e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc,4)));const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true});let handled=false;e.view.someProp('handleKeyDown',handler=>handled=handler(e.view,event)||handled);expect(handled).toBe(true);expect(readNotebook(e.state.doc).blocks).toHaveLength(1);
});
