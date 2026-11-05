// Remove known attribution trackers while retaining all other URL parameters.
// Only public Markdown content and source URLs go through this helper; private
// editorial notes are deliberately left untouched.
const tracking=/^(?:utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i;
export function cleanCitationUrl(value){
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return value;const keys=[...url.searchParams.keys()].filter(k=>tracking.test(k));if(!keys.length)return value;for(const key of keys)url.searchParams.delete(key);return url.href;}catch{return value;}
}
export function cleanCitationText(text){
 if(typeof text!=='string')return text;
 return text.replace(/https?:\/\/[^\s<>()[\]]+/gi,raw=>{const match=raw.match(/^(.*?)([.,;!?，。；！？]*)$/);return cleanCitationUrl(match[1])+match[2];});
}
export function cleanNotebookCitations(notebook){
 const result=structuredClone(notebook);
 if(Array.isArray(result?.sources))result.sources=result.sources.map(source=>({...source,url:cleanCitationUrl(source.url)}));
 if(Array.isArray(result?.blocks))result.blocks=result.blocks.map(block=>({...block,text:cleanCitationText(block.text)}));
 return result;
}
