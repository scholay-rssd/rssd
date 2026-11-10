import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseArgs,pickInstaller,signingEnv,updaterKeyFile} from '../scripts/sign-desktop-update.mjs';
import {prepareDesktopUpdate} from '../scripts/desktop-update-manifest.mjs';

test('arguments name a run, a known target and a staging directory',()=>{
  assert.deepEqual(parseArgs(['--run','42','--target','windows-x64','--out','/tmp/x']),{run:'42',target:'windows-x64',out:'/tmp/x'});
  for(const argv of [[],['--run','abc','--target','windows-x64','--out','x'],['--run','1','--target','linux-x64','--out','x'],['--run','1','--target','windows-x64'],['--run','1','--target','--out']])
    assert.throws(()=>parseArgs(argv));
});

test('exactly one installer of the expected version is picked',()=>{
  const files=['/a/desktop/target/release/bundle/nsis/RSSD_0.16.11_x64-setup.exe','/a/artifacts/notes.zip'];
  assert.equal(pickInstaller(files,'windows-x64','0.16.11'),files[0]);
  assert.throws(()=>pickInstaller(files,'windows-x64','0.16.12'),/does not match version/);
  assert.throws(()=>pickInstaller([files[1]],'windows-x64','0.16.11'),/found 0/);
  assert.throws(()=>pickInstaller([files[0],'/b/RSSD_0.16.11_x64-setup.exe'],'windows-x64','0.16.11'),/found 2/);
});

test('signing never passes an inline key alongside the key file',()=>{
  const env=signingEnv({TAURI_SIGNING_PRIVATE_KEY:'',PATH:'/bin'});
  assert.equal('TAURI_SIGNING_PRIVATE_KEY' in env,false);
  assert.equal(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,'');
  assert.equal(env.PATH,'/bin');
});

test('the updater key defaults to the maintenance directory and can be overridden',()=>{
  assert.equal(updaterKeyFile({},'/Users/me'),'/Users/me/Library/Application Support/Scholay Today Maintenance/updates/today.key');
  assert.equal(updaterKeyFile({SCHOLAY_UPDATER_KEY_FILE:'/k'},'/Users/me'),'/k');
});

test('a signed installer joins the existing feed for the same version',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-feed-'));
  try{
    const exe=join(dir,'RSSD_0.16.11_x64-setup.exe');
    await writeFile(exe,'synthetic installer');await writeFile(exe+'.sig','synthetic-signature');
    const out=join(dir,'out');
    await writeFile(join(dir,'mac.app.tar.gz'),'synthetic mac');await writeFile(join(dir,'mac.app.tar.gz.sig'),'mac-signature');
    await prepareDesktopUpdate({artifact:join(dir,'mac.app.tar.gz'),platform:'darwin-aarch64',directory:out,version:'0.16.11',commit:'a'.repeat(40)});
    const receipt=await prepareDesktopUpdate({artifact:exe,platform:'windows-x86_64',directory:out,version:'0.16.11',commit:'a'.repeat(40)});
    assert.equal(receipt.artifact,'today-0.16.11-windows-x86_64.exe');
    const feed=JSON.parse(await readFile(join(out,'latest.json'),'utf8'));
    assert.deepEqual(Object.keys(feed.platforms).sort(),['darwin-aarch64','windows-x86_64']);
    assert.equal(feed.platforms['windows-x86_64'].signature,'synthetic-signature');
  }finally{await rm(dir,{recursive:true,force:true});}
});
