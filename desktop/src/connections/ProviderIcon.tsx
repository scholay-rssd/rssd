import Icon from '../components/Icon';

/** Small local marks: no remote image requests on opening the directory. */
export default function ProviderIcon({name}:{name:string}){
 return <span className={`connection-logo connection-logo-${name}`} aria-hidden="true">{
  name==='figma'?<svg width="25" height="36" viewBox="0 0 30 45"><path fill="#f24e1e" d="M7.5 0H15v15H7.5a7.5 7.5 0 0 1 0-15"/><path fill="#ff7262" d="M15 0h7.5a7.5 7.5 0 0 1 0 15H15"/><path fill="#a259ff" d="M7.5 15H15v15H7.5a7.5 7.5 0 0 1 0-15"/><circle fill="#1abcfe" cx="22.5" cy="22.5" r="7.5"/><path fill="#0acf83" d="M7.5 30H15v7.5A7.5 7.5 0 1 1 7.5 30"/></svg>:
  name==='google'?<svg width="34" height="34" viewBox="0 0 32 32"><path fill="#4285f4" d="M8 3h19v26H8z"/><path fill="#34a853" d="M5 7h5v22H5z"/><path fill="#fbbc04" d="M10 3h7v12l-3.5-2-3.5 2z"/><path fill="#fff" d="M13 20h10v2H13zm0 4h7v2h-7z"/></svg>:
  name==='github'?<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .8A11.2 11.2 0 0 0 8.46 22.6c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.8-1.33-3.8-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.23.71-1.51-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.01-.12-.28-.51-1.43.11-2.97 0 0 .95-.3 3.08 1.15a10.73 10.73 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.62 1.54.23 2.69.12 2.97.72.78 1.15 1.78 1.15 3.01 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.11c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/></svg>:
  name==='feedly'?<svg width="34" height="34" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round"><path d="m5 14 11-9 11 9M8 20l8-7 8 7M12 25l4-4 4 4"/></svg>:<Icon name="rss" size={30}/>
 }</span>;
}
