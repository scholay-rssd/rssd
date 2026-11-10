import type {InternalNotes} from '../../scripts/agent/notebook.mjs';
import {INTERNAL_NOTE_FIELDS} from '../../../contracts/article-internal-notes.mjs';
import {usePrivateNotes} from './PreviewInternalNotes';
import {tr} from '../uiText';
import './article-review-notes.css';

const fields=(notes:InternalNotes={})=>Object.entries(INTERNAL_NOTE_FIELDS).filter(([key])=>notes[key as keyof InternalNotes]?.trim()) as [keyof InternalNotes,string][];
const actions:Record<string,string>={organize:'整理与写作',complete:'完成文章',revise:'改写',fill:'补全',research:'检索',image:'配图',title:'标题'};
type Props={articleId:string;version:unknown;cloudRevision?:number};

/** Read-only review metadata. Keep this inspector outside the public article and
 * its editable/copy/export subtree, even when the reader expands every note. */
export default function ArticleReviewNotes({articleId,version,cloudRevision}:Props){
 const state=usePrivateNotes(articleId,version,cloudRevision),data=state?.data;
 const whole=fields(data?.internalNotes),rows=Object.entries(data?.blockNotes||{}).filter(([,entry])=>fields(entry.notes).length),signatures=data?.modelSignatures||[];
 const count=whole.length+rows.length+signatures.length;
 const status=!state?tr('正在读取…'):state.error?tr('读取失败'):count?tr('{{count}} 项',{count}):tr('暂无内部审查记录');
 return <details className="article-review-notes" data-visibility="private" key={articleId}>
  <summary><strong>{tr('内部审查')}</strong><span className="article-review-count">{status}</span><small>{tr('仅内部可见')}</small></summary>
  <div className="article-review-content" role="region" aria-label={tr('内部审查记录')}>
   <p className="article-review-privacy">{tr('仅作者可见 · 不对外展示')}</p>
   {!state?<p role="status">{tr('正在读取…')}</p>:state.error?<p role="status" className="article-review-error">{tr('内部备注读取失败：{{error}}',{error:state.error})}</p>:<>
    {state.notice&&<p className="article-review-notice" role="status">{state.notice}</p>}
    {!count&&<p role="status">{tr('暂无内部审查记录')}</p>}
    {!!whole.length&&<section><h3>{tr('作者备注')}</h3>{whole.map(([key,label])=><div className="article-review-field" key={key}><h4>{tr(label)}</h4><p>{data!.internalNotes[key]}</p></div>)}</section>}
    {!!rows.length&&<section><h3>{tr('逐段批注')} · {rows.length}</h3>{rows.map(([id,entry],index)=><div className="article-review-row" key={id}><h4>{tr('行间备注')} · {index+1}</h4>{entry.anchor?.text&&<blockquote>{entry.anchor.text}</blockquote>}{fields(entry.notes).map(([key,label])=><div className="article-review-field" key={key}><h4>{tr(label)}</h4><p>{entry.notes[key]}</p></div>)}</div>)}</section>}
    {!!signatures.length&&<section><h3>{tr('模型记录')} · {signatures.length}</h3>{signatures.map(signature=><div className="article-review-model" key={signature.runId}><strong>{/^(auto|default\[\])$/i.test(signature.modelName||signature.modelId||'')?tr('自动选择（具体模型未报告）'):signature.modelName||signature.modelId||tr('模型未报告')}</strong><span>{signature.agentName} · {tr(actions[signature.action]||signature.action)} · {tr(signature.status==='completed'?'已完成':signature.status==='running'?'进行中':'已中断')}{signature.device&&<> · {signature.device}</>}</span><time dateTime={signature.startedAt}>{new Date(signature.startedAt).toLocaleString()}</time></div>)}</section>}
   </>}
  </div>
 </details>;
}
