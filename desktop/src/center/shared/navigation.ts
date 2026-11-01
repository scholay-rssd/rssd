// SPDX-License-Identifier: MIT
export const localCenterTabs = ['demands','works','publications'] as const;
export const managementCenterTabs = ['workers','destinations','settings','health','guestbooks','labels'] as const;
const allTabs:readonly string[]=[...localCenterTabs,...managementCenterTabs];
export function centerUrl(origin:string,tab:string,workspaceId=''){
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('中心地址必须是 HTTPS 域名');
  if(!allTabs.includes(tab))throw Error('未知中心页面');
  url.pathname='/rssd';url.searchParams.set('tab',tab);
  if(workspaceId)url.searchParams.set('workspaceId',workspaceId);
  return url.toString();
}
export function centerLocation(search:string){
  const query=new URLSearchParams(search),tab=query.get('tab');
  return {tab:tab&&allTabs.includes(tab)?tab:null,workspaceId:query.get('workspaceId')||''};
}
