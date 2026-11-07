import {createHash} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {requireStoreOnlyFixtureTree,STORE_ONLY_PROFILES} from './rssd-store-only-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function git(args,cwd=root){
  const result=spawnSync('git',args,{cwd,encoding:'utf8'});
  if(result.status!==0)throw Error((result.stderr||result.stdout||'git failed').trim());
  return result.stdout.trim();
}
function sha256(buffer){return createHash('sha256').update(buffer).digest('hex');}
async function extractTarGz(archive,destination){
  await mkdir(destination,{recursive:true});
  const tar=spawnSync('tar',['-xzf',archive,'-C',destination]);
  if(tar.status!==0)throw Error('tar extract failed: '+(tar.stderr||'').toString());
}

export async function archiveStoreOnlyFixture(out,base=root){
  const tree=requireStoreOnlyFixtureTree(base);
  const appHead=git(['rev-parse','HEAD'],base);
  const sitesSha=tree.sitesGitlink;
  const sitesHead=git(['-C','sites','rev-parse','HEAD'],base);
  if(sitesHead!==sitesSha)throw Error('sites worktree '+sitesHead+' does not match gitlink '+sitesSha+'; checkout the recorded submodule');
  await rm(out,{recursive:true,force:true});
  await mkdir(out,{recursive:true,mode:0o755});
  const appArchive=join(out,'rssd-app-'+appHead.slice(0,8)+'.tar.gz');
  const sitesArchive=join(out,'rssd-sites-'+sitesSha.slice(0,8)+'.tar.gz');
  const appResult=spawnSync('git',['archive','--format=tar.gz','-o',appArchive,'HEAD'],{cwd:base});
  if(appResult.status!==0)throw Error('git archive app failed');
  const sitesResult=spawnSync('git',['-C','sites','archive','--format=tar.gz','-o',sitesArchive,'HEAD'],{cwd:base});
  if(sitesResult.status!==0)throw Error('git archive sites submodule failed');
  const combined=join(out,'tree');
  await extractTarGz(appArchive,combined);
  await mkdir(join(combined,'sites'),{recursive:true});
  await extractTarGz(sitesArchive,join(combined,'sites'));
  const extractedProfiles=JSON.parse(await readFile(join(combined,STORE_ONLY_PROFILES),'utf8'));
  if(!extractedProfiles.some(site=>site.id==='enter'&&typeof site.origin==='string'&&site.origin.startsWith('https://')))throw Error('combined archive is missing the real enter profile');
  await import(pathToFileURL(join(combined,'scripts/site-config.mjs')).href);
  const appBytes=await readFile(appArchive);
  const sitesBytes=await readFile(sitesArchive);
  const manifest={
    name:'rssd-app-store-only-integration-input',
    kind:'credential-free application source pack for center cross-repo fixture',
    notProduction:true,
    notRealCodex:true,
    producer:'in-process mock returning title/bodyMarkdown; not Codex/ACP',
    node:{required:'>=24',archivedWith:process.version},
    app:{repo:'scholay-rssd/rssd',head:appHead,archive:'rssd-app-'+appHead.slice(0,8)+'.tar.gz',sha256:sha256(appBytes)},
    sites:{
      repo:'scholay-rssd/rssd-sites',
      gitlink:sitesSha,
      note:'Parent git archive omits submodule contents. This pack adds the recorded sites tree so sites/profiles.json is the real catalog, not a stub.',
      archive:'rssd-sites-'+sitesSha.slice(0,8)+'.tar.gz',
      sha256:sha256(sitesBytes),
    },
    credentials:{included:false,mintAtTestSite:'rssd_device_ + 48 URL-safe chars; never a production token'},
  };
  await writeFile(join(out,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(out,'SHA256SUMS.txt'),manifest.app.sha256+'  '+manifest.app.archive+'\n'+manifest.sites.sha256+'  '+manifest.sites.archive+'\n');
  await writeFile(join(out,'README.md'),`# Application store-only fixture tree (no credentials)

Node.js **24+** is required (\`package.json\` engines, headless packager). Node 22 cannot be treated as a complete verification.

\`sites/profiles.json\` is **not generated**. It lives in the \`sites\` git submodule (\`rssd-sites\` @ \`${sitesSha}\`). \`git archive\` of the parent repo only stores a gitlink, so a parent-only tarball cannot load \`tests/rssd-store-only-translate.test.mjs\`. That is a packaging omission, not a reason to write a stub.

## Preferred checkout (no pack)

\`\`\`sh
git clone --recurse-submodules https://github.com/scholay-rssd/rssd.git
cd rssd
git checkout ${appHead}
git submodule update --init sites
node -v   # must be v24+
npm ci --omit=dev --no-audit --no-fund
node --test tests/rssd-protocol.test.mjs tests/rssd-center-client.test.mjs tests/rssd-production-worker.test.mjs tests/rssd-translate-continuation.test.mjs tests/rssd-store-only-translate.test.mjs tests/rssd-store-only-fixture.test.mjs tests/rssd-translate-isolated-acceptance.test.mjs
\`\`\`

Do not \`echo '[]' > sites/profiles.json\`. Headless packaging copies the same real file (\`desktop/scripts/prepare-workbench.mjs\`).

## This pack

1. Extract \`${manifest.app.archive}\` (application HEAD \`${appHead}\`).
2. Extract \`${manifest.sites.archive}\` **into** \`sites/\` (submodule \`${sitesSha}\`).
3. \`npm ci --omit=dev\` (needs \`markdown-it\`).
4. Run the tests above with Node 24+.

Combined tree is also under \`tree/\` in this directory after the archive script runs.

Mint device tokens only at the test site. Producer remains an in-process mock, not Codex.
`);
  return {out,appHead,sitesSha,appArchive,sitesArchive,manifest,combined};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  archiveStoreOnlyFixture(resolve(process.argv[2]||join(root,'.local/store-only-fixture-pack'))).then(result=>console.log(JSON.stringify({out:result.out,appHead:result.appHead,sitesSha:result.sitesSha},null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
