import {useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {invoke} from '../lib/nativeCore';
import PrivateHtmlPreview from './PreviewInternalNotes';
import {openUrl} from '@tauri-apps/plugin-opener';
import {wechatHtml,copyRichHtml,defaultWechatStyle,WECHAT_STYLES,type WechatStyleId} from './wechatFormat';
import './wechat-preview.css';

import { tr } from "../uiText";
const styleKey=(id:string)=>'scholay.wechat.style:'+id;
/** Cloud HTML may carry site-relative image paths; WeChat needs absolute https ones. */
function absolutize(html:string,base?:string){if(!base)return html;const doc=new DOMParser().parseFromString(html,'text/html');for(const img of doc.querySelectorAll('img')){try{img.setAttribute('src',new URL(img.getAttribute('src')||'',base).href);}catch{/* dropped by the sanitizer */}}return doc.body.innerHTML;}
export default function WechatPreview({articleId,text,html:given,baseUrl,category,unnumbered,toolbarHost,loading=false}:{loading?:boolean;toolbarHost?:HTMLElement|null;articleId:string;text?:string;html?:string;baseUrl?:string;category?:string;unnumbered?:string[]}){
 const [raw,setRaw]=useState(''),[pending,setPending]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [style,setStyle]=useState<WechatStyleId>(()=>{try{const saved=localStorage.getItem(styleKey(articleId));if(WECHAT_STYLES.some(x=>x.id===saved))return saved as WechatStyleId;}catch{/* default below */}return defaultWechatStyle(category);});
 function choose(next:WechatStyleId){setStyle(next);setNotice('');try{localStorage.setItem(styleKey(articleId),next);}catch{/* the choice still applies now */}}
 useEffect(()=>{
  setError('');setNotice('');
  if(given!==undefined){setRaw(absolutize(given,baseUrl));setPending(false);return;}
  let stale=false;setPending(true);
  const timer=setTimeout(()=>{void invoke<{html:string;warnings?:string[]}>('editorial_call',{method:'draft_preview',params:{id:articleId,markdown:text,embedImages:true}}).then(r=>{if(!stale){setRaw(r.html);if(r.warnings?.length)setError(r.warnings.join('；'));}}).catch(e=>{if(!stale)setError(String(e));}).finally(()=>{if(!stale)setPending(false);});},200);
  return()=>{stale=true;clearTimeout(timer);};
 },[articleId,text,given,baseUrl]);
 const structural=(unnumbered||[]).join('\n');
 const html=useMemo(()=>raw?wechatHtml(raw,style,{unnumbered:structural?structural.split('\n'):[]}):'',[raw,style,structural]);
 async function copy(){try{await copyRichHtml(html);setNotice(tr("图文排版已复制，可粘贴到公众号编辑器。粘贴后请核对图片是否被平台接收。"));}catch(e){setError(tr("复制失败：{{e}}", {e: String(e)}));}}
 // The style picker and the copy button live in the surrounding toolbar when the host gives one; no row of their own.
 const controls=<><div className="wechat-style-picker" role="group" aria-label={tr("排版风格")}>{WECHAT_STYLES.map(x=><button key={x.id} type="button" className="wechat-style-option" aria-pressed={style===x.id} title={x.hint} onClick={()=>choose(x.id)}>{x.label}</button>)}</div><button type="button" className="wechat-copy" disabled={loading||pending||!html||!!error} onClick={()=>void copy()}>{loading||pending?tr("准备排版…"):tr("复制公众号图文")}</button></>;
 return <div className="wechat-preview">{toolbarHost===undefined?<div className="wechat-toolbar wechat-controls">{controls}</div>:toolbarHost&&createPortal(<div className="wechat-controls">{controls}</div>,toolbarHost)}{error&&<p className="editorial-message" role="alert">{error}</p>}{notice&&<p className="editorial-message" role="status">{notice}</p>}<div className="wechat-paper-scroll"><article className="wechat-paper" data-style={style} aria-label={tr("微信公众号排版预览")} aria-busy={loading||pending} onClick={e=>{const a=(e.target as Element).closest('a');if(a){e.preventDefault();const href=a.getAttribute('href')||'';if(/^https?:\/\//.test(href))void openUrl(href);}}}><PrivateHtmlPreview articleId={articleId} html={html}/></article></div></div>;
}
