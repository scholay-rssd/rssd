"""Fixed, isolated JATS structure check; not a truth or copyright opinion."""
import json
import re
import sys
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit('}', 1)[-1]


def main(req):
    text, rule = req['text'], req['rule']
    # Strip only the known NCBI article-set DTD; never pass a DTD to the parser.
    cleaned = re.sub(r'^\s*<\?xml\s+version=["\']1\.0["\'](?:\s+encoding=["\']UTF-8["\'])?\s*\?>', '', text, count=1, flags=re.I)
    cleaned = re.sub(r'^\s*<!DOCTYPE\s+pmc-articleset\s+PUBLIC\s+"-//NLM//DTD ARTICLE SET 2\.0//EN"\s+"https://dtd\.nlm\.nih\.gov/ncbi/pmc/articleset/nlm-articleset-2\.0\.dtd"\s*>', '', cleaned, count=1)
    if '<!' in cleaned or '<?' in cleaned:
        return {'ok': False, 'reason': 'unsupported XML declaration or markup'}
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return {'ok': False, 'reason': 'invalid XML'}
    if local(root.tag) == 'pmc-articleset':
        if len(root) != 1 or local(root[0].tag) != 'article':
            return {'ok': False, 'reason': 'article set is ambiguous'}
        root = root[0]
    if local(root.tag) != 'article':
        return {'ok': False, 'reason': 'not a JATS article'}
    front = next((n for n in root if local(n.tag) == 'front'), None)
    body = next((n for n in root if local(n.tag) == 'body'), None)
    meta = next((n for n in front or [] if local(n.tag) == 'article-meta'), None)
    if meta is None or body is None:
        return {'ok': False, 'reason': 'article metadata or body missing'}
    ids = [n.text or '' for n in meta if local(n.tag) == 'article-id' and n.get('pub-id-type') == rule['idType']]
    if ids != [rule['articleId']]:
        return {'ok': False, 'reason': 'article identifier does not match'}
    permissions = [n for n in meta if local(n.tag) == 'permissions']
    licenses = [n for p in permissions for n in p if local(n.tag) == 'license']
    urls = []
    for n in licenses:
        if n.get('{http://www.w3.org/1999/xlink}href'):
            urls.append(n.get('{http://www.w3.org/1999/xlink}href'))
        for ref in n:
            if ref.tag == '{http://www.niso.org/schemas/ali/1.0/}license_ref' and ref.get('content-type') == 'ccbylicense':
                urls.append((ref.text or '').strip())
    if len(urls) != 1 or urls[0] not in rule['licenseUrls']:
        return {'ok': False, 'reason': 'explicit approved license is missing or ambiguous'}
    sections = [n for n in body if local(n.tag) == 'sec']
    if 'requiredSectionTitles' in rule:
        names = [''.join(t.itertext()).strip() if (t := next((c for c in n if local(c.tag) == 'title'), None)) is not None else '' for n in sections]
        required = rule['requiredSectionTitles']
    else:
        names = [n.get('sec-type', '').lower() for n in sections]
        required = rule['requiredSections']
    if any(names.count(x) != 1 for x in required):
        return {'ok': False, 'reason': 'required article sections missing or ambiguous'}
    found = dict(zip(names, sections))
    if any(len(' '.join(found[x].itertext()).strip()) < rule['minSectionCharacters'] for x in required):
        return {'ok': False, 'reason': 'article sections too short'}
    # Only quote literal text from a paragraph, never synthesized markup.
    quote = next((n.text.strip() for s in sections for n in s.iter() if local(n.tag) == 'p' and n.text and 20 <= len(n.text.strip()) <= 1000 and n.text.strip() in text), None)
    if not quote:
        return {'ok': False, 'reason': 'no directly attributable paragraph'}
    return {'ok': True, 'quote': quote, 'licenseUrl': urls[0]}


try:
    print(json.dumps(main(json.load(sys.stdin)), separators=(',', ':')))
except (KeyError, TypeError, ValueError):
    print(json.dumps({'ok': False, 'reason': 'invalid verification input'}))
