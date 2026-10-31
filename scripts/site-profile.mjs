// Isomorphic identity; native bootstrap runs before importing the workbench UI.
import profiles from '../sites/profiles.json' with {type:'json'};
import {refreshSiteBrand} from '../contracts/site-branding.mjs';
export let ACTIVE_SITE=refreshSiteBrand(globalThis.__SCHOLAY_SITE||(typeof process!=='undefined'&&process.env?.SCHOLAY_SITE_JSON?JSON.parse(process.env.SCHOLAY_SITE_JSON):profiles[0]));

const listeners=new Set();
export function onActiveSiteChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
export function setActiveSite(site){
  ACTIVE_SITE=refreshSiteBrand(site);
  globalThis.__SCHOLAY_SITE=ACTIVE_SITE;
  for(const listener of listeners)listener();
}
