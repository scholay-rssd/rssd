// Read configured, explicitly enabled section RSS feeds as untrusted topic
// leads. This module does not create demands or assert editorial facts.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readWorkspaceSources,validateCatalog} from './rss-sources.mjs';
import {fetchPublicText,publicHttpsUrl} from './rssd-topic-public.mjs';

// Embedded to keep the standalone runtime self-contained; Python is invoked
// in isolated mode and never receives credentials or network access.
const parserSource=String.raw`#!/usr/bin/env python3
"""Parse bounded RSS/Atom data from stdin. This helper never accesses the network."""
import html
from html.parser import HTMLParser
import json
import re
import sys
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit('}', 1)[-1].lower() if isinstance(tag, str) else ''


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ('script', 'style', 'noscript'):
            self.skip += 1
        elif tag.lower() in ('p', 'br', 'div', 'li'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag.lower() in ('script', 'style', 'noscript') and self.skip:
            self.skip -= 1
        elif tag.lower() in ('p', 'div', 'li'):
            self.parts.append(' ')

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)


def plain(value, limit):
    parser = Text()
    parser.feed(value or '')
    parser.close()
    value = re.sub(r'\s+', ' ', html.unescape(''.join(parser.parts))).strip()
    return value[:limit]


def first(entry, *names):
    return next((c for c in entry if local(c.tag) in names), None)


def content(node):
    if node is None or local(node.tag) in ('script', 'style', 'noscript'):
        return ''
    return (node.text or '') + ''.join(content(child) + (child.tail or '') for child in node)


def parse_feed(xml, limit):
    if not isinstance(xml, str) or len(xml.encode('utf-8')) > 1024 * 1024:
        raise ValueError('Invalid feed size')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', xml, re.I):
        raise ValueError('Feed document declarations are forbidden')
    root = ET.fromstring(xml)
    tag = local(root.tag)
    if tag == 'rss':
        channel = first(root, 'channel')
        if channel is None:
            raise ValueError('RSS channel missing')
        entries = [x for x in channel if local(x.tag) == 'item']
    elif tag == 'feed':
        entries = [x for x in root if local(x.tag) == 'entry']
    elif tag == 'rdf':
        entries = [x for x in root if local(x.tag) == 'item']
    else:
        raise ValueError('Not an RSS or Atom feed')
    result = []
    for entry in entries[:200]:
        title = plain(content(first(entry, 'title')), 400)
        links = [x for x in entry if local(x.tag) == 'link']
        # Atom "self" and media links are feed resources, not article links.
        links = [x for x in links if not x.get('rel') or x.get('rel') == 'alternate']
        link = next(((x.get('href') or content(x)).strip() for x in links if (x.get('href') or content(x)).strip()), '')
        summary = plain(content(first(entry, 'description', 'summary', 'content', 'encoded')), 3000)
        date = plain(content(first(entry, 'pubdate', 'published', 'updated', 'date')), 100)
        if title and link:
            result.append({'title': title, 'link': link, 'summary': summary, 'publishedAt': date or None})
        if len(result) >= limit:
            break
    return result


def main():
    # The isolated subprocess may inherit a minimal/C locale from the app.
    # Make the JSON wire format independent of that host locale.
    if hasattr(sys.stdin, 'reconfigure'):
        sys.stdin.reconfigure(encoding='utf-8')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    data = json.load(sys.stdin)
    limit = data.get('limit')
    if type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError('Invalid feed entry limit')
    print(json.dumps(parse_feed(data.get('xml'), limit), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Invalid or unsupported feed', file=sys.stderr)
        sys.exit(1)
`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const secretKey=/token|api[-_]?key|secret|password|authorization|signature|session|^auth$|^key$/i;
function publicArticleUrl(value,base){
  let u;try{u=new URL(value,base);}catch{return null;}
  // A fragment is not sent to a server and should not create another identity.
  u.hash='';
  try{publicHttpsUrl(u.href);}catch{return null;}
  if([...u.searchParams.keys()].some(k=>secretKey.test(k)))return null;
  for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key))u.searchParams.delete(key);
  return u.href;
}

/** The caller must supply the trusted repository catalog, site organization,
 * and an explicitly enabled section policy. No aliases are guessed. */
export function configuredSectionFeeds({catalog,organization,policy}){
  validateCatalog(catalog);
  if(!policy||policy.enabled!==true||typeof policy.siteId!=='string'||typeof policy.sectionId!=='string')throw Error('RSS section policy must be explicitly enabled');
  if(!organization||organization.siteId!==policy.siteId||!Array.isArray(organization.sections))throw Error('Site organization does not match RSS policy');
  const sections=organization.sections.filter(s=>s.id===policy.sectionId);
  if(sections.length!==1||typeof sections[0].name!=='string'||!sections[0].name.trim())throw Error('RSS section is unknown or ambiguous');
  const spaces=catalog.workspaces.filter(w=>w.siteId===policy.siteId);
  if(spaces.length!==1)throw Error('RSS workspace is unknown or ambiguous');
  // Empty env deliberately excludes local/authenticated connector origins.
  const sources=readWorkspaceSources(catalog,spaces[0].spaceId,{target:'server',env:{}});
  const name=sections[0].name;
  const folders=sources.folders.filter(f=>f.name===name||f.name.startsWith(name+' · '));
  if(!folders.length)throw Error('No explicit RSS folder mapping for this section');
  const ids=new Set(folders.map(f=>f.id)),eligible=[],skipped=[];
  for(const feed of sources.feeds.filter(f=>ids.has(f.folderId))){
    // Connector-backed feeds, podcasts and non-HTTPS sources need a separate
    // approved adapter; never upgrade a URL or transcribe audio implicitly.
    if(feed.connectorId||feed.sourceType!=='rss'){skipped.push({id:feed.id,reason:'unsupported_source_type'});continue;}
    try{const url=publicHttpsUrl(feed.url);if(url.hash)throw Error();eligible.push({...feed,url:url.href});}
    catch{skipped.push({id:feed.id,reason:'non_public_https'});}
  }
  if(!eligible.length)throw Error('No configured public HTTPS RSS feed for this section');
  return {siteId:policy.siteId,sectionId:policy.sectionId,spaceId:spaces[0].spaceId,revision:sources.revision,folders:folders.map(({id,name})=>({id,name})),feeds:eligible,unavailableCount:sources.unavailable.length,skipped};
}

