// Frozen, site-specific positive AI disclosure. Legacy tasks retain their
// historical text and are never retroactively assigned a new policy.
const generic={'zh-CN':'AI 生成示意图',en:'AI-generated illustration'};
const negative=/(?:并非|不是|没有|未(?:经|由|使用)?|非|不(?:是|由)?)\s*(?:由\s*)?AI\s*(?:辅助)?生成|\b(?:not|never|non[- ]|without)\s*(?:an?\s*)?(?:AI[- ]generated|AI\s*(?:assistance|tools))\b|\b(?:not|never|without)\b.{0,30}\b(?:generated|created|made)\s+(?:by|with)\s+AI\b/i;
const positive={'zh-CN':/AI\s*(?:辅助)?生成/i,en:/\bAI[- ]generated\b/i};
export function validImageDisclosures(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&['zh-CN','en'].every(locale=>typeof value[locale]==='string'&&value[locale].trim()===value[locale]&&value[locale].length>0&&value[locale].length<=200&&!/[\x00-\x1f]/.test(value[locale])&&positive[locale].test(value[locale])&&!negative.test(value[locale]));
}
function disclosure(provenance,locale){
 const value=provenance?.disclosures??generic;
 if(!validImageDisclosures(value))throw Object.assign(Error('Image disclosure policy is invalid'),{code:'image_pending'});
 return value[locale==='en'?'en':'zh-CN'];
}
export function generatedCaption(caption,provenance,locale){
 if(typeof caption!=='string'||negative.test(caption))throw Object.assign(Error('Image caption contradicts its AI provenance'),{code:'image_pending'});
 const text=disclosure(provenance,locale);
 return caption===text||caption.endsWith(' · '+text)?caption:caption+' · '+text;
}
export function hasGeneratedDisclosure(caption,provenance,locale){
 if(typeof caption!=='string'||negative.test(caption))return false;
 const text=disclosure(provenance,locale);
 return caption===text||caption.endsWith(' · '+text);
}
