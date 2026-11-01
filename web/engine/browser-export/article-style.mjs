import {fonts} from './styles.mjs';

// The same scoped typography is used by the live article and its portable copy.
// No selectors escape the article into the site's navigation or homepage.
export function articleStyles(t,scope='.rssd-article'){
 const s=scope,accent=t.accent,heading={
  rule:`border-top:3px solid ${accent};padding-top:16px`,
  quiet:`border:0;padding:0;font-family:${fonts.serif};font-weight:600`,
  double:`border-bottom:3px double ${accent}77;padding-bottom:12px`,
  seal:`border-left:2px solid ${accent};padding-left:16px;font-family:${fonts.serif}`,
  underline:`border-bottom:2px solid ${accent};padding-bottom:12px`,
  rail:`border-left:4px solid ${accent};padding-left:14px`,
  open:'border:0;padding:0;letter-spacing:.04em;font-weight:500',
 }[t.heading]||`border-bottom:2px solid ${accent};padding-bottom:12px`;
 return `
${s}{box-sizing:border-box;width:100%;max-width:${t.width||680}px;margin:36px auto 80px;padding:36px 32px;background:${t.paper};color:${t.ink};font:${t.bodySize||17}px/${t.lineHeight||1.95} ${fonts[t.family]||fonts.sans};text-align:left;overflow-wrap:anywhere;word-break:normal;border:0;border-radius:0;box-shadow:none}
${s} *{box-sizing:border-box} ${s} .prose,${s} .article-body,${s} .rssd-body{display:block;width:100%;max-width:none;height:auto;margin:0;padding:0;font:inherit;color:inherit;columns:auto;background:transparent}
${s} h1{font-family:inherit;font-size:${t.titleSize||32}px;line-height:1.45;letter-spacing:-.02em;font-weight:700;color:${t.ink};margin:18px 0 24px;padding:0;border:0;text-wrap:pretty}
${s} h2{font-family:inherit;font-size:22px;line-height:1.55;font-weight:700;color:${accent};margin:44px 0 20px;${heading}}
${s} h3{font-family:inherit;font-size:19px;line-height:1.6;font-weight:650;color:${t.ink};margin:30px 0 14px} ${s} h4,${s} h5,${s} h6{font-size:17px;line-height:1.65;margin:26px 0 12px;color:${accent}}
${s} p{font:inherit;color:inherit;margin:0 0 ${t.paragraphGap||22}px} ${s} .lead{font:inherit;color:${t.ink};border-left:2px solid ${accent}55;padding-left:18px;margin:24px 0 32px}
${s} a{color:${accent};text-decoration:underline;text-decoration-color:${accent}55;text-underline-offset:4px;overflow-wrap:anywhere}
${s} strong{font-weight:700;color:${accent}} ${s} em{font-style:italic} ${s} ul,${s} ol{padding-left:1.5em;margin:18px 0 26px} ${s} li{margin:8px 0} ${s} li p{margin:8px 0}
${s} blockquote{margin:28px 0;padding:18px 20px;border:0;border-left:3px solid ${accent};background:${accent}09;color:${t.ink};font-size:1em} ${s} blockquote p:last-child{margin-bottom:0}
${s} img{display:block;max-width:100%;width:auto;height:auto;max-height:none;object-fit:contain;margin:26px auto;border-radius:${t.imageRadius||0}px}
${s} figure{margin:28px 0;padding:0;width:auto} ${s} figure img{margin:0 auto 12px} ${s} figcaption{font:13px/1.8 ${fonts.sans};color:${accent};text-align:center;margin:10px 0 24px}
${s} pre{font:13px/1.8 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;overflow:visible;margin:26px 0;padding:18px;background:${accent}09;color:${t.ink};border:1px solid ${accent}22;border-radius:4px}
${s} code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.86em;background:${accent}0c;color:${accent};padding:2px 4px} ${s} pre code{font-size:inherit;padding:0;background:none;color:inherit}
${s} table{display:table;width:100%;table-layout:fixed;border-collapse:collapse;margin:28px 0;font:14px/1.8 ${fonts.sans}} ${s} th,${s} td{padding:10px 12px;border:1px solid ${accent}44;text-align:left;word-break:normal;overflow-wrap:anywhere} ${s} th{background:${accent}0e;color:${accent};font-weight:650}
${s} hr{border:0;border-top:1px solid ${accent}44;margin:36px 0} ${s} .rssd-byline,${s} .entry-meta,${s} .eyebrow,${s} .muted,${s} .back{font:12px/1.8 ${fonts.sans};color:${accent};letter-spacing:.03em;margin:12px 0 24px}
${s} .record-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;font-size:14px;margin:24px 0} ${s} .record-facts dd{margin:0}
${s} .katex-html{display:none} ${s} .katex-mathml{position:static!important;clip:auto!important;width:auto!important;height:auto!important} ${s} .math-block{display:block;margin:24px 0;overflow:auto}
@media(max-width:600px){${s}{margin:12px auto 72px;padding:24px 18px}${s} h1{font-size:${Math.min(t.titleSize||32,28)}px}${s} table{font-size:12px}${s} th,${s} td{padding:8px 6px}}
`;
}
