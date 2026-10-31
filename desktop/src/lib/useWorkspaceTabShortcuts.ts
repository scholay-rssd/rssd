import { useEffect, useRef } from "react";
import { invoke } from "./nativeCore";
import { listen } from "@tauri-apps/api/event";
import { useUi } from "../store";
import { useReaderTabs } from "./readerTabs";
import { hasBlockingOverlay } from "./useBlockingOverlay";

type Handlers = {
  active: boolean;
  blocked?: boolean;
  onCycle: (direction: 1 | -1) => void;
  onClose: () => void;
  onReopen?: () => void;
};

function visibleDialog() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')].some(dialog => {
    if (dialog.closest('[inert],.is-inactive,[hidden]')) return false;
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}

/** DOM and native child pages share the same commands. Page callbacks retain
 * ownership of selection, dirty-editor checks and transient closed history. */
export default function useWorkspaceTabShortcuts(handlers: Handlers) {
  const current = useRef(handlers);
  current.current = handlers;
  const modal = useUi(state => state.modalOpen);
  const menu = useUi(state => state.menuOpen);
  const ai = useUi(state => state.aiOpen);
  const capture = useReaderTabs(state => state.captureTabId);

  useEffect(() => {
    if (!handlers.active) return;
    let disposed = false;
    let nativeEnabled: boolean | undefined;
    const enabled = () => {
      const ui = useUi.getState();
      return !disposed && current.current.active && !current.current.blocked && !ui.modalOpen && !ui.menuOpen && !ui.aiOpen
        && !useReaderTabs.getState().captureTabId && !hasBlockingOverlay() && !visibleDialog();
    };
    const updateNative = () => {
      const next = enabled();
      if (nativeEnabled === next) return;
      nativeEnabled = next;
      void invoke("set_reader_shortcuts", { enabled: next }).catch(() => {});
    };
    const run = (action: string) => {
      if (!enabled()) return;
      const page = current.current;
      if (action === "close") page.onClose();
      if (action === "reopen") page.onReopen?.();
      if (action === "next" || action === "previous") page.onCycle(action === "next" ? 1 : -1);
    };
    const key = (event: KeyboardEvent) => {
      if (!enabled() || event.defaultPrevented || event.isComposing || event.altKey) return;
      const mod = event.ctrlKey || event.metaKey;
      const action = mod && !event.shiftKey && event.key.toLowerCase() === "w" ? "close"
        : mod && event.shiftKey && event.key.toLowerCase() === "t" ? "reopen"
        : event.ctrlKey && event.key === "Tab" ? event.shiftKey ? "previous" : "next" : null;
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      run(action);
    };
    const pending = listen<string>("reader-tab-shortcut", event => run(event.payload));
    const observer = new MutationObserver(updateNative);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "class", "style", "hidden"] });
    window.addEventListener("keydown", key, true);
    updateNative();
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("keydown", key, true);
      void pending.then(stop => stop()).catch(() => {});
      void invoke("set_reader_shortcuts", { enabled: false }).catch(() => {});
    };
  }, [handlers.active, handlers.blocked, modal, menu, ai, capture]);
}
