export type SiteNavigationItem={id:string;label:string;href:string;view:'home'|'feed'|'page'|'calendar'|'resources'|'projects'|'gallery'|'graph'|'showcase'|'roadmap';module?:string;service?:'guestbook';localize?:boolean;labels?:Record<string,string>;match?:string[]};
export type SiteProfile={sectionCatalog?:import("../contracts/site-sections.mjs").SectionCatalog;sections?:import("../contracts/site-sections.mjs").SiteSection[];version:number;id:string;spaceId:string;name:string;domain:string;origin:string;description:string;slogan?:string;aliases?:string[];publicColumns?:string[];navigation?:SiteNavigationItem[];layout?:'articles'|'showcase';services?:{guestbook:{enabled:boolean}};articleFeatures?:{inputScheme:boolean};accent:string;legacy?:boolean;homeMode:string;themeId?:string;columns:string[];yearCategories:string[];sourceCategories:string[];author:string;timezone:string;retainLocal:boolean};
export const ACTIVE_SITE:SiteProfile;

export function setActiveSite(site:SiteProfile):void;
export function onActiveSiteChange(listener:()=>void):()=>void;
