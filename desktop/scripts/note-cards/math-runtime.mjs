import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {mathSegments} from '../../../scripts/article-math.mjs';
const require=createRequire(import.meta.url);
function dependency(){try{return {katex:require('katex'),entry:require.resolve('katex')};}catch{const runtime=createRequire(new URL('../../runtime/package.json',import.meta.url));return {katex:runtime('katex'),entry:runtime.resolve('katex')};}}
let assets;
export async function prepareNoteMath(page){
 const {katex,entry}=dependency();
 assets??=(async()=>{
  const dist=dirname(entry);let css=await readFile(join(dist,'katex.min.css'),'utf8');
  const faces=[...css.matchAll(/src:([^;}]+)(?=[;}])/g)];if(!faces.length)throw Error('公式字体资源不完整');
  for(const match of faces){
   const name=match[1].match(/url\(fonts\/([\w.-]+\.woff2)\)/)?.[1];
   if(!name)throw Error('公式字体资源不完整');
   const font=await readFile(join(dist,'fonts',name));
   css=css.replace(match[0],`src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2')`);
  }
  return css;
 })();
 await page.addStyleTag({content:await assets});
 // Only shipped code and bundled fonts enter the isolated page. Article HTML
 // is sanitized separately; no CDN, third-party script or remote font is used.
 await page.evaluate('globalThis.__noteMathSegments = ('+mathSegments.toString()+')');
 await page.exposeFunction('__noteMathRender',(tex,display)=>{
  if(typeof tex!=='string'||tex.length>12000)throw Error('公式过长');
  if(/\\(?:href|url|includegraphics|html\w*|def|gdef|edef|xdef|newcommand|renewcommand)\b/.test(tex))throw Error('公式包含不支持的外部链接、样式或宏定义');
  try{return katex.renderToString(tex,{displayMode:display===true,output:'html',throwOnError:true,trust:false,maxExpand:500,maxSize:20,strict:'ignore',macros:{}});}
  catch(error){throw Error('公式无法排版：'+String(error.message).slice(0,220));}
 });
}
