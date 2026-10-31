// Site-owned presentation settings. No executable paths or remote plugins.
export function validateDisplay(input){
  if(!input||input.version!==1||!input.modules||typeof input.modules!=='object'||Array.isArray(input.modules))throw Error('Invalid display configuration');
  if(Object.keys(input).some(k=>!['version','modules'].includes(k)))throw Error('Unknown display setting');
  const modules={};
  for(const [id,options] of Object.entries(input.modules)){
    if(!['calendar','gallery','graph','showcase','roadmap'].includes(id))throw Error('Unknown display module: '+id);
    if(!options||typeof options!=='object'||Array.isArray(options)||typeof options.enabled!=='boolean'||Object.keys(options).some(k=>!['enabled','collections',...(id==='gallery'?['columns']:[])].includes(k)))throw Error('Invalid display module options: '+id);
    if(options.collections!==undefined&&(!Array.isArray(options.collections)||options.collections.some(x=>typeof x!=='string'||!x)||new Set(options.collections).size!==options.collections.length))throw Error('Invalid module collections');
    if(options.columns!==undefined&&(!Number.isInteger(options.columns)||options.columns<2||options.columns>5))throw Error('Gallery columns must be 2–5');
    modules[id]={...options,...(options.collections?{collections:[...options.collections]}:{})};
  }
  return {version:1,modules};
}
