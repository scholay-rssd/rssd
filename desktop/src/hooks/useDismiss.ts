import { useEffect, useRef, type RefObject } from "react";

export type DismissReason = "outside" | "escape" | "focus" | "blur";

interface Options {
  enabled?: boolean;
  /** Also dismiss when focus leaves the popover subtree (Tab past the last
   *  control). A null relatedTarget is ignored — left to the click/Escape
   *  paths — since focus falling to <body> is not a deliberate move out. */
  onFocusOut?: boolean;
}

/** Dismiss `ref`'s popover on an outside click, Escape, or (optionally) a
 *  Tab out of its subtree. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: (reason: DismissReason) => void,
  { onFocusOut = false, enabled = true }: Options = {},
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const inside = (event: Event) => !!ref.current && event.composedPath().includes(ref.current);
    const onDown = (e: PointerEvent) => {
      if (!inside(e)) close.current("outside");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) close.current("escape");
    };
    const onFocus = (e: FocusEvent) => { if (!inside(e)) close.current("focus"); };
    const onBlur = () => close.current("blur");
    // Capture also sees clicks on editors/buttons that stop propagation. The
    // opening event has already passed this phase, so no delayed listener or
    // gap on every React render is needed. Pointer events include touch/pen.
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    if (onFocusOut) document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [ref, onFocusOut, enabled]);
}
