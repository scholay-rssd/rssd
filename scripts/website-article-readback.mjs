import {renderArticle,renderArticleParts} from './article-format.mjs';
import {renderArticle as renderPublicArticle,renderArticleParts as renderPublicParts} from '../web/engine/article-math.mjs';

// Journal toc/contents add heading id attributes for in-page anchors. Those
// ids are presentation only; strip them so a correctly rendered version still
// verifies. Heading text and the rest of the body stay in the comparison.
function withoutHeadingIds(html){
  return String(html).replace(/<(h[23])(\s[^>]*)?>/gi,(_,name,attrs='')=>'<'+name+attrs.replace(/\sid="[^"]*"/i,'')+'>');
}

// Pure public-body verification, shared by local publishing and the cloud
// worker. Importing this helper must not initialize an editorial workspace.
// Journal themes render the final brand list in a separate endnotes block.
export function articleBodyOnPage(html,markdown,site){
  const text=String(markdown).replace(/^# [^\n]+\n+/,''),page=withoutHeadingIds(html);
  for(const [render,renderParts] of [[renderPublicArticle,renderPublicParts],[renderArticle,renderArticleParts]]){
    if(page.includes('<div class="article-body">'+withoutHeadingIds(render(text))+'</div>')||page.includes('<div class="article-body">'+withoutHeadingIds(render(text,{site}))+'</div>'))return true;
    const parts=renderParts(text,{site});
    if(parts.endnotes&&page.includes('<div class="article-body">'+withoutHeadingIds(parts.body)+'</div>')&&page.includes('<div class="article-body article-endnotes">'+withoutHeadingIds(parts.endnotes)+'</div>'))return true;
  }
  return false;
}
