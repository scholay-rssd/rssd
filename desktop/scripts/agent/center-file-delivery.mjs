import {readFile, writeFile, rename, lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeNotebookResult} from '../../../contracts/notebook-output.mjs';
import {formatErrors, publicUrl} from './notebook-model.mjs';
import {headingFormatErrors} from './notebook-headings.mjs';
import defaults from '../../../contracts/writing-defaults-v1.cjs';

export function validateFileNotebook(text, effective){
 if(typeof text!=='string'||Buffer.byteLength(text)>1000000)throw Error('Article JSON exceeds 1 MB');
 let parsed;try{parsed=JSON.parse(text);}catch(error){throw Error('Article file must contain exactly one complete JSON object: '+error.message);}
 const result=normalizeNotebookResult(parsed),n=result?.notebook;
 if(!n||n.version!==2||typeof result.summary!=='string'||!result.summary.trim())throw Error('Return Notebook v2 and a nonempty summary in the same complete object');
 const issues=formatErrors(n,{imageReference:value=>typeof value==='string'&&value.length>0&&(publicUrl(value)||value.startsWith('/'))});
 if(!issues.length)issues.push(...headingFormatErrors(n));
 const messages=issues.map(e=>e.path+': '+e.message);
 if(effective)messages.push(...defaults.deliveryIssues(result,effective));
 if(messages.length)throw Error('Correct these concrete delivery errors in the same file: '+messages.join('; '));
 return result;
}

export function createCenterFileDelivery({file,effective}){
 file=resolve(file);let writes=0;
 const pathMatches=value=>typeof value==='string'&&value===file;
 return {
  file,
  permits(toolCall){
   if(toolCall?.kind!=='edit')return false;
   const locations=(toolCall.locations||[]).map(l=>l.path);
   const input=toolCall.rawInput;
   const candidate=input?.path||input?.file_path||input?.target_file;
   const paths=[...locations,...(candidate?[candidate]:[])];
   return paths.length>0&&paths.every(pathMatches);
  },
  async call(method,params,sessionId){
   if(!sessionId||params?.sessionId!==sessionId||!pathMatches(params?.path))throw Error('File access is limited to this run\'s exact article JSON file');
   if(method==='fs/read_text_file'){
    const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>1000000)throw Error('Invalid article file');
    let content=await readFile(file,'utf8');
    if(params.line!==undefined||params.limit!==undefined){
     const line=params.line??1,limit=params.limit;
     if(!Number.isSafeInteger(line)||line<1||limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1))throw Error('Invalid line/limit');
     content=content.split('\n').slice(line-1,limit===undefined?undefined:line-1+limit).join('\n');
    }
    return {content};
   }
   if(method!=='fs/write_text_file')throw Error('Unsupported article file method');
   validateFileNotebook(params.content,effective);
   const temporary=file+'.'+randomUUID()+'.tmp';
   await writeFile(temporary,params.content,{flag:'wx',mode:0o600});await rename(temporary,file);writes++;
   return {};
  },
  async completed(){
   const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<1||info.size>1000000)throw Error('Cursor did not deliver a valid regular article file');
   const text=await readFile(file,'utf8');validateFileNotebook(text,effective);return {text,writes};
  },
  prompt(){return '\n\n本次使用文件交稿：前面的“只返回一个JSON”指下面文件的内容。请用 Write 工具或 fs/write_text_file 将同一个完整 Notebook v2 JSON（含 summary）保存到这个唯一文件：'+file+'。不要在聊天回复里输出长 JSON，不加围栏、前言或额外括号。只允许编辑这个交稿文件，不编辑其他已有文件。内部备注 internalNotes 直接包含五类字符串字段，不得再套 notes；blockNotes[行ID].notes 保持原结构。写入接口会检查完整JSON、summary、备注结构、alt与图注；如返回具体错误，在同一文件修正这些错误，保留其他内容。完成后只回复“已保存”。';}
 };
}
