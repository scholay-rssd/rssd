import ImageGallery from './editorial/ImageGallery';
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import App from "./App";
import Icon from "./components/Icon";
import ToastViewport from "./components/ToastViewport";
import BackgroundQueue from './components/BackgroundQueue';
import {WindowChromeContext} from "./components/PaneToolbar";
import ContentWorkspace from "./editorial/ContentWorkspace";
import DiscoveryWorkspace, {discoverySection, DISCOVERY_SECTION_KEY} from './components/DiscoveryWorkspace';
import ConnectionCenter from './connections/ConnectionCenter';
import CenterWorkspace from './center/CenterWorkspace';
import WorkspaceSwitcher, { parseWorkspace, workspaceShortcut, type Workspace } from "./components/WorkspaceSwitcher";
import { parseRssLibrarySection, RSS_LIBRARY_KEY, type RssLibrarySection } from "./lib/rssLibrary";
import { stepUiScale } from "./lib/uiScale";
import { useUi } from "./store";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./lib/nativeCore";
import { hasBlockingOverlay, useBlockingOverlay } from "./lib/useBlockingOverlay";
import "./workspace.css";

import { tr } from "./uiText";
const WORKSPACE_KEY = "papr.workspace.v2";
const OPEN_SETTINGS = "papr-open-settings";

function loadWorkspace(): Workspace {
  try {
    const saved=localStorage.getItem(WORKSPACE_KEY);
    if(saved==='editorial'&&localStorage.getItem('scholay.creation.tab')==='manuscripts')return 'manuscripts';
    return parseWorkspace(saved, localStorage.getItem(RSS_LIBRARY_KEY));
  }
  catch { return "library"; }
}
function loadRssLibrary(): RssLibrarySection {
  try { return parseRssLibrarySection(localStorage.getItem(RSS_LIBRARY_KEY), localStorage.getItem(WORKSPACE_KEY)); }
  catch { return "articles"; }
}

export function requestOpenSettings(section?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, {detail: {section}}));
}

/** RSS stays mounted at its real dimensions: local reader/AI state and virtual
 *  list scroll survive. Only the active workspace may own the native page. */
