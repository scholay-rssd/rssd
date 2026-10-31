import {expect,it} from 'vitest';
import {manuscriptBlocks} from '../editorial/manuscriptBlocks';
import {newNote} from '../editorial/notebookEditorModel';
it('imports headings, paragraphs, lists and images into individual notebook blocks without rewriting the source',()=>{
 const source='# 标题\n\n第一段。\n\n第二段 **粗体**。\n\n- 甲\n- 乙\n\n![图](assets/a.png)\n';
 const doc=manuscriptBlocks(source);
 expect(doc.blocks.map(b=>b.type)).toEqual(['heading','paragraph','paragraph','paragraph','image']);
 expect(doc.serialize(doc.blocks)).toBe(source);
 const next=doc.blocks.map((b,i)=>i===1?{...b,text:'更新正文'}:b);
 expect(doc.serialize(next)).toContain('更新正文\n\n第二段 **粗体**。');
 expect(doc.serialize(next)).toContain('![图](assets/a.png)');
});
it('retains tables, front matter, footnotes and HTML when other paragraphs change',()=>{
 const special='---\ntitle: old\n---\n\n正文\n\n|甲|乙|\n|---|---|\n|1|2|\n\n<!-- keep -->\n\n注释[^1]\n\n[^1]: 来源\n';
 const doc=manuscriptBlocks(special);
 expect(doc.serialize(doc.blocks)).toBe(special);
 const output=doc.serialize(doc.blocks.map(b=>b.text==='正文'?{...b,text:'新正文'}:b));
 expect(output).toBe(special.replace('正文','新正文'));
});
it('retains empty Enter blocks and produces separate paragraphs after edits and reordering',()=>{
 const doc=manuscriptBlocks('第一段\n\n第二段');
 const empty=newNote();
 expect(doc.serialize([doc.blocks[0],empty,doc.blocks[1]])).toBe('第一段\n\n\n\n第二段');
 const next=doc.serialize([doc.blocks[1],doc.blocks[0]]);
 expect(next).toBe('第二段\n\n第一段\n\n');
 expect(manuscriptBlocks(next).blocks.map(b=>b.text)).toEqual(['第二段','第一段']);
});
