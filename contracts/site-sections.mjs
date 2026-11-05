// Stable public sections, shared by local writing and publication. Legacy drafts may omit sectionId.
export const SITE_SECTIONS={
  "scholay-today": [
    {
      "id": "calendar",
      "name": "今日学术",
      "defaultMode": "calendar"
    },
    {
      "id": "history",
      "name": "昔日学术",
      "defaultMode": "history"
    },
    {
      "id": "briefings",
      "name": "学界犀闻",
      "defaultMode": "xiwen"
    },
    {
      "id": "observations",
      "name": "学者观察",
      "defaultMode": "observation"
    },
    {
      "id": "resources",
      "name": "学术资源",
      "defaultMode": "opensource",
      "enabled": false,
      "writable": false
    },
    {
      "id": "open-source",
      "name": "学术开源",
      "defaultMode": "opensource",
      "enabled": false,
      "writable": false
    },
    {
      "id": "collaboration",
      "name": "项目合作",
      "defaultMode": "observation",
      "enabled": false,
      "writable": false
    },
    {
      "id": "courses",
      "name": "课程资源",
      "defaultMode": "opensource",
      "enabled": false,
      "writable": false
    }
  ],
  "lingxi": [
    {
      "id": "tutorials",
      "name": "使用教程",
      "defaultMode": "documentation"
    },
    {
      "id": "development",
      "name": "开发日志",
      "defaultMode": "documentation"
    },
    {
      "id": "input-schemes",
      "name": "输入方案",
      "defaultMode": "documentation"
    },
    {
      "id": "input-skins",
      "name": "外观设计",
      "defaultMode": "design"
    }
  ],
  "piggytuck": [
    {
      "id": "works",
      "name": "作品系列",
      "defaultMode": "design"
    },
    {
      "id": "design-news",
      "name": "设计资讯",
      "defaultMode": "xiwen"
    },
    {
      "id": "icons",
      "name": "精美图标",
      "defaultMode": "design"
    },
    {
      "id": "web-design",
      "name": "网页设计",
      "defaultMode": "design"
    }
  ],
  "personal": [
    {
      "id": "works",
      "name": "作品系列",
      "defaultMode": "design"
    },
    {
      "id": "product-news",
      "name": "产品资讯",
      "defaultMode": "xiwen"
    },
    {
      "id": "reflections",
      "name": "产品随想",
      "defaultMode": "essay"
    },
    {
      "id": "academic-notes",
      "name": "学术札记",
      "defaultMode": "observation"
    }
  ],
  "pets": [
    {
      "id": "pet-news",
      "name": "宠物资讯",
      "defaultMode": "xiwen"
    },
    {
      "id": "daily-cat",
      "name": "每日一猫",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "daily-dog",
      "name": "每日一狗",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "exotic-pets",
      "name": "异宠大全",
      "defaultMode": "encyclopedia"
    }
  ],
  "legis": [
    {
      "id": "frontiers",
      "name": "法律前沿",
      "defaultMode": "xiwen"
    },
    {
      "id": "cases",
      "name": "法律案例",
      "defaultMode": "observation"
    },
    {
      "id": "ip",
      "name": "知识产权",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "regulations",
      "name": "政策法规",
      "defaultMode": "documentation"
    }
  ],
  "metho": [
    {
      "id": "methods",
      "name": "方法百科",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "statistics",
      "name": "统计之美",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "experiments",
      "name": "实验星球",
      "defaultMode": "documentation"
    },
    {
      "id": "frontiers",
      "name": "方法前沿",
      "defaultMode": "xiwen"
    }
  ],
  "enter": [
    {
      "id": "forums",
      "name": "学术社区",
      "defaultMode": "opensource"
    },
    {
      "id": "software",
      "name": "软件网站",
      "defaultMode": "opensource"
    },
    {
      "id": "search",
      "name": "学术检索",
      "defaultMode": "documentation"
    },
    {
      "id": "courses",
      "name": "课程资源",
      "defaultMode": "opensource"
    }
  ],
  "xsiching": [
    {
      "id": "classics",
      "name": "国学经典",
      "defaultMode": "encyclopedia"
    },
    {
      "id": "interpretations",
      "name": "易家之言",
      "defaultMode": "essay"
    },
    {
      "id": "applications",
      "name": "精品应用",
      "defaultMode": "opensource"
    },
    {
      "id": "courses",
      "name": "课程资源",
      "defaultMode": "opensource"
    }
  ],
  "study": [
    {
      "id": "courses",
      "name": "课程学习",
      "defaultMode": "opensource"
    },
    {
      "id": "models",
      "name": "模型前沿",
      "defaultMode": "observation"
    },
    {
      "id": "offers",
      "name": "福利羊毛",
      "defaultMode": "xiwen"
    },
    {
      "id": "certificates",
      "name": "资质证书",
      "defaultMode": "documentation"
    }
  ]
};
// A synchronized catalog overrides the server's bundled defaults, including an
// explicitly empty catalog. Never turn an unavailable client catalog into a
// different set of locally invented columns.
export function sectionsForSite(site){return site.sectionCatalog?.sections??site.sections??SITE_SECTIONS[site.id]??[];}
export function activeSectionsForSite(site){return sectionsForSite(site).filter(s=>s.enabled!==false).sort((a,b)=>(a.order??0)-(b.order??0));}
export function writableSectionsForSite(site){return activeSectionsForSite(site).filter(s=>s.writable!==false);}
export function validateSectionCatalog(value){
 if(!value||value.version!==1||typeof value.revision!=='string'||!value.revision||value.revision.length>128||!Array.isArray(value.sections)||value.sections.length>200)throw Error('线上栏目目录格式无效');
 const ids=new Set();
 const sections=value.sections.map((s,i)=>{
  if(!s||typeof s.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(s.id)||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||/[\x00-\x1f]/.test(s.name)||s.enabled!==undefined&&typeof s.enabled!=='boolean'||s.writable!==undefined&&typeof s.writable!=='boolean'||s.order!==undefined&&(!Number.isSafeInteger(s.order)||s.order<0))throw Error('线上栏目目录包含无效或重复栏目');
  ids.add(s.id);
  return {id:s.id,name:s.name.trim(),order:s.order??i,enabled:s.enabled!==false,writable:s.writable!==false,...(['essay','documentation','design','encyclopedia','xiwen','observation','opensource','calendar','history'].includes(s.defaultMode)?{defaultMode:s.defaultMode}:{}),...(Array.isArray(s.aliases)?{aliases:s.aliases.filter(n=>typeof n==='string'&&n.length<=80)}:{})};
 });
 return {version:1,revision:value.revision,sections};
}
export function requirePublishSection(value,site){
 const id=validateSectionId(value,site);
 if(!id)throw Error('推送云端前请选择发布栏目');
 if(!writableSectionsForSite(site).some(s=>s.id===id))throw Error('栏目已停用或不可写，请选择其他发布栏目');
 return id;
}
// Defaults are only for a new selection. Existing task modes and mounted skill
// snapshots remain authoritative when the catalog grows or changes order.
export function sectionWritingMode(siteId,sectionId){
 if(!sectionId)return undefined;
 const section=sectionsForSite(typeof siteId==='string'?{id:siteId}:siteId).find(s=>s.id===sectionId);
 if(!section)throw Error('栏目不存在，请同步栏目配置：'+sectionId);
 return section.defaultMode;
}
export function validateSectionId(value,site){
 if(value===undefined||value==='')return undefined;
 if(typeof value!=='string'||!sectionsForSite(site).some(s=>s.id===value))throw Error('公开栏目不属于当前站点');
 return value;
}
