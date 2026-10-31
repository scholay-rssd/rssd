import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PublicationSection } from "./model";

export const PUBLICATION_SPLIT_KEY = "scholay.publications.split.v1";
export const WEBSITE_SPLIT_KEY = "scholay.website.split.v1";
export const DEFAULT_PUBLICATION_RATIO = .39;
export const PUBLICATION_DIVIDER_WIDTH = 12;

function readRatio(key: string, fallback: number) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null")?.ratio;
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1) return value;
  } catch { /* An optional preference must not prevent opening the workspace. */ }
  return fallback;
}

/** Keep both panes readable; narrow windows only clamp the display, never the
 * saved ratio. Widening the window restores the user's preferred split. */
export function fitPublicationSplit(viewport: number, ratio: number) {
  const available = Math.max(0, viewport - PUBLICATION_DIVIDER_WIDTH);
  const min = Math.min(250, available * .46);
  const max = Math.max(min, available - Math.min(320, available - min));
  return { available, min, max, width: Math.min(max, Math.max(min, available * ratio)) };
}

export function usePublicationSplit(active: boolean, section: PublicationSection, storageKey?: string) {
  // Keep the existing platform preference, with a separate website preference.
  const key = storageKey || (section === "platforms" ? PUBLICATION_SPLIT_KEY : WEBSITE_SPLIT_KEY);
  const defaultRatio = section === "platforms" ? DEFAULT_PUBLICATION_RATIO : .30;
  const hostRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => readRatio(key, defaultRatio));
  const [geometry, setGeometry] = useState({ viewport: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const viewport = host.clientWidth || rect.width;
      // Hidden workspaces report zero. Preserve their last geometry.
      if (viewport > 0) {
        const scale=rect.width / viewport || 1;
        setGeometry(previous=>previous.viewport===viewport&&previous.scale===scale?previous:{viewport,scale});
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active]);
  const split = fitPublicationSplit(geometry.viewport, ratio);
  const resize = (width: number) => {
    if (!active || !split.available || !Number.isFinite(width)) return;
    const next = Math.min(split.max, Math.max(split.min, width)) / split.available;
    setRatio(next);
    try { localStorage.setItem(key, JSON.stringify({ ratio: next })); }
    catch { /* Dragging remains available when storage is disabled. */ }
  };
  const reset = () => {
    if (!active) return;
    setRatio(defaultRatio);
    try { localStorage.removeItem(key); } catch { /* Optional preference. */ }
  };
  return {
    hostRef, ...split, scale: geometry.scale, dragging, setDragging, resize, reset,
    style: geometry.viewport > 0 ? { "--pub-list-width": `${split.width}px` } as CSSProperties : undefined,
  };
}
