import manifest from './catalog.json';
import {invoke} from '../lib/nativeCore';
import { trKey } from "../trKey";

export type Provider = (typeof manifest.providers)[number];
export const providers: readonly Provider[] = manifest.providers;
export const categories = [{id:'all',name:trKey('全部')}, {id:'books',name:trKey('书籍与文档')}, {id:'reading',name:trKey('阅读与资讯')}, {id:'design',name:trKey('设计')}, {id:'code',name:trKey('代码')}];
export type ConnectionStatus = 'unconfigured'|'configured'|'verified'|'expired'|'limited'|'unavailable';
export interface Connection {provider:string; configured:boolean; enabled?:boolean; status:ConnectionStatus; target:string; checkedAt?:string; message?:string}
export const connectionEnabled=(connection?:Connection)=>!!connection?.configured&&connection.enabled!==false;
export interface CenterState {spaceId:string; spaceName:string; vault:string; connections:Connection[]}
export interface Resource {id:string; title:string; detail:string; url?:string; target?:string; kind:string}
export interface ResourcePage {items:Resource[]; nextCursor?:string; notice?:string}
export const statusLabels:Record<ConnectionStatus,string> = {unconfigured:trKey('未连接'),configured:trKey('待验证'),verified:trKey('已验证'),expired:trKey('需更新授权'),limited:trKey('访问受限'),unavailable:trKey('暂时不可用')};
export interface ConnectionService {
  list():Promise<CenterState>;
  save(provider:string,secret:string,target:string):Promise<Connection>;
  verify(provider:string):Promise<Connection>;
  disconnect(provider:string):Promise<Connection>;
  setEnabled(provider:string,enabled:boolean,spaceId:string):Promise<Connection>;
  browse(provider:string,cursor?:string):Promise<ResourcePage>;
}
const call = <T>(method:string,params:Record<string,unknown>={}) => invoke<T>('connection_center',{method,provider:null,secret:null,target:null,cursor:null,enabled:null,expectedSpace:null,...params});
export const connectionService:ConnectionService = {
  list:()=>call('list'),
  save:(provider,secret,target)=>call('save',{provider,secret:secret||null,target}),
  verify:provider=>call('verify',{provider}),
  disconnect:provider=>call('disconnect',{provider}),
  setEnabled:(provider,enabled,spaceId)=>call('set_enabled',{provider,enabled,expectedSpace:spaceId}),
  browse:(provider,cursor)=>call('browse',{provider,cursor:cursor||null}),
};
export function filterProviders(query:string,category:string,connectedOnly:boolean,connections:Connection[]){
  const text=query.trim().toLocaleLowerCase();
  return providers.filter(p=>(category==='all'||p.category===category)&&(!connectedOnly||connections.some(c=>c.provider===p.id&&c.configured))&&`${p.name} ${p.description} ${p.capabilities.join(' ')}`.toLocaleLowerCase().includes(text));
}
export function safeResourceUrl(raw:string|undefined):string|undefined{
  if(!raw)return;
  try{const url=new URL(raw);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{/* No executable or malformed links. */}
}
