import {fonts} from './styles.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function articleHeading(model){
 const meta=[model.author,model.date].filter(Boolean).map(escape).join(' · ');
 return `<header class="rssd-article-heading"><p class="rssd-kicker">${[model.site.name,model.sectionName].filter(Boolean).map(escape).join(' / ')}</p><h1>${escape(model.title)}</h1>${meta?`<p class="rssd-byline">${meta}</p>`:''}</header>`;
}

// Explicit light and dark palettes belong to each authored category. Portable
// output fixes color-scheme to light; the live page inherits the user's choice.
export function articleStyles(t,scope='.rssd-article',{live=false}={}){
 const s=scope,d=t.dark||{paper:'#202522',canvas:'#171c19',ink:'#e5ebe7',muted:'#b1bbb4',accent:'#a4cdbb'};
 const c=(light,dark)=>live?`light-dark(${light},${dark})`:light;
 const variables=`--read-paper:${c(t.paper,d.paper)};--read-canvas:${c(t.canvas||t.paper,d.canvas)};--read-ink:${c(t.ink,d.ink)};--read-muted:${c(t.muted||t.ink,d.muted)};--read-accent:${c(t.accent,d.accent)};--read-line:color-mix(in srgb,var(--read-ink) 17%,var(--read-paper));--read-soft:color-mix(in srgb,var(--read-accent) 6%,var(--read-paper));`;
 const accent='var(--read-accent)',ink='var(--read-ink)',paper='var(--read-paper)',muted='var(--read-muted)',line='var(--read-line)',soft='var(--read-soft)';
 const heading={rule:`border-top:2px solid ${line};padding-top:22px`,quiet:`border:0;padding:0;font-family:${fonts.serif};font-weight:650`,double:`border-bottom:3px double ${line};padding-bottom:14px`,seal:`border-left:2px solid ${accent};padding-left:16px;font-family:${fonts.serif}`,underline:`border-bottom:1px solid ${line};padding-bottom:14px`,rail:`border-left:3px solid ${accent};padding-left:16px`,open:'border:0;padding:0;letter-spacing:.025em;font-weight:650'}[t.heading]||'';
 const header={
  rule:`border-top:3px solid ${accent};border-bottom:1px solid ${line};padding:24px 0 30px`,
  grid:`border-top:1px solid ${line};border-bottom:1px solid ${line};padding:24px 0 28px`,
  band:`border-left:4px solid ${accent};padding:8px 0 8px 24px`,
  double:`border-top:4px double ${accent};border-bottom:1px solid ${line};padding:26px 0 28px`,
  rail:`border-bottom:1px solid ${line};padding:0 0 26px`,
  quiet:`border:0;padding:0 0 22px`,
  pill:`border-bottom:1px solid ${line};padding:0 0 28px`,
  seal:`border-top:1px solid ${accent};border-bottom:1px solid ${line};padding:26px 0 30px`,
 }[t.header]||'';
 return `
${live?`:root:has(.rssd-article){color-scheme:light dark}:root[data-theme=light]:has(.rssd-article){color-scheme:light}:root[data-theme=dark]:has(.rssd-article){color-scheme:dark}
body:has(.rssd-article){${variables}color-scheme:inherit;background:var(--read-canvas);color:${ink}}
body:has(.rssd-article) .site-header{background:var(--read-canvas);color:${ink};border-color:${line}}
body:has(.rssd-article) .site-header :is(a,p,small,span){color:inherit}
body:has(.rssd-article) .site-header nav a.active{color:${accent}}
body:is([data-site=legis],[data-site=personal]):has(.rssd-article) .site-header nav a.active{color:${d.accent}}
html[data-theme=dark] body:has(.rssd-article) .app-bar-brand img{filter:invert(1)}
@media(prefers-color-scheme:dark){html:not([data-theme=light]) body:has(.rssd-article) .app-bar-brand img{filter:invert(1)}}
body:has(.rssd-article) .language-switch{background:${paper};color:${ink};border-color:${line}}
body:has(.rssd-article) .site-footer{background:transparent;color:${muted};border-color:${line}}
body:has(.rssd-article) .site-footer a{color:${accent}}
.rssd-reading-nav{display:flex;align-items:center;max-width:1040px;margin:22px auto 0;padding:0 24px;font:13px/1.6 ${fonts.sans}}
.rssd-reading-nav .back{display:inline-flex;align-items:center;min-height:44px;margin:0;padding:8px 0;color:${muted};text-decoration:none;border:0;background:transparent;font:inherit}
.rssd-reading-nav .back:hover{color:${accent};text-decoration:underline;text-underline-offset:5px}
.rssd-reading-nav .back:focus-visible{outline:2px solid ${accent};outline-offset:4px}
body:has(.rssd-article) .reading-layout{display:block!important;max-width:100%;margin:0 auto}
body:has(.rssd-article) .breadcrumbs{display:none}
` : ''}
${s}{${variables}box-sizing:border-box;display:block;width:100%;max-width:${t.width||760}px;margin:20px auto 80px;padding:${t.padding||48}px;background:${paper};color:${ink};font:${t.bodySize||17}px/${t.lineHeight||1.95} ${fonts[t.family]||fonts.sans};text-align:left;overflow-wrap:anywhere;word-break:normal;border:1px solid ${line};border-radius:${t.radius||0}px;box-shadow:none;letter-spacing:.015em;${live?'':'color-scheme:light;'}}
${s} *{box-sizing:border-box} ${s} .prose,${s} .article-body,${s} .rssd-body{display:block;width:100%;max-width:none;height:auto;margin:0;padding:0;font:inherit;color:inherit;columns:auto;background:transparent}
${s} .rssd-article-heading{display:block;position:static;width:auto;min-height:0;margin:0 0 ${t.headerGap||34}px;background:transparent;color:${ink};text-align:left;${header}}
${s} .rssd-kicker{display:block;font:650 11px/1.8 ${fonts.sans};letter-spacing:.13em;color:${accent};margin:0 0 18px;text-transform:uppercase}
${s} h1{max-width:none;font-family:${fonts[t.titleFamily||t.family]||fonts.sans};font-size:${t.titleSize||38}px;line-height:1.45;letter-spacing:-.025em;font-weight:700;color:${ink};margin:0 0 20px;padding:0;border:0;text-wrap:pretty}
${s} h2{font-family:${fonts[t.titleFamily||t.family]||fonts.sans};font-size:24px;line-height:1.6;font-weight:700;color:${ink};margin:46px 0 22px;scroll-margin-top:90px;${heading}}
${s} h3{font-family:inherit;font-size:20px;line-height:1.65;font-weight:650;color:${ink};margin:32px 0 16px} ${s} h4,${s} h5,${s} h6{font-size:17px;line-height:1.7;margin:28px 0 14px;color:${accent}}
${s} p{font:inherit;color:inherit;margin:0 0 ${t.paragraphGap||26}px} ${s} .lead{font:inherit;color:${ink};border-left:2px solid ${line};padding-left:20px;margin:26px 0 34px}
${s} a{color:${accent};text-decoration:underline;text-decoration-color:color-mix(in srgb,${accent} 40%,transparent);text-underline-offset:4px;overflow-wrap:anywhere}
${s} a:hover{text-decoration-color:currentColor} ${s} a:focus-visible{outline:2px solid ${accent};outline-offset:3px}
${s} strong{font-weight:700;color:${ink}} ${s} em{font-style:italic} ${s} ul,${s} ol{padding-left:1.5em;margin:20px 0 28px} ${s} li{margin:10px 0;padding-left:.2em} ${s} li::marker{color:${accent}} ${s} li p{margin:10px 0}
${s} blockquote{margin:30px 0;padding:22px 24px;border:0;border-left:3px solid ${accent};background:${soft};color:${ink};font-size:1em;border-radius:0 ${Math.min(t.radius||0,8)}px ${Math.min(t.radius||0,8)}px 0} ${s} blockquote p:last-child{margin-bottom:0}
${s} img{display:block;max-width:100%;width:auto;height:auto;max-height:none;object-fit:contain;margin:30px auto;border-radius:${t.imageRadius||0}px}
${s} figure{margin:32px 0;padding:0;width:auto} ${s} figure img{margin:0 auto 14px} ${s} figcaption{font:13px/1.8 ${fonts.sans};color:${muted};text-align:center;margin:12px 0 28px}
${s} pre{font:13px/1.85 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;overflow:visible;margin:28px 0;padding:22px;background:${soft};color:${ink};border:1px solid ${line};border-radius:6px}
${s} code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.86em;background:${soft};color:${accent};padding:2px 5px;border-radius:3px} ${s} pre code{font-size:inherit;padding:0;background:none;color:inherit}
${s} table{display:table;width:100%;table-layout:fixed;border-collapse:collapse;margin:30px 0;font:14px/1.85 ${fonts.sans}} ${s} th,${s} td{padding:13px 14px;border:1px solid ${line};text-align:left;word-break:normal;overflow-wrap:anywhere;color:${ink}} ${s} th{background:${soft};font-weight:650} ${s} tbody tr:nth-child(even){background:color-mix(in srgb,${soft} 45%,${paper})}
${s} hr{border:0;border-top:1px solid ${line};margin:40px 0} ${s} .rssd-byline,${s} .entry-meta,${s} .eyebrow,${s} .muted{font:12px/1.9 ${fonts.sans};color:${muted};letter-spacing:.03em;margin:12px 0 26px}
${s} .rssd-article-heading .rssd-byline{margin:0}
${s} .record-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px;font:14px/1.8 ${fonts.sans};padding:20px;background:${soft};border:1px solid ${line};margin:28px 0} ${s} .record-facts dt{font-size:12px;color:${muted}} ${s} .record-facts dd{margin:4px 0 0}
${s} .article-endnotes{font:14px/1.9 ${fonts.sans};color:${muted};margin-top:44px;padding-top:24px;border-top:1px solid ${line}} ${s} .article-endnotes h2{font:650 18px/1.6 ${fonts.sans};border:0;padding:0;margin:0 0 18px}
${s} .sources{background:${soft};border:1px solid ${line};padding:20px;margin:28px 0;color:${muted}}
${s} .katex-html{display:none} ${s} .katex-mathml{position:static!important;clip:auto!important;width:auto!important;height:auto!important} ${s} .math-block{display:block;margin:26px 0;overflow:auto}
${['pill'].includes(t.header)?`${s} .rssd-kicker{display:table;background:${soft};padding:5px 12px;border-radius:20px;letter-spacing:.06em}`:''}
${t.identity==='laboratory'||t.identity==='technical'?`${s} .rssd-kicker{font-family:ui-monospace,SFMono-Regular,${fonts.sans};letter-spacing:.05em}${s} pre{background:${c('#edf3f2','#101c19')};border-color:${line}}`:''}
${t.identity==='classical'?`${s} .rssd-kicker{display:table;border:1px solid ${accent};padding:5px 10px;letter-spacing:.18em}${s} blockquote{font-family:${fonts.serif};border-left:1px solid ${accent};background:transparent}`:''}
${t.identity==='legal'?`${s} .rssd-kicker{letter-spacing:.16em}${s} blockquote{border-left:2px solid ${accent};font-family:${fonts.serif}}`:''}
${t.identity==='journal'?`${s} .rssd-kicker{margin-bottom:22px}${s} .rssd-article-heading{border-bottom:1px solid ${line};padding-bottom:30px}`:''}
@media(max-width:600px){${s}{margin:12px auto 56px;padding:26px 20px;border-left:0;border-right:0;border-radius:0;font-size:${Math.min(t.bodySize||17,17)}px}${s} h1{font-size:${Math.min(t.titleSize||38,29)}px;line-height:1.5}${s} h2{font-size:22px;margin-top:36px}${s} .rssd-article-heading{margin-bottom:28px}${s} table{font-size:12px}${s} th,${s} td{padding:9px 7px}${s} pre{padding:16px}${s} blockquote{padding:18px}${live?'.rssd-reading-nav{margin-top:10px;padding:0 8px}':''}}
`;
}
