import {mkdir,cp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicFiles} from '../web/themes/academic/render.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function packageWebEngine(target,{academic=false}={}){
 const paths=['web/guestbook','web/modules','web/engine','web/themes/registry.mjs','web/themes/content.css','web/themes/standing-pages.css','web/themes/structures.mjs','web/themes/structures.css','web/themes/journal',...['render.mjs','content.mjs','build-seo.mjs','archive-pages.mjs','calendar-data.mjs','entry-hints.mjs','front-page.mjs'].map(x=>'web/themes/academic/'+x)];
 if(academic)paths.push(...publicFiles.map(x=>'web/themes/academic/public/'+x),'web/themes/academic/public/fonts');
 for(const path of paths){await mkdir(dirname(join(target,path)),{recursive:true});await cp(join(root,path),join(target,path),{recursive:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await packageWebEngine(process.argv[2],{academic:process.argv.includes('--academic')});
