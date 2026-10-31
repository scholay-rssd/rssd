// The first unified release needs a complete home before Nginx adopts its root.
// Preserve the current published content and overlay only the validated home.
import {cp,realpath,lstat} from 'node:fs/promises';import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {profiles} from './site-config.mjs';import {themeForSite} from '../web/themes/registry.mjs';
import {copyThemeHomepage} from '../web/engine/theme-homepage.mjs';
export async function prepareThemeBridge({id,previous,target,source=resolve('.')}){
 const site=profiles.find(s=>s.id===id);
 if(!site||!themeForSite(site)?.homepage)throw Error('Unknown homepage site');
 try{await lstat(target);throw Error('Bridge target already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 // current is a symlink. Copy its directory, never the pointer itself: writing
 // through a copied symlink would mutate the rollback release.
 await cp(await realpath(previous),target,{recursive:true});
 await copyThemeHomepage({source,target,site,theme:themeForSite(site)});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [id,previous,target]=process.argv.slice(2);await prepareThemeBridge({id,previous,target});
}
