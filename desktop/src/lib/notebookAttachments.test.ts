// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {addTurnFiles,turnFileReferences} from '../editorial/notebookAttachments';
const file=(name:string,text:string)=>{const f=new File([text],name);Object.defineProperty(f,'text',{value:async()=>text});return f;};
it('deduplicates repeated file choices while preserving different contents with the same name',async()=>{
 const first=await addTurnFiles([],[file('材料.md','第一版')]);
 expect(await addTurnFiles(first,[file('材料.md','第一版')])).toHaveLength(1);
 expect(await addTurnFiles(first,[file('材料.md','第二版')])).toHaveLength(2);
 expect(turnFileReferences(first)[0]).toMatchObject({name:'材料.md',type:'text'});expect(turnFileReferences(first)[0].text).toBeUndefined();
});
it('rejects unsupported files, count overflow and aggregate payload overflow without changing the existing mounts',async()=>{
 const initial=await addTurnFiles([],[file('材料.md','保留')]),copy=structuredClone(initial);
 await expect(addTurnFiles(initial,[file('电子书.pdf','binary')])).rejects.toThrow('文本附件支持');
 await expect(addTurnFiles(initial,Array.from({length:6},(_,i)=>file(i+'.txt','内容')))).rejects.toThrow('6');
 await expect(addTurnFiles([{id:'large',name:'图.jpg',type:'image',data:'A'.repeat(4000000)}],[])).rejects.toThrow('总量');
 expect(initial).toEqual(copy);
});
