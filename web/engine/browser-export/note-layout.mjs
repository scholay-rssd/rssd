// Note pages and card pages share one swipeable picture gallery. On a note page the note's standalone
// pictures move from its text into the gallery beside it, each with its credit line; on a card page the gallery
// holds an article's card set. Long articles keep the single-column article page. Only the live pages change:
// copies and downloads keep the full body with every picture in place.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readImageSize} from '../image-size.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A picture that stands alone in its paragraph, with the credit line written right after it. Pictures inside
// running text stay in the text.
const PICTURE=/<p><img\b([^>]*)><\/p>(?:\s*<p class="article-caption">([\s\S]*?)<\/p>)?\n?/g;
const SITE_MEDIA=/\bsrc="(\/article-media\/[a-f0-9]{64}\.(?:png|jpg|webp))"/;
// Dots stop being useful long before a card set ends; the counter always shows.
const MAX_DOTS=12;

/** A note's standalone pictures, in order, and its text without them. */
export function notePictures(body){
 const pictures=[];
 const rest=body.replace(PICTURE,(_,attributes,caption)=>{pictures.push({attributes,caption:caption||''});return '';});
 return {pictures,body:rest};
}

/**
 * The gallery's shape: the first picture's own, kept within 3:4 to 4:3, so a panorama or a tall phone shot does
 * not dwarf the text. Pictures of another shape sit whole inside it.
 */
export async function noteRatio(target,pictures){
 const src=SITE_MEDIA.exec(pictures[0]?.attributes||'')?.[1];
 if(src)try{const size=readImageSize(await readFile(join(target,src.slice(1))));if(size)return Math.min(4/3,Math.max(3/4,size.width/size.height));}catch(error){if(error.code!=='ENOENT')throw error;}
 return 1;
}

/** Gallery slides for a note's pictures: the first loads at once, the rest when they come near. */
export function noteSlides(pictures){
 return pictures.map((picture,index)=>({img:`<img${picture.attributes.replace(/\s(?:loading|fetchpriority)="[^"]*"/g,'')}${index?' loading="lazy"':' fetchpriority="high"'}>`,caption:picture.caption}));
}

/** Gallery slides for a card set. A card is a picture of words, so the article link beside it is its text. */
export function cardSlides(cards,{en=false}={}){
 const total=cards.pages.length;
 return cards.pages.map((page,index)=>({img:`<img src="${esc(page.src)}" alt="${en?`Card ${index+1} of ${total}`:`第 ${index+1} 张，共 ${total} 张`}"${page.width?` width="${page.width}" height="${page.height}"`:''} decoding="async"${index?' loading="lazy"':' fetchpriority="high"'}>`}));
}

/** The gallery: slides that scroll and snap by touch, trackpad or keyboard, with a counter, dots and arrows. */
export function galleryHtml(slides,{ratio=1,en=false,label}={}){
 const total=slides.length;
 const items=slides.map((slide,index)=>`<figure class="rssd-note-slide"${total>1?` aria-label="${en?`${index+1} of ${total}`:`第 ${index+1} 张，共 ${total} 张`}"`:''}><div class="rssd-note-frame">${slide.img}</div>${slide.caption?`<figcaption>${slide.caption}</figcaption>`:''}</figure>`).join('');
 const dots=total<=MAX_DOTS?`<span class="rssd-note-dots" aria-hidden="true">${'<i></i>'.repeat(total)}</span>`:'';
 const controls=total>1?`<span class="rssd-note-count" aria-hidden="true"><b>1</b>/${total}</span><div class="rssd-note-controls"><button type="button" class="rssd-note-prev" aria-label="${en?'Previous':'上一张'}" hidden>‹</button>${dots}<button type="button" class="rssd-note-next" aria-label="${en?'Next':'下一张'}" hidden>›</button></div>`:'';
 return `<section class="rssd-note-media" style="--ar:${Math.round(ratio*10000)/10000}" aria-label="${esc(label||(en?'Pictures':'图片'))}"><div class="rssd-note-track"${total>1?` tabindex="0" aria-label="${en?'Swipe or use the arrow keys for more':'左右滑动或用方向键查看更多'}"`:''}>${items}</div>${controls}</section>`;
}

/** The link from an article to its card page, with the set's cover or first card. It sits under the title, so
 * its small picture loads with the page. */
export function cardsLink({route,cards,en=false}){
 const cover=cards.cover||cards.pages[0],total=cards.pages.length;
 return `<a class="rssd-cards-link" href="${esc(route)}"><img src="${esc(cover.src)}" alt="" width="36" height="48" decoding="async"><span>${en?`Cards · ${total}`:`卡片版 · ${total} 张`}</span></a>`;
}

/** A row of links between a work's pages and the works rewritten from it; nothing when there are none. */
export function workLinks(links){
 return links.length?`<p class="rssd-work-links">${links.join('')}</p>`:'';
}
