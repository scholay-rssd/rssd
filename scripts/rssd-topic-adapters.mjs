import {ARTICLE_WRITING_INSTRUCTIONS,ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {authoritativeHosts,fetchMethoCatalog,fetchAuthoritativeSource} from './rssd-topic-public.mjs';
import {codexTopicGenerator,codexTopicJudge,codexSourceJudge} from './rssd-topic-codex.mjs';
import {fetchMethoSourceSeeds} from './rssd-topic-seeds.mjs';
import {fetchPubmedFallback} from './rssd-topic-pubmed-fallback.mjs';

// `home` is reserved for the caller's private scheduler state; it is not read
// by the model and no center credentials are passed to any subprocess.
export async function createTopicAdapters({home,fetchCatalog=fetchMethoCatalog,fetchSource=fetchAuthoritativeSource,fetchSeeds=fetchMethoSourceSeeds,sourceJudge=codexSourceJudge()}={}) {
  if (typeof home!=='string'||!home) throw Error('Private topic state directory is required');
  const catalog=await fetchCatalog();
  const verifySource=async(source,topic)=>{
    let pageText;
    try{
      const evidence=await fetchSource(source.url);
      if (!evidence?.reachable || evidence.originalUrl!==source.url || typeof evidence.text!=='string') throw Error('Source could not be read');
      pageText=evidence.text.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,30000);
    }catch(error){
      if(error.status!==203||!/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/[1-9]\d{0,11}\/$/.test(source.url))throw error;
      const seed=topic?.sourceEvidence?.find(item=>item.url===source.url);
      const record=await fetchPubmedFallback(source.url,{httpStatus:error.status,expectedTitle:seed?.title,fetchSource});
      pageText=record.title+'\n\n'+record.abstract;
    }
    if(pageText.length<100)throw Error('Source text is insufficient to verify');
    const verdict=await sourceJudge({source,topic,pageText});
    return {url:source.url,verified:verdict?.primarySource===true&&verdict?.supportsTopic===true&&verdict?.confidence==='high'};
  };
  const generateWithCodex=codexTopicGenerator({writingPolicy:ARTICLE_WRITING_POLICY+'\n'+ARTICLE_WRITING_INSTRUCTIONS,allowedHosts:authoritativeHosts});
  const generate=async args=>generateWithCodex({...args,sourceSeeds:await fetchSeeds({existingTitles:args.existingTitles,count:args.count})});
  return {catalog,refreshCatalog:fetchCatalog,generate,judge:codexTopicJudge(),verifySource};
}
