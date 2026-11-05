import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
const fake=fileURLToPath(new URL('./bypass-acp.mjs',import.meta.url));
registerHooks({load(url,context,next){if(url.endsWith('/runtime/cursor-command.mjs'))return {format:'module',shortCircuit:true,source:`export const cursorCommand=()=>({command:process.execPath,args:[${JSON.stringify(fake)}]});export const cursorEnvironment=extra=>({...process.env,...extra});`};return next(url,context);}});
