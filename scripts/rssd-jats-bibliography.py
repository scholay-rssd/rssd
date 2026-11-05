"""Extract conservative citation metadata from one already-frozen JATS article.

No network access, external DTD/entity loading, model-supplied values, or file
access. Unsupported/ambiguous records return an error instead of guessing.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit('}', 1)[-1]


def children(node, name):
    return [n for n in node if local(n.tag) == name]


def single(node, name):
    values = children(node, name)
    if len(values) != 1:
        raise ValueError('missing or ambiguous ' + name)
    return values[0]


def text(node, limit=1000):
    value = ' '.join(''.join(node.itertext()).split())
    if not value or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError('missing or invalid text')
    return value


def main(raw):
    clean = re.sub(r'^\s*<\?xml\s+version=["\']1\.0["\'](?:\s+encoding=["\']UTF-8["\'])?\s*\?>', '', raw, count=1, flags=re.I)
    clean = re.sub(r'^\s*<!DOCTYPE\s+pmc-articleset\s+PUBLIC\s+"-//NLM//DTD ARTICLE SET 2\.0//EN"\s+"https://dtd\.nlm\.nih\.gov/ncbi/pmc/articleset/nlm-articleset-2\.0\.dtd"\s*>', '', clean, count=1)
    if '<!' in clean or '<?' in clean:
        raise ValueError('unsupported XML declaration')
    root = ET.fromstring(clean)
    if local(root.tag) == 'pmc-articleset':
        if len(root) != 1 or local(root[0].tag) != 'article':
            raise ValueError('ambiguous article set')
        root = root[0]
    if local(root.tag) != 'article':
        raise ValueError('not a JATS article')
    front = single(root, 'front')
    article = single(front, 'article-meta')
    journal = single(front, 'journal-meta')
    title = text(single(single(article, 'title-group'), 'article-title'), 500)
    journal_name = text(single(single(journal, 'journal-title-group'), 'journal-title'), 500)
    author_groups = children(article, 'contrib-group')
    authors = []
    for group in author_groups:
        for contrib in children(group, 'contrib'):
            if contrib.get('contrib-type') != 'author':
                continue
            name = single(contrib, 'name')
            family = text(single(name, 'surname'), 200)
            given = text(single(name, 'given-names'), 200)
            authors.append({'given': given, 'family': family})
    if not authors or len(authors) > 100:
        raise ValueError('missing or excessive authors')
    years = []
    for date in children(article, 'pub-date'):
        for year in children(date, 'year'):
            value = text(year, 4)
            if not re.fullmatch(r'[12][0-9]{3}', value):
                raise ValueError('invalid publication year')
            years.append(value)
    if not years or len(set(years)) != 1:
        raise ValueError('missing or conflicting publication years')
    volume = text(single(article, 'volume'), 60)
    elocations = children(article, 'elocation-id')
    first, last = children(article, 'fpage'), children(article, 'lpage')
    if len(elocations) == 1 and not first and not last:
        location = {'kind': 'article-number', 'value': text(elocations[0], 100)}
    elif not elocations and len(first) == 1 and len(last) == 1:
        location = {'kind': 'page-range', 'first': text(first[0], 40), 'last': text(last[0], 40)}
    else:
        raise ValueError('missing or ambiguous article location')
    dois = [text(n, 220) for n in children(article, 'article-id') if n.get('pub-id-type') == 'doi']
    if len(dois) != 1 or not re.fullmatch(r'10\.[0-9]{4,9}/[A-Za-z0-9._;()/:+-]{1,200}', dois[0]):
        raise ValueError('missing or ambiguous DOI')
    return {'title': title, 'authors': authors, 'year': years[0], 'journal': journal_name,
            'volume': volume, 'location': location, 'doi': dois[0]}


try:
    print(json.dumps(main(json.load(sys.stdin)['text']), ensure_ascii=False, separators=(',', ':')))
except (ET.ParseError, KeyError, TypeError, ValueError):
    print(json.dumps({'error': 'unsupported or ambiguous JATS citation metadata'}))
