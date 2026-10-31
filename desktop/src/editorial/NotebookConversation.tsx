import {Fragment,useState, type ReactNode} from 'react';
import Icon from '../components/Icon';
import type {Message} from './CursorAgentPane';

import { tr, trKey } from "../uiText";
const statuses:Record<string,string>={pending:trKey('等待执行'),in_progress:trKey('执行中'),completed:trKey('已完成'),failed:trKey('执行失败'),cancelled:trKey('已停止'),interrupted:trKey('已中断')};
const pretty=(value:unknown)=>typeof value==='string'?value:JSON.stringify(value,null,2);
function toolLabel(title=trKey('工具调用')){
 const names:Record<string,string>={article_list:trKey('检索本地 RSS'),article_read:trKey('阅读来源正文'),library_list:trKey('检索本地资料'),task_read:trKey('读取文章板'),task_update:trKey('更新文章板'),web_search:trKey('搜索公开资料')};
 const found=Object.keys(names).find(name=>new RegExp(`(^|[\\s·_-])${name}$`).test(title));return tr(found?names[found]:title);
}
// Inspired by assistant-ui ToolFallback: one collapsed line, real execution
// state, then separate input/output. ACP remains the source of truth.
export function NotebookToolCall({message,renderOther}:{message:Message;renderOther:(m:Message)=>ReactNode}){
 const tool=message.tool||{},status=tool.status||'pending';
 return <details className={'notebook-tool is-'+status}><summary><span className={status==='in_progress'?'cursor-spinner':'notebook-tool-icon'}>{status==='in_progress'?null:<Icon name={status==='completed'?'check':status==='failed'?'alert':status==='cancelled'||status==='interrupted'?'pause':'command'} size={14}/>}</span><span title={tool.title}>{toolLabel(tool.title)}</span><small>{tr(statuses[status]||status)}</small><Icon name="chevron-down" size={12}/></summary><div className="notebook-tool-body"><code>{tool.title||tr("工具调用")}</code>
 {tool.rawInput!==undefined&&<section><h5>{tr("调用参数")}</h5><pre>{pretty(tool.rawInput)}</pre></section>}
 {tool.locations?.map((l,i)=><p className="notebook-tool-path" key={i}>{l.path}</p>)}
 {tool.content?.map((c,i)=>c.type==='diff'?<div key={i}>{renderOther({id:message.id+'-'+i,role:'change',text:'',change:{articleId:'',path:c.path||'',oldText:c.oldText||'',newText:c.newText||'',sha256:''}})}</div>:c.content?.text?<section key={i}><h5>{tr("执行结果")}</h5><pre>{c.content.text}</pre></section>:null)}
 {tool.rawOutput!==undefined&&<section><h5>{status==='failed'?tr("错误信息"):tr("返回结果")}</h5><pre>{pretty(tool.rawOutput)}</pre></section>}
 {tool.rawOutput===undefined&&!tool.content?.length&&<p>{status==='in_progress'?tr("正在等待工具返回…"):status==='pending'?tr("工具尚未开始执行。"):tr("此调用没有返回文本。")}</p>}
 </div></details>;
}
function ToolGroup({messages,renderOther}:{messages:Message[];renderOther:(m:Message)=>ReactNode}){
 const running=messages.some(m=>m.tool?.status==='in_progress'),failed=messages.some(m=>m.tool?.status==='failed'),done=messages.filter(m=>m.tool?.status==='completed').length;
 if(messages.length===1)return <NotebookToolCall message={messages[0]} renderOther={renderOther}/>;
 return <details className="notebook-tool-group"><summary><Icon name="command" size={14}/><span>{tr("{{messages}} 次工具调用", {messages: messages.length})}</span><small>{running?tr("执行中"):failed?tr("有执行失败"):tr("完成 {{done}} / {{messages}}", {done, messages: messages.length})}</small><Icon name="chevron-down" size={12}/></summary><div>{messages.map(m=><NotebookToolCall key={m.id} message={m} renderOther={renderOther}/>)}</div></details>;
}
function TextMessage({m,renderText}:{m:Message;renderText:(text:string)=>ReactNode}){
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
 return <article className={'notebook-message is-'+m.role}><header>{m.role==='user'?<span>{tr("你")}</span>:<><Icon name="sparkle" size={14}/><span>{tr("写作助手")}</span></>}</header><div className="notebook-message-text">{renderText(m.text)}</div>{m.role==='assistant'&&m.text&&<button className="notebook-copy" aria-label={tr("复制回复")} title={copyError?tr("复制失败，请选择文字复制"):tr("复制回复")} onClick={async()=>{try{await navigator.clipboard.writeText(m.text);setCopied(true);setCopyError(false);}catch{setCopyError(true);}}}><Icon name={copied?'check':'copy'} size={13}/>{copied?tr("已复制"):copyError?tr("请手动复制"):''}</button>}</article>;
}
export default function NotebookConversation({messages,renderText,renderOther,renderAfter}:{renderAfter?:(m:Message)=>ReactNode;messages:Message[];renderText:(text:string)=>ReactNode;renderOther:(m:Message)=>ReactNode}){
 const rows:({kind:'tools';messages:Message[]}|{kind:'message';message:Message})[]=[];
 for(const m of messages){const last=rows.at(-1);if(m.role==='tool'){if(last?.kind==='tools')last.messages.push(m);else rows.push({kind:'tools',messages:[m]});}else rows.push({kind:'message',message:m});}
 return <>{rows.map(r=>r.kind==='tools'?<ToolGroup key={r.messages[0].id} messages={r.messages} renderOther={renderOther}/>:<Fragment key={r.message.id}>{r.message.role==='user'||r.message.role==='assistant'?<TextMessage key={r.message.id} m={r.message} renderText={renderText}/>:r.message.role==='turn'?<div key={r.message.id} className="notebook-turn-end">{r.message.status||tr("本轮结束")}</div>:<div className="notebook-message-event" key={r.message.id}>{renderOther(r.message)}</div>}{renderAfter?.(r.message)}</Fragment>)}</>;
}
