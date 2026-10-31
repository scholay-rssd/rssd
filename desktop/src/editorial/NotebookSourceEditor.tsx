import {useMemo,useState} from 'react';
import {marked} from 'marked';
import {tr} from '../uiText';

export default function NotebookSourceEditor({text,rowId,label,disabled,onChange}:{text:string;rowId:string;label:string;disabled:boolean;onChange:(text:string)=>void}){
 const [editing,setEditing]=useState(false),[copied,setCopied]=useState(false);
 const code=useMemo(()=>{const tokens=marked.lexer(text).filter(t=>t.type!=='space');return tokens.length===1&&tokens[0].type==='code'?tokens[0]:null;},[text]);
 const showSource=!code||editing;
 return <div className="notebook-source-editor" contentEditable={false}>
  <header><span>{code?(code.lang?.split(/\s/)[0]||tr('代码')):tr('Markdown 源文')}</span><div>{code&&<button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(code.text);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{setCopied(false);}}}>{tr(copied?'已复制':'复制代码')}</button>}{code&&!disabled&&<button type="button" aria-pressed={editing} onClick={()=>setEditing(!editing)}>{tr(editing?'预览代码':'编辑源码')}</button>}</div></header>
  {showSource?<textarea className="notebook-source-input" data-row-id={rowId} aria-label={label} rows={Math.min(24,Math.max(5,text.split('\n').length))} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={text} disabled={disabled} onChange={e=>onChange(e.target.value)}/>:<pre className="notebook-code-preview" tabIndex={0} aria-label={label}><code>{code.text}</code></pre>}
 </div>;
}
