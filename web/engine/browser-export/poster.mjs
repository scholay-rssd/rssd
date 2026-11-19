// The share poster: one picture a reader can send in a chat. The site and section, the cover, the title,
// the author and date, and a QR code of the page's address. Drawn in the reader's browser with the page's
// own article colours (always their light version) and fonts; nothing is uploaded.
import {encodeQr} from './qr.mjs';

const WIDTH=750,PAD=48,SCALE=2;

// Resolve the article's colour tokens to plain colours, in light mode, inside the article so the
// category template's values apply.
function palette(article){
 const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;color-scheme:light';
 (article||document.body).append(probe);
 const read=(token,fallback)=>{probe.style.color=fallback;probe.style.color=`var(${token},${fallback})`;return getComputedStyle(probe).color;};
 const colours={paper:read('--read-paper','#ffffff'),ink:read('--read-ink','#1f2522'),muted:read('--read-muted','#68716b'),accent:read('--read-accent','#2b6e52')};
 probe.remove();return colours;
}

function loadImage(src,signal){
 return new Promise(resolve=>{
  if(!src)return resolve(null);
  const image=new Image();image.decoding='async';
  image.onload=()=>resolve(image);image.onerror=()=>resolve(null);
  signal?.addEventListener('abort',()=>resolve(null),{once:true});
  image.src=src;
 });
}

// Lines for canvas text: Chinese breaks between characters, other words stay whole unless too long.
function wrap(context,text,width,maxLines){
 const tokens=String(text).match(/[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|\s+/g)||[];
 const lines=[];let line='';
 const push=()=>{lines.push(line.trim());line='';};
 for(const token of tokens){
  if(context.measureText(line+token).width<=width){line+=token;continue;}
  if(line.trim())push();
  if(/^\s+$/.test(token))continue;
  if(context.measureText(token).width<=width){line=token;continue;}
  for(const char of token){if(context.measureText(line+char).width>width)push();line+=char;}
 }
 if(line.trim())push();
 if(lines.length>maxLines){
  const kept=lines.slice(0,maxLines);let last=kept[maxLines-1];
  while(last&&context.measureText(last+'…').width>width)last=last.slice(0,-1);
  kept[maxLines-1]=last+'…';return kept;
 }
 return lines;
}

function roundRect(context,x,y,w,h,r){context.beginPath();context.roundRect?context.roundRect(x,y,w,h,r):context.rect(x,y,w,h);}

/** Draw the poster and return it as a PNG data URL. `data` holds url, title, site, section, date, author and cover. */
export async function drawPoster(data,{article=document.querySelector('.rssd-article'),signal}={}){
 const colours=palette(article),heading=article?.querySelector('h1'),titleFont=heading?getComputedStyle(heading).fontFamily:'system-ui,sans-serif';
 const bodyFont=getComputedStyle(article||document.body).fontFamily;
 const cover=await loadImage(data.cover,signal);signal?.throwIfAborted();
 const qr=encodeQr(data.url);
 const measure=document.createElement('canvas').getContext('2d'),inner=WIDTH-PAD*2;
 measure.font=`700 44px ${titleFont}`;const titleLines=wrap(measure,data.title,inner,cover?3:5);
 // At most square, so a portrait cover does not make a poster too tall to read in a chat.
 const coverHeight=cover?Math.round(inner/Math.min(Math.max(cover.naturalWidth/cover.naturalHeight,1),1.78)):0;
 const qrSize=176,footer=qrSize+PAD*2;
 const height=56+34+28+(cover?coverHeight+40:12)+titleLines.length*62+20+34+40+footer;
 const canvas=document.createElement('canvas');canvas.width=WIDTH*SCALE;canvas.height=height*SCALE;
 const c=canvas.getContext('2d');c.scale(SCALE,SCALE);c.textBaseline='alphabetic';
 c.fillStyle=colours.paper;c.fillRect(0,0,WIDTH,height);
 c.fillStyle=colours.accent;c.fillRect(0,0,WIDTH,8);
 let y=56+28;
 c.font=`700 24px ${bodyFont}`;c.fillStyle=colours.accent;
 c.fillText(wrap(c,[data.site,data.section].filter(Boolean).join(' · '),inner,1)[0]||'',PAD,y);
 y+=34;
 if(cover){
  c.save();roundRect(c,PAD,y,inner,coverHeight,12);c.clip();
  const ratio=cover.naturalWidth/cover.naturalHeight,boxRatio=inner/coverHeight;
  let sw=cover.naturalWidth,sh=cover.naturalHeight,sx=0,sy=0;
  if(ratio>boxRatio){sw=sh*boxRatio;sx=(cover.naturalWidth-sw)/2;}else{sh=sw/boxRatio;sy=(cover.naturalHeight-sh)*.35;}
  c.drawImage(cover,sx,sy,sw,sh,PAD,y,inner,coverHeight);c.restore();
  y+=coverHeight+40;
 }else y+=12;
 c.font=`700 44px ${titleFont}`;c.fillStyle=colours.ink;
 for(const line of titleLines){y+=48;c.fillText(line,PAD,y);y+=14;}
 y+=20;
 c.font=`400 24px ${bodyFont}`;c.fillStyle=colours.muted;
 const meta=[data.author,data.date].filter(Boolean).join(' · ');if(meta){y+=26;c.fillText(wrap(c,meta,inner,1)[0],PAD,y);}
 y+=40;
 c.fillStyle=colours.muted;c.globalAlpha=.35;c.fillRect(PAD,y,inner,1);c.globalAlpha=1;
 // The QR code always dark on white, with its quiet zone, so any phone can read it.
 const qrTop=y+PAD,qrLeft=WIDTH-PAD-qrSize;
 c.fillStyle='#ffffff';roundRect(c,qrLeft,qrTop,qrSize,qrSize,8);c.fill();
 // Whole device pixels per module, centred in the white square, so no seams appear between modules.
 const cell=Math.floor(qrSize*SCALE/(qr.size+8)),offset=Math.round((qrSize*SCALE-cell*qr.size)/2);
 c.save();c.setTransform(1,0,0,1,0,0);c.fillStyle='#111111';
 for(let my=0;my<qr.size;my++)for(let mx=0;mx<qr.size;mx++)if(qr.dark(mx,my))c.fillRect(Math.round(qrLeft*SCALE)+offset+mx*cell,Math.round(qrTop*SCALE)+offset+my*cell,cell,cell);
 c.restore();
 const textWidth=qrLeft-PAD-24;let ty=qrTop+56;
 c.font=`700 28px ${bodyFont}`;c.fillStyle=colours.ink;c.fillText(wrap(c,data.locale==='en'?'Scan to read':'长按识别二维码',textWidth,1)[0],PAD,ty);
 ty+=42;c.font=`400 22px ${bodyFont}`;c.fillStyle=colours.muted;c.fillText(wrap(c,data.locale==='en'?'Read the full page':'阅读全文',textWidth,1)[0],PAD,ty);
 ty+=40;c.font=`400 20px ${bodyFont}`;c.fillText(wrap(c,new URL(data.url).host,textWidth,1)[0],PAD,ty);
 return canvas.toDataURL('image/png');
}
