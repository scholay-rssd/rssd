import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validatePublicMedia} from '../../contracts/published-content.mjs';
// Compatibility adapter for the already-authored public portfolio catalog.
// Parse its JSON literal; never execute homepage JavaScript or duplicate its
// assets. The host calls this only after the homepage manifest is verified.
export async function portfolioMedia(target,homepage){
  const groups=await portfolioCollections(target,homepage),media=[];
  for(const group of groups){
    for(const item of group.items){
      media.push({id:'portfolio:'+group.id+':'+item.src,src:'/'+item.src,alt:item.name,group:group.name,collectionId:'portfolio:'+group.id,href:'/#moods',width:item.width,height:item.height});
    }
  }
  return validatePublicMedia(media);
}
export async function portfolioCollections(target,homepage){
  if(!homepage?.hashes['catalog.js'])return [];
  const text=await readFile(join(target,'catalog.js'),'utf8');
  const match=/^\s*const stickerCollections = (\[[\s\S]*\]);\s*$/.exec(text);
  if(!match)throw Error('Unsupported portfolio catalog');
  const groups=JSON.parse(match[1]);
  if(!Array.isArray(groups))throw Error('Invalid portfolio catalog');
  for(const group of groups){
    if(!/^[a-z0-9-]+$/.test(group.id)||!Array.isArray(group.items))throw Error('Invalid portfolio collection');
    for(const item of group.items){
      if(!/^assets\/[a-zA-Z0-9/_-]+\.(png|jpg|webp|gif)$/.test(item.src)||!homepage.hashes[item.src])throw Error('Portfolio image missing from homepage artifact');
    }
  }
  return groups;
}
