import React from "react";
import ReactDOM from "react-dom/client";
import {flushSync} from "react-dom";
import {configureSpaceTransition,trackNativeWork,waitForSpacePreparation} from "./lib/spaceTransition";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {activateSpaceStorage,consumeSpaceReaderEntry} from "./lib/spaceStorage";
import {invoke,isTauri,nativeTransport} from "./lib/nativeCore";
import { isMac } from "./lib/platform";
// Bundle the three UI / reader fonts so Windows and Linux render with the
// same letterforms macOS sees, instead of falling through to Arial / DejaVu.
// Variable-weight woff2 — one file per family covers every weight the styles
// reference (450 / 500 / 550 / 600 / 650 / 700).
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./styles.css";

import { tr } from "./uiText";
// Tag the document root before first paint so the mac-only titlebar chrome
// (overlay strip, sidebar padding for the traffic lights) is gated correctly
// from the very first frame — otherwise Win/Linux would briefly show 38px of
// dead space at the top before a layout-shifting effect runs.
document.documentElement.dataset.platform = isMac ? "mac" : "other";

// Suppress the webview's default context menu — its "Reload / Back / Inspect"
// entries belong to a browser, not a finished app. Editable surfaces still get
// the native menu so paste / select-all / spellcheck stay available. The reader
// supplies its own context menu (copy / save image / …) in ContextMenu.tsx.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
  e.preventDefault();
});


const nativeWork=isTauri()?trackNativeWork(nativeTransport):undefined;
async function boot(){
 let context=isTauri()?await invoke<{site:import('../../scripts/site-profile.mjs').SiteProfile;spaceId:string;runtimeEpoch:number}>('space_context'):null;
 if(context){
   nativeWork?.setEpoch(context.runtimeEpoch);
   (globalThis as any).__SCHOLAY_SITE=context.site;activateSpaceStorage(localStorage,context.spaceId);consumeSpaceReaderEntry(localStorage,context.spaceId);
 }
 const {setLanguage,detectLanguage}=await import('./i18n');
 const {setActiveSite}=await import('../../scripts/site-profile.mjs');
 const {ErrorBoundary}=await import('./components/ErrorBoundary');
 const {default:WorkspaceApp}=await import('./WorkspaceApp');
 const {resetSpaceUi}=await import('./store');
 const {resetStartupView}=await import('./App');
 const {flushReaderTabs,restoreSpaceReaderTabs}=await import('./lib/readerTabs');
 const {flushReadingGroups,restoreSpaceReadingGroups}=await import('./lib/readingGroups');
 const {clearSpacePageSessions}=await import('./lib/readerPageSession');
 const {enqueuePageView}=await import('./lib/pageViewQueue');
 const {useFormatJobs}=await import('./lib/formatJobs');
 const {useToasts,toast}=await import('./toast');
 const root=ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
 let queryClient:QueryClient;
 const render=()=>{
  queryClient=new QueryClient({defaultOptions:{queries:{staleTime:30_000,refetchOnWindowFocus:false,retry:1}}});
  flushSync(()=>root.render(<React.StrictMode><ErrorBoundary><QueryClientProvider client={queryClient}><WorkspaceApp /></QueryClientProvider></ErrorBoundary></React.StrictMode>));
 };
 configureSpaceTransition(async spaceId=>{
  if(!context||context.spaceId===spaceId)return;
  const previous=context;
  // Keep the current feature while restoring the destination's own data and tabs.
    const navigation={workspace:localStorage.getItem('papr.workspace.v2')??'library',section:localStorage.getItem('scholay.rss.library.v1')??'articles'};
  // Retain the native window and JS runtime. Dispose only the space-owned tree
  // so timers/listeners cannot continue using old article IDs after the swap.
  // A DOM snapshot also copied every hidden editor, article and image. Keep
  // this screen constant-sized so switching never duplicates the whole app.
  const progress=(message:string)=>flushSync(()=>root.render(<div className="space-transition" role="status" aria-live="polite"><strong>{tr("正在切换空间…")}</strong><span>{message}</span></div>));
  progress(tr('正在保存当前空间的界面状态'));
  nativeWork?.pause();
  let storageMoved=false;
  try{
   // Give the status a paint before storage serialization and native work.
   await new Promise(resolve=>setTimeout(resolve,0));
   await waitForSpacePreparation(async()=>{
    await invoke('space_quiesce');
    await enqueuePageView(()=>{});
    await nativeWork?.drain();
   },tr('旧空间的网页或后台任务尚未结束，已保留原空间，请稍后重试。'));
   queryClient.clear();
   flushReaderTabs();flushReadingGroups();
   activateSpaceStorage(localStorage,spaceId);storageMoved=true;
   progress(tr('正在打开目标空间的资料库'));
   context=await invoke<typeof previous>('space_select',{spaceId});
   nativeWork?.setEpoch(context.runtimeEpoch);
   localStorage.setItem('papr.workspace.v2',navigation.workspace);
   localStorage.setItem('scholay.rss.library.v1',navigation.section);
   setActiveSite(context.site);
   clearSpacePageSessions();useFormatJobs.setState({jobs:{}});useToasts.getState().dismiss();
   restoreSpaceReaderTabs();restoreSpaceReadingGroups();
   resetSpaceUi();resetStartupView();
  }catch(error){
   if(storageMoved)activateSpaceStorage(localStorage,previous.spaceId);
   // Native selection is transactional; if presentation restoration fails
   // after a successful commit, return to the previous native space as well.
   if(context!==previous){context=await invoke<typeof previous>('space_select',{spaceId:previous.spaceId});nativeWork?.setEpoch(context.runtimeEpoch);setActiveSite(previous.site);restoreSpaceReaderTabs();restoreSpaceReadingGroups();resetSpaceUi();}
   toast.error(tr("切换未完成：{{error}}", {error: String(error)}));
   throw error;
  }finally{
   queryClient.clear();nativeWork?.resume();setLanguage(detectLanguage());render();
  }
 });
 render();
}
void boot().catch(error=>{document.getElementById('root')!.textContent=tr('空间启动失败：{{error}}',{error:String(error)});});
