import { useLayoutEffect, useState } from "react";

// Legacy popovers don't all publish modalOpen/menuOpen. Watch their actual
// presence as well so native keyboard handling yields before they take focus.
export function hasBlockingOverlay(): boolean {
  return typeof document !== "undefined" && [...document.querySelectorAll(".cp-backdrop,.settings-backdrop,.modal-backdrop,.ctx-menu,.tag-picker,.lightbox,.hl-popover,.hl-toolbar,details[data-transient-popover][open],.notebook-insert-popover,.notebook-link-popover,.editorial-rich-insert")].some(el => !el.closest("[inert]"));
}
export function useBlockingOverlay(): boolean {
  const [blocked, setBlocked] = useState(hasBlockingOverlay);
  useLayoutEffect(() => {
    const update = () => setBlocked(hasBlockingOverlay());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "open"] });
    return () => observer.disconnect();
  }, []);
  return blocked;
}
