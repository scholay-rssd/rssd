import {SITE} from '../../scripts/site-config.mjs';
import {adaptPublishedSnapshot} from './published-content.mjs';
import {adaptAcademicSnapshot} from '../themes/academic/content.mjs';
import {themeForSite,resolveTheme} from '../themes/registry.mjs';
import {renderAcademic} from '../themes/academic/render.mjs';
import {renderJournal} from '../themes/journal/render.mjs';
import {attachKnowledgeGraph} from './knowledge-graph.mjs';
import {loadOrganization,organizeContent} from './site-organization.mjs';
import {originalLanguageSnapshot,renderLanguagePages} from './language-pages.mjs';
import {finalizeLanguageNavigation} from './language-navigation.mjs';
import {attachBrowserExports} from './browser-export/build.mjs';
import {attachGuestbook} from './guestbook-page.mjs';
import {prepareSnapshotAssets} from './publication-assets.mjs';
import {attachDisplayImages} from './display-images.mjs';
import {loadLanguagePack} from './language-pack.mjs';
export {annualDate} from '../themes/journal/render.mjs';
const renderers={'academic-v1':renderAcademic,'journal-v1':renderJournal};
export async function buildSiteRelease({job,target,site=SITE,source,previousRoot,now=new Date()}){
 const selected=themeForSite(site);
 if(!selected||!renderers[selected.renderer])throw Error('Unsupported Theme renderer');
 const assetHashes={};
 const prepared=await prepareSnapshotAssets(job.snapshot,{target,previousRoot,inline:selected.renderer==='academic-v1',byteHashes:assetHashes});
 const sourceJob={...job,snapshot:originalLanguageSnapshot(prepared)};
 const base=(selected.contentAdapter==='academic-v1'?adaptAcademicSnapshot:adaptPublishedSnapshot)(sourceJob.snapshot,site);
 const organization=await loadOrganization(source,site.id);
 const {content}=await attachKnowledgeGraph(organizeContent(base,organization),{source,site});
 const theme=resolveTheme(site,content);
 const manifest=await renderers[theme.renderer]({job:sourceJob,target,site,source,previousRoot,now,theme,content,organization});
 manifest.byteHashes={...manifest.byteHashes,...assetHashes};
 const languagePack=await loadLanguagePack(source,site.id);
 const localized=await renderLanguagePages({job,target,site,previousRoot,now,manifest,languagePack});
 const navigated=await finalizeLanguageNavigation({target,site,manifest:localized});
 await attachGuestbook({target,site,manifest:navigated});
 const exported=await attachBrowserExports({target,site,manifest:navigated,snapshot:job.snapshot,languagePack});
 // Last, so every page that shows an oversized image points at its display copy.
 return attachDisplayImages({target,manifest:exported,previousRoot});
}
