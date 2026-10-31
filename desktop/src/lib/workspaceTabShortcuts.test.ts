// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useWorkspaceTabShortcuts from "./useWorkspaceTabShortcuts";

const { invoke, listen, ui, capture } = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}), listen: vi.fn(),
  ui: { modalOpen: false, menuOpen: false, aiOpen: false }, capture: { captureTabId: null as string | null },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../store", () => ({ useUi: Object.assign((select: any) => select(ui), { getState: () => ui }) }));
vi.mock("./readerTabs", () => ({ useReaderTabs: Object.assign((select: any) => select(capture), { getState: () => capture }) }));
let host: HTMLDivElement, root: Root;
const handlers = new Set<(event: { payload: string }) => void>();
const page = () => ({ onCycle: vi.fn(), onClose: vi.fn(), onReopen: vi.fn() });
function Page(props: Parameters<typeof useWorkspaceTabShortcuts>[0]) { useWorkspaceTabShortcuts(props); return null; }
const emit = (action: string) => act(() => { for (const handler of handlers) handler({ payload: action }); });
const key = (name: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options });
  act(() => window.dispatchEvent(event)); return event;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(ui, { modalOpen: false, menuOpen: false, aiOpen: false }); capture.captureTabId = null;
  handlers.clear(); invoke.mockClear();
  listen.mockReset().mockImplementation(async (_name, handler) => { handlers.add(handler); return () => handlers.delete(handler); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("sends identical DOM and native commands only to the currently active workspace", async () => {
  const first = page(), second = page();
  const render = (active: number) => act(async () => root.render(createElement("div", null,
    createElement(Page, { ...first, active: active === 1 }), createElement(Page, { ...second, active: active === 2 }))));
  await render(1);
  expect(key("Tab", { ctrlKey: true }).defaultPrevented).toBe(true);
  key("Tab", { ctrlKey: true, shiftKey: true }); key("w", { metaKey: true }); key("t", { metaKey: true, shiftKey: true });
  expect(first.onCycle.mock.calls).toEqual([[1], [-1]]); expect(first.onClose).toHaveBeenCalledOnce(); expect(first.onReopen).toHaveBeenCalledOnce();
  await render(2); emit("next"); emit("close"); emit("reopen");
  expect(second.onCycle).toHaveBeenCalledWith(1); expect(second.onClose).toHaveBeenCalledOnce(); expect(second.onReopen).toHaveBeenCalledOnce();
  expect(first.onClose).toHaveBeenCalledOnce(); expect(handlers.size).toBe(1);
});

it("checks modal, menu, AI and capture gates at dispatch time and respects composed input", async () => {
  const callbacks = page(); await act(async () => root.render(createElement(Page, { ...callbacks, active: true })));
  for (const field of ["modalOpen", "menuOpen", "aiOpen"] as const) {
    ui[field] = true; emit("close"); expect(key("w", { metaKey: true }).defaultPrevented).toBe(false); ui[field] = false;
  }
  capture.captureTabId = "capture"; emit("next"); key("Tab", { ctrlKey: true }); capture.captureTabId = null;
  key("w", { metaKey: true, isComposing: true }); key("w", { metaKey: true, altKey: true });
  expect(callbacks.onClose).not.toHaveBeenCalled(); expect(callbacks.onCycle).not.toHaveBeenCalled();
  emit("close"); expect(callbacks.onClose).toHaveBeenCalledOnce();
});

it("disables native commands for a visible local dialog and restores them after it closes", async () => {
  const callbacks = page(); await act(async () => root.render(createElement(Page, { ...callbacks, active: true })));
  const dialog = document.createElement("section"); dialog.setAttribute("role", "alertdialog");
  await act(async () => document.body.append(dialog)); emit("close");
  expect(invoke).toHaveBeenLastCalledWith("set_reader_shortcuts", { enabled: false }); expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => { dialog.style.display = "none"; }); emit("close");
  expect(invoke).toHaveBeenLastCalledWith("set_reader_shortcuts", { enabled: true }); expect(callbacks.onClose).toHaveBeenCalledOnce();
  dialog.remove();
});

it("uses fresh callbacks and discards a late native subscription after unmount", async () => {
  const old = page(), current = page();
  await act(async () => root.render(createElement(Page, { ...old, active: true })));
  await act(async () => root.render(createElement(Page, { ...current, active: true })));
  emit("reopen"); expect(old.onReopen).not.toHaveBeenCalled(); expect(current.onReopen).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  let stop!: (unlisten: () => void) => void; let late!: (event: { payload: string }) => void;
  const cleanup = vi.fn(); listen.mockImplementation((_name, handler) => { late = handler; return new Promise(resolve => { stop = resolve; }); });
  await act(async () => root.render(createElement(Page, { ...current, active: true })));
  await act(async () => root.render(null)); act(() => late({ payload: "close" }));
  expect(current.onClose).not.toHaveBeenCalled(); await act(async () => stop(cleanup)); expect(cleanup).toHaveBeenCalledOnce();
});
