// Metadata comes from the visible page, never from a separate keyword inventory.
export function plainText(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (entity, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : entity)
    .replace(/&#x([0-9a-f]+);/gi, (entity, n) => parseInt(n, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(n, 16)) : entity)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name])
    .replace(/\s+/g, ' ').trim();
}

export function descriptionText(title, summary, limit = 200) {
  const heading = plainText(title), text = plainText(summary);
  const result = text.startsWith(heading) ? text : [heading, text].filter(Boolean).join('。');
  const characters = Array.from(result);
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : result;
}

export function pageMetadata({title, route, body, description, site}) {
  let heading = plainText(title);
  if (route === '/' && heading === site.name && site.slogan) heading += '｜' + plainText(site.slogan);
  const documentTitle = heading === site.name || heading.startsWith(site.name + '｜') ? heading : heading + ' · ' + site.name;
  let summary = description;
  if (route === '/') {
    summary = summary || site.description;
  } else if (!summary || summary === site.description) {
    // Skip category/eyebrow labels, and use the first actual explanatory paragraph.
    const paragraphs = [...String(body).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)];
    summary = paragraphs.filter(([, attrs]) => !/\beyebrow\b/.test(attrs))
      .map(([, , text]) => plainText(text)).find(text => text.length >= 12) || site.description;
  }
  const refineIndex = ['metho', 'enter'].includes(site.id);
  // Historical journal pages repeat the home overview; the newer reading
  // directory repeats the archive. Keep each alias on its actual source page.
  const canonicalRoute = refineIndex && route === '/journal/'
    ? (/\bdata-feed-section=/.test(body) ? '/archive/' : '/') : route;
  const emptyListing = refineIndex && /^\/(?:archive(?:\/|$)|calendar\/$)/.test(route)
    && !/<article\b/i.test(body) && /<p\b[^>]*class=["'][^"']*\bempty\b/i.test(body);
  return {
    title: documentTitle,
    description: descriptionText(route === '/' ? site.name : heading, summary),
    canonical: site.origin + canonicalRoute,
    robots: emptyListing ? 'noindex,follow' : 'index,follow,max-image-preview:large',
  };
}

export function listingDescription({title, description, page, pages, items}) {
  const examples = items.slice(0, 2).map(item => plainText(item.title)).filter(Boolean);
  return descriptionText(`${title} · 第 ${page} 页（共 ${pages} 页）`,
    [description, examples.length ? '本页包括：' + examples.join('；') + '。' : '暂无公开内容。'].filter(Boolean).join(' '));
}

// The document title is already rendered as H1 outside the article body.
export const articleBodyHeadings = html => String(html).replace(/<(\/?)h1(\b[^>]*)>/gi, '<$1h2$2>');

export function datedRecordTitle(item, date) {
  const title = plainText(item.title);
  const label = !title || /^\(?untitled\)?$/i.test(title) ? (plainText(item.sourceName) || '科研日程') + '通知' : title;
  return date ? label + '（' + date + '）' : label;
}
