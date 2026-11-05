"""Parse bounded NCBI article-set metadata, without loading any DTD/entity."""
import json
import re
import sys
import xml.etree.ElementTree as ET

def local(x):
    return x.rsplit('}', 1)[-1]

def main(text):
    clean = re.sub(r'^\s*<\?xml\s+version=["\']1\.0["\'](?:\s+encoding=["\']UTF-8["\'])?\s*\?>', '', text, count=1, flags=re.I)
    clean = re.sub(r'^\s*<!DOCTYPE\s+pmc-articleset\s+PUBLIC\s+"-//NLM//DTD ARTICLE SET 2\.0//EN"\s+"https://dtd\.nlm\.nih\.gov/ncbi/pmc/articleset/nlm-articleset-2\.0\.dtd"\s*>', '', clean, count=1)
    if '<!' in clean or '<?' in clean:
        raise ValueError('untrusted declaration')
    root = ET.fromstring(clean)
    if local(root.tag) != 'pmc-articleset' or len(root) != 1 or local(root[0].tag) != 'article':
        raise ValueError('ambiguous article set')
    a = root[0]
    front = next((x for x in a if local(x.tag) == 'front'), None)
    meta = next((x for x in front or [] if local(x.tag) == 'article-meta'), None)
    body = next((x for x in a if local(x.tag) == 'body'), None)
    if meta is None or body is None:
        raise ValueError('missing article metadata or body')
    ids = {k: [] for k in ['pmcid', 'pmid', 'doi']}
    for n in meta:
        if local(n.tag) == 'article-id' and n.get('pub-id-type') in ids:
            ids[n.get('pub-id-type')].append((n.text or '').strip())
    sections = []
    for n in body:
        if local(n.tag) == 'sec':
            title = next((x for x in n if local(x.tag) == 'title'), None)
            if title is not None:
                sections.append(''.join(title.itertext()).strip())
    titles = [x for n in meta if local(n.tag) == 'title-group' for x in n if local(x.tag) == 'article-title']
    if len(titles) != 1:
        raise ValueError('article title missing or ambiguous')
    return {'ids': ids, 'sections': sections, 'title': ''.join(titles[0].itertext()).strip()}

try:
    print(json.dumps(main(json.load(sys.stdin)['text']), separators=(',', ':')))
except (ET.ParseError, KeyError, TypeError, ValueError):
    print(json.dumps({'error': 'unsupported source structure'}))
