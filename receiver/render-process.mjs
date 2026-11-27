// Renders one site release in its own process, so the receiver that started it keeps answering requests and
// gets the renderer's memory back when the render ends. Receives the arguments of `buildSiteRelease` once and
// answers with its manifest or its error message.
import {buildSiteRelease} from '../web/engine/render-site.mjs';

process.once('message',async args=>{
  let reply;
  try{reply={manifest:await buildSiteRelease(args)};}
  catch(error){reply={error:String(error?.message||error),code:error?.code};}
  process.send(reply,()=>process.exit(reply.error?1:0));
});