export async function parseRssFeed(xml,{limit=10,python='python3',timeoutMs=10000,spawnProcess=spawn}={}){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>1024*1024||!Number.isSafeInteger(limit)||limit<1||limit>20||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid RSS parser input');
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(python,['-I','-c',parserSource],{stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
    let output='',settled=false,killTimer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const stop=message=>{if(settled)return;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref?.();finish(Error(message));};
    const timer=setTimeout(()=>stop('RSS parser timed out'),timeoutMs);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(settled)return;output+=chunk;if(output.length>500000)stop('RSS parser output exceeds limit');});
    child.on('error',()=>finish(Error('RSS parser unavailable')));
    child.on('close',code=>{clearTimeout(killTimer);if(settled)return;if(code!==0)return finish(Error('Invalid or unsupported RSS feed'));try{const items=JSON.parse(output);if(!Array.isArray(items)||items.length>limit)throw Error();finish(null,items);}catch{finish(Error('Invalid RSS parser response'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({xml,limit}));
  });
}

/** Bounded and deterministic daily selection. A result is only a lead: the
 * caller must independently read/verify the original article and its rights.
 * No cross-device deduplication or publication is performed here. */
export async function fetchSectionRssLeads({catalog,organization,policy,now=Date.now(),maxFeeds=5,maxPerFeed=8,maxLeads=30,maxAgeDays=90,fetchText=fetchPublicText,parseFeed=parseRssFeed}={}){
  if(!Number.isFinite(now)||!Number.isSafeInteger(maxFeeds)||maxFeeds<1||maxFeeds>10||!Number.isSafeInteger(maxPerFeed)||maxPerFeed<1||maxPerFeed>20||!Number.isSafeInteger(maxLeads)||maxLeads<1||maxLeads>100||!Number.isSafeInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>365)throw Error('Invalid RSS discovery limits');
  if(typeof fetchText!=='function'||typeof parseFeed!=='function')throw Error('RSS discovery dependencies missing');
  const plan=configuredSectionFeeds({catalog,organization,policy});
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const selected=[...plan.feeds].sort((a,b)=>digest(day+':'+policy.siteId+':'+policy.sectionId+':'+a.id).localeCompare(digest(day+':'+policy.siteId+':'+policy.sectionId+':'+b.id))).slice(0,maxFeeds);
  const fetched=await Promise.all(selected.map(async feed=>{
    try{
      const host=new URL(feed.url).hostname;
      const response=await fetchText(feed.url,{proxyMode:'configured-rss',configuredRssHost:host,timeoutMs:12000,maxBytes:1024*1024,maxRedirects:2});
      if(!response?.reachable||response.originalUrl!==feed.url||typeof response.text!=='string'||new URL(response.finalUrl).hostname!==host)throw Error('Feed response mismatch');
      const entries=await parseFeed(response.text,{limit:maxPerFeed});
      if(!Array.isArray(entries)||entries.length>maxPerFeed)throw Error('Invalid parsed feed');
      return {feed,entries};
    }catch{return {feed,failed:true};}
  }));
  const leads=[],seen=new Set();
  for(const result of fetched){
    if(result.failed)continue;
    for(const item of result.entries){
      if(!item||typeof item.title!=='string'||!item.title.trim()||typeof item.link!=='string')continue;
      const url=publicArticleUrl(item.link,result.feed.url);if(!url||seen.has(url))continue;
      const date=Date.parse(item.publishedAt||'');
      if(!Number.isFinite(date)||date>now+300000||now-date>maxAgeDays*86400000)continue;
      seen.add(url);leads.push({sourceId:result.feed.id,sourceTitle:result.feed.title,feedUrl:result.feed.url,title:item.title.trim().slice(0,400),url,summary:typeof item.summary==='string'?item.summary.slice(0,3000):'',publishedAt:new Date(date).toISOString()});
      if(leads.length>=maxLeads)break;
    }
    if(leads.length>=maxLeads)break;
  }
  if(!leads.length)throw Error('No recent public RSS leads could be verified as reachable and parseable');
  return {siteId:plan.siteId,sectionId:plan.sectionId,catalogRevision:plan.revision,fetchedAt:new Date(now).toISOString(),leads,sourceFailures:fetched.filter(x=>x.failed).map(x=>({sourceId:x.feed.id,reason:'unavailable_or_invalid'})),skippedSources:plan.skipped.length,notice:'RSS entries are untrusted leads, not verified claims or publication permission.'};
}
