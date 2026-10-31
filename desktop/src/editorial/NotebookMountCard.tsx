import Icon, {type IconName} from '../components/Icon';

export default function NotebookMountCard({name,description,icon,selected,disabled,onChange,detail}:{name:string;description:string;icon:IconName;selected:boolean;disabled:boolean;onChange:(selected:boolean)=>void;detail?:string}){
 return <label className={'notebook-mount-card'+(selected?' is-selected':'')+(disabled?' is-disabled':'')} title={detail||description}>
  <input type="checkbox" aria-label={name} checked={selected} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>
  <span className="notebook-card-check" aria-hidden="true">{selected?<Icon name="check" size={12}/>:null}</span>
  <span className="notebook-mount-icon" aria-hidden="true"><Icon name={icon} size={26}/></span>
  <strong>{name}</strong><small>{description}</small>
 </label>;
}

export function writingSkillIcon(id:string):IconName {
 if(/statistic|data|experiment/.test(id))return 'grid';
 if(/copy|edit|writing/.test(id))return 'text';
 if(/human|succes/.test(id))return 'sparkle';
 if(/research|search|reference/.test(id))return 'search';
 return 'file';
}
