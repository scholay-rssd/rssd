// Isolated browser fixture. Every native read/write is an in-memory setting;
// no article, real database, account or remote endpoint is accessible.
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {nativeTransport} from '../src/lib/nativeCore';
import {setActiveSite} from '../../scripts/site-profile.mjs';
import profiles from '../../sites/profiles.json';
import {WRITING_SKILLS} from '../scripts/agent/notebook.mjs';
import {defaultTemplates,type TemplateMode} from '../src/editorial/topicTemplates';
import TopicSourceShelf from '../src/editorial/TopicSourceShelf';
import {TEMPLATE_SETTING} from '../src/editorial/topicSources';
import '../src/styles.css';
import '../src/workspace.css';
import '../src/editorial/structured-workflow.css';
const site=profiles.find(s=>s.id==='xsiching')!,settings=new Map<string,string>(),calls:{command:string;args:unknown}[]=[];
setActiveSite({...site,id:'qa-generic',spaceId:'qa-generic'});
for(const mode of Object.keys(WRITING_SKILLS) as TemplateMode[]){settings.set(TEMPLATE_SETTING+(mode==='xiwen'?'':'.'+mode),JSON.stringify({version:2,templates:defaultTemplates(mode)}));}
setActiveSite(site);
Object.assign(window,{guoxueQA:{calls,settings}});
nativeTransport.invoke=async<T,>(command:string,args?:unknown)=>{
 calls.push({command,args});const input=args as {key:string;value?:string};
 if(command==='get_setting')return (settings.get(input.key)||null) as T;
 if(command==='set_setting'){settings.set(input.key,input.value!);return undefined as T;}
 if(command==='list_articles')return [] as T;
 throw Error('Native operation blocked by QA fixture: '+command);
};
document.documentElement.dataset.mode='light';
function Fixture(){const [mode,setMode]=useState<TemplateMode>('xiwen');return <main className="workspace-window" style={{maxWidth:1080,margin:'30px auto',padding:24,background:'var(--paper)'}}><h2>犀术国学 · 模板库</h2><label>文章写法 <select aria-label="模板库" value={mode} onChange={e=>setMode(e.target.value as TemplateMode)}>{Object.entries(WRITING_SKILLS).map(([id,s])=><option key={id} value={id}>{s.name}</option>)}</select></label><TopicSourceShelf key={mode} mode={mode} fixedTab="templates" busy={false} usedUrls={[]} chosen={null} onChoose={()=>{}} onDrag={()=>{}}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
