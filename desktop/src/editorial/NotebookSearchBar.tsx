import type {ReactNode} from 'react';
import Icon from '../components/Icon';
import PopoverDetails from '../components/PopoverDetails';

import { tr } from "../uiText";
export default function NotebookSearchBar({label,query,onQuery,disabled=false,onSubmit,filters,actions}:{label:string;query:string;onQuery:(value:string)=>void;disabled?:boolean;onSubmit?:()=>void;filters?:ReactNode;actions?:ReactNode}){
 return <form className="notebook-search-bar" role="search" onSubmit={e=>{e.preventDefault();onSubmit?.();}}><Icon name="search" size={16}/><input aria-label={label} placeholder={label} value={query} disabled={disabled} onChange={e=>onQuery(e.target.value)}/>{onSubmit&&<button type="submit" aria-label={tr("搜索公开资料")} title={tr("搜索")} disabled={disabled||!query.trim()}><Icon name="arrow-up" size={16}/></button>}{filters&&<PopoverDetails className="notebook-search-filter"><summary aria-label={tr("筛选")} title={tr("筛选")}><Icon name="settings" size={16}/></summary><div className="notebook-search-filter-popover">{filters}</div></PopoverDetails>}{actions}</form>;
}