export default function WorkspaceApp() {
  // Re-render every screen on a language switch so tr() text follows it.
  useTranslation();
  const [chromeHost, setChromeHost] = useState<HTMLDivElement|null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [librarySection,setLibrarySection]=useState<RssLibrarySection>(loadRssLibrary);
  const [discovery, setDiscovery] = useState(() => discoverySection(loadRssLibrary() !== 'articles' ? loadRssLibrary() : localStorage.getItem(DISCOVERY_SECTION_KEY)));
  const [navigation,setNavigation]=useState<{items:{workspace:Workspace;section:RssLibrarySection}[];index:number}>(()=>({items:[{workspace:loadWorkspace(),section:loadRssLibrary()}],index:0}));
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('scholay.window.sidebars')||'{}');}catch{return {};}});
  const toggleSidebar=useCallback(()=>setCollapsed(v=>({...v,[workspace]:!v[workspace]})),[workspace]);
  useEffect(()=>{localStorage.setItem('scholay.window.sidebars',JSON.stringify(collapsed));},[collapsed]);
  const [editorialVisited, setEditorialVisited] = useState(workspace === "editorial" || workspace === "library" || workspace === "manuscripts" || workspace === "gallery");
  const [discoveryVisited, setDiscoveryVisited] = useState(workspace === 'discover');
  const [connectionsVisited, setConnectionsVisited] = useState(workspace === 'connections');
  const [galleryVisited, setGalleryVisited] = useState(workspace === "gallery");
  const [galleryCompose,setGalleryCompose] = useState<{prompt?:string;taskId?:string;articleId?:string;slotPath?:string;key:number}>();
  const [captureBusy, setCaptureBusy] = useState(false);
  const focusMode = useUi(s => s.focusMode);
  const canCollapse = workspace !== 'center' && workspace !== 'connections' && (workspace !== "rss" || !focusMode);
  const modalOpen = useUi(s => s.modalOpen);
  const menuOpen = useUi(s => s.menuOpen);
  const blockingOverlay = useBlockingOverlay();
  const contentOpen = workspace === "editorial" || workspace === "library" || workspace === "manuscripts";
  const activateRss = () => chooseWorkspace("rss", false, "articles");
  const chooseWorkspace = useCallback((requested: Workspace, fromHistory=false, requestedSection?:RssLibrarySection) => {
    if (captureBusy) return;
    const next = parseWorkspace(requested, requestedSection);
    const section = next === 'rss' ? 'articles' : requested === "hot" || requested === "labels" ? requested : requested === "year" ? "calendar" : requested === "history" ? "history" : next === 'discover' ? discoverySection(requestedSection ?? discovery) : requestedSection ?? librarySection;
    if (next === "editorial" || next === "library" || next === "manuscripts") setEditorialVisited(true);
    if (next === 'discover') { setDiscoveryVisited(true); setDiscovery(discoverySection(section)); }
    if (next === 'connections') setConnectionsVisited(true);
    if (next === "gallery") {setGalleryVisited(true);setEditorialVisited(true);}
    if(!fromHistory)setNavigation(n=>n.items[n.index].workspace===next&&n.items[n.index].section===section?n:{items:[...n.items.slice(0,n.index+1),{workspace:next,section}],index:n.index+1});
    setLibrarySection(section);
    setWorkspace(next);
  }, [captureBusy, librarySection, discovery]);
  useEffect(() => { localStorage.setItem(DISCOVERY_SECTION_KEY, discovery); }, [discovery]);
  useEffect(() => {
    const open = () => chooseWorkspace('connections');
    window.addEventListener('rssd-open-connections', open);
    return () => window.removeEventListener('rssd-open-connections', open);
  }, [chooseWorkspace]);
  useEffect(() => {
    const open = () => chooseWorkspace("library");
    window.addEventListener("scholay-open-library-work", open);
    return () => window.removeEventListener("scholay-open-library-work", open);
  }, [chooseWorkspace]);
  useEffect(() => {
    const open = () => chooseWorkspace("manuscripts");
    window.addEventListener("scholay-open-manuscripts", open);
    return () => window.removeEventListener("scholay-open-manuscripts", open);
  }, [chooseWorkspace]);
  useEffect(() => {
    const open = () => chooseWorkspace("editorial");
    window.addEventListener("scholay-open-creation", open);
    return () => window.removeEventListener("scholay-open-creation", open);
  }, [chooseWorkspace]);
  const [pick, setPick] = useState<{ workspace: Workspace; section: RssLibrarySection; token: string } | null>(null);
  const finishPick = useCallback((id?: number) => {
    if (!pick) return;
    setPick(null);
    chooseWorkspace(pick.workspace, false, pick.section);
    if (id !== undefined) window.dispatchEvent(new CustomEvent("scholay-topic-pick-done", { detail: { token: pick.token, id } }));
  }, [pick, chooseWorkspace]);
  useEffect(() => {
    const start = (event: Event) => {
      if (captureBusy) return;
      setPick({ workspace, section: librarySection, token: String((event as CustomEvent).detail?.token ?? "") });
      chooseWorkspace("rss", false, "articles");
    };
    window.addEventListener("scholay-topic-pick-start", start);
    return () => window.removeEventListener("scholay-topic-pick-start", start);
  }, [workspace, librarySection, captureBusy, chooseWorkspace]);
  useEffect(() => {
    if (!pick) return;
    if (workspace !== "rss" || librarySection !== "articles") { setPick(null); return; }
    const starred = (event: Event) => finishPick(Number((event as CustomEvent).detail?.id));
    window.addEventListener("scholay-article-starred", starred);
    return () => window.removeEventListener("scholay-article-starred", starred);
  }, [pick, workspace, librarySection, finishPick]);
  useEffect(() => {
    const openGallery = (event:Event) => {setGalleryCompose({...((event as CustomEvent).detail||{}),key:Date.now()});chooseWorkspace("gallery");};
    window.addEventListener("scholay-gallery-compose", openGallery);
    return () => window.removeEventListener("scholay-gallery-compose", openGallery);
  }, [chooseWorkspace]);
  useEffect(() => {
    const focus = () => chooseWorkspace("editorial");
    window.addEventListener("scholay-workbench-exit-focus", focus);
    return () => window.removeEventListener("scholay-workbench-exit-focus", focus);
  }, [chooseWorkspace]);
  useEffect(() => {
    try { localStorage.setItem(WORKSPACE_KEY, workspace); localStorage.removeItem('scholay.creation.tab'); } catch { /* Optional preference only. */ }
  }, [workspace]);
  useEffect(() => {
    try { localStorage.setItem(RSS_LIBRARY_KEY, librarySection); } catch { /* Optional preference only. */ }
  }, [librarySection]);
  useEffect(() => {
    const enabled = !captureBusy && !modalOpen && !menuOpen && !blockingOverlay;
    void invoke("set_workspace_shortcuts", { enabled }).catch(() => {});
    const pending = listen<string>("workspace-shortcut", event => {
      const next = workspaceShortcut(Number(event.payload));
      if (enabled && !hasBlockingOverlay() && next) chooseWorkspace(next.value);
    });
    return () => { void pending.then(stop => stop()).catch(() => {}); };
  }, [captureBusy, modalOpen, menuOpen, blockingOverlay, chooseWorkspace]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || captureBusy || modalOpen || menuOpen || hasBlockingOverlay()) return;
      if(canCollapse&&event.key.toLowerCase()==="b"&&!((event.target as Element)?.closest("input,textarea,[contenteditable=true]"))){event.preventDefault();toggleSidebar();return;}
      const next = workspaceShortcut(Number(event.key));
      if (next) {
        event.preventDefault();
        chooseWorkspace(next.value);
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        useUi.getState().setUiScale(stepUiScale(useUi.getState().uiScale, 1));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        useUi.getState().setUiScale(stepUiScale(useUi.getState().uiScale, -1));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        useUi.getState().setUiScale("100");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureBusy, modalOpen, menuOpen, chooseWorkspace, toggleSidebar, canCollapse]);

  function travel(delta:number){const index=navigation.index+delta;if(captureBusy||index<0||index>=navigation.items.length)return;setNavigation(n=>({...n,index}));const item=navigation.items[index];chooseWorkspace(item.workspace,true,item.section);}
  return <WindowChromeContext.Provider value={{host:chromeHost,workspace,collapsed:!!collapsed[workspace],toggle:toggleSidebar}}><div className={"workspace-host has-pane-chrome" + (contentOpen ? " is-content-workspace" : "")+(collapsed[workspace]?" is-sidebar-collapsed":"")}>

    <div className="workspace-window-header" ref={setChromeHost} data-tauri-drag-region="deep"><nav className="workspace-window-navigation" aria-label={tr("窗口导航")}>{navigation.index>0&&<button aria-label={tr("后退")} title={tr("后退到上一个工作区")} disabled={captureBusy||navigation.index===0} onClick={()=>travel(-1)}><Icon name="chevron-right" className="icon-back" size={16}/></button>}{navigation.index<navigation.items.length-1&&<button aria-label={tr("前进")} title={tr("前进到下一个工作区")} disabled={captureBusy||navigation.index===navigation.items.length-1} onClick={()=>travel(1)}><Icon name="chevron-right" size={16}/></button>}{canCollapse&&<button aria-label={tr("展开或收起第一栏")} title={tr("展开或收起第一栏 · ⌘B")} aria-expanded={!collapsed[workspace]} onClick={toggleSidebar}><Icon name="panel-left" size={16}/></button>}</nav></div>
    <WorkspaceSwitcher chromeHost={chromeHost} workspace={workspace} captureBusy={captureBusy} onChange={chooseWorkspace} onOpenSettings={()=>requestOpenSettings()}/>
    {pick&&workspace==="rss"&&<div className="topic-pick-banner" role="status"><span>{tr("选题采集：给一篇文章加星标（S），将自动回到选题")}</span><button onClick={()=>finishPick()}>{tr("取消并返回")}</button></div>}
    <div className="workspace-panels">
      {galleryVisited&&<div id="workspace-gallery-panel" className={'workspace-panel'+(workspace!=="gallery"?' is-inactive':'')} aria-hidden={workspace!=="gallery"} inert={workspace!=="gallery"}><ImageGallery active={workspace==="gallery"} compose={galleryCompose}/></div>}
      <div id="workspace-rss-panel" className={`workspace-panel ${workspace !== "rss" ? "is-inactive" : ""}`} role="region" aria-label="RSS" aria-hidden={workspace !== "rss"} inert={workspace !== "rss"}>
        <App active={workspace === "rss"} onCaptureBusyChange={setCaptureBusy} onRequestActivate={activateRss}
          librarySection="articles" onLibraryChange={section=>chooseWorkspace("rss",false,section)}/>
      </div>
      <div id="workspace-discover-panel" className={'workspace-panel'+(workspace!=='discover'?' is-inactive':'')} role="region" aria-label={tr('发现')} aria-hidden={workspace!=='discover'} inert={workspace!=='discover'}>
        {discoveryVisited&&<DiscoveryWorkspace active={workspace==='discover'} section={discovery} onChange={section=>chooseWorkspace('discover',false,section)}/>}
      </div>
      <div id="workspace-connections-panel" className={'workspace-panel'+(workspace!=='connections'?' is-inactive':'')} role="region" aria-label={tr('连接')} aria-hidden={workspace!=='connections'} inert={workspace!=='connections'}>
        {connectionsVisited&&<main className="connections-workspace"><header><h1>{tr('连接')}</h1><p>{tr('查看可用连接器，选择当前空间要开启的连接。')}</p></header><ConnectionCenter compact active={workspace==='connections'}/></main>}
      </div>
      <div id="workspace-center-panel" className={'workspace-panel'+(workspace!=='center'?' is-inactive':'')} role="region" aria-label="RSSD 中心" aria-hidden={workspace!=='center'} inert={workspace!=='center'}><CenterWorkspace active={workspace==='center'}/></div>
      <div id="workspace-editorial-panel" className={`workspace-panel ${contentOpen ? "" : "is-inactive"}`} role="region" aria-label={workspace === "library" ? tr("作品库") : workspace === "manuscripts" ? tr("稿件") : tr("内容工作台")} aria-hidden={!contentOpen} inert={!contentOpen}>
        {editorialVisited && <ContentWorkspace active={contentOpen} view={workspace==='library'?'works':workspace==='manuscripts'?'manuscripts':'conversations'} chromeHost={chromeHost}/>}
      </div>
    </div>
    <BackgroundQueue/>
  </div><ToastViewport/></WindowChromeContext.Provider>;
}
