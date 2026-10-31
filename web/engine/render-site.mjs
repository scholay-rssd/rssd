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
export {annualDate} from '../themes/journal/render.mjs';
const renderers={'academic-v1':renderAcademic,'journal-v1':renderJournal};
export async function buildSiteRelease({job,target,site=SITE,source,previousRoot,now=new Date()}){
 const selected=themeForSite(site);
 if(!selected||!renderers[selected.renderer])throw Error('Unsupported Theme renderer');
 const sourceJob={...job,snapshot:originalLanguageSnapshot(job.snapshot)};
 const base=(selected.contentAdapter==='academic-v1'?adaptAcademicSnapshot:adaptPublishedSnapshot)(sourceJob.snapshot,site);
 const organization=await loadOrganization(source,site.id);
 const {content}=await attachKnowledgeGraph(organizeContent(base,organization),{source,site});
 const theme=resolveTheme(site,content);
 const manifest=await renderers[theme.renderer]({job:sourceJob,target,site,source,previousRoot,now,theme,content,organization});
 const localized=await renderLanguagePages({job,target,site,previousRoot,now,manifest});
 const navigated=await finalizeLanguageNavigation({target,site,manifest:localized});
 return attachBrowserExports({target,site,manifest:navigated,snapshot:job.snapshot});
}
