import {useEffect,useRef,useState} from 'react';
import {invoke} from '../lib/nativeCore';
import {tr} from '../uiText';
type Row=Record<string,any>;
const call=(method:string,params:Row={})=>invoke<Row>('rssd_center_call',{method,params});
export function CenterConnection({status,disabled,onChanged,beforeChange}:{status:Row;disabled:boolean;onChanged:()=>Promise<void>;beforeChange:()=>Promise<void>}){
 const [origin,setOrigin]=useState(status.origin||''),[name,setName]=useState('RSSD Desktop'),[auth,setAuth]=useState<Row>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const seen=useRef(''),changed=useRef(onChanged);changed.current=onChanged;
 useEffect(()=>{if(status.origin)setOrigin(status.origin);},[status.origin]);
 useEffect(()=>{let disposed=false;const poll=async()=>{try{const result=await call('auth_status');if(disposed||!result)return;setAuth(result);if(result.state==='connected'&&seen.current!==JSON.stringify(result)){seen.current=JSON.stringify(result);await changed.current();}}catch{/* Older fixture transports may not implement authorization. */}};void poll();const timer=setInterval(()=>void poll(),2000);return()=>{disposed=true;clearInterval(timer);};},[]);
 async function action(method:string){setBusy(true);setError('');try{await beforeChange();if(method==='login')seen.current='';const value=await call(method,{origin,name});setAuth(value);if(['disconnect','retry_login'].includes(method))await changed.current();}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <details className="rssd-center-connection" open={!status.configured} aria-label={tr('中心账号连接')}><summary>{tr('中心账号连接')}{status.configured?' · '+status.origin:''}</summary>
  <form onSubmit={e=>{e.preventDefault();void action('login');}}><label>{tr('中心网址')}<input type="url" value={origin} required disabled={busy||disabled} onChange={e=>setOrigin(e.target.value)}/></label><label>{tr('设备名称')}<input value={name} maxLength={200} required disabled={busy||disabled} onChange={e=>setName(e.target.value)}/></label>
   <button className="rssd-center-primary" disabled={busy||disabled||auth.state==='waiting'}>{tr(status.configured?'重新授权设备':'登录 RSSD 中心')}</button>
   {status.configured&&<button type="button" disabled={busy||disabled} onClick={()=>void action('disconnect')}>{tr('退出中心连接')}</button>}
   {auth.state==='waiting'&&<button type="button" disabled={busy} onClick={()=>void action('cancel_login')}>{tr('取消授权')}</button>}
  </form>
  {auth.message&&<p role="status">{auth.message}</p>}{error&&<p role="alert" className="rssd-center-error">{error}</p>}
  <details><summary>{tr('恢复已确认的授权')}</summary><p>{tr('浏览器已授权但连接尚未保存时，可在这里继续。')}</p><button disabled={busy||disabled} onClick={()=>void action('retry_login')}>{tr('继续保存连接')}</button></details>
 </details>;
}
