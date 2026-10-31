import {useEffect,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import {useHtmlMarkup} from '../lib/htmlMarkup';
import {openUrl} from '@tauri-apps/plugin-opener';
import PublicationReader from './PublicationReader';
import { tr } from "../uiText";
type Record={id:string;revision:number;title:string;html:string;metadata:{author:string;category:string;date:string};url:string};
export default function WebsiteRecordPreview({id,url,title,revision,active,obscured,onEdit}:{id?:string;url:string|null;title?:string;revision?:number;active:boolean;obscured:boolean;onEdit?:(id:string)=>void}){
  const [record,setRecord]=useState<Record|null>(null),recordMarkup=useHtmlMarkup(record?.html||''),[error,setError]=useState(''),[browser,setBrowser]=useState(false),[busy,setBusy]=useState(false);
  const epoch=useRef(0);
  useEffect(()=>{if(!active)return;const version=++epoch.current;setRecord(null);setError('');setBrowser(false);if(!id)return;
    void invoke<Record>('website_publish_call',{method:'published',params:{id}}).then(value=>{
      if(value?.id!==id||typeof value.html!=='string'||!value.metadata||!Number.isSafeInteger(value.revision))throw Error(tr('官网正文格式异常，请刷新目录后重试'));
      if(epoch.current===version)setRecord(value);
    }).catch(e=>{if(epoch.current===version)setError(String(e));});
    return()=>{epoch.current++;};
  },[active,id,revision]);
  async function edit(){if(!record||busy)return;setBusy(true);setError('');try{const result=await invoke<{id:string;conflict:boolean;message?:string}>('website_publish_call',{method:'pull',params:{id:record.id}});if(result.conflict)setError(result.message||tr("本地修改已保留，请合并"));onEdit?.(result.id);}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <section className="website-db-preview" aria-label={tr("官网数据库正文")}><header><span>{record?tr("官网定稿 · v{{revision}}", {revision: record.revision}):tr("官网内容")}</span><div>{onEdit&&<button disabled={!record||busy} onClick={()=>void edit()}>{busy?tr("正在取回…"):tr("取回本地编辑")}</button>}<button disabled={!url} aria-pressed={browser} onClick={()=>setBrowser(x=>!x)}>{browser?tr("数据库正文"):tr("预览公开页面")}</button></div></header>
    {error&&<div className="pub-message pub-error" role="alert">{error}</div>}
    {browser?<PublicationReader active={active} obscured={obscured} url={url} title={title}/>:record?<div className="editorial-preview" onClick={e=>{const a=(e.target as Element).closest('a');if(a){e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//.test(href))void openUrl(href);}}}><article className="editorial-prose"><p className="pub-muted">{record.metadata.category} · {record.metadata.date}</p><div dangerouslySetInnerHTML={recordMarkup}/></article></div>:<div className="pub-empty"><h3>{error?tr("正文暂不可用"):id?tr("正在读取官网数据库…"):tr("选择一条官网记录")}</h3><p>{tr("按需读取已发布版本，保留日期、来源及配图。")}</p></div>}
  </section>;
}
