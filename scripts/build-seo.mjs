// Compatibility CLI and API for the academic Theme.
import {buildSeoSite} from '../web/themes/academic/build-seo.mjs';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
export * from '../web/themes/academic/build-seo.mjs';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const result=await buildSeoSite();console.log('Generated SEO output: '+result.routes.length+' canonical routes.');}
