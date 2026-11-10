import MarkdownIt from 'markdown-it';

// Automated publishing uses an intentionally narrow, verifiable contract:
// every declared source must have its public URL in a final references
// section. This never changes the manuscript or its private notebook data.
const markdown = new MarkdownIt({html:false, linkify:true});
const headings = new Set(['参考文献','参考资料','资料来源','references','sources']);
const tracking = /^(?:utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i;

function canonicalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('来源地址无效，稿件已保留'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('来源地址无效，稿件已保留');
  if ([...url.searchParams.keys()].some(key => tracking.test(key))) throw Error('来源链接包含追踪参数，稿件已保留');
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

export function verifyAutomatedReferences(edition) {
  const notebook = edition?.metadata?.notebook;
  if (!notebook || !Array.isArray(notebook.sources) || !notebook.sources.length || !Array.isArray(notebook.blocks) || typeof edition.bodyMarkdown !== 'string') {
    throw Error('稿件缺少结构化来源或正文，已保留');
  }
  const sources = new Map();
  for (const source of notebook.sources) {
    if (!source || typeof source.id !== 'string' || !source.id || sources.has(source.id)) throw Error('来源标识无效或重复，稿件已保留');
    sources.set(source.id, canonicalUrl(source.url));
  }
  for (const block of notebook.blocks) {
    if (!Array.isArray(block.sourceIds || [])) throw Error('正文来源标识无效，稿件已保留');
    for (const id of block.sourceIds || []) if (!sources.has(id)) throw Error('正文引用的来源不存在，稿件已保留');
  }
  if (!Array.isArray(edition.sources) || edition.sources.length !== notebook.sources.length) throw Error('来源记录与正文不一致，稿件已保留');
  const declared = edition.sources.map(source => canonicalUrl(source?.url));
  if (declared.some((url, index) => url !== [...sources.values()][index])) throw Error('来源记录与正文不一致，稿件已保留');
  const tokens = markdown.parse(edition.bodyMarkdown, {});
  let inReferences = false, referenceLevel = 0, found = false;
  const links = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1)), title = (tokens[index+1]?.content || '').trim().toLowerCase();
      if (inReferences && level <= referenceLevel) inReferences = false;
      if (headings.has(title)) { inReferences = true; referenceLevel = level; found = true; }
    }
    if (token.type !== 'inline') continue;
    for (const child of token.children || []) {
      if (child.type !== 'link_open') continue;
      const href = child.attrGet('href');
      if (!href || !/^https?:/i.test(href)) continue;
      const url = canonicalUrl(href);
      if (inReferences) links.add(url);
    }
  }
  if (!found || declared.some(url => !links.has(url))) throw Error('文末参考文献未覆盖全部来源，稿件已保留');
  const sourceUrls = new Set(declared);
  if ([...links].some(url => !sourceUrls.has(url))) throw Error('文末参考文献包含未登记的来源，稿件已保留');
  return {ok:true, sourceCount:declared.length};
}
