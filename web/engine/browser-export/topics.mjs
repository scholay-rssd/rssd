// The #topics row under an article on the live page: the work's section first,
// then the tags bound to the work. Nothing is inferred from the title or body.
// Copies and downloads leave it out. Sites opt in while work types and tags are
// still being settled.
export const TOPIC_SITES=new Set(['pets']);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function articleTopics({sectionId='',sectionName,sectionRoute,tags=[]}){
 const seen=new Set(),items=[];
 if(sectionName){seen.add(sectionName);items.push(sectionRoute?`<a href="${esc(sectionRoute)}">#${esc(sectionName)}</a>`:`<span>#${esc(sectionName)}</span>`);}
 for(const tag of tags){const text=typeof tag==='string'?tag.trim():'';if(text&&!seen.has(text)){seen.add(text);items.push(`<span>#${esc(text)}</span>`);}}
 return items.length?`<p class="rssd-topics"${sectionId?` data-section="${esc(sectionId)}"`:''}>${items.join('')}</p>`:'';
}
