import { tr } from "../uiText";
export type FlowStepItem={key:string;label:string;state:'done'|'active'|'todo';text:string};
/** Read-only vertical progress for the four workflow sections. It reports the flow; it never steers it. */
export default function FlowStepRail({steps,compact=false}:{steps:FlowStepItem[];compact?:boolean}){
 if(!steps.length)return null;
 return <div className={'flow-progress'+(compact?' is-compact':'')} aria-label={tr("创作进度")}><ol>{steps.map((s,i)=><li key={s.key} className={'is-'+s.state} aria-current={s.state==='active'?'step':undefined} title={compact?s.label+(s.text?' · '+s.text:''):undefined}><i aria-hidden="true">{s.state==='done'?'✓':i+1}</i>{!compact&&<><strong>{s.label}</strong>{s.text&&<small>{s.text}</small>}</>}</li>)}</ol></div>;
}
