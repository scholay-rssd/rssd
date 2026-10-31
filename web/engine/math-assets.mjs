import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {mathAssetBase} from './article-math.mjs';

const dist=new URL('./',import.meta.resolve('katex'));
const layout=`
.math-inline,.math-block{color:inherit;letter-spacing:normal;word-spacing:normal;white-space:normal;text-indent:0}
.math-block{display:block;max-width:100%;overflow-x:auto;overflow-y:hidden;margin:1em 0;padding:.35em .15em;overscroll-behavior-x:contain}
.math-block:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.math-block .katex-display{margin:0;text-align:center}
.math-block .katex-display>.katex{display:inline-block;min-width:100%;text-align:center}
.math-inline .katex,.math-block .katex{font-size:1.08em;text-rendering:auto}
.math-error{color:inherit!important;background:transparent!important;font-size:.9em;white-space:pre-wrap;overflow-wrap:anywhere}
`;
// Explicit public allowlist: no JS runtime, source maps, TeX sources or packages.
// WOFF2 is sufficient for the browsers supported by our themes.
export async function writeMathAssets(target){
  const base=mathAssetBase.slice(1),written=[];
  await mkdir(join(target,base,'fonts'),{recursive:true});
  const write=async(path,bytes)=>{await writeFile(join(target,base,path),bytes);written.push(base+'/'+path);};
  const css=(await readFile(new URL('katex.min.css',dist),'utf8'))
    .replace(/,url\([^)]*\) format\("(?:woff|truetype)"\)/g,'');
  await write('math.css',css+layout);
  for(const file of (await readdir(new URL('fonts/',dist))).filter(file=>file.endsWith('.woff2')).sort())await write('fonts/'+file,await readFile(new URL('fonts/'+file,dist)));
  await write('LICENSE.txt',await readFile(new URL('../LICENSE',dist)));
  return written;
}
// The calendar inserts already-rendered HTML on navigation. Its tiny loader only
// adds the stylesheet when a formula is actually displayed, once per document.
export const mathStyleLoader=`export function ensureMathStyles(root=document){
  if(!root.querySelector('.math-inline,.math-block')||document.querySelector('link[data-math-styles]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='${mathAssetBase}/math.css';link.dataset.mathStyles='';document.head.append(link);
}`;
